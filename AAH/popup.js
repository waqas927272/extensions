document.addEventListener('DOMContentLoaded', () => {
    const startScrapingButton = document.getElementById('startScraping');
    const stopScrapingButton = document.getElementById('stopScraping');
    const viewRecordsButton = document.getElementById('viewRecords');
    const loadingIndicator = document.getElementById('loadingIndicator');
    const scrapingSummary = document.getElementById('scrapingSummary');
    const summaryTotal = document.getElementById('summaryTotal');
    const summarySkipped = document.getElementById('summarySkipped');
    const summaryScraped = document.getElementById('summaryScraped');
    const summaryKeywords = document.getElementById('summaryKeywords');

    function renderScrapingSummary(summary) {
        if (!summary || !scrapingSummary) return;

        summaryTotal.textContent = summary.totalJobs || 0;
        summarySkipped.textContent = summary.skippedJobs || 0;
        summaryScraped.textContent = summary.scrapedJobs || 0;
        summaryKeywords.innerHTML = '';

        if (Array.isArray(summary.skippedByKeyword) && summary.skippedByKeyword.length > 0) {
            summary.skippedByKeyword.forEach(item => {
                const row = document.createElement('div');
                row.className = 'summary-keyword-row';

                const count = document.createElement('strong');
                count.textContent = item.count || 0;

                const keyword = document.createElement('span');
                keyword.textContent = item.keyword || 'unknown';

                row.appendChild(count);
                row.appendChild(keyword);
                summaryKeywords.appendChild(row);
            });
        } else {
            summaryKeywords.textContent = 'None';
        }

        scrapingSummary.classList.remove('hidden');
    }

    chrome.storage.local.get(['scrapingSummary'], (data) => {
        renderScrapingSummary(data.scrapingSummary);
    });

    // Listener for messages from background.js to update UI
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'scrapingStatus') {
            const spinnerText = loadingIndicator.querySelector('span');
            if (request.status === 'starting' || request.status === 'scraping') {
                loadingIndicator.classList.remove('hidden');
                if (spinnerText) spinnerText.textContent = request.message || 'Scraping... Please wait.';
            } else if (request.status === 'in_progress') {
                loadingIndicator.classList.remove('hidden');
                if (spinnerText) spinnerText.textContent = `Scraping page ${request.currentPage}... (${request.scrapedCount} jobs found)`;
            } else if (request.status === 'completed' || request.status === 'stopped') {
                loadingIndicator.classList.add('hidden');
                if (spinnerText) spinnerText.textContent = 'Scraping... Please wait.'; // Reset for next time
                if (request.status === 'completed') {
                    chrome.storage.local.get(['scrapingSummary'], (data) => {
                        renderScrapingSummary(data.scrapingSummary);
                    });
                    if (request.message && request.message.includes('Fetch Details')) {
                        alert(request.message);
                    } else {
                        alert(`Scraping completed! Scraped ${request.scrapedCount} jobs. Click "View Records" then "Fetch Details" to get additional information.`);
                    }
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
        scrapingSummary.classList.add('hidden');
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
