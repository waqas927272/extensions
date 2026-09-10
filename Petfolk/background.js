importScripts('description-parser.js');

const SUPPORTED_URLS = [
    'ats.rippling.com/petfolk/jobs'
];
const REQUIRED_DEPARTMENT = 'Medical';
const SKIPPED_JOB_COUNT_LABELS = ['Locum', 'Relief', 'Mentorship', 'Weekend'];

function isPetfolkRipplingJobsPath(pathname = '') {
    return /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?petfolk\/jobs\/?$/i.test(pathname);
}

function isSupportedPage(url = '') {
    try {
        const parsed = new URL(url);
        return parsed.hostname === 'ats.rippling.com' && isPetfolkRipplingJobsPath(parsed.pathname);
    } catch (_) {
        return SUPPORTED_URLS.some(pattern => url.includes(pattern));
    }
}

function getMedicalFilteredUrl(url = '') {
    const parsed = new URL(url);
    parsed.searchParams.set('page', '0');
    parsed.searchParams.set('jobBoardSlug', 'petfolk');
    parsed.searchParams.set('departments', REQUIRED_DEPARTMENT);
    return parsed.toString();
}

async function getScrapedJobs() {
    const data = await chrome.storage.local.get(['scrapedJobs']);
    return data.scrapedJobs || [];
}

async function getScrapedCount() {
    const jobs = await getScrapedJobs();
    return jobs.length;
}

function normalizeSkippedJobCounts(counts = {}) {
    return SKIPPED_JOB_COUNT_LABELS.reduce((normalizedCounts, label) => {
        normalizedCounts[label] = Number.isFinite(Number(counts[label])) ? Number(counts[label]) : 0;
        return normalizedCounts;
    }, {});
}

function formatSkippedJobSummary(counts = {}) {
    const normalizedCounts = normalizeSkippedJobCounts(counts);
    return `Skipped jobs - ${SKIPPED_JOB_COUNT_LABELS.map(label => `${label} skipped: ${normalizedCounts[label]}`).join(', ')}.`;
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
            message: 'Please navigate to the Petfolk Rippling careers page first.'
        });
        return;
    }

    await chrome.storage.local.set({
        scraping: true,
        scrapingComplete: false,
        scrapedJobs: [],
        scrapedJobIds: [],
        skippedJobCounts: normalizeSkippedJobCounts(),
        skippedJobKeys: [],
        scrapingStatus: `Applying Department filter: ${REQUIRED_DEPARTMENT}...`
    });

    const filteredUrl = getMedicalFilteredUrl(activeUrl);
    if (filteredUrl === activeUrl) {
        await chrome.tabs.reload(activeTabId);
    } else {
        await chrome.tabs.update(activeTabId, { url: filteredUrl });
    }
    sendResponse({ status: 'scrapingStarted' });
}

async function handleStopScraping(sendResponse) {
    const scrapedCount = await getScrapedCount();
    const data = await chrome.storage.local.get(['skippedJobCounts']);

    await chrome.storage.local.set({
        scraping: false,
        scrapingComplete: true,
        scrapingStatus: `Scraping stopped by user. Found ${scrapedCount} jobs. ${formatSkippedJobSummary(data.skippedJobCounts)}`
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

async function handleFetchJobDescription(request) {
    const {
        url,
        jobIndex,
        queueIndex,
        jobId = '',
        sourceJobId = '',
        jobKey = '',
        jobLink = url || ''
    } = request;
    const sendResult = (payload = {}) => {
        chrome.runtime.sendMessage({
            action: 'descriptionFetched',
            jobIndex,
            queueIndex,
            jobId,
            sourceJobId,
            jobKey,
            jobLink,
            success: false,
            ...payload
        }).catch(() => {});
    };

    if (!url) {
        sendResult({ success: false, error: 'No job detail URL was provided.' });
        return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
        const response = await fetch(url, {
            cache: 'no-store',
            credentials: 'omit',
            redirect: 'follow',
            signal: controller.signal
        });
        if (!response.ok) {
            throw new Error(`Job page request failed with HTTP ${response.status}.`);
        }

        const html = await response.text();
        const description = PetfolkDescriptionParser.extractFromHtml(html, sourceJobId);
        sendResult({
            success: true,
            description,
            length: description.length
        });
    } catch (error) {
        const errorMessage = error?.name === 'AbortError'
            ? 'Timed out fetching the job description in the background.'
            : (error?.message || 'Could not fetch the job description in the background.');
        sendResult({ success: false, error: errorMessage });
    } finally {
        clearTimeout(timeoutId);
    }
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

    if (request.action === 'fetchJobDescription') {
        handleFetchJobDescription(request);
        sendResponse({ status: 'descriptionFetchStarted' });
        return false;
    }

    if (request.action === 'fetchJobDetails') {
        handleFetchDetails(request);
        return false;
    }

    return false;
});
