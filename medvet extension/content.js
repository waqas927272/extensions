(() => {
  const PAGE_SESSION_GUARD = '__medVetScraperPageSession';
  const STOP_REQUESTED_FLAG = '__medVetScraperStopRequested';
  const excludedJobTitlePatterns = [
    /\bmentorship\b/,
    /\blocum\b/,
    /\brelief\b/,
    /\bcontingent\b/,
    /\bclient\s+services?\s+representative\b/,
    /\bdoctor\s+coordinator\b/,
    /\bexperience\s+manager\b/,
    /\bclinical\s+(?:manager|supervisor)\b/,
    /\bfacility\s+maintenance\s+technician\b/,
    /\boperations\s+technician\b/,
    /\bprocurement\b/,
    /\bhealthcare\s+technology\s+applications\b/,
    /\bveterinary\s+social\s+worker\b/,
    /\bregistered\s+veterinary\s+technician\b/,
    /\blicensed\s+veterinary\s+technician\b/,
    /\bcredentialed\s+(?:veterinary\s+)?technician\b/,
    /\bveterinary\s+credentialed\s+technician\b/,
    /\bveterinary\s+technician\b/,
    /\btechnician\s+assistant\b/,
    /\btechnician\/assistant\b/,
    /\btechnician\s+for\s+(?:icu|surgery|nursing)\b/,
    /\b(?:icu|nursing|anesthesia|dentistry|ophthalmology|radiology|rehabilitation|surgery|neurology|internal\s+medicine|medical\s+oncology|emergency|critical\s+care|hospitalist)\b.*\btechnician\b/,
    /\btechnician\b.*\b(?:icu|nursing|anesthesia|dentistry|ophthalmology|radiology|rehabilitation|surgery|neurology|internal\s+medicine|medical\s+oncology|emergency|critical\s+care|hospitalist)\b/,
    /\bveterinary\s+assistant\b/,
    /\bexperienced\s+veterinary\s+assistant\b/,
    /\bassistant\b.*\b(?:oncology|neurology|radiology|surgery|emergency|critical\s+care|internal\s+medicine|nursing)\b/,
    /\blvt\b/,
    /\brvt\b/,
    /\bva\b/,
    /\bseo\s+(?:and\s+)?content\s+strategist\b/,
    /\bstaff\s+accountant\b/,
    /\bclinical\s+education\s+specialist\b/,
    /\b(?:veterinary\s+)?rehabilitation\s+scheduling\s+coordinator\b/,
    /\bhospital\s+director\b/
  ];

  function normalizeTitle(title) {
    return (title || '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[\/_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function shouldSkipJobTitle(title) {
    const normalizedTitle = normalizeTitle(title);
    return excludedJobTitlePatterns.some(pattern => pattern.test(normalizedTitle));
  }

  function hasUsableCityAndState(city, state) {
    const normalizedCity = (city || '').trim().toLowerCase();
    const normalizedState = (state || '').trim().toLowerCase();
    const invalidValues = new Set(['', 'tbd', 'unknown', 'not found', 'nationwide', 'national', 'remote', 'multiple', 'united states', 'usa']);
    return !invalidValues.has(normalizedCity) && !invalidValues.has(normalizedState);
  }

  function wait(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }

  function parsePaginationRange() {
    const text = document.querySelector('.jv-pagination-text')?.textContent || '';
    const match = text.match(/([\d,]+)\s*-\s*([\d,]+)\s+of\s+([\d,]+)/i);
    if (!match) return null;
    return {
      start: Number(match[1].replace(/,/g, '')),
      end: Number(match[2].replace(/,/g, '')),
      total: Number(match[3].replace(/,/g, ''))
    };
  }

  function findNextPageButton() {
    return document.querySelector('.jv-pagination-next') ||
      document.querySelector('a.next-page') ||
      document.querySelector('a[rel="next"]') ||
      document.querySelector('button.next') ||
      document.querySelector('.pagination .next-link') ||
      document.querySelector('.pagination a:last-child:not(.active)');
  }

  async function waitForPaginationState(timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    let nextPageButton = null;
    let pageRange = null;

    do {
      nextPageButton = findNextPageButton();
      pageRange = parsePaginationRange();
      if (nextPageButton || (pageRange && pageRange.end >= pageRange.total)) break;
      await wait(150);
    } while (Date.now() < deadline && !globalThis[STOP_REQUESTED_FLAG]);

    return { nextPageButton, pageRange };
  }

  async function scrapeData() {
    if (globalThis[STOP_REQUESTED_FLAG]) {
      return;
    }

    const jobRows = document.querySelectorAll('table.jv-job-list tbody tr');
    const totalOnPage = jobRows.length;
    await chrome.runtime.sendMessage({ command: 'page-total', count: totalOnPage }).catch(() => {});

    const pageRecords = [];
    jobRows.forEach(row => {
      const titleElement = row.querySelector('.jv-job-list-title');
      const nameElement = row.querySelector('.jv-job-list-name');
      const categoryElement = row.querySelector('.jv-job-list-category');
      
      if (nameElement && categoryElement) {
        const linkElement = nameElement.querySelector('a');
        const locationSpan = nameElement.querySelectorAll('span');

        const title = titleElement ? titleElement.innerText.trim() : '';
        const link = linkElement ? linkElement.href : '';

        if (shouldSkipJobTitle(title)) {
          return;
        }

        // Extract job ID from the URL (last path segment)
        let jobId = '';
        if (link) {
          const urlPath = link.replace(/[?#].*$/, '').replace(/\/+$/, '');
          const rawJobId = urlPath.split('/').pop() || '';
          jobId = rawJobId ? 'MV-' + rawJobId : '';
        }

        let city = '';
        let state = '';

        if(locationSpan.length > 1) {
            const locationString = locationSpan[1].innerText.trim();
            const parts = locationString.split(',');
            if (parts.length > 1) {
                city = parts[0].trim();
                state = parts[1].trim();
            } else {
                city = locationString;
            }
        }

        // Non-facility and nationwide roles do not have a usable city/state pair.
        if (!hasUsableCityAndState(city, state)) {
          return;
        }

        const location = [city, state].filter(Boolean).join(', ');

        pageRecords.push({
          title,
          jobId,
          hospital: 'MedVet',
          city,
          state,
          location,
          link,
          areaOfPractice: '',
          position: ''
        });
      }
    });

    await chrome.runtime.sendMessage({ command: 'add-records', records: pageRecords }).catch(() => {});
    
    if (globalThis[STOP_REQUESTED_FLAG]) return;

    const { nextPageButton, pageRange } = await waitForPaginationState();

    if (nextPageButton) {
      const rawHref = nextPageButton.getAttribute?.('href') || nextPageButton.href || '';
      if (rawHref) {
        const nextUrl = new URL(rawHref, window.location.href).href;
        if (nextUrl !== window.location.href) {
          window.location.assign(nextUrl);
          return;
        }
      }

      nextPageButton.click();
      return;
    }

    if (pageRange && pageRange.end >= pageRange.total) {
      await chrome.runtime.sendMessage({ command: 'finished', isLastPage: true, pageRange }).catch(() => {});
      return;
    }

    await chrome.runtime.sendMessage({
      command: 'pagination-error',
      message: 'The jobs page still contains more records, but its Next link could not be verified.'
    }).catch(() => {});
  }

  chrome.runtime.sendMessage({ command: 'get-status' }, (response) => {
    if (chrome.runtime.lastError || !response) {
      return;
    }
    if (response.isScraping) {
      const pageSessionKey = `${response.sessionId || 'legacy'}|${window.location.href}`;
      if (globalThis[PAGE_SESSION_GUARD] === pageSessionKey) return;
      globalThis[PAGE_SESSION_GUARD] = pageSessionKey;
      globalThis[STOP_REQUESTED_FLAG] = false;
      scrapeData().catch(error => {
        chrome.runtime.sendMessage({
          command: 'pagination-error',
          message: error?.message || 'The jobs page could not be processed.'
        }).catch(() => {});
      });
    }
  });
  
  if (!globalThis.__medVetScraperStopListenerRegistered) {
    chrome.runtime.onMessage.addListener((request) => {
      if (request.command === 'stop') globalThis[STOP_REQUESTED_FLAG] = true;
    });
    globalThis.__medVetScraperStopListenerRegistered = true;
  }

})();
