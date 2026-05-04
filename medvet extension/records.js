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
    const MEDVET_AGGREGATOR = 'MedVet Emergency & Specialty Veterinary Care (Parent Client)';

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
    let currentlyDisplayedJobs = [];
    const selectedJobKeys = new Set();
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
            return 'http://localhost/zoho-api-main/webhookusvta/api/webhook.php';
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

    function getStateAbbreviation(state) {
        if (!state) return '';
        const trimmed = state.trim().replace(/\.$/, '');
        if (/^[A-Z]{2}$/i.test(trimmed)) return trimmed.toUpperCase();

        const normalized = trimmed.toLowerCase();
        const match = Object.entries(stateAbbreviations).find(([, fullName]) => fullName.toLowerCase() === normalized);
        return match ? match[0] : trimmed;
    }

    function normalizeHospitalLocation(city, state) {
        const cleanCity = (city || '').trim().replace(/\s+/g, ' ');
        const cleanState = getStateAbbreviation(state || '');
        if (cleanCity && cleanState) return `${cleanCity}, ${cleanState}`;
        return cleanCity || cleanState || '';
    }

    function parseHospitalLocationText(value) {
        if (!value) return null;
        const cleaned = value
            .replace(/\([^)]*\)/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/\s+,/g, ',')
            .trim();
        const stateNames = Object.values(stateAbbreviations).join('|');
        const match = cleaned.match(new RegExp(`\\b([A-Z][A-Za-z .'-]+?)\\s*,\\s*([A-Z]{2}|${stateNames})\\b`, 'i'));
        if (!match) return null;

        const city = match[1]
            .replace(/\b(?:our|new|the|in|at|within|and|or)\b\s*$/i, '')
            .trim();
        const state = getStateAbbreviation(match[2]);
        if (!city || !state) return null;
        return { city, state, location: `${city}, ${state}` };
    }

    function parseCurrentJobLocation(job) {
        const direct = parseHospitalLocationText(job?.location || '');
        if (direct) return direct;
        const combined = normalizeHospitalLocation(job?.city || '', job?.state || '');
        return parseHospitalLocationText(combined);
    }

    function extractMedVetHospitalBrand(descriptionText, currentHospital) {
        const existing = (currentHospital || '').trim();
        if (/^westvet\b/i.test(existing)) return 'WestVet';
        if (/\bwestvet(?:\s*,\s*a\s+medvet\s+partner|\s+[A-Z][A-Za-z .'-]+?\s+(?:is|has|will|seeks|seeking|looks|looking))\b/i.test(descriptionText || '')) return 'WestVet';
        return 'MedVet';
    }

    function normalizeHospitalCompare(value) {
        return (value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    }

    function getDescriptionBodyText(descriptionText) {
        return (descriptionText || '').split(/===\s*FULL JOB DESCRIPTION\s*===/i).pop() || descriptionText || '';
    }

    function stripHospitalLocationSuffix(hospitalName) {
        const stateNames = Object.values(stateAbbreviations).join('|');
        return (hospitalName || '')
            .replace(/\s+/g, ' ')
            .replace(new RegExp(`\\s*-\\s*[A-Z][A-Za-z .'-]+,\\s*(?:[A-Z]{2}|${stateNames})\\s*$`, 'i'), '')
            .replace(new RegExp(`\\s*-\\s*(?:[A-Z]{2}|${stateNames})\\s*$`, 'i'), '')
            .trim();
    }

    function shouldRefreshHospitalName(hospitalName) {
        const raw = (hospitalName || '').trim();
        const cleaned = stripHospitalLocationSuffix(raw);
        if (!cleaned) return true;
        if (cleaned !== raw) return true;
        if (/^(?:MedVet|WestVet)$/i.test(cleaned)) return true;
        return isInvalidHospitalName(cleaned);
    }

    function isInvalidHospitalName(hospitalName) {
        const cleaned = (hospitalName || '').trim();
        if (!cleaned) return true;
        if (!/^(?:MedVet|WestVet)\b/i.test(cleaned)) return true;

        const siteName = cleaned.replace(/^(?:MedVet|WestVet)\s*/i, '').trim();
        if (!siteName) return false;

        return /\b(?:a\s+medvet\s+partner|established|team|at\s+our|join\s+our|seeks?|seeking|individual|candidate|hospital|critical\s+care|emergency\s+medicine|specialty\s+and\s+emergency|veterinarian|veterinarians?|board-certified|residency-trained)\b/i.test(siteName);
    }

    function cleanHospitalNameCandidate(candidate) {
        let cleaned = stripHospitalLocationSuffix(candidate)
            .replace(/\s*,\s*a\s+MedVet\s+partner\s*,?/i, '')
            .replace(/\b(?:is|has|will|seeks?|seeking|looks|looking|offers|works|provides)\b.*$/i, '')
            .replace(/\b(?:hospital|team|here|partner)\b.*$/i, '')
            .replace(/[?.!,;:]+$/g, '')
            .replace(/\s+/g, ' ')
            .trim();

        if (!cleaned && /^\s*WestVet\b/i.test(candidate || '')) cleaned = 'WestVet';
        if (!cleaned && /^\s*MedVet\b/i.test(candidate || '')) cleaned = 'MedVet';

        return isInvalidHospitalName(cleaned) ? '' : cleaned;
    }

    function resolveHospitalNameForSave(candidateHospitalName, currentHospitalName, fallbackBrand = 'MedVet') {
        const candidate = cleanHospitalNameCandidate(candidateHospitalName);
        if (candidate) return candidate;

        const current = cleanHospitalNameCandidate(currentHospitalName);
        if (current) return current;

        const brand = /westvet/i.test(`${candidateHospitalName || ''} ${currentHospitalName || ''}`) ? 'WestVet' : fallbackBrand;
        return brand;
    }

    function extractHospitalBaseNameFromDescription(descriptionText, job, location) {
        const text = getDescriptionBodyText(descriptionText).replace(/\s+/g, ' ');
        const brand = extractMedVetHospitalBrand(descriptionText, job?.hospital || job?.hospitalName || '');
        const priorityPatterns = [
            /\bWhy\s+(?:Join|join\s+the\s+team\s+at|will\s+you\s+love\s+working\s+at)\s+((?:MedVet|WestVet)(?:\s+[A-Z][A-Za-z0-9&'.-]+){0,4})\s*\?/ig,
            /\b((?:MedVet|WestVet)(?:\s+[A-Z][A-Za-z0-9&'.-]+){1,4})\s+(?:is|has|will|seeks|seeking|looks|looking|offers)\b/ig,
            /\b(?:at|for|with)\s+((?:MedVet|WestVet)(?:\s+[A-Z][A-Za-z0-9&'.-]+){1,4})(?:\?|\.|\s)/ig
        ];

        const locationCity = normalizeHospitalCompare(location?.city || '');
        const brandKey = normalizeHospitalCompare(brand);
        let brandOnlyCandidate = '';
        const siteCandidates = [];

        for (const pattern of priorityPatterns) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                const candidate = cleanHospitalNameCandidate(match[1]);
                if (!candidate) continue;

                const candidateBrand = candidate.match(/^(MedVet|WestVet)\b/i)?.[1] || brand;
                if (normalizeHospitalCompare(candidateBrand) !== brandKey) continue;

                const siteName = candidate.replace(/^(?:MedVet|WestVet)\s*/i, '').trim();
                if (!siteName) {
                    brandOnlyCandidate = candidateBrand;
                    continue;
                }

                siteCandidates.push(candidate);
            }
        }

        if (locationCity) {
            const locationMatch = siteCandidates.find(candidate => {
                const siteName = candidate.replace(/^(?:MedVet|WestVet)\s*/i, '').trim();
                return normalizeHospitalCompare(siteName) === locationCity;
            });
            if (locationMatch) return locationMatch;

        }

        return siteCandidates[0] || brandOnlyCandidate || brand;
    }

    function extractHospitalLocationFromDescription(descriptionText) {
        if (!descriptionText) return null;
        const bodyText = getDescriptionBodyText(descriptionText);
        const text = bodyText.replace(/\s+/g, ' ');
        const locationPattern = '([A-Z][A-Za-z .\'-]+?\\s*,\\s*(?:[A-Z]{2}|' + Object.values(stateAbbreviations).join('|') + '))';
        const patterns = [
            new RegExp(`\\b(?:join|support|serve|grow)[^.]{0,120}?\\bour\\s+(?:new\\s+)?${locationPattern}\\s*,?\\s+hospital\\b`, 'i'),
            new RegExp(`\\bjoin\\s+the\\s+team\\s+in\\s+our\\s+${locationPattern}\\s*,?\\s+hospital\\b`, 'i'),
            new RegExp(`\\bwithin\\s+our\\s+${locationPattern}\\s*,?\\s+hospital\\b`, 'i'),
            new RegExp(`\\bat\\s+our\\s+${locationPattern}\\s*,?\\s+hospital\\b`, 'i'),
            new RegExp(`\\bhospital\\s+in\\s+${locationPattern}\\b`, 'i'),
            new RegExp(`\\bnew\\s+location\\s+in\\s+${locationPattern}\\b`, 'i')
        ];

        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
                const parsed = parseHospitalLocationText(match[1]);
                if (parsed) return parsed;
            }
        }

        return null;
    }

    function extractHospitalCityFromDescription(descriptionText) {
        if (!descriptionText) return '';
        const bodyText = getDescriptionBodyText(descriptionText);
        const text = bodyText.replace(/\s+/g, ' ');
        const brandCityPatterns = [
            /\b(?:MedVet|WestVet)\s+([A-Z][A-Za-z .'-]{2,45}?)\s+(?:is|has|will|seeks|seeking|looks|looking)\b/i,
            /\bWhy\s+(?:Join|will\s+you\s+love\s+working\s+at)\s+(?:MedVet|WestVet)\s+([A-Z][A-Za-z .'-]{2,45}?)(?:\?|\.|\s)/i
        ];

        for (const pattern of brandCityPatterns) {
            const match = text.match(pattern);
            if (!match) continue;
            const city = match[1]
                .replace(/\b(?:hospital|team|here|and|partner)\b.*$/i, '')
                .trim();
            if (city && city.length < 50) return city;
        }

        return '';
    }

    function buildHospitalNameFromDescription(descriptionText, job, detailLocation = null) {
        const describedLocation = extractHospitalLocationFromDescription(descriptionText);
        const currentLocation = parseCurrentJobLocation(job);
        const locationFromDetail = detailLocation?.location
            ? parseHospitalLocationText(detailLocation.location)
            : (detailLocation?.city || detailLocation?.state ? parseHospitalLocationText(`${detailLocation.city || ''}, ${detailLocation.state || ''}`) : null);

        let location = describedLocation || currentLocation || locationFromDetail;

        if (!location) {
            const cityOnly = extractHospitalCityFromDescription(descriptionText);
            const stateFromCurrent = currentLocation?.state || getStateAbbreviation(job?.state || '');
            if (cityOnly && stateFromCurrent) {
                location = { city: cityOnly, state: stateFromCurrent, location: `${cityOnly}, ${stateFromCurrent}` };
            }
        }

        if (location?.city && currentLocation?.state && !location.state) {
            location.state = currentLocation.state;
            location.location = `${location.city}, ${location.state}`;
        }

        const baseHospitalName = extractHospitalBaseNameFromDescription(descriptionText, job, location);
        if (location?.city && location?.state) return formatHospitalName(baseHospitalName, location);
        return baseHospitalName;
    }

    function formatDetailLocation(loc) {
        const city = (loc?.city || '').trim();
        const state = getFullStateName(loc?.state || '');
        const location = city && state ? `${city}, ${state}` : (loc?.location || '').trim();
        return { city, state, location };
    }

    function buildHospitalNameForLocation(descriptionText, job, loc) {
        const describedLocation = extractHospitalLocationFromDescription(descriptionText);
        if (describedLocation) {
            const baseHospitalName = extractHospitalBaseNameFromDescription(descriptionText, job, describedLocation);
            return formatHospitalName(baseHospitalName, describedLocation);
        }

        const formatted = formatDetailLocation(loc);
        const baseHospitalName = extractHospitalBaseNameFromDescription(descriptionText, job, formatted);
        return formatted.city && formatted.state ? formatHospitalName(baseHospitalName, formatted) : buildHospitalNameFromDescription(descriptionText, job, loc);
    }

    function formatHospitalName(baseHospitalName, location) {
        const base = stripHospitalLocationSuffix(baseHospitalName);
        return isInvalidHospitalName(base) ? '' : base;
    }

    function makeLocationKey(loc) {
        return (loc?.location || [loc?.city, loc?.state].filter(Boolean).join(', '))
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    function specializeDescriptionForLocation(description, loc) {
        if (!description || !loc?.city) return description || '';
        const formatted = formatDetailLocation(loc);
        const stateAbbrev = getStateAbbreviation(formatted.state);
        const escapedCity = formatted.city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        let text = description;
        text = text.replace(/Locations:\n(?:\s*-\s*[^\n]+\n?)+/i, `Locations:\n  - ${formatted.city}, ${formatted.state}, United States\n`);
        text = text.replace(
            /\bjoin\s+our\s+[A-Z][A-Za-z .'-]+?\s+and\s+[A-Z][A-Za-z .'-]+?,\s*[A-Z]{2}\s+hospitals\b/i,
            `join our ${formatted.city}, ${formatted.state} hospital`
        );
        text = text.replace(
            /\bjoin\s+our\s+[A-Z][A-Za-z .'-]+?\s+and\s+[A-Z][A-Za-z .'-]+?,\s*[A-Za-z ]+\s+hospitals\b/i,
            `join our ${formatted.city}, ${formatted.state} hospital`
        );
        text = text.replace(/\b2 Locations\b/g, formatted.location);
        text = text.replace(
            /(Emergency Veterinarian\s+Emergency Medicine\s+)(?:[A-Z][A-Za-z .'-]+,\s*[A-Za-z ]+\s+){1,5}/i,
            `$1${formatted.location} `
        );
        text = text.replace(
            /(Emergency Veterinarian\s+Emergency Medicine\s+)(?:[A-Z][A-Za-z .'-]+,\s*[A-Z]{2}\s+){1,5}/i,
            `$1${formatted.location} `
        );
        text = text.replace(new RegExp(`Why\\s+Join\\s+MedVet\\s+[A-Z][A-Za-z .'-]+\\?`, 'i'), `Why Join MedVet ${formatted.city}?`);
        text = text.replace(new RegExp(`Why\\s+${escapedCity},\\s*(?:${stateAbbrev}|${formatted.state})\\?`, 'i'), `Why ${formatted.city}, ${formatted.state}?`);

        return text;
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
        'Avian and Exotic Specialis',
        'Radiation Oncologist',
        'Radiologist',
        'Sports Medicine & Rehabilitation Specialist',
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
            'Neurologist & Neurosurgeon', 'Ophthalmologist', 'Avian and Exotic Specialis', 'Radiation Oncologist',
            'Radiologist', 'Sports Medicine & Rehabilitation Specialist', 'Surgeon'
        ],
        'Urgent Care': ['Associate Veterinarian', 'Partner Veterinarian']
    };

    function extractQualificationSignalSection(text) {
        const match = (text || '').match(/(?:who you are|requirements?|qualifications?|preferred qualifications|what you'?ll need|what we'?re looking for|credentials?|must have|what we need)[:\s]*([\s\S]{0,900}?)(?=(?:benefits?|compensation|salary|about|our culture|location|equal|join us|why|facility|what we offer|ready to|key responsibilities|everything starts|come as you are|for more information)[:\s]|$)/i);
        return match ? match[1] : '';
    }

    function hasSpecialtyTrainingSignal(text) {
        const source = text || '';
        const qualificationText = extractQualificationSignalSection(source);
        const specialtyCredentialPattern = /\bboard[-\s]+certified\b|\bresidency[-\s]+trained\b|\bresidential[-\s]+trained\b/i;
        if (specialtyCredentialPattern.test(qualificationText)) return true;

        return /\b(?:seeking|join(?:ing)?|hiring)\b.{0,160}\b(?:board[-\s]+certified|residency[-\s]+trained|residential[-\s]+trained)\b.{0,120}\b(?:specialist|surgeon|oncologist|cardiologist|neurologist|dermatologist|ophthalmologist|radiologist|anesthesiologist|internist|criticalist|diplomate)\b/i.test(source);
    }

    function matchApprovedPositionFromText(text) {
        if (!text) return '';

        const rules = [
            ['Medical Director', [/\bmedical director\b/i]],
            ['Lead Veterinarian', [/\blead veterinarian\b/i, /\blead vet\b/i]],
            ['Neurologist & Neurosurgeon', [/\bneurologist\b/i, /\bneurosurgeon\b/i, /\bboard[-\s]+certified\b.*\bneurolog/i, /\bresidency[-\s]+trained\b.*\bneurolog/i, /\bdacvim\b.*\bneurolog/i]],
            ['Dermatologist', [/\bdermatologist\b/i, /\bboard[-\s]+certified\b.*\bdermatolog/i, /\bresidency[-\s]+trained\b.*\bdermatolog/i, /\bdacvd\b/i]],
            ['Cardiologist', [/\bcardiologist\b/i, /\bboard[-\s]+certified\b.*\bcardiolog/i, /\bresidency[-\s]+trained\b.*\bcardiolog/i, /\bdacvim\b.*\bcardiolog/i]],
            ['Radiation Oncologist', [/\bradiation oncolog/i, /\bdacvr[-\s]?ro\b/i, /\bdacvr\b.*\bradiation\b/i]],
            ['Medical Oncologist', [/\bmedical oncolog/i, /\bboard[-\s]+certified\b.*\boncolog/i, /\bresidency[-\s]+trained\b.*\boncolog/i, /\bdacvim\b.*\boncology\b/i]],
            ['Radiologist', [/\bradiologist\b/i, /\bdiagnostic imaging specialist\b/i, /\bboard[-\s]+certified\b.*\bradiolog/i, /\bresidency[-\s]+trained\b.*\bradiolog/i, /\bdacvr\b/i]],
            ['Ophthalmologist', [/\bophthalmologist\b/i, /\bboard[-\s]+certified\b.*\bophthalmolog/i, /\bresidency[-\s]+trained\b.*\bophthalmolog/i, /\bdacvo\b/i]],
            ['Anesthesiologist', [/\banesthesiologist\b/i, /\bboard[-\s]+certified\b.*\banesth/i, /\bresidency[-\s]+trained\b.*\banesth/i, /\bdacvaa\b/i]],
            ['Internal Medicine Specialist', [/\binternist\b/i, /\binternal medicine specialist\b/i, /\bboard[-\s]+certified\b.*\binternal medicine\b/i, /\bresidency[-\s]+trained\b.*\binternal medicine\b/i, /\bdacvim\b(?!.*oncology)(?!.*cardiology)(?!.*neurology)/i]],
            ['ECC Specialist', [/\bcriticalist\b/i, /\becc specialist\b/i, /\bemergency\s*(?:&|and)?\s*critical care specialist\b/i, /\bboard[-\s]+certified\b.*\bcritical/i, /\bresidency[-\s]+trained\b.*\bcritical/i, /\bdacvecc\b/i]],
            ['Avian and Exotic Specialis', [/\bavian\b/i, /\bexotics?\b/i]],
            ['DABVP Specialist', [/\bdabvp\b/i]],
            ['Dental Specialist', [/\bdental specialist\b/i, /\bveterinary dentist\b/i, /\boral surgeon\b/i, /\bboard[-\s]+certified\b.*\bdent/i, /\bresidency[-\s]+trained\b.*\bdent/i, /\bdavdc\b/i]],
            ['Sports Medicine & Rehabilitation Specialist', [/\brehabilitation veterinarian\b/i, /\bsports medicine\b/i, /\brehabilitation specialist\b/i, /\bboard[-\s]+certified\b.*\brehabilitation\b/i, /\bresidency[-\s]+trained\b.*\brehabilitation\b/i]],
            ['Surgeon', [/\bveterinary surgeon\b/i, /\bsurgeon\b/i, /\bboard[-\s]+certified\b.*\bsurgeon\b/i, /\bresidency[-\s]+trained\b.*\bsurgeon\b/i, /\bdacvs\b/i, /\bacvs\b/i]],
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
        if (t.includes('rehabilitation') || t.includes('sports medicine')) return 'Sports Medicine & Rehabilitation Specialist';
        if (t.includes('radiologist') || t.includes('diagnostic imaging') || t.includes('radiology')) return 'Radiologist';
        if (t.includes('ophthalmologist') || t.includes('ophthalmology')) return 'Ophthalmologist';
        if (t.includes('avian') || t.includes('exotic')) return 'Avian and Exotic Specialis';
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
        if (cat.includes('specialty diplomate') || cat.includes('surgeon diplomate') || cat.includes('avian') || cat.includes('exotic')) return 'Specialty Care';
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
            'anesthesia', 'theriogenology', 'radiology', 'avian', 'exotic'];
        for (const sp of specialtyNames) {
            if (t.includes(sp)) return 'Specialty Care';
        }

        const specialtyCerts = ['board certified', 'board-certified', 'residency trained', 'residency-trained', 'residential trained', 'residential-trained',
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
        if (t.includes('avian') || t.includes('exotics')) return 'Specialty Care';
        if (t.includes('equine') || t.includes('bovine') || t.includes('large animal')) return 'General Practice Care / Emergency Care / Urgent Care';

        return '';
    }

    // ============ LOCAL DETAIL EXTRACTION (mirrors detail-extractor.js) ============

    function extractDetailsFromDescription(positionTitle, descriptionText) {
        // Format salary to standard "$Xâ€“$Y per year" or "$X per hour"
        function formatSalary(raw) {
            if (!raw) return '';
            raw = normalizeSalaryText(raw);
            const isHourly = /(?:per\s+)?(?:hour|hr|\/hr)/i.test(raw);
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
            if (!isHourly && amounts.length >= 2) {
                const maxAmount = Math.max(...amounts);
                for (let i = 0; i < amounts.length; i++) {
                    if (amounts[i] >= 100 && amounts[i] < 1000 && maxAmount >= 10000) {
                        amounts[i] = amounts[i] * 1000;
                    }
                }
            } else if (!isHourly && amounts.length === 1 && amounts[0] >= 100 && amounts[0] < 1000 && /\b(?:salary|compensation|pay)\b/i.test(raw)) {
                amounts[0] = amounts[0] * 1000;
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
                return `${fmt(min)} - ${fmt(max)} ${unit}`;
            }
            return `${fmt(amounts[0])} ${unit}`;
        }

        // Extract salary from stored description (which now includes JSON-LD data)
        function extractSalary(text) {
            if (!text) return '';
            const bodyText = normalizeSalaryText(text.split(/===\s*FULL JOB DESCRIPTION\s*===/i).pop() || text);

            // Try to extract from JSON-LD data in the text
            const jsonLdMatch = text.match(/Salary Range:\s*([^\n]+)/i);
            if (jsonLdMatch) {
                return formatSalary(jsonLdMatch[1].trim());
            }

            // Fallback to text pattern matching
            const money = String.raw`\$[\d,]+(?:\.\d{1,2})?\s*(?:\/k|k)?`;
            const secondAmount = String.raw`\$?\s*[\d,]+(?:\.\d{1,2})?\s*(?:\/k|k)?`;
            const sep = String.raw`(?:-|\u2013|\u2014|\u00e2\u20ac\u201c|\u00e2\u20ac\u009d|to)`;
            const salaryPatterns = [
                new RegExp(String.raw`(?:base\s+salary\s+range|salary\s+range|compensation\s+range|pay\s+range)[^$]{0,140}${money}\s*${sep}\s*${secondAmount}`, 'i'),
                // "Base salary ranges: $150k - $171k" or "base salary range of $140,000 â€“ 160,000"
                /(?:base\s+salary\s*(?:ranges?)?)\s*(?:of|from|is|:)\s*\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s*[-â€“â€”]\s*\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?/i,
                /(?:base\s+salary\s*(?:ranges?)?)\s*(?:of|from|is|:)\s*\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s+to\s+\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?/i,
                // "Pay range: $95,000 - $160,000" or "Salary range: $120,000 - $140,000"
                /(?:(?:pay|salary|compensation)\s+range)\s*(?:of|from|is|:)\s*\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s*[-â€“â€”]\s*\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?/i,
                /(?:(?:pay|salary|compensation)\s+range)\s*(?:of|from|is|:)\s*\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s+to\s+\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?/i,
                // "Salary: $130,000-$200,000" or "Compensation: $110,000 to $180,000"
                /(?:salary|compensation|pay)[:\s]+\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s*[-â€“â€”]\s*\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?(?:\s*(?:per\s+)?(?:year|annually|annum|annual))?/i,
                /(?:salary|compensation|pay)[:\s]+\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s+to\s+\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?(?:\s*(?:per\s+)?(?:year|annually|annum|annual))?/i,
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
                /\$[\d,]+(?:\.\d{2})?\s*(?:per\s+)?(?:hour|hr|\/hr)/i,
            ];
            for (const pattern of salaryPatterns) {
                const m = bodyText.match(pattern);
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
                /(?:who you are|requirements?|qualifications?|preferred qualifications|what you'?ll need|what we'?re looking for|credentials?|must have|what we need)[:\s]*([\s\S]{0,900}?)(?=(?:benefits?|compensation|salary|about|our culture|location|equal|join us|why|facility|what we offer|ready to|key responsibilities|everything starts|come as you are|for more information)[:\s])/i,
                /(?:who you are|requirements?|qualifications?|preferred qualifications|what you'?ll need|what we'?re looking for|credentials?|must have|what we need)[:\s]*([\s\S]{0,650})/i
            ];
            for (const pattern of patterns) {
                const match = text.match(pattern);
                if (match) return match[1];
            }
            return null;
        }

        function extractRoleSignalText(text) {
            if (!text) return '';

            const rolePattern = /\b(?:medical director|lead veterinarian|lead vet|board[-\s]+certified|residency[-\s]+trained|residential[-\s]+trained|diplomate|criticalist|ecc specialist|emergency\s*(?:&|and)?\s*critical care specialist|internist|internal medicine specialist|cardiologist|dermatologist|neurologist|neurosurgeon|ophthalmologist|radiologist|diagnostic imaging specialist|anesthesiologist|medical oncologist|radiation oncologist|veterinary dentist|dental specialist|oral surgeon|veterinary surgeon|credentialed veterinary technician specialist|technician specialist|\bvts\b|\bdacv(?:ecc|im|r|s|d|o|aa)?\b|\bdacvr[-\s]?ro\b|\bdavdc\b|\bdabvp\b)\b/i;
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

            // STEP 0: Title-specific overrides â€” these are MORE specific than Jobvite categories.
            // e.g. "Urgent Care Veterinarian" is categorized as "Veterinarian (ER)" on Jobvite,
            // but "urgent care" in the title is a more precise signal than the broad ER bucket.
            if (title.includes('urgent care')) return 'Urgent Care';

            // STEP 1: Use industry/category - most reliable signal for broad categories
            if (category) {
                if (category.includes('gen practice')) return 'General Practice Care';
                if (category === 'veterinarian (er)' || category.includes('(er)')) return 'Emergency Care';
                if (category.includes('specialty diplomate') || category.includes('surgeon diplomate') || category.includes('rehabilitation') || category.includes('sports medicine') || category.includes('avian') || category.includes('exotic')) return 'Specialty Care';
            }

            // STEP 2: Check TITLE for clear specialty position names (COMPREHENSIVE LIST)
            const specialtyPositionNames = [
                'oncologist', 'cardiologist', 'neurologist', 'neurosurgeon',
                'dermatologist', 'ophthalmologist', 'anesthesiologist', 'theriogenologist',
                'radiologist', 'internist', 'criticalist', 'ecc specialist',
                'oncology', 'cardiology', 'neurology', 'dermatology', 'ophthalmology',
                'anesthesia', 'theriogenology', 'radiology', 'rehabilitation', 'sports medicine', 'avian', 'exotic'
            ];
            for (const sp of specialtyPositionNames) {
                if (title.includes(sp)) return 'Specialty Care';
            }

            // Check title for board cert / diplomate / DACV* indicators
            const specialtyCerts = ['board certified', 'board-certified', 'residency trained', 'residency-trained', 'residential trained', 'residential-trained',
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
                title.includes('avian') || title.includes('exotics')) return 'Specialty Care';

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
            if (t.includes('rehabilitation') || t.includes('sports medicine')) return 'Sports Medicine & Rehabilitation Specialist';
            if (t.includes('radiologist') || t.includes('diagnostic imaging') || t.includes('radiology')) return 'Radiologist';
            if (t.includes('ophthalmologist') || t.includes('ophthalmology')) return 'Ophthalmologist';
            if (t.includes('avian') || t.includes('exotic')) return 'Avian and Exotic Specialis';
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
                    'Neurologist & Neurosurgeon', 'Ophthalmologist', 'Avian and Exotic Specialis', 'Radiation Oncologist',
                    'Radiologist', 'Sports Medicine & Rehabilitation Specialist', 'Surgeon'
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

                // Match patterns like "Cincinnati and West Chester, OH hospitals"
                const sharedStateMatches = searchText.matchAll(/\b([A-Z][A-Za-z .'-]+?)\s+and\s+([A-Z][A-Za-z .'-]+?)\s*,\s*([A-Z]{2})\s+hospitals?\b/g);
                for (const match of sharedStateMatches) {
                    const state = match[3].trim();
                    for (const rawCity of [match[1], match[2]]) {
                        const city = rawCity.replace(/\b(?:our|join|the|in|at|within)\b/gi, '').trim();
                        if (city && city.length < 50) {
                            locations.push({ city, state, location: `${city}, ${state}` });
                        }
                    }
                }

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

            const yearToken = '(?:years?|yrs?\\.?)';
            const candidateSources = [];
            const qualificationsSection = extractQualificationsSection(text);
            const normalizedText = text
                .replace(/([a-z])([A-Z][a-z])/g, '$1. $2')
                .replace(/\s+/g, ' ');

            if (qualificationsSection) {
                candidateSources.push(qualificationsSection);
            }

            for (const keyword of ['ideal candidate', 'who you are', 'qualifications', 'seeking an experienced', 'seeking a daytime', 'unique opportunity']) {
                const keywordPattern = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
                let keywordMatch;
                while ((keywordMatch = keywordPattern.exec(normalizedText)) !== null) {
                    candidateSources.push(normalizedText.substring(Math.max(0, keywordMatch.index - 80), keywordMatch.index + 750));
                }
            }

            const signalPattern = new RegExp(`\\b(?:experience|experienced|internship[-\\s]+trained|\\d+\\s*[-–—]\\s*\\d+\\s*${yearToken})\\b`, 'ig');
            let signalMatch;
            while ((signalMatch = signalPattern.exec(normalizedText)) !== null) {
                candidateSources.push(normalizedText.substring(Math.max(0, signalMatch.index - 180), signalMatch.index + 260));
            }

            candidateSources.push(...text.split(/\n|(?<=[.!?])\s+/));

            const noisePattern = /\b(?:commensurate with skills and experience|total compensation|employment decisions|equal employment|medvet experience|client(?:s)?(?: and their pets)?\s+experience|patient.*experience|referral partner.*experience|team with diverse education and experience|experienced clinical leadership|experienced ER doctor team|experienced ER doctors who are comfortable|experienced veterinary technicians|experienced doctors|experienced support team|experienced emergency doctors|experienced caregivers|talented.*experienced doctors|our team has|over\s+\d+\s+years of experience|years of experience in specialty and emergency services|serving\s+the\s+community|we offer|benefits|medical(?:,\s*|\s+)dental)\b/i;

            const patterns = [
                { pattern: new RegExp(`\\binternship[-\\s]+trained\\s+and/or\\s+have\\s+(\\d+)\\s*[-–—]\\s*(\\d+)\\s*${yearToken}\\s+(?:of\\s+)?experience\\b`, 'i'), type: 'range' },
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

            function formatExperience(match, type = 'years') {
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

            for (const source of candidateSources.map(source => source.trim()).filter(Boolean)) {
                for (const entry of patterns) {
                    const pattern = entry.pattern || entry;
                    const type = entry.type || 'years';
                    const match = source.match(pattern);
                    if (!match) continue;
                    const matchedText = match[0] || '';
                    if (noisePattern.test(matchedText) || (noisePattern.test(source) && type === 'years' && !/\b(?:ideal candidate|who you are|have|has|with|minimum|min\.?|at least|required|requires?)\b/i.test(source))) {
                        continue;
                    }
                    const formatted = formatExperience(match, type);
                    if (formatted) return formatted;
                }
            }

            return '';
        }

        // Run all extractions
        const salary = extractSalary(descriptionText);
        const areaOfPractice = determineAreaOfPractice(positionTitle, descriptionText);
        const position = determinePosition(positionTitle, descriptionText, areaOfPractice);
        const locations = extractLocations(descriptionText);
        const hospitalName = extractHospitalName(descriptionText);
        const jobType = extractJobType(descriptionText);
        const experience = extractExperience(descriptionText);

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
        const expectedLocation = parseExpectedLocation(location);
        const locationQuery = [expectedLocation.city, expectedLocation.state].filter(Boolean).join(', ');
        const searchQuery = [hospitalName, locationQuery].filter(Boolean).join(', ').trim();
        const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`;

        function emptyAddressResult() {
            return { streetAddress: '', zipCode: '', city: '', state: '', fullAddress: '', website: '', phone: '', placeName: '', locationMismatch: false };
        }

        function normalizeForCompare(value) {
            return (value || '').toLowerCase().replace(/^city\s+of\s+/i, '').replace(/[^a-z0-9]/g, '');
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

        function expectedBrand() {
            if (/\bwestvet\b/i.test(`${hospitalName || ''} ${originalHospitalName || ''}`)) return 'WestVet';
            return 'MedVet';
        }

        function isGenericHospitalSearchName() {
            return /^(?:Med\s*Vet|WestVet)$/i.test((hospitalName || '').trim());
        }

        function brandPattern(brand) {
            return brand === 'WestVet' ? /\bwestvet\b/i : /\bmed\s*vet\b/i;
        }

        function resultMatchesExpectedBrand(result) {
            const placeName = result?.placeName || '';
            if (!placeName) return true;
            return brandPattern(expectedBrand()).test(placeName);
        }

        function getLocationMatchStatus(result) {
            const resultCity = normalizeForCompare(result.city || '');
            const resultState = normalizeStateForCompare(result.state || '');
            const expectedCity = normalizeForCompare(expectedLocation.city);
            const expectedState = expectedLocation.state;

            const cityMatches = !expectedCity || !resultCity || resultCity === expectedCity;
            const stateMatches = !expectedState || !resultState || resultState === expectedState;

            return { cityMatches, stateMatches };
        }

        function filterDataForExpectedLocation(data, sourceLabel) {
            const result = data || emptyAddressResult();
            const hasLocationSignal = !!(result.streetAddress || result.zipCode || result.fullAddress || result.city || result.state);

            if (hasLocationSignal && !resultMatchesExpectedBrand(result)) {
                console.warn(`Ignoring address result because place name "${result.placeName}" does not match expected brand "${expectedBrand()}" for "${sourceLabel}".`);
                return emptyAddressResult();
            }

            const locationStatus = getLocationMatchStatus(result);
            if (hasLocationSignal && !locationStatus.stateMatches) {
                console.warn(`Ignoring address result outside requested state "${location}" from "${sourceLabel}": ${result.fullAddress || [result.city, result.state, result.zipCode].filter(Boolean).join(', ')}`);
                return emptyAddressResult();
            }

            if (hasLocationSignal && !locationStatus.cityMatches) {
                if (isGenericHospitalSearchName()) {
                    console.warn(`Ignoring city-mismatched result for generic hospital search "${hospitalName}" and location "${location}" from "${sourceLabel}": ${result.placeName || result.fullAddress || [result.city, result.state, result.zipCode].filter(Boolean).join(', ')}`);
                    return emptyAddressResult();
                }
                console.warn(`Accepting address with city mismatch for "${location}" from "${sourceLabel}" and marking row red: ${result.fullAddress || [result.city, result.state, result.zipCode].filter(Boolean).join(', ')}`);
                return { ...result, locationMismatch: true };
            }

            return result;
        }

        function mergeMapsData(primary, secondary, sourceLabel = '') {
            const safeSecondary = filterDataForExpectedLocation(secondary, sourceLabel);
            return {
                streetAddress: primary.streetAddress || safeSecondary.streetAddress || '',
                zipCode: primary.zipCode || safeSecondary.zipCode || '',
                city: primary.city || safeSecondary.city || '',
                state: primary.state || safeSecondary.state || '',
                fullAddress: primary.fullAddress || safeSecondary.fullAddress || '',
                website: primary.website || safeSecondary.website || '',
                phone: primary.phone || safeSecondary.phone || '',
                placeName: primary.placeName || safeSecondary.placeName || '',
                locationMismatch: Boolean(primary.locationMismatch || safeSecondary.locationMismatch)
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
                const query = normalizedName.replace(/\s+/g, ' ').trim();
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

                const withoutParens = base.replace(/\s*\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
                const expandedParens = base.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
                const plain = base.replace(/&/g, 'and').replace(/[-â€“â€”()]/g, ' ').replace(/\s+/g, ' ').trim();

                names.push(
                    [base, locationQuery].filter(Boolean).join(', '),
                    [withoutParens, locationQuery].filter(Boolean).join(', '),
                    [expandedParens, locationQuery].filter(Boolean).join(', '),
                    [plain, locationQuery].filter(Boolean).join(', ')
                );
            }

            return names;
        }

        // Inner function: open a tab, wait for load, inject scraper, get results
        function scrapeGoogleMapsTab(url, queryLabel) {
            return new Promise((resolve) => {
                // Safety timeout â€” 30 seconds max
                const timeout = setTimeout(() => {
                    console.warn(`âœ— Google Maps timeout for: "${queryLabel}"`);
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
                                        streetAddress: data.streetAddress || '',
                                        zipCode: data.zipCode || '',
                                        city: data.city || '',
                                        state: data.state || '',
                                        fullAddress: data.fullAddress || '',
                                        website: data.website || '',
                                        phone: data.phone || '',
                                        placeName: data.placeName || ''
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
                                        streetAddress: data.streetAddress || '',
                                        zipCode: data.zipCode || '',
                                        city: data.city || '',
                                        state: data.state || '',
                                        fullAddress: data.fullAddress || '',
                                        website: data.website || '',
                                        phone: data.phone || '',
                                        placeName: data.placeName || ''
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
                                        streetAddress: data.streetAddress || '',
                                        zipCode: data.zipCode || '',
                                        city: data.city || '',
                                        state: data.state || '',
                                        fullAddress: data.fullAddress || '',
                                        website: data.website || '',
                                        phone: data.phone || '',
                                        placeName: data.placeName || ''
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
                                        streetAddress: data.streetAddress || '',
                                        zipCode: data.zipCode || '',
                                        city: data.city || '',
                                        state: data.state || '',
                                        fullAddress: data.fullAddress || '',
                                        website: data.website || '',
                                        phone: data.phone || '',
                                        placeName: data.placeName || ''
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

        // Attempt 1: search with hospital name plus row city/state
        console.log(`ðŸ” Google Maps search: "${searchQuery}"`);
        let data = mergeMapsData(emptyAddressResult(), await scrapeGoogleMapsTabSafe(mapsUrl, searchQuery), searchQuery);

        // Attempt 2: if failed, try with & â†’ and, remove dashes/parens
        if (needsMapsRetry(data)) {
            const simplifiedName = hospitalName
                .replace(/&/g, 'and')
                .replace(/[-â€“â€”()]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            const altQuery = [simplifiedName, locationQuery].filter(Boolean).join(', ');
            if (altQuery !== searchQuery) {
                console.log(`â†» Retry with: "${altQuery}"`);
                const altUrl = `https://www.google.com/maps/search/${encodeURIComponent(altQuery)}`;
                const altData = await scrapeGoogleMapsTabSafe(altUrl, altQuery);
                data = mergeMapsData(data, altData, altQuery);
            }
        }

        // Additional Maps attempts for alternate spellings or parenthetical acronyms.
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
            console.log(`âœ“ SUCCESS: "${searchQuery}"`);
            console.log(`  â†’ Street="${data.streetAddress}", City="${data.city}", State="${data.state}", Zip="${data.zipCode}"`);
            if (data.website) console.log(`  â†’ Website="${data.website}"`);
            if (data.phone) console.log(`  â†’ Phone="${data.phone}"`);
        } else {
            console.warn(`âœ— No address found for: "${searchQuery}"`);
        }

        return {
            streetAddress: data.streetAddress || '',
            zipCode: data.zipCode || '',
            city: data.city || '',
            state: data.state || '',
            fullAddress: data.fullAddress || '',
            website: data.website || '',
            phone: data.phone || '',
            placeName: data.placeName || '',
            locationMismatch: Boolean(data.locationMismatch)
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

    function showDescriptionModal(description) {
        modalDescriptionContent.textContent = description || '';
        descriptionModal.classList.add('show');
    }

    function hideDescriptionModal() {
        descriptionModal.classList.remove('show');
        modalDescriptionContent.textContent = '';
    }

    closeDescriptionModal.addEventListener('click', hideDescriptionModal);
    descriptionModal.addEventListener('click', (event) => {
        if (event.target === descriptionModal) hideDescriptionModal();
    });

    function updateJobCount(count) {
        totalCountElement.textContent = count;
    }

    function normalizeSalaryText(salary) {
        return (salary || '')
            .replace(/\u00e2\u20ac\u201c|\u00e2\u20ac\u009d|\u2013|\u2014/g, ' - ')
            .replace(/\s+-\s+/g, ' - ')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

    function getJobKey(job) {
        return job.jobId || job.link || `${job.title || ''}|${job.location || ''}|${job.hospital || ''}`;
    }

    function updateSelectionControls() {
        const visibleKeys = currentlyDisplayedJobs.map(getJobKey).filter(Boolean);
        const selectedVisibleCount = visibleKeys.filter(key => selectedJobKeys.has(key)).length;

        selectAllJobsCheckbox.checked = visibleKeys.length > 0 && selectedVisibleCount === visibleKeys.length;
        selectAllJobsCheckbox.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleKeys.length;
        deleteSelectedJobsButton.disabled = selectedJobKeys.size === 0;
        deleteSelectedJobsButton.textContent = selectedJobKeys.size > 0
            ? `Delete Selected (${selectedJobKeys.size})`
            : 'Delete Selected';
    }

    function displayRecords(jobs) {
        tableBody.innerHTML = '';
        currentlyDisplayedJobs = jobs;
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
            const jobKey = getJobKey(job);

            if (job.addressLocationMismatch) {
                row.classList.add('address-mismatch-row');
            } else if (job.hospitalNameUpdated) {
                row.classList.add('hospital-name-updated-row');
            } else if (job.isNewLocation) {
                row.classList.add('multi-location-row');
            }

            const selectCell = row.insertCell(0);
            selectCell.style.textAlign = 'center';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'job-select-checkbox';
            checkbox.checked = selectedJobKeys.has(jobKey);
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    selectedJobKeys.add(jobKey);
                } else {
                    selectedJobKeys.delete(jobKey);
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
            row.insertCell(4).textContent = job.hospital;
            row.insertCell(5).textContent = MEDVET_AGGREGATOR;
            row.insertCell(6).textContent = job.streetAddress || '-';
            row.insertCell(7).textContent = job.city;
            row.insertCell(8).textContent = job.state;
            row.insertCell(9).textContent = job.zipCode || '-';

            // Phone column
            row.insertCell(10).textContent = job.phone || '-';

            // Website column â€” show as clickable link if available
            const websiteCell = row.insertCell(11);
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

            row.insertCell(12).textContent = job.location;

            // Detail Columns
            row.insertCell(13).textContent = job.areaOfPractice || '-';
            row.insertCell(14).textContent = job.position || '-';
            row.insertCell(15).textContent = normalizeSalaryText(job.salary) || '-';
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
                `"${(job.hospital || '').replace(/"/g, '""')}"`,
                `"${MEDVET_AGGREGATOR.replace(/"/g, '""')}"`,
                `"${(job.streetAddress || '').replace(/"/g, '""')}"`,
                `"${(job.city || '').replace(/"/g, '""')}"`,
                `"${(job.state || '').replace(/"/g, '""')}"`,
                `"${(job.zipCode || '').replace(/"/g, '""')}"`,
                `"${(job.phone || '').replace(/"/g, '""')}"`,
                `"${(job.website || '').replace(/"/g, '""')}"`,
                `"${(job.location || '').replace(/"/g, '""')}"`,
                `"${(job.areaOfPractice || '').replace(/"/g, '""')}"`,
                `"${(job.position || '').replace(/"/g, '""')}"`,
                `"${normalizeSalaryText(job.salary).replace(/"/g, '""')}"`,
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
        link.setAttribute('download', `medvet_jobs_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        showToast(`Exported ${allJobs.length} jobs to CSV!`, 'success');
    }

    // Initialize
    chrome.storage.local.get(['scrapedJobs', 'records'], (result) => {
        allJobs = (result.scrapedJobs && result.scrapedJobs.length ? result.scrapedJobs : result.records) || [];
        let normalizedExistingSalary = false;
        allJobs = allJobs.map(job => {
            const normalizedSalary = normalizeSalaryText(job.salary);
            if ((job.salary || '') !== normalizedSalary) normalizedExistingSalary = true;
            return {
                ...job,
                hospital: job.hospital || job.hospitalName || 'MedVet',
                salary: normalizedSalary,
                location: job.location || [job.city, job.state].filter(Boolean).join(', ')
            };
        });
        if (normalizedExistingSalary) {
            chrome.storage.local.set({ scrapedJobs: allJobs, records: allJobs });
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

                chrome.storage.local.set({ scrapedJobs: jobs, records: jobs }, () => {
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

                chrome.storage.local.set({ scrapedJobs: jobs, records: jobs }, () => {
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
                        job.addressLocationMismatch = false;
                        job.hospitalNameUpdated = false;
                        clearedCount++;
                    }
                });

                chrome.storage.local.set({ scrapedJobs: jobs, records: jobs }, () => {
                    allJobs = jobs;
                    displayRecords(allJobs);
                    showToast(`Cleared address data from ${clearedCount} jobs!`, 'success');
                });
            });
        }
    });

    selectAllJobsCheckbox.addEventListener('change', () => {
        const visibleKeys = currentlyDisplayedJobs.map(getJobKey).filter(Boolean);
        if (selectAllJobsCheckbox.checked) {
            visibleKeys.forEach(key => selectedJobKeys.add(key));
        } else {
            visibleKeys.forEach(key => selectedJobKeys.delete(key));
        }
        displayRecords(currentlyDisplayedJobs);
    });

    deleteSelectedJobsButton.addEventListener('click', () => {
        if (selectedJobKeys.size === 0) {
            showToast('No jobs selected.', 'error');
            return;
        }

        const selectedCount = selectedJobKeys.size;
        if (!confirm(`Delete ${selectedCount} selected job(s)?`)) {
            return;
        }

        const remainingJobs = allJobs.filter(job => !selectedJobKeys.has(getJobKey(job)));
        chrome.storage.local.set({ scrapedJobs: remainingJobs, records: remainingJobs }, () => {
            allJobs = remainingJobs;
            selectedJobKeys.clear();
            const currentSearch = searchInput.value.trim();
            if (currentSearch) {
                filterJobs(currentSearch);
            } else {
                displayRecords(allJobs);
            }
            showToast(`Deleted ${selectedCount} selected job(s).`, 'success');
        });
    });

    // Clear all records
    clearRecordsButton.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all scraped job records?')) {
            chrome.storage.local.set({ scrapedJobs: [], records: [] }, () => {
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
            aggregator: MEDVET_AGGREGATOR,
            street_address: job.streetAddress || '',
            parent_client: MEDVET_AGGREGATOR,
            city: job.city,
            state: job.state,
            zip_code: job.zipCode || '',
            phone: job.phone || '',
            website: job.website || '',
            location: job.location,
            area_of_practice: job.areaOfPractice || '',
            position: job.position || '',
            salary: normalizeSalaryText(job.salary),
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
                source: 'MedVet Job Scraper',
                parentClientName: MEDVET_AGGREGATOR,
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

        // Re-analyze every parent row so Fetch Details always refreshes hospital names.
        // Existing generated child rows are rebuilt below, which prevents duplicate locations.
        const jobsToFetch = jobs.map((job, index) => ({ job, index }))
            .filter(item => {
                if (!item.job.title) return false;
                if (item.job.parentJobId) return false;
                return true;
            });

        if (jobsToFetch.length === 0) {
            showToast('No parent job rows found to update.', 'error');
            return;
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

        // Extract details locally from job title + already-fetched description
        const positionTitle = job.title || '';
        const description = job.description || '';

        if (positionTitle) {
            const extracted = extractDetailsFromDescription(positionTitle, description);
            const fallbackHospitalName = buildHospitalNameFromDescription(description, job);

            // Use extracted locations only to improve the hospital name; listing location fields stay unchanged.
            if (extracted.locations && extracted.locations.length > 0) {
                detailsList = extracted.locations.map(loc => ({
                    areaOfPractice: extracted.areaOfPractice,
                    position: extracted.position,
                    salary: normalizeSalaryText(extracted.salary),
                    hospitalName: buildHospitalNameForLocation(description, job, loc) || fallbackHospitalName || extracted.hospitalName,
                    jobType: extracted.jobType,
                    experience: extracted.experience,
                    description: specializeDescriptionForLocation(description, loc),
                    city: formatDetailLocation(loc).city,
                    state: formatDetailLocation(loc).state,
                    location: formatDetailLocation(loc).location
                }));
            } else {
                // No locations found â€” still create one entry with details
                detailsList = [{
                    areaOfPractice: extracted.areaOfPractice,
                    position: extracted.position,
                    salary: normalizeSalaryText(extracted.salary),
                    hospitalName: fallbackHospitalName || extracted.hospitalName,
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
                const listingTitle = originalJob.title || '';
                const detailAOP = firstDetail.areaOfPractice || '';
                const descText = firstDetail.description || originalJob.description || '';

                // Step 1: Determine AOP â€” prefer detail extractor's AOP (from page category), fall back to title
                let finalAOP = hasSpecialtyTrainingSignal(descText)
                    ? 'Specialty Care'
                    : (detailAOP || getAOPFromTitle(listingTitle) || 'General Practice Care');

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

                // Step 5: Medical Director override â€” if title says "Medical Director", keep it
                if ((!finalPosition || finalPosition === 'Associate Veterinarian') && listingTitle.toLowerCase().includes('medical director')) {
                    finalPosition = APPROVED_POSITION_SET.has('Medical Director') ? 'Medical Director' : '';
                }

                if (!APPROVED_POSITION_SET.has(finalPosition)) {
                    finalPosition = '';
                }

                const parentJobId = originalJob.parentJobId || originalJob.jobId;
                for (let i = jobs.length - 1; i >= 0; i--) {
                    const job = jobs[i];
                    const isExistingGeneratedChild =
                        job?.parentJobId === parentJobId ||
                        (job?.isNewLocation && job?.jobId !== parentJobId && originalJob.link && job?.sourceLink === originalJob.link);
                    if (isExistingGeneratedChild) {
                        jobs.splice(i, 1);
                    }
                }
                const parentIndex = jobs.findIndex(job => job.jobId === parentJobId);
                const saveIndex = parentIndex >= 0 ? parentIndex : jobIndex;
                const parentJob = jobs[saveIndex] || originalJob;

                // Update original job with extracted details
                parentJob.areaOfPractice = finalAOP;
                parentJob.position = finalPosition || '';
                parentJob.salary = normalizeSalaryText(firstDetail.salary || parentJob.salary || '');
                parentJob.hospital = resolveHospitalNameForSave(
                    firstDetail.hospitalName,
                    parentJob.hospital || originalJob.hospital || '',
                    extractMedVetHospitalBrand(descText, parentJob.hospital || originalJob.hospital || '')
                );
                parentJob.jobType = firstDetail.jobType || parentJob.jobType || 'Full-Time';
                parentJob.experience = firstDetail.experience || parentJob.experience || '';
                parentJob.isNewLocation = detailsList.length > 1;
                if (firstDetail.city) parentJob.city = firstDetail.city;
                if (firstDetail.state) parentJob.state = firstDetail.state;
                if (firstDetail.location) parentJob.location = firstDetail.location;
                // Keep each generated row's description focused on its own location.
                if (firstDetail.description) {
                    parentJob.description = firstDetail.description;
                }

                if (detailsList.length > 1) {
                    const newJobs = [];
                    const existingIds = new Set(jobs.map(job => job.jobId).filter(Boolean));

                    for (let i = 1; i < detailsList.length; i++) {
                        const locDetail = detailsList[i];
                        const locationKey = makeLocationKey(locDetail);
                        let childJobId = `${parentJobId}-loc-${locationKey || i + 1}`;
                        let duplicateCounter = 2;
                        while (existingIds.has(childJobId)) {
                            childJobId = `${parentJobId}-loc-${locationKey || i + 1}-${duplicateCounter}`;
                            duplicateCounter++;
                        }
                        existingIds.add(childJobId);

                        const newJob = {
                            ...parentJob,
                            jobId: childJobId,
                            parentJobId,
                            hospital: resolveHospitalNameForSave(
                                locDetail.hospitalName,
                                parentJob.hospital || '',
                                extractMedVetHospitalBrand(locDetail.description || descText, parentJob.hospital || '')
                            ),
                            city: locDetail.city || '',
                            state: locDetail.state || '',
                            location: locDetail.location || [locDetail.city, locDetail.state].filter(Boolean).join(', '),
                            areaOfPractice: finalAOP,
                            position: finalPosition || '',
                            salary: normalizeSalaryText(locDetail.salary || parentJob.salary || ''),
                            jobType: locDetail.jobType || parentJob.jobType || 'Full-Time',
                            experience: locDetail.experience || parentJob.experience || '',
                            description: locDetail.description || parentJob.description || '',
                            streetAddress: '',
                            zipCode: '',
                            website: '',
                            phone: '',
                            isNewLocation: true,
                            sourceLink: parentJob.link || parentJob.sourceLink || ''
                        };
                        newJobs.push(newJob);
                    }

                    jobs.splice(saveIndex + 1, 0, ...newJobs);
                }

                chrome.storage.local.set({ scrapedJobs: jobs, records: jobs }, () => {
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
        return !!(data && data.streetAddress && data.zipCode && data.streetAddress !== 'Not Found (TBD)' && data.zipCode !== '00000');
    }

    function hasCompleteFetchedAddress(data) {
        return !!(data && data.streetAddress && data.zipCode);
    }

    function parseLocationParts(location) {
        const parts = (location || '').split(',').map(part => part.trim()).filter(Boolean);
        return {
            city: parts[0] || '',
            state: parts.length >= 2 ? parts[1] : ''
        };
    }

    function normalizedLocationPart(value) {
        return (value || '').toLowerCase().replace(/^city\s+of\s+/i, '').replace(/[^a-z0-9]/g, '');
    }

    function normalizeScrapedHospitalPlaceName(placeName) {
        const cleaned = (placeName || '')
            .replace(/\s+/g, ' ')
            .replace(/\s*[|·].*$/g, '')
            .trim();

        if (!cleaned) return '';
        if (!/\b(?:med\s*vet|westvet)\b/i.test(cleaned)) return '';
        return cleaned;
    }

    function hospitalNamesExactlyMatch(currentName, scrapedName) {
        return (currentName || '').trim() === (scrapedName || '').trim();
    }

    function jobLocationMismatch(job) {
        const expected = parseLocationParts(job.location);
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

        // Find jobs that need address/contact data (using LOCATION column)
        const jobsNeedingAddresses = jobs.map((job, index) => ({ job, index }))
            .filter(item => {
                // Jobs missing any core location/contact field
                return item.job.hospital && item.job.location &&
                    (!item.job.streetAddress || !item.job.zipCode || jobLocationMismatch(item.job));
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
            // Search by Hospital + City + State. Returned city/state still must match before saving.
            let searchHospital = job.hospital || '';

            // Parse city and state from location field (e.g. "Austin, TX")
            let searchCity = '';
            let searchState = '';
            if (job.location) {
                const locParts = job.location.split(',').map(s => s.trim());
                if (locParts.length >= 2) {
                    searchCity = locParts[0];
                    searchState = locParts[1];
                } else if (locParts.length === 1) {
                    searchCity = locParts[0];
                }
            }

            // Keep location only for validating that Google returned the right city/state.
            const searchLocation = [searchCity, searchState].filter(Boolean).join(', ');
            const normalizeLocationValue = (value) => (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const existingLocationMismatch =
                (searchCity && job.city && normalizeLocationValue(job.city) !== normalizeLocationValue(searchCity)) ||
                (searchState && job.state && normalizeLocationValue(getFullStateName(job.state)) !== normalizeLocationValue(getFullStateName(searchState)));

            const cacheKeys = getAddressCacheKeys(searchHospital, searchLocation, job.hospital || '');
            let addressData = getRememberedAddress(cacheKeys);
            if (addressData) {
                console.log(`Using cached address for "${searchHospital}, ${searchLocation}"`);
            } else {
                addressData = await fetchAddressFromGoogleMaps(searchHospital, searchLocation, job.hospital || '');
                rememberAddressData(cacheKeys, addressData);
            }

            // Update job with address data from Google Maps
            const data = await chrome.storage.local.get(['scrapedJobs']);
            const jobs = data.scrapedJobs || [];

            if (jobs[index]) {
                const scrapedHospitalName = normalizeScrapedHospitalPlaceName(addressData.placeName);

                // Try to extract zip from fullAddress if parsing missed it
                if (!addressData.zipCode && addressData.fullAddress) {
                    const zipFromFull = addressData.fullAddress.match(/\b[A-Z]{2}\s+(\d{5}(?:-\d{4})?)\b/);
                    if (zipFromFull) addressData.zipCode = zipFromFull[1];
                }

                if (hasCompleteFetchedAddress(addressData)) {
                    if (scrapedHospitalName && !hospitalNamesExactlyMatch(jobs[index].hospital, scrapedHospitalName)) {
                        jobs[index].hospital = scrapedHospitalName;
                        jobs[index].hospitalNameUpdated = true;
                    }
                    jobs[index].addressLocationMismatch = Boolean(addressData.locationMismatch);
                    jobs[index].streetAddress = addressData.streetAddress;
                    jobs[index].zipCode = addressData.zipCode;
                    // Use Google's accepted address city/state. If the city differs from the row
                    // location, the row is marked red through addressLocationMismatch above.
                    jobs[index].city = addressData.city || searchCity || jobs[index].city || '';
                    jobs[index].state = getFullStateName(addressData.state || searchState || jobs[index].state || '');
                    jobs[index].website = addressData.website;
                    jobs[index].phone = addressData.phone;
                } else {
                    jobs[index].streetAddress = 'Not Found (TBD)';
                    jobs[index].zipCode = '00000';
                    jobs[index].city = searchCity || jobs[index].city || '';
                    jobs[index].state = getFullStateName(searchState || jobs[index].state || '');
                    jobs[index].phone = '';
                    jobs[index].website = '';
                    jobs[index].addressLocationMismatch = false;
                }

                await chrome.storage.local.set({ scrapedJobs: jobs, records: jobs });

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


