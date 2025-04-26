// background.js

let stream = null; // To keep track of the camera stream
let settings = {}; // To store loaded settings
let analysisSocket = null; // To hold the WebSocket connection

// Load settings on startup
function loadSettings() {
    chrome.storage.sync.get({
        humeApiKey: '',
        distressThreshold: 0.6,
        angerThreshold: 0.5
        // Load other defaults
    }, (items) => {
        settings = items;
        console.log("Settings loaded:", settings);
        if (!settings.humeApiKey) {
            console.warn("Hume AI API Key is not set. Please configure it in the extension options.");
        }
    });
}

// Listen for changes in storage
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync') {
        console.log("Settings changed, reloading...");
        loadSettings();
        // If a socket is active, maybe close it or handle the change?
        if (analysisSocket && analysisSocket.readyState === WebSocket.OPEN) {
             console.log("Settings changed, closing existing WebSocket connection.");
             analysisSocket.close();
             analysisSocket = null;
        }
    }
});

// Function to capture a frame from the webcam (Same as before)
async function captureFrame() {
    console.log("Attempting to capture frame...");
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.error("getUserMedia not supported on this browser.");
        throw new Error("Webcam access not supported.");
    }
    try {
        if (stream) { stream.getTracks().forEach(track => track.stop()); }
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
        const videoTrack = stream.getVideoTracks()[0];
        const imageCapture = new ImageCapture(videoTrack);
        const frame = await imageCapture.grabFrame();
        videoTrack.stop();
        stream = null;

        const canvas = new OffscreenCanvas(frame.width, frame.height);
        // Use bitmaprenderer if available, fallback to 2d
        let ctx = canvas.getContext('bitmaprenderer');
        if (ctx) {
            ctx.transferFromImageBitmap(frame);
        } else {
            canvas.getContext('2d').drawImage(frame, 0, 0);
        }
        frame.close(); // Close the ImageBitmap to release resources

        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result.split(',')[1]); // Get Base64 part
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        console.error("Error accessing webcam or capturing frame:", error);
        if (stream) { stream.getTracks().forEach(track => track.stop()); stream = null; }
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') { throw new Error("Webcam permission denied."); }
        else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') { throw new Error("No webcam found."); }
        else { throw new Error(`Webcam access error: ${error.message}`); }
    }
}

// Function to call Hume AI WebSocket API
function analyzeWithHumeWebSocket(base64Image) {
    console.log("Analyzing frame with Hume AI WebSocket...");
    return new Promise((resolve, reject) => {
        if (!settings.humeApiKey) {
            console.error("Hume AI API Key is missing.");
            return reject(new Error("API Key not configured."));
        }
        if (analysisSocket && analysisSocket.readyState === WebSocket.OPEN) {
             console.warn("WebSocket is already open. Closing previous connection before starting new one.");
             // Close the previous socket silently or based on a specific state
             analysisSocket.close(1000, "Starting new analysis"); // 1000 is normal closure
             analysisSocket = null;
        }


        const apiKey = settings.humeApiKey;
        // Correct WebSocket URL structure based on Hume docs
        const wsUrl = `wss://api.hume.ai/v0/stream/models?apiKey=${apiKey}`;

        console.log(`Connecting to WebSocket: ${wsUrl.split('?')[0]}...`); // Don't log key
        analysisSocket = new WebSocket(wsUrl);

        let resultsReceived = false; // Flag to ensure resolve/reject happens only once
        let timeoutId = null;

        // Set a timeout for the entire operation
        const operationTimeout = 15000; // 15 seconds
        timeoutId = setTimeout(() => {
            if (resultsReceived) return; // Already handled
            console.error(`Hume WebSocket analysis timed out after ${operationTimeout / 1000} seconds.`);
            if (analysisSocket) {
                analysisSocket.close(1001, "Timeout"); // 1001 indicates endpoint going away
            }
            analysisSocket = null; // Clear the reference
            reject(new Error("Analysis timed out."));
        }, operationTimeout);

        analysisSocket.onopen = (event) => {
            console.log("WebSocket connection opened.");
            try {
                // 1. Send configuration message first
                const configMsg = {
                    // Request the face model. Optional: add configuration like `fps_pred` if needed.
                    models: {
                        face: {} // Using default face model settings
                    },
                    // Optional: Specify stream_window_ms if needed, otherwise Hume might use a default.
                    // For single frame, maybe not necessary or set low. Let's omit for now.
                    // "stream_window_ms": 500
                };
                console.log("Sending configuration message:", JSON.stringify(configMsg));
                analysisSocket.send(JSON.stringify(configMsg));

                // 2. Send the image data
                // Documentation suggests sending data within a JSON structure
                const dataMsg = {
                    data: base64Image, // Base64 encoded image string
                    // type: "image_input" // Type might be inferred or needed, check docs if issues arise
                };
                 console.log("Sending image data message (first few chars):", base64Image.substring(0, 20) + "...");
                 analysisSocket.send(JSON.stringify(dataMsg));

            } catch (error) {
                 console.error("Error sending initial messages:", error);
                 clearTimeout(timeoutId); // Clear timeout
                 if (!resultsReceived) {
                      resultsReceived = true;
                      reject(new Error(`Failed to send data via WebSocket: ${error.message}`));
                 }
                 if (analysisSocket) analysisSocket.close(); // Close on error
                 analysisSocket = null;
            }
        };

        analysisSocket.onmessage = (event) => {
            console.log("WebSocket message received.");
            clearTimeout(timeoutId); // Clear timeout on receiving a message

            if (resultsReceived) {
                 console.log("Already processed results, ignoring further messages.");
                 return;
            }

            try {
                const message = JSON.parse(event.data);
                 console.log("Parsed message:", JSON.stringify(message, null, 2)); // Log the full structure

                // Check for Hume-defined errors first
                if (message.error) {
                    console.error("Hume API returned an error:", message.error);
                    resultsReceived = true;
                    reject(new Error(`Hume API error: ${message.error}`));
                    if (analysisSocket) analysisSocket.close();
                    analysisSocket = null;
                    return;
                }

                // Check for the face model predictions
                // Based on docs, structure is likely within message.face.predictions
                if (message.face && message.face.predictions && message.face.predictions.length > 0) {
                    // Assuming we care about the emotions from the first prediction in the array for this single frame
                    const emotionsData = message.face.predictions[0].emotions;

                    if (emotionsData && Array.isArray(emotionsData)) {
                        const emotionsMap = {};
                        emotionsData.forEach(emotion => {
                            emotionsMap[emotion.name] = emotion.score;
                        });
                        console.log("Parsed Emotions:", emotionsMap);
                        resultsReceived = true;
                        resolve(emotionsMap); // Resolve the promise with the parsed emotions
                        if (analysisSocket) analysisSocket.close(1000, "Analysis complete"); // Normal closure
                        analysisSocket = null;
                    } else {
                         console.warn("No emotions array found in the face prediction message.");
                         // Don't reject yet, maybe another message will contain it? Or handle as error?
                         // For single frame analysis, treat missing emotions here as an issue.
                         resultsReceived = true;
                         reject(new Error("Received face prediction but no valid emotion data."));
                         if (analysisSocket) analysisSocket.close();
                         analysisSocket = null;
                    }
                } else {
                    console.log("Received message without face prediction data, ignoring:", message);
                    // Could be other message types, like warnings or metadata.
                    // Reset the timeout if we expect more messages, but for single frame,
                    // we expect the result quickly. If it wasn't the result, something is wrong.
                    // Let's assume any message without the expected result after sending data is an issue.
                    // However, it might be safer to just wait for timeout if no error/result is received.
                    // Let's reset the timeout to give it a bit more time IF no error was present.
                     if (!message.error) {
                         timeoutId = setTimeout(() => { /* Same timeout logic */ }, operationTimeout);
                     }

                }

            } catch (error) {
                console.error("Error processing WebSocket message:", error);
                clearTimeout(timeoutId); // Clear timeout
                if (!resultsReceived) {
                     resultsReceived = true;
                     reject(new Error(`Failed to process message: ${error.message}`));
                }
                if (analysisSocket) analysisSocket.close(); // Close on error
                analysisSocket = null;
            }
        };

        analysisSocket.onerror = (error) => {
            clearTimeout(timeoutId); // Clear timeout
            console.error("WebSocket error observed:", error);
            if (!resultsReceived) {
                 resultsReceived = true;
                 // The 'error' event doesn't contain much detail, the reason is often in the 'close' event
                 reject(new Error("WebSocket connection error."));
            }
             analysisSocket = null; // Clear the reference after error
        };

        analysisSocket.onclose = (event) => {
            clearTimeout(timeoutId); // Clear timeout
            console.log(`WebSocket closed. Code: ${event.code}, Reason: ${event.reason}, Clean: ${event.wasClean}`);
            if (!resultsReceived) {
                 // If closed unexpectedly before results were received
                 resultsReceived = true;
                 reject(new Error(`WebSocket closed unexpectedly. Code: ${event.code}, Reason: ${event.reason || 'No reason given'}`));
            }
             analysisSocket = null; // Clear the reference when closed
        };
    });
}


// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "analyzeEmotion") {
        console.log("Received analyzeEmotion request from tab:", sender.tab.id);

        (async () => {
            try {
                const base64Image = await captureFrame();
                // Use the WebSocket function now
                const emotions = await analyzeWithHumeWebSocket(base64Image);

                // Check thresholds (Same logic as before)
                const distressScore = emotions['Distress'] || 0;
                const angerScore = emotions['Anger'] || 0;

                let showPopup = false;
                if (distressScore >= (settings.distressThreshold || 0.6) ||
                    angerScore >= (settings.angerThreshold || 0.5)) {
                    showPopup = true;
                    console.log(`Threshold exceeded: Distress=${distressScore}, Anger=${angerScore}`);
                } else {
                    console.log(`Emotion levels OK: Distress=${distressScore}, Anger=${angerScore}`);
                }

                sendResponse({ action: "emotionResult", success: true, showPopup: showPopup });

            } catch (error) {
                console.error("Analysis failed:", error);
                sendResponse({ action: "emotionResult", success: false, error: error.message, showPopup: false });
            }
        })();

        return true; // Indicate that the response will be sent asynchronously
    }
});

// Initial load of settings when the background script starts
loadSettings();
console.log("Impulse Blocker background script loaded (WebSocket version).");