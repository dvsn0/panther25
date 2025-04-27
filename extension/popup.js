document.addEventListener('DOMContentLoaded', () => {
    const countEl = document.getElementById('count');
    const resetBtn = document.getElementById('reset-btn');
  
    // Helper to update the display
    function updateDisplay(value) {
      countEl.textContent = value;
    }
  
    // Load the stored count (default 0)
    chrome.storage.sync.get({ blockedCount: 0 }, ({ blockedCount }) => {
      updateDisplay(blockedCount);
    });
  
    // If storage changes (e.g. user hits "No"), update live
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes.blockedCount) {
        updateDisplay(changes.blockedCount.newValue);
      }
    });
  
    // Reset button handler
    resetBtn.addEventListener('click', () => {
      chrome.storage.sync.set({ blockedCount: 0 });
    });
  
    // Settings icon opens options page
    document.getElementById('settings-btn')
            .addEventListener('click', () => chrome.runtime.openOptionsPage());
  });  