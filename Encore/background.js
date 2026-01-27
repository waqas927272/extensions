// Encore Vet Job Scraper - Background Service Worker

console.log("Encore Vet Job Scraper background script loaded");

// Listen for messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Background received message:", request.action);

  if (request.action === "scrapeProgress") {
    // Forward progress to popup if it's open
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

// Fetch job description from detail page
async function fetchJobDescription(url) {
  try {
    const response = await fetch(url);
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Try multiple selectors for description
    let description = '';
    const descSelectors = [
      '.job-description',
      '.job-details',
      '[itemprop="description"]',
      '.iCIMS_JobContent',
      '.job-content'
    ];

    for (const selector of descSelectors) {
      const el = doc.querySelector(selector);
      if (el) {
        description = el.innerText.trim();
        break;
      }
    }

    // Get job type
    let jobType = '';
    const jobTypeEl = doc.querySelector('[itemprop="employmentType"]');
    if (jobTypeEl) {
      jobType = jobTypeEl.innerText.trim();
    }

    // Get postal code from meta
    let postalCode = '';
    const postalCodeEl = doc.querySelector('meta[itemprop="postalCode"]');
    if (postalCodeEl) {
      postalCode = postalCodeEl.getAttribute('content') || '';
    }

    // Get additional location details if available
    let addressDetails = {};
    const streetEl = doc.querySelector('meta[itemprop="streetAddress"]');
    const cityEl = doc.querySelector('meta[itemprop="addressLocality"]');
    const stateEl = doc.querySelector('meta[itemprop="addressRegion"]');

    if (streetEl) addressDetails.streetAddress = streetEl.getAttribute('content') || '';
    if (cityEl) addressDetails.city = cityEl.getAttribute('content') || '';
    if (stateEl) addressDetails.state = stateEl.getAttribute('content') || '';

    return {
      description,
      jobType,
      postalCode,
      ...addressDetails
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

    // Send progress update
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
        postalCode: details.postalCode || job.postalCode,
        streetAddress: details.streetAddress || job.streetAddress,
        city: details.city || job.city,
        state: details.state || job.state
      });
    } catch (error) {
      console.error(`Error fetching description for ${job.title}:`, error);
      results.push(job);
    }

    // Delay between requests to avoid rate limiting
    if (i < jobs.length - 1) {
      await delay(500);
    }
  }

  return results;
}

// Handle extension installation
chrome.runtime.onInstalled.addListener(() => {
  console.log("Encore Vet Job Scraper installed");
});
