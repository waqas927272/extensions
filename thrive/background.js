const JOBVITE_HOST = 'app.jobvite.com';
const JOBVITE_LISTING_URL = 'https://app.jobvite.com/Recruiter/JobListing.aspx';

importScripts('job-filter.js');
importScripts('detail-rules.js');
importScripts('description-queue.js');
importScripts('address-rules.js');
importScripts('address-queue.js');

let isScraping = false;
let scrapingTabId = null;
let currentPage = 0;
let totalPages = 0;
let totalJobs = 0;
let allScrapedJobs = [];
let seenJobLinks = new Set();
let skippedJobLinks = new Set();
let skippedByReason = new Map();

function withJobviteStandaloneUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === JOBVITE_HOST) {
      parsed.searchParams.set('nl', '1');
      return parsed.toString();
    }
  } catch (e) {}
  return url;
}

function sendRuntimeMessage(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

function closeTab(tabId) {
  if (tabId) chrome.tabs.remove(tabId).catch(() => {});
}

function isJobviteListingUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === JOBVITE_HOST && parsed.pathname.endsWith('/Recruiter/JobListing.aspx');
  } catch (e) {
    return false;
  }
}

async function injectContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['job-filter.js', 'content.js']
  });
}

function sendScrapingStatus(status, message = '') {
  sendRuntimeMessage({
    action: 'scrapingStatus',
    status,
    message,
    scrapedCount: allScrapedJobs.length,
    currentPage,
    data: {
      totalJobsOnPage: totalJobs,
      scrapedRecords: allScrapedJobs.length,
      currentPage,
      totalPages
    }
  });
}

function waitForTabComplete(tabId, timeoutMs = 30000) {
  return new Promise((resolve) => {
    let settled = false;
    let timeoutId = null;

    function cleanup() {
      if (timeoutId) clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(listener);
    }

    function finish(value) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    }

    function listener(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === 'complete') {
        finish(true);
      }
    }

    timeoutId = setTimeout(() => finish(false), timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function scrapeCurrentListingPage() {
  await injectContentScript(scrapingTabId);
  const response = await chrome.tabs.sendMessage(scrapingTabId, { action: 'scrapeCurrentPage' });
  const jobs = Array.isArray(response?.jobs) ? response.jobs : [];
  totalJobs = response?.totalJobs || totalJobs || jobs.length;
  totalPages = Math.max(1, Math.ceil(totalJobs / 20));

  jobs.forEach(job => {
    const reason = ThriveJobFilter.exclusionReason(job);
    if (reason) {
      recordSkippedJob(job, reason);
      return;
    }
    if (job.link && !seenJobLinks.has(job.link)) {
      seenJobLinks.add(job.link);
      allScrapedJobs.push(job);
    }
  });
  (response?.excludedJobs || []).forEach(job => recordSkippedJob(job, ThriveJobFilter.exclusionReason(job)));

  await chrome.storage.local.set({ scrapedJobs: allScrapedJobs });
  return response;
}

function recordSkippedJob(job, reason) {
  const key = job.link || job.title;
  if (!reason || !key || skippedJobLinks.has(key)) return;
  skippedJobLinks.add(key);
  skippedByReason.set(reason, (skippedByReason.get(reason) || 0) + 1);
}

function listingSummary() {
  return {
    totalJobs,
    skippedJobs: skippedJobLinks.size,
    scrapedJobs: allScrapedJobs.length,
    skippedByKeyword: Array.from(skippedByReason, ([keyword, count]) => ({ keyword, count })),
    completedAt: new Date().toISOString()
  };
}

async function getListingPageState(tabId) {
  await injectContentScript(tabId);
  return chrome.tabs.sendMessage(tabId, { action: 'getPageState' });
}

async function triggerJobviteNextPage(tabId) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      function cleanText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
      }

      const table = document.querySelector('table.jv-listTable');
      const nextLink = Array.from(table?.querySelectorAll('.jv-thFooter a') || [])
        .find(link => cleanText(link.textContent).toLowerCase() === 'next');

      if (!nextLink) {
        return { clicked: false, error: 'Next button not found or disabled.' };
      }

      const href = nextLink.getAttribute('href') || '';
      const postback = href.match(/__doPostBack\('([^']+)'\s*,\s*'([^']+)'\)/);

      if (postback && typeof window.__doPostBack === 'function') {
        window.__doPostBack(postback[1], postback[2]);
        return { clicked: true, method: 'postback', target: postback[1], argument: postback[2] };
      }

      nextLink.click();
      return { clicked: true, method: 'click' };
    }
  });

  return result?.result || { clicked: false, error: 'Could not trigger Jobvite Next.' };
}

async function waitForListingPageChange(tabId, previousSignature, timeoutMs = 20000) {
  const startedAt = Date.now();

  await Promise.race([
    waitForTabComplete(tabId, timeoutMs).catch(() => false),
    new Promise(resolve => setTimeout(resolve, 1200))
  ]);

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const state = await getListingPageState(tabId);
      if (state?.validPage && state.pageSignature && state.pageSignature !== previousSignature) {
        return true;
      }
    } catch (e) {}

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  return false;
}

async function scrapeAndGoNext() {
  if (!isScraping || !scrapingTabId) return;

  currentPage += 1;
  sendScrapingStatus('in_progress', `Scraping page ${currentPage}...`);

  let pageResponse;
  try {
    pageResponse = await scrapeCurrentListingPage();
  } catch (error) {
    isScraping = false;
    await chrome.storage.local.set({ isScraping: false });
    sendScrapingStatus('error', `Could not scrape page ${currentPage}: ${error.message}`);
    return;
  }

  sendScrapingStatus('in_progress', `Scraped ${allScrapedJobs.length} jobs so far.`);

  if (!pageResponse?.hasNext) {
    isScraping = false;
    await chrome.storage.local.set({ isScraping: false });
    await chrome.storage.local.set({
      scrapingSummary: listingSummary()
    });
    sendScrapingStatus('completed', `Scraping completed. ${allScrapedJobs.length} jobs saved.`);
    return;
  }

  try {
    const nextResponse = await triggerJobviteNextPage(scrapingTabId);
    if (!nextResponse?.clicked) {
      isScraping = false;
      await chrome.storage.local.set({ isScraping: false });
      await chrome.storage.local.set({
        scrapingSummary: listingSummary()
      });
      sendScrapingStatus('completed', `Scraping completed. ${allScrapedJobs.length} jobs saved.`);
      return;
    }

    const changed = await waitForListingPageChange(scrapingTabId, pageResponse.pageSignature, 20000);
    if (!changed) {
      isScraping = false;
      await chrome.storage.local.set({ isScraping: false });
      sendScrapingStatus('error', 'Clicked Next, but Jobvite did not load the next listing page.');
      return;
    }

    setTimeout(scrapeAndGoNext, 800);
  } catch (error) {
    isScraping = false;
    await chrome.storage.local.set({ isScraping: false });
    sendScrapingStatus('error', `Could not move to next page: ${error.message}`);
  }
}

async function handleStartJobviteScraping(sendResponse) {
  const queues = await chrome.storage.local.get(['addressRun', 'descriptionRun']);
  if (queues.addressRun?.status === 'running' || queues.descriptionRun?.status === 'running') {
    sendResponse({ status: 'already_running', message: 'Wait for the current lookup to finish.' });
    return;
  }
  if (isScraping) {
    sendResponse({ status: 'already_running' });
    return;
  }

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeTab = tabs[0];
  if (!activeTab?.id || !isJobviteListingUrl(activeTab.url || '')) {
    chrome.tabs.create({ url: JOBVITE_LISTING_URL });
    sendResponse({ status: 'wrong_url', message: `Open ${JOBVITE_LISTING_URL} before starting.` });
    return;
  }

  isScraping = true;
  scrapingTabId = activeTab.id;
  currentPage = 0;
  totalPages = 0;
  totalJobs = 0;
  allScrapedJobs = [];
  seenJobLinks = new Set();
  skippedJobLinks = new Set();
  skippedByReason = new Map();
  await chrome.storage.local.set({ isScraping: true, scrapedJobs: [] });

  sendScrapingStatus('scraping', 'Starting Jobvite scrape...');
  scrapeAndGoNext();
  sendResponse({ status: 'scrapingStarted' });
}

function extractJobviteDetailsFromPage() {
  function cleanText(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function textById(id) {
    const el = document.getElementById(id);
    return cleanText(el?.innerText || el?.textContent || '');
  }

  function getSpecifics() {
    const specifics = {
      company: textById('Company'),
      category: textById('Category'),
      city: textById('LocCity'),
      state: textById('LocState'),
      lastUpdated: textById('LastUpdated'),
      requisitionId: textById('RequisitionId')
    };

    const companyEl = document.getElementById('Company');
    const specificsTable = companyEl?.closest('table.tableContent');
    if (specificsTable) {
      Array.from(specificsTable.querySelectorAll('tr')).forEach(row => {
        const cells = Array.from(row.querySelectorAll('td'));
        if (cells.length < 2) return;

        const label = cleanText(cells[0].innerText || cells[0].textContent || '').replace(/:$/, '');
        const value = cleanText(cells[1].innerText || cells[1].textContent || '');
        if (!label || !value || /^specifics$/i.test(label)) return;

        const key = label
          .toLowerCase()
          .replace(/[^a-z0-9]+(.)/g, (_, chr) => chr.toUpperCase())
          .replace(/[^a-z0-9]/g, '');

        if (key && !specifics[key]) specifics[key] = value;
      });
    }

    return specifics;
  }

  function formatFullDetailText(specifics, description) {
    const lines = [
      'Specifics',
      `Company: ${specifics.company || ''}`,
      `Category: ${specifics.category || ''}`,
      `Industry/Category: ${specifics.category || ''}`,
      `City: ${specifics.city || ''}`,
      `State: ${specifics.state || ''}`,
      `Last Updated: ${specifics.lastUpdated || ''}`,
      `Requisition Id: ${specifics.requisitionId || ''}`,
      '',
      'Description',
      description || ''
    ];

    return lines
      .map(line => String(line || '').trim())
      .filter((line, index, allLines) => line || (index > 0 && allLines[index - 1]))
      .join('\n');
  }

  function stateToAbbrev(name) {
    const raw = cleanText(name);
    if (!raw) return '';
    if (/^[A-Z]{2}$/.test(raw)) return raw;
    const map = {
      alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
      colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
      hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
      kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
      massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
      missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
      'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
      'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
      oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
      'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
      virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
      wyoming: 'WY', 'district of columbia': 'DC'
    };
    return map[raw.toLowerCase()] || raw;
  }

  function extractSalary(text) {
    const patterns = [
      /\$[\d,]+(?:\.\d+)?\s*[-–]\s*\$[\d,]+(?:\.\d+)?\s*(?:\/?(?:per\s+)?(?:hour|hr\.?|year|yr\.?|annually))?/i,
      /\$[\d,]+k\s*[-–]\s*\$?[\d,]+k/i,
      /(?:starting\s+(?:at|pay)|begins?\s+at|from)[:\s]+\$[\d,]+[kK]?\s*(?:\/\s*(?:year|yr|hour|hr))?/i,
      /\$[\d,]+[kK]\s*(?:\/\s*(?:year|yr|hour|hr)|per\s+(?:year|yr|hour|hr))/i,
      /\$[\d,]+(?:,\d{3})*(?:\.\d+)?\s*(?:\/\s*(?:year|yr|hour|hr)|per\s+(?:year|yr|hour|hr)|an?\s+(?:hour|hr))/i,
      /(?:salary|pay|compensation)\s+range[^.\n]{0,10}?\$[\d,]+[kK]?[^.\n]{0,80}/i,
      /(?:salary|pay|compensation)[:\s]+\$[\d,]+[kK]?[^.\n]{0,100}/i,
      /PROSAL[^.\n]{0,80}?\$[\d,]+[kK]?[^.\n]{0,80}/i,
      /\$[\d,]+[kK]\+?/i
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[0].trim().replace(/[.,;:\s]+$/, '').slice(0, 140);
    }
    return '';
  }

  function lookupAreaOfPractice(title, category, description) {
    const titleText = String(title || '').toLowerCase();
    const cat = String(category || '').toLowerCase();
    const allText = `${title} ${category} ${description}`;
    const text = allText.toLowerCase();
    const isNonClinicalCategory = cat &&
      !/\bveterinarian\b|\bveterinary\b|\bvet\b|\bdvm\b/i.test(cat) &&
      /\b(?:business development|support center|corporate|operations|marketing|finance|accounting|human resources|recruiting|talent|administrative|management|technology|it|sales)\b/i.test(cat);
    const hasClinicalTitle = /\b(?:veterinarian|veterinary|vet|dvm|medical director|surgeon|oncologist|cardiologist|radiologist|internist|dermatologist|neurologist|ophthalmologist|anesthesiologist|criticalist|dentist|oral surgeon)\b/i.test(titleText);
    const isExoticRoleTitle = /\b(?:exotic|avian)\s+(?:veterinarian|vet|dvm)\b/i.test(titleText) ||
      /\b(?:veterinarian|vet|dvm)\b[^,\n()]{0,40}\b(?:exotic|avian)\b/i.test(titleText);

    if (isNonClinicalCategory && !hasClinicalTitle) return '';

    if (/urgent care/.test(text) || cat.includes('urgent care')) return 'Urgent Care';
    if (cat.includes('specialist') || cat.includes('specialty') || /specialty medical director/i.test(allText)) return 'Specialty Care';
    if (/\bgp\b|gen practice/.test(cat)) return 'General Practice Care';
    if (/\b(?:er|emergency)\b/.test(cat) || /\bemergency veterinary medical director\b/i.test(allText)) return 'Emergency Care';
    if (cat.includes('medical director')) {
      if (/\bspecialty medical director\b/i.test(title)) return 'Specialty Care';
      if (/\bemergency veterinary medical director\b/i.test(title)) return 'Emergency Care';
      if (isExoticRoleTitle) return 'Exotic Pet Medicine';
      return 'General Practice Care';
    }
    if (isExoticRoleTitle) return 'Exotic Pet Medicine';
    if (/specialty|specialist|cardiolog|neurolog|dermatolog|oncolog|ophthalmolog|radiolog|surgeon|surgery|internal medicine|anesthesia|criticalist/.test(titleText)) {
      return 'Specialty Care';
    }
    if (/\bemergency\b|\ber\b|critical care|\becc\b/.test(titleText)) return 'Emergency Care';
    return hasClinicalTitle ? 'General Practice Care' : '';
  }

  function extractJobType(text) {
    if (!text) return 'Full Time';
    const hasPartTime = /\bpart[\s-]?time\b/i.test(text);
    const hasFullTime = /\bfull[\s-]?time\b/i.test(text);
    if (hasPartTime && !hasFullTime) return 'Part Time';
    return 'Full Time';
  }

  function lookupPosition(title, category) {
    const text = `${title} ${category}`.toLowerCase();
    const cat = String(category || '').toLowerCase();
    const isNonClinicalCategory = cat &&
      !/\bveterinarian\b|\bveterinary\b|\bvet\b|\bdvm\b/i.test(cat) &&
      /\b(?:business development|support center|corporate|operations|marketing|finance|accounting|human resources|recruiting|talent|administrative|management|technology|it|sales)\b/i.test(cat);
    const hasClinicalTitle = /\b(?:veterinarian|veterinary|vet|dvm|medical director|surgeon|oncologist|cardiologist|radiologist|internist|dermatologist|neurologist|ophthalmologist|anesthesiologist|criticalist|dentist|oral surgeon)\b/i.test(title || '');
    if (isNonClinicalCategory && !hasClinicalTitle) return '';

    if (/medical director/.test(text)) return 'Medical Director';
    if (/lead veterinarian|lead vet/.test(text)) return 'Lead Veterinarian';
    if (/criticalist|dacvecc|\becc\b|emergency\s*&?\s*critical/.test(text)) return 'ECC Specialist';
    if (/cardiolog/.test(text)) return 'Cardiologist';
    if (/neurolog|neurosurg/.test(text)) return 'Neurologist & Neurosurgeon';
    if (/dermatolog/.test(text)) return 'Dermatologist';
    if (/ophthalmolog/.test(text)) return 'Ophthalmologist';
    if (/radiation\s+oncolog/.test(text)) return 'Radiation Oncologist';
    if (/oncolog/.test(text)) return 'Medical Oncologist';
    if (/radiolog|diagnostic imaging/.test(text)) return 'Radiologist';
    if (/internal medicine|internist/.test(text)) return 'Internal Medicine Specialist';
    if (/anesthes/.test(text)) return 'Anesthesiologist';
    if (/dentist|dental/.test(text)) return 'Dental Specialist';
    if (/surgeon|surgery|surgical/.test(text)) return 'Surgeon';
    if (/technician specialist|\bvts\b/.test(text)) return 'Credentialed Veterinary Technician Specialist';
    if (/veterinarian|dvm|vmd|associate/.test(text)) return 'Associate Veterinarian';
    return '';
  }

  function cleanHospitalName(name) {
    return String(name || '')
      .replace(/\s+logo$/i, '')
      .replace(/[.,;:]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[A-Za-z][A-Za-z']*/g, (word) => {
        if (word.length <= 1) return word.toUpperCase();
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      });
  }

  const title = cleanText(
    document.querySelector('h1, h2, .jv-header')?.innerText ||
    document.title.replace(/\s*\|\s*Jobvite.*$/i, '')
  );
  const specifics = getSpecifics();
  const hospitalName = cleanHospitalName(specifics.company);
  const category = specifics.category;
  const city = specifics.city;
  const state = specifics.state;
  const requisitionId = specifics.requisitionId;
  const descriptionEl = document.getElementById('DescriptionField');
  // Keep paragraphs and requirement lists intact for display and detail extraction.
  const description = String(descriptionEl?.innerText || descriptionEl?.textContent || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const descriptionHtml = descriptionEl?.innerHTML || '';
  const fullDetailText = formatFullDetailText(specifics, description);
  const areaOfPractice = lookupAreaOfPractice(title, category, description);
  const position = lookupPosition(title, category);

  return {
    jobId: requisitionId ? `THR-${requisitionId}` : '',
    requisitionId,
    hospital: hospitalName,
    hospitalName,
    company: hospitalName,
    city,
    state,
    lastUpdated: specifics.lastUpdated,
    zipCode: '',
    postalCode: '',
    category,
    jobType: extractJobType(description),
    salary: extractSalary(description),
    position,
    areaOfPractice,
    description: fullDetailText,
    descriptionBody: description,
    descriptionHtml,
    jobviteSpecifics: specifics,
    jobviteDetails: {
      specifics,
      description,
      descriptionHtml,
      fullText: fullDetailText
    }
  };
}

function executeDetailsInTab(tabId) {
  return chrome.scripting.executeScript({
    target: { tabId },
    func: extractJobviteDetailsFromPage
  }).then(results => results?.[0]?.result || {});
}

async function waitForJobviteDescription(tabId, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let previousDescription = '';

  while (Date.now() < deadline) {
    // Poll the current state too: a cached tab may finish before a load listener exists.
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') {
      try {
        const details = await executeDetailsInTab(tabId);
        const body = String(details.descriptionBody || '').trim();
        if (body && !/^(?:loading(?:\.{3}|…)?|please wait(?:\.{3}|…)?)$/i.test(body)) {
          if (body === previousDescription) return details;
          previousDescription = body;
        } else {
          previousDescription = '';
        }
      } catch (error) {
        // Jobvite can replace the document while navigating or rendering the description.
        previousDescription = '';
      }
    } else {
      previousDescription = '';
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  throw new Error('No job description loaded. Check that you are signed in to Jobvite and can open this job, then retry.');
}

async function scrapeJobDescription({ tabId: existingTabId, jobIndex, jobLink, windowId, onTabCreated }) {
  let tabId = existingTabId;
  let details;
  let errorMessage = '';

  try {
    await ensureJobStorage();
    const initial = await chrome.storage.local.get('scrapedJobs');
    const queuedJob = (initial.scrapedJobs || []).find(job => job.link === jobLink);
    if (!queuedJob || !ThriveJobFilter.isDvmJob(queuedJob)) {
      return { success: false, excluded: true, jobIndex, jobLink, error: 'Job is no longer an eligible DVM record.' };
    }
    const jobUrl = new URL(jobLink);
    if (!/^https?:$/.test(jobUrl.protocol)) throw new Error('Invalid job URL.');
    if (!tabId) {
      if (!Number.isInteger(windowId) || windowId < 0) throw new Error('The originating window is unavailable. Open Records in that window and retry.');
      const sourceWindow = await chrome.windows.get(windowId);
      const tab = await chrome.tabs.create({ url: withJobviteStandaloneUrl(jobLink), active: false, windowId });
      tabId = tab?.id;
      if (!tabId) throw new Error('Could not open the job tab.');
      if (onTabCreated) await onTabCreated(tabId);
      // Chrome can restore a minimized window even when the new tab is inactive.
      if (sourceWindow.state === 'minimized') await chrome.windows.update(windowId, { state: 'minimized' });
    }
    // Older records pages may already have opened the tab. Do not navigate it twice.
    details = await waitForJobviteDescription(tabId);
  } catch (error) {
    errorMessage = error.message || 'Could not fetch the job description.';
  } finally {
    if (tabId) await chrome.tabs.remove(tabId).catch(() => {});
  }

  const result = await chrome.storage.local.get(['scrapedJobs']);
  const jobs = result.scrapedJobs || [];
  // Rows can be deleted or reordered while the tab loads. Never save to another job.
  const index = jobs[jobIndex]?.link === jobLink
    ? jobIndex
    : jobs.findIndex(job => job.link === jobLink);
  if (index < 0) return { success: false, jobIndex, jobLink, error: 'The job was removed before its description could be saved.' };

  const job = jobs[index];
  if (details) {
    const classifiedJob = { ...job, category: details.category, jobviteSpecifics: details.jobviteSpecifics };
    if (!ThriveJobFilter.isDvmJob(classifiedJob)) {
      jobs.splice(index, 1);
      await chrome.storage.local.set({ scrapedJobs: jobs });
      return { success: false, excluded: true, jobIndex: index, jobLink, error: ThriveJobFilter.exclusionReason(classifiedJob) };
    }
    job.description = details.description;
    job.jobviteSpecifics = details.jobviteSpecifics;
    compactJobDescription(job);
    job.descriptionFetched = true;
    job.descriptionFetchFailed = false;
    delete job.descriptionFetchError;
  } else {
    job.descriptionFetched = false;
    job.descriptionFetchFailed = true;
    job.descriptionFetchError = errorMessage;
    if (job.description === 'Description fetch failed.') job.description = '';
  }

  await chrome.storage.local.set({ scrapedJobs: jobs });
  return { success: !!details, jobIndex: index, jobLink, error: errorMessage };
}

function openJobviteTabAndExtract(url, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const finalUrl = withJobviteStandaloneUrl(url);
    let tabId = null;
    let settled = false;
    let timeoutId = null;

    function cleanup() {
      if (timeoutId) clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(listener);
      closeTab(tabId);
    }

    function finish(details) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(details || {});
    }

    async function inject() {
      try {
        setTimeout(async () => {
          try {
            finish(await executeDetailsInTab(tabId));
          } catch (e) {
            finish({});
          }
        }, 1000);
      } catch (e) {
        finish({});
      }
    }

    function listener(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        inject();
      }
    }

    timeoutId = setTimeout(() => finish({}), timeoutMs);

    chrome.tabs.create({ url: finalUrl, active: false }, (tab) => {
      if (!tab?.id) {
        finish({});
        return;
      }

      tabId = tab.id;
      chrome.tabs.onUpdated.addListener(listener);
      chrome.tabs.get(tabId)
        .then(currentTab => {
          if (currentTab?.status === 'complete') inject();
        })
        .catch(() => finish({}));
    });
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startJobviteScraping' || request.action === 'startScraping') {
    handleStartJobviteScraping(sendResponse);
    return true;
  }

  if (request.action === 'stopJobviteScraping' || request.action === 'stopScraping') {
    isScraping = false;
    chrome.storage.local.set({ isScraping: false });
    sendScrapingStatus('stopped', 'Scraping stopped.');
    sendResponse({ status: 'stopped' });
    return true;
  }

  if (request.action === 'storeJobs') {
    const jobs = (Array.isArray(request.data) ? request.data : []).filter(ThriveJobFilter.isDvmJob);
    chrome.storage.local.set({ scrapedJobs: jobs }, () => {
      console.log('Thrive Jobvite jobs data stored.');
    });
    return false;
  }

  if (request.action === 'sendWebhook') {
    const { url, payload } = request;
    (async () => {
      try {
        const body = JSON.stringify(payload);
        const postPayload = (contentType) => fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': contentType,
            'Accept': 'application/json'
          },
          body
        });

        let response = await postPayload('application/json');
        let errorText = '';
        if (!response.ok) {
          errorText = await response.text().catch(() => '');
        }

        if (response.status === 405) {
          response = await postPayload('text/plain;charset=UTF-8');
          errorText = response.ok ? '' : await response.text().catch(() => '');
        }

        if (response.ok) {
          const responseText = await response.text().catch(() => '');
          sendResponse({ success: true, status: response.status, body: responseText });
        } else {
          sendResponse({ success: false, error: `HTTP ${response.status}: ${errorText}` });
        }
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  if (request.action === 'fetchJobDetails') {
    const { url, jobIndex } = request;
    openJobviteTabAndExtract(url).then(details => {
      sendRuntimeMessage({ action: 'detailsFetched', details, jobIndex });
    });
    return true;
  }

  if (request.action === 'scrapeJobDescription') {
    resolveDescriptionWindow(request, sender)
      .then(windowId => scrapeJobDescription({ ...request, windowId }))
      .catch(error => ({ success: false, jobIndex: request.jobIndex, jobLink: request.jobLink, error: error.message }))
      .then(result => {
        sendResponse(result);
        sendRuntimeMessage({ action: 'descriptionSaved', ...result });
      });
    return true;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ isScraping: false });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.set({ isScraping: false });
});
