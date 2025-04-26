console.log("Impulse Blocker content script loaded.");

// --- Configuration ---
// VERY IMPORTANT: These selectors will likely need adjustment for different sites
// or even different versions of Amazon. Inspect the elements on the actual pages.
const buyButtonSelectors = [
    '#buy-now-button',                // Amazon's main Buy Now button ID
    'input[name="submit.buy-now"]',   // Another possible Amazon Buy Now input
    '#one-click-button',              // One-click purchase button
    // Add more selectors for buttons like "Add to Cart" if desired,
    // or buttons on other shopping sites.
    // Example: 'button.some-checkout-class'
];

let clickedButton = null; // Store the button that was clicked

// --- Functions ---
function isBuyButton(element) {
    // Traverse up the DOM tree in case the click target is inside the button
    let currentElement = element;
    while (currentElement && currentElement !== document.body) {
        for (const selector of buyButtonSelectors) {
            if (currentElement.matches(selector)) {
                return currentElement; // Return the matching button element
            }
        }
        currentElement = currentElement.parentElement;
    }
    return null; // Not a buy button
}

// --- Event Listener --- FIXME
// document.addEventListener('click', (event) => {
//     const targetButton = isBuyButton(event.target);

//     if (targetButton) {
//         console.log("Buy button clicked:", targetButton);
//         clickedButton = targetButton; // Store the button

//         // Prevent the default click action immediately
//         // event.preventDefault(); // handles blocking amazon purchase FIXME
//         // event.stopPropagation();

//         console.log("Sending request to background for emotion analysis...");
//         // Send message to background script to start analysis
//         chrome.runtime.sendMessage({ action: "analyzeEmotion" }, (response) => {
//             if (chrome.runtime.lastError) {
//                 console.error("Error sending message:", chrome.runtime.lastError.message);
//                  // Decide what to do if communication fails - maybe allow purchase?
//                 // proceedWithPurchase(); // Or block completely?
//                 alert("Error communicating with extension background. Purchase blocked.");
//                 return;
//             }

//             console.log("Received response from background:", response);
//             if (response && response.action === "emotionResult") {
//                 if (response.showPopup) {
//                     // Ask the user for confirmation
//                     const confirmation = confirm(
//                         "High negative emotion detected! Are you sure this is a necessary purchase right now?"
//                     );
//                     if (confirmation) {
//                         console.log("User confirmed purchase.");
//                         proceedWithPurchase();
//                     } else {
//                         console.log("User cancelled purchase.");
//                         // Optionally add a visual cue that the purchase was blocked
//                         clickedButton.style.outline = "2px solid red";
//                         setTimeout(() => { if(clickedButton) clickedButton.style.outline = ""; }, 2000);
//                         clickedButton = null; // Reset stored button
//                     }
//                 } else {
//                     console.log("Emotion levels acceptable or analysis failed, proceeding with purchase.");
//                     proceedWithPurchase();
//                 }
//             } else {
//                  console.error("Unexpected response from background:", response);
//                  // Fallback: maybe allow purchase?
//                  // proceedWithPurchase();
//                  alert("Received unexpected response from extension background. Purchase blocked.");
//             }
//         });
//     }
// }, true); // Use capture phase to intercept click early

// document.addEventListener('click', (event) => { // TODO
//     const targetButton = isBuyButton(event.target);

//     if (targetButton) {
//         console.log("Buy button clicked:", targetButton);
//         clickedButton = targetButton;

//         // TEMPORARY: No preventDefault/stopPropagation for now
//         const confirmation = confirm("Are you making this purchase impulsively?");
//         if (!confirmation) {
//             alert("Purchase blocked. Please reconsider!");
//             event.preventDefault(); // Optionally block ONLY if user cancels
//             event.stopPropagation();
//         }
//     }
// }, true);

// FIXME
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

function proceedWithPurchase() {
    if (clickedButton) {
        console.log("Proceeding with click action on:", clickedButton);
        // IMPORTANT: Re-triggering the original action can be tricky.
        // Method 1: Simulate a click again (might be caught by this listener again if not careful)
        // clickedButton.click(); // Be cautious with this

        // Method 2: If the button is part of a form, submit the form
        if (clickedButton.form) {
             console.log("Submitting form associated with the button.");
             // Check if the button adds specific data needed for form submission
             let tempInput = null;
             if (clickedButton.name && clickedButton.value) {
                 tempInput = document.createElement('input');
                 tempInput.type = 'hidden';
                 tempInput.name = clickedButton.name;
                 tempInput.value = clickedButton.value;
                 clickedButton.form.appendChild(tempInput);
             }
             clickedButton.form.submit();
             if (tempInput) {
                clickedButton.form.removeChild(tempInput); // Clean up temp input
             }
        } else {
            console.warn("Button is not inside a form, trying direct click again.");
            // Fallback to direct click if not in a form. This might not always work
            // depending on how the site handles clicks (e.g., JavaScript event handlers).
            // We need to temporarily disable our own listener to prevent loops.
             const originalButton = clickedButton;
             clickedButton = null; // Prevent our listener from re-triggering on this specific element for now
             originalButton.click(); // Click the original button programmatically
             // No need to re-enable the listener, it's still active globally.
        }
         // Reset after attempting action
         // clickedButton = null; // Already done above or implicitly reset by form submission
    } else {
        console.error("No button stored to proceed with purchase.");
    }
}

console.log("Impulse Blocker content script listener attached.");

// Listen for potential messages FROM the background (less common in this flow, but good practice)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Message received in content script:", message);
    // Handle other messages if needed
});

// FIXME
function showImpulsePopup(onConfirm, onCancel) {
    // Remove existing modal if present
    const existing = document.getElementById('impulse-popup');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'impulse-popup';
    modal.innerHTML = `
        <div style="
            position: fixed;
            top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0, 0, 0, 0.5);
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: center;
        ">
            <div style="
                background: white;
                padding: 30px;
                border-radius: 10px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
                max-width: 400px;
                text-align: center;
                font-family: sans-serif;
            ">
                <h2>Impulse Purchase Check</h2>
                <p>Are you sure this isn't an impulse buy?</p>
                <button id="impulse-proceed" style="margin-right: 10px; padding: 8px 15px;">Yes, it isn't an impulse buy</button>
                <button id="impulse-cancel" style="padding: 8px 15px;">No, it is an impulse buy and I want it now</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // Add button handlers
    document.getElementById('impulse-proceed').onclick = () => {
        modal.remove();
        onConfirm();
    };
    document.getElementById('impulse-cancel').onclick = () => {
        modal.remove();
        onCancel();
    };
}
