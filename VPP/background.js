// VPP Job Scraper - Background Service Worker

console.log("VPP Job Scraper background script loaded");

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "scrapeProgress") {
    chrome.runtime.sendMessage(request).catch(() => {});
  }

  if (request.action === 'scrapeJobDescription') {
    handleScrapeDescription(request);
    return true;
  }

  if (request.action === 'fetchJobDetails') {
    handleFetchDetails(request);
    return true;
  }

  return true;
});

function handleScrapeDescription(request) {
    const { tabId, jobIndex } = request;

    chrome.tabs.onUpdated.addListener(function listener(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);

        chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ['greenhouse-description-scraper.js']
        }).then((results) => {
          const description = (results && results[0] && results[0].result) ? results[0].result : '';

          chrome.storage.local.get(['vipvetJobs'], (result) => {
            const jobs = result.vipvetJobs || [];
            if (jobs[jobIndex]) {
              jobs[jobIndex].description = description;

              chrome.storage.local.set({ vipvetJobs: jobs }, () => {
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
      }
    });
}

function handleFetchDetails(request) {
    const { url, jobIndex } = request;
    if (!url) {
        chrome.runtime.sendMessage({ action: 'detailsFetched', details: {}, jobIndex: jobIndex }).catch(() => {});
        return;
    }

    chrome.tabs.create({ url: url, active: false }, (tab) => {
        if (!tab) return;
        chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
            if (tabId === tab.id && info.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                
                // Small delay for Greenhouse dynamic content
                setTimeout(() => {
                    chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        files: ['detail-extractor.js']
                    }).then((results) => {
                        const details = (results && results[0] && results[0].result) ? results[0].result : {};
                        chrome.tabs.remove(tab.id).catch(() => {});
                        chrome.runtime.sendMessage({
                            action: 'detailsFetched',
                            details: details,
                            jobIndex: jobIndex
                        }).catch(() => {});
                    }).catch(err => {
                        console.error('Error extracting details:', err);
                        chrome.tabs.remove(tab.id).catch(() => {});
                        chrome.runtime.sendMessage({
                            action: 'detailsFetched',
                            details: {},
                            jobIndex: jobIndex
                        }).catch(() => {});
                    });
                }, 2000);
            }
        });
    });
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("VPP Job Scraper installed");
});


