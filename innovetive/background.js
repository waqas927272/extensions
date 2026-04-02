// Innovetive Petcare - Background Service Worker

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Save jobs to storage when received
  if (request.jobs) {
    chrome.storage.local.set({ jobs: request.jobs });
  }

  // Forward all status messages to the popup
  if (request.status) {
    chrome.runtime.sendMessage({
      status: request.status,
      message: request.message,
      totalJobs: request.totalJobs,
      totalPages: request.totalPages,
      error: request.error
    }).catch(() => {
      // Popup may be closed, ignore the error
    });
  }

  if (request.action === 'scrapeJobDescription') {
    handleScrapeDescription(request);
    return true;
  }

  if (request.action === 'fetchJobDetails') {
    handleFetchDetails(request);
    return true;
  }
});

function handleScrapeDescription(request) {
    const { tabId, jobIndex } = request;

    chrome.tabs.onUpdated.addListener(function listener(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);

        setTimeout(() => {
            chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: () => {
                    let description = '';
                    const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
                    for (const script of jsonLdScripts) {
                        try {
                            const data = JSON.parse(script.textContent);
                            if (data.description) {
                                description = data.description.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
                                break;
                            }
                        } catch (e) {}
                    }
                    if (!description) description = document.body.innerText.substring(0, 500);
                    return description;
                }
            }).then((results) => {
                const description = results[0]?.result || '';
                chrome.storage.local.get(['jobs'], (result) => {
                    const jobs = result.jobs || [];
                    if (jobs[jobIndex]) {
                        jobs[jobIndex].description = description;
                        chrome.storage.local.set({ jobs: jobs }, () => {
                            chrome.tabs.remove(tabId).catch(() => {});
                            chrome.runtime.sendMessage({ action: 'descriptionSaved', jobIndex: jobIndex, success: true });
                        });
                    }
                });
            }).catch(() => {
                chrome.tabs.remove(tabId).catch(() => {});
                chrome.runtime.sendMessage({ action: 'descriptionSaved', jobIndex: jobIndex, success: false });
            });
        }, 2000);
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
                }, 3000);
            }
        });
    });
}
