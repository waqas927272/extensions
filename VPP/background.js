// VetPractice Scraper - Background Service Worker

console.log("Background script loaded");

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'scrapeJobDescription') {
    handleScrapeDescription(request);
    return true;
  }

  return true;
});

function handleScrapeDescription(request) {
    const { tabId, jobIndex } = request;

    chrome.tabs.onUpdated.addListener(function listener(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);

        // Small delay for dynamic content
        setTimeout(() => {
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
                            chrome.tabs.remove(tabId).catch(() => {});
                            chrome.runtime.sendMessage({
                                action: 'descriptionSaved',
                                jobIndex: jobIndex,
                                success: true
                            }).catch(() => {});
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
                }).catch(() => {});
            });
        }, 2000);
      }
    });
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("Extension installed");
});
