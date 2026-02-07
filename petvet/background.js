// PetVet Care Centers Job Scraper - Background Script

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

          chrome.storage.local.get(['petvetJobs'], (result) => {
            const jobs = result.petvetJobs || [];
            if (jobs[jobIndex]) {
              jobs[jobIndex].description = description;

              chrome.storage.local.set({ petvetJobs: jobs }, () => {
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
