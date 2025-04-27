// background.js - Redirect Version (v5.1 - Log Redirect URL)

let settings = {}; // Stores API key, thresholds
let redirectedTabs = {}; // Tracks tabs we've *initiated* redirect for { tabId: originalUrl }

const LOCALHOST_URL_BASE = "http://localhost:8081"; // <<<--- ENSURE THIS PORT MATCHES YOUR SERVER
const SAFE_FLAG_PREFIX = "safeToLoad_"; // Prefix for session storage keys

// --- Settings Management ---
function loadSettings() {
    chrome.storage.sync.get({
        humeApiKey: '',
        distressThreshold: 0.6,
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
        const checkoutUrl = message.checkoutUrl;

        if (!checkoutUrl) {
            console.error("Background: Received startRedirect without checkoutUrl.");
            return false;
        }

        // --- CHECK SAFE FLAG BEFORE REDIRECTING ---
        const safeFlagKey = `${SAFE_FLAG_PREFIX}${tabId}`;
        chrome.storage.session.get([safeFlagKey], (result) => {
            if (chrome.runtime.lastError) {
                 console.error("Background: Error checking session storage:", chrome.runtime.lastError);
                 performRedirectCheck(tabId, checkoutUrl); // Proceed cautiously on storage error
                 return;
            }

            if (result[safeFlagKey]) {
                console.log(`Background: Tab ${tabId} is returning safely. Redirect skipped. Clearing flag.`);
                chrome.storage.session.remove([safeFlagKey]);
            } else {
                console.log(`Background: No safe flag for tab ${tabId}. Proceeding with redirect check.`);
                performRedirectCheck(tabId, checkoutUrl);
            }
        });

        return true; // Indicate async response (due to storage check)
    }

    // Handle message from localhost page *before* it redirects back
    if (message.action === "markTabAsSafe" && message.tabId) {
         const tabIdToMark = message.tabId;
         const safeFlagKey = `${SAFE_FLAG_PREFIX}${tabIdToMark}`;
         console.log(`Background: Marking tab ${tabIdToMark} as safe to load.`);
         chrome.storage.session.set({ [safeFlagKey]: true }, () => {
              if (chrome.runtime.lastError) {
                 console.error("Background: Error setting safe flag:", chrome.runtime.lastError);
                 sendResponse({ success: false, error: chrome.runtime.lastError.message });
              } else {
                 console.log(`Background: Flag ${safeFlagKey} set successfully.`);
                 sendResponse({ success: true }); // Acknowledge flag set
                 setTimeout(() => { chrome.storage.session.remove([safeFlagKey]); }, 10 * 1000); // Auto-clear flag
              }
         });
         return true; // Indicate async response
    }

    return false; // Indicate message not handled
});

// --- Redirect Logic (Separated Function with Pre-Redirect Logging) ---
function performRedirectCheck(tabId, checkoutUrl) {
     if (redirectedTabs[tabId]) {
         console.log(`Background: Tab ${tabId} already marked as redirected. Ignoring.`);
         return;
     }

     // --- Parameter Checks ---
     if (!tabId || typeof tabId !== 'number') {
          console.error(`Background: Invalid tabId ('${tabId}') received for redirect check. Aborting.`);
          return;
     }
      if (!checkoutUrl || typeof checkoutUrl !== 'string' || checkoutUrl.length === 0) {
          console.error(`Background: Invalid checkoutUrl ('${checkoutUrl}') received. Aborting.`);
          return;
     }
     // --- End Parameter Checks ---

     let originalUrlEncoded;
     try { originalUrlEncoded = encodeURIComponent(checkoutUrl); }
     catch (e) { console.error(`Background: Error encoding checkoutUrl: ${checkoutUrl}`, e); return; }

     const targetUrl = `${LOCALHOST_URL_BASE}/?originalUrl=${originalUrlEncoded}&tabId=${tabId}`;

     // --- CRITICAL LOG: Log the URL BEFORE updating ---
     console.log(`Background: Attempting to redirect tab ${tabId} TO EXACT URL: ${targetUrl}`);
     // --- END CRITICAL LOG ---

     redirectedTabs[tabId] = checkoutUrl; // Mark as redirected before update call

     chrome.tabs.update(tabId, { url: targetUrl }, (updatedTab) => {
         if (chrome.runtime.lastError) {
             console.error(`Background: Error redirecting tab ${tabId}:`, chrome.runtime.lastError.message);
             delete redirectedTabs[tabId]; // Clean up state on error
         } else {
             console.log(`Background: chrome.tabs.update call successful for tab ${tabId}.`);
         }
     });
}


// --- API Key Provider (External Message Handler) ---
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
     console.log("Background: Received external message:", message, "from sender:", sender);
     // Origin Check - Ensure it matches LOCALHOST_URL_BASE's origin
      const expectedOrigin = new URL(LOCALHOST_URL_BASE).origin; // e.g., "http://localhost:8081"
     if (sender.origin !== expectedOrigin) {
          console.warn("Background: Ignoring external message from unexpected origin:", sender.origin, `Expected: ${expectedOrigin}`);
          return false;
     }

     if (message.action === "getHumeApiKey") {
          console.log("Background: Providing API key and thresholds to localhost page.");
          const responsePayload = {
               success: !!settings.humeApiKey, // Success depends on key existing
               apiKey: settings.humeApiKey || null,
               thresholds: {
                   Anger: settings.angerThreshold,
                   Distress: settings.distressThreshold
               },
               error: settings.humeApiKey ? null : "API Key not configured in extension options."
          };
           if (!settings.humeApiKey) console.error("Background: Cannot provide API key, it's not set.");

          try {
              sendResponse(responsePayload);
              console.log("Background: sendResponse called for getHumeApiKey.");
          } catch (e) { console.error("Background: Error DURING sendResponse for getHumeApiKey:", e); }
          return true; // Indicate async response potentially needed
     }

      // Handle markTabAsSafe via external messaging as well (redundant but safe)
      if (message.action === "markTabAsSafe" && message.tabId) {
         const tabIdToMark = message.tabId;
         const safeFlagKey = `${SAFE_FLAG_PREFIX}${tabIdToMark}`;
         console.log(`Background: Marking tab ${tabIdToMark} as safe to load (via external).`);
         chrome.storage.session.set({ [safeFlagKey]: true }, () => {
              if (chrome.runtime.lastError) { /* ... error handling ... */ sendResponse({ success: false, error: chrome.runtime.lastError.message }); }
              else { /* ... success handling ... */ sendResponse({ success: true }); setTimeout(() => { chrome.storage.session.remove([safeFlagKey]); }, 10 * 1000); }
         });
         return true;
     }

     return false; // Unhandled external message action
});


// --- Tab Cleanup ---
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    const safeFlagKey = `${SAFE_FLAG_PREFIX}${tabId}`;
    const wasRedirected = !!redirectedTabs[tabId];
    delete redirectedTabs[tabId];
    chrome.storage.session.remove([safeFlagKey]);
    if(wasRedirected) console.log(`Background: Tab ${tabId} removed. Cleared state.`);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (redirectedTabs[tabId] && changeInfo.url && !changeInfo.url.startsWith(LOCALHOST_URL_BASE)) {
        console.log(`Background: Redirected tab ${tabId} navigated away from localhost (${changeInfo.url}). Clearing state.`);
        const safeFlagKey = `${SAFE_FLAG_PREFIX}${tabId}`;
        delete redirectedTabs[tabId];
        chrome.storage.session.remove([safeFlagKey]);
    }
});
// --- End Tab Cleanup ---

console.log("Impulse Blocker background script (Redirect v5.1 - Log Redirect URL) loaded.");