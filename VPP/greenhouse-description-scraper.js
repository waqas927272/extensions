(() => {
    try {
        // Try JSON-LD structured data first (most reliable)
        const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (const script of jsonLdScripts) {
            try {
                const data = JSON.parse(script.textContent);
                if (data.description && data.description.length > 50) {
                    const temp = document.createElement('div');
                    temp.innerHTML = data.description;
                    let text = temp.innerText.trim();
                    // Handle double-encoded HTML (entity-encoded tags)
                    if (/<[a-z][\s\S]*>/i.test(text)) {
                        temp.innerHTML = text;
                        text = temp.innerText.trim();
                    }
                    return text;
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
                const text = cloned.innerText.trim();
                if (text.length > 50) {
                    return text;
                }
            }
        }

        return '';
    } catch (e) {
        return `Error scraping description: ${e.message}`;
    }
})();
