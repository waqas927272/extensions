(() => {
    // This script is injected into vetpracticepartners.com/current-openings/
    const jobs = [];
    const jobElements = document.querySelectorAll('a.job-openings-item');

    // Mirror Encore's non-clinical keyword filter exactly.
    function shouldSkipByEncoreTitleKeywords(jobTitle) {
        if (!jobTitle) return false;

        // Same preprocessing as Encore: evaluate the primary role only.
        const titleBase = jobTitle.split(' - ')[0].trim();
        const primaryRole = titleBase.toLowerCase();

        // Explicitly skip known non-target roles requested for VPP.
        if (
            /\bswim instructor\b/i.test(primaryRole) ||
            /\b(?:certified\s*\/?\s*licensed|certified|licensed)\s+veterinary\s+technician\b/i.test(primaryRole)
        ) {
            return true;
        }

        return /\b(client service|service representative|receptionist|kennel|groomer|grooming|practice manager|hospital manager|office manager|administrator|billing|human resources|patient care coordinator|client care coordinator|customer service|front desk|inventory|housekeeper|janitorial|marketing|it technician|accountant|boarding assistant|assistant|technician|tech|externship|externships|extern|join our talent community)\b/.test(primaryRole);
    }

    jobElements.forEach(el => {
        const jobTitle = el.querySelector('.job-openings-item-title')?.innerText.trim();
        const hospital = el.querySelector('.job-openings-item-hospital')?.innerText.trim();
        const locationText = el.querySelector('.job-openings-item-location')?.innerText.trim();
        const link = el.href;

        if (!jobTitle || !link || !link.includes('greenhouse.io')) {
            // Skip if it's not a valid job link to greenhouse
            return;
        }

        // Skip only the exact non-clinical title keywords Encore skips.
        if (shouldSkipByEncoreTitleKeywords(jobTitle)) {
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
        
        // Use the Greenhouse job id for a stable, correct ID.
        let rawJobId = '';
        try {
            const url = new URL(link);
            rawJobId = url.searchParams.get('gh_jid') || '';
        } catch (error) {
            rawJobId = '';
        }
        if (!rawJobId) {
            const jobIdMatch = link.match(/(?:jobs\/|gh_jid=)(\d+)/);
            rawJobId = jobIdMatch ? jobIdMatch[1] : link;
        }
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
