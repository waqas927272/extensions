// background.js
importScripts('smartrecruiters-posting.js');

const smartRecruitersPosting = globalThis.AAHSmartRecruitersPosting;
let isScraping = false;
let currentTabId = null;
let currentPage = 0;
let allScrapedJobs = [];
let uniqueJobLinks = new Set();
let totalJobsSeen = 0;
let skippedJobsTotal = 0;
let skippedJobCounts = {};
let descriptionFetchQueue = Promise.resolve();

async function injectContentScript(tabId) {
    try {
        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content.js']
        });
        return true;
    } catch (e) {
        return false;
    }
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

function trackSkippedJobs(skippedJobs = []) {
    skippedJobs.forEach(job => {
        const reason = job?.reason || 'unknown';
        skippedJobCounts[reason] = (skippedJobCounts[reason] || 0) + 1;
        skippedJobsTotal++;
    });
}

function buildCompletionMessage() {
    const summary = getScrapingSummary();
    const skippedLines = summary.skippedByKeyword
        .map(item => `${item.count} - ${item.keyword}`);

    const skippedSummary = skippedLines.length
        ? `\n\nSkipped title keywords:\n${skippedLines.join('\n')}`
        : '\n\nSkipped title keywords: none';

    return [
        'Scraping completed!',
        `Total jobs: ${summary.totalJobs}`,
        `Skipped jobs: ${summary.skippedJobs}`,
        `Scraped jobs: ${summary.scrapedJobs}`,
        skippedSummary,
        '\nUse "View Records" to see them and click "Fetch Details" to get additional information.'
    ].join('\n');
}

function getScrapingSummary() {
    const skippedLines = Object.entries(skippedJobCounts)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([keyword, count]) => ({ keyword, count }));

    return {
        totalJobs: totalJobsSeen,
        skippedJobs: skippedJobsTotal,
        scrapedJobs: allScrapedJobs.length,
        skippedByKeyword: skippedLines,
        completedAt: new Date().toISOString()
    };
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
                        chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['description-address.js', 'detail-extractor.js'] })
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
        const response = await chrome.tabs.sendMessage(currentTabId, { action: 'scrapeCurrentPage' });
        scrapedJobsOnPage = response?.jobs || [];
        const skippedJobsOnPage = response?.skippedJobs || [];
        totalJobsSeen += Number.isFinite(response?.totalJobs)
            ? response.totalJobs
            : scrapedJobsOnPage.length + skippedJobsOnPage.length;
        trackSkippedJobs(skippedJobsOnPage);
    } catch (e) {
        isScraping = false;
        sendStatusToPopup('error', `Error scraping page ${currentPage}: ${e.message}`);
        return;
    }

    if (scrapedJobsOnPage.length > 0) {
        for (const job of scrapedJobsOnPage) {
            if (!isScraping) break;
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
        const response = await chrome.tabs.sendMessage(currentTabId, { action: 'clickNextPage' });
        clickedNext = response?.clicked || false;
    } catch (e) { isScraping = false; return; }

    if (!clickedNext) {
        isScraping = false;
        await chrome.storage.local.set({ scrapingSummary: getScrapingSummary() });
        sendStatusToPopup('completed', buildCompletionMessage(), allScrapedJobs.length);
    } else {
        setTimeout(scrapeAndGoToNext, 2000);
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startScraping') {
    handleStartScraping(sendResponse);
    return true;
  } else if (request.action === 'stopScraping') {
    isScraping = false;
    sendResponse({ status: 'stopped' });
  } else if (request.action === 'fetchJobDescription' || request.action === 'scrapeJobDescription') {
    enqueueDescriptionFetch(request).then(sendResponse);
    return true;
  } else if (request.action === 'fetchJobPostingMetadata') {
    fetchJobDescriptionDirectly(request)
      .then(description => sendResponse({ ok: true, description }))
      .catch(error => sendResponse({ ok: false, error: error?.message || 'Failed to fetch job metadata.' }));
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
    totalJobsSeen = 0;
    skippedJobsTotal = 0;
    skippedJobCounts = {};
    await chrome.storage.local.remove('scrapingSummary');

    sendStatusToPopup('scraping', 'Initializing scraper...');
    const injected = await injectContentScript(currentTabId);
    if (!injected) {
        isScraping = false;
        sendStatusToPopup('error', 'Failed to inject scraper into the active page.');
        return;
    }

    sendStatusToPopup('scraping', 'Selecting DVM Career Opportunities and waiting 5 seconds...', 0);
    try {
        const filterResponse = await chrome.tabs.sendMessage(currentTabId, {
            action: 'prepareJobTypeFilter',
            targetLabel: 'DVM Career Opportunities'
        });

        if (!filterResponse?.success) {
            isScraping = false;
            sendStatusToPopup('error', filterResponse?.error || 'Failed to select DVM Career Opportunities.');
            sendResponse({ status: 'error', message: filterResponse?.error || 'Failed to select DVM Career Opportunities.' });
            return;
        }
    } catch (e) {
        isScraping = false;
        sendStatusToPopup('error', `Failed to select DVM Career Opportunities: ${e.message}`);
        sendResponse({ status: 'error', message: e.message });
        return;
    }

    if (!isScraping) {
        sendResponse({ status: 'stopped' });
        return;
    }

    sendStatusToPopup('scraping', 'Starting to scrape jobs...', 0);
    scrapeAndGoToNext();
    sendResponse({ status: 'scrapingStarted' });
}

function cleanDirectDescriptionText(value) {
    return String(value || '')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function decodeDirectDescriptionEntities(value) {
    return String(value || '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&#x27;/gi, "'")
        .replace(/&#x2f;/gi, '/')
        .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
        .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function directDescriptionHtmlToText(value) {
    return cleanDirectDescriptionText(
        decodeDirectDescriptionEntities(value)
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<li\b[^>]*>/gi, '- ')
            .replace(/<\/(?:p|div|li|h[1-6]|section|article|ul|ol|table|tr)>/gi, '\n')
            .replace(/<[^>]+>/g, ' ')
    );
}

function collectDirectJobPostings(value, results = []) {
    if (!value) return results;
    if (Array.isArray(value)) {
        value.forEach(item => collectDirectJobPostings(item, results));
        return results;
    }
    if (typeof value !== 'object') return results;

    const type = value['@type'];
    if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) {
        results.push(value);
    }
    if (value['@graph']) collectDirectJobPostings(value['@graph'], results);
    return results;
}

function extractDirectJobPosting(html, expectedTitle = '') {
    const postings = [];
    const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    let match;

    while ((match = scriptPattern.exec(html || '')) !== null) {
        if (!/type\s*=\s*["']application\/ld\+json["']/i.test(match[1] || '')) continue;
        try {
            const source = (match[2] || '').replace(/^\s*<!--|-->\s*$/g, '').trim();
            collectDirectJobPostings(JSON.parse(source), postings);
        } catch (_) {
            // Ignore invalid JSON-LD and continue looking for another block.
        }
    }

    if (postings.length <= 1 || !expectedTitle) return postings[0] || null;
    const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const expected = normalize(expectedTitle);
    return postings.find(posting => {
        const title = normalize(posting.title);
        return title === expected || title.includes(expected) || expected.includes(title);
    }) || postings[0];
}

function directCountryName(value) {
    if (typeof value === 'object' && value) return value.name || value.code || '';
    return value || '';
}

function formatDirectDescriptionAddress(address) {
    if (!address || typeof address !== 'object') return '';
    const stateZip = [address.addressRegion || '', address.postalCode || ''].filter(Boolean).join(' ');
    return [address.streetAddress || '', address.addressLocality || '', stateZip, directCountryName(address.addressCountry)]
        .filter(Boolean)
        .map(cleanDirectDescriptionText)
        .join(', ');
}

function formatDirectDescriptionSalary(baseSalary) {
    if (!baseSalary) return '';
    const value = baseSalary.value || baseSalary;
    const currency = baseSalary.currency || value.currency || 'USD';
    const unit = value.unitText || baseSalary.unitText || '';
    const min = value.minValue ?? '';
    const max = value.maxValue ?? '';
    const single = value.value ?? ((typeof value === 'number' || typeof value === 'string') ? value : '');
    if (min !== '' || max !== '') return `${currency}${min} - ${max} ${unit}`.trim();
    if (single !== '') return `${currency}${single} ${unit}`.trim();
    return '';
}

function formatDirectJobDescription(jobPosting) {
    if (!jobPosting) return '';

    const lines = [
        '=== JOB POSTING DATA ===',
        `Title: ${cleanDirectDescriptionText(jobPosting.title || '')}`,
        `Date Posted: ${cleanDirectDescriptionText(jobPosting.datePosted || '')}`,
        `Industry/Category: ${cleanDirectDescriptionText(jobPosting.industry || jobPosting.occupationalCategory || '')}`
    ];
    const employmentType = Array.isArray(jobPosting.employmentType)
        ? jobPosting.employmentType.join(', ')
        : (jobPosting.employmentType || '');
    lines.push(`Employment Type: ${cleanDirectDescriptionText(employmentType)}`);

    if (jobPosting.hiringOrganization?.name) {
        lines.push(`Hiring Organization: ${cleanDirectDescriptionText(jobPosting.hiringOrganization.name)}`);
    }

    const locations = Array.isArray(jobPosting.jobLocation)
        ? jobPosting.jobLocation
        : (jobPosting.jobLocation ? [jobPosting.jobLocation] : []);
    if (locations.length) {
        lines.push('Locations:');
        for (const location of locations) {
            const address = location?.address || location || {};
            const cityLine = [address.addressLocality || '', address.addressRegion || '', directCountryName(address.addressCountry)]
                .filter(Boolean)
                .map(cleanDirectDescriptionText)
                .join(', ');
            if (cityLine) lines.push(`  - ${cityLine}`);
            const fullAddress = formatDirectDescriptionAddress(address);
            if (fullAddress) lines.push(fullAddress);
        }
    }

    const salary = formatDirectDescriptionSalary(jobPosting.baseSalary);
    if (salary) lines.push(`Salary Range: ${salary}`);

    const description = directDescriptionHtmlToText(jobPosting.description || '');
    if (description) lines.push('', '=== FULL JOB DESCRIPTION ===', description);
    return cleanDirectDescriptionText(lines.join('\n'));
}

function extractDirectDescriptionFallback(html) {
    const candidates = [];
    const blockPattern = /<(div|section|article)\b([^>]*(?:itemprop\s*=\s*["']description["']|class\s*=\s*["'][^"']*(?:job[^"']*description|description[^"']*job|jobad-content)[^"']*["'])[^>]*)>([\s\S]*?)<\/\1>/gi;
    let match;
    while ((match = blockPattern.exec(html || '')) !== null) {
        const text = directDescriptionHtmlToText(match[3]);
        if (text.length >= 50) candidates.push(text);
    }

    let description = candidates.sort((a, b) => b.length - a.length)[0] || '';
    if (!description) {
        const bodyMatch = String(html || '').match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
        const body = String(bodyMatch?.[1] || '')
            .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
            .replace(/<(?:nav|header|footer)\b[^>]*>[\s\S]*?<\/(?:nav|header|footer)>/gi, ' ');
        description = directDescriptionHtmlToText(body);
    }
    if (description.length < 50) return '';

    const titleMatch = String(html || '').match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
    const title = titleMatch ? directDescriptionHtmlToText(titleMatch[1]) : '';
    const lines = ['=== JOB POSTING DATA ==='];
    if (title) lines.push(`Title: ${title}`);
    lines.push('', '=== FULL JOB DESCRIPTION ===', description);
    return cleanDirectDescriptionText(lines.join('\n'));
}

async function fetchJobDescriptionDirectly(request) {
    if (!request.jobLink) throw new Error('Missing job URL.');
    const jobUrl = new URL(request.jobLink);
    if (jobUrl.hostname.includes('jobvite.com')) jobUrl.searchParams.set('nl', '1');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);
    try {
        try {
            const structuredDescription = await smartRecruitersPosting.fetchPostingDescription(
                fetch,
                jobUrl.toString(),
                controller.signal
            );
            if (structuredDescription && structuredDescription.length >= 50) {
                return structuredDescription;
            }
        } catch (apiError) {
            console.warn(`SmartRecruiters API metadata fetch failed for ${jobUrl}:`, apiError);
        }

        const response = await fetch(jobUrl.toString(), {
            cache: 'no-store',
            credentials: 'omit',
            redirect: 'follow',
            signal: controller.signal,
            headers: { Accept: 'text/html,application/xhtml+xml' }
        });
        if (!response.ok) throw new Error(`Description request failed with HTTP ${response.status}.`);
        const contentType = response.headers.get('content-type') || '';
        if (contentType && !/html|xhtml/i.test(contentType)) throw new Error('Job URL did not return HTML.');

        const html = await response.text();
        if (html.length > 5_000_000) throw new Error('Job page was too large to parse safely.');
        const posting = extractDirectJobPosting(html, request.title || '');
        const description = formatDirectJobDescription(posting) || extractDirectDescriptionFallback(html);
        if (!description || description.length < 50) {
            throw new Error('No usable job description was found in the fetched HTML.');
        }
        return description;
    } finally {
        clearTimeout(timeoutId);
    }
}

function findDescriptionJobIndex(jobs, request) {
    if (request.jobLink) {
        const linkIndex = jobs.findIndex(job => job.link === request.jobLink);
        if (linkIndex !== -1) return linkIndex;
    }
    return Number.isInteger(request.jobIndex) && jobs[request.jobIndex] ? request.jobIndex : -1;
}

async function saveFetchedDescription(request, description) {
    const result = await chrome.storage.local.get(['scrapedJobs']);
    const jobs = result.scrapedJobs || [];
    const jobIndex = findDescriptionJobIndex(jobs, request);
    if (jobIndex === -1) throw new Error('Job no longer exists in storage.');

    jobs[jobIndex].description = description;
    delete jobs[jobIndex].descriptionFetchFailed;
    delete jobs[jobIndex].descriptionError;
    await chrome.storage.local.set({ scrapedJobs: jobs });
    await chrome.runtime.sendMessage({
        action: 'descriptionSaved',
        jobIndex,
        jobLink: request.jobLink
    }).catch(() => {});
}

async function markDescriptionFetchFailed(request, error) {
    const result = await chrome.storage.local.get(['scrapedJobs']);
    const jobs = result.scrapedJobs || [];
    const jobIndex = findDescriptionJobIndex(jobs, request);
    const message = error?.name === 'AbortError'
        ? 'Timed out fetching the job description.'
        : (error?.message || 'Failed to fetch description.');

    if (jobIndex !== -1) {
        jobs[jobIndex].descriptionFetchFailed = true;
        jobs[jobIndex].descriptionError = message;
        await chrome.storage.local.set({ scrapedJobs: jobs });
    }
    await chrome.runtime.sendMessage({
        action: 'descriptionFailed',
        jobIndex,
        jobLink: request.jobLink,
        message
    }).catch(() => {});
}

function enqueueDescriptionFetch(request) {
    const run = async () => {
        try {
            const description = await fetchJobDescriptionDirectly(request);
            await saveFetchedDescription(request, description);
            return { ok: true };
        } catch (error) {
            console.warn(`Direct description fetch failed for ${request.jobLink || 'unknown job'}:`, error);
            await markDescriptionFetchFailed(request, error);
            return { ok: false, error: error?.message || 'Failed to fetch description.' };
        }
    };

    const queued = descriptionFetchQueue.then(run, run);
    descriptionFetchQueue = queued.catch(() => {});
    return queued;
}

async function handleFetchDetails(request) {
    const { url, jobIndex } = request;
    const detailsList = await fetchDetailsAsync(url);
    chrome.runtime.sendMessage({ action: 'detailsFetched', details: detailsList, jobIndex: jobIndex }).catch(() => {});
}

