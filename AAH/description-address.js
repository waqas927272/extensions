(function initializeDescriptionAddress(root, factory) {
    const api = factory();
    root.AAHDescriptionAddress = api;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
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

    const emptyAddress = () => ({
        streetAddress: '', city: '', state: '', stateAbbrev: '', zipCode: '', location: ''
    });

    function normalizeCompact(value) {
        return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    function getStateAbbrev(value) {
        const cleaned = String(value || '').replace(/\./g, '').trim();
        if (!cleaned) return '';
        const upper = cleaned.toUpperCase();
        if (stateAbbreviations[upper]) return upper;
        const match = Object.entries(stateAbbreviations)
            .find(([, fullName]) => normalizeCompact(fullName) === normalizeCompact(cleaned));
        return match ? match[0] : '';
    }

    function getFullStateName(value) {
        const abbrev = getStateAbbrev(value);
        return abbrev ? stateAbbreviations[abbrev] : '';
    }

    function cleanLine(value) {
        return String(value || '')
            .replace(/^\s*[-•·]\s*/, '')
            .replace(/\u00a0/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/\s+,/g, ',')
            .trim();
    }

    function stripAddressLabel(value) {
        return cleanLine(value).replace(
            /^(?:(?:practice|hospital|clinic|office|street|mailing|physical|job)\s+)?address\s*:\s*/i,
            ''
        ).trim();
    }

    function isStreetAddress(value) {
        const street = stripAddressLabel(value);
        if (!street || street.length > 110) return false;
        if (/^(?:tbd-?|n\/?a|not available)$/i.test(street)) return false;
        if (/\b(?:salary|compensation|benefits?|years?\s+of\s+experience)\b/i.test(street)) return false;
        if (/\bP\.?\s*O\.?\s*Box\s+\d+/i.test(street)) return true;
        if (/[!?;]|\s{2,}/.test(street) || street.split(/\s+/).length > 10) return false;

        const numberFirst = /^\d{1,6}(?:-\d{1,6})?[A-Za-z]?\s+[A-Za-z0-9]/.test(street);
        const streetSuffix = /\b(?:Street|St|Road|Rd|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Lane|Ln|Highway|Hwy|Parkway|Pkwy|Court|Ct|Circle|Cir|Way|Place|Pl|Plaza|Trail|Trl|Terrace|Ter|Loop|Route|Rte|Pike|Turnpike)\.?\b/i;
        const numberLast = streetSuffix.test(street) && /\s\d{1,6}(?:-\d{1,6})?[A-Za-z]?$/i.test(street);
        const namedStreet = streetSuffix.test(street) && /^[A-Za-z0-9][A-Za-z0-9.'’ -]+(?:North|South|East|West|Northeast|Northwest|Southeast|Southwest|NE|NW|SE|SW)?$/i.test(street);
        const routeSuffix = '\\d{1,4}(?:\\s+(?:North|South|East|West|N|S|E|W))?';
        const numberedRoute = new RegExp(`^(?:(?:U\\.?S\\.?|US|State)(?:\\s+Highway)?)\\s+${routeSuffix}$`, 'i').test(street)
            || Object.values(stateAbbreviations).some(stateName =>
                new RegExp(`^${stateName.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\s+${routeSuffix}$`, 'i').test(street)
            );

        return numberFirst || numberLast || namedStreet || numberedRoute;
    }

    function parseStateZip(value) {
        const cleaned = cleanLine(value).replace(/^(?:state|region)\s*:\s*/i, '').trim();
        const match = cleaned.match(/^(.+?)(?:\s+(\d{5}(?:-\d{4})?))?$/);
        if (!match) return null;
        const stateAbbrev = getStateAbbrev(match[1]);
        if (!stateAbbrev) return null;
        return {
            stateAbbrev,
            state: getFullStateName(stateAbbrev),
            zipCode: match[2] || ''
        };
    }

    function buildAddress(street, city, stateZip) {
        const cleanStreet = stripAddressLabel(street);
        const cleanCity = cleanLine(city).replace(/^(?:city|locality)\s*:\s*/i, '').trim();
        const parsedState = typeof stateZip === 'string' ? parseStateZip(stateZip) : stateZip;
        if (!isStreetAddress(cleanStreet) || !parsedState) return null;
        if (!/^[A-Za-z][A-Za-z.'’ -]{0,44}$/.test(cleanCity)) return null;
        return {
            streetAddress: cleanStreet,
            city: cleanCity,
            state: parsedState.state,
            stateAbbrev: parsedState.stateAbbrev,
            zipCode: parsedState.zipCode || '',
            location: `${cleanCity}, ${parsedState.stateAbbrev}`
        };
    }

    function parseOneLine(rawLine) {
        let line = stripAddressLabel(rawLine);
        if (!line || /\||\blocations?\s+(?:and\s+locations?\s+)?(?:coming\s+soon\s+)?include\b/i.test(line)) return null;
        line = line.replace(/,?\s*(?:USA|United States)\s*$/i, '').trim();
        const parts = line.split(',').map(cleanLine).filter(Boolean);
        if (parts.length < 3) return null;
        const parsedState = parseStateZip(parts[parts.length - 1]);
        if (!parsedState) return null;
        const city = parts[parts.length - 2];
        const street = parts.slice(0, -2).join(', ');
        return buildAddress(street, city, parsedState);
    }

    function parseCityStateLine(rawLine) {
        const line = cleanLine(rawLine)
            .replace(/^(?:location|job\s+location)\s*:\s*/i, '')
            .replace(/,?\s*(?:USA|United States)\s*$/i, '')
            .trim();
        const commaMatch = line.match(/^([A-Za-z][A-Za-z.'’ -]{0,44})\s*,\s*(.+)$/);
        if (commaMatch) {
            const stateZip = parseStateZip(commaMatch[2]);
            return stateZip ? { city: commaMatch[1].trim(), ...stateZip } : null;
        }
        return null;
    }

    function extractLabeledAddress(lines) {
        const values = {};
        for (const rawLine of lines) {
            const line = cleanLine(rawLine);
            const match = line.match(/^(street\s+address|address|city|locality|state|region|zip(?:\s+code)?|postal\s+code)\s*:\s*(.+)$/i);
            if (!match) continue;
            const key = match[1].toLowerCase();
            if (/^street|^address$/.test(key)) values.street = match[2];
            else if (/^(?:city|locality)$/.test(key)) values.city = match[2];
            else if (/^(?:state|region)$/.test(key)) values.state = match[2];
            else values.zip = match[2];
        }
        if (!values.street || !values.city || !values.state) return null;
        return buildAddress(values.street, values.city, `${values.state}${values.zip ? ` ${values.zip}` : ''}`);
    }

    function extractCompleteAddress(text) {
        const lines = String(text || '').split(/\r?\n/).map(cleanLine).filter(Boolean);
        const labeled = extractLabeledAddress(lines);
        if (labeled) return labeled;

        for (let index = lines.length - 1; index >= 0; index--) {
            const oneLine = parseOneLine(lines[index]);
            if (oneLine) return oneLine;

            const cityState = parseCityStateLine(lines[index]);
            if (!cityState || index === 0) continue;
            const previous = stripAddressLabel(lines[index - 1]);
            if (isStreetAddress(previous)) {
                const parsed = buildAddress(previous, cityState.city, cityState);
                if (parsed) return parsed;
            }
            if (index >= 2 && /^(?:Suite|Ste|Unit|#)\s*[A-Za-z0-9-]+$/i.test(previous)) {
                const parsed = buildAddress(`${stripAddressLabel(lines[index - 2])}, ${previous}`, cityState.city, cityState);
                if (parsed) return parsed;
            }
        }
        return emptyAddress();
    }

    function getAddressFieldsForLocation(extracted, location = null) {
        const fields = {
            streetAddress: extracted?.streetAddress || '',
            zipCode: extracted?.zipCode || '',
            addressCity: extracted?.addressCity || '',
            addressState: extracted?.addressState || '',
            addressLocation: extracted?.addressLocation || ''
        };
        if (!location || !fields.addressCity) return fields;
        const cityMatches = normalizeCompact(location.city) === normalizeCompact(fields.addressCity);
        const locationState = getStateAbbrev(location.state);
        const addressState = getStateAbbrev(fields.addressState);
        const stateMatches = !locationState || !addressState || locationState === addressState;
        if (cityMatches && stateMatches) return fields;
        return { streetAddress: '', zipCode: '', addressCity: '', addressState: '', addressLocation: '' };
    }

    function applyExtractedAddress(job, detail) {
        if (!job || !detail) return job;
        const addressCity = String(detail.addressCity || '').trim();
        const addressState = getFullStateName(detail.addressState);
        const cityConflicts = job.city && addressCity
            && normalizeCompact(job.city) !== normalizeCompact(addressCity);
        const stateConflicts = job.state && addressState
            && getStateAbbrev(job.state) !== getStateAbbrev(addressState);
        if (cityConflicts || stateConflicts) return job;

        if (isStreetAddress(detail.streetAddress)) {
            job.streetAddress = stripAddressLabel(detail.streetAddress);
        }
        if (/^\d{5}(?:-\d{4})?$/.test(String(detail.zipCode || '').trim())) {
            job.zipCode = String(detail.zipCode).trim();
        }

        if (!job.city && addressCity) job.city = addressCity;
        if (!job.state && addressState) job.state = addressState;
        return job;
    }

    return {
        extractCompleteAddress,
        getAddressFieldsForLocation,
        applyExtractedAddress,
        isStreetAddress,
        getStateAbbrev,
        getFullStateName
    };
});
