(() => {
    // ===== DATA SOURCE 1: Parse preloadedData from Angular script =====
    function getPreloadedData() {
        const scripts = document.querySelectorAll('script');
        for (const script of scripts) {
            const text = script.textContent || '';
            const match = text.match(/angular\.module\('preloadedData'.*?\.constant\('preloadedData',\s*(\{[\s\S]*?\})\s*\)/);
            if (match) {
                try {
                    let jsonStr = match[1]
                        .replace(/\$\{[^}]+\}/g, '""')
                        .replace(/'/g, '"')
                        .replace(/,\s*}/g, '}')
                        .replace(/(\w+)\s*:/g, '"$1":')
                        .replace(/""(\w+)""/g, '"$1"');
                    jsonStr = jsonStr.replace(/"(true|false)"/g, '$1');
                    return JSON.parse(jsonStr);
                } catch (e) {
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
        const result = { category: '', title: '', city: '', state: '' };

        // Title from h2.jv-header
        const header = document.querySelector('h2.jv-header');
        if (header) result.title = header.innerText.trim();

        // Category + Location from p.jv-job-detail-meta
        // Format: "Category<separator>City, State"
        const meta = document.querySelector('p.jv-job-detail-meta');
        if (meta) {
            const separator = meta.querySelector('.jv-inline-separator');
            if (separator) {
                let categoryText = '';
                let node = meta.firstChild;
                while (node && node !== separator) {
                    if (node.nodeType === Node.TEXT_NODE) categoryText += node.textContent;
                    node = node.nextSibling;
                }
                result.category = categoryText.trim();

                let locationText = '';
                node = separator.nextSibling;
                while (node) {
                    if (node.nodeType === Node.TEXT_NODE) locationText += node.textContent;
                    node = node.nextSibling;
                }
                locationText = locationText.trim();
                const parts = locationText.split(',').map(s => s.trim()).filter(s => s);
                if (parts.length >= 2) {
                    result.city = parts[0];
                    result.state = parts[1];
                } else if (parts.length === 1) {
                    result.city = parts[0];
                }
            } else {
                result.category = meta.innerText.trim();
            }
        }

        return result;
    }

    // ===== Get full description text =====
    function getFullDescription() {
        let completeData = '';

        const jsonLd = getJsonLdData();
        if (jsonLd) {
            let jsonLdText = `\n=== JOB POSTING DATA ===\n`;
            jsonLdText += `Title: ${jsonLd.title || ''}\n`;
            jsonLdText += `Date Posted: ${jsonLd.datePosted || ''}\n`;
            jsonLdText += `Industry/Category: ${jsonLd.industry || ''}\n`;
            jsonLdText += `Employment Type: ${jsonLd.employmentType || ''}\n`;
            // MedVet: hiringOrganization is a plain string "MedVet", not an object
            const orgName = typeof jsonLd.hiringOrganization === 'string'
                ? jsonLd.hiringOrganization
                : (jsonLd.hiringOrganization?.name || '');
            if (orgName) jsonLdText += `Hiring Organization: ${orgName}\n`;

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
                const minVal = s.minValue ? String(s.minValue).trim() : '';
                const maxVal = s.maxValue ? String(s.maxValue).trim() : '';
                if (minVal && maxVal) {
                    jsonLdText += `Salary Range: ${jsonLd.baseSalary.currency || '$'}${minVal} - ${maxVal} ${s.unitText || ''}\n`;
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

    // ===== State full-name → abbreviation =====
    const STATE_ABBREV = {
        'alabama':'AL','alaska':'AK','arizona':'AZ','arkansas':'AR','california':'CA',
        'colorado':'CO','connecticut':'CT','delaware':'DE','florida':'FL','georgia':'GA',
        'hawaii':'HI','idaho':'ID','illinois':'IL','indiana':'IN','iowa':'IA','kansas':'KS',
        'kentucky':'KY','louisiana':'LA','maine':'ME','maryland':'MD','massachusetts':'MA',
        'michigan':'MI','minnesota':'MN','mississippi':'MS','missouri':'MO','montana':'MT',
        'nebraska':'NE','nevada':'NV','new hampshire':'NH','new jersey':'NJ','new mexico':'NM',
        'new york':'NY','north carolina':'NC','north dakota':'ND','ohio':'OH','oklahoma':'OK',
        'oregon':'OR','pennsylvania':'PA','rhode island':'RI','south carolina':'SC',
        'south dakota':'SD','tennessee':'TN','texas':'TX','utah':'UT','vermont':'VT',
        'virginia':'VA','washington':'WA','west virginia':'WV','wisconsin':'WI','wyoming':'WY',
        'district of columbia':'DC'
    };
    function normalizeState(s) {
        if (!s) return '';
        const t = s.trim();
        if (t.length === 2) return t.toUpperCase();
        return STATE_ABBREV[t.toLowerCase()] || t;
    }

    // ===== Extract qualifications section from description =====
    function extractQualificationsSection(text) {
        const patterns = [
            /(?:requirements?|qualifications?|what you'?ll need|who you are|credentials?|must have)[:\s]*([\s\S]{0,800}?)(?=(?:benefits?|compensation|salary|about|our culture|equal|join us|why|facility|what we offer|perks)[:\s])/i,
            /(?:requirements?|qualifications?|what you'?ll need|who you are|credentials?|must have)[:\s]*([\s\S]{0,500})/i
        ];
        for (const p of patterns) {
            const m = text.match(p);
            if (m) return m[1];
        }
        return null;
    }

    // ===== POSITION: Map Jobvite category string to canonical position name =====
    // Used when the title alone doesn't provide enough info.
    // These are the EXACT names from CorrectJobNames.txt.
    function matchPositionFromCategory(category) {
        if (!category) return '';
        const c = category.toLowerCase().trim();

        // ECC / Criticalist / Critical Care
        if (c.includes('criticalist') || c === 'ecc' || c.includes('ecc ') || c.includes(' ecc') ||
            c === 'critical care' || c.includes('critical care') ||
            c.includes('emergency and critical care') || c.includes('emergency & critical care')) {
            return 'ECC Specialist';
        }

        // Radiation Oncology
        if (c.includes('radiation oncolog')) return 'Radiation Oncologist';

        // Medical Oncology / Oncology
        if (c.includes('medical oncolog')) return 'Medical Oncologist';
        if (c.includes('oncolog') && !c.includes('radiation')) return 'Medical Oncologist';

        // Cardiology
        if (c.includes('cardiolog')) return 'Cardiologist';

        // Neurology / Neurosurgery
        if (c.includes('neurolog') || c.includes('neurosurg')) return 'Neurologist & Neurosurgeon';

        // Dermatology
        if (c.includes('dermatolog')) return 'Dermatologist';

        // Ophthalmology
        if (c.includes('ophthalmolog') || c.includes('ophtho')) return 'Ophthalmologist';

        // Anesthesia / Anesthesiology
        if (c.includes('anesthesiolog') || c === 'anesthesia' || c.includes('anesthesia')) return 'Anesthesiologist';

        // Theriogenology
        if (c.includes('theriogenolog')) return 'Theriogenologist';

        // Internal Medicine
        if (c.includes('internal medicine') || c.includes('internist') || c.includes('saim')) {
            return 'Internal Medicine Specialist';
        }

        // Radiology / Diagnostic Imaging
        if (c.includes('radiolog') || c.includes('diagnostic imaging')) return 'Radiologist';

        // Surgery
        if ((c.includes('surgeon') || c.includes('surgery')) && !c.includes('neurosurg')) return 'Surgeon';

        // Dental / Dentistry
        if (c.includes('dental') || c.includes('dentistry') || c.includes('davdc')) return 'Dental Specialist';

        // DABVP
        if (c.includes('dabvp')) return 'DABVP Specialist';

        // Rehabilitation
        if (c.includes('rehabilitation') || c.includes('rehab') || c.includes('ccrt')) return 'Credentialed Veterinary Technician Specialist';

        return '';
    }

    // ===== POSITION: Match from job title keywords =====
    // Priority order matters — leadership first, then specialty, then generic.
    function matchPositionFromTitle(title, category) {
        const t = title.toLowerCase();
        const c = (category || '').toLowerCase();

        // ── Is this a TECHNICIAN role? ──
        // "Radiation Oncology Veterinary Technician" → Credentialed Vet Tech Specialist
        // Exception: "credentialed" + "anesthesia" → Anesthesiologist (per business rule)
        const isTechRole = /\b(technician|technologist|vet\s+tech|nurse)\b/.test(t) &&
                           !t.includes('technician specialist') && !t.match(/\bvts\b/);

        if (isTechRole) {
            // Map technician roles to the specialist position for their department.
            // Anesthesia tech → Anesthesiologist
            if (t.includes('anesthesia') || t.includes('anesthesiolog')) return 'Anesthesiologist';
            // Dental / Dentistry tech → Dental Specialist
            if (t.includes('dental') || t.includes('dentistry') || t.includes('dentist')) return 'Dental Specialist';
            // Critical Care / ECC tech → ECC Specialist
            if (t.includes('critical care') || t.match(/\becc\b/) || t.includes('criticalist')) return 'ECC Specialist';
            // Radiation Oncology tech → Radiation Oncologist
            if (t.includes('radiation oncolog') || (t.includes('radiation') && t.includes('oncol'))) return 'Radiation Oncologist';
            // Medical Oncology / Oncology tech → Medical Oncologist
            if (t.includes('oncolog') && !t.includes('radiation')) return 'Medical Oncologist';
            // Cardiology tech → Cardiologist
            if (t.includes('cardiolog') || t.includes('cardiology')) return 'Cardiologist';
            // Neurology / Neurosurgery tech → Neurologist & Neurosurgeon
            if (t.includes('neurolog') || t.includes('neurosurg')) return 'Neurologist & Neurosurgeon';
            // Dermatology tech → Dermatologist
            if (t.includes('dermatolog')) return 'Dermatologist';
            // Ophthalmology tech → Ophthalmologist
            if (t.includes('ophthalmolog')) return 'Ophthalmologist';
            // Surgery tech → Surgeon
            if ((t.includes('surgery') || t.includes('surgical') || t.includes('surgeon')) && !t.includes('neurosurg')) return 'Surgeon';
            // Radiology / Imaging tech → Radiologist
            if (t.includes('radiolog') || t.includes('diagnostic imaging')) return 'Radiologist';
            // Internal Medicine tech → Internal Medicine Specialist
            if (t.includes('internal medicine')) return 'Internal Medicine Specialist';
            // Any other specialty technician (rehab, emergency, etc.) → Credentialed Veterinary Technician Specialist
            const specTechKw = [
                'rehabilitation', 'emergency', 'imaging', 'specialist', 'specialty'
            ];
            for (const kw of specTechKw) {
                if (t.includes(kw)) return 'Credentialed Veterinary Technician Specialist';
            }
        }

        // ── VTS (Veterinary Technician Specialist) ──
        if (t.includes('technician specialist') || t.match(/\bvts\b/)) {
            return 'Credentialed Veterinary Technician Specialist';
        }

        // ── Leadership (HIGHEST PRIORITY for DVM roles) ──
        if (t.includes('medical director')) return 'Medical Director';
        if (t.includes('lead veterinarian') || t.includes('lead vet')) return 'Lead Veterinarian';

        // ── ECC Specialist (criticalist = board-certified ER specialist) ──
        // Must be checked BEFORE generic "emergency" to separate specialist from ER generalist.
        if (t.includes('criticalist') || t.includes('dacvecc') ||
            t.match(/\becc\b/) || t.match(/\becc\s+specialist\b/) ||
            (t.includes('emergency') && t.includes('critical care')) ||
            (t.includes('emergency') && t.includes('criticalist'))) {
            return 'ECC Specialist';
        }

        // ── Specialty positions (DVM / board-certified level) ──
        if (t.includes('neurologist') || t.includes('neurosurgeon') ||
            (t.includes('neurology') && !isTechRole)) return 'Neurologist & Neurosurgeon';
        if (t.includes('dermatologist') ||
            (t.includes('dermatology') && !isTechRole)) return 'Dermatologist';
        if (t.includes('cardiologist') ||
            (t.includes('cardiology') && !isTechRole)) return 'Cardiologist';
        if ((t.includes('oncologist') || t.includes('oncology')) && t.includes('radiation')) return 'Radiation Oncologist';
        if (t.includes('oncologist') ||
            (t.includes('oncology') && !isTechRole)) return 'Medical Oncologist';
        if (t.includes('radiologist') || t.includes('diagnostic imaging') ||
            (t.includes('radiology') && !isTechRole)) return 'Radiologist';
        if (t.includes('ophthalmologist') ||
            (t.includes('ophthalmology') && !isTechRole)) return 'Ophthalmologist';
        if (t.includes('anesthesiologist') ||
            (t.includes('anesthesia') && !isTechRole)) return 'Anesthesiologist';
        if (t.includes('theriogenologist') ||
            (t.includes('theriogenology') && !isTechRole)) return 'Theriogenologist';
        if (t.includes('internist') ||
            (t.includes('internal medicine') && !isTechRole)) return 'Internal Medicine Specialist';
        if (t.includes('dabvp')) return 'DABVP Specialist';
        if ((t.includes('dental') || t.includes('dentist') || t.includes('dentistry')) &&
            !t.includes('assistant')) return 'Dental Specialist';
        if ((t.includes('surgeon') || t.includes('surgery')) &&
            !t.includes('neurosurgeon') && !t.includes('dental') && !isTechRole) return 'Surgeon';

        // ── Animal type / scope ──
        if (t.includes('equine') || t.includes('bovine') || t.includes('large animal')) {
            return 'Equine/Bovine Veterinarian/Large Animal';
        }
        if (t.includes('avian') || t.includes('exotics')) {
            return 'Avian & Exotics Veterinarian / Associate Exotics';
        }

        // ── Other named roles ──
        if (t.includes('partner veterinarian')) return 'Partner Veterinarian';

        // ── Non-clinical role guard ──
        // Admin/support titles must NOT inherit a specialist position from their department category.
        // e.g. "Client Service Representative" in the Ophthalmology dept should NOT become "Ophthalmologist".
        const isNonClinical =
            t.includes('client service') || t.includes('service representative') ||
            t.includes('receptionist') || t.includes('kennel') ||
            t.includes('groomer') || t.includes('grooming') ||
            t.includes('practice manager') || t.includes('hospital manager') ||
            t.includes('office manager') || t.includes('administrator') ||
            t.includes('billing') || t.includes('human resources') ||
            t.includes('patient care coordinator') || t.includes('client care coordinator') ||
            t.includes('customer service') || t.includes('front desk') ||
            t.includes('inventory') || t.includes('housekeeper') || t.includes('janitorial');
        if (isNonClinical) return '';

        // ── Fallback: try category string mapping ──
        // Only reached by clinical roles (DVM/tech) whose title didn't contain a specialty keyword.
        const fromCat = matchPositionFromCategory(c || category);
        if (fromCat) return fromCat;

        return '';
    }

    // ===== POSITION: Scan qualifications for DACV* credentials =====
    function matchPositionFromQualifications(descriptionText) {
        const qualSection = extractQualificationsSection(descriptionText);
        if (!qualSection) return '';
        const q = qualSection.toLowerCase();

        if (q.includes('dacvecc')) return 'ECC Specialist';
        if (q.includes('dacvim') && q.includes('oncology')) return 'Medical Oncologist';
        if (q.includes('dacvr') && (q.includes('radiation') || q.includes('-ro'))) return 'Radiation Oncologist';
        if (q.includes('dacvim') && (q.includes('neurology') || q.includes('neurosurg'))) return 'Neurologist & Neurosurgeon';
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

        // Board certified / residency trained → Specialty Care flag
        if (q.includes('board certified') || q.includes('residency trained') ||
            q.includes('residency-trained') || q.includes('diplomate')) {
            return '_SPECIALTY_FLAG_'; // Signal: specialty care but position unclear
        }
        return '';
    }

    // ===== Validate position is allowed for the AOP =====
    function validatePositionForAOP(position, aop) {
        if (position === 'Equine/Bovine Veterinarian/Large Animal' ||
            position === 'Avian & Exotics Veterinarian / Associate Exotics' ||
            position === '_SPECIALTY_FLAG_') return position;

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

        const aopParts = aop.split('/').map(s => s.trim());
        for (const part of aopParts) {
            const allowed = validPositions[part];
            if (allowed && allowed.includes(position)) return position;
        }

        // Medical Director is valid in GP and Specialty
        if (position === 'Medical Director') return position;

        const hasKnownAOP = aopParts.some(part => validPositions[part]);
        if (hasKnownAOP) return 'Associate Veterinarian';

        const allValid = new Set(Object.values(validPositions).flat());
        if (allValid.has(position)) return position;
        return 'Associate Veterinarian';
    }

    // ===== Determine Area of Practice from category and title =====
    function determineAreaOfPractice(title, category, descriptionText) {
        const t = title.toLowerCase();
        const c = category.toLowerCase().trim();

        // ── STEP 1: Category from Jobvite page (most reliable) ──
        // Emergency / Critical Care (but NOT if specifically a specialist)
        if ((c === 'emergency and critical care' || c === 'emergency & critical care' ||
             c === 'emergency medicine' || c === 'emergency') && !c.includes('specialist')) {
            // Category "Emergency and Critical Care" → AOP: Emergency Care
            // But if title has criticalist/ECC → Specialty Care
            if (t.includes('criticalist') || t.match(/\becc\b/) || t.includes('specialist')) {
                return 'Specialty Care';
            }
            return 'Emergency Care';
        }

        // ECC Specialist category
        if (c.includes('criticalist') || c === 'ecc' ||
            c.includes('emergency and critical care specialist') ||
            c.includes('emergency & critical care specialist')) {
            return 'Specialty Care';
        }

        // Urgent Care
        if (c.includes('urgent care')) return 'Urgent Care';

        // General Practice
        if (c.includes('gen practice') || c.includes('general practice') ||
            c.includes('general med')) return 'General Practice Care';

        // All specialty disciplines map to Specialty Care
        const specialtyCategories = [
            'oncology', 'oncologist',
            'cardiology', 'cardiologist',
            'neurology', 'neurosurgeon', 'neurosurgery',
            'dermatology', 'dermatologist',
            'ophthalmology', 'ophthalmologist',
            'anesthesia', 'anesthesiology', 'anesthesiologist',
            'surgery', 'surgeon',
            'radiology', 'radiologist', 'diagnostic imaging',
            'internal medicine', 'internist', 'saim',
            'theriogenology', 'theriogenologist',
            'dental', 'dentistry', 'davdc',
            'criticalist', 'critical care', 'dacvecc', 'dacvim', 'dacvs', 'dacvr',
            'dacvd', 'dacvo', 'dacvaa', 'dact', 'dabvp',
            'rehabilitation', 'sports medicine', 'specialist', 'specialty'
        ];
        for (const sp of specialtyCategories) {
            if (c.includes(sp)) return 'Specialty Care';
        }

        // ── STEP 2: Title keywords ──
        // ECC Specialist (check before generic emergency)
        if (t.includes('criticalist') || t.match(/\becc\b/) || t.includes('dacvecc') ||
            (t.includes('emergency') && t.includes('critical care'))) {
            return 'Specialty Care';
        }

        // Specialty indicators in title
        const specialtyTitleKw = [
            'oncologist', 'cardiologist', 'neurologist', 'neurosurgeon',
            'dermatologist', 'ophthalmologist', 'anesthesiologist', 'theriogenologist',
            'radiologist', 'internist', 'criticalist',
            'oncology', 'cardiology', 'neurology', 'dermatology', 'ophthalmology',
            'anesthesia', 'theriogenology', 'radiology', 'rehabilitation'
        ];
        for (const sp of specialtyTitleKw) {
            if (t.includes(sp)) return 'Specialty Care';
        }

        const specialtyCerts = [
            'board certified', 'residency trained', 'diplomate',
            'dacvecc', 'dacvim', 'dacvr', 'dacvs', 'dacvd', 'dacvo', 'dacvaa',
            'dact', 'davdc', 'dabvp', 'acvs', 'acvim'
        ];
        for (const cert of specialtyCerts) {
            if (t.includes(cert)) return 'Specialty Care';
        }

        if (t.includes('specialist') && !t.includes('technician specialist')) return 'Specialty Care';
        if (t.match(/\bsurgeon\b/)) return 'Specialty Care';

        // Emergency (non-specialist)
        if (t.includes('emergency') || t.match(/\ber\b/) ||
            t.includes('er vet') || t.includes('er dvm') || t.includes('ecc')) {
            return 'Emergency Care';
        }

        // Urgent Care
        if (t.includes('urgent care')) return 'Urgent Care';

        // Equine / Large Animal
        if (t.includes('equine') || t.includes('bovine') || t.includes('large animal') ||
            t.includes('avian') || t.includes('exotics')) {
            return 'General Practice Care / Emergency Care / Urgent Care';
        }

        // ── STEP 3: Qualifications section ──
        if (descriptionText) {
            const qualResult = matchPositionFromQualifications(descriptionText);
            if (qualResult === 'ECC Specialist' || qualResult === '_SPECIALTY_FLAG_' ||
                ['Anesthesiologist','Cardiologist','Dermatologist','Ophthalmologist',
                 'Radiologist','Surgeon','Neurologist & Neurosurgeon','Internal Medicine Specialist',
                 'Medical Oncologist','Radiation Oncologist','Dental Specialist','Theriogenologist',
                 'DABVP Specialist','Credentialed Veterinary Technician Specialist'].includes(qualResult)) {
                return 'Specialty Care';
            }
        }

        return 'General Practice Care';
    }

    // ===== Determine Position (combines all sources) =====
    function determinePosition(title, category, areaOfPractice, descriptionText) {
        // Step 1: Match from title (+ category as fallback)
        let position = matchPositionFromTitle(title, category);

        // Step 2: If specialty AOP and no title match, scan qualifications
        if (!position && areaOfPractice === 'Specialty Care') {
            const fromQual = matchPositionFromQualifications(descriptionText);
            if (fromQual && fromQual !== '_SPECIALTY_FLAG_') position = fromQual;
        }

        // Step 3: If still nothing but we have a category, try category mapping
        if (!position) {
            position = matchPositionFromCategory(category);
        }

        // Step 4: Validate position against AOP
        if (position && position !== '_SPECIALTY_FLAG_' &&
            position !== 'Equine/Bovine Veterinarian/Large Animal' &&
            position !== 'Avian & Exotics Veterinarian / Associate Exotics') {
            position = validatePositionForAOP(position, areaOfPractice);
        }

        // Step 5: Medical Director override
        if ((!position || position === 'Associate Veterinarian') &&
            title.toLowerCase().includes('medical director')) {
            position = 'Medical Director';
        }

        // Step 6: Default
        if (!position || position === '_SPECIALTY_FLAG_') {
            position = 'Associate Veterinarian';
        }

        return position;
    }

    // ===== Build hospital name from city =====
    function buildHospitalName(city) {
        const skipLocs = ['nationwide', 'remote', 'national', 'multiple', 'united states', 'various', ''];
        if (!city || skipLocs.includes(city.toLowerCase())) return 'MedVet';
        return 'MedVet ' + city;
    }

    // ===== Format salary =====
    function formatSalary(raw) {
        if (!raw) return '';
        const isHourly = /(?:per\s+)?(?:hour|hr|\/hr)/i.test(raw);
        const amounts = [];
        const amountRegex = /\$?([\d,]+(?:\.\d{2})?)\s*k?\b/gi;
        let match;
        while ((match = amountRegex.exec(raw)) !== null) {
            let num = parseFloat(match[1].replace(/,/g, ''));
            const afterMatch = raw.substring(match.index + match[0].length - 1, match.index + match[0].length + 1);
            if (/k/i.test(match[0]) || /k/i.test(afterMatch)) num *= 1000;
            if (num > 0) amounts.push(num);
        }
        if (amounts.length === 0) return raw;
        const fmt = (n) => Number.isInteger(n) ? '$' + n.toLocaleString('en-US') :
            '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const unit = isHourly ? 'per hour' : 'per year';
        if (amounts.length >= 2) {
            return `${fmt(Math.min(amounts[0], amounts[1]))}–${fmt(Math.max(amounts[0], amounts[1]))} ${unit}`;
        }
        return `${fmt(amounts[0])} ${unit}`;
    }

    // ===== Extract salary =====
    // Only saves salary when it is clearly labeled on the page.
    // Bare dollar amounts (bonuses, CE allowances, etc.) are intentionally excluded.
    function extractSalary(jsonLd, descriptionText) {
        // ── Source 1: JSON-LD baseSalary (most reliable) ──
        if (jsonLd?.baseSalary?.value) {
            const s = jsonLd.baseSalary.value;
            const minVal = s.minValue ? String(s.minValue).trim() : '';
            const maxVal = s.maxValue ? String(s.maxValue).trim() : '';
            // Only use if at least one value is a real number (not empty string "")
            const minNum = parseFloat(minVal.replace(/,/g, ''));
            const maxNum = parseFloat(maxVal.replace(/,/g, ''));
            if (minVal && maxVal && !isNaN(minNum) && !isNaN(maxNum) && (minNum > 0 || maxNum > 0)) {
                const isHourly = /hour/i.test(s.unitText || '');
                const fmt = (n) => Number.isInteger(n) ? '$' + n.toLocaleString('en-US') :
                    '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                return `${fmt(minNum)}–${fmt(maxNum)} ${isHourly ? 'per hour' : 'per year'}`;
            } else if (minVal && !isNaN(minNum) && minNum > 0) {
                const isHourly = /hour/i.test(s.unitText || '');
                const fmt = (n) => Number.isInteger(n) ? '$' + n.toLocaleString('en-US') :
                    '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                return `${fmt(minNum)}+ ${isHourly ? 'per hour' : 'per year'}`;
            }
        }

        // ── Source 2: Description text — LABELED patterns only ──
        // These patterns only match when the dollar amount is explicitly preceded by
        // "salary", "compensation", "pay", or "base salary" — never bare $X–$Y ranges
        // which could be bonuses, allowances, or other non-salary figures.
        if (!descriptionText) return '';

        const labeledPatterns = [
            // "Base salary: $X–$Y" / "Base salary range of $X to $Y"
            /base\s+salary\s*(?:range)?\s*(?:of|from|is|:)\s*\$[\d,]+(?:\.\d{1,2})?\s*[kK]?\s*[-–—]\s*\$?[\d,]+(?:\.\d{1,2})?\s*[kK]?(?:\s*(?:per\s+)?(?:year|yr|annually|annum|hour|hr))?/i,
            /base\s+salary\s*(?:range)?\s*(?:of|from|is|:)\s*\$[\d,]+(?:\.\d{1,2})?\s*[kK]?\s+to\s+\$?[\d,]+(?:\.\d{1,2})?\s*[kK]?(?:\s*(?:per\s+)?(?:year|yr|annually|annum|hour|hr))?/i,
            // "Salary range: $X–$Y" / "Pay range: $X to $Y" / "Compensation range: $X–$Y"
            /(?:salary|pay|compensation)\s+range\s*(?:of|from|is|:)?\s*\$[\d,]+(?:\.\d{1,2})?\s*[kK]?\s*[-–—]\s*\$?[\d,]+(?:\.\d{1,2})?\s*[kK]?(?:\s*(?:per\s+)?(?:year|yr|annually|annum|hour|hr))?/i,
            /(?:salary|pay|compensation)\s+range\s*(?:of|from|is|:)?\s*\$[\d,]+(?:\.\d{1,2})?\s*[kK]?\s+to\s+\$?[\d,]+(?:\.\d{1,2})?\s*[kK]?(?:\s*(?:per\s+)?(?:year|yr|annually|annum|hour|hr))?/i,
            // "Salary: $X–$Y" / "Compensation: $X–$Y" / "Pay: $X–$Y"  (after the colon)
            /(?:salary|compensation|pay)\s*:\s*\$[\d,]+(?:\.\d{1,2})?\s*[kK]?\s*[-–—]\s*\$?[\d,]+(?:\.\d{1,2})?\s*[kK]?(?:\s*(?:per\s+)?(?:year|yr|annually|annum|hour|hr))?/i,
            /(?:salary|compensation|pay)\s*:\s*\$[\d,]+(?:\.\d{1,2})?\s*[kK]?\s+to\s+\$?[\d,]+(?:\.\d{1,2})?\s*[kK]?(?:\s*(?:per\s+)?(?:year|yr|annually|annum|hour|hr))?/i,
            // "Starting salary of $X" / "Starting pay of $X per hour"
            /starting\s+(?:salary|pay|compensation)\s*(?:of|at|is)?\s*\$[\d,]+(?:\.\d{1,2})?\s*[kK]?(?:\s*(?:per\s+)?(?:year|yr|annually|annum|hour|hr))?/i,
            // "$X per hour" / "$X/hour" — only when the amount looks like a wage (5–999)
            /\$(\d{1,3}(?:\.\d{1,2})?)\s*(?:per\s+hour|\/hour|\/hr|\s+per\s+hr)/i,
            // "$X annually" / "$X per year" — only when amount is plausible salary (>$10k)
            /\$([\d,]{5,}(?:\.\d{1,2})?)\s*(?:annually|per\s+year|per\s+annum|\/year)/i,
        ];

        for (const p of labeledPatterns) {
            const m = descriptionText.match(p);
            if (m) {
                const raw = m[0].trim();
                // Extra sanity check: the matched text must contain a dollar amount > $0
                if (/\$[\d,]+/.test(raw)) {
                    return formatSalary(raw);
                }
            }
        }

        return '';
    }

    // ===== Extract locations =====
    function extractLocations(jsonLd, domData) {
        const locations = [];

        if (jsonLd?.jobLocation) {
            const jobLocs = Array.isArray(jsonLd.jobLocation) ? jsonLd.jobLocation : [jsonLd.jobLocation];
            for (const loc of jobLocs) {
                if (loc.address) {
                    const city = loc.address.addressLocality || '';
                    const state = normalizeState(loc.address.addressRegion || '');
                    if (city && state) locations.push({ city, state, location: `${city}, ${state}` });
                }
            }
        }

        if (locations.length === 0 && domData.city) {
            const state = normalizeState(domData.state || '');
            locations.push({
                city: domData.city,
                state,
                location: state ? `${domData.city}, ${state}` : domData.city
            });
        }

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

    // Title: DOM > JSON-LD > preloaded
    const positionTitle = domData.title || jsonLd?.title || preloaded.jobTitle || '';

    // Category: DOM > preloaded > JSON-LD industry
    const category = domData.category || preloaded.jobCategoryName || jsonLd?.industry || '';

    // Derive AOP and Position using all sources
    const areaOfPractice = determineAreaOfPractice(positionTitle, category, fullDescription);
    const position = determinePosition(positionTitle, category, areaOfPractice, fullDescription);
    const salary = extractSalary(jsonLd, fullDescription);
    const locations = extractLocations(jsonLd, domData);

    // Build result — one entry per location (usually one for MedVet)
    if (locations.length > 0) {
        return locations.map(loc => ({
            areaOfPractice,
            position,
            salary,
            hospitalName: buildHospitalName(loc.city),
            description: fullDescription,
            city: loc.city || '',
            state: loc.state || '',
            location: loc.location || ''
        }));
    }

    return [{
        areaOfPractice,
        position,
        salary,
        hospitalName: buildHospitalName(domData.city || ''),
        description: fullDescription,
        city: domData.city || '',
        state: normalizeState(domData.state || ''),
        location: ''
    }];
})();
