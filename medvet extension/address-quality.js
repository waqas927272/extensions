(function initializeMedVetAddressQuality(root, factory) {
    const api = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }

    if (root) {
        root.MedVetAddressQuality = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
    const STATE_ABBREVIATIONS = {
        AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
        CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
        HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
        KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
        MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
        MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
        NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
        OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
        SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
        VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
        DC: 'District of Columbia', PR: 'Puerto Rico'
    };

    const NAME_STOP_WORDS = new Set([
        'the', 'and', 'for', 'with', 'veterinary', 'animal', 'pet', 'hospital',
        'clinic', 'center', 'centre', 'emergency', 'specialty', 'care', 'medicine',
        'internal', '24', '7'
    ]);

    const CITY_MUNICIPALITY_WORDS = new Set([
        'borough', 'city', 'municipality', 'town', 'township', 'village'
    ]);

    const CITY_AREA_MODIFIERS = new Set([
        'central', 'east', 'eastern', 'north', 'northeast', 'northern', 'northwest',
        'south', 'southeast', 'southern', 'southwest', 'west', 'western'
    ]);

    function normalizeCompact(value) {
        return (value || '')
            .toLowerCase()
            .replace(/^city\s+of\s+/i, '')
            .replace(/[^a-z0-9]/g, '');
    }

    function normalizeWords(value) {
        return (value || '')
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .toLowerCase()
            .replace(/&/g, ' and ')
            .replace(/[^a-z0-9]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function normalizeCityCore(value) {
        const normalized = normalizeWords(value)
            .replace(/^(?:borough|city|municipality|town|township|village)\s+of\s+/, '');
        const tokens = normalized
            .split(' ')
            .filter(token => token && !CITY_MUNICIPALITY_WORDS.has(token));
        const coreTokens = tokens.filter(token => !CITY_AREA_MODIFIERS.has(token));
        return (coreTokens.length > 0 ? coreTokens : tokens).join('');
    }

    function areCitiesCompatible(expectedCity, candidateCity) {
        if (!expectedCity) return true;
        if (!candidateCity) return false;

        if (normalizeCompact(expectedCity) === normalizeCompact(candidateCity)) return true;

        const expectedCore = normalizeCityCore(expectedCity);
        const candidateCore = normalizeCityCore(candidateCity);
        return Boolean(expectedCore && candidateCore && expectedCore === candidateCore);
    }

    function normalizeDescriptionBrandBoundaries(value) {
        return (value || '')
            .replace(/([a-z])(?=(?:Med\s*Vet|WestVet)\b)/g, '$1 ')
            .replace(/\u00c2(?=\s|$)/g, ' ')
            .replace(/\u00a0/g, ' ');
    }

    function normalizeState(value) {
        const state = (value || '').trim().replace(/\.$/, '');
        if (!state) return '';
        if (/^[A-Z]{2}$/i.test(state)) return state.toUpperCase();

        const normalized = normalizeCompact(state);
        const match = Object.entries(STATE_ABBREVIATIONS)
            .find(([, fullName]) => normalizeCompact(fullName) === normalized);
        return match ? match[0] : state.toUpperCase();
    }

    function parseLocation(value) {
        const parts = (value || '').split(',').map(part => part.trim()).filter(Boolean);
        return {
            city: parts[0] || '',
            state: parts.length >= 2 ? normalizeState(parts[1]) : ''
        };
    }

    function getBrand(value) {
        const text = value || '';
        if (/\bwest\s*vet\b/i.test(text)) return 'WestVet';
        if (/\bmed\s*vet\b/i.test(text)) return 'MedVet';
        return '';
    }

    function brandMatches(value, expectedBrand) {
        if (expectedBrand === 'WestVet') return /\bwest\s*vet\b/i.test(value || '');
        if (expectedBrand === 'MedVet') return /\bmed\s*vet\b/i.test(value || '');
        return false;
    }

    function collapseRepeatedBrand(value) {
        const text = (value || '').replace(/\s+/g, ' ').trim();
        const matches = [...text.matchAll(/(?:Med\s*Vet|WestVet)/ig)];
        if (matches.length <= 1) return text;
        return text.slice(matches[matches.length - 1].index).trim();
    }

    function hasSuspiciousHospitalSuffix(value) {
        const siteName = (value || '').replace(/^\s*(?:Med\s*Vet|WestVet)\b\s*/i, '').trim();
        if (!siteName) return false;
        if (/^[a-z]/.test(siteName)) return true;
        return /\b(?:a\s+medvet\s+partner|established|team|at\s+our|join\s+our|seeks?|seeking|candidate|individual|to\s+enhance|online|board-certified|residency-trained)\b/i.test(siteName);
    }

    function normalizeHospitalName(value, location, fallbackValue = '') {
        const locationParts = parseLocation(location);
        const candidates = [value, fallbackValue].filter(Boolean);

        for (const rawCandidate of candidates) {
            let candidate = collapseRepeatedBrand(rawCandidate)
                .replace(/\s*[|·].*$/, '')
                .replace(/\s+/g, ' ')
                .trim();
            const brand = getBrand(candidate);
            if (!brand) continue;

            if (hasSuspiciousHospitalSuffix(candidate)) {
                candidate = brand;
            }

            const siteName = candidate.replace(/^\s*(?:Med\s*Vet|WestVet)\b\s*/i, '').trim();
            if (siteName) return `${brand} ${siteName}`;
            if (locationParts.city) return `${brand} ${locationParts.city}`;
            return brand;
        }

        return locationParts.city ? `MedVet ${locationParts.city}` : 'MedVet';
    }

    function normalizeAddressCacheValue(value) {
        return (value || '')
            .toLowerCase()
            .replace(/&/g, ' and ')
            .replace(/\([^)]*\)/g, ' ')
            .replace(/[-\u2013\u2014]/g, ' ')
            .replace(/\b(?:hospital|clinic|center|centre|veterinary|animal|pet)\b/g, ' ')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    }

    function getAddressCacheKeys(hospitalName, location, originalHospitalName = '') {
        const names = new Set([hospitalName, originalHospitalName].filter(Boolean));
        for (const name of [...names]) {
            names.add(normalizeHospitalName(name, location, originalHospitalName || hospitalName));
        }

        const locationKey = normalizeAddressCacheValue(location);
        const keys = new Set();
        for (const name of names) {
            const hospitalKey = normalizeAddressCacheValue(name);
            if (hospitalKey && locationKey) keys.add(`${hospitalKey}|${locationKey}`);
        }
        return [...keys];
    }

    function hospitalSiteTokens(value) {
        return normalizeWords(value)
            .split(' ')
            .filter(token => token && !['medvet', 'westvet', 'med', 'west', 'vet'].includes(token) && !NAME_STOP_WORDS.has(token));
    }

    function placeNameMatchScore(expectedHospital, placeName) {
        const expectedTokens = hospitalSiteTokens(expectedHospital);
        const placeWords = new Set(hospitalSiteTokens(placeName));
        if (expectedTokens.length === 0) return 0;

        const matched = expectedTokens.filter(token => placeWords.has(token)).length;
        return matched / expectedTokens.length;
    }

    function isGenericHospitalName(value) {
        return /^(?:Med\s*Vet|WestVet)$/i.test((value || '').trim());
    }

    function looksLikeStreetAddress(value) {
        const street = (value || '').replace(/\s+/g, ' ').trim();
        if (!/^\d{1,6}\s+[A-Za-z0-9]/.test(street)) return false;
        return /\b(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Rd|Road|Ln|Lane|Way|Ct|Court|Pl|Place|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Trl|Trail|Loop|Ter|Terrace|Expy|Expressway|Fwy|Freeway|N|S|E|W|North|South|East|West|NE|NW|SE|SW)\b/i.test(street)
            || /\b(?:US|Route|Rte|State Route|SR)-?\s*\d+\b/i.test(street);
    }

    function emptyAddressResult() {
        return {
            streetAddress: '', zipCode: '', city: '', state: '', fullAddress: '',
            website: '', phone: '', placeName: '', sourceType: '', locationMismatch: false,
            verified: false
        };
    }

    function validateAddressCandidate(candidate, context) {
        const expectedHospital = normalizeHospitalName(
            context?.hospitalName || '',
            context?.location || '',
            context?.originalHospitalName || ''
        );
        const result = candidate || emptyAddressResult();
        const expectedBrand = getBrand(expectedHospital);
        const expectedLocation = parseLocation(context?.location || '');
        const sourceType = result.sourceType || context?.sourceType || '';

        if (sourceType === 'google-search-body') {
            return { accepted: false, reason: 'untrusted-search-body', result: emptyAddressResult() };
        }
        if (!result.streetAddress || !result.zipCode || !result.city || !result.state) {
            return { accepted: false, reason: 'incomplete-address', result: emptyAddressResult() };
        }
        if (!looksLikeStreetAddress(result.streetAddress)) {
            return { accepted: false, reason: 'invalid-street-address', result: emptyAddressResult() };
        }
        if (!/^\d{5}(?:-\d{4})?$/.test((result.zipCode || '').trim())) {
            return { accepted: false, reason: 'invalid-zip-code', result: emptyAddressResult() };
        }
        if (!result.placeName) {
            return { accepted: false, reason: 'missing-place-name', result: emptyAddressResult() };
        }
        if (!expectedBrand || !brandMatches(result.placeName, expectedBrand)) {
            return { accepted: false, reason: 'brand-mismatch', result: emptyAddressResult() };
        }

        const resultState = normalizeState(result.state);
        if (expectedLocation.state && resultState !== expectedLocation.state) {
            return { accepted: false, reason: 'state-mismatch', result: emptyAddressResult() };
        }

        const exactCityMatch = !expectedLocation.city
            || normalizeCompact(result.city) === normalizeCompact(expectedLocation.city);
        const cityMatches = areCitiesCompatible(expectedLocation.city, result.city);

        if (!cityMatches) {
            return { accepted: false, reason: 'city-mismatch', result: emptyAddressResult() };
        }

        return {
            accepted: true,
            reason: exactCityMatch ? 'verified' : 'verified-city-variant',
            result: {
                streetAddress: result.streetAddress || '',
                zipCode: result.zipCode || '',
                city: result.city || '',
                state: result.state || '',
                fullAddress: result.fullAddress || '',
                website: result.website || '',
                phone: result.phone || '',
                placeName: result.placeName || '',
                sourceType,
                locationMismatch: false,
                verified: true
            }
        };
    }

    function selectAtomicAddress(current, candidate, context) {
        const currentValidation = validateAddressCandidate(current, context);
        if (currentValidation.accepted) return currentValidation.result;

        const candidateValidation = validateAddressCandidate(candidate, context);
        return candidateValidation.accepted ? candidateValidation.result : emptyAddressResult();
    }

    function extractExplicitHospitalName(description, location, currentHospital = '') {
        const locationParts = parseLocation(location);
        const city = locationParts.city;
        if (!description) return '';

        const body = normalizeDescriptionBrandBoundaries(description || '')
            .split(/===\s*FULL JOB DESCRIPTION\s*===/i)
            .pop()
            .replace(/\s+/g, ' ')
            .trim();

        // Prefer an explicitly named facility even when the listing city is a
        // neighboring municipality (for example, WestVet Boise in Garden City).
        // Requiring a hiring statement or facility heading avoids generic brand
        // mentions in company boilerplate.
        const explicitPatterns = [
            /\b((?:Med\s*Vet|WestVet)\s+[A-Za-z0-9&'.-]+(?:\s+[A-Za-z0-9&'.-]+){0,3}?)\s+(?:is|has|will|seeks?|seeking|looks?|looking)\b/ig,
            /\bWhy\s+(?:join\s+the\s+team\s+at|join|choose|work\s+at|will\s+you\s+love\s+working\s+at)\s+((?:Med\s*Vet|WestVet)\s+[A-Z][A-Za-z0-9&'.-]*(?:\s+[A-Z][A-Za-z0-9&'.-]*){0,3})\s*[?!]/ig,
            /\bLearn\s+more\s+about\s+((?:Med\s*Vet|WestVet)\s+[A-Z][A-Za-z0-9&'.-]*(?:\s+[A-Z][A-Za-z0-9&'.-]*){0,3})\b/ig
        ];

        for (const pattern of explicitPatterns) {
            const match = pattern.exec(body);
            if (!match) continue;
            const candidate = collapseRepeatedBrand(match[1])
                .replace(/^Med\s*Vet\b/i, 'MedVet')
                .replace(/\s+/g, ' ')
                .trim();
            if (candidate && !hasSuspiciousHospitalSuffix(candidate)) return candidate;
        }

        if (!city) return '';
        const escapedCity = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const namedPattern = new RegExp(`\\b(Med\\s*Vet|WestVet)\\s+${escapedCity}\\b`, 'i');
        const namedMatch = body.match(namedPattern);
        if (namedMatch) {
            const brand = /west/i.test(namedMatch[1]) ? 'WestVet' : 'MedVet';
            return `${brand} ${city}`;
        }

        const cityHospitalPattern = new RegExp(
            `\\b(?:join|support|serve|grow)[^.]{0,160}?\\bour\\s+(?:new\\s+)?${escapedCity}\\s*,[^.]{0,40}?\\bhospital\\b`,
            'i'
        );
        if (cityHospitalPattern.test(body)) {
            return `${getBrand(currentHospital) || getBrand(body) || 'MedVet'} ${city}`;
        }

        return '';
    }

    function getDescriptionBody(description) {
        return normalizeDescriptionBrandBoundaries(description || '')
            .split(/===\s*FULL JOB DESCRIPTION\s*===/i)
            .pop()
            .replace(/\s+/g, ' ')
            .trim();
    }

    function getSpecialtyRole(text) {
        const source = text || '';
        const rules = [
            ['Radiation Oncologist', /\bradiation\s+oncolog(?:ist|y)\b/i],
            ['Medical Oncologist', /\b(?:medical\s+)?oncolog(?:ist|y)\b/i],
            ['Neurologist & Neurosurgeon', /\b(?:neurologist|neurosurgeon|neurology)\b/i],
            ['Internal Medicine Specialist', /\b(?:veterinary\s+)?internist\b|\binternal\s+medicine\s+specialist\b/i],
            ['Anesthesiologist', /\b(?:veterinary\s+)?anesthesiologist\b/i],
            ['Cardiologist', /\b(?:veterinary\s+)?cardiologist\b/i],
            ['Dental Specialist', /\b(?:veterinary\s+dentist|dental\s+specialist|oral\s+surgeon)\b/i],
            ['Dermatologist', /\b(?:veterinary\s+)?dermatologist\b/i],
            ['ECC Specialist', /\b(?:criticalist|ecc\s+specialist)\b/i],
            ['Ophthalmologist', /\b(?:veterinary\s+)?ophthalmologist\b/i],
            ['Radiologist', /\b(?:veterinary\s+)?radiologist\b|\bdiagnostic\s+imaging\s+specialist\b/i],
            ['Surgeon', /\b(?:veterinary\s+)?surgeon\b/i],
            ['Avian & Exotic Specialist', /\bavian\s+(?:and|&)\s+exotic\s+specialist\b/i],
            ['Sports Medicine & Rehabilitation Specialist', /\b(?:sports\s+medicine\s+(?:and|&)\s+rehabilitation|rehabilitation)\s+specialist\b/i]
        ];

        let best = null;
        for (const [position, pattern] of rules) {
            const match = pattern.exec(source);
            if (!match) continue;
            if (!best || match.index < best.index) best = { position, index: match.index };
        }
        return best?.position || '';
    }

    function hasSpecialtyTitleDescriptionConflict(title, description) {
        if (/\bmedical\s+director\b/i.test(title || '')) return false;
        const titleRole = getSpecialtyRole(title || '');
        if (!titleRole) return false;

        const body = getDescriptionBody(description);
        const hiringMatch = body.match(/\b(?:is|are|we\s+are)\s+(?:currently\s+)?(?:seeking|looking\s+for|hiring)\b.{0,260}/i);
        if (!hiringMatch) return false;

        const descriptionRole = getSpecialtyRole(hiringMatch[0]);
        return Boolean(descriptionRole && descriptionRole !== titleRole);
    }

    function classifyJobType(description) {
        const text = description || '';
        const hasPartTime = /\bpart[\s-]?time\b/i.test(text);
        const hasFullTime = /\bfull[\s-]?time\b/i.test(text);

        if (hasPartTime && !hasFullTime) return 'Part-Time';
        return 'Full-Time';
    }

    function structuredLocationKeys(description) {
        const keys = new Set();
        const match = (description || '').match(/Locations:\s*\n((?:\s*-\s*[^\n]+\n?)+)/i);
        if (!match) return keys;

        for (const rawLine of match[1].split('\n')) {
            const line = rawLine.trim().replace(/^-\s*/, '');
            if (!line) continue;
            const parts = line.split(',').map(part => part.trim()).filter(Boolean);
            if (parts.length < 2) continue;
            const city = normalizeCompact(parts[0]);
            const state = normalizeState(parts[1]);
            if (city && state) keys.add(`${city}|${state}`);
        }
        return keys;
    }

    function recordLocationKey(record) {
        const parsed = parseLocation(record?.location || [record?.city, record?.state].filter(Boolean).join(', '));
        const city = normalizeCompact(parsed.city);
        const state = normalizeState(parsed.state || record?.state || '');
        return city && state ? `${city}|${state}` : '';
    }

    function descriptionBodyMentionsLocation(description, location) {
        const city = parseLocation(location).city;
        if (!city) return false;

        const body = normalizeDescriptionBrandBoundaries(description || '')
            .split(/===\s*FULL JOB DESCRIPTION\s*===/i)
            .pop();
        const normalizedBody = ` ${normalizeWords(body)} `;
        const normalizedCity = normalizeWords(city);
        return Boolean(normalizedCity && normalizedBody.includes(` ${normalizedCity} `));
    }

    function removeStaleGeneratedLocationRows(records) {
        const source = Array.isArray(records) ? records : [];
        const parentById = new Map();
        const parentByLink = new Map();

        for (const record of source) {
            const isGenerated = Boolean(record?.parentJobId) || /-loc-/i.test(record?.jobId || '');
            if (isGenerated) continue;
            if (record?.jobId) parentById.set(record.jobId, record);
            if (record?.link) parentByLink.set(record.link, record);
        }

        return source.filter(record => {
            const isGenerated = Boolean(record?.parentJobId) || /-loc-/i.test(record?.jobId || '');
            if (!isGenerated) return true;

            const parent = parentById.get(record?.parentJobId || '')
                || parentByLink.get(record?.sourceLink || record?.link || '');
            if (!parent) return true;

            const allowedLocations = structuredLocationKeys(parent.description || '');
            if (allowedLocations.size === 0) return true;

            const locationKey = recordLocationKey(record);
            return !locationKey
                || allowedLocations.has(locationKey)
                || descriptionBodyMentionsLocation(parent.description || '', record.location || '');
        });
    }

    function reconcileGenericHospitalNames(records) {
        const candidatesByLocation = new Map();
        let updatedCount = 0;

        for (const record of records || []) {
            const explicitName = extractExplicitHospitalName(
                record?.description || '',
                record?.location || [record?.city, record?.state].filter(Boolean).join(', '),
                record?.hospital || ''
            );
            const currentHospital = (record?.hospital || '').trim();
            const locationCity = parseLocation(
                record?.location || [record?.city, record?.state].filter(Boolean).join(', ')
            ).city;
            const normalizedHospital = ` ${normalizeWords(currentHospital)} `;
            const normalizedLocationCity = normalizeWords(locationCity);
            const alreadyNamesLocation = Boolean(
                normalizedLocationCity
                && normalizedHospital.includes(` ${normalizedLocationCity} `)
            );
            const shouldCorrectName = isGenericHospitalName(currentHospital)
                || hasSuspiciousHospitalSuffix(currentHospital)
                || !alreadyNamesLocation;

            if (explicitName && explicitName !== currentHospital && shouldCorrectName) {
                record.hospital = explicitName;
                record.hospitalNameUpdated = true;
                updatedCount++;
            }
        }

        for (const record of records || []) {
            const hospital = collapseRepeatedBrand(record?.hospital || '')
                .replace(/\s*[|·].*$/, '')
                .replace(/\s+/g, ' ')
                .trim();
            const brand = getBrand(hospital);
            const locationKey = normalizeCompact(record?.location || [record?.city, record?.state].filter(Boolean).join(', '));
            if (!brand || !locationKey || isGenericHospitalName(hospital) || hasSuspiciousHospitalSuffix(hospital)) continue;

            const key = `${brand.toLowerCase()}|${locationKey}`;
            if (!candidatesByLocation.has(key)) candidatesByLocation.set(key, new Map());
            const counts = candidatesByLocation.get(key);
            counts.set(hospital, (counts.get(hospital) || 0) + 1);
        }

        for (const record of records || []) {
            const hospital = (record?.hospital || '').replace(/\s+/g, ' ').trim();
            if (!isGenericHospitalName(hospital)) continue;

            const brand = getBrand(hospital);
            const locationKey = normalizeCompact(record?.location || [record?.city, record?.state].filter(Boolean).join(', '));
            if (!brand || !locationKey) continue;

            const counts = candidatesByLocation.get(`${brand.toLowerCase()}|${locationKey}`);
            if (!counts || counts.size === 0) continue;

            const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
            if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) continue;

            record.hospital = ranked[0][0];
            record.hospitalNameUpdated = true;
            updatedCount++;
        }

        return updatedCount;
    }

    return {
        areCitiesCompatible,
        classifyJobType,
        emptyAddressResult,
        extractExplicitHospitalName,
        getAddressCacheKeys,
        getBrand,
        isGenericHospitalName,
        normalizeCompact,
        normalizeHospitalName,
        normalizeState,
        parseLocation,
        placeNameMatchScore,
        hasSpecialtyTitleDescriptionConflict,
        reconcileGenericHospitalNames,
        removeStaleGeneratedLocationRows,
        selectAtomicAddress,
        validateAddressCandidate
    };
});
