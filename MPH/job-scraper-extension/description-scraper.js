(() => {
    try {
        function parseJsonLd() {
            const scripts = document.querySelectorAll('script[type="application/ld+json"]');

            for (const script of scripts) {
                try {
                    const parsed = JSON.parse(script.textContent);
                    const records = Array.isArray(parsed) ? parsed : [parsed];
                    const jobPosting = records.find(record => record?.['@type'] === 'JobPosting');
                    if (jobPosting) return jobPosting;
                } catch (_) {
                    // Ignore malformed JSON-LD blocks.
                }
            }

            return null;
        }

        function stripHtml(value) {
            if (!value) return '';
            const container = document.createElement('div');
            container.innerHTML = value;
            return container.innerText.trim();
        }

        function formatStructuredSalary(baseSalary) {
            const salaryValue = baseSalary?.value;
            if (!salaryValue) return '';

            const minValue = salaryValue.minValue ? Number(salaryValue.minValue) : null;
            const maxValue = salaryValue.maxValue ? Number(salaryValue.maxValue) : null;
            const unitText = /hour/i.test(salaryValue.unitText || '') ? 'per hour' : 'per year';
            const formatNumber = (value) => `$${value.toLocaleString('en-US')}`;

            if (Number.isFinite(minValue) && Number.isFinite(maxValue)) {
                return `${formatNumber(minValue)}-${formatNumber(maxValue)} ${unitText}`;
            }

            if (Number.isFinite(minValue)) {
                return `${formatNumber(minValue)}+ ${unitText}`;
            }

            if (Number.isFinite(maxValue)) {
                return `Up to ${formatNumber(maxValue)} ${unitText}`;
            }

            return '';
        }

        function getPrimaryDescriptionText() {
            const bodyText = document.body.innerText;
            const descStart = bodyText.indexOf('Description & Requirements');

            if (descStart !== -1) {
                const afterDescriptionHeading = bodyText.substring(descStart + 'Description & Requirements'.length).trim();
                const endMarkers = ['Responsibilities and Benefits', 'How You\'re Supported', 'About Mission Pet Health'];
                let endPosition = afterDescriptionHeading.length;

                for (const marker of endMarkers) {
                    const markerPosition = afterDescriptionHeading.indexOf(marker);
                    if (markerPosition !== -1 && markerPosition < endPosition) {
                        endPosition = markerPosition;
                    }
                }

                const description = afterDescriptionHeading.substring(0, endPosition).trim();
                if (description.length > 50) return description;
            }

            const article = document.querySelector('article.article--details.article--collapsible');
            if (article) {
                const clonedArticle = article.cloneNode(true);
                clonedArticle.querySelectorAll('script, style, .article__footer, .popup--share, .article__header').forEach(element => element.remove());
                const articleText = clonedArticle.innerText.trim();
                if (articleText) return articleText;
            }

            return '';
        }

        const jsonLd = parseJsonLd();
        const sections = [];

        if (jsonLd) {
            const metadataLines = [];
            if (jsonLd.title) metadataLines.push(`Title: ${jsonLd.title}`);
            if (jsonLd.industry) metadataLines.push(`Industry/Category: ${jsonLd.industry}`);

            const employmentType = Array.isArray(jsonLd.employmentType)
                ? jsonLd.employmentType.join(', ')
                : jsonLd.employmentType;
            if (employmentType) metadataLines.push(`Employment Type: ${employmentType}`);

            const salary = formatStructuredSalary(jsonLd.baseSalary);
            if (salary) metadataLines.push(`Salary Range: ${salary}`);

            if (jsonLd.hiringOrganization?.name) {
                metadataLines.push(`Hiring Organization: ${jsonLd.hiringOrganization.name}`);
            }

            if (jsonLd.jobLocation) {
                const locations = Array.isArray(jsonLd.jobLocation) ? jsonLd.jobLocation : [jsonLd.jobLocation];
                const locationLines = [];
                locations.forEach((location) => {
                    const address = location?.address;
                    if (!address) return;
                    const pieces = [
                        address.addressLocality || '',
                        address.addressRegion || '',
                        address.addressCountry || ''
                    ].filter(Boolean);
                    if (pieces.length > 0) {
                        locationLines.push(`  - ${pieces.join(', ')}`);
                    }
                });

                if (locationLines.length > 0) {
                    metadataLines.push(`Locations:\n${locationLines.join('\n')}`);
                }
            }

            if (metadataLines.length > 0) {
                sections.push(`=== JOB POSTING DATA ===\n${metadataLines.join('\n')}`);
            }

            const jsonLdDescription = stripHtml(jsonLd.description || '');
            if (jsonLdDescription) {
                sections.push(`=== FULL JOB DESCRIPTION ===\n${jsonLdDescription}`);
            }
        }

        const pageDescription = getPrimaryDescriptionText();
        if (pageDescription) {
            const hasExistingBody = sections.some(section => section.includes(pageDescription.substring(0, 80)));
            if (!hasExistingBody) {
                sections.push(`=== PAGE CONTENT ===\n${pageDescription}`);
            }
        }

        const finalDescription = sections.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
        return finalDescription || '';
    } catch (error) {
        return `Error scraping description: ${error.message}`;
    }
})();
