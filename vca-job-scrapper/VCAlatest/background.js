chrome.runtime.onInstalled.addListener(() => {
  console.log('VCA Jobs Scraper extension installed');
});

// Handle messages from content script and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'updateProgress' || 
      request.action === 'scrapingComplete' || 
      request.action === 'scrapingError' ||
      request.action === 'updateStatus') {
    // Forward message to popup if it's open
    chrome.runtime.sendMessage(request).catch(() => {
      // Popup might be closed, ignore error
    });
  } else if (request.action === 'fetchJobDescription') {
    // Create new tab and fetch description
    chrome.tabs.create({ url: request.url, active: true }, (tab) => {
      // Wait for tab to load
      chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
        if (tabId === tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          
          // Wait a bit more for dynamic content to load
          setTimeout(() => {
            // Inject content script and get description
            chrome.tabs.sendMessage(tab.id, { action: 'fetchDescription' }, (response) => {
              // Close the tab
              chrome.tabs.remove(tab.id);
              
              // Send response back to records page
              if (request.responseTabId) {
                chrome.tabs.sendMessage(request.responseTabId, {
                  action: 'descriptionFetched',
                  description: response ? response.description : 'Error fetching description',
                  jobIndex: request.jobIndex
                });
              }
            });
          }, 2000);
        }
      });
    });
    
    return true; // Keep message channel open for async response
  }
});