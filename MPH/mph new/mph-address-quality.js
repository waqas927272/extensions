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
        'veterinary', 'veterinarian', 'veterinarians', 'vet', 'hospital', 'hospitals', 'clinic', 'clinics',
        'center', 'centre', 'medical', 'pet', 'pets', 'care', 'health', 'healthcare',
        'emergency', 'er', 'urgent', 'after', 'hours', 'specialty', 'specialist', 'specialists', 'service', 'services',
        'resort', 'boarding', 'grooming', 'luxury', 'dental', 'dentistry',
        'llc', 'pllc', 'inc', 'incorporated', 'ltd', 'pa', 'pc', 'sc', 'dvm'
    ]);

    const BLOCKED_WEBSITE_PARTS = [
        'google.', 'gstatic.', 'googleusercontent.', 'facebook.', 'instagram.', 'linkedin.',
        'youtube.', 'x.com', 'twitter.', 'yelp.', 'mapquest.', 'waze.', 'bing.', 'duckduckgo.',
        'indeed.', 'glassdoor.', 'ziprecruiter.', 'jobvite.', 'yellowpages.', 'greatpetcare.',
        'carecredit.', 'vetmodo.', 'vetreceipt.', 'vetstoria.', 'petdesk.'
    ];

    const BRANCH_STREET_SUFFIX_WORDS = new Set([
        'street', 'st', 'road', 'rd', 'avenue', 'ave', 'boulevard', 'blvd',
        'drive', 'dr', 'lane', 'ln', 'highway', 'hwy', 'parkway', 'pkwy'
    ]);

    function normalizeWords(value) {
        return String(value || '')
            .replace(/\burgentcare\b/gi, 'urgent care')
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
            .replace(/^washington dc$/, 'washington')
            .replace(/\bmount\b/g, 'mt')
            .replace(/\bsaint\b/g, 'st')
            .replace(/\bfort\b/g, 'ft')
            .replace(/borough\b/g, 'boro')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/\s+/g, '');
    }

    function citiesMatch(expected, actual, state = '') {
        const left = normalizeCity(expected), right = normalizeCity(actual);
        if (!left || !right) return false;
        if (left === right) return true;
        // Documented names for the SAME locality, not a nearby-city radius or
        // substring match. Keep Hills/Heights/Township significant everywhere else.
        const aliases = {
            MA: [['wellesley', 'wellesleyhills']],
            MI: [['redford', 'redfordchartertownship', 'redfordchartertwp', 'redfordtownship', 'redfordtwp']]
        };
        return (aliases[normalizeState(state)] || []).some(group => group.includes(left) && group.includes(right));
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
            .replace(/borough\b/g, 'boro')
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

    function editDistance(left, right) {
        const a = String(left || '');
        const b = String(right || '');
        if (a === b) return 0;
        if (!a) return b.length;
        if (!b) return a.length;

        const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
        const current = Array(b.length + 1).fill(0);
        for (let row = 1; row <= a.length; row++) {
            current[0] = row;
            for (let column = 1; column <= b.length; column++) {
                const cost = a[row - 1] === b[column - 1] ? 0 : 1;
                current[column] = Math.min(
                    previous[column] + 1,
                    current[column - 1] + 1,
                    previous[column - 1] + cost
                );
            }
            previous.splice(0, previous.length, ...current);
        }
        return previous[b.length];
    }

    function isMinorCityTypo(expectedCity, resultCity) {
        const expected = normalizeCity(expectedCity);
        const result = normalizeCity(resultCity);
        if (!expected || !result || Math.min(expected.length, result.length) < 5) return false;
        if (expected[0] !== result[0]) return false;
        return editDistance(expected, result) <= 1;
    }

    function isPostalCityVariant(expectedCity, resultCity) {
        return isMoreSpecificPostalCity(expectedCity, resultCity)
            || isMoreSpecificPostalCity(resultCity, expectedCity);
    }

    function explicitBranchLocationSegments(hospitalName) {
        const source = String(hospitalName || '');
        const segments = [];
        for (const match of source.matchAll(/\(([^)]+)\)/g)) segments.push(match[1]);
        const dash = source.match(/\s[-–—]\s(.+)$/);
        if (dash) segments.push(dash[1]);
        const namedBranch = source.match(/\b(?:hospital|clinic|center|centre|care)\s+(?:of|at)\s+(.+)$/i);
        if (namedBranch) segments.push(namedBranch[1]);
        return [...new Set(segments.map(value => value.replace(/\s+/g, ' ').trim()).filter(Boolean))];
    }

    function hasDescriptionCityConflict(context, resultCity, state) {
        const description = context?.descriptionAddress || {};
        const descriptionCity = String(description.city || '').trim();
        const descriptionState = normalizeState(description.state || '');
        const resultState = normalizeState(state || '');
        const hasCompleteDescriptionAddress = looksLikeStreetAddress(description.streetAddress || '')
            && /^\d{5}(?:-\d{4})?$/.test(String(description.zipCode || '').trim());
        return hasCompleteDescriptionAddress && descriptionCity
            && (!descriptionState || !resultState || descriptionState === resultState)
            && !citiesMatch(descriptionCity, resultCity, descriptionState || resultState);
    }

    function safeGooglePostalCityMatch(expectedHospital, candidate, context = {}, identity = null) {
        const expectedLocation = parseLocation(context.location || '');
        const expectedCity = expectedLocation.city || '';
        const resultCity = candidate?.city || '';
        if (!expectedCity || !resultCity) return false;
        if (citiesMatch(expectedCity, resultCity, expectedLocation.state)) return true;

        // A city difference can be accepted only from one complete Google place
        // record for the requested hospital in the requested state. This is not a
        // radius/nearby-city rule: unrelated hospitals never reach this function.
        const isUniqueGooglePlace = candidate?.uniquePlaceMatch === true
            && ['google-maps', 'google-search'].includes(candidate?.sourceType);
        if (!isUniqueGooglePlace) return false;

        const details = identity || identityDetails(expectedHospital, candidate);
        const strongHospitalIdentity = details.exactNameMatch === true
            || (details.leadMatched === true && details.coverage >= 0.8);
        if (!strongHospitalIdentity) return false;

        // Accept spelling corrections and postal forms such as Cummings/Cumming,
        // Portland/South Portland, and Coloma Charter Township/Coloma.
        if (isMinorCityTypo(expectedCity, resultCity)
            || isPostalCityVariant(expectedCity, resultCity)) return true;

        // A broader job market can name a unique branch whose postal city appears
        // in the branch name (for example Oklahoma City -> "... of Edmond"). A
        // complete description address asserting a different city blocks this path.
        if (hasDescriptionCityConflict(context, resultCity, candidate.state)) return false;
        return explicitBranchLocationSegments(expectedHospital)
            .some(segment => citiesMatch(segment, resultCity, expectedLocation.state));
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
        if (conflictingAddressUnits(left, right)) return false;
        const normalizeForStreetMatch = value => normalizeWords(stripAddressUnits(normalizeStreetAddress(value)))
            .replace(/\bnorth\s*west\b/g, 'nw')
            .replace(/\bnorth\s*east\b/g, 'ne')
            .replace(/\bsouth\s*west\b/g, 'sw')
            .replace(/\bsouth\s*east\b/g, 'se')
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
            .replace(/\btrail\b/g, 'trl')
            .replace(/\bcircle\b/g, 'cir')
            .replace(/\bterrace\b/g, 'ter')
            .replace(/\bu s\b/g, 'us')
            .replace(/\b(us|sr|cr|fm|rm)\s+(?:hwy\s+)?(\d+[a-z]?)\s*(?:hwy\b)?/g, '$1 $2 ')
            .replace(/\b(?:suites?|ste|units?|building|bldg|floor)\b.*$/g, '')
            .replace(/\s+#\s*[a-z0-9-]+.*$/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        const a = normalizeForStreetMatch(left);
        const b = normalizeForStreetMatch(right);
        if (!a || !b) return false;
        return a === b;
    }

    function conflictingAddressUnits(left, right) {
        const a = addressUnits(left), b = addressUnits(right);
        return Object.keys(a).some(key => a[key] && b[key] && a[key] !== b[key]);
    }

    function addressUnits(value) {
        const text = String(value || '').toLowerCase();
        const part = pattern => normalizeCompact(text.match(pattern)?.[1] || '');
        return {
            unit: part(/\b(?:suites?|ste\.?|units?)\s*#?\s*([a-z0-9-]+(?:\s*(?:&|and)\s*[a-z0-9-]+)?)/i)
                || part(/(?<!\b(?:building|bldg)\s)#\s*([a-z0-9-]+)/i)
                || normalizeCompact(implicitStreetUnit(text)?.[1] || ''),
            building: part(/\b(?:building|bldg\.?)\s*#?\s*([a-z0-9-]+)/i),
            floor: part(/\bfloor\s*#?\s*([a-z0-9-]+)/i)
        };
    }

    function stripAddressUnits(value) {
        const text = String(value || '').replace(/(?:\b(?:suites?|ste\.?|units?|building|bldg\.?|floor)\b|\s+#)\s*.*$/i, '').trim();
        const implicit = implicitStreetUnit(text);
        return implicit ? text.slice(0, text.lastIndexOf(implicit[1])).replace(/[,\s]+$/, '') : text;
    }

    function implicitStreetUnit(value) {
        // Google can omit "Suite" before a trailing alphanumeric unit. Require
        // both a letter and digit after a street suffix; never strip N/S or a road.
        return String(value || '').match(/\b(?:st(?:reet)?|rd|road|ave(?:nue)?|blvd|boulevard|dr(?:ive)?|ln|lane|ct|court|pkwy|parkway|trl|trail)\.?[,\s]+((?=[a-z0-9-]*[a-z])(?=[a-z0-9-]*\d)[a-z0-9-]+)\.?$/i);
    }

    function isStreetEnrichment(stored, published) {
        if (conflictingAddressUnits(stored, published)) return false;
        const oldUnits = addressUnits(stored), newUnits = addressUnits(published);
        const losesUnit = Object.keys(oldUnits).some(key => oldUnits[key] && !newUnits[key]);
        if (losesUnit) return false;
        if (streetAddressesMatch(stored, published)) {
            return Object.keys(newUnits).some(key => newUnits[key] && !oldUnits[key]);
        }
        // Permit a missing directional to be restored, never N -> S, a changed
        // house number, or an unrelated road. Highway aliases share a route key.
        const parts = value => {
            let text = normalizeWords(stripAddressUnits(normalizeStreetAddress(value)))
                .replace(/\bnorth\b/g, 'n').replace(/\bsouth\b/g, 's')
                .replace(/\beast\b/g, 'e').replace(/\bwest\b/g, 'w')
                .replace(/\b(?:street)\b/g, 'st').replace(/\broad\b/g, 'rd')
                .replace(/\bavenue\b/g, 'ave').replace(/\bdrive\b/g, 'dr')
                .replace(/\b(?:highway|hwy|us|sr|sc)\s*(\d+)\b/g, 'route $1')
                .replace(/\b(?:suites?|ste|units?|building|bldg|floor)\b.*$/, '').trim();
            const direction = (text.match(/\b(?:n|s|e|w|ne|nw|se|sw)\b/g) || []).join(' ');
            const core = text.replace(/\b(?:n|s|e|w|ne|nw|se|sw)\b/g, '').replace(/\s+/g, ' ').trim();
            return { core, direction };
        };
        const a = parts(stored), b = parts(published);
        return !!a.core && a.core === b.core && !a.direction && !!b.direction;
    }

    function isPublishedStreetCorrection(stored, published) {
        const oldUnits = addressUnits(stored), newUnits = addressUnits(published);
        if (Object.keys(oldUnits).some(key => oldUnits[key] && !newUnits[key])) return false;
        if (isStreetEnrichment(stored, published)) return true;
        // Only used after a unique official hospital branch has been validated.
        // A publisher can restore a missing directional while spelling a road's
        // suffix differently (Grand River Ave / W Grand River Rd).
        const withoutSuffix = value => stripAddressUnits(value).replace(/\b(?:road|rd|avenue|ave)\.?$/i, '').trim();
        return !conflictingAddressUnits(stored, published)
            && isStreetEnrichment(withoutSuffix(stored), withoutSuffix(published));
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
        return normalizeCityTokens(value)
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
        const atBranch = source.match(/\b(?:hospital|clinic|center|centre|care)\s+at\s+(.+)$/i);
        if (atBranch) segments.push(atBranch[1]);
        const directionalBranch = source.match(/\b(North|South|East|West)$/i);
        if (directionalBranch) segments.push(directionalBranch[1]);
        // Unmarked trailing words can describe services, not a geographic
        // branch. Only the explicit branch forms above are required labels.
        const livewellBranch = source.match(/\blive\s*well\s+animal\s+(?:hospital|urgent\s+care)\s+(?:of\s+)?(.+)$/i);
        if (livewellBranch) segments.push(livewellBranch[1]);
        return [...new Set(
            segments.flatMap(meaningfulTokens)
                .filter(token => !BRANCH_STREET_SUFFIX_WORDS.has(token))
        )];
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
            if (!host || BLOCKED_WEBSITE_PARTS.some(part => part.endsWith('.')
                ? host.split('.').includes(part.slice(0, -1))
                : host === part || host.endsWith(`.${part}`))) return '';
            // Government resource directories are not a hospital's website.
            if (/(?:^|\.)(?:gov|mil)$/.test(host)) return '';
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
        return /\b(?:veterinary|veterinarian|veterinarians|vets?|animal hospital|animal clinic|animal medical|animal urgent care|hospital for animals|clinic for animals|pet hospital|pet clinic|pet care|vet hospital|vet clinic|emergency vet|veterinary specialty)\b/.test(evidence)
            || /\b[a-z0-9]*(?:vet|vets)\b/.test(evidence);
    }

    function identityDetails(expectedHospital, candidate) {
        const requiredBranches = branchTokens(expectedHospital);
        // A location card can explicitly identify an unpunctuated branch name
        // ("District Vet Navy Yard"). Remove only that exact trailing label from
        // the core brand; unrelated service words remain part of the identity.
        const cardBranch = normalizeWords(candidate?.branchEvidence || '');
        const expectedName = normalizeWords(expectedHospital);
        if (candidate?.sourceType === 'official-website' && cardBranch
            && expectedName.endsWith(` ${cardBranch}`)
            && meaningfulTokens(expectedName.slice(0, -cardBranch.length)).length) {
            requiredBranches.push(...meaningfulTokens(cardBranch).filter(token => !requiredBranches.includes(token)));
        }
        const expectedTokens = meaningfulTokens(expectedHospital)
            .filter(token => !requiredBranches.includes(token))
            .filter(token => requiredBranches.length === 0 || !BRANCH_STREET_SUFFIX_WORDS.has(token));
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
        const tokenMatchesIdentity = token => candidateTokenSet.has(token)
            || (token.length >= 3 && [...candidateTokenSet].some(candidateToken => candidateToken.includes(token)))
            || acronymTokens.has(token);
        const tokenMatchesName = token => candidateNameTokenSet.has(token)
            || acronymTokens.has(token);
        const nameIdentityMatched = expectedTokens.filter(tokenMatchesName);
        const expectedCompact = normalizeCompact(expectedHospital);
        const nameCompact = normalizeCompact(candidate?.businessName || '');
        const exactCompactMatch = Boolean(expectedCompact && nameCompact && expectedCompact === nameCompact);
        // City/address words describe where a result is located; they are not
        // evidence that the Google business is the requested hospital. Counting
        // them here allowed unrelated hospitals in the same city to match.
        const matched = expectedTokens.filter(tokenMatchesIdentity);
        const coverage = expectedTokens.length ? matched.length / expectedTokens.length : 0;
        const requiredLead = expectedTokens[0] || '';
        const leadMatched = !requiredLead || tokenMatchesName(requiredLead);
        // A branch label is often the city in parentheses, while Google Maps keeps
        // that city in the address instead of the business name (for example,
        // "Metropolitan Veterinary Center (Chicago)"). Treat the candidate's own
        // city/address as branch identity, but keep the core hospital-name coverage
        // based only on the business name and official website.
        const branchIdentity = normalizeWords(
            `${candidateIdentity} ${candidate?.city || ''} ${candidate?.fullAddress || ''} ${candidate?.branchEvidence || ''}`
        );
        const branchTokenSet = new Set(meaningfulTokens(branchIdentity));
        const branchesMatched = requiredBranches.every(token => branchTokenSet.has(token));
        const exactExpected = normalizeWords(expectedHospital);
        const exactName = normalizeWords(candidate?.businessName || '');
        const exactMatch = Boolean(exactExpected && exactName
            && (exactExpected === exactName || exactCompactMatch));
        const branchOnlyMatch = expectedTokens.length === 0 && requiredBranches.length > 0 && branchesMatched;
        let candidateBranches = branchTokens(candidate?.businessName || '');
        if (requiredBranches.length > 0 && candidateBranches.length === 0) {
            // Google commonly writes a branch as trailing plain words instead of
            // parentheses or "of" (for example, "Companion River North" and
            // "Pet Care Center Esplanade"). Treat only the meaningful name words
            // left after the core hospital identity as candidate branch words.
            const expectedBaseWords = normalizeWords(expectedHospital)
                .split(' ')
                .filter(token => token.length > 1)
                .filter(token => !['the', 'and', 'of', 'at', 'in', 'for', 'with', 'an'].includes(token))
                .filter(token => !requiredBranches.includes(token));
            const expectedBaseAcronym = expectedBaseWords.map(token => token[0]).join('');
            candidateBranches = meaningfulTokens(candidate?.businessName || '')
                .filter(token => !expectedTokens.includes(token))
                .filter(token => !BRANCH_STREET_SUFFIX_WORDS.has(token))
                .filter(token => token !== expectedBaseAcronym);
        }
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

        const exactExpectedName = normalizeCompact(normalizeHospitalName(expectedHospital));
        const exactCandidateName = normalizeCompact(normalizeHospitalName(candidate.businessName));
        const descriptionStreet = context.descriptionAddress?.streetAddress || '';
        const descriptionStreetMatches = Boolean(descriptionStreet)
            && streetAddressesMatch(candidate?.streetAddress || '', descriptionStreet);
        const uniquePlaceEvidence = candidate?.uniquePlaceMatch === true
            || candidate?.branchQueryResolved === true
            || descriptionStreetMatches;

        // A co-branded job may name two complete practices. Match a complete
        // constituent name, never an arbitrary word from a combined brand.
        const coBrands = String(expectedHospital || '').split(/\s+(?:&|and)\s+/i);
        const facilityName = /\b(?:hospital|clinic|veterinary specialists?)\b/i;
        if (uniquePlaceEvidence && coBrands.length === 2 && coBrands.every(name => facilityName.test(name))
            && coBrands.some(name => normalizeCompact(name) === exactCandidateName)) {
            return true;
        }

        // Some legitimate hospital names contain no distinctive tokens after the
        // generic veterinary words are removed ("Care Animal Hospital"), or only
        // a short identity ("Rau Animal Hospital", "OC Veterinary Medical Center").
        // An exact full business-name match is still safe when Google resolved a
        // single place. City and state are validated separately below.
        if (exactExpectedName && exactExpectedName === exactCandidateName && uniquePlaceEvidence) {
            return true;
        }

        const expectedLocation = parseLocation(context.location || '');
        const expectedLocationTokens = new Set(meaningfulTokens(
            `${expectedLocation.city || ''} ${expectedLocation.state || ''} ${STATE_ABBREVIATIONS[expectedLocation.state] || ''}`
        ));
        const candidateBranchIsOnlyJobCity = details.candidateBranches.length > 0
            && details.candidateBranches.every(token => expectedLocationTokens.has(token));
        const candidateBranchExplicitlyNamed = details.requiredBranches.length === 0
            && details.candidateBranches.length > 0
            && details.candidateBranches.every(token => details.expectedTokens.includes(token));
        const candidateBranchIsDirectional = details.candidateBranches.length > 0
            && details.candidateBranches.every(token => ['north', 'south', 'east', 'west'].includes(token));

        // A Google result that adds an explicit "at <branch>" / "of <branch>"
        // location is not interchangeable with an unqualified hospital record.
        // This keeps two branches of the same brand in the same city separate.
        // A dash followed only by the exact job city is a display label, not a
        // separate branch (for example, "PetHealth UrgentCare - Wyomissing").
        if (details.requiredBranches.length === 0
            && details.candidateBranches.length > 0
            && !candidateBranchIsOnlyJobCity
            && !candidateBranchExplicitlyNamed
            && !(candidateBranchIsDirectional && uniquePlaceEvidence)) {
            return false;
        }

        const candidateLocationTokens = new Set(meaningfulTokens(candidate.city || ''));
        const expectedCoreTokens = details.expectedTokens
            .filter(token => !expectedLocationTokens.has(token))
            .filter(token => !candidateBranchExplicitlyNamed || !details.candidateBranches.includes(token));
        const candidateCoreTokens = new Set(
            meaningfulTokens(`${candidate.businessName || ''} ${websiteParts(candidate.website || '')}`)
                .filter(token => !candidateLocationTokens.has(token))
                .filter(token => !details.candidateBranches.includes(token))
        );
        const candidateNameInitials = normalizeWords(candidate.businessName || '')
            .split(' ')
            .filter(Boolean)
            .map(token => token[0])
            .join('');
        const candidateCoreHas = token => candidateCoreTokens.has(token)
            || (token.length >= 4 && [...candidateCoreTokens].some(candidateToken => candidateToken.includes(token)))
            || (token.length >= 2 && token.length <= 5 && candidateNameInitials.includes(token));
        const matchedCoreTokens = expectedCoreTokens.filter(candidateCoreHas);

        const baseNameWithout = (value, excludedTokens) => normalizeWords(
            String(value || '')
                .replace(/\([^)]*\)/g, ' ')
                .replace(/\s[-–—]\s.*$/, ' ')
        )
            .split(' ')
            .filter(token => token.length > 1)
            .filter(token => token !== 'er')
            .filter(token => !['the', 'and', 'of', 'at', 'in', 'for', 'with', 'an'].includes(token))
            .filter(token => !excludedTokens.has(token))
            .join(' ');
        const expectedBaseExclusions = new Set([
            ...expectedLocationTokens,
            ...details.requiredBranches,
            ...(candidateBranchExplicitlyNamed ? details.candidateBranches : [])
        ]);
        const candidateBaseExclusions = new Set([
            ...candidateLocationTokens,
            ...details.candidateBranches
        ]);
        const expectedBaseName = baseNameWithout(expectedHospital, expectedBaseExclusions);
        const candidateBaseName = baseNameWithout(candidate.businessName, candidateBaseExclusions);
        const officialWebsiteTokens = websiteParts(candidate.website || '').split(' ').filter(Boolean);
        const locationNamedOfficialDomain = uniquePlaceEvidence
            && [...expectedLocationTokens].some(token => token.length >= 4
                && officialWebsiteTokens.some(websiteToken => websiteToken.includes(token)));
        const baseAcronym = value => value.split(' ').filter(Boolean).map(token => token[0]).join('');
        const baseNamesEquivalent = expectedBaseName === candidateBaseName
            || baseAcronym(expectedBaseName) === candidateBaseName
            || baseAcronym(candidateBaseName) === expectedBaseName;

        // If every distinctive word in the expected name is only the city/branch,
        // require the remaining facility name to be the same. This stops a result
        // such as "Main Street Veterinary Hospital (Flower Mound)" from matching
        // "Flower Mound Veterinary Emergency & Specialty Center" merely because
        // both names contain the job city.
        if (expectedCoreTokens.length === 0 && !baseNamesEquivalent && !locationNamedOfficialDomain) {
            return false;
        }
        if (expectedCoreTokens.length > 0) {
            const coreCoverage = matchedCoreTokens.length / expectedCoreTokens.length;
            const coreLeadMatched = candidateCoreHas(expectedCoreTokens[0]);
            const officialShortName = candidate.sourceType === 'official-website'
                && uniquePlaceEvidence && details.leadMatched && matchedCoreTokens.length >= 1
                && meaningfulTokens(candidate.businessName || '').every(token => expectedCoreTokens.includes(token));
            if (!coreLeadMatched || (coreCoverage < 0.6 && !officialShortName)) return false;
        }

        // Google often omits a branch label from the business title. The caller
        // validates the city and state separately, so the core hospital name may
        // match even when an expected label such as "(Kempsville)" is absent.
        // In that case, require either one unique Google place or an exact street
        // match from the job description. This prevents a different branch with
        // the same core brand from being accepted merely because it is nearby.
        const branchWasOmitted = details.requiredBranches.length > 0
            && !details.branchesMatched
            && details.candidateBranches.length === 0;
        const omittableDisplayLabel = /\([^)]*\)|\s[-–—]\s|\b(?:North|South|East|West)$/i.test(String(expectedHospital || ''));
        const omittedLabelResolved = descriptionStreetMatches
            || (omittableDisplayLabel
                && (candidate?.uniquePlaceMatch === true || candidate?.branchQueryResolved === true));
        if (branchWasOmitted && !omittedLabelResolved) {
            return false;
        }

        // A one-token identity must still be an exact name containment match so a
        // different hospital in the same city cannot pass on one shared word.
        const hasStrongCoreIdentity = details.leadMatched && details.coverage >= 0.6;
        if (details.expectedTokens.length === 0) {
            return details.requiredBranches.length > 0
                && details.branchesMatched
                && (candidate?.uniquePlaceMatch === true
                    || candidate?.branchQueryResolved === true
                    || descriptionStreetMatches);
        }
        if (details.expectedTokens.length === 1) {
            const coreToken = details.expectedTokens[0];
            const hasExactCoreWord = details.candidateIdentity.split(' ')
                .some(candidateToken => candidateToken === coreToken
                    || (coreToken.length >= 4 && candidateToken.includes(coreToken)));
            const branchRequirementPassed = details.requiredBranches.length === 0
                || details.branchesMatched
                || details.candidateBranches.length === 0;
            // Allow Hospital/Clinic/Center wording to differ when a distinctive
            // core word matches exactly and Google resolved one place. Short or
            // generic one-word identities remain rejected.
            return coreToken.length >= 4
                && hasExactCoreWord
                && branchRequirementPassed
                && uniquePlaceEvidence;
        }
        return expectedCoreTokens.length >= 2 || hasStrongCoreIdentity;
    }

    function validateAddressCandidate(candidate, context = {}) {
        const result = { ...emptyAddressResult(), ...(candidate || {}) };
        if (result.ambiguousPlaceMatch === true) {
            return { accepted: false, reason: 'ambiguous-hospital-branches', score: 0, result: emptyAddressResult() };
        }
        if (result.sourceType === 'google-search' && result.uniquePlaceMatch !== true) {
            // An organic snippet is discovery evidence, not a Google business
            // record. Inspect its website before accepting its address/contacts.
            return { accepted: false, reason: 'unverified-search-snippet', score: 0, result: emptyAddressResult() };
        }
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
        if (String(result.zipCode || '').trim() === '00000'
            || !/^\d{5}(?:-\d{4})?$/.test(String(result.zipCode || '').trim())) {
            return { accepted: false, reason: 'invalid-zip-code', score: 0, result: emptyAddressResult() };
        }
        if (context.requireDescriptionStreetMatch) {
            const descriptionStreet = context.descriptionAddress?.streetAddress || '';
            const descriptionZip = String(context.descriptionAddress?.zipCode || '').trim().slice(0, 5);
            const resultZip = String(result.zipCode || '').trim().slice(0, 5);
            if (!descriptionStreet || (!streetAddressesMatch(result.streetAddress, descriptionStreet)
                && !isStreetEnrichment(descriptionStreet, result.streetAddress))) {
                return { accepted: false, reason: 'description-street-mismatch', score: 0, result: emptyAddressResult() };
            }
            const googlePostalCorrection = result.uniquePlaceMatch === true
                && ['google-maps', 'google-search'].includes(result.sourceType);
            if (descriptionZip && resultZip && descriptionZip !== resultZip && !googlePostalCorrection) {
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
        const cityMatches = citiesMatch(expectedLocation.city, result.city, expectedLocation.state);
        const safePostalCityMatch = !cityMatches
            && safeGooglePostalCityMatch(expectedHospital, result, context, identity);
        if (!expectedCity || !expectedLocation.state) {
            return { accepted: false, reason: 'missing-job-location', score: 0, result: emptyAddressResult() };
        }
        // City/state are the user's hard boundary. Similar names, nearby postal
        // cities and an official directory must not bypass it.
        if (!cityMatches && !safePostalCityMatch) {
            return { accepted: false, reason: 'city-and-hospital-mismatch', score: 0, result: emptyAddressResult() };
        }

        result.state = resultState || result.state || '';
        result.verified = true;
        result.identityScore = identity.coverage;
        result.allowPostalCityMismatch = safePostalCityMatch;

        const completeness = (result.website ? 4 : 0) + (result.phone ? 4 : 0)
            + (result.fullAddress ? 1 : 0);
        const score = identity.coverage * 100 + (cityMatches ? 10 : 6) + completeness;
        return {
            accepted: true,
            reason: safePostalCityMatch ? 'verified-postal-city-variant' : 'verified',
            score,
            result
        };
    }

    function selectAtomicAddress(current, candidate, context = {}) {
        const currentValidation = validateAddressCandidate(current, context);
        const candidateValidation = validateAddressCandidate(candidate, context);
        if (!currentValidation.accepted) return candidateValidation.accepted ? candidateValidation.result : emptyAddressResult();
        if (!candidateValidation.accepted) return currentValidation.result;
        const isGoogle = value => value.uniquePlaceMatch === true
            && ['google-maps', 'google-search'].includes(value.sourceType);
        const google = isGoogle(candidateValidation.result) ? candidateValidation.result
            : isGoogle(currentValidation.result) ? currentValidation.result : null;
        const official = google === candidateValidation.result ? currentValidation.result : candidateValidation.result;
        if (google && ['official-website', 'livewell-geojson'].includes(official.sourceType)) {
            // Google wins for street/ZIP. Fill missing contacts only after the
            // official page independently confirms this exact physical branch.
            if (official.uniquePlaceMatch === true && streetAddressesMatch(google.streetAddress, official.streetAddress)) {
                return { ...google, phone: google.phone || official.phone,
                    website: google.website || official.website,
                    contactSourceUrl: (!google.phone && official.phone) || (!google.website && official.website)
                        ? official.website : google.contactSourceUrl || '' };
            }
            return google;
        }
        if (['livewell-geojson', 'official-website'].includes(currentValidation.result.sourceType)
            && ['google-maps', 'google-search'].includes(candidateValidation.result.sourceType)
            && candidateValidation.result.uniquePlaceMatch === true
            && streetAddressesMatch(currentValidation.result.streetAddress, candidateValidation.result.streetAddress)) {
            return candidateValidation.result;
        }
        if (['google-maps', 'google-search'].includes(currentValidation.result.sourceType)
            && currentValidation.result.uniquePlaceMatch === true
            && ['livewell-geojson', 'official-website'].includes(candidateValidation.result.sourceType)
            && currentValidation.result.zipCode.slice(0, 5) !== candidateValidation.result.zipCode.slice(0, 5)
            && streetAddressesMatch(currentValidation.result.streetAddress, candidateValidation.result.streetAddress)) {
            return currentValidation.result;
        }
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
        citiesMatch,
        addressUnits,
        conflictingAddressUnits,
        emptyAddressResult,
        getAddressCacheKeys,
        hospitalIdentityMatches,
        isMinorCityTypo,
        isStreetEnrichment,
        isPublishedStreetCorrection,
        isPostalCityVariant,
        safeGooglePostalCityMatch,
        meaningfulTokens,
        normalizeCity,
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
