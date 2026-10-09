// google-search-scraper.js
// Injected into Google Search. Prefer the right-side knowledge panel/business card
// for address, phone, and website, then fall back to visible result text.
(async () => {
    let activePanel = null;
    try {
        if (!globalThis.AAHAddressValidation) throw new Error('Address validation module was not loaded');
        return await globalThis.AAHAddressValidation.waitForContactDetails(readPanel,
            result => !!result.businessName && !!result.city && !!result.state,
            globalThis.__AAH_ADDRESS_CONTEXT__ || {}) || readPanel();
    } catch (error) {
        return { businessName: '', streetAddress: '', zipCode: '', city: '', state: '', fullAddress: '', website: '', phone: '', error: error.message };
    }

    function readPanel() {
        const panels = [];
        for (const selector of ['[role="dialog"]', '.knowledge-panel', '.kp-wholepage', '.xpdopen', '#rhs', '[role="complementary"]']) {
            const matches = document.querySelectorAll ? document.querySelectorAll(selector) : [document.querySelector(selector)];
            for (const panel of matches) if (panel && isVisible(panel) && !panels.includes(panel)) panels.push(panel);
        }
        const context = globalThis.__AAH_ADDRESS_CONTEXT__ || {};
        let best = null, bestScore = -1;
        try {
            for (const panel of panels) {
                activePanel = panel;
                const candidate = readSelectedPanel();
                const valid = globalThis.AAHAddressValidation.validateGoogleResult(candidate, context).accepted;
                const score = (valid ? 100 : 0) + (candidate.businessName ? 1 : 0) +
                    (candidate.streetAddress ? 2 : 0) + (candidate.phone ? 1 : 0) + (candidate.website ? 1 : 0);
                if (score > bestScore) { best = candidate; bestScore = score; }
            }
        } finally { activePanel = null; }
        return best || { businessName: '', streetAddress: '', city: '', state: '', zipCode: '', phone: '', website: '' };
    }

    function readSelectedPanel() {
        const panelText = getKnowledgePanelText();
        const businessName = extractBusinessNameFromPanel() || '';
        if (!panelText || !businessName) {
            return { businessName: '', streetAddress: '', zipCode: '', city: '', state: '', fullAddress: '', website: '', phone: '' };
        }

        const address = extractAddress(panelText);
        const parsed = address ? parseAddress(address)
            : globalThis.AAHAddressValidation.extractContactLocality(panelText);

        const contacts = globalThis.AAHAddressValidation.extractPanelContacts(activePanel);
        return {
            businessName,
            fullAddress: address || '',
            streetAddress: parsed.streetAddress || '',
            city: parsed.city || '',
            state: parsed.state || '',
            zipCode: parsed.zipCode || '',
            phone: contacts.phone,
            website: contacts.website,
            panelText: panelText || ''
        };
    }

    function getKnowledgePanel() {
        return activePanel;
    }

    function getKnowledgePanelText() {
        const panel = getKnowledgePanel();
        return panel ? cleanText(panel.innerText || panel.textContent || '') : '';
    }

    function extractBusinessNameFromPanel() {
        const panel = getKnowledgePanel();
        if (!panel) return '';
        const selectors = [
            '[data-attrid="title"]',
            '[data-attrid="kc:/local:one line"] h2',
            '[role="heading"][aria-level="2"]',
            '[role="heading"][aria-level="1"]',
            '.kno-ecr-pt',
            'h1',
            'h2',
            'h3',
            '.qrShPb',
            '.SPZz6b h2'
        ];

        let fallback = '';
        const context = globalThis.__AAH_ADDRESS_CONTEXT__ || {};
        for (const selector of selectors) {
            for (const element of panel.querySelectorAll(selector)) {
                if (!isVisible(element)) continue;
                const text = cleanText(element.innerText || element.textContent || '');
                if (text && text.length <= 120 && !globalThis.AAHAddressValidation.isSearchHeading(text) &&
                    !/^(?:Website|Directions|Call|Address|Hours|Reviews|Review summary|Popular times|Businesses|Places)$/i.test(text)) {
                    if (!fallback) fallback = text;
                    if (!context.hospitalName ||
                        globalThis.AAHAddressValidation.businessNameFuzzyMatches(context.hospitalName, text) ||
                        globalThis.AAHAddressValidation.locationAwareNameMatches(context.hospitalName, text, context.city)) return text;
                }
            }
        }

        return fallback;
    }

    function isVisible(element) {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function extractAddress(text) {
        const source = cleanText(text || '');
        if (!source) return '';

        // Structured address fields preserve wrapped lines and hyphenated
        // building numbers (e.g. Queens' 25-62) before loose text patterns run.
        const structuredAddress = extractAddressFromAttributes();
        if (structuredAddress) return normalizeAddress(structuredAddress);

        const labelledBlock = source.match(/\bAddress\s*[:\n]\s*([\s\S]+?)(?=\n(?:Phone|Call|Hours|Website|Directions|Open|Closed|Suggest an edit)\b|$)/i);
        if (labelledBlock) {
            const parsed = parseAddress(labelledBlock[1]);
            if (parsed.streetAddress && parsed.city && parsed.state) return normalizeAddress(labelledBlock[1]);
        }

        const stateToken = `(?:[A-Z]{2}|${getStateNamePattern()})`;
        const labelled = source.match(new RegExp(`(?:Address|Located in)\\s*[:\\n]\\s*([^\\n]+?\\b${stateToken}\\s+\\d{5}(?:-\\d{4})?)`, 'i'));
        if (labelled) return normalizeAddress(labelled[1]);

        // Expanded local panels can show an unlabelled address (including
        // numbered highways). Inspect only this business panel, not all results.
        const lines = source.split('\n').map(line => line.trim()).filter(Boolean);
        for (let i = 0; i < lines.length; i++) {
            for (const candidate of [lines[i], lines.slice(i, i + 2).join(' ')]) {
                if (!/^(?:Address\s*:\s*)?(?:[^,\d]+,\s*)?(?:\d{1,6}(?:-\d+)?[A-Za-z]?\s|P\.?\s*O\.?\s*Box\s)/i.test(candidate)) continue;
                const parsed = parseAddress(candidate);
                if (globalThis.AAHAddressValidation.isValidStreetAddress(parsed.streetAddress) &&
                    parsed.city && parsed.state && globalThis.AAHAddressValidation.isValidZipCode(parsed.zipCode)) {
                    return normalizeAddress(candidate);
                }
            }
        }

        const patterns = [
            new RegExp(`((?<![\\d-])\\d{1,6}(?:-\\d{1,6})?[a-z]?\\s+[\\w\\s.'#&/-]+?(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Rd|Road|Ln|Lane|Way|Ct|Court|Pl|Place|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Trl|Trail|Loop|Ter|Terrace|NE|NW|SE|SW)\\b[\\w\\s.,#&/-]*?,\\s*[\\w\\s.'-]+,\\s*${stateToken}\\s+\\d{5}(?:-\\d{4})?)`, 'i'),
            new RegExp(`((?<![\\d-])\\d{1,6}(?:-\\d{1,6})?[a-z]?\\s+[\\w\\s.'#&/-]+?(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Rd|Road|Ln|Lane|Way|Ct|Court|Pl|Place|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Trl|Trail|Loop|Ter|Terrace|NE|NW|SE|SW)\\b[\\w\\s.,#&/-]*?\\s+${stateToken}\\s+\\d{5}(?:-\\d{4})?)`, 'i')
        ];

        for (const pattern of patterns) {
            const match = source.match(pattern);
            if (match) return normalizeAddress(match[1]);
        }

        const attrAddress = extractAddressFromAttributes();
        return attrAddress ? normalizeAddress(attrAddress) : '';
    }

    function extractAddressFromAttributes() {
        const panel = getKnowledgePanel();
        if (!panel) return '';
        const selectors = [
            '[data-attrid*="address"]',
            '[aria-label^="Address"]',
            '[data-local-attribute="d3adr"]',
            '[data-item-id="address"]',
            'a[href*="/maps"]',
            '.LrzXr'
        ];

        for (const selector of selectors) {
            for (const element of panel.querySelectorAll(selector)) {
                const text = cleanText(element.getAttribute('aria-label')?.match(/^Address:/i)
                    ? element.getAttribute('aria-label') : element.innerText || element.textContent || '');
                const parsed = parseAddress(text);
                if (parsed.streetAddress && parsed.city && parsed.state) return text.replace(/^Address\s*[:\n]\s*/i, '');
            }
        }

        return '';
    }

    function normalizeAddress(address) {
        return (address || '')
            .replace(/^Address\s*[:\n]\s*/i, '')
            .replace(/\s+/g, ' ')
            .replace(/\s*,\s*/g, ', ')
            // The attribute fallback includes ", United States". Remove its
            // comma too, or the ZIP-at-end parser rejects wrapped addresses.
            .replace(/\s+(?:Website|Phone|Directions|Hours|Open|Closed).*$/i, '')
            .replace(/,?\s*(?:United States|USA)\s*$/i, '')
            .trim();
    }

    function getStateNamePattern() {
        return [
            'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut',
            'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa',
            'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan',
            'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada',
            'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina',
            'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island',
            'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont',
            'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming',
            'District of Columbia'
        ].map(state => state.replace(/\s+/g, '\\s+')).join('|');
    }

    function parseAddress(fullAddress) {
        if (!fullAddress) return { streetAddress: '', city: '', state: '', zipCode: '' };

        const addr = normalizeAddress(fullAddress);
        const stateToken = `(?:[A-Z]{2}|${getStateNamePattern()})`;
        const zipPattern = new RegExp(`^([\\s\\S]+?),\\s*([^,]+?),\\s*(${stateToken})\\s+(\\d{5}(?:-\\d{4})?)$`, 'i');
        const zipMatch = addr.match(zipPattern);
        if (zipMatch) {
            return {
                streetAddress: zipMatch[1].trim(),
                city: zipMatch[2].trim(),
                state: zipMatch[3].trim(),
                zipCode: zipMatch[4].trim()
            };
        }

        const stateZipPattern = new RegExp(`\\b(${stateToken})\\s+(\\d{5}(?:-\\d{4})?)\\s*$`, 'i');
        const stateZipMatch = addr.match(stateZipPattern);
        if (!stateZipMatch) {
            const withoutZip = addr.match(new RegExp(`^([\\s\\S]+?),\\s*([^,]+?),\\s*(${stateToken})$`, 'i'));
            return withoutZip ? { streetAddress: withoutZip[1].trim(), city: withoutZip[2].trim(), state: withoutZip[3].trim(), zipCode: '' }
                : { streetAddress: '', city: '', state: '', zipCode: '' };
        }

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
