let isScrapingActive = false;
let filtersApplied = false;
let currentPage = 1;
let scrapingState = null;
let totalPagesToScrape = 3;
let floatingBox = null;
const SKIP_KEYWORDS = ['Relief', 'Intern', 'Locum'];
let skippedJobsStats = {
  total: 0,
  byKeyword: {
    Relief: 0,
    Intern: 0,
    Locum: 0
  }
};

// Auto-apply filters when page loads
window.addEventListener('load', function() {
  setTimeout(() => {
    // Reset jobs count when going to main page
    if (window.location.href === 'https://www.vcacareers.com/global/en/c/veterinarian-jobs') {
      resetJobsCount();
    }
    autoApplyFilters();
    createFloatingBox();
  }, 2000);
});

// Also try when DOM is ready in case load event already fired
if (document.readyState === 'complete') {
  setTimeout(() => {
    // Reset jobs count when going to main page
    if (window.location.href === 'https://www.vcacareers.com/global/en/c/veterinarian-jobs') {
      resetJobsCount();
    }
    autoApplyFilters();
    createFloatingBox();
  }, 1000);
} else {
  document.addEventListener('DOMContentLoaded', function() {
    setTimeout(() => {
      // Reset jobs count when going to main page
      if (window.location.href === 'https://www.vcacareers.com/global/en/c/veterinarian-jobs') {
        resetJobsCount();
      }
      autoApplyFilters();
      createFloatingBox();
    }, 2000);
  });
}

async function resetJobsCount() {
  // Only reset if we're on the base URL without pagination parameters
  const url = new URL(window.location.href);
  if (!url.searchParams.has('from')) {
    const jobCount = document.getElementById('vca-jobCount');
    if (jobCount) {
      jobCount.textContent = '0';
    }
    
    // Clear stored jobs
    await chrome.storage.local.remove(['jobs']);
    
    // Reset scraping state
    await chrome.storage.local.remove(['scrapingState']);
    
    // Reset UI
    updateFloatingBoxUI('Ready', false);
    
    // Reset progress
    const progressFill = document.getElementById('vca-progressFill');
    const progressText = document.getElementById('vca-progressText');
    const currentPageSpan = document.getElementById('vca-currentPage');
    
    if (progressFill) progressFill.style.width = '0%';
    if (progressText) progressText.textContent = '0%';
    if (currentPageSpan) currentPageSpan.textContent = '-';
  }
}

// Check if we're continuing scraping after page navigation
window.addEventListener('load', function() {
  setTimeout(checkScrapingState, 1000);
});


async function fetchJobDescription(url) {
  return new Promise((resolve) => {
    // Create a new tab to fetch the description
    const tab = window.open(url, '_blank');
    
    // Set up a message listener for the description
    const messageListener = (event) => {
      if (event.origin !== window.location.origin) return;
      
      if (event.data.type === 'JOB_DESCRIPTION_FETCHED') {
        window.removeEventListener('message', messageListener);
        resolve(event.data.description);
      }
    };
    
    window.addEventListener('message', messageListener);
    
    // Inject script into the new tab to extract description
    setTimeout(() => {
      try {
        tab.postMessage({ type: 'EXTRACT_DESCRIPTION' }, '*');
      } catch (error) {
        console.error('Error posting message to tab:', error);
        resolve('Error fetching description');
      }
    }, 3000);
    
    // Timeout after 10 seconds
    setTimeout(() => {
      window.removeEventListener('message', messageListener);
      tab.close();
      resolve('Timeout fetching description');
    }, 10000);
  });
}

// Add message listener for description extraction
window.addEventListener('message', function(event) {
  if (event.data.type === 'EXTRACT_DESCRIPTION') {
    const descriptionElement = document.querySelector('.jd-info[data-ph-at-id="jobdescription-text"]');
    const description = descriptionElement ? descriptionElement.innerText.trim() : 'Description not found';
    
    window.opener.postMessage({
      type: 'JOB_DESCRIPTION_FETCHED',
      description: description
    }, '*');
    
    window.close();
  }
});


function createFloatingBox() {
  if (floatingBox) return;
  
  floatingBox = document.createElement('div');
  floatingBox.id = 'vca-scraper-box';
  floatingBox.innerHTML = `
    <div class="vca-scraper-header">
      <h3>VCA Jobs Scraper</h3>
      <button id="vca-toggle-btn" class="vca-toggle-btn">−</button>
    </div>
    <div class="vca-scraper-content">
      <div class="vca-status-section">
        <div class="vca-status-item">
          <span class="vca-label">Status:</span>
          <span id="vca-status" class="vca-status">Ready</span>
        </div>
        <div class="vca-status-item">
          <span class="vca-label">Jobs Extracted:</span>
          <span id="vca-jobCount" class="vca-count">0</span>
        </div>
        <div class="vca-status-item">
          <span class="vca-label">Current Page:</span>
          <span id="vca-currentPage" class="vca-count">-</span>
        </div>
      </div>
      
      <div class="vca-controls">
        <div class="vca-page-selector">
          <label for="vca-pageSelect">Pages to scrape:</label>
          <select id="vca-pageSelect" class="vca-select">
            <option value="1">First page only</option>
            <option value="3">First 3 pages</option>
            <option value="5">First 5 pages</option>
            <option value="10">First 10 pages</option>
            <option value="all">All pages</option>
          </select>
        </div>
        
        <div class="vca-buttons">
          <button id="vca-startBtn" class="vca-btn vca-btn-primary">Start Scraping</button>
          <button id="vca-stopBtn" class="vca-btn vca-btn-secondary" style="display: none;">Stop</button>
        </div>
      </div>

      <div class="vca-progress-section">
        <div class="vca-progress-bar">
          <div id="vca-progressFill" class="vca-progress-fill"></div>
        </div>
        <span id="vca-progressText" class="vca-progress-text">0%</span>
      </div>
    </div>
  `;
  
  // Add CSS
  const style = document.createElement('style');
  style.textContent = `
    #vca-scraper-box {
      position: fixed;
      top: 20px;
      right: 20px;
      width: 320px;
      background: white;
      border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.3);
      z-index: 10000;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      border: 2px solid #2E86AB;
    }
    
    .vca-scraper-header {
      background: linear-gradient(135deg, #2E86AB 0%, #1f5f83 100%);
      color: white;
      padding: 12px 16px;
      border-radius: 10px 10px 0 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: move;
    }
    
    .vca-scraper-header h3 {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
    }
    
    .vca-toggle-btn {
      background: none;
      border: none;
      color: white;
      font-size: 18px;
      cursor: pointer;
      padding: 0;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .vca-scraper-content {
      padding: 16px;
    }
    
    .vca-scraper-content.collapsed {
      display: none;
    }
    
    .vca-status-section {
      background: #f8f9fa;
      padding: 12px;
      border-radius: 8px;
      margin-bottom: 16px;
      border-left: 4px solid #28a745;
    }
    
    .vca-status-item {
      display: flex;
      justify-content: space-between;
      margin-bottom: 6px;
      font-size: 12px;
    }
    
    .vca-status-item:last-child {
      margin-bottom: 0;
    }
    
    .vca-label {
      font-weight: 500;
      color: #495057;
    }
    
    .vca-status {
      color: #28a745;
      font-weight: 600;
    }
    
    .vca-count {
      color: #2E86AB;
      font-weight: 600;
    }
    
    .vca-page-selector {
      margin-bottom: 12px;
    }
    
    .vca-page-selector label {
      display: block;
      font-size: 12px;
      font-weight: 500;
      color: #495057;
      margin-bottom: 4px;
    }
    
    .vca-select {
      width: 100%;
      padding: 8px;
      border: 1px solid #e9ecef;
      border-radius: 6px;
      font-size: 12px;
      background: white;
    }
    
    .vca-buttons {
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
    }
    
    .vca-btn {
      flex: 1;
      padding: 8px 12px;
      border: none;
      border-radius: 6px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;
      font-size: 12px;
    }
    
    .vca-btn-primary {
      background: #2E86AB;
      color: white;
    }
    
    .vca-btn-primary:hover:not(:disabled) {
      background: #1f5f83;
    }
    
    .vca-btn-secondary {
      background: #dc3545;
      color: white;
    }
    
    .vca-btn-secondary:hover:not(:disabled) {
      background: #c82333;
    }
    
    .vca-btn-outline {
      background: white;
      color: #2E86AB;
      border: 1px solid #2E86AB;
      width: 100%;
    }
    
    .vca-btn-outline:hover {
      background: #2E86AB;
      color: white;
    }
    
    .vca-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    
    .vca-progress-section {
      margin-bottom: 16px;
    }
    
    .vca-progress-bar {
      width: 100%;
      height: 6px;
      background: #e9ecef;
      border-radius: 3px;
      overflow: hidden;
      margin-bottom: 6px;
    }
    
    .vca-progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #28a745, #20c997);
      width: 0%;
      transition: width 0.3s ease;
    }
    
    .vca-progress-text {
      font-size: 11px;
      color: #6c757d;
      text-align: center;
      display: block;
    }
  `;
  
  document.head.appendChild(style);
  document.body.appendChild(floatingBox);
  
  // Add event listeners
  setupFloatingBoxEvents();
  
  // Make draggable
  makeDraggable();
  
  // Load initial data
  loadStoredDataToBox();
}

function setupFloatingBoxEvents() {
  const toggleBtn = document.getElementById('vca-toggle-btn');
  const content = document.querySelector('.vca-scraper-content');
  const startBtn = document.getElementById('vca-startBtn');
  const stopBtn = document.getElementById('vca-stopBtn');
  const pageSelect = document.getElementById('vca-pageSelect');
  
  toggleBtn.addEventListener('click', () => {
    content.classList.toggle('collapsed');
    toggleBtn.textContent = content.classList.contains('collapsed') ? '+' : '−';
  });
  
  startBtn.addEventListener('click', () => {
    const selectedValue = pageSelect.value;
    if (selectedValue === 'all') {
      totalPagesToScrape = 'all';
    } else {
      totalPagesToScrape = parseInt(selectedValue);
    }
    startScrapingFromBox();
  });
  
  stopBtn.addEventListener('click', stopScraping);
}

function makeDraggable() {
  const header = document.querySelector('.vca-scraper-header');
  let isDragging = false;
  let currentX;
  let currentY;
  let initialX;
  let initialY;
  let xOffset = 0;
  let yOffset = 0;

  header.addEventListener('mousedown', dragStart);
  document.addEventListener('mousemove', drag);
  document.addEventListener('mouseup', dragEnd);

  function dragStart(e) {
    initialX = e.clientX - xOffset;
    initialY = e.clientY - yOffset;

    if (e.target === header || header.contains(e.target)) {
      isDragging = true;
    }
  }

  function drag(e) {
    if (isDragging) {
      e.preventDefault();
      currentX = e.clientX - initialX;
      currentY = e.clientY - initialY;

      xOffset = currentX;
      yOffset = currentY;

      floatingBox.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;
    }
  }

  function dragEnd() {
    initialX = currentX;
    initialY = currentY;
    isDragging = false;
  }
}

function updateFloatingBoxUI(statusText, isActive) {
  const status = document.getElementById('vca-status');
  const startBtn = document.getElementById('vca-startBtn');
  const stopBtn = document.getElementById('vca-stopBtn');
  
  if (status) {
    status.textContent = statusText;
    status.style.color = isActive ? '#fd7e14' : (statusText === 'Completed' ? '#28a745' : '#6c757d');
  }
  
  if (startBtn && stopBtn) {
    if (isActive) {
      startBtn.style.display = 'none';
      stopBtn.style.display = 'block';
      stopBtn.disabled = false;
    } else {
      startBtn.style.display = 'block';
      stopBtn.style.display = 'none';
      startBtn.disabled = false;
    }
  }
}

function loadStoredDataToBox() {
  chrome.storage.local.get(['jobs'], function(result) {
    const jobs = result.jobs || [];
    const jobCount = document.getElementById('vca-jobCount');
    if (jobCount) jobCount.textContent = jobs.length;
  });
}

// Workaround: keep scraping running even if tab is not active
// Use setInterval to periodically check and resume scraping
let scrapingInterval = null;
function startScrapingFromBox() {
  isScrapingActive = true;
  currentPage = 1;
  skippedJobsStats = { total: 0, byKeyword: { Relief: 0, Intern: 0, Locum: 0 } };
  chrome.storage.local.set({ skippedJobsStats });
  // Initialize scraping state
  scrapingState = {
    active: true,
    currentPage: 1,
    totalPages: totalPagesToScrape,
    startTime: Date.now()
  };
  chrome.storage.local.set({ scrapingState });
  updateFloatingBoxUI('Starting...', true);
  // Use setInterval to keep scraping even if tab is not active
  if (scrapingInterval) clearInterval(scrapingInterval);
  scrapingInterval = setInterval(() => {
    if (isScrapingActive) {
      continueScraping();
    } else {
      clearInterval(scrapingInterval);
    }
  }, 2000);
  // Try to request wake lock if available
  if ('wakeLock' in navigator) {
    navigator.wakeLock.request('screen').catch(() => {});
  }
}

async function checkScrapingState() {
  const result = await chrome.storage.local.get(['scrapingState', 'skippedJobsStats']);
  if (result.scrapingState && result.scrapingState.active) {
    scrapingState = result.scrapingState;
    isScrapingActive = true;
    filtersApplied = true;
    currentPage = scrapingState.currentPage;
    totalPagesToScrape = scrapingState.totalPages;
    // Load skipped stats if present
    if (result.skippedJobsStats) {
      skippedJobsStats = result.skippedJobsStats;
    }
    updateFloatingBoxUI(`Scraping page ${currentPage}...`, true);
    setTimeout(continueScraping, 1000);
  }
}

async function autoApplyFilters() {
  if (filtersApplied) return;
  
  try {
    await setFilters();
    filtersApplied = true;
  } catch (error) {
    console.log('Auto-apply filters failed:', error);
  }
}

// Add message listener for description fetching
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === 'startScraping') {
    startScraping();
  } else if (request.action === 'stopScraping') {
    stopScraping();
  } else if (request.action === 'fetchDescription') {
    const descriptionElement = document.querySelector('.jd-info[data-ph-at-id="jobdescription-text"]');
    const description = descriptionElement ? descriptionElement.innerText.trim() : 'Description not found';
    sendResponse({ description: description });
    return true;
  } else if (request.action === 'fetchDetails') {
    const details = extractJobDetails();
    sendResponse({ details: details });
    return true;
  }
});

async function stopScraping() {
  isScrapingActive = false;
  scrapingState = null;
  await chrome.storage.local.remove(['scrapingState']);
  
  updateFloatingBoxUI('Stopped', false);
  chrome.runtime.sendMessage({
    action: 'updateStatus',
    status: 'Stopped'
  });
}

async function startScraping() {
  isScrapingActive = true;
  currentPage = 1;
  skippedJobsStats = { total: 0, byKeyword: { Relief: 0, Intern: 0, Locum: 0 } };
  await chrome.storage.local.set({ skippedJobsStats });
  
  // Initialize scraping state
  scrapingState = {
    active: true,
    currentPage: 1,
    totalPages: totalPagesToScrape,
    startTime: Date.now()
  };
  
  await chrome.storage.local.set({ scrapingState });
  
  try {
    // Ensure filters are applied if not already
    if (!filtersApplied) {
      updateFloatingBoxUI('Applying filters...', true);
      chrome.runtime.sendMessage({
        action: 'updateStatus',
        status: 'Applying filters...'
      });
      
      await setFilters();
      filtersApplied = true;
      
      updateFloatingBoxUI('Filters applied. Starting scraping...', true);
      chrome.runtime.sendMessage({
        action: 'updateStatus',
        status: 'Filters applied. Starting scraping...'
      });
      
      await new Promise(resolve => setTimeout(resolve, 2000));
    } else {
      updateFloatingBoxUI('Starting scraping...', true);
      chrome.runtime.sendMessage({
        action: 'updateStatus',
        status: 'Starting scraping...'
      });
    }
    
    await continueScraping();
    
  } catch (error) {
    await stopScraping();
    updateFloatingBoxUI('Error', false);
    chrome.runtime.sendMessage({
      action: 'scrapingError',
      message: error.message
    });
  }
}

async function continueScraping() {
  try {
    // Load existing jobs from storage
    const result = await chrome.storage.local.get(['jobs']);
    const existingJobs = result.jobs || [];
    const existingIds = new Set(existingJobs.map(job => job.departmentId));
    
    // Scrape current page
    updateFloatingBoxUI(`Scraping page ${currentPage}...`, true);
    chrome.runtime.sendMessage({
      action: 'updateStatus',
      status: `Scraping page ${currentPage}${totalPagesToScrape === 'all' ? '' : `/${totalPagesToScrape}`}...`
    });
    
    const pageJobs = await scrapePage(currentPage, existingIds);
    
    // Check for duplicates before adding
    const newJobs = pageJobs.filter(job => !existingIds.has(job.departmentId));
    
    // Update existing IDs to prevent duplicates
    newJobs.forEach(job => existingIds.add(job.departmentId));
    
    // Save new jobs immediately
    const updatedJobs = [...existingJobs, ...newJobs];
    await chrome.storage.local.set({ jobs: updatedJobs });
    
    // Update floating box
    const jobCount = document.getElementById('vca-jobCount');
    const currentPageSpan = document.getElementById('vca-currentPage');
    const progressFill = document.getElementById('vca-progressFill');
    const progressText = document.getElementById('vca-progressText');
    
    if (jobCount) jobCount.textContent = updatedJobs.length;
    if (currentPageSpan) currentPageSpan.textContent = currentPage;
    
    // Update progress
    let percentage = 0;
    if (totalPagesToScrape !== 'all') {
      percentage = Math.round((currentPage / totalPagesToScrape) * 100);
      if (progressFill) progressFill.style.width = percentage + '%';
      if (progressText) progressText.textContent = `Page ${currentPage}/${totalPagesToScrape} (${percentage}%)`;
    } else {
      if (progressText) progressText.textContent = `Page ${currentPage} (All pages mode)`;
    }
    
    // Update popup progress
    chrome.runtime.sendMessage({
      action: 'updateProgress',
      data: {
        current: currentPage,
        total: totalPagesToScrape === 'all' ? 'all' : totalPagesToScrape,
        jobs: updatedJobs
      }
    });
    
    // Check if we should continue to next page
    const shouldContinue = totalPagesToScrape === 'all' || currentPage < totalPagesToScrape;
    if (shouldContinue && isScrapingActive) {
      // Check if next page exists
      const nextButton = document.querySelector('a[data-ph-at-id="pagination-next-link"]');
      const hasNextPage = nextButton && !nextButton.classList.contains('disabled') && !nextButton.getAttribute('aria-disabled');
      if (hasNextPage) {
        currentPage++;
        scrapingState.currentPage = currentPage;
        await chrome.storage.local.set({ scrapingState });
        updateFloatingBoxUI(`Moving to page ${currentPage}...`, true);
        chrome.runtime.sendMessage({
          action: 'updateStatus',
          status: `Moving to page ${currentPage}...`
        });
        // Navigate to next page
        await navigateToNextPage();
      } else {
        // No more pages available
        await stopScraping();
        updateFloatingBoxUI('All jobs are scrapped', false);
        chrome.runtime.sendMessage({
          action: 'scrapingComplete',
          data: { totalScraped: newJobs.length }
        });
      }
    } else {
      // Scraping complete
      await stopScraping();
      updateFloatingBoxUI('All jobs are scrapped', false);
      chrome.runtime.sendMessage({
        action: 'scrapingComplete',
        data: { totalScraped: newJobs.length }
      });
    }
    
    // Persist skipped stats after each page
    await chrome.storage.local.set({ skippedJobsStats });
    chrome.runtime.sendMessage({
      action: 'skippedStatsUpdate',
      data: skippedJobsStats
    });
    
  } catch (error) {
    await stopScraping();
    updateFloatingBoxUI('Error', false);
    chrome.runtime.sendMessage({
      action: 'scrapingError',
      message: error.message
    });
  }
}

async function setFilters() {
  // Wait for page to be fully loaded
  await waitForElement('input[data-ph-at-text="United States of America"]', 15000);
  
  // Check United States of America filter
  const usaCheckbox = document.querySelector('input[data-ph-at-text="United States of America"]');
  if (usaCheckbox && !usaCheckbox.checked) {
    usaCheckbox.click();
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Wait for filter to be applied
    await waitForPageUpdate();
  }
  
  // Check Veterinary Specialist filter
  await waitForElement('input[data-ph-at-text="Veterinary Specialist"]', 10000);
  const vetSpecialistCheckbox = document.querySelector('input[data-ph-at-text="Veterinary Specialist"]');
  if (vetSpecialistCheckbox && !vetSpecialistCheckbox.checked) {
    vetSpecialistCheckbox.click();
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Wait for filter to be applied
    await waitForPageUpdate();
  }
}

async function waitForPageUpdate() {
  // Wait for the page to update after filter application
  let attempts = 0;
  const maxAttempts = 15;
  
  while (attempts < maxAttempts) {
    const jobsList = document.querySelector('.jobs-list-item');
    if (jobsList) {
      // Additional wait to ensure all content is loaded
      await new Promise(resolve => setTimeout(resolve, 1000));
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
    attempts++;
  }
}

async function scrapePage(pageNumber, existingIds) {
  await waitForJobsToLoad();
  
  const jobItems = document.querySelectorAll('.jobs-list-item');
  let pageJobs = [];
  
  for (let i = 0; i < jobItems.length && isScrapingActive; i++) {
    const jobItem = jobItems[i];
    const jobData = extractJobData(jobItem);
    
    if (jobData && !existingIds.has(jobData.departmentId)) {
      // Check for skip keywords (exact word, case-insensitive)
      let skipped = false;
      for (const keyword of SKIP_KEYWORDS) {
        const regex = new RegExp(`\\b${keyword}\\b`, 'i');
        if (regex.test(jobData.title)) {
          skippedJobsStats.total++;
          skippedJobsStats.byKeyword[keyword]++;
          skipped = true;
          break;
        }
      }
      if (!skipped) {
        pageJobs.push(jobData);
      }
    }
    
    // Reduced delay for faster processing
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  
  // Persist skipped stats after each page
  await chrome.storage.local.set({ skippedJobsStats });
  return pageJobs;
}

async function waitForJobsToLoad() {
  let attempts = 0;
  const maxAttempts = 30;
  
  while (attempts < maxAttempts) {
    const jobItems = document.querySelectorAll('.jobs-list-item');
    
    if (jobItems.length > 0) {
      // Additional check to ensure jobs are fully loaded
      const firstJob = jobItems[0];
      const titleElement = firstJob.querySelector('.job-title span');
      
      if (titleElement && titleElement.textContent.trim()) {
        console.log(`Found ${jobItems.length} jobs on page`);
        // Wait a bit more to ensure all content is rendered
        await new Promise(resolve => setTimeout(resolve, 1000));
        return true;
      }
    }
    
    await new Promise(resolve => setTimeout(resolve, 500));
    attempts++;
  }
  
  console.error('Jobs failed to load properly');
  throw new Error('Jobs failed to load on page');
}

async function navigateToNextPage() {
  try {
    const nextButton = document.querySelector('a[data-ph-at-id="pagination-next-link"]');
    
    if (!nextButton) {
      console.error('Next button not found');
      return false;
    }
    
    if (nextButton.classList.contains('disabled') || nextButton.getAttribute('aria-disabled') === 'true') {
      console.error('Next button is disabled');
      return false;
    }
    
    // Navigate using the href URL to ensure proper page load
    const nextUrl = nextButton.href;
    if (nextUrl) {
      window.location.href = nextUrl;
      return true;
    } else {
      nextButton.click();
      return true;
    }
    
  } catch (error) {
    console.error('Error navigating to next page:', error);
    return false;
  }
}

function extractJobDetails() {
  try {
    let areaOfPractice = '';
    let position = '';
    let salary = '';
    let hospitalName = '';
    let city = '';
    let state = '';

    // Try JSON-LD structured data first
    const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of ldScripts) {
      try {
        const data = JSON.parse(script.textContent);
        if (data['@type'] === 'JobPosting') {
          position = data.title || '';
          if (data.baseSalary) {
            const bs = data.baseSalary;
            if (bs.value) {
              const val = bs.value;
              if (val.minValue && val.maxValue) {
                salary = `${val.minValue} - ${val.maxValue} ${bs.currency || ''}`.trim();
              } else if (val.value) {
                salary = `${val.value} ${bs.currency || ''}`.trim();
              }
            }
          }
          if (data.hiringOrganization) {
            hospitalName = data.hiringOrganization.name || '';
          }
          if (data.jobLocation) {
            const loc = data.jobLocation.address || data.jobLocation;
            city = loc.addressLocality || '';
            state = loc.addressRegion || '';
          }
          if (data.occupationalCategory) {
            areaOfPractice = data.occupationalCategory;
          }
          break;
        }
      } catch (e) {}
    }

    // Extract from DOM elements (Phenom platform selectors)
    // Hospital name / location info
    if (!hospitalName) {
      const companyEl = document.querySelector('[data-ph-at-id="job-company-text"], .job-company, .jd-info .company-name');
      if (companyEl) hospitalName = companyEl.textContent.trim();
    }

    // Location parsing
    if (!city || !state) {
      const locationEl = document.querySelector('[data-ph-at-id="job-location"], .job-location, .jd-info .job-location');
      if (locationEl) {
        const locText = locationEl.textContent.replace('Location', '').trim();
        const parts = locText.split(',').map(s => s.trim());
        if (parts.length >= 2) {
          if (!city) city = parts[0];
          if (!state) state = parts[1].replace(/\d{5}.*/, '').trim();
        }
      }
    }

    // Area of Practice from category
    if (!areaOfPractice) {
      const categoryEl = document.querySelector('[data-ph-at-id="job-category"], .job-category, .jd-info .job-category');
      if (categoryEl) areaOfPractice = categoryEl.textContent.replace('Category', '').trim();
    }

    // Position from title
    if (!position) {
      const titleEl = document.querySelector('[data-ph-at-id="job-title"], .job-title h1, .jd-header .job-title');
      if (titleEl) position = titleEl.textContent.trim();
    }

    // Salary from detail fields
    if (!salary) {
      const salaryEl = document.querySelector('[data-ph-at-id="job-salary"], .job-salary, .salary-range, .compensation');
      if (salaryEl) salary = salaryEl.textContent.trim();
    }

    // Fallback: scan all info fields on the page
    const infoItems = document.querySelectorAll('.jd-info .au-target, .jd-info .info-item, .job-info .field, .job-details-info div');
    infoItems.forEach(item => {
      const text = item.textContent.trim();
      const labelEl = item.querySelector('label, .label, strong, dt');
      const valueEl = item.querySelector('span, .value, dd');
      if (labelEl && valueEl) {
        const label = labelEl.textContent.trim().toLowerCase();
        const value = valueEl.textContent.trim();
        if (label.includes('area of practice') || label.includes('specialty') || label.includes('practice area')) {
          if (!areaOfPractice) areaOfPractice = value;
        } else if (label.includes('salary') || label.includes('compensation') || label.includes('pay')) {
          if (!salary) salary = value;
        } else if (label.includes('hospital') || label.includes('facility') || label.includes('clinic')) {
          if (!hospitalName) hospitalName = value;
        } else if (label.includes('city')) {
          if (!city) city = value;
        } else if (label.includes('state')) {
          if (!state) state = value;
        } else if (label.includes('position') || label.includes('role')) {
          if (!position) position = value;
        }
      }
    });

    // Additional fallback: parse from description text for area of practice and salary
    const descEl = document.querySelector('.jd-info[data-ph-at-id="jobdescription-text"]');
    if (descEl) {
      const descText = descEl.innerText;

      if (!salary) {
        const salaryMatch = descText.match(/(?:salary|compensation|pay)[:\s]*\$?([\d,]+(?:\.\d{2})?(?:\s*[-–to]+\s*\$?[\d,]+(?:\.\d{2})?)?(?:\s*(?:per\s+)?(?:year|annually|hr|hour|month))?)/i);
        if (salaryMatch) salary = salaryMatch[0].trim();
      }

      if (!areaOfPractice) {
        const aopMatch = descText.match(/(?:area of practice|specialty|practice area)[:\s]*([^\n.]+)/i);
        if (aopMatch) areaOfPractice = aopMatch[1].trim();
      }

      // Try to extract hospital name from description if not found
      if (!hospitalName) {
        const hospMatch = descText.match(/(?:hospital|location|facility)[:\s]*([^\n.]+)/i);
        if (hospMatch) hospitalName = hospMatch[1].trim().substring(0, 100);
      }
    }

    return { areaOfPractice, position, salary, hospitalName, city, state };

  } catch (error) {
    console.error('Error extracting job details:', error);
    return { areaOfPractice: '', position: '', salary: '', hospitalName: '', city: '', state: '' };
  }
}

function extractJobData(jobItem) {
  try {
    // Extract Department ID
    const departmentId = jobItem.querySelector('[data-ph-at-job-id-text]')?.getAttribute('data-ph-at-job-id-text') || 
                        jobItem.querySelector('.jobId span:last-child')?.textContent?.trim() || '';
    
    // Extract Title
    const titleElement = jobItem.querySelector('.job-title span') || jobItem.querySelector('[data-ph-at-job-title-text]');
    const title = titleElement?.textContent?.trim() || titleElement?.getAttribute('data-ph-at-job-title-text') || '';
    
    // Extract Location
    const locationElement = jobItem.querySelector('.job-location') || jobItem.querySelector('[data-ph-at-job-location-text]');
    let location = '';
    if (locationElement) {
      location = locationElement.textContent?.replace('Location', '').trim() || 
                locationElement.getAttribute('data-ph-at-job-location-text') || '';
    }
    
    // Extract Category
    let category = '';
    const categoryElement = jobItem.querySelector('[data-ph-at-job-category-text]');
    if (categoryElement) {
      category = categoryElement.getAttribute('data-ph-at-job-category-text') || '';
    } else {
      // Try to extract from multi-category section
      const multiCategoryItems = jobItem.querySelectorAll('.job-multi-category .category');
      if (multiCategoryItems.length > 0) {
        category = Array.from(multiCategoryItems).map(item => item.textContent.trim()).join(', ');
      }
    }
    
    // Extract URL
    const linkElement = jobItem.querySelector('a[href*="/job/"]') || jobItem.querySelector('[data-ph-at-id="job-link"]');
    const url = linkElement?.href || '';
    
    // Extract Job Type (Part time / Full time)
    const jobTypeElement = jobItem.querySelector('.type span:last-child') || jobItem.querySelector('[data-ph-at-job-type-text]');
    const jobType = jobTypeElement?.textContent?.trim() || jobTypeElement?.getAttribute('data-ph-at-job-type-text') || '';
    
    // Validate required fields
    if (!departmentId || !title) {
      console.warn('Missing required fields for job item:', { departmentId, title });
      return null;
    }
    
    return {
      departmentId: departmentId,
      title: title,
      location: location,
      category: category,
      url: url,
      jobType: jobType,
      scrapedAt: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('Error extracting job data:', error);
    return null;
  }
}

function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const element = document.querySelector(selector);
    if (element) {
      resolve(element);
      return;
    }
    
    const observer = new MutationObserver((mutations) => {
      const element = document.querySelector(selector);
      if (element) {
        observer.disconnect();
        resolve(element);
      }
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    
    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Element ${selector} not found within ${timeout}ms`));
    }, timeout);
  });
}