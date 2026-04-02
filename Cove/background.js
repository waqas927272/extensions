chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'storeJobs') {
    chrome.storage.local.set({ coveJobs: request.data }, () => {
      console.log('Cove jobs data stored.');
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
                const result = {
                  hospitalName: '',
                  streetAddress: '',
                  city: '',
                  state: '',
                  postalCode: '',
                  jobType: '',
                  salary: '',
                  position: '',
                  areaOfPractice: ''
                };

                function stripHtml(html) {
                  const temp = document.createElement('div');
                  temp.innerHTML = html;
                  return temp.textContent || temp.innerText || '';
                }

                // Area of Practice keyword mapping from jobs.docx (same as VCA scrapper)
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
                    /\$[\d,]+(?:\.\d{2})?\s*[-–\/]+\s*\$?[\d,]+(?:\.\d{2})?\s*(?:per\s+)?(?:hourly|hour|hr|\/hr|\/\s*hour)/i,
                    /\$[\d,]+(?:\.\d{2})?\s*[-–]+\s*\$?[\d,]+(?:\.\d{2})?\s*(?:per\s+)?(?:year|annually|annum|annual)/i,
                    /\$[\d,]+(?:\.\d{2})?\s*(?:per\s+)?(?:hourly|hour|hr|\/hr|\/\s*hour)/i,
                    /\$[\d,]+(?:\.\d{2})?\s*(?:per\s+)?(?:year|annually|annum|annual)/i,
                    /salary\s+range[^.\n]*?\$[\d,]+k?[^.\n]{0,40}/i,
                    /pay[:\s]+\$[\d,]+(?:\.\d{2})?[^.\n]{0,60}/i,
                    /compensation[:\s]+\$[\d,]+[^.\n]{0,60}/i,
                    /\$[\d]{2,3}(?:,\d{3})*k?\s*[-–]+\s*\$?[\d]{2,3}(?:,\d{3})*k?/i,
                    /\$[\d,]+k\+?/i
                  ];
                  for (const pattern of salaryPatterns) {
                    const m = text.match(pattern);
                    if (m) {
                      let sal = m[0].trim().replace(/[.,;:\s]+$/, '').trim();
                      if (sal.length > 100) sal = sal.substring(0, 100).trim();
                      return sal;
                    }
                  }
                  return '';
                }

                // === SOURCE 1: JSON-LD (most reliable for address data) ===
                const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
                for (const s of ldScripts) {
                  try {
                    const ld = JSON.parse(s.textContent);
                    if (ld['@type'] === 'JobPosting') {
                      if (ld.title) result.position = ld.title;
                      if (ld.jobLocation && ld.jobLocation.address) {
                        const addr = ld.jobLocation.address;
                        result.streetAddress = addr.streetAddress || '';
                        result.city = addr.addressLocality || '';
                        result.state = addr.addressRegion || '';
                        result.postalCode = addr.postalCode || '';
                      }
                      if (ld.description) {
                        const descText = stripHtml(ld.description);
                        result.salary = extractSalary(descText);
                      }
                      break;
                    }
                  } catch (e) { /* skip */ }
                }

                // === SOURCE 2: DOM .job-preview-title span (position) ===
                if (!result.position) {
                  const titleSpan = document.querySelector('.job-preview-title span');
                  if (titleSpan) result.position = titleSpan.textContent.trim();
                }

                // === SOURCE 3: DOM .preview-location (city, state, department) ===
                if (!result.city || !result.state) {
                  const locLink = document.querySelector('.preview-location a');
                  if (locLink) {
                    const locText = locLink.textContent.trim();
                    const parts = locText.split(',').map(s => s.trim());
                    if (parts[0] && !result.city) result.city = parts[0];
                    if (parts[1] && !result.state) result.state = parts[1];
                  }
                }

                // === SOURCE 4: DOM .job-listing-header sections (Job Type, Description) ===
                let descriptionText = '';
                const headers = document.querySelectorAll('.job-listing-header');
                for (const header of headers) {
                  const headerText = header.textContent.trim();
                  if (headerText === 'Job Type' && header.nextElementSibling) {
                    result.jobType = header.nextElementSibling.textContent.trim();
                  }
                  if (headerText === 'Description' && header.nextElementSibling) {
                    descriptionText = header.nextElementSibling.innerText || '';
                    if (!result.salary) result.salary = extractSalary(descriptionText);
                  }
                }

                // === SOURCE 5: Extract hospital name from description text ===
                // Paylocity descriptions: "Wickford Veterinary Clinic, located in North Kingstown, RI is looking for..."
                const text = descriptionText || '';
                if (text) {
                  const hospKeywords = '(?:Veterinary\\s+(?:Clinic|Hospital|Center|Care|Practice|Group)|Animal\\s+(?:Hospital|Clinic|Care|Center)|Pet\\s+(?:Hospital|Clinic|Care|Center)|Emergency\\s+(?:Hospital|Center|Clinic))';

                  // Pattern: "[Hospital Name Veterinary Clinic/Hospital/etc], located in"
                  const hospLocatedMatch = text.match(new RegExp('((?:[\\w\'.&-]+\\s+){0,6}' + hospKeywords + ')[,\\s]+located\\s+in', 'i'));
                  if (hospLocatedMatch) {
                    result.hospitalName = hospLocatedMatch[1].trim();
                  }

                  // Fallback: "[Hospital Name], is looking/seeking for"
                  if (!result.hospitalName) {
                    const hospLookingMatch = text.match(new RegExp('((?:[\\w\'.&-]+\\s+){0,6}' + hospKeywords + ')[,\\s]+(?:is\\s+)?(?:looking|seeking)', 'i'));
                    if (hospLookingMatch) {
                      result.hospitalName = hospLookingMatch[1].trim();
                    }
                  }

                  // Fallback: any "[Name] Veterinary [Clinic/Hospital/etc]" in text
                  if (!result.hospitalName) {
                    const hospGenericMatch = text.match(new RegExp('\\b((?:[\\w\'.&-]+\\s+){0,6}' + hospKeywords + ')\\b', 'i'));
                    if (hospGenericMatch) {
                      let name = hospGenericMatch[1].trim();
                      name = name.replace(/^(the|a|an|our|at)\s+/i, '').trim();
                      if (name.length >= 5) result.hospitalName = name;
                    }
                  }
                }

                // Fallback: og:title "Pieper Veterinary - Job Title" → use first part
                if (!result.hospitalName) {
                  const ogTitle = document.querySelector('meta[property="og:title"]');
                  if (ogTitle) {
                    const titleContent = ogTitle.getAttribute('content') || '';
                    const parts = titleContent.split(' - ');
                    if (parts.length > 1) {
                      result.hospitalName = parts[0].trim();
                    }
                  }
                }

                // === SOURCE 6: Area of Practice from position keyword lookup ===
                if (result.position) {
                  result.areaOfPractice = lookupAreaOfPractice(result.position);
                }
                // Fallback: scan full description text for area of practice keywords
                if (!result.areaOfPractice && descriptionText) {
                  result.areaOfPractice = lookupAreaOfPractice(descriptionText);
                }

                return result;
              }
            }).then((results) => {
              const details = results[0]?.result || {};
              chrome.tabs.remove(tab.id);
              chrome.runtime.sendMessage({
                action: 'detailsFetched',
                details: details,
                jobIndex: jobIndex
              }).catch(() => {});
            }).catch((err) => {
              console.error('Error extracting job details:', err);
              chrome.tabs.remove(tab.id).catch(() => {});
              chrome.runtime.sendMessage({
                action: 'detailsFetched',
                details: {},
                jobIndex: jobIndex
              }).catch(() => {});
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

        // Wait for React to render, then inject script to extract description
        setTimeout(() => {
          chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: () => {
              return new Promise((resolve) => {
                let attempts = 0;
                const maxAttempts = 20; // 20 attempts * 500ms = 10s max

                function stripHtml(html) {
                  const temp = document.createElement('div');
                  temp.innerHTML = html;
                  return temp.textContent || temp.innerText || '';
                }

                function tryExtract() {
                  attempts++;

                  // Method 1: Extract from JSON-LD structured data (cleanest source)
                  const jsonLdScript = document.querySelector('script[type="application/ld+json"]');
                  if (jsonLdScript) {
                    try {
                      const data = JSON.parse(jsonLdScript.textContent);
                      if (data['@type'] === 'JobPosting' && data.description) {
                        const description = stripHtml(data.description).trim();
                        if (description.length > 50) {
                          resolve({ description });
                          return;
                        }
                      }
                    } catch (e) { /* JSON parse failed, try next method */ }
                  }

                  // Method 2: Wait for React to render #applicant-tracking
                  const container = document.querySelector('#applicant-tracking');
                  if (container) {
                    // Target the job description section specifically
                    const descSection = container.querySelector('.job-detail-description, .job-description, [class*="description"]');
                    if (descSection && descSection.innerText.trim().length > 50) {
                      resolve({ description: descSection.innerText.trim() });
                      return;
                    }
                  }

                  if (attempts < maxAttempts) {
                    setTimeout(tryExtract, 500);
                  } else {
                    resolve({ description: '' });
                  }
                }

                tryExtract();
              });
            }
          }).then((results) => {
            const extractedData = results[0]?.result || {};

            // Save extracted data to the job record
            chrome.storage.local.get(['coveJobs'], (result) => {
              const jobs = result.coveJobs || [];
              if (jobs[jobIndex]) {
                jobs[jobIndex].description = extractedData.description || '';

                chrome.storage.local.set({ coveJobs: jobs }, () => {
                  console.log(`Description saved for job ${jobIndex + 1}`);
                  chrome.tabs.remove(tabId);
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
            chrome.tabs.remove(tabId).catch(() => {});
            chrome.runtime.sendMessage({
              action: 'descriptionSaved',
              jobIndex: jobIndex,
              success: false
            });
          });
        }, 1000); // Short initial wait, polling handles the rest
      }
    });

    return true; // Keep message channel open
  }
});

// Clear scraping status on extension startup/reload
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ isScraping: false });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.set({ isScraping: false });
});
