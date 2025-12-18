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
    
    // Signal that scraping is finished for this page
    chrome.runtime.sendMessage({ command: 'finished' });

    // Optionally, you can add logic here to handle pagination and continue scraping.
    // For this example, it scrapes only the current page.
  }

  chrome.runtime.sendMessage({ command: 'get-status' }, (response) => {
    if (response.isScraping) {
      scrapeData();
    }
  });
  
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.command === 'stop') {
      isScraping = false;
    }
  });

})();
