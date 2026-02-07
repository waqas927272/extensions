// VetPractice Job Scraper - Background Service Worker

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'scrapeJobDescription') {
    const { tabId, jobIndex, jobLink } = request;

    chrome.tabs.onUpdated.addListener(function listener(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);

        // Use greenhouse-description-scraper.js since all VPP jobs link to greenhouse.io
        chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ['greenhouse-description-scraper.js']
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

  return true;
});
