// google-search-scraper.js
// Injected into Google Search. Prefer the right-side knowledge/business panel.
// If that is missing, fall back to a single matching left-side result/card and
// only extract address, phone, and website from that same result/card.
(async () => {
    try {
        await waitForGoogleResults();

        const pageText = cleanText(document.body?.innerText || document.body?.textContent || '');
        if (/\/sorry\//i.test(location.pathname)
            || /unusual traffic|not a robot|automated queries|complete the security check/i.test(pageText)) {
            return {
                ...emptyResult('google_verification_required'),
                verificationRequired: true,
                error: 'Google verification required'
            };
        }

        const expected = getExpectedSearchParts();
        const panel = getKnowledgePanelRoot();
        if (panel) {
            const panelText = getKnowledgePanelText(panel);
            const address = extractAddress(panelText, panel);
            if (address) {
                const parsed = parseAddress(address);
                const panelWebsite = extractWebsiteFromPanel(panel) || '';

                return {
                    businessName: extractBusinessNameFromPanel(panel) || '',
                    fullAddress: address || '',
                    streetAddress: parsed.streetAddress || '',
                    city: parsed.city || '',
                    state: parsed.state || '',
                    zipCode: parsed.zipCode || '',
                    phone: extractPhoneFromPanel(panel) || extractPhone(panelText) || '',
                    // Never attach an unverified organic result to this place.
                    website: panelWebsite,
                    category: extractFacilityCategory(panelText),
                    panelText: panelText || '',
                    source: 'google_knowledge_panel',
                    // A discovery hint stays separate from the place bundle.
                    // The caller must inspect and validate this site itself.
                    websiteCandidate: extractWebsiteHintFromPanel(panel) || extractOfficialWebsiteCandidate(),
                    uniquePlaceMatch: true,
                    branchQueryResolved: /\([^)]*\)|\s[-–—]\s/.test(expected.name || '')
                };
            }
        }

        // Never scan the whole page for a loose address: that can join the title
        // of one business with an address from another result. One Google card only.
        const leftResult = extractLeftSideResult();
        const websiteCandidate = extractOfficialWebsiteCandidate();
        return leftResult ? { ...leftResult, websiteCandidate }
            : websiteCandidate || emptyResult(panel ? 'no_panel_or_left_address' : 'no_panel_or_left_match');
    } catch (error) {
        return { businessName: '', streetAddress: '', zipCode: '', city: '', state: '', fullAddress: '', website: '', phone: '', error: error.message };
    }

    function wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function waitForGoogleResults() {
        const deadline = Date.now() + 15000;
        let lastText = '';
        let stableCount = 0;

        while (Date.now() < deadline) {
            await wait(500);
            const panel = getKnowledgePanelRoot();
            const panelText = panel ? getKnowledgePanelText(panel) : '';
            const searchText = cleanText((document.querySelector('#search') || document.body).innerText || '');

            if (panel && extractAddress(panelText, panel)) return;

            const text = panelText || searchText;
            if (text && text === lastText) stableCount++;
            else stableCount = 0;
            lastText = text;

            if (stableCount >= 2 && (panel || document.querySelector('#search'))) {
                return;
            }
        }
    }

    function getKnowledgePanelRoot() {
        const selectors = [
            '#rhs',
            '[role="complementary"]',
            '.kp-wholepage'
        ];

        for (const selector of selectors) {
            for (const element of document.querySelectorAll(selector)) {
                if (!isVisible(element)) continue;
                const text = cleanText(element.innerText || element.textContent || '');
                if (text && /\b(?:Address|Website|Directions|Reviews|Call|Phone)\b/i.test(text)) {
                    return element;
                }
            }
        }

        return null;
    }

    function getKnowledgePanelText(panel) {
        if (!panel) return '';
        const selectors = [
            ':scope',
            '[data-attrid*="kc:/location"]',
            '[data-attrid*="address"]',
            '[data-local-attribute]',
            '[aria-label*="Address"]',
            '.lu_map_section',
            '.LrzXr',
            '.wDYxhc',
            '.Z1hOCe'
        ];

        const chunks = [];
        const seen = new Set();
        for (const selector of selectors) {
            for (const element of panel.querySelectorAll(selector)) {
                if (!isVisible(element)) continue;
                const text = cleanText(element.innerText || element.textContent || '');
                if (!text || seen.has(text)) continue;
                seen.add(text);
                chunks.push(text);
            }
        }

        return chunks.join('\n');
    }

    function extractBusinessNameFromPanel(panel) {
        if (!panel) return '';

        const mapImage = panel.querySelector('img[alt^="Map of "]');
        const mapName = cleanText(mapImage?.getAttribute('alt') || '').replace(/^Map of\s+/i, '').trim();
        if (mapName) return mapName;

        const selectors = [
            '[data-attrid="title"]',
            '[data-attrid*="title"]',
            'h2[data-attrid]',
            'h2',
            '[role="heading"][aria-level="2"]'
        ];

        for (const selector of selectors) {
            for (const element of panel.querySelectorAll(selector)) {
                const text = cleanText(element.innerText || element.textContent || '');
                if (text && !/\b(?:directions|website|reviews|overview|hours|complementary results|search results|sponsored results)\b/i.test(text)) {
                    return text.replace(/\s+-\s+Google Search$/i, '').trim();
                }
            }
        }

        const lines = cleanText(panel.innerText || panel.textContent || '').split('\n').map(line => line.trim()).filter(Boolean);
        return lines[0] || '';
    }

    function extractLeftSideResult() {
        const expected = getExpectedSearchParts();
        const candidates = getLeftSideCandidates();
        let best = null;

        for (const element of candidates) {
            const text = cleanText(element.innerText || element.textContent || '');
            if (!text || text.length < 20) continue;

            const address = extractAddress(text, element);
            if (!address) continue;

            const parsed = parseAddress(address);
            const businessName = extractBusinessNameFromResult(element, text, expected);
            const score = scoreLeftSideCandidate({ text, businessName, parsed, expected });
            if (score < 4) continue;

            const result = {
                businessName,
                fullAddress: address,
                streetAddress: parsed.streetAddress || '',
                city: parsed.city || '',
                state: parsed.state || '',
                zipCode: parsed.zipCode || '',
                phone: extractPhone(text) || '',
                website: extractWebsiteFromPanel(element) || '',
                category: extractFacilityCategory(text),
                panelText: text,
                source: 'google_left_result',
                score
            };

            if (!best || score > best.score) best = result;
        }

        return best;
    }

    // Google often shows the hospital's official website without repeating its
    // full address in the result card. Return that official-site candidate so
    // the extension can inspect the same hospital website for its structured
    // branch address instead of incorrectly falling back to TBD.
    function extractOfficialWebsiteCandidate() {
        const expected = getExpectedSearchParts();
        const candidates = getLeftSideCandidates();
        let best = null;

        for (const element of candidates) {
            const text = cleanText(element.innerText || element.textContent || '');
            const heading = element.querySelector('h3, [role="heading"]');
            const businessName = cleanText(heading?.innerText || heading?.textContent || '');
            if (!businessName) continue;

            const links = [...element.querySelectorAll('a[href]')];
            const website = links.map(link => unwrapGoogleUrl(link.href || ''))
                .find(href => /^https?:\/\//i.test(href) && !isBlockedUrl(href)) || '';
            const discoveryUrl = website ? '' : googleRedirectFromResult(element, heading);
            if (!website && !discoveryUrl) continue;

            const score = scoreWebsiteCandidate({ businessName, text, expected });
            if (score < 4) continue;

            const result = {
                ...emptyResult('official_website_candidate'),
                businessName,
                website,
                discoveryUrl,
                category: extractFacilityCategory(`${businessName} ${text}`),
                panelText: text,
                source: 'google_official_website',
                branchQueryResolved: /\([^)]*\)|\s[-–—]\s/.test(expected.name || ''),
                score
            };
            if (!best || score > best.score) best = result;
        }

        return best;
    }

    function googleRedirectFromResult(element, heading) {
        // Some Google layouts hide the destination behind an opaque /goto URL.
        // Follow the actual heading link, not a guessed path from the breadcrumb.
        // The caller must verify the destination and its hospital address.
        try {
            const url = new URL(heading.closest('a[href]')?.getAttribute('href') || '', location.href);
            if (url.protocol !== 'https:' || !/^(?:www\.)?google\.com$/.test(url.hostname)
                || !['/goto', '/url'].includes(url.pathname) || !url.searchParams.has('url')) return '';
            const cited = cleanText(element.querySelector('cite')?.textContent || '').match(/^https?:\/\/[^\s›]+/)?.[0];
            if (!cited || isBlockedUrl(cited)) return '';
            return url.href;
        } catch (_) { return ''; }
    }

    function extractWebsiteHintFromPanel(panel) {
        for (const link of panel.querySelectorAll('a[href]')) {
            const label = cleanText(`${link.innerText || link.textContent || ''} ${link.getAttribute('aria-label') || ''}`);
            if (!/\bwebsite\b/i.test(label)) continue;
            try {
                const url = new URL(link.getAttribute('href'), location.href);
                if (url.protocol === 'https:' && /^(?:www\.)?google\.com$/.test(url.hostname)
                    && ['/goto', '/url'].includes(url.pathname) && url.searchParams.has('url')) {
                    return { website: '', discoveryUrl: url.href };
                }
            } catch (_) { /* Ignore malformed panel links. */ }
        }
        return null;
    }

    function scoreWebsiteCandidate({ businessName, text, expected }) {
        const expectedTokens = normalizeName(expected.name)
            .split(' ')
            .filter(token => token.length > 2 && !['the', 'and', 'for', 'with', 'of', 'at', 'hospital', 'clinic', 'veterinary', 'animal', 'pet', 'care'].includes(token));
        const candidate = normalizeName(`${businessName} ${text}`);
        const matched = expectedTokens.filter(token => candidate.includes(token)).length;
        const coverage = expectedTokens.length ? matched / expectedTokens.length : 0;
        let score = coverage * 6;
        if (expectedTokens.length && matched === expectedTokens.length) score += 3;
        if (requiredFacilityPhraseMatches(expected.name, `${businessName} ${text}`)) score += 1;
        if (expected.city && candidate.includes(normalizeName(expected.city))) score += 1;
        return score;
    }

    function extractWholePageResult() {
        const expected = getExpectedSearchParts();
        const text = cleanText(document.body?.innerText || document.body?.textContent || '');
        if (!text) return null;

        const address = extractAddress(text, document.body);
        if (!address) return null;

        const parsed = parseAddress(address);
        if (!parsed.streetAddress || !parsed.zipCode) return null;

        const businessName = extractBusinessNameFromPanel(getKnowledgePanelRoot()) || expected.name || '';
        const score = scoreLeftSideCandidate({ text, businessName, parsed, expected });
        if (score < 4) return null;

        return {
            businessName,
            fullAddress: address,
            streetAddress: parsed.streetAddress || '',
            city: parsed.city || '',
            state: parsed.state || '',
            zipCode: parsed.zipCode || '',
            phone: extractPhone(text) || '',
            website: extractWebsiteFromPanel(document.body) || '',
            panelText: text,
            source: 'google_whole_page',
            score
        };
    }

    function getExpectedSearchParts() {
        let query = '';
        try {
            query = new URL(window.location.href).searchParams.get('q') || '';
        } catch {
            query = '';
        }

        const parts = query.split(',').map(part => part.trim()).filter(Boolean);
        const context = document.documentElement.dataset;
        return {
            rawQuery: query,
            name: context.mphExpectedHospital || (parts.length >= 3 ? parts.slice(0, -2).join(', ') : (parts[0] || query)),
            city: context.mphExpectedCity || (parts.length >= 2 ? parts[parts.length - 2] : ''),
            state: context.mphExpectedState || (parts.length >= 2 ? parts[parts.length - 1] : '')
        };
    }

    function getLeftSideCandidates() {
        const root = document.querySelector('#search') || document.body;
        const selectors = [
            '.g',
            '.MjjYud',
            '.VkpGBb',
            '.rllt__details',
            '[role="article"]',
            '[data-hveid]',
            '[jscontroller][data-ved]'
        ];
        const seen = new Set();
        const candidates = [];

        for (const selector of selectors) {
            for (const element of root.querySelectorAll(selector)) {
                if (!isVisible(element) || seen.has(element)) continue;
                const text = cleanText(element.innerText || element.textContent || '');
                if (!text || text.length > 3000) continue;
                seen.add(element);
                candidates.push(element);
            }
        }

        return candidates;
    }

    function extractBusinessNameFromResult(element, text, expected) {
        const selectors = [
            'h3',
            '[role="heading"]',
            '.dbg0pd',
            '.qBF1Pd',
            '.OSrXXb',
            '.SPZz6b'
        ];

        for (const selector of selectors) {
            for (const child of element.querySelectorAll(selector)) {
                const value = cleanText(child.innerText || child.textContent || '');
                if (value && !/\b(?:businesses|website|directions|reviews|photos|overview)\b/i.test(value)) {
                    return value;
                }
            }
        }

        const expectedName = normalizeName(expected.name);
        const lines = cleanText(text).split('\n').map(line => line.trim()).filter(Boolean);
        const matchingLine = lines.find(line => normalizeName(line).includes(expectedName) || expectedName.includes(normalizeName(line)));
        return matchingLine || lines[0] || '';
    }

    function scoreLeftSideCandidate({ text, businessName, parsed, expected }) {
        const haystack = normalizeName(`${businessName} ${text}`);
        const expectedName = normalizeName(expected.name);
        const expectedCity = normalizeName(expected.city);
        const expectedState = normalizeName(expected.state);
        let score = 0;

        if (expectedName && haystack.includes(expectedName)) score += 5;
        score += Math.min(3, countMeaningfulNameMatches(expected.name, `${businessName} ${text}`));

        if (expectedCity && normalizeName(parsed.city || text).includes(expectedCity)) score += 2;
        if (expectedState && (normalizeName(parsed.state).includes(expectedState) || haystack.includes(expectedState))) score += 1;
        if (parsed.streetAddress && parsed.zipCode) score += 2;
        if (requiredFacilityPhraseMatches(expected.name, `${businessName} ${text}`)) score += 1;

        if (expectedName && !requiredFacilityPhraseMatches(expected.name, `${businessName} ${text}`)) score -= 2;
        return score;
    }

    function countMeaningfulNameMatches(expectedName, text) {
        const stopWords = new Set(['the', 'and', 'for', 'with', 'of', 'at', 'in']);
        const expectedWords = normalizeName(expectedName).split(' ').filter(word => word.length > 2 && !stopWords.has(word));
        const haystack = normalizeName(text);
        return expectedWords.filter(word => haystack.includes(word)).length;
    }

    function requiredFacilityPhraseMatches(expectedName, text) {
        const expected = normalizeName(expectedName);
        const haystack = normalizeName(text);
        const facilityGroups = [
            ['animal hospital', 'animal clinic', 'animal center', 'animal centre', 'veterinary hospital', 'veterinary clinic', 'veterinary center', 'veterinary centre'],
            ['pet hospital', 'pet clinic', 'pet center', 'pet centre'],
            ['animal medical center', 'animal medical centre', 'animal medical clinic', 'animal medical hospital'],
            ['urgent care', 'emergency care', 'veterinary urgent care']
        ];
        const requiredGroups = facilityGroups.filter(group => group.some(phrase => expected.includes(phrase)));

        return requiredGroups.length === 0 || requiredGroups.some(group => group.some(phrase => haystack.includes(phrase)));
    }

    function normalizeName(value) {
        return cleanText(value)
            .toLowerCase()
            .replace(/&/g, ' and ')
            .replace(/[^a-z0-9]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function isVisible(element) {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function extractAddress(text, panel) {
        const source = cleanText(text || '');
        const attrAddress = extractAddressFromAttributes(panel);
        if (attrAddress) return normalizeAddress(attrAddress);
        if (!source) return '';

        const labelled = source.match(/(?:Address|Located in)\s*[:\n]\s*([^\n]+?\b[A-Z]{2}\s+\d{5}(?:-\d{4})?)/i);
        if (labelled) return normalizeAddress(labelled[1]);

        const inlineLabelled = source.match(/(?:Address|Located in)\s+(.+?\b[A-Z]{2}\s+\d{5}(?:-\d{4})?)(?:\s+(?:Phone|Hours|Website|Directions|Suggest an edit)\b|$)/i);
        if (inlineLabelled) return normalizeAddress(inlineLabelled[1]);

        const patterns = [
            /(\d{1,6}\s+[\w\s.'#&/-]+?(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Rd|Road|Ln|Lane|Way|Ct|Court|Pl|Place|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Trl|Trail|Loop|Ter|Terrace|NE|NW|SE|SW)\b[\w\s.,#&/-]*?,\s*[\w\s.'-]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?)/i,
            /(\d{1,6}\s+[\w\s.'#&/-]+?(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Rd|Road|Ln|Lane|Way|Ct|Court|Pl|Place|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Trl|Trail|Loop|Ter|Terrace|NE|NW|SE|SW)\b[\w\s.,#&/-]*?\s+[A-Z]{2}\s+\d{5}(?:-\d{4})?)/i
        ];

        for (const pattern of patterns) {
            const match = source.match(pattern);
            if (match) return normalizeAddress(match[1]);
        }

        return '';
    }

    function extractAddressFromAttributes(panel) {
        if (!panel) return '';
        const selectors = [
            '[data-attrid*="address"]',
            '[aria-label^="Address"]',
            '[aria-label*="Address:"]',
            '[data-attrid*="kc:/location/location:address"]',
            '[data-local-attribute="d3adr"]',
            '[data-local-attribute*="address"]',
            '.LrzXr',
            '.wDYxhc',
            '.Z1hOCe'
        ];

        for (const selector of selectors) {
            for (const element of panel.querySelectorAll(selector)) {
                // Inspect each representation separately. Joining aria-label,
                // innerText, and textContent duplicated some addresses as
                // "..., United States Address: ...".
                const candidates = [
                    element.getAttribute('aria-label') || '',
                    element.innerText || '',
                    element.textContent || ''
                ];
                for (const candidate of candidates) {
                    const text = normalizeAddress(candidate);
                    if (/\d/.test(text) && /\b[A-Z]{2}\s+\d{5}/.test(text)) return text;
                }
            }
        }

        return '';
    }

    function extractPhoneFromPanel(panel) {
        if (!panel) return '';
        const telLink = panel.querySelector('a[href^="tel:"]');
        if (telLink) return telLink.getAttribute('href').replace(/^tel:/i, '').trim();

        const selectors = [
            '[data-attrid*="phone"]',
            '[aria-label^="Call"]',
            '[data-local-attribute*="phone"]'
        ];
        for (const selector of selectors) {
            for (const element of panel.querySelectorAll(selector)) {
                const text = cleanText(element.innerText || element.textContent || element.getAttribute('aria-label') || '');
                const phone = extractPhone(text);
                if (phone) return phone;
            }
        }
        return '';
    }

    function extractPhone(text) {
        const source = cleanText(text || '');
        const match = source.match(/(?:Phone|Call)\s*[:\n]?\s*(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/i)
            || source.match(/\b(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/);
        return match ? (match[1] || match[0]).trim() : '';
    }

    function extractFacilityCategory(text) {
        const match = cleanText(text || '').match(/\b(?:Veterinarian|Veterinary hospital|Animal hospital|Animal clinic|Pet hospital|Pet clinic|Emergency veterinarian(?: service)?)\b/i);
        return match ? match[0] : '';
    }

    function extractWebsiteFromPanel(panel) {
        if (!panel) return '';
        const links = [...panel.querySelectorAll('a[href]')];
        for (const link of links) {
            const label = cleanText(`${link.innerText || ''} ${link.getAttribute('aria-label') || ''} ${link.getAttribute('title') || ''}`);
            const href = unwrapGoogleUrl(link.href || '');
            if (!/^https?:\/\//i.test(href)) continue;
            if (isBlockedUrl(href)) continue;
            if (/\bwebsite\b/i.test(label) || looksLikeBusinessWebsite(href)) return href;
        }
        return '';
    }

    function unwrapGoogleUrl(href) {
        try {
            const url = new URL(href);
            if (url.hostname.includes('google.') && url.pathname === '/url') {
                return url.searchParams.get('q') || url.searchParams.get('url') || href;
            }
        } catch {
            return href;
        }
        return href;
    }

    function isBlockedUrl(href) {
        let host = '';
        try {
            host = new URL(href).hostname.replace(/^www\./i, '').toLowerCase();
        } catch {
            return true;
        }

        if (/(?:^|\.)(?:gov|mil)$/.test(host)) return true;
        return [
            'google.', 'gstatic.', 'googleusercontent.', 'youtube.', 'facebook.', 'linkedin.',
            'instagram.', 'x.com', 'twitter.', 'indeed.', 'glassdoor.', 'ziprecruiter.',
            'jobvite.', 'unitedveterinarycare.', 'yelp.', 'mapquest.', 'waze.', 'bing.', 'duckduckgo.',
            'yellowpages.', 'greatpetcare.', 'carecredit.', 'vetmodo.', 'vetreceipt.', 'vetstoria.',
            'petdesk.'
        ].some(blocked => blocked.endsWith('.')
            ? host.split('.').includes(blocked.slice(0, -1))
            : host === blocked || host.endsWith(`.${blocked}`));
    }

    function looksLikeBusinessWebsite(href) {
        try {
            const host = new URL(href).hostname.toLowerCase();
            return /(vet|veterinary|animal|pet|clinic|hospital|emergency|specialty|care)/i.test(host);
        } catch {
            return false;
        }
    }

    function normalizeAddress(address) {
        let clean = (address || '')
            .replace(/^Address\s*[:\n]\s*/i, '')
            .replace(/\s+/g, ' ')
            .trim();
        const repeatedLabel = clean.search(/\s+(?:Address|Located in)\s*:\s*/i);
        if (repeatedLabel > 0) clean = clean.slice(0, repeatedLabel).trim();

        return clean
            .replace(/\s*,\s*/g, ', ')
            .replace(/,?\s+(?:United States|USA)\s*$/i, '')
            .replace(/\s+(?:Website|Phone|Directions|Hours|Open|Closed).*$/i, '')
            .replace(/,\s*$/, '')
            .trim();
    }

    function parseAddress(fullAddress) {
        if (!fullAddress) return { streetAddress: '', city: '', state: '', zipCode: '' };

        const addr = normalizeAddress(fullAddress)
            // Google snippets occasionally remove the separator between the
            // street suffix and city: "10685 N. 69th St.Scottsdale, AZ".
            .replace(/\b(St|Street|Rd|Road|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Ln|Lane|Ct|Court|Pkwy|Parkway|Hwy|Highway)\.([A-Z])/g, '$1., $2');
        const zipPattern = /^([\s\S]+?),\s*([^,]+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/;
        const zipMatch = addr.match(zipPattern);
        if (zipMatch) {
            return {
                streetAddress: zipMatch[1].trim(),
                city: zipMatch[2].trim(),
                state: zipMatch[3].trim(),
                zipCode: zipMatch[4].trim()
            };
        }

        const stateZipPattern = /\b([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/;
        const stateZipMatch = addr.match(stateZipPattern);
        if (!stateZipMatch) return { streetAddress: '', city: '', state: '', zipCode: '' };

        const state = stateZipMatch[1];
        const zipCode = stateZipMatch[2];
        const beforeStateZip = addr
            .substring(0, addr.lastIndexOf(stateZipMatch[0]))
            .replace(/,\s*$/, '')
            .trim();
        const parts = beforeStateZip.split(',').map(part => part.trim()).filter(Boolean);

        if (parts.length >= 2) {
            return {
                streetAddress: parts.slice(0, -1).join(', '),
                city: parts[parts.length - 1],
                state,
                zipCode
            };
        }

        // Google snippets sometimes separate the suite and city with periods
        // instead of commas: "13900 Jog Rd. Ste 209. Delray Beach, FL 33446".
        // The last period-delimited segment is the city; everything before it is
        // the street/suite belonging to that same result card.
        const periodParts = beforeStateZip.split(/\.\s+/).map(part => part.trim()).filter(Boolean);
        if (periodParts.length >= 2) {
            return {
                streetAddress: periodParts.slice(0, -1).join('. '),
                city: periodParts[periodParts.length - 1],
                state,
                zipCode
            };
        }

        return { streetAddress: beforeStateZip, city: '', state, zipCode };
    }

    function cleanText(text) {
        return (text || '')
            .replace(/\u00a0/g, ' ')
            .replace(/[ \t]+/g, ' ')
            .replace(/\n{2,}/g, '\n')
            .trim();
    }

    function emptyResult(reason = '') {
        return {
            businessName: '',
            streetAddress: '',
            zipCode: '',
            city: '',
            state: '',
            fullAddress: '',
            website: '',
            phone: '',
            category: '',
            panelText: '',
            source: '',
            branchQueryResolved: false,
            reason
        };
    }
})();
