(() => {
    // This script is injected into a boards.greenhouse.io job page.
    try {
        // Try multiple selectors for Greenhouse job pages
        const selectors = [
            '#content',
            '#app_body',
            '.job-post',
            '.job__description',
            '.job-description',
            '#job_description',
            '.content',
            '[data-mapped="true"]',
            'article',
            '.posting-page',
            '.job-post-content',
            '#main'
        ];

        for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el && el.innerText.trim().length > 50) {
                const cloned = el.cloneNode(true);
                // Remove non-description elements
                cloned.querySelectorAll('.social-media-links, form, #job-app, nav, header, footer, .apply-button, [data-ui="apply-button"]').forEach(node => node.remove());
                const text = cloned.innerText.trim();
                if (text.length > 50) {
                    return text;
                }
            }
        }

        // Fallback: find the largest text block on the page
        const allElements = document.querySelectorAll('div, section, article, main');
        let bestElement = null;
        let bestLength = 0;

        allElements.forEach(el => {
            const text = el.innerText.trim();
            if (text.length > bestLength && text.length > 100) {
                bestLength = text.length;
                bestElement = el;
            }
        });

        if (bestElement) {
            return bestElement.innerText.trim();
        }

        // Last resort: return body text
        return document.body.innerText.trim().substring(0, 5000) || 'Could not extract description from this page.';
    } catch (e) {
        return `An error occurred while scraping the description: ${e.message}`;
    }
})();
