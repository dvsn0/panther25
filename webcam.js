// --- webcam.js ---
// Purpose: Connects user's webcam to the video element in webcam.html

async function startWebcam() {
    const video = document.getElementById('webcamVideo');
    if (!video) {
        console.error("Webcam video element not found.");
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        video.srcObject = stream;
    } catch (error) {
        console.error("Error accessing webcam:", error);
        alert("Unable to access webcam. Please check your permissions and refresh the page.");
    }
}

// Start webcam once the page is loaded
document.addEventListener('DOMContentLoaded', startWebcam);