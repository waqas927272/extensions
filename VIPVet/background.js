// VIPVet Job Scraper - Background Service Worker

console.log("VIPVet Job Scraper background script loaded");

// Listen for messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Background received message:", request.action);

  if (request.action === "scrapeProgress") {
    chrome.runtime.sendMessage(request).catch(() => {});
  }

  if (request.action === "fetchDescription") {
    fetchJobDescription(request.url)
      .then(data => sendResponse(data))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (request.action === "fetchAllDescriptions") {
    fetchAllDescriptions(request.jobs)
      .then(jobs => sendResponse({ jobs: jobs }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  return true;
});

// Fetch job description from Greenhouse detail page
async function fetchJobDescription(url) {
  try {
    const response = await fetch(url);
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    let description = '';

    // Try to find description in Greenhouse iframe or direct content
    const descSelectors = [
      '#content',
      '.job-description',
      '.content',
      '[data-qa="job-description"]',
      '.job__description',
      '#job-content',
      '.posting-requirements',
      '.section-wrapper'
    ];

    for (const selector of descSelectors) {
      const el = doc.querySelector(selector);
      if (el) {
        const clone = el.cloneNode(true);
        clone.querySelectorAll('.social-media-links, form, #job-app, .apply-section, nav, header, footer').forEach(e => e.remove());
        description = clone.innerText.trim();
        if (description.length > 50) break;
      }
    }

    // Get job type if available
    let jobType = '';
    const jobTypeEl = doc.querySelector('[data-qa="job-type"], .job-type, .employment-type');
    if (jobTypeEl) {
      jobType = jobTypeEl.innerText.trim();
    }

    // Get location details
    let city = '', state = '', postalCode = '', country = 'USA';
    const locationEl = doc.querySelector('.location, [data-qa="job-location"], .job-location');
    if (locationEl) {
      const locText = locationEl.innerText.trim();
      const parts = locText.split(',').map(p => p.trim());
      city = parts[0] || '';
      state = parts[1] || '';
    }

    return {
      description,
      jobType,
      city,
      state,
      postalCode,
      country
    };
  } catch (error) {
    console.error('Error fetching description:', error);
    return { error: error.message };
  }
}

// Fetch descriptions for all jobs
async function fetchAllDescriptions(jobs) {
  const results = [];
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];

    chrome.runtime.sendMessage({
      action: "descriptionProgress",
      current: i + 1,
      total: jobs.length,
      jobTitle: job.title
    }).catch(() => {});

    try {
      const details = await fetchJobDescription(job.link);
      results.push({
        ...job,
        description: details.description || job.description,
        jobType: details.jobType || job.jobType,
        postalCode: details.postalCode || job.postalCode
      });
    } catch (error) {
      console.error(`Error fetching description for ${job.title}:`, error);
      results.push(job);
    }

    if (i < jobs.length - 1) {
      await delay(500);
    }
  }

  return results;
}

// Handle extension installation
chrome.runtime.onInstalled.addListener(() => {
  console.log("VIPVet Job Scraper installed");
});
