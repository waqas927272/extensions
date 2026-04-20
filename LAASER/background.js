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
              world: 'MAIN',   // MAIN world so we can access window.mosaic & JS globals if needed
              func: () => {
                var result = {
                  hospitalName: '', streetAddress: '', city: '', state: '',
                  postalCode: '', jobType: '', salary: '', position: '', areaOfPractice: ''
                };

                // ── Strip HTML tags from a string ────────────────────────────
                function stripHtml(html) {
                  var t = document.createElement('div');
                  t.innerHTML = html;
                  return t.textContent || t.innerText || '';
                }

                // ── Extract a dollar-range / salary value from raw text ───────
                // Returns the shortest clean match (e.g. "$22.00 - $36.00 / HOUR")
                function extractSalary(text) {
                  if (!text) return '';
                  var patterns = [
                    // range with unit: $22.00 - $36.00 / hr|hour|year
                    /\$[\d,]+(?:\.\d+)?\s*[-–]\s*\$[\d,]+(?:\.\d+)?\s*(?:\/?(?:per\s+)?(?:hour|hr\.?|year|yr\.?|annually))?/i,
                    // k-range: $60k - $90k
                    /\$[\d,]+k\s*[-–]\s*\$?[\d,]+k/i,
                    // "from $X/hr" or "starting at $X"
                    /(?:from|starting\s+(?:at|pay))[:\s]+\$[\d,]+(?:\.\d+)?(?:\s*\/?\s*(?:per\s+)?(?:hour|hr\.?|year|yr\.?))?/i,
                    // single value with unit: $22/hr, $22 per hour, $22 an hour
                    /\$[\d,]+(?:\.\d+)?\s*(?:\/\s*(?:hour|hr\.?|year|yr\.?)|per\s+(?:hour|hr\.?|year|yr\.?)|an?\s+(?:hour|hr\.?))/i,
                    // annual: $60,000 per year
                    /\$[\d,]+(?:,\d{3})*\s*(?:per\s+)?(?:year|annually|annum|annual)/i,
                    // k suffix: $60k
                    /\$[\d,]+k\+?/i,
                    // bare range: $22,000 - $36,000
                    /\$[\d,]+(?:,\d{3})*\s*[-–]\s*\$[\d,]+(?:,\d{3})*/i
                  ];
                  for (var pi = 0; pi < patterns.length; pi++) {
                    var m = text.match(patterns[pi]);
                    if (m) {
                      var s = m[0].trim().replace(/[.,;:\s]+$/, '');
                      return s.length > 120 ? s.substring(0, 120) : s;
                    }
                  }
                  return '';
                }

                // ── Determine Area of Practice for LAASER (specialty/ER hospital) ──
                // LAASER is Los Angeles Animal Specialty Emergency & Rehabilitation;
                // all roles default to Specialty Care unless explicitly emergency.
                function lookupAreaOfPractice(title) {
                  if (!title) return 'Specialty Care';
                  var t = title.toLowerCase();

                  // Emergency keywords
                  if (t.includes('emergency') || /\ber\s*vet\b/.test(t) || /\becc\b/.test(t) ||
                      t.includes('criticalist') || t.includes('critical care') || t.includes('urgent care')) {
                    return 'Emergency Care';
                  }

                  // Specialty — all other clinical/support roles at LAASER
                  return 'Specialty Care';
                }

                // ── Determine canonical position name from job title ──────────
                // Mirrors the medvet extension's getPositionFromTitle() logic,
                // adapted for LAASER's vet-tech-heavy job mix.
                function lookupPosition(title) {
                  if (!title) return 'Associate Veterinarian';
                  var t = title.toLowerCase();

                  // Is this a technician / tech role?
                  // Exclude "technician specialist" or "vts" which are their own category.
                  var isTechRole = /\b(technician|technologist|vet\s+tech|nurse)\b/.test(t) &&
                                   !t.includes('technician specialist') && !/\bvts\b/.test(t);

                  if (isTechRole) {
                    // Map the tech to the specialist role for their department
                    if (t.includes('anesthesia') || t.includes('anesthesiolog')) return 'Anesthesiologist';
                    if (t.includes('dental') || t.includes('dentistry')) return 'Dental Specialist';
                    if (t.includes('critical care') || /\becc\b/.test(t) || t.includes('criticalist')) return 'ECC Specialist';
                    if (t.includes('radiation oncolog') || (t.includes('radiation') && t.includes('oncol'))) return 'Radiation Oncologist';
                    if (t.includes('oncolog') && !t.includes('radiation')) return 'Medical Oncologist';
                    if (t.includes('cardiolog')) return 'Cardiologist';
                    if (t.includes('neurolog') || t.includes('neurosurg')) return 'Neurologist & Neurosurgeon';
                    if (t.includes('dermatolog')) return 'Dermatologist';
                    if (t.includes('ophthalmolog')) return 'Ophthalmologist';
                    if ((t.includes('surgery') || t.includes('surgical') || t.includes('surgeon')) && !t.includes('neurosurg')) return 'Surgeon';
                    if (t.includes('radiolog') || t.includes('diagnostic imaging')) return 'Radiologist';
                    if (t.includes('internal medicine')) return 'Internal Medicine Specialist';
                    if (t.includes('rehabilitation') || t.includes('rehab')) return 'Credentialed Veterinary Technician Specialist';
                    // Generic specialty/emergency tech
                    if (t.includes('specialist') || t.includes('specialty') || t.includes('emergency')) return 'Credentialed Veterinary Technician Specialist';
                    // Any other tech at LAASER → Credentialed Vet Tech Specialist (specialty hospital)
                    return 'Credentialed Veterinary Technician Specialist';
                  }

                  // VTS designation
                  if (t.includes('technician specialist') || /\bvts\b/.test(t)) return 'Credentialed Veterinary Technician Specialist';

                  // Leadership
                  if (t.includes('medical director')) return 'Medical Director';
                  if (t.includes('lead veterinarian') || t.includes('lead vet')) return 'Lead Veterinarian';

                  // ECC / Criticalist DVM
                  if (t.includes('criticalist') || t.includes('dacvecc') || /\becc\b/.test(t) ||
                      (t.includes('emergency') && t.includes('critical care'))) return 'ECC Specialist';

                  // Specialty DVM positions
                  if (t.includes('neurologist') || t.includes('neurosurgeon') || (t.includes('neurolog') && !isTechRole)) return 'Neurologist & Neurosurgeon';
                  if (t.includes('dermatologist') || (t.includes('dermatolog') && !isTechRole)) return 'Dermatologist';
                  if (t.includes('cardiologist') || (t.includes('cardiolog') && !isTechRole)) return 'Cardiologist';
                  if ((t.includes('oncologist') || t.includes('oncolog')) && t.includes('radiation')) return 'Radiation Oncologist';
                  if (t.includes('oncologist') || (t.includes('oncolog') && !isTechRole)) return 'Medical Oncologist';
                  if (t.includes('radiologist') || t.includes('diagnostic imaging') || (t.includes('radiolog') && !isTechRole)) return 'Radiologist';
                  if (t.includes('ophthalmologist') || (t.includes('ophthalmolog') && !isTechRole)) return 'Ophthalmologist';
                  if (t.includes('anesthesiologist') || (t.includes('anesthesiolog') && !isTechRole) || (t.includes('anesthesia') && !isTechRole)) return 'Anesthesiologist';
                  if (t.includes('theriogenologist') || (t.includes('theriogenolog') && !isTechRole)) return 'Theriogenologist';
                  if (t.includes('internist') || (t.includes('internal medicine') && !isTechRole)) return 'Internal Medicine Specialist';
                  if (t.includes('dabvp')) return 'DABVP Specialist';
                  if ((t.includes('dental') || t.includes('dentist')) && !t.includes('assistant')) return 'Dental Specialist';
                  if ((t.includes('surgeon') || (t.includes('surgery') && !isTechRole)) && !t.includes('neurosurg') && !t.includes('dental')) return 'Surgeon';

                  // Non-clinical / support roles → Associate Veterinarian (per convention)
                  var isNonClinical = t.includes('client service') || t.includes('service representative') ||
                    t.includes('receptionist') || t.includes('kennel') || t.includes('groomer') ||
                    t.includes('grooming') || t.includes('practice manager') || t.includes('hospital manager') ||
                    t.includes('office manager') || t.includes('administrator') || t.includes('billing') ||
                    t.includes('coordinator') || t.includes('customer service') || t.includes('front desk') ||
                    t.includes('inventory') || t.includes('housekeeper') || t.includes('assistant') ||
                    t.includes('liaison') || t.includes('concierge') || t.includes('agent');
                  if (isNonClinical) return 'Associate Veterinarian';

                  // Emergency DVM (title just says "emergency veterinarian")
                  if (t.includes('emergency') && (t.includes('veterinarian') || t.includes('dvm') || t.includes('vmd'))) return 'Associate Veterinarian';

                  // Generic DVM / vet
                  if (t.includes('veterinarian') || t.includes('dvm') || t.includes('vmd')) return 'Associate Veterinarian';

                  // Fallback
                  return 'Associate Veterinarian';
                }

                // ═══════════════════════════════════════════════════════════
                // SOURCE 1: JSON-LD structured data (most reliable on Indeed)
                // ═══════════════════════════════════════════════════════════
                var ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
                for (var si = 0; si < ldScripts.length; si++) {
                  try {
                    var ld = JSON.parse(ldScripts[si].textContent);
                    if (ld['@type'] === 'JobPosting') {
                      // Job title → used for position/AOP lookup
                      if (ld.title) result.position = ld.title;

                      // Employment type
                      if (ld.employmentType) {
                        var types = Array.isArray(ld.employmentType) ? ld.employmentType : [ld.employmentType];
                        result.jobType = types.join(', ').replace(/_/g, ' ');
                      }

                      // Location / address
                      if (ld.jobLocation && ld.jobLocation.address) {
                        var addr = ld.jobLocation.address;
                        result.streetAddress = addr.streetAddress || '';
                        result.city          = addr.addressLocality || '';
                        result.state         = addr.addressRegion || '';
                        result.postalCode    = addr.postalCode || '';
                      }

                      // Hiring organization
                      if (ld.hiringOrganization && ld.hiringOrganization.name) {
                        result.hospitalName = ld.hiringOrganization.name;
                      }

                      // Salary from structured baseSalary
                      if (ld.baseSalary && ld.baseSalary.value) {
                        var sv = ld.baseSalary.value;
                        if (sv.minValue > 0 && sv.maxValue > 0) {
                          var unit = (sv.unitText || '').toUpperCase();
                          var unitLabel = unit === 'HOUR' ? '/hr' : unit === 'YEAR' ? '/yr' : (unit ? ' / ' + unit : '');
                          result.salary = '$' + Number(sv.minValue).toLocaleString() + ' - $' + Number(sv.maxValue).toLocaleString() + unitLabel;
                        } else if (sv.value > 0) {
                          var unit2 = (sv.unitText || '').toUpperCase();
                          var unitLabel2 = unit2 === 'HOUR' ? '/hr' : unit2 === 'YEAR' ? '/yr' : (unit2 ? ' / ' + unit2 : '');
                          result.salary = '$' + Number(sv.value).toLocaleString() + unitLabel2;
                        }
                      }

                      // Salary fallback: scan description text
                      if (!result.salary && ld.description) {
                        var descText = stripHtml(ld.description);
                        result.salary = extractSalary(descText);
                      }

                      break;
                    }
                  } catch (e) { /* try next script */ }
                }

                // ═══════════════════════════════════════════════════════════
                // SOURCE 2: window.mosaic (MAIN world only — viewjob page)
                // ═══════════════════════════════════════════════════════════
                try {
                  var mosaic = window.mosaic;
                  if (mosaic && mosaic.providerData) {
                    // viewjob page may expose enriched job data
                    var vjData = mosaic.providerData['mosaic-provider-viewjob'] ||
                                 mosaic.providerData['viewJob'] ||
                                 mosaic.providerData['mosaic-provider-jobcards'];
                    if (vjData) {
                      var vj = (vjData.metaData || {}).mosaicProviderViewJobModel ||
                               (vjData.metaData || {}).mosaicProviderJobCardsModel || {};
                      var job = vj.job || vj;
                      if (job && job.salarySnippet && job.salarySnippet.text && !result.salary) {
                        result.salary = job.salarySnippet.text;
                      }
                    }
                  }
                } catch (e) { /* mosaic not available */ }

                // ═══════════════════════════════════════════════════════════
                // SOURCE 3: Indeed DOM elements (fallbacks)
                // ═══════════════════════════════════════════════════════════

                // Job title (for position/AOP if JSON-LD missing)
                if (!result.position) {
                  var titleEl =
                    document.querySelector('[data-testid="jobsearch-JobInfoHeader-title"]') ||
                    document.querySelector('.jobsearch-JobInfoHeader-title') ||
                    document.querySelector('h1[class*="jobTitle"]') ||
                    document.querySelector('h1');
                  if (titleEl) {
                    // Remove "(New!)" or " - job post" suffixes Indeed sometimes adds
                    result.position = titleEl.textContent.trim()
                      .replace(/\s*[-–]\s*job post\s*$/i, '')
                      .replace(/\s*\(new!\)\s*$/i, '')
                      .trim();
                  }
                }

                // Company name fallback
                if (!result.hospitalName) {
                  var companyEl =
                    document.querySelector('[data-testid="inlineHeader-companyName"] a') ||
                    document.querySelector('[data-company-name]') ||
                    document.querySelector('.jobsearch-InlineCompanyRating-companyHeader a') ||
                    document.querySelector('[data-testid="viewJobCompanyName"]');
                  if (companyEl) result.hospitalName = companyEl.textContent.trim();
                }

                // Location fallback
                if (!result.city) {
                  var locEl =
                    document.querySelector('[data-testid="inlineHeader-companyLocation"]') ||
                    document.querySelector('[data-testid="jobsearch-JobInfoHeader-companyLocation"]') ||
                    document.querySelector('[data-testid="viewJobCompanyLocation"]');
                  if (locEl) {
                    var locText = locEl.textContent.trim();
                    // Format: "Los Angeles, CA 90025" or "Los Angeles, CA"
                    var locMatch = locText.match(/^([^,]+),\s*([A-Z]{2})\s*(\d{5})?/);
                    if (locMatch) {
                      result.city      = locMatch[1].trim();
                      result.state     = locMatch[2].trim();
                      if (locMatch[3]) result.postalCode = locMatch[3].trim();
                    } else {
                      var parts = locText.split(',').map(function(s) { return s.trim(); });
                      if (parts[0]) result.city  = parts[0];
                      if (parts[1]) result.state = parts[1].replace(/\d+/g, '').trim();
                    }
                  }
                }

                // Salary fallback from DOM salary chip
                if (!result.salary) {
                  // Primary salary chip
                  var salaryEl =
                    document.querySelector('[data-testid="salaryInfoAndJobType"] .salary-snippet-container') ||
                    document.querySelector('#salaryInfoAndJobType .salary-snippet-container') ||
                    document.querySelector('.jobsearch-SalaryEstimate') ||
                    document.querySelector('[data-testid="attribute_snippet_testid"]');
                  if (salaryEl) {
                    var salText = salaryEl.textContent.trim();
                    if (salText.includes('$')) {
                      var extracted = extractSalary(salText);
                      if (extracted) result.salary = extracted;
                      else result.salary = salText.substring(0, 120);
                    }
                  }
                }

                // Job type fallback from DOM
                if (!result.jobType) {
                  var allMetaItems = document.querySelectorAll(
                    '#salaryInfoAndJobType .jobsearch-JobMetadataHeader-item, ' +
                    '[data-testid="salaryInfoAndJobType"] span, ' +
                    '[data-testid="attribute_snippet_testid"] span'
                  );
                  for (var mi = 0; mi < allMetaItems.length; mi++) {
                    var mt = allMetaItems[mi].textContent.trim();
                    if (/full.time|part.time|contract|temporary|internship|per diem/i.test(mt) && !mt.includes('$')) {
                      result.jobType = mt;
                      break;
                    }
                  }
                }

                // Salary fallback from job description text
                if (!result.salary) {
                  var descEl = document.getElementById('jobDescriptionText') ||
                               document.querySelector('[data-testid="jobDescriptionText"]') ||
                               document.querySelector('.jobsearch-jobDescriptionText');
                  if (descEl) {
                    result.salary = extractSalary(descEl.innerText || '');
                  }
                }

                // ═══════════════════════════════════════════════════════════
                // SOURCE 4: Derive Position & AOP from the job title
                // ═══════════════════════════════════════════════════════════
                // result.position currently holds the raw Indeed job title.
                // Map it to a canonical position + AOP.
                if (result.position) {
                  result.areaOfPractice = lookupAreaOfPractice(result.position);
                  result.position       = lookupPosition(result.position);
                }

                console.log('[LAASER] details extracted:', JSON.stringify(result));
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
          }, 4000);   // 4 s — Indeed is JS-heavy; give it a little more time
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
                  const descEl = document.getElementById('jobDescriptionText') ||
                                 document.querySelector('[data-testid="jobDescriptionText"]');
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
