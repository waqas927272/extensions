// content.js - LAASER Job Scraper (Indeed.com company page)
// Jobs are available in window.mosaic.providerData and/or DOM (.cardOutline elements)
// No pagination needed - all jobs display on single company page
if (!window.laaserJobScraperInitialized) {
  window.laaserJobScraperInitialized = true;

  window.laaserJobScraperState = {
    scraping: false,
    allJobs: []
  };

  function updateScrapingStatus(status) {
    chrome.storage.local.set({ isScraping: status });
    window.laaserJobScraperState.scraping = status;
  }

  // Extract jobs from window.mosaic.providerData via page script injection
  function extractJobsFromProviderData() {
    return new Promise((resolve) => {
      const handler = (event) => {
        if (event.source !== window) return;
        if (event.data && event.data.type === '__LAASER_SCRAPER_DATA__') {
          window.removeEventListener('message', handler);
          resolve(event.data.jobs || []);
        }
      };
      window.addEventListener('message', handler);

      const script = document.createElement('script');
      script.textContent = `
        (function() {
          var jobs = [];
          try {
            var mosaic = window.mosaic || {};
            var providerData = mosaic.providerData || {};
            var jobcards = providerData["mosaic-provider-jobcards"] || {};
            var meta = (jobcards.metaData || {}).mosaicProviderJobCardsModel || {};
            var results = meta.results || [];

            jobs = results.map(function(job) {
              // Extract job type from taxonomyAttributes
              var jobType = '';
              var jobTypes = job.jobTypes || [];
              if (jobTypes.length > 0) {
                jobType = jobTypes.join(', ');
              } else {
                var tax = job.taxonomyAttributes || [];
                for (var i = 0; i < tax.length; i++) {
                  if (tax[i].label === 'job-types') {
                    var attrs = tax[i].attributes || [];
                    jobType = attrs.map(function(a) { return a.label; }).join(', ');
                    break;
                  }
                }
              }

              // Extract salary text
              var salary = '';
              var salarySnippet = job.salarySnippet || {};
              if (salarySnippet.text) {
                salary = salarySnippet.text;
              }

              // Parse city and state from formattedLocation
              var city = job.jobLocationCity || '';
              var state = job.jobLocationState || '';
              if (!city && job.formattedLocation) {
                var parts = job.formattedLocation.split(',').map(function(s) { return s.trim(); });
                city = parts[0] || '';
                state = parts[1] || '';
              }

              return {
                jobId: job.jobkey ? 'LA-' + job.jobkey : '',
                title: job.displayTitle || job.title || '',
                hospitalName: job.truncatedCompany || job.company || 'LAASER',
                city: city,
                state: state,
                jobType: jobType,
                salary: salary,
                link: 'https://www.indeed.com/viewjob?jk=' + (job.jobkey || ''),
                postedDate: job.formattedRelativeTime || ''
              };
            });
          } catch (e) {
            console.error('Error extracting LAASER jobs from providerData:', e);
          }
          window.postMessage({ type: '__LAASER_SCRAPER_DATA__', jobs: jobs }, '*');
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
    const jobCards = document.querySelectorAll('.cardOutline.tapItem');

    jobCards.forEach(card => {
      const titleLink = card.querySelector('.jcs-JobTitle');
      const titleSpan = card.querySelector('[id^="jobTitle-"]');
      const locationEl = card.querySelector('[data-testid="text-location"]');
      const salaryEl = card.querySelector('.salary-snippet-container span');

      if (titleSpan || titleLink) {
        const title = (titleSpan || titleLink).textContent.trim();
        const jk = titleLink ? titleLink.getAttribute('data-jk') : '';

        // Parse location
        const locationText = locationEl ? locationEl.textContent.trim() : '';
        const locParts = locationText.split(',').map(s => s.trim());
        const city = locParts[0] || '';
        const state = locParts[1] || '';

        // Get salary
        const salary = salaryEl ? salaryEl.textContent.trim() : '';

        // Get job type from metadata
        let jobType = '';
        const metaItems = card.querySelectorAll('.metadataContainer li[data-testid="attribute_snippet_testid"] span');
        metaItems.forEach(item => {
          const text = item.textContent.trim();
          if (text.match(/full.time|part.time|contract|temporary|internship/i)) {
            jobType = text;
          }
        });

        jobs.push({
          jobId: jk ? 'LA-' + jk : '',
          title: title,
          hospitalName: 'LAASER',
          city: city,
          state: state,
          jobType: jobType,
          salary: salary,
          link: jk ? 'https://www.indeed.com/viewjob?jk=' + jk : '',
          postedDate: ''
        });
      }
    });
    return jobs;
  }

  // Get count of jobs visible on page
  function getJobCountFromDOM() {
    return document.querySelectorAll('.cardOutline.tapItem').length;
  }

  function sendStatsUpdate() {
    const stats = {
      totalJobsOnPage: getJobCountFromDOM(),
      scrapedRecords: window.laaserJobScraperState.allJobs.length
    };
    chrome.runtime.sendMessage({ action: 'updateStats', data: stats });
  }

  async function startScraping() {
    window.laaserJobScraperState.allJobs = [];
    window.laaserJobScraperState.scraping = true;
    updateScrapingStatus(true);

    sendStatsUpdate();

    // Try to extract from providerData first (has full structured data)
    let jobs = await extractJobsFromProviderData();

    // Fallback to DOM scraping
    if (jobs.length === 0) {
      console.log('providerData not available, falling back to DOM scraping...');
      jobs = scrapeJobsFromDOM();
    }

    window.laaserJobScraperState.allJobs = jobs;
    console.log('Scraping complete. Total jobs:', jobs.length);

    chrome.runtime.sendMessage({ action: 'storeJobs', data: jobs });
    updateScrapingStatus(false);
    sendStatsUpdate();
  }

  // Message Listener
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'start') {
      if (!window.laaserJobScraperState.scraping) {
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
      window.laaserJobScraperState.scraping = false;
      updateScrapingStatus(false);
      sendStatsUpdate();
      sendResponse({ status: 'stopped' });
    } else if (request.action === 'getInitialStats') {
      sendResponse({
        totalJobsOnPage: getJobCountFromDOM(),
        scrapedRecords: window.laaserJobScraperState.allJobs.length
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
  console.log("LAASER content script already initialized.");
}
