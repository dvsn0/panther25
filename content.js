// content.js - Streaming Version

console.log("Impulse Blocker (Streaming) content script injected.");

let isCheckoutPage = true; // Assume true since the script is injected based on manifest matches

// --- Inform background script on load ---
try {
    console.log("Content Script: Sending checkoutPageEntered");
    chrome.runtime.sendMessage({ action: "checkoutPageEntered" });
} catch (e) {
    console.error("Content Script: Error sending checkoutPageEntered message:", e);
}


// --- Listen for warning message from background ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Content Script: Received message:", message);
    if (message && message.action === "showEmotionWarning") {
        console.log("Content Script: Displaying emotion warning popup.");
        alert(message.message || "High negative emotion detected! Are you sure you are in the right state of mind to be making this purchase?");
        // We don't need to send a response back here
        isCheckoutPage = false; // Stop sending exit message if popup shown? Or let background handle state? Let background handle.
    }
    // Indicate that we won't be sending an asynchronous response
    return false;
});


// --- Inform background script on page unload/navigation ---
window.addEventListener('beforeunload', () => {
    // This event fires when navigating away or closing the tab
    if (isCheckoutPage) { // Avoid sending if we already navigated away somehow
         try { // <--- ADD TRY
            console.log("Content Script: Attempting to send checkoutPageExited (beforeunload - unreliable)");
            // Note: This might still fail silently, but won't throw console error
            chrome.runtime.sendMessage({ action: "checkoutPageExited" });
         } catch(e){ // <--- ADD CATCH
            // Log difference? console.warn("...") vs console.error("...")
             console.warn("Content Script: Error sending checkoutPageExited (expected during unload):", e.message)
         }
    }
});

console.log("Content Script: Listeners added.");