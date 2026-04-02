chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'storeJobs') {
    chrome.storage.local.set({ laaserJobs: request.data }, () => {
      console.log('LAASER jobs data stored.');
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

    return true;
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
                const result = { hospitalName: '', streetAddress: '', city: '', state: '', postalCode: '', jobType: '', salary: '', position: '', areaOfPractice: '' };

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
                  const patterns = [/\$[\d,]+k?\s*[-–]+\s*\$?[\d,]+k/i, /\$[\d,]+(?:,\d{3})*\s*[-–]+\s*\$[\d,]+(?:,\d{3})*/i, /\$[\d,]+(?:\.\d{2})?\s*[-–\/]+\s*\$?[\d,]+(?:\.\d{2})?\s*(?:per\s+)?(?:hourly|hour|hr|\/hr|\/\s*hour)/i, /\$[\d,]+(?:\.\d{2})?\s*(?:per\s+)?(?:year|annually|annum|annual)/i, /salary\s+range[^.\n]*?\$[\d,]+k?[^.\n]{0,40}/i, /pay[:\s]+\$[\d,]+(?:\.\d{2})?[^.\n]{0,60}/i, /\$[\d,]+k\+?/i];
                  for (const p of patterns) { const m = text.match(p); if (m) { let s = m[0].trim().replace(/[.,;:\s]+$/, ''); return s.length > 100 ? s.substring(0, 100) : s; } }
                  return '';
                }

                // === SOURCE 1: JSON-LD (Indeed viewjob pages have JobPosting) ===
                const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
                for (const s of ldScripts) {
                  try {
                    const ld = JSON.parse(s.textContent);
                    if (ld['@type'] === 'JobPosting') {
                      if (ld.title) result.position = ld.title;
                      if (ld.employmentType) {
                        const types = Array.isArray(ld.employmentType) ? ld.employmentType : [ld.employmentType];
                        result.jobType = types.join(', ').replace(/_/g, ' ');
                      }
                      if (ld.jobLocation && ld.jobLocation.address) {
                        const addr = ld.jobLocation.address;
                        result.streetAddress = addr.streetAddress || '';
                        result.city = addr.addressLocality || '';
                        result.state = addr.addressRegion || '';
                        result.postalCode = addr.postalCode || '';
                      }
                      if (ld.hiringOrganization && ld.hiringOrganization.name) {
                        result.hospitalName = ld.hiringOrganization.name;
                      }
                      if (ld.baseSalary && ld.baseSalary.value) {
                        const sv = ld.baseSalary.value;
                        if (sv.minValue && sv.maxValue && (sv.minValue > 0 || sv.maxValue > 0)) {
                          result.salary = '$' + Number(sv.minValue).toLocaleString() + ' - $' + Number(sv.maxValue).toLocaleString();
                          if (sv.unitText) result.salary += ' / ' + sv.unitText;
                        }
                      }
                      if (ld.description) {
                        const descText = stripHtml(ld.description);
                        if (!result.salary) result.salary = extractSalary(descText);
                      }
                      break;
                    }
                  } catch (e) {}
                }

                // === SOURCE 2: Indeed DOM elements ===
                // Job title
                if (!result.position) {
                  const titleEl = document.querySelector('[data-testid="jobsearch-JobInfoHeader-title"], .jobsearch-JobInfoHeader-title, h1.jobsearch-JobInfoHeader-title');
                  if (titleEl) result.position = titleEl.textContent.trim();
                }

                // Company name
                if (!result.hospitalName) {
                  const companyEl = document.querySelector('[data-testid="inlineHeader-companyName"] a, [data-company-name], .jobsearch-InlineCompanyRating-companyHeader a');
                  if (companyEl) result.hospitalName = companyEl.textContent.trim();
                }

                // Location
                if (!result.city) {
                  const locEl = document.querySelector('[data-testid="inlineHeader-companyLocation"], [data-testid="jobsearch-JobInfoHeader-companyLocation"], .jobsearch-InlineCompanyRating div:last-child');
                  if (locEl) {
                    const locText = locEl.textContent.trim();
                    const parts = locText.split(',').map(s => s.trim());
                    if (parts[0]) result.city = parts[0];
                    if (parts[1]) result.state = parts[1].replace(/\d+/g, '').trim();
                  }
                }

                // Salary from metadata
                if (!result.salary) {
                  const salaryEl = document.querySelector('#salaryInfoAndJobType .salary-snippet-container, [data-testid="attribute_snippet_testid"], .jobsearch-JobMetadataHeader-item');
                  if (salaryEl) {
                    const salText = salaryEl.textContent.trim();
                    if (salText.includes('$')) result.salary = salText;
                  }
                }

                // Job type from metadata
                if (!result.jobType) {
                  const typeEl = document.querySelector('#salaryInfoAndJobType .jobsearch-JobMetadataHeader-item:not(.salary-snippet-container)');
                  if (typeEl && !typeEl.textContent.includes('$')) {
                    result.jobType = typeEl.textContent.trim();
                  }
                }

                // Description for salary/hospital fallback
                if (!result.salary || !result.hospitalName) {
                  const descEl = document.getElementById('jobDescriptionText');
                  if (descEl) {
                    const text = descEl.innerText || '';
                    if (!result.salary) result.salary = extractSalary(text);
                  }
                }

                // === SOURCE 3: Area of Practice ===
                if (result.position) result.areaOfPractice = lookupAreaOfPractice(result.position);
                if (!result.areaOfPractice) {
                  const descEl = document.getElementById('jobDescriptionText');
                  if (descEl) result.areaOfPractice = lookupAreaOfPractice(descEl.innerText || '');
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

    chrome.tabs.onUpdated.addListener(function listener(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);

        setTimeout(() => {
          chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: () => {
              return new Promise((resolve) => {
                let attempts = 0;
                const maxAttempts = 20;

                function stripHtml(html) {
                  const temp = document.createElement('div');
                  temp.innerHTML = html;
                  return temp.textContent || temp.innerText || '';
                }

                function tryExtract() {
                  attempts++;

                  // Method 1: JSON-LD structured data
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
                    } catch (e) { /* try next */ }
                  }

                  // Method 2: Indeed job description container
                  const descEl = document.getElementById('jobDescriptionText');
                  if (descEl && descEl.innerText.trim().length > 50) {
                    resolve({ description: descEl.innerText.trim() });
                    return;
                  }

                  // Method 3: Alternative Indeed selectors
                  const selectors = [
                    '.jobsearch-jobDescriptionText',
                    '.jobsearch-JobComponent-description',
                    '#jobDescription',
                    '.job-desc',
                    '[data-testid="jobDescriptionText"]'
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

            chrome.storage.local.get(['laaserJobs'], (result) => {
              const jobs = result.laaserJobs || [];
              if (jobs[jobIndex]) {
                jobs[jobIndex].description = extractedData.description || '';

                chrome.storage.local.set({ laaserJobs: jobs }, () => {
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
        }, 1000);
      }
    });

    return true;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ isScraping: false });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.set({ isScraping: false });
});
