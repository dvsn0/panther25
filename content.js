console.log("Impulse Blocker content script loaded.");

// --- Configuration ---
// VERY IMPORTANT: These selectors will likely need adjustment for different sites
// or even different versions of Amazon. Inspect the elements on the actual pages.
const buyButtonSelectors = [
    '#buy-now-button',                // Amazon's main Buy Now button ID
    'input[name="submit.buy-now"]',   // Another possible Amazon Buy Now input
    '#one-click-button',              // One-click purchase button
    '#proceed-to-checkout-button',    // Added selector for Proceed to Checkout button
    'input[name="proceedToRetailCheckout"]'  // Another possible selector for Proceed to Checkout
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
    return null; // Not a buy or proceed button
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

    // Create the modal
    const modal = document.createElement('div');
    modal.id = 'impulse-popup';
    modal.innerHTML = `
        <div style="
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: center;
        ">
            <div style="
                background: linear-gradient(to bottom, #19364d, #6b88a7); /* Gradient background */
                padding: 30px;
                border-radius: 10px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
                max-width: 300px; /* Adjusted to be more vertical */
                width: 100%;
                text-align: center;
                font-family: sans-serif;
                color: #FEFAF3;
            ">
                <h2>Impulse Purchase Check</h2>
                <p>Are you sure this isn't an impulse buy?</p>
                <div style="display: flex; flex-direction: column; gap: 20px;">
                    <button id="impulse-proceed" style="
                        padding: 12px 30px;
                        border-radius: 50px; /* Pill shape */
                        background: linear-gradient(to bottom, #6A99B0, #8FAAC3); /* Button gradient */
                        color: #FEFAF3;
                        border: none;
                        cursor: pointer;
                        font-size: 16px;
                        transition: background-color 0.3s;
                    ">Yes</button>
                    <button id="impulse-cancel" style="
                        padding: 12px 30px;
                        border-radius: 50px; /* Pill shape */
                        background: linear-gradient(to bottom, #6A99B0, #8FAAC3); /* Button gradient */
                        color: #FEFAF3;
                        border: none;
                        cursor: pointer;
                        font-size: 16px;
                        transition: background-color 0.3s;
                    ">No</button>
                </div>
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

    // Hover effect for buttons
    document.getElementById('impulse-proceed').addEventListener('mouseover', () => {
        document.getElementById('impulse-proceed').style.background = "linear-gradient(to bottom, #8FAAC3, #6A99B0)"; // Reverse gradient on hover
        document.getElementById('impulse-proceed').style.transform = "scale(1.05)"; // Slightly increase size on hover
    });
    document.getElementById('impulse-proceed').addEventListener('mouseout', () => {
        document.getElementById('impulse-proceed').style.background = "linear-gradient(to bottom, #6A99B0, #8FAAC3)"; // Reset gradient
        document.getElementById('impulse-proceed').style.transform = "scale(1)"; // Reset size
    });

    document.getElementById('impulse-cancel').addEventListener('mouseover', () => {
        document.getElementById('impulse-cancel').style.background = "linear-gradient(to bottom, #8FAAC3, #6A99B0)"; // Reverse gradient on hover
        document.getElementById('impulse-cancel').style.transform = "scale(1.05)"; // Slightly increase size on hover
    });
    document.getElementById('impulse-cancel').addEventListener('mouseout', () => {
        document.getElementById('impulse-cancel').style.background = "linear-gradient(to bottom, #6A99B0, #8FAAC3)"; // Reset gradient
        document.getElementById('impulse-cancel').style.transform = "scale(1)"; // Reset size
    });
}

function showMessagePopup(message, onConfirm) {
    // Remove existing message popup if present
    const existing = document.getElementById('message-popup');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'message-popup';
    modal.innerHTML = `
        <div style="
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: center;
        ">
            <div style="
                background: linear-gradient(to bottom, #19364d, #6b88a7); /* Gradient background */
                padding: 30px;
                border-radius: 10px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
                max-width: 300px; /* Adjusted to be more vertical */
                width: 100%;
                text-align: center;
                font-family: sans-serif;
                color: #FEFAF3;
            ">
                <h2>Please Reconsider!</h2>
                <p>${message}</p>
                <button id="message-ok" style="
                    padding: 12px 30px;
                    border-radius: 50px; /* Pill shape */
                    background: linear-gradient(to bottom, #6A99B0, #8FAAC3); /* Button gradient */
                    color: #FEFAF3;
                    border: none;
                    cursor: pointer;
                    font-size: 16px;
                    transition: background-color 0.3s;
                ">OK</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('message-ok').onclick = () => {
        modal.remove();
        onConfirm();
    };

    // Hover effect for button
    document.getElementById('message-ok').addEventListener('mouseover', () => {
        document.getElementById('message-ok').style.background = "linear-gradient(to bottom, #8FAAC3, #6A99B0)"; // Reverse gradient on hover
        document.getElementById('message-ok').style.transform = "scale(1.05)"; // Slightly increase size on hover
    });
    document.getElementById('message-ok').addEventListener('mouseout', () => {
        document.getElementById('message-ok').style.background = "linear-gradient(to bottom, #6A99B0, #8FAAC3)"; // Reset gradient
        document.getElementById('message-ok').style.transform = "scale(1)"; // Reset size
    });
}