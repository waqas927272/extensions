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
            .replace(/\([^)]*\)/g, ' ')
            .replace(/\s*[-–—]\s*[^,]+,\s*[a-z]{2}\s*$/i, ' ')
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
            'hospital', 'clinic', 'center', 'centre', 'care', 'urgent'
        ]);
        const normalized = normalizeBusinessName(value);
        const tokens = normalized.split(' ').filter(token => token.length > 2 && !stopWords.has(token));
        return tokens.length ? tokens : normalized.split(' ').filter(token => token.length > 2);
    }

    function businessNameFuzzyMatches(expectedName, scrapedName) {
        const expected = normalizeBusinessName(expectedName);
        const scraped = normalizeBusinessName(scrapedName);
        if (!expected || !scraped) return false;
        if (expected === scraped || expected.includes(scraped) || scraped.includes(expected)) return true;

        const expectedTokens = getBusinessNameTokens(expectedName);
        const scrapedTokens = new Set(getBusinessNameTokens(scrapedName));
        if (!expectedTokens.length || !scrapedTokens.size) return false;
        const matched = expectedTokens.filter(token => scraped.includes(token) || scrapedTokens.has(token)).length;
        return matched / expectedTokens.length >= 0.5;
    }

    function businessNamesExactlyEqual(expectedName, scrapedName) {
        return !!expectedName && !!scrapedName && normalizeBusinessName(expectedName) === normalizeBusinessName(scrapedName);
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
        if (!street || street.length > 90) return false;
        if (/^(?:tbd|not available(?:\s*\(tbd\))?|n\/?a|na|unknown|pending)$/i.test(street)) return false;
        return !/Company Description|Job Description|Qualifications|We offer|experienced veterinarian|Willingness to travel|drive practice growth/i.test(street);
    }

    function isValidZipCode(value) {
        const zipCode = String(value || '').trim();
        return /^\d{5}(?:-\d{4})?$/.test(zipCode) && zipCode !== NOT_AVAILABLE_ZIP;
    }

    function isCompleteAddressResult(result) {
        return !!result && isValidStreetAddress(result.streetAddress) && isValidZipCode(result.zipCode);
    }

    function hasGoogleResultData(result) {
        return !!result && !!(
            result.businessName || result.streetAddress || result.fullAddress ||
            result.city || result.state || result.zipCode || result.website || result.phone
        );
    }

    function normalizeStreetForCompare(value) {
        const replacements = {
            street: 'st', st: 'st', road: 'rd', rd: 'rd', avenue: 'ave', ave: 'ave',
            boulevard: 'blvd', blvd: 'blvd', drive: 'dr', dr: 'dr', lane: 'ln', ln: 'ln',
            court: 'ct', ct: 'ct', circle: 'cir', cir: 'cir', highway: 'hwy', hwy: 'hwy',
            route: 'rt', rt: 'rt', parkway: 'pkwy', pkwy: 'pkwy', trail: 'trl', trl: 'trl',
            north: 'n', south: 's', east: 'e', west: 'w'
        };
        let tokens = String(value || '')
            .toLowerCase()
            .replace(/\b(?:united states|usa)\b/g, ' ')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .map(token => replacements[token] || token);

        const unitIndex = tokens.findIndex(token => /^(?:suite|ste|unit|apt|building|bldg|floor|fl)$/.test(token));
        if (unitIndex >= 0) tokens = tokens.slice(0, unitIndex);

        const leadingBuildingNumber = /^\d+[a-z]?$/.test(tokens[0] || '') ? tokens[0] : '';
        let coreTokens = leadingBuildingNumber ? tokens.slice(1) : [...tokens];
        return { tokens, coreTokens, leadingBuildingNumber };
    }

    function compareStreetAddresses(existingStreet, googleStreet) {
        if (!isUsableStreetAddress(existingStreet)) return { status: 'missing', reason: 'existing-street-missing' };
        if (!isUsableStreetAddress(googleStreet)) return { status: 'unknown', reason: 'google-street-missing' };

        const existing = normalizeStreetForCompare(existingStreet);
        const google = normalizeStreetForCompare(googleStreet);
        if (existing.leadingBuildingNumber && google.leadingBuildingNumber && existing.leadingBuildingNumber !== google.leadingBuildingNumber) {
            return { status: 'mismatch', reason: 'building-number-mismatch' };
        }

        // Support harmless reversed formats such as "Main Street 341" versus "341 Main St".
        if (!existing.leadingBuildingNumber && google.leadingBuildingNumber) {
            existing.coreTokens = existing.coreTokens.filter(token => token !== google.leadingBuildingNumber);
        }
        if (!google.leadingBuildingNumber && existing.leadingBuildingNumber) {
            google.coreTokens = google.coreTokens.filter(token => token !== existing.leadingBuildingNumber);
        }

        const existingSet = new Set(existing.coreTokens);
        const googleSet = new Set(google.coreTokens);
        if (!existingSet.size || !googleSet.size) return { status: 'unknown', reason: 'street-not-comparable' };
        const shared = [...existingSet].filter(token => googleSet.has(token)).length;
        const overlap = shared / Math.min(existingSet.size, googleSet.size);
        return overlap >= 0.67
            ? { status: 'match', reason: 'street-match', existing, google }
            : { status: 'mismatch', reason: 'street-name-mismatch', existing, google };
    }

    function shouldEnrichStreetAddress(existingStreet, googleStreet) {
        if (!isUsableStreetAddress(existingStreet)) return isUsableStreetAddress(googleStreet);
        const comparison = compareStreetAddresses(existingStreet, googleStreet);
        if (comparison.status !== 'match') return false;
        const existing = normalizeStreetForCompare(existingStreet);
        const google = normalizeStreetForCompare(googleStreet);
        return !existing.leadingBuildingNumber && !!google.leadingBuildingNumber;
    }

    function validateGoogleResult(result, context = {}) {
        if (!hasGoogleResultData(result)) {
            return { accepted: false, reason: 'no-google-result', result: null };
        }

        const filterLocation = parseFilterLocation(context.location);
        const expectedState = filterLocation.stateAbbrev;
        const resultState = getStateAbbrev(result.state);
        if (!filterLocation.city || !expectedState || !result.city || !resultState) {
            return { accepted: false, reason: 'missing-location-signal', result: null };
        }
        if (expectedState && resultState !== expectedState) {
            return { accepted: false, reason: 'state-mismatch', result: null };
        }

        const expectedNames = [context.hospitalName, context.originalHospitalName].filter(Boolean);
        if (!result.businessName || !expectedNames.length) {
            return { accepted: false, reason: 'missing-business-name', result: null };
        }

        const expectsPriorityPet = expectedNames.some(isPriorityPetName);
        const nameMatches = expectsPriorityPet
            ? isPriorityPetName(result.businessName)
            : expectedNames.some(name => businessNameFuzzyMatches(name, result.businessName));
        if (!nameMatches) {
            return { accepted: false, reason: 'business-name-mismatch', result: null };
        }

        const resultCity = normalizeCompact(result.city);
        const expectedCity = normalizeCompact(filterLocation.city);
        if (resultCity !== expectedCity) {
            return { accepted: false, reason: 'city-mismatch', result: null };
        }

        return {
            accepted: true,
            reason: 'exact-city-state',
            result: {
                ...result,
                streetAddress: String(result.streetAddress).replace(/\s+/g, ' ').trim(),
                zipCode: String(result.zipCode).trim()
            }
        };
    }

    function chooseCompleteAddressResult(primary, secondary) {
        const primaryUsable = hasGoogleResultData(primary);
        const secondaryUsable = hasGoogleResultData(secondary);
        if (!primaryUsable && !secondaryUsable) return null;
        const first = primaryUsable ? primary : secondary;
        const second = primaryUsable && secondaryUsable ? secondary : {};
        return {
            ...first,
            businessName: first.businessName || second.businessName || '',
            streetAddress: first.streetAddress || second.streetAddress || '',
            zipCode: first.zipCode || second.zipCode || '',
            city: first.city || second.city || '',
            state: first.state || second.state || '',
            fullAddress: first.fullAddress || second.fullAddress || '',
            website: first.website || second.website || '',
            phone: first.phone || second.phone || ''
        };
    }

    function preserveFilterCityState(job) {
        const filterLocation = parseFilterLocation(job.location);
        if (filterLocation.city && !/^TBD$/i.test(filterLocation.city)) {
            job.city = filterLocation.city;
        }
        if (filterLocation.stateAbbrev) {
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
            return job;
        }

        const google = validation.result;
        const streetComparison = compareStreetAddresses(job.streetAddress, google.streetAddress);
        const zipMismatch = isValidZipCode(job.zipCode) && isValidZipCode(google.zipCode) && String(job.zipCode).trim() !== String(google.zipCode).trim();
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
            return job;
        }

        job.addressMismatchFlag = false;
        job.addressMismatchDetails = null;
        if (shouldEnrichStreetAddress(job.streetAddress, google.streetAddress)) {
            job.streetAddress = google.streetAddress;
        }
        if (!isValidZipCode(job.zipCode) && isValidZipCode(google.zipCode)) {
            job.zipCode = google.zipCode;
        }
        if (!isUsableStreetAddress(job.streetAddress)) {
            job.streetAddress = NOT_AVAILABLE_STREET;
            job.zipCode = NOT_AVAILABLE_ZIP;
        }
        if (!job.website && google.website) job.website = google.website;
        if (!job.phone && google.phone) job.phone = google.phone;
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
        normalizeBusinessName,
        isPriorityPetName,
        businessNameFuzzyMatches,
        businessNamesExactlyEqual,
        getHospitalNameCityCandidates,
        isValidStreetAddress,
        isUsableStreetAddress,
        isValidZipCode,
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
