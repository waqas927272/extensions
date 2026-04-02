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

                // === SOURCE 1: DOM h1 for position ===
                const h1 = document.querySelector('h1.banner__text__title');
                if (h1) result.position = h1.textContent.trim();

                // === SOURCE 2: General Information field/value pairs ===
                // Structure: .article__content__view__field with __label and __value divs
                const fields = document.querySelectorAll('.article__content__view__field');
                let baseMin = '', baseMax = '';

                for (const field of fields) {
                  const labelEl = field.querySelector('.article__content__view__field__label');
                  const valueEl = field.querySelector('.article__content__view__field__value');
                  if (!labelEl || !valueEl) continue;

                  const label = labelEl.textContent.trim();
                  const value = valueEl.textContent.trim();

                  switch (label) {
                    case 'Job Site':
                      result.hospitalName = value.replace(/<br\s*\/?>/gi, '').trim();
                      break;
                    case 'Department':
                      result.department = value;
                      break;
                    case 'Pay Class':
                      result.jobType = value;
                      break;
                    case 'Base Min.':
                      baseMin = value.replace(/[^0-9.]/g, '');
                      break;
                    case 'Base Max.':
                      baseMax = value.replace(/[^0-9.]/g, '');
                      break;
                    case 'City':
                      result.city = value;
                      break;
                    case 'State':
                      result.state = value;
                      break;
                    case 'Postal Code':
                    case 'Zip':
                    case 'Zip Code':
                      result.postalCode = value;
                      break;
                    case 'Street Address':
                    case 'Address':
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

                // === SOURCE 3: Description text for salary fallback ===
                if (!result.salary) {
                  const descFields = document.querySelectorAll('.article__content__view__field__value');
                  for (const df of descFields) {
                    const text = df.innerText || '';
                    if (text.length > 200) {
                      const salaryPatterns = [/\$[\d,]+k?\s*[-–]+\s*\$?[\d,]+k/i, /\$[\d,]+(?:,\d{3})*\s*[-–]+\s*\$[\d,]+(?:,\d{3})*/i, /\$[\d,]+(?:\.\d{2})?\s*(?:per\s+)?(?:hourly|hour|hr|\/hr|\/\s*hour)/i, /\$[\d,]+k\+?/i];
                      for (const p of salaryPatterns) { const m = text.match(p); if (m) { result.salary = m[0].trim(); break; } }
                      if (result.salary) break;
                    }
                  }
                }

                // === SOURCE 4: Area of Practice from position ===
                if (result.position) result.areaOfPractice = lookupAreaOfPractice(result.position);
                if (!result.areaOfPractice && result.department) result.areaOfPractice = lookupAreaOfPractice(result.department);
                // Scan all description sections for area of practice keywords
                if (!result.areaOfPractice) {
                  const allSections = document.querySelectorAll('.article__content__view__field__value');
                  for (const sec of allSections) {
                    const text = sec.innerText || '';
                    if (text.length > 50) {
                      result.areaOfPractice = lookupAreaOfPractice(text);
                      if (result.areaOfPractice) break;
                    }
                  }
                }
                // Final fallback: scan entire main content
                if (!result.areaOfPractice) {
                  const mainPanel = document.querySelector('#main-panel, .main, main');
                  if (mainPanel) result.areaOfPractice = lookupAreaOfPractice(mainPanel.innerText || '');
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
