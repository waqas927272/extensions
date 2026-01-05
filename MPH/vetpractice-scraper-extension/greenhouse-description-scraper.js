(() => {
    // This script is injected into a boards.greenhouse.io job page.
    try {
        // Greenhouse job pages typically have the main content in an element with id="content"
        const content = document.getElementById('content');
        if (content) {
            const clonedContent = content.cloneNode(true);
            // Remove any known non-description elements like social media links, job application forms, etc.
            clonedContent.querySelectorAll('.social-media-links, form, #job-app').forEach(el => el.remove());
            return clonedContent.innerText.trim();
        }
        return 'Scraper Error: Could not find #content element on the Greenhouse page.';
    } catch (e) {
        return `An error occurred while scraping the description: ${e.message}`;
    }
})();