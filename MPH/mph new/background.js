const SUPPORTED_URLS = [
    'missionpethealth.avature.net/careersmarketplace/SearchJobs',
    'missionpethealth.avature.net/agency/OpenPositions'
];

function isSupportedPage(url = '') {
    return SUPPORTED_URLS.some(pattern => url.includes(pattern));
}

async function getScrapedJobs() {
    const data = await chrome.storage.local.get(['scrapedJobs']);
    return data.scrapedJobs || [];
}

async function getScrapedCount() {
    const jobs = await getScrapedJobs();
    return jobs.length;
}

async function handleStartScraping(sendResponse) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTabId = tab?.id;
    const activeUrl = tab?.url || '';

    if (!activeTabId) {
        sendResponse({ status: 'error', message: 'No active tab found.' });
        return;
    }

    if (!isSupportedPage(activeUrl)) {
        sendResponse({
            status: 'error',
            message: 'Please navigate to the MPH Careers Marketplace (SearchJobs) or Agency Portal (OpenPositions) first.'
        });
        return;
    }

    await chrome.storage.local.set({
        scraping: true,
        scrapingComplete: false,
        scrapedJobs: [],
        scrapedJobIds: [],
        scrapingStatus: 'Starting scraper...'
    });

    await chrome.tabs.reload(activeTabId);
    sendResponse({ status: 'scrapingStarted' });
}

async function handleStopScraping(sendResponse) {
    const scrapedCount = await getScrapedCount();

    await chrome.storage.local.set({
        scraping: false,
        scrapingComplete: true,
        scrapingStatus: `Scraping stopped by user. Found ${scrapedCount} jobs.`
    });

    sendResponse({ status: 'stopped', scrapedCount });
}

async function fetchDetailsAsync(url) {
    return new Promise((resolve) => {
        if (!url) {
            resolve([]);
            return;
        }

        chrome.tabs.create({ url, active: false }, (tab) => {
            if (!tab) {
                resolve([]);
                return;
            }

            const listener = (tabId, info) => {
                if (tabId !== tab.id || info.status !== 'complete') return;

                chrome.tabs.onUpdated.removeListener(listener);
                setTimeout(() => {
                    chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        files: ['detail-extractor.js']
                    }).then((results) => {
                        chrome.tabs.remove(tab.id).catch(() => {});
                        resolve(results?.[0]?.result || []);
                    }).catch(() => {
                        chrome.tabs.remove(tab.id).catch(() => {});
                        resolve([]);
                    });
                }, 3000);
            };

            chrome.tabs.onUpdated.addListener(listener);
        });
    });
}

function handleScrapeDescription(request) {
    const { tabId, jobIndex } = request;

    chrome.tabs.onUpdated.addListener(function listener(updatedTabId, info) {
        if (updatedTabId !== tabId || info.status !== 'complete') return;

        chrome.tabs.onUpdated.removeListener(listener);
        chrome.scripting.executeScript({
            target: { tabId },
            files: ['description-scraper.js']
        }).then((results) => {
            const description = results?.[0]?.result || '';
            chrome.storage.local.get(['scrapedJobs'], (result) => {
                const jobs = result.scrapedJobs || [];

                if (jobs[jobIndex]) {
                    jobs[jobIndex].description = description;
                    chrome.storage.local.set({ scrapedJobs: jobs }, () => {
                        chrome.tabs.remove(tabId).catch(() => {});
                        chrome.runtime.sendMessage({
                            action: 'descriptionSaved',
                            jobIndex,
                            success: true
                        }).catch(() => {});
                    });
                    return;
                }

                chrome.tabs.remove(tabId).catch(() => {});
                chrome.runtime.sendMessage({
                    action: 'descriptionSaved',
                    jobIndex,
                    success: false
                }).catch(() => {});
            });
        }).catch(() => {
            chrome.tabs.remove(tabId).catch(() => {});
            chrome.runtime.sendMessage({
                action: 'descriptionSaved',
                jobIndex,
                success: false
            }).catch(() => {});
        });
    });
}

async function handleFetchDetails(request) {
    const { url, jobIndex } = request;
    const detailsList = await fetchDetailsAsync(url);
    chrome.runtime.sendMessage({
        action: 'detailsFetched',
        details: detailsList,
        jobIndex
    }).catch(() => {});
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'startScraping') {
        handleStartScraping(sendResponse);
        return true;
    }

    if (request.action === 'stopScraping') {
        handleStopScraping(sendResponse);
        return true;
    }

    if (request.action === 'scrapeJobDescription') {
        handleScrapeDescription(request);
        return false;
    }

    if (request.action === 'fetchJobDetails') {
        handleFetchDetails(request);
        return false;
    }

    return false;
});
