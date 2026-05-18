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
    const selectAllVisibleCheckbox = document.getElementById('selectAllVisibleJobs');
    const editSelectedJobBtn = document.getElementById('editSelectedJob');
    const deleteSelectedJobsBtn = document.getElementById('deleteSelectedJobs');
    const editJobModal = document.getElementById('editJobModal');
    const closeEditJobModalBtn = document.getElementById('closeEditJobModal');
    const cancelEditJobBtn = document.getElementById('cancelEditJob');
    const editJobForm = document.getElementById('editJobForm');
    const editJobMeta = document.getElementById('editJobMeta');

    let currentSortColumn = null;
    let currentSortDirection = 'asc';
    let allJobs = [];
    let displayedJobs = [];
    let editingJobKey = '';
    let isGettingDescriptions = false;
    let isFetchingDetails = false;
    let isFetchingAddresses = false;
    let currentJobIndex = 0;
    let descriptionQueue = [];
    let failedDescriptionCount = 0;
    let detailsQueue = [];
    let currentDetailsIndex = 0;
    let addressQueue = [];
    let currentAddressIndex = 0;
    let addressCache = new Map();
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

    function getStateAbbreviation(state) {
        if (!state) return '';
        const trimmed = state.trim();
        if (/^[A-Z]{2}$/i.test(trimmed)) return trimmed.toUpperCase();

        const normalized = normalizeSimpleText(trimmed);
        const match = Object.entries(stateAbbreviations).find(([, fullName]) => {
            return normalizeSimpleText(fullName) === normalized;
        });
        return match ? match[0] : '';
    }

    function isStateValue(value) {
        return !!getStateAbbreviation(value);
    }

    function normalizeSimpleText(value) {
        return (value || '')
            .toLowerCase()
            .replace(/&/g, ' and ')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    }

    function normalizeCityForCompare(value) {
        return normalizeSimpleText(value)
            .replace(/\bmount\b/g, 'mt')
            .replace(/\bsaint\b/g, 'st')
            .replace(/\bfort\b/g, 'ft')
            .replace(/\s+/g, '');
    }

    function toDisplayCase(value) {
        const clean = (value || '').replace(/\s+/g, ' ').trim();
        if (!clean) return '';
        if (clean !== clean.toUpperCase()) return clean;

        return clean.toLowerCase().replace(/\b[a-z]/g, char => char.toUpperCase());
    }

    function formatCityForStorage(city) {
        return toDisplayCase(city);
    }

    function formatStateForStorage(state) {
        return getFullStateName(toDisplayCase(state));
    }

    function getLocationVariants(location = '', city = '', state = '') {
        const variants = new Set();
        const parts = (location || '').split(',').map(part => part.trim()).filter(Boolean);
        const locCity = city || parts[0] || '';
        const locState = state || parts[1] || '';
        const fullState = getFullStateName(locState);
        const stateAbbr = getStateAbbreviation(locState || fullState);

        [locCity, locState, fullState, stateAbbr, location].forEach(value => {
            if (value) variants.add(normalizeSimpleText(value));
        });

        if (locCity && fullState) variants.add(normalizeSimpleText(`${locCity}, ${fullState}`));
        if (locCity && stateAbbr) variants.add(normalizeSimpleText(`${locCity}, ${stateAbbr}`));
        if (locCity) variants.add(normalizeSimpleText(`${locCity} ${stateAbbr}`));
        if (locCity) variants.add(normalizeSimpleText(`Greater ${locCity} area`));

        return [...variants].filter(Boolean);
    }

    function isLocationOnlyHospitalName(hospitalName, location = '', city = '', state = '') {
        const normalizedHospital = normalizeSimpleText(hospitalName);
        if (!normalizedHospital) return true;

        const variants = getLocationVariants(location, city, state);
        return variants.includes(normalizedHospital);
    }

    function isGenericOrganizationHospitalName(hospitalName) {
        return /^(mission pet health|united veterinary care|svp|southern veterinary partners)$/i.test((hospitalName || '').trim());
    }

    function isMissionPetHealthHospital(hospitalName) {
        return /^mission pet health$/i.test((hospitalName || '').trim());
    }

    function extractMetadataField(text, labels) {
        const candidates = Array.isArray(labels) ? labels : [labels];
        const lines = (text || '').split(/\r?\n/).map(line => line.trim());

        for (const label of candidates) {
            const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const match = (text || '').match(new RegExp(`^${escapedLabel}:\\s*(.+)$`, 'im'));
            if (match) return match[1].trim();

            const lineIndex = lines.findIndex(line => new RegExp(`^${escapedLabel}:?$`, 'i').test(line));
            if (lineIndex !== -1) {
                const valueLine = lines.slice(lineIndex + 1).find(line => line && !/^[A-Za-z /]+:$/.test(line));
                if (valueLine) return valueLine.trim();
            }
        }

        return '';
    }

    function extractBetterHospitalNameFromDescription(text, location = '', city = '', state = '') {
        if (!text) return '';

        const metadataHospital = extractMetadataField(text, [
            'Hiring Organization',
            'Practice Name',
            'Practice',
            'Site',
            'Facility',
            'Hospital',
            'Hospital Name',
            'Job Site'
        ]);
        if (
            metadataHospital &&
            !isLocationOnlyHospitalName(metadataHospital, location, city, state)
        ) {
            return metadataHospital;
        }

        const patterns = [
            /Position at\s+((?:[\w'.&-]+\s+){1,8}(?:Animal\s+Hospital|Veterinary\s+(?:Hospital|Center|Clinic|Care|Specialists?)|Pet\s+(?:Hospital|Clinic|Care)|Emergency\s+(?:Hospital|Center|Clinic)|The\s+[A-Z][\w\s]+Service))/i,
            /\bat\s+((?:[\w'.&-]+\s+){1,6}(?:Animal\s+Hospital|Veterinary\s+(?:Hospital|Center|Clinic|Care|Specialists?)|Pet\s+(?:Hospital|Clinic|Care)|Emergency\s+(?:Hospital|Center|Clinic)|The\s+[A-Z][\w\s]+Service))\b/i,
            /\b(Mission Pet Health)\s+is\s+seeking\b/i,
            /\bAt\s+(Mission Pet Health),\s+our\s+Regional Medical Directors\b/i,
            /\b(United Veterinary Care)\s+is\s+seeking\b/i
        ];

        for (const pattern of patterns) {
            const match = text.match(pattern);
            const candidate = match?.[1]?.trim() || '';
            if (
                candidate &&
                !isLocationOnlyHospitalName(candidate, location, city, state)
            ) {
                return candidate;
            }
        }

        return '';
    }

    function resolveHospitalNameFromDetails(currentHospital, detailHospital, description, location, city, state) {
        const currentIsLocationOnly = isLocationOnlyHospitalName(currentHospital, location, city, state);
        const detailIsBetter = detailHospital &&
            !isLocationOnlyHospitalName(detailHospital, location, city, state);

        if (currentIsLocationOnly && detailIsBetter) {
            return detailHospital.trim();
        }

        const descriptionHospital = extractBetterHospitalNameFromDescription(description, location, city, state);
        if (currentIsLocationOnly && descriptionHospital) {
            return descriptionHospital;
        }

        return currentHospital || descriptionHospital || detailHospital || '';
    }

    function canFetchAddressForHospital(hospitalName, location = '', city = '', state = '') {
        if (!hospitalName || !location) return false;
        if (isLocationOnlyHospitalName(hospitalName, location, city, state)) return false;
        if (isGenericOrganizationHospitalName(hospitalName)) return false;
        return true;
    }

    const ZIP_PREFIX_RANGES_BY_STATE = {
        'AL': [[350, 369]],
        'AK': [[995, 999]],
        'AZ': [[850, 865]],
        'AR': [[716, 729]],
        'CA': [[900, 961]],
        'CO': [[800, 816]],
        'CT': [[60, 69]],
        'DE': [[197, 199]],
        'DC': [[200, 205]],
        'FL': [[320, 349]],
        'GA': [[300, 319], [398, 399]],
        'HI': [[967, 968]],
        'ID': [[832, 838]],
        'IL': [[600, 629]],
        'IN': [[460, 479]],
        'IA': [[500, 528]],
        'KS': [[660, 679]],
        'KY': [[400, 427]],
        'LA': [[700, 714]],
        'ME': [[39, 49]],
        'MD': [[206, 219]],
        'MA': [[10, 27], [55, 55]],
        'MI': [[480, 499]],
        'MN': [[550, 567]],
        'MS': [[386, 397]],
        'MO': [[630, 658]],
        'MT': [[590, 599]],
        'NE': [[680, 693]],
        'NV': [[889, 898]],
        'NH': [[30, 38]],
        'NJ': [[70, 89]],
        'NM': [[870, 884]],
        'NY': [[100, 149]],
        'NC': [[270, 289]],
        'ND': [[580, 588]],
        'OH': [[430, 459]],
        'OK': [[730, 749]],
        'OR': [[970, 979]],
        'PA': [[150, 196]],
        'RI': [[28, 29]],
        'SC': [[290, 299]],
        'SD': [[570, 577]],
        'TN': [[370, 385]],
        'TX': [[733, 733], [750, 799], [885, 885]],
        'UT': [[840, 847]],
        'VT': [[50, 59]],
        'VA': [[201, 201], [220, 246]],
        'WA': [[980, 994]],
        'WV': [[247, 268]],
        'WI': [[530, 549]],
        'WY': [[820, 831]]
    };

    function zipMatchesState(zipCode, state) {
        const stateAbbr = getStateAbbreviation(state);
        const zipMatch = String(zipCode || '').match(/\b(\d{5})(?:-\d{4})?\b/);
        if (!stateAbbr || !zipMatch) return true;

        const prefix = parseInt(zipMatch[1].slice(0, 3), 10);
        const ranges = ZIP_PREFIX_RANGES_BY_STATE[stateAbbr] || [];
        return ranges.some(([min, max]) => prefix >= min && prefix <= max);
    }

    function extractZipFromAddressText(text) {
        const match = String(text || '').match(/\b(\d{5})(?:-\d{4})?\b/);
        return match ? match[1] : '';
    }

    function extractStateFromAddressText(text) {
        const match = String(text || '').match(/\b([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/i);
        return match ? match[1].toUpperCase() : '';
    }

    function isLivewellHospital(hospitalName) {
        return /livewell animal hospital/i.test(hospitalName || '');
    }

    function isLivewellWebsite(website) {
        try {
            const host = new URL(website || '').hostname.replace(/^www\./i, '').toLowerCase();
            return host === 'livewellanimal.com' || host.endsWith('.livewellanimal.com');
        } catch (_) {
            return false;
        }
    }

    function addressMatchesExpectedHospitalBrand(hospitalName, addressData) {
        if (!isLivewellHospital(hospitalName)) return true;

        const website = resolveWebsiteForHospital(hospitalName, addressData?.website || '');
        if (website) return isLivewellWebsite(website);

        return false;
    }

    function resolveWebsiteForHospital(hospitalName, website = '') {
        const name = (hospitalName || '').trim();
        if (/^mission pet health$/i.test(name)) return 'https://missionpethealth.com/';
        if (/livewell animal hospital/i.test(name)) return 'https://www.livewellanimal.com/';
        return website || '';
    }

    function applyMissingAddressDefaults(job) {
        const locationParts = parseLocationParts(job.location || '');
        job.streetAddress = !job.streetAddress || job.streetAddress === 'Not Available' ? 'TBD' : job.streetAddress;
        job.zipCode = job.zipCode || '00000';
        job.city = formatCityForStorage(job.city || locationParts.city || '');
        job.state = formatStateForStorage(job.state || locationParts.state || '');
        job.website = resolveWebsiteForHospital(job.hospital || '', job.website || '');
    }

    function getLivewellFallbackAddress() {
        return {
            streetAddress: 'TBD',
            zipCode: '00000',
            city: '',
            state: '',
            fullAddress: '',
            website: 'https://www.livewellanimal.com/',
            phone: ''
        };
    }

    function getMissionPetHealthFallbackAddress() {
        return {
            businessName: 'Mission Pet Health',
            streetAddress: 'TBD',
            zipCode: '00000',
            city: '',
            state: '',
            fullAddress: '',
            website: 'https://missionpethealth.com/',
            phone: '(205) 453-4760'
        };
    }

    const ADDRESS_LOOKUP_OVERRIDES = [
        {
            hospitals: ['foothills pet healthcare clinic'],
            location: 'mount airy|north carolina',
            searchLocation: 'Mt Airy, North Carolina',
            result: {
                streetAddress: '111 Healthy Trail',
                zipCode: '27030',
                city: 'Mount Airy',
                state: 'North Carolina',
                fullAddress: '111 Healthy Trail, Mt Airy, NC 27030, United States',
                website: 'https://foothillspethealthcareclinic.com/',
                phone: '(336) 789-0009'
            }
        },
        {
            hospitals: ['wil-o-paw animal hospital', 'wil o paw animal hospital'],
            location: 'coloma charter township|michigan',
            searchLocation: 'Coloma, Michigan',
            result: {
                streetAddress: '4809 Paw Paw Lake Rd',
                zipCode: '49038',
                city: 'Coloma',
                state: 'Michigan',
                fullAddress: '4809 Paw Paw Lake Rd, Coloma, MI 49038, United States',
                website: 'https://wilopaw.com/',
                phone: '+1 269-468-7297'
            }
        },
        {
            hospitals: ['west rome animal clinic'],
            location: 'west rome|georgia',
            searchLocation: 'Rome, Georgia',
            result: {
                streetAddress: '2012 Shorter Ave NW',
                zipCode: '30165',
                city: 'Rome',
                state: 'Georgia',
                fullAddress: '2012 Shorter Ave NW, Rome, GA 30165, United States',
                website: 'https://westromeanimalclinic.com/',
                phone: '+1 706-235-8861'
            }
        },
        {
            hospitals: ['acupet veterinary care'],
            location: 'florida|',
            searchLocation: 'Hudson, Florida',
            result: {
                streetAddress: '7708 State Rd 52',
                zipCode: '34667',
                city: 'Hudson',
                state: 'Florida',
                fullAddress: '7708 State Rd 52, Hudson, FL 34667, United States',
                website: 'https://acupetvetcare.com/',
                phone: '+1 727-819-6154'
            }
        },
        {
            hospitals: ['hillside veterinary hospital'],
            location: 'cottonwood heights|utah',
            result: {
                streetAddress: '7054 S 2300 E',
                zipCode: '84121',
                city: 'Salt Lake City',
                state: 'Utah',
                fullAddress: '7054 S 2300 E, Salt Lake City, UT 84121, United States'
            }
        },
        {
            hospitals: ['tomoka pines', 'tomoka pines veterinary hospital'],
            location: 'ormond|florida',
            searchHospital: 'Tomoka Pines Veterinary Hospital',
            searchLocation: 'Ormond Beach, Florida',
            result: {
                hospitalName: 'Tomoka Pines Veterinary Hospital',
                streetAddress: '750 S Nova Rd',
                zipCode: '32174',
                city: 'Ormond Beach',
                state: 'Florida',
                fullAddress: '750 S Nova Rd, Ormond Beach, FL 32174, United States'
            }
        },
        {
            hospitals: ['rivers veterinary urgent care'],
            location: 'pittsburg|pennsylvania',
            searchLocation: 'Pittsburgh, Pennsylvania',
            result: {
                streetAddress: '560 McNeilly Rd',
                zipCode: '15226',
                city: 'Pittsburgh',
                state: 'Pennsylvania',
                fullAddress: '560 McNeilly Rd, Pittsburgh, PA 15226, United States'
            }
        },
        {
            hospitals: ['cedar animal hospital'],
            location: 'richmon hill|georgia',
            searchLocation: 'Richmond Hill, Georgia',
            result: {
                streetAddress: '150 Cedar St',
                zipCode: '31324',
                city: 'Richmond Hill',
                state: 'Georgia',
                fullAddress: '150 Cedar St, Richmond Hill, GA 31324, United States'
            }
        },
        {
            hospitals: ['fullerton animal hospital'],
            location: 'baltimore|maryland',
            searchLocation: 'Nottingham, Maryland',
            result: {
                streetAddress: '8018 Belair Rd',
                zipCode: '21236',
                city: 'Nottingham',
                state: 'Maryland',
                fullAddress: '8018 Belair Rd, Nottingham, MD 21236, United States'
            }
        },
        {
            hospitals: ['riverbark veterinary hospital of spring lake', 'riverbark veterinary hospital'],
            location: 'spring lake|north carolina',
            searchHospital: 'Riverbark Veterinary Hospital of Spring Lake',
            result: {
                streetAddress: '1311 N Bragg Blvd',
                zipCode: '28390',
                city: 'Spring Lake',
                state: 'North Carolina',
                fullAddress: '1311 N Bragg Blvd, Spring Lake, NC 28390, United States',
                website: 'https://www.riverbarkvetspringlake.com/',
                phone: '+1 910-436-4801'
            }
        },
        {
            hospitals: ['mission pet health'],
            location: 'birmingham|alabama',
            result: {
                streetAddress: '2204 Lakeshore Drive, Suite 325',
                zipCode: '35209',
                city: 'Birmingham',
                state: 'Alabama',
                fullAddress: '2204 Lakeshore Drive, Suite 325, Birmingham, AL 35209, United States',
                website: 'https://missionpethealth.com/',
                phone: '(205) 453-4760'
            }
        }
    ];

    function normalizeLookupValue(value) {
        return (value || '')
            .toLowerCase()
            .replace(/&/g, ' and ')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    }

    function getOverrideLocationKey(location) {
        const parts = (location || '').split(',').map(part => part.trim()).filter(Boolean);
        return `${normalizeLookupValue(parts[0] || '')}|${normalizeLookupValue(getFullStateName(parts[1] || ''))}`;
    }

    function resolveAddressLookupTarget(hospitalName, location, originalHospitalName = '') {
        const hospitalCandidates = [hospitalName, originalHospitalName]
            .filter(Boolean)
            .map(normalizeLookupValue);
        const locationKey = getOverrideLocationKey(location);

        const match = ADDRESS_LOOKUP_OVERRIDES.find(override =>
            override.location === locationKey &&
            override.hospitals.some(name => hospitalCandidates.includes(normalizeLookupValue(name)))
        );

        return {
            searchHospital: match?.searchHospital || hospitalName,
            searchLocation: match?.searchLocation || location,
            directResult: match?.result ? { ...match.result } : null
        };
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
        'Medical Lead Veterinarian',
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
        'Emergency Care': ['Associate Veterinarian', 'Lead Veterinarian', 'Medical Director'],
        'General Practice Care': ['Associate Veterinarian', 'Lead Veterinarian', 'Medical Lead Veterinarian', 'Medical Director', 'Partner Veterinarian'],
        'Specialty Care': [
            'Anesthesiologist', 'Cardiologist', 'Credentialed Veterinary Technician Specialist',
            'DABVP Specialist', 'Dental Specialist', 'Dermatologist', 'ECC Specialist',
            'Internal Medicine Specialist', 'Medical Director', 'Medical Oncologist',
            'Neurologist & Neurosurgeon', 'Ophthalmologist', 'Radiation Oncologist',
            'Radiologist', 'Surgeon'
        ],
        'Urgent Care': ['Associate Veterinarian', 'Partner Veterinarian']
    };
    const NON_CLINICAL_TITLE_PATTERN = /\b(?:analyst|accountant|coordinator|marketing|tax|data scientist|vice president|acquisition diligence)\b/i;
    const URGENT_CARE_SIGNAL_PATTERN = /\burgent care\b|after hours urgent care|veterinary urgent care center/i;
    const EMERGENCY_SIGNAL_PATTERN = /\bemergency veterinarian\b|\ber veterinarian\b|\ber dvm\b|\ber\b|\bemergency\b/i;

    function extractCandidateRequirementSection(text) {
        const source = text || '';
        const headingPattern = /^\s*(?:who\s+we'?re\s+looking\s+for|who\s+we\s+are\s+looking\s+for|requirements?|qualifications?|what\s+you'?ll\s+need|credentials?|must\s+have|what\s+we\s+need)\s*:?\s*$/im;
        const headingMatch = headingPattern.exec(source);
        if (!headingMatch) return '';

        const afterHeading = source.slice(headingMatch.index + headingMatch[0].length);
        const nextHeadingMatch = afterHeading.match(/^\s*(?:will accept|benefits?|compensation|salary|about|our culture|location|website|apply|all applications|why|facility|what we offer|ready to|description & requirements|job description)\b/im);
        return (nextHeadingMatch ? afterHeading.slice(0, nextHeadingMatch.index) : afterHeading).trim();
    }

    function hasSpecialtyTrainingSignal(text) {
        const requirementText = extractCandidateRequirementSection(text);
        if (!requirementText) return false;

        const signalPattern = /\bboard[-\s]+certified\b|\bresidency[-\s]+trained\b|\bresidential[-\s]+trained\b|\bdiplomate\b|\bdacv(?:ecc|im|r|s|d|o|aa)?\b|\bdacvr[-\s]?ro\b|\bdavdc\b|\bdabvp\b/i;
        const optionalPattern = /\b(?:open to|preferred|a plus|plus but not required|not required|interested in|welcome|consider|considering|ideal|bonus)\b/i;

        return requirementText
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean)
            .some(line => signalPattern.test(line) && !optionalPattern.test(line));
    }

    function isNonClinicalJobTitle(title) {
        return NON_CLINICAL_TITLE_PATTERN.test(title || '');
    }

    function hasUrgentCareSignal(title, hospitalName = '', extraText = '') {
        return URGENT_CARE_SIGNAL_PATTERN.test(`${title || ''} ${hospitalName || ''} ${extraText || ''}`);
    }

    function hasEmergencySignal(title, hospitalName = '', extraText = '') {
        if (hasUrgentCareSignal(title, hospitalName, extraText)) return false;
        return EMERGENCY_SIGNAL_PATTERN.test(`${title || ''} ${hospitalName || ''} ${extraText || ''}`);
    }

    function matchApprovedPositionFromText(text) {
        if (!text) return '';

        const rules = [
            ['Medical Director', [/\bmedical director\b/i]],
            ['Medical Lead Veterinarian', [/\bmedical lead(?:\s+veterinarian)?\b/i]],
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
        if (isNonClinicalJobTitle(t)) return '';

        // === HIGHEST PRIORITY: Leadership positions ===
        // "Group Medical Director - The Oncology Service" → Medical Director, NOT Medical Oncologist
        if (t.includes('regional medical director')) return 'Medical Director';
        if (t.includes('medical director')) return 'Medical Director';
        if (t.includes('founding partner')) return 'Partner Veterinarian';
        if (t.includes('medical lead')) return 'Medical Lead Veterinarian';
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

        // Equine/Bovine/Exotics
        if (t.includes('equine') || t.includes('bovine') || t.includes('large animal') ||
            t.includes('avian') || t.includes('exotics')) return 'General Practice Care / Emergency Care / Urgent Care';

        return '';
    }

    // ============ LOCAL DETAIL EXTRACTION (mirrors detail-extractor.js) ============

    function extractDetailsFromDescription(positionTitle, descriptionText) {
        function getMetadataField(text, labels) {
            const candidates = Array.isArray(labels) ? labels : [labels];
            const lines = (text || '').split(/\r?\n/).map(line => line.trim());

            for (const label of candidates) {
                const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const match = (text || '').match(new RegExp(`^${escapedLabel}:\\s*(.+)$`, 'im'));
                if (match) return match[1].trim();

                const lineIndex = lines.findIndex(line => new RegExp(`^${escapedLabel}:?$`, 'i').test(line));
                if (lineIndex !== -1) {
                    const valueLine = lines.slice(lineIndex + 1).find(line => line && !/^[A-Za-z /]+:$/.test(line));
                    if (valueLine) return valueLine.trim();
                }
            }

            return '';
        }
        // Format salary to standard "$X–$Y per year" or "$X per hour"
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
                /\$[\d,]+(?:\.\d{2})?\s*(?:per\s+)?(?:hour|hr|\/hr)/i,
            ];
            for (const pattern of salaryPatterns) {
                const m = text.match(pattern);
                if (m) return formatSalary(m[0].trim());
            }
            return '';
        }

        // Extract industry/category from stored description text
        function getIndustryCategory(text) {
            return getMetadataField(text, ['Industry/Category', 'Category']);
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

            const rolePattern = /\b(?:medical director|medical lead(?:\s+veterinarian)?|lead veterinarian|lead vet|board certified|residency[-\s]+trained|residential[-\s]+trained|diplomate|criticalist|ecc specialist|emergency\s*(?:&|and)?\s*critical care specialist|internist|internal medicine specialist|cardiologist|dermatologist|neurologist|neurosurgeon|ophthalmologist|radiologist|diagnostic imaging specialist|anesthesiologist|medical oncologist|radiation oncologist|veterinary dentist|dental specialist|oral surgeon|veterinary surgeon|credentialed veterinary technician specialist|technician specialist|\bvts\b|\bdacv(?:ecc|im|r|s|d|o|aa)?\b|\bdacvr[-\s]?ro\b|\bdavdc\b|\bdabvp\b)\b/i;
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
        function determineAreaOfPractice(positionText, descriptionText, hospitalName = '') {
            const title = positionText.toLowerCase();
            const category = getIndustryCategory(descriptionText).toLowerCase();
            const department = getMetadataField(descriptionText, ['Department', 'Division', 'Team']).toLowerCase();

            if (isNonClinicalJobTitle(title)) return '';
            if (hasUrgentCareSignal(title, hospitalName, department)) return 'Urgent Care';
            if (/\b(?:oncologist|cardiologist|neurologist|neurosurgeon|dermatologist|ophthalmologist|anesthesiologist|theriogenologist|radiologist|internist|criticalist|ecc specialist|oncology|cardiology|neurology|dermatology|ophthalmology|anesthesia|theriogenology|radiology)\b/i.test(title)) return 'Specialty Care';
            if (hasSpecialtyTrainingSignal(descriptionText)) return 'Specialty Care';
            if (hasEmergencySignal(title, hospitalName, department)) return 'Emergency Care';
            if (/\b(?:founding partner|medical lead|lead veterinarian|lead vet|medical director|regional medical director)\b/i.test(title)) return 'General Practice Care';

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

            if (department) {
                if (department.includes('urgent care')) return 'Urgent Care';
                if (department.includes('emergency') || /\ber\b/.test(department)) return 'Emergency Care';
                if (/(oncolog|cardiolog|neurolog|neurosurg|dermatolog|ophthalmolog|anesthes|internal medicine|radiolog|diagnostic imaging|critical care|specialty|specialist|surgery|surgeon|dent)/.test(department)) {
                    return 'Specialty Care';
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

            // STEP 4: Check TITLE for equine/bovine/large animal/avian/exotics
            if (title.includes('equine') || title.includes('bovine') || title.includes('large animal') ||
                title.includes('avian') || title.includes('exotics')) {
                return 'General Practice Care / Emergency Care / Urgent Care';
            }

            // STEP 5: For generic titles, check ONLY the qualifications section
            if (hasSpecialtyTrainingSignal(descriptionText)) return 'Specialty Care';

            // STEP 6: Check page text for ER category
            if (descriptionText.match(/Veterinarian \(ER\)/i)) return 'Emergency Care';

            return 'General Practice Care';
        }

        // Match position from title keywords
        // PRIORITY ORDER: Leadership first (to avoid false matches on service names), then specialty, then generic
        function matchPositionFromTitle(title) {
            const t = (title || '').toLowerCase();
            if (isNonClinicalJobTitle(t)) return '';

            // === HIGHEST PRIORITY: Leadership positions ===
            // Must be checked FIRST — "Group Medical Director - The Oncology Service" should be
            // Medical Director, NOT Medical Oncologist. The specialty word is the service name, not the role.
            if (t.includes('regional medical director')) return 'Medical Director';
            if (t.includes('medical director')) return 'Medical Director';
            if (t.includes('founding partner')) return 'Partner Veterinarian';
            if (t.includes('medical lead')) return 'Medical Lead Veterinarian';
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
                'Emergency Care': ['Associate Veterinarian', 'Lead Veterinarian', 'Medical Director'],
                'General Practice Care': ['Associate Veterinarian', 'Lead Veterinarian', 'Medical Lead Veterinarian', 'Medical Director', 'Partner Veterinarian'],
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
            if (!position) {
                position = matchPositionFromQualifications(descriptionText);
            }
            return APPROVED_POSITION_SET.has(position) ? position : '';
        }

        // Extract locations from stored description (which now includes JSON-LD data)
        function extractLocations(text) {
            const locations = [];

            const explicitLocation = getMetadataField(text, ['Location', 'Job Location', 'Work Location']);
            const explicitCity = getMetadataField(text, ['City', 'Job City']);
            const explicitState = getMetadataField(text, ['State', 'Province', 'Job State']);

            if (explicitCity && explicitState) {
                locations.push({
                    city: explicitCity,
                    state: explicitState,
                    location: `${explicitCity}, ${explicitState}`
                });
            } else if (explicitState) {
                locations.push({
                    city: '',
                    state: explicitState,
                    location: explicitState
                });
            } else if (explicitCity && isStateValue(explicitCity)) {
                locations.push({
                    city: '',
                    state: explicitCity,
                    location: explicitCity
                });
            } else if (explicitLocation) {
                const explicitMatch = explicitLocation.match(/([A-Za-z][\w\s.'()-]*[A-Za-z])\s*,\s*([A-Za-z]{2}|[A-Za-z][A-Za-z\s]+)$/);
                if (explicitMatch) {
                    const city = explicitMatch[1].trim();
                    const state = explicitMatch[2].trim();
                    locations.push({ city, state, location: `${city}, ${state}` });
                } else if (isStateValue(explicitLocation)) {
                    locations.push({ city: '', state: explicitLocation, location: explicitLocation });
                }
            }

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
            return extractBetterHospitalNameFromDescription(text) || '';
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
        const hospitalName = extractHospitalName(descriptionText);
        const salary = extractSalary(descriptionText);
        const areaOfPractice = determineAreaOfPractice(positionTitle, descriptionText, hospitalName);
        const position = determinePosition(positionTitle, descriptionText, areaOfPractice);
        const locations = extractLocations(descriptionText);
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

    // Address lookup uses Google Maps first. If Maps does not return a usable
    // address, it falls back to Google Search, which checks the right-side panel
    // and then one matching left-side result/card.
    async function fetchAddressFromGoogleMaps(hospitalName, location, originalHospitalName = '') {
        // Build search query: "Hospital Name, City, State"
        const searchQuery = `${hospitalName}, ${location}`;
        const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`;

        function emptyAddressResult() {
            return { businessName: '', streetAddress: '', zipCode: '', city: '', state: '', fullAddress: '', website: '', phone: '' };
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
            if (parts.length === 1 && isStateValue(parts[0])) {
                return {
                    city: '',
                    state: normalizeStateForCompare(parts[0])
                };
            }

            return {
                city: parts[0] || '',
                state: parts.length >= 2 ? normalizeStateForCompare(parts[1]) : ''
            };
        }

        function parseLocationFromAddressText(text) {
            const source = String(text || '');
            const match = source.match(/,\s*([^,]+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/i);
            if (!match) {
                const stateZip = source.match(/\b([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\b/i);
                return {
                    city: '',
                    state: stateZip ? normalizeStateForCompare(stateZip[1]) : '',
                    zipCode: stateZip ? stateZip[2] : ''
                };
            }

            return {
                city: match[1].trim(),
                state: normalizeStateForCompare(match[2]),
                zipCode: match[3]
            };
        }

        function resultMatchesExpectedLocation(result) {
            const parsedFromAddress = parseLocationFromAddressText(result.fullAddress || result.streetAddress || '');
            const zipCode = result.zipCode || parsedFromAddress.zipCode || extractZipFromAddressText(result.fullAddress || result.streetAddress || '');
            const resultCity = normalizeCityForCompare(result.city || parsedFromAddress.city || '');
            const resultState = normalizeStateForCompare(result.state || parsedFromAddress.state || '');
            const expectedCity = normalizeCityForCompare(expectedLocation.city);
            const expectedState = expectedLocation.state;

            if (expectedCity && !resultCity) return false;
            if (expectedState && !resultState && !zipCode) return false;
            if (expectedCity && resultCity !== expectedCity) return false;
            if (expectedState && resultState && resultState !== expectedState) return false;
            if (expectedState && zipCode && !zipMatchesState(zipCode, expectedState)) return false;
            return true;
        }

        function filterDataForExpectedLocation(data, sourceLabel) {
            const result = data || emptyAddressResult();
            const hasLocationSignal = !!(result.streetAddress || result.zipCode || result.fullAddress || result.city || result.state);

            if (hasLocationSignal && !resultMatchesExpectedLocation(result)) {
                console.warn(`Ignoring address result outside requested location "${location}" from "${sourceLabel}": ${result.fullAddress || [result.city, result.state, result.zipCode].filter(Boolean).join(', ')}`);
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
                phone: primary.phone || safeSecondary.phone || ''
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
                    resolve(emptyAddressResult());
                }, 30000);

                chrome.tabs.create({ url: url, active: false }, (tab) => {
                    if (!tab) {
                        clearTimeout(timeout);
                        resolve(emptyAddressResult());
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
                                        phone: data.phone || ''
                                    });
                                }).catch((err) => {
                                    console.error(`Google Maps script error for "${queryLabel}":`, err);
                                    clearTimeout(timeout);
                                    chrome.tabs.remove(tabId).catch(() => {});
                                    resolve(emptyAddressResult());
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
                                        phone: data.phone || ''
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
                                        phone: data.phone || ''
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
                                        phone: data.phone || ''
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

        console.log(`Google Maps address search: "${searchQuery}"`);
        let data = mergeMapsData(emptyAddressResult(), await scrapeGoogleMapsTabSafe(mapsUrl, searchQuery), searchQuery);

        if (needsMapsRetry(data)) {
            for (const query of uniqueQueries(buildHospitalNameVariants()).slice(0, 6)) {
                if (!needsMapsRetry(data)) break;
                if (query === searchQuery) continue;
                console.log(`Google Maps address candidate: "${query}"`);
                const variantUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
                const mapsData = await scrapeGoogleMapsTabSafe(variantUrl, query);
                data = mergeMapsData(data, mapsData, query);
            }
        }

        if (needsMapsRetry(data)) {
            for (const query of uniqueQueries(buildHospitalNameVariants()).slice(0, 4)) {
                if (!needsMapsRetry(data)) break;
                console.log(`Google Search address candidate: "${query}"`);
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
            console.warn(`No Google Maps or Google Search address found for: "${searchQuery}"`);
        }

        return {
            businessName: data.businessName || '',
            streetAddress: data.streetAddress || '',
            zipCode: data.zipCode || '',
            city: data.city || '',
            state: data.state || '',
            fullAddress: data.fullAddress || '',
            website: data.website || '',
            phone: data.phone || ''
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
        return job.jobId || job.link || `${job.title || ''}||${job.hospital || ''}||${job.location || ''}`;
    }

    function pruneSelection() {
        const availableKeys = new Set(allJobs.map(getJobSelectionKey));

        for (const key of [...selectedJobKeys]) {
            if (!availableKeys.has(key)) {
                selectedJobKeys.delete(key);
            }
        }
    }

    function updateSelectionControls() {
        const selectedCount = selectedJobKeys.size;
        const canEditSelected = selectedCount === 1;
        const visibleSelectionCount = displayedJobs.filter(job => selectedJobKeys.has(getJobSelectionKey(job))).length;
        const hasVisibleJobs = displayedJobs.length > 0;

        editSelectedJobBtn.classList.toggle('hidden', !canEditSelected);
        selectAllVisibleCheckbox.checked = hasVisibleJobs && visibleSelectionCount === displayedJobs.length;
        selectAllVisibleCheckbox.indeterminate = visibleSelectionCount > 0 && visibleSelectionCount < displayedJobs.length;
        selectAllVisibleCheckbox.disabled = !hasVisibleJobs;

        deleteSelectedJobsBtn.classList.toggle('hidden', selectedCount === 0);
        deleteSelectedJobsBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
              <path d="M9,3V4H4V6H5V19A2,2 0 0,0 7,21H17A2,2 0 0,0 19,19V6H20V4H15V3H9M7,6H17V19H7V6Z"/>
            </svg>
            Delete Selected${selectedCount ? ` (${selectedCount})` : ''}
        `;
    }

    function matchesSearch(job, term) {
        return (
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
    }

    function getFilteredJobs(searchTerm = '') {
        const term = (searchTerm || '').trim().toLowerCase();

        if (!term) {
            return [...allJobs];
        }

        return allJobs.filter(job => matchesSearch(job, term));
    }

    function getVisibleJobs() {
        const filteredJobs = getFilteredJobs(searchInput ? searchInput.value : '');
        return currentSortColumn
            ? sortRecords(currentSortColumn, currentSortDirection, filteredJobs)
            : filteredJobs;
    }

    function renderCurrentView() {
        pruneSelection();
        displayRecords(getVisibleJobs());
    }

    function toggleJobSelection(job, isSelected) {
        const jobKey = getJobSelectionKey(job);

        if (isSelected) {
            selectedJobKeys.add(jobKey);
        } else {
            selectedJobKeys.delete(jobKey);
        }
    }

    function toggleAllVisibleJobs(isSelected) {
        displayedJobs.forEach(job => {
            const jobKey = getJobSelectionKey(job);
            if (isSelected) {
                selectedJobKeys.add(jobKey);
            } else {
                selectedJobKeys.delete(jobKey);
            }
        });

        renderCurrentView();
    }

    function deleteSelectedJobs() {
        const selectedCount = selectedJobKeys.size;

        if (selectedCount === 0) {
            showToast('Select at least one job to delete.', 'error');
            return;
        }

        const label = selectedCount === 1 ? 'this job' : `${selectedCount} jobs`;
        if (!confirm(`Are you sure you want to delete ${label} from the records?`)) {
            return;
        }

        allJobs = allJobs.filter(job => !selectedJobKeys.has(getJobSelectionKey(job)));
        selectedJobKeys.clear();

        chrome.storage.local.set({ scrapedJobs: allJobs }, () => {
            renderCurrentView();
            showToast(`Deleted ${selectedCount} job${selectedCount === 1 ? '' : 's'} from records!`, 'success');
        });
    }

    function getSelectedJobs() {
        return allJobs.filter(job => selectedJobKeys.has(getJobSelectionKey(job)));
    }

    function closeEditJobModal() {
        editingJobKey = '';
        editJobModal.classList.add('hidden');
        editJobForm.reset();
    }

    function openEditJobModal() {
        const selectedJobs = getSelectedJobs();
        if (selectedJobs.length !== 1) {
            showToast('Select exactly one job to edit.', 'error');
            return;
        }

        const job = selectedJobs[0];
        editingJobKey = getJobSelectionKey(job);
        editJobMeta.textContent = `${job.jobId || 'No Job ID'} - ${job.title || 'Untitled Job'}`;

        const fieldIds = [
            'title', 'hospital', 'location', 'streetAddress', 'city', 'state', 'zipCode',
            'phone', 'website', 'areaOfPractice', 'position', 'salary', 'jobType',
            'experience', 'description'
        ];

        fieldIds.forEach(field => {
            const input = document.getElementById(`editJob${field.charAt(0).toUpperCase()}${field.slice(1)}`);
            if (input) {
                input.value = job[field] || '';
            }
        });

        editJobModal.classList.remove('hidden');
    }

    async function saveEditedJob(event) {
        event.preventDefault();

        if (!editingJobKey) {
            closeEditJobModal();
            return;
        }

        const jobIndex = allJobs.findIndex(job => getJobSelectionKey(job) === editingJobKey);
        if (jobIndex === -1) {
            closeEditJobModal();
            showToast('Selected job could not be found.', 'error');
            return;
        }

        const formData = new FormData(editJobForm);
        const updatedFields = Object.fromEntries(formData.entries());

        Object.keys(updatedFields).forEach(key => {
            updatedFields[key] = (updatedFields[key] || '').trim();
        });

        allJobs[jobIndex] = {
            ...allJobs[jobIndex],
            ...updatedFields
        };

        if (allJobs[jobIndex].state) {
            allJobs[jobIndex].state = getFullStateName(allJobs[jobIndex].state);
        }

        await chrome.storage.local.set({ scrapedJobs: allJobs });
        closeEditJobModal();
        renderCurrentView();
        showToast('Job record updated.', 'success');
    }

    function displayRecords(jobs) {
        displayedJobs = jobs;
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
            const jobKey = getJobSelectionKey(job);
            const isSelected = selectedJobKeys.has(jobKey);

            // Mark new jobs with green background
            if (job.isNewLocation) {
                row.style.backgroundColor = '#d1fae5';
            }

            if (isSelected) {
                row.classList.add('row-selected');
            }

            const selectionCell = row.insertCell(0);
            selectionCell.className = 'selection-cell';
            const selectionInput = document.createElement('input');
            selectionInput.type = 'checkbox';
            selectionInput.className = 'selection-checkbox';
            selectionInput.checked = isSelected;
            selectionInput.setAttribute('aria-label', `Select ${job.title || 'job'}`);
            selectionInput.addEventListener('change', () => {
                toggleJobSelection(job, selectionInput.checked);
                renderCurrentView();
            });
            selectionCell.appendChild(selectionInput);

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
            row.insertCell(5).textContent = 'Mission Pet Health (Parent Client)';
            row.insertCell(6).textContent = job.streetAddress || '-';
            row.insertCell(7).textContent = job.city;
            row.insertCell(8).textContent = job.state;
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
                websiteLink.style.color = '#2563eb';
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
                const descDiv = document.createElement('div');
                descDiv.className = 'description-cell';
                descDiv.textContent = job.description;
                descCell.appendChild(descDiv);
            } else {
                descCell.innerHTML = '<span style="color: #94a3b8; font-style: italic; font-size: 12px;">Not scraped</span>';
            }
        });

        updateSelectionControls();
    }

    function filterJobs(searchTerm) {
        if (searchInput && searchInput.value !== searchTerm) {
            searchInput.value = searchTerm;
        }

        renderCurrentView();
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
                `"Mission Pet Health (Parent Client)"`,
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
        link.setAttribute('download', `mph_jobs_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        showToast(`Exported ${allJobs.length} jobs to CSV!`, 'success');
    }

    // Initialize
    chrome.storage.local.get(['scrapedJobs'], (result) => {
        allJobs = result.scrapedJobs || [];
        renderCurrentView();

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

                renderCurrentView();
            });
        });
    });

    // Search functionality
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            filterJobs(e.target.value);
        });
    }

    selectAllVisibleCheckbox.addEventListener('change', () => {
        toggleAllVisibleJobs(selectAllVisibleCheckbox.checked);
    });

    editSelectedJobBtn.addEventListener('click', () => {
        openEditJobModal();
    });

    deleteSelectedJobsBtn.addEventListener('click', () => {
        deleteSelectedJobs();
    });

    closeEditJobModalBtn.addEventListener('click', () => {
        closeEditJobModal();
    });

    cancelEditJobBtn.addEventListener('click', () => {
        closeEditJobModal();
    });

    editJobModal.addEventListener('click', (event) => {
        if (event.target === editJobModal) {
            closeEditJobModal();
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !editJobModal.classList.contains('hidden')) {
            closeEditJobModal();
        }
    });

    editJobForm.addEventListener('submit', saveEditedJob);

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
                    renderCurrentView();
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
                    renderCurrentView();
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
                    renderCurrentView();
                    showToast(`Cleared address data from ${clearedCount} jobs!`, 'success');
                });
            });
        }
    });

    // Clear all records
    clearRecordsButton.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all scraped job records?')) {
            chrome.storage.local.set({
                scrapedJobs: [],
                scrapedJobIds: [],
                scrapingComplete: false,
                scrapingStatus: ''
            }, () => {
                allJobs = [];
                renderCurrentView();
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
            aggregator: "Mission Pet Health (Parent Client)",
            street_address: job.streetAddress || '',
            parent_client: "Mission Pet Health (Parent Client)",
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
                source: 'Mission Pet Health Job Scraper',
                parentClientName: 'Mission Pet Health (Parent Client)',
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

        descriptionQueue = jobs
            .map((job, index) => ({
                index,
                jobId: job.jobId || '',
                link: job.link || '',
                attempts: 0
            }))
            .filter(item => !jobs[item.index].description && item.link);

        if (descriptionQueue.length === 0) {
            showToast('All jobs already have descriptions!', 'success');
            return;
        }

        isGettingDescriptions = true;
        currentJobIndex = 0;
        failedDescriptionCount = 0;

        getDescriptionsBtn.disabled = true;
        getDescriptionsBtn.textContent = 'Getting Descriptions...';

        // Show progress
        const progressSection = document.getElementById('progressSection');
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        const progressLabel = document.getElementById('progressLabel');
        progressSection.classList.remove('hidden');
        progressLabel.textContent = 'Getting Descriptions';
        progressText.textContent = `0 / ${descriptionQueue.length}`;
        progressBar.style.width = '0%';

        processNextJob();
    });

    async function processNextJob() {
        // Update progress
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        const totalToProcess = descriptionQueue.length;
        progressText.textContent = `${Math.min(currentJobIndex, totalToProcess)} / ${totalToProcess}`;
        progressBar.style.width = totalToProcess
            ? `${(Math.min(currentJobIndex, totalToProcess) / totalToProcess) * 100}%`
            : '0%';

        if (currentJobIndex >= descriptionQueue.length) {
            isGettingDescriptions = false;
            getDescriptionsBtn.disabled = false;
            getDescriptionsBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20M13,13H11V18H13V13M13,9.5H11V11.5H13V9.5Z"/>
                </svg>
                Get Descriptions
            `;
            document.getElementById('progressSection').classList.add('hidden');
            if (failedDescriptionCount > 0) {
                showToast(`Descriptions finished with ${failedDescriptionCount} failed job(s). Check console for details.`, 'error');
            } else {
                showToast('All descriptions have been fetched!', 'success');
            }
            return;
        }

        const data = await chrome.storage.local.get(['scrapedJobs']);
        const jobs = data.scrapedJobs || [];
        const queueItem = descriptionQueue[currentJobIndex];
        const jobIndex = jobs.findIndex((job, index) => {
            if (queueItem.jobId && job.jobId === queueItem.jobId) return true;
            if (queueItem.link && job.link === queueItem.link) return true;
            return index === queueItem.index;
        });

        if (jobIndex === -1 || jobs[jobIndex]?.description || !jobs[jobIndex]?.link) {
            currentJobIndex++;
            setTimeout(() => processNextJob(), 50);
            return;
        }

        const job = jobs[jobIndex];
        getDescriptionsBtn.textContent = `Getting Descriptions... (${currentJobIndex + 1}/${descriptionQueue.length})`;

        try {
            // Add nl=1 param so Jobvite serves the standalone page instead of redirecting to the parent site iframe
            const jobUrl = new URL(job.link);
            jobUrl.searchParams.set('nl', '1');
            const tab = await chrome.tabs.create({ url: jobUrl.toString(), active: false });
            chrome.runtime.sendMessage({
                action: 'scrapeJobDescription',
                tabId: tab.id,
                jobIndex: jobIndex,
                queueIndex: currentJobIndex,
                jobLink: job.link
            }).catch((error) => {
                console.error('Error starting description scrape:', error);
                chrome.tabs.remove(tab.id).catch(() => {});
                failedDescriptionCount++;
                currentJobIndex++;
                setTimeout(() => processNextJob(), 1500);
            });
        } catch (error) {
            console.error('Error opening tab for job:', error);
            failedDescriptionCount++;
            currentJobIndex++;
            setTimeout(() => processNextJob(), 1500);
        }
    }

    // Listen for description saved messages from background.js
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'descriptionSaved') {
            chrome.storage.local.get(['scrapedJobs'], (data) => {
                const jobs = data.scrapedJobs || [];
                allJobs = jobs;
                renderCurrentView();

                if (isGettingDescriptions) {
                    const queueItem = descriptionQueue[currentJobIndex];
                    const isCurrentQueueMessage = message.queueIndex === undefined || message.queueIndex === currentJobIndex;

                    if (!message.success) {
                        const error = message.error || 'Description scrape failed.';
                        const canRetry = queueItem && queueItem.attempts < 1 && !/quota|storage|save/i.test(error);

                        if (canRetry && isCurrentQueueMessage) {
                            queueItem.attempts++;
                            console.warn(`Retrying description for job ${queueItem.jobId || queueItem.link}: ${error}`);
                            setTimeout(() => processNextJob(), 2000);
                            return;
                        }

                        failedDescriptionCount++;
                        console.warn(`Description failed for job index ${message.jobIndex}: ${error}`);
                    }

                    if (isCurrentQueueMessage) {
                        currentJobIndex++;
                    }

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
                const needsDetails = !item.job.areaOfPractice || !item.job.position || !item.job.experience;
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
                const detailLocation = firstDetail.location || originalJob.location || '';
                const detailCity = firstDetail.city || originalJob.city || '';
                const detailState = firstDetail.state || originalJob.state || '';
                const resolvedHospital = resolveHospitalNameFromDetails(
                    originalJob.hospital || '',
                    firstDetail.hospitalName || '',
                    descText,
                    detailLocation,
                    detailCity,
                    detailState
                );
                const detailHospital = resolvedHospital || firstDetail.hospitalName || originalJob.hospital || '';

                // Step 1: Determine AOP — prefer detail extractor's AOP (from page category), fall back to title
                let finalAOP = '';
                if (!isNonClinicalJobTitle(listingTitle)) {
                    finalAOP = hasSpecialtyTrainingSignal(descText)
                        ? 'Specialty Care'
                        : (detailAOP ||
                            (hasUrgentCareSignal(listingTitle, detailHospital, descText) ? 'Urgent Care' : '') ||
                            (hasEmergencySignal(listingTitle, detailHospital) ? 'Emergency Care' : '') ||
                            getAOPFromTitle(listingTitle) ||
                            'General Practice Care');
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
                originalJob.jobType = firstDetail.jobType || originalJob.jobType || 'Full-Time';
                originalJob.experience = firstDetail.experience || originalJob.experience || '';
                if (resolvedHospital) originalJob.hospital = resolvedHospital;
                originalJob.city = formatCityForStorage(firstDetail.city || '');
                if (firstDetail.state) {
                    originalJob.state = formatStateForStorage(firstDetail.state);
                } else if (firstDetail.city || firstDetail.location) {
                    originalJob.state = '';
                }
                if (firstDetail.location) originalJob.location = firstDetail.location;
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
                    const hasCitySuffix = false;
                    const baseHospitalName = '';

                    // Update parent job's hospital name with first location's city (only if it already had a suffix)
                    if (hasCitySuffix) {
                        const firstLocCity = detailsList[0].city || '';
                        if (firstLocCity) {
                            void firstLocCity;
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
                            hospital: currentHospital,
                            city: formatCityForStorage(loc.city || ''),
                            state: formatStateForStorage(loc.state || ''),
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
                    renderCurrentView();
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
        return !!(data && data.streetAddress && data.zipCode && data.streetAddress !== 'TBD' && data.zipCode !== '00000');
    }

    function parseLocationParts(location) {
        const parts = (location || '').split(',').map(part => part.trim()).filter(Boolean);
        if (parts.length === 1 && isStateValue(parts[0])) {
            return {
                city: '',
                state: parts[0]
            };
        }

        return {
            city: parts[0] || '',
            state: parts.length >= 2 ? parts[1] : ''
        };
    }

    function normalizedLocationPart(value) {
        return normalizeCityForCompare(value);
    }

    function jobLocationMismatch(job) {
        const expected = parseLocationParts(job.location);
        return !!(
            (expected.city && job.city && normalizedLocationPart(job.city) !== normalizedLocationPart(expected.city)) ||
            (expected.state && job.state && normalizedLocationPart(getFullStateName(job.state)) !== normalizedLocationPart(getFullStateName(expected.state)))
        );
    }

    function savedAddressStateMismatch(job) {
        if (job.zipCode === '00000') return false;
        const expected = parseLocationParts(job.location);
        const expectedState = expected.state || job.state || '';
        return !!(job.zipCode && expectedState && !zipMatchesState(job.zipCode, expectedState));
    }

    function savedAddressBrandMismatch(job) {
        if (!isLivewellHospital(job.hospital)) return false;
        if (hasLivewellFallbackAddress(job)) return false;
        return !!(job.streetAddress || job.zipCode || job.website || job.phone) && !isLivewellWebsite(job.website || '');
    }

    function hasLivewellFallbackAddress(job) {
        return isLivewellHospital(job.hospital) &&
            (job.streetAddress === 'TBD' || job.streetAddress === 'Not Available') &&
            job.zipCode === '00000';
    }

    function hasDefaultAddress(job) {
        return (job?.streetAddress || '') === 'TBD' || (job?.zipCode || '') === '00000';
    }

    function applyLivewellFallback(job) {
        const fallback = getLivewellFallbackAddress();
        const locationParts = parseLocationParts(job.location || '');
        job.streetAddress = fallback.streetAddress;
        job.zipCode = fallback.zipCode;
        job.city = formatCityForStorage(job.city || locationParts.city || '');
        job.state = formatStateForStorage(job.state || locationParts.state || '');
        job.website = fallback.website;
        job.phone = fallback.phone;
    }

    function applyMissionPetHealthFallback(job) {
        const fallback = getMissionPetHealthFallbackAddress();
        const locationParts = parseLocationParts(job.location || '');
        job.streetAddress = fallback.streetAddress;
        job.zipCode = fallback.zipCode;
        job.city = formatCityForStorage(job.city || locationParts.city || '');
        job.state = formatStateForStorage(job.state || locationParts.state || '');
        job.website = fallback.website;
        job.phone = fallback.phone;
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

    function canLookupAddressForJob(job) {
        return canFetchAddressForHospital(job.hospital, job.location, job.city, job.state) ||
            isMissionPetHealthHospital(job.hospital);
    }

    function primeAddressCache(jobs) {
        addressCache = new Map();
        for (const job of jobs) {
            if (!job.hospital || !job.location || !job.streetAddress || !job.zipCode) continue;
            if (!canFetchAddressForHospital(job.hospital, job.location, job.city, job.state)) continue;
            if (jobLocationMismatch(job)) continue;
            if (savedAddressStateMismatch(job)) continue;
            if (savedAddressBrandMismatch(job)) continue;
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
        let clearedInvalidAddressCount = 0;
        let defaultedAddressCount = 0;

        jobs.forEach(job => {
            const resolvedWebsite = resolveWebsiteForHospital(job.hospital || '', job.website || '');
            if (resolvedWebsite !== (job.website || '')) {
                job.website = resolvedWebsite;
            }
            if (job.streetAddress === 'Not Available') {
                job.streetAddress = 'TBD';
            }

            if (
                canLookupAddressForJob(job) &&
                !savedAddressStateMismatch(job) &&
                !savedAddressBrandMismatch(job)
            ) return;

            if (job.streetAddress || job.zipCode || job.website || job.phone) {
                job.streetAddress = '';
                job.zipCode = '';
                job.website = '';
                job.phone = '';
                clearedInvalidAddressCount++;
            }
        });

        jobs.forEach(job => {
            const missingAddress = !job.streetAddress || !job.zipCode;
            if (!missingAddress || canLookupAddressForJob(job)) return;
            if (!job.hospital && !job.location) return;

            applyMissingAddressDefaults(job);
            defaultedAddressCount++;
        });

        if (clearedInvalidAddressCount > 0 || defaultedAddressCount > 0) {
            await chrome.storage.local.set({ scrapedJobs: jobs });
            allJobs = jobs;
            renderCurrentView();
        }

        // Find jobs that need address/contact data (using LOCATION column)
        const jobsNeedingAddresses = jobs.map((job, index) => ({ job, index }))
            .filter(item => {
                if (hasLivewellFallbackAddress(item.job)) return false;
                // Jobs missing any core location/contact field
                return canLookupAddressForJob(item.job) &&
                    (!item.job.streetAddress || !item.job.zipCode || hasDefaultAddress(item.job) || jobLocationMismatch(item.job) || savedAddressStateMismatch(item.job) || savedAddressBrandMismatch(item.job) || isMissionPetHealthHospital(item.job.hospital));
            });

        if (jobsNeedingAddresses.length === 0) {
            if (confirm('All jobs already have addresses. Do you want to re-fetch addresses for all jobs?')) {
                addressQueue = jobs.map((job, index) => ({ job, index }))
                    .filter(item => canLookupAddressForJob(item.job) && !hasLivewellFallbackAddress(item.job));
            } else {
                if (clearedInvalidAddressCount > 0 || defaultedAddressCount > 0) {
                    showToast(`Updated address defaults for ${clearedInvalidAddressCount + defaultedAddressCount} row(s).`, 'success');
                }
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
            if (!canLookupAddressForJob(job)) {
                const data = await chrome.storage.local.get(['scrapedJobs']);
                const jobs = data.scrapedJobs || [];
                if (jobs[index]) {
                    applyMissingAddressDefaults(jobs[index]);
                    await chrome.storage.local.set({ scrapedJobs: jobs });
                    allJobs = jobs;
                    renderCurrentView();
                }
                currentAddressIndex++;
                setTimeout(() => processNextAddress(), 50);
                return;
            }

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

            const lookupTarget = resolveAddressLookupTarget(searchHospital, job.location || '', job.hospital || '');
            searchHospital = lookupTarget.searchHospital || searchHospital;

            // Parse city and state from the resolved search location
            let searchCity = '';
            let searchState = '';
            const searchLocationSource = lookupTarget.searchLocation || job.location || '';
            if (searchLocationSource) {
                const locParts = searchLocationSource.split(',').map(s => s.trim());
                if (locParts.length >= 2) {
                    searchCity = locParts[0];
                    searchState = locParts[1];
                } else if (locParts.length === 1) {
                    if (isStateValue(locParts[0])) {
                        searchState = locParts[0];
                    } else {
                        searchCity = locParts[0];
                    }
                }
            }

            const searchLocation = [searchCity, searchState].filter(Boolean).join(', ');
            const normalizeLocationValue = normalizeCityForCompare;

            const cacheKeys = getAddressCacheKeys(searchHospital, searchLocation, job.hospital || '');
            let addressData = lookupTarget.directResult ? { ...lookupTarget.directResult } : null;
            const shouldSkipCache = !!lookupTarget.directResult || isMissionPetHealthHospital(job.hospital);
            if (!shouldSkipCache) addressData = getRememberedAddress(cacheKeys);

            if (addressData) {
                console.log(`${lookupTarget.directResult ? 'Using override' : 'Using cached'} address for "${searchHospital}, ${searchLocation}"`);
            } else {
                addressData = await fetchAddressFromGoogleMaps(searchHospital, searchLocation, job.hospital || '');
            }

            const fetchedZip = addressData?.zipCode || extractZipFromAddressText(addressData?.fullAddress || addressData?.streetAddress || '');
            const fetchedState = addressData?.state || extractStateFromAddressText(addressData?.fullAddress || addressData?.streetAddress || '');
            const fetchedCity = addressData?.city || '';
            const fetchedLocationMismatch =
                (searchCity && (!fetchedCity || normalizeLocationValue(fetchedCity) !== normalizeLocationValue(searchCity))) ||
                (searchState && !fetchedState && !fetchedZip) ||
                (searchState && fetchedState && getStateAbbreviation(fetchedState) !== getStateAbbreviation(searchState)) ||
                (searchState && fetchedZip && !zipMatchesState(fetchedZip, searchState));
            const fetchedBrandMismatch = !addressMatchesExpectedHospitalBrand(job.hospital, addressData);

            if (fetchedLocationMismatch || fetchedBrandMismatch) {
                const reason = fetchedBrandMismatch ? 'wrong hospital brand' : 'outside requested location';
                console.warn(`Ignoring address result ${reason} "${searchLocation}" for "${searchHospital}": ${addressData.fullAddress || addressData.website || [addressData.city, addressData.state, addressData.zipCode].filter(Boolean).join(', ')}`);
                addressData = { streetAddress: '', zipCode: '', city: '', state: '', fullAddress: '', website: '', phone: '' };
            }

            rememberAddressData(cacheKeys, addressData);

            // Update job with address data from Google Maps
            const data = await chrome.storage.local.get(['scrapedJobs']);
            const jobs = data.scrapedJobs || [];

            if (jobs[index]) {
                const zipFromFull = addressData.fullAddress?.match(/\b(\d{5}(?:-\d{4})?)\b/);
                jobs[index].streetAddress = addressData.streetAddress || 'TBD';
                jobs[index].zipCode = addressData.zipCode || zipFromFull?.[1] || '00000';

                // City and state come from the row's Location column. Fetched address data
                // is accepted only when it matches this location.
                jobs[index].city = formatCityForStorage(searchCity || addressData.city || jobs[index].city || '');
                jobs[index].state = formatStateForStorage(searchState || addressData.state || jobs[index].state || '');

                // Website and phone from Google Maps
                jobs[index].website = resolveWebsiteForHospital(jobs[index].hospital || searchHospital, addressData.website || '');
                if (addressData.phone) {
                    jobs[index].phone = addressData.phone;
                } else {
                    jobs[index].phone = '';
                }

                await chrome.storage.local.set({ scrapedJobs: jobs });

                // Update display
                allJobs = jobs;
                renderCurrentView();
            }
        } catch (error) {
            console.error('Error fetching address:', error);
            const data = await chrome.storage.local.get(['scrapedJobs']);
            const jobs = data.scrapedJobs || [];
            if (jobs[index]) {
                applyMissingAddressDefaults(jobs[index]);
                await chrome.storage.local.set({ scrapedJobs: jobs });
                allJobs = jobs;
                renderCurrentView();
            }
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
