document.addEventListener('DOMContentLoaded', () => {
    const scrapeBtn = document.getElementById('scrapeBtn');
    const stopBtn = document.getElementById('stopBtn');
    const status = document.getElementById('status');
    const results = document.getElementById('results');

    // Update stats card
    updateStatsCard();

    // Restore button/status state on popup open
    chrome.storage.local.get(['scraping', 'scrapingStatus', 'scrapingComplete', 'scrapedJobs'], (data) => {
        if (data.scraping) {
            scrapeBtn.disabled = true;
            scrapeBtn.innerHTML = `
                <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                </svg>
                Scraping...
            `;
            stopBtn.style.display = 'block';
            status.className = 'status-message info';
            status.textContent = data.scrapingStatus || 'Scraping is in progress...';
            checkScrapingStatus(); // Start polling
        } else if (data.scrapingComplete) {
            status.className = 'status-message success';
            status.textContent = data.scrapingStatus || `Successfully scraped ${data.scrapedJobs.length} jobs!`;
        }
    });

    const SUPPORTED_URLS = [
        'missionpethealth.avature.net/careersmarketplace/SearchJobs',
        'missionpethealth.avature.net/agency/OpenPositions'
    ];

    function isSupportedPage(url) {
        return SUPPORTED_URLS.some(pattern => url.includes(pattern));
    }

    scrapeBtn.addEventListener('click', async () => {
        results.innerHTML = '';

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            const tabUrl = tab.url || '';

            // Validate the user is on a supported page
            if (!isSupportedPage(tabUrl)) {
                status.className = 'status-message error';
                status.textContent = 'Please navigate to the MPH Careers Marketplace (SearchJobs) or Agency Portal (OpenPositions) first.';
                return;
            }

            scrapeBtn.disabled = true;
            scrapeBtn.innerHTML = `
                <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                </svg>
                Scraping...
            `;
            stopBtn.style.display = 'block';
            status.className = 'status-message info';
            status.textContent = 'Initializing scraper...';

            await chrome.storage.local.set({
                scraping: true,
                scrapingComplete: false,
                scrapedJobs: [],
                scrapedJobIds: [],
                scrapingStatus: 'Starting scraper...'
            });

            await chrome.tabs.reload(tab.id);
            checkScrapingStatus();

        } catch (error) {
            status.className = 'status-message error';
            status.textContent = `Error: ${error.message}`;
            console.error('Scraping error:', error);
            scrapeBtn.disabled = false;
            scrapeBtn.innerHTML = `
                <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                </svg>
                Scrape Jobs
            `;
            stopBtn.style.display = 'none';
        }
    });

    stopBtn.addEventListener('click', async () => {
        const data = await chrome.storage.local.get(['scrapedJobs']);
        const jobCount = data.scrapedJobs ? data.scrapedJobs.length : 0;

        await chrome.storage.local.set({
            scraping: false,
            scrapingComplete: true,
            scrapingStatus: `Scraping stopped by user. Found ${jobCount} jobs.`
        });
    });
});

function checkScrapingStatus() {
    const scrapeBtn = document.getElementById('scrapeBtn');
    const stopBtn = document.getElementById('stopBtn');
    const status = document.getElementById('status');
    const results = document.getElementById('results');

    const interval = setInterval(() => {
        chrome.storage.local.get(['scrapingStatus', 'scrapedJobs', 'scrapingComplete', 'scraping'], (data) => {
            if (data.scraping) {
                if (data.scrapingStatus) {
                    status.className = 'status-message info';
                    status.textContent = data.scrapingStatus;
                }
            }

            if (data.scrapingComplete) {
                clearInterval(interval);

                status.className = 'status-message success';
                const finalStatus = data.scrapingStatus || `Successfully scraped ${data.scrapedJobs.length} jobs!`;
                status.textContent = finalStatus;

                scrapeBtn.disabled = false;
                scrapeBtn.innerHTML = `
                    <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                    </svg>
                    Scrape Jobs
                `;
                stopBtn.style.display = 'none';

                // Update stats card after scraping
                updateStatsCard();

                // Don't clean up scrapedJobs so results page works
                chrome.storage.local.remove(['scraping', 'scrapedJobIds']);
                // We keep scrapingStatus to show the final message. And scrapingComplete for the popup open logic.

            } else if (data.scraping === false && !data.scrapingComplete) {
                // Handle error case
                clearInterval(interval);
                status.className = 'status-message error';
                status.textContent = data.scrapingStatus || 'Scraping failed for an unknown reason.';
                scrapeBtn.disabled = false;
                scrapeBtn.innerHTML = `
                    <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                    </svg>
                    Scrape Jobs
                `;
                stopBtn.style.display = 'none';
            }
        });
    }, 1000);

    // Timeout after 10 minutes
    setTimeout(() => {
        chrome.storage.local.get(['scraping'], (data) => {
            if (data.scraping) { // if still running
                clearInterval(interval);
                chrome.storage.local.set({
                    scraping: false,
                    scrapingComplete: true,
                    scrapingStatus: 'Scraping timed out after 10 minutes.'
                });
            }
        });
    }, 600000);
}

function updateStatsCard() {
    chrome.storage.local.get(['scrapedJobs'], (data) => {
        const jobs = data.scrapedJobs || [];
        const statsCard = document.getElementById('statsCard');

        if (jobs.length > 0) {
            const withDescriptions = jobs.filter(job => job.description).length;
            document.getElementById('totalJobs').textContent = jobs.length;
            document.getElementById('withDescriptions').textContent = withDescriptions;
            statsCard.style.display = 'flex';
        } else {
            statsCard.style.display = 'none';
        }
    });
}
