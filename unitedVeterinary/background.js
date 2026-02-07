// background.js
let isScraping = false;
let currentTabId = null;
let currentIframeFrameId = null;
let currentPage = 0;
let allScrapedJobs = [];
let uniqueJobLinks = new Set();

const IFRAME_ID = "jv_careersite_iframe_id"; // Define it once globally
const IFRAME_PARTIAL_SRC = "jobs.jobvite.com/unitedveterinarycare/";
const SCRAPING_PAGE_LOAD_DELAY_MS = 2000; // Delay to allow AJAX content to load after clicking next

// Function to send status updates to popup.js
function sendStatusToPopup(status, message = '', scrapedCount = 0) {
  chrome.runtime.sendMessage({
    action: 'scrapingStatus',
    status: status,
    message: message,
    scrapedCount: scrapedCount,
    currentPage: currentPage
  });
}

// Function to find the iframe's frameId and inject content script
async function findIframeAndInjectContentScript(tabId) {
    // Step 1: Execute a script in the main frame to get the iframe's actual SRC URL
    let iframeSrcResult;
    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId: tabId, frameIds: [0] }, // Only in the main frame
            function: (iframeIdArg) => { // Renamed parameter to avoid confusion
                const iframe = document.getElementById(iframeIdArg);
                return iframe ? iframe.src : null;
            },
            args: ["jv_careersite_iframe_id"] // Use string literal for the ID
        });
        iframeSrcResult = results[0]?.result;
    } catch (e) {
        console.error("Error getting iframe SRC from main frame:", e);
        sendStatusToPopup('error', `Error getting iframe SRC: ${e.message}`);
        return null;
    }

    if (!iframeSrcResult) {
        console.error(`Iframe with ID '${IFRAME_ID}' not found in the main document, or its SRC is null.`);
        sendStatusToPopup('error', `Iframe '${IFRAME_ID}' not found or SRC is null.`);
        return null;
    }

    // Step 2: Use chrome.webNavigation.getAllFrames to find the frameId by URL
    let frames;
    try {
        frames = await chrome.webNavigation.getAllFrames({ tabId: tabId });
    } catch (e) {
        console.error("Error getting all frames:", e);
        sendStatusToPopup('error', `Error getting all frames: ${e.message}`);
        return null;
    }

    const targetFrame = frames.find(frame =>
        frame.url && frame.url.includes(IFRAME_PARTIAL_SRC)
    );

    if (!targetFrame) {
        console.error(`No iframe frame found matching the partial SRC: ${IFRAME_PARTIAL_SRC}. Actual SRC: ${iframeSrcResult}`);
        sendStatusToPopup('error', `No iframe frame found matching the Jobvite URL.`);
        return null;
    }
    
    currentIframeFrameId = targetFrame.frameId;

    // Step 3: Inject content.js into the identified iframe
    try {
        await chrome.scripting.executeScript({
            target: { tabId: tabId, frameIds: [currentIframeFrameId] },
            files: ['content.js']
        });
    } catch (e) {
        console.error("Content script injection into iframe failed:", e);
        sendStatusToPopup('error', `Content script injection failed: ${e.message}`);
        return null;
    }

    return currentIframeFrameId;
}

async function scrapeAndGoToNext() {
    if (!isScraping) return;

    currentPage++;
    sendStatusToPopup('in_progress', `Scraping page ${currentPage}...`, allScrapedJobs.length);
    console.log(`Scraping page ${currentPage}...`);

    // Scrape current page
    let scrapedJobsOnPage;
    try {
        const response = await chrome.tabs.sendMessage(currentTabId, { action: 'scrapeCurrentPage' }, { frameId: currentIframeFrameId });
        scrapedJobsOnPage = response?.jobs || [];
    } catch (e) {
        console.error(`Error scraping current page: ${e.message}`);
        sendStatusToPopup('error', `Error scraping page ${currentPage}: ${e.message}`);
        isScraping = false;
        return;
    }

    if (scrapedJobsOnPage.length > 0) {
        const newUniqueJobs = [];
        scrapedJobsOnPage.forEach(job => {
            if (job.link && !uniqueJobLinks.has(job.link)) {
                newUniqueJobs.push(job);
                uniqueJobLinks.add(job.link);
            }
        });
        allScrapedJobs.push(...newUniqueJobs);
        
        await new Promise(resolve => {
            chrome.storage.local.set({ scrapedJobs: allScrapedJobs }, () => {
                console.log(`Saved ${newUniqueJobs.length} new unique jobs from page ${currentPage}. Total unique jobs: ${allScrapedJobs.length}`);
                resolve();
            });
        });
    }

    // Check for next page
    let clickedNext = false;
    try {
        const response = await chrome.tabs.sendMessage(currentTabId, { action: 'clickNextPage' }, { frameId: currentIframeFrameId });
        clickedNext = response?.clicked || false;
        if (response?.error) {
            console.error(`Error clicking next page: ${response.error}`);
            sendStatusToPopup('error', `Error clicking next page: ${response.error}`);
            isScraping = false;
            return;
        }
    } catch (e) {
        console.error(`Error sending clickNextPage message: ${e.message}`);
        sendStatusToPopup('error', `Error advancing page: ${e.message}`);
        isScraping = false;
        return;
    }

    if (!clickedNext) {
        console.log("No next page button found or it's disabled. Stopping scraping.");
        isScraping = false;
        sendStatusToPopup('completed', '', allScrapedJobs.length);
    }
    // The rest of the process will be triggered by chrome.tabs.onUpdated
}

// Listen for scrapeJobDescription from records.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'scrapeJobDescription') {
    const { tabId, jobIndex, jobLink } = request;

    chrome.tabs.onUpdated.addListener(function listener(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);

        chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ['description-scraper.js']
        }).then((results) => {
          const description = (results && results[0] && results[0].result) ? results[0].result : '';

          chrome.storage.local.get(['scrapedJobs'], (result) => {
            const jobs = result.scrapedJobs || [];
            if (jobs[jobIndex]) {
              jobs[jobIndex].description = description;

              chrome.storage.local.set({ scrapedJobs: jobs }, () => {
                console.log(`Description saved for job ${jobIndex + 1}`);
                chrome.tabs.remove(tabId);
                chrome.runtime.sendMessage({
                  action: 'descriptionSaved',
                  jobIndex: jobIndex,
                  success: true
                });
              });
            }
          });
        }).catch(err => {
          console.error('Error extracting description:', err);
          chrome.tabs.remove(tabId).catch(() => {});
          chrome.runtime.sendMessage({
            action: 'descriptionSaved',
            jobIndex: jobIndex,
            success: false
          });
        });
      }
    });

    return true;
  }
});

// Listen for messages from popup.js
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    console.log("Message received in background.js:", request.action, "Sender:", sender);

    // Get the active tab ID, as sender.tab might be undefined for popup messages in some contexts
    let activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    let tabId = activeTabs[0]?.id;

    if (!tabId) {
        console.error("Could not determine active tab ID. Cannot proceed with scraping.");
        if (request.action === 'startScraping') {
            sendStatusToPopup('error', 'Scraping cannot start: Could not determine active tab.');
        } else if (request.action === 'stopScraping') {
            sendStatusToPopup('error', 'Scraping cannot stop: Could not determine active tab.');
        }
        return;
    }
    
    currentTabId = tabId;

    if (request.action === 'startScraping') {
        if (isScraping) {
            console.log("Scraping already in progress.");
            sendStatusToPopup('error', 'Scraping is already running.');
            return;
        }
        isScraping = true;
        currentPage = 0;
        allScrapedJobs = [];
        uniqueJobLinks = new Set();

        let existingJobs = await new Promise(resolve => {
            chrome.storage.local.get(['scrapedJobs'], (result) => resolve(result.scrapedJobs || []));
        });
        
        existingJobs.forEach(job => {
            if (job.link) {
                uniqueJobLinks.add(job.link);
                allScrapedJobs.push(job);
            }
        });
        
        const iframeFrameId = await findIframeAndInjectContentScript(currentTabId);
        if (iframeFrameId) {
            scrapeAndGoToNext();
        } else {
            isScraping = false; // Failed to find iframe or inject script
            sendStatusToPopup('error', 'Failed to initialize scraping.');
        }
    } else if (request.action === 'stopScraping') {
        if (isScraping) {
            console.log("Stopping scraping process.");
            isScraping = false;
            // The scrapePages loop will detect this and exit, then send 'stopped' status
        } else {
            console.log("Scraping is not active.");
            sendStatusToPopup('stopped', 'Scraping is not active.');
        }
    }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (tabId === currentTabId && changeInfo.status === 'complete' && isScraping) {
        console.log('Tab updated, re-injecting content script and continuing scraping.');
        const iframeFrameId = await findIframeAndInjectContentScript(tabId);
        if (iframeFrameId) {
            // Add a small delay to ensure the content script is ready
            setTimeout(scrapeAndGoToNext, 2000);
        } else {
            console.error("Failed to find iframe after navigation, stopping scraping.");
            isScraping = false;
            sendStatusToPopup('error', 'Failed to find the job listings iframe after page navigation.');
        }
    }
});