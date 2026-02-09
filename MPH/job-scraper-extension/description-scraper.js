(() => {
    try {
        // Extract text between "Description & Requirements" and "Responsibilities and Benefits"
        // using full page text since Avature SPA nests headings in separate containers
        const bodyText = document.body.innerText;

        const descStart = bodyText.indexOf('Description & Requirements');
        if (descStart !== -1) {
            const afterDesc = bodyText.substring(descStart + 'Description & Requirements'.length).trim();

            // Find where the description section ends
            const endMarkers = ['Responsibilities and Benefits', 'How You\'re Supported', 'About Mission Pet Health'];
            let endPos = afterDesc.length;

            for (const marker of endMarkers) {
                const pos = afterDesc.indexOf(marker);
                if (pos !== -1 && pos < endPos) {
                    endPos = pos;
                }
            }

            const description = afterDesc.substring(0, endPos).trim();
            if (description.length > 50) {
                return description;
            }
        }

        // Fallback: Try the Avature article selector
        const specificSelector = 'article.article--details.article--collapsible';
        const descriptionContainer = document.querySelector(specificSelector);

        if (descriptionContainer) {
            const cloned = descriptionContainer.cloneNode(true);
            cloned.querySelectorAll('script, style, .article__footer, .popup--share, .article__header').forEach(el => el.remove());
            const descriptionText = cloned.innerText.trim();
            if (descriptionText) {
                return descriptionText;
            }
        }

        return '';
    } catch (e) {
        return `Error scraping description: ${e.message}`;
    }
})();
