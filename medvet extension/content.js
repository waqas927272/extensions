(() => {
  let isScraping = true;

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
        
        const position = categoryElement.innerText.trim();

        pageRecords.push({
          title,
          city,
          state,
          link,
          position
        });
      }
    });

    chrome.runtime.sendMessage({ command: 'add-records', records: pageRecords });
    
    // Pagination logic
    const nextPageButton = document.querySelector('a.next-page') || // Common selector
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
