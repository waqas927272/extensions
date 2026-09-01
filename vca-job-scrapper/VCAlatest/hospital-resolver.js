(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.VcaHospitalResolver = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const STATE_CODES = {
        alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
        connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID',
        illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
        maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
        missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH',
        'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC',
        'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA',
        'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX',
        utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV',
        wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC'
    };

    const GENERIC_WORDS = new Set([
        'vca', 'animal', 'animals', 'hospital', 'hospitals', 'veterinary', 'veterinarian', 'vet', 'clinic',
        'center', 'centre', 'care', 'medical', 'specialty', 'specialists', 'specialist', 'emergency', 'referral',
        'pet', 'pets', 'service', 'services', 'group', 'and', 'the', 'of', 'at', 'in'
    ]);

    const FACILITY_SUFFIX = [
        'Animal Hospital(?: and Pet Resort)?', 'Animal Medical Center', 'Veterinary Specialty and Emergency',
        'Veterinary Specialty & Emergency', 'Veterinary Specialists?', 'Veterinary Hospital', 'Veterinary Clinic',
        'Veterinary Center', 'Veterinary Care', 'Veterinary Internal Medicine', 'Veterinary Group', 'Pet Hospital', 'Pet Center', 'Pet Care',
        'Emergency Hospital', 'Emergency Center', 'Referral Hospital', 'Referral Center', 'Specialty Hospital',
        'Specialty Center', 'Medical Center', 'Animal Care Clinic', 'Animal Care Center', 'Pet Resort',
        'Hospital', 'Clinic', 'Center', 'Specialists?'
    ].join('|');

    const ROLE_ONLY_NAME = /^(?:veterinarian|veterinary specialists?|specialists?|medical director|medical lead(?: veterinarian)?|lead veterinarian|associate veterinarian|emergency veterinarian|criticalist|internist|radiologist|ophthalmologist|dermatologist|cardiologist|oncologist|surgeon)$/i;
    const NON_NAME_PHRASE = /\b(?:learn more|about the hospital|apply through|career site|job opportunity|job posting|position available|associate benefits|equal opportunity|best tools at your disposal|deliver exceptional veterinary care|life outside the clinic|hospital website|website hospital|current associate|parent client|hiring organization|mentorship program|clinical studies|scribe program|schedule|charities)\b/i;

    function cleanText(value) {
        return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function decodeHtml(value) {
        return String(value || '')
            .replace(/&nbsp;|&#160;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;|&#x27;/gi, "'")
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
            .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
    }

    function stripHtml(value, preserveBreaks = false) {
        let text = String(value || '');
        if (preserveBreaks) text = text.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(?:p|div|li)>/gi, '\n');
        text = text.replace(/<[^>]+>/g, ' ');
        return decodeHtml(text)
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n[ \t]+/g, '\n')
            .replace(/[ \t]{2,}/g, ' ')
            .replace(/\n{2,}/g, '\n')
            .trim();
    }

    function stateCode(value) {
        const clean = cleanText(value);
        if (/^[A-Z]{2}$/i.test(clean)) return clean.toUpperCase();
        return STATE_CODES[clean.toLowerCase()] || '';
    }

    function escapeRegex(value) {
        return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function stripTrailingLocationPhrase(value) {
        const source = String(value || '');
        const stateNames = Object.keys(STATE_CODES)
            .sort((left, right) => right.length - left.length)
            .map(escapeRegex)
            .join('|');
        const locationPattern = new RegExp(
            `^\\s+in\\s+[A-Z][A-Za-z .'-]+,?\\s+(?:[A-Z]{2}|${stateNames})\\b.*$`,
            'i'
        );
        const inMarkers = [...source.matchAll(/\s+in\s+/gi)];

        for (let index = inMarkers.length - 1; index >= 0; index--) {
            const marker = inMarkers[index];
            if (locationPattern.test(source.slice(marker.index))) {
                return source.slice(0, marker.index).trim();
            }
        }

        return source;
    }

    function normalizeName(value) {
        return cleanText(value)
            .replace(/&/g, ' and ')
            .replace(/[\u2018\u2019]/g, "'")
            .replace(/[\u2013\u2014]/g, '-')
            .replace(/[^a-z0-9]+/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    function meaningfulTokens(value) {
        return normalizeName(value).split(' ').filter(token => token.length > 1 && !GENERIC_WORDS.has(token));
    }

    function isGenericHospitalName(value) {
        const normalized = normalizeName(value);
        if (!normalized) return true;
        if (ROLE_ONLY_NAME.test(cleanText(value))) return true;
        if (/^vca(?:\s+vca)+(?:\s+animal\s+hospitals?)?$/.test(normalized)) return true;
        if (/^(?:vca|vca animal hospitals?|our hospital|the hospital|animal hospital|veterinary hospital|hospital|clinic|center|care|specialists?)$/.test(normalized)) return true;
        if (/^(?:former|formerly|previously)\b/.test(normalized)) return true;
        return /^VCA\s+Animal\s+Hospitals?\s*[-\u2013\u2014]\s*[^,]+,\s*[^,]+$/i.test(cleanText(value));
    }

    function getHospitalExtractionContext(description) {
        const rawText = decodeHtml(String(description || ''))
            .replace(/\r\n?/g, '\n')
            .replace(/_/g, ' ');
        if (!rawText.trim()) return { rawText: '', bodyText: '', metadataText: '' };

        // Generated multi-location rows contain a wrapper followed by the original
        // source description. The last description marker always points at the
        // actual prose, not the wrapper's derived Hospital/Position fields.
        const sourceMarker = '=== SOURCE JOB DESCRIPTION ===';
        const sourceIndex = rawText.lastIndexOf(sourceMarker);
        const sourceText = sourceIndex >= 0
            ? rawText.slice(sourceIndex + sourceMarker.length)
            : rawText;
        const descriptionMarkers = [
            '=== JOB DESCRIPTION ===',
            '=== FULL JOB DESCRIPTION ===',
            '=== ADDITIONAL PAGE CONTENT ==='
        ];
        let bodyStart = -1;
        let markerLength = 0;
        for (const marker of descriptionMarkers) {
            const index = sourceText.lastIndexOf(marker);
            if (index > bodyStart) {
                bodyStart = index;
                markerLength = marker.length;
            }
        }

        const bodyText = (bodyStart >= 0 ? sourceText.slice(bodyStart + markerLength) : sourceText)
            .replace(/^\s*===.+?===\s*$/gm, ' ')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        const metadataText = sourceIndex >= 0 ? rawText.slice(0, sourceIndex) : rawText;
        return { rawText, bodyText, metadataText };
    }

    function cleanHospitalCandidate(value) {
        let clean = cleanText(decodeHtml(value))
            .replace(/\bAimal\s+Hospital\b/gi, 'Animal Hospital')
            .replace(/^VCA(?:\s+VCA)+(?=\s|$)/i, 'VCA')
            .replace(/^(?:the\s+)+(?=VCA\b)/i, '')
            .replace(/^Join\s+(?=VCA\b)/i, '')
            .replace(/^.*?\b(?:at|with|for)\s+(?=VCA\b)/i, '')
            .replace(/^.+?\b(?=VCA\s+)/i, '')
            .replace(/\.\s+(?:This|It|We|You|Our)\b[\s\S]*$/i, '')
            .replace(/^(?:the\s+)/i, '')
            .replace(/\s*\([A-Z0-9&-]{2,12}\)\s*$/i, '')
            .replace(/\s*\((?:Formerly|Previously)\b[^)]*\)\s*$/i, '')
            .replace(/\s+as\s+(?:an?\s+|the\s+)?(?:Medical\s+Director|Associate\s+Veterinarian|Veterinarian|Emergency\s+Veterinarian|Specialist|Doctor)\b[\s\S]*$/i, '')
            .replace(/\b(Hospital|Clinic|Center|Specialists?)\s+(?:Medical\s+Director|Associate\s+Veterinarian|Veterinarian|Emergency\s+Veterinarian|Specialist|Doctor)\b[\s\S]*$/i, '$1')
            .replace(/\s+family\s*$/i, '')
            .replace(/\s+(?:may\s+be|might\s+be|is|are|has|offers?|provides?|seeks?|is\s+seeking|are\s+seeking|located|serves?)\b[\s\S]*$/i, '')
            .replace(/\s+(?:and\s+you|where(?:\s+you)?|you(?:'|\u2019)?\s*(?:ll|re)|we\s+are|our\s+team)\b[\s\S]*$/i, '')
            .replace(/\b(Hospital|Center|Clinic|Specialists?)\s+or\s+([A-Z][A-Za-z]+)\b$/i, '$1 of $2')
            .replace(/\s+(?:an\s+d|and|&)\s*$/i, '')
            .replace(/[\]\)\s,;:.!\-]+$/, '')
            .trim();

        clean = stripTrailingLocationPhrase(clean);

        // A VCA-prefixed candidate has already been bounded by the sentence
        // cleanup above. Keep location qualifiers such as "Center of Kalamazoo"
        // instead of shortening it to an earlier generic suffix.
        if (/^VCA\b/i.test(clean)) return clean;

        const complete = clean.match(new RegExp(`((?:VCA\\s+)?[A-Z0-9][A-Za-z0-9&'\u2019()./\\-]*(?:\\s+[A-Z0-9(][A-Za-z0-9&'\u2019()./\\-]*){0,15}\\s+(?:${FACILITY_SUFFIX}))`, 'i'));
        if (complete) clean = complete[1].trim();
        return clean;
    }

    function isUsableHospitalCandidate(value) {
        const clean = cleanHospitalCandidate(value);
        if (!clean || clean.length < 4 || clean.length > 150 || isGenericHospitalName(clean)) return false;
        if (ROLE_ONLY_NAME.test(clean) || NON_NAME_PHRASE.test(clean)) return false;
        if (/^(?:\d+|level\s+\d+|former(?:ly)?|previously)\b/i.test(clean)) return false;
        if (/\b(?:job|career|opportunity|position|candidate|veterinary medicine is)\b/i.test(clean)) return false;
        if ((clean.match(/,/g) || []).length > 1 || clean.split(/\s+/).length > 18) return false;

        if (/^VCA\b/i.test(clean)) {
            return !/^VCA\s+(?:Animal Hospitals?|Veterinary Specialist|Veterinarian)$/i.test(clean);
        }

        if (/\b(?:you|your|we|our)\b/i.test(clean)) return false;
        if (!/^[A-Z]/.test(clean) || !new RegExp(`\\b(?:${FACILITY_SUFFIX})$`, 'i').test(clean)) return false;
        if (!/\b(?:Animal|Veterinary|Vet|Pet|Hospital|Clinic|Medical|Emergency|Referral|Specialty|Specialists?)\b/i.test(clean)) return false;
        return meaningfulTokens(clean).some(token => /[a-z]/i.test(token));
    }

    function extractHospitalCandidates(description) {
        const context = getHospitalExtractionContext(description);
        const text = context.bodyText;
        if (!text.trim()) return [];

        const candidates = new Map();
        const add = (raw, boost = 0, reason = '') => {
            const value = cleanHospitalCandidate(raw);
            if (!isUsableHospitalCandidate(value)) return;
            const hasFacilitySignal = /\b(?:Animal|Veterinary|Vet|Pet|Hospital|Clinic|Medical|Emergency|Referral|Specialty|Specialists?|Care|Center|VREC|CAVES)\b/i.test(value);
            const isUnboundedShortVca = /^VCA\b/i.test(value) && !hasFacilitySignal &&
                !['metadata', 'explicit-vca-context', 'vca-family', 'vca-sentence'].includes(reason);
            if (isUnboundedShortVca) return;
            const key = normalizeName(value);
            const existing = candidates.get(key) || { value, score: 0, reasons: [] };
            existing.score += boost + 10;
            if (reason) existing.reasons.push(reason);
            if (value.length > existing.value.length && value.length <= 150) existing.value = value;
            candidates.set(key, existing);
        };

        // Explicit hospital fields are useful only after validation. This avoids
        // treating generated values such as "Hospital: Veterinary Specialist"
        // as authoritative.
        const metadata = /^(?:Hiring Organization|Practice Name|Hospital Name|Hospital|Practice|Facility|Job Site|Site):\s*(.+)$/gim;
        let match;
        while ((match = metadata.exec(context.metadataText)) !== null) add(match[1], 260, 'metadata');

        // The recruiting opening identifies the actual hiring hospital. It must
        // outrank later affiliations such as "member of ... Care Alliance."
        const roleOpening = new RegExp(`\\bJoin\\s+us\\s+as\\b[^.\\n]{0,240}?\\bat\\s+((?:VCA\\s+)?[A-Z0-9][A-Za-z0-9&'\u2019()./\\-]*(?:\\s+(?:[A-Z0-9(][A-Za-z0-9&'\u2019()./\\-]*|and|of|the|for|in|&)){0,15}\\s+(?:${FACILITY_SUFFIX}))(?=\\s+(?:in|located)\\b|[.,;\\n]|$)`, 'gi');
        while ((match = roleOpening.exec(text)) !== null) add(match[1], 180, 'role-opening');

        const completeName = new RegExp(`\\b((?:VCA\\s+)?[A-Z0-9][A-Za-z0-9&'\u2019()./\\-]*(?:\\s+(?:[A-Z0-9(][A-Za-z0-9&'\u2019()./\\-]*|and|of|the|for|in|&)){0,15}\\s+(?:${FACILITY_SUFFIX}))\\b`, 'g');
        while ((match = completeName.exec(text)) !== null) add(match[1], 35, 'complete-name');

        const contextualVca = /\b(?:at|with|for|to)\s+(?:the\s+)?(VCA\s+[A-Z0-9][^;\n]{1,148}?)(?=\s+(?:and\s+you|where|in\s+[A-Z][A-Za-z .'-]+(?:,\s*(?:[A-Z]{2}|[A-Z][a-z]+))?|is|are|has|offers?|provides?|seeks?|located)\b|[,;\n]|\.\s+(?:You|We|At|If|This|Why|Join|Apply)\b|\.$|$)/g;
        while ((match = contextualVca.exec(text)) !== null) add(match[1], 75, 'explicit-vca-context');

        const leadingVca = /\b(VCA\s+[A-Z0-9][^;\n]{1,148}?)(?=\s+(?:and\s+you|where|in\s+[A-Z][A-Za-z .'-]+(?:,\s*(?:[A-Z]{2}|[A-Z][a-z]+))?|is|are|has|offers?|provides?|seeks?|located)\b|[,;\n]|\.\s+(?:You|We|At|If|This|Why|Join|Apply)\b|\.$|$)/g;
        while ((match = leadingVca.exec(text)) !== null) add(match[1], 60, 'leading-vca');

        const vcaFamily = /\b(?:member\s+of\s+the|join\s+the)\s+(VCA\s+[A-Z0-9][A-Za-z0-9&'\u2019()./\-]*(?:\s+[A-Z0-9][A-Za-z0-9&'\u2019()./\-]*){0,6}?)\s+family\b/g;
        while ((match = vcaFamily.exec(text)) !== null) add(match[1], 50, 'vca-family');

        const vcaSentenceName = /\b(VCA\s+[A-Z0-9][A-Za-z0-9&'\u2019()./\-]*(?:\s+[A-Z0-9][A-Za-z0-9&'\u2019()./\-]*){0,12}?)(?=\s+(?:may\s+be|might\s+be|is|are|has|offers?|provides?|seeks?|located)\b)/g;
        while ((match = vcaSentenceName.exec(text)) !== null) add(match[1], 35, 'vca-sentence');

        const explicitContext = new RegExp(`\\b(?:welcome\\s+to|join\\s+(?:us\\s+)?at|position\\s+at|opportunity\\s+at|work\\s+at|with)\\s+((?:VCA\\s+)?[^.;\\n]{3,150}?(?:${FACILITY_SUFFIX}))(?=\\s*(?:[.,;]|$))`, 'gi');
        while ((match = explicitContext.exec(text)) !== null) add(match[1], 55, 'explicit-context');

        for (const item of candidates.values()) {
            if (/^VCA\b/i.test(item.value)) item.score += 12;
            if (new RegExp(`\\b(?:${FACILITY_SUFFIX})$`, 'i').test(item.value)) item.score += 12;
            const occurrences = normalizeName(text).split(normalizeName(item.value)).length - 1;
            item.score += Math.min(occurrences, 4) * 8;
        }

        return [...candidates.values()].sort((a, b) => b.score - a.score || b.value.length - a.value.length);
    }

    function extractBestHospitalName(description, currentHospital = '') {
        const candidates = extractHospitalCandidates(description);
        if (!candidates.length) return '';
        const currentTokens = isUsableHospitalCandidate(currentHospital)
            ? new Set(meaningfulTokens(currentHospital))
            : new Set();
        for (const candidate of candidates) {
            const overlap = meaningfulTokens(candidate.value).filter(token => currentTokens.has(token)).length;
            const candidateName = normalizeName(candidate.value);
            const completesShorterCandidate = candidates.some(other => {
                if (other === candidate) return false;
                const otherName = normalizeName(other.value);
                return otherName && candidateName.startsWith(`${otherName} `) &&
                    new RegExp(`\\b(?:${FACILITY_SUFFIX})$`, 'i').test(candidate.value);
            });
            candidate.adjustedScore = candidate.score + overlap * 12 + (completesShorterCandidate ? 30 : 0);
        }
        candidates.sort((a, b) => b.adjustedScore - a.adjustedScore || b.score - a.score);
        return candidates[0].adjustedScore >= 35 ? candidates[0].value : '';
    }

    function parseVcaDirectory(html) {
        const entries = [];
        const seenEntries = new Set();
        const itemPattern = /<li\b[^>]*>[\s\S]*?<span\b[^>]*class=["'][^"']*location-accordion__location-name[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<span\b[^>]*class=["'][^"']*location-accordion__location-address[^"']*["'][^>]*>([\s\S]*?)<\/span>[\s\S]*?<span\b[^>]*class=["'][^"']*location-accordion__location-phone[^"']*["'][^>]*>([\s\S]*?)<\/span>[\s\S]*?<\/li>/gi;
        let match;
        while ((match = itemPattern.exec(String(html || ''))) !== null) {
            const name = stripHtml(match[2]);
            const addressLines = stripHtml(match[3], true).split('\n').map(cleanText).filter(Boolean);
            const streetAddress = addressLines[0] || '';
            const locality = addressLines.slice(1).join(' ');
            const localityMatch = locality.match(/^(.+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i);
            if (!name || !streetAddress || !localityMatch) continue;
            const href = decodeHtml(match[1]);
            const website = /^https?:\/\//i.test(href) ? href : `https://vcahospitals.com${href.startsWith('/') ? '' : '/'}${href}`;
            const entryKey = [
                normalizeName(name),
                normalizeName(streetAddress),
                normalizeName(localityMatch[1]),
                localityMatch[2].toUpperCase(),
                localityMatch[3]
            ].join('|');
            // The official directory currently contains some identical duplicate
            // rows. They are one hospital, not an ambiguous city match.
            if (seenEntries.has(entryKey)) continue;
            seenEntries.add(entryKey);
            entries.push({
                name,
                streetAddress,
                city: localityMatch[1].trim(),
                state: localityMatch[2].toUpperCase(),
                zipCode: localityMatch[3],
                phone: stripHtml(match[4]).replace(/^Tel:\s*/i, '').trim(),
                website
            });
        }
        return entries;
    }

    function parseLocation(location, city = '', state = '') {
        const parts = cleanText(location).split(',').map(cleanText).filter(Boolean);
        return {
            city: cleanText(city || (parts.length >= 2 ? parts[0] : '')),
            state: stateCode(state || (parts.length >= 2 ? parts[1] : (parts.length === 1 ? parts[0] : '')))
        };
    }

    function pageSlug(value) {
        try {
            const url = new URL(value);
            if (!/(^|\.)vcahospitals\.com$/i.test(url.hostname)) return '';
            return url.pathname.split('/').filter(Boolean)[0]?.toLowerCase() || '';
        } catch (_) {
            return '';
        }
    }

    function tokenEditDistance(left, right) {
        const a = String(left || '');
        const b = String(right || '');
        if (a === b) return 0;
        if (!a.length) return b.length;
        if (!b.length) return a.length;

        const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
        for (let row = 1; row <= a.length; row++) {
            const current = [row];
            for (let column = 1; column <= b.length; column++) {
                const cost = a[row - 1] === b[column - 1] ? 0 : 1;
                current[column] = Math.min(
                    current[column - 1] + 1,
                    previous[column] + 1,
                    previous[column - 1] + cost
                );
            }
            for (let column = 0; column <= b.length; column++) previous[column] = current[column];
        }
        return previous[b.length];
    }

    function tokensApproximatelyMatch(left, right) {
        if (left === right) return true;
        const longest = Math.max(left.length, right.length);
        if (longest < 5) return false;
        const allowedDistance = longest >= 8 ? 2 : 1;
        return tokenEditDistance(left, right) <= allowedDistance;
    }

    function nameSimilarity(a, b) {
        const normalizedA = normalizeName(a);
        const normalizedB = normalizeName(b);
        if (!normalizedA || !normalizedB) return 0;
        if (normalizedA === normalizedB) return 1;

        const aTokens = meaningfulTokens(a);
        const bTokens = meaningfulTokens(b);
        if (!aTokens.length || !bTokens.length) return 0;
        // Treat harmless spacing variants as exact (for example West Creek vs
        // Westcreek), without making different place names such as Mar Vista
        // and Monte Vista equivalent.
        if (aTokens.join('') === bTokens.join('')) return 1;
        const aSet = new Set(aTokens);
        const bSet = new Set(bTokens);
        let common = 0;
        for (const token of aSet) {
            if ([...bSet].some(candidate => tokensApproximatelyMatch(token, candidate))) common++;
        }
        const union = Math.max(1, aSet.size + bSet.size - common);
        const jaccard = union ? common / union : 0;
        const containment = common / Math.min(aSet.size, bSet.size);
        return Math.max(jaccard, containment * 0.9);
    }

    function resolveDirectoryEntry(entries, context = {}) {
        if (!Array.isArray(entries) || !entries.length) return null;
        const expectedLocation = parseLocation(context.location, context.city, context.state);
        // Use the same single, highest-confidence description name that Fetch
        // Details uses. Treating every hospital mentioned in a multi-location
        // source as equal can resolve a child row to one of its sibling hospitals.
        const bestDescriptionName = extractBestHospitalName(context.description, context.hospitalName || '');
        const rawNames = [context.hospitalName, ...(context.candidates || []), bestDescriptionName]
            .map(cleanHospitalCandidate)
            .filter(Boolean);
        const expectedSlug = pageSlug(context.website || '');
        const isLocationSearchLabel = value =>
            /^VCA\s+(?:Animal\s+Hospitals?|Hospital)\s*[-\u2013\u2014]\s*.+,\s*.+(?:\s+\(Unverified\))?$/i.test(cleanText(value || ''));
        const genericLocationLabel = isLocationSearchLabel(context.hospitalName || '');
        // The temporary city/state label exists only to make a blank-hospital row
        // eligible for official lookup. Exclude that label from name scoring, but
        // keep real names extracted from the saved description. Previously the
        // presence of the temporary label zeroed every name score, so even an exact
        // description name could not identify the hospital in multi-hospital cities.
        const names = rawNames.filter(name => !isLocationSearchLabel(name));
        const hasSpecificName = names.some(name => !isGenericHospitalName(name));
        const expectsVca = genericLocationLabel || names.some(name => /^VCA\b/i.test(name) || isGenericHospitalName(name));

        const ranked = entries.map(entry => {
            const slugMatch = expectedSlug && pageSlug(entry.website) === expectedSlug;
            const similarities = names.map(name => nameSimilarity(name, entry.name));
            const bestSimilarity = similarities.length ? Math.max(...similarities) : 0;
            const exactName = names.some(name => normalizeName(name) === normalizeName(entry.name));
            const stateMatch = expectedLocation.state && entry.state === expectedLocation.state;
            const stateMismatch = expectedLocation.state && entry.state !== expectedLocation.state;
            const cityMatch = expectedLocation.city && normalizeName(entry.city) === normalizeName(expectedLocation.city);
            // A weak one-token overlap can point to a different hospital in the
            // same state. Require stronger name evidence before allowing the
            // official address to replace an advertised/nearby city.
            const nameEvidence = slugMatch || exactName || bestSimilarity >= 0.55;
            // City/state-only matching is for descriptions that genuinely contain
            // no hospital identity. If a specific hospital was extracted, a
            // different same-city VCA location must not replace it.
            const locationOnlyAllowed = expectsVca && !hasSpecificName && cityMatch && stateMatch;
            let score = bestSimilarity * 100;
            if (exactName) score += 90;
            if (slugMatch) score += 160;
            if (stateMatch) score += 50;
            if (cityMatch) score += 35;
            if (stateMismatch) score -= 220;
            if (!nameEvidence && !locationOnlyAllowed) score -= 100;
            return { entry, score, bestSimilarity, exactName, slugMatch, stateMatch, cityMatch, nameEvidence, locationOnlyAllowed };
        }).sort((a, b) => b.score - a.score);

        const best = ranked[0];
        const second = ranked[1];
        if (!best || best.score < 80) return null;
        if (!best.nameEvidence && !best.locationOnlyAllowed) return null;
        if (best.locationOnlyAllowed && !best.nameEvidence && second && second.locationOnlyAllowed && best.score - second.score < 15) return null;
        if (second && best.score - second.score < 5 && !best.slugMatch && !best.cityMatch && !second.cityMatch) return null;

        return {
            ...best.entry,
            businessName: best.entry.name,
            fullAddress: `${best.entry.streetAddress}, ${best.entry.city}, ${best.entry.state} ${best.entry.zipCode}`,
            verifiedOfficial: true,
            source: 'official-vca-directory',
            matchConfidence: Math.max(0, Math.min(100, Math.round(best.score)))
        };
    }

    function parsePostalAddress(value) {
        if (!value) return null;

        if (typeof value === 'string') {
            const address = cleanText(value);
            const match = address.match(/^(.+?),\s*([^,]+?),\s*([A-Z]{2}|[A-Za-z ]+)\s+(\d{5}(?:-\d{4})?)(?:,\s*(?:USA|United States))?$/i);
            if (!match) return null;
            return {
                streetAddress: cleanText(match[1]),
                city: cleanText(match[2]),
                state: stateCode(match[3]) || cleanText(match[3]),
                zipCode: match[4]
            };
        }

        if (typeof value !== 'object') return null;
        const streetAddress = cleanText(value.streetAddress || value.addressLine1 || '');
        const city = cleanText(value.addressLocality || value.city || '');
        const state = stateCode(value.addressRegion || value.state || '') || cleanText(value.addressRegion || value.state || '');
        const zipCode = cleanText(value.postalCode || value.zipCode || '');
        if (!streetAddress || !city || !state || !/^\d{5}(?:-\d{4})?$/.test(zipCode)) return null;
        return { streetAddress, city, state, zipCode };
    }

    function collectJsonLdNodes(value, output = []) {
        if (!value) return output;
        if (Array.isArray(value)) {
            value.forEach(item => collectJsonLdNodes(item, output));
            return output;
        }
        if (typeof value !== 'object') return output;
        output.push(value);
        if (Array.isArray(value['@graph'])) collectJsonLdNodes(value['@graph'], output);
        return output;
    }

    function parseJsonLdBlocks(html) {
        const nodes = [];
        const pattern = /<script\b[^>]*type=["']application\/ld\+json[^"']*["'][^>]*>([\s\S]*?)<\/script>/gi;
        let match;
        while ((match = pattern.exec(String(html || ''))) !== null) {
            const raw = decodeHtml(match[1]).replace(/^\s*<!--|-->\s*$/g, '').trim();
            if (!raw) continue;
            try {
                collectJsonLdNodes(JSON.parse(raw), nodes);
            } catch (_) {
                // A malformed analytics block must not invalidate other valid JSON-LD blocks.
            }
        }
        return nodes;
    }

    function extractOfficialBusinessName(html) {
        const source = String(html || '');
        const patterns = [
            /\b_hospitalName\s*=\s*['"]([^'"]{3,180})['"]/i,
            /<h1\b[^>]*>([\s\S]{3,300}?)<\/h1>/i,
            /<meta\b[^>]*name=["']description["'][^>]*content=["'][^"']*?\b((?:VCA\s+)?[A-Z][^"'.]{2,160}?(?:Animal Hospital|Animal Medical Center|Veterinary Hospital|Veterinary Center|Veterinary Specialists?|Emergency Center|Specialty Center))\b/i
        ];

        for (const pattern of patterns) {
            const match = source.match(pattern);
            const candidate = cleanText(stripHtml(match?.[1] || ''));
            if (isUsableHospitalCandidate(candidate)) return candidate;
        }

        return '';
    }

    function absoluteUrl(value, baseUrl) {
        try {
            return new URL(value || baseUrl, baseUrl).href;
        } catch (_) {
            return cleanText(baseUrl);
        }
    }

    function extractOfficialPhone(html) {
        const source = String(html || '');
        const telLink = source.match(/href=["']tel:([^"']+)["']/i);
        const text = stripHtml(source, true);
        const labeled = text.match(/\b(?:Phone|Tel(?:ephone)?):?\s*(\+?1[\s.\-]?)?\(?([2-9]\d{2})\)?[\s.\-]+(\d{3})[\s.\-]+(\d{4})\b/i);
        const raw = telLink?.[1] || labeled?.[0] || '';
        let digits = raw.replace(/\D/g, '');
        if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
        return digits.length === 10
            ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
            : cleanText(raw);
    }

    function parseOfficialWebsite(html, baseUrl, expectedName = '', expectedLocation = '') {
        const candidates = [];
        const expected = parseLocation(expectedLocation);
        const officialPageName = extractOfficialBusinessName(html);
        const officialPagePhone = extractOfficialPhone(html);
        for (const node of parseJsonLdBlocks(html)) {
            const address = parsePostalAddress(node.address || node.location?.address);
            if (!address) continue;

            const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type'] || ''];
            const typeText = types.join(' ');
            const businessName = cleanText(node.name || node.location?.name || officialPageName || expectedName);
            const similarity = expectedName && businessName ? nameSimilarity(expectedName, businessName) : 0;
            let score = 100 + similarity * 100;
            if (/VeterinaryCare|AnimalHospital|Hospital|MedicalBusiness|LocalBusiness|Organization/i.test(typeText)) score += 35;
            if (node.telephone || node.phone) score += 5;
            if (expected.state && stateCode(address.state) === expected.state) score += 25;
            if (expected.state && stateCode(address.state) && stateCode(address.state) !== expected.state) score -= 200;
            if (expected.city && normalizeName(address.city) === normalizeName(expected.city)) score += 20;

            candidates.push({
                businessName: businessName || cleanText(expectedName),
                ...address,
                fullAddress: `${address.streetAddress}, ${address.city}, ${address.state} ${address.zipCode}`,
                website: absoluteUrl(node.url || baseUrl, baseUrl),
                phone: cleanText(node.telephone || node.phone || officialPagePhone || ''),
                verifiedOfficial: true,
                source: 'official-website',
                matchConfidence: Math.max(0, Math.min(100, Math.round(score))),
                _score: score
            });
        }

        if (!candidates.length) {
            const text = stripHtml(html, true);
            const addressMatch = text.match(/(\d{1,6}\s+[^\n,]{2,100}?(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Lane|Ln|Court|Ct|Way|Parkway|Pkwy|Highway|Hwy|Trail|Trl|Circle|Cir|Terrace|Ter)\b[^\n,]*),?\s*[\n,]+\s*([^\n,]{2,80}),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/i);
            if (addressMatch) {
                const address = {
                    streetAddress: cleanText(addressMatch[1]),
                    city: cleanText(addressMatch[2]),
                    state: addressMatch[3].toUpperCase(),
                    zipCode: addressMatch[4]
                };
                candidates.push({
                    businessName: officialPageName || cleanText(expectedName),
                    ...address,
                    fullAddress: `${address.streetAddress}, ${address.city}, ${address.state} ${address.zipCode}`,
                    website: absoluteUrl(baseUrl, baseUrl),
                    phone: officialPagePhone,
                    verifiedOfficial: true,
                    source: 'official-website',
                    matchConfidence: 80,
                    _score: 80
                });
            }
        }

        candidates.sort((a, b) => b._score - a._score);
        if (!candidates.length) return null;
        const best = { ...candidates[0] };
        delete best._score;
        return best;
    }

    function extractOfficialSiteLinks(html, baseUrl) {
        let origin;
        try {
            origin = new URL(baseUrl).origin;
        } catch (_) {
            return [];
        }

        const links = [];
        const seen = new Set();
        const pattern = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
        let match;
        while ((match = pattern.exec(String(html || ''))) !== null) {
            const label = normalizeName(stripHtml(match[2]));
            const hrefText = cleanText(match[1]);
            if (!/(?:contact|location|find us|directions|visit us|hospital)/i.test(`${label} ${hrefText}`)) continue;
            try {
                const url = new URL(hrefText, baseUrl);
                if (url.origin !== origin || !/^https?:$/.test(url.protocol)) continue;
                url.hash = '';
                const href = url.href;
                if (seen.has(href)) continue;
                seen.add(href);
                links.push(href);
            } catch (_) {
                // Ignore malformed links.
            }
        }
        return links;
    }

    function repairBlankHospitalNamesFromDescriptions(jobs = []) {
        let repairedCount = 0;

        for (const job of jobs) {
            if (!job || typeof job !== 'object') continue;
            const description = String(job.description || '').trim();
            if (!description || /^(?:description not found|error fetching description)$/i.test(description)) continue;

            const currentHospital = cleanText(job.hospital || job.hospitalName || '');
            const isFallbackLocationLabel = /^VCA\s+Animal\s+Hospitals?\s*[-\u2013\u2014]\s*[^,]+,\s*[^,]+$/i.test(currentHospital);
            if (currentHospital && isUsableHospitalCandidate(currentHospital) && !isFallbackLocationLabel) continue;

            const extractedHospital = extractBestHospitalName(description, '');
            if (!isUsableHospitalCandidate(extractedHospital)) continue;

            job.previousHospitalName = currentHospital;
            job.hospital = extractedHospital;
            job.hospitalName = extractedHospital;
            job.hospitalNameUpdated = normalizeName(currentHospital) !== normalizeName(extractedHospital);
            repairedCount++;
        }

        return repairedCount;
    }

    return {
        cleanHospitalCandidate,
        getHospitalExtractionContext,
        extractHospitalCandidates,
        extractBestHospitalName,
        repairBlankHospitalNamesFromDescriptions,
        isGenericHospitalName,
        isUsableHospitalCandidate,
        meaningfulTokens,
        nameSimilarity,
        normalizeName,
        extractOfficialSiteLinks,
        parseOfficialWebsite,
        parseLocation,
        parsePostalAddress,
        parseVcaDirectory,
        resolveDirectoryEntry,
        stateCode
    };
});
