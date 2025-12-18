let isScraping = false;
let sessionScrapedCount = 0;
let totalOnPage = 0;

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
