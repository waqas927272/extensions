document.addEventListener('DOMContentLoaded', function() {
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const status = document.getElementById('status');
  const jobCount = document.getElementById('jobCount');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  const viewRecordsBtn = document.getElementById('viewRecordsBtn');

  let isScrapingActive = false;

  // Load initial data and check scraping state
  loadStoredData();
  checkScrapingState();

  startBtn.addEventListener('click', startScraping);
  stopBtn.addEventListener('click', stopScraping);
  viewRecordsBtn.addEventListener('click', openRecordsPage);

  async function checkScrapingState() {
    const result = await chrome.storage.local.get(['scrapingState']);
    if (result.scrapingState && result.scrapingState.active) {
      isScrapingActive = true;
      updateUI('Scraping...', true);
      
      // Update progress based on current page
      const currentPage = result.scrapingState.currentPage || 1;
      const percentage = Math.round((currentPage / 3) * 100);
      progressFill.style.width = percentage + '%';
      progressText.textContent = `Page ${currentPage}/3 (${percentage}%)`;
    }
  }

  function startScraping() {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      const currentTab = tabs[0];
      
      if (!currentTab.url.includes('vcacareers.com/global/en/c/veterinarian-jobs')) {
        alert('Please navigate to VCA veterinarian jobs page first');
        return;
      }

      isScrapingActive = true;
      updateUI('Starting...', true);
      
      chrome.tabs.sendMessage(currentTab.id, { action: 'startScraping' });
    });
  }

  function stopScraping() {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'stopScraping' });
      }
      
      // Also clean up storage
      chrome.storage.local.remove(['scrapingState']);
      
      isScrapingActive = false;
      updateUI('Stopped', false);
    });
  }

  function openRecordsPage() {
    chrome.tabs.create({ url: chrome.runtime.getURL('records.html') });
  }

  function updateUI(statusText, isActive) {
    status.textContent = statusText;
    
    if (isActive) {
      startBtn.style.display = 'none';
      stopBtn.style.display = 'block';
      stopBtn.disabled = false;
      status.style.color = '#fd7e14';
    } else {
      startBtn.style.display = 'block';
      stopBtn.style.display = 'none';
      startBtn.disabled = false;
      status.style.color = statusText === 'Completed' ? '#28a745' : '#6c757d';
    }
  }

  function loadStoredData() {
    chrome.storage.local.get(['jobs'], function(result) {
      const jobs = result.jobs || [];
      jobCount.textContent = jobs.length;
    });
  }

  // Listen for updates from content script
  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === 'updateProgress') {
      const { current, total, jobs } = request.data;
      
      if (total === 'all') {
        progressFill.style.width = '50%';
        progressText.textContent = `Page ${current} (All pages mode)`;
      } else {
        const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
        progressFill.style.width = percentage + '%';
        progressText.textContent = `Page ${current}/${total} (${percentage}%)`;
      }
      
      jobCount.textContent = jobs.length;
    }
    
    if (request.action === 'updateStatus') {
      status.textContent = request.status;
      status.style.color = '#fd7e14'; // Orange color for active status
    }
    
    if (request.action === 'scrapingComplete') {
      isScrapingActive = false;
      updateUI('Completed', false);
      progressFill.style.width = '100%';
      progressText.textContent = '100%';
      loadStoredData();
      
      // Clean up scraping state
      chrome.storage.local.remove(['scrapingState']);
    }
    
    if (request.action === 'scrapingError') {
      isScrapingActive = false;
      updateUI('Error', false);
      alert('Error occurred during scraping: ' + request.message);
      
      // Clean up scraping state
      chrome.storage.local.remove(['scrapingState']);
    }
  });

  // Periodically check for updates when popup is open
  setInterval(function() {
    if (isScrapingActive) {
      loadStoredData();
      checkScrapingState();
    }
  }, 2000);
});