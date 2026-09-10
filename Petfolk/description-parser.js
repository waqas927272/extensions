(() => {
    const HTML_ENTITIES = {
        amp: '&',
        apos: "'",
        gt: '>',
        hellip: '…',
        ldquo: '“',
        lsquo: '‘',
        lt: '<',
        mdash: '—',
        nbsp: ' ',
        ndash: '–',
        quot: '"',
        rdquo: '”',
        rsquo: '’'
    };

    function decodeHtmlEntities(value) {
        return (value || '').replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code) => {
            if (code[0] === '#') {
                const radix = code[1]?.toLowerCase() === 'x' ? 16 : 10;
                const numberText = radix === 16 ? code.slice(2) : code.slice(1);
                const codePoint = Number.parseInt(numberText, radix);
                if (Number.isFinite(codePoint)) {
                    try {
                        return String.fromCodePoint(codePoint);
                    } catch (_) {
                        return entity;
                    }
                }
            }

            return HTML_ENTITIES[code.toLowerCase()] ?? entity;
        });
    }

    function normalizeWhitespace(value) {
        return decodeHtmlEntities(value).replace(/\s+/g, ' ').trim();
    }

    function normalizeMultilineText(value) {
        const lines = decodeHtmlEntities(value)
            .replace(/\r/g, '')
            .split('\n')
            .map(line => line.replace(/[ \t]+/g, ' ').trim());
        const cleanedLines = [];
        let previousBlank = false;

        for (const line of lines) {
            if (!line) {
                if (!previousBlank && cleanedLines.length) cleanedLines.push('');
                previousBlank = true;
                continue;
            }

            cleanedLines.push(line);
            previousBlank = false;
        }

        while (cleanedLines[cleanedLines.length - 1] === '') cleanedLines.pop();
        return cleanedLines.join('\n').trim();
    }

    function htmlToText(html) {
        return normalizeMultilineText((html || '')
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/(?:p|div|li|ul|ol|h[1-6]|section|article)>/gi, '\n')
            .replace(/<(?:p|div|li|ul|ol|h[1-6]|section|article)(?:\s[^>]*)?>/gi, '\n')
            .replace(/<[^>]*>/g, ''));
    }

    function flattenDescriptionValue(value, seen = new Set()) {
        if (!value) return '';
        if (typeof value === 'string') return value;
        if (typeof value !== 'object' || seen.has(value)) return '';
        seen.add(value);

        if (Array.isArray(value)) {
            return value.map(item => flattenDescriptionValue(item, seen)).filter(Boolean).join('\n');
        }

        const preferredKeys = [
            'html', 'text', 'value', 'content', 'body', 'description',
            'descriptionHtml', 'jobDescription', 'jobDescriptionHtml'
        ];
        const remainingKeys = Object.keys(value).filter(key => !preferredKeys.includes(key));
        return [...preferredKeys, ...remainingKeys]
            .map(key => flattenDescriptionValue(value[key], seen))
            .filter(Boolean)
            .join('\n');
    }

    function getDescriptionPart(description, key) {
        const part = description?.[key] || '';
        return htmlToText(typeof part === 'string' ? part : flattenDescriptionValue(part));
    }

    function getLocationParts(location) {
        if (location && typeof location === 'object') {
            const city = normalizeWhitespace(location.city || '');
            const state = normalizeWhitespace(location.stateCode || location.state || '');
            const name = normalizeWhitespace(location.name || '');
            return { city: city || name, state };
        }

        const parts = normalizeWhitespace(String(location || ''))
            .split(',')
            .map(part => part.trim())
            .filter(Boolean);
        return { city: parts[0] || '', state: parts[1] || '' };
    }

    function formatLocationLine(location) {
        const { city, state } = getLocationParts(location);
        return city && state ? `${city}, ${state}` : city;
    }

    function inferLocationGroup(locations) {
        const cities = locations.map(location => getLocationParts(location).city.toLowerCase()).filter(Boolean);
        const dallasCities = ['allen', 'flower mound', 'frisco', 'lakewood', 'mansfield', 'north dallas', 'southlake', 'dallas'];
        if (cities.some(city => dallasCities.includes(city))) return 'Dallas';

        const states = locations.map(location => getLocationParts(location).state).filter(Boolean);
        const uniqueStates = [...new Set(states)];
        return uniqueStates.length === 1 ? uniqueStates[0] : '';
    }

    function formatLocationBlock(locations) {
        if (!Array.isArray(locations) || locations.length <= 1) return '';
        const lines = locations.map(formatLocationLine).filter(Boolean);
        if (!lines.length) return '';

        const group = inferLocationGroup(locations);
        return `${lines.length}${group ? ` ${group}` : ''} Locations:\n\n${lines.join('\n')}`;
    }

    function formatDescription(jobPost, apiData) {
        const description = jobPost?.description;
        if (!description) return '';
        if (typeof description !== 'object') return htmlToText(description);

        const company = getDescriptionPart(description, 'company');
        let role = getDescriptionPart(description, 'role').replace(/^Description\s*/i, '').trim();
        const requirements = getDescriptionPart(description, 'requirements');
        const benefits = getDescriptionPart(description, 'benefits');
        const legal = getDescriptionPart(description, 'legal');
        const locations = Array.isArray(jobPost.workLocations)
            ? jobPost.workLocations
            : (Array.isArray(apiData?.workLocations) ? apiData.workLocations : []);
        const locationBlock = formatLocationBlock(locations);
        const roleHasLocationBlock = /\b\d+\s+(?:.+?\s+)?Locations:\s*/i.test(role);

        if (roleHasLocationBlock && locationBlock) {
            role = role.replace(/\b\d+\s+(?:.+?\s+)?Locations:\s*\n[\s\S]*$/i, locationBlock);
        }

        const sections = [];
        if (company) sections.push(company);
        if (role) sections.push(`Description\n${role}`);
        if (locationBlock && !roleHasLocationBlock) sections.push(locationBlock);
        if (requirements) sections.push(/^Requirements\b/i.test(requirements) ? requirements : `Requirements\n${requirements}`);
        if (benefits) sections.push(/^Benefits\b/i.test(benefits) ? benefits : `Benefits\n${benefits}`);
        if (legal) sections.push(legal);

        return normalizeMultilineText(sections.join('\n\n'));
    }

    function extractFromHtml(html, expectedJobId = '') {
        const nextDataMatch = (html || '').match(
            /<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
        );
        if (!nextDataMatch) throw new Error('The job page did not contain __NEXT_DATA__.');

        const nextData = JSON.parse(nextDataMatch[1]);
        const apiData = nextData?.props?.pageProps?.apiData;
        const jobPost = apiData?.jobPost;
        if (!jobPost || typeof jobPost !== 'object') {
            throw new Error('The job page did not contain a Rippling job record.');
        }

        const actualJobId = String(jobPost.uuid || jobPost.id || jobPost.jobId || '');
        if (expectedJobId && actualJobId && expectedJobId !== actualJobId) {
            throw new Error(`Job page mismatch: expected ${expectedJobId}, found ${actualJobId}.`);
        }

        const description = formatDescription(jobPost, apiData);
        if (!description) throw new Error('The job page did not contain a usable description.');
        return description;
    }

    globalThis.PetfolkDescriptionParser = { extractFromHtml };
})();
