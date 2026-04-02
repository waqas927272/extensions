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
            // Annual range: $120,000 - $140,000
            /\$[\d,]{3,}\s*[-–]\s*\$[\d,]{3,}(?:\s*per\s*year|annually)?/i,
            // Hourly range: $14.00-$17.00
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

    // 1. JSON-LD
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

    // 2. DOM Selectors
    if (!details.position) {
        details.position = document.querySelector('h1.app-title, .job-title, .header-container h1')?.innerText.trim() || '';
    }

    // 3. Specialized location pattern: "Location: [Address], City, ST Zip"
    if (!details.city) {
        const locMatch = bodyText.match(/Location:\s*(?:[\d\w\s]+,)?\s*([A-Za-z\s]+),\s*([A-Z]{2})\s*\d+/i);
        if (locMatch) {
            details.city = locMatch[1].trim();
            details.state = locMatch[2].trim();
        }
    }

    // 4. Hospital Name from patterns (About [Hospital Name])
    if (!details.hospitalName || details.hospitalName.toLowerCase().includes('veterinary practice partners')) {
        const hospitalMatch = bodyText.match(/About\s+((?:[\w'.&-]+\s+){1,5}(?:Animal\s+Hospital|Veterinary\s+(?:Hospital|Center|Clinic|Care|Specialists?)|Pet\s+(?:Hospital|Clinic|Care)|Emergency\s+(?:Hospital|Center|Clinic)))\b/i);
        if (hospitalMatch) {
            details.hospitalName = hospitalMatch[1].trim();
        }
        
        // Try hyphen in title
        if (!details.hospitalName || details.hospitalName.toLowerCase().includes('veterinary practice partners')) {
            const title = document.querySelector('h1.app-title')?.innerText || '';
            if (title.includes(' at ')) {
                details.hospitalName = title.split(' at ')[1].trim();
            }
        }
    }

    details.salary = extractSalary(bodyText);
    details.areaOfPractice = lookupAreaOfPractice(details.position, bodyText);

    return details;
})();
