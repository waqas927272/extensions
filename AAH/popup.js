document.addEventListener('DOMContentLoaded', () => {
    const startScrapingButton = document.getElementById('startScraping');
    const stopScrapingButton = document.getElementById('stopScraping');
    const viewRecordsButton = document.getElementById('viewRecords');
    const loadingIndicator = document.getElementById('loadingIndicator');
    const totalJobsCount = document.getElementById('totalJobsCount');
    const scrapedJobsCount = document.getElementById('scrapedJobsCount');
    const skippedJobsCount = document.getElementById('skippedJobsCount');
    const addressesFoundCount = document.getElementById('addressesFoundCount');
    const addressesMissingCount = document.getElementById('addressesMissingCount');
    const skipKeywordList = document.getElementById('skipKeywordList');
    const summaryTimestamp = document.getElementById('summaryTimestamp');

    function formatTimestamp(value) {
        if (!value) return 'No scrape completed yet';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return 'Latest scrape summary';
        return `Completed ${date.toLocaleString()}`;
    }

    function renderSkipKeywords(items = []) {
        skipKeywordList.innerHTML = '';

        if (!items.length) {
            const empty = document.createElement('div');
            empty.className = 'empty-summary';
            empty.textContent = 'No skipped jobs recorded.';
            skipKeywordList.appendChild(empty);
            return;
        }

        items.forEach(item => {
            const row = document.createElement('div');
            row.className = 'skip-keyword-row';

            const label = document.createElement('span');
            label.textContent = item.keyword || 'unknown';

            const count = document.createElement('strong');
            count.textContent = item.count || 0;

            row.append(label, count);
            skipKeywordList.appendChild(row);
        });
    }

    function renderSummary(jobs = [], summary = null) {
        const addressCount = jobs.filter(job => job.streetAddress || job.zipCode || job.fullAddress).length;
        const missingAddressCount = Math.max(jobs.length - addressCount, 0);

        totalJobsCount.textContent = summary?.totalJobs ?? jobs.length;
        scrapedJobsCount.textContent = summary?.scrapedJobs ?? jobs.length;
        skippedJobsCount.textContent = summary?.skippedJobs ?? 0;
        addressesFoundCount.textContent = `${addressCount} found`;
        addressesMissingCount.textContent = missingAddressCount;
        summaryTimestamp.textContent = formatTimestamp(summary?.completedAt);
        renderSkipKeywords(summary?.skippedByKeyword || []);
    }

    function loadSummary() {
        chrome.storage.local.get(['scrapedJobs', 'scrapingSummary'], (result) => {
            renderSummary(result.scrapedJobs || [], result.scrapingSummary || null);
        });
    }

    loadSummary();

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
                loadSummary();
                if (request.status === 'completed') {
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
        renderSummary([], null);
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
