// Shore Capital Job Scraper - Content Script

console.log("Shore Capital Job Scraper content script loaded on:", window.location.href);

// Scrape companies from the page
function scrapeCompanies() {
  const companies = [];
  const companyItems = document.querySelectorAll('.job-boards-company-item');

  console.log("Found company items:", companyItems.length);

  companyItems.forEach((item, index) => {
    try {
      const nameEl = item.querySelector('.job-boards-company-name');
      const name = nameEl ? nameEl.innerText.trim() : '';

      const descEl = item.querySelector('.job-boards-company-description');
      const description = descEl ? descEl.innerText.trim() : '';

      const linkEl = item.querySelector('.job-boards-company-item-link');
      const logoEl = item.querySelector('.job-boards-company-logo');

      const link = linkEl ? linkEl.href : '';
      const logo = logoEl ? logoEl.src : '';

      const numJobs = parseInt(item.dataset.numJobs || '0', 10);

      // Get tags
      const tags = [];
      const tagElements = item.querySelectorAll('.job-boards-company-tag');
      tagElements.forEach(tag => {
        tags.push(tag.innerText.trim());
      });

      // Parse location from tags
      let location = '';
      const locationTags = item.querySelectorAll('.job-boards-company-tag-locations');
      if (locationTags.length > 0) {
        location = Array.from(locationTags).map(t => t.innerText.trim()).join(', ');
      }

      // Parse industry from tags
      let industry = '';
      const industryTags = item.querySelectorAll('.job-boards-company-tag-industries');
      if (industryTags.length > 0) {
        industry = Array.from(industryTags).map(t => t.innerText.trim()).join(', ');
      }

      // Get employee count
      let employees = '';
      const allTags = item.querySelectorAll('.job-boards-company-tag');
      allTags.forEach(tag => {
        const text = tag.innerText.trim();
        if (text.includes('employees')) {
          employees = text;
        }
      });

      // Get jobs link
      const jobsLinkEl = item.querySelector('.job-boards-company-link');
      const jobsLink = jobsLinkEl ? jobsLinkEl.href : '';

      if (name) {
        companies.push({
          name,
          description,
          link,
          jobsLink,
          logo,
          numJobs,
          location,
          industry,
          employees,
          tags
        });
      }
    } catch (e) {
      console.error('Error scraping company item:', e);
    }
  });

  console.log("Total companies scraped:", companies.length);
  return companies;
}

// Get page stats
function getPageStats() {
  const companyItems = document.querySelectorAll('.job-boards-company-item');

  // Get total count from page
  const countEl = document.querySelector('.job-boards-company-grid-count');
  let totalCount = companyItems.length;
  if (countEl) {
    const match = countEl.innerText.match(/(\d+)/);
    if (match) {
      totalCount = parseInt(match[1], 10);
    }
  }

  // Get total jobs count from header
  let totalJobs = 0;
  const headerEl = document.querySelector('.job-boards-title');
  if (headerEl) {
    const match = headerEl.innerText.match(/(\d+)\s*jobs/i);
    if (match) {
      totalJobs = parseInt(match[1], 10);
    }
  }

  return {
    companiesOnPage: companyItems.length,
    totalCompanies: totalCount,
    totalJobs: totalJobs
  };
}

// Scroll to load more content
function scrollToLoadMore() {
  return new Promise((resolve) => {
    const previousHeight = document.body.scrollHeight;
    window.scrollTo(0, document.body.scrollHeight);

    setTimeout(() => {
      const newHeight = document.body.scrollHeight;
      resolve(newHeight > previousHeight);
    }, 1500);
  });
}

// Listen for messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Content script received message:", request.action);

  if (request.action === "getStats") {
    const stats = getPageStats();
    console.log("Stats:", stats);
    sendResponse(stats);
  }

  else if (request.action === "scrapeCompanies") {
    const companies = scrapeCompanies();
    console.log("Scraped companies:", companies.length);
    sendResponse({ companies });
  }

  else if (request.action === "scrollToLoadMore") {
    scrollToLoadMore().then(hasMore => {
      sendResponse({ hasMore, count: document.querySelectorAll('.job-boards-company-item').length });
    });
    return true;
  }

  else if (request.action === "ping") {
    sendResponse({ pong: true, url: window.location.href });
  }

  return true;
});

console.log("Shore Capital content script ready.");
