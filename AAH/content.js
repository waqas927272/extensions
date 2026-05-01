// content.js
function scrapeCurrentPage() {
    const jobs = [];
    function toTitleCasePreserveSeparators(value) {
      return String(value || '')
        .split(/(\s+|-)/)
        .map(part => {
          if (!part || /^\s+$/.test(part) || part === '-') return part;
          if (/^[A-Z]{2,}$/.test(part) && part.length <= 3) return part;
          return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
        })
        .join('');
    }

    function normalizeHospitalName(rawName) {
      let name = String(rawName || '').trim();
      if (!name) return '';

      // Remove trailing location suffix from listings:
      // "CY-FAIR ANIMAL HOSPITAL - ALDINE, TX" -> "CY-FAIR ANIMAL HOSPITAL"
      name = name.replace(/\s*[-–—]\s*[A-Za-z\s.'-]+,\s*[A-Z]{2}\s*$/, '').trim();

      return toTitleCasePreserveSeparators(name);
    }

    function normalizeStateValue(value) {
      const raw = String(value || '').trim();
      if (!raw) return '';
      if (/^[A-Z]{2}$/.test(raw)) return raw;
      return toTitleCasePreserveSeparators(raw);
    }

    function parseHospitalListingValue(rawValue) {
      const raw = String(rawValue || '').replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, '-').trim();
      if (!raw) return { hospital: '', city: '', state: '' };

      // Examples:
      // "CY-FAIR ANIMAL HOSPITAL - ALDINE, TX"
      // "Some Vet Clinic - Los Angeles, California"
      const m = raw.match(/^(.*)\s*-\s*([^,]+)\s*,\s*([A-Za-z]{2}|[A-Za-z][A-Za-z\s.'-]+)\s*$/);
      if (!m) {
        return { hospital: normalizeHospitalName(raw), city: '', state: '' };
      }

      const hospital = normalizeHospitalName(m[1]);
      const city = normalizeCityName(m[2]) || m[2].trim();
      const state = normalizeStateValue(m[3]);
      return { hospital, city, state };
    }

    function getScrapedJobSkipReason(jobTitle) {
      const title = (jobTitle || '').toLowerCase();
      if (/\bmentorship\b/.test(title)) return 'mentorship';
      const hasProtectedRole = /\bassociate\s+veterinarian\b/.test(title) ||
        /\bmedical\s+director\b/.test(title);
      if (hasProtectedRole) return null;

      const skipRules = [
        { label: 'veterinary receptionist', pattern: /\bveterinary\s+receptionist\b/ },
        { label: 'veterinary customer service representative', pattern: /\bveterinary\s+customer\s+service\s+representative\b/ },
        { label: 'licensed veterinary medical technician', pattern: /\blicensed\s+veterinary\s+medical\s+technician\b/ },
        { label: 'veterinary medical technician', pattern: /\bveterinary\s+medical\s+technician\b/ },
        { label: 'veterinary technician', pattern: /\bveterinary\s+technician\b/ },
        { label: 'vet tech / veterinary tech', pattern: /\bvet(?:erinary)?\s+tech(?:nician)?\b/ },
        { label: 'kennel', pattern: /\bkennel\b/ },
        { label: 'veterinary assistant', pattern: /\bveterinary\s+assistant\b/ },
        { label: 'vet assistant / veterinary assistant', pattern: /\bvet(?:erinary)?\s+assistant\b/ },
        { label: 'veterinary office manager', pattern: /\bveterinary\s+office\s+manager\b/ },
        { label: 'veterinary practice manager', pattern: /\bveterinary\s+practice\s+manager\b/ },
        { label: 'veterinary laboratory technician', pattern: /\bveterinary\s+laboratory\s+technician\b/ },
        { label: 'pet bather', pattern: /\bpet\s+bather\b/ },
        { label: 'veterinary surgery technician', pattern: /\bveterinary\s+surgery\s+technician\b/ },
        { label: 'veterinary groomer', pattern: /\bveterinary\s+groomer\b/ },
        { label: 'animal care assistant', pattern: /\banimal\s+care\s+assistant\b/ },
        { label: 'animal care coordinator', pattern: /\banimal\s+care\s+coordinator\b/ },
        { label: 'animal care technician', pattern: /\banimal\s+care\s+technician\b/ },
        { label: 'veterinary student ambassador', pattern: /\bveterinary\s+student\s+ambassador\b/ },
        { label: 'externship', pattern: /\bexternship\b/ },
        { label: 'relief veterinarian', pattern: /\brelief\s+veterinarian\b/ },
        { label: 'dvm veterinary partner and hospital equity owner', pattern: /\bdvm\s+veterinary\s+partner\s*(?:&|and)\s*hospital\s+equity\s+owner\b/ },
        { label: 'seasonal veterinarian', pattern: /\bseasonal\s+veterinarian\b/ }
      ];

      const matchedRule = skipRules.find(rule => rule.pattern.test(title));
      return matchedRule ? matchedRule.label : null;
    }

    function isCleanCityName(city) {
      if (!city) return false;
      const value = city.trim();
      const lower = value.toLowerCase();
      const badWords = [
        'description', 'position', 'associate', 'veterinarian', 'hospital',
        'care', 'center', 'clinic', 'location', 'practice', 'team',
        'beautiful', 'supportive', 'community', 'focused', 'general',
        'located', 'opportunity', 'join', 'seeking', 'looking'
      ];
      if (value.length < 2 || value.length > 35) return false;
      if (/\b(in|near|at|with|for)\b/i.test(value)) return false;
      if (badWords.some(word => lower.includes(word))) return false;
      return /^[A-Za-z][A-Za-z\s.'-]*$/.test(value);
    }

    function normalizeCityName(city) {
      if (!city) return '';
      const value = city.trim();
      if (isCleanCityName(value)) return value;
      const phraseMatch = value.match(/\b(?:located\s+in|in|near|at)\s+(?:beautiful\s+)?([A-Za-z][A-Za-z\s.'-]*?)\s*$/i);
      return phraseMatch && isCleanCityName(phraseMatch[1]) ? phraseMatch[1].trim() : '';
    }

    function parseLocationText(locationText) {
      const parts = locationText.split(',').map(s => s.trim()).filter(Boolean);
      const city = normalizeCityName(parts[0] || '');
      const state = parts[1] || '';
      if (city && /^[A-Z]{2}$/.test(state)) {
        return { city, state, location: `${city}, ${state}` };
      }
      return { city: parts[0] || '', state, location: locationText };
    }

    const skippedJobs = [];
    let totalJobs = 0;
    const table = document.getElementById('jobsListingContainer');
    if (table) {
      const rows = table.querySelectorAll('tbody tr');
      rows.forEach(row => {
        // Check if the row is a data row and not a header or filter row
        if (row.classList.contains('odd') || row.classList.contains('even')) {
          const hospitalNameEl = row.querySelector('th:nth-child(1)');
          const jobTitleEl = row.querySelector('th:nth-child(2) a');
          const locationEl = row.querySelector('th:nth-child(3)');
          const jobTypeEl = row.querySelector('th:nth-child(4)');

          if (hospitalNameEl && jobTitleEl && locationEl) {
            totalJobs++;
            const hospitalListingValue = (hospitalNameEl.innerText || '').trim();
            let hospitalName = hospitalListingValue;
            const jobTitle = jobTitleEl.innerText.trim();
            const skipReason = getScrapedJobSkipReason(jobTitle);
            if (skipReason) {
              skippedJobs.push({ title: jobTitle, reason: skipReason });
              return;
            }
            const link = jobTitleEl.href;
            const locationText = locationEl.innerText.trim();
            const jobType = jobTypeEl ? jobTypeEl.innerText.trim() : '';
            const rawJobId = link ? link.split('/').pop() : '';
            const jobId = rawJobId ? 'AAH-' + rawJobId : '';

            let city = '';
            let state = '';
            let country = 'USA'; // Assuming USA for now, if more countries are present, this logic needs refinement

            const parsedLocation = parseLocationText(locationText);
            city = parsedLocation.city;
            state = parsedLocation.state;

            const finalLocation = (city && state) ? `${city}, ${state}` : parsedLocation.location;

            jobs.push({
              title: jobTitle,
              hospital: hospitalName,
              hospitalName: hospitalName,
              hospitalRaw: hospitalListingValue,
              position: jobTitle, // As per assumption
              city: city,
              state: state,
              country: country,
              location: finalLocation,
              link: link,
              jobType: jobType,
              jobId: jobId
            });
          }
        }
      });
    }
    return { jobs, skippedJobs, totalJobs };
}

function clickNextPage() {
    const tableContainer = document.getElementById('jobsListingContainer_wrapper');
    const allianceNextButton = tableContainer ? tableContainer.querySelector('.paginate_button.next:not(.disabled)') : null;
    const nextButton = allianceNextButton || document.querySelector('.jv-pagination-next');

    if (nextButton && !nextButton.disabled && !nextButton.classList.contains('jv-pagination-disabled') && !nextButton.classList.contains('disabled')) {
        nextButton.click();
        return { clicked: true };
    } else {
        return { clicked: false, error: "Next button not found or is disabled." };
    }
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(getValue, timeoutMs = 2000, intervalMs = 100) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        const value = getValue();
        if (value) return value;
        await wait(intervalMs);
    }
    return null;
}

function getElementText(element) {
    return (element?.innerText || element?.textContent || '').replace(/\s+/g, ' ').trim();
}

function isElementVisible(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

function clickElement(element) {
    element.scrollIntoView({ block: 'center', inline: 'nearest' });
    ['mousedown', 'mouseup'].forEach(type => {
        element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    });
    element.click();
}

function findJobTypeOption(selectElement, targetLabel) {
    const roots = [
        selectElement.parentElement,
        selectElement.closest('.custom-select'),
        selectElement.closest('[class*="select"]'),
        document
    ].filter(Boolean);
    const uniqueRoots = Array.from(new Set(roots));

    for (const root of uniqueRoots) {
        const candidates = Array.from(root.querySelectorAll('label, [role="option"], .select-items div, li, a, button'));
        const option = candidates.find(candidate =>
            getElementText(candidate) === targetLabel && isElementVisible(candidate)
        );
        if (option) return option;
    }

    return null;
}

function getVisibleJobRows() {
    const table = document.getElementById('jobsListingContainer');
    if (!table) return [];
    return Array.from(table.querySelectorAll('tbody tr.odd, tbody tr.even'))
        .filter(row => isElementVisible(row));
}

function getCurrentPaginationPage() {
    const tableContainer = document.getElementById('jobsListingContainer_wrapper');
    const currentButton = tableContainer?.querySelector('.paginate_button.current');
    const currentText = getElementText(currentButton);
    return currentText || '';
}

function isFirstResultsPage() {
    const tableContainer = document.getElementById('jobsListingContainer_wrapper');
    if (!tableContainer) return true;

    const currentPage = getCurrentPaginationPage();
    if (currentPage === '1') return true;

    const previousButton = tableContainer.querySelector('.paginate_button.previous');
    return !!previousButton?.classList.contains('disabled');
}

async function goToFirstResultsPage() {
    const tableContainer = document.getElementById('jobsListingContainer_wrapper');
    if (!tableContainer || isFirstResultsPage()) {
        return true;
    }

    const firstPageButton = Array.from(tableContainer.querySelectorAll('.paginate_button'))
        .find(button => getElementText(button) === '1' && !button.classList.contains('disabled'));

    if (firstPageButton) {
        clickElement(firstPageButton);
        await waitFor(() => isFirstResultsPage() && getVisibleJobRows().length > 0, 3000, 100);
        await wait(1000);
        return isFirstResultsPage();
    }

    for (let i = 0; i < 25 && !isFirstResultsPage(); i++) {
        const previousButton = tableContainer.querySelector('.paginate_button.previous:not(.disabled)');
        if (!previousButton) break;
        clickElement(previousButton);
        await wait(700);
    }

    await waitFor(() => isFirstResultsPage() && getVisibleJobRows().length > 0, 3000, 100);
    return isFirstResultsPage();
}

async function prepareJobTypeFilter(targetLabel = 'DVM Career Opportunities') {
    const jobTypeSelect = document.querySelector('div.select-selected[_target="jobType"]');
    if (!jobTypeSelect) {
        return { success: false, error: 'Job Type dropdown was not found on this page.' };
    }

    if (getElementText(jobTypeSelect) === targetLabel) {
        await wait(5000);
        await goToFirstResultsPage();
        return { success: true, message: `${targetLabel} is already selected.` };
    }

    clickElement(jobTypeSelect);

    const targetOption = await waitFor(
        () => findJobTypeOption(jobTypeSelect, targetLabel),
        2000,
        100
    );

    if (!targetOption) {
        return { success: false, error: `${targetLabel} option was not found in the Job Type dropdown.` };
    }

    clickElement(targetOption);
    await wait(5000);
    const isOnFirstPage = await goToFirstResultsPage();
    if (!isOnFirstPage) {
        return { success: false, error: 'Could not return the jobs table to page 1 before scraping.' };
    }
    return { success: true, message: `Selected ${targetLabel}.` };
}

function applyFiltersAndSearch() {
    const categorySelect = document.getElementById('jv-search-category');
    const searchButton = document.querySelector('.jv-search-form .jv-button-primary');

    if (!categorySelect || !searchButton) {
        return { success: false, error: "Filters or Search button not found." };
    }

    const targetCategories = [
        "Specialty Diplomate",
        "Surgeon Diplomate",
        "Veterinarian (ER)",
        "Veterinarian (Gen Practice)"
    ];

    // Clear existing selections
    Array.from(categorySelect.options).forEach(option => option.selected = false);

    // Select target categories
    let selectedCount = 0;
    Array.from(categorySelect.options).forEach(option => {
        if (targetCategories.includes(option.value.trim()) || targetCategories.includes(option.text.trim())) {
            option.selected = true;
            selectedCount++;
        }
    });

    if (selectedCount === 0) {
        return { success: false, error: "Target categories not found in dropdown." };
    }

    // Trigger change event for AngularJS
    categorySelect.dispatchEvent(new Event('change', { bubbles: true }));

    // Click search
    searchButton.click();

    return { success: true, message: `Selected ${selectedCount} categories and clicked Search.` };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'applyFiltersAndSearch') {
    const result = applyFiltersAndSearch();
    sendResponse(result);
    return true;
  } else if (request.action === 'prepareJobTypeFilter') {
    prepareJobTypeFilter(request.targetLabel)
      .then(sendResponse)
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  } else if (request.action === 'scrapeCurrentPage') {
    const result = scrapeCurrentPage();
    sendResponse({
      jobs: result.jobs,
      skippedJobs: result.skippedJobs,
      totalJobs: result.totalJobs
    });
    return true; // Indicate asynchronous response
  } else if (request.action === 'clickNextPage') {
    const result = clickNextPage();
    sendResponse(result);
    return true; // Indicate asynchronous response
  }
});
