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

    // Wait for the tab to finish loading, then inject detail-extractor.js
    // detail-extractor.js returns [{areaOfPractice, position, salary, hospitalName, description, city, state, location}]
    chrome.tabs.onUpdated.addListener(function listener(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);

        chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ['detail-extractor.js']
        }).then((results) => {
          const detailsList = results[0]?.result;
          const firstDetail = Array.isArray(detailsList) && detailsList.length > 0 ? detailsList[0] : null;

          chrome.storage.local.get({ records: [] }, (result) => {
            const records = result.records || [];
            if (records[jobIndex] && firstDetail) {
              const record = records[jobIndex];

              // Description
              if (firstDetail.description) {
                record.description = firstDetail.description;
              }

              // Hospital name — prefer specific "MedVet [City]" over plain "MedVet"
              if (firstDetail.hospitalName && firstDetail.hospitalName !== 'MedVet') {
                record.hospitalName = firstDetail.hospitalName;
              } else if (!record.hospitalName || record.hospitalName === 'MedVet') {
                const city = firstDetail.city || record.city || '';
                const skipLocs = ['nationwide', 'remote', 'national', 'multiple', 'united states', ''];
                if (city && !skipLocs.includes(city.toLowerCase())) {
                  record.hospitalName = 'MedVet ' + city;
                } else {
                  record.hospitalName = record.hospitalName || 'MedVet';
                }
              }

              // Area of Practice
              if (firstDetail.areaOfPractice) {
                record.areaOfPractice = firstDetail.areaOfPractice;
              }

              // Position — derived by detail-extractor.js with full keyword matching
              if (firstDetail.position) {
                record.position = firstDetail.position;
              }

              // Update job title to match the resolved position name
              if (record.position) {
                record.title = record.position;
              }

              // Salary
              if (firstDetail.salary) {
                record.salary = firstDetail.salary;
              }

              // City / State — fill in if missing from listing
              if (firstDetail.city && !record.city) record.city = firstDetail.city;
              if (firstDetail.state && !record.state) record.state = firstDetail.state;

              chrome.storage.local.set({ records: records }, () => {
                console.log(`Details saved for job ${jobIndex + 1}: ${record.title} → ${record.position} (${record.areaOfPractice})`);
                chrome.tabs.remove(tabId);
                chrome.runtime.sendMessage({
                  action: 'descriptionSaved',
                  jobIndex: jobIndex,
                  success: true
                });
              });
            } else {
              // Nothing extracted — close tab and report failure
              chrome.tabs.remove(tabId).catch(() => {});
              chrome.runtime.sendMessage({
                action: 'descriptionSaved',
                jobIndex: jobIndex,
                success: false
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
        const rawRecords = request.records || [];
        const syncId = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);

        // Map to the same field structure used by records.js
        const mappedRecords = rawRecords.map(record => {
          const city = record.city || '';
          const state = record.state || '';
          const location = city && state ? `${city}, ${state}` : (city || state || '');
          return {
            job_title:        record.title || '',
            job_id:           record.jobId || '',
            department_id:    record.jobId || '',
            hospital:         record.hospitalName || '',
            aggregator:       'MedVet (Parent Client)',
            street_address:   record.streetAddress || '',
            parent_client:    'MedVet',
            city:             city,
            state:            state,
            zip_code:         record.zipCode || '',
            county:           record.county || '',
            phone:            record.phone || '',
            website:          record.website || '',
            location:         location,
            area_of_practice: record.areaOfPractice || '',
            position:         record.position || '',
            salary:           record.salary || '',
            job_type:         record.jobType || '',
            url:              record.link || '',
            link:             record.link || '',
            description:      record.description || ''
          };
        });

        const payload = {
          source: 'MedVet Job Scraper',
          parentClientName: 'MedVet',
          syncId: syncId,
          timestamp: new Date().toISOString(),
          batchNumber: 1,
          totalBatches: 1,
          batchSize: mappedRecords.length,
          totalRecords: mappedRecords.length,
          data: mappedRecords
        };

        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
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
