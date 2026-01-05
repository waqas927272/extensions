(() => {
    try {
        // --- 1. Primary Method: Try the specific, reliable selector first. ---
        const specificSelector = 'article.article--details.article--collapsible';
        let descriptionContainer = document.querySelector(specificSelector);

        if (descriptionContainer) {
            const clonedContainer = descriptionContainer.cloneNode(true);
            // Clean out known non-description elements
            clonedContainer.querySelectorAll('script, style, .article__footer, .popup--share, .article__header').forEach(el => el.remove());
            const descriptionText = clonedContainer.innerText.trim();
            if (descriptionText) {
                return descriptionText;
            }
        }

        // --- 2. Fallback Method: If the primary selector fails, analyze the page for the largest text block. ---
        
        let bestCandidateText = '';
        let maxScore = 0;

        // Select all major elements that might contain the main content.
        const allPotentialElements = document.querySelectorAll('div, section, article');

        allPotentialElements.forEach(element => {
            // Basic filtering to ignore common non-content areas.
            if (
                element.offsetParent === null || // Exclude hidden elements
                element.closest('header, footer, nav, aside, form') ||
                element.tagName.toLowerCase() === 'script' ||
                element.tagName.toLowerCase() === 'style'
            ) {
                return;
            }

            const clonedElement = element.cloneNode(true);
            // Clean out interactive or non-content tags from the candidate element before scoring.
            clonedElement.querySelectorAll('script, style, button, a, nav, form, header, footer').forEach(el => el.remove());
            
            const text = clonedElement.innerText.trim();
            const textLength = text.length;

            // Simple scoring: longer text is better.
            // We can add more heuristics here if needed, but length is a strong indicator.
            if (textLength > maxScore) {
                // Check if this new candidate is just a parent of the old one.
                // If so, we prefer the child (more specific).
                // But if the new text is significantly larger, it might be the right container.
                if (!bestCandidateText.includes(text) || textLength > bestCandidateText.length + 200) {
                    maxScore = textLength;
                    bestCandidateText = text;
                }
            }
        });

        if (bestCandidateText) {
            // Add a prefix to let the user know this result is from the fallback method.
            return `[Fallback Analysis]: ${bestCandidateText}`;
        }

        // --- 3. Final Error if both methods fail. ---
        return `Scraper Error: Could not find description using specific selector or fallback analysis.`;

    } catch (e) {
        return `An error occurred while scraping the description: ${e.message}`;
    }
})();
