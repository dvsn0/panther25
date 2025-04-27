// background.js - Streaming Version

let settings = {}; // Stores API key, thresholds
let activeTabs = {}; // Tracks tabs currently on checkout page: { tabId: { monitoring: true, warningShown: false } }
let offscreenDocumentActive = false; // Flag to track offscreen document status
let creatingOffscreenDocument = null; // Promise flag for creation race condition

const OFFSCREEN_DOCUMENT_PATH = '/offscreen.html';

// --- Settings Management ---
function loadSettings() {
    chrome.storage.sync.get({
        humeApiKey: '',
        distressThreshold: 0.6, // Keep thresholds, offscreen will need them
        angerThreshold: 0.6 // Example: using 0.6 for Anger now
    }, (items) => {
        settings = items;
        console.log("Background: Settings loaded:", settings);
        if (!settings.humeApiKey) {
            console.warn("Background: Hume AI API Key is not set.");
        }
    });
}

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync') {
        console.log("Background: Settings changed, reloading...");
        loadSettings();
        // If streaming is active, potentially notify offscreen about threshold changes? (Future enhancement)
    }
});
loadSettings();
// --- End Settings Management ---


// --- Offscreen Document Management ---
async function hasOffscreenDocument() {
    // Check chrome.runtime contexts instead of chrome.offscreen.hasDocument (more reliable)
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
        documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
    }).catch(() => []); // Ignore errors, assume no context
    return existingContexts.length > 0;
}

async function setupOffscreenDocument() {
    if (await hasOffscreenDocument()) {
        console.log("Background: Offscreen document already exists.");
        offscreenDocumentActive = true;
        return true;
    }
     if (creatingOffscreenDocument) {
        console.log("Background: Waiting for existing offscreen document creation...");
        return await creatingOffscreenDocument;
     }

    console.log("Background: Creating offscreen document.");
    // Store the promise to handle race conditions
     creatingOffscreenDocument = new Promise(async (resolve, reject) => {
        try {
            await chrome.offscreen.createDocument({
                url: OFFSCREEN_DOCUMENT_PATH,
                reasons: [chrome.offscreen.Reason.USER_MEDIA],
                justification: 'Real-time webcam streaming for emotion analysis on checkout pages.',
            });
            if (chrome.runtime.lastError) {
                console.error("Background: runtime.lastError after createDocument:", chrome.runtime.lastError.message);
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            console.log("Background: Offscreen document created successfully.");
            offscreenDocumentActive = true;
            resolve(true);
        } catch (error) {
            console.error("Background: Error creating offscreen document:", error);
            offscreenDocumentActive = false; // Ensure flag is false on error
             reject(error);
        } finally {
             creatingOffscreenDocument = null; // Clear the promise flag
        }
     });
     return await creatingOffscreenDocument;
}

async function closeOffscreenDocument() {
    if (!(await hasOffscreenDocument())) {
        console.log("Background: No active offscreen document to close.");
        offscreenDocumentActive = false;
        return;
    }
    try {
        console.log("Background: Closing offscreen document.");
        await chrome.offscreen.closeDocument();
        offscreenDocumentActive = false;
         console.log("Background: Offscreen document closed.");
    } catch (error) {
        console.error("Background: Error closing offscreen document:", error);
        // Consider the state unknown here, might still be active
         offscreenDocumentActive = await hasOffscreenDocument(); // Re-check status
    }
}
// --- End Offscreen Document Management ---


// --- Message Handling ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Filter out messages intended for offscreen
    if (message?.target === 'offscreen') {
        return false;
    }

    const tabId = sender.tab?.id;

    switch (message?.action) {
        case "checkoutPageEntered":
            console.log(`Background: checkoutPageEntered received from tab ${tabId}`);
            if (tabId) {
                handleCheckoutEntered(tabId);
            } else {
                 console.warn("Background: Received checkoutPageEntered without tab ID.");
            }
            break; // Indicate message handled

        case "checkoutPageExited":
             console.log(`Background: checkoutPageExited received from tab ${tabId} (likely via content script beforeunload)`);
            if (tabId) {
                handleCheckoutExited(tabId, "content_script_unload");
            }
            break; // Indicate message handled

        case "streamThresholdMet": // Message from offscreen.js
            console.log(`Background: streamThresholdMet received (origin likely offscreen) for tab ${message.tabId}`);
             if (message.tabId) {
                 handleThresholdMet(message.tabId);
             } else {
                 console.error("Background: Received streamThresholdMet without tabId from offscreen.");
             }
             break; // Indicate message handled

        case "streamError": // Message from offscreen.js
             console.error(`Background: streamError received from offscreen for tab ${message.tabId}. Error:`, message.error);
             if (message.tabId) {
                 // Stop monitoring this tab on stream error
                 handleCheckoutExited(message.tabId, "stream_error");
             }
             break; // Indicate message handled

        default:
            console.log("Background: Received unhandled message:", message);
            return false; // Indicate message not handled
    }
    // Indicate message was handled (either sync or async setup for response started)
    // We don't use sendResponse here, so returning false is fine.
    return false;
});
// --- End Message Handling ---


// --- Tab Lifecycle Monitoring ---
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    console.log(`Background: Tab ${tabId} removed.`);
    if (activeTabs[tabId]) {
        handleCheckoutExited(tabId, "tab_removed");
    }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Check if URL changed for a monitored tab
    if (activeTabs[tabId] && changeInfo.url && tab) {
        // Use the new URL from changeInfo.url if available, otherwise tab.url
        const newUrl = changeInfo.url;
         console.log(`Background: Tab ${tabId} updated. URL changed to: ${newUrl}`);
        // Check if the NEW url still matches our checkout patterns
        if (!isCheckoutUrl(newUrl)) {
            console.log(`Background: Tab ${tabId} navigated away from checkout page.`);
            handleCheckoutExited(tabId, "tab_navigation");
        } else {
             console.log(`Background: Tab ${tabId} navigated within checkout page (or to another checkout page). Monitoring continues.`);
             // Reset warning flag if they navigate to a *different* stage of checkout? Maybe not needed.
             // activeTabs[tabId].warningShown = false;
        }
    } else if (activeTabs[tabId] && changeInfo.status === 'loading' && tab?.url && !isCheckoutUrl(tab.url)) {
        // Catch cases where navigation starts but URL isn't in changeInfo yet
         console.log(`Background: Tab ${tabId} started loading non-checkout URL: ${tab.url}`);
         handleCheckoutExited(tabId, "tab_navigation_loading");
    }
});

// Helper to check if a URL matches checkout patterns (sync check)
function isCheckoutUrl(url) {
    if (!url) return false;
    // Use similar patterns as manifest, simplified for JS regex
    const checkoutPatterns = [
        /.*\.amazon\.com\/gp\/buy\/spc\/handlers\/display\.html.*/i,
        /.*\.amazon\.com\/checkout\/.*/i,
        /.*\.amazon\.com\/proceed-to-checkout.*/i,
        /.*\.amazon\.co\.uk\/gp\/buy\/spc\/handlers\/display\.html.*/i,
        /.*\.amazon\.co\.uk\/checkout\/.*/i,
        /.*\.amazon\.co\.uk\/proceed-to-checkout.*/i,
        /.*\.amazon\.ca\/gp\/buy\/spc\/handlers\/display\.html.*/i,
        /.*\.amazon\.ca\/checkout\/.*/i,
        /.*\.amazon\.ca\/proceed-to-checkout.*/i
        // Add more patterns if needed
    ];
    return checkoutPatterns.some(pattern => pattern.test(url));
}
// --- End Tab Lifecycle Monitoring ---


// --- Core Logic Functions ---
async function handleCheckoutEntered(tabId) {
    console.log(`Background: Handling checkout entered for tab ${tabId}`);
    if (activeTabs[tabId]?.monitoring) {
        console.log(`Background: Already monitoring tab ${tabId}.`);
        return; // Already active
    }

    // Check API key
    if (!settings.humeApiKey) {
        console.error("Background: Cannot start monitoring, Hume API Key is missing.");
        // Optionally notify user via content script?
        return;
    }

    // Setup offscreen document
    const offscreenReady = await setupOffscreenDocument();
    if (!offscreenReady) {
        console.error("Background: Failed to setup offscreen document. Cannot start monitoring.");
        return;
    }

    // Mark tab as active *before* sending message
    activeTabs[tabId] = { monitoring: true, warningShown: false };
    console.log("Background: Active tabs:", activeTabs);


    // Tell offscreen document to start streaming
    console.log(`Background: Sending start-streaming to offscreen for tab ${tabId}`);
    try {
         // Send necessary config from settings
        chrome.runtime.sendMessage({
            target: 'offscreen',
            type: 'start-streaming',
            apiKey: settings.humeApiKey,
            threshold: settings.angerThreshold || 0.6, // Send the specific threshold
            tabId: tabId // Send tabId so offscreen can report back correctly
        });
    } catch (error) {
         console.error("Background: Error sending start-streaming message:", error);
         // Clean up state if message fails immediately
         delete activeTabs[tabId];
          checkAndCloseOffscreen(); // Check if offscreen should be closed
    }
}

function handleCheckoutExited(tabId, reason = "unknown") {
    console.log(`Background: Handling checkout exited for tab ${tabId}. Reason: ${reason}`);
    if (!activeTabs[tabId]) {
        console.log(`Background: Tab ${tabId} was not being actively monitored.`);
        return; // Not monitoring this tab
    }

    // Mark tab as inactive
    delete activeTabs[tabId];
    console.log("Background: Active tabs after exit:", activeTabs);


    // Tell offscreen document to stop streaming (if it's active)
    if (offscreenDocumentActive) {
        console.log(`Background: Sending stop-streaming to offscreen for tab ${tabId}`);
        try {
            // Although offscreen manages one stream, send tabId for context if needed later
            chrome.runtime.sendMessage({
                target: 'offscreen',
                type: 'stop-streaming',
                tabId: tabId
            });
        } catch (error) {
             console.error("Background: Error sending stop-streaming message:", error);
             // Offscreen might have already closed
             offscreenDocumentActive = false; // Assume inactive on send error
        }
    }

    // Check if we should close the offscreen document
    checkAndCloseOffscreen();
}

function handleThresholdMet(tabId) {
    console.log(`Background: Handling threshold met for tab ${tabId}`);
    if (!activeTabs[tabId]) {
        console.warn(`Background: Received threshold alert for inactive tab ${tabId}. Ignoring.`);
        return;
    }

    if (activeTabs[tabId].warningShown) {
        console.log(`Background: Warning already shown for tab ${tabId}. Ignoring duplicate alert.`);
        return;
    }

    // Mark warning as shown
    activeTabs[tabId].warningShown = true;
    console.log(`Background: Marked warningShown=true for tab ${tabId}`);


    // Send message to content script to show popup
    console.log(`Background: Sending showEmotionWarning to content script for tab ${tabId}`);
    chrome.tabs.sendMessage(
        tabId,
        {
            action: "showEmotionWarning",
            message: "High negative emotion detected! Are you sure you are in the right state of mind to be making this purchase?" // Customize if needed
        },
        (response) => { // Optional: Check response or errors from content script
            if (chrome.runtime.lastError) {
                console.error(`Background: Error sending message to content script ${tabId}: ${chrome.runtime.lastError.message}`);
                 // Tab might have closed just before message sent
                 handleCheckoutExited(tabId, "content_script_unreachable");
            } else {
                 console.log(`Background: Content script ${tabId} acknowledged warning message.`);
            }
        }
    );

    // Important: Streaming should have been stopped by offscreen.js *before* it sent this message.
    // So we don't explicitly tell it to stop here, but we do mark the tab as effectively done.
    // We keep the tab in activeTabs until navigation/closure to prevent re-triggering immediately.
    // However, let's treat it as exited logic-wise to potentially close offscreen
    // delete activeTabs[tabId]; // Or should we keep it marked as warningShown? Let's keep it for now.

    // Check if offscreen should close *if* offscreen isn't smart enough to stop itself
    // checkAndCloseOffscreen(); // Redundant if offscreen stops itself
}

// Check if any tabs are active, close offscreen if not
function checkAndCloseOffscreen() {
    if (Object.keys(activeTabs).length === 0) {
        console.log("Background: No active tabs remaining. Closing offscreen document.");
        closeOffscreenDocument();
    } else {
        console.log("Background: Active tabs remain. Keeping offscreen document open.");
    }
}
// --- End Core Logic Functions ---

console.log("Impulse Blocker background script (Streaming Version) loaded.");