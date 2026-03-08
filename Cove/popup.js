document.addEventListener('DOMContentLoaded', () => {
  const startScrapingBtn = document.getElementById('startScraping');
  const stopScrapingBtn = document.getElementById('stopScraping');
  const viewRecordsBtn = document.getElementById('viewRecords');
  const loadingIndicator = document.getElementById('loadingIndicator');

  const totalJobsOnPageSpan = document.getElementById('totalJobsOnPage');
  const scrapedRecordsSpan = document.getElementById('scrapedRecords');

  let activeTabId = null;

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

  function updateStatsDisplay(stats) {
    totalJobsOnPageSpan.textContent = stats.totalJobsOnPage;
    scrapedRecordsSpan.textContent = stats.scrapedRecords;
  }

  // Initialize content script and get initial stats when popup is opened
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length > 0) {
      activeTabId = tabs[0].id;

      chrome.scripting.executeScript({
        target: { tabId: activeTabId },
        files: ['content.js']
      }).then(() => {
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
    setButtonStates(true);
    chrome.tabs.sendMessage(activeTabId, { action: 'start' }, (response) => {
      if (response) {
        if (response.status === 'completed' || response.status === 'stopped') {
          setButtonStates(false);
        } else if (response.status === 'already_running') {
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
        setButtonStates(false);
      }
    });
  });

  viewRecordsBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'results.html' });
  });
});
