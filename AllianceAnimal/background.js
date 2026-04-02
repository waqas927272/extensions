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

  if (request.action === 'fetchJobDetails') {
    const { tabId, jobIndex, jobLink } = request;

    chrome.tabs.onUpdated.addListener(function listener(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);

        setTimeout(() => {
          chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: () => {
              // Area of Practice keyword mapping (same as VCA)
              const areaOfPracticeMap = [
                {
                  area: 'General Practice Care',
                  keywords: ['medical director', 'veterinarian medical director', 'associate veterinarian', 'gp vet', 'quick care veterinarian', 'dvm', 'vmd', 'relief veterinarian', 'relief dvm', 'locum veterinarian', 'veterinarian']
                },
                {
                  area: 'Emergency Care',
                  keywords: ['emergency veterinarian', 'er vet', 'er veterinarian', 'er dvm', 'urgent care veterinarian', 'relief emergency veterinarian', 'relief emergency vet']
                },
                {
                  area: 'Urgent Care',
                  keywords: ['urgent care veterinarian', 'urgent veterinarian']
                },
                {
                  area: 'General Practice Care / Emergency Care / Urgent Care',
                  keywords: ['equine veterinarian', 'equine vet', 'bovine veterinarian', 'large animal', 'equine dvm', 'avian veterinarian', 'exotics veterinarian', 'avian vet', 'exotics vet', 'associate exotics veterinarian', 'avian & exotics', 'equine/bovine']
                },
                {
                  area: 'Specialty Care',
                  keywords: ['criticalist', 'dacvecc', 'board certified criticalist', 'residency trained criticalist', 'emergency & critical care', 'ecc',
                    'medical oncologist', 'oncologist', 'dacvim', 'acvim', 'medonc',
                    'radiation oncologist', 'dacvr-ro', 'radonc',
                    'internal medicine specialist', 'internist', 'veterinary internist', 'saim', 'small animal internal medicine',
                    'neurologist', 'neurosurgeon', 'veterinary neurologist',
                    'cardiologist', 'veterinary cardiologist', 'small animal cardiologist',
                    'dentist', 'oral surgeon', 'dentist & oral surgeon', 'davdc',
                    'dermatologist', 'veterinary dermatologist', 'dacvd', 'acvd',
                    'surgeon', 'veterinary surgery', 'dacvs', 'acvs', 'small animal surgeon',
                    'radiologist', 'veterinary radiologist', 'diagnostic imaging specialist', 'dacvr', 'acvr',
                    'ophthalmologist', 'veterinary ophthalmologist', 'dacvo', 'acvo',
                    'anesthesiologist', 'veterinary anesthesiologist', 'dacvaa', 'acvaa',
                    'theriogenologist', 'veterinary theriogenologist', 'dact',
                    'rehabilitation therapist', 'ccrt', 'canine rehabilitation',
                    'veterinary technician specialist', 'vts', 'vts anesthesia', 'vts ecc', 'vts emergency', 'vts dentistry', 'vts internal medicine', 'vts neurology', 'vts cardiology', 'vts dermatology', 'vts ophthalmology', 'vts ophtho', 'vts diagnostic imaging',
                    'residency trained', 'board certified', 'veterinary specialist', 'specialty doctor']
                }
              ];

              function lookupAreaOfPractice(positionText) {
                if (!positionText) return '';
                const posLower = positionText.toLowerCase();
                for (let i = areaOfPracticeMap.length - 1; i >= 0; i--) {
                  const entry = areaOfPracticeMap[i];
                  for (const kw of entry.keywords) {
                    if (posLower.includes(kw)) {
                      return entry.area;
                    }
                  }
                }
                return '';
              }

              function extractSalary(text) {
                if (!text) return '';
                const salaryPatterns = [
                  /\$[\d,]+k?\s*[-–]+\s*\$?[\d,]+k/i,
                  /\$[\d,]+(?:,\d{3})*\s*[-–]+\s*\$[\d,]+(?:,\d{3})*/i,
                  /\$[\d,]+(?:,\d{3})*k?\s+to\s+\$[\d,]+(?:,\d{3})*k?/i,
                  /\$[\d,]+(?:\.\d{2})?\s*(?:per\s+)?(?:hourly|hour|hr|\/hr)/i,
                  /[Cc]ompensation[:\s]+\$[\d,]+[^.;\n]{0,60}/,
                  /\$[\d,]+(?:\.\d{2})?\s*(?:per\s+)?(?:year|annually|annum|annual)/i,
                  /salary\s+range[^.\n]*?\$[\d,]+k?[^.\n]{0,40}/i,
                  /annual\s+salary[^.\n]*?\$[\d,]+k?[^.\n]{0,40}/i,
                  /base\s+(?:salary|pay)[^.\n]*?\$[\d,]+k?[^.\n]{0,40}/i,
                  /starting\s+(?:salary|at|pay)[^.\n]*?\$[\d,]+k?[^.\n]{0,40}/i,
                  /pay\s+(?:range|rate)[^.\n]*?\$[\d,]+k?[^.\n]{0,40}/i,
                  /competitive\s+(?:salary|compensation|pay)[^.\n]*?\$[\d,]+k?[^.\n]{0,40}/i,
                  /up\s+to\s+\$[\d,]+(?:,\d{3})*k?/i,
                  /earn(?:ing)?\s+(?:up\s+to\s+)?\$[\d,]+k?[^.\n]{0,40}/i,
                  /sign(?:ing)?[\s-]*(?:on\s+)?bonus[^.\n]*?\$[\d,]+k?[^.\n]{0,30}/i,
                  /\$[\d]{2,3}(?:,\d{3})*k?\s*[-–]+\s*\$?[\d]{2,3}(?:,\d{3})*k?/i,
                  /\$[\d,]+k\+?/i
                ];
                for (const pattern of salaryPatterns) {
                  const m = text.match(pattern);
                  if (m) {
                    let sal = m[0].trim();
                    sal = sal.replace(/[.,;:\s]+$/, '').trim();
                    if (sal.length > 100) sal = sal.substring(0, 100).trim();
                    return sal;
                  }
                }
                const negMatch = text.match(/(?:salary|compensation)\s+(?:is\s+)?negotiable/i);
                if (negMatch) return 'Negotiable';
                return '';
              }

              let areaOfPractice = '';
              let position = '';
              let salary = '';

              // Extract position/title from the page
              const titleEl = document.querySelector('h1.job-title') ||
                              document.querySelector('h1[itemprop="title"]') ||
                              document.querySelector('.jobad-header h1') ||
                              document.querySelector('h1');
              if (titleEl) {
                position = titleEl.textContent.trim();
              }

              // Look up area of practice from position/title
              areaOfPractice = lookupAreaOfPractice(position);

              // Extract salary from the job description text
              const mainContent = document.querySelector('body > div.jobad.site > div > div > div.column.jobad-container.wide-9of16.medium-5of8.print-block.equal-column > main');
              if (mainContent) {
                salary = extractSalary(mainContent.innerText);
              }

              // Fallback: try JSON-LD structured data for salary
              if (!salary) {
                const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
                for (const s of ldScripts) {
                  try {
                    const ld = JSON.parse(s.textContent);
                    if (ld['@type'] === 'JobPosting' && ld.baseSalary) {
                      if (ld.baseSalary.value) {
                        const sv = ld.baseSalary.value;
                        if (sv.minValue && sv.maxValue) {
                          salary = '$' + sv.minValue.toLocaleString() + ' - $' + sv.maxValue.toLocaleString();
                          if (sv.unitText) salary += ' ' + sv.unitText;
                        } else if (sv.value) {
                          salary = '$' + sv.value.toLocaleString();
                          if (sv.unitText) salary += ' ' + sv.unitText;
                        }
                      } else if (typeof ld.baseSalary === 'string') {
                        salary = ld.baseSalary;
                      }
                      break;
                    }
                  } catch(e) {}
                }
              }

              // Fallback: search the entire page body for salary
              if (!salary) {
                const bodyText = document.body ? document.body.innerText : '';
                const salarySection = bodyText.match(/(?:salary|compensation|pay|earning|bonus)[^\n]{0,200}/gi);
                if (salarySection) {
                  for (const section of salarySection) {
                    salary = extractSalary(section);
                    if (salary) break;
                  }
                }
              }

              return { areaOfPractice, position, salary };
            }
          }).then((results) => {
            const extractedData = results[0]?.result || {};

            chrome.storage.local.get(['jobs'], (result) => {
              const jobs = result.jobs || [];
              if (jobs[jobIndex]) {
                jobs[jobIndex].areaOfPractice = extractedData.areaOfPractice || jobs[jobIndex].areaOfPractice || '';
                jobs[jobIndex].position = extractedData.position || jobs[jobIndex].position || jobs[jobIndex].title || '';
                jobs[jobIndex].salary = extractedData.salary || jobs[jobIndex].salary || '';

                chrome.storage.local.set({ jobs: jobs }, () => {
                  console.log(`Details fetched for job ${jobIndex + 1}`);
                  chrome.tabs.remove(tabId);
                  chrome.runtime.sendMessage({
                    action: 'detailsFetched',
                    jobIndex: jobIndex,
                    success: true
                  });
                });
              }
            });
          }).catch(err => {
            console.error('Error fetching job details:', err);
            chrome.tabs.remove(tabId);
            chrome.runtime.sendMessage({
              action: 'detailsFetched',
              jobIndex: jobIndex,
              success: false
            });
          });
        }, 2000); // Wait for page content to fully render
      }
    });

    return true;
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