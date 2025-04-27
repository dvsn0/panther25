// content.js (Minimal Redirect Trigger - like Response #25)
console.log("Impulse Blocker (Redirect v5) content script injected.");
try {
    const currentUrl = window.location.href;
    console.log(`Content Script: Sending startRedirect for URL: ${currentUrl}`);
    chrome.runtime.sendMessage({ action: "startRedirect", checkoutUrl: currentUrl });
} catch (e) { console.warn("Content Script: Error sending initial startRedirect:", e); }