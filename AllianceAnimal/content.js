// content.js
// Only initialize the core logic once per page load per isolated world
if (!window.geminiJobScraperInitialized) {
  window.geminiJobScraperInitialized = true;

  // Initialize state variables on a dedicated object on the window
  // This avoids top-level `let` or `const` redeclarations in the script's global scope
  // if the script file is somehow parsed multiple times.
  window.geminiJobScraperState = {
    scraping: false,
    allJobs: []
  };

  // Function to update the scraping status in chrome.storage.local
  function updateScrapingStatus(status) {
    chrome.storage.local.set({ isScraping: status });
    window.geminiJobScraperState.scraping = status; // Keep internal state updated
  }

  function scrapeJobs() {
    const jobs = [];
    const table = document.getElementById('jobsListingContainer');
    if (table) {
      const rows = table.querySelectorAll('tbody tr');
      rows.forEach(row => {
        // Check if the row is a data row and not a header or filter row
        if (row.classList.contains('odd') || row.classList.contains('even')) {
          const hospitalNameEl = row.querySelector('th:nth-child(1)');
          const jobTitleEl = row.querySelector('th:nth-child(2) a');
          const locationEl = row.querySelector('th:nth-child(3)');

          if (hospitalNameEl && jobTitleEl && locationEl) {
            const hospitalName = hospitalNameEl.innerText.trim();
            const jobTitle = jobTitleEl.innerText.trim();
            const link = jobTitleEl.href;
            const locationText = locationEl.innerText.trim();
            
            let city = '';
            let state = '';
            let country = 'USA'; // Assuming USA for now, if more countries are present, this logic needs refinement

            const locationParts = locationText.split(', ');
            if (locationParts.length > 0) {
              city = locationParts[0];
            }
            if (locationParts.length > 1) {
              state = locationParts[1];
            }

            jobs.push({
              title: jobTitle,
              hospitalName: hospitalName,
              position: jobTitle, // As per assumption
              city: city,
              state: state,
              country: country,
              link: link
            });
          }
        }
      });
    }
    return jobs;
  }

  // Function to get total pagination pages
  function getTotalPaginationPages() {
    const tableContainer = document.getElementById('jobsListingContainer_wrapper');
    if (!tableContainer) return 0;

    const paginationSpan = tableContainer.querySelector('.dataTables_paginate span');
    if (!paginationSpan) return 0;

    const pageButtons = paginationSpan.querySelectorAll('.paginate_button');
    if (pageButtons.length > 0) {
      // The last numerical button usually represents the total pages
      // Find the last button that contains only numbers
      let lastPageNum = 0;
      pageButtons.forEach(button => {
        const text = button.innerText.trim();
        if (!isNaN(text) && text !== '') {
          lastPageNum = Math.max(lastPageNum, parseInt(text, 10));
        }
      });
      return lastPageNum;
    }
    return 0;
  }

  // Function to send updated stats to the popup
  function sendStatsUpdate() {
    // currentJobsOnPage is local to this call, so it's always fresh from current DOM
    const currentJobsOnPage = scrapeJobs();
    const stats = {
      currentPageRecords: currentJobsOnPage.length,
      scrapedRecordsInProgress: window.geminiJobScraperState.allJobs.length,
      totalPaginationPages: getTotalPaginationPages()
    };
    chrome.runtime.sendMessage({ action: 'updateStats', data: stats });
  }


  // Function to wait for the table content to change after pagination click
  function waitForTableUpdate(tableBody) {
    return new Promise(resolve => {
      let timeoutId;
      const observer = new MutationObserver((mutations, obs) => {
        if (mutations.some(m => m.target === tableBody && m.type === 'childList' && m.addedNodes.length > 0)) {
          obs.disconnect(); 
          clearTimeout(timeoutId);
          resolve();
        }
      });

      observer.observe(tableBody, { childList: true, subtree: true });

      timeoutId = setTimeout(() => {
        observer.disconnect();
        resolve();
      }, 2000);
    });
  }


  // Function to apply the "DVM Career Opportunities" filter
  async function applyJobTypeFilter() {
    const jobTypeSelect = document.getElementById('jobType');
    if (jobTypeSelect) {
      // Set the value to "0" which is "DVM Career Opportunities"
      jobTypeSelect.value = '0';

      // Trigger change event to activate the filter
      const changeEvent = new Event('change', { bubbles: true });
      jobTypeSelect.dispatchEvent(changeEvent);

      // Also update the custom dropdown display if it exists
      const customDisplay = document.querySelector('.select-selected[_target="jobType"]');
      if (customDisplay) {
        customDisplay.textContent = 'DVM Career Opportunities';
      }

      // Wait for the table to update after filter is applied
      const tableBody = document.querySelector('#jobsListingContainer tbody');
      if (tableBody) {
        await waitForTableUpdate(tableBody);
      }
      // Additional delay to ensure filter is fully applied
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  async function scrapeAndPaginate() {
    window.geminiJobScraperState.allJobs = []; // Reset for a new scraping session
    window.geminiJobScraperState.scraping = true; // Use global state
    updateScrapingStatus(true); // Update storage and internal state
    let currentPage = 1;

    // Auto-apply the "DVM Career Opportunities" filter before scraping
    console.log('Applying DVM Career Opportunities filter...');
    await applyJobTypeFilter();

    // Send initial stats before starting the loop
    sendStatsUpdate();

    while (window.geminiJobScraperState.scraping) { // Use global state
      console.log(`Scraping page ${currentPage}...`);
      const currentJobs = scrapeJobs();
      window.geminiJobScraperState.allJobs = window.geminiJobScraperState.allJobs.concat(currentJobs);

      // Send update after scraping each page
      sendStatsUpdate();

      const tableContainer = document.getElementById('jobsListingContainer_wrapper');
      const nextButton = tableContainer ? tableContainer.querySelector('.paginate_button.next:not(.disabled)') : null;
      
      if (nextButton && window.geminiJobScraperState.scraping) { // Use global state
        const tableBody = document.querySelector('#jobsListingContainer tbody');
        if (tableBody) {
          nextButton.click();
          await waitForTableUpdate(tableBody);
          currentPage++;
        } else {
          console.warn('Table body not found. Stopping pagination.');
          window.geminiJobScraperState.scraping = false;
        }
      } else {
        console.log('No more pages or scraping stopped.');
        window.geminiJobScraperState.scraping = false;
      }
      // Small delay to avoid overwhelming the browser/server
      if (window.geminiJobScraperState.scraping) {
          await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    console.log('Finished scraping all pages or stopped. Total jobs:', window.geminiJobScraperState.allJobs.length);
    chrome.runtime.sendMessage({ action: 'storeJobs', data: window.geminiJobScraperState.allJobs });
    updateScrapingStatus(false); // Update storage and internal state
    // Final stats update after completion
    sendStatsUpdate(); 
  }

  // --- Message Listener ---
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'start') {
      if (!window.geminiJobScraperState.scraping) { // Use global state
        console.log('Starting multi-page scraping...');
        scrapeAndPaginate().then(() => {
          sendResponse({ status: 'completed' });
        });
        return true; // Indicate asynchronous response
      } else {
        sendResponse({ status: 'already_running' });
      }
    } else if (request.action === 'stop') {
      console.log('Stopping scraping manually.');
      window.geminiJobScraperState.scraping = false; // Use global state
      updateScrapingStatus(false); // Update storage and internal state
      sendStatsUpdate(); // Send final stats after stopping
      sendResponse({ status: 'stopped' });
    } else if (request.action === 'getInitialStats') {
      sendResponse({ 
        currentPageRecords: scrapeJobs().length,
        scrapedRecordsInProgress: window.geminiJobScraperState.allJobs.length,
        totalPaginationPages: getTotalPaginationPages()
      });
    }
  });

  // Initial stats update on script load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sendStatsUpdate);
  } else {
    sendStatsUpdate();
  }

} // End of if (!window.geminiJobScraperInitialized)
else {
  console.log("Content script already initialized. Skipping re-initialization of core logic.");
  // If the script is already initialized, it means the message listeners are already active.
  // We just need to make sure `getInitialStats` can respond correctly if called.
  // The existing `chrome.runtime.onMessage.addListener` will handle it as it's defined once.
}