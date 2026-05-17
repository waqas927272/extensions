(() => {
    const WAIT_TIMEOUT_MS = 20000;
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
        temp.innerHTML = html || '';
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
