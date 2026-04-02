document.addEventListener('DOMContentLoaded', () => {
    const tableBody = document.querySelector('#jobRecordsTable tbody');
    const tableHeaders = document.querySelectorAll('#jobRecordsTable th');
    const clearRecordsButton = document.getElementById('clearRecords');
    const webhookUrlInput = document.getElementById('webhookUrl');
    const sendToWebhookButton = document.getElementById('sendToWebhook');
    const totalCountElement = document.getElementById('totalCount');
    const emptyState = document.getElementById('emptyState');
    const table = document.getElementById('jobRecordsTable');
    const searchInput = document.getElementById('searchInput');
    const exportCsvButton = document.getElementById('exportCsv');
    const toastContainer = document.getElementById('toastContainer');

    let currentSortColumn = null;
    let currentSortDirection = 'asc';
    let allJobs = [];
    let isGettingDescriptions = false;
    let isFetchingDetails = false;
    let isFetchingAddresses = false;
    let currentJobIndex = 0;
    let detailsQueue = [];
    let currentDetailsIndex = 0;
    let addressQueue = [];
    let currentAddressIndex = 0;
    const getDescriptionsBtn = document.getElementById('getDescriptionsBtn');
    const fetchDetailsBtn = document.getElementById('fetchDetailsBtn');
    const fetchAddressesBtn = document.getElementById('fetchAddressesBtn');

    const BASE_GAP = 1500; // 1.5 seconds between Nominatim requests
    let lastNominatimRequest = 0;

    // ============ LOCAL DETAIL EXTRACTION (mirrors detail-extractor.js) ============

    function extractDetailsFromDescription(positionTitle, descriptionText) {
        // Extract salary from stored description (which now includes JSON-LD data)
        function extractSalary(text) {
            if (!text) return '';

            // Try to extract from JSON-LD data in the text
            const jsonLdMatch = text.match(/Salary Range:\s*([^\n]+)/i);
            if (jsonLdMatch) {
                return jsonLdMatch[1].trim();
            }

            // Fallback to text pattern matching
            const salaryPatterns = [
                /(?:Pay|Salary|Compensation)[:\s]+\$([\d,]+(?:\.\d{2})?(?:\s*[-–]\s*\$[\d,]+(?:\.\d{2})?)?(?:\s*per\s*\w+)?)/i,
                /\$[\d,]+k?\s*[-–]+\s*\$?[\d,]+k/i,
                /\$[\d,]+(?:,\d{3})*\s*[-–]+\s*\$[\d,]+(?:,\d{3})*/i,
                /\$[\d,]+(?:\.\d{2})?\s*(?:per\s+)?(?:hourly|hour|hr|\/hr)/i,
                /\$[\d,]+(?:\.\d{2})?\s*(?:per\s+)?(?:year|annually|annum|annual)/i,
                /\$[\d,]+k\+?/i
            ];
            for (const pattern of salaryPatterns) {
                const m = text.match(pattern);
                if (m) return m[0].trim();
            }
            return '';
        }

        // Determine Area of Practice
        function determineAreaOfPractice(positionText, descriptionText) {
            const combined = (positionText + ' ' + descriptionText).toLowerCase();

            // Check for specialty indicators first
            const specialtyIndicators = ['board certified', 'residency trained', 'residential trained', 'dacv', 'diplomate'];
            for (const indicator of specialtyIndicators) {
                if (combined.includes(indicator)) {
                    return 'Specialty Care';
                }
            }

            // Check for specialty keywords (excluding 'dentist' since dental work is common in general practice)
            const specialtyKeywords = ['criticalist', 'oncologist', 'internist', 'neurologist', 'cardiologist',
                                       'surgeon', 'radiologist', 'ophthalmologist', 'anesthesiologist',
                                       'dermatologist', 'theriogenologist', 'specialist', 'dacvecc', 'dacvim',
                                       'dacvr', 'dacvs', 'acvs', 'dacvd', 'dacvo', 'dacvaa', 'dact', 'davdc'];
            for (const kw of specialtyKeywords) {
                if (combined.includes(kw)) {
                    // Additional check: if it's "surgeon" or "specialist", verify board certification/residency
                    if ((kw === 'surgeon' || kw === 'specialist') &&
                        !combined.includes('board certified') &&
                        !combined.includes('residency trained') &&
                        !combined.includes('diplomate') &&
                        !combined.includes('dacv')) {
                        continue; // Skip, likely general practice
                    }
                    return 'Specialty Care';
                }
            }

            // Check for Emergency Care
            const emergencyKeywords = ['emergency veterinarian', 'er vet', 'er veterinarian', 'er dvm', 'ecc', 'emergency & critical care'];
            for (const kw of emergencyKeywords) {
                if (combined.includes(kw)) {
                    return 'Emergency Care';
                }
            }

            // Check for Urgent Care
            const urgentKeywords = ['urgent care', 'urgent veterinarian', 'quick care'];
            for (const kw of urgentKeywords) {
                if (combined.includes(kw)) {
                    return 'Urgent Care';
                }
            }

            // Check for Large Animal / Equine / Exotics
            const specialAnimals = ['equine', 'bovine', 'large animal', 'avian', 'exotics'];
            for (const kw of specialAnimals) {
                if (combined.includes(kw)) {
                    return 'General Practice Care / Emergency Care / Urgent Care';
                }
            }

            // Default to General Practice
            return 'General Practice Care';
        }

        // Determine Position
        function determinePosition(positionText, descriptionText, areaOfPractice) {
            const combined = (positionText + ' ' + descriptionText).toLowerCase();

            if (areaOfPractice === 'Specialty Care') {
                // Specialty positions - only classify as specialist if board certified/residency trained
                if (combined.includes('ecc') || combined.includes('criticalist') || combined.includes('emergency & critical care')) return 'ECC Specialist';
                if (combined.includes('oncologist') && combined.includes('radiation')) return 'Radiation Oncologist';
                if (combined.includes('oncologist')) return 'Medical Oncologist';
                if (combined.includes('internist') || (combined.includes('internal medicine') && combined.includes('specialist'))) return 'Internal Medicine Specialist';
                if (combined.includes('neurologist') || combined.includes('neurosurgeon')) return 'Neurologist';
                if (combined.includes('cardiologist')) return 'Cardiologist';
                // For dental specialist, verify they have DAVDC or board certification
                if ((combined.includes('dental specialist') || combined.includes('davdc') || combined.includes('veterinary dental college')) &&
                    (combined.includes('board certified') || combined.includes('residency trained') || combined.includes('diplomate'))) {
                    return 'Dental Specialist';
                }
                if (combined.includes('dermatologist')) return 'Dermatologist';
                if (combined.includes('surgeon') && !combined.includes('neurosurgeon')) return 'Surgeon';
                if (combined.includes('radiologist') || combined.includes('diagnostic imaging')) return 'Radiologist';
                if (combined.includes('ophthalmologist')) return 'Ophthalmologist';
                if (combined.includes('anesthesiologist')) return 'Anesthesiologist';
                if (combined.includes('theriogenologist')) return 'Theriogenologist';
            }

            // Medical Director
            if (combined.includes('medical director')) return 'Medical Director';

            // Associate Veterinarian
            if (combined.includes('associate veterinarian') || combined.includes('associate vet')) return 'Associate Veterinarian';

            // Relief Veterinarian
            if (combined.includes('relief')) return 'Relief Veterinarian';

            // Equine/Bovine/Large Animal
            if (combined.includes('equine') || combined.includes('bovine') || combined.includes('large animal')) {
                return 'Equine/Bovine Veterinarian/Large Animal';
            }

            // Avian & Exotics
            if (combined.includes('avian') || combined.includes('exotics')) {
                return 'Avian & Exotics Veterinarian / Associate Exotics';
            }

            // Veterinary Technician
            if (combined.includes('technician') || combined.includes('vet tech') || combined.includes('cvt') ||
                combined.includes('lvt') || combined.includes('rvt') || combined.includes('vts')) {
                return 'Veterinary Technician';
            }

            // Veterinary Assistant
            if (combined.includes('assistant') || combined.includes('vet assist')) {
                return 'Veterinary Assistant';
            }

            // Receptionist
            if (combined.includes('receptionist') || combined.includes('front desk') || combined.includes('csr')) {
                return 'Receptionist';
            }

            // Externship
            if (combined.includes('externship') || combined.includes('extern')) {
                return 'Veterinary Externship';
            }

            // Default
            return 'Associate Veterinarian';
        }

        // Extract locations from stored description (which now includes JSON-LD data)
        function extractLocations(text) {
            const locations = [];

            // First try to extract from structured JSON-LD data in the text
            const locationsSection = text.match(/Locations:\n((?:\s*-\s*[^\n]+\n?)+)/i);
            if (locationsSection) {
                const locationLines = locationsSection[1].split('\n');
                for (const line of locationLines) {
                    const match = line.match(/\s*-\s*([^,]+),\s*([A-Z][a-z\s]+)/i);
                    if (match) {
                        const city = match[1].trim();
                        let state = match[2].trim();
                        // Handle full state names by converting to abbreviation (if needed)
                        // For now, just use first 2 chars if it's longer
                        if (state.length > 2) {
                            // Try to find state abbreviation pattern
                            const stateAbbrev = text.match(new RegExp(`${city},\\s*([A-Z]{2})\\b`));
                            if (stateAbbrev) {
                                state = stateAbbrev[1];
                            }
                        }
                        locations.push({ city, state, location: `${city}, ${state}` });
                    }
                }
            }

            // If no locations found, fall back to pattern matching
            if (locations.length === 0) {
                // Clean up the text
                text = text.replace(/^Description\s*/i, '');
                text = text.replace(/^Position at\s*/i, '');
                const searchText = text.substring(0, 500);

                // Match patterns like "City, ST" or "City, State"
                const matches = searchText.matchAll(/\b([A-Za-z][\w\s.'()-]*[A-Za-z])\s*,\s*([A-Z]{2})\b/g);
                for (const match of matches) {
                    let city = match[1].trim();
                    const state = match[2].trim();

                    // Filter out common non-city words
                    const invalidWords = ['description', 'position', 'associate', 'veterinarian', 'hospital', 'care', 'center', 'clinic', 'location'];
                    if (!invalidWords.some(word => city.toLowerCase().includes(word)) && city.length > 1 && city.length < 50) {
                        locations.push({ city, state, location: `${city}, ${state}` });
                    }
                }
            }

            // Deduplicate
            const uniqueLocations = [];
            const seen = new Set();
            for (const loc of locations) {
                const key = `${loc.city}|${loc.state}`.toLowerCase();
                if (!seen.has(key)) {
                    seen.add(key);
                    uniqueLocations.push(loc);
                }
            }

            return uniqueLocations;
        }

        // Extract hospital name from stored description (which now includes JSON-LD data)
        function extractHospitalName(text) {
            // First try to extract from structured JSON-LD data in the text
            const hiringOrgMatch = text.match(/Hiring Organization:\s*([^\n]+)/i);
            if (hiringOrgMatch) {
                return hiringOrgMatch[1].trim();
            }

            // Try to find "Position at [Hospital Name]"
            const positionAtMatch = text.match(/Position at\s+((?:[\w'.&-]+\s+){1,8}(?:Animal\s+Hospital|Veterinary\s+(?:Hospital|Center|Clinic|Care|Specialists?)|Pet\s+(?:Hospital|Clinic|Care)|Emergency\s+(?:Hospital|Center|Clinic)|The\s+[A-Z][\w\s]+Service))/i);
            if (positionAtMatch) {
                return positionAtMatch[1].trim();
            }

            // Try to find hospital name from description
            const hospitalMatch = text.match(/at\s+((?:[\w'.&-]+\s+){1,5}(?:Animal\s+Hospital|Veterinary\s+(?:Hospital|Center|Clinic|Care|Specialists?)|Pet\s+(?:Hospital|Clinic|Care)|Emergency\s+(?:Hospital|Center|Clinic)|The\s+[A-Z][\w\s]+Service))\b/i);
            if (hospitalMatch) {
                return hospitalMatch[1].trim();
            }

            return '';
        }

        // Run all extractions
        const salary = extractSalary(descriptionText);
        const areaOfPractice = determineAreaOfPractice(positionTitle, descriptionText);
        const position = determinePosition(positionTitle, descriptionText, areaOfPractice);
        const locations = extractLocations(descriptionText);
        const hospitalName = extractHospitalName(descriptionText);

        return {
            salary,
            areaOfPractice,
            position,
            locations,
            hospitalName
        };
    }

    // Nominatim API function to get street address and zip code
    // Uses hospital name and LOCATION column (not separate city/state)
    async function fetchAddressFromNominatim(hospitalName, location) {
        // Ensure 1.5 second gap between requests
        const now = Date.now();
        const timeSinceLastRequest = now - lastNominatimRequest;
        if (timeSinceLastRequest < BASE_GAP) {
            await new Promise(resolve => setTimeout(resolve, BASE_GAP - timeSinceLastRequest));
        }

        try {
            // Build query with hospital name, location (city, state), and USA
            const query = `${hospitalName}, ${location}, USA`;
            const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=3`;

            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'UnitedVeterinaryJobScraper/1.5'
                }
            });

            lastNominatimRequest = Date.now();

            if (!response.ok) {
                console.warn(`Nominatim API returned status ${response.status} for: ${query}`);
                return { streetAddress: '', zipCode: '', city: '', state: '' };
            }

            const data = await response.json();

            if (data && data.length > 0) {
                // Try to find the best match - prefer results with house numbers
                let bestResult = null;

                for (const result of data) {
                    const address = result.address || {};
                    if (address.house_number && address.road) {
                        bestResult = result;
                        break;
                    }
                }

                // If no result with house number, use the first result
                if (!bestResult) {
                    bestResult = data[0];
                }

                const address = bestResult.address || {};

                // Build street address - only include house number and road
                let streetAddress = '';
                if (address.house_number && address.road) {
                    streetAddress = `${address.house_number} ${address.road}`;
                } else if (address.road) {
                    streetAddress = address.road;
                }

                // Get zip code
                const zipCode = address.postcode || '';

                // Extract city and state from Nominatim response
                const city = address.city || address.town || address.village || '';
                const state = address.state || '';

                console.log(`Nominatim result for "${query}": Street="${streetAddress}", Zip="${zipCode}", City="${city}", State="${state}"`);
                return { streetAddress, zipCode, city, state };
            }

            console.warn(`No Nominatim results found for: ${query}`);
            return { streetAddress: '', zipCode: '', city: '', state: '' };
        } catch (error) {
            console.error('Nominatim API error:', error);
            return { streetAddress: '', zipCode: '', city: '', state: '' };
        }
    }

    if (!tableBody) {
        console.error('Could not find table body!');
        return;
    }

    // Toast notification function
    function showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        let icon = '';
        if (type === 'success') {
            icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z"/></svg>';
        } else if (type === 'error') {
            icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/></svg>';
        }

        toast.innerHTML = `${icon}<span>${message}</span>`;
        toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 4000);
    }

    function updateJobCount(count) {
        totalCountElement.textContent = count;
    }

    function displayRecords(jobs) {
        tableBody.innerHTML = '';
        updateJobCount(jobs.length);

        if (jobs.length === 0) {
            table.style.display = 'none';
            emptyState.classList.remove('hidden');
            return;
        }

        table.style.display = 'table';
        emptyState.classList.add('hidden');

        jobs.forEach((job, index) => {
            const row = tableBody.insertRow();

            // Mark new jobs with green background
            if (job.isNewLocation) {
                row.style.backgroundColor = '#d1fae5';
            }

            // Serial Number
            const serialCell = row.insertCell(0);
            serialCell.textContent = index + 1;
            serialCell.style.fontWeight = '600';
            serialCell.style.color = '#475569';
            serialCell.style.textAlign = 'center';

            row.insertCell(1).textContent = job.title;
            const jobIdCell = row.insertCell(2);
            jobIdCell.textContent = job.jobId || 'N/A';
            jobIdCell.style.fontFamily = "'Consolas', 'Monaco', monospace";
            jobIdCell.style.fontSize = '12px';
            jobIdCell.style.color = '#64748b';
            row.insertCell(3).textContent = job.hospital;
            row.insertCell(4).textContent = job.streetAddress || '-';
            row.insertCell(5).textContent = job.city;
            row.insertCell(6).textContent = job.state;
            row.insertCell(7).textContent = job.zipCode || '-';
            row.insertCell(8).textContent = job.location;

            // Detail Columns
            row.insertCell(9).textContent = job.areaOfPractice || '-';
            row.insertCell(10).textContent = job.position || '-';
            row.insertCell(11).textContent = job.salary || '-';

            const linkCell = row.insertCell(12);
            const link = document.createElement('a');
            link.href = job.link;
            link.textContent = 'View Job';
            link.target = '_blank';
            linkCell.appendChild(link);

            const descCell = row.insertCell(13);
            if (job.description) {
                const descDiv = document.createElement('div');
                descDiv.className = 'description-cell';
                descDiv.textContent = job.description;
                descCell.appendChild(descDiv);
            } else {
                descCell.innerHTML = '<span style="color: #94a3b8; font-style: italic; font-size: 12px;">Not scraped</span>';
            }
        });
    }

    function filterJobs(searchTerm) {
        if (!searchTerm) {
            displayRecords(allJobs);
            return;
        }

        const term = searchTerm.toLowerCase();
        const filtered = allJobs.filter(job =>
            (job.title || '').toLowerCase().includes(term) ||
            (job.hospital || '').toLowerCase().includes(term) ||
            (job.city || '').toLowerCase().includes(term) ||
            (job.state || '').toLowerCase().includes(term) ||
            (job.location || '').toLowerCase().includes(term) ||
            (job.streetAddress || '').toLowerCase().includes(term) ||
            (job.zipCode || '').toLowerCase().includes(term) ||
            (job.areaOfPractice || '').toLowerCase().includes(term) ||
            (job.position || '').toLowerCase().includes(term)
        );

        displayRecords(filtered);
    }

    function sortRecords(column, direction, records) {
        return [...records].sort((a, b) => {
            const valA = (a[column] || '').toLowerCase();
            const valB = (b[column] || '').toLowerCase();

            if (valA < valB) {
                return direction === 'asc' ? -1 : 1;
            }
            if (valA > valB) {
                return direction === 'asc' ? 1 : -1;
            }
            return 0;
        });
    }

    function exportToCSV() {
        if (!allJobs || allJobs.length === 0) {
            showToast('No jobs to export!', 'error');
            return;
        }

        const headers = ['#', 'Job Title', 'Job ID', 'Hospital', 'Street Address', 'City', 'State', 'Zip Code', 'Location', 'Area of Practice', 'Position', 'Salary', 'Link', 'Description'];
        const csvContent = [
            headers.join(','),
            ...allJobs.map((job, index) => [
                index + 1,
                `"${(job.title || '').replace(/"/g, '""')}"`,
                `"${(job.jobId || '').replace(/"/g, '""')}"`,
                `"${(job.hospital || '').replace(/"/g, '""')}"`,
                `"${(job.streetAddress || '').replace(/"/g, '""')}"`,
                `"${(job.city || '').replace(/"/g, '""')}"`,
                `"${(job.state || '').replace(/"/g, '""')}"`,
                `"${(job.zipCode || '').replace(/"/g, '""')}"`,
                `"${(job.location || '').replace(/"/g, '""')}"`,
                `"${(job.areaOfPractice || '').replace(/"/g, '""')}"`,
                `"${(job.position || '').replace(/"/g, '""')}"`,
                `"${(job.salary || '').replace(/"/g, '""')}"`,
                `"${(job.link || '').replace(/"/g, '""')}"`,
                `"${(job.description || '').replace(/"/g, '""')}"`
            ].join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);

        link.setAttribute('href', url);
        link.setAttribute('download', `uvc_jobs_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        showToast(`Exported ${allJobs.length} jobs to CSV!`, 'success');
    }

    // Initialize
    chrome.storage.local.get(['scrapedJobs'], (result) => {
        allJobs = result.scrapedJobs || [];
        displayRecords(allJobs);

        tableHeaders.forEach(header => {
            header.addEventListener('click', () => {
                const column = header.dataset.sort;
                if (!column) return;

                if (currentSortColumn === column) {
                    currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
                } else {
                    currentSortColumn = column;
                    currentSortDirection = 'asc';
                }

                tableHeaders.forEach(th => {
                    th.classList.remove('sort-asc', 'sort-desc');
                });

                header.classList.add(`sort-${currentSortDirection}`);

                const sortedJobs = sortRecords(currentSortColumn, currentSortDirection, allJobs);
                displayRecords(sortedJobs);
            });
        });
    });

    // Search functionality
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            filterJobs(e.target.value);
        });
    }

    // Export CSV
    if (exportCsvButton) {
        exportCsvButton.addEventListener('click', exportToCSV);
    }

    // Clear descriptions only
    const clearDescriptionsBtn = document.getElementById('clearDescriptions');
    clearDescriptionsBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all job descriptions? This will remove only the description field from all jobs.')) {
            chrome.storage.local.get(['scrapedJobs'], (data) => {
                const jobs = data.scrapedJobs || [];
                let clearedCount = 0;

                jobs.forEach(job => {
                    if (job.description) {
                        job.description = '';
                        clearedCount++;
                    }
                });

                chrome.storage.local.set({ scrapedJobs: jobs }, () => {
                    allJobs = jobs;
                    displayRecords(allJobs);
                    showToast(`Cleared descriptions from ${clearedCount} jobs!`, 'success');
                });
            });
        }
    });

    // Clear addresses only (city, state, street address, zip code)
    const clearAddressesBtn = document.getElementById('clearAddresses');
    clearAddressesBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all address data? This will remove City, State, Street Address, and Zip Code from all jobs (Location column will be kept).')) {
            chrome.storage.local.get(['scrapedJobs'], (data) => {
                const jobs = data.scrapedJobs || [];
                let clearedCount = 0;

                jobs.forEach(job => {
                    if (job.city || job.state || job.streetAddress || job.zipCode) {
                        job.city = '';
                        job.state = '';
                        job.streetAddress = '';
                        job.zipCode = '';
                        clearedCount++;
                    }
                });

                chrome.storage.local.set({ scrapedJobs: jobs }, () => {
                    allJobs = jobs;
                    displayRecords(allJobs);
                    showToast(`Cleared address data from ${clearedCount} jobs!`, 'success');
                });
            });
        }
    });

    // Clear all records
    clearRecordsButton.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all scraped job records?')) {
            chrome.storage.local.set({ scrapedJobs: [] }, () => {
                allJobs = [];
                displayRecords([]);
                showToast('All records cleared!', 'success');
            });
        }
    });

    // Send to webhook (batch sending)
    sendToWebhookButton.addEventListener('click', async () => {
        const webhookUrl = webhookUrlInput.value.trim();

        if (!webhookUrl) {
            showToast('Please enter a Webhook URL.', 'error');
            return;
        }

        try {
            new URL(webhookUrl);
        } catch (e) {
            showToast('Please enter a valid URL for the Webhook.', 'error');
            return;
        }

        const result = await chrome.storage.local.get(['scrapedJobs']);
        const jobs = result.scrapedJobs || [];

        if (jobs.length === 0) {
            showToast('No job records to send.', 'error');
            return;
        }

        const jobsToSend = jobs.map(job => ({
            job_title: job.title,
            job_id: job.jobId || '',
            department_id: job.jobId || '',
            hospital: job.hospital,
            street_address: job.streetAddress || '',
            parent_client: "United Veterinary Care",
            city: job.city,
            state: job.state,
            zip_code: job.zipCode || '',
            location: job.location,
            area_of_practice: job.areaOfPractice || '',
            position: job.position || '',
            salary: job.salary || '',
            job_type: job.jobType || '',
            url: job.link,
            link: job.link,
            description: job.description || ''
        }));

        const BATCH_SIZE = 50;
        const totalBatches = Math.ceil(jobsToSend.length / BATCH_SIZE);

        if (!confirm(`This will send ${jobsToSend.length} jobs in ${totalBatches} batch(es) of up to ${BATCH_SIZE}. Continue?`)) {
            return;
        }

        sendToWebhookButton.disabled = true;
        sendToWebhookButton.textContent = 'Sending...';

        // Show progress bar
        const progressSection = document.getElementById('progressSection');
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        const progressLabel = document.getElementById('progressLabel');
        progressSection.classList.remove('hidden');
        progressLabel.textContent = 'Sending Batches';
        progressText.textContent = `0 / ${totalBatches}`;
        progressBar.style.width = '0%';

        const syncId = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < totalBatches; i++) {
            const batch = jobsToSend.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
            const batchNumber = i + 1;

            const payload = {
                source: 'United Veterinary Job Scraper',
                parentClientName: 'United Veterinary Care',
                syncId: syncId,
                timestamp: new Date().toISOString(),
                batchNumber: batchNumber,
                totalBatches: totalBatches,
                batchSize: batch.length,
                totalRecords: jobsToSend.length,
                data: batch
            };

            try {
                const response = await fetch(webhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) {
                    throw new Error(`Status ${response.status}`);
                }

                successCount++;
            } catch (error) {
                console.error(`Batch ${batchNumber} error:`, error);
                failCount++;
            }

            // Update progress
            progressText.textContent = `${batchNumber} / ${totalBatches}`;
            progressBar.style.width = `${(batchNumber / totalBatches) * 100}%`;

            // Delay between batches
            if (i < totalBatches - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        // Hide progress bar
        progressSection.classList.add('hidden');
        sendToWebhookButton.disabled = false;
        sendToWebhookButton.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
              <path d="M4.93,3.93C3.12,5.74 2,8.24 2,11C2,13.76 3.12,16.26 4.93,18.07L6.34,16.66C4.89,15.22 4,13.22 4,11C4,8.79 4.89,6.78 6.34,5.34L4.93,3.93M19.07,3.93L17.66,5.34C19.11,6.78 20,8.79 20,11C20,13.22 19.11,15.22 17.66,16.66L19.07,18.07C20.88,16.26 22,13.76 22,11C22,8.24 20.88,5.74 19.07,3.93M7.76,6.76C6.67,7.85 6,9.35 6,11C6,12.65 6.67,14.15 7.76,15.24L9.17,13.83C8.45,13.11 8,12.11 8,11C8,9.89 8.45,8.89 9.17,8.17L7.76,6.76M16.24,6.76L14.83,8.17C15.55,8.89 16,9.89 16,11C16,12.11 15.55,13.11 14.83,13.83L16.24,15.24C17.33,14.15 18,12.65 18,11C18,9.35 17.33,7.85 16.24,6.76M12,9A2,2 0 0,0 10,11A2,2 0 0,0 12,13A2,2 0 0,0 14,11A2,2 0 0,0 12,9M11,15V19H10A1,1 0 0,0 9,20H2V22H9A1,1 0 0,0 10,23H14A1,1 0 0,0 15,22H22V20H15A1,1 0 0,0 14,19H13V15H11Z"/>
            </svg>
            Send to Webhook
        `;

        if (failCount === 0) {
            showToast(`All ${totalBatches} batch(es) sent successfully!`, 'success');
        } else {
            showToast(`${successCount} succeeded, ${failCount} failed.`, 'error');
        }
    });

    // ============ GET DESCRIPTIONS ============

    getDescriptionsBtn.addEventListener('click', async () => {
        if (isGettingDescriptions) {
            showToast('Already getting descriptions. Please wait...', 'error');
            return;
        }

        const data = await chrome.storage.local.get(['scrapedJobs']);
        const jobs = data.scrapedJobs || [];

        const jobsWithoutDesc = jobs.filter(job => !job.description && job.link);
        if (jobsWithoutDesc.length === 0) {
            showToast('All jobs already have descriptions!', 'success');
            return;
        }

        isGettingDescriptions = true;
        currentJobIndex = 0;

        getDescriptionsBtn.disabled = true;
        getDescriptionsBtn.textContent = 'Getting Descriptions...';

        // Show progress
        const progressSection = document.getElementById('progressSection');
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        const progressLabel = document.getElementById('progressLabel');
        progressSection.classList.remove('hidden');
        progressLabel.textContent = 'Getting Descriptions';
        progressText.textContent = `0 / ${jobsWithoutDesc.length}`;
        progressBar.style.width = '0%';

        processNextJob();
    });

    async function processNextJob() {
        const data = await chrome.storage.local.get(['scrapedJobs']);
        const jobs = data.scrapedJobs || [];

        const jobsWithoutDesc = jobs.filter(job => !job.description && job.link);
        const totalOriginal = jobs.filter(job => job.link).length;
        const totalWithoutDesc = jobsWithoutDesc.length;
        const processed = totalOriginal - totalWithoutDesc;

        // Update progress
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        const totalToProcess = allJobs.filter(job => !job.description && job.link).length;
        progressText.textContent = `${processed} / ${totalToProcess + processed}`;
        progressBar.style.width = `${(processed / (totalToProcess + processed)) * 100}%`;

        if (jobsWithoutDesc.length === 0) {
            isGettingDescriptions = false;
            getDescriptionsBtn.disabled = false;
            getDescriptionsBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20M13,13H11V18H13V13M13,9.5H11V11.5H13V9.5Z"/>
                </svg>
                Get Descriptions
            `;
            document.getElementById('progressSection').classList.add('hidden');
            showToast('All descriptions have been fetched!', 'success');
            return;
        }

        const job = jobsWithoutDesc[0];
        const jobIndex = jobs.findIndex(j => j.link === job.link);

        try {
            // Add nl=1 param so Jobvite serves the standalone page instead of redirecting to the parent site iframe
            const jobUrl = new URL(job.link);
            jobUrl.searchParams.set('nl', '1');
            const tab = await chrome.tabs.create({ url: jobUrl.toString(), active: false });
            chrome.runtime.sendMessage({
                action: 'scrapeJobDescription',
                tabId: tab.id,
                jobIndex: jobIndex,
                jobLink: job.link
            });
        } catch (error) {
            console.error('Error opening tab for job:', error);
            setTimeout(() => processNextJob(), 1500);
        }
    }

    // Listen for description saved messages from background.js
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'descriptionSaved') {
            chrome.storage.local.get(['scrapedJobs'], (data) => {
                const jobs = data.scrapedJobs || [];
                allJobs = jobs;
                displayRecords(allJobs);

                if (isGettingDescriptions) {
                    setTimeout(() => processNextJob(), 1500);
                }
            });
        }
    });

    // ============ FETCH DETAILS ============

    fetchDetailsBtn.addEventListener('click', async () => {
        if (isFetchingDetails) {
            showToast('Already fetching details. Please wait...', 'error');
            return;
        }

        const data = await chrome.storage.local.get(['scrapedJobs']);
        const jobs = data.scrapedJobs || [];

        // Only process jobs that have descriptions
        const jobsToFetch = jobs.map((job, index) => ({ job, index }))
            .filter(item => {
                // Must have a description to analyze
                if (!item.job.description || item.job.description.length < 50) {
                    return false;
                }
                // Check if needs details OR is multi-location
                const needsDetails = !item.job.areaOfPractice || !item.job.position || !item.job.salary;
                const isMultiLocation = item.job.location && (item.job.location.toLowerCase().includes('location') || item.job.location.includes('...'));
                return needsDetails || isMultiLocation;
            });

        if (jobsToFetch.length === 0) {
            // Check if there are jobs without descriptions
            const jobsWithoutDesc = jobs.filter(job => !job.description || job.description.length < 50);
            if (jobsWithoutDesc.length > 0) {
                showToast(`Please fetch descriptions first! ${jobsWithoutDesc.length} jobs need descriptions.`, 'error');
                return;
            }

            if (confirm('All jobs already have details. Do you want to re-analyze all jobs?')) {
                detailsQueue = jobs.map((job, index) => ({ job, index }))
                    .filter(item => item.job.description && item.job.description.length >= 50);
            } else {
                return;
            }
        } else {
            detailsQueue = jobsToFetch;
        }

        isFetchingDetails = true;
        currentDetailsIndex = 0;
        fetchDetailsBtn.disabled = true;
        fetchDetailsBtn.textContent = 'Analyzing Details...';

        // Show progress
        const progressSection = document.getElementById('progressSection');
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        const progressLabel = document.getElementById('progressLabel');
        progressSection.classList.remove('hidden');
        progressLabel.textContent = 'Analyzing Job Descriptions';
        progressText.textContent = `0 / ${detailsQueue.length}`;
        progressBar.style.width = '0%';

        processNextDetail();
    });

    async function processNextDetail() {
        if (currentDetailsIndex >= detailsQueue.length) {
            finishDetailsFetching();
            return;
        }

        const { job, index } = detailsQueue[currentDetailsIndex];

        // Update progress
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        progressText.textContent = `${currentDetailsIndex + 1} / ${detailsQueue.length}`;
        progressBar.style.width = `${((currentDetailsIndex + 1) / detailsQueue.length) * 100}%`;
        fetchDetailsBtn.textContent = `Analyzing... (${currentDetailsIndex + 1}/${detailsQueue.length})`;

        // Analyze the description locally (no tab opening needed)
        analyzeJobDescription(job, index);

        // Move to next detail after a short delay
        currentDetailsIndex++;
        setTimeout(() => processNextDetail(), 100);
    }

    // Analyze job description and extract details
    function analyzeJobDescription(job, jobIndex) {
        // Use the description that's already been fetched
        const description = job.description || '';
        const positionTitle = job.title || '';

        if (!description || description.length < 50) {
            console.warn(`Job ${jobIndex} has no description to analyze`);
            return;
        }

        // Extract details using the same logic as detail-extractor.js
        const extractedDetails = extractDetailsFromDescription(positionTitle, description);

        // Get jobs array
        chrome.storage.local.get(['scrapedJobs'], (data) => {
            const jobs = data.scrapedJobs || [];
            const originalJob = jobs[jobIndex];

            if (!originalJob) return;

            // Check if this is a multi-location job
            if (extractedDetails.locations.length > 1) {
                // Multi-location: Update original job and create new jobs below it
                const firstLocation = extractedDetails.locations[0];

                // Update original job with first location
                originalJob.areaOfPractice = extractedDetails.areaOfPractice || originalJob.areaOfPractice || '';
                originalJob.position = extractedDetails.position || originalJob.position || '';
                originalJob.salary = extractedDetails.salary || originalJob.salary || '';
                originalJob.city = firstLocation.city || originalJob.city;
                originalJob.state = firstLocation.state || originalJob.state;
                originalJob.location = firstLocation.location || originalJob.location;
                originalJob.hospital = extractedDetails.hospitalName || originalJob.hospital;
                originalJob.isNewLocation = true; // Mark as green

                // Create new jobs for additional locations - insert right after the original
                const newJobs = [];
                for (let i = 1; i < extractedDetails.locations.length; i++) {
                    const loc = extractedDetails.locations[i];
                    const baseJobId = originalJob.jobId.split('-')[0];
                    const newJob = {
                        ...originalJob,
                        jobId: `${baseJobId}-${i + 1}`,
                        // DO NOT populate city and state for new records
                        city: '',
                        state: '',
                        // Only populate location in format {city}, {state}
                        location: loc.location || `${loc.city}, ${loc.state}`,
                        streetAddress: '', // Will be fetched separately
                        zipCode: '', // Will be fetched separately
                        isNewLocation: true // Mark as green
                    };
                    newJobs.push(newJob);
                }

                // Insert new jobs right after the original job
                jobs.splice(jobIndex + 1, 0, ...newJobs);

            } else if (extractedDetails.locations.length === 1) {
                // Single location: Just update the job
                const location = extractedDetails.locations[0];
                originalJob.areaOfPractice = extractedDetails.areaOfPractice || originalJob.areaOfPractice || '';
                originalJob.position = extractedDetails.position || originalJob.position || '';
                originalJob.salary = extractedDetails.salary || originalJob.salary || '';
                originalJob.city = location.city || originalJob.city;
                originalJob.state = location.state || originalJob.state;
                originalJob.location = location.location || originalJob.location;
                originalJob.hospital = extractedDetails.hospitalName || originalJob.hospital;
            } else {
                // No location found, just update details
                originalJob.areaOfPractice = extractedDetails.areaOfPractice || originalJob.areaOfPractice || '';
                originalJob.position = extractedDetails.position || originalJob.position || '';
                originalJob.salary = extractedDetails.salary || originalJob.salary || '';
                originalJob.hospital = extractedDetails.hospitalName || originalJob.hospital;
            }

            // Save updated jobs
            chrome.storage.local.set({ scrapedJobs: jobs }, () => {
                allJobs = jobs;
                displayRecords(allJobs);
            });
        });
    }

    function finishDetailsFetching() {
        isFetchingDetails = false;
        fetchDetailsBtn.disabled = false;
        fetchDetailsBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4M11,7V13L16.2,16.2L17,14.9L12.5,12.2V7H11Z"/>
            </svg>
            Fetch Details
        `;
        document.getElementById('progressSection').classList.add('hidden');
        showToast(`Details analysis completed! Processed ${detailsQueue.length} jobs.`, 'success');
    }

    // ============ FETCH ADDRESSES ============

    fetchAddressesBtn.addEventListener('click', async () => {
        if (isFetchingAddresses) {
            showToast('Already fetching addresses. Please wait...', 'error');
            return;
        }

        const data = await chrome.storage.local.get(['scrapedJobs']);
        const jobs = data.scrapedJobs || [];

        // Find jobs that need addresses (using LOCATION column)
        const jobsNeedingAddresses = jobs.map((job, index) => ({ job, index }))
            .filter(item => {
                // Jobs that don't have street address or zip code
                return item.job.hospital && item.job.location &&
                    (!item.job.streetAddress || !item.job.zipCode);
            });

        if (jobsNeedingAddresses.length === 0) {
            if (confirm('All jobs already have addresses. Do you want to re-fetch addresses for all jobs?')) {
                addressQueue = jobs.map((job, index) => ({ job, index }))
                    .filter(item => item.job.hospital && item.job.location);
            } else {
                return;
            }
        } else {
            addressQueue = jobsNeedingAddresses;
        }

        if (addressQueue.length === 0) {
            showToast('No jobs have valid hospital/location data to fetch addresses.', 'error');
            return;
        }

        isFetchingAddresses = true;
        currentAddressIndex = 0;
        fetchAddressesBtn.disabled = true;
        fetchAddressesBtn.textContent = 'Fetching Addresses...';

        // Show progress
        const progressSection = document.getElementById('progressSection');
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        const progressLabel = document.getElementById('progressLabel');
        progressSection.classList.remove('hidden');
        progressLabel.textContent = 'Fetching Street Addresses & Zip Codes';
        progressText.textContent = `0 / ${addressQueue.length}`;
        progressBar.style.width = '0%';

        processNextAddress();
    });

    async function processNextAddress() {
        if (currentAddressIndex >= addressQueue.length) {
            finishAddressFetching();
            return;
        }

        const { job, index } = addressQueue[currentAddressIndex];

        // Update progress
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        progressText.textContent = `${currentAddressIndex + 1} / ${addressQueue.length}`;
        progressBar.style.width = `${((currentAddressIndex + 1) / addressQueue.length) * 100}%`;
        fetchAddressesBtn.textContent = `Fetching... (${currentAddressIndex + 1}/${addressQueue.length})`;

        try {
            // Fetch address from Nominatim using LOCATION column (not city/state)
            const addressData = await fetchAddressFromNominatim(job.hospital, job.location);

            // Update job with new address data
            const data = await chrome.storage.local.get(['scrapedJobs']);
            const jobs = data.scrapedJobs || [];

            if (jobs[index]) {
                jobs[index].streetAddress = addressData.streetAddress || '';
                jobs[index].zipCode = addressData.zipCode || '';
                // Also populate city and state from Nominatim response
                jobs[index].city = addressData.city || jobs[index].city || '';
                jobs[index].state = addressData.state || jobs[index].state || '';

                await chrome.storage.local.set({ scrapedJobs: jobs });

                // Update display
                allJobs = jobs;
                displayRecords(allJobs);
            }
        } catch (error) {
            console.error('Error fetching address:', error);
        }

        // Move to next address
        currentAddressIndex++;

        // Continue processing with delay (already handled by fetchAddressFromNominatim)
        setTimeout(() => processNextAddress(), 100);
    }

    function finishAddressFetching() {
        isFetchingAddresses = false;
        fetchAddressesBtn.disabled = false;
        fetchAddressesBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12,2C8.13,2 5,5.13 5,9C5,14.25 12,22 12,22C12,22 19,14.25 19,9C19,5.13 15.87,2 12,2M12,11.5C10.62,11.5 9.5,10.38 9.5,9C9.5,7.62 10.62,6.5 12,6.5C13.38,6.5 14.5,7.62 14.5,9C14.5,10.38 13.38,11.5 12,11.5Z"/>
            </svg>
            Fetch Addresses
        `;
        document.getElementById('progressSection').classList.add('hidden');
        showToast(`Address fetching completed! Fetched ${addressQueue.length} addresses.`, 'success');
    }
});
