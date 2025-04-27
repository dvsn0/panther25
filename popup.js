document.addEventListener('DOMContentLoaded', () => {
    const countEl = document.getElementById('count');
  
    // load the saved count (defaults to 0)
    chrome.storage.sync.get({ blockedCount: 0 }, ({ blockedCount }) => {
      countEl.textContent = blockedCount;
    });
  
    // open options when the gear icon is clicked
    document.getElementById('settings-btn')
            .addEventListener('click', () => chrome.runtime.openOptionsPage());
  });
  