// --- Impulse Blocker Content Script ---
// Purpose: Handles buy button clicks, custom popup UI, webcam permission request (via background), and initial capture setup

console.log("Impulse Blocker content script loaded.");

// Global webcam stream holder
let webcamStream = null;

async function startWebcam() {
    if (webcamStream) {
        console.log("Webcam already active.");
        return; // Stream already exists, no need to re-request
    }

    try {
        webcamStream = await navigator.mediaDevices.getUserMedia({ video: true });
        console.log("Webcam started.");

        const videoElement = document.createElement('video');
        videoElement.style.display = 'none';
        videoElement.srcObject = webcamStream;
        videoElement.play();
        document.body.appendChild(videoElement);

        chrome.runtime.sendMessage({ action: "webcamPermissionGranted" });
    } catch (error) {
        console.error("Error starting webcam:", error);
        chrome.runtime.sendMessage({ action: "webcamPermissionDenied", error: error.message });
    }
}

function stopWebcam() {
    if (webcamStream) {
        console.log("Stopping webcam...");
        webcamStream.getTracks().forEach(track => track.stop());
        webcamStream = null;
    }
}

// Ensure request triggers after page fully loads
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    startWebcam();
} else {
    window.addEventListener('DOMContentLoaded', startWebcam);
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        console.log("Tab is active, starting webcam...");
        startWebcam();
    } else {
        console.log("Tab is inactive, stopping webcam...");
        stopWebcam();
    }
});

window.addEventListener('beforeunload', stopWebcam);

// --- Configuration: Buy Button Selectors ---
const buyButtonSelectors = [
    '#buy-now-button',
    'input[name="submit.buy-now"]',
    '#one-click-button'
];

let clickedButton = null; // Store the last clicked buy button

// --- Utility Functions ---
function isBuyButton(element) {
    let currentElement = element;
    while (currentElement && currentElement !== document.body) {
        for (const selector of buyButtonSelectors) {
            if (currentElement.matches(selector)) {
                return currentElement;
            }
        }
        currentElement = currentElement.parentElement;
    }
    return null;
}

function showImpulsePopup(onConfirm, onCancel) {
    const existing = document.getElementById('impulse-popup');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'impulse-popup';
    modal.innerHTML = `
        <div style="
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0, 0, 0, 0.5);
            z-index: 9999; display: flex; align-items: center; justify-content: center;
        ">
            <div style="
                background: white; padding: 30px; border-radius: 10px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
                max-width: 400px; text-align: center; font-family: sans-serif;
            ">
                <h2>Impulse Purchase Check</h2>
                <p>Are you sure this isn't an impulse buy?</p>
                <button id="impulse-proceed" style="margin-right: 10px; padding: 8px 15px;">Yes, proceed</button>
                <button id="impulse-cancel" style="padding: 8px 15px;">No, cancel</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('impulse-proceed').onclick = () => {
        modal.remove();
        onConfirm();
    };
    document.getElementById('impulse-cancel').onclick = () => {
        modal.remove();
        onCancel();
    };
}

function proceedWithPurchase() {
    if (clickedButton) {
        console.log("Proceeding with click action on:", clickedButton);
        if (clickedButton.form) {
            let tempInput = null;
            if (clickedButton.name && clickedButton.value) {
                tempInput = document.createElement('input');
                tempInput.type = 'hidden';
                tempInput.name = clickedButton.name;
                tempInput.value = clickedButton.value;
                clickedButton.form.appendChild(tempInput);
            }
            clickedButton.form.submit();
            if (tempInput) clickedButton.form.removeChild(tempInput);
        } else {
            const originalButton = clickedButton;
            clickedButton = null;
            originalButton.click();
        }
    } else {
        console.error("No button stored to proceed with purchase.");
    }
}

async function captureWebcamAndSend() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        const videoTrack = stream.getVideoTracks()[0];
        const imageCapture = new ImageCapture(videoTrack);
        const frame = await imageCapture.grabFrame();
        videoTrack.stop();
        stream.getTracks().forEach(track => track.stop());

        const canvas = document.createElement('canvas');
        canvas.width = frame.width;
        canvas.height = frame.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(frame, 0, 0);
        frame.close();

        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
        const base64Blob = await blobToBase64(blob);

        chrome.runtime.sendMessage(
            { action: "analyzeEmotionFromContent", blob: base64Blob },
            (response) => {
                console.log("Emotion analysis response from background:", response);
            }
        );

    } catch (err) {
        console.error("Error capturing webcam frame:", err);
        alert("Unable to access webcam. Please check permissions.");
    }
}

async function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64String = reader.result.split(',')[1];
            resolve(base64String);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// --- Event Listeners ---
document.addEventListener('click', (event) => {
    const targetButton = isBuyButton(event.target);

    if (targetButton) {
        console.log("Buy button clicked:", targetButton);
        clickedButton = targetButton;

        event.preventDefault();
        event.stopPropagation();

        showImpulsePopup(
            () => {
                console.log("User chose to proceed.");
                proceedWithPurchase();
            },
            () => {
                console.log("User cancelled the purchase.");
                alert("Purchase blocked. Please reconsider!");
            }
        );
    }
}, true);

// Listen for background messages (future expansion)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Message received in content script:", message);
    // Future handlers here
});