// Shore Capital Job Scraper - Background Script

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'scrapeJobDescription') {
    const { tabId, jobIndex, jobLink } = request;
    let handled = false;

    function onTabReady() {
      if (handled) return;
      handled = true;

      chrome.storage.local.get(['shoreCapitalJobs'], (storageResult) => {
        const storedJobs = storageResult.shoreCapitalJobs || [];
        const currentJob = storedJobs[jobIndex];
        const jobTitle = currentJob ? currentJob.title : '';

        // Try scraping with retries for SPA pages that load content dynamically
        attemptScrape(tabId, jobIndex, jobTitle, 0);
      });
    }

    function attemptScrape(tabId, jobIndex, jobTitle, attempt) {
      const MAX_ATTEMPTS = 3;
      const DELAYS = [3000, 4000, 5000]; // Increasing delays for each retry

      setTimeout(() => {
        chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: scrapeJobPage
        }).then(async (results) => {
          const result = (results && results[0] && results[0].result) || { type: 'none' };
          let description = '';

          if (result.type === 'description') {
            description = result.text || '';
          } else if (result.type === 'greenhouse' && result.boardToken && jobTitle) {
            description = await fetchGreenhouseDescription(result.boardToken, jobTitle);
          } else if (result.type === 'lever' && result.company && jobTitle) {
            description = await fetchLeverDescription(result.company, jobTitle);
          }

          // If no description found and we have retries left, try again
          if (!description && attempt < MAX_ATTEMPTS - 1) {
            console.log(`Job ${jobIndex + 1}: Attempt ${attempt + 1} found nothing, retrying...`);
            attemptScrape(tabId, jobIndex, jobTitle, attempt + 1);
          } else {
            saveDescription(jobIndex, description, tabId);
          }

        }).catch(err => {
          console.error('Error extracting description:', err);
          if (attempt < MAX_ATTEMPTS - 1) {
            attemptScrape(tabId, jobIndex, jobTitle, attempt + 1);
          } else {
            saveDescription(jobIndex, '', tabId);
          }
        });
      }, DELAYS[attempt]);
    }

    // Register listener for tab load completion
    const listener = function(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        onTabReady();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);

    // Fix race condition: check if tab already finished loading
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) return;
      if (tab && tab.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        onTabReady();
      }
    });

    // Safety timeout: skip after 30 seconds if tab never loads
    setTimeout(() => {
      if (!handled) {
        chrome.tabs.onUpdated.removeListener(listener);
        console.warn(`Timeout waiting for tab ${tabId} to load for job ${jobIndex}`);
        saveDescription(jobIndex, '', tabId);
      }
    }, 30000);

    return true;
  }

  return true;
});

// ---- Scraping function injected into the job page ----
function scrapeJobPage() {
  // Helper: strip HTML tags from element
  function cleanText(el) {
    const cloned = el.cloneNode(true);
    cloned.querySelectorAll('script, style, nav, header, footer, form, button, iframe, svg, video, .social-media-links, [data-ui="apply-button"]').forEach(n => n.remove());
    let text = cloned.innerText.trim();
    if (/<[a-z][\s\S]*>/i.test(text)) {
      const t = document.createElement('div');
      t.innerHTML = text;
      text = t.innerText.trim();
    }
    return text;
  }

  // Helper: convert HTML string to plain text
  function htmlToText(html) {
    const t = document.createElement('div');
    t.innerHTML = html;
    let text = t.innerText.trim();
    if (/<[a-z][\s\S]*>/i.test(text)) {
      t.innerHTML = text;
      text = t.innerText.trim();
    }
    return text;
  }

  // 1. Try JSON-LD (standard structured data)
  const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of jsonLdScripts) {
    try {
      let data = JSON.parse(script.textContent);
      if (Array.isArray(data)) {
        data = data.find(d => d['@type'] === 'JobPosting') || {};
      }
      if (data['@type'] === 'JobPosting' && data.description && data.description.length > 50) {
        return { type: 'description', text: htmlToText(data.description) };
      }
    } catch (e) {}
  }

  // 2. Try __NEXT_DATA__ (Next.js SSR pages like Consider platform)
  try {
    const nextData = window.__NEXT_DATA__;
    if (nextData) {
      const jobData = nextData.props?.pageProps?.job ||
                      nextData.props?.pageProps?.initialState?.jobs?.currentJob ||
                      null;
      if (jobData && jobData.description && jobData.description.length > 50) {
        return { type: 'description', text: htmlToText(jobData.description) };
      }
    }
  } catch (e) {}

  // 3. Try DOM selectors for job description elements
  const selectors = [
    '#content',
    '#app_body',
    '.job__description',
    '.job-description',
    '#job_description',
    '.job-details-description',
    '.job-detail-description',
    '.job-show-description',
    '.posting-description',
    '.section-wrapper.page-full-width',
    '.content-wrapper',
    '[class*="job-description"]',
    '[class*="jobDescription"]',
    '[class*="JobDescription"]',
    '[itemprop="description"]',
    'article',
    'main',
    '[role="main"]'
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.innerText.trim().length > 100) {
      const text = cleanText(el);
      if (text.length > 100) return { type: 'description', text };
    }
  }

  // 4. Detect Greenhouse iframe
  const ghIframe = document.querySelector('iframe[src*="greenhouse.io"]');
  if (ghIframe) {
    const m = ghIframe.src.match(/for=([^&]+)/);
    if (m) return { type: 'greenhouse', boardToken: m[1] };
  }

  // 5. Detect Lever iframe
  const leverIframe = document.querySelector('iframe[src*="lever.co"]');
  if (leverIframe) {
    try {
      const parts = new URL(leverIframe.src).pathname.split('/').filter(Boolean);
      if (parts.length > 0) return { type: 'lever', company: parts[0] };
    } catch (e) {}
  }

  // 6. Last resort: find the largest text block in the page body
  const allDivs = document.querySelectorAll('div, section');
  let bestText = '';
  let bestLen = 0;
  for (const div of allDivs) {
    // Skip elements that are too broad (like body wrappers)
    if (div.children.length > 20) continue;
    const text = cleanText(div);
    if (text.length > bestLen && text.length > 200) {
      bestLen = text.length;
      bestText = text;
    }
  }
  if (bestText) {
    return { type: 'description', text: bestText };
  }

  return { type: 'none' };
}

// ---- Greenhouse Public API ----
async function fetchGreenhouseDescription(boardToken, jobTitle) {
  try {
    const resp = await fetch(`https://boards-api.greenhouse.io/v1/boards/${boardToken}/jobs?content=true`);
    if (!resp.ok) return '';
    const data = await resp.json();
    const searchLower = jobTitle.toLowerCase().trim();

    // Exact match first
    let matched = data.jobs.find(j => j.title.toLowerCase().trim() === searchLower);

    // Partial match fallback
    if (!matched) {
      matched = data.jobs.find(j =>
        j.title.toLowerCase().trim().includes(searchLower) ||
        searchLower.includes(j.title.toLowerCase().trim())
      );
    }

    if (matched && matched.content) {
      return stripHtml(matched.content);
    }
  } catch (e) {
    console.error('Greenhouse API error:', e);
  }
  return '';
}

// ---- Lever Public API ----
async function fetchLeverDescription(company, jobTitle) {
  try {
    const resp = await fetch(`https://api.lever.co/v0/postings/${company}?mode=json`);
    if (!resp.ok) return '';
    const postings = await resp.json();
    const searchLower = jobTitle.toLowerCase().trim();

    let matched = postings.find(p => p.text.toLowerCase().trim() === searchLower);

    if (!matched) {
      matched = postings.find(p =>
        p.text.toLowerCase().trim().includes(searchLower) ||
        searchLower.includes(p.text.toLowerCase().trim())
      );
    }

    if (matched) {
      if (matched.descriptionPlain) return matched.descriptionPlain;
      if (matched.description) return stripHtml(matched.description);
    }
  } catch (e) {
    console.error('Lever API error:', e);
  }
  return '';
}

// ---- HTML to plain text ----
function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---- Save description and notify ----
function saveDescription(jobIndex, description, tabId) {
  chrome.storage.local.get(['shoreCapitalJobs'], (result) => {
    const jobs = result.shoreCapitalJobs || [];
    if (jobs[jobIndex]) {
      // Save 'No description found' when empty to prevent infinite retry loop
      jobs[jobIndex].description = description || 'No description found';
      chrome.storage.local.set({ shoreCapitalJobs: jobs }, () => {
        console.log(`Job ${jobIndex + 1}: ${description ? 'Description saved (' + description.length + ' chars)' : 'No description found'}`);
        chrome.tabs.remove(tabId).catch(() => {});
        chrome.runtime.sendMessage({
          action: 'descriptionSaved',
          jobIndex: jobIndex,
          success: !!description
        }).catch(() => {});
      });
    } else {
      chrome.tabs.remove(tabId).catch(() => {});
      chrome.runtime.sendMessage({
        action: 'descriptionSaved',
        jobIndex: jobIndex,
        success: false
      }).catch(() => {});
    }
  });
}
