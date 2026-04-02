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
            { area: 'General Practice Care', keywords: ['medical director', 'associate veterinarian', 'gp vet', 'dvm', 'vmd', 'relief veterinarian', 'general practice', 'clinic', 'hospital'] },
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

    // 1. JSON-LD (Pinpoint standard)
    const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const s of ldScripts) {
        try {
            const ld = JSON.parse(s.textContent);
            const items = Array.isArray(ld) ? ld : [ld];
            for (const item of items) {
                if (item['@type'] === 'JobPosting') {
                    details.position = item.title || details.position;
                    if (item.description) {
                        details.description = item.description.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
                    }
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

    // 2. DOM Fallbacks for Position
    if (!details.position) {
        details.position = document.querySelector('h1')?.innerText.trim() || '';
    }

    // 3. Pinpoint specific Hospital Name patterns
    if (!details.hospitalName || details.hospitalName.toLowerCase().includes('innovetive petcare')) {
        // Try footer or sidebar links
        const sidebarLink = document.querySelector('a[href*="/at-"]');
        if (sidebarLink && sidebarLink.innerText.includes('opportunities at')) {
            details.hospitalName = sidebarLink.innerText.replace('View all opportunities at', '').trim();
        }
        
        if (!details.hospitalName || details.hospitalName.toLowerCase().includes('innovetive petcare')) {
            const hospitalMatch = bodyText.match(/at\s+((?:[\w'.&-]+\s+){1,5}(?:Animal\s+Hospital|Veterinary\s+(?:Hospital|Center|Clinic|Care|Specialists?)|Pet\s+(?:Hospital|Clinic|Care)|Emergency\s+(?:Hospital|Center|Clinic)))\b/i);
            if (hospitalMatch) details.hospitalName = hospitalMatch[1].trim();
        }
    }

    // 4. DOM Fallbacks for Location
    if (!details.city) {
        const locEl = document.querySelector('.pinpoint-job-sidebar--location');
        if (locEl) {
            const parts = locEl.innerText.split(',').map(s => s.trim());
            details.city = parts[0] || '';
            details.state = parts[1] || '';
        }
    }

    details.salary = extractSalary(bodyText);
    details.areaOfPractice = lookupAreaOfPractice(details.position, bodyText);

    return details;
})();
