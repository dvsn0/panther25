// background.js - Redirect Version

let settings = {}; // Stores API key, thresholds
let redirectedTabs = {}; // Tracks tabs we've already redirected to prevent loops { tabId: originalUrl }

const LOCALHOST_URL_BASE = "http://localhost:8081"; // Change port if needed

// --- Settings Management ---
function loadSettings() {
    chrome.storage.sync.get({
        humeApiKey: '',
        distressThreshold: 0.6, // Store thresholds too
        angerThreshold: 0.6
    }, (items) => {
        settings = items;
        console.log("Background: Settings loaded:", settings);
    });
}
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync') {
        console.log("Background: Settings changed, reloading...");
        loadSettings();
    }
});
loadSettings();
// --- End Settings Management ---

// --- Message Handling ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Background: Received message:", message, "from sender:", sender);

    // Handle redirect request from content script
    if (message.action === "startRedirect" && sender.tab) {
        const tabId = sender.tab.id;
        // Avoid redirect loops if we already sent this tab to localhost
        if (redirectedTabs[tabId]) {
            console.log(`Background: Tab ${tabId} already redirected. Ignoring duplicate request.`);
            return false; // Message handled (ignored)
        }
        if (!message.checkoutUrl) {
            console.error("Background: Received startRedirect without checkoutUrl.");
            return false;
        }

        // Construct the target URL for the local page
        const originalUrlEncoded = encodeURIComponent(message.checkoutUrl);
        const targetUrl = `${LOCALHOST_URL_BASE}/?originalUrl=${originalUrlEncoded}`;

        console.log(`Background: Redirecting tab ${tabId} from ${message.checkoutUrl} to ${targetUrl}`);
        // Store that we are redirecting this tab
        redirectedTabs[tabId] = message.checkoutUrl;
        // Perform the redirect
        chrome.tabs.update(tabId, { url: targetUrl }, (updatedTab) => {
            if (chrome.runtime.lastError) {
                console.error("Background: Error redirecting tab:", chrome.runtime.lastError.message);
                // Clean up if redirect fails
                delete redirectedTabs[tabId];
            } else {
                console.log(`Background: Tab ${tabId} successfully redirected.`);
            }
        });
        return false; // Message handled
    }

    return false; // Indicate message not handled if it falls through
});

// Listen for messages from the externally connectable localhost page
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
     console.log("Background: Received external message:", message, "from sender:", sender);
     if (sender.origin !== "http://localhost:8081") { // Basic security check
          console.warn("Background: Ignoring external message from unexpected origin:", sender.origin);
          return false; // Don't respond
     }

     if (message.action === "getHumeApiKey") {
          console.log("Background: Providing API key and thresholds to localhost page.");
          if (settings.humeApiKey) {
               sendResponse({
                    success: true,
                    apiKey: settings.humeApiKey,
                    // Send thresholds too, so localhost doesn't need them hardcoded
                    thresholds: {
                        Anger: settings.angerThreshold,
                        Distress: settings.distressThreshold
                    }
               });
          } else {
               console.error("Background: Cannot provide API key, it's not set in options.");
               sendResponse({ success: false, error: "API Key not configured in extension options." });
          }
          // Keep channel open for async response? Although get() is sync here, best practice:
          return true; // Indicate response will be sent asynchronously (even if quick)
     }
     return false; // Unhandled external message action
});


// --- Tab Cleanup ---
// Listen for tab closures or updates to remove them from our redirected list
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    if (redirectedTabs[tabId]) {
        console.log(`Background: Redirected tab ${tabId} removed. Clearing state.`);
        delete redirectedTabs[tabId];
    }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // If a tab we redirected updates its URL to something *other* than our localhost page,
    // assume the user navigated away or back, and clear the state.
    if (redirectedTabs[tabId] && changeInfo.url && !changeInfo.url.startsWith(LOCALHOST_URL_BASE)) {
        console.log(`Background: Redirected tab ${tabId} navigated away from localhost. Clearing state.`);
        delete redirectedTabs[tabId];
    }
});
// --- End Tab Cleanup ---

console.log("Impulse Blocker background script (Redirect Version) loaded.");