(() => {
    function lookupAreaOfPractice(positionText, descriptionText) {
        if (!positionText) return '';
        const combinedText = (positionText + ' ' + (descriptionText || '')).toLowerCase();
        
        // Priority Specialty check
        const specialtyKeywords = ['criticalist', 'oncologist', 'internist', 'neurologist', 'cardiologist', 'dentist', 'surgeon', 'radiologist', 'ophthalmologist', 'anesthesiologist', 'specialist'];
        for (const kw of specialtyKeywords) {
            if (combinedText.includes(kw)) return 'Specialty Care';
        }

        const areaOfPracticeMap = [
            { area: 'General Practice Care', keywords: ['medical director', 'associate veterinarian', 'gp vet', 'dvm', 'vmd', 'relief veterinarian', 'general practice', 'client service', 'receptionist'] },
            { area: 'Emergency Care', keywords: ['emergency veterinarian', 'er vet', 'er veterinarian', 'er dvm', 'emergency & critical care', 'ecc'] },
            { area: 'Urgent Care', keywords: ['urgent care veterinarian', 'urgent veterinarian', 'quick care'] },
            { area: 'General Practice Care / Emergency Care / Urgent Care', keywords: ['equine', 'bovine', 'large animal', 'avian', 'exotics'] }
        ];

        for (const entry of areaOfPracticeMap) {
            for (const kw of entry.keywords) {
                if (combinedText.includes(kw)) return entry.area;
            }
        }
        return '';
    }

    function extractSalary(text) {
        if (!text) return '';
        const salaryPatterns = [
            // Matches $14.00-$17.00
            /\$[\d,]+(?:\.\d{2})?\s*[-–]\s*\$[\d,]+(?:\.\d{2})?/i,
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

    let details = {
        areaOfPractice: '',
        position: '',
        salary: '',
        hospitalName: '',
        city: '',
        state: '',
        description: ''
    };

    // 1. Try JSON-LD (Greenhouse standard)
    const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const s of ldScripts) {
        try {
            const ld = JSON.parse(s.textContent);
            const items = Array.isArray(ld) ? ld : [ld];
            for (const item of items) {
                if (item['@type'] === 'JobPosting') {
                    details.position = item.title || details.position;
                    details.description = item.description || details.description;
                    if (item.hiringOrganization && item.hiringOrganization.name) {
                        details.hospitalName = item.hiringOrganization.name;
                    }
                    if (item.jobLocation && item.jobLocation.address) {
                        const addr = item.jobLocation.address;
                        details.city = addr.addressLocality || details.city;
                        details.state = addr.addressRegion || details.state;
                    }
                }
            }
        } catch (e) {}
    }

    const bodyText = document.body.innerText;

    // 2. Greenhouse Embed specific selectors
    if (!details.position) {
        const titleEl = document.querySelector('h1.app-title, .job-title, .header-container h1');
        if (titleEl) details.position = titleEl.innerText.trim();
    }

    // 3. Location Extraction from "LOCATION:" pattern
    if (!details.city) {
        const locMatch = bodyText.match(/LOCATION:\s*([A-Za-z\s]+),\s*([A-Z]{2})/i);
        if (locMatch) {
            details.city = locMatch[1].trim();
            details.state = locMatch[2].trim();
        }
    }

    // 4. Hospital Name from title or description
    if (!details.hospitalName || details.hospitalName.toLowerCase().includes('veterinary innovative partners')) {
        // Try to find hospital name after a hyphen in the title (e.g. "Receptionist - Alvin Animal Clinic")
        if (details.position && details.position.includes(' - ')) {
            const parts = details.position.split(' - ');
            const lastPart = parts[parts.length - 1].trim();
            if (lastPart.toLowerCase().includes('animal') || lastPart.toLowerCase().includes('clinic') || lastPart.toLowerCase().includes('hospital')) {
                // If it ends with state code like "Clinic - TX", take the middle part
                if (lastPart.length === 2 && parts.length > 2) {
                    details.hospitalName = parts[parts.length - 2].trim();
                } else {
                    details.hospitalName = lastPart;
                }
            }
        }

        // Try "at [Hospital]" pattern in body
        if (!details.hospitalName || details.hospitalName.toLowerCase().includes('veterinary innovative partners')) {
            const hospitalMatch = bodyText.match(/at\s+((?:[\w'.&-]+\s+){1,5}(?:Animal\s+Hospital|Veterinary\s+(?:Hospital|Center|Clinic|Care|Specialists?)|Pet\s+(?:Hospital|Clinic|Care)|Emergency\s+(?:Hospital|Center|Clinic)))\b/i);
            if (hospitalMatch) details.hospitalName = hospitalMatch[1].trim();
        }
    }

    details.salary = extractSalary(bodyText);
    details.areaOfPractice = lookupAreaOfPractice(details.position, bodyText);

    return details;
})();
