// MPH Job Scraper - Content Script
// Supports:
//   - https://missionpethealth.avature.net/careersmarketplace/SearchJobs*
//   - https://missionpethealth.avature.net/agency/OpenPositions*

(async () => {
    try {
        const data = await chrome.storage.local.get(['scraping', 'scrapedJobs', 'scrapedJobIds']);
        if (!data.scraping) return;

        const jobCount = data.scrapedJobs ? data.scrapedJobs.length : 0;
        const pageUrl = window.location.href;
        const pageType = detectPageType(pageUrl);

        await chrome.storage.local.set({
            scrapingStatus: `Scraping page... (${jobCount} jobs found so far) [${pageType}]`
        });

        const scrapedJobIds = new Set(data.scrapedJobIds || []);
        const newScrape = scrapeCurrentPage(scrapedJobIds, pageType);
        const allJobs = (data.scrapedJobs || []).concat(newScrape.jobs);
        const allJobIds = Array.from(newScrape.scrapedJobIds);

        await chrome.storage.local.set({
            scrapedJobs: allJobs,
            scrapedJobIds: allJobIds
        });

        const nextPageUrl = findNextPageUrl(pageType);
        if (nextPageUrl) {
            window.location.href = nextPageUrl;
            return;
        }

        await chrome.storage.local.set({
            scraping: false,
            scrapingComplete: true,
            scrapingStatus: `Scraping complete! Found ${allJobs.length} total jobs.`
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

function normalizeTitleForComparison(title) {
    return (title || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function shouldSkipJobTitle(title) {
    return EXCLUDED_JOB_TITLES.has(normalizeTitleForComparison(title));
}

function scrapeCurrentPage(scrapedJobIds, pageType) {
    if (pageType === 'agency') {
        return scrapeAgencyPage(scrapedJobIds);
    }
    return scrapeMarketplacePage(scrapedJobIds);
}

function scrapeMarketplacePage(scrapedJobIds) {
    const jobs = [];
    const jobArticles = document.querySelectorAll('article.article--result');

    jobArticles.forEach((article) => {
        try {
            const titleElement = article.querySelector('h3.article__header__text__title a.link');
            const jobLink = titleElement ? titleElement.href : null;
            if (!jobLink) return;

            const title = titleElement.textContent.trim();
            if (shouldSkipJobTitle(title)) return;

            const rawJobId = extractNumericId(jobLink);
            if (!rawJobId || scrapedJobIds.has(rawJobId)) return;
            scrapedJobIds.add(rawJobId);

            const { location, city, state, hospital } = extractLocationFromSubtitle(article);
            jobs.push({
                title,
                jobId: `MPH-${rawJobId}`,
                location,
                city,
                state,
                hospital,
                link: jobLink
            });
        } catch (error) {
            console.error('Error parsing marketplace article:', error, article);
        }
    });

    return { jobs, scrapedJobIds };
}

function scrapeAgencyPage(scrapedJobIds) {
    const jobs = [];

    let found = tryArticleStrategy(scrapedJobIds, jobs);
    if (!found) found = tryTableStrategy(scrapedJobIds, jobs);
    if (!found) found = tryListItemStrategy(scrapedJobIds, jobs);
    if (!found) tryLinkFallbackStrategy(scrapedJobIds, jobs);

    return { jobs, scrapedJobIds };
}

function tryArticleStrategy(scrapedJobIds, jobs) {
    const articles = document.querySelectorAll('article.article--result');
    if (!articles.length) return false;

    articles.forEach((article) => {
        try {
            const titleEl = article.querySelector('.article__header__text__title a.link, h3 a.link, h2 a.link, h3 a, h2 a');
            const jobLink = titleEl ? titleEl.href : null;
            if (!jobLink) return;

            const title = titleEl.textContent.trim();
            if (shouldSkipJobTitle(title)) return;

            const rawJobId = extractNumericId(jobLink);
            if (!rawJobId || scrapedJobIds.has(rawJobId)) return;
            scrapedJobIds.add(rawJobId);

            const { location, city, state, hospital } = extractLocationFromSubtitle(article);
            jobs.push({
                title,
                jobId: `MPH-${rawJobId}`,
                location,
                city,
                state,
                hospital,
                link: jobLink
            });
        } catch (error) {
            console.error('Error in article strategy:', error);
        }
    });

    return jobs.length > 0;
}

function tryTableStrategy(scrapedJobIds, jobs) {
    const rows = document.querySelectorAll('table tr, tbody tr');
    if (!rows.length) return false;

    let found = false;
    rows.forEach((row) => {
        try {
            const link = row.querySelector('a[href*="JobDetail"], a[href*="OpenPositions/"], a[href*="job"]');
            if (!link || !link.href) return;

            const titleCell = row.querySelector('td:first-child, .jobTitle, .title');
            const title = (titleCell ? titleCell.textContent : link.textContent).trim() || 'N/A';
            if (shouldSkipJobTitle(title)) return;

            const rawJobId = extractNumericId(link.href);
            if (!rawJobId || scrapedJobIds.has(rawJobId)) return;
            scrapedJobIds.add(rawJobId);

            const cells = Array.from(row.querySelectorAll('td'));
            const locText = cells.map(cell => cell.textContent.trim()).join(' | ');
            const parsed = parseLocationText(locText);

            jobs.push({
                title,
                jobId: `MPH-${rawJobId}`,
                location: parsed.location,
                city: parsed.city,
                state: parsed.state,
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

function tryListItemStrategy(scrapedJobIds, jobs) {
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
            if (shouldSkipJobTitle(title)) return;

            const rawJobId = extractNumericId(link.href);
            if (!rawJobId || scrapedJobIds.has(rawJobId)) return;
            scrapedJobIds.add(rawJobId);

            const locEl = item.querySelector('.location, .city, .jobLocation');
            const parsed = parseLocationText(locEl ? locEl.textContent : '');

            jobs.push({
                title,
                jobId: `MPH-${rawJobId}`,
                location: parsed.location,
                city: parsed.city,
                state: parsed.state,
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

function tryLinkFallbackStrategy(scrapedJobIds, jobs) {
    const links = document.querySelectorAll(
        'a[href*="/agency/"][href*="JobDetail"], ' +
        'a[href*="/agency/"][href*="OpenPositions/"], ' +
        'a[href*="avature.net"][href*="JobDetail"]'
    );

    links.forEach((link) => {
        try {
            if (!link.href) return;

            const title = link.textContent.trim() || 'N/A';
            if (shouldSkipJobTitle(title)) return;

            const rawJobId = extractNumericId(link.href);
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
    const match = clean.match(/^([A-Za-z\s.'()-]+),\s*([A-Za-z\s]{2,})$/);
    if (match) {
        const city = match[1].trim();
        const statePart = match[2].trim();
        const state = STATE_ABBR[statePart.toLowerCase()] || statePart;
        return { location: `${city}, ${state}`, city, state };
    }

    return { location: clean, city: clean, state: '' };
}
