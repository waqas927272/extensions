// Injected after address-validation.js on a Google Maps search page.
// It returns data only when the visible place name matches the requested hospital.
(async () => {
    const validation = globalThis.VppAddressValidation;
    const emptyResult = (error = '') => ({
        streetAddress: '', zipCode: '', city: '', state: '', fullAddress: '',
        website: '', phone: '', businessName: '', mapsUrl: '', placeId: '',
        matchScore: 0, source: 'google_maps', error
    });

    try {
        if (!validation) return emptyResult('Address validation helpers were not loaded.');

        const MAX_WAIT = 15000;
        const POLL = 500;
        const startedAt = Date.now();
        const requestedHospital = getHospitalNameFromUrl();
        if (!requestedHospital) return emptyResult('The requested hospital name was missing from the Maps URL.');

        while (Date.now() - startedAt < MAX_WAIT) {
            const place = extractValidatedPlace(requestedHospital);
            if (place) return place;

            const resultLinks = [...document.querySelectorAll('a.hfpxzc')];
            if (resultLinks.length) {
                const best = findBestMatch(resultLinks, requestedHospital);
                if (!best) return emptyResult('No Google Maps result matched the requested hospital.');
                best.link.click();

                const deadline = Date.now() + Math.max(5000, MAX_WAIT - (Date.now() - startedAt));
                while (Date.now() < deadline) {
                    await wait(POLL);
                    const selected = extractValidatedPlace(requestedHospital);
                    if (selected) return selected;
                }
                return emptyResult('The matching Google Maps place did not expose usable details.');
            }
            await wait(POLL);
        }

        return emptyResult('Google Maps did not load a verifiable place result.');
    } catch (error) {
        return emptyResult(error?.message || 'Google Maps extraction failed.');
    }

    function wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function getHospitalNameFromUrl() {
        const match = window.location.href.match(/\/maps\/(?:search|place)\/([^?#/]+)/);
        if (!match) return '';
        const decoded = decodeURIComponent(match[1]).replace(/\+/g, ' ').trim();
        return decoded.split(',')[0].trim();
    }

    function extractBusinessName() {
        const selectors = ['h1.DUwDvf', '[role="main"] h1', 'h1', '[data-attrid="title"]'];
        for (const selector of selectors) {
            const element = document.querySelector(selector);
            const value = validation.cleanText(element?.textContent || element?.getAttribute?.('aria-label') || '');
            if (value && !/google maps/i.test(value)) return value;
        }
        return '';
    }

    function findBestMatch(links, requestedHospital) {
        let best = null;
        for (const link of links) {
            const businessName = validation.cleanText((link.getAttribute('aria-label') || '').replace(/·.*$/, ''));
            if (!businessName) continue;
            const score = validation.bestNameMatch([requestedHospital], businessName).score;
            if (!best || score > best.score) best = { link, businessName, score };
        }
        return best && best.score >= 0.72 ? best : null;
    }

    function extractValidatedPlace(requestedHospital) {
        const businessName = extractBusinessName();
        if (!businessName) return null;
        const matchScore = validation.bestNameMatch([requestedHospital], businessName).score;
        if (matchScore < 0.72) return null;

        const fullAddress = extractFullAddress();
        const parsed = parseAddress(fullAddress);
        const website = extractWebsite();
        const phone = validation.normalizePhone(extractPhone());
        if (!fullAddress && !website && !phone) return null;

        return {
            fullAddress,
            streetAddress: parsed.streetAddress,
            city: parsed.city,
            state: parsed.state,
            zipCode: parsed.zipCode,
            website,
            phone,
            businessName,
            mapsUrl: window.location.href,
            placeId: extractPlaceId(window.location.href),
            matchScore,
            source: 'google_maps',
            error: ''
        };
    }

    function extractFullAddress() {
        const selectors = [
            'button[data-item-id="address"]',
            '[data-item-id="address"] .Io6YTe',
            '[data-item-id="address"] .rogA2c',
            '[aria-label^="Address:"]'
        ];
        for (const selector of selectors) {
            for (const element of document.querySelectorAll(selector)) {
                const label = (element.getAttribute('aria-label') || '').replace(/^Address:\s*/i, '');
                const value = validation.cleanText(label || element.textContent);
                if (/\d/.test(value) && /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/.test(value)) return value;
            }
        }
        return '';
    }

    function extractWebsite() {
        const selectors = [
            'a[data-item-id="authority"]',
            'a[aria-label^="Website:"]',
            'a[data-tooltip="Open website"]'
        ];
        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (!element) continue;
            const href = element.getAttribute('href') || '';
            if (/^https?:\/\//i.test(href)) return href;
            const label = (element.getAttribute('aria-label') || '').replace(/^Website:\s*/i, '').trim();
            if (label) return label;
        }
        return '';
    }

    function extractPhone() {
        const phoneButton = document.querySelector('button[data-item-id^="phone:"], [aria-label^="Phone:"]');
        if (phoneButton) {
            const dataId = phoneButton.getAttribute('data-item-id') || '';
            const fromData = dataId.replace(/^phone:tel:/i, '').replace(/^phone:/i, '').trim();
            if (fromData) return fromData;
            const fromLabel = (phoneButton.getAttribute('aria-label') || '').replace(/^Phone:\s*/i, '').trim();
            if (fromLabel) return fromLabel;
        }
        const telLink = document.querySelector('a[href^="tel:"]');
        return telLink ? (telLink.getAttribute('href') || '').replace(/^tel:/i, '').trim() : '';
    }

    function parseAddress(fullAddress) {
        const blank = { streetAddress: '', city: '', state: '', zipCode: '' };
        if (!fullAddress) return blank;
        const address = fullAddress
            .replace(/,?\s*(?:United States|USA)\s*$/i, '')
            .replace(/\s+/g, ' ')
            .trim();
        const match = address.match(/^([\s\S]+?),\s*([^,]+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i);
        if (!match) return blank;
        return {
            streetAddress: match[1].trim(),
            city: match[2].trim(),
            state: match[3].toUpperCase(),
            zipCode: match[4]
        };
    }

    function extractPlaceId(url) {
        try {
            const parsed = new URL(url);
            const queryPlaceId = parsed.searchParams.get('query_place_id') || parsed.searchParams.get('place_id');
            if (queryPlaceId) return queryPlaceId;
            const dataMatch = url.match(/!1s([^!]+)/);
            return dataMatch ? decodeURIComponent(dataMatch[1]) : '';
        } catch {
            return '';
        }
    }
})();
