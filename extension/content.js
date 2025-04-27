// content.js - Redirect Version

console.log("Impulse Blocker (Redirect) content script injected.");

// Send message immediately, background handles idempotency if needed
try {
    const currentUrl = window.location.href;
    console.log(`Content Script: Sending startRedirect for URL: ${currentUrl}`);
    chrome.runtime.sendMessage({ action: "startRedirect", checkoutUrl: currentUrl });
} catch (e) {
    // This might happen if the script runs before the background is fully ready
    console.warn("Content Script: Error sending initial startRedirect message:", e);
    // Optional: Could use a short timeout and retry, but background tab listener is the backup.
}

// No other listeners needed here (like beforeunload) as background handles tab closing/navigation.