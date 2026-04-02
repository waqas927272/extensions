(() => {
    function lookupAreaOfPractice(positionText, descriptionText) {
        if (!positionText) return '';
        const combinedText = (positionText + ' ' + (descriptionText || '')).toLowerCase();
        const specialtyKeywords = ['criticalist', 'oncologist', 'internist', 'neurologist', 'cardiologist', 'dentist', 'surgeon', 'radiologist', 'ophthalmologist', 'anesthesiologist', 'specialist'];
        for (const kw of specialtyKeywords) if (combinedText.includes(kw)) return 'Specialty Care';
        const areaOfPracticeMap = [
            { area: 'General Practice Care', keywords: ['medical director', 'associate veterinarian', 'gp vet', 'dvm', 'vmd', 'relief veterinarian', 'general practice'] },
            { area: 'Emergency Care', keywords: ['emergency veterinarian', 'er vet', 'er veterinarian', 'er dvm', 'emergency & critical care', 'ecc'] },
            { area: 'Urgent Care', keywords: ['urgent care veterinarian', 'urgent veterinarian', 'quick care'] },
            { area: 'General Practice Care / Emergency Care / Urgent Care', keywords: ['equine', 'bovine', 'large animal', 'avian', 'exotics'] }
        ];
        for (const entry of areaOfPracticeMap) for (const kw of entry.keywords) if (combinedText.includes(kw)) return entry.area;
        return '';
    }

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

    let baseDetails = { areaOfPractice: '', position: '', salary: '', hospitalName: '', city: '', state: '', description: '' };
    let locations = [];
    
    // 1. phApp Data
    if (window.phApp?.ddo?.jobDetail?.data?.job) {
        const job = window.phApp.ddo.jobDetail.data.job;
        baseDetails.position = job.title || '';
        baseDetails.hospitalName = job.hiringOrganization?.name || '';
        baseDetails.description = job.description || '';
        if (job.multi_location?.length > 0) {
            locations = job.multi_location.map(loc => ({ city: loc.city || '', state: loc.state || '', location: loc.location || `${loc.city || ''}, ${loc.state || ''}` }));
        } else {
            locations.push({ city: job.city || '', state: job.state || '', location: job.location || `${job.city || ''}, ${job.state || ''}` });
        }
    }

    // 2. JSON-LD
    if (!baseDetails.position || locations.length <= 1) {
        const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (const s of ldScripts) {
            try {
                const ld = JSON.parse(s.textContent);
                const items = Array.isArray(ld) ? ld : [ld];
                for (const item of items) {
                    if (item['@type'] === 'JobPosting') {
                        baseDetails.position = item.title || baseDetails.position;
                        baseDetails.hospitalName = item.hiringOrganization?.name || baseDetails.hospitalName;
                        baseDetails.description = item.description || baseDetails.description;
                        if (locations.length <= 1 && item.jobLocation) {
                            const locs = Array.isArray(item.jobLocation) ? item.jobLocation : [item.jobLocation];
                            const extracted = locs.map(l => ({
                                city: l.address?.addressLocality || '',
                                state: l.address?.addressRegion || '',
                                location: `${l.address?.addressLocality || ''}, ${l.address?.addressRegion || ''}`
                            })).filter(l => l.city || l.state);
                            if (extracted.length > 0) locations = extracted;
                        }
                    }
                }
            } catch (e) {}
        }
    }

    // 3. DOM Fallbacks
    if (locations.length <= 1) {
        const multiLocElements = document.querySelectorAll('.job-multi-locations li.location, .location-list li.each-location, .jv-job-detail-location');
        if (multiLocElements.length > 1) {
            locations = Array.from(multiLocElements).map(el => {
                const text = el.innerText.trim();
                const parts = text.split(',').map(s => s.trim());
                return { city: parts[0] || '', state: parts[1] || '', location: text };
            });
        }
    }

    if (!baseDetails.position) baseDetails.position = document.querySelector('.jv-header, .jv-job-detail-title, h2')?.innerText.trim() || '';
    if (!baseDetails.hospitalName) {
        const metaEm = document.querySelector('.jv-meta em, .jv-job-detail-description .jv-meta em');
        if (metaEm && metaEm.innerText.includes('Position at')) baseDetails.hospitalName = metaEm.innerText.replace('Position at', '').trim();
        if (!baseDetails.hospitalName) baseDetails.hospitalName = document.querySelector('#subsidiaryLogo img')?.alt.trim() || '';
    }

    const fullText = document.querySelector('.jv-job-detail-description')?.innerText || document.body.innerText;
    baseDetails.salary = extractSalary(fullText);
    baseDetails.areaOfPractice = lookupAreaOfPractice(baseDetails.position, fullText);

    if (baseDetails.hospitalName.toLowerCase().includes('united veterinary care')) {
        const hospitalMatch = fullText.match(/at\s+((?:[\w'.&-]+\s+){1,5}(?:Animal\s+Hospital|Veterinary\s+(?:Hospital|Center|Clinic|Care|Specialists?)|Pet\s+(?:Hospital|Clinic|Care)|Emergency\s+(?:Hospital|Center|Clinic)))\b/i);
        if (hospitalMatch) baseDetails.hospitalName = hospitalMatch[1].trim();
    }

    if (locations.length === 0) {
        const metaText = document.querySelector('.jv-job-detail-meta')?.innerText || '';
        const locMatch = metaText.match(/([A-Za-z\s]+),\s*([A-Z]{2})/);
        if (locMatch) locations.push({ city: locMatch[1].trim(), state: locMatch[2].trim(), location: locMatch[0] });
    }

    // Deduplicate locations
    const uniqueLocations = [];
    const seen = new Set();
    for (const loc of locations) {
        const key = `${loc.city}|${loc.state}`.toLowerCase();
        if (!seen.has(key) && (loc.city || loc.state)) {
            seen.add(key);
            uniqueLocations.push(loc);
        }
    }

    return uniqueLocations.map(loc => ({ ...baseDetails, city: loc.city, state: loc.state, location: loc.location || `${loc.city}, ${loc.state}` }));
})();
