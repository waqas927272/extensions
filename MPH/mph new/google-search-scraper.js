// google-search-scraper.js
// Injected into Google Search. Prefer the right-side knowledge/business panel.
// If that is missing, fall back to a single matching left-side result/card and
// only extract address, phone, and website from that same result/card.
(async () => {
    try {
        await waitForGoogleResults();

        const panel = getKnowledgePanelRoot();
        if (panel) {
            const panelText = getKnowledgePanelText(panel);
            const address = extractAddress(panelText, panel);
            if (address) {
                const parsed = parseAddress(address);

                return {
                    businessName: extractBusinessNameFromPanel(panel) || '',
                    fullAddress: address || '',
                    streetAddress: parsed.streetAddress || '',
                    city: parsed.city || '',
                    state: parsed.state || '',
                    zipCode: parsed.zipCode || '',
                    phone: extractPhoneFromPanel(panel) || extractPhone(panelText) || '',
                    website: extractWebsiteFromPanel(panel) || '',
                    panelText: panelText || '',
                    source: 'google_knowledge_panel'
                };
            }
        }

        return extractLeftSideResult() || extractWholePageResult() || emptyResult(panel ? 'no_panel_or_left_address' : 'no_panel_or_left_match');
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
                if (text && !/\b(?:directions|website|reviews|overview|hours)\b/i.test(text)) {
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
                panelText: text,
                source: 'google_left_result',
                score
            };

            if (!best || score > best.score) best = result;
        }

        return best;
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
        return {
            rawQuery: query,
            name: parts.length >= 3 ? parts.slice(0, -2).join(', ') : (parts[0] || query),
            city: parts.length >= 2 ? parts[parts.length - 2] : '',
            state: parts.length >= 2 ? parts[parts.length - 1] : ''
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
                const text = cleanText([
                    element.getAttribute('aria-label') || '',
                    element.innerText || '',
                    element.textContent || ''
                ].filter(Boolean).join('\n'));
                if (/\d/.test(text) && /\b[A-Z]{2}\s+\d{5}/.test(text)) return text.replace(/^Address\s*[:\n]\s*/i, '');
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

        return [
            'google.', 'gstatic.', 'googleusercontent.', 'youtube.', 'facebook.', 'linkedin.',
            'instagram.', 'x.com', 'twitter.', 'indeed.', 'glassdoor.', 'ziprecruiter.',
            'jobvite.', 'unitedveterinarycare.', 'yelp.', 'mapquest.', 'bing.', 'duckduckgo.'
        ].some(blocked => host.includes(blocked));
    }

    function looksLikeBusinessWebsite(href) {
        try {
            const host = new URL(href).hostname.toLowerCase();
            return /\b(vet|veterinary|animal|pet|clinic|hospital|emergency|specialty|care)\b/i.test(host);
        } catch {
            return false;
        }
    }

    function normalizeAddress(address) {
        return (address || '')
            .replace(/^Address\s*[:\n]\s*/i, '')
            .replace(/\s+/g, ' ')
            .replace(/\s*,\s*/g, ', ')
            .replace(/,?\s+(?:United States|USA)\s*$/i, '')
            .replace(/\s+(?:Website|Phone|Directions|Hours|Open|Closed).*$/i, '')
            .replace(/,\s*$/, '')
            .trim();
    }

    function parseAddress(fullAddress) {
        if (!fullAddress) return { streetAddress: '', city: '', state: '', zipCode: '' };

        const addr = normalizeAddress(fullAddress);
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
            panelText: '',
            source: '',
            reason
        };
    }
})();
