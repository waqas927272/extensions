// PetVet Detail Extractor - Inject into job detail pages to extract position, AOP, and salary

(() => {
    // ===== Extract JSON-LD JobPosting data =====
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

    // ===== Get full description text =====
    function getFullDescription() {
        let descriptionText = '';
        const jsonLd = getJsonLdData();
        if (jsonLd && jsonLd.description) {
            const temp = document.createElement('div');
            temp.innerHTML = jsonLd.description;
            descriptionText = temp.innerText.trim();
        }
        if (!descriptionText) {
            const contentDiv = document.querySelector('.content-conclusion') || document.body;
            descriptionText = contentDiv.innerText.trim();
        }
        return descriptionText.replace(/\n{3,}/g, '\n\n').trim();
    }

    // ===== Extract title from JSON-LD =====
    function getTitle() {
        const jsonLd = getJsonLdData();
        if (jsonLd && jsonLd.title) return jsonLd.title.trim();
        const h1 = document.querySelector('h1');
        if (h1) return h1.innerText.trim();
        return document.title.split('|')[0].trim();
    }

    // ===== Determine POSITION from title and description =====
    function determinePosition(title, description) {
        const t = (title || '').toLowerCase();
        const d = (description || '').toLowerCase();

        // Guard: Non-clinical roles
        const nonClinical = [
            'practice manager', 'hospital manager', 'office manager', 'administrator',
            'client service', 'service representative', 'receptionist', 'kennel',
            'groomer', 'grooming', 'billing', 'human resources', 'hr',
            'patient care coordinator', 'client care coordinator', 'care coordinator', 'customer service',
            'front desk', 'inventory', 'housekeeper', 'janitorial'
        ];
        if (nonClinical.some(role => t.includes(role))) {
            return '';
        }

        // Board Certified or Residency Trained keywords
        const isBoardOrResidency = /board certified|residency trained|diplomate/.test(t);

        // Check for specialty keywords
        if (t.includes('ophthalmolog') || t.includes('ophtho') || t.includes('eye')) {
            return 'Ophthalmologist';
        }
        if ((t.includes('cardiolog') || t.includes('cardio')) && !t.includes('technician')) {
            return 'Cardiologist';
        }
        if ((t.includes('surgeon') || t.includes('surgery')) && !t.includes('neuro')) {
            return 'Surgeon';
        }
        if (t.includes('neurolog') || t.includes('neurosurg')) {
            return 'Neurologist & Neurosurgeon';
        }
        if (t.includes('dermatolog') || t.includes('derm')) {
            return 'Dermatologist';
        }
        if (t.includes('radiation oncolog')) {
            return 'Radiation Oncologist';
        }
        if (t.includes('oncolog') && !t.includes('radiation')) {
            return 'Medical Oncologist';
        }
        if (t.includes('anesthesiolog') || t.includes('anesthesia')) {
            return 'Anesthesiologist';
        }
        if ((t.includes('radiolog') || t.includes('diagnostic imaging')) && !t.includes('technician')) {
            return 'Radiologist';
        }
        if (t.includes('internist') || t.includes('internal medicine')) {
            return 'Internal Medicine Specialist';
        }
        if (t.includes('dental') || t.includes('dentist') || t.includes('dentistry')) {
            return 'Dental Specialist';
        }
        if (t.includes('theriogenolog')) {
            return 'Theriogenologist';
        }
        if (t.includes('dabvp')) {
            return 'DABVP Specialist';
        }
        if ((t.includes('criticalist') || t.match(/\becc\b/) || t.includes('critical care')) && !t.includes('emergency')) {
            return 'ECC Specialist';
        }
        if (t.includes('emergency') && t.includes('critical care')) {
            return 'ECC Specialist';
        }

        // Medical Director or Lead
        if (t.includes('medical director')) {
            return 'Medical Director';
        }
        if (t.includes('lead veterinarian') || t.includes('lead vet')) {
            return 'Lead Veterinarian';
        }

        // Check description for qualifications clues
        if (d.includes('3-year') && d.includes('residency')) {
            if (d.includes('ophthalmolog')) return 'Ophthalmologist';
            if (d.includes('cardiolog')) return 'Cardiologist';
            if (d.includes('surgeon') && !d.includes('neuro')) return 'Surgeon';
            if (d.includes('neurolog') || d.includes('neurosurg')) return 'Neurologist & Neurosurgeon';
            if (d.includes('dermatolog')) return 'Dermatologist';
            if (d.includes('oncolog')) return 'Medical Oncologist';
            if (d.includes('anesthesiolog')) return 'Anesthesiologist';
            if (d.includes('radiolog')) return 'Radiologist';
            if (d.includes('internist') || d.includes('internal medicine')) return 'Internal Medicine Specialist';
            if (d.includes('dental')) return 'Dental Specialist';
            if (d.includes('theriogenolog')) return 'Theriogenologist';
            if (d.includes('criticalist') || d.includes('ecc') || d.includes('critical care')) return 'ECC Specialist';
            return '_SPECIALTY_FLAG_';
        }

        // Check for board certifications in description
        if (d.includes('dacvo')) return 'Ophthalmologist';
        if (d.includes('dacvs') || d.includes('acvs')) return 'Surgeon';
        if (d.includes('dacvim')) {
            if (d.includes('oncology')) return 'Medical Oncologist';
            if (d.includes('cardiology')) return 'Cardiologist';
            if (d.includes('neurology') || d.includes('neurosurg')) return 'Neurologist & Neurosurgeon';
            return 'Internal Medicine Specialist';
        }
        if (d.includes('dacvr') && d.includes('radiation')) return 'Radiation Oncologist';
        if (d.includes('dacvr')) return 'Radiologist';
        if (d.includes('dacvd')) return 'Dermatologist';
        if (d.includes('dacvaa')) return 'Anesthesiologist';
        if (d.includes('dact')) return 'Theriogenologist';
        if (d.includes('davdc')) return 'Dental Specialist';
        if (d.includes('dabvp')) return 'DABVP Specialist';
        if (d.includes('dacvecc')) return 'ECC Specialist';

        // Technician roles
        if (t.includes('technician') || t.includes('technologist') || t.includes('vet tech') || t.includes('nurse')) {
            if (t.includes('anesthesia')) return 'Anesthesiologist';
            if (t.includes('dental')) return 'Dental Specialist';
            if (t.includes('ecc') || t.includes('criticalist') || t.includes('critical care')) return 'ECC Specialist';
            if (t.includes('oncology') || t.includes('oncolog')) return 'Medical Oncologist';
            if (t.includes('cardiology') || t.includes('cardio')) return 'Cardiologist';
            if (t.includes('neurology') || t.includes('neuro')) return 'Neurologist & Neurosurgeon';
            if (t.includes('dermatology') || t.includes('derm')) return 'Dermatologist';
            if (t.includes('ophthalmology') || t.includes('eye')) return 'Ophthalmologist';
            if (t.includes('surgery') || t.includes('surgeon')) return 'Surgeon';
            if (t.includes('radiology') || t.includes('imaging')) return 'Radiologist';
            if (t.includes('internal medicine')) return 'Internal Medicine Specialist';
            if (t.includes('theriogenology')) return 'Theriogenologist';
            return 'Credentialed Veterinary Technician Specialist';
        }

        return 'Associate Veterinarian';
    }

    // ===== Determine AREA OF PRACTICE =====
    function determineAreaOfPractice(title, description) {
        const t = (title || '').toLowerCase();
        const d = (description || '').toLowerCase();

        // Title override: "Urgent Care" always wins
        if (t.includes('urgent care')) {
            return 'Urgent Care';
        }

        // Specialty keywords in title
        const specialtyKeywords = [
            'ophthalmolog', 'ophtho', 'eye',
            'cardiolog', 'cardio',
            'oncolog', 'radiation oncology',
            'surgeon', 'surgery',
            'neurolog', 'neurosurg',
            'dermatolog', 'derm',
            'anesthesiolog', 'anesthesia',
            'radiolog', 'diagnostic imaging',
            'internist', 'internal medicine',
            'theriogenolog',
            'dental', 'dentist', 'dentistry',
            'board certified', 'residency trained', 'diplomate',
            'dacvo', 'dacvs', 'dacvim', 'dacvr', 'dacvd', 'dacvaa', 'dact', 'davdc', 'dabvp',
            'criticalist', 'ecc', 'critical care specialist'
        ];

        // Check title for specialty
        for (const keyword of specialtyKeywords) {
            if (t.includes(keyword)) {
                // Emergency without critical care = emergency care
                if (t.includes('emergency') && !t.includes('critical care') && keyword !== 'criticalist' && keyword !== 'ecc') {
                    return 'Emergency Care';
                }
                return 'Specialty Care';
            }
        }

        // Check description for specialty indicators
        for (const keyword of specialtyKeywords) {
            if (d.includes(keyword)) {
                if (d.includes('3-year') && d.includes('residency')) {
                    return 'Specialty Care';
                }
            }
        }

        // Residency indicator
        if (d.includes('3-year') && d.includes('residency')) {
            return 'Specialty Care';
        }

        // Emergency Care without specialty
        if (t.includes('emergency') && !t.includes('critical care')) {
            return 'Emergency Care';
        }

        // Default
        return 'General Practice Care';
    }

    // ===== Extract SALARY from description =====
    function extractSalary(description) {
        if (!description) return '';

        const d = description.toLowerCase();
        let salary = '';

        // Pattern 1: Explicit range with "per year"
        const annualPattern = /\$[\d,]+\s*[-–to]+\s*\$[\d,]+\s+per\s+year/gi;
        let match = d.match(annualPattern);
        if (match) {
            salary = match[0].replace(/per year/i, 'per year').trim();
            return salary.charAt(0).toUpperCase() + salary.slice(1);
        }

        // Pattern 2: Explicit range with "per hour"
        const hourlyPattern = /\$[\d,]+\s*[-–to]+\s*\$[\d,]+\s+per\s+hour/gi;
        match = d.match(hourlyPattern);
        if (match) {
            salary = match[0].replace(/per hour/i, 'per hour').trim();
            return salary.charAt(0).toUpperCase() + salary.slice(1);
        }

        // Pattern 3: Single amount with "per year"
        const singleAnnualPattern = /\$[\d,]+\s+per\s+year/gi;
        match = d.match(singleAnnualPattern);
        if (match) {
            salary = match[0].trim();
            return salary.charAt(0).toUpperCase() + salary.slice(1);
        }

        // Pattern 4: Single amount with "per hour"
        const singleHourlyPattern = /\$[\d,]+(?:\.\d{2})?\s+per\s+hour/gi;
        match = d.match(singleHourlyPattern);
        if (match) {
            salary = match[0].trim();
            return salary.charAt(0).toUpperCase() + salary.slice(1);
        }

        // Pattern 5: "up to" amounts
        const upToPattern = /up\s+to\s+\$[\d,]+(?:\s+per\s+(?:year|hour))?/gi;
        match = d.match(upToPattern);
        if (match) {
            salary = match[0].trim();
            if (!salary.toLowerCase().includes('per')) {
                salary += ' per year';
            }
            return salary.charAt(0).toUpperCase() + salary.slice(1);
        }

        // Pattern 6: Package amounts (signing, relocation, etc.)
        const packagePattern = /(?:signing|retention|relocation)\s+packages?\s+up\s+to\s+\$[\d,]+/gi;
        match = d.match(packagePattern);
        if (match) {
            return 'Packages up to $' + match[0].match(/\$[\d,]+/)[0].slice(1);
        }

        // Pattern 7: "base salary" + amount
        const basePattern = /(?:base\s+)?salary\s*:?\s*\$[\d,]+/gi;
        match = d.match(basePattern);
        if (match) {
            const amount = match[0].match(/\$[\d,]+/)[0];
            return `${amount} per year`;
        }

        // Pattern 8: "minimum base salary" (specific to PetVet)
        if (d.includes('high minimum base salary') || d.includes('minimum base salary')) {
            return 'Competitive (see description)';
        }

        // Pattern 9: Generic competitive/negotiable language
        if (d.includes('based on experience') || d.includes('negotiable') || d.includes('competitive')) {
            return 'Negotiable';
        }

        return '';
    }

    // ===== Determine JOB TYPE from title + description =====
    function determineJobType(title, description) {
        const t = (title || '').toLowerCase();
        const d = (description || '').toLowerCase();
        const fullTimeRegex = /\bfull[\s-]?time\b/;
        const partTimeRegex = /\bpart[\s-]?time\b/;

        const titleHasFull = fullTimeRegex.test(t);
        const titleHasPart = partTimeRegex.test(t);
        if (titleHasFull && titleHasPart) return 'Full Time';
        if (titleHasFull) return 'Full Time';
        if (titleHasPart) return 'Part Time';

        const descHasFull = fullTimeRegex.test(d);
        const descHasPart = partTimeRegex.test(d);
        if (descHasFull && descHasPart) return 'Full Time';
        if (descHasFull) return 'Full Time';
        if (descHasPart) return 'Part Time';

        return 'Full Time';
    }

    // ===== Main extraction function =====
    function extractDetails() {
        const title = getTitle();
        const description = getFullDescription();

        const position = determinePosition(title, description);
        const areaOfPractice = determineAreaOfPractice(title, description);
        const salary = extractSalary(description);
        const jobType = determineJobType(title, description);

        return {
            position: position || '',
            areaOfPractice: areaOfPractice || '',
            salary: salary || '',
            jobType: jobType || 'Full Time',
            description: description,
            title: title
        };
    }

    // ===== Send results to background script =====
    try {
        const details = extractDetails();
        chrome.runtime.sendMessage({
            action: 'detailsExtracted',
            details: details
        });
    } catch (e) {
        console.error('Error extracting details:', e);
        chrome.runtime.sendMessage({
            action: 'detailsExtracted',
            details: {
                position: '',
                areaOfPractice: '',
                salary: '',
                jobType: 'Full Time',
                description: '',
                error: e.message
            }
        });
    }
})();
