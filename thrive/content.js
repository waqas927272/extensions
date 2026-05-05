// content.js - Jobvite listing scraper for Thrive Pet Healthcare
// Scrapes titles and URLs from app.jobvite.com/Recruiter/JobListing.aspx.
if (!window.thriveJobScraperInitialized) {
  window.thriveJobScraperInitialized = true;

  const JOBVITE_LISTING_PATH = '/Recruiter/JobListing.aspx';

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

  function isJobviteListingPage() {
    return location.hostname === 'app.jobvite.com' && location.pathname.endsWith(JOBVITE_LISTING_PATH);
  }

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function absoluteUrl(href) {
    try {
      return new URL(href, location.href).toString();
    } catch (e) {
      return href || '';
    }
  }

  function getListingTable() {
    return document.querySelector('table.jv-listTable');
  }

  function scrapeJobsFromDoc(doc) {
    const jobs = [];
    const table = doc.querySelector('table.jv-listTable');
    if (!table) return jobs;

    const links = table.querySelectorAll('td:first-child a[href*="JobDescription.aspx"]');
    links.forEach(linkEl => {
      const title = cleanText(linkEl.textContent);
      const link = absoluteUrl(linkEl.getAttribute('href') || linkEl.href);
      if (!title || !link) return;

      jobs.push({
        jobId: '',
        title,
        hospital: '',
        hospitalName: '',
        company: '',
        postedDate: '',
        city: '',
        state: '',
        zipCode: '',
        postalCode: '',
        jobType: '',
        location: '',
        country: 'USA',
        link
      });
    });

    return jobs;
  }

  function getFooterText() {
    const table = getListingTable();
    const footer = table?.querySelector('.jv-thFooter');
    return cleanText(footer?.textContent || '');
  }

  function getTotalResultsCount() {
    const footerText = getFooterText();
    const match = footerText.match(/of\s+([\d,]+)\s+Jobs/i);
    if (match) return parseInt(match[1].replace(/,/g, ''), 10);
    return scrapeJobsFromDoc(document).length;
  }

  function getCurrentRangeStart() {
    const footerText = getFooterText();
    const match = footerText.match(/(\d+)\s*-\s*\d+\s+of\s+[\d,]+\s+Jobs/i);
    return match ? parseInt(match[1], 10) : 0;
  }

  function getPageSignature() {
    const jobs = scrapeJobsFromDoc(document);
    const firstJob = jobs[0];
    return [
      getCurrentRangeStart(),
      getFooterText(),
      firstJob?.title || '',
      firstJob?.link || ''
    ].join('|');
  }

  function getNextButton() {
    const table = getListingTable();
    if (!table) return null;

    return Array.from(table.querySelectorAll('.jv-thFooter a'))
      .find(link =>
        cleanText(link.textContent).toLowerCase() === 'next' &&
        !link.classList.contains('disabled') &&
        !link.classList.contains('jv-pagination-disabled')
      );
  }

  function hasNextPage() {
    return !!getNextButton();
  }

  function clickNextPage() {
    const nextButton = getNextButton();
    if (!nextButton) {
      return { clicked: false, error: 'Next button not found or disabled.' };
    }
    nextButton.click();
    return { clicked: true };
  }

  function sendStatsUpdate() {
    const state = window.thriveJobScraperState;
    chrome.runtime.sendMessage({
      action: 'updateStats',
      data: {
        totalJobsOnPage: state.totalJobsOnPage || getTotalResultsCount(),
        scrapedRecords: state.allJobs.length,
        currentPage: state.currentPage,
        totalPages: state.totalPages
      }
    }).catch(() => {});
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function waitForPageChange(previousStart, timeoutMs = 15000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      await wait(300);
      const nextStart = getCurrentRangeStart();
      if (nextStart && nextStart !== previousStart) return true;
      if (!document.querySelector('table.jv-listTable')) continue;
    }
    return false;
  }

  async function startScraping() {
    const state = window.thriveJobScraperState;
    if (!isJobviteListingPage()) {
      updateScrapingStatus(false);
      return {
        status: 'wrong_url',
        message: 'Open https://app.jobvite.com/Recruiter/JobListing.aspx before starting.'
      };
    }

    state.allJobs = [];
    state.scraping = true;
    state.currentPage = 0;
    state.totalJobsOnPage = getTotalResultsCount();
    state.totalPages = Math.max(1, Math.ceil(state.totalJobsOnPage / 20));
    updateScrapingStatus(true);
    sendStatsUpdate();

    const seenLinks = new Set();

    while (state.scraping) {
      state.currentPage += 1;
      const currentJobs = scrapeJobsFromDoc(document);

      currentJobs.forEach(job => {
        if (!seenLinks.has(job.link)) {
          seenLinks.add(job.link);
          state.allJobs.push(job);
        }
      });

      sendStatsUpdate();
      console.log(`Page ${state.currentPage}: scraped ${currentJobs.length} jobs. Total so far: ${state.allJobs.length}`);

      const nextButton = getNextButton();
      if (!nextButton) break;

      const previousStart = getCurrentRangeStart();
      nextButton.click();

      const changed = await waitForPageChange(previousStart);
      if (!changed) break;
      await wait(500);
    }

    chrome.runtime.sendMessage({ action: 'storeJobs', data: state.allJobs }).catch(() => {});
    updateScrapingStatus(false);
    sendStatsUpdate();
    return { status: state.scraping ? 'stopped' : 'completed' };
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'start') {
      if (!window.thriveJobScraperState.scraping) {
        startScraping().then(sendResponse);
        return true;
      }
      sendResponse({ status: 'already_running' });
    } else if (request.action === 'stop') {
      window.thriveJobScraperState.scraping = false;
      updateScrapingStatus(false);
      sendStatsUpdate();
      sendResponse({ status: 'stopped' });
    } else if (request.action === 'scrapeCurrentPage') {
      sendResponse({
        jobs: isJobviteListingPage() ? scrapeJobsFromDoc(document) : [],
        totalJobs: isJobviteListingPage() ? getTotalResultsCount() : 0,
        hasNext: isJobviteListingPage() && hasNextPage(),
        rangeStart: isJobviteListingPage() ? getCurrentRangeStart() : 0,
        footerText: isJobviteListingPage() ? getFooterText() : '',
        pageSignature: isJobviteListingPage() ? getPageSignature() : ''
      });
    } else if (request.action === 'clickNextPage') {
      sendResponse(isJobviteListingPage() ? clickNextPage() : { clicked: false, error: 'Not on Jobvite listing page.' });
    } else if (request.action === 'getPageState') {
      sendResponse({
        validPage: isJobviteListingPage(),
        hasNext: isJobviteListingPage() && hasNextPage(),
        rangeStart: isJobviteListingPage() ? getCurrentRangeStart() : 0,
        footerText: isJobviteListingPage() ? getFooterText() : '',
        pageSignature: isJobviteListingPage() ? getPageSignature() : ''
      });
    } else if (request.action === 'getInitialStats') {
      const state = window.thriveJobScraperState;
      sendResponse({
        totalJobsOnPage: isJobviteListingPage() ? (state.totalJobsOnPage || getTotalResultsCount()) : 0,
        scrapedRecords: state.allJobs.length,
        currentPage: state.currentPage,
        totalPages: state.totalPages,
        validPage: isJobviteListingPage(),
        hasNext: hasNextPage()
      });
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sendStatsUpdate);
  } else {
    sendStatsUpdate();
  }
} else {
  console.log('Thrive Jobvite content script already initialized.');
}
