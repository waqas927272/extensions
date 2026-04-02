(() => {
    // Get full page description/content - complete text from .jv-wrapper
    function getFullDescription() {
        let completeData = '';

        // 1. Extract JSON-LD structured data first (contains rich metadata)
        const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
        let jsonLdData = '';
        for (const script of jsonLdScripts) {
            try {
                const data = JSON.parse(script.textContent);
                if (data['@type'] === 'JobPosting') {
                    // Format JSON data as readable text
                    jsonLdData += `\n=== JOB POSTING DATA ===\n`;
                    jsonLdData += `Title: ${data.title || ''}\n`;
                    jsonLdData += `Date Posted: ${data.datePosted || ''}\n`;
                    jsonLdData += `Industry/Category: ${data.industry || ''}\n`;
                    jsonLdData += `Employment Type: ${data.employmentType || ''}\n`;

                    // Extract organization name
                    if (data.hiringOrganization && data.hiringOrganization.name) {
                        jsonLdData += `Hiring Organization: ${data.hiringOrganization.name}\n`;
                    }

                    // Extract all job locations
                    if (data.jobLocation) {
                        const locations = Array.isArray(data.jobLocation) ? data.jobLocation : [data.jobLocation];
                        jsonLdData += `Locations:\n`;
                        locations.forEach(loc => {
                            if (loc.address) {
                                const addr = loc.address;
                                jsonLdData += `  - ${addr.addressLocality || ''}, ${addr.addressRegion || ''}, ${addr.addressCountry || ''}\n`;
                            }
                        });
                    }

                    // Extract salary if available
                    if (data.baseSalary && data.baseSalary.value) {
                        const salary = data.baseSalary.value;
                        if (salary.minValue || salary.maxValue) {
                            jsonLdData += `Salary Range: ${salary.currency || '$'}${salary.minValue || ''} - ${salary.maxValue || ''} ${salary.unitText || ''}\n`;
                        }
                    }

                    // Extract and clean description from JSON-LD
                    if (data.description) {
                        const temp = document.createElement('div');
                        temp.innerHTML = data.description;
                        jsonLdData += `\n=== FULL JOB DESCRIPTION ===\n`;
                        jsonLdData += temp.innerText.trim() + '\n';
                    }
                }
            } catch (e) {}
        }

        // 2. Get the complete text from .jv-wrapper (contains everything visible on the page)
        const wrapperElement = document.querySelector('.jv-wrapper');
        let wrapperText = '';
        if (wrapperElement) {
            wrapperText = wrapperElement.innerText.trim();
        }

        // 3. Combine both sources
        if (jsonLdData.length > 100) {
            completeData = jsonLdData;
            if (wrapperText && wrapperText.length > 100) {
                completeData += `\n\n=== ADDITIONAL PAGE CONTENT ===\n${wrapperText}`;
            }
        } else if (wrapperText.length > 100) {
            completeData = wrapperText;
        } else {
            // Last resort
            const selectors = ['.jv-page-body', '.jv-job-detail', 'body'];
            for (const selector of selectors) {
                const el = document.querySelector(selector);
                if (el && el.innerText && el.innerText.trim().length > 100) {
                    completeData = el.innerText.trim();
                    break;
                }
            }
        }

        // Clean up
        if (completeData) {
            completeData = completeData.replace(/\n{3,}/g, '\n\n');
            completeData = completeData.replace(/\t+/g, ' ');
            return completeData.trim();
        }

        return document.body.innerText.trim();
    }

    // Extract salary - try JSON-LD first, then text patterns
    function extractSalary(text) {
        if (!text) return '';

        // First try to get salary from JSON-LD structured data
        const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (const script of jsonLdScripts) {
            try {
                const data = JSON.parse(script.textContent);
                if (data['@type'] === 'JobPosting' && data.baseSalary && data.baseSalary.value) {
                    const salary = data.baseSalary.value;
                    if (salary.minValue && salary.maxValue) {
                        const currency = salary.currency || '$';
                        const unit = salary.unitText || 'per year';
                        return `${currency}${salary.minValue} - ${currency}${salary.maxValue} ${unit}`;
                    } else if (salary.minValue) {
                        const currency = salary.currency || '$';
                        return `${currency}${salary.minValue}+`;
                    }
                }
            } catch (e) {}
        }

        // Fallback to text pattern matching
        const salaryPatterns = [
            /(?:Pay|Salary|Compensation)[:\s]+\$([\d,]+(?:\.\d{2})?(?:\s*[-–]\s*\$[\d,]+(?:\.\d{2})?)?(?:\s*per\s*\w+)?)/i,
            /\$[\d,]+k?\s*[-–]+\s*\$?[\d,]+k/i,
            /\$[\d,]+(?:,\d{3})*\s*[-–]+\s*\$[\d,]+(?:,\d{3})*/i,
            /\$[\d,]+(?:\.\d{2})?\s*(?:per\s+)?(?:hourly|hour|hr|\/hr)/i,
            /\$[\d,]+(?:\.\d{2})?\s*(?:per\s+)?(?:year|annually|annum|annual)/i,
            /\$[\d,]+k\+?/i
        ];
        for (const pattern of salaryPatterns) {
            const m = text.match(pattern);
            if (m) return m[0].trim();
        }
        return '';
    }

    // Determine Area of Practice based on guide
    function determineAreaOfPractice(positionText, descriptionText) {
        const combined = (positionText + ' ' + descriptionText).toLowerCase();

        // Check for specialty indicators first
        const specialtyIndicators = ['board certified', 'residency trained', 'residential trained', 'dacv', 'diplomate'];
        for (const indicator of specialtyIndicators) {
            if (combined.includes(indicator)) {
                return 'Specialty Care';
            }
        }

        // Check for specialty keywords (excluding 'dentist' since dental work is common in general practice)
        const specialtyKeywords = ['criticalist', 'oncologist', 'internist', 'neurologist', 'cardiologist',
                                   'surgeon', 'radiologist', 'ophthalmologist', 'anesthesiologist',
                                   'dermatologist', 'theriogenologist', 'specialist', 'dacvecc', 'dacvim',
                                   'dacvr', 'dacvs', 'acvs', 'dacvd', 'dacvo', 'dacvaa', 'dact', 'davdc'];
        for (const kw of specialtyKeywords) {
            if (combined.includes(kw)) {
                // Additional check: if it's "surgeon" or "specialist", verify board certification/residency
                if ((kw === 'surgeon' || kw === 'specialist') &&
                    !combined.includes('board certified') &&
                    !combined.includes('residency trained') &&
                    !combined.includes('diplomate') &&
                    !combined.includes('dacv')) {
                    continue; // Skip, likely general practice
                }
                return 'Specialty Care';
            }
        }

        // Check for Emergency Care
        const emergencyKeywords = ['emergency veterinarian', 'er vet', 'er veterinarian', 'er dvm', 'ecc', 'emergency & critical care'];
        for (const kw of emergencyKeywords) {
            if (combined.includes(kw)) {
                return 'Emergency Care';
            }
        }

        // Check for Urgent Care
        const urgentKeywords = ['urgent care', 'urgent veterinarian', 'quick care'];
        for (const kw of urgentKeywords) {
            if (combined.includes(kw)) {
                return 'Urgent Care';
            }
        }

        // Check for Large Animal / Equine / Exotics
        const specialAnimals = ['equine', 'bovine', 'large animal', 'avian', 'exotics'];
        for (const kw of specialAnimals) {
            if (combined.includes(kw)) {
                return 'General Practice Care / Emergency Care / Urgent Care';
            }
        }

        // Default to General Practice
        return 'General Practice Care';
    }

    // Determine Position based on guide
    function determinePosition(positionText, descriptionText, areaOfPractice) {
        const combined = (positionText + ' ' + descriptionText).toLowerCase();

        if (areaOfPractice === 'Specialty Care') {
            // Specialty positions - only classify as specialist if board certified/residency trained
            if (combined.includes('ecc') || combined.includes('criticalist') || combined.includes('emergency & critical care')) return 'ECC Specialist';
            if (combined.includes('oncologist') && combined.includes('radiation')) return 'Radiation Oncologist';
            if (combined.includes('oncologist')) return 'Medical Oncologist';
            if (combined.includes('internist') || (combined.includes('internal medicine') && combined.includes('specialist'))) return 'Internal Medicine Specialist';
            if (combined.includes('neurologist') || combined.includes('neurosurgeon')) return 'Neurologist';
            if (combined.includes('cardiologist')) return 'Cardiologist';
            // For dental specialist, verify they have DAVDC or board certification
            if ((combined.includes('dental specialist') || combined.includes('davdc') || combined.includes('veterinary dental college')) &&
                (combined.includes('board certified') || combined.includes('residency trained') || combined.includes('diplomate'))) {
                return 'Dental Specialist';
            }
            if (combined.includes('dermatologist')) return 'Dermatologist';
            if (combined.includes('surgeon') && !combined.includes('neurosurgeon')) return 'Surgeon';
            if (combined.includes('radiologist') || combined.includes('diagnostic imaging')) return 'Radiologist';
            if (combined.includes('ophthalmologist')) return 'Ophthalmologist';
            if (combined.includes('anesthesiologist')) return 'Anesthesiologist';
            if (combined.includes('theriogenologist')) return 'Theriogenologist';
        }

        // Medical Director
        if (combined.includes('medical director')) return 'Medical Director';

        // Associate Veterinarian
        if (combined.includes('associate veterinarian') || combined.includes('associate vet')) return 'Associate Veterinarian';

        // Relief Veterinarian
        if (combined.includes('relief')) return 'Relief Veterinarian';

        // Equine/Bovine/Large Animal
        if (combined.includes('equine') || combined.includes('bovine') || combined.includes('large animal')) {
            return 'Equine/Bovine Veterinarian/Large Animal';
        }

        // Avian & Exotics
        if (combined.includes('avian') || combined.includes('exotics')) {
            return 'Avian & Exotics Veterinarian / Associate Exotics';
        }

        // Veterinary Technician
        if (combined.includes('technician') || combined.includes('vet tech') || combined.includes('cvt') ||
            combined.includes('lvt') || combined.includes('rvt') || combined.includes('vts')) {
            return 'Veterinary Technician';
        }

        // Veterinary Assistant
        if (combined.includes('assistant') || combined.includes('vet assist')) {
            return 'Veterinary Assistant';
        }

        // Receptionist
        if (combined.includes('receptionist') || combined.includes('front desk') || combined.includes('csr')) {
            return 'Receptionist';
        }

        // Externship
        if (combined.includes('externship') || combined.includes('extern')) {
            return 'Veterinary Externship';
        }

        // Default
        return 'Associate Veterinarian';
    }

    // Extract locations from JSON-LD, hero section, or multi-location list
    function extractLocations() {
        const locations = [];

        // First try to get locations from JSON-LD structured data
        const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (const script of jsonLdScripts) {
            try {
                const data = JSON.parse(script.textContent);
                if (data['@type'] === 'JobPosting' && data.jobLocation) {
                    const jobLocations = Array.isArray(data.jobLocation) ? data.jobLocation : [data.jobLocation];
                    jobLocations.forEach(loc => {
                        if (loc.address) {
                            const addr = loc.address;
                            const city = addr.addressLocality || '';
                            const state = addr.addressRegion || '';
                            if (city && state) {
                                locations.push({
                                    city: city,
                                    state: state,
                                    location: `${city}, ${state}`
                                });
                            }
                        }
                    });
                }
            } catch (e) {}
        }

        // If we found locations in JSON-LD, return them (most reliable)
        if (locations.length > 0) {
            return locations;
        }

        // Check hero section for location badge/info
        const heroSelectors = [
            '.jv-job-detail-meta',
            '.jv-header-info',
            '.jv-job-location',
            '[class*="location"]'
        ];

        for (const selector of heroSelectors) {
            const elements = document.querySelectorAll(selector);
            for (const el of elements) {
                let text = el.innerText || el.textContent;

                // Clean up the text - remove "Description", "Position at", etc.
                text = text.replace(/^Description\s*/i, '');
                text = text.replace(/^Position at\s*/i, '');
                text = text.split('\n')[0]; // Only take first line to avoid grabbing description text

                // Match patterns like "City, ST" or "City, State"
                const matches = text.matchAll(/\b([A-Za-z][\w\s.'()-]*[A-Za-z])\s*,\s*([A-Z]{2})\b/g);
                for (const match of matches) {
                    let city = match[1].trim();
                    const state = match[2].trim();

                    // Filter out common non-city words
                    const invalidWords = ['description', 'position', 'associate', 'veterinarian', 'hospital', 'care', 'center', 'clinic'];
                    if (!invalidWords.some(word => city.toLowerCase().includes(word)) && city.length > 1 && city.length < 50) {
                        locations.push({ city, state, location: `${city}, ${state}` });
                    }
                }
            }
        }

        // Also check for multi-location list
        const multiLocElements = document.querySelectorAll('.job-multi-locations li.location, .location-list li.each-location');
        if (multiLocElements.length > 0) {
            multiLocElements.forEach(el => {
                const text = el.innerText.trim();
                const parts = text.split(',').map(s => s.trim());
                if (parts.length >= 2) {
                    const city = parts[0];
                    const state = parts[1];
                    locations.push({ city, state, location: text });
                }
            });
        }

        // Deduplicate
        const uniqueLocations = [];
        const seen = new Set();
        for (const loc of locations) {
            const key = `${loc.city}|${loc.state}`.toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                uniqueLocations.push(loc);
            }
        }

        return uniqueLocations;
    }

    // Main extraction logic
    const fullDescription = getFullDescription();

    // Get position title
    let positionTitle = '';
    if (window.phApp?.ddo?.jobDetail?.data?.job?.title) {
        positionTitle = window.phApp.ddo.jobDetail.data.job.title;
    }
    if (!positionTitle) {
        const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (const s of ldScripts) {
            try {
                const ld = JSON.parse(s.textContent);
                const items = Array.isArray(ld) ? ld : [ld];
                for (const item of items) {
                    if (item['@type'] === 'JobPosting' && item.title) {
                        positionTitle = item.title;
                        break;
                    }
                }
            } catch (e) {}
        }
    }
    if (!positionTitle) {
        positionTitle = document.querySelector('.jv-header, .jv-job-detail-title, h1, h2')?.innerText.trim() || '';
    }

    // Get hospital name - try JSON-LD first
    let hospitalName = '';

    // Try JSON-LD structured data first
    if (!hospitalName) {
        const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (const s of ldScripts) {
            try {
                const ld = JSON.parse(s.textContent);
                if (ld['@type'] === 'JobPosting' && ld.hiringOrganization && ld.hiringOrganization.name) {
                    hospitalName = ld.hiringOrganization.name;
                    break;
                }
            } catch (e) {}
        }
    }

    // Try window data
    if (!hospitalName && window.phApp?.ddo?.jobDetail?.data?.job?.hiringOrganization?.name) {
        hospitalName = window.phApp.ddo.jobDetail.data.job.hiringOrganization.name;
    }

    // Try meta element
    if (!hospitalName) {
        const metaEm = document.querySelector('.jv-meta em, .jv-job-detail-description .jv-meta em');
        if (metaEm && metaEm.innerText.includes('Position at')) {
            hospitalName = metaEm.innerText.replace('Position at', '').trim();
        }
    }

    // Try logo alt text
    if (!hospitalName) {
        hospitalName = document.querySelector('#subsidiaryLogo img')?.alt.trim() || '';
    }

    // Extract specific hospital from description if generic UVC
    if (hospitalName.toLowerCase().includes('united veterinary care')) {
        const hospitalMatch = fullDescription.match(/at\s+((?:[\w'.&-]+\s+){1,5}(?:Animal\s+Hospital|Veterinary\s+(?:Hospital|Center|Clinic|Care|Specialists?)|Pet\s+(?:Hospital|Clinic|Care)|Emergency\s+(?:Hospital|Center|Clinic)))\b/i);
        if (hospitalMatch) {
            hospitalName = hospitalMatch[1].trim();
        }
    }

    // Extract salary
    const salary = extractSalary(fullDescription);

    // Determine Area of Practice and Position
    const areaOfPractice = determineAreaOfPractice(positionTitle, fullDescription);
    const position = determinePosition(positionTitle, fullDescription, areaOfPractice);

    // Extract locations
    const locations = extractLocations();

    // If no locations found, try to extract from anywhere in the page
    if (locations.length === 0) {
        // Remove "Description" and "Position at" prefixes before extracting
        let cleanedDescription = fullDescription.replace(/^Description\s*/i, '');
        cleanedDescription = cleanedDescription.replace(/^Position at\s*/i, '');

        // Try to find location pattern in first 500 characters to avoid false matches deep in description
        const searchText = cleanedDescription.substring(0, 500);
        const locMatch = searchText.match(/\b([A-Za-z][\w\s.'()-]*[A-Za-z])\s*,\s*([A-Z]{2})\b/);

        if (locMatch) {
            let city = locMatch[1].trim();
            const state = locMatch[2].trim();

            // Filter out invalid city names
            const invalidWords = ['description', 'position', 'associate', 'veterinarian', 'hospital', 'care', 'center', 'clinic', 'location'];
            if (!invalidWords.some(word => city.toLowerCase().includes(word)) && city.length > 1 && city.length < 50) {
                locations.push({
                    city: city,
                    state: state,
                    location: `${city}, ${state}`
                });
            }
        }
    }

    // Build result objects
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
