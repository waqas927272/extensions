// content.js
function scrapeCurrentPage() {
    const scrapedJobs = [];
    // Each job listing is an <a> tag with class 'job-item'
    const jobItems = document.querySelectorAll('a.job-item');

    jobItems.forEach(jobItem => {
      const titleElement = jobItem.querySelector('.jv-job-list-name');
      const locationElement = jobItem.querySelector('.jv-job-list-location');
      const companyElement = jobItem.querySelector('.jv-job-list-company');

      const title = titleElement ? titleElement.innerText.trim() : 'N/A';
      const hospital = companyElement ? companyElement.innerText.trim() : 'N/A';
      const link = jobItem.href;

      // Extract job ID from URL
      let jobId = '';
      if (link) {
        const urlPath = link.replace(/[?#].*$/, '').replace(/\/+$/, '');
        const rawJobId = urlPath.split('/').pop() || '';
        jobId = rawJobId ? 'UVC-' + rawJobId : '';
      }

      // During initial scraping, only fill the location field
      // City and State will remain empty and be filled later via "Fetch Addresses" button
      let city = '';
      let state = '';
      let location = '';

      if (locationElement && locationElement.innerText) {
        const locationText = locationElement.innerText.trim();
        location = locationText;
      }

      scrapedJobs.push({ title, jobId, hospital, city, state, link, location });
    });
    return scrapedJobs;
}

function clickNextPage() {
    const nextButton = document.querySelector('.jv-pagination-next');
    if (nextButton && !nextButton.disabled && !nextButton.classList.contains('jv-pagination-disabled')) {
        nextButton.click();
        return { clicked: true };
    } else {
        return { clicked: false, error: "Next button not found or is disabled." };
    }
}

function applyFiltersAndSearch() {
    const categorySelect = document.getElementById('jv-search-category');
    const searchButton = document.querySelector('.jv-search-form .jv-button-primary');

    if (!categorySelect || !searchButton) {
        return { success: false, error: "Filters or Search button not found." };
    }

    const targetCategories = [
        "Specialty Diplomate",
        "Surgeon Diplomate",
        "Veterinarian (ER)",
        "Veterinarian (Gen Practice)"
    ];

    // Clear existing selections
    Array.from(categorySelect.options).forEach(option => option.selected = false);

    // Select target categories
    let selectedCount = 0;
    Array.from(categorySelect.options).forEach(option => {
        if (targetCategories.includes(option.value.trim()) || targetCategories.includes(option.text.trim())) {
            option.selected = true;
            selectedCount++;
        }
    });

    if (selectedCount === 0) {
        return { success: false, error: "Target categories not found in dropdown." };
    }

    // Trigger change event for AngularJS
    categorySelect.dispatchEvent(new Event('change', { bubbles: true }));

    // Click search
    searchButton.click();

    return { success: true, message: `Selected ${selectedCount} categories and clicked Search.` };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'applyFiltersAndSearch') {
    const result = applyFiltersAndSearch();
    sendResponse(result);
    return true;
  } else if (request.action === 'scrapeCurrentPage') {
    const jobs = scrapeCurrentPage();
    sendResponse({ jobs: jobs });
    return true; // Indicate asynchronous response
  } else if (request.action === 'clickNextPage') {
    const result = clickNextPage();
    sendResponse(result);
    return true; // Indicate asynchronous response
  }
});