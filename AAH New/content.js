// content.js
const AAH_TARGET_JOB_TYPE = 'DVM Career Opportunities';

function cleanText(value) {
    return (value || '').replace(/\s+/g, ' ').trim();
}

function getAllianceJobId(link) {
    if (!link) return '';
    try {
        const url = new URL(link);
        const rawId = url.pathname.replace(/\/+$/, '').split('/').pop() || '';
        return rawId ? `AAH-${rawId}` : '';
    } catch (e) {
        const rawId = link.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop() || '';
        return rawId ? `AAH-${rawId}` : '';
    }
}

function parseLocation(locationText) {
    const parts = cleanText(locationText).split(',').map(part => part.trim()).filter(Boolean);
    return {
        city: parts[0] || '',
        state: parts[1] || ''
    };
}

function isAllianceJobsTablePage() {
    return !!document.querySelector('#jobsListingContainer');
}

function scrapeAllianceJobsTable() {
    const scrapedJobs = [];
    const rows = document.querySelectorAll('#jobsListingContainer tbody tr');

    rows.forEach(row => {
        if (row.classList.contains('child') || row.querySelector('td.dataTables_empty')) return;

        const cells = Array.from(row.children).filter(cell => {
            const text = cleanText(cell.innerText);
            return text || cell.querySelector('a[href]');
        });

        if (cells.length < 4) return;

        const hospital = cleanText(cells[0]?.innerText);
        const titleLink = cells[1]?.querySelector('a[href]');
        const title = cleanText(titleLink?.innerText || cells[1]?.innerText);
        const link = titleLink?.href || '';
        const location = cleanText(cells[2]?.innerText);
        const jobType = cleanText(cells[3]?.innerText);
        const hospitalType = cleanText(cells[4]?.innerText);
        const { city, state } = parseLocation(location);
        const jobId = getAllianceJobId(link);

        if (!title || !link) return;

        scrapedJobs.push({
            title,
            jobId,
            hospital,
            city,
            state,
            link,
            location,
            jobType,
            hospitalType
        });
    });

    return scrapedJobs;
}

function scrapeJobviteCurrentPage() {
    const scrapedJobs = [];
    const jobItems = document.querySelectorAll('a.job-item');

    jobItems.forEach(jobItem => {
        const titleElement = jobItem.querySelector('.jv-job-list-name');
        const locationElement = jobItem.querySelector('.jv-job-list-location');
        const companyElement = jobItem.querySelector('.jv-job-list-company');

        const title = cleanText(titleElement?.innerText) || 'N/A';
        const hospital = cleanText(companyElement?.innerText) || 'N/A';
        const link = jobItem.href;

        let jobId = '';
        if (link) {
            const urlPath = link.replace(/[?#].*$/, '').replace(/\/+$/, '');
            const rawJobId = urlPath.split('/').pop() || '';
            jobId = rawJobId ? 'UVC-' + rawJobId : '';
        }

        const location = cleanText(locationElement?.innerText);
        scrapedJobs.push({ title, jobId, hospital, city: '', state: '', link, location });
    });

    return scrapedJobs;
}

function scrapeCurrentPage() {
    if (isAllianceJobsTablePage()) return scrapeAllianceJobsTable();
    return scrapeJobviteCurrentPage();
}

function clickAllianceNextPage() {
    const nextButton = document.querySelector('#jobsListingContainer_next');
    if (!nextButton) return { clicked: false, error: 'Next button not found.' };

    const isDisabled = nextButton.classList.contains('disabled') ||
        nextButton.getAttribute('aria-disabled') === 'true';

    if (isDisabled) return { clicked: false, error: 'Next button is disabled.' };

    nextButton.click();
    return { clicked: true };
}

function clickJobviteNextPage() {
    const nextButton = document.querySelector('.jv-pagination-next');
    if (nextButton && !nextButton.disabled && !nextButton.classList.contains('jv-pagination-disabled')) {
        nextButton.click();
        return { clicked: true };
    }
    return { clicked: false, error: 'Next button not found or is disabled.' };
}

function clickNextPage() {
    if (isAllianceJobsTablePage()) return clickAllianceNextPage();
    return clickJobviteNextPage();
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isVisible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
}

async function waitForAllianceTableRows(timeoutMs = 8000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const rows = Array.from(document.querySelectorAll('#jobsListingContainer tbody tr'))
            .filter(row => !row.classList.contains('child') && !row.querySelector('td.dataTables_empty'));

        if (rows.some(row => cleanText(row.innerText).includes(AAH_TARGET_JOB_TYPE))) {
            return true;
        }
        await wait(250);
    }
    return false;
}

async function applyAllianceFiltersAndSearch() {
    const table = document.querySelector('#jobsListingContainer');
    const jobTypeSelect = document.querySelector('.select-selected[_target="jobType"]');

    if (!table || !jobTypeSelect) {
        return { success: false, error: 'Could not find the Alliance job table or Job Type filter.' };
    }

    jobTypeSelect.click();
    await wait(300);

    const labels = Array.from(document.querySelectorAll('label'))
        .filter(label => cleanText(label.innerText) === AAH_TARGET_JOB_TYPE);

    const targetLabel = labels.find(label => isVisible(label)) || labels[0];
    if (!targetLabel) {
        return { success: false, error: `Could not find "${AAH_TARGET_JOB_TYPE}" in the Job Type filter.` };
    }

    const relatedInput = targetLabel.control ||
        targetLabel.querySelector('input') ||
        targetLabel.closest('li, div')?.querySelector('input');

    if (relatedInput && relatedInput.type === 'checkbox') {
        if (!relatedInput.checked) relatedInput.click();
    } else {
        targetLabel.click();
    }

    targetLabel.dispatchEvent(new Event('change', { bubbles: true }));
    document.dispatchEvent(new Event('change', { bubbles: true }));

    const rowsLoaded = await waitForAllianceTableRows();
    const currentRows = scrapeAllianceJobsTable();

    return {
        success: currentRows.length > 0,
        message: rowsLoaded
            ? `Selected "${AAH_TARGET_JOB_TYPE}" and found matching rows.`
            : `Selected "${AAH_TARGET_JOB_TYPE}".`,
        rowCount: currentRows.length
    };
}

function applyJobviteFiltersAndSearch() {
    const categorySelect = document.getElementById('jv-search-category');
    const searchButton = document.querySelector('.jv-search-form .jv-button-primary');

    if (!categorySelect || !searchButton) {
        return { success: false, error: 'Filters or Search button not found.' };
    }

    const targetCategories = [
        'Specialty Diplomate',
        'Surgeon Diplomate',
        'Veterinarian (ER)',
        'Veterinarian (Gen Practice)'
    ];

    Array.from(categorySelect.options).forEach(option => option.selected = false);

    let selectedCount = 0;
    Array.from(categorySelect.options).forEach(option => {
        if (targetCategories.includes(cleanText(option.value)) || targetCategories.includes(cleanText(option.text))) {
            option.selected = true;
            selectedCount++;
        }
    });

    if (selectedCount === 0) {
        return { success: false, error: 'Target categories not found in dropdown.' };
    }

    categorySelect.dispatchEvent(new Event('change', { bubbles: true }));
    searchButton.click();

    return { success: true, message: `Selected ${selectedCount} categories and clicked Search.` };
}

function applyFiltersAndSearch() {
    if (isAllianceJobsTablePage()) return applyAllianceFiltersAndSearch();
    return applyJobviteFiltersAndSearch();
}

if (!window.__aahJobScraperContentListenerRegistered) {
    window.__aahJobScraperContentListenerRegistered = true;

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'applyFiltersAndSearch') {
            Promise.resolve(applyFiltersAndSearch())
                .then(sendResponse)
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true;
        }

        if (request.action === 'scrapeCurrentPage') {
            const jobs = scrapeCurrentPage();
            sendResponse({ jobs: jobs });
            return true;
        }

        if (request.action === 'clickNextPage') {
            const result = clickNextPage();
            sendResponse(result);
            return true;
        }
    });
}
