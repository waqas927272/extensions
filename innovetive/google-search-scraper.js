// google-search-scraper.js
// Injected into Google Search. Prefer the right-side knowledge panel/business card
// for address, phone, and website, then fall back to visible result text.
(async () => {
    try {
        await waitForGoogleResults();

        const panelText = getKnowledgePanelText();
        const bodyText = cleanText(document.body.innerText || '');
        const address = extractAddress(panelText) || extractAddress(bodyText);
        const parsed = parseAddress(address);

        return {
            fullAddress: address || '',
            streetAddress: parsed.streetAddress || '',
            city: parsed.city || '',
            state: parsed.state || '',
            zipCode: parsed.zipCode || '',
            phone: extractPhoneFromPanel() || extractPhone(panelText) || extractPhone(bodyText) || '',
            website: extractWebsiteFromPanel() || extractWebsiteFromResults() || '',
            panelText: panelText || ''
        };
    } catch (error) {
        return { streetAddress: '', zipCode: '', city: '', state: '', fullAddress: '', website: '', phone: '', error: error.message };
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
            const panelText = getKnowledgePanelText();
            const bodyText = cleanText(document.body.innerText || '');
            const text = panelText || bodyText;

            if (extractAddress(panelText) || extractAddress(bodyText)) return;

            if (text && text === lastText) stableCount++;
            else stableCount = 0;
            lastText = text;

            if (stableCount >= 2 && (document.querySelector('#search') || document.querySelector('#rhs') || document.querySelector('[role="complementary"]'))) {
                return;
            }
        }
    }

    function getKnowledgePanelText() {
        const selectors = [
            '#rhs',
            '[role="complementary"]',
            '.kp-wholepage',
            '[data-attrid*="kc:/location"]',
            '[data-attrid*="address"]',
            '[data-local-attribute]',
            '.lu_map_section'
        ];

        const chunks = [];
        const seen = new Set();
        for (const selector of selectors) {
            for (const element of document.querySelectorAll(selector)) {
                if (!isVisible(element)) continue;
                const text = cleanText(element.innerText || element.textContent || '');
                if (!text || seen.has(text)) continue;
                seen.add(text);
                chunks.push(text);
            }
        }

        return chunks.join('\n');
    }

    function isVisible(element) {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function extractAddress(text) {
        const source = cleanText(text || '');
        if (!source) return '';

        const labelled = source.match(/(?:Address|Located in)\s*[:\n]\s*([^\n]+?\b[A-Z]{2}\s+\d{5}(?:-\d{4})?)/i);
        if (labelled) return normalizeAddress(labelled[1]);

        const patterns = [
            /(\d{1,6}\s+[\w\s.'#&/-]+?(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Rd|Road|Ln|Lane|Way|Ct|Court|Pl|Place|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Trl|Trail|Loop|Ter|Terrace|NE|NW|SE|SW)\b[\w\s.,#&/-]*?,\s*[\w\s.'-]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?)/i,
            /(\d{1,6}\s+[\w\s.'#&/-]+?(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Rd|Road|Ln|Lane|Way|Ct|Court|Pl|Place|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Trl|Trail|Loop|Ter|Terrace|NE|NW|SE|SW)\b[\w\s.,#&/-]*?\s+[A-Z]{2}\s+\d{5}(?:-\d{4})?)/i
        ];

        for (const pattern of patterns) {
            const match = source.match(pattern);
            if (match) return normalizeAddress(match[1]);
        }

        const attrAddress = extractAddressFromAttributes();
        return attrAddress ? normalizeAddress(attrAddress) : '';
    }

    function extractAddressFromAttributes() {
        const selectors = [
            '[data-attrid*="address"]',
            '[aria-label^="Address"]',
            '[data-local-attribute="d3adr"]',
            '.LrzXr'
        ];

        for (const selector of selectors) {
            for (const element of document.querySelectorAll(selector)) {
                const text = cleanText(element.innerText || element.textContent || element.getAttribute('aria-label') || '');
                if (/\d/.test(text) && /\b[A-Z]{2}\s+\d{5}/.test(text)) return text.replace(/^Address\s*[:\n]\s*/i, '');
            }
        }

        return '';
    }

    function extractPhoneFromPanel() {
        const telLink = document.querySelector('#rhs a[href^="tel:"], [role="complementary"] a[href^="tel:"], a[href^="tel:"]');
        if (telLink) return telLink.getAttribute('href').replace(/^tel:/i, '').trim();

        const selectors = [
            '[data-attrid*="phone"]',
            '[aria-label^="Call"]',
            '[data-local-attribute*="phone"]'
        ];
        for (const selector of selectors) {
            for (const element of document.querySelectorAll(selector)) {
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

    function extractWebsiteFromPanel() {
        const panel = document.querySelector('#rhs') || document.querySelector('[role="complementary"]') || document;
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

    function extractWebsiteFromResults() {
        const links = [...document.querySelectorAll('#search a[href], a[href]')];
        for (const link of links) {
            const href = unwrapGoogleUrl(link.href || '');
            if (!/^https?:\/\//i.test(href)) continue;
            if (isBlockedUrl(href)) continue;
            if (looksLikeBusinessWebsite(href)) return href;
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
            .replace(/\s+(?:United States|USA)\s*$/i, '')
            .replace(/\s+(?:Website|Phone|Directions|Hours|Open|Closed).*$/i, '')
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
})();
