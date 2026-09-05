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
        // Only validate records collected on this page. Existing records may come
        // from an older extension version where city/state were stored differently;
        // re-filtering them here can erase the user's saved data after a reload.
        const validNewJobs = newScrape.jobs.filter(hasCompleteCityAndState);
        const allJobs = (data.scrapedJobs || []).concat(validNewJobs);
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

function hasCompleteCityAndState(job) {
    const city = (job?.city || '').replace(/\s+/g, ' ').trim();
    const state = (job?.state || '').replace(/\s+/g, ' ').trim();
    if (!isUsableCityValue(city) || !isRecognizedStateValue(state)) return false;
    return ![city, state].some(value => /\b(?:remote|nationwide)\b/i.test(value));
}

function isUsableCityValue(value) {
    const city = (value || '').replace(/\s+/g, ' ').trim();
    if (!city || city.length > 80 || !/[A-Za-z]/.test(city) || !/[AEIOUY]/i.test(city)) return false;
    return !/^(?:-|n\/?a|none|null|undefined|unknown|tbd|dnt|not available|remote|nationwide)$/i.test(city);
}

function isRecognizedStateValue(value) {
    const state = (value || '').replace(/\s+/g, ' ').trim();
    return /^[A-Z]{2}$/i.test(state) || Object.prototype.hasOwnProperty.call(STATE_ABBR, state.toLowerCase());
}

function recoverInvalidCardCity(city, state, hospital) {
    if (isUsableCityValue(city) || !isRecognizedStateValue(state)) return city;

    // Some Avature cards contain a broken City value even though the Job Site
    // identifies the locality in parentheses, for example "(Flower Mound)".
    // Require a multi-word locality so a neighborhood/branch label such as
    // "Kempsville" is never silently treated as a city.
    const parenthetical = String(hospital || '').match(/\(([^()]+)\)\s*$/);
    const candidate = parenthetical?.[1]?.replace(/\s+/g, ' ').trim() || '';
    return candidate.split(/\s+/).length >= 2 && isUsableCityValue(candidate) ? candidate : city;
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
            const { location, city, state, hospital } = extractLocationFromSubtitle(article);
            if (!hasCompleteCityAndState({ city, state })) return;

            scrapedJobIds.add(rawJobId);
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
            const { location, city, state, hospital } = extractLocationFromSubtitle(article);
            if (!hasCompleteCityAndState({ city, state })) return;

            scrapedJobIds.add(rawJobId);
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
            const cells = Array.from(row.querySelectorAll('td'));
            const locText = cells.map(cell => cell.textContent.trim()).join(' | ');
            const parsed = parseLocationText(locText);
            if (!hasCompleteCityAndState(parsed)) return;

            scrapedJobIds.add(rawJobId);

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
            const locEl = item.querySelector('.location, .city, .jobLocation');
            const parsed = parseLocationText(locEl ? locEl.textContent : '');
            if (!hasCompleteCityAndState(parsed)) return;

            scrapedJobIds.add(rawJobId);

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
            const container = link.closest('article, li, tr, .job-item, .resultItem, .openPosition, .vacancy-item');
            const locationText = container?.querySelector('.location, .city, .jobLocation, .list-item-location')?.textContent || '';
            const parsed = parseLocationText(locationText);
            if (!hasCompleteCityAndState(parsed)) return;
            scrapedJobIds.add(rawJobId);

            jobs.push({
                title,
                jobId: `MPH-${rawJobId}`,
                location: parsed.location,
                city: parsed.city,
                state: parsed.state,
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

    const spans = article.querySelectorAll('.article__header__subtitle span.paragraph--inline, .article__header__subtitle span');
    spans.forEach((span) => {
        const text = span.textContent.replace(/\s+/g, ' ').trim();
        const label = span.querySelector('strong')?.textContent.replace(/:\s*$/, '').trim().toLowerCase() || '';
        const value = label
            ? text.replace(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:?\\s*`, 'i'), '').trim()
            : text;

        if (!value) return;
        if (label === 'location' || label === 'site' || label === 'practice') {
            hospital = value;
        } else if (label === 'city') {
            city = value;
        } else if (label === 'state' || label === 'province') {
            state = value;
        } else if (label === 'work location' || label === 'job location') {
            const parsed = parseLocationText(value);
            location = parsed.location;
            city = parsed.city;
            state = parsed.state;
        }
    });

    const siteEl = article.querySelector('span.list-item-site');
    if (!hospital && siteEl) hospital = siteEl.textContent.trim();

    const locEl = article.querySelector('span.list-item-location');
    if (!location && !city && locEl) {
        const parsed = parseLocationText(locEl.textContent.trim());
        location = parsed.location;
        city = parsed.city;
        state = parsed.state;
    }

    city = removeTrailingStateFragment(city, state);
    city = recoverInvalidCardCity(city, state, hospital);

    if (city || state) {
        location = [city, state].filter(Boolean).join(', ');
    }

    return { location, city, state, hospital };
}

function removeTrailingStateFragment(city, state) {
    const cleanCity = (city || '').replace(/\s+/g, ' ').trim();
    const cleanState = (state || '').replace(/\s+/g, ' ').trim();
    if (!cleanCity || !cleanState) return cleanCity;

    const stateName = STATE_ABBR[cleanState.toLowerCase()]
        ? cleanState
        : (Object.entries(STATE_ABBR).find(([, abbreviation]) => abbreviation === cleanState.toUpperCase())?.[0] || cleanState);
    const parts = cleanCity.split(' ');
    const trailing = (parts[parts.length - 1] || '').toLowerCase();
    const normalizedState = stateName.toLowerCase().replace(/[^a-z]/g, '');

    // Avature occasionally appends a truncated state to City (for example,
    // "Brunswick Mai" with State "Maine"). Remove only a 3+ character final
    // token that is an exact prefix of the separately supplied state.
    if (trailing.length >= 3 && trailing !== normalizedState && normalizedState.startsWith(trailing)) {
        parts.pop();
        return parts.join(' ').trim();
    }
    return cleanCity;
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
