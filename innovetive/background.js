// Innovetive Petcare - Background Service Worker
let isScraping = false;
let currentTabId = null;
let scrapedJobs = [];
let descriptionScrapeChain = Promise.resolve();

const DESCRIPTION_MAX_ATTEMPTS = 4;
const DESCRIPTION_RETRY_BASE_DELAY_MS = 1200;

const CAREERS_URL_PATTERN = /https:\/\/innovetivepetcare\.pinpointhq\.com\/all-opportunities/i;

function shouldSkipListingJob(title) {
  return /\b(?:chief\s+(?:veterinary\s+)?medical\s+officer|veterinary\s+chief\s+medical\s+officer)\b/i.test(title || '');
}

function normalizeJob(job) {
  const normalized = {
    jobTitle: job.jobTitle || job.title || '',
    title: job.title || job.jobTitle || '',
    jobId: job.jobId || '',
    hospitalName: job.hospitalName || job.hospital || '',
    hospital: job.hospital || job.hospitalName || '',
    location: job.location || '',
    areaOfPractice: job.areaOfPractice || '',
    position: job.position || '',
    salary: job.salary || '',
    jobType: job.jobType || job.employmentType || '',
    link: job.link || '',
    description: job.description || ''
  };

  return normalized;
}

function sendStatusToPopup(status, message = '', scrapedCount = scrapedJobs.length, extra = {}) {
  chrome.runtime.sendMessage({
    action: 'scrapingStatus',
    status,
    message,
    scrapedCount,
    currentPage: extra.currentPage,
    totalPages: extra.totalPages
  }).catch(() => {});
}

async function saveScrapedJobs(jobs) {
  scrapedJobs = (jobs || [])
    .filter(job => !shouldSkipListingJob(job.jobTitle || job.title || ''))
    .map(normalizeJob);
  await chrome.storage.local.set({
    scrapedJobs,
    jobs: scrapedJobs,
    detailsCleared: false
  });
}

async function handleStartScraping(sendResponse) {
  if (isScraping) {
    sendResponse({ status: 'alreadyScraping' });
    return;
  }

  const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = activeTabs[0];
  currentTabId = tab?.id || null;

  if (!tab || !currentTabId) {
    sendResponse({ status: 'error', message: 'No active tab found.' });
    return;
  }

  if (!CAREERS_URL_PATTERN.test(tab.url || '')) {
    sendStatusToPopup('error', 'Open the Innovetive Petcare all opportunities page before scraping.');
    sendResponse({ status: 'error', message: 'Wrong page.' });
    return;
  }

  isScraping = true;
  scrapedJobs = [];
  await chrome.storage.local.set({ scrapedJobs: [], jobs: [], detailsCleared: false });
  sendStatusToPopup('scraping', 'Starting Innovetive listing scrape...', 0);

  try {
    await chrome.scripting.executeScript({
      target: { tabId: currentTabId },
      files: ['content.js']
    });
    sendResponse({ status: 'scrapingStarted' });
  } catch (error) {
    isScraping = false;
    sendStatusToPopup('error', 'Unable to inject listing scraper. Check that the careers page is open.');
    sendResponse({ status: 'error', message: error.message });
  }
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function descriptionHtmlToText(value) {
  return decodeHtmlEntities(value)
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<\/(?:p|div|li|h[1-6]|section|ul|ol)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function findJobPosting(value) {
  if (!value) return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const posting = findJobPosting(item);
      if (posting) return posting;
    }
    return null;
  }

  if (typeof value !== 'object') return null;
  const type = value['@type'];
  if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) {
    return value;
  }

  return findJobPosting(value['@graph']);
}

function extractDescriptionFromHtml(html) {
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;

  while ((match = scriptPattern.exec(html || '')) !== null) {
    if (!/type\s*=\s*["']application\/ld\+json["']/i.test(match[1] || '')) continue;

    try {
      const posting = findJobPosting(JSON.parse(match[2] || ''));
      const description = descriptionHtmlToText(posting?.description || '');
      if (description) return description;
    } catch (error) {
      // Ignore malformed JSON-LD blocks and keep looking for a valid JobPosting.
    }
  }

  return '';
}

async function fetchDescriptionInBackground(jobLink) {
  let url;
  try {
    url = new URL(jobLink || '');
  } catch (error) {
    const invalidUrlError = new Error('Invalid Innovetive Petcare job URL.');
    invalidUrlError.retryable = false;
    throw invalidUrlError;
  }

  if (url.protocol !== 'https:' || url.hostname !== 'innovetivepetcare.pinpointhq.com') {
    const invalidHostError = new Error('Invalid Innovetive Petcare job URL.');
    invalidHostError.retryable = false;
    throw invalidHostError;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url.href, {
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'follow',
      signal: controller.signal,
      headers: { Accept: 'text/html,application/xhtml+xml' }
    });

    if (!response.ok) {
      const httpError = new Error(`Description request failed with HTTP ${response.status}.`);
      httpError.status = response.status;
      throw httpError;
    }

    const html = await response.text();
    const description = extractDescriptionFromHtml(html);
    if (!description) throw new Error('JobPosting description was not found.');
    return description;
  } finally {
    clearTimeout(timeout);
  }
}

function waitForDescriptionRetry(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function shouldRetryDescriptionError(error) {
  if (error?.retryable === false) return false;
  if (error?.name === 'AbortError') return true;

  const status = Number(error?.status || 0);
  if (!status) return true;
  return status === 403 || status === 408 || status === 425 || status === 429 || status >= 500;
}

async function fetchDescriptionWithRetry(jobLink) {
  let lastError;

  for (let attempt = 1; attempt <= DESCRIPTION_MAX_ATTEMPTS; attempt++) {
    try {
      return {
        description: await fetchDescriptionInBackground(jobLink),
        attempts: attempt
      };
    } catch (error) {
      lastError = error;
      if (attempt >= DESCRIPTION_MAX_ATTEMPTS || !shouldRetryDescriptionError(error)) break;

      const delay = DESCRIPTION_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.warn(`Description request attempt ${attempt} failed. Retrying in ${delay}ms.`, error);
      await waitForDescriptionRetry(delay);
    }
  }

  throw lastError || new Error('Description could not be fetched.');
}

function getJobRecordKey(job) {
  return job.jobId || job.link || `${job.jobTitle || job.title || ''}|${job.hospitalName || job.hospital || ''}|${job.location || ''}`;
}

async function scrapeAndSaveDescription(request) {
  const jobLink = request.jobLink || request.url || '';
  let success = false;
  let errorMessage = '';
  let savedJobIndex = request.jobIndex;
  let attempts = 0;

  try {
    const resultWithRetry = await fetchDescriptionWithRetry(jobLink);
    const description = resultWithRetry.description;
    attempts = resultWithRetry.attempts;
    const result = await chrome.storage.local.get(['scrapedJobs', 'jobs']);
    const jobs = Array.isArray(result.scrapedJobs) && result.scrapedJobs.length > 0
      ? result.scrapedJobs
      : (result.jobs || []);
    const matchingIndex = jobs.findIndex(job =>
      (request.jobKey && getJobRecordKey(job) === request.jobKey) ||
      (jobLink && job.link === jobLink)
    );
    savedJobIndex = matchingIndex >= 0 ? matchingIndex : request.jobIndex;

    if (!jobs[savedJobIndex]) throw new Error('The job record no longer exists.');

    jobs[savedJobIndex].description = description;
    await chrome.storage.local.set({ scrapedJobs: jobs, jobs });
    scrapedJobs = jobs.map(normalizeJob);
    success = true;
  } catch (error) {
    errorMessage = error?.name === 'AbortError'
      ? 'Description request timed out.'
      : (error?.message || 'Description could not be fetched.');
    console.error(`Description scrape failed for ${jobLink || 'unknown job'}:`, error);
  }

  chrome.runtime.sendMessage({
    action: 'descriptionSaved',
    requestId: request.requestId || '',
    jobIndex: savedJobIndex,
    jobKey: request.jobKey || '',
    jobLink,
    success,
    error: errorMessage,
    attempts
  }).catch(() => {});

  return { success, requestId: request.requestId || '', jobIndex: savedJobIndex, error: errorMessage, attempts };
}

function enqueueDescriptionScrape(request) {
  const task = descriptionScrapeChain.then(() => scrapeAndSaveDescription(request));
  descriptionScrapeChain = task.catch(() => {});
  return task;
}

function handleFetchDetails(request) {
  const { url, jobIndex } = request;

  if (!url) {
    chrome.runtime.sendMessage({ action: 'detailsFetched', details: {}, jobIndex }).catch(() => {});
    return;
  }

  chrome.tabs.create({ url, active: false }, (tab) => {
    if (!tab) {
      chrome.runtime.sendMessage({ action: 'detailsFetched', details: {}, jobIndex }).catch(() => {});
      return;
    }

    chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
      if (tabId === tab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);

        setTimeout(() => {
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['detail-extractor.js']
          }).then((results) => {
            const details = results?.[0]?.result || {};
            chrome.tabs.remove(tab.id).catch(() => {});
            chrome.runtime.sendMessage({
              action: 'detailsFetched',
              details,
              jobIndex
            }).catch(() => {});
          }).catch(() => {
            chrome.tabs.remove(tab.id).catch(() => {});
            chrome.runtime.sendMessage({
              action: 'detailsFetched',
              details: {},
              jobIndex
            }).catch(() => {});
          });
        }, 3000);
      }
    });
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startScraping') {
    handleStartScraping(sendResponse);
    return true;
  }

  if (request.action === 'stopScraping') {
    isScraping = false;
    sendStatusToPopup('stopped', `Scraping stopped. Saved ${scrapedJobs.length} jobs.`, scrapedJobs.length);
    sendResponse({ status: 'stopped' });
    return true;
  }

  if (request.action === 'scrapeJobDescription') {
    enqueueDescriptionScrape(request).then(sendResponse);
    return true;
  }

  if (request.action === 'fetchJobDetails') {
    handleFetchDetails(request);
    return true;
  }

  if (request.status === 'scraping_progress') {
    sendStatusToPopup('in_progress', request.message || 'Scraping jobs...', scrapedJobs.length);
  }

  if (request.status === 'scraping_complete') {
    isScraping = false;
    saveScrapedJobs(request.jobs || []).then(() => {
      sendStatusToPopup(
        'completed',
        `Scraping completed! Found ${scrapedJobs.length} jobs. Use View Records to fetch details and descriptions.`,
        scrapedJobs.length,
        { totalPages: request.totalPages }
      );
    });
  }

  if (request.status === 'scraping_error') {
    isScraping = false;
    sendStatusToPopup('error', request.error || 'Listing scrape failed.', scrapedJobs.length);
  }
});
