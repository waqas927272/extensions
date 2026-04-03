(() => {
    // ===== DATA SOURCE 1: Parse preloadedData from Angular script =====
    function getPreloadedData() {
        const scripts = document.querySelectorAll('script');
        for (const script of scripts) {
            const text = script.textContent || '';
            const match = text.match(/angular\.module\('preloadedData'.*?\.constant\('preloadedData',\s*(\{[\s\S]*?\})\s*\)/);
            if (match) {
                try {
                    // Clean up template literals that aren't resolved
                    let jsonStr = match[1]
                        .replace(/\$\{[^}]+\}/g, '""')
                        .replace(/'/g, '"')
                        .replace(/,\s*}/g, '}')
                        .replace(/(\w+)\s*:/g, '"$1":')
                        .replace(/""(\w+)""/g, '"$1"'); // fix double-quoted keys
                    // Handle booleans and numbers
                    jsonStr = jsonStr.replace(/"(true|false)"/g, '$1');
                    return JSON.parse(jsonStr);
                } catch (e) {
                    // Manual extraction if JSON parse fails
                    const data = {};
                    const catMatch = text.match(/jobCategoryName:\s*'([^']+)'/);
                    if (catMatch) data.jobCategoryName = catMatch[1];
                    const titleMatch = text.match(/jobTitle:\s*'([^']+)'/);
                    if (titleMatch) data.jobTitle = titleMatch[1];
                    return data;
                }
            }
        }
        return {};
    }

    // ===== DATA SOURCE 2: Parse JSON-LD structured data =====
    function getJsonLdData() {
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (const script of scripts) {
            try {
                const data = JSON.parse(script.textContent);
                if (data['@type'] === 'JobPosting') return data;
            } catch (e) {}
        }
        return null;
    }

    // ===== DATA SOURCE 3: Parse DOM elements =====
    function getDomData() {
        const result = { category: '', title: '', city: '', state: '', hospitalName: '' };

        // Title from h2.jv-header
        const header = document.querySelector('h2.jv-header');
        if (header) result.title = header.innerText.trim();

        // Category + Location from p.jv-job-detail-meta
        const meta = document.querySelector('p.jv-job-detail-meta');
        if (meta) {
            const separator = meta.querySelector('.jv-inline-separator');
            if (separator) {
                // Category is the text BEFORE the separator
                let categoryText = '';
                let node = meta.firstChild;
                while (node && node !== separator) {
                    if (node.nodeType === Node.TEXT_NODE) {
                        categoryText += node.textContent;
                    }
                    node = node.nextSibling;
                }
                result.category = categoryText.trim();

                // City/State is text AFTER the separator
                let locationText = '';
                node = separator.nextSibling;
                while (node) {
                    if (node.nodeType === Node.TEXT_NODE) {
                        locationText += node.textContent;
                    }
                    node = node.nextSibling;
                }
                locationText = locationText.trim();
                // Parse "City, State" or "City,\n    State"
                const parts = locationText.split(',').map(s => s.trim()).filter(s => s);
                if (parts.length >= 2) {
                    result.city = parts[0];
                    result.state = parts[1];
                } else if (parts.length === 1) {
                    result.city = parts[0];
                }
            } else {
                // No separator — full text might be just category or category + location
                const fullText = meta.innerText.trim();
                result.category = fullText;
            }
        }

        // Hospital name from .jv-meta em ("Position at ...")
        const metaEm = document.querySelector('.jv-meta em');
        if (metaEm) {
            const emText = metaEm.innerText.trim();
            if (emText.startsWith('Position at ')) {
                result.hospitalName = emText.replace('Position at ', '').trim();
            } else {
                result.hospitalName = emText;
            }
        }

        // Hospital name fallback: subsidiary logo alt text
        if (!result.hospitalName) {
            const logoImg = document.querySelector('#subsidiaryLogo img');
            if (logoImg && logoImg.alt) {
                result.hospitalName = logoImg.alt.trim();
            }
        }

        return result;
    }

    // ===== Get full description text =====
    function getFullDescription() {
        let completeData = '';

        // Get JSON-LD formatted data
        const jsonLd = getJsonLdData();
        if (jsonLd) {
            let jsonLdText = `\n=== JOB POSTING DATA ===\n`;
            jsonLdText += `Title: ${jsonLd.title || ''}\n`;
            jsonLdText += `Date Posted: ${jsonLd.datePosted || ''}\n`;
            jsonLdText += `Industry/Category: ${jsonLd.industry || ''}\n`;
            jsonLdText += `Employment Type: ${jsonLd.employmentType || ''}\n`;
            if (jsonLd.hiringOrganization?.name) {
                jsonLdText += `Hiring Organization: ${jsonLd.hiringOrganization.name}\n`;
            }
            if (jsonLd.jobLocation) {
                const locs = Array.isArray(jsonLd.jobLocation) ? jsonLd.jobLocation : [jsonLd.jobLocation];
                jsonLdText += `Locations:\n`;
                locs.forEach(loc => {
                    if (loc.address) {
                        const addr = loc.address;
                        jsonLdText += `  - ${addr.addressLocality || ''}, ${addr.addressRegion || ''}, ${addr.addressCountry || ''}\n`;
                    }
                });
            }
            if (jsonLd.baseSalary?.value) {
                const s = jsonLd.baseSalary.value;
                if (s.minValue && s.maxValue) {
                    jsonLdText += `Salary Range: ${jsonLd.baseSalary.currency || '$'}${s.minValue} - ${s.maxValue} ${s.unitText || ''}\n`;
                }
            }
            if (jsonLd.description) {
                const temp = document.createElement('div');
                temp.innerHTML = jsonLd.description;
                jsonLdText += `\n=== FULL JOB DESCRIPTION ===\n`;
                jsonLdText += temp.innerText.trim() + '\n';
            }
            completeData = jsonLdText;
        }

        // Add DOM text
        const descEl = document.querySelector('.jv-job-detail-description');
        if (descEl) {
            const descText = descEl.innerText.trim();
            if (descText.length > 100) {
                completeData += `\n\n=== ADDITIONAL PAGE CONTENT ===\n${descText}`;
            }
        }

        if (!completeData || completeData.length < 100) {
            const wrapper = document.querySelector('.jv-wrapper');
            if (wrapper) completeData = wrapper.innerText.trim();
        }

        if (!completeData || completeData.length < 100) {
            completeData = document.body.innerText.trim();
        }

        completeData = completeData.replace(/\n{3,}/g, '\n\n').replace(/\t+/g, ' ');
        return completeData.trim();
    }

    // ===== Map category string to Area of Practice =====
    function categoryToAOP(category) {
        if (!category) return '';
        const cat = category.toLowerCase().trim();
        if (cat.includes('gen practice')) return 'General Practice Care';
        if (cat.includes('(er)') || cat === 'veterinarian (er)') return 'Emergency Care';
        if (cat.includes('specialty diplomate')) return 'Specialty Care';
        if (cat.includes('surgeon diplomate')) return 'Specialty Care';
        return '';
    }

    // ===== Determine Area of Practice =====
    function determineAreaOfPractice(title, category, descriptionText) {
        // STEP 1: Use category from page (most reliable — directly from jobvite)
        const aopFromCategory = categoryToAOP(category);
        if (aopFromCategory) return aopFromCategory;

        const titleLower = title.toLowerCase();

        // STEP 2: Check title for clear specialty position names
        const specialtyNames = ['oncologist', 'cardiologist', 'neurologist', 'neurosurgeon',
            'dermatologist', 'ophthalmologist', 'anesthesiologist', 'theriogenologist',
            'radiologist', 'internist', 'criticalist',
            'oncology', 'cardiology', 'neurology', 'dermatology', 'ophthalmology',
            'anesthesia', 'theriogenology', 'radiology'];
        for (const sp of specialtyNames) {
            if (titleLower.includes(sp)) return 'Specialty Care';
        }

        // Check title for board cert / DACV* / diplomate
        const specialtyCerts = ['board certified', 'residency trained', 'residential trained',
            'diplomate', 'dacvecc', 'dacvim', 'dacvr', 'dacvs', 'dacvd', 'dacvo', 'dacvaa',
            'dact', 'davdc', 'dabvp', 'acvs', 'acvim'];
        for (const cert of specialtyCerts) {
            if (titleLower.includes(cert)) return 'Specialty Care';
        }

        if (titleLower.includes('specialist') && !titleLower.includes('technician specialist')) return 'Specialty Care';
        if (titleLower.match(/\bsurgeon\b/)) return 'Specialty Care';

        // STEP 3: Emergency from title
        if (titleLower.includes('emergency') || titleLower.match(/\ber\b/) ||
            titleLower.includes('er vet') || titleLower.includes('er dvm')) {
            return 'Emergency Care';
        }

        // STEP 4: Urgent Care from title
        if (titleLower.includes('urgent care')) return 'Urgent Care';

        // STEP 5: Equine/Bovine/Exotics from title
        if (titleLower.includes('equine') || titleLower.includes('bovine') || titleLower.includes('large animal') ||
            titleLower.includes('avian') || titleLower.includes('exotics')) {
            return 'General Practice Care / Emergency Care / Urgent Care';
        }

        // STEP 6: Check qualifications section for specialty requirements
        const qualSection = extractQualificationsSection(descriptionText);
        if (qualSection) {
            const qualLower = qualSection.toLowerCase();
            for (const cert of specialtyCerts) {
                if (qualLower.includes(cert)) return 'Specialty Care';
            }
        }

        return 'General Practice Care';
    }

    // ===== Extract qualifications/requirements section =====
    function extractQualificationsSection(text) {
        const patterns = [
            /(?:requirements?|qualifications?|what you'?ll need|what we'?re looking for|credentials?|must have|what we need)[:\s]*([\s\S]{0,800}?)(?=(?:benefits?|compensation|salary|about|our culture|location|equal|join us|why|facility|what we offer|ready to)[:\s])/i,
            /(?:requirements?|qualifications?|what you'?ll need|what we'?re looking for|credentials?|must have|what we need)[:\s]*([\s\S]{0,500})/i
        ];
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) return match[1];
        }
        return null;
    }

    // ===== Match position from title keywords =====
    // Returns a raw position name based on title keywords
    // PRIORITY ORDER: Leadership first (to avoid false matches on service names), then specialty, then generic
    function matchPositionFromTitle(title) {
        const t = title.toLowerCase();

        // === HIGHEST PRIORITY: Leadership positions ===
        // Must be checked FIRST — "Group Medical Director - The Oncology Service" should be
        // Medical Director, NOT Medical Oncologist. The specialty word is the service name, not the role.
        if (t.includes('medical director')) return 'Medical Director';
        if (t.includes('lead veterinarian') || t.includes('lead vet')) return 'Lead Veterinarian';

        // === SPECIALTY POSITION NAMES ===
        if (t.includes('neurologist') || t.includes('neurosurgeon') || t.includes('neurology')) return 'Neurologist & Neurosurgeon';
        if (t.includes('dermatologist') || t.includes('dermatology')) return 'Dermatologist';
        if (t.includes('cardiologist') || t.includes('cardiology')) return 'Cardiologist';
        if (t.includes('oncologist') && t.includes('radiation')) return 'Radiation Oncologist';
        if (t.includes('oncologist') || t.includes('oncology')) return 'Medical Oncologist';
        if (t.includes('radiologist') || t.includes('diagnostic imaging') || t.includes('radiology')) return 'Radiologist';
        if (t.includes('ophthalmologist') || t.includes('ophthalmology')) return 'Ophthalmologist';
        if (t.includes('anesthesiologist') || t.includes('anesthesia')) return 'Anesthesiologist';
        if (t.includes('theriogenologist') || t.includes('theriogenology')) return 'Theriogenologist';
        if (t.includes('internist') || t.includes('internal medicine')) return 'Internal Medicine Specialist';
        if (t.includes('criticalist') || t.match(/\becc\b/) || t.includes('emergency medicine')) return 'ECC Specialist';
        if (t.includes('dabvp')) return 'DABVP Specialist';
        if ((t.includes('dental') || t.includes('dentist') || t.includes('dentistry')) && !t.includes('assistant')) return 'Dental Specialist';
        // For surgeon, be more specific - check it's not part of neurosurgeon (which we already handled)
        if ((t.includes('surgeon') || t.includes('surgery')) && !t.includes('neurosurgeon') && !t.includes('neurology') && !t.includes('dental') && !t.includes('dentistry')) return 'Surgeon';

        // === VTS/CREDENTIALED SPECIALIST (check before generic technician) ===
        if (t.includes('technician specialist') || (t.match(/\bvts\b/) && t.includes('specialist'))) return 'Credentialed Veterinary Technician Specialist';

        // === ANIMAL TYPE & PRACTICE SCOPE ===
        if (t.includes('equine') || t.includes('bovine') || t.includes('large animal')) return 'Equine/Bovine Veterinarian/Large Animal';
        if (t.includes('avian') || t.includes('exotics')) return 'Avian & Exotics Veterinarian / Associate Exotics';

        // === GENERAL VETERINARY ROLES ===
        if (t.includes('partner veterinarian')) return 'Partner Veterinarian';

        return '';
    }

    // ===== Match position from qualifications section (for generic titles) =====
    function matchPositionFromQualifications(descriptionText) {
        const qualSection = extractQualificationsSection(descriptionText);
        if (!qualSection) return '';
        const q = qualSection.toLowerCase();

        if (q.includes('dacvecc')) return 'ECC Specialist';
        if (q.includes('dacvim') && q.includes('oncology')) return 'Medical Oncologist';
        if (q.includes('dacvr') && q.includes('radiation')) return 'Radiation Oncologist';
        if (q.includes('dacvim') && q.includes('neurology')) return 'Neurologist & Neurosurgeon';
        if (q.includes('dacvim') && q.includes('cardiology')) return 'Cardiologist';
        if (q.includes('dacvim')) return 'Internal Medicine Specialist';
        if (q.includes('davdc')) return 'Dental Specialist';
        if (q.includes('dacvd')) return 'Dermatologist';
        if (q.includes('dacvs') || q.includes('acvs')) return 'Surgeon';
        if (q.includes('dacvr')) return 'Radiologist';
        if (q.includes('dacvo')) return 'Ophthalmologist';
        if (q.includes('dacvaa')) return 'Anesthesiologist';
        if (q.includes('dact')) return 'Theriogenologist';
        if (q.includes('dabvp')) return 'DABVP Specialist';

        return '';
    }

    // ===== Determine Position =====
    // Valid positions per AOP (from CorrectJobNames.txt):
    //   Emergency Care: Associate Veterinarian
    //   General Practice Care: Associate Veterinarian, Lead Veterinarian, Medical Director
    //   Specialty Care: Anesthesiologist, Cardiologist, Credentialed Veterinary Technician Specialist,
    //     DABVP Specialist, Dental Specialist, Dermatologist, ECC Specialist,
    //     Internal Medicine Specialist, Medical Director, Medical Oncologist,
    //     Neurologist & Neurosurgeon, Ophthalmologist, Radiation Oncologist, Radiologist, Surgeon
    //   Urgent Care: Associate Veterinarian, Partner Veterinarian
    function determinePosition(title, areaOfPractice, descriptionText) {
        // 1. Try to match from title
        let position = matchPositionFromTitle(title);

        // 2. If no match from title and AOP is Specialty Care, try qualifications
        if (!position && areaOfPractice === 'Specialty Care') {
            position = matchPositionFromQualifications(descriptionText);
        }

        // 3. Validate position against AOP — ensure it's a valid combo
        if (position) {
            position = validatePositionForAOP(position, areaOfPractice);
        }

        // 4. Special case: if title explicitly says "Medical Director" but AOP validation
        //    downgraded it (e.g., ER category), keep it as Medical Director — it's valid in GP and Specialty
        if (position === 'Associate Veterinarian' && title.toLowerCase().includes('medical director')) {
            position = 'Medical Director';
        }

        // 5. Default based on AOP
        if (!position) {
            position = 'Associate Veterinarian';
        }

        return position;
    }

    // ===== Validate that position is allowed for the given AOP =====
    function validatePositionForAOP(position, aop) {
        const validPositions = {
            'Emergency Care': ['Associate Veterinarian'],
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

        // For compound AOPs like "General Practice Care / Emergency Care / Urgent Care",
        // accept the position if it's valid in ANY of the listed AOPs
        const aopParts = aop.split('/').map(s => s.trim());
        for (const part of aopParts) {
            const allowed = validPositions[part];
            if (allowed && allowed.includes(position)) return position;
        }

        // If we found at least one known AOP but position wasn't valid in any of them, default
        const hasKnownAOP = aopParts.some(part => validPositions[part]);
        if (hasKnownAOP) return 'Associate Veterinarian';

        // Completely unknown AOP — still validate against all known positions
        const allValid = new Set(Object.values(validPositions).flat());
        if (allValid.has(position)) return position;

        return 'Associate Veterinarian';
    }

    // ===== Extract salary =====
    function extractSalary(jsonLd, descriptionText) {
        // 1. Try JSON-LD baseSalary (check values are not empty)
        if (jsonLd?.baseSalary?.value) {
            const s = jsonLd.baseSalary.value;
            const minVal = s.minValue ? String(s.minValue).trim() : '';
            const maxVal = s.maxValue ? String(s.maxValue).trim() : '';
            if (minVal && maxVal) {
                const currency = jsonLd.baseSalary.currency || '$';
                const unit = s.unitText || 'per year';
                return `${currency}${minVal} - ${currency}${maxVal} ${unit}`;
            } else if (minVal) {
                return `${jsonLd.baseSalary.currency || '$'}${minVal}+`;
            }
        }

        // 2. Extract from description text
        if (!descriptionText) return '';
        const text = descriptionText;

        const salaryPatterns = [
            // "Base salary ranges: $150k - $171k"
            /(?:base\s+salary\s*(?:ranges?)?)[:\s]*\$[\d,]+k?\s*[-–]\s*\$?[\d,]+k?/i,
            // "Salary: $130,000-$200,000"
            /(?:salary|compensation|pay)[:\s]*\$[\d,]+(?:\.\d{2})?\s*[-–—]\s*\$?[\d,]+(?:\.\d{2})?(?:\s*(?:per\s+)?(?:year|annually|annum|annual))?/i,
            // "Compensation: $110,000-$180,000 per year"
            /(?:salary|compensation|pay)[:\s]*\$[\d,]+(?:\.\d{2})?\s*[-–—]\s*\$?[\d,]+(?:\.\d{2})?\s*per\s*\w+/i,
            // "$130,000-$200,000"
            /\$[\d,]+(?:\.\d{2})?\s*[-–—]\s*\$[\d,]+(?:\.\d{2})?/i,
            // "$150k - $171k"
            /\$[\d,]+k?\s*[-–—]+\s*\$?[\d,]+k/i,
            // "earn $250,000 annually"
            /(?:earn|earning)\s+\$[\d,]+(?:\.\d{2})?\s*(?:annually|per\s*year)?/i,
            // "$250,000 annually"
            /\$[\d,]+(?:\.\d{2})?\s*(?:annually|per\s*year|per\s*annum)/i,
            // "$95 per hour" or "$95/hr"
            /\$[\d,]+(?:\.\d{2})?\s*(?:per\s+)?(?:hour|hr|\/hr)/i,
        ];
        for (const pattern of salaryPatterns) {
            const m = text.match(pattern);
            if (m) return m[0].trim();
        }
        return '';
    }

    // ===== Extract locations =====
    function extractLocations(jsonLd, domData) {
        const locations = [];

        // 1. From JSON-LD
        if (jsonLd?.jobLocation) {
            const jobLocs = Array.isArray(jsonLd.jobLocation) ? jsonLd.jobLocation : [jsonLd.jobLocation];
            for (const loc of jobLocs) {
                if (loc.address) {
                    const city = loc.address.addressLocality || '';
                    const state = loc.address.addressRegion || '';
                    if (city && state) {
                        locations.push({ city, state, location: `${city}, ${state}` });
                    }
                }
            }
        }

        // 2. From DOM (.jv-job-detail-meta)
        if (locations.length === 0 && domData.city) {
            locations.push({
                city: domData.city,
                state: domData.state || '',
                location: domData.state ? `${domData.city}, ${domData.state}` : domData.city
            });
        }

        // 3. Fallback: search page text
        if (locations.length === 0) {
            const heroSelectors = ['.jv-job-detail-meta', '.jv-header-info', '[class*="location"]'];
            for (const sel of heroSelectors) {
                const els = document.querySelectorAll(sel);
                for (const el of els) {
                    const text = (el.innerText || '').split('\n')[0];
                    const matches = text.matchAll(/\b([A-Za-z][\w\s.'()-]*[A-Za-z])\s*,\s*([A-Z]{2})\b/g);
                    for (const match of matches) {
                        const city = match[1].trim();
                        const state = match[2].trim();
                        const bad = ['description', 'position', 'associate', 'veterinarian', 'hospital', 'care'];
                        if (!bad.some(w => city.toLowerCase().includes(w)) && city.length > 1 && city.length < 50) {
                            locations.push({ city, state, location: `${city}, ${state}` });
                        }
                    }
                }
            }
        }

        // 4. Multi-location list
        const multiLoc = document.querySelectorAll('.job-multi-locations li.location, .location-list li.each-location');
        if (multiLoc.length > 0) {
            multiLoc.forEach(el => {
                const parts = el.innerText.trim().split(',').map(s => s.trim());
                if (parts.length >= 2) {
                    locations.push({ city: parts[0], state: parts[1], location: el.innerText.trim() });
                }
            });
        }

        // Deduplicate
        const unique = [];
        const seen = new Set();
        for (const loc of locations) {
            const key = `${loc.city}|${loc.state}`.toLowerCase();
            if (!seen.has(key)) { seen.add(key); unique.push(loc); }
        }
        return unique;
    }

    // ===== MAIN EXTRACTION =====
    const preloaded = getPreloadedData();
    const jsonLd = getJsonLdData();
    const domData = getDomData();
    const fullDescription = getFullDescription();

    // Get title (priority: DOM > JSON-LD > preloaded)
    const positionTitle = domData.title || jsonLd?.title || preloaded.jobTitle || '';

    // Get category (priority: DOM > preloaded > JSON-LD)
    const category = domData.category || preloaded.jobCategoryName || jsonLd?.industry || '';

    // Get hospital name (priority: DOM > JSON-LD)
    let hospitalName = domData.hospitalName || '';
    if (!hospitalName && jsonLd?.hiringOrganization?.name) {
        hospitalName = jsonLd.hiringOrganization.name;
    }
    // If generic UVC name, try to find specific hospital in description
    if (hospitalName.toLowerCase().includes('united veterinary care')) {
        const hospitalMatch = fullDescription.match(/at\s+((?:[\w'.&-]+\s+){1,5}(?:Animal\s+Hospital|Veterinary\s+(?:Hospital|Center|Clinic|Care|Specialists?)|Pet\s+(?:Hospital|Clinic|Care)|Emergency\s+(?:Hospital|Center|Clinic)))\b/i);
        if (hospitalMatch) hospitalName = hospitalMatch[1].trim();
    }

    // Determine AOP and Position
    const areaOfPractice = determineAreaOfPractice(positionTitle, category, fullDescription);
    const position = determinePosition(positionTitle, areaOfPractice, fullDescription);
    const salary = extractSalary(jsonLd, fullDescription);
    const locations = extractLocations(jsonLd, domData);

    // Build results
    const baseDetails = {
        areaOfPractice,
        position,
        salary,
        hospitalName,
        description: fullDescription
    };

    if (locations.length === 0) {
        return [{ ...baseDetails, city: '', state: '', location: '' }];
    }

    return locations.map(loc => ({
        ...baseDetails,
        city: loc.city,
        state: loc.state,
        location: loc.location
    }));
})();
