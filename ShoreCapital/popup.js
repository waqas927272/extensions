// Shore Capital Job Scraper - Popup Script

let isScraping = false;

document.addEventListener('DOMContentLoaded', () => {
  loadStoredCount();
  setupEventListeners();

  // Listen for progress messages from the content script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'scrapeProgress') {
      document.getElementById('progress-text').textContent = request.message;
      if (request.count !== undefined) {
        document.getElementById('job-count').textContent = request.count;
      }
    }
    if (request.action === 'scrapeComplete') {
      onScrapeComplete(request);
    }
  });
});

async function loadStoredCount() {
  const stored = await chrome.storage.local.get('shoreCapitalJobs');
  const jobs = stored.shoreCapitalJobs || [];
  document.getElementById('job-count').textContent = jobs.length;
}

function setupEventListeners() {
  document.getElementById('scrape-btn').addEventListener('click', startScraping);
  document.getElementById('stop-btn').addEventListener('click', stopScraping);
  document.getElementById('view-btn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('results.html') });
  });
}

async function stopScraping() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, { action: 'stopScraping' });
  isScraping = false;
  document.getElementById('status').textContent = 'Stopped';
  document.getElementById('scrape-btn').classList.remove('hidden');
  document.getElementById('stop-btn').classList.add('hidden');
}

async function startScraping() {
  if (isScraping) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab.url.includes('jobs.shorecp.com')) {
    alert('Please navigate to jobs.shorecp.com first.');
    return;
  }

  isScraping = true;

  const scrapeBtn = document.getElementById('scrape-btn');
  const stopBtn = document.getElementById('stop-btn');
  const progressSection = document.getElementById('progress-section');
  const statusEl = document.getElementById('status');
  const progressText = document.getElementById('progress-text');
  const progressFill = document.getElementById('progress-fill');

  scrapeBtn.classList.add('hidden');
  stopBtn.classList.remove('hidden');
  progressSection.classList.remove('hidden');
  statusEl.textContent = 'Scraping...';
  progressText.textContent = 'Starting scrape...';
  progressFill.style.width = '10%';

  try {
    // Inject the scraper that clicks "Show more" until all jobs are loaded
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapeAllJobsFromPage
    });

    // The function sends messages back via chrome.runtime.sendMessage
    // Results are handled in the onMessage listener above
    progressFill.style.width = '50%';

  } catch (error) {
    console.error('Scraping error:', error);
    statusEl.textContent = 'Error';
    progressText.textContent = 'Error: ' + error.message;
    alert('Error scraping: ' + error.message);
    isScraping = false;
    scrapeBtn.classList.remove('hidden');
    stopBtn.classList.add('hidden');
  }
}

function onScrapeComplete(data) {
  const statusEl = document.getElementById('status');
  const progressText = document.getElementById('progress-text');
  const progressFill = document.getElementById('progress-fill');

  progressFill.style.width = '100%';
  statusEl.textContent = 'Complete';
  progressText.textContent = `Done! ${data.totalFound} jobs found, ${data.newCount} new.`;
  document.getElementById('job-count').textContent = data.totalSaved;

  isScraping = false;
  document.getElementById('scrape-btn').classList.remove('hidden');
  document.getElementById('stop-btn').classList.add('hidden');

  alert(`Scraping complete!\nFound: ${data.totalFound} jobs\nNew: ${data.newCount}\nTotal saved: ${data.totalSaved}`);
}

// ============================================================
// This function runs INSIDE the page context
// It clicks "Show more" repeatedly, then scrapes all jobs
// ============================================================
function scrapeAllJobsFromPage() {
  // Set up stop listener
  let stopRequested = false;
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'stopScraping') {
      stopRequested = true;
    }
  });

  function sendProgress(message, count) {
    chrome.runtime.sendMessage({
      action: 'scrapeProgress',
      message: message,
      count: count
    }).catch(() => {});
  }

  function getShowMoreButton() {
    // The "Show more" button is inside .boards-pagination-wrap
    const paginationWrap = document.querySelector('.boards-pagination-wrap');
    if (!paginationWrap) return null;

    // It's a button with class "button button-round button-primary..."
    const btn = paginationWrap.querySelector('button.button');
    if (btn && btn.offsetParent !== null) {
      return btn;
    }
    return null;
  }

  function getJobCount() {
    return document.querySelectorAll('.job-list-job').length;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function loadAllJobs() {
    let previousCount = getJobCount();
    let page = 1;

    sendProgress(`Page 1: ${previousCount} jobs loaded...`, undefined);

    while (!stopRequested) {
      const showMoreBtn = getShowMoreButton();
      if (!showMoreBtn) {
        sendProgress(`All jobs loaded. ${previousCount} total jobs on page.`, undefined);
        break;
      }

      page++;
      sendProgress(`Clicking "Show more" (page ${page})...`, undefined);
      showMoreBtn.click();

      // Wait for new jobs to appear
      let waited = 0;
      const maxWait = 10000;
      let newCount = previousCount;

      while (waited < maxWait) {
        await sleep(500);
        waited += 500;
        newCount = getJobCount();
        if (newCount > previousCount) {
          break;
        }
      }

      if (newCount === previousCount) {
        // No new jobs appeared - might be at the end or loading failed
        // Wait a bit more and check one more time
        await sleep(2000);
        newCount = getJobCount();
        if (newCount === previousCount) {
          sendProgress(`No more jobs to load. ${newCount} total jobs on page.`, undefined);
          break;
        }
      }

      previousCount = newCount;
      sendProgress(`Page ${page}: ${newCount} jobs loaded so far...`, undefined);

      // Small delay between clicks to be polite
      await sleep(500);
    }

    if (stopRequested) {
      sendProgress(`Stopped. Scraping ${previousCount} visible jobs...`, undefined);
    }

    // Now scrape all visible jobs
    return scrapeVisibleJobs();
  }

  function scrapeVisibleJobs() {
    const jobs = [];
    const jobElements = document.querySelectorAll('.job-list-job');

    sendProgress(`Extracting data from ${jobElements.length} jobs...`, undefined);

    jobElements.forEach((jobEl) => {
      try {
        // Job title and link
        const titleLink = jobEl.querySelector('.job-list-job-title a');
        if (!titleLink) return;

        const title = titleLink.textContent.trim();
        const link = titleLink.href;

        if (!title || title.length < 2) return;

        // Company name
        const companyLink = jobEl.querySelector('.job-list-job-company-link');
        const company = companyLink ? companyLink.textContent.trim() : '';

        // Location
        let location = '';
        let city = '';
        let state = '';
        const locationEl = jobEl.querySelector('.job-list-badge-locations');
        if (locationEl) {
          location = locationEl.textContent.trim();
          if (location.toLowerCase().includes('remote')) {
            city = 'Remote';
          } else {
            const parts = location.split(',');
            if (parts.length >= 2) {
              city = parts[0].trim();
              const stateMatch = parts[1].trim().match(/^([A-Z]{2})/);
              if (stateMatch) {
                state = stateMatch[1];
              }
            } else {
              city = location;
            }
          }
        }

        // Remote/hybrid badge
        let jobType = '';
        const remoteEl = jobEl.querySelector('.job-list-badge-remote');
        if (remoteEl) {
          jobType = remoteEl.textContent.trim();
        }

        // Salary
        let salary = '';
        const salaryTooltip = jobEl.querySelector('.job-salary-tooltip');
        if (salaryTooltip) {
          salary = salaryTooltip.textContent.trim();
        }

        // Industry
        let industry = '';
        const industryEl = jobEl.querySelector('.job-list-badge-industries');
        if (industryEl) {
          industry = industryEl.textContent.trim();
        }

        // Company size
        let companySize = '';
        const stagesEl = jobEl.querySelector('.job-list-badge-stages');
        if (stagesEl) {
          companySize = stagesEl.textContent.trim();
        }

        // Posted date
        let postedDate = '';
        const postedEl = jobEl.querySelector('.job-list-badge-posted');
        if (postedEl) {
          postedDate = postedEl.textContent.trim().replace(/^Posted\s*/i, '');
        }

        // Skills
        const skills = [];
        jobEl.querySelectorAll('.job-list-job-skill').forEach(skillEl => {
          skills.push(skillEl.textContent.trim());
        });

        // Extract job ID from URL (use last numeric segment)
        let jobId = '';
        if (link) {
          const idMatch = link.match(/.*\/(\d+)/);
          jobId = idMatch ? idMatch[1] : link.split('/').filter(s => s).pop() || '';
        }

        jobs.push({
          title,
          jobId,
          company,
          city,
          state,
          location,
          jobType,
          salary,
          industry,
          companySize,
          postedDate,
          skills: skills.join(', '),
          link
        });

      } catch (e) {
        console.error('Error parsing job element:', e);
      }
    });

    return jobs;
  }

  // Run the async loading + scraping, then save and send completion message
  loadAllJobs().then(async (jobs) => {
    sendProgress(`Saving ${jobs.length} jobs...`, undefined);

    // Get existing jobs from storage and merge
    const stored = await chrome.storage.local.get('shoreCapitalJobs');
    let allJobs = stored.shoreCapitalJobs || [];

    let newCount = 0;
    jobs.forEach(job => {
      const exists = allJobs.some(j =>
        (j.link && j.link === job.link) ||
        (j.title === job.title && j.company === job.company)
      );
      if (!exists) {
        allJobs.push(job);
        newCount++;
      }
    });

    await chrome.storage.local.set({ shoreCapitalJobs: allJobs });

    chrome.runtime.sendMessage({
      action: 'scrapeComplete',
      totalFound: jobs.length,
      newCount: newCount,
      totalSaved: allJobs.length
    }).catch(() => {});

  }).catch(err => {
    console.error('Scraping error:', err);
    chrome.runtime.sendMessage({
      action: 'scrapeProgress',
      message: 'Error: ' + err.message
    }).catch(() => {});
  });
}
