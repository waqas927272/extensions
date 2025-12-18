document.addEventListener('DOMContentLoaded', () => {
    const startScrapingButton = document.getElementById('startScraping');
    const stopScrapingButton = document.getElementById('stopScraping');
    const viewRecordsButton = document.getElementById('viewRecords');
    const loadingIndicator = document.getElementById('loadingIndicator');

    // Listener for messages from background.js to update UI
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'scrapingStatus') {
            if (request.status === 'starting') {
                loadingIndicator.style.display = 'block';
                loadingIndicator.textContent = 'Scraping... Please wait.';
            } else if (request.status === 'in_progress') {
                loadingIndicator.textContent = `Scraping page ${request.currentPage}...`;
            } else if (request.status === 'completed' || request.status === 'stopped') {
                loadingIndicator.style.display = 'none';
                loadingIndicator.textContent = 'Scraping... Please wait.'; // Reset for next time
                if (request.status === 'completed') {
                    alert(`Scraping completed! Scraped ${request.scrapedCount} jobs.`);
                } else {
                    alert(`Scraping stopped. Scraped ${request.scrapedCount} jobs so far.`);
                }
            } else if (request.status === 'error') {
                loadingIndicator.style.display = 'none';
                loadingIndicator.textContent = 'Scraping... Please wait.'; // Reset
                alert(`Scraping error: ${request.message}`);
            }
        }
    });
  
    startScrapingButton.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'startScraping' });
        // The loading indicator will be shown by the 'scrapingStatus' message from background.js
        loadingIndicator.style.display = 'block';
        loadingIndicator.textContent = 'Initializing scraping...';
    });
  
    stopScrapingButton.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'stopScraping' });
        loadingIndicator.textContent = 'Stopping scraping...';
    });
  
    viewRecordsButton.addEventListener('click', () => {
      chrome.tabs.create({ url: 'records.html' });
    });
  });