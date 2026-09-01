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
            .replace(/\bhwy\b/gi, 'highway')
            .replace(/\bfive\b/gi, '5')
            .replace(/&/g, ' and ')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function normalizeCompact(value) {
        return normalizeWords(value).replace(/\s+/g, '');
    }

    function normalizeCity(value) {
        // Only spelling-equivalent abbreviations are normalized. Administrative
        // suffixes stay significant so separate cities/branches never collapse.
        return normalizeWords(value)
            .replace(/\bmount\b/g, 'mt')
            .replace(/\bsaint\b/g, 'st')
            .replace(/\bfort\b/g, 'ft')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/\s+/g, '');
    }

    const POSTAL_CITY_MODIFIERS = new Set([
        'north', 'south', 'east', 'west', 'upper', 'lower',
        'charter', 'township', 'town', 'village', 'borough',
        'heights', 'hills', 'beach', 'center', 'city'
    ]);

    function normalizeCityTokens(value) {
        return normalizeWords(value)
            .replace(/\bmount\b/g, 'mt')
            .replace(/\bsaint\b/g, 'st')
            .replace(/\bfort\b/g, 'ft')
            .split(' ')
            .filter(Boolean);
    }

    function isMoreSpecificPostalCity(expectedCity, resultCity) {
        const expectedTokens = normalizeCityTokens(expectedCity);
        const resultTokens = normalizeCityTokens(resultCity);
        if (!expectedTokens.length || resultTokens.length <= expectedTokens.length) return false;

        const resultBaseTokens = resultTokens.filter(token => !POSTAL_CITY_MODIFIERS.has(token));
        if (resultBaseTokens.join(' ') !== expectedTokens.join(' ')) return false;

        const extraTokens = resultTokens.filter(token => !expectedTokens.includes(token));
        return extraTokens.length > 0 && extraTokens.every(token => POSTAL_CITY_MODIFIERS.has(token));
    }

    function normalizeHospitalName(value) {
        return String(value || '')
            .replace(/\b(?:hopsital|hosptital|hospial)\b/gi, 'Hospital')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function cleanAddressText(value) {
        let clean = String(value || '')
            .replace(/\u00a0/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/^\s*(?:Address|Located in)\s*:\s*/i, '')
            .trim();

        // Google can expose the same element through aria-label, innerText, and
        // textContent. When those values are joined the result looks like
        // "..., United States Address: ...". Keep the first complete address.
        const repeatedLabel = clean.search(/\s+(?:Address|Located in)\s*:\s*/i);
        if (repeatedLabel > 0) clean = clean.slice(0, repeatedLabel).trim();

        return clean
            .replace(/\s*,\s*/g, ', ')
            .replace(/,\s*$/, '')
            .trim();
    }

    function normalizeStreetAddress(value, context = {}) {
        let street = cleanAddressText(value)
            .replace(/,?\s+(?:United States(?: of America)?|USA)\s*$/i, '')
            .trim();
        const city = String(context.city || '').trim();
        const state = normalizeState(context.state || '');
        const zipCode = String(context.zipCode || '').trim();

        if (city && state) {
            const escapedCity = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const escapedZip = zipCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const suffix = new RegExp(
                `,?\\s*${escapedCity}\\s*,\\s*${state}(?:\\s+${escapedZip || '\\d{5}(?:-\\d{4})?'})?.*$`,
                'i'
            );
            street = street.replace(suffix, '').trim();
        }

        return street.replace(/,\s*$/, '').trim();
    }

    function streetAddressesMatch(left, right) {
        const normalizeForStreetMatch = value => normalizeWords(normalizeStreetAddress(value))
            .replace(/\bnorth\b/g, 'n')
            .replace(/\bsouth\b/g, 's')
            .replace(/\beast\b/g, 'e')
            .replace(/\bwest\b/g, 'w')
            .replace(/\bstreet\b/g, 'st')
            .replace(/\broad\b/g, 'rd')
            .replace(/\bavenue\b/g, 'ave')
            .replace(/\bboulevard\b/g, 'blvd')
            .replace(/\bdrive\b/g, 'dr')
            .replace(/\blane\b/g, 'ln')
            .replace(/\bhighway\b/g, 'hwy')
            .replace(/\bparkway\b/g, 'pkwy')
            .replace(/\bcourt\b/g, 'ct')
            .replace(/\bplace\b/g, 'pl')
            .replace(/\b(?:suite|ste|unit|building|bldg|floor)\b.*$/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        const a = normalizeForStreetMatch(left);
        const b = normalizeForStreetMatch(right);
        if (!a || !b) return false;
        return a === b || a.includes(b) || b.includes(a);
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

    function fullStateName(value) {
        const abbreviation = normalizeState(value);
        return STATE_ABBREVIATIONS[abbreviation] || String(value || '').trim();
    }

    function parseStructuredAddress(rawAddress) {
        if (!rawAddress) return { streetAddress: '', city: '', state: '', zipCode: '' };
        const clean = cleanAddressText(rawAddress);
        const stateNames = Object.values(STATE_ABBREVIATIONS)
            .sort((left, right) => right.length - left.length)
            .map(stateName => stateName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('|');
        const stateZipMatch = clean.match(new RegExp(
            `(?:,\\s*)?\\b(${stateNames}|[A-Z]{2})(?:\\s+(\\d{4,5}(?:-\\d{4})?))?(?:\\s+(?:Suite|Ste\\.?|Unit)\\s+#?\\s*[A-Za-z0-9-]+)?(?:,?\\s+United States(?: of America)?)?$`,
            'i'
        ));
        if (!stateZipMatch) return { streetAddress: '', city: '', state: '', zipCode: '' };

        const prefix = clean.slice(0, stateZipMatch.index).replace(/[,\.\s]+$/, '').trim();
        if (!prefix) return { streetAddress: '', city: '', state: '', zipCode: '' };
        const commaParts = prefix.split(/\s*,\s*/).map(part => part.trim()).filter(Boolean);
        let city = '';
        let streetAddress = '';

        if (commaParts.length >= 2) {
            city = commaParts.pop();
            streetAddress = commaParts.join(', ');
        } else {
            const streetAndCity = prefix.match(
                /^(\d.+?\b(?:Street|St\.?|Road|Rd\.?|Avenue|Ave\.?|Way|Lane|Ln\.?|Boulevard|Blvd\.?|Drive|Dr\.?|Highway|Hwy\.?|Court|Ct\.?|Parkway|Pkwy\.?|Place|Pl\.?))(?:\s+(N|S|E|W|NE|NW|SE|SW|North|South|East|West))?\s+(.+)$/i
            );
            if (streetAndCity) {
                streetAddress = streetAndCity[1].trim();
                if (streetAndCity[2]) streetAddress += ` ${streetAndCity[2]}`;
                city = streetAndCity[3].trim();
            } else {
                city = prefix;
            }
        }

        const unitMatch = city.match(/^((?:Unit|Suite|Ste\.?)\s+#?\s*[A-Za-z0-9-]+)\s+(.+)$/i)
            || city.match(/^(Building\s+[A-Za-z0-9]+(?:\s*&\s*[A-Za-z0-9]+)?)\s+(.+)$/i);
        if (unitMatch) {
            streetAddress = [streetAddress, unitMatch[1]].filter(Boolean).join(', ');
            city = unitMatch[2].trim();
        }

        let zipCode = stateZipMatch[2] || '';
        if (/^\d{4}$/.test(zipCode)) zipCode = zipCode.padStart(5, '0');
        return {
            streetAddress: normalizeStreetAddress(streetAddress),
            city: city.replace(/^[,;:\s]+|[,;:\s]+$/g, '').trim(),
            state: fullStateName(stateZipMatch[1]),
            zipCode
        };
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
        const namedBranch = source.match(/\b(?:hospital|clinic|center|centre|care)\s+of\s+(.+)$/i);
        if (namedBranch) segments.push(namedBranch[1]);
        const livewellBranch = source.match(/\blive\s*well\s+animal\s+(?:hospital|urgent\s+care)\s+(?:of\s+)?(.+)$/i);
        if (livewellBranch) segments.push(livewellBranch[1]);
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
        const startsWithNumber = /^\d{1,6}[A-Za-z]?(?:[-/]\d+)?\s+[A-Za-z0-9]/.test(street);
        const wisconsinGrid = /^(?:[NSEW]\d{2,6}\s*[NSEW]\d{2,6}(?:\s|,)|[NSEW]\d{2,6}\s+[A-Za-z])/i.test(street);
        const buildingPrefix = /^(?:Building|Bldg)\s+[A-Za-z0-9-]+,\s*\d{1,6}[A-Za-z]?\s+/i.test(street);
        if (!startsWithNumber && !wisconsinGrid && !buildingPrefix) return false;
        const namedStreet = /\b(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Rd|Road|Ln|Lane|Way|Wy|Ct|Court|Pl|Place|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Trl|Trail|Loop|Ter|Terrace|Expy|Expressway|Fwy|Freeway|Route|Rte|NE|NW|SE|SW|N|S|E|W)\b/i.test(street);
        const numberedHighway = /\b(?:US|SR|CR|FM|RM|I|[A-Z]{1,2})[-\s]?\d+[A-Z]?\b/i.test(street);
        // Google Maps' address button is already a structured place record. Some
        // valid streets have no conventional suffix ("1138 Via Verde") or use a
        // local abbreviation ("Sylo Xing", "Virtuoso Lp"). Identity, city/state,
        // and ZIP validation still run after this structural check.
        return namedStreet || numberedHighway || startsWithNumber || wisconsinGrid || buildingPrefix;
    }

    function emptyAddressResult() {
        return {
            businessName: '', streetAddress: '', zipCode: '', city: '', state: '',
            fullAddress: '', website: '', phone: '', category: '', panelText: '', sourceType: '', verified: false,
            allowPostalCityMismatch: false, uniquePlaceMatch: false, branchQueryResolved: false, identityScore: 0
        };
    }

    function isVeterinaryFacility(candidate) {
        const evidence = normalizeWords([
            candidate?.businessName || '',
            candidate?.category || '',
            candidate?.panelText || ''
        ].join(' '));
        return /\b(?:veterinary|veterinarian|veterinarians|animal hospital|animal clinic|animal medical|pet hospital|pet clinic|pet care|vet hospital|vet clinic|emergency vet|veterinary specialty)\b/.test(evidence);
    }

    function identityDetails(expectedHospital, candidate) {
        const requiredBranches = branchTokens(expectedHospital);
        const expectedTokens = meaningfulTokens(expectedHospital)
            .filter(token => !requiredBranches.includes(token));
        const candidateNameIdentity = normalizeWords(candidate?.businessName || '');
        const candidateIdentity = normalizeWords(`${candidate?.businessName || ''} ${websiteParts(candidate?.website || '')}`);
        const candidateTokenSet = new Set(meaningfulTokens(candidateIdentity));
        const candidateNameTokenSet = new Set(meaningfulTokens(candidateNameIdentity));
        const candidateNameWords = candidateNameIdentity.split(' ').filter(Boolean);
        const initials = candidateNameWords.map(word => word[0]).join('');
        const acronymTokens = new Set();
        for (let start = 0; start < initials.length; start++) {
            for (let length = 2; length <= 5 && start + length <= initials.length; length++) {
                acronymTokens.add(initials.slice(start, start + length));
            }
        }
        const locationTokenSet = new Set(meaningfulTokens(`${candidate?.city || ''} ${candidate?.state || ''} ${candidate?.fullAddress || ''}`));
        const tokenMatchesIdentity = token => candidateTokenSet.has(token)
            || candidateIdentity.includes(token)
            || acronymTokens.has(token);
        const tokenMatchesName = token => candidateNameTokenSet.has(token)
            || candidateNameIdentity.includes(token)
            || acronymTokens.has(token);
        const nameIdentityMatched = expectedTokens.filter(tokenMatchesName);
        const expectedCompact = normalizeCompact(expectedHospital);
        const nameCompact = normalizeCompact(candidate?.businessName || '');
        const exactCompactMatch = Boolean(expectedCompact && nameCompact
            && (expectedCompact.includes(nameCompact) || nameCompact.includes(expectedCompact)));
        const hasIdentityAnchor = nameIdentityMatched.length > 0 || exactCompactMatch;
        const matched = expectedTokens.filter(token => tokenMatchesIdentity(token)
            || (hasIdentityAnchor && locationTokenSet.has(token)));
        const coverage = expectedTokens.length ? matched.length / expectedTokens.length : 0;
        const requiredLead = expectedTokens[0] || '';
        const leadMatched = !requiredLead || tokenMatchesName(requiredLead)
            || (exactCompactMatch && locationTokenSet.has(requiredLead));
        // A branch label is often the city in parentheses, while Google Maps keeps
        // that city in the address instead of the business name (for example,
        // "Metropolitan Veterinary Center (Chicago)"). Treat the candidate's own
        // city/address as branch identity, but keep the core hospital-name coverage
        // based only on the business name and official website.
        const branchIdentity = normalizeWords(
            `${candidateIdentity} ${candidate?.city || ''} ${candidate?.fullAddress || ''}`
        );
        const branchTokenSet = new Set(meaningfulTokens(branchIdentity));
        const branchesMatched = requiredBranches.every(token => branchTokenSet.has(token));
        const exactExpected = normalizeWords(expectedHospital);
        const exactName = normalizeWords(candidate?.businessName || '');
        const exactMatch = Boolean(exactExpected && exactName
            && (exactExpected.includes(exactName) || exactName.includes(exactExpected) || exactCompactMatch));
        const branchOnlyMatch = expectedTokens.length === 0 && requiredBranches.length > 0 && branchesMatched;
        const candidateBranches = branchTokens(candidate?.businessName || '');
        const requiredBranchSet = new Set(requiredBranches);
        const candidateBranchSet = new Set(candidateBranches);
        const conflictingBranch = requiredBranches.length > 0 && candidateBranches.length > 0
            && !requiredBranches.some(token => candidateBranchSet.has(token))
            && !candidateBranches.some(token => requiredBranchSet.has(token));
        const score = Math.max(coverage, exactMatch || branchOnlyMatch ? 1 : 0);
        return {
            expectedTokens,
            requiredBranches,
            candidateBranches,
            coverage: score,
            leadMatched,
            branchesMatched,
            conflictingBranch,
            exactNameMatch: exactMatch,
            candidateIdentity
        };
    }

    function hospitalIdentityMatches(expectedHospital, candidate, context = {}) {
        const details = identityDetails(expectedHospital, candidate);
        if (!candidate?.businessName) return false;
        if (details.conflictingBranch) return false;

        // Google often omits a branch label from the business title. The caller
        // validates the city and state separately, so the core hospital name may
        // match even when an expected label such as "(Kempsville)" is absent.
        // In that case, require either one unique Google place or an exact street
        // match from the job description. This prevents a different branch with
        // the same core brand from being accepted merely because it is nearby.
        const branchWasOmitted = details.requiredBranches.length > 0
            && !details.branchesMatched
            && details.candidateBranches.length === 0;
        const descriptionStreet = context.descriptionAddress?.streetAddress || '';
        const descriptionStreetMatches = Boolean(descriptionStreet)
            && streetAddressesMatch(candidate?.streetAddress || '', descriptionStreet);
        if (branchWasOmitted
            && candidate?.uniquePlaceMatch !== true
            && candidate?.branchQueryResolved !== true
            && !descriptionStreetMatches) {
            return false;
        }

        // A one-token identity must still be an exact name containment match so a
        // different hospital in the same city cannot pass on one shared word.
        const hasStrongCoreIdentity = details.leadMatched && details.coverage >= 0.6;
        if (details.expectedTokens.length <= 1) {
            return hasStrongCoreIdentity && details.exactNameMatch;
        }
        return hasStrongCoreIdentity;
    }

    function validateAddressCandidate(candidate, context = {}) {
        const result = { ...emptyAddressResult(), ...(candidate || {}) };
        const expectedHospital = context.originalHospitalName || context.hospitalName || '';
        const expectedLocation = parseLocation(context.location || '');
        result.fullAddress = cleanAddressText(result.fullAddress || '');
        result.streetAddress = normalizeStreetAddress(result.streetAddress || '', {
            city: result.city,
            state: result.state,
            zipCode: result.zipCode
        });
        const resultState = normalizeState(result.state || '');
        const resultCity = normalizeCity(result.city || '');
        const expectedCity = normalizeCity(expectedLocation.city);

        if (!looksLikeStreetAddress(result.streetAddress)) {
            return { accepted: false, reason: 'invalid-street-address', score: 0, result: emptyAddressResult() };
        }
        if (!/^\d{5}(?:-\d{4})?$/.test(String(result.zipCode || '').trim())) {
            return { accepted: false, reason: 'invalid-zip-code', score: 0, result: emptyAddressResult() };
        }
        if (context.requireDescriptionStreetMatch) {
            const descriptionStreet = context.descriptionAddress?.streetAddress || '';
            const descriptionZip = String(context.descriptionAddress?.zipCode || '').trim().slice(0, 5);
            const resultZip = String(result.zipCode || '').trim().slice(0, 5);
            if (!descriptionStreet || !streetAddressesMatch(result.streetAddress, descriptionStreet)) {
                return { accepted: false, reason: 'description-street-mismatch', score: 0, result: emptyAddressResult() };
            }
            if (descriptionZip && resultZip && descriptionZip !== resultZip) {
                return { accepted: false, reason: 'description-zip-mismatch', score: 0, result: emptyAddressResult() };
            }
        }
        if (expectedLocation.state && resultState !== expectedLocation.state) {
            return { accepted: false, reason: 'state-mismatch', score: 0, result: emptyAddressResult() };
        }
        if (expectedLocation.state && typeof context.zipMatchesState === 'function'
            && !context.zipMatchesState(result.zipCode, expectedLocation.state)) {
            return { accepted: false, reason: 'zip-state-mismatch', score: 0, result: emptyAddressResult() };
        }
        if (!hospitalIdentityMatches(expectedHospital, result, context)) {
            return { accepted: false, reason: 'hospital-identity-mismatch', score: 0, result: emptyAddressResult() };
        }
        if (!isVeterinaryFacility(result)) {
            return { accepted: false, reason: 'not-a-verified-veterinary-facility', score: 0, result: emptyAddressResult() };
        }
        const identity = identityDetails(expectedHospital, result);
        result.website = sanitizeWebsite(result.website);
        result.phone = normalizePhone(result.phone);
        const cityMatches = !expectedCity || resultCity === expectedCity;
        const safePostalCityMismatch = !cityMatches
            && result.uniquePlaceMatch === true
            && identity.leadMatched
            && !identity.conflictingBranch
            && identity.coverage >= 0.8
            && Boolean(result.website)
            && Boolean(result.phone)
            && isMoreSpecificPostalCity(expectedLocation.city, result.city);
        if (!cityMatches && !safePostalCityMismatch) {
            return { accepted: false, reason: 'city-and-hospital-mismatch', score: 0, result: emptyAddressResult() };
        }

        result.state = resultState || result.state || '';
        result.verified = true;
        result.identityScore = identity.coverage;
        result.allowPostalCityMismatch = safePostalCityMismatch;

        const completeness = (result.website ? 4 : 0) + (result.phone ? 4 : 0)
            + (result.fullAddress ? 1 : 0);
        const score = identity.coverage * 100 + (cityMatches ? 10 : 6) + completeness;
        return {
            accepted: true,
            reason: safePostalCityMismatch ? 'verified-postal-city-mismatch' : 'verified',
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
        const missing = value => /^(?:|\-|TBD|Not Available|00000)$/i.test(String(value || '').trim());
        return missing(job?.streetAddress) || missing(job?.zipCode) || missing(job?.phone)
            || missing(job?.website) || !sanitizeWebsite(job?.website || '');
    }

    return {
        branchTokens,
        cleanAddressText,
        emptyAddressResult,
        getAddressCacheKeys,
        hospitalIdentityMatches,
        meaningfulTokens,
        normalizeAddressCacheValue,
        normalizeCompact,
        normalizeHospitalName,
        normalizePhone,
        normalizeState,
        normalizeStreetAddress,
        parseStructuredAddress,
        parseLocation,
        sanitizeWebsite,
        selectAtomicAddress,
        shouldRefetchAddress,
        streetAddressesMatch,
        validateAddressCandidate
    };
});
