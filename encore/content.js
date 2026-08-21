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
            if (rawJobId) jobId = `E-${rawJobId}`;

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
                location = lines[2] || '';
            }

            if (!location) {
                const locMeta = card.querySelector('.jv-job-list-location');
                if (locMeta && locMeta.innerText) {
                    location = locMeta.innerText.trim();
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

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForCondition(checkFn, timeout = 5000, interval = 200) {
    return new Promise((resolve) => {
        const started = Date.now();

        const tick = () => {
            const result = checkFn();
            if (result) {
                resolve(result);
                return;
            }

            if (Date.now() - started > timeout) {
                resolve(null);
                return;
            }

            setTimeout(tick, interval);
        };

        tick();
    });
}

function cleanText(value) {
    return (value || '').replace(/\s+/g, ' ').trim();
}

function findCategoriesSelect() {
    const labels = Array.from(document.querySelectorAll('mat-label, .mat-form-field-label'));

    for (const label of labels) {
        if (!/Categories/i.test(label.textContent || '')) continue;

        const formField = label.closest('.mat-form-field') || label.closest('.mat-form-field-wrapper') || label.parentElement;
        const select = formField?.querySelector('mat-select');
        if (select) return select;
    }

    return Array.from(document.querySelectorAll('mat-select')).find((select) =>
        /Categories/i.test(select.closest('.mat-form-field')?.textContent || select.getAttribute('aria-labelledby') || '')
    ) || null;
}

function getOpenSelectPanel(select) {
    if (select?.id) {
        const exactPanel = document.getElementById(`${select.id}-panel`);
        if (exactPanel) return exactPanel;
    }

    const panels = Array.from(document.querySelectorAll('[role="listbox"].mat-select-panel, .mat-select-panel[role="listbox"]'));
    return panels.find((panel) => panel.offsetParent !== null) || panels[0] || null;
}

function clickElementCenter(element) {
    const rect = element.getBoundingClientRect();
    const options = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2
    };

    element.dispatchEvent(new MouseEvent('mousedown', options));
    element.dispatchEvent(new MouseEvent('mouseup', options));
    element.dispatchEvent(new MouseEvent('click', options));
}

async function openCategoriesPanel(select) {
    const trigger = select.querySelector('.mat-select-trigger') || select;

    if (select.getAttribute('aria-expanded') !== 'true') {
        clickElementCenter(trigger);
    }

    return waitForCondition(() => getOpenSelectPanel(select), 5000, 100);
}

function findCategoryOption(panel, category) {
    const options = Array.from(panel.querySelectorAll('mat-option[role="option"], mat-option'));

    return options.find((option) => {
        const text = cleanText(option.querySelector('.mat-option-text')?.textContent || option.textContent || '');
        const label = text.replace(/\s*\(\d+\)\s*$/, '');
        return label === category;
    }) || null;
}

async function selectCategoryOption(select, category) {
    const panel = await openCategoriesPanel(select);
    if (!panel) return { selected: false, message: 'Categories dropdown did not open.' };

    const option = findCategoryOption(panel, category);
    if (!option) return { selected: false, message: `${category} option was not found.` };

    if (option.getAttribute('aria-selected') === 'true') {
        return { selected: true };
    }

    const checkbox = option.querySelector('mat-pseudo-checkbox') || option;
    checkbox.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    await wait(100);
    clickElementCenter(checkbox);

    const verified = await waitForCondition(() => {
        const currentPanel = getOpenSelectPanel(select) || panel;
        const currentOption = currentPanel ? findCategoryOption(currentPanel, category) : option;
        return currentOption?.getAttribute('aria-selected') === 'true' ? currentOption : null;
    }, 2500, 100);

    return { selected: !!verified };
}

async function applyFiltersAndSearch() {
    const select = findCategoriesSelect();
    if (!select) {
        return { success: false, message: 'Categories filter dropdown was not found.' };
    }

    const requiredCategories = ['Medical Directors', 'Veterinarian'];
    const selected = [];
    const missing = [];

    for (const category of requiredCategories) {
        const result = await selectCategoryOption(select, category);
        if (result.selected) selected.push(category);
        else missing.push(category);
    }

    if (select.getAttribute('aria-expanded') === 'true') {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        await wait(250);
    }

    return {
        success: missing.length === 0,
        message: missing.length ? `Could not select category filter(s): ${missing.join(', ')}` : 'Category filters applied.',
        selected,
        missing
    };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'applyFiltersAndSearch') {
        applyFiltersAndSearch()
            .then(sendResponse)
            .catch((error) => sendResponse({ success: false, message: error.message }));
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
