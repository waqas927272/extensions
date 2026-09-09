// VIP - Background Service Worker

console.log("VIP background script loaded");

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "scrapeProgress") {
    chrome.runtime.sendMessage(request).catch(() => {});
  }

  if (request.action === 'scrapeJobDescription') {
    handleScrapeDescription(request);
    return true;
  }

  return true;
});

function handleScrapeDescription(request) {
    const { tabId, jobIndex } = request;
    let settled = false;
    let extracting = false;

    const listener = (updatedTabId, info) => {
      if (updatedTabId === tabId && info.status === 'complete') extract();
    };

    const finish = (success, error = '') => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      chrome.tabs.remove(tabId).catch(() => {});
      chrome.runtime.sendMessage({
        action: 'descriptionSaved',
        jobIndex,
        success,
        error
      }).catch(() => {});
    };

    const extract = async () => {
      if (extracting || settled) return;
      extracting = true;
      chrome.tabs.onUpdated.removeListener(listener);
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          files: ['greenhouse-description-scraper.js']
        });
        const description = results?.[0]?.result || '';
        if (!description || description.length < 50 || /^Error scraping description:/i.test(description)) {
          throw new Error('No usable description was extracted.');
        }

        const result = await chrome.storage.local.get(['vipvetJobs']);
        const jobs = result.vipvetJobs || [];
        if (!jobs[jobIndex]) throw new Error('The target job no longer exists.');
        jobs[jobIndex].description = description;
        await chrome.storage.local.set({ vipvetJobs: jobs });
        console.log(`Description saved for job ${jobIndex + 1}`);
        finish(true);
      } catch (error) {
        console.error('Error extracting description:', error);
        finish(false, error?.message || 'Description extraction failed.');
      }
    };

    const timeout = setTimeout(() => finish(false, 'Description extraction timed out.'), 25000);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then(tab => {
      if (tab?.status === 'complete') extract();
    }).catch(error => finish(false, error?.message || 'Unable to access the job tab.'));
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("VIP installed");
});


