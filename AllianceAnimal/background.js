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

  if (request.action === 'fetchAddressFromMaps') {
    const { searchQuery, jobIndex } = request;
    const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`;

    chrome.tabs.create({ url: mapsUrl, active: true }, (tab) => {
      if (!tab) {
        sendResponse({ success: false, error: 'Failed to create tab' });
        return;
      }

      const tabId = tab.id;
      let responded = false;

      const safeRespond = (data) => {
        if (!responded) {
          responded = true;
          sendResponse(data);
        }
      };

      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        chrome.tabs.remove(tabId).catch(() => {});
        safeRespond({ success: false, error: 'Timeout waiting for Google Maps' });
      }, 35000);

      const listener = (updatedTabId, info) => {
        if (updatedTabId === tabId && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);

          // Wait for Google Maps JS to fully render content
          setTimeout(() => {
            chrome.scripting.executeScript({
              target: { tabId: tabId },
              files: ['google-maps-scraper.js']
            }).then((results) => {
              clearTimeout(timeout);
              chrome.tabs.remove(tabId).catch(() => {});
              const addressData = results?.[0]?.result || {};
              safeRespond({ success: true, addressData: addressData, jobIndex: jobIndex });
            }).catch((err) => {
              clearTimeout(timeout);
              chrome.tabs.remove(tabId).catch(() => {});
              safeRespond({ success: false, error: err.message });
            });
          }, 5000); // 5 seconds for Google Maps to render
        }
      };

      chrome.tabs.onUpdated.addListener(listener);
    });

    return true; // Keep message channel open for async response
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

              // Format salary to standard "$X–$Y per year" or "$X per hour"
              function formatSalary(raw) {
                if (!raw) return '';
                const isHourly = /(?:per\s+)?(?:hour|hr|\/hr)/i.test(raw);
                const amounts = [];
                const amountRegex = /\$?([\d,]+(?:\.\d{2})?)\s*k?\b/gi;
                let match;
                while ((match = amountRegex.exec(raw)) !== null) {
                  let num = parseFloat(match[1].replace(/,/g, ''));
                  const afterMatch = raw.substring(match.index + match[0].length - 1, match.index + match[0].length + 1);
                  if (/k/i.test(match[0]) || /k/i.test(afterMatch)) {
                    num = num * 1000;
                  }
                  if (num > 0) amounts.push(num);
                }
                if (amounts.length === 0) return raw;
                const fmt = (n) => {
                  if (Number.isInteger(n)) return '$' + n.toLocaleString('en-US');
                  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                };
                const unit = isHourly ? 'per hour' : 'per year';
                if (amounts.length >= 2) {
                  const min = Math.min(amounts[0], amounts[1]);
                  const max = Math.max(amounts[0], amounts[1]);
                  return `${fmt(min)}–${fmt(max)} ${unit}`;
                }
                return `${fmt(amounts[0])} ${unit}`;
              }

              function extractSalaryFromText(text) {
                if (!text) return '';
                const salaryPatterns = [
                  /(?:base\s+salary\s*(?:ranges?)?)\s*(?:of|from|is|:)\s*\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s*[-–—]\s*\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?/i,
                  /(?:base\s+salary\s*(?:ranges?)?)\s*(?:of|from|is|:)\s*\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s+to\s+\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?/i,
                  /(?:(?:pay|salary|compensation)\s+range)\s*(?:of|from|is|:)\s*\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s*[-–—]\s*\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?/i,
                  /(?:(?:pay|salary|compensation)\s+range)\s*(?:of|from|is|:)\s*\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s+to\s+\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?/i,
                  /(?:salary|compensation|pay)[:\s]+\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s*[-–—]\s*\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?(?:\s*(?:per\s+)?(?:year|annually|annum|annual))?/i,
                  /(?:salary|compensation|pay)[:\s]+\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s+to\s+\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?(?:\s*(?:per\s+)?(?:year|annually|annum|annual))?/i,
                  /\$[\d,]+(?:\.\d{2})?\s*[-–—]\s*\$[\d,]+(?:\.\d{2})?/i,
                  /\$[\d,]+(?:\.\d{2})?\s+to\s+\$[\d,]+(?:\.\d{2})?/i,
                  /\$[\d,]+\s*(?:\/k|k)\s*[-–—]+\s*\$?[\d,]+\s*(?:\/k|k)/i,
                  /\$[\d,]+\s*(?:\/k|k)?\s+to\s+\$?[\d,]+\s*(?:\/k|k)/i,
                  /(?:earn|earning)\s+\$[\d,]+(?:\.\d{2})?\s*(?:annually|per\s*year)?/i,
                  /\$[\d,]+(?:\.\d{2})?\s*(?:annually|per\s*year|per\s*annum)/i,
                  /\$[\d,]+(?:\.\d{2})?\s*(?:per\s+)?(?:hour|hr|\/hr)/i,
                ];
                for (const pattern of salaryPatterns) {
                  const m = text.match(pattern);
                  if (m) return formatSalary(m[0].trim());
                }
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

              // 1. Try JSON-LD structured data for salary FIRST (most reliable)
              const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
              for (const s of ldScripts) {
                try {
                  const ld = JSON.parse(s.textContent);
                  if (ld['@type'] === 'JobPosting' && ld.baseSalary && ld.baseSalary.value) {
                    const sv = ld.baseSalary.value;
                    const minVal = sv.minValue ? String(sv.minValue).trim() : '';
                    const maxVal = sv.maxValue ? String(sv.maxValue).trim() : '';
                    if (minVal && maxVal) {
                      const unit = sv.unitText || 'per year';
                      const isHourly = /hour/i.test(unit);
                      const min = parseFloat(minVal.replace(/,/g, ''));
                      const max = parseFloat(maxVal.replace(/,/g, ''));
                      const fmt = (n) => {
                        if (Number.isInteger(n)) return '$' + n.toLocaleString('en-US');
                        return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                      };
                      salary = `${fmt(min)}–${fmt(max)} ${isHourly ? 'per hour' : 'per year'}`;
                    } else if (minVal) {
                      const min = parseFloat(minVal.replace(/,/g, ''));
                      const fmt = (n) => {
                        if (Number.isInteger(n)) return '$' + n.toLocaleString('en-US');
                        return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                      };
                      salary = `${fmt(min)}+ per year`;
                    }
                    if (salary) break;
                  }
                } catch(e) {}
              }

              // 2. Extract salary from the job description text
              if (!salary) {
                const mainContent = document.querySelector('body > div.jobad.site > div > div > div.column.jobad-container.wide-9of16.medium-5of8.print-block.equal-column > main');
                if (mainContent) {
                  salary = extractSalaryFromText(mainContent.innerText);
                }
              }

              // 3. Fallback: search the entire page body for salary
              if (!salary) {
                const bodyText = document.body ? document.body.innerText : '';
                salary = extractSalaryFromText(bodyText);
              }

              return { areaOfPractice, position, salary };
            }
          }).then((results) => {
            const extractedData = results[0]?.result || {};

            chrome.storage.local.get(['jobs'], (result) => {
              const jobs = result.jobs || [];
              if (jobs[jobIndex]) {
                const listingTitle = jobs[jobIndex].title || '';

                // --- Determine AOP from listing title ---
                function getAOPFromTitle(title) {
                  const t = title.toLowerCase();
                  const specialtyNames = ['oncologist', 'cardiologist', 'neurologist', 'neurosurgeon',
                    'dermatologist', 'ophthalmologist', 'anesthesiologist', 'theriogenologist',
                    'radiologist', 'internist', 'criticalist',
                    'oncology', 'cardiology', 'neurology', 'dermatology', 'ophthalmology',
                    'anesthesia', 'theriogenology', 'radiology'];
                  for (const sp of specialtyNames) { if (t.includes(sp)) return 'Specialty Care'; }
                  const specialtyCerts = ['board certified', 'residency trained', 'diplomate',
                    'dacvecc', 'dacvim', 'dacvr', 'dacvs', 'dacvd', 'dacvo', 'dacvaa',
                    'dact', 'davdc', 'dabvp', 'acvs', 'acvim'];
                  for (const cert of specialtyCerts) { if (t.includes(cert)) return 'Specialty Care'; }
                  if (t.includes('specialist') && !t.includes('technician specialist')) return 'Specialty Care';
                  if (t.match(/\bsurgeon\b/)) return 'Specialty Care';
                  if (t.includes('emergency') || t.match(/\ber\b/) || t.includes('er vet') || t.includes('er dvm')) return 'Emergency Care';
                  if (t.includes('urgent care')) return 'Urgent Care';
                  if (t.includes('equine') || t.includes('bovine') || t.includes('large animal') ||
                      t.includes('avian') || t.includes('exotics')) return 'General Practice Care / Emergency Care / Urgent Care';
                  return '';
                }

                // --- Match position from listing title ---
                function getPositionFromTitle(title) {
                  const t = title.toLowerCase();
                  if (t.includes('medical director')) return 'Medical Director';
                  if (t.includes('lead veterinarian') || t.includes('lead vet')) return 'Lead Veterinarian';
                  if (t.includes('neurologist') || t.includes('neurosurgeon') || t.includes('neurology')) return 'Neurologist & Neurosurgeon';
                  if (t.includes('dermatologist') || t.includes('dermatology')) return 'Dermatologist';
                  if (t.includes('cardiologist') || t.includes('cardiology')) return 'Cardiologist';
                  if (t.includes('oncologist') && t.includes('radiation')) return 'Radiation Oncologist';
                  if (t.includes('oncologist') || t.includes('oncology')) return 'Medical Oncologist';
                  if (t.includes('radiologist') || t.includes('diagnostic imaging') || t.includes('radiology')) return 'Radiologist';
                  if (t.includes('ophthalmologist') || t.includes('ophthalmology')) return 'Ophthalmologist';
                  if (t.includes('anesthesiologist') || t.includes('anesthesia')) return 'Anesthesiologist';
                  if (t.includes('theriogenologist') || t.includes('theriogenology')) return 'Theriogenologist';
                  if (t.includes('internist') || t.includes('internal medicine')) return 'Internal Medicine Specialist';
                  if (t.includes('criticalist') || t.match(/\becc\b/) || t.includes('emergency medicine')) return 'ECC Specialist';
                  if (t.includes('dabvp')) return 'DABVP Specialist';
                  if ((t.includes('dental') || t.includes('dentist') || t.includes('dentistry')) && !t.includes('assistant')) return 'Dental Specialist';
                  if ((t.includes('surgeon') || t.includes('surgery')) && !t.includes('neurosurgeon') && !t.includes('neurology') && !t.includes('dental') && !t.includes('dentistry')) return 'Surgeon';
                  if (t.includes('technician specialist') || (t.match(/\bvts\b/) && t.includes('specialist'))) return 'Credentialed Veterinary Technician Specialist';
                  if (t.includes('equine') || t.includes('bovine') || t.includes('large animal')) return 'Equine/Bovine Veterinarian/Large Animal';
                  if (t.includes('avian') || t.includes('exotics')) return 'Avian & Exotics Veterinarian / Associate Exotics';
                  if (t.includes('partner veterinarian')) return 'Partner Veterinarian';
                  return '';
                }

                // --- Validate position against AOP ---
                function getValidatedPosition(position, aop) {
                  const validPositions = {
                    'Emergency Care': ['Associate Veterinarian'],
                    'General Practice Care': ['Associate Veterinarian', 'Lead Veterinarian', 'Medical Director'],
                    'Specialty Care': [
                      'Anesthesiologist', 'Cardiologist', 'Credentialed Veterinary Technician Specialist',
                      'DABVP Specialist', 'Dental Specialist', 'Dermatologist', 'ECC Specialist',
                      'Internal Medicine Specialist', 'Medical Director', 'Medical Oncologist',
                      'Neurologist & Neurosurgeon', 'Ophthalmologist', 'Radiation Oncologist',
                      'Radiologist', 'Surgeon'
                    ],
                    'Urgent Care': ['Associate Veterinarian', 'Partner Veterinarian'],
                  };
                  const aopParts = aop.split('/').map(s => s.trim());
                  for (const part of aopParts) {
                    const allowed = validPositions[part];
                    if (allowed && allowed.includes(position)) return position;
                  }
                  const hasKnownAOP = aopParts.some(part => validPositions[part]);
                  if (hasKnownAOP) return 'Associate Veterinarian';
                  const allValid = new Set(Object.values(validPositions).flat());
                  if (allValid.has(position)) return position;
                  return 'Associate Veterinarian';
                }

                // Step 1: AOP — prefer detail page extraction, fall back to listing title
                const detailAOP = extractedData.areaOfPractice || '';
                let finalAOP = detailAOP || getAOPFromTitle(listingTitle) || 'General Practice Care';

                // Step 2: Position from listing title
                let finalPosition = getPositionFromTitle(listingTitle);

                // Step 3: If no match from title and Specialty Care, try description certs
                if (!finalPosition && finalAOP === 'Specialty Care') {
                  const desc = (jobs[jobIndex].description || '').toLowerCase();
                  if (desc.includes('dacvecc')) finalPosition = 'ECC Specialist';
                  else if (desc.includes('dacvim') && desc.includes('oncology')) finalPosition = 'Medical Oncologist';
                  else if (desc.includes('dacvr') && desc.includes('radiation')) finalPosition = 'Radiation Oncologist';
                  else if (desc.includes('dacvim') && desc.includes('neurology')) finalPosition = 'Neurologist & Neurosurgeon';
                  else if (desc.includes('dacvim') && desc.includes('cardiology')) finalPosition = 'Cardiologist';
                  else if (desc.includes('dacvim')) finalPosition = 'Internal Medicine Specialist';
                  else if (desc.includes('davdc')) finalPosition = 'Dental Specialist';
                  else if (desc.includes('dacvd')) finalPosition = 'Dermatologist';
                  else if (desc.includes('dacvs') || desc.includes('acvs')) finalPosition = 'Surgeon';
                  else if (desc.includes('dacvr')) finalPosition = 'Radiologist';
                  else if (desc.includes('dacvo')) finalPosition = 'Ophthalmologist';
                  else if (desc.includes('dacvaa')) finalPosition = 'Anesthesiologist';
                  else if (desc.includes('dact')) finalPosition = 'Theriogenologist';
                  else if (desc.includes('dabvp')) finalPosition = 'DABVP Specialist';
                }

                // Step 4: Validate position against AOP
                if (finalPosition) {
                  finalPosition = getValidatedPosition(finalPosition, finalAOP);
                }

                // Step 5: Medical Director override
                if ((!finalPosition || finalPosition === 'Associate Veterinarian') && listingTitle.toLowerCase().includes('medical director')) {
                  finalPosition = 'Medical Director';
                }

                // Step 6: Default
                if (!finalPosition) {
                  finalPosition = 'Associate Veterinarian';
                }

                jobs[jobIndex].areaOfPractice = finalAOP;
                jobs[jobIndex].position = finalPosition;
                jobs[jobIndex].salary = extractedData.salary || jobs[jobIndex].salary || '';

                chrome.storage.local.set({ jobs: jobs }, () => {
                  console.log(`Details fetched for job ${jobIndex + 1}: AOP="${finalAOP}", Position="${finalPosition}"`);
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