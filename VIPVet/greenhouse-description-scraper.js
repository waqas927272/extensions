(() => {
    // This script is injected into a Greenhouse job page (embed format).
    function getAbsoluteHref(rawHref) {
        const href = (rawHref || '').trim();
        if (!href || href === '#' || /^javascript:/i.test(href)) return '';

        try {
            return new URL(href, window.location.href).href;
        } catch (e) {
            return href;
        }
    }

    function getTextWithLinks(element) {
        if (!element) return '';

        const cloned = element.cloneNode(true);
        cloned.querySelectorAll('script, style, noscript').forEach(node => node.remove());
        cloned.querySelectorAll('a[href]').forEach(link => {
            const href = getAbsoluteHref(link.getAttribute('href'));
            if (!href) return;

            const label = (link.innerText || link.textContent || '').replace(/\s+/g, ' ').trim();
            link.textContent = label && !label.includes(href) ? `${label} (${href})` : href;
        });

        return (cloned.innerText || cloned.textContent || '').trim();
    }

    try {
        let structuredText = '';
        let bodyText = '';

        // Try JSON-LD structured data first (most reliable)
        const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (const script of jsonLdScripts) {
            try {
                const parsed = JSON.parse(script.textContent);
                const items = Array.isArray(parsed) ? parsed : [parsed];
                for (const data of items) {
                if (data && (data['@type'] === 'JobPosting' || data.description || data.title)) {
                    structuredText += `\n=== JOB POSTING DATA ===\n`;
                    structuredText += `Title: ${data.title || ''}\n`;
                    structuredText += `Date Posted: ${data.datePosted || ''}\n`;
                    structuredText += `Industry/Category: ${data.industry || data.occupationalCategory || ''}\n`;
                    structuredText += `Employment Type: ${data.employmentType || ''}\n`;

                    if (data.hiringOrganization && data.hiringOrganization.name) {
                        structuredText += `Hiring Organization: ${data.hiringOrganization.name}\n`;
                    }

                    if (data.jobLocation) {
                        const locations = Array.isArray(data.jobLocation) ? data.jobLocation : [data.jobLocation];
                        structuredText += `Locations:\n`;
                        locations.forEach(loc => {
                            if (loc.address) {
                                const addr = loc.address;
                                structuredText += `  - ${addr.addressLocality || ''}, ${addr.addressRegion || ''}, ${addr.addressCountry || ''}\n`;
                            }
                        });
                    }

                    if (data.baseSalary && data.baseSalary.value) {
                        const salary = data.baseSalary.value;
                        if (salary.minValue || salary.maxValue || salary.value) {
                            structuredText += `Salary Range: ${salary.currency || '$'}${salary.minValue || salary.value || ''} - ${salary.maxValue || salary.value || ''} ${salary.unitText || ''}\n`;
                        }
                    }

                    if (data.description && data.description.length > 50) {
                        const temp = document.createElement('div');
                        temp.innerHTML = data.description;
                        bodyText = getTextWithLinks(temp);
                    }
                } else if (data.description && data.description.length > 50) {
                    const temp = document.createElement('div');
                    temp.innerHTML = data.description;
                    bodyText = getTextWithLinks(temp);
                }
                }
            } catch (e) {}
        }

        // Fallback: Greenhouse DOM selectors (specific to general)
        const selectors = [
            '#content',
            '#app_body',
            '.job__description',
            '.job-description',
            '#job_description'
        ];

        for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el && el.innerText.trim().length > 50) {
                const cloned = el.cloneNode(true);
                cloned.querySelectorAll('.social-media-links, form, #job-app, nav, header, footer, .apply-button, [data-ui="apply-button"]').forEach(node => node.remove());
                const text = getTextWithLinks(cloned);
                if (text.length > 50) {
                    bodyText = text;
                    break;
                }
            }
        }

        if (structuredText || bodyText) {
            return `${structuredText}${bodyText ? `\n\n=== FULL JOB DESCRIPTION ===\n${bodyText}` : ''}`
                .replace(/\n{3,}/g, '\n\n')
                .trim();
        }

        return '';
    } catch (e) {
        return `Error scraping description: ${e.message}`;
    }
})();
