// content.js - Thrive Pet Healthcare Job Scraper
// Jobs are rendered in DOM with pagination (25 per page, AJAX-loaded)
if (!window.thriveJobScraperInitialized) {
  window.thriveJobScraperInitialized = true;

  window.thriveJobScraperState = {
    scraping: false,
    allJobs: [],
    totalJobsOnPage: 0,
    currentPage: 0,
    totalPages: 0
  };

  function updateScrapingStatus(status) {
    chrome.storage.local.set({ isScraping: status });
    window.thriveJobScraperState.scraping = status;
  }

  // Parse a single job item element
  function parseJobItem(item) {
    const titleLink = item.querySelector('h4.heading-3 a');
    if (!titleLink) return null;

    const title = titleLink.textContent.trim();
    const link = titleLink.href;
    const jobIdMatch = link.match(/\/jobs\/(\d+)/);
    const jobId = jobIdMatch ? 'THR-' + jobIdMatch[1] : '';

    // Get the info column
    const colDiv = item.querySelector('.columns.medium-9') || item.querySelector('.columns.large-10');
    if (!colDiv) return { jobId, title, hospitalName: '', city: '', state: '', postalCode: '', jobType: '', link };

    // Get full text content, normalize whitespace
    const fullText = colDiv.textContent.replace(/\s+/g, ' ').trim();

    // Split by | separator
    const pipeSegments = fullText.split(/\s*\|\s*/);

    // First segment: title + possible "NEW" + hospital name
    let hospitalName = '';
    if (pipeSegments[0]) {
      let firstPart = pipeSegments[0];
      // Remove the title text
      const titleIndex = firstPart.indexOf(title);
      if (titleIndex >= 0) {
        firstPart = firstPart.substring(titleIndex + title.length).trim();
      }
      // Remove "NEW" tag if present
      firstPart = firstPart.replace(/^NEW\s*/i, '').trim();
      hospitalName = firstPart;
    }

    // Second segment: location (city, state, zip) or "Remote"
    let city = '', state = '', postalCode = '';
    if (pipeSegments[1]) {
      const locationText = pipeSegments[1].trim();
      if (locationText.toLowerCase() === 'remote') {
        city = 'Remote';
      } else {
        // Parse location: "Long Beach, CA, 90804" or "City, State Zip"
        const parts = locationText.split(',').map(s => s.trim()).filter(s => s);
        if (parts.length >= 1) city = parts[0];
        if (parts.length >= 2) {
          // Second part could be "CA" or "CA 90804"
          const stateZipStr = parts.slice(1).join(' ').trim();
          const stateZipMatch = stateZipStr.match(/([A-Z]{2})\s*(\d{5})?/);
          if (stateZipMatch) {
            state = stateZipMatch[1];
            postalCode = stateZipMatch[2] || '';
          } else {
            // Try to find zip at the end
            const zipMatch = stateZipStr.match(/(\d{5})\s*$/);
            if (zipMatch) {
              postalCode = zipMatch[1];
              state = stateZipStr.replace(zipMatch[0], '').trim();
            } else {
              state = stateZipStr;
            }
          }
        }
      }
    }

    // Third segment: job type (Full-Time, Part-Time, etc.)
    let jobType = '';
    if (pipeSegments[2]) {
      jobType = pipeSegments[2].trim();
      // Clean up any remaining "Apply Now" text that might sneak in
      jobType = jobType.replace(/Apply Now.*/i, '').trim();
    }

    return { jobId, title, hospitalName, city, state, postalCode, jobType, link };
  }

  // Scrape all jobs from a document/DOM
  function scrapeJobsFromDoc(doc) {
    const jobs = [];
    const jobItems = doc.querySelectorAll('.jobs-section__item');
    jobItems.forEach(item => {
      const job = parseJobItem(item);
      if (job) jobs.push(job);
    });
    return jobs;
  }

  // Get total results count from page
  function getTotalResultsCount(doc) {
    const labels = doc.querySelectorAll('.facet-jobs-loaded label, .facet-jobs-loaded');
    for (const label of labels) {
      const text = label.textContent || '';
      const match = text.match(/of\s+([\d,]+)\s+results/i);
      if (match) return parseInt(match[1].replace(/,/g, ''));
    }
    // Fallback: count jobs on current page
    return doc.querySelectorAll('.jobs-section__item').length;
  }

  // Count jobs visible on current page DOM
  function getJobCountFromDOM() {
    const totalText = document.querySelector('.facet-jobs-loaded label')?.textContent || '';
    const match = totalText.match(/of\s+([\d,]+)\s+results/i);
    if (match) return parseInt(match[1].replace(/,/g, ''));
    return document.querySelectorAll('.jobs-section__item').length;
  }

  function sendStatsUpdate() {
    const state = window.thriveJobScraperState;
    const stats = {
      totalJobsOnPage: state.totalJobsOnPage || getJobCountFromDOM(),
      scrapedRecords: state.allJobs.length,
      currentPage: state.currentPage,
      totalPages: state.totalPages
    };
    chrome.runtime.sendMessage({ action: 'updateStats', data: stats });
  }

  async function startScraping() {
    const state = window.thriveJobScraperState;
    state.allJobs = [];
    state.scraping = true;
    updateScrapingStatus(true);

    // Get total results count
    const totalResults = getTotalResultsCount(document);
    state.totalJobsOnPage = totalResults;
    const totalPages = Math.ceil(totalResults / 25);
    state.totalPages = totalPages;

    // Scrape the current page first
    state.currentPage = 1;
    let currentPageJobs = scrapeJobsFromDoc(document);
    state.allJobs = state.allJobs.concat(currentPageJobs);
    sendStatsUpdate();

    console.log(`Page 1: scraped ${currentPageJobs.length} jobs. Total so far: ${state.allJobs.length}`);

    // Fetch remaining pages
    for (let page = 2; page <= totalPages; page++) {
      if (!state.scraping) break;

      state.currentPage = page;

      try {
        const url = `/search/jobs/in?location=&page=${page}&q=`;
        const response = await fetch(url);
        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const pageJobs = scrapeJobsFromDoc(doc);
        state.allJobs = state.allJobs.concat(pageJobs);

        console.log(`Page ${page}: scraped ${pageJobs.length} jobs. Total so far: ${state.allJobs.length}`);
        sendStatsUpdate();

        // Small delay to avoid hammering the server
        await new Promise(resolve => setTimeout(resolve, 300));
      } catch (err) {
        console.error(`Error fetching page ${page}:`, err);
      }
    }

    console.log('Scraping complete. Total jobs:', state.allJobs.length);

    chrome.runtime.sendMessage({ action: 'storeJobs', data: state.allJobs });
    updateScrapingStatus(false);
    sendStatsUpdate();
  }

  // Message Listener
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'start') {
      if (!window.thriveJobScraperState.scraping) {
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
      window.thriveJobScraperState.scraping = false;
      updateScrapingStatus(false);
      sendStatsUpdate();
      sendResponse({ status: 'stopped' });
    } else if (request.action === 'getInitialStats') {
      const state = window.thriveJobScraperState;
      sendResponse({
        totalJobsOnPage: state.totalJobsOnPage || getJobCountFromDOM(),
        scrapedRecords: state.allJobs.length,
        currentPage: state.currentPage,
        totalPages: state.totalPages
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
  console.log("Thrive content script already initialized.");
}
