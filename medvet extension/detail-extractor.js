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
                // Always use $ so the text-pattern matcher can find it
                if (typeof s === 'number' && s > 0) {
                    const unit = /hour/i.test(jsonLd.baseSalary.unitText || '') ? 'HOUR' : 'YEAR';
                    jsonLdText += `Salary Range: $${s} ${unit}\n`;
                } else {
                    const minVal = s.minValue ? String(s.minValue).trim() : '';
                    const maxVal = s.maxValue ? String(s.maxValue).trim() : '';
                    const unit   = s.unitText || '';
                    if (minVal && maxVal) {
                        jsonLdText += `Salary Range: $${minVal} - $${maxVal} ${unit}\n`;
                    } else if (minVal) {
                        jsonLdText += `Salary Range: $${minVal} ${unit}\n`;
                    } else if (maxVal) {
                        jsonLdText += `Salary Range: $${maxVal} ${unit}\n`;
                    }
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

    // ===== State maps =====
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
    // Reverse map: abbreviation → full name
    const STATE_FULL = {
        'AL':'Alabama','AK':'Alaska','AZ':'Arizona','AR':'Arkansas','CA':'California',
        'CO':'Colorado','CT':'Connecticut','DE':'Delaware','FL':'Florida','GA':'Georgia',
        'HI':'Hawaii','ID':'Idaho','IL':'Illinois','IN':'Indiana','IA':'Iowa','KS':'Kansas',
        'KY':'Kentucky','LA':'Louisiana','ME':'Maine','MD':'Maryland','MA':'Massachusetts',
        'MI':'Michigan','MN':'Minnesota','MS':'Mississippi','MO':'Missouri','MT':'Montana',
        'NE':'Nebraska','NV':'Nevada','NH':'New Hampshire','NJ':'New Jersey','NM':'New Mexico',
        'NY':'New York','NC':'North Carolina','ND':'North Dakota','OH':'Ohio','OK':'Oklahoma',
        'OR':'Oregon','PA':'Pennsylvania','RI':'Rhode Island','SC':'South Carolina',
        'SD':'South Dakota','TN':'Tennessee','TX':'Texas','UT':'Utah','VT':'Vermont',
        'VA':'Virginia','WA':'Washington','WV':'West Virginia','WI':'Wisconsin','WY':'Wyoming',
        'DC':'District of Columbia'
    };
    // normalizeState: full name → abbreviation (used internally for AOP/position logic)
    function normalizeState(s) {
        if (!s) return '';
        const t = s.trim();
        if (t.length === 2) return t.toUpperCase();
        return STATE_ABBREV[t.toLowerCase()] || t;
    }
    // expandState: abbreviation → full name (used when saving state to records)
    function expandState(s) {
        if (!s) return '';
        const t = s.trim();
        if (t.length === 2) return STATE_FULL[t.toUpperCase()] || t;
        // Already full name — capitalise properly
        return STATE_FULL[normalizeState(t)] || t;
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
        // Return sentinel '_NON_CLINICAL_' so determinePosition can skip ALL further fallbacks.
        if (isNonClinicalTitle(t)) return '_NON_CLINICAL_';

        // ── Fallback: try category string mapping ──
        // Only reached by clinical roles (DVM/tech) whose title didn't contain a specialty keyword.
        const fromCat = matchPositionFromCategory(c || category);
        if (fromCat) return fromCat;

        return '';
    }

    // ===== Helper: detect admin/support titles that should never get a clinical position =====
    function isNonClinicalTitle(tLower) {
        return tLower.includes('client service') || tLower.includes('service representative') ||
            tLower.includes('receptionist') || tLower.includes('kennel') ||
            tLower.includes('groomer') || tLower.includes('grooming') ||
            tLower.includes('practice manager') || tLower.includes('hospital manager') ||
            tLower.includes('office manager') || tLower.includes('administrator') ||
            tLower.includes('billing') || tLower.includes('human resources') ||
            tLower.includes('patient care coordinator') || tLower.includes('client care coordinator') ||
            tLower.includes('customer service') || tLower.includes('front desk') ||
            tLower.includes('inventory') || tLower.includes('housekeeper') || tLower.includes('janitorial');
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

        // ── TITLE OVERRIDE: explicit "urgent care" in the job title always wins,
        //    even if the Jobvite category is "Emergency and Critical Care". ──
        if (t.includes('urgent care')) return 'Urgent Care';

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
        // Step 0: Non-clinical guard — admin/support roles get no position at all.
        // Must run before any category fallback so a CSR in Ophthalmology dept
        // doesn't inherit "Ophthalmologist" from the category.
        if (isNonClinicalTitle(title.toLowerCase())) return '';

        // Step 1: Match from title (+ category as fallback)
        let position = matchPositionFromTitle(title, category);
        if (position === '_NON_CLINICAL_') return ''; // sentinel safety net

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
    function extractSalary(jsonLd, descriptionText) {
        const fmt = (n) => Number.isInteger(n)
            ? '$' + n.toLocaleString('en-US')
            : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        // Helper: parse a raw dollar string like "$150,000", "150k", "150000" → number
        function parseDollar(raw) {
            let s = raw.replace(/[$,\s]/g, '');
            const kMatch = s.match(/^([\d.]+)[kK]$/);
            if (kMatch) return parseFloat(kMatch[1]) * 1000;
            return parseFloat(s) || 0;
        }

        // ── Source 1: JSON-LD baseSalary (most reliable) ──
        if (jsonLd?.baseSalary?.value) {
            const s = jsonLd.baseSalary.value;
            const isHourly = /hour/i.test(s.unitText || jsonLd.baseSalary.unitText || '');
            const unit = isHourly ? 'per hour' : 'per year';

            if (typeof s === 'number' && s > 0) {
                return `${fmt(s)} ${unit}`;
            }
            const minNum = parseFloat(String(s.minValue || '').replace(/,/g, '')) || 0;
            const maxNum = parseFloat(String(s.maxValue || '').replace(/,/g, '')) || 0;
            if (minNum > 0 && maxNum > 0) return `${fmt(minNum)}–${fmt(maxNum)} ${unit}`;
            if (minNum > 0) return `${fmt(minNum)}+ ${unit}`;
            if (maxNum > 0) return `Up to ${fmt(maxNum)} ${unit}`;
        }

        if (!descriptionText) return '';

        // ── Source 2: Text patterns — ordered from most specific to broadest ──
        // RANGE: allows optional /hour|/hr between the two amounts (handles "$24/hour to $29/hour")
        const RANGE  = `\\$[\\d,]+(?:\\.\\d{1,2})?\\s*[kK]?\\s*(?:\\/(?:hour|hr))?\\s*(?:-|–|—|to)\\s*\\$?[\\d,]+(?:\\.\\d{1,2})?\\s*[kK]?`;
        const SINGLE = `\\$[\\d,]+(?:\\.\\d{1,2})?\\s*[kK]?`;
        const UNIT   = `(?:\\s*(?:per\\s+)?(?:year|yr|annually|annum|hour|hr|\\/hr|\\/year))?`;

        const patterns = [
            // — Labeled range patterns —
            // "Base salary range for this position is $X–$Y"
            new RegExp(`base\\s+salary[^$]{0,60}${RANGE}${UNIT}`, 'i'),
            // "The posted range for this position is $33-$44hr" (most common MedVet format)
            new RegExp(`posted\\s+range[^$]{0,40}${RANGE}${UNIT}`, 'i'),
            // "Hiring Range: $24/hour to $29/hour" / "hiring range of $18.75-38.00/hr"
            new RegExp(`hiring\\s+range[^$]{0,30}${RANGE}${UNIT}`, 'i'),
            // "Salary [range] / Pay range / Compensation range ... $X - $Y"
            new RegExp(`(?:salary|pay|compensation|income)\\s*(?:range|guarantee)?[^$]{0,40}${RANGE}${UNIT}`, 'i'),
            // "Total [target] compensation ... $X - $Y"
            new RegExp(`total\\s+(?:target\\s+)?compensation[^$]{0,40}${RANGE}${UNIT}`, 'i'),
            // "Expected [annual] salary [range] $X - $Y"
            new RegExp(`expected\\s+(?:annual\\s+)?(?:salary|compensation|pay)[^$]{0,40}${RANGE}${UNIT}`, 'i'),
            // "Starting salary/pay $X - $Y"
            new RegExp(`starting\\s+(?:salary|pay|compensation)[^$]{0,20}${RANGE}${UNIT}`, 'i'),
            // "Earn[ing[s]] $X - $Y"
            new RegExp(`earn(?:ing[s]?)?\\s*(?:up\\s+to\\s+)?${RANGE}${UNIT}`, 'i'),
            // "$X - $Y per year/annually/per hour" (bare range with explicit trailing unit)
            new RegExp(`${RANGE}\\s*(?:per\\s+year|annually|per\\s+annum|\\/year|per\\s+hour|\\/hour|\\/hr|per\\s+hr)`, 'i'),

            // — Labeled single-value patterns —
            // "$100,000 base salary [year one]" — label comes AFTER the dollar sign
            new RegExp(`${SINGLE}\\s+(?:base\\s+)?salary\\b`, 'i'),
            // "Salary: $X" / "Compensation: $X" / "Pay: $X"
            new RegExp(`(?:salary|compensation|pay|income|hiring)\\s*(?:range|guarantee)?[^$]{0,20}${SINGLE}${UNIT}`, 'i'),
            // "Total compensation of/up to $X"
            new RegExp(`total\\s+(?:target\\s+)?compensation[^$]{0,20}${SINGLE}${UNIT}`, 'i'),
            // "Earn[ing] up to $X per year/hour"
            new RegExp(`earn(?:ing[s]?)?\\s+(?:up\\s+to\\s+)?${SINGLE}\\s*(?:per\\s+year|annually|\\/year|per\\s+hour|\\/hour|\\/hr)`, 'i'),
            // "$X per hour" (hourly wage, explicit unit)
            /\$(\d{1,3}(?:\.\d{1,2})?)\s*(?:per\s+hour|\/hour|\/hr|\s+per\s+hr)/i,
            // "$X,000+ annually" / "$X annually"
            /\$([\d,]{5,}(?:\.\d{1,2})?)\s*\+?\s*(?:annually|per\s+year|per\s+annum|\/year)/i,
        ];

        for (const p of patterns) {
            const m = descriptionText.match(p);
            if (!m) continue;
            const raw = m[0].trim();
            if (!/\$[\d,]/.test(raw)) continue;

            // Extract all dollar amounts from the matched text
            const amounts = [];
            const re = /\$([\d,]+(?:\.\d{1,2})?)\s*([kK])?/g;
            let am;
            while ((am = re.exec(raw)) !== null) {
                let n = parseFloat(am[1].replace(/,/g, ''));
                if (am[2]) n *= 1000;
                if (n > 0) amounts.push(n);
            }
            // Also handle bare number after "to/-/–" (e.g. "$150,000 to 200,000")
            const toMatch = raw.match(/(?:to|-|–|—)\s*([\d,]+(?:\.\d{1,2})?)\s*([kK])?/i);
            if (toMatch && amounts.length === 1) {
                let n = parseFloat(toMatch[1].replace(/,/g, ''));
                if (toMatch[2]) n *= 1000;
                if (n > 0) amounts.push(n);
            }

            if (amounts.length === 0) continue;

            const minAmt = Math.min(...amounts);
            const maxAmt = Math.max(...amounts);

            // Hourly detection: explicit unit text OR amount clearly in hourly wage range (< $500)
            // Nobody earns $500/year, so sub-$500 amounts with a salary keyword = hourly wages.
            const hasHourlyText = /per\s+hour|\/hour|\/hr|\dhr\b/i.test(raw);
            const isHourlyMatch = hasHourlyText || (maxAmt > 0 && maxAmt < 500);

            // Plausibility guard: skip tiny amounts that are bonuses/allowances, not wages
            if (isHourlyMatch && maxAmt < 7) continue;
            if (!isHourlyMatch && maxAmt < 20000) continue;

            const unit = isHourlyMatch ? 'per hour' : 'per year';
            if (amounts.length >= 2) return `${fmt(minAmt)}–${fmt(maxAmt)} ${unit}`;
            return `${fmt(amounts[0])} ${unit}`;
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
                    const state = expandState(loc.address.addressRegion || '');
                    if (city && state) locations.push({ city, state, location: `${city}, ${state}` });
                }
            }
        }

        if (locations.length === 0 && domData.city) {
            const state = expandState(domData.state || '');
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

    // ===== Extract job type =====
    // Rules: Part Time only if part-time is mentioned AND full-time is NOT mentioned.
    // Full Time if full-time is mentioned, both are mentioned, or neither is mentioned.
    function extractJobType(text) {
        const t = (text || '').toLowerCase();
        const hasPart = /part[\s\-]?time/.test(t);
        const hasFull = /full[\s\-]?time/.test(t);
        if (hasPart && !hasFull) return 'Part Time';
        return 'Full Time';  // full-time only, both, or neither
    }

    const jobType = extractJobType(fullDescription);

    // Build result — one entry per location (usually one for MedVet)
    if (locations.length > 0) {
        return locations.map(loc => ({
            areaOfPractice,
            position,
            salary,
            jobType,
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
        jobType,
        hospitalName: buildHospitalName(domData.city || ''),
        description: fullDescription,
        city: domData.city || '',
        state: expandState(domData.state || ''),
        location: ''
    }];
})();
