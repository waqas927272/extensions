(() => {
    try {
        let completeData = '';

        function cleanText(text) {
            return String(text || '')
                .replace(/\u00a0/g, ' ')
                .replace(/[ \t]+/g, ' ')
                .replace(/\s+\n/g, '\n')
                .replace(/\n\s+/g, '\n')
                .trim();
        }

        function elementText(selector, root = document) {
            const el = root.querySelector(selector);
            return el ? cleanText(el.innerText || el.textContent || '') : '';
        }

        function metaContent(selector, root = document) {
            const el = root.querySelector(selector);
            return el ? cleanText(el.getAttribute('content') || '') : '';
        }

        function getJsonLdJobPostings() {
            const postings = [];
            const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');

            function collectJobPostings(data) {
                if (!data) return;
                if (Array.isArray(data)) {
                    data.forEach(collectJobPostings);
                    return;
                }
                if (data['@graph']) {
                    collectJobPostings(data['@graph']);
                }
                if (data['@type'] === 'JobPosting' || (Array.isArray(data['@type']) && data['@type'].includes('JobPosting'))) {
                    postings.push(data);
                }
            }

            for (const script of jsonLdScripts) {
                try {
                    collectJobPostings(JSON.parse(script.textContent));
                } catch (e) {
                    console.warn('Error parsing JSON-LD:', e);
                }
            }

            return postings;
        }

        function formatAddressFromJsonLd(addr) {
            if (!addr) return '';
            const street = addr.streetAddress || '';
            const city = addr.addressLocality || '';
            const stateZip = [addr.addressRegion || '', addr.postalCode || ''].filter(Boolean).join(' ');
            const country = addr.addressCountry || '';
            return [street, city, stateZip, country].filter(Boolean).join(', ');
        }

        function formatJsonLdPosting(data) {
            let jsonLdData = '';
            jsonLdData += `\n=== JOB POSTING DATA ===\n`;
            jsonLdData += `Title: ${data.title || ''}\n`;
            jsonLdData += `Date Posted: ${data.datePosted || ''}\n`;
            jsonLdData += `Industry/Category: ${data.industry || ''}\n`;
            jsonLdData += `Employment Type: ${data.employmentType || ''}\n`;

            if (data.hiringOrganization && data.hiringOrganization.name) {
                jsonLdData += `Hiring Organization: ${data.hiringOrganization.name}\n`;
            }

            if (data.jobLocation) {
                const locations = Array.isArray(data.jobLocation) ? data.jobLocation : [data.jobLocation];
                jsonLdData += `Locations:\n`;
                locations.forEach(loc => {
                    if (loc.address) {
                        const addr = loc.address;
                        jsonLdData += `  - ${addr.addressLocality || ''}, ${addr.addressRegion || ''}, ${addr.addressCountry || ''}\n`;
                        const fullAddress = formatAddressFromJsonLd(addr);
                        if (fullAddress) jsonLdData += `${fullAddress}\n`;
                    }
                });
            }

            if (data.baseSalary && data.baseSalary.value) {
                const salary = data.baseSalary.value;
                if (salary.minValue || salary.maxValue) {
                    jsonLdData += `Salary Range: ${salary.currency || '$'}${salary.minValue || ''} - ${salary.maxValue || ''} ${salary.unitText || ''}\n`;
                }
            }

            if (data.description) {
                const temp = document.createElement('div');
                temp.innerHTML = data.description;
                jsonLdData += `\n=== FULL JOB DESCRIPTION ===\n`;
                jsonLdData += cleanText(temp.innerText || temp.textContent || '') + '\n';
            }

            return jsonLdData;
        }

        function getSmartRecruitersData() {
            const root = document.querySelector('.jobad-container, main.jobad-main, main[itemtype="http://schema.org/JobPosting"], [itemscope][itemtype="http://schema.org/JobPosting"]');
            if (!root) return '';

            const lines = [];
            const title = elementText('.job-title[itemprop="title"], .job-title, h1[itemprop="title"], h1', root);
            const logoLinkTitle = cleanText(root.querySelector('.jobad-header .logo a[title], .header-logo a[title]')?.getAttribute('title') || '');
            const logoAlt = cleanText((root.querySelector('.jobad-header .logo img[alt], .header-logo img[alt]')?.getAttribute('alt') || '').replace(/\s+logo$/i, ''));
            const hospitalName = logoLinkTitle || logoAlt;
            const datePosted = metaContent('meta[itemprop="datePosted"]', root);
            const industry = metaContent('meta[itemprop="industry"]', root);
            const employmentType = elementText('[itemprop="employmentType"]', root);
            const hiringOrganization = metaContent('[itemprop="hiringOrganization"] meta[itemprop="name"]', root);
            const locationNode = root.querySelector('spl-job-location[formattedaddress]');
            const formattedAddress = locationNode ? cleanText(locationNode.getAttribute('formattedaddress') || '') : '';
            const streetAddress = metaContent('meta[itemprop="streetAddress"]', root);
            const city = metaContent('meta[itemprop="addressLocality"]', root);
            const state = metaContent('meta[itemprop="addressRegion"]', root);
            const zipCode = metaContent('meta[itemprop="postalCode"]', root);
            const country = metaContent('meta[itemprop="addressCountry"]', root);
            const salaryValues = Array.from(root.querySelectorAll('.salary-value[data-value]'))
                .map(el => Number(el.getAttribute('data-value')))
                .filter(value => Number.isFinite(value) && value > 0);
            const salaryText = Array.from(root.querySelectorAll('.job-detail, li'))
                .map(el => cleanText(el.innerText || el.textContent || ''))
                .find(line => /\bcompensation\b|\bsalary\b|\bUSD\b.*\b(?:yearly|monthly|hourly)\b/i.test(line)) || '';
            const descriptionEl = root.querySelector('[itemprop="description"]');
            const descriptionText = descriptionEl ? cleanText(descriptionEl.innerText || descriptionEl.textContent || '') : '';

            lines.push('=== JOB POSTING DATA ===');
            if (title) lines.push(`Title: ${title}`);
            if (hospitalName) lines.push(`Hospital Name: ${hospitalName}`);
            if (datePosted) lines.push(`Date Posted: ${datePosted}`);
            if (industry) lines.push(`Industry/Category: ${industry}`);
            if (employmentType) lines.push(`Employment Type: ${employmentType}`);
            if (hiringOrganization) lines.push(`Hiring Organization: ${hiringOrganization}`);

            lines.push('Locations:');
            if (city || state || country) {
                lines.push(`  - ${[city, state, country].filter(Boolean).join(', ')}`);
            }
            if (formattedAddress) {
                lines.push(formattedAddress);
            } else {
                const stateZip = [state, zipCode].filter(Boolean).join(' ');
                const fullAddress = [streetAddress, city, stateZip, country].filter(Boolean).join(', ');
                if (fullAddress) lines.push(fullAddress);
            }

            if (salaryValues.length) {
                const minSalary = Math.min(...salaryValues);
                const maxSalary = Math.max(...salaryValues);
                lines.push(`Salary Range: USD${minSalary} - ${maxSalary} yearly`);
            }
            if (salaryText) lines.push(cleanText(salaryText));
            if (descriptionText) {
                lines.push('');
                lines.push('=== FULL JOB DESCRIPTION ===');
                lines.push(descriptionText);
            }

            const text = lines.filter(line => line !== null && line !== undefined).join('\n');
            return text.length > 100 ? text : '';
        }

        // 1. Extract JSON-LD structured data first (contains rich metadata)
        const jsonLdPostings = getJsonLdJobPostings();
        let jsonLdData = '';
        jsonLdPostings.forEach(data => {
            jsonLdData += formatJsonLdPosting(data);
        });

        // 2. Extract SmartRecruiters schema.org microdata and description content.
        const smartRecruitersData = getSmartRecruitersData();

        // 3. Get the complete text from .jv-wrapper (contains everything visible on JazzHR pages)
        const wrapperElement = document.querySelector('.jv-wrapper');
        let wrapperText = '';
        if (wrapperElement) {
            wrapperText = wrapperElement.innerText.trim();
        }

        // 4. Combine sources by relevance.
        if (smartRecruitersData.length > 100) {
            completeData = smartRecruitersData;
            if (jsonLdData.length > 100 && !completeData.includes('=== FULL JOB DESCRIPTION ===')) {
                completeData += `\n\n${jsonLdData}`;
            }
        } else if (jsonLdData.length > 100) {
            completeData = jsonLdData;
            if (wrapperText && wrapperText.length > 100) {
                completeData += `\n\n=== ADDITIONAL PAGE CONTENT ===\n${wrapperText}`;
            }
        } else if (wrapperText.length > 100) {
            completeData = wrapperText;
        } else {
            const selectors = [
                '[itemprop="description"]',
                '.jobad-container',
                'main[itemtype="http://schema.org/JobPosting"]',
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
            completeData = cleanText(completeData).replace(/\n{3,}/g, '\n\n');
            return completeData.trim();
        }

        return '';
    } catch (e) {
        return `Error scraping description: ${e.message}`;
    }
})();
