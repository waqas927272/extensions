// Petfolk Job Scraper - Content Script
// Supports:
//   - https://ats.rippling.com/petfolk/jobs*

(async () => {
    try {
        const data = await chrome.storage.local.get([
            'scraping',
            'scrapedJobs',
            'scrapedJobIds',
            'skippedJobCounts',
            'skippedJobKeys'
        ]);
        if (!data.scraping) return;

        const jobCount = data.scrapedJobs ? data.scrapedJobs.length : 0;
        const pageUrl = window.location.href;
        const pageType = detectPageType(pageUrl);

        await chrome.storage.local.set({
            scrapingStatus: `Scraping page... (${jobCount} jobs found so far) [${pageType}]`
        });

        if (pageType === 'rippling') {
            await chrome.storage.local.set({
                scrapingStatus: `Department filter applied. Waiting 5 seconds before scraping... (${jobCount} jobs found so far)`
            });
            await sleep(5000);
        }

        const scrapedJobIds = new Set(data.scrapedJobIds || []);
        const skippedJobKeys = new Set(data.skippedJobKeys || []);
        const skippedJobCounts = normalizeSkippedJobCounts(data.skippedJobCounts);
        const newScrape = scrapeCurrentPage(scrapedJobIds, pageType, skippedJobKeys, skippedJobCounts);
        const allJobs = (data.scrapedJobs || []).concat(newScrape.jobs);
        const allJobIds = Array.from(newScrape.scrapedJobIds);

        await chrome.storage.local.set({
            scrapedJobs: allJobs,
            scrapedJobIds: allJobIds,
            skippedJobCounts: newScrape.skippedJobCounts,
            skippedJobKeys: Array.from(newScrape.skippedJobKeys)
        });

        const nextPageUrl = findNextPageUrl(pageType);
        if (nextPageUrl) {
            window.location.href = nextPageUrl;
            return;
        }

        await chrome.storage.local.set({
            scraping: false,
            scrapingComplete: true,
            scrapingStatus: `Scraping complete! Found ${allJobs.length} total jobs. ${formatSkippedJobSummary(newScrape.skippedJobCounts)}`
        });
    } catch (error) {
        await chrome.storage.local.set({
            scraping: false,
            scrapingComplete: false,
            scrapingStatus: `An error occurred: ${error.message}`
        });
        console.error('Scraper content script error:', error);
    }
})();

function detectPageType(url) {
    if (url.includes('ats.rippling.com/petfolk/jobs')) return 'rippling';
    if (url.includes('/agency/')) return 'agency';
    return 'marketplace';
}

const EXCLUDED_JOB_TITLES = new Set([
    'payroll coordinator',
    'marketing analyst',
    'analyst, product insights',
    'marketing automation specialist',
    'test veterinarian',
    'senior indirect tax analyst',
    'test only do not submit',
    'data scientist',
    'financial analyst',
    'marketing business partner',
    'director, indirect tax',
    'tax analyst',
    'division vice president',
    'operations analyst',
    'staff accountant',
    'acquisition diligence analyst'
]);
const EXCLUDED_JOB_TITLE_KEYWORDS = [
    { key: 'locum', label: 'Locum', terms: ['locum'] },
    { key: 'relief', label: 'Relief', terms: ['relief'] },
    { key: 'mentorship', label: 'Mentorship', terms: ['mentorship', 'mentoship'] },
    { key: 'weekend', label: 'Weekend', terms: ['weekend'] }
];
const EXCLUDED_JOB_TITLE_PHRASES = [
    'regional medical partner'
];

const STATE_ABBR = {
    'alabama': 'AL',
    'alaska': 'AK',
    'arizona': 'AZ',
    'arkansas': 'AR',
    'california': 'CA',
    'colorado': 'CO',
    'connecticut': 'CT',
    'delaware': 'DE',
    'florida': 'FL',
    'georgia': 'GA',
    'hawaii': 'HI',
    'idaho': 'ID',
    'illinois': 'IL',
    'indiana': 'IN',
    'iowa': 'IA',
    'kansas': 'KS',
    'kentucky': 'KY',
    'louisiana': 'LA',
    'maine': 'ME',
    'maryland': 'MD',
    'massachusetts': 'MA',
    'michigan': 'MI',
    'minnesota': 'MN',
    'mississippi': 'MS',
    'missouri': 'MO',
    'montana': 'MT',
    'nebraska': 'NE',
    'nevada': 'NV',
    'new hampshire': 'NH',
    'new jersey': 'NJ',
    'new mexico': 'NM',
    'new york': 'NY',
    'north carolina': 'NC',
    'north dakota': 'ND',
    'ohio': 'OH',
    'oklahoma': 'OK',
    'oregon': 'OR',
    'pennsylvania': 'PA',
    'rhode island': 'RI',
    'south carolina': 'SC',
    'south dakota': 'SD',
    'tennessee': 'TN',
    'texas': 'TX',
    'utah': 'UT',
    'vermont': 'VT',
    'virginia': 'VA',
    'washington': 'WA',
    'west virginia': 'WV',
    'wisconsin': 'WI',
    'wyoming': 'WY',
    'district of columbia': 'DC'
};
const REQUIRED_DEPARTMENT = 'Medical';
const PETFOLK_HOSPITAL_NAME = 'Petfolk Veterinary & Urgent Care';

function normalizeWhitespace(value) {
    return (value || '').replace(/\s+/g, ' ').trim();
}

function normalizeTitleForComparison(title) {
    return normalizeWhitespace(title).toLowerCase();
}

function getEmptySkippedJobCounts() {
    return EXCLUDED_JOB_TITLE_KEYWORDS.reduce((counts, config) => {
        counts[config.label] = 0;
        return counts;
    }, {});
}

function normalizeSkippedJobCounts(counts = {}) {
    const normalizedCounts = getEmptySkippedJobCounts();
    EXCLUDED_JOB_TITLE_KEYWORDS.forEach(({ label }) => {
        normalizedCounts[label] = Number.isFinite(Number(counts[label])) ? Number(counts[label]) : 0;
    });
    return normalizedCounts;
}

function getSkippedKeywordMatches(title) {
    const normalizedTitle = normalizeTitleForComparison(title);
    return EXCLUDED_JOB_TITLE_KEYWORDS.filter(({ terms }) => {
        return terms.some(term => normalizedTitle.includes(term));
    });
}

function formatSkippedJobSummary(counts = {}) {
    const normalizedCounts = normalizeSkippedJobCounts(counts);
    const parts = EXCLUDED_JOB_TITLE_KEYWORDS.map(({ label }) => {
        return `${label} skipped: ${normalizedCounts[label]}`;
    });
    return `Skipped jobs - ${parts.join(', ')}.`;
}

function shouldSkipJobTitle(title, skipKey = '', skippedJobKeys = null, skippedJobCounts = null) {
    const normalizedTitle = normalizeTitleForComparison(title);
    const keywordMatches = getSkippedKeywordMatches(title);
    const phraseMatch = EXCLUDED_JOB_TITLE_PHRASES.some(phrase => normalizedTitle.includes(phrase));
    const shouldSkip = EXCLUDED_JOB_TITLES.has(normalizedTitle) || phraseMatch || keywordMatches.length > 0;

    if (keywordMatches.length > 0 && skippedJobKeys && skippedJobCounts) {
        const uniqueSkipKey = skipKey || `title:${normalizedTitle}`;
        if (!skippedJobKeys.has(uniqueSkipKey)) {
            skippedJobKeys.add(uniqueSkipKey);
            keywordMatches.forEach(({ label }) => {
                skippedJobCounts[label] = (skippedJobCounts[label] || 0) + 1;
            });
        }
    }

    return shouldSkip;
}

function extractRipplingId(url) {
    if (!url) return null;

    try {
        const parsed = new URL(url, window.location.origin);
        const match = parsed.pathname.match(/\/petfolk\/jobs\/([^/?#]+)/);
        return match ? match[1] : null;
    } catch (_) {
        const match = String(url).match(/\/petfolk\/jobs\/([^/?#]+)/);
        return match ? match[1] : null;
    }
}

function parseRipplingLocation(location) {
    if (!location) return { location: '', city: '', state: '' };

    if (typeof location === 'string') {
        return parseLocationText(location);
    }

    const locationName = normalizeWhitespace(location.name || '');
    const city = normalizeWhitespace(location.city || '');
    const state = normalizeWhitespace(location.stateCode || location.state || '');

    if (city && state) {
        return {
            location: locationName || `${city}, ${state}`,
            city,
            state
        };
    }

    if (locationName) return parseLocationText(locationName);
    if (state) return { location: state, city: '', state };

    return { location: '', city: '', state: '' };
}

function extractRipplingLocationText(text) {
    const locationMatch = normalizeWhitespace(text).match(/\b([A-Za-z][\w\s.'()-]*[A-Za-z])\s*,\s*([A-Z]{2})\b/);
    return locationMatch ? `${locationMatch[1].trim()}, ${locationMatch[2].trim()}` : '';
}

function scrapeCurrentPage(scrapedJobIds, pageType, skippedJobKeys, skippedJobCounts) {
    if (pageType === 'rippling') {
        return scrapeRipplingPage(scrapedJobIds, skippedJobKeys, skippedJobCounts);
    }
    if (pageType === 'agency') {
        return scrapeAgencyPage(scrapedJobIds, skippedJobKeys, skippedJobCounts);
    }
    return scrapeMarketplacePage(scrapedJobIds, skippedJobKeys, skippedJobCounts);
}

function getNextData() {
    const nextDataEl = document.getElementById('__NEXT_DATA__');
    if (!nextDataEl?.textContent) return null;

    try {
        return JSON.parse(nextDataEl.textContent);
    } catch (error) {
        console.warn('Could not parse Rippling Next.js data:', error);
        return null;
    }
}

function getRipplingJobPostData() {
    const nextData = getNextData();
    const queries = nextData?.props?.pageProps?.dehydratedState?.queries || [];
    const jobPostsQuery = queries.find((query) => {
        const queryKey = query?.queryKey || [];
        return Array.isArray(queryKey) && queryKey.includes('job-posts');
    });

    return jobPostsQuery?.state?.data || null;
}

function scrapeRipplingPage(scrapedJobIds, skippedJobKeys, skippedJobCounts) {
    const jobs = [];
    const jobPostData = getRipplingJobPostData();
    const items = Array.isArray(jobPostData?.items) ? jobPostData.items : [];

    const currentPage = Number.isFinite(Number(jobPostData?.page)) ? Number(jobPostData.page) : 0;

    items.forEach((item, itemIndex) => {
        try {
            const rawJobId = item.id || extractRipplingId(item.url);
            const title = normalizeWhitespace(item.name || '');
            const jobLink = item.url || (rawJobId ? `https://ats.rippling.com/petfolk/jobs/${rawJobId}` : '');
            if (!rawJobId || !title || !jobLink) return;
            const uniqueJobKey = `rippling:${rawJobId}`;
            if (shouldSkipJobTitle(title, uniqueJobKey, skippedJobKeys, skippedJobCounts)) return;
            const department = normalizeWhitespace(item.department?.name || item.department || '');
            if (department !== REQUIRED_DEPARTMENT) return;

            if (scrapedJobIds.has(uniqueJobKey) || scrapedJobIds.has(rawJobId)) return;
            scrapedJobIds.add(uniqueJobKey);

            const locations = Array.isArray(item.locations) && item.locations.length
                ? item.locations
                : [{ name: '', city: '', state: '', stateCode: '' }];
            const parsedPrimaryLocation = parseRipplingLocation(locations[0]);
            const locationNames = locations
                .map(location => parseRipplingLocation(location).location)
                .filter(Boolean);

            jobs.push({
                title,
                jobId: `PFV-${rawJobId}-${currentPage + 1}-${itemIndex + 1}`,
                sourceJobId: rawJobId,
                department,
                location: locationNames.join(' | ') || parsedPrimaryLocation.location,
                city: parsedPrimaryLocation.city,
                state: parsedPrimaryLocation.state,
                hospital: PETFOLK_HOSPITAL_NAME,
                link: jobLink,
                locations: locationNames
            });
        } catch (error) {
            console.error('Error parsing Rippling job item:', error, item);
        }
    });

    if (jobs.length > 0 || items.length > 0) {
        return { jobs, scrapedJobIds, skippedJobKeys, skippedJobCounts };
    }

    return scrapeRipplingDomFallback(scrapedJobIds, skippedJobKeys, skippedJobCounts);
}

function scrapeRipplingDomFallback(scrapedJobIds, skippedJobKeys, skippedJobCounts) {
    const jobs = [];
    const links = Array.from(document.querySelectorAll('a[href*="/petfolk/jobs/"]'));

    links.forEach((link) => {
        try {
            const rawJobId = extractRipplingId(link.href);
            const title = normalizeWhitespace(link.textContent || '');
            if (!rawJobId || !title) return;
            if (shouldSkipJobTitle(title, `rippling-dom:${rawJobId}`, skippedJobKeys, skippedJobCounts) || scrapedJobIds.has(rawJobId)) return;
            scrapedJobIds.add(rawJobId);

            const container = link.closest('li, article, [role="listitem"], div') || link.parentElement;
            const parsedLocation = parseLocationText(extractRipplingLocationText(container?.innerText || ''));

            jobs.push({
                title,
                jobId: `PFV-${rawJobId}`,
                department: '',
                location: parsedLocation.location,
                city: parsedLocation.city,
                state: parsedLocation.state,
                hospital: PETFOLK_HOSPITAL_NAME,
                link: link.href
            });
        } catch (error) {
            console.error('Error in Rippling DOM fallback:', error);
        }
    });

    return { jobs, scrapedJobIds, skippedJobKeys, skippedJobCounts };
}

function scrapeMarketplacePage(scrapedJobIds, skippedJobKeys, skippedJobCounts) {
    const jobs = [];
    const jobArticles = document.querySelectorAll('article.article--result');

    jobArticles.forEach((article) => {
        try {
            const titleElement = article.querySelector('h3.article__header__text__title a.link');
            const jobLink = titleElement ? titleElement.href : null;
            if (!jobLink) return;

            const title = titleElement.textContent.trim();
            const rawJobId = extractNumericId(jobLink);
            if (shouldSkipJobTitle(title, `marketplace:${rawJobId || jobLink}`, skippedJobKeys, skippedJobCounts)) return;
            if (!rawJobId || scrapedJobIds.has(rawJobId)) return;
            scrapedJobIds.add(rawJobId);

            const { location, city, state, hospital } = extractLocationFromSubtitle(article);
            jobs.push({
                title,
                jobId: `MPH-${rawJobId}`,
                location,
                city: '',
                state: '',
                hospital,
                link: jobLink
            });
        } catch (error) {
            console.error('Error parsing marketplace article:', error, article);
        }
    });

    return { jobs, scrapedJobIds, skippedJobKeys, skippedJobCounts };
}

function scrapeAgencyPage(scrapedJobIds, skippedJobKeys, skippedJobCounts) {
    const jobs = [];

    let found = tryArticleStrategy(scrapedJobIds, jobs, skippedJobKeys, skippedJobCounts);
    if (!found) found = tryTableStrategy(scrapedJobIds, jobs, skippedJobKeys, skippedJobCounts);
    if (!found) found = tryListItemStrategy(scrapedJobIds, jobs, skippedJobKeys, skippedJobCounts);
    if (!found) tryLinkFallbackStrategy(scrapedJobIds, jobs, skippedJobKeys, skippedJobCounts);

    return { jobs, scrapedJobIds, skippedJobKeys, skippedJobCounts };
}

function tryArticleStrategy(scrapedJobIds, jobs, skippedJobKeys, skippedJobCounts) {
    const articles = document.querySelectorAll('article.article--result');
    if (!articles.length) return false;

    articles.forEach((article) => {
        try {
            const titleEl = article.querySelector('.article__header__text__title a.link, h3 a.link, h2 a.link, h3 a, h2 a');
            const jobLink = titleEl ? titleEl.href : null;
            if (!jobLink) return;

            const title = titleEl.textContent.trim();
            const rawJobId = extractNumericId(jobLink);
            if (shouldSkipJobTitle(title, `agency-article:${rawJobId || jobLink}`, skippedJobKeys, skippedJobCounts)) return;
            if (!rawJobId || scrapedJobIds.has(rawJobId)) return;
            scrapedJobIds.add(rawJobId);

            const { location, city, state, hospital } = extractLocationFromSubtitle(article);
            jobs.push({
                title,
                jobId: `MPH-${rawJobId}`,
                location,
                city: '',
                state: '',
                hospital,
                link: jobLink
            });
        } catch (error) {
            console.error('Error in article strategy:', error);
        }
    });

    return jobs.length > 0;
}

function tryTableStrategy(scrapedJobIds, jobs, skippedJobKeys, skippedJobCounts) {
    const rows = document.querySelectorAll('table tr, tbody tr');
    if (!rows.length) return false;

    let found = false;
    rows.forEach((row) => {
        try {
            const link = row.querySelector('a[href*="JobDetail"], a[href*="OpenPositions/"], a[href*="job"]');
            if (!link || !link.href) return;

            const titleCell = row.querySelector('td:first-child, .jobTitle, .title');
            const title = (titleCell ? titleCell.textContent : link.textContent).trim() || 'N/A';
            const rawJobId = extractNumericId(link.href);
            if (shouldSkipJobTitle(title, `agency-table:${rawJobId || link.href}`, skippedJobKeys, skippedJobCounts)) return;
            if (!rawJobId || scrapedJobIds.has(rawJobId)) return;
            scrapedJobIds.add(rawJobId);

            const cells = Array.from(row.querySelectorAll('td'));
            const locText = cells.map(cell => cell.textContent.trim()).join(' | ');
            const parsed = parseLocationText(locText);

            jobs.push({
                title,
                jobId: `MPH-${rawJobId}`,
                location: parsed.location,
                city: '',
                state: '',
                hospital: '',
                link: link.href
            });
            found = true;
        } catch (error) {
            console.error('Error in table strategy:', error);
        }
    });

    return found;
}

function tryListItemStrategy(scrapedJobIds, jobs, skippedJobKeys, skippedJobCounts) {
    const containers = document.querySelectorAll(
        'li.contentListItem, li.job-item, div.job-item, div.resultItem, div.openPosition, .vacancy-item'
    );
    if (!containers.length) return false;

    let found = false;
    containers.forEach((item) => {
        try {
            const link = item.querySelector('a[href]');
            if (!link || !link.href) return;

            const title = (item.querySelector('.jobTitle, .title, h2, h3, h4') || link).textContent.trim() || 'N/A';
            const rawJobId = extractNumericId(link.href);
            if (shouldSkipJobTitle(title, `agency-list:${rawJobId || link.href}`, skippedJobKeys, skippedJobCounts)) return;
            if (!rawJobId || scrapedJobIds.has(rawJobId)) return;
            scrapedJobIds.add(rawJobId);

            const locEl = item.querySelector('.location, .city, .jobLocation');
            const parsed = parseLocationText(locEl ? locEl.textContent : '');

            jobs.push({
                title,
                jobId: `MPH-${rawJobId}`,
                location: parsed.location,
                city: '',
                state: '',
                hospital: '',
                link: link.href
            });
            found = true;
        } catch (error) {
            console.error('Error in list-item strategy:', error);
        }
    });

    return found;
}

function tryLinkFallbackStrategy(scrapedJobIds, jobs, skippedJobKeys, skippedJobCounts) {
    const links = document.querySelectorAll(
        'a[href*="/agency/"][href*="JobDetail"], ' +
        'a[href*="/agency/"][href*="OpenPositions/"], ' +
        'a[href*="avature.net"][href*="JobDetail"]'
    );

    links.forEach((link) => {
        try {
            if (!link.href) return;

            const title = link.textContent.trim() || 'N/A';
            const rawJobId = extractNumericId(link.href);
            if (shouldSkipJobTitle(title, `agency-link:${rawJobId || link.href}`, skippedJobKeys, skippedJobCounts)) return;
            if (!rawJobId || scrapedJobIds.has(rawJobId)) return;
            scrapedJobIds.add(rawJobId);

            jobs.push({
                title,
                jobId: `MPH-${rawJobId}`,
                location: '',
                city: '',
                state: '',
                hospital: '',
                link: link.href
            });
        } catch (error) {
            console.error('Error in link-fallback strategy:', error);
        }
    });
}

function findNextPageUrl(pageType) {
    if (pageType === 'rippling') {
        return findNextRipplingPageUrl();
    }

    if (pageType === 'agency') {
        return findNextAgencyPageUrl();
    }

    const nextContainer = document.querySelector('.list-controls__pagination__item.next, .pagination__next, [aria-label="Next page"]');
    if (nextContainer) {
        const nextLink = nextContainer.querySelector('a');
        if (nextLink && nextLink.href && nextLink.href !== window.location.href) {
            return nextLink.href;
        }
    }

    const relNext = document.querySelector('a[rel="next"]');
    if (relNext && relNext.href && relNext.href !== window.location.href) return relNext.href;

    const currentUrl = new URL(window.location.href);
    const currentPage = parseInt(currentUrl.searchParams.get('page') || currentUrl.searchParams.get('p') || '0', 10);
    const nextPageNum = currentPage + 1;
    const nextPageLink = document.querySelector(`a[href*="page=${nextPageNum}"], a[href*="p=${nextPageNum}"]`);
    if (nextPageLink && nextPageLink.href) return nextPageLink.href;

    return null;
}

function findNextRipplingPageUrl() {
    const jobPostData = getRipplingJobPostData();
    const currentUrl = new URL(window.location.href);
    const currentPage = Number.isFinite(Number(jobPostData?.page))
        ? Number(jobPostData.page)
        : parseInt(currentUrl.searchParams.get('page') || '0', 10);
    const totalPages = parseInt(jobPostData?.totalPages || '0', 10);

    if (Number.isFinite(currentPage) && Number.isFinite(totalPages) && currentPage + 1 < totalPages) {
        currentUrl.searchParams.set('page', String(currentPage + 1));
        currentUrl.searchParams.set('jobBoardSlug', 'petfolk');
        return currentUrl.toString();
    }

    const nextPageNumber = Number.isFinite(currentPage) ? currentPage + 1 : 1;
    const nextLink = document.querySelector(`a[href*="page=${nextPageNumber}"]`);
    if (nextLink?.href && nextLink.href !== window.location.href) {
        return nextLink.href;
    }

    return null;
}

function findNextAgencyPageUrl() {
    const nextContainer = document.querySelector('.list-controls__pagination__item.next, .pagination__next, [aria-label="Next page"]');
    if (nextContainer) {
        const nextLink = nextContainer.querySelector('a');
        if (nextLink && nextLink.href && nextLink.href !== window.location.href) {
            return nextLink.href;
        }
    }

    const relNext = document.querySelector('a[rel="next"]');
    if (relNext && relNext.href && relNext.href !== window.location.href) return relNext.href;

    const offsetLinks = Array.from(document.querySelectorAll('a[href*="jobOffset="]'));
    const currentUrl = new URL(window.location.href);
    const currentOffset = parseInt(currentUrl.searchParams.get('jobOffset') || '0', 10);

    const linkedNext = offsetLinks.find(link => {
        try {
            const parsed = new URL(link.href);
            const linkedOffset = parseInt(parsed.searchParams.get('jobOffset') || '0', 10);
            return linkedOffset > currentOffset;
        } catch (_) {
            return false;
        }
    });
    if (linkedNext) return linkedNext.href;

    const summaryText = document.body.innerText;
    const rangeMatch = summaryText.match(/(\d+)\s*[-\u2013]\s*(\d+)\s+of\s+(\d+)/i);
    if (!rangeMatch) return null;

    const currentEnd = parseInt(rangeMatch[2], 10);
    const totalJobs = parseInt(rangeMatch[3], 10);
    if (!Number.isFinite(currentEnd) || !Number.isFinite(totalJobs) || currentEnd >= totalJobs) {
        return null;
    }

    const recordsPerPage = parseInt(currentUrl.searchParams.get('jobRecordsPerPage') || '6', 10);
    const nextOffset = currentOffset + recordsPerPage;
    if (!Number.isFinite(nextOffset) || nextOffset >= totalJobs) return null;

    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set('jobOffset', String(nextOffset));
    return nextUrl.toString();
}

function extractNumericId(url) {
    try {
        const parsed = new URL(url);
        const qJobId = parsed.searchParams.get('jobId');
        if (qJobId && /^\d+$/.test(qJobId)) return qJobId;

        const match = parsed.pathname.match(/\/(\d+)/);
        return match ? match[1] : null;
    } catch (_) {
        const qMatch = url.match(/[?&]jobId=(\d+)/);
        if (qMatch) return qMatch[1];

        const match = url.match(/\/(\d+)/);
        return match ? match[1] : null;
    }
}

function extractLocationFromSubtitle(article) {
    let location = '';
    let city = '';
    let state = '';
    let hospital = '';

    const siteEl = article.querySelector('span.list-item-site');
    const locEl = article.querySelector('span.list-item-location');
    if (siteEl) hospital = siteEl.textContent.trim();
    if (locEl) {
        const raw = locEl.textContent.trim();
        const parsed = parseLocationText(raw);
        location = parsed.location;
        city = parsed.city;
        state = parsed.state;
    }

    if (!city && !location) {
        const spans = article.querySelectorAll('.article__header__subtitle span.paragraph--inline, .article__header__subtitle span');
        spans.forEach((span) => {
            const text = span.textContent.trim();
            if (text.startsWith('Location:')) location = text.replace(/^Location:\s*/i, '').trim();
            else if (text.startsWith('City:')) city = text.replace(/^City:\s*/i, '').trim();
            else if (text.startsWith('State:')) state = text.replace(/^State:\s*/i, '').trim();
            else if (text.startsWith('Site:') || text.startsWith('Practice:')) hospital = text.replace(/^(?:Site|Practice):\s*/i, '').trim();
        });
    }

    if ((!city || !state) && location) {
        const parsed = parseLocationText(location);
        city = city || parsed.city;
        state = state || parsed.state;
        location = parsed.location;
    }

    return { location, city, state, hospital };
}

function parseLocationText(text) {
    if (!text || text === 'N/A') {
        return { location: '', city: '', state: '' };
    }

    const clean = text.replace(/Location:|City:|State:/gi, '').trim();
    const stateOnly = parseStateOnlyValue(clean);
    if (stateOnly) {
        return { location: stateOnly, city: '', state: stateOnly };
    }

    const match = clean.match(/^([A-Za-z\s.'()-]+),\s*([A-Za-z\s]{2,})$/);
    if (match) {
        const city = match[1].trim();
        const statePart = match[2].trim();
        const state = STATE_ABBR[statePart.toLowerCase()] || statePart;
        return { location: `${city}, ${state}`, city, state };
    }

    return { location: clean, city: clean, state: '' };
}

function parseStateOnlyValue(value) {
    const clean = (value || '').trim();
    if (!clean) return '';

    if (/^[A-Z]{2}$/i.test(clean)) {
        return clean.toUpperCase();
    }

    return STATE_ABBR[clean.toLowerCase()] || '';
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
