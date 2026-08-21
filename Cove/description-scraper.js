(async () => {
    try {
        const CLEARCOMPANY_SITE_IDS = {
            'www.coveanimalhealth.com': 'ca7d62b3-173f-f1c4-321f-8e9bff89d765',
            'coveanimalhealth.com': 'ca7d62b3-173f-f1c4-321f-8e9bff89d765'
        };

        function htmlToText(html) {
            const temp = document.createElement('div');
            temp.innerHTML = html || '';
            return temp.innerText.trim();
        }

        function formatClearCompanyJob(job) {
            if (!job || !job.description) return '';

            let output = '';
            output += `\n=== JOB POSTING DATA ===\n`;
            output += `Title: ${job.positionTitle || ''}\n`;
            output += `Date Posted: ${job.postedDate || job.openDate || ''}\n`;
            output += `Industry/Category: ${job.departmentName || ''}\n`;
            output += `Employment Type: ${job.employmentType || ''}\n`;
            output += `Hiring Organization: ${job.officeName || job.brandName || ''}\n`;
            output += `Office Name: ${job.officeName || ''}\n`;
            output += `Brand Name: ${job.brandName || ''}\n`;

            if (Array.isArray(job.locations) && job.locations.length > 0) {
                output += `Locations:\n`;
                job.locations.forEach(loc => {
                    const city = loc.city || '';
                    const state = loc.subdivision || loc.subdivisionFullName || '';
                    const country = loc.country || '';
                    output += `  - ${[city, state, country].filter(Boolean).join(', ')}\n`;
                });
            } else if (job.location) {
                output += `Locations:\n  - ${job.location}\n`;
            }

            output += `\n=== FULL JOB DESCRIPTION ===\n`;
            output += htmlToText(job.description) + '\n';
            return output.trim();
        }

        async function scrapeClearCompanyDescription() {
            const siteId = CLEARCOMPANY_SITE_IDS[window.location.hostname.toLowerCase()];
            if (!siteId) return '';

            const jobId = new URL(window.location.href).searchParams.get('jobId') ||
                new URL(window.location.href).searchParams.get('jobid');
            if (!jobId) return '';

            const apiUrl = `https://careers-api.clearcompany.com/v1/${siteId}/${encodeURIComponent(jobId)}?source=`;
            const response = await fetch(apiUrl);
            if (!response.ok) return '';

            const job = await response.json();
            return formatClearCompanyJob(job);
        }

        let clearCompanyData = '';
        try {
            clearCompanyData = await scrapeClearCompanyDescription();
        } catch (e) {
            console.warn('Error scraping ClearCompany description:', e);
        }
        if (clearCompanyData && clearCompanyData.length > 100) {
            return clearCompanyData;
        }

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
                        jsonLdData += `\n=== FULL JOB DESCRIPTION ===\n`;
                        jsonLdData += htmlToText(data.description) + '\n';
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
                '.cc-job-description-container',
                '.cc-job-description-text',
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
