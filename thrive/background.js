chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'storeJobs') {
    chrome.storage.local.set({ thriveJobs: request.data }, () => {
      console.log('Thrive jobs data stored.');
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
                  { area: 'General Practice Care', keywords: ['medical director', 'veterinarian medical director', 'associate veterinarian', 'gp vet', 'quick care veterinarian', 'dvm', 'vmd', 'relief veterinarian', 'relief dvm', 'locum veterinarian', 'veterinarian'] },
                  { area: 'Emergency Care', keywords: ['emergency veterinarian', 'er vet', 'er veterinarian', 'er dvm', 'urgent care veterinarian', 'relief emergency veterinarian', 'relief emergency vet'] },
                  { area: 'Urgent Care', keywords: ['urgent care veterinarian', 'urgent veterinarian'] },
                  { area: 'General Practice Care / Emergency Care / Urgent Care', keywords: ['equine veterinarian', 'equine vet', 'bovine veterinarian', 'large animal', 'equine dvm', 'avian veterinarian', 'exotics veterinarian', 'avian vet', 'exotics vet', 'associate exotics veterinarian', 'avian & exotics', 'equine/bovine'] },
                  { area: 'Specialty Care', keywords: ['criticalist', 'dacvecc', 'board certified criticalist', 'residency trained criticalist', 'emergency & critical care', 'ecc', 'medical oncologist', 'oncologist', 'dacvim', 'acvim', 'medonc', 'radiation oncologist', 'dacvr-ro', 'radonc', 'internal medicine specialist', 'internist', 'veterinary internist', 'saim', 'small animal internal medicine', 'neurologist', 'neurosurgeon', 'veterinary neurologist', 'cardiologist', 'veterinary cardiologist', 'small animal cardiologist', 'dentist', 'oral surgeon', 'dentist & oral surgeon', 'davdc', 'dermatologist', 'veterinary dermatologist', 'dacvd', 'acvd', 'surgeon', 'veterinary surgery', 'dacvs', 'acvs', 'small animal surgeon', 'radiologist', 'veterinary radiologist', 'diagnostic imaging specialist', 'dacvr', 'acvr', 'ophthalmologist', 'veterinary ophthalmologist', 'dacvo', 'acvo', 'anesthesiologist', 'veterinary anesthesiologist', 'dacvaa', 'acvaa', 'theriogenologist', 'veterinary theriogenologist', 'dact', 'rehabilitation therapist', 'ccrt', 'canine rehabilitation', 'veterinary technician specialist', 'vts', 'residency trained', 'board certified', 'veterinary specialist', 'specialty doctor'] }
                ];

                function lookupAreaOfPractice(positionText) {
                  if (!positionText) return '';
                  const posLower = positionText.toLowerCase();
                  for (let i = areaOfPracticeMap.length - 1; i >= 0; i--) {
                    const entry = areaOfPracticeMap[i];
                    for (const kw of entry.keywords) {
                      if (posLower.includes(kw)) return entry.area;
                    }
                  }
                  return '';
                }

                function extractSalary(text) {
                  if (!text) return '';
                  const patterns = [
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
                  for (const p of patterns) {
                    const m = text.match(p);
                    if (m) {
                      let sal = m[0].trim().replace(/[.,;:\s]+$/, '').trim();
                      if (sal.length > 100) sal = sal.substring(0, 100).trim();
                      return sal;
                    }
                  }
                  return '';
                }

                // === SOURCE 1: JSON-LD ===
                const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
                for (const s of ldScripts) {
                  try {
                    const ld = JSON.parse(s.textContent);
                    if (ld['@type'] === 'JobPosting') {
                      if (ld.title) result.position = ld.title;
                      if (ld.employmentType) result.jobType = ld.employmentType;
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
                        // Hospital: "Thrive Pet Healthcare - Falcon is looking for"
                        const hospMatch = descText.match(/(Thrive(?:\s+Pet\s+Healthcare)?\s*[-–]\s*[\w\s'.&-]+?)(?:\s+is\s+looking|\s+in\s+\w)/i);
                        if (hospMatch) result.hospitalName = hospMatch[1].trim();
                      }
                      break;
                    }
                  } catch (e) {}
                }

                // === SOURCE 2: DOM h1 (position) ===
                if (!result.position) {
                  const h1 = document.querySelector('.job-details-inner-js h1');
                  if (h1) result.position = h1.textContent.trim();
                }

                // === SOURCE 3: DOM info block (hospital, location, time type) ===
                // Structure: "Thrive Falcon<br> <strong>Location</strong>: Katy, TX, 77494<br> <strong>Time Type</strong>: Full-Time"
                const infoP = document.querySelector('.job-details__main p');
                if (infoP) {
                  const html = infoP.innerHTML;
                  const text = infoP.textContent || '';

                  // Hospital name: text before the first <br> or <strong>
                  const hospPart = html.split(/<br\s*\/?>/i)[0];
                  if (hospPart) {
                    const hospText = stripHtml(hospPart).trim();
                    if (hospText && !hospText.startsWith('Location') && !hospText.startsWith('Time')) {
                      if (!result.hospitalName) result.hospitalName = hospText;
                    }
                  }

                  // Location: after "Location:"
                  const locMatch = text.match(/Location\s*:\s*([^,]+),\s*(\w+),?\s*(\d{5})?/i);
                  if (locMatch) {
                    if (!result.city) result.city = locMatch[1].trim();
                    if (!result.state) result.state = locMatch[2].trim();
                    if (!result.postalCode && locMatch[3]) result.postalCode = locMatch[3].trim();
                  }

                  // Time Type
                  const timeMatch = text.match(/Time\s+Type\s*:\s*(.+)/i);
                  if (timeMatch && !result.jobType) {
                    result.jobType = timeMatch[1].trim();
                  }
                }

                // === SOURCE 4: Area of Practice from position ===
                if (result.position) {
                  result.areaOfPractice = lookupAreaOfPractice(result.position);
                }
                // Fallback: scan description text
                if (!result.areaOfPractice) {
                  const descEl = document.querySelector('.job-details-inner-js');
                  if (descEl) {
                    result.areaOfPractice = lookupAreaOfPractice(descEl.innerText || '');
                  }
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

        // Wait for page to render, then inject script to extract description
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

                  // Method 2: Try .job-details-inner-js container (Talemetry pattern)
                  const jobDetailsInner = document.querySelector('.job-details-inner-js');
                  if (jobDetailsInner && jobDetailsInner.innerText.trim().length > 50) {
                    const clone = jobDetailsInner.cloneNode(true);
                    // Remove buttons, nav, similar jobs sections
                    clone.querySelectorAll('button, .btn, [role="button"], .similar-jobs-element-js, .apply-bottom, #apply-top, #refer-top, .social-share, .job-details-share, nav, header, footer').forEach(el => el.remove());
                    const description = clone.innerText.trim();
                    if (description.length > 50) {
                      resolve({ description });
                      return;
                    }
                  }

                  // Method 3: Try common description selectors
                  const selectors = [
                    '.job-description',
                    '.job-details-description',
                    '.job-posting-description',
                    '.ats-description'
                  ];
                  for (const selector of selectors) {
                    const el = document.querySelector(selector);
                    if (el && el.innerText.trim().length > 50) {
                      resolve({ description: el.innerText.trim() });
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
            chrome.storage.local.get(['thriveJobs'], (result) => {
              const jobs = result.thriveJobs || [];
              if (jobs[jobIndex]) {
                jobs[jobIndex].description = extractedData.description || '';

                chrome.storage.local.set({ thriveJobs: jobs }, () => {
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
