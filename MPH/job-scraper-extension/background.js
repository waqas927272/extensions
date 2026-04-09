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
                // POSITION & AOP  —  mirrors MedVet / VIPVet canonical logic
                // Valid positions per AOP (from CorrectJobNames.txt):
                //   Emergency Care    : Associate Veterinarian
                //   General Practice  : Associate Veterinarian, Lead Veterinarian, Medical Director
                //   Specialty Care    : Anesthesiologist, Cardiologist, CVTS, DABVP Specialist,
                //                       Dental Specialist, Dermatologist, ECC Specialist,
                //                       Internal Medicine Specialist, Medical Director,
                //                       Medical Oncologist, Neurologist & Neurosurgeon,
                //                       Ophthalmologist, Radiation Oncologist, Radiologist, Surgeon
                //   Urgent Care       : Associate Veterinarian, Partner Veterinarian
                // ════════════════════════════════════════════════════════════

                function isNonClinical(t) {
                  return (
                    t.includes('client service') || t.includes('service representative') ||
                    t.includes('receptionist') || t.includes('kennel') ||
                    t.includes('groomer') || t.includes('grooming') ||
                    t.includes('practice manager') || t.includes('hospital manager') ||
                    t.includes('office manager') || t.includes('administrator') ||
                    t.includes('billing') || t.includes('human resources') ||
                    t.includes('patient care coordinator') || t.includes('client care coordinator') ||
                    t.includes('customer service') || t.includes('front desk') ||
                    t.includes('inventory') || t.includes('housekeeper') ||
                    t.includes('janitorial') || t.includes('externship') ||
                    t.includes('general job application') || t.includes('join our team')
                  );
                }

                // ── Step A: Match position from job title ──────────────────
                function matchPositionFromTitle(title, dept) {
                  const t = title.toLowerCase();
                  const d = (dept || '').toLowerCase();

                  // Technician / nurse roles
                  const isTechRole = /\b(technician|technologist|vet\s+tech|nurse)\b/.test(t) &&
                                     !t.includes('technician specialist') && !t.match(/\bvts\b/);
                  if (isTechRole) {
                    if (t.includes('anesthesia') || t.includes('anesthesiolog')) return 'Anesthesiologist';
                    if (t.includes('dental') || t.includes('dentistry'))         return 'Dental Specialist';
                    if (t.includes('critical care') || t.match(/\becc\b/) || t.includes('criticalist')) return 'ECC Specialist';
                    if (t.includes('radiation oncol') || (t.includes('radiation') && t.includes('oncol'))) return 'Radiation Oncologist';
                    if (t.includes('oncol') && !t.includes('radiation'))         return 'Medical Oncologist';
                    if (t.includes('cardiolog'))                                 return 'Cardiologist';
                    if (t.includes('neurolog') || t.includes('neurosurg'))       return 'Neurologist & Neurosurgeon';
                    if (t.includes('dermatolog'))                                return 'Dermatologist';
                    if (t.includes('ophthalmolog'))                              return 'Ophthalmologist';
                    if ((t.includes('surgery') || t.includes('surgical') || t.includes('surgeon')) && !t.includes('neurosurg')) return 'Surgeon';
                    if (t.includes('radiolog') || t.includes('diagnostic imaging')) return 'Radiologist';
                    if (t.includes('internal medicine'))                         return 'Internal Medicine Specialist';
                    if (t.includes('rehabilitation') || t.includes('emergency') || t.includes('specialist')) {
                      return 'Credentialed Veterinary Technician Specialist';
                    }
                    return 'Credentialed Veterinary Technician Specialist';
                  }

                  // VTS
                  if (t.includes('technician specialist') || t.match(/\bvts\b/)) {
                    return 'Credentialed Veterinary Technician Specialist';
                  }

                  // Leadership (highest priority for DVM roles)
                  if (t.includes('medical director')) return 'Medical Director';
                  if (t.includes('lead veterinarian') || t.includes('lead vet')) return 'Lead Veterinarian';

                  // ECC Specialist — must be before generic "emergency"
                  if (t.includes('criticalist') || t.includes('dacvecc') ||
                      t.match(/\becc\b/) || t.match(/\becc\s+specialist\b/) ||
                      (t.includes('emergency') && t.includes('critical care'))) return 'ECC Specialist';

                  // Specialty DVM roles
                  if (t.includes('neurologist') || t.includes('neurosurgeon') || (t.includes('neurology') && !isTechRole))   return 'Neurologist & Neurosurgeon';
                  if (t.includes('dermatologist') || (t.includes('dermatology') && !isTechRole))                              return 'Dermatologist';
                  if (t.includes('cardiologist') || (t.includes('cardiology') && !isTechRole))                                return 'Cardiologist';
                  if ((t.includes('oncologist') || t.includes('oncology')) && t.includes('radiation'))                        return 'Radiation Oncologist';
                  if (t.includes('oncologist') || (t.includes('oncology') && !isTechRole))                                    return 'Medical Oncologist';
                  if (t.includes('radiologist') || t.includes('diagnostic imaging') || (t.includes('radiology') && !isTechRole)) return 'Radiologist';
                  if (t.includes('ophthalmologist') || (t.includes('ophthalmology') && !isTechRole))                          return 'Ophthalmologist';
                  if (t.includes('anesthesiologist') || (t.includes('anesthesia') && !isTechRole))                            return 'Anesthesiologist';
                  if (t.includes('theriogenologist') || (t.includes('theriogenology') && !isTechRole))                        return 'Theriogenologist';
                  if (t.includes('internist') || (t.includes('internal medicine') && !isTechRole))                            return 'Internal Medicine Specialist';
                  if (t.includes('dabvp'))                                                                                     return 'DABVP Specialist';
                  if ((t.includes('dental') || t.includes('dentist') || t.includes('dentistry')) && !t.includes('assistant')) return 'Dental Specialist';
                  if ((t.includes('surgeon') || t.includes('surgery')) && !t.includes('neurosurgeon') && !t.includes('dental') && !isTechRole) return 'Surgeon';

                  // Specialty credentials in title (DACV*)
                  if (t.includes('dacvim') && (t.includes('oncology') || t.includes('oncologist'))) return 'Medical Oncologist';
                  if (t.includes('dacvr') && (t.includes('radiation') || t.includes('-ro')))        return 'Radiation Oncologist';
                  if (t.includes('dacvim') && (t.includes('neurology') || t.includes('neurosurg'))) return 'Neurologist & Neurosurgeon';
                  if (t.includes('dacvim') && t.includes('cardiology'))  return 'Cardiologist';
                  if (t.includes('dacvim'))                               return 'Internal Medicine Specialist';
                  if (t.includes('davdc') || t.includes('avdc'))          return 'Dental Specialist';
                  if (t.includes('dacvd'))                                return 'Dermatologist';
                  if (t.includes('dacvs') || t.includes('acvs'))          return 'Surgeon';
                  if (t.includes('dacvr'))                                return 'Radiologist';
                  if (t.includes('dacvo'))                                return 'Ophthalmologist';
                  if (t.includes('dacvaa') || t.includes('dacva'))        return 'Anesthesiologist';
                  if (t.includes('dact'))                                 return 'Theriogenologist';

                  // Animal type scope
                  if (t.includes('equine') || t.includes('bovine') || t.includes('large animal')) return 'Equine/Bovine Veterinarian/Large Animal';
                  if (t.includes('avian') || t.includes('exotics')) return 'Avian & Exotics Veterinarian / Associate Exotics';

                  // Other named roles
                  if (t.includes('partner veterinarian')) return 'Partner Veterinarian';

                  // Non-clinical guard — these must NOT inherit a specialist position from dept
                  if (isNonClinical(t)) return '';

                  // Fallback: try dept/category string
                  const fromDept = matchPositionFromDept(d);
                  if (fromDept) return fromDept;

                  return '';
                }

                // ── Step B: Match position from Department field (= MedVet category) ──
                function matchPositionFromDept(dept) {
                  const d = (dept || '').toLowerCase().trim();
                  if (!d) return '';

                  if (d.includes('criticalist') || d === 'ecc' || d.includes('ecc ') || d.includes(' ecc') ||
                      d.includes('emergency and critical care') || d.includes('emergency & critical care')) return 'ECC Specialist';
                  if (d.includes('radiation oncol')) return 'Radiation Oncologist';
                  if (d.includes('medical oncol'))   return 'Medical Oncologist';
                  if (d.includes('oncol') && !d.includes('radiation')) return 'Medical Oncologist';
                  if (d.includes('cardiolog'))        return 'Cardiologist';
                  if (d.includes('neurolog') || d.includes('neurosurg')) return 'Neurologist & Neurosurgeon';
                  if (d.includes('dermatolog'))       return 'Dermatologist';
                  if (d.includes('ophthalmolog') || d.includes('ophtho')) return 'Ophthalmologist';
                  if (d.includes('anesthesiolog') || d === 'anesthesia' || d.includes('anesthesia')) return 'Anesthesiologist';
                  if (d.includes('theriogenolog'))    return 'Theriogenologist';
                  if (d.includes('internal medicine') || d.includes('internist') || d.includes('saim')) return 'Internal Medicine Specialist';
                  if (d.includes('radiolog') || d.includes('diagnostic imaging')) return 'Radiologist';
                  if ((d.includes('surgeon') || d.includes('surgery')) && !d.includes('neurosurg')) return 'Surgeon';
                  if (d.includes('dental') || d.includes('dentistry') || d.includes('davdc')) return 'Dental Specialist';
                  if (d.includes('dabvp'))            return 'DABVP Specialist';
                  if (d.includes('rehabilitation') || d.includes('rehab')) return 'Credentialed Veterinary Technician Specialist';

                  return '';
                }

                // ── Step C: Scan qualifications section for DACV* credentials ──
                function matchPositionFromQualifications(bodyText) {
                  if (!bodyText) return '';
                  // Try to isolate the qualifications / requirements section
                  const lower = bodyText.toLowerCase();
                  const qStart = Math.max(
                    lower.indexOf('qualif'), lower.indexOf('requirement'),
                    lower.indexOf('boarded'), lower.indexOf('board certified'),
                    lower.indexOf('diplomate'), lower.indexOf('residency')
                  );
                  const q = qStart > -1 ? lower.slice(qStart, qStart + 2000) : lower;

                  if (q.includes('dacvecc')) return 'ECC Specialist';
                  if (q.includes('dacvim') && q.includes('oncology')) return 'Medical Oncologist';
                  if (q.includes('dacvr') && (q.includes('radiation') || q.includes('-ro'))) return 'Radiation Oncologist';
                  if (q.includes('dacvim') && (q.includes('neurology') || q.includes('neurosurg'))) return 'Neurologist & Neurosurgeon';
                  if (q.includes('dacvim') && q.includes('cardiology')) return 'Cardiologist';
                  if (q.includes('dacvim')) return 'Internal Medicine Specialist';
                  if (q.includes('davdc') || q.includes('avdc')) return 'Dental Specialist';
                  if (q.includes('dacvd'))  return 'Dermatologist';
                  if (q.includes('dacvs') || q.includes('acvs')) return 'Surgeon';
                  if (q.includes('dacvr'))  return 'Radiologist';
                  if (q.includes('dacvo'))  return 'Ophthalmologist';
                  if (q.includes('dacvaa')) return 'Anesthesiologist';
                  if (q.includes('dact'))   return 'Theriogenologist';
                  if (q.includes('dabvp'))  return 'DABVP Specialist';
                  if (q.includes('criticalist')) return 'ECC Specialist';
                  if (q.includes('internal medicine')) return 'Internal Medicine Specialist';

                  // Board certified / residency trained → specialty, but specialty unclear
                  if (q.includes('board certified') || q.includes('residency trained') ||
                      q.includes('residency-trained') || q.includes('diplomate')) {
                    return '_SPECIALTY_FLAG_';
                  }
                  return '';
                }

                // ── Step D: Validate position is allowed for its AOP (CorrectJobNames.txt) ──
                function validatePositionForAOP(position, aop) {
                  // Special / pass-through positions
                  if (position === 'Equine/Bovine Veterinarian/Large Animal' ||
                      position === 'Avian & Exotics Veterinarian / Associate Exotics' ||
                      position === '_SPECIALTY_FLAG_') return position;

                  const validPositions = {
                    'Emergency Care':       ['Associate Veterinarian'],
                    'General Practice Care':['Associate Veterinarian', 'Lead Veterinarian', 'Medical Director'],
                    'Specialty Care':       ['Anesthesiologist','Cardiologist','Credentialed Veterinary Technician Specialist',
                                             'DABVP Specialist','Dental Specialist','Dermatologist','ECC Specialist',
                                             'Internal Medicine Specialist','Medical Director','Medical Oncologist',
                                             'Neurologist & Neurosurgeon','Ophthalmologist','Radiation Oncologist',
                                             'Radiologist','Surgeon'],
                    'Urgent Care':          ['Associate Veterinarian','Partner Veterinarian']
                  };

                  const aopParts = aop.split('/').map(s => s.trim());
                  for (const part of aopParts) {
                    const allowed = validPositions[part];
                    if (allowed && allowed.includes(position)) return position;
                  }

                  // Medical Director is valid in GP and Specialty regardless
                  if (position === 'Medical Director') return position;

                  // If we matched a known AOP but position isn't in its list → demote
                  const hasKnownAOP = aopParts.some(part => validPositions[part]);
                  if (hasKnownAOP) return 'Associate Veterinarian';

                  // Unknown AOP — keep the position if it's a recognised canonical name
                  const allValid = new Set(Object.values(validPositions).flat());
                  if (allValid.has(position)) return position;
                  return 'Associate Veterinarian';
                }

                // ── Master orchestrator ────────────────────────────────────
                function determinePosition(rawTitle, dept, bodyText) {
                  if (isNonClinical(rawTitle.toLowerCase())) return '';

                  // Step 1: match from title (+ dept as inline fallback)
                  let position = matchPositionFromTitle(rawTitle, dept);

                  // Step 2: if Specialty AOP and no title match, scan qualifications
                  const aop = determineAOP(rawTitle, '', dept, bodyText);
                  if (!position && aop === 'Specialty Care') {
                    const fromQual = matchPositionFromQualifications(bodyText);
                    if (fromQual && fromQual !== '_SPECIALTY_FLAG_') position = fromQual;
                  }

                  // Step 3: if still nothing, try dept mapping directly
                  if (!position) position = matchPositionFromDept(dept);

                  // Step 4: validate position against AOP
                  if (position && position !== '_SPECIALTY_FLAG_' &&
                      position !== 'Equine/Bovine Veterinarian/Large Animal' &&
                      position !== 'Avian & Exotics Veterinarian / Associate Exotics') {
                    position = validatePositionForAOP(position, aop);
                  }

                  // Step 5: Medical Director override
                  if ((!position || position === 'Associate Veterinarian') &&
                      rawTitle.toLowerCase().includes('medical director')) {
                    position = 'Medical Director';
                  }

                  // Step 6: default for any remaining DVM/vet title
                  if (!position || position === '_SPECIALTY_FLAG_') {
                    const t = rawTitle.toLowerCase();
                    if (t.includes('veterinarian') || t.includes('veterinary') ||
                        t.includes('dvm') || t.includes('relief') || t.includes('locum')) {
                      position = 'Associate Veterinarian';
                    }
                  }

                  return position || '';
                }

                // ── Area of Practice ───────────────────────────────────────
                function determineAOP(rawTitle, hospitalName, dept, bodyText) {
                  const t = rawTitle.toLowerCase();
                  const h = (hospitalName || '').toLowerCase();
                  const d = (dept || '').toLowerCase().trim();
                  const b = (bodyText || '').toLowerCase();

                  if (isNonClinical(t)) return '';

                  // STEP 1: Department field (most reliable — mirrors MedVet's category)
                  if (d) {
                    if (d === 'emergency and critical care' || d === 'emergency & critical care' ||
                        d === 'emergency medicine' || d === 'emergency') {
                      // If title signals criticalist → Specialty Care
                      if (t.includes('criticalist') || t.match(/\becc\b/) || t.includes('specialist')) return 'Specialty Care';
                      return 'Emergency Care';
                    }
                    if (d.includes('criticalist') || d === 'ecc' ||
                        d.includes('emergency and critical care specialist') ||
                        d.includes('emergency & critical care specialist')) return 'Specialty Care';
                    if (d.includes('urgent care')) return 'Urgent Care';
                    if (d.includes('gen practice') || d.includes('general practice') || d.includes('general med')) return 'General Practice Care';

                    const specDepts = ['oncol','cardiolog','neurolog','neurosurg','dermatolog',
                      'ophthalmolog','anesthesiolog','anesthesia','internal medicine','saim',
                      'radiolog','diagnostic imaging','surgeon','surgery','dental','dentistry',
                      'davdc','criticalist','critical care','dacvecc','dacvim','dacvs','dacvr',
                      'dacvd','dacvo','dacvaa','dact','dabvp','rehabilitation','sports medicine',
                      'specialist','specialty'];
                    for (const kw of specDepts) {
                      if (d.includes(kw)) return 'Specialty Care';
                    }
                  }

                  // STEP 2: Title keywords
                  if (t.includes('criticalist') || t.match(/\becc\b/) || t.includes('dacvecc') ||
                      (t.includes('emergency') && t.includes('critical care'))) return 'Specialty Care';

                  const specTitleKw = ['oncologist','cardiologist','neurologist','neurosurgeon',
                    'dermatologist','ophthalmologist','anesthesiologist','theriogenologist',
                    'radiologist','internist','criticalist',
                    'oncology','cardiology','neurology','dermatology','ophthalmology',
                    'anesthesia','theriogenology','radiology','diagnostic imaging','rehabilitation'];
                  for (const kw of specTitleKw) {
                    if (t.includes(kw)) return 'Specialty Care';
                  }

                  const specCerts = ['board certified','residency trained','residency-trained','diplomate',
                    'dacvecc','dacvim','dacvr','dacvs','dacvd','dacvo','dacvaa','dact','davdc','dabvp','acvs','acvim'];
                  for (const cert of specCerts) {
                    if (t.includes(cert)) return 'Specialty Care';
                  }

                  if (t.includes('specialist') && !t.includes('technician specialist')) return 'Specialty Care';
                  if (t.match(/\bsurgeon\b/)) return 'Specialty Care';

                  // Surgical keywords in title
                  if ((t.includes('surgery') || t.includes('surgeon')) &&
                      !t.includes('technician') && !t.includes('assistant')) return 'Specialty Care';

                  // Internal medicine / dental in title
                  if (t.includes('internal medicine') || t.includes('internist')) return 'Specialty Care';
                  if ((t.includes('dental') || t.includes('dentist')) && !t.includes('assistant')) return 'Specialty Care';

                  // Emergency Care (non-specialist)
                  if (t.includes('emergency') || t.match(/\ber\s+vet\b/) || t.match(/\ber\s+dvm\b/) ||
                      t.match(/\ber\b/) || t.includes('er vet') || t.includes('er dvm')) return 'Emergency Care';
                  if (h.includes('emergency') || h.includes('critical care')) return 'Emergency Care';

                  // Urgent Care
                  if (t.includes('urgent care') || h.includes('urgent care') || d.includes('urgent care')) return 'Urgent Care';

                  // Equine / Large Animal / Avian / Exotics
                  if (t.includes('equine') || t.includes('bovine') || t.includes('large animal') ||
                      t.includes('avian') || t.includes('exotics')) {
                    return 'General Practice Care / Emergency Care / Urgent Care';
                  }

                  // STEP 3: Scan qualifications section
                  const fromQual = matchPositionFromQualifications(b);
                  if (fromQual === '_SPECIALTY_FLAG_' ||
                      ['Anesthesiologist','Cardiologist','Dermatologist','Ophthalmologist','Radiologist',
                       'Surgeon','Neurologist & Neurosurgeon','Internal Medicine Specialist',
                       'Medical Oncologist','Radiation Oncologist','Dental Specialist','Theriogenologist',
                       'DABVP Specialist','Credentialed Veterinary Technician Specialist','ECC Specialist'].includes(fromQual)) {
                    return 'Specialty Care';
                  }

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
                      result.jobType = value;
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
