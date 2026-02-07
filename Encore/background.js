// Encore Vet Job Scraper - Background Service Worker

console.log("Encore Vet Job Scraper background script loaded");

// Listen for messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Background received message:", request.action);

  if (request.action === "scrapeProgress") {
    // Forward progress to popup if it's open
    chrome.runtime.sendMessage(request).catch(() => {});
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
              '.iCIMS_JobContent',
              '.job-content'
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
          chrome.storage.local.get(['encoreJobs'], (result) => {
            const jobs = result.encoreJobs || [];
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

              // Update city if missing or empty
              if ((!jobs[jobIndex].city || jobs[jobIndex].city === 'N/A') && extractedData.detailCity) {
                jobs[jobIndex].city = extractedData.detailCity;
              }

              // Update state if missing or empty
              if ((!jobs[jobIndex].state || jobs[jobIndex].state === 'N/A') && extractedData.detailState) {
                jobs[jobIndex].state = extractedData.detailState;
              }

              chrome.storage.local.set({ encoreJobs: jobs }, () => {
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

  return true;
});

// Handle extension installation
chrome.runtime.onInstalled.addListener(() => {
  console.log("Encore Vet Job Scraper installed");
});
