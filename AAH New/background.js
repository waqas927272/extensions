// background.js
let isScraping = false;
let currentTabId = null;
let currentIframeFrameId = null;
let currentPage = 0;
let allScrapedJobs = [];
let uniqueJobLinks = new Set();
let currentScrapeMode = 'jobvite';

const IFRAME_ID = "jv_careersite_iframe_id";
const IFRAME_PARTIAL_SRC = "jobs.jobvite.com/unitedveterinarycare/";
const ALLIANCE_CLINIC_JOBS_PATH = "allianceanimal.com/careers/clinic-jobs";

function sendStatusToPopup(status, message = '', scrapedCount = 0) {
  chrome.runtime.sendMessage({
    action: 'scrapingStatus',
    status: status,
    message: message,
    scrapedCount: scrapedCount,
    currentPage: currentPage
  }).catch(() => {});
}

async function findIframeAndInjectContentScript(tabId) {
    let iframeSrcResult;
    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId: tabId, frameIds: [0] },
            function: (iframeIdArg) => {
                const iframe = document.getElementById(iframeIdArg);
                return iframe ? iframe.src : null;
            },
            args: [IFRAME_ID]
        });
        iframeSrcResult = results[0]?.result;
    } catch (e) { return null; }
    if (!iframeSrcResult) return null;
    let frames = await chrome.webNavigation.getAllFrames({ tabId: tabId });
    const targetFrame = frames.find(frame => frame.url && frame.url.includes(IFRAME_PARTIAL_SRC));
    if (!targetFrame) return null;
    currentIframeFrameId = targetFrame.frameId;
    try {
        await chrome.scripting.executeScript({
            target: { tabId: tabId, frameIds: [currentIframeFrameId] },
            files: ['content.js']
        });
    } catch (e) { return null; }
    return currentIframeFrameId;
}

async function injectContentScript(tabId, frameId = 0) {
    try {
        await chrome.scripting.executeScript({
            target: { tabId: tabId, frameIds: [frameId] },
            files: ['content.js']
        });
        return true;
    } catch (e) {
        return false;
    }
}

async function isAllianceClinicJobsPage(tabId, tabUrl = '') {
    if (tabUrl && tabUrl.includes(ALLIANCE_CLINIC_JOBS_PATH)) return true;
    try {
        const result = await chrome.scripting.executeScript({
            target: { tabId: tabId, frameIds: [0] },
            func: () => !!document.querySelector('#jobsListingContainer')
        });
        return !!result?.[0]?.result;
    } catch (e) {
        return false;
    }
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
        const response = await chrome.tabs.sendMessage(currentTabId, { action: 'scrapeCurrentPage' }, { frameId: currentIframeFrameId });
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
        const response = await chrome.tabs.sendMessage(currentTabId, { action: 'clickNextPage' }, { frameId: currentIframeFrameId });
        clickedNext = response?.clicked || false;
    } catch (e) { isScraping = false; return; }

    if (!clickedNext) {
        isScraping = false;
        sendStatusToPopup('completed', `Scraping completed! Found ${allScrapedJobs.length} jobs. Use "View Records" to see them and click "Fetch Details" to get additional information.`, allScrapedJobs.length);
    } else if (currentScrapeMode === 'alliance') {
        setTimeout(scrapeAndGoToNext, 1500);
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
    const activeTab = activeTabs[0];
    currentTabId = activeTab?.id;
    if (!currentTabId) { sendResponse({ status: 'error', message: 'No active tab found.' }); return; }

    isScraping = true;
    currentPage = 0;
    allScrapedJobs = [];
    uniqueJobLinks = new Set();

    const isAlliancePage = await isAllianceClinicJobsPage(currentTabId, activeTab?.url || '');
    if (isAlliancePage) {
        currentScrapeMode = 'alliance';
        currentIframeFrameId = 0;
        sendStatusToPopup('scraping', 'Applying Alliance Animal Health job type filter...');

        const injected = await injectContentScript(currentTabId, 0);
        if (!injected) {
            isScraping = false;
            sendStatusToPopup('error', 'Failed to initialize the Alliance jobs page scraper.');
            sendResponse({ status: 'error', message: 'Failed to initialize scraper.' });
            return;
        }

        try {
            const filterResult = await chrome.tabs.sendMessage(
                currentTabId,
                { action: 'applyFiltersAndSearch' },
                { frameId: 0 }
            );

            if (filterResult?.success) {
                sendStatusToPopup('scraping', filterResult.message || 'Filter applied, waiting for results...', 0);
                setTimeout(() => {
                    if (isScraping) {
                        sendStatusToPopup('scraping', 'Starting to scrape Alliance jobs...', 0);
                        scrapeAndGoToNext();
                    }
                }, 3000);
                sendResponse({ status: 'scrapingStarted' });
                return;
            }

            isScraping = false;
            const message = filterResult?.error || filterResult?.message || 'Failed to apply the Alliance job type filter.';
            sendStatusToPopup('error', message);
            sendResponse({ status: 'error', message });
            return;
        } catch (e) {
            isScraping = false;
            sendStatusToPopup('error', 'Error applying Alliance filter: ' + e.message);
            sendResponse({ status: 'error', message: e.message });
            return;
        }
    }

    currentScrapeMode = 'jobvite';
    sendStatusToPopup('scraping', 'Applying filters and searching...');
    const iframeFrameId = await findIframeAndInjectContentScript(currentTabId);
    if (!iframeFrameId) {
        isScraping = false;
        sendStatusToPopup('error', 'Failed to find job listings iframe.');
        sendResponse({ status: 'error', message: 'Failed to find job listings iframe.' });
        return;
    }

    try {
        const result = await chrome.scripting.executeScript({
            target: { tabId: currentTabId, frameIds: [iframeFrameId] },
            func: () => {
                const categorySelect = document.getElementById('jv-search-category');
                const jobTypeSelect = document.getElementById('jv-search-type');
                const searchButton = document.querySelector('.jv-search-form .jv-button-primary');

                if (!categorySelect || !jobTypeSelect || !searchButton) {
                    return { success: false, message: 'Could not find filter elements' };
                }

                // Select Category options
                const targetCategories = ["Specialty Diplomate", "Surgeon Diplomate", "Veterinarian (ER)", "Veterinarian (Gen Practice)"];
                let categoryCount = 0;
                Array.from(categorySelect.options).forEach(opt => {
                    const val = opt.value.trim();
                    const txt = opt.text.trim();
                    if (targetCategories.includes(val) || targetCategories.includes(txt)) {
                        opt.selected = true;
                        categoryCount++;
                    }
                });
                categorySelect.dispatchEvent(new Event('change', { bubbles: true }));

                // Select Job Type options
                const targetJobTypes = ["Full-Time", "Part Time or Full Time", "Part-Time"];
                let jobTypeCount = 0;
                Array.from(jobTypeSelect.options).forEach(opt => {
                    const val = opt.value.trim();
                    const txt = opt.text.trim();
                    if (targetJobTypes.includes(val) || targetJobTypes.includes(txt)) {
                        opt.selected = true;
                        jobTypeCount++;
                    }
                });
                jobTypeSelect.dispatchEvent(new Event('change', { bubbles: true }));

                // Click search button
                searchButton.click();

                return {
                    success: true,
                    message: 'Filters applied and search initiated',
                    categoryCount: categoryCount,
                    jobTypeCount: jobTypeCount
                };
            }
        });

        const filterResult = result?.[0]?.result;
        if (filterResult?.success) {
            sendStatusToPopup('scraping', 'Filters applied, waiting for results to load...', 0);
            // Wait for page to load, then wait 3 more seconds, then start scraping
            setTimeout(async () => {
                const newIframeId = await findIframeAndInjectContentScript(currentTabId);
                if (newIframeId) {
                    sendStatusToPopup('scraping', 'Starting to scrape jobs...', 0);
                    scrapeAndGoToNext();
                } else {
                    isScraping = false;
                    sendStatusToPopup('error', 'Failed to re-initialize scraping after search.');
                }
            }, 7000); // 4 seconds for page load + 3 seconds additional wait
        } else {
            isScraping = false;
            sendStatusToPopup('error', filterResult?.message || 'Failed to apply filters');
        }
    } catch (e) {
        isScraping = false;
        sendStatusToPopup('error', 'Error applying filters: ' + e.message);
    }

    sendResponse({ status: 'scrapingStarted' });
}

function handleScrapeDescription(request) {
    const { tabId, jobIndex } = request;
    chrome.tabs.onUpdated.addListener(function listener(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['description-scraper.js'] }).then((results) => {
          const description = (results && results[0] && results[0].result) ? results[0].result : '';
          chrome.storage.local.get(['scrapedJobs'], (result) => {
            const jobs = result.scrapedJobs || [];
            if (jobs[jobIndex]) {
              jobs[jobIndex].description = description;
              chrome.storage.local.set({ scrapedJobs: jobs }, () => {
                chrome.tabs.remove(tabId).catch(() => {});
                chrome.runtime.sendMessage({ action: 'descriptionSaved', jobIndex: jobIndex }).catch(() => {});
              });
            }
          });
        }).catch(() => { chrome.tabs.remove(tabId).catch(() => {}); });
      }
    });
}

async function handleFetchDetails(request) {
    const { url, jobIndex } = request;
    const detailsList = await fetchDetailsAsync(url);
    chrome.runtime.sendMessage({ action: 'detailsFetched', details: detailsList, jobIndex: jobIndex }).catch(() => {});
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    // Continue scraping on page load when in scraping mode and pagination is active
    if (tabId === currentTabId && changeInfo.status === 'complete' && isScraping && currentPage > 0) {
        const iframeFrameId = await findIframeAndInjectContentScript(tabId);
        if (iframeFrameId) {
            // Wait 3 seconds before scraping next page
            setTimeout(scrapeAndGoToNext, 3000);
        }
    }
});
