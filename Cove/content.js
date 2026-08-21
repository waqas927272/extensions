// content.js - CoveNew job scraper for ClearCompany listings page
if (!window.__COVENEW_SCRAPER_INITIALIZED__) {
    window.__COVENEW_SCRAPER_INITIALIZED__ = true;

    const EXCLUDED_JOB_TITLE_PATTERN = /\b(?:digital\s+marketing|marketing|business\s+partner|student|externship|extern|internship|intern|veterinary\s+referral\s+manager|certified\s+canine\s+rehabilitation\s+practitioner|veterinary\s+emergency\s+administrative\s+liaison|mentor(?:ship|ing|ed|s)?|locum(?:s)?|relie(?:f|ver|vers)|releif|technician|veterinary\s+assistant|assistant|client\s+services?\s+coordinator|client\s+care\s+coordinator|client\s+services?|kennel\s+technician|hospital\s+manager|veterinary\s+(?:or\s+)?supervisor|veterinary[\w\s-]*specialty[\w\s-]*surgical[\w\s-]*supervisor|specialty[\w\s-]*surgical[\w\s-]*supervisor|area\s+director\s+of\s+operations|veterinary\s+department\s+manager|department\s+manager|veterinary\s+coordinator)\b/i;
    const ALLOWED_JOB_TITLE_PATTERN = /\b(?:associate\s+veterinarian|lead\s+veterinarian|partner\s+veterinarian|veterinarian|dvm|medical\s+director|anesthesiologist|cardiologist|criticalist|ecc\s+specialist|internal\s+medicine\s+specialist|internist|dental\s+specialist|dermatologist|medical\s+oncologist|neurologist|neurosurgeon|ophthalmologist|radiation\s+oncologist|radiologist|surgeon|diplomate|board\s+certified|residency[-\s]+trained|dacv(?:ecc|im|r|s|d|o|aa)?|dacvr[-\s]?ro|davdc|dabvp)\b/i;

    function isExcludedJobListing(title, jobType = '') {
        const listingText = `${title || ''} ${jobType || ''}`;
        return EXCLUDED_JOB_TITLE_PATTERN.test(listingText) || !ALLOWED_JOB_TITLE_PATTERN.test(listingText);
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

    function cleanLocationText(text) {
        return (text || '')
            .replace(/\b(?:location|locations)\s*:\s*/ig, '')
            .replace(/\b(?:full-time|part-time|full time|part time|remote|hybrid)\b/ig, '')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/^[\s,|/-]+|[\s,|/-]+$/g, '');
    }

    function getLocationText(item) {
        const selectors = [
            '.cc-location-label',
            '[class*="location" i]',
            '[data-automation-id*="location" i]',
            '[aria-label*="location" i]',
            '[title*=","]'
        ];

        for (const selector of selectors) {
            const nodes = Array.from(item.querySelectorAll(selector));
            for (const node of nodes) {
                const value = cleanLocationText(node.textContent || node.getAttribute('aria-label') || node.getAttribute('title') || '');
                if (/[A-Z]{2}\b/.test(value) || /,\s*[A-Za-z ]+$/.test(value)) return value;
            }
        }

        const locationPattern = /([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,4},\s*[A-Z]{2})(?=\s|$)/;
        const lines = (item.innerText || item.textContent || '')
            .split(/\n+/)
            .map(cleanLocationText)
            .filter(Boolean);

        for (const line of lines) {
            const match = line.match(locationPattern);
            if (match) return match[1].trim();
        }

        const cardText = cleanLocationText(item.textContent || '');
        const match = cardText.match(locationPattern);
        return match ? match[1].trim() : '';
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

            const locationText = getLocationText(item);
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
            if (jobs.length > 0 && jobs.every(job => job.location)) return jobs;

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
