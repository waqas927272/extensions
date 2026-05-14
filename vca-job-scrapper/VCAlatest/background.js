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
                jobIndex: request.jobIndex,
                jobKey: request.jobKey,
                jobLink: request.jobLink || request.url
              }).catch(() => {});
            }).catch(() => {
              chrome.tabs.remove(tab.id);
              chrome.runtime.sendMessage({
                action: 'descriptionFetched',
                description: 'Error fetching description',
                jobIndex: request.jobIndex,
                jobKey: request.jobKey,
                jobLink: request.jobLink || request.url
              }).catch(() => {});
            });
          }, 2000);
        }
      });
    });
    return true;

  } else if (request.action === 'fetchJobDetails') {
    chrome.tabs.create({ url: request.url, active: false }, (tab) => {
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
                        keywords: ['medical director', 'veterinarian medical director', 'associate veterinarian', 'gp vet', 'quick care veterinarian', 'dvm', 'vmd', 'relief veterinarian', 'relief dvm', 'locum veterinarian', 'veterinarian']
                      },
                      {
                        area: 'Emergency Care',
                        keywords: ['emergency veterinarian', 'er vet', 'er veterinarian', 'er dvm', 'relief emergency veterinarian', 'relief emergency vet']
                      },
                      {
                        area: 'Urgent Care',
                        keywords: ['urgent care veterinarian', 'urgent veterinarian', 'urgent care']
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

                    // Position mapping from CorrectJobNames.txt - maps keywords to exact position names
                    // Order: most specific first to avoid false matches
                    const positionMap = [
                      // Specialty Care - Doctors (most specific first)
                      { position: 'Radiation Oncologist', keywords: ['radiation oncologist', 'dacvr-ro', 'radonc'] },
                      { position: 'Medical Oncologist', keywords: ['medical oncologist', 'medonc', 'dacvim oncology', 'oncologist'] },
                      { position: 'ECC Specialist', keywords: ['criticalist', 'dacvecc', 'emergency & critical care specialist', 'ecc veterinarian', 'critical care', 'ecc specialist', 'ecc'] },
                      { position: 'Internal Medicine Specialist', keywords: ['internal medicine specialist', 'internal medicine', 'internist', 'veterinary internist', 'saim', 'small animal internal medicine', 'dacvim', 'acvim'] },
                      { position: 'Neurologist & Neurosurgeon', keywords: ['neurologist', 'neurosurgeon', 'veterinary neurologist', 'veterinary neurosurgeon'] },
                      { position: 'Cardiologist', keywords: ['cardiologist', 'veterinary cardiologist', 'small animal cardiologist'] },
                      { position: 'Dental Specialist', keywords: ['dentist', 'oral surgeon', 'davdc', 'dental surgeon', 'dental specialist'] },
                      { position: 'Dermatologist', keywords: ['dermatologist', 'veterinary dermatologist', 'dacvd', 'acvd'] },
                      { position: 'Surgeon', keywords: ['surgeon', 'veterinary surgery', 'dacvs', 'acvs', 'small animal surgeon'] },
                      { position: 'Radiologist', keywords: ['radiologist', 'veterinary radiologist', 'diagnostic imaging specialist', 'dacvr', 'acvr'] },
                      { position: 'Ophthalmologist', keywords: ['ophthalmologist', 'veterinary ophthalmologist', 'dacvo', 'acvo'] },
                      { position: 'Anesthesiologist', keywords: ['anesthesiologist', 'veterinary anesthesiologist', 'dacvaa', 'acvaa'] },
                      { position: 'DABVP Specialist', keywords: ['dabvp', 'diplomate abvp', 'board certified veterinary practitioner'] },
                      { position: 'Theriogenologist', keywords: ['theriogenologist', 'veterinary theriogenologist', 'dact'] },
                      { position: 'Rehabilitation Therapist (CCRT)', keywords: ['rehabilitation therapist', 'ccrt', 'canine rehabilitation', 'rehab technician'] },
                      // Credentialed Veterinary Technician Specialist (all VTS variants consolidated)
                      { position: 'Credentialed Veterinary Technician Specialist', keywords: ['vts anesthesia', 'vts ecc', 'vts emergency', 'vts dentistry', 'vts internal medicine', 'vts saim', 'vts neurology', 'vts neuro', 'vts cardiology', 'vts cardio', 'vts dermatology', 'vts derm', 'vts ophthalmology', 'vts ophtho', 'vts diagnostic imaging', 'veterinary technician specialist', 'vts'] },
                      // Equine / Bovine / Exotics
                      { position: 'Equine/Bovine Veterinarian', keywords: ['equine veterinarian', 'equine vet', 'equine dvm', 'bovine veterinarian', 'large animal', 'equine/bovine', 'equine'] },
                      { position: 'Avian & Exotics Veterinarian', keywords: ['avian veterinarian', 'exotics veterinarian', 'avian vet', 'exotics vet', 'avian & exotics', 'associate exotics'] },
                      // Emergency / Urgent / General Practice
                      { position: 'Medical Director', keywords: ['medical director', 'veterinarian medical director'] },
                      { position: 'Lead Veterinarian', keywords: ['lead veterinarian', 'lead vet', 'lead dvm'] },
                      { position: 'Partner Veterinarian', keywords: ['partner veterinarian', 'partner vet', 'partner dvm'] },
                      { position: 'Associate Veterinarian', keywords: ['associate veterinarian', 'gp vet', 'quick care veterinarian', 'emergency veterinarian', 'er vet', 'er veterinarian', 'er dvm', 'urgent care veterinarian', 'urgent veterinarian', 'relief veterinarian', 'relief dvm', 'locum veterinarian', 'relief emergency veterinarian', 'relief emergency vet'] },
                      // Technicians / Assistants
                      { position: 'Veterinary Technician', keywords: ['veterinary technician', 'vet tech', 'veterinary nurse', 'vet nurse', 'cvt', 'lvt', 'rvt'] },
                      { position: 'Veterinary Assistant', keywords: ['veterinary assistant', 'vet assistant', 'vet assist'] },
                      // Front Desk / Admin
                      { position: 'Receptionist', keywords: ['receptionist', 'veterinary receptionist', 'front desk', 'customer service representative', 'csr', 'front office manager'] },
                      // Externs
                      { position: 'Veterinarian Externship', keywords: ['extern', 'externship', 'pre-vet extern', 'pre vet extern'] },
                      // Sterile Processing
                      { position: 'Sterile Processing Technician', keywords: ['sterile processing', 'crcst', 'surgical processing'] },
                      // Generic fallbacks (least specific - must be last)
                      { position: 'Associate Veterinarian', keywords: ['veterinarian', 'dvm', 'vmd'] },
                    ];

                    // Match raw title/position text to exact docx position name
                    function lookupPosition(rawText) {
                      if (!rawText) return '';
                      const textLower = rawText.toLowerCase();
                      for (const entry of positionMap) {
                        for (const kw of entry.keywords) {
                          if (textLower.includes(kw)) {
                            return entry.position;
                          }
                        }
                      }
                      return '';
                    }

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

                    // Helper: extract salary from text with type identification
                    function extractSalary(text) {
                      if (!text) return '';

                      // Priority patterns for full sentences - Extract ONLY the salary amount, not incomplete prefixes
                      const priorityPatterns = [
                        /(?:compensation|salary)\s+for this position is\s+(\$[\d,]+k?(?:\s*[-–to]+\s*\$?[\d,]+k?)?)/i,
                        /base\s+salary\s+of\s+(\$[\d,]+k?(?:\s*[-–to]+\s*\$?[\d,]+k?)?)/i,
                        /competitive\s+salary\s+of\s+(\$[\d,]+k?)/i,
                      ];

                      for (const pattern of priorityPatterns) {
                        const m = text.match(pattern);
                        if (m) {
                          // Use capture group to get ONLY the salary amount, not the prefix text
                          let sal = m[1].trim().replace(/[.,;:\s]+$/, '');
                          if (!/\(Yearly\)$/i.test(sal) && !/hourly|shift/i.test(sal)) sal += ' (Yearly)';
                          return sal;
                        }
                      }

                      // Hourly patterns
                      const hourlyPatterns = [
                        /\$[\d,]+(?:\.\d{2})?\s*[-–to]+\s*\$?[\d,]+(?:\.\d{2})?\s*(?:per\s+)?(?:hour|hourly|hr|\/hr)/i,
                        /\$[\d,]+(?:\.\d{2})?\s*(?:per\s+)?(?:hour|hourly|hr|\/hr)/i,
                        /[Cc]ompensation[:\s]+\$[\d,]+(?:\.\d{2})?[^.;\n]*?(?:hour|hourly|hr)/i
                      ];

                      // Shift-based patterns
                      const shiftPatterns = [
                        /\$[\d,]+(?:\.\d{2})?\s*[-–to]+\s*\$?[\d,]+(?:\.\d{2})?\s*(?:per\s+)?shift/i,
                        /\$[\d,]+(?:\.\d{2})?\s*(?:per\s+)?shift/i,
                        /[Cc]ompensation[:\s]+\$[\d,]+(?:\.\d{2})?[^.;\n]*?shift/i
                      ];

                      // Yearly/Annual patterns
                      const yearlyPatterns = [
                        /\$[\d,]+k?\s*[-–to]+\s*\$?[\d,]+k?\s*(?:per\s+)?(?:year|yearly|annually|annum|annual)/i,
                        /\$[\d,]+(?:,\d{3})+\s*[-–to]+\s*\$?[\d,]+(?:,\d{3})+(?:\s*(?:per\s+)?(?:year|yearly|annually|annum|annual))?/i,
                        /\$[\d,]+(?:\.\d{2})?\s*(?:per\s+)?(?:year|yearly|annually|annum|annual)/i,
                        /annual\s+(?:salary|compensation|pay)[:\s]*\$[\d,]+k?[^.\n]{0,40}/i,
                        /salary\s+range[^.\n]*?\$[\d,]+k?\s*[-–to]+\s*\$?[\d,]+k?/i,
                        /base\s+(?:salary|pay)[^.\n]*?\$[\d,]+k?[^.\n]{0,40}/i,
                        /starting\s+(?:salary|at|pay)[^.\n]*?\$[\d,]+k?[^.\n]{0,40}/i,
                        /competitive\s+(?:salary|compensation|pay)[^.\n]*?\$[\d,]+k?[^.\n]{0,40}/i,
                        /\$[\d,]+k\+?\s*[-–to]+\s*\$?[\d,]+k\+?/i,
                        /\$[\d]{2,3}(?:,\d{3})*k?\s*[-–]+\s*\$?[\d]{2,3}(?:,\d{3})*k?/i,
                        /\$[\d,]+k\+?/i
                      ];

                      // Check hourly first
                      for (const pattern of hourlyPatterns) {
                        const m = text.match(pattern);
                        if (m) {
                          let sal = m[0].trim();
                          sal = sal.replace(/[.,;:\s]+$/, '').trim();
                          if (sal.length > 100) sal = sal.substring(0, 100).trim();
                          // Clean up and add type if not already present
                          if (!/hourly|hour|hr/i.test(sal)) {
                            sal += ' (Hourly)';
                          } else if (!/\(Hourly\)$/i.test(sal)) {
                            sal = sal.replace(/\s*(?:per\s+)?(?:hour|hourly|hr|\/hr)/i, '') + ' (Hourly)';
                          }
                          return sal;
                        }
                      }

                      // Check shift-based
                      for (const pattern of shiftPatterns) {
                        const m = text.match(pattern);
                        if (m) {
                          let sal = m[0].trim();
                          sal = sal.replace(/[.,;:\s]+$/, '').trim();
                          if (sal.length > 100) sal = sal.substring(0, 100).trim();
                          if (!/\(Shift\)$/i.test(sal)) {
                            sal = sal.replace(/\s*(?:per\s+)?shift/i, '') + ' (Shift)';
                          }
                          return sal;
                        }
                      }

                      // Check yearly/annual
                      for (const pattern of yearlyPatterns) {
                        const m = text.match(pattern);
                        if (m) {
                          let sal = m[0].trim();
                          sal = sal.replace(/[.,;:\s]+$/, '').trim();
                          if (sal.length > 100) sal = sal.substring(0, 100).trim();
                          // Clean up and add type
                          if (!/\(Yearly\)$/i.test(sal) && !/annually|annual|year|yearly/i.test(sal)) {
                            sal = sal.replace(/salary\s+range[:\s]*/i, '').replace(/annual\s+(?:salary|compensation|pay)[:\s]*/i, '').replace(/base\s+(?:salary|pay)[:\s]*/i, '').replace(/starting\s+(?:salary|at|pay)[:\s]*/i, '').replace(/competitive\s+(?:salary|compensation|pay)[:\s]*/i, '').trim();
                            sal += ' (Yearly)';
                          } else if (!/\(Yearly\)$/i.test(sal)) {
                            sal = sal.replace(/salary\s+range[:\s]*/i, '').replace(/annual\s+(?:salary|compensation|pay)[:\s]*/i, '').replace(/\s*(?:per\s+)?(?:year|yearly|annually|annum|annual)/i, '').trim() + ' (Yearly)';
                          }
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
                        // "VCA Spring Animal Hospital is seeking an Associate Veterinarian"
                        { regex: /^((?:VCA\s+)?[^,.!?\n]+(?:Hospital|Center|Clinic|Care|Specialists?|Veterinary|Animal|Emergency|Medical)[^,.!?\n]*?)\s+is\s+(?:looking|seeking)\s+for\s+(?:a\s+|an\s+)?(.+?)(?:\.|!|\n|$)/i, hospIndex: 1, posIndex: 2 },
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
                          position = position.replace(/\s+(?:to\s+join|for|with|in|on|, and you’ll quickly discover).*$/i, '').trim();

                          // Clean hospital: remove trailing punctuation and common suffixes
                          hospital = hospital.replace(/[\s,;:.!]+$/, '').trim();
                          hospital = hospital.replace(/<A Href=.*$/i, '').trim();

                          // Ensure hospital name ends at a reasonable point
                          // If it starts with VCA, keep the full name up to punctuation
                          if (/^VCA\b/i.test(hospital)) {
                            hospital = hospital.replace(/[,;.\n].*$/, '').trim();
                          } else {
                            // For non-VCA, try to end at a known facility keyword
                            const hospitalEndMatch = hospital.match(/^([^,;.\n]+(?:Hospital|Center|Clinic|Care|Specialists?|Veterinary|Animal|Emergency|Medical)(?:\s+of\s+(?:the\s+)?[\w'.&-]+(?:\s+[\w'.&-]+)*)?)/i);
                            if (hospitalEndMatch) {
                              hospital = hospitalEndMatch[1].trim();
                            }
                          }

                          // Limit lengths (increased position limit to avoid truncation)
                          if (position.length > 300) position = position.substring(0, 300).trim();
                          if (hospital.length > 100) hospital = hospital.substring(0, 100).trim();

                          // Only return if both are reasonably sized
                          if (position.length >= 3 && hospital.length >= 5) {
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
                          hospital = hospital.replace(/<A Href=.*$/i, '').trim();

                          // Clean position: remove trailing punctuation and newlines
                          position = position.replace(/[\s,;:.!\n]+$/, '').trim();
                          position = position.replace(/\s+(?:to\s+join|for|with|, and you’ll quickly discover).*$/i, '').trim();

                          // Limit lengths (increased position limit to avoid truncation)
                          if (position.length > 300) position = position.substring(0, 300).trim();
                          if (hospital.length > 100) hospital = hospital.substring(0, 100).trim();

                          // Only return if both are reasonably sized
                          if (position.length >= 3 && hospital.length >= 5) {
                            return { position, hospital };
                          }
                        }
                      }

                      // PATTERN GROUP 3: Broader "at [Hospital Name]" extraction from first few sentences
                      const firstChunk = text.substring(0, 1000);
                      // Try "of the/of" pattern first (e.g., "at VCA Veterinary Specialists of the Valley")
                      const broadAtOfMatch = firstChunk.match(/\bat\s+((?:VCA\s+)?(?:[\w'.&-]+\s+){0,6}(?:Veterinary\s+Specialists?|Animal\s+Hospital|Hospital|Emergency|Specialty|Medical)\s+of\s+(?:the\s+)?[\w'.&-]+(?:\s+[\w'.&-]+)*)/i);
                      if (broadAtOfMatch) {
                        let hospital = broadAtOfMatch[1].trim().replace(/[\s,;:.!]+$/, '');
                        if (hospital.length >= 5 && hospital.length <= 100) {
                          return { position: '', hospital };
                        }
                      }
                      const broadAtMatch = firstChunk.match(/\bat\s+((?:VCA\s+)?(?:[\w'.&-]+\s+){0,6}(?:Animal\s+Hospital|Veterinary\s+(?:Hospital|Center|Clinic|Care|Specialists?|Group|Practice)|Pet\s+(?:Hospital|Clinic|Care|Medical\s+Center)|Animal\s+(?:Clinic|Care|Medical\s+Center|Emergency)|Emergency\s+(?:Hospital|Center|Clinic)|Medical\s+Center|Specialty\s+(?:Hospital|Center)))\b/i);
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
                        // VCA-prefixed patterns with "of the/of" trailing words (e.g., "VCA Veterinary Specialists of the Valley")
                        /\bVCA\s+(?:[\w'.&-]+\s+){0,6}(?:Veterinary\s+Specialists?|Animal\s+Hospital|Hospital|Emergency|Specialty|Medical)\s+of\s+(?:the\s+)?[\w'.&-]+(?:\s+[\w'.&-]+)*/i,
                        // VCA-prefixed patterns ending with a facility keyword ({0,6} to handle "VCA Veterinary ...")
                        /\bVCA\s+(?:[\w'.&-]+\s+){0,6}(?:Animal\s+Hospital|Hospital)/i,
                        /\bVCA\s+(?:[\w'.&-]+\s+){0,6}(?:Veterinary\s+(?:Hospital|Specialists?|Center|Clinic))/i,
                        /\bVCA\s+(?:[\w'.&-]+\s+){0,6}(?:Emergency|Specialty|Medical)\s+(?:Hospital|Center|Animal)/i,
                        /\bVCA\s+(?:[\w'.&-]+\s+){0,6}Pet\s+Care/i,
                        // Non-VCA with "of the/of" trailing words
                        /\b(?:[\w'.&-]+\s+){1,6}(?:Veterinary\s+Specialists?|Animal\s+Hospital|Hospital)\s+of\s+(?:the\s+)?[\w'.&-]+(?:\s+[\w'.&-]+)*/i,
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

                    // Helper: clean a single field value (strip HTML tags and trim)
                    function cleanField(val) {
                      if (!val || typeof val !== 'string') return val;
                      // Strip all HTML tags - handle both complete and incomplete tags
                      return val.replace(/<[^>]*>/g, '').replace(/<\/?[A-Za-z][^>]*$/g, '').trim();
                    }

                    // Helper: extract phone number from text
                    function extractPhone(text) {
                      if (!text) return '';
                      // Match common US phone formats, preferring labeled ones first
                      const phonePatterns = [
                        // Labeled: "phone: (xxx) xxx-xxxx" or "call us at xxx-xxx-xxxx"
                        /(?:phone|tel(?:ephone)?|call(?:\s+us)?(?:\s+at)?|contact(?:\s+us)?(?:\s+at)?|reach(?:\s+us)?(?:\s+at)?|dial)[:\s]+(\+?1[\s.-]?\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4})/i,
                        /(?:phone|tel(?:ephone)?|call(?:\s+us)?(?:\s+at)?|contact(?:\s+us)?(?:\s+at)?|reach(?:\s+us)?(?:\s+at)?|dial)[:\s]+(\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4})/i,
                        // Standalone formats: (xxx) xxx-xxxx, xxx-xxx-xxxx, xxx.xxx.xxxx
                        /(\(\d{3}\)\s*\d{3}[\s.-]\d{4})/,
                        /(\d{3}[\s.-]\d{3}[\s.-]\d{4})/
                      ];
                      for (const pattern of phonePatterns) {
                        const m = text.match(pattern);
                        if (m) {
                          return (m[1] || m[0]).trim();
                        }
                      }
                      return '';
                    }

                    // Helper: extract website URL from text
                    function extractWebsiteUrl(text) {
                      if (!text) return '';
                      // Look for website URLs - prefer ones labeled as website/visit
                      const websitePatterns = [
                        /(?:website|visit|visit\s+us|learn\s+more|our\s+site)[:\s]*(https?:\/\/[^\s<>"',;)]+)/i,
                        /(?:website|visit|visit\s+us|learn\s+more|our\s+site)[:\s]*(www\.[^\s<>"',;)]+)/i
                      ];
                      for (const pattern of websitePatterns) {
                        const m = text.match(pattern);
                        if (m) {
                          let url = m[1].trim().replace(/[.,;:]+$/, '');
                          if (url.startsWith('www.')) url = 'https://' + url;
                          return url;
                        }
                      }
                      return '';
                    }

                    function extractFromAll(jobData) {
                      let areaOfPractice = '';
                      let position = '';
                      let salary = '';
                      let hospitalName = '';
                      let city = '';
                      let state = '';
                      let address = '';
                      let allLocations = [];
                      let phone = '';
                      let websiteUrl = '';

                      // Helper: detect marketing/location-based titles (not actual position names)
                      function isMarketingTitle(text) {
                        if (!text) return false;
                        // Titles with location patterns like "Las Vegas/Reno Area", "Austin, TX", city/city
                        const hasLocationSlash = /\w+\s*\/\s*\w+\s+(?:area|region)/i.test(text);
                        const hasRelocation = /relocation\s+available/i.test(text);
                        const hasSignOn = /sign[- ]?on\s+bonus/i.test(text);
                        const hasDollarAmount = /\$\d{2,}[kK]?\b/.test(text);
                        const hasExclamation = /!/.test(text);
                        // If it has location-based marketing language, it's not a clean position title
                        if (hasLocationSlash || hasRelocation) return true;
                        // Sign-on bonus or dollar amounts with exclamation marks are marketing
                        if ((hasSignOn || hasDollarAmount) && hasExclamation) return true;
                        return false;
                      }

                      // Helper: strip marketing fluff from title to get clean position
                      function cleanMarketingTitle(text) {
                        if (!text) return '';
                        // Remove common marketing suffixes/prefixes
                        let cleaned = text
                          .replace(/\s*[-–]\s*(?:relocation\s+available|sign[- ]?on\s+bonus)[^]*/i, '')
                          .replace(/\s*[-–]\s*\$[\d,]+k?\+?[^]*/i, '')
                          .replace(/\s*!+\s*$/g, '')
                          .replace(/\s*[-–]\s*[\w\s,\/]+\s+(?:area|region)\s*$/i, '')
                          .trim();
                        return cleaned || text;
                      }

                      // === PRIORITY SOURCE 1: phApp.ddo job data (most accurate for position) ===
                      if (jobData) {
                        // Prefer title as it's the actual employer-set title with full details
                        if (jobData.title) {
                          const titleText = cleanField(jobData.title) || '';
                          if (titleText) {
                            position = isMarketingTitle(titleText) ? cleanMarketingTitle(titleText) : titleText;
                          }
                        }
                        // Fall back to ml_title (ML-predicted clean title, may oversimplify complex titles)
                        if (!position && jobData.ml_title) {
                          const mlTitle = cleanField(jobData.ml_title) || '';
                          if (mlTitle) {
                            position = isMarketingTitle(mlTitle) ? cleanMarketingTitle(mlTitle) : mlTitle;
                          }
                        }

                        city = cleanField(jobData.city) || '';
                        state = cleanField(jobData.state) || '';

                        // Try combined location field if city/state are missing
                        if ((!city || !state) && jobData.location) {
                          const locStr = cleanField(jobData.location).replace(/,?\s*United States of America/i, '').replace(/,?\s*USA$/i, '').trim();
                          const locParts = locStr.split(',').map(s => s.trim()).filter(Boolean);
                          if (locParts.length >= 2) {
                            if (!city) city = locParts[0];
                            if (!state) state = locParts[1];
                          } else if (locParts.length === 1 && !state) {
                            // Might be just a state
                            state = locParts[0];
                          }
                        }

                        // Collect ALL locations from multi_location
                        if (jobData.multi_location && jobData.multi_location.length > 0) {
                          console.log('multi_location found:', JSON.stringify(jobData.multi_location));
                          for (const loc of jobData.multi_location) {
                            const locCity = cleanField(loc.city) || '';
                            const locState = cleanField(loc.state) || '';
                            const locCountry = cleanField(loc.country) || '';
                            const addrParts = [];
                            if (loc.streetAddress || loc.address) addrParts.push(cleanField(loc.streetAddress || loc.address));
                            if (locCity) addrParts.push(locCity);
                            if (locState) addrParts.push(locState);
                            if (loc.postalCode || loc.zipcode || loc.zip) addrParts.push(cleanField(loc.postalCode || loc.zipcode || loc.zip));
                            const locAddress = addrParts.join(', ');
                            const locDisplay = [locCity, locState, locCountry].filter(Boolean).join(', ');
                            allLocations.push({ city: locCity, state: locState, address: locAddress, location: locDisplay });
                          }
                          // Use first location as primary
                          if (allLocations.length > 0) {
                            city = allLocations[0].city || city;
                            state = allLocations[0].state || state;
                            address = allLocations[0].address || '';
                          }
                        } else {
                          // Single location from jobData fields
                          const addrParts = [];
                          if (jobData.streetAddress) addrParts.push(cleanField(jobData.streetAddress));
                          if (jobData.address) addrParts.push(cleanField(jobData.address));
                          if (jobData.city) addrParts.push(cleanField(jobData.city));
                          if (jobData.state) addrParts.push(cleanField(jobData.state));
                          if (jobData.postalCode || jobData.zipcode || jobData.zip) addrParts.push(cleanField(jobData.postalCode || jobData.zipcode || jobData.zip));
                          if (addrParts.length > 1) {
                            address = addrParts.join(', ');
                          }
                        }

                        // jobFamilies is the most specific area of practice
                        if (jobData.jobFamilies && jobData.jobFamilies.length > 0) {
                          areaOfPractice = jobData.jobFamilies.join(', ');
                        } else if (jobData.category) {
                          areaOfPractice = jobData.category;
                        }

                        // locationDetails has hospital name: "Vca West Los Angeles Animal Hospital | 101"
                        if (!hospitalName && jobData.locationDetails) {
                          let locDetail = cleanField(jobData.locationDetails).split('|')[0].trim();
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
                            const locName = cleanField(loc.locationName).trim();
                            // Only use if it contains hospital/clinic/center keywords or starts with VCA (not just "City, ST")
                            if (/(?:hospital|clinic|center|care|veterinary|animal|emergency|medical|specialty|specialists?|pet|^vca\b)/i.test(locName)) {
                              hospitalName = locName;
                            }
                          }
                        }

                        // Extract salary and hospital from jobData.description (embedded HTML)
                        if (jobData.description) {
                          const descPlainText = stripHtml(jobData.description);
                          if (!salary) {
                            salary = extractSalary(descPlainText);
                          }
                          if (!hospitalName) {
                            const descExtracted = extractPositionAndHospital(descPlainText);
                            if (descExtracted.hospital) {
                              hospitalName = descExtracted.hospital;
                            }
                            if (!hospitalName) {
                              hospitalName = extractHospitalFromText(descPlainText);
                            }
                          }
                        }

                        // Also check descriptionTeaser for salary and hospital name
                        if (jobData.descriptionTeaser) {
                          const teaserText = stripHtml(jobData.descriptionTeaser);
                          if (!salary) {
                            salary = extractSalary(teaserText);
                          }
                          if (!hospitalName) {
                            const teaserExtracted = extractPositionAndHospital(teaserText);
                            if (teaserExtracted.hospital) {
                              hospitalName = teaserExtracted.hospital;
                            }
                            if (!hospitalName) {
                              hospitalName = extractHospitalFromText(teaserText);
                            }
                          }
                        }
                      }

                      // === SOURCE 2: data-ph-at-* attributes on .job-info div ===
                      const jobInfoEl = document.querySelector('.job-info[data-ph-at-id="job-info"]');
                      if (jobInfoEl) {
                        if (!position) {
                          const attrTitle = jobInfoEl.getAttribute('data-ph-at-job-title-text') || '';
                          if (attrTitle) {
                            position = isMarketingTitle(attrTitle) ? cleanMarketingTitle(attrTitle) : attrTitle;
                          }
                        }
                        if (!hospitalName) {
                          const attrCompany = jobInfoEl.getAttribute('data-ph-at-job-company-text') || jobInfoEl.getAttribute('data-ph-at-job-location-name') || '';
                          if (attrCompany && attrCompany.toLowerCase() !== 'vca animal hospitals' && attrCompany.toLowerCase() !== 'vca') {
                            hospitalName = attrCompany;
                          }
                        }
                        if (!areaOfPractice) {
                          areaOfPractice = jobInfoEl.getAttribute('data-ph-at-job-category-text') || '';
                        }
                        if (!city || !state) {
                          const locText = (jobInfoEl.getAttribute('data-ph-at-job-location-text') || '').replace(/,?\s*United States of America/i, '').replace(/,?\s*USA$/i, '').trim();
                          const parts = locText.split(',').map(s => s.trim()).filter(Boolean);
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
                        if (titleEl) {
                          const h1Text = titleEl.textContent.trim();
                          if (h1Text) {
                            position = isMarketingTitle(h1Text) ? cleanMarketingTitle(h1Text) : h1Text;
                          }
                        }
                      }

                      // === SOURCE 5: location from data attribute (any element) ===
                      if (!city || !state) {
                        const locAttrEl = document.querySelector('[data-ph-at-job-location-text]');
                        if (locAttrEl) {
                          const locText = (locAttrEl.getAttribute('data-ph-at-job-location-text') || '').replace(/,?\s*United States of America/gi, '').replace(/,?\s*USA$/gi, '').trim();
                          const parts = locText.split(',').map(s => s.trim()).filter(Boolean);
                          if (!city && parts[0]) city = parts[0];
                          if (!state && parts[1]) state = parts[1];
                        }
                      }

                      // === SOURCE 5a: .job-location span text ===
                      if (!city || !state) {
                        const locEl = document.querySelector('span.job-location');
                        if (locEl) {
                          const locText = locEl.textContent.replace('Location', '').replace(/,?\s*United States of America/gi, '').replace(/,?\s*USA/gi, '').trim();
                          const parts = locText.split(',').map(s => s.trim()).filter(Boolean);
                          if (!city && parts[0]) city = parts[0];
                          if (!state && parts[1]) state = parts[1];
                        }
                      }

                      // === SOURCE 5b: DOM company/hospital name element ===
                      if (!hospitalName) {
                        const companyEl = document.querySelector('[data-ph-at-id="job-company-text"], .job-company, .jd-info .company-name, .job-info .company, .company-name');
                        if (companyEl) {
                          const companyName = companyEl.textContent.trim();
                          if (companyName && companyName.toLowerCase() !== 'vca animal hospitals' && companyName.toLowerCase() !== 'vca') {
                            hospitalName = companyName;
                          }
                        }
                      }

                      // === SOURCE 6: JSON-LD structured data ===
                      const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
                      for (const s of ldScripts) {
                        try {
                          const ld = JSON.parse(s.textContent);
                          if (ld['@type'] === 'JobPosting') {
                            if (!position && ld.title) {
                              position = isMarketingTitle(ld.title) ? cleanMarketingTitle(ld.title) : ld.title;
                            }
                            if (ld.jobLocation) {
                              // jobLocation can be an object or an array
                              const jobLoc = Array.isArray(ld.jobLocation) ? ld.jobLocation[0] : ld.jobLocation;
                              const addr = jobLoc.address || jobLoc;
                              if (!city) city = addr.addressLocality || '';
                              if (!state) state = addr.addressRegion || '';
                              // Build full address from JSON-LD PostalAddress
                              if (!address) {
                                const ldAddrParts = [];
                                if (addr.streetAddress) ldAddrParts.push(addr.streetAddress);
                                if (addr.addressLocality) ldAddrParts.push(addr.addressLocality);
                                if (addr.addressRegion) ldAddrParts.push(addr.addressRegion);
                                if (addr.postalCode) ldAddrParts.push(addr.postalCode);
                                if (addr.addressCountry) ldAddrParts.push(addr.addressCountry);
                                if (ldAddrParts.length > 1) {
                                  address = ldAddrParts.join(', ');
                                }
                              }
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

                      // === SOURCE 7: Extract from DOM description text (fallback for position, hospital, salary) ===
                      if (!position || !hospitalName || !salary) {
                        const descElFallback = document.querySelector('.jd-info[data-ph-at-id="jobdescription-text"]');
                        if (descElFallback) {
                          const descText = descElFallback.innerText || '';
                          const descExtracted = extractPositionAndHospital(descText);

                          if (!position && descExtracted.position) {
                            position = descExtracted.position;
                          }

                          if (!hospitalName && descExtracted.hospital) {
                            hospitalName = descExtracted.hospital;
                          }
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
                          // Accept if it looks like a hospital/clinic name OR starts with VCA
                          if (/(?:hospital|clinic|center|care|veterinary|animal|emergency|medical|specialty|specialists?|pet|^vca\b)/i.test(candidate)) {
                            hospitalName = candidate;
                          }
                        }
                      }

                      // === SOURCE 10: Extract hospital from breadcrumbs or location spans ===
                      if (!hospitalName) {
                        // Try location-name or facility-name elements
                        const locNameEl = document.querySelector('.location-name, .facility-name, [data-ph-at-id="job-location-name"]');
                        if (locNameEl) {
                          const locName = cleanField(locNameEl.textContent.trim());
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
                          // Try "at VCA [Name]" first (VCA names may not end with facility keyword)
                          const atVcaMatch = descText.match(/\bat\s+(VCA\s+[^,;.!?\n]{3,60}?)(?:[,;.!?\n]|\s+(?:in|located|is|we|where|our|and|to)\b)/i);
                          if (atVcaMatch) {
                            hospitalName = atVcaMatch[1].trim();
                          }
                          // Fallback: "at [Name]" patterns ending with facility keyword
                          if (!hospitalName) {
                            const atMatch = descText.match(/\bat\s+((?:[\w'.&-]+\s+){0,6}(?:Animal\s+Hospital|Veterinary\s+(?:Hospital|Center|Clinic|Care|Specialists?)|Pet\s+(?:Hospital|Clinic|Care)|Emergency\s+(?:Hospital|Center|Clinic)|Medical\s+Center|Hospital|Clinic|Center)(?:\s+of\s+(?:the\s+)?[\w'.&-]+(?:\s+[\w'.&-]+)*)?)\b/i);
                            if (atMatch) {
                              hospitalName = atMatch[1].trim();
                            }
                          }
                        }
                      }

                      // === SOURCE 12: Try phApp.ddo for any additional location/facility fields ===
                      if (!hospitalName && jobData) {
                        // Some jobs store hospital name in customField or other properties
                        const fieldsToCheck = ['facility', 'hospitalName', 'siteName', 'branchName', 'storeName', 'company', 'organizationName', 'employer', 'brand'];
                        for (const field of fieldsToCheck) {
                          if (jobData[field] && typeof jobData[field] === 'string' && jobData[field].trim().length > 2) {
                            const fieldVal = cleanField(jobData[field]).trim();
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
                              hospitalName = cleanField(cf.value).trim();
                              break;
                            }
                          }
                        }
                      }

                      // Clean up hospital name and validate
                      if (hospitalName) {
                        hospitalName = cleanField(hospitalName).replace(/[\s,;.]+$/, '').trim();
                        // Remove location/availability junk that may have been captured
                        hospitalName = hospitalName
                          .replace(/,?\s*This\s+job\s+is\s+available\s+in\s+.*/i, '')
                          .replace(/,?\s*\d+\s+location.*$/i, '')
                          .replace(/,?\s*located\s+in\s+.*/i, '')
                          .replace(/,?\s*multiple\s+locations.*$/i, '')
                          .replace(/\s*[-–]\s*(?:[A-Z]{2}|[A-Za-z]+,\s*[A-Z]{2})$/, '')
                          .trim();

                        // VALIDATION: Reject invalid hospital names (VCA taglines, job description text, etc.)
                        const invalidHospitalPatterns = [
                          /future\s+of\s+veterinary/i,
                          /\bthe\s+future\s+of\b/i,
                          /\bour\s+hands\b/i,
                          /client\s+communication/i,
                          /providing\s+compassionate/i,
                          /pets\s+in\s+need/i,
                          /world[- ]class\s+medicine/i,
                          /you'll\s+quickly\s+discover/i,
                          /well\s+supported\s+by/i,
                          /^vca\s*,\s*the\s+/i,
                          /^vca\s+network$/i,
                          /^vca\s+animal\s+hospitals?$/i,
                          /^vca\s*$/i
                        ];

                        let isInvalid = false;
                        for (const invalidPattern of invalidHospitalPatterns) {
                          if (invalidPattern.test(hospitalName)) {
                            isInvalid = true;
                            break;
                          }
                        }

                        if (isInvalid) {
                          hospitalName = '';
                        } else {
                          if (hospitalName.length > 80) hospitalName = hospitalName.substring(0, 80).replace(/\s+\S*$/, '').trim();
                          // Title-case but preserve known acronyms and lowercase small words
                          hospitalName = hospitalName.replace(/\b\w+/g, (word, offset) => {
                            const upper = word.toUpperCase();
                            // Preserve acronyms: VCA, VTS, ECC, etc.
                            if (/^[A-Z]{2,}$/.test(word)) return word;
                            // Keep small words lowercase (except first word)
                            if (offset > 0 && /^(of|the|and|in|at|on|for|by|a|an)$/i.test(word)) return word.toLowerCase();
                            // Title-case everything else
                            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
                          });
                        }
                      }

                      // === Try DOM for multiple locations ===
                      if (allLocations.length <= 1) {
                        const locSelectors = [
                          '.multi-location-list .location-item',
                          '.job-location-list li',
                          '[data-ph-at-id="job-multi-location"] .location',
                          '.job-multi-location .au-target',
                          '.multi-loc-item',
                          '.location-name',
                          '.job-location .multi-location span',
                          '.job-details-multi-location li',
                          '.au-target[data-ph-at-id="location-name"]'
                        ];
                        let locEls = [];
                        for (const sel of locSelectors) {
                          locEls = document.querySelectorAll(sel);
                          if (locEls.length > 1) break;
                        }

                        if (locEls.length > 1) {
                          allLocations = [];
                          for (const el of locEls) {
                            const locText = el.textContent.trim();
                            if (!locText) continue;
                            const parts = locText.split(',').map(s => s.trim());
                            allLocations.push({ city: parts[0] || '', state: parts[1] || '', address: '', location: locText });
                          }
                          if (allLocations.length > 0) {
                            city = allLocations[0].city || city;
                            state = allLocations[0].state || state;
                          }
                        }

                        if (allLocations.length <= 1) {
                          const jobLocEl = document.querySelector('.job-location, [data-ph-at-id="job-location"], span.job-location');
                          if (jobLocEl) {
                            const fullLocText = jobLocEl.textContent.replace('Location', '').trim();
                            const locParts = fullLocText.split(/United States of America|USA/i).filter(s => s.trim());
                            if (locParts.length > 1) {
                              allLocations = [];
                              for (const part of locParts) {
                                const cleaned = part.replace(/[,\s]+$/, '').replace(/^[,\s]+/, '').trim();
                                if (!cleaned) continue;
                                const segments = cleaned.split(',').map(s => s.trim());
                                allLocations.push({
                                  city: segments[0] || '',
                                  state: segments[1] || '',
                                  address: '',
                                  location: cleaned + ', United States of America'
                                });
                              }
                              if (allLocations.length > 0) {
                                city = allLocations[0].city || city;
                                state = allLocations[0].state || state;
                              }
                            }
                          }
                        }
                      }

                      // === Try DOM for address if still missing ===
                      if (!address) {
                        const addrEl = document.querySelector('.job-location-address, [data-ph-at-id="job-address"], .jd-info .address, [itemprop="address"]');
                        if (addrEl) {
                          address = addrEl.textContent.trim();
                        }
                      }

                      // === Last resort: extract city/state from address string ===
                      if ((!city || !state) && address) {
                        const addrClean = address.replace(/,?\s*United States of America/i, '').replace(/,?\s*USA$/i, '').trim();
                        const addrParts = addrClean.split(',').map(s => s.trim()).filter(Boolean);
                        // Address format: "Hospital, Street, City, State, Zip" or "City, State, Zip" etc.
                        // Try to find state (2-letter code or full name) from the end
                        for (let i = addrParts.length - 1; i >= 0; i--) {
                          const part = addrParts[i].replace(/\d{5}(-\d{4})?/, '').trim(); // strip zip
                          if (!part) continue;
                          // 2-letter state code
                          if (/^[A-Z]{2}$/.test(part)) {
                            if (!state) state = part;
                            if (!city && i > 0) city = addrParts[i - 1];
                            break;
                          }
                          // Full state name (at least 4 chars, no digits)
                          if (part.length >= 4 && part.length <= 20 && !/\d/.test(part) && /^[A-Za-z\s]+$/.test(part)) {
                            if (!state) state = part;
                            if (!city && i > 0) city = addrParts[i - 1];
                            break;
                          }
                        }
                      }

                      // === Last resort: try specific location elements on the page ===
                      if (!city || !state) {
                        // Only target leaf-level elements likely to contain clean "City, State" text
                        const locSelectors = [
                          'span.job-location',
                          '[data-ph-at-id="job-location"] span',
                          '.job-location span',
                          '[itemprop="addressLocality"]',
                          '[itemprop="addressRegion"]'
                        ];
                        // Try itemprop elements first (most reliable)
                        const cityItemprop = document.querySelector('[itemprop="addressLocality"]');
                        const stateItemprop = document.querySelector('[itemprop="addressRegion"]');
                        if (!city && cityItemprop) city = cityItemprop.textContent.trim();
                        if (!state && stateItemprop) state = stateItemprop.textContent.trim();
                        // Fallback: try span elements with location text
                        if (!city || !state) {
                          for (const sel of locSelectors) {
                            const els = document.querySelectorAll(sel);
                            for (const el of els) {
                              const text = el.textContent.replace('Location', '').replace(/,?\s*United States of America/gi, '').replace(/,?\s*USA/gi, '').trim();
                              if (!text || text.length > 60 || text.length < 3) continue;
                              const parts = text.split(',').map(s => s.trim()).filter(Boolean);
                              if (parts.length >= 2) {
                                if (!city) city = parts[0];
                                if (!state) state = parts[1];
                                break;
                              }
                            }
                            if (city && state) break;
                          }
                        }
                      }

                      // Clean up city/state values before validation
                      if (city) city = city.replace(/,?\s*United States of America/gi, '').replace(/,?\s*USA$/gi, '').replace(/\d{5}(-\d{4})?/, '').trim();
                      if (state) state = state.replace(/,?\s*United States of America/gi, '').replace(/,?\s*USA$/gi, '').replace(/\d{5}(-\d{4})?/, '').trim();

                      // Validate city/state are not junk text (e.g. "This job is available in 2 locations")
                      function isValidCityState(val) {
                        if (!val) return false;
                        if (val.length > 40) return false;
                        if (/this\s+job|available|location|multiple/i.test(val)) return false;
                        if (/\d+\s+location/i.test(val)) return false;
                        return true;
                      }
                      if (!isValidCityState(city)) city = '';
                      if (!isValidCityState(state)) state = '';

                      // Final logic for Salary and Area of Practice
                      try {
                        if (!salary) {
                          salary = 'N/A';
                        }

                        // Clean up incomplete salary prefixes
                        if (salary && salary !== 'N/A' && salary !== 'Negotiable') {
                          salary = salary.replace(/^(?:the\s+)?(?:compensation\s+)?for\s+this\s+position\s+is\s+/i, '');
                          salary = salary.replace(/^(?:the\s+)?(?:salary\s+)?for\s+this\s+position\s+is\s+/i, '');
                          salary = salary.replace(/^is\s+/i, '');
                          salary = salary.replace(/^(?:the\s+)?salary\s+is\s+/i, '');
                          salary = salary.trim();
                        }

                        // Area of Practice: Check description for specialty keywords first
                        let combinedDescription = '';
                        const descElForCheck = document.querySelector('.jd-info[data-ph-at-id="jobdescription-text"]');
                        if (descElForCheck && descElForCheck.innerText) {
                            combinedDescription += ' ' + descElForCheck.innerText.toLowerCase();
                        }
                        if (jobData && jobData.description) {
                            combinedDescription += ' ' + stripHtml(jobData.description).toLowerCase();
                        }

                        if (combinedDescription.includes('board certified') || combinedDescription.includes('residency trained') || combinedDescription.includes('residence trained')) {
                            areaOfPractice = 'Specialty Care';
                        } else {
                            const lookedUpArea = lookupAreaOfPractice(position);
                            if (lookedUpArea) {
                                areaOfPractice = lookedUpArea;
                            }
                        }

                        // Fallback: if still empty, check if it's a general veterinarian position
                        if (!areaOfPractice && position) {
                          const posLower = position.toLowerCase();
                          if (posLower.includes('veterinarian') || posLower.includes('dvm') || posLower.includes('vmd')) {
                            areaOfPractice = 'General Practice Care';
                          }
                        }
                      } catch (e) {
                          const lookedUpArea = lookupAreaOfPractice(position);
                          if (lookedUpArea) {
                              areaOfPractice = lookedUpArea;
                          }
                          // Fallback in catch block too
                          if (!areaOfPractice && position) {
                            const posLower = position.toLowerCase();
                            if (posLower.includes('veterinarian') || posLower.includes('dvm') || posLower.includes('vmd')) {
                              areaOfPractice = 'General Practice Care';
                            }
                          }
                      }

                      // Prepend hospital name to address
                      console.log('Address before prepend:', address, '| Hospital:', hospitalName);
                      if (hospitalName) {
                        address = address ? hospitalName + ', ' + address : hospitalName;
                      }
                      // Clean any stray HTML from address
                      address = cleanField(address);
                      console.log('Final address:', address);
                      console.log('All locations:', JSON.stringify(allLocations));

                      // === Extract Phone Number ===
                      // Try jobData fields first
                      if (jobData) {
                        const phoneFields = ['phone', 'phoneNumber', 'contactPhone', 'telephone'];
                        for (const field of phoneFields) {
                          if (jobData[field] && typeof jobData[field] === 'string' && jobData[field].trim()) {
                            phone = jobData[field].trim();
                            break;
                          }
                        }
                        // Check customField array
                        if (!phone && jobData.customField && Array.isArray(jobData.customField)) {
                          for (const cf of jobData.customField) {
                            if (cf && cf.name && /phone|telephone|contact/i.test(cf.name) && cf.value) {
                              phone = cf.value.trim();
                              break;
                            }
                          }
                        }
                      }
                      // Try JSON-LD
                      if (!phone) {
                        const ldScriptsPhone = document.querySelectorAll('script[type="application/ld+json"]');
                        for (const s of ldScriptsPhone) {
                          try {
                            const ld = JSON.parse(s.textContent);
                            if (ld['@type'] === 'JobPosting' && ld.hiringOrganization) {
                              phone = ld.hiringOrganization.telephone || '';
                            }
                          } catch(e) {}
                        }
                      }
                      // Try DOM elements
                      if (!phone) {
                        const phoneEl = document.querySelector('[href^="tel:"], a[data-ph-at-id*="phone"], .phone-number, [itemprop="telephone"]');
                        if (phoneEl) {
                          phone = phoneEl.textContent.trim() || phoneEl.getAttribute('href').replace('tel:', '').trim();
                        }
                      }
                      // Try extracting from description text
                      if (!phone) {
                        const descElPhone = document.querySelector('.jd-info[data-ph-at-id="jobdescription-text"]');
                        if (descElPhone) {
                          phone = extractPhone(descElPhone.innerText || '');
                        }
                      }
                      // Try from jobData description HTML - check for tel: links first
                      if (!phone && jobData && jobData.description) {
                        const telMatch = jobData.description.match(/href=["']tel:([^"']+)["']/i);
                        if (telMatch) {
                          phone = telMatch[1].trim();
                        }
                        if (!phone) {
                          phone = extractPhone(stripHtml(jobData.description));
                        }
                      }
                      // Final fallback: scan full page body text
                      if (!phone) {
                        const bodyText = document.body ? document.body.innerText : '';
                        const phoneSection = bodyText.match(/(?:phone|call|contact|reach|tel)[^\n]{0,80}/gi);
                        if (phoneSection) {
                          for (const section of phoneSection) {
                            phone = extractPhone(section);
                            if (phone) break;
                          }
                        }
                      }

                      // === Extract Website URL ===
                      // Try jobData fields first
                      if (jobData) {
                        const urlFields = ['website', 'websiteUrl', 'companyUrl', 'siteUrl'];
                        for (const field of urlFields) {
                          if (jobData[field] && typeof jobData[field] === 'string' && jobData[field].trim()) {
                            websiteUrl = jobData[field].trim();
                            break;
                          }
                        }
                      }
                      // Try JSON-LD
                      if (!websiteUrl) {
                        const ldScriptsWeb = document.querySelectorAll('script[type="application/ld+json"]');
                        for (const s of ldScriptsWeb) {
                          try {
                            const ld = JSON.parse(s.textContent);
                            if (ld['@type'] === 'JobPosting' && ld.hiringOrganization) {
                              const orgUrl = ld.hiringOrganization.sameAs || ld.hiringOrganization.url || '';
                              if (orgUrl) websiteUrl = orgUrl;
                            }
                          } catch(e) {}
                        }
                      }
                      // Try DOM links with hospital/website references
                      if (!websiteUrl) {
                        const websiteLinks = document.querySelectorAll('a[href]');
                        for (const link of websiteLinks) {
                          const linkText = link.textContent.trim().toLowerCase();
                          const href = link.getAttribute('href') || '';
                          if ((linkText.includes('visit') || linkText.includes('website') || linkText.includes('our site') || linkText.includes('hospital website') || linkText.includes('learn more about us')) && href.startsWith('http') && !href.includes('vcacareers') && !href.includes('phenom')) {
                            websiteUrl = href.trim();
                            break;
                          }
                        }
                      }
                      // Try extracting from description text
                      if (!websiteUrl) {
                        const descElWeb = document.querySelector('.jd-info[data-ph-at-id="jobdescription-text"]');
                        if (descElWeb) {
                          websiteUrl = extractWebsiteUrl(descElWeb.innerText || '');
                        }
                      }
                      // Try from jobData description HTML - extract href from anchor tags
                      if (!websiteUrl && jobData && jobData.description) {
                        const hrefMatch = jobData.description.match(/<a[^>]+href=["'](https?:\/\/(?!.*(?:vcacareers|phenom|apply|jobs\.))[^"']+)["'][^>]*>/i);
                        if (hrefMatch) {
                          websiteUrl = hrefMatch[1].trim();
                        }
                        if (!websiteUrl) {
                          websiteUrl = extractWebsiteUrl(stripHtml(jobData.description));
                        }
                      }

                      console.log('Phone:', phone, '| Website:', websiteUrl);

                      // === Extract Job Type (Full time / Part time) ===
                      let jobType = '';
                      // Try phApp.ddo fields
                      if (jobData) {
                        const typeFields = ['type', 'jobType', 'employmentType', 'job_type', 'workType', 'positionType'];
                        for (const field of typeFields) {
                          if (jobData[field] && typeof jobData[field] === 'string' && jobData[field].trim()) {
                            jobType = jobData[field].trim();
                            break;
                          }
                        }
                        // Check jobSchedule or similar
                        if (!jobType && jobData.jobSchedule) {
                          jobType = cleanField(jobData.jobSchedule);
                        }
                      }
                      // Try JSON-LD employmentType
                      if (!jobType) {
                        const ldScriptsType = document.querySelectorAll('script[type="application/ld+json"]');
                        for (const s of ldScriptsType) {
                          try {
                            const ld = JSON.parse(s.textContent);
                            if (ld['@type'] === 'JobPosting' && ld.employmentType) {
                              jobType = Array.isArray(ld.employmentType) ? ld.employmentType.join(', ') : ld.employmentType;
                              break;
                            }
                          } catch(e) {}
                        }
                      }
                      // Try DOM elements
                      if (!jobType) {
                        const typeEl = document.querySelector('[data-ph-at-job-type-text], .job-type, .type span:last-child, .jd-info .job-type, [data-ph-at-id="job-type"]');
                        if (typeEl) {
                          jobType = typeEl.getAttribute('data-ph-at-job-type-text') || typeEl.textContent.trim();
                        }
                      }
                      // Try data attribute on job-info element
                      if (!jobType) {
                        const jobInfoForType = document.querySelector('[data-ph-at-job-type-text]');
                        if (jobInfoForType) {
                          jobType = jobInfoForType.getAttribute('data-ph-at-job-type-text') || '';
                        }
                      }
                      // Normalize job type values
                      if (jobType) {
                        const typeLower = jobType.toLowerCase().replace(/[-_]/g, ' ').trim();
                        if (/full\s*time/i.test(typeLower)) jobType = 'Full time';
                        else if (/part\s*time/i.test(typeLower)) jobType = 'Part time';
                        else if (/contract/i.test(typeLower)) jobType = 'Contract';
                        else if (/temporary|temp\b/i.test(typeLower)) jobType = 'Temporary';
                        else if (/intern/i.test(typeLower)) jobType = 'Intern';
                        // Reject if it looks like a job title instead of a type
                        if (jobType.length > 30 || /veterinarian|doctor|technician|surgeon/i.test(jobType)) {
                          jobType = '';
                        }
                      }

                      // Map position to exact docx position name
                      const mappedPosition = lookupPosition(position);
                      if (mappedPosition) {
                        position = mappedPosition;
                      }

                      return { areaOfPractice, position, salary, hospitalName, city, state, address, allLocations, phone, websiteUrl, jobType };
                    }
                  });
                }
              }).then((results) => {
                chrome.tabs.remove(tab.id);
                sendResponse({
                  action: 'detailsFetched',
                  details: results && results[0] ? results[0].result : {},
                  jobIndex: request.jobIndex
                });
              }).catch((err) => {
                console.error('Error extracting job details:', err);
                chrome.tabs.remove(tab.id);
                sendResponse({
                  action: 'detailsFetched',
                  details: {},
                  jobIndex: request.jobIndex
                });
              });
            }, 500);
          }, 3000);
        }
      });
    });
    return true;
  }
});
