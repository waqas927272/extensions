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

    let currentSortColumn = null;
    let currentSortDirection = 'asc';
    let allJobs = [];
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
        // If it's already a full name (longer than 2 chars), return as is
        if (state.length > 2) return state;
        // Convert abbreviation to full name
        return stateAbbreviations[state.toUpperCase()] || state;
    }

    function getVppJobIdFromLink(link) {
        if (!link) return '';
        try {
            const url = new URL(link);
            const greenhouseId = url.searchParams.get('gh_jid');
            if (greenhouseId) return `VPP-${greenhouseId}`;
        } catch (error) {
            // Fall back to regex parsing below.
        }

        const match = String(link).match(/(?:jobs\/|gh_jid=)(\d+)/);
        return match ? `VPP-${match[1]}` : '';
    }

    function normalizeJobIdsFromLinks(jobs) {
        let changed = false;

        const normalized = (jobs || []).map((job, index) => {
            const cloned = { ...job };
            if (!cloned.title && cloned.jobTitle) {
                cloned.title = cloned.jobTitle;
                changed = true;
            }
            if (!cloned.hospital && cloned.location && !/^[^,]+,\s*[A-Z]{2,}$/i.test(cloned.location.trim())) {
                cloned.hospital = cloned.location;
                changed = true;
            }
            if ((!cloned.location || !/^[^,]+,\s*[A-Z]{2,}$/i.test(cloned.location.trim())) && (cloned.city || cloned.state)) {
                cloned.location = [cloned.city, cloned.state].filter(Boolean).join(', ');
                changed = true;
            }
            const baseJobId = getVppJobIdFromLink(cloned.link);
            if (baseJobId) {
                if (cloned.jobId !== baseJobId || cloned.id !== baseJobId) {
                    cloned.jobId = baseJobId;
                    cloned.id = baseJobId;
                    changed = true;
                }
            } else if (!cloned.jobId) {
                cloned.jobId = `VPP-${index + 1}`;
                cloned.id = cloned.jobId;
                changed = true;
            }
            return cloned;
        });

        return { jobs: normalized, changed };
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
        'Emergency Care': ['Associate Veterinarian'],
        'General Practice Care': ['Associate Veterinarian', 'Lead Veterinarian', 'Medical Director'],
        'Specialty Care': [
            'Anesthesiologist', 'Cardiologist', 'Credentialed Veterinary Technician Specialist',
            'DABVP Specialist', 'Dental Specialist', 'Dermatologist', 'ECC Specialist',
            'Internal Medicine Specialist', 'Medical Director', 'Medical Oncologist',
            'Neurologist & Neurosurgeon', 'Ophthalmologist', 'Radiation Oncologist',
            'Radiologist', 'Surgeon'
        ],
        'Urgent Care': ['Associate Veterinarian', 'Partner Veterinarian']
    };

    function hasSpecialtyTrainingSignal(text) {
        return /\bboard[-\s]+certified\b|\bresidency[-\s]+trained\b|\bresidential[-\s]+trained\b/i.test(text || '');
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

    // Match position from the job listing title â€” this is the authoritative source for position.
    // The listing title (e.g. "Veterinary Cardiologist") is always more specific than
    // generic detail page content, so we use it as the primary position signal.
    function getPositionFromTitle(title) {
        const t = (title || '').toLowerCase();

        // === HIGHEST PRIORITY: Leadership positions ===
        // "Group Medical Director - The Oncology Service" â†’ Medical Director, NOT Medical Oncologist
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
        const isVetRoleTitle = /\b(veterinarian|vet|dvm)\b/.test(t) &&
            !/\b(?:technician|assistant|instructor|swim|manager|reception|client|coordinator|attendant|kennel)\b/.test(t);

        if (aopParts.includes('Urgent Care') && (t.includes('partner veterinarian') || t.includes('partner vet'))) {
            return 'Partner Veterinarian';
        }

        if (isVetRoleTitle && aopParts.some(part => ['General Practice Care', 'Emergency Care', 'Urgent Care'].includes(part))) {
            return 'Associate Veterinarian';
        }

        return '';
    }

    function getFallbackPositionForTitle(title) {
        const t = (title || '').toLowerCase();
        if (t.includes('medical director')) return 'Medical Director';
        if (t.includes('lead veterinarian') || t.includes('lead vet')) return 'Lead Veterinarian';
        if (/\b(veterinarian|vet|dvm)\b/.test(t)) return 'Associate Veterinarian';
        return '';
    }

    function getFallbackPositionFromNonVetTitle(title) {
        const normalized = (title || '').replace(/\s+/g, ' ').trim();
        if (!normalized) return '';
        const lower = normalized.toLowerCase();
        const isNonVetSupportTitle = /\b(?:technician|assistant|instructor|swim|manager|reception|client|coordinator|attendant|kennel)\b/.test(lower) &&
            !/\b(?:veterinarian|dvm)\b/.test(lower);
        return isNonVetSupportTitle ? normalized : '';
    }

    function isGeneralVeterinarianTitle(title) {
        const t = (title || '').toLowerCase();
        if (!/\b(veterinarian|vet|dvm)\b/.test(t)) return false;
        return getAOPFromTitle(title) !== 'Specialty Care';
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

        // Urgent Care â€” check before Emergency since "urgent care" is more specific
        if (t.includes('urgent care')) return 'Urgent Care';

        // Emergency
        if (t.includes('emergency') || t.match(/\ber\b/) || t.includes('er vet') || t.includes('er dvm')) return 'Emergency Care';

        // Equine/Bovine/Exotics
        if (t.includes('equine') || t.includes('bovine') || t.includes('large animal') ||
            t.includes('avian') || t.includes('exotics')) return 'General Practice Care / Emergency Care / Urgent Care';

        return '';
    }

    // ============ LOCAL DETAIL EXTRACTION (mirrors detail-extractor.js) ============

    function extractDetailsFromDescription(positionTitle, descriptionText) {
        // Format salary to standard "$X-$Y per year" or "$X-$Y per Hour"
        function formatSalary(raw) {
            if (!raw) return '';
            raw = raw.replace(/\b\d+(?:\.\d+)?\s*%/g, '');
            const isHourly = /(?:per\s*)?(?:hour|hr)\b|\/(?:hour|hr)\b/i.test(raw);
            const amounts = [];
            const amountRegex = /\$([\d,]+(?:\.\d{2})?)\s*k?\b/gi;
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
            const unit = isHourly ? 'per Hour' : 'per year';
            if (amounts.length >= 2) {
                const min = Math.min(amounts[0], amounts[1]);
                const max = Math.max(amounts[0], amounts[1]);
                return `${fmt(min)}-${fmt(max)} ${unit}`;
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
            const normalizedText = text
                .replace(/\u00a0/g, ' ')
                .replace(/[\u2013\u2014]/g, '-')
                .replace(/Ã¢â‚¬â€œ|Ã¢â‚¬â€/g, '-');

            const salaryPatterns = [
                /(?:salary|compensation|pay|base\s+salary)[^\n]{0,140}?\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\+?\s*(?:-|to|and)\s*\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\+?(?:[^\n]{0,80})?/i,
                /(?:salary|compensation|pay|base\s+salary)\s*[:\-]?\s*[^\n]{0,60}?\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\+?(?:[^\n]{0,80})?/i,
                // "Base salary ranges: $150k - $171k" or "base salary range of $140,000 â€“ 160,000"
                /(?:base\s+salary\s*(?:ranges?)?)\s*(?:of|from|is|:)\s*\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s*[-â€“â€”]\s*\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?/i,
                /(?:base\s+salary\s*(?:ranges?)?)\s*(?:of|from|is|:)\s*\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s+to\s+\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?/i,
                // "Pay range: $95,000 - $160,000" or "Salary range: $120,000 - $140,000"
                /(?:(?:pay|salary|compensation)\s+range)\s*(?:of|from|is|:)\s*\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s*[-â€“â€”]\s*\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?/i,
                /(?:(?:pay|salary|compensation)\s+range)\s*(?:of|from|is|:)\s*\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s+to\s+\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?/i,
                // "Salary: $130,000-$200,000" or "Compensation: $110,000 to $180,000"
                /(?:salary|compensation|pay)[:\s]+\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s*[-â€“â€”]\s*\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?(?:\s*(?:per\s+)?(?:year|annually|annum|annual))?/i,
                /(?:salary|compensation|pay)[:\s]+\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s+to\s+\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?(?:\s*(?:per\s+)?(?:year|annually|annum|annual))?/i,
                // "$125 to $185/hour" or "$12-$16 per hour"
                /\$[\d,]+(?:\.\d{2})?\s*(?:-|to)\s*\$?[\d,]+(?:\.\d{2})?\s*(?:\/hour|\/hr|per\s+hour|hr)\+?/i,
                // "$130,000-$200,000" or "$130,000 to $200,000"
                /\$[\d,]+(?:\.\d{2})?\s*[-â€“â€”]\s*\$[\d,]+(?:\.\d{2})?/i,
                /\$[\d,]+(?:\.\d{2})?\s+to\s+\$[\d,]+(?:\.\d{2})?/i,
                // "$150k - $171k" or "$165 to $185/k"
                /\$[\d,]+\s*(?:\/k|k)\s*[-â€“â€”]+\s*\$?[\d,]+\s*(?:\/k|k)/i,
                /\$[\d,]+\s*(?:\/k|k)?\s+to\s+\$?[\d,]+\s*(?:\/k|k)/i,
                // "earn $250,000 annually"
                /(?:earn|earning)\s+\$[\d,]+(?:\.\d{2})?\s*(?:annually|per\s*year)?/i,
                // "$250,000 annually" or "$250,000 per year"
                /\$[\d,]+(?:\.\d{2})?\s*(?:annually|per\s*year|per\s*annum)/i,
                // "$95 per hour" or "$95/hr"
                /\$[\d,]+(?:\.\d{2})?\s*(?:per\s+)?(?:hour|hr|\/hour|\/hr)/i,
            ];
            for (const pattern of salaryPatterns) {
                const m = normalizedText.match(pattern);
                if (m) {
                    const salaryText = m[0].trim();
                    if (!/\$[\d,]+/.test(salaryText)) continue;
                    return formatSalary(salaryText);
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
            const isMedicalDirector = /\bmedical director\b/i.test(positionText);
            if (isMedicalDirector) {
                return getAOPFromTitle(positionText) === 'Specialty Care' ? 'Specialty Care' : 'General Practice Care';
            }
            const titleAOP = getAOPFromTitle(positionText);

            if (titleAOP === 'Urgent Care' || titleAOP === 'Emergency Care') return titleAOP;
            if (!isGeneralVeterinarianTitle(positionText) && hasSpecialtyTrainingSignal(descriptionText)) return 'Specialty Care';
            if (isGeneralVeterinarianTitle(positionText)) {
                const earlyText = descriptionText
                    .split(/\n\s*Create a Job Alert\s*\n/i)[0]
                    .substring(0, 2500)
                    .toLowerCase();
                if (earlyText.includes('urgent care')) return 'Urgent Care';
                if (/\bemergency\b|\ber\/urgent care\b/.test(earlyText)) return 'Emergency Care';
                if (earlyText.includes('general practice')) return 'General Practice Care';
            }

            // STEP 0: Title-specific overrides â€” these are MORE specific than Jobvite categories.
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

            // STEP 4: Check TITLE for equine/bovine/large animal/avian/exotics
            if (title.includes('equine') || title.includes('bovine') || title.includes('large animal') ||
                title.includes('avian') || title.includes('exotics')) {
                return 'General Practice Care / Emergency Care / Urgent Care';
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
            // Must be checked FIRST â€” "Group Medical Director - The Oncology Service" should be
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
                'Emergency Care': ['Associate Veterinarian'],
                'General Practice Care': ['Associate Veterinarian', 'Lead Veterinarian', 'Medical Director'],
                'Specialty Care': [
                    'Anesthesiologist', 'Cardiologist', 'Credentialed Veterinary Technician Specialist',
                    'DABVP Specialist', 'Dental Specialist', 'Dermatologist', 'ECC Specialist',
                    'Internal Medicine Specialist', 'Medical Director', 'Medical Oncologist',
                    'Neurologist & Neurosurgeon', 'Ophthalmologist', 'Radiation Oncologist',
                    'Radiologist', 'Surgeon'
                ],
                'Urgent Care': ['Associate Veterinarian', 'Partner Veterinarian'],
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

            // Completely unknown AOP â€” still validate against all known positions
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

            const STATE_KEYWORDS = [
                { code: 'AL', names: ['AL', 'Alabama'] }, { code: 'AK', names: ['AK', 'Alaska'] },
                { code: 'AZ', names: ['AZ', 'Arizona'] }, { code: 'AR', names: ['AR', 'Arkansas'] },
                { code: 'CA', names: ['CA', 'California'] }, { code: 'CO', names: ['CO', 'Colorado'] },
                { code: 'CT', names: ['CT', 'Connecticut'] }, { code: 'DE', names: ['DE', 'Delaware'] },
                { code: 'FL', names: ['FL', 'Florida'] }, { code: 'GA', names: ['GA', 'Georgia'] },
                { code: 'HI', names: ['HI', 'Hawaii'] }, { code: 'ID', names: ['ID', 'Idaho'] },
                { code: 'IL', names: ['IL', 'Illinois'] }, { code: 'IN', names: ['IN', 'Indiana'] },
                { code: 'IA', names: ['IA', 'Iowa'] }, { code: 'KS', names: ['KS', 'Kansas'] },
                { code: 'KY', names: ['KY', 'Kentucky'] }, { code: 'LA', names: ['LA', 'Louisiana'] },
                { code: 'ME', names: ['ME', 'Maine'] }, { code: 'MD', names: ['MD', 'Maryland'] },
                { code: 'MA', names: ['MA', 'Massachusetts'] }, { code: 'MI', names: ['MI', 'Michigan'] },
                { code: 'MN', names: ['MN', 'Minnesota'] }, { code: 'MS', names: ['MS', 'Mississippi'] },
                { code: 'MO', names: ['MO', 'Missouri'] }, { code: 'MT', names: ['MT', 'Montana'] },
                { code: 'NE', names: ['NE', 'Nebraska'] }, { code: 'NV', names: ['NV', 'Nevada'] },
                { code: 'NH', names: ['NH', 'New Hampshire'] }, { code: 'NJ', names: ['NJ', 'New Jersey'] },
                { code: 'NM', names: ['NM', 'New Mexico'] }, { code: 'NY', names: ['NY', 'New York'] },
                { code: 'NC', names: ['NC', 'North Carolina'] }, { code: 'ND', names: ['ND', 'North Dakota'] },
                { code: 'OH', names: ['OH', 'Ohio'] }, { code: 'OK', names: ['OK', 'Oklahoma'] },
                { code: 'OR', names: ['OR', 'Oregon'] }, { code: 'PA', names: ['PA', 'Pennsylvania'] },
                { code: 'RI', names: ['RI', 'Rhode Island'] }, { code: 'SC', names: ['SC', 'South Carolina'] },
                { code: 'SD', names: ['SD', 'South Dakota'] }, { code: 'TN', names: ['TN', 'Tennessee'] },
                { code: 'TX', names: ['TX', 'Texas'] }, { code: 'UT', names: ['UT', 'Utah'] },
                { code: 'VT', names: ['VT', 'Vermont'] }, { code: 'VA', names: ['VA', 'Virginia'] },
                { code: 'WA', names: ['WA', 'Washington'] }, { code: 'WV', names: ['WV', 'West Virginia'] },
                { code: 'WI', names: ['WI', 'Wisconsin'] }, { code: 'WY', names: ['WY', 'Wyoming'] },
                { code: 'DC', names: ['DC', 'D.C.', 'District of Columbia', 'Washington, D.C.'] }
            ];

            const CITY_KEYWORDS = [
                'Atlanta', 'Mesa', 'Arlington', 'Centreville', 'Washington', 'Indianapolis', 'Annapolis',
                'Belton', 'Bangor', 'Charleston', 'Richmond', 'Fenton', 'Dunedin', 'Blythewood',
                'South Burlington', 'East Hampton', 'East Meadow', 'Manchester', 'Columbia', 'Bel Air',
                'Hopewell Junction', 'Locust Grove', 'Warrenville', 'Wildwood', 'Los Angeles', 'Ventura',
                'Hendersonville', 'Leesburg', 'Hudson', 'Knoxville', 'Franklin', 'Aurora', 'Redlands',
                'Humble', 'Bradenton', 'Fairfax', 'Falls Church', 'Temple', 'New York'
            ];

            const isLikelyLocationCity = (value) => {
                const city = (value || '').trim();
                if (!city) return false;
                if (city.length < 2 || city.length > 40) return false;
                if (/\d/.test(city)) return false;
                if (/\b(?:description|position|associate|veterinarian|veterinary|hospital|care|center|clinic|location|owner|opportunity|partnership|practice|director|internist)\b/i.test(city)) {
                    return false;
                }
                return /^[A-Za-z .'-]+$/.test(city);
            };

            const findStateFromKeywords = (value) => {
                const textValue = ` ${(value || '').toLowerCase()} `;
                for (const state of STATE_KEYWORDS) {
                    for (const name of state.names) {
                        const escaped = name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const pattern = new RegExp(`\\b${escaped}\\b`, 'i');
                        if (pattern.test(textValue)) return state.code;
                    }
                }
                return '';
            };

            const findCityFromKeywords = (value) => {
                const textValue = ` ${(value || '')} `;
                const sortedCities = [...CITY_KEYWORDS].sort((a, b) => b.length - a.length);
                for (const city of sortedCities) {
                    const escaped = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const pattern = new RegExp(`\\b${escaped}\\b`, 'i');
                    if (pattern.test(textValue)) return city;
                }
                return '';
            };

            const extractLocationFromKeywordLine = (value) => {
                const city = findCityFromKeywords(value);
                const state = findStateFromKeywords(value);
                if (!city || !state) return null;
                if (!isLikelyLocationCity(city)) return null;
                return { city, state, location: `${city}, ${state}` };
            };

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
                        if (isLikelyLocationCity(city)) {
                            locations.push({ city, state, location: `${city}, ${state}` });
                        }
                    }
                    const keywordLoc = extractLocationFromKeywordLine(trimmed);
                    if (keywordLoc) {
                        locations.push(keywordLoc);
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
                    city = city.split('\n').map(part => part.trim()).filter(Boolean).pop() || city;
                    const state = match[2].trim();

                    if (isLikelyLocationCity(city)) {
                        locations.push({ city, state, location: `${city}, ${state}` });
                    }
                }

                // Keyword fallback: parse from "Location: ..." sentence blocks
                const locationLine = text.match(/\bLocation\s*:\s*([^\n]+)/i);
                if (locationLine && locationLine[1]) {
                    const keywordLoc = extractLocationFromKeywordLine(locationLine[1]);
                    if (keywordLoc) {
                        locations.push(keywordLoc);
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

        function extractAddress(text) {
            if (!text) return {};

            const normalized = text
                .replace(/\u00a0/g, ' ')
                .replace(/[\u2013\u2014]/g, '-')
                .replace(/Ã¢â‚¬â€œ|Ã¢â‚¬â€/g, '-');

            const stateFullToCode = {
                alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
                colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
                hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
                kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
                massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO',
                montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
                'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
                ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
                'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
                vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
                wyoming: 'WY', 'district of columbia': 'DC', 'd.c.': 'DC', dc: 'DC'
            };
            const stateNamePattern = '(?:Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming|District of Columbia)';
            const streetTokenRegex = /\b(?:st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|way|ct|court|pl|place|pkwy|parkway|hwy|highway|cir|circle|trl|trail|loop|pike|turnpike|route|broadway)\b/i;
            const fillerWordRegex = /\b(?:schedule|insurance|benefits|opportunity|ownership|partnership|practice|veterinary|hospital|clinic|doctor|ratio|allowance|supports|operational)\b/i;

            function normalizeStateToken(rawState) {
                const cleaned = (rawState || '')
                    .trim()
                    .replace(/\./g, '')
                    .replace(/\s+/g, ' ');
                if (!cleaned) return '';
                const upper = cleaned.toUpperCase();
                if (/^[A-Z]{2}$/.test(upper)) return upper;
                const mapped = stateFullToCode[cleaned.toLowerCase()];
                return mapped || cleaned;
            }

            function cleanAddressCandidate(value) {
                let cleaned = (value || '')
                    .replace(/[\uE000-\uF8FF]/g, ' ')
                    .replace(/^(?:location|locations|address)\s*:\s*/i, '')
                    .replace(/^[^\d:]{2,80}:\s*(?=\d{1,6}\b)/, '')
                    .replace(/\s+/g, ' ')
                    .replace(/\s*[-–—]\s*(?:Tenleytown|Clarendon|Centreville)\b/gi, '')
                    .replace(/\bCaring Hands Animal Hospital.*$/i, '')
                    .replace(/\b(?:area schedule that respects your time|schedule that respects your time|strong staff-to-doctor ratio|health, dental, and vision insurance|employer retirement plan contribution|generous pto|annual ce allowance|relocation assistance|ownership and partnership with vpp|veterinary practice partners supports)\b.*$/i, '')
                    .replace(/\s+(?:is hiring|is seeking|join\b|what to expect\b|requirements?:\b|about\b).*$/i, '')
                    .trim();

                // Keep only address-like lead content when the ZIP follows a state, not a house number.
                const tailZipCut = cleaned.match(new RegExp(`^(.*?(?:,\\s*|\\s+)(?:[A-Z]{2}|D\\.?\\s*C\\.?|${stateNamePattern})[,\\s]+\\d{5}(?:-\\d{4})?\\b)`, 'i'));
                if (tailZipCut) cleaned = tailZipCut[1].trim();
                return cleaned;
            }

            function isLikelyCityToken(value) {
                const city = (value || '').trim();
                if (!city) return false;
                if (city.length > 40) return false;
                if (/\d/.test(city)) return false;
                if (streetTokenRegex.test(city)) return false;
                if (fillerWordRegex.test(city)) return false;
                return /^[A-Za-z .'-]+$/.test(city);
            }

            function sanitizeStreet(street) {
                const value = (street || '').replace(/[\uE000-\uF8FF]/g, ' ').replace(/\s+/g, ' ').trim();
                if (!value) return '';
                if (value.length > 120) return '';
                if (/^\d+$/.test(value)) return '';
                if (fillerWordRegex.test(value)) return '';
                const hasNumber = /\d/.test(value);
                const hasStreetToken = streetTokenRegex.test(value);
                const alphaWords = (value.match(/[A-Za-z]+/g) || []).length;
                if (!hasStreetToken && (!hasNumber || alphaWords < 2)) return '';
                return value.replace(/,\s*$/g, '');
            }

            function normalizeZip(zipCode) {
                const z = (zipCode || '').trim();
                if (!z) return '';
                if (/^\d{5}(?:-\d{4})?$/.test(z)) return z;
                return '';
            }

            function buildAddressResult(street, city, state, zipCode) {
                const normalizedCity = (city || '').trim();
                const normalizedState = normalizeStateToken(state || '');
                const normalizedZip = normalizeZip(zipCode);
                const normalizedStreet = sanitizeStreet(street);

                if (!isLikelyCityToken(normalizedCity)) return {};
                if (!/^[A-Z]{2}$/.test((normalizedState || '').toUpperCase())) return {};
                if (!normalizedStreet) return {};

                return {
                    streetAddress: normalizedStreet,
                    city: normalizedCity,
                    state: normalizedState.toUpperCase(),
                    zipCode: normalizedZip,
                    location: `${normalizedCity}, ${normalizedState.toUpperCase()}`
                };
            }

            function parseAddressCandidate(candidateRaw) {
                const candidate = cleanAddressCandidate(candidateRaw);
                if (!candidate) return {};

                // Addresses with suite/unit commas: "Street, Suite 100, City, ST 12345"
                const commaParts = candidate.split(',').map(part => part.trim()).filter(Boolean);
                if (commaParts.length >= 3) {
                    const stateZip = commaParts[commaParts.length - 1].match(/^([A-Z]{2}|D\.?\s*C\.?|[A-Za-z][A-Za-z\s.'-]+)\s+(\d{5}(?:-\d{4})?)\b/i);
                    if (stateZip) {
                        const result = buildAddressResult(
                            commaParts.slice(0, -2).join(', '),
                            commaParts[commaParts.length - 2],
                            stateZip[1],
                            stateZip[2]
                        );
                        if (result.streetAddress) return result;
                    }
                }

                // Street, City, ST 12345
                let match = candidate.match(/^(.+?),\s*([^,]+?),\s*([A-Z]{2}|D\.?\s*C\.?)\s*(\d{5}(?:-\d{4})?)\b/i);
                if (match) {
                    const result = buildAddressResult(match[1], match[2], match[3], match[4]);
                    if (result.streetAddress) return result;
                }

                // Street, City ST 12345 (missing comma before state)
                match = candidate.match(/^(.+?),\s*([A-Za-z][A-Za-z\s.'-]+?)\s+([A-Z]{2}|D\.?\s*C\.?)\s*(\d{5}(?:-\d{4})?)\b/i);
                if (match) {
                    const result = buildAddressResult(match[1], match[2], match[3], match[4]);
                    if (result.streetAddress) return result;
                }

                // Street, City, FullState 12345
                match = candidate.match(new RegExp(`^(.+?),\\s*([^,]+?),\\s*(${stateNamePattern})\\s*(\\d{5}(?:-\\d{4})?)?\\b`, 'i'));
                if (match) {
                    const result = buildAddressResult(match[1], match[2], match[3], match[4] || '');
                    if (result.streetAddress) return result;
                }

                // Street City, FullState, 12345
                match = candidate.match(new RegExp(`^(.+?\\b(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Trl|Trail|Loop|Pike|Turnpike|Route|Broadway)\\.?(?:\\s+(?:N|S|E|W|NE|NW|SE|SW|N\\.W\\.|N\\.E\\.|S\\.W\\.|S\\.E\\.))?)\\s+([A-Za-z][A-Za-z\\s.'-]+),\\s*(${stateNamePattern}),\\s*(\\d{5}(?:-\\d{4})?)\\b`, 'i'));
                if (match) {
                    const result = buildAddressResult(match[1], match[2], match[3], match[4]);
                    if (result.streetAddress) return result;
                }

                // Street City, ST 12345 (no comma between street and city)
                match = candidate.match(/^(.+?\b(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Trl|Trail|Loop|Pike|Turnpike|Route|Broadway)\.?(?:\s+(?:N|S|E|W|NE|NW|SE|SW|N\.W\.|N\.E\.|S\.W\.|S\.E\.))?)\s+([A-Za-z][A-Za-z\s.'-]+),\s*([A-Z]{2}|D\.?\s*C\.?)\s*(\d{5}(?:-\d{4})?)?\b/i);
                if (match) {
                    const result = buildAddressResult(match[1], match[2], match[3], match[4] || '');
                    if (result.streetAddress) return result;
                }

                // Street Washington, D.C. without zip
                match = candidate.match(/^(.+?\b(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Trl|Trail|Loop|Pike|Turnpike|Route|Broadway)\.?(?:\s+(?:N|S|E|W|NE|NW|SE|SW|N\.W\.|N\.E\.|S\.W\.|S\.E\.))?)\s+(Washington),\s*(D\.?\s*C\.?)\b/i);
                if (match) {
                    const result = buildAddressResult(match[1], match[2], match[3], '');
                    if (result.streetAddress) return result;
                }

                // Street, City, ST (zip missing)
                match = candidate.match(/^(.+?),\s*([^,]+?),\s*([A-Z]{2}|D\.?\s*C\.?)\b/i);
                if (match) {
                    const result = buildAddressResult(match[1], match[2], match[3], '');
                    if (result.streetAddress) return result;
                }

                return {};
            }

            const candidates = [];
            const lines = normalized.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

            const locationLineMatch = normalized.match(/\bLocation\s*:\s*([^\n]+)/i);
            if (locationLineMatch && locationLineMatch[1]) candidates.push(locationLineMatch[1].trim());

            const locationsLineMatch = normalized.match(/\bLocations\s*:\s*([^\n]+)/i);
            if (locationsLineMatch && locationsLineMatch[1]) candidates.push(locationsLineMatch[1].trim());

            const pinMatch = normalized.match(/📍\s*([^\n]+)/i);
            if (pinMatch && pinMatch[1]) candidates.push(pinMatch[1].trim());

            const addressSubstringPatterns = [
                /\b\d{1,6}\s+[A-Za-z0-9 .'-]+?\b(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Trl|Trail|Loop|Pike|Turnpike|Route|Broadway)\.?(?:\s+(?:N|S|E|W|NE|NW|SE|SW|N\.W\.|N\.E\.|S\.W\.|S\.E\.))?(?:,\s*(?:Suite|Ste|Unit|Building|Bldg|#)\s*[A-Za-z0-9-]+)?\s*,\s*[A-Za-z][A-Za-z\s.'-]+,\s*(?:[A-Z]{2}|D\.?\s*C\.?)\s+\d{5}(?:-\d{4})?\b/gi,
                new RegExp(`\\b\\d{1,6}\\s+[A-Za-z0-9 .'-]+?\\b(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Trl|Trail|Loop|Pike|Turnpike|Route|Broadway)\\.?(?:\\s+(?:N|S|E|W|NE|NW|SE|SW|N\\.W\\.|N\\.E\\.|S\\.W\\.|S\\.E\\.))?\\s+[A-Za-z][A-Za-z\\s.'-]+,\\s*${stateNamePattern},\\s*\\d{5}(?:-\\d{4})?\\b`, 'gi'),
                /\b\d{1,6}\s+[A-Za-z0-9 .'-]+?\b(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Trl|Trail|Loop|Pike|Turnpike|Route|Broadway)\.?(?:\s+(?:N|S|E|W|NE|NW|SE|SW|N\.W\.|N\.E\.|S\.W\.|S\.E\.))?\s+[A-Za-z][A-Za-z\s.'-]+,\s*(?:[A-Z]{2}|D\.?\s*C\.?)\s+\d{5}(?:-\d{4})?\b/gi,
                /\b\d{1,6}\s+[A-Za-z0-9 .'-]+?\b(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Trl|Trail|Loop|Pike|Turnpike|Route|Broadway)\.?(?:\s+(?:N|S|E|W|NE|NW|SE|SW|N\.W\.|N\.E\.|S\.W\.|S\.E\.))?\s+Washington,\s*D\.?\s*C\.?/gi
            ];
            for (const pattern of addressSubstringPatterns) {
                for (const match of normalized.matchAll(pattern)) {
                    candidates.push(match[0]);
                }
            }

            for (const line of lines) {
                if (/^(?:location|address)\s*:/i.test(line)) {
                    candidates.push(line.replace(/^(?:location|address)\s*:\s*/i, '').trim());
                } else if (/\b\d{5}(?:-\d{4})?\b/.test(line) && /\b(?:[A-Z]{2}|D\.?\s*C\.?|District of Columbia)\b/.test(line)) {
                    candidates.push(line);
                } else if (/\b\d{1,6}\s+[A-Za-z0-9 .'-]+\b(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Trl|Trail|Loop|Pike|Turnpike|Route|Broadway)\b/i.test(line)) {
                    candidates.push(line);
                }
            }

            for (const candidate of candidates) {
                const parsed = parseAddressCandidate(candidate);
                if (parsed.streetAddress) return parsed;
            }

            return {};
        }

        // Extract hospital name from stored description (which now includes JSON-LD data)
        function extractHospitalName(text) {
            // First try to extract from structured JSON-LD data in the text
            const hiringOrgMatch = text.match(/Hiring Organization:\s*([^\n]+)/i);
            if (hiringOrgMatch) {
                return hiringOrgMatch[1].trim();
            }

            // Greenhouse popup pattern: "<Hospital Name> is hiring ..."
            const hiringSentenceMatch = text.match(/([A-Z][\w&'().\/\-\s]{2,}?(?:Animal\s+Hospital|Veterinary\s+(?:Hospital|Center|Clinic|Care|Specialists?|Medical\s+Group)|Pet\s+(?:Hospital|Clinic|Care)|Emergency\s+(?:Hospital|Center|Clinic)|The\s+[A-Z][\w\s]+Service)(?:\s*[-–—]\s*[A-Za-z0-9 .'-]+)?)(?:\s+(?:in|at)\s+[A-Za-z0-9 .'-]+)?\s+is hiring\b/i);
            if (hiringSentenceMatch) {
                return hiringSentenceMatch[1].replace(/\s+/g, ' ').trim();
            }

            // Try to find "Position at [Hospital Name]"
            const positionAtMatch = text.match(/Position at\s+((?:[\w'.&-]+\s+){1,8}(?:Animal\s+Hospital|Veterinary\s+(?:Hospital|Center|Clinic|Care|Specialists?)|Pet\s+(?:Hospital|Clinic|Care)|Emergency\s+(?:Hospital|Center|Clinic)|The\s+[A-Z][\w\s]+Service))/i);
            if (positionAtMatch) {
                return positionAtMatch[1].trim();
            }

            // Try to find hospital name from description
            const hospitalMatch = text.match(/at\s+((?:[\w'.&-]+\s+){1,5}(?:Animal\s+Hospital|Veterinary\s+(?:Hospital|Center|Clinic|Care|Specialists?)|Pet\s+(?:Hospital|Clinic|Care)|Emergency\s+(?:Hospital|Center|Clinic)|The\s+[A-Z][\w\s]+Service))\b/i);
            if (hospitalMatch) {
                return hospitalMatch[1].trim();
            }

            return '';
        }

        // Extract job type from description
        // Rules: "part time or full time" / "full time or part time" â†’ Full-Time
        //        only "part time" / "part-time" mentioned â†’ Part-Time
        //        nothing mentioned or only "full time" â†’ Full-Time (default)
        function extractJobType(text) {
            if (!text) return 'Full-Time';
            const lower = text.toLowerCase();

            // First check the structured Employment Type field from JSON-LD
            const empTypeMatch = lower.match(/employment type:\s*([^\n]+)/i);
            if (empTypeMatch) {
                const empType = empTypeMatch[1].trim().toLowerCase();
                // "Part Time or Full Time" â†’ Full-Time (both mentioned = full time)
                if (empType.includes('part') && empType.includes('full')) return 'Full-Time';
                // "Part-Time" or "Part Time" only â†’ Part-Time
                if (empType.includes('part')) return 'Part-Time';
                // "Full-Time" or anything else â†’ Full-Time
                return 'Full-Time';
            }

            // Fallback: check the description body text
            const hasPartTime = /\bpart[\s-]?time\b/i.test(lower);
            const hasFullTime = /\bfull[\s-]?time\b/i.test(lower);

            // Both mentioned â†’ Full-Time
            if (hasPartTime && hasFullTime) return 'Full-Time';
            // Only part time mentioned â†’ Part-Time
            if (hasPartTime) return 'Part-Time';
            // Only full time or nothing mentioned â†’ Full-Time
            return 'Full-Time';
        }

        function extractExperience(text) {
            if (!text) return '';

            const analysisText = text
                .replace(/\u00a0/g, ' ')
                .replace(/[\u2013\u2014]/g, '-')
                .replace(/Ã¢â‚¬â€œ|Ã¢â‚¬â€/g, '-')
                .split(/\n\s*Create a Job Alert\s*\n/i)[0];
            const yearToken = '(?:years?|yrs?\\.?)';
            const candidateLines = [];
            const qualificationsSection = extractQualificationsSection(analysisText);

            if (qualificationsSection) {
                candidateLines.push(...qualificationsSection.split('\n'));
            }
            candidateLines.push(...analysisText.split('\n'));

            const prioritizedLines = candidateLines
                .map(line => line.trim())
                .filter(Boolean)
                .filter(line => /\b(?:experience|experienced|minimum|min\.?|at least|required|requirements?|qualifications?|practice setting|years in practice|new grads?|new graduates?|new graduate|recent graduates?|recent graduate|new doctors?|mentorship)\b/i.test(line))
                .filter(line => !/\b(?:our team has|over\s+\d+\s+years of experience|years of experience in specialty and emergency services|serving\s+the\s+community|we offer|benefits|medical(?:,\s*|\s+)dental)\b/i.test(line));

            const patterns = [
                new RegExp(`\\bexperienced\\s*\\(?\\s*(\\d+)\\+?\\s*${yearToken}\\s*\\)?`, 'i'),
                new RegExp(`\\bwith\\s+minimum\\s+of\\s+(\\d+)\\+?\\s*${yearToken}\\s+post[-\\s]+internship\\s+experience\\b`, 'i'),
                new RegExp(`\\b(?:minimum\\s+of\\s*)?(\\d+)\\+?\\s*${yearToken}\\s+(?:of\\s+)?(?:small\\s+animal\\s+|post[-\\s]+internship\\s+|clinical\\s+|veterinary\\s+)?experience\\b`, 'i'),
                new RegExp(`\\b(\\d+)\\s*[-â€“â€”]\\s*(\\d+)\\s*${yearToken}\\s+(?:of\\s+)?experience\\b`, 'i'),
                new RegExp(`\\b(\\d+)\\s+to\\s+(\\d+)\\s*${yearToken}\\s+(?:of\\s+)?experience\\b`, 'i'),
                new RegExp(`\\bexperience\\s+(?:should\\s+be|must\\s+be|is|of|required(?:\\s+is)?|requires|:)?\\s*(\\d+)\\s*[-â€“â€”]\\s*(\\d+)\\s*${yearToken}\\b`, 'i'),
                new RegExp(`\\bexperience\\s+(?:should\\s+be|must\\s+be|is|of|required(?:\\s+is)?|requires|:)?\\s*(\\d+)\\s+to\\s+(\\d+)\\s*${yearToken}\\b`, 'i'),
                new RegExp(`\\b(?:minimum|min\\.?|at\\s+least)\\s+(\\d+)\\s*[-â€“â€”]\\s*(\\d+)\\s*${yearToken}\\b`, 'i'),
                new RegExp(`\\b(\\d+)\\+?\\s*${yearToken}\\s+(?:of\\s+)?experience\\b`, 'i'),
                new RegExp(`\\bexperience\\s+(?:should\\s+be|must\\s+be|is|of|required(?:\\s+is)?|requires|:)?\\s*(\\d+)\\+?\\s*${yearToken}\\b`, 'i'),
                new RegExp(`\\b(?:minimum|min\\.?|at\\s+least)\\s+(\\d+)\\+?\\s*${yearToken}\\b`, 'i'),
                new RegExp(`\\b(\\d+)\\+?\\s*${yearToken}\\s+(?:in\\s+(?:practice|a\\s+practice\\s+setting)|practice\\s+setting)\\b`, 'i')
            ];
            const descriptiveExperiencePatterns = [
                [/\bexperience\s+or\s+strong\s+interest\s+in\s+urgent\s+care\s+or\s+emergency\s+medicine\b/i, 'Urgent care/emergency experience or strong interest'],
                [/\b(?:er|urgent care|emergency)(?:\/urgent care)?\s+experience\b/i, 'ER/urgent care experience'],
                [/\binternship\s+training[^\n]*preferred\b/i, 'Internship training preferred'],
                [/\bnew graduate or experienced dvm\b/i, 'New graduate or experienced DVM'],
                [/\bnew grads?\??\s*no problem\b/i, 'New graduates welcome'],
                [/\bnew graduates?\s+(?:are\s+)?(?:welcome|encouraged|supported|considered)\b/i, 'New graduates welcome'],
                [/\bnew or recent graduates?\b/i, 'New graduates welcome'],
                [/\brecent graduates?\b/i, 'New graduates welcome'],
                [/\bmentorship\s+for\s+new\s+doctors\b/i, 'New graduates welcome'],
                [/\ball experience levels\b/i, 'All experience levels'],
                [/\bexperienced (?:clinician|veterinarian|dvm|doctor)(?:s)?\b/i, 'Experienced DVM preferred']
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
                for (const [pattern, value] of descriptiveExperiencePatterns) {
                    if (pattern.test(source)) return value;
                }
            }

            for (const source of prioritizedLines) {
                for (const pattern of patterns) {
                    const match = source.match(pattern);
                    if (match) return formatExperience(match);
                }
            }

            const flexibleExperiencePatterns = [
                /\bprior [^\n]{0,80} experience [^\n]{0,80}(?:welcome|preferred|plus|not required)\b/i,
                /\bexperience [^\n]{0,80}(?:welcome|preferred|plus|not required)\b/i,
                /\bexperienced clinician or recent graduate\b/i,
                /\brecent graduate or experienced clinician\b/i
            ];
            for (const source of prioritizedLines) {
                for (const pattern of flexibleExperiencePatterns) {
                    const match = source.match(pattern);
                    if (match) return match[0].replace(/\s+/g, ' ').trim();
                }
            }

            return '';
        }

        function extractPhone(text) {
            if (!text) return '';
            const normalized = text
                .replace(/\u00a0/g, ' ')
                .replace(/[\u2013\u2014]/g, '-');

            const directLabelMatch = normalized.match(/\b(?:phone|call|tel(?:ephone)?)\s*:?\s*(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})\b/i);
            const genericMatch = directLabelMatch || normalized.match(/\b(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})\b/);
            if (!genericMatch) return '';

            const digits = (genericMatch[1] || '').replace(/\D/g, '');
            if (digits.length === 11 && digits.startsWith('1')) return `+1${digits.slice(1)}`;
            if (digits.length === 10) return `+1${digits}`;
            return '';
        }

        // Run all extractions
        const salary = extractSalary(descriptionText);
        const areaOfPractice = determineAreaOfPractice(positionTitle, descriptionText);
        const position = determinePosition(positionTitle, descriptionText, areaOfPractice);
        const address = extractAddress(descriptionText);
        const locations = [];
        if (address.city && address.state) {
            locations.push({ city: address.city, state: address.state, location: address.location });
        } else {
            const extractedLocations = extractLocations(descriptionText);
            if (extractedLocations.length > 0) {
                locations.push(extractedLocations[0]);
            }
        }
        const hospitalName = extractHospitalName(descriptionText);
        const jobType = extractJobType(descriptionText);
        const experience = extractExperience(descriptionText);
        const phone = extractPhone(descriptionText);

        return {
            salary,
            areaOfPractice,
            position,
            locations,
            hospitalName,
            jobType,
            experience,
            streetAddress: address.streetAddress || '',
            zipCode: address.zipCode || '',
            phone
        };
    }

    // Google Maps scraping: open maps.google.com, search "hospital, city, state",
    // open first listing, then read address/phone (and website when available).
    async function fetchAddressFromGoogleMaps(hospitalName, location, originalHospitalName = '', extraQueryName = '') {
        const emptyResult = {
            streetAddress: '',
            zipCode: '',
            city: '',
            state: '',
            fullAddress: '',
            website: '',
            phone: ''
        };
        const locationText = (location || '').replace(/\s+/g, ' ').trim();
        const seenQueries = new Set();
        const queries = [];

        const looksLikeFacility = (name) =>
            /\b(?:hospital|clinic|center|centre|veterinary|animal|pet|emergency|specialists?|urgent care|care)\b/i.test(name || '');

        const addQuery = (name) => {
            const cleanName = (name || '').replace(/\s+/g, ' ').trim();
            if (!cleanName) return;
            const query = [cleanName, locationText].filter(Boolean).join(', ');
            const key = query.toLowerCase();
            if (seenQueries.has(key)) return;
            seenQueries.add(key);
            queries.push(query);
        };

        const isGenericNetworkName = (name) => /\b(?:veterinary practice partners|practice partners)\b/i.test(name || '');

        for (const rawName of [hospitalName, originalHospitalName, extraQueryName].filter(Boolean)) {
            const base = (rawName || '').replace(/\s+/g, ' ').trim();
            const noSuffix = base.replace(/\s*[-–—]\s*[^,]+$/, '').trim();
            const noParens = base.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
            const noDash = base.replace(/[-–—]/g, ' ').replace(/\s+/g, ' ').trim();
            addQuery(base);
            addQuery(noSuffix);
            addQuery(noParens);
            addQuery(noDash);
            if (!looksLikeFacility(base) && !isGenericNetworkName(base)) addQuery(`${base} Veterinary Hospital`);
            if (noSuffix && !looksLikeFacility(noSuffix) && !isGenericNetworkName(noSuffix)) addQuery(`${noSuffix} Veterinary Hospital`);
        }
        if (queries.length === 0) addQuery(hospitalName || '');

        const runMapsQuery = (query) => {
            const mapsSearchUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
            return new Promise((resolve) => {
                let done = false;
                let mapsTabId = null;
                let listener = null;

                const finish = (result) => {
                    if (done) return;
                    done = true;
                    clearTimeout(timeout);
                    if (listener) chrome.tabs.onUpdated.removeListener(listener);
                    if (mapsTabId) chrome.tabs.remove(mapsTabId).catch(() => {});
                    resolve(result || emptyResult);
                };

                const timeout = setTimeout(() => {
                    console.warn(`Google Maps timeout for: "${query}"`);
                    finish(emptyResult);
                }, 45000);

                chrome.tabs.create({ url: mapsSearchUrl, active: false }, (tab) => {
                    if (!tab) {
                        finish(emptyResult);
                        return;
                    }

                    mapsTabId = tab.id;
                    listener = (updatedTabId, info) => {
                        if (updatedTabId !== mapsTabId || info.status !== 'complete') return;
                        chrome.tabs.onUpdated.removeListener(listener);
                        listener = null;

                        setTimeout(() => {
                            if (done) return;
                            chrome.scripting.executeScript({
                                target: { tabId: mapsTabId },
                                args: [query],
                                func: async () => {
                                    const empty = {
                                        streetAddress: '',
                                        zipCode: '',
                                        city: '',
                                        state: '',
                                        fullAddress: '',
                                        website: '',
                                        phone: ''
                                    };

                                    const sleep = (ms) => new Promise(resolveSleep => setTimeout(resolveSleep, ms));
                                    const waitFor = async (fn, timeoutMs = 15000, intervalMs = 200) => {
                                        const started = Date.now();
                                        while (Date.now() - started < timeoutMs) {
                                            const value = fn();
                                            if (value) return value;
                                            await sleep(intervalMs);
                                        }
                                        return null;
                                    };

                                    const cleanField = (text) => (text || '').replace(/\s+/g, ' ').trim();
                                    const stripPrefix = (text, prefix) => text.replace(new RegExp(`^${prefix}\\s*:?\s*`, 'i'), '').trim();
                                    const getAddressNode = () =>
                                        document.querySelector('button[data-item-id="address"]') ||
                                        document.querySelector('button[data-item-id^="address"]') ||
                                        document.querySelector('[data-item-id="address"]');

                                    let addressNode = await waitFor(() => getAddressNode(), 5000, 250);
                                    if (!addressNode) {
                                        const firstResult = await waitFor(() =>
                                            document.querySelector('a.hfpxzc') ||
                                            document.querySelector('div[role="article"] a[href*="/maps/place"]') ||
                                            document.querySelector('div[role="feed"] a[href*="/maps/place"]')
                                        , 10000, 250);
                                        if (firstResult) firstResult.click();
                                        addressNode = await waitFor(() => getAddressNode(), 14000, 250);
                                    }
                                    if (!addressNode) return empty;

                                    const phoneNode = document.querySelector('button[data-item-id^="phone"]') ||
                                        document.querySelector('button[data-item-id*="phone"]');
                                    const websiteNode = document.querySelector('a[data-item-id="authority"]') ||
                                        document.querySelector('a[data-item-id*="authority"]');

                                    let fullAddress = cleanField(addressNode.textContent || '');
                                    fullAddress = stripPrefix(fullAddress, 'Address');
                                    fullAddress = stripPrefix(fullAddress, 'Located in');
                                    const phone = cleanField(stripPrefix(phoneNode?.textContent || '', 'Phone'));
                                    const website = cleanField((websiteNode?.href || websiteNode?.textContent || ''));

                                    let city = '';
                                    let state = '';
                                    let streetAddress = fullAddress;
                                    let zipCode = '';

                                    const usMatch = fullAddress.match(/^(.+?),\s*([^,]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\b/i);
                                    if (usMatch) {
                                        streetAddress = cleanField(usMatch[1]);
                                        city = cleanField(usMatch[2]);
                                        state = cleanField(usMatch[3]).toUpperCase();
                                        zipCode = usMatch[4];
                                    }

                                    if (!zipCode) {
                                        const stateZipMatches = [...fullAddress.matchAll(/(?:,\s*|\s+)(?:[A-Z]{2}|District of Columbia)\s+(\d{5}(?:-\d{4})?)\b/gi)];
                                        if (stateZipMatches.length > 0) zipCode = stateZipMatches[stateZipMatches.length - 1][1];
                                    }
                                    if (!zipCode) {
                                        const endZipMatch = fullAddress.match(/\b(\d{5}(?:-\d{4})?)\b(?:\s*,?\s*(?:USA|United States(?: of America)?)\.?)?\s*$/i);
                                        if (endZipMatch) zipCode = endZipMatch[1];
                                    }

                                    if (!usMatch && fullAddress.includes(',')) {
                                        const parts = fullAddress.split(',').map(part => cleanField(part)).filter(Boolean);
                                        if (parts.length >= 3) {
                                            const statePart = parts[parts.length - 1].match(/\b([A-Z]{2}|District of Columbia)\b/i);
                                            const cityPart = parts[parts.length - 2];
                                            if (cityPart) city = city || cityPart;
                                            if (statePart) state = state || statePart[1].replace(/\./g, '').toUpperCase().replace('DISTRICT OF COLUMBIA', 'DC');
                                            streetAddress = cleanField(parts.slice(0, parts.length - 2).join(', ')) || streetAddress;
                                        }
                                    }

                                    return {
                                        streetAddress: cleanField(streetAddress),
                                        zipCode,
                                        city,
                                        state,
                                        fullAddress: cleanField(fullAddress),
                                        website,
                                        phone
                                    };
                                }
                            }).then((results) => {
                                const data = results?.[0]?.result || emptyResult;
                                finish({
                                    streetAddress: data.streetAddress || '',
                                    zipCode: data.zipCode || '',
                                    city: data.city || '',
                                    state: data.state || '',
                                    fullAddress: data.fullAddress || '',
                                    website: data.website || '',
                                    phone: data.phone || ''
                                });
                            }).catch((err) => {
                                console.error(`Google Maps script error for "${query}":`, err);
                                finish(emptyResult);
                            });
                        }, 1200);
                    };

                    chrome.tabs.onUpdated.addListener(listener);
                });
            });
        };

        let best = { ...emptyResult };
        for (const query of queries.slice(0, 6)) {
            const data = await runMapsQuery(query);
            best = {
                streetAddress: best.streetAddress || data.streetAddress || '',
                zipCode: best.zipCode || data.zipCode || '',
                city: best.city || data.city || '',
                state: best.state || data.state || '',
                fullAddress: best.fullAddress || data.fullAddress || '',
                website: best.website || data.website || '',
                phone: best.phone || data.phone || ''
            };
            if (best.streetAddress && best.zipCode && best.phone) break;
        }

        return best;
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

    function displayRecords(jobs) {
        tableBody.innerHTML = '';
        updateJobCount(jobs.length);

        if (jobs.length === 0) {
            table.style.display = 'none';
            emptyState.classList.remove('hidden');
            return;
        }

        table.style.display = 'table';
        emptyState.classList.add('hidden');

        jobs.forEach((job) => {
            const row = tableBody.insertRow();

            if (job.isNewLocation) {
                row.style.backgroundColor = '#d1fae5';
            }

            row.insertCell(0).textContent = job.title;
            const jobIdCell = row.insertCell(1);
            jobIdCell.textContent = job.jobId || 'N/A';
            jobIdCell.style.fontFamily = "'Consolas', 'Monaco', monospace";
            jobIdCell.style.fontSize = '12px';
            jobIdCell.style.color = '#64748b';
            row.insertCell(2).textContent = job.areaOfPractice || '-';
            row.insertCell(3).textContent = job.position || '-';
            row.insertCell(4).textContent = job.salary || '-';
            row.insertCell(5).textContent = job.jobType || '-';
            row.insertCell(6).textContent = job.experience || '-';
            row.insertCell(7).textContent = 'Veterinary Practice Partners';
            row.insertCell(8).textContent = job.hospital;
            row.insertCell(9).textContent = job.city;
            row.insertCell(10).textContent = job.state;
            row.insertCell(11).textContent = job.streetAddress || '-';
            row.insertCell(12).textContent = job.zipCode || '-';
            row.insertCell(13).textContent = job.phone || '-';

            const websiteCell = row.insertCell(14);
            if (job.website) {
                const websiteLink = document.createElement('a');
                websiteLink.href = job.website;
                websiteLink.textContent = 'Visit';
                websiteLink.target = '_blank';
                websiteLink.style.color = '#2563eb';
                websiteCell.appendChild(websiteLink);
            } else {
                websiteCell.textContent = '-';
            }

            const linkCell = row.insertCell(15);
            const link = document.createElement('a');
            link.href = job.link;
            link.textContent = 'View Job';
            link.target = '_blank';
            linkCell.appendChild(link);

            const descCell = row.insertCell(16);
            if (job.description) {
                const descDiv = document.createElement('div');
                descDiv.className = 'description-cell';
                descDiv.textContent = job.description;
                descCell.appendChild(descDiv);
            } else {
                descCell.innerHTML = '<span style="color: #94a3b8; font-style: italic; font-size: 12px;">Not scraped</span>';
            }
        });
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

    function exportToCSV() {
        if (!allJobs || allJobs.length === 0) {
            showToast('No jobs to export!', 'error');
            return;
        }

        const headers = ['Job Title', 'Job ID', 'Area of Practice', 'Position', 'Salary', 'Job Type', 'Experience', 'Aggregator', 'Hospital Name', 'City', 'State', 'Street Address', 'Zip Code', 'Phone', 'Website', 'Link', 'Description'];
        const csvContent = [
            headers.join(','),
            ...allJobs.map((job) => [
                `"${(job.title || '').replace(/"/g, '""')}"`,
                `"${(job.jobId || '').replace(/"/g, '""')}"`,
                `"${(job.areaOfPractice || '').replace(/"/g, '""')}"`,
                `"${(job.position || '').replace(/"/g, '""')}"`,
                `"${(job.salary || '').replace(/"/g, '""')}"`,
                `"${(job.jobType || '').replace(/"/g, '""')}"`,
                `"${(job.experience || '').replace(/"/g, '""')}"`,
                `"Veterinary Practice Partners"`,
                `"${(job.hospital || '').replace(/"/g, '""')}"`,
                `"${(job.city || '').replace(/"/g, '""')}"`,
                `"${(job.state || '').replace(/"/g, '""')}"`,
                `"${(job.streetAddress || '').replace(/"/g, '""')}"`,
                `"${(job.zipCode || '').replace(/"/g, '""')}"`,
                `"${(job.phone || '').replace(/"/g, '""')}"`,
                `"${(job.website || '').replace(/"/g, '""')}"`,
                `"${(job.link || '').replace(/"/g, '""')}"`,
                `"${(job.description || '').replace(/"/g, '""')}"`
            ].join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);

        link.setAttribute('href', url);
        link.setAttribute('download', `vpp_jobs_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        showToast(`Exported ${allJobs.length} jobs to CSV!`, 'success');
    }
    // Initialize
    chrome.storage.local.get(['scrapedJobs'], (result) => {
        const normalizedIds = normalizeJobIdsFromLinks(result.scrapedJobs || []);
        allJobs = normalizedIds.jobs;
        if (normalizedIds.changed) {
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
            aggregator: "Veterinary Practice Partners",
            street_address: job.streetAddress || '',
            parent_client: "Veterinary Practice Partners",
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
                source: 'VPP Job Scraper',
                parentClientName: 'Veterinary Practice Partners',
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
        const normalizedIds = normalizeJobIdsFromLinks(data.scrapedJobs || []);
        const jobs = normalizedIds.jobs;
        if (normalizedIds.changed) {
            await chrome.storage.local.set({ scrapedJobs: jobs });
        }

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
        const normalizedIds = normalizeJobIdsFromLinks(data.scrapedJobs || []);
        const jobs = normalizedIds.jobs;
        if (normalizedIds.changed) {
            await chrome.storage.local.set({ scrapedJobs: jobs });
        }

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
        const normalizedIds = normalizeJobIdsFromLinks(data.scrapedJobs || []);
        const jobs = normalizedIds.jobs;
        if (normalizedIds.changed) {
            await chrome.storage.local.set({ scrapedJobs: jobs });
        }

        if (jobs.length === 0) {
            showToast('No jobs found. Please scrape jobs first.', 'error');
            return;
        }

        // Find jobs that need details (no areaOfPractice, position, or experience)
        // Can work with job title even if no description exists
        const jobsToFetch = jobs.map((job, index) => ({ job, index }))
            .filter(item => {
                if (!(item.job.title || item.job.jobTitle)) return false;
                const desc = item.job.description || '';
                const analysisDesc = desc.split(/\n\s*Create a Job Alert\s*\n/i)[0];
                const descHasSalary = /\$[\d,]+/.test(analysisDesc);
                const descHasExperience = /\b(?:\d+\+?\s*(?:years?|yrs?)\s+(?:of\s+)?experience|experienced\s*\(\s*\d+\+?\s*years?\s*\)|new grads?|new graduate|recent graduate|new or recent graduates?|experienced dvm|prior .* experience|all experience levels|experience .*not required|experience .*preferred|experience .*plus|mentorship for new doctors)\b/i.test(analysisDesc);
                const descHasStreetLocation = /\bLocation:\s*[^\n]*\b\d{5}(?:-\d{4})?\b/i.test(analysisDesc);
                const titleLower = (item.job.title || item.job.jobTitle || '').toLowerCase();
                const hasWrongMedicalDirectorAOP = /\bmedical director\b/i.test(titleLower) &&
                    !['General Practice Care', 'Specialty Care'].includes(item.job.areaOfPractice || '');
                const hasForcedVetPositionOnNonVetTitle =
                    item.job.position === 'Associate Veterinarian' &&
                    /\b(?:technician|assistant|instructor|swim|manager|reception|client|coordinator|attendant|kennel)\b/i.test(titleLower) &&
                    !/\b(?:veterinarian|dvm)\b/i.test(titleLower);
                const needsDetails =
                    !item.job.areaOfPractice ||
                    !item.job.position ||
                    !item.job.jobType ||
                    !item.job.hospital ||
                    hasWrongMedicalDirectorAOP ||
                    hasForcedVetPositionOnNonVetTitle ||
                    (descHasSalary && !item.job.salary) ||
                    (descHasExperience && !item.job.experience) ||
                    (descHasStreetLocation && (!item.job.streetAddress || !item.job.zipCode));
                return needsDetails;
            });

        if (jobsToFetch.length === 0) {
            if (confirm('All jobs already have details. Do you want to re-analyze all jobs?')) {
                detailsQueue = jobs.map((job, index) => ({ job, index }))
                    .filter(item => item.job.title || item.job.jobTitle);
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
        const jobId = queueItem.job.jobId;
        const jobLink = queueItem.job.link || '';

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
        let currentIndex = -1;
        if (Number.isInteger(queueItem.index) && currentJobs[queueItem.index]) {
            const candidate = currentJobs[queueItem.index];
            if ((!jobLink || candidate.link === jobLink) && (!jobId || candidate.jobId === jobId)) {
                currentIndex = queueItem.index;
            }
        }
        if (currentIndex === -1) {
            currentIndex = currentJobs.findIndex((j, idx) =>
                idx >= queueItem.index && j.jobId === jobId && (!jobLink || j.link === jobLink)
            );
        }
        if (currentIndex === -1) {
            currentIndex = currentJobs.findIndex(j => j.jobId === jobId);
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
        const positionTitle = job.title || job.jobTitle || '';
        const description = job.description || '';

        if (positionTitle) {
            const extracted = extractDetailsFromDescription(positionTitle, description);
            const primaryLocation = (extracted.locations && extracted.locations[0]) || {};

            detailsList = [{
                areaOfPractice: extracted.areaOfPractice,
                position: extracted.position,
                salary: extracted.salary,
                hospitalName: extracted.hospitalName,
                jobType: extracted.jobType,
                experience: extracted.experience,
                description: description,
                city: primaryLocation.city || '',
                state: primaryLocation.state || '',
                location: primaryLocation.location || '',
                streetAddress: extracted.streetAddress || '',
                zipCode: extracted.zipCode || ''
            }];
        }

        // Save extracted details to storage
        if (detailsList.length > 0) {
            await saveDetailResults(detailsList, currentIndex);
        }

        // Move to next job â€” no delay needed since we're analyzing locally
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
                const listingTitle = originalJob.title || originalJob.jobTitle || '';
                const detailAOP = firstDetail.areaOfPractice || '';
                const descText = firstDetail.description || originalJob.description || '';

                // Step 1: Determine AOP from the listing title first for associate/general veterinarian roles.
                const titleAOP = getAOPFromTitle(listingTitle);
                let finalAOP = titleAOP || detailAOP || 'General Practice Care';
                if (isGeneralVeterinarianTitle(listingTitle) && finalAOP === 'Specialty Care') {
                    finalAOP = titleAOP || 'General Practice Care';
                }
                if (!isGeneralVeterinarianTitle(listingTitle) && hasSpecialtyTrainingSignal(descText)) {
                    finalAOP = 'Specialty Care';
                }
                if (/\bmedical director\b/i.test(listingTitle) && !['General Practice Care', 'Specialty Care'].includes(finalAOP)) {
                    finalAOP = titleAOP === 'Specialty Care' ? 'Specialty Care' : 'General Practice Care';
                }

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
                if (!finalPosition) {
                    finalPosition = getFallbackPositionForTitle(listingTitle);
                }
                if (!finalPosition) {
                    finalPosition = getFallbackPositionFromNonVetTitle(listingTitle);
                }

                // Step 5: Medical Director override â€” if title says "Medical Director", keep it
                if ((!finalPosition || finalPosition === 'Associate Veterinarian') && listingTitle.toLowerCase().includes('medical director')) {
                    finalPosition = APPROVED_POSITION_SET.has('Medical Director') ? 'Medical Director' : '';
                }

                if (finalPosition && !APPROVED_POSITION_SET.has(finalPosition)) {
                    finalPosition = getFallbackPositionFromNonVetTitle(listingTitle) || getFallbackPositionForTitle(listingTitle);
                }

                // Update original job with extracted details
                originalJob.areaOfPractice = finalAOP;
                originalJob.position = finalPosition || '';
                originalJob.salary = firstDetail.salary || originalJob.salary || '';
                originalJob.jobType = firstDetail.jobType || originalJob.jobType || 'Full-Time';
                originalJob.experience = firstDetail.experience || originalJob.experience || '';
                if (firstDetail.city) originalJob.city = firstDetail.city;
                if (firstDetail.state) originalJob.state = firstDetail.state;
                if (firstDetail.location) originalJob.location = firstDetail.location;
                if (firstDetail.streetAddress) originalJob.streetAddress = firstDetail.streetAddress;
                if (firstDetail.zipCode) originalJob.zipCode = firstDetail.zipCode;
                // Update description if we got a better one
                if (firstDetail.description && firstDetail.description.length > (originalJob.description || '').length) {
                    originalJob.description = firstDetail.description;
                }

                // Backfill duplicate/multi-location rows for the same job. Older exports showed
                // some duplicated rows keeping blank AOP/position/job type even though the same
                // saved description had already yielded those values.
                const copyMissingDetails = (targetJob) => {
                    if (!targetJob) return;
                    const targetTitle = targetJob.title || targetJob.jobTitle || listingTitle;
                    let targetAOP = getAOPFromTitle(targetTitle) || finalAOP;
                    if (/\bmedical director\b/i.test(targetTitle) && !['General Practice Care', 'Specialty Care'].includes(targetAOP)) {
                        targetAOP = getAOPFromTitle(targetTitle) === 'Specialty Care' ? 'Specialty Care' : 'General Practice Care';
                    }
                    let targetPosition = getPositionFromTitle(targetTitle) || finalPosition;

                    if (targetPosition) {
                        targetPosition = getValidatedPosition(targetPosition, targetAOP);
                    }
                    if (!targetPosition) {
                        targetPosition = getDefaultPositionForAOP(targetAOP, targetTitle) || getFallbackPositionForTitle(targetTitle);
                    }
                    if (!targetPosition) {
                        targetPosition = getFallbackPositionFromNonVetTitle(targetTitle);
                    }

                    if (!targetJob.areaOfPractice || (isGeneralVeterinarianTitle(targetTitle) && targetJob.areaOfPractice === 'Specialty Care')) {
                        targetJob.areaOfPractice = targetAOP || 'General Practice Care';
                    }
                    if (!targetJob.position && targetPosition) targetJob.position = targetPosition;
                    if (!targetJob.salary && firstDetail.salary) targetJob.salary = firstDetail.salary;
                    if (!targetJob.jobType) targetJob.jobType = firstDetail.jobType || 'Full-Time';
                    if (!targetJob.experience && firstDetail.experience) targetJob.experience = firstDetail.experience;
                    if (!targetJob.city && firstDetail.city) targetJob.city = firstDetail.city;
                    if (!targetJob.state && firstDetail.state) targetJob.state = firstDetail.state;
                    if (!targetJob.location && firstDetail.location) targetJob.location = firstDetail.location;
                    if (!targetJob.streetAddress && firstDetail.streetAddress) targetJob.streetAddress = firstDetail.streetAddress;
                    if (!targetJob.zipCode && firstDetail.zipCode) targetJob.zipCode = firstDetail.zipCode;
                    if ((!targetJob.description || targetJob.description.length < descText.length) && descText) {
                        targetJob.description = descText;
                    }
                };

                const originalLink = originalJob.link || originalJob.sourceLink || '';
                const originalId = originalJob.jobId || originalJob.id || '';
                for (let i = 0; i < jobs.length; i++) {
                    if (i === jobIndex) continue;
                    const candidate = jobs[i];
                    const sameLink = originalLink && (candidate.link === originalLink || candidate.sourceLink === originalLink);
                    const sameId = originalId && (candidate.jobId === originalId || candidate.id === originalId);
                    if (sameLink || sameId) copyMissingDetails(candidate);
                }

                const dedupedJobs = dedupeJobsByIdentity(jobs);

                chrome.storage.local.set({ scrapedJobs: dedupedJobs }, () => {
                    allJobs = dedupedJobs;
                    displayRecords(allJobs);
                    resolve();
                });
            });
        });
    }

    function dedupeJobsByIdentity(jobs) {
        const merged = [];
        const seen = new Map();

        function identityKey(job) {
            return (job.jobId || job.id || job.link || job.sourceLink || '').trim();
        }

        function valueIsUseful(value) {
            return !!(value && String(value).trim() && String(value).trim() !== '-');
        }

        function addressScore(job) {
            return (valueIsUseful(job.streetAddress) ? 4 : 0) +
                (valueIsUseful(job.zipCode) ? 4 : 0) +
                (valueIsUseful(job.city) ? 1 : 0) +
                (valueIsUseful(job.state) ? 1 : 0);
        }

        function mergeInto(target, source) {
            for (const [key, value] of Object.entries(source)) {
                if (!valueIsUseful(target[key]) && valueIsUseful(value)) {
                    target[key] = value;
                }
            }
            target.isNewLocation = false;
        }

        for (const job of jobs) {
            const key = identityKey(job);
            if (!key) {
                merged.push({ ...job, isNewLocation: false });
                continue;
            }

            if (!seen.has(key)) {
                const copy = { ...job, isNewLocation: false };
                seen.set(key, copy);
                merged.push(copy);
                continue;
            }

            const existing = seen.get(key);
            if (addressScore(job) > addressScore(existing)) {
                const replacement = { ...job, isNewLocation: false };
                mergeInto(replacement, existing);
                const existingIndex = merged.indexOf(existing);
                if (existingIndex !== -1) merged[existingIndex] = replacement;
                seen.set(key, replacement);
            } else {
                mergeInto(existing, job);
            }
        }

        return merged;
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
            .replace(/[-â€“â€”]/g, ' ')
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

    function getJobSearchLocation(job) {
        if (!job) return '';
        if (job.location && job.location.trim()) return job.location.trim();
        const city = (job.city || '').trim();
        const state = (job.state || '').trim();
        if (city && state) return `${city}, ${state}`;
        if (city) return city;
        if (state) return state;
        return '';
    }

    function normalizedLocationPart(value) {
        return (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    function extractZipFromAddressText(addressText) {
        const text = (addressText || '').trim();
        if (!text) return '';

        const stateZipMatches = [...text.matchAll(/(?:,\s*|\s+)(?:[A-Z]{2}|District of Columbia)\s+(\d{5}(?:-\d{4})?)\b/gi)];
        if (stateZipMatches.length > 0) {
            return stateZipMatches[stateZipMatches.length - 1][1];
        }

        const endZipMatch = text.match(/\b(\d{5}(?:-\d{4})?)\b(?:\s*,?\s*(?:USA|United States(?: of America)?)\.?)?\s*$/i);
        if (endZipMatch) {
            return endZipMatch[1];
        }

        return '';
    }

    function isLikelyValidCity(value) {
        const city = (value || '').trim();
        if (!city) return false;
        if (city.length > 40) return false;
        if (/\d/.test(city)) return false;
        if (/[,]/.test(city)) return false;
        if (/\b(veterinary|hospital|clinic|opportunity|owner|partners?|practice|internist|director|veterinarian|de novo|urgent|emergency)\b/i.test(city)) {
            return false;
        }
        return true;
    }

    function isLikelyValidStreetAddress(value) {
        const street = (value || '').trim();
        if (!street) return false;
        if (street.length > 120) return false;
        if (/\b(?:schedule|insurance|benefits|opportunity|ownership|partnership|practice|veterinary|hospital|clinic|doctor|ratio|allowance|supports|operational)\b/i.test(street)) {
            return false;
        }
        const hasNumber = /\d/.test(street);
        const hasStreetToken = /\b(?:st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|way|ct|court|pl|place|pkwy|parkway|hwy|highway|cir|circle|trl|trail|loop)\b/i.test(street);
        return hasNumber || hasStreetToken;
    }

    function extractCityStateFromAddressText(addressText) {
        const text = (addressText || '').trim();
        if (!text) return { city: '', state: '' };

        // Common format: "Street, City, ST 12345"
        let match = text.match(/^.+?,\s*([^,]+),\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/i);
        if (match) {
            return { city: match[1].trim(), state: match[2].trim().toUpperCase() };
        }

        // Alternate format: "Street, City ST 12345"
        match = text.match(/^.+?,\s*([A-Za-z][A-Za-z\s.'-]+?)\s+([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/i);
        if (match) {
            return { city: match[1].trim(), state: match[2].trim().toUpperCase() };
        }

        return { city: '', state: '' };
    }

    function hasSavedValue(value) {
        return !!(value && String(value).trim() && String(value).trim() !== '-');
    }

    function jobLocationMismatch(job) {
        const expected = parseLocationParts(getJobSearchLocation(job));
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
            const jobLocation = getJobSearchLocation(job);
            if (!job.hospital || !jobLocation || !job.streetAddress || !job.zipCode) continue;
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
            rememberAddressData(getAddressCacheKeys(job.hospital, jobLocation), cached);
        }
    }

    fetchAddressesBtn.addEventListener('click', async () => {
        if (isFetchingAddresses) {
            showToast('Already fetching addresses. Please wait...', 'error');
            return;
        }

        const data = await chrome.storage.local.get(['scrapedJobs']);
        const jobs = data.scrapedJobs || [];

        // Find jobs that need address/contact data.
        const jobsNeedingAddresses = jobs.map((job, index) => ({ job, index }))
            .filter(item => {
                const jobLocation = getJobSearchLocation(item.job);
                const needsCity = !hasSavedValue(item.job.city);
                const needsState = !hasSavedValue(item.job.state);
                const needsStreet = !hasSavedValue(item.job.streetAddress);
                const needsZip = !hasSavedValue(item.job.zipCode);
                const needsPhone = !hasSavedValue(item.job.phone);
                const needsAddress = needsCity || needsState || needsStreet || needsZip;
                return item.job.hospital && (
                    needsAddress ||
                    needsPhone ||
                    (!needsCity && !needsState && jobLocation ? jobLocationMismatch(item.job) : false)
                );
            });

        if (jobsNeedingAddresses.length === 0) {
            if (confirm('All jobs already have addresses. Do you want to re-fetch addresses for all jobs?')) {
                addressQueue = jobs.map((job, index) => ({ job, index }))
                    .filter(item => item.job.hospital);
            } else {
                return;
            }
        } else {
            addressQueue = jobsNeedingAddresses;
        }

        if (addressQueue.length === 0) {
            showToast('No jobs have hospital data to fetch addresses.', 'error');
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

        try {
            // Clean hospital name for search:
            // Remove trailing location suffix for child rows: "Hospital-Leesburg" â†’ "Hospital"
            const searchHospital = (job.hospital || '').trim();

            // Do not force a "Hospital" suffix here; variant retries inside
            // fetchAddressFromGoogleMaps handle naming differences safely.

            // Parse city and state from location field (e.g. "Austin, TX")
            let searchCity = '';
            let searchState = '';
            const effectiveLocation = getJobSearchLocation(job);
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
            const cacheKeys = getAddressCacheKeys(searchHospital, searchLocation, job.hospital || '');
            let addressData = getRememberedAddress(cacheKeys);
            if (addressData && !hasSavedValue(job.phone) && !hasSavedValue(addressData.phone)) {
                addressData = null;
            }
            if (addressData) {
                console.log(`Using cached address for "${searchHospital}, ${searchLocation}"`);
            } else {
                addressData = await fetchAddressFromGoogleMaps(
                    searchHospital,
                    searchLocation,
                    job.hospital || '',
                    (job.title || job.jobTitle || '')
                );
                rememberAddressData(cacheKeys, addressData);
            }

            // Update job with address data from Google Maps
            const data = await chrome.storage.local.get(['scrapedJobs']);
            const jobs = data.scrapedJobs || [];

            if (jobs[index]) {
                if (!hasSavedValue(jobs[index].streetAddress) && addressData.streetAddress) {
                    jobs[index].streetAddress = addressData.streetAddress;
                }
                if (!hasSavedValue(jobs[index].zipCode) && addressData.zipCode) {
                    jobs[index].zipCode = addressData.zipCode;
                }

                const parsedFromFull = extractCityStateFromAddressText(addressData.fullAddress || '');
                const existingCity = jobs[index].city || '';
                const existingState = jobs[index].state || '';

                const preferredCity = isLikelyValidCity(searchCity)
                    ? searchCity
                    : (isLikelyValidCity(addressData.city)
                        ? addressData.city
                        : (isLikelyValidCity(parsedFromFull.city)
                            ? parsedFromFull.city
                            : (isLikelyValidCity(existingCity) ? existingCity : '')));
                if (!hasSavedValue(jobs[index].city)) {
                    jobs[index].city = preferredCity;
                }

                const preferredStateRaw = searchState || addressData.state || parsedFromFull.state || existingState || '';
                if (!hasSavedValue(jobs[index].state)) {
                    jobs[index].state = getFullStateName(preferredStateRaw);
                }

                // Try to extract zip from fullAddress if parsing missed it
                if (!hasSavedValue(jobs[index].zipCode) && addressData.fullAddress) {
                    const zipFromFull = extractZipFromAddressText(addressData.fullAddress);
                    if (zipFromFull) jobs[index].zipCode = zipFromFull;
                }

                // Website and phone from Google Maps
                if (!hasSavedValue(jobs[index].website) && addressData.website) {
                    jobs[index].website = addressData.website;
                }
                if (!hasSavedValue(jobs[index].phone) && addressData.phone) {
                    jobs[index].phone = addressData.phone;
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

        // Continue processing â€” delay for Google Maps tab loading
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


