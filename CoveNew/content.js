// content.js - CoveNew job scraper for ClearCompany listings page
if (!window.__COVENEW_SCRAPER_INITIALIZED__) {
    window.__COVENEW_SCRAPER_INITIALIZED__ = true;

    const EXCLUDED_JOB_TITLE_PATTERN = /\b(?:mentor(?:ship|ing|ed|s)?|locum(?:s)?|relie(?:f|ver|vers)|releif|technician|veterinary\s+assistant|assistant|client\s+services?\s+coordinator|client\s+care\s+coordinator|client\s+services?|kennel\s+technician|hospital\s+manager|veterinary\s+(?:or\s+)?supervisor|veterinary[\w\s-]*specialty[\w\s-]*surgical[\w\s-]*supervisor|specialty[\w\s-]*surgical[\w\s-]*supervisor|area\s+director\s+of\s+operations|veterinary\s+department\s+manager|department\s+manager|veterinary\s+coordinator)\b/i;

    function isExcludedJobListing(title, jobType = '') {
        return EXCLUDED_JOB_TITLE_PATTERN.test(`${title || ''} ${jobType || ''}`);
    }

    function parseCityState(locationText) {
        const text = (locationText || '').trim().replace(/\s+/g, ' ');
        if (!text) return { city: '', state: '' };

        const m = text.match(/^(.*?)(?:,\s*)?([A-Z]{2})$/);
        if (m) {
            return { city: m[1].trim(), state: m[2].trim() };
        }

        const parts = text.split(',').map(s => s.trim()).filter(Boolean);
        if (parts.length >= 2) return { city: parts[0], state: parts[1] };
        return { city: text, state: '' };
    }

    function buildJobIdFromLink(link) {
        if (!link) return '';
        try {
            const u = new URL(link, window.location.origin);
            const jobId = u.searchParams.get('jobId') || u.searchParams.get('jobid');
            if (jobId) return `COV-${jobId}`;
        } catch (_) {}
        const fallback = String(link).split('/').pop() || '';
        return fallback ? `COV-${fallback}` : '';
    }

    function scrapeCurrentPageNow() {
        const scrapedJobs = [];
        const jobItems = document.querySelectorAll('.cc-jobs-container .cc-job-container');

        jobItems.forEach(item => {
            const titleAnchor = item.querySelector('a.cc-job-title');
            if (!titleAnchor) return;

            const title = (titleAnchor.textContent || '').trim();
            const link = titleAnchor.href || '';
            if (!title || !link) return;
            if (isExcludedJobListing(title)) return;

            const locationEl = item.querySelector('.cc-location-label');
            const locationText = (locationEl?.textContent || '').trim();
            const { city, state } = parseCityState(locationText);

            scrapedJobs.push({
                title,
                jobId: buildJobIdFromLink(link),
                hospital: '',
                city,
                state,
                link,
                location: [city, state].filter(Boolean).join(', ')
            });
        });

        return scrapedJobs;
    }

    async function scrapeCurrentPage() {
        const wait = (ms) => new Promise(r => setTimeout(r, ms));
        const maxWaitMs = 12000;
        const start = Date.now();

        while (Date.now() - start < maxWaitMs) {
            const jobs = scrapeCurrentPageNow();
            if (jobs.length > 0) return jobs;

            // If ClearCompany container exists but jobs are still loading, keep waiting.
            const hasClearCompanyContainer = !!document.querySelector('.cc-careers-container, .cc-jobs-container');
            if (!hasClearCompanyContainer) {
                await wait(300);
                continue;
            }
            await wait(400);
        }

        return scrapeCurrentPageNow();
    }

    function clickNextPage() {
        const rightControl = document.querySelector('.cc-page-controls .cc-right-control.cc-page-control.cc-clickable:not([disabled])');
        if (rightControl) {
            rightControl.click();
            return { clicked: true };
        }

        const current = document.querySelector('.cc-page-controls .cc-page-control.cc-current-page');
        if (current) {
            const next = current.nextElementSibling;
            if (next && next.classList.contains('cc-page-control') && next.classList.contains('cc-clickable')) {
                next.click();
                return { clicked: true };
            }
        }

        return { clicked: false, error: 'Next page control not found or unavailable.' };
    }

    function applyFiltersAndSearch() {
        return { success: true, message: 'No filters required for this source.' };
    }

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'applyFiltersAndSearch') {
            sendResponse(applyFiltersAndSearch());
            return true;
        } else if (request.action === 'scrapeCurrentPage') {
            scrapeCurrentPage()
                .then((jobs) => sendResponse({ jobs }))
                .catch(() => sendResponse({ jobs: [] }));
            return true;
        } else if (request.action === 'clickNextPage') {
            const result = clickNextPage();
            sendResponse(result);
            return true;
        }
    });
}
