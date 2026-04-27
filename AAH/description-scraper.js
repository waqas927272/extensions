(() => {
    try {
        let completeData = '';

        // 1. Extract JSON-LD structured data first (contains rich metadata)
        const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
        let jsonLdData = '';
        for (const script of jsonLdScripts) {
            try {
                const data = JSON.parse(script.textContent);
                if (data['@type'] === 'JobPosting') {
                    // Format JSON data as readable text
                    jsonLdData += `\n=== JOB POSTING DATA ===\n`;
                    jsonLdData += `Title: ${data.title || ''}\n`;
                    jsonLdData += `Date Posted: ${data.datePosted || ''}\n`;
                    jsonLdData += `Industry/Category: ${data.industry || ''}\n`;
                    jsonLdData += `Employment Type: ${data.employmentType || ''}\n`;

                    // Extract organization name
                    if (data.hiringOrganization && data.hiringOrganization.name) {
                        jsonLdData += `Hiring Organization: ${data.hiringOrganization.name}\n`;
                    }

                    // Extract all job locations
                    if (data.jobLocation) {
                        const locations = Array.isArray(data.jobLocation) ? data.jobLocation : [data.jobLocation];
                        jsonLdData += `Locations:\n`;
                        locations.forEach(loc => {
                            if (loc.address) {
                                const addr = loc.address;
                                jsonLdData += `  - ${addr.addressLocality || ''}, ${addr.addressRegion || ''}, ${addr.addressCountry || ''}\n`;
                            }
                        });
                    }

                    // Extract salary if available
                    if (data.baseSalary && data.baseSalary.value) {
                        const salary = data.baseSalary.value;
                        if (salary.minValue || salary.maxValue) {
                            jsonLdData += `Salary Range: ${salary.currency || '$'}${salary.minValue || ''} - ${salary.maxValue || ''} ${salary.unitText || ''}\n`;
                        }
                    }

                    // Extract and clean description from JSON-LD
                    if (data.description) {
                        const temp = document.createElement('div');
                        temp.innerHTML = data.description;
                        jsonLdData += `\n=== FULL JOB DESCRIPTION ===\n`;
                        jsonLdData += temp.innerText.trim() + '\n';
                    }
                }
            } catch (e) {
                console.warn('Error parsing JSON-LD:', e);
            }
        }

        // 2. Get the complete text from .jv-wrapper (contains everything visible on the page)
        const wrapperElement = document.querySelector('.jv-wrapper');
        let wrapperText = '';
        if (wrapperElement) {
            wrapperText = wrapperElement.innerText.trim();
        }

        // 3. Combine both sources - prioritize JSON-LD data, then add wrapper text for any additional info
        if (jsonLdData.length > 100) {
            completeData = jsonLdData;
            // Add any additional text from wrapper that might not be in JSON-LD
            if (wrapperText && wrapperText.length > 100) {
                completeData += `\n\n=== ADDITIONAL PAGE CONTENT ===\n${wrapperText}`;
            }
        } else if (wrapperText.length > 100) {
            // Fallback to wrapper text if JSON-LD is not available
            completeData = wrapperText;
        } else {
            // Last resort: try other selectors
            const selectors = [
                '.jv-page-body',
                '.jv-job-detail',
                'body'
            ];

            for (const selector of selectors) {
                const el = document.querySelector(selector);
                if (el && el.innerText.trim().length > 100) {
                    completeData = el.innerText.trim();
                    break;
                }
            }
        }

        // Clean up the final text
        if (completeData) {
            // Remove excessive whitespace and normalize line breaks
            completeData = completeData.replace(/\n{3,}/g, '\n\n');
            completeData = completeData.replace(/\t+/g, ' ');
            return completeData.trim();
        }

        return '';
    } catch (e) {
        return `Error scraping description: ${e.message}`;
    }
})();
