// background.js - Updated with Hume AI Chatbot Confirmations

let stream = null; // To keep track of the camera stream
let settings = {}; // To store loaded settings

// --- Settings Management ---

function loadSettings() {
    chrome.storage.sync.get({
        humeApiKey: '',
        distressThreshold: 0.6,
        angerThreshold: 0.5
    }, (items) => {
        settings = items;
        console.log("Settings loaded:", settings);
        if (!settings.humeApiKey) {
            console.warn("Hume AI API Key is not set. Please configure it in the extension options.");
        }
    });
}

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync') {
        console.log("Settings changed, reloading...");
        loadSettings();
    }
});

// --- Camera Capture ---

async function captureFrameAsBlob() {
    console.log("Attempting to capture frame as Blob...");
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.error("getUserMedia not supported on this browser.");
        throw new Error("Webcam access not supported.");
    }

    let videoTrack;
    try {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
        videoTrack = stream.getVideoTracks()[0];
        const imageCapture = new ImageCapture(videoTrack);
        const frame = await imageCapture.grabFrame();
        videoTrack.stop();
        stream = null;

        const canvas = new OffscreenCanvas(frame.width, frame.height);
        const ctx = canvas.getContext('bitmaprenderer') || canvas.getContext('2d');
         if (ctx && ctx.transferFromImageBitmap) {
             ctx.transferFromImageBitmap(frame);
        } else {
             ctx.drawImage(frame, 0, 0);
        }
        frame.close();

        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
        console.log(`Captured frame as Blob: ${blob.size} bytes, type: ${blob.type}`);
        return blob;

    } catch (error) {
        console.error("Error accessing webcam or capturing frame:", error);
        if (videoTrack) videoTrack.stop();
        if (stream) stream.getTracks().forEach(track => track.stop());
        stream = null;
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
             throw new Error("Webcam permission denied.");
        } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
             throw new Error("No webcam found.");
        } else {
             throw new Error(`Webcam access error: ${error.message}`);
        }
    }
}

// --- Hume AI Batch API Interaction ---

/**
 * Submits the image blob to the Hume AI batch jobs endpoint.
 * Returns the Job ID upon successful submission.
 */
async function startHumeAnalysisJob(imageBlob) {
    console.log("Starting Hume AI analysis job...");
    if (!settings.humeApiKey) {
        console.error("Hume AI API Key is missing.");
        throw new Error("API Key not configured.");
    }
    if (!imageBlob || imageBlob.size === 0) {
         throw new Error("Invalid image blob provided for analysis.");
    }

    const submitUrl = 'https://api.hume.ai/v0/batch/jobs';
    const apiKey = settings.humeApiKey;
    const formData = new FormData();

    // Field name 'file' confirmed by Hume AI assistant.
    formData.append('file', imageBlob, 'webcam_capture.jpg');

    // JSON part specifying the model, confirmed as needed by Hume AI assistant example.
    const modelsRequest = { models: { face: {} } }; // Request facial expression model
    formData.append('json', JSON.stringify(modelsRequest));

    console.log("Submitting job to Hume AI...");
    try {
        const response = await fetch(submitUrl, {
            method: 'POST',
            headers: {
                'X-Hume-Api-Key': apiKey
                // Content-Type is set automatically by fetch for FormData
            },
            body: formData
        });

        const responseBodyText = await response.text();
        if (!response.ok) {
            console.error("Hume AI job submission Error:", response.status, response.statusText, responseBodyText);
            throw new Error(`Hume job submission failed with status ${response.status}. Body: ${responseBodyText}`);
        }

        console.log("Hume AI Job Submission Response Text:", responseBodyText);
        const results = JSON.parse(responseBodyText);

        // Field name 'job_id' confirmed by Hume AI assistant (implicitly by example structure).
        const jobId = results.job_id;

        if (!jobId) {
             console.error("Could not find job_id in Hume response:", results);
             throw new Error("Failed to get Job ID from Hume AI response.");
        }
        console.log("Hume AI Job ID received:", jobId);
        return jobId;

    } catch (error) {
        console.error("Error submitting job to Hume AI API:", error);
        throw error;
    }
}

/**
 * Retrieves the results for a given Hume Job ID by polling the predictions endpoint.
 */
async function getHumeJobResults(jobId) {
    console.log(`Fetching results for Hume Job ID: ${jobId}`);
    if (!settings.humeApiKey) {
        throw new Error("API Key not configured.");
    }
    const apiKey = settings.humeApiKey;

    // Results URL confirmed by Hume AI assistant.
    const resultsUrl = `https://api.hume.ai/v0/batch/jobs/${jobId}/predictions`;

    const initialDelay = 3000; // ms
    const pollingInterval = 2000; // ms
    const maxAttempts = 5; // Number of attempts *after* initial delay

    console.log(`Waiting ${initialDelay}ms before first check...`);
    await new Promise(resolve => setTimeout(resolve, initialDelay));

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        console.log(`Attempt ${attempt} to fetch results for job ${jobId}...`);
        try {
            const response = await fetch(resultsUrl, {
                method: 'GET',
                headers: {
                    'X-Hume-Api-Key': apiKey
                }
            });

            // If response is OK (200), assume job is COMPLETED and results are available.
            if (response.ok) {
                const responseBodyText = await response.text();
                const results = JSON.parse(responseBodyText);
                console.log(`Hume AI Raw Results (Attempt ${attempt}):`, JSON.stringify(results, null, 2));

                // --- PARSE EMOTIONS ---
                // Path confirmed and corrected by Hume AI assistant.
                let emotions = {};
                 try {
                    const emotionDataArray = results[0]?.results?.predictions?.[0]?.models?.face?.grouped_predictions?.[0]?.predictions?.[0]?.emotions;

                    if (emotionDataArray && Array.isArray(emotionDataArray)) {
                         emotionDataArray.forEach(emotion => {
                             emotions[emotion.name] = emotion.score;
                         });
                         console.log("Parsed Emotions:", emotions);
                         // SUCCESS! Return the parsed emotions.
                         return emotions;
                     } else {
                          console.warn("Could not find expected emotion structure in Hume response:", results);
                          throw new Error("Emotion data structure not found in completed job results.");
                     }
                 } catch (parsingError) {
                     console.error("Error parsing emotion data from Hume response:", parsingError, results);
                     throw new Error("Failed to parse emotions from Hume response.");
                 }
                 // Should not reach here if parsing was successful

            } else {
                // Handle non-OK responses during polling
                console.warn(`Hume AI get results attempt ${attempt} failed: ${response.status} ${response.statusText}`);

                // Specific handling could be added here (e.g., check for 424 Failed Dependency, 404 Not Found initially)
                // For now, just treat non-OK as "not ready" and continue polling.
                if (response.status === 429) { // Handle rate limiting explicitly
                      throw new Error("Rate limit hit while fetching results.");
                }

                // Wait before the next attempt if not the last attempt
                if (attempt < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, pollingInterval));
                    // Continue to the next iteration of the loop
                } else {
                     // Throw error if max attempts reached without success
                     const errorBody = await response.text();
                     throw new Error(`Failed to get successful results after ${maxAttempts} attempts. Last status: ${response.status}. Body: ${errorBody}`);
                }
            }

        } catch (error) {
             // Catch fetch errors, JSON parsing errors, or errors thrown from parsing logic
             console.error(`Error during fetch/processing attempt ${attempt} for job ${jobId}:`, error);
              // If it's the last attempt, re-throw the error to signal failure
             if (attempt === maxAttempts) {
                 throw error;
             }
             // Wait before the next attempt (unless it was a specific error we want to fail fast on, like rate limit)
             if (!error.message?.includes("Rate limit")) {
                 await new Promise(resolve => setTimeout(resolve, pollingInterval));
             } else {
                  throw error; // Rethrow rate limit errors immediately
             }
        }
    } // End of polling loop

    // If loop finishes without returning or throwing an error explicitly, it means timeout
    console.error(`Hume job ${jobId} did not return successful predictions within the allowed attempts.`);
    throw new Error(`Analysis timed out for job ${jobId}.`);
}


// --- Message Listener ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "analyzeEmotion") {
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
    }
});

// --- Initialization ---
loadSettings();
console.log("Impulse Blocker background script (Batch API - Confirmed) loaded.");
