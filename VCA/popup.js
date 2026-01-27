// VCA Job Scraper - Popup Script

document.addEventListener('DOMContentLoaded', () => {
  const scrapeBtn = document.getElementById('scrape-btn');
  const stopBtn = document.getElementById('stop-btn');
  const viewBtn = document.getElementById('view-btn');
  const clearBtn = document.getElementById('clear-btn');

  const jobsCount = document.getElementById('jobs-count');
  const currentPage = document.getElementById('current-page');
  const totalPages = document.getElementById('total-pages');
  const totalJobs = document.getElementById('total-jobs');

  const statusSection = document.getElementById('status-section');
  const progressSection = document.getElementById('progress-section');
  const errorSection = document.getElementById('error-section');
  const resultsSummary = document.getElementById('results-summary');

  const progressLabel = document.getElementById('progress-label');
  const progressDetail = document.getElementById('progress-detail');
  const progressFill = document.getElementById('progress-fill');
  const errorMessage = document.getElementById('error-message');
  const summaryText = document.getElementById('summary-text');

  let isScraping = false;
  let stopRequested = false;
  let scrapedJobs = [];
  let currentTabId = null;

  // Initialize
  init();

  async function init() {
    // Load any previously scraped jobs
    const stored = await chrome.storage.local.get('vcaJobs');
    if (stored.vcaJobs) {
      scrapedJobs = stored.vcaJobs;
      showSummary(scrapedJobs.length);
    }

    // Get current page stats
    getStats();
  }

  async function getStats() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab || !tab.url || !tab.url.includes('vcacareers.com')) {
        showError('Please navigate to vcacareers.com to use this extension.');
        scrapeBtn.disabled = true;
        return;
      }

      currentTabId = tab.id;

      const response = await chrome.tabs.sendMessage(tab.id, { action: 'getStats' });

      if (response) {
        jobsCount.textContent = response.jobsOnPage || 0;
        currentPage.textContent = response.currentPage || 1;
        totalPages.textContent = response.totalPages || 1;
        totalJobs.textContent = response.totalJobs || 'Unknown';
        scrapeBtn.disabled = false;
      }
    } catch (error) {
      console.error('Error getting stats:', error);
      showError('Unable to connect to page. Please refresh and try again.');
      scrapeBtn.disabled = true;
    }
  }

  // Scrape button click - scrape all pages
  scrapeBtn.addEventListener('click', async () => {
    if (isScraping) return;

    isScraping = true;
    stopRequested = false;
    scrapedJobs = [];
    scrapeBtn.classList.add('hidden');
    stopBtn.classList.remove('hidden');
    errorSection.classList.add('hidden');
    resultsSummary.classList.add('hidden');
    progressSection.classList.remove('hidden');

    updateProgress('Starting...', '', 0);

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      currentTabId = tab.id;

      // Get total pages info
      const statsResponse = await chrome.tabs.sendMessage(tab.id, { action: 'getStats' });
      const totalPagesCount = statsResponse.totalPages || 1;

      let pageNum = 1;
      let consecutiveEmptyPages = 0;

      while (pageNum <= totalPagesCount && !stopRequested) {
        updateProgress('Scraping...', `Page ${pageNum}/${totalPagesCount} (${scrapedJobs.length} jobs)`, Math.round((pageNum / totalPagesCount) * 100));

        // Wait for page to be ready
        await waitForContentScript(tab.id);

        // Scrape current page
        try {
          const response = await chrome.tabs.sendMessage(tab.id, { action: 'scrapeCurrentPage' });

          if (response && response.jobs && response.jobs.length > 0) {
            scrapedJobs.push(...response.jobs);
            consecutiveEmptyPages = 0;
            console.log(`Page ${pageNum}: Found ${response.jobs.length} jobs. Total: ${scrapedJobs.length}`);
          } else {
            consecutiveEmptyPages++;
            console.log(`Page ${pageNum}: No jobs found`);
            if (consecutiveEmptyPages >= 2) {
              console.log('Multiple empty pages, stopping');
              break;
            }
          }
        } catch (e) {
          console.error(`Error scraping page ${pageNum}:`, e);
        }

        // Check if there are more pages
        const hasMoreResponse = await chrome.tabs.sendMessage(tab.id, { action: 'hasMorePages' });

        if (hasMoreResponse && hasMoreResponse.hasMore && pageNum < totalPagesCount && !stopRequested) {
          // Get next page URL
          const nextUrlResponse = await chrome.tabs.sendMessage(tab.id, { action: 'getNextPageUrl' });

          if (nextUrlResponse && nextUrlResponse.url) {
            // Navigate to next page
            await chrome.tabs.update(tab.id, { url: nextUrlResponse.url });

            // Wait for page to load
            await waitForPageLoad(tab.id);
            pageNum++;
          } else {
            break;
          }
        } else {
          break;
        }
      }

      // Save scraped jobs
      await chrome.storage.local.set({ vcaJobs: scrapedJobs });
      showSummary(scrapedJobs.length);

    } catch (error) {
      console.error('Scraping error:', error);
      showError('Error during scraping: ' + error.message);
    }

    isScraping = false;
    scrapeBtn.classList.remove('hidden');
    stopBtn.classList.add('hidden');
    progressSection.classList.add('hidden');
  });

  // Wait for content script to be ready
  async function waitForContentScript(tabId, maxAttempts = 20) {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await chrome.tabs.sendMessage(tabId, { action: 'getStats' });
        if (response) return true;
      } catch (e) {
        // Content script not ready yet
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    return false;
  }

  // Wait for page to finish loading
  async function waitForPageLoad(tabId) {
    return new Promise((resolve) => {
      const checkTab = async () => {
        try {
          const tab = await chrome.tabs.get(tabId);
          if (tab.status === 'complete') {
            // Extra delay for dynamic content
            await new Promise(r => setTimeout(r, 2000));
            resolve();
          } else {
            setTimeout(checkTab, 300);
          }
        } catch (e) {
          resolve();
        }
      };

      setTimeout(checkTab, 500);
    });
  }

  // Stop button click
  stopBtn.addEventListener('click', async () => {
    stopRequested = true;
    isScraping = false;

    // Save whatever we have so far
    if (scrapedJobs.length > 0) {
      await chrome.storage.local.set({ vcaJobs: scrapedJobs });
      showSummary(scrapedJobs.length);
    }

    scrapeBtn.classList.remove('hidden');
    stopBtn.classList.add('hidden');
    progressSection.classList.add('hidden');
  });

  // View button click
  viewBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('results.html') });
  });

  // Clear button click
  clearBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to clear all scraped data?')) {
      await chrome.storage.local.remove('vcaJobs');
      scrapedJobs = [];
      resultsSummary.classList.add('hidden');
    }
  });

  function updateProgress(label, detail, percent) {
    progressLabel.textContent = label;
    progressDetail.textContent = detail;
    progressFill.style.width = `${percent}%`;
  }

  function showError(message) {
    errorMessage.textContent = message;
    errorSection.classList.remove('hidden');
  }

  function showSummary(count) {
    summaryText.textContent = `${count} jobs scraped`;
    resultsSummary.classList.remove('hidden');
  }
});
