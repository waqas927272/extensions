(() => {
    try {
        // Try JSON-LD structured data first (most reliable)
        const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (const script of jsonLdScripts) {
            try {
                const data = JSON.parse(script.textContent);
                if (data['@type'] === 'JobPosting' && data.description && data.description.length > 50) {
                    const temp = document.createElement('div');
                    temp.innerHTML = data.description;
                    let text = temp.innerText.trim();
                    // Handle double-encoded HTML (entity-encoded tags like &lt;p&gt;)
                    if (/<[a-z][\s\S]*>/i.test(text)) {
                        temp.innerHTML = text;
                        text = temp.innerText.trim();
                    }
                    return text;
                }
            } catch (e) {}
        }

        // Fallback: Phenom / Workday DOM selectors
        const selectors = [
            '[data-automation-id="jobPostingDescription"]',
            '[data-ph-at-id="job-description"]',
            '.job-description',
            '.jd-info',
            '.job-details-description',
            '[itemprop="description"]'
        ];

        for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el && el.innerText.trim().length > 50) {
                const cloned = el.cloneNode(true);
                cloned.querySelectorAll('script, style, nav, header, footer, form, .apply-button, button').forEach(node => node.remove());
                let text = cloned.innerText.trim();
                // Handle any remaining HTML tags in text
                if (/<[a-z][\s\S]*>/i.test(text)) {
                    const temp2 = document.createElement('div');
                    temp2.innerHTML = text;
                    text = temp2.innerText.trim();
                }
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
