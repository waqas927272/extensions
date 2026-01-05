document.addEventListener('DOMContentLoaded', () => {
  const startButton = document.getElementById('startScraping');
  const stopButton = document.getElementById('stopScraping');
  const viewRecordsButton = document.getElementById('viewRecords');
  const loadingMessage = document.getElementById('loadingMessage');
  const sessionCountSpan = document.getElementById('sessionCount');
  const pageTotalSpan = document.getElementById('pageTotal');
  const totalRecordsSpan = document.getElementById('totalRecords');

  function updateStatus() {
    chrome.runtime.sendMessage({ command: 'get-status' }, (response) => {
      if (chrome.runtime.lastError) {
        // Handle potential error if background script is not ready
        console.error(chrome.runtime.lastError.message);
        return;
      }
      if (response) {
        if (response.isScraping) {
          loadingMessage.classList.add('show');
        } else {
          loadingMessage.classList.remove('show');
        }
        sessionCountSpan.textContent = response.sessionCount || 0;
        pageTotalSpan.textContent = response.pageTotal || 0;
        totalRecordsSpan.textContent = response.totalRecords || 0;
      }
    });
  }

  // Initial status update when popup opens
  updateStatus();

  startButton.addEventListener('click', () => {
    loadingMessage.classList.add('show');
    // Reset counts for new session
    sessionCountSpan.textContent = 0;
    pageTotalSpan.textContent = 0;
    chrome.runtime.sendMessage({ command: 'start' });
  });

  stopButton.addEventListener('click', () => {
    loadingMessage.classList.remove('show');
    chrome.runtime.sendMessage({ command: 'stop' });
  });

  viewRecordsButton.addEventListener('click', () => {
    chrome.tabs.create({ url: 'records.html' });
  });

  // Listen for real-time updates from the background script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.command === 'scraping_finished') {
      loadingMessage.classList.remove('show');
      updateStatus(); // Update all stats once finished
    } else if (request.command === 'session-update') {
      sessionCountSpan.textContent = request.count;
    } else if (request.command === 'page-total-update') {
      pageTotalSpan.textContent = request.count;
    }
  });
});
