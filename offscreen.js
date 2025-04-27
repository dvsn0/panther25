// offscreen.js - Streaming Version

console.log("Offscreen script started.");

// --- State Variables ---
let mediaStream = null;
let videoTrack = null;
let webSocket = null;
let frameIntervalId = null;
let isStreaming = false;
let humeApiKey = null;
let angerThreshold = 0.6; // Default, will be overridden by message
let currentTabId = null; // The tabId associated with the current stream

const WEBSOCKET_URL = "wss://api.hume.ai/v0/stream/models";
const FRAME_INTERVAL_MS = 500; // Send frame every 500ms (adjust as needed)
const CONFIG_WINDOW_MS = 2000; // Hume analysis window (adjust as needed)

// --- Logging (Optional: Use storage logging from previous attempts if console is unreliable) ---
function log(level, message, ...args) {
    if (level === 'error') {
        console.error(`[Offscreen] ${message}`, ...args);
    } else if (level === 'warn') {
         console.warn(`[Offscreen] ${message}`, ...args);
    } else {
         console.log(`[Offscreen] ${message}`, ...args);
    }
    // Add storage logging call here if needed
}
// --- End Logging ---


// --- Message Handling ---
try {
    chrome.runtime.onMessage.addListener(handleMessages);
    log('info', "Message listener attached.");
} catch (e) {
    log('error', "Failed to add message listener!", e);
}

function handleMessages(message, sender, sendResponse) {
    // Only handle messages targeted to offscreen
    if (message?.target !== 'offscreen') {
        return false;
    }

    log('info', `Received message: ${message.type}`);

    switch (message.type) {
        case 'start-streaming':
            if (isStreaming) {
                log('warn', "Already streaming, ignoring start-streaming request.");
                // Optionally send back an error/status?
                return false; // Indicate message handled
            }
            // Start async process, but listener must return sync or true
            startStreamingProcess(message.apiKey, message.threshold, message.tabId)
                .catch(error => {
                    log('error', "Error starting streaming process:", error);
                    // Attempt to notify background about the failure
                    reportErrorToBackground(currentTabId || null, `Failed to start stream: ${error.message}`);
                    stopStreamingProcess(); // Ensure cleanup
                });
            break; // Message handled (async process started)

        case 'stop-streaming':
            stopStreamingProcess();
            break; // Message handled

        default:
            log('warn', `Unexpected message type: ${message.type}`);
            return false; // Indicate message not handled
    }

    // We don't use sendResponse here, so returning false is appropriate
    // even though startStreamingProcess is async. The background doesn't await a response.
    return false;
}
// --- End Message Handling ---


// --- Streaming Core Logic ---
// offscreen.js

// ... (state variables, log function, etc.) ...

async function startStreamingProcess(apiKey, threshold, tabId) {
    // Set currentTabId *immediately*
    currentTabId = tabId; // Store the tabId right away
    log('info', `Attempting to start streaming for tab ${currentTabId}. Threshold: ${threshold}`); // Use variable

    if (!apiKey) {
        // Report error using the now-set currentTabId
        const errMsg = "API Key is required to start streaming.";
        reportErrorToBackground(currentTabId, errMsg);
        throw new Error(errMsg);
    }
    isStreaming = true; // Set flag early
    humeApiKey = apiKey;
    angerThreshold = threshold || 0.6;
    // currentTabId = tabId; // Moved this line higher up

    try {
        // 1. Get Camera Stream
        log('info', "Requesting user media (camera)...");
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error("getUserMedia is not supported in this context.");
        }
        // <<< --- Permission prompt happens here --- >>>
        mediaStream = await navigator.mediaDevices.getUserMedia({ video: true });
        // If it gets here, permission was granted (or previously granted)
        videoTrack = mediaStream.getVideoTracks()[0];
        log('info', "User media obtained successfully.");

        // 2. Establish WebSocket Connection
        // ... (rest of the try block: WebSocket setup) ...
        log('info', `Connecting to WebSocket: ${WEBSOCKET_URL}`);
        webSocket = new WebSocket(WEBSOCKET_URL);
        webSocket.onopen = handleWebSocketOpen;
        webSocket.onmessage = handleWebSocketMessage;
        webSocket.onerror = handleWebSocketError;
        webSocket.onclose = handleWebSocketClose;


    } catch (error) {
        log('error', "Error during streaming setup:", error);
        // Call stopStreamingProcess *before* reporting error
        await stopStreamingProcess();
        // Report error using the tabId captured at the start of the function
        reportErrorToBackground(currentTabId, `Failed to start stream: ${error.message}`);
        // Re-throw to be caught by the caller in handleMessages if needed (though maybe not necessary)
        // throw error; // Let's not re-throw, just report and exit setup
    }
}

function handleWebSocketOpen(event) {
    log('info', "WebSocket connection opened.");
    // 3. Send Configuration
    try {
        const config = {
            apiKey: humeApiKey, // Send API key in config for streaming API
            models: {
                face: {} // Request face model
            },
            stream_window_ms: CONFIG_WINDOW_MS,
             // reset_stream: true // Maybe needed if reconnecting? Check docs.
             // raw_text: false, // Default
             // job_id: 'some-unique-id' // Optional
        };
        log('info', "Sending WebSocket configuration:", config); // Don't log API key in production
        webSocket.send(JSON.stringify(config));

        // 4. Start Sending Frames
        log('info', `Starting frame capture interval (${FRAME_INTERVAL_MS}ms)`);
        // Use requestAnimationFrame for smoother capture tied to rendering loop
        startFrameCaptureLoop(); // Changed from setInterval

    } catch (error) {
        log('error', "Error sending WebSocket config or starting frame loop:", error);
        stopStreamingProcess();
        reportErrorToBackground(currentTabId, `WS Config/Frame Loop Error: ${error.message}`);
    }
}

function handleWebSocketMessage(event) {
    // log('info', "WebSocket message received:", event.data); // Can be very noisy
    try {
        const data = JSON.parse(event.data);

        // Check for Hume-reported errors in the message
        if (data.error) {
            log('error', "Hume API Error via WebSocket:", data.error, data.code);
            // Stop streaming on critical errors? Depends on error type. Check Hume error docs.
            // Example: Stop on auth errors
            if (data.code === 401 || data.code === 1015) {
                 reportErrorToBackground(currentTabId, `Hume API Error: ${data.error} (Code: ${data.code})`);
                 stopStreamingProcess();
            }
            return; // Don't process predictions if there's an error
        }

        // Check for face model predictions
        const facePrediction = data.face?.predictions?.[0]; // Assuming single face
        if (facePrediction?.emotions) {
            // Find Anger score
            const angerScore = facePrediction.emotions.find(e => e.name === 'Anger')?.score;
            // log('info', `Anger Score: ${angerScore?.toFixed(3)} (Threshold: ${angerThreshold})`); // Noisy

            if (angerScore !== undefined && angerScore >= angerThreshold) {
                log('warn', `ANGER THRESHOLD MET! Score: ${angerScore}, Threshold: ${angerThreshold}`);
                // Send message to background IMMEDIATELY
                 reportThresholdToBackground(currentTabId);
                // Stop streaming AFTER notifying background
                stopStreamingProcess();
            }
        }
    } catch (error) {
        log('error', "Error parsing WebSocket message:", error, event.data);
        // Continue listening, maybe just a single corrupt message
    }
}

function handleWebSocketError(event) {
    log('error', "WebSocket error observed:", event);
    // Attempt to report error before cleanup
    reportErrorToBackground(currentTabId, `WebSocket Error: ${event.type || 'Unknown WS error'}`);
    stopStreamingProcess(); // Clean up on any WebSocket error
}

function handleWebSocketClose(event) {
    log('warn', `WebSocket connection closed. Code: ${event.code}, Reason: ${event.reason}, Clean: ${event.wasClean}`);
    // Attempt to report closure before cleanup
    if (!event.wasClean) {
         reportErrorToBackground(currentTabId, `WebSocket closed unexpectedly (Code: ${event.code})`);
    }
    stopStreamingProcess(); // Ensure cleanup, even if initiated elsewhere
}

// --- Frame Capture and Sending ---
let videoElement = null; // Use a hidden video element for reliable frame capture
let canvasElement = null;
let canvasCtx = null;
let rafId = null; // requestAnimationFrame ID

function startFrameCaptureLoop() {
    if (!videoElement) {
        videoElement = document.createElement('video');
        videoElement.autoplay = true;
        videoElement.muted = true; // Important to avoid audio feedback
        // document.body.appendChild(videoElement); // Keep it off-screen / hidden
    }
    if (!canvasElement) {
        canvasElement = document.createElement('canvas');
        // Canvas dimensions will be set once video metadata loads
        canvasCtx = canvasElement.getContext('2d', { willReadFrequently: true }); // Optimize for readback
    }

    videoElement.srcObject = mediaStream;
    videoElement.onloadedmetadata = () => {
        log('info', `Video dimensions: ${videoElement.videoWidth}x${videoElement.videoHeight}`);
        canvasElement.width = videoElement.videoWidth;
        canvasElement.height = videoElement.videoHeight;
        // Start the animation frame loop
        rafId = requestAnimationFrame(captureAndSendFrame);
    };
     videoElement.onerror = (e) => {
         log('error', 'Error loading video element srcObject:', e);
         stopStreamingProcess();
         reportErrorToBackground(currentTabId, 'Video element error');
     }
}

async function captureAndSendFrame() {
    // Check if streaming should continue
    if (!isStreaming || !webSocket || webSocket.readyState !== WebSocket.OPEN || !canvasCtx) {
        log('warn', "Stopping frame capture loop: streaming stopped or WebSocket not open.");
        cancelAnimationFrame(rafId);
        rafId = null;
        return;
    }

    try {
        // Draw current video frame to canvas
        canvasCtx.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);

        // Get Base64 data from canvas
        const base64ImageData = canvasElement.toDataURL('image/jpeg', 0.8).split(',')[1]; // Quality 0.8

        // Send data over WebSocket
        if (webSocket.readyState === WebSocket.OPEN) {
             const payload = {
                 data: base64ImageData,
                 models: { face: {} } // Resend models with data as per some Hume examples
                 // payload_id: Date.now().toString() // Optional payload ID
             };
             // log('info', "Sending frame over WebSocket..."); // Noisy
             webSocket.send(JSON.stringify(payload));
        }

        // Schedule next frame capture after interval
        // Using setTimeout within rAF ensures minimum interval between sends
         setTimeout(() => {
            rafId = requestAnimationFrame(captureAndSendFrame);
         }, FRAME_INTERVAL_MS);


    } catch (error) {
        log('error', "Error capturing or sending frame:", error);
        // Continue loop? Or stop on error? Let's stop for now.
        stopStreamingProcess();
        reportErrorToBackground(currentTabId, `Frame Capture/Send Error: ${error.message}`);

    }
}
// --- End Frame Capture and Sending ---


// --- Cleanup ---
async function stopStreamingProcess() {
    const tabIdWhenStopping = currentTabId; // Capture tabId before resetting state
    log('warn', `Stopping streaming process for tab ${tabIdWhenStopping}...`);
    if (!isStreaming && !webSocket && !mediaStream) {
         log('info', "Streaming already stopped.");
         return; // Avoid redundant cleanup
    }
    isStreaming = false; // Set flag immediately

     // Cancel frame capture loop
     if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
     }
     if (frameIntervalId) { // Clear old interval ID if it was used
        clearInterval(frameIntervalId);
        frameIntervalId = null;
     }


    // Close WebSocket
    if (webSocket) {
        log('info', "Closing WebSocket.");
        // Remove listeners to prevent triggering close handler again
        webSocket.onopen = null;
        webSocket.onmessage = null;
        webSocket.onerror = null;
        webSocket.onclose = null;
        if (webSocket.readyState === WebSocket.OPEN || webSocket.readyState === WebSocket.CONNECTING) {
             webSocket.close(1000, "Client stopping stream"); // Normal closure
        }
        webSocket = null;
    }

    // Stop Camera Tracks
    log('info', "Stopping media stream tracks.");
    if (videoTrack) {
        videoTrack.stop();
        videoTrack = null;
    }
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }
    // Clean up video element
    if (videoElement) {
         videoElement.srcObject = null;
         // videoElement.remove(); // Remove from DOM if it was added
         videoElement = null;
    }
     if (canvasElement) {
         canvasElement = null;
         canvasCtx = null;
     }


    // Reset state variables
    humeApiKey = null;
    currentTabId = null; // Reset associated tab

    log('warn', `Streaming process stopped and resources released for tab ${tabIdWhenStopping}.`);
}
// --- End Cleanup ---

// --- Communication Back to Background ---
function reportErrorToBackground(tabIdForError, errorMessage) {
    // Use the passed tabId, which should be the one from when start was called
    const idToReport = tabIdForError !== null ? tabIdForError : 'UNKNOWN';
    log('error', `Reporting error to background for tab ${idToReport}: ${errorMessage}`);
     try {
         chrome.runtime.sendMessage({
             action: "streamError",
             error: errorMessage,
             tabId: tabIdForError // Send original tabId, even if null
         });
     } catch (e) {
         log('error', "Failed to send streamError message to background:", e);
     }
}

function reportThresholdToBackground(tabId) {
     log('warn', `Reporting threshold met to background for tab ${tabId}`);
     try {
         chrome.runtime.sendMessage({
             action: "streamThresholdMet",
             tabId: tabId // Include tabId
         });
     } catch (e) {
         log('error', "Failed to send streamThresholdMet message to background:", e);
     }
}
// --- End Communication Back to Background ---


log('info', "Offscreen script fully loaded and ready.");

// Keep alive for message listeners
// (The offscreen document stays alive as long as there's an active stream or WebSocket,
// or if the background script keeps it open intentionally)