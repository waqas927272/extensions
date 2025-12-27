// background.js
let isScraping = false;
let currentTabId = null;
let currentIframeFrameId = null;
let currentPage = 0;

let offscreenCreating; // A global promise to avoid race conditions and ensure the offscreen document is only created once.

async function setupOffscreenDocument(path) {
  // Check if an offscreen document is already open
  const offscreenUrl = chrome.runtime.getURL(path);
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl],
  });

  if (existingContexts.length > 0) {
    return; // An offscreen document is already open
  }

  // Create and wait for the offscreen document to load
  if (offscreenCreating) {
    await offscreenCreating;
  } else {
    offscreenCreating = chrome.offscreen.createDocument({
      url: path,
      reasons: ['DOM_PARSER'],
      justification: 'Parse HTML from job descriptions',
    });
    await offscreenCreating;
    offscreenCreating = null;
  }
}

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

// Main scraping loop
async function scrapePages() {
    currentPage = 0;
    sendStatusToPopup('starting');

    let allScrapedJobs = [];
    // Use a Set to keep track of unique job links to prevent duplicates
    let uniqueJobLinks = new Set();

    let existingJobs = await new Promise(resolve => {
        chrome.storage.local.get(['scrapedJobs'], (result) => resolve(result.scrapedJobs || []));
    });
    
    // Populate allScrapedJobs and uniqueJobLinks with existing data
    existingJobs.forEach(job => {
        if (job.link) {
            uniqueJobLinks.add(job.link);
            allScrapedJobs.push(job);
        }
    });

    while (isScraping) {
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
            break;
        }

        if (scrapedJobsOnPage.length > 0) {
            // Fetch descriptions and hospital names for jobs on the current page
            const jobsWithDetails = await Promise.all(scrapedJobsOnPage.map(async (job) => {
                if (job.link) {
                    try {
                        const response = await chrome.runtime.sendMessage({
                            command: 'fetch-job-description',
                            url: job.link
                        });
                        job.description = response.description || 'N/A';
                        job.hospitalName = response.hospitalName || 'N/A';
                    } catch (error) {
                        console.error('Error fetching details for job:', job.link, error);
                        job.description = 'Error fetching description.';
                        job.hospitalName = 'N/A';
                    }
                }
                return job;
            }));

            const newUniqueJobs = [];
            jobsWithDetails.forEach(job => { // Iterate through jobsWithDetails
                if (job.link && !uniqueJobLinks.has(job.link)) {
                    newUniqueJobs.push(job);
                    uniqueJobLinks.add(job.link);
                }
            });
            allScrapedJobs.push(...newUniqueJobs);
            
            // Update storage with all accumulated unique jobs after each page
            await new Promise(resolve => {
                chrome.storage.local.set({ scrapedJobs: allScrapedJobs }, () => {
                    console.log(`Saved ${newUniqueJobs.length} new unique jobs with details from page ${currentPage}. Total unique jobs: ${allScrapedJobs.length}`);
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
                break;
            }
        } catch (e) {
            console.error(`Error sending clickNextPage message: ${e.message}`);
            sendStatusToPopup('error', `Error advancing page: ${e.message}`);
            isScraping = false;
            break;
        }

        if (!clickedNext) {
            console.log("No next page button found or it's disabled. Stopping scraping.");
            isScraping = false;
        }

        if (isScraping) {
            // Add a fixed delay to allow AJAX content to load after clicking next
            await new Promise(resolve => setTimeout(resolve, SCRAPING_PAGE_LOAD_DELAY_MS));
        }
    }

    // Scraping finished (either completed or stopped by user)
    sendStatusToPopup(isScraping ? 'completed' : 'stopped', '', allScrapedJobs.length);
    isScraping = false; // Ensure it's false
    console.log(`Scraping process finished. Total jobs scraped: ${allScrapedJobs.length}`);
}

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
    
    currentTabId = tabId; // Set currentTabId to the explicitly queried active tab ID

    if (request.action === 'startScraping') {
        if (isScraping) {
            console.log("Scraping already in progress.");
            sendStatusToPopup('error', 'Scraping is already running.');
            return;
        }
        isScraping = true;
        
        const iframeFrameId = await findIframeAndInjectContentScript(currentTabId);
        if (iframeFrameId) {
            scrapePages();
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
    } else if (request.command === 'fetch-job-description') { // New handler
        (async () => {
            try {
                await setupOffscreenDocument('offscreen.html');
                const jobUrl = request.url;
                console.log("Background: Fetching job URL for description:", jobUrl);
                const response = await fetch(jobUrl); // This response is HTML content
                const html = await response.text();
                console.log("Background: HTML fetched, sending to offscreen for parsing.");

                const parsingResponse = await chrome.runtime.sendMessage({
                    command: 'parse-html',
                    html: html
                });
                console.log("Background: Received parsingResponse from offscreen:", parsingResponse);

                if (!parsingResponse) {
                    console.error("Background: parsingResponse is undefined from offscreen script.");
                    sendResponse({ description: 'Error: No response from offscreen.', hospitalName: 'N/A' });
                    return;
                }
                sendResponse({ description: parsingResponse.description, hospitalName: parsingResponse.hospitalName });
            } catch (error) {
                console.error('Error in fetch-job-description:', error);
                sendResponse({ description: 'Error fetching description.', hospitalName: 'N/A' });
            }
        })();
        return true; // Indicates that the response is sent asynchronously
    } else if (request.command === 'send-to-webhook') { // New handler
        (async () => {
            try {
                const webhookUrl = request.url;
                const records = request.records;

                const response = await fetch(webhookUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ data: records, parentClientName: "United Veterinary" }) // Adapt parentClientName
                });

                if (response.ok) {
                    sendResponse({ success: true });
                } else {
                    const errorText = await response.text();
                    sendResponse({ success: false, error: `Webhook responded with status ${response.status}: ${errorText}` });
                }
            } catch (error) {
                console.error('Error sending data to webhook:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true; // Indicates that the response is sent asynchronously
    }
});