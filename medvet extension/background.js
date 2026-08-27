let isScraping = false;
let sessionScrapedCount = 0;
let totalOnPage = 0;
let uniqueJobLinks = new Set();
const MEDVET_AGGREGATOR = 'MedVet Emergency & Specialty Veterinary Care (Parent Client)';

let offscreenCreating; // A global promise to avoid race conditions and ensure the offscreen document is only created once.

function sendScrapingStatus(status, message = '', scrapedCount = sessionScrapedCount) {
  chrome.runtime.sendMessage({
    action: 'scrapingStatus',
    status,
    message,
    scrapedCount,
    currentPage: 0
  }).catch(() => {});
}

function sendRuntimeMessage(message) {
  return chrome.runtime.sendMessage(message).catch(() => {});
}

function normalizeSalaryText(salary) {
  const normalized = (salary || '')
    .replace(/â€“|â€”|–|—/g, ' - ')
    .replace(/\s+-\s+/g, ' - ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return /^(?:\$|usd)?\s*-\s*(?:\$|usd)?$/i.test(normalized) ? '' : normalized;
}

function shouldSkipIncomingJobTitle(title) {
  const normalizedTitle = (title || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[\/_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return [
    /\bseo\s+(?:and\s+)?content\s+strategist\b/,
    /\bstaff\s+accountant\b/,
    /\bclinical\s+education\s+specialist\b/,
    /\b(?:veterinary\s+)?rehabilitation\s+scheduling\s+coordinator\b/,
    /\bhospital\s+director\b/
  ].some(pattern => pattern.test(normalizedTitle));
}

function hasUsableCityAndState(record) {
  const normalizedCity = (record?.city || '').trim().toLowerCase();
  const normalizedState = (record?.state || '').trim().toLowerCase();
  const invalidValues = new Set(['', 'tbd', 'unknown', 'not found', 'nationwide', 'national', 'remote', 'multiple', 'united states', 'usa']);
  return !invalidValues.has(normalizedCity) && !invalidValues.has(normalizedState);
}

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
  if (request.command === 'start' || request.action === 'startScraping') {
    isScraping = true;
    sessionScrapedCount = 0;
    totalOnPage = 0;
    uniqueJobLinks = new Set();
    sendScrapingStatus('scraping', 'Starting MedVet listing scrape...', 0);
    chrome.storage.local.set({ scrapedJobs: [], records: [] });
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
  } else if (request.command === 'stop' || request.action === 'stopScraping') {
    isScraping = false;
    sendRuntimeMessage({ command: 'scraping_finished' }); // Inform popup
    sendScrapingStatus('stopped', 'Scraping stopped.', sessionScrapedCount);
    sendResponse({ status: 'stopped' });
  } else if (request.command === 'get-status') {
    chrome.storage.local.get({ scrapedJobs: [], records: [] }, (result) => {
      const jobs = result.scrapedJobs.length ? result.scrapedJobs : result.records;
      sendResponse({
        isScraping,
        sessionCount: sessionScrapedCount,
        pageTotal: totalOnPage,
        totalRecords: jobs.length
      });
    });
    return true;
  } else if (request.command === 'page-total') {
    totalOnPage = request.count;
    sendRuntimeMessage({ command: 'page-total-update', count: totalOnPage });
    sendResponse({ status: 'ok' });
  } else if (request.command === 'finished') {
    // Content script finished on a page; if isScraping is still true, it means it was the last page
    if (isScraping) { // If scraping was active, it means this was the final page
      isScraping = false; // Stop the scraping process
      sendRuntimeMessage({ command: 'scraping_finished' });
      sendScrapingStatus('completed', `Scraping completed! Found ${sessionScrapedCount} jobs. Use "View Records", then "Get Descriptions" or "Fetch Details" for enrichment.`, sessionScrapedCount);
    }
    sendResponse({ status: 'ok' });
  } else if (request.command === 'add-records') {
    if (isScraping) { // Only add records if scraping is active
      chrome.storage.local.get({ scrapedJobs: [] }, (result) => {
        const allRecords = result.scrapedJobs || [];
        for (const record of request.records || []) {
          if (shouldSkipIncomingJobTitle(record?.title || '')) continue;
          if (!hasUsableCityAndState(record)) continue;
          if (!record.link || uniqueJobLinks.has(record.link)) continue;
          uniqueJobLinks.add(record.link);
          allRecords.push(record);
        }
        sessionScrapedCount = allRecords.length;
        sendRuntimeMessage({ command: 'session-update', count: sessionScrapedCount });
        sendScrapingStatus('in_progress', `Scraped ${sessionScrapedCount} jobs so far...`, sessionScrapedCount);
        chrome.storage.local.set({ scrapedJobs: allRecords, records: allRecords });
      });
    }
    sendResponse({ status: 'queued' });
  } else if (request.command === 'fetch-job-description') {
    (async () => {
      try {
        await setupOffscreenDocument('offscreen.html');
        const jobUrl = new URL(request.url);
        if (jobUrl.hostname.includes('jobvite.com')) jobUrl.searchParams.set('nl', '1');

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        let response;
        try {
          response = await fetch(jobUrl.toString(), {
            cache: 'no-store',
            credentials: 'omit',
            redirect: 'follow',
            signal: controller.signal
          });
        } finally {
          clearTimeout(timeout);
        }

        if (!response.ok) {
          throw new Error(`Description fetch failed with HTTP ${response.status}`);
        }
        const html = await response.text();

        // Send HTML to offscreen document for parsing
        const parsingResponse = await chrome.runtime.sendMessage({
          command: 'parse-html',
          html: html
        });
        const description = parsingResponse?.description || '';
        if (!description || description === 'Description not found.') {
          throw new Error('No JobPosting description was found in the fetched HTML');
        }

        sendResponse({
          success: true,
          description,
          hospitalName: parsingResponse?.hospitalName || '',
          jobInfo: parsingResponse?.jobInfo || null
        });
      } catch (error) {
        console.error('Error in fetch-job-description:', error);
        sendResponse({ success: false, description: '', error: error.message || 'Error fetching description' });
      }
    })();
    return true; // Indicates that the response is sent asynchronously
  } else if (request.command === 'send-to-webhook') {
    (async () => {
      try {
        const webhookUrl = request.url;
        const rawRecords = (request.records || []).filter(hasUsableCityAndState);
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
            hospital:         record.hospital || record.hospitalName || '',
            aggregator:       MEDVET_AGGREGATOR,
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
            salary:           normalizeSalaryText(record.salary),
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
  } else {
    sendResponse({ status: 'ignored' });
  }
  return false;
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
