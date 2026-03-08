// content.js - Cove Job Scraper (Paylocity)
// All jobs are available in window.pageData.Jobs - no pagination needed
if (!window.coveJobScraperInitialized) {
  window.coveJobScraperInitialized = true;

  window.coveJobScraperState = {
    scraping: false,
    allJobs: []
  };

  function updateScrapingStatus(status) {
    chrome.storage.local.set({ isScraping: status });
    window.coveJobScraperState.scraping = status;
  }

  // Extract jobs from window.pageData.Jobs via page script injection
  function extractJobsFromPageData() {
    return new Promise((resolve) => {
      const handler = (event) => {
        if (event.source !== window) return;
        if (event.data && event.data.type === '__COVE_SCRAPER_DATA__') {
          window.removeEventListener('message', handler);
          resolve(event.data.jobs || []);
        }
      };
      window.addEventListener('message', handler);

      const script = document.createElement('script');
      script.textContent = `
        (function() {
          var data = window.pageData;
          var jobs = [];
          if (data && data.Jobs) {
            jobs = data.Jobs.map(function(job) {
              var loc = job.JobLocation || {};
              return {
                jobId: job.JobId ? 'COV-' + job.JobId : '',
                title: job.JobTitle || '',
                hospitalName: job.LocationName || '',
                department: job.HiringDepartment || '',
                city: loc.City || '',
                state: loc.State || '',
                country: loc.Country || 'USA',
                streetAddress: loc.Address || '',
                postalCode: loc.Zip || '',
                link: 'https://recruiting.paylocity.com/Recruiting/Jobs/Details/' + job.JobId,
                publishedDate: job.PublishedDate || '',
                isRemote: job.IsRemote || false
              };
            });
          }
          window.postMessage({ type: '__COVE_SCRAPER_DATA__', jobs: jobs }, '*');
        })();
      `;
      (document.head || document.documentElement).appendChild(script);
      script.remove();

      // Timeout fallback
      setTimeout(() => {
        window.removeEventListener('message', handler);
        resolve([]);
      }, 5000);
    });
  }

  // Fallback: scrape jobs from DOM
  function scrapeJobsFromDOM() {
    const jobs = [];
    const jobItems = document.querySelectorAll('.job-listing-job-item');
    jobItems.forEach(item => {
      const titleEl = item.querySelector('.job-item-title a');
      const locationEl = item.querySelector('.location-column .job-item-normal');
      const departmentEl = item.querySelector('.job-title-column .job-item-normal');

      if (titleEl) {
        const link = titleEl.href;
        const rawJobId = link ? link.split('/').pop() : '';
        const jobId = rawJobId ? 'COV-' + rawJobId : '';

        jobs.push({
          jobId: jobId,
          title: titleEl.innerText.trim(),
          hospitalName: locationEl ? locationEl.innerText.trim() : '',
          department: departmentEl ? departmentEl.innerText.trim() : '',
          link: link,
          city: '',
          state: '',
          country: 'USA',
          streetAddress: '',
          postalCode: ''
        });
      }
    });
    return jobs;
  }

  // Get count of jobs visible on page from DOM
  function getJobCountFromDOM() {
    return document.querySelectorAll('.job-listing-job-item').length;
  }

  function sendStatsUpdate() {
    const stats = {
      totalJobsOnPage: getJobCountFromDOM(),
      scrapedRecords: window.coveJobScraperState.allJobs.length
    };
    chrome.runtime.sendMessage({ action: 'updateStats', data: stats });
  }

  async function startScraping() {
    window.coveJobScraperState.allJobs = [];
    window.coveJobScraperState.scraping = true;
    updateScrapingStatus(true);

    sendStatsUpdate();

    // Try to extract from pageData first (has full structured data)
    let jobs = await extractJobsFromPageData();

    // Fallback to DOM scraping
    if (jobs.length === 0) {
      console.log('pageData not available, falling back to DOM scraping...');
      jobs = scrapeJobsFromDOM();
    }

    window.coveJobScraperState.allJobs = jobs;
    console.log('Scraping complete. Total jobs:', jobs.length);

    chrome.runtime.sendMessage({ action: 'storeJobs', data: jobs });
    updateScrapingStatus(false);
    sendStatsUpdate();
  }

  // Message Listener
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'start') {
      if (!window.coveJobScraperState.scraping) {
        console.log('Starting job scraping...');
        startScraping().then(() => {
          sendResponse({ status: 'completed' });
        });
        return true;
      } else {
        sendResponse({ status: 'already_running' });
      }
    } else if (request.action === 'stop') {
      console.log('Stopping scraping.');
      window.coveJobScraperState.scraping = false;
      updateScrapingStatus(false);
      sendStatsUpdate();
      sendResponse({ status: 'stopped' });
    } else if (request.action === 'getInitialStats') {
      sendResponse({
        totalJobsOnPage: getJobCountFromDOM(),
        scrapedRecords: window.coveJobScraperState.allJobs.length
      });
    }
  });

  // Initial stats update on script load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sendStatsUpdate);
  } else {
    sendStatsUpdate();
  }

} else {
  console.log("Cove content script already initialized.");
}
