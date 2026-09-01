(function initializeSmartRecruitersPosting(root, factory) {
    const api = factory();
    root.AAHSmartRecruitersPosting = api;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
    function cleanText(value) {
        return String(value || '')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;|&#x27;/gi, "'")
            .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
            .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
            .replace(/\u00a0/g, ' ')
            .replace(/[ \t]+/g, ' ')
            .replace(/\s+\n/g, '\n')
            .replace(/\n\s+/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    function htmlToText(value) {
        return cleanText(
            String(value || '')
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<li\b[^>]*>/gi, '- ')
                .replace(/<\/(?:p|div|li|h[1-6]|section|article|ul|ol|table|tr)>/gi, '\n')
                .replace(/<[^>]+>/g, ' ')
        );
    }

    function getPostingApiUrl(jobUrl) {
        let parsed;
        try {
            parsed = new URL(jobUrl);
        } catch (_) {
            return '';
        }
        if (!/(?:^|\.)smartrecruiters\.com$/i.test(parsed.hostname)) return '';
        const parts = parsed.pathname.split('/').filter(Boolean);
        const idIndex = parts.findIndex(part => /^\d{10,}/.test(part));
        if (idIndex < 1) return '';
        const company = parts[idIndex - 1];
        const id = (parts[idIndex].match(/^\d{10,}/) || [])[0];
        if (!/^[A-Za-z0-9_-]+$/.test(company) || !id) return '';
        return `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings/${id}`;
    }

    function countryName(value) {
        const code = cleanText(value).toLowerCase();
        if (code === 'us' || code === 'usa') return 'United States';
        return cleanText(value);
    }

    function normalizeEmploymentType(value) {
        const label = cleanText(value?.label || value).toLowerCase();
        if (!label) return '';
        if (/\bcontract(?:or)?\b/.test(label)) return 'Contract';
        if (/\btemporary\b|\btemp\b/.test(label)) return 'Temporary';
        if (/\binternship\b|\bintern\b/.test(label)) return 'Internship';
        if (/\bpart[\s-]*time\b/.test(label)) return 'Part-Time';
        if (/\bfull[\s-]*time\b/.test(label)) return 'Full-Time';
        return cleanText(value?.label || value);
    }

    function normalizeWebsiteCandidate(value) {
        let candidate = cleanText(value)
            .replace(/^[('"\[]+/, '')
            .replace(/[)'"\].,;:!?]+$/, '');
        if (!candidate) return '';
        if (/^www\./i.test(candidate)) candidate = `https://${candidate}`;
        try {
            const parsed = new URL(candidate);
            if (!/^https?:$/.test(parsed.protocol)) return '';
            const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
            if (!host || !host.includes('.')) return '';
            if (
                /(?:^|\.)(?:smartrecruiters|allianceanimal|google|facebook|instagram|linkedin|youtube|twitter|x|indeed)\.com$/i.test(host) ||
                /(?:^|\.)usnews\.com$/i.test(host) ||
                /^(?:bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly)$/i.test(host)
            ) {
                return '';
            }
            return `${parsed.protocol}//${parsed.host}`;
        } catch (_) {
            return '';
        }
    }

    function extractWebsite(value) {
        const source = String(value || '').replace(/&amp;/gi, '&');
        const matches = source.match(/(?:https?:\/\/|www\.)[^\s<>"']+/gi) || [];
        for (const match of matches) {
            const website = normalizeWebsiteCandidate(match);
            if (website) return website;
        }
        return '';
    }

    function getPostingDetails(posting) {
        if (!posting || typeof posting !== 'object') return null;
        const location = posting.location || {};
        const city = cleanText(location.city);
        const state = cleanText(location.region);
        const zipCode = cleanText(location.postalCode || location.zipCode);
        const rawAddress = cleanText(location.address);
        const streetAddress = /^(?:tbd|tbd-|n\/?a|not available)$/i.test(rawAddress) ? '' : rawAddress;
        const stateZip = [state, zipCode].filter(Boolean).join(' ');
        const sectionValues = Object.values(posting.jobAd?.sections || {})
            .map(section => section?.text || '')
            .filter(Boolean);
        const website = extractWebsite(sectionValues.join('\n'));

        return {
            description: formatPostingDescription(posting),
            jobType: normalizeEmploymentType(posting.typeOfEmployment),
            website,
            streetAddress,
            city,
            state,
            zipCode,
            location: [city, state].filter(Boolean).join(', '),
            addressLine: [streetAddress, city, stateZip].filter(Boolean).join(', ')
        };
    }

    function formatPostingDescription(posting) {
        if (!posting || typeof posting !== 'object') return '';
        const location = posting.location || {};
        const city = cleanText(location.city);
        const state = cleanText(location.region);
        const zipCode = cleanText(location.postalCode || location.zipCode);
        const country = countryName(location.country);
        const stateZip = [state, zipCode].filter(Boolean).join(' ');
        const fullAddress = [cleanText(location.address), city, stateZip, country].filter(Boolean).join(', ');
        const cityLine = [city, state, country].filter(Boolean).join(', ');
        const employmentType = normalizeEmploymentType(posting.typeOfEmployment);
        const industry = cleanText(posting.industry?.label || posting.industry);

        const lines = [
            '=== JOB POSTING DATA ===',
            `Title: ${cleanText(posting.name)}`,
            `Date Posted: ${cleanText(posting.releasedDate)}`,
            `Industry/Category: ${industry}`,
            `Employment Type: ${employmentType}`
        ];
        if (posting.company?.name) lines.push(`Hiring Organization: ${cleanText(posting.company.name)}`);
        lines.push('Locations:');
        if (cityLine) lines.push(`  - ${cityLine}`);
        if (fullAddress) lines.push(fullAddress);

        const sections = posting.jobAd?.sections || {};
        const sectionValues = [
            sections.companyDescription?.text || posting.companyDescription,
            sections.jobDescription?.text || posting.jobDescription,
            sections.qualifications?.text || posting.qualifications,
            sections.additionalInformation?.text || posting.additionalInformation
        ].map(htmlToText).filter(Boolean);
        const website = extractWebsite(Object.values(sections).map(section => section?.text || '').join('\n'));
        if (website) lines.push(`Website: ${website}`);
        if (sectionValues.length) {
            lines.push('', '=== FULL JOB DESCRIPTION ===', sectionValues.join('\n\n'));
        }
        return cleanText(lines.join('\n'));
    }

    async function fetchPostingDescription(fetchImpl, jobUrl, signal) {
        const details = await fetchPostingDetails(fetchImpl, jobUrl, signal);
        return details?.description || '';
    }

    async function fetchPostingDetails(fetchImpl, jobUrl, signal) {
        const apiUrl = getPostingApiUrl(jobUrl);
        if (!apiUrl || typeof fetchImpl !== 'function') return null;
        const response = await fetchImpl(apiUrl, {
            cache: 'no-store',
            credentials: 'omit',
            signal,
            headers: { Accept: 'application/json' }
        });
        if (!response.ok) throw new Error(`SmartRecruiters API request failed with HTTP ${response.status}.`);
        return getPostingDetails(await response.json());
    }

    return {
        getPostingApiUrl,
        formatPostingDescription,
        fetchPostingDescription,
        fetchPostingDetails,
        getPostingDetails,
        normalizeEmploymentType,
        extractWebsite
    };
});
