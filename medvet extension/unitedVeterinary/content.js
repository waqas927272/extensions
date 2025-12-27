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

      let state = 'N/A';
      let country = 'N/A';
      if (locationElement && locationElement.innerText) {
        const locationText = locationElement.innerText.trim();
        const parts = locationText.split(',').map(s => s.trim()).filter(s => s !== '');

        if (parts.length >= 2) {
          state = parts[parts.length - 1];
          country = 'USA';
        } else if (parts.length === 1) {
          state = parts[0];
          country = 'USA';
        }
      }

      scrapedJobs.push({ title, hospital, state, country, link });
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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'scrapeCurrentPage') {
    const jobs = scrapeCurrentPage();
    sendResponse({ jobs: jobs });
    return true; // Indicate asynchronous response
  } else if (request.action === 'clickNextPage') {
    const result = clickNextPage();
    sendResponse(result);
    return true; // Indicate asynchronous response
  }
});