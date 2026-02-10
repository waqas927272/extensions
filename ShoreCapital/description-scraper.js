(() => {
    try {
        function cleanText(el) {
            const cloned = el.cloneNode(true);
            cloned.querySelectorAll('script, style, nav, footer, form, button, iframe, svg, video, .social-media-links, [data-ui="apply-button"]').forEach(n => n.remove());
            let text = cloned.innerText.trim();
            if (/<[a-z][\s\S]*>/i.test(text)) {
                const t = document.createElement('div');
                t.innerHTML = text;
                text = t.innerText.trim();
            }
            return text;
        }

        function htmlToText(html) {
            const t = document.createElement('div');
            t.innerHTML = html;
            let text = t.innerText.trim();
            if (/<[a-z][\s\S]*>/i.test(text)) {
                t.innerHTML = text;
                text = t.innerText.trim();
            }
            return text;
        }

        // JSON-LD
        const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (const script of jsonLdScripts) {
            try {
                const data = JSON.parse(script.textContent);
                if (data['@type'] === 'JobPosting' && data.description && data.description.length > 50) {
                    return htmlToText(data.description);
                }
            } catch (e) {}
        }

        // DOM selectors
        const selectors = [
            '#content',
            '#app_body',
            '.job__description',
            '.job-description',
            '#job_description',
            '.job-details-description',
            '.job-detail-description',
            '.posting-description',
            '[class*="job-description"]',
            '[class*="jobDescription"]',
            '[itemprop="description"]'
        ];

        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && el.innerText.trim().length > 50) {
                const text = cleanText(el);
                if (text.length > 50) return text;
            }
        }

        return '';
    } catch (e) {
        return '';
    }
})();
