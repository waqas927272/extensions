// Encore Vet Job Scraper - Background Service Worker

console.log("Encore Vet Job Scraper background script loaded");

// Listen for messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Background received message:", request.action);

  if (request.action === "scrapeProgress") {
    // Forward progress to popup if it's open
    chrome.runtime.sendMessage(request).catch(() => {});
  }

  if (request.action === 'fetchJobDetails') {
    const { url, jobIndex } = request;

    chrome.tabs.create({ url: url, active: false }, (tab) => {
      chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
        if (tabId === tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);

          setTimeout(() => {
            chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => {
                const result = { hospitalName: '', streetAddress: '', city: '', state: '', postalCode: '', jobType: '', salary: '', position: '', areaOfPractice: '', category: '' };

                function stripHtml(html) { const t = document.createElement('div'); t.innerHTML = html; return t.textContent || t.innerText || ''; }

                const areaOfPracticeMap = [
                  { area: 'General Practice Care', keywords: ['medical director', 'veterinarian medical director', 'associate veterinarian', 'gp vet', 'quick care veterinarian', 'dvm', 'vmd', 'relief veterinarian', 'relief dvm', 'locum veterinarian', 'veterinarian'] },
                  { area: 'Emergency Care', keywords: ['emergency veterinarian', 'er vet', 'er veterinarian', 'er dvm', 'urgent care veterinarian', 'relief emergency veterinarian', 'relief emergency vet'] },
                  { area: 'Urgent Care', keywords: ['urgent care veterinarian', 'urgent veterinarian'] },
                  { area: 'General Practice Care / Emergency Care / Urgent Care', keywords: ['equine veterinarian', 'equine vet', 'bovine veterinarian', 'large animal', 'equine dvm', 'avian veterinarian', 'exotics veterinarian', 'avian vet', 'exotics vet', 'associate exotics veterinarian', 'avian & exotics', 'equine/bovine'] },
                  { area: 'Specialty Care', keywords: ['criticalist', 'dacvecc', 'board certified criticalist', 'residency trained criticalist', 'emergency & critical care', 'ecc', 'medical oncologist', 'oncologist', 'dacvim', 'acvim', 'medonc', 'radiation oncologist', 'dacvr-ro', 'radonc', 'internal medicine specialist', 'internist', 'veterinary internist', 'saim', 'small animal internal medicine', 'neurologist', 'neurosurgeon', 'veterinary neurologist', 'cardiologist', 'veterinary cardiologist', 'small animal cardiologist', 'dentist', 'oral surgeon', 'dentist & oral surgeon', 'davdc', 'dermatologist', 'veterinary dermatologist', 'dacvd', 'acvd', 'surgeon', 'veterinary surgery', 'dacvs', 'acvs', 'small animal surgeon', 'radiologist', 'veterinary radiologist', 'diagnostic imaging specialist', 'dacvr', 'acvr', 'ophthalmologist', 'veterinary ophthalmologist', 'dacvo', 'acvo', 'anesthesiologist', 'veterinary anesthesiologist', 'dacvaa', 'acvaa', 'theriogenologist', 'veterinary theriogenologist', 'dact', 'rehabilitation therapist', 'ccrt', 'canine rehabilitation', 'veterinary technician specialist', 'vts', 'residency trained', 'board certified', 'veterinary specialist', 'specialty doctor'] }
                ];

                function lookupAreaOfPractice(text) {
                  if (!text) return '';
                  const lower = text.toLowerCase();
                  for (let i = areaOfPracticeMap.length - 1; i >= 0; i--) {
                    for (const kw of areaOfPracticeMap[i].keywords) { if (lower.includes(kw)) return areaOfPracticeMap[i].area; }
                  }
                  return '';
                }

                function extractSalary(text) {
                  if (!text) return '';
                  const patterns = [/\$[\d,]+k?\s*[-–]+\s*\$?[\d,]+k/i, /\$[\d,]+(?:,\d{3})*\s*[-–]+\s*\$[\d,]+(?:,\d{3})*/i, /\$[\d,]+(?:\.\d{2})?\s*[-–\/]+\s*\$?[\d,]+(?:\.\d{2})?\s*(?:per\s+)?(?:hourly|hour|hr|\/hr|\/\s*hour)/i, /\$[\d,]+(?:\.\d{2})?\s*(?:per\s+)?(?:year|annually|annum|annual)/i, /salary\s+range[^.\n]*?\$[\d,]+k?[^.\n]{0,40}/i, /pay[:\s]+\$[\d,]+(?:\.\d{2})?[^.\n]{0,60}/i, /compensation[:\s]+\$[\d,]+[^.\n]{0,60}/i, /\$[\d,]+k\+?/i];
                  for (const p of patterns) { const m = text.match(p); if (m) { let s = m[0].trim().replace(/[.,;:\s]+$/, ''); return s.length > 100 ? s.substring(0, 100) : s; } }
                  return '';
                }

                // === SOURCE 1: JSON-LD ===
                const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
                for (const s of ldScripts) {
                  try {
                    const ld = JSON.parse(s.textContent);
                    if (ld['@type'] === 'JobPosting') {
                      if (ld.title) result.position = ld.title;
                      if (ld.employmentType) result.jobType = ld.employmentType.replace(/_/g, ' ');
                      if (ld.jobLocation && ld.jobLocation.address) {
                        const addr = ld.jobLocation.address;
                        result.streetAddress = addr.streetAddress || '';
                        result.city = addr.addressLocality || '';
                        result.state = addr.addressRegion || '';
                        result.postalCode = addr.postalCode || '';
                      }
                      if (ld.baseSalary && ld.baseSalary.value) {
                        const sv = ld.baseSalary.value;
                        if (sv.minValue && sv.maxValue && (sv.minValue > 0 || sv.maxValue > 0)) {
                          result.salary = '$' + sv.minValue.toLocaleString() + ' - $' + sv.maxValue.toLocaleString();
                          if (sv.unitText) result.salary += ' / ' + sv.unitText;
                        }
                      }
                      if (ld.description) {
                        const descText = stripHtml(ld.description);
                        if (!result.salary) result.salary = extractSalary(descText);
                        // Hospital: "At Harbor Point Animal Hospital, ..."
                        const hospMatch = descText.match(/\bAt\s+((?:[\w'.&-]+\s+){0,6}(?:Animal\s+Hospital|Veterinary\s+(?:Hospital|Clinic|Center|Care|Practice|Group)|Pet\s+(?:Hospital|Clinic|Care)|Emergency\s+(?:Hospital|Center|Clinic)))/i);
                        if (hospMatch) result.hospitalName = hospMatch[1].trim();
                      }
                      break;
                    }
                  } catch (e) {}
                }

                // === SOURCE 2: DOM meta-data (iCIMS/Jibe Angular) ===
                const locSpan = document.querySelector('#header-locations .job-data-span');
                if (locSpan) {
                  const parts = locSpan.textContent.trim().split(',').map(s => s.trim());
                  if (parts[0] && !result.city) result.city = parts[0];
                  if (parts[1] && !result.state) result.state = parts[1];
                }

                const catSpan = document.querySelector('#header-categories .job-data-span');
                if (catSpan) result.category = catSpan.textContent.trim();

                const typeSpan = document.querySelector('#header-tags1 .job-data-span');
                if (typeSpan && !result.jobType) result.jobType = typeSpan.textContent.trim();

                // === SOURCE 3: DOM h1 for position ===
                if (!result.position) {
                  const h1 = document.querySelector('h1[itemprop="title"] a, h1[itemprop="title"]');
                  if (h1) result.position = h1.textContent.trim();
                }

                // Hospital from title: "Practice Manager - Harbor Point Animal Hospital" → extract after " - "
                if (!result.hospitalName && result.position) {
                  const titleParts = result.position.split(' - ');
                  if (titleParts.length > 1) {
                    const candidate = titleParts.slice(1).join(' - ').trim();
                    if (/(?:hospital|clinic|center|care|veterinary|animal|emergency|medical|pet)/i.test(candidate)) {
                      result.hospitalName = candidate;
                    }
                  }
                }

                // === SOURCE 4: Description text for hospital/salary ===
                if (!result.hospitalName || !result.salary) {
                  const descBody = document.querySelector('#description-body');
                  if (descBody) {
                    const text = descBody.innerText || '';
                    if (!result.salary) result.salary = extractSalary(text);
                    if (!result.hospitalName) {
                      const hm = text.match(/\bAt\s+((?:[\w'.&-]+\s+){0,6}(?:Animal\s+Hospital|Veterinary\s+(?:Hospital|Clinic|Center|Care|Practice|Group)|Pet\s+(?:Hospital|Clinic|Care)|Emergency\s+(?:Hospital|Center|Clinic)))/i);
                      if (hm) result.hospitalName = hm[1].trim();
                    }
                  }
                }

                // === SOURCE 5: Area of Practice ===
                if (result.position) result.areaOfPractice = lookupAreaOfPractice(result.position);
                if (!result.areaOfPractice) {
                  const descBody = document.querySelector('#description-body');
                  if (descBody) result.areaOfPractice = lookupAreaOfPractice(descBody.innerText || '');
                }

                return result;
              }
            }).then((results) => {
              const details = results[0]?.result || {};
              chrome.tabs.remove(tab.id);
              chrome.runtime.sendMessage({ action: 'detailsFetched', details, jobIndex }).catch(() => {});
            }).catch((err) => {
              console.error('Error extracting job details:', err);
              chrome.tabs.remove(tab.id).catch(() => {});
              chrome.runtime.sendMessage({ action: 'detailsFetched', details: {}, jobIndex }).catch(() => {});
            });
          }, 3000);
        }
      });
    });

    return true;
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
