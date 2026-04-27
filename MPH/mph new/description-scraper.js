(() => {
    try {
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

        function extractSectionContent() {
            const root = document.querySelector('.grid__item.grid__item--main section.section.js_views');
            if (!root) return null;

            const articles = Array.from(root.querySelectorAll('article.article.article--details'));
            if (articles.length === 0) return null;

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

                    if (sectionTitle.toLowerCase().includes('description')) {
                        if (/job description/i.test(label)) {
                            descriptionParts.push(valueBlockText || valueText);
                        } else if (label) {
                            descriptionParts.push(`${label}: ${valueText}`);
                        } else if (valueText) {
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

            return {
                metadataText: metadataLines.join('\n').trim(),
                descriptionText: descriptionParts.join('\n\n').trim()
            };
        }

        const sections = [];
        const sectionContent = extractSectionContent();

        if (sectionContent?.metadataText) {
            sections.push(`=== JOB DETAIL FIELDS ===\n${sectionContent.metadataText}`);
        }

        if (sectionContent?.descriptionText) {
            sections.push(`=== DESCRIPTION & REQUIREMENTS ===\n${sectionContent.descriptionText}`);
        }

        const finalDescription = sections.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
        return finalDescription || '';
    } catch (error) {
        return `Error scraping description: ${error.message}`;
    }
})();
