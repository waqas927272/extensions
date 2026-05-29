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
    try {
        const MAX_WAIT = 15000;   // 15 seconds max total
        const POLL = 500;         // Check every 500ms
        const startTime = Date.now();

        // Helper: wait ms
        const wait = (ms) => new Promise(r => setTimeout(r, ms));

        // ============================================================
        // PHASE 1: Wait for Google Maps to load something meaningful
        // Either a single place detail OR a search results list
        // ============================================================
        let addressData = null;

        while (Date.now() - startTime < MAX_WAIT) {
            // Check if we're on a single place page (address button exists)
            addressData = tryExtractFromPlaceDetail();
            if (addressData) return addressData;

            // Check if search results list has loaded
            const resultLinks = document.querySelectorAll('a.hfpxzc');
            if (resultLinks.length > 0) {
                // Results list is loaded — go to Phase 2
                break;
            }

            await wait(POLL);
        }

        // If we already got address data from place detail, return it
        if (addressData) return addressData;

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

        // Find best matching result
        const bestMatch = findBestMatch(resultLinks, hospitalName);
        if (!bestMatch) {
            console.log('No acceptable Maps result match found; skipping first-result fallback');
            return emptyResult();
        }

        const targetLink = bestMatch;
        console.log(`Clicking result: "${targetLink.getAttribute('aria-label')}"`);

        // Click the matching result to open place details
        targetLink.click();

        // ============================================================
        // PHASE 3: Wait for place detail panel to load after clicking
        // Look for the address button to appear
        // ============================================================
        const remainingTime = MAX_WAIT - (Date.now() - startTime);
        const phase3End = Date.now() + Math.max(remainingTime, 5000); // At least 5s more

        while (Date.now() < phase3End) {
            await wait(POLL);

            addressData = tryExtractFromPlaceDetail();
            if (addressData) return addressData;
        }

        // Last resort: try extracting from whatever is on the page now
        return tryExtractFromPageBody() || emptyResult();

    } catch (e) {
        return { streetAddress: '', zipCode: '', city: '', state: '', fullAddress: '', website: '', phone: '', error: e.message };
    }

    // ===== Extract hospital name from the Google Maps URL query =====
    // URL format: https://www.google.com/maps/search/Hospital+Name+City+State
    function getHospitalNameFromUrl() {
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
    function findBestMatch(links, searchQuery) {
        if (!searchQuery || links.length === 0) return null;

        const stopWords = new Set(['the', 'and', 'for', 'with', 'of', 'at', 'in', 'veterinary', 'animal', 'pet']);
        const facilityWords = new Set(['hospital', 'clinic', 'center', 'centre']);

        // Normalize for comparison: lowercase, remove special chars
        const normalize = (str) => str.toLowerCase()
            .replace(/&/g, 'and')
            .replace(/\bcentre\b/g, 'center')
            .replace(/[^a-z0-9\s]/g, '')
            .replace(/\s+/g, ' ')
            .trim();

        const queryNorm = normalize(searchQuery);
        const queryWords = queryNorm.split(' ').filter(w => w.length > 2 && !stopWords.has(w) && !facilityWords.has(w));
        const queryHasFacilityWord = queryNorm.split(' ').some(w => facilityWords.has(w));

        let bestLink = null;
        let bestScore = 0;

        for (const link of links) {
            const label = (link.getAttribute('aria-label') || '').replace(/·.*$/, '').trim();
            const normalizedLabel = label.split(',')[0].trim();
            const labelNorm = normalize(normalizedLabel);
            if (isLivewellQuery(searchQuery) && !labelNorm.includes('livewell')) {
                continue;
            }
            const cardText = normalize(link.closest('article, [role="article"], .Nv2PK, .bfdHYd')?.textContent || '');
            const haystack = `${labelNorm} ${cardText}`.trim();
            const haystackWords = new Set(haystack.split(' ').filter(w => w.length > 2 && !stopWords.has(w)));
            const haystackHasFacilityWord = haystack.split(' ').some(w => facilityWords.has(w));

            // Count how many query words appear in the label
            let matchCount = 0;
            for (const word of queryWords) {
                if (haystack.includes(word) || haystackWords.has(word)) {
                    matchCount++;
                }
            }

            // Score = percentage of query words that matched, with small boosts for close name matches
            let score = queryWords.length > 0 ? matchCount / queryWords.length : 0;
            if (labelNorm === queryNorm) score += 0.5;
            if (labelNorm.startsWith(queryNorm) || queryNorm.startsWith(labelNorm)) score += 0.2;
            if (queryHasFacilityWord && haystackHasFacilityWord) score += 0.1;

            if (score > bestScore) {
                bestScore = score;
                bestLink = link;
            }
        }

        return bestScore >= 0.34 ? bestLink : null;
    }

    function isLivewellQuery(value) {
        return /\blivewell\b/i.test(value || '');
    }

    function tryExtractBusinessName() {
        const selectors = [
            'h1.DUwDvf',
            'h1',
            '[role="main"] h1',
            '[aria-level="1"][role="heading"]'
        ];

        for (const selector of selectors) {
            const element = document.querySelector(selector);
            const text = (element?.textContent || '').trim();
            if (text) return text;
        }

        return '';
    }

    // ===== Extract website URL from place detail panel =====
    function tryExtractWebsite() {
        // Method 1: data-item-id="authority" is the website link
        const websiteLink = document.querySelector('a[data-item-id="authority"]');
        if (websiteLink) {
            const href = websiteLink.getAttribute('href') || '';
            if (href) return href;
            const ariaLabel = websiteLink.getAttribute('aria-label') || '';
            const cleaned = ariaLabel.replace(/^Website:\s*/i, '').trim();
            if (cleaned) return cleaned;
        }
        // Method 2: button with data-tooltip="Open website"
        const websiteBtn = document.querySelector('button[data-tooltip="Open website"]');
        if (websiteBtn) {
            const ariaLabel = websiteBtn.getAttribute('aria-label') || '';
            const cleaned = ariaLabel.replace(/^Website:\s*/i, '').trim();
            if (cleaned) return cleaned;
        }
        // Method 3: any website-labelled link/button in the place panel
        const websiteFallback = document.querySelector('a[aria-label^="Website:"], button[aria-label^="Website:"], a[data-tooltip="Open website"]');
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
        // Method 1: button with data-item-id starting with "phone:"
        const phoneBtn = document.querySelector('button[data-item-id^="phone:"]');
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
        const telLinks = document.querySelectorAll('a[href^="tel:"]');
        for (const link of telLinks) {
            const phone = link.getAttribute('href').replace('tel:', '').trim();
            if (phone) return phone;
        }
        // Method 3: generic phone-labelled buttons/spans
        const phoneFallback = document.querySelector('button[aria-label^="Phone:"], button[data-item-id*="phone"], [aria-label^="Phone:"]');
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
        // Method 1: Address button (most reliable)
        const addressButton = document.querySelector('button[data-item-id="address"]');
        if (addressButton) {
            const ariaLabel = addressButton.getAttribute('aria-label') || '';
            const textContent = addressButton.textContent.trim();
            let fullAddress = ariaLabel.replace(/^Address:\s*/i, '').trim() || textContent;
            if (fullAddress && /\d/.test(fullAddress)) {
                const result = { fullAddress };
                Object.assign(result, parseAddress(fullAddress));
                result.businessName = tryExtractBusinessName();
                // Also extract website and phone while we're on the detail panel
                result.website = tryExtractWebsite();
                result.phone = tryExtractPhone();
                if (result.streetAddress) return result;
            }
        }

        // Method 2: Side panel text elements with address pattern
        const infoSelectors = [
            '[data-item-id="address"] .Io6YTe',
            '[data-item-id="address"] .rogA2c',
            '.Io6YTe.fontBodyMedium',
            '.LrzXr',
        ];
        for (const selector of infoSelectors) {
            const elements = document.querySelectorAll(selector);
            for (const el of elements) {
                const text = el.textContent.trim();
                if (/\b[A-Z]{2}\s+\d{5}/.test(text) && /\d+\s+\w/.test(text)) {
                    const result = { fullAddress: text };
                    Object.assign(result, parseAddress(text));
                    result.businessName = tryExtractBusinessName();
                    result.website = tryExtractWebsite();
                    result.phone = tryExtractPhone();
                    if (result.streetAddress) return result;
                }
            }
        }

        // Method 3: aria-label with full US address pattern
        const allAria = document.querySelectorAll('[aria-label]');
        for (const el of allAria) {
            const label = el.getAttribute('aria-label') || '';
            if (/\d+\s+[\w\s]+,\s*[\w\s]+,\s*[A-Z]{2}\s+\d{5}/.test(label)) {
                const clean = label.replace(/^Address:\s*/i, '').trim();
                const result = { fullAddress: clean };
                Object.assign(result, parseAddress(clean));
                result.businessName = tryExtractBusinessName();
                result.website = tryExtractWebsite();
                result.phone = tryExtractPhone();
                if (result.streetAddress) return result;
            }
        }

        return null;
    }

    // ===== Try to extract address from page body text =====
    function tryExtractFromPageBody() {
        const bodyText = document.body.innerText || '';
        const regex = /(\d+\s+[\w\s.'-]+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Rd|Road|Ln|Lane|Way|Ct|Court|Pl|Place|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Trl|Trail|Loop|NE|NW|SE|SW)[\w\s.,#-]*,\s*[\w\s.'-]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?)/i;
        const match = bodyText.match(regex);
        if (match) {
            const result = { fullAddress: match[1].trim() };
            Object.assign(result, parseAddress(result.fullAddress));
            result.businessName = tryExtractBusinessName();
            result.website = tryExtractWebsite();
            result.phone = tryExtractPhone();
            if (result.streetAddress) return result;
        }
        return null;
    }

    // ===== Empty result helper =====
    function emptyResult() {
        return { businessName: '', streetAddress: '', zipCode: '', city: '', state: '', fullAddress: '', website: '', phone: '' };
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

        // ---- Strategy 2: Find ZIP and state anywhere near the end ----
        const stateZipPattern = /\b([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/;
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
        const stateOnlyPattern = /,\s*([A-Z]{2})\s*$/;
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
