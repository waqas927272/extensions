// google-maps-scraper.js
// Injected into a Google Maps search page to extract business address data.
(async () => {
    try {
        const MAX_WAIT = 15000;
        const POLL = 500;
        const startTime = Date.now();
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

        let addressData = null;

        while (Date.now() - startTime < MAX_WAIT) {
            addressData = tryExtractFromPlaceDetail();
            if (addressData) return addressData;

            const resultLinks = document.querySelectorAll('a.hfpxzc');
            if (resultLinks.length > 0) {
                break;
            }

            await wait(POLL);
        }

        if (addressData) return addressData;

        const hospitalName = getHospitalNameFromUrl();
        const resultLinks = document.querySelectorAll('a.hfpxzc');
        if (resultLinks.length === 0) {
            return emptyResult();
        }

        const targetLink = findBestMatch(resultLinks, hospitalName) || resultLinks[0];
        if (!targetLink) return emptyResult();

        targetLink.click();

        const remainingTime = MAX_WAIT - (Date.now() - startTime);
        const phase3End = Date.now() + Math.max(remainingTime, 5000);

        while (Date.now() < phase3End) {
            await wait(POLL);

            addressData = tryExtractFromPlaceDetail();
            if (addressData) return addressData;
        }

        return tryExtractFromPageBody() || emptyResult();
    } catch (error) {
        return {
            streetAddress: '',
            zipCode: '',
            city: '',
            state: '',
            fullAddress: '',
            website: '',
            phone: '',
            error: error.message
        };
    }

    function getHospitalNameFromUrl() {
        const url = window.location.href;
        const searchMatch = url.match(/\/maps\/search\/([^?#]+)/);
        if (!searchMatch) return '';

        const decoded = decodeURIComponent(searchMatch[1]).replace(/\+/g, ' ').trim();
        const quotedMatch = decoded.match(/"([^"]+)"/);
        if (quotedMatch) {
            return quotedMatch[1].trim();
        }

        return decoded.split(',')[0].trim();
    }

    function normalizeName(value) {
        return (value || '')
            .toLowerCase()
            .replace(/&/g, 'and')
            .replace(/[^a-z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function stripLocationTail(value) {
        return normalizeName(value)
            .replace(/\b(of|at)\s+[a-z0-9\s]+$/, '')
            .trim();
    }

    function findBestMatch(links, searchQuery) {
        if (!searchQuery || links.length === 0) return null;

        const queryNorm = normalizeName(searchQuery);
        const queryBase = stripLocationTail(searchQuery);
        const queryWords = queryNorm.split(' ').filter((word) => word.length > 2);

        let bestLink = null;
        let bestScore = 0;

        for (const link of links) {
            const label = (link.getAttribute('aria-label') || '')
                .replace(/Ã‚Â·.*$/, '')
                .replace(/Â·.*$/, '')
                .trim();
            const labelNorm = normalizeName(label);
            const labelBase = stripLocationTail(label);

            if (labelNorm === queryNorm || (queryBase && labelBase === queryBase)) {
                return link;
            }

            let matchCount = 0;
            for (const word of queryWords) {
                if (labelNorm.includes(word)) {
                    matchCount++;
                }
            }

            let score = queryWords.length > 0 ? matchCount / queryWords.length : 0;
            if (queryBase && labelBase === queryBase) {
                score = 1;
            } else if (queryBase && labelBase.includes(queryBase)) {
                score = Math.max(score, 0.8);
            }

            if (score > bestScore) {
                bestScore = score;
                bestLink = link;
            }
        }

        return bestScore >= 0.6 ? bestLink : null;
    }

    function tryExtractWebsite() {
        const websiteSelectors = [
            'a[data-item-id="authority"]',
            'a[data-item-id*="authority"]',
            'a[aria-label^="Website:"]',
            'button[data-tooltip="Open website"]',
            'button[aria-label^="Website:"]'
        ];

        for (const selector of websiteSelectors) {
            const websiteEl = document.querySelector(selector);
            if (!websiteEl) continue;

            const href = websiteEl.getAttribute('href') || '';
            if (href) return href;

            const ariaLabel = websiteEl.getAttribute('aria-label') || '';
            const cleaned = ariaLabel.replace(/^Website:\s*/i, '').trim();
            if (cleaned) return cleaned;
        }

        return '';
    }

    function tryExtractPhone() {
        const phoneSelectors = [
            'button[data-item-id^="phone:"]',
            'button[data-item-id*="phone"]',
            'button[aria-label^="Phone:"]'
        ];

        for (const selector of phoneSelectors) {
            const phoneBtn = document.querySelector(selector);
            if (!phoneBtn) continue;

            const dataId = phoneBtn.getAttribute('data-item-id') || '';
            const phoneFromId = dataId.replace(/^phone:tel:/, '').replace(/^phone:/, '').trim();
            if (phoneFromId) return phoneFromId;

            const ariaLabel = phoneBtn.getAttribute('aria-label') || '';
            const cleaned = ariaLabel.replace(/^Phone:\s*/i, '').trim();
            if (cleaned) return cleaned;
        }

        const telLinks = document.querySelectorAll('a[href^="tel:"]');
        for (const link of telLinks) {
            const phone = (link.getAttribute('href') || '').replace('tel:', '').trim();
            if (phone) return phone;
        }

        return '';
    }

    function hasUsefulPlaceData(result) {
        return Boolean(result && (result.streetAddress || result.fullAddress || result.phone || result.website));
    }

    function enrichPlaceResult(fullAddress) {
        const result = { fullAddress: fullAddress || '' };
        Object.assign(result, parseAddress(fullAddress));
        result.website = tryExtractWebsite();
        result.phone = tryExtractPhone();
        return hasUsefulPlaceData(result) ? result : null;
    }

    function tryExtractFromPlaceDetail() {
        const addressButton = document.querySelector('button[data-item-id="address"]');
        if (addressButton) {
            const ariaLabel = addressButton.getAttribute('aria-label') || '';
            const textContent = (addressButton.textContent || '').trim();
            const fullAddress = ariaLabel.replace(/^Address:\s*/i, '').trim() || textContent;
            if (fullAddress && /\d/.test(fullAddress)) {
                const result = enrichPlaceResult(fullAddress);
                if (result) return result;
            }
        }

        const infoSelectors = [
            '[data-item-id="address"] .Io6YTe',
            '[data-item-id="address"] .rogA2c',
            '.Io6YTe.fontBodyMedium',
            '.LrzXr'
        ];

        for (const selector of infoSelectors) {
            const elements = document.querySelectorAll(selector);
            for (const el of elements) {
                const text = (el.textContent || '').trim();
                if (/\b[A-Z]{2}\s+\d{5}/.test(text) && /\d+\s+\w/.test(text)) {
                    const result = enrichPlaceResult(text);
                    if (result) return result;
                }
            }
        }

        const allAria = document.querySelectorAll('[aria-label]');
        for (const el of allAria) {
            const label = el.getAttribute('aria-label') || '';
            if (/\d+\s+[\w\s]+,\s*[\w\s]+,\s*[A-Z]{2}\s+\d{5}/.test(label)) {
                const clean = label.replace(/^Address:\s*/i, '').trim();
                const result = enrichPlaceResult(clean);
                if (result) return result;
            }
        }

        const partialResult = {
            streetAddress: '',
            zipCode: '',
            city: '',
            state: '',
            fullAddress: '',
            website: tryExtractWebsite(),
            phone: tryExtractPhone()
        };
        return hasUsefulPlaceData(partialResult) ? partialResult : null;
    }

    function tryExtractFromPageBody() {
        const bodyText = document.body.innerText || '';
        const regex = /(\d+\s+[\w\s.'-]+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Rd|Road|Ln|Lane|Way|Ct|Court|Pl|Place|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Trl|Trail|Loop|NE|NW|SE|SW)[\w\s.,#-]*,\s*[\w\s.'-]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?)/i;
        const match = bodyText.match(regex);
        if (!match) return null;

        return enrichPlaceResult(match[1].trim());
    }

    function emptyResult() {
        return { streetAddress: '', zipCode: '', city: '', state: '', fullAddress: '', website: '', phone: '' };
    }

    function parseAddress(fullAddress) {
        if (!fullAddress) return { streetAddress: '', city: '', state: '', zipCode: '' };

        const addr = fullAddress
            .replace(/,?\s*United States\s*$/i, '')
            .replace(/,?\s*USA\s*$/i, '')
            .trim();

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
        if (stateZipMatch) {
            const state = stateZipMatch[1];
            const zipCode = stateZipMatch[2];
            const beforeStateZip = addr
                .substring(0, addr.lastIndexOf(stateZipMatch[0]))
                .replace(/,\s*$/, '')
                .trim();
            const parts = beforeStateZip.split(',').map((part) => part.trim()).filter(Boolean);
            if (parts.length >= 2) {
                return {
                    streetAddress: parts.slice(0, parts.length - 1).join(', '),
                    city: parts[parts.length - 1],
                    state,
                    zipCode
                };
            }
            if (parts.length === 1) {
                return { streetAddress: parts[0], city: '', state, zipCode };
            }
            return { streetAddress: beforeStateZip, city: '', state, zipCode };
        }

        const stateOnlyPattern = /,\s*([A-Z]{2})\s*$/;
        const stateOnlyMatch = addr.match(stateOnlyPattern);
        if (stateOnlyMatch) {
            const state = stateOnlyMatch[1];
            const beforeState = addr.substring(0, addr.lastIndexOf(stateOnlyMatch[0])).trim();
            const parts = beforeState.split(',').map((part) => part.trim()).filter(Boolean);
            if (parts.length >= 2) {
                return {
                    streetAddress: parts.slice(0, parts.length - 1).join(', '),
                    city: parts[parts.length - 1],
                    state,
                    zipCode: ''
                };
            }
            return { streetAddress: beforeState, city: '', state, zipCode: '' };
        }

        return { streetAddress: addr, city: '', state: '', zipCode: '' };
    }
})();
