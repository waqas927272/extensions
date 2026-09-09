(function initializeAddressValidation(root, factory) {
    const api = factory();
    root.AAHAddressValidation = api;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
    const NOT_AVAILABLE_STREET = 'TBD';
    const NOT_AVAILABLE_ZIP = '00000';

    const stateAbbreviations = {
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

    function normalizeCompact(value) {
        return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    function normalizeCity(value) {
        // Spelling variants only; never substitute a neighbouring municipality.
        return normalizeCompact(String(value || '').toLowerCase()
            .replace(/\b(?:saint|st)\.?\s+/g, 'saint ')
            .replace(/\b(?:fort|ft)\.?\s+/g, 'fort '));
    }

    function isMissingValue(value) {
        return /^(?:|[-–—]|tbd-?|not available(?:\s*\(tbd\))?|n\/?a|na|unknown|pending)$/i.test(String(value ?? '').trim());
    }

    function getFullStateName(state) {
        const cleaned = String(state || '').trim();
        if (!cleaned) return '';
        const upper = cleaned.toUpperCase();
        if (stateAbbreviations[upper]) return stateAbbreviations[upper];
        const match = Object.values(stateAbbreviations)
            .find(fullName => normalizeCompact(fullName) === normalizeCompact(cleaned));
        return match || cleaned;
    }

    function getStateAbbrev(state) {
        const cleaned = String(state || '').trim();
        if (!cleaned) return '';
        const upper = cleaned.toUpperCase();
        if (stateAbbreviations[upper]) return upper;
        const match = Object.entries(stateAbbreviations)
            .find(([, fullName]) => normalizeCompact(fullName) === normalizeCompact(cleaned));
        return match ? match[0] : '';
    }

    function parseFilterLocation(location) {
        const parts = String(location || '').split(',').map(part => part.trim()).filter(Boolean);
        return {
            city: parts[0] || '',
            state: parts.length >= 2 ? parts[1] : '',
            stateAbbrev: parts.length >= 2 ? getStateAbbrev(parts[1]) : ''
        };
    }

    function normalizeBusinessName(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/&/g, ' and ')
            .replace(/[()]/g, ' ')
            .replace(/\s*[-–—]\s*[^,]+,\s*[a-z]{2}\s*$/i, ' ')
            .replace(/,\s*[a-z]{2}\s*$/i, ' ')
            .replace(new RegExp(`\\s+(?:${Object.keys(stateAbbreviations).join('|')})\\s*$`, 'i'), ' ')
            .replace(/[^a-z0-9]+/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/\b(?:[a-z]\s+){2,}[a-z]\b/g, letters => letters.replace(/\s+/g, ''))
            .trim();
    }

    function isPriorityPetName(value) {
        return normalizeBusinessName(value).replace(/\s+/g, '').includes('prioritypeturgentcare');
    }

    function getBusinessNameTokens(value) {
        const stopWords = new Set([
            'the', 'and', 'for', 'with', 'of', 'at', 'veterinary', 'animal', 'pet',
            'hospital', 'clinic', 'center', 'centre', 'care', 'urgent', 'llc', 'inc'
        ]);
        const normalized = normalizeBusinessName(value)
            .replace(/\bpriority\s+pet\b/g, 'prioritypet')
            .replace(/\b(?:vet|vets)\b/g, 'veterinary')
            .replace(/\bst\b/g, 'saint')
            .replace(/\bft\b/g, 'fort')
            .replace(/\bspecialists\b/g, 'specialist');
        const words = [...new Set(normalized.split(' ').filter(Boolean))];
        const tokens = words.filter(token => !stopWords.has(token));
        return tokens.length ? tokens : words;
    }

    function businessNameMatchScore(expectedName, scrapedName) {
        const expected = normalizeBusinessName(expectedName);
        const scraped = normalizeBusinessName(scrapedName);
        if (!expected || !scraped) return 0;
        if (expected === scraped) return 1;
        const expectedTokens = getBusinessNameTokens(expectedName);
        const scrapedTokens = new Set(getBusinessNameTokens(scrapedName));
        if (!expectedTokens.length || !scrapedTokens.size) return 0;
        // Whole keywords only: "North" must not match "Northwest". Extra branch
        // keywords also count, preventing a short brand name from accepting any branch.
        const matched = expectedTokens.filter(token => scrapedTokens.has(token)).length;
        return matched / Math.max(expectedTokens.length, scrapedTokens.size);
    }

    function businessNameFuzzyMatches(expectedName, scrapedName) {
        return businessNameMatchScore(expectedName, scrapedName) >= 0.9;
    }

    function businessNamesExactlyEqual(expectedName, scrapedName) {
        return !!expectedName && !!scrapedName && normalizeBusinessName(expectedName) === normalizeBusinessName(scrapedName);
    }

    // These describe services/legal form, not a different branch. This looser
    // comparison is ONLY sufficient when a numbered street also confirms identity.
    function businessNameVariantMatches(first, second) {
        const descriptors = new Set(['resort', 'surgery', 'surgical', 'medicine',
            'specialty', '24', 'hour', 'hours', 'ltd', 'pc', 'park']);
        const core = name => getBusinessNameTokens(name).filter(word => !descriptors.has(word));
        const left = core(first);
        const right = core(second);
        return left.length > 0 && right.length > 0 &&
            left.filter(word => right.includes(word)).length / Math.max(left.length, right.length) >= 0.9;
    }

    function hasStrongStreetMatch(first, second, state) {
        const match = compareStreetAddresses(first, second, state);
        return match.status === 'match' && match.existing.buildingNumbers.length > 0 &&
            match.google.buildingNumbers.length > 0 &&
            [...match.existing.buildingNumbers].sort().join(',') === [...match.google.buildingNumbers].sort().join(',');
    }

    function canonicalWebsite(value) {
        try {
            const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
            if (!/^https?:$/.test(url.protocol) || !url.hostname.includes('.') || url.username || url.password) return '';
            for (const key of [...url.searchParams.keys()]) {
                if (/^(?:utm_|gclid$|fbclid$)/i.test(key)) url.searchParams.delete(key);
            }
            url.searchParams.sort();
            return url.hostname.toLowerCase().replace(/^www\./, '') + url.pathname.replace(/\/$/, '') + url.search;
        } catch { return ''; }
    }

    function sameContactEntity(first, second) {
        if (!first || !second || !first.city || !second.city ||
            normalizeCity(first.city) !== normalizeCity(second.city) ||
            !getStateAbbrev(first.state) || getStateAbbrev(first.state) !== getStateAbbrev(second.state) ||
            compareStreetAddresses(first.streetAddress, second.streetAddress, first.state).status === 'mismatch' ||
            (isValidZipCode(first.zipCode) && isValidZipCode(second.zipCode) && !zipCodesMatch(first.zipCode, second.zipCode))) return false;
        if (first.placeId && second.placeId) return first.placeId === second.placeId;
        const website = canonicalWebsite(first.website);
        return businessNamesExactlyEqual(first.businessName, second.businessName) &&
            !!website && website === canonicalWebsite(second.website) && zipCodesMatch(first.zipCode, second.zipCode);
    }

    function extractContactLocality(text) {
        // Only a location printed in this business panel counts; never fill it
        // from the search query, which would make unrelated contacts look valid.
        const states = [...Object.keys(stateAbbreviations), ...Object.values(stateAbbreviations)].join('|');
        const pattern = new RegExp(`^(?:Address|Location)?\\s*:?\\s*([A-Za-z][A-Za-z .'-]*),\\s*(${states})\\s+(\\d{5}(?:-\\d{4})?)(?:,?\\s*(?:United States|USA))?$`, 'i');
        for (const line of String(text || '').split(/\n/)) {
            const match = line.trim().match(pattern);
            if (match) return { streetAddress: '', city: match[1].trim(), state: match[2], zipCode: match[3] };
        }
        return { streetAddress: '', city: '', state: '', zipCode: '' };
    }

    async function waitForContactDetails(read, accept, options = {}) {
        const deadline = Date.now() + (Number(options.maxWaitMs) || 15000);
        const pollMs = Math.max(50, Number(options.pollMs) || 500);
        let latest = null;
        let signature = '';
        let readySince = 0;
        // Missing phone is not readiness: wait the full bounded window. Return
        // a partial result at the deadline so the sequential lookup can continue.
        while (true) {
            const value = read();
            latest = value && accept(value) ? value : null;
            const next = latest ? JSON.stringify([latest.businessName, latest.streetAddress,
                latest.city, latest.state, latest.zipCode, latest.phone, latest.website]) : '';
            if (next !== signature) { signature = next; readySince = Date.now(); }
            if (latest && !isMissingValue(latest.phone) && !isMissingValue(latest.website) &&
                Date.now() - readySince >= 1000) return latest;
            if (Date.now() >= deadline) return latest;
            await new Promise(resolve => setTimeout(resolve, Math.min(pollMs, deadline - Date.now())));
        }
    }

    function getHospitalNameCityCandidates(value) {
        const source = String(value || '').replace(/\s+/g, ' ').trim();
        const candidates = [];
        const ofMatch = source.match(/\bof\s+(.+?)\s*$/i);
        if (ofMatch) candidates.push(ofMatch[1]);
        const dashMatch = source.match(/\s[-–—]\s*([^,]+?)(?:,\s*[A-Z]{2})?\s*$/i);
        if (dashMatch) candidates.push(dashMatch[1]);
        return candidates
            .map(candidate => candidate
                .replace(/,\s*[A-Z]{2}\s*$/i, '')
                .replace(/\b(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC|PR)\b$/i, '')
                .replace(/\bNational\b$/i, '')
                .trim())
            .filter(Boolean);
    }

    function isValidStreetAddress(value) {
        const street = String(value || '').replace(/\s+/g, ' ').trim();
        if (!street || street.length > 90) return false;
        if (/^(?:tbd|not available(?:\s*\(tbd\))?|n\/?a|na|unknown|pending)$/i.test(street)) return false;
        if (/Company Description|Job Description|Qualifications|We offer|experienced veterinarian|Willingness to travel|drive practice growth/i.test(street)) return false;
        return /\d/.test(street) || /\bP\.?\s*O\.?\s*Box\b/i.test(street);
    }

    function isUsableStreetAddress(value) {
        const street = String(value || '').replace(/\s+/g, ' ').trim();
        if (isMissingValue(street) || street.length > 110) return false;
        return !/Company Description|Job Description|Qualifications|We offer|experienced veterinarian|Willingness to travel|drive practice growth/i.test(street);
    }

    function isValidZipCode(value) {
        const zipCode = String(value || '').trim();
        return /^\d{5}(?:-\d{4})?$/.test(zipCode) && zipCode.slice(0, 5) !== NOT_AVAILABLE_ZIP;
    }

    function zipCodesMatch(first, second) {
        if (!isValidZipCode(first) || !isValidZipCode(second)) return false;
        const a = String(first).trim();
        const b = String(second).trim();
        return a === b || (a.slice(0, 5) === b.slice(0, 5) && (a.length === 5 || b.length === 5));
    }

    function isCompleteAddressResult(result) {
        return !!result && isUsableStreetAddress(result.streetAddress) && isValidZipCode(result.zipCode);
    }

    function hasGoogleResultData(result) {
        return !!result && !!(
            result.businessName || result.streetAddress || result.fullAddress ||
            result.city || result.state || result.zipCode || result.website || result.phone
        );
    }

    function normalizeStreetForCompare(value, state = '') {
        const replacements = {
            street: 'st', st: 'st', road: 'rd', rd: 'rd', avenue: 'ave', ave: 'ave',
            boulevard: 'blvd', blvd: 'blvd', drive: 'dr', dr: 'dr', lane: 'ln', ln: 'ln',
            court: 'ct', ct: 'ct', circle: 'cir', cir: 'cir', highway: 'hwy', hwy: 'hwy',
            route: 'rt', rte: 'rt', rt: 'rt', parkway: 'pkwy', pkwy: 'pkwy', trail: 'trl', trl: 'trl',
            place: 'pl', terrace: 'ter', crescent: 'cres',
            north: 'n', south: 's', east: 'e', west: 'w',
            northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw'
        };
        let source = String(value || '')
            .toLowerCase()
            .replace(/\b(?:united states|usa)\s*$/g, ' ')
            .replace(/\bu\.?\s*s\.?\s*(?=[-\s\d])/g, 'us ')
            .replace(/\b(?:county\s+(?:road|rd)|co\.?\s+(?:road|rd)|cr)\.?\s*-?\s*(\d+)\b/g, 'countyroute $1')
            .replace(/\bus\s*(?:(?:highway|hwy|route|rte|rt)\.?\s*)?-?\s*(\d+)\b/g, 'usroute $1')
            .replace(/\b(?:interstate|i)\s*-?\s*(\d+)\b/g, 'interstateroute $1');
        // Keep subpremises as evidence instead of silently dropping suites.
        const units = {};
        const unitText = {};
        source = source.replace(/\b(suite|ste|unit|apt|apartment|building|bldg|floor|fl)\.?(?:\s*#\s*|\s+|(?=\d))([a-z0-9]+(?:-[a-z0-9]+)?)\b|#\s*([a-z0-9]+(?:-[a-z0-9]+)?)/g,
            (raw, label, number, hashNumber, offset) => {
                // FL 2 after a street is Floor 2; by itself it is Florida route 2.
                if (label === 'fl' && !/[a-z]/.test(source.slice(0, offset))) return raw;
                const key = /^(?:building|bldg)$/.test(label) ? 'building' : /^(?:floor|fl)$/.test(label) ? 'floor' : 'unit';
                units[key] = number || hashNumber;
                unitText[key] = raw;
                return ' ';
            });

        // Match West Virginia before Virginia (and any future suffix overlaps).
        for (const [abbrev, fullName] of Object.entries(stateAbbreviations).sort((a, b) => b[1].length - a[1].length)) {
            const pattern = new RegExp(`\\b(?:${fullName}|${abbrev})\\s*(?:(?:highway|hwy|route|rte|rt)\\.?\\s*)?[- ]\\s*(\\d+)\\b`, 'gi');
            source = source.replace(pattern, `${abbrev.toLowerCase()}route $1`);
        }
        source = source.replace(/\b(?:state\s+(?:highway|hwy|route|rte|rt)|sr)\.?\s*-?\s*(\d+)\b/g,
            `${getStateAbbrev(state).toLowerCase() || 'state'}route $1`);

        const numberGroup = source.trim().match(/^(\d+[a-z]?(?:\s*(?:&|and)\s*\d+[a-z]?)*)(?=\s)/);
        let buildingNumbers = numberGroup ? numberGroup[1].match(/\d+[a-z]?/g) : [];
        if (numberGroup) source = source.trim().slice(numberGroup[0].length);
        let coreTokens = source
            .replace(/[^a-z0-9]+/g, ' ')
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .map(token => replacements[token] || token);
        const suffixes = new Set(['st', 'rd', 'ave', 'blvd', 'dr', 'ln', 'ct', 'cir', 'pkwy', 'trl', 'pl', 'ter', 'cres', 'way', 'loop', 'pike']);
        if (!buildingNumbers.length && suffixes.has(coreTokens[coreTokens.length - 2]) && /^\d+[a-z]?$/.test(coreTokens[coreTokens.length - 1])) {
            buildingNumbers = [coreTokens.pop()];
        }
        const directions = coreTokens.filter(token => /^(?:n|s|e|w|ne|nw|se|sw)$/.test(token));
        const suffixIndex = coreTokens.findLastIndex(token => suffixes.has(token));
        const streetType = suffixIndex >= 0 ? coreTokens[suffixIndex] : '';
        const nameTokens = coreTokens.filter((token, index) => index !== suffixIndex && !/^(?:n|s|e|w|ne|nw|se|sw)$/.test(token));
        return {
            tokens: [...buildingNumbers, ...coreTokens], coreTokens,
            leadingBuildingNumber: buildingNumbers[0] || '', buildingNumbers,
            nameTokens, streetType, directions, units, unitText
        };
    }

    function compareStreetAddresses(existingStreet, googleStreet, state = '') {
        if (!isUsableStreetAddress(existingStreet)) return { status: 'missing', reason: 'existing-street-missing' };
        if (!isUsableStreetAddress(googleStreet)) return { status: 'unknown', reason: 'google-street-missing' };

        const existing = normalizeStreetForCompare(existingStreet, state);
        const google = normalizeStreetForCompare(googleStreet, state);
        const compatibleSets = (a, b) => a.every(value => b.includes(value)) || b.every(value => a.includes(value));
        if (existing.buildingNumbers.length && google.buildingNumbers.length && !compatibleSets(existing.buildingNumbers, google.buildingNumbers)) {
            return { status: 'mismatch', reason: 'building-number-mismatch', existing, google };
        }
        if (!existing.nameTokens.length || !google.nameTokens.length) {
            return { status: 'unknown', reason: 'street-not-comparable', existing, google };
        }
        if (existing.nameTokens.join(' ') !== google.nameTokens.join(' ') ||
            (existing.streetType && google.streetType && existing.streetType !== google.streetType) ||
            (existing.directions.length && google.directions.length && !compatibleSets(existing.directions, google.directions))) {
            return { status: 'mismatch', reason: 'street-name-mismatch', existing, google };
        }
        for (const key of Object.keys(existing.units)) {
            if (google.units[key] && existing.units[key] !== google.units[key]) {
                return { status: 'mismatch', reason: `${key}-mismatch`, existing, google };
            }
        }
        return { status: 'match', reason: 'street-match', existing, google };
    }

    function shouldEnrichStreetAddress(existingStreet, googleStreet, state = '') {
        if (!isUsableStreetAddress(existingStreet)) return isUsableStreetAddress(googleStreet);
        const comparison = compareStreetAddresses(existingStreet, googleStreet, state);
        if (comparison.status !== 'match') return false;
        return (!comparison.existing.leadingBuildingNumber && !!comparison.google.leadingBuildingNumber) ||
            Object.keys(comparison.google.units).some(key => !comparison.existing.units[key]);
    }

    function enrichStreetAddress(existingStreet, googleStreet, state = '') {
        if (!isUsableStreetAddress(existingStreet)) return googleStreet;
        const { existing, google, status } = compareStreetAddresses(existingStreet, googleStreet, state);
        if (status !== 'match') return existingStreet;
        const useGoogle = !existing.leadingBuildingNumber && !!google.leadingBuildingNumber;
        let street = useGoogle ? googleStreet : existingStreet;
        const base = useGoogle ? google : existing;
        const extra = useGoogle ? existing : google;
        for (const key of Object.keys(extra.units)) {
            if (!base.units[key]) street += `, ${extra.unitText[key]}`;
        }
        return street;
    }

    function validateGoogleResult(result, context = {}) {
        if (!hasGoogleResultData(result)) {
            return { accepted: false, reason: 'no-google-result', result: null };
        }

        const filterLocation = parseFilterLocation(context.location);
        const expectedState = filterLocation.stateAbbrev;
        const resultState = getStateAbbrev(result.state);
        if (isMissingValue(filterLocation.city) || !expectedState || isMissingValue(result.city) || !resultState) {
            return { accepted: false, reason: 'missing-location-signal', result: null };
        }
        if (expectedState && resultState !== expectedState) {
            return { accepted: false, reason: 'state-mismatch', result: null };
        }

        const expectedNames = [context.hospitalName, context.originalHospitalName].filter(Boolean);
        if (!result.businessName || !expectedNames.length) {
            return { accepted: false, reason: 'missing-business-name', result: null };
        }

        const nameMatchScore = Math.max(...expectedNames.map(name => businessNameMatchScore(name, result.businessName)));
        const streetConfirmedVariant = hasStrongStreetMatch(context.streetAddress, result.streetAddress, result.state) &&
            expectedNames.some(name => businessNameVariantMatches(name, result.businessName));
        const confirmedContact = context.confirmedResult && sameContactEntity(context.confirmedResult, result);
        const nameMatches = nameMatchScore >= 0.9 || streetConfirmedVariant || confirmedContact;
        if (!nameMatches) {
            return { accepted: false, reason: 'business-name-mismatch', result: null };
        }

        const resultCity = normalizeCity(result.city);
        const expectedCity = normalizeCity(filterLocation.city);
        if (resultCity !== expectedCity) {
            return { accepted: false, reason: 'city-mismatch', result: null };
        }

        return {
            accepted: true,
            reason: streetConfirmedVariant && nameMatchScore < 0.9 ? 'street-confirmed-name-variant' : 'exact-city-state',
            nameMatchScore,
            result: {
                ...result,
                streetAddress: String(result.streetAddress || '').replace(/\s+/g, ' ').trim(),
                zipCode: String(result.zipCode || '').trim()
            }
        };
    }

    function chooseCompleteAddressResult(primary, secondary) {
        const primaryUsable = hasGoogleResultData(primary);
        const secondaryUsable = hasGoogleResultData(secondary);
        if (!primaryUsable && !secondaryUsable) return null;
        const first = primaryUsable ? primary : secondary;
        let second = primaryUsable && secondaryUsable ? secondary : {};
        // Never assemble a hybrid address/contact record from conflicting branches.
        if (hasGoogleResultData(second) && (
            compareStreetAddresses(first.streetAddress, second.streetAddress, first.state).status === 'mismatch' ||
            (isValidZipCode(first.zipCode) && isValidZipCode(second.zipCode) && !zipCodesMatch(first.zipCode, second.zipCode)) ||
            (first.city && second.city && normalizeCity(first.city) !== normalizeCity(second.city)) ||
            (first.state && second.state && getStateAbbrev(first.state) !== getStateAbbrev(second.state)) ||
            (first.businessName && second.businessName && !businessNameFuzzyMatches(first.businessName, second.businessName) &&
                !(hasStrongStreetMatch(first.streetAddress, second.streetAddress, first.state) &&
                    businessNameVariantMatches(first.businessName, second.businessName)) && !sameContactEntity(first, second))
        )) second = {};
        const streetAddress = shouldEnrichStreetAddress(first.streetAddress, second.streetAddress, first.state || second.state)
            ? enrichStreetAddress(first.streetAddress, second.streetAddress, first.state || second.state)
            : first.streetAddress || second.streetAddress || '';
        const zipCode = isValidZipCode(first.zipCode) ? first.zipCode
            : isValidZipCode(second.zipCode) ? second.zipCode : first.zipCode || second.zipCode || '';
        return {
            ...first,
            businessName: first.businessName || second.businessName || '',
            streetAddress,
            zipCode,
            city: first.city || second.city || '',
            state: first.state || second.state || '',
            fullAddress: streetAddress !== first.streetAddress || zipCode !== first.zipCode
                ? [streetAddress, first.city || second.city, [first.state || second.state, zipCode].filter(Boolean).join(' ')].filter(Boolean).join(', ')
                : first.fullAddress || second.fullAddress || '',
            website: isMissingValue(first.website) ? second.website || '' : first.website,
            phone: isMissingValue(first.phone) ? second.phone || '' : first.phone,
            contactSourceUrls: {
                website: isMissingValue(first.website) ? second.contactSourceUrls?.website || second.sourceUrl || ''
                    : first.contactSourceUrls?.website || first.sourceUrl || '',
                phone: isMissingValue(first.phone) ? second.contactSourceUrls?.phone || second.sourceUrl || ''
                    : first.contactSourceUrls?.phone || first.sourceUrl || ''
            }
        };
    }

    function preserveFilterCityState(job) {
        const filterLocation = parseFilterLocation(job.location);
        if (!job.city && !isMissingValue(filterLocation.city)) {
            job.city = filterLocation.city;
        }
        if (!job.state && filterLocation.stateAbbrev) {
            job.state = getFullStateName(filterLocation.stateAbbrev);
        }
        return job;
    }

    function applyAddressOutcome(job, validation) {
        preserveFilterCityState(job);
        if (!validation?.accepted || !validation.result) {
            if (!isUsableStreetAddress(job.streetAddress)) {
                job.streetAddress = NOT_AVAILABLE_STREET;
                job.addressMismatchFlag = false;
                job.addressMismatchDetails = null;
            }
            // Whether the street is missing or came from the job description,
            // an unconfirmed address must never retain a blank/invalid ZIP.
            if (!isValidZipCode(job.zipCode)) {
                job.zipCode = NOT_AVAILABLE_ZIP;
            }
            job.hospitalNameUpdated = false;
            job.addressVerificationStatus = validation?.reason === 'ambiguous-results' ? 'ambiguous' :
                validation?.reason === 'missing-confirmed-location' ? 'skipped' : 'not-found';
            return job;
        }

        const google = validation.result;
        // Only the two-stage lookup authorizes replacing a conflicting saved
        // street. Other callers retain the conservative mismatch behavior.
        if (validation.lookupStage === 'saved-address' || validation.lookupStage === 'hospital-name') {
            const oldStreet = job.streetAddress;
            const oldZip = job.zipCode;
            const hasStreet = isUsableStreetAddress(google.streetAddress);
            const comparison = compareStreetAddresses(oldStreet, google.streetAddress, job.state);
            const sameStreet = comparison.status === 'match';
            const replacedExistingStreet = hasStreet && isUsableStreetAddress(oldStreet) &&
                comparison.status === 'mismatch';
            if (hasStreet) {
                job.streetAddress = sameStreet
                    ? enrichStreetAddress(oldStreet, google.streetAddress, job.state)
                    : google.streetAddress;
                // A ZIP from the old street must not follow a replacement street.
                job.zipCode = isValidZipCode(google.zipCode) ? google.zipCode :
                    sameStreet && isValidZipCode(oldZip) ? oldZip : NOT_AVAILABLE_ZIP;
                // A verified correction is saved, but remains visibly red so a
                // person can compare it with the description-derived address.
                job.addressMismatchFlag = replacedExistingStreet;
                job.addressMismatchDetails = replacedExistingStreet ? {
                    reason: 'verified-street-correction',
                    existingStreetAddress: oldStreet || '',
                    existingZipCode: oldZip || '',
                    googleStreetAddress: google.streetAddress || '',
                    googleZipCode: google.zipCode || ''
                } : null;
                job.cityMismatchFlag = false;
            }
            for (const field of ['website', 'phone']) {
                if (!isMissingValue(google[field])) {
                    job[field] = google[field];
                    job.contactSources = { ...job.contactSources, [field]: {
                        businessName: google.businessName, streetAddress: google.streetAddress,
                        city: google.city, state: google.state,
                        sourceUrl: google.contactSourceUrls?.[field] || google.sourceUrl || ''
                    } };
                }
            }
            if (!isUsableStreetAddress(job.streetAddress)) job.streetAddress = NOT_AVAILABLE_STREET;
            if (!isValidZipCode(job.zipCode)) job.zipCode = NOT_AVAILABLE_ZIP;
            job.addressVerificationStatus = !hasStreet ? 'partial' :
                sameStreet ? 'matched' : isUsableStreetAddress(oldStreet) ? 'corrected' : 'found';
            job.addressVerification = {
                stage: validation.lookupStage, businessName: google.businessName,
                nameMatchScore: validation.nameMatchScore, sourceUrl: google.sourceUrl || '',
                previousStreetAddress: oldStreet || '', previousZipCode: oldZip || '',
                checkedAt: new Date().toISOString()
            };
            job.hospitalNameUpdated = false;
            return job;
        }
        // Validation has already confirmed the hospital and strict city/state.
        // Contacts belong to that result, even when the saved street needs review.
        job.cityMismatchFlag = false;
        for (const field of ['website', 'phone']) {
            if (isMissingValue(job[field]) && !isMissingValue(google[field])) {
                job[field] = google[field];
                job.contactSources = { ...job.contactSources, [field]: {
                    businessName: google.businessName || '',
                    streetAddress: google.streetAddress || '',
                    city: google.city || '', state: google.state || ''
                } };
            }
        }
        const streetComparison = compareStreetAddresses(job.streetAddress, google.streetAddress, google.state || job.state);
        const zipMismatch = isValidZipCode(job.zipCode) && isValidZipCode(google.zipCode) && !zipCodesMatch(job.zipCode, google.zipCode);
        if (streetComparison.status === 'mismatch' || zipMismatch) {
            job.addressMismatchFlag = true;
            job.addressMismatchDetails = {
                reason: streetComparison.status === 'mismatch' ? streetComparison.reason : 'zip-code-mismatch',
                existingStreetAddress: job.streetAddress || '',
                existingZipCode: job.zipCode || '',
                googleStreetAddress: google.streetAddress || '',
                googleZipCode: google.zipCode || ''
            };
            // Keep the description-derived street on a mismatch, but make its
            // unavailable ZIP explicit instead of exporting a blank value.
            if (!isValidZipCode(job.zipCode)) {
                job.zipCode = NOT_AVAILABLE_ZIP;
            }
            job.hospitalNameUpdated = false;
            job.addressVerificationStatus = 'mismatch';
            return job;
        }

        // Missing Google street data is not evidence that an old conflict is fixed.
        if (streetComparison.status === 'match' ||
            (streetComparison.status === 'missing' && isUsableStreetAddress(google.streetAddress))) {
            job.addressMismatchFlag = false;
            job.addressMismatchDetails = null;
            job.addressVerificationStatus = 'matched';
        } else {
            job.addressVerificationStatus = 'partial';
        }
        if (shouldEnrichStreetAddress(job.streetAddress, google.streetAddress, google.state || job.state)) {
            job.streetAddress = enrichStreetAddress(job.streetAddress, google.streetAddress, google.state || job.state);
        }
        if (!isValidZipCode(job.zipCode) && isValidZipCode(google.zipCode)) {
            job.zipCode = google.zipCode;
        }
        if (!isUsableStreetAddress(job.streetAddress)) {
            job.streetAddress = NOT_AVAILABLE_STREET;
        }
        if (!isValidZipCode(job.zipCode)) job.zipCode = NOT_AVAILABLE_ZIP;
        job.hospitalNameUpdated = false;
        return job;
    }

    return {
        NOT_AVAILABLE_STREET,
        NOT_AVAILABLE_ZIP,
        stateAbbreviations,
        getFullStateName,
        getStateAbbrev,
        parseFilterLocation,
        normalizeCity,
        isMissingValue,
        normalizeBusinessName,
        isPriorityPetName,
        businessNameFuzzyMatches,
        businessNameMatchScore,
        businessNamesExactlyEqual,
        businessNameVariantMatches,
        hasStrongStreetMatch,
        sameContactEntity,
        extractContactLocality,
        waitForContactDetails,
        getHospitalNameCityCandidates,
        isValidStreetAddress,
        isUsableStreetAddress,
        isValidZipCode,
        zipCodesMatch,
        isCompleteAddressResult,
        hasGoogleResultData,
        normalizeStreetForCompare,
        compareStreetAddresses,
        shouldEnrichStreetAddress,
        validateGoogleResult,
        chooseCompleteAddressResult,
        preserveFilterCityState,
        applyAddressOutcome
    };
});
