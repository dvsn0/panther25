// Function to save options
function saveOptions() {
    const apiKey = document.getElementById('apiKey').value;
    const distressThreshold = parseFloat(document.getElementById('distressThreshold').value);
    const angerThreshold = parseFloat(document.getElementById('angerThreshold').value);
  
    chrome.storage.sync.set({
      humeApiKey: apiKey,
      distressThreshold: distressThreshold,
      angerThreshold: angerThreshold
      // Save other thresholds here
    }, () => {
      // Update status to let user know options were saved.
      const status = document.getElementById('status');
      status.textContent = 'Options saved.';
      setTimeout(() => {
        status.textContent = '';
      }, 1500);
    });
  }
  
  // Function to restore options
  function restoreOptions() {
    // Default values
    chrome.storage.sync.get({
      humeApiKey: '',
      distressThreshold: 0.5,
      angerThreshold: 0.5
      // Add other defaults
    }, (items) => {
      document.getElementById('apiKey').value = items.humeApiKey;
      document.getElementById('distressThreshold').value = items.distressThreshold;
      document.getElementById('angerThreshold').value = items.angerThreshold;
      // Restore other fields
    });
  }
  
  document.addEventListener('DOMContentLoaded', restoreOptions);
  document.getElementById('save').addEventListener('click', saveOptions);