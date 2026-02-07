chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Save jobs to storage when received
  if (request.jobs) {
    chrome.storage.local.set({ jobs: request.jobs });
  }

  // Forward all status messages to the popup
  if (request.status) {
    chrome.runtime.sendMessage({
      status: request.status,
      message: request.message,
      totalJobs: request.totalJobs,
      totalPages: request.totalPages,
      error: request.error
    }).catch(() => {
      // Popup may be closed, ignore the error
    });
  }

  if (request.action === 'scrapeJobDescription') {
    const { tabId, jobIndex, jobLink } = request;

    // Wait for the tab to finish loading, then inject script
    chrome.tabs.onUpdated.addListener(function listener(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);

        // Inject script to extract description and additional details
        chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: () => {
            // Try multiple selectors for description
            let description = '';
            const descSelectors = [
              '.job-description',
              '.job-details',
              '[itemprop="description"]',
              '.posting-description',
              '.job-content',
              '.content-wrapper',
              'main'
            ];

            for (const selector of descSelectors) {
              const el = document.querySelector(selector);
              if (el) {
                description = el.innerText.trim();
                break;
              }
            }

            // Extract job type
            const jobTypeEl = document.querySelector('[itemprop="employmentType"]');
            const jobType = jobTypeEl ? jobTypeEl.textContent.trim() : '';

            // Extract address details from meta tags
            const streetAddressEl = document.querySelector('meta[itemprop="streetAddress"]');
            const streetAddress = streetAddressEl ? streetAddressEl.getAttribute('content') : '';

            const cityEl = document.querySelector('meta[itemprop="addressLocality"]');
            const detailCity = cityEl ? cityEl.getAttribute('content') : '';

            const stateEl = document.querySelector('meta[itemprop="addressRegion"]');
            const detailState = stateEl ? stateEl.getAttribute('content') : '';

            const postalCodeEl = document.querySelector('meta[itemprop="postalCode"]');
            const postalCode = postalCodeEl ? postalCodeEl.getAttribute('content') : '';

            const countryEl = document.querySelector('meta[itemprop="addressCountry"]');
            const country = countryEl ? countryEl.getAttribute('content') : '';

            return {
              description,
              jobType,
              streetAddress,
              detailCity,
              detailState,
              postalCode,
              country
            };
          }
        }).then((results) => {
          const extractedData = results[0]?.result || {};

          // Save extracted data to the job record
          chrome.storage.local.get(['jobs'], (result) => {
            const jobs = result.jobs || [];
            if (jobs[jobIndex]) {
              // Update description
              jobs[jobIndex].description = extractedData.description || '';

              // Update job type if found
              if (extractedData.jobType) {
                jobs[jobIndex].jobType = extractedData.jobType;
              }

              // Update address fields if found
              if (extractedData.streetAddress) {
                jobs[jobIndex].streetAddress = extractedData.streetAddress;
              }
              if (extractedData.postalCode) {
                jobs[jobIndex].postalCode = extractedData.postalCode;
              }
              if (extractedData.country) {
                jobs[jobIndex].country = extractedData.country;
              }

              // Update location details if available
              if (extractedData.detailCity || extractedData.detailState) {
                const city = extractedData.detailCity || '';
                const state = extractedData.detailState || '';
                if (city && state && !jobs[jobIndex].location) {
                  jobs[jobIndex].location = `${city}, ${state}`;
                }
              }

              chrome.storage.local.set({ jobs: jobs }, () => {
                console.log(`Details saved for job ${jobIndex + 1}`);
                // Close the tab after extracting
                chrome.tabs.remove(tabId);
                // Notify that description was saved
                chrome.runtime.sendMessage({
                  action: 'descriptionSaved',
                  jobIndex: jobIndex,
                  success: true
                });
              });
            }
          });
        }).catch(err => {
          console.error('Error extracting description:', err);
          // Close the tab even on error
          chrome.tabs.remove(tabId).catch(() => {});
          chrome.runtime.sendMessage({
            action: 'descriptionSaved',
            jobIndex: jobIndex,
            success: false
          });
        });
      }
    });

    return true; // Keep message channel open
  }
});
