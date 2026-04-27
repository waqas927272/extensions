// gemini-address-scraper.js
// Injected into Gemini to ask for hospital address/contact data and parse the response.
(async () => {
    try {
        const prompt = document.documentElement.getAttribute('data-uvc-gemini-address-prompt') || '';
        if (!prompt) return emptyResult('Missing Gemini prompt');

        const input = await waitForPromptInput();
        if (!input) return emptyResult('Gemini prompt input not found');

        await setPromptText(input, prompt);

        const sent = await submitPrompt();
        if (!sent) return emptyResult('Gemini send button not found or stayed disabled');

        const responseText = await waitForUsableResponse();
        const parsedResponse = parseGeminiResponse(responseText);
        const parsedAddress = parseAddress(parsedResponse.fullAddress || [
            parsedResponse.streetAddress,
            parsedResponse.city,
            [parsedResponse.state, parsedResponse.zipCode].filter(Boolean).join(' ')
        ].filter(Boolean).join(', '));

        return {
            fullAddress: parsedResponse.fullAddress || buildFullAddress(parsedAddress),
            streetAddress: parsedResponse.streetAddress || parsedAddress.streetAddress || '',
            city: parsedResponse.city || parsedAddress.city || '',
            state: parsedResponse.state || parsedAddress.state || '',
            zipCode: parsedResponse.zipCode || parsedAddress.zipCode || '',
            website: parsedResponse.website || '',
            phone: parsedResponse.phone || '',
            rawText: responseText || ''
        };
    } catch (error) {
        return emptyResult(error.message);
    }

    function wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function waitForPromptInput() {
        const selectors = [
            'rich-textarea div[contenteditable="true"]',
            'div[contenteditable="true"][role="textbox"]',
            'div[contenteditable="true"]',
            'textarea',
            'input[type="text"]'
        ];

        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
            for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element && isVisible(element)) return element;
            }
            await wait(500);
        }

        return null;
    }

    function isVisible(element) {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    async function setPromptText(input, prompt) {
        input.focus();
        await wait(250);

        if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
            const setter = Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value')?.set;
            if (setter) setter.call(input, prompt);
            else input.value = prompt;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return;
        }

        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(input);
        selection.removeAllRanges();
        selection.addRange(range);
        document.execCommand('insertText', false, prompt);
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }));

        if (!input.textContent || !input.textContent.includes(prompt.slice(0, 20))) {
            input.innerHTML = '';
            input.textContent = prompt;
            input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }));
        }
    }

    async function submitPrompt() {
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
            const button = findSendButton();
            if (button && !button.disabled && button.getAttribute('aria-disabled') !== 'true') {
                button.click();
                return true;
            }
            await wait(500);
        }

        const input = await waitForPromptInput();
        if (!input) return false;
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
        return true;
    }

    function findSendButton() {
        const selectors = [
            'button[aria-label*="Send"]',
            'button[aria-label*="Submit"]',
            'button[title*="Send"]',
            'button[title*="Submit"]',
            'button.send-button',
            'button[data-test-id*="send"]'
        ];

        for (const selector of selectors) {
            const button = document.querySelector(selector);
            if (button && isVisible(button)) return button;
        }

        const buttons = [...document.querySelectorAll('button')].filter(button => isVisible(button));
        return buttons.find(button => {
            const label = `${button.getAttribute('aria-label') || ''} ${button.getAttribute('title') || ''} ${button.textContent || ''}`;
            return /\b(send|submit)\b/i.test(label);
        }) || null;
    }

    async function waitForUsableResponse() {
        const deadline = Date.now() + 90000;
        let bestText = '';
        let stableText = '';
        let stableCount = 0;

        while (Date.now() < deadline) {
            await wait(1500);
            const candidateText = collectResponseText();
            if (candidateText.length > bestText.length) bestText = candidateText;

            if (candidateText === stableText && candidateText.length > 20) {
                stableCount++;
            } else {
                stableText = candidateText;
                stableCount = 0;
            }

            const parsed = parseGeminiResponse(candidateText);
            if (parsed.streetAddress && parsed.zipCode) return candidateText;
            if (/\bNOT FOUND\b/i.test(candidateText)) return candidateText;
            if (stableCount >= 3 && (parsed.streetAddress || extractAddress(candidateText))) return candidateText;
        }

        return bestText;
    }

    function collectResponseText() {
        const selectors = [
            'message-content',
            '.model-response-text',
            '.markdown',
            '[data-response-index]',
            '[id^="model-response"]',
            'div[role="article"]'
        ];

        const chunks = [];
        for (const selector of selectors) {
            for (const element of document.querySelectorAll(selector)) {
                const text = cleanText(element.innerText || element.textContent || '');
                if (text && !text.includes('Provide me the complete address of the hospital')) chunks.push(text);
            }
        }

        if (chunks.length) return chunks[chunks.length - 1];
        return cleanText(document.body.innerText || '');
    }

    function parseGeminiResponse(text) {
        const cleaned = cleanText(text || '');
        if (!cleaned || /\bNOT FOUND\b/i.test(cleaned)) return emptyParsed();

        const json = extractJsonObject(cleaned);
        if (json) {
            return {
                fullAddress: '',
                streetAddress: getAny(json, ['street_address', 'streetAddress', 'address']),
                city: getAny(json, ['city']),
                state: getAny(json, ['state']),
                zipCode: getAny(json, ['zip_code', 'zipCode', 'zipcode', 'postal_code']),
                phone: getAny(json, ['phone', 'phone_number']),
                website: normalizeWebsite(getAny(json, ['website', 'url']))
            };
        }

        const fullAddress = extractAddress(cleaned);
        const address = parseAddress(fullAddress);
        return {
            fullAddress,
            streetAddress: address.streetAddress,
            city: address.city,
            state: address.state,
            zipCode: address.zipCode,
            phone: extractPhone(cleaned),
            website: normalizeWebsite(extractWebsite(cleaned))
        };
    }

    function extractJsonObject(text) {
        const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
        const raw = codeBlock ? codeBlock[1] : text;
        const match = raw.match(/\{[\s\S]*\}/);
        if (!match) return null;

        try {
            return JSON.parse(match[0]);
        } catch {
            return null;
        }
    }

    function getAny(object, keys) {
        for (const key of keys) {
            const value = object?.[key];
            if (typeof value === 'string' && value.trim()) return value.trim();
        }
        return '';
    }

    function extractAddress(text) {
        const cleaned = cleanText(text || '');
        if (!cleaned || /\bNOT FOUND\b/i.test(cleaned)) return '';

        const patterns = [
            /(\d{1,6}\s+[\w\s.'#&/-]+?(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Rd|Road|Ln|Lane|Way|Ct|Court|Pl|Place|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Trl|Trail|Loop|Ter|Terrace|NE|NW|SE|SW)[\w\s.,#&/-]*?,\s*[\w\s.'-]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?)/i,
            /(?:street_address|address)\s*["':-]+\s*([^"\n]+?\b[A-Z]{2}\s+\d{5}(?:-\d{4})?)/i
        ];

        for (const pattern of patterns) {
            const match = cleaned.match(pattern);
            if (match) return normalizeAddress(match[1]);
        }

        return '';
    }

    function extractPhone(text) {
        const match = cleanText(text || '').match(/(?:phone|telephone)\s*["':-]+\s*(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/i)
            || cleanText(text || '').match(/\b(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/);
        return match ? match[1] || match[0] : '';
    }

    function extractWebsite(text) {
        const match = cleanText(text || '').match(/https?:\/\/[^\s"'<>]+/i)
            || cleanText(text || '').match(/(?:website|url)\s*["':-]+\s*([a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s"']*)?)/i);
        return match ? match[1] || match[0] : '';
    }

    function normalizeWebsite(value) {
        const website = (value || '').trim().replace(/[),.]+$/g, '');
        if (!website) return '';
        if (/^https?:\/\//i.test(website)) return website;
        return `https://${website}`;
    }

    function normalizeAddress(address) {
        return (address || '')
            .replace(/\s+/g, ' ')
            .replace(/\s*,\s*/g, ', ')
            .replace(/\s+(?:United States|USA)\s*$/i, '')
            .replace(/\s+(?:Source|Website|Phone|Directions).*$/i, '')
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

    function buildFullAddress(address) {
        if (!address.streetAddress) return '';
        return [
            address.streetAddress,
            address.city,
            [address.state, address.zipCode].filter(Boolean).join(' ')
        ].filter(Boolean).join(', ');
    }

    function cleanText(text) {
        return (text || '')
            .replace(/\u00a0/g, ' ')
            .replace(/[ \t]+/g, ' ')
            .replace(/\n{2,}/g, '\n')
            .trim();
    }

    function emptyParsed() {
        return { fullAddress: '', streetAddress: '', city: '', state: '', zipCode: '', phone: '', website: '' };
    }

    function emptyResult(error = '') {
        return { streetAddress: '', zipCode: '', city: '', state: '', fullAddress: '', website: '', phone: '', rawText: '', error };
    }
})();
