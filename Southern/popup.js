// Shore Capital Job Scraper - Popup Script

document.addEventListener('DOMContentLoaded', () => {
  const scrapeBtn = document.getElementById('scrape-btn');
  const stopBtn = document.getElementById('stop-btn');
  const viewBtn = document.getElementById('view-btn');
  const clearBtn = document.getElementById('clear-btn');

  const companiesCount = document.getElementById('companies-count');
  const totalCompanies = document.getElementById('total-companies');
  const totalJobs = document.getElementById('total-jobs');

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
  let scrapedCompanies = [];
  let currentTabId = null;

  // Initialize
  init();

  async function init() {
    const stored = await chrome.storage.local.get('shoreCapitalData');
    if (stored.shoreCapitalData && stored.shoreCapitalData.length > 0) {
      scrapedCompanies = stored.shoreCapitalData;
      showSummary(scrapedCompanies.length);
    }
    getStats();
  }

  async function getStats() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab || !tab.url || !tab.url.includes('shorecp.com')) {
        showError('Please navigate to jobs.shorecp.com to use this extension.');
        scrapeBtn.disabled = true;
        return;
      }

      currentTabId = tab.id;

      // Wait for page to be ready
      await new Promise(resolve => setTimeout(resolve, 500));

      // Get stats from page
      try {
        const responses = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const companyItems = document.querySelectorAll('.job-boards-company-item');

            // Get total count from page
            const countEl = document.querySelector('.job-boards-company-grid-count');
            let totalCount = companyItems.length;
            if (countEl) {
              const match = countEl.innerText.match(/(\d+)/);
              if (match) {
                totalCount = parseInt(match[1], 10);
              }
            }

            // Get total jobs from header
            let totalJobsCount = 0;
            const headerEl = document.querySelector('.job-boards-title');
            if (headerEl) {
              const match = headerEl.innerText.match(/(\d+)\s*jobs/i);
              if (match) {
                totalJobsCount = parseInt(match[1], 10);
              }
            }

            return {
              companiesOnPage: companyItems.length,
              totalCompanies: totalCount,
              totalJobs: totalJobsCount
            };
          }
        });

        if (responses && responses[0] && responses[0].result) {
          const stats = responses[0].result;
          companiesCount.textContent = stats.companiesOnPage || 0;
          totalCompanies.textContent = stats.totalCompanies || 'Unknown';
          totalJobs.textContent = stats.totalJobs || 'Unknown';
          scrapeBtn.disabled = false;
        }
      } catch (e) {
        console.error('Error getting stats:', e);
        companiesCount.textContent = '-';
        totalCompanies.textContent = '-';
        totalJobs.textContent = '-';
        scrapeBtn.disabled = false;
      }
    } catch (error) {
      console.error('Error getting stats:', error);
      showError('Unable to connect to page. Try refreshing.');
      scrapeBtn.disabled = true;
    }
  }

  // Scrape button click
  scrapeBtn.addEventListener('click', async () => {
    if (isScraping) return;

    isScraping = true;
    stopRequested = false;
    scrapedCompanies = [];
    scrapeBtn.classList.add('hidden');
    stopBtn.classList.remove('hidden');
    errorSection.classList.add('hidden');
    resultsSummary.classList.add('hidden');
    progressSection.classList.remove('hidden');

    updateProgress('Loading all companies...', 'Scrolling to load more...', 10);

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      currentTabId = tab.id;

      // First, scroll to load all companies
      let previousCount = 0;
      let currentCount = 0;
      let noChangeCount = 0;
      const maxNoChange = 3; // Stop after 3 scrolls with no new content

      while (!stopRequested && noChangeCount < maxNoChange) {
        // Scroll down to load more
        const scrollResult = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const previousHeight = document.body.scrollHeight;
            window.scrollTo(0, document.body.scrollHeight);
            return {
              count: document.querySelectorAll('.job-boards-company-item').length,
              previousHeight
            };
          }
        });

        if (scrollResult && scrollResult[0] && scrollResult[0].result) {
          currentCount = scrollResult[0].result.count;
          updateProgress('Loading all companies...', `${currentCount} companies loaded`, Math.min(50, currentCount));

          if (currentCount === previousCount) {
            noChangeCount++;
          } else {
            noChangeCount = 0;
          }
          previousCount = currentCount;
        }

        // Wait for content to load
        await new Promise(resolve => setTimeout(resolve, 1500));
      }

      updateProgress('Scraping data...', `${currentCount} companies found`, 60);

      // Scroll back to top
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          window.scrollTo(0, 0);
        }
      });

      await new Promise(resolve => setTimeout(resolve, 500));

      // Now scrape all companies
      const scrapeResult = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const companies = [];
          const companyItems = document.querySelectorAll('.job-boards-company-item');

          companyItems.forEach((item) => {
            try {
              const nameEl = item.querySelector('.job-boards-company-name');
              const name = nameEl ? nameEl.innerText.trim() : '';

              const descEl = item.querySelector('.job-boards-company-description');
              const description = descEl ? descEl.innerText.trim() : '';

              const linkEl = item.querySelector('.job-boards-company-item-link');
              const link = linkEl ? linkEl.href : '';

              const numJobs = parseInt(item.dataset.numJobs || '0', 10);

              // Get location from tags
              let location = '';
              const locationTags = item.querySelectorAll('.job-boards-company-tag-locations');
              if (locationTags.length > 0) {
                location = Array.from(locationTags).map(t => t.innerText.trim()).join(', ');
              }

              // Get industry from tags
              let industry = '';
              const industryTags = item.querySelectorAll('.job-boards-company-tag-industries');
              if (industryTags.length > 0) {
                industry = Array.from(industryTags).map(t => t.innerText.trim()).join(', ');
              }

              // Get employee count
              let employees = '';
              const allTags = item.querySelectorAll('.job-boards-company-tag');
              allTags.forEach(tag => {
                const text = tag.innerText.trim();
                if (text.includes('employees')) {
                  employees = text;
                }
              });

              // Get jobs link
              const jobsLinkEl = item.querySelector('.job-boards-company-link');
              const jobsLink = jobsLinkEl ? jobsLinkEl.href : '';

              // Parse city and state from location
              let city = '';
              let state = '';
              if (location) {
                const parts = location.split(',');
                if (parts.length >= 2) {
                  city = parts[0].trim();
                  state = parts[1].trim();
                } else if (parts.length === 1) {
                  state = parts[0].trim();
                }
              }

              if (name) {
                companies.push({
                  title: name,
                  reqId: link.split('/').pop() || '',
                  hospitalName: name,
                  streetAddress: '',
                  city,
                  state,
                  country: 'USA',
                  category: industry,
                  jobType: employees,
                  link: jobsLink || link,
                  description,
                  postalCode: '',
                  numJobs,
                  industry,
                  location
                });
              }
            } catch (e) {
              console.error('Error scraping company:', e);
            }
          });

          return companies;
        }
      });

      if (scrapeResult && scrapeResult[0] && scrapeResult[0].result) {
        scrapedCompanies = scrapeResult[0].result;
      }

      updateProgress('Complete!', `${scrapedCompanies.length} companies found`, 100);

      // Save scraped data
      await chrome.storage.local.set({ shoreCapitalData: scrapedCompanies });
      showSummary(scrapedCompanies.length);

    } catch (error) {
      console.error('Scraping error:', error);
      showError('Error during scraping: ' + error.message);
    }

    isScraping = false;
    scrapeBtn.classList.remove('hidden');
    stopBtn.classList.add('hidden');
    progressSection.classList.add('hidden');
  });

  // Stop button click
  stopBtn.addEventListener('click', async () => {
    stopRequested = true;
    isScraping = false;

    if (scrapedCompanies.length > 0) {
      await chrome.storage.local.set({ shoreCapitalData: scrapedCompanies });
      showSummary(scrapedCompanies.length);
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
      await chrome.storage.local.remove('shoreCapitalData');
      scrapedCompanies = [];
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
    summaryText.textContent = `${count} companies scraped`;
    resultsSummary.classList.remove('hidden');
  }
});
