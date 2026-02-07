let isScraping = false;
let sessionScrapedCount = 0;
let totalOnPage = 0;

let offscreenCreating; // A global promise to avoid race conditions and ensure the offscreen document is only created once.

async function setupOffscreenDocument(path) {
  // Check if an offscreen document is already open
  const offscreenUrl = chrome.runtime.getURL(path);
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl],
  });

  if (existingContexts.length > 0) {
    return; // An offscreen document is already open
  }

  // Create and wait for the offscreen document to load
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
  if (request.command === 'start') {
    isScraping = true;
    sessionScrapedCount = 0;
    totalOnPage = 0;
    // Inject content script into the current tab to start scraping
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id) {
        chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          files: ['content.js'],
        }).catch(err => console.error("Error injecting content script:", err));
      }
    });
    sendResponse({ status: 'started' });
  } else if (request.command === 'stop') {
    isScraping = false;
    chrome.runtime.sendMessage({ command: 'scraping_finished' }); // Inform popup
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
    // Content script finished on a page; if isScraping is still true, it means it was the last page
    if (isScraping) { // If scraping was active, it means this was the final page
      isScraping = false; // Stop the scraping process
      chrome.runtime.sendMessage({ command: 'scraping_finished' });
    }
  } else if (request.command === 'add-records') {
    if (isScraping) { // Only add records if scraping is active
      sessionScrapedCount += request.records.length;
      chrome.runtime.sendMessage({ command: 'session-update', count: sessionScrapedCount });
      chrome.storage.local.get({ records: [] }, (result) => {
        const allRecords = result.records.concat(request.records);
        chrome.storage.local.set({ records: allRecords });
      });
    }
  } else if (request.command === 'fetch-job-description') {
    (async () => {
      try {
        await setupOffscreenDocument('offscreen.html');
        const jobUrl = request.url;
        const response = await fetch(jobUrl);
        const html = await response.text();

        // Send HTML to offscreen document for parsing
        const parsingResponse = await chrome.runtime.sendMessage({
          command: 'parse-html',
          html: html
        });
        sendResponse({ description: parsingResponse.description });
      } catch (error) {
        console.error('Error in fetch-job-description:', error);
        sendResponse({ description: 'Error fetching description.' });
      }
    })();
    return true; // Indicates that the response is sent asynchronously
  } else if (request.action === 'scrapeJobDescription') {
    const { tabId, jobIndex, jobLink } = request;

    // Wait for the tab to finish loading, then inject script
    chrome.tabs.onUpdated.addListener(function listener(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);

        // Inject script to extract description and hospital name
        chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: () => {
            let description = '';
            let hospitalName = '';

            // 1. Try JSON-LD (JobPosting schema)
            const scriptLdJson = document.querySelectorAll('script[type="application/ld+json"]');
            for (const script of scriptLdJson) {
              try {
                const json = JSON.parse(script.textContent);
                if (json['@type'] === 'JobPosting') {
                  if (json.description) {
                    // Strip HTML tags from description
                    const div = document.createElement('div');
                    div.innerHTML = json.description;
                    description = div.textContent.trim();
                  }
                  if (json.hiringOrganization && json.hiringOrganization.name) {
                    hospitalName = json.hiringOrganization.name;
                  }
                }
              } catch (e) {}
            }

            // 2. Fallback to DOM selectors for description
            if (!description) {
              const descSelectors = [
                'div.job-description',
                'div.description',
                'div#job-details',
                'div.details',
                '[itemprop="description"]',
                '.job-content',
                'article',
                'main'
              ];

              for (const selector of descSelectors) {
                const el = document.querySelector(selector);
                if (el && el.innerText.trim().length > 100) {
                  description = el.innerText.trim();
                  break;
                }
              }
            }

            // 3. Fallback for hospital name
            if (!hospitalName) {
              const hospitalSelectors = [
                '.company-name',
                '.hospital-name',
                '.job-company-name',
                '[itemprop="hiringOrganization"]',
                'meta[property="og:site_name"]'
              ];
              for (const selector of hospitalSelectors) {
                const el = document.querySelector(selector);
                if (el) {
                  hospitalName = el.content || el.textContent.trim();
                  if (hospitalName) break;
                }
              }
            }

            return { description, hospitalName };
          }
        }).then((results) => {
          const extractedData = results[0]?.result || {};

          // Save extracted data to the job record
          chrome.storage.local.get({ records: [] }, (result) => {
            const records = result.records || [];
            if (records[jobIndex]) {
              if (extractedData.description) {
                records[jobIndex].description = extractedData.description;
              }
              if (extractedData.hospitalName) {
                records[jobIndex].hospitalName = extractedData.hospitalName;
              }

              chrome.storage.local.set({ records: records }, () => {
                console.log(`Details saved for job ${jobIndex + 1}`);
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
  } else if (request.command === 'send-to-webhook') {
    (async () => {
      try {
        const webhookUrl = request.url;
        const records = request.records;

        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ data: records, parentClientName: "MedVet" })
        });

        if (response.ok) {
          sendResponse({ success: true });
        } else {
          const errorText = await response.text();
          sendResponse({ success: false, error: `Webhook responded with status ${response.status}: ${errorText}` });
        }
      } catch (error) {
        console.error('Error sending data to webhook:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // Indicates that the response is sent asynchronously
  }
  return true; // Indicates that the response is sent asynchronously
});

// Listener for tab updates to reinject content.js if scraping is active
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && isScraping) {
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js'],
    }).catch(err => console.error("Error injecting content script on tab update:", err));
  }
});
