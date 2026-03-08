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

      let city = 'N/A';
      let state = 'N/A';
      let country = 'USA';
      let location = 'N/A';

      if (locationElement && locationElement.innerText) {
        const locationText = locationElement.innerText.trim();
        location = locationText;
        const parts = locationText.split(',').map(s => s.trim()).filter(s => s);

        if (parts.length >= 2) {
          city = parts.slice(0, -1).join(', '); // Handle cases like "Washington, D.C."
          state = parts[parts.length - 1];
        } else if (parts.length === 1) {
          if (parts[0].length > 2) {
            city = parts[0];
          } else {
            state = parts[0];
          }
        }
      }

      scrapedJobs.push({ title, jobId, hospital, city, state, country, link, location });
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