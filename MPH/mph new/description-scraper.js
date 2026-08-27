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
                if (!previousBlank && cleanedLines.length > 0) cleanedLines.push('');
                previousBlank = true;
                continue;
            }

            cleanedLines.push(line);
            previousBlank = false;
        }

        while (cleanedLines[cleanedLines.length - 1] === '') cleanedLines.pop();
        return cleanedLines.join('\n').trim();
    }

    function elementToMultilineText(element) {
        if (!element) return '';

        const clone = element.cloneNode(true);
        clone.querySelectorAll('br').forEach(node => node.replaceWith('\n'));
        clone.querySelectorAll('li').forEach(node => {
            node.insertBefore(node.ownerDocument.createTextNode('- '), node.firstChild);
            node.append(node.ownerDocument.createTextNode('\n'));
        });
        clone.querySelectorAll('p, div, section, article, h1, h2, h3, h4, h5, h6, ul, ol')
            .forEach(node => node.append(node.ownerDocument.createTextNode('\n')));

        return normalizeMultilineText(clone.textContent || element.innerText || '');
    }

    function htmlToText(html, ownerDocument = document) {
        const temp = ownerDocument.createElement('div');
        temp.innerHTML = html || '';
        return elementToMultilineText(temp);
    }

    function findJobPostingJson(data) {
        if (!data || typeof data !== 'object') return null;

        const type = data['@type'];
        if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) return data;

        const graph = data['@graph'];
        if (Array.isArray(graph)) {
            const match = graph.map(findJobPostingJson).find(Boolean);
            if (match) return match;
        }

        if (Array.isArray(data)) return data.map(findJobPostingJson).find(Boolean) || null;
        return null;
    }

    function extractJsonLdText(rootDocument = document) {
        const scripts = Array.from(rootDocument.querySelectorAll('script[type="application/ld+json"]'));

        for (const script of scripts) {
            try {
                const json = JSON.parse(script.textContent || '{}');
                const jobPosting = findJobPostingJson(json);
                const description = htmlToText(jobPosting?.description || '', rootDocument);

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

    function extractAvatureSectionContent(rootDocument = document) {
        const root = rootDocument.querySelector('.grid__item.grid__item--main section.section.js_views');
        if (!root) return { text: '', hasDescription: false };

        const articles = Array.from(root.querySelectorAll('article.article.article--details'));
        if (articles.length === 0) return { text: '', hasDescription: false };

        const metadataLines = [];
        const descriptionParts = [];
        let lastSectionTitle = '';

        for (const article of articles) {
            const headerTitle = normalizeWhitespace(
                article.querySelector('.article__header__text__title')?.textContent || ''
            );
            const sectionTitle = headerTitle || lastSectionTitle || 'General Information';
            if (headerTitle) lastSectionTitle = headerTitle;

            const fields = Array.from(article.querySelectorAll('.article__content__view__field'));
            for (const field of fields) {
                const label = normalizeWhitespace(
                    field.querySelector('.article__content__view__field__label')?.textContent || ''
                );
                const valueEl = field.querySelector('.article__content__view__field__value');
                const valueBlockText = elementToMultilineText(valueEl);
                const valueText = normalizeWhitespace(valueBlockText);
                if (!valueText) continue;

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

                metadataLines.push(label ? `${label}: ${valueText}` : valueText);
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

    function extractDomDescription(rootDocument = document) {
        const selectors = [
            '.jv-job-detail-description',
            '.jv-wrapper',
            '[data-qa="job-description"]',
            '[data-testid="job-description"]',
            'main',
            'article'
        ];

        for (const selector of selectors) {
            const text = elementToMultilineText(rootDocument.querySelector(selector));
            if (text.length > 100) {
                return {
                    text: `=== DESCRIPTION & REQUIREMENTS ===\n${text}`,
                    hasDescription: true
                };
            }
        }

        const bodyText = elementToMultilineText(rootDocument.body);
        const looksLikeDescription = /job description|description & requirements|responsibilities|qualifications|requirements/i.test(bodyText);
        if (looksLikeDescription && bodyText.length > 100) {
            return {
                text: `=== DESCRIPTION & REQUIREMENTS ===\n${bodyText}`,
                hasDescription: true
            };
        }

        return { text: '', hasDescription: false };
    }

    function extractDescription(rootDocument = document) {
        const avature = extractAvatureSectionContent(rootDocument);
        if (avature.hasDescription) return avature;

        const jsonLd = extractJsonLdText(rootDocument);
        if (jsonLd.hasDescription) return jsonLd;

        return extractDomDescription(rootDocument);
    }

    function extractDescriptionFromHtml(html) {
        const parsedDocument = new DOMParser().parseFromString(html || '', 'text/html');
        return extractDescription(parsedDocument);
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    globalThis.MphDescriptionParser = Object.freeze({
        extractDescription,
        extractDescriptionFromHtml
    });

    if (globalThis.location?.protocol === 'chrome-extension:') return null;

    return (async () => {
        const startedAt = Date.now();
        while (Date.now() - startedAt < WAIT_TIMEOUT_MS) {
            const result = extractDescription(document);
            if (result.hasDescription) {
                return result.text.replace(/\n{3,}/g, '\n\n').trim();
            }

            window.scrollTo(0, document.body?.scrollHeight || 0);
            await sleep(POLL_INTERVAL_MS);
        }

        return '';
    })();
})();
