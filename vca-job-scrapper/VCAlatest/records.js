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
    let currentJobIndex = 0;
    let descriptionQueue = [];
    let nextDescriptionQueueIndex = 0;
    let activeDescriptionRequests = 0;
    let descriptionCompletedCount = 0;
    let descriptionStorageWriteChain = Promise.resolve();
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

    function isPlaceholderLocationText(value) {
        return /(?:this job is available in|multiple locations|remote|various locations)/i.test(value || '');
    }

    function cleanLocationText(value) {
        const text = (value || '')
            .replace(/,?\s*United States of America/gi, '')
            .replace(/,?\s*USA$/gi, '')
            .trim();
        return isPlaceholderLocationText(text) ? '' : text;
    }

    function hasUsableDescription(description) {
        const text = (description || '').trim();
        if (!text || /^description not found$/i.test(text) || /^error fetching description$/i.test(text)) return false;
        if (/(?:\.\.\.|…)\s*$/i.test(text)) return false;

        const contentOnly = text
            .replace(/=== JOB INFO ===/gi, '')
            .replace(/=== JOB DESCRIPTION ===/gi, '')
            .split(/\r?\n/)
            .filter(line => !/^(?:Title|Location|Category|Industry\/Category|Job ID|Job Type|Employment Type|Post Date|Job Seq No):\s*$/i.test(line.trim()))
            .join('\n')
            .trim();

        if (/(?:\.\.\.|…)\s*$/i.test(contentOnly)) return false;
        return !!contentOnly;
    }

    function plainDescriptionText(description) {
        let text = description || '';
        for (let i = 0; i < 3; i++) {
            const textarea = document.createElement('textarea');
            textarea.innerHTML = text;
            const next = textarea.value;
            if (next === text) break;
            text = next;
        }

        return text
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/(?:p|div|li|h[1-6]|section|ul|ol)>/gi, '\n')
            .replace(/<li[^>]*>/gi, '- ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\u00a0/g, ' ')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/[ \t]{2,}/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    function normalizeJobRecord(job) {
        if (!job || typeof job !== 'object') return job;

        const link = job.link || job.url || '';
        const jobId = job.jobId || job.departmentId || '';
        const rawHospital = job.hospital || job.hospitalName || '';
        let hospital = /\s+(?:and|&|nearby)\s*$/i.test(rawHospital)
            ? cleanExtractedHospitalName(rawHospital)
            : rawHospital;
        const website = job.website || job.websiteUrl || '';
        const streetAddress = job.streetAddress || job.address || '';
        const aggregator = job.aggregator || 'VCA Animal Hospitals (Parent Client)';

        job.link = link;
        job.url = job.url || link;
        job.jobId = jobId;
        job.departmentId = job.departmentId || jobId;
        job.aggregator = aggregator;
        job.hospital = hospital;
        job.hospitalName = hospital;
        job.website = website;
        job.websiteUrl = job.websiteUrl || website;
        job.streetAddress = streetAddress;
        job.address = job.address || streetAddress;

        if (!job.listingSeedOnly && (!job.city || !job.state) && job.location) {
            const locationText = cleanLocationText(job.location);
            const parts = locationText.split(',').map(part => part.trim()).filter(Boolean);
            if (parts.length >= 2) {
                if (!job.city) job.city = formatCityForStorage(parts[0]);
                if (!job.state) job.state = formatStateForStorage(parts[1]);
            }
        }

        return job;
    }

    function normalizeJobRecords(jobs) {
        return (jobs || []).map(normalizeJobRecord);
    }

    function getBaseJobId(job) {
        return (job?.jobId || job?.departmentId || '')
            .replace(/-(?:loc\d+|[A-Z]+)$/i, '')
            .trim();
    }

    function isGeneratedLocationJob(job) {
        return /-(?:loc\d+|[A-Z]+)$/i.test(job?.jobId || job?.departmentId || '') || !!job?.sourceLink || !!job?.isMultiLocationSplit;
    }

    function getSplitSourceJobId(job) {
        return (job?.sourceJobId || job?.originalJobId || '').trim();
    }

    function getSplitParentJobIds(jobs = []) {
        return new Set(
            jobs
                .map(getSplitSourceJobId)
                .filter(Boolean)
        );
    }

    function isSplitChildOrParentJob(job, splitParentJobIds) {
        if (job?.isMultiLocationSplit || getSplitSourceJobId(job)) return true;
        const baseJobId = getBaseJobId(job) || job?.jobId || job?.departmentId || '';
        return !!baseJobId && splitParentJobIds.has(baseJobId);
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
        return /^(vca|vca animal hospitals?|vca veterinary hospital|mission pet health|united veterinary care|svp|southern veterinary partners|our hospital|specialist)$/i.test((hospitalName || '').trim());
    }

    function isFilledOrUnavailableJobDescription(description) {
        const text = (description || '')
            .replace(/\u2026/g, '...')
            .replace(/[^\S\r\n]+/g, ' ')
            .trim();

        if (!text) return false;

        return [
            /job\s+you\s+are\s+trying\s+to\s+apply\s+for\s+has\s+been\s+filled/i,
            /we'?re\s+sorry[\s\S]{0,160}\bjob\b[\s\S]{0,160}\b(?:filled|closed|no\s+longer\s+available|unavailable)\b/i,
            /\b(?:this|the)\s+job\s+(?:posting\s+)?(?:is\s+|has\s+been\s+)?(?:filled|closed|no\s+longer\s+available|unavailable)\b/i,
            /\b(?:this|the)\s+position\s+(?:is\s+|has\s+been\s+)?(?:filled|closed|no\s+longer\s+available|unavailable)\b/i
        ].some(pattern => pattern.test(text));
    }

    function isMissionPetHealthHospital(hospitalName) {
        return /^(vca|vca animal hospitals?)$/i.test((hospitalName || '').trim());
    }

    function escapeRegex(value) {
        return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function looksLikeCompleteHospitalName(value) {
        const clean = (value || '').trim();
        if (!clean || /\b(?:and\s+you|where\b|we\b|you\S*ll|you\s+will|located\b|is\s+located\b|is\s+seeking|are\s+seeking)\b/i.test(clean)) {
            return false;
        }

        return /^(?:VCA\s+)?[A-Z][A-Za-z0-9&'().\/_\-\u2013\u2014 ]{2,160}?\b(?:Animal Hospital|Animal Medical Center|Veterinary Specialists?|Veterinary Hospital|Veterinary Clinic|Veterinary Center|Veterinary Care|Pet Hospital|Pet Center|Pet Care(?:\s+Animal Hospital)?|Emergency Hospital|Emergency Center|Referral Hospital|Referral Center|Specialty Hospital|Specialty Center|Medical Center|Hospital|Clinic|Center|Care|Specialists?|VREC|CAVES|Service|Services|Veterinary Group)(?:\s*\([^)]+\))?$/i.test(clean);
    }

    function stripTrailingRealLocationPhrase(value) {
        const statePattern = Object.values(stateAbbreviations).map(escapeRegex).join('|');
        return (value || '').replace(
            new RegExp(`\\s+in\\s+[A-Z][A-Za-z .'-]+,?\\s+(?:[A-Z]{2}|${statePattern})\\b.*$`, 'i'),
            ''
        );
    }

    function cleanExtractedHospitalName(candidate) {
        let clean = (candidate || '')
            .replace(/_/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/^(?:the\s+)?VCA\s+the\s+/i, 'VCA ')
            .replace(/^.*\bat\s+(VCA\s+)/i, 'VCA ')
            .replace(/,\s*(?:we|our)\b.*$/i, '')
            .replace(/\s+outside\s+of\b.*$/i, '')
            .replace(/\s+as\s+(?:Medical\s+Director|Associate\s+Veterinarian|Veterinarian|Emergency\s+Veterinarian|Specialist|Doctor)\b.*$/i, '')
            .replace(/^.*\b(?:at|with)\s+((?:VCA\s+)?[A-Z][^;\n]{2,180}?)(?=\s+(?:and\s+you|where\b|you\S*ll|you\s+will|located\b|located\s+in\b|is\s+located\b|is\s+(?:seeking|looking|hiring|excited|pleased|proud|growing|accepting)|are\s+(?:seeking|looking|hiring|excited|pleased|proud|growing|accepting))\b|[.;]|$)/i, '$1')
            .replace(/\s+(?:[-\u2013\u2014]|\u00e2\u20ac[\u201c\u009d])\s+[A-Z][A-Za-z .'-]+,\s*(?:[A-Z]{2}|[A-Z][a-z]+)\s*$/i, '')
            .replace(/,\s*(?:[A-Z]{2}|[A-Z][a-z]+)\s*$/i, '')
            .trim();

        if (looksLikeCompleteHospitalName(clean)) return clean.replace(/[\s,;:.!-]+$/, '').trim();

        clean = stripTrailingRealLocationPhrase(clean)
            .replace(/\s+(?:and\s+you|where\b|we\b|you\S*ll|you\s+will|located\b|located\s+in\b|is\s+located\b).*$/i, '')
            .replace(/\s+(?:is|are)\s+(?:seeking|looking|hiring|excited|pleased|proud|growing|accepting).*$/i, '')
            .replace(/\s*\([A-Z0-9]{2,}\)\s*$/i, '')
            .replace(/^the\s+/i, '')
            .replace(/\s+(?:and|&|nearby)\s*$/i, '')
            .replace(/[\s,;:.!-]+$/, '')
            .trim();

        return clean;
    }

    function isValidExtractedHospitalName(candidate) {
        const value = (candidate || '').trim();
        if (!value || value.length < 3 || value.length > 120) return false;
        if (/^(?:vca|vcacareers|vca we|vca,|vca is|vca animal hospitals?|at vca)$/i.test(value)) return false;
        if (/\s+(?:and|&|nearby)$/i.test(value)) return false;
        if (/(?:future of veterinary|committed to equity|veterinary medicine is|corporate handbook|current associate|vcacareers|board certification|american board|pathway to|certification|residency program|approved residency|practitioners)/i.test(value)) return false;
        return /\b(?:VCA|Animal|Veterinary|Pet|Hospital|Clinic|Center|Care|Specialists?|Referral|Emergency|Oncology Service|CAVES|VREC|Vet Specs|Katonah Bedford|South Shore|Choptank|Woodbridge|Blairstown|Manhattan|Freehold|Sugar Grove|Old Marple|Pike Creek|Delaware Valley|Loomis Basin|Park East|Westbury|Chancellor|Everett|Beech Grove|Bakerstown|Carriage Hills)\b/i.test(value);
    }

    function getFallbackHospitalByLocation(location = '', city = '', state = '') {
        const locationParts = parseLocationParts(cleanLocationText(location));
        const fallbackCity = formatCityForStorage(city || locationParts.city || '');
        const fallbackState = formatStateForStorage(state || locationParts.state || '');

        if (!fallbackCity || !fallbackState) return '';
        return `VCA Animal Hospitals - ${fallbackCity}, ${fallbackState}`;
    }

    function isFallbackHospitalName(hospitalName) {
        return /^VCA Animal Hospitals?\s+(?:-\s+)?.+,\s+.+$/i.test((hospitalName || '').trim());
    }

    // Some VCA postings expose a known-bad abbreviated value even though the
    // correct hospital appears in the saved description.
    const JOB_ID_HOSPITAL_NAME_OVERRIDES = {
        'R-211334': 'VCA California Veterinary Specialists - Ontario',
        'R-239526': 'VCA Regional Institute for Veterinary Emergencies and Referrals',
        'R-181217': 'VCA Capitol Area Veterinary Emergency and Specialty',
        'R-213583': 'VCA Animal Medical and Dental Group',
        'R-234213': "VCA St. Mary's Animal Hospital",
        'R-193665': 'VCA Veterinary Referral and Emergency Center',
        'R-177371': 'VCA Animal Referral and Emergency Center of Arizona',
        'R-222736': 'VCA All Our Pets Animal Hospital',
        'R-225896': 'VCA McCormick Ranch Animal Hospital and Emergency Center',
        'R-214459': 'VCA Animal Referral and Emergency Center of Arizona',
        'R-223141': 'VCA Animal Specialty and Emergency Center',
        'R-198408': 'VCA Shoreline Veterinary Referral and Emergency Center',
        'R-235800': 'VCA Veterinary Referral and Emergency Center',
        'R-170561': 'VCA Animal Referral and Emergency Center of Arizona',
        'R-235059': 'VCA Vineyard Animal Hospital and nearby VCA Animal Medical Center',
        'R-210532': 'VCA Katonah Bedford Animal Hospital',
        'R-207125': 'VCA Valley Animal Hospital and Emergency Center',
        'R-211398': 'VCA Animal Specialty and Emergency Center',
        'R-229576': 'VCA Animal Referral and Emergency Center of Arizona',
        'R-236026': 'VCA Bakerstown Animal Hospital',
        'R-224771': 'VCA Metroplex Animal Hospital and Pet Lodge',
        'R-234536': 'VCA Associates in Pet Care Animal Hospital',
        'R-236639': 'VCA Blairstown Animal Hospital',
        'R-186622': 'VCA TLC Pasadena Veterinary Specialty and Emergency',
        'R-240182': 'VCA Animal Specialty and Emergency Center (ASEC)',
        'R-234223': 'VCA TLC Pasadena Veterinary Specialty and Emergency',
        'R-238990': 'VCA All Our Pets Animal Hospital',
        'R-236885': 'VCA Carriage Hills Animal Hospital',
        'R-236964': 'VCA Capitol Area Veterinary Emergency and Specialty',
        'R-235347': 'VCA St. Clair Shores Animal Hospital',
        'R-240335': 'VCA Bellevue Veterinary Hospital',
        'R-228588': 'VCA Stoney Creek Animal Hospital',
        'R-236955': 'VCA Baywood Animal Hospital and Pet Resort',
        'R-240697': 'VCA Family and Oahu Veterinary Specialty Center',
        'R-227757': 'VCA Cazenovia Animal Hospital',
        'R-230182': 'VCA Regional Institute for Veterinary Emergency and Referral (RIVER)',
        'R-226989': 'VCA Coral Springs Pet Resort and Medical Center',
        'R-234900': 'VCA Clermont Animal Hospital',
        'R-219280': 'VCA Stoney Creek Animal Hospital',
        'R-227753': 'VCA Ridgewood Veterinary Hospital',
        'R-230279': 'VCA Animal Care Associates',
        'R-217108': 'VCA Dog and Cat Hospital of Tiffin',
        'R-241643': 'VCA California Veterinary Specialists - Murrieta'
    };

    function normalizeHospitalNameForCompare(value) {
        return (value || '')
            .replace(/&/g, ' and ')
            .replace(/[\u2018\u2019]/g, "'")
            .replace(/[\u2013\u2014]/g, '-')
            .replace(/[^a-z0-9]+/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    function getJobIdFromDescription(text) {
        const match = (text || '').match(/^Job ID:\s*([A-Z]-\d+)/im);
        return match ? match[1].trim() : '';
    }

    function getHospitalNameOverrideFromDescription(text) {
        const jobId = getJobIdFromDescription(text);
        return jobId ? (JOB_ID_HOSPITAL_NAME_OVERRIDES[jobId] || '') : '';
    }

    function isLikelyIncompleteHospitalName(hospitalName) {
        const value = (hospitalName || '').trim();
        if (!value) return true;
        if (isGenericOrganizationHospitalName(value) || isFallbackHospitalName(value)) return true;
        if (/^Veterinarian\s+VCA\b/i.test(value)) return true;
        if (/^VCA\s+(?:All|St|Dog|Family|Associates|Animal Referral|Animal Specialty|Animal Medical)$/i.test(value)) return true;
        if (/^VCA\s+(?:Capitol Area Veterinary Emergency|Regional Institute for Veterinary Emergenc(?:y|ies)|TLC Pasadena Veterinary Specialty|Coral Springs Pet Resort|Animal Emergency Critical Care)$/i.test(value)) return true;
        return false;
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

        const overrideHospital = getHospitalNameOverrideFromDescription(text);
        if (overrideHospital) return overrideHospital;

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
            !isLocationOnlyHospitalName(metadataHospital, location, city, state) &&
            !isGenericOrganizationHospitalName(metadataHospital)
        ) {
            return metadataHospital;
        }

        const namedHospital = /([A-Z][A-Za-z0-9&'().\/_\-\u2013\u2014 ]{2,160}?\b(?:Animal Hospital|Animal Medical Center|Veterinary Specialists?|Veterinary Hospital|Veterinary Clinic|Veterinary Center|Veterinary Care|Pet Hospital|Pet Center|Pet Care|Emergency Hospital|Emergency Center|Referral Hospital|Referral Center|Specialty Hospital|Specialty Center|Medical Center|Hospital|Clinic|Center|Care|Specialists?|VREC|CAVES|Service|Services|Veterinary Group)(?:\s+(?:of|and|&)\s+(?:the\s+)?[A-Z][A-Za-z0-9&'().\/_\-\u2013\u2014 ]{1,80})?(?:\s*\([^)]+\))?)/i;
        const searchText = text.replace(/_/g, ' ');
        const patterns = [
            /\bLearn\s+more\s+about\s+the\s+hospital\s+([A-Z][A-Za-z0-9&'()_\- ]{2,80}?)(?=\s+If\s+you\s+are|\s+Benefits:|[.\n\r]|$)/i,
            new RegExp(`\\b(?:at|with)\\s+${namedHospital.source}\\s+as\\s+(?:Medical\\s+Director|Associate\\s+Veterinarian|Veterinarian|Emergency\\s+Veterinarian|Specialist|Doctor)`, 'i'),
            /Join us as\s+(?:an?|the)?\s*[^.]{0,180}?\s+at\s+([^;\n]+?)(?=\s+(?:and\s+you|where|you\S*\s*l|you\s+will)|\.\s+(?:You|At|Why|If)|$)/i,
            /Join us as\s+(?:an?|the)?\s*[^.]{0,180}?\s+((?:VCA\s+)?[A-Z][^;\n]+?)(?=\s+in\s+[A-Z][A-Za-z .'-]+,?\s+(?:[A-Z]{2}|[A-Z][a-z]+)|\.\s+(?:You|At|Why|If)|$)/i,
            /\bJoin\s+us\s+as\s+(?:an?|the)?\s*[^.]{0,180}?\s+at\s+(VCA\s+[^.;\n]+?)\s+in\s+[A-Z][A-Za-z .'-]+,?\s+(?:[A-Z]{2}|[A-Z][a-z]+)\b/i,
            /\bJoin\s+us\s+as\s+(?:an?|the)?\s*[^.]{0,180}?\s+(VCA\s+[^.;\n]+?)\s+in\s+[A-Z][A-Za-z .'-]+,?\s+(?:[A-Z]{2}|[A-Z][a-z]+)\b/i,
            new RegExp(`\\bWelcome\\s+to\\s+${namedHospital.source}`, 'i'),
            new RegExp(`${namedHospital.source}\\s+(?:is\\s+located|located\\s+in)`, 'i'),
            new RegExp(`${namedHospital.source}\\s+is\\s+(?:an?\\s+)?(?:multi-specialty|full-service|specialty|emergency|small|busy|progressive|premier|well-established|thriving|AAHA|hybrid|24-hour|referral|veterinary)`, 'i'),
            new RegExp(`${namedHospital.source}\\s+(?:is|are)\\s+(?:seeking|looking|hiring|excited|pleased|proud|growing|accepting)`, 'i'),
            new RegExp(`${namedHospital.source}\\s+has\\s+an?\\s+(?:opportunity|opening)`, 'i'),
            /\b(VCA\s+[A-Z][A-Za-z0-9&'().\/_\-\u2013\u2014 ]{2,120}?)\s+(?:is|are)\s+(?:seeking|looking|hiring|excited|pleased|proud|growing|accepting|a\s+|an\s+)/i,
            new RegExp(`\\bAt\\s+${namedHospital.source}[,.;]`, 'i')
        ];

        for (const pattern of patterns) {
            const match = searchText.match(pattern);
            const candidate = cleanExtractedHospitalName(match?.[1] || '');
            if (
                isValidExtractedHospitalName(candidate) &&
                !isLocationOnlyHospitalName(candidate, location, city, state) &&
                !isGenericOrganizationHospitalName(candidate)
            ) {
                return candidate;
            }
        }

        return '';
    }

    function resolveHospitalNameFromDetails(currentHospital, detailHospital, description, location, city, state) {
        const currentIsLocationOnly = isLocationOnlyHospitalName(currentHospital, location, city, state);
        const detailIsBetter = detailHospital &&
            !isLocationOnlyHospitalName(detailHospital, location, city, state) &&
            !isGenericOrganizationHospitalName(detailHospital);

        if (currentIsLocationOnly && detailIsBetter) {
            return detailHospital.trim();
        }

        const descriptionHospital = extractBetterHospitalNameFromDescription(description, location, city, state);
        if (
            descriptionHospital &&
            (isLikelyIncompleteHospitalName(currentHospital) ||
                normalizeHospitalNameForCompare(descriptionHospital) !== normalizeHospitalNameForCompare(currentHospital))
        ) {
            return descriptionHospital;
        }

        if (currentIsLocationOnly && descriptionHospital) {
            return descriptionHospital;
        }

        if (detailIsBetter) return detailHospital.trim();

        if (currentHospital && !isLikelyIncompleteHospitalName(currentHospital)) {
            return currentHospital.trim();
        }

        return '';
    }

    function canFetchAddressForHospital(hospitalName, location = '', city = '', state = '') {
        if (!hospitalName || !location) return false;
        if (/multi-site|;/i.test(hospitalName)) return false;
        if (isFallbackHospitalName(hospitalName)) {
            const locationParts = parseLocationParts(location);
            return !!(city || locationParts.city) && !!(state || locationParts.state);
        }
        if (isLocationOnlyHospitalName(hospitalName, location, city, state)) return false;
        if (isGenericOrganizationHospitalName(hospitalName)) return false;
        return true;
    }

    function getCompleteAddressParts(job = {}, parsedAddress = null) {
        const streetAddress = parsedAddress?.streetAddress || job.streetAddress || job.address || '';
        const city = parsedAddress?.city || job.city || '';
        const state = parsedAddress?.state || job.state || '';
        const zipCode = parsedAddress?.zipCode || job.zipCode || '';

        if (!streetAddress || !city || !state || !zipCode) return null;

        return {
            streetAddress: streetAddress.trim(),
            city: formatCityForStorage(city),
            state: formatStateForStorage(state),
            zipCode: String(zipCode).trim(),
            location: `${formatCityForStorage(city)}, ${formatStateForStorage(state)}`
        };
    }

    function buildFullAddressForLookup(addressParts) {
        if (!addressParts) return '';
        const city = formatCityForStorage(addressParts.city || '');
        const stateAbbr = getStateAbbreviation(addressParts.state || '') || addressParts.state || '';
        return [
            addressParts.streetAddress,
            city,
            [stateAbbr, addressParts.zipCode].filter(Boolean).join(' ')
        ].filter(Boolean).join(', ');
    }

    function cleanHospitalNameFromAddressLookup(value) {
        const clean = (value || '')
            .replace(/_/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/^(?:the\s+)?VCA\s+the\s+/i, 'VCA ')
            .replace(/\s*\|\s*\d+\s*$/i, '')
            .replace(/\s*\|.*$/i, '')
            .replace(/\s+\d+(?:\.\d+)?\s*\(\d[\d,]*\).*$/i, '')
            .replace(/\s+(?:Open|Closed|Website|Directions|Reviews|Photos|Overview)\b.*$/i, '')
            .replace(/[\s,;:.!-]+$/, '')
            .trim();

        if (!clean) return '';
        if (isFallbackHospitalName(clean)) return '';
        if (isGenericOrganizationHospitalName(clean)) return '';
        if (isLocationOnlyHospitalName(clean)) return '';
        if (!isValidExtractedHospitalName(clean)) return '';
        return clean;
    }

    function getAlphabeticSuffix(index) {
        let n = index + 1;
        let suffix = '';
        while (n > 0) {
            n--;
            suffix = String.fromCharCode(65 + (n % 26)) + suffix;
            n = Math.floor(n / 26);
        }
        return suffix;
    }

    function parseStreetAddressText(value) {
        const text = (value || '')
            .replace(/\u00a0/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/^[\s,;:\-]+|[\s,;]+$/g, '')
            .trim();

        if (!/\d{5}(?:-\d{4})?\b/.test(text) || !/^\d/.test(text)) return null;

        const match =
            text.match(/^(.+?),\s*(.+?)\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\b/) ||
            text.match(/^(.+?),\s*(.+?),\s*([A-Za-z][A-Za-z ]+)\s+(\d{5}(?:-\d{4})?)\b/i);
        if (!match) return null;

        const streetAddress = match[1].trim();
        const city = formatCityForStorage(match[2].trim());
        const state = formatStateForStorage(match[3].trim());
        const zipCode = match[4].trim();

        if (!streetAddress || !city || !state || !zipCode) return null;

        return {
            streetAddress,
            city,
            state,
            zipCode,
            location: `${city}, ${state}`
        };
    }

    function extractAddressFromDescription(text) {
        const source = (text || '').replace(/\u00a0/g, ' ');
        const labelPatterns = [
            /(?:^|\n)\s*(?:Work\s+Location|Work\s+Address|Job\s+Location|Practice\s+Location|Hospital\s+Address|Address|Location)\s*:\s*([^\n]+)/ig,
            /(?:^|\n)\s*(?:located\s+at|work\s+at)\s+([^\n]+)/ig
        ];

        for (const pattern of labelPatterns) {
            let match;
            while ((match = pattern.exec(source)) !== null) {
                const parsed = parseStreetAddressText(match[1]);
                if (parsed) return parsed;
            }
        }

        const generalMatch = source.match(/\b(\d{1,6}\s+[A-Za-z0-9#.'\- ]+?,\s*[A-Za-z][A-Za-z .'\-()]+?\s*,?\s+[A-Z]{2}\s+\d{5}(?:-\d{4})?)\b/);
        return generalMatch ? parseStreetAddressText(generalMatch[1]) : null;
    }

    function cleanMultiLocationHospitalName(value) {
        return cleanExtractedHospitalName(value)
            .replace(/\s+(?:available|opening|opportunity|role|position)\b.*$/i, '')
            .replace(/\s+(?:and|&|nearby)\s*$/i, '')
            .trim();
    }

    function normalizeSplitRoleTitle(value, fallbackTitle = '') {
        const clean = (value || '')
            .replace(/\b(?:full\s*time|part\s*time|relief|per\s+diem|opening|role|position)\b/gi, ' ')
            .replace(/\s+/g, ' ')
            .replace(/^[,;:\-\s]+|[,;:\-\s]+$/g, '')
            .trim();

        if (!clean) return fallbackTitle || '';
        const position = getPositionFromTitle(clean) || getPositionFromDescription(clean);
        if (!position) return fallbackTitle || clean;
        return position;
    }

    function parseMultiLocationLine(line, fallbackTitle = '') {
        const text = (line || '')
            .replace(/^[\s\-*•]+/, '')
            .replace(/\s+/g, ' ')
            .trim();

        if (!text || !/\b[A-Z]{2}\b/.test(text)) return null;

        const vcaMatch = text.match(/^(.+?),\s*([A-Z]{2})\s+(.+?)\s+(VCA\s+.+)$/i);
        if (vcaMatch) {
            if (!isStateValue(vcaMatch[2])) return null;
            const city = formatCityForStorage(vcaMatch[1].replace(/\s{2,}/g, ' '));
            const state = formatStateForStorage(vcaMatch[2].toUpperCase());
            const roleTitle = normalizeSplitRoleTitle(vcaMatch[3], fallbackTitle);
            const hospital = cleanMultiLocationHospitalName(vcaMatch[4]);

            if (city && state && isValidExtractedHospitalName(hospital)) {
                return {
                    city,
                    state,
                    location: `${city}, ${state}`,
                    title: roleTitle,
                    hospital,
                    streetAddress: '',
                    zipCode: ''
                };
            }
        }

        const facilityMatch = text.match(/^(.+?),\s*([A-Z]{2})\s+(.+?)\s+([A-Z][A-Za-z0-9&'().\/\-\s]{2,160}?\b(?:Animal Hospital|Veterinary Hospital|Veterinary Center|Veterinary Clinic|Veterinary Specialists?|Pet Hospital|Pet Center|Emergency Center|Medical Center|Specialty Center|Hospital|Clinic|Center|Care|Specialists?)(?:\s+\([^)]+\))?)$/i);
        if (facilityMatch) {
            if (!isStateValue(facilityMatch[2])) return null;
            const city = formatCityForStorage(facilityMatch[1].replace(/\s{2,}/g, ' '));
            const state = formatStateForStorage(facilityMatch[2].toUpperCase());
            const roleTitle = normalizeSplitRoleTitle(facilityMatch[3], fallbackTitle);
            const hospital = cleanMultiLocationHospitalName(facilityMatch[4]);

            if (city && state && isValidExtractedHospitalName(hospital)) {
                return {
                    city,
                    state,
                    location: `${city}, ${state}`,
                    title: roleTitle,
                    hospital,
                    streetAddress: '',
                    zipCode: ''
                };
            }
        }

        return null;
    }

    function extractStructuredLocationEntries(text, fallbackTitle = '') {
        const entries = [];
        const lines = (text || '').split(/\r?\n/);

        for (const line of lines) {
            const parsed = parseMultiLocationLine(line, fallbackTitle);
            if (parsed) entries.push(parsed);
        }

        return entries;
    }

    function extractMetadataLocationEntries(text, fallbackTitle = '') {
        const locationsSection = (text || '').match(/Locations:\n((?:\s*-\s*[^\n]+\n?)+)/i);
        if (!locationsSection) return [];

        const entries = [];
        const lines = locationsSection[1].split(/\r?\n/);
        for (const line of lines) {
            const parts = line.replace(/^\s*-\s*/, '').split(',').map(part => part.trim()).filter(Boolean);
            if (parts.length < 2) continue;
            const city = formatCityForStorage(parts[0]);
            const state = formatStateForStorage(parts[1]);
            if (!city || !state) continue;
            entries.push({
                city,
                state,
                location: `${city}, ${state}`,
                title: fallbackTitle || '',
                hospital: '',
                streetAddress: '',
                zipCode: ''
            });
        }

        return entries;
    }

    function isStandaloneFacilityName(value) {
        const clean = cleanMultiLocationHospitalName(value)
            .replace(/\s*\([^)]+\)\s*$/g, '')
            .trim();

        if (!clean || clean.length < 6 || clean.length > 120) return false;
        if (!isValidExtractedHospitalName(clean)) return false;
        if (!/^VCA\b/i.test(clean)) {
            const words = clean.split(/\s+/).filter(Boolean);
            if (words.length < 3) return false;
            if (/^(?:Animal|Veterinary|Pet|Emergency|Referral|Specialty|Medical|Internal|Critical|Urgent|Primary|General)\b/i.test(clean)) {
                return false;
            }
        }

        return /\b(?:Animal\s+Emergency\s+Critical\s+Care|Veterinary\s+Internal\s+Medicine|Animal\s+Hospital|Animal\s+Medical\s+Center|Veterinary\s+Specialists?|Veterinary\s+Hospital|Veterinary\s+Clinic|Veterinary\s+Center|Veterinary\s+Care|Pet\s+Hospital|Pet\s+Center|Pet\s+Care|Emergency\s+Hospital|Emergency\s+Center|Referral\s+Hospital|Referral\s+Center|Specialty\s+Hospital|Specialty\s+Center|Medical\s+Center|Internal\s+Medicine|Hospital|Clinic|Center|Care|Medicine|Specialists?|VREC|CAVES|Service|Services|Veterinary\s+Group)\b/i.test(clean);
    }

    function cleanCompoundHospitalPart(value) {
        return cleanMultiLocationHospitalName(value)
            .replace(/^\s*(?:nearby|our|the)\s+/i, '')
            .replace(/\s*\([A-Z0-9&\s]{2,}\)\s*$/i, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function splitCompoundHospitalNames(value) {
        const clean = (value || '')
            .replace(/\u00a0/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/\s+in\s+[A-Z][A-Za-z .'-]+,?\s+(?:[A-Z]{2}|[A-Z][a-z]+)\b.*$/i, '')
            .replace(/\s+(?:where|and\s+you|you\S*\s*l|you\s+will|we\s+are)\b.*$/i, '')
            .replace(/\s*\([A-Z0-9&\s]{2,}\)\s*$/i, '')
            .replace(/[.;]+$/g, '')
            .trim();

        if (!/\s+(?:and|&)\s+/i.test(clean)) return [];

        const parts = clean.split(/\s+(?:and|&)\s+/i).map(cleanCompoundHospitalPart).filter(Boolean);
        if (parts.length !== 2) return [];
        if (!parts.every(isStandaloneFacilityName)) return [];

        return parts;
    }

    function getEntryLocationFromJob(originalJob = {}, text = '') {
        const explicitAddress = extractAddressFromDescription(text);
        if (explicitAddress) return explicitAddress;

        const fromLocation = parseLocationParts(cleanLocationText(originalJob.location || ''));
        const city = formatCityForStorage(originalJob.city || fromLocation.city || '');
        const state = formatStateForStorage(originalJob.state || fromLocation.state || '');

        if (!city || !state) return null;

        return {
            city,
            state,
            location: `${city}, ${state}`,
            streetAddress: '',
            zipCode: ''
        };
    }

    function extractCompoundHospitalEntries(text, originalJob = {}, fallbackTitle = '') {
        const source = (text || '').replace(/\u00a0/g, ' ');
        const entries = [];
        const patterns = [
            /\bJoin\s+us\s+as\s+[^.\n]{0,220}?\s+at\s+([^.\n]+?)(?=\.|\s+You|\s+you|$)/ig,
            /\b(?:position|role|opportunity)\s+(?:at|with)\s+([^.\n]+?)(?=\.|\s+You|\s+you|$)/ig
        ];
        const loc = getEntryLocationFromJob(originalJob, source);
        if (!loc) return entries;

        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(source)) !== null) {
                const hospitals = splitCompoundHospitalNames(match[1]);
                if (hospitals.length < 2) continue;

                for (const hospital of hospitals) {
                    entries.push({
                        city: loc.city,
                        state: loc.state,
                        location: loc.location,
                        title: fallbackTitle || originalJob.title || '',
                        hospital,
                        streetAddress: loc.streetAddress || '',
                        zipCode: loc.zipCode || ''
                    });
                }
            }
        }

        return entries;
    }

    function extractApprovedMultiPositions(text = '') {
        const source = text || '';
        const hasMedicalDirector = /\bmedical director\b/i.test(source);
        const generalPracticeRules = [
            ['Medical Lead Veterinarian', /\bmedical lead(?:\s+veterinarian)?\b/i],
            ['Lead Veterinarian', /\blead veterinarian\b|\blead vet\b/i],
            ['Partner Veterinarian', /\bpartner veterinarian\b|\bpartner vet\b/i],
            ['Associate Veterinarian', /\bassociate veterinarian\b|\bassociate vet\b|\bassociate dvm\b/i]
        ];
        const positionRules = [
            ['Medical Director', /\bmedical director\b/i],
            ...generalPracticeRules,
            ['Anesthesiologist', /\banesthesiologist\b|\banesthesia\b/i],
            ['Cardiologist', /\bcardiologist\b|\bcardiology\b/i],
            ['DABVP Specialist', /\bdabvp\b|\bavian\b|\bexotics?\b|\bzoo(?:logical)? medicine\b/i],
            ['Dental Specialist', /\bdental specialist\b|\bveterinary dentist\b|\bdentistry\b/i],
            ['Dermatologist', /\bdermatologist\b|\bdermatology\b/i],
            ['ECC Specialist', /\bcriticalist\b|\becc specialist\b|\bemergency\s*(?:&|and)?\s*critical care specialist\b/i],
            ['Internal Medicine Specialist', /\binternist\b|\binternal medicine specialist\b/i],
            ['Medical Oncologist', /\bmedical oncologist\b|\boncologist\b|\boncology\b/i],
            ['Neurologist & Neurosurgeon', /\bneurologist\b|\bneurosurgeon\b|\bneurology\b/i],
            ['Ophthalmologist', /\bophthalmologist\b|\bophthalmology\b/i],
            ['Radiation Oncologist', /\bradiation oncologist\b|\bradiation oncology\b/i],
            ['Radiologist', /\bradiologist\b|\bradiology\b|\bdiagnostic imaging\b/i],
            ['Surgeon', /\bsurgeon\b|\bsurgery\b/i]
        ];
        const positions = [];

        if (hasMedicalDirector) {
            positions.push('Medical Director');
            for (const [position, pattern] of generalPracticeRules) {
                if (pattern.test(source) && !positions.includes(position)) {
                    positions.push(position);
                }
            }
            return positions;
        }

        for (const [position, pattern] of positionRules) {
            if (pattern.test(source) && !positions.includes(position)) {
                if (position === 'Medical Oncologist' && /\bradiation oncolog/i.test(source)) continue;
                if (position === 'Radiologist' && /\bradiation oncolog/i.test(source)) continue;
                if (position === 'Surgeon' && /\bneuro(?:logy|surgeon)\b/i.test(source)) continue;
                if (position === 'Dental Specialist' && /\bassistant\b/i.test(source)) continue;
                positions.push(position);
            }
        }

        return positions;
    }

    function extractHospitalFromOpeningRole(text = '') {
        const source = (text || '').replace(/\u00a0/g, ' ');
        const match = source.match(/\bjoin\s+us\s+as\s+[^.\n]{0,220}?\s+at\s+([^.\n]+?)(?=\.|\s+You|\s+you|$)/i);
        if (!match) return '';

        const hospitals = splitCompoundHospitalNames(match[1]);
        if (hospitals.length > 1) return hospitals.join(' / ');

        return cleanMultiLocationHospitalName(match[1]);
    }

    function hasMentionedSplitHospital(entry = {}) {
        const hospital = entry.hospital || entry.hospitalName || '';
        return !!hospital &&
            isValidExtractedHospitalName(hospital) &&
            !isFallbackHospitalName(hospital) &&
            !isGenericOrganizationHospitalName(hospital) &&
            !isLocationOnlyHospitalName(hospital, entry.location, entry.city, entry.state);
    }

    function extractMultiplePositionEntries(text, originalJob = {}, fallbackTitle = '') {
        const openingRoleText = ((text || '').match(/\bjoin\s+us\s+as[\s\S]{0,300}/i) || [''])[0];
        const roleText = `${fallbackTitle || ''} ${openingRoleText}`;
        const positions = extractApprovedMultiPositions(roleText);
        if (positions.length < 2) return [];

        const loc = getEntryLocationFromJob(originalJob, text);
        if (!loc) return [];

        const hospital = extractHospitalFromOpeningRole(text);
        if (!hasMentionedSplitHospital({ ...loc, hospital })) return [];

        return positions.map(position => ({
            city: loc.city,
            state: loc.state,
            location: loc.location,
            title: position,
            hospital,
            streetAddress: loc.streetAddress || '',
            zipCode: loc.zipCode || ''
        }));
    }

    function getSplitEntryPositionKey(entry = {}, fallbackTitle = '') {
        const title = entry.title || fallbackTitle || '';
        return getPositionFromTitle(title) ||
            getPositionFromDescription(title) ||
            normalizeSplitRoleTitle(title, fallbackTitle) ||
            title;
    }

    function getSplitEntryHospitalKey(entry = {}) {
        return normalizeHospitalNameForCompare(entry.hospital || entry.hospitalName || '');
    }

    function splitEntriesRepresentSameJob(existing = {}, entry = {}) {
        const existingLocation = parseLocationParts(existing.location || '');
        const entryLocation = parseLocationParts(entry.location || '');
        const existingCity = existing.city || existingLocation.city || '';
        const entryCity = entry.city || entryLocation.city || '';
        const existingState = existing.state || existingLocation.state || '';
        const entryState = entry.state || entryLocation.state || '';
        const samePosition = normalizeSimpleText(getSplitEntryPositionKey(existing)) ===
            normalizeSimpleText(getSplitEntryPositionKey(entry));
        const sameCity = normalizeCityForCompare(existingCity) === normalizeCityForCompare(entryCity);
        const sameState = normalizeSimpleText(getFullStateName(existingState)) ===
            normalizeSimpleText(getFullStateName(entryState));
        const existingHospital = getSplitEntryHospitalKey(existing);
        const entryHospital = getSplitEntryHospitalKey(entry);
        const sameOrIncompleteHospital = !existingHospital || !entryHospital || existingHospital === entryHospital;

        return samePosition && sameCity && sameState && sameOrIncompleteHospital;
    }

    function mergeSplitEntry(existing, entry) {
        if (!existing.title && entry.title) existing.title = entry.title;
        if (!existing.city && entry.city) existing.city = entry.city;
        if (!existing.state && entry.state) existing.state = entry.state;
        if (!existing.location && entry.location) existing.location = entry.location;
        if (!existing.streetAddress && entry.streetAddress) existing.streetAddress = entry.streetAddress;
        if (!existing.zipCode && entry.zipCode) existing.zipCode = entry.zipCode;

        const currentHospital = normalizeSimpleText(existing.hospital || '');
        const nextHospital = normalizeSimpleText(entry.hospital || '');
        if (!existing.hospital && entry.hospital) {
            existing.hospital = entry.hospital;
        } else if (entry.hospital && currentHospital && nextHospital && currentHospital !== nextHospital) {
            existing.hospital = `${existing.hospital} / ${entry.hospital}`;
        }
    }

    function dedupeMultiLocationEntries(entries) {
        const unique = [];

        for (const entry of entries) {
            const locationParts = parseLocationParts(entry.location || '');
            const city = entry.city || locationParts.city || '';
            const state = entry.state || locationParts.state || '';
            const normalizedEntry = {
                ...entry,
                city: formatCityForStorage(city),
                state: formatStateForStorage(state),
                location: entry.location || [city, state].filter(Boolean).join(', ')
            };

            const existingEntry = unique.find(current => splitEntriesRepresentSameJob(current, normalizedEntry));
            if (existingEntry) {
                mergeSplitEntry(existingEntry, normalizedEntry);
                continue;
            }

            unique.push(normalizedEntry);
        }

        return unique;
    }

    function extractMultiLocationEntries(text, originalJob = {}) {
        const fallbackTitle = originalJob.title || '';
        const structuredEntries = extractStructuredLocationEntries(text, fallbackTitle);
        const compoundHospitalEntries = extractCompoundHospitalEntries(text, originalJob, fallbackTitle);

        const entries = structuredEntries.length > 1
            ? structuredEntries
            : (compoundHospitalEntries.length > 1 ? compoundHospitalEntries : structuredEntries);

        const dedupedEntries = dedupeMultiLocationEntries(entries)
            .filter(hasMentionedSplitHospital);

        return dedupedEntries.length > 1 ? dedupedEntries : [];
    }

    function buildSplitDescription(originalDescription, splitJob, baseJobId) {
        const lines = [
            '=== JOB INFO ===',
            `Title: ${splitJob.title || ''}`,
            `Location: ${splitJob.location || ''}`,
            `Job ID: ${splitJob.jobId || ''}`,
            `Source Job ID: ${baseJobId || ''}`,
            `Job Type: ${splitJob.jobType || ''}`,
            '',
            '=== JOB DESCRIPTION ===',
            `Hospital: ${splitJob.hospital || ''}`,
            `Address: ${splitJob.streetAddress || ''}`,
            `Location: ${splitJob.location || ''}`
        ];

        if (splitJob.position) lines.push(`Position: ${splitJob.position}`);
        if (splitJob.areaOfPractice) lines.push(`Area of Practice: ${splitJob.areaOfPractice}`);
        if (splitJob.salary) lines.push(`Salary: ${splitJob.salary}`);
        if (splitJob.experience) lines.push(`Experience: ${splitJob.experience}`);

        if (originalDescription) {
            lines.push('', '=== SOURCE JOB DESCRIPTION ===', originalDescription);
        }

        return lines.filter(line => line !== null && line !== undefined).join('\n').trim();
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

    function addressMatchesExpectedHospitalBrand(hospitalName, addressData, location = '') {
        const expectedHospital = stripMatchingLocationPhraseFromHospitalName(hospitalName, location);
        const expected = normalizeSimpleText(expectedHospital);
        const actual = normalizeSimpleText(addressData?.businessName || '');
        const website = addressData?.website || '';

        if (isLivewellHospital(hospitalName)) {
            if (website) return isLivewellWebsite(website);
            return false;
        }

        if (/^vca\b/i.test(hospitalName || '') && website) {
            try {
                const host = new URL(website).hostname.replace(/^www\./i, '').toLowerCase();
                if (host && !host.includes('vcahospitals.com') && !host.includes('vca.com')) return false;
            } catch (_) {
                // Ignore unparsable website labels from Maps.
            }
        }

        if (!expected || !actual) return true;

        const weakWords = new Set(['vca', 'the', 'and', 'animal', 'pet', 'veterinary', 'hospital', 'clinic', 'center', 'centre', 'care', 'emergency', 'specialty', 'specialists', 'medical']);
        const expectedWords = removeLocationWordsWhenSafe(
            expected.split(' ').filter(word => word.length > 2 && !weakWords.has(word)),
            location
        );
        if (expectedWords.length === 0) return true;

        const matches = expectedWords.filter(word => actual.includes(word)).length;
        return matches / expectedWords.length >= 0.5;
    }

    function isVcaAddressResult(addressData = {}) {
        const businessName = addressData.businessName || addressData.hospitalName || '';
        if (/^vca\b/i.test(businessName)) return true;

        try {
            const host = new URL(addressData.website || '').hostname.replace(/^www\./i, '').toLowerCase();
            return host.includes('vcahospitals.com') || host.includes('vca.com');
        } catch (_) {
            return false;
        }
    }

    function getCityPracticalVariants(value) {
        const raw = normalizeSimpleText(value);
        if (!raw) return new Set();

        const variants = new Set();
        const add = (candidate) => {
            const clean = normalizeCityForCompare(candidate || '');
            if (clean) variants.add(clean);
        };

        add(raw);
        add(raw
            .replace(/\btownship\b/g, ' ')
            .replace(/\btwp\b/g, ' ')
            .replace(/\bborough\b/g, 'boro')
            .replace(/\bboro\b/g, 'boro')
            .replace(/\bvillage\b/g, ' ')
            .replace(/\bmunicipality\b/g, ' ')
            .replace(/\bcity\b/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
        );
        add(raw.replace(/\be\b/g, 'east').replace(/\bw\b/g, 'west').replace(/\bn\b/g, 'north').replace(/\bs\b/g, 'south'));
        add(raw.replace(/\beast\b/g, 'e').replace(/\bwest\b/g, 'w').replace(/\bnorth\b/g, 'n').replace(/\bsouth\b/g, 's'));
        add(raw.replace(/boro/g, 'borough'));
        add(raw.replace(/borough/g, 'boro'));

        return variants;
    }

    function citiesPracticallyMatch(expectedCity, resultCity) {
        const expectedVariants = getCityPracticalVariants(expectedCity);
        const resultVariants = getCityPracticalVariants(resultCity);
        if (expectedVariants.size === 0 || resultVariants.size === 0) return false;

        for (const expected of expectedVariants) {
            for (const result of resultVariants) {
                if (expected === result) return true;
                if (expected.length >= 8 && result.endsWith(expected)) return true;
                if (result.length >= 8 && expected.endsWith(result)) return true;
            }
        }

        return false;
    }

    function getHospitalAliasTokens(value) {
        const aliases = [];
        const source = value || '';
        const parenPattern = /\(([A-Z0-9&\s]{2,20})\)/g;
        let match;
        while ((match = parenPattern.exec(source)) !== null) {
            const alias = normalizeSimpleText(match[1]);
            if (alias) aliases.push(alias);
        }

        const words = source
            .replace(/\([^)]*\)/g, ' ')
            .split(/\s+/)
            .map(word => word.replace(/[^A-Za-z]/g, ''))
            .filter(word => /^[A-Z][A-Za-z]+$/.test(word))
            .filter(word => !/^(VCA|Animal|Veterinary|Hospital|Emergency|Specialty|Center|Care|Clinic|Medical|The|And|Of|In)$/i.test(word));

        if (words.length >= 3) {
            aliases.push(normalizeSimpleText(words.map(word => word[0]).join('')));
        }

        return aliases.filter(Boolean);
    }

    function hospitalAliasMatches(expectedHospital, addressHospital) {
        const actual = normalizeSimpleText(addressHospital || '');
        if (!actual) return false;
        return getHospitalAliasTokens(expectedHospital).some(alias => alias.length >= 3 && actual.includes(alias));
    }

    function getMeaningfulHospitalNameWords(value) {
        const weakWords = new Set([
            'vca', 'the', 'and', 'animal', 'animals', 'pet', 'pets', 'veterinary',
            'veterinarian', 'veterinarians', 'hospital', 'hospitals', 'clinic',
            'center', 'centre', 'care', 'emergency', 'specialty', 'specialists',
            'medical', 'referral', 'services', 'service', 'california', 'arizona',
            'texas', 'florida', 'nevada', 'washington', 'oregon', 'new', 'york',
            'north', 'south', 'carolina', 'virginia', 'pennsylvania', 'georgia'
        ]);

        return normalizeSimpleText(value)
            .split(' ')
            .filter(word => word.length > 2 && !weakWords.has(word));
    }

    function getLocationWordsForHospitalMatch(location = '') {
        const locationParts = parseLocationParts(location || '');
        const stateFull = getFullStateName(locationParts.state || '');
        const stateAbbr = getStateAbbreviation(locationParts.state || '');
        return new Set([
            ...getMeaningfulHospitalNameWords(locationParts.city || ''),
            ...getMeaningfulHospitalNameWords(stateFull || ''),
            ...getMeaningfulHospitalNameWords(stateAbbr || '')
        ]);
    }

    function removeLocationWordsWhenSafe(words = [], location = '') {
        const locationWords = getLocationWordsForHospitalMatch(location);
        if (locationWords.size === 0) return words;

        const withoutLocation = words.filter(word => !locationWords.has(word));
        return withoutLocation.length > 0 ? withoutLocation : words;
    }

    function stripMatchingLocationPhraseFromHospitalName(hospitalName = '', location = '') {
        let clean = cleanExtractedHospitalName(hospitalName || '')
            .replace(/\s*\((?:formerly|previously|aka|also known as)[^)]+\)\s*/ig, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const locationParts = parseLocationParts(location || '');
        const city = (locationParts.city || '').trim();
        const state = (locationParts.state || '').trim();
        if (!clean || (!city && !state)) return clean;

        const suffixes = [];
        if (city) suffixes.push(city);
        if (state) suffixes.push(state, getFullStateName(state), getStateAbbreviation(state));
        if (city && state) {
            suffixes.push(
                `${city}, ${state}`,
                `${city}, ${getFullStateName(state)}`,
                `${city} ${getStateAbbreviation(state)}`
            );
        }

        for (const suffix of suffixes.filter(Boolean)) {
            const pattern = new RegExp(`\\s+(?:in|at|near|outside\\s+of)\\s+${escapeRegex(suffix)}\\s*$`, 'i');
            const withoutSuffix = clean.replace(pattern, '').trim();
            if (withoutSuffix !== clean && looksLikeCompleteHospitalName(withoutSuffix)) {
                return withoutSuffix.replace(/[\s,;:.!-]+$/, '').trim();
            }
        }

        if (city) {
            const cityPattern = escapeRegex(city);
            const locationTailPattern = new RegExp(`\\s+(?:in|at|near|outside\\s+of)\\s+${cityPattern}(?:\\s*,?\\s+[^,;.]*)?$`, 'i');
            const withoutTail = clean.replace(locationTailPattern, '').trim();
            if (withoutTail !== clean && withoutTail.length >= 6) {
                return withoutTail.replace(/[\s,;:.!-]+$/, '').trim();
            }
        }

        return clean;
    }

    function isShortVcaLocationName(hospitalName = '', location = '') {
        const current = stripMatchingLocationPhraseFromHospitalName(hospitalName, location);
        const words = getMeaningfulHospitalNameWords(current);
        return /^vca\b/i.test(current) && words.length === 1;
    }

    function extractHospitalNameLocationPhrase(hospitalName = '') {
        const match = cleanExtractedHospitalName(hospitalName || '').match(/\s+(?:in|at|near|outside\s+of)\s+([^,;.()]+)(?:\s*,\s*[^;.()]+)?$/i);
        return match ? match[1].trim() : '';
    }

    function getHospitalNameUpdateScore(currentHospital, candidateHospital, location = '') {
        const current = stripMatchingLocationPhraseFromHospitalName(currentHospital || '', location);
        const candidate = cleanHospitalNameFromAddressLookup(candidateHospital);
        if (!current || !candidate) return 0;

        const currentComparable = normalizeSimpleText(current);
        const candidateComparable = normalizeSimpleText(candidate);
        if (currentComparable && currentComparable === candidateComparable) return 100;
        if (
            currentComparable.length >= 12 &&
            candidateComparable.length >= 12 &&
            (currentComparable.includes(candidateComparable) || candidateComparable.includes(currentComparable))
        ) {
            return 100;
        }

        const candidateWords = new Set(getMeaningfulHospitalNameWords(candidate));
        if (candidateWords.size === 0) return 0;

        let expectedWords = getMeaningfulHospitalNameWords(current);
        if (isFallbackHospitalName(currentHospital)) {
            const locationParts = parseLocationParts(location || '');
            const cityWords = getMeaningfulHospitalNameWords(locationParts.city || '');
            if (cityWords.length > 0) expectedWords = cityWords;
        }

        expectedWords = removeLocationWordsWhenSafe(expectedWords, location);

        if (expectedWords.length === 0) return 0;
        if (/^vca\b/i.test(currentHospital || '') && !/^vca\b/i.test(candidateHospital || '')) return 0;

        const matchedWords = expectedWords.filter(word => candidateWords.has(word)).length;
        return Math.round((matchedWords / expectedWords.length) * 100);
    }

    function getAddressHospitalNameCandidate(addressData = {}) {
        return cleanHospitalNameFromAddressLookup(addressData.businessName || addressData.hospitalName || '');
    }

    function getAddressResultState(addressData = {}) {
        return getStateAbbreviation(addressData.state || extractStateFromAddressText(addressData.fullAddress || addressData.streetAddress || ''));
    }

    function extractCityFromFullAddress(text = '') {
        const match = String(text || '').match(/,\s*([^,]+?),\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?/i);
        return match ? match[1].trim() : '';
    }

    function addressResultMatchesState(addressData = {}, expectedState = '') {
        const expected = getStateAbbreviation(expectedState);
        if (!expected) return true;

        const actual = getAddressResultState(addressData);
        if (actual) return actual === expected;

        const zip = addressData.zipCode || extractZipFromAddressText(addressData.fullAddress || addressData.streetAddress || '');
        return !!zip && zipMatchesState(zip, expected);
    }

    function addressResultPassesRescue(job = {}, addressData = {}, searchLocation = '') {
        if (!addressData || !(addressData.streetAddress || addressData.zipCode || addressData.fullAddress)) return false;
        if (!isVcaAddressResult(addressData)) return false;

        const expectedLocation = parseLocationParts(searchLocation || job.location || '');
        if (!addressResultMatchesState(addressData, expectedLocation.state || job.state || '')) return false;

        const parsedCity = extractCityFromFullAddress(addressData.fullAddress || addressData.streetAddress || '');
        const resultCity = addressData.city || parsedCity || '';
        const expectedCity = expectedLocation.city || job.city || '';
        const hospitalLocationPhrase = extractHospitalNameLocationPhrase(job.hospital || job.hospitalName || '');
        const hospitalLocationMatchesResult = hospitalLocationPhrase && resultCity && citiesPracticallyMatch(hospitalLocationPhrase, resultCity);
        const cityOk = !expectedCity || !resultCity || citiesPracticallyMatch(expectedCity, resultCity) || hospitalLocationMatchesResult;

        const candidateHospital = getAddressHospitalNameCandidate(addressData);
        const scoreLocation = hospitalLocationMatchesResult
            ? [hospitalLocationPhrase, expectedLocation.state || job.state || ''].filter(Boolean).join(', ')
            : (searchLocation || job.location || '');
        const nameScore = getHospitalNameUpdateScore(job.hospital || job.hospitalName || '', candidateHospital, scoreLocation);
        const aliasOk = hospitalAliasMatches(job.hospital || job.hospitalName || '', candidateHospital);
        const shortVcaLocationOk = isShortVcaLocationName(job.hospital || job.hospitalName || '', searchLocation || job.location || '') &&
            cityOk &&
            normalizeSimpleText(candidateHospital || '').startsWith('vca');

        return (cityOk && (nameScore >= 80 || aliasOk || shortVcaLocationOk)) ||
            (aliasOk && addressResultMatchesState(addressData, expectedLocation.state || job.state || ''));
    }

    function getLivewellFallbackAddress() {
        return {
            streetAddress: 'Not Available',
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
            businessName: 'VCA',
            streetAddress: 'Not Available',
            zipCode: '00000',
            city: '',
            state: '',
            fullAddress: '',
            website: 'https://vcahospitals.com/',
            phone: ''
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
        'Urgent Care': ['Associate Veterinarian', 'Medical Director', 'Partner Veterinarian']
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

    function hasExplicitEmergencyTitle(title = '') {
        return /\bemergency\s+(?:veterinarian|vet|dvm)\b|\ber\s+(?:veterinarian|vet|dvm)\b/i.test(title || '');
    }

    function hasUrgentCareSignal(title, hospitalName = '', extraText = '') {
        const titleText = title || '';
        if (hasExplicitEmergencyTitle(titleText) && !URGENT_CARE_SIGNAL_PATTERN.test(titleText)) {
            return false;
        }
        return URGENT_CARE_SIGNAL_PATTERN.test(`${titleText} ${hospitalName || ''} ${extraText || ''}`);
    }

    function hasEmergencySignal(title, hospitalName = '', extraText = '') {
        if (hasUrgentCareSignal(title, hospitalName, extraText)) return false;
        return EMERGENCY_SIGNAL_PATTERN.test(`${title || ''} ${hospitalName || ''} ${extraText || ''}`);
    }

    function hasSpecialtyEccSignal(title = '', description = '', hospitalName = '') {
        if (!hasSpecialtyTrainingSignal(description)) return false;

        const titleText = title || '';
        if (/\b(?:criticalist|ecc specialist|emergency medicine|dacvecc)\b/i.test(titleText)) return true;
        if (hasExplicitEmergencyTitle(titleText) && /\b(?:emergency\s*(?:&|and)\s*critical\s*care|critical\s*care|dacvecc|ecc)\b/i.test(description || '')) {
            return true;
        }

        const openingRoleText = ((description || '').match(/\bjoin\s+us\s+as[\s\S]{0,300}/i) || [''])[0];
        return /\b(?:criticalist|ecc specialist|emergency\s*(?:&|and)\s*critical\s*care specialist|dacvecc)\b/i.test(openingRoleText);
    }

    function isMedicalDirectorRole(title = '', description = '') {
        if (/\bmedical director\b/i.test(title || '')) return true;

        const text = description || '';
        return /\bTitle:\s*[^\n]*\bmedical director\b/i.test(text) ||
            /\bjoin\s+us\s+as\b[\s\S]{0,240}\bmedical director\b/i.test(text);
    }

    function hasSpecialtyMedicalDirectorRequirement(title = '', description = '') {
        const roleText = `${title || ''} ${(description || '').slice(0, 1800)}`;
        if (!/\bmedical director\b/i.test(roleText)) return false;
        if (/\bspecialty\s+medical\s+director\b/i.test(roleText)) return true;
        if (hasSpecialtyTrainingSignal(description)) return true;

        const requiredSpecialtyPattern = /\b(?:board[-\s]+certified|residency[-\s]+trained|residential[-\s]+trained|diplomate|dacv(?:ecc|im|r|s|d|o|aa)?|dacvr[-\s]?ro|davdc|dabvp)\b/i;
        const optionalPattern = /\b(?:open to|preferred|a plus|plus but not required|not required|interested in|welcome|consider|considering|ideal|bonus)\b/i;
        const mdNearRequirement = /\bmedical director\b[\s\S]{0,240}\b(?:board[-\s]+certified|residency[-\s]+trained|residential[-\s]+trained|diplomate|dacv(?:ecc|im|r|s|d|o|aa)?|dacvr[-\s]?ro|davdc|dabvp)\b|\b(?:board[-\s]+certified|residency[-\s]+trained|residential[-\s]+trained|diplomate|dacv(?:ecc|im|r|s|d|o|aa)?|dacvr[-\s]?ro|davdc|dabvp)\b[\s\S]{0,240}\bmedical director\b/i;
        return requiredSpecialtyPattern.test(roleText) && mdNearRequirement.test(roleText) && !optionalPattern.test(roleText);
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
            ['DABVP Specialist', [/\bdabvp\b/i, /\b(?:avian|exotics?|zoo med|zoological medicine)\b/i]],
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
        if (/\b(?:avian|exotics?|zoo med|zoological medicine)\b/.test(t)) return 'DABVP Specialist';
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
        if (/\bspecialty\s+(?:veterinarian|vet|doctor|dvm)\b/.test(t)) return 'Specialty Care';
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
            const isHourly = /\b(?:per\s+(?:hour|hr)|hourly|hour|hr)\b|\/hr\b/i.test(raw);
            const isShift = /\b(?:per\s+shift|shift)\b|\/shift\b/i.test(raw);
            const amounts = [];
            let hasThousandsSuffix = false;
            const amountRegex = /\$?\s*([\d,]+(?:\.\d{2})?)\s*(?:\/?\s*k)?\b/gi;
            let match;
            while ((match = amountRegex.exec(raw)) !== null) {
                let num = parseFloat(match[1].replace(/,/g, ''));
                if (/\/?\s*k\b/i.test(match[0])) {
                    hasThousandsSuffix = true;
                    num = num * 1000;
                }
                if (num > 0) amounts.push(num);
            }
            if (amounts.length === 0) return raw;
            if (hasThousandsSuffix) {
                for (let i = 0; i < amounts.length; i++) {
                    if (amounts[i] < 1000) amounts[i] = amounts[i] * 1000;
                }
            }
            if (amounts.length >= 2 && amounts.some(amount => amount >= 1000)) {
                for (let i = 0; i < amounts.length; i++) {
                    if (amounts[i] < 1000) amounts[i] = amounts[i] * 1000;
                }
            }
            if (!isHourly && !isShift && amounts.length >= 2 && amounts.every(amount => amount >= 50 && amount < 1000)) {
                for (let i = 0; i < amounts.length; i++) {
                    amounts[i] = amounts[i] * 1000;
                }
            }
            const fmt = (n) => {
                if (Number.isInteger(n)) return '$' + n.toLocaleString('en-US');
                return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            };
            const unit = isHourly ? 'per hour' : (isShift ? 'per shift' : 'per year');
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
            const salaryPatterns = [
                /(?:salary|compensation|pay)\s+ranges?\s+from\s+\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s*(?:to|[-\u2013\u2014])\s+\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?(?:\s*(?:\/shift|per\s+shift|per\s+year|annually|per\s+hour|\/hr))?/i,
                /(?:annual\s+)?(?:salary|compensation|pay)\s+(?:range\s+)?(?:for\s+this\s+position\s+)?(?:is|starts?\s+at|starting\s+at|from)\s+\$[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?\s*(?:to|[-\u2013\u2014])\s+\$?[\d,]+(?:\.\d{2})?\s*(?:\/k|k)?(?:\s*(?:\/shift|per\s+shift|per\s+year|annually|per\s+hour|\/hr))?/i,
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
            if (hasSpecialtyMedicalDirectorRequirement(positionText, descriptionText)) return 'Specialty Care';
            if (hasUrgentCareSignal(title, hospitalName, department)) return 'Urgent Care';
            if (/\b(?:oncologist|cardiologist|neurologist|neurosurgeon|dermatologist|ophthalmologist|anesthesiologist|theriogenologist|radiologist|internist|criticalist|ecc specialist|oncology|cardiology|neurology|dermatology|ophthalmology|anesthesia|theriogenology|radiology)\b/i.test(title)) return 'Specialty Care';
            if (hasSpecialtyEccSignal(title, descriptionText, hospitalName)) return 'Specialty Care';
            if (hasEmergencySignal(title, hospitalName, department)) return 'Emergency Care';
            if (hasSpecialtyTrainingSignal(descriptionText)) return 'Specialty Care';
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
            if (/\bspecialty\s+(?:veterinarian|vet|doctor|dvm)\b/.test(title)) return 'Specialty Care';
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
                'Urgent Care': ['Associate Veterinarian', 'Medical Director', 'Partner Veterinarian'],
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
            if (areaOfPractice === 'Specialty Care' &&
                !isMedicalDirectorRole(positionText, descriptionText) &&
                hasSpecialtyEccSignal(positionText, descriptionText)) {
                return 'ECC Specialist';
            }

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
        // Rules: "part time or full time" / "full time or part time" → Full time
        //        only "part time" / "part-time" mentioned → Part time
        //        nothing mentioned or only "full time" → Full time (default)
        function extractJobType(text) {
            if (!text) return 'Full time';
            const lower = text.toLowerCase();

            // First check the structured Employment Type / Job Type fields.
            const empType = getMetadataField(text, ['Employment Type', 'Job Type']).toLowerCase();
            if (empType) {
                // "Part Time or Full Time" → Full time (both mentioned = full time)
                if (empType.includes('part') && empType.includes('full')) return 'Full time';
                // "Part time" or "Part Time" only → Part time
                if (empType.includes('part')) return 'Part time';
                // "Full time" or anything else → Full time
                return 'Full time';
            }

            // Fallback: check the description body text
            const hasPartTime = /\bpart[\s-]?time\b/i.test(lower);
            const hasFullTime = /\bfull[\s-]?time\b/i.test(lower);

            // Both mentioned → Full time
            if (hasPartTime && hasFullTime) return 'Full time';
            // Only part time mentioned → Part time
            if (hasPartTime) return 'Part time';
            // Only full time or nothing mentioned → Full time
            return 'Full time';
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
                .filter(line => /\b(?:experience|experienced|minimum|min\.?|at least|required|requires|requirements?|qualifications?|practice setting|years in practice|residency|completion)\b/i.test(line))
                .filter(line => !/\b(?:our team has|team has|hospital has|practice has|support staff|staff longevity|team longevity|combined experience|doctor team|seasoned veterinarians|over\s+\d+\s+years of experience|years of experience in specialty and emergency services|doctors with experience from|serving\s+the\s+community|established|we offer|benefits|medical(?:,\s*|\s+)dental)\b/i.test(line));

            const patterns = [
                new RegExp(`\\b(\\d+)\\s*[-–—]\\s*(\\d+)\\s*${yearToken}\\s+(?:of\\s+)?experience\\b`, 'i'),
                new RegExp(`\\b(\\d+)\\s+to\\s+(\\d+)\\s*${yearToken}\\s+(?:of\\s+)?experience\\b`, 'i'),
                new RegExp(`\\bexperience\\s+(?:should\\s+be|must\\s+be|is|of|required(?:\\s+is)?|requires|:)?\\s*(\\d+)\\s*[-–—]\\s*(\\d+)\\s*${yearToken}\\b`, 'i'),
                new RegExp(`\\bexperience\\s+(?:should\\s+be|must\\s+be|is|of|required(?:\\s+is)?|requires|:)?\\s*(\\d+)\\s+to\\s+(\\d+)\\s*${yearToken}\\b`, 'i'),
                new RegExp(`\\b(?:minimum|min\\.?|at\\s+least)\\s+(\\d+)\\s*[-–—]\\s*(\\d+)\\s*${yearToken}\\b`, 'i'),
                new RegExp(`\\b(\\d+)\\+?\\s*${yearToken}\\s+(?:of\\s+)?experience\\b`, 'i'),
                new RegExp(`\\bexperience\\s+(?:should\\s+be|must\\s+be|is|of|required(?:\\s+is)?|requires|:)?\\s*(\\d+)\\+?\\s*${yearToken}\\b`, 'i'),
                new RegExp(`\\b(?:minimum|min\\.?|at\\s+least)\\s+(\\d+)\\+?\\s*${yearToken}\\b`, 'i'),
                new RegExp(`\\b(\\d+)\\+?\\s*${yearToken}\\s+(?:in\\s+(?:practice|a\\s+practice\\s+setting)|practice\\s+setting)\\b`, 'i'),
                new RegExp(`\\bplus\\s+(\\d+)\\+?\\s*${yearToken}\\s+of\\s+residency\\s+completion\\b`, 'i')
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

            if (expectedState && !resultState && !zipCode) return false;
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
                const coreName = stripMatchingLocationPhraseFromHospitalName(base, location);

                const withoutLocationSuffix = base.replace(/\s*[-–—]\s*[A-Z][a-zA-Z\s.'-]+$/, '').trim();
                const withoutParens = base.replace(/\s*\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
                const expandedParens = base.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
                const plain = base.replace(/&/g, 'and').replace(/[-–—()]/g, ' ').replace(/\s+/g, ' ').trim();

                names.push(base, coreName, withoutLocationSuffix, withoutParens, expandedParens, plain);

                if (base && !/^vca\b/i.test(base)) {
                    names.push(`VCA ${base}`, `VCA ${coreName}`);
                }

                if (city) {
                    if (isFallbackHospitalName(base) && /^vca\b/i.test(base)) {
                        names.push(
                            `VCA ${city} Animal Hospital`,
                            `VCA ${city} Veterinary Hospital`,
                            `VCA Animal Hospital ${city}`,
                            `VCA Veterinary Hospital ${city}`
                        );
                    }

                    if (/^vca\b/i.test(coreName) && !/\b(?:animal|veterinary|hospital|clinic|center|specialty|specialists|care|emergency)\b/i.test(coreName)) {
                        names.push(
                            `${coreName} Animal Hospital`,
                            `${coreName} Veterinary Hospital`,
                            `${coreName} ${city} Animal Hospital`
                        );
                    }

                    for (const candidate of [coreName, withoutLocationSuffix, withoutParens, plain]) {
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

    async function fetchHospitalNameFromCompleteAddress(addressParts) {
        const fullAddress = buildFullAddressForLookup(addressParts);
        if (!fullAddress) return '';

        try {
            const directResult = await scrapeAddressForBusinessName(fullAddress);
            const directHospital = cleanHospitalNameFromAddressLookup(directResult?.businessName || '');
            if (directHospital) return directHospital;

            const searchResult = await scrapeGoogleSearchForBusinessName(fullAddress);
            const searchHospital = cleanHospitalNameFromAddressLookup(searchResult?.businessName || '');
            if (searchHospital) return searchHospital;

            for (const query of [
                `${fullAddress} veterinary`,
                `${fullAddress} animal hospital`,
                `${fullAddress} veterinarian`
            ]) {
                const mapsResult = await scrapeAddressForBusinessName(query);
                const mapsHospital = cleanHospitalNameFromAddressLookup(mapsResult?.businessName || '');
                if (mapsHospital) return mapsHospital;
            }

            const lookupResult = await fetchAddressFromGoogleMaps(fullAddress, addressParts.location || '', '');
            return cleanHospitalNameFromAddressLookup(lookupResult?.businessName || '');
        } catch (error) {
            console.warn(`Unable to resolve hospital from address "${fullAddress}":`, error);
            return '';
        }
    }

    function scrapeAddressForBusinessName(fullAddress) {
        return new Promise((resolve) => {
            let settled = false;
            let tabId = null;
            let listener = null;

            const empty = () => ({ businessName: '', streetAddress: '', zipCode: '', city: '', state: '', fullAddress: '', website: '', phone: '' });
            const finish = (result) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                if (listener) chrome.tabs.onUpdated.removeListener(listener);
                if (tabId) chrome.tabs.remove(tabId).catch(() => {});
                resolve(result || empty());
            };

            const timeout = setTimeout(() => {
                console.warn(`Google Maps address business lookup timeout for: "${fullAddress}"`);
                finish(empty());
            }, 26000);

            const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(fullAddress)}`;
            chrome.tabs.create({ url: mapsUrl, active: false }, (tab) => {
                if (!tab) {
                    finish(empty());
                    return;
                }

                tabId = tab.id;
                listener = (updatedTabId, info) => {
                    if (updatedTabId !== tabId || info.status !== 'complete') return;

                    chrome.tabs.onUpdated.removeListener(listener);
                    listener = null;
                    setTimeout(() => {
                        if (settled) return;
                        chrome.scripting.executeScript({
                            target: { tabId },
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
                        }).catch((error) => {
                            console.error(`Google Maps address business script error for "${fullAddress}":`, error);
                            finish(empty());
                        });
                    }, 1400);
                };

                chrome.tabs.onUpdated.addListener(listener);
            });
        });
    }

    function scrapeGoogleSearchForBusinessName(fullAddress) {
        return new Promise((resolve) => {
            let settled = false;
            let tabId = null;
            let listener = null;

            const empty = () => ({ businessName: '', streetAddress: '', zipCode: '', city: '', state: '', fullAddress: '', website: '', phone: '' });
            const finish = (result) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                if (listener) chrome.tabs.onUpdated.removeListener(listener);
                if (tabId) chrome.tabs.remove(tabId).catch(() => {});
                resolve(result || empty());
            };

            const timeout = setTimeout(() => {
                console.warn(`Google Search address business lookup timeout for: "${fullAddress}"`);
                finish(empty());
            }, 26000);

            const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(fullAddress)}`;
            chrome.tabs.create({ url: searchUrl, active: false }, (tab) => {
                if (!tab) {
                    finish(empty());
                    return;
                }

                tabId = tab.id;
                listener = (updatedTabId, info) => {
                    if (updatedTabId !== tabId || info.status !== 'complete') return;

                    chrome.tabs.onUpdated.removeListener(listener);
                    listener = null;
                    setTimeout(() => {
                        if (settled) return;
                        chrome.scripting.executeScript({
                            target: { tabId },
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
                        }).catch((error) => {
                            console.error(`Google Search address business script error for "${fullAddress}":`, error);
                            finish(empty());
                        });
                    }, 1600);
                };

                chrome.tabs.onUpdated.addListener(listener);
            });
        });
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
            job.jobId || job.departmentId || getBaseJobId(job) || '',
            job.link || job.url || '',
            job.hospital || job.hospitalName || '',
            job.location || '',
            job.city || '',
            job.state || ''
        ].join('||');
    }

    function findJobIndexByKey(jobs, key, fallbackJob = null) {
        const exactIndex = jobs.findIndex(job => getJobSelectionKey(job) === key);
        if (exactIndex !== -1) return exactIndex;

        if (!fallbackJob) return -1;

        const fallbackBaseId = getBaseJobId(fallbackJob);
        const fallbackLink = fallbackJob.link || fallbackJob.url || '';
        return jobs.findIndex(job => {
            const sameId = fallbackBaseId && getBaseJobId(job) === fallbackBaseId;
            const sameLink = fallbackLink && (job.link === fallbackLink || job.url === fallbackLink);
            return sameId && sameLink;
        });
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

        chrome.storage.local.set({ jobs: allJobs }, () => {
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
        if (!job || !job.description) return;

        descriptionModalTitle.textContent = job.title || 'Job Description';
        descriptionModalMeta.textContent = [
            job.jobId || '',
            job.hospital || '',
            job.location || ''
        ].filter(Boolean).join(' | ') || 'Full scraped description for the selected job.';
        descriptionModalBody.textContent = plainDescriptionText(job.description);
        descriptionModal.classList.remove('hidden');
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

        const editFieldIds = {
            jobType: 'editJobType'
        };

        fieldIds.forEach(field => {
            const input = document.getElementById(editFieldIds[field] || `editJob${field.charAt(0).toUpperCase()}${field.slice(1)}`);
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

        await chrome.storage.local.set({ jobs: allJobs });
        closeEditJobModal();
        renderCurrentView();
        showToast('Job record updated.', 'success');
    }

    function displayRecords(jobs) {
        displayedJobs = jobs;
        tableBody.innerHTML = '';
        updateJobCount(jobs.length);
        const splitParentJobIds = getSplitParentJobIds(allJobs);

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

            if (job.hospitalNameUpdated) {
                row.classList.add('hospital-name-updated-row');
                row.style.backgroundColor = '#d1fae5';
                row.style.borderLeft = '4px solid #10b981';
            } else if (isSplitChildOrParentJob(job, splitParentJobIds)) {
                row.classList.add('multi-location-split-row');
                row.style.backgroundColor = '#fee2e2';
                row.style.borderLeft = '4px solid #dc2626';
            } else if (job.isNewLocation) {
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
            row.insertCell(5).textContent = job.aggregator || 'VCA Animal Hospitals (Parent Client)';
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
                const viewDescriptionBtn = document.createElement('button');
                viewDescriptionBtn.type = 'button';
                viewDescriptionBtn.className = 'btn btn-secondary description-action';
                viewDescriptionBtn.textContent = 'View Description';
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

    function getExportRowStyle(job, splitParentJobIds) {
        if (job.hospitalNameUpdated) {
            return { background: '#d1fae5', border: '#10b981' };
        }

        if (isSplitChildOrParentJob(job, splitParentJobIds)) {
            return { background: '#fee2e2', border: '#dc2626' };
        }

        if (job.isNewLocation) {
            return { background: '#d1fae5', border: '#10b981' };
        }

        return null;
    }

    function escapeExcelHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function buildExcelCell(value, rowStyle, isFirstCell = false) {
        const baseStyle = 'border:1px solid #d9e2ec;padding:6px;vertical-align:top;white-space:pre-wrap;mso-number-format:"\\@";';
        const colorStyle = rowStyle ? `background-color:${rowStyle.background};` : '';
        const borderStyle = rowStyle && isFirstCell ? `border-left:4px solid ${rowStyle.border};` : '';
        return `<td style="${baseStyle}${colorStyle}${borderStyle}">${escapeExcelHtml(value)}</td>`;
    }

    function exportToCSV() {
        if (!allJobs || allJobs.length === 0) {
            showToast('No jobs to export!', 'error');
            return;
        }

        const headers = ['#', 'Job Title', 'Job ID', 'Hospital', 'Aggregator', 'Street Address', 'City', 'State', 'Zip Code', 'Phone', 'Website', 'Location', 'Area of Practice', 'Position', 'Salary', 'Job Type', 'Experience', 'Link', 'Description'];
        const splitParentJobIds = getSplitParentJobIds(allJobs);
        const headerStyle = 'border:1px solid #174c6f;padding:7px;background-color:#1f5f83;color:#ffffff;font-weight:bold;white-space:nowrap;';
        const rows = allJobs.map((job, index) => {
            const rowStyle = getExportRowStyle(job, splitParentJobIds);
            const values = [
                index + 1,
                job.title || '',
                job.jobId || '',
                job.hospital || '',
                job.aggregator || 'VCA Animal Hospitals (Parent Client)',
                job.streetAddress || '',
                job.city || '',
                job.state || '',
                job.zipCode || '',
                job.phone || '',
                job.website || '',
                job.location || '',
                job.areaOfPractice || '',
                job.position || '',
                job.salary || '',
                job.jobType || '',
                job.experience || '',
                job.link || '',
                job.description || ''
            ];

            return `<tr>${values.map((value, cellIndex) => buildExcelCell(value, rowStyle, cellIndex === 0)).join('')}</tr>`;
        }).join('');
        const headerRow = `<tr>${headers.map(header => `<th style="${headerStyle}">${escapeExcelHtml(header)}</th>`).join('')}</tr>`;
        const legend = [
            '<p><strong>Row color legend:</strong> Green = hospital name updated or new location, Red = parent/child rows created from split job logic.</p>'
        ].join('');
        const excelContent = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
body { font-family: Arial, sans-serif; font-size: 12px; }
table { border-collapse: collapse; }
</style>
</head>
<body>
${legend}
<table>
${headerRow}
${rows}
</table>
</body>
</html>`;

        const blob = new Blob(['\ufeff', excelContent], { type: 'application/vnd.ms-excel;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);

        link.setAttribute('href', url);
        link.setAttribute('download', `vca_jobs_${new Date().toISOString().split('T')[0]}.xls`);
        link.style.visibility = 'hidden';

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        URL.revokeObjectURL(url);

        showToast(`Exported ${allJobs.length} jobs with row colors!`, 'success');
    }

    // Initialize
    chrome.storage.local.get(['jobs'], (result) => {
        allJobs = normalizeJobRecords(result.jobs || []);
        chrome.storage.local.set({ jobs: allJobs });
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

    // Export Excel-compatible file so row colors are preserved.
    if (exportCsvButton) {
        const exportButtonLabel = Array.from(exportCsvButton.childNodes).find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
        if (exportButtonLabel) {
            exportButtonLabel.textContent = ' Export Excel';
        }
        exportCsvButton.title = 'Export an Excel-compatible file with row colors';
        exportCsvButton.addEventListener('click', exportToCSV);
    }

    // Clear only the columns populated by Fetch Details.
    const clearDetailsBtn = document.getElementById('clearDetailsBtn');
    clearDetailsBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all fetched details? This will remove Hospital, Area of Practice, Position, Salary, and Experience from all jobs.')) {
            chrome.storage.local.get(['jobs'], (data) => {
                const jobs = normalizeJobRecords(data.jobs || []);
                let clearedCount = 0;

                jobs.forEach(job => {
                    if (job.hospital || job.hospitalName || job.areaOfPractice || job.position || job.salary || job.experience) {
                        job.hospital = '';
                        job.hospitalName = '';
                        job.areaOfPractice = '';
                        job.position = '';
                        job.salary = '';
                        job.experience = '';
                        clearedCount++;
                    }
                });

                chrome.storage.local.set({ jobs: jobs }, () => {
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
            chrome.storage.local.get(['jobs'], (data) => {
                const jobs = normalizeJobRecords(data.jobs || []);
                let clearedCount = 0;

                jobs.forEach(job => {
                    if (job.description) {
                        job.description = '';
                        clearedCount++;
                    }
                });

                chrome.storage.local.set({ jobs: jobs }, () => {
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
            chrome.storage.local.get(['jobs'], (data) => {
                const jobs = normalizeJobRecords(data.jobs || []);
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

                chrome.storage.local.set({ jobs: jobs }, () => {
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
                jobs: [],
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

        const result = await chrome.storage.local.get(['jobs']);
        const jobs = normalizeJobRecords(result.jobs || []);

        if (jobs.length === 0) {
            showToast('No job records to send.', 'error');
            return;
        }

        const jobsToSend = jobs.map(job => ({
            job_title: job.title,
            job_id: job.jobId || '',
            department_id: job.jobId || '',
            hospital: job.hospital,
            aggregator: job.aggregator || "VCA Animal Hospitals (Parent Client)",
            street_address: job.streetAddress || '',
            parent_client: job.aggregator || "VCA Animal Hospitals (Parent Client)",
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
                source: 'VCA Jobs Scraper',
                parentClientName: 'VCA Animal Hospitals (Parent Client)',
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

        const data = await chrome.storage.local.get(['jobs']);
        const jobs = normalizeJobRecords(data.jobs || []);

        const jobsToProcess = jobs
            .map((job, index) => ({ job, index, key: getJobSelectionKey(job) }))
            .filter(item => item.job.link || item.job.url);

        if (jobsToProcess.length === 0) {
            showToast('No jobs with links found.', 'error');
            return;
        }

        isGettingDescriptions = true;
        currentJobIndex = 0;
        nextDescriptionQueueIndex = 0;
        activeDescriptionRequests = 0;
        descriptionCompletedCount = 0;
        descriptionQueue = jobsToProcess;

        getDescriptionsBtn.disabled = true;
        getDescriptionsBtn.textContent = 'Getting Descriptions...';

        // Show progress
        const progressSection = document.getElementById('progressSection');
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        const progressLabel = document.getElementById('progressLabel');
        progressSection.classList.remove('hidden');
        progressLabel.textContent = 'Getting Job Info';
        progressText.textContent = `0 / ${descriptionQueue.length}`;
        progressBar.style.width = '0%';

        processNextJob();
    });

    function updateDescriptionProgress() {
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        const total = descriptionQueue.length || 1;
        currentJobIndex = descriptionCompletedCount;
        progressText.textContent = `${descriptionCompletedCount} / ${descriptionQueue.length}`;
        progressBar.style.width = `${(descriptionCompletedCount / total) * 100}%`;
    }

    function finishDescriptionFetchRun() {
        if (!isGettingDescriptions) return;

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
        showToast('All job info has been fetched!', 'success');
    }

    function markDescriptionJobComplete() {
        activeDescriptionRequests = Math.max(0, activeDescriptionRequests - 1);
        descriptionCompletedCount++;
        updateDescriptionProgress();

        if (descriptionCompletedCount >= descriptionQueue.length && activeDescriptionRequests === 0) {
            finishDescriptionFetchRun();
            return;
        }

        setTimeout(() => processNextJob(), 0);
    }

    async function dispatchDescriptionJob(queueItem) {
        try {
            const data = await chrome.storage.local.get(['jobs']);
            const jobs = normalizeJobRecords(data.jobs || []);
            const jobIndex = findJobIndexByKey(jobs, queueItem.key, queueItem.job);

            if (jobIndex === -1) {
                markDescriptionJobComplete();
                return;
            }

            const job = jobs[jobIndex];
            const jobUrl = job.link || job.url || '';
            chrome.runtime.sendMessage({
                action: 'fetchJobDescription',
                url: jobUrl,
                jobIndex: jobIndex,
                jobKey: getJobSelectionKey(job),
                jobLink: jobUrl,
                jobId: job.jobId || job.departmentId || '',
                departmentId: job.departmentId || job.jobId || '',
                title: job.title || '',
                location: job.location || ''
            });
        } catch (error) {
            console.error('Error requesting job description:', error);
            markDescriptionJobComplete();
        }
    }

    function processNextJob() {
        if (!isGettingDescriptions) return;

        if (descriptionCompletedCount >= descriptionQueue.length && activeDescriptionRequests === 0) {
            finishDescriptionFetchRun();
            return;
        }

        while (
            activeDescriptionRequests < DESCRIPTION_FETCH_CONCURRENCY &&
            nextDescriptionQueueIndex < descriptionQueue.length
        ) {
            const queueItem = descriptionQueue[nextDescriptionQueueIndex];
            nextDescriptionQueueIndex++;
            activeDescriptionRequests++;
            dispatchDescriptionJob(queueItem);
        }

        updateDescriptionProgress();
    }

    async function handleDescriptionFetchedMessage(message) {
        const data = await chrome.storage.local.get(['jobs']);
        const jobs = normalizeJobRecords(data.jobs || []);
        const jobIndex = findJobIndexByKey(
            jobs,
            message.jobKey,
            { jobId: jobs[message.jobIndex]?.jobId || '', link: message.jobLink || '' }
        );

        if (jobIndex !== -1 && (!message.jobLink || jobs[jobIndex].link === message.jobLink || jobs[jobIndex].url === message.jobLink)) {
            const fetchedDescription = message.description || '';
            const expectedJobId = jobs[jobIndex].jobId || jobs[jobIndex].departmentId || '';
            const returnedJobId = message.jobInfo?.jobId || '';

            if (isFilledOrUnavailableJobDescription(fetchedDescription)) {
                const removedJob = jobs.splice(jobIndex, 1)[0];
                if (removedJob) selectedJobKeys.delete(getJobSelectionKey(removedJob));
                console.warn(`Deleted filled/unavailable job ${expectedJobId || removedJob?.title || ''}.`);
            } else if (expectedJobId && returnedJobId && returnedJobId !== expectedJobId) {
                console.warn(`Ignoring mismatched job info. Expected ${expectedJobId}, got ${returnedJobId}.`);
            } else if (message.mismatch) {
                console.warn(fetchedDescription || `Unable to find matching job info for ${expectedJobId}.`);
            } else {
                jobs[jobIndex].description = fetchedDescription;
            }
        }

        await chrome.storage.local.set({ jobs });
        allJobs = jobs;
        renderCurrentView();

        if (isGettingDescriptions) {
            markDescriptionJobComplete();
        }
    }

    // Listen for description fetched messages from the existing VCA background scraper.
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'descriptionFetched') {
            descriptionStorageWriteChain = descriptionStorageWriteChain
                .then(() => handleDescriptionFetchedMessage(message))
                .catch(error => {
                    console.error('Error saving fetched description:', error);
                    if (isGettingDescriptions) markDescriptionJobComplete();
                });
        }
    });

    // ============ FETCH DETAILS ============

    fetchDetailsBtn.addEventListener('click', async () => {
        if (isFetchingDetails) {
            showToast('Already fetching details. Please wait...', 'error');
            return;
        }

        const data = await chrome.storage.local.get(['jobs']);
        const jobs = normalizeJobRecords(data.jobs || []);

        if (jobs.length === 0) {
            showToast('No jobs found. Please scrape jobs first.', 'error');
            return;
        }

        const analyzableJobs = jobs.map((job, index) => ({ job, index }))
            .filter(item =>
                item.job.title &&
                hasUsableDescription(item.job.description) &&
                !isGeneratedLocationJob(item.job)
            );

        if (analyzableJobs.length === 0) {
            showToast('No saved descriptions found. Run Get Descriptions first.', 'error');
            return;
        }

        // Fetch Details analyzes only the description already saved in this extension.
        const jobsToFetch = analyzableJobs.filter(item => {
            const betterHospital = extractBetterHospitalNameFromDescription(
                item.job.description,
                item.job.location,
                item.job.city,
                item.job.state
            );
            const descriptionAddress = extractAddressFromDescription(item.job.description);
            const completeAddress = getCompleteAddressParts(item.job, descriptionAddress);
            const hasAddressToApply = !!descriptionAddress && (
                !item.job.streetAddress ||
                !item.job.zipCode ||
                normalizeSimpleText(item.job.streetAddress) !== normalizeSimpleText(descriptionAddress.streetAddress) ||
                normalizeSimpleText(item.job.city) !== normalizeSimpleText(descriptionAddress.city) ||
                normalizeSimpleText(item.job.state) !== normalizeSimpleText(descriptionAddress.state)
            );
            const hasFallbackHospitalWithAddress = isFallbackHospitalName(item.job.hospital) && !!completeAddress;
            const hasMultiLocationRows = extractMultiLocationEntries(item.job.description, item.job).length > 1;
            const hasBetterHospital = betterHospital &&
                normalizeHospitalNameForCompare(betterHospital) !== normalizeHospitalNameForCompare(item.job.hospital || '');
            const needsDetails = !item.job.areaOfPractice ||
                !item.job.position ||
                !item.job.salary ||
                !item.job.experience ||
                !item.job.hospital ||
                isLocationOnlyHospitalName(item.job.hospital, item.job.location, item.job.city, item.job.state) ||
                isGenericOrganizationHospitalName(item.job.hospital) ||
                isLikelyIncompleteHospitalName(item.job.hospital) ||
                hasFallbackHospitalWithAddress ||
                hasBetterHospital ||
                hasAddressToApply ||
                hasMultiLocationRows;
            return needsDetails;
        });

        if (jobsToFetch.length === 0) {
            if (confirm('All jobs already have details. Do you want to re-analyze all jobs?')) {
                detailsQueue = analyzableJobs.map(item => ({ ...item, key: getJobSelectionKey(item.job) }));
            } else {
                return;
            }
        } else {
            detailsQueue = jobsToFetch.map(item => ({ ...item, key: getJobSelectionKey(item.job) }));
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
        const data = await chrome.storage.local.get(['jobs']);
        const currentJobs = normalizeJobRecords(data.jobs || []);
        const currentIndex = findJobIndexByKey(currentJobs, queueItem.key, queueItem.job);

        if (currentIndex === -1) {
            // Job no longer found (shouldn't happen), skip it
            currentDetailsIndex++;
            setTimeout(() => processNextDetail(), 50);
            return;
        }

        const job = currentJobs[currentIndex];
        let detailsList = [];

        // Extract details only from this row's already-saved description.
        const positionTitle = job.title || '';
        const description = job.description || '';

        if (positionTitle && hasUsableDescription(description)) {
            const extracted = extractDetailsFromDescription(positionTitle, description);
            detailsList = [{
                areaOfPractice: extracted.areaOfPractice,
                position: extracted.position,
                salary: extracted.salary,
                hospitalName: extracted.hospitalName,
                jobType: extracted.jobType,
                experience: extracted.experience,
                description
            }];
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
            chrome.storage.local.get(['jobs'], async (data) => {
                try {
                const jobs = normalizeJobRecords(data.jobs || []);
                const originalJob = jobs[jobIndex];

                if (!originalJob) {
                    resolve();
                    return;
                }

                const firstDetail = detailsList[0] || {};
                const listingTitle = originalJob.title || '';
                const descText = firstDetail.description || originalJob.description || '';
                const descriptionAddress = extractAddressFromDescription(descText);
                const detailHospital = firstDetail.hospitalName ||
                    extractBetterHospitalNameFromDescription(
                        descText,
                        originalJob.location || '',
                        originalJob.city || '',
                        originalJob.state || ''
                    );
                const validHospital = detailHospital &&
                    !isLocationOnlyHospitalName(detailHospital, originalJob.location, originalJob.city, originalJob.state) &&
                    !isGenericOrganizationHospitalName(detailHospital);

                function getFinalClinicalFields(rowTitle, rowHospital) {
                    let finalAOP = '';
                    if (!isNonClinicalJobTitle(rowTitle)) {
                        const titleAOP = getAOPFromTitle(rowTitle);
                        const isSpecialtyEcc = hasSpecialtyEccSignal(rowTitle, descText, rowHospital);
                        const isSpecialtyMedicalDirector = hasSpecialtyMedicalDirectorRequirement(rowTitle, descText);
                        finalAOP = (isSpecialtyMedicalDirector ? 'Specialty Care' : '') ||
                            (hasUrgentCareSignal(rowTitle, rowHospital) ? 'Urgent Care' : '') ||
                            (isSpecialtyEcc ? 'Specialty Care' : '') ||
                            (titleAOP === 'Specialty Care' ? 'Specialty Care' : '') ||
                            (/\bspecialty\s+medical\s+director\b/i.test(`${rowTitle || ''} ${descText || ''}`) ? 'Specialty Care' : '') ||
                            (hasEmergencySignal(rowTitle, rowHospital) ? 'Emergency Care' : '') ||
                            (titleAOP === 'Emergency Care' ? 'Emergency Care' : '') ||
                            (hasSpecialtyTrainingSignal(descText) ? 'Specialty Care' : '') ||
                            firstDetail.areaOfPractice ||
                            titleAOP ||
                            'General Practice Care';
                    }

                    let finalPosition = getPositionFromTitle(rowTitle) || firstDetail.position || '';
                    if (finalAOP === 'Specialty Care' &&
                        !isMedicalDirectorRole(rowTitle, descText) &&
                        hasSpecialtyEccSignal(rowTitle, descText, rowHospital)) {
                        finalPosition = 'ECC Specialist';
                    }
                    if (finalPosition) {
                        finalPosition = getValidatedPosition(finalPosition, finalAOP);
                    }
                    if (!finalPosition) {
                        finalPosition = getDefaultPositionForAOP(finalAOP, rowTitle);
                    }
                    if ((!finalPosition || finalPosition === 'Associate Veterinarian') && rowTitle.toLowerCase().includes('medical director')) {
                        finalPosition = APPROVED_POSITION_SET.has('Medical Director') ? 'Medical Director' : '';
                    }
                    if (!APPROVED_POSITION_SET.has(finalPosition)) {
                        finalPosition = '';
                    }

                    return { finalAOP, finalPosition };
                }

                const multiLocationEntries = extractMultiLocationEntries(descText, originalJob);
                if (multiLocationEntries.length > 1) {
                    const baseJobId = getBaseJobId(originalJob) || originalJob.jobId || originalJob.departmentId || '';
                    const splitJobs = [];
                    for (let index = 0; index < multiLocationEntries.length; index++) {
                        const entry = multiLocationEntries[index];
                        const suffix = getAlphabeticSuffix(index);
                        const splitJobId = baseJobId ? `${baseJobId}-${suffix}` : `${originalJob.jobId || 'JOB'}-${suffix}`;
                        const rowTitle = entry.title || listingTitle;
                        const entryAddress = entry.streetAddress ? entry : null;
                        const addressHospital = !entry.hospital && entryAddress
                            ? await fetchHospitalNameFromCompleteAddress(getCompleteAddressParts(originalJob, entryAddress))
                            : '';
                        const rowHospital = entry.hospital ||
                            addressHospital ||
                            getFallbackHospitalByLocation(
                                entry.location || originalJob.location || '',
                                entry.city || originalJob.city || '',
                                entry.state || originalJob.state || ''
                            );
                        const fields = getFinalClinicalFields(rowTitle, rowHospital);
                        const splitJob = {
                            ...originalJob,
                            title: rowTitle,
                            jobId: splitJobId,
                            departmentId: splitJobId,
                            originalJobId: baseJobId,
                            sourceJobId: baseJobId,
                            sourceLink: originalJob.link || originalJob.url || '',
                            isMultiLocationSplit: true,
                            isNewLocation: false,
                            hospital: rowHospital,
                            hospitalName: rowHospital,
                            location: entry.location || originalJob.location || '',
                            city: entry.city || '',
                            state: entry.state || '',
                            streetAddress: entryAddress?.streetAddress || '',
                            address: entryAddress?.streetAddress || '',
                            zipCode: entryAddress?.zipCode || '',
                            phone: '',
                            website: '',
                            websiteUrl: '',
                            areaOfPractice: fields.finalAOP || '',
                            position: fields.finalPosition || '',
                            salary: firstDetail.salary || '',
                            jobType: originalJob.jobType || firstDetail.jobType || '',
                            experience: firstDetail.experience || ''
                        };

                        splitJob.description = buildSplitDescription(descText, splitJob, baseJobId);
                        splitJobs.push(splitJob);
                    }

                    jobs.splice(jobIndex, 1, ...splitJobs);
                    chrome.storage.local.set({ jobs }, () => {
                        allJobs = jobs;
                        renderCurrentView();
                        resolve();
                    });
                    return;
                }

                const completeAddress = getCompleteAddressParts(originalJob, descriptionAddress);
                const addressHospital = validHospital ? '' : await fetchHospitalNameFromCompleteAddress(completeAddress);
                const fallbackHospital = getFallbackHospitalByLocation(
                    completeAddress?.location || descriptionAddress?.location || originalJob.location || '',
                    completeAddress?.city || descriptionAddress?.city || originalJob.city || '',
                    completeAddress?.state || descriptionAddress?.state || originalJob.state || ''
                );
                const finalHospital = validHospital ? detailHospital : (addressHospital || fallbackHospital);
                const { finalAOP, finalPosition } = getFinalClinicalFields(listingTitle, finalHospital);

                originalJob.hospital = finalHospital || '';
                originalJob.hospitalName = finalHospital || '';
                if (descriptionAddress) {
                    originalJob.streetAddress = descriptionAddress.streetAddress;
                    originalJob.address = descriptionAddress.streetAddress;
                    originalJob.city = descriptionAddress.city;
                    originalJob.state = descriptionAddress.state;
                    originalJob.zipCode = descriptionAddress.zipCode;
                    originalJob.location = descriptionAddress.location;
                }
                originalJob.areaOfPractice = finalAOP || '';
                originalJob.position = finalPosition || '';
                originalJob.salary = firstDetail.salary || '';
                originalJob.experience = firstDetail.experience || '';

                chrome.storage.local.set({ jobs }, () => {
                    allJobs = jobs;
                    renderCurrentView();
                    resolve();
                });
                } catch (error) {
                    console.error('Error saving detail results:', error);
                    resolve();
                }
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
            job.streetAddress === 'Not Available' &&
            job.zipCode === '00000';
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
        return canFetchAddressForHospital(job.hospital, job.location, job.city, job.state);
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
                businessName: job.hospital || '',
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

        const data = await chrome.storage.local.get(['jobs']);
        const jobs = normalizeJobRecords(data.jobs || []);
        let clearedInvalidAddressCount = 0;

        jobs.forEach(job => {
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

        if (clearedInvalidAddressCount > 0) {
            await chrome.storage.local.set({ jobs: jobs });
            allJobs = jobs;
            renderCurrentView();
        }

        // Find jobs that need address/contact data (using LOCATION column)
        const jobsNeedingAddresses = jobs.map((job, index) => ({ job, index, key: getJobSelectionKey(job) }))
            .filter(item => {
                if (hasLivewellFallbackAddress(item.job)) return false;
                // Jobs missing any core location/contact field
                return canLookupAddressForJob(item.job) &&
                    (!item.job.streetAddress ||
                        !item.job.zipCode ||
                        (!item.job.phone && !item.job.website) ||
                        item.job.streetAddress === 'TBD' ||
                        item.job.zipCode === '00000' ||
                        jobLocationMismatch(item.job) ||
                        savedAddressStateMismatch(item.job) ||
                        savedAddressBrandMismatch(item.job) ||
                        isFallbackHospitalName(item.job.hospital) ||
                        isMissionPetHealthHospital(item.job.hospital));
            });

        if (jobsNeedingAddresses.length === 0) {
            if (confirm('All jobs already have addresses. Do you want to re-fetch addresses for all jobs?')) {
                addressQueue = jobs.map((job, index) => ({ job, index, key: getJobSelectionKey(job) }))
                    .filter(item => canLookupAddressForJob(item.job) && !hasLivewellFallbackAddress(item.job));
            } else {
                if (clearedInvalidAddressCount > 0) {
                    showToast(`Cleared invalid address data from ${clearedInvalidAddressCount} regional/location-only row(s).`, 'success');
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

        const queueItem = addressQueue[currentAddressIndex];
        let { job, index } = queueItem;

        // Update progress
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        progressText.textContent = `${currentAddressIndex + 1} / ${addressQueue.length}`;
        progressBar.style.width = `${((currentAddressIndex + 1) / addressQueue.length) * 100}%`;
        fetchAddressesBtn.textContent = `Fetching... (${currentAddressIndex + 1}/${addressQueue.length})`;

        try {
            if (!canLookupAddressForJob(job)) {
                const data = await chrome.storage.local.get(['jobs']);
                const jobs = normalizeJobRecords(data.jobs || []);
                index = findJobIndexByKey(jobs, queueItem.key, job);
                if (index !== -1) {
                    jobs[index].streetAddress = 'TBD';
                    jobs[index].zipCode = '00000';
                    jobs[index].website = '';
                    jobs[index].phone = '';
                    await chrome.storage.local.set({ jobs: jobs });
                    allJobs = jobs;
                    renderCurrentView();
                }
                currentAddressIndex++;
                setTimeout(() => processNextAddress(), 50);
                return;
            }

            // Clean hospital name for search:
            const latestData = await chrome.storage.local.get(['jobs']);
            const latestJobs = normalizeJobRecords(latestData.jobs || []);
            const latestIndex = findJobIndexByKey(latestJobs, queueItem.key, job);
            if (latestIndex === -1) {
                currentAddressIndex++;
                setTimeout(() => processNextAddress(), 50);
                return;
            }
            job = latestJobs[latestIndex];
            index = latestIndex;

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
            let addressData = null;
            const shouldSkipCache = !!lookupTarget.directResult || isMissionPetHealthHospital(job.hospital);
            if (!shouldSkipCache) addressData = getRememberedAddress(cacheKeys);

            if (lookupTarget.directResult) {
                addressData = { ...lookupTarget.directResult };
            } else if (addressData) {
                console.log(`Using cached address for "${searchHospital}, ${searchLocation}"`);
            } else {
                addressData = await fetchAddressFromGoogleMaps(searchHospital, searchLocation, job.hospital || '');
            }

            const fetchedZip = addressData?.zipCode || extractZipFromAddressText(addressData?.fullAddress || addressData?.streetAddress || '');
            const fetchedState = addressData?.state || extractStateFromAddressText(addressData?.fullAddress || addressData?.streetAddress || '');
            const fetchedCity = addressData?.city || '';
            const fetchedLocationMismatch =
                (searchCity && (!fetchedCity || (normalizeLocationValue(fetchedCity) !== normalizeLocationValue(searchCity) && !citiesPracticallyMatch(searchCity, fetchedCity)))) ||
                (searchState && !fetchedState && !fetchedZip) ||
                (searchState && fetchedState && getStateAbbreviation(fetchedState) !== getStateAbbreviation(searchState)) ||
                (searchState && fetchedZip && !zipMatchesState(fetchedZip, searchState));
            const fetchedBrandMismatch = !addressMatchesExpectedHospitalBrand(job.hospital, addressData, searchLocation || job.location || '');

            if (fetchedLocationMismatch || fetchedBrandMismatch) {
                if (addressResultPassesRescue(job, addressData, searchLocation)) {
                    console.log(`Accepted address result through rescue validation for "${searchHospital}, ${searchLocation}"`);
                } else {
                    const reason = fetchedBrandMismatch ? 'wrong hospital brand' : 'outside requested location';
                    console.warn(`Ignoring address result ${reason} "${searchLocation}" for "${searchHospital}": ${addressData.fullAddress || addressData.website || [addressData.city, addressData.state, addressData.zipCode].filter(Boolean).join(', ')}`);
                    addressData = { streetAddress: 'TBD', zipCode: '00000', city: '', state: '', fullAddress: '', website: '', phone: '' };
                }
            }

            if (!addressData.streetAddress && !addressData.zipCode) {
                addressData = {
                    ...addressData,
                    streetAddress: 'TBD',
                    zipCode: '00000'
                };
            }

            rememberAddressData(cacheKeys, addressData);

            // Update job with address data from Google Maps
            const data = await chrome.storage.local.get(['jobs']);
            const jobs = normalizeJobRecords(data.jobs || []);
            index = findJobIndexByKey(jobs, queueItem.key, job);

            if (index !== -1) {
                const currentHospitalName = jobs[index].hospital || jobs[index].hospitalName || '';
                const addressHospitalName = getAddressHospitalNameCandidate(addressData);
                const hospitalNameScore = getHospitalNameUpdateScore(currentHospitalName, addressHospitalName, searchLocation || jobs[index].location || '');
                if (
                    addressHospitalName &&
                    hospitalNameScore >= 80 &&
                    normalizeHospitalNameForCompare(addressHospitalName) !== normalizeHospitalNameForCompare(currentHospitalName)
                ) {
                    jobs[index].previousHospitalName = currentHospitalName;
                    jobs[index].hospital = addressHospitalName;
                    jobs[index].hospitalName = addressHospitalName;
                    jobs[index].hospitalNameUpdated = true;
                    jobs[index].hospitalNameUpdateScore = hospitalNameScore;
                }

                if (addressData.streetAddress) {
                    jobs[index].streetAddress = addressData.streetAddress;
                } else {
                    jobs[index].streetAddress = '';
                }
                if (addressData.zipCode) {
                    jobs[index].zipCode = addressData.zipCode;
                } else {
                    jobs[index].zipCode = '';
                }

                // City and state come from the row's Location column. Fetched address data
                // is accepted only when it matches this location.
                jobs[index].city = formatCityForStorage(searchCity || addressData.city || jobs[index].city || '');
                jobs[index].state = formatStateForStorage(searchState || addressData.state || jobs[index].state || '');

                // Try to extract zip from fullAddress if parsing missed it
                if (!jobs[index].zipCode && addressData.fullAddress) {
                    const zipFromFull = addressData.fullAddress.match(/\b(\d{5}(?:-\d{4})?)\b/);
                    if (zipFromFull) jobs[index].zipCode = zipFromFull[1];
                }

                // Website and phone from Google Maps
                if (addressData.website) {
                    jobs[index].website = addressData.website;
                } else {
                    jobs[index].website = '';
                }
                if (addressData.phone) {
                    jobs[index].phone = addressData.phone;
                } else {
                    jobs[index].phone = '';
                }

                await chrome.storage.local.set({ jobs: jobs });

                // Update display
                allJobs = jobs;
                renderCurrentView();
            }
        } catch (error) {
            console.error('Error fetching address:', error);
            try {
                const data = await chrome.storage.local.get(['jobs']);
                const jobs = normalizeJobRecords(data.jobs || []);
                index = findJobIndexByKey(jobs, queueItem.key, job);
                if (index !== -1) {
                    jobs[index].streetAddress = 'TBD';
                    jobs[index].zipCode = '00000';
                    await chrome.storage.local.set({ jobs: jobs });
                    allJobs = jobs;
                    renderCurrentView();
                }
            } catch (saveError) {
                console.error('Error saving fallback address:', saveError);
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
