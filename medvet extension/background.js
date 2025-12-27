let isScraping = false;
let sessionScrapedCount = 0;
let totalOnPage = 0;

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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.command === 'start') {
    isScraping = true;
    sessionScrapedCount = 0;
    totalOnPage = 0;
    startScraping();
    sendResponse({ status: 'started' });
  } else if (request.command === 'stop') {
    isScraping = false;
    sendResponse({ status: 'stopped' });
  } else if (request.command === 'get-status') {
    chrome.storage.local.get({ records: [] }, (result) => {
      sendResponse({
        isScraping,
        sessionCount: sessionScrapedCount,
        pageTotal: totalOnPage,
        totalRecords: result.records.length
      });
    });
  } else if (request.command === 'page-total') {
    totalOnPage = request.count;
    chrome.runtime.sendMessage({ command: 'page-total-update', count: totalOnPage });
  } else if (request.command === 'finished') {
    isScraping = false;
    chrome.runtime.sendMessage({ command: 'scraping_finished' });
  } else if (request.command === 'add-records') {
    if (isScraping) {
      sessionScrapedCount += request.records.length;
      chrome.runtime.sendMessage({ command: 'session-update', count: sessionScrapedCount });
      chrome.storage.local.get({ records: [] }, (result) => {
        const allRecords = result.records.concat(request.records);
        chrome.storage.local.set({ records: allRecords });
      });
    }
  } else if (request.command === 'fetch-job-description') {
    (async () => {
      try {
        await setupOffscreenDocument('offscreen.html');
        const jobUrl = request.url;
        const response = await fetch(jobUrl);
        const html = await response.text();

        // Send HTML to offscreen document for parsing
        const parsingResponse = await chrome.runtime.sendMessage({
          command: 'parse-html',
          html: html
        });
        sendResponse({ description: parsingResponse.description });
      } catch (error) {
        console.error('Error in fetch-job-description:', error);
        sendResponse({ description: 'Error fetching description.' });
      }
    })();
    return true; // Indicates that the response is sent asynchronously
  }
  return true; // Indicates that the response is sent asynchronously
});

function startScraping() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        files: ['content.js'],
      });
    }
  });
}
