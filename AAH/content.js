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

    function shouldSkipScrapedJob(jobTitle) {
      const title = (jobTitle || '').toLowerCase();
      if (/\bmentorship\b/.test(title)) return true;
      const hasProtectedRole = /\bassociate\s+veterinarian\b/.test(title) ||
        /\bmedical\s+director\b/.test(title);
      if (hasProtectedRole) return false;

      return /\bveterinary\s+receptionist\b/.test(title) ||
        /\bveterinary\s+customer\s+service\s+representative\b/.test(title) ||
        /\bveterinary\s+technician\b/.test(title) ||
        /\bveterinary\s+medical\s+technician\b/.test(title) ||
        /\blicensed\s+veterinary\s+medical\s+technician\b/.test(title) ||
        /\bvet(?:erinary)?\s+tech(?:nician)?\b/.test(title) ||
        /\bkennel\b/.test(title) ||
        /\bveterinary\s+assistant\b/.test(title) ||
        /\bvet(?:erinary)?\s+assistant\b/.test(title) ||
        /\bveterinary\s+office\s+manager\b/.test(title) ||
        /\bveterinary\s+practice\s+manager\b/.test(title) ||
        /\bveterinary\s+laboratory\s+technician\b/.test(title) ||
        /\bpet\s+bather\b/.test(title) ||
        /\bveterinary\s+surgery\s+technician\b/.test(title) ||
        /\bveterinary\s+groomer\b/.test(title) ||
        /\banimal\s+care\s+assistant\b/.test(title) ||
        /\banimal\s+care\s+coordinator\b/.test(title) ||
        /\banimal\s+care\s+technician\b/.test(title) ||
        /\bveterinary\s+student\s+ambassador\b/.test(title) ||
        /\bexternship\b/.test(title) ||
        /\brelief\s+veterinarian\b/.test(title) ||
        /\bdvm\s+veterinary\s+partner\s*(?:&|and)\s*hospital\s+equity\s+owner\b/.test(title) ||
        /\bseasonal\s+veterinarian\b/.test(title);
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
            const hospitalListingValue = (hospitalNameEl.innerText || '').trim();
            let hospitalName = hospitalListingValue;
            const jobTitle = jobTitleEl.innerText.trim();
            if (shouldSkipScrapedJob(jobTitle)) {
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
    return jobs;
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
  } else if (request.action === 'scrapeCurrentPage') {
    const jobs = scrapeCurrentPage();
    sendResponse({ jobs: jobs });
    return true; // Indicate asynchronous response
  } else if (request.action === 'clickNextPage') {
    const result = clickNextPage();
    sendResponse(result);
    return true; // Indicate asynchronous response
  }
});
