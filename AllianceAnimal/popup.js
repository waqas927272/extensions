document.addEventListener('DOMContentLoaded', () => {
  const startScrapingBtn = document.getElementById('startScraping');
  const stopScrapingBtn = document.getElementById('stopScraping');
  const viewRecordsBtn = document.getElementById('viewRecords');
  const loadingIndicator = document.getElementById('loadingIndicator');

  // Stat display elements
  const currentPageRecordsSpan = document.getElementById('currentPageRecords');
  const scrapedRecordsInProgressSpan = document.getElementById('scrapedRecordsInProgress');
  const totalPaginationPagesSpan = document.getElementById('totalPaginationPages');

  let activeTabId = null;

  // Function to set button states based on scraping status
  function setButtonStates(isScraping) {
    if (isScraping) {
      startScrapingBtn.disabled = true;
      stopScrapingBtn.disabled = false;
      viewRecordsBtn.disabled = true;
      loadingIndicator.classList.remove('hidden');
    } else {
      startScrapingBtn.disabled = false;
      stopScrapingBtn.disabled = true;
      viewRecordsBtn.disabled = false;
      loadingIndicator.classList.add('hidden');
    }
  }

  // Function to update the stats display
  function updateStatsDisplay(stats) {
    currentPageRecordsSpan.textContent = stats.currentPageRecords;
    scrapedRecordsInProgressSpan.textContent = stats.scrapedRecordsInProgress;
    totalPaginationPagesSpan.textContent = stats.totalPaginationPages;
  }

  // Initialize content script and get initial stats when popup is opened
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length > 0) {
      activeTabId = tabs[0].id;

      // Inject content.js only once if it hasn't been injected yet
      // This is a common pattern to avoid redeclaration errors
      chrome.scripting.executeScript({
        target: { tabId: activeTabId },
        files: ['content.js']
      }).then(() => {
        // Once injected, get the initial scraping status and stats
        chrome.storage.local.get(['isScraping'], (result) => {
          setButtonStates(result.isScraping || false);
        });
        chrome.tabs.sendMessage(activeTabId, { action: 'getInitialStats' }, (response) => {
          if (response) {
            updateStatsDisplay(response);
          }
        });
      }).catch(error => console.error("Error injecting content script:", error));
    }
  });


  // Listener for real-time stats updates from content script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'updateStats') {
      updateStatsDisplay(request.data);
    }
  });


  startScrapingBtn.addEventListener('click', () => {
    if (!activeTabId) {
      console.error("No active tab ID available.");
      return;
    }
    setButtonStates(true); // Optimistically set state to scraping
    chrome.tabs.sendMessage(activeTabId, { action: 'start' }, (response) => {
      // This callback will be triggered when content.js calls sendResponse
      if (response) {
        if (response.status === 'completed' || response.status === 'stopped') {
          setButtonStates(false); // Update to finished state
        } else if (response.status === 'already_running') {
            console.log('Scraping is already running on this tab.');
            // Re-fetch state to be sure, or just assume it's running
            chrome.storage.local.get(['isScraping'], (result) => {
                setButtonStates(result.isScraping || false);
            });
        }
      }
    });
  });

  stopScrapingBtn.addEventListener('click', () => {
    if (!activeTabId) {
      console.error("No active tab ID available.");
      return;
    }
    chrome.tabs.sendMessage(activeTabId, { action: 'stop' }, (response) => {
      if (response && response.status === 'stopped') {
        setButtonStates(false); // Update to finished state
      }
    });
  });

  viewRecordsBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'results.html' });
  });
});
