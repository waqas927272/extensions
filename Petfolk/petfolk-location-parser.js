(() => {
    const PETFOLK_ORIGIN = 'https://petfolk.com';

    function extractBalancedJsonObject(source, startIndex) {
        let depth = 0;
        let inString = false;
        let escaped = false;

        for (let index = startIndex; index < source.length; index++) {
            const char = source[index];

            if (inString) {
                if (escaped) escaped = false;
                else if (char === '\\') escaped = true;
                else if (char === '"') inString = false;
                continue;
            }

            if (char === '"') inString = true;
            else if (char === '{') depth++;
            else if (char === '}') {
                depth--;
                if (depth === 0) return source.slice(startIndex, index + 1);
            }
        }

        return '';
    }

    function decodeNextFlightPayload(html = '') {
        const chunks = [];
        const pattern = /self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/gi;
        let match;

        while ((match = pattern.exec(html)) !== null) {
            try {
                const payload = JSON.parse(match[1]);
                if (typeof payload?.[1] === 'string') chunks.push(payload[1]);
            } catch (_) {
                // Ignore unrelated or malformed Next.js flight chunks.
            }
        }

        return chunks.join('\n');
    }

    function extractRegionUrls(html = '') {
        const urls = new Set();
        const pattern = /\bhref\s*=\s*["']([^"']+)["']/gi;
        let match;

        while ((match = pattern.exec(html)) !== null) {
            try {
                const url = new URL(match[1], PETFOLK_ORIGIN);
                if (url.origin !== PETFOLK_ORIGIN) continue;
                if (!/^\/locations\/[^/]+\/?$/i.test(url.pathname)) continue;
                url.search = '';
                url.hash = '';
                urls.add(url.href.replace(/\/$/, ''));
            } catch (_) {
                // Ignore invalid href values.
            }
        }

        return [...urls];
    }

    function extractRegionLocations(html = '', fallbackDmaSlug = '') {
        const sourceText = `${html}\n${decodeNextFlightPayload(html)}`;
        const marker = '{"__typename":"LocationsPetCareCenter"';
        const locations = [];
        const seen = new Set();
        let cursor = 0;

        while (cursor < sourceText.length) {
            const startIndex = sourceText.indexOf(marker, cursor);
            if (startIndex === -1) break;

            const rawJson = extractBalancedJsonObject(sourceText, startIndex);
            cursor = startIndex + Math.max(rawJson.length, marker.length);
            if (!rawJson) continue;

            try {
                const source = JSON.parse(rawJson);
                const address = source.address || {};
                const dmaSlug = source.dma?.slug || fallbackDmaSlug || '';
                const key = `${dmaSlug}|${source.slug || source.id || source.name || ''}`.toLowerCase();
                if (seen.has(key)) continue;
                seen.add(key);

                locations.push({
                    id: source.id || '',
                    name: source.name || '',
                    slug: source.slug || '',
                    status: source.statusDisplayName || source.status || '',
                    dmaSlug,
                    address: {
                        line1: address.line1 || '',
                        line2: address.line2 || '',
                        city: address.city || '',
                        state: address.state || '',
                        zip: address.zip || '',
                        oneLineDisplay: address.oneLineDisplay || ''
                    },
                    phone: source.phoneNumber?.formattedNumber || ''
                });
            } catch (_) {
                // Continue scanning if one embedded record is malformed.
            }
        }

        return locations;
    }

    function findLocationEntity(value, seen = new Set()) {
        if (!value || typeof value !== 'object' || seen.has(value)) return null;
        seen.add(value);

        if (Array.isArray(value)) {
            for (const item of value) {
                const match = findLocationEntity(item, seen);
                if (match) return match;
            }
            return null;
        }

        const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
        if (value.address && types.some(type => /^(?:VeterinaryCare|LocalBusiness|MedicalBusiness)$/i.test(type || ''))) {
            return value;
        }

        for (const child of Object.values(value)) {
            const match = findLocationEntity(child, seen);
            if (match) return match;
        }

        return null;
    }

    function extractLocationPageDetails(html = '') {
        const pattern = /<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
        let match;

        while ((match = pattern.exec(html)) !== null) {
            try {
                const parsed = JSON.parse(match[1].trim());
                const entity = findLocationEntity(parsed);
                if (!entity) continue;

                const address = entity.address || {};
                return {
                    businessName: entity.name || '',
                    streetAddress: address.streetAddress || '',
                    city: address.addressLocality || '',
                    state: address.addressRegion || '',
                    zipCode: address.postalCode || '',
                    phone: entity.telephone || '',
                    website: entity.url || ''
                };
            } catch (_) {
                // Ignore non-JSON or unrelated structured-data scripts.
            }
        }

        return null;
    }

    globalThis.PetfolkLocationParser = {
        extractRegionUrls,
        extractRegionLocations,
        extractLocationPageDetails
    };
})();
