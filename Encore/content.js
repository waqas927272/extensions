// Encore Vet Job Scraper - Content Script
// Scrapes job listings from careers.encorevet.com (Angular/Material)

console.log("Encore Vet Job Scraper content script loaded");

// Scrape jobs from current page
function scrapeJobs() {
  const jobs = [];
  const cards = document.querySelectorAll('.search-result-item');

  cards.forEach(card => {
    try {
      // Job title from itemprop="title" span
      const titleEl = card.querySelector('[itemprop="title"]');
      const title = titleEl ? titleEl.innerText.trim() : '';

      // Job URL from job-title-link anchor
      const linkEl = card.querySelector('.job-title-link');
      const link = linkEl ? linkEl.href : '';

      // Extract job ID from URL (handles /jobs/1234 and /job/1234 patterns)
      const jobIdMatch = link.match(/\/jobs?\/(\d+)/);
      const rawJobId = jobIdMatch ? jobIdMatch[1] : (link ? link.split('/').filter(s => /^\d+$/.test(s))[0] || '' : '');
      const jobId = rawJobId ? 'E-' + rawJobId : '';

      // Req ID from .req-id span
      const reqIdEl = card.querySelector('.req-id span');
      const reqId = reqIdEl ? reqIdEl.innerText.trim() : '';

      // Location: multi-line with hospital, street, city/state
      const locationEl = card.querySelector('.label-value.location');
      let hospitalName = '', streetAddress = '', city = '', state = '';
      if (locationEl) {
        const lines = locationEl.innerText.trim().split('\n').filter(l => l.trim());
        hospitalName = lines[0] || '';
        streetAddress = lines[1] || '';
        const cityState = lines[2] || '';
        // Parse "City, State" format
        const cityStateMatch = cityState.match(/^(.+),\s*(.+)$/);
        if (cityStateMatch) {
          city = cityStateMatch[1].trim();
          state = cityStateMatch[2].trim();
        } else {
          city = cityState.trim();
        }
      }

      // Category
      const categoryEl = card.querySelector('.categories.label-value');
      const category = categoryEl ? categoryEl.innerText.trim() : '';

      if (title && link) {
        jobs.push({
          title,
          jobId,
          reqId,
          hospitalName,
          streetAddress,
          city,
          state,
          country: 'USA',
          category,
          link,
          description: '',
          jobType: '',
          postalCode: ''
        });
      }
    } catch (e) {
      console.error('Error scraping job card:', e);
    }
  });

  return jobs;
}

// Get total number of pages
function getTotalPages() {
  // Find pagination range label like "1 – 10 of 78 Total Jobs"
  const paginationEl = document.querySelector('.mat-paginator-range-label');
  if (paginationEl) {
    const text = paginationEl.textContent || paginationEl.getAttribute('aria-label') || '';
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
    let previousCardCount = document.querySelectorAll('.search-result-item').length;
    let stableCount = 0;

    const checkLoaded = () => {
      const cards = document.querySelectorAll('.search-result-item');
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
  const cards = document.querySelectorAll('.search-result-item');
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
    const jobs = scrapeJobs();
    sendResponse({ jobs: jobs });
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
