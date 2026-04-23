let allJobs = [];
let filteredJobs = [];
let selectedJobIndexes = new Set();
let isGettingDescriptions = false;
let isFetchingDetails = false;
let isFetchingAddresses = false;
let currentDetailsIndex = 0;
let detailsQueue = [];
let addressQueue = [];
let currentAddressIndex = 0;
let currentSort = { field: null, direction: 'asc' };
let tableScrollSyncLocked = false;
let tableResizeObserver = null;
const DETAILS_ANALYSIS_DELAY_MS = 300;

const EXCLUDED_JOB_TITLES = new Set([
    'Payroll Coordinator',
    'Marketing Analyst',
    'Analyst, Product Insights',
    'Marketing Automation Specialist',
    'TEST Veterinarian',
    'Senior Indirect Tax Analyst',
    'TEST ONLY DO NOT SUBMIT',
    'Data Scientist',
    'Financial Analyst',
    'Marketing Business Partner',
    'Director, Indirect Tax',
    'Tax Analyst',
    'Division Vice President',
    'Operations Analyst',
    'Staff Accountant'
].map(title => title.toLowerCase()));

const SPECIALTY_POSITIONS = new Set([
    'Anesthesiologist',
    'Cardiologist',
    'Credentialed Veterinary Technician Specialist',
    'DABVP Specialist',
    'Dental Specialist',
    'Dermatologist',
    'ECC Specialist',
    'Internal Medicine Specialist',
    'Medical Oncologist',
    'Neurologist & Neurosurgeon',
    'Ophthalmologist',
    'Radiation Oncologist',
    'Radiologist',
    'Surgeon',
    'Theriogenologist'
]);

const ALLOWED_POSITIONS = new Set([
    'Medical Director',
    'Associate Veterinarian',
    'Partner Veterinarian',
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
    'Surgeon'
]);

const SPECIALTY_CERTIFICATIONS = [
    'board certified',
    'residency trained',
    'diplomate',
    'dacvecc',
    'dacvim',
    'dacvr',
    'dacvs',
    'dacvd',
    'dacvo',
    'dacvaa',
    'dact',
    'davdc',
    'dabvp',
    'acvs',
    'acvim',
    'vts'
];

const SPECIALTY_SERVICE_KEYWORDS = [
    'oncology',
    'cardiology',
    'neurology',
    'neurosurgery',
    'dermatology',
    'ophthalmology',
    'anesthesia',
    'radiology',
    'diagnostic imaging',
    'internal medicine',
    'critical care',
    'specialty hospital',
    'specialty care'
];

const STATE_NAMES_BY_ABBR = {
    AL: 'Alabama',
    AK: 'Alaska',
    AZ: 'Arizona',
    AR: 'Arkansas',
    CA: 'California',
    CO: 'Colorado',
    CT: 'Connecticut',
    DE: 'Delaware',
    FL: 'Florida',
    GA: 'Georgia',
    HI: 'Hawaii',
    ID: 'Idaho',
    IL: 'Illinois',
    IN: 'Indiana',
    IA: 'Iowa',
    KS: 'Kansas',
    KY: 'Kentucky',
    LA: 'Louisiana',
    ME: 'Maine',
    MD: 'Maryland',
    MA: 'Massachusetts',
    MI: 'Michigan',
    MN: 'Minnesota',
    MS: 'Mississippi',
    MO: 'Missouri',
    MT: 'Montana',
    NE: 'Nebraska',
    NV: 'Nevada',
    NH: 'New Hampshire',
    NJ: 'New Jersey',
    NM: 'New Mexico',
    NY: 'New York',
    NC: 'North Carolina',
    ND: 'North Dakota',
    OH: 'Ohio',
    OK: 'Oklahoma',
    OR: 'Oregon',
    PA: 'Pennsylvania',
    RI: 'Rhode Island',
    SC: 'South Carolina',
    SD: 'South Dakota',
    TN: 'Tennessee',
    TX: 'Texas',
    UT: 'Utah',
    VT: 'Vermont',
    VA: 'Virginia',
    WA: 'Washington',
    WV: 'West Virginia',
    WI: 'Wisconsin',
    WY: 'Wyoming',
    DC: 'District of Columbia'
};

document.addEventListener('DOMContentLoaded', async () => {
    await loadJobs();
    setupEventListeners();
    setupBottomScrollbar();
    loadWebhookConfig();
});

function normalizeWhitespace(value) {
    return (value || '').replace(/\s+/g, ' ').trim();
}

function normalizeStateName(value) {
    const normalized = normalizeWhitespace(value);
    if (!normalized) return '';

    const upper = normalized.toUpperCase();
    if (STATE_NAMES_BY_ABBR[upper]) return STATE_NAMES_BY_ABBR[upper];

    const lower = normalized.toLowerCase();
    const matchedFullName = Object.values(STATE_NAMES_BY_ABBR).find(stateName => stateName.toLowerCase() === lower);
    return matchedFullName || normalized;
}

function normalizeTitleForComparison(title) {
    return normalizeWhitespace(title).toLowerCase();
}

function isExcludedJobTitle(title) {
    return EXCLUDED_JOB_TITLES.has(normalizeTitleForComparison(title));
}

function isNonClinicalTitle(title) {
    const normalized = normalizeTitleForComparison(title);
    if (!normalized) return false;

    return (
        isExcludedJobTitle(title) ||
        /client service|service representative|receptionist|kennel|groomer|grooming|practice manager|hospital manager|office manager|administrator|billing|human resources|patient care coordinator|client care coordinator|customer service|front desk|inventory|housekeeper|janitorial|externship|general job application|join our team|analyst|accountant|coordinator|marketing|tax|vice president|data scientist/.test(normalized)
    );
}

function sanitizeJobs(jobs) {
    return jobs.filter(job => !isExcludedJobTitle(job.jobTitle));
}

function containsSpecialtyRequirement(text) {
    const normalized = normalizeWhitespace(text).toLowerCase();
    if (!normalized) return false;

    return (
        /\bboard[\s-]?certified\b/.test(normalized) ||
        /\bresidency[\s-]?trained\b/.test(normalized) ||
        /\bboard[\s-]?certified\s+or\s+residency[\s-]?trained\b/.test(normalized)
    );
}

function normalizeDetectedPosition(position) {
    const normalized = normalizeWhitespace(position);
    return ALLOWED_POSITIONS.has(normalized) ? normalized : '';
}

function extractDetailsFromDescription(positionTitle, descriptionText) {
    function formatSalary(raw) {
        if (!raw) return '';
        const isHourly = /(?:per\s+)?(?:hour|hr|\/hr)/i.test(raw);
        const amounts = [];
        const amountRegex = /\$?([\d,]+(?:\.\d{2})?)\s*k?\b/gi;
        let match;
        while ((match = amountRegex.exec(raw)) !== null) {
            let num = parseFloat(match[1].replace(/,/g, ''));
            const afterMatch = raw.substring(match.index + match[0].length - 1, match.index + match[0].length + 1);
            if (/k/i.test(match[0]) || /k/i.test(afterMatch)) {
                num *= 1000;
            }
            if (num > 0) amounts.push(num);
        }
        if (amounts.length === 0) return raw;
        const fmt = (n) => {
            if (Number.isInteger(n)) return '$' + n.toLocaleString('en-US');
            return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        };
        const unit = isHourly ? 'per hour' : 'per year';
        if (amounts.length >= 2) {
            const min = Math.min(amounts[0], amounts[1]);
            const max = Math.max(amounts[0], amounts[1]);
            return `${fmt(min)}-${fmt(max)} ${unit}`;
        }
        return `${fmt(amounts[0])} ${unit}`;
    }

    function extractSalary(text) {
        if (!text) return '';

        const jsonLdMatch = text.match(/Salary Range:\s*([^\n]+)/i);
        if (jsonLdMatch) {
            return formatSalary(jsonLdMatch[1].trim());
        }

        const salaryPatterns = [
            /(?:base\s+salary\s*(?:ranges?)?)\s*(?:of|from|is|:)\s*\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s*[-–—]\s*\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?/i,
            /(?:base\s+salary\s*(?:ranges?)?)\s*(?:of|from|is|:)\s*\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s+to\s+\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?/i,
            /(?:(?:pay|salary|compensation)\s+range)\s*(?:of|from|is|:)\s*\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s*[-–—]\s*\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?/i,
            /(?:(?:pay|salary|compensation)\s+range)\s*(?:of|from|is|:)\s*\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s+to\s+\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?/i,
            /(?:salary|compensation|pay)[:\s]+\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s*[-–—]\s*\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?(?:\s*(?:per\s+)?(?:year|annually|annum|annual))?/i,
            /(?:salary|compensation|pay)[:\s]+\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s+to\s+\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?(?:\s*(?:per\s+)?(?:year|annually|annum|annual))?/i,
            /\$[\d,]+(?:\.\d{2})?\s*[-–—]\s*\$[\d,]+(?:\.\d{2})?/i,
            /\$[\d,]+(?:\.\d{2})?\s+to\s+\$[\d,]+(?:\.\d{2})?/i,
            /\$[\d,]+\s*(?:\/k|k)\s*[-–—]+\s*\$?[\d,]+\s*(?:\/k|k)/i,
            /\$[\d,]+\s*(?:\/k|k)?\s+to\s+\$?[\d,]+\s*(?:\/k|k)/i,
            /(?:earn|earning)\s+\$[\d,]+(?:\.\d{2})?\s*(?:annually|per\s*year)?/i,
            /\$[\d,]+(?:\.\d{2})?\s*(?:annually|per\s*year|per\s*annum)/i,
            /\$[\d,]+(?:\.\d{2})?\s*(?:per\s+)?(?:hour|hr|\/hr)/i
        ];
        for (const pattern of salaryPatterns) {
            const match = text.match(pattern);
            if (match) return formatSalary(match[0].trim());
        }
        return '';
    }

    function getIndustryCategory(text) {
        const match = text.match(/Industry\/Category:\s*([^\n]+)/i);
        return match ? match[1].trim() : '';
    }

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

    function determineAreaOfPractice(positionText, text) {
        const title = positionText.toLowerCase();
        const category = getIndustryCategory(text).toLowerCase();

        if (title.includes('urgent care')) return 'Urgent Care';

        if (category) {
            if (category.includes('gen practice')) return 'General Practice Care';
            if (category === 'veterinarian (er)' || category.includes('(er)')) return 'Emergency Care';
            if (category.includes('specialty diplomate') || category.includes('surgeon diplomate')) return 'Specialty Care';
        }

        const specialtyPositionNames = [
            'oncologist', 'cardiologist', 'neurologist', 'neurosurgeon',
            'dermatologist', 'ophthalmologist', 'anesthesiologist', 'theriogenologist',
            'radiologist', 'internist', 'criticalist', 'ecc specialist',
            'oncology', 'cardiology', 'neurology', 'dermatology', 'ophthalmology',
            'anesthesia', 'theriogenology', 'radiology'
        ];
        for (const sp of specialtyPositionNames) {
            if (title.includes(sp)) return 'Specialty Care';
        }

        const specialtyCerts = [
            'board certified', 'residency trained', 'residential trained',
            'diplomate', 'dacvecc', 'dacvim', 'dacvr', 'dacvs', 'dacvd', 'dacvo', 'dacvaa',
            'dact', 'davdc', 'dabvp', 'acvs', 'acvim'
        ];
        for (const cert of specialtyCerts) {
            if (title.includes(cert)) return 'Specialty Care';
        }

        if (title.includes('specialist') && !title.includes('technician specialist')) return 'Specialty Care';
        if (title.match(/\bsurgeon\b/) && !title.includes('neurosurgeon')) return 'Specialty Care';

        const emergencyPatterns = [
            /\bemergency\b/,
            /\ber\b/,
            /\ber vet\b/,
            /\ber dvm\b/,
            /\ber veterinarian\b/,
            /\becc\b/
        ];
        if (emergencyPatterns.some(pattern => pattern.test(title))) {
            return 'Emergency Care';
        }

        if (title.includes('equine') || title.includes('bovine') || title.includes('large animal') ||
            title.includes('avian') || title.includes('exotics')) {
            return 'General Practice Care / Emergency Care / Urgent Care';
        }

        const qualSection = extractQualificationsSection(text);
        if (qualSection) {
            const qualLower = qualSection.toLowerCase();
            for (const cert of specialtyCerts) {
                if (qualLower.includes(cert)) return 'Specialty Care';
            }
        }

        if (text.match(/Veterinarian \(ER\)/i)) return 'Emergency Care';

        return 'General Practice Care';
    }

    function matchPositionFromTitle(title) {
        const t = title.toLowerCase();

        if (t.includes('medical director')) return 'Medical Director';
        if (t.includes('lead veterinarian') || t.includes('lead vet')) return 'Lead Veterinarian';
        if (t.includes('neurologist') || t.includes('neurosurgeon') || t.includes('neurology')) return 'Neurologist & Neurosurgeon';
        if (t.includes('dermatologist') || t.includes('dermatology')) return 'Dermatologist';
        if (t.includes('cardiologist') || t.includes('cardiology')) return 'Cardiologist';
        if (t.includes('oncologist') && t.includes('radiation')) return 'Radiation Oncologist';
        if (t.includes('oncologist') || t.includes('oncology')) return 'Medical Oncologist';
        if (t.includes('radiologist') || t.includes('diagnostic imaging') || t.includes('radiology')) return 'Radiologist';
        if (t.includes('ophthalmologist') || t.includes('ophthalmology')) return 'Ophthalmologist';
        if (t.includes('anesthesiologist') || t.includes('anesthesia')) return 'Anesthesiologist';
        if (t.includes('theriogenologist') || t.includes('theriogenology')) return 'Theriogenologist';
        if (t.includes('internist') || t.includes('internal medicine')) return 'Internal Medicine Specialist';
        if (t.includes('criticalist') || t.match(/\becc\b/) || t.includes('emergency medicine')) return 'ECC Specialist';
        if (t.includes('dabvp')) return 'DABVP Specialist';
        if ((t.includes('dental') || t.includes('dentist') || t.includes('dentistry')) && !t.includes('assistant')) return 'Dental Specialist';
        if ((t.includes('surgeon') || t.includes('surgery')) && !t.includes('neurosurgeon') && !t.includes('neurology') && !t.includes('dental') && !t.includes('dentistry')) return 'Surgeon';
        if (t.includes('technician specialist') || (t.match(/\bvts\b/) && t.includes('specialist'))) return 'Credentialed Veterinary Technician Specialist';
        if (t.includes('equine') || t.includes('bovine') || t.includes('large animal')) return 'Equine/Bovine Veterinarian/Large Animal';
        if (t.includes('avian') || t.includes('exotics')) return 'Avian & Exotics Veterinarian / Associate Exotics';
        if (t.includes('partner veterinarian')) return 'Partner Veterinarian';

        return '';
    }

    function matchPositionFromQualifications(text) {
        const qualSection = extractQualificationsSection(text);
        if (!qualSection) return '';
        const q = qualSection.toLowerCase();
        if (q.includes('dacvecc')) return 'ECC Specialist';
        if (q.includes('dacvim') && q.includes('oncology')) return 'Medical Oncologist';
        if (q.includes('dacvr') && q.includes('radiation')) return 'Radiation Oncologist';
        if (q.includes('dacvim') && q.includes('neurology')) return 'Neurologist & Neurosurgeon';
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
        return '';
    }

    function validatePositionForAOP(position, aop) {
        const validPositions = {
            'Emergency Care': ['Associate Veterinarian'],
            'General Practice Care': ['Associate Veterinarian', 'Lead Veterinarian', 'Medical Director', 'Partner Veterinarian'],
            'Specialty Care': [
                'Anesthesiologist', 'Cardiologist', 'Credentialed Veterinary Technician Specialist',
                'DABVP Specialist', 'Dental Specialist', 'Dermatologist', 'ECC Specialist',
                'Internal Medicine Specialist', 'Medical Director', 'Medical Oncologist',
                'Neurologist & Neurosurgeon', 'Ophthalmologist', 'Radiation Oncologist',
                'Radiologist', 'Surgeon'
            ],
            'Urgent Care': ['Associate Veterinarian', 'Partner Veterinarian']
        };

        const aopParts = aop.split('/').map(s => s.trim());
        for (const part of aopParts) {
            const allowed = validPositions[part];
            if (allowed && allowed.includes(position)) return position;
        }

        const hasKnownAOP = aopParts.some(part => validPositions[part]);
        if (hasKnownAOP) return 'Associate Veterinarian';

        const allValid = new Set(Object.values(validPositions).flat());
        if (allValid.has(position)) return position;

        return 'Associate Veterinarian';
    }

    function determinePosition(positionText, text, areaOfPractice) {
        let position = matchPositionFromTitle(positionText);
        if (!position && areaOfPractice === 'Specialty Care') {
            position = matchPositionFromQualifications(text);
        }
        if (position) {
            position = validatePositionForAOP(position, areaOfPractice);
        }
        if (position === 'Associate Veterinarian' && positionText.toLowerCase().includes('medical director')) {
            position = 'Medical Director';
        }
        if (!position) position = 'Associate Veterinarian';
        return position;
    }

    function extractLocations(text) {
        const primaryText = text.split(/\bSimilar jobs\b/i)[0];
        const locations = [];
        const locationsSection = primaryText.match(/Locations:\n((?:\s*-\s*[^\n]+\n?)+)/i);
        if (locationsSection) {
            const locationLines = locationsSection[1].split('\n');
            for (const line of locationLines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('-')) continue;
                const parts = trimmed.replace(/^-\s*/, '').split(',').map(s => s.trim()).filter(Boolean);
                if (parts.length >= 2) {
                    const city = parts[0];
                    let state = parts[1];
                    if (state.length > 2) {
                        const stateAbbrev = primaryText.match(new RegExp(`${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')},\\s*([A-Z]{2})\\b`));
                        if (stateAbbrev) {
                            state = stateAbbrev[1];
                        }
                    }
                    state = normalizeStateName(state);
                    locations.push({ city, state, location: `${city}, ${state}` });
                }
            }
        }

        if (locations.length === 0) {
            let searchText = primaryText.replace(/^Description\s*/i, '').replace(/^Position at\s*/i, '');
            searchText = searchText.substring(0, 500);
            const matches = searchText.matchAll(/\b([A-Za-z][\w\s.'()-]*[A-Za-z])\s*,\s*([A-Z]{2})\b/g);
            for (const match of matches) {
                const city = match[1].trim();
                const state = normalizeStateName(match[2].trim());
                const invalidWords = ['description', 'position', 'associate', 'veterinarian', 'hospital', 'care', 'center', 'clinic', 'location'];
                if (!invalidWords.some(word => city.toLowerCase().includes(word)) && city.length > 1 && city.length < 50) {
                    locations.push({ city, state, location: `${city}, ${state}` });
                }
            }
        }

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

    function extractHospitalName(text) {
        const primaryText = text.split(/\bSimilar jobs\b/i)[0];

        const hiringOrgMatch = primaryText.match(/Hiring Organization:\s*([^\n]+)/i);
        if (hiringOrgMatch) {
            return hiringOrgMatch[1].trim();
        }

        const positionAtMatch = primaryText.match(/Position at\s+((?:[\w'.&-]+\s+){1,8}(?:Animal\s+Hospital|Veterinary\s+(?:Hospital|Center|Clinic|Care|Specialists?)|Pet\s+(?:Hospital|Clinic|Care)|Emergency\s+(?:Hospital|Center|Clinic)|The\s+[A-Z][\w\s]+Service))/i);
        if (positionAtMatch) {
            return positionAtMatch[1].trim();
        }

        const hospitalMatch = primaryText.match(/at\s+((?:[\w'.&-]+\s+){1,5}(?:Animal\s+Hospital|Veterinary\s+(?:Hospital|Center|Clinic|Care|Specialists?)|Pet\s+(?:Hospital|Clinic|Care)|Emergency\s+(?:Hospital|Center|Clinic)|The\s+[A-Z][\w\s]+Service))\b/i);
        if (hospitalMatch) {
            return hospitalMatch[1].trim();
        }

        return '';
    }

    function extractJobType(text) {
        if (!text) return 'Full-Time';
        const lower = text.toLowerCase();

        const empTypeMatch = lower.match(/employment type:\s*([^\n]+)/i);
        if (empTypeMatch) {
            const empType = empTypeMatch[1].trim().toLowerCase();
            if (/\bpt(?:\d+)?\b/.test(empType)) return 'Part-Time';
            if (/\bft(?:\d+)?\b/.test(empType)) return 'Full-Time';
            if (empType.includes('part') && empType.includes('full')) return 'Full-Time';
            if (empType.includes('part')) return 'Part-Time';
            return 'Full-Time';
        }

        if (/\bpt(?:\d+)?\b/i.test(lower)) return 'Part-Time';
        if (/\bft(?:\d+)?\b/i.test(lower)) return 'Full-Time';
        const hasPartTime = /\bpart[\s-]?time\b/i.test(lower);
        const hasFullTime = /\bfull[\s-]?time\b/i.test(lower);

        if (hasPartTime && hasFullTime) return 'Full-Time';
        if (hasPartTime) return 'Part-Time';
        return 'Full-Time';
    }

    const salary = extractSalary(descriptionText);
    const areaOfPractice = determineAreaOfPractice(positionTitle, descriptionText);
    const position = determinePosition(positionTitle, descriptionText, areaOfPractice);
    const locations = extractLocations(descriptionText);
    const hospitalName = extractHospitalName(descriptionText);
    const jobType = extractJobType(descriptionText);

    return {
        salary,
        areaOfPractice,
        position,
        locations,
        hospitalName,
        jobType
    };
}

function extractQualificationsSection(text) {
    if (!text) return '';

    const patterns = [
        /(?:requirements?|qualifications?|what you'?ll need|what we'?re looking for|credentials?|must have|what we need)[:\s]*([\s\S]{0,800}?)(?=(?:benefits?|compensation|salary|about|our culture|location|equal|join us|why|facility|what we offer|ready to)[:\s])/i,
        /(?:requirements?|qualifications?|what you'?ll need|what we'?re looking for|credentials?|must have|what we need)[:\s]*([\s\S]{0,500})/i
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) return match[1];
    }

    return text;
}

function extractStructuredMetadataValue(text, labels) {
    for (const label of labels) {
        const pattern = new RegExp(`^${label}:\\s*(.+)$`, 'im');
        const match = text.match(pattern);
        if (match) return normalizeWhitespace(match[1]);
    }

    return '';
}

function hasSpecialtyCertification(text) {
    const lowerText = (text || '').toLowerCase();
    return SPECIALTY_CERTIFICATIONS.some(keyword => lowerText.includes(keyword));
}

function countSpecialtySignals(text) {
    const lowerText = (text || '').toLowerCase();
    return SPECIALTY_SERVICE_KEYWORDS.reduce((count, keyword) => count + (lowerText.includes(keyword) ? 1 : 0), 0);
}

function matchPositionFromTitle(jobTitle) {
    const title = (jobTitle || '').toLowerCase();

    if (!title || isNonClinicalTitle(jobTitle)) return '';
    if (/medical director|medical lead/.test(title)) return 'Medical Director';
    if (/lead veterinarian|lead vet\b/.test(title)) return 'Lead Veterinarian';
    if (/associate veterinarian|associate vet\b/.test(title)) return 'Associate Veterinarian';
    if (/partner veterinarian/.test(title)) return 'Partner Veterinarian';
    if (/criticalist|dacvecc|\becc specialist\b/.test(title) || (title.includes('emergency') && title.includes('critical care'))) return 'ECC Specialist';
    if (/technician specialist|\bvts\b/.test(title)) return 'Credentialed Veterinary Technician Specialist';
    if (/neurologist|neurosurgeon|neurology/.test(title)) return 'Neurologist & Neurosurgeon';
    if (/dermatologist|dermatology/.test(title)) return 'Dermatologist';
    if (/cardiologist|cardiology/.test(title)) return 'Cardiologist';
    if (/radiation oncolog/.test(title)) return 'Radiation Oncologist';
    if (/oncologist|oncology/.test(title)) return 'Medical Oncologist';
    if (/radiologist|diagnostic imaging|radiology/.test(title)) return 'Radiologist';
    if (/ophthalmologist|ophthalmology/.test(title)) return 'Ophthalmologist';
    if (/anesthesiologist|anesthesia/.test(title)) return 'Anesthesiologist';
    if (/theriogenologist|theriogenology/.test(title)) return 'Theriogenologist';
    if (/internist|internal medicine/.test(title)) return 'Internal Medicine Specialist';
    if (/\bdabvp\b/.test(title)) return 'DABVP Specialist';
    if (/(dental|dentist|dentistry)/.test(title) && !/assistant/.test(title)) return 'Dental Specialist';
    if ((/surgeon|surgery/.test(title)) && !/neurosurgeon|neurology|dental|dentistry/.test(title)) return 'Surgeon';
    if (/equine|bovine|large animal/.test(title)) return 'Equine/Bovine Veterinarian/Large Animal';
    if (/\bavian\b|exotics/.test(title)) return 'Avian & Exotics Veterinarian / Associate Exotics';
    if (/veterinarian|veterinary|\bdvm\b|relief|locum/.test(title)) return 'Associate Veterinarian';

    return '';
}

function matchPositionFromQualifications(descriptionText) {
    const qualifications = extractQualificationsSection(descriptionText).toLowerCase();
    if (!qualifications) return '';

    if (qualifications.includes('dacvecc')) return 'ECC Specialist';
    if (qualifications.includes('dacvim') && qualifications.includes('oncology')) return 'Medical Oncologist';
    if (qualifications.includes('dacvr') && qualifications.includes('radiation')) return 'Radiation Oncologist';
    if (qualifications.includes('dacvim') && qualifications.includes('neurology')) return 'Neurologist & Neurosurgeon';
    if (qualifications.includes('dacvim') && qualifications.includes('cardiology')) return 'Cardiologist';
    if (qualifications.includes('dacvim')) return 'Internal Medicine Specialist';
    if (qualifications.includes('davdc') || qualifications.includes('avdc')) return 'Dental Specialist';
    if (qualifications.includes('dacvd')) return 'Dermatologist';
    if (qualifications.includes('dacvs') || qualifications.includes('acvs')) return 'Surgeon';
    if (qualifications.includes('dacvr')) return 'Radiologist';
    if (qualifications.includes('dacvo')) return 'Ophthalmologist';
    if (qualifications.includes('dacvaa')) return 'Anesthesiologist';
    if (qualifications.includes('dact')) return 'Theriogenologist';
    if (qualifications.includes('dabvp')) return 'DABVP Specialist';

    return '';
}

function matchPositionFromDescription(descriptionText) {
    const description = (descriptionText || '').toLowerCase();
    if (!description) return '';

    const condensed = description.substring(0, 2500);

    if (/regional medical director/.test(condensed)) return 'Medical Director';
    if (/founding partner\s*(?:&|and)\s*lead veterinarian/.test(condensed)) return 'Lead Veterinarian';
    if (/medical lead veterinarian|medical lead\b/.test(condensed)) return 'Medical Director';
    if (/lead veterinarian|lead vet\b/.test(condensed)) return 'Lead Veterinarian';
    if (/dental specialist/.test(condensed)) return 'Dental Specialist';
    if (/radiation oncolog/.test(condensed)) return 'Radiation Oncologist';
    if (/medical oncolog/.test(condensed)) return 'Medical Oncologist';
    if (/cardiolog/.test(condensed)) return 'Cardiologist';
    if (/neurolog|neurosurg/.test(condensed)) return 'Neurologist & Neurosurgeon';
    if (/dermatolog/.test(condensed)) return 'Dermatologist';
    if (/ophthalmolog/.test(condensed)) return 'Ophthalmologist';
    if (/anesthesiolog/.test(condensed)) return 'Anesthesiologist';
    if (/internist|internal medicine specialist/.test(condensed)) return 'Internal Medicine Specialist';
    if (/radiolog|diagnostic imaging/.test(condensed)) return 'Radiologist';
    if (/\becc specialist\b|criticalist|emergency and critical care/.test(condensed)) return 'ECC Specialist';
    if (/\bdabvp\b/.test(condensed)) return 'DABVP Specialist';
    if (/\bcredentialed veterinary technician specialist\b|\bvts\b/.test(condensed)) return 'Credentialed Veterinary Technician Specialist';
    if (/\bsurgeon\b/.test(condensed) && !/neurosurg|dental/.test(condensed)) return 'Surgeon';

    return '';
}

function validatePositionForAOP(position, aop) {
    return normalizeDetectedPosition(position);
}

function determineAreaOfPractice(jobTitle, descriptionText, hospitalName) {
    const title = (jobTitle || '').toLowerCase();
    const description = (descriptionText || '').toLowerCase();
    const hospital = (hospitalName || '').toLowerCase();
    const qualifications = extractQualificationsSection(descriptionText).toLowerCase();

    if (isNonClinicalTitle(jobTitle)) return '';

    const titlePosition = matchPositionFromTitle(jobTitle);
    const qualificationsPosition = matchPositionFromQualifications(descriptionText);
    const targetedSpecialtySignals = countSpecialtySignals([title, hospital, qualifications].join(' '));
    const descriptionSpecialtySignals = countSpecialtySignals(description);

    if (title.includes('urgent care') || hospital.includes('urgent care')) return 'Urgent Care';
    if (containsSpecialtyRequirement(descriptionText)) return 'Specialty Care';
    if (SPECIALTY_POSITIONS.has(titlePosition) || SPECIALTY_POSITIONS.has(qualificationsPosition)) return 'Specialty Care';
    if (hasSpecialtyCertification(`${title} ${qualifications}`)) return 'Specialty Care';
    if ((title.includes('specialist') && !title.includes('technician specialist')) || /\bsurgeon\b/.test(title)) return 'Specialty Care';
    if (
        title.includes('emergency') ||
        /\ber\b/.test(title) ||
        /\ber\s+vet\b/.test(title) ||
        /\ber\s+dvm\b/.test(title) ||
        description.includes('veterinarian (er)')
    ) {
        return 'Emergency Care';
    }
    if (hospital.includes('emergency') && titlePosition !== 'Medical Director') return 'Emergency Care';
    if (targetedSpecialtySignals > 0) return 'Specialty Care';
    if ((description.includes('specialty hospital') || description.includes('specialty care')) && descriptionSpecialtySignals > 0) return 'Specialty Care';

    if (titlePosition === 'Medical Director') {
        if (targetedSpecialtySignals > 0 || hasSpecialtyCertification(descriptionText)) return 'Specialty Care';
        if (title.includes('emergency') || hospital.includes('emergency')) return 'Emergency Care';
        return 'General Practice Care';
    }

    if (
        title.includes('equine') ||
        title.includes('bovine') ||
        title.includes('large animal') ||
        title.includes('avian') ||
        title.includes('exotics')
    ) {
        return 'General Practice Care / Emergency Care / Urgent Care';
    }

    if (description.includes('urgent care')) return 'Urgent Care';

    return 'General Practice Care';
}

function determinePosition(jobTitle, descriptionText, areaOfPractice) {
    if (isNonClinicalTitle(jobTitle)) return '';

    let position = matchPositionFromTitle(jobTitle);

    if (!position) {
        position = matchPositionFromDescription(descriptionText);
    }

    if (!position && areaOfPractice === 'Specialty Care') {
        position = matchPositionFromQualifications(descriptionText);
    }

    return validatePositionForAOP(position, areaOfPractice);
}

function formatSalary(raw) {
    if (!raw) return '';

    const isHourly = /(?:per\s+)?(?:hour|hr|\/hr)/i.test(raw);
    const amounts = [];
    const amountRegex = /\$?([\d,]+(?:\.\d{2})?)\s*k?\b/gi;
    let match;

    while ((match = amountRegex.exec(raw)) !== null) {
        let amount = parseFloat(match[1].replace(/,/g, ''));
        const suffix = raw.substring(match.index, match.index + match[0].length + 1);
        if (/k/i.test(match[0]) || /k/i.test(suffix)) {
            amount *= 1000;
        }
        if (amount > 0) amounts.push(amount);
    }

    if (amounts.length === 0) return normalizeWhitespace(raw);

    const formatAmount = (value) => (
        Number.isInteger(value)
            ? `$${value.toLocaleString('en-US')}`
            : `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    );

    const unit = isHourly ? 'per hour' : 'per year';

    if (amounts.length >= 2) {
        const min = Math.min(amounts[0], amounts[1]);
        const max = Math.max(amounts[0], amounts[1]);
        return `${formatAmount(min)}-${formatAmount(max)} ${unit}`;
    }

    return `${formatAmount(amounts[0])} ${unit}`;
}

function extractSalary(descriptionText) {
    const explicitSalary = extractStructuredMetadataValue(descriptionText, ['Salary Range', 'Salary', 'Base Salary']);
    if (explicitSalary) return formatSalary(explicitSalary);

    const salaryPatterns = [
        /(?:base\s+salary\s*(?:ranges?)?)\s*(?:of|from|is|:)\s*\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s*[-–—]\s*\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?/i,
        /(?:base\s+salary\s*(?:ranges?)?)\s*(?:of|from|is|:)\s*\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s+to\s+\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?/i,
        /(?:(?:pay|salary|compensation)\s+range)\s*(?:of|from|is|:)\s*\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s*[-–—]\s*\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?/i,
        /(?:(?:pay|salary|compensation)\s+range)\s*(?:of|from|is|:)\s*\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s+to\s+\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?/i,
        /(?:salary|compensation|pay)[:\s]+\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s*[-–—]\s*\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?(?:\s*(?:per\s+)?(?:year|annually|annum|annual))?/i,
        /(?:salary|compensation|pay)[:\s]+\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s+to\s+\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?(?:\s*(?:per\s+)?(?:year|annually|annum|annual))?/i,
        /\$[\d,]+(?:\.\d{2})?\s*[-–—]\s*\$[\d,]+(?:\.\d{2})?/i,
        /\$[\d,]+(?:\.\d{2})?\s+to\s+\$[\d,]+(?:\.\d{2})?/i,
        /\$[\d,]+\s*(?:\/k|k)\s*[-–—]+\s*\$?[\d,]+\s*(?:\/k|k)/i,
        /\$[\d,]+\s*(?:\/k|k)?\s+to\s+\$?[\d,]+\s*(?:\/k|k)/i,
        /(?:earn|earning)\s+\$[\d,]+(?:\.\d{2})?\s*(?:annually|per\s*year)?/i,
        /\$[\d,]+(?:\.\d{2})?\s*(?:annually|per\s*year|per\s*annum)/i,
        /\$[\d,]+(?:\.\d{2})?\s*(?:per\s+)?(?:hour|hr|\/hr)/i
    ];

    for (const pattern of salaryPatterns) {
        const match = descriptionText.match(pattern);
        if (match) return formatSalary(match[0].trim());
    }

    return '';
}

function normalizeJobType(rawValue) {
    const value = normalizeWhitespace(rawValue);
    const lowerValue = value.toLowerCase();

    if (!value) return '';
    if (/\bpt(?:\d+)?\b/.test(lowerValue)) return 'Part Time';
    if (/\bft(?:\d+)?\b/.test(lowerValue)) return 'Full Time';
    if (/part[\s-]?time/.test(lowerValue)) return 'Part Time';
    if (/full[\s-]?time/.test(lowerValue)) return 'Full Time';
    if (/per[\s-]?diem/.test(lowerValue)) return 'Per Diem';
    if (/relief/.test(lowerValue)) return 'Relief';
    if (/locum/.test(lowerValue)) return 'Locum';
    if (/contract/.test(lowerValue)) return 'Contract';
    if (/temporary|temp\b/.test(lowerValue)) return 'Temporary';
    if (/intern(ship)?/.test(lowerValue)) return 'Internship';

    return value;
}

function extractJobType(descriptionText) {
    const explicitType = extractStructuredMetadataValue(descriptionText, ['Employment Type', 'Job Type', 'Schedule', 'Pay Class']);
    const normalizedExplicitType = normalizeJobType(explicitType);
    if (normalizedExplicitType) return normalizedExplicitType;

    const text = (descriptionText || '').toLowerCase();

    if (/\bpt(?:\d+)?\b/.test(text)) return 'Part Time';
    if (/\bft(?:\d+)?\b/.test(text)) return 'Full Time';
    if (/part[\s-]?time/.test(text) && !/full[\s-]?time/.test(text)) return 'Part Time';
    if (/full[\s-]?time/.test(text)) return 'Full Time';
    if (/per[\s-]?diem/.test(text)) return 'Per Diem';
    if (/relief/.test(text)) return 'Relief';
    if (/locum/.test(text)) return 'Locum';
    if (/contract/.test(text)) return 'Contract';
    if (/temporary|temp\b/.test(text)) return 'Temporary';
    if (/intern(ship)?/.test(text)) return 'Internship';

    return '';
}

function extractState(descriptionText) {
    const explicitState = extractStructuredMetadataValue(descriptionText, ['State']);
    if (explicitState) return normalizeStateName(explicitState);

    const locations = extractLocations(descriptionText);
    if (locations.length > 0 && locations[0].state) {
        return normalizeStateName(locations[0].state);
    }

    return '';
}

function formatExtractedSalary(raw) {
    if (!raw) return '';

    const amounts = [];
    const amountRegex = /\$?\s*([\d,]+(?:\.\d{2})?)\s*(k)?\b/gi;
    let match;

    while ((match = amountRegex.exec(raw)) !== null) {
        let amount = parseFloat(match[1].replace(/,/g, ''));
        if (!Number.isFinite(amount)) continue;
        if (match[2]) amount *= 1000;
        if (amount > 0) amounts.push(amount);
    }

    if (amounts.length === 0) return normalizeWhitespace(raw);

    const formatAmount = (value) => (
        Number.isInteger(value)
            ? `$${value.toLocaleString('en-US')}`
            : `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    );

    let unit = 'yearly';
    if (/(?:per\s+)?(?:hour|hr|\/hr)|hourly/i.test(raw)) unit = 'hourly';
    else if (/(?:per\s+)?shift|per-shift/i.test(raw)) unit = 'per shift';
    else if (/(?:per\s+)?day|daily|per[\s-]?diem/i.test(raw)) unit = 'daily';
    else if (/(?:per\s+)?week|weekly|\/wk/i.test(raw)) unit = 'weekly';
    else if (/(?:per\s+)?month|monthly/i.test(raw)) unit = 'monthly';

    if (/up to/i.test(raw) && amounts.length >= 1) {
        return `Up to ${formatAmount(amounts[0])} ${unit}`;
    }

    if (amounts.length >= 2 || /\b(?:to|through)\b|[-–—]/.test(raw)) {
        const min = Math.min(amounts[0], amounts[1]);
        const max = Math.max(amounts[0], amounts[1]);
        return `${formatAmount(min)} - ${formatAmount(max)} ${unit}`;
    }

    return `${formatAmount(amounts[0])} ${unit}`;
}

function extractRobustSalary(descriptionText) {
    const explicitSalary = extractStructuredMetadataValue(descriptionText, ['Salary Range', 'Salary', 'Base Salary']);
    if (explicitSalary) return formatExtractedSalary(explicitSalary);

    const candidates = (descriptionText || '')
        .split('\n')
        .map(line => normalizeWhitespace(line))
        .filter(Boolean)
        .filter(line => /\$/.test(line));

    const salaryPatterns = [
        /(?:base\s+salary|salary|compensation|pay|earning)[^.\n]{0,80}\$[\d,]+(?:\.\d{2})?\s*(?:k)?\s*(?:to|[-–—])\s*\$?[\d,]+(?:\.\d{2})?\s*(?:k)?[^.\n]{0,40}(?:year|annual|annually|annum|yearly|hour|hr|hourly|shift|daily|weekly|monthly)?/i,
        /\$[\d,]+(?:\.\d{2})?\s*(?:k)?\s*(?:to|[-–—])\s*\$?[\d,]+(?:\.\d{2})?\s*(?:k)?[^.\n]{0,40}(?:year|annual|annually|annum|yearly|hour|hr|hourly|shift|daily|weekly|monthly)?/i,
        /(?:salary|compensation|pay|base\s+salary|earning)[^.\n]{0,60}\$[\d,]+(?:\.\d{2})?\s*(?:k)?[^.\n]{0,30}(?:per\s+shift|shift|per\s+hour|hourly|hour|hr|\/hr|per\s+year|annually|annual|annum|yearly|per\s+day|daily|per\s+week|weekly|per\s+month|monthly)/i,
        /\$[\d,]+(?:\.\d{2})?\s*(?:k)?\s*(?:per\s+shift|shift|per\s+hour|hourly|hour|hr|\/hr|per\s+year|annually|annual|annum|yearly|per\s+day|daily|per\s+week|weekly|per\s+month|monthly)/i,
        /up to\s+\$[\d,]+(?:\.\d{2})?\s*(?:k)?[^.\n]{0,20}(?:year|annual|annually|annum|yearly|hour|hr|hourly|shift|daily|weekly|monthly)?/i
    ];

    for (const candidate of [...candidates, descriptionText || '']) {
        for (const pattern of salaryPatterns) {
            const match = candidate.match(pattern);
            if (match) return formatExtractedSalary(match[0].trim());
        }
    }

    return '';
}

function extractExperience(descriptionText) {
    const segments = (descriptionText || '')
        .split(/\n|(?<=[.!?])\s+/)
        .map(segment => normalizeWhitespace(segment))
        .filter(Boolean);

    const relevantSegments = segments.filter(segment => /\bexperience\b|\bexperienced\b/i.test(segment));
    const prioritizedSegments = [
        ...relevantSegments.filter(segment => /\brequired|requireds?|must have|needs?|minimum|at least|should have|should be|requires?\b/i.test(segment)),
        ...relevantSegments.filter(segment => !/\brequired|requireds?|must have|needs?|minimum|at least|should have|should be|requires?\b/i.test(segment))
    ];

    const patterns = [
        /\b(?:minimum of\s+|at least\s+|requires?\s+|required[:\s]+|must have\s+|needs?\s+|should have\s+|should be\s+)?(\d+(?:\.\d+)?)\s*(?:\+)?\s*(?:-|to|–|—)\s*(\d+(?:\.\d+)?)\s+years?\s+(?:of\s+)?experience\b/i,
        /\bexperience\s+(?:required|requires?|should be|must be|must have|needed|needs?|of)?[:\s]+(\d+(?:\.\d+)?)\s*(?:\+)?\s*(?:-|to|–|—)\s*(\d+(?:\.\d+)?)\s+years?\b/i,
        /\b(?:minimum of\s+|at least\s+|requires?\s+|required[:\s]+|must have\s+|needs?\s+|should have\s+|should be\s+)?(\d+(?:\.\d+)?)\s*(\+)?\s+years?\s+(?:of\s+)?experience\b/i,
        /\bexperience\s+(?:required|requires?|should be|must be|must have|needed|needs?|of)?[:\s]+(\d+(?:\.\d+)?)\s*(\+)?\s+years?\b/i,
        /\b(\d+(?:\.\d+)?)\s*(\+)?\s+years?\b(?=[^.\n]{0,40}\bexperience\b)/i
    ];

    for (const segment of prioritizedSegments) {
        if (/\bpreferred|preferably|nice to have\b/i.test(segment)) continue;

        for (const pattern of patterns) {
            const match = segment.match(pattern);
            if (!match) continue;

            if (match[2] && /^\d/.test(match[2])) {
                return `${match[1]}-${match[2]} years`;
            }

            return match[2] === '+' ? `${match[1]}+ years` : `${match[1]} years`;
        }
    }

    return '';
}

function deriveDetailsFromDescription(job) {
    const description = job.description || '';
    const jobTitle = job.jobTitle || '';
    const extracted = extractDetailsFromDescription(jobTitle, description);
    const firstLocation = extracted.locations && extracted.locations.length > 0 ? extracted.locations[0] : null;
    const hospitalName = job.hospitalName || extracted.hospitalName || '';
    const areaOfPractice = determineAreaOfPractice(jobTitle, description, hospitalName);
    const position = determinePosition(jobTitle, description, areaOfPractice);
    const salary = extractRobustSalary(description) || extracted.salary || job.salary || '';
    const experience = extractExperience(description) || job.experience || '';
    const jobType = extractJobType(description) || extracted.jobType || job.jobType || 'Full-Time';
    const state = extractState(description) || normalizeStateName(job.state || firstLocation?.state || '');

    return {
        areaOfPractice: areaOfPractice || extracted.areaOfPractice || job.areaOfPractice || '',
        position,
        salary,
        experience,
        jobType,
        hospitalName,
        city: job.city || firstLocation?.city || '',
        state
    };
}

async function loadJobs() {
    try {
        const data = await chrome.storage.local.get(['scrapedJobs']);
        let jobs = data.scrapedJobs || [];
        const sanitizedJobs = sanitizeJobs(jobs);

        if (sanitizedJobs.length !== jobs.length) {
            jobs = sanitizedJobs;
            await chrome.storage.local.set({ scrapedJobs: jobs });
        }

        if (jobs.length === 0) {
            document.getElementById('noData').classList.remove('hidden');
            document.querySelector('.table-wrapper').classList.add('hidden');
            return;
        }

        document.getElementById('noData').classList.add('hidden');
        document.querySelector('.table-wrapper').classList.remove('hidden');

        allJobs = jobs;
        filteredJobs = [...jobs];

        populateStateFilter();
        updateStats();
        displayJobs(filteredJobs);
    } catch (error) {
        console.error('Error loading jobs:', error);
        alert('Error loading jobs data.');
    }
}

function populateStateFilter() {
    const stateFilter = document.getElementById('stateFilter');
    const states = [...new Set(allJobs.map(job => job.state).filter(Boolean))].sort();
    stateFilter.innerHTML = '<option value="">All States</option>';
    states.forEach(state => {
        const option = document.createElement('option');
        option.value = state;
        option.textContent = state;
        stateFilter.appendChild(option);
    });
}

function updateStats() {
    const duplicateIds = findDuplicateIds();
    const duplicateCount = allJobs.filter(job => duplicateIds.has(job.jobId)).length;
    const withDescCount = allJobs.filter(job => job.description).length;

    document.getElementById('total-count').textContent = allJobs.length;
    document.getElementById('selected-count').textContent = selectedJobIndexes.size;
    document.getElementById('duplicate-count').textContent = duplicateCount;
    document.getElementById('with-desc-count').textContent = withDescCount;
}

function findDuplicateIds() {
    const counts = {};
    allJobs.forEach(job => {
        if (job.jobId) counts[job.jobId] = (counts[job.jobId] || 0) + 1;
    });

    return new Set(Object.keys(counts).filter(jobId => counts[jobId] > 1));
}

function displayJobs(jobs) {
    const tbody = document.getElementById('jobsTableBody');
    const tableWrapper = document.querySelector('.table-wrapper');
    const noResults = document.getElementById('noResults');
    tbody.innerHTML = '';

    if (jobs.length === 0) {
        tableWrapper.classList.add('hidden');
        noResults.classList.remove('hidden');
        return;
    }

    tableWrapper.classList.remove('hidden');
    noResults.classList.add('hidden');

    jobs.forEach((job, filteredIndex) => {
        const originalIndex = allJobs.indexOf(job);
        const isSelected = selectedJobIndexes.has(originalIndex);
        const hasDescription = Boolean(job.description);
        const row = document.createElement('tr');
        row.dataset.originalIndex = originalIndex;
        row.className = isSelected ? 'selected' : '';

        const descHtml = hasDescription
            ? `<span class="description-preview" data-original-index="${originalIndex}" title="${escapeHtml(job.description.substring(0, 200))}">${escapeHtml(job.description.substring(0, 80))}...</span>`
            : '<span class="badge badge-missing">Missing</span>';

        row.innerHTML = `
            <td class="col-num">${filteredIndex + 1}</td>
            <td class="col-jobid">${escapeHtml(job.jobId || '')}</td>
            <td class="col-title">${escapeHtml(job.jobTitle || '')}</td>
            <td class="col-aop">${escapeHtml(job.areaOfPractice || '')}</td>
            <td class="col-position">${escapeHtml(job.position || '')}</td>
            <td class="col-address">${escapeHtml(job.streetAddress || '')}</td>
            <td class="col-city">${escapeHtml(job.city || '')}</td>
            <td class="col-state">${escapeHtml(job.state || '')}</td>
            <td class="col-zip">${escapeHtml(job.postalCode || '')}</td>
            <td class="col-hospital">${escapeHtml(job.hospitalName || '')}</td>
            <td class="col-phone">${escapeHtml(job.phone || '')}</td>
            <td class="col-website">${job.website ? `<a href="${escapeHtml(job.website)}" target="_blank">Visit</a>` : ''}</td>
            <td class="col-salary">${escapeHtml(job.salary || '')}</td>
            <td class="col-experience">${escapeHtml(job.experience || '')}</td>
            <td class="col-jobtype">${escapeHtml(job.jobType || '')}</td>
            <td class="col-link">${job.link ? `<a href="${escapeHtml(job.link)}" target="_blank">Open</a>` : ''}</td>
            <td class="col-description">${descHtml}</td>
        `;

        row.addEventListener('click', (event) => {
            if (event.target.closest('a, .description-preview')) return;
            toggleRowSelection(originalIndex, row);
        });

        tbody.appendChild(row);
    });

    document.querySelectorAll('.description-preview').forEach(element => {
        element.addEventListener('click', (event) => {
            const index = parseInt(event.target.dataset.originalIndex, 10);
            showJobDetails(allJobs[index]);
        });
    });

    updateBottomScrollbar();
}

function toggleRowSelection(index, rowElement) {
    if (selectedJobIndexes.has(index)) selectedJobIndexes.delete(index);
    else selectedJobIndexes.add(index);

    rowElement.classList.toggle('selected', selectedJobIndexes.has(index));
    updateStats();
}

function setupEventListeners() {
    const searchInput = document.getElementById('searchInput');
    const clearSearchBtn = document.getElementById('clearSearch');
    clearSearchBtn.innerHTML = '&times;';

    searchInput.addEventListener('input', (event) => {
        clearSearchBtn.style.display = event.target.value ? 'flex' : 'none';
        applyFilters();
    });

    clearSearchBtn.addEventListener('click', () => {
        searchInput.value = '';
        clearSearchBtn.style.display = 'none';
        applyFilters();
    });

    document.getElementById('stateFilter').addEventListener('change', applyFilters);
    document.getElementById('statusFilter').addEventListener('change', applyFilters);

    document.querySelectorAll('.sortable').forEach(header => {
        header.addEventListener('click', () => handleSort(header.dataset.sort));
    });

    document.getElementById('select-all-btn').addEventListener('click', () => {
        filteredJobs.forEach(job => selectedJobIndexes.add(allJobs.indexOf(job)));
        displayJobs(filteredJobs);
        updateStats();
    });

    document.getElementById('deselect-all-btn').addEventListener('click', () => {
        selectedJobIndexes.clear();
        displayJobs(filteredJobs);
        updateStats();
    });

    document.getElementById('select-duplicates-btn').addEventListener('click', selectDuplicates);
    document.getElementById('getDescriptionsBtn').addEventListener('click', getJobDescriptions);
    document.getElementById('clearDescriptionsBtn').addEventListener('click', clearDescriptions);
    document.getElementById('fetchDetailsBtn').addEventListener('click', fetchDetails);
    document.getElementById('clearDetailsBtn').addEventListener('click', clearDetails);
    document.getElementById('fetchAddressesBtn').addEventListener('click', startFetchAddresses);
    document.getElementById('clearAddressesBtn').addEventListener('click', clearAddresses);
    document.getElementById('exportCSV').addEventListener('click', exportToCSV);
    document.getElementById('exportJSON').addEventListener('click', exportToJSON);
    document.getElementById('delete-selected-btn').addEventListener('click', deleteSelected);
    document.getElementById('clearData').addEventListener('click', clearData);
    document.getElementById('debug-salary-btn').addEventListener('click', debugMissingSalary);

    document.getElementById('toggle-webhook').addEventListener('click', () => {
        document.getElementById('webhook-config').classList.toggle('hidden');
        document.querySelector('.webhook-section').classList.toggle('expanded');
    });

    document.getElementById('save-webhook-btn').addEventListener('click', saveWebhookConfig);
    document.getElementById('send-webhook-btn').addEventListener('click', sendToWebhook);
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.querySelector('.modal-overlay').addEventListener('click', closeModal);
}

function applyFilters() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase().trim();
    const stateFilter = document.getElementById('stateFilter').value;
    const statusFilter = document.getElementById('statusFilter').value;
    const duplicateIds = findDuplicateIds();

    filteredJobs = allJobs.filter(job => {
        const matchesSearch =
            !searchTerm ||
            (job.jobId || '').toLowerCase().includes(searchTerm) ||
            (job.jobTitle || '').toLowerCase().includes(searchTerm) ||
            (job.areaOfPractice || '').toLowerCase().includes(searchTerm) ||
            (job.position || '').toLowerCase().includes(searchTerm) ||
            (job.streetAddress || '').toLowerCase().includes(searchTerm) ||
            (job.city || '').toLowerCase().includes(searchTerm) ||
            (job.state || '').toLowerCase().includes(searchTerm) ||
            (job.postalCode || '').toLowerCase().includes(searchTerm) ||
            (job.hospitalName || '').toLowerCase().includes(searchTerm) ||
            (job.phone || '').toLowerCase().includes(searchTerm) ||
            (job.website || '').toLowerCase().includes(searchTerm) ||
            (job.salary || '').toLowerCase().includes(searchTerm) ||
            (job.experience || '').toLowerCase().includes(searchTerm) ||
            (job.jobType || '').toLowerCase().includes(searchTerm) ||
            (job.link || '').toLowerCase().includes(searchTerm) ||
            (job.description || '').toLowerCase().includes(searchTerm);

        const matchesState = !stateFilter || job.state === stateFilter;

        let matchesStatus = true;
        if (statusFilter === 'duplicates') matchesStatus = duplicateIds.has(job.jobId);
        else if (statusFilter === 'unique') matchesStatus = !duplicateIds.has(job.jobId);
        else if (statusFilter === 'with-description') matchesStatus = Boolean(job.description);
        else if (statusFilter === 'no-description') matchesStatus = !job.description;

        return matchesSearch && matchesState && matchesStatus;
    });

    if (currentSort.field) {
        sortJobs(currentSort.field, currentSort.direction);
    }

    displayJobs(filteredJobs);
    updateStats();
}

function handleSort(field) {
    if (currentSort.field === field) {
        currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        currentSort.field = field;
        currentSort.direction = 'asc';
    }

    sortJobs(field, currentSort.direction);
    updateSortIndicators();
    displayJobs(filteredJobs);
}

function sortJobs(field, direction) {
    filteredJobs.sort((a, b) => {
        if (field === 'salary') {
            const salaryValue = (value) => {
                const match = (value || '').match(/\$([\d,]+(?:\.\d{2})?)/);
                return match ? parseFloat(match[1].replace(/,/g, '')) : 0;
            };

            const difference = salaryValue(a[field]) - salaryValue(b[field]);
            return direction === 'asc' ? difference : -difference;
        }

        if (field === 'experience') {
            const experienceValue = (value) => {
                const match = (value || '').match(/(\d+(?:\.\d+)?)/);
                return match ? parseFloat(match[1]) : 0;
            };

            const difference = experienceValue(a[field]) - experienceValue(b[field]);
            return direction === 'asc' ? difference : -difference;
        }

        const aValue = (a[field] || '').toString().toLowerCase();
        const bValue = (b[field] || '').toString().toLowerCase();

        if (aValue < bValue) return direction === 'asc' ? -1 : 1;
        if (aValue > bValue) return direction === 'asc' ? 1 : -1;
        return 0;
    });
}

function updateSortIndicators() {
    document.querySelectorAll('.sortable').forEach(header => {
        header.classList.remove('asc', 'desc');
        if (header.dataset.sort === currentSort.field) {
            header.classList.add(currentSort.direction);
        }
    });
}

function selectDuplicates() {
    const duplicateIds = findDuplicateIds();
    selectedJobIndexes.clear();
    filteredJobs.forEach(job => {
        if (duplicateIds.has(job.jobId)) selectedJobIndexes.add(allJobs.indexOf(job));
    });
    displayJobs(filteredJobs);
    updateStats();
}

async function deleteSelected() {
    if (selectedJobIndexes.size === 0) {
        alert('No jobs selected.');
        return;
    }

    if (isAnyBackgroundTaskRunning()) {
        alert('Wait for the current task to finish before deleting jobs.');
        return;
    }

    if (!confirm(`Delete ${selectedJobIndexes.size} selected job(s)? This cannot be undone.`)) return;

    const toDelete = new Set(selectedJobIndexes);
    allJobs = allJobs.filter((_, index) => !toDelete.has(index));
    selectedJobIndexes.clear();
    await chrome.storage.local.set({ scrapedJobs: allJobs });
    populateStateFilter();
    applyFilters();
}

async function getJobDescriptions() {
    if (isGettingDescriptions) {
        alert('Already getting descriptions. Please wait...');
        return;
    }

    if (isFetchingDetails || isFetchingAddresses) {
        alert('Wait for the current task to finish before starting another one.');
        return;
    }

    const data = await chrome.storage.local.get(['scrapedJobs']);
    const jobs = data.scrapedJobs || [];
    const jobsWithoutDescription = jobs.filter(job => !job.description && job.link);

    if (jobsWithoutDescription.length === 0) {
        alert('All jobs already have descriptions.');
        return;
    }

    isGettingDescriptions = true;
    showProgress('Getting Descriptions', 0, jobsWithoutDescription.length);
    processNextDescriptionJob();
}

async function clearDescriptions() {
    if (isAnyBackgroundTaskRunning()) {
        alert('Wait for the current task to finish before clearing descriptions.');
        return;
    }

    const jobsWithDescriptions = allJobs.filter(job => job.description);
    if (jobsWithDescriptions.length === 0) {
        alert('No saved descriptions found to clear.');
        return;
    }

    if (!confirm(`Clear saved descriptions from ${jobsWithDescriptions.length} job(s)?`)) return;

    allJobs = allJobs.map(job => ({
        ...job,
        description: ''
    }));

    await chrome.storage.local.set({ scrapedJobs: allJobs });
    applyFilters();
    alert(`Cleared descriptions from ${jobsWithDescriptions.length} job(s).`);
}

async function processNextDescriptionJob() {
    const data = await chrome.storage.local.get(['scrapedJobs']);
    const jobs = data.scrapedJobs || [];
    const jobsWithoutDescription = jobs.filter(job => !job.description && job.link);
    const total = jobs.filter(job => job.link).length;
    const completed = total - jobsWithoutDescription.length;
    const button = document.getElementById('getDescriptionsBtn');

    button.disabled = true;
    button.textContent = `Getting Descriptions... (${completed}/${total})`;
    updateProgress(completed, total);

    if (jobsWithoutDescription.length === 0) {
        isGettingDescriptions = false;
        button.disabled = false;
        button.textContent = 'Get Descriptions';
        hideProgress();
        alert('All descriptions have been fetched.');
        return;
    }

    const job = jobsWithoutDescription[0];
    const jobIndex = jobs.findIndex(item => item.link === job.link);

    try {
        const tab = await chrome.tabs.create({ url: job.link, active: false });
        chrome.runtime.sendMessage({
            action: 'scrapeJobDescription',
            tabId: tab.id,
            jobIndex
        });
    } catch (error) {
        console.error('Error opening description tab:', error);
        setTimeout(() => processNextDescriptionJob(), 500);
    }
}

async function fetchDetails() {
    if (isFetchingDetails) return;

    if (isGettingDescriptions || isFetchingAddresses) {
        alert('Wait for the current task to finish before starting another one.');
        return;
    }

    const jobsWithDescriptions = allJobs
        .map((job, index) => ({ job, index }))
        .filter(item => item.job.description);

    if (jobsWithDescriptions.length === 0) {
        alert('No stored descriptions found. Run "Get Descriptions" first.');
        return;
    }

    const jobsNeedingDetails = jobsWithDescriptions.filter(item => !item.job.detailsFetched);
    if (jobsNeedingDetails.length === 0) {
        if (!confirm('All jobs already have derived details. Recalculate them from descriptions?')) return;
        detailsQueue = jobsWithDescriptions;
    } else {
        detailsQueue = jobsNeedingDetails;
    }

    isFetchingDetails = true;
    currentDetailsIndex = 0;
    const button = document.getElementById('fetchDetailsBtn');
    button.disabled = true;
    button.textContent = 'Analyzing Descriptions...';
    showProgress('Deriving Details From Stored Descriptions', 0, detailsQueue.length);
    processNextDetail();
}

async function processNextDetail() {
    if (currentDetailsIndex >= detailsQueue.length) {
        finishDetailsFetching();
        return;
    }

    const { index } = detailsQueue[currentDetailsIndex];
    const job = allJobs[index];
    const button = document.getElementById('fetchDetailsBtn');
    button.textContent = `Analyzing... (${currentDetailsIndex + 1}/${detailsQueue.length})`;
    updateProgress(currentDetailsIndex + 1, detailsQueue.length);

    if (!job || !job.description) {
        currentDetailsIndex++;
        setTimeout(processNextDetail, DETAILS_ANALYSIS_DELAY_MS);
        return;
    }

    const details = deriveDetailsFromDescription(job);
    allJobs[index] = {
        ...job,
        ...details,
        detailsFetched: true
    };

    await chrome.storage.local.set({ scrapedJobs: allJobs });
    applyFilters();

    currentDetailsIndex++;
    setTimeout(processNextDetail, DETAILS_ANALYSIS_DELAY_MS);
}

function finishDetailsFetching() {
    isFetchingDetails = false;
    currentDetailsIndex = 0;
    detailsQueue = [];
    const button = document.getElementById('fetchDetailsBtn');
    button.disabled = false;
    button.textContent = 'Fetch Details';
    hideProgress();
    alert('Details fetched from stored descriptions.');
}

async function clearDetails() {
    if (isAnyBackgroundTaskRunning()) {
        alert('Wait for the current task to finish before clearing details.');
        return;
    }

    const jobsWithDetails = allJobs.filter(job => job.detailsFetched);
    if (jobsWithDetails.length === 0) {
        alert('No analyzed details found to clear.');
        return;
    }

    if (!confirm(`Clear analyzed details from ${jobsWithDetails.length} job(s)?`)) return;

    allJobs = allJobs.map(job => {
        if (!job.detailsFetched) return job;

        return {
            ...job,
            areaOfPractice: '',
            position: '',
            salary: '',
            experience: '',
            jobType: '',
            detailsFetched: false
        };
    });

    await chrome.storage.local.set({ scrapedJobs: allJobs });
    applyFilters();
    alert(`Cleared analyzed details from ${jobsWithDetails.length} job(s).`);
}

async function startFetchAddresses() {
    if (isFetchingAddresses) {
        alert('Already fetching addresses. Please wait...');
        return;
    }

    if (isGettingDescriptions || isFetchingDetails) {
        alert('Wait for the current task to finish before starting address fetch.');
        return;
    }

    const data = await chrome.storage.local.get(['scrapedJobs']);
    const jobs = data.scrapedJobs || [];

    addressQueue = jobs
        .map((job, index) => ({ job, index }))
        .filter(item => item.job.hospitalName && (!item.job.streetAddress || !item.job.postalCode));

    if (addressQueue.length === 0) {
        if (!confirm('All jobs already have addresses. Re-fetch all?')) return;
        addressQueue = jobs
            .map((job, index) => ({ job, index }))
            .filter(item => item.job.hospitalName);
    }

    if (addressQueue.length === 0) {
        alert('No jobs with hospital names found.');
        return;
    }

    isFetchingAddresses = true;
    currentAddressIndex = 0;
    const button = document.getElementById('fetchAddressesBtn');
    button.disabled = true;
    button.textContent = `Fetching Addresses... (0/${addressQueue.length})`;
    showProgress('Fetching Addresses', 0, addressQueue.length);
    processNextAddress();
}

async function processNextAddress() {
    if (currentAddressIndex >= addressQueue.length) {
        finishAddressFetching();
        return;
    }

    const { job, index } = addressQueue[currentAddressIndex];
    const button = document.getElementById('fetchAddressesBtn');
    button.textContent = `Fetching Addresses... (${currentAddressIndex + 1}/${addressQueue.length})`;
    updateProgress(currentAddressIndex + 1, addressQueue.length);

    try {
        const searchHospital = (job.hospitalName || '').trim();
        const searchCity = (job.city || '').trim();
        const searchState = (job.state || '').trim();
        const addressData = await fetchAddressFromGoogleMaps(searchHospital, searchCity, searchState);

        if (allJobs[index]) {
            if (addressData.streetAddress) allJobs[index].streetAddress = addressData.streetAddress;
            if (addressData.zipCode) allJobs[index].postalCode = addressData.zipCode;
            if (addressData.website) allJobs[index].website = addressData.website;
            if (addressData.phone) allJobs[index].phone = addressData.phone;
            await chrome.storage.local.set({ scrapedJobs: allJobs });
            applyFilters();
        }
    } catch (error) {
        console.error('Error fetching address:', error);
    }

    currentAddressIndex++;
    setTimeout(processNextAddress, 1500);
}

function finishAddressFetching() {
    isFetchingAddresses = false;
    addressQueue = [];
    currentAddressIndex = 0;
    const button = document.getElementById('fetchAddressesBtn');
    button.disabled = false;
    button.textContent = 'Fetch Addresses';
    hideProgress();
    alert('Address fetching completed.');
}

async function clearAddresses() {
    if (isAnyBackgroundTaskRunning()) {
        alert('Wait for the current task to finish before clearing addresses.');
        return;
    }

    const jobsWithAddresses = allJobs.filter(job => job.streetAddress || job.postalCode || job.phone || job.website);
    if (jobsWithAddresses.length === 0) {
        alert('No fetched address details found to clear.');
        return;
    }

    if (!confirm(`Clear fetched address details from ${jobsWithAddresses.length} job(s)?`)) return;

    allJobs = allJobs.map(job => ({
        ...job,
        streetAddress: '',
        postalCode: '',
        phone: '',
        website: ''
    }));

    await chrome.storage.local.set({ scrapedJobs: allJobs });
    applyFilters();
    alert(`Cleared address details from ${jobsWithAddresses.length} job(s).`);
}

function fetchAddressFromGoogleMaps(hospitalName, city, state) {
    const locationParts = [city, state].filter(Boolean).join(', ');
    const quotedHospitalName = hospitalName ? `"${hospitalName}"` : '';
    const searchQuery = [quotedHospitalName, locationParts].filter(Boolean).join(' ');
    const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`;

    function scrapeTab(url) {
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                resolve({ streetAddress: '', zipCode: '', city: '', state: '', website: '', phone: '' });
            }, 30000);

            chrome.tabs.create({ url, active: false }, (tab) => {
                if (!tab) {
                    clearTimeout(timeout);
                    resolve({});
                    return;
                }

                const tabId = tab.id;
                const listener = (updatedTabId, info) => {
                    if (updatedTabId !== tabId || info.status !== 'complete') return;
                    chrome.tabs.onUpdated.removeListener(listener);

                    setTimeout(() => {
                        chrome.scripting.executeScript({
                            target: { tabId },
                            files: ['google-maps-scraper.js']
                        }).then((results) => {
                            clearTimeout(timeout);
                            chrome.tabs.remove(tabId).catch(() => {});
                            const data = results?.[0]?.result || {};
                            resolve({
                                streetAddress: data.streetAddress || '',
                                zipCode: data.zipCode || '',
                                city: data.city || '',
                                state: data.state || '',
                                website: data.website || '',
                                phone: data.phone || ''
                            });
                        }).catch(() => {
                            clearTimeout(timeout);
                            chrome.tabs.remove(tabId).catch(() => {});
                            resolve({});
                        });
                    }, 2000);
                };

                chrome.tabs.onUpdated.addListener(listener);
            });
        });
    }

    return scrapeTab(mapsUrl);
}

    chrome.runtime.onMessage.addListener((message) => {
    if (message.action !== 'descriptionSaved') return;

    chrome.storage.local.get(['scrapedJobs'], (data) => {
        allJobs = sanitizeJobs(data.scrapedJobs || []);
        applyFilters();

        if (isGettingDescriptions) {
            setTimeout(() => processNextDescriptionJob(), 300);
        }
    });
});

function exportToCSV() {
    const jobsToExport = selectedJobIndexes.size > 0
        ? allJobs.filter((_, index) => selectedJobIndexes.has(index))
        : allJobs;

    const headers = [
        'Serial Number',
        'Job ID',
        'Job Title',
        'Area of Practice',
        'Position',
        'Street Address',
        'City',
        'State',
        'Zip Code',
        'Hospital Name',
        'Phone',
        'Website',
        'Salary',
        'Experience',
        'Job Type',
        'Job URL',
        'Description'
    ];

    const rows = jobsToExport.map((job, index) => [
        `"${escapeCSV(index + 1)}"`,
        `"${escapeCSV(job.jobId)}"`,
        `"${escapeCSV(job.jobTitle)}"`,
        `"${escapeCSV(job.areaOfPractice)}"`,
        `"${escapeCSV(job.position)}"`,
        `"${escapeCSV(job.streetAddress)}"`,
        `"${escapeCSV(job.city)}"`,
        `"${escapeCSV(job.state)}"`,
        `"${escapeCSV(job.postalCode)}"`,
        `"${escapeCSV(job.hospitalName)}"`,
        `"${escapeCSV(job.phone)}"`,
        `"${escapeCSV(job.website)}"`,
        `"${escapeCSV(job.salary)}"`,
        `"${escapeCSV(job.experience)}"`,
        `"${escapeCSV(job.jobType)}"`,
        `"${escapeCSV(job.link)}"`,
        `"${escapeCSV(job.description)}"`
    ].join(','));

    downloadFile([headers.join(','), ...rows].join('\n'), 'mission-pet-health-jobs.csv', 'text/csv');
}

function exportToJSON() {
    const jobsToExport = selectedJobIndexes.size > 0
        ? allJobs.filter((_, index) => selectedJobIndexes.has(index))
        : allJobs;

    downloadFile(JSON.stringify(jobsToExport, null, 2), 'mission-pet-health-jobs.json', 'application/json');
}

function escapeCSV(value) {
    return (value || '').toString().replace(/"/g, '""');
}

function clearData() {
    if (isAnyBackgroundTaskRunning()) {
        alert('Wait for the current task to finish before clearing data.');
        return;
    }

    if (!confirm('Are you sure you want to clear all scraped data? This cannot be undone.')) return;

    chrome.storage.local.remove(['scrapedJobs'], () => {
        location.reload();
    });
}

async function loadWebhookConfig() {
    const stored = await chrome.storage.local.get('mphWebhook');
    if (!stored.mphWebhook) return;

    document.getElementById('webhook-url-input').value = stored.mphWebhook.url || '';
    document.getElementById('parent-client-input').value = stored.mphWebhook.parentClient || 'Mission Pet Health';
}

async function saveWebhookConfig() {
    const url = document.getElementById('webhook-url-input').value;
    const parentClient = document.getElementById('parent-client-input').value;
    await chrome.storage.local.set({ mphWebhook: { url, parentClient } });
    alert('Webhook configuration saved.');
}

async function sendToWebhook() {
    const webhookUrl = document.getElementById('webhook-url-input').value;
    const parentClient = document.getElementById('parent-client-input').value || 'Mission Pet Health';

    if (!isValidHttpUrl(webhookUrl)) {
        alert('Please enter a valid webhook URL.');
        return;
    }

    const data = await chrome.storage.local.get(['scrapedJobs']);
    const jobs = data.scrapedJobs || [];
    if (jobs.length === 0) {
        alert('No jobs to send.');
        return;
    }

    const payload = jobs.map(job => ({
        parent_client: parentClient,
        aggregator: 'Mission Pet Health (Parent Client)',
        job_id: job.jobId || '',
        job_title: job.jobTitle || '',
        area_of_practice: job.areaOfPractice || '',
        position: job.position || '',
        street_address: job.streetAddress || '',
        city: job.city || '',
        state: job.state || '',
        postal_code: job.postalCode || '',
        hospital: job.hospitalName || '',
        phone: job.phone || '',
        website: job.website || '',
        salary: job.salary || '',
        experience: job.experience || '',
        job_type: job.jobType || '',
        url: job.link || '',
        description: job.description || ''
    }));

    const sendButton = document.getElementById('send-webhook-btn');
    sendButton.disabled = true;
    sendButton.textContent = 'Sending...';

    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                source: 'Mission Pet Health Job Scraper',
                parentClientName: parentClient,
                timestamp: new Date().toISOString(),
                data: payload
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        alert(`Sent ${payload.length} jobs to the webhook.`);
    } catch (error) {
        console.error('Webhook error:', error);
        alert(`Webhook failed: ${error.message}`);
    } finally {
        sendButton.disabled = false;
        sendButton.textContent = 'Send to Webhook';
    }
}

function isValidHttpUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
        return false;
    }
}

function showJobDetails(job) {
    document.getElementById('modal-title').textContent = job.jobTitle || 'Job Details';
    document.getElementById('modal-body').innerHTML = `
        <p><strong>Serial Number:</strong> ${escapeHtml((filteredJobs.indexOf(job) + 1) || '')}</p>
        <p><strong>Job ID:</strong> ${escapeHtml(job.jobId || 'N/A')}</p>
        <p><strong>Job Title:</strong> ${escapeHtml(job.jobTitle || 'N/A')}</p>
        <p><strong>Area of Practice:</strong> ${escapeHtml(job.areaOfPractice || 'N/A')}</p>
        <p><strong>Position:</strong> ${escapeHtml(job.position || 'N/A')}</p>
        <p><strong>Street Address:</strong> ${escapeHtml(job.streetAddress || 'N/A')}</p>
        <p><strong>City:</strong> ${escapeHtml(job.city || 'N/A')}</p>
        <p><strong>State:</strong> ${escapeHtml(job.state || 'N/A')}</p>
        <p><strong>Zip Code:</strong> ${escapeHtml(job.postalCode || 'N/A')}</p>
        <p><strong>Hospital Name:</strong> ${escapeHtml(job.hospitalName || 'N/A')}</p>
        <p><strong>Phone:</strong> ${escapeHtml(job.phone || 'N/A')}</p>
        <p><strong>Website:</strong> ${job.website ? `<a href="${escapeHtml(job.website)}" target="_blank">${escapeHtml(job.website)}</a>` : 'N/A'}</p>
        <p><strong>Salary:</strong> ${escapeHtml(job.salary || 'N/A')}</p>
        <p><strong>Experience:</strong> ${escapeHtml(job.experience || 'N/A')}</p>
        <p><strong>Job Type:</strong> ${escapeHtml(job.jobType || 'N/A')}</p>
        <p><strong>Job URL:</strong> ${job.link ? `<a href="${escapeHtml(job.link)}" target="_blank">${escapeHtml(job.link)}</a>` : 'N/A'}</p>
        <hr>
        <p><strong>Description:</strong></p>
        <pre>${escapeHtml(job.description || 'No description available.')}</pre>
    `;

    document.getElementById('modal').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('modal').classList.add('hidden');
}

async function debugMissingSalary() {
    const data = await chrome.storage.local.get(['scrapedJobs']);
    const jobs = data.scrapedJobs || [];
    const noSalary = jobs.filter(job => !job.salary && job.description);

    if (noSalary.length === 0) {
        alert('All jobs with descriptions already have a salary.');
        return;
    }

    const salaryKeywords = /(\$[\d,]+|\bsalar|\bpay\b|\bwage|\bcomp|\bhourly|\bannual|\bincome|\bearning)/gi;
    let output = `MPH - Jobs Missing Salary (${noSalary.length} jobs)\n`;
    output += '='.repeat(70) + '\n\n';

    noSalary.forEach((job, index) => {
        output += `[${index + 1}] ${job.jobTitle || '(no title)'}\n`;
        output += `    Job ID : ${job.jobId || ''}\n`;
        output += `    Link   : ${job.link || ''}\n`;

        const lines = (job.description || '').split('\n');
        const salaryLines = lines.filter(line => salaryKeywords.test(line));
        salaryKeywords.lastIndex = 0;

        if (salaryLines.length > 0) {
            output += `    --- Salary-related lines from description ---\n`;
            salaryLines.forEach(line => { output += `    > ${line.trim()}\n`; });
        } else {
            output += `    --- No salary keywords found. First 600 chars of description ---\n`;
            output += `    ${(job.description || '').substring(0, 600).replace(/\n/g, '\n    ')}\n`;
        }

        output += '\n' + '-'.repeat(70) + '\n\n';
    });

    downloadFile(output, 'mph-missing-salary-debug.txt', 'text/plain');
    alert(`Debug file created for ${noSalary.length} jobs missing salary.`);
}

function showProgress(label, current, total) {
    const section = document.getElementById('progressSection');
    document.getElementById('progressLabel').textContent = label;
    document.getElementById('progressText').textContent = `${current} / ${total}`;
    document.getElementById('progressBar').style.width = total > 0 ? `${(current / total) * 100}%` : '0%';
    section.classList.remove('hidden');
}

function updateProgress(current, total) {
    document.getElementById('progressText').textContent = `${current} / ${total}`;
    document.getElementById('progressBar').style.width = total > 0 ? `${(current / total) * 100}%` : '0%';
}

function hideProgress() {
    document.getElementById('progressSection').classList.add('hidden');
}

function setupBottomScrollbar() {
    const scrollWrapper = document.getElementById('tableScrollWrapper');
    const bottomScrollbar = document.getElementById('tableBottomScrollbar');
    const bottomScrollbarInner = document.getElementById('tableBottomScrollbarInner');
    const table = document.getElementById('jobsTable');

    if (!scrollWrapper || !bottomScrollbar || !bottomScrollbarInner || !table) return;

    const syncScrollPositions = (source, target) => {
        if (tableScrollSyncLocked) return;
        tableScrollSyncLocked = true;
        target.scrollLeft = source.scrollLeft;
        requestAnimationFrame(() => {
            tableScrollSyncLocked = false;
        });
    };

    scrollWrapper.addEventListener('scroll', () => syncScrollPositions(scrollWrapper, bottomScrollbar));
    bottomScrollbar.addEventListener('scroll', () => syncScrollPositions(bottomScrollbar, scrollWrapper));
    window.addEventListener('resize', updateBottomScrollbar);

    if (tableResizeObserver) {
        tableResizeObserver.disconnect();
    }

    tableResizeObserver = new ResizeObserver(() => updateBottomScrollbar());
    tableResizeObserver.observe(scrollWrapper);
    tableResizeObserver.observe(table);

    updateBottomScrollbar();
}

function updateBottomScrollbar() {
    const scrollWrapper = document.getElementById('tableScrollWrapper');
    const bottomScrollbar = document.getElementById('tableBottomScrollbar');
    const bottomScrollbarInner = document.getElementById('tableBottomScrollbarInner');
    const table = document.getElementById('jobsTable');
    const tableWrapper = document.querySelector('.table-wrapper');

    if (!scrollWrapper || !bottomScrollbar || !bottomScrollbarInner || !table || !tableWrapper) return;

    bottomScrollbarInner.style.width = `${table.scrollWidth}px`;
    const shouldShowScrollbar = !tableWrapper.classList.contains('hidden') && table.scrollWidth > scrollWrapper.clientWidth + 4;
    bottomScrollbar.classList.toggle('hidden', !shouldShowScrollbar);

    if (shouldShowScrollbar) {
        bottomScrollbar.scrollLeft = scrollWrapper.scrollLeft;
    }
}

function downloadFile(content, filename, contentType) {
    const blob = new Blob([content], { type: contentType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    if (text) div.textContent = text;
    return div.innerHTML;
}

function isAnyBackgroundTaskRunning() {
    return isGettingDescriptions || isFetchingDetails || isFetchingAddresses;
}
