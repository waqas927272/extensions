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
    const selectAllJobsCheckbox = document.getElementById('selectAllJobs');
    const deleteSelectedJobsButton = document.getElementById('deleteSelectedJobs');
    const descriptionModal = document.getElementById('descriptionModal');
    const closeDescriptionModalButton = document.getElementById('closeDescriptionModal');
    const modalDescriptionContent = document.getElementById('modalDescriptionContent');
    const AGGREGATOR_NAME = 'Veterinary Practice Partners - VPP (Parent Client)';
    const GREENHOUSE_BOARD_TOKEN = 'veterinaryinnovativepartners';
    const DETAIL_EXTRACTION_VERSION = 3;
    const ADDRESS_EXTRACTION_VERSION = 1;
    const UNKNOWN_STREET_ADDRESS = 'TBD';
    const UNKNOWN_ZIP_CODE = '00000';
    const addressValidation = globalThis.VppAddressValidation;

    function getGreenhouseJobId(job) {
        const savedId = String(job?.greenhouseJobId || '').trim();
        if (/^\d{6,}$/.test(savedId)) return savedId;

        // VPP row IDs are hiring-plan IDs, not Greenhouse job IDs. Prefer an
        // actual Greenhouse URL and only accept bare numeric legacy IDs later.
        for (const candidate of [job?.link, job?.sourceLink, job?.applicationUrl]) {
            const value = String(candidate || '').trim();
            if (!value) continue;
            try {
                const url = new URL(value);
                if (!url.hostname.endsWith('greenhouse.io')) continue;
                const queryId = url.searchParams.get('gh_jid') || url.searchParams.get('token');
                if (/^\d{6,}$/.test(queryId || '')) return queryId;
                const pathMatch = url.pathname.match(/\/jobs\/(\d{6,})/i);
                if (pathMatch) return pathMatch[1];
            } catch (error) {
                // Ignore malformed or non-URL candidates.
            }
        }

        for (const candidate of [job?.jobId, job?.id]) {
            const value = String(candidate || '').trim();
            if (/^\d{6,}$/.test(value)) return value;
        }
        return '';
    }

    function normalizeExternalUrl(rawUrl, baseUrl = '') {
        let candidate = String(rawUrl || '')
            .replace(/&amp;/gi, '&')
            .replace(/[)\].,;]+$/g, '')
            .trim();
        if (!candidate || candidate === '#' || /^javascript:/i.test(candidate)) return '';

        if (/^[\w.-]+\.[a-z]{2,}(?:\/[^\s]*)?$/i.test(candidate) && !/^https?:\/\//i.test(candidate)) {
            candidate = `https://${candidate}`;
        }

        try {
            let url = new URL(candidate, baseUrl || undefined);
            const host = url.hostname.toLowerCase();
            const isLinkedInRedirect = host.endsWith('linkedin.com') && url.pathname.includes('/safety/go/');
            const isGoogleRedirect = host.includes('google.') && url.pathname === '/url';
            if (isLinkedInRedirect || isGoogleRedirect) {
                const destination = url.searchParams.get('url') || url.searchParams.get('q');
                if (destination) {
                    url = new URL(destination);
                }
            }
            return url.toString();
        } catch (error) {
            return '';
        }
    }

    function normalizeClinicWebsite(rawUrl, baseUrl = '') {
        const normalized = normalizeExternalUrl(rawUrl, baseUrl);
        if (!normalized) return '';

        try {
            const url = new URL(normalized);
            const host = url.hostname.replace(/^www\./i, '').toLowerCase();
            const blockedHosts = [
                'greenhouse.io', 'google.', 'linkedin.', 'facebook.', 'instagram.',
                'twitter.', 'x.com', 'youtube.', 'youtu.be', 'vimeo.com', 'tiktok.',
                'indeed.', 'glassdoor.', 'ziprecruiter.', 'vip-vet.com', 'yelp.',
                'mapquest.', 'maps.apple.', 'yellowpages.', 'chamberofcommerce.',
                'bbb.org', 'greatpetcare.', 'birdeye.', 'vetreceipt.'
            ];
            if (blockedHosts.some(blocked => host === blocked || host.includes(blocked))) return '';

            for (const key of [...url.searchParams.keys()]) {
                if (/^(?:utm_.+|gclid|fbclid|msclkid)$/i.test(key)) url.searchParams.delete(key);
            }
            url.hash = '';
            return url.toString();
        } catch (error) {
            return '';
        }
    }

    function greenhouseHtmlToDescription(html, sourceUrl = '') {
        if (!html) return '';
        const container = document.createElement('div');
        container.innerHTML = html;
        container.querySelectorAll('script, style, noscript, form').forEach(node => node.remove());

        container.querySelectorAll('a[href]').forEach(link => {
            const rawHref = link.getAttribute('href') || '';
            const href = normalizeExternalUrl(rawHref, sourceUrl);
            const label = (link.textContent || '').replace(/\s+/g, ' ').trim();
            link.textContent = href ? (label && !label.includes(href) ? `${label} (${href})` : href) : label;
        });
        container.querySelectorAll('br').forEach(node => node.replaceWith(document.createTextNode('\n')));
        container.querySelectorAll('p, div, section, article, h1, h2, h3, h4, h5, h6, li, ul, ol').forEach(node => {
            node.appendChild(document.createTextNode('\n'));
        });

        return (container.textContent || '')
            .replace(/\u00a0/g, ' ')
            .replace(/[ \t]+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    async function fetchGreenhouseJob(job) {
        const jobId = getGreenhouseJobId(job);
        if (!jobId) throw new Error('No Greenhouse job ID is available.');

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
            const response = await fetch(`https://boards-api.greenhouse.io/v1/boards/${GREENHOUSE_BOARD_TOKEN}/jobs/${jobId}`, {
                signal: controller.signal,
                cache: 'no-store'
            });
            if (!response.ok) throw new Error(`Greenhouse returned HTTP ${response.status}.`);
            return await response.json();
        } finally {
            clearTimeout(timeout);
        }
    }

    function parseGreenhouseOfficeLocation(apiJob) {
        const locationText = apiJob?.offices?.find(office => office?.location)?.location || '';
        const parts = locationText.split(',').map(part => part.trim()).filter(Boolean);
        if (parts.length < 2) return {};
        return {
            city: parts[0],
            state: getFullStateName(parts[1]),
            country: parts.slice(2).join(', ')
        };
    }

    function applyGreenhouseMetadata(job, apiJob) {
        if (!job || !apiJob) return '';
        const apiDescription = greenhouseHtmlToDescription(apiJob.content || '', apiJob.absolute_url || job.link || '');
        const officeLocation = parseGreenhouseOfficeLocation(apiJob);

        job.greenhouseJobId = String(apiJob.id || getGreenhouseJobId(job));
        job.internalJobId = apiJob.internal_job_id || job.internalJobId || '';
        job.requisitionId = apiJob.requisition_id || job.requisitionId || '';
        job.firstPublished = apiJob.first_published || job.firstPublished || '';
        job.updatedAt = apiJob.updated_at || job.updatedAt || '';
        job.applicationDeadline = apiJob.application_deadline || job.applicationDeadline || '';
        job.companyName = apiJob.company_name || job.companyName || '';
        job.department = apiJob.departments?.map(department => department.name).filter(Boolean).join(' / ') || job.department || '';
        job.office = apiJob.offices?.map(office => office.name).filter(Boolean).join(' / ') || job.office || '';
        job.language = apiJob.language || job.language || '';
        if (apiJob.absolute_url) job.link = apiJob.absolute_url;
        if (officeLocation.city) job.city = officeLocation.city;
        if (officeLocation.state) job.state = officeLocation.state;
        if (officeLocation.country) job.country = officeLocation.country;
        if (officeLocation.city || officeLocation.state) job.location = formatLocation(job.city, job.state);
        if (apiDescription && apiDescription.length > (job.description || '').length) job.description = apiDescription;
        return apiDescription;
    }

    function isGenericParentHospitalName(name) {
        return /\b(?:veterinary\s+(?:practice|innovative)\s+partners|vpp|vip\s+vet)\b/i.test(name || '');
    }

    let currentSortColumn = null;
    let currentSortDirection = 'asc';
    let allJobs = [];
    let displayedJobs = [];
    let selectedJobKeys = new Set();
    let visibleJobKeys = [];
    let isGettingDescriptions = false;
    let isFetchingDetails = false;
    let isFetchingAddresses = false;
    let detailsQueue = [];
    let currentDetailsIndex = 0;
    let detailFetchSummary = { success: 0, partial: 0, failed: 0 };
    let addressQueue = [];
    let currentAddressIndex = 0;
    let addressCache = new Map();
    let addressFetchSummary = { success: 0, partial: 0, failed: 0, skipped: 0, updatedFields: 0 };
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
        const value = (state || '').replace(/\./g, '').replace(/\s+/g, ' ').trim();
        if (!value) return '';
        if (/^[A-Z]{2}$/i.test(value)) {
            return stateAbbreviations[value.toUpperCase()] || value.toUpperCase();
        }

        const normalized = value.toLowerCase();
        const canonical = Object.values(stateAbbreviations).find(fullName => fullName.toLowerCase() === normalized);
        return canonical || value;
    }

    function formatLocation(city, state) {
        const fullState = getFullStateName(state);
        return [city || '', fullState].filter(Boolean).join(', ');
    }

    function normalizeNumericSalary(value) {
        const text = String(value || '').replace(/\s+/g, ' ').trim();
        if (!text || text === '-') return '';

        const amounts = [];
        const amountPattern = /(?:[$£€]\s*)?(\d[\d,]*(?:\.\d+)?)(\s*k)?\b/gi;
        let match;
        while ((match = amountPattern.exec(text)) !== null) {
            let amount = Number(match[1].replace(/,/g, ''));
            if (match[2]) amount *= 1000;
            if (Number.isFinite(amount) && amount > 0) amounts.push(amount);
        }
        if (!amounts.length) return '';

        const isHourly = /\b(?:per\s+hour|hourly|\/\s*(?:hr|hour))\b/i.test(text);
        return isHourly || amounts.some(amount => amount >= 10000) ? text : '';
    }

    function getNormalizedJobType(descriptionText) {
        const text = String(descriptionText || '');
        const hasPartTime = /\bpart[\s-]?time\b/i.test(text);
        const hasFullTime = /\bfull[\s-]?time\b|\bfull\s*(?:\/|or|and)\s*part[\s-]?time\b/i.test(text);
        return hasPartTime && !hasFullTime ? 'Part-Time' : 'Full-Time';
    }

    function expandStateInLocation(location) {
        const parts = (location || '').split(',').map(part => part.trim()).filter(Boolean);
        if (parts.length < 2) return location || '';
        parts[1] = getFullStateName(parts[1]);
        return parts.join(', ');
    }

    function normalizeVipVetJobs(jobs) {
        let changed = false;
        const normalized = (jobs || []).map((job) => {
            const copy = { ...job };

            if (!copy.jobId && (copy.reqId || copy.id)) {
                copy.jobId = copy.reqId || copy.id;
                changed = true;
            }
            if (!copy.id && copy.jobId) {
                copy.id = copy.jobId;
                changed = true;
            }
            if (!copy.reqId && copy.jobId) {
                copy.reqId = copy.jobId;
                changed = true;
            }
            for (const key of ['id', 'reqId', 'jobId']) {
                if (copy[key] && /^VIP-/i.test(copy[key])) {
                    copy[key] = copy[key].replace(/^VIP-/i, 'VPP-');
                    changed = true;
                }
            }
            if (!copy.originalHospitalName && (copy.hospital || copy.hospitalName)) {
                copy.originalHospitalName = copy.hospital || copy.hospitalName;
                changed = true;
            }
            if (copy.originalHospitalName && copy.hospital !== copy.originalHospitalName) {
                copy.hospital = copy.originalHospitalName;
                changed = true;
            }
            if (copy.originalHospitalName && copy.hospitalName !== copy.originalHospitalName) {
                copy.hospitalName = copy.originalHospitalName;
                changed = true;
            }
            if (!copy.hospital && copy.hospitalName) {
                copy.hospital = copy.hospitalName;
                changed = true;
            }
            if (!copy.hospitalName && copy.hospital) {
                copy.hospitalName = copy.hospital;
                changed = true;
            }
            // Placeholders belong to Fetch Addresses. Remove placeholders that
            // were created before an address lookup was ever attempted.
            if (!copy.addressFetchAttemptedAt && copy.streetAddress === UNKNOWN_STREET_ADDRESS) {
                copy.streetAddress = '';
                changed = true;
            }
            if (!copy.addressFetchAttemptedAt && copy.zipCode === UNKNOWN_ZIP_CODE) {
                copy.zipCode = '';
                changed = true;
            }
            if (!copy.addressFetchAttemptedAt && copy.postalCode === UNKNOWN_ZIP_CODE) {
                copy.postalCode = '';
                changed = true;
            }
            if (!copy.zipCode && copy.postalCode) {
                copy.zipCode = copy.postalCode;
                changed = true;
            }
            if (!copy.postalCode && copy.zipCode) {
                copy.postalCode = copy.zipCode;
                changed = true;
            }
            if (!copy.state && copy.location) {
                const locationParts = copy.location.split(',').map(part => part.trim()).filter(Boolean);
                if (locationParts.length >= 2) {
                    copy.state = locationParts[1];
                    changed = true;
                }
            }
            if (copy.state) {
                const fullState = getFullStateName(copy.state);
                if (fullState && fullState !== copy.state) {
                    copy.state = fullState;
                    changed = true;
                }
            }
            if (copy.location) {
                const expandedLocation = expandStateInLocation(copy.location);
                if (expandedLocation && expandedLocation !== copy.location) {
                    copy.location = expandedLocation;
                    changed = true;
                }
            }
            if (!copy.location && (copy.city || copy.state)) {
                copy.location = formatLocation(copy.city, copy.state);
                changed = true;
            }
            const numericSalary = normalizeNumericSalary(copy.salary);
            if ((copy.salary || '') !== numericSalary) {
                copy.salary = numericSalary;
                changed = true;
            }
            const normalizedJobType = getNormalizedJobType(copy.description);
            if (copy.jobType !== normalizedJobType) {
                copy.jobType = normalizedJobType;
                changed = true;
            }

            return copy;
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

    function extractTopLevelQualificationsSection(text) {
        const patterns = [
            /(?:requirements?|qualifications?|what you'?ll need|what we'?re looking for|credentials?|must have|what we need)[:\s]*([\s\S]{0,800}?)(?=(?:benefits?|compensation|salary|about|our culture|location|equal|join us|why|facility|what we offer|ready to)[:\s])/i,
            /(?:requirements?|qualifications?|what you'?ll need|what we'?re looking for|credentials?|must have|what we need)[:\s]*([\s\S]{0,500})/i
        ];
        for (const pattern of patterns) {
            const match = (text || '').match(pattern);
            if (match) return match[1];
        }
        return null;
    }

    function extractRoleSignalText(text) {
        if (!text) return '';

        const rolePattern = /\b(?:medical director|lead veterinarian|lead vet|board certified|residency[-\s]+trained|residential[-\s]+trained|diplomate|criticalist|ecc specialist|emergency\s*(?:&|and)?\s*critical care specialist|internist|internal medicine specialist|cardiologist|dermatologist|neurologist|neurosurgeon|ophthalmologist|radiologist|diagnostic imaging specialist|anesthesiologist|medical oncologist|radiation oncologist|veterinary dentist|dental specialist|oral surgeon|veterinary surgeon|credentialed veterinary technician specialist|technician specialist|\bvts\b|\bdacv(?:ecc|im|r|s|d|o|aa)?\b|\bdacvr[-\s]?ro\b|\bdavdc\b|\bdabvp\b)\b/i;
        const blockedPattern = /\b(?:our services|services include|specialties include|benefits|medical(?:,\s*|\s+)dental|dental insurance|our hospital|the hospital offers|hospital offers|our team has|state[-\s]?of[-\s]?the[-\s]?art|we offer|available on[-\s]?site|advanced cases|years of experience in specialty and emergency services)\b/i;
        const qualificationsSection = extractTopLevelQualificationsSection(text);
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

    function hasSpecialtyTrainingSignal(text) {
        return /\bboard certified\b|\bresidency[-\s]+trained\b|\bresidential[-\s]+trained\b/i.test(extractRoleSignalText(text || ''));
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
        if (/\b(?:co[-\s]?owner|owner)\s+(?:veterinarian|vet|dvm)\b|\b(?:veterinarian|veterinary)\s+partnership\b|\bfounding\s+dvm\s+partner\b/.test(t)) return 'Partner Veterinarian';

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

    function isSupportedVeterinaryRoleTitle(title) {
        const value = (title || '').toLowerCase();
        if (!value) return false;
        if (getPositionFromTitle(value)) return true;
        return /\b(?:veterinarian|veterinary doctor|dvm)\b/.test(value) &&
            !/\b(?:assistant|receptionist|client service|practice manager|office manager|technician)\b/.test(value);
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

        if (aopParts.some(part => ['General Practice Care', 'Urgent Care'].includes(part)) &&
            /\b(?:partner|partnership|co[-\s]?owner|owner)\b/.test(t)) {
            return 'Partner Veterinarian';
        }

        if (isSupportedVeterinaryRoleTitle(title) &&
            aopParts.some(part => ['General Practice Care', 'Emergency Care', 'Urgent Care'].includes(part))) {
            return 'Associate Veterinarian';
        }

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
        if (/\b(?:emergency|er)\s+(?:veterinarian|vet|dvm)\b|\b(?:veterinarian|vet|dvm)\s*[-–—]?\s*(?:emergency|er)\b|\b(?:criticalist|ecc)\b/.test(t)) return 'Emergency Care';

        // Equine/Bovine/Exotics
        if (t.includes('equine') || t.includes('bovine') || t.includes('large animal') ||
            t.includes('avian') || t.includes('exotics')) return 'General Practice Care / Emergency Care / Urgent Care';

        return '';
    }

    // ============ LOCAL DETAIL EXTRACTION (mirrors detail-extractor.js) ============

    function extractDetailsFromDescription(positionTitle, descriptionText) {
        // Format salary to standard "$X-$Y per year" or "$X per hour".
        function formatSalary(raw) {
            if (!raw) return '';
            raw = String(raw)
                .replace(/[–—]/g, '-')
                .replace(/â€“|â€”/g, '-')
                .replace(/\s+/g, ' ')
                .trim();
            const amountContext = raw.match(/\$[\d,]+(?:\.\d{1,2})?\s*k?\s*(?:-|to)?\s*\$?[\d,]+(?:\.\d{1,2})?\s*k?(?:[^.]{0,45})/i)?.[0] || raw;
            const hasAnnualSignal = /\b(?:annual|annually|yearly|per\s+year|\/yr|\/year|salary)\b/i.test(amountContext);
            const hasHourlySignal = /\b(?:per\s+hour|hourly|\/hr|hr\b)\b/i.test(amountContext);
            const isHourly = hasHourlySignal && !hasAnnualSignal;
            const amounts = [];
            const rangeMatch = raw.match(/\$\s*([\d,]+(?:\.\d{1,2})?)\s*(k)?\s*(?:-|to)\s*\$?\s*([\d,]+(?:\.\d{1,2})?)\s*(k)?/i);
            if (rangeMatch) {
                let first = parseFloat(rangeMatch[1].replace(/,/g, ''));
                let second = parseFloat(rangeMatch[3].replace(/,/g, ''));
                if (rangeMatch[2]) first *= 1000;
                if (rangeMatch[4] || (rangeMatch[2] && second < 1000)) second *= 1000;
                if (!isHourly && first < 1000 && second >= 1000) first *= 1000;
                if (!isHourly && second < 1000 && first >= 1000) second *= 1000;
                amounts.push(first, second);
            }
            const amountRegex = /\$?\s*([\d,]+(?:\.\d{1,2})?)\s*(k)?\b/gi;
            let match;
            if (amounts.length === 0) {
                while ((match = amountRegex.exec(raw)) !== null) {
                    let num = parseFloat(match[1].replace(/,/g, ''));
                    if (match[2]) {
                        num = num * 1000;
                    }
                    if (num > 0) amounts.push(num);
                }
            }
            if (amounts.length === 0) return '';
            // Small annual amounts in job descriptions are usually CE allowances,
            // signing bonuses, or reimbursements rather than base compensation.
            if (!isHourly && amounts.some(amount => amount < 10000)) return '';
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

        // Extract salary from stored description (which now includes JSON-LD data)
        function extractSalary(text) {
            if (!text) return '';

            // Try to extract from JSON-LD data in the text
            const jsonLdMatch = text.match(/Salary Range:\s*([^\n]+)/i);
            if (jsonLdMatch) {
                return formatSalary(jsonLdMatch[1].trim());
            }

            const normalizedText = text
                .replace(/[–—]/g, '-')
                .replace(/â€“|â€”/g, '-')
                .replace(/\s+/g, ' ');

            // Fallback to text pattern matching. Keep patterns anchored to salary words
            // where possible so non-salary numbers such as "1099" are not captured.
            const salaryPatterns = [
                // "Base salary ranges: $150k - $171k" or "base salary range of $140,000 - $160,000"
                /(?:base\s+salary\s*(?:ranges?)?)\s*(?:of|from|is|:)?\s*\$[\d,]+(?:\.\d{1,2})?\s*k?\s*(?:-|to)\s*\$?[\d,]+(?:\.\d{1,2})?\s*k?/i,
                // "Pay range: $95,000 - $160,000" or "Salary range: $120,000 - $140,000"
                /(?:(?:pay|salary|compensation|starting)\s+range)\s*(?:of|from|is|:)?\s*\$[\d,]+(?:\.\d{1,2})?\s*k?\s*(?:-|to)\s*\$?[\d,]+(?:\.\d{1,2})?\s*k?/i,
                // "Salary: $130,000-$200,000" or "Compensation: $110,000 to $180,000"
                /(?:salary|compensation|pay|base pay|base salary)[:\s]+(?:[^.]{0,120}?)\$[\d,]+(?:\.\d{1,2})?\s*k?\s*(?:-|to)\s*\$?[\d,]+(?:\.\d{1,2})?\s*k?/i,
                // "$130,000-$200,000" or "$130,000 to $200,000" near salary wording
                /(?:salary|compensation|pay|wage|earn|earning|range|hourly)[^.]{0,160}?\$[\d,]+(?:\.\d{1,2})?\s*k?\s*(?:-|to)\s*\$?[\d,]+(?:\.\d{1,2})?\s*k?/i,
                // "$110,000-$160,000+ annually" / "$150K-$180K/yr"
                /\$[\d,]+(?:\.\d{1,2})?\s*k?\s*(?:-|to)\s*\$?[\d,]+(?:\.\d{1,2})?\s*k?\+?\s*(?:annually|yearly|per\s*year|\/yr|\/year|per\s*hour|\/hr|hourly)/i,
                // "$100,000-$175K+ (Pro-Sal) total earning potential"
                /\$[\d,]+(?:\.\d{1,2})?\s*k?\s*(?:-|to)\s*\$?[\d,]+(?:\.\d{1,2})?\s*k?\+?\s*(?:\([^)]*\)\s*)?(?:total\s+)?earning\s+potential/i,
                // "$150k - $171k"
                /\$[\d,]+\s*k\s*(?:-|to)\s*\$?[\d,]+\s*k/i,
                // "earn $250,000 annually"
                /(?:earn|earning|salary|compensation|pay)[^.]{0,80}?\$[\d,]+(?:\.\d{1,2})?\s*k?\s*(?:annually|per\s*year|per\s*annum)?/i,
                // "$95 per hour" or "$95/hr"
                /\$[\d,]+(?:\.\d{1,2})?\s*(?:per\s+)?(?:hour|hr|\/hr|hourly)/i,
                // "From $110,000 a year"
                /(?:from|starting(?:\s+at)?|up\s+to)\s+\$[\d,]+(?:\.\d{1,2})?\+?\s*(?:a|per)?\s*(?:year|hour|hr|annually|yearly|\/yr|\/hr)/i,
                // "Compensation ranges from 110,000 to 160,000 per year"
                /(?:salary|compensation|pay|wage)[^.]{0,120}?\b[\d,]{2,}\s*(?:-|to)\s*[\d,]{2,}\+?\s*(?:a|per)?\s*(?:year|hour|hr|annually|yearly)\b/i
            ];
            for (const pattern of salaryPatterns) {
                const m = normalizedText.match(pattern);
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
            const blockedPattern = /\b(?:our services|services include|specialties include|benefits|medical(?:,\s*|\s+)dental|dental insurance|our hospital|the hospital offers|hospital offers|our team has|state[-\s]?of[-\s]?the[-\s]?art|we offer|available on[-\s]?site|advanced cases|years of experience in specialty and emergency services)\b/i;
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

            // Do not classify reception, management, assistant, or ordinary technician
            // postings into the veterinarian-only Area of Practice taxonomy.
            if (!isSupportedVeterinaryRoleTitle(positionText)) return '';

            if (hasSpecialtyTrainingSignal(descriptionText)) return 'Specialty Care';

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
            if (/\b(?:emergency|er)\s+(?:veterinarian|vet|dvm)\b|\b(?:veterinarian|vet|dvm)\s*[-–—]?\s*(?:emergency|er)\b|\b(?:criticalist|ecc)\b/.test(title)) {
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
            if (/\b(?:co[-\s]?owner|owner)\s+(?:veterinarian|vet|dvm)\b|\b(?:veterinarian|veterinary)\s+partnership\b|\bfounding\s+dvm\s+partner\b/.test(t)) return 'Partner Veterinarian';

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

        // Determine Position
        function determinePosition(positionText, descriptionText, areaOfPractice) {
            let position = matchPositionFromTitle(positionText);
            if (!position) {
                position = matchPositionFromQualifications(descriptionText);
            }
            return APPROVED_POSITION_SET.has(position) ? position : '';
        }

        // Extract locations from stored description (which now includes JSON-LD data)
        function extractLocations(text, titleText = '') {
            const locations = [];
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
            const validStateCodes = new Set(Object.values(stateFullToCode));

            function normalizeState(rawState) {
                const cleaned = (rawState || '').trim().replace(/\./g, '').replace(/\s+/g, ' ');
                if (!cleaned) return '';
                if (/^[A-Z]{2}$/i.test(cleaned)) {
                    const code = cleaned.toUpperCase();
                    return validStateCodes.has(code) ? code : '';
                }
                return stateFullToCode[cleaned.toLowerCase()] || cleaned;
            }

            function isLikelyCity(value) {
                const city = (value || '').trim();
                if (!city || city.length > 45 || /\d/.test(city)) return false;
                if (/^(?:the\s+)?state\s+of\b|^(?:licensed|valid|eligible|ability)\b/i.test(city)) return false;
                if (Object.prototype.hasOwnProperty.call(stateFullToCode, city.toLowerCase())) return false;
                if (/\b(?:associate|veterinarian|veterinary|hospital|clinic|center|care|salary|pay|schedule|full-time|part-time|description|position|about|benefits|licensed|education|allowance|uniform|relocation|employment|sponsorship|insurance|membership|license|fees)\b/i.test(city)) return false;
                return /^[A-Za-z .'-]+$/.test(city);
            }

            function addLocation(city, state) {
                const normalizedCity = (city || '').replace(/\s+/g, ' ').trim();
                const normalizedState = normalizeState(state || '');
                if (!isLikelyCity(normalizedCity)) return false;
                if (!/^[A-Z]{2}$/.test(normalizedState)) return false;
                const fullState = getFullStateName(normalizedState);
                locations.push({ city: normalizedCity, state: fullState, location: formatLocation(normalizedCity, fullState) });
                return true;
            }

            function addLocationFromCandidate(cityCandidate, state) {
                const cleaned = (cityCandidate || '')
                    .replace(/\s+/g, ' ')
                    .replace(/^(?:location|clinic location|hospital location|practice location)\s*:?\s*/i, '')
                    .trim();

                if (addLocation(cleaned, state)) return true;

                const chunks = cleaned
                    .split(/\s*(?:\||[-–—:]|\bat\b|\bin\b)\s*/i)
                    .map(part => part.trim())
                    .filter(Boolean);
                const tail = (chunks[chunks.length - 1] || cleaned)
                    .replace(/\b([A-Za-z]+)\s+\1\b/gi, '$1')
                    .replace(/^(?:of|near|around)\s+/i, '')
                    .trim();
                if (addLocation(tail, state)) return true;

                const words = tail.split(/\s+/).filter(Boolean);
                for (let count = Math.min(3, words.length); count >= 1; count--) {
                    const city = words.slice(-count).join(' ').replace(/^(?:of|near|around)\s+/i, '').trim();
                    if (!city || /^(?:of|in|at|near|around)$/i.test(city.split(/\s+/)[0])) continue;
                    if (addLocation(city, state)) return true;
                }

                return false;
            }

            const stateNamePattern = '(?:Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming|District of Columbia)';

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
                        addLocation(city, state);
                    }
                }
            }

            const combinedText = `${titleText || ''} ${text || ''}`.replace(/\s+/g, ' ').trim();
            const directPatterns = [
                new RegExp(`\\bLocation\\s*:\\s*([A-Za-z][A-Za-z .'-]+?),\\s*([A-Z]{2}|${stateNamePattern})\\b`, 'gi'),
                new RegExp(`\\blocated\\s+in\\s+([A-Za-z][A-Za-z .'-]+?),\\s*([A-Z]{2}|${stateNamePattern})\\b`, 'gi'),
                new RegExp(`\\b(?:Clinic|Hospital|Practice)\\s+Location\\s*:?\\s*([A-Za-z][A-Za-z .'-]+?),\\s*([A-Z]{2}|${stateNamePattern})\\b`, 'gi'),
                new RegExp(`\\|\\s*([A-Za-z][A-Za-z .'-]+?),\\s*([A-Z]{2}|${stateNamePattern})\\b`, 'gi'),
                new RegExp(`[-–—]\\s*([A-Za-z][A-Za-z .'-]+?),\\s*([A-Z]{2}|${stateNamePattern})\\b`, 'gi'),
                new RegExp(`\\b([A-Za-z][A-Za-z .'-]+?),\\s*([A-Z]{2})\\b(?=\\s*(?:\\||[-–—]|/|$|Full-Time|Part-Time))`, 'gi'),
                new RegExp(`\\b([A-Za-z][A-Za-z .'-]+?),\\s*(${stateNamePattern})\\b`, 'gi')
            ];

            for (const pattern of directPatterns) {
                for (const match of combinedText.matchAll(pattern)) {
                    if (addLocationFromCandidate(match[1], match[2])) break;
                }
                if (locations.length > 0) break;
            }

            if (locations.length === 0) {
                const cityOnlyRules = [
                    [/\bEast York\b[\s\S]{0,2500}\bLicensed Pennsylvania Veterinarian\b/i, 'PA', 'York'],
                    [/\bhere in\s+(Euless)\b/i, 'TX'],
                    [/\bin\s+(New York City|New York)\b/i, 'NY'],
                    [/\b(Brooklyn),\s*NY\b/i, 'NY'],
                    [/\b(Springfield),\s*Massachusetts\b/i, 'MA'],
                    [/\bNorthern Virginia\b[^.]{0,300}\bClarendon\b|\bClarendon\b[^.]{0,300}\bNorthern Virginia\b/i, 'VA', 'Clarendon']
                ];
                for (const [pattern, state, forcedCity] of cityOnlyRules) {
                    const match = combinedText.match(pattern);
                    if (match) {
                        const city = forcedCity || (match[1] === 'New York City' ? 'New York' : match[1]);
                        addLocation(city, state);
                        break;
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

                    if (city.length > 1 && city.length < 100) {
                        addLocationFromCandidate(city, state);
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

                const tailZipCut = cleaned.match(new RegExp(`^(.*?(?:,\\s*|\\s+)(?:[A-Z]{2}|D\\.?\\s*C\\.?|${stateNamePattern})[,\\s]+\\d{5}(?:-\\d{4})?\\b)`, 'i'));
                if (tailZipCut) cleaned = tailZipCut[1].trim();
                return cleaned;
            }

            function isLikelyCityToken(value) {
                const city = (value || '').trim();
                if (!city) return false;
                if (city.length > 40) return false;
                if (/\d/.test(city)) return false;
                if (streetTokenRegex.test(city) && !/^St\.?\s+[A-Za-z]/i.test(city)) return false;
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
                const fullState = getFullStateName(normalizedState);

                return {
                    streetAddress: normalizedStreet,
                    city: normalizedCity,
                    state: fullState,
                    zipCode: normalizedZip,
                    location: formatLocation(normalizedCity, fullState)
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

                // "Street, City, ST 12345"
                let match = candidate.match(/^(.+?),\s*([^,]+?),\s*([A-Z]{2}|D\.?\s*C\.?)\s*(\d{5}(?:-\d{4})?)\b/i);
                if (match) {
                    const result = buildAddressResult(match[1], match[2], match[3], match[4]);
                    if (result.streetAddress) return result;
                }

                // "Street, City ST 12345" (missing comma before state)
                match = candidate.match(/^(.+?),\s*([A-Za-z][A-Za-z\s.'-]+?)\s+([A-Z]{2}|D\.?\s*C\.?)\s*(\d{5}(?:-\d{4})?)\b/i);
                if (match) {
                    const result = buildAddressResult(match[1], match[2], match[3], match[4]);
                    if (result.streetAddress) return result;
                }

                // "Street, City, FullState 12345"
                match = candidate.match(new RegExp(`^(.+?),\\s*([^,]+?),\\s*(${stateNamePattern})\\s*(\\d{5}(?:-\\d{4})?)?\\b`, 'i'));
                if (match) {
                    const result = buildAddressResult(match[1], match[2], match[3], match[4] || '');
                    if (result.streetAddress) return result;
                }

                // "Street City, FullState, 12345"
                match = candidate.match(new RegExp(`^(.+?\\b(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Trl|Trail|Loop|Pike|Turnpike|Route|Broadway)\\.?(?:\\s+(?:N|S|E|W|NE|NW|SE|SW|N\\.W\\.|N\\.E\\.|S\\.W\\.|S\\.E\\.))?)\\s+([A-Za-z][A-Za-z\\s.'-]+),\\s*(${stateNamePattern}),\\s*(\\d{5}(?:-\\d{4})?)\\b`, 'i'));
                if (match) {
                    const result = buildAddressResult(match[1], match[2], match[3], match[4]);
                    if (result.streetAddress) return result;
                }

                // "Street City, ST 12345" (no comma between street and city)
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

                // "Street, City, ST" without zip
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
            // Keep parent-client JSON-LD as a fallback only. It is often not the clinic name.
            const hiringOrgMatch = text.match(/Hiring Organization:\s*([^\n]+)/i);
            const hiringOrgName = (hiringOrgMatch?.[1] || '').trim();

            // Greenhouse popup pattern: "<Hospital Name> is hiring ..."
            const hiringSentenceMatch = text.match(/([A-Z][\w&'().\/\-\s]{2,}?(?:Animal\s+Hospital|Veterinary\s+(?:Hospital|Center|Clinic|Care|Specialists?|Medical\s+Group)|Pet\s+(?:Hospital|Clinic|Care)|Emergency\s+(?:Hospital|Center|Clinic)|The\s+[A-Z][\w\s]+Service)(?:\s*[-–—]\s*[A-Za-z0-9 .'-]+)?)(?:\s+(?:in|at)\s+[A-Za-z0-9 .'-]+)?\s+is hiring\b/i);
            if (hiringSentenceMatch) {
                const candidate = hiringSentenceMatch[1].replace(/\s+/g, ' ').trim();
                if (!isGenericParentHospitalName(candidate)) return candidate;
            }

            // Try to find "Position at [Hospital Name]"
            const positionAtMatch = text.match(/Position at\s+((?:[\w'.&-]+\s+){1,8}(?:Animal\s+Hospital|Veterinary\s+(?:Hospital|Center|Clinic|Care|Specialists?)|Pet\s+(?:Hospital|Clinic|Care)|Emergency\s+(?:Hospital|Center|Clinic)|The\s+[A-Z][\w\s]+Service))/i);
            if (positionAtMatch) {
                const candidate = positionAtMatch[1].trim();
                if (!isGenericParentHospitalName(candidate)) return candidate;
            }

            // Try to find hospital name from description
            const hospitalMatch = text.match(/at\s+((?:[\w'.&-]+\s+){1,5}(?:Animal\s+Hospital|Veterinary\s+(?:Hospital|Center|Clinic|Care|Specialists?)|Pet\s+(?:Hospital|Clinic|Care)|Emergency\s+(?:Hospital|Center|Clinic)|The\s+[A-Z][\w\s]+Service))\b/i);
            if (hospitalMatch) {
                const candidate = hospitalMatch[1].trim();
                if (!isGenericParentHospitalName(candidate)) return candidate;
            }

            if (hiringOrgName && !isGenericParentHospitalName(hiringOrgName)) return hiringOrgName;
            return '';
        }

        function extractWebsite(text) {
            return extractWebsiteUrlFromDescription(text);
        }

        // Job Type is intentionally binary. Part-Time is used only when the
        // description mentions part-time without also mentioning full-time.
        function extractJobType(text) {
            return getNormalizedJobType(text);
        }

        function extractPhone(text) {
            const match = (text || '').match(/(?<!\d)(?:\+?1[-.\s]?)?\(?([2-9]\d{2})\)?[-.\s]+(\d{3})[-.\s]+(\d{4})(?!\d)/);
            return match ? `(${match[1]}) ${match[2]}-${match[3]}` : '';
        }

        function extractExperience(text) {
            if (!text) return '';

            const yearToken = '(?:years?|yrs?\\.?)';
            const qualificationsSection = extractQualificationsSection(text);
            const qualificationLines = qualificationsSection ? qualificationsSection.split('\n') : [];
            const generalLines = text.split('\n').filter(line =>
                /\b(?:minimum|min\.?|at least|required|preferred|must|candidate|applicant|experience\s*:|you(?:'ll| will)?\s+(?:have|bring))\b|\b\d+\+\s*years?\b/i.test(line)
            );

            const prioritizedLines = [...qualificationLines, ...generalLines]
                .map(line => line.trim())
                .filter(Boolean)
                .filter(line => /\b(?:experience|experienced|minimum|min\.?|at least|required|requirements?|qualifications?|practice setting|years in practice)\b/i.test(line))
                .filter(line => !/\b(?:our team has|our (?:medical director|doctor|veterinarian|practice|hospital)|(?:over|more than)\s+\d+\s+years of experience|years of experience in specialty and emergency services|serving\s+the\s+community|has served|founded\s+in|we offer|benefits|medical(?:,\s*|\s+)dental)\b/i.test(line));

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
        const address = extractAddress(descriptionText);
        const locations = [];
        if (address.city && address.state) {
            locations.push({ city: address.city, state: address.state, location: address.location });
        } else {
            const extractedLocations = extractLocations(descriptionText, positionTitle);
            if (extractedLocations.length > 0) {
                locations.push(extractedLocations[0]);
            }
        }
        const hospitalName = extractHospitalName(descriptionText);
        const jobType = extractJobType(descriptionText);
        const experience = extractExperience(descriptionText);
        const website = extractWebsite(descriptionText);
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
            website,
            phone
        };
    }

    // Google Maps scraping function to get street address and zip code
    // Opens a Google Maps search tab, injects scraper that:
    //   1. Waits for search results to load
    //   2. Matches the hospital name from aria-labels on search result links
    //   3. Clicks the matching result
    //   4. Waits for place detail panel and extracts address
    // Retries with simplified search query if first attempt fails.
    async function fetchAddressFromGoogleMaps(hospitalName, location, originalHospitalName = '', expectedLocationText = location) {
        // Build search query: "Hospital Name, City, State"
        // If city/state is unavailable, search with hospital name only.
        const composeMapsQuery = (name, loc) => {
            const left = (name || '').trim();
            const right = (loc || '').trim();
            if (left && right) return `${left}, ${right}`;
            return left || right || '';
        };

        const searchQuery = composeMapsQuery(hospitalName, location);
        const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`;

        function emptyAddressResult() {
            return { streetAddress: '', zipCode: '', city: '', state: '', fullAddress: '', website: '', phone: '' };
        }

        const expectedLocation = parseExpectedLocation(expectedLocationText);

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

        function isStateValue(value) {
            const normalized = normalizeStateForCompare(value);
            return !!(normalized && stateAbbreviations[normalized]);
        }

        function parseExpectedLocation(locationText) {
            const parts = (locationText || '').split(',').map(part => part.trim()).filter(Boolean);
            if (parts.length === 1 && isStateValue(parts[0])) {
                return { city: '', state: normalizeStateForCompare(parts[0]) };
            }
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

            if (expectedCity && resultCity && resultCity !== expectedCity) return false;
            if (expectedState && !resultState && (result.streetAddress || result.zipCode || result.fullAddress)) return false;
            if (expectedState && resultState && resultState !== expectedState) return false;
            return true;
        }

        function filterDataForExpectedLocation(data, sourceLabel, allowMismatchFallback = false) {
            const result = data || emptyAddressResult();
            const hasLocationSignal = !!(result.streetAddress || result.zipCode || result.fullAddress || result.city || result.state);

            if (hasLocationSignal && !resultMatchesExpectedLocation(result)) {
                if (allowMismatchFallback && (result.streetAddress || result.zipCode)) {
                    console.warn(`Using fallback address outside requested location "${expectedLocationText}" from "${sourceLabel}": ${result.fullAddress || [result.city, result.state, result.zipCode].filter(Boolean).join(', ')}`);
                    return result;
                }
                console.warn(`Ignoring address result outside requested location "${expectedLocationText}" from "${sourceLabel}": ${result.fullAddress || [result.city, result.state, result.zipCode].filter(Boolean).join(', ')}`);
                return emptyAddressResult();
            }

            return result;
        }

        function mergeMapsData(primary, secondary, sourceLabel = '') {
            const primaryHasAddress = !!(primary.streetAddress || primary.zipCode);
            const safeSecondary = filterDataForExpectedLocation(secondary, sourceLabel, !primaryHasAddress);
            return {
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
                const candidateQueries = [];
                const withLocation = composeMapsQuery(normalizedName, location).replace(/\s+/g, ' ').trim();
                if (withLocation) candidateQueries.push(withLocation);
                const hospitalOnly = composeMapsQuery(normalizedName, '').replace(/\s+/g, ' ').trim();
                if (hospitalOnly) candidateQueries.push(hospitalOnly);

                for (const query of candidateQueries) {
                    const key = query.toLowerCase();
                    if (seen.has(key)) continue;
                    seen.add(key);
                    queries.push(query);
                }
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

                const withoutLocationSuffix = base.replace(/\s*[-â€“â€”]\s*[A-Z][a-zA-Z\s.'-]+$/, '').trim();
                const withoutParens = base.replace(/\s*\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
                const expandedParens = base.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
                const plain = base.replace(/&/g, 'and').replace(/[-â€“â€”()]/g, ' ').replace(/\s+/g, ' ').trim();

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
                                        phone: data.phone || ''
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

        // Attempt 1: search with exact hospital name + city, state
        console.log(`ðŸ” Google Maps search: "${searchQuery}"`);
        let data = mergeMapsData(emptyAddressResult(), await scrapeGoogleMapsTabSafe(mapsUrl, searchQuery), searchQuery);

        // Attempt 2: if failed, try with & â†’ and, remove dashes/parens
        if (needsMapsRetry(data)) {
            const simplifiedName = hospitalName
                .replace(/&/g, 'and')
                .replace(/[-â€“â€”()]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            const altQuery = composeMapsQuery(simplifiedName, location);
            if (altQuery !== searchQuery) {
                console.log(`â†» Retry with: "${altQuery}"`);
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

        // Final hospital-only Maps retry to maximize coverage for rows that still miss address.
        if (needsMapsRetry(data)) {
            for (const rawName of [hospitalName, originalHospitalName].filter(Boolean)) {
                if (!needsMapsRetry(data)) break;
                const hospitalOnlyQuery = composeMapsQuery(rawName, '').replace(/\s+/g, ' ').trim();
                if (!hospitalOnlyQuery) continue;
                console.log(`Final hospital-only Maps retry: "${hospitalOnlyQuery}"`);
                const hospitalOnlyUrl = `https://www.google.com/maps/search/${encodeURIComponent(hospitalOnlyQuery)}`;
                const retryData = await scrapeGoogleMapsTabSafe(hospitalOnlyUrl, hospitalOnlyQuery);
                data = mergeMapsData(data, retryData, hospitalOnlyQuery);
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
            phone: data.phone || ''
        };
    }

    function emptyVerifiedAddressResult(error = '') {
        return {
            streetAddress: '', zipCode: '', city: '', state: '', fullAddress: '',
            website: '', phone: '', businessName: '', mapsUrl: '', searchUrl: '',
            placeId: '', matchScore: 0, confidence: 0, source: '', error
        };
    }

    function runAddressScraperTab(url, scraperFile, label, timeoutMs) {
        return new Promise((resolve) => {
            let settled = false;
            let tabId = null;
            let listener = null;

            const finish = (result) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                if (listener) chrome.tabs.onUpdated.removeListener(listener);
                if (tabId) chrome.tabs.remove(tabId).catch(() => {});
                resolve(result || emptyVerifiedAddressResult());
            };

            const execute = () => {
                if (settled || !tabId) return;
                if (listener) chrome.tabs.onUpdated.removeListener(listener);
                listener = null;
                setTimeout(() => {
                    if (settled) return;
                    chrome.scripting.executeScript({
                        target: { tabId },
                        files: ['address-validation.js', scraperFile]
                    }).then((results) => {
                        finish(results?.[0]?.result || emptyVerifiedAddressResult(`No data returned for ${label}.`));
                    }).catch((error) => {
                        finish(emptyVerifiedAddressResult(error?.message || `${label} extraction failed.`));
                    });
                }, 1200);
            };

            const timeout = setTimeout(() => {
                finish(emptyVerifiedAddressResult(`${label} timed out.`));
            }, timeoutMs);

            chrome.tabs.create({ url, active: false }, (tab) => {
                if (chrome.runtime.lastError || !tab?.id) {
                    finish(emptyVerifiedAddressResult(chrome.runtime.lastError?.message || `Could not open ${label}.`));
                    return;
                }
                tabId = tab.id;
                listener = (updatedTabId, info) => {
                    if (updatedTabId === tabId && info.status === 'complete') execute();
                };
                chrome.tabs.onUpdated.addListener(listener);
                chrome.tabs.get(tabId).then(currentTab => {
                    if (currentTab?.status === 'complete') execute();
                }).catch(() => {});
            });
        });
    }

    function normalizeAddressCandidate(candidate) {
        const result = { ...emptyVerifiedAddressResult(), ...(candidate || {}) };
        result.website = normalizeClinicWebsite(result.website);
        result.phone = addressValidation?.normalizePhone(result.phone) || '';
        result.matchScore = Number(result.matchScore) || 0;
        return result;
    }

    function candidateProvidesRequestedFields(candidate, requestedFields) {
        return requestedFields.every(field => hasSavedValue(candidate?.[field]));
    }

    function mergeMatchingBusinessResults(primary, secondary) {
        if (!primary?.businessName) return { ...secondary };
        if (!secondary?.businessName || !addressValidation.sameBusiness(primary, secondary)) return primary;
        const merged = { ...primary };
        for (const field of ['streetAddress', 'zipCode', 'city', 'state', 'fullAddress', 'website', 'phone', 'mapsUrl', 'searchUrl', 'placeId']) {
            if (!hasSavedValue(merged[field]) && hasSavedValue(secondary[field])) merged[field] = secondary[field];
        }
        merged.matchScore = Math.max(Number(primary.matchScore) || 0, Number(secondary.matchScore) || 0);
        merged.confidence = Math.max(Number(primary.confidence) || 0, Number(secondary.confidence) || 0);
        merged.source = primary.source === secondary.source ? primary.source : 'google_maps+google_search';
        return merged;
    }

    async function fetchVerifiedBusinessData(hospitalName, locationParts, originalHospitalName = '', requestedFields = []) {
        if (!addressValidation) throw new Error('Address validation helpers are unavailable. Reload the extension.');

        const expectedNames = [...new Set([hospitalName, originalHospitalName].filter(Boolean))];
        const city = locationParts?.inferredCity ? '' : (locationParts?.city || '');
        const state = locationParts?.state || '';
        const searchLocation = [locationParts?.city || '', state].filter(Boolean).join(', ');
        const composeQuery = name => [name, searchLocation].filter(Boolean).join(', ');
        const exactQuery = composeQuery(hospitalName);
        const simplifiedName = String(hospitalName || '')
            .replace(/&/g, 'and')
            .replace(/[-–—()]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const queryPlan = [
            { type: 'maps', query: exactQuery, label: `Google Maps: ${exactQuery}` }
        ];
        const simplifiedQuery = composeQuery(simplifiedName);
        if (simplifiedQuery && simplifiedQuery.toLowerCase() !== exactQuery.toLowerCase()) {
            queryPlan.push({ type: 'maps', query: simplifiedQuery, label: `Google Maps: ${simplifiedQuery}` });
        }
        queryPlan.push({ type: 'search', query: exactQuery, label: `Google Search: ${exactQuery}` });

        let accepted = emptyVerifiedAddressResult();
        const rejectionReasons = [];
        for (const attempt of queryPlan) {
            const url = attempt.type === 'maps'
                ? `https://www.google.com/maps/search/${encodeURIComponent(attempt.query)}`
                : `https://www.google.com/search?q=${encodeURIComponent(attempt.query)}`;
            const scraper = attempt.type === 'maps' ? 'google-maps-scraper.js' : 'google-search-scraper.js';
            const raw = await runAddressScraperTab(url, scraper, attempt.label, attempt.type === 'maps' ? 22000 : 20000);
            const candidate = normalizeAddressCandidate(raw);
            const verdict = addressValidation.validateCandidate(candidate, { expectedNames, city, state });

            if (!verdict.valid) {
                rejectionReasons.push(`${attempt.label}: ${candidate.error || verdict.reason}`);
                continue;
            }

            candidate.confidence = verdict.confidence;
            if (accepted.businessName && !addressValidation.sameBusiness(accepted, candidate)) {
                rejectionReasons.push(`${attempt.label}: matched a different business than the accepted result.`);
                continue;
            }
            accepted = mergeMatchingBusinessResults(accepted, candidate);
            if (candidateProvidesRequestedFields(accepted, requestedFields)) break;
        }

        if (!accepted.businessName) {
            accepted.error = rejectionReasons.filter(Boolean).join(' | ') || 'No verified business result was found.';
        }
        return accepted;
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

    function getJobKey(job, index = 0) {
        return addressValidation?.stableJobKey(job) || job.jobId || job.reqId || job.id || job.link || `${job.title || 'job'}-${index}`;
    }

    function updateSelectionControls() {
        const selectedVisibleCount = visibleJobKeys.filter(key => selectedJobKeys.has(key)).length;

        if (selectAllJobsCheckbox) {
            selectAllJobsCheckbox.checked = visibleJobKeys.length > 0 && selectedVisibleCount === visibleJobKeys.length;
            selectAllJobsCheckbox.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleJobKeys.length;
        }

        if (deleteSelectedJobsButton) {
            deleteSelectedJobsButton.disabled = selectedJobKeys.size === 0;
            deleteSelectedJobsButton.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M9,3V4H4V6H5V19A2,2 0 0,0 7,21H17A2,2 0 0,0 19,19V6H20V4H15V3H9M7,6H17V19H7V6M9,8V17H11V8H9M13,8V17H15V8H13Z"/>
                </svg>
                Delete Jobs (${selectedJobKeys.size})
            `;
        }
    }

    function openDescriptionModal(description) {
        if (!descriptionModal || !modalDescriptionContent) return;
        modalDescriptionContent.textContent = description || 'No description available.';
        descriptionModal.classList.remove('hidden');
        descriptionModal.classList.add('show');
    }

    function closeDescriptionModal() {
        if (!descriptionModal) return;
        descriptionModal.classList.add('hidden');
        descriptionModal.classList.remove('show');
    }

    function displayRecords(jobs) {
        tableBody.innerHTML = '';
        displayedJobs = jobs;
        updateJobCount(jobs.length);
        visibleJobKeys = jobs.map((job, index) => getJobKey(job, index));

        if (jobs.length === 0) {
            table.style.display = 'none';
            emptyState.classList.remove('hidden');
            updateSelectionControls();
            return;
        }

        table.style.display = 'table';
        emptyState.classList.add('hidden');

        jobs.forEach((job, index) => {
            const jobKey = getJobKey(job, index);
            const row = tableBody.insertRow();
            row.dataset.jobKey = jobKey;
            if (selectedJobKeys.has(jobKey)) {
                row.classList.add('selected-row');
            }

            // Mark new jobs with green background
            if (job.isNewLocation) {
                row.style.backgroundColor = '#d1fae5';
            }

            const selectCell = row.insertCell(0);
            selectCell.className = 'select-cell';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'job-select-checkbox';
            checkbox.dataset.jobKey = jobKey;
            checkbox.checked = selectedJobKeys.has(jobKey);
            selectCell.appendChild(checkbox);

            row.insertCell(1).textContent = String(index + 1);
            row.insertCell(2).textContent = job.title;
            const jobIdCell = row.insertCell(3);
            jobIdCell.textContent = job.jobId || 'N/A';
            jobIdCell.style.fontFamily = "'Consolas', 'Monaco', monospace";
            jobIdCell.style.fontSize = '12px';
            jobIdCell.style.color = '#64748b';

            row.insertCell(4).textContent = job.hospital || '-';
            row.insertCell(5).textContent = AGGREGATOR_NAME;
            row.insertCell(6).textContent = job.streetAddress || '-';
            row.insertCell(7).textContent = job.city || '-';
            row.insertCell(8).textContent = job.state || '-';
            row.insertCell(9).textContent = job.zipCode || job.postalCode || '-';
            row.insertCell(10).textContent = job.phone || '-';

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

            row.insertCell(12).textContent = job.location || '-';
            row.insertCell(13).textContent = job.areaOfPractice || '-';
            row.insertCell(14).textContent = job.position || '-';
            row.insertCell(15).textContent = normalizeNumericSalary(job.salary) || '-';
            row.insertCell(16).textContent = getNormalizedJobType(job.description);
            row.insertCell(17).textContent = job.experience || '-';

            const linkCell = row.insertCell(18);
            const link = document.createElement('a');
            link.href = job.link;
            link.textContent = 'View';
            link.target = '_blank';
            linkCell.appendChild(link);

            const descCell = row.insertCell(19);
            if (job.description) {
                const viewButton = document.createElement('button');
                viewButton.type = 'button';
                viewButton.className = 'view-description-btn';
                viewButton.dataset.jobKey = jobKey;
                viewButton.textContent = 'View';
                descCell.appendChild(viewButton);
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

        const headers = ['Job Title', 'Job ID', 'Greenhouse Job ID', 'Requisition ID', 'Hospital', 'Aggregator', 'Department', 'Office', 'Street Address', 'City', 'State', 'Zip Code', 'Phone', 'Website', 'Location', 'Area of Practice', 'Position', 'Salary', 'Job Type', 'Experience', 'First Published', 'Updated At', 'Application Deadline', 'Detail Fetch Status', 'Detail Fetch Error', 'Address Fetch Status', 'Address Fetch Error', 'Address Fetch Source', 'Address Match Confidence', 'Address Matched Business', 'Address Source URL', 'Address Updated Fields', 'Link', 'Description'];
        const csvContent = [
            headers.join(','),
            ...allJobs.map((job) => [
                `"${(job.title || '').replace(/"/g, '""')}"`,
                `"${(job.jobId || '').replace(/"/g, '""')}"`,
                `"${String(job.greenhouseJobId || '').replace(/"/g, '""')}"`,
                `"${String(job.requisitionId || '').replace(/"/g, '""')}"`,
                `"${(job.hospital || '').replace(/"/g, '""')}"`,
                `"${AGGREGATOR_NAME}"`,
                `"${(job.department || '').replace(/"/g, '""')}"`,
                `"${(job.office || '').replace(/"/g, '""')}"`,
                `"${(job.streetAddress || '').replace(/"/g, '""')}"`,
                `"${(job.city || '').replace(/"/g, '""')}"`,
                `"${(job.state || '').replace(/"/g, '""')}"`,
                `"${(job.zipCode || job.postalCode || '').replace(/"/g, '""')}"`,
                `"${(job.phone || '').replace(/"/g, '""')}"`,
                `"${(job.website || '').replace(/"/g, '""')}"`,
                `"${(job.location || '').replace(/"/g, '""')}"`,
                `"${(job.areaOfPractice || '').replace(/"/g, '""')}"`,
                `"${(job.position || '').replace(/"/g, '""')}"`,
                `"${normalizeNumericSalary(job.salary).replace(/"/g, '""')}"`,
                `"${getNormalizedJobType(job.description)}"`,
                `"${(job.experience || '').replace(/"/g, '""')}"`,
                `"${(job.firstPublished || '').replace(/"/g, '""')}"`,
                `"${(job.updatedAt || '').replace(/"/g, '""')}"`,
                `"${(job.applicationDeadline || '').replace(/"/g, '""')}"`,
                `"${(job.detailsFetchStatus || '').replace(/"/g, '""')}"`,
                `"${(job.detailsFetchError || '').replace(/"/g, '""')}"`,
                `"${(job.addressFetchStatus || '').replace(/"/g, '""')}"`,
                `"${(job.addressFetchError || '').replace(/"/g, '""')}"`,
                `"${(job.addressFetchSource || '').replace(/"/g, '""')}"`,
                `"${String(job.addressMatchConfidence || '').replace(/"/g, '""')}"`,
                `"${(job.addressMatchedBusiness || '').replace(/"/g, '""')}"`,
                `"${(job.addressSourceUrl || '').replace(/"/g, '""')}"`,
                `"${(Array.isArray(job.addressUpdatedFields) ? job.addressUpdatedFields.join(', ') : (job.addressUpdatedFields || '')).replace(/"/g, '""')}"`,
                `"${(job.link || '').replace(/"/g, '""')}"`,
                `"${(job.description || '').replace(/"/g, '""')}"`
            ].join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);

        link.setAttribute('href', url);
        link.setAttribute('download', `VPP_jobs_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        showToast(`Exported ${allJobs.length} jobs to CSV!`, 'success');
    }

    // Initialize
    chrome.storage.local.get(['vipvetJobs'], (result) => {
        const normalized = normalizeVipVetJobs(result.vipvetJobs || []);
        allJobs = normalized.jobs;
        if (normalized.changed) {
            chrome.storage.local.set({ vipvetJobs: allJobs });
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

    if (selectAllJobsCheckbox) {
        selectAllJobsCheckbox.addEventListener('change', () => {
            visibleJobKeys.forEach(key => {
                if (selectAllJobsCheckbox.checked) {
                    selectedJobKeys.add(key);
                } else {
                    selectedJobKeys.delete(key);
                }
            });
            displayRecords(displayedJobs);
        });
    }

    tableBody.addEventListener('change', (event) => {
        const checkbox = event.target.closest('.job-select-checkbox');
        if (!checkbox) return;

        if (checkbox.checked) {
            selectedJobKeys.add(checkbox.dataset.jobKey);
            checkbox.closest('tr')?.classList.add('selected-row');
        } else {
            selectedJobKeys.delete(checkbox.dataset.jobKey);
            checkbox.closest('tr')?.classList.remove('selected-row');
        }
        updateSelectionControls();
    });

    tableBody.addEventListener('click', (event) => {
        const button = event.target.closest('.view-description-btn');
        if (!button) return;

        const job = allJobs.find((item, index) => getJobKey(item, index) === button.dataset.jobKey);
        openDescriptionModal(job?.description || '');
    });

    if (deleteSelectedJobsButton) {
        deleteSelectedJobsButton.addEventListener('click', () => {
            if (selectedJobKeys.size === 0) return;
            if (!confirm(`Delete ${selectedJobKeys.size} selected job(s)?`)) return;

            allJobs = allJobs.filter((job, index) => !selectedJobKeys.has(getJobKey(job, index)));
            selectedJobKeys.clear();
            chrome.storage.local.set({ vipvetJobs: allJobs }, () => {
                displayRecords(allJobs);
                showToast('Selected jobs deleted!', 'success');
            });
        });
    }

    if (closeDescriptionModalButton) {
        closeDescriptionModalButton.addEventListener('click', closeDescriptionModal);
    }

    if (descriptionModal) {
        descriptionModal.classList.add('hidden');
        descriptionModal.addEventListener('click', (event) => {
            if (event.target === descriptionModal) {
                closeDescriptionModal();
            }
        });
    }

    // Clear details only (area of practice, position, salary, experience)
    const clearDetailsBtn = document.getElementById('clearDetailsBtn');
    clearDetailsBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all job details? This will remove Area of Practice, Position, Salary, Job Type, and Experience from all jobs.')) {
            chrome.storage.local.get(['vipvetJobs'], (data) => {
                const jobs = data.vipvetJobs || [];
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
                    job.detailsFetchStatus = '';
                    job.detailsFetchError = '';
                    job.detailsFetchAttemptedAt = '';
                    job.detailsExtractionVersion = 0;
                });

                chrome.storage.local.set({ vipvetJobs: jobs }, () => {
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
            chrome.storage.local.get(['vipvetJobs'], (data) => {
                const jobs = data.vipvetJobs || [];
                let clearedCount = 0;

                jobs.forEach(job => {
                    if (job.description) {
                        job.description = '';
                        clearedCount++;
                    }
                    job.descriptionFetchStatus = '';
                    job.descriptionFetchError = '';
                    job.descriptionFetchAttemptedAt = '';
                    job.detailsFetchStatus = '';
                    job.detailsFetchError = '';
                    job.detailsFetchAttemptedAt = '';
                    job.detailsExtractionVersion = 0;
                });

                chrome.storage.local.set({ vipvetJobs: jobs }, () => {
                    allJobs = jobs;
                    displayRecords(allJobs);
                    showToast(`Cleared descriptions from ${clearedCount} jobs!`, 'success');
                });
            });
        }
    });

    // Clear address/contact enrichment and its retry state.
    const clearAddressesBtn = document.getElementById('clearAddresses');
    clearAddressesBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all address data? This will remove City, State, Street Address, and Zip Code from all jobs (Location column will be kept).')) {
            chrome.storage.local.get(['vipvetJobs'], (data) => {
                const jobs = data.vipvetJobs || [];
                let clearedCount = 0;

                jobs.forEach(job => {
                    if (job.city || job.state || job.streetAddress || job.zipCode || job.website || job.phone) {
                        job.city = '';
                        job.state = '';
                        job.streetAddress = '';
                        job.zipCode = '';
                        job.postalCode = '';
                        job.website = '';
                        job.phone = '';
                        clearedCount++;
                    }
                    job.addressFetchAttemptedAt = '';
                    job.addressExtractionVersion = 0;
                    job.addressFetchStatus = '';
                    job.addressFetchError = '';
                    job.addressFetchSource = '';
                    job.addressMatchConfidence = '';
                    job.addressMatchedBusiness = '';
                    job.addressSourceUrl = '';
                    job.addressPlaceId = '';
                    job.addressUpdatedFields = [];
                });

                chrome.storage.local.set({ vipvetJobs: jobs }, () => {
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
            chrome.storage.local.set({ vipvetJobs: [] }, () => {
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

        const result = await chrome.storage.local.get(['vipvetJobs']);
        const jobs = result.vipvetJobs || [];

        if (jobs.length === 0) {
            showToast('No job records to send.', 'error');
            return;
        }

        const jobsToSend = jobs.map(job => ({
            job_title: job.title,
            job_id: job.jobId || '',
            department_id: job.jobId || '',
            hospital: job.hospital,
            aggregator: AGGREGATOR_NAME,
            street_address: job.streetAddress || '',
            parent_client: AGGREGATOR_NAME,
            city: job.city,
            state: job.state,
            zip_code: job.zipCode || job.postalCode || '',
            phone: job.phone || '',
            website: job.website || '',
            location: job.location,
            area_of_practice: job.areaOfPractice || '',
            position: job.position || '',
            salary: normalizeNumericSalary(job.salary),
            job_type: getNormalizedJobType(job.description),
            experience: job.experience || '',
            greenhouse_job_id: job.greenhouseJobId || '',
            requisition_id: job.requisitionId || '',
            internal_job_id: job.internalJobId || '',
            department: job.department || '',
            office: job.office || '',
            first_published: job.firstPublished || '',
            updated_at: job.updatedAt || '',
            application_deadline: job.applicationDeadline || '',
            detail_fetch_status: job.detailsFetchStatus || '',
            detail_fetch_error: job.detailsFetchError || '',
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

    function isGenericVipVetDescription(description) {
        const text = (description || '').replace(/\s+/g, ' ').trim();
        if (!text) return true;
        const hasSiteChrome = /Join Our Team\s+Veterinarians\s+New Grads|info@vip-vet\.com|3401 Mallory Lane/i.test(text);
        const hasJobBody = /\b(?:responsibilities|requirements|qualifications|about the hospital|what to expect|salary|compensation|doctor of veterinary medicine|DVM|apply for this job)\b/i.test(text);
        return hasSiteChrome && !hasJobBody;
    }

    if (getDescriptionsBtn) {
        getDescriptionsBtn.addEventListener('click', async () => {
            if (isGettingDescriptions) {
                showToast('Already getting descriptions. Please wait...', 'error');
                return;
            }

            const data = await chrome.storage.local.get(['vipvetJobs']);
            const jobs = data.vipvetJobs || [];

            const jobsWithoutDesc = jobs
                .map((job, index) => ({ job, index }))
                .filter(item => (!item.job.description || isGenericVipVetDescription(item.job.description)) && item.job.link);
            if (jobsWithoutDesc.length === 0) {
                showToast('All jobs already have descriptions!', 'success');
                return;
            }

            isGettingDescriptions = true;
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

            let successCount = 0;
            let failureCount = 0;
            let fatalError = '';
            try {
                for (let queueIndex = 0; queueIndex < jobsWithoutDesc.length; queueIndex++) {
                    const { index } = jobsWithoutDesc[queueIndex];
                    const job = jobs[index];
                    progressText.textContent = `${queueIndex + 1} / ${jobsWithoutDesc.length}`;
                    progressBar.style.width = `${((queueIndex + 1) / jobsWithoutDesc.length) * 100}%`;
                    getDescriptionsBtn.textContent = `Getting... (${queueIndex + 1}/${jobsWithoutDesc.length})`;

                    try {
                        const apiJob = await fetchGreenhouseJob(job);
                        const description = applyGreenhouseMetadata(job, apiJob);
                        if (!description || description.length < 50) {
                            throw new Error('Greenhouse returned no usable description.');
                        }
                        job.descriptionFetchStatus = 'success';
                        job.descriptionFetchError = '';
                        successCount++;
                    } catch (error) {
                        job.descriptionFetchStatus = 'failed';
                        job.descriptionFetchError = error?.name === 'AbortError' ? 'Request timed out.' : (error?.message || 'Unknown error');
                        failureCount++;
                        console.warn(`Description fetch failed for ${job.title || job.jobId || 'job'}:`, error);
                    }
                    job.descriptionFetchAttemptedAt = new Date().toISOString();
                    await chrome.storage.local.set({ vipvetJobs: jobs });
                }
                allJobs = jobs;
                displayRecords(allJobs);
            } catch (error) {
                fatalError = error?.message || 'The description queue stopped unexpectedly.';
                console.error('Description queue failed:', error);
            } finally {
                isGettingDescriptions = false;
                getDescriptionsBtn.disabled = false;
                getDescriptionsBtn.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20M13,13H11V18H13V13M13,9.5H11V11.5H13V9.5Z"/>
                    </svg>
                    Get Descriptions
                `;
                progressSection.classList.add('hidden');
            }

            if (fatalError) {
                showToast(`Description fetch stopped: ${fatalError}`, 'error');
            } else if (failureCount > 0) {
                showToast(`Descriptions: ${successCount} fetched, ${failureCount} failed.`, 'error');
            } else {
                showToast(`Fetched ${successCount} descriptions.`, 'success');
            }
        });
    }

    // ============ FETCH DETAILS ============

    async function deleteRecordsMissingCityOrState() {
        const stored = await chrome.storage.local.get(['vipvetJobs']);
        const jobs = stored.vipvetJobs || [];
        const hasValue = value => !!(value && String(value).trim() && String(value).trim() !== '-');
        const retainedJobs = [];
        const removedJobs = [];

        for (const job of jobs) {
            if (hasValue(job.city) && hasValue(job.state)) retainedJobs.push(job);
            else removedJobs.push(job);
        }

        if (!removedJobs.length) return 0;

        await chrome.storage.local.set({ vipvetJobs: retainedJobs });
        for (const job of removedJobs) {
            selectedJobKeys.delete(getJobKey(job));
        }
        allJobs = retainedJobs;
        displayRecords(allJobs);
        return removedJobs.length;
    }

    fetchDetailsBtn.addEventListener('click', async () => {
        if (isFetchingDetails) {
            showToast('Already fetching details. Please wait...', 'error');
            return;
        }

        const data = await chrome.storage.local.get(['vipvetJobs']);
        const jobs = data.vipvetJobs || [];

        if (jobs.length === 0) {
            showToast('No jobs found. Please scrape jobs first.', 'error');
            return;
        }

        // Analyze each titled job once. Missing values are valid outcomes, so an
        // explicit attempt marker controls retries instead of checking every field.
        const jobsToFetch = jobs.map((job, index) => ({ job, index, key: getJobKey(job, index) }))
            .filter(item => {
                return !!item.job.title && item.job.detailsExtractionVersion !== DETAIL_EXTRACTION_VERSION;
            });

        if (jobsToFetch.length === 0) {
            if (confirm('All eligible jobs have already been analyzed. Do you want to refresh and re-analyze all jobs?')) {
                detailsQueue = jobs.map((job, index) => ({ job, index, key: getJobKey(job, index) }))
                    .filter(item => item.job.title);
            } else {
                try {
                    const deletedCount = await deleteRecordsMissingCityOrState();
                    if (deletedCount > 0) {
                        showToast(`Deleted ${deletedCount} record(s) missing city or state.`, 'success');
                    }
                } catch (error) {
                    showToast(`Could not delete records missing city or state: ${error?.message || 'Unknown error'}`, 'error');
                }
                return;
            }
        } else {
            detailsQueue = jobsToFetch;
        }

        isFetchingDetails = true;
        currentDetailsIndex = 0;
        detailFetchSummary = { success: 0, partial: 0, failed: 0 };
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

        processNextDetail().catch(handleDetailsFatalError);
    });

    function cleanUrlCandidate(url) {
        return normalizeExternalUrl(url);
    }

    function extractLocationUrlFromDescription(description) {
        const text = description || '';
        if (!text) return '';

        const linePatterns = [
            /(?:clinic|hospital|practice)?\s*location\s*\((https?:\/\/[^)\s]+[^\s)]*)\)/i,
            /(?:clinic|hospital|practice)?\s*location\s*:\s*(https?:\/\/[^\s)]+)/i,
            /(?:directions?|map|maps?)\s*\((https?:\/\/[^)\s]+[^\s)]*)\)/i
        ];

        for (const pattern of linePatterns) {
            const match = text.match(pattern);
            const url = cleanUrlCandidate(match?.[1] || '');
            if (url) return url;
        }

        const urls = [...text.matchAll(/https?:\/\/[^\s)]+/gi)]
            .map(match => cleanUrlCandidate(match[0]))
            .filter(Boolean);

        const locationUrl = urls.find(url => /google\.com\/maps|\/maps\/|\/contact|\/location|\/locations|\/visit|\/directions/i.test(url));
        return locationUrl || '';
    }

    function extractWebsiteUrlFromDescription(description) {
        const text = description || '';
        if (!text) return '';

        const patterns = [
            /\bWebsite:\s*(https?:\/\/[^\s)]+|[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s)]*)?)/i,
            /\b(?:learn more about (?:our )?(?:amazing )?practice at|learn more about us:)\s*(https?:\/\/[^\s)]+|[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s)]*)?)/i
        ];

        for (const pattern of patterns) {
            const match = text.match(pattern);
            const url = normalizeClinicWebsite(match?.[1] || '');
            if (url) return url;
        }

        const urls = [...text.matchAll(/https?:\/\/[^\s)]+/gi)]
            .map(match => normalizeClinicWebsite(match[0]))
            .filter(Boolean);

        return urls[0] || '';
    }

    function emptyHospitalInfo() {
        return { streetAddress: '', city: '', state: '', zipCode: '', phone: '', website: '', fullAddress: '' };
    }

    function scrapeGoogleMapsLocationUrl(url) {
        return new Promise((resolve) => {
            let settled = false;
            let tabId = null;
            let listener = null;

            const finish = (result) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                if (listener) chrome.tabs.onUpdated.removeListener(listener);
                if (tabId) chrome.tabs.remove(tabId).catch(() => {});
                resolve(result || emptyHospitalInfo());
            };

            const timeout = setTimeout(() => {
                console.warn(`Google Maps location URL timeout: "${url}"`);
                finish(emptyHospitalInfo());
            }, 26000);

            chrome.tabs.create({ url, active: false }, (tab) => {
                if (!tab) {
                    finish(emptyHospitalInfo());
                    return;
                }

                tabId = tab.id;
                listener = (updatedTabId, info) => {
                    if (updatedTabId === tabId && info.status === 'complete') {
                        chrome.tabs.onUpdated.removeListener(listener);
                        listener = null;

                        setTimeout(() => {
                            if (settled) return;
                            chrome.scripting.executeScript({
                                target: { tabId },
                                files: ['address-validation.js', 'google-maps-scraper.js']
                            }).then((results) => {
                                const data = results?.[0]?.result || {};
                                finish({
                                    streetAddress: data.streetAddress || '',
                                    city: data.city || '',
                                    state: data.state || '',
                                    zipCode: data.zipCode || '',
                                    phone: data.phone || '',
                                    website: data.website || '',
                                    fullAddress: data.fullAddress || ''
                                });
                            }).catch((error) => {
                                console.warn('Could not scrape Google Maps location URL:', error);
                                finish(emptyHospitalInfo());
                            });
                        }, 1600);
                    }
                };

                chrome.tabs.onUpdated.addListener(listener);
            });
        });
    }

    function scrapeHospitalPageUrl(url) {
        return new Promise((resolve) => {
            let settled = false;
            let tabId = null;
            let listener = null;

            const finish = (result) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                if (listener) chrome.tabs.onUpdated.removeListener(listener);
                if (tabId) chrome.tabs.remove(tabId).catch(() => {});
                resolve(result || emptyHospitalInfo());
            };

            const timeout = setTimeout(() => {
                console.warn(`Hospital page timeout: "${url}"`);
                finish({ ...emptyHospitalInfo(), website: cleanUrlCandidate(url) });
            }, 22000);

            chrome.tabs.create({ url, active: false }, (tab) => {
                if (!tab) {
                    finish({ ...emptyHospitalInfo(), website: cleanUrlCandidate(url) });
                    return;
                }

                tabId = tab.id;
                listener = (updatedTabId, info) => {
                    if (updatedTabId === tabId && info.status === 'complete') {
                        chrome.tabs.onUpdated.removeListener(listener);
                        listener = null;

                        setTimeout(() => {
                            if (settled) return;
                            chrome.scripting.executeScript({
                                target: { tabId },
                                func: () => {
                                    function clean(value) {
                                        return (value || '').replace(/\s+/g, ' ').trim();
                                    }

                                    function getWebsite() {
                                        const canonical = document.querySelector('link[rel="canonical"]')?.href || '';
                                        if (canonical) return canonical;
                                        return window.location.origin + '/';
                                    }

                                    function parseAddress(fullAddress) {
                                        const raw = clean(fullAddress)
                                            .replace(/,?\s*(United States|USA)\s*$/i, '')
                                            .trim();
                                        if (!raw) return {};

                                        const zipMatch = raw.match(/^([\s\S]+?),\s*([^,]+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
                                        if (zipMatch) {
                                            return {
                                                streetAddress: clean(zipMatch[1]),
                                                city: clean(zipMatch[2]),
                                                state: clean(zipMatch[3]),
                                                zipCode: clean(zipMatch[4]),
                                                fullAddress: raw
                                            };
                                        }

                                        const looseMatch = raw.match(/(\d{1,6}\s+[\w\s.'#-]+?(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Rd|Road|Ln|Lane|Way|Ct|Court|Pl|Place|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Trl|Trail|Loop)[\w\s.,#-]*?),\s*([^,]+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/i);
                                        if (looseMatch) {
                                            return {
                                                streetAddress: clean(looseMatch[1]),
                                                city: clean(looseMatch[2]),
                                                state: clean(looseMatch[3]).toUpperCase(),
                                                zipCode: clean(looseMatch[4]),
                                                fullAddress: clean(looseMatch[0])
                                            };
                                        }

                                        return {};
                                    }

                                    function getJsonLdAddress() {
                                        const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
                                        for (const script of scripts) {
                                            try {
                                                const parsed = JSON.parse(script.textContent || 'null');
                                                const items = Array.isArray(parsed) ? parsed : [parsed];
                                                const queue = [...items];
                                                while (queue.length) {
                                                    const item = queue.shift();
                                                    if (!item || typeof item !== 'object') continue;
                                                    if (Array.isArray(item)) {
                                                        queue.push(...item);
                                                        continue;
                                                    }
                                                    if (item['@graph']) queue.push(...item['@graph']);
                                                    const address = item.address;
                                                    if (address && typeof address === 'object') {
                                                        const streetAddress = clean(address.streetAddress || '');
                                                        const city = clean(address.addressLocality || '');
                                                        const state = clean(address.addressRegion || '');
                                                        const zipCode = clean(address.postalCode || '');
                                                        if (streetAddress || city || state || zipCode) {
                                                            return {
                                                                streetAddress,
                                                                city,
                                                                state,
                                                                zipCode,
                                                                fullAddress: [streetAddress, city, [state, zipCode].filter(Boolean).join(' ')].filter(Boolean).join(', ')
                                                            };
                                                        }
                                                    }
                                                }
                                            } catch (error) {}
                                        }
                                        return {};
                                    }

                                    function getPhone() {
                                        const tel = document.querySelector('a[href^="tel:"]')?.getAttribute('href') || '';
                                        if (tel) return clean(tel.replace(/^tel:/i, ''));
                                        const text = document.body?.innerText || '';
                                        const match = text.match(/(?:phone|call|tel(?:ephone)?)[\s:]*((?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/i) ||
                                            text.match(/\b(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/);
                                        return clean(match?.[1] || match?.[0] || '');
                                    }

                                    const jsonLdAddress = getJsonLdAddress();
                                    const bodyText = document.body?.innerText || '';
                                    const bodyAddress = parseAddress(bodyText);
                                    const address = jsonLdAddress.streetAddress ? jsonLdAddress : bodyAddress;

                                    return {
                                        streetAddress: address.streetAddress || '',
                                        city: address.city || '',
                                        state: address.state || '',
                                        zipCode: address.zipCode || '',
                                        phone: getPhone(),
                                        website: getWebsite(),
                                        fullAddress: address.fullAddress || ''
                                    };
                                }
                            }).then((results) => {
                                const data = results?.[0]?.result || {};
                                finish({
                                    streetAddress: data.streetAddress || '',
                                    city: data.city || '',
                                    state: data.state || '',
                                    zipCode: data.zipCode || '',
                                    phone: data.phone || '',
                                    website: data.website || cleanUrlCandidate(url),
                                    fullAddress: data.fullAddress || ''
                                });
                            }).catch((error) => {
                                console.warn('Could not scrape hospital page URL:', error);
                                finish({ ...emptyHospitalInfo(), website: cleanUrlCandidate(url) });
                            });
                        }, 1800);
                    }
                };

                chrome.tabs.onUpdated.addListener(listener);
            });
        });
    }

    async function fetchHospitalInfoFromLocationUrl(url) {
        const cleanedUrl = cleanUrlCandidate(url);
        if (!cleanedUrl) return emptyHospitalInfo();

        if (/google\.[^/]+\/maps|maps\.app\.goo\.gl/i.test(cleanedUrl)) {
            return scrapeGoogleMapsLocationUrl(cleanedUrl);
        }

        return scrapeHospitalPageUrl(cleanedUrl);
    }

    async function processNextDetail() {
        if (currentDetailsIndex >= detailsQueue.length) {
            await finishDetailsFetching();
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
        // and resolve by stable identity rather than a possibly missing jobId.
        const data = await chrome.storage.local.get(['vipvetJobs']);
        const currentJobs = data.vipvetJobs || [];
        const currentIndex = currentJobs.findIndex((job, index) => getJobKey(job, index) === queueItem.key);

        if (currentIndex === -1) {
            // Job no longer found (shouldn't happen), skip it
            currentDetailsIndex++;
            setTimeout(() => processNextDetail().catch(handleDetailsFatalError), 50);
            return;
        }

        const job = currentJobs[currentIndex];
        let detailsList = [];
        let fetchError = '';

        // Public-board records can be refreshed from the Greenhouse API. Agency
        // dashboard records only have a hiring-plan ID, so their already-scraped
        // description is the canonical source and the missing API ID is not an error.
        if (getGreenhouseJobId(job)) {
            try {
                const apiJob = await fetchGreenhouseJob(job);
                applyGreenhouseMetadata(job, apiJob);
            } catch (error) {
                fetchError = error?.name === 'AbortError' ? 'Greenhouse request timed out.' : (error?.message || 'Greenhouse request failed.');
                console.warn(`Detail refresh failed for ${job.title || job.jobId || 'job'}:`, error);
            }
        }

        // Extract details from the freshly fetched (or previously stored) description.
        const positionTitle = job.title || '';
        const description = job.description || '';

        if (positionTitle) {
            const extracted = extractDetailsFromDescription(positionTitle, description);
            const primaryLocation = (extracted.locations && extracted.locations[0]) || {};
            const descriptionWebsite = extractWebsiteUrlFromDescription(description);
            const locationUrl = extractLocationUrlFromDescription(description);
            let hospitalInfo = emptyHospitalInfo();

            if (locationUrl) {
                fetchDetailsBtn.textContent = `Fetching Location... (${currentDetailsIndex + 1}/${detailsQueue.length})`;
                hospitalInfo = await fetchHospitalInfoFromLocationUrl(locationUrl);
            }

            const detailCity = hospitalInfo.city || primaryLocation.city || job.city || '';
            const detailState = getFullStateName(hospitalInfo.state || primaryLocation.state || job.state || '');
            const detailLocation = primaryLocation.location
                ? expandStateInLocation(primaryLocation.location)
                : formatLocation(detailCity, detailState);

            detailsList = [{
                areaOfPractice: extracted.areaOfPractice,
                position: extracted.position,
                salary: extracted.salary,
                hospitalName: extracted.hospitalName,
                jobType: extracted.jobType,
                experience: extracted.experience,
                website: normalizeClinicWebsite(hospitalInfo.website) || descriptionWebsite || normalizeClinicWebsite(extracted.website) || '',
                description: description,
                city: detailCity,
                state: detailState,
                location: detailLocation,
                streetAddress: hospitalInfo.streetAddress || extracted.streetAddress || '',
                zipCode: hospitalInfo.zipCode || extracted.zipCode || '',
                phone: hospitalInfo.phone || extracted.phone || ''
            }];
        }

        const detail = detailsList[0] || {};
        const usefulFieldCount = [
            detail.areaOfPractice, detail.position, detail.salary, detail.jobType,
            detail.experience, detail.website, detail.city, detail.state,
            detail.streetAddress, detail.zipCode, detail.phone
        ].filter(value => value && String(value).trim()).length;
        job.detailsFetchAttemptedAt = new Date().toISOString();
        job.detailsExtractionVersion = DETAIL_EXTRACTION_VERSION;
        job.detailsFetchError = fetchError;
        if (usefulFieldCount === 0) {
            job.detailsFetchStatus = 'failed';
            job.detailsFetchError = fetchError || 'No supported detail fields were found.';
            detailFetchSummary.failed++;
        } else if (fetchError) {
            job.detailsFetchStatus = 'partial';
            detailFetchSummary.partial++;
        } else {
            job.detailsFetchStatus = 'success';
            detailFetchSummary.success++;
        }

        // Persist API metadata and attempt status before the normal merge pass.
        await chrome.storage.local.set({ vipvetJobs: currentJobs });

        // Save extracted details to storage
        if (detailsList.length > 0) {
            await saveDetailResults(detailsList, currentIndex);
        }

        // Move to next job â€” no delay needed since we're analyzing locally
        currentDetailsIndex++;
        setTimeout(() => processNextDetail().catch(handleDetailsFatalError), 50);
    }

    function isNormalizedExperienceValue(value) {
        const text = (value || '').trim();
        return /^(?:\d+\s*(?:\+|plus)?|\d+\s*[-–—]\s*\d+)\s*years?$/i.test(text);
    }

    // Save detail extraction results to chrome storage
    function saveDetailResults(detailsList, jobIndex) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.get(['vipvetJobs'], (data) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                const jobs = data.vipvetJobs || [];
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

                // Step 1: Only veterinarian/supported specialist roles belong in
                // this AOP taxonomy. Unsupported roles keep the fields blank.
                const supportedRole = isSupportedVeterinaryRoleTitle(listingTitle);
                let finalAOP = supportedRole
                    ? (hasSpecialtyTrainingSignal(descText)
                        ? 'Specialty Care'
                        : (detailAOP || getAOPFromTitle(listingTitle) || 'General Practice Care'))
                    : '';

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

                // Update original job with extracted details
                originalJob.areaOfPractice = finalAOP;
                originalJob.position = finalPosition || '';
                originalJob.salary = normalizeNumericSalary(firstDetail.salary) || normalizeNumericSalary(originalJob.salary);
                if (originalJob.originalHospitalName) {
                    originalJob.hospital = originalJob.originalHospitalName;
                    originalJob.hospitalName = originalJob.originalHospitalName;
                } else if (firstDetail.hospitalName && !isGenericParentHospitalName(firstDetail.hospitalName)) {
                    originalJob.hospital = firstDetail.hospitalName;
                    originalJob.hospitalName = firstDetail.hospitalName;
                    originalJob.originalHospitalName = firstDetail.hospitalName;
                } else if (!originalJob.hospital && originalJob.hospitalName) {
                    originalJob.hospital = originalJob.hospitalName;
                    originalJob.originalHospitalName = originalJob.hospitalName;
                }
                originalJob.jobType = getNormalizedJobType(descText);
                if (firstDetail.experience) {
                    originalJob.experience = firstDetail.experience;
                } else if (originalJob.experience && !isNormalizedExperienceValue(originalJob.experience)) {
                    originalJob.experience = '';
                }
                if (firstDetail.city) originalJob.city = firstDetail.city;
                if (firstDetail.state) originalJob.state = getFullStateName(firstDetail.state);
                if (firstDetail.location) originalJob.location = expandStateInLocation(firstDetail.location);
                if (!originalJob.location && (originalJob.city || originalJob.state)) {
                    originalJob.location = formatLocation(originalJob.city, originalJob.state);
                }
                if (firstDetail.streetAddress) originalJob.streetAddress = firstDetail.streetAddress;
                if (firstDetail.zipCode) originalJob.zipCode = firstDetail.zipCode;
                originalJob.website = normalizeClinicWebsite(firstDetail.website) || normalizeClinicWebsite(originalJob.website) || '';
                if (firstDetail.phone && !originalJob.phone) originalJob.phone = firstDetail.phone;
                // Update description if we got a better one
                if (firstDetail.description && firstDetail.description.length > (originalJob.description || '').length) {
                    originalJob.description = firstDetail.description;
                }

                const dedupedJobs = dedupeJobsByIdentity(jobs);

                chrome.storage.local.set({ vipvetJobs: dedupedJobs }, () => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
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
            const text = String(value || '').trim();
            return !!text && text !== '-' && text.toUpperCase() !== UNKNOWN_STREET_ADDRESS && text !== UNKNOWN_ZIP_CODE;
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

    function handleDetailsFatalError(error) {
        console.error('Detail queue failed:', error);
        finishDetailsFetching(error?.message || 'The detail queue stopped unexpectedly.').catch(finishError => {
            console.error('Could not finish the detail queue:', finishError);
        });
    }

    async function finishDetailsFetching(fatalError = '') {
        isFetchingDetails = false;
        fetchDetailsBtn.disabled = false;
        fetchDetailsBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4M11,7V13L16.2,16.2L17,14.9L12.5,12.2V7H11Z"/>
            </svg>
            Fetch Details
        `;
        document.getElementById('progressSection').classList.add('hidden');
        if (fatalError) {
            showToast(`Detail fetch stopped: ${fatalError}`, 'error');
            return;
        }
        let deletedCount = 0;
        try {
            deletedCount = await deleteRecordsMissingCityOrState();
        } catch (error) {
            showToast(`Details were fetched, but records missing city or state could not be deleted: ${error?.message || 'Unknown error'}`, 'error');
            return;
        }
        const summary = `${detailFetchSummary.success} succeeded, ${detailFetchSummary.partial} partial, ${detailFetchSummary.failed} failed`;
        const deletionSummary = deletedCount > 0 ? ` ${deletedCount} record(s) missing city or state were deleted.` : '';
        showToast(`Detail fetch complete: ${summary}.${deletionSummary}`, detailFetchSummary.failed || detailFetchSummary.partial ? 'error' : 'success');
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
        return hospitalKey ? `${hospitalKey}|${locationKey || 'unknown-location'}` : '';
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
        return !!(data && data._attempted === true);
    }

    function parseLocationParts(location) {
        const parts = (location || '').split(',').map(part => part.trim()).filter(Boolean);
        return {
            city: parts[0] || '',
            state: parts.length >= 2 ? parts[1] : ''
        };
    }

    function extractCityStateFromTitle(title) {
        const t = (title || '').trim();
        if (!t) return { city: '', state: '' };

        const match = t.match(/(?:\||-)\s*([A-Za-z][A-Za-z\s.'-]+?),\s*([A-Z]{2})\b/);
        if (match) {
            return { city: match[1].trim(), state: match[2].trim() };
        }

        return { city: '', state: '' };
    }

    function extractBracketLocationFromTitle(title) {
        const match = (title || '').match(/^\s*\[([^\]]+)\]/);
        if (!match) return '';

        const cleaned = match[1]
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/^(?:[A-Z]{2,5}|CH)\s+/, '')
            .trim();

        if (!cleaned || /\b(?:veterinarian|internist|director|associate|doctor|specialist|relief)\b/i.test(cleaned)) {
            return '';
        }

        return cleaned;
    }

    function inferStateFromJobText(job) {
        // Fetch Details already parsed the description. Address enrichment only
        // consumes saved fields and, as a last resort, the listing title.
        const text = [job.title, job.location].filter(Boolean).join(' ');
        if (!text) return '';

        const cityState = text.match(/\b[A-Za-z][A-Za-z\s.'-]+,\s*([A-Z]{2})\b/);
        if (cityState) return getFullStateName(cityState[1]);

        for (const stateName of Object.values(stateAbbreviations)) {
            const escaped = stateName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            if (new RegExp(`\\b${escaped}\\b`, 'i').test(text)) {
                return stateName;
            }
        }

        return '';
    }

    function getAddressSearchParts(job) {
        const loc = parseLocationParts(job.location || '');
        let city = (loc.city || job.city || '').trim();
        let state = (loc.state || job.state || '').trim();
        let inferredCity = false;

        if (!city || !state) {
            const fromTitle = extractCityStateFromTitle(job.title || '');
            if (!city) city = fromTitle.city || '';
            if (!state) state = fromTitle.state || '';
        }

        if (!city) {
            city = extractBracketLocationFromTitle(job.title || '');
            inferredCity = !!city;
        }

        if (!state) {
            state = inferStateFromJobText(job);
        }

        return { city, state: getFullStateName(state), inferredCity };
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

    function hasSavedValue(value) {
        const text = String(value || '').trim();
        return !!text && text !== '-' && text.toUpperCase() !== UNKNOWN_STREET_ADDRESS && text !== UNKNOWN_ZIP_CODE;
    }

    function jobLocationMismatch(job) {
        const expected = getAddressSearchParts(job);
        return !!(
            (expected.city && job.city && normalizedLocationPart(job.city) !== normalizedLocationPart(expected.city)) ||
            (expected.state && job.state && normalizedLocationPart(getFullStateName(job.state)) !== normalizedLocationPart(getFullStateName(expected.state)))
        );
    }

    function rememberAddressData(keys, data) {
        if (!data) return;
        for (const key of keys) {
            addressCache.set(key, { ...data, _attempted: true });
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
            if (job.addressExtractionVersion !== ADDRESS_EXTRACTION_VERSION || !job.addressFetchSource || !job.addressMatchedBusiness) continue;
            const searchParts = getAddressSearchParts(job);
            const cacheLocation = [searchParts.city, searchParts.state].filter(Boolean).join(', ');
            if (!job.hospital || jobLocationMismatch(job)) continue;
            const cachedStreetAddress = hasSavedValue(job.streetAddress) ? job.streetAddress : '';
            const cachedZipCode = hasSavedValue(job.zipCode) ? job.zipCode : '';
            const cached = {
                streetAddress: cachedStreetAddress,
                zipCode: cachedZipCode,
                city: job.city || '',
                state: job.state || '',
                fullAddress: [cachedStreetAddress, job.city, [job.state, cachedZipCode].filter(Boolean).join(' ')].filter(Boolean).join(', '),
                website: job.website || '',
                phone: job.phone || '',
                businessName: job.addressMatchedBusiness || '',
                mapsUrl: job.addressSourceUrl || '',
                source: job.addressFetchSource || '',
                confidence: Number(job.addressMatchConfidence) || 0,
                matchScore: Number(job.addressMatchConfidence) || 0,
                error: job.addressFetchError || ''
            };
            rememberAddressData(getAddressCacheKeys(job.hospital, cacheLocation, job.originalHospitalName || ''), cached);
        }
    }

    function getAddressRequestFields(job) {
        if (!addressValidation) return [];
        return addressValidation.getMissingFields({
            ...job,
            website: normalizeClinicWebsite(job.website),
            phone: addressValidation.normalizePhone(job.phone)
        });
    }

    function isEnrichmentFieldMissing(job, field) {
        if (field === 'streetAddress') return !hasSavedValue(job?.streetAddress);
        if (field === 'zipCode') return !hasSavedValue(job?.zipCode);
        if (field === 'website') return !normalizeClinicWebsite(job?.website);
        if (field === 'phone') return !addressValidation?.normalizePhone(job?.phone);
        return !hasSavedValue(job?.[field]);
    }

    function applyAddressNotFoundPlaceholders(job) {
        if (!job) return false;
        let changed = false;
        if (isEnrichmentFieldMissing(job, 'streetAddress') && job.streetAddress !== UNKNOWN_STREET_ADDRESS) {
            job.streetAddress = UNKNOWN_STREET_ADDRESS;
            changed = true;
        }
        if (isEnrichmentFieldMissing(job, 'zipCode') && job.zipCode !== UNKNOWN_ZIP_CODE) {
            job.zipCode = UNKNOWN_ZIP_CODE;
            job.postalCode = UNKNOWN_ZIP_CODE;
            changed = true;
        }
        return changed;
    }

    function wasAddressAttemptedAtCurrentVersion(job) {
        return job.addressExtractionVersion === ADDRESS_EXTRACTION_VERSION && !!job.addressFetchAttemptedAt;
    }

    fetchAddressesBtn.addEventListener('click', async () => {
        if (isFetchingAddresses) {
            showToast('Already fetching missing address information. Please wait...', 'error');
            return;
        }
        if (!addressValidation) {
            showToast('Address validation failed to load. Reload the extension.', 'error');
            return;
        }

        const data = await chrome.storage.local.get(['vipvetJobs']);
        const jobs = data.vipvetJobs || [];
        const candidates = jobs.map(job => ({
            job,
            key: addressValidation.stableJobKey(job),
            requestedFields: getAddressRequestFields(job),
            hospital: job.hospital || ''
        })).filter(item => item.requestedFields.length);
        const unsearchable = candidates.filter(item => !item.key || !item.hospital || isGenericParentHospitalName(item.hospital));
        const unresolved = candidates.filter(item => item.key && item.hospital && !isGenericParentHospitalName(item.hospital));
        let retryPreviouslyAttempted = false;

        // Only Fetch Addresses owns the address-not-found placeholders. Mark
        // unsearchable and previously attempted records without changing new
        // searchable records before their lookup runs.
        let placeholdersChanged = false;
        for (const item of candidates) {
            if (unsearchable.includes(item) || wasAddressAttemptedAtCurrentVersion(item.job)) {
                placeholdersChanged = applyAddressNotFoundPlaceholders(item.job) || placeholdersChanged;
            }
        }
        if (placeholdersChanged) {
            await chrome.storage.local.set({ vipvetJobs: jobs });
            allJobs = jobs;
            displayRecords(allJobs);
        }

        addressQueue = unresolved.filter(item => {
            const job = jobs.find(candidate => addressValidation.stableJobKey(candidate) === item.key);
            return job && !wasAddressAttemptedAtCurrentVersion(job);
        });

        if (!addressQueue.length && unresolved.length) {
            if (!confirm(`${unresolved.length} jobs still have missing information, but they were already checked with the current lookup version. Retry them now?`)) return;
            addressQueue = unresolved;
            retryPreviouslyAttempted = true;
        }
        if (!addressQueue.length) {
            const message = unresolved.length
                ? 'No unresolved jobs were selected for retry.'
                : (unsearchable.length
                    ? `${unsearchable.length} jobs cannot be verified because they do not identify a specific hospital.`
                    : 'No address or contact fields are missing.');
            showToast(message, unsearchable.length ? 'error' : 'success');
            return;
        }

        if (retryPreviouslyAttempted) addressCache = new Map();
        else primeAddressCache(jobs);
        addressFetchSummary = { success: 0, partial: 0, failed: 0, skipped: unsearchable.length, updatedFields: 0 };
        isFetchingAddresses = true;
        currentAddressIndex = 0;
        fetchAddressesBtn.disabled = true;
        fetchAddressesBtn.textContent = 'Fetching Missing Info...';

        const progressSection = document.getElementById('progressSection');
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        const progressLabel = document.getElementById('progressLabel');
        progressSection.classList.remove('hidden');
        progressLabel.textContent = 'Verifying Missing Addresses & Contact Information';
        progressText.textContent = `0 / ${addressQueue.length}`;
        progressBar.style.width = '0%';

        processNextAddress().catch(handleAddressFatalError);
    });

    async function processNextAddress() {
        if (currentAddressIndex >= addressQueue.length) {
            finishAddressFetching();
            return;
        }

        const queueItem = addressQueue[currentAddressIndex];
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        progressText.textContent = `${currentAddressIndex + 1} / ${addressQueue.length}`;
        progressBar.style.width = `${((currentAddressIndex + 1) / addressQueue.length) * 100}%`;
        fetchAddressesBtn.textContent = `Verifying... (${currentAddressIndex + 1}/${addressQueue.length})`;

        try {
            const stored = await chrome.storage.local.get(['vipvetJobs']);
            let jobs = stored.vipvetJobs || [];
            let jobIndex = jobs.findIndex(job => addressValidation.stableJobKey(job) === queueItem.key);
            if (jobIndex === -1) {
                addressFetchSummary.skipped++;
            } else {
                const job = jobs[jobIndex];
                const requestedFields = getAddressRequestFields(job).filter(field => queueItem.requestedFields.includes(field));
                if (!requestedFields.length) {
                    addressFetchSummary.skipped++;
                } else {
                    let searchHospital = job.hospital || '';
                    if (job.sourceLink && searchHospital) {
                        const cleaned = searchHospital.replace(/\s*[-–—]\s*[A-Z][a-zA-Z\s.'-]+$/, '').trim();
                        if (cleaned) searchHospital = cleaned;
                    }

                    const searchParts = getAddressSearchParts(job);
                    const searchLocation = [searchParts.city, searchParts.state].filter(Boolean).join(', ');
                    const cacheKeys = getAddressCacheKeys(searchHospital, searchLocation, job.originalHospitalName || job.hospital || '');
                    let addressData = getRememberedAddress(cacheKeys);
                    if (!addressData) {
                        addressData = await fetchVerifiedBusinessData(
                            searchHospital,
                            searchParts,
                            job.originalHospitalName || job.hospital || '',
                            requestedFields
                        );
                        rememberAddressData(cacheKeys, addressData);
                    }

                    const refreshed = await chrome.storage.local.get(['vipvetJobs']);
                    jobs = refreshed.vipvetJobs || [];
                    jobIndex = jobs.findIndex(candidate => addressValidation.stableJobKey(candidate) === queueItem.key);
                    if (jobIndex === -1) {
                        addressFetchSummary.skipped++;
                    } else {
                        const target = jobs[jobIndex];
                        const updatedFields = [];
                        const normalizedValues = {
                            streetAddress: addressData.streetAddress || '',
                            city: addressData.city || '',
                            state: addressData.state ? getFullStateName(addressData.state) : '',
                            zipCode: addressData.zipCode || extractZipFromAddressText(addressData.fullAddress || ''),
                            phone: addressValidation.normalizePhone(addressData.phone),
                            website: normalizeClinicWebsite(addressData.website)
                        };

                        if (addressData.businessName) {
                            for (const field of requestedFields) {
                                if (isEnrichmentFieldMissing(target, field) && hasSavedValue(normalizedValues[field])) {
                                    target[field] = normalizedValues[field];
                                    updatedFields.push(field);
                                }
                            }
                            if (!hasSavedValue(target.location) && (hasSavedValue(target.city) || hasSavedValue(target.state))) {
                                target.location = formatLocation(target.city, target.state);
                            }
                        }

                        const unresolvedFields = requestedFields.filter(field => isEnrichmentFieldMissing(target, field));
                        applyAddressNotFoundPlaceholders(target);
                        target.addressFetchAttemptedAt = new Date().toISOString();
                        target.addressExtractionVersion = ADDRESS_EXTRACTION_VERSION;
                        target.addressFetchStatus = unresolvedFields.length === 0
                            ? 'success'
                            : (updatedFields.length ? 'partial' : 'failed');
                        target.addressFetchError = unresolvedFields.length
                            ? (addressData.error || `Still missing: ${unresolvedFields.join(', ')}.`)
                            : '';
                        target.addressFetchSource = addressData.source || '';
                        target.addressMatchConfidence = Number(addressData.confidence || addressData.matchScore || 0).toFixed(2);
                        target.addressMatchedBusiness = addressData.businessName || '';
                        target.addressSourceUrl = addressData.mapsUrl || addressData.searchUrl || '';
                        target.addressPlaceId = addressData.placeId || '';
                        target.addressUpdatedFields = updatedFields;

                        addressFetchSummary[target.addressFetchStatus]++;
                        addressFetchSummary.updatedFields += updatedFields.length;
                        await chrome.storage.local.set({ vipvetJobs: jobs });
                        allJobs = jobs;
                        displayRecords(allJobs);
                    }
                }
            }
        } catch (error) {
            console.error('Error fetching address information:', error);
            addressFetchSummary.failed++;
            try {
                const failedRead = await chrome.storage.local.get(['vipvetJobs']);
                const failedJobs = failedRead.vipvetJobs || [];
                const failedIndex = failedJobs.findIndex(job => addressValidation.stableJobKey(job) === queueItem.key);
                if (failedIndex !== -1) {
                    applyAddressNotFoundPlaceholders(failedJobs[failedIndex]);
                    failedJobs[failedIndex].addressFetchAttemptedAt = new Date().toISOString();
                    failedJobs[failedIndex].addressExtractionVersion = ADDRESS_EXTRACTION_VERSION;
                    failedJobs[failedIndex].addressFetchStatus = 'failed';
                    failedJobs[failedIndex].addressFetchError = error?.message || 'Address verification failed unexpectedly.';
                    failedJobs[failedIndex].addressUpdatedFields = [];
                    await chrome.storage.local.set({ vipvetJobs: failedJobs });
                }
            } catch (saveError) {
                console.error('Could not save address failure status:', saveError);
            }
        }

        currentAddressIndex++;
        setTimeout(() => processNextAddress().catch(handleAddressFatalError), 250);
    }

    function handleAddressFatalError(error) {
        console.error('Address queue failed:', error);
        finishAddressFetching(error?.message || 'The address queue stopped unexpectedly.');
    }

    function finishAddressFetching(fatalError = '') {
        isFetchingAddresses = false;
        fetchAddressesBtn.disabled = false;
        fetchAddressesBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12,2C8.13,2 5,5.13 5,9C5,14.25 12,22 12,22C12,22 19,14.25 19,9C19,5.13 15.87,2 12,2M12,11.5C10.62,11.5 9.5,10.38 9.5,9C9.5,7.62 10.62,6.5 12,6.5C13.38,6.5 14.5,7.62 14.5,9C14.5,10.38 13.38,11.5 12,11.5Z"/>
            </svg>
            Fetch Addresses
        `;
        document.getElementById('progressSection').classList.add('hidden');
        if (fatalError) {
            showToast(`Address verification stopped: ${fatalError}`, 'error');
            return;
        }
        const summary = `${addressFetchSummary.success} complete, ${addressFetchSummary.partial} partial, ${addressFetchSummary.failed} failed, ${addressFetchSummary.skipped} skipped; ${addressFetchSummary.updatedFields} fields added`;
        showToast(`Address verification complete: ${summary}.`, addressFetchSummary.failed || addressFetchSummary.partial ? 'error' : 'success');
    }
});


