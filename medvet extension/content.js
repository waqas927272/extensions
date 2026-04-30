(() => {
  let isScraping = true;
  const excludedJobTitlePatterns = [
    /\bmentorship\b/,
    /\blocum\b/,
    /\brelief\b/,
    /\bcontingent\b/,
    /\bclient\s+services?\s+representative\b/,
    /\bdoctor\s+coordinator\b/,
    /\bexperience\s+manager\b/,
    /\bclinical\s+(?:manager|supervisor)\b/,
    /\bfacility\s+maintenance\s+technician\b/,
    /\boperations\s+technician\b/,
    /\bprocurement\b/,
    /\bhealthcare\s+technology\s+applications\b/,
    /\bveterinary\s+social\s+worker\b/,
    /\bregistered\s+veterinary\s+technician\b/,
    /\blicensed\s+veterinary\s+technician\b/,
    /\bcredentialed\s+(?:veterinary\s+)?technician\b/,
    /\bveterinary\s+credentialed\s+technician\b/,
    /\bveterinary\s+technician\b/,
    /\btechnician\s+assistant\b/,
    /\btechnician\/assistant\b/,
    /\btechnician\s+for\s+(?:icu|surgery|nursing)\b/,
    /\b(?:icu|nursing|anesthesia|dentistry|ophthalmology|radiology|rehabilitation|surgery|neurology|internal\s+medicine|medical\s+oncology|emergency|critical\s+care|hospitalist)\b.*\btechnician\b/,
    /\btechnician\b.*\b(?:icu|nursing|anesthesia|dentistry|ophthalmology|radiology|rehabilitation|surgery|neurology|internal\s+medicine|medical\s+oncology|emergency|critical\s+care|hospitalist)\b/,
    /\bveterinary\s+assistant\b/,
    /\bexperienced\s+veterinary\s+assistant\b/,
    /\bassistant\b.*\b(?:oncology|neurology|radiology|surgery|emergency|critical\s+care|internal\s+medicine|nursing)\b/,
    /\blvt\b/,
    /\brvt\b/,
    /\bva\b/
  ];

  function normalizeTitle(title) {
    return (title || '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[\/_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function shouldSkipJobTitle(title) {
    const normalizedTitle = normalizeTitle(title);
    return excludedJobTitlePatterns.some(pattern => pattern.test(normalizedTitle));
  }

  function scrapeData() {
    if (!isScraping) {
      return;
    }

    const jobRows = document.querySelectorAll('table.jv-job-list tbody tr');
    const totalOnPage = jobRows.length;
    chrome.runtime.sendMessage({ command: 'page-total', count: totalOnPage });

    const pageRecords = [];
    jobRows.forEach(row => {
      const titleElement = row.querySelector('.jv-job-list-title');
      const nameElement = row.querySelector('.jv-job-list-name');
      const categoryElement = row.querySelector('.jv-job-list-category');
      
      if (nameElement && categoryElement) {
        const linkElement = nameElement.querySelector('a');
        const locationSpan = nameElement.querySelectorAll('span');

        const title = titleElement ? titleElement.innerText.trim() : '';
        const link = linkElement ? linkElement.href : '';

        if (shouldSkipJobTitle(title)) {
          return;
        }

        // Extract job ID from the URL (last path segment)
        let jobId = '';
        if (link) {
          const urlPath = link.replace(/[?#].*$/, '').replace(/\/+$/, '');
          const rawJobId = urlPath.split('/').pop() || '';
          jobId = rawJobId ? 'MV-' + rawJobId : '';
        }

        let city = '';
        let state = '';

        if(locationSpan.length > 1) {
            const locationString = locationSpan[1].innerText.trim();
            const parts = locationString.split(',');
            if (parts.length > 1) {
                city = parts[0].trim();
                state = parts[1].trim();
            } else {
                city = locationString;
            }
        }

        const location = [city, state].filter(Boolean).join(', ');

        pageRecords.push({
          title,
          jobId,
          hospital: 'MedVet',
          city,
          state,
          location,
          link,
          areaOfPractice: '',
          position: ''
        });
      }
    });

    chrome.runtime.sendMessage({ command: 'add-records', records: pageRecords });
    
    // Pagination logic
    const nextPageButton = document.querySelector('.jv-pagination-next') || // Specific selector provided by user
                           document.querySelector('a.next-page') || // Common selector
                           document.querySelector('a[rel="next"]') || // Common selector
                           document.querySelector('button.next') || // Common selector
                           document.querySelector('.pagination .next-link') || // Example for specific site
                           document.querySelector('.pagination a:last-child:not(.active)'); // Generic last link that's not active

    if (nextPageButton) {
      nextPageButton.click(); // Simulate click to navigate to the next page
      // No 'finished' message here, as content.js will be re-injected on the next page
    } else {
      // No more pages, so signal that scraping is finished
      chrome.runtime.sendMessage({ command: 'finished' });
    }
  }

  chrome.runtime.sendMessage({ command: 'get-status' }, (response) => {
    if (response.isScraping) {
      scrapeData();
    } else {
      // If not scraping, but content.js is injected (e.g., after a navigation),
      // then we should consider this page as not part of an ongoing scrape
      chrome.runtime.sendMessage({ command: 'finished' });
    }
  });
  
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.command === 'stop') {
      isScraping = false;
    }
  });

})();
