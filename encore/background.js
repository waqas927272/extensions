// background.js
let isScraping = false;
let currentTabId = null;
let currentIframeFrameId = null;
let currentPage = 0;
let allScrapedJobs = [];
let uniqueJobLinks = new Set();
let descriptionRunPromise = null;
let descriptionRunState = {
    active: false,
    total: 0,
    completed: 0,
    failed: 0,
    currentJobId: ''
};

const DESCRIPTION_DIRECT_FETCH_TIMEOUT_MS = 15000;
const DESCRIPTION_FETCH_MAX_ATTEMPTS = 2;

const IFRAME_ID = "jv_careersite_iframe_id";
const IFRAME_PARTIAL_SRC = "jobs.jobvite.com/unitedveterinarycare/";
function isExcludedJobListing(job) {
    const title = (job?.title || '').toLowerCase();
    if (!title) return false;
    if (/\bmentor(?:ship|ing|ed|s)?\b|\blocum(?:s)?\b|\brelie(?:f|ver|vers)\b|\breleif\b/.test(title)) return true;
    if (/\bcustomer service representative\b/.test(title)) return true;
    if (/\btechnician\b/.test(title)) return true;
    if (/\bfield marketing specialist\b/.test(title)) return true;
    if (/\bfield support\b/.test(title)) return true;
    if (/\banimal care attendant\b/.test(title)) return true;
    if (/\bpractice manager\b/.test(title)) return true;
    if (/\bkennel\b/.test(title)) return true;
    if (/\bveterinary assistant\b/.test(title)) return true;
    if (/\bextern\b/.test(title)) return true;
    if (/\bgroomer\b/.test(title)) return true;
    return false;
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
    } catch (e) { iframeSrcResult = null; }
    if (!iframeSrcResult) {
        // Encore-style pages run in top frame (no Jobvite iframe)
        currentIframeFrameId = 0;
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tabId, frameIds: [0] },
                files: ['content.js']
            });
            return 0;
        } catch (e) { return null; }
    }
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

function cleanDescriptionText(value) {
    return String(value || '')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function decodeDescriptionHtmlEntities(value) {
    const namedEntities = {
        nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
        rsquo: '\u2019', lsquo: '\u2018', rdquo: '\u201d', ldquo: '\u201c',
        ndash: '\u2013', mdash: '\u2014', hellip: '\u2026', bull: '\u2022',
        middot: '\u00b7', copy: '\u00a9', reg: '\u00ae', trade: '\u2122'
    };
    let decoded = String(value || '');

    // Decode twice because feeds occasionally double-encode values such as
    // &amp;rsquo;. Unknown entities are preserved rather than silently removed.
    for (let pass = 0; pass < 2; pass++) {
        decoded = decoded
            .replace(/&([a-z][a-z0-9]+);/gi, (entity, name) => namedEntities[name.toLowerCase()] ?? entity)
            .replace(/&#(\d+);/g, (entity, code) => {
                const value = Number(code);
                return Number.isInteger(value) && value >= 0 && value <= 0x10ffff
                    ? String.fromCodePoint(value)
                    : entity;
            })
            .replace(/&#x([0-9a-f]+);/gi, (entity, code) => {
                const value = parseInt(code, 16);
                return Number.isInteger(value) && value >= 0 && value <= 0x10ffff
                    ? String.fromCodePoint(value)
                    : entity;
            });
    }
    return decoded;
}

function descriptionHtmlToText(value) {
    return cleanDescriptionText(
        decodeDescriptionHtmlEntities(value)
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/(?:p|div|li|h[1-6]|section|ul|ol)>/gi, '\n')
            .replace(/<li[^>]*>/gi, '- ')
            .replace(/<[^>]+>/g, ' ')
    );
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
    return findJobPostingJsonLd(value['@graph']);
}

function extractJobPostingJsonLd(html) {
    // Some Encore pages contain a literal <script> tag inside an earlier script
    // block. Starting from every generic script tag makes that outer match consume
    // the JSON-LD opening tag. Match the JSON-LD opening tag itself instead.
    const scriptPattern = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match;

    while ((match = scriptPattern.exec(html || '')) !== null) {
        try {
            const jobPosting = findJobPostingJsonLd(JSON.parse(match[1] || ''));
            if (jobPosting) return jobPosting;
        } catch (_) {
            // Ignore malformed JSON-LD and continue to the next block.
        }
    }
    return null;
}

function getJobPostingLocations(jobPosting) {
    const locations = Array.isArray(jobPosting?.jobLocation)
        ? jobPosting.jobLocation
        : (jobPosting?.jobLocation ? [jobPosting.jobLocation] : []);

    return locations
        .map(location => location?.address || location || {})
        .map(address => ({
            city: cleanDescriptionText(address.addressLocality),
            state: cleanDescriptionText(address.addressRegion),
            country: cleanDescriptionText(address.addressCountry),
            zipCode: cleanDescriptionText(address.postalCode)
        }))
        .filter(location => location.city || location.state || location.country || location.zipCode);
}

function formatJobPostingSalary(baseSalary) {
    const value = baseSalary?.value || {};
    const min = value.minValue ?? value.value ?? '';
    const max = value.maxValue ?? '';
    if (min === '' && max === '') return '';

    const numericMin = Number(String(min).replace(/,/g, ''));
    const numericMax = Number(String(max).replace(/,/g, ''));
    if ((!Number.isFinite(numericMin) || numericMin <= 0) &&
        (!Number.isFinite(numericMax) || numericMax <= 0)) {
        return '';
    }

    const currencyCode = cleanDescriptionText(baseSalary?.currency || value.currency || 'USD');
    const currency = currencyCode.toUpperCase() === 'USD' ? '$' : `${currencyCode} `;
    const unit = cleanDescriptionText(value.unitText || baseSalary?.unitText || '');
    const amount = max !== '' ? `${currency}${min} - ${currency}${max}` : `${currency}${min}`;
    return `${amount}${unit ? ` ${unit}` : ''}`;
}

function extractEncoreCategoriesFromHtml(html) {
    const configStart = (html || '').indexOf('window.jobDescriptionConfig');
    const source = configStart >= 0 ? html.slice(configStart) : (html || '');
    const match = /"category"\s*:\s*(\[[\s\S]*?\])/i.exec(source);
    if (!match) return [];

    try {
        return JSON.parse(match[1])
            .map(category => cleanDescriptionText(category))
            .filter(category => category && !/^(?:unavailable|unknown|n\/?a)$/i.test(category));
    } catch (_) {
        return [];
    }
}

function formatDescriptionEmploymentType(value) {
    return cleanDescriptionText(Array.isArray(value) ? value.join(', ') : value)
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/\b\w/g, letter => letter.toUpperCase());
}

function extractSalaryFromDescription(descriptionHtml) {
    const text = descriptionHtmlToText(descriptionHtml);
    const match = text.match(
        /(?:base salary range is(?:\s+from)?|pay range)\s*(?:USD\s*)?\$?\s*([\d,]+(?:\.\d{1,2})?)\s*(?:-|\u2013|\u2014|to)\s*(?:USD\s*)?\$?\s*([\d,]+(?:\.\d{1,2})?)(?:\s*(?:\/|per)\s*(yr|year|hr|hour))?/i
    );
    if (!match) return '';

    const minimum = Number(match[1].replace(/,/g, ''));
    const maximum = Number(match[2].replace(/,/g, ''));
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum <= 0 || maximum <= 0) return '';

    const unit = match[3]
        ? (/^(?:hr|hour)$/i.test(match[3]) ? 'HOUR' : 'YEAR')
        : (minimum >= 1000 ? 'YEAR' : '');
    const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
    return `$${numberFormat.format(minimum)} - $${numberFormat.format(maximum)}${unit ? ` ${unit}` : ''}`;
}

function formatJobPostingDescription(jobPosting, pageCategories = []) {
    const locations = getJobPostingLocations(jobPosting);
    const employmentType = formatDescriptionEmploymentType(jobPosting.employmentType);
    const sourceCategory = cleanDescriptionText(jobPosting.industry || jobPosting.occupationalCategory);
    const category = /^(?:unavailable|unknown|n\/?a)$/i.test(sourceCategory)
        ? pageCategories.join(', ')
        : sourceCategory;
    const lines = [
        '=== JOB POSTING DATA ===',
        `Title: ${cleanDescriptionText(jobPosting.title)}`,
        `Date Posted: ${cleanDescriptionText(jobPosting.datePosted)}`,
        `Industry/Category: ${category}`,
        `Employment Type: ${employmentType}`,
        `Hiring Organization: ${cleanDescriptionText(jobPosting.hiringOrganization?.name)}`
    ];

    if (locations.length > 0) {
        lines.push(
            'Locations:',
            ...locations.map(location => `  - ${[location.city, location.state, location.country].filter(Boolean).join(', ')}`)
        );
    }

    const salary = formatJobPostingSalary(jobPosting.baseSalary)
        || extractSalaryFromDescription(jobPosting.description);
    if (salary) lines.push(`Salary Range: ${salary}`);

    const body = descriptionHtmlToText(jobPosting.description);
    if (body) lines.push('', '=== FULL JOB DESCRIPTION ===', body);

    return cleanDescriptionText(lines.join('\n'));
}

function extractHtmlByClass(html, tagName, className) {
    const pattern = new RegExp(
        `<${tagName}\\b[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/${tagName}>`,
        'i'
    );
    return pattern.exec(html || '')?.[1] || '';
}

function extractJobviteDescriptionBlock(html) {
    const openingTag = /<(?:div|section)\b[^>]*class=["'][^"']*\bjv-job-detail-description\b[^"']*["'][^>]*>/i.exec(html || '');
    if (!openingTag || openingTag.index === undefined) return '';

    const contentStart = openingTag.index + openingTag[0].length;
    const remainingHtml = html.slice(contentStart);
    const boundaryPatterns = [
        /<(?:div|section)\b[^>]*class=["'][^"']*\bjv-job-detail-bottom-actions\b/i,
        /<(?:div|section)\b[^>]*class=["'][^"']*\bjv-share-widget\b/i,
        /<\/article>/i
    ];
    const boundaryOffsets = boundaryPatterns
        .map(pattern => pattern.exec(remainingHtml)?.index)
        .filter(offset => Number.isInteger(offset));
    const contentEnd = boundaryOffsets.length > 0 ? Math.min(...boundaryOffsets) : remainingHtml.length;

    return remainingHtml.slice(0, contentEnd);
}

function formatJobviteHtmlDescription(html) {
    const descriptionBlock = extractJobviteDescriptionBlock(html);
    const body = descriptionHtmlToText(descriptionBlock)
        .replace(/^Description\s*/i, '')
        .trim();
    if (!body) return '';

    const title = descriptionHtmlToText(extractHtmlByClass(html, 'h2', 'jv-header'));
    const meta = descriptionHtmlToText(extractHtmlByClass(html, 'p', 'jv-job-detail-meta'));
    const hospitalMatch = /<em\b[^>]*>\s*Position at\s+([\s\S]*?)<\/em>/i.exec(descriptionBlock);
    const hospital = descriptionHtmlToText(hospitalMatch?.[1] || '');
    const lines = [
        '=== JOB POSTING DATA ===',
        `Title: ${title}`,
        `Hospital: ${hospital}`,
        `Category/Location: ${meta}`,
        '',
        '=== FULL JOB DESCRIPTION ===',
        body
    ];

    return cleanDescriptionText(lines.join('\n'));
}

function hasUsableDescription(description) {
    const text = cleanDescriptionText(description);
    if (!text) return false;
    if (/^(?:description not found|error (?:scraping|fetching) description|timeout fetching description)/i.test(text)) return false;
    if (/&(?:nbsp|rsquo|lsquo|rdquo|ldquo|ndash|mdash|hellip);/i.test(text)) return false;
    if (/^Industry\/Category:\s*(?:unavailable|unknown|n\/?a)\s*$/im.test(text)) return false;
    if (/^Salary Range:\s*\$?0(?:\.0+)?\s*-\s*\$?0(?:\.0+)?\b/im.test(text)) return false;
    return /=== FULL JOB DESCRIPTION ===/i.test(text) || text.length >= 100;
}

async function fetchDescriptionDirectly(request) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DESCRIPTION_DIRECT_FETCH_TIMEOUT_MS);

    try {
        const response = await fetch(request.url, {
            cache: 'no-store',
            credentials: 'omit',
            redirect: 'follow',
            signal: controller.signal
        });
        if (!response.ok) throw new Error(`Direct fetch failed with HTTP ${response.status}`);

        const html = await response.text();
        const jobPosting = extractJobPostingJsonLd(html);
        const pageCategories = extractEncoreCategoriesFromHtml(html);
        let description = jobPosting ? formatJobPostingDescription(jobPosting, pageCategories) : '';
        if (!hasUsableDescription(description)) {
            description = formatJobviteHtmlDescription(html);
        }
        if (!hasUsableDescription(description)) {
            throw new Error('Direct fetch did not find a usable description');
        }
        return description;
    } finally {
        clearTimeout(timeout);
    }
}

async function fetchEncoreJobDescription(request) {
    return fetchDescriptionDirectly(request);
}

function getBackgroundDescriptionJobKey(job = {}) {
    return [
        String(job.jobId || '').trim(),
        String(job.link || '').trim(),
        String(job.title || '').trim(),
        String(job.hospital || '').trim(),
        String(job.location || '').trim()
    ].join('|');
}

function findBackgroundDescriptionJobIndex(jobs, queueItem) {
    const byKey = jobs.findIndex(job => getBackgroundDescriptionJobKey(job) === queueItem.key);
    if (byKey !== -1) return byKey;
    return jobs.findIndex(job => job.link && job.link === queueItem.link);
}

function broadcastDescriptionRunState(action, extra = {}) {
    chrome.runtime.sendMessage({
        action,
        ...descriptionRunState,
        ...extra
    }).catch(() => {});
}

async function runBackgroundDescriptionScrape() {
    const initialData = await chrome.storage.local.get(['scrapedJobs']);
    const initialJobs = initialData.scrapedJobs || [];
    const queue = initialJobs
        .filter(job => job.link && !hasUsableDescription(job.description))
        .map(job => ({
            key: getBackgroundDescriptionJobKey(job),
            link: job.link,
            jobId: job.jobId || '',
            title: job.title || ''
        }));

    descriptionRunState = {
        active: true,
        total: queue.length,
        completed: 0,
        failed: 0,
        currentJobId: ''
    };
    broadcastDescriptionRunState('descriptionRunStarted');

    try {
        for (const queueItem of queue) {
            descriptionRunState.currentJobId = queueItem.jobId || queueItem.title || '';
            broadcastDescriptionRunState('descriptionRunProgress');

            let saved = false;
            let lastError = null;

            for (let attempt = 1; attempt <= DESCRIPTION_FETCH_MAX_ATTEMPTS && !saved; attempt++) {
                try {
                    const currentData = await chrome.storage.local.get(['scrapedJobs']);
                    const jobs = currentData.scrapedJobs || [];
                    const jobIndex = findBackgroundDescriptionJobIndex(jobs, queueItem);
                    if (jobIndex === -1) {
                        throw new Error('Job record no longer exists');
                    }

                    const jobUrl = new URL(jobs[jobIndex].link);
                    jobUrl.searchParams.set('nl', '1');
                    const description = await fetchEncoreJobDescription({
                        url: jobUrl.toString(),
                        jobId: jobs[jobIndex].jobId || '',
                        title: jobs[jobIndex].title || ''
                    });
                    if (!hasUsableDescription(description)) {
                        throw new Error('Description not found');
                    }

                    jobs[jobIndex].description = description;
                    await chrome.storage.local.set({ scrapedJobs: jobs });
                    saved = true;
                } catch (error) {
                    lastError = error;
                    console.warn(
                        `Description attempt ${attempt}/${DESCRIPTION_FETCH_MAX_ATTEMPTS} failed for ${queueItem.link}:`,
                        error.message || error
                    );
                }
            }

            descriptionRunState.completed++;
            if (!saved) descriptionRunState.failed++;
            broadcastDescriptionRunState('descriptionRunProgress', {
                saved,
                error: saved ? '' : (lastError?.message || 'Error fetching description')
            });
        }
    } finally {
        descriptionRunState.active = false;
        descriptionRunState.currentJobId = '';
        broadcastDescriptionRunState('descriptionRunCompleted');
    }

    return { ...descriptionRunState };
}

function startBackgroundDescriptionScrape() {
    if (!descriptionRunPromise) {
        descriptionRunPromise = runBackgroundDescriptionScrape()
            .finally(() => {
                descriptionRunPromise = null;
            });
    }
    return descriptionRunPromise;
}

async function scrapeAndGoToNext() {
    if (!isScraping) return;
    currentPage++;
    sendStatusToPopup('in_progress', `Scraping page ${currentPage}...`, allScrapedJobs.length);
    let scrapedJobsOnPage;
    try {
        const response = await chrome.tabs.sendMessage(
            currentTabId,
            { action: 'scrapeCurrentPage' },
            currentIframeFrameId === 0 ? undefined : { frameId: currentIframeFrameId }
        );
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
        const response = await chrome.tabs.sendMessage(
            currentTabId,
            { action: 'clickNextPage' },
            currentIframeFrameId === 0 ? undefined : { frameId: currentIframeFrameId }
        );
        clickedNext = response?.clicked || false;
    } catch (e) { isScraping = false; return; }

    if (!clickedNext) {
        isScraping = false;
        sendStatusToPopup('completed', `Scraping completed! Found ${allScrapedJobs.length} jobs. Use "View Records" to see them and click "Fetch Details" to get additional information.`, allScrapedJobs.length);
    } else if (currentIframeFrameId === 0) {
        // Encore-style pagination is client-side and may not trigger full tab reload.
        setTimeout(scrapeAndGoToNext, 2200);
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startScraping') {
    handleStartScraping(sendResponse);
    return true;
  } else if (request.action === 'stopScraping') {
    isScraping = false;
    sendResponse({ status: 'stopped' });
  } else if (request.action === 'startBackgroundDescriptionScrape') {
    startBackgroundDescriptionScrape()
      .then(state => sendResponse({ status: 'completed', ...state }))
      .catch(error => sendResponse({ status: 'error', message: error.message || String(error) }));
    return true;
  } else if (request.action === 'getBackgroundDescriptionState') {
    sendResponse({ ...descriptionRunState });
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

    sendStatusToPopup('scraping', 'Starting to scrape jobs...');
    const iframeFrameId = await findIframeAndInjectContentScript(currentTabId);
    if (iframeFrameId === null || iframeFrameId === undefined) {
        isScraping = false;
        sendStatusToPopup('error', 'Failed to find job listings iframe.');
        return;
    }

    // Top-frame mode (Encore listing): apply category filters before scraping.
    if (iframeFrameId === 0) {
        try {
            sendStatusToPopup('scraping', 'Applying category filters...', 0);
            const filterResult = await chrome.tabs.sendMessage(currentTabId, { action: 'applyFiltersAndSearch' });

            if (!filterResult?.success) {
                isScraping = false;
                sendStatusToPopup('error', filterResult?.message || 'Failed to apply category filters.');
                sendResponse({ status: 'error', message: filterResult?.message || 'Failed to apply category filters.' });
                return;
            }

            sendStatusToPopup('scraping', 'Filters applied, waiting for results to load...', 0);
            setTimeout(() => {
                sendStatusToPopup('scraping', 'Starting to scrape jobs...', 0);
                scrapeAndGoToNext();
            }, 5000);
        } catch (e) {
            isScraping = false;
            sendStatusToPopup('error', 'Error applying filters: ' + e.message);
            sendResponse({ status: 'error', message: e.message });
            return;
        }

        sendResponse({ status: 'scrapingStarted' });
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

