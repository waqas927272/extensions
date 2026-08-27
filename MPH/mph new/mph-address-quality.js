(function initializeMphAddressQuality(root, factory) {
    const api = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }

    if (root) root.MphAddressQuality = api;
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

    const GENERIC_NAME_WORDS = new Set([
        'the', 'and', 'of', 'at', 'in', 'for', 'with', 'a', 'an', 'animal', 'animals',
        'veterinary', 'veterinarian', 'vet', 'hospital', 'hospitals', 'clinic', 'clinics',
        'center', 'centre', 'medical', 'pet', 'pets', 'care', 'health', 'healthcare',
        'emergency', 'urgent', 'specialty', 'specialist', 'specialists', 'service', 'services'
    ]);

    const BLOCKED_WEBSITE_PARTS = [
        'google.', 'gstatic.', 'googleusercontent.', 'facebook.', 'instagram.', 'linkedin.',
        'yelp.', 'mapquest.', 'bing.', 'duckduckgo.', 'indeed.', 'glassdoor.', 'ziprecruiter.'
    ];

    function normalizeWords(value) {
        return String(value || '')
            .replace(/\b(?:hopsital|hosptital|hospial)\b/gi, 'hospital')
            .replace(/\blive\s+well\b/gi, 'livewell')
            .replace(/&/g, ' and ')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function normalizeCompact(value) {
        return normalizeWords(value).replace(/\s+/g, '');
    }

    function normalizeState(value) {
        const state = String(value || '').trim().replace(/\.$/, '');
        if (!state) return '';
        if (/^[A-Z]{2}$/i.test(state)) return state.toUpperCase();
        const compact = normalizeCompact(state);
        const match = Object.entries(STATE_ABBREVIATIONS)
            .find(([, fullName]) => normalizeCompact(fullName) === compact);
        return match ? match[0] : state.toUpperCase();
    }

    function parseLocation(location) {
        const parts = String(location || '').split(',').map(part => part.trim()).filter(Boolean);
        return {
            city: parts[0] || '',
            state: parts.length >= 2 ? normalizeState(parts[1]) : ''
        };
    }

    function meaningfulTokens(value) {
        return normalizeWords(value)
            .split(' ')
            .filter(token => token.length > 1 && !GENERIC_NAME_WORDS.has(token));
    }

    function branchTokens(value) {
        const source = String(value || '');
        const segments = [];
        for (const match of source.matchAll(/\(([^)]+)\)/g)) segments.push(match[1]);
        const dash = source.match(/\s[-–—]\s(.+)$/);
        if (dash) segments.push(dash[1]);
        return [...new Set(segments.flatMap(meaningfulTokens))];
    }

    function normalizeAddressCacheValue(value) {
        // Parenthetical and branch text is intentionally retained. Removing it caused
        // Charlestown/Seaport, River North/Wicker Park, and similar branches to collide.
        return normalizeWords(value);
    }

    function getAddressCacheKeys(hospitalName, location, originalHospitalName = '') {
        const exactName = String(originalHospitalName || hospitalName || '').trim();
        const hospitalKey = normalizeAddressCacheValue(exactName);
        const locationKey = normalizeAddressCacheValue(location);
        return hospitalKey && locationKey ? [`${hospitalKey}|${locationKey}`] : [];
    }

    function websiteParts(url) {
        try {
            const parsed = new URL(url || '');
            return normalizeWords(`${parsed.hostname.replace(/^www\./i, '')} ${parsed.pathname}`);
        } catch (_) {
            return '';
        }
    }

    function sanitizeWebsite(url) {
        try {
            const parsed = new URL(url || '');
            if (!/^https?:$/.test(parsed.protocol)) return '';
            const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
            if (!host || BLOCKED_WEBSITE_PARTS.some(part => host.includes(part))) return '';
            parsed.hash = '';
            return parsed.href;
        } catch (_) {
            return '';
        }
    }

    function normalizePhone(phone) {
        let digits = String(phone || '').replace(/\D/g, '');
        if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
        if (digits.length !== 10 || /^[01]/.test(digits)) return '';
        return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }

    function looksLikeStreetAddress(value) {
        const street = String(value || '').replace(/\s+/g, ' ').trim();
        const startsWithNumber = /^\d{1,6}\s+[A-Za-z0-9]/.test(street);
        const wisconsinGrid = /^[NSEW]\d{2,6}[NSEW]\d{2,6}\s+/i.test(street);
        if (!startsWithNumber && !wisconsinGrid) return false;
        return /\b(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Rd|Road|Ln|Lane|Way|Ct|Court|Pl|Place|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Trl|Trail|Loop|Ter|Terrace|Expy|Expressway|Fwy|Freeway|Route|Rte|NE|NW|SE|SW|N|S|E|W)\b/i.test(street);
    }

    function emptyAddressResult() {
        return {
            businessName: '', streetAddress: '', zipCode: '', city: '', state: '',
            fullAddress: '', website: '', phone: '', sourceType: '', verified: false,
            allowPostalCityMismatch: false, identityScore: 0
        };
    }

    function identityDetails(expectedHospital, candidate) {
        const expectedTokens = meaningfulTokens(expectedHospital);
        const candidateIdentity = normalizeWords(`${candidate?.businessName || ''} ${websiteParts(candidate?.website || '')}`);
        const candidateTokenSet = new Set(meaningfulTokens(candidateIdentity));
        const matched = expectedTokens.filter(token => candidateTokenSet.has(token));
        const coverage = expectedTokens.length ? matched.length / expectedTokens.length : 0;
        const requiredLead = expectedTokens[0] || '';
        const leadMatched = !requiredLead || candidateTokenSet.has(requiredLead);
        const requiredBranches = branchTokens(expectedHospital);
        const branchesMatched = requiredBranches.every(token => candidateTokenSet.has(token));
        const exactExpected = normalizeWords(expectedHospital);
        const exactName = normalizeWords(candidate?.businessName || '');
        const exactMatch = Boolean(exactExpected && exactName && (exactExpected.includes(exactName) || exactName.includes(exactExpected)));
        const score = Math.max(coverage, exactMatch ? 1 : 0);
        return { expectedTokens, coverage: score, leadMatched, branchesMatched, candidateIdentity };
    }

    function hospitalIdentityMatches(expectedHospital, candidate) {
        const sourceType = candidate?.sourceType || '';
        const details = identityDetails(expectedHospital, candidate);
        const isTrustedLivewell = sourceType === 'livewell-geojson'
            && /\blivewell\b/.test(normalizeWords(expectedHospital))
            && /\blivewell\b/.test(details.candidateIdentity);
        if (isTrustedLivewell) return details.coverage >= 0.5 && details.branchesMatched;
        if (!candidate?.businessName && !sanitizeWebsite(candidate?.website || '')) return false;
        return details.leadMatched && details.branchesMatched && details.coverage >= 0.6;
    }

    function validateAddressCandidate(candidate, context = {}) {
        const result = { ...emptyAddressResult(), ...(candidate || {}) };
        const expectedHospital = context.originalHospitalName || context.hospitalName || '';
        const expectedLocation = parseLocation(context.location || '');
        const resultState = normalizeState(result.state || '');
        const resultCity = normalizeCompact(result.city || '');
        const expectedCity = normalizeCompact(expectedLocation.city);

        if (!looksLikeStreetAddress(result.streetAddress)) {
            return { accepted: false, reason: 'invalid-street-address', score: 0, result: emptyAddressResult() };
        }
        if (!/^\d{5}(?:-\d{4})?$/.test(String(result.zipCode || '').trim())) {
            return { accepted: false, reason: 'invalid-zip-code', score: 0, result: emptyAddressResult() };
        }
        if (expectedLocation.state && resultState !== expectedLocation.state) {
            return { accepted: false, reason: 'state-mismatch', score: 0, result: emptyAddressResult() };
        }
        if (expectedLocation.state && typeof context.zipMatchesState === 'function'
            && !context.zipMatchesState(result.zipCode, expectedLocation.state)) {
            return { accepted: false, reason: 'zip-state-mismatch', score: 0, result: emptyAddressResult() };
        }
        if (!hospitalIdentityMatches(expectedHospital, result)) {
            return { accepted: false, reason: 'hospital-identity-mismatch', score: 0, result: emptyAddressResult() };
        }

        const identity = identityDetails(expectedHospital, result);
        const cityMatches = !expectedCity || resultCity === expectedCity;
        const trustedPostalCityMismatch = Boolean(result.allowPostalCityMismatch)
            && ['livewell-geojson', 'official-website', 'verified-override'].includes(result.sourceType || '');
        if (!cityMatches && (!trustedPostalCityMismatch || identity.coverage < 0.75)) {
            return { accepted: false, reason: 'city-and-hospital-mismatch', score: 0, result: emptyAddressResult() };
        }

        result.website = sanitizeWebsite(result.website);
        result.phone = normalizePhone(result.phone);
        result.state = resultState || result.state || '';
        result.verified = true;
        result.identityScore = identity.coverage;
        result.allowPostalCityMismatch = !cityMatches && trustedPostalCityMismatch;

        const completeness = (result.website ? 4 : 0) + (result.phone ? 4 : 0)
            + (result.fullAddress ? 1 : 0);
        const score = identity.coverage * 100 + (cityMatches ? 10 : 0) + completeness;
        return {
            accepted: true,
            reason: cityMatches ? 'verified' : 'verified-postal-city-mismatch',
            score,
            result
        };
    }

    function selectAtomicAddress(current, candidate, context = {}) {
        const currentValidation = validateAddressCandidate(current, context);
        const candidateValidation = validateAddressCandidate(candidate, context);
        if (!currentValidation.accepted) return candidateValidation.accepted ? candidateValidation.result : emptyAddressResult();
        if (!candidateValidation.accepted) return currentValidation.result;
        // Select one whole place record. Never splice an address, phone, and website
        // from separate search results.
        return candidateValidation.score > currentValidation.score
            ? candidateValidation.result
            : currentValidation.result;
    }

    function shouldRefetchAddress(job) {
        return !job?.streetAddress || !job?.zipCode || !job?.phone || !sanitizeWebsite(job?.website || '')
            || /^(?:TBD|Not Available)$/i.test(job?.streetAddress || '')
            || job?.zipCode === '00000';
    }

    return {
        branchTokens,
        emptyAddressResult,
        getAddressCacheKeys,
        hospitalIdentityMatches,
        meaningfulTokens,
        normalizeAddressCacheValue,
        normalizeCompact,
        normalizePhone,
        normalizeState,
        parseLocation,
        sanitizeWebsite,
        selectAtomicAddress,
        shouldRefetchAddress,
        validateAddressCandidate
    };
});
