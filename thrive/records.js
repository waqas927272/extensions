document.addEventListener('DOMContentLoaded', () => {
    const PARENT_CLIENT_NAME = 'Thrive Pet Healthcare (Parent Client)';
    const tableBody = document.querySelector('#jobRecordsTable tbody');
    const tableHeaders = document.querySelectorAll('#jobRecordsTable th');
    const clearRecordsButton = document.getElementById('clearRecords');
    const webhookUrlInput = document.getElementById('webhookUrl');
    const sendToWebhookButton = document.getElementById('sendToWebhook');
    const totalCountElement = document.getElementById('totalCount');
    const emptyState = document.getElementById('emptyState');
    const table = document.getElementById('jobRecordsTable');
    const searchInput = document.getElementById('searchInput');
    const exportCsvButton = document.getElementById('exportCsv');
    const toastContainer = document.getElementById('toastContainer');
    const descriptionModal = document.getElementById('descriptionModal');
    const modalDescriptionContent = document.getElementById('modalDescriptionContent');
    const closeDescriptionModal = document.getElementById('closeDescriptionModal');
    const selectAllJobsCheckbox = document.getElementById('selectAllJobs');
    const deleteSelectedJobsButton = document.getElementById('deleteSelectedJobs');

    let currentSortColumn = null;
    let currentSortDirection = 'asc';
    let allJobs = [];
    let currentDisplayedJobs = [];
    let selectedJobKeys = new Set();
    let isGettingDescriptions = false;
    let isFetchingDetails = false;
    let isFetchingAddresses = false;
    let currentJobIndex = 0;
    let detailsQueue = [];
    let currentDetailsIndex = 0;
    let addressQueue = [];
    let currentAddressIndex = 0;
    let addressCache = new Map();
    const getDescriptionsBtn = document.getElementById('getDescriptionsBtn');
    const fetchDetailsBtn = document.getElementById('fetchDetailsBtn');
    const fetchAddressesBtn = document.getElementById('fetchAddressesBtn');

    // ============ WEBHOOK URL DYNAMIC CONFIGURATION ============

    // Load saved webhook URL from Chrome storage or auto-detect
    async function loadWebhookUrl() {
        try {
            const result = await chrome.storage.local.get(['webhookUrl']);

            if (result.webhookUrl) {
                // Use saved URL
                webhookUrlInput.value = result.webhookUrl;
            } else {
                // Auto-detect environment and set default
                const defaultUrl = autoDetectWebhookUrl();
                webhookUrlInput.value = defaultUrl;
                // Save the auto-detected URL
                await chrome.storage.local.set({ webhookUrl: defaultUrl });
            }
        } catch (error) {
            console.error('Error loading webhook URL:', error);
            webhookUrlInput.value = autoDetectWebhookUrl();
        }
    }

    // Auto-detect webhook URL based on environment
    function autoDetectWebhookUrl() {
        // Check if running on localhost (common development patterns)
        const isLocalhost = window.location.hostname === 'localhost' ||
                           window.location.hostname === '127.0.0.1' ||
                           window.location.hostname === '';

        if (isLocalhost) {
            // Development environment - use localhost without double slash
            return 'http:/localhost/zoho-api/api/webhook-receiver.php';
        } else {
            // Production environment - try to detect the domain
            // User will need to update this for their production URL
            return 'https://yourdomain.com/zoho-api/api/webhook-receiver.php';
        }
    }

    // Save webhook URL to Chrome storage when it changes
    webhookUrlInput.addEventListener('change', async () => {
        const url = webhookUrlInput.value.trim();
        if (url) {
            await chrome.storage.local.set({ webhookUrl: url });
            showToast('Webhook URL saved!', 'success');
        }
    });

    // Initialize webhook URL on page load
    loadWebhookUrl();

    // State abbreviation to full name mapping
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

    // Convert state abbreviation to full name if needed
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

    function toAddressCase(value) {
        const text = String(value || '').replace(/\s+/g, ' ').trim();
        if (!text) return '';
        if (/^(?:TBD|Not Found \(TBD\))$/i.test(text)) return text.replace(/^tbd$/i, 'TBD').replace(/^not found \(tbd\)$/i, 'Not Found (TBD)');

        const keepUpper = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW', 'US', 'PO']);
        return text.replace(/[A-Za-z][A-Za-z']*/g, (word, offset, fullText) => {
            const upper = word.toUpperCase();
            if (keepUpper.has(upper)) return upper;
            if (word.length === 1 && /\d\s*$/i.test(fullText.slice(0, offset))) return upper;
            if (word.length === 2 && /^Mc$/i.test(word)) return 'Mc';
            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        });
    }

    function formatStreetAddress(value) {
        return toAddressCase(value)
            .replace(/\bP\.?\s*O\.?\s*Box\b/gi, 'PO Box')
            .replace(/\bUs\b/g, 'US');
    }

    function formatCityName(value) {
        return toAddressCase(value);
    }

    function formatStateName(value) {
        return toAddressCase(getFullStateName(value || ''));
    }

    function getDescriptionLines(text) {
        return String(text || '')
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean);
    }

    function getJobDescriptionBody(text) {
        const lines = getDescriptionLines(text);
        const start = lines.findIndex(line => /^job description$/i.test(line));
        const end = lines.findIndex((line, index) => index > start && /^qualifications$/i.test(line));

        if (start >= 0 && end > start) {
            return lines.slice(start + 1, end).join('\n');
        }
        if (start >= 0) {
            return lines.slice(start + 1).join('\n');
        }
        return lines.join('\n');
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

    function extractRequirementSection(text) {
        const source = String(text || '');
        const patterns = [
            /(?:experience\s*&\s*skills\s*requirements?|experience\s+and\s+skills\s+requirements?|your experience\s*&\s*skills|requirements?|qualifications?|what you'?ll need|what we'?re looking for|credentials?|must have|what we need)[:\s]*([\s\S]{0,900}?)(?=(?:benefits?|compensation|salary|about(?:\s+(?:the|our)\s+hospital|\s+thrive)?|our culture|location|equal|join us|why|facility|what we offer|ready to|provide your best care)[:\s])/i,
            /(?:experience\s*&\s*skills\s*requirements?|experience\s+and\s+skills\s+requirements?|your experience\s*&\s*skills|requirements?|qualifications?|what you'?ll need|what we'?re looking for|credentials?|must have|what we need)[:\s]*([\s\S]{0,600})/i
        ];
        for (const pattern of patterns) {
            const match = source.match(pattern);
            if (match) return match[1];
        }
        return '';
    }

    function hasSpecialtyRequirementSignal(text) {
        const requirements = extractRequirementSection(text);
        return !!(
            requirements &&
            (
                hasSpecialtyTrainingSignal(requirements) ||
                /\b(?:board certified|board[-\s]+certified|residency[-\s]+trained|residential[-\s]+trained|diplomate)\b/i.test(requirements)
            )
        );
    }

    function hasExoticRequirementSignal(text) {
        const source = String(text || '');
        if (/\b(?:would\s+not\s+be|required\s+is\s+not|not)\s+required\b/i.test(source) || /\bnot\s+a\s+requirement\b/i.test(source)) {
            return false;
        }
        const exoticNearRequirement = /\b(?:exotic|avian|reptiles?|small mammals?|pocket pets?)\b[\s\S]{0,100}\b(?:required|must|need|looking for|experience|skilled|proficient)\b/i;
        const requirementNearExotic = /\b(?:required|must|need|looking for|experience|skilled|proficient)\b[\s\S]{0,100}\b(?:exotic|avian|reptiles?|small mammals?|pocket pets?)\b/i;
        return exoticNearRequirement.test(source) || requirementNearExotic.test(source);
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

    function getPositionFromDescription(text) {
        const matched = matchApprovedPositionFromText(text || '');
        return APPROVED_POSITION_SET.has(matched) ? matched : '';
    }

    // ============ TOP-LEVEL POSITION MATCHING (used by both detail extraction and save) ============

    // Match position from the job listing title — this is the authoritative source for position.
    // The listing title (e.g. "Veterinary Cardiologist") is always more specific than
    // generic detail page content, so we use it as the primary position signal.
    function getPositionFromTitle(title) {
        const t = (title || '').toLowerCase();

        // === HIGHEST PRIORITY: Leadership positions ===
        // "Group Medical Director - The Oncology Service" → Medical Director, NOT Medical Oncologist
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
        if ((t.includes('surgeon') || t.includes('surgery')) && !t.includes('neurosurgeon') && !t.includes('neurology') && !t.includes('dental') && !t.includes('dentistry')) return 'Surgeon';

        // === VTS/CREDENTIALED SPECIALIST ===
        if (t.includes('technician specialist') || (t.match(/\bvts\b/) && t.includes('specialist'))) return 'Credentialed Veterinary Technician Specialist';

        // === GENERIC VETERINARIAN ROLES ===
        if (t.includes('partner veterinarian') || t.includes('partner vet') || t.includes('equity owner')) return 'Partner Veterinarian';
        if (/\b(?:associate\s+)?(?:emergency|er|urgent care|urgent)?\s*(?:veterinarian|vet|dvm)\b/.test(t)) return 'Associate Veterinarian';
        if (/\bassociate veterinarian\b|\bassociate vet\b/.test(t)) return 'Associate Veterinarian';

        return '';
    }

    function getAOPParts(aop) {
        return (aop || '').split('/').map(part => part.trim()).filter(Boolean);
    }

    // Validate that a position is allowed for the given AOP
    function getValidatedPosition(position, aop) {
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

    function isNonClinicalCategory(category) {
        const cat = (category || '').toLowerCase();
        return !!(
            cat &&
            !/\bveterinarian\b|\bveterinary\b|\bvet\b|\bdvm\b/i.test(cat) &&
            /\b(?:business development|support center|corporate|operations|marketing|finance|accounting|human resources|recruiting|talent|administrative|management|technology|it|sales)\b/i.test(cat)
        );
    }

    function hasClinicalTitleSignal(title) {
        const t = (title || '').toLowerCase();
        return /\b(?:veterinarian|veterinary|vet|dvm|medical director|surgeon|oncologist|cardiologist|radiologist|internist|dermatologist|neurologist|ophthalmologist|anesthesiologist|criticalist|dentist|oral surgeon)\b/i.test(t);
    }

    function shouldLeaveClinicalFieldsBlank(title, category) {
        return isNonClinicalCategory(category) && !hasClinicalTitleSignal(title);
    }

    function isExoticRoleTitle(title) {
        const t = (title || '').toLowerCase();
        return /\b(?:exotic|avian)\s+(?:veterinarian|vet|dvm)\b/i.test(t) ||
            /\b(?:veterinarian|vet|dvm)\b[^,\n()]{0,40}\b(?:exotic|avian)\b/i.test(t);
    }

    // Determine AOP from the Jobvite category string
    function getAOPFromCategory(category) {
        if (!category) return '';
        if (isNonClinicalCategory(category)) return '';
        const cat = category.toLowerCase().trim();
        if (cat.includes('urgent care')) return 'Urgent Care';
        if (cat.includes('specialist') || cat.includes('specialty') || cat.includes('diplomate') || cat.includes('surgeon')) return 'Specialty Care';
        if (cat.includes('gen practice') || /\bgp\b/.test(cat)) return 'General Practice Care';
        if (cat.includes('(er)') || /\b(?:er|emergency)\b/.test(cat)) return 'Emergency Care';
        return '';
    }

    // Determine AOP from title keywords when category is not available
    function getAOPFromTitle(title) {
        const t = title.toLowerCase();

        if (/\bpriority\s*pet\b/i.test(t)) return 'Urgent Care';

        // Specialty indicators
        const specialtyNames = ['oncologist', 'cardiologist', 'neurologist', 'neurosurgeon',
            'dermatologist', 'ophthalmologist', 'anesthesiologist', 'theriogenologist',
            'radiologist', 'internist', 'criticalist',
            'oncology', 'cardiology', 'neurology', 'dermatology', 'ophthalmology',
            'anesthesia', 'theriogenology', 'radiology'];
        for (const sp of specialtyNames) {
            if (t.includes(sp)) return 'Specialty Care';
        }

        const specialtyCerts = ['board certified', 'residency trained', 'residential trained',
            'diplomate', 'dacvecc', 'dacvim', 'dacvr', 'dacvs', 'dacvd', 'dacvo', 'dacvaa',
            'dact', 'davdc', 'dabvp', 'acvs', 'acvim'];
        for (const cert of specialtyCerts) {
            if (t.includes(cert)) return 'Specialty Care';
        }

        if (t.includes('specialist') && !t.includes('technician specialist')) return 'Specialty Care';
        if (t.match(/\bsurgeon\b/)) return 'Specialty Care';

        // Urgent Care — check before Emergency since "urgent care" is more specific
        if (t.includes('urgent care')) return 'Urgent Care';

        // Emergency
        if (t.includes('emergency') || t.match(/\ber\b/) || t.includes('er vet') || t.includes('er dvm')) return 'Emergency Care';

        // Equine/Bovine/Exotics
        if (isExoticRoleTitle(title)) return 'Exotic Pet Medicine';
        if (t.includes('equine') || t.includes('bovine') || t.includes('large animal')) return 'General Practice Care';

        return '';
    }

    // ============ LOCAL DETAIL EXTRACTION (mirrors detail-extractor.js) ============

    function extractDetailsFromDescription(positionTitle, descriptionText) {
        // Format salary to standard "$X–$Y per year" or "$X per hour"
        function formatSalary(raw) {
            if (!raw) return '';
            const isHourly = /(?:per\s+)?(?:hour|hr|\/hr)/i.test(raw);
            const amounts = [];
            const hasThousandSuffix = /\$?\s*\d+(?:\.\d+)?\s*k\b/i.test(raw);
            const amountRegex = /\$?\s*([\d,]+(?:\.\d{2})?)\s*k?\b/gi;
            let match;
            while ((match = amountRegex.exec(raw)) !== null) {
                let num = parseFloat(match[1].replace(/,/g, ''));
                const afterMatch = raw.substring(match.index + match[0].length - 1, match.index + match[0].length + 1);
                if (/k/i.test(match[0]) || /k/i.test(afterMatch) || (hasThousandSuffix && num < 1000)) {
                    num = num * 1000;
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
                return `${fmt(min)}–${fmt(max)} ${unit}`;
            }
            if (/\b(?:starting\s+at|starts?\s+at|from|minimum|min\.?|at least)\b/i.test(raw)) {
                return `${fmt(amounts[0])}+ ${unit}`;
            }
            return `${fmt(amounts[0])} ${unit}`;
        }

        // Extract salary from stored description (which now includes JSON-LD data)
        function extractSalary(text) {
            if (!text) return '';

            // Try to extract from JSON-LD data in the text
            const jsonLdMatch = text.match(/Salary Range:\s*([^\n]+)/i);
            if (jsonLdMatch) {
                return formatSalary(jsonLdMatch[1].trim());
            }

            // Fallback to text pattern matching
            const salaryPatterns = [
                // AAH SmartRecruiters descriptions: "Salary Range can vary from $120,000 to $140,000"
                /(?:salary|pay|compensation)\s+range\s+can\s+vary\s+from\s+\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s+(?:to|-|–|—)\s+\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?/i,
                // "Compensation Range-$175,000-250,000" or "Salary range- $100,000-$300,000"
                /(?:salary|pay|compensation)\s+range\s*[-:]\s*\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s*(?:-|–|—|to)\s*\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?/i,
                // "general range for a base salary is $130,000 - $190,000"
                /(?:range\s+for\s+a\s+)?base\s+salary\s+(?:is|of|from|:)\s*\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s*(?:-|–|—|to)\s*\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?/i,
                // "base salary starting at $115,000"
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
                // Thrive Jobvite: "annual PROSAL full-time range starting at $180K/year"
                /(?:PROSAL|salary|pay|compensation|base\s+salary)[^.\n]{0,160}?(?:range\s+)?(?:starting\s+at|starts?\s+at|from|of|:)\s*\$?[\d,]+(?:\.\d+)?\s*k?(?:\s*\/\s*(?:year|yr|hour|hr)|\s*(?:per\s+)?(?:year|yr|hour|hr|annually))?/i,
            ];
            for (const pattern of salaryPatterns) {
                const m = text.match(pattern);
                if (m) return formatSalary(m[0].trim());
            }
            return '';
        }

        // Extract industry/category from stored description text
        function getIndustryCategory(text) {
            const match = text.match(/Industry\/Category:\s*([^\n]+)/i);
            return match ? match[1].trim() : '';
        }

        // Extract qualifications/requirements section from description
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

        // Determine Area of Practice
        // Priority: 1) Title-specific overrides (urgent care), 2) Industry/Category from JSON-LD, 3) title keywords, 4) description qualifications
        function determineAreaOfPractice(positionText, descriptionText) {
            const title = positionText.toLowerCase();
            const category = getIndustryCategory(descriptionText).toLowerCase();
            const qualSection = extractQualificationsSection(descriptionText) || '';

            if (shouldLeaveClinicalFieldsBlank(positionText, category)) return '';
            if (/\bpriority\s*pet\b/i.test(`${positionText}\n${descriptionText}`)) return 'Urgent Care';
            if (isExoticRoleTitle(positionText)) return 'Exotic Pet Medicine';
            if (/\b(?:board certified|board[-\s]+certified|residency[-\s]+trained|residential[-\s]+trained|diplomate)\b/i.test(qualSection)) return 'Specialty Care';

            // STEP 0: Title-specific overrides — these are MORE specific than Jobvite categories.
            // e.g. "Urgent Care Veterinarian" is categorized as "Veterinarian (ER)" on Jobvite,
            // but "urgent care" in the title is a more precise signal than the broad ER bucket.
            if (title.includes('urgent care')) return 'Urgent Care';

            // STEP 1: Use industry/category - most reliable signal for broad categories
            if (category) {
                if (category.includes('urgent care')) return 'Urgent Care';
                if (category.includes('specialist') || category.includes('specialty') || category.includes('diplomate') || category.includes('surgeon')) return 'Specialty Care';
                if (category.includes('gen practice') || /\bgp\b/.test(category)) return 'General Practice Care';
                if (category === 'veterinarian (er)' || category.includes('(er)') || /\b(?:er|emergency)\b/.test(category)) return 'Emergency Care';
                if (category.includes('medical director')) {
                    const combined = `${positionText}\n${qualSection}`;
                    if (/\bspecialty medical director\b|\bspecialty hospital\b|\bspecialty services?\b/i.test(combined)) return 'Specialty Care';
                    if (/\bemergency veterinary medical director\b|\bemergency (?:&|and)? referral\b/i.test(combined)) return 'Emergency Care';
                    if (hasExoticRequirementSignal(qualSection)) return 'Exotic Pet Medicine';
                    return 'General Practice Care';
                }
            }

            // STEP 2: Check TITLE for clear specialty position names (COMPREHENSIVE LIST)
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

            // Check title for board cert / diplomate / DACV* indicators
            const specialtyCerts = ['board certified', 'residency trained', 'residential trained',
                'diplomate', 'dacvecc', 'dacvim', 'dacvr', 'dacvs', 'dacvd', 'dacvo', 'dacvaa',
                'dact', 'davdc', 'dabvp', 'acvs', 'acvim'];
            for (const cert of specialtyCerts) {
                if (title.includes(cert)) return 'Specialty Care';
            }

            // Check for specialist or surgeon keywords
            if (title.includes('specialist') && !title.includes('technician specialist')) return 'Specialty Care';
            if (title.match(/\bsurgeon\b/) && !title.includes('neurosurgeon')) return 'Specialty Care';

            // STEP 3: Check TITLE for Emergency Care
            if (title.includes('emergency') || title.match(/\ber\b/) || title.includes('er vet') ||
                title.includes('er dvm') || title.includes('er veterinarian') || title.includes('ecc')) {
                return 'Emergency Care';
            }

            // STEP 4: Check TITLE for exotics/avian or large animal focus.
            if (isExoticRoleTitle(positionText)) return 'Exotic Pet Medicine';
            if (title.includes('equine') || title.includes('bovine') || title.includes('large animal')) return 'General Practice Care';

            // STEP 5: For generic titles, check ONLY the qualifications/role section.
            // ER listings often mention specialty teams, which should not override an ER category/title.
            if (qualSection && hasSpecialtyTrainingSignal(qualSection)) return 'Specialty Care';
            if (qualSection) {
                const qualLower = qualSection.toLowerCase();
                for (const cert of specialtyCerts) {
                    if (qualLower.includes(cert)) return 'Specialty Care';
                }
            }

            // STEP 6: Check page text for ER category
            if (descriptionText.match(/Veterinarian \(ER\)/i)) return 'Emergency Care';

            return hasClinicalTitleSignal(positionText) ? 'General Practice Care' : '';
        }

        // Match position from title keywords
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
            // For surgeon, be specific - check it's not part of neurosurgeon (already handled)
            if ((t.includes('surgeon') || t.includes('surgery')) && !t.includes('neurosurgeon') && !t.includes('neurology') && !t.includes('dental') && !t.includes('dentistry')) return 'Surgeon';

            // === VTS/CREDENTIALED SPECIALIST (check before generic technician) ===
            if (t.includes('technician specialist') || (t.match(/\bvts\b/) && t.includes('specialist'))) return 'Credentialed Veterinary Technician Specialist';

            // === GENERIC VETERINARIAN ROLES ===
            if (t.includes('partner veterinarian') || t.includes('partner vet') || t.includes('equity owner')) return 'Partner Veterinarian';
            if (/\b(?:associate\s+)?(?:emergency|er|urgent care|urgent)?\s*(?:veterinarian|vet|dvm)\b/.test(t)) return 'Associate Veterinarian';
            if (/\bassociate veterinarian\b|\bassociate vet\b/.test(t)) return 'Associate Veterinarian';

            return '';
        }

        // Match position from qualifications section
        function matchPositionFromQualifications(descriptionText) {
            return getPositionFromDescription(extractRoleSignalText(descriptionText));
        }

        // Validate position is allowed for given AOP per CorrectJobNames.txt
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

        // Determine Position
        function determinePosition(positionText, descriptionText, areaOfPractice) {
            if (!areaOfPractice) return '';
            let position = matchPositionFromTitle(positionText);
            if (!position) {
                position = matchPositionFromQualifications(descriptionText);
            }
            return APPROVED_POSITION_SET.has(position) ? position : '';
        }

        // Extract locations from stored description (which now includes JSON-LD data)
        function extractLocations(text) {
            const locations = [];

            // First try to extract from structured JSON-LD data in the text
            // Format from description-scraper: "  - City, ST, Country" or "  - City, State"
            const locationsSection = text.match(/Locations:\n((?:\s*-\s*[^\n]+\n?)+)/i);
            if (locationsSection) {
                const locationLines = locationsSection[1].split('\n');
                for (const line of locationLines) {
                    const trimmed = line.trim();
                    if (!trimmed.startsWith('-')) continue;
                    // Remove leading "- " and split by comma
                    const parts = trimmed.replace(/^-\s*/, '').split(',').map(s => s.trim()).filter(s => s);
                    if (parts.length >= 2) {
                        const city = parts[0];
                        let state = parts[1];
                        // Try to find a 2-letter state abbreviation elsewhere in the text for this city
                        if (state.length > 2) {
                            const stateAbbrev = text.match(new RegExp(`${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')},\\s*([A-Z]{2})\\b`));
                            if (stateAbbrev) {
                                state = stateAbbrev[1];
                            }
                        }
                        locations.push({ city, state, location: `${city}, ${state}` });
                    }
                }
            }

            // If no locations found, fall back to pattern matching
            if (locations.length === 0) {
                // Clean up the text
                text = text.replace(/^Description\s*/i, '');
                text = text.replace(/^Position at\s*/i, '');
                const searchText = text.substring(0, 500);

                // Match patterns like "City, ST"
                const matches = searchText.matchAll(/\b([A-Za-z][\w\s.'()-]*[A-Za-z])\s*,\s*([A-Z]{2})\b/g);
                for (const match of matches) {
                    let city = match[1].trim();
                    const state = match[2].trim();

                    const invalidWords = ['description', 'position', 'associate', 'veterinarian', 'hospital', 'care', 'center', 'clinic', 'location'];
                    if (!invalidWords.some(word => city.toLowerCase().includes(word)) && city.length > 1 && city.length < 50) {
                        locations.push({ city, state, location: `${city}, ${state}` });
                    }
                }
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

        // Extract hospital name from stored description (which now includes JSON-LD data)
        function extractHospitalName(text) {
            function toHospitalNameCase(value) {
                return String(value || '').replace(/[A-Za-z][A-Za-z']*/g, (word) => {
                    if (word.length <= 1) return word.toUpperCase();
                    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
                });
            }

            function cleanHospitalName(name) {
                return toHospitalNameCase(String(name || '')
                    .replace(/\s+logo$/i, '')
                    .replace(/[.,;:]+$/g, '')
                    .replace(/\s+/g, ' ')
                    .trim());
            }

            function isGenericHospitalName(name) {
                return !name || /^(?:Alliance Animal Health|Alliance Animal Health \(Parent Client\))$/i.test(cleanHospitalName(name));
            }

            function firstSpecificHospital(pattern) {
                const match = text.match(pattern);
                if (!match) return '';
                const name = cleanHospitalName(match[1]);
                if (!/^[A-Z0-9]/.test(name)) return '';
                return isGenericHospitalName(name) ? '' : name;
            }

            const explicitHospital = firstSpecificHospital(/Hospital Name:\s*([^\n]+)/i);
            if (explicitHospital) return explicitHospital;

            const plainPositionAt = firstSpecificHospital(/Position at\s+([^\n]+)/i);
            if (plainPositionAt) return plainPositionAt;

            const namedPractice = firstSpecificHospital(/^([A-Z][^,\n]{2,90}),\s+(?:a|an|our)\s+(?:well-established|full-service|small animal|AAHA|community|progressive|modern|brand-new|established)?[^.\n]*(?:practice|hospital|clinic|center)\b/im);
            if (namedPractice) return namedPractice;

            const atNamedPractice = firstSpecificHospital(/\bAt\s+([A-Z][A-Za-z0-9'.& -]{2,90}?(?:Animal\s+(?:Clinic|Hospital|Medical\s+Center|Care|Associates)|Animal\s+Medical\s+Center|Veterinary\s+(?:Clinic|Hospital|Center|Care|Specialists?)|Pet\s+(?:Hospital|Clinic|Care)|Emergency\s+(?:Hospital|Center|Clinic)|Creatures?\s+Comfort|PriorityPet(?:\s+Urgent\s+Care)?))\s*,/);
            if (atNamedPractice) return atNamedPractice;

            // Try to find "Position at [Hospital Name]"
            const positionAtMatch = text.match(/Position at\s+((?:[\w'.&-]+\s+){1,8}(?:Animal\s+Hospital|Veterinary\s+(?:Hospital|Center|Clinic|Care|Specialists?)|Pet\s+(?:Hospital|Clinic|Care)|Emergency\s+(?:Hospital|Center|Clinic)|The\s+[A-Z][\w\s]+Service))/i);
            if (positionAtMatch) {
                const name = cleanHospitalName(positionAtMatch[1]);
                if (!isGenericHospitalName(name)) return name;
            }

            // Try to find hospital name from description
            const hospitalMatch = text.match(/at\s+((?:[\w'.&-]+\s+){1,5}(?:Animal\s+Hospital|Veterinary\s+(?:Hospital|Center|Clinic|Care|Specialists?)|Pet\s+(?:Hospital|Clinic|Care)|Emergency\s+(?:Hospital|Center|Clinic)|The\s+[A-Z][\w\s]+Service))\b/i);
            if (hospitalMatch) {
                const name = cleanHospitalName(hospitalMatch[1]);
                if (!isGenericHospitalName(name)) return name;
            }

            const seekingMatch = firstSpecificHospital(/^([A-Z][^.\n]{2,90}?(?:Animal\s+Hospital|Veterinary\s+(?:Hospital|Center|Clinic|Care|Specialists?)|Pet\s+(?:Hospital|Clinic|Care)|Emergency\s+(?:Hospital|Center|Clinic)|Urgent\s+Care|The\s+[A-Z][\w\s]+Service))\s+(?:is|has been|in\s+[A-Z][^,\n]+\s+is)\b/im);
            if (seekingMatch) return seekingMatch;

            const broadNamedPractice = firstSpecificHospital(/^([A-Z][A-Za-z0-9'.& -]{2,90}?(?:Animal\s+(?:Clinic|Hospital|Medical\s+Center|Care|Associates)|Animal\s+Medical\s+Center|Veterinary\s+(?:Clinic|Hospital|Center|Care|Specialists?)|Pet\s+(?:Hospital|Clinic|Care)|Emergency\s+(?:Hospital|Center|Clinic)|Urgent\s+Care|Clinic|Hospital))\s+(?:is|has been|in\s+[A-Z][^,\n]+\s+is|,\s+(?:just|a|an|our))\b/im);
            if (broadNamedPractice) return broadNamedPractice;

            const priorityPetMatch = firstSpecificHospital(/\bAt\s+(PriorityPet(?:\s+Urgent\s+Care)?)\b/i);
            if (priorityPetMatch) return priorityPetMatch;

            const companyMatch = text.match(/^Company:\s*([^\n]+)/im);
            if (companyMatch) {
                const name = cleanHospitalName(companyMatch[1]);
                if (!isGenericHospitalName(name)) return name;
            }

            const hiringOrgMatch = text.match(/Hiring Organization:\s*([^\n]+)/i);
            if (hiringOrgMatch) {
                const name = cleanHospitalName(hiringOrgMatch[1]);
                if (!isGenericHospitalName(name)) return name;
            }

            return '';
        }

        // Extract job type from description
        // Rules: "part time or full time" / "full time or part time" → Full-Time
        //        only "part time" / "part-time" mentioned → Part-Time
        //        nothing mentioned or only "full time" → Full-Time (default)
        function extractJobType(text) {
            if (!text) return 'Full-Time';
            const lower = text.toLowerCase();

            // Trust the repeated SmartRecruiters employment line when present near the top/bottom.
            const employmentLine = getDescriptionLines(text).find(line => /^(?:full|part)[-\s]?time$/i.test(line));
            if (employmentLine) {
                return /^part/i.test(employmentLine) ? 'Part-Time' : 'Full-Time';
            }

            // First check the structured Employment Type field from JSON-LD
            const empTypeMatch = lower.match(/employment type:\s*([^\n]+)/i);
            if (empTypeMatch) {
                const empType = empTypeMatch[1].trim().toLowerCase();
                // "Part Time or Full Time" → Full-Time (both mentioned = full time)
                if (empType.includes('part') && empType.includes('full')) return 'Full-Time';
                // "Part-Time" or "Part Time" only → Part-Time
                if (empType.includes('part')) return 'Part-Time';
                // "Full-Time" or anything else → Full-Time
                return 'Full-Time';
            }

            // Fallback: check the description body text
            const hasPartTime = /\bpart[\s-]?time\b/i.test(lower);
            const hasFullTime = /\bfull[\s-]?time\b/i.test(lower);

            // Both mentioned → Full-Time
            if (hasPartTime && hasFullTime) return 'Full-Time';
            // Only part time mentioned → Part-Time
            if (hasPartTime) return 'Part-Time';
            // Only full time or nothing mentioned → Full-Time
            return 'Full-Time';
        }

        function extractExperience(text) {
            if (!text) return '';

            const yearToken = '(?:years?|yrs?\\.?)';
            const candidateLines = [];
            const qualificationsSection = extractQualificationsSection(text);

            if (qualificationsSection) {
                candidateLines.push(...qualificationsSection.split('\n'));
            }
            candidateLines.push(...text.split('\n'));

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

        // Run all extractions
        const salary = extractSalary(descriptionText);
        const areaOfPractice = determineAreaOfPractice(positionTitle, descriptionText);
        const position = determinePosition(positionTitle, descriptionText, areaOfPractice);
        const locations = extractLocations(descriptionText);
        const completeAddress = extractCompleteAddress(descriptionText);
        const hospitalName = extractHospitalName(descriptionText);
        const jobType = extractJobType(descriptionText);
        const experience = extractExperience(descriptionText);

        return {
            salary,
            areaOfPractice,
            position,
            locations,
            streetAddress: formatStreetAddress(completeAddress.streetAddress),
            addressCity: formatCityName(completeAddress.city),
            addressState: formatStateName(completeAddress.state),
            addressLocation: completeAddress.location,
            zipCode: completeAddress.zipCode,
            hospitalName,
            jobType,
            experience
        };
    }

    function getJobviteSpecificsForJob(job) {
        const stored = job.jobviteSpecifics || job.jobviteDetails?.specifics || {};
        const description = job.description || '';

        function clean(value) {
            return String(value || '').replace(/\s+/g, ' ').trim();
        }

        function lineValue(label) {
            const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const match = description.match(new RegExp(`^${escaped}:\\s*([^\\n]+)`, 'im'));
            return clean(match?.[1] || '');
        }

        return {
            company: clean(stored.company || stored.Company || lineValue('Company')),
            category: clean(stored.category || stored.Category || lineValue('Category') || lineValue('Industry/Category')),
            city: formatCityName(clean(stored.city || stored.City || lineValue('City'))),
            state: formatStateName(clean(stored.state || stored.State || lineValue('State'))),
            lastUpdated: clean(stored.lastUpdated || stored.LastUpdated || stored['Last Updated'] || lineValue('Last Updated')),
            requisitionId: clean(stored.requisitionId || stored.RequisitionId || stored['Requisition Id'] || lineValue('Requisition Id'))
        };
    }

    function formatJobviteJobId(requisitionId) {
        const raw = String(requisitionId || '').trim();
        if (!raw) return '';
        return /^THR-/i.test(raw) ? raw : `THR-${raw}`;
    }

    function formatSpecificsLocation(city, state) {
        const parts = [city, state].filter(Boolean);
        return parts.join(', ');
    }

    function cleanStreetAddressValue(value) {
        const source = String(value || '')
            .replace(/^Address\s*[:\n]\s*/i, '')
            .replace(/\b(?:Website|Phone|Call|Directions|Hours|Open|Closed|Reviews?)\b[\s\S]*$/i, '')
            .replace(/\s+/g, ' ')
            .trim();
        if (!source) return '';

        const streetSuffix = '(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Rd|Road|Ln|Lane|Way|Ct|Court|Pl|Place|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Trl|Trail|Loop|Ter|Terrace|Fwy|Freeway)';
        const streetSegmentPattern = new RegExp(`^\\d{1,6}[A-Za-z]?\\s+(?:(?:N|S|E|W|NE|NW|SE|SW)\\s+)?(?:[A-Za-z0-9.'#&/-]+\\s+){0,9}${streetSuffix}\\b(?:\\s*(?:#|Ste\\.?|Suite|Unit|Bldg\\.?|Building|Apt\\.?|Floor|Fl\\.?|[A-Z])\\s*[A-Za-z0-9-]*)?$`, 'i');
        const routeSegmentPattern = /^\d{1,6}\s+(?:[A-Z]{2}|US|U\.S\.|State|Route|Rte)\s*-?\s*\d+[A-Za-z]?\b(?:\s*(?:#|Ste\.?|Suite|Unit|Bldg\.?|Building|Apt\.?)\s*[A-Za-z0-9-]*)?$/i;
        const cleanSegments = source
            .split(/\s+-\s+|[,;•|]+/)
            .map(part => part.replace(/^[^\d]+/, '').replace(/[,\s.-]+$/, '').replace(/\s+/g, ' ').trim())
            .filter(part => streetSegmentPattern.test(part) || routeSegmentPattern.test(part));
        if (cleanSegments.length > 0) return cleanSegments[cleanSegments.length - 1];

        const streetPattern = new RegExp(`\\b\\d{1,6}[A-Za-z]?\\s+(?:(?:N|S|E|W|NE|NW|SE|SW)\\s+)?(?:[A-Za-z0-9.'#&/-]+\\s+){0,9}${streetSuffix}\\b(?:\\s*(?:#|Ste\\.?|Suite|Unit|Bldg\\.?|Building|Apt\\.?|Floor|Fl\\.?|[A-Z])\\s*[A-Za-z0-9-]*)?`, 'gi');
        const routePattern = /\b\d{1,6}\s+(?:[A-Z]{2}|US|U\.S\.|State|Route|Rte)\s*-?\s*\d+[A-Za-z]?\b(?:\s*(?:#|Ste\.?|Suite|Unit|Bldg\.?|Building|Apt\.?)\s*[A-Za-z0-9-]*)?/gi;
        const matches = [
            ...(source.match(streetPattern) || []),
            ...(source.match(routePattern) || [])
        ].map(item => item
            .replace(/^[^\d]+/, '')
            .replace(/[,\s.-]+$/, '')
            .replace(/\s+/g, ' ')
            .trim()
        ).filter(Boolean);

        if (matches.length > 0) return matches[matches.length - 1];

        if (/^\d{1,6}\b/.test(source) && !/\b(?:satisfied customers|reviews?|mile south|mile north|mile east|mile west)\b/i.test(source)) {
            return source.replace(/[,\s.-]+$/, '').trim();
        }

        return '';
    }

    // Google Maps scraping function to get street address and zip code
    // Opens a Google Maps search tab, injects scraper that:
    //   1. Waits for search results to load
    //   2. Matches the hospital name from aria-labels on search result links
    //   3. Clicks the matching result
    //   4. Waits for place detail panel and extracts address
    // Retries with simplified search query if first attempt fails.
    async function fetchAddressFromGoogleMaps(hospitalName, location, originalHospitalName = '') {
        // Branch names in brackets are more accurate when searched exactly.
        const hasBracketedSearchName = hasBracketedHospitalText(hospitalName);
        const searchQuery = hasBracketedSearchName ? hospitalName : [hospitalName, location].filter(Boolean).join(', ');
        const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`;

        function emptyAddressResult() {
            return { businessName: '', streetAddress: '', zipCode: '', city: '', state: '', fullAddress: '', website: '', phone: '', evidenceText: '' };
        }

        const expectedLocation = parseExpectedLocation(location);

        function normalizeForCompare(value) {
            return (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        }

        function cityFuzzyMatches(expectedCity, resultCity) {
            const expected = normalizeForCompare(expectedCity);
            const result = normalizeForCompare(resultCity);
            if (!expected || !result) return true;
            if (expected === result) return true;
            if (expected.length >= 5 && result.startsWith(expected)) return true;
            if (result.length >= 5 && expected.startsWith(result)) return true;

            const expectedWords = (expectedCity || '').toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 2);
            const resultWords = new Set((resultCity || '').toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 2));
            if (expectedWords.length === 0 || resultWords.size === 0) return false;

            const matched = expectedWords.filter(word => resultWords.has(word)).length;
            return matched / expectedWords.length >= 0.75;
        }

        function getCityMatchQuality(result) {
            const resultCity = result?.city || '';
            const expectedCity = expectedLocation.city || '';
            const expected = normalizeForCompare(expectedCity);
            const actual = normalizeForCompare(resultCity);
            if (!expected || !actual) return '';
            if (expected === actual) return 'exact';
            if (cityFuzzyMatches(expectedCity, resultCity)) return 'fuzzy';
            return 'mismatch';
        }

        function normalizeStateForCompare(value) {
            const state = (value || '').trim();
            if (!state) return '';
            if (/^[A-Z]{2}$/i.test(state)) return state.toUpperCase();

            const normalizedState = normalizeForCompare(state);
            const match = Object.entries(stateAbbreviations).find(([, fullName]) => {
                return normalizeForCompare(fullName) === normalizedState;
            });
            return match ? match[0] : state.toUpperCase();
        }

        function cleanStreetAddressValue(value) {
            const source = String(value || '')
                .replace(/^Address\s*[:\n]\s*/i, '')
                .replace(/\b(?:Website|Phone|Call|Directions|Hours|Open|Closed|Reviews?)\b[\s\S]*$/i, '')
                .replace(/\s+/g, ' ')
                .trim();
            if (!source) return '';

            const streetSuffix = '(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Rd|Road|Ln|Lane|Way|Ct|Court|Pl|Place|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Trl|Trail|Loop|Ter|Terrace|Fwy|Freeway)';
            const streetSegmentPattern = new RegExp(`^\\d{1,6}[A-Za-z]?\\s+(?:(?:N|S|E|W|NE|NW|SE|SW)\\s+)?(?:[A-Za-z0-9.'#&/-]+\\s+){0,9}${streetSuffix}\\b(?:\\s*(?:#|Ste\\.?|Suite|Unit|Bldg\\.?|Building|Apt\\.?|Floor|Fl\\.?|[A-Z])\\s*[A-Za-z0-9-]*)?$`, 'i');
            const routeSegmentPattern = /^\d{1,6}\s+(?:[A-Z]{2}|US|U\.S\.|State|Route|Rte)\s*-?\s*\d+[A-Za-z]?\b(?:\s*(?:#|Ste\.?|Suite|Unit|Bldg\.?|Building|Apt\.?)\s*[A-Za-z0-9-]*)?$/i;
            const cleanSegments = source
                .split(/\s+-\s+|[,;•|]+/)
                .map(part => part.replace(/^[^\d]+/, '').replace(/[,\s.-]+$/, '').replace(/\s+/g, ' ').trim())
                .filter(part => streetSegmentPattern.test(part) || routeSegmentPattern.test(part));
            if (cleanSegments.length > 0) return cleanSegments[cleanSegments.length - 1];

            const streetPattern = new RegExp(`\\b\\d{1,6}[A-Za-z]?\\s+(?:(?:N|S|E|W|NE|NW|SE|SW)\\s+)?(?:[A-Za-z0-9.'#&/-]+\\s+){0,9}${streetSuffix}\\b(?:\\s*(?:#|Ste\\.?|Suite|Unit|Bldg\\.?|Building|Apt\\.?|Floor|Fl\\.?|[A-Z])\\s*[A-Za-z0-9-]*)?`, 'gi');
            const routePattern = /\b\d{1,6}\s+(?:[A-Z]{2}|US|U\.S\.|State|Route|Rte)\s*-?\s*\d+[A-Za-z]?\b(?:\s*(?:#|Ste\.?|Suite|Unit|Bldg\.?|Building|Apt\.?)\s*[A-Za-z0-9-]*)?/gi;
            const matches = [
                ...(source.match(streetPattern) || []),
                ...(source.match(routePattern) || [])
            ].map(item => item
                .replace(/^[^\d]+/, '')
                .replace(/[,\s.-]+$/, '')
                .replace(/\s+/g, ' ')
                .trim()
            ).filter(Boolean);

            if (matches.length > 0) return matches[matches.length - 1];

            if (/^\d{1,6}\b/.test(source) && !/\b(?:satisfied customers|reviews?|mile south|mile north|mile east|mile west)\b/i.test(source)) {
                return source.replace(/[,\s.-]+$/, '').trim();
            }

            return '';
        }

        function parseExpectedLocation(locationText) {
            const parts = (locationText || '').split(',').map(part => part.trim()).filter(Boolean);
            return {
                city: parts[0] || '',
                state: parts.length >= 2 ? normalizeStateForCompare(parts[1]) : ''
            };
        }

        function resultMatchesExpectedLocation(result) {
            const resultCity = normalizeForCompare(result.city || '');
            const resultState = normalizeStateForCompare(result.state || '');
            const expectedCity = normalizeForCompare(expectedLocation.city);
            const expectedState = expectedLocation.state;

            if (expectedCity && resultCity !== expectedCity && getCityMatchQuality(result) !== 'fuzzy') return false;
            if (expectedState && resultState !== expectedState) return false;
            return true;
        }

        function getBranchTokensFromHospitalName(value) {
            const source = String(value || '').replace(/\s+/g, ' ').trim();
            const branchTexts = [];
            const parenthetical = source.match(/\(([^)]+)\)\s*$/);
            if (parenthetical) branchTexts.push(parenthetical[1]);

            const hyphenated = source.match(/\s[-–—]\s*([A-Za-z0-9][A-Za-z0-9\s.'&-]+)$/);
            if (hyphenated) branchTexts.push(hyphenated[1]);

            const expandedBranch = source.match(/\b(?:at|east|west|north|south)\s+([A-Z][A-Za-z0-9\s.'&-]{3,60})$/);
            if (!branchTexts.length && expandedBranch) branchTexts.push(expandedBranch[0]);

            const stopWords = new Set(['the', 'and', 'at', 'of', 'for', 'with', 'hospital', 'hospitals', 'clinic', 'center', 'centre', 'veterinary', 'animal', 'pet']);
            return branchTexts
                .join(' ')
                .toLowerCase()
                .split(/[^a-z0-9]+/)
                .filter(token => token.length > 2 && !stopWords.has(token));
        }

        const expectedBranchTokens = [
            ...getBranchTokensFromHospitalName(originalHospitalName),
            ...getBranchTokensFromHospitalName(hospitalName)
        ].filter((token, index, list) => list.indexOf(token) === index);

        function resultMatchesExpectedBranch(result) {
            if (!expectedBranchTokens.length) return true;
            const evidence = [
                result.businessName,
                result.fullAddress,
                result.website,
                result.evidenceText
            ].filter(Boolean).join(' ').toLowerCase();
            if (!evidence) return false;
            return expectedBranchTokens.every(token => evidence.includes(token));
        }

        function filterDataForExpectedLocation(data, sourceLabel) {
            const result = data || emptyAddressResult();
            if (result.streetAddress) {
                result.streetAddress = cleanStreetAddressValue(result.streetAddress);
            }
            if (result.businessName && !businessNameFuzzyMatches(hospitalName, result.businessName) && !businessNameFuzzyMatches(originalHospitalName, result.businessName)) {
                console.warn(`Ignoring result because business name "${result.businessName}" does not fuzzy-match "${hospitalName}" from "${sourceLabel}"`);
                return emptyAddressResult();
            }

            if (expectedBranchTokens.length && !resultMatchesExpectedBranch(result)) {
                console.warn(`Ignoring branch mismatch for "${hospitalName}" from "${sourceLabel}". Expected branch tokens: ${expectedBranchTokens.join(', ')}`);
                return emptyAddressResult();
            }

            const hasLocationSignal = !!(result.streetAddress || result.zipCode || result.fullAddress || result.city || result.state);
            if (!hasLocationSignal && (result.website || result.phone)) {
                console.warn(`Ignoring contact-only result for "${hospitalName}" from "${sourceLabel}" because no matching address was found.`);
                return emptyAddressResult();
            }

            if (hasLocationSignal && !resultMatchesExpectedLocation(result)) {
                console.warn(`Ignoring city/state mismatch for "${location}" from "${sourceLabel}": ${result.fullAddress || [result.city, result.state, result.zipCode].filter(Boolean).join(', ')}`);
                return emptyAddressResult();
            }

            return {
                ...result,
                cityMatchQuality: getCityMatchQuality(result)
            };
        }

        function mergeMapsData(primary, secondary, sourceLabel = '') {
            const safeSecondary = filterDataForExpectedLocation(secondary, sourceLabel);
            const primaryQuality = primary.cityMatchQuality || getCityMatchQuality(primary);
            const secondaryQuality = safeSecondary.cityMatchQuality || getCityMatchQuality(safeSecondary);
            const preferSecondary = primaryQuality === 'fuzzy' && secondaryQuality === 'exact';
            const first = preferSecondary ? safeSecondary : primary;
            const second = preferSecondary ? primary : safeSecondary;

            return {
                streetAddress: first.streetAddress || second.streetAddress || '',
                businessName: first.businessName || second.businessName || '',
                zipCode: first.zipCode || second.zipCode || '',
                city: first.city || second.city || '',
                state: first.state || second.state || '',
                fullAddress: first.fullAddress || second.fullAddress || '',
                website: first.website || second.website || '',
                phone: first.phone || second.phone || '',
                evidenceText: first.evidenceText || second.evidenceText || '',
                cityMatchQuality: first.cityMatchQuality || second.cityMatchQuality || ''
            };
        }

        function needsMapsRetry(data) {
            return !data.streetAddress || !data.zipCode || data.cityMatchQuality === 'fuzzy';
        }

        function uniqueQueries(names, includeLocation = true) {
            const seen = new Set();
            const queries = [];
            for (const name of names) {
                const normalizedName = (name || '').replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim();
                if (!normalizedName) continue;
                const query = [normalizedName, includeLocation ? location : ''].filter(Boolean).join(', ').replace(/\s+/g, ' ').trim();
                const key = query.toLowerCase();
                if (seen.has(key)) continue;
                seen.add(key);
                queries.push(query);
            }
            return queries;
        }

        function buildHospitalNameVariants() {
            const rawNames = [hospitalName, originalHospitalName].filter(Boolean);
            const city = (location || '').split(',')[0]?.trim() || '';
            const names = [];

            for (const rawName of rawNames) {
                const base = rawName.replace(/\s+/g, ' ').trim();
                if (!base) continue;

                const withoutLocationSuffix = base.replace(/\s*[-–—]\s*[A-Z][a-zA-Z\s.'-]+$/, '').trim();
                const withoutParens = base.replace(/\s*\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
                const expandedParens = base.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
                const plain = base.replace(/&/g, 'and').replace(/[-–—()]/g, ' ').replace(/\s+/g, ' ').trim();

                names.push(base, expandedParens, withoutLocationSuffix, withoutParens, plain);

                if (city) {
                    for (const candidate of [withoutLocationSuffix, withoutParens, plain]) {
                        if (candidate && !candidate.toLowerCase().includes(city.toLowerCase())) {
                            names.push(`${candidate} ${city}`);
                        }
                    }
                }
            }

            return names;
        }

        // Inner function: open a tab, wait for load, inject scraper, get results
        function scrapeGoogleMapsTab(url, queryLabel) {
            return new Promise((resolve) => {
                // Safety timeout — 30 seconds max
                const timeout = setTimeout(() => {
                    console.warn(`✗ Google Maps timeout for: "${queryLabel}"`);
                    resolve({ streetAddress: '', zipCode: '', city: '', state: '', website: '', phone: '' });
                }, 30000);

                chrome.tabs.create({ url: url, active: false }, (tab) => {
                    if (!tab) {
                        clearTimeout(timeout);
                        resolve({ streetAddress: '', zipCode: '', city: '', state: '', website: '', phone: '' });
                        return;
                    }

                    const tabId = tab.id;

                    const listener = (updatedTabId, info) => {
                        if (updatedTabId === tabId && info.status === 'complete') {
                            chrome.tabs.onUpdated.removeListener(listener);

                            // Wait 2s for Google Maps SPA to start rendering,
                            // then inject the scraper which handles its own polling + clicking
                            setTimeout(() => {
                                chrome.scripting.executeScript({
                                    target: { tabId: tabId },
                                    files: ['google-maps-scraper.js']
                                }).then((results) => {
                                    clearTimeout(timeout);
                                    chrome.tabs.remove(tabId).catch(() => {});

                                    const data = results?.[0]?.result || {};
                                    resolve({
                                        businessName: data.businessName || '',
                                        streetAddress: data.streetAddress || '',
                                        zipCode: data.zipCode || '',
                                        city: data.city || '',
                                        state: data.state || '',
                                        fullAddress: data.fullAddress || '',
                                        website: data.website || '',
                                        phone: data.phone || '',
                                        evidenceText: data.evidenceText || ''
                                    });
                                }).catch((err) => {
                                    console.error(`Google Maps script error for "${queryLabel}":`, err);
                                    clearTimeout(timeout);
                                    chrome.tabs.remove(tabId).catch(() => {});
                                    resolve({ streetAddress: '', zipCode: '', city: '', state: '', website: '', phone: '' });
                                });
                            }, 2000);
                        }
                    };

                    chrome.tabs.onUpdated.addListener(listener);
                });
            });
        }

        function scrapeGoogleMapsTabSafe(url, queryLabel) {
            return new Promise((resolve) => {
                let settled = false;
                let mapsTabId = null;
                let listener = null;

                const finish = (result) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeout);
                    if (listener) chrome.tabs.onUpdated.removeListener(listener);
                    if (mapsTabId) chrome.tabs.remove(mapsTabId).catch(() => {});
                    resolve(result || emptyAddressResult());
                };

                const timeout = setTimeout(() => {
                    console.warn(`Google Maps timeout for: "${queryLabel}"`);
                    finish(emptyAddressResult());
                }, 22000);

                chrome.tabs.create({ url: url, active: false }, (tab) => {
                    if (!tab) {
                        finish(emptyAddressResult());
                        return;
                    }

                    mapsTabId = tab.id;
                    listener = (updatedTabId, info) => {
                        if (updatedTabId === mapsTabId && info.status === 'complete') {
                            chrome.tabs.onUpdated.removeListener(listener);
                            listener = null;

                            setTimeout(() => {
                                if (settled) return;
                                chrome.scripting.executeScript({
                                    target: { tabId: mapsTabId },
                                    files: ['google-maps-scraper.js']
                                }).then((results) => {
                                    const data = results?.[0]?.result || {};
                                    finish({
                                        businessName: data.businessName || '',
                                        streetAddress: data.streetAddress || '',
                                        zipCode: data.zipCode || '',
                                        city: data.city || '',
                                        state: data.state || '',
                                        fullAddress: data.fullAddress || '',
                                        website: data.website || '',
                                        phone: data.phone || '',
                                        evidenceText: data.evidenceText || ''
                                    });
                                }).catch((err) => {
                                    console.error(`Google Maps script error for "${queryLabel}":`, err);
                                    finish(emptyAddressResult());
                                });
                            }, 1400);
                        }
                    };

                    chrome.tabs.onUpdated.addListener(listener);
                });
            });
        }

        function scrapeGoogleSearchTab(queryLabel) {
            return new Promise((resolve) => {
                let settled = false;
                let searchTabId = null;

                const finish = (result) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeout);
                    if (searchTabId) chrome.tabs.remove(searchTabId).catch(() => {});
                    resolve(result || emptyAddressResult());
                };

                const timeout = setTimeout(() => {
                    console.warn(`Google Search timeout for: "${queryLabel}"`);
                    finish(emptyAddressResult());
                }, 45000);

                const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(queryLabel)}`;
                chrome.tabs.create({ url: searchUrl, active: false }, (tab) => {
                    if (!tab) {
                        finish(emptyAddressResult());
                        return;
                    }

                    const tabId = tab.id;
                    searchTabId = tabId;
                    const listener = (updatedTabId, info) => {
                        if (updatedTabId === tabId && info.status === 'complete') {
                            chrome.tabs.onUpdated.removeListener(listener);

                            setTimeout(() => {
                                chrome.scripting.executeScript({
                                    target: { tabId: tabId },
                                    files: ['google-search-scraper.js']
                                }).then((results) => {
                                    const data = results?.[0]?.result || {};
                                    finish({
                                        businessName: data.businessName || '',
                                        streetAddress: data.streetAddress || '',
                                        zipCode: data.zipCode || '',
                                        city: data.city || '',
                                        state: data.state || '',
                                        fullAddress: data.fullAddress || '',
                                        website: data.website || '',
                                        phone: data.phone || '',
                                        evidenceText: data.evidenceText || ''
                                    });
                                }).catch((err) => {
                                    console.error(`Google Search script error for "${queryLabel}":`, err);
                                    finish(emptyAddressResult());
                                });
                            }, 2500);
                        }
                    };

                    chrome.tabs.onUpdated.addListener(listener);
                });
            });
        }

        function scrapeGoogleSearchTabSafe(queryLabel) {
            return new Promise((resolve) => {
                let settled = false;
                let searchTabId = null;
                let listener = null;

                const finish = (result) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeout);
                    if (listener) chrome.tabs.onUpdated.removeListener(listener);
                    if (searchTabId) chrome.tabs.remove(searchTabId).catch(() => {});
                    resolve(result || emptyAddressResult());
                };

                const timeout = setTimeout(() => {
                    console.warn(`Google Search timeout for: "${queryLabel}"`);
                    finish(emptyAddressResult());
                }, 26000);

                const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(queryLabel)}`;
                chrome.tabs.create({ url: searchUrl, active: false }, (tab) => {
                    if (!tab) {
                        finish(emptyAddressResult());
                        return;
                    }

                    searchTabId = tab.id;
                    listener = (updatedTabId, info) => {
                        if (updatedTabId === searchTabId && info.status === 'complete') {
                            chrome.tabs.onUpdated.removeListener(listener);
                            listener = null;

                            setTimeout(() => {
                                if (settled) return;
                                chrome.scripting.executeScript({
                                    target: { tabId: searchTabId },
                                    files: ['google-search-scraper.js']
                                }).then((results) => {
                                    const data = results?.[0]?.result || {};
                                    finish({
                                        businessName: data.businessName || '',
                                        streetAddress: data.streetAddress || '',
                                        zipCode: data.zipCode || '',
                                        city: data.city || '',
                                        state: data.state || '',
                                        fullAddress: data.fullAddress || '',
                                        website: data.website || '',
                                        phone: data.phone || '',
                                        evidenceText: data.evidenceText || ''
                                    });
                                }).catch((err) => {
                                    console.error(`Google Search script error for "${queryLabel}":`, err);
                                    finish(emptyAddressResult());
                                });
                            }, 1200);
                        }
                    };

                    chrome.tabs.onUpdated.addListener(listener);
                });
            });
        }

        // Attempt 1: search with exact hospital name + city, state
        console.log(`🔍 Google Maps search: "${searchQuery}"`);
        let data = emptyAddressResult();
        if (hasBracketedSearchName) {
            console.log(`Google Search branch lookup: "${searchQuery}"`);
            data = mergeMapsData(data, await scrapeGoogleSearchTabSafe(searchQuery), searchQuery);
        }
        if (!hasBracketedSearchName && needsMapsRetry(data)) {
            data = mergeMapsData(data, await scrapeGoogleMapsTabSafe(mapsUrl, searchQuery), searchQuery);
        }

        // Attempt 2: if failed, try with & → and, remove dashes/parens
        if (!hasBracketedSearchName && needsMapsRetry(data)) {
            const simplifiedName = hospitalName
                .replace(/&/g, 'and')
                .replace(/[-–—()]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            const altQuery = hasBracketedSearchName ? simplifiedName : `${simplifiedName}, ${location}`;
            if (altQuery !== searchQuery) {
                console.log(`↻ Retry with: "${altQuery}"`);
                const altUrl = `https://www.google.com/maps/search/${encodeURIComponent(altQuery)}`;
                const altData = await scrapeGoogleMapsTabSafe(altUrl, altQuery);
                data = mergeMapsData(data, altData, altQuery);
            }
        }

        // Additional Maps attempts for names with location suffixes or parenthetical acronyms.
        if (!hasBracketedSearchName && needsMapsRetry(data)) {
            for (const query of uniqueQueries(buildHospitalNameVariants(), !hasBracketedSearchName).slice(0, 6)) {
                if (!needsMapsRetry(data)) break;
                if (query === searchQuery) continue;
                console.log(`Maps variant search: "${query}"`);
                const variantUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
                const variantData = await scrapeGoogleMapsTabSafe(variantUrl, query);
                data = mergeMapsData(data, variantData, query);
            }
        }

        // Last resort: use regular Google Search and read the right-side knowledge panel.
        if (needsMapsRetry(data)) {
            for (const query of uniqueQueries(buildHospitalNameVariants(), !hasBracketedSearchName).slice(0, 4)) {
                if (!needsMapsRetry(data)) break;
                console.log(`Google Search fallback: "${query}"`);
                const searchData = await scrapeGoogleSearchTabSafe(query);
                data = mergeMapsData(data, searchData, query);
            }
        }

        if (data.streetAddress || data.zipCode) {
            console.log(`✓ SUCCESS: "${searchQuery}"`);
            console.log(`  → Street="${data.streetAddress}", City="${data.city}", State="${data.state}", Zip="${data.zipCode}"`);
            if (data.website) console.log(`  → Website="${data.website}"`);
            if (data.phone) console.log(`  → Phone="${data.phone}"`);
        } else {
            console.warn(`✗ No address found for: "${searchQuery}"`);
        }

        return {
            businessName: data.businessName || '',
            streetAddress: data.streetAddress || '',
            zipCode: data.zipCode || '',
            city: data.city || '',
            state: data.state || '',
            fullAddress: data.fullAddress || '',
            website: data.website || '',
            phone: data.phone || '',
            evidenceText: data.evidenceText || '',
            cityMatchQuality: data.cityMatchQuality || ''
        };
    }

    if (!tableBody) {
        console.error('Could not find table body!');
        return;
    }

    // Toast notification function
    function showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        let icon = '';
        if (type === 'success') {
            icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z"/></svg>';
        } else if (type === 'error') {
            icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/></svg>';
        }

        toast.innerHTML = `${icon}<span>${message}</span>`;
        toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 4000);
    }

    function updateJobCount(count) {
        totalCountElement.textContent = count;
    }

    function getJobSelectionKey(job) {
        return [
            job.jobId || '',
            job.link || '',
            job.title || '',
            job.hospital || '',
            job.location || ''
        ].join('|');
    }

    function updateSelectionControls() {
        const selectedCount = selectedJobKeys.size;
        if (deleteSelectedJobsButton) {
            deleteSelectedJobsButton.disabled = selectedCount === 0;
            deleteSelectedJobsButton.innerHTML = `
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                <path d="M9,3V4H4V6H5V19A2,2 0 0,0 7,21H17A2,2 0 0,0 19,19V6H20V4H15V3H9M7,6H17V19H7V6M9,8V17H11V8H9M13,8V17H15V8H13Z"/>
              </svg>
              Delete Jobs (${selectedCount})
            `;
        }

        if (selectAllJobsCheckbox) {
            const visibleKeys = currentDisplayedJobs.map(getJobSelectionKey);
            const selectedVisibleCount = visibleKeys.filter(key => selectedJobKeys.has(key)).length;
            selectAllJobsCheckbox.checked = visibleKeys.length > 0 && selectedVisibleCount === visibleKeys.length;
            selectAllJobsCheckbox.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleKeys.length;
        }
    }

    function showDescriptionModal(description) {
        if (!descriptionModal || !modalDescriptionContent) return;
        modalDescriptionContent.textContent = description || '';
        descriptionModal.classList.add('show');
    }

    function hideDescriptionModal() {
        if (!descriptionModal || !modalDescriptionContent) return;
        descriptionModal.classList.remove('show');
        modalDescriptionContent.textContent = '';
    }

    if (closeDescriptionModal) {
        closeDescriptionModal.addEventListener('click', hideDescriptionModal);
    }

    if (descriptionModal) {
        descriptionModal.addEventListener('click', (event) => {
            if (event.target === descriptionModal) hideDescriptionModal();
        });
    }

    function displayRecords(jobs) {
        currentDisplayedJobs = jobs || [];
        tableBody.innerHTML = '';
        updateJobCount(jobs.length);

        if (jobs.length === 0) {
            table.style.display = 'none';
            emptyState.classList.remove('hidden');
            updateSelectionControls();
            return;
        }

        table.style.display = 'table';
        emptyState.classList.add('hidden');

        jobs.forEach((job, index) => {
            const row = tableBody.insertRow();
            const selectionKey = getJobSelectionKey(job);

            // Mark new jobs with green background
            if (job.isNewLocation) {
                row.style.backgroundColor = '#eaf3fb';
            }

            if (job.hospitalNameUpdated) {
                row.classList.add('row-name-updated');
            }

            if (job.cityMismatchFlag) {
                row.classList.add('row-city-mismatch');
            }

            if (selectedJobKeys.has(selectionKey)) {
                row.classList.add('selected-row');
            }

            const selectCell = row.insertCell(0);
            selectCell.className = 'select-cell';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'job-select-checkbox';
            checkbox.checked = selectedJobKeys.has(selectionKey);
            checkbox.setAttribute('aria-label', `Select job ${index + 1}`);
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    selectedJobKeys.add(selectionKey);
                    row.classList.add('selected-row');
                } else {
                    selectedJobKeys.delete(selectionKey);
                    row.classList.remove('selected-row');
                }
                updateSelectionControls();
            });
            selectCell.appendChild(checkbox);

            // Serial Number
            const serialCell = row.insertCell(1);
            serialCell.textContent = index + 1;
            serialCell.style.fontWeight = '600';
            serialCell.style.color = '#475569';
            serialCell.style.textAlign = 'center';

            row.insertCell(2).textContent = job.title;
            const jobIdCell = row.insertCell(3);
            jobIdCell.textContent = job.jobId || 'N/A';
            jobIdCell.style.fontFamily = "'Consolas', 'Monaco', monospace";
            jobIdCell.style.fontSize = '12px';
            jobIdCell.style.color = '#64748b';
            row.insertCell(4).textContent = cleanSavedHospitalName(job.hospital || '');
            row.insertCell(5).textContent = PARENT_CLIENT_NAME;
            row.insertCell(6).textContent = job.streetAddress ? formatStreetAddress(job.streetAddress) : '-';
            row.insertCell(7).textContent = formatCityName(job.city);
            row.insertCell(8).textContent = formatStateName(job.state);
            row.insertCell(9).textContent = job.zipCode || '-';

            // Phone column
            row.insertCell(10).textContent = job.phone || '-';

            // Website column — show as clickable link if available
            const websiteCell = row.insertCell(11);
            if (job.website) {
                const websiteLink = document.createElement('a');
                websiteLink.href = job.website;
                websiteLink.textContent = 'Visit';
                websiteLink.target = '_blank';
                websiteLink.style.color = '#003c71';
                websiteCell.appendChild(websiteLink);
            } else {
                websiteCell.textContent = '-';
            }

            row.insertCell(12).textContent = job.location;

            // Detail Columns
            row.insertCell(13).textContent = job.areaOfPractice || '-';
            row.insertCell(14).textContent = job.position || '-';
            row.insertCell(15).textContent = job.salary || '-';
            row.insertCell(16).textContent = job.jobType || '-';
            row.insertCell(17).textContent = job.experience || '-';

            const linkCell = row.insertCell(18);
            const link = document.createElement('a');
            link.href = job.link;
            link.textContent = 'View Job';
            link.target = '_blank';
            linkCell.appendChild(link);

            const descCell = row.insertCell(19);
            if (job.description) {
                const descButton = document.createElement('button');
                descButton.type = 'button';
                descButton.className = 'view-description-btn';
                descButton.textContent = 'View Description';
                descButton.addEventListener('click', () => showDescriptionModal(job.description));
                descCell.appendChild(descButton);
            } else {
                descCell.innerHTML = '<span style="color: #94a3b8; font-style: italic; font-size: 12px;">Not scraped</span>';
            }
        });
        updateSelectionControls();
    }

    function filterJobs(searchTerm) {
        if (!searchTerm) {
            displayRecords(allJobs);
            return;
        }

        const term = searchTerm.toLowerCase();
        const filtered = allJobs.filter(job =>
            (job.title || '').toLowerCase().includes(term) ||
            (job.hospital || '').toLowerCase().includes(term) ||
            (job.city || '').toLowerCase().includes(term) ||
            (job.state || '').toLowerCase().includes(term) ||
            (job.location || '').toLowerCase().includes(term) ||
            (job.streetAddress || '').toLowerCase().includes(term) ||
            (job.zipCode || '').toLowerCase().includes(term) ||
            (job.phone || '').toLowerCase().includes(term) ||
            (job.website || '').toLowerCase().includes(term) ||
            (job.areaOfPractice || '').toLowerCase().includes(term) ||
            (job.position || '').toLowerCase().includes(term) ||
            (job.jobType || '').toLowerCase().includes(term) ||
            (job.experience || '').toLowerCase().includes(term)
        );

        displayRecords(filtered);
    }

    function refreshRecordsView() {
        const searchTerm = searchInput ? searchInput.value.trim() : '';
        if (searchTerm) {
            filterJobs(searchTerm);
            return;
        }

        if (currentSortColumn) {
            displayRecords(sortRecords(currentSortColumn, currentSortDirection, allJobs));
            return;
        }

        displayRecords(allJobs);
    }

    function deleteSelectedJobs() {
        const selectedCount = selectedJobKeys.size;
        if (selectedCount === 0) {
            showToast('Select at least one job to delete.', 'error');
            return;
        }

        const nextJobs = allJobs.filter(job => !selectedJobKeys.has(getJobSelectionKey(job)));
        const deletedCount = allJobs.length - nextJobs.length;

        chrome.storage.local.set({ scrapedJobs: nextJobs }, () => {
            allJobs = nextJobs;
            selectedJobKeys.clear();
            refreshRecordsView();
            showToast(`Deleted ${deletedCount} selected job${deletedCount === 1 ? '' : 's'}.`, 'success');
        });
    }

    function sortRecords(column, direction, records) {
        return [...records].sort((a, b) => {
            const valA = (a[column] || '').toLowerCase();
            const valB = (b[column] || '').toLowerCase();

            if (valA < valB) {
                return direction === 'asc' ? -1 : 1;
            }
            if (valA > valB) {
                return direction === 'asc' ? 1 : -1;
            }
            return 0;
        });
    }

    function exportToCSV() {
        if (!allJobs || allJobs.length === 0) {
            showToast('No jobs to export!', 'error');
            return;
        }

        const headers = ['#', 'Job Title', 'Job ID', 'Hospital', 'Aggregator', 'Street Address', 'City', 'State', 'Zip Code', 'Phone', 'Website', 'Location', 'Area of Practice', 'Position', 'Salary', 'Job Type', 'Experience', 'Link', 'Description'];
        const csvContent = [
            headers.join(','),
            ...allJobs.map((job, index) => [
                index + 1,
                `"${(job.title || '').replace(/"/g, '""')}"`,
                `"${(job.jobId || '').replace(/"/g, '""')}"`,
                `"${cleanSavedHospitalName(job.hospital || '').replace(/"/g, '""')}"`,
                `"${PARENT_CLIENT_NAME}"`,
                `"${formatStreetAddress(job.streetAddress || '').replace(/"/g, '""')}"`,
                `"${formatCityName(job.city || '').replace(/"/g, '""')}"`,
                `"${formatStateName(job.state || '').replace(/"/g, '""')}"`,
                `"${(job.zipCode || '').replace(/"/g, '""')}"`,
                `"${(job.phone || '').replace(/"/g, '""')}"`,
                `"${(job.website || '').replace(/"/g, '""')}"`,
                `"${(job.location || '').replace(/"/g, '""')}"`,
                `"${(job.areaOfPractice || '').replace(/"/g, '""')}"`,
                `"${(job.position || '').replace(/"/g, '""')}"`,
                `"${(job.salary || '').replace(/"/g, '""')}"`,
                `"${(job.jobType || '').replace(/"/g, '""')}"`,
                `"${(job.experience || '').replace(/"/g, '""')}"`,
                `"${(job.link || '').replace(/"/g, '""')}"`,
                `"${(job.description || '').replace(/"/g, '""')}"`
            ].join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);

        link.setAttribute('href', url);
        link.setAttribute('download', `thrive_jobs_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        showToast(`Exported ${allJobs.length} jobs to CSV!`, 'success');
    }

    // Initialize
    chrome.storage.local.get(['scrapedJobs'], (result) => {
        allJobs = result.scrapedJobs || [];
        displayRecords(allJobs);

        tableHeaders.forEach(header => {
            header.addEventListener('click', () => {
                const column = header.dataset.sort;
                if (!column) return;

                if (currentSortColumn === column) {
                    currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
                } else {
                    currentSortColumn = column;
                    currentSortDirection = 'asc';
                }

                tableHeaders.forEach(th => {
                    th.classList.remove('sort-asc', 'sort-desc');
                });

                header.classList.add(`sort-${currentSortDirection}`);

                const sortedJobs = sortRecords(currentSortColumn, currentSortDirection, allJobs);
                displayRecords(sortedJobs);
            });
        });
    });

    // Search functionality
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            filterJobs(e.target.value);
        });
    }

    if (selectAllJobsCheckbox) {
        selectAllJobsCheckbox.addEventListener('change', () => {
            const visibleKeys = currentDisplayedJobs.map(getJobSelectionKey);
            if (selectAllJobsCheckbox.checked) {
                visibleKeys.forEach(key => selectedJobKeys.add(key));
            } else {
                visibleKeys.forEach(key => selectedJobKeys.delete(key));
            }
            displayRecords(currentDisplayedJobs);
        });
    }

    if (deleteSelectedJobsButton) {
        deleteSelectedJobsButton.addEventListener('click', deleteSelectedJobs);
    }

    // Export CSV
    if (exportCsvButton) {
        exportCsvButton.addEventListener('click', exportToCSV);
    }

    // Clear only fields populated by Fetch Details.
    const clearDetailsBtn = document.getElementById('clearDetailsBtn');
    clearDetailsBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all fetched details? This will remove Job ID, Hospital, City, State, Location, Area of Practice, Position, Salary, Job Type, Experience, and detail metadata from all jobs. Descriptions and address/contact fields are not cleared.')) {
            chrome.storage.local.get(['scrapedJobs'], (data) => {
                const jobs = (data.scrapedJobs || []).filter(job => !job.isNewLocation && !job.sourceLink);
                let clearedCount = 0;
                const detailFields = [
                    'jobId',
                    'requisitionId',
                    'category',
                    'lastUpdated',
                    'hospital',
                    'hospitalName',
                    'company',
                    'city',
                    'state',
                    'location',
                    'areaOfPractice',
                    'position',
                    'salary',
                    'jobType',
                    'experience'
                ];

                jobs.forEach(job => {
                    const hadDetails = job.detailsFetched || detailFields.some(field => !!job[field]);

                    detailFields.forEach(field => {
                        job[field] = '';
                    });
                    job.detailsFetched = false;
                    job.isNewLocation = false;
                    delete job.sourceLink;

                    if (hadDetails) {
                        clearedCount++;
                    }
                });

                chrome.storage.local.set({ scrapedJobs: jobs }, () => {
                    allJobs = jobs;
                    displayRecords(allJobs);
                    showToast(`Cleared details from ${clearedCount} jobs!`, 'success');
                });
            });
        }
    });

    // Clear descriptions only
    const clearDescriptionsBtn = document.getElementById('clearDescriptions');
    clearDescriptionsBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all job descriptions? This will remove only the description field from all jobs.')) {
            chrome.storage.local.get(['scrapedJobs'], (data) => {
                const jobs = data.scrapedJobs || [];
                let clearedCount = 0;

                jobs.forEach(job => {
                    if (job.description) {
                        job.description = '';
                        clearedCount++;
                    }
                });

                chrome.storage.local.set({ scrapedJobs: jobs }, () => {
                    allJobs = jobs;
                    displayRecords(allJobs);
                    showToast(`Cleared descriptions from ${clearedCount} jobs!`, 'success');
                });
            });
        }
    });

    // Clear addresses only (city, state, street address, zip code)
    const clearAddressesBtn = document.getElementById('clearAddresses');
    clearAddressesBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all address data? This will remove City, State, Street Address, and Zip Code from all jobs (Location column will be kept).')) {
            chrome.storage.local.get(['scrapedJobs'], (data) => {
                const jobs = data.scrapedJobs || [];
                let clearedCount = 0;

                jobs.forEach(job => {
                    if (job.city || job.state || job.streetAddress || job.zipCode || job.website || job.phone) {
                        job.city = '';
                        job.state = '';
                        job.streetAddress = '';
                        job.zipCode = '';
                        job.website = '';
                        job.phone = '';
                        clearedCount++;
                    }
                });

                chrome.storage.local.set({ scrapedJobs: jobs }, () => {
                    allJobs = jobs;
                    displayRecords(allJobs);
                    showToast(`Cleared address data from ${clearedCount} jobs!`, 'success');
                });
            });
        }
    });

    // Clear all records
    clearRecordsButton.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all scraped job records?')) {
            chrome.storage.local.set({ scrapedJobs: [] }, () => {
                allJobs = [];
                selectedJobKeys.clear();
                displayRecords([]);
                showToast('All records cleared!', 'success');
            });
        }
    });

    // Send to webhook (batch sending)
    sendToWebhookButton.addEventListener('click', async () => {
        const webhookUrl = webhookUrlInput.value.trim();

        if (!webhookUrl) {
            showToast('Please enter a Webhook URL.', 'error');
            return;
        }

        try {
            new URL(webhookUrl);
        } catch (e) {
            showToast('Please enter a valid URL for the Webhook.', 'error');
            return;
        }

        // Save webhook URL to Chrome storage for future use
        await chrome.storage.local.set({ webhookUrl: webhookUrl });

        const result = await chrome.storage.local.get(['scrapedJobs']);
        const jobs = result.scrapedJobs || [];

        if (jobs.length === 0) {
            showToast('No job records to send.', 'error');
            return;
        }

        const jobsToSend = jobs.map(job => ({
            job_title: job.title,
            job_id: job.jobId || '',
            department_id: job.jobId || '',
            hospital: job.hospital,
            aggregator: PARENT_CLIENT_NAME,
            street_address: formatStreetAddress(job.streetAddress || ''),
            parent_client: PARENT_CLIENT_NAME,
            city: formatCityName(job.city),
            state: formatStateName(job.state),
            zip_code: job.zipCode || '',
            phone: job.phone || '',
            website: job.website || '',
            location: job.location,
            area_of_practice: job.areaOfPractice || '',
            position: job.position || '',
            salary: job.salary || '',
            job_type: job.jobType || '',
            experience: job.experience || '',
            url: job.link,
            link: job.link,
            description: job.description || ''
        }));

        const BATCH_SIZE = 50;
        const totalBatches = Math.ceil(jobsToSend.length / BATCH_SIZE);

        if (!confirm(`This will send ${jobsToSend.length} jobs in ${totalBatches} batch(es) of up to ${BATCH_SIZE}. Continue?`)) {
            return;
        }

        sendToWebhookButton.disabled = true;
        sendToWebhookButton.textContent = 'Sending...';

        // Show progress bar
        const progressSection = document.getElementById('progressSection');
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        const progressLabel = document.getElementById('progressLabel');
        progressSection.classList.remove('hidden');
        progressLabel.textContent = 'Sending Batches';
        progressText.textContent = `0 / ${totalBatches}`;
        progressBar.style.width = '0%';

        const syncId = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < totalBatches; i++) {
            const batch = jobsToSend.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
            const batchNumber = i + 1;

            const payload = {
                source: 'Thrive Job Scraper',
                parentClientName: PARENT_CLIENT_NAME,
                syncId: syncId,
                timestamp: new Date().toISOString(),
                batchNumber: batchNumber,
                totalBatches: totalBatches,
                batchSize: batch.length,
                totalRecords: jobsToSend.length,
                data: batch
            };

            try {
                const response = await fetch(webhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    console.error(`Batch ${batchNumber} failed with status ${response.status}:`, errorText);
                    throw new Error(`Status ${response.status}: ${errorText.substring(0, 100)}`);
                }

                const result = await response.json();
                console.log(`Batch ${batchNumber} success:`, result);
                successCount++;
            } catch (error) {
                console.error(`Batch ${batchNumber} error:`, error);
                failCount++;
            }

            // Update progress
            progressText.textContent = `${batchNumber} / ${totalBatches}`;
            progressBar.style.width = `${(batchNumber / totalBatches) * 100}%`;

            // Delay between batches
            if (i < totalBatches - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        // Hide progress bar
        progressSection.classList.add('hidden');
        sendToWebhookButton.disabled = false;
        sendToWebhookButton.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
              <path d="M4.93,3.93C3.12,5.74 2,8.24 2,11C2,13.76 3.12,16.26 4.93,18.07L6.34,16.66C4.89,15.22 4,13.22 4,11C4,8.79 4.89,6.78 6.34,5.34L4.93,3.93M19.07,3.93L17.66,5.34C19.11,6.78 20,8.79 20,11C20,13.22 19.11,15.22 17.66,16.66L19.07,18.07C20.88,16.26 22,13.76 22,11C22,8.24 20.88,5.74 19.07,3.93M7.76,6.76C6.67,7.85 6,9.35 6,11C6,12.65 6.67,14.15 7.76,15.24L9.17,13.83C8.45,13.11 8,12.11 8,11C8,9.89 8.45,8.89 9.17,8.17L7.76,6.76M16.24,6.76L14.83,8.17C15.55,8.89 16,9.89 16,11C16,12.11 15.55,13.11 14.83,13.83L16.24,15.24C17.33,14.15 18,12.65 18,11C18,9.35 17.33,7.85 16.24,6.76M12,9A2,2 0 0,0 10,11A2,2 0 0,0 12,13A2,2 0 0,0 14,11A2,2 0 0,0 12,9M11,15V19H10A1,1 0 0,0 9,20H2V22H9A1,1 0 0,0 10,23H14A1,1 0 0,0 15,22H22V20H15A1,1 0 0,0 14,19H13V15H11Z"/>
            </svg>
            Send to Webhook
        `;

        if (failCount === 0) {
            showToast(`All ${totalBatches} batch(es) sent successfully!`, 'success');
        } else {
            showToast(`${successCount} succeeded, ${failCount} failed.`, 'error');
        }
    });

    // ============ GET DESCRIPTIONS ============

    getDescriptionsBtn.addEventListener('click', async () => {
        if (isGettingDescriptions) {
            showToast('Already getting descriptions. Please wait...', 'error');
            return;
        }

        const data = await chrome.storage.local.get(['scrapedJobs']);
        const jobs = data.scrapedJobs || [];

        const jobsWithoutDesc = jobs.filter(job => !job.description && job.link);
        if (jobsWithoutDesc.length === 0) {
            showToast('All jobs already have descriptions!', 'success');
            return;
        }

        isGettingDescriptions = true;
        currentJobIndex = 0;

        getDescriptionsBtn.disabled = true;
        getDescriptionsBtn.textContent = 'Getting Descriptions...';

        // Show progress
        const progressSection = document.getElementById('progressSection');
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        const progressLabel = document.getElementById('progressLabel');
        progressSection.classList.remove('hidden');
        progressLabel.textContent = 'Getting Descriptions';
        progressText.textContent = `0 / ${jobsWithoutDesc.length}`;
        progressBar.style.width = '0%';

        processNextJob();
    });

    async function processNextJob() {
        const data = await chrome.storage.local.get(['scrapedJobs']);
        const jobs = data.scrapedJobs || [];

        const jobsWithoutDesc = jobs.filter(job => !job.description && job.link);
        const totalOriginal = jobs.filter(job => job.link).length;
        const totalWithoutDesc = jobsWithoutDesc.length;
        const processed = totalOriginal - totalWithoutDesc;

        // Update progress
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        const totalToProcess = allJobs.filter(job => !job.description && job.link).length;
        progressText.textContent = `${processed} / ${totalToProcess + processed}`;
        progressBar.style.width = `${(processed / (totalToProcess + processed)) * 100}%`;

        if (jobsWithoutDesc.length === 0) {
            isGettingDescriptions = false;
            getDescriptionsBtn.disabled = false;
            getDescriptionsBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20M13,13H11V18H13V13M13,9.5H11V11.5H13V9.5Z"/>
                </svg>
                Get Descriptions
            `;
            document.getElementById('progressSection').classList.add('hidden');
            showToast('All descriptions have been fetched!', 'success');
            return;
        }

        const job = jobsWithoutDesc[0];
        const jobIndex = jobs.findIndex(j => j.link === job.link);

        try {
            // Add nl=1 param so Jobvite serves the standalone page instead of redirecting to the parent site iframe
            const jobUrl = new URL(job.link);
            jobUrl.searchParams.set('nl', '1');
            const tab = await chrome.tabs.create({ url: jobUrl.toString(), active: false });
            chrome.runtime.sendMessage({
                action: 'scrapeJobDescription',
                tabId: tab.id,
                jobIndex: jobIndex,
                jobLink: job.link
            });
        } catch (error) {
            console.error('Error opening tab for job:', error);
            setTimeout(() => processNextJob(), 1500);
        }
    }

    // Listen for description saved messages from background.js
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'descriptionSaved') {
            chrome.storage.local.get(['scrapedJobs'], (data) => {
                const jobs = data.scrapedJobs || [];
                allJobs = jobs;
                displayRecords(allJobs);

                if (isGettingDescriptions) {
                    setTimeout(() => processNextJob(), 1500);
                }
            });
        }
    });

    // ============ FETCH DETAILS ============

    fetchDetailsBtn.addEventListener('click', async () => {
        if (isFetchingDetails) {
            showToast('Already fetching details. Please wait...', 'error');
            return;
        }

        const data = await chrome.storage.local.get(['scrapedJobs']);
        const jobs = data.scrapedJobs || [];

        if (jobs.length === 0) {
            showToast('No jobs found. Please scrape jobs first.', 'error');
            return;
        }

        const jobsWithDescriptions = jobs.filter(job => job.title && job.description);
        if (jobsWithDescriptions.length === 0) {
            showToast('Get descriptions first, then fetch details.', 'error');
            return;
        }

        // Find jobs that need details or have address data available in description.
        // Details are populated only after the description has been fetched.
        const jobsToFetch = jobs.map((job, index) => ({ job, index }))
            .filter(item => {
                if (!item.job.title || !item.job.description) return false;
                const needsDetails = !item.job.detailsFetched ||
                    !item.job.jobId ||
                    !item.job.hospital ||
                    !item.job.city ||
                    !item.job.state ||
                    !item.job.jobType ||
                    !item.job.areaOfPractice ||
                    !item.job.position;
                const needsAddress = !item.job.detailsFetched && item.job.description && (!item.job.streetAddress || !item.job.city || !item.job.state || !item.job.zipCode);
                return needsDetails || needsAddress;
            });

        if (jobsToFetch.length === 0) {
            if (confirm('All jobs already have details. Do you want to re-analyze all jobs?')) {
                detailsQueue = jobs.map((job, index) => ({ job, index }))
                    .filter(item => item.job.title && item.job.description);
            } else {
                return;
            }
        } else {
            detailsQueue = jobsToFetch;
        }

        isFetchingDetails = true;
        currentDetailsIndex = 0;
        fetchDetailsBtn.disabled = true;
        fetchDetailsBtn.textContent = 'Fetching Details...';

        // Show progress
        const progressSection = document.getElementById('progressSection');
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        const progressLabel = document.getElementById('progressLabel');
        progressSection.classList.remove('hidden');
        progressLabel.textContent = 'Analyzing Job Details';
        progressText.textContent = `0 / ${detailsQueue.length}`;
        progressBar.style.width = '0%';

        processNextDetail();
    });

    // Open a job page in a background tab, inject detail-extractor.js, return results
    function fetchDetailFromTab(url) {
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                resolve([]);
            }, 25000);

            // Add ?nl=1 for Jobvite URLs so the page loads standalone (not inside parent iframe)
            let finalUrl = url;
            try {
                const urlObj = new URL(url);
                if (urlObj.hostname.includes('jobvite.com')) {
                    urlObj.searchParams.set('nl', '1');
                    finalUrl = urlObj.toString();
                }
            } catch (e) {
                // Use original URL if parsing fails
            }

            chrome.tabs.create({ url: finalUrl, active: false }, (tab) => {
                if (!tab) {
                    clearTimeout(timeout);
                    resolve([]);
                    return;
                }

                const tabId = tab.id;
                const listener = (updatedTabId, info) => {
                    if (updatedTabId === tabId && info.status === 'complete') {
                        chrome.tabs.onUpdated.removeListener(listener);
                        // Wait for page JS to finish rendering
                        setTimeout(() => {
                            chrome.scripting.executeScript({
                                target: { tabId: tabId },
                                files: ['detail-extractor.js']
                            }).then((results) => {
                                clearTimeout(timeout);
                                chrome.tabs.remove(tabId).catch(() => {});
                                const detailsList = results?.[0]?.result || [];
                                resolve(detailsList);
                            }).catch((err) => {
                                console.warn('Error injecting detail-extractor:', err);
                                clearTimeout(timeout);
                                chrome.tabs.remove(tabId).catch(() => {});
                                resolve([]);
                            });
                        }, 3000);
                    }
                };

                chrome.tabs.onUpdated.addListener(listener);
            });
        });
    }

    async function processNextDetail() {
        if (currentDetailsIndex >= detailsQueue.length) {
            finishDetailsFetching();
            return;
        }

        const queueItem = detailsQueue[currentDetailsIndex];

        // Update progress
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        progressText.textContent = `${currentDetailsIndex + 1} / ${detailsQueue.length}`;
        progressBar.style.width = `${((currentDetailsIndex + 1) / detailsQueue.length) * 100}%`;
        fetchDetailsBtn.textContent = `Analyzing... (${currentDetailsIndex + 1}/${detailsQueue.length})`;

        // Re-read jobs from storage to get the current index
        // (indices shift when multi-location rows are inserted)
        const data = await chrome.storage.local.get(['scrapedJobs']);
        const currentJobs = data.scrapedJobs || [];
        let currentIndex = typeof queueItem.index === 'number' ? queueItem.index : -1;
        const queuedLink = queueItem.job.link || '';

        if (
            currentIndex < 0 ||
            currentIndex >= currentJobs.length ||
            (queuedLink && currentJobs[currentIndex]?.link !== queuedLink)
        ) {
            currentIndex = currentJobs.findIndex(j => queuedLink && j.link === queuedLink);
        }

        if (currentIndex === -1 && queueItem.job.title) {
            currentIndex = currentJobs.findIndex(j =>
                j.title === queueItem.job.title &&
                (!queuedLink || j.link === queuedLink)
            );
        }

        if (currentIndex === -1) {
            // Job no longer found (shouldn't happen), skip it
            currentDetailsIndex++;
            setTimeout(() => processNextDetail(), 50);
            return;
        }

        const job = currentJobs[currentIndex];
        let detailsList = [];

        // Extract details locally from job title + already-fetched description
        const positionTitle = job.title || '';
        const description = job.description || '';

        if (positionTitle) {
            const extracted = extractDetailsFromDescription(positionTitle, description);
            const specifics = getJobviteSpecificsForJob(job);
            const detailHospitalName = cleanSavedHospitalName(specifics.company || extracted.hospitalName);
            const detailBase = {
                areaOfPractice: extracted.areaOfPractice,
                position: extracted.position,
                salary: extracted.salary,
                hospitalName: detailHospitalName,
                company: detailHospitalName,
                category: specifics.category,
                requisitionId: specifics.requisitionId,
                jobId: formatJobviteJobId(specifics.requisitionId),
                lastUpdated: specifics.lastUpdated,
                jobType: extracted.jobType,
                experience: extracted.experience,
                description: description
            };

            // Build detailsList with ALL locations for multi-location jobs
            if (specifics.city || specifics.state) {
                detailsList = [{
                    ...detailBase,
                    city: formatCityName(specifics.city),
                    state: formatStateName(specifics.state),
                    location: formatSpecificsLocation(specifics.city, specifics.state),
                    streetAddress: formatStreetAddress(extracted.streetAddress || ''),
                    zipCode: extracted.zipCode || ''
                }];
            } else if (extracted.locations && extracted.locations.length > 0) {
                detailsList = extracted.locations.map(loc => ({
                    ...detailBase,
                    city: formatCityName(extracted.addressCity || loc.city || ''),
                    state: formatStateName(extracted.addressState || loc.state || ''),
                    location: extracted.addressLocation || loc.location || '',
                    streetAddress: formatStreetAddress(extracted.streetAddress || ''),
                    zipCode: extracted.zipCode || ''
                }));
            } else {
                // No locations found — still create one entry with details
                detailsList = [{
                    ...detailBase,
                    city: formatCityName(extracted.addressCity || ''),
                    state: formatStateName(extracted.addressState || ''),
                    location: extracted.addressLocation || '',
                    streetAddress: formatStreetAddress(extracted.streetAddress || ''),
                    zipCode: extracted.zipCode || ''
                }];
            }
        }

        // Save extracted details to storage
        if (detailsList.length > 0) {
            await saveDetailResults(detailsList, currentIndex);
        }

        // Move to next job — no delay needed since we're analyzing locally
        currentDetailsIndex++;
        setTimeout(() => processNextDetail(), 50);
    }

    // Save detail extraction results to chrome storage
    function saveDetailResults(detailsList, jobIndex) {
        return new Promise((resolve) => {
            chrome.storage.local.get(['scrapedJobs'], (data) => {
                const jobs = data.scrapedJobs || [];
                const originalJob = jobs[jobIndex];

                if (!originalJob) {
                    resolve();
                    return;
                }

                const firstDetail = detailsList[0];

                // --- POSITION: Always determine from the LISTING title (originalJob.title) ---
                // The listing title (e.g. "Veterinary Cardiologist") is the most reliable source.
                // The detail extractor provides AOP (from Jobvite category) which we combine with
                // the listing title to get the correct position.
                const listingTitle = originalJob.title || '';
                const detailAOP = firstDetail.areaOfPractice || '';
                const descText = firstDetail.description || originalJob.description || '';
                const categoryText = firstDetail.category || originalJob.category || '';
                const nonClinicalJob = shouldLeaveClinicalFieldsBlank(listingTitle, categoryText);

                // Step 1: Determine AOP — prefer detail extractor's AOP (from page category), fall back to title
                const categoryAOP = getAOPFromCategory(categoryText);
                let finalAOP = nonClinicalJob ? '' : (categoryAOP || detailAOP || getAOPFromTitle(listingTitle) || '');
                if (!nonClinicalJob && !finalAOP && hasSpecialtyRequirementSignal(descText)) {
                    finalAOP = 'Specialty Care';
                }
                if (!nonClinicalJob && !finalAOP) {
                    finalAOP = 'General Practice Care';
                }

                // Step 2: Match position from listing title
                let finalPosition = nonClinicalJob ? '' : (getPositionFromTitle(listingTitle) || firstDetail.position || '');

                // Step 3: If listing title had no match but AOP is Specialty, try qualifications from description
                if (!finalPosition && finalAOP === 'Specialty Care') {
                    finalPosition = '';
                }

                // Step 4: Validate position against AOP
                if (finalPosition) {
                    finalPosition = getValidatedPosition(finalPosition, finalAOP);
                }
                if (!nonClinicalJob && !finalPosition) {
                    finalPosition = getDefaultPositionForAOP(finalAOP, listingTitle);
                }

                // Step 5: Medical Director override — if title says "Medical Director", keep it
                if (!nonClinicalJob && (!finalPosition || finalPosition === 'Associate Veterinarian') && listingTitle.toLowerCase().includes('medical director')) {
                    finalPosition = APPROVED_POSITION_SET.has('Medical Director') ? 'Medical Director' : '';
                }

                if (!APPROVED_POSITION_SET.has(finalPosition)) {
                    finalPosition = '';
                }

                // Update original job with extracted details
                originalJob.jobId = firstDetail.jobId || formatJobviteJobId(firstDetail.requisitionId || originalJob.requisitionId) || originalJob.jobId || '';
                originalJob.requisitionId = firstDetail.requisitionId || originalJob.requisitionId || '';
                originalJob.category = firstDetail.category || originalJob.category || '';
                originalJob.lastUpdated = firstDetail.lastUpdated || originalJob.lastUpdated || '';
                originalJob.hospital = cleanSavedHospitalName(firstDetail.hospitalName || originalJob.hospital || '');
                originalJob.hospitalName = cleanSavedHospitalName(firstDetail.hospitalName || originalJob.hospitalName || originalJob.hospital || '');
                originalJob.company = cleanSavedHospitalName(firstDetail.company || originalJob.company || originalJob.hospitalName || '');
                originalJob.areaOfPractice = finalAOP;
                originalJob.position = finalPosition || '';
                originalJob.salary = firstDetail.salary || originalJob.salary || '';
                originalJob.jobType = firstDetail.jobType || originalJob.jobType || 'Full-Time';
                originalJob.experience = firstDetail.experience || originalJob.experience || '';
                    if (firstDetail.streetAddress) originalJob.streetAddress = formatStreetAddress(firstDetail.streetAddress);
                    if (firstDetail.zipCode) originalJob.zipCode = firstDetail.zipCode;
                    if (firstDetail.city) originalJob.city = formatCityName(firstDetail.city);
                    if (firstDetail.state) originalJob.state = formatStateName(firstDetail.state);
                if (firstDetail.location) originalJob.location = firstDetail.location;
                // Update description if we got a better one
                if (firstDetail.description && firstDetail.description.length > (originalJob.description || '').length) {
                    originalJob.description = firstDetail.description;
                }
                originalJob.detailsFetched = true;

                // Handle multi-location jobs
                if (detailsList.length > 1) {
                    const currentHospital = originalJob.hospital || '';

                    originalJob.isNewLocation = true;
                    const newJobs = [];
                    for (let i = 1; i < detailsList.length; i++) {
                        const loc = detailsList[i];
                        const baseJobId = originalJob.jobId || `JOB-${jobIndex + 1}`;
                        const newJob = {
                            ...originalJob,
                            jobId: `${baseJobId}-${i + 1}`,
                            hospital: currentHospital,
                            city: formatCityName(loc.city || ''),
                            state: formatStateName(loc.state || ''),
                            location: loc.location || `${loc.city}, ${loc.state}`,
                            streetAddress: formatStreetAddress(loc.streetAddress || ''),
                            zipCode: loc.zipCode || '',
                            isNewLocation: true,
                            sourceLink: originalJob.link || ''
                        };
                        newJobs.push(newJob);
                    }
                    jobs.splice(jobIndex + 1, 0, ...newJobs);
                }

                chrome.storage.local.set({ scrapedJobs: jobs }, () => {
                    allJobs = jobs;
                    displayRecords(allJobs);
                    resolve();
                });
            });
        });
    }

    function finishDetailsFetching() {
        isFetchingDetails = false;
        fetchDetailsBtn.disabled = false;
        fetchDetailsBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4M11,7V13L16.2,16.2L17,14.9L12.5,12.2V7H11Z"/>
            </svg>
            Fetch Details
        `;
        document.getElementById('progressSection').classList.add('hidden');
        showToast(`Details fetched! Processed ${detailsQueue.length} jobs.`, 'success');
    }

    // ============ FETCH ADDRESSES ============

    function normalizeAddressCacheValue(value) {
        return (value || '')
            .toLowerCase()
            .replace(/&/g, ' and ')
            .replace(/[()[\]]/g, ' ')
            .replace(/[-–—]/g, ' ')
            .replace(/\b(?:hospital|clinic|center|centre|veterinary|animal|pet)\b/g, ' ')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    }

    function makeAddressCacheKey(hospital, location) {
        const hospitalKey = normalizeAddressCacheValue(hospital);
        const locationKey = normalizeAddressCacheValue(location);
        return hospitalKey && locationKey ? `${hospitalKey}|${locationKey}` : '';
    }

    function getAddressCacheKeys(hospital, location, originalHospital = '') {
        const keys = new Set();
        const names = [hospital, originalHospital].filter(Boolean);
        for (const name of names) {
            const key = makeAddressCacheKey(name, location);
            if (key) keys.add(key);
        }
        return [...keys];
    }

    function hasUsableCachedAddress(data) {
        return !!(data && data.streetAddress && data.zipCode);
    }

    function toHospitalNameCase(value) {
        return String(value || '').replace(/[A-Za-z][A-Za-z']*/g, (word) => {
            if (word.length <= 1) return word.toUpperCase();
            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        });
    }

    function cleanSavedHospitalName(name) {
        return toHospitalNameCase(String(name || '')
            .replace(/\s+logo$/i, '')
            .replace(/[.,;:]+$/g, '')
            .replace(/\s+/g, ' ')
            .trim());
    }

    function buildPreferredAddressSearchName(hospitalName) {
        const name = (hospitalName || '').replace(/\s+/g, ' ').trim();
        if (!name) return '';

        const parenthetical = name.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
        if (parenthetical) {
            const base = parenthetical[1].trim();
            const branch = parenthetical[2].trim();
            if (base && branch && !base.toLowerCase().includes(branch.toLowerCase())) {
                return `${base} ${branch}`.replace(/\s+/g, ' ').trim();
            }
        }

        return name;
    }

    function hasBracketedHospitalText(hospitalName) {
        return /(?:\([^)]{2,}\)|\[[^\]]{2,}\])/.test(hospitalName || '');
    }

    function parseLocationParts(location) {
        const parts = (location || '').split(',').map(part => part.trim()).filter(Boolean);
        return {
            city: parts[0] || '',
            state: parts.length >= 2 ? parts[1] : ''
        };
    }

    function normalizedLocationPart(value) {
        return (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    function normalizeBusinessNameForCompare(value) {
        return (value || '')
            .toLowerCase()
            .replace(/&/g, ' and ')
            .replace(/[()]/g, ' ')
            .replace(/[-–—]/g, ' ')
            .replace(/[^a-z0-9]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function getBusinessNameTokens(value) {
        const stopWords = new Set(['the', 'and', 'for', 'with', 'of', 'at', 'veterinary', 'animal', 'pet', 'hospital', 'clinic', 'center', 'centre', 'care', 'urgent']);
        const normalized = normalizeBusinessNameForCompare(value);
        const tokens = normalized.split(' ').filter(token => token.length > 2 && !stopWords.has(token));
        return tokens.length ? tokens : normalized.split(' ').filter(token => token.length > 2);
    }

    function businessNameFuzzyMatches(expectedName, scrapedName) {
        const expected = normalizeBusinessNameForCompare(expectedName);
        const scraped = normalizeBusinessNameForCompare(scrapedName);
        if (!expected || !scraped) return true;
        if (expected.includes(scraped) || scraped.includes(expected)) return true;

        const expectedTokens = getBusinessNameTokens(expectedName);
        const scrapedTokens = new Set(getBusinessNameTokens(scrapedName));
        if (expectedTokens.length === 0 || scrapedTokens.size === 0) return false;

        const matched = expectedTokens.filter(token => scraped.includes(token) || scrapedTokens.has(token)).length;
        return matched / expectedTokens.length >= 0.5;
    }

    function businessNamesExactlyEqual(nameA, nameB) {
        return normalizeBusinessNameForCompare(nameA) === normalizeBusinessNameForCompare(nameB);
    }

    function jobLocationMismatch(job) {
        const expected = parseLocationParts(job.location);
        return !!(
            (expected.city && job.city && normalizedLocationPart(job.city) !== normalizedLocationPart(expected.city)) ||
            (expected.state && job.state && normalizedLocationPart(getFullStateName(job.state)) !== normalizedLocationPart(getFullStateName(expected.state)))
        );
    }

    function isPlaceholderAddressValue(value) {
        return /^(?:tbd|n\/a|na|unknown|pending)$/i.test((value || '').trim());
    }

    function hasSuspiciousAddressValue(job) {
        const street = job.streetAddress || '';
        const city = job.city || '';
        const state = job.state || '';
        return !!(
            isPlaceholderAddressValue(street) ||
            isPlaceholderAddressValue(city) ||
            isPlaceholderAddressValue(state) ||
            street.length > 90 ||
            city.length > 45 ||
            state.length > 35 ||
            /Company Description|Job Description|Qualifications|We offer|experienced veterinarian|Willingness to travel|drive practice growth/i.test(street)
        );
    }

    function needsAddressFieldUpdate(job) {
        return !!(
            !job.streetAddress ||
            !job.city ||
            !job.state ||
            hasSuspiciousAddressValue(job) ||
            jobLocationMismatch(job)
        );
    }

    function needsZipUpdate(job) {
        return !!(!job.zipCode || hasSuspiciousAddressValue(job) || jobLocationMismatch(job));
    }

    function needsContactUpdate(job) {
        return !!(!job.website || !job.phone);
    }

    function hasCityStateForSearch(job) {
        const locationParts = parseLocationParts(job.location);
        const city = locationParts.city || job.city || '';
        const state = locationParts.state || job.state || '';
        return !!(city && state && !isPlaceholderAddressValue(city) && !isPlaceholderAddressValue(state));
    }

    function isStreetAddressComplete(job) {
        const street = job.streetAddress || '';
        return !!(
            street &&
            !isPlaceholderAddressValue(street) &&
            !hasSuspiciousAddressValue({ ...job, city: job.city || 'City', state: job.state || 'State' }) &&
            (/\d/.test(street) || /\bP\.?\s*O\.?\s*Box\b/i.test(street))
        );
    }

    function hasCompleteAddressForContactSearch(job) {
        return !!(
            job.streetAddress &&
            !isPlaceholderAddressValue(job.streetAddress) &&
            job.city &&
            job.state &&
            job.zipCode &&
            !hasSuspiciousAddressValue(job) &&
            !jobLocationMismatch(job)
        );
    }

    function hasNoZipButStreetIsNotTbd(job) {
        return !!(
            !job.zipCode &&
            job.streetAddress &&
            !isPlaceholderAddressValue(job.streetAddress) &&
            job.city &&
            job.state &&
            hasCityStateForSearch(job)
        );
    }

    function hasNoZipAndStreetIsTbd(job) {
        return !!(
            !job.zipCode &&
            (
                !job.streetAddress ||
                isPlaceholderAddressValue(job.streetAddress) ||
                hasSuspiciousAddressValue(job)
            ) &&
            hasCityStateForSearch(job)
        );
    }

    function rememberAddressData(keys, data) {
        if (!hasUsableCachedAddress(data)) return;
        for (const key of keys) {
            addressCache.set(key, { ...data });
        }
    }

    function getRememberedAddress(keys) {
        for (const key of keys) {
            const cached = addressCache.get(key);
            if (hasUsableCachedAddress(cached)) return { ...cached };
        }
        return null;
    }

    function primeAddressCache(jobs) {
        addressCache = new Map();
        for (const job of jobs) {
            if (!job.hospital || !job.location || !job.streetAddress || !job.zipCode) continue;
            if (jobLocationMismatch(job)) continue;
            const cached = {
                streetAddress: job.streetAddress || '',
                zipCode: job.zipCode || '',
                city: job.city || '',
                state: job.state || '',
                fullAddress: [job.streetAddress, job.city, [job.state, job.zipCode].filter(Boolean).join(' ')].filter(Boolean).join(', '),
                website: job.website || '',
                phone: job.phone || ''
            };
            rememberAddressData(getAddressCacheKeys(job.hospital, job.location), cached);
        }
    }

    fetchAddressesBtn.addEventListener('click', async () => {
        if (isFetchingAddresses) {
            showToast('Already fetching addresses. Please wait...', 'error');
            return;
        }

        const data = await chrome.storage.local.get(['scrapedJobs']);
        const jobs = data.scrapedJobs || [];

        addressQueue = jobs
            .map((job, index) => ({ job, index }))
            .filter(item => item.job.hospital && hasCityStateForSearch(item.job));

        if (addressQueue.length === 0) {
            showToast('No jobs have hospital names with city/state to fetch address data.', 'error');
            return;
        }

        addressCache = new Map();
        isFetchingAddresses = true;
        currentAddressIndex = 0;
        fetchAddressesBtn.disabled = true;
        fetchAddressesBtn.textContent = 'Fetching Addresses...';

        // Show progress
        const progressSection = document.getElementById('progressSection');
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        const progressLabel = document.getElementById('progressLabel');
        progressSection.classList.remove('hidden');
        progressLabel.textContent = 'Fetching Addresses, Websites & Phones';
        progressText.textContent = `0 / ${addressQueue.length}`;
        progressBar.style.width = '0%';

        processNextAddress();
    });

    async function processNextAddress() {
        if (currentAddressIndex >= addressQueue.length) {
            finishAddressFetching();
            return;
        }

        const { job, index } = addressQueue[currentAddressIndex];

        // Update progress
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        progressText.textContent = `${currentAddressIndex + 1} / ${addressQueue.length}`;
        progressBar.style.width = `${((currentAddressIndex + 1) / addressQueue.length) * 100}%`;
        fetchAddressesBtn.textContent = `Fetching... (${currentAddressIndex + 1}/${addressQueue.length})`;

        try {
            // Clean hospital name for search:
            // Remove trailing location suffix for child rows: "Hospital-Leesburg" → "Hospital"
            let searchHospital = cleanSavedHospitalName(job.hospital || '');
            if (false && job.sourceLink && searchHospital) {
                searchHospital = searchHospital.replace(/\s*[-–]\s*[A-Z][a-zA-Z\s.'-]+$/, '').trim();
                if (!searchHospital) searchHospital = job.hospital;
            }

            if (!hasBracketedHospitalText(searchHospital)) {
                searchHospital = buildPreferredAddressSearchName(searchHospital);
            }

            // Only append "Hospital" when the name does not already look like a veterinary facility.
            if (searchHospital && !/\b(?:hospital|clinic|center|centre|specialists?|specialty|service|services|care|emergency|referral|veterinary|animal|pet)\b/i.test(searchHospital)) {
                searchHospital = searchHospital + ' Hospital';
            }

            // Parse city and state from location field (e.g. "Austin, TX")
            let searchCity = '';
            let searchState = '';
            const locationParts = parseLocationParts(job.location);
            searchCity = locationParts.city || job.city || '';
            searchState = locationParts.state || job.state || '';
            if (!searchState && job.location) {
                const locParts = job.location.split(',').map(s => s.trim());
                if (locParts.length === 1) {
                    searchCity = locParts[0];
                }
            }

            // Build search: "Hospital Name, City, State"
            const searchLocation = [searchCity, searchState].filter(Boolean).join(', ');
            const normalizeLocationValue = (value) => (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const cacheKeys = getAddressCacheKeys(searchHospital, searchLocation, job.hospital || '');
            let addressData = getRememberedAddress(cacheKeys);
            if (addressData && (!addressData.website || !addressData.phone)) {
                addressData = null;
            }
            if (addressData) {
                console.log(`Using cached address for "${searchHospital}, ${searchLocation}"`);
            } else {
                addressData = await fetchAddressFromGoogleMaps(searchHospital, searchLocation, job.hospital || '');
                rememberAddressData(cacheKeys, addressData);
            }

            // Update job with fresh data from Google Maps/Search. Failed
            // lookups clear address/contact fields so stale values do not remain.
            const data = await chrome.storage.local.get(['scrapedJobs']);
            const jobs = data.scrapedJobs || [];

            if (jobs[index]) {
                let zipCode = addressData.zipCode || '';
                if (!zipCode && addressData.fullAddress) {
                    const zipFromFull = addressData.fullAddress.match(/\b(\d{5}(?:-\d{4})?)\b/);
                    if (zipFromFull) zipCode = zipFromFull[1];
                }
                const cleanedStreetAddress = cleanStreetAddressValue(addressData?.streetAddress || '');

                const normalizeStateForAddressSave = (value) => {
                    const normalized = getFullStateName(value || '');
                    return normalizeLocationValue(normalized || value || '');
                };
                const cityFuzzyMatchesForSave = (expectedCity, resultCity) => {
                    const expected = normalizeLocationValue(expectedCity);
                    const result = normalizeLocationValue(resultCity);
                    if (!expected || !result) return true;
                    if (expected === result) return true;
                    if (expected.length >= 5 && result.startsWith(expected)) return true;
                    if (result.length >= 5 && expected.startsWith(result)) return true;

                    const expectedWords = (expectedCity || '').toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 2);
                    const resultWords = new Set((resultCity || '').toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 2));
                    if (expectedWords.length === 0 || resultWords.size === 0) return false;

                    const matched = expectedWords.filter(word => resultWords.has(word)).length;
                    return matched / expectedWords.length >= 0.75;
                };
                const fetchedCityExact = !!(
                    addressData?.city &&
                    searchCity &&
                    normalizeLocationValue(addressData.city) === normalizeLocationValue(searchCity)
                );
                const fetchedCityFuzzy = !!(
                    addressData?.city &&
                    searchCity &&
                    !fetchedCityExact &&
                    cityFuzzyMatchesForSave(searchCity, addressData.city)
                );
                const fetchedCityMismatch = !!(
                    addressData?.city &&
                    searchCity &&
                    !fetchedCityExact &&
                    !fetchedCityFuzzy
                );
                const fetchedStateMismatch = !!(
                    addressData?.state &&
                    searchState &&
                    normalizeStateForAddressSave(addressData.state) !== normalizeStateForAddressSave(searchState)
                );
                const foundAddress = !!(
                    addressData &&
                    cleanedStreetAddress &&
                    zipCode &&
                    addressData.city &&
                    addressData.state &&
                    !fetchedCityMismatch &&
                    !fetchedStateMismatch
                );
                jobs[index].cityMismatchFlag = fetchedCityFuzzy || fetchedCityMismatch || fetchedStateMismatch;
                jobs[index].hospitalNameUpdated = false;

                if (foundAddress) {
                    jobs[index].streetAddress = formatStreetAddress(cleanedStreetAddress);
                    jobs[index].city = formatCityName(addressData.city || '');
                    jobs[index].state = formatStateName(addressData.state || '');
                    jobs[index].zipCode = zipCode;
                    jobs[index].website = addressData.website || '';
                    jobs[index].phone = addressData.phone || '';
                } else {
                    jobs[index].streetAddress = 'Not Found (TBD)';
                    jobs[index].city = formatCityName(searchCity || job.city || '');
                    jobs[index].state = formatStateName(searchState || job.state || '');
                    jobs[index].zipCode = '00000';
                    jobs[index].website = '';
                    jobs[index].phone = '';
                }

                await chrome.storage.local.set({ scrapedJobs: jobs });

                // Update display
                allJobs = jobs;
                displayRecords(allJobs);
            }
        } catch (error) {
            console.error('Error fetching address:', error);
        }

        // Move to next address
        currentAddressIndex++;

        // Continue processing — delay for Google Maps tab loading
        setTimeout(() => processNextAddress(), 250);
    }

    function finishAddressFetching() {
        isFetchingAddresses = false;
        fetchAddressesBtn.disabled = false;
        fetchAddressesBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12,2C8.13,2 5,5.13 5,9C5,14.25 12,22 12,22C12,22 19,14.25 19,9C19,5.13 15.87,2 12,2M12,11.5C10.62,11.5 9.5,10.38 9.5,9C9.5,7.62 10.62,6.5 12,6.5C13.38,6.5 14.5,7.62 14.5,9C14.5,10.38 13.38,11.5 12,11.5Z"/>
            </svg>
            Fetch Addresses
        `;
        document.getElementById('progressSection').classList.add('hidden');
        showToast(`Address fetching completed! Fetched ${addressQueue.length} addresses.`, 'success');
    }
});
