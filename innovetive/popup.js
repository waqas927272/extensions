document.addEventListener('DOMContentLoaded', () => {
  const startScrapingButton = document.getElementById('startScraping');
  const stopScrapingButton = document.getElementById('stopScraping');
  const viewRecordsButton = document.getElementById('viewRecords');
  const loadingIndicator = document.getElementById('loadingIndicator');

  function setLoading(message, visible = true) {
    const spinnerText = loadingIndicator.querySelector('span');
    if (spinnerText) spinnerText.textContent = message;
    loadingIndicator.classList.toggle('hidden', !visible);
  }

  chrome.runtime.onMessage.addListener((request) => {
    if (request.action !== 'scrapingStatus') return;

    if (request.status === 'scraping' || request.status === 'starting') {
      setLoading(request.message || 'Scraping... Please wait.');
      return;
    }

    if (request.status === 'in_progress') {
      setLoading(request.message || `Scraping... (${request.scrapedCount || 0} jobs found)`);
      return;
    }

    if (request.status === 'completed') {
      setLoading('Scraping... Please wait.', false);
      alert(request.message || `Scraping completed! Scraped ${request.scrapedCount || 0} jobs.`);
      return;
    }

    if (request.status === 'stopped') {
      setLoading('Scraping... Please wait.', false);
      alert(request.message || 'Scraping stopped.');
      return;
    }

    if (request.status === 'error') {
      setLoading('Scraping... Please wait.', false);
      alert(`Scraping error: ${request.message || 'Unknown error'}`);
    }
  });

  startScrapingButton.addEventListener('click', () => {
    setLoading('Initializing scraping...');
    chrome.runtime.sendMessage({ action: 'startScraping' }, (response) => {
      if (chrome.runtime.lastError) {
        setLoading('Scraping... Please wait.', false);
        alert(`Scraping error: ${chrome.runtime.lastError.message}`);
        return;
      }

      if (response?.status === 'error') {
        setLoading('Scraping... Please wait.', false);
      }
    });
  });

  stopScrapingButton.addEventListener('click', () => {
    setLoading('Stopping scraping...');
    chrome.runtime.sendMessage({ action: 'stopScraping' });
  });

  viewRecordsButton.addEventListener('click', () => {
    chrome.tabs.create({ url: 'records.html' });
  });
});
