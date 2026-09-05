// Injected into an official hospital website discovered through Google Search.
// It extracts one complete branch record from structured data or visible contact
// information. The records page still performs hospital, city, state and ZIP
// validation before accepting the result.
(function (root, factory) {
    const extract = factory(root?.MphAddressQuality || (typeof require === 'function' ? require('./mph-address-quality.js') : null));
    if (typeof module === 'object' && module.exports) module.exports = extract;
    if (root) root.MphExtractWebsiteAddress = extract;
    if (typeof document === 'undefined' || !document.documentElement.dataset.mphExpectedHospital) return;
    return extract(document, {
        hospital: document.documentElement.dataset.mphExpectedHospital || '',
        city: document.documentElement.dataset.mphExpectedCity || '',
        state: document.documentElement.dataset.mphExpectedState || '',
        branchQueryResolved: document.documentElement.dataset.mphBranchQueryResolved === 'true'
    }, location.href);
})(typeof globalThis !== 'undefined' ? globalThis : this, quality => function extractWebsiteAddress(document, context = {}, pageUrl = '') {
    context = { ...context, hospital: context.hospital || context.expectedHospital || '',
        city: context.city || context.expectedCity || '', state: context.state || context.expectedState || '' };

    const STATE_NAMES = {
        Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO',
        Connecticut: 'CT', Delaware: 'DE', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID',
        Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA',
        Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN',
        Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV',
        'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
        'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR',
        Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD',
        Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA',
        'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY', 'District of Columbia': 'DC'
    };
    const candidates = [];

    function clean(value) {
        return String(value || '')
            .replace(/&amp;/gi, '&')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&#0*39;|&apos;/gi, "'")
            .replace(/&quot;/gi, '"')
            .replace(/\u00a0/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function normalize(value) {
        return clean(value).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
    }

    function stateAbbreviation(value) {
        const state = clean(value).replace(/\.$/, '');
        if (/^[A-Z]{2}$/i.test(state)) return state.toUpperCase();
        const entry = Object.entries(STATE_NAMES).find(([name]) => normalize(name) === normalize(state));
        return entry ? entry[1] : '';
    }

    function phoneValue(value) {
        const match = clean(value).match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/);
        return match ? match[0] : '';
    }

    function addCandidate(candidate, source) {
        const streetAddress = clean(candidate.streetAddress);
        const city = clean(candidate.city);
        const state = stateAbbreviation(candidate.state);
        const postal = clean(candidate.zipCode);
        const zipCode = /^\d{4}$/.test(postal) ? postal.padStart(5, '0') : postal.match(/\b\d{5}(?:-\d{4})?\b/)?.[0] || '';
        if (!streetAddress || !city || !state || !zipCode) return;
        if (!/^\d{1,6}[A-Za-z]?(?:[-/]\d+)?\s+/.test(streetAddress)) return;

        const key = normalize(`${streetAddress}|${city}|${state}|${zipCode}`)
            .replace(/\bstreet\b/g, 'st').replace(/\broad\b/g, 'rd')
            .replace(/\bdrive\b/g, 'dr').replace(/\bavenue\b/g, 'ave');
        const existing = candidates.find(item => item.key === key || (quality
            && quality.citiesMatch(item.city, city, state) && item.state === state && item.zipCode === zipCode
            && quality.streetAddressesMatch(item.streetAddress, streetAddress)));
        if (existing) {
            if (quality?.isStreetEnrichment(existing.streetAddress, streetAddress)) existing.streetAddress = streetAddress;
            if (!existing.phone && candidate.phone) existing.phone = phoneValue(candidate.phone);
            if (candidate.branchEvidence) existing.branchEvidence = candidate.branchEvidence;
            return;
        }
        candidates.push({
            key,
            businessName: clean(candidate.businessName),
            streetAddress,
            city,
            state,
            zipCode,
            phone: phoneValue(candidate.phone),
            website: pageUrl,
            category: 'Veterinary hospital',
            source,
            branchEvidence: clean(candidate.branchEvidence)
        });
    }

    function visitJson(value, inheritedName = '', inheritedPhone = '') {
        if (!value) return;
        if (Array.isArray(value)) {
            value.forEach(item => visitJson(item, inheritedName, inheritedPhone));
            return;
        }
        if (typeof value !== 'object') return;

        const name = clean(value.name || inheritedName);
        // A named child branch cannot inherit a different branch's phone.
        const phone = clean(value.telephone || value.phone || (!value.name || value.name === inheritedName ? inheritedPhone : ''));
        const address = value.address;
        if (address && typeof address === 'object' && !Array.isArray(address)) {
            addCandidate({
                businessName: name,
                streetAddress: address.streetAddress,
                city: address.addressLocality,
                state: address.addressRegion,
                zipCode: address.postalCode,
                phone
            }, 'official-website-jsonld');
        } else if (typeof address === 'string') {
            addTextCandidates(address, name, phone, 'official-website-jsonld-text');
        }

        Object.values(value).forEach(child => {
            if (child && typeof child === 'object') visitJson(child, name, phone);
        });
    }

    function addTextCandidates(text, businessName = '', phone = '', source = 'official-website-visible', branchEvidence = '') {
        const stateAlternatives = [...Object.keys(STATE_NAMES), ...Object.values(STATE_NAMES)]
            .sort((a, b) => b.length - a.length)
            .map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('|');
        const streetSuffix = '(?:St(?:reet)?|Ave(?:nue)?|Blvd|Boulevard|Dr(?:ive)?|Rd|Road|Ln|Lane|Way|Ct|Court|Pl|Place|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Trl|Trail|Loop|Ter|Terrace|Turnpike|Tpke|Route|Rte)\\.?';
        const streetEnd = `(?:${streetSuffix}|(?:US|U\\.S\\.|SR|CR|FM|RM)[ -]*\\d+[A-Za-z]?)`;
        const pattern = new RegExp(
            `(\\d{1,6}[A-Za-z]?\\s+[A-Za-z0-9 .'’#&/\\-]{0,100}?\\b${streetEnd}(?:\\s+(?:NE|NW|SE|SW|North|South|East|West|N|S|E|W))?(?:[, ]+(?:Suite|Ste\\.?|Unit|Building|Bldg\\.?)\\s*#?[A-Za-z0-9 .&\\-]+)?)` +
            `[,\\s]+([A-Za-z][A-Za-z .'’\\-]{1,50}?)[,\\s]+(${stateAlternatives})\\s+(\\d{5}(?:-\\d{4})?)`,
            'gi'
        );
        const normalizedText = String(text || '')
            .replace(/\u00a0/g, ' ')
            .replace(/[\t ]+/g, ' ')
            .replace(/\n+/g, ', ');
        const matches = [...normalizedText.matchAll(pattern)];
        const distinctAddresses = new Set(matches.map(match => normalize(match.slice(1, 5).join('|'))));
        for (const match of matches) {
            addCandidate({
                businessName,
                streetAddress: match[1],
                city: match[2],
                state: match[3],
                zipCode: match[4],
                phone: distinctAddresses.size === 1 ? phone : '', branchEvidence
            }, source);
        }
    }

    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
            visitJson(JSON.parse(script.textContent || ''));
        } catch (_) {
            // Ignore malformed third-party structured data.
        }
    }

    const siteName = clean(
        document.querySelector('meta[property="og:site_name"]')?.content ||
        document.title.match(/\|\s*(.+?)(?:\s+[–—]|$)/)?.[1] ||
        document.querySelector('h1')?.textContent || document.title
    ).replace(/\s+[|–—-]\s+.*$/, '').trim();

    // Address links delimit one location; scanning an entire locations page can
    // join the preceding branch's phone to the next street. Keep each card intact.
    for (const anchor of document.querySelectorAll('a[href*="google.com/maps"], a[href*="maps.google"]')) {
        const copy = anchor.cloneNode(true);
        for (const br of copy.querySelectorAll('br')) br.replaceWith(document.createTextNode(', '));
        const addressText = clean(copy.textContent);
        if (!/^\d/.test(addressText)) continue;
        const card = anchor.closest('.card, article, [itemtype*="VeterinaryCare"]');
        let contactBlock = card || anchor.parentElement;
        for (let depth = 0; !card && depth < 5 && contactBlock?.parentElement; depth++) {
            if (contactBlock.querySelector('a[href^="tel:"]')) break;
            if (contactBlock.parentElement.querySelectorAll('a[href*="google.com/maps"], a[href*="maps.google"]').length > 1) break;
            contactBlock = contactBlock.parentElement;
        }
        const localPhone = phoneValue(contactBlock?.querySelector('a[href^="tel:"]')?.getAttribute('href')?.replace(/^tel:/i, '') || '');
        const branchEvidence = clean(card?.querySelector('h2, h3, h4')?.textContent || '');
        addTextCandidates(addressText, siteName, localPhone, 'official-website-address-link', branchEvidence);
    }

    for (const element of document.querySelectorAll('address, [itemprop="address"], footer, [class*="contact" i], [id*="contact" i]')) {
        const localPhone = phoneValue(element.querySelector('a[href^="tel:"]')?.getAttribute('href')?.replace(/^tel:/i, '') || '');
        addTextCandidates(element.innerText || element.textContent || '', siteName, localPhone);
    }
    if (!candidates.length) addTextCandidates(document.body?.innerText || document.body?.textContent || '', siteName, '');

    function cityScore(candidateCity) {
        if (quality?.citiesMatch(context.city, candidateCity, context.state)) return 30;
        const expected = normalize(context.city).replace(/\s+/g, '');
        const actual = normalize(candidateCity).replace(/\s+/g, '');
        if (!expected) return 0;
        if (expected === actual) return 30;
        if (expected.includes(actual) || actual.includes(expected)) return 18;
        return 0;
    }

    function nameScore(candidateName) {
        const stop = new Set(['the', 'and', 'of', 'at', 'animal', 'veterinary', 'hospital', 'clinic', 'center', 'centre', 'pet', 'care', 'urgent']);
        const expected = normalize(context.hospital).split(' ').filter(token => token.length > 2 && !stop.has(token));
        const actual = normalize(`${candidateName} ${document.title}`);
        return expected.filter(token => actual.includes(token)).length * 5;
    }

    candidates.forEach(candidate => {
        candidate.score = cityScore(candidate.city) + nameScore(candidate.businessName)
            + (candidate.state === stateAbbreviation(context.state) ? 100 : 0)
            + (candidate.source.includes('jsonld') ? 5 : 0)
            + (candidate.phone ? 2 : 0)
            + (candidate.branchEvidence && normalize(context.hospital).includes(normalize(candidate.branchEvidence)) ? 40 : 0);
    });
    candidates.sort((left, right) => right.score - left.score);
    const best = candidates[0];
    if (!best) return {
        businessName: siteName,
        streetAddress: '', city: '', state: '', zipCode: '', fullAddress: '',
        website: pageUrl, phone: '', category: 'Veterinary hospital',
        uniquePlaceMatch: false, branchQueryResolved: context.branchQueryResolved
    };

    const cityCandidates = candidates.filter(candidate => cityScore(candidate.city) === 30
        && (!context.state || candidate.state === stateAbbreviation(context.state)));
    const branchCandidates = cityCandidates.filter(candidate => candidate.branchEvidence
        && normalize(context.hospital).includes(normalize(candidate.branchEvidence)));
    // Phone completeness and JSON-LD priority must not turn two branches in the
    // same city into an allegedly unique result.
    const sameLocationCount = (branchCandidates.length ? branchCandidates
        : cityCandidates.length ? cityCandidates : candidates).length;
    return {
        businessName: best.businessName || siteName || context.hospital,
        streetAddress: best.streetAddress,
        city: best.city,
        state: best.state,
        zipCode: best.zipCode,
        fullAddress: `${best.streetAddress}, ${best.city}, ${best.state} ${best.zipCode}`,
        website: best.website,
        phone: best.phone,
        category: best.category,
        source: best.source,
        branchEvidence: best.branchEvidence,
        uniquePlaceMatch: sameLocationCount === 1,
        ambiguousPlaceMatch: sameLocationCount > 1,
        branchQueryResolved: sameLocationCount === 1 && context.branchQueryResolved === true,
        candidateCount: sameLocationCount
    };
});
