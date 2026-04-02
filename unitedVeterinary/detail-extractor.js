(() => {
    // Get full page description/content
    function getFullDescription() {
        // Try multiple selectors to get the complete job description
        const selectors = [
            '.jv-job-detail-description',
            '.jv-page-body .jv-wrapper',
            '.jv-page-body',
            '.jv-job-description',
            'body'
        ];

        for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el && el.innerText && el.innerText.trim().length > 100) {
                return el.innerText.trim();
            }
        }
        return document.body.innerText.trim();
    }

    // Extract salary with existing patterns (keep as is - working correctly)
    function extractSalary(text) {
        if (!text) return '';
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

        // Check for specialty keywords
        const specialtyKeywords = ['criticalist', 'oncologist', 'internist', 'neurologist', 'cardiologist',
                                   'dentist', 'surgeon', 'radiologist', 'ophthalmologist', 'anesthesiologist',
                                   'dermatologist', 'theriogenologist', 'specialist', 'dacvecc', 'dacvim',
                                   'dacvr', 'dacvs', 'acvs', 'dacvd', 'dacvo', 'dacvaa', 'dact'];
        for (const kw of specialtyKeywords) {
            if (combined.includes(kw)) {
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
            // Specialty positions
            if (combined.includes('ecc') || combined.includes('criticalist') || combined.includes('emergency & critical care')) return 'ECC Specialist';
            if (combined.includes('oncologist') && combined.includes('radiation')) return 'Radiation Oncologist';
            if (combined.includes('oncologist')) return 'Medical Oncologist';
            if (combined.includes('internist') || (combined.includes('internal medicine') && combined.includes('specialist'))) return 'Internal Medicine Specialist';
            if (combined.includes('neurologist') || combined.includes('neurosurgeon')) return 'Neurologist';
            if (combined.includes('cardiologist')) return 'Cardiologist';
            if (combined.includes('dentist') || combined.includes('dental')) return 'Dental Specialist';
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

    // Extract locations from hero section or multi-location list
    function extractLocations() {
        const locations = [];

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
                const text = el.innerText || el.textContent;
                // Match patterns like "City, ST" or "City, State"
                const matches = text.matchAll(/([A-Za-z\s.]+),\s*([A-Z]{2})\b/g);
                for (const match of matches) {
                    const city = match[1].trim();
                    const state = match[2].trim();
                    if (city && state && city.length > 1) {
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

    // Get hospital name
    let hospitalName = '';
    if (window.phApp?.ddo?.jobDetail?.data?.job?.hiringOrganization?.name) {
        hospitalName = window.phApp.ddo.jobDetail.data.job.hiringOrganization.name;
    }
    if (!hospitalName) {
        const metaEm = document.querySelector('.jv-meta em, .jv-job-detail-description .jv-meta em');
        if (metaEm && metaEm.innerText.includes('Position at')) {
            hospitalName = metaEm.innerText.replace('Position at', '').trim();
        }
    }
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
        const locMatch = fullDescription.match(/([A-Za-z\s.]+),\s*([A-Z]{2})\b/);
        if (locMatch) {
            locations.push({
                city: locMatch[1].trim(),
                state: locMatch[2].trim(),
                location: `${locMatch[1].trim()}, ${locMatch[2].trim()}`
            });
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
