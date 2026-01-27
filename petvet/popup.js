// PetVet Care Centers Job Scraper - Popup Script

let isScraping = false;
let stopRequested = false;

document.addEventListener('DOMContentLoaded', () => {
  loadStoredCount();
  setupEventListeners();
});

async function loadStoredCount() {
  const stored = await chrome.storage.local.get('petvetJobs');
  const jobs = stored.petvetJobs || [];
  document.getElementById('job-count').textContent = jobs.length;
}

function setupEventListeners() {
  document.getElementById('scrape-btn').addEventListener('click', startScraping);
  document.getElementById('stop-btn').addEventListener('click', () => {
    stopRequested = true;
  });
  document.getElementById('view-btn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('results.html') });
  });
}

async function startScraping() {
  if (isScraping) return;

  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab.url.includes('petvetcarecenters.com')) {
    alert('Please navigate to petvetcarecenters.com/site/careers-search-results first.');
    return;
  }

  isScraping = true;
  stopRequested = false;

  const scrapeBtn = document.getElementById('scrape-btn');
  const stopBtn = document.getElementById('stop-btn');
  const progressSection = document.getElementById('progress-section');
  const statusEl = document.getElementById('status');

  scrapeBtn.classList.add('hidden');
  stopBtn.classList.remove('hidden');
  progressSection.classList.remove('hidden');
  statusEl.textContent = 'Scraping...';

  try {
    // Inject and execute scraping script
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapeJobsFromPage
    });

    if (results && results[0] && results[0].result) {
      const jobs = results[0].result;

      // Get existing jobs
      const stored = await chrome.storage.local.get('petvetJobs');
      let allJobs = stored.petvetJobs || [];

      // Add new jobs, avoiding duplicates
      let newCount = 0;
      jobs.forEach(job => {
        const exists = allJobs.some(j => j.jobId === job.jobId);
        if (!exists) {
          allJobs.push(job);
          newCount++;
        }
      });

      // Save jobs
      await chrome.storage.local.set({ petvetJobs: allJobs });

      document.getElementById('job-count').textContent = allJobs.length;
      document.getElementById('progress-fill').style.width = '100%';
      document.getElementById('progress-text').textContent = `Found ${jobs.length} jobs (${newCount} new)`;
      statusEl.textContent = 'Complete';

      alert(`Scraping complete!\nFound: ${jobs.length} jobs\nNew: ${newCount}\nTotal saved: ${allJobs.length}`);
    }

  } catch (error) {
    console.error('Scraping error:', error);
    statusEl.textContent = 'Error';
    alert('Error scraping: ' + error.message);
  }

  isScraping = false;
  scrapeBtn.classList.remove('hidden');
  stopBtn.classList.add('hidden');
}

// This function runs in the context of the page
function scrapeJobsFromPage() {
  const jobs = [];

  // Find all job items
  const jobItems = document.querySelectorAll('.results-list__item');

  console.log(`Found ${jobItems.length} job items`);

  jobItems.forEach((item, index) => {
    try {
      const jobId = item.getAttribute('data-id') || `petvet-${index + 1}`;

      // Get job title
      const titleEl = item.querySelector('.title.title--results, h3.title');
      const title = titleEl ? titleEl.textContent.trim() : '';

      // Get hospital name
      const hospitalEl = item.querySelector('.hospital.hospital--results, p.hospital');
      const hospitalName = hospitalEl ? hospitalEl.textContent.trim() : '';

      // Get location
      const locationEl = item.querySelector('.location.location--results, p.location');
      let fullLocation = locationEl ? locationEl.textContent.trim() : '';

      // Parse location (format: "street, city, state, country" or "city, state")
      let streetAddress = '';
      let city = '';
      let state = '';
      let country = 'US';

      if (fullLocation) {
        // Remove map marker icon text if present
        fullLocation = fullLocation.replace(/^\s*/, '');

        const parts = fullLocation.split(',').map(p => p.trim());

        if (parts.length >= 4) {
          // Full format: street, city, state, country
          streetAddress = parts[0];
          city = parts[1];
          state = parts[2];
          country = parts[3] || 'US';
        } else if (parts.length === 3) {
          // city, state, country or street, city, state
          if (parts[2].length === 2 || parts[2] === 'US' || parts[2] === 'USA') {
            city = parts[0];
            state = parts[1];
            country = parts[2];
          } else {
            streetAddress = parts[0];
            city = parts[1];
            state = parts[2];
          }
        } else if (parts.length === 2) {
          city = parts[0];
          state = parts[1];
        } else {
          city = fullLocation;
        }
      }

      // Get job link
      const linkEl = item.querySelector('.results-list__apply a');
      const link = linkEl ? linkEl.href : '';

      if (title) {
        jobs.push({
          jobId: jobId,
          title: title,
          hospitalName: hospitalName,
          streetAddress: streetAddress,
          city: city,
          state: state,
          country: country,
          fullLocation: fullLocation,
          link: link,
          category: '',
          jobType: '',
          description: ''
        });
      }

    } catch (e) {
      console.error('Error parsing job item:', e);
    }
  });

  return jobs;
}
