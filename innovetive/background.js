// Innovetive Petcare - Background Service Worker
let isScraping = false;
let currentTabId = null;
let scrapedJobs = [];

const CAREERS_URL_PATTERN = /https:\/\/innovetivepetcare\.pinpointhq\.com\/all-opportunities/i;

function normalizeJob(job) {
  const normalized = {
    jobTitle: job.jobTitle || job.title || '',
    title: job.title || job.jobTitle || '',
    jobId: job.jobId || '',
    hospitalName: job.hospitalName || job.hospital || '',
    hospital: job.hospital || job.hospitalName || '',
    location: job.location || '',
    areaOfPractice: job.areaOfPractice || '',
    position: job.position || '',
    salary: job.salary || '',
    jobType: job.jobType || job.employmentType || '',
    link: job.link || '',
    description: job.description || ''
  };

  return normalized;
}

function sendStatusToPopup(status, message = '', scrapedCount = scrapedJobs.length, extra = {}) {
  chrome.runtime.sendMessage({
    action: 'scrapingStatus',
    status,
    message,
    scrapedCount,
    currentPage: extra.currentPage,
    totalPages: extra.totalPages
  }).catch(() => {});
}

async function saveScrapedJobs(jobs) {
  scrapedJobs = (jobs || []).map(normalizeJob);
  await chrome.storage.local.set({
    scrapedJobs,
    jobs: scrapedJobs
  });
}

async function handleStartScraping(sendResponse) {
  if (isScraping) {
    sendResponse({ status: 'alreadyScraping' });
    return;
  }

  const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = activeTabs[0];
  currentTabId = tab?.id || null;

  if (!tab || !currentTabId) {
    sendResponse({ status: 'error', message: 'No active tab found.' });
    return;
  }

  if (!CAREERS_URL_PATTERN.test(tab.url || '')) {
    sendStatusToPopup('error', 'Open the Innovetive Petcare all opportunities page before scraping.');
    sendResponse({ status: 'error', message: 'Wrong page.' });
    return;
  }

  isScraping = true;
  scrapedJobs = [];
  await chrome.storage.local.set({ scrapedJobs: [], jobs: [] });
  sendStatusToPopup('scraping', 'Starting Innovetive listing scrape...', 0);

  try {
    await chrome.scripting.executeScript({
      target: { tabId: currentTabId },
      files: ['content.js']
    });
    sendResponse({ status: 'scrapingStarted' });
  } catch (error) {
    isScraping = false;
    sendStatusToPopup('error', 'Unable to inject listing scraper. Check that the careers page is open.');
    sendResponse({ status: 'error', message: error.message });
  }
}

function handleScrapeDescription(request) {
  const { tabId, jobIndex } = request;

  chrome.tabs.onUpdated.addListener(function listener(updatedTabId, info) {
    if (updatedTabId === tabId && info.status === 'complete') {
      chrome.tabs.onUpdated.removeListener(listener);

      setTimeout(() => {
        chrome.scripting.executeScript({
          target: { tabId },
          files: ['description-scraper.js']
        }).then((results) => {
          const description = results?.[0]?.result || '';

          chrome.storage.local.get(['scrapedJobs', 'jobs'], (result) => {
            const jobs = result.scrapedJobs || result.jobs || [];
            if (jobs[jobIndex]) {
              jobs[jobIndex].description = description;
              chrome.storage.local.set({ scrapedJobs: jobs, jobs }, () => {
                chrome.tabs.remove(tabId).catch(() => {});
                chrome.runtime.sendMessage({
                  action: 'descriptionSaved',
                  jobIndex,
                  success: true
                }).catch(() => {});
              });
            } else {
              chrome.tabs.remove(tabId).catch(() => {});
              chrome.runtime.sendMessage({
                action: 'descriptionSaved',
                jobIndex,
                success: false
              }).catch(() => {});
            }
          });
        }).catch(() => {
          chrome.tabs.remove(tabId).catch(() => {});
          chrome.runtime.sendMessage({
            action: 'descriptionSaved',
            jobIndex,
            success: false
          }).catch(() => {});
        });
      }, 2000);
    }
  });
}

function handleFetchDetails(request) {
  const { url, jobIndex } = request;

  if (!url) {
    chrome.runtime.sendMessage({ action: 'detailsFetched', details: {}, jobIndex }).catch(() => {});
    return;
  }

  chrome.tabs.create({ url, active: false }, (tab) => {
    if (!tab) {
      chrome.runtime.sendMessage({ action: 'detailsFetched', details: {}, jobIndex }).catch(() => {});
      return;
    }

    chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
      if (tabId === tab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);

        setTimeout(() => {
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['detail-extractor.js']
          }).then((results) => {
            const details = results?.[0]?.result || {};
            chrome.tabs.remove(tab.id).catch(() => {});
            chrome.runtime.sendMessage({
              action: 'detailsFetched',
              details,
              jobIndex
            }).catch(() => {});
          }).catch(() => {
            chrome.tabs.remove(tab.id).catch(() => {});
            chrome.runtime.sendMessage({
              action: 'detailsFetched',
              details: {},
              jobIndex
            }).catch(() => {});
          });
        }, 3000);
      }
    });
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startScraping') {
    handleStartScraping(sendResponse);
    return true;
  }

  if (request.action === 'stopScraping') {
    isScraping = false;
    sendStatusToPopup('stopped', `Scraping stopped. Saved ${scrapedJobs.length} jobs.`, scrapedJobs.length);
    sendResponse({ status: 'stopped' });
    return true;
  }

  if (request.action === 'scrapeJobDescription') {
    handleScrapeDescription(request);
    return true;
  }

  if (request.action === 'fetchJobDetails') {
    handleFetchDetails(request);
    return true;
  }

  if (request.status === 'scraping_progress') {
    sendStatusToPopup('in_progress', request.message || 'Scraping jobs...', scrapedJobs.length);
  }

  if (request.status === 'scraping_complete') {
    isScraping = false;
    saveScrapedJobs(request.jobs || []).then(() => {
      sendStatusToPopup(
        'completed',
        `Scraping completed! Found ${scrapedJobs.length} jobs. Use View Records to fetch details and descriptions.`,
        scrapedJobs.length,
        { totalPages: request.totalPages }
      );
    });
  }

  if (request.status === 'scraping_error') {
    isScraping = false;
    sendStatusToPopup('error', request.error || 'Listing scrape failed.', scrapedJobs.length);
  }
});
