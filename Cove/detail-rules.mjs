const APPROVED_POSITIONS = new Set([
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
]);

function cleanInline(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

export function isGenericHospitalName(value) {
    const normalized = cleanInline(value).toLowerCase();
    return new Set([
        'general practice',
        'general practice care',
        'emergency',
        'emergency care',
        'emergency services',
        'urgent care',
        'specialty',
        'specialty care',
        'critical care',
        'imaging'
    ]).has(normalized);
}

export function selectHospitalForLocation(locationDetail, fallbackHospital = '', citySuffixBase = '') {
    const locationHospital = cleanInline(locationDetail?.hospitalName);
    if (locationHospital && !isGenericHospitalName(locationHospital)) return locationHospital;

    const city = cleanInline(locationDetail?.city);
    const base = cleanInline(citySuffixBase);
    if (base && city) return `${base}-${city}`;

    return cleanInline(fallbackHospital);
}

export function clearStoredJobDetails(jobs) {
    const detailFields = ['areaOfPractice', 'position', 'salary', 'jobType', 'experience'];
    const sourceJobs = [];
    let clearedCount = 0;
    let removedLocationCount = 0;

    for (const job of Array.isArray(jobs) ? jobs : []) {
        if (job?.parentJobId) {
            removedLocationCount++;
            continue;
        }

        const hadDetails = !!job?.detailsFetched || detailFields.some(field => !!job?.[field]);
        for (const field of detailFields) job[field] = '';
        job.detailsFetched = false;
        job.detailsClearedByUser = true;
        job.isNewLocation = false;
        if (hadDetails) clearedCount++;
        sourceJobs.push(job);
    }

    return { jobs: sourceJobs, clearedCount, removedLocationCount };
}

function getMetadataField(text, label) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = String(text || '').match(new RegExp(`^${escaped}:[^\\S\\r\\n]*([^\\r\\n]*)`, 'im'));
    return match ? cleanInline(match[1]) : '';
}

function getDescriptionBody(text) {
    const value = String(text || '');
    const marker = '=== FULL JOB DESCRIPTION ===';
    const markerIndex = value.indexOf(marker);
    return markerIndex === -1 ? value : value.slice(markerIndex + marker.length).trim();
}

function normalizeNameTokens(value) {
    return cleanInline(value)
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(token => token && token !== 'and' && token !== 'of')
        .map(token => token.length > 4 && token.endsWith('s') ? token.slice(0, -1) : token);
}

function tokenSimilarity(left, right) {
    const a = new Set(normalizeNameTokens(left));
    const b = new Set(normalizeNameTokens(right));
    if (!a.size || !b.size) return 0;
    const intersection = [...a].filter(token => b.has(token)).length;
    return intersection / Math.max(a.size, b.size);
}

function bodyContainsName(body, name) {
    const haystack = normalizeNameTokens(body).join(' ');
    const needle = normalizeNameTokens(name).join(' ');
    return needle.length > 4 && haystack.includes(needle);
}

function getFacilityKind(value) {
    const match = cleanInline(value).match(/\b(hospital|care|clinic|center|associates?|services)\b/i);
    return match ? match[1].toLowerCase().replace(/s$/, '') : '';
}

function getFacilityCore(value) {
    const generic = new Set(['veterinary', 'animal', 'pet', 'hospital', 'care', 'clinic', 'center', 'associate', 'service', 'specialty']);
    return normalizeNameTokens(value).filter(token => !generic.has(token)).join(' ');
}

function isCredentialedExoticsRole(title, description) {
    const titleText = cleanInline(title);
    if (!/\b(?:exotics?|exotic animal|avian)\b/i.test(titleText)) return false;
    const roleText = getRoleSignalText(description);
    return /\b(?:board[\s-]?certified|residency[\s-]?trained|dabvp)\b[^\n]{0,100}\b(?:exotics?|exotic animal|avian)\b/i.test(roleText) ||
        /\b(?:exotics?|exotic animal|avian)\b[^\n]{0,100}\b(?:board[\s-]?certified|residency[\s-]?trained|dabvp)\b/i.test(roleText);
}

function extractCanonicalHospital(text, title = '') {
    const body = getDescriptionBody(text);
    const office = cleanInline(getMetadataField(text, 'Office Name'));
    const brand = cleanInline(getMetadataField(text, 'Brand Name'));
    const roleTitle = cleanInline(title) || getMetadataField(text, 'Title');

    // A multi-site role belongs to the network/brand, not the administrative
    // office attached to the source record.
    if (/\bmulti[\s-]?site\b/i.test(roleTitle) && brand && bodyContainsName(body, brand)) {
        return brand;
    }

    // Prefer the canonical brand only when it is effectively the same facility
    // and the full description actually uses that spelling.
    if (office && brand && office.toLowerCase() !== brand.toLowerCase() &&
        tokenSimilarity(office, brand) >= 0.9 && bodyContainsName(body, brand)) {
        return brand;
    }

    if (office) {
        // If the posting body uses the same distinctive facility identity but a
        // different facility suffix, prefer the name used in the actual advert.
        const opening = body.slice(0, 1800);
        const candidatePattern = /(?:^|[.!?]\s+)([A-Z][A-Za-z&'.()-]*(?:\s+[A-Z][A-Za-z&'.()-]*){1,8})\s+(?:is seeking|seeks|is expanding|has officially)/gm;
        for (const match of opening.matchAll(candidatePattern)) {
            const candidate = cleanInline(match[1]);
            if (!getFacilityKind(candidate)) continue;
            if (getFacilityCore(candidate) && getFacilityCore(candidate) === getFacilityCore(office) && getFacilityKind(candidate) !== getFacilityKind(office)) {
                return candidate;
            }
        }
        return office;
    }
    if (brand) return brand;

    const organization = cleanInline(getMetadataField(text, 'Hiring Organization'));
    if (organization && !/^cove(?: animal health)?$/i.test(organization)) return organization;

    const opening = body.slice(0, 1800);
    const patterns = [
        /(?:^|[.!?]\s+)([A-Z][A-Za-z&'.()-]*(?:\s+[A-Z][A-Za-z&'.()-]*){1,8})\s+(?:is seeking|seeks|is expanding|has officially)/gm,
        /\bat\s+([A-Z][A-Za-z&'.()-]*(?:\s+[A-Z][A-Za-z&'.()-]*){1,8}(?:Hospital|Clinic|Center|Care|Associates?|Services))\b/g
    ];
    for (const pattern of patterns) {
        const match = pattern.exec(opening);
        if (match) return cleanInline(match[1]);
    }
    return '';
}

function getPositionFromTitle(title) {
    const value = cleanInline(title).toLowerCase();
    if (!value) return '';

    if (/\bmedical director\b/.test(value)) return 'Medical Director';
    if (/\b(?:lead|head)\s+(?:veterinarian|vet)\b/.test(value)) return 'Lead Veterinarian';
    if (/\bneurolog(?:ist|y)\b|\bneurosurgeon\b/.test(value)) return 'Neurologist & Neurosurgeon';
    if (/\bdermatolog(?:ist|y)\b/.test(value)) return 'Dermatologist';
    if (/\bcardiolog(?:ist|y)\b/.test(value)) return 'Cardiologist';
    if (/\bradiation\s+oncolog/.test(value)) return 'Radiation Oncologist';
    if (/\b(?:medical\s+)?oncolog(?:ist|y)\b/.test(value)) return 'Medical Oncologist';
    if (/\bradiolog(?:ist|y)\b|\bdiagnostic imaging\b/.test(value)) return 'Radiologist';
    if (/\bophthalmolog(?:ist|y)\b/.test(value)) return 'Ophthalmologist';
    if (/\banesthesiolog(?:ist|y)\b|\banesthesia\b/.test(value)) return 'Anesthesiologist';
    if (/\binternist\b|\binternal medicine\b/.test(value)) return 'Internal Medicine Specialist';
    if (/\bcriticalist\b|\becc\b|\bemergency medicine\b/.test(value)) return 'ECC Specialist';
    if (/\bdabvp\b/.test(value)) return 'DABVP Specialist';
    if (/\b(?:dentist|dentistry|dental specialist|oral surgeon)\b/.test(value) && !/\bassistant\b/.test(value)) return 'Dental Specialist';
    if (/\b(?:veterinary )?surgeon\b|\bsurgery\b/.test(value) && !/\b(?:neuro|dental|dentistry)/.test(value)) return 'Surgeon';
    if (/\bcredentialed veterinary technician specialist\b|\btechnician specialist\b|\bvts\b/.test(value)) return 'Credentialed Veterinary Technician Specialist';
    if (/\bpartner\s+(?:veterinarian|vet)\b/.test(value)) return 'Partner Veterinarian';
    if (/\b(?:associate\s+)?(?:emergency|er|urgent care|urgent)?\s*(?:veterinarian|vet|dvm)\b/.test(value)) return 'Associate Veterinarian';
    return '';
}

function getRoleSignalText(description) {
    const body = getDescriptionBody(description);
    return body.split(/\r?\n/).map(cleanInline).filter(Boolean).slice(0, 12).join('\n');
}

function determineAreaOfPractice(title, description) {
    const value = cleanInline(title).toLowerCase();
    const category = getMetadataField(description, 'Industry/Category').toLowerCase();
    const position = getPositionFromTitle(title);

    // A clear role title always outranks incidental services and credentials in
    // the rest of the posting.
    if (position === 'Lead Veterinarian') return 'General Practice Care';

    const hasUrgentTitle = /\burgent care\b/.test(value);
    const hasEmergencyTitle = /\bemergency\b|\ber\b/.test(value);
    if (hasUrgentTitle && hasEmergencyTitle) {
        const roleText = getRoleSignalText(description);
        const explicitEmergencyRole = /\b(?:seeking|looking for|join(?: our)?|as)\s+(?:an?\s+)?(?:experienced\s+|overnight\s+)?emergency veterinarian\b/i.test(roleText);
        const explicitUrgentRole = /\b(?:seeking|looking for|join(?: our)?|as)\s+(?:an?\s+)?urgent care veterinarian\b/i.test(roleText);
        if (explicitEmergencyRole !== explicitUrgentRole) return explicitEmergencyRole ? 'Emergency Care' : 'Urgent Care';
        if (category.includes('emergency') || category.includes('(er)')) return 'Emergency Care';
        return 'Urgent Care';
    }
    if (hasUrgentTitle) return 'Urgent Care';
    if (['Anesthesiologist', 'Cardiologist', 'Credentialed Veterinary Technician Specialist',
        'DABVP Specialist', 'Dental Specialist', 'Dermatologist', 'ECC Specialist',
        'Internal Medicine Specialist', 'Medical Oncologist', 'Neurologist & Neurosurgeon',
        'Ophthalmologist', 'Radiation Oncologist', 'Radiologist', 'Surgeon'].includes(position)) {
        return 'Specialty Care';
    }
    if (hasEmergencyTitle) return 'Emergency Care';
    if (isCredentialedExoticsRole(title, description)) return 'Specialty Care';
    if (/\b(?:primary care|general practice|multi-site|exotics?|avian|equine|bovine|large animal)\b/.test(value)) {
        return 'General Practice Care';
    }
    if (position === 'Associate Veterinarian') return 'General Practice Care';

    if (category.includes('gen practice')) return 'General Practice Care';
    if (category.includes('specialty diplomate') || category.includes('surgeon diplomate')) return 'Specialty Care';
    if (category === 'veterinarian (er)' || category.includes('(er)') || category.includes('emergency')) return 'Emergency Care';

    // For a generic title, inspect only the opening role statement. This avoids
    // treating a GP role as specialty merely because specialists support it.
    const roleSignals = getRoleSignalText(description);
    const signaledPosition = getPositionFromTitle(roleSignals);
    if (signaledPosition && signaledPosition !== 'Associate Veterinarian' && signaledPosition !== 'Lead Veterinarian') {
        return 'Specialty Care';
    }
    if (/\burgent care\b/i.test(roleSignals)) return 'Urgent Care';
    if (/\bemergency veterinarian\b|\ber veterinarian\b/i.test(roleSignals)) return 'Emergency Care';
    return 'General Practice Care';
}

function formatSalary(raw) {
    if (!raw) return '';
    const isHourly = /(?:per\s+)?(?:hour|hr|\/hr|\/hour)/i.test(raw);
    const amounts = [];
    const regex = /\$?\s*([\d,]+(?:\.\d{1,2})?)\s*(k)?\b/gi;
    let match;
    while ((match = regex.exec(raw)) !== null) {
        let amount = Number(match[1].replace(/,/g, ''));
        if (match[2]) amount *= 1000;
        if (amount > 0) amounts.push(amount);
    }
    if (!amounts.length) return '';
    const format = amount => '$' + amount.toLocaleString('en-US', {
        minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
        maximumFractionDigits: 2
    });
    const unit = isHourly ? 'per hour' : 'per year';
    if (amounts.length > 1) return `${format(Math.min(amounts[0], amounts[1]))}\u2013${format(Math.max(amounts[0], amounts[1]))} ${unit}`;
    return `${format(amounts[0])} ${unit}`;
}

function extractSalary(text) {
    const structured = getMetadataField(text, 'Salary Range');
    if (structured) return formatSalary(structured);

    const body = getDescriptionBody(text);
    const lines = body.split(/\r?\n|;/).map(cleanInline).filter(line =>
        /\b(?:salary|compensation|pay|wage|earn|earning|base)\b/i.test(line) && /\$\s*\d/.test(line)
    );
    for (const line of lines) {
        const range = line.match(/\$\s*[\d,]+(?:\.\d{1,2})?\s*k?\s*(?:[-\u2013\u2014]|to)\s*\$?\s*[\d,]+(?:\.\d{1,2})?\s*k?(?:\s*(?:per\s+)?(?:year|annually|annual|hour|hr|\/hr))?/i);
        if (range) return formatSalary(range[0]);
        const single = line.match(/\$\s*[\d,]+(?:\.\d{1,2})?\s*k?(?:\s*(?:per\s+)?(?:year|annually|annual|hour|hr|\/hr))/i);
        if (single) return formatSalary(single[0]);
    }
    return '';
}

function extractJobType(text) {
    const structured = getMetadataField(text, 'Employment Type');
    const source = structured || getDescriptionBody(text);
    const hasFullTime = /\bfull[\s-]?time\b|\bfulltime\b/i.test(source);
    const hasPartTime = /\bpart[\s-]?time\b|\bparttime\b|\(pt\)/i.test(source);
    if (hasFullTime) return 'Full-Time';
    if (hasPartTime) return 'Part-Time';
    return 'Full-Time';
}

function extractExperience(text) {
    const body = getDescriptionBody(text);
    const candidateLines = body.split(/\r?\n/)
        .map(cleanInline)
        .filter(Boolean)
        .filter(line => /\b(?:experience|minimum|min\.?|at least|required|requirements?|qualifications?|practice setting|years in practice)\b/i.test(line))
        .filter(line => /\b\d+\s*(?:\+|[-\u2013\u2014]\s*\d+|\s+to\s+\d+)?\s*(?:years?|yrs?\.?)\b/i.test(line))
        .filter(line => !/\b(?:our team has|team members have been|over\s+\d+\s+years of experience|serving|founded|established|since\s+\d{4}|we offer|benefits)\b/i.test(line));

    const yearToken = '(?:years?|yrs?\\.?)';
    const patterns = [
        new RegExp(`\\b(\\d+)\\s*[-\u2013\u2014]\\s*(\\d+)\\s*${yearToken}\\s+(?:of\\s+)?experience\\b`, 'i'),
        new RegExp(`\\b(\\d+)\\s+to\\s+(\\d+)\\s*${yearToken}\\s+(?:of\\s+)?experience\\b`, 'i'),
        new RegExp(`\\b(?:minimum|min\\.?|at\\s+least)\\s+(?:of\\s+)?(\\d+)\\+?\\s*${yearToken}\\b`, 'i'),
        new RegExp(`\\b(\\d+)\\+?\\s*${yearToken}\\s+(?:of\\s+)?(?:clinical\\s+)?experience\\b`, 'i'),
        new RegExp(`\\bexperience\\s+(?:of|required(?:\\s+is)?|requires|:)?\\s*(\\d+)\\+?\\s*${yearToken}\\b`, 'i')
    ];
    for (const line of candidateLines) {
        for (const pattern of patterns) {
            const match = line.match(pattern);
            if (!match) continue;
            if (match[2]) return `${match[1]}-${match[2]} years`;
            const suffix = /\+|\b(?:minimum|min\.?|at least)\b/i.test(match[0]) ? '+' : '';
            return `${match[1]}${suffix} ${match[1] === '1' && !suffix ? 'year' : 'years'}`;
        }
    }
    return '';
}

function levenshtein(left, right) {
    const a = left.toLowerCase();
    const b = right.toLowerCase();
    const row = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i++) {
        let previous = row[0];
        row[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const saved = row[j];
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
            previous = saved;
        }
    }
    return row[b.length];
}

function extractBodyLocationCandidates(body) {
    const candidates = [];
    const add = (city, state) => {
        city = cleanInline(city).replace(/^(?:and|or)\s+/i, '');
        state = cleanInline(state).toUpperCase();
        if (!city || !/^[A-Z]{2}$/.test(state)) return;
        if (/\b(?:hospital|clinic|veterinarian|description|location|located|team)\b/i.test(city)) return;
        candidates.push({ city, state, location: `${city}, ${state}` });
    };

    for (const line of body.split(/\r?\n/).map(cleanInline).filter(Boolean)) {
        const paired = line.match(/\b([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,2})\s+and\s+([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,2}),\s*([A-Z]{2})\b/);
        if (paired) {
            add(paired[1], paired[3]);
            add(paired[2], paired[3]);
        }

        const matches = line.matchAll(/(?:^|[|\u2013\u2014;()]|\b(?:in|near|at|to|of)\s+)\s*([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,2}),\s*([A-Z]{2})\b/g);
        for (const match of matches) add(match[1], match[2]);
    }
    return candidates;
}

const STATE_NAME_TO_ABBREVIATION = {
    alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
    connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID',
    illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
    maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
    mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
    'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
    'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
    pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD',
    tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA',
    'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY'
};

function findLocationSpecificHospital(body, city) {
    if (!city || city === 'Multiple Locations') return '';
    const escapedCity = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\b([A-Z][A-Za-z&'.()-]*(?:\\s+[A-Z][A-Za-z&'.()-]*){1,8})\\s+in\\s+${escapedCity}\\b`, 'g');
    for (const match of body.matchAll(pattern)) {
        const candidate = cleanInline(match[1]);
        if (getFacilityKind(candidate)) return candidate;
    }
    return '';
}

function extractLocations(text) {
    const source = String(text || '');
    const body = getDescriptionBody(source);
    const locations = [];
    const section = source.match(/^Locations:\s*\r?\n((?:\s*-\s*[^\r\n]+(?:\r?\n|$))+)/im);
    if (section) {
        for (const line of section[1].split(/\r?\n/)) {
            const parts = line.replace(/^\s*-\s*/, '').split(',').map(cleanInline).filter(Boolean);
            if (parts.length >= 2) locations.push({ city: parts[0], state: parts[1], location: `${parts[0]}, ${parts[1]}` });
        }
    }

    const roleTitle = getMetadataField(source, 'Title');
    const bodyCandidates = extractBodyLocationCandidates(body);

    const statewideMatch = body.match(/\b(?:throughout|across)\s+(?:the\s+state\s+of\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/);
    if (/\bmulti[\s-]?site\b/i.test(roleTitle) && statewideMatch) {
        const stateName = statewideMatch[1].toLowerCase();
        const state = STATE_NAME_TO_ABBREVIATION[stateName];
        if (state) {
            return [{ city: 'Multiple Locations', state, location: `Multiple Locations, ${state}` }];
        }
    }
    for (const location of locations) {
        const correction = bodyCandidates.find(candidate =>
            candidate.state === location.state.toUpperCase() &&
            candidate.city.toLowerCase() !== location.city.toLowerCase() &&
            levenshtein(candidate.city, location.city) <= 2
        );
        if (correction) {
            location.city = correction.city;
            location.location = correction.location;
        }
    }

    const multiLocationText = /\b(?:multi-site|multiple locations|across both|split between|time split|locations?)\b/i.test(body.slice(0, 2500));
    if (multiLocationText) locations.push(...bodyCandidates);

    if (!locations.length) locations.push(...bodyCandidates.slice(0, 1));

    const unique = [];
    const seen = new Set();
    for (const location of locations) {
        const key = `${location.city}|${location.state}`.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            unique.push({
                ...location,
                hospitalName: findLocationSpecificHospital(body, location.city)
            });
        }
    }
    return unique;
}

export function extractDetailsFromDescription(positionTitle, descriptionText) {
    const title = cleanInline(positionTitle) || getMetadataField(descriptionText, 'Title');
    const areaOfPractice = determineAreaOfPractice(title, descriptionText);
    let position = getPositionFromTitle(title);
    if (!APPROVED_POSITIONS.has(position)) position = '';

    return {
        salary: extractSalary(descriptionText),
        areaOfPractice,
        position,
        locations: extractLocations(descriptionText),
        hospitalName: extractCanonicalHospital(descriptionText, title),
        jobType: extractJobType(descriptionText),
        experience: extractExperience(descriptionText)
    };
}

export function reconcileStoredHospitalNames(jobs) {
    const records = Array.isArray(jobs) ? jobs : [];
    let repairedCount = 0;

    for (const sourceJob of records.filter(job => job && !job.parentJobId && job.title && job.description)) {
        const details = extractDetailsFromDescription(sourceJob.title, sourceJob.description);
        const rootJobId = sourceJob.jobId || sourceJob.link;

        details.locations.forEach((location, index) => {
            const storedJob = index === 0
                ? sourceJob
                : records.find(candidate =>
                    candidate.parentJobId === rootJobId &&
                    cleanInline(candidate.city).toLowerCase() === cleanInline(location.city).toLowerCase()
                );
            if (!storedJob) return;

            const expectedHospital = selectHospitalForLocation(location, details.hospitalName);
            if (!expectedHospital || cleanInline(storedJob.hospital) === expectedHospital) return;

            storedJob.hospital = expectedHospital;
            repairedCount++;
        });
    }

    return { jobs: records, repairedCount };
}

const STREET_SUFFIX_PATTERN = '(?:st(?:reet)?|ave(?:nue)?|blvd|boulevard|dr(?:ive)?|rd|road|ln|lane|way|ct|court|pl|place|pkwy|parkway|hwy|highway|cir|circle|trl|trail|ter|terrace)';

function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function looksLikeStreetAddress(value) {
    return new RegExp(`^\\s*\\d{1,6}\\s+.+\\b${STREET_SUFFIX_PATTERN}\\b`, 'i').test(cleanInline(value));
}

function normalizeStateForAddress(value) {
    const state = cleanInline(value);
    if (!state) return '';
    if (/^[A-Z]{2}$/i.test(state)) return state.toUpperCase();
    return STATE_NAME_TO_ABBREVIATION[state.toLowerCase()] || state.toLowerCase();
}

function normalizeStreetForAddress(value) {
    return cleanInline(value)
        .toLowerCase()
        .replace(/\b(street)\b/g, 'st')
        .replace(/\b(avenue)\b/g, 'ave')
        .replace(/\b(road)\b/g, 'rd')
        .replace(/\b(boulevard)\b/g, 'blvd')
        .replace(/\b(drive)\b/g, 'dr')
        .replace(/\b(lane)\b/g, 'ln')
        .replace(/\b(highway)\b/g, 'hwy')
        .replace(/\b(parkway)\b/g, 'pkwy')
        .replace(/\b(court)\b/g, 'ct')
        .replace(/\b(place)\b/g, 'pl')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function parseAddressStoredInStreet(streetAddress, expectedLocation = {}) {
    const value = cleanInline(streetAddress).replace(/,?\s*(?:United States|USA)\s*$/i, '').trim();
    if (!value) return null;

    const stateNames = Object.keys(STATE_NAME_TO_ABBREVIATION).map(escapeRegExp).join('|');
    const stateToken = `(?:[A-Z]{2}|${stateNames})`;
    const expectedCity = cleanInline(expectedLocation.city);

    // Standard comma-separated full address stored in the street column.
    let match = value.match(new RegExp(`^(\\d{1,6}[\\s\\S]+?),\\s*([^,]+?),\\s*(${stateToken})\\s+(\\d{5}(?:-\\d{4})?)$`, 'i'));
    if (match && looksLikeStreetAddress(match[1])) {
        return { streetAddress: match[1], city: match[2], state: match[3], zipCode: match[4] };
    }

    // Google occasionally omits the comma between the street and city. The
    // requested city lets us split it without guessing where the street ends.
    if (expectedCity) {
        match = value.match(new RegExp(`^(\\d{1,6}[\\s\\S]+?)\\s+${escapeRegExp(expectedCity)}\\s*,?\\s*(${stateToken})\\s+(\\d{5}(?:-\\d{4})?)$`, 'i'));
        if (match && looksLikeStreetAddress(match[1])) {
            return { streetAddress: match[1], city: expectedCity, state: match[2], zipCode: match[3] };
        }
    }

    return null;
}

function buildFullAddress(data) {
    const cityStateZip = [
        cleanInline(data.city),
        [cleanInline(data.state), cleanInline(data.zipCode)].filter(Boolean).join(' ')
    ].filter(Boolean).join(', ');
    return [cleanInline(data.streetAddress), cityStateZip].filter(Boolean).join(', ');
}

// Repair structurally corrupt results without using hospital-specific values.
// A common Google result failure puts one complete address in streetAddress and
// a second street address in city. When that happens, the embedded full address
// is authoritative because all four of its components came from one source.
export function normalizeAddressData(data, expectedLocation = {}) {
    const normalized = { ...(data || {}) };
    normalized.streetAddress = cleanInline(normalized.streetAddress);
    normalized.city = cleanInline(normalized.city);
    normalized.state = cleanInline(normalized.state);
    normalized.zipCode = cleanInline(normalized.zipCode);

    const embedded = parseAddressStoredInStreet(normalized.streetAddress, expectedLocation);
    if (embedded) {
        Object.assign(normalized, embedded);
        normalized.addressRepaired = true;
        normalized.addressRepairReason = 'Recovered a complete address embedded in the street field';
    } else if (looksLikeStreetAddress(normalized.city)) {
        // Never preserve a street address as a city. Fall back to the requested
        // city only when no complete embedded address can be recovered.
        normalized.city = cleanInline(expectedLocation.city);
        if (!normalized.state) normalized.state = cleanInline(expectedLocation.state);
        normalized.addressRepaired = true;
        normalized.addressRepairReason = 'Removed a street address from the city field';
    }

    if (normalized.streetAddress) normalized.fullAddress = buildFullAddress(normalized);
    return normalized;
}

function addressValueMatches(field, left, right) {
    if (field === 'streetAddress') return normalizeStreetForAddress(left) === normalizeStreetForAddress(right);
    if (field === 'state') return normalizeStateForAddress(left) === normalizeStateForAddress(right);
    return cleanInline(left).toLowerCase().replace(/[^a-z0-9]/g, '') === cleanInline(right).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function addressCompletenessScore(data) {
    return (data.streetAddress ? 4 : 0) + (data.zipCode ? 2 : 0) + (data.city ? 1 : 0) + (data.state ? 1 : 0);
}

// Address components are atomic. Results may be combined only when at least one
// address component overlaps and every overlapping component agrees.
export function mergeAddressData(primaryData, secondaryData) {
    const primary = { ...(primaryData || {}) };
    const secondary = { ...(secondaryData || {}) };
    const fields = ['streetAddress', 'city', 'state', 'zipCode'];
    const overlapping = fields.filter(field => primary[field] && secondary[field]);
    const compatible = overlapping.length > 0 && overlapping.every(field => addressValueMatches(field, primary[field], secondary[field]));

    let result;
    if (compatible) {
        result = { ...secondary, ...primary };
        for (const field of fields) result[field] = primary[field] || secondary[field] || '';
        result.fullAddress = buildFullAddress(result);
        result.website = primary.website || secondary.website || '';
        result.phone = primary.phone || secondary.phone || '';
    } else {
        // Conflicting or unrelated partial results must never be stitched
        // together. Keep the more complete address as a whole; prefer the first
        // result on a tie because it came from the more specific search.
        const preferred = addressCompletenessScore(secondary) > addressCompletenessScore(primary) ? secondary : primary;
        const alternate = preferred === primary ? secondary : primary;
        result = { ...preferred };
        if (result.streetAddress) result.fullAddress = buildFullAddress(result);
        // Contact-only fallbacks are safe; an alternate result carrying another
        // address is not, because its phone could belong to another branch.
        if (!fields.some(field => alternate[field])) {
            result.website = primary.website || secondary.website || '';
            result.phone = primary.phone || secondary.phone || '';
        }
    }

    result.cityMatchedHospitalName = !!(primary.cityMatchedHospitalName || secondary.cityMatchedHospitalName);
    result.locationCorrected = !!(primary.locationCorrected || secondary.locationCorrected);
    result.locationCorrectionReason = primary.locationCorrectionReason || secondary.locationCorrectionReason || '';
    result.addressRepaired = !!(primary.addressRepaired || secondary.addressRepaired);
    result.addressRepairReason = primary.addressRepairReason || secondary.addressRepairReason || '';
    return result;
}

export const _test = {
    determineAreaOfPractice,
    extractExperience,
    extractJobType,
    extractLocations,
    extractCanonicalHospital,
    getMetadataField,
    getPositionFromTitle,
    isCredentialedExoticsRole
};

export { isCredentialedExoticsRole };
