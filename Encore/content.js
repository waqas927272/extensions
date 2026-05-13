// Encore Vet Job Scraper - Content Script
// Scrapes job listings from careers.encorevet.com (Angular/Material)

console.log("Encore Vet Job Scraper content script loaded");

// Scrape jobs from current page
function scrapeJobs() {
  const jobs = [];
  const cardsContainer = document.querySelector('.job-results-container');
  const cards = getListingCards();
  const debug = {
    cardsContainerFound: !!cardsContainer,
    cardsFound: cards.length,
    jobsScraped: 0,
    promotedCardsSkipped: document.querySelectorAll('.promoted-jobs-container .search-result-item, .search-result-item.promoted').length
  };

  cards.forEach(card => {
    try {
      // Job title from itemprop="title" span
      const titleEl = card.querySelector('[itemprop="title"]') || card.querySelector('.job-title-link span');
      const title = cleanText(titleEl ? titleEl.textContent : '');

      // Job URL from job-title-link anchor
      const linkEl = card.querySelector('.job-title-link') || card.querySelector('[itemprop="url"]') || card.querySelector('.read-more-button');
      const link = linkEl ? linkEl.href : '';

      // Extract job ID from URL as fallback. The visible Req ID is the source of truth.
      const jobIdMatch = link.match(/\/jobs?\/(\d+)/);
      const rawJobId = jobIdMatch ? jobIdMatch[1] : (link ? link.split('/').filter(s => /^\d+$/.test(s))[0] || '' : '');

      // Req ID from .req-id span
      const reqIdEl = card.querySelector('.req-id span');
      const reqId = cleanText(reqIdEl ? reqIdEl.textContent : rawJobId);
      const jobId = reqId;

      // Location: multi-line with hospital, street, city/state
      const locationEl = card.querySelector('.label-value.location');
      const location = parseLocationBlock(locationEl ? locationEl.textContent : '');

      // Category
      const categoryEl = card.querySelector('.categories.label-value');
      const category = cleanText(categoryEl ? categoryEl.textContent : '');

      if (title || reqId || link || location.hospitalName) {
        jobs.push({
          title,
          jobId,
          reqId,
          hospitalName: location.hospitalName,
          streetAddress: location.streetAddress,
          city: location.city,
          state: location.state,
          country: 'USA',
          category,
          link,
          description: '',
          jobType: '',
          postalCode: location.postalCode
        });
      }
    } catch (e) {
      console.error('Error scraping job card:', e);
    }
  });

  debug.jobsScraped = jobs.length;
  console.log('Encore scrape result:', debug);
  return { jobs, debug };
}

function getListingCards() {
  const listingContainer = document.querySelector('.job-results-container');
  const selector = 'mat-expansion-panel.search-result-item, .search-result-item';

  if (listingContainer) {
    return Array.from(listingContainer.querySelectorAll(selector))
      .filter(card => !isPromotedCard(card));
  }

  return Array.from(document.querySelectorAll(selector))
    .filter(card => !isPromotedCard(card));
}

function isPromotedCard(card) {
  return card.classList.contains('promoted') ||
    !!card.closest('.promoted-jobs-container') ||
    !!card.querySelector('.promoted-label');
}

function cleanText(value) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function parseLocationBlock(value) {
  const lines = (value || '')
    .split(/\r?\n/)
    .map(cleanText)
    .filter(Boolean);

  const location = {
    hospitalName: '',
    streetAddress: '',
    city: '',
    state: '',
    postalCode: ''
  };

  if (lines.length === 0) return location;

  location.hospitalName = lines[0];

  if (lines.length === 1) {
    return location;
  }

  const lastLine = lines[lines.length - 1];
  const cityStateZip = parseCityStateZip(lastLine);

  location.streetAddress = lines.slice(1, -1).join(', ');
  location.city = cityStateZip.city;
  location.state = cityStateZip.state;
  location.postalCode = cityStateZip.postalCode;

  return location;
}

function parseCityStateZip(value) {
  const text = cleanText(value);
  const match = text.match(/^(.+?),\s*([A-Za-z .]+?)(?:\s+(\d{5}(?:-\d{4})?))?$/);

  if (!match) {
    return {
      city: text,
      state: '',
      postalCode: ''
    };
  }

  return {
    city: match[1].trim(),
    state: match[2].trim(),
    postalCode: match[3] || ''
  };
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForCondition(checkFn, timeout = 5000, interval = 200) {
  return new Promise(resolve => {
    const startTime = Date.now();

    const check = () => {
      const result = checkFn();
      if (result) {
        resolve(result);
        return;
      }

      if (Date.now() - startTime > timeout) {
        resolve(null);
        return;
      }

      setTimeout(check, interval);
    };

    check();
  });
}

function findCategoriesSelect() {
  const labels = Array.from(document.querySelectorAll('mat-label, .mat-form-field-label'));

  for (const label of labels) {
    if (!/Categories/i.test(label.textContent || '')) continue;

    const formField = label.closest('.mat-form-field') || label.closest('.mat-form-field-wrapper') || label.parentElement;
    const select = formField?.querySelector('mat-select');
    if (select) return select;
  }

  return Array.from(document.querySelectorAll('mat-select')).find(select =>
    /Categories/i.test(select.closest('.mat-form-field')?.textContent || select.getAttribute('aria-labelledby') || '')
  ) || null;
}

function getOpenSelectPanel(select) {
  if (select?.id) {
    const exact = document.getElementById(`${select.id}-panel`);
    if (exact) return exact;
  }

  const panels = Array.from(document.querySelectorAll('[role="listbox"].mat-select-panel, .mat-select-panel[role="listbox"]'));
  return panels.find(panel => panel.offsetParent !== null) || panels[0] || null;
}

async function openCategoriesPanel(select) {
  const trigger = select.querySelector('.mat-select-trigger') || select;
  if (select.getAttribute('aria-expanded') !== 'true') {
    clickElementCenter(trigger);
  }

  return waitForCondition(() => getOpenSelectPanel(select), 5000, 100);
}

function findCategoryOption(panel, category) {
  const options = Array.from(panel.querySelectorAll('mat-option[role="option"], mat-option'));

  return options.find(option => {
    const text = cleanText(option.querySelector('.mat-option-text')?.textContent || option.textContent || '');
    const label = text.replace(/\s*\(\d+\)\s*$/, '');
    return label === category;
  }) || null;
}

function clickElementCenter(element) {
  const rect = element.getBoundingClientRect();
  const options = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2
  };

  element.dispatchEvent(new MouseEvent('mousedown', options));
  element.dispatchEvent(new MouseEvent('mouseup', options));
  element.dispatchEvent(new MouseEvent('click', options));
}

async function selectCategoryOption(select, category) {
  const panel = await openCategoriesPanel(select);
  if (!panel) return { selected: false, error: 'Categories dropdown did not open.' };

  const option = findCategoryOption(panel, category);
  if (!option) return { selected: false, error: `${category} option was not found.` };

  if (option.getAttribute('aria-selected') === 'true') {
    return { selected: true };
  }

  const checkbox = option.querySelector('mat-pseudo-checkbox') || option;
  checkbox.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  await wait(100);
  clickElementCenter(checkbox);

  const verified = await waitForCondition(() => {
    const currentPanel = getOpenSelectPanel(select) || panel;
    const currentOption = currentPanel ? findCategoryOption(currentPanel, category) : option;
    return currentOption?.getAttribute('aria-selected') === 'true' ? currentOption : null;
  }, 2500, 100);

  return { selected: !!verified };
}

async function applyRequiredCategoryFilters() {
  const requiredCategories = ['Medical Directors', 'Veterinarian'];
  const select = findCategoriesSelect();

  if (!select) {
    return { success: false, error: 'Categories filter dropdown was not found.' };
  }

  const selected = [];
  const missing = [];

  for (const category of requiredCategories) {
    const result = await selectCategoryOption(select, category);
    if (result.selected) selected.push(category);
    else missing.push(category);
  }

  if (select.getAttribute('aria-expanded') === 'true') {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    await wait(250);
  }

  return {
    success: missing.length === 0,
    selected,
    missing,
    error: missing.length ? `Could not select category filter(s): ${missing.join(', ')}` : ''
  };
}

// Get total number of pages
function getTotalPages() {
  // Find pagination range label like "1 – 10 of 78 Total Jobs"
  const paginationEl = document.querySelector('.mat-paginator-range-label');
  if (paginationEl) {
    const text = paginationEl.textContent || paginationEl.getAttribute('aria-label') || '';
    const numbers = text.match(/\d+/g)?.map(n => parseInt(n, 10)) || [];
    if (numbers.length >= 3) {
      const start = numbers[0];
      const end = numbers[1];
      const total = numbers[2];
      const itemsPerPage = Math.max(1, end - start + 1);
      return Math.ceil(total / itemsPerPage);
    }
    // Match "of X" pattern (handles various dash types: -, –, —)
    const match = text.match(/of\s+(\d+)/i);
    if (match) {
      const total = parseInt(match[1], 10);
      // Get items per page from the range (e.g., "1 – 10" means 10 per page)
      const rangeMatch = text.match(/(\d+)\s*[–—-]\s*(\d+)/);
      const itemsPerPage = rangeMatch ? (parseInt(rangeMatch[2], 10) - parseInt(rangeMatch[1], 10) + 1) : 10;
      return Math.ceil(total / itemsPerPage);
    }
  }

  // Try aria-label approach as fallback
  const ariaEl = document.querySelector('[aria-label*="Total Jobs"]');
  if (ariaEl) {
    const text = ariaEl.getAttribute('aria-label') || ariaEl.textContent || '';
    const match = text.match(/of\s+(\d+)/i);
    if (match) {
      const total = parseInt(match[1], 10);
      return Math.ceil(total / 10);
    }
  }

  return 1;
}

// Get current page number
function getCurrentPage() {
  const url = new URL(window.location.href);
  const page = url.searchParams.get('page');
  return page ? parseInt(page, 10) : 1;
}

// Wait for page to load after navigation
function waitForPageLoad(timeout = 8000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let previousCardCount = getListingCards().length;
    let stableCount = 0;

    const checkLoaded = () => {
      const cards = getListingCards();
      const currentCount = cards.length;

      // Check if count is stable (same for 2 consecutive checks)
      if (currentCount > 0 && currentCount === previousCardCount) {
        stableCount++;
        if (stableCount >= 2) {
          console.log(`Page loaded with ${currentCount} job cards`);
          setTimeout(resolve, 500); // Extra delay for Angular to settle
          return;
        }
      } else {
        stableCount = 0;
        previousCardCount = currentCount;
      }

      if (Date.now() - startTime > timeout) {
        console.log('Page load timeout reached');
        resolve();
        return;
      }

      setTimeout(checkLoaded, 300);
    };

    // Start checking after a brief delay
    setTimeout(checkLoaded, 500);
  });
}

// Navigate to next page
async function goToNextPage() {
  // Use the exact aria-label from the Encore page
  const nextBtn = document.querySelector('[aria-label="Next Page of Job Search Results"]') ||
                  document.querySelector('.mat-paginator-navigation-next');

  if (nextBtn && !nextBtn.disabled && !nextBtn.classList.contains('mat-button-disabled')) {
    console.log('Clicking next page button');
    nextBtn.click();
    // Wait for Angular to update the page
    await new Promise(resolve => setTimeout(resolve, 1500));
    await waitForPageLoad();
    return true;
  }
  console.log('No next page button found or button is disabled');
  return false;
}

// Navigate to specific page
async function goToPage(pageNum) {
  const currentUrl = new URL(window.location.href);
  currentUrl.searchParams.set('page', pageNum);
  window.location.href = currentUrl.toString();
  await waitForPageLoad();
}

// Get page stats
function getPageStats() {
  const cards = getListingCards();
  const totalPages = getTotalPages();
  const currentPage = getCurrentPage();

  return {
    jobsOnPage: cards.length,
    totalPages: totalPages,
    currentPage: currentPage
  };
}

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Content script received message:", request.action);

  if (request.action === "getStats") {
    const stats = getPageStats();
    sendResponse(stats);
  }

  else if (request.action === "scrapeCurrentPage") {
    sendResponse(scrapeJobs());
  }

  else if (request.action === "getTotalPages") {
    const totalPages = getTotalPages();
    sendResponse({ totalPages: totalPages });
  }

  else if (request.action === "getCurrentPage") {
    const currentPage = getCurrentPage();
    sendResponse({ currentPage: currentPage });
  }

  else if (request.action === "goToNextPage") {
    goToNextPage().then(success => {
      sendResponse({ success: success });
    });
    return true; // Keep channel open for async response
  }

  else if (request.action === "applyCategoryFilters") {
    applyRequiredCategoryFilters().then(result => {
      sendResponse(result);
    });
    return true;
  }

  else if (request.action === "goToPage") {
    goToPage(request.pageNum).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  else if (request.action === "hasMorePages") {
    const totalPages = getTotalPages();
    const currentPage = getCurrentPage();
    sendResponse({ hasMore: currentPage < totalPages });
  }

  return true;
});

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
  console.log("Encore Vet Job Scraper ready");
});
