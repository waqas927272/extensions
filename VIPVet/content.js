// VIP Vet Job Scraper - Content Script
// Scrapes job listings from vip-vet.com (Greenhouse embedded)

console.log("VIP Vet Job Scraper content script loaded on:", window.location.href);

// Check if we're in the Greenhouse iframe
const isGreenhouseFrame = window.location.href.includes('greenhouse.io');

// Parse location from job title (e.g., "Job Title - Hospital Name - TX")
function parseLocationFromTitle(title) {
  let city = '', state = '';

  // Look for state abbreviation pattern like "- TX" or "- NY" at the end
  const stateMatch = title.match(/[-â€“]\s*([A-Z]{2})\s*$/);
  if (stateMatch) {
    state = stateMatch[1];
  }

  // Try to extract city - often before state
  const cityStateMatch = title.match(/[-â€“]\s*([A-Za-z\s\.]+),?\s*([A-Z]{2})\s*$/);
  if (cityStateMatch) {
    city = cityStateMatch[1].trim();
    state = cityStateMatch[2];
  }

  return { city, state };
}

// Scrape jobs from the Greenhouse job board
function scrapeJobs() {
  const jobs = [];
  console.log("Scraping jobs from:", window.location.href);

  // Greenhouse job board structure
  const jobPosts = document.querySelectorAll('tr.job-post');
  console.log("Found job posts:", jobPosts.length);

  jobPosts.forEach((post, index) => {
    try {
      const cell = post.querySelector('td.cell');
      if (!cell) return;

      const linkEl = cell.querySelector('a');
      if (!linkEl) return;

      const link = linkEl.href;

      // Get job title
      const titleEl = linkEl.querySelector('p.body--medium, p.body.body--medium');
      const title = titleEl ? titleEl.innerText.trim() : linkEl.innerText.trim();

      // Get hospital name from metadata
      const hospitalEl = linkEl.querySelector('p.body__secondary, p.body.body__secondary');
      const hospitalName = hospitalEl ? hospitalEl.innerText.trim() : '';

      if (!title || !link) return;

      // Extract job ID from URL (gh_jid parameter or /jobs/ID)
      let rawReqId = '';
      const ghMatch = link.match(/gh_jid=(\d+)/);
      if (ghMatch) {
        rawReqId = ghMatch[1];
      } else {
        const jobMatch = link.match(/jobs\/(\d+)/);
        if (jobMatch) rawReqId = jobMatch[1];
      }
      const reqId = rawReqId ? 'VIP-' + rawReqId : '';

      // Parse location from title
      const { city, state } = parseLocationFromTitle(title);

      jobs.push({
        title,
        reqId,
        hospitalName,
        streetAddress: '',
        city,
        state,
        country: 'USA',
        category: '',
        jobType: '',
        link,
        description: '',
        postalCode: ''
      });

      console.log(`Job ${index + 1}:`, title, '|', hospitalName, '|', reqId);
    } catch (e) {
      console.error('Error scraping job post:', e);
    }
  });

  // Also try alternative selectors if no jobs found
  if (jobs.length === 0) {
    console.log("Trying alternative selectors...");

    // Try finding any job links
    const allJobLinks = document.querySelectorAll('a[href*="gh_jid"], a[href*="/jobs/"]');
    console.log("Found job links:", allJobLinks.length);

    allJobLinks.forEach((linkEl, index) => {
      try {
        const link = linkEl.href;

        // Skip non-job links
        if (!link.includes('gh_jid') && !link.match(/\/jobs\/\d+/)) return;

        // Get title from link or parent
        let title = '';
        const titleEl = linkEl.querySelector('p.body--medium, .job-title, strong');
        if (titleEl) {
          title = titleEl.innerText.trim();
        } else {
          title = linkEl.innerText.trim().split('\n')[0];
        }

        // Get hospital from sibling or child
        let hospitalName = '';
        const hospitalEl = linkEl.querySelector('p.body__secondary, .body--metadata');
        if (hospitalEl) {
          hospitalName = hospitalEl.innerText.trim();
        }

        if (!title || title.length < 3) return;

        // Extract job ID
        let rawReqId = '';
        const ghMatch = link.match(/gh_jid=(\d+)/);
        if (ghMatch) {
          rawReqId = ghMatch[1];
        } else {
          const jobMatch = link.match(/jobs\/(\d+)/);
          if (jobMatch) rawReqId = jobMatch[1];
        }
        const reqId = rawReqId ? 'VIP-' + rawReqId : '';

        // Skip duplicates
        if (jobs.some(j => j.reqId === reqId)) return;

        const { city, state } = parseLocationFromTitle(title);

        jobs.push({
          title,
          reqId,
          hospitalName,
          streetAddress: '',
          city,
          state,
          country: 'USA',
          category: '',
          jobType: '',
          link,
          description: '',
          postalCode: ''
        });
      } catch (e) {
        console.error('Error with alternative scraping:', e);
      }
    });
  }

  console.log("Total jobs scraped:", jobs.length);
  return jobs;
}

// Get total number of jobs from the page header
function getTotalInfo() {
  // Look for "68 jobs" type text
  const headers = document.querySelectorAll('h2, .section-header, [data-testid="job-count-header"]');
  for (const el of headers) {
    const text = el.innerText;
    const match = text.match(/(\d+)\s*jobs?/i);
    if (match) {
      return {
        totalJobs: parseInt(match[1], 10),
        totalPages: 1,
        jobsPerPage: 50
      };
    }
  }

  // Count visible jobs
  const jobPosts = document.querySelectorAll('tr.job-post');
  return {
    totalJobs: jobPosts.length,
    totalPages: 1,
    jobsPerPage: jobPosts.length
  };
}

// Get current page from pagination
function getCurrentPage() {
  const activeBtn = document.querySelector('.pagination__link--active, .pagination .active');
  if (activeBtn) {
    return parseInt(activeBtn.innerText, 10) || 1;
  }
  return 1;
}

// Check for more pages
function hasMorePages() {
  const nextBtn = document.querySelector('.pagination__next:not([aria-disabled="true"]):not(.pagination__next--inactive)');
  return !!nextBtn;
}

// Get page stats
function getPageStats() {
  const jobs = scrapeJobs();
  const info = getTotalInfo();
  const currentPage = getCurrentPage();

  return {
    jobsOnPage: jobs.length,
    totalJobs: info.totalJobs,
    totalPages: info.totalPages,
    currentPage: currentPage,
    isGreenhouse: isGreenhouseFrame
  };
}

// Listen for messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Content script received message:", request.action, "on", window.location.href);

  if (request.action === "getStats") {
    const stats = getPageStats();
    console.log("Stats:", stats);
    sendResponse(stats);
  }

  else if (request.action === "scrapeCurrentPage") {
    const jobs = scrapeJobs();
    console.log("Scraped jobs:", jobs.length);
    sendResponse({ jobs: jobs, isGreenhouse: isGreenhouseFrame });
  }

  else if (request.action === "getTotalPages") {
    const info = getTotalInfo();
    sendResponse({ totalPages: info.totalPages, totalJobs: info.totalJobs });
  }

  else if (request.action === "getCurrentPage") {
    sendResponse({ currentPage: getCurrentPage() });
  }

  else if (request.action === "hasMorePages") {
    sendResponse({ hasMore: hasMorePages() });
  }

  else if (request.action === "ping") {
    sendResponse({ pong: true, url: window.location.href, isGreenhouse: isGreenhouseFrame });
  }

  return true;
});

// Log when ready
console.log("VIP Vet content script ready. isGreenhouse:", isGreenhouseFrame);

