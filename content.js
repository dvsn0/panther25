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
    '#buy-now-button',                // Amazon's main Buy Now button ID
    'input[name="submit.buy-now"]',   // Another possible Amazon Buy Now input
    '#one-click-button',              // One-click purchase button
    '#proceed-to-checkout-button',    // Added selector for Proceed to Checkout button
    'input[name="proceedToRetailCheckout"]'  // Another possible selector for Proceed to Checkout
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
        console.log("Button clicked:", targetButton);
        clickedButton = targetButton;

        // Prevent the default click action immediately
        event.preventDefault();
        event.stopPropagation();

        // Show the impulse purchase popup
        showImpulsePopup(
            () => {
                console.log("User chose to proceed.");
                proceedWithPurchase();
            },
            () => {
                console.log("User cancelled the purchase.");
                // Replace alert with showMessagePopup
                showMessagePopup("We'll give you another moment to rethink your purchase.", () => {
                    console.log("User acknowledged the message.");
                });
            }
        );
    }
}, true); // Use capture phase to intercept click early

// Listen for background messages (future expansion)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Message received in content script:", message);
    // Future handlers here
});
    // Handle other messages if needed
    

function showImpulsePopup(onConfirm, onCancel) {
    // 1) Remove existing popup if any
    const old = document.getElementById('impulse-popup');
    if (old) old.remove();
  
    // 2) Create the dialog container
    const dialog = document.createElement('div');
    dialog.id = 'impulse-popup';
    Object.assign(dialog.style, {
      position:       'fixed',
      top:            '50%',
      left:           '50%',
      transform:      'translate(-50%, -50%)',
      background:     'linear-gradient(to bottom, #19364d, #6b88a7)',
      borderRadius:   '10px',
      padding:        '30px',
      boxShadow:      '0 4px 12px rgba(0,0,0,0.2)',
      maxWidth:       '300px',
      width:          '90%',
      textAlign:      'center',
      fontFamily:    'Cabin, sans-serif',
      color:          '#FEFAF3',
      display:        'flex',
      flexDirection:  'column',
      gap:            '20px',
      zIndex:         '9999',
    });
  
    // 3) Inject HTML for your text + buttons
    dialog.innerHTML = `
      <h2>Impulse Purchase Check</h2>
      <p>Are you sure this isn't an impulse buy?</p>
      <div style="display:flex; flex-direction: column; gap: 10px;">
        <button id="impulse-proceed" style="
          padding: 12px 0;
          border-radius: 50px;
          background: linear-gradient(to bottom, #6A99B0, #8FAAC3);
          border: none;
          cursor: pointer;
          font-size: 16px;
          color: #FEFAF3;
          transition: background 0.3s, transform 0.2s ease-in-out;
          fontFamily:    'Cabin, sans-serif',
        ">Yes</button>
        <button id="impulse-cancel" style="
          padding: 12px 0;
          border-radius: 50px;
          background: linear-gradient(to bottom, #6A99B0, #8FAAC3);
          border: none;
          cursor: pointer;
          font-size: 16px;
          color: #FEFAF3;
          transition: background 0.3s, transform 0.2s ease-in-out;
          fontFamily:    'Cabin, sans-serif',
        ">No</button>
      </div>
    `;
  
    document.body.appendChild(dialog);
  
    // 4) Grab references
    const btnYes = document.getElementById('impulse-proceed');
    const btnNo  = document.getElementById('impulse-cancel');
  
    // 5) Yes handler
    btnYes.onclick = () => {
      dialog.remove();
      onConfirm();
    };
  
    // 6) No handler (with counter bump)
    btnNo.onclick = () => {
      dialog.remove();
      chrome.storage.sync.get({ blockedCount: 0 }, ({ blockedCount }) => {
        chrome.storage.sync.set({ blockedCount: blockedCount + 1 });
      });
      onCancel();
    };
  
    // 7) Hover effects (swap gradient & scale)
    const addHover = (btn) => {
      btn.addEventListener('mouseover', () => {
        btn.style.background  = 'linear-gradient(to bottom, #8FAAC3, #6A99B0)';
        btn.style.transform   = 'scale(1.05)';
      });
      btn.addEventListener('mouseout', () => {
        btn.style.background  = 'linear-gradient(to bottom, #6A99B0, #8FAAC3)';
        btn.style.transform   = 'scale(1)';
      });
    };
    addHover(btnYes);
    addHover(btnNo);
  }

  function showMessagePopup(message, onConfirm) {
    // 1) Remove any existing message popup
    const old = document.getElementById('message-popup');
    if (old) old.remove();
  
    // 2) Create the dialog container
    const dialog = document.createElement('div');
    dialog.id = 'message-popup';
    Object.assign(dialog.style, {
      position:       'fixed',
      top:            '50%',
      left:           '50%',
      transform:      'translate(-50%, -50%)',
      background:     'linear-gradient(to bottom, #19364d, #6b88a7)',
      borderRadius:   '10px',
      padding:        '30px',
      boxShadow:      '0 4px 12px rgba(0,0,0,0.2)',
      maxWidth:       '300px',
      width:          '90%',
      textAlign:      'center',
      fontFamily:    'Cabin, sans-serif',
      color:          '#FEFAF3',
      display:        'flex',
      flexDirection:  'column',
      gap:            '20px',
      zIndex:         '9999',
    });
  
    // 3) Inject HTML
    dialog.innerHTML = `
      <h2>Please Reconsider!</h2>
      <p>${message}</p>
      <button id="message-ok" style="
        padding: 12px 0;
        border-radius: 50px;
        background: linear-gradient(to bottom, #6A99B0, #8FAAC3);
        border: none;
        cursor: pointer;
        font-size: 16px;
        color: #FEFAF3;
        transition: background 0.3s, transform 0.2s ease-in-out;
        fontFamily:    'Cabin, sans-serif',
      ">OK</button>
    `;
  
    document.body.appendChild(dialog);
  
    // 4) Wire up the OK button
    const btnOK = document.getElementById('message-ok');
    btnOK.onclick = () => {
      dialog.remove();
      onConfirm();
    };
  
    // 5) Hover effect
    btnOK.addEventListener('mouseover', () => {
      btnOK.style.background = 'linear-gradient(to bottom, #8FAAC3, #6A99B0)';
      btnOK.style.transform  = 'scale(1.05)';
    });
    btnOK.addEventListener('mouseout', () => {
      btnOK.style.background = 'linear-gradient(to bottom, #6A99B0, #8FAAC3)';
      btnOK.style.transform  = 'scale(1)';
    });
  }