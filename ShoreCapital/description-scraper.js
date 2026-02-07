(() => {
    try {
        // Shore Capital job page selectors (jobs.shorecp.com)
        const selectors = [
            '.job-description',
            '.job-details-description',
            '.job-content',
            '.job-detail-content',
            '[class*="job-description"]',
            '[class*="jobDescription"]',
            '.description',
            '.posting-description',
            'article',
            '.content-area'
        ];

        for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el && el.innerText.trim().length > 50) {
                return el.innerText.trim();
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

        return document.body.innerText.trim().substring(0, 5000);
    } catch (e) {
        return `Error scraping description: ${e.message}`;
    }
})();
