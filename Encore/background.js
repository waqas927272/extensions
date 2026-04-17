// Encore Vet Job Scraper - Background Service Worker

console.log("Encore Vet Job Scraper background script loaded");

// ============================================================
//  POSITION & AREA-OF-PRACTICE MATCHING
//  Based on CorrectJobNames.txt valid combinations:
//
//  Emergency Care:     Associate Veterinarian
//  General Practice:   Associate Veterinarian, Lead Veterinarian, Medical Director
//  Specialty Care:     Anesthesiologist, Cardiologist,
//                      Credentialed Veterinary Technician Specialist,
//                      DABVP Specialist, Dental Specialist, Dermatologist,
//                      ECC Specialist, Internal Medicine Specialist, Medical Director,
//                      Medical Oncologist, Neurologist & Neurosurgeon,
//                      Ophthalmologist, Radiation Oncologist, Radiologist, Surgeon
//  Urgent Care:        Associate Veterinarian, Partner Veterinarian
// ============================================================

// Extract base role from title — everything before " - Hospital Name"
function extractBaseRole(title) {
  if (!title) return '';
  const dashIdx = title.indexOf(' - ');
  return (dashIdx > -1 ? title.substring(0, dashIdx) : title).trim();
}

// Non-clinical titles should get no position/AOP
function isNonClinicalTitle(t) {
  return /\b(client service|service representative|receptionist|kennel|groomer|grooming|practice manager|hospital manager|office manager|administrator|billing|human resources|patient care coordinator|client care coordinator|customer service|front desk|inventory|housekeeper|janitorial|marketing|it technician|accountant)\b/.test(t);
}

// ─── Step 1: Determine POSITION from title base role + category ───────────────
function matchPositionFromTitle(titleBase, category) {
  const t = titleBase.toLowerCase();
  const c = (category || '').toLowerCase();

  // ── Non-clinical guard ──
  // For combined "/" titles like "Veterinary Assistant/Client Service Representative",
  // check ONLY the primary role (before "/") so the secondary non-clinical keyword
  // does not block the whole match.
  // e.g. primary="Veterinary Assistant" → NOT non-clinical → proceeds normally.
  // Only block if the PRIMARY role itself is purely non-clinical.
  const primaryRole = titleBase.split('/')[0].trim().toLowerCase();
  if (isNonClinicalTitle(primaryRole)) return '';

  // ── Leadership (check FIRST — highest priority) ──
  if (/medical director/.test(t)) return 'Medical Director';
  if (/lead veterinarian|lead vet\b|medical lead/.test(t)) return 'Lead Veterinarian';
  if (/partner veterinarian|partner vet\b/.test(t)) return 'Partner Veterinarian';

  // ── Credentialed Vet Tech (CVT) — must be checked BEFORE generic "veterinarian" pattern
  //    because "veterinary" appears in the title and would match the vet catch-all
  const isCVT = /credentialed veterinary technician|credentialed vet tech|\bcvt\b|\brvt\b|\blvt\b/.test(t)
             || /credentialed veterinary technician|credentialed vet tech|\bcvt\b|\brvt\b|\blvt\b/.test(c);
  if (isCVT) return 'Credentialed Veterinary Technician Specialist';

  // ── ECC / Criticalist (board-certified ER specialist) ──
  if (/criticalist|dacvecc|\becc\b|emergency.{0,25}critical care|critical care.{0,25}emergency/.test(t)) {
    return 'ECC Specialist';
  }

  // ── Specialty positions (DVM / board-certified level) ──
  if (/neurolog|neurosurg/.test(t))                                      return 'Neurologist & Neurosurgeon';
  if (/dermatolog/.test(t))                                               return 'Dermatologist';
  if (/cardiolog/.test(t))                                                return 'Cardiologist';
  if (/radiation.{0,10}oncolog|oncolog.{0,10}radiation/.test(t))         return 'Radiation Oncologist';
  if (/oncolog/.test(t))                                                  return 'Medical Oncologist';
  if (/radiolog|diagnostic imaging/.test(t))                              return 'Radiologist';
  if (/ophthalmolog|ophtho/.test(t))                                      return 'Ophthalmologist';
  if (/anesthesiolog|anesthesia/.test(t))                                 return 'Anesthesiologist';
  if (/internal medicine|internist/.test(t))                              return 'Internal Medicine Specialist';
  if (/\bsurgeon\b|oral surgery|soft tissue surgery|orthopedic surgery/.test(t)) return 'Surgeon';
  if (/\bsurgery\b/.test(t) && !/neurosurgery/.test(t))                  return 'Surgeon';
  if (/dental|dentist/.test(t) && !/assistant/.test(t))                  return 'Dental Specialist';
  if (/\bdabvp\b/.test(t))                                               return 'DABVP Specialist';

  // ── Also try category for specialty detection ──
  if (/neurolog|neurosurg/.test(c))                                       return 'Neurologist & Neurosurgeon';
  if (/dermatolog/.test(c))                                               return 'Dermatologist';
  if (/cardiolog/.test(c))                                                return 'Cardiologist';
  if (/radiation.{0,10}oncolog/.test(c))                                  return 'Radiation Oncologist';
  if (/oncolog/.test(c))                                                  return 'Medical Oncologist';
  if (/radiolog|diagnostic imaging/.test(c))                              return 'Radiologist';
  if (/ophthalmolog/.test(c))                                             return 'Ophthalmologist';
  if (/anesthesiolog|anesthesia/.test(c))                                 return 'Anesthesiologist';
  if (/internal medicine|internist/.test(c))                              return 'Internal Medicine Specialist';
  if (/\bsurgeon\b|\bsurgery\b/.test(c))                                 return 'Surgeon';
  if (/dental|dentist/.test(c))                                           return 'Dental Specialist';
  if (/\bdabvp\b/.test(c))                                               return 'DABVP Specialist';
  if (/\becc\b|criticalist/.test(c))                                      return 'ECC Specialist';

  // ── Generic veterinarian / DVM catch-all (Associate Vet) ──
  //    Must be AFTER all specialty/tech checks
  if (/veterinarian|veterinary|(?<!\w)vet(?!\w)|(?<!\w)dvm(?!\w)|(?<!\w)vmd(?!\w)/.test(t)) {
    return 'Associate Veterinarian';
  }
  if (/veterinarian|veterinary|(?<!\w)vet(?!\w)|(?<!\w)dvm(?!\w)/.test(c)) {
    return 'Associate Veterinarian';
  }

  return '';
}

// ─── Step 2: Determine AREA OF PRACTICE from title, category, and position ───
function determineAOP(title, category, position) {
  const t = title.toLowerCase();
  const c = (category || '').toLowerCase();

  // Title "urgent care" always wins
  if (/urgent care/.test(t)) return 'Urgent Care';
  if (/urgent care/.test(c)) return 'Urgent Care';

  // Partner Veterinarian → always Urgent Care
  if (position === 'Partner Veterinarian') return 'Urgent Care';

  // Specialty Care positions (from CorrectJobNames.txt)
  const SPECIALTY_POSITIONS = new Set([
    'Anesthesiologist', 'Cardiologist', 'Credentialed Veterinary Technician Specialist',
    'DABVP Specialist', 'Dental Specialist', 'Dermatologist', 'ECC Specialist',
    'Internal Medicine Specialist', 'Medical Oncologist', 'Neurologist & Neurosurgeon',
    'Ophthalmologist', 'Radiation Oncologist', 'Radiologist', 'Surgeon'
  ]);
  if (SPECIALTY_POSITIONS.has(position)) return 'Specialty Care';

  // Medical Director can be General Practice or Specialty — default GP
  if (position === 'Medical Director') return 'General Practice Care';

  // Lead Veterinarian → General Practice
  if (position === 'Lead Veterinarian') return 'General Practice Care';

  // Associate Veterinarian → Emergency or Urgent or General Practice
  // Check category first (most reliable signal for Encore)
  const EMERGENCY_CATS = ['emergency', 'emergency medicine', 'er vet', 'er veterinarian'];
  for (const ec of EMERGENCY_CATS) {
    if (c.includes(ec) && !c.includes('urgent')) return 'Emergency Care';
  }
  // Then title
  if (/\bemergency\b/.test(t) && !/urgent/.test(t)) return 'Emergency Care';
  if (/\b(urgent)\b/.test(t)) return 'Urgent Care';

  // Default
  return 'General Practice Care';
}

// ─── Step 3: Validate that position is allowed for the AOP ───────────────────
function validatePositionForAOP(position, aop) {
  if (!position) return '';

  const VALID = {
    'Emergency Care':      ['Associate Veterinarian'],
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

  const allowed = VALID[aop] || [];
  if (allowed.includes(position)) return position;

  // Medical Director is valid in both GP and Specialty
  if (position === 'Medical Director') return position;

  // If position is in any AOP's list, keep it (AOP might need adjustment)
  const allValid = new Set(Object.values(VALID).flat());
  if (allValid.has(position)) return position;

  // Fallback: default clinical position for known AOPs
  if (aop === 'Emergency Care' || aop === 'General Practice Care') return 'Associate Veterinarian';
  if (aop === 'Urgent Care') return 'Associate Veterinarian';
  return position;
}

// ─── Public entry point: resolve position + AOP from title + category ─────────
function resolvePositionAndAOP(jobTitle, jobCategory) {
  const base = extractBaseRole(jobTitle);
  const position = matchPositionFromTitle(base, jobCategory);
  if (!position) return { position: '', areaOfPractice: '' };

  const aop      = determineAOP(jobTitle, jobCategory, position);
  const validPos = validatePositionForAOP(position, aop);

  return { position: validPos, areaOfPractice: aop };
}

// ─── Normalize employment_type string ────────────────────────────────────────
function normalizeJobType(raw) {
  const t = (raw || '').toLowerCase();
  const hasPart = /part[\s\-]?time/.test(t);
  const hasFull = /full[\s\-]?time/.test(t);
  if (hasPart && !hasFull) return 'Part Time';
  return 'Full Time';
}

// ============================================================
//  DETAIL PAGE EXTRACTION
//  Reads window.jobDescriptionConfig.job on the Angular SPA.
//  There is NO iCIMS iframe on careers.encorevet.com detail pages.
// ============================================================

function extractJobDetailsFromPage() {
  const config = window.jobDescriptionConfig;
  if (!config || !config.job) return null;

  const job    = config.job;
  const result = { _hasData: true };

  // Employment type (raw — normalized in background)
  result.jobTypeRaw = job.employment_type || (Array.isArray(job.tags1) && job.tags1[0]) || '';

  // Location — full structured data from the iCIMS API
  result.postalCode    = job.postal_code    || '';
  result.city          = job.city           || '';
  result.state         = job.state          || '';   // Full name e.g. "Ohio"
  result.streetAddress = job.street_address || '';
  result.hospitalName  = job.location_name  || '';

  // Category from API (e.g. "Credentialed Veterinary Technician")
  if (Array.isArray(job.categories) && job.categories.length > 0) {
    result.category = job.categories.map(c => c.name).join(', ');
  } else if (Array.isArray(job.category) && job.category.length > 0) {
    result.category = job.category.map(s => s.trim()).join(', ');
  } else {
    result.category = '';
  }

  // Title from API (base for position matching — same as listing card but more reliable)
  result.jobTitle = job.title || '';

  // ── Salary ──────────────────────────────────────────────────────────────────
  // Primary source: job.description raw HTML from window.jobDescriptionConfig.
  //   Always available immediately — no Angular rendering dependency.
  //   Format in raw HTML: "Pay Range<br><br>USD $25.00 - USD $30.00 /Hr."
  //
  // Strategy: work directly on the raw HTML string — no inner function needed.
  // This avoids any issues with nested function declarations being serialized
  // by chrome.scripting.executeScript's func.toString() serialization.

  var rawDesc = job.description || '';

  // ── Shared dollar-range extractor ────────────────────────────────────────
  // Pulls the shortest clean "$X - $Y/Unit" pattern from any string.
  // Handles:  "USD $25.00 - USD $30.00 /Hr."
  //           "The pay is $17 - $19 per hour, based on experience."
  //           "$80,000 - $120,000/Yr."
  //           "$17 to $19/Hr"
  // Returns '' if no valid range (or single value) found.
  var DOLLAR_RX = /\$\s*[\d,]+(?:\.\d+)?\s*(?:[-–]|to|and)\s*\$?\s*[\d,]+(?:\.\d+)?(?:\s*(?:per\s*(?:hour|hr\.?|year|yr\.?)|\/\s*(?:hour|hr\.?|year|yr\.?)))?/i;

  function extractDollarRange(s) {
    if (!s || !s.includes('$')) return '';
    // First: clean standard "USD $X - USD $Y /Unit" format
    var clean = s.trim()
      .replace(/USD\s+/gi, '')
      .replace(/\.00\b/g, '')
      .replace(/\s*\/\s*/g, '/')
      .replace(/\s+per\s+hour/gi, '/Hr.')
      .replace(/\s+per\s+yr\.?/gi, '/Yr.')
      .replace(/\s+per\s+year/gi, '/Yr.')
      .trim();
    // If result is short and clean — use it directly
    if (clean.length <= 30 && clean.match(/^\$[\d,]+/)) return clean;
    // Otherwise extract just the dollar range from wherever it appears in the string
    var m = s.match(DOLLAR_RX);
    if (!m) {
      // Single value fallback: "$25/Hr" or "$25.00/Hr"
      var single = s.match(/\$\s*[\d,]+(?:\.\d+)?(?:\s*(?:\/|-)\s*(?:hr\.?|hour|yr\.?|year))?/i);
      return single ? single[0].trim().replace(/\.00\b/g, '').replace(/\s*\/\s*/g, '/') : '';
    }
    var rangeStr = m[0].trim()
      .replace(/USD\s+/gi, '')
      .replace(/\.00\b/g, '')
      .replace(/\s+to\s+/gi, ' - ')
      .replace(/\s+and\s+/gi, ' - ')
      .replace(/\s*\/\s*/g, '/')
      .replace(/\s+per\s+hour/gi, '/Hr.')
      .replace(/\s+per\s+yr\.?/gi, '/Yr.')
      .replace(/\s+per\s+year/gi, '/Yr.')
      .trim();
    return rangeStr;
  }

  // Strategy 1: direct regex on raw HTML — most reliable.
  // Matches "Pay Range" followed by one or more <br> tags, then grabs the salary line.
  // Cap at 120 chars to avoid capturing entire paragraphs.
  var htmlPayMatch = rawDesc.match(/Pay\s+Range\s*(?:<br\s*\/?>)+\s*([^<\r\n"]{1,120})/i);
  if (htmlPayMatch && htmlPayMatch[1]) {
    var s1 = extractDollarRange(htmlPayMatch[1]);
    if (s1) result.salary = s1;
  }

  // Strategy 2: inline HTML→text conversion, then text search.
  if (!result.salary) {
    var descText = rawDesc
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&[a-z0-9#]+;/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // If job.description was empty, fall back to rendered DOM element
    if (!descText) {
      var descEl = document.querySelector('#description-body, article.main-description-body');
      descText = descEl ? (descEl.innerText || '') : '';
    }

    // Strategy 2a: "Pay Range" section — capture the full line, then extract dollar range
    var payMatch = descText.match(/Pay\s+Range[\r\n\s]+([^\r\n]+)/i);
    if (payMatch && payMatch[1] && payMatch[1].includes('$')) {
      var s2a = extractDollarRange(payMatch[1]);
      if (s2a) result.salary = s2a;
    }

    // Strategy 2b: any clean "$ - $" range anywhere in the text
    if (!result.salary) {
      var rangeMatch = descText.match(/\$[\d,]+(?:\.\d+)?\s*[-–]\s*\$[\d,]+(?:\.\d+)?(?:\/\w+\.?)?/);
      if (rangeMatch) {
        result.salary = rangeMatch[0].trim().replace(/\.00\b/g, '').replace(/\s*\/\s*/g, '/');
      }
    }

    // Strategy 2c: "$Xk – $Yk" shorthand annual format
    if (!result.salary) {
      var kMatch = descText.match(/\$\d+(?:\.\d+)?k\s*[-–]\s*\$?\d+(?:\.\d+)?k(?:\/\w+\.?)?/i);
      if (kMatch) result.salary = kMatch[0].trim();
    }
  }

  return result;
}

// ============================================================
//  MESSAGE HANDLERS
// ============================================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Background received message:", request.action);

  if (request.action === "scrapeProgress") {
    chrome.runtime.sendMessage(request).catch(() => {});
  }

  // ── Fetch job details from Angular SPA detail page ────────────────────────
  if (request.action === 'fetchJobDetails') {
    const { url, jobIndex, jobTitle, jobCategory } = request;
    let alreadyResolved = false;

    function finish(details) {
      if (alreadyResolved) return;
      alreadyResolved = true;
      chrome.runtime.sendMessage({ action: 'detailsFetched', details, jobIndex }).catch(() => {});
    }

    chrome.tabs.create({ url, active: false }, (tab) => {
      if (!tab) { finish({}); return; }

      chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
        if (tabId !== tab.id || info.status !== 'complete') return;
        chrome.tabs.onUpdated.removeListener(listener);

        // Race-condition guard: verify tab still exists
        chrome.tabs.get(tab.id, (t) => {
          if (chrome.runtime.lastError || !t) { finish({}); return; }

          let attempts = 0;

          function tryExtract() {
            chrome.scripting.executeScript({
              target: { tabId: tab.id }, // Main frame only — no iCIMS iframe on Angular SPA
              world: 'MAIN',             // MUST be MAIN world — window.jobDescriptionConfig is a page variable
              func: extractJobDetailsFromPage
            }).then((results) => {
              const result = results && results[0] && results[0].result;
              const hasData = result && result._hasData;

              if (hasData || attempts >= 5) {
                const raw = hasData ? result : {};

                // Normalize job type
                raw.jobType = normalizeJobType(raw.jobTypeRaw || '');

                // Position + AOP: prefer API title/category over listing card values,
                // but fall back to listing card if API title is unavailable.
                const titleForMatching    = raw.jobTitle    || jobTitle    || '';
                const categoryForMatching = raw.category    || jobCategory || '';

                const { position, areaOfPractice } = resolvePositionAndAOP(
                  titleForMatching,
                  categoryForMatching
                );
                raw.position       = position;
                raw.areaOfPractice = areaOfPractice;

                console.log(
                  `[Encore] ${titleForMatching} → pos="${position}", aop="${areaOfPractice}"`,
                  `| cat="${categoryForMatching}" | salary="${raw.salary || 'NOT FOUND'}"`
                );

                chrome.tabs.remove(tab.id).catch(() => {});
                finish(raw);
              } else {
                attempts++;
                setTimeout(tryExtract, 2500);
              }
            }).catch(() => {
              if (attempts >= 5) {
                chrome.tabs.remove(tab.id).catch(() => {});
                finish({});
              } else {
                attempts++;
                setTimeout(tryExtract, 2500);
              }
            });
          }

          // Wait for Angular app to bootstrap and populate jobDescriptionConfig
          setTimeout(tryExtract, 4000);
        });
      });
    });

    return true;
  }

  // ── Fetch phone via Google Maps ───────────────────────────────────────────
  if (request.action === 'fetchAddress') {
    const { jobIndex, searchQuery } = request;
    const mapsUrl = 'https://www.google.com/maps/search/' + encodeURIComponent(searchQuery);
    let mapsTabId = null;
    let resolved  = false;

    function finishAddress(phone) {
      if (resolved) return;
      resolved = true;
      if (mapsTabId) chrome.tabs.remove(mapsTabId).catch(() => {});
      chrome.runtime.sendMessage({ action: 'addressFetched', jobIndex, phone }).catch(() => {});
    }

    const phoneListener = (msg) => {
      if (msg.action === 'mapsPhoneResult') {
        chrome.runtime.onMessage.removeListener(phoneListener);
        finishAddress(msg.phone || '');
      }
    };
    chrome.runtime.onMessage.addListener(phoneListener);
    setTimeout(() => {
      chrome.runtime.onMessage.removeListener(phoneListener);
      finishAddress('');
    }, 30000);

    chrome.tabs.create({ url: mapsUrl, active: false }, (tab) => {
      if (!tab) { finishAddress(''); return; }
      mapsTabId = tab.id;

      chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
        if (tabId !== mapsTabId || info.status !== 'complete') return;
        chrome.tabs.onUpdated.removeListener(listener);

        setTimeout(() => {
          chrome.scripting.executeScript({
            target: { tabId: mapsTabId },
            files: ['google-maps-scraper.js']
          }).catch(() => finishAddress(''));
        }, 2000);
      });
    });

    return true;
  }

  // ── Scrape job description text (legacy / manual re-fetch) ────────────────
  if (request.action === 'scrapeJobDescription') {
    const { tabId, jobIndex } = request;

    chrome.tabs.onUpdated.addListener(function listener(updatedTabId, info) {
      if (updatedTabId !== tabId || info.status !== 'complete') return;
      chrome.tabs.onUpdated.removeListener(listener);

      chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const descSelectors = [
            '#description-body',
            'article.main-description-body',
            '.job-description',
            '.job-details',
            '[itemprop="description"]',
            '.iCIMS_JobContent',
            '.job-content'
          ];
          let description = '';
          for (const sel of descSelectors) {
            const el = document.querySelector(sel);
            if (el) { description = el.innerText.trim(); break; }
          }
          return { description };
        }
      }).then((results) => {
        const data = results[0]?.result || {};
        chrome.storage.local.get(['encoreJobs'], (res) => {
          const jobs = res.encoreJobs || [];
          if (jobs[jobIndex]) {
            jobs[jobIndex].description = data.description || '';
            chrome.storage.local.set({ encoreJobs: jobs }, () => {
              chrome.tabs.remove(tabId);
              chrome.runtime.sendMessage({
                action: 'descriptionSaved',
                jobIndex,
                success: true
              }).catch(() => {});
            });
          }
        });
      }).catch(() => {
        chrome.tabs.remove(tabId).catch(() => {});
        chrome.runtime.sendMessage({
          action: 'descriptionSaved',
          jobIndex,
          success: false
        }).catch(() => {});
      });
    });

    return true;
  }

  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("Encore Vet Job Scraper installed");
});
