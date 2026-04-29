// background.js
let isScraping = false;
let currentTabId = null;
let currentPage = 0;
let allScrapedJobs = [];
let uniqueJobLinks = new Set();

async function injectContentScript(tabId) {
    try {
        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content.js']
        });
        return true;
    } catch (e) {
        return false;
    }
}

function sendStatusToPopup(status, message = '', scrapedCount = 0) {
  chrome.runtime.sendMessage({
    action: 'scrapingStatus',
    status: status,
    message: message,
    scrapedCount: scrapedCount,
    currentPage: currentPage
  }).catch(() => {});
}

async function fetchDetailsAsync(url) {
    return new Promise((resolve) => {
        if (!url) { resolve([]); return; }
        let finalUrl = url;
        try {
            const urlObj = new URL(url);
            if (urlObj.hostname.includes('jobvite.com')) {
                urlObj.searchParams.set('nl', '1');
                finalUrl = urlObj.toString();
            }
        } catch (e) { resolve([]); return; }
        chrome.tabs.create({ url: finalUrl, active: false }, (tab) => {
            if (!tab) { resolve([]); return; }
            const listener = (tabId, info) => {
                if (tabId === tab.id && info.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(listener);
                    setTimeout(() => {
                        chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['detail-extractor.js'] })
                        .then((results) => {
                            chrome.tabs.remove(tab.id).catch(() => {});
                            resolve(results?.[0]?.result || []);
                        }).catch(() => {
                            chrome.tabs.remove(tab.id).catch(() => {});
                            resolve([]);
                        });
                    }, 3000);
                }
            };
            chrome.tabs.onUpdated.addListener(listener);
        });
    });
}

async function scrapeAndGoToNext() {
    if (!isScraping) return;
    currentPage++;
    sendStatusToPopup('in_progress', `Scraping page ${currentPage}...`, allScrapedJobs.length);
    let scrapedJobsOnPage;
    try {
        const response = await chrome.tabs.sendMessage(currentTabId, { action: 'scrapeCurrentPage' });
        scrapedJobsOnPage = response?.jobs || [];
    } catch (e) {
        isScraping = false;
        sendStatusToPopup('error', `Error scraping page ${currentPage}: ${e.message}`);
        return;
    }

    if (scrapedJobsOnPage.length > 0) {
        for (const job of scrapedJobsOnPage) {
            if (!isScraping) break;
            if (job.link && !uniqueJobLinks.has(job.link)) {
                // Just add the job without fetching details
                allScrapedJobs.push(job);
                uniqueJobLinks.add(job.link);
            }
        }
        await chrome.storage.local.set({ scrapedJobs: allScrapedJobs });
    }

    let clickedNext = false;
    try {
        const response = await chrome.tabs.sendMessage(currentTabId, { action: 'clickNextPage' });
        clickedNext = response?.clicked || false;
    } catch (e) { isScraping = false; return; }

    if (!clickedNext) {
        isScraping = false;
        sendStatusToPopup('completed', `Scraping completed! Found ${allScrapedJobs.length} jobs. Use "View Records" to see them and click "Fetch Details" to get additional information.`, allScrapedJobs.length);
    } else {
        setTimeout(scrapeAndGoToNext, 2000);
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startScraping') {
    handleStartScraping(sendResponse);
    return true;
  } else if (request.action === 'stopScraping') {
    isScraping = false;
    sendResponse({ status: 'stopped' });
  } else if (request.action === 'scrapeJobDescription') {
    handleScrapeDescription(request);
    return true;
  } else if (request.action === 'fetchJobDetails') {
    handleFetchDetails(request);
    return true;
  }
});

async function handleStartScraping(sendResponse) {
    if (isScraping) { sendResponse({ status: 'alreadyScraping' }); return; }
    let activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTabId = activeTabs[0]?.id;
    if (!currentTabId) { sendResponse({ status: 'error', message: 'No active tab found.' }); return; }

    isScraping = true;
    currentPage = 0;
    allScrapedJobs = [];
    uniqueJobLinks = new Set();

    sendStatusToPopup('scraping', 'Initializing scraper...');
    const injected = await injectContentScript(currentTabId);
    if (!injected) {
        isScraping = false;
        sendStatusToPopup('error', 'Failed to inject scraper into the active page.');
        return;
    }

    sendStatusToPopup('scraping', 'Starting to scrape jobs...', 0);
    scrapeAndGoToNext();
    sendResponse({ status: 'scrapingStarted' });
}

function handleScrapeDescription(request) {
    const { tabId, jobIndex, jobLink } = request;
    let settled = false;
    let injecting = false;
    let timeoutId = null;
    let retryCount = 0;
    const maxRetries = 1;

    const cleanup = () => {
      chrome.tabs.onUpdated.removeListener(listener);
      if (timeoutId) clearTimeout(timeoutId);
    };

    const fail = (message) => {
      if (settled) return;
      settled = true;
      cleanup();
      chrome.tabs.remove(tabId).catch(() => {});
      chrome.runtime.sendMessage({
        action: 'descriptionFailed',
        jobIndex: jobIndex,
        message: message || 'Failed to fetch description.'
      }).catch(() => {});
    };

    const retryFromErrorPage = async (reasonMessage) => {
      if (settled || retryCount >= maxRetries) {
        fail(reasonMessage || 'Failed to fetch description.');
        return;
      }

      retryCount++;
      injecting = false;
      cleanup();

      try {
        // Re-open the intended job URL in the same tab in case Chrome loaded an internal error page.
        const retryUrl = (() => {
          try {
            const u = new URL(jobLink || '');
            u.searchParams.set('nl', '1');
            return u.toString();
          } catch {
            return jobLink || null;
          }
        })();

        if (!retryUrl) {
          fail(reasonMessage || 'Retry failed: missing job URL.');
          return;
        }

        timeoutId = setTimeout(() => {
          fail('Timed out waiting for the job page to load.');
        }, 30000);

        chrome.tabs.onUpdated.addListener(listener);
        await chrome.tabs.update(tabId, { url: retryUrl });
      } catch (e) {
        fail(e.message || reasonMessage || 'Retry failed.');
      }
    };

    const injectAndSave = async () => {
      if (settled || injecting) return;
      injecting = true;
      cleanup();

      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ['description-scraper.js']
        });
        const description = (results && results[0] && results[0].result) ? results[0].result : '';
        if (!description || description.trim().length < 50) {
          fail('Description scraper returned empty content.');
          return;
        }

        chrome.storage.local.get(['scrapedJobs'], (result) => {
          const jobs = result.scrapedJobs || [];
          if (!jobs[jobIndex]) {
            fail('Job no longer exists in storage.');
            return;
          }

          jobs[jobIndex].description = description;
          delete jobs[jobIndex].descriptionFetchFailed;
          delete jobs[jobIndex].descriptionError;
          settled = true;
          chrome.storage.local.set({ scrapedJobs: jobs }, () => {
            chrome.tabs.remove(tabId).catch(() => {});
            chrome.runtime.sendMessage({ action: 'descriptionSaved', jobIndex: jobIndex }).catch(() => {});
          });
        });
      } catch (e) {
        const msg = (e && e.message) ? e.message : 'Failed to run description scraper.';
        if (/Frame with ID 0 is showing error page/i.test(msg) || /error page/i.test(msg)) {
          retryFromErrorPage(msg);
          return;
        }
        fail(msg);
      }
    };

    function listener(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === 'complete') {
        injectAndSave();
      }
    }

    timeoutId = setTimeout(() => {
      fail('Timed out waiting for the job page to load.');
    }, 30000);

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId)
      .then((tab) => {
        if (tab?.status === 'complete') {
          injectAndSave();
        }
      })
      .catch((e) => fail(e.message));
}

async function handleFetchDetails(request) {
    const { url, jobIndex } = request;
    const detailsList = await fetchDetailsAsync(url);
    chrome.runtime.sendMessage({ action: 'detailsFetched', details: detailsList, jobIndex: jobIndex }).catch(() => {});
}

