// content.js
// Job scraping logic copied from encore folder and adapted to encoreNew message actions.
if (!window.__ENCORENEW_SCRAPER_INITIALIZED__) {
window.__ENCORENEW_SCRAPER_INITIALIZED__ = true;

function isExcludedJobListing(title) {
    const t = (title || '').toLowerCase();
    if (!t) return false;
    if (/\bmentor(?:ship|ing|ed|s)?\b|\blocum(?:s)?\b|\brelie(?:f|ver|vers)\b|\breleif\b/.test(t)) return true;
    if (/\bcustomer service representative\b/.test(t)) return true;
    if (/\btechnician\b/.test(t)) return true;
    if (/\bfield marketing specialist\b/.test(t)) return true;
    if (/\bfield support\b/.test(t)) return true;
    if (/\banimal care attendant\b/.test(t)) return true;
    if (/\bpractice manager\b/.test(t)) return true;
    if (/\bkennel\b/.test(t)) return true;
    if (/\bveterinary assistant\b/.test(t)) return true;
    if (/\bextern\b/.test(t)) return true;
    if (/\bgroomer\b/.test(t)) return true;
    return false;
}

function parseCityState(cityStateText) {
    const raw = (cityStateText || '').trim();
    if (!raw) return { city: '', state: '' };
    const m = raw.match(/^(.+),\s*(.+)$/);
    if (m) return { city: m[1].trim(), state: m[2].trim() };
    return { city: raw, state: '' };
}

function scrapeCurrentPage() {
    const scrapedJobs = [];
    const cards = document.querySelectorAll('.search-result-item, a.job-item');

    cards.forEach((card) => {
        try {
            const titleEl = card.querySelector('[itemprop="title"]');
            const title = titleEl ? titleEl.innerText.trim() : '';

            const linkEl = card.querySelector('.job-title-link');
            const link = linkEl ? linkEl.href : '';

            if (!title || !link || isExcludedJobListing(title)) return;

            let jobId = '';
            const jobIdMatch = link.match(/\/jobs?\/(\d+)/);
            const rawJobId = jobIdMatch
                ? jobIdMatch[1]
                : (link.split('/').filter((s) => /^\d+$/.test(s))[0] || '');
            if (rawJobId) jobId = `ENC-${rawJobId}`;

            const reqIdEl = card.querySelector('.req-id span');
            const reqId = reqIdEl ? reqIdEl.innerText.trim() : '';

            const locationEl = card.querySelector('.label-value.location');
            let hospital = '';
            let streetAddress = '';
            let city = '';
            let state = '';
            let location = '';

            if (locationEl) {
                const lines = locationEl.innerText
                    .split('\n')
                    .map((l) => l.trim())
                    .filter(Boolean);

                hospital = lines[0] || '';
                streetAddress = lines[1] || '';
                const cityStateLine = lines[2] || '';
                const parsed = parseCityState(cityStateLine);
                city = parsed.city;
                state = parsed.state;
                location = [city, state].filter(Boolean).join(', ');
            }

            if (!location) {
                const locMeta = card.querySelector('.jv-job-list-location');
                if (locMeta && locMeta.innerText) {
                    location = locMeta.innerText.trim();
                    const parsed = parseCityState(location);
                    city = city || parsed.city;
                    state = state || parsed.state;
                }
            }

            const categoryEl = card.querySelector('.categories.label-value');
            const category = categoryEl ? categoryEl.innerText.trim() : '';

            scrapedJobs.push({
                title,
                jobId,
                reqId,
                hospital,
                streetAddress,
                city,
                state,
                location,
                category,
                link
            });
        } catch (e) {
            console.error('Error scraping job card:', e);
        }
    });

    return scrapedJobs;
}

function waitForPageLoad(timeout = 12000) {
    return new Promise((resolve) => {
        const started = Date.now();
        let prevCount = document.querySelectorAll('.search-result-item, a.job-item').length;
        let stable = 0;

        const tick = () => {
            const currentCount = document.querySelectorAll('.search-result-item, a.job-item').length;
            if (currentCount > 0 && currentCount === prevCount) {
                stable++;
                if (stable >= 2) {
                    setTimeout(resolve, 500);
                    return;
                }
            } else {
                stable = 0;
                prevCount = currentCount;
            }

            if (Date.now() - started > timeout) {
                resolve();
                return;
            }
            setTimeout(tick, 300);
        };

        setTimeout(tick, 500);
    });
}

async function clickNextPage() {
    const nextBtn = document.querySelector('[aria-label="Next Page of Job Search Results"]')
        || document.querySelector('.mat-paginator-navigation-next')
        || document.querySelector('.jv-pagination-next');

    if (nextBtn && !nextBtn.disabled && !nextBtn.classList.contains('mat-button-disabled') && !nextBtn.classList.contains('jv-pagination-disabled')) {
        nextBtn.click();
        await new Promise((resolve) => setTimeout(resolve, 1300));
        await waitForPageLoad();
        return { clicked: true };
    }
    return { clicked: false, error: 'Next button not found or disabled.' };
}

function applyFiltersAndSearch() {
    return { success: true, message: 'No filter action required in content script.' };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'applyFiltersAndSearch') {
        sendResponse(applyFiltersAndSearch());
        return true;
    } else if (request.action === 'scrapeCurrentPage') {
        sendResponse({ jobs: scrapeCurrentPage() });
        return true;
    } else if (request.action === 'clickNextPage') {
        clickNextPage().then(sendResponse).catch(() => sendResponse({ clicked: false }));
        return true;
    }
});
}
