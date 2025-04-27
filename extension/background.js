// background.js - Redirect Version (with Loop Prevention)

let settings = {}; // Stores API key, thresholds
// Use a more descriptive name: stores { tabId: originalCheckoutUrl } for tabs currently undergoing the check
let checkPendingForTab = {};

const LOCALHOST_URL_BASE = "http://localhost:8081"; // Change port if needed

// --- Settings Management ---
function loadSettings() {
    chrome.storage.sync.get({
        humeApiKey: '',
        distressThreshold: 0.5,
        angerThreshold: 0.5
    }, (items) => {
        settings = items;
        console.log("Background: Settings loaded."); // Simplified log
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

// --- Message Handling from Content Script ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Background: Received message:", message, "from sender:", sender);

    if (message.action === "startRedirect" && sender.tab) {
        const tabId = sender.tab.id;
        const checkoutUrl = message.checkoutUrl;

        if (!checkoutUrl) {
            console.error("Background: Received startRedirect without checkoutUrl.");
            return false; // Indicate message not handled
        }

        // *** LOOP PREVENTION LOGIC ***
        // Check if we are currently waiting for this tab to return from localhost for this *exact* URL
        if (checkPendingForTab[tabId] && checkPendingForTab[tabId] === checkoutUrl) {
            // Yes, this tab just returned from the check. Allow it to load.
            console.log(`Background: Tab ${tabId} returned from emotion check for ${checkoutUrl}. Allowing load.`);
            // Clear the pending state
            delete checkPendingForTab[tabId];
            // Do NOT redirect again.
            return false; // Indicate message handled (by ignoring it)
        } else {
            // No, this is a fresh attempt to load the checkout URL (or a different one).
            // Initiate the redirect flow.

            // Construct the target URL for the local page
            const originalUrlEncoded = encodeURIComponent(checkoutUrl);
            const targetUrl = `${LOCALHOST_URL_BASE}/?originalUrl=${originalUrlEncoded}`;

            console.log(`Background: Redirecting tab ${tabId} from ${checkoutUrl} to ${targetUrl}`);

            // Store that we are now waiting for this tab to complete the check for this URL
            checkPendingForTab[tabId] = checkoutUrl;

            // Perform the redirect
            chrome.tabs.update(tabId, { url: targetUrl }, (updatedTab) => {
                if (chrome.runtime.lastError) {
                    console.error(`Background: Error redirecting tab ${tabId}:`, chrome.runtime.lastError.message);
                    // Clean up if redirect fails immediately
                    delete checkPendingForTab[tabId];
                } else {
                    console.log(`Background: Tab ${tabId} successfully redirected to emotion check.`);
                }
            });
            return false; // Indicate message handled (by redirecting)
        }
    }

    // Handle other messages if needed...

    return false; // Indicate message not handled by this listener
});

// --- Message Handling from Localhost Page ---
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
     console.log("Background: Received external message:", message, "from sender:", sender);
     if (!sender.origin || !sender.origin.startsWith('http://localhost')) { // Allow any localhost port for flexibility
          console.warn("Background: Ignoring external message from unexpected origin:", sender.origin);
          return false; // Don't respond
     }

     if (message.action === "getHumeApiKey") {
          console.log("Background: Providing API key and thresholds to localhost page.");
          if (settings.humeApiKey) {
               sendResponse({
                    success: true,
                    apiKey: settings.humeApiKey,
                    thresholds: { // Send nested thresholds object
                        Anger: settings.angerThreshold,
                        Distress: settings.distressThreshold
                    }
               });
          } else {
               console.error("Background: Cannot provide API key, it's not set in options.");
               sendResponse({ success: false, error: "API Key not configured in extension options." });
          }
          // Keep channel open for async response
          return true;
     }
     return false; // Unhandled external message action
});


// --- Tab Cleanup ---
// Listen for tab closures or updates to remove them from our pending list
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    if (checkPendingForTab[tabId]) {
        console.log(`Background: Tab ${tabId} (pending check) removed. Clearing state.`);
        delete checkPendingForTab[tabId];
    }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // If a tab we sent to localhost updates its URL to something *other* than
    // our localhost page OR the original checkout URL it came from,
    // assume the user navigated away manually and clear the pending state.
    const pendingUrl = checkPendingForTab[tabId];
    if (pendingUrl && changeInfo.url) {
        // Check if the new URL is NOT localhost AND also NOT the original URL we are waiting for it to return to.
        if (!changeInfo.url.startsWith(LOCALHOST_URL_BASE) && changeInfo.url !== pendingUrl) {
             console.log(`Background: Tab ${tabId} (pending check) navigated away to ${changeInfo.url}. Clearing state.`);
             delete checkPendingForTab[tabId];
        }
        // Note: We specifically DO NOT clear the state if changeInfo.url *is* the pendingUrl,
        // because that's the legitimate return navigation we are trying to allow!
    }
});

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    // … your existing getHumeApiKey handler …
  
    if (message.action === "incrementCount") {
      // read the old value, bump it, save it back
      chrome.storage.sync.get({ blockedCount: 0 }, (data) => {
        const next = data.blockedCount + 1;
        chrome.storage.sync.set({ blockedCount: next }, () => {
          console.log("BlockedCount incremented to", next);
          sendResponse({ success: true, newCount: next });
        });
      });
      return true;  // keep channel open for our async sendResponse
    }
  
    // any other external messages…
  });
  

// --- End Tab Cleanup ---

console.log("Impulse Blocker background script (Redirect Version w/ Loop Prevention) loaded.");