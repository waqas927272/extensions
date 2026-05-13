// Encore Vet Job Scraper - Popup Script

document.addEventListener('DOMContentLoaded', () => {
  const scrapeBtn = document.getElementById('scrape-btn');
  const stopBtn = document.getElementById('stop-btn');
  const viewBtn = document.getElementById('view-btn');
  const clearBtn = document.getElementById('clear-btn');

  const jobsCount = document.getElementById('jobs-count');
  const currentPage = document.getElementById('current-page');
  const totalPages = document.getElementById('total-pages');

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

  // Initialize
  init();

  async function init() {
    // Load any previously scraped jobs
    const stored = await chrome.storage.local.get('encoreJobs');
    if (stored.encoreJobs) {
      scrapedJobs = stored.encoreJobs;
      showSummary(scrapedJobs.length);
    }

    // Get current page stats
    getStats();
  }

  async function getStats() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab || !tab.url || !tab.url.includes('careers.encorevet.com')) {
        showError('Please navigate to careers.encorevet.com to use this extension.');
        scrapeBtn.disabled = true;
        return;
      }

      const response = await chrome.tabs.sendMessage(tab.id, { action: 'getStats' });

      if (response) {
        jobsCount.textContent = response.jobsOnPage || 0;
        currentPage.textContent = response.currentPage || 1;
        totalPages.textContent = response.totalPages || 1;
        scrapeBtn.disabled = false;
      }
    } catch (error) {
      console.error('Error getting stats:', error);
      showError('Unable to connect to page. Please refresh and try again.');
      scrapeBtn.disabled = true;
    }
  }

  // Scrape button click
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

      updateProgress('Applying filters...', 'Selecting Medical Directors and Veterinarian', 5);
      await waitForContentScript(tab.id);

      const filterResponse = await chrome.tabs.sendMessage(tab.id, { action: 'applyCategoryFilters' });
      if (!filterResponse?.success) {
        throw new Error(filterResponse?.error || 'Unable to apply category filters.');
      }

      await waitWithProgress(5000, (remaining, percent) => {
        updateProgress('Applying filters...', `Waiting ${remaining}s for filtered listings`, percent);
      });

      // Get total pages info
      const statsResponse = await chrome.tabs.sendMessage(tab.id, { action: 'getStats' });
      const totalPagesCount = statsResponse.totalPages || 1;

      let pageNum = 1;

      while (pageNum <= totalPagesCount && !stopRequested) {
        updateProgress('Scraping...', `Page ${pageNum}/${totalPagesCount} (${scrapedJobs.length} jobs)`, Math.round((pageNum / totalPagesCount) * 100));

        // Wait for content script to be ready
        await waitForContentScript(tab.id);

        // Scrape current page
        try {
          const response = await chrome.tabs.sendMessage(tab.id, { action: 'scrapeCurrentPage' });

          if (response && response.jobs && response.jobs.length > 0) {
            scrapedJobs.push(...response.jobs);
            console.log(`Page ${pageNum}: Found ${response.jobs.length} jobs. Total: ${scrapedJobs.length}`);
            if (response.debug) {
              console.log(`Page ${pageNum}: Cards found ${response.debug.cardsFound}, jobs scraped ${response.debug.jobsScraped}`);
            }
          } else {
            const cardsFound = response?.debug?.cardsFound ?? 0;
            console.log(`Page ${pageNum}: No jobs found. Cards found: ${cardsFound}`);
            updateProgress('Scraping...', `Page ${pageNum}: 0 jobs from ${cardsFound} cards`, Math.round((pageNum / totalPagesCount) * 100));
          }
        } catch (e) {
          console.error(`Error scraping page ${pageNum}:`, e);
        }

        // Check if there are more pages
        const hasMoreResponse = await chrome.tabs.sendMessage(tab.id, { action: 'hasMorePages' });

        if (hasMoreResponse && hasMoreResponse.hasMore && pageNum < totalPagesCount && !stopRequested) {
          // Click next page button via content script
          const nextResponse = await chrome.tabs.sendMessage(tab.id, { action: 'goToNextPage' });

          if (nextResponse && nextResponse.success) {
            pageNum++;
            // Wait for Angular to update
            await new Promise(resolve => setTimeout(resolve, 2000));
          } else {
            console.log('Could not navigate to next page');
            break;
          }
        } else {
          break;
        }
      }

      // Save scraped jobs
      await chrome.storage.local.set({ encoreJobs: scrapedJobs });
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
  async function waitForContentScript(tabId, maxAttempts = 10) {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await chrome.tabs.sendMessage(tabId, { action: 'getStats' });
        if (response && response.jobsOnPage > 0) return true;
      } catch (e) {
        // Content script not ready yet
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    return false;
  }

  async function waitWithProgress(durationMs, onTick) {
    const start = Date.now();
    const tickMs = 250;

    while (Date.now() - start < durationMs && !stopRequested) {
      const elapsed = Date.now() - start;
      const remaining = Math.ceil((durationMs - elapsed) / 1000);
      const percent = Math.min(95, 10 + Math.round((elapsed / durationMs) * 80));
      onTick(remaining, percent);
      await new Promise(resolve => setTimeout(resolve, tickMs));
    }

    if (!stopRequested) onTick(0, 95);
  }

  // Stop button click
  stopBtn.addEventListener('click', async () => {
    stopRequested = true;
    isScraping = false;

    // Save whatever we have so far
    if (scrapedJobs.length > 0) {
      await chrome.storage.local.set({ encoreJobs: scrapedJobs });
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
      await chrome.storage.local.remove('encoreJobs');
      scrapedJobs = [];
      resultsSummary.classList.add('hidden');
    }
  });

  // Listen for progress updates
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'scrapeProgress') {
      const percent = Math.round((request.currentPage / request.totalPages) * 100);
      updateProgress(
        'Scraping...',
        `Page ${request.currentPage}/${request.totalPages} (${request.jobsScraped} jobs)`,
        percent
      );
    }

    if (request.action === 'descriptionProgress') {
      const percent = Math.round((request.current / request.total) * 100);
      updateProgress(
        'Getting descriptions...',
        `${request.current}/${request.total}`,
        percent
      );
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
