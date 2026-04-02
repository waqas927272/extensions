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
    let currentJobIndex = 0;
    let detailsQueue = [];
    let currentDetailsIndex = 0;
    const getDescriptionsBtn = document.getElementById('getDescriptionsBtn');
    const fetchDetailsBtn = document.getElementById('fetchDetailsBtn');

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

        jobs.forEach(job => {
            const row = tableBody.insertRow();
            row.insertCell(0).textContent = job.title;
            const jobIdCell = row.insertCell(1);
            jobIdCell.textContent = job.jobId || 'N/A';
            jobIdCell.style.fontFamily = "'Consolas', 'Monaco', monospace";
            jobIdCell.style.fontSize = '12px';
            jobIdCell.style.color = '#64748b';
            row.insertCell(2).textContent = job.hospital;
            row.insertCell(3).textContent = job.city;
            row.insertCell(4).textContent = job.location;
            
            // New Detail Columns
            row.insertCell(5).textContent = job.areaOfPractice || '-';
            row.insertCell(6).textContent = job.position || '-';
            row.insertCell(7).textContent = job.salary || '-';

            const linkCell = row.insertCell(8);
            const link = document.createElement('a');
            link.href = job.link;
            link.textContent = 'View Job';
            link.target = '_blank';
            linkCell.appendChild(link);

            const descCell = row.insertCell(9);
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
            job.title.toLowerCase().includes(term) ||
            job.hospital.toLowerCase().includes(term) ||
            job.city.toLowerCase().includes(term) ||
            job.location.toLowerCase().includes(term)
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

        const headers = ['Job Title', 'Job ID', 'Hospital', 'City', 'Location', 'Area of Practice', 'Position', 'Salary', 'Link', 'Description'];
        const csvContent = [
            headers.join(','),
            ...allJobs.map(job => [
                `"${(job.title || '').replace(/"/g, '""')}"`,
                `"${(job.jobId || '').replace(/"/g, '""')}"`,
                `"${(job.hospital || '').replace(/"/g, '""')}"`,
                `"${(job.city || '').replace(/"/g, '""')}"`,
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

    // Clear records
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
            parent_client: "United Veterinary Care",
            city: job.city,
            state: job.state,
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
        } else if (message.action === 'detailsFetched') {
            const detailsList = Array.isArray(message.details) ? message.details : [message.details];
            
            chrome.storage.local.get(['scrapedJobs'], (data) => {
                const jobs = data.scrapedJobs || [];
                const originalJobIndex = message.jobIndex;
                const originalJob = jobs[originalJobIndex];

                if (originalJob && detailsList.length > 0) {
                    const isMultiPlaceholder = originalJob.location && (
                        originalJob.location.toLowerCase().includes('location') || 
                        originalJob.location.includes('...')
                    );

                    if (isMultiPlaceholder && detailsList.length > 1) {
                        // Split into multiple records
                        const firstDetails = detailsList[0];
                        originalJob.areaOfPractice = firstDetails.areaOfPractice || originalJob.areaOfPractice || '';
                        originalJob.position = firstDetails.position || originalJob.position || '';
                        originalJob.salary = firstDetails.salary || originalJob.salary || '';
                        originalJob.jobId = `${originalJob.jobId}-1`;
                        if (firstDetails.hospitalName) originalJob.hospital = firstDetails.hospitalName;
                        if (firstDetails.city) originalJob.city = firstDetails.city;
                        if (firstDetails.state) originalJob.state = firstDetails.state;
                        if (firstDetails.location) originalJob.location = firstDetails.location;

                        for (let i = 1; i < detailsList.length; i++) {
                            const extraLoc = detailsList[i];
                            const newJob = { 
                                ...originalJob,
                                jobId: `${originalJob.jobId.split('-')[0]}-${i + 1}`,
                                city: extraLoc.city,
                                state: extraLoc.state,
                                location: extraLoc.location || `${extraLoc.city}, ${extraLoc.state}`
                            };
                            jobs.push(newJob);
                        }
                    } else {
                        // Just update the single record
                        const details = detailsList[0];
                        originalJob.areaOfPractice = details.areaOfPractice || originalJob.areaOfPractice || '';
                        originalJob.position = details.position || originalJob.position || '';
                        originalJob.salary = details.salary || originalJob.salary || '';
                        if (details.hospitalName) originalJob.hospital = details.hospitalName;
                        if (details.city) originalJob.city = details.city;
                        if (details.state) originalJob.state = details.state;
                        if (details.location && !isMultiPlaceholder) originalJob.location = details.location;
                    }

                    chrome.storage.local.set({ scrapedJobs: jobs }, () => {
                        allJobs = jobs;
                        displayRecords(allJobs);
                        if (isFetchingDetails) {
                            currentDetailsIndex++;
                            setTimeout(() => processNextDetail(), 1500);
                        }
                    });
                } else if (isFetchingDetails) {
                    currentDetailsIndex++;
                    setTimeout(() => processNextDetail(), 1500);
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

        const jobsToFetch = jobs.map((job, index) => ({ job, index }))
            .filter(item => {
                const needsDetails = !item.job.areaOfPractice || !item.job.position || !item.job.salary;
                const isMultiLocation = item.job.location && (item.job.location.toLowerCase().includes('location') || item.job.location.includes('...'));
                return needsDetails || isMultiLocation;
            });

        if (jobsToFetch.length === 0) {
            if (confirm('All jobs already have details. Do you want to re-fetch details for all jobs?')) {
                detailsQueue = jobs.map((job, index) => ({ job, index }));
            } else {
                return;
            }
        } else {
            detailsQueue = jobsToFetch;
        }

        isFetchingDetails = true;
        currentDetailsIndex = 0;
        fetchDetailsBtn.disabled = true;
        fetchDetailsBtn.textContent = 'Fetching Details...';

        // Show progress
        const progressSection = document.getElementById('progressSection');
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        const progressLabel = document.getElementById('progressLabel');
        progressSection.classList.remove('hidden');
        progressLabel.textContent = 'Fetching Details';
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
        fetchDetailsBtn.textContent = `Fetching... (${currentDetailsIndex + 1}/${detailsQueue.length})`;

        chrome.runtime.sendMessage({
            action: 'fetchJobDetails',
            url: job.link,
            jobIndex: index
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
        showToast('Details fetching completed!', 'success');
    }
});
