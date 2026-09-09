// Shared, side-effect-free validation helpers for address enrichment.
// Loaded by the results page and injected before both Google scrapers.
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.VppAddressValidation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const GENERIC_BUSINESS_WORDS = new Set([
        'a', 'an', 'and', 'at', 'care', 'center', 'centre', 'clinic', 'company',
        'for', 'hospital', 'medical', 'of', 'pet', 'pets', 'practice', 'services',
        'the', 'veterinary', 'veterinarian', 'vet'
    ]);

    const STATE_NAMES = {
        AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
        CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
        HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
        KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts',
        MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
        NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
        NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
        OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
        SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
        VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
        DC: 'District of Columbia'
    };

    function cleanText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function normalizeName(value) {
        return cleanText(value)
            .toLowerCase()
            .replace(/&/g, ' and ')
            .replace(/\bsaint\b/g, 'st')
            .replace(/[^a-z0-9]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function nameTokens(value, removeGeneric = true) {
        const tokens = normalizeName(value).split(' ').filter(Boolean);
        const informative = removeGeneric
            ? tokens.filter(token => token.length > 1 && !GENERIC_BUSINESS_WORDS.has(token))
            : tokens;
        return informative.length ? informative : tokens;
    }

    function nameSimilarity(expectedName, candidateName) {
        const expected = normalizeName(expectedName);
        const candidate = normalizeName(candidateName);
        if (!expected || !candidate) return 0;
        if (expected === candidate) return 1;

        const expectedTokens = [...new Set(nameTokens(expected))];
        const candidateTokens = [...new Set(nameTokens(candidate))];
        if (!expectedTokens.length || !candidateTokens.length) return 0;

        const candidateSet = new Set(candidateTokens);
        const overlap = expectedTokens.filter(token => candidateSet.has(token)).length;
        const recall = overlap / expectedTokens.length;
        const precision = overlap / candidateTokens.length;
        const containment = expected.length >= 5 && candidate.length >= 5 &&
            (expected.includes(candidate) || candidate.includes(expected)) ? 1 : 0;

        return Math.min(1, (recall * 0.65) + (precision * 0.25) + (containment * 0.10));
    }

    function bestNameMatch(expectedNames, candidateName) {
        let score = 0;
        let expectedName = '';
        for (const name of (expectedNames || []).filter(Boolean)) {
            const current = nameSimilarity(name, candidateName);
            if (current > score) {
                score = current;
                expectedName = name;
            }
        }
        return { score, expectedName };
    }

    function normalizeState(value) {
        const input = cleanText(value);
        if (!input) return '';
        const upper = input.toUpperCase();
        if (STATE_NAMES[upper]) return upper;
        const normalized = normalizeName(input);
        const match = Object.entries(STATE_NAMES).find(([, name]) => normalizeName(name) === normalized);
        return match ? match[0] : upper;
    }

    function normalizeCity(value) {
        return normalizeName(value)
            .replace(/\bsaint\b/g, 'st')
            .replace(/\bfort\b/g, 'ft')
            .replace(/\bmount\b/g, 'mt');
    }

    function hasAddressSignal(candidate) {
        return !!cleanText(candidate && (
            candidate.streetAddress || candidate.fullAddress || candidate.zipCode ||
            candidate.city || candidate.state
        ));
    }

    function validateCandidate(candidate, options = {}) {
        const result = candidate || {};
        const expectedNames = (options.expectedNames || []).filter(Boolean);
        const expectedCity = normalizeCity(options.city || '');
        const expectedState = normalizeState(options.state || '');
        const candidateCity = normalizeCity(result.city || '');
        const candidateState = normalizeState(result.state || '');
        const nameMatch = bestNameMatch(expectedNames, result.businessName || '');
        const minimumNameScore = 0.72;

        if (!result.businessName) {
            return { valid: false, confidence: 0, reason: 'The result did not expose a business name.' };
        }
        if (nameMatch.score < minimumNameScore) {
            return { valid: false, confidence: nameMatch.score, reason: 'The business name did not match the hospital.' };
        }
        if (expectedState && hasAddressSignal(result) && !candidateState) {
            return { valid: false, confidence: nameMatch.score, reason: 'The result did not expose a state for validation.' };
        }
        if (expectedState && candidateState && expectedState !== candidateState) {
            return { valid: false, confidence: nameMatch.score, reason: 'The result state did not match the saved state.' };
        }
        if (expectedCity && hasAddressSignal(result) && !candidateCity) {
            return { valid: false, confidence: nameMatch.score, reason: 'The result did not expose a city for validation.' };
        }
        if (expectedCity && candidateCity && expectedCity !== candidateCity) {
            return { valid: false, confidence: nameMatch.score, reason: 'The result city did not match the saved city.' };
        }

        let weight = 0.75;
        let confidence = nameMatch.score * weight;
        if (expectedState) {
            weight += 0.10;
            if (candidateState === expectedState) confidence += 0.10;
        }
        if (expectedCity) {
            weight += 0.15;
            if (candidateCity === expectedCity) confidence += 0.15;
        }
        confidence = Math.min(1, confidence / weight);
        return { valid: true, confidence, reason: '', matchedExpectedName: nameMatch.expectedName };
    }

    function sameBusiness(first, second) {
        if (!first || !second || !first.businessName || !second.businessName) return false;
        if (nameSimilarity(first.businessName, second.businessName) < 0.72) return false;
        const firstState = normalizeState(first.state || '');
        const secondState = normalizeState(second.state || '');
        if (firstState && secondState && firstState !== secondState) return false;
        const firstCity = normalizeCity(first.city || '');
        const secondCity = normalizeCity(second.city || '');
        return !(firstCity && secondCity && firstCity !== secondCity);
    }

    function normalizePhone(value) {
        const digits = String(value || '').replace(/\D/g, '');
        const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
        if (national.length !== 10) return '';
        return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
    }

    function getMissingFields(job) {
        const has = (field, value) => {
            const text = cleanText(value);
            if (!text || text === '-') return false;
            if (field === 'streetAddress' && /^(?:tbd|n\/?a|unknown|not found)$/i.test(text)) return false;
            if (field === 'zipCode' && text === '00000') return false;
            return true;
        };
        return ['streetAddress', 'city', 'state', 'zipCode', 'phone', 'website']
            .filter(field => !has(field, job && job[field]));
    }

    function stableJobKey(job) {
        const record = job || {};
        for (const value of [record.jobId, record.reqId, record.id, record.greenhouseJobId]) {
            const key = cleanText(value);
            if (key) return `id:${key}`;
        }
        const link = cleanText(record.link || record.sourceLink || record.applicationUrl);
        if (link) return `url:${link}`;
        const fingerprint = [record.title, record.hospital, record.location, record.city, record.state]
            .map(normalizeName)
            .filter(Boolean)
            .join('|');
        return fingerprint ? `record:${fingerprint}` : '';
    }

    return {
        STATE_NAMES,
        bestNameMatch,
        cleanText,
        getMissingFields,
        nameSimilarity,
        normalizeCity,
        normalizeName,
        normalizePhone,
        normalizeState,
        sameBusiness,
        stableJobKey,
        validateCandidate
    };
});
