// MPH Job Scraper - Results Script

// ── Quick position/AOP from title alone (used immediately after initial scrape) ──
// Mirrors the same keyword table in background.js so positions appear before Fetch Details.
(function buildQuickMatcher() {
  const SPECIALTY = new Set([
    'Anesthesiologist','Cardiologist','Credentialed Veterinary Technician Specialist',
    'DABVP Specialist','Dental Specialist','Dermatologist','ECC Specialist',
    'Internal Medicine Specialist','Medical Oncologist','Neurologist & Neurosurgeon',
    'Ophthalmologist','Radiation Oncologist','Radiologist','Surgeon','Theriogenologist'
  ]);

  function matchKeywords(t, d) {
    d = d || '';
    if (/associate veterinarian|associate vet\b/.test(t))    return 'Associate Veterinarian';
    if (/medical lead veterinarian|medical lead vet\b/.test(t)) return 'Lead Veterinarian';
    if (/medical director|medical lead/.test(t))              return 'Medical Director';
    if (/lead veterinarian|lead vet\b/.test(t))              return 'Lead Veterinarian';
    if (/criticalist|dacvecc|\becc specialist\b/.test(t) || /\becc\b/.test(t) ||
        (t.includes('emergency') && t.includes('critical care'))) return 'ECC Specialist';

    const isTech = /\b(technician|technologist|vet\s+tech|lvt|cvt|rdvt|nurse)\b/.test(t) && !/technician specialist|\bvts\b/.test(t);
    if (isTech) {
      if (/anesthes/.test(t)||/anesthes/.test(d))                return 'Anesthesiologist';
      if (/dental|dentist/.test(t)||/dental|dentist/.test(d))    return 'Dental Specialist';
      if (/criticalist|critical care|\becc\b/.test(t))           return 'ECC Specialist';
      if (/radiation.*oncol|oncol.*radiation/.test(t))           return 'Radiation Oncologist';
      if (/oncol/.test(t)&&!/radiation/.test(t))                 return 'Medical Oncologist';
      if (/cardiolog/.test(t)||/cardiolog/.test(d))              return 'Cardiologist';
      if (/neurolog|neurosurg/.test(t))                          return 'Neurologist & Neurosurgeon';
      if (/dermatolog/.test(t))                                  return 'Dermatologist';
      if (/ophthalmolog/.test(t))                                return 'Ophthalmologist';
      if (/surgery|surgical|surgeon/.test(t)&&!/neurosurg/.test(t)) return 'Surgeon';
      if (/radiolog|diagnostic imaging/.test(t))                 return 'Radiologist';
      if (/internal medicine/.test(t))                           return 'Internal Medicine Specialist';
      return 'Credentialed Veterinary Technician Specialist';
    }
    if (/technician specialist|\bvts\b/.test(t)) return 'Credentialed Veterinary Technician Specialist';

    if (/dacvim/.test(t)&&/oncol/.test(t))              return 'Medical Oncologist';
    if (/dacvr/.test(t)&&/(radiation|-ro)/.test(t))     return 'Radiation Oncologist';
    if (/dacvim/.test(t)&&/(neurolog|neurosurg)/.test(t)) return 'Neurologist & Neurosurgeon';
    if (/dacvim/.test(t)&&/cardiolog/.test(t))           return 'Cardiologist';
    if (/dacvim/.test(t))                                return 'Internal Medicine Specialist';
    if (/davdc|avdc/.test(t))                            return 'Dental Specialist';
    if (/dacvd/.test(t))                                 return 'Dermatologist';
    if (/dacvs|\bacvs\b/.test(t))                        return 'Surgeon';
    if (/dacvr/.test(t))                                 return 'Radiologist';
    if (/dacvo/.test(t))                                 return 'Ophthalmologist';
    if (/dacvaa|dacva/.test(t))                          return 'Anesthesiologist';
    if (/\bdact\b/.test(t))                              return 'Theriogenologist';
    if (/\bdabvp\b/.test(t))                             return 'DABVP Specialist';

    if (/radiation oncolog/.test(t))                                         return 'Radiation Oncologist';
    if (/oncolog/.test(t))                                                   return 'Medical Oncologist';
    if (/cardiolog/.test(t))                                                 return 'Cardiologist';
    if (/neurolog|neurosurg/.test(t))                                        return 'Neurologist & Neurosurgeon';
    if (/dermatolog/.test(t))                                                return 'Dermatologist';
    if (/ophthalmolog/.test(t))                                              return 'Ophthalmologist';
    if (/anesthesiolog/.test(t))                                             return 'Anesthesiologist';
    if (/theriogenolog/.test(t))                                             return 'Theriogenologist';
    if (/internist|internal medicine/.test(t))                              return 'Internal Medicine Specialist';
    if (/radiolog|diagnostic imaging/.test(t))                              return 'Radiologist';
    if (/(dental|dentist|dentistry)/.test(t)&&!/assistant/.test(t))        return 'Dental Specialist';
    if (/\bsurgeon\b/.test(t))                                              return 'Surgeon';
    if (/(surgery|surgical)/.test(t)&&!/neurosurg|dental/.test(t))         return 'Surgeon';
    if (/equine|bovine|large animal/.test(t)) return 'Equine/Bovine Veterinarian/Large Animal';
    if (/\bavian\b|exotics/.test(t))          return 'Avian & Exotics Veterinarian / Associate Exotics';
    if (/veterinarian|veterinary|\bdvm\b|relief|locum/.test(t)) return 'Associate Veterinarian';
    return '';
  }

  window.quickPosition = function(jobTitle, dept) {
    const t = (jobTitle||'').toLowerCase();
    const d = (dept||'').toLowerCase();
    if (/client service|receptionist|kennel|groomer|practice manager|hospital manager|billing|human resources|customer service|front desk|inventory|externship/.test(t)) return '';
    return matchKeywords(t, d);
  };

  window.quickAOP = function(position, jobTitle, hospitalName) {
    const t = (jobTitle||'').toLowerCase();
    const h = (hospitalName||'').toLowerCase();
    if (!position) {
      if (/emergency/.test(t)||h.includes('emergency')) return 'Emergency Care';
      if (/urgent care/.test(t)) return 'Urgent Care';
      return '';
    }
    if (SPECIALTY.has(position)) return 'Specialty Care';
    if (position === 'Medical Director') return 'General Practice Care';
    if (position === 'Lead Veterinarian') return 'General Practice Care';
    if (/emergency/.test(t)||h.includes('emergency')) return 'Emergency Care';
    if (/urgent care/.test(t)) return 'Urgent Care';
    if (/equine|bovine|large animal|avian|exotics/.test(t)) return 'General Practice Care / Emergency Care / Urgent Care';
    return 'General Practice Care';
  };
})();

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

        // Fill in position/AOP from title for jobs that don't have them yet
        jobs.forEach(job => {
            if (!job.position) {
                job.position = window.quickPosition(job.jobTitle, job.department || '');
            }
            if (!job.areaOfPractice) {
                job.areaOfPractice = window.quickAOP(job.position, job.jobTitle, job.hospitalName || '');
            }
        });

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
            <td>${escapeHtml(job.city || '')}</td>
            <td>${escapeHtml(job.state || '')}</td>
            <td>${escapeHtml(job.hospitalName || '')}</td>
            <td>${escapeHtml(job.streetAddress || '')}</td>
            <td>${escapeHtml(job.postalCode || '')}</td>
            <td>${escapeHtml(job.phone || '')}</td>
            <td>${job.website ? `<a href="${escapeHtml(job.website)}" target="_blank" style="color:#38bdf8;font-size:11px;">Visit</a>` : ''}</td>
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

// ==================== FETCH ADDRESSES (Google Maps) ====================

let isFetchingAddresses = false;
let addressQueue = [];
let currentAddressIndex = 0;

document.getElementById('fetchAddressesBtn').addEventListener('click', async () => {
    if (isFetchingAddresses) { showToast('Already fetching addresses. Please wait...'); return; }

    const data = await chrome.storage.local.get(['scrapedJobs']);
    const jobs = data.scrapedJobs || [];

    let jobsNeedingAddresses = jobs.map((job, index) => ({ job, index }))
        .filter(item => item.job.hospitalName && (!item.job.streetAddress || !item.job.postalCode));

    if (jobsNeedingAddresses.length === 0) {
        if (!confirm('All jobs already have addresses. Re-fetch all?')) return;
        jobsNeedingAddresses = jobs.map((job, index) => ({ job, index }))
            .filter(item => item.job.hospitalName);
    }

    if (jobsNeedingAddresses.length === 0) {
        alert('No jobs with hospital names found. Run "Fetch Details" first.'); return;
    }

    addressQueue = jobsNeedingAddresses;
    currentAddressIndex = 0;
    isFetchingAddresses = true;

    const btn = document.getElementById('fetchAddressesBtn');
    btn.disabled = true;
    btn.textContent = `Fetching Addresses... (0/${addressQueue.length})`;
    showProgress('Fetching Street Addresses', 0, addressQueue.length);

    processNextAddress();
});

async function processNextAddress() {
    if (currentAddressIndex >= addressQueue.length) {
        finishAddressFetching(); return;
    }

    const { job, index } = addressQueue[currentAddressIndex];
    const btn = document.getElementById('fetchAddressesBtn');
    btn.textContent = `Fetching... (${currentAddressIndex + 1}/${addressQueue.length})`;
    updateProgress(currentAddressIndex + 1, addressQueue.length);

    try {
        // Build search: hospitalName + city + state
        const searchHospital = (job.hospitalName || '').trim();
        const searchCity  = (job.city  || '').trim();
        const searchState = (job.state || '').trim();
        const searchLocation = [searchCity, searchState].filter(Boolean).join(', ');

        if (!searchHospital) {
            currentAddressIndex++;
            setTimeout(processNextAddress, 500);
            return;
        }

        const addressData = await fetchAddressFromGoogleMaps(searchHospital, searchLocation);

        // Save back into storage
        const freshData = await chrome.storage.local.get(['scrapedJobs']);
        const freshJobs = freshData.scrapedJobs || [];

        if (freshJobs[index]) {
            if (addressData.streetAddress) freshJobs[index].streetAddress = addressData.streetAddress;
            if (addressData.zipCode)       freshJobs[index].postalCode    = addressData.zipCode;
            if (addressData.city)          freshJobs[index].city          = addressData.city;
            if (addressData.state)         freshJobs[index].state         = addressData.state;
            if (addressData.website)       freshJobs[index].website       = addressData.website;
            if (addressData.phone)         freshJobs[index].phone         = addressData.phone;

            await chrome.storage.local.set({ scrapedJobs: freshJobs });
            allJobs = freshJobs;
            applyFilters();
            updateStats();
        }
    } catch (err) {
        console.error('Error fetching address:', err);
    }

    currentAddressIndex++;
    setTimeout(processNextAddress, 1500); // pace requests
}

function finishAddressFetching() {
    isFetchingAddresses = false;
    const btn = document.getElementById('fetchAddressesBtn');
    btn.disabled = false;
    btn.textContent = '📍 Fetch Addresses';
    hideProgress();
    addressQueue = [];
    currentAddressIndex = 0;
    alert('Address fetching completed!');
}

// Open a Maps tab, inject scraper, return address data
function fetchAddressFromGoogleMaps(hospitalName, location) {
    const searchQuery = location ? `${hospitalName}, ${location}` : hospitalName;
    const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`;

    function scrapeTab(url, label) {
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                resolve({ streetAddress: '', zipCode: '', city: '', state: '', website: '', phone: '' });
            }, 30000);

            chrome.tabs.create({ url, active: false }, (tab) => {
                if (!tab) { clearTimeout(timeout); resolve({}); return; }
                const tabId = tab.id;

                const listener = (updatedTabId, info) => {
                    if (updatedTabId !== tabId || info.status !== 'complete') return;
                    chrome.tabs.onUpdated.removeListener(listener);

                    setTimeout(() => {
                        chrome.scripting.executeScript({
                            target: { tabId },
                            files: ['google-maps-scraper.js']
                        }).then((results) => {
                            clearTimeout(timeout);
                            chrome.tabs.remove(tabId).catch(() => {});
                            const d = results?.[0]?.result || {};
                            resolve({
                                streetAddress: d.streetAddress || '',
                                zipCode:       d.zipCode       || '',
                                city:          d.city          || '',
                                state:         d.state         || '',
                                fullAddress:   d.fullAddress   || '',
                                website:       d.website       || '',
                                phone:         d.phone         || ''
                            });
                        }).catch(() => {
                            clearTimeout(timeout);
                            chrome.tabs.remove(tabId).catch(() => {});
                            resolve({});
                        });
                    }, 2000);
                };
                chrome.tabs.onUpdated.addListener(listener);
            });
        });
    }

    return scrapeTab(mapsUrl, searchQuery).then(async (data) => {
        // Retry with simplified name if first attempt failed
        if (!data.streetAddress && !data.zipCode) {
            const simplified = hospitalName
                .replace(/&/g, 'and').replace(/[-–—()]/g, ' ').replace(/\s+/g, ' ').trim();
            if (simplified !== hospitalName) {
                const altQuery = location ? `${simplified}, ${location}` : simplified;
                const altUrl = `https://www.google.com/maps/search/${encodeURIComponent(altQuery)}`;
                return scrapeTab(altUrl, altQuery);
            }
        }
        return data;
    });
}

// ---- progress helpers (shared with fetch details) ----
function showProgress(label, current, total) {
    const sec = document.getElementById('progress-section');
    if (sec) {
        sec.style.display = 'block';
        const lbl = document.getElementById('progress-label');
        if (lbl) lbl.textContent = label;
    }
    updateProgress(current, total);
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
        'Job Title', 'Job ID', 'City', 'State',
        'Street Address', 'Postal Code', 'Phone', 'Website',
        'Hospital', 'Position', 'Area of Practice', 'Salary',
        'Job Type', 'Department', 'Link', 'Description'
    ];

    const rows = jobsToExport.map(job => [
        `"${escapeCSV(job.jobTitle)}"`,
        `"${escapeCSV(job.jobId)}"`,
        `"${escapeCSV(job.city)}"`,
        `"${escapeCSV(job.state)}"`,
        `"${escapeCSV(job.streetAddress)}"`,
        `"${escapeCSV(job.postalCode)}"`,
        `"${escapeCSV(job.phone)}"`,
        `"${escapeCSV(job.website)}"`,
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
        phone: job.phone || '',
        website: job.website || '',
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
        <p><strong>Phone:</strong> ${escapeHtml(job.phone || '—')}</p>
        <p><strong>Website:</strong> ${job.website ? `<a href="${escapeHtml(job.website)}" target="_blank" style="color:#38bdf8">${escapeHtml(job.website)}</a>` : '—'}</p>
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
