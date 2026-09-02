// background.js
let isScraping = false;
let currentTabId = null;
let currentIframeFrameId = null;
let currentPage = 0;
let allScrapedJobs = [];
let uniqueJobLinks = new Set();
let descriptionFetchChain = Promise.resolve();

const IFRAME_ID = "jv_careersite_iframe_id";
const IFRAME_PARTIAL_SRC = "jobs.jobvite.com/unitedveterinarycare/";
const EXCLUDED_JOB_TITLE_PATTERN = /\b(?:mentor(?:ship|ing|ed|s)?|locum(?:s)?|relie(?:f|ver|vers)|releif)\b/i;

function isExcludedJobListing(job) {
    const title = job?.title || '';
    const jobType = job?.jobType || job?.employmentType || '';
    return EXCLUDED_JOB_TITLE_PATTERN.test(`${title} ${jobType}`);
}

function sendStatusToPopup(status, message = '', scrapedCount = 0) {
  chrome.runtime.sendMessage({
    action: 'scrapingStatus',
    status: status,
    message: message,
    scrapedCount: scrapedCount,
    currentPage: currentPage
  }).catch(() => {});
}

function cleanDirectJobText(value) {
    return String(value || '')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function decodeDirectHtmlEntities(value) {
    return String(value || '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&#x27;/gi, "'")
        .replace(/&#x2F;/gi, '/')
        .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
        .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function directJobHtmlToText(value) {
    return decodeDirectHtmlEntities(value)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(?:p|div|li|h[1-6]|section|ul|ol)>/gi, '\n')
        .replace(/<li[^>]*>/gi, '- ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function findJobPostingJsonLd(value) {
    if (!value) return null;
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = findJobPostingJsonLd(item);
            if (found) return found;
        }
        return null;
    }
    if (typeof value !== 'object') return null;

    const type = value['@type'];
    if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) {
        return value;
    }

    if (value['@graph']) return findJobPostingJsonLd(value['@graph']);
    return null;
}

function extractJobPostingJsonLd(html) {
    const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    let match;

    while ((match = scriptPattern.exec(html || '')) !== null) {
        if (!/type\s*=\s*["']application\/ld\+json["']/i.test(match[1] || '')) continue;
        try {
            const jobPosting = findJobPostingJsonLd(JSON.parse(match[2] || ''));
            if (jobPosting) return jobPosting;
        } catch (_) {
            // Ignore unrelated or malformed JSON-LD blocks.
        }
    }

    return null;
}

function formatJobPostingDescription(jobPosting) {
    const lines = [
        '=== JOB POSTING DATA ===',
        `Title: ${cleanDirectJobText(jobPosting.title)}`,
        `Date Posted: ${cleanDirectJobText(jobPosting.datePosted)}`,
        `Industry/Category: ${cleanDirectJobText(jobPosting.industry || jobPosting.occupationalCategory)}`,
        `Employment Type: ${cleanDirectJobText(Array.isArray(jobPosting.employmentType) ? jobPosting.employmentType.join(' / ') : jobPosting.employmentType)}`
    ];

    const organizationName = cleanDirectJobText(jobPosting.hiringOrganization?.name);
    if (organizationName) lines.push(`Hiring Organization: ${organizationName}`);

    const locations = Array.isArray(jobPosting.jobLocation)
        ? jobPosting.jobLocation
        : (jobPosting.jobLocation ? [jobPosting.jobLocation] : []);
    const formattedLocations = locations
        .map(location => location?.address || location || {})
        .map(address => {
            const country = typeof address.addressCountry === 'object'
                ? address.addressCountry?.name || address.addressCountry?.['@id'] || ''
                : address.addressCountry || '';
            return [address.addressLocality, address.addressRegion, country]
                .map(cleanDirectJobText)
                .filter(Boolean)
                .join(', ');
        })
        .filter(Boolean);

    if (formattedLocations.length > 0) {
        lines.push('', 'Locations:', ...formattedLocations.map(location => `  - ${location}`));
    }

    const salary = jobPosting.baseSalary?.value;
    if (salary) {
        const currency = cleanDirectJobText(jobPosting.baseSalary?.currency || salary.currency || '$');
        const minValue = cleanDirectJobText(salary.minValue);
        const maxValue = cleanDirectJobText(salary.maxValue);
        const unitText = cleanDirectJobText(salary.unitText);
        if (minValue || maxValue) {
            lines.push(`Salary Range: ${currency}${minValue}${minValue && maxValue ? ' - ' : ''}${maxValue}${unitText ? ` ${unitText}` : ''}`);
        }
    }

    const description = directJobHtmlToText(jobPosting.description || '');
    if (!description) throw new Error('JobPosting JSON-LD did not contain a description.');
    lines.push('', '=== FULL JOB DESCRIPTION ===', description);

    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function fetchJobDescriptionDirectly(request) {
    if (!request.url) throw new Error('Missing job URL.');

    const url = new URL(request.url);
    if (url.hostname.includes('jobvite.com')) url.searchParams.set('nl', '1');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
        const response = await fetch(url.toString(), {
            cache: 'no-store',
            credentials: 'omit',
            redirect: 'follow',
            signal: controller.signal
        });
        if (!response.ok) throw new Error(`Description request failed with HTTP ${response.status}.`);

        const html = await response.text();
        const jobPosting = extractJobPostingJsonLd(html);
        if (!jobPosting) throw new Error('No JobPosting JSON-LD was found on the job page.');

        return formatJobPostingDescription(jobPosting);
    } catch (error) {
        if (error?.name === 'AbortError') throw new Error('Description request timed out.');
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

function queueJobDescriptionFetch(request) {
    const queuedFetch = descriptionFetchChain.then(() => fetchJobDescriptionDirectly(request));
    descriptionFetchChain = queuedFetch.catch(() => {});
    return queuedFetch;
}

async function findIframeAndInjectContentScript(tabId) {
    let iframeSrcResult;
    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId: tabId, frameIds: [0] },
            function: (iframeIdArg) => {
                const iframe = document.getElementById(iframeIdArg);
                return iframe ? iframe.src : null;
            },
            args: [IFRAME_ID]
        });
        iframeSrcResult = results[0]?.result;
    } catch (e) { return null; }
    if (!iframeSrcResult) return null;
    let frames = await chrome.webNavigation.getAllFrames({ tabId: tabId });
    const targetFrame = frames.find(frame => frame.url && frame.url.includes(IFRAME_PARTIAL_SRC));
    if (!targetFrame) return null;
    currentIframeFrameId = targetFrame.frameId;
    try {
        await chrome.scripting.executeScript({
            target: { tabId: tabId, frameIds: [currentIframeFrameId] },
            files: ['content.js']
        });
    } catch (e) { return null; }
    return currentIframeFrameId;
}

async function fetchDetailsAsync(url) {
    return new Promise((resolve) => {
        if (!url) { resolve([]); return; }
        let finalUrl = url;
        try {
            const urlObj = new URL(url);
            if (urlObj.hostname.includes('jobvite.com')) {
                urlObj.searchParams.set('nl', '1');
                finalUrl = urlObj.toString();
            }
        } catch (e) { resolve([]); return; }
        chrome.tabs.create({ url: finalUrl, active: false }, (tab) => {
            if (!tab) { resolve([]); return; }
            const listener = (tabId, info) => {
                if (tabId === tab.id && info.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(listener);
                    setTimeout(() => {
                        chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['detail-extractor.js'] })
                        .then((results) => {
                            chrome.tabs.remove(tab.id).catch(() => {});
                            resolve(results?.[0]?.result || []);
                        }).catch(() => {
                            chrome.tabs.remove(tab.id).catch(() => {});
                            resolve([]);
                        });
                    }, 3000);
                }
            };
            chrome.tabs.onUpdated.addListener(listener);
        });
    });
}

async function scrapeAndGoToNext() {
    if (!isScraping) return;
    currentPage++;
    sendStatusToPopup('in_progress', `Scraping page ${currentPage}...`, allScrapedJobs.length);
    let scrapedJobsOnPage;
    try {
        const response = await chrome.tabs.sendMessage(currentTabId, { action: 'scrapeCurrentPage' }, { frameId: currentIframeFrameId });
        scrapedJobsOnPage = response?.jobs || [];
    } catch (e) {
        isScraping = false;
        sendStatusToPopup('error', `Error scraping page ${currentPage}: ${e.message}`);
        return;
    }

    if (scrapedJobsOnPage.length > 0) {
        for (const job of scrapedJobsOnPage) {
            if (!isScraping) break;
            if (isExcludedJobListing(job)) continue;
            if (job.link && !uniqueJobLinks.has(job.link)) {
                // Just add the job without fetching details
                allScrapedJobs.push(job);
                uniqueJobLinks.add(job.link);
            }
        }
        await chrome.storage.local.set({ scrapedJobs: allScrapedJobs });
    }

    let clickedNext = false;
    try {
        const response = await chrome.tabs.sendMessage(currentTabId, { action: 'clickNextPage' }, { frameId: currentIframeFrameId });
        clickedNext = response?.clicked || false;
    } catch (e) { isScraping = false; return; }

    if (!clickedNext) {
        isScraping = false;
        sendStatusToPopup('completed', `Scraping completed! Found ${allScrapedJobs.length} jobs. Use "View Records" to see them and click "Fetch Details" to get additional information.`, allScrapedJobs.length);
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startScraping') {
    handleStartScraping(sendResponse);
    return true;
  } else if (request.action === 'stopScraping') {
    isScraping = false;
    sendResponse({ status: 'stopped' });
  } else if (request.action === 'fetchJobDescription') {
    queueJobDescriptionFetch(request)
      .then(description => sendResponse({ ok: true, description }))
      .catch(error => sendResponse({ ok: false, description: '', error: error.message || 'Unable to fetch description.' }));
    return true;
  } else if (request.action === 'fetchJobDetails') {
    handleFetchDetails(request);
    return true;
  }
});

async function handleStartScraping(sendResponse) {
    if (isScraping) { sendResponse({ status: 'alreadyScraping' }); return; }
    let activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTabId = activeTabs[0]?.id;
    if (!currentTabId) { sendResponse({ status: 'error', message: 'No active tab found.' }); return; }

    isScraping = true;
    currentPage = 0;
    allScrapedJobs = [];
    uniqueJobLinks = new Set();

    sendStatusToPopup('scraping', 'Applying filters and searching...');
    const iframeFrameId = await findIframeAndInjectContentScript(currentTabId);
    if (!iframeFrameId) {
        isScraping = false;
        sendStatusToPopup('error', 'Failed to find job listings iframe.');
        return;
    }

    try {
        const result = await chrome.scripting.executeScript({
            target: { tabId: currentTabId, frameIds: [iframeFrameId] },
            func: () => {
                const categorySelect = document.getElementById('jv-search-category');
                const jobTypeSelect = document.getElementById('jv-search-type');
                const searchButton = document.querySelector('.jv-search-form .jv-button-primary');

                if (!categorySelect || !jobTypeSelect || !searchButton) {
                    return { success: false, message: 'Could not find filter elements' };
                }

                // Select Category options
                const targetCategories = ["Specialty Diplomate", "Surgeon Diplomate", "Veterinarian (ER)", "Veterinarian (Gen Practice)"];
                let categoryCount = 0;
                Array.from(categorySelect.options).forEach(opt => {
                    const val = opt.value.trim();
                    const txt = opt.text.trim();
                    if (targetCategories.includes(val) || targetCategories.includes(txt)) {
                        opt.selected = true;
                        categoryCount++;
                    }
                });
                categorySelect.dispatchEvent(new Event('change', { bubbles: true }));

                // Select Job Type options
                const targetJobTypes = ["Full-Time", "Part Time or Full Time", "Part-Time"];
                let jobTypeCount = 0;
                Array.from(jobTypeSelect.options).forEach(opt => {
                    const val = opt.value.trim();
                    const txt = opt.text.trim();
                    if (targetJobTypes.includes(val) || targetJobTypes.includes(txt)) {
                        opt.selected = true;
                        jobTypeCount++;
                    }
                });
                jobTypeSelect.dispatchEvent(new Event('change', { bubbles: true }));

                // Click search button
                searchButton.click();

                return {
                    success: true,
                    message: 'Filters applied and search initiated',
                    categoryCount: categoryCount,
                    jobTypeCount: jobTypeCount
                };
            }
        });

        const filterResult = result?.[0]?.result;
        if (filterResult?.success) {
            sendStatusToPopup('scraping', 'Filters applied, waiting for results to load...', 0);
            // Wait for page to load, then wait 3 more seconds, then start scraping
            setTimeout(async () => {
                const newIframeId = await findIframeAndInjectContentScript(currentTabId);
                if (newIframeId) {
                    sendStatusToPopup('scraping', 'Starting to scrape jobs...', 0);
                    scrapeAndGoToNext();
                } else {
                    isScraping = false;
                    sendStatusToPopup('error', 'Failed to re-initialize scraping after search.');
                }
            }, 7000); // 4 seconds for page load + 3 seconds additional wait
        } else {
            isScraping = false;
            sendStatusToPopup('error', filterResult?.message || 'Failed to apply filters');
        }
    } catch (e) {
        isScraping = false;
        sendStatusToPopup('error', 'Error applying filters: ' + e.message);
    }

    sendResponse({ status: 'scrapingStarted' });
}

async function handleFetchDetails(request) {
    const { url, jobIndex } = request;
    const detailsList = await fetchDetailsAsync(url);
    chrome.runtime.sendMessage({ action: 'detailsFetched', details: detailsList, jobIndex: jobIndex }).catch(() => {});
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    // Continue scraping on page load when in scraping mode and pagination is active
    if (tabId === currentTabId && changeInfo.status === 'complete' && isScraping && currentPage > 0) {
        const iframeFrameId = await findIframeAndInjectContentScript(tabId);
        if (iframeFrameId) {
            // Wait 3 seconds before scraping next page
            setTimeout(scrapeAndGoToNext, 3000);
        }
    }
});
