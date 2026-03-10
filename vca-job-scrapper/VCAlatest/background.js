chrome.runtime.onInstalled.addListener(() => {
  console.log('VCA Jobs Scraper extension installed');
});

// Handle messages from content script and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'updateProgress' ||
      request.action === 'scrapingComplete' ||
      request.action === 'scrapingError' ||
      request.action === 'updateStatus') {
    chrome.runtime.sendMessage(request).catch(() => {});
  } else if (request.action === 'fetchJobDescription') {
    chrome.tabs.create({ url: request.url, active: false }, (tab) => {
      chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
        if (tabId === tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(() => {
            chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => {
                const el = document.querySelector('.jd-info[data-ph-at-id="jobdescription-text"]');
                return el ? el.innerText.trim() : 'Description not found';
              }
            }).then((results) => {
              chrome.tabs.remove(tab.id);
              chrome.runtime.sendMessage({
                action: 'descriptionFetched',
                description: results && results[0] ? results[0].result : 'Error fetching description',
                jobIndex: request.jobIndex
              }).catch(() => {});
            }).catch(() => {
              chrome.tabs.remove(tab.id);
              chrome.runtime.sendMessage({
                action: 'descriptionFetched',
                description: 'Error fetching description',
                jobIndex: request.jobIndex
              }).catch(() => {});
            });
          }, 2000);
        }
      });
    });
    return true;

  } else if (request.action === 'fetchJobDetails') {
    chrome.tabs.create({ url: request.url, active: true }, (tab) => {
      chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
        if (tabId === tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);

          setTimeout(() => {
            // Step 1: Inject into MAIN world to read phApp.ddo (page-level JS variable)
            chrome.scripting.executeScript({
              target: { tabId: tab.id },
              world: 'MAIN',
              func: () => {
                try {
                  var jobData = null;
                  // phApp.ddo contains the full job detail under the path defined in phApp.ddoRealPath
                  if (window.phApp && window.phApp.ddo) {
                    var ddo = window.phApp.ddo;
                    // ddoRealPath tells us: jobDetail -> "data.job"
                    if (ddo.jobDetail && ddo.jobDetail.data && ddo.jobDetail.data.job) {
                      jobData = ddo.jobDetail.data.job;
                    }
                    // fallback: direct jobDetail on ddo
                    if (!jobData && ddo.jobDetail && ddo.jobDetail.job) {
                      jobData = ddo.jobDetail.job;
                    }
                  }
                  window.postMessage({ type: '__VCA_JOB_DETAIL__', jobData: jobData }, '*');
                } catch(e) {
                  window.postMessage({ type: '__VCA_JOB_DETAIL__', jobData: null }, '*');
                }
              }
            }).catch(() => {});

            // Step 2: Read the data from MAIN world via postMessage + read DOM as fallback
            setTimeout(() => {
              chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => {
                  return new Promise((resolve) => {
                    let resolved = false;

                    function finish(result) {
                      if (resolved) return;
                      resolved = true;
                      window.removeEventListener('message', onMessage);
                      resolve(result);
                    }

                    function onMessage(event) {
                      if (event.data && event.data.type === '__VCA_JOB_DETAIL__') {
                        const jobData = event.data.jobData;
                        const result = extractFromAll(jobData);
                        finish(result);
                      }
                    }

                    window.addEventListener('message', onMessage);

                    // Timeout: if postMessage never arrives, extract from DOM only
                    setTimeout(() => { finish(extractFromAll(null)); }, 5000);

                    // Area of Practice lookup from jobs.docx keyword mapping
                    const areaOfPracticeMap = [
                      {
                        area: 'General Practice Care',
                        keywords: ['medical director', 'veterinarian medical director', 'associate veterinarian', 'gp vet', 'quick care veterinarian', 'dvm', 'vmd', 'relief veterinarian', 'relief dvm', 'locum veterinarian']
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

                    // Match position against keyword map to determine area of practice
                    function lookupAreaOfPractice(positionText) {
                      if (!positionText) return '';
                      const posLower = positionText.toLowerCase();

                      // Check from most specific (Specialty) to least specific
                      // Specialty Care has very specific keywords, check it with priority
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

                    // Helper: extract salary from text
                    function extractSalary(text) {
                      if (!text) return '';
                      const salaryPatterns = [
                        // "$250-$350k" or "$250k-$350k"
                        /\$[\d,]+k?\s*[-–]+\s*\$?[\d,]+k/i,
                        // "$250,000 - $350,000" range
                        /\$[\d,]+(?:,\d{3})*\s*[-–]+\s*\$[\d,]+(?:,\d{3})*/i,
                        // "$X to $Y" range
                        /\$[\d,]+(?:,\d{3})*k?\s+to\s+\$[\d,]+(?:,\d{3})*k?/i,
                        // "$200 hourly" or "$200 per hour" or "$200/hr"
                        /\$[\d,]+(?:\.\d{2})?\s*(?:per\s+)?(?:hourly|hour|hr|\/hr)/i,
                        // "Compensation $200 hourly, Overnight $250 hourly"
                        /[Cc]ompensation[:\s]+\$[\d,]+[^.;\n]{0,60}/,
                        // "$150,000 per year" or "$150,000 annually"
                        /\$[\d,]+(?:\.\d{2})?\s*(?:per\s+)?(?:year|annually|annum|annual)/i,
                        // "salary range...is $X-$Y" or "salary range...$X to $Y"
                        /salary\s+range[^.\n]*?\$[\d,]+k?[^.\n]{0,40}/i,
                        // "annual salary...is $X-$Y"
                        /annual\s+salary[^.\n]*?\$[\d,]+k?[^.\n]{0,40}/i,
                        // "base salary" or "base pay"
                        /base\s+(?:salary|pay)[^.\n]*?\$[\d,]+k?[^.\n]{0,40}/i,
                        // "starting salary" or "starting at $X"
                        /starting\s+(?:salary|at|pay)[^.\n]*?\$[\d,]+k?[^.\n]{0,40}/i,
                        // "pay range" or "pay rate"
                        /pay\s+(?:range|rate)[^.\n]*?\$[\d,]+k?[^.\n]{0,40}/i,
                        // "competitive salary of $X" or "competitive compensation of $X"
                        /competitive\s+(?:salary|compensation|pay)[^.\n]*?\$[\d,]+k?[^.\n]{0,40}/i,
                        // "up to $X" salary
                        /up\s+to\s+\$[\d,]+(?:,\d{3})*k?/i,
                        // "earn $X" or "earning $X"
                        /earn(?:ing)?\s+(?:up\s+to\s+)?\$[\d,]+k?[^.\n]{0,40}/i,
                        // "sign-on bonus" or "signing bonus"
                        /sign(?:ing)?[\s-]*(?:on\s+)?bonus[^.\n]*?\$[\d,]+k?[^.\n]{0,30}/i,
                        // Any "$X - $Y" with reasonable numbers (not phone numbers)
                        /\$[\d]{2,3}(?:,\d{3})*k?\s*[-–]+\s*\$?[\d]{2,3}(?:,\d{3})*k?/i,
                        // Standalone dollar amounts with k suffix (like "$150k" or "$200K+")
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
                      // Check negotiable
                      const negMatch = text.match(/(?:salary|compensation)\s+(?:is\s+)?negotiable/i);
                      if (negMatch) return 'Negotiable';
                      return '';
                    }

                    // Helper: extract both position and hospital from "Join us as..." pattern
                    function extractPositionAndHospital(text) {
                      if (!text) return { position: '', hospital: '' };

                      // PATTERN GROUP 1: "[position] at [hospital]" format
                      const positionAtHospitalPatterns = [
                        // "Join us as a board-certified or residency-trained Neurologist at VCA Hospital Name"
                        { regex: /join\s+us\s+as\s+(?:an?\s+)?(?:board[- ]certified\s+)?(?:or\s+)?(?:residency[- ]trained\s+)?(.+?)\s+at\s+((?:VCA\s+)?[^.!?\n]+?(?:Hospital|Center|Clinic|Care|Specialists?|Veterinary|Animal|Emergency|Medical)[^.!?\n]*?)(?:\.|!|\n|$)/i, posIndex: 1, hospIndex: 2 },
                        // "Join us as [position] at [hospital]"
                        { regex: /join\s+us\s+as\s+(?:an?\s+)?(.+?)\s+at\s+((?:VCA\s+)?[^.!?\n]+?(?:Hospital|Center|Clinic|Care|Specialists?|Veterinary|Animal|Emergency|Medical)[^.!?\n]*?)(?:\.|!|\n|$)/i, posIndex: 1, hospIndex: 2 },
                        // "We are seeking a [position] at [hospital]"
                        { regex: /seeking\s+(?:an?\s+)?(.+?)\s+at\s+((?:VCA\s+)?[^.!?\n]+?(?:Hospital|Center|Clinic|Care|Specialists?|Veterinary|Animal|Emergency|Medical)[^.!?\n]*?)(?:\.|!|\n|$)/i, posIndex: 1, hospIndex: 2 },
                        // "We are looking for a [position] at [hospital]"
                        { regex: /looking\s+for\s+(?:an?\s+)?(.+?)\s+at\s+((?:VCA\s+)?[^.!?\n]+?(?:Hospital|Center|Clinic|Care|Specialists?|Veterinary|Animal|Emergency|Medical)[^.!?\n]*?)(?:\.|!|\n|$)/i, posIndex: 1, hospIndex: 2 }
                      ];

                      // PATTERN GROUP 2: "[hospital] located/in [location] is looking/seeking for [position]" format
                      const hospitalFirstPatterns = [
                        // "Katonah Bedford Veterinary Center located in Bedford Hills, NY is looking for a Per Diem Emergency Veterinarian"
                        { regex: /^([^,.!?\n]+(?:Hospital|Center|Clinic|Care|Veterinary|Animal|Emergency|Medical|VCA)[^,.!?\n]*?)\s+located\s+in\s+[^,.]+?,\s*[A-Z]{2}\s+is\s+(?:looking|seeking)\s+for\s+(?:a\s+|an\s+)?(.+?)(?:\.|!|\n|$)/i, hospIndex: 1, posIndex: 2 },
                        // "VCA Hospital Name located in City, ST is looking for Position"
                        { regex: /((?:VCA\s+)?[^,.!?\n]+(?:Hospital|Center|Clinic|Care|Veterinary|Animal|Emergency|Medical)[^,.!?\n]*?)\s+located\s+in\s+[^,.]+?,\s*[A-Z]{2}\s+is\s+(?:looking|seeking)\s+for\s+(?:a\s+|an\s+)?(.+?)(?:\.|!|\n|$)/i, hospIndex: 1, posIndex: 2 },
                        // "Hospital Name in City, ST is looking for Position"
                        { regex: /^([^,.!?\n]+(?:Hospital|Center|Clinic|Care|Veterinary|Animal|Emergency|Medical|VCA)[^,.!?\n]*?)\s+in\s+[^,.]+?,\s*[A-Z]{2}\s+is\s+(?:looking|seeking)\s+for\s+(?:a\s+|an\s+)?(.+?)(?:\.|!|\n|$)/i, hospIndex: 1, posIndex: 2 },
                        // "VCA Hospital Name in City, ST is seeking a Position"
                        { regex: /((?:VCA\s+)?[^,.!?\n]+(?:Hospital|Center|Clinic|Care|Veterinary|Animal|Emergency|Medical)[^,.!?\n]*?)\s+in\s+[^,.]+?,\s*[A-Z]{2}\s+is\s+(?:looking|seeking)\s+for\s+(?:a\s+|an\s+)?(.+?)(?:\.|!|\n|$)/i, hospIndex: 1, posIndex: 2 }
                      ];

                      // Try Pattern Group 1 first (position at hospital)
                      for (const pattern of positionAtHospitalPatterns) {
                        const match = text.match(pattern.regex);
                        if (match) {
                          let position = match[pattern.posIndex].trim();
                          let hospital = match[pattern.hospIndex].trim();

                          // Clean position: remove trailing words like "to join", "for", etc.
                          position = position.replace(/\s+(?:to\s+join|for|with|in|on)\s*$/i, '').trim();

                          // Clean hospital: remove trailing punctuation and common suffixes
                          hospital = hospital.replace(/[\s,;:.!]+$/, '').trim();

                          // Ensure hospital name ends at a reasonable point for VCA hospitals
                          const hospitalEndMatch = hospital.match(/^((?:VCA\s+)?[^,;.\n]+(?:Hospital|Center|Clinic|Care|Specialists?|Veterinary|Animal|Emergency|Medical))/i);
                          if (hospitalEndMatch) {
                            hospital = hospitalEndMatch[1].trim();
                          }

                          // Limit lengths
                          if (position.length > 100) position = position.substring(0, 100).trim();
                          if (hospital.length > 100) hospital = hospital.substring(0, 100).trim();

                          // Only return if both are reasonably sized
                          if (position.length >= 3 && hospital.length >= 10) {
                            return { position, hospital };
                          }
                        }
                      }

                      // Try Pattern Group 2 (hospital first format)
                      for (const pattern of hospitalFirstPatterns) {
                        const match = text.match(pattern.regex);
                        if (match) {
                          let hospital = match[pattern.hospIndex].trim();
                          let position = match[pattern.posIndex].trim();

                          // Clean hospital name
                          hospital = hospital.replace(/[\s,;:.!]+$/, '').trim();

                          // Clean position: remove trailing punctuation and newlines
                          position = position.replace(/[\s,;:.!\n]+$/, '').trim();

                          // Remove common trailing phrases from position
                          position = position.replace(/\s+(?:to\s+join|for|with)\s*$/i, '').trim();

                          // Limit lengths
                          if (position.length > 100) position = position.substring(0, 100).trim();
                          if (hospital.length > 100) hospital = hospital.substring(0, 100).trim();

                          // Only return if both are reasonably sized
                          if (position.length >= 3 && hospital.length >= 5) {
                            return { position, hospital };
                          }
                        }
                      }

                      // PATTERN GROUP 3: Broader "at [Hospital Name]" extraction from first few sentences
                      const firstChunk = text.substring(0, 1000);
                      const broadAtMatch = firstChunk.match(/\bat\s+((?:VCA\s+)?(?:[\w'.&-]+\s+){1,6}(?:Animal\s+Hospital|Veterinary\s+(?:Hospital|Center|Clinic|Care|Specialists?|Group|Practice)|Pet\s+(?:Hospital|Clinic|Care|Medical\s+Center)|Animal\s+(?:Clinic|Care|Medical\s+Center|Emergency)|Emergency\s+(?:Hospital|Center|Clinic)|Medical\s+Center|Specialty\s+(?:Hospital|Center)))\b/i);
                      if (broadAtMatch) {
                        let hospital = broadAtMatch[1].trim().replace(/[\s,;:.!]+$/, '');
                        if (hospital.length >= 5 && hospital.length <= 100) {
                          return { position: '', hospital };
                        }
                      }

                      return { position: '', hospital: '' };
                    }

                    // Helper: extract hospital name from text
                    function extractHospitalFromText(text) {
                      if (!text) return '';
                      const hospPatterns = [
                        // VCA-prefixed patterns (most specific)
                        /\bVCA\s+(?:[\w'.&-]+\s+){1,6}(?:Animal\s+Hospital|Hospital)/i,
                        /\bVCA\s+(?:[\w'.&-]+\s+){1,6}(?:Veterinary\s+(?:Hospital|Specialists?|Center|Clinic))/i,
                        /\bVCA\s+(?:[\w'.&-]+\s+){1,6}(?:Emergency|Specialty|Medical)\s+(?:Hospital|Center|Animal)/i,
                        /\bVCA\s+(?:[\w'.&-]+\s+){1,6}Pet\s+Care/i,
                        /\bVCA\s+[\w'.&-]+(?:\s+[\w'.&-]+){0,5}/i,
                        // Non-VCA hospital/clinic/center patterns
                        /\b(?:[\w'.&-]+\s+){1,6}(?:Animal\s+Hospital)\b/i,
                        /\b(?:[\w'.&-]+\s+){1,6}(?:Veterinary\s+(?:Hospital|Specialists?|Center|Clinic|Care|Group|Practice))\b/i,
                        /\b(?:[\w'.&-]+\s+){1,6}(?:(?:Emergency|Specialty|Medical)\s+(?:Hospital|Center|Clinic))\b/i,
                        /\b(?:[\w'.&-]+\s+){1,6}(?:Pet\s+(?:Hospital|Clinic|Care|Medical\s+Center))\b/i,
                        /\b(?:[\w'.&-]+\s+){1,6}(?:Animal\s+(?:Clinic|Care|Medical\s+Center|Emergency))\b/i
                      ];
                      for (const pattern of hospPatterns) {
                        const m = text.match(pattern);
                        if (m) {
                          let name = m[0].trim();
                          // Skip generic phrases that aren't actual hospital names
                          if (/^(the|a|an|our|this|your|at|in|to|and|or)\s/i.test(name)) {
                            name = name.replace(/^(the|a|an|our|this|your|at|in|to|and|or)\s+/i, '').trim();
                          }
                          if (name.length < 5) continue;
                          if (name.length > 80) name = name.substring(0, 80).trim();
                          return name;
                        }
                      }
                      return '';
                    }

                    // Helper: strip HTML tags to get plain text
                    function stripHtml(html) {
                      if (!html) return '';
                      return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&#\d+;/g, ' ').replace(/\s+/g, ' ').trim();
                    }

                    function extractFromAll(jobData) {
                      let areaOfPractice = '';
                      let position = '';
                      let salary = '';
                      let hospitalName = '';
                      let city = '';
                      let state = '';

                      // === PRIORITY SOURCE: Extract from description text using "Join us as..." pattern ===
                      const descEl = document.querySelector('.jd-info[data-ph-at-id="jobdescription-text"]');
                      if (descEl) {
                        const descText = descEl.innerText || '';
                        const extracted = extractPositionAndHospital(descText);
                        if (extracted.position) {
                          position = extracted.position;
                        }
                        if (extracted.hospital) {
                          hospitalName = extracted.hospital;
                        }
                      }

                      // === SOURCE 1: phApp.ddo job data (most accurate) ===
                      if (jobData) {
                        // Only set position from jobData if not already found from description pattern
                        if (!position) {
                          position = jobData.title || '';
                        }

                        city = jobData.city || '';
                        state = jobData.state || '';

                        // jobFamilies is the most specific area of practice
                        if (jobData.jobFamilies && jobData.jobFamilies.length > 0) {
                          areaOfPractice = jobData.jobFamilies.join(', ');
                        } else if (jobData.category) {
                          areaOfPractice = jobData.category;
                        }

                        // ml_title can be more descriptive than title
                        if (!position && jobData.ml_title) {
                          position = jobData.ml_title;
                        }

                        // locationDetails has hospital name: "Vca West Los Angeles Animal Hospital | 101"
                        // Only use if not already extracted from description pattern
                        if (!hospitalName && jobData.locationDetails) {
                          let locDetail = jobData.locationDetails.split('|')[0].trim();
                          locDetail = locDetail.replace(/\s*\d+\s*$/, '').trim();
                          if (locDetail.length > 80) locDetail = locDetail.substring(0, 80).trim();
                          // Only use if it looks like a hospital/facility name (not just a city name)
                          if (locDetail && /(?:hospital|clinic|center|care|veterinary|animal|emergency|medical|specialty|specialists?|pet|vca)/i.test(locDetail)) {
                            hospitalName = locDetail;
                          }
                        }

                        // Try locationName from multi_location (only if it looks like a hospital name, not just a city/state)
                        if (!hospitalName && jobData.multi_location && jobData.multi_location.length > 0) {
                          const loc = jobData.multi_location[0];
                          if (loc.locationName) {
                            const locName = loc.locationName.trim();
                            // Only use if it contains hospital/clinic/center keywords (not just "City, ST")
                            if (/(?:hospital|clinic|center|care|veterinary|animal|emergency|medical|specialty|specialists?|pet)/i.test(locName)) {
                              hospitalName = locName;
                            }
                          }
                        }

                        // Extract salary from jobData.description (embedded HTML)
                        // Note: Hospital is already extracted from priority pattern, only get salary here
                        if (jobData.description) {
                          const descPlainText = stripHtml(jobData.description);
                          if (!salary) {
                            salary = extractSalary(descPlainText);
                          }
                          // Only use fallback hospital extraction if not found from priority pattern
                          if (!hospitalName) {
                            hospitalName = extractHospitalFromText(descPlainText);
                          }
                        }

                        // Also check descriptionTeaser for salary and hospital name
                        if (jobData.descriptionTeaser) {
                          if (!salary) {
                            salary = extractSalary(jobData.descriptionTeaser);
                          }
                          // descriptionTeaser is plain text and often starts with "Join us as X at [Hospital Name]"
                          if (!hospitalName) {
                            const teaserExtracted = extractPositionAndHospital(jobData.descriptionTeaser);
                            if (teaserExtracted.hospital) {
                              hospitalName = teaserExtracted.hospital;
                            }
                            if (!hospitalName) {
                              hospitalName = extractHospitalFromText(jobData.descriptionTeaser);
                            }
                          }
                        }
                      }

                      // === SOURCE 2: data-ph-at-* attributes on .job-info div ===
                      const jobInfoEl = document.querySelector('.job-info[data-ph-at-id="job-info"]');
                      if (jobInfoEl) {
                        if (!position) {
                          position = jobInfoEl.getAttribute('data-ph-at-job-title-text') || '';
                        }
                        if (!areaOfPractice) {
                          areaOfPractice = jobInfoEl.getAttribute('data-ph-at-job-category-text') || '';
                        }
                        if (!city || !state) {
                          const locText = jobInfoEl.getAttribute('data-ph-at-job-location-text') || '';
                          const parts = locText.split(',').map(s => s.trim());
                          if (!city && parts[0]) city = parts[0];
                          if (!state && parts[1]) state = parts[1];
                        }
                      }

                      // === SOURCE 3: DOM elements for multi-category ===
                      if (!areaOfPractice) {
                        const catItems = document.querySelectorAll('.job-multi-category .category');
                        if (catItems.length > 0) {
                          areaOfPractice = Array.from(catItems).map(el => el.textContent.trim()).join(', ');
                        }
                      }

                      // === SOURCE 4: .job-title h1 ===
                      if (!position) {
                        const titleEl = document.querySelector('h1.job-title');
                        if (titleEl) position = titleEl.textContent.trim();
                      }

                      // === SOURCE 5: .job-location span ===
                      if (!city || !state) {
                        const locEl = document.querySelector('span.job-location');
                        if (locEl) {
                          const locText = locEl.textContent.replace('Location', '').trim();
                          const parts = locText.split(',').map(s => s.trim());
                          if (!city && parts[0]) city = parts[0];
                          if (!state && parts[1]) state = parts[1];
                        }
                      }

                      // === SOURCE 6: JSON-LD structured data ===
                      const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
                      for (const s of ldScripts) {
                        try {
                          const ld = JSON.parse(s.textContent);
                          if (ld['@type'] === 'JobPosting') {
                            // Only use JSON-LD position if not already found from priority pattern
                            if (!position) position = ld.title || '';
                            if (ld.jobLocation && ld.jobLocation.address) {
                              if (!city) city = ld.jobLocation.address.addressLocality || '';
                              if (!state) state = ld.jobLocation.address.addressRegion || '';
                            }
                            // hiringOrganization often has the hospital name
                            if (!hospitalName && ld.hiringOrganization) {
                              const orgName = ld.hiringOrganization.name || '';
                              // Only use if it's specific (not just "VCA Animal Hospitals" generic brand)
                              if (orgName && orgName.toLowerCase() !== 'vca animal hospitals' && orgName.toLowerCase() !== 'vca') {
                                hospitalName = orgName;
                              }
                            }
                            // JSON-LD description contains the full HTML - extract hospital from it
                            if (!hospitalName && ld.description) {
                              const ldDescText = stripHtml(ld.description);
                              const ldExtracted = extractPositionAndHospital(ldDescText);
                              if (ldExtracted.hospital) {
                                hospitalName = ldExtracted.hospital;
                              }
                              if (!hospitalName) {
                                hospitalName = extractHospitalFromText(ldDescText);
                              }
                            }
                            // JSON-LD may have baseSalary
                            if (!salary && ld.baseSalary) {
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
                            }
                            break;
                          }
                        } catch(e) {}
                      }

                      // === SOURCE 7: Extract from DOM description text (fallback only) ===
                      // Note: Priority pattern already checked descEl at the beginning
                      // Only use these as fallbacks if not found
                      if (!hospitalName || !salary) {
                        const descElFallback = document.querySelector('.jd-info[data-ph-at-id="jobdescription-text"]');
                        if (descElFallback) {
                          const descText = descElFallback.innerText || '';

                          if (!hospitalName) {
                            hospitalName = extractHospitalFromText(descText);
                          }

                          if (!salary) {
                            salary = extractSalary(descText);
                          }
                        }
                      }

                      // === SOURCE 8: Try all text on the page for salary if still missing ===
                      if (!salary) {
                        const bodyText = document.body ? document.body.innerText : '';
                        // Only search a relevant section, not the entire page
                        const salarySection = bodyText.match(/(?:salary|compensation|pay|earning|bonus)[^\n]{0,200}/gi);
                        if (salarySection) {
                          for (const section of salarySection) {
                            salary = extractSalary(section);
                            if (salary) break;
                          }
                        }
                      }

                      // === SOURCE 9: Extract hospital from page title ===
                      if (!hospitalName) {
                        const pageTitle = document.title || '';
                        // Page titles often have format: "Job Title - Hospital Name | VCA Careers"
                        const titleMatch = pageTitle.match(/[-–]\s*(.+?)(?:\s*[|]\s*VCA|$)/i);
                        if (titleMatch) {
                          let candidate = titleMatch[1].trim();
                          // Only use if it looks like a hospital/clinic name
                          if (/(?:hospital|clinic|center|care|veterinary|animal|emergency|medical|specialty|specialists?|pet)/i.test(candidate)) {
                            hospitalName = candidate;
                          }
                        }
                      }

                      // === SOURCE 10: Extract hospital from breadcrumbs or location spans ===
                      if (!hospitalName) {
                        // Try location-name or facility-name elements
                        const locNameEl = document.querySelector('.location-name, .facility-name, [data-ph-at-id="job-location-name"]');
                        if (locNameEl) {
                          const locName = locNameEl.textContent.trim();
                          if (locName && locName.length > 3) {
                            hospitalName = locName;
                          }
                        }
                      }

                      // === SOURCE 11: Broader description scan for hospital names ===
                      if (!hospitalName) {
                        const descElBroad = document.querySelector('.jd-info[data-ph-at-id="jobdescription-text"]');
                        if (descElBroad) {
                          const descText = descElBroad.innerText || '';
                          // Look for "at [Name]" patterns near the beginning of the description
                          const atMatch = descText.match(/\bat\s+((?:[\w'.&-]+\s+){1,6}(?:Animal\s+Hospital|Veterinary\s+(?:Hospital|Center|Clinic|Care|Specialists?)|Pet\s+(?:Hospital|Clinic|Care)|Emergency\s+(?:Hospital|Center|Clinic)|Medical\s+Center|Hospital|Clinic|Center))\b/i);
                          if (atMatch) {
                            hospitalName = atMatch[1].trim();
                          }
                        }
                      }

                      // === SOURCE 12: Try phApp.ddo for any additional location/facility fields ===
                      if (!hospitalName && jobData) {
                        // Some jobs store hospital name in customField or other properties
                        const fieldsToCheck = ['facility', 'hospitalName', 'siteName', 'branchName', 'storeName'];
                        for (const field of fieldsToCheck) {
                          if (jobData[field] && typeof jobData[field] === 'string' && jobData[field].trim().length > 2) {
                            const fieldVal = jobData[field].trim();
                            // Only use if it looks like a hospital/facility name
                            if (/(?:hospital|clinic|center|care|veterinary|animal|emergency|medical|specialty|specialists?|pet|vca)/i.test(fieldVal)) {
                              hospitalName = fieldVal;
                              break;
                            }
                          }
                        }
                        // Check customField array
                        if (!hospitalName && jobData.customField && Array.isArray(jobData.customField)) {
                          for (const cf of jobData.customField) {
                            if (cf && cf.name && /hospital|facility|location.*name|site/i.test(cf.name) && cf.value) {
                              hospitalName = cf.value.trim();
                              break;
                            }
                          }
                        }
                      }

                      // Clean up hospital name
                      if (hospitalName) {
                        hospitalName = hospitalName.replace(/[\s,;.]+$/, '').trim();
                        if (hospitalName.length > 80) hospitalName = hospitalName.substring(0, 80).replace(/\s+\S*$/, '').trim();
                        hospitalName = hospitalName.replace(/\b\w/g, c => c.toUpperCase());
                      }

                      // Override area of practice by matching position against jobs.docx keyword map
                      const lookedUpArea = lookupAreaOfPractice(position);
                      if (lookedUpArea) {
                        areaOfPractice = lookedUpArea;
                      }

                      return { areaOfPractice, position, salary, hospitalName, city, state };
                    }
                  });
                }
              }).then((results) => {
                chrome.tabs.remove(tab.id);
                chrome.runtime.sendMessage({
                  action: 'detailsFetched',
                  details: results && results[0] ? results[0].result : {},
                  jobIndex: request.jobIndex
                }).catch(() => {});
              }).catch((err) => {
                console.error('Error extracting job details:', err);
                chrome.tabs.remove(tab.id);
                chrome.runtime.sendMessage({
                  action: 'detailsFetched',
                  details: {},
                  jobIndex: request.jobIndex
                }).catch(() => {});
              });
            }, 500);
          }, 3000);
        }
      });
    });
    return true;
  }
});
