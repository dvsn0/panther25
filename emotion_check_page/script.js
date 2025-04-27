// script.js - Localhost Page Logic

const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const proceedBtn = document.getElementById('proceedBtn');
const messageArea = document.getElementById('messageArea');

const EXTENSION_ID = "eahhhpgnnciefhijgfnodbaoeidndngl"; // <-- VERY IMPORTANT: Replace with your actual Extension ID

let mediaStream = null;
let humeApiKey = null;
let thresholds = { Anger: 0.6, Distress: 0.6 }; // Defaults, will be fetched
let originalUrl = null;
let isProcessing = false; // Prevent double clicks

const HUME_SUBMIT_URL = 'https://api.hume.ai/v0/batch/jobs';
const POLLING_INTERVAL = 2000; // ms
const MAX_POLLING_ATTEMPTS = 10;

// --- Initialization ---

window.onload = async () => {
    messageArea.textContent = "Initializing...";

    // 1. Get original URL
    const urlParams = new URLSearchParams(window.location.search);
    const encodedUrl = urlParams.get('originalUrl');
    if (!encodedUrl) {
        displayError("Error: Missing original Amazon URL.");
        return;
    }
    originalUrl = decodeURIComponent(encodedUrl);
    console.log("Original Amazon URL:", originalUrl);

    // 2. Fetch API Key and Thresholds from Extension
    try {
        messageArea.textContent = "Fetching configuration from extension...";
        const config = await getConfigFromExtension();
        humeApiKey = config.apiKey;
        thresholds = config.thresholds; // Use fetched thresholds
        console.log("Configuration received:", { apiKey: '******', thresholds }); // Don't log key fully
        if (!humeApiKey) throw new Error("API Key not provided by extension.");
        messageArea.textContent = "Configuration loaded.";
    } catch (err) {
        displayError(`Error getting config from extension: ${err.message}. Make sure the extension is installed and enabled.`);
        return;
    }

    // 3. Start Camera
    try {
        messageArea.textContent = "Requesting camera access...";
        await startCamera();
        messageArea.textContent = "Camera active. Click Proceed when ready.";
        proceedBtn.disabled = false;
        proceedBtn.textContent = "Proceed";
    } catch (err) {
        displayError(`Camera Error: ${err.message}. Please grant permission and refresh.`);
        proceedBtn.textContent = "Camera Error";
    }
};

// --- Communication with Extension ---

function getConfigFromExtension() {
    console.log(`Attempting to connect to extension ID: ${EXTENSION_ID}`);
    if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
         return Promise.reject(new Error("Chrome extension context not found. Are you running this outside of localhost or is the extension ID wrong?"));
    }

    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
            EXTENSION_ID,
            { action: "getHumeApiKey" },
            (response) => {
                if (chrome.runtime.lastError) {
                    console.error("Error connecting to extension:", chrome.runtime.lastError.message);
                    return reject(new Error(`Could not connect to extension: ${chrome.runtime.lastError.message}. Is the extension ID correct in manifest.json and script.js?`));
                }
                if (response && response.success) {
                    resolve({ apiKey: response.apiKey, thresholds: response.thresholds });
                } else {
                    reject(new Error(response?.error || "Failed to get API key from extension."));
                }
            }
        );
        // Add a timeout in case the extension doesn't respond
        setTimeout(() => reject(new Error("Timeout waiting for response from extension.")), 5000); // 5 seconds timeout
    });
}


// --- Camera Handling ---

async function startCamera() {
    if (mediaStream) return; // Already started
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("getUserMedia is not supported by this browser.");
    }
    mediaStream = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = mediaStream;
    video.onloadedmetadata = () => {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        console.log("Camera started and dimensions set.");
    };
}

function stopCamera() {
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
        video.srcObject = null;
        console.log("Camera stopped.");
    }
}

async function captureFrameAsBlob() {
    if (!mediaStream || !video.srcObject || video.videoWidth === 0) {
        throw new Error("Camera stream not active or video dimensions not ready.");
    }
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
}

// --- Button Click Logic ---

proceedBtn.addEventListener('click', async () => {
    if (isProcessing) return; // Prevent double clicks
    isProcessing = true;
    proceedBtn.disabled = true;
    proceedBtn.textContent = "Analyzing...";
    messageArea.textContent = "Capturing frame and analyzing emotion...";

    try {
        // 1. Capture Frame
        const imageBlob = await captureFrameAsBlob();
        if (!imageBlob) throw new Error("Failed to capture frame as Blob.");
        console.log("Frame captured as Blob, size:", imageBlob.size);

        // We can stop the camera now as we only need one frame
        stopCamera();

        // 2. Analyze with Hume
        const emotions = await analyzeWithHume(imageBlob);
        console.log("Analysis complete. Emotions:", emotions);

        // 3. Check Thresholds
        const angerScore = emotions['Anger'] || 0;
        const distressScore = emotions['Distress'] || 0;
        const angerThreshold = thresholds?.Anger || 0.6;
        const distressThreshold = thresholds?.Distress || 0.6;

        console.log(`Scores - Anger: ${angerScore.toFixed(3)} (Threshold: ${angerThreshold}), Distress: ${distressScore.toFixed(3)} (Threshold: ${distressThreshold})`);

        if (angerScore >= angerThreshold || distressScore >= distressThreshold) {
            displayError(`High ${angerScore >= angerThreshold ? 'Anger' : 'Distress'} detected. Please reconsider this purchase.`);
            // Don't redirect, keep the user on this page with the message
            proceedBtn.textContent = "Action Blocked";
            // Optionally re-enable button after a delay?
             // setTimeout(() => {
             //     proceedBtn.disabled = false;
             //     proceedBtn.textContent = "Proceed";
             //     isProcessing = false;
             //     messageArea.textContent = "Please try again if you feel calmer.";
             //     startCamera(); // Restart camera if allowing retry
             // }, 5000);

        } else {
            // 4. Redirect Back
            messageArea.textContent = "Emotion levels acceptable. Redirecting back to Amazon...";
            console.log("Redirecting to:", originalUrl);
            // Add a small delay so the user sees the message
            setTimeout(() => {
                window.location.href = originalUrl;
            }, 1500);
            // isProcessing remains true to prevent actions during redirect delay
        }

    } catch (err) {
        displayError(`Error during processing: ${err.message}`);
        console.error("Processing error:", err);
        proceedBtn.disabled = false;
        proceedBtn.textContent = "Retry Proceed";
        isProcessing = false;
        // Attempt to restart camera if it failed
        if (!mediaStream) startCamera().catch(camErr => displayError(`Camera Error: ${camErr.message}`));

    }
});


// --- Hume AI Interaction (Batch API) ---

async function analyzeWithHume(imageBlob) {
    if (!humeApiKey) throw new Error("Hume API Key is missing.");
    if (!imageBlob) throw new Error("Image Blob is missing.");

    const jobId = await startHumeAnalysisJob(imageBlob);
    console.log("Hume Job Started. ID:", jobId);
    messageArea.textContent = `Analysis job submitted (ID: ${jobId.substring(0, 8)}...). Waiting for results...`;

    const emotions = await getHumeJobResults(jobId);
    return emotions;
}

async function startHumeAnalysisJob(imageBlob) {
    const formData = new FormData();
    formData.append('file', imageBlob, 'webcam_capture.jpg');
    const modelsRequest = { models: { face: {} } };
    formData.append('json', JSON.stringify(modelsRequest));

    console.log("Submitting job to Hume AI...");
    const response = await fetch(HUME_SUBMIT_URL, {
        method: 'POST',
        headers: {
            'X-Hume-Api-Key': humeApiKey // Key fetched from extension
        },
        body: formData
    });

    const responseBodyText = await response.text();
    if (!response.ok) {
        console.error("Hume job submission Error:", response.status, response.statusText, responseBodyText);
        throw new Error(`Hume job submission failed (${response.status}).`);
    }

    const results = JSON.parse(responseBodyText);
    const jobId = results.job_id;
    if (!jobId) throw new Error("Failed to get Job ID from Hume AI response.");
    return jobId;
}

async function getHumeJobResults(jobId) {
    const resultsUrl = `https://api.hume.ai/v0/batch/jobs/${jobId}/predictions`;
    console.log(`Polling results from: ${resultsUrl}`);

    for (let attempt = 1; attempt <= MAX_POLLING_ATTEMPTS; attempt++) {
        console.log(`Polling attempt ${attempt}...`);
        messageArea.textContent = `Checking analysis results (Attempt ${attempt}/${MAX_POLLING_ATTEMPTS})...`;

        try {
            const response = await fetch(resultsUrl, {
                method: 'GET',
                headers: { 'X-Hume-Api-Key': humeApiKey }
            });

            if (response.ok) {
                const results = await response.json();
                console.log("Hume Raw Results:", results);
                // Check status within the results if available (structure might vary)
                // For /predictions endpoint, success usually means completed.
                // Parse emotions:
                const emotionDataArray = results?.[0]?.results?.predictions?.[0]?.models?.face?.grouped_predictions?.[0]?.predictions?.[0]?.emotions;
                if (emotionDataArray && Array.isArray(emotionDataArray)) {
                    let emotions = {};
                    emotionDataArray.forEach(e => { emotions[e.name] = e.score; });
                    messageArea.textContent = "Analysis complete.";
                    return emotions;
                } else {
                    // It might be completed but have no face data
                     console.warn("Job completed but no valid emotion structure found.", results);
                     messageArea.textContent = "Analysis complete, but no face/emotion data found.";
                     return {}; // Return empty object if no face detected
                }
            } else if (response.status === 429) {
                console.warn("Rate limit hit. Stopping polling.");
                throw new Error("Hume API rate limit exceeded.");
            } else {
                // Handle other non-OK statuses (e.g., 404 initially, 424 if job still processing)
                console.warn(`Polling attempt ${attempt} failed: ${response.status}`);
                // Continue polling unless it's a fatal error
            }

        } catch (error) {
            console.error(`Error during polling attempt ${attempt}:`, error);
            // Don't necessarily stop polling on network errors, retry
        }

        // Wait before next poll
        if (attempt < MAX_POLLING_ATTEMPTS) {
            await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL));
        }
    }

    throw new Error("Analysis timed out or failed after multiple attempts.");
}

// --- Utility Functions ---
function displayError(message) {
    console.error(message);
    messageArea.textContent = `ERROR: ${message}`;
    messageArea.style.color = '#a94442'; // Error color
    proceedBtn.disabled = true;
    proceedBtn.textContent = "Error Occurred";
}