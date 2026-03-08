(() => {
    // This script is injected into vetpracticepartners.com/current-openings/
    const jobs = [];
    const jobElements = document.querySelectorAll('a.job-openings-item');

    jobElements.forEach(el => {
        const jobTitle = el.querySelector('.job-openings-item-title')?.innerText.trim();
        const hospital = el.querySelector('.job-openings-item-hospital')?.innerText.trim();
        const locationText = el.querySelector('.job-openings-item-location')?.innerText.trim();
        const link = el.href;

        if (!jobTitle || !link || !link.includes('greenhouse.io')) {
            // Skip if it's not a valid job link to greenhouse
            return;
        }

        let city = 'N/A';
        let state = 'N/A';

        if (locationText) {
            const parts = locationText.split(',').map(p => p.trim());
            if (parts.length === 2) {
                city = parts[0];
                state = parts[1];
            } else {
                // Handle cases like "Boston, MA (Remote)"
                city = locationText.split(',')[0].trim();
                const stateMatch = locationText.match(/,\s*([A-Z]{2})/);
                if (stateMatch) {
                    state = stateMatch[1];
                }
            }
        }
        
        // Use the job link for a unique ID
        const jobIdMatch = link.match(/jobs\/(\d+)/);
        const rawJobId = jobIdMatch ? jobIdMatch[1] : link;
        const jobId = rawJobId ? 'VPP-' + rawJobId : '';

        jobs.push({
            id: jobId, // For deduplication
            jobId,
            jobTitle,
            location: hospital || 'N/A', // Map to 'location' to match the data model
            city,
            state,
            link,
            source: 'Veterinary Practice Partners' // Add a source field
        });
    });

    return jobs;
})();
