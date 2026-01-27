// Shore Capital Job Scraper - Background Script

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchDescription') {
    fetchJobDescription(request.url)
      .then(data => sendResponse(data))
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }

  if (request.action === 'fetchCompanyJobs') {
    fetchCompanyJobsViaTab(request.url, request.companyName)
      .then(data => sendResponse(data))
      .catch(error => sendResponse({ error: error.message, jobs: [] }));
    return true;
  }

  if (request.action === 'extractedJobs') {
    // Content script sends extracted jobs back
    // This is handled via the tab messaging in fetchCompanyJobsViaTab
    return false;
  }
});

async function fetchJobDescription(url) {
  try {
    const response = await fetch(url);
    const html = await response.text();

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Try to find job description
    let description = '';
    const descSelectors = [
      '.job-description',
      '.job-details-content',
      '.job-content',
      '[data-testid="job-description"]',
      '.description',
      'article'
    ];

    for (const selector of descSelectors) {
      const el = doc.querySelector(selector);
      if (el) {
        description = el.innerText.trim();
        break;
      }
    }

    // Try to find job type
    let jobType = '';
    const typeSelectors = [
      '.job-type',
      '[data-testid="job-type"]',
      '.employment-type'
    ];

    for (const selector of typeSelectors) {
      const el = doc.querySelector(selector);
      if (el) {
        jobType = el.innerText.trim();
        break;
      }
    }

    return { description, jobType };
  } catch (error) {
    console.error('Error fetching description:', error);
    return { error: error.message };
  }
}

async function fetchCompanyJobsViaTab(url, companyName) {
  return new Promise(async (resolve, reject) => {
    try {
      // Open company page in a new tab
      const tab = await chrome.tabs.create({ url: url, active: false });

      console.log(`Opened tab ${tab.id} for ${companyName}`);

      // Wait for tab to load
      const waitForLoad = () => {
        return new Promise((res) => {
          const listener = (tabId, changeInfo) => {
            if (tabId === tab.id && changeInfo.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              res();
            }
          };
          chrome.tabs.onUpdated.addListener(listener);

          // Timeout after 15 seconds
          setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            res();
          }, 15000);
        });
      };

      await waitForLoad();

      // Give extra time for React to render
      await new Promise(r => setTimeout(r, 2000));

      // Inject script to extract jobs
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractJobsFromPage,
        args: [companyName]
      });

      // Close the tab
      await chrome.tabs.remove(tab.id);

      if (results && results[0] && results[0].result) {
        console.log(`Extracted ${results[0].result.jobs.length} jobs from ${companyName}`);
        resolve(results[0].result);
      } else {
        resolve({ jobs: [], companyName });
      }

    } catch (error) {
      console.error('Error fetching company jobs via tab:', error);
      resolve({ error: error.message, jobs: [] });
    }
  });
}

// This function runs in the context of the company page
function extractJobsFromPage(companyName) {
  const jobs = [];

  try {
    // Find all job elements
    const jobElements = document.querySelectorAll('.job-list-job');

    console.log(`Found ${jobElements.length} jobs on page for ${companyName}`);

    jobElements.forEach((jobEl, index) => {
      try {
        // Get title and link
        const titleLink = jobEl.querySelector('.job-list-job-title a');
        if (!titleLink) return;

        const title = titleLink.textContent.trim();
        const link = titleLink.href;

        if (!title || title.length < 3) return;

        // Get location
        let city = '';
        let state = '';
        let country = 'USA';
        const locationEl = jobEl.querySelector('.job-list-badge-locations');
        if (locationEl) {
          const location = locationEl.textContent.trim();
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

        // Get remote/hybrid status
        let jobType = '';
        const remoteEl = jobEl.querySelector('.job-list-badge-remote');
        if (remoteEl) {
          jobType = remoteEl.textContent.trim();
        }

        // Get skills
        const skills = [];
        jobEl.querySelectorAll('.job-list-job-skill').forEach(skillEl => {
          skills.push(skillEl.textContent.trim());
        });
        const category = skills.slice(0, 3).join(', ');

        // Get salary
        let salary = '';
        const badges = jobEl.querySelectorAll('.job-list-badge');
        badges.forEach(badge => {
          if (badge.textContent.includes('Salary')) {
            salary = badge.textContent.trim();
          }
        });

        jobs.push({
          title: title,
          reqId: `${companyName.replace(/\s+/g, '-').toLowerCase()}-${index + 1}`,
          hospitalName: companyName,
          streetAddress: '',
          city: city,
          state: state,
          country: country,
          category: category,
          jobType: jobType,
          link: link,
          description: salary || '',
          postalCode: ''
        });

      } catch (e) {
        console.error('Error parsing job:', e);
      }
    });

  } catch (e) {
    console.error('Error extracting jobs:', e);
  }

  return { jobs, companyName };
}
