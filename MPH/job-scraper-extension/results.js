// Global variable to prevent multiple description scraping processes
let isScrapingDescriptions = false;
let allJobs = [];
let filteredJobs = [];
let currentSort = { field: null, direction: 'asc' };

// Load and display jobs when page loads
document.addEventListener('DOMContentLoaded', async () => {
    await loadJobs();

    // Add event listeners for buttons
    document.getElementById('exportCSV').addEventListener('click', exportToCSV);
    document.getElementById('exportJSON').addEventListener('click', exportToJSON);
    document.getElementById('clearData').addEventListener('click', clearData);
    document.getElementById('sendWebhookBtn').addEventListener('click', sendToWebhook);
    document.getElementById('getDescriptionsBtn').addEventListener('click', getJobDescriptions);

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
            <td>${escapeHtml(job.location)}</td>
            <td>${escapeHtml(job.city)}</td>
            <td>${escapeHtml(job.state)}</td>
            <td><a href="${escapeHtml(job.link)}" target="_blank" class="job-link-btn">View Job</a></td>
            <td class="description-col">${descriptionHtml}</td>
        `;
        tbody.appendChild(row);
    });
}

async function getJobDescriptions() {
    if (isScrapingDescriptions) {
        alert('A description scraping process is already running.');
        return;
    }

    isScrapingDescriptions = true;
    const getBtn = document.getElementById('getDescriptionsBtn');
    getBtn.disabled = true;
    getBtn.innerHTML = `
        <svg class="btn-icon loading" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
        </svg>
        Getting Descriptions...
    `;

    let { scrapedJobs } = await chrome.storage.local.get('scrapedJobs');
    const jobsToScrape = scrapedJobs.filter(job => !job.description && job.link);
    const totalToScrape = jobsToScrape.length;
    let processedCount = 0;

    if (totalToScrape === 0) {
        alert('All job descriptions have already been fetched.');
        isScrapingDescriptions = false;
        getBtn.disabled = false;
        getBtn.innerHTML = `
            <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
            </svg>
            Get Descriptions
        `;
        return;
    }

    for (const job of jobsToScrape) {
        processedCount++;
        getBtn.textContent = `Processing ${processedCount}/${totalToScrape}...`;

        try {
            const description = await scrapeDescriptionFromPage(job.link);

            const jobIndex = scrapedJobs.findIndex(j => j.link === job.link);
            if (jobIndex !== -1) {
                scrapedJobs[jobIndex].description = description;
            }

            await chrome.storage.local.set({ scrapedJobs: scrapedJobs });

            // Update in-memory data and re-render
            allJobs = scrapedJobs;
            const row = document.querySelector(`tr[data-job-link="${job.link}"]`);
            if (row) {
                const descCell = row.querySelector('.description-col');
                if (descCell) {
                    descCell.innerHTML = `<div class="description-cell">${escapeHtml(description)}</div>`;
                }
            }

            // Update stats
            updateStatsDashboard();

        } catch (error) {
            console.error(`Failed to scrape description for ${job.link}:`, error);
            const row = document.querySelector(`tr[data-job-link="${job.link}"]`);
            if (row) {
                const descCell = row.querySelector('.description-col');
                if(descCell) descCell.innerHTML = `<span style="color: #ef4444;">Error: ${escapeHtml(error.message)}</span>`;
            }
        }
    }

    isScrapingDescriptions = false;
    getBtn.disabled = false;
    getBtn.innerHTML = `
        <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
        </svg>
        Get Descriptions
    `;

    alert(`Finished scraping descriptions. Processed ${processedCount} jobs.`);
}

function scrapeDescriptionFromPage(url) {
    return new Promise(async (resolve, reject) => {
        let tab;
        try {
            // Create a new, inactive tab
            tab = await chrome.tabs.create({ url: url, active: false });

            // Listener for when the tab is completely loaded
            const listener = async (tabId, changeInfo, updatedTab) => {
                if (tabId === tab.id && changeInfo.status === 'complete') {
                    // Remove listener to avoid memory leaks
                    chrome.tabs.onUpdated.removeListener(listener);

                    // Inject the script
                    const results = await chrome.scripting.executeScript({
                        target: { tabId: tabId },
                        files: ['description-scraper.js'],
                    });

                    // Close the tab
                    await chrome.tabs.remove(tabId);

                    // Process results
                    if (results && results[0] && results[0].result) {
                        resolve(results[0].result);
                    } else {
                        reject(new Error('Script did not return a result.'));
                    }
                }
            };
            chrome.tabs.onUpdated.addListener(listener);

        } catch (error) {
            // If tab creation fails, or any other error
            if (tab && tab.id) {
                await chrome.tabs.remove(tab.id);
            }
            reject(error);
        }
    });
}


function exportToCSV() {
    chrome.storage.local.get(['scrapedJobs'], (data) => {
        const jobs = data.scrapedJobs;

        if (!jobs || jobs.length === 0) {
            alert('No data to export');
            return;
        }

        let csv = 'Job Title,Location,City,State,Link,Description\n';
        jobs.forEach(job => {
            const description = job.description ? `"${job.description.replace(/"/g, '""')}"` : '';
            csv += `"${job.jobTitle}","${job.location}","${job.city}","${job.state}","${job.link}",${description}\n`;
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

    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending...';
    statusEl.className = 'webhook-status';

    try {
        const data = await chrome.storage.local.get(['scrapedJobs']);
        const jobs = data.scrapedJobs;

        if (!jobs || jobs.length === 0) {
            statusEl.textContent = 'No job data to send.';
            statusEl.className = 'webhook-status error';
            sendBtn.disabled = false;
            sendBtn.textContent = 'Send to Webhook';
            return;
        }

        const jobsArray = jobs.map(job => ({
            job_title: job.jobTitle || '',
            city: job.city || '',
            state: job.state || '',
            link: job.link || '',
            hospital: job.location || '',
            parent_client: "Mission Pet Health",
            job_description: job.description || ''
        }));

        const finalPayload = { data: jobsArray };
        statusEl.textContent = `Sending ${jobsArray.length} jobs in a single batch...`;

        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(finalPayload),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Webhook returned status ${response.status}. Response: ${errorText}`);
        }

        const responseData = await response.json();
        statusEl.textContent = `Success! ${responseData.message || 'Data accepted.'}`;
        statusEl.className = 'webhook-status success';

    } catch (error) {
        console.error('Webhook error:', error);
        statusEl.textContent = `Error: ${error.message}`;
        statusEl.className = 'webhook-status error';
    } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send to Webhook';
    }
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
