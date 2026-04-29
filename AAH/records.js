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
    const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
    const selectAllHeader = document.getElementById('selectAllHeader');

    let currentSortColumn = null;
    let currentSortDirection = 'asc';
    let allJobs = [];
    let selectedJobKeys = new Set();
    let isGettingDescriptions = false;
    let isFetchingDetails = false;
    let isFetchingAddresses = false;
    let currentJobIndex = 0;
    let detailsQueue = [];
    let currentDetailsIndex = 0;
    let addressQueue = [];
    let currentAddressIndex = 0;
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
            return 'http://localhost/zoho-api/api/webhook-receiver.php';
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

    function isCleanCityName(city) {
        if (!city) return false;
        const value = city.trim();
        const lower = value.toLowerCase();
        const badWords = [
            'description', 'position', 'associate', 'veterinarian', 'hospital',
            'care', 'center', 'clinic', 'location', 'practice', 'team',
            'beautiful', 'supportive', 'community', 'focused', 'general',
            'located', 'opportunity', 'join', 'seeking', 'looking'
        ];

        if (value.length < 2 || value.length > 35) return false;
        if (/\b(in|near|at|with|for)\b/i.test(value)) return false;
        if (badWords.some(word => lower.includes(word))) return false;
        if (!/^[A-Za-z][A-Za-z\s.'-]*$/.test(value)) return false;

        return true;
    }

    function normalizeCityName(city) {
        if (!city) return '';
        const value = city.trim();
        if (isCleanCityName(value)) return value;

        const phraseMatch = value.match(/\b(?:located\s+in|in|near|at)\s+(?:beautiful\s+)?([A-Za-z][A-Za-z\s.'-]*?)\s*$/i);
        if (phraseMatch && isCleanCityName(phraseMatch[1])) {
            return phraseMatch[1].trim();
        }

        return '';
    }

    function parseListingLocation(location) {
        if (!location) return null;
        const parts = location.split(',').map(s => s.trim()).filter(Boolean);
        if (parts.length < 2) return null;
        const city = normalizeCityName(parts[0]);
        const state = parts[1];
        if (!city || !/^[A-Z]{2}$/.test(state)) return null;
        return { city, state, location: `${city}, ${state}` };
    }

    function normalizeLocationText(location) {
        const parsed = parseListingLocation(location);
        return parsed ? parsed.location : '';
    }

    function getSavedDescriptionField(descriptionText, fieldName) {
        if (!descriptionText) return '';
        const escapedField = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = descriptionText.match(new RegExp(`^${escapedField}:\\s*([^\\n]+)`, 'im'));
        return match ? match[1].trim() : '';
    }

    function isUsableHospitalName(hospitalName) {
        if (!hospitalName) return false;
        const cleaned = hospitalName.trim();
        if (!cleaned) return false;
        return !/^united\s+veterinary\s+care$/i.test(cleaned) && !/^uvc$/i.test(cleaned);
    }

    function shouldSkipFetchDetails(job) {
        const title = (job?.title || '').toLowerCase();
        const hasProtectedRole = /\bassociate\s+veterinarian\b/.test(title) ||
            /\bmedical\s+director\b/.test(title);
        if (hasProtectedRole) return false;

        return /\bveterinary\s+receptionist\b/.test(title) ||
            /\bveterinary\s+customer\s+service\s+representative\b/.test(title) ||
            /\bveterinary\s+technician\b/.test(title) ||
            /\bvet(?:erinary)?\s+tech(?:nician)?\b/.test(title) ||
            /\bkennel\b/.test(title) ||
            /\bveterinary\s+assistant\b/.test(title) ||
            /\bvet(?:erinary)?\s+assistant\b/.test(title) ||
            /\bveterinary\s+practice\s+manager\b/.test(title) ||
            /\bveterinary\s+laboratory\s+technician\b/.test(title) ||
            /\bpet\s+bather\b/.test(title) ||
            /\bveterinary\s+surgery\s+technician\b/.test(title) ||
            /\bveterinary\s+groomer\b/.test(title) ||
            /\banimal\s+care\s+technician\b/.test(title) ||
            /\bveterinary\s+student\s+ambassador\b/.test(title) ||
            /\bexternship\b/.test(title) ||
            /\brelief\s+veterinarian\b/.test(title) ||
            /\bdvm\s+veterinary\s+partner\s*(?:&|and)\s*hospital\s+equity\s+owner\b/.test(title) ||
            /\bseasonal\s+veterinarian\b/.test(title);
    }

    function getJobSelectionKey(job) {
        return [
            job?.jobId || '',
            job?.link || '',
            job?.title || '',
            job?.hospital || '',
            job?.location || ''
        ].join('|');
    }

    function refreshDisplayedJobs() {
        const searchTerm = searchInput ? searchInput.value.trim().toLowerCase() : '';
        let jobsToDisplay = [...allJobs];

        if (searchTerm) {
            jobsToDisplay = jobsToDisplay.filter(job =>
                (job.title || '').toLowerCase().includes(searchTerm) ||
                (job.hospital || '').toLowerCase().includes(searchTerm) ||
                (job.city || '').toLowerCase().includes(searchTerm) ||
                (job.state || '').toLowerCase().includes(searchTerm) ||
                (job.location || '').toLowerCase().includes(searchTerm) ||
                (job.streetAddress || '').toLowerCase().includes(searchTerm) ||
                (job.zipCode || '').toLowerCase().includes(searchTerm) ||
                (job.phone || '').toLowerCase().includes(searchTerm) ||
                (job.website || '').toLowerCase().includes(searchTerm) ||
                (job.areaOfPractice || '').toLowerCase().includes(searchTerm) ||
                (job.position || '').toLowerCase().includes(searchTerm) ||
                (job.jobType || '').toLowerCase().includes(searchTerm)
            );
        }

        if (currentSortColumn) {
            jobsToDisplay = sortRecords(currentSortColumn, currentSortDirection, jobsToDisplay);
        }

        displayRecords(jobsToDisplay);
    }

    // ============ TOP-LEVEL POSITION MATCHING (used by both detail extraction and save) ============

    // Match position from the job listing title — this is the authoritative source for position.
    // The listing title (e.g. "Veterinary Cardiologist") is always more specific than
    // generic detail page content, so we use it as the primary position signal.
    function getPositionFromTitle(title) {
        const t = title.toLowerCase();

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
        if (t.includes('theriogenologist') || t.includes('theriogenology')) return 'Theriogenologist';
        if (t.includes('internist') || t.includes('internal medicine')) return 'Internal Medicine Specialist';
        if (t.includes('criticalist') || t.match(/\becc\b/) || t.includes('emergency medicine')) return 'ECC Specialist';
        if (t.includes('dabvp')) return 'DABVP Specialist';
        if ((t.includes('dental') || t.includes('dentist') || t.includes('dentistry')) && !t.includes('assistant')) return 'Dental Specialist';
        if ((t.includes('surgeon') || t.includes('surgery')) && !t.includes('neurosurgeon') && !t.includes('neurology') && !t.includes('dental') && !t.includes('dentistry')) return 'Surgeon';

        // === VTS/CREDENTIALED SPECIALIST ===
        if (t.includes('technician specialist') || (t.match(/\bvts\b/) && t.includes('specialist'))) return 'Credentialed Veterinary Technician Specialist';

        // === ANIMAL TYPE & PRACTICE SCOPE ===
        if (t.includes('equine') || t.includes('bovine') || t.includes('large animal')) return 'Equine/Bovine Veterinarian/Large Animal';
        if (t.includes('avian') || t.includes('exotics')) return 'Avian & Exotics Veterinarian / Associate Exotics';

        // === OTHER ===
        if (t.includes('partner veterinarian')) return 'Partner Veterinarian';

        return '';
    }

    // Validate that a position is allowed for the given AOP
    function getValidatedPosition(position, aop) {
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

        // Equine/Bovine/Exotics
        if (t.includes('equine') || t.includes('bovine') || t.includes('large animal') ||
            t.includes('avian') || t.includes('exotics')) return 'General Practice Care / Emergency Care / Urgent Care';

        return '';
    }

    // ============ LOCAL DETAIL EXTRACTION (mirrors detail-extractor.js) ============

    function extractDetailsFromDescription(positionTitle, descriptionText, listingLocation = '') {
        // Format salary to standard "$X–$Y per year" or "$X per hour"
        function formatSalary(raw, context = '') {
            if (!raw) return '';
            const salaryContext = `${raw} ${context}`;
            const isHourly = /(?:per\s+)?(?:hour|hr)|\/\s*hr|hourly/i.test(salaryContext);
            const isAnnual = /(?:per\s+)?(?:year|annually|annual|annum)|yearly/i.test(salaryContext);
            const rangePattern = /\$?[\d,]+(?:\.\d{2})?\s*(?:\/?k)?\s*(?:-|\?|\u2010|\u2011|\u2012|\u2013|\u2014|\u2015|\uFFFD|to|\u00e2\S{0,3})\s*\$?[\d,]+(?:\.\d{2})?\s*(?:\/?k)?/i;
            const amountSource = rangePattern.test(raw) ? raw : (salaryContext.match(rangePattern)?.[0] || raw);
            const rangeUsesK = /\b\d[\d,]*(?:\.\d+)?\s*(?:\/?k)?\s*(?:[-–—]|to)\s*\$?\d[\d,]*(?:\.\d+)?\s*(?:\/?k)\b/i.test(raw);
            const amounts = [];
            const amountRegex = /\$?([\d,]+(?:\.\d{2})?)\s*(?:\/?k)?\b/gi;
            let match;
            while ((match = amountRegex.exec(amountSource)) !== null) {
                let num = parseFloat(match[1].replace(/,/g, ''));
                const afterMatch = amountSource.substring(match.index + match[0].length - 1, match.index + match[0].length + 1);
                if (rangeUsesK || /\b\d[\d,]*(?:\.\d+)?\s*(?:\/?k)?\s*(?:-|\u2013|\u2014|to)\s*\$?\d[\d,]*(?:\.\d+)?\s*(?:\/?k)\b/i.test(amountSource) || /k/i.test(match[0]) || /k/i.test(afterMatch)) {
                    num = num * 1000;
                }
                if (num > 0) amounts.push(num);
            }
            if (amounts.length === 0) return raw;
            const maxAmount = Math.max(...amounts);
            const fmt = (n) => {
                if (Number.isInteger(n)) return '$' + n.toLocaleString('en-US');
                return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            };
            const unit = isHourly || (!isAnnual && maxAmount > 0 && maxAmount < 300) ? 'per hour' : 'per year';
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
            const normalizedText = text
                .replace(/\u00e2\u20ac\u201c|\u00e2\u20ac\u201d|\u00e2\u02c6\u2019/g, '-')
                .replace(/[\u2012\u2013\u2014\u2212]/g, '-');

            // Try to extract from JSON-LD data in the text
            const jsonLdMatch = normalizedText.match(/Salary Range:\s*([^\n]+)/i);
            if (jsonLdMatch) {
                const salaryLine = (jsonLdMatch[1] || '').trim();
                // Only trust this fast path when it actually contains numeric salary data.
                // Otherwise, continue to broader fallback matching below.
                if (/\d/.test(salaryLine)) {
                    const formatted = formatSalary(salaryLine);
                    if (/\d/.test(formatted)) return formatted;
                }
            }

            // Fallback to text pattern matching
            const salaryPatterns = [
                /(?:compensation|salary|pay)\s+range\s*[-:]\s*\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s*-\s*\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?(?:\s*,?\s*(?:depending|based)\s+on[^\n.]*)?/i,
                /(?:base\s+)?(?:salary|compensation|pay)\s+range(?:\s+can\s+vary)?\s*(?:from|of|is|:)\s*\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s*(?:-|to)\s*\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?(?:\s*(?:per\s+)?(?:year|annually|annum|annual|hour|hr|hourly))?/i,
                /(?:base\s+)?(?:salary|compensation|pay)\s+range(?:\s+can\s+vary)?\s*between\s*\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s*and\s*\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?(?:\s*(?:per\s+)?(?:year|annually|annum|annual|hour|hr|hourly))?/i,
                /(?:base\s+salary\s*(?:ranges?)?)\s*(?:of|from|is|:)\s*\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s*(?:-|\u2013|\u2014)\s*\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?/i,
                /(?:(?:pay|salary|compensation)\s+range)\s*(?:of|from|is|:)\s*\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s*(?:-|\u2013|\u2014)\s*\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?/i,
                /(?:salary|compensation|pay)[:\s]+\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s*(?:-|\u2013|\u2014)\s*\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?(?:\s*(?:per\s+)?(?:year|annually|annum|annual|hour|hr))?/i,
                /\$[\d,]+(?:\.\d{2})?\s*(?:-|\u2013|\u2014)\s*\$[\d,]+(?:\.\d{2})?/i,
                /\$[\d,]+\s*(?:\/k|k)\s*(?:-|\u2013|\u2014)+\s*\$?[\d,]+\s*(?:\/k|k)/i,
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
            ];
            for (const pattern of salaryPatterns) {
                const m = normalizedText.match(pattern);
                if (m) {
                    const context = normalizedText.substring(Math.max(0, m.index - 80), Math.min(normalizedText.length, m.index + m[0].length + 80));
                    return formatSalary(m[0].trim(), context);
                }
            }

            // Last-resort fallback for messy formatting like:
            // "Compensation Range- $175,000-250,000, depending on ..."
            const keywordWindow = normalizedText.match(/(?:compensation|salary|pay)[\s\S]{0,80}\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s*(?:-|to|and)\s*\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?/i);
            if (keywordWindow) {
                return formatSalary(keywordWindow[0].trim(), keywordWindow[0]);
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

        function hasSpecialtyCertificationSignal(text) {
            if (!text) return false;
            return /\bboard[\s-]+certified\b/i.test(text) ||
                /\bresidenc(?:y|e)[\s-]+trained\b/i.test(text);
        }

        // Determine Area of Practice
        // Priority: 1) Title-specific overrides (urgent care), 2) Industry/Category from JSON-LD, 3) title keywords, 4) description qualifications
        function determineAreaOfPractice(positionText, descriptionText) {
            const title = positionText.toLowerCase();
            const category = getIndustryCategory(descriptionText).toLowerCase();

            // STEP 0: Title-specific overrides — these are MORE specific than Jobvite categories.
            // e.g. "Urgent Care Veterinarian" is categorized as "Veterinarian (ER)" on Jobvite,
            // but "urgent care" in the title is a more precise signal than the broad ER bucket.
            if (title.includes('urgent care')) return 'Urgent Care';

            // Board-certified or residency-trained roles are specialty roles even if Jobvite category is broad.
            if (hasSpecialtyCertificationSignal(descriptionText)) return 'Specialty Care';

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
            const t = title.toLowerCase();

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
            if (t.includes('theriogenologist') || t.includes('theriogenology')) return 'Theriogenologist';
            if (t.includes('internist') || t.includes('internal medicine')) return 'Internal Medicine Specialist';
            if (t.includes('criticalist') || t.match(/\becc\b/) || t.includes('emergency medicine')) return 'ECC Specialist';
            if (t.includes('dabvp')) return 'DABVP Specialist';
            if ((t.includes('dental') || t.includes('dentist') || t.includes('dentistry')) && !t.includes('assistant')) return 'Dental Specialist';
            // For surgeon, be specific - check it's not part of neurosurgeon (already handled)
            if ((t.includes('surgeon') || t.includes('surgery')) && !t.includes('neurosurgeon') && !t.includes('neurology') && !t.includes('dental') && !t.includes('dentistry')) return 'Surgeon';

            // === VTS/CREDENTIALED SPECIALIST (check before generic technician) ===
            if (t.includes('technician specialist') || (t.match(/\bvts\b/) && t.includes('specialist'))) return 'Credentialed Veterinary Technician Specialist';

            // === ANIMAL TYPE & PRACTICE SCOPE ===
            if (t.includes('equine') || t.includes('bovine') || t.includes('large animal')) return 'Equine/Bovine Veterinarian/Large Animal';
            if (t.includes('avian') || t.includes('exotics')) return 'Avian & Exotics Veterinarian / Associate Exotics';

            // === GENERAL VETERINARY ROLES ===
            if (t.includes('partner veterinarian')) return 'Partner Veterinarian';

            return '';
        }

        // Match position from qualifications section
        function matchPositionFromQualifications(descriptionText) {
            const qualSection = extractQualificationsSection(descriptionText);
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

            // Completely unknown AOP — still validate against all known positions
            const allValid = new Set(Object.values(validPositions).flat());
            if (allValid.has(position)) return position;

            return 'Associate Veterinarian';
        }

        // Determine Position
        function determinePosition(positionText, descriptionText, areaOfPractice) {
            let position = matchPositionFromTitle(positionText);
            if (!position && areaOfPractice === 'Specialty Care') {
                position = matchPositionFromQualifications(descriptionText);
            }
            if (position) {
                position = validatePositionForAOP(position, areaOfPractice);
            }
            // Special case: if title explicitly says "Medical Director" but AOP validation
            // downgraded it (e.g., ER category), keep it as Medical Director
            if (position === 'Associate Veterinarian' && positionText.toLowerCase().includes('medical director')) {
                position = 'Medical Director';
            }
            if (!position) position = 'Associate Veterinarian';
            return position;
        }

        // Extract locations from stored description (which now includes JSON-LD data)
        function extractLocations(text) {
            const locations = [];
            const listingLoc = parseListingLocation(listingLocation);
            if (listingLoc) locations.push(listingLoc);

            // First try to extract from structured JSON-LD data in the text
            // Format from description-scraper: "  - City, ST, Country" or "  - City, State"
            const locationsSection = locations.length === 0 ? text.match(/Locations:\n((?:\s*-\s*[^\n]+\n?)+)/i) : null;
            if (locationsSection) {
                const locationLines = locationsSection[1].split('\n');
                for (const line of locationLines) {
                    const trimmed = line.trim();
                    if (!trimmed.startsWith('-')) continue;
                    // Remove leading "- " and split by comma
                    const parts = trimmed.replace(/^-\s*/, '').split(',').map(s => s.trim()).filter(s => s);
                    if (parts.length >= 2) {
                        const city = normalizeCityName(parts[0]);
                        let state = parts[1];
                        // Try to find a 2-letter state abbreviation elsewhere in the text for this city
                        if (state.length > 2) {
                            const stateAbbrev = text.match(new RegExp(`${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')},\\s*([A-Z]{2})\\b`));
                            if (stateAbbrev) {
                                state = stateAbbrev[1];
                            }
                        }
                        if (city && /^[A-Z]{2}$/.test(state)) {
                            locations.push({ city, state, location: `${city}, ${state}` });
                        }
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
                    let city = normalizeCityName(match[1]);
                    const state = match[2].trim();

                    if (city && /^[A-Z]{2}$/.test(state)) {
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
            // First try to extract from structured JSON-LD data in the text
            const hiringOrgMatch = text.match(/Hiring Organization:\s*([^\n]+)/i);
            if (hiringOrgMatch) {
                return hiringOrgMatch[1].trim();
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
        // Rules: "part time or full time" / "full time or part time" → Full-Time
        //        only "part time" / "part-time" mentioned → Part-Time
        //        nothing mentioned or only "full time" → Full-Time (default)
        function extractJobType(text) {
            if (!text) return 'Full-Time';
            const lower = text.toLowerCase();

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

        const savedTitle = getSavedDescriptionField(descriptionText, 'Title');
        const effectiveTitle = savedTitle || positionTitle || '';

        // Run all extractions
        const salary = extractSalary(descriptionText);
        const areaOfPractice = determineAreaOfPractice(effectiveTitle, descriptionText);
        const position = determinePosition(effectiveTitle, descriptionText, areaOfPractice);
        const locations = extractLocations(descriptionText);
        const hospitalName = extractHospitalName(descriptionText);
        const jobType = extractJobType(descriptionText);

        return {
            title: effectiveTitle,
            salary,
            areaOfPractice,
            position,
            locations,
            hospitalName,
            jobType
        };
    }

    function formatPhoneToPlus1(phone) {
        if (!phone) return '';
        const digits = String(phone).replace(/[^\d]/g, '');
        let core = '';
        if (digits.length === 11 && digits.startsWith('1')) core = digits.slice(1);
        else if (digits.length === 10) core = digits;
        if (!core) return '';
        return `+1 (${core.slice(0, 3)}) ${core.slice(3, 6)}-${core.slice(6)}`;
    }

    // Google Maps address fetcher:
    // Opens Google Maps search URL directly with raw hospital listing value and scrapes place details.
    async function fetchAddressFromGoogleMaps(rawHospitalValue) {
        const searchQuery = String(rawHospitalValue || '').trim();
        const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`;
        if (!searchQuery) {
            return { streetAddress: '', city: '', state: '', fullAddress: '', website: '', phone: '', zipCode: '', placeName: '' };
        }

        const extractZip = (text) => {
            if (!text) return '';
            const m = String(text).match(/\b(\d{5}(?:-\d{4})?)\b/);
            return m ? m[1] : '';
        };

        function scrapeGoogleMapsTab(url, queryLabel) {
            return new Promise((resolve) => {
                let tabId = null;
                let listener = null;
                let settled = false;
                const waitForTabComplete = (targetTabId, timeoutMs = 12000) => new Promise((res) => {
                    let done = false;
                    const finishWait = () => {
                        if (done) return;
                        done = true;
                        chrome.tabs.onUpdated.removeListener(onUpdatedWait);
                        res();
                    };
                    const onUpdatedWait = (updatedTabId, info) => {
                        if (updatedTabId === targetTabId && info.status === 'complete') finishWait();
                    };
                    chrome.tabs.onUpdated.addListener(onUpdatedWait);
                    setTimeout(finishWait, timeoutMs);
                });

                const runMapsScraper = async (targetTabId, retries = 2) => {
                    for (let i = 0; i <= retries; i++) {
                        try {
                            const results = await chrome.scripting.executeScript({
                                target: { tabId: targetTabId },
                                files: ['google-maps-scraper.js']
                            });
                            return results?.[0]?.result || {};
                        } catch (err) {
                            const msg = String(err?.message || err || '');
                            const isFrameReset = /Frame with ID 0 was removed|No frame with id 0|Cannot access contents of url/i.test(msg);
                            if (!isFrameReset || i === retries) throw err;
                            await new Promise(r => setTimeout(r, 1200));
                            await waitForTabComplete(targetTabId, 8000);
                        }
                    }
                    return {};
                };

                const finish = (value) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeout);
                    if (listener) chrome.tabs.onUpdated.removeListener(listener);
                    if (tabId) chrome.tabs.remove(tabId).catch(() => {});
                    resolve(value);
                };

                const timeout = setTimeout(() => {
                    console.warn(`Google Maps timeout for: "${queryLabel}"`);
                    finish({ streetAddress: '', zipCode: '', city: '', state: '', fullAddress: '', website: '', phone: '', placeName: '' });
                }, 30000);

                chrome.tabs.create({ url: url, active: false }, (tab) => {
                    if (!tab) {
                        finish({ streetAddress: '', zipCode: '', city: '', state: '', fullAddress: '', website: '', phone: '', placeName: '' });
                        return;
                    }

                    tabId = tab.id;
                    listener = (updatedTabId, info) => {
                        if (updatedTabId === tabId && info.status === 'complete') {
                            chrome.tabs.onUpdated.removeListener(listener);
                            listener = null;

                            setTimeout(() => {
                                runMapsScraper(tabId, 2).then((data) => {
                                    const hasData = !!(data.streetAddress || data.fullAddress || data.phone || data.zipCode || data.placeName);
                                    if (hasData) {
                                        finish({
                                            streetAddress: data.streetAddress || '',
                                            zipCode: data.zipCode || '',
                                            city: data.city || '',
                                            state: data.state || '',
                                            fullAddress: data.fullAddress || '',
                                            website: data.website || '',
                                            phone: data.phone || '',
                                            placeName: data.placeName || ''
                                        });
                                        return;
                                    }

                                    // Retry same URL once more in case Maps rewired the page state.
                                    const fallbackUrl = `https://www.google.com/maps/search/${encodeURIComponent(queryLabel)}`;
                                    chrome.tabs.update(tabId, { url: fallbackUrl }, async () => {
                                        await waitForTabComplete(tabId, 12000);
                                        setTimeout(() => {
                                            runMapsScraper(tabId, 2).then((retryData) => {
                                                finish({
                                                    streetAddress: retryData.streetAddress || '',
                                                    zipCode: retryData.zipCode || '',
                                                    city: retryData.city || '',
                                                    state: retryData.state || '',
                                                    fullAddress: retryData.fullAddress || '',
                                                    website: retryData.website || '',
                                                    phone: retryData.phone || '',
                                                    placeName: retryData.placeName || ''
                                                });
                                            }).catch((retryErr) => {
                                                console.error(`Google Maps retry script error for "${queryLabel}":`, retryErr);
                                                finish({ streetAddress: '', zipCode: '', city: '', state: '', fullAddress: '', website: '', phone: '', placeName: '' });
                                            });
                                        }, 3000);
                                    });
                                }).catch((err) => {
                                    console.error(`Google Maps script error for "${queryLabel}":`, err);
                                    finish({ streetAddress: '', zipCode: '', city: '', state: '', fullAddress: '', website: '', phone: '', placeName: '' });
                                });
                            }, 2500);
                        }
                    };

                    chrome.tabs.onUpdated.addListener(listener);
                });
            });
        }

        console.log(`Google Maps search: "${searchQuery}"`);
        let data = await scrapeGoogleMapsTab(mapsUrl, searchQuery);

        if (!(data.streetAddress || data.fullAddress || data.phone || data.zipCode)) {
            const simplifiedName = searchQuery
                .replace(/&/g, 'and')
                .replace(/[-–—()]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            const altQuery = simplifiedName;
            if (altQuery !== searchQuery) {
                const altMapsUrl = `https://www.google.com/maps`;
                data = await scrapeGoogleMapsTab(altMapsUrl, altQuery);
            }
        }

        const finalData = {
            streetAddress: data.streetAddress || '',
            city: data.city || '',
            state: data.state || '',
            fullAddress: data.fullAddress || '',
            website: data.website || '',
            phone: formatPhoneToPlus1(data.phone || ''),
            zipCode: data.zipCode || extractZip(data.fullAddress) || '',
            placeName: data.placeName || ''
        };

        if (finalData.streetAddress || finalData.zipCode) {
            console.log(`Address fetch success: "${searchQuery}"`);
            console.log(`  Street="${finalData.streetAddress}", City="${finalData.city}", State="${finalData.state}", Zip="${finalData.zipCode}"`);
        } else {
            console.warn(`No address found for: "${searchQuery}"`);
        }

        return finalData;
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

        jobs.forEach((job, index) => {
            const row = tableBody.insertRow();
            const jobKey = getJobSelectionKey(job);

            // Mark new jobs with green background
            if (job.isNewLocation) {
                row.style.backgroundColor = '#d1fae5';
            }

            const selectCell = row.insertCell(0);
            selectCell.style.textAlign = 'center';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = selectedJobKeys.has(jobKey);
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) selectedJobKeys.add(jobKey);
                else selectedJobKeys.delete(jobKey);
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
            row.insertCell(4).textContent = job.areaOfPractice || '-';
            row.insertCell(5).textContent = job.position || '-';
            row.insertCell(6).textContent = job.salary || '-';
            row.insertCell(7).textContent = job.jobType || '-';
            const linkCell = row.insertCell(8);
            const link = document.createElement('a');
            link.href = job.link;
            link.textContent = 'View Job';
            link.target = '_blank';
            linkCell.appendChild(link);
            row.insertCell(9).textContent = job.hospital || '-';
            row.insertCell(10).textContent = job.city || '-';
            row.insertCell(11).textContent = job.state || '-';
            row.insertCell(12).textContent = job.phone || '-';
            row.insertCell(13).textContent = 'Alliance Animal (Parent Client)';
            row.insertCell(14).textContent = job.streetAddress || '-';
            row.insertCell(15).textContent = job.zipCode || '-';

            // Website column — show as clickable link if available
            const websiteCell = row.insertCell(16);
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

            row.insertCell(17).textContent = job.location;

            const descCell = row.insertCell(18);
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
            (job.jobType || '').toLowerCase().includes(term)
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

        const headers = ['#', 'Job Title', 'Job ID', 'Area of Practice', 'Position', 'Salary', 'Job Type', 'Link', 'Hospital', 'City', 'State', 'Phone', 'Aggregator', 'Street Address', 'Zip Code', 'Website', 'Location', 'Description'];
        const csvContent = [
            headers.join(','),
            ...allJobs.map((job, index) => [
                index + 1,
                `"${(job.title || '').replace(/"/g, '""')}"`,
                `"${(job.jobId || '').replace(/"/g, '""')}"`,
                `"${(job.areaOfPractice || '').replace(/"/g, '""')}"`,
                `"${(job.position || '').replace(/"/g, '""')}"`,
                `"${(job.salary || '').replace(/"/g, '""')}"`,
                `"${(job.jobType || '').replace(/"/g, '""')}"`,
                `"${(job.link || '').replace(/"/g, '""')}"`,
                `"${(job.hospital || '').replace(/"/g, '""')}"`,
                `"${(job.city || '').replace(/"/g, '""')}"`,
                `"${(job.state || '').replace(/"/g, '""')}"`,
                `"${(job.phone || '').replace(/"/g, '""')}"`,
                `"Alliance Animal (Parent Client)"`,
                `"${(job.streetAddress || '').replace(/"/g, '""')}"`,
                `"${(job.zipCode || '').replace(/"/g, '""')}"`,
                `"${(job.website || '').replace(/"/g, '""')}"`,
                `"${(job.location || '').replace(/"/g, '""')}"`,
                `"${(job.description || '').replace(/"/g, '""')}"`
            ].join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);

        link.setAttribute('href', url);
        link.setAttribute('download', `uvc_jobs_${new Date().toISOString().split('T')[0]}.csv`);
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

    // Export CSV
    if (exportCsvButton) {
        exportCsvButton.addEventListener('click', exportToCSV);
    }

    // Clear details only (area of practice, position, salary)
    const clearDetailsBtn = document.getElementById('clearDetailsBtn');
    clearDetailsBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all job details? This will remove Area of Practice, Position, Salary, and Job Type from all jobs.')) {
            chrome.storage.local.get(['scrapedJobs'], (data) => {
                const jobs = data.scrapedJobs || [];
                let clearedCount = 0;

                jobs.forEach(job => {
                    if (job.areaOfPractice || job.position || job.salary || job.jobType) {
                        job.areaOfPractice = '';
                        job.position = '';
                        job.salary = '';
                        job.jobType = '';
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
                    delete job.descriptionFetchFailed;
                    delete job.descriptionError;
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

    if (selectAllHeader) {
        selectAllHeader.addEventListener('click', () => {
            const searchTerm = searchInput ? searchInput.value.trim().toLowerCase() : '';
            let visibleJobs = [...allJobs];

            if (searchTerm) {
                visibleJobs = visibleJobs.filter(job =>
                    (job.title || '').toLowerCase().includes(searchTerm) ||
                    (job.hospital || '').toLowerCase().includes(searchTerm) ||
                    (job.city || '').toLowerCase().includes(searchTerm) ||
                    (job.state || '').toLowerCase().includes(searchTerm) ||
                    (job.location || '').toLowerCase().includes(searchTerm) ||
                    (job.streetAddress || '').toLowerCase().includes(searchTerm) ||
                    (job.zipCode || '').toLowerCase().includes(searchTerm) ||
                    (job.phone || '').toLowerCase().includes(searchTerm) ||
                    (job.website || '').toLowerCase().includes(searchTerm) ||
                    (job.areaOfPractice || '').toLowerCase().includes(searchTerm) ||
                    (job.position || '').toLowerCase().includes(searchTerm) ||
                    (job.jobType || '').toLowerCase().includes(searchTerm)
                );
            }

            if (currentSortColumn) {
                visibleJobs = sortRecords(currentSortColumn, currentSortDirection, visibleJobs);
            }

            if (visibleJobs.length === 0) return;

            const allVisibleSelected = visibleJobs.every(job => selectedJobKeys.has(getJobSelectionKey(job)));
            visibleJobs.forEach(job => {
                const key = getJobSelectionKey(job);
                if (allVisibleSelected) selectedJobKeys.delete(key);
                else selectedJobKeys.add(key);
            });
            refreshDisplayedJobs();
        });
    }

    if (deleteSelectedBtn) {
        deleteSelectedBtn.addEventListener('click', () => {
            const selectedCount = allJobs.filter(job => selectedJobKeys.has(getJobSelectionKey(job))).length;
            if (!selectedCount) {
                showToast('No jobs selected.', 'error');
                return;
            }

            if (!confirm(`Delete ${selectedCount} selected job(s)?`)) return;

            const remainingJobs = allJobs.filter(job => !selectedJobKeys.has(getJobSelectionKey(job)));
            chrome.storage.local.set({ scrapedJobs: remainingJobs }, () => {
                allJobs = remainingJobs;
                selectedJobKeys.clear();
                refreshDisplayedJobs();
                showToast(`Deleted ${selectedCount} selected jobs.`, 'success');
            });
        });
    }

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
            aggregator: "Alliance Animal (Parent Client)",
            street_address: job.streetAddress || '',
            parent_client: "Alliance Animal (Parent Client)",
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
                source: 'Alliance Animal Job Scraper',
                parentClientName: 'Alliance Animal (Parent Client)',
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

        jobs.forEach(job => {
            if (!job.description) {
                delete job.descriptionFetchFailed;
                delete job.descriptionError;
            }
        });
        await chrome.storage.local.set({ scrapedJobs: jobs });

        const jobsWithoutDesc = jobs.filter(job => !job.description && !job.descriptionFetchFailed && job.link);
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

        const jobsWithoutDesc = jobs.filter(job => !job.description && !job.descriptionFetchFailed && job.link);
        const totalOriginal = jobs.filter(job => job.link).length;
        const totalWithoutDesc = jobsWithoutDesc.length;
        const processed = totalOriginal - totalWithoutDesc;

        // Update progress
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        const totalToProcess = jobs.filter(job => !job.description && !job.descriptionFetchFailed && job.link).length;
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

    // Listen for description saved/failed messages from background.js
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
        } else if (message.action === 'descriptionFailed') {
            chrome.storage.local.get(['scrapedJobs'], (data) => {
                const jobs = data.scrapedJobs || [];
                if (jobs[message.jobIndex]) {
                    jobs[message.jobIndex].descriptionFetchFailed = true;
                    jobs[message.jobIndex].descriptionError = message.message || 'Failed to fetch description.';
                }

                chrome.storage.local.set({ scrapedJobs: jobs }, () => {
                    allJobs = jobs;
                    displayRecords(allJobs);

                    if (isGettingDescriptions) {
                        showToast(`Skipped one description: ${message.message || 'failed to fetch'}`, 'error');
                        setTimeout(() => processNextJob(), 500);
                    }
                });
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

        // Find jobs that need details and already have saved descriptions.
        // Details are derived from the saved job description, not from a fresh tab scrape.
        const jobsToFetch = jobs.map((job, index) => ({ job, index }))
            .filter(item => {
                if (shouldSkipFetchDetails(item.job)) return false;
                if (!item.job.description) return false;
                const needsDetails = !item.job.areaOfPractice || !item.job.position;
                const normalizedLocation = normalizeLocationText(item.job.location);
                const needsLocationCleanup = normalizedLocation && normalizedLocation !== item.job.location;
                const description = item.job.description || '';
                const salary = item.job.salary || '';
                const descriptionHasSalary = /\$[\d,]+(?:\.\d{2})?/.test(description) && /salary|pay|compensation|\$/i.test(description);
                const salaryLooksWrongHourly = /(?:per\s+)?(?:hour|hr)|\/\s*hr|hourly/i.test(description) && /per year/i.test(salary);
                const needsSalaryCleanup = (!salary && descriptionHasSalary) || salaryLooksWrongHourly;
                const needsSpecialtyAOPCleanup = item.job.areaOfPractice !== 'Specialty Care' &&
                    (/\bboard[\s-]+certified\b/i.test(description) || /\bresidenc(?:y|e)[\s-]+trained\b/i.test(description));
                return needsDetails || needsLocationCleanup || needsSalaryCleanup || needsSpecialtyAOPCleanup;
            });

        const jobsWithDescriptions = jobs.map((job, index) => ({ job, index }))
            .filter(item => item.job.description && !shouldSkipFetchDetails(item.job));

        if (jobsWithDescriptions.length === 0) {
            showToast('No saved descriptions found. Click "Get Descriptions" first, then Fetch Details.', 'error');
            return;
        }

        if (jobsToFetch.length === 0) {
            if (confirm('All jobs with saved descriptions already have details. Do you want to re-analyze them?')) {
                detailsQueue = jobsWithDescriptions;
            } else {
                return;
            }
        } else {
            detailsQueue = jobsToFetch;
        }

        isFetchingDetails = true;
        currentDetailsIndex = 0;
        fetchDetailsBtn.disabled = true;
        fetchDetailsBtn.textContent = 'Analyzing Descriptions...';

        // Show progress
        const progressSection = document.getElementById('progressSection');
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        const progressLabel = document.getElementById('progressLabel');
        progressSection.classList.remove('hidden');
        progressLabel.textContent = 'Analyzing Saved Descriptions';
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
        let detailsList = [];

        // Extract details locally from the already-saved description.
        const positionTitle = job.title || '';
        const description = job.description || '';

        if (description) {
            const extracted = extractDetailsFromDescription(positionTitle, description, job.location || '');

            // Build detailsList with ALL locations for multi-location jobs
            if (extracted.locations && extracted.locations.length > 0) {
                detailsList = extracted.locations.map(loc => ({
                    areaOfPractice: extracted.areaOfPractice,
                    position: extracted.position,
                    salary: extracted.salary,
                    hospitalName: extracted.hospitalName,
                    jobType: extracted.jobType,
                    description: description,
                    city: loc.city || '',
                    state: loc.state || '',
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

                // Step 1: Determine AOP — prefer detail extractor's AOP (from page category), fall back to title
                let finalAOP = detailAOP || getAOPFromTitle(listingTitle) || 'General Practice Care';
                const listingTitleLower = listingTitle.toLowerCase();

                // Step 1b: If AOP is a multi-value compound, force a single AOP by title rules.
                // Rule priority:
                // 1) Urgent in title -> Urgent Care
                // 2) Emergency/ER in title -> Emergency Care
                // 3) Associate Veterinarian in title -> General Practice Care
                if (finalAOP.includes('/')) {
                    if (listingTitleLower.includes('urgent')) {
                        finalAOP = 'Urgent Care';
                    } else if (
                        listingTitleLower.includes('emergency') ||
                        /\ber\b/.test(listingTitleLower) ||
                        listingTitleLower.includes('er vet') ||
                        listingTitleLower.includes('er dvm')
                    ) {
                        finalAOP = 'Emergency Care';
                    } else if (/\bassociate\s+veterinarian\b/.test(listingTitleLower)) {
                        finalAOP = 'General Practice Care';
                    }
                }

                // Step 2: Match position from listing title
                let finalPosition = firstDetail.position || getPositionFromTitle(listingTitle);

                // Step 3: If listing title had no match but AOP is Specialty, try qualifications from description
                if (!finalPosition && finalAOP === 'Specialty Care') {
                    const desc = (firstDetail.description || originalJob.description || '').toLowerCase();
                    if (desc.includes('dacvecc')) finalPosition = 'ECC Specialist';
                    else if (desc.includes('dacvim') && desc.includes('oncology')) finalPosition = 'Medical Oncologist';
                    else if (desc.includes('dacvr') && desc.includes('radiation')) finalPosition = 'Radiation Oncologist';
                    else if (desc.includes('dacvim') && desc.includes('neurology')) finalPosition = 'Neurologist & Neurosurgeon';
                    else if (desc.includes('dacvim') && desc.includes('cardiology')) finalPosition = 'Cardiologist';
                    else if (desc.includes('dacvim')) finalPosition = 'Internal Medicine Specialist';
                    else if (desc.includes('davdc')) finalPosition = 'Dental Specialist';
                    else if (desc.includes('dacvd')) finalPosition = 'Dermatologist';
                    else if (desc.includes('dacvs') || desc.includes('acvs')) finalPosition = 'Surgeon';
                    else if (desc.includes('dacvr')) finalPosition = 'Radiologist';
                    else if (desc.includes('dacvo')) finalPosition = 'Ophthalmologist';
                    else if (desc.includes('dacvaa')) finalPosition = 'Anesthesiologist';
                    else if (desc.includes('dact')) finalPosition = 'Theriogenologist';
                    else if (desc.includes('dabvp')) finalPosition = 'DABVP Specialist';
                }

                // Step 4: Validate position against AOP
                if (finalPosition) {
                    finalPosition = getValidatedPosition(finalPosition, finalAOP);
                }

                // Step 5: Medical Director override — if title says "Medical Director", keep it
                if ((!finalPosition || finalPosition === 'Associate Veterinarian') && listingTitleLower.includes('medical director')) {
                    finalPosition = 'Medical Director';
                }

                // Step 6: Default
                if (!finalPosition) {
                    finalPosition = 'Associate Veterinarian';
                }

                // Step 7: Force single AOP when extractor returns compound AOP.
                // Rules:
                // - If title indicates urgent -> Urgent Care
                // - Else if title indicates emergency/ER -> Emergency Care
                // - Else if associate veterinarian role -> General Practice Care
                // - Else default General Practice Care
                if (typeof finalAOP === 'string' && finalAOP.includes('/')) {
                    if (listingTitleLower.includes('urgent')) {
                        finalAOP = 'Urgent Care';
                    } else if (
                        listingTitleLower.includes('emergency') ||
                        /\ber\b/.test(listingTitleLower) ||
                        listingTitleLower.includes('er vet') ||
                        listingTitleLower.includes('er dvm')
                    ) {
                        finalAOP = 'Emergency Care';
                    } else if (
                        /\bassociate\s+veterinarian\b/.test(listingTitleLower) ||
                        finalPosition === 'Associate Veterinarian'
                    ) {
                        finalAOP = 'General Practice Care';
                    } else {
                        finalAOP = 'General Practice Care';
                    }
                }

                // Update original job with extracted details
                originalJob.areaOfPractice = finalAOP;
                originalJob.position = finalPosition;
                originalJob.salary = firstDetail.salary || originalJob.salary || '';
                if (isUsableHospitalName(firstDetail.hospitalName)) {
                    originalJob.hospital = firstDetail.hospitalName;
                    originalJob.hospitalName = firstDetail.hospitalName;
                } else if (originalJob.hospital) {
                    originalJob.hospitalName = originalJob.hospital;
                }
                originalJob.jobType = firstDetail.jobType || originalJob.jobType || 'Full-Time';
                const normalizedOriginalCity = normalizeCityName(originalJob.city);
                const normalizedDetailCity = normalizeCityName(firstDetail.city);
                if (!normalizedOriginalCity && normalizedDetailCity) originalJob.city = normalizedDetailCity;
                else if (normalizedOriginalCity && normalizedOriginalCity !== originalJob.city) originalJob.city = normalizedOriginalCity;
                if (!originalJob.state && firstDetail.state) originalJob.state = firstDetail.state;
                const normalizedOriginalLocation = normalizeLocationText(originalJob.location);
                const normalizedDetailLocation = normalizeLocationText(firstDetail.location);
                if (normalizedOriginalLocation && normalizedOriginalLocation !== originalJob.location) {
                    originalJob.location = normalizedOriginalLocation;
                } else if (!originalJob.location && normalizedDetailLocation) {
                    originalJob.location = normalizedDetailLocation;
                }
                if (originalJob.city && originalJob.state && originalJob.location && originalJob.location !== `${originalJob.city}, ${originalJob.state}`) {
                    originalJob.location = `${originalJob.city}, ${originalJob.state}`;
                }
                // Update description if we got a better one
                if (firstDetail.description && firstDetail.description.length > (originalJob.description || '').length) {
                    originalJob.description = firstDetail.description;
                }

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
                        const baseJobId = originalJob.jobId || `UVC-${Date.now()}`;
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
                            hospitalName: childHospital,
                            city: normalizeCityName(loc.city) || '',
                            state: loc.state || '',
                            location: loc.location || `${loc.city}, ${loc.state}`,
                            streetAddress: '',
                            zipCode: '',
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

    fetchAddressesBtn.addEventListener('click', async () => {
        if (isFetchingAddresses) {
            showToast('Already fetching addresses. Please wait...', 'error');
            return;
        }

        const data = await chrome.storage.local.get(['scrapedJobs']);
        const jobs = data.scrapedJobs || [];

        // Find jobs that need addresses (using LOCATION column)
        const jobsNeedingAddresses = jobs.map((job, index) => ({ job, index }))
            .filter(item => {
                // Jobs that don't have street address or zip code
                return item.job.hospital && item.job.location &&
                    (!item.job.streetAddress || !item.job.zipCode);
            });

        if (jobsNeedingAddresses.length === 0) {
            if (confirm('All jobs already have addresses. Do you want to re-fetch addresses for all jobs?')) {
                addressQueue = jobs.map((job, index) => ({ job, index }))
                    .filter(item => item.job.hospital && item.job.location);
            } else {
                return;
            }
        } else {
            addressQueue = jobsNeedingAddresses;
        }

        if (addressQueue.length === 0) {
            showToast('No jobs have valid hospital/location data to fetch addresses.', 'error');
            return;
        }

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
        progressLabel.textContent = 'Fetching Street Addresses & Zip Codes';
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
            const rawHospitalForSearch = (job.hospitalRaw || job.hospital || '').trim();
            const addressData = await fetchAddressFromGoogleMaps(rawHospitalForSearch);

            // Update job with address data from Google Maps
            const data = await chrome.storage.local.get(['scrapedJobs']);
            const jobs = data.scrapedJobs || [];

            if (jobs[index]) {
                if (addressData.streetAddress) {
                    jobs[index].streetAddress = addressData.streetAddress;
                }
                if (addressData.zipCode) {
                    jobs[index].zipCode = addressData.zipCode;
                }

                // City and state: prefer Google Maps data, then existing values
                jobs[index].city = addressData.city || jobs[index].city || '';
                jobs[index].state = getFullStateName(addressData.state || jobs[index].state || '');

                // Try to extract zip from fullAddress if parsing missed it
                if (!jobs[index].zipCode && addressData.fullAddress) {
                    const zipFromFull = addressData.fullAddress.match(/\b(\d{5}(?:-\d{4})?)\b/);
                    if (zipFromFull) jobs[index].zipCode = zipFromFull[1];
                }

                // Website and phone from Google Maps
                if (addressData.website) {
                    jobs[index].website = addressData.website;
                }
                if (addressData.phone) {
                    jobs[index].phone = addressData.phone;
                }
                if (addressData.placeName) {
                    jobs[index].hospital = addressData.placeName;
                    jobs[index].hospitalName = addressData.placeName;
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
        setTimeout(() => processNextAddress(), 1500);
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
