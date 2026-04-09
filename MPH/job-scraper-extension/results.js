// MPH Job Scraper - Results Script

let allJobs = [];
let filteredJobs = [];
let selectedIndexes = new Set();
let isGettingDescriptions = false;
let isFetchingDetails = false;
let currentJobIndex = 0;
let detailsQueue = [];
let currentDetailsIndex = 0;
let currentSort = { field: null, direction: 'asc' };

document.addEventListener('DOMContentLoaded', async () => {
    await loadJobs();
    setupEventListeners();
    loadWebhookConfig();
});

// ==================== LOAD / RENDER ====================

async function loadJobs() {
    try {
        const data = await chrome.storage.local.get(['scrapedJobs']);
        const jobs = data.scrapedJobs;

        if (!jobs || jobs.length === 0) {
            document.getElementById('noData').classList.remove('hidden');
            document.querySelector('.table-wrapper').classList.add('hidden');
            return;
        }

        document.getElementById('noData').classList.add('hidden');
        document.querySelector('.table-wrapper').classList.remove('hidden');

        allJobs = jobs;
        filteredJobs = [...jobs];

        populateStateFilter();
        updateStats();
        displayJobs(filteredJobs);
    } catch (error) {
        console.error('Error loading jobs:', error);
        alert('Error loading jobs data');
    }
}

function populateStateFilter() {
    const stateFilter = document.getElementById('stateFilter');
    const states = [...new Set(allJobs.map(job => job.state).filter(Boolean))].sort();
    stateFilter.innerHTML = '<option value="">All States</option>';
    states.forEach(state => {
        const option = document.createElement('option');
        option.value = state;
        option.textContent = state;
        stateFilter.appendChild(option);
    });
}

function updateStats() {
    const duplicateIds = findDuplicateIds();
    const duplicateCount = allJobs.filter(j => duplicateIds.has(j.jobId)).length;
    const withDescCount = allJobs.filter(j => j.description).length;

    document.getElementById('total-count').textContent = allJobs.length;
    document.getElementById('selected-count').textContent = selectedIndexes.size;
    document.getElementById('duplicate-count').textContent = duplicateCount;
    document.getElementById('with-desc-count').textContent = withDescCount;
}

function findDuplicateIds() {
    const idCount = {};
    allJobs.forEach(job => {
        if (job.jobId) idCount[job.jobId] = (idCount[job.jobId] || 0) + 1;
    });
    const duplicates = new Set();
    Object.entries(idCount).forEach(([id, count]) => {
        if (count > 1) duplicates.add(id);
    });
    return duplicates;
}

function displayJobs(jobs) {
    const tbody = document.getElementById('jobsTableBody');
    const tableWrapper = document.querySelector('.table-wrapper');
    const noResults = document.getElementById('noResults');

    tbody.innerHTML = '';

    if (jobs.length === 0) {
        tableWrapper.classList.add('hidden');
        noResults.classList.remove('hidden');
        return;
    }

    tableWrapper.classList.remove('hidden');
    noResults.classList.add('hidden');

    const duplicateIds = findDuplicateIds();

    jobs.forEach((job, filteredIndex) => {
        const originalIndex = allJobs.indexOf(job);
        const isDuplicate = duplicateIds.has(job.jobId);
        const isSelected = selectedIndexes.has(filteredIndex);
        const hasDescription = !!(job.description && job.description.length > 0);

        const tr = document.createElement('tr');
        tr.className = `${isDuplicate ? 'duplicate' : ''} ${isSelected ? 'selected' : ''}`.trim();
        tr.dataset.originalIndex = originalIndex;

        const descHtml = hasDescription
            ? `<span class="description-preview" data-original-index="${originalIndex}" title="${escapeHtml(job.description.substring(0, 200))}">${escapeHtml(job.description.substring(0, 60))}...</span>`
            : '<span class="badge badge-missing">Missing</span>';

        tr.innerHTML = `
            <td class="col-checkbox">
                <input type="checkbox" class="job-checkbox" data-index="${filteredIndex}" ${isSelected ? 'checked' : ''}>
            </td>
            <td class="col-status">
                ${isDuplicate
                    ? '<span class="badge badge-duplicate">Duplicate</span>'
                    : '<span class="badge badge-unique">Unique</span>'}
            </td>
            <td class="col-num">${filteredIndex + 1}</td>
            <td><strong><a href="${escapeHtml(job.link)}" target="_blank">${escapeHtml(job.jobTitle)}</a></strong></td>
            <td class="col-jobid">${escapeHtml(job.jobId || 'N/A')}</td>
            <td>${escapeHtml(job.location || '')}</td>
            <td>${escapeHtml(job.city || '')}</td>
            <td>${escapeHtml(job.state || '')}</td>
            <td>${escapeHtml(job.hospitalName || '')}</td>
            <td>${escapeHtml(job.position || '')}</td>
            <td>${escapeHtml(job.areaOfPractice || '')}</td>
            <td>${escapeHtml(job.salary || '')}</td>
            <td>${escapeHtml(job.jobType || '')}</td>
            <td class="col-link"><a href="${escapeHtml(job.link)}" target="_blank" class="job-link-btn">View</a></td>
            <td class="col-description">${descHtml}</td>
            <td class="col-actions">
                <button class="view-btn" data-original-index="${originalIndex}">View</button>
            </td>
        `;

        tbody.appendChild(tr);
    });

    // Checkbox listeners
    document.querySelectorAll('.job-checkbox').forEach(cb => {
        cb.addEventListener('change', (e) => {
            const idx = parseInt(e.target.dataset.index);
            if (e.target.checked) {
                selectedIndexes.add(idx);
            } else {
                selectedIndexes.delete(idx);
            }
            const tr = e.target.closest('tr');
            if (tr) tr.classList.toggle('selected', e.target.checked);
            updateStats();
        });
    });

    // Select-all header checkbox
    document.getElementById('select-all-checkbox').checked = false;

    // View button listeners
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(e.target.dataset.originalIndex);
            showJobDetails(allJobs[idx]);
        });
    });

    // Description preview click
    document.querySelectorAll('.description-preview').forEach(el => {
        el.addEventListener('click', (e) => {
            const idx = parseInt(e.target.dataset.originalIndex);
            showJobDetails(allJobs[idx]);
        });
    });
}

// ==================== EVENT LISTENERS ====================

function setupEventListeners() {
    // Search
    const searchInput = document.getElementById('searchInput');
    const clearSearchBtn = document.getElementById('clearSearch');
    searchInput.addEventListener('input', (e) => {
        clearSearchBtn.style.display = e.target.value ? 'flex' : 'none';
        applyFilters();
    });
    clearSearchBtn.addEventListener('click', () => {
        searchInput.value = '';
        clearSearchBtn.style.display = 'none';
        applyFilters();
    });

    // Filters
    document.getElementById('stateFilter').addEventListener('change', applyFilters);
    document.getElementById('statusFilter').addEventListener('change', applyFilters);

    // Select-all header checkbox
    document.getElementById('select-all-checkbox').addEventListener('change', (e) => {
        if (e.target.checked) {
            filteredJobs.forEach((_, i) => selectedIndexes.add(i));
        } else {
            selectedIndexes.clear();
        }
        displayJobs(filteredJobs);
        updateStats();
    });

    // Sorting
    document.querySelectorAll('.sortable').forEach(th => {
        th.addEventListener('click', () => handleSort(th.dataset.sort));
    });

    // Selection buttons
    document.getElementById('select-all-btn').addEventListener('click', () => {
        filteredJobs.forEach((_, i) => selectedIndexes.add(i));
        displayJobs(filteredJobs);
        updateStats();
    });

    document.getElementById('deselect-all-btn').addEventListener('click', () => {
        selectedIndexes.clear();
        displayJobs(filteredJobs);
        updateStats();
    });

    document.getElementById('select-duplicates-btn').addEventListener('click', selectDuplicates);

    // Action buttons
    document.getElementById('getDescriptionsBtn').addEventListener('click', getJobDescriptions);
    document.getElementById('fetchDetailsBtn').addEventListener('click', fetchDetails);
    document.getElementById('exportCSV').addEventListener('click', exportToCSV);
    document.getElementById('exportJSON').addEventListener('click', exportToJSON);
    document.getElementById('delete-selected-btn').addEventListener('click', deleteSelected);
    document.getElementById('clearData').addEventListener('click', clearData);
    document.getElementById('debug-salary-btn').addEventListener('click', debugMissingSalary);

    // Webhook
    document.getElementById('toggle-webhook').addEventListener('click', () => {
        document.getElementById('webhook-config').classList.toggle('hidden');
        document.querySelector('.webhook-section').classList.toggle('expanded');
    });
    document.getElementById('save-webhook-btn').addEventListener('click', saveWebhookConfig);
    document.getElementById('send-webhook-btn').addEventListener('click', sendToWebhook);

    // Modal
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.querySelector('.modal-overlay').addEventListener('click', closeModal);
}

// ==================== FILTERS & SORT ====================

function applyFilters() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase().trim();
    const stateFilter = document.getElementById('stateFilter').value;
    const statusFilter = document.getElementById('statusFilter').value;

    const duplicateIds = findDuplicateIds();

    filteredJobs = allJobs.filter(job => {
        // Search
        const matchesSearch = !searchTerm ||
            (job.jobTitle || '').toLowerCase().includes(searchTerm) ||
            (job.location || '').toLowerCase().includes(searchTerm) ||
            (job.city || '').toLowerCase().includes(searchTerm) ||
            (job.state || '').toLowerCase().includes(searchTerm) ||
            (job.hospitalName || '').toLowerCase().includes(searchTerm) ||
            (job.description || '').toLowerCase().includes(searchTerm);

        // State
        const matchesState = !stateFilter || job.state === stateFilter;

        // Status
        let matchesStatus = true;
        if (statusFilter === 'duplicates') {
            matchesStatus = duplicateIds.has(job.jobId);
        } else if (statusFilter === 'unique') {
            matchesStatus = !duplicateIds.has(job.jobId);
        } else if (statusFilter === 'with-description') {
            matchesStatus = !!job.description;
        } else if (statusFilter === 'no-description') {
            matchesStatus = !job.description;
        }

        return matchesSearch && matchesState && matchesStatus;
    });

    // Reapply sort
    if (currentSort.field) {
        sortJobs(currentSort.field, currentSort.direction);
    }

    selectedIndexes.clear();
    displayJobs(filteredJobs);
    updateStats();
}

function handleSort(field) {
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
        let aVal = (a[field] || '').toLowerCase();
        let bVal = (b[field] || '').toLowerCase();
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

// ==================== SELECTION ====================

function selectDuplicates() {
    const duplicateIds = findDuplicateIds();
    selectedIndexes.clear();
    filteredJobs.forEach((job, index) => {
        if (duplicateIds.has(job.jobId)) selectedIndexes.add(index);
    });
    displayJobs(filteredJobs);
    updateStats();
}

async function deleteSelected() {
    if (selectedIndexes.size === 0) {
        alert('No jobs selected.');
        return;
    }
    if (!confirm(`Delete ${selectedIndexes.size} selected job(s)? This cannot be undone.`)) return;

    const jobsToDelete = new Set(
        Array.from(selectedIndexes).map(i => allJobs.indexOf(filteredJobs[i]))
    );
    allJobs = allJobs.filter((_, i) => !jobsToDelete.has(i));
    await chrome.storage.local.set({ scrapedJobs: allJobs });

    selectedIndexes.clear();
    populateStateFilter();
    applyFilters();
}

// ==================== GET DESCRIPTIONS ====================

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

    const btn = document.getElementById('getDescriptionsBtn');
    btn.disabled = true;
    btn.textContent = 'Getting Descriptions...';

    showProgress('Getting Descriptions', 0, jobsWithoutDesc.length);
    processNextJob();
}

async function processNextJob() {
    const data = await chrome.storage.local.get(['scrapedJobs']);
    const jobs = data.scrapedJobs || [];
    const jobsWithoutDesc = jobs.filter(job => !job.description && job.link);
    const totalOriginal = allJobs.filter(job => job.link).length;
    const processed = totalOriginal - jobsWithoutDesc.length;

    updateProgress(processed, totalOriginal);

    if (jobsWithoutDesc.length === 0) {
        isGettingDescriptions = false;
        const btn = document.getElementById('getDescriptionsBtn');
        btn.disabled = false;
        btn.textContent = 'Get Descriptions';
        hideProgress();
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

// ==================== FETCH DETAILS ====================

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

    showProgress('Fetching Details', 0, detailsQueue.length);
    processNextDetail();
}

function processNextDetail() {
    if (currentDetailsIndex >= detailsQueue.length) {
        finishDetailsFetching();
        return;
    }
    const { job, index } = detailsQueue[currentDetailsIndex];
    chrome.runtime.sendMessage({ action: 'fetchJobDetails', url: job.link, jobIndex: index });
}

function finishDetailsFetching() {
    isFetchingDetails = false;
    const btn = document.getElementById('fetchDetailsBtn');
    btn.disabled = false;
    btn.textContent = 'Fetch Details';
    hideProgress();
    detailsQueue = [];
    currentDetailsIndex = 0;
    alert('Details fetching completed!');
}

// Message listener from background.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'descriptionSaved') {
        chrome.storage.local.get(['scrapedJobs'], (data) => {
            const jobs = data.scrapedJobs || [];
            allJobs = jobs;
            filteredJobs = [...jobs];
            applyFilters();
            updateStats();

            if (isGettingDescriptions) {
                setTimeout(() => processNextJob(), 1500);
            }
        });
    } else if (message.action === 'detailsFetched') {
        const details = message.details || {};
        const jobIndex = message.jobIndex;

        chrome.storage.local.get(['scrapedJobs'], (result) => {
            const jobs = result.scrapedJobs || [];
            if (jobs[jobIndex]) {
                if (details.hospitalName)  jobs[jobIndex].hospitalName  = details.hospitalName;
                if (details.streetAddress) jobs[jobIndex].streetAddress = details.streetAddress;
                if (details.city)          jobs[jobIndex].city          = details.city;
                if (details.state)         jobs[jobIndex].state         = details.state;
                if (details.postalCode)    jobs[jobIndex].postalCode    = details.postalCode;
                if (details.jobType)       jobs[jobIndex].jobType       = details.jobType;
                if (details.salary)        jobs[jobIndex].salary        = details.salary;
                if (details.position)      jobs[jobIndex].position      = details.position;
                if (details.areaOfPractice) jobs[jobIndex].areaOfPractice = details.areaOfPractice;
                if (details.department)    jobs[jobIndex].department    = details.department;
                jobs[jobIndex].detailsFetched = true;

                chrome.storage.local.set({ scrapedJobs: jobs }, () => {
                    allJobs = jobs;
                    applyFilters();
                    updateStats();

                    if (isFetchingDetails) {
                        currentDetailsIndex++;
                        updateProgress(currentDetailsIndex, detailsQueue.length);

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

// ==================== EXPORT ====================

function exportToCSV() {
    const jobsToExport = selectedIndexes.size > 0
        ? Array.from(selectedIndexes).map(i => filteredJobs[i])
        : allJobs;

    const headers = [
        'Job Title', 'Job ID', 'Location', 'City', 'State',
        'Street Address', 'Postal Code', 'Hospital', 'Position',
        'Area of Practice', 'Salary', 'Job Type', 'Department', 'Link', 'Description'
    ];

    const rows = jobsToExport.map(job => [
        `"${escapeCSV(job.jobTitle)}"`,
        `"${escapeCSV(job.jobId)}"`,
        `"${escapeCSV(job.location)}"`,
        `"${escapeCSV(job.city)}"`,
        `"${escapeCSV(job.state)}"`,
        `"${escapeCSV(job.streetAddress)}"`,
        `"${escapeCSV(job.postalCode)}"`,
        `"${escapeCSV(job.hospitalName)}"`,
        `"${escapeCSV(job.position)}"`,
        `"${escapeCSV(job.areaOfPractice)}"`,
        `"${escapeCSV(job.salary)}"`,
        `"${escapeCSV(job.jobType)}"`,
        `"${escapeCSV(job.department)}"`,
        `"${escapeCSV(job.link)}"`,
        `"${escapeCSV(job.description)}"`
    ].join(','));

    const csvContent = [headers.join(','), ...rows].join('\n');
    downloadFile(csvContent, 'mission-pet-health-jobs.csv', 'text/csv');
}

function exportToJSON() {
    const jobsToExport = selectedIndexes.size > 0
        ? Array.from(selectedIndexes).map(i => filteredJobs[i])
        : allJobs;

    downloadFile(JSON.stringify(jobsToExport, null, 2), 'mission-pet-health-jobs.json', 'application/json');
}

function escapeCSV(val) {
    return (val || '').toString().replace(/"/g, '""');
}

// ==================== CLEAR DATA ====================

function clearData() {
    if (confirm('Are you sure you want to clear ALL scraped data? This cannot be undone.')) {
        chrome.storage.local.remove(['scrapedJobs'], () => {
            location.reload();
        });
    }
}

// ==================== WEBHOOK ====================

async function loadWebhookConfig() {
    const stored = await chrome.storage.local.get('mphWebhook');
    if (stored.mphWebhook) {
        document.getElementById('webhook-url-input').value = stored.mphWebhook.url || '';
        document.getElementById('parent-client-input').value = stored.mphWebhook.parentClient || 'Mission Pet Health';
    }
}

async function saveWebhookConfig() {
    const url = document.getElementById('webhook-url-input').value;
    const parentClient = document.getElementById('parent-client-input').value;
    await chrome.storage.local.set({ mphWebhook: { url, parentClient } });
    alert('Webhook configuration saved!');
}

async function sendToWebhook() {
    const webhookUrl = document.getElementById('webhook-url-input').value;
    const parentClient = document.getElementById('parent-client-input').value || 'Mission Pet Health';

    if (!webhookUrl || !isValidHttpUrl(webhookUrl)) {
        alert('Please enter a valid webhook URL.');
        return;
    }

    const data = await chrome.storage.local.get(['scrapedJobs']);
    const jobs = data.scrapedJobs;

    if (!jobs || jobs.length === 0) {
        alert('No jobs to send.');
        return;
    }

    const jobsToSend = jobs.map(job => ({
        parent_client: parentClient,
        aggregator: 'Mission Pet Health (Parent Client)',
        job_title: job.jobTitle || '',
        job_id: job.jobId || '',
        city: job.city || '',
        state: job.state || '',
        street_address: job.streetAddress || '',
        postal_code: job.postalCode || '',
        location: job.location || '',
        hospital: job.hospitalName || '',
        position: job.position || '',
        area_of_practice: job.areaOfPractice || '',
        salary: job.salary || '',
        job_type: job.jobType || '',
        department: job.department || '',
        url: job.link || '',
        link: job.link || '',
        description: job.description || ''
    }));

    const BATCH_SIZE = 50;
    const totalBatches = Math.ceil(jobsToSend.length / BATCH_SIZE);

    if (!confirm(`This will send ${jobsToSend.length} jobs in ${totalBatches} batch(es) of up to ${BATCH_SIZE}. Continue?`)) return;

    const sendBtn = document.getElementById('send-webhook-btn');
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending...';

    showProgress('Sending Batches', 0, totalBatches);

    const syncId = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < totalBatches; i++) {
        const batch = jobsToSend.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
        const batchNumber = i + 1;

        const payload = {
            source: 'Mission Pet Health Job Scraper',
            parentClientName: parentClient,
            syncId,
            timestamp: new Date().toISOString(),
            batchNumber,
            totalBatches,
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
                const errorText = await response.text();
                throw new Error(`Batch ${batchNumber}: Status ${response.status}. ${errorText}`);
            }
            successCount++;
        } catch (error) {
            console.error(`Batch ${batchNumber} error:`, error);
            failCount++;
        }

        updateProgress(batchNumber, totalBatches);
        if (i < totalBatches - 1) await new Promise(r => setTimeout(r, 500));
    }

    hideProgress();
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send';

    alert(`Webhook send complete!\n\nTotal jobs: ${jobsToSend.length}\nBatches sent: ${successCount}/${totalBatches}\nFailed: ${failCount}`);
}

function isValidHttpUrl(string) {
    try {
        const url = new URL(string);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
        return false;
    }
}

// ==================== MODAL ====================

function showJobDetails(job) {
    document.getElementById('modal-title').textContent = job.jobTitle || 'Job Details';

    document.getElementById('modal-body').innerHTML = `
        <p><strong>Job ID:</strong> ${escapeHtml(job.jobId || 'N/A')}</p>
        <p><strong>Hospital:</strong> ${escapeHtml(job.hospitalName || 'N/A')}</p>
        <hr>
        <p><strong>Street Address:</strong> ${escapeHtml(job.streetAddress || '—')}</p>
        <p><strong>City:</strong> ${escapeHtml(job.city || '—')}</p>
        <p><strong>State:</strong> ${escapeHtml(job.state || '—')}</p>
        <p><strong>Postal Code:</strong> ${escapeHtml(job.postalCode || '—')}</p>
        <p><strong>Location:</strong> ${escapeHtml(job.location || '—')}</p>
        <hr>
        <p><strong>Area of Practice:</strong> ${escapeHtml(job.areaOfPractice || 'N/A')}</p>
        <p><strong>Position:</strong> ${escapeHtml(job.position || 'N/A')}</p>
        <p><strong>Salary:</strong> ${escapeHtml(job.salary || 'N/A')}</p>
        <p><strong>Job Type:</strong> ${escapeHtml(job.jobType || 'N/A')}</p>
        <p><strong>Department:</strong> ${escapeHtml(job.department || 'N/A')}</p>
        <p><strong>Link:</strong> <a href="${escapeHtml(job.link)}" target="_blank">${escapeHtml(job.link)}</a></p>
        <hr>
        <p><strong>Description:</strong></p>
        <pre>${escapeHtml(job.description || 'No description available.')}</pre>
    `;

    document.getElementById('modal').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('modal').classList.add('hidden');
}

// ==================== DEBUG MISSING SALARY ====================

async function debugMissingSalary() {
    const data = await chrome.storage.local.get(['scrapedJobs']);
    const jobs = data.scrapedJobs || [];
    const noSalary = jobs.filter(j => !j.salary && j.description);

    if (noSalary.length === 0) {
        alert('All jobs with descriptions already have a salary!');
        return;
    }

    const salaryKeywords = /(\$[\d,]+|\bsalar|\bpay\b|\bpay\s|\bwage|\bcomp|\bhourly|\bannual|\bincome|\bearning)/gi;

    let output = `MPH — Jobs Missing Salary (${noSalary.length} jobs)\n`;
    output += '='.repeat(70) + '\n\n';

    noSalary.forEach((job, i) => {
        output += `[${i + 1}] ${job.jobTitle || '(no title)'}\n`;
        output += `    Job ID : ${job.jobId || ''}\n`;
        output += `    Link   : ${job.link || ''}\n`;

        const desc = job.description || '';
        const lines = desc.split('\n');
        const salaryLines = lines.filter(l => salaryKeywords.test(l));
        salaryKeywords.lastIndex = 0;

        if (salaryLines.length > 0) {
            output += `    --- Salary-related lines from description ---\n`;
            salaryLines.forEach(l => { output += `    > ${l.trim()}\n`; });
        } else {
            output += `    --- No salary keywords found. First 600 chars of description ---\n`;
            output += `    ${desc.substring(0, 600).replace(/\n/g, '\n    ')}\n`;
        }
        output += '\n' + '-'.repeat(70) + '\n\n';
    });

    downloadFile(output, 'mph-missing-salary-debug.txt', 'text/plain');
    alert(`Debug file created for ${noSalary.length} jobs missing salary.`);
}

// ==================== PROGRESS HELPERS ====================

function showProgress(label, current, total) {
    const section = document.getElementById('progressSection');
    document.getElementById('progressLabel').textContent = label;
    document.getElementById('progressText').textContent = `${current} / ${total}`;
    document.getElementById('progressBar').style.width = total > 0 ? `${(current / total) * 100}%` : '0%';
    section.classList.remove('hidden');
}

function updateProgress(current, total) {
    document.getElementById('progressText').textContent = `${current} / ${total}`;
    document.getElementById('progressBar').style.width = total > 0 ? `${(current / total) * 100}%` : '0%';
}

function hideProgress() {
    document.getElementById('progressSection').classList.add('hidden');
}

// ==================== UTILITIES ====================

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
    if (text) div.textContent = text;
    return div.innerHTML;
}
