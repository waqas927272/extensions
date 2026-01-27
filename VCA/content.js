// VCA Job Scraper - Content Script
// Scrapes job listings from vcacareers.com (Phenom platform)

console.log("VCA Job Scraper content script loaded");

// Extract hospital name from description/paragraph text
function extractHospitalName(text) {
  if (!text) return '';

  // Clean up the text
  const cleanText = text.trim();

  // Common VCA hospital name patterns
  const patterns = [
    // "VCA [Name] Animal Hospital" or "VCA [Name] Veterinary Hospital"
    /\b(VCA\s+[\w\s\-'\.]+(?:Animal|Veterinary|Pet)\s+(?:Hospital|Clinic|Center|Medical Center|Specialty|Emergency))/i,
    // "[Name] Animal Hospital - A VCA Company" or similar
    /([\w\s\-'\.]+(?:Animal|Veterinary|Pet)\s+(?:Hospital|Clinic|Center|Medical Center))/i,
    // "VCA [Name]" at the start of text
    /^(VCA\s+[\w\s\-'\.]+?)(?:\s+is\s+|\s+in\s+|\s+located|\s*,|\s*-|\.|$)/i,
    // Hospital name followed by "is seeking" or "is looking"
    /([\w\s\-'\.]+(?:Hospital|Clinic|Center))\s+is\s+(?:seeking|looking|hiring)/i,
    // "at [Hospital Name]" pattern
    /\bat\s+((?:VCA\s+)?[\w\s\-'\.]+(?:Animal|Veterinary|Pet)\s+(?:Hospital|Clinic|Center))/i,
    // Just "VCA [Words]" if it appears to be a hospital name (2-5 words after VCA)
    /\b(VCA\s+(?:\w+\s+){1,4}(?:Hospital|Clinic|Center|Specialty|Emergency))/i
  ];

  for (const pattern of patterns) {
    const match = cleanText.match(pattern);
    if (match && match[1]) {
      // Clean up the extracted name
      let hospitalName = match[1].trim();
      // Remove trailing punctuation or common words
      hospitalName = hospitalName.replace(/[\.,;:!?]+$/, '').trim();
      // Ensure it's a reasonable length (not too short or too long)
      if (hospitalName.length >= 5 && hospitalName.length <= 100) {
        return hospitalName;
      }
    }
  }

  return '';
}

// Scrape jobs from current page
function scrapeJobs() {
  const jobs = [];

  // Find job cards using the data attribute selectors
  const jobLinks = document.querySelectorAll('[data-ph-at-id="job-link"]');

  jobLinks.forEach(link => {
    try {
      // Get data from attributes
      const title = link.getAttribute('data-ph-at-job-title-text') || '';
      const jobId = link.getAttribute('data-ph-at-job-id-text') || '';
      const location = link.getAttribute('data-ph-at-job-location-text') || '';
      const category = link.getAttribute('data-ph-at-job-category-text') || '';
      const jobType = link.getAttribute('data-ph-at-job-type-text') || '';
      const jobUrl = link.href || '';

      // Parse location (format: "City, State, Country")
      let city = '', state = '', country = 'USA';
      if (location) {
        const parts = location.split(',').map(p => p.trim());
        city = parts[0] || '';
        state = parts[1] || '';
        country = parts[2] || 'United States of America';
      }

      // Get description teaser and hospital name from parent card
      const card = link.closest('.ph-search-results-area, .content-list-item, [data-ph-at-id="search-results-item"]') || link.parentElement?.parentElement;
      let descriptionTeaser = '';
      let hospitalName = '';

      if (card) {
        // Try to find description element
        const descEl = card.querySelector('.job-description, [data-ph-at-id="job-description"], .job-info, .job-details, .job-snippet');
        if (descEl) {
          descriptionTeaser = descEl.innerText.trim();
        }

        // Try to find hospital name in a dedicated element first
        const hospitalEl = card.querySelector('[data-ph-at-id="hospital-name"], .hospital-name, .company-name, .organization-name');
        if (hospitalEl) {
          hospitalName = hospitalEl.innerText.trim();
        }

        // If no dedicated element, try to extract from description paragraph
        if (!hospitalName && descriptionTeaser) {
          hospitalName = extractHospitalName(descriptionTeaser);
        }

        // Also check other text elements in the card for hospital name
        if (!hospitalName) {
          const allTextEls = card.querySelectorAll('p, span, div');
          for (const el of allTextEls) {
            const text = el.innerText.trim();
            if (text && text.length > 10 && text.length < 500) {
              hospitalName = extractHospitalName(text);
              if (hospitalName) break;
            }
          }
        }
      }

      if (title && jobUrl) {
        jobs.push({
          title,
          reqId: jobId,
          hospitalName,
          streetAddress: '',
          city,
          state,
          country,
          category,
          jobType,
          link: jobUrl,
          description: descriptionTeaser,
          postalCode: ''
        });
      }
    } catch (e) {
      console.error('Error scraping job card:', e);
    }
  });

  // If no jobs found with data attributes, try alternative selectors
  if (jobs.length === 0) {
    const cardContainers = document.querySelectorAll('.content-list-item, .ph-card');

    cardContainers.forEach(card => {
      try {
        const titleEl = card.querySelector('.job-title, .phs-job-title');
        const linkEl = card.querySelector('a[href*="/job/"]');
        const locationEl = card.querySelector('.job-location, .phs-job-location');
        const categoryEl = card.querySelector('.job-category, .phs-job-category');
        const descEl = card.querySelector('.job-description');

        const title = titleEl ? titleEl.innerText.trim() : '';
        const link = linkEl ? linkEl.href : '';
        const location = locationEl ? locationEl.innerText.trim() : '';
        const category = categoryEl ? categoryEl.innerText.trim() : '';
        const description = descEl ? descEl.innerText.trim() : '';

        // Extract hospital name from description
        let hospitalName = '';

        // Try dedicated hospital element first
        const hospitalEl = card.querySelector('.hospital-name, .company-name, .organization-name');
        if (hospitalEl) {
          hospitalName = hospitalEl.innerText.trim();
        }

        // Extract from description if not found
        if (!hospitalName && description) {
          hospitalName = extractHospitalName(description);
        }

        // Check other text elements
        if (!hospitalName) {
          const allTextEls = card.querySelectorAll('p, span, div');
          for (const el of allTextEls) {
            const text = el.innerText.trim();
            if (text && text.length > 10 && text.length < 500) {
              hospitalName = extractHospitalName(text);
              if (hospitalName) break;
            }
          }
        }

        // Extract job ID from URL
        let reqId = '';
        if (link) {
          const match = link.match(/job\/([^\/]+)/);
          if (match) reqId = match[1];
        }

        // Parse location
        let city = '', state = '', country = 'USA';
        if (location) {
          const parts = location.split(',').map(p => p.trim());
          city = parts[0] || '';
          state = parts[1] || '';
          country = parts[2] || 'United States of America';
        }

        if (title && link) {
          jobs.push({
            title,
            reqId,
            hospitalName,
            streetAddress: '',
            city,
            state,
            country,
            category,
            jobType: '',
            link,
            description,
            postalCode: ''
          });
        }
      } catch (e) {
        console.error('Error scraping job card:', e);
      }
    });
  }

  return jobs;
}

// Get total number of jobs and pages
function getTotalInfo() {
  // Look for result count text like "1388 jobs" or "Showing 1-10 of 1388"
  const resultCountEl = document.querySelector('.result-count, .job-count, [data-ph-at-id="result-count"]');
  if (resultCountEl) {
    const text = resultCountEl.innerText;
    const match = text.match(/(\d+)\s*(?:jobs|results|total)/i) || text.match(/of\s+(\d+)/i) || text.match(/(\d+)/);
    if (match) {
      const total = parseInt(match[1], 10);
      return {
        totalJobs: total,
        totalPages: Math.ceil(total / 10), // 10 jobs per page
        jobsPerPage: 10
      };
    }
  }

  // Try to find in pagination or other elements
  const paginationText = document.querySelector('.pagination-block, .ph-pagination');
  if (paginationText) {
    const text = paginationText.innerText;
    const match = text.match(/(\d+)\s*(?:jobs|results)/i);
    if (match) {
      const total = parseInt(match[1], 10);
      return {
        totalJobs: total,
        totalPages: Math.ceil(total / 10),
        jobsPerPage: 10
      };
    }
  }

  return {
    totalJobs: 0,
    totalPages: 1,
    jobsPerPage: 10
  };
}

// Get current page number from URL
function getCurrentPage() {
  const url = new URL(window.location.href);
  const from = url.searchParams.get('from');
  if (from) {
    return Math.floor(parseInt(from, 10) / 10) + 1;
  }
  return 1;
}

// Wait for page to load after navigation
function waitForPageLoad(timeout = 10000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let previousCount = 0;
    let stableCount = 0;

    const checkLoaded = () => {
      const jobLinks = document.querySelectorAll('[data-ph-at-id="job-link"], .job-title a, .content-list-item a[href*="/job/"]');
      const currentCount = jobLinks.length;

      // Check if count is stable
      if (currentCount > 0 && currentCount === previousCount) {
        stableCount++;
        if (stableCount >= 3) {
          console.log(`Page loaded with ${currentCount} job links`);
          setTimeout(resolve, 500);
          return;
        }
      } else {
        stableCount = 0;
        previousCount = currentCount;
      }

      if (Date.now() - startTime > timeout) {
        console.log('Page load timeout reached');
        resolve();
        return;
      }

      setTimeout(checkLoaded, 300);
    };

    setTimeout(checkLoaded, 500);
  });
}

// Navigate to next page
async function goToNextPage() {
  const currentPage = getCurrentPage();
  const nextFrom = currentPage * 10;

  // Check if there's a next page button
  const nextBtn = document.querySelector('.pagination a.next, [aria-label="Next Page"], .pagination-block button:last-child');

  // Or construct URL with from parameter
  const currentUrl = new URL(window.location.href);
  currentUrl.searchParams.set('from', nextFrom);
  currentUrl.searchParams.set('s', '1'); // Sort parameter

  console.log(`Navigating to page ${currentPage + 1} (from=${nextFrom})`);

  // Use history.pushState for SPA navigation if possible
  if (window.history && window.phApp) {
    // Phenom SPA - try clicking next button
    if (nextBtn && !nextBtn.disabled) {
      nextBtn.click();
      await new Promise(resolve => setTimeout(resolve, 1500));
      await waitForPageLoad();
      return true;
    }
  }

  // Fallback to URL navigation
  window.location.href = currentUrl.toString();
  return true;
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
    const info = getTotalInfo();
    sendResponse({ totalPages: info.totalPages, totalJobs: info.totalJobs });
  }

  else if (request.action === "getCurrentPage") {
    const currentPage = getCurrentPage();
    sendResponse({ currentPage: currentPage });
  }

  else if (request.action === "goToNextPage") {
    goToNextPage().then(success => {
      sendResponse({ success: success });
    });
    return true;
  }

  else if (request.action === "getNextPageUrl") {
    const url = getNextPageUrl();
    sendResponse({ url: url });
  }

  else if (request.action === "hasMorePages") {
    const hasMore = hasMorePages();
    sendResponse({ hasMore: hasMore });
  }

  return true;
});

// Get next page URL
function getNextPageUrl() {
  const currentPage = getCurrentPage();
  const nextFrom = currentPage * 10;
  const currentUrl = new URL(window.location.href);
  currentUrl.searchParams.set('from', nextFrom);
  currentUrl.searchParams.set('s', '1');
  return currentUrl.toString();
}

// Check if there are more pages
function hasMorePages() {
  const info = getTotalInfo();
  const currentPage = getCurrentPage();
  return currentPage < info.totalPages;
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  console.log("VCA Job Scraper ready");
});

// Also run on page load for SPAs
window.addEventListener('load', () => {
  console.log("VCA Job Scraper page loaded");
});
