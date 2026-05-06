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
        if (!result.title) {
            const smartTitle = document.querySelector('.job-title[itemprop="title"], .job-title, h1[itemprop="title"]');
            if (smartTitle) result.title = smartTitle.innerText.trim();
        }

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
        if (!result.hospitalName) {
            const smartLogoLink = document.querySelector('.jobad-header .logo a[title], .header-logo a[title]');
            const smartLogoImg = document.querySelector('.jobad-header .logo img[alt], .header-logo img[alt]');
            if (smartLogoLink?.getAttribute('title')) {
                result.hospitalName = smartLogoLink.getAttribute('title').trim();
            } else if (smartLogoImg?.getAttribute('alt')) {
                result.hospitalName = smartLogoImg.getAttribute('alt').replace(/\s+logo$/i, '').trim();
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

    const stateAbbreviations = {
        'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas', 'CA': 'California',
        'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware', 'FL': 'Florida', 'GA': 'Georgia',
        'HI': 'Hawaii', 'ID': 'Idaho', 'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa',
        'KS': 'Kansas', 'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
        'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi', 'MO': 'Missouri',
        'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada', 'NH': 'New Hampshire', 'NJ': 'New Jersey',
        'NM': 'New Mexico', 'NY': 'New York', 'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio',
        'OK': 'Oklahoma', 'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
        'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah', 'VT': 'Vermont',
        'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia', 'WI': 'Wisconsin', 'WY': 'Wyoming',
        'DC': 'District of Columbia', 'PR': 'Puerto Rico'
    };

    function getFullStateName(state) {
        if (!state) return '';
        const cleaned = String(state).trim();
        const upper = cleaned.toUpperCase();
        if (stateAbbreviations[upper]) return stateAbbreviations[upper];
        const fullMatch = Object.values(stateAbbreviations).find(full => full.toLowerCase() === cleaned.toLowerCase());
        return fullMatch || cleaned;
    }

    function getStateAbbrev(state) {
        if (!state) return '';
        const cleaned = String(state).trim();
        const upper = cleaned.toUpperCase();
        if (stateAbbreviations[upper]) return upper;
        const match = Object.entries(stateAbbreviations).find(([, fullName]) => fullName.toLowerCase() === cleaned.toLowerCase());
        return match ? match[0] : '';
    }

    function getDescriptionLines(text) {
        return String(text || '')
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean);
    }

    const APPROVED_POSITIONS = [
        'Associate Veterinarian',
        'Medical Director',
        'Anesthesiologist',
        'Cardiologist',
        'Credentialed Veterinary Technician Specialist',
        'DABVP Specialist',
        'Dental Specialist',
        'Dermatologist',
        'ECC Specialist',
        'Internal Medicine Specialist',
        'Lead Veterinarian',
        'Medical Oncologist',
        'Neurologist & Neurosurgeon',
        'Ophthalmologist',
        'Radiation Oncologist',
        'Radiologist',
        'Surgeon',
        'Partner Veterinarian'
    ];
    const APPROVED_POSITION_SET = new Set(APPROVED_POSITIONS);
    const VALID_POSITIONS_BY_AOP = {
        'Emergency Care': ['Associate Veterinarian', 'Medical Director'],
        'Exotic Pet Medicine': ['Associate Veterinarian'],
        'General Practice Care': ['Associate Veterinarian', 'Lead Veterinarian', 'Medical Director'],
        'Specialty Care': [
            'Anesthesiologist', 'Cardiologist', 'Credentialed Veterinary Technician Specialist',
            'DABVP Specialist', 'Dental Specialist', 'Dermatologist', 'ECC Specialist',
            'Internal Medicine Specialist', 'Medical Director', 'Medical Oncologist',
            'Neurologist & Neurosurgeon', 'Ophthalmologist', 'Radiation Oncologist',
            'Radiologist', 'Surgeon'
        ],
        'Urgent Care': ['Associate Veterinarian', 'Partner Veterinarian', 'Medical Director']
    };

    function hasEccSpecialtyTrainingSignal(text) {
        const source = String(text || '');
        const trainingBeforeRole = /\b(?:board certified|board[-\s]+certified|residency[-\s]+trained|residential[-\s]+trained)\b[\s\S]{0,120}\b(?:ecc|critical care|criticalist|emergency\s*(?:care|medicine)?|er)\b/i;
        const roleBeforeTraining = /\b(?:ecc|critical care|criticalist|emergency\s*(?:care|medicine)?|er)\b[\s\S]{0,120}\b(?:board certified|board[-\s]+certified|residency[-\s]+trained|residential[-\s]+trained)\b/i;
        return trainingBeforeRole.test(source) || roleBeforeTraining.test(source) || /\bdacvecc\b/i.test(source);
    }

    function hasSpecialtyTrainingSignal(text) {
        const source = String(text || '');
        const specialtyTerms = '(?:ecc|critical care|criticalist|emergency\\s*(?:care|medicine)?|er|oncolog|cardiolog|neurolog|dermatolog|radiolog|ophthalmolog|anesth|internal medicine|surgeon|surgery|dent|dacv\\w+|dabvp|davdc)';
        const trainingBeforeSpecialty = new RegExp(`\\b(?:board certified|board[-\\s]+certified|residency[-\\s]+trained|residential[-\\s]+trained|diplomate)\\b[\\s\\S]{0,120}\\b${specialtyTerms}\\b`, 'i');
        const specialtyBeforeTraining = new RegExp(`\\b${specialtyTerms}\\b[\\s\\S]{0,120}\\b(?:board certified|board[-\\s]+certified|residency[-\\s]+trained|residential[-\\s]+trained|diplomate)\\b`, 'i');
        return hasEccSpecialtyTrainingSignal(source) || trainingBeforeSpecialty.test(source) || specialtyBeforeTraining.test(source);
    }

    function getAOPParts(aop) {
        return (aop || '').split('/').map(part => part.trim()).filter(Boolean);
    }

    function validateApprovedPositionForAOP(position, aop) {
        if (!APPROVED_POSITION_SET.has(position)) return '';

        const aopParts = getAOPParts(aop);
        if (aopParts.length === 0) return position;

        for (const part of aopParts) {
            const allowed = VALID_POSITIONS_BY_AOP[part];
            if (allowed && allowed.includes(position)) return position;
        }

        return '';
    }

    function getDefaultPositionForAOP(aop, title = '') {
        const aopParts = getAOPParts(aop);
        const t = (title || '').toLowerCase();

        if (aopParts.includes('Urgent Care') && (t.includes('partner veterinarian') || t.includes('partner vet'))) {
            return 'Partner Veterinarian';
        }

        if (aopParts.some(part => ['General Practice Care', 'Emergency Care', 'Urgent Care', 'Exotic Pet Medicine'].includes(part))) {
            return 'Associate Veterinarian';
        }

        return '';
    }

    function matchApprovedPositionFromText(text) {
        if (!text) return '';

        const rules = [
            ['Medical Director', [/\bmedical director\b/i]],
            ['Lead Veterinarian', [/\blead veterinarian\b/i, /\blead vet\b/i]],
            ['Neurologist & Neurosurgeon', [/\bneurologist\b/i, /\bneurosurgeon\b/i, /\bboard certified\b.*\bneurolog/i, /\bresidency[-\s]+trained\b.*\bneurolog/i, /\bdacvim\b.*\bneurolog/i]],
            ['Dermatologist', [/\bdermatologist\b/i, /\bboard certified\b.*\bdermatolog/i, /\bresidency[-\s]+trained\b.*\bdermatolog/i, /\bdacvd\b/i]],
            ['Cardiologist', [/\bcardiologist\b/i, /\bboard certified\b.*\bcardiolog/i, /\bresidency[-\s]+trained\b.*\bcardiolog/i, /\bdacvim\b.*\bcardiolog/i]],
            ['Radiation Oncologist', [/\bradiation oncolog/i, /\bdacvr[-\s]?ro\b/i, /\bdacvr\b.*\bradiation\b/i]],
            ['Medical Oncologist', [/\bmedical oncolog/i, /\bboard certified\b.*\boncolog/i, /\bresidency[-\s]+trained\b.*\boncolog/i, /\bdacvim\b.*\boncology\b/i]],
            ['Radiologist', [/\bradiologist\b/i, /\bdiagnostic imaging specialist\b/i, /\bboard certified\b.*\bradiolog/i, /\bresidency[-\s]+trained\b.*\bradiolog/i, /\bdacvr\b/i]],
            ['Ophthalmologist', [/\bophthalmologist\b/i, /\bboard certified\b.*\bophthalmolog/i, /\bresidency[-\s]+trained\b.*\bophthalmolog/i, /\bdacvo\b/i]],
            ['Anesthesiologist', [/\banesthesiologist\b/i, /\bboard certified\b.*\banesth/i, /\bresidency[-\s]+trained\b.*\banesth/i, /\bdacvaa\b/i]],
            ['Internal Medicine Specialist', [/\binternist\b/i, /\binternal medicine specialist\b/i, /\bboard certified\b.*\binternal medicine\b/i, /\bresidency[-\s]+trained\b.*\binternal medicine\b/i, /\bdacvim\b(?!.*oncology)(?!.*cardiology)(?!.*neurology)/i]],
            ['ECC Specialist', [/\bcriticalist\b/i, /\becc specialist\b/i, /\bemergency\s*(?:&|and)?\s*critical care specialist\b/i, /\bboard certified\b.*\bcritical/i, /\bresidency[-\s]+trained\b.*\bcritical/i, /\bdacvecc\b/i]],
            ['DABVP Specialist', [/\bdabvp\b/i]],
            ['Dental Specialist', [/\bdental specialist\b/i, /\bveterinary dentist\b/i, /\boral surgeon\b/i, /\bboard certified\b.*\bdent/i, /\bresidency[-\s]+trained\b.*\bdent/i, /\bdavdc\b/i]],
            ['Surgeon', [/\bveterinary surgeon\b/i, /\bsurgeon\b/i, /\bboard certified\b.*\bsurgeon\b/i, /\bresidency[-\s]+trained\b.*\bsurgeon\b/i, /\bdacvs\b/i, /\bacvs\b/i]],
            ['Credentialed Veterinary Technician Specialist', [/\bcredentialed veterinary technician specialist\b/i, /\btechnician specialist\b/i, /\bvts\b/i]]
        ];

        for (const [position, patterns] of rules) {
            if (patterns.some(pattern => pattern.test(text))) {
                if (position === 'Medical Oncologist' && /\bradiation oncolog/i.test(text)) continue;
                if (position === 'Radiologist' && /\bradiation oncolog/i.test(text)) continue;
                if (position === 'Surgeon' && /\bneuro(?:logy|surgeon)\b/i.test(text)) continue;
                if (position === 'Dental Specialist' && /\bassistant\b/i.test(text)) continue;
                return position;
            }
        }

        return '';
    }

    // ===== Map category string to Area of Practice =====
    function categoryToAOP(category) {
        if (!category) return '';
        if (isNonClinicalCategory(category)) return '';
        const cat = category.toLowerCase().trim();
        if (cat.includes('urgent care')) return 'Urgent Care';
        if (cat.includes('specialist') || cat.includes('specialty') || cat.includes('diplomate') || cat.includes('surgeon')) return 'Specialty Care';
        if (cat.includes('gen practice') || /\bgp\b/.test(cat)) return 'General Practice Care';
        if (cat.includes('(er)') || /\b(?:er|emergency)\b/.test(cat)) return 'Emergency Care';
        return '';
    }

    // ===== Determine Area of Practice =====
    function determineAreaOfPractice(title, category, descriptionText) {
        if (/\bpriority\s*pet\b/i.test(`${title}\n${descriptionText}`)) return 'Urgent Care';
        const titleLower = title.toLowerCase();
        const qualSection = extractQualificationsSection(descriptionText) || '';
        if (shouldLeaveClinicalFieldsBlank(title, category)) return '';
        if (isExoticRoleTitle(title)) return 'Exotic Pet Medicine';
        if (/\b(?:board certified|board[-\s]+certified|residency[-\s]+trained|residential[-\s]+trained|diplomate)\b/i.test(qualSection)) return 'Specialty Care';
        // STEP 1: Use category from page (most reliable — directly from jobvite)
        const categoryLower = String(category || '').toLowerCase();
        if (categoryLower.includes('medical director')) {
            const combined = `${title}\n${qualSection}`;
            if (/\bspecialty medical director\b|\bspecialty hospital\b|\bspecialty services?\b/i.test(combined)) return 'Specialty Care';
            if (/\bemergency veterinary medical director\b|\bemergency (?:&|and)? referral\b/i.test(combined)) return 'Emergency Care';
            if (hasExoticRequirementSignal(qualSection)) return 'Exotic Pet Medicine';
            return 'General Practice Care';
        }

        const aopFromCategory = categoryToAOP(category);
        if (aopFromCategory) return aopFromCategory;

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
        if (isExoticRoleTitle(title)) return 'Exotic Pet Medicine';
        if (titleLower.includes('equine') || titleLower.includes('bovine') || titleLower.includes('large animal')) return 'General Practice Care';

        // STEP 6: Check qualifications/description for specialty requirements only after
        // explicit category/title signals. ER listings often mention specialty teams.
        if (qualSection && hasSpecialtyTrainingSignal(qualSection)) return 'Specialty Care';
        if (qualSection) {
            const qualLower = qualSection.toLowerCase();
            for (const cert of specialtyCerts) {
                if (qualLower.includes(cert)) return 'Specialty Care';
            }
        }

        return hasClinicalTitleSignal(title) ? 'General Practice Care' : '';
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

    function extractRoleSignalText(text) {
        if (!text) return '';

        const rolePattern = /\b(?:medical director|lead veterinarian|lead vet|board certified|residency[-\s]+trained|residential[-\s]+trained|diplomate|criticalist|ecc specialist|emergency\s*(?:&|and)?\s*critical care specialist|internist|internal medicine specialist|cardiologist|dermatologist|neurologist|neurosurgeon|ophthalmologist|radiologist|diagnostic imaging specialist|anesthesiologist|medical oncologist|radiation oncologist|veterinary dentist|dental specialist|oral surgeon|veterinary surgeon|credentialed veterinary technician specialist|technician specialist|\bvts\b|\bdacv(?:ecc|im|r|s|d|o|aa)?\b|\bdacvr[-\s]?ro\b|\bdavdc\b|\bdabvp\b)\b/i;
        const blockedPattern = /\b(?:our services|services include|specialties include|benefits|medical(?:,\s*|\s+)dental|dental insurance|our hospital|our team has|state[-\s]?of[-\s]?the[-\s]?art|we offer|years of experience in specialty and emergency services)\b/i;
        const qualificationsSection = extractQualificationsSection(text);
        const collected = [];
        const seen = new Set();

        if (qualificationsSection) {
            seen.add(qualificationsSection);
            collected.push(qualificationsSection);
        }

        for (const rawLine of text.split('\n')) {
            const line = rawLine.trim();
            if (!line || !rolePattern.test(line) || blockedPattern.test(line) || seen.has(line)) continue;
            seen.add(line);
            collected.push(line);
        }

        return collected.join('\n');
    }

    // ===== Match position from title keywords =====
    // Returns a raw position name based on title keywords
    // PRIORITY ORDER: Leadership first (to avoid false matches on service names), then specialty, then generic
    function matchPositionFromTitle(title) {
        const t = (title || '').toLowerCase();

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
        if (t.includes('internist') || t.includes('internal medicine')) return 'Internal Medicine Specialist';
        if (t.includes('criticalist') || t.match(/\becc\b/) || t.includes('emergency medicine')) return 'ECC Specialist';
        if (t.includes('dabvp')) return 'DABVP Specialist';
        if ((t.includes('dental') || t.includes('dentist') || t.includes('dentistry')) && !t.includes('assistant')) return 'Dental Specialist';
        // For surgeon, be more specific - check it's not part of neurosurgeon (which we already handled)
        if ((t.includes('surgeon') || t.includes('surgery')) && !t.includes('neurosurgeon') && !t.includes('neurology') && !t.includes('dental') && !t.includes('dentistry')) return 'Surgeon';

        // === VTS/CREDENTIALED SPECIALIST (check before generic technician) ===
        if (t.includes('technician specialist') || (t.match(/\bvts\b/) && t.includes('specialist'))) return 'Credentialed Veterinary Technician Specialist';

        // === GENERIC VETERINARIAN ROLES ===
        if (t.includes('partner veterinarian') || t.includes('partner vet') || t.includes('equity owner')) return 'Partner Veterinarian';
        if (/\b(?:associate\s+)?(?:emergency|er|urgent care|urgent)?\s*(?:veterinarian|vet|dvm)\b/.test(t)) return 'Associate Veterinarian';
        if (/\bassociate veterinarian\b|\bassociate vet\b/.test(t)) return 'Associate Veterinarian';

        return '';
    }

    // ===== Match position from qualifications section (for generic titles) =====
    function matchPositionFromQualifications(descriptionText) {
        return matchApprovedPositionFromText(extractRoleSignalText(descriptionText));
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
        if (!areaOfPractice) return '';
        // 1. Try to match from title
        let position = matchPositionFromTitle(title);

        // 2. If no match from title and AOP is Specialty Care, try qualifications
        if (!position) {
            position = matchPositionFromQualifications(descriptionText);
        }

        // 3. Validate position against AOP — ensure it's a valid combo
        if (position) {
            position = validateApprovedPositionForAOP(position, areaOfPractice);
        }

        // 4. Special case: if title explicitly says "Medical Director" but AOP validation
        //    downgraded it (e.g., ER category), keep it as Medical Director — it's valid in GP and Specialty
        if (!APPROVED_POSITION_SET.has(position)) {
            position = '';
        }

        return position || getDefaultPositionForAOP(areaOfPractice, title);
    }

    // ===== Validate that position is allowed for the given AOP =====
    function validatePositionForAOP(position, aop) {
        const validPositions = {
            'Emergency Care': ['Associate Veterinarian', 'Medical Director'],
            'Exotic Pet Medicine': ['Associate Veterinarian'],
            'General Practice Care': ['Associate Veterinarian', 'Lead Veterinarian', 'Medical Director'],
            'Specialty Care': [
                'Anesthesiologist', 'Cardiologist', 'Credentialed Veterinary Technician Specialist',
                'DABVP Specialist', 'Dental Specialist', 'Dermatologist', 'ECC Specialist',
                'Internal Medicine Specialist', 'Medical Director', 'Medical Oncologist',
                'Neurologist & Neurosurgeon', 'Ophthalmologist', 'Radiation Oncologist',
                'Radiologist', 'Surgeon'
            ],
            'Urgent Care': ['Associate Veterinarian', 'Partner Veterinarian', 'Medical Director'],
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

    // ===== Format salary to standard "$X–$Y per year" or "$X per hour" =====
    function formatSalary(raw) {
        if (!raw) return '';

        // Check if it's hourly
        const isHourly = /(?:per\s+)?(?:hour|hr|\/hr)/i.test(raw);

        // Extract all dollar amounts from the string
        const amounts = [];
        const hasThousandSuffix = /\$?\s*\d+(?:\.\d+)?\s*k\b/i.test(raw);
        const amountRegex = /\$?\s*([\d,]+(?:\.\d{2})?)\s*k?\b/gi;
        let match;
        while ((match = amountRegex.exec(raw)) !== null) {
            let num = parseFloat(match[1].replace(/,/g, ''));
            // If "k" follows the number, multiply by 1000
            const afterMatch = raw.substring(match.index + match[0].length - 1, match.index + match[0].length + 1);
            if (/k/i.test(match[0]) || /k/i.test(afterMatch) || (hasThousandSuffix && num < 1000)) {
                num = num * 1000;
            }
            if (num > 0) amounts.push(num);
        }

        if (amounts.length === 0) return raw;

        // Format number with commas, no decimals for whole numbers
        const fmt = (n) => {
            if (Number.isInteger(n)) return '$' + n.toLocaleString('en-US');
            return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        };

        const unit = isHourly ? 'per hour' : 'per year';

        if (amounts.length >= 2) {
            const min = Math.min(amounts[0], amounts[1]);
            const max = Math.max(amounts[0], amounts[1]);
            return `${fmt(min)}–${fmt(max)} ${unit}`;
        }

        // Single amount
        if (/\b(?:starting\s+at|starts?\s+at|from|minimum|min\.?|at least)\b/i.test(raw)) {
            return `${fmt(amounts[0])}+ ${unit}`;
        }
        return `${fmt(amounts[0])} ${unit}`;
    }

    // ===== Extract salary =====
    function extractSalary(jsonLd, descriptionText) {
        // 1. Try JSON-LD baseSalary (check values are not empty)
        if (jsonLd?.baseSalary?.value) {
            const s = jsonLd.baseSalary.value;
            const minVal = s.minValue ? String(s.minValue).trim() : '';
            const maxVal = s.maxValue ? String(s.maxValue).trim() : '';
            if (minVal && maxVal) {
                const unit = s.unitText || 'per year';
                const isHourly = /hour/i.test(unit);
                const min = parseFloat(minVal.replace(/,/g, ''));
                const max = parseFloat(maxVal.replace(/,/g, ''));
                const fmt = (n) => {
                    if (Number.isInteger(n)) return '$' + n.toLocaleString('en-US');
                    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                };
                return `${fmt(min)}–${fmt(max)} ${isHourly ? 'per hour' : 'per year'}`;
            } else if (minVal) {
                const min = parseFloat(minVal.replace(/,/g, ''));
                const fmt = (n) => {
                    if (Number.isInteger(n)) return '$' + n.toLocaleString('en-US');
                    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                };
                return `${fmt(min)}+ per year`;
            }
        }

        // 2. Extract from description text
        if (!descriptionText) return '';
        const text = descriptionText;

        const salaryPatterns = [
            /(?:salary|pay|compensation)\s+range\s+can\s+vary\s+from\s+\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s+(?:to|-|–|—)\s+\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?/i,
            /(?:salary|pay|compensation)\s+range\s*[-:]\s*\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s*(?:-|–|—|to)\s*\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?/i,
            /(?:range\s+for\s+a\s+)?base\s+salary\s+(?:is|of|from|:)\s*\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s*(?:-|–|—|to)\s*\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?/i,
            /(?:base\s+salary|salary|pay|compensation)\s+starting\s+at\s+\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?/i,
            // "Base salary ranges: $150k - $171k" or "base salary range of $140,000 – 160,000"
            /(?:base\s+salary\s*(?:ranges?)?)\s*(?:of|from|is|:)\s*\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s*[-–—]\s*\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?/i,
            /(?:base\s+salary\s*(?:ranges?)?)\s*(?:of|from|is|:)\s*\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s+to\s+\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?/i,
            // "Pay range: $95,000 - $160,000" or "Salary range: $120,000 - $140,000"
            /(?:(?:pay|salary|compensation)\s+range)\s*(?:of|from|is|:)\s*\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s*[-–—]\s*\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?/i,
            /(?:(?:pay|salary|compensation)\s+range)\s*(?:of|from|is|:)\s*\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s+to\s+\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?/i,
            // "Salary: $130,000-$200,000" or "Compensation: $110,000 to $180,000"
            /(?:salary|compensation|pay)[:\s]+\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s*[-–—]\s*\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?(?:\s*(?:per\s+)?(?:year|annually|annum|annual))?/i,
            /(?:salary|compensation|pay)[:\s]+\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s+to\s+\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?(?:\s*(?:per\s+)?(?:year|annually|annum|annual))?/i,
            // "$130,000-$200,000" or "$130,000 to $200,000"
            /\$[\d,]+(?:\.\d{2})?\s*[-–—]\s*\$[\d,]+(?:\.\d{2})?/i,
            /\$[\d,]+(?:\.\d{2})?\s+to\s+\$[\d,]+(?:\.\d{2})?/i,
            // "$150k - $171k" or "$165 to $185/k"
            /\$[\d,]+\s*(?:\/k|k)\s*[-–—]+\s*\$?[\d,]+\s*(?:\/k|k)/i,
            /\$[\d,]+\s*(?:\/k|k)?\s+to\s+\$?[\d,]+\s*(?:\/k|k)/i,
            // "earn $250,000 annually"
            /(?:earn|earning)\s+\$[\d,]+(?:\.\d{2})?\s*(?:annually|per\s*year)?/i,
            // "$250,000 annually" or "$250,000 per year"
            /\$[\d,]+(?:\.\d{2})?\s*(?:annually|per\s*year|per\s*annum)/i,
            // "$95 per hour" or "$95/hr"
            /\$[\d,]+(?:\.\d{2})?\s*(?:per\s+)?(?:hour|hr|\/hr)/i,
            /(?:PROSAL|salary|pay|compensation|base\s+salary)[^.\n]{0,160}?(?:range\s+)?(?:starting\s+at|starts?\s+at|from|of|:)\s*\$?[\d,]+(?:\.\d+)?\s*k?(?:\s*\/\s*(?:year|yr|hour|hr)|\s*(?:per\s+)?(?:year|yr|hour|hr|annually))?/i,
        ];
        for (const pattern of salaryPatterns) {
            const m = text.match(pattern);
            if (m) return formatSalary(m[0].trim());
        }
        return '';
    }

    function extractExperience(descriptionText) {
        if (!descriptionText) return '';

        const yearToken = '(?:years?|yrs?\\.?)';
        const qualificationsSection = extractQualificationsSection(descriptionText);
        const candidateLines = [];

        if (qualificationsSection) {
            candidateLines.push(...qualificationsSection.split('\n'));
        }
        candidateLines.push(...descriptionText.split('\n'));

        const prioritizedLines = candidateLines
            .map(line => line.trim())
            .filter(Boolean)
            .filter(line => /\b(?:experience|experienced|minimum|min\.?|at least|required|requirements?|qualifications?|practice setting|years in practice)\b/i.test(line))
            .filter(line => !/\b(?:our team has|over\s+\d+\s+years of experience|years of experience in specialty and emergency services|serving\s+the\s+community|we offer|benefits|medical(?:,\s*|\s+)dental)\b/i.test(line));

        const patterns = [
            new RegExp(`\\b(\\d+)\\s*[-–—]\\s*(\\d+)\\s*${yearToken}\\s+(?:of\\s+)?experience\\b`, 'i'),
            new RegExp(`\\b(\\d+)\\s+to\\s+(\\d+)\\s*${yearToken}\\s+(?:of\\s+)?experience\\b`, 'i'),
            new RegExp(`\\bexperience\\s+(?:should\\s+be|must\\s+be|is|of|required(?:\\s+is)?|requires|:)?\\s*(\\d+)\\s*[-–—]\\s*(\\d+)\\s*${yearToken}\\b`, 'i'),
            new RegExp(`\\bexperience\\s+(?:should\\s+be|must\\s+be|is|of|required(?:\\s+is)?|requires|:)?\\s*(\\d+)\\s+to\\s+(\\d+)\\s*${yearToken}\\b`, 'i'),
            new RegExp(`\\b(?:minimum|min\\.?|at\\s+least)\\s+(\\d+)\\s*[-–—]\\s*(\\d+)\\s*${yearToken}\\b`, 'i'),
            new RegExp(`\\b(\\d+)\\+?\\s*${yearToken}\\s+(?:of\\s+)?experience\\b`, 'i'),
            new RegExp(`\\bexperience\\s+(?:should\\s+be|must\\s+be|is|of|required(?:\\s+is)?|requires|:)?\\s*(\\d+)\\+?\\s*${yearToken}\\b`, 'i'),
            new RegExp(`\\b(?:minimum|min\\.?|at\\s+least)\\s+(\\d+)\\+?\\s*${yearToken}\\b`, 'i'),
            new RegExp(`\\b(\\d+)\\+?\\s*${yearToken}\\s+(?:in\\s+(?:practice|a\\s+practice\\s+setting)|practice\\s+setting)\\b`, 'i')
        ];

        function formatExperience(match) {
            const minYears = match[1];
            const maxYears = match[2];
            if (minYears && maxYears) {
                return `${minYears}-${maxYears} years`;
            }

            const years = minYears || maxYears;
            if (!years) return '';

            if (/\+/.test(match[0]) || /\b(?:minimum|min\.?|at least)\b/i.test(match[0])) {
                return `${years}+ years`;
            }

            return `${years} ${years === '1' ? 'year' : 'years'}`;
        }

        for (const source of prioritizedLines) {
            for (const pattern of patterns) {
                const match = source.match(pattern);
                if (match) return formatExperience(match);
            }
        }

        return '';
    }

    function isNonClinicalCategory(category) {
        const cat = (category || '').toLowerCase();
        return !!(
            cat &&
            !/\bveterinarian\b|\bveterinary\b|\bvet\b|\bdvm\b/i.test(cat) &&
            /\b(?:business development|support center|corporate|operations|marketing|finance|accounting|human resources|recruiting|talent|administrative|management|technology|it|sales)\b/i.test(cat)
        );
    }

    function hasClinicalTitleSignal(title) {
        return /\b(?:veterinarian|veterinary|vet|dvm|medical director|surgeon|oncologist|cardiologist|radiologist|internist|dermatologist|neurologist|ophthalmologist|anesthesiologist|criticalist|dentist|oral surgeon)\b/i.test(title || '');
    }

    function shouldLeaveClinicalFieldsBlank(title, category) {
        return isNonClinicalCategory(category) && !hasClinicalTitleSignal(title);
    }

    function isExoticRoleTitle(title) {
        const t = (title || '').toLowerCase();
        return /\b(?:exotic|avian)\s+(?:veterinarian|vet|dvm)\b/i.test(t) ||
            /\b(?:veterinarian|vet|dvm)\b[^,\n()]{0,40}\b(?:exotic|avian)\b/i.test(t);
    }

    function hasExoticRequirementSignal(text) {
        const source = String(text || '');
        if (/\b(?:would\s+not\s+be|required\s+is\s+not|not)\s+required\b/i.test(source) || /\bnot\s+a\s+requirement\b/i.test(source)) return false;
        const exoticNearRequirement = /\b(?:exotic|avian|reptiles?|small mammals?|pocket pets?)\b[\s\S]{0,100}\b(?:required|must|need|looking for|experience|skilled|proficient)\b/i;
        const requirementNearExotic = /\b(?:required|must|need|looking for|experience|skilled|proficient)\b[\s\S]{0,100}\b(?:exotic|avian|reptiles?|small mammals?|pocket pets?)\b/i;
        return exoticNearRequirement.test(source) || requirementNearExotic.test(source);
    }

    function extractJobType(text) {
        if (!text) return 'Full-Time';

        const employmentLine = getDescriptionLines(text).find(line => /^(?:full|part)[-\s]?time$/i.test(line));
        if (employmentLine) return /^part/i.test(employmentLine) ? 'Part-Time' : 'Full-Time';

        const empTypeMatch = text.match(/employment type:\s*([^\n]+)/i);
        if (empTypeMatch) {
            const empType = empTypeMatch[1].trim().toLowerCase();
            if (empType.includes('part') && !empType.includes('full')) return 'Part-Time';
            return 'Full-Time';
        }

        const hasPartTime = /\bpart[\s-]?time\b/i.test(text);
        const hasFullTime = /\bfull[\s-]?time\b/i.test(text);
        if (hasPartTime && !hasFullTime) return 'Part-Time';
        return 'Full-Time';
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

    function extractCompleteAddress(text) {
        const lines = getDescriptionLines(text);

        function parseAddressLine(rawLine) {
            let line = rawLine.replace(/^\s*-\s*/, '').replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim();
            if (!line) return null;
            if (/\||\blocations?\s+(?:and\s+locations?\s+)?(?:coming\s+soon\s+)?include\b/i.test(line)) return null;

            const parts = line.split(',').map(part => part.trim()).filter(Boolean);
            const last = parts[parts.length - 1] || '';
            if (/^(?:USA|United States)$/i.test(last)) parts.pop();
            if (parts.length === 2 && /^TBD$/i.test(parts[0]) && /^TBD$/i.test(parts[1])) {
                return {
                    streetAddress: 'TBD',
                    city: 'TBD',
                    state: 'TBD',
                    stateAbbrev: '',
                    zipCode: '',
                    location: 'TBD'
                };
            }
            if (parts.length < 3) return null;

            const statePart = parts[parts.length - 1];
            let stateAbbrev = '';
            let stateFull = '';
            let zipCode = '';
            const abbrevZip = statePart.match(/^([A-Z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/);
            if (abbrevZip) {
                stateAbbrev = abbrevZip[1];
                stateFull = getFullStateName(stateAbbrev);
                zipCode = abbrevZip[2] || '';
            } else {
                const fullStateZip = statePart.match(/^([A-Za-z][A-Za-z\s.]+?)(?:\s+(\d{5}(?:-\d{4})?))?$/);
                if (!fullStateZip) return null;
                if (/^[A-Za-z]{2}$/.test(fullStateZip[1]) && !/^TBD$/i.test(fullStateZip[1])) return null;
                stateAbbrev = getStateAbbrev(fullStateZip[1]);
                if (!stateAbbrev && !/^TBD$/i.test(fullStateZip[1])) return null;
                stateFull = /^TBD$/i.test(fullStateZip[1]) ? 'TBD' : getFullStateName(fullStateZip[1]);
                zipCode = fullStateZip[2] || '';
            }

            const city = parts[parts.length - 2] || '';
            let street = parts.slice(0, -2).join(', ').trim();
            street = street.replace(/^TBD-?$/i, 'TBD');
            if (!street || !city || !/^(?:TBD|[A-Za-z][A-Za-z\s.'-]*)$/i.test(city)) return null;
            if (/\bto\b/i.test(city)) return null;
            if (!/\d/.test(street) && !/^TBD$/i.test(street) && street.split(/\s+/).length > 6) return null;

            return {
                streetAddress: street,
                city,
                state: stateFull,
                stateAbbrev,
                zipCode,
                location: stateAbbrev ? `${city}, ${stateAbbrev}` : city
            };
        }

        for (let i = lines.length - 1; i >= 0; i--) {
            const parsed = parseAddressLine(lines[i]);
            if (parsed) return parsed;
        }

        return { streetAddress: '', city: '', state: '', stateAbbrev: '', zipCode: '', location: '' };
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

    function cleanHospitalName(name) {
        return String(name || '')
            .replace(/\s+logo$/i, '')
            .replace(/[.,;:]+$/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/[A-Za-z][A-Za-z']*/g, (word) => {
                if (word.length <= 1) return word.toUpperCase();
                return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
            });
    }

    function isGenericHospitalName(name) {
        return !name || /^(?:Alliance Animal Health|Alliance Animal Health \(Parent Client\))$/i.test(cleanHospitalName(name));
    }

    function firstSpecificHospital(pattern) {
        const match = fullDescription.match(pattern);
        if (!match) return '';
        const name = cleanHospitalName(match[1]);
        if (!/^[A-Z0-9]/.test(name)) return '';
        return isGenericHospitalName(name) ? '' : name;
    }

    // Get hospital name without letting the generic parent client overwrite the practice.
    let hospitalName = cleanHospitalName(domData.hospitalName || '');
    if (isGenericHospitalName(hospitalName)) hospitalName = '';
    hospitalName = hospitalName
        || firstSpecificHospital(/Hospital Name:\s*([^\n]+)/i)
        || firstSpecificHospital(/Position at\s+([^\n]+)/i)
        || firstSpecificHospital(/^([A-Z][^,\n]{2,90}),\s+(?:a|an|our)\s+(?:well-established|full-service|small animal|AAHA|community|progressive|modern|brand-new|established)?[^.\n]*(?:practice|hospital|clinic|center)\b/im)
        || firstSpecificHospital(/\bAt\s+([A-Z][A-Za-z0-9'.& -]{2,90}?(?:Animal\s+(?:Clinic|Hospital|Medical\s+Center|Care|Associates)|Animal\s+Medical\s+Center|Veterinary\s+(?:Clinic|Hospital|Center|Care|Specialists?)|Pet\s+(?:Hospital|Clinic|Care)|Emergency\s+(?:Hospital|Center|Clinic)|Creatures?\s+Comfort|PriorityPet(?:\s+Urgent\s+Care)?))\s*,/)
        || firstSpecificHospital(/at\s+((?:[\w'.&-]+\s+){1,5}(?:Animal\s+Hospital|Veterinary\s+(?:Hospital|Center|Clinic|Care|Specialists?)|Pet\s+(?:Hospital|Clinic|Care)|Emergency\s+(?:Hospital|Center|Clinic)|The\s+[A-Z][\w\s]+Service))\b/i)
        || firstSpecificHospital(/^([A-Z][^.\n]{2,90}?(?:Animal\s+Hospital|Veterinary\s+(?:Hospital|Center|Clinic|Care|Specialists?)|Pet\s+(?:Hospital|Clinic|Care)|Emergency\s+(?:Hospital|Center|Clinic)|Urgent\s+Care|The\s+[A-Z][\w\s]+Service))\s+(?:is|has been|in\s+[A-Z][^,\n]+\s+is)\b/im)
        || firstSpecificHospital(/^([A-Z][A-Za-z0-9'.& -]{2,90}?(?:Animal\s+(?:Clinic|Hospital|Medical\s+Center|Care|Associates)|Animal\s+Medical\s+Center|Veterinary\s+(?:Clinic|Hospital|Center|Care|Specialists?)|Pet\s+(?:Hospital|Clinic|Care)|Emergency\s+(?:Hospital|Center|Clinic)|Urgent\s+Care|Clinic|Hospital))\s+(?:is|has been|in\s+[A-Z][^,\n]+\s+is|,\s+(?:just|a|an|our))\b/im)
        || firstSpecificHospital(/\bAt\s+(PriorityPet(?:\s+Urgent\s+Care)?)\b/i);
    if (!hospitalName && jsonLd?.hiringOrganization?.name && !isGenericHospitalName(jsonLd.hiringOrganization.name)) {
        hospitalName = cleanHospitalName(jsonLd.hiringOrganization.name);
    }

    // Determine AOP and Position
    const areaOfPractice = determineAreaOfPractice(positionTitle, category, fullDescription);
    const position = determinePosition(positionTitle, areaOfPractice, fullDescription);
    const salary = extractSalary(jsonLd, fullDescription);
    const experience = extractExperience(fullDescription);
    const jobType = extractJobType(fullDescription);
    const locations = extractLocations(jsonLd, domData);
    const completeAddress = extractCompleteAddress(fullDescription);

    // Build results
    const baseDetails = {
        areaOfPractice,
        position,
        salary,
        experience,
        jobType,
        hospitalName,
        streetAddress: completeAddress.streetAddress,
        zipCode: completeAddress.zipCode,
        description: fullDescription
    };

    if (locations.length === 0) {
        return [{
            ...baseDetails,
            city: completeAddress.city || '',
            state: completeAddress.state || '',
            location: completeAddress.location || ''
        }];
    }

    return locations.map(loc => ({
        ...baseDetails,
        city: completeAddress.city || loc.city,
        state: completeAddress.state || getFullStateName(loc.state || ''),
        location: completeAddress.location || loc.location
    }));
})();
