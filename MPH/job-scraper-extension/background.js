// Mission Pet Health Job Scraper - Background Service Worker

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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
                const result = { hospitalName: '', streetAddress: '', city: '', state: '', postalCode: '', jobType: '', salary: '', position: '', areaOfPractice: '', department: '' };

                // ════════════════════════════════════════════════════════════
                // POSITION & AOP — keyword-driven, data-table approach
                // Source of truth: CorrectJobNames.txt
                //
                // Emergency Care    → Associate Veterinarian
                // General Practice  → Associate Veterinarian, Lead Veterinarian, Medical Director
                // Specialty Care    → Anesthesiologist, Cardiologist, CVTS, DABVP Specialist,
                //                     Dental Specialist, Dermatologist, ECC Specialist,
                //                     Internal Medicine Specialist, Medical Director,
                //                     Medical Oncologist, Neurologist & Neurosurgeon,
                //                     Ophthalmologist, Radiation Oncologist, Radiologist, Surgeon
                // Urgent Care       → Associate Veterinarian, Partner Veterinarian
                // ════════════════════════════════════════════════════════════

                // ── Non-clinical roles that should be skipped ─────────────
                function isNonClinical(t) {
                  return /client service|service representative|receptionist|kennel|groomer|grooming|practice manager|hospital manager|office manager|administrator|billing|human resources|patient care coordinator|client care coordinator|customer service|front desk|inventory|housekeeper|janitorial|externship|general job application|join our team/.test(t);
                }

                // ── Specialty positions set (from CorrectJobNames.txt) ─────
                const SPECIALTY_POSITIONS = new Set([
                  'Anesthesiologist','Cardiologist','Credentialed Veterinary Technician Specialist',
                  'DABVP Specialist','Dental Specialist','Dermatologist','ECC Specialist',
                  'Internal Medicine Specialist','Medical Oncologist','Neurologist & Neurosurgeon',
                  'Ophthalmologist','Radiation Oncologist','Radiologist','Surgeon','Theriogenologist'
                ]);

                // ── Keyword → Position table (priority order, first match wins) ──
                // Each entry: { pos, keywords[], regex?, exclude? }
                function matchKeywords(t, d) {
                  // t = title lower, d = dept lower
                  // Returns canonical position string or ''

                  // 1. Explicit "Associate Veterinarian" in title — return immediately
                  //    Prevents words like "dental" elsewhere in title from overriding.
                  if (/associate veterinarian|associate vet\b/.test(t))    return 'Associate Veterinarian';

                  // 2. Leadership
                  if (/medical lead veterinarian|medical lead vet\b/.test(t)) return 'Lead Veterinarian';
                  if (/medical director|medical lead/.test(t))              return 'Medical Director';
                  if (/lead veterinarian|lead vet\b/.test(t))              return 'Lead Veterinarian';
                  // "Partner Veterinarian" is not a real position — treat as Associate Vet
                  // (partner/founding are ownership terms, not clinical titles)

                  // 3. ECC Specialist — BEFORE generic "emergency"
                  if (/criticalist|dacvecc|\becc specialist\b/.test(t) ||
                      /\becc\b/.test(t) ||
                      (t.includes('emergency') && t.includes('critical care'))) return 'ECC Specialist';

                  // 3. Technician / tech roles → map to specialist for their dept
                  const isTech = /\b(technician|technologist|vet\s+tech|lvt|cvt|rdvt|nurse)\b/.test(t) &&
                                 !/technician specialist|\bvts\b/.test(t);
                  if (isTech) {
                    if (/anesthes/.test(t) || /anesthes/.test(d))                   return 'Anesthesiologist';
                    if (/dental|dentist/.test(t) || /dental|dentist/.test(d))       return 'Dental Specialist';
                    if (/criticalist|critical care|\becc\b/.test(t))                return 'ECC Specialist';
                    if (/radiation.*oncol|oncol.*radiation/.test(t))                return 'Radiation Oncologist';
                    if (/oncol/.test(t) && !/radiation/.test(t))                    return 'Medical Oncologist';
                    if (/cardiolog/.test(t) || /cardiolog/.test(d))                 return 'Cardiologist';
                    if (/neurolog|neurosurg/.test(t))                               return 'Neurologist & Neurosurgeon';
                    if (/dermatolog/.test(t))                                       return 'Dermatologist';
                    if (/ophthalmolog/.test(t))                                     return 'Ophthalmologist';
                    if (/surgery|surgical|surgeon/.test(t) && !/neurosurg/.test(t)) return 'Surgeon';
                    if (/radiolog|diagnostic imaging/.test(t))                      return 'Radiologist';
                    if (/internal medicine/.test(t))                                return 'Internal Medicine Specialist';
                    return 'Credentialed Veterinary Technician Specialist'; // all other techs
                  }

                  // 4. VTS
                  if (/technician specialist|\bvts\b/.test(t)) return 'Credentialed Veterinary Technician Specialist';

                  // 5. DACV credential combinations in title (specific → general)
                  if (/dacvim/.test(t) && /oncol/.test(t))               return 'Medical Oncologist';
                  if (/dacvr/.test(t)  && /(radiation|-ro)/.test(t))     return 'Radiation Oncologist';
                  if (/dacvim/.test(t) && /(neurolog|neurosurg)/.test(t))return 'Neurologist & Neurosurgeon';
                  if (/dacvim/.test(t) && /cardiolog/.test(t))           return 'Cardiologist';
                  if (/dacvim/.test(t))                                   return 'Internal Medicine Specialist';
                  if (/davdc|avdc/.test(t))                               return 'Dental Specialist';
                  if (/dacvd/.test(t))                                    return 'Dermatologist';
                  if (/dacvs|\bacvs\b/.test(t))                           return 'Surgeon';
                  if (/dacvr/.test(t))                                    return 'Radiologist';
                  if (/dacvo/.test(t))                                    return 'Ophthalmologist';
                  if (/dacvaa|dacva/.test(t))                             return 'Anesthesiologist';
                  if (/\bdact\b/.test(t))                                 return 'Theriogenologist';
                  if (/\bdabvp\b/.test(t))                                return 'DABVP Specialist';

                  // 6. Specialty keywords in title
                  //    ► Radiation before Medical (radiation oncology ⊃ oncology)
                  if (/radiation oncolog/.test(t))                                          return 'Radiation Oncologist';
                  if (/oncolog/.test(t))                                                    return 'Medical Oncologist';
                  if (/cardiolog/.test(t))                                                  return 'Cardiologist';
                  if (/neurolog|neurosurg/.test(t))                                         return 'Neurologist & Neurosurgeon';
                  if (/dermatolog/.test(t))                                                 return 'Dermatologist';
                  if (/ophthalmolog/.test(t))                                               return 'Ophthalmologist';
                  if (/anesthesiolog/.test(t))                                              return 'Anesthesiologist';
                  if (/theriogenolog/.test(t))                                              return 'Theriogenologist';
                  if (/internist|internal medicine/.test(t))                               return 'Internal Medicine Specialist';
                  if (/radiolog|diagnostic imaging/.test(t))                               return 'Radiologist';
                  //    ► Dental/Dentist/Dentistry → Dental Specialist (exclude "dental assistant")
                  if (/(dental|dentist|dentistry)/.test(t) && !/assistant/.test(t))        return 'Dental Specialist';
                  //    ► Surgeon/Surgery (exclude neurosurg, dental surgery)
                  if (/\bsurgeon\b/.test(t))                                               return 'Surgeon';
                  if (/(surgery|surgical)/.test(t) && !/neurosurg|dental/.test(t))         return 'Surgeon';

                  // 7. Equine / Large Animal / Avian
                  if (/equine|bovine|large animal/.test(t)) return 'Equine/Bovine Veterinarian/Large Animal';
                  if (/\bavian\b|exotics/.test(t))          return 'Avian & Exotics Veterinarian / Associate Exotics';

                  // 8. Generic DVM
                  if (/veterinarian|veterinary|\bdvm\b|relief|locum/.test(t)) return 'Associate Veterinarian';

                  return ''; // no match
                }

                // ── Department field → position (when title gives no specialty clue) ──
                function matchDept(d) {
                  if (!d) return '';
                  if (/criticalist|\becc\b|critical care/.test(d))          return 'ECC Specialist';
                  if (/radiation oncol/.test(d))                            return 'Radiation Oncologist';
                  if (/oncol/.test(d) && !/radiation/.test(d))             return 'Medical Oncologist';
                  if (/cardiolog/.test(d))                                  return 'Cardiologist';
                  if (/neurolog|neurosurg/.test(d))                        return 'Neurologist & Neurosurgeon';
                  if (/dermatolog/.test(d))                                 return 'Dermatologist';
                  if (/ophthalmolog|ophtho/.test(d))                       return 'Ophthalmologist';
                  if (/anesthesiolog|anesthesia/.test(d))                  return 'Anesthesiologist';
                  if (/theriogenolog/.test(d))                              return 'Theriogenologist';
                  if (/internal medicine|internist|saim/.test(d))          return 'Internal Medicine Specialist';
                  if (/radiolog|diagnostic imaging/.test(d))               return 'Radiologist';
                  if (/dental|dentistry|davdc/.test(d))                    return 'Dental Specialist';
                  if (/(surgery|surgeon)/.test(d) && !/neurosurg/.test(d)) return 'Surgeon';
                  if (/\bdabvp\b/.test(d))                                 return 'DABVP Specialist';
                  if (/rehabilitation|rehab/.test(d))                      return 'Credentialed Veterinary Technician Specialist';
                  return '';
                }

                // ── Qualifications section scan for DACV* credentials ──────
                function matchQualifications(bodyText) {
                  if (!bodyText) return '';
                  const lower = bodyText.toLowerCase();
                  const idx = Math.max(
                    lower.indexOf('qualif'), lower.indexOf('requirement'),
                    lower.indexOf('board cert'), lower.indexOf('diplomate'), lower.indexOf('residency')
                  );
                  const q = idx > -1 ? lower.slice(idx, idx + 2000) : lower;

                  if (/dacvecc/.test(q))                                  return 'ECC Specialist';
                  if (/dacvim/.test(q) && /oncol/.test(q))               return 'Medical Oncologist';
                  if (/dacvr/.test(q)  && /(radiation|-ro)/.test(q))     return 'Radiation Oncologist';
                  if (/dacvim/.test(q) && /(neurolog|neurosurg)/.test(q))return 'Neurologist & Neurosurgeon';
                  if (/dacvim/.test(q) && /cardiolog/.test(q))           return 'Cardiologist';
                  if (/dacvim/.test(q))                                   return 'Internal Medicine Specialist';
                  if (/davdc|avdc/.test(q))                               return 'Dental Specialist';
                  if (/dacvd/.test(q))                                    return 'Dermatologist';
                  if (/dacvs|\bacvs\b/.test(q))                           return 'Surgeon';
                  if (/dacvr/.test(q))                                    return 'Radiologist';
                  if (/dacvo/.test(q))                                    return 'Ophthalmologist';
                  if (/dacvaa/.test(q))                                   return 'Anesthesiologist';
                  if (/\bdact\b/.test(q))                                 return 'Theriogenologist';
                  if (/\bdabvp\b/.test(q))                                return 'DABVP Specialist';
                  if (/criticalist/.test(q))                              return 'ECC Specialist';
                  if (/board.certif|residency.train|diplomate/.test(q))  return '_SPECIALTY_FLAG_';
                  return '';
                }

                // ── AOP from a known position + context ─────────────────────
                function aopFromPosition(pos, t, h, d, b) {
                  if (SPECIALTY_POSITIONS.has(pos)) return 'Specialty Care';

                  if (pos === 'Medical Director') {
                    // Specialty MD if body/dept has specialist context
                    const specHints = ['dacvim','dacvecc','dacvr','dacvs','dacvd','dacvo','dacvaa',
                      'dact','davdc','dabvp','board certified','residency trained','diplomate',
                      'oncology','cardiology','neurology','dermatology','ophthalmology','anesthesia',
                      'radiology','surgery','internal medicine','criticalist','specialist'];
                    for (const kw of specHints) { if (b.includes(kw) || d.includes(kw)) return 'Specialty Care'; }
                    return 'General Practice Care';
                  }
                  if (pos === 'Lead Veterinarian') return 'General Practice Care';

                  // Associate Veterinarian — context decides Emergency / Urgent / GP
                  if (/emergency/.test(t) || /\ber\s+(vet|dvm)\b/.test(t) || h.includes('emergency')) return 'Emergency Care';
                  if (/urgent care/.test(t) || /urgent care/.test(d) || h.includes('urgent care'))     return 'Urgent Care';
                  if (/equine|bovine|large animal|avian|exotics/.test(t)) return 'General Practice Care / Emergency Care / Urgent Care';
                  return 'General Practice Care';
                }

                // ── Master: Determine Position ───────────────────────────────
                function determinePosition(rawTitle, dept, bodyText) {
                  const t = rawTitle.toLowerCase();
                  const d = (dept || '').toLowerCase();
                  const b = (bodyText || '').toLowerCase();

                  if (isNonClinical(t)) return '';

                  // Step 1: keyword match from title (+ dept for tech mapping)
                  let pos = matchKeywords(t, d);

                  // Step 2: if no title match, try dept field
                  if (!pos) pos = matchDept(d);

                  // Step 3: if still nothing and specialty context, scan qualifications
                  if (!pos) {
                    const fromQ = matchQualifications(b);
                    if (fromQ && fromQ !== '_SPECIALTY_FLAG_') pos = fromQ;
                  }

                  // Step 4: Medical Director override
                  if (!pos && /medical director/.test(t)) pos = 'Medical Director';

                  // Step 5: generic DVM fallback
                  if (!pos && /veterinarian|veterinary|\bdvm\b|relief|locum/.test(t)) pos = 'Associate Veterinarian';

                  return pos || '';
                }

                // ── Master: Determine Area of Practice ──────────────────────
                function determineAOP(rawTitle, hospitalName, dept, bodyText) {
                  const t = rawTitle.toLowerCase();
                  const h = (hospitalName || '').toLowerCase();
                  const d = (dept || '').toLowerCase();
                  const b = (bodyText || '').toLowerCase();

                  if (isNonClinical(t)) return '';

                  // Step 1: get position (title + dept + quals)
                  const pos = matchKeywords(t, d) || matchDept(d) || matchQualifications(b);

                  // Step 2: derive AOP from position
                  if (pos && pos !== '_SPECIALTY_FLAG_') {
                    return aopFromPosition(pos, t, h, d, b);
                  }

                  // Step 3: _SPECIALTY_FLAG_ or dept signals specialty
                  if (pos === '_SPECIALTY_FLAG_') return 'Specialty Care';

                  // Step 4: dept signals specialty without a known position
                  const specDepts = ['oncol','cardiolog','neurolog','neurosurg','dermatolog',
                    'ophthalmolog','anesthes','internal medicine','saim','radiolog',
                    'diagnostic imaging','surgery','surgeon','dental','dentistry','davdc',
                    'criticalist','critical care','dacvecc','dacvim','dacvs','dacvr','dacvd',
                    'dacvo','dacvaa','dact','dabvp','rehabilitation','specialist','specialty'];
                  for (const kw of specDepts) { if (d.includes(kw)) return 'Specialty Care'; }

                  // Step 5: emergency / urgent from title
                  if (/emergency/.test(t) || h.includes('emergency')) return 'Emergency Care';
                  if (/urgent care/.test(t) || /urgent care/.test(d)) return 'Urgent Care';

                  return 'General Practice Care';
                }

                // === SOURCE 1: DOM h1 for raw job title ===
                const h1 = document.querySelector('h1.banner__text__title');
                const rawJobTitle = h1 ? h1.textContent.trim() : '';
                result.position = rawJobTitle; // will be overwritten with canonical name below

                // === SOURCE 2: General Information field/value pairs ===
                // Structure: .article__content__view__field with __label and __value divs
                const fields = document.querySelectorAll('.article__content__view__field');
                let baseMin = '', baseMax = '';

                // Debug: log all field labels so we can verify the mapping
                const allLabels = Array.from(fields).map(f => {
                  const l = f.querySelector('.article__content__view__field__label');
                  const v = f.querySelector('.article__content__view__field__value');
                  return (l ? l.textContent.trim() : '?') + ' → ' + (v ? v.textContent.trim().substring(0, 60) : '?');
                });
                console.log('[MPH Scraper] Detail page fields:', allLabels);

                for (const field of fields) {
                  const labelEl = field.querySelector('.article__content__view__field__label');
                  const valueEl = field.querySelector('.article__content__view__field__value');
                  if (!labelEl || !valueEl) continue;

                  const label = labelEl.textContent.trim();
                  const value = valueEl.textContent.trim();

                  switch (label) {
                    // ── Hospital / site name ──
                    case 'Job Site':
                    case 'Site':
                    case 'Facility':
                    case 'Hospital':
                    case 'Hospital Name':
                    case 'Practice':
                    case 'Practice Name': {
                      let hn = value.replace(/<br\s*\/?>/gi, '\n').trim();
                      // Strip trailing "City, ST" suffix in any format:
                      //   "Hospital Name - City, ST"
                      //   "Hospital Name, City, ST"
                      //   "Hospital Name\nCity, ST"
                      hn = hn
                        .replace(/\s*[-–,]\s*[A-Za-z\s.'()]+,\s*[A-Z]{2}\s*$/, '')
                        .replace(/\s*\n\s*[A-Za-z\s.'()]+,\s*[A-Z]{2}\s*$/, '')
                        .trim();
                      result.hospitalName = hn;
                      break;
                    }

                    // ── Location (agency portal often puts "City, ST" in a single "Location" field) ──
                    case 'Location':
                    case 'Job Location':
                    case 'Work Location': {
                      // Try to extract hospital name, city, state from a combined location field
                      // Value may be "Hospital Name - City, ST" or just "City, ST"
                      const locVal = value.trim();
                      // Full pattern: "Anything - City, ST" → hospitalName + city + state
                      const fullMatch = locVal.match(/^(.+?)\s*[-–]\s*([A-Za-z\s.'()-]+),\s*([A-Z]{2})\s*$/);
                      if (fullMatch) {
                        if (!result.hospitalName) result.hospitalName = fullMatch[1].trim();
                        if (!result.city)  result.city  = fullMatch[2].trim();
                        if (!result.state) result.state = fullMatch[3].trim();
                      } else {
                        // Just "City, ST"
                        const cityStateMatch = locVal.match(/^([A-Za-z\s.'()-]+),\s*([A-Z]{2})\s*$/);
                        if (cityStateMatch) {
                          if (!result.city)  result.city  = cityStateMatch[1].trim();
                          if (!result.state) result.state = cityStateMatch[2].trim();
                        } else if (!result.hospitalName) {
                          // Could be just a hospital name with no city/state in this field
                          result.hospitalName = locVal;
                        }
                      }
                      break;
                    }

                    case 'Department':
                    case 'Division':
                    case 'Team':
                      result.department = value;
                      break;
                    case 'Pay Class':
                    case 'Employment Type':
                    case 'Job Type':
                    case 'Schedule':
                      result.jobType = value; // raw; normalised below
                      break;
                    case 'Base Min.':
                    case 'Salary Min':
                    case 'Min Salary':
                      baseMin = value.replace(/[^0-9.]/g, '');
                      break;
                    case 'Base Max.':
                    case 'Salary Max':
                    case 'Max Salary':
                      baseMax = value.replace(/[^0-9.]/g, '');
                      break;
                    case 'City':
                    case 'Job City':
                      result.city = value;
                      break;
                    case 'State':
                    case 'Province':
                    case 'Job State':
                      result.state = value;
                      break;
                    case 'Postal Code':
                    case 'Zip':
                    case 'Zip Code':
                    case 'Postcode':
                      result.postalCode = value;
                      break;
                    case 'Street Address':
                    case 'Address':
                    case 'Street':
                      result.streetAddress = value;
                      break;
                  }
                }

                // Build salary from base min/max
                if (baseMin && baseMax) {
                  result.salary = '$' + Number(baseMin).toLocaleString() + ' - $' + Number(baseMax).toLocaleString();
                } else if (baseMin) {
                  result.salary = '$' + Number(baseMin).toLocaleString();
                } else if (baseMax) {
                  result.salary = 'Up to $' + Number(baseMax).toLocaleString();
                }

                // ── Fallback: try to get city/state from any field value that looks like "City, ST" ──
                if (!result.city || !result.state) {
                  for (const field of fields) {
                    const valueEl = field.querySelector('.article__content__view__field__value');
                    if (!valueEl) continue;
                    const v = valueEl.textContent.trim();
                    const m = v.match(/([A-Za-z\s.'()-]{2,30}),\s*([A-Z]{2})(?:\s+\d{5})?$/);
                    if (m) {
                      if (!result.city)  result.city  = m[1].trim();
                      if (!result.state) result.state = m[2].trim();
                      break;
                    }
                  }
                }

                // ── Fallback: if hospitalName still empty, try banner subtitle ──
                if (!result.hospitalName) {
                  const subEl = document.querySelector('.banner__text__subtitle, .article__header__subtitle, h2.banner__text__subtitle');
                  if (subEl) {
                    let hn = subEl.textContent.trim();
                    // Strip trailing "City, ST"
                    hn = hn.replace(/\s*[-–,]\s*[A-Za-z\s.'()]+,\s*[A-Z]{2}\s*$/, '').trim();
                    if (hn) result.hospitalName = hn;
                  }
                }

                // === SOURCE 3: Grab description body text (used for position/AOP/salary fallbacks) ===
                let bodyText = '';
                const descFields = document.querySelectorAll('.article__content__view__field__value');
                for (const df of descFields) {
                  const text = (df.innerText || '').trim();
                  if (text.length > 200) { bodyText = text; break; }
                }
                if (!bodyText) {
                  const mainEl = document.querySelector('#main-panel, .article, article, main');
                  if (mainEl) bodyText = (mainEl.innerText || '').trim();
                }

                // Salary fallback from description
                if (!result.salary) {
                  const salaryPatterns = [
                    /\$[\d,]+(?:,\d{3})*\s*[-–]+\s*\$[\d,]+(?:,\d{3})*/i,
                    /\$[\d,]+k?\s*[-–]+\s*\$?[\d,]+k/i,
                    /\$[\d,]+(?:\.\d{2})?\s*(?:per\s+)?(?:hourly|hour|hr|\/hr|\/\s*hour)/i,
                    /\$[\d,]+k\+?/i
                  ];
                  for (const p of salaryPatterns) {
                    const m = bodyText.match(p);
                    if (m) { result.salary = m[0].trim(); break; }
                  }
                }

                // === Job Type normalisation ===
                // Rules:
                //   - "Part Time" only if PART-TIME is mentioned AND full-time is NOT mentioned
                //   - "Full Time" if full-time is mentioned, OR both are mentioned, OR neither is mentioned
                (function normaliseJobType() {
                  // Start with whatever the labeled field gave us (may be empty)
                  const rawField = (result.jobType || '').toLowerCase();

                  // Also scan the full page body for explicit mentions
                  const scan = (rawField + ' ' + bodyText).toLowerCase();

                  const hasPart = /part[\s\-]?time/.test(scan);
                  const hasFull = /full[\s\-]?time/.test(scan);

                  if (hasPart && !hasFull) {
                    result.jobType = 'Part Time';
                  } else {
                    // full-time only, both, or neither → Full Time
                    result.jobType = 'Full Time';
                  }
                })();

                // === SOURCE 4: Canonical position name + Area of Practice ===
                result.position = determinePosition(rawJobTitle, result.department, bodyText);
                result.areaOfPractice = determineAOP(rawJobTitle, result.hospitalName, result.department, bodyText);

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

        // Inject the description scraper script
        chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ['description-scraper.js']
        }).then((results) => {
          const description = (results && results[0] && results[0].result) ? results[0].result : '';

          // Save extracted description to the job record
          chrome.storage.local.get(['scrapedJobs'], (result) => {
            const jobs = result.scrapedJobs || [];
            if (jobs[jobIndex]) {
              jobs[jobIndex].description = description;

              chrome.storage.local.set({ scrapedJobs: jobs }, () => {
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
      }
    });

    return true; // Keep message channel open
  }

  return true;
});
