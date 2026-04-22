// PetVet Care Centers Job Scraper - Background Script

let offscreenCreating; // A global promise to avoid race conditions

async function setupOffscreenDocument(path) {
  const offscreenUrl = chrome.runtime.getURL(path);
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl],
  });

  if (existingContexts.length > 0) {
    return;
  }

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
  if (request.action === 'scrapeJobDescription') {
    const { tabId, jobIndex } = request;

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
                chrome.tabs.remove(tabId).catch(() => {});
                chrome.runtime.sendMessage({
                  action: 'descriptionSaved',
                  jobIndex: jobIndex,
                  success: true
                }).catch(() => {});
              });
            } else {
              chrome.tabs.remove(tabId).catch(() => {});
              chrome.runtime.sendMessage({
                action: 'descriptionSaved',
                jobIndex: jobIndex,
                success: false
              }).catch(() => {});
            }
          });
        }).catch(() => {
          chrome.tabs.remove(tabId).catch(() => {});
          chrome.runtime.sendMessage({
            action: 'descriptionSaved',
            jobIndex: jobIndex,
            success: false
          }).catch(() => {});
        });
      }
    });

    return true;
  } else if (request.action === 'scrapeJobAddress') {
    const { tabId, jobIndex } = request;

    chrome.tabs.onUpdated.addListener(function listener(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);

        chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ['google-maps-scraper.js']
        }).then((results) => {
          const addressData = (results && results[0] && results[0].result)
            ? results[0].result
            : { streetAddress: '', zipCode: '', phone: '', website: '' };

          chrome.storage.local.get(['petvetJobs'], (result) => {
            const jobs = result.petvetJobs || [];
            if (jobs[jobIndex]) {
              jobs[jobIndex].streetAddress = addressData.streetAddress || '';
              jobs[jobIndex].zipCode = addressData.zipCode || '';
              jobs[jobIndex].phone = addressData.phone || '';
              jobs[jobIndex].website = addressData.website || '';
              chrome.storage.local.set({ petvetJobs: jobs }, () => {
                chrome.tabs.remove(tabId).catch(() => {});
                chrome.runtime.sendMessage({
                  action: 'addressSaved',
                  jobIndex: jobIndex,
                  success: true
                }).catch(() => {});
              });
            } else {
              chrome.tabs.remove(tabId).catch(() => {});
              chrome.runtime.sendMessage({
                action: 'addressSaved',
                jobIndex: jobIndex,
                success: false
              }).catch(() => {});
            }
          });
        }).catch(() => {
          chrome.tabs.remove(tabId).catch(() => {});
          chrome.runtime.sendMessage({
            action: 'addressSaved',
            jobIndex: jobIndex,
            success: false
          }).catch(() => {});
        });
      }
    });

    return true;
  } else if (request.action === 'fetchJobDetails') {
    const { tabId, jobIndex } = request;

    chrome.storage.local.set({
      [`petvetDetailTab_${tabId}`]: jobIndex
    }, () => {
      chrome.tabs.onUpdated.addListener(function listener(updatedTabId, info) {
        if (updatedTabId === tabId && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);

          setTimeout(() => {
            chrome.scripting.executeScript({
              target: { tabId: tabId },
              files: ['petvet-detail-extractor.js']
            }).catch(() => {
              chrome.storage.local.remove([`petvetDetailTab_${tabId}`]);
              chrome.tabs.remove(tabId).catch(() => {});
              chrome.runtime.sendMessage({
                action: 'detailSaved',
                jobIndex: jobIndex,
                success: false
              }).catch(() => {});
            });
          }, 500);
        }
      });
    });

    return true;
  } else if (request.action === 'detailsExtracted') {
    const { details } = request;
    const senderTabId = sender?.tab?.id;

    if (!senderTabId) {
      chrome.runtime.sendMessage({ action: 'detailSaved', success: false }).catch(() => {});
      return true;
    }

    chrome.storage.local.get([`petvetDetailTab_${senderTabId}`, 'petvetJobs'], (result) => {
      const jobIndex = result[`petvetDetailTab_${senderTabId}`];
      const jobs = result.petvetJobs || [];

      if (jobIndex === undefined || !jobs[jobIndex]) {
        chrome.storage.local.remove([`petvetDetailTab_${senderTabId}`]);
        chrome.tabs.remove(senderTabId).catch(() => {});
        chrome.runtime.sendMessage({
          action: 'detailSaved',
          jobIndex: jobIndex,
          success: false
        }).catch(() => {});
        return;
      }

      jobs[jobIndex].position = details.position || '';
      jobs[jobIndex].areaOfPractice = details.areaOfPractice || '';
      jobs[jobIndex].salary = details.salary || '';
      jobs[jobIndex].jobType = details.jobType || jobs[jobIndex].jobType || 'Full Time';
      jobs[jobIndex].phone = details.phone || jobs[jobIndex].phone || '';
      if (details.description) jobs[jobIndex].description = details.description;

      chrome.storage.local.set({ petvetJobs: jobs }, () => {
        chrome.storage.local.remove([`petvetDetailTab_${senderTabId}`]);
        chrome.tabs.remove(senderTabId).catch(() => {});
        chrome.runtime.sendMessage({
          action: 'detailSaved',
          jobIndex: jobIndex,
          success: true
        }).catch(() => {});
      });
    });

    return true;
  }
});
