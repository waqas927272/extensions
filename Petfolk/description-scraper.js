(() => {
    const WAIT_TIMEOUT_MS = 40000;
    const POLL_INTERVAL_MS = 500;

    function normalizeWhitespace(value) {
        return (value || '').replace(/\s+/g, ' ').trim();
    }

    function normalizeMultilineText(value) {
        const lines = (value || '')
            .replace(/\r/g, '')
            .split('\n')
            .map(line => line.replace(/[ \t]+/g, ' ').trim());

        const cleanedLines = [];
        let previousBlank = false;

        for (const line of lines) {
            if (!line) {
                if (!previousBlank && cleanedLines.length > 0) {
                    cleanedLines.push('');
                }
                previousBlank = true;
                continue;
            }

            cleanedLines.push(line);
            previousBlank = false;
        }

        while (cleanedLines.length > 0 && cleanedLines[cleanedLines.length - 1] === '') {
            cleanedLines.pop();
        }

        return cleanedLines.join('\n').trim();
    }

    function htmlToText(html) {
        const temp = document.createElement('div');
        const preparedHtml = (html || '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/(?:p|div|li|h[1-6]|section)>/gi, '\n')
            .replace(/<(?:p|div|li|h[1-6]|section)(?:\s[^>]*)?>/gi, '\n');
        temp.innerHTML = preparedHtml;
        return normalizeMultilineText(temp.innerText || temp.textContent || '');
    }

    function findJobPostingJson(data) {
        if (!data || typeof data !== 'object') return null;

        const type = data['@type'];
        if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) {
            return data;
        }

        const graph = data['@graph'];
        if (Array.isArray(graph)) {
            const match = graph.map(findJobPostingJson).find(Boolean);
            if (match) return match;
        }

        if (Array.isArray(data)) {
            return data.map(findJobPostingJson).find(Boolean) || null;
        }

        return null;
    }

    function extractJsonLdText() {
        const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));

        for (const script of scripts) {
            try {
                const json = JSON.parse(script.textContent || '{}');
                const jobPosting = findJobPostingJson(json);
                const description = htmlToText(jobPosting?.description || '');

                if (description) {
                    const metadata = [];
                    if (jobPosting.title) metadata.push(`Title: ${normalizeWhitespace(jobPosting.title)}`);
                    if (jobPosting.datePosted) metadata.push(`Date Posted: ${normalizeWhitespace(jobPosting.datePosted)}`);
                    if (jobPosting.industry) metadata.push(`Industry/Category: ${normalizeWhitespace(jobPosting.industry)}`);
                    if (jobPosting.employmentType) metadata.push(`Employment Type: ${normalizeWhitespace(jobPosting.employmentType)}`);
                    if (jobPosting.hiringOrganization?.name) {
                        metadata.push(`Hiring Organization: ${normalizeWhitespace(jobPosting.hiringOrganization.name)}`);
                    }

                    return {
                        text: [
                            metadata.length ? `=== JOB DETAIL FIELDS ===\n${metadata.join('\n')}` : '',
                            `=== DESCRIPTION & REQUIREMENTS ===\n${description}`
                        ].filter(Boolean).join('\n\n'),
                        hasDescription: true
                    };
                }
            } catch (error) {
                // Ignore malformed structured data and try the next source.
            }
        }

        return { text: '', hasDescription: false };
    }

    function getNextData() {
        const nextDataEl = document.getElementById('__NEXT_DATA__');
        if (!nextDataEl?.textContent) return null;

        try {
            return JSON.parse(nextDataEl.textContent);
        } catch (error) {
            return null;
        }
    }

    function isRipplingJobPost(value) {
        if (!value || typeof value !== 'object') return false;

        const title = normalizeWhitespace(value.name || value.title || value.jobTitle || '');
        const id = value.uuid || value.id || value.jobId || '';
        const url = normalizeWhitespace(value.url || value.absoluteUrl || '');
        const hasDescription = Boolean(
            value.description ||
            value.descriptionHtml ||
            value.content ||
            value.body ||
            value.jobDescription ||
            value.jobDescriptionHtml ||
            value.descriptionJson ||
            value.descriptionRichText
        );
        const hasUuidLikeId = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(String(id));
        const hasJobUrl = /\/jobs\/[0-9a-f-]{12,}/i.test(url);
        const hasStructuredJobContext = Array.isArray(value.workLocations) ||
            Array.isArray(value.locations) ||
            (value.board && typeof value.board === 'object') ||
            value.companyName;

        return Boolean(title && hasDescription && (hasUuidLikeId || hasJobUrl || hasStructuredJobContext));
    }

    function findRipplingJobPost(value, seen = new Set()) {
        if (!value || typeof value !== 'object' || seen.has(value)) return null;
        seen.add(value);

        if (isRipplingJobPost(value)) {
            return value;
        }

        if (Array.isArray(value)) {
            for (const item of value) {
                const match = findRipplingJobPost(item, seen);
                if (match) return match;
            }
            return null;
        }

        for (const key of Object.keys(value)) {
            if (key === '_nextI18Next' || key === 'initialI18nStore') continue;
            const match = findRipplingJobPost(value[key], seen);
            if (match) return match;
        }

        return null;
    }

    function getRipplingJobPost(nextData) {
        const directCandidates = [
            nextData?.props?.pageProps?.apiData?.jobPost,
            nextData?.props?.pageProps?.jobPost,
            nextData?.props?.pageProps?.data?.jobPost
        ];

        for (const candidate of directCandidates) {
            if (isRipplingJobPost(candidate)) return candidate;
        }

        return findRipplingJobPost(nextData?.props?.pageProps?.apiData) ||
            findRipplingJobPost(nextData?.props?.pageProps?.dehydratedState) ||
            findRipplingJobPost(nextData);
    }

    function normalizeRipplingEmploymentType(value) {
        if (!value) return '';
        if (typeof value === 'string') return normalizeWhitespace(value);
        return normalizeWhitespace(value.label || value.name || value.id || '');
    }

    function getRipplingDescriptionHtml(description) {
        if (!description) return '';
        if (typeof description === 'string') return description;
        if (typeof description !== 'object') return '';

        const orderedSections = [
            description.company,
            description.role,
            description.requirements,
            description.benefits,
            description.legal
        ]
            .map(section => typeof section === 'string' ? section : flattenRipplingDescriptionValue(section))
            .filter(Boolean)
            .join('\n');

        return orderedSections || flattenRipplingDescriptionValue(description);
    }

    function flattenRipplingDescriptionValue(value, seen = new Set()) {
        if (!value) return '';
        if (typeof value === 'string') return value;
        if (typeof value === 'number' || typeof value === 'boolean') return '';
        if (typeof value !== 'object' || seen.has(value)) return '';
        seen.add(value);

        if (Array.isArray(value)) {
            return value
                .map(item => flattenRipplingDescriptionValue(item, seen))
                .filter(Boolean)
                .join('\n');
        }

        const preferredKeys = [
            'html',
            'text',
            'value',
            'content',
            'body',
            'description',
            'descriptionHtml',
            'jobDescription',
            'jobDescriptionHtml'
        ];
        const remainingKeys = Object.keys(value).filter(key => !preferredKeys.includes(key));

        return [...preferredKeys, ...remainingKeys]
            .map(key => flattenRipplingDescriptionValue(value[key], seen))
            .filter(Boolean)
            .join('\n');
    }

    function getRipplingDescriptionPart(description, key) {
        if (!description || typeof description !== 'object') return '';
        const part = description[key] || '';
        return htmlToText(typeof part === 'string' ? part : flattenRipplingDescriptionValue(part));
    }

    function getPetfolkLocationParts(location) {
        if (location && typeof location === 'object') {
            const city = normalizeWhitespace(location.city || '');
            const state = normalizeWhitespace(location.stateCode || location.state || '');
            const name = normalizeWhitespace(location.name || '');
            if (city || state) {
                return {
                    raw: city && state ? `${city}, ${state}` : (name || city || state),
                    city: city || name,
                    state
                };
            }
            if (name) location = name;
        }

        const raw = normalizeWhitespace(String(location || ''));
        const parts = raw.split(',').map(part => normalizeWhitespace(part)).filter(Boolean);
        return {
            raw,
            city: parts[0] || raw,
            state: parts.length > 1 ? parts[1] : ''
        };
    }

    function formatPetfolkLocationName(location) {
        return getPetfolkLocationParts(location).city;
    }

    function formatPetfolkLocationLine(location) {
        const parts = getPetfolkLocationParts(location);
        return parts.city && parts.state ? `${parts.city}, ${parts.state}` : parts.city;
    }

    function inferPetfolkLocationGroup(locations) {
        const cityNames = locations.map(formatPetfolkLocationName).filter(Boolean);
        const normalizedCities = cityNames.map(city => city.toLowerCase());
        const dallasCities = ['allen', 'flower mound', 'frisco', 'lakewood', 'mansfield', 'north dallas', 'southlake', 'dallas'];
        if (normalizedCities.some(city => dallasCities.includes(city))) return 'Dallas';

        const states = locations
            .map(location => getPetfolkLocationParts(location).state)
            .filter(Boolean);

        const uniqueStates = [...new Set(states)];
        return uniqueStates.length === 1 ? uniqueStates[0] : '';
    }

    function formatPetfolkLocationBlock(locations) {
        if (!Array.isArray(locations) || locations.length <= 1) return '';
        const locationLines = locations.map(formatPetfolkLocationLine).filter(Boolean);
        if (!locationLines.length) return '';

        const group = inferPetfolkLocationGroup(locations);
        const heading = `${locationLines.length}${group ? ` ${group}` : ''} Locations:`;
        return `${heading}\n\n${locationLines.join('\n')}`;
    }

    function replacePetfolkLocationBlockInRole(role, locationBlock) {
        if (!role || !locationBlock) return role;
        return role.replace(/\b\d+\s+(?:.+?\s+)?Locations:\s*\n[\s\S]*$/i, locationBlock);
    }

    function normalizePetfolkPostingText(text) {
        return normalizeMultilineText(text)
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    function formatPetfolkRipplingDescription(jobPost, rawDescription) {
        const description = jobPost.description;
        if (!description || typeof description !== 'object') {
            return normalizePetfolkPostingText(rawDescription);
        }

        const company = getRipplingDescriptionPart(description, 'company');
        let role = getRipplingDescriptionPart(description, 'role').replace(/^Description\s*/i, '').trim();
        const requirements = getRipplingDescriptionPart(description, 'requirements');
        const benefits = getRipplingDescriptionPart(description, 'benefits');
        const legal = getRipplingDescriptionPart(description, 'legal');
        const locations = Array.isArray(jobPost.workLocations) ? jobPost.workLocations : [];
        const locationBlock = formatPetfolkLocationBlock(locations);
        const roleHasLocationBlock = /\b\d+\s+(?:.+?\s+)?Locations:\s*/i.test(role);
        if (roleHasLocationBlock && locationBlock) {
            role = replacePetfolkLocationBlockInRole(role, locationBlock);
        }

        const sections = [];
        if (company) sections.push(company);
        if (role) sections.push(`Description\n${role}`);
        if (locationBlock && !roleHasLocationBlock) sections.push(locationBlock);
        if (requirements) sections.push(/^Requirements\b/i.test(requirements) ? requirements : `Requirements\n${requirements}`);
        if (benefits) sections.push(/^Benefits\b/i.test(benefits) ? benefits : `Benefits\n${benefits}`);
        if (legal) sections.push(legal);

        return normalizePetfolkPostingText(sections.join('\n\n') || rawDescription);
    }

    function extractRipplingNextDataText() {
        const nextData = getNextData();
        const jobPost = getRipplingJobPost(nextData);
        if (!jobPost) return { text: '', hasDescription: false };

        const description = htmlToText(
            getRipplingDescriptionHtml(jobPost.description) ||
            jobPost.descriptionHtml ||
            jobPost.content ||
            jobPost.body ||
            jobPost.jobDescription ||
            jobPost.jobDescriptionHtml ||
            flattenRipplingDescriptionValue(jobPost.descriptionJson) ||
            flattenRipplingDescriptionValue(jobPost.descriptionRichText) ||
            ''
        );
        if (!description) return { text: '', hasDescription: false };

        const metadata = [];
        const department = normalizeWhitespace(jobPost.department?.name || jobPost.department?.base_department || '');
        const employmentType = normalizeRipplingEmploymentType(jobPost.employmentType);
        const organization = normalizeWhitespace(jobPost.companyName || jobPost.board?.title || 'Petfolk');
        const locations = Array.isArray(jobPost.workLocations) ? jobPost.workLocations : [];

        metadata.push(`Title: ${normalizeWhitespace(jobPost.name || jobPost.title || jobPost.jobTitle)}`);
        if (jobPost.createdOn) metadata.push(`Date Posted: ${normalizeWhitespace(jobPost.createdOn)}`);
        if (department) {
            metadata.push(`Industry/Category: ${department}`);
            metadata.push(`Department: ${department}`);
        }
        if (employmentType) metadata.push(`Employment Type: ${employmentType}`);
        if (organization) metadata.push(`Hiring Organization: ${organization}`);
        if (locations.length) {
            metadata.push('Locations:');
            locations.forEach(location => metadata.push(`  - ${formatPetfolkLocationLine(location)}`));
        }

        const isPetfolkPosting = /petfolk/i.test(`${organization} ${jobPost.board?.title || ''}`);
        const formattedDescription = isPetfolkPosting
            ? formatPetfolkRipplingDescription(jobPost, description)
            : description;

        return {
            text: isPetfolkPosting
                ? formattedDescription
                : [
                    `=== JOB DETAIL FIELDS ===\n${metadata.join('\n')}`,
                    `=== DESCRIPTION & REQUIREMENTS ===\n${formattedDescription}`
                ].join('\n\n').replace(/\n{3,}/g, '\n\n').trim(),
            hasDescription: true
        };
    }

    function extractAvatureSectionContent() {
        const root = document.querySelector('.grid__item.grid__item--main section.section.js_views');
        if (!root) return { text: '', hasDescription: false };

        const articles = Array.from(root.querySelectorAll('article.article.article--details'));
        if (articles.length === 0) return { text: '', hasDescription: false };

        const metadataLines = [];
        const descriptionParts = [];
        let lastSectionTitle = '';

        for (const article of articles) {
            const headerTitle = normalizeWhitespace(
                article.querySelector('.article__header__text__title')?.innerText || ''
            );
            const sectionTitle = headerTitle || lastSectionTitle || 'General Information';
            if (headerTitle) lastSectionTitle = headerTitle;

            const fields = Array.from(article.querySelectorAll('.article__content__view__field'));
            for (const field of fields) {
                const label = normalizeWhitespace(
                    field.querySelector('.article__content__view__field__label')?.innerText || ''
                );
                const valueEl = field.querySelector('.article__content__view__field__value');
                const valueText = normalizeWhitespace(valueEl?.innerText || '');
                const valueBlockText = normalizeMultilineText(valueEl?.innerText || '');
                if (!valueText && !valueBlockText) continue;

                const isDescriptionField =
                    sectionTitle.toLowerCase().includes('description') ||
                    /^(job\s+)?description\b/i.test(label) ||
                    /\brequirements?\b/i.test(label);

                if (isDescriptionField) {
                    if (/job description/i.test(label)) {
                        descriptionParts.push(valueBlockText || valueText);
                    } else if (label) {
                        descriptionParts.push(`${label}: ${valueBlockText || valueText}`);
                    } else {
                        descriptionParts.push(valueBlockText || valueText);
                    }
                    continue;
                }

                if (label) {
                    metadataLines.push(`${label}: ${valueText}`);
                } else if (valueText) {
                    metadataLines.push(valueText);
                }
            }
        }

        const sections = [];
        if (metadataLines.length) {
            sections.push(`=== JOB DETAIL FIELDS ===\n${metadataLines.join('\n').trim()}`);
        }

        const descriptionText = descriptionParts.join('\n\n').trim();
        if (descriptionText) {
            sections.push(`=== DESCRIPTION & REQUIREMENTS ===\n${descriptionText}`);
        }

        return {
            text: sections.join('\n\n').replace(/\n{3,}/g, '\n\n').trim(),
            hasDescription: !!descriptionText
        };
    }

    function extractDomDescription() {
        const selectors = [
            '.jv-job-detail-description',
            '.jv-wrapper',
            '[data-qa="job-description"]',
            '[data-testid="job-description"]',
            'main',
            'article'
        ];

        for (const selector of selectors) {
            const element = document.querySelector(selector);
            const text = normalizeMultilineText(element?.innerText || '');
            if (text.length > 100) {
                return {
                    text: `=== DESCRIPTION & REQUIREMENTS ===\n${text}`,
                    hasDescription: true
                };
            }
        }

        const bodyText = normalizeMultilineText(document.body?.innerText || '');
        const looksLikeDescription = /job description|description & requirements|responsibilities|qualifications|requirements/i.test(bodyText);
        if (looksLikeDescription && bodyText.length > 100) {
            return {
                text: `=== DESCRIPTION & REQUIREMENTS ===\n${bodyText}`,
                hasDescription: true
            };
        }

        return { text: '', hasDescription: false };
    }

    function extractDescription() {
        const rippling = extractRipplingNextDataText();
        if (rippling.hasDescription) return rippling;

        const avature = extractAvatureSectionContent();
        if (avature.hasDescription) return avature;

        const jsonLd = extractJsonLdText();
        if (jsonLd.hasDescription) return jsonLd;

        return extractDomDescription();
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    return (async () => {
        const startedAt = Date.now();
        while (Date.now() - startedAt < WAIT_TIMEOUT_MS) {
            const result = extractDescription();
            if (result.hasDescription) {
                return result.text.replace(/\n{3,}/g, '\n\n').trim();
            }

            window.scrollTo(0, document.body?.scrollHeight || 0);
            await sleep(POLL_INTERVAL_MS);
        }

        return '';
    })();
})();
