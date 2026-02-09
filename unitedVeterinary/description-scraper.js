(() => {
    try {
        // Try JSON-LD structured data first (most reliable)
        const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (const script of jsonLdScripts) {
            try {
                const data = JSON.parse(script.textContent);
                if (data.description && data.description.length > 50) {
                    // Strip HTML tags from the description
                    const temp = document.createElement('div');
                    temp.innerHTML = data.description;
                    return temp.innerText.trim();
                }
            } catch (e) {}
        }

        // Jobvite job page selectors (specific to general)
        const selectors = [
            '.jv-page-body .jv-wrapper',
            '.jv-page-body',
            '.jv-job-detail-description',
            '.jv-job-description',
            '.jv-job-detail'
        ];

        for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el && el.innerText.trim().length > 50) {
                return el.innerText.trim();
            }
        }

        return '';
    } catch (e) {
        return `Error scraping description: ${e.message}`;
    }
})();
