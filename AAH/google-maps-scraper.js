// google-maps-scraper.js
// Injected into a Google Maps search page to extract business address data.
//
// Strategy:
// 1. Check if Google Maps auto-navigated to a single place (address button visible)
// 2. If search results list is shown, find the result matching the hospital name
//    by reading aria-label on a.hfpxzc elements, click the best match
// 3. Wait for place detail panel to load, then extract address from the address button
// 4. Parse the full address into street, city, state, zip components
//
// Uses polling — checks every 500ms for up to 15 seconds total.
(async () => {
    const scrapeContext = globalThis.__AAH_ADDRESS_CONTEXT__ || {};
    try {
        if (!globalThis.AAHAddressValidation) throw new Error('Address validation module was not loaded');
        const MAX_WAIT = Number(scrapeContext.maxWaitMs) || 15000;   // 15 seconds max total
        const POLL = Number(scrapeContext.pollMs) || 500;            // Check every 500ms
        const startTime = Date.now();

        // Helper: wait ms
        const wait = (ms) => new Promise(r => setTimeout(r, ms));
        const collectContacts = () => globalThis.AAHAddressValidation.waitForContactDetails(
            tryExtractFromPlaceDetail, shouldAcceptAddressData,
            { maxWaitMs: Math.max(1, MAX_WAIT - (Date.now() - startTime)), pollMs: POLL });

        // ============================================================
        // PHASE 1: Wait for Google Maps to load something meaningful
        // Either a single place detail OR a search results list
        // ============================================================
        let addressData = null;

        while (Date.now() - startTime < MAX_WAIT) {
            // Check if we're on a single place page (address button exists)
            addressData = tryExtractFromPlaceDetail();
            if (addressData && shouldAcceptAddressData(addressData)) return await collectContacts() || emptyResult();

            // Check if search results list has loaded
            const resultLinks = document.querySelectorAll('a.hfpxzc');
            if (resultLinks.length > 0) {
                // Results list is loaded — go to Phase 2
                break;
            }

            await wait(POLL);
        }

        // If Maps auto-opened a single wrong branch, do not return it.
        if (addressData && !shouldAcceptAddressData(addressData) && !document.querySelectorAll('a.hfpxzc').length) return emptyResult();

        // ============================================================
        // PHASE 2: Search results list is showing
        // Find the best matching result by comparing aria-label to hospital name
        // The hospital name is embedded in the search URL query
        // ============================================================
        const hospitalName = getHospitalNameFromUrl();
        const resultLinks = document.querySelectorAll('a.hfpxzc');

        if (resultLinks.length === 0) {
            // No results and no place detail — nothing we can do
            return emptyResult();
        }

        // Try matching results one by one. Some hospital names have multiple
        // branches, so the first fuzzy match is not always the right city.
        let matchedResults = findMatchingResults(resultLinks, hospitalName);
        const originalHospitalName = String(scrapeContext.originalHospitalName || '').trim();
        if (originalHospitalName && originalHospitalName !== hospitalName) {
            const originalMatches = findMatchingResults(resultLinks, originalHospitalName);
            const seen = new Set(matchedResults.map(item => item.href || item.label));
            matchedResults = matchedResults.concat(originalMatches.filter(item => {
                const key = item.href || item.label;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            }));
        }
        if (matchedResults.length === 0) {
            console.warn('No fuzzy business-name match found in Google Maps results');
            return emptyResult();
        }

        for (let i = 0; i < Math.min(matchedResults.length, 8); i++) {
            const candidate = matchedResults[i];
            console.log(`Clicking result: "${candidate.label}"`);

            let target = candidate.link;
            if (i > 0) {
                window.history.back();
                await wait(1500);
                target = findResultLink(candidate) || candidate.link;
            }

            if (target) {
                target.click();
            }

            const phase3End = Math.min(Date.now() + 6500, startTime + MAX_WAIT);
            while (Date.now() < phase3End) {
                await wait(POLL);

                addressData = tryExtractFromPlaceDetail();
                if (addressData) {
                    if (shouldAcceptAddressData(addressData)) return await collectContacts() || emptyResult();
                    console.warn(`Skipping result outside expected location: ${addressData.fullAddress || [addressData.city, addressData.state, addressData.zipCode].filter(Boolean).join(', ')}`);
                    break;
                }
            }
        }

        // Do not scan the full page body: it can contain unrelated result-card addresses.
        return emptyResult();

    } catch (e) {
        return { streetAddress: '', zipCode: '', city: '', state: '', fullAddress: '', website: '', phone: '', error: e.message };
    }

    // ===== Extract hospital name from the Google Maps URL query =====
    // URL format: https://www.google.com/maps/search/Hospital+Name+City+State
    function getHospitalNameFromUrl() {
        if (scrapeContext.hospitalName) return String(scrapeContext.hospitalName).trim();
        const url = window.location.href;
        const searchMatch = url.match(/\/maps\/search\/([^?#]+)/);
        if (searchMatch) {
            const decoded = decodeURIComponent(searchMatch[1]).replace(/\+/g, ' ').trim();
            return decoded.split(',')[0].trim();
        }
        return '';
    }

    // ===== Find the search result that best matches the hospital name =====
    // Compares aria-label text against the hospital name using word overlap

    function getBusinessNameFromPlaceDetail() {
        const selectors = ['h1.DUwDvf', 'h1[aria-level="1"]', '[role="main"] h1', '.DUwDvf', 'h1'];
        for (const selector of selectors) {
            const el = document.querySelector(selector);
            const text = (el?.innerText || el?.textContent || '').trim();
            if (text) return text.replace(/\s+/g, ' ');
        }
        return '';
    }

    function businessNameMatchesSearch(businessName) {
        if (!businessName) return false;
        const expectedNames = [
            getHospitalNameFromUrl(),
            String(scrapeContext.originalHospitalName || '').trim()
        ].filter(Boolean);
        if (expectedNames.length === 0) return false;
        return expectedNames.some(searchName =>
            globalThis.AAHAddressValidation.businessNameFuzzyMatches(searchName, businessName) ||
            (scrapeContext.streetAddress && globalThis.AAHAddressValidation.businessNameVariantMatches(searchName, businessName))
        );
    }

    function scoreBusinessName(label, searchQuery) {
        return globalThis.AAHAddressValidation.businessNameMatchScore(searchQuery, String(label || '').replace(/·.*$/, '').trim());
    }

    function findMatchingResults(links, searchQuery) {
        if (!searchQuery || links.length === 0) return [];
        return Array.from(links)
            .map(link => {
                const label = (link.getAttribute('aria-label') || '').replace(/·.*$/, '').trim();
                return {
                    link,
                    href: link.href || link.getAttribute('href') || '',
                    label,
                    score: scoreBusinessName(label, searchQuery)
                };
            })
            // Variants may be inspected, but only the numbered-street validator
            // can accept them. Do not discard the right panel before reading it.
            .filter(item => item.score >= 0.9 || (scrapeContext.streetAddress &&
                globalThis.AAHAddressValidation.businessNameVariantMatches(searchQuery, item.label)))
            .sort((a, b) => b.score - a.score);
    }

    function findResultLink(candidate) {
        const links = Array.from(document.querySelectorAll('a.hfpxzc'));
        return links.find(link =>
            (candidate.href && (link.href === candidate.href || link.getAttribute('href') === candidate.href)) ||
            ((link.getAttribute('aria-label') || '').replace(/·.*$/, '').trim() === candidate.label)
        ) || null;
    }

    function getExpectedLocationFromUrl() {
        if (scrapeContext.location) {
            const parts = String(scrapeContext.location).split(',').map(part => part.trim()).filter(Boolean);
            return { city: parts[0] || '', state: parts[1] || '' };
        }
        const url = window.location.href;
        const searchMatch = url.match(/\/maps\/search\/([^?#]+)/);
        if (!searchMatch) return { city: '', state: '' };
        const decoded = decodeURIComponent(searchMatch[1]).replace(/\+/g, ' ').trim();
        const parts = decoded.split(',').map(part => part.trim()).filter(Boolean);
        return { city: parts[1] || '', state: parts[2] || '' };
    }

    function normalizeForCompare(value) {
        return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    function normalizeStateForCompare(value) {
        const state = String(value || '').trim();
        if (!state) return '';
        const stateMap = {
            AL: 'alabama', AK: 'alaska', AZ: 'arizona', AR: 'arkansas', CA: 'california',
            CO: 'colorado', CT: 'connecticut', DE: 'delaware', FL: 'florida', GA: 'georgia',
            HI: 'hawaii', ID: 'idaho', IL: 'illinois', IN: 'indiana', IA: 'iowa',
            KS: 'kansas', KY: 'kentucky', LA: 'louisiana', ME: 'maine', MD: 'maryland',
            MA: 'massachusetts', MI: 'michigan', MN: 'minnesota', MS: 'mississippi', MO: 'missouri',
            MT: 'montana', NE: 'nebraska', NV: 'nevada', NH: 'new hampshire', NJ: 'new jersey',
            NM: 'new mexico', NY: 'new york', NC: 'north carolina', ND: 'north dakota', OH: 'ohio',
            OK: 'oklahoma', OR: 'oregon', PA: 'pennsylvania', RI: 'rhode island', SC: 'south carolina',
            SD: 'south dakota', TN: 'tennessee', TX: 'texas', UT: 'utah', VT: 'vermont',
            VA: 'virginia', WA: 'washington', WV: 'west virginia', WI: 'wisconsin', WY: 'wyoming',
            DC: 'district of columbia'
        };
        const upper = state.toUpperCase();
        if (stateMap[upper]) return upper;
        const normalized = normalizeForCompare(state);
        const match = Object.entries(stateMap).find(([, full]) => normalizeForCompare(full) === normalized);
        return match ? match[0] : upper;
    }

    function getHospitalNameCityCandidates() {
        const source = getHospitalNameFromUrl().replace(/\s+/g, ' ').trim();
        const candidates = [];
        const ofMatch = source.match(/\bof\s+(.+?)\s*$/i);
        if (ofMatch) candidates.push(ofMatch[1]);
        const dashMatch = source.match(/\s[-–—]\s*([^,]+?)(?:,\s*[A-Z]{2})?\s*$/i);
        if (dashMatch) candidates.push(dashMatch[1]);
        return candidates
            .map(candidate => candidate
                .replace(/\s*[-–—]\s*[^,]+,\s*[A-Z]{2}\s*$/i, '')
                .replace(/,\s*[A-Z]{2}\s*$/i, '')
                .replace(/\b(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b$/i, '')
                .replace(/\bNational\b$/i, '')
                .trim())
            .filter(Boolean);
    }

    function shouldAcceptAddressData(data) {
        const expected = getExpectedLocationFromUrl();
        return globalThis.AAHAddressValidation.validateGoogleResult(data, {
            ...scrapeContext,
            hospitalName: getHospitalNameFromUrl(),
            originalHospitalName: scrapeContext.originalHospitalName,
            location: [expected.city, expected.state].filter(Boolean).join(', ')
        }).accepted;
    }

    // ===== Extract website URL from place detail panel =====
    function getPlacePanel() {
        const title = document.querySelector('h1.DUwDvf, h1[aria-level="1"], [role="main"] h1');
        return title?.closest('[role="main"]') || document.querySelector('[role="main"]');
    }

    function tryExtractWebsite() {
        const panel = getPlacePanel();
        if (!panel) return '';
        // Method 1: data-item-id="authority" is the website link
        const websiteLink = panel.querySelector('a[data-item-id="authority"]');
        if (websiteLink) {
            const href = websiteLink.getAttribute('href') || '';
            if (href) return href;
            const ariaLabel = websiteLink.getAttribute('aria-label') || '';
            const cleaned = ariaLabel.replace(/^Website:\s*/i, '').trim();
            if (cleaned) return cleaned;
        }
        // Method 2: button with data-tooltip="Open website"
        const websiteBtn = panel.querySelector('button[data-tooltip="Open website"]');
        if (websiteBtn) {
            const ariaLabel = websiteBtn.getAttribute('aria-label') || '';
            const cleaned = ariaLabel.replace(/^Website:\s*/i, '').trim();
            if (cleaned) return cleaned;
        }
        // Method 3: any website-labelled link/button in the place panel
        const websiteFallback = panel.querySelector('a[aria-label^="Website:"], button[aria-label^="Website:"], a[data-tooltip="Open website"]');
        if (websiteFallback) {
            const href = websiteFallback.getAttribute('href') || '';
            if (href && !href.startsWith('javascript:')) return href;
            const ariaLabel = websiteFallback.getAttribute('aria-label') || '';
            const cleaned = ariaLabel.replace(/^Website:\s*/i, '').trim();
            if (cleaned) return cleaned;
        }
        return '';
    }

    // ===== Extract phone number from place detail panel =====
    function tryExtractPhone() {
        const panel = getPlacePanel();
        if (!panel) return '';
        // Method 1: button with data-item-id starting with "phone:"
        const phoneBtn = panel.querySelector('button[data-item-id^="phone:"]');
        if (phoneBtn) {
            // data-item-id="phone:tel:+1-555-123-4567" or similar
            const dataId = phoneBtn.getAttribute('data-item-id') || '';
            const phoneFromId = dataId.replace(/^phone:tel:/, '').replace(/^phone:/, '').trim();
            if (phoneFromId) return phoneFromId;
            // Fallback: aria-label
            const ariaLabel = phoneBtn.getAttribute('aria-label') || '';
            const cleaned = ariaLabel.replace(/^Phone:\s*/i, '').trim();
            if (cleaned) return cleaned;
        }
        // Method 2: look for tel: links
        const telLinks = panel.querySelectorAll('a[href^="tel:"]');
        for (const link of telLinks) {
            const phone = link.getAttribute('href').replace('tel:', '').trim();
            if (phone) return phone;
        }
        // Method 3: generic phone-labelled buttons/spans
        const phoneFallback = panel.querySelector('button[aria-label^="Phone:"], button[data-item-id*="phone"], [aria-label^="Phone:"]');
        if (phoneFallback) {
            const dataId = phoneFallback.getAttribute('data-item-id') || '';
            const phoneFromId = dataId.replace(/^phone:tel:/, '').replace(/^phone:/, '').trim();
            if (phoneFromId) return phoneFromId;
            const ariaLabel = phoneFallback.getAttribute('aria-label') || '';
            const cleaned = ariaLabel.replace(/^Phone:\s*/i, '').trim();
            if (cleaned) return cleaned;
        }
        return '';
    }

    // ===== Try to extract address from place detail panel =====
    // This works when Google Maps shows a single place view with the address button
    function tryExtractFromPlaceDetail() {
        const businessName = getBusinessNameFromPlaceDetail();
        if (businessName && !businessNameMatchesSearch(businessName)) return null;
        const panel = getPlacePanel();
        if (!panel) return null;

        // Method 1: Address button (most reliable)
        const addressButton = panel.querySelector('button[data-item-id="address"]');
        if (addressButton) {
            const ariaLabel = addressButton.getAttribute('aria-label') || '';
            const textCandidates = [
                ariaLabel,
                ...Array.from(addressButton.querySelectorAll('.Io6YTe, .rogA2c, span, div')).map(el => el.textContent || ''),
                addressButton.textContent || ''
            ];

            for (const candidate of textCandidates) {
                const result = buildAddressResult(candidate, businessName);
                if (result) return result;
            }
        }

        // Method 2: Side panel text elements with address pattern
        const infoSelectors = [
            '[data-item-id*="address"]',
            '[data-item-id="address"] .Io6YTe',
            '[data-item-id="address"] .rogA2c',
            '.Io6YTe.fontBodyMedium',
            '.LrzXr',
        ];
        for (const selector of infoSelectors) {
            const elements = panel.querySelectorAll(selector);
            for (const el of elements) {
                const result = buildAddressResult(el.textContent || el.getAttribute('aria-label') || '', businessName);
                if (result) return result;
            }
        }

        // Method 3: aria-label with full US address pattern
        const allAria = panel.querySelectorAll('[aria-label]');
        for (const el of allAria) {
            const label = el.getAttribute('aria-label') || '';
            const result = buildAddressResult(label, businessName);
            if (result) return result;
        }

        const locality = globalThis.AAHAddressValidation.extractContactLocality(panel.innerText || panel.textContent);
        return locality.city ? { businessName, ...locality, fullAddress: '',
            website: tryExtractWebsite(), phone: tryExtractPhone() } : null;
    }

    // ===== Try to extract address from page body text =====
    function tryExtractFromPageBody() {
        const businessName = getBusinessNameFromPlaceDetail();
        if (businessName && !businessNameMatchesSearch(businessName)) return null;

        const bodyText = document.body.innerText || '';
        const regex = /(\d+\s+[\w\s.'-]+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Rd|Road|Ln|Lane|Way|Ct|Court|Pl|Place|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Trl|Trail|Loop|NE|NW|SE|SW)[\w\s.,#-]*,\s*[\w\s.'-]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?)/i;
        const match = bodyText.match(regex);
        if (match) {
            const result = buildAddressResult(match[1].trim(), businessName);
            if (result) return result;
        }

        const lines = bodyText
            .split(/\n+/)
            .map(line => line.trim())
            .filter(Boolean);
        for (const line of lines) {
            const result = buildAddressResult(line, businessName);
            if (result) return result;
        }
        return null;
    }

    function buildAddressResult(rawAddress, businessName) {
        const fullAddress = cleanAddressCandidate(rawAddress);
        if (!looksLikeAddressCandidate(fullAddress)) {
            const locality = globalThis.AAHAddressValidation.extractContactLocality(fullAddress);
            return locality.city ? { businessName, ...locality, fullAddress: '',
                website: tryExtractWebsite(), phone: tryExtractPhone() } : null;
        }

        const parsed = parseAddress(fullAddress);
        if (!parsed.streetAddress) return null;

        return {
            businessName,
            fullAddress,
            ...parsed,
            website: tryExtractWebsite(),
            phone: tryExtractPhone()
        };
    }

    function cleanAddressCandidate(value) {
        return (value || '')
            .replace(/^Address\s*[:\n]\s*/i, '')
            .replace(/\b(?:Website|Phone|Call|Directions|Save|Share|Suggest an edit|Located in)\b[\s\S]*$/i, '')
            .replace(/\s+/g, ' ')
            .replace(/\s*,\s*/g, ', ')
            .replace(/,?\s*(?:United States|USA)\s*$/i, '')
            .trim();
    }

    function looksLikeAddressCandidate(value) {
        const address = cleanAddressCandidate(value);
        if (!address || !address.includes(',')) return false;
        const parsed = parseAddress(address);
        return globalThis.AAHAddressValidation.isUsableStreetAddress(parsed.streetAddress) &&
            !!parsed.city && !!globalThis.AAHAddressValidation.getStateAbbrev(parsed.state);
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

    // ===== Empty result helper =====
    function emptyResult() {
        return { businessName: '', streetAddress: '', zipCode: '', city: '', state: '', fullAddress: '', website: '', phone: '', cityMatchedHospitalName: false };
    }

    // ===== Parse a full US address string into components =====
    // Handles formats like:
    //   "4434 Frontier Trail, Austin, TX 78745"
    //   "4434 Frontier Trail, Austin, TX 78745, United States"
    //   "7600 N Capital of Texas Hwy Building B, Suite 100, Austin, TX 78731"
    //   "134 Fort Evans Rd NE Suite 100, Leesburg, VA 20176"
    function parseAddress(fullAddress) {
        if (!fullAddress) return { streetAddress: '', city: '', state: '', zipCode: '' };

        // Strip trailing ", United States" or ", USA"
        let addr = fullAddress
            .replace(/,?\s*United States\s*$/i, '')
            .replace(/,?\s*USA\s*$/i, '')
            .trim();

        // ---- Strategy 1: Match "...Street, City, ST 12345[-6789]" ----
        // The ZIP code is always at the end, preceded by a 2-letter state abbreviation
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

        // ---- Strategy 2: Find ZIP and state anywhere near the end ----
        const stateZipPattern = new RegExp(`\\b(${stateToken})\\s+(\\d{5}(?:-\\d{4})?)\\s*$`, 'i');
        const stateZipMatch = addr.match(stateZipPattern);
        if (stateZipMatch) {
            const state = stateZipMatch[1];
            const zipCode = stateZipMatch[2];
            // Everything before "ST 12345" is "Street, City" parts
            const beforeStateZip = addr
                .substring(0, addr.lastIndexOf(stateZipMatch[0]))
                .replace(/,\s*$/, '')
                .trim();
            const parts = beforeStateZip.split(',').map(s => s.trim()).filter(Boolean);
            if (parts.length >= 2) {
                const city = parts[parts.length - 1];
                const streetAddress = parts.slice(0, parts.length - 1).join(', ');
                return { streetAddress, city, state, zipCode };
            } else if (parts.length === 1) {
                return { streetAddress: parts[0], city: '', state, zipCode };
            }
            return { streetAddress: beforeStateZip, city: '', state, zipCode };
        }

        // ---- Strategy 3: No ZIP found — try to extract state only ----
        const stateOnlyPattern = new RegExp(`,\\s*(${stateToken})\\s*$`, 'i');
        const stateOnlyMatch = addr.match(stateOnlyPattern);
        if (stateOnlyMatch) {
            const state = stateOnlyMatch[1];
            const beforeState = addr.substring(0, addr.lastIndexOf(stateOnlyMatch[0])).trim();
            const parts = beforeState.split(',').map(s => s.trim()).filter(Boolean);
            if (parts.length >= 2) {
                const city = parts[parts.length - 1];
                const streetAddress = parts.slice(0, parts.length - 1).join(', ');
                return { streetAddress, city, state, zipCode: '' };
            }
            return { streetAddress: beforeState, city: '', state, zipCode: '' };
        }

        // ---- Fallback: return the raw address as street ----
        return { streetAddress: addr, city: '', state: '', zipCode: '' };
    }

})();
