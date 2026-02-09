(() => {
    try {
        // Use visible page text and extract between known section markers
        const bodyText = document.body.innerText;

        // Extract from "Position Overview" (skips company boilerplate)
        const startIdx = bodyText.indexOf('Position Overview');
        if (startIdx !== -1) {
            const afterStart = bodyText.substring(startIdx);

            // Find where the job description ends (application form or footer sections)
            const endMarkers = ['What We Offer', 'Apply for this', 'First Name', 'Submit Application', 'Equal Opportunity'];
            let endPos = afterStart.length;

            for (const marker of endMarkers) {
                const pos = afterStart.indexOf(marker);
                if (pos !== -1 && pos < endPos) {
                    endPos = pos;
                }
            }

            const description = afterStart.substring(0, endPos).trim();
            if (description.length > 50) {
                return description;
            }
        }

        return '';
    } catch (e) {
        return `Error scraping description: ${e.message}`;
    }
})();
