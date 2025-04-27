// --- Handles initial webcam permission request ---
/**
 * Handles initial webcam permission request.
 */
function handleWebcamPermissionRequest(sendResponse) {
    console.log("Requesting webcam permission on behalf of content script...");
    navigator.mediaDevices.getUserMedia({ video: true })
        .then((stream) => {
            console.log("Webcam permission granted.");
            stream.getTracks().forEach(track => track.stop());
            sendResponse({ success: true });

            // Webcam permission granted.
        })
        .catch((error) => {
            console.error("Webcam permission denied or error:", error);
            sendResponse({ success: false, error: error.message });
        });
}

// --- Message Listener ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
        case "requestWebcamPermission":
            handleWebcamPermissionRequest(sendResponse);
            return true; // Important for async sendResponse

        case "analyzeEmotionFromContent":
            console.log("Received base64 image from content script.");

            // --- Rebuild Blob from base64 string ---
            const byteCharacters = atob(message.blob);
            const byteArrays = [];
            for (let offset = 0; offset < byteCharacters.length; offset += 512) {
                const slice = byteCharacters.slice(offset, offset + 512);
                const byteNumbers = new Array(slice.length);
                for (let i = 0; i < slice.length; i++) {
                    byteNumbers[i] = slice.charCodeAt(i);
                }
                const byteArray = new Uint8Array(byteNumbers);
                byteArrays.push(byteArray);
            }
            const imageBlob = new Blob(byteArrays, { type: 'image/jpeg' });

            console.log("Image Blob reconstructed successfully:", imageBlob);

            // --- For Testing: Skip Hume API submission ---
            console.log("TEST MODE: Skipping Hume API. Webcam capture and permission successful!");

            setTimeout(() => {
                sendResponse({ action: "emotionResult", success: true, showPopup: true });
            }, 1000);

            return true; // Important for async sendResponse

        case "analyzeEmotion":
            console.log("Received analyzeEmotion request (Batch API Flow)");
            (async () => {
                try {
                    const imageBlob = await captureFrameAsBlob();
                    const jobId = await startHumeAnalysisJob(imageBlob);
                    const emotions = await getHumeJobResults(jobId); // Includes polling

                    const distressScore = emotions['Distress'] || 0;
                    const angerScore = emotions['Anger'] || 0;

                    let showPopup = (distressScore >= (settings.distressThreshold || 0.6) ||
                                     angerScore >= (settings.angerThreshold || 0.5));

                    console.log(`Analysis complete. Show Popup: ${showPopup}`);
                    sendResponse({ action: "emotionResult", success: true, showPopup: showPopup });

                } catch (error) {
                    console.error("Emotion analysis pipeline failed:", error);
                    sendResponse({ action: "emotionResult", success: false, error: error.message, showPopup: false });
                }
            })();
            return true; // Indicate asynchronous response

        default:
            // No action matched; do nothing or handle other cases if needed
            break;
    }
});

// --- Initialization ---
loadSettings();
console.log("Impulse Blocker background script (Batch API - Confirmed) loaded.");