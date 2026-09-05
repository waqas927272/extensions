document.addEventListener('DOMContentLoaded', () => {
    const addressQuality = globalThis.MphAddressQuality;
    const addressPolicy = globalThis.MphAddressPolicy;
    if (!addressQuality) {
        console.error('Address quality module did not load. Address fetching is disabled.');
    }
    if (!addressPolicy) {
        console.error('Address policy module did not load. Address fetching is disabled.');
    }
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
    const descriptionModal = document.getElementById('descriptionModal');
    const closeDescriptionModalBtn = document.getElementById('closeDescriptionModal');
    const closeDescriptionModalFooterBtn = document.getElementById('closeDescriptionModalFooter');
    const descriptionModalTitle = document.getElementById('descriptionModalTitle');
    const descriptionModalMeta = document.getElementById('descriptionModalMeta');
    const descriptionModalBody = document.getElementById('descriptionModalBody');

    let currentSortColumn = null;
    let currentSortDirection = 'asc';
    let allJobs = [];
    let displayedJobs = [];
    let editingJobKey = '';
    let isGettingDescriptions = false;
    let isFetchingDetails = false;
    let isFetchingAddresses = false;
    let descriptionQueue = [];
    let nextDescriptionQueueIndex = 0;
    let activeDescriptionRequests = 0;
    let descriptionCompletedCount = 0;
    let failedDescriptionCount = 0;
    let descriptionUpdates = new Map();
    let descriptionStorageWriteChain = Promise.resolve();
    let descriptionLastScheduledCount = 0;
    let descriptionStorageError = null;
    let detailsQueue = [];
    let currentDetailsIndex = 0;
    let addressQueue = [];
    let currentAddressIndex = 0;
    let addressCache = new Map();
    const selectedJobKeys = new Set();
    const getDescriptionsBtn = document.getElementById('getDescriptionsBtn');
    const fetchDetailsBtn = document.getElementById('fetchDetailsBtn');
    const fetchAddressesBtn = document.getElementById('fetchAddressesBtn');
    const DESCRIPTION_FETCH_CONCURRENCY = 1;
    const DESCRIPTION_REQUEST_TIMEOUT_MS = 15000;
    const DESCRIPTION_FETCH_ATTEMPTS = 3;
    const DESCRIPTION_SAVE_BATCH_SIZE = 1;
    const ADDRESS_LOOKUP_VERSION = '1.32';
    let addressRunVerified = 0;
    let addressRunUnresolved = 0;

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
        if (addressQuality) return addressQuality.normalizeCity(value);
        return normalizeSimpleText(value)
            .replace(/^washington dc$/, 'washington')
            .replace(/\bmount\b/g, 'mt')
            .replace(/\bsaint\b/g, 'st')
            .replace(/\bfort\b/g, 'ft')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/\s+/g, '');
    }

    function editDistance(left, right) {
        const a = left || '';
        const b = right || '';
        if (a === b) return 0;
        if (!a) return b.length;
        if (!b) return a.length;

        const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
        const current = Array(b.length + 1).fill(0);

        for (let i = 1; i <= a.length; i++) {
            current[0] = i;
            for (let j = 1; j <= b.length; j++) {
                const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                current[j] = Math.min(
                    previous[j] + 1,
                    current[j - 1] + 1,
                    previous[j - 1] + cost
                );
            }
            previous.splice(0, previous.length, ...current);
        }

        return previous[b.length];
    }

    function cityMatchesExpected(expectedCity, resultCity, state = '') {
        if (addressQuality) return addressQuality.citiesMatch(expectedCity, resultCity, state);
        const expected = normalizeCityForCompare(expectedCity);
        const result = normalizeCityForCompare(resultCity);
        return Boolean(expected && result && expected === result);
    }

    function cityIsSafeAlternate(expectedCity, resultCity, state = '') {
        return cityMatchesExpected(expectedCity, resultCity, state);
    }

    function shouldCorrectStoredCity(expectedCity, resultCity, hospitalName, addressData) {
        // Fetch Addresses never changes the job's requested city. Source-data
        // corrections require a separate decision, not a nearby-address match.
        return false;
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

    function formatHospitalNameForStorage(hospitalName) {
        const normalized = addressQuality?.normalizeHospitalName
            ? addressQuality.normalizeHospitalName(hospitalName)
            : String(hospitalName || '').replace(/\b(?:hopsital|hosptital|hospial)\b/gi, 'Hospital');
        return normalized.replace(/\s+/g, ' ').trim();
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
        return isMissionPetHealthHospital(hospitalName) ||
            /^(united veterinary care|svp|southern veterinary partners)$/i.test((hospitalName || '').trim());
    }

    function isMissionPetHealthHospital(hospitalName) {
        return addressPolicy?.isMissionParentName(hospitalName) ||
            /^mission pet health(?:\s*\(parent client\))?$/i.test((hospitalName || '').trim());
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

        const narrativeHospital = extractExplicitNarrativeHospitalName(text);
        if (
            narrativeHospital &&
            !isGenericOrganizationHospitalName(narrativeHospital) &&
            !isLocationOnlyHospitalName(narrativeHospital, location, city, state)
        ) {
            return narrativeHospital;
        }

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
            !isGenericOrganizationHospitalName(metadataHospital) &&
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
                !isGenericOrganizationHospitalName(candidate) &&
                !isLocationOnlyHospitalName(candidate, location, city, state)
            ) {
                return candidate;
            }
        }

        return '';
    }

    function extractExplicitNarrativeHospitalName(text) {
        const descriptionBody = (text || '').split(/===\s*DESCRIPTION\s*&\s*REQUIREMENTS\s*===/i).pop() || '';
        const facilitySuffix = '(?:Animal\\s+Hospital|Veterinary\\s+(?:Hospital|Clinic|Center|Care\\s+Center|Medical\\s+Center)|Animal\\s+(?:Clinic|Medical\\s+Center)|Pet\\s+(?:Hospital|Clinic)|Emergency\\s+Hospital|Specialty\\s+Hospital)';
        const facilityName = `([A-Z][A-Za-z0-9'’&.,()\\-]*(?:\\s+[A-Z][A-Za-z0-9'’&.,()\\-]*){0,8}\\s+${facilitySuffix})`;
        const patterns = [
            new RegExp(`${facilityName}\\s+(?:is|are)\\s+(?:seeking|searching|looking|hiring)\\b`, 'g'),
            new RegExp(`\\b(?:[Ww]ork(?:ing)?|[Jj]oin(?:ing)?|[Pp]ractic(?:e|ing))[^.\\n]{0,50}?\\b[Aa]t\\s+${facilityName}\\b`, 'g')
        ];

        for (const pattern of patterns) {
            const match = pattern.exec(descriptionBody);
            const candidate = match?.[1]?.replace(/\s+/g, ' ').trim() || '';
            if (candidate && !isGenericOrganizationHospitalName(candidate)) {
                return candidate;
            }
        }

        return '';
    }

    function extractDescriptionBranchCity(text) {
        const descriptionBody = (text || '').split(/===\s*DESCRIPTION\s*&\s*REQUIREMENTS\s*===/i).pop() || '';
        const cityToken = "[A-Z][A-Za-z.'’\\-]*";
        const cityName = `(${cityToken}(?:\\s+(?:${cityToken}|of|the)){0,4})`;
        const patterns = [
            new RegExp(`\\b(?:[Ww]ork(?:ing)?|[Bb]ased|[Ll]ocated|[Pp]ractic(?:e|ing))[^.\\n]{0,80}?\\b[Aa]t\\s+(?:the|our)\\s+${cityName}\\s+location\\b`, 'g'),
            new RegExp(`\\b[Aa]t\\s+(?:the|our)\\s+${cityName}\\s+location\\b`, 'g')
        ];
        const blockedNames = new Set([
            'new', 'newest', 'current', 'existing', 'primary', 'second', 'local',
            'downtown', 'beautiful', 'convenient', 'hospital', 'clinic', 'practice'
        ]);

        for (const pattern of patterns) {
            const match = pattern.exec(descriptionBody);
            const candidate = match?.[1]?.replace(/\s+/g, ' ').trim() || '';
            const normalized = normalizeSimpleText(candidate);
            if (candidate && normalized && !blockedNames.has(normalized)) {
                return candidate;
            }
        }

        return '';
    }

    function hospitalNamesShareIdentity(leftName, rightName) {
        const ignoredWords = new Set([
            'animal', 'veterinary', 'vet', 'hospital', 'clinic', 'center', 'centre',
            'medical', 'care', 'pet', 'pets', 'emergency', 'specialty', 'the', 'of', 'at'
        ]);
        const getIdentityWords = value => normalizeSimpleText(value)
            .split(/\s+/)
            .filter(word => word && !ignoredWords.has(word));
        const leftWords = getIdentityWords(leftName);
        const rightWords = new Set(getIdentityWords(rightName));

        if (!leftWords.length || !rightWords.size) return false;
        return leftWords.some(word => rightWords.has(word));
    }

    function replaceHospitalBranchCity(hospitalName, previousCity, descriptionCity) {
        const cleanHospital = (hospitalName || '').replace(/\s+/g, ' ').trim();
        const oldCity = (previousCity || '').replace(/\s+/g, ' ').trim();
        const newCity = (descriptionCity || '').replace(/\s+/g, ' ').trim();
        if (!cleanHospital || !oldCity || !newCity) return cleanHospital;
        if (normalizeCityForCompare(oldCity) === normalizeCityForCompare(newCity)) return cleanHospital;

        const oldCityPattern = oldCity
            .split(/\s+/)
            .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('\\s+');
        const replacements = [
            { pattern: new RegExp(`\\(\\s*${oldCityPattern}\\s*\\)$`, 'i'), value: `(${newCity})` },
            { pattern: new RegExp(`(\\s*[-–—]\\s*)${oldCityPattern}$`, 'i'), value: `$1${newCity}` },
            { pattern: new RegExp(`(\\s*,\\s*)${oldCityPattern}$`, 'i'), value: `$1${newCity}` },
            { pattern: new RegExp(`(\\s+)${oldCityPattern}$`, 'i'), value: `$1${newCity}` }
        ];

        for (const replacement of replacements) {
            if (replacement.pattern.test(cleanHospital)) {
                return cleanHospital.replace(replacement.pattern, replacement.value).trim();
            }
        }

        return cleanHospital;
    }

    function resolveHospitalNameFromDetails(currentHospital, detailHospital, description, location, city, state, context = {}) {
        const currentIsLocationOnly = isLocationOnlyHospitalName(currentHospital, location, city, state) ||
            isGenericOrganizationHospitalName(currentHospital);
        const detailIsBetter = detailHospital &&
            !isGenericOrganizationHospitalName(detailHospital) &&
            !isLocationOnlyHospitalName(detailHospital, location, city, state);

        let resolvedHospital = currentHospital || '';

        if (currentIsLocationOnly && detailIsBetter) {
            resolvedHospital = detailHospital.trim();
        }

        const narrativeHospital = extractExplicitNarrativeHospitalName(description);
        const descriptionHospital = narrativeHospital ||
            extractBetterHospitalNameFromDescription(description, location, city, state);
        if (descriptionHospital && (currentIsLocationOnly || !resolvedHospital)) {
            resolvedHospital = descriptionHospital;
        } else if (
            narrativeHospital &&
            hospitalNamesShareIdentity(resolvedHospital, narrativeHospital)
        ) {
            // A complete hospital name used in the job-specific narrative can expand a
            // shortened card label (for example "Quarryside" -> "Quarryside Veterinary Hospital").
            resolvedHospital = narrativeHospital;
        }

        resolvedHospital = resolvedHospital || descriptionHospital || detailHospital || '';

        // A marketplace card can carry an old branch suffix while the narrative assigns the
        // role to another branch (for example "... Worcester" plus "at our Saugus location").
        // Change only a suffix that exactly matches the card city; never rewrite brand words.
        const descriptionBranchCity = context.descriptionCity || extractDescriptionBranchCity(description);
        return formatHospitalNameForStorage(replaceHospitalBranchCity(
            resolvedHospital,
            context.previousCity || '',
            descriptionBranchCity
        ));
    }

    function extractTitleContext(title) {
        const cleanTitle = (title || '').replace(/\s+/g, ' ').trim();
        const result = { hospital: '', city: '', state: '', location: '' };
        if (!cleanTitle) return result;

        function applyLocationCandidate(candidate, allowCityOnly = false) {
            const value = (candidate || '').replace(/^[,\s]+|[,\s]+$/g, '').trim();
            if (!value) return false;

            const commaMatch = value.match(/^(.+?),\s*([^,]+)$/);
            const abbreviationMatch = value.match(/^(.+?)\s+([A-Z]{2})$/);
            const fullStateName = Object.values(stateAbbreviations)
                .sort((left, right) => right.length - left.length)
                .find(stateName => value.toLowerCase().endsWith(` ${stateName.toLowerCase()}`));
            const fullStateMatch = fullStateName
                ? [value, value.slice(0, -(fullStateName.length + 1)), fullStateName]
                : null;
            const match = commaMatch && isStateValue(commaMatch[2])
                ? commaMatch
                : (abbreviationMatch && isStateValue(abbreviationMatch[2]) ? abbreviationMatch : fullStateMatch);

            if (match && isStateValue(match[2])) {
                result.city = match[1].trim();
                result.state = getFullStateName(match[2].trim());
                result.location = `${result.city}, ${result.state}`;
                return true;
            }

            const blockedCity = /\b(?:hospital|clinic|veterinary|animal|care|specialist|sponsored|opportunity|leader|director|partner|residency|nationwide|remote)\b/i;
            if (allowCityOnly && !blockedCity.test(value) && /^[A-Za-z][A-Za-z .'-]{1,40}$/.test(value)) {
                result.city = value;
                result.location = value;
                return true;
            }

            if (/^(?:nationwide|remote)$/i.test(value)) {
                result.location = toDisplayCase(value);
                return true;
            }

            return false;
        }

        const inLocationMatch = cleanTitle.match(/\b(?:in|at)\s+(.+)$/i);
        if (inLocationMatch) {
            applyLocationCandidate(inLocationMatch[1]);
        }

        const segments = cleanTitle
            .split(/\s+[-–—]\s*|\s*[-–—]\s+/)
            .map(segment => segment.trim())
            .filter(Boolean);

        if (!result.location && segments.length >= 2) {
            applyLocationCandidate(segments[segments.length - 1], true);
        }

        if (segments.length >= 3) {
            const middle = segments.slice(1, -1).join(' - ').trim();
            const looksLikeHospital = /\b(?:hospital|clinic|center|centre|veterinary|animal|pet|pets|cardiac care|specialists?|emergency|cvca)\b/i.test(middle);
            const isRoleDescriptor = /^(?:urgent care|emergency|er|gp|general practice|service leader|medical director|lead veterinarian)$/i.test(middle);
            if (looksLikeHospital && !isRoleDescriptor) {
                result.hospital = middle;
            }
        }

        if (!result.hospital) {
            const atHospitalMatch = cleanTitle.match(/\bat\s+(.+?(?:Hospital|Clinic|Center|Centre|Veterinary|Animal|Pet Care|Specialists?))\b/i);
            if (atHospitalMatch) result.hospital = atHospitalMatch[1].trim();
        }

        return result;
    }

    function getRoleTitleText(title) {
        const cleanTitle = (title || '').replace(/\s+/g, ' ').trim();
        const titleContext = extractTitleContext(cleanTitle);
        if (!titleContext.hospital) return cleanTitle;

        const atHospitalIndex = cleanTitle.search(/\s+at\s+/i);
        if (atHospitalIndex > 0) return cleanTitle.slice(0, atHospitalIndex).trim();

        const segments = cleanTitle
            .split(/\s+[-–—]\s*|\s*[-–—]\s+/)
            .map(segment => segment.trim())
            .filter(Boolean);
        if (segments.length >= 3) return segments[0];

        return cleanTitle;
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

    function extractCityFromAddressText(text) {
        const match = String(text || '').match(/,\s*([^,]+?),\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/i);
        return match ? match[1].trim() : '';
    }

    function isLivewellHospital(hospitalName) {
        return /\blive\s*well\b/i.test(String(hospitalName || '').replace(/\b(?:hopsital|hosptital|hospial)\b/gi, 'hospital'));
    }

    function isLivewellWebsite(website) {
        try {
            const host = new URL(website || '').hostname.replace(/^www\./i, '').toLowerCase();
            return host === 'livewellanimal.com' || host.endsWith('.livewellanimal.com');
        } catch (_) {
            return false;
        }
    }

    let livewellLocationsCache = null;

    function addressMatchesExpectedHospitalBrand(hospitalName, addressData, descriptionAddress = null, location = '') {
        if (!addressQuality || !hospitalName) return false;
        return addressQuality.hospitalIdentityMatches(hospitalName, addressData || {}, {
            descriptionAddress, location
        });
    }

    function resolveWebsiteForHospital(hospitalName, website = '') {
        // Preserve an already stored website. Do not introduce a new source merely
        // because a Google lookup failed.
        return website || '';
    }

    function applyMissingAddressDefaults(job) {
        const locationParts = parseLocationParts(job.location || '');
        addressPolicy?.applyUnverifiedResult(job, null);
        job.city = formatCityForStorage(job.city || locationParts.city || '');
        job.state = formatStateForStorage(job.state || locationParts.state || '');
    }

    function getLivewellFallbackAddress() {
        return {
            streetAddress: 'TBD',
            zipCode: '00000',
            city: '',
            state: '',
            fullAddress: '',
            website: '-',
            phone: '-'
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
            website: '-',
            phone: '-'
        };
    }

    function emptyAddressResult() {
        return { businessName: '', streetAddress: '', zipCode: '', city: '', state: '', fullAddress: '', website: '', phone: '', addressResult: '' };
    }

    const OFFICIAL_WEBSITE_ADDRESS_FALLBACKS = [
        {
            hospitals: ['hillside veterinary hospital'],
            website: 'https://www.hillsidevet.com/',
            host: 'hillsidevet.com'
        },
        {
            hospitals: ['acupet veterinary care'],
            website: 'https://www.acupetvetcare.com/',
            host: 'acupetvetcare.com'
        }
    ];

    function getOfficialWebsiteAddressFallbackConfig(hospitalName, originalHospitalName = '') {
        const hospitalCandidates = [hospitalName, originalHospitalName]
            .filter(Boolean)
            .map(normalizeLookupValue);

        return OFFICIAL_WEBSITE_ADDRESS_FALLBACKS.find(config =>
            config.hospitals.some(name => hospitalCandidates.includes(normalizeLookupValue(name)))
        ) || null;
    }

    function websiteHostMatches(url, expectedHost) {
        try {
            const host = new URL(url || '').hostname.replace(/^www\./i, '').toLowerCase();
            return host === expectedHost || host.endsWith(`.${expectedHost}`);
        } catch (_) {
            return false;
        }
    }

    function htmlToPlainText(html) {
        const withBreaks = String(html || '')
            .replace(/<br\s*\/?>/gi, ', ')
            .replace(/<\/(?:p|div|li|td|th|tr|address|footer|section)>/gi, '\n');
        const doc = new DOMParser().parseFromString(withBreaks, 'text/html');
        return (doc.body?.textContent || '')
            .replace(/\u00a0/g, ' ')
            .replace(/[ \t]+/g, ' ')
            .replace(/\n{2,}/g, '\n')
            .trim();
    }

    function elementHtmlToPlainText(element) {
        if (!element) return '';
        return htmlToPlainText(element.innerHTML || element.textContent || '');
    }

    function normalizeWebsiteAddress(address) {
        return String(address || '')
            .replace(/^Address\s*[:\n]\s*/i, '')
            .replace(/\s+/g, ' ')
            .replace(/\s*,\s*/g, ', ')
            .replace(/,?\s+(?:United States|USA)\s*$/i, '')
            .replace(/,\s*$/, '')
            .trim();
    }

    function parseWebsiteAddress(fullAddress) {
        const addr = normalizeWebsiteAddress(fullAddress);
        const match = addr.match(/^([\s\S]+?),\s*([^,]+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i);
        if (!match) return emptyAddressResult();

        return {
            streetAddress: match[1].trim(),
            city: match[2].trim(),
            state: getFullStateName(match[3].toUpperCase()),
            zipCode: match[4].trim(),
            fullAddress: addr
        };
    }

    function extractAddressCandidatesFromWebsiteHtml(html, websiteUrl) {
        const candidates = [];
        const doc = new DOMParser().parseFromString(String(html || '').replace(/<br\s*\/?>/gi, ', '), 'text/html');

        for (const link of doc.querySelectorAll('a[href]')) {
            const href = link.getAttribute('href') || '';
            const text = elementHtmlToPlainText(link);
            if (text) candidates.push(text);

            try {
                const url = new URL(href, websiteUrl);
                const query = url.searchParams.get('query') || url.searchParams.get('q') || '';
                if (query) candidates.push(decodeURIComponent(query.replace(/\+/g, ' ')));
            } catch (_) {
                // Ignore malformed non-URL hrefs.
            }
        }

        candidates.push(htmlToPlainText(html));

        const addressPattern = /\b(\d{1,6}\s+[\w\s.'#&/-]+?(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Rd|Road|Ln|Lane|Way|Ct|Court|Pl|Place|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Trl|Trail|Loop|Ter|Terrace|NE|NW|SE|SW|N|S|E|W)\b[\w\s.,#&/-]*?,\s*[\w\s.'-]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?)/gi;
        const found = [];

        for (const candidate of candidates) {
            let match;
            while ((match = addressPattern.exec(candidate)) !== null) {
                found.push(normalizeWebsiteAddress(match[1]));
            }
        }

        return [...new Set(found)];
    }

    async function fetchOfficialWebsiteAddress(hospitalName, location, originalHospitalName = '') {
        const config = getOfficialWebsiteAddressFallbackConfig(hospitalName, originalHospitalName);
        if (!config) return emptyAddressResult();

        const expected = parseLocationParts(location || '');
        const expectedState = getStateAbbreviation(expected.state);

        try {
            const response = await fetch(config.website, { cache: 'no-cache' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const html = await response.text();
            const candidates = extractAddressCandidatesFromWebsiteHtml(html, config.website);

            for (const candidate of candidates) {
                const parsed = parseWebsiteAddress(candidate);
                if (!parsed.streetAddress || !parsed.zipCode) continue;
                if (expectedState && getStateAbbreviation(parsed.state) !== expectedState) continue;
                if (expectedState && parsed.zipCode && !zipMatchesState(parsed.zipCode, expectedState)) continue;

                return {
                    businessName: hospitalName || originalHospitalName || '',
                    streetAddress: parsed.streetAddress,
                    city: parsed.city,
                    state: parsed.state,
                    zipCode: parsed.zipCode,
                    fullAddress: parsed.fullAddress,
                    website: config.website,
                    phone: extractPhoneFromText(htmlToPlainText(html)),
                    sourceType: 'official-website',
                    allowPostalCityMismatch: true
                };
            }
        } catch (error) {
            console.warn(`Could not load official website fallback for "${hospitalName}":`, error);
        }

        return emptyAddressResult();
    }

    function extractPhoneFromText(text) {
        const match = String(text || '').match(/\b(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/);
        return match ? match[0].trim() : '';
    }

    function parseLivewellCityStateZip(cityStateZip) {
        const match = (cityStateZip || '').match(/^(.+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i);
        if (!match) return { city: '', state: '', zipCode: '' };

        return {
            city: match[1].trim(),
            state: getFullStateName(match[2].toUpperCase()),
            zipCode: match[3].trim()
        };
    }

    function normalizeLivewellLocationName(name) {
        return normalizeSimpleText(String(name || '').replace(/\b(?:hopsital|hosptital|hospial)\b/gi, 'hospital'))
            .replace(/\blivewell\b/g, ' ')
            .replace(/\banimal\b/g, ' ')
            .replace(/\bhospital\b/g, ' ')
            .replace(/\burgent\b/g, ' ')
            .replace(/\bcare\b/g, ' ')
            .replace(/\bof\b/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function scoreLivewellLocationName(expectedName, candidateName) {
        const expected = normalizeLivewellLocationName(expectedName);
        const candidate = normalizeLivewellLocationName(candidateName);
        if (!expected || !candidate) return 0;
        if (expected === candidate) return 10;
        if (expected.includes(candidate) || candidate.includes(expected)) return 8;

        const expectedWords = expected.split(' ').filter(word => word.length > 2);
        const candidateText = ` ${candidate} `;
        const matched = expectedWords.filter(word => candidateText.includes(` ${word} `)).length;
        return expectedWords.length ? matched / expectedWords.length : 0;
    }

    async function getLivewellLocations() {
        if (livewellLocationsCache) return livewellLocationsCache;

        try {
            const response = await fetch('https://www.livewellanimal.com/_files/json/locations.geojson', {
                cache: 'no-cache', signal: AbortSignal.timeout(8000)
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();
            livewellLocationsCache = Array.isArray(data?.features) ? data.features : [];
        } catch (error) {
            console.warn('Could not load Livewell locations fallback:', error);
            livewellLocationsCache = [];
        }

        return livewellLocationsCache;
    }

    function normalizeLivewellWebsiteUrl(url) {
        const fallback = 'https://www.livewellanimal.com/our-locations/';
        if (!url) return fallback;

        try {
            const parsed = new URL(url, fallback);
            if (!isLivewellWebsite(parsed.href)) return fallback;
            parsed.pathname = parsed.pathname.replace(/\/{2,}/g, '/');
            return parsed.href;
        } catch (_) {
            return fallback;
        }
    }

    async function fetchLivewellLocationAddress(hospitalName, location, originalHospitalName = '') {
        if (!isLivewellHospital(hospitalName) && !isLivewellHospital(originalHospitalName)) {
            return emptyAddressResult();
        }

        const expected = parseLocationParts(location || '');
        const expectedCity = normalizeCityForCompare(expected.city);
        const expectedState = getStateAbbreviation(expected.state);

        const locations = await getLivewellLocations();
        const expectedNames = [hospitalName, originalHospitalName].filter(Boolean);
        let best = null;
        let bestScore = -1;
        let bestNameScore = 0;

        for (const feature of locations) {
            const props = feature?.properties || {};
            const parsed = parseLivewellCityStateZip(props.cityStateZip || '');
            if (!props.name || !props.address1 || !parsed.city || !parsed.state || !parsed.zipCode) continue;
            const nameScore = Math.max(...expectedNames.map(name => scoreLivewellLocationName(name, props.name || '')));
            const cityMatch = !expectedCity || cityMatchesExpected(expected.city, parsed.city, expectedState);
            const stateMatch = !expectedState || getStateAbbreviation(parsed.state) === expectedState;
            // A similar branch name in another state is never the same hospital
            // (for example, Redmond, WA must not match Edmond, OK).
            if (!stateMatch || (!cityMatch && nameScore < 10)) continue;
            const score = (nameScore * 10) + (cityMatch ? 2 : 0) + (stateMatch ? 2 : -4);
            if (score > bestScore) {
                bestScore = score;
                bestNameScore = nameScore;
                best = { props, parsed };
            }
        }

        // An official directory must also respect the job's city and state.
        if (!best || bestNameScore < 0.6) return emptyAddressResult();

        const streetAddress = [best.props.address1, best.props.address2].filter(Boolean).join(', ');
        const stateZip = [getStateAbbreviation(best.parsed.state), best.parsed.zipCode].filter(Boolean).join(' ');
        const fullAddress = [streetAddress, best.parsed.city, stateZip].filter(Boolean).join(', ');
        // The caller inspects the branch page once and validates its complete
        // address/contact bundle. Do not fetch it a second time for a loose tel.
        const phone = best.props.phone || '';

        return {
            businessName: best.props.name || hospitalName || originalHospitalName || '',
            streetAddress,
            zipCode: best.parsed.zipCode,
            city: best.parsed.city,
            state: best.parsed.state,
            fullAddress,
            website: normalizeLivewellWebsiteUrl(best.props.url),
            phone,
            sourceType: 'livewell-geojson',
            allowPostalCityMismatch: !!expectedCity && normalizeCityForCompare(best.parsed.city) !== expectedCity
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
        return {
            searchHospital: hospitalName,
            searchLocation: location,
            directResult: null
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
            'Radiologist', 'Surgeon', 'Partner Veterinarian'
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

    function getFinalDescriptionRequirementsText(text) {
        const source = text || '';
        const sections = source.split(/===\s*DESCRIPTION\s*&\s*REQUIREMENTS\s*===/i);
        return (sections.length > 1 ? sections[sections.length - 1] : source).trim();
    }

    function getExplicitDescriptionPosition(text) {
        const finalRequirements = getFinalDescriptionRequirementsText(text);
        if (!finalRequirements) return '';

        if (
            /(?:^|\n)\s*Your Impact as (?:a|the) Medical Lead Veterinarian\b/im.test(finalRequirements) ||
            /(?:^|\n)\s*As (?:a|the) Medical Lead Veterinarian\b/im.test(finalRequirements)
        ) {
            return 'Medical Lead Veterinarian';
        }

        if (
            /(?:^|\n)\s*Your Impact as (?:a|the) Founding Partner(?:\s*&\s*Lead Veterinarian)?\b/im.test(finalRequirements) ||
            /\bBecome a Founding Specialist\b/i.test(finalRequirements)
        ) {
            return 'Partner Veterinarian';
        }

        return '';
    }

    // ============ TOP-LEVEL POSITION MATCHING (used by both detail extraction and save) ============

    // Match position from the job listing title — this is the authoritative source for position.
    // The listing title (e.g. "Veterinary Cardiologist") is always more specific than
    // generic detail page content, so we use it as the primary position signal.
    function getPositionFromTitle(title) {
        const t = getRoleTitleText(title).toLowerCase();
        if (isNonClinicalJobTitle(t)) return '';

        // === HIGHEST PRIORITY: Leadership positions ===
        // "Group Medical Director - The Oncology Service" → Medical Director, NOT Medical Oncologist
        if (t.includes('regional medical director')) return 'Medical Director';
        if (t.includes('medical director')) return 'Medical Director';
        if (t.includes('founding partner') || t.includes('founding specialist')) return 'Partner Veterinarian';
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
        if ((/\b(?:veterinary\s+)?surgeon\b/.test(t) || /\b(?:veterinary\s+)?surgery\s+(?:specialist|diplomate)\b/.test(t)) &&
            !t.includes('neurosurgeon') && !t.includes('neurology') && !t.includes('dental') && !t.includes('dentistry')) return 'Surgeon';

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
        const t = getRoleTitleText(title).toLowerCase();

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
            t.includes('avian') || t.includes('exotics')) return 'General Practice Care';

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
            const amountRegex = /\$?\s*([\d,]+(?:\.\d{2})?)\s*(k)?\b/gi;
            let match;
            while ((match = amountRegex.exec(raw)) !== null) {
                let num = parseFloat(match[1].replace(/,/g, ''));
                if (match[2]) num *= 1000;
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

        function parseStructuredSalaryAmount(raw) {
            const match = (raw || '').match(/\$?\s*([\d,]+(?:\.\d{1,2})?)\s*(k)?\b/i);
            if (!match) return 0;
            let amount = Number(match[1].replace(/,/g, ''));
            if (match[2]) amount *= 1000;
            return Number.isFinite(amount) ? amount : 0;
        }

        function formatStructuredSalary(minRaw, maxRaw) {
            let min = parseStructuredSalaryAmount(minRaw);
            let max = parseStructuredSalaryAmount(maxRaw);
            if (min <= 0 && max <= 0) return '';
            const isHourly = Math.max(min, max) > 0 && Math.max(min, max) < 1000;

            if (min > 0 && max > 0) {
                let low = Math.min(min, max);
                let high = Math.max(min, max);

                // Correct obvious single-zero source typos such as 1,150,000 vs 180,000
                // or 17,000 vs 130,000 without changing ordinary compensation ranges.
                while (high > low * 3 && high >= 500000) high /= 10;
                while (high > low * 3 && low < 50000) low *= 10;
                min = Math.min(low, high);
                max = Math.max(low, high);
            } else {
                min = Math.max(min, max);
                max = min;
            }

            const formatAmount = amount => '$' + Math.round(amount).toLocaleString('en-US');
            const unit = isHourly ? 'per hour' : 'per year';
            return min === max
                ? `${formatAmount(min)} ${unit}`
                : `${formatAmount(min)}–${formatAmount(max)} ${unit}`;
        }

        // Extract salary from stored description (which now includes JSON-LD data)
        function extractSalary(text) {
            if (!text) return '';

            const baseMinimum = getMetadataField(text, ['Base Min.', 'Base Min', 'Base Minimum']);
            const baseMaximum = getMetadataField(text, ['Base Max.', 'Base Max', 'Base Maximum']);
            const structuredSalary = formatStructuredSalary(baseMinimum, baseMaximum);
            if (structuredSalary) return structuredSalary;

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
            const title = getRoleTitleText(positionText).toLowerCase();
            const category = getIndustryCategory(descriptionText).toLowerCase();
            const department = getMetadataField(descriptionText, ['Department', 'Division', 'Team']).toLowerCase();

            if (isNonClinicalJobTitle(title)) return '';
            if (hasUrgentCareSignal(title, hospitalName, department)) return 'Urgent Care';
            if (/\bfounding specialist\b/i.test(title)) return 'Specialty Care';
            if (/\b(?:oncologist|cardiologist|neurologist|neurosurgeon|dermatologist|ophthalmologist|anesthesiologist|theriogenologist|radiologist|internist|criticalist|ecc specialist|oncology|cardiology|neurology|dermatology|ophthalmology|anesthesia|theriogenology|radiology)\b/i.test(title)) return 'Specialty Care';
            if (/\b(?:emergency|er)\b/i.test(title)) return 'Emergency Care';
            if (/\b(?:founding partner|medical lead|lead veterinarian|lead vet|medical director|regional medical director)\b/i.test(title)) return 'General Practice Care';
            if (hasSpecialtyTrainingSignal(descriptionText)) return 'Specialty Care';
            // A hospital brand can contain "Emergency" while the advertised role is explicitly
            // general practice or mixed GP/urgent care. The role description outranks the brand.
            if (
                department === 'veterinarian' &&
                /\b(?:small[-\s]animal general practice|strong general practice foundation|general practice medicine|dynamic gp\s*\+\s*urgent care)\b/i.test(descriptionText)
            ) {
                return 'General Practice Care';
            }
            if (hasEmergencySignal(title, hospitalName, department)) return 'Emergency Care';

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
                return 'General Practice Care';
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
            const t = getRoleTitleText(title).toLowerCase();
            if (isNonClinicalJobTitle(t)) return '';

            // === HIGHEST PRIORITY: Leadership positions ===
            // Must be checked FIRST — "Group Medical Director - The Oncology Service" should be
            // Medical Director, NOT Medical Oncologist. The specialty word is the service name, not the role.
            if (t.includes('regional medical director')) return 'Medical Director';
            if (t.includes('medical director')) return 'Medical Director';
            if (t.includes('founding partner') || t.includes('founding specialist')) return 'Partner Veterinarian';
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
            if ((/\b(?:veterinary\s+)?surgeon\b/.test(t) || /\b(?:veterinary\s+)?surgery\s+(?:specialist|diplomate)\b/.test(t)) &&
                !t.includes('neurosurgeon') && !t.includes('neurology') && !t.includes('dental') && !t.includes('dentistry')) return 'Surgeon';

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

        // Validate that the position is allowed for the selected area of practice.
        function validatePositionForAOP(position, aop) {
            const validPositions = {
                'Emergency Care': ['Associate Veterinarian', 'Lead Veterinarian', 'Medical Director'],
                'General Practice Care': ['Associate Veterinarian', 'Lead Veterinarian', 'Medical Lead Veterinarian', 'Medical Director', 'Partner Veterinarian'],
                'Specialty Care': [
                    'Anesthesiologist', 'Cardiologist', 'Credentialed Veterinary Technician Specialist',
                    'DABVP Specialist', 'Dental Specialist', 'Dermatologist', 'ECC Specialist',
                    'Internal Medicine Specialist', 'Medical Director', 'Medical Oncologist',
                    'Neurologist & Neurosurgeon', 'Ophthalmologist', 'Radiation Oncologist',
                    'Radiologist', 'Surgeon', 'Partner Veterinarian'
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
            let position = getExplicitDescriptionPosition(descriptionText) ||
                matchPositionFromTitle(positionText);
            if (!position) {
                position = matchPositionFromQualifications(descriptionText);
            }
            return APPROVED_POSITION_SET.has(position) ? position : '';
        }

        function parseLocationAddressValue(rawAddress) {
            if (!rawAddress) return { streetAddress: '', city: '', state: '', zipCode: '' };
            if (addressQuality?.parseStructuredAddress) {
                return addressQuality.parseStructuredAddress(rawAddress);
            }

            const cleanAddress = rawAddress.replace(/\s+/g, ' ').trim();

            const stateNames = Object.values(stateAbbreviations)
                .sort((left, right) => right.length - left.length)
                .map(stateName => stateName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
                .join('|');
            const stateZipMatch = cleanAddress.match(new RegExp(
                `(?:,\\s*)?\\b(${stateNames}|[A-Z]{2})(?:\\s+(\\d{4,5}(?:-\\d{4})?))?(?:\\s+(?:Suite|Ste\\.?|Unit)\\s+#?\\s*[A-Za-z0-9-]+)?(?:,?\\s+United States(?: of America)?)?$`,
                'i'
            ));
            if (!stateZipMatch) return { streetAddress: '', city: '', state: '', zipCode: '' };

            const prefix = cleanAddress.slice(0, stateZipMatch.index).replace(/[,.\s]+$/, '').trim();
            if (!prefix) return { streetAddress: '', city: '', state: '', zipCode: '' };
            const commaParts = prefix.split(/\s*,\s*/).map(part => part.trim()).filter(Boolean);
            let city = '';
            let streetAddress = '';

            if (commaParts.length >= 2) {
                city = commaParts.pop();
                streetAddress = commaParts.join(', ');
            } else {
                const streetAndCityMatch = prefix.match(
                    /^(\d.+?\b(?:Street|St\.?|Road|Rd\.?|Avenue|Ave\.?|Way|Lane|Ln\.?|Boulevard|Blvd\.?|Drive|Dr\.?|Highway|Hwy\.?|Court|Ct\.?|Parkway|Pkwy\.?|Place|Pl\.?))(?:\s+(N|S|E|W|NE|NW|SE|SW|North|South|East|West))?\s+(.+)$/i
                );
                if (streetAndCityMatch) {
                    streetAddress = streetAndCityMatch[1].trim();
                    if (streetAndCityMatch[2]) streetAddress += ` ${streetAndCityMatch[2]}`;
                    city = streetAndCityMatch[3].trim();
                } else {
                    city = prefix;
                }
            }

            const unitMatch = city.match(/^((?:Unit|Suite|Ste\.?)\s+[A-Za-z0-9-]+)\s+(.+)$/i) ||
                city.match(/^(Building\s+[A-Za-z0-9]+(?:\s*&\s*[A-Za-z0-9]+)?)\s+(.+)$/i);
            if (unitMatch) {
                streetAddress = [streetAddress, unitMatch[1]].filter(Boolean).join(', ');
                city = unitMatch[2].trim();
            }

            let zipCode = stateZipMatch[2] || '';
            if (/^\d{4}$/.test(zipCode)) zipCode = zipCode.padStart(5, '0');
            return {
                streetAddress,
                city,
                state: getFullStateName(stateZipMatch[1].trim()),
                zipCode
            };
        }

        function parseStructuredLocationAddress(text) {
            // Descriptions use both labels. Prefer Location Address, then accept Location
            // when it contains a parseable City/State or full street address.
            const rawAddresses = [
                getMetadataField(text, ['Location Address']),
                getMetadataField(text, ['Location'])
            ].filter(Boolean);

            for (const rawAddress of rawAddresses) {
                const parsed = parseLocationAddressValue(rawAddress);
                if (parsed.city && parsed.state) return parsed;
            }

            return { streetAddress: '', city: '', state: '', zipCode: '' };
        }

        function extractReliableDescriptionLocation(text, parsedAddress) {
            function makeLocation(city, state, source) {
                const cleanCity = (city || '')
                    .replace(/^[,;:\s]+|[,;:\s]+$/g, '')
                    .replace(/\s+/g, ' ')
                    .trim();
                const stateAbbreviation = getStateAbbreviation(state);
                if (!cleanCity || !stateAbbreviation) return null;
                if (/\b(?:remote|nationwide|united states)\b/i.test(cleanCity)) return null;
                if (/\b(?:hospital|clinic|practice|location|description|position|veterinarian)\b/i.test(cleanCity)) return null;

                const cleanState = getFullStateName(stateAbbreviation);
                return {
                    city: cleanCity,
                    state: cleanState,
                    location: `${cleanCity}, ${cleanState}`,
                    source
                };
            }

            // Structured fields are the strongest description evidence.
            if (parsedAddress?.city && parsedAddress?.state) {
                const structuredLocation = makeLocation(
                    parsedAddress.city,
                    parsedAddress.state,
                    'structured-address'
                );
                if (structuredLocation) return structuredLocation;
            }

            const explicitCity = getMetadataField(text, ['City', 'Job City']);
            const explicitState = getMetadataField(text, ['State', 'Province', 'Job State']);
            if (explicitCity && explicitState) {
                const metadataLocation = makeLocation(
                    explicitCity,
                    explicitState,
                    'structured-city-state'
                );
                if (metadataLocation) return metadataLocation;
            }

            // Generic City, ST matching is unsafe: descriptions also mention licensing
            // jurisdictions and the corporate Birmingham office. Only wording that explicitly
            // connects a place to this hospital/job is accepted from free text.
            const stateNames = Object.values(stateAbbreviations)
                .sort((left, right) => right.length - left.length)
                .map(stateName => stateName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
                .join('|');
            const cityState = `([A-Z][A-Za-z.'’-]*(?:\\s+[A-Z][A-Za-z.'’-]*){0,4})\\s*,\\s*(${stateNames}|[A-Z]{2})\\b`;
            const explicitPatterns = [
                new RegExp(`(?:our|this)\\s+(?:hospital|practice|clinic)\\s+(?:(?:is\\s+)?(?:located|based)\\s+)?in\\s+${cityState}`, 'gi'),
                new RegExp(`(?:job|position|role|opportunity)\\s+(?:is\\s+)?(?:located|based)\\s+in\\s+${cityState}`, 'gi'),
                new RegExp(`join\\s+our(?:\\s+[A-Za-z'-]+){0,4}\\s+team\\s+in\\s+${cityState}`, 'gi')
            ];

            for (const pattern of explicitPatterns) {
                let match;
                while ((match = pattern.exec(text || '')) !== null) {
                    const contextStart = Math.max(0, match.index - 140);
                    const contextEnd = Math.min((text || '').length, match.index + match[0].length + 140);
                    const context = (text || '').slice(contextStart, contextEnd);
                    if (/heartbeat of Mission|headquarters|corporate office|licen[cs](?:e|ing|ure)/i.test(context)) {
                        continue;
                    }

                    const explicitLocation = makeLocation(match[1], match[2], 'explicit-job-location');
                    if (explicitLocation) return explicitLocation;
                }
            }

            return null;
        }

        // Extract locations from stored description (which now includes JSON-LD data)
        function extractLocations(text) {
            const locations = [];

            const explicitLocation = getMetadataField(text, ['Location', 'Job Location', 'Work Location']);
            const explicitCity = getMetadataField(text, ['City', 'Job City']);
            const explicitState = getMetadataField(text, ['State', 'Province', 'Job State']);
            const locationAddress = getMetadataField(text, ['Location Address']);
            const workingArrangement = getMetadataField(text, ['Working Arrangement']);

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

            // A small number of detail pages provide only a full street address. Extract the
            // trailing City/State while avoiding state-license language elsewhere in the body.
            if (locations.length === 0 && locationAddress) {
                const parsedAddress = parseStructuredLocationAddress(text);
                if (parsedAddress.city && parsedAddress.state) {
                    const city = parsedAddress.city;
                    const state = parsedAddress.state;
                    locations.push({ city, state, location: `${city}, ${state}` });
                }
            }

            if (locations.length === 0 && /\bremote\b/i.test(workingArrangement)) {
                locations.push({ city: '', state: '', location: 'Remote' });
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

            const payClass = getMetadataField(text, ['Pay Class', 'Employment Type', 'Job Type']).toLowerCase();
            if (payClass) {
                if (/^(?:prn|per[\s-]?diem)$/i.test(payClass)) {
                    return 'PRN';
                }
                if ((/\bpart[\s-]?time\b/i.test(payClass) || /^pt(?:\d+)?$/i.test(payClass)) && !/\bfull[\s-]?time\b/i.test(payClass)) {
                    return 'Part-Time';
                }
                if (/\b(?:full[\s-]?time|salary|salaried)\b/i.test(payClass) || /^ft(?:\d+)?$/i.test(payClass)) {
                    return 'Full-Time';
                }
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
            const splitExperienceSegments = value => (value || '').split(/\r?\n|\s+[•▪]\s*|\s+-\s+/);

            const patterns = [
                new RegExp(`\\b(\\d+)\\s*[-–—]\\s*(\\d+)\\s*${yearToken}\\s+(?:of\\s+)?experience\\b`, 'i'),
                new RegExp(`\\b(\\d+)\\s+to\\s+(\\d+)\\s*${yearToken}\\s+(?:of\\s+)?experience\\b`, 'i'),
                new RegExp(`\\bexperience\\s+(?:should\\s+be|must\\s+be|is|of|required(?:\\s+is)?|requires|:)?\\s*(\\d+)\\s*[-–—]\\s*(\\d+)\\s*${yearToken}\\b`, 'i'),
                new RegExp(`\\bexperience\\s+(?:should\\s+be|must\\s+be|is|of|required(?:\\s+is)?|requires|:)?\\s*(\\d+)\\s+to\\s+(\\d+)\\s*${yearToken}\\b`, 'i'),
                new RegExp(`\\b(?:minimum|min\\.?|at\\s+least)\\s+(?:of\\s+)?(\\d+)\\s*[-–—]\\s*(\\d+)\\s*${yearToken}\\b`, 'i'),
                new RegExp(`\\b(\\d+)\\+?\\s*${yearToken}\\s+(?:of\\s+)?experience\\b`, 'i'),
                new RegExp(`\\bexperience\\s+(?:should\\s+be|must\\s+be|is|of|required(?:\\s+is)?|requires|:)?\\s*(\\d+)\\+?\\s*${yearToken}\\b`, 'i'),
                new RegExp(`\\b(?:minimum|min\\.?|at\\s+least)\\s+(?:of\\s+)?(\\d+)\\+?\\s*${yearToken}\\b`, 'i'),
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

            function extractFromSection(sectionText) {
                const candidateLines = [];
                const qualificationsSection = extractQualificationsSection(sectionText);

                if (qualificationsSection) {
                    candidateLines.push(...splitExperienceSegments(qualificationsSection));
                }
                candidateLines.push(...splitExperienceSegments(sectionText));

                const prioritizedLines = candidateLines
                    .map(line => line.trim())
                    .filter(Boolean)
                    .filter(line => /\b(?:experience|experienced|minimum|min\.?|at least|required|requirements?|qualifications?|practice setting|years in practice)\b/i.test(line))
                    .filter(line => !/\b(?:our team has|over\s+\d+\s+years of experience|years of experience in specialty and emergency services|serving\s+the\s+community|we offer|benefits|medical(?:,\s*|\s+)dental)\b/i.test(line));

                for (const source of prioritizedLines) {
                    for (const pattern of patterns) {
                        const match = source.match(pattern);
                        if (match) return formatExperience(match);
                    }
                }

                return '';
            }

            // The final DESCRIPTION & REQUIREMENTS block is authoritative when the source
            // duplicates the posting with conflicting values. Fall back to the full stored
            // text only when the final block contains no numeric experience requirement.
            const finalRequirements = getFinalDescriptionRequirementsText(text);
            return extractFromSection(finalRequirements) ||
                (finalRequirements !== text.trim() ? extractFromSection(text) : '');
        }

        // Run all extractions
        const hospitalName = extractHospitalName(descriptionText);
        const salary = extractSalary(descriptionText);
        const areaOfPractice = determineAreaOfPractice(positionTitle, descriptionText, hospitalName);
        const position = determinePosition(positionTitle, descriptionText, areaOfPractice);
        const locations = extractLocations(descriptionText);
        const address = parseStructuredLocationAddress(descriptionText);
        const descriptionLocation = extractReliableDescriptionLocation(descriptionText, address);
        const jobType = extractJobType(descriptionText);
        const experience = extractExperience(descriptionText);

        return {
            salary,
            areaOfPractice,
            position,
            locations,
            hospitalName,
            jobType,
            experience,
            descriptionLocation,
            streetAddress: address.streetAddress,
            zipCode: address.zipCode
        };
    }

    // Address lookup uses Google Maps first. If Maps does not return a usable
    // address, it falls back to Google Search, which checks the right-side panel
    // and then one matching left-side result/card.
    function runAddressLookupTab(url, script, context = {}, timeoutMs = 21000) {
        return new Promise(resolve => {
            let settled = false, started = false, tabId = null;
            const startedAt = Date.now();
            const finish = result => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                chrome.tabs.onUpdated.removeListener(onUpdated);
                if (tabId !== null) chrome.tabs.remove(tabId).catch(() => {});
                console.info('[MPH lookup]', { script, durationMs: Date.now() - startedAt, error: result?.lookupError || '' });
                resolve(result || {});
            };
            const inject = async () => {
                if (settled || started || tabId === null) return;
                started = true;
                try {
                    await chrome.scripting.executeScript({ target: { tabId }, func: values => {
                        const d = document.documentElement.dataset;
                        d.mphExpectedHospital = values.expectedHospital || '';
                        d.mphExpectedCity = values.expectedCity || '';
                        d.mphExpectedState = values.expectedState || '';
                        d.mphDescriptionAddressSearch = values.descriptionAddressSearch ? 'true' : 'false';
                        d.mphAddressOnlyPostalCheck = values.addressOnlyPostalCheck ? 'true' : 'false';
                        d.mphBranchQueryResolved = values.branchQueryResolved ? 'true' : 'false';
                    }, args: [context] });
                    if (settled) return;
                    const results = await chrome.scripting.executeScript({ target: { tabId },
                        files: ['mph-address-quality.js', script] });
                    finish(results?.[0]?.result || {});
                } catch (error) { finish({ lookupError: 'script-error', error: error.message }); }
            };
            const onUpdated = (id, change) => {
                if (id === tabId && change.status === 'complete') inject();
            };
            const timer = setTimeout(() => finish({ lookupError: 'timeout' }), timeoutMs);
            chrome.tabs.create({ url, active: false }, tab => {
                const createError = chrome.runtime.lastError;
                if (!tab || createError) { finish({ lookupError: 'tab-create-failed' }); return; }
                if (settled) { chrome.tabs.remove(tab.id).catch(() => {}); return; }
                tabId = tab.id;
                chrome.tabs.onUpdated.addListener(onUpdated);
                if (tab.status === 'complete') inject();
                else chrome.tabs.get(tabId).then(current => {
                    if (current.status === 'complete') inject();
                }).catch(() => finish({ lookupError: 'tab-closed' }));
            });
        });
    }

    async function fetchAddressFromGoogleMaps(hospitalName, location, originalHospitalName = '', descriptionAddress = null, storedAddress = null) {
        // Build search query: "Hospital Name, City, State"
        const searchQuery = `${hospitalName}, ${location}`;
        const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`;

        function emptyAddressResult() {
            return addressQuality ? addressQuality.emptyAddressResult() : { businessName: '', streetAddress: '', zipCode: '', city: '', state: '', fullAddress: '', website: '', phone: '' };
        }

        const expectedLocation = parseExpectedLocation(location);
        const lookupAddress = descriptionAddress || (addressPolicy.hasCompleteStoredAddress(storedAddress)
            ? { streetAddress: storedAddress.streetAddress, zipCode: storedAddress.zipCode,
                city: expectedLocation.city, state: expectedLocation.state } : null);
        const identityContext = {
            hospitalName,
            originalHospitalName: originalHospitalName || hospitalName,
            location,
            descriptionAddress: lookupAddress,
            zipMatchesState
        };
        let lastAddressRejectionResult = addressPolicy?.RESULTS.NO_VERIFIED_LISTING || 'No verified Google listing found';
        const diagnostics = [];
        let storedAddressConflict = '';
        const websiteAttempts = new Map();
        function trace(source, reason, candidate = {}) {
            const entry = { source, reason, businessName: candidate.businessName || '',
                streetAddress: candidate.streetAddress || '', city: candidate.city || '',
                state: candidate.state || '', zipCode: candidate.zipCode || '' };
            if (diagnostics.length < 30) diagnostics.push(entry);
            console.info('[MPH address]', entry);
        }

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
            const resultState = normalizeStateForCompare(result.state || parsedFromAddress.state || '');
            const expectedState = expectedLocation.state;
            const resultCity = result.city || parsedFromAddress.city || '';
            const expectedCity = expectedLocation.city;

            if (expectedCity && !resultCity) return false;
            if (expectedState && !resultState && !zipCode) return false;
            if (expectedCity && !cityMatchesExpected(expectedCity, resultCity, expectedState)) return false;
            if (expectedState && resultState && resultState !== expectedState) return false;
            if (expectedState && zipCode && !zipMatchesState(zipCode, expectedState)) return false;
            return true;
        }

        function filterDataForExpectedLocation(data, sourceLabel, extraContext = {}) {
            const result = { ...(data || emptyAddressResult()), sourceType: data?.sourceType || sourceLabel || '' };
            if (!addressQuality) return emptyAddressResult();
            result.allowPostalCityMismatch = data?.allowPostalCityMismatch === true;
            const validation = addressQuality.validateAddressCandidate(result, {
                ...identityContext,
                ...extraContext
            });
            if (!validation.accepted) {
                trace(sourceLabel, validation.reason, result);
                // A positive same-hospital, same-street location contradiction
                // invalidates the saved bundle. A mere timeout does not.
                if (['city-and-hospital-mismatch', 'state-mismatch'].includes(validation.reason)
                    && result.uniquePlaceMatch === true
                    && storedAddress?.streetAddress
                    && addressQuality.streetAddressesMatch(storedAddress.streetAddress, result.streetAddress)
                    && addressQuality.hospitalIdentityMatches(identityContext.originalHospitalName, result, identityContext)) {
                    storedAddressConflict = addressPolicy.rejectionResult(validation.reason);
                }
                const summary = result.fullAddress || result.businessName || [result.city, result.state, result.zipCode].filter(Boolean).join(', ');
                console.warn(`Ignoring unverified address result (${validation.reason}) from "${sourceLabel}": ${summary}`);
                const rejectionResult = addressPolicy?.rejectionResult(validation.reason);
                if (rejectionResult && rejectionResult !== addressPolicy?.RESULTS.NO_VERIFIED_LISTING) {
                    lastAddressRejectionResult = rejectionResult;
                }
                return emptyAddressResult();
            }
            validation.result.addressResult = extraContext.acceptanceResult || (
                result.sourceType === 'official-website'
                    ? 'Verified using official hospital website'
                    : result.sourceType === 'google-search'
                    ? (addressPolicy?.RESULTS.VERIFIED_SEARCH || 'Verified using Google Search')
                    : (addressPolicy?.RESULTS.VERIFIED_MAPS || 'Verified using Google Maps')
            );
            trace(sourceLabel, 'accepted', validation.result);
            return validation.result;
        }

        function mergeMapsData(primary, secondary, sourceLabel = '', extraContext = {}) {
            const safeSecondary = filterDataForExpectedLocation(secondary, sourceLabel, extraContext);
            if (primary?.verified && primary.sourceType === 'livewell-geojson' && safeSecondary.verified
                && !['google-maps', 'google-search'].includes(safeSecondary.sourceType)) {
                const sameLivewellStreet = addressQuality.streetAddressesMatch(primary.streetAddress, safeSecondary.streetAddress);
                // The official Livewell directory is authoritative for the branch
                // identity and street. Google may use the current postal ZIP while
                // the directory still carries an older ZIP, so a strictly verified
                // same-street Google place is allowed to supply the current bundle.
                if (!sameLivewellStreet) return primary;
            }
            if (extraContext.preferSecondary && safeSecondary.verified
                && !['google-maps', 'google-search'].includes(primary?.sourceType)) return safeSecondary;
            return addressQuality.selectAtomicAddress(primary, safeSecondary, identityContext);
        }

        function needsMapsRetry(data) {
            return !data.streetAddress || !data.zipCode || !data.phone || !data.website;
        }

        function needsAddressRetry(data) {
            return !data.streetAddress || !data.zipCode;
        }

        async function verifyOfficialDirectoryPostalData(directoryData) {
            if (!directoryData?.verified
                || (directoryData.sourceType !== 'livewell-geojson' && !directoryData.officialDirectorySeed
                    && !(directoryData.sourceType === 'official-website' && isLivewellHospital(originalHospitalName || hospitalName)))
                || !directoryData.streetAddress
                || !directoryData.city
                || !directoryData.state) {
                return directoryData;
            }

            const exactAddressQuery = [
                directoryData.streetAddress.replace(/\b(?:suites?|ste\.?|units?)\s+.*$/i, '').replace(/[,\s]+$/, ''),
                directoryData.city,
                directoryData.state
            ].filter(Boolean).join(', ');
            const exactAddressUrl = `https://www.google.com/maps/search/${encodeURIComponent(exactAddressQuery)}`;
            const postalCandidate = await scrapeGoogleMapsTabSafe(exactAddressUrl, exactAddressQuery, {
                addressOnlyPostalCheck: true
            });
            const candidateState = getStateAbbreviation(postalCandidate?.state || '');
            const directoryState = getStateAbbreviation(directoryData.state || '');
            const candidateCity = postalCandidate?.city || '';
            const exactStreetMatch = addressQuality?.streetAddressesMatch(
                directoryData.streetAddress,
                postalCandidate?.streetAddress || ''
            );
            const exactLocationMatch = exactStreetMatch
                && candidateState
                && candidateState === directoryState
                && cityMatchesExpected(directoryData.city, candidateCity, directoryState)
                && /^\d{5}(?:-\d{4})?$/.test(String(postalCandidate?.zipCode || '').trim())
                && zipMatchesState(postalCandidate.zipCode, directoryData.state);

            if (!exactLocationMatch) {
                trace('Livewell postal cross-check', 'postal-address-not-verified', directoryData);
                // Do not promote an unchecked directory ZIP to verified data.
                // If the description disagrees, the saved directory bundle is
                // unsafe too; keep the original in previousAddress for recovery.
                if (descriptionAddress?.zipCode && descriptionAddress.zipCode !== directoryData.zipCode) {
                    storedAddressConflict = 'Official directory ZIP conflicts with description; postal check unresolved';
                    return emptyAddressResult();
                }
                // The named official branch remains a valid source when Google
                // has no building listing. A failed optional cross-check is not
                // evidence that its complete published address is wrong.
                return directoryData;
            }

            const correctedZip = String(postalCandidate.zipCode).trim();
            if (correctedZip === String(directoryData.zipCode || '').trim()) return directoryData;

            return {
                ...directoryData,
                zipCode: correctedZip,
                fullAddress: [
                    directoryData.streetAddress,
                    directoryData.city,
                    `${directoryData.state} ${correctedZip}`.trim()
                ].filter(Boolean).join(', ')
            };
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

        function buildDescriptionAddressQueries() {
            const structured = lookupAddress || {};
            const streetAddress = String(structured.streetAddress || '').trim();
            if (!streetAddress) return [];

            const descriptionCity = String(structured.city || '').trim();
            const descriptionState = normalizeStateForCompare(structured.state || '');
            if (expectedLocation.city && descriptionCity && !cityIsSafeAlternate(expectedLocation.city, descriptionCity, expectedLocation.state)) {
                return [];
            }
            if (expectedLocation.state && descriptionState && descriptionState !== expectedLocation.state) {
                return [];
            }

            const city = expectedLocation.city || descriptionCity;
            const state = expectedLocation.state || normalizeStateForCompare(structured.state || '');
            const zipCode = /^\d{5}(?:-\d{4})?$/.test(String(structured.zipCode || '').trim())
                ? String(structured.zipCode).trim()
                : '';
            const exactAddress = [streetAddress, city, state, zipCode].filter(Boolean).join(', ');
            const names = [hospitalName, originalHospitalName].filter(Boolean);
            const seen = new Set();

            return [exactAddress, ...names.map(name => `${name}, ${exactAddress}`.replace(/\s+/g, ' ').trim())]
                .filter(query => {
                    const key = query.toLowerCase();
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
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

                const coBrands = base.split(/\s+(?:&|and)\s+/i);
                if (coBrands.length === 2 && coBrands.every(name => /\b(?:hospital|clinic|veterinary specialists?)\b/i.test(name))) {
                    names.push(...coBrands);
                }
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
                                        phone: data.phone || '',
                                        category: data.category || '',
                                        uniquePlaceMatch: data.uniquePlaceMatch === true,
                                        branchQueryResolved: data.branchQueryResolved === true,
                                        sourceType: 'google-maps'
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

        async function scrapeGoogleMapsTabSafe(url, queryLabel, options = {}) {
            const result = await runAddressLookupTab(url, 'google-maps-scraper.js', {
                expectedHospital: originalHospitalName || hospitalName,
                expectedCity: expectedLocation.city, expectedState: expectedLocation.state, ...options
            });
            if (result.lookupError) trace(queryLabel, result.lookupError);
            if (result.verificationRequired) {
                const error = new Error('Google verification required');
                error.code = 'GOOGLE_VERIFICATION_REQUIRED';
                throw error;
            }
            return { ...result, sourceType: 'google-maps' };
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
                                        category: data.category || '',
                                        panelText: data.panelText || '',
                                        uniquePlaceMatch: data.uniquePlaceMatch === true,
                                        branchQueryResolved: data.branchQueryResolved === true,
                                        verificationRequired: data.verificationRequired === true,
                                        sourceType: 'google-search'
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

        async function scrapeGoogleSearchTabSafe(queryLabel) {
            const url = 'https://www.google.com/search?q=' + encodeURIComponent(queryLabel);
            const result = await runAddressLookupTab(url, 'google-search-scraper.js', {
                expectedHospital: originalHospitalName || hospitalName,
                expectedCity: expectedLocation.city, expectedState: expectedLocation.state
            });
            if (result.lookupError) trace(queryLabel, result.lookupError);
            return { ...result, sourceType: 'google-search' };
        }

        async function scrapeHospitalWebsiteTabSafe(url, queryLabel, options = {}) {
            const result = await runAddressLookupTab(url, 'hospital-website-scraper.js', options, 12000);
            if (result.lookupError) trace(queryLabel, result.lookupError);
            if (result.streetAddress && !addressQuality.sanitizeWebsite(result.website)) {
                trace(queryLabel, 'blocked-website-destination');
                return emptyAddressResult();
            }
            return { ...result, sourceType: 'official-website' };
        }

        async function inspectHospitalWebsite(url, queryLabel, options = {}) {
            options = { expectedHospital: originalHospitalName || hospitalName,
                expectedCity: expectedLocation.city, expectedState: expectedLocation.state, ...options };
            // Google's opaque /goto links are navigation hints, never a saved
            // hospital URL. Resolve them and validate the actual destination.
            const safeUrl = addressQuality.sanitizeWebsite(url) || googleDiscoveryUrl(url);
            if (!safeUrl) return emptyAddressResult();
            const attemptKey = JSON.stringify([safeUrl, options.expectedHospital, options.expectedCity,
                options.expectedState, options.branchQueryResolved === true]);
            if (websiteAttempts.has(attemptKey)) return websiteAttempts.get(attemptKey);
            const inspection = (async () => {
                let firstCandidate = emptyAddressResult();
                let acceptedCandidate = null;
                const pending = [safeUrl];
                const visited = new Set();
                // Static structured/contact data needs no browser tab. Follow at
                // most two same-site contact/location pages, never crawl a site.
                while (pending.length && visited.size < 3) {
                    const pageUrl = pending.shift();
                    if (visited.has(pageUrl)) continue;
                    visited.add(pageUrl);
                    try {
                        const response = await fetch(pageUrl, { signal: AbortSignal.timeout(6000), credentials: 'omit' });
                        if (!response.ok) { trace(pageUrl, `http-${response.status}`); continue; }
                        const html = await response.text();
                        const doc = new DOMParser().parseFromString(html, 'text/html');
                        const actualUrl = response.url || pageUrl;
                        if (!addressQuality.sanitizeWebsite(actualUrl)) { trace(pageUrl, 'blocked-website-destination'); continue; }
                        const candidate = { ...globalThis.MphExtractWebsiteAddress(doc, options, actualUrl), sourceType: 'official-website' };
                        if (candidate.streetAddress) {
                            firstCandidate = candidate;
                            if (addressQuality.validateAddressCandidate(candidate, { ...identityContext, ...options }).accepted) {
                                acceptedCandidate = acceptedCandidate
                                    ? addressQuality.selectAtomicAddress(acceptedCandidate, candidate, identityContext) : candidate;
                                if (acceptedCandidate.phone) return acceptedCandidate;
                            } else filterDataForExpectedLocation(candidate, actualUrl, options);
                        }
                        for (const link of doc.querySelectorAll('a[href]')) {
                            const href = link.getAttribute('href') || '';
                            if (!/contact|locations?(?:\/|$)/i.test(href)) continue;
                            try {
                                const next = new URL(href, actualUrl);
                                if (next.origin !== new URL(actualUrl).origin || next.search || next.hash) continue;
                                if (!visited.has(next.href) && !pending.includes(next.href) && pending.length < 2) pending.push(next.href);
                            } catch (_) { /* Ignore malformed navigation links. */ }
                        }
                    } catch (error) { trace(pageUrl, error.name === 'TimeoutError' ? 'timeout' : 'website-fetch-failed'); }
                }
                // A dynamic site can still use the existing rendered-page path.
                if (acceptedCandidate) return acceptedCandidate;
                if (!firstCandidate.streetAddress) return scrapeHospitalWebsiteTabSafe(safeUrl, queryLabel, options);
                return firstCandidate;
            })();
            websiteAttempts.set(attemptKey, inspection);
            return inspection;
        }

        function googleDiscoveryUrl(value) {
            try {
                const url = new URL(value);
                return url.protocol === 'https:' && /^(?:www\.)?google\.com$/.test(url.hostname)
                    && ['/goto', '/url'].includes(url.pathname) && url.searchParams.has('url') ? url.href : '';
            } catch (_) { return ''; }
        }

        let data = emptyAddressResult();

        if (isLivewellHospital(hospitalName) || isLivewellHospital(originalHospitalName)) {
            const livewellData = await fetchLivewellLocationAddress(hospitalName, location, originalHospitalName);
            if (livewellData.streetAddress && livewellData.zipCode) {
                livewellData.category = 'Veterinary hospital';
                livewellData.uniquePlaceMatch = true;
                livewellData.branchQueryResolved = true;
                data = mergeMapsData(data, livewellData, 'Livewell official location directory', {
                    acceptanceResult: addressPolicy?.RESULTS.VERIFIED_OFFICIAL_DIRECTORY || 'Verified using official hospital directory'
                });
                // Verify the published branch page directly. New branches often
                // have no Google listing, and directory ZIPs can lag behind.
                if (livewellData.website) {
                    const branchData = await inspectHospitalWebsite(livewellData.website, searchQuery);
                    branchData.officialDirectorySeed = true;
                    data = mergeMapsData(data, branchData, livewellData.website, { preferSecondary: true });
                }
            }
        }

        async function searchGoogleAndOfficialWebsite(query, options = {}) {
            let searchData = await scrapeGoogleSearchTabSafe(query);
            if (searchData.verificationRequired) {
                const verificationError = new Error('Google requires a verification check before address fetching can continue.');
                verificationError.code = 'GOOGLE_VERIFICATION_REQUIRED';
                throw verificationError;
            }
            // A left-side Google result can expose a full address while its title
            // is an SEO headline or localized text rather than the hospital name.
            // Confirm such non-unique results on the linked official website.
            const preliminaryValidation = searchData.streetAddress && searchData.zipCode
                ? addressQuality?.validateAddressCandidate(searchData, {
                    ...identityContext,
                    ...options
                })
                : null;
            if (preliminaryValidation && !preliminaryValidation.accepted) {
                filterDataForExpectedLocation(searchData, query, options);
            }
            const searchWebsite = addressQuality?.sanitizeWebsite(searchData.website || '') || '';
            const discoveredWebsite = addressQuality?.sanitizeWebsite(searchData.websiteCandidate?.website || '')
                || googleDiscoveryUrl(searchData.websiteCandidate?.discoveryUrl || searchData.discoveryUrl || '');
            const websiteToInspect = (!preliminaryValidation?.accepted || !searchWebsite)
                ? discoveredWebsite || searchWebsite : searchWebsite;
            const shouldInspectOfficialWebsite = !!websiteToInspect && (
                !preliminaryValidation?.accepted
                || searchData.uniquePlaceMatch !== true
                || !searchData.phone
                || !searchWebsite
            );
            if (shouldInspectOfficialWebsite) {
                const websiteData = await inspectHospitalWebsite(websiteToInspect, query, {
                    expectedHospital: originalHospitalName || hospitalName,
                    expectedCity: expectedLocation.city,
                    expectedState: expectedLocation.state,
                    branchQueryResolved: searchData.branchQueryResolved === true
                });
                if (websiteData.streetAddress && websiteData.zipCode
                    && addressQuality.validateAddressCandidate(websiteData, { ...identityContext, ...options }).accepted) {
                    searchData = addressQuality.selectAtomicAddress(searchData, websiteData, { ...identityContext, ...options });
                }
            }
            return mergeMapsData(data, searchData, query, options);
        }

        const descriptionQueries = buildDescriptionAddressQueries();
        const descriptionStreet = lookupAddress?.streetAddress || '';
        const dataMatchesDescriptionStreet = () => Boolean(
            descriptionStreet && data.streetAddress && (addressQuality?.streetAddressesMatch(data.streetAddress, descriptionStreet)
                || addressQuality?.isStreetEnrichment(descriptionStreet, data.streetAddress)
                || (data.uniquePlaceMatch === true && addressQuality?.isPublishedStreetCorrection(descriptionStreet, data.streetAddress)))
        );

        // Maps usually exposes the complete atomic place record in one request.
        // Make it the fast path; Search and official-site inspection are fallbacks.
        console.log(`Google Maps address search: "${searchQuery}"`);
        data = mergeMapsData(data, await scrapeGoogleMapsTabSafe(mapsUrl, searchQuery), searchQuery);

        if (descriptionQueries.length && needsMapsRetry(data)) {
            for (const query of descriptionQueries.slice(0, 1)) {
                console.log(`Google Maps description-address candidate: "${query}"`);
                const descriptionUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
                const descriptionMapsData = await scrapeGoogleMapsTabSafe(descriptionUrl, query, {
                    expectedHospital: originalHospitalName || hospitalName,
                    descriptionAddressSearch: true
                });
                data = mergeMapsData(data, descriptionMapsData, query, {
                    requireDescriptionStreetMatch: true,
                    acceptanceResult: addressPolicy?.RESULTS.VERIFIED_DESCRIPTION_MAPS || 'Verified using description address + Google Maps',
                    preferSecondary: true
                });
            }
        }

        if (needsMapsRetry(data)) {
            // When the address is already known, search that exact branch for
            // its missing contacts instead of repeating a broad name search.
            const contactQuery = data.verified && dataMatchesDescriptionStreet() ? descriptionQueries[0] : '';
            const fallbackQuery = contactQuery || searchQuery;
            console.log(`Google Search address fallback: "${fallbackQuery}"`);
            data = await searchGoogleAndOfficialWebsite(fallbackQuery, contactQuery ? {
                requireDescriptionStreetMatch: true,
                acceptanceResult: addressPolicy?.RESULTS.VERIFIED_DESCRIPTION_SEARCH,
                preferSecondary: true
            } : { acceptanceResult: addressPolicy?.RESULTS.VERIFIED_SEARCH || 'Verified using Google Search' });
        }

        // Only use one description-address Search fallback, and only while the
        // street/ZIP are still unresolved. Missing optional contacts do not cause
        // another round of address searches.
        if (descriptionQueries.length && needsAddressRetry(data)) {
            const query = descriptionQueries[0];
            console.log(`Google Search description-address fallback: "${query}"`);
            data = await searchGoogleAndOfficialWebsite(query, {
                requireDescriptionStreetMatch: true,
                acceptanceResult: addressPolicy?.RESULTS.VERIFIED_DESCRIPTION_SEARCH || 'Verified using description address + Google Search',
                preferSecondary: true
            });
        }

        // Once a complete address has been verified, do not spend several more
        // searches trying to manufacture a phone or website that the hospital
        // does not publish. One Search plus one Maps check is enough for contacts.
        if (needsAddressRetry(data)) {
            for (const query of uniqueQueries(buildHospitalNameVariants()).filter(query => query !== searchQuery).slice(0, 1)) {
                if (!needsAddressRetry(data)) break;
                console.log(`Google Maps address candidate: "${query}"`);
                const variantUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
                const mapsData = await scrapeGoogleMapsTabSafe(variantUrl, query);
                data = mergeMapsData(data, mapsData, query, descriptionStreet ? {
                    requireDescriptionStreetMatch: true,
                    acceptanceResult: addressPolicy?.RESULTS.VERIFIED_DESCRIPTION_MAPS || 'Verified using description address + Google Maps'
                } : {});
            }
        }

        if (needsAddressRetry(data)) {
            const searchQueries = uniqueQueries(buildHospitalNameVariants())
                .filter(query => query !== searchQuery)
                .slice(0, 1);
            for (const query of searchQueries) {
                if (!needsAddressRetry(data)) break;
                console.log(`Google Search address candidate: "${query}"`);
                data = await searchGoogleAndOfficialWebsite(query, descriptionStreet ? {
                    requireDescriptionStreetMatch: true,
                    acceptanceResult: addressPolicy?.RESULTS.VERIFIED_DESCRIPTION_SEARCH || 'Verified using description address + Google Search'
                } : {
                    acceptanceResult: addressPolicy?.RESULTS.VERIFIED_SEARCH || 'Verified using Google Search'
                });
            }
        }
        // A new Livewell branch can be present in the official directory before
        // it has a named Google business listing. In that case, ask Maps for the
        // exact official street solely to verify the postal ZIP. No phone,
        // website, or business identity is copied from the address-only result.
        // Use a previously discovered site as a lookup seed, not as trusted data.
        // Inspect it even if Google failed to return a usable address this time.
        if (needsMapsRetry(data) && !storedAddressConflict && storedAddress?.website && !addressPolicy.isPlaceholder(storedAddress.website)) {
            data = mergeMapsData(data, await inspectHospitalWebsite(storedAddress.website, searchQuery), storedAddress.website);
        }

        // Validate after every discovery path, including the saved-website seed.
        // A later fallback must never resurrect a rejected description bundle.
        data = await verifyOfficialDirectoryPostalData(data);
        const verifiedGoogleAddressCorrection = data.verified && data.uniquePlaceMatch === true
            && ['google-maps', 'google-search'].includes(data.sourceType);
        if (descriptionStreet && data.verified && !verifiedGoogleAddressCorrection && !dataMatchesDescriptionStreet()) {
            lastAddressRejectionResult = addressPolicy.RESULTS.REJECTED_DESCRIPTION_ADDRESS;
            data = emptyAddressResult();
        }

        // Run enrichment after ALL discovery paths, not only the first Maps
        // response. Keep the complete source bundle; never discard a new suite
        // because the older street/ZIP happen to match.
        if (data.verified && data.website) {
            const published = await inspectHospitalWebsite(data.website, searchQuery);
            const check = addressQuality.validateAddressCandidate(published, identityContext);
            if (check.accepted) data = addressQuality.selectAtomicAddress(data, published, identityContext);
            if (check.accepted && data.zipCode.slice(0, 5) === published.zipCode.slice(0, 5)
                && published.uniquePlaceMatch === true
                && addressQuality.isPublishedStreetCorrection(data.streetAddress, published.streetAddress)) {
                trace(data.website, 'completed-published-street', published);
                // A unique Google place remains authoritative for its street
                // and ZIP; official pages can supply missing branch contacts.
                if (!['google-maps', 'google-search'].includes(data.sourceType)) {
                    data = filterDataForExpectedLocation(published, data.website);
                } else {
                    // Add omitted suite/directional detail for this same street;
                    // this check cannot move the row to another street/branch.
                    data = { ...data, streetAddress: published.streetAddress };
                }
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
            phone: data.phone || '',
            category: data.category || '',
            panelText: data.panelText || '',
            sourceType: data.sourceType || '',
            verified: data.verified || false,
            allowPostalCityMismatch: data.allowPostalCityMismatch || false,
            uniquePlaceMatch: data.uniquePlaceMatch === true,
            branchQueryResolved: data.branchQueryResolved === true,
            branchEvidence: data.branchEvidence || '',
            sourceUrl: data.sourceUrl || data.website || '',
            contactSourceUrl: data.contactSourceUrl || '',
            addressResult: data.addressResult || storedAddressConflict || lastAddressRejectionResult,
            diagnostics, storedAddressConflict: data.verified ? '' : storedAddressConflict
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

    function hasCompleteCityAndState(job) {
        recoverInvalidJobCity(job);
        const city = (job?.city || '').replace(/\s+/g, ' ').trim();
        const state = (job?.state || '').replace(/\s+/g, ' ').trim();
        if (!isUsableCityValue(city) || !isStateValue(state)) return false;
        return ![city, state].some(value => /\b(?:remote|nationwide)\b/i.test(value));
    }

    function isUsableCityValue(value) {
        const city = (value || '').replace(/\s+/g, ' ').trim();
        if (!city || city.length > 80 || !/[A-Za-z]/.test(city) || !/[AEIOUY]/i.test(city)) return false;
        return !/^(?:-|n\/?a|none|null|undefined|unknown|tbd|dnt|not available|remote|nationwide)$/i.test(city);
    }

    function recoverInvalidJobCity(job) {
        if (!job || isUsableCityValue(job.city) || !isStateValue(job.state || '')) return false;
        const jobSite = String(job.description || '').match(/^\s*Job Site:\s*(.+?)\s*$/im)?.[1] || job.hospital || '';
        const parenthetical = String(jobSite).match(/\(([^()]+)\)\s*$/);
        const candidate = parenthetical?.[1]?.replace(/\s+/g, ' ').trim() || '';
        if (candidate.split(/\s+/).length < 2 || !isUsableCityValue(candidate)) return false;
        job.city = formatCityForStorage(candidate);
        job.location = `${job.city}, ${formatStateForStorage(job.state)}`;
        return true;
    }

    function excludeJobsWithoutCompleteLocation(jobs) {
        return (jobs || []).filter(hasCompleteCityAndState);
    }

    function getJobSelectionKey(job) {
        // One job's description Ref # can equal a later job's listing URL ID. The full link
        // remains unique during that first detail pass, so it must take priority over jobId for
        // selection and queue identity.
        return job.link || job.jobId || `${job.title || ''}||${job.hospital || ''}||${job.location || ''}`;
    }

    function getReferenceJobIdFromDescription(description, currentJobId = '') {
        const match = (description || '').match(/^\s*Ref\s*#\s*:\s*(?:MPH-)?(\d+)\s*$/im);
        if (!match) return '';

        const splitSuffixMatch = (currentJobId || '').match(/^MPH-\d+-(\d+)$/i);
        const splitSuffix = splitSuffixMatch ? `-${splitSuffixMatch[1]}` : '';
        return `MPH-${match[1]}${splitSuffix}`;
    }

    function getBaseJobId(jobId) {
        const match = (jobId || '').match(/^(MPH-\d+)(?:-\d+)?$/i);
        return match ? match[1].replace(/^mph-/i, 'MPH-') : (jobId || '');
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

    function openDescriptionModal(job) {
        if (!job?.description) return;

        descriptionModalTitle.textContent = job.title || 'Job Description';
        descriptionModalMeta.textContent = [
            job.jobId || '',
            job.hospital || '',
            job.location || ''
        ].filter(Boolean).join(' | ') || 'Full scraped description for the selected job.';
        descriptionModalBody.textContent = job.description;
        descriptionModal.classList.remove('hidden');
        closeDescriptionModalBtn.focus();
    }

    function closeDescriptionModal() {
        descriptionModal.classList.add('hidden');
        descriptionModalTitle.textContent = 'Job Description';
        descriptionModalMeta.textContent = 'Full scraped description for the selected job.';
        descriptionModalBody.textContent = '';
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
            const streetCell = row.insertCell(6);
            streetCell.textContent = job.streetAddress || '-';
            streetCell.title = job.addressConflict || job.addressResult || 'Address has not been verified by this version.';
            row.insertCell(7).textContent = job.city;
            row.insertCell(8).textContent = job.state;
            row.insertCell(9).textContent = job.zipCode || '-';

            // Phone column
            row.insertCell(10).textContent = job.phone || '-';

            // Website column — show as clickable link if available
            const websiteCell = row.insertCell(11);
            if (job.website && !addressPolicy?.isPlaceholder(job.website)) {
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
                const viewDescriptionBtn = document.createElement('button');
                viewDescriptionBtn.type = 'button';
                viewDescriptionBtn.className = 'btn description-action';
                viewDescriptionBtn.textContent = 'View Description';
                viewDescriptionBtn.setAttribute('aria-label', `View description for ${job.title || 'job'}`);
                viewDescriptionBtn.addEventListener('click', () => openDescriptionModal(job));
                descCell.appendChild(viewDescriptionBtn);
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
        const exportJobs = excludeJobsWithoutCompleteLocation(allJobs);
        if (exportJobs.length !== allJobs.length) {
            allJobs = exportJobs;
            pruneSelection();
            chrome.storage.local.set({ scrapedJobs: allJobs });
            renderCurrentView();
        }

        if (exportJobs.length === 0) {
            showToast('No jobs to export!', 'error');
            return;
        }

        const headers = ['#', 'Job Title', 'Job ID', 'Hospital', 'Aggregator', 'Street Address', 'City', 'State', 'Zip Code', 'Phone', 'Website', 'Location', 'Area of Practice', 'Position', 'Salary', 'Job Type', 'Experience', 'Link', 'Description'];
        const csvContent = [
            headers.join(','),
            ...exportJobs.map((job, index) => [
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
                `"${(job.experience || '-').replace(/"/g, '""')}"`,
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

        showToast(`Exported ${exportJobs.length} jobs to CSV!`, 'success');
    }

    // Initialize
    chrome.storage.local.get(['scrapedJobs'], (result) => {
        // Loading/reloading the records page must be read-only. Location cleanup
        // is performed after Fetch Details and during export, not during startup.
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

    closeDescriptionModalBtn.addEventListener('click', closeDescriptionModal);
    closeDescriptionModalFooterBtn.addEventListener('click', closeDescriptionModal);
    descriptionModal.addEventListener('click', (event) => {
        if (event.target === descriptionModal) {
            closeDescriptionModal();
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !editJobModal.classList.contains('hidden')) {
            closeEditJobModal();
        }
        if (event.key === 'Escape' && !descriptionModal.classList.contains('hidden')) {
            closeDescriptionModal();
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
                        job.addressResult = '';
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
                key: getJobSelectionKey(job),
                jobId: job.jobId || '',
                link: job.link || ''
            }))
            .filter(item => !jobs[item.index].description && item.link);

        if (descriptionQueue.length === 0) {
            showToast('All jobs already have descriptions!', 'success');
            return;
        }

        isGettingDescriptions = true;
        nextDescriptionQueueIndex = 0;
        activeDescriptionRequests = 0;
        descriptionCompletedCount = 0;
        failedDescriptionCount = 0;
        descriptionUpdates = new Map();
        descriptionStorageWriteChain = Promise.resolve();
        descriptionLastScheduledCount = 0;
        descriptionStorageError = null;

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

        try {
            await runDescriptionWorkers();
            scheduleDescriptionStorageFlush(true);
            await descriptionStorageWriteChain;

            if (descriptionStorageError) {
                throw descriptionStorageError;
            }

            finishDescriptionFetchRun();
        } catch (error) {
            console.error('Description fetch run failed:', error);
            finishDescriptionFetchRun(error);
        }
    });

    function updateDescriptionProgress() {
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        const totalToProcess = descriptionQueue.length;
        const completed = Math.min(descriptionCompletedCount, totalToProcess);
        progressText.textContent = `${completed} / ${totalToProcess}`;
        progressBar.style.width = totalToProcess
            ? `${(completed / totalToProcess) * 100}%`
            : '0%';
        getDescriptionsBtn.textContent = `Getting Descriptions... (${completed}/${totalToProcess})`;
    }

    function finishDescriptionFetchRun(runError = null) {
        isGettingDescriptions = false;
        activeDescriptionRequests = 0;
        getDescriptionsBtn.disabled = false;
        getDescriptionsBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20M13,13H11V18H13V13M13,9.5H11V11.5H13V9.5Z"/>
            </svg>
            Get Descriptions
        `;
        updateDescriptionProgress();
        document.getElementById('progressSection').classList.add('hidden');

        if (runError) {
            showToast(`Description fetching stopped: ${runError.message || runError}`, 'error');
        } else if (failedDescriptionCount > 0) {
            showToast(`Descriptions finished with ${failedDescriptionCount} failed job(s). Check console for details.`, 'error');
        } else {
            showToast('All descriptions have been fetched!', 'success');
        }
    }

    function findDescriptionJobIndex(jobs, queueItem) {
        return jobs.findIndex((job, index) => {
            if (queueItem.key && getJobSelectionKey(job) === queueItem.key) return true;
            if (queueItem.jobId && job.jobId === queueItem.jobId) return true;
            if (queueItem.link && job.link === queueItem.link) return true;
            return index === queueItem.index;
        });
    }

    function validateDescriptionUrl(rawUrl) {
        const url = new URL(rawUrl);
        if (url.protocol !== 'https:' || url.hostname !== 'missionpethealth.avature.net') {
            throw new Error(`Unsupported job URL: ${rawUrl}`);
        }

        if (!/\/JobDetail\/|\/agency\/OpenPositions\//i.test(url.pathname)) {
            throw new Error(`URL is not an Avature job-detail page: ${rawUrl}`);
        }

        return url;
    }

    function createDescriptionFetchError(message, retryable = true) {
        const error = new Error(message);
        error.retryable = retryable;
        return error;
    }

    function waitForDescriptionRetry(attempt) {
        const delay = (600 * (2 ** (attempt - 1))) + Math.floor(Math.random() * 250);
        return new Promise(resolve => setTimeout(resolve, delay));
    }

    async function fetchDescriptionAttempt(url) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), DESCRIPTION_REQUEST_TIMEOUT_MS);

        try {
            const response = await fetch(url.href, {
                cache: 'no-store',
                credentials: 'include',
                redirect: 'follow',
                headers: { Accept: 'text/html,application/xhtml+xml' },
                signal: controller.signal
            });

            if (!response.ok) {
                const retryable = response.status === 408 || response.status === 425 ||
                    response.status === 429 || response.status >= 500;
                throw createDescriptionFetchError(`HTTP ${response.status} for ${url.href}`, retryable);
            }

            const finalUrl = new URL(response.url);
            if (finalUrl.hostname !== 'missionpethealth.avature.net') {
                throw createDescriptionFetchError(`Job request redirected to ${finalUrl.hostname}`, false);
            }

            const html = await response.text();
            const parsed = globalThis.MphDescriptionParser?.extractDescriptionFromHtml(html);
            const description = parsed?.text?.replace(/\n{3,}/g, '\n\n').trim() || '';

            if (!description || !parsed?.hasDescription) {
                const looksLikeLogin = /type=["']password["']|sign\s*in|log\s*in/i.test(html);
                throw createDescriptionFetchError(
                    looksLikeLogin
                        ? 'Avature returned a login page instead of job details.'
                        : 'Avature response did not contain a job description.',
                    !looksLikeLogin
                );
            }

            return description;
        } catch (error) {
            if (error.name === 'AbortError') {
                throw createDescriptionFetchError(`Request timed out after ${DESCRIPTION_REQUEST_TIMEOUT_MS / 1000} seconds.`);
            }
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    async function fetchJobDescriptionDirectly(queueItem) {
        const url = validateDescriptionUrl(queueItem.link);
        let lastError = null;

        for (let attempt = 1; attempt <= DESCRIPTION_FETCH_ATTEMPTS; attempt++) {
            try {
                return await fetchDescriptionAttempt(url);
            } catch (error) {
                lastError = error;
                if (error.retryable === false || attempt === DESCRIPTION_FETCH_ATTEMPTS) break;
                console.warn(`Retrying ${queueItem.jobId || queueItem.link} after attempt ${attempt}:`, error.message);
                await waitForDescriptionRetry(attempt);
            }
        }

        throw lastError || new Error('Description request failed.');
    }

    function scheduleDescriptionStorageFlush(force = false) {
        const unscheduledCount = descriptionUpdates.size - descriptionLastScheduledCount;
        if (!force && unscheduledCount < DESCRIPTION_SAVE_BATCH_SIZE) return;

        const snapshot = Array.from(descriptionUpdates.values());
        if (snapshot.length === 0) return;
        descriptionLastScheduledCount = descriptionUpdates.size;

        descriptionStorageWriteChain = descriptionStorageWriteChain
            .catch(() => {})
            .then(async () => {
                const data = await chrome.storage.local.get(['scrapedJobs']);
                const jobs = data.scrapedJobs || [];

                for (const update of snapshot) {
                    const jobIndex = findDescriptionJobIndex(jobs, update);
                    if (jobIndex !== -1 && jobs[jobIndex]?.link === update.link) {
                        jobs[jobIndex].description = update.description;
                    }
                }

                await chrome.storage.local.set({ scrapedJobs: jobs });
                descriptionStorageError = null;
                allJobs = jobs;
                renderCurrentView();
            })
            .catch(error => {
                descriptionStorageError = error;
                console.error('Could not save a description batch:', error);
            });
    }

    async function runDescriptionWorker() {
        while (true) {
            const queueIndex = nextDescriptionQueueIndex++;
            if (queueIndex >= descriptionQueue.length) return;

            const queueItem = descriptionQueue[queueIndex];
            activeDescriptionRequests++;

            try {
                const description = await fetchJobDescriptionDirectly(queueItem);
                descriptionUpdates.set(queueItem.key, { ...queueItem, description });
                scheduleDescriptionStorageFlush();
            } catch (error) {
                failedDescriptionCount++;
                console.warn(`Description failed for ${queueItem.jobId || queueItem.link}:`, error);
            } finally {
                activeDescriptionRequests = Math.max(0, activeDescriptionRequests - 1);
                descriptionCompletedCount++;
                updateDescriptionProgress();
            }
        }
    }

    async function runDescriptionWorkers() {
        const workerCount = Math.min(DESCRIPTION_FETCH_CONCURRENCY, descriptionQueue.length);
        await Promise.all(Array.from({ length: workerCount }, () => runDescriptionWorker()));
    }

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

        // Always re-analyze every described job. A row can look "complete" while still carrying
        // stale values (for example Hospital copied into Location or an empty Salary despite
        // structured Base Min./Max. fields), so checking only blank AOP/Position/Experience fields
        // caused Fetch Details to silently skip rows that needed correction.
        detailsQueue = jobs.map((job, index) => ({
            job,
            index,
            key: getJobSelectionKey(job),
            jobId: job.jobId || '',
            link: job.link || ''
        }))
            .filter(item => item.job.title && item.job.description);

        if (detailsQueue.length === 0) {
            showToast('No job descriptions found. Fetch descriptions first.', 'error');
            return;
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

    function findDetailJobIndex(jobs, queueItem) {
        // A supplied link is the authoritative identity. Never fall back to a colliding Job ID
        // when that link is missing from storage, because that could update a different record.
        if (queueItem.link) {
            return jobs.findIndex(job => job.link === queueItem.link);
        }

        if (queueItem.key) {
            const keyIndex = jobs.findIndex(job => getJobSelectionKey(job) === queueItem.key);
            if (keyIndex !== -1) return keyIndex;
        }

        const indexedJob = jobs[queueItem.index];
        const jobId = queueItem.jobId || queueItem.job?.jobId || '';
        if (indexedJob && (!jobId || indexedJob.jobId === jobId)) {
            return queueItem.index;
        }

        return jobId ? jobs.findIndex(job => job.jobId === jobId) : -1;
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

        // Re-read storage and resolve this exact job by its unique listing link.
        const data = await chrome.storage.local.get(['scrapedJobs']);
        const currentJobs = data.scrapedJobs || [];
        // Match by unique link before Job ID. A Ref # applied to an earlier job can collide with
        // a later job's listing ID, which made findIndex(jobId) repeatedly update the first match
        // and leave the actual queued record blank.
        const currentIndex = findDetailJobIndex(currentJobs, queueItem);

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

            // The marketplace card supplies the initial geography. A description may replace it
            // only when the guarded extractor finds structured or explicit job-location evidence.
            detailsList = [{
                areaOfPractice: extracted.areaOfPractice,
                position: extracted.position,
                salary: extracted.salary,
                hospitalName: extracted.hospitalName,
                jobType: extracted.jobType,
                experience: extracted.experience,
                descriptionLocation: extracted.descriptionLocation,
                streetAddress: extracted.streetAddress,
                zipCode: extracted.zipCode,
                description: description
            }];
        }

        // Save extracted details to storage
        if (detailsList.length > 0) {
            await saveDetailResults(detailsList, queueItem);
        }

        // Move to next job — no delay needed since we're analyzing locally
        currentDetailsIndex++;
        setTimeout(() => processNextDetail(), 50);
    }

    // Save detail extraction results to chrome storage
    function saveDetailResults(detailsList, queueItem) {
        return new Promise((resolve) => {
            chrome.storage.local.get(['scrapedJobs'], (data) => {
                const jobs = data.scrapedJobs || [];
                const jobIndex = findDetailJobIndex(jobs, queueItem);
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
                const listingCityBeforeDetails = originalJob.city || '';
                const listingStateBeforeDetails = originalJob.state || '';
                const previousJobKey = getJobSelectionKey(originalJob);
                const referenceJobId = getReferenceJobIdFromDescription(descText, originalJob.jobId || '');
                if (referenceJobId && referenceJobId !== originalJob.jobId) {
                    originalJob.jobId = referenceJobId;
                    if (selectedJobKeys.delete(previousJobKey)) {
                        selectedJobKeys.add(getJobSelectionKey(originalJob));
                    }
                }
                const titleContext = extractTitleContext(listingTitle);
                let descriptionLocation = firstDetail.descriptionLocation;
                const descriptionBranchCity = extractDescriptionBranchCity(descText);
                if (!descriptionLocation && descriptionBranchCity && listingStateBeforeDetails) {
                    const branchCity = formatCityForStorage(descriptionBranchCity);
                    const branchState = formatStateForStorage(listingStateBeforeDetails);
                    descriptionLocation = {
                        city: branchCity,
                        state: branchState,
                        location: `${branchCity}, ${branchState}`,
                        source: 'explicit-description-branch'
                    };
                }
                if (descriptionLocation?.city && descriptionLocation?.state) {
                    const descriptionCity = formatCityForStorage(descriptionLocation.city);
                    const descriptionState = formatStateForStorage(descriptionLocation.state);
                    originalJob.city = descriptionCity;
                    originalJob.state = descriptionState;
                    originalJob.location = `${descriptionCity}, ${descriptionState}`;
                }

                // Use the reliable description location when available; otherwise keep the
                // marketplace card geography collected during the first scrape.
                const detailCity = originalJob.city || '';
                const detailState = originalJob.state || '';
                const detailLocation = originalJob.location || '';
                let resolvedHospital = resolveHospitalNameFromDetails(
                    originalJob.hospital || '',
                    firstDetail.hospitalName || '',
                    descText,
                    detailLocation,
                    detailCity,
                    detailState,
                    {
                        previousCity: listingCityBeforeDetails,
                        previousState: listingStateBeforeDetails,
                        descriptionCity: descriptionLocation?.city || descriptionBranchCity || ''
                    }
                );
                // Some descriptions expose only the parent company (for example Mission Pet
                // Health). In those cases a clearly hospital-like title segment is more specific.
                if (
                    (!resolvedHospital || isGenericOrganizationHospitalName(resolvedHospital)) &&
                    !isMissionPetHealthHospital(originalJob.hospital) &&
                    titleContext.hospital
                ) {
                    resolvedHospital = titleContext.hospital;
                }
                const detailHospital = resolvedHospital || firstDetail.hospitalName || originalJob.hospital || '';

                // Step 1: Determine AOP — prefer detail extractor's AOP (from page category), fall back to title
                let finalAOP = '';
                if (!isNonClinicalJobTitle(listingTitle)) {
                    finalAOP = detailAOP ||
                        (hasSpecialtyTrainingSignal(descText)
                            ? 'Specialty Care'
                            : (
                            (hasUrgentCareSignal(listingTitle, detailHospital, descText) ? 'Urgent Care' : '') ||
                            (hasEmergencySignal(listingTitle, detailHospital) ? 'Emergency Care' : '') ||
                            getAOPFromTitle(listingTitle) ||
                            'General Practice Care'
                        ));
                }

                // Step 2: An explicit role heading in the final description outranks a generic
                // or stale listing title. Specialty-training prose is not treated as a role
                // heading, so Dental Specialist behavior remains unchanged.
                const explicitDescriptionPosition = getExplicitDescriptionPosition(descText);
                let finalPosition = explicitDescriptionPosition ||
                    getPositionFromTitle(listingTitle) ||
                    firstDetail.position || '';

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

                // Step 5: Keep Medical Director only when the final description does not
                // explicitly identify the role as Medical Lead Veterinarian.
                if (!explicitDescriptionPosition && (!finalPosition || finalPosition === 'Associate Veterinarian') && listingTitle.toLowerCase().includes('medical director')) {
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
                originalJob.experience = firstDetail.experience || '-';
                if (resolvedHospital) originalJob.hospital = formatHospitalNameForStorage(resolvedHospital);

                // An explicit Location Address is job-specific evidence. Keep it as a
                // fallback for rows where Google cannot return a verified place record.
                // Google still supplies phone/website and may standardize the street.
                const structuredStreet = addressQuality?.normalizeStreetAddress
                    ? addressQuality.normalizeStreetAddress(firstDetail.streetAddress || '', {
                        city: descriptionLocation?.city || detailCity,
                        state: descriptionLocation?.state || detailState,
                        zipCode: firstDetail.zipCode || ''
                    })
                    : (firstDetail.streetAddress || '').trim();
                const structuredZip = /^\d{5}(?:-\d{4})?$/.test(firstDetail.zipCode || '')
                    ? firstDetail.zipCode
                    : '';
                if (structuredStreet || structuredZip) {
                    originalJob.descriptionAddress = {
                        streetAddress: structuredStreet,
                        city: formatCityForStorage(descriptionLocation?.city || detailCity || ''),
                        state: formatStateForStorage(descriptionLocation?.state || detailState || ''),
                        zipCode: structuredZip
                    };

                    if (!originalJob.addressConflict && structuredStreet && addressPolicy?.isPlaceholder(originalJob.streetAddress)) {
                        originalJob.streetAddress = structuredStreet;
                    }
                    if (!originalJob.addressConflict && structuredZip && addressPolicy?.isPlaceholder(originalJob.zipCode)) {
                        originalJob.zipCode = structuredZip;
                    }
                }
                // Update description if we got a better one
                if (firstDetail.description && firstDetail.description.length > (originalJob.description || '').length) {
                    originalJob.description = firstDetail.description;
                }

                chrome.storage.local.set({ scrapedJobs: jobs }, () => {
                    allJobs = jobs;
                    renderCurrentView();
                    resolve();
                });
            });
        });
    }

    async function finishDetailsFetching() {
        const data = await chrome.storage.local.get(['scrapedJobs']);
        const storedJobs = data.scrapedJobs || [];
        const completeLocationJobs = excludeJobsWithoutCompleteLocation(storedJobs);
        const removedCount = storedJobs.length - completeLocationJobs.length;

        if (removedCount > 0) {
            await chrome.storage.local.set({ scrapedJobs: completeLocationJobs });
        }
        allJobs = completeLocationJobs;
        pruneSelection();
        renderCurrentView();

        isFetchingDetails = false;
        fetchDetailsBtn.disabled = false;
        fetchDetailsBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4M11,7V13L16.2,16.2L17,14.9L12.5,12.2V7H11Z"/>
            </svg>
            Fetch Details
        `;
        document.getElementById('progressSection').classList.add('hidden');
        const removedMessage = removedCount > 0
            ? ` Removed ${removedCount} job${removedCount === 1 ? '' : 's'} without both city and state.`
            : '';
        showToast(`Details fetched! Processed ${detailsQueue.length} jobs.${removedMessage}`, 'success');
    }

    // ============ FETCH ADDRESSES ============

    function normalizeAddressCacheValue(value) {
        return addressQuality?.normalizeAddressCacheValue(value) || normalizeLookupValue(value);
    }

    function makeAddressCacheKey(hospital, location) {
        const hospitalKey = normalizeAddressCacheValue(hospital);
        const locationKey = normalizeAddressCacheValue(location);
        return hospitalKey && locationKey ? `${hospitalKey}|${locationKey}` : '';
    }

    function getAddressCacheKeys(hospital, location, originalHospital = '') {
        return addressQuality?.getAddressCacheKeys(hospital, location, originalHospital)
            || [makeAddressCacheKey(originalHospital || hospital, location)].filter(Boolean);
    }

    function hasUsableCachedAddress(data) {
        return !!(data && data.verified && data.streetAddress && data.zipCode
            && !addressPolicy?.isPlaceholder(data.streetAddress)
            && !addressPolicy?.isPlaceholder(data.zipCode));
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
        if (addressPolicy?.isPlaceholder(job.zipCode)) return false;
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
            addressPolicy?.isPlaceholder(job.streetAddress) &&
            addressPolicy?.isPlaceholder(job.zipCode);
    }

    function hasDefaultAddress(job) {
        return addressPolicy?.isPlaceholder(job?.streetAddress) || addressPolicy?.isPlaceholder(job?.zipCode);
    }

    function applyLivewellFallback(job) {
        const locationParts = parseLocationParts(job.location || '');
        addressPolicy?.applyUnverifiedResult(job, getStrictDescriptionAddress(job));
        job.city = formatCityForStorage(job.city || locationParts.city || '');
        job.state = formatStateForStorage(job.state || locationParts.state || '');
    }

    function applyMissionPetHealthFallback(job) {
        const locationParts = parseLocationParts(job.location || '');
        addressPolicy?.applyNoSpecificHospital(job);
        job.city = formatCityForStorage(job.city || locationParts.city || '');
        job.state = formatStateForStorage(job.state || locationParts.state || '');
    }

    function rememberAddressData(keys, data) {
        if (!hasUsableCachedAddress(data) && !data?.addressResult) return;
        for (const key of keys) {
            addressCache.set(key, { ...data });
        }
    }

    function getRememberedAddress(keys) {
        for (const key of keys) {
            const cached = addressCache.get(key);
            if (hasUsableCachedAddress(cached) || cached?.addressResult) return { ...cached };
        }
        return null;
    }

    function getAddressLookupSignature(job) {
        return addressPolicy.lookupSignature(job);
    }

    function hasCurrentAddressLookup(job) {
        return addressPolicy.isLookupComplete(job, ADDRESS_LOOKUP_VERSION);
    }

    function markAddressLookupComplete(job, verified) {
        if (!job) return;
        addressPolicy.recordLookupAttempt(job, ADDRESS_LOOKUP_VERSION, verified);
    }

    function shouldReplaceStoredAddressBundle(job, verifiedResult) {
        if (!isLivewellHospital(job?.hospital || '')) return false;
        if (verifiedResult?.sourceType === 'livewell-geojson') return true;

        // An intersection is not a deliverable street address. A strictly
        // verified single Livewell place may replace it with the current numbered
        // street; ordinary complete description addresses still keep the prior
        // contact-only behavior requested by the user.
        const storedStreet = String(job?.streetAddress || '').trim();
        return verifiedResult?.uniquePlaceMatch === true
            && /^\d/.test(String(verifiedResult?.streetAddress || '').trim())
            && (!/^\d/.test(storedStreet) || /\s(?:&|and)\s/i.test(storedStreet));
    }

    function canLookupAddressForJob(job) {
        return canFetchAddressForHospital(job.hospital, job.location, job.city, job.state);
    }

    function getStrictDescriptionAddress(job) {
        const structured = job?.descriptionAddress || {};
        const locationParts = parseLocationParts(job?.location || '');
        const expectedCity = locationParts.city || job?.city || '';
        const expectedState = getStateAbbreviation(locationParts.state || job?.state || '');
        const descriptionCity = structured.city || '';
        const descriptionState = getStateAbbreviation(structured.state || '');

        if (expectedCity && descriptionCity && !cityMatchesExpected(expectedCity, descriptionCity, expectedState)) return null;
        if (expectedState && descriptionState && expectedState !== descriptionState) return null;

        const rawStreetAddress = addressPolicy?.isPlaceholder(structured.streetAddress)
            ? ''
            : String(structured.streetAddress || '').trim();
        const streetAddress = addressQuality?.normalizeStreetAddress
            ? addressQuality.normalizeStreetAddress(rawStreetAddress, {
                city: descriptionCity || expectedCity,
                state: descriptionState || expectedState,
                zipCode: structured.zipCode || ''
            })
            : rawStreetAddress;
        const zipCode = /^\d{5}(?:-\d{4})?$/.test(String(structured.zipCode || '').trim())
            && zipMatchesState(structured.zipCode, expectedState || descriptionState)
            ? String(structured.zipCode).trim()
            : '';

        if (!streetAddress || !zipCode) return null;
        return { streetAddress, zipCode };
    }

    function applyFailedAddressDefaults(job, reason = '') {
        const descriptionAddress = getStrictDescriptionAddress(job);
        const locationParts = parseLocationParts(job.location || '');
        addressPolicy?.applyUnverifiedResult(
            job,
            descriptionAddress,
            reason || addressPolicy?.RESULTS.NO_VERIFIED_LISTING
        );
        job.city = formatCityForStorage(locationParts.city || job.city || '');
        job.state = formatStateForStorage(locationParts.state || job.state || '');
    }

    function resolveMissionHospitalFromDescription(job) {
        if (!isMissionPetHealthHospital(job?.hospital)) return true;
        const actualHospital = addressPolicy?.extractSpecificHospitalFromDescription(job.description || '') ||
            extractBetterHospitalNameFromDescription(
                job.description || '',
                job.location || '',
                job.city || '',
                job.state || ''
        );
        if (actualHospital && !isGenericOrganizationHospitalName(actualHospital)) {
            job.hospital = formatHospitalNameForStorage(actualHospital);
            // Never carry a parent-company bundle into the newly identified hospital.
            job.streetAddress = 'TBD';
            job.zipCode = '00000';
            job.phone = '-';
            job.website = '-';
            job.addressResult = '';
            return true;
        }

        const locationParts = parseLocationParts(job.location || '');
        addressPolicy?.applyNoSpecificHospital(job);
        job.city = formatCityForStorage(locationParts.city || job.city || '');
        job.state = formatStateForStorage(locationParts.state || job.state || '');
        return false;
    }

    function primeAddressCache(jobs) {
        // Start each run with a clean cache. Rows saved by an older extension build
        // may contain a cross-branch address bundle; only results verified during
        // this run may be reused by another identical hospital/location row.
        addressCache = new Map();
    }

    fetchAddressesBtn.addEventListener('click', async () => {
        if (isFetchingAddresses) {
            showToast('Already fetching addresses. Please wait...', 'error');
            return;
        }

        const data = await chrome.storage.local.get(['scrapedJobs']);
        const jobs = data.scrapedJobs || [];
        let defaultedAddressCount = 0;

        jobs.forEach(job => {
            const before = JSON.stringify([job.hospital, job.streetAddress, job.zipCode, job.phone, job.website, job.addressResult]);
            addressPolicy?.normalizeLegacyRecord(job);
            if (!addressPolicy?.isPlaceholder(job.website)) {
                job.website = addressQuality?.sanitizeWebsite(job.website || '') || '-';
            }
            resolveMissionHospitalFromDescription(job);
            if (savedAddressStateMismatch(job) || jobLocationMismatch(job)) {
                addressPolicy.invalidateConflictingAddress(job, 'Stored address does not match the job city/state');
            }
            const after = JSON.stringify([job.hospital, job.streetAddress, job.zipCode, job.phone, job.website, job.addressResult]);
            if (before !== after) defaultedAddressCount++;
        });

        jobs.forEach(job => {
            const missingAddress = addressPolicy?.isPlaceholder(job.streetAddress) || addressPolicy?.isPlaceholder(job.zipCode);
            if (!missingAddress || canLookupAddressForJob(job)) return;
            if (!job.hospital && !job.location) return;

            if (isMissionPetHealthHospital(job.hospital)) {
                applyMissionPetHealthFallback(job);
            } else {
                applyMissingAddressDefaults(job);
            }
        });

        if (defaultedAddressCount > 0) {
            await chrome.storage.local.set({ scrapedJobs: jobs });
            allJobs = jobs;
            renderCurrentView();
        }

        // Each extension version verifies a hospital/location once. A second click
        // resumes only unfinished rows; it does not repeat hundreds of completed
        // Google lookups. Hospital or location edits automatically invalidate the stamp.
        const jobsNeedingAddresses = jobs.map((job, index) => ({ job, index }))
            .filter(item => canLookupAddressForJob(item.job) && !hasCurrentAddressLookup(item.job));

        if (jobsNeedingAddresses.length === 0) {
            if (confirm('All eligible jobs have verified addresses for this version. Recheck all of them, including missing contacts?')) {
                addressQueue = jobs.map((job, index) => ({ job, index }))
                    .filter(item => canLookupAddressForJob(item.job));
            } else {
                if (defaultedAddressCount > 0) {
                    showToast(`Updated address defaults for ${defaultedAddressCount} row(s).`, 'success');
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
        addressRunVerified = 0;
        addressRunUnresolved = 0;
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

    function findAddressJobIndex(jobs, queuedJob) {
        return jobs.findIndex(candidate => getJobSelectionKey(candidate) === getJobSelectionKey(queuedJob)
            && getAddressLookupSignature(candidate) === getAddressLookupSignature(queuedJob));
    }

    async function processNextAddress() {
        if (currentAddressIndex >= addressQueue.length) {
            finishAddressFetching();
            return;
        }

        const { job } = addressQueue[currentAddressIndex];
        let index = -1;

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
                index = findAddressJobIndex(jobs, job);
                if (jobs[index]) {
                    if (isMissionPetHealthHospital(jobs[index].hospital)) {
                        applyMissionPetHealthFallback(jobs[index]);
                    } else {
                        applyMissingAddressDefaults(jobs[index]);
                    }
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

            const descriptionKey = getStrictDescriptionAddress(job)
                || (addressPolicy.hasCompleteStoredAddress(job) ? job : null);
            const cacheKeys = getAddressCacheKeys(searchHospital, searchLocation, job.hospital || '')
                .map(key => [key, normalizeAddressCacheValue(descriptionKey?.streetAddress || ''), descriptionKey?.zipCode || ''].join('|'));
            let addressData = getRememberedAddress(cacheKeys);

            if (addressData) {
                console.log(`Using cached address for "${searchHospital}, ${searchLocation}"`);
            } else {
                addressData = await fetchAddressFromGoogleMaps(
                    searchHospital,
                    searchLocation,
                    job.hospital || '',
                    getStrictDescriptionAddress(job) ? job.descriptionAddress : null,
                    job
                );
            }

            const fetchedAddressText = addressData?.fullAddress || addressData?.streetAddress || '';
            const fetchedZip = addressData?.zipCode || extractZipFromAddressText(fetchedAddressText);
            const fetchedState = addressData?.state || extractStateFromAddressText(fetchedAddressText);
            const fetchedCity = addressData?.city || extractCityFromAddressText(fetchedAddressText);
            const hasFetchedCandidate = !!(
                addressData?.businessName || addressData?.streetAddress || addressData?.fullAddress ||
                addressData?.zipCode || addressData?.website || addressData?.phone
            );
            const fetchedCityAccepted = !searchCity || (
                fetchedCity && (cityMatchesExpected(searchCity, fetchedCity, searchState)
                    || (addressData?.verified === true && addressData?.allowPostalCityMismatch === true))
            );
            const fetchedLocationMismatch = hasFetchedCandidate && (
                !fetchedCityAccepted ||
                (searchState && !fetchedState && !fetchedZip) ||
                (searchState && fetchedState && getStateAbbreviation(fetchedState) !== getStateAbbreviation(searchState)) ||
                (searchState && fetchedZip && !zipMatchesState(fetchedZip, searchState))
            );
            const fetchedBrandMismatch = hasFetchedCandidate && !addressMatchesExpectedHospitalBrand(
                job.hospital,
                addressData,
                getStrictDescriptionAddress(job) ? job.descriptionAddress : null,
                searchLocation
            );

            if (fetchedLocationMismatch || fetchedBrandMismatch) {
                const reason = fetchedBrandMismatch ? 'wrong hospital brand' : 'outside requested location';
                console.warn(`Ignoring address result ${reason} "${searchLocation}" for "${searchHospital}": ${addressData.fullAddress || addressData.website || [addressData.city, addressData.state, addressData.zipCode].filter(Boolean).join(', ')}`);
                const cityRejected = searchCity && !fetchedCityAccepted;
                addressData = {
                    streetAddress: '', zipCode: '', city: '', state: '', fullAddress: '', website: '', phone: '',
                    diagnostics: addressData.diagnostics || [],
                    storedAddressConflict: addressData.storedAddressConflict || (
                        fetchedLocationMismatch && !fetchedBrandMismatch
                        && addressData.uniquePlaceMatch === true
                        && addressQuality.streetAddressesMatch(job.streetAddress, addressData.streetAddress)
                            ? (cityRejected ? addressPolicy.RESULTS.REJECTED_CITY : addressPolicy.RESULTS.REJECTED_STATE) : ''),
                    addressResult: fetchedBrandMismatch
                        ? addressPolicy?.RESULTS.REJECTED_HOSPITAL
                        : (cityRejected ? addressPolicy?.RESULTS.REJECTED_CITY : addressPolicy?.RESULTS.REJECTED_STATE)
                };
            }

            rememberAddressData(cacheKeys, addressData);

            // Update job with address data from Google Maps
            const data = await chrome.storage.local.get(['scrapedJobs']);
            const jobs = data.scrapedJobs || [];
            index = findAddressJobIndex(jobs, job);

            if (jobs[index]) {
                const zipFromFull = addressData.fullAddress?.match(/\b(\d{5}(?:-\d{4})?)\b/);
                const hasVerifiedAddress = !!(addressData.verified && addressData.streetAddress && (addressData.zipCode || zipFromFull?.[1]));
                const cleanedFetchedStreet = addressQuality?.normalizeStreetAddress
                    ? addressQuality.normalizeStreetAddress(addressData.streetAddress || '', {
                        city: fetchedCity || addressData.city,
                        state: fetchedState || addressData.state,
                        zipCode: addressData.zipCode || zipFromFull?.[1] || ''
                    })
                    : (addressData.streetAddress || '');

                const correctedCity = shouldCorrectStoredCity(
                    searchCity,
                    fetchedCity,
                    job.hospital || searchHospital,
                    addressData
                ) ? fetchedCity : searchCity;
                jobs[index].city = formatCityForStorage(correctedCity || jobs[index].city || '');
                jobs[index].state = formatStateForStorage(searchState || jobs[index].state || '');
                if (jobs[index].city && jobs[index].state) {
                    jobs[index].location = `${jobs[index].city}, ${jobs[index].state}`;
                }

                if (hasVerifiedAddress) {
                    const verifiedResult = {
                        ...addressData,
                        streetAddress: cleanedFetchedStreet,
                        zipCode: addressData.zipCode || zipFromFull?.[1] || ''
                    };
                    addressPolicy?.applyVerifiedGoogleResult(
                        jobs[index], verifiedResult,
                        addressData.addressResult || addressPolicy?.RESULTS.VERIFIED_MAPS
                    );
                } else {
                    if (addressData.storedAddressConflict) addressPolicy.invalidateConflictingAddress(jobs[index], addressData.storedAddressConflict);
                    applyFailedAddressDefaults(jobs[index], addressData.addressResult);
                }

                jobs[index].addressDiagnostics = addressData.diagnostics || [];
                markAddressLookupComplete(jobs[index], hasVerifiedAddress);
                if (hasVerifiedAddress) addressRunVerified++;
                else addressRunUnresolved++;

                await chrome.storage.local.set({ scrapedJobs: jobs });

                // Update display
                allJobs = jobs;
                renderCurrentView();
            }
        } catch (error) {
            console.error('Error fetching address:', error);
            if (error?.code === 'GOOGLE_VERIFICATION_REQUIRED') {
                isFetchingAddresses = false;
                fetchAddressesBtn.disabled = false;
                fetchAddressesBtn.textContent = 'Fetch Addresses';
                const progressLabel = document.getElementById('progressLabel');
                if (progressLabel) progressLabel.textContent = 'Paused: Google verification required';
                showToast('Address fetching paused. Open Google, complete its verification check, then click Fetch Addresses again.', 'error');
                return;
            }
            const data = await chrome.storage.local.get(['scrapedJobs']);
            const jobs = data.scrapedJobs || [];
            index = findAddressJobIndex(jobs, job);
            if (jobs[index]) {
                applyFailedAddressDefaults(jobs[index], addressPolicy?.RESULTS.NO_VERIFIED_LISTING);
                markAddressLookupComplete(jobs[index], false);
                addressRunUnresolved++;
                jobs[index].addressDiagnostics = [{ source: 'lookup', reason: error?.message || 'Unexpected lookup error' }];
                await chrome.storage.local.set({ scrapedJobs: jobs });
                allJobs = jobs;
                renderCurrentView();
            }
        }

        // Move to next address
        currentAddressIndex++;

        // The previous lookup tab is already closed before this point; a short UI
        // yield is enough and avoids adding over two minutes across 500+ rows.
        setTimeout(() => processNextAddress(), 50);
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
        showToast(`Address check finished: ${addressRunVerified} verified, ${addressRunUnresolved} unresolved. Unresolved rows will retry on the next run.`, addressRunUnresolved ? 'error' : 'success');
    }
});
