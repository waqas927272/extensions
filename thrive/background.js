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
                var result = {
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

                // ── Strip HTML tags ──────────────────────────────────────────
                function stripHtml(html) {
                  var t = document.createElement('div');
                  t.innerHTML = html;
                  return t.textContent || t.innerText || '';
                }

                // ── Convert full US state name → 2-letter abbreviation ───────
                // Thrive's JSON-LD uses full names like "Florida" not "FL"
                function stateToAbbrev(name) {
                  if (!name || name.length === 2) return name; // already abbrev
                  var map = {
                    'alabama':'AL','alaska':'AK','arizona':'AZ','arkansas':'AR',
                    'california':'CA','colorado':'CO','connecticut':'CT','delaware':'DE',
                    'florida':'FL','georgia':'GA','hawaii':'HI','idaho':'ID',
                    'illinois':'IL','indiana':'IN','iowa':'IA','kansas':'KS',
                    'kentucky':'KY','louisiana':'LA','maine':'ME','maryland':'MD',
                    'massachusetts':'MA','michigan':'MI','minnesota':'MN','mississippi':'MS',
                    'missouri':'MO','montana':'MT','nebraska':'NE','nevada':'NV',
                    'new hampshire':'NH','new jersey':'NJ','new mexico':'NM','new york':'NY',
                    'north carolina':'NC','north dakota':'ND','ohio':'OH','oklahoma':'OK',
                    'oregon':'OR','pennsylvania':'PA','rhode island':'RI','south carolina':'SC',
                    'south dakota':'SD','tennessee':'TN','texas':'TX','utah':'UT',
                    'vermont':'VT','virginia':'VA','washington':'WA','west virginia':'WV',
                    'wisconsin':'WI','wyoming':'WY','district of columbia':'DC'
                  };
                  return map[name.toLowerCase().trim()] || name;
                }

                // ── Extract a clean salary value from text ───────────────────
                function extractSalary(text) {
                  if (!text) return '';
                  var patterns = [
                    // Range with unit: $180,000 - $250,000 per year / $22 - $36/hr
                    /\$[\d,]+(?:\.\d+)?\s*[-–]\s*\$[\d,]+(?:\.\d+)?\s*(?:\/?(?:per\s+)?(?:hour|hr\.?|year|yr\.?|annually))?/i,
                    // k-range: $180k - $250k
                    /\$[\d,]+k\s*[-–]\s*\$?[\d,]+k/i,
                    // "starting at $180K/year" or "starting at $180,000/year"
                    /(?:starting\s+(?:at|pay)|begins?\s+at|from)[:\s]+\$[\d,]+[kK]?\s*(?:\/\s*(?:year|yr|hour|hr))?/i,
                    // $180K/year or $180k per year
                    /\$[\d,]+[kK]\s*(?:\/\s*(?:year|yr|hour|hr)|per\s+(?:year|yr|hour|hr))/i,
                    // $180,000/year or $22/hr
                    /\$[\d,]+(?:,\d{3})*(?:\.\d+)?\s*(?:\/\s*(?:year|yr|hour|hr)|per\s+(?:year|yr|hour|hr)|an?\s+(?:hour|hr))/i,
                    // salary/pay/compensation line
                    /(?:salary|pay|compensation)\s+range[^.\n]{0,10}?\$[\d,]+[kK]?[^.\n]{0,60}/i,
                    /(?:salary|pay|compensation)[:\s]+\$[\d,]+[kK]?[^.\n]{0,80}/i,
                    // PROSAL or production-based range
                    /PROSAL[^.\n]{0,60}?\$[\d,]+[kK]?[^.\n]{0,60}/i,
                    // bare $XK
                    /\$[\d,]+[kK]\+?/i,
                    // plain range: $180,000 - $250,000
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

                // ── Area of Practice keyword map ─────────────────────────────
                // Checked last→first so Specialty Care (most specific) wins.
                var areaOfPracticeMap = [
                  { area: 'General Practice Care', keywords: [
                      'medical director', 'veterinarian medical director', 'associate veterinarian',
                      'gp vet', 'quick care veterinarian', 'dvm', 'vmd',
                      'relief veterinarian', 'relief dvm', 'locum veterinarian', 'veterinarian'
                  ]},
                  { area: 'Emergency Care', keywords: [
                      'emergency veterinarian', 'er vet', 'er veterinarian', 'er dvm',
                      'relief emergency veterinarian', 'relief emergency vet', 'emergency vet'
                  ]},
                  { area: 'Urgent Care', keywords: [
                      'urgent care veterinarian', 'urgent care vet', 'urgent veterinarian'
                  ]},
                  { area: 'General Practice Care / Emergency Care / Urgent Care', keywords: [
                      'equine veterinarian', 'equine vet', 'bovine veterinarian', 'large animal',
                      'equine dvm', 'avian veterinarian', 'exotics veterinarian',
                      'avian vet', 'exotics vet', 'associate exotics veterinarian',
                      'avian & exotics', 'equine/bovine'
                  ]},
                  { area: 'Specialty Care', keywords: [
                      'criticalist', 'dacvecc', 'board certified criticalist', 'residency trained criticalist',
                      'emergency & critical care', 'critical care', 'ecc',
                      'medical oncologist', 'oncologist', 'oncology',
                      'dacvim', 'acvim', 'medonc', 'radiation oncologist', 'dacvr-ro', 'radonc',
                      'internal medicine specialist', 'internal medicine', 'internist', 'veterinary internist',
                      'saim', 'small animal internal medicine',
                      'neurologist', 'neurosurgeon', 'veterinary neurologist', 'neurology',
                      'cardiologist', 'veterinary cardiologist', 'small animal cardiologist', 'cardiology',
                      'dentist', 'oral surgeon', 'dentist & oral surgeon', 'davdc', 'dental', 'dentistry',
                      'dermatologist', 'veterinary dermatologist', 'dacvd', 'acvd', 'dermatology',
                      'surgeon', 'veterinary surgery', 'dacvs', 'acvs', 'small animal surgeon',
                      'surgery', 'surgical', 'soft tissue', 'hard tissue',
                      'radiologist', 'veterinary radiologist', 'diagnostic imaging specialist', 'dacvr', 'acvr', 'radiology',
                      'ophthalmologist', 'veterinary ophthalmologist', 'dacvo', 'acvo', 'ophthalmology',
                      'anesthesiologist', 'veterinary anesthesiologist', 'dacvaa', 'acvaa', 'anesthesia',
                      'theriogenologist', 'veterinary theriogenologist', 'dact', 'theriogenology',
                      'rehabilitation therapist', 'ccrt', 'canine rehabilitation', 'rehabilitation',
                      'veterinary technician specialist', 'vts',
                      'residency trained', 'board certified', 'veterinary specialist', 'specialty doctor',
                      'specialty', 'specialist'
                  ]}
                ];

                // Returns AOP from a job title — uses keyword map + direct department detection
                function lookupAreaOfPractice(titleText) {
                  if (!titleText) return '';
                  var lower = titleText.toLowerCase();
                  // Specialty Care → General Practice (most-specific checked first, map is reversed)
                  for (var i = areaOfPracticeMap.length - 1; i >= 0; i--) {
                    for (var j = 0; j < areaOfPracticeMap[i].keywords.length; j++) {
                      if (lower.includes(areaOfPracticeMap[i].keywords[j])) {
                        return areaOfPracticeMap[i].area;
                      }
                    }
                  }
                  // Broader fallback patterns not in the map
                  if (lower.includes('emergency') || /\becc\b/.test(lower)) return 'Emergency Care';
                  if (lower.includes('urgent care')) return 'Urgent Care';
                  if (lower.includes('equine') || lower.includes('bovine') || lower.includes('large animal')) return 'General Practice Care / Emergency Care / Urgent Care';
                  if (lower.includes('avian') || lower.includes('exotics')) return 'General Practice Care / Emergency Care / Urgent Care';
                  return '';   // caller will try description fallback
                }

                // Scan description text broadly for practice-type clues.
                // Used when title-based lookup returns ''.
                function lookupAOPFromDescription(text) {
                  if (!text) return 'General Practice Care';
                  var t = text.toLowerCase();
                  // Check specialty first (most specific)
                  var specWords = ['criticalist','neurology','cardiology','oncology','dermatology',
                    'ophthalmology','anesthesia','internal medicine','radiology','diagnostic imaging',
                    'surgery','surgical','rehabilitation','specialty','specialist','soft tissue'];
                  for (var i = 0; i < specWords.length; i++) {
                    if (t.includes(specWords[i])) return 'Specialty Care';
                  }
                  if (t.includes('critical care') || /\becc\b/.test(t)) return 'Emergency Care';
                  if (t.includes('emergency')) return 'Emergency Care';
                  if (t.includes('urgent care')) return 'Urgent Care';
                  // Default for Thrive (primarily GP company)
                  return 'General Practice Care';
                }

                // ── Map raw job title → canonical position name ───────────────
                // Handles DVMs, technicians, assistants, and all support roles.
                function lookupPosition(title) {
                  if (!title) return '';
                  var t = title.toLowerCase();

                  // ── Helper: extract dept from dash/hyphen suffix ─────────────
                  // e.g. "Veterinary Technician - Cardiology" → dept = "cardiology"
                  //      "Veterinary Assistant-Critical Care"  → dept = "critical care"
                  var deptSuffix = '';
                  var dashIdx = t.search(/\s*[-–]\s*/);
                  if (dashIdx > 0) deptSuffix = t.substring(dashIdx).replace(/^[-–\s]+/, '').trim();

                  // ── Assistant roles → look at dept suffix first ───────────────
                  // "Veterinary Assistant", "Veterinary Technician Assistant", "Office Assistant"
                  // User rule: veterinary assistant = Associate Veterinarian
                  var isAssistant = /\bassistant\b/.test(t) && !t.includes('veterinary technician - ') && !t.includes('veterinary assistant-');
                  // Dept-specific assistant (e.g. "Veterinary Assistant-Critical Care")
                  var isDeptAssistant = t.includes('assistant') && deptSuffix;
                  if (isDeptAssistant) {
                    var d = deptSuffix;
                    if (d.includes('critical care') || /\becc\b/.test(d) || d.includes('criticalist')) return 'ECC Specialist';
                    if (d.includes('emergency')) return 'Associate Veterinarian';
                    if (d.includes('anesthesia')) return 'Anesthesiologist';
                    if (d.includes('dental') || d.includes('dentistry')) return 'Dental Specialist';
                    if (d.includes('oncolog') && d.includes('radiation')) return 'Radiation Oncologist';
                    if (d.includes('oncolog') && !d.includes('radiation')) return 'Medical Oncologist';
                    if (d.includes('cardiolog') || d.includes('cardiology')) return 'Cardiologist';
                    if (d.includes('neurolog') || d.includes('neurosurg')) return 'Neurologist & Neurosurgeon';
                    if (d.includes('dermatolog')) return 'Dermatologist';
                    if (d.includes('ophthalmolog')) return 'Ophthalmologist';
                    if (d.includes('surgery') || d.includes('surgical') || d.includes('soft tissue')) return 'Surgeon';
                    if (d.includes('radiolog') || d.includes('diagnostic imaging')) return 'Radiologist';
                    if (d.includes('internal medicine')) return 'Internal Medicine Specialist';
                    return 'Associate Veterinarian';
                  }
                  if (isAssistant) return 'Associate Veterinarian';

                  // ── DVM Leadership ────────────────────────────────────────────
                  if (t.includes('medical director')) return 'Medical Director';
                  if (t.includes('lead veterinarian') || t.includes('lead vet')) return 'Lead Veterinarian';

                  // ── ECC / Criticalist ─────────────────────────────────────────
                  if (t.includes('criticalist') || t.includes('dacvecc') || /\becc\b/.test(t) ||
                      (t.includes('emergency') && t.includes('critical care'))) return 'ECC Specialist';

                  // ── Emergency DVM ─────────────────────────────────────────────
                  if (t.includes('emergency veterinarian') || t.includes('emergency vet') ||
                      /\ber\s+vet\b/.test(t) || /\ber\s+veterinarian\b/.test(t) ||
                      /\ber\s+dvm\b/.test(t)) return 'Associate Veterinarian';

                  // ── Urgent Care DVM ───────────────────────────────────────────
                  if (t.includes('urgent care veterinarian') || t.includes('urgent care vet')) return 'Associate Veterinarian';

                  // ── Specialty DVM positions ───────────────────────────────────
                  if (t.includes('neurologist') || t.includes('neurosurgeon') ||
                      (t.includes('neurolog') && (t.includes('dvm') || t.includes('veterinarian') || t.includes('doctor')))) return 'Neurologist & Neurosurgeon';
                  if (t.includes('dermatologist') ||
                      (t.includes('dermatolog') && (t.includes('dvm') || t.includes('veterinarian')))) return 'Dermatologist';
                  if (t.includes('cardiologist') ||
                      (t.includes('cardiolog') && (t.includes('dvm') || t.includes('veterinarian')))) return 'Cardiologist';
                  if ((t.includes('oncologist') || t.includes('oncolog')) && t.includes('radiation')) return 'Radiation Oncologist';
                  if (t.includes('oncologist') || t.includes('medical oncologist') || t.includes('oncolog')) return 'Medical Oncologist';
                  if (t.includes('radiologist') || t.includes('diagnostic imaging') ||
                      (t.includes('radiolog') && (t.includes('dvm') || t.includes('veterinarian')))) return 'Radiologist';
                  if (t.includes('ophthalmologist') ||
                      (t.includes('ophthalmolog') && (t.includes('dvm') || t.includes('veterinarian')))) return 'Ophthalmologist';
                  if (t.includes('anesthesiologist') ||
                      (t.includes('anesthesiolog') && (t.includes('dvm') || t.includes('veterinarian')))) return 'Anesthesiologist';
                  if (t.includes('theriogenologist') ||
                      (t.includes('theriogenolog') && (t.includes('dvm') || t.includes('veterinarian')))) return 'Theriogenologist';
                  if (t.includes('internist') ||
                      (t.includes('internal medicine') && (t.includes('dvm') || t.includes('veterinarian') || t.includes('specialist')))) return 'Internal Medicine Specialist';
                  if (t.includes('dabvp')) return 'DABVP Specialist';
                  if ((t.includes('dental') || t.includes('dentist')) &&
                      !t.includes('assistant') && !t.includes('technician')) return 'Dental Specialist';
                  if ((t.includes('surgeon') || t.includes('veterinary surgery') || t.includes('veterinary surgeon')) &&
                      !t.includes('neurosurgeon') && !t.includes('dental')) return 'Surgeon';

                  // ── Large/exotic animal DVM ───────────────────────────────────
                  if (t.includes('equine') || t.includes('bovine') || t.includes('large animal')) return 'Equine/Bovine Veterinarian/Large Animal';
                  if (t.includes('avian') || t.includes('exotics')) return 'Avian & Exotics Veterinarian / Associate Exotics';

                  // ── Boarding / pet resort / hotel / kennel roles ─────────────
                  // These are NOT veterinary clinical positions — return empty so
                  // the field is left blank rather than saving a wrong position.
                  // Must run BEFORE the tech check so "Kennel Technician" is caught here.
                  var isBoardingRole =
                    t.includes('boarding') || t.includes('resort') ||
                    t.includes('pet hotel') || t.includes('kennel') ||
                    (t.includes('attendant') && !t.includes('veterinary'));
                  if (isBoardingRole) return '';

                  // ── Technician roles ──────────────────────────────────────────
                  // Includes "Certified Veterinary Technician - X", "Registered Veterinary Technician",
                  // "Veterinary Technician Supervisor - Soft Tissue", etc.
                  var isTechRole = /\b(technician|technologist|vet\s+tech|rvt|cvt|lvt|nurse)\b/.test(t) &&
                                   !t.includes('technician specialist') && !/\bvts\b/.test(t) &&
                                   !t.includes('assistant');   // "Vet Tech Assistant" = assistant, not tech
                  if (isTechRole) {
                    // Check dept suffix first, then title keywords
                    var depts = [deptSuffix, t];
                    for (var di = 0; di < depts.length; di++) {
                      var d = depts[di];
                      if (!d) continue;
                      if (d.includes('anesthesia') || d.includes('anesthesiolog')) return 'Anesthesiologist';
                      if (d.includes('dental') || d.includes('dentistry')) return 'Dental Specialist';
                      if (d.includes('critical care') || /\becc\b/.test(d) || d.includes('criticalist')) return 'ECC Specialist';
                      if (d.includes('radiation oncolog') || (d.includes('radiation') && d.includes('oncol'))) return 'Radiation Oncologist';
                      if (d.includes('oncolog') && !d.includes('radiation')) return 'Medical Oncologist';
                      if (d.includes('cardiolog') || d.includes('cardiology')) return 'Cardiologist';
                      if (d.includes('neurolog') || d.includes('neurosurg')) return 'Neurologist & Neurosurgeon';
                      if (d.includes('dermatolog')) return 'Dermatologist';
                      if (d.includes('ophthalmolog')) return 'Ophthalmologist';
                      if ((d.includes('surgery') || d.includes('surgical') || d.includes('soft tissue') || d.includes('hard tissue') || d.includes('surgeon')) && !d.includes('neurosurg')) return 'Surgeon';
                      if (d.includes('radiolog') || d.includes('diagnostic imaging')) return 'Radiologist';
                      if (d.includes('internal medicine')) return 'Internal Medicine Specialist';
                      if (d.includes('rehabilitation') || d.includes('rehab')) return 'Credentialed Veterinary Technician Specialist';
                    }
                    // Specialty / float / equine
                    if (t.includes('equine')) return 'Equine/Bovine Veterinarian/Large Animal';
                    if (t.includes('specialty') || t.includes('specialist') || t.includes('float')) return 'Credentialed Veterinary Technician Specialist';
                    // Generic tech (Registered, Certified, Lead supervisor, etc.)
                    return 'Credentialed Veterinary Technician Specialist';
                  }

                  // ── VTS designation ───────────────────────────────────────────
                  if (t.includes('technician specialist') || /\bvts\b/.test(t)) return 'Credentialed Veterinary Technician Specialist';

                  // ── Non-clinical / support / admin roles at vet practices ──────
                  // These are support staff, not clinical veterinary positions — return blank.
                  var isNonClinical =
                    t.includes('client service') || t.includes('service representative') ||
                    t.includes('receptionist') ||
                    t.includes('groomer') || t.includes('grooming') ||
                    t.includes('practice manager') || t.includes('hospital manager') ||
                    t.includes('office manager') || t.includes('office assistant') ||
                    t.includes('administrator') || t.includes('billing') ||
                    t.includes('coordinator') || t.includes('customer service') ||
                    t.includes('front desk') || t.includes('inventory') ||
                    t.includes('housekeeper') || t.includes('janitorial') ||
                    t.includes('marketing') || t.includes('relations manager') ||
                    t.includes('regional manager');
                  if (isNonClinical) return '';

                  // ── Generic DVM / associate / relief / locum ──────────────────
                  if (t.includes('veterinarian') || t.includes('dvm') || t.includes('vmd') ||
                      t.includes('associate') || t.includes('relief') || t.includes('locum')) return 'Associate Veterinarian';

                  // ── No match found — leave position blank ─────────────────────
                  // Only positions confirmed in CorrectJobNames.txt should be saved.
                  return '';
                }

                // ═══════════════════════════════════════════════════════════
                // SOURCE 1: JSON-LD structured data
                // ═══════════════════════════════════════════════════════════
                var rawTitle = '';   // save raw title for position/AOP lookup

                var ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
                for (var si = 0; si < ldScripts.length; si++) {
                  try {
                    var ld = JSON.parse(ldScripts[si].textContent);
                    if (ld['@type'] === 'JobPosting') {
                      // Raw title → used for lookups below
                      rawTitle = ld.title || '';

                      // Employment type
                      if (ld.employmentType) result.jobType = ld.employmentType;

                      // Address — note: Thrive uses full state names ("Florida"), convert to abbrev
                      if (ld.jobLocation && ld.jobLocation.address) {
                        var addr = ld.jobLocation.address;
                        result.streetAddress = addr.streetAddress || '';
                        result.city          = addr.addressLocality || '';
                        // Convert "Florida" → "FL"
                        result.state         = stateToAbbrev(addr.addressRegion || '');
                        result.postalCode    = addr.postalCode || '';
                      }

                      // Description — extract hospital name + salary
                      if (ld.description) {
                        var descText = stripHtml(ld.description);

                        // Hospital name: "Thrive Miami is looking..." or "Thrive Pet Healthcare - Falcon is..."
                        // The regex matches "Thrive" + up to 80 chars (non-greedy) before "is looking/hiring/seeking"
                        if (!result.hospitalName) {
                          var hospMatch = descText.match(/(Thrive[^.\r\n]{0,80}?)\s+is\s+(?:looking|hiring|seeking)/i);
                          if (hospMatch) result.hospitalName = hospMatch[1].trim();
                        }

                        // Salary
                        if (!result.salary) result.salary = extractSalary(descText);
                      }

                      break;
                    }
                  } catch (e) { /* try next script tag */ }
                }

                // ═══════════════════════════════════════════════════════════
                // SOURCE 2: DOM — h1 (job title fallback)
                // ═══════════════════════════════════════════════════════════
                if (!rawTitle) {
                  var h1 = document.querySelector('.job-details-inner-js h1') ||
                           document.querySelector('h1');
                  if (h1) rawTitle = h1.textContent.trim();
                }

                // ═══════════════════════════════════════════════════════════
                // SOURCE 3: DOM — .job-details__main p
                // Contains: "[Title] [Hospital Name] Location : City, State, ZIP Time Type : Full-Time"
                // ═══════════════════════════════════════════════════════════
                var infoP = document.querySelector('.job-details__main p');
                if (infoP) {
                  var infoHtml = infoP.innerHTML;
                  var infoText = infoP.textContent || '';

                  // Hospital name: first segment before Location label
                  // Remove the job title (h1 text) from the beginning, then trim
                  if (!result.hospitalName) {
                    var hospPart = infoHtml.split(/<br\s*\/?>/i)[0];
                    if (hospPart) {
                      var hospText = stripHtml(hospPart).trim();
                      // Ignore segments that ARE the job title or start with Location/Time
                      if (hospText &&
                          !hospText.toLowerCase().startsWith('location') &&
                          !hospText.toLowerCase().startsWith('time') &&
                          hospText !== rawTitle) {
                        result.hospitalName = hospText;
                      }
                    }
                  }

                  // Location: "Location : Miami, FL, 33143"
                  // State here is already abbreviated in the DOM
                  var locMatch = infoText.match(/Location\s*:\s*([^,\n]+),\s*([A-Z]{2}),?\s*(\d{5})?/i);
                  if (locMatch) {
                    if (!result.city)       result.city       = locMatch[1].trim();
                    // Prefer the DOM 2-letter state over JSON-LD full name (already converted above)
                    if (locMatch[2])        result.state      = locMatch[2].trim();
                    if (!result.postalCode && locMatch[3]) result.postalCode = locMatch[3].trim();
                  }

                  // Time Type: "Time Type : Full-Time"
                  var timeMatch = infoText.match(/Time\s+Type\s*:\s*(.+)/i);
                  if (timeMatch && !result.jobType) {
                    result.jobType = timeMatch[1].trim();
                  }
                }

                // ═══════════════════════════════════════════════════════════
                // SOURCE 4: DOM description text — salary & hospital fallback
                // ═══════════════════════════════════════════════════════════
                if (!result.salary || !result.hospitalName) {
                  var descEl = document.querySelector('.job-details-inner-js');
                  if (descEl) {
                    var descBodyText = descEl.innerText || '';

                    if (!result.salary) {
                      result.salary = extractSalary(descBodyText);
                    }

                    if (!result.hospitalName) {
                      var hm = descBodyText.match(/(Thrive[^.\r\n]{0,80}?)\s+is\s+(?:looking|hiring|seeking)/i);
                      if (hm) result.hospitalName = hm[1].trim();
                    }
                  }
                }

                // ═══════════════════════════════════════════════════════════
                // SOURCE 5: Derive Position & AOP from the raw job title
                // ═══════════════════════════════════════════════════════════
                if (rawTitle) {
                  result.areaOfPractice = lookupAreaOfPractice(rawTitle);
                  result.position       = lookupPosition(rawTitle);
                }

                // AOP fallback: scan description for broader practice-type clues.
                // If still empty after that, default to General Practice Care
                // (Thrive's primary care type).
                if (!result.areaOfPractice) {
                  var descFallbackEl = document.querySelector('.job-details-inner-js');
                  var descFallbackText = descFallbackEl ? (descFallbackEl.innerText || '') : '';
                  result.areaOfPractice = lookupAOPFromDescription(descFallbackText);
                }

                console.log('[Thrive] details extracted:', JSON.stringify(result));
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

                  // Method 2: .job-details-inner-js container (Talemetry / Thrive pattern)
                  const jobDetailsInner = document.querySelector('.job-details-inner-js');
                  if (jobDetailsInner && jobDetailsInner.innerText.trim().length > 50) {
                    const clone = jobDetailsInner.cloneNode(true);
                    clone.querySelectorAll('button, .btn, [role="button"], .similar-jobs-element-js, .apply-bottom, #apply-top, #refer-top, .social-share, .job-details-share, nav, header, footer').forEach(el => el.remove());
                    const description = clone.innerText.trim();
                    if (description.length > 50) {
                      resolve({ description });
                      return;
                    }
                  }

                  // Method 3: Common description selectors
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
