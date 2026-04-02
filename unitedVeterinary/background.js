// background.js
let isScraping = false;
let currentTabId = null;
let currentIframeFrameId = null;
let currentPage = 0;
let allScrapedJobs = [];
let uniqueJobLinks = new Set();

const IFRAME_ID = "jv_careersite_iframe_id";
const IFRAME_PARTIAL_SRC = "jobs.jobvite.com/unitedveterinarycare/";

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
                const isMulti = job.location && (job.location.toLowerCase().includes('location') || job.location.includes('...'));
                if (isMulti) {
                    console.log(`Splitting multi-location job: ${job.title}`);
                    const detailsList = await fetchDetailsAsync(job.link);
                    if (detailsList && detailsList.length > 0) {
                        detailsList.forEach((details, index) => {
                            allScrapedJobs.push({
                                ...job, ...details,
                                jobId: `${job.jobId}-${index + 1}`,
                                hospital: details.hospitalName || job.hospital,
                                location: details.location || `${details.city}, ${details.state}`
                            });
                        });
                    } else { allScrapedJobs.push(job); }
                } else { allScrapedJobs.push(job); }
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
    if (!clickedNext) { isScraping = false; sendStatusToPopup('completed', '', allScrapedJobs.length); }
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
    isScraping = true; currentPage = 0; allScrapedJobs = []; uniqueJobLinks = new Set();
    sendStatusToPopup('scraping', 'Applying filters and searching...');
    const iframeFrameId = await findIframeAndInjectContentScript(currentTabId);
    if (!iframeFrameId) { isScraping = false; sendStatusToPopup('error', 'Failed to find job listings iframe.'); return; }
    try {
        await chrome.scripting.executeScript({
            target: { tabId: currentTabId, frameIds: [iframeFrameId] },
            func: () => {
                const categorySelect = document.getElementById('jv-search-category');
                const searchButton = document.querySelector('.jv-search-form .jv-button-primary');
                if (categorySelect && searchButton) {
                    const targetCategories = ["Specialty Diplomate", "Surgeon Diplomate", "Veterinarian (ER)", "Veterinarian (Gen Practice)"];
                    Array.from(categorySelect.options).forEach(opt => {
                        const val = opt.value.trim();
                        const txt = opt.text.trim();
                        opt.selected = targetCategories.includes(val) || targetCategories.includes(txt);
                    });
                    categorySelect.dispatchEvent(new Event('change', { bubbles: true }));
                    searchButton.click();
                    return true;
                }
                return false;
            }
        });
        setTimeout(async () => {
            const newIframeId = await findIframeAndInjectContentScript(currentTabId);
            if (newIframeId) scrapeAndGoToNext();
            else { isScraping = false; sendStatusToPopup('error', 'Failed to re-initialize scraping after search.'); }
        }, 4000);
    } catch (e) { isScraping = false; sendStatusToPopup('error', 'Error applying filters: ' + e.message); }
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
    if (tabId === currentTabId && changeInfo.status === 'complete' && isScraping) {
        const iframeFrameId = await findIframeAndInjectContentScript(tabId);
        if (iframeFrameId) setTimeout(scrapeAndGoToNext, 2000);
    }
});
