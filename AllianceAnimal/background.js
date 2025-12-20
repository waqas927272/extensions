chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'storeJobs') {
    chrome.storage.local.set({ jobs: request.data }, () => {
      console.log('Jobs data stored.');
    });
    return false;
  }

  // Handle webhook requests from results page (bypasses CORS)
  if (request.action === 'sendWebhook') {
    const { url, payload } = request;
    console.log('Sending webhook to:', url);

    (async () => {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        console.log('Webhook response status:', response.status);

        if (response.ok) {
          sendResponse({ success: true });
        } else {
          const errorText = await response.text().catch(() => '');
          sendResponse({ success: false, error: `HTTP ${response.status}: ${errorText}` });
        }
      } catch (error) {
        console.error('Webhook error:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();

    return true; // Keep message channel open for async response
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
            // Extract description
            const mainContent = document.querySelector('body > div.jobad.site > div > div > div.column.jobad-container.wide-9of16.medium-5of8.print-block.equal-column > main');
            const description = mainContent ? mainContent.innerText.trim() : '';

            // Extract job type
            const jobTypeEl = document.querySelector('li.job-detail[itemprop="employmentType"]');
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

              // Update job type
              jobs[jobIndex].jobType = extractedData.jobType || '';

              // Update address fields
              jobs[jobIndex].streetAddress = extractedData.streetAddress || '';
              jobs[jobIndex].postalCode = extractedData.postalCode || '';
              jobs[jobIndex].country = extractedData.country || '';

              // Update city if missing or empty
              if (!jobs[jobIndex].city || jobs[jobIndex].city === 'N/A') {
                jobs[jobIndex].city = extractedData.detailCity || jobs[jobIndex].city || '';
              }

              // Update state if missing or empty
              if (!jobs[jobIndex].state || jobs[jobIndex].state === 'N/A') {
                jobs[jobIndex].state = extractedData.detailState || jobs[jobIndex].state || '';
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

// Optional: Clear scraping status on extension startup/reload
// This ensures that if the browser closed mid-scrape, the next time
// the extension runs, it won't mistakenly think it's still scraping.
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({ isScraping: false });
});

chrome.runtime.onStartup.addListener(() => {
    chrome.storage.local.set({ isScraping: false });
});