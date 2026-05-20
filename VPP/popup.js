// VPP Job Scraper - Popup Script

document.addEventListener('DOMContentLoaded', () => {
  const scrapeBtn = document.getElementById('scrape-btn');
  const stopBtn = document.getElementById('stop-btn');
  const viewBtn = document.getElementById('view-btn');
  const clearBtn = document.getElementById('clear-btn');

  const jobsCount = document.getElementById('jobs-count');
  const currentPage = document.getElementById('current-page');
  const totalPages = document.getElementById('total-pages');
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
  let scrapedJobs = [];
  let currentTabId = null;

  const isGreenhouseAgencyPage = (url) => /https:\/\/app\.greenhouse\.io\/agency\/jobs\//i.test(url || '');
  const isVipVetJobsPage = (url) => /vip-vet\.com/i.test(url || '');

  const stateAbbreviations = {
    AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
    CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
    HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
    KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
    MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
    MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
    NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
    OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
    SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
    VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
    DC: 'District of Columbia', PR: 'Puerto Rico'
  };

  function getFullStateName(state) {
    const value = (state || '').replace(/\./g, '').replace(/\s+/g, ' ').trim();
    if (!value) return '';
    if (/^[A-Z]{2}$/i.test(value)) return stateAbbreviations[value.toUpperCase()] || value.toUpperCase();
    const canonical = Object.values(stateAbbreviations).find(fullName => fullName.toLowerCase() === value.toLowerCase());
    return canonical || value;
  }

  function formatLocation(city, state) {
    return [city || '', getFullStateName(state)].filter(Boolean).join(', ');
  }

  function normalizeAgencyGreenhouseJobs(jobs) {
    return (jobs || []).map((job, index) => {
      const reqId = (job.reqId || job.jobId || job.id || `VPP-${index + 1}`).replace(/^VIP-/i, 'VPP-');
      const hospitalName = job.originalHospitalName || job.hospitalName || job.hospital || '';
      const fullState = getFullStateName(job.state || '');
      return {
        ...job,
        id: reqId,
        reqId,
        jobId: reqId,
        title: job.title || job.jobTitle || '',
        hospitalName,
        hospital: hospitalName,
        originalHospitalName: hospitalName,
        city: job.city || '',
        state: fullState,
        location: job.location ? formatLocation((job.location.split(',')[0] || '').trim(), fullState || (job.location.split(',')[1] || '').trim()) : formatLocation(job.city || '', fullState),
        country: job.country || 'USA',
        category: job.category || '',
        jobType: job.jobType || '',
        link: job.link || '',
        description: job.description || '',
        streetAddress: job.streetAddress || '',
        postalCode: job.postalCode || job.zipCode || '',
        zipCode: job.zipCode || job.postalCode || '',
        source: job.source || 'VPP'
      };
    });
  }

  // Initialize
  init();

  async function init() {
    const stored = await chrome.storage.local.get('vipvetJobs');
    if (stored.vipvetJobs && stored.vipvetJobs.length > 0) {
      scrapedJobs = stored.vipvetJobs;
      showSummary(scrapedJobs.length);
    }
    getStats();
  }

  async function getStats() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab || !tab.url || (!isVipVetJobsPage(tab.url) && !isGreenhouseAgencyPage(tab.url))) {
        showError('Please navigate to vip-vet.com careers page or app.greenhouse.io/agency/jobs page.');
        scrapeBtn.disabled = true;
        return;
      }

      currentTabId = tab.id;

      if (isGreenhouseAgencyPage(tab.url)) {
        const [response] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const rows = document.querySelectorAll('#jobs tbody tr');
            const pageText = document.body?.innerText || '';
            const showingMatch = pageText.match(/Showing\s+(\d+)\s+of\s+(\d+)\s+jobs/i);
            return {
              jobsOnPage: rows.length,
              totalJobs: showingMatch ? parseInt(showingMatch[2], 10) : rows.length,
              totalPages: 1,
              currentPage: 1
            };
          }
        });

        const stats = response?.result || { jobsOnPage: 0, totalJobs: 0, totalPages: 1, currentPage: 1 };
        jobsCount.textContent = stats.jobsOnPage || 0;
        currentPage.textContent = stats.currentPage || 1;
        totalPages.textContent = stats.totalPages || 1;
        totalJobs.textContent = stats.totalJobs || stats.jobsOnPage || 0;
        scrapeBtn.disabled = false;
        return;
      }

      // Wait for page to be ready
      await new Promise(resolve => setTimeout(resolve, 500));

      // Get stats from frames
      let stats = null;
      try {
        const responses = await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          func: () => {
            const jobPosts = document.querySelectorAll('tr.job-post');
            const isGreenhouse = window.location.href.includes('greenhouse.io');

            // Get total job count from header
            let totalJobsCount = jobPosts.length;
            const headers = document.querySelectorAll('h2, .section-header, [data-testid="job-count-header"]');
            for (const el of headers) {
              const match = el.innerText.match(/(\d+)\s*jobs?/i);
              if (match) {
                totalJobsCount = parseInt(match[1], 10);
                break;
              }
            }

            // Count pagination pages
            const paginationLinks = document.querySelectorAll('.pagination__link');
            const totalPagesCount = paginationLinks.length || 1;

            // Get current page
            const activePage = document.querySelector('.pagination__link--active');
            const currentPageNum = activePage ? parseInt(activePage.innerText, 10) : 1;

            return {
              jobsOnPage: jobPosts.length,
              totalJobs: totalJobsCount,
              totalPages: totalPagesCount,
              currentPage: currentPageNum,
              isGreenhouse: isGreenhouse,
              url: window.location.href
            };
          }
        });

        // Find the Greenhouse frame response
        for (const response of responses) {
          if (response.result && response.result.isGreenhouse && response.result.jobsOnPage > 0) {
            stats = response.result;
            break;
          }
        }

        if (!stats) {
          for (const response of responses) {
            if (response.result && response.result.jobsOnPage > 0) {
              stats = response.result;
              break;
            }
          }
        }
      } catch (e) {
        console.error('Error getting stats:', e);
      }

      if (stats) {
        jobsCount.textContent = stats.jobsOnPage || 0;
        currentPage.textContent = stats.currentPage || 1;
        totalPages.textContent = stats.totalPages || 1;
        totalJobs.textContent = stats.totalJobs || 'Unknown';
        scrapeBtn.disabled = false;
      } else {
        jobsCount.textContent = '0';
        currentPage.textContent = '-';
        totalPages.textContent = '-';
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

      if (isGreenhouseAgencyPage(tab?.url || '')) {
        updateProgress('Scraping...', 'Greenhouse dashboard jobs', 15);
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['vipvet-greenhouse-content.js']
        });

        if (!result || !Array.isArray(result.result)) {
          throw new Error('No jobs returned from Greenhouse dashboard scraper.');
        }

        scrapedJobs = normalizeAgencyGreenhouseJobs(result.result);
        await chrome.storage.local.set({ vipvetJobs: scrapedJobs });
        updateProgress('Complete!', `${scrapedJobs.length} jobs found`, 100);
        showSummary(scrapedJobs.length);
        isScraping = false;
        scrapeBtn.classList.remove('hidden');
        stopBtn.classList.add('hidden');
        progressSection.classList.add('hidden');
        return;
      }

      await new Promise(resolve => setTimeout(resolve, 500));

      // First, click page 1 to ensure we start from the beginning
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: () => {
          const isGreenhouse = window.location.href.includes('greenhouse.io');
          if (!isGreenhouse) return false;

          const pageButtons = document.querySelectorAll('.pagination__link');
          for (const btn of pageButtons) {
            if (btn.innerText.trim() === '1') {
              btn.click();
              return true;
            }
          }
          return false;
        }
      });

      // Wait for page 1 to load
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Get pagination info
      const paginationInfo = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: () => {
          const paginationLinks = document.querySelectorAll('.pagination__link');
          const isGreenhouse = window.location.href.includes('greenhouse.io');

          // Get max page number from pagination links
          let maxPage = 1;
          paginationLinks.forEach(link => {
            const num = parseInt(link.innerText.trim(), 10);
            if (!isNaN(num) && num > maxPage) {
              maxPage = num;
            }
          });

          return {
            totalPages: maxPage,
            isGreenhouse: isGreenhouse,
            paginationCount: paginationLinks.length
          };
        }
      });

      let totalPagesCount = 1;
      for (const resp of paginationInfo) {
        if (resp.result && resp.result.isGreenhouse && resp.result.totalPages > 1) {
          totalPagesCount = resp.result.totalPages;
          console.log('Greenhouse frame found, total pages:', totalPagesCount);
          break;
        }
      }

      console.log('Total pages to scrape:', totalPagesCount);

      // Scrape each page
      let currentPageNum = 1;
      while (currentPageNum <= totalPagesCount && !stopRequested) {
        updateProgress('Scraping...', `Page ${currentPageNum} of ${totalPagesCount} (${scrapedJobs.length} jobs)`, Math.round((currentPageNum / totalPagesCount) * 100));

        // Scrape current page
        const responses = await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          func: () => {
            // Function to parse location from title and hospital name
            function parseLocation(title, hospitalName) {
              let city = '';
              let state = '';

              // Combined text to search
              const fullText = title + ' ' + hospitalName;

              // Pattern 1: "- City, ST" or "- City ST" at end of title
              let match = title.match(/[-–]\s*([A-Za-z\s\.]+),?\s*([A-Z]{2})\s*$/);
              if (match) {
                city = match[1].trim();
                state = match[2];
                return { city, state };
              }

              // Pattern 2: Just "- ST" at end (2-letter state code)
              match = title.match(/[-–]\s*([A-Z]{2})\s*$/);
              if (match) {
                state = match[1];
                // Try to get city from earlier in title
                const cityMatch = title.match(/[-–]\s*([A-Za-z\s\.]+)\s*[-–]\s*[A-Z]{2}\s*$/);
                if (cityMatch) {
                  city = cityMatch[1].trim();
                }
                return { city, state };
              }

              // Pattern 3: "City, State" anywhere in title (e.g., "Franklin, TN")
              match = fullText.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),\s*([A-Z]{2})(?:\s|$|-)/);
              if (match) {
                city = match[1].trim();
                state = match[2];
                return { city, state };
              }

              // Pattern 4: Known city names with state
              const cityStatePatterns = [
                /Knoxville.*?(TN)/i,
                /Franklin.*?(TN)/i,
                /El Paso.*?(TX)/i,
                /New York.*?(NY)/i,
                /Aurora.*?(CO)/i,
                /Redlands.*?(CA)/i,
                /Humble.*?(TX)/i,
                /Bradenton.*?(FL)/i,
                /Fairfax.*?(VA)/i,
                /Falls Church.*?(VA)/i
              ];

              for (const pattern of cityStatePatterns) {
                match = fullText.match(pattern);
                if (match) {
                  state = match[1].toUpperCase();
                  const cityExtract = fullText.match(new RegExp('(' + pattern.source.split('.*?')[0] + ')', 'i'));
                  if (cityExtract) city = cityExtract[1];
                  return { city, state };
                }
              }

              // Pattern 5: State abbreviation anywhere in title after a dash
              match = title.match(/[-–]\s*[^-–]*\b([A-Z]{2})\b/);
              if (match) {
                const possibleState = match[1];
                const validStates = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];
                if (validStates.includes(possibleState)) {
                  state = possibleState;
                }
              }

              return { city, state };
            }

            const jobs = [];
            const jobPosts = document.querySelectorAll('tr.job-post');

            jobPosts.forEach((post) => {
              try {
                const cell = post.querySelector('td.cell');
                if (!cell) return;

                const linkEl = cell.querySelector('a');
                if (!linkEl) return;

                const link = linkEl.href;
                const titleEl = linkEl.querySelector('p.body--medium, p.body.body--medium');
                const title = titleEl ? titleEl.innerText.trim() : linkEl.innerText.trim().split('\n')[0];
                const hospitalEl = linkEl.querySelector('p.body__secondary, p.body.body__secondary');
                const hospitalName = hospitalEl ? hospitalEl.innerText.trim() : '';

                if (!title || !link) return;

                // Extract job ID
                let rawReqId = '';
                const ghMatch = link.match(/gh_jid=(\d+)/);
                if (ghMatch) rawReqId = ghMatch[1];
                else {
                  const jobMatch = link.match(/jobs\/(\d+)/);
                  if (jobMatch) rawReqId = jobMatch[1];
                }
                const reqId = rawReqId ? 'VPP-' + rawReqId : '';

                // Parse location from title and hospital name
                const { city, state } = parseLocation(title, hospitalName);

                jobs.push({
                  title,
                  reqId,
                  hospitalName,
                  hospital: hospitalName,
                  originalHospitalName: hospitalName,
                  streetAddress: '',
                  city,
                  state,
                  country: 'USA',
                  category: '',
                  jobType: '',
                  link,
                  description: '',
                  postalCode: ''
                });
              } catch (e) {
                console.error('Error:', e);
              }
            });

            return {
              jobs,
              isGreenhouse: window.location.href.includes('greenhouse.io'),
              url: window.location.href
            };
          }
        });

        // Collect jobs from Greenhouse frame
        for (const response of responses) {
          if (response.result && response.result.jobs && response.result.jobs.length > 0 && response.result.isGreenhouse) {
            console.log(`Page ${currentPageNum}: Found ${response.result.jobs.length} jobs`);
            scrapedJobs.push(...response.result.jobs);
            break; // Only take from Greenhouse frame
          }
        }

        // If there are more pages, click next
        if (currentPageNum < totalPagesCount && !stopRequested) {
          const clickResult = await chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            func: () => {
              const isGreenhouse = window.location.href.includes('greenhouse.io');
              if (!isGreenhouse) return { clicked: false };

              // Try clicking the next page number
              const activeLink = document.querySelector('.pagination__link--active');
              if (activeLink) {
                const nextSibling = activeLink.parentElement?.nextElementSibling?.querySelector('.pagination__link');
                if (nextSibling) {
                  nextSibling.click();
                  return { clicked: true, method: 'next-number' };
                }
              }

              // Try clicking the Next button
              const nextBtn = document.querySelector('.pagination__next:not([aria-disabled="true"]):not(.pagination__next--inactive)');
              if (nextBtn) {
                nextBtn.click();
                return { clicked: true, method: 'next-button' };
              }

              return { clicked: false };
            }
          });

          let clicked = false;
          for (const resp of clickResult) {
            if (resp.result && resp.result.clicked) {
              clicked = true;
              console.log('Clicked next using:', resp.result.method);
              break;
            }
          }

          if (clicked) {
            // Wait for page content to update
            await new Promise(resolve => setTimeout(resolve, 2500));
          } else {
            console.log('Could not click next, stopping pagination');
            break;
          }
        }

        currentPageNum++;
      }

      // Remove duplicates by reqId
      const uniqueJobs = [];
      const seenIds = new Set();
      for (const job of scrapedJobs) {
        if (job.reqId && !seenIds.has(job.reqId)) {
          seenIds.add(job.reqId);
          uniqueJobs.push(job);
        } else if (!job.reqId) {
          uniqueJobs.push(job);
        }
      }
      scrapedJobs = uniqueJobs;

      updateProgress('Complete!', `${scrapedJobs.length} jobs found`, 100);

      // Save scraped jobs
      await chrome.storage.local.set({ vipvetJobs: scrapedJobs });
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

  // Stop button click
  stopBtn.addEventListener('click', async () => {
    stopRequested = true;
    isScraping = false;

    if (scrapedJobs.length > 0) {
      await chrome.storage.local.set({ vipvetJobs: scrapedJobs });
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
      await chrome.storage.local.remove('vipvetJobs');
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

