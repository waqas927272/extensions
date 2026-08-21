document.addEventListener('DOMContentLoaded', () => {
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
    const AGGREGATOR_NAME = 'Cove Animal Health (Parent Aggregator)';

    function normalizeCoveJobId(jobId) {
        return (jobId || '').replace(/^UVC-/i, 'COV-');
    }

    function normalizeStoredExperience(experience) {
        const value = (experience || '').trim();
        if (!value) return '';

        let match = value.match(/^(\d+)\s*(?:[-\u2013\u2014]|\s+to\s+)\s*(\d+)\s*years?$/i);
        if (match) return `${match[1]}-${match[2]} years`;

        match = value.match(/^(\d+)\s*\+\s*years?$/i);
        if (match) return `${match[1]}+ years`;

        match = value.match(/^(\d+)\s*years?$/i);
        if (match) return `${match[1]} ${match[1] === '1' ? 'year' : 'years'}`;

        return '';
    }

    function normalizeStoredJobIds(jobs) {
        let changed = false;
        const normalizedJobs = (jobs || []).map(job => {
            const normalizedJobId = normalizeCoveJobId(job.jobId);
            const normalizedExperience = normalizeStoredExperience(job.experience);
            if (normalizedJobId !== (job.jobId || '') || normalizedExperience !== (job.experience || '')) {
                changed = true;
                return { ...job, jobId: normalizedJobId, experience: normalizedExperience };
            }
            return job;
        });

        return { normalizedJobs, changed };
    }

    // ============ WEBHOOK URL DYNAMIC CONFIGURATION ============

    function normalizeWebhookUrl(url) {
        const value = (url || '').trim();
        if (!value) return '';
        return value.replace(/^http:\/localhost/i, 'http://localhost')
            .replace(/^https:\/localhost/i, 'https://localhost');
    }

    function isPlaceholderWebhookUrl(url) {
        return /yourdomain\.com/i.test(url || '');
    }

    // Load saved webhook URL from Chrome storage or auto-detect
    async function loadWebhookUrl() {
        try {
            const result = await chrome.storage.local.get(['webhookUrl']);

            if (result.webhookUrl && !isPlaceholderWebhookUrl(result.webhookUrl)) {
                // Use saved URL
                const savedUrl = normalizeWebhookUrl(result.webhookUrl);
                webhookUrlInput.value = savedUrl;
                if (savedUrl !== result.webhookUrl) {
                    await chrome.storage.local.set({ webhookUrl: savedUrl });
                }
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
        const isLocalhost = window.location.protocol === 'chrome-extension:' ||
                           window.location.hostname === 'localhost' ||
                           window.location.hostname === '127.0.0.1' ||
                           window.location.hostname === '';

        if (isLocalhost) {
            // Development environment - use localhost without double slash
            return 'http://localhost/zoho-api/api/webhook-receiver.php';
        } else {
            // Production environment - try to detect the domain
            // User will need to update this for their production URL
            return 'https://yourdomain.com/zoho-api/api/webhook-receiver.php';
        }
    }

    // Save webhook URL to Chrome storage when it changes
    webhookUrlInput.addEventListener('change', async () => {
        const url = normalizeWebhookUrl(webhookUrlInput.value);
        if (url) {
            webhookUrlInput.value = url;
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
        // If it's already a full name (longer than 2 chars), return as is
        if (state.length > 2) return state;
        // Convert abbreviation to full name
        return stateAbbreviations[state.toUpperCase()] || state;
    }

    function getStateAbbreviation(state) {
        if (!state) return '';
        const value = state.trim();
        if (/^[A-Z]{2}$/i.test(value)) return value.toUpperCase();
        const normalized = value.toLowerCase().replace(/[^a-z]/g, '');
        const match = Object.entries(stateAbbreviations).find(([, fullName]) =>
            fullName.toLowerCase().replace(/[^a-z]/g, '') === normalized
        );
        return match ? match[0] : value;
    }

    function extractDescriptionField(text, fieldName) {
        const escapedField = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`^\\s*${escapedField}\\s*:\\s*(.+)$`, 'im');
        const match = String(text || '').match(pattern);
        return match ? match[1].trim() : '';
    }

    function isPriorityPetUrgentCareText(text) {
        return /\bpriority\s*pet\s+urgent\s+care\b/i.test(String(text || ''));
    }

    function getAOPFromHospitalName(hospitalName) {
        return isPriorityPetUrgentCareText(hospitalName) ? 'Urgent Care' : '';
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

    function hasSpecialtyTrainingSignal(text) {
        return /\bboard certified\b|\bresidency[-\s]+trained\b|\bresidential[-\s]+trained\b/i.test(text || '');
    }

    function matchApprovedPositionFromText(text) {
        if (!text) return '';

        const rules = [
            ['Medical Director', [/\bmedical director\b/i]],
            ['Lead Veterinarian', [/\blead veterinarian\b/i, /\blead vet\b/i, /\bhead veterinarian\b/i, /\bhead vet\b/i]],
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
        if (t.includes('lead veterinarian') || t.includes('lead vet') || t.includes('head veterinarian') || t.includes('head vet')) return 'Lead Veterinarian';

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
        if (t.includes('partner veterinarian') || t.includes('partner vet')) return 'Partner Veterinarian';
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

        if (aopParts.some(part => ['General Practice Care', 'Emergency Care', 'Urgent Care'].includes(part))) {
            return 'Associate Veterinarian';
        }

        return '';
    }

    // Determine AOP from the Jobvite category string
    function getAOPFromCategory(category) {
        if (!category) return '';
        const cat = category.toLowerCase().trim();
        if (cat.includes('gen practice')) return 'General Practice Care';
        if (cat.includes('(er)') || cat === 'veterinarian (er)') return 'Emergency Care';
        if (cat.includes('specialty diplomate') || cat.includes('surgeon diplomate')) return 'Specialty Care';
        return '';
    }

    // Determine AOP from title keywords when category is not available
    function getAOPFromTitle(title) {
        const t = title.toLowerCase();

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

        // Equine/Bovine/Exotics default to GP unless the title/category already
        // identified Emergency, Urgent Care, or Specialty above.
        if (t.includes('equine') || t.includes('bovine') || t.includes('large animal') ||
            t.includes('avian') || t.includes('exotics')) return 'General Practice Care';

        return '';
    }

    // ============ LOCAL DETAIL EXTRACTION (mirrors detail-extractor.js) ============

    function extractDetailsFromDescription(positionTitle, descriptionText) {
        // Format salary to standard "$X–$Y per year" or "$X per hour"
        function formatSalary(raw) {
            if (!raw) return '';
            const isHourly = /(?:per\s+)?(?:hour|hr|\/hr|\/hour)/i.test(raw);
            const amounts = [];
            const amountRegex = /\$?([\d,]+(?:\.\d{2})?)\s*k?\b/gi;
            let match;
            while ((match = amountRegex.exec(raw)) !== null) {
                let num = parseFloat(match[1].replace(/,/g, ''));
                const afterMatch = raw.substring(match.index + match[0].length - 1, match.index + match[0].length + 1);
                if (/k/i.test(match[0]) || /k/i.test(afterMatch)) {
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
                /\$[\d,]+(?:\.\d{2})?\s*(?:per\s+)?(?:hour|hr|\/hr|\/hour)/i,
            ];
            for (const pattern of salaryPatterns) {
                const m = text.match(pattern);
                if (m) return formatSalary(m[0].trim());
            }

            // Broader fallback: scan salary-related lines for any dollar amount/range.
            // Handles wording like "Compensation Range- $175,000-250,000" or
            // "Annual compensation starting at $150,000".
            const candidateLines = text
                .replace(/(?:salary|compensation|pay|wage|base)\s*[\r\n]+/gi, '$& ')
                .split(/\n|;/)
                .map(line => line.trim())
                .filter((line, index, lines) => {
                    const previousLine = index > 0 ? lines[index - 1] : '';
                    return /\b(?:salary|compensation|pay|wage|earn|earning|base)\b/i.test(`${previousLine} ${line}`);
                })
                .filter(line => /\$\s*\d/.test(line));

            for (const line of candidateLines) {
                const rangeMatch = line.match(/\$\s*[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s*(?:[-\u2013\u2014]|to)\s*\$?\s*[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?(?:\s*(?:per\s+)?(?:year|annually|annum|annual|hour|hr|\/hr))?/i);
                if (rangeMatch) {
                    const unitMatch = line.match(/\b(?:per\s+)?(?:hour|hr|year|annually|annum|annual)\b|\/(?:hr|hour)\b/i);
                    return formatSalary(`${rangeMatch[0]} ${unitMatch ? unitMatch[0] : ''}`.trim());
                }

                const singleMatch = line.match(/\$\s*[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?(?:\+)?(?:\s*(?:(?:per\s+)?(?:year|annually|annum|annual|hour|hr)|\/(?:hr|hour)))?/i);
                if (singleMatch) {
                    const unitMatch = line.match(/\b(?:per\s+)?(?:hour|hr|year|annually|annum|annual)\b|\/(?:hr|hour)\b/i);
                    return formatSalary(`${singleMatch[0]} ${unitMatch ? unitMatch[0] : ''}`.trim());
                }
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

            const rolePattern = /\b(?:medical director|lead veterinarian|lead vet|head veterinarian|head vet|board certified|residency[-\s]+trained|residential[-\s]+trained|diplomate|criticalist|ecc specialist|emergency\s*(?:&|and)?\s*critical care specialist|internist|internal medicine specialist|cardiologist|dermatologist|neurologist|neurosurgeon|ophthalmologist|radiologist|diagnostic imaging specialist|anesthesiologist|medical oncologist|radiation oncologist|veterinary dentist|dental specialist|oral surgeon|veterinary surgeon|credentialed veterinary technician specialist|technician specialist|\bvts\b|\bdacv(?:ecc|im|r|s|d|o|aa)?\b|\bdacvr[-\s]?ro\b|\bdavdc\b|\bdabvp\b)\b/i;
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

            if (hasSpecialtyTrainingSignal(descriptionText)) return 'Specialty Care';

            // STEP 0: Title-specific overrides — these are MORE specific than Jobvite categories.
            // e.g. "Urgent Care Veterinarian" is categorized as "Veterinarian (ER)" on Jobvite,
            // but "urgent care" in the title is a more precise signal than the broad ER bucket.
            if (title.includes('urgent care')) return 'Urgent Care';

            // STEP 1: Use industry/category - most reliable signal for broad categories
            if (category) {
                if (category.includes('gen practice')) return 'General Practice Care';
                if (category === 'veterinarian (er)' || category.includes('(er)')) return 'Emergency Care';
                if (category.includes('specialty diplomate') || category.includes('surgeon diplomate')) return 'Specialty Care';
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

            // STEP 4: Check TITLE for equine/bovine/large animal/avian/exotics.
            // Keep this as one AOP; explicit Emergency/Urgent/Specialty signals
            // are handled before this fallback.
            if (title.includes('equine') || title.includes('bovine') || title.includes('large animal') ||
                title.includes('avian') || title.includes('exotics')) {
                return 'General Practice Care';
            }

            // STEP 5: For generic titles, check ONLY the qualifications section
            const qualSection = extractQualificationsSection(descriptionText);
            if (qualSection) {
                const qualLower = qualSection.toLowerCase();
                for (const cert of specialtyCerts) {
                    if (qualLower.includes(cert)) return 'Specialty Care';
                }
            }

            // STEP 6: Check page text for ER category
            if (descriptionText.match(/Veterinarian \(ER\)/i)) return 'Emergency Care';

            return 'General Practice Care';
        }

        // Match position from title keywords
        // PRIORITY ORDER: Leadership first (to avoid false matches on service names), then specialty, then generic
        function matchPositionFromTitle(title) {
            const t = (title || '').toLowerCase();

            // === HIGHEST PRIORITY: Leadership positions ===
            // Must be checked FIRST — "Group Medical Director - The Oncology Service" should be
            // Medical Director, NOT Medical Oncologist. The specialty word is the service name, not the role.
            if (t.includes('medical director')) return 'Medical Director';
            if (t.includes('lead veterinarian') || t.includes('lead vet') || t.includes('head veterinarian') || t.includes('head vet')) return 'Lead Veterinarian';

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
            if (t.includes('partner veterinarian') || t.includes('partner vet')) return 'Partner Veterinarian';
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

        // Extract hospital name from stored description (which now includes JSON-LD data)
        function extractHospitalName(text) {
            const hospitalKeyword = /(?:animal\s+(?:hospital|clinic)|veterinary\s+(?:hospital|center|clinic|care|specialists?|associates?|er|emergency(?:\s+and\s+specialty\s+care)?)|pet\s+(?:hospital|clinic|care)|emergency\s+(?:hospital|center|clinic)|oncology\s+service|specialty\s+hospital|referral\s+center|care\s+center|pieper\s+veterinary|firehouse\s+\d+)/i;
            const blockedOrgName = /^(?:cove(?: animal health)?|encore vet group|united veterinary care|alliance animal health)\b/i;

            // ClearCompany descriptions include the actual facility as Office Name.
            const officeNameMatch = text.match(/Office Name:\s*([^\n]+)/i);
            if (officeNameMatch) {
                const office = officeNameMatch[1].trim();
                if (office && !blockedOrgName.test(office)) return office;
            }

            const brandNameMatch = text.match(/Brand Name:\s*([^\n]+)/i);
            if (brandNameMatch) {
                const brand = brandNameMatch[1].trim();
                if (brand && hospitalKeyword.test(brand) && !blockedOrgName.test(brand)) return brand;
            }

            // First try to find "Position at [Hospital Name]" (most specific)
            const positionAtMatch = text.match(/Position at\s+((?:[\w'.&-]+\s+){1,8}(?:Animal\s+Hospital|Veterinary\s+(?:Hospital|Center|Clinic|Care|Specialists?)|Pet\s+(?:Hospital|Clinic|Care)|Emergency\s+(?:Hospital|Center|Clinic)|The\s+[A-Z][\w\s]+Service))/i);
            if (positionAtMatch) {
                const value = positionAtMatch[1].trim();
                if (!blockedOrgName.test(value)) return value;
            }

            // Try to find hospital name from description
            const hospitalMatch = text.match(/at\s+((?:[\w'.&-]+\s+){1,5}(?:Animal\s+Hospital|Veterinary\s+(?:Hospital|Center|Clinic|Care|Specialists?)|Pet\s+(?:Hospital|Clinic|Care)|Emergency\s+(?:Hospital|Center|Clinic)|The\s+[A-Z][\w\s]+Service))\b/i);
            if (hospitalMatch) {
                const value = hospitalMatch[1].trim();
                if (!blockedOrgName.test(value)) return value;
            }

            // Try to derive hospital from the job title line in JSON-LD block
            const titleLineMatch = text.match(/(?:^|\n)Title:\s*([^\n]+)/i);
            if (titleLineMatch) {
                const fullTitle = titleLineMatch[1].trim();
                const titleParts = fullTitle.split(/\s*[-|]\s*/).map(s => s.trim()).filter(Boolean);
                const hospitalPart = titleParts.find(part => hospitalKeyword.test(part) && !blockedOrgName.test(part));
                if (hospitalPart) return hospitalPart;
            }

            // Last fallback: structured Hiring Organization if it looks like a real facility and not parent org
            const hiringOrgMatch = text.match(/Hiring Organization:\s*([^\n]+)/i);
            if (hiringOrgMatch) {
                const org = hiringOrgMatch[1].trim();
                if (hospitalKeyword.test(org) && !blockedOrgName.test(org)) return org;
            }

            // Fallback: any standalone line that looks like a hospital/facility name
            const lineMatches = text.matchAll(/(?:^|\n)([^\n]{3,90})/g);
            for (const match of lineMatches) {
                const candidate = (match[1] || '').trim();
                if (hospitalKeyword.test(candidate) && !blockedOrgName.test(candidate) && !/^title:|^locations?:|^salary|^employment type:/i.test(candidate)) {
                    return candidate;
                }
            }

            return '';
        }

        // Extract job type from description
        // Rules: "part time or full time" / "full time or part time" → Full-Time
        //        only "part time" / "part-time" mentioned → Part-Time
        //        nothing mentioned or only "full time" → Full-Time (default)
        function extractJobType(text) {
            if (!text) return 'Full-Time';

            // Prefer a structured Employment Type value, but do not stop on blank fields.
            const empTypeMatch = text.match(/employment type:[^\S\r\n]*([^\r\n]*)/i);
            if (empTypeMatch) {
                const empType = (empTypeMatch[1] || '').trim().toLowerCase();
                if (empType) {
                    const empHasFullTime = /\bfull[\s-]?time\b|\bfulltime\b/i.test(empType);
                    const empHasPartTime = /\bpart[\s-]?time\b|\bparttime\b|\(pt\)/i.test(empType);

                    if (empHasFullTime) return 'Full-Time';
                    if (empHasPartTime) return 'Part-Time';
                    return 'Full-Time';
                }
            }

            // Fallback: check the complete description body.
            const hasFullTime = /\bfull[\s-]?time\b|\bfulltime\b/i.test(text);
            const hasPartTime = /\bpart[\s-]?time\b|\bparttime\b|\(pt\)/i.test(text);

            // Full-Time wins when both are present; otherwise Part-Time only when it is the only match.
            if (hasFullTime) return 'Full-Time';
            if (hasPartTime) return 'Part-Time';
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
                .filter(line => /\b(?:experience|minimum|min\.?|at least|required|requirements?|qualifications?|practice setting|years in practice)\b/i.test(line))
                .filter(line => /\b\d+\s*(?:\+|[-\u2013\u2014]\s*\d+|\s+to\s+\d+)?\s*(?:years?|yrs?\.?)\b/i.test(line))
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

        const isGenericCoveLandingDescription =
            /join\s+our\s+team\s+of\s+passionate\s+and\s+dedicated\s+professionals/i.test(descriptionText) ||
            /positions\s+are\s+available\s+at\s+all\s+of\s+the\s+hospitals\s+within\s+the\s+cove\s+veterinary\s+network/i.test(descriptionText) ||
            /powered\s+by\s+cookiescript/i.test(descriptionText);

        // Generic COVE landing-page text has no real job details; keep title-derived fields,
        // but do not invent hospital/salary/location data from that page chrome.
        const detailText = isGenericCoveLandingDescription ? '' : descriptionText;
        const salary = extractSalary(detailText);
        const areaOfPractice = determineAreaOfPractice(positionTitle, detailText);
        const position = determinePosition(positionTitle, detailText, areaOfPractice);
        const locations = extractLocations(detailText);
        const hospitalName = extractHospitalName(detailText);
        const jobType = isGenericCoveLandingDescription ? '' : extractJobType(detailText);
        const experience = extractExperience(detailText);

        return {
            salary,
            areaOfPractice,
            position,
            locations,
            hospitalName,
            jobType,
            experience
        };
    }

    // Google Maps scraping function to get street address and zip code
    // Opens a Google Maps search tab, injects scraper that:
    //   1. Waits for search results to load
    //   2. Matches the hospital name from aria-labels on search result links
    //   3. Clicks the matching result
    //   4. Waits for place detail panel and extracts address
    // Retries with simplified search query if first attempt fails.
    async function fetchAddressFromGoogleMaps(hospitalName, location, originalHospitalName = '') {
        // Build search query: "Hospital Name, City, State"
        const searchQuery = [hospitalName, location].filter(Boolean).join(', ');
        const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`;

        function emptyAddressResult() {
            return { businessName: '', streetAddress: '', zipCode: '', city: '', state: '', fullAddress: '', website: '', phone: '', cityMatchedHospitalName: false, locationCorrected: false, locationCorrectionReason: '' };
        }

        const expectedLocation = parseExpectedLocation(location);

        function normalizeForCompare(value) {
            return (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
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

            if (!expectedCity || !expectedState) return false;
            if (!resultCity || !resultState) return false;
            if (resultCity !== expectedCity) return false;
            if (resultState !== expectedState) return false;
            return true;
        }

        function resultMatchesExpectedLocationLoosely(result) {
            const resultState = normalizeStateForCompare(result.state || '');
            const expectedState = expectedLocation.state;
            if (!result.city || !resultState || !expectedLocation.city || !expectedState) return false;
            if (resultState !== expectedState) return false;
            return cityMatchesLoosely(expectedLocation.city, result.city);
        }

        function getHospitalNameCityCandidates(name) {
            const source = String(name || '').replace(/\s+/g, ' ').trim();
            if (!source) return [];

            const candidates = [];
            const ofMatch = source.match(/\bof\s+(.+?)\s*$/i);
            if (ofMatch) candidates.push(ofMatch[1]);

            const dashMatch = source.match(/\s[-–—]\s*([^,]+?)(?:,\s*[A-Z]{2})?\s*$/i);
            if (dashMatch) candidates.push(dashMatch[1]);

            return candidates
                .map(candidate => candidate
                    .replace(/\s*[-–—]\s*[^,]+,\s*[A-Z]{2}\s*$/i, '')
                    .replace(/,\s*[A-Z]{2}\s*$/i, '')
                    .replace(/\b(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b$/i, '')
                    .replace(/\bNational\b$/i, '')
                    .trim())
                .filter(Boolean);
        }

        function resultCityMatchesHospitalName(result) {
            const resultCity = normalizeForCompare(result.city || '');
            const resultState = normalizeStateForCompare(result.state || '');
            const expectedState = expectedLocation.state;
            if (!resultCity || !resultState || !expectedState || resultState !== expectedState) return false;

            const candidates = [
                ...getHospitalNameCityCandidates(hospitalName),
                ...getHospitalNameCityCandidates(originalHospitalName)
            ];

            return candidates.some(candidate => normalizeForCompare(candidate) === resultCity);
        }

        function filterDataForExpectedLocation(data, sourceLabel) {
            const result = data || emptyAddressResult();

            if (result.businessName && !businessNameFuzzyMatches(hospitalName, result.businessName) && !businessNameFuzzyMatches(originalHospitalName, result.businessName)) {
                console.warn(`Ignoring result because business name "${result.businessName}" does not fuzzy-match "${hospitalName}" from "${sourceLabel}"`);
                return emptyAddressResult();
            }

            const hasLocationSignal = !!(result.streetAddress || result.zipCode || result.fullAddress || result.city || result.state);
            if (hasLocationSignal && !resultMatchesExpectedLocation(result)) {
                if (resultMatchesExpectedLocationLoosely(result)) {
                    result.locationCorrected = true;
                    result.locationCorrectionReason = 'City text was noisy or misspelled';
                    console.warn(`Accepting address with corrected city "${result.city}" for raw city "${expectedLocation.city}" from "${sourceLabel}"`);
                    return result;
                }
                if (resultCityMatchesHospitalName(result)) {
                    result.cityMatchedHospitalName = true;
                    console.warn(`Accepting city mismatch because scraped city "${result.city}" matches hospital name for "${hospitalName}" from "${sourceLabel}"`);
                    return result;
                }
                console.warn(`Ignoring address result outside requested city/state "${location}" from "${sourceLabel}": ${result.fullAddress || [result.city, result.state, result.zipCode].filter(Boolean).join(', ')}`);
                return emptyAddressResult();
            }

            return result;
        }

        function mergeMapsData(primary, secondary, sourceLabel = '') {
            const safeSecondary = filterDataForExpectedLocation(secondary, sourceLabel);
            return {
                businessName: primary.businessName || safeSecondary.businessName || '',
                streetAddress: primary.streetAddress || safeSecondary.streetAddress || '',
                zipCode: primary.zipCode || safeSecondary.zipCode || '',
                city: primary.city || safeSecondary.city || '',
                state: primary.state || safeSecondary.state || '',
                fullAddress: primary.fullAddress || safeSecondary.fullAddress || '',
                website: primary.website || safeSecondary.website || '',
                phone: primary.phone || safeSecondary.phone || '',
                cityMatchedHospitalName: !!(primary.cityMatchedHospitalName || safeSecondary.cityMatchedHospitalName),
                locationCorrected: !!(primary.locationCorrected || safeSecondary.locationCorrected),
                locationCorrectionReason: primary.locationCorrectionReason || safeSecondary.locationCorrectionReason || ''
            };
        }

        function needsMapsRetry(data) {
            return !data.streetAddress || !data.zipCode;
        }

        function uniqueQueries(names) {
            const seen = new Set();
            const queries = [];
            for (const name of names) {
                const normalizedName = (name || '').replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim();
                if (!normalizedName) continue;
                const query = `${normalizedName}, ${location}`.replace(/\s+/g, ' ').trim();
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

                names.push(base, withoutLocationSuffix, withoutParens, expandedParens, plain);

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
                                        cityMatchedHospitalName: !!data.cityMatchedHospitalName
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
                                        cityMatchedHospitalName: !!data.cityMatchedHospitalName
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
                                        cityMatchedHospitalName: !!data.cityMatchedHospitalName
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
                                        cityMatchedHospitalName: !!data.cityMatchedHospitalName
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
        let data = mergeMapsData(emptyAddressResult(), await scrapeGoogleMapsTabSafe(mapsUrl, searchQuery), searchQuery);

        // Attempt 2: if failed, try with & → and, remove dashes/parens
        if (needsMapsRetry(data)) {
            const simplifiedName = hospitalName
                .replace(/&/g, 'and')
                .replace(/[-–—()]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            const altQuery = `${simplifiedName}, ${location}`;
            if (altQuery !== searchQuery) {
                console.log(`↻ Retry with: "${altQuery}"`);
                const altUrl = `https://www.google.com/maps/search/${encodeURIComponent(altQuery)}`;
                const altData = await scrapeGoogleMapsTabSafe(altUrl, altQuery);
                data = mergeMapsData(data, altData, altQuery);
            }
        }

        // Additional Maps attempts for names with location suffixes or parenthetical acronyms.
        if (needsMapsRetry(data)) {
            for (const query of uniqueQueries(buildHospitalNameVariants()).slice(0, 6)) {
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
            for (const query of uniqueQueries(buildHospitalNameVariants()).slice(0, 4)) {
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
            cityMatchedHospitalName: !!data.cityMatchedHospitalName
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

    function setCompactCell(row, value) {
        const cell = row.insertCell();
        const displayValue = value || '-';
        cell.textContent = displayValue;
        cell.title = displayValue;
        return cell;
    }

    function getJobSelectionKey(job) {
        return [
            normalizeCoveJobId(job.jobId) || '',
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
        jobs = currentDisplayedJobs;
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
            const hasDescription = !!job.description;
            const hasDetails = !!job.detailsFetched;

            // Mark new jobs with green background
            if (job.isNewLocation) {
                row.style.backgroundColor = '#d1fae5';
            }

            if (job.cityMismatchFlag) {
                row.classList.add('row-city-mismatch');
                row.title = job.cityMismatchReason || 'City/state was corrected from Google address data';
            }

            if (selectedJobKeys.has(selectionKey)) {
                row.classList.add('selected-row');
            }

            const selectCell = row.insertCell();
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

            const serialCell = setCompactCell(row, index + 1);
            serialCell.className = 'serial-cell';

            setCompactCell(row, job.title);

            const jobIdCell = setCompactCell(row, normalizeCoveJobId(job.jobId) || 'N/A');
            jobIdCell.style.fontFamily = "'Consolas', 'Monaco', monospace";
            jobIdCell.style.fontSize = '12px';
            jobIdCell.style.color = '#64748b';

            setCompactCell(row, hasDetails ? job.hospital : '');
            setCompactCell(row, AGGREGATOR_NAME);
            setCompactCell(row, hasDetails ? job.streetAddress : '');
            setCompactCell(row, hasDetails ? job.city : '');
            setCompactCell(row, hasDetails ? job.state : '');
            setCompactCell(row, hasDetails ? job.zipCode : '');
            setCompactCell(row, hasDetails ? job.phone : '');

            const websiteCell = row.insertCell();
            if (hasDetails && job.website) {
                const websiteLink = document.createElement('a');
                websiteLink.href = job.website;
                websiteLink.textContent = 'Visit';
                websiteLink.target = '_blank';
                websiteLink.style.color = '#2563eb';
                websiteLink.title = job.website;
                websiteCell.appendChild(websiteLink);
            } else {
                websiteCell.textContent = '-';
            }

            setCompactCell(row, job.location);
            setCompactCell(row, hasDetails ? job.areaOfPractice : '');
            setCompactCell(row, hasDetails ? job.position : '');
            setCompactCell(row, hasDetails ? job.salary : '');
            setCompactCell(row, hasDetails ? job.jobType : '');
            setCompactCell(row, hasDetails ? job.experience : '');

            const linkCell = row.insertCell();
            const link = document.createElement('a');
            link.href = job.link;
            link.textContent = 'View Job';
            link.target = '_blank';
            link.title = job.link || 'View Job';
            linkCell.appendChild(link);

            const descCell = row.insertCell();
            if (job.description) {
                const descButton = document.createElement('button');
                descButton.type = 'button';
                descButton.className = 'view-description-btn';
                descButton.textContent = 'View Decription';
                descButton.title = 'View Description';
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

    function refreshRecordsView() {
        const searchTerm = searchInput ? searchInput.value.trim() : '';
        const baseRecords = currentSortColumn
            ? sortRecords(currentSortColumn, currentSortDirection, allJobs)
            : allJobs;

        if (!searchTerm) {
            displayRecords(baseRecords);
            return;
        }

        const term = searchTerm.toLowerCase();
        const filtered = baseRecords.filter(job =>
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

    function deleteSelectedJobs() {
        const selectedCount = selectedJobKeys.size;
        if (selectedCount === 0) return;

        if (!confirm(`Delete ${selectedCount} selected job${selectedCount === 1 ? '' : 's'}?`)) {
            return;
        }

        const nextJobs = allJobs.filter(job => !selectedJobKeys.has(getJobSelectionKey(job)));
        chrome.storage.local.set({ scrapedJobs: nextJobs }, () => {
            allJobs = nextJobs;
            selectedJobKeys.clear();
            refreshRecordsView();
            showToast(`Deleted ${selectedCount} selected job${selectedCount === 1 ? '' : 's'}!`, 'success');
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
                `"${normalizeCoveJobId(job.jobId).replace(/"/g, '""')}"`,
                `"${(job.hospital || '').replace(/"/g, '""')}"`,
                `"${AGGREGATOR_NAME}"`,
                `"${(job.streetAddress || '').replace(/"/g, '""')}"`,
                `"${(job.city || '').replace(/"/g, '""')}"`,
                `"${(job.state || '').replace(/"/g, '""')}"`,
                `"${(job.zipCode || '').replace(/"/g, '""')}"`,
                `"${(job.phone || '').replace(/"/g, '""')}"`,
                `"${(job.website || '').replace(/"/g, '""')}"`,
                `"${(job.location || '').replace(/"/g, '""')}"`,
                `"${(job.areaOfPractice || '').replace(/"/g, '""')}"`,
                `"${(job.position || '').replace(/"/g, '""')}"`,
                `"${(job.salary || '').replace(/"/g, '""')}"`,
                `"${(job.jobType || 'Full-Time').replace(/"/g, '""')}"`,
                `"${(job.experience || '').replace(/"/g, '""')}"`,
                `"${(job.link || '').replace(/"/g, '""')}"`,
                `"${(job.description || '').replace(/"/g, '""')}"`
            ].join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);

        link.setAttribute('href', url);
        link.setAttribute('download', `cov_jobs_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        showToast(`Exported ${allJobs.length} jobs to CSV!`, 'success');
    }

    // Initialize
    chrome.storage.local.get(['scrapedJobs'], (result) => {
        const { normalizedJobs, changed } = normalizeStoredJobIds(result.scrapedJobs || []);
        allJobs = normalizedJobs;
        if (changed) {
            chrome.storage.local.set({ scrapedJobs: allJobs });
        }
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
        selectAllJobsCheckbox.addEventListener('click', (event) => event.stopPropagation());
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

    // Clear details only (area of practice, position, salary, experience)
    const clearDetailsBtn = document.getElementById('clearDetailsBtn');
    clearDetailsBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all job details? This will remove Area of Practice, Position, Salary, Job Type, and Experience from all jobs.')) {
            chrome.storage.local.get(['scrapedJobs'], (data) => {
                const jobs = data.scrapedJobs || [];
                let clearedCount = 0;

                jobs.forEach(job => {
                    if (job.areaOfPractice || job.position || job.salary || job.jobType || job.experience) {
                        job.areaOfPractice = '';
                        job.position = '';
                        job.salary = '';
                        job.jobType = '';
                        job.experience = '';
                        job.detailsFetched = false;
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
                    if (job.city || job.state || job.streetAddress || job.zipCode || job.website || job.phone || job.cityMismatchFlag || job.cityMismatchReason) {
                        job.city = '';
                        job.state = '';
                        job.streetAddress = '';
                        job.zipCode = '';
                        job.website = '';
                        job.phone = '';
                        job.cityMismatchFlag = false;
                        job.cityMismatchReason = '';
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
        const webhookUrl = normalizeWebhookUrl(webhookUrlInput.value);
        webhookUrlInput.value = webhookUrl;

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

        if (isPlaceholderWebhookUrl(webhookUrl)) {
            showToast('Please replace the placeholder webhook URL before sending.', 'error');
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
            job_id: normalizeCoveJobId(job.jobId),
            department_id: normalizeCoveJobId(job.jobId),
            hospital: job.hospital,
            aggregator: AGGREGATOR_NAME,
            street_address: job.streetAddress || '',
            parent_client: AGGREGATOR_NAME,
            city: job.city,
            state: job.state,
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
                source: 'COVE Job Scraper',
                parentClientName: AGGREGATOR_NAME,
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

        // Find jobs that need details (no areaOfPractice, position, or experience)
        // Can work with job title even if no description exists
        const jobsToFetch = jobs.map((job, index) => ({ job, index }))
            .filter(item => {
                if (!item.job.title) return false;
                const description = item.job.description || '';
                const hasNumericSalarySignal = /Salary Range:\s*[^\n]*\$\s*\d/i.test(description) || /\$\s*\d/.test(description);
            const hasShortState = /^[A-Z]{2}$/.test(String(item.job.state || '').trim());
            const needsDetails = !item.job.hospital ||
                !item.job.city ||
                hasShortState ||
                !item.job.areaOfPractice ||
                !item.job.position ||
                !item.job.jobType ||
                !item.job.experience ||
                (!item.job.salary && hasNumericSalarySignal);
            return needsDetails;
        });

        if (jobsToFetch.length === 0) {
            if (confirm('All jobs already have details. Do you want to re-analyze all jobs?')) {
                detailsQueue = jobs.map((job, index) => ({ job, index }))
                    .filter(item => item.job.title);
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

    function buildDetailResultsFromJob(job) {
        const positionTitle = job.title || '';
        const description = job.description || '';
        if (!positionTitle) return [];

        const extracted = extractDetailsFromDescription(positionTitle, description);
        const locations = extracted.locations && extracted.locations.length > 0
            ? extracted.locations
            : [{ city: '', state: '', location: '' }];

        return locations.map(loc => ({
            areaOfPractice: extracted.areaOfPractice,
            position: extracted.position,
            salary: extracted.salary,
            hospitalName: extracted.hospitalName,
            jobType: extracted.jobType,
            experience: extracted.experience,
            description,
            city: loc.city || '',
            state: getFullStateName(loc.state || ''),
            location: loc.location || ''
        }));
    }

    function jobNeedsDescriptionAnalysis(job) {
        if (!job || !job.description || !job.title) return false;
        const stateValue = String(job.state || '').trim();
        return !job.hospital ||
            !job.city ||
            !job.areaOfPractice ||
            !job.position ||
            !job.jobType ||
            /^[A-Z]{2}$/.test(stateValue);
    }

    async function analyzeSavedDescriptionAtIndex(jobIndex) {
        const data = await chrome.storage.local.get(['scrapedJobs']);
        const jobs = data.scrapedJobs || [];
        const job = jobs[jobIndex];
        if (!job) return false;

        const detailsList = buildDetailResultsFromJob(job);
        if (detailsList.length === 0) return false;

        await saveDetailResults(detailsList, jobIndex);
        return true;
    }

    async function analyzeExistingDescriptionsLive() {
        const data = await chrome.storage.local.get(['scrapedJobs']);
        const jobs = data.scrapedJobs || [];
        const jobIds = jobs
            .filter(jobNeedsDescriptionAnalysis)
            .map(job => job.jobId || job.link)
            .filter(Boolean);

        for (const jobKey of jobIds) {
            const latest = await chrome.storage.local.get(['scrapedJobs']);
            const latestJobs = latest.scrapedJobs || [];
            const index = latestJobs.findIndex(job => (job.jobId || job.link) === jobKey);
            if (index === -1 || !jobNeedsDescriptionAnalysis(latestJobs[index])) continue;

            try {
                await analyzeSavedDescriptionAtIndex(index);
            } catch (error) {
                console.error('Error updating saved description details:', error);
            }
        }
    }

    async function processNextDetail() {
        if (currentDetailsIndex >= detailsQueue.length) {
            finishDetailsFetching();
            return;
        }

        const queueItem = detailsQueue[currentDetailsIndex];
        const jobId = queueItem.job.jobId;

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
        const currentIndex = currentJobs.findIndex(j => j.jobId === jobId);

        if (currentIndex === -1) {
            // Job no longer found (shouldn't happen), skip it
            currentDetailsIndex++;
            setTimeout(() => processNextDetail(), 50);
            return;
        }

        const job = currentJobs[currentIndex];
        let detailsList = buildDetailResultsFromJob(job);

        // Extract details locally from job title + already-fetched description
        const positionTitle = job.title || '';
        const description = job.description || '';

        if (positionTitle) {
            const extracted = extractDetailsFromDescription(positionTitle, description);

            // Build detailsList with ALL locations for multi-location jobs
            if (extracted.locations && extracted.locations.length > 0) {
                detailsList = extracted.locations.map(loc => ({
                    areaOfPractice: extracted.areaOfPractice,
                    position: extracted.position,
                    salary: extracted.salary,
                    hospitalName: extracted.hospitalName,
                    jobType: extracted.jobType,
                    experience: extracted.experience,
                    description: description,
                    city: loc.city || '',
                    state: getFullStateName(loc.state || ''),
                    location: loc.location || ''
                }));
            } else {
                // No locations found — still create one entry with details
                detailsList = [{
                    areaOfPractice: extracted.areaOfPractice,
                    position: extracted.position,
                    salary: extracted.salary,
                    hospitalName: extracted.hospitalName,
                    jobType: extracted.jobType,
                    experience: extracted.experience,
                    description: description,
                    city: '',
                    state: '',
                    location: ''
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

                // Step 1: Determine AOP — prefer detail extractor's AOP (from page category), fall back to title
                const hospitalAOP = getAOPFromHospitalName(firstDetail.hospitalName || originalJob.hospital || extractDescriptionField(descText, 'Hospital Name'));
                const titleAOP = getAOPFromTitle(listingTitle);
                let finalAOP = titleAOP ||
                    hospitalAOP ||
                    (hasSpecialtyTrainingSignal(`${listingTitle}\n${descText}`) ? 'Specialty Care' : '') ||
                    detailAOP ||
                    'General Practice Care';

                // Step 2: Match position from listing title
                let finalPosition = getPositionFromTitle(listingTitle) || firstDetail.position || '';

                // Step 3: If listing title had no match but AOP is Specialty, try qualifications from description
                if (!finalPosition && finalAOP === 'Specialty Care') {
                    finalPosition = '';
                }

                // Step 4: Validate position against AOP
                if (finalPosition) {
                    finalPosition = getValidatedPosition(finalPosition, finalAOP);
                }
                if (!finalPosition) {
                    finalPosition = getDefaultPositionForAOP(finalAOP, listingTitle);
                }

                // Step 5: Medical Director override — if title says "Medical Director", keep it
                if ((!finalPosition || finalPosition === 'Associate Veterinarian') && listingTitle.toLowerCase().includes('medical director')) {
                    finalPosition = APPROVED_POSITION_SET.has('Medical Director') ? 'Medical Director' : '';
                }

                if (!APPROVED_POSITION_SET.has(finalPosition)) {
                    finalPosition = '';
                }

                // Update original job with extracted details
                originalJob.areaOfPractice = finalAOP;
                originalJob.position = finalPosition || '';
                originalJob.salary = firstDetail.salary || originalJob.salary || '';
                originalJob.hospital = firstDetail.hospitalName || originalJob.hospital || '';
                originalJob.jobType = firstDetail.jobType || originalJob.jobType || 'Full-Time';
                originalJob.experience = firstDetail.experience || originalJob.experience || '';
                if (firstDetail.city) originalJob.city = firstDetail.city;
                if (firstDetail.state) originalJob.state = getFullStateName(firstDetail.state);
                if (firstDetail.location) originalJob.location = firstDetail.location;
                // Update description if we got a better one
                if (firstDetail.description && firstDetail.description.length > (originalJob.description || '').length) {
                    originalJob.description = firstDetail.description;
                }
                originalJob.detailsFetched = true;

                // Handle multi-location jobs
                if (detailsList.length > 1) {
                    const currentHospital = originalJob.hospital || '';

                    // Check if hospital name already has a city suffix (e.g. "The Oncology Service-Leesburg")
                    // Only swap city suffixes if the pattern exists — don't add suffixes to names that don't have one
                    const baseHospitalMatch = currentHospital.match(/^(.+?)\s*[-–]\s*([^-–]+)$/);
                    const hasCitySuffix = !!baseHospitalMatch;
                    const baseHospitalName = hasCitySuffix ? baseHospitalMatch[1].trim() : '';

                    // Update parent job's hospital name with first location's city (only if it already had a suffix)
                    if (hasCitySuffix) {
                        const firstLocCity = detailsList[0].city || '';
                        if (firstLocCity) {
                            originalJob.hospital = `${baseHospitalName}-${firstLocCity}`;
                        }
                    }

                    originalJob.isNewLocation = true;
                    const newJobs = [];
                    for (let i = 1; i < detailsList.length; i++) {
                        const loc = detailsList[i];
                        const baseJobId = originalJob.jobId.split('-')[0];
                        // Only build city-specific hospital name if the original had a city suffix
                        let childHospital = currentHospital;
                        if (hasCitySuffix) {
                            const childCity = loc.city || '';
                            if (childCity) {
                                childHospital = `${baseHospitalName}-${childCity}`;
                            }
                        }
                        const newJob = {
                            ...originalJob,
                            jobId: `${baseJobId}-${i + 1}`,
                            hospital: childHospital,
                            city: loc.city || '',
                            state: getFullStateName(loc.state || ''),
                            location: loc.location || `${loc.city}, ${loc.state}`,
                            streetAddress: '',
                            zipCode: '',
                            detailsFetched: true,
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
            .replace(/\([^)]*\)/g, ' ')
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

    function parseLocationParts(location) {
        const parts = (location || '').split(',').map(part => part.trim()).filter(Boolean);
        return {
            city: parts[0] || '',
            state: parts.length >= 2 ? parts[1] : ''
        };
    }

    function getSearchLocationForJob(job) {
        const fromLocation = parseLocationParts(job.location || '');
        const city = fromLocation.city || job.city || '';
        const state = fromLocation.state || job.state || '';
        return [city, state].filter(Boolean).join(', ');
    }

    function normalizedLocationPart(value) {
        return (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    function locationEditDistance(a, b) {
        const left = normalizedLocationPart(a);
        const right = normalizedLocationPart(b);
        if (!left || !right) return Number.MAX_SAFE_INTEGER;

        const rows = left.length + 1;
        const cols = right.length + 1;
        const dp = Array.from({ length: rows }, () => Array(cols).fill(0));
        for (let i = 0; i < rows; i++) dp[i][0] = i;
        for (let j = 0; j < cols; j++) dp[0][j] = j;

        for (let i = 1; i < rows; i++) {
            for (let j = 1; j < cols; j++) {
                const cost = left[i - 1] === right[j - 1] ? 0 : 1;
                dp[i][j] = Math.min(
                    dp[i - 1][j] + 1,
                    dp[i][j - 1] + 1,
                    dp[i - 1][j - 1] + cost
                );
            }
        }

        return dp[left.length][right.length];
    }

    function cityLooksLikeProse(value) {
        return /\b(?:nestled|heart|charming|located|serving|community|area|greater|near|outside|region)\b/i.test(value || '') ||
            (value || '').length > 35;
    }

    function cityMatchesLoosely(expectedCity, resultCity) {
        const expected = normalizedLocationPart(expectedCity);
        const result = normalizedLocationPart(resultCity);
        if (!expected || !result) return false;
        if (expected === result) return true;
        if ((expected.length >= 5 && result.length >= 5) && (expected.includes(result) || result.includes(expected))) return true;

        const longer = Math.max(expected.length, result.length);
        const distance = locationEditDistance(expectedCity, resultCity);
        return longer >= 6 && distance <= 2;
    }

    function deriveLikelyCityFromRawText(rawCity) {
        const value = (rawCity || '').trim();
        if (!value || !cityLooksLikeProse(value)) return value;

        const stopWords = new Set(['nestled', 'heart', 'charming', 'located', 'serving', 'community', 'area', 'greater', 'near', 'outside', 'the', 'of', 'in', 'and']);
        const words = value
            .replace(/[^A-Za-z\s.'-]/g, ' ')
            .split(/\s+/)
            .map(word => word.trim())
            .filter(Boolean);

        const cityWords = [];
        for (let i = words.length - 1; i >= 0 && cityWords.length < 3; i--) {
            const word = words[i];
            if (stopWords.has(word.toLowerCase())) break;
            if (!/^[A-Z][A-Za-z.'-]+$/.test(word)) break;
            cityWords.unshift(word);
        }

        return cityWords.length ? cityWords.join(' ') : value;
    }

    function normalizeBusinessNameForCompare(value) {
        return (value || '')
            .toLowerCase()
            .replace(/&/g, ' and ')
            .replace(/\([^)]*\)/g, ' ')
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

    function jobLocationMismatch(job) {
        const expected = parseLocationParts(getSearchLocationForJob(job));
        return !!(
            (expected.city && job.city && normalizedLocationPart(job.city) !== normalizedLocationPart(expected.city)) ||
            (expected.state && job.state && normalizedLocationPart(getFullStateName(job.state)) !== normalizedLocationPart(getFullStateName(expected.state)))
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
            const searchLocation = getSearchLocationForJob(job);
            if (!job.hospital || !searchLocation || !job.streetAddress || !job.zipCode) continue;
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
            rememberAddressData(getAddressCacheKeys(job.hospital, searchLocation), cached);
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
            .filter(item => item.job.hospital);

        if (addressQueue.length === 0) {
            showToast('No jobs have hospital names to fetch address/contact data.', 'error');
            return;
        }

        primeAddressCache(jobs);
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

        async function markAddressNotFound() {
            const data = await chrome.storage.local.get(['scrapedJobs']);
            const jobs = data.scrapedJobs || [];
            if (!jobs[index]) return;

            jobs[index].streetAddress = 'Not Available (TBD)';
            jobs[index].zipCode = '';

            await chrome.storage.local.set({ scrapedJobs: jobs });
            allJobs = jobs;
            displayRecords(allJobs);
        }

        try {
            // Clean hospital name for search:
            // Remove trailing location suffix for child rows: "Hospital-Leesburg" → "Hospital"
            let searchHospital = job.hospital || '';
            if (job.sourceLink && searchHospital) {
                searchHospital = searchHospital.replace(/\s*[-–]\s*[A-Z][a-zA-Z\s.'-]+$/, '').trim();
                if (!searchHospital) searchHospital = job.hospital;
            }

            // Only append "Hospital" when the name does not already look like a veterinary facility.
            if (searchHospital && !/\b(?:hospital|clinic|center|centre|specialists?|specialty|service|services|care|emergency|referral|veterinary|animal|pet)\b/i.test(searchHospital)) {
                searchHospital = searchHospital + ' Hospital';
            }

            // Parse city and state from location field (e.g. "Austin, TX")
            let searchCity = '';
            let searchState = '';
            const effectiveLocation = getSearchLocationForJob(job);
            if (effectiveLocation) {
                const locParts = effectiveLocation.split(',').map(s => s.trim());
                if (locParts.length >= 2) {
                    searchCity = locParts[0];
                    searchState = locParts[1];
                } else if (locParts.length === 1) {
                    searchCity = locParts[0];
                }
            }

            // Build search: "Hospital Name, City, State"
            const searchLocation = [searchCity, searchState].filter(Boolean).join(', ');
            if (!searchCity || !searchState) {
                console.warn(`Skipping address update for "${job.hospital || ''}" because city/state is missing.`);
                await markAddressNotFound();
                currentAddressIndex++;
                setTimeout(() => processNextAddress(), 250);
                return;
            }

            const cleanSearchCity = deriveLikelyCityFromRawText(searchCity);
            const searchLocationCandidates = [];
            const addSearchLocationCandidate = (city, state) => {
                const candidate = [city, state].filter(Boolean).join(', ');
                const key = candidate.toLowerCase();
                if (candidate && !searchLocationCandidates.some(item => item.toLowerCase() === key)) {
                    searchLocationCandidates.push(candidate);
                }
            };
            addSearchLocationCandidate(searchCity, searchState);
            if (cleanSearchCity && normalizedLocationPart(cleanSearchCity) !== normalizedLocationPart(searchCity)) {
                addSearchLocationCandidate(cleanSearchCity, searchState);
            }

            const normalizeLocationValue = (value) => (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const existingLocationMismatch =
                (searchCity && job.city && normalizeLocationValue(job.city) !== normalizeLocationValue(searchCity)) ||
                (searchState && job.state && normalizeLocationValue(getFullStateName(job.state)) !== normalizeLocationValue(getFullStateName(searchState)));

            const cacheKeys = getAddressCacheKeys(searchHospital, searchLocation, job.hospital || '');
            let addressData = getRememberedAddress(cacheKeys);
            if (addressData && needsContactUpdate(job) && (!addressData.website || !addressData.phone)) {
                addressData = null;
            }
            if (addressData) {
                console.log(`Using cached address for "${searchHospital}, ${searchLocation}"`);
            } else {
                for (const candidateLocation of searchLocationCandidates) {
                    addressData = await fetchAddressFromGoogleMaps(searchHospital, candidateLocation, job.hospital || '');
                    if (addressData && addressData.streetAddress) {
                        rememberAddressData(getAddressCacheKeys(searchHospital, candidateLocation, job.hospital || ''), addressData);
                        break;
                    }
                }
                rememberAddressData(cacheKeys, addressData);
            }

            // Update job with address data from Google Maps
            const data = await chrome.storage.local.get(['scrapedJobs']);
            const jobs = data.scrapedJobs || [];

            if (jobs[index]) {
                const foundAddress = !!(addressData && addressData.streetAddress);
                if (foundAddress) {
                    let zipCode = addressData.zipCode || '';
                    if (!zipCode && addressData.fullAddress) {
                        const zipFromFull = addressData.fullAddress.match(/\b(\d{5}(?:-\d{4})?)\b/);
                        if (zipFromFull) zipCode = zipFromFull[1];
                    }

                    jobs[index].streetAddress = addressData.streetAddress || '';
                    const correctedCity = addressData.city || cleanSearchCity || searchCity || '';
                    const correctedState = getFullStateName(addressData.state || searchState || jobs[index].state || '');
                    const correctedLocation = correctedCity && correctedState
                        ? `${correctedCity}, ${getStateAbbreviation(correctedState)}`
                        : (jobs[index].location || '');
                    const cityWasCorrected = !!(
                        addressData.locationCorrected ||
                        addressData.cityMatchedHospitalName ||
                        (correctedCity && normalizedLocationPart(searchCity) !== normalizedLocationPart(correctedCity))
                    );

                    if ((addressData.cityMatchedHospitalName || addressData.locationCorrected) && addressData.city) {
                        jobs[index].city = addressData.city;
                        if (addressData.state) jobs[index].state = getFullStateName(addressData.state);
                    } else {
                        jobs[index].city = correctedCity || jobs[index].city || '';
                        jobs[index].state = correctedState;
                    }
                    if (correctedLocation) jobs[index].location = correctedLocation;
                    jobs[index].cityMismatchFlag = cityWasCorrected || existingLocationMismatch;
                    jobs[index].cityMismatchReason = cityWasCorrected
                        ? `City corrected from "${searchCity}" to "${jobs[index].city}" using Google address`
                        : (existingLocationMismatch ? 'Stored city/state did not match search location' : '');
                    if (!jobs[index].zipCode && zipCode) {
                        jobs[index].zipCode = zipCode;
                    }
                    if (addressData.website) {
                        jobs[index].website = addressData.website;
                    }
                    if (addressData.phone) {
                        jobs[index].phone = addressData.phone;
                    }

                    await chrome.storage.local.set({ scrapedJobs: jobs });

                    // Update display
                    allJobs = jobs;
                    displayRecords(allJobs);
                } else {
                    await markAddressNotFound();
                }
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
