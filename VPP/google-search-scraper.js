// Injected after address-validation.js on Google Search.
// Only a knowledge panel or organic result whose business name matches the
// requested hospital may provide address/contact fields.
(async () => {
    const validation = globalThis.VppAddressValidation;
    const emptyResult = (error = '') => ({
        streetAddress: '', zipCode: '', city: '', state: '', fullAddress: '',
        website: '', phone: '', businessName: '', searchUrl: window.location.href,
        matchScore: 0, source: 'google_search', error
    });

    try {
        if (!validation) return emptyResult('Address validation helpers were not loaded.');
        const requestedHospital = getRequestedHospital();
        if (!requestedHospital) return emptyResult('The requested hospital name was missing from the search URL.');

        await waitForResults();
        const panelResult = extractKnowledgePanel(requestedHospital);
        if (panelResult) return panelResult;

        const organicResult = extractMatchingOrganicResult(requestedHospital);
        return organicResult || emptyResult('No Google Search result matched the requested hospital.');
    } catch (error) {
        return emptyResult(error?.message || 'Google Search extraction failed.');
    }

    function wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function waitForResults() {
        const deadline = Date.now() + 12000;
        while (Date.now() < deadline) {
            if (document.querySelector('#rhs, [role="complementary"], #search')) return;
            await wait(400);
        }
    }

    function getRequestedHospital() {
        try {
            const query = new URL(window.location.href).searchParams.get('q') || '';
            return validation.cleanText(query.split(',')[0]);
        } catch {
            return '';
        }
    }

    function extractKnowledgePanel(requestedHospital) {
        const panel = document.querySelector('#rhs') || document.querySelector('[role="complementary"]');
        if (!panel) return null;

        const businessName = extractHeading(panel);
        const matchScore = validation.bestNameMatch([requestedHospital], businessName).score;
        if (!businessName || matchScore < 0.72) return null;

        const panelText = cleanText(panel.innerText || panel.textContent || '');
        const fullAddress = extractAddress(panelText, panel);
        const parsed = parseAddress(fullAddress);
        const phone = validation.normalizePhone(extractPhone(panelText, panel));
        const website = extractWebsite(panel);
        if (!fullAddress && !phone && !website) return null;

        return {
            fullAddress,
            streetAddress: parsed.streetAddress,
            city: parsed.city,
            state: parsed.state,
            zipCode: parsed.zipCode,
            phone,
            website,
            businessName,
            searchUrl: window.location.href,
            matchScore,
            source: 'google_search',
            error: ''
        };
    }

    function extractMatchingOrganicResult(requestedHospital) {
        const cards = [...document.querySelectorAll('#search .MjjYud, #search .g')];
        let best = null;
        for (const card of cards) {
            const businessName = validation.cleanText(card.querySelector('h3')?.textContent || '');
            if (!businessName) continue;
            const matchScore = validation.bestNameMatch([requestedHospital], businessName).score;
            if (matchScore < 0.72 || (best && best.matchScore >= matchScore)) continue;

            const cardText = cleanText(card.innerText || card.textContent || '');
            const fullAddress = extractAddress(cardText, card);
            const parsed = parseAddress(fullAddress);
            const phone = validation.normalizePhone(extractPhone(cardText, card));
            const website = extractWebsite(card);
            if (!fullAddress && !phone && !website) continue;

            best = {
                fullAddress,
                streetAddress: parsed.streetAddress,
                city: parsed.city,
                state: parsed.state,
                zipCode: parsed.zipCode,
                phone,
                website,
                businessName,
                searchUrl: window.location.href,
                matchScore,
                source: 'google_search',
                error: ''
            };
        }
        return best;
    }

    function extractHeading(container) {
        const selectors = [
            '[data-attrid="title"] span', '[data-attrid="title"]',
            'h2[data-attrid]', 'h2', '[role="heading"][aria-level="2"]', 'h1'
        ];
        for (const selector of selectors) {
            const text = validation.cleanText(container.querySelector(selector)?.textContent || '');
            if (text && !/see (?:photos|results)|web results/i.test(text)) return text;
        }
        return '';
    }

    function extractAddress(text, container) {
        const selectors = ['[data-attrid*="address"]', '[aria-label^="Address"]', '[data-local-attribute="d3adr"]', '.LrzXr'];
        for (const selector of selectors) {
            for (const element of container.querySelectorAll(selector)) {
                const value = cleanText(element.innerText || element.textContent || element.getAttribute('aria-label') || '')
                    .replace(/^Address\s*[:\n]\s*/i, '');
                if (/\d/.test(value) && /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/.test(value)) return normalizeAddress(value);
            }
        }

        const labelled = text.match(/(?:Address|Located in)\s*[:\n]\s*([^\n]+?\b[A-Z]{2}\s+\d{5}(?:-\d{4})?)/i);
        if (labelled) return normalizeAddress(labelled[1]);
        const generic = text.match(/(\d{1,6}\s+[\w\s.'#&/-]+?(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Rd|Road|Ln|Lane|Way|Ct|Court|Pl|Place|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Trl|Trail|Loop|Ter|Terrace|NE|NW|SE|SW)\b[\w\s.,#&/-]*?,\s*[\w\s.'-]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?)/i);
        return generic ? normalizeAddress(generic[1]) : '';
    }

    function extractPhone(text, container) {
        const telLink = container.querySelector('a[href^="tel:"]');
        if (telLink) return (telLink.getAttribute('href') || '').replace(/^tel:/i, '');
        const match = text.match(/(?:Phone|Call)\s*[:\n]?\s*(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/i);
        return match ? match[1] : '';
    }

    function extractWebsite(container) {
        for (const link of container.querySelectorAll('a[href]')) {
            const href = unwrapGoogleUrl(link.href || link.getAttribute('href') || '');
            if (!/^https?:\/\//i.test(href) || isBlockedUrl(href)) continue;
            return href;
        }
        return '';
    }

    function unwrapGoogleUrl(href) {
        try {
            const url = new URL(href, window.location.href);
            if (url.hostname.includes('google.') && url.pathname === '/url') {
                return url.searchParams.get('q') || url.searchParams.get('url') || '';
            }
            return url.toString();
        } catch {
            return '';
        }
    }

    function isBlockedUrl(href) {
        try {
            const host = new URL(href).hostname.replace(/^www\./i, '').toLowerCase();
            return [
                'google.', 'gstatic.', 'googleusercontent.', 'youtube.', 'facebook.', 'linkedin.',
                'instagram.', 'x.com', 'twitter.', 'indeed.', 'glassdoor.', 'ziprecruiter.',
                'jobvite.', 'greenhouse.', 'yelp.', 'mapquest.', 'maps.apple.', 'yellowpages.',
                'chamberofcommerce.', 'bbb.org', 'greatpetcare.', 'birdeye.', 'vetreceipt.',
                'bing.', 'duckduckgo.'
            ].some(blocked => host.includes(blocked));
        } catch {
            return true;
        }
    }

    function normalizeAddress(value) {
        return cleanText(value)
            .replace(/^Address\s*[:\n]\s*/i, '')
            .replace(/\s*,\s*/g, ', ')
            .replace(/,?\s*(?:United States|USA)\s*$/i, '')
            .replace(/\s+(?:Website|Phone|Directions|Hours|Open|Closed).*$/i, '')
            .trim();
    }

    function parseAddress(fullAddress) {
        const blank = { streetAddress: '', city: '', state: '', zipCode: '' };
        if (!fullAddress) return blank;
        const match = normalizeAddress(fullAddress).match(/^([\s\S]+?),\s*([^,]+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i);
        if (!match) return blank;
        return {
            streetAddress: match[1].trim(),
            city: match[2].trim(),
            state: match[3].toUpperCase(),
            zipCode: match[4]
        };
    }

    function cleanText(value) {
        return String(value || '')
            .replace(/\u00a0/g, ' ')
            .replace(/[ \t]+/g, ' ')
            .replace(/\n{2,}/g, '\n')
            .trim();
    }
})();
