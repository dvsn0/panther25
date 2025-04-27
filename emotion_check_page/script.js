// script.js - Localhost Page Logic (v5.1 - Batch API + Loop Fix + Log location.search)

// --- DOM Elements ---
const videoElement = document.getElementById('video');
const canvasElement = document.getElementById('canvas');
const proceedBtn = document.getElementById('proceedBtn');
const messageArea = document.getElementById('messageArea');

// --- State Variables ---
const EXTENSION_ID = "icnpacdhailligjalpebhhmhfekmffkp"; // <<<--- MAKE SURE THIS IS YOUR EXTENSION ID
let mediaStream = null;
let humeApiKey = null;
let thresholds = { Anger: 0.6, Distress: 0.6 };
let originalUrl = null;
let currentTabId = null;
let isProcessingClick = false;

// --- Constants ---
const HUME_SUBMIT_URL = 'https://api.hume.ai/v0/batch/jobs';
const POLLING_INTERVAL = 2000; // ms
const MAX_POLLING_ATTEMPTS = 10;

// --- Logging ---
function log(level, message, ...args) {
    const prefix = `[Localhost ${new Date().toLocaleTimeString()}]`;
    if (level === 'error') { console.error(prefix, message, ...args); }
    else { console.log(prefix, message, ...args); }
}
log('info', "Script loaded (v5.1 - Log location.search). Initializing...");

// --- Initialization ---
window.onload = async () => {
    log('info', "window.onload triggered.");

    // <<< --- ADDED LOG --- >>>
    log('info', `Current window.location.search: '${window.location.search}'`);
    // <<< --- END ADDED LOG --- >>>

    setButtonState("Initializing...", true);
    messageArea.textContent = "Initializing...";
    messageArea.className = '';

    try {
        // Get params (including tabId)
        const urlParams = new URLSearchParams(window.location.search); // Use the logged search string
        const encodedUrl = urlParams.get('originalUrl');
        const tabIdParam = urlParams.get('tabId');
        if (!encodedUrl || !tabIdParam) {
             // Log the params object to see what was actually found
             log('error', "URL Parameters found:", Object.fromEntries(urlParams.entries()));
             throw new Error("Missing 'originalUrl' or 'tabId' in query parameters.");
        }
        originalUrl = decodeURIComponent(encodedUrl);
        currentTabId = parseInt(tabIdParam, 10);
        if (isNaN(currentTabId)) throw new Error("Invalid Tab ID received.");
        log('info', "Decoded URL:", originalUrl, "Parsed Tab ID:", currentTabId);

        // Fetch config
        messageArea.textContent = "Fetching config...";
        const config = await getConfigFromExtension();
        humeApiKey = config.apiKey; thresholds = config.thresholds;
        log('info', "Config received:", { apiKey: '******', thresholds });
        if (!humeApiKey) throw new Error("API Key missing.");
        messageArea.textContent = "Config loaded.";

        // Request camera permission
        messageArea.textContent = "Requesting camera access...";
        await requestCameraPermission();
        messageArea.textContent = "Camera access granted. Click Proceed to analyze.";
        setButtonState("Proceed", false); // Enable button

    } catch (err) {
        log('error', `Initialization failed: ${err.message}`);
        displayError(`Initialization Error: ${err.message}`);
    }
};

// --- Communication with Extension ---
function getConfigFromExtension() {
    log('info', `Connecting to extension ID: ${EXTENSION_ID}`);
    if (!chrome?.runtime?.sendMessage) return Promise.reject(new Error("Extension context not found."));
    log('info', 'Calling chrome.runtime.sendMessage for config...');
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage( EXTENSION_ID, { action: "getHumeApiKey" }, (response) => {
            if (chrome.runtime.lastError) { log('error',`GetConfig CB Error: ${chrome.runtime.lastError.message}`); return reject(new Error(`Connect Error: ${chrome.runtime.lastError.message}`)); }
            log('info', 'GetConfig CB Response:', response);
            if (response?.success) { log('info', 'GetConfig CB Success.'); resolve({ apiKey: response.apiKey, thresholds: response.thresholds }); }
            else { log('error',`GetConfig CB Failed: ${response?.error}`); reject(new Error(response?.error || "Failed get config.")); }
        });
        log('info', 'chrome.runtime.sendMessage for config initiated.');
        setTimeout(() => { log('warn', 'GetConfig Timeout.'); reject(new Error("Timeout waiting extension config.")); }, 9000);
    });
}

function markTabAsSafeInExtension() {
    log('info', `Marking tab ${currentTabId} as safe...`);
    return new Promise((resolve, reject) => {
        if (!chrome?.runtime?.sendMessage || !currentTabId) { log('error',"Ctx/TabID missing for markSafe"); return reject(new Error("Ctx/TabID missing.")); }
        chrome.runtime.sendMessage( EXTENSION_ID, { action: "markTabAsSafe", tabId: currentTabId }, (response) => {
            if (chrome.runtime.lastError) { log('error',`MarkSafe CB Error: ${chrome.runtime.lastError.message}`); return reject(new Error(`Message Error: ${chrome.runtime.lastError.message}`)); }
            if (response?.success) { log('info','MarkSafe CB Success.'); resolve(); }
            else { log('error',`MarkSafe CB Failed: ${response?.error}`); reject(new Error(response?.error || "Ext failed mark safe.")); }
        });
        setTimeout(() => { log('warn','MarkSafe Timeout.'); reject(new Error("Timeout waiting mark safe ack.")); }, 3000);
    });
}

// --- Camera Handling ---
async function requestCameraPermission() { /* ... Keep same as Response #31 ... */
    log('info',"Requesting camera permission..."); if (!navigator.mediaDevices?.getUserMedia) throw new Error("getUserMedia not supported."); let stream = null; try { stream = await navigator.mediaDevices.getUserMedia({ video: true }); log('info',"Permission granted."); stream.getTracks().forEach(track => track.stop()); log('info',"Temp stream stopped."); } catch (error) { log('error',"Error requesting permission:", error.name, error.message); let msg = `Cam Err: ${error.message}`; /* ... set specific messages ... */ displayError(msg); throw error; }
}
async function captureFrameAsBlob() { /* ... Keep same as Response #31 ... */
    log('info',"Starting temp cam stream for capture..."); if (!navigator.mediaDevices?.getUserMedia) throw new Error("getUserMedia not supported."); let stream = null; try { stream = await navigator.mediaDevices.getUserMedia({ video: true }); log('info',"Temp stream obtained."); videoElement.srcObject = stream; await videoElement.play(); await new Promise((resolve, reject) => { videoElement.onloadedmetadata = () => { /* set canvas size */ resolve(true); }; videoElement.onerror = reject; setTimeout(()=>reject(new Error("Timeout video metadata")), 3000); }); const ctx = canvasElement.getContext('2d'); ctx.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height); const blob = await new Promise((resolve, reject) => { canvasElement.toBlob(blob => { if(blob) resolve(blob); else reject(new Error("toBlob failed.")); }, 'image/jpeg', 0.9); }); log('info',`Frame captured, size: ${blob.size}`); return blob; } catch (error) { log('error',"Err during capture:", error); throw new Error(`Capture fail: ${error.message}`); } finally { if (stream) { stream.getTracks().forEach(track => track.stop()); log('info',"Temp capture stream stopped."); } if (videoElement) videoElement.srcObject = null; }
}

// --- Button Click Logic ---
proceedBtn.addEventListener('click', async () => { /* ... Keep same as Response #31 ... */
    if (isProcessingClick) return; isProcessingClick = true; setButtonState("Analyzing...", true); messageArea.textContent = "Capturing..."; messageArea.className = ''; try { const imageBlob = await captureFrameAsBlob(); messageArea.textContent = "Analyzing..."; const emotions = await analyzeWithHume(imageBlob); log('info',"Analysis complete:", emotions); const angerScore = emotions['Anger'] || 0; const distressScore = emotions['Distress'] || 0; const angerThreshold = thresholds?.Anger || 0.6; const distressThreshold = thresholds?.Distress || 0.6; log('info',`Scores - A: ${angerScore.toFixed(4)}, D: ${distressScore.toFixed(4)}`); if (angerScore >= angerThreshold || distressScore >= distressThreshold) { log('warn',"Threshold met."); displayError(`High ${angerScore >= angerThreshold ? 'Anger' : 'Distress'}. Purchase blocked.`, false); setButtonState("Action Blocked", true); } else { log('info',"Threshold OK."); messageArea.textContent = "Proceeding..."; setButtonState("Redirecting...", true); await markTabAsSafeInExtension(); log('info',"Redirecting to:", originalUrl); window.location.href = originalUrl; } } catch (err) { log('error',"Proceed button error:", err); displayError(`Processing Error: ${err.message}`, true); } finally { if (proceedBtn.textContent === "Retry Proceed") { isProcessingClick = false; } }
});

// --- Hume AI Interaction (Batch API) ---
async function analyzeWithHume(imageBlob) { /* ... Keep same as Response #31 ... */
     if (!humeApiKey) throw new Error("API Key missing."); if (!imageBlob) throw new Error("Image Blob missing.");
     const jobId = await startHumeAnalysisJob(imageBlob); log('info',"Job ID:", jobId); messageArea.textContent = `Analysis submitted...`;
     const emotions = await getHumeJobResults(jobId); return emotions;
}
async function startHumeAnalysisJob(imageBlob) { /* ... Keep same as Response #31 ... */
    const formData = new FormData(); formData.append('file', imageBlob, 'capture.jpg'); formData.append('json', JSON.stringify({ models: { face: {} } }));
    log('info',"Submitting batch job..."); const response = await fetch(HUME_SUBMIT_URL, { method: 'POST', headers: { 'X-Hume-Api-Key': humeApiKey }, body: formData });
    const txt = await response.text(); if (!response.ok) { throw new Error(`Hume submit failed (${response.status}): ${txt}`); }
    const res = JSON.parse(txt); if (!res.job_id) throw new Error("No Job ID from Hume."); return res.job_id;
}
async function getHumeJobResults(jobId) { /* ... Keep same as Response #31 ... */
     const resultsUrl = `https://api.hume.ai/v0/batch/jobs/${jobId}/predictions`; log('info',`Polling: ${resultsUrl}`); let lastError = null;
     for (let attempt = 1; attempt <= MAX_POLLING_ATTEMPTS; attempt++) { log('info',`Polling attempt ${attempt}...`); messageArea.textContent = `Checking results (${attempt}/${MAX_POLLING_ATTEMPTS})...`; await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL)); try { const response = await fetch(resultsUrl, { method: 'GET', headers: { 'X-Hume-Api-Key': humeApiKey } }); if (response.ok) { const results = await response.json(); log('info',"Hume Raw Results:", results); const emotionDataArray = results?.[0]?.results?.predictions?.[0]?.models?.face?.grouped_predictions?.[0]?.predictions?.[0]?.emotions; if (emotionDataArray?.length > 0) { let eMap = {}; emotionDataArray.forEach(e => { eMap[e.name] = e.score; }); messageArea.textContent = "Analysis complete."; return eMap; } else { log('warn',"Job completed but no emotions found."); messageArea.textContent = "No face/emotions detected."; return {}; } } else if (response.status === 429) { throw new Error("Hume API rate limit."); } else { log('warn', `Polling attempt ${attempt} failed: ${response.status}`); lastError = `HTTP ${response.status}`; } } catch (error) { log('error', `Polling attempt ${attempt} error:`, error); lastError = error.message; } }
     throw new Error(`Analysis timed out. Last status/error: ${lastError || 'Unknown'}`);
}

// --- Utility Functions ---
function displayError(message, allowRetry = false) { /* ... Keep same as Response #31 ... */
    log('error', `Displaying Error: ${message}`); messageArea.textContent = `ERROR: ${message}`; messageArea.className = 'error'; setButtonState(allowRetry ? "Retry Proceed" : "Error Occurred", !allowRetry); isProcessingClick = !allowRetry;
}
function setButtonState(text, disabled) { /* ... Keep same as Response #31 ... */
    if (proceedBtn) { proceedBtn.textContent = text; proceedBtn.disabled = disabled; }
}

// --- Initial Check ---
if (!EXTENSION_ID || EXTENSION_ID === "YOUR_EXTENSION_ID") { displayError("CRITICAL: Extension ID not set!", false); }
else { log('info', `Using Extension ID: ${EXTENSION_ID}`); }

log('info', "Script (v5.1) finished parsing.");