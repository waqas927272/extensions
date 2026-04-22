// MPH Job Scraper - Content Script
// Supports:
//   - https://missionpethealth.avature.net/careersmarketplace/SearchJobs*  (candidate portal)
//   - https://missionpethealth.avature.net/agency/OpenPositions*            (agency portal)

(async () => {
    try {
        const data = await chrome.storage.local.get(['scraping', 'scrapedJobs', 'scrapedJobIds']);

        if (data.scraping) {
            const jobCount = data.scrapedJobs ? data.scrapedJobs.length : 0;
            const pageUrl  = window.location.href;
            const pageType = detectPageType(pageUrl);

            await chrome.storage.local.set({
                scrapingStatus: `Scraping page... (${jobCount} jobs found so far) [${pageType}]`
            });

            const scrapedJobIds = new Set(data.scrapedJobIds || []);
            const newScrape = scrapeCurrentPage(scrapedJobIds, pageType);

            const allJobs   = (data.scrapedJobs || []).concat(newScrape.jobs);
            const allJobIds = Array.from(newScrape.scrapedJobIds);

            await chrome.storage.local.set({
                scrapedJobs: allJobs,
                scrapedJobIds: allJobIds
            });

            const nextPageUrl = findNextPageUrl(pageType);

            if (nextPageUrl) {
                window.location.href = nextPageUrl;
            } else {
                await chrome.storage.local.set({
                    scraping: false,
                    scrapingComplete: true,
                    scrapingStatus: `Scraping complete! Found ${allJobs.length} total jobs.`
                });
            }
        }
    } catch (error) {
        await chrome.storage.local.set({
            scraping: false,
            scrapingComplete: false,
            scrapingStatus: `An error occurred: ${error.message}`
        });
        console.error('Scraper content script error:', error);
    }
})();

// ── Detect which portal we're on ──────────────────────────────────────────
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
    'staff accountant'
]);

function normalizeTitleForComparison(title) {
    return (title || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function shouldSkipJobTitle(title) {
    return EXCLUDED_JOB_TITLES.has(normalizeTitleForComparison(title));
}

// ── Main scraping dispatcher ──────────────────────────────────────────────
function scrapeCurrentPage(scrapedJobIds, pageType) {
    if (pageType === 'agency') {
        return scrapeAgencyPage(scrapedJobIds);
    }
    return scrapeMarketplacePage(scrapedJobIds);
}

// ── Career Marketplace scraper (/careersmarketplace/SearchJobs) ───────────
function scrapeMarketplacePage(scrapedJobIds) {
    const jobs = [];
    const jobArticles = document.querySelectorAll('article.article--result');

    jobArticles.forEach((article) => {
        try {
            const titleElement = article.querySelector('h3.article__header__text__title a.link');
            const jobLink = titleElement ? titleElement.href : null;
            if (!jobLink) return;

            const jobTitle = titleElement.textContent.trim();
            if (shouldSkipJobTitle(jobTitle)) return;

            const rawJobId = extractNumericId(jobLink);
            if (!rawJobId || scrapedJobIds.has(rawJobId)) return;
            scrapedJobIds.add(rawJobId);

            const { location, city, state, hospitalName } = extractLocationFromSubtitle(article);

            jobs.push({ jobTitle, jobId: 'MPH-' + rawJobId, location, city, state, hospitalName: hospitalName || '', link: jobLink });
        } catch (err) {
            console.error('Error parsing marketplace article:', err, article);
        }
    });

    return { jobs, scrapedJobIds };
}

// ── Agency Portal scraper (/agency/OpenPositions) ─────────────────────────
// Avature agency portals can render in several layouts; we try them all.
function scrapeAgencyPage(scrapedJobIds) {
    const jobs = [];

    // Strategy 1: Same article structure as marketplace
    let found = tryArticleStrategy(scrapedJobIds, jobs);

    // Strategy 2: Table rows (some Avature agency portals use a <table>)
    if (!found) found = tryTableStrategy(scrapedJobIds, jobs);

    // Strategy 3: Generic list items / divs with job links
    if (!found) found = tryListItemStrategy(scrapedJobIds, jobs);

    // Strategy 4: Last resort — collect all unique job-detail links on the page
    if (!found) tryLinkFallbackStrategy(scrapedJobIds, jobs);

    return { jobs, scrapedJobIds };
}

// Strategy 1 — article.article--result (same as marketplace)
function tryArticleStrategy(scrapedJobIds, jobs) {
    const articles = document.querySelectorAll('article.article--result');
    if (!articles.length) return false;

    articles.forEach((article) => {
        try {
            const titleEl  = article.querySelector('.article__header__text__title a.link, h3 a.link, h2 a.link, h3 a, h2 a');
            const jobLink  = titleEl ? titleEl.href : null;
            if (!jobLink) return;

            const jobTitle = titleEl.textContent.trim();
            if (shouldSkipJobTitle(jobTitle)) return;

            const rawJobId = extractNumericId(jobLink);
            if (!rawJobId || scrapedJobIds.has(rawJobId)) return;
            scrapedJobIds.add(rawJobId);

            const { location, city, state, hospitalName } = extractLocationFromSubtitle(article);

            jobs.push({ jobTitle, jobId: 'MPH-' + rawJobId, location, city, state, hospitalName: hospitalName || '', link: jobLink });
        } catch (err) {
            console.error('Error in article strategy:', err);
        }
    });

    return jobs.length > 0;
}

// Strategy 2 — table rows
function tryTableStrategy(scrapedJobIds, jobs) {
    // Look for table rows that contain a job link
    const rows = document.querySelectorAll('table tr, tbody tr');
    if (!rows.length) return false;

    let found = false;
    rows.forEach((row) => {
        try {
            const link = row.querySelector('a[href*="JobDetail"], a[href*="OpenPositions/"], a[href*="job"]');
            if (!link || !link.href) return;

            // Try to find title — prefer the link text or a dedicated title cell
            const titleCell = row.querySelector('td:first-child, .jobTitle, .title');
            const jobTitle  = (titleCell ? titleCell.textContent : link.textContent).trim() || 'N/A';
            if (shouldSkipJobTitle(jobTitle)) return;

            const rawJobId = extractNumericId(link.href);
            if (!rawJobId || scrapedJobIds.has(rawJobId)) return;
            scrapedJobIds.add(rawJobId);

            // Try to find city / state from other cells
            const cells   = Array.from(row.querySelectorAll('td'));
            const locText  = cells.map(c => c.textContent.trim()).join(' | ');
            const { location, city, state } = parseLocationText(locText);

            jobs.push({ jobTitle, jobId: 'MPH-' + rawJobId, location, city, state, link: link.href });
            found = true;
        } catch (err) {
            console.error('Error in table strategy:', err);
        }
    });

    return found;
}

// Strategy 3 — generic list items (li, div.job-item, div.resultItem, etc.)
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

            const jobTitle = (item.querySelector('.jobTitle, .title, h2, h3, h4') || link).textContent.trim() || 'N/A';
            if (shouldSkipJobTitle(jobTitle)) return;

            const rawJobId = extractNumericId(link.href);
            if (!rawJobId || scrapedJobIds.has(rawJobId)) return;
            scrapedJobIds.add(rawJobId);

            const locEl    = item.querySelector('.location, .city, .jobLocation');
            const { location, city, state } = parseLocationText(locEl ? locEl.textContent : '');

            jobs.push({ jobTitle, jobId: 'MPH-' + rawJobId, location, city, state, link: link.href });
            found = true;
        } catch (err) {
            console.error('Error in list-item strategy:', err);
        }
    });

    return found;
}

// Strategy 4 — collect all unique job-detail links anywhere on the page
function tryLinkFallbackStrategy(scrapedJobIds, jobs) {
    const links = document.querySelectorAll(
        'a[href*="/agency/"][href*="JobDetail"], ' +
        'a[href*="/agency/"][href*="OpenPositions/"], ' +
        'a[href*="avature.net"][href*="JobDetail"]'
    );

    links.forEach((link) => {
        try {
            if (!link.href) return;
            const jobTitle = link.textContent.trim() || 'N/A';
            if (shouldSkipJobTitle(jobTitle)) return;

            const rawJobId = extractNumericId(link.href);
            if (!rawJobId || scrapedJobIds.has(rawJobId)) return;
            scrapedJobIds.add(rawJobId);

            jobs.push({
                jobTitle,
                jobId: 'MPH-' + rawJobId,
                location: 'N/A', city: 'N/A', state: 'N/A',
                link: link.href
            });
        } catch (err) {
            console.error('Error in link-fallback strategy:', err);
        }
    });
}

// ── Pagination ────────────────────────────────────────────────────────────
function findNextPageUrl(pageType) {
    // ── Agency portal: offset-based pagination (?jobOffset=N&jobRecordsPerPage=M) ──
    if (pageType === 'agency') {
        return findNextAgencyPageUrl();
    }

    // ── Marketplace: standard "next" button / rel=next / page param ──
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
    // First try a rendered "next page" link in pagination controls
    const nextContainer = document.querySelector('.list-controls__pagination__item.next, .pagination__next, [aria-label="Next page"]');
    if (nextContainer) {
        const nextLink = nextContainer.querySelector('a');
        if (nextLink && nextLink.href && nextLink.href !== window.location.href) {
            return nextLink.href;
        }
    }

    const relNext = document.querySelector('a[rel="next"]');
    if (relNext && relNext.href && relNext.href !== window.location.href) return relNext.href;

    // Avature agency portal uses ?jobOffset=N&jobRecordsPerPage=M
    // Calculate next offset from current URL params
    const currentUrl = new URL(window.location.href);
    const currentOffset  = parseInt(currentUrl.searchParams.get('jobOffset') || '0', 10);
    const recordsPerPage = parseInt(currentUrl.searchParams.get('jobRecordsPerPage') || '6', 10);

    // Detect total results from the page (Avature usually renders "X-Y of Z results")
    const summaryText = document.body.innerText;
    const totalMatch  = summaryText.match(/\d+\s*[-–]\s*\d+\s+of\s+(\d+)/i);
    const totalJobs   = totalMatch ? parseInt(totalMatch[1], 10) : null;

    const nextOffset = currentOffset + recordsPerPage;

    // Don't go beyond total if we know it
    if (totalJobs !== null && nextOffset >= totalJobs) return null;

    // Build the next URL; preserve all existing params, just bump jobOffset
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set('jobOffset', String(nextOffset));
    // Also look for a jobRecordsPerPage param on any next-page link present on page
    const anyNextLink = document.querySelector('a[href*="jobOffset="]');
    if (anyNextLink) {
        try {
            const linked = new URL(anyNextLink.href);
            const linkedOffset = parseInt(linked.searchParams.get('jobOffset') || '0', 10);
            if (linkedOffset === nextOffset) return anyNextLink.href;
        } catch (_) {}
    }

    return nextUrl.toString();
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

    const anyNextLink = Array.from(document.querySelectorAll('a[href*="jobOffset="]')).find(link => {
        try {
            const linked = new URL(link.href);
            const current = new URL(window.location.href);
            const linkedOffset = parseInt(linked.searchParams.get('jobOffset') || '0', 10);
            const currentOffset = parseInt(current.searchParams.get('jobOffset') || '0', 10);
            return linkedOffset > currentOffset;
        } catch (_) {
            return false;
        }
    });
    if (anyNextLink) return anyNextLink.href;

    const currentUrl = new URL(window.location.href);
    const currentOffset = parseInt(currentUrl.searchParams.get('jobOffset') || '0', 10);
    const recordsPerPage = parseInt(currentUrl.searchParams.get('jobRecordsPerPage') || '6', 10);
    const summaryText = document.body.innerText;
    const rangeMatch = summaryText.match(/(\d+)\s*[-â€“]\s*(\d+)\s+of\s+(\d+)/i);

    if (!rangeMatch) return null;

    const currentEnd = parseInt(rangeMatch[2], 10);
    const totalJobs = parseInt(rangeMatch[3], 10);
    if (!Number.isFinite(currentEnd) || !Number.isFinite(totalJobs) || currentEnd >= totalJobs) {
        return null;
    }

    const nextOffset = currentOffset + recordsPerPage;
    if (!Number.isFinite(nextOffset) || nextOffset >= totalJobs) return null;

    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set('jobOffset', String(nextOffset));
    return nextUrl.toString();
}

// ── Helpers ───────────────────────────────────────────────────────────────

// Extract the first numeric segment from a URL path or ?jobId= query param
function extractNumericId(url) {
    try {
        const parsed = new URL(url);
        // Agency portal uses ?jobId=12345
        const qJobId = parsed.searchParams.get('jobId');
        if (qJobId && /^\d+$/.test(qJobId)) return qJobId;
        // Marketplace uses /path/12345
        const match = parsed.pathname.match(/\/(\d+)/);
        return match ? match[1] : null;
    } catch (_) {
        // Fallback for relative or malformed URLs
        const qMatch = url.match(/[?&]jobId=(\d+)/);
        if (qMatch) return qMatch[1];
        const match = url.match(/\/(\d+)/);
        return match ? match[1] : null;
    }
}

// Extract location + hospital name from Avature article (marketplace & agency)
function extractLocationFromSubtitle(article) {
    let location = 'N/A', city = 'N/A', state = 'N/A', hospitalName = '';

    // ── Strategy A: Agency portal — dedicated span classes ──
    // span.list-item-site     → hospital name
    // span.list-item-location → "City, State" (full state name)
    const siteEl = article.querySelector('span.list-item-site');
    const locEl  = article.querySelector('span.list-item-location');
    if (siteEl) hospitalName = siteEl.textContent.trim();
    if (locEl) {
        const raw = locEl.textContent.trim();
        location = raw;
        const parsed = parseLocationText(raw);
        city  = parsed.city;
        state = parsed.state;
    }

    // ── Strategy B: Marketplace labelled spans "Location:", "City:", "State:" ──
    if (city === 'N/A' && location === 'N/A') {
        const spans = article.querySelectorAll('.article__header__subtitle span.paragraph--inline, .article__header__subtitle span');
        spans.forEach((span) => {
            const text = span.textContent.trim();
            if (text.startsWith('Location:')) location = text.replace(/^Location:\s*/i, '').trim();
            else if (text.startsWith('City:'))  city    = text.replace(/^City:\s*/i, '').trim();
            else if (text.startsWith('State:')) state   = text.replace(/^State:\s*/i, '').trim();
        });
    }

    // ── Strategy C: parse location string if city/state still missing ──
    if ((city === 'N/A' || state === 'N/A') && location !== 'N/A') {
        const parsed = parseLocationText(location);
        if (parsed.city !== 'N/A') { city = parsed.city; state = parsed.state; }
    }

    return { location, city, state, hospitalName };
}

// Full US state name → 2-letter abbreviation map
const STATE_ABBR = {
    'alabama':'AL','alaska':'AK','arizona':'AZ','arkansas':'AR','california':'CA',
    'colorado':'CO','connecticut':'CT','delaware':'DE','florida':'FL','georgia':'GA',
    'hawaii':'HI','idaho':'ID','illinois':'IL','indiana':'IN','iowa':'IA','kansas':'KS',
    'kentucky':'KY','louisiana':'LA','maine':'ME','maryland':'MD','massachusetts':'MA',
    'michigan':'MI','minnesota':'MN','mississippi':'MS','missouri':'MO','montana':'MT',
    'nebraska':'NE','nevada':'NV','new hampshire':'NH','new jersey':'NJ','new mexico':'NM',
    'new york':'NY','north carolina':'NC','north dakota':'ND','ohio':'OH','oklahoma':'OK',
    'oregon':'OR','pennsylvania':'PA','rhode island':'RI','south carolina':'SC',
    'south dakota':'SD','tennessee':'TN','texas':'TX','utah':'UT','vermont':'VT',
    'virginia':'VA','washington':'WA','west virginia':'WV','wisconsin':'WI','wyoming':'WY',
    'district of columbia':'DC'
};

// Parse "City, State" or "City, ST" from a free-form string
function parseLocationText(text) {
    if (!text || text === 'N/A') return { location: 'N/A', city: 'N/A', state: 'N/A' };

    const clean = text.replace(/Location:|City:|State:/gi, '').trim();
    // "City, State Name" or "City, ST"
    const match = clean.match(/^([A-Za-z\s.'()-]+),\s*([A-Za-z\s]{2,})$/);
    if (match) {
        const cityPart  = match[1].trim();
        const statePart = match[2].trim();
        // Convert full name to abbreviation if needed
        const abbr = STATE_ABBR[statePart.toLowerCase()] || statePart;
        return { location: clean, city: cityPart, state: abbr };
    }
    return { location: clean, city: clean, state: 'N/A' };
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
