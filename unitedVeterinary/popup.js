document.addEventListener('DOMContentLoaded', () => {
    const startScrapingButton = document.getElementById('startScraping');
    const stopScrapingButton = document.getElementById('stopScraping');
    const viewRecordsButton = document.getElementById('viewRecords');
    const loadingIndicator = document.getElementById('loadingIndicator');

    // Listener for messages from background.js to update UI
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'scrapingStatus') {
            const spinnerText = loadingIndicator.querySelector('span');
            if (request.status === 'starting') {
                loadingIndicator.classList.remove('hidden');
                if (spinnerText) spinnerText.textContent = 'Scraping... Please wait.';
            } else if (request.status === 'in_progress') {
                if (spinnerText) spinnerText.textContent = `Scraping page ${request.currentPage}...`;
            } else if (request.status === 'completed' || request.status === 'stopped') {
                loadingIndicator.classList.add('hidden');
                if (spinnerText) spinnerText.textContent = 'Scraping... Please wait.'; // Reset for next time
                if (request.status === 'completed') {
                    alert(`Scraping completed! Scraped ${request.scrapedCount} jobs.`);
                } else {
                    alert(`Scraping stopped. Scraped ${request.scrapedCount} jobs so far.`);
                }
            } else if (request.status === 'error') {
                loadingIndicator.classList.add('hidden');
                if (spinnerText) spinnerText.textContent = 'Scraping... Please wait.'; // Reset
                alert(`Scraping error: ${request.message}`);
            }
        }
    });
  
    startScrapingButton.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'startScraping' });
        // The loading indicator will be shown by the 'scrapingStatus' message from background.js
        loadingIndicator.classList.remove('hidden');
        const spinnerText = loadingIndicator.querySelector('span');
        if (spinnerText) spinnerText.textContent = 'Initializing scraping...';
    });

    stopScrapingButton.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'stopScraping' });
        const spinnerText = loadingIndicator.querySelector('span');
        if (spinnerText) spinnerText.textContent = 'Stopping scraping...';
    });
  
    viewRecordsButton.addEventListener('click', () => {
      chrome.tabs.create({ url: 'records.html' });
    });
  });