// Global variables
let isGettingDescriptions = false;
let isFetchingDetails = false;
let currentJobIndex = 0;
let allJobs = [];
let filteredJobs = [];
let currentSort = { field: null, direction: 'asc' };
let detailsQueue = [];
let currentDetailsIndex = 0;

// Load and display jobs when page loads
document.addEventListener('DOMContentLoaded', async () => {
    await loadJobs();

    // Add event listeners for buttons
    document.getElementById('exportCSV').addEventListener('click', exportToCSV);
    document.getElementById('exportJSON').addEventListener('click', exportToJSON);
    document.getElementById('clearData').addEventListener('click', clearData);
    document.getElementById('sendWebhookBtn').addEventListener('click', sendToWebhook);
    document.getElementById('getDescriptionsBtn').addEventListener('click', getJobDescriptions);
    document.getElementById('fetchDetailsBtn').addEventListener('click', fetchDetails);

    // Add event listeners for search and filters
    const searchInput = document.getElementById('searchInput');
    const clearSearchBtn = document.getElementById('clearSearch');
    const stateFilter = document.getElementById('stateFilter');
    const descriptionFilter = document.getElementById('descriptionFilter');

    searchInput.addEventListener('input', handleSearch);
    clearSearchBtn.addEventListener('click', clearSearch);
    stateFilter.addEventListener('change', applyFilters);
    descriptionFilter.addEventListener('change', applyFilters);

    // Add sorting listeners
    document.querySelectorAll('.sortable').forEach(th => {
        th.addEventListener('click', () => handleSort(th.dataset.sort));
    });
});

async function loadJobs() {
    try {
        const data = await chrome.storage.local.get(['scrapedJobs']);
        const jobs = data.scrapedJobs;

        if (!jobs || jobs.length === 0) {
            document.getElementById('noData').style.display = 'block';
            document.querySelector('.table-container').style.display = 'none';
            document.getElementById('statsDashboard').style.display = 'none';
            document.querySelector('.controls-section').style.display = 'none';
            document.querySelector('.webhook-section').style.display = 'none';
            document.getElementById('getDescriptionsBtn').style.display = 'none';
            return;
        }

        allJobs = jobs;
        filteredJobs = [...jobs];

        populateFilters();
        updateStatsDashboard();
        displayJobs(filteredJobs);
    } catch (error) {
        console.error('Error loading jobs:', error);
        alert('Error loading jobs data');
    }
}

function populateFilters() {
    const stateFilter = document.getElementById('stateFilter');
    const states = [...new Set(allJobs.map(job => job.state).filter(Boolean))].sort();

    // Clear existing options except the first one
    stateFilter.innerHTML = '<option value="">All States</option>';

    states.forEach(state => {
        const option = document.createElement('option');
        option.value = state;
        option.textContent = state;
        stateFilter.appendChild(option);
    });
}

function updateStatsDashboard() {
    const totalJobs = allJobs.length;
    const withDesc = allJobs.filter(job => job.description).length;
    const withoutDesc = totalJobs - withDesc;
    const uniqueLocations = new Set(allJobs.map(job => job.city).filter(Boolean)).size;

    document.getElementById('totalJobsStat').textContent = totalJobs;
    document.getElementById('withDescStat').textContent = withDesc;
    document.getElementById('withoutDescStat').textContent = withoutDesc;
    document.getElementById('uniqueLocationsStat').textContent = uniqueLocations;
    document.getElementById('statsDashboard').style.display = 'grid';
}

function handleSearch(e) {
    const searchTerm = e.target.value.toLowerCase().trim();
    const clearBtn = document.getElementById('clearSearch');

    if (searchTerm) {
        clearBtn.style.display = 'block';
    } else {
        clearBtn.style.display = 'none';
    }

    applyFilters();
}

function clearSearch() {
    const searchInput = document.getElementById('searchInput');
    searchInput.value = '';
    document.getElementById('clearSearch').style.display = 'none';
    applyFilters();
}

function applyFilters() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase().trim();
    const stateFilter = document.getElementById('stateFilter').value;
    const descFilter = document.getElementById('descriptionFilter').value;

    filteredJobs = allJobs.filter(job => {
        // Search filter
        const matchesSearch = !searchTerm ||
            job.jobTitle.toLowerCase().includes(searchTerm) ||
            job.location.toLowerCase().includes(searchTerm) ||
            job.city.toLowerCase().includes(searchTerm) ||
            job.state.toLowerCase().includes(searchTerm) ||
            (job.description && job.description.toLowerCase().includes(searchTerm));

        // State filter
        const matchesState = !stateFilter || job.state === stateFilter;

        // Description filter
        let matchesDesc = true;
        if (descFilter === 'with') {
            matchesDesc = !!job.description;
        } else if (descFilter === 'without') {
            matchesDesc = !job.description;
        }

        return matchesSearch && matchesState && matchesDesc;
    });

    // Reapply current sort
    if (currentSort.field) {
        sortJobs(currentSort.field, currentSort.direction);
    }

    displayJobs(filteredJobs);
}

function handleSort(field) {
    // Toggle direction if clicking the same field
    if (currentSort.field === field) {
        currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        currentSort.field = field;
        currentSort.direction = 'asc';
    }

    sortJobs(field, currentSort.direction);
    updateSortIndicators();
    displayJobs(filteredJobs);
}

function sortJobs(field, direction) {
    filteredJobs.sort((a, b) => {
        let aVal = a[field] || '';
        let bVal = b[field] || '';

        // Convert to lowercase for case-insensitive sorting
        if (typeof aVal === 'string') aVal = aVal.toLowerCase();
        if (typeof bVal === 'string') bVal = bVal.toLowerCase();

        if (aVal < bVal) return direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return direction === 'asc' ? 1 : -1;
        return 0;
    });
}

function updateSortIndicators() {
    document.querySelectorAll('.sortable').forEach(th => {
        th.classList.remove('asc', 'desc');
        if (th.dataset.sort === currentSort.field) {
            th.classList.add(currentSort.direction);
        }
    });
}

function displayJobs(jobs) {
    const tbody = document.getElementById('jobsTableBody');
    const tableContainer = document.querySelector('.table-container');
    const noResults = document.getElementById('noResults');

    tbody.innerHTML = '';

    if (jobs.length === 0) {
        tableContainer.style.display = 'none';
        noResults.style.display = 'block';
        return;
    }

    tableContainer.style.display = 'block';
    noResults.style.display = 'none';

    jobs.forEach((job, index) => {
        const row = document.createElement('tr');
        row.setAttribute('data-job-link', job.link);

        const descriptionHtml = job.description
            ? `<div class="description-cell">${escapeHtml(job.description)}</div>`
            : '<span style="color: #9ca3af; font-style: italic;">Not scraped</span>';

        row.innerHTML = `
            <td>${index + 1}</td>
            <td><strong>${escapeHtml(job.jobTitle)}</strong></td>
            <td class="job-id-cell">${escapeHtml(job.jobId || 'N/A')}</td>
            <td>${escapeHtml(job.location)}</td>
            <td>${escapeHtml(job.city)}</td>
            <td>${escapeHtml(job.state)}</td>
            <td>${escapeHtml(job.hospitalName || 'N/A')}</td>
            <td>${escapeHtml(job.position || 'N/A')}</td>
            <td>${escapeHtml(job.areaOfPractice || 'N/A')}</td>
            <td>${escapeHtml(job.salary || 'N/A')}</td>
            <td>${escapeHtml(job.jobType || 'N/A')}</td>
            <td><a href="${escapeHtml(job.link)}" target="_blank" class="job-link-btn">View Job</a></td>
            <td class="description-col">${descriptionHtml}</td>
        `;
        tbody.appendChild(row);
    });
}

async function getJobDescriptions() {
    if (isGettingDescriptions) {
        alert('Already getting descriptions. Please wait...');
        return;
    }

    const data = await chrome.storage.local.get(['scrapedJobs']);
    const jobs = data.scrapedJobs || [];

    const jobsWithoutDesc = jobs.filter(job => !job.description && job.link);
    if (jobsWithoutDesc.length === 0) {
        alert('All jobs already have descriptions!');
        return;
    }

    isGettingDescriptions = true;
    currentJobIndex = 0;

    const getBtn = document.getElementById('getDescriptionsBtn');
    getBtn.disabled = true;
    getBtn.innerHTML = `
        <svg class="btn-icon loading" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
        </svg>
        Getting Descriptions...
    `;

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
}

async function processNextJob() {
    const data = await chrome.storage.local.get(['scrapedJobs']);
    const jobs = data.scrapedJobs || [];

    // Find jobs without descriptions
    const jobsWithoutDesc = jobs.filter(job => !job.description && job.link);
    const totalWithoutDesc = jobs.filter(job => !job.description && job.link).length;
    const totalOriginal = jobs.filter(job => job.link).length;
    const processed = totalOriginal - totalWithoutDesc;

    // Update progress
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    const totalToProcess = allJobs.filter(job => !job.description && job.link).length;
    progressText.textContent = `${processed} / ${totalToProcess + processed}`;
    progressBar.style.width = `${(processed / (totalToProcess + processed)) * 100}%`;

    if (jobsWithoutDesc.length === 0) {
        // All done
        isGettingDescriptions = false;
        const getBtn = document.getElementById('getDescriptionsBtn');
        getBtn.disabled = false;
        getBtn.innerHTML = `
            <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
            </svg>
            Get Descriptions
        `;
        document.getElementById('progressSection').classList.add('hidden');
        alert('All descriptions have been fetched!');
        return;
    }

    const job = jobsWithoutDesc[0];
    const jobIndex = jobs.findIndex(j => j.link === job.link);

    try {
        const tab = await chrome.tabs.create({ url: job.link, active: false });
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
        // Reload jobs from storage and refresh display
        chrome.storage.local.get(['scrapedJobs'], (data) => {
            const jobs = data.scrapedJobs || [];
            allJobs = jobs;
            filteredJobs = [...jobs];
            applyFilters();
            updateStatsDashboard();

            if (isGettingDescriptions) {
                setTimeout(() => processNextJob(), 1500);
            }
        });
    }
})


function exportToCSV() {
    chrome.storage.local.get(['scrapedJobs'], (data) => {
        const jobs = data.scrapedJobs;

        if (!jobs || jobs.length === 0) {
            alert('No data to export');
            return;
        }

        let csv = 'Job Title,Job ID,Location,City,State,Hospital,Position,Area of Practice,Salary,Job Type,Link,Description\n';
        jobs.forEach(job => {
            const description = job.description ? `"${job.description.replace(/"/g, '""')}"` : '';
            csv += `"${job.jobTitle}","${job.jobId || 'N/A'}","${job.location}","${job.city}","${job.state}","${job.hospitalName || ''}","${job.position || ''}","${job.areaOfPractice || ''}","${job.salary || ''}","${job.jobType || ''}","${job.link}",${description}\n`;
        });

        downloadFile(csv, 'mission-pet-health-jobs.csv', 'text/csv;charset=utf-8;');
    });
}

function exportToJSON() {
    chrome.storage.local.get(['scrapedJobs'], (data) => {
        const jobs = data.scrapedJobs;
        if (!jobs || jobs.length === 0) {
            alert('No data to export');
            return;
        }
        const jsonContent = JSON.stringify(jobs, null, 2);
        downloadFile(jsonContent, 'mission-pet-health-jobs.json', 'application/json');
    });
}

function clearData() {
    if (confirm('Are you sure you want to clear all scraped data?')) {
        chrome.storage.local.remove(['scrapedJobs'], () => {
            location.reload();
        });
    }
}

function downloadFile(content, filename, contentType) {
    const blob = new Blob([content], { type: contentType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    if (text) {
        div.textContent = text;
    }
    return div.innerHTML;
}

async function sendToWebhook() {
    const webhookUrl = document.getElementById('webhookUrl').value;
    const statusEl = document.getElementById('webhookStatus');
    const sendBtn = document.getElementById('sendWebhookBtn');

    if (!webhookUrl || !isValidHttpUrl(webhookUrl)) {
        statusEl.textContent = 'Please enter a valid webhook URL.';
        statusEl.className = 'webhook-status error';
        return;
    }

    const data = await chrome.storage.local.get(['scrapedJobs']);
    const jobs = data.scrapedJobs;

    if (!jobs || jobs.length === 0) {
        statusEl.textContent = 'No job data to send.';
        statusEl.className = 'webhook-status error';
        return;
    }

    const jobsToSend = jobs.map(job => ({
        job_title: job.jobTitle || '',
        job_id: job.jobId || '',
        city: job.city || '',
        state: job.state || '',
        link: job.link || '',
        hospital: job.hospitalName || job.location || '',
        parent_client: "Mission Pet Health",
        position: job.position || '',
        area_of_practice: job.areaOfPractice || '',
        salary: job.salary || '',
        job_type: job.jobType || '',
        description: job.description || ''
    }));

    const BATCH_SIZE = 50;
    const totalBatches = Math.ceil(jobsToSend.length / BATCH_SIZE);

    if (!confirm(`This will send ${jobsToSend.length} jobs in ${totalBatches} batch(es) of up to ${BATCH_SIZE}. Continue?`)) {
        return;
    }

    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending...';
    statusEl.className = 'webhook-status';

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
            source: 'Mission Pet Health Job Scraper',
            parentClientName: 'Mission Pet Health',
            syncId: syncId,
            timestamp: new Date().toISOString(),
            batchNumber: batchNumber,
            totalBatches: totalBatches,
            batchSize: batch.length,
            totalRecords: jobsToSend.length,
            data: batch
        };

        statusEl.textContent = `Sending batch ${batchNumber} of ${totalBatches}...`;

        try {
            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Batch ${batchNumber}: Status ${response.status}. ${errorText}`);
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
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send to Webhook';

    if (failCount === 0) {
        statusEl.textContent = `Success! All ${totalBatches} batch(es) sent successfully.`;
        statusEl.className = 'webhook-status success';
    } else {
        statusEl.textContent = `Completed with errors: ${successCount} succeeded, ${failCount} failed.`;
        statusEl.className = 'webhook-status error';
    }

    alert(`Webhook send complete!\n\nTotal jobs: ${jobsToSend.length}\nBatches sent: ${successCount}/${totalBatches}\nFailed: ${failCount}`);
}

function isValidHttpUrl(string) {
    let url;
    try {
        url = new URL(string);
    } catch (_) {
        return false;
    }
    return url.protocol === "http:" || url.protocol === "https:";
}

// ==================== FETCH DETAILS FUNCTIONS ====================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'detailsFetched') {
        const details = request.details || {};
        const jobIndex = request.jobIndex;

        chrome.storage.local.get(['scrapedJobs'], (result) => {
            const jobs = result.scrapedJobs || [];
            if (jobs[jobIndex]) {
                if (details.hospitalName) jobs[jobIndex].hospitalName = details.hospitalName;
                if (details.streetAddress) jobs[jobIndex].streetAddress = details.streetAddress;
                if (details.city) jobs[jobIndex].city = details.city;
                if (details.state) jobs[jobIndex].state = details.state;
                if (details.postalCode) jobs[jobIndex].postalCode = details.postalCode;
                if (details.jobType) jobs[jobIndex].jobType = details.jobType;
                if (details.salary) jobs[jobIndex].salary = details.salary;
                if (details.position) jobs[jobIndex].position = details.position;
                if (details.areaOfPractice) jobs[jobIndex].areaOfPractice = details.areaOfPractice;
                if (details.department) jobs[jobIndex].department = details.department;
                jobs[jobIndex].detailsFetched = true;

                chrome.storage.local.set({ scrapedJobs: jobs }, () => {
                    allJobs = jobs;
                    applyFilters();

                    if (isFetchingDetails) {
                        currentDetailsIndex++;
                        const progressSection = document.getElementById('progressSection');
                        const progressBar = document.getElementById('progressBar');
                        const progressLabel = document.getElementById('progressLabel');
                        const progressText = document.getElementById('progressText');
                        const percent = Math.round((currentDetailsIndex / detailsQueue.length) * 100);
                        progressBar.style.width = `${percent}%`;
                        progressText.textContent = `${currentDetailsIndex} / ${detailsQueue.length}`;

                        if (currentDetailsIndex < detailsQueue.length) {
                            setTimeout(() => processNextDetail(), 1500);
                        } else {
                            finishDetailsFetching();
                        }
                    }
                });
            }
        });
    }
});

function fetchDetails() {
    if (isFetchingDetails) return;

    const jobsToFetch = allJobs.map((job, index) => ({ job, index }))
        .filter(item => !item.job.detailsFetched);

    if (jobsToFetch.length === 0) {
        if (confirm('All jobs already have details. Re-fetch for all jobs?')) {
            detailsQueue = allJobs.map((job, index) => ({ job, index }));
        } else return;
    } else {
        if (!confirm(`Fetch details for ${jobsToFetch.length} jobs by opening each job page. Continue?`)) return;
        detailsQueue = jobsToFetch;
    }

    currentDetailsIndex = 0;
    isFetchingDetails = true;
    const btn = document.getElementById('fetchDetailsBtn');
    btn.disabled = true;
    btn.textContent = 'Fetching Details...';

    const progressSection = document.getElementById('progressSection');
    const progressBar = document.getElementById('progressBar');
    const progressLabel = document.getElementById('progressLabel');
    const progressText = document.getElementById('progressText');
    progressSection.classList.remove('hidden');
    progressLabel.textContent = 'Fetching details...';
    progressText.textContent = `0 / ${detailsQueue.length}`;
    progressBar.style.width = '0%';

    processNextDetail();
}

function processNextDetail() {
    if (currentDetailsIndex >= detailsQueue.length) { finishDetailsFetching(); return; }
    const { job, index } = detailsQueue[currentDetailsIndex];
    chrome.runtime.sendMessage({ action: 'fetchJobDetails', url: job.link, jobIndex: index });
}

function finishDetailsFetching() {
    isFetchingDetails = false;
    const btn = document.getElementById('fetchDetailsBtn');
    btn.disabled = false;
    btn.innerHTML = '<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> Fetch Details';
    document.getElementById('progressSection').classList.add('hidden');
    detailsQueue = [];
    currentDetailsIndex = 0;
    alert('Details fetching completed!');
}
