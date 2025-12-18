chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'storeJobs') {
    chrome.storage.local.set({ jobs: request.data }, () => {
      console.log('Jobs data stored.');
    });
  }

  if (request.action === 'scrapeJobDescription') {
    const { tabId, jobIndex, jobLink } = request;

    // Wait for the tab to finish loading, then inject script
    chrome.tabs.onUpdated.addListener(function listener(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);

        // Inject script to extract description
        chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: () => {
            const mainContent = document.querySelector('body > div.jobad.site > div > div > div.column.jobad-container.wide-9of16.medium-5of8.print-block.equal-column > main');
            return mainContent ? mainContent.innerText.trim() : '';
          }
        }).then((results) => {
          const description = results[0]?.result || '';

          // Save description to the job record
          chrome.storage.local.get(['jobs'], (result) => {
            const jobs = result.jobs || [];
            if (jobs[jobIndex]) {
              jobs[jobIndex].description = description;
              chrome.storage.local.set({ jobs: jobs }, () => {
                console.log(`Description saved for job ${jobIndex + 1}`);
                // Close the tab after extracting
                chrome.tabs.remove(tabId);
                // Notify that description was saved
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
          chrome.runtime.sendMessage({
            action: 'descriptionSaved',
            jobIndex: jobIndex,
            success: false
          });
        });
      }
    });

    return true; // Keep message channel open
  }
});

// Optional: Clear scraping status on extension startup/reload
// This ensures that if the browser closed mid-scrape, the next time
// the extension runs, it won't mistakenly think it's still scraping.
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({ isScraping: false });
});

chrome.runtime.onStartup.addListener(() => {
    chrome.storage.local.set({ isScraping: false });
});