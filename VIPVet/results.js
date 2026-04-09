// VIPVet Job Scraper - Results Script

let allJobs = [];
let filteredJobs = [];
let selectedIndexes = new Set();
let isGettingDescriptions = false;
let isFetchingDetails = false;
let isFetchingAddresses = false;
let currentJobIndex = 0;
let detailsQueue = [];
let currentDetailsIndex = 0;
let addressQueue = [];
let currentAddressIndex = 0;

document.addEventListener('DOMContentLoaded', () => {
  loadJobs();
  setupEventListeners();
});

async function loadJobs() {
  const stored = await chrome.storage.local.get('vipvetJobs');
  allJobs = stored.vipvetJobs || [];

  if (allJobs.length === 0) {
    document.getElementById('no-data').classList.remove('hidden');
    document.querySelector('.table-wrapper').classList.add('hidden');
    return;
  }

  document.getElementById('no-data').classList.add('hidden');
  document.querySelector('.table-wrapper').classList.remove('hidden');

  filteredJobs = [...allJobs];
  renderJobs();
  updateStats();
}

function setupEventListeners() {
  // Search
  document.getElementById('search-input').addEventListener('input', filterJobs);

  // Filter select
  document.getElementById('filter-select').addEventListener('change', filterJobs);

  // Select all checkbox
  document.getElementById('select-all-checkbox').addEventListener('change', (e) => {
    if (e.target.checked) {
      filteredJobs.forEach((_, i) => selectedIndexes.add(i));
    } else {
      selectedIndexes.clear();
    }
    renderJobs();
    updateStats();
  });

  // Action buttons
  document.getElementById('select-all-btn').addEventListener('click', () => {
    filteredJobs.forEach((_, i) => selectedIndexes.add(i));
    renderJobs();
    updateStats();
  });

  document.getElementById('deselect-all-btn').addEventListener('click', () => {
    selectedIndexes.clear();
    renderJobs();
    updateStats();
  });

  document.getElementById('select-duplicates-btn').addEventListener('click', selectDuplicates);
  document.getElementById('get-descriptions-btn').addEventListener('click', getDescriptions);
  document.getElementById('fetch-details-btn').addEventListener('click', getDetails);
  document.getElementById('fetch-addresses-btn').addEventListener('click', fetchAddresses);
  document.getElementById('export-csv-btn').addEventListener('click', exportCSV);
  document.getElementById('delete-selected-btn').addEventListener('click', deleteSelected);
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

  // Load saved webhook config
  loadWebhookConfig();
}

function filterJobs() {
  const searchTerm = document.getElementById('search-input').value.toLowerCase();
  const filterValue = document.getElementById('filter-select').value;

  const duplicateIds = findDuplicateIds();

  filteredJobs = allJobs.filter((job, index) => {
    // Search filter
    const matchesSearch = !searchTerm ||
      (job.title || '').toLowerCase().includes(searchTerm) ||
      (job.hospitalName || '').toLowerCase().includes(searchTerm) ||
      (job.city || '').toLowerCase().includes(searchTerm) ||
      (job.state || '').toLowerCase().includes(searchTerm) ||
      (job.postalCode || '').toLowerCase().includes(searchTerm) ||
      (job.streetAddress || '').toLowerCase().includes(searchTerm);

    // Type filter
    let matchesFilter = true;
    if (filterValue === 'duplicates') {
      matchesFilter = duplicateIds.has(job.reqId);
    } else if (filterValue === 'unique') {
      matchesFilter = !duplicateIds.has(job.reqId);
    } else if (filterValue === 'no-description') {
      matchesFilter = !job.description;
    } else if (filterValue === 'no-address') {
      matchesFilter = !job.streetAddress;
    }

    return matchesSearch && matchesFilter;
  });

  selectedIndexes.clear();
  renderJobs();
  updateStats();
}

function findDuplicateIds() {
  const idCount = {};
  allJobs.forEach(job => {
    idCount[job.reqId] = (idCount[job.reqId] || 0) + 1;
  });

  const duplicates = new Set();
  Object.entries(idCount).forEach(([id, count]) => {
    if (count > 1) duplicates.add(id);
  });

  return duplicates;
}

function renderJobs() {
  const tbody = document.getElementById('jobs-tbody');
  tbody.innerHTML = '';

  const duplicateIds = findDuplicateIds();

  filteredJobs.forEach((job, index) => {
    const originalIndex = allJobs.indexOf(job);
    const isDuplicate = duplicateIds.has(job.reqId);
    const isSelected = selectedIndexes.has(index);
    const hasDescription = job.description && job.description.length > 0;

    const tr = document.createElement('tr');
    tr.className = `${isDuplicate ? 'duplicate' : ''} ${isSelected ? 'selected' : ''}`;
    tr.dataset.index = originalIndex;

    tr.innerHTML = `
      <td class="col-checkbox">
        <input type="checkbox" class="job-checkbox" data-index="${index}" ${isSelected ? 'checked' : ''}>
      </td>
      <td class="col-status">
        ${isDuplicate ? '<span class="badge badge-duplicate">Duplicate</span>' : '<span class="badge badge-unique">Unique</span>'}
      </td>
      <td class="col-title">
        <a href="${escapeHtml(job.link)}" target="_blank">${escapeHtml(job.title)}</a>
      </td>
      <td class="col-reqid">${escapeHtml(job.reqId)}</td>
      <td class="col-hospital">${escapeHtml(job.hospitalName || '')}</td>
      <td class="col-street">${job.streetAddress ? escapeHtml(job.streetAddress) : '<span style="color:#bbb;font-size:11px">—</span>'}</td>
      <td class="col-city">${escapeHtml(job.city || '')}</td>
      <td class="col-state">${escapeHtml(job.state || '')}</td>
      <td class="col-zip">${escapeHtml(job.postalCode || '')}</td>
      <td class="col-category">${escapeHtml(job.category || '')}</td>
      <td class="col-practice">${escapeHtml(job.areaOfPractice || '-')}</td>
      <td class="col-position">${escapeHtml(job.position || '-')}</td>
      <td class="col-salary">${escapeHtml(job.salary || '-')}</td>
      <td class="col-type">${escapeHtml(job.jobType || '')}</td>
      <td class="col-description">
        ${hasDescription
          ? `<span class="description-preview" title="${escapeHtml(job.description.substring(0, 200))}" data-index="${originalIndex}">${escapeHtml(job.description.substring(0, 50))}...</span>`
          : '<span class="badge badge-missing">Missing</span>'
        }
      </td>
      <td class="col-actions">
        <button class="btn btn-sm view-btn" data-index="${originalIndex}">View</button>
      </td>
    `;

    tbody.appendChild(tr);
  });

  // Add event listeners
  document.querySelectorAll('.job-checkbox').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.index);
      if (e.target.checked) {
        selectedIndexes.add(idx);
      } else {
        selectedIndexes.delete(idx);
      }
      renderJobs();
      updateStats();
    });
  });

  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.index);
      showJobDetails(allJobs[idx]);
    });
  });

  document.querySelectorAll('.description-preview').forEach(el => {
    el.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.index);
      showJobDetails(allJobs[idx]);
    });
  });
}

function updateStats() {
  const duplicateIds = findDuplicateIds();
  const duplicateCount = allJobs.filter(j => duplicateIds.has(j.reqId)).length;

  document.getElementById('total-count').textContent = allJobs.length;
  document.getElementById('selected-count').textContent = selectedIndexes.size;
  document.getElementById('duplicate-count').textContent = duplicateCount;
}

function selectDuplicates() {
  const duplicateIds = findDuplicateIds();
  selectedIndexes.clear();

  filteredJobs.forEach((job, index) => {
    if (duplicateIds.has(job.reqId)) {
      selectedIndexes.add(index);
    }
  });

  renderJobs();
  updateStats();
}

async function getDescriptions() {
  if (isGettingDescriptions) {
    alert('Already getting descriptions. Please wait...');
    return;
  }

  const data = await chrome.storage.local.get(['vipvetJobs']);
  const jobs = data.vipvetJobs || [];

  const jobsWithoutDesc = jobs.filter(job => !job.description && job.link);
  if (jobsWithoutDesc.length === 0) {
    alert('All jobs already have descriptions!');
    return;
  }

  isGettingDescriptions = true;
  currentJobIndex = 0;

  const btn = document.getElementById('get-descriptions-btn');
  btn.disabled = true;
  btn.textContent = 'Getting Descriptions...';

  // Show progress
  const progressSection = document.getElementById('progress-bar');
  const progressLabel = document.getElementById('progress-label');
  const progressDetail = document.getElementById('progress-detail');
  const progressFill = document.getElementById('progress-fill');
  progressSection.classList.remove('hidden');
  progressLabel.textContent = 'Getting Descriptions';
  progressDetail.textContent = `0 / ${jobsWithoutDesc.length}`;
  progressFill.style.width = '0%';

  processNextJob();
}

async function processNextJob() {
  const data = await chrome.storage.local.get(['vipvetJobs']);
  const jobs = data.vipvetJobs || [];

  const jobsWithoutDesc = jobs.filter(job => !job.description && job.link);
  const totalOriginal = jobs.filter(job => job.link).length;
  const totalWithoutDesc = jobsWithoutDesc.length;
  const processed = totalOriginal - totalWithoutDesc;

  // Update progress
  const progressFill = document.getElementById('progress-fill');
  const progressDetail = document.getElementById('progress-detail');
  const totalToProcess = allJobs.filter(job => !job.description && job.link).length;
  progressDetail.textContent = `${processed} / ${totalToProcess + processed}`;
  progressFill.style.width = `${(processed / (totalToProcess + processed)) * 100}%`;

  if (jobsWithoutDesc.length === 0) {
    isGettingDescriptions = false;
    const btn = document.getElementById('get-descriptions-btn');
    btn.disabled = false;
    btn.textContent = 'Get Descriptions';
    document.getElementById('progress-bar').classList.add('hidden');
    alert('All descriptions have been fetched!');
    return;
  }

  const job = jobsWithoutDesc[0];
  const jobIndex = jobs.findIndex(j => j.link === job.link);

  try {
    // Convert to Greenhouse embed URL so page loads with JSON-LD directly
    // instead of redirecting to vip-vet.com where content loads dynamically
    let descUrl = job.link;
    let ghJobId = '';
    let boardName = '';

    const ghJidMatch = job.link.match(/gh_jid=(\d+)/);
    const jobsPathMatch = job.link.match(/greenhouse\.io\/([^\/]+)\/jobs\/(\d+)/);

    if (jobsPathMatch) {
      boardName = jobsPathMatch[1];
      ghJobId = jobsPathMatch[2];
    } else if (ghJidMatch) {
      ghJobId = ghJidMatch[1];
      boardName = 'veterinaryinnovativepartners';
    }

    if (ghJobId && boardName) {
      descUrl = `https://boards.greenhouse.io/embed/job_app?for=${boardName}&token=${ghJobId}`;
    }

    const tab = await chrome.tabs.create({ url: descUrl, active: false });
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

async function getDetails() {
  if (isFetchingDetails) {
    alert('Already fetching details. Please wait...');
    return;
  }

  const data = await chrome.storage.local.get(['vipvetJobs']);
  const jobs = data.vipvetJobs || [];

  // Filter jobs that need details
  const jobsToFetch = jobs.map((job, index) => ({ job, index }))
    .filter(item => !item.job.areaOfPractice || !item.job.position || !item.job.salary);

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

  const btn = document.getElementById('fetch-details-btn');
  btn.disabled = true;
  btn.textContent = 'Fetching Details...';

  // Show progress
  const progressSection = document.getElementById('progress-bar');
  const progressLabel = document.getElementById('progress-label');
  const progressDetail = document.getElementById('progress-detail');
  const progressFill = document.getElementById('progress-fill');
  progressSection.classList.remove('hidden');
  progressLabel.textContent = 'Fetching Details';
  progressDetail.textContent = `0 / ${detailsQueue.length}`;
  progressFill.style.width = '0%';

  processNextDetail();
}

async function processNextDetail() {
  if (currentDetailsIndex >= detailsQueue.length) {
    isFetchingDetails = false;
    const btn = document.getElementById('fetch-details-btn');
    btn.disabled = false;
    btn.textContent = 'Fetch Details';
    document.getElementById('progress-bar').classList.add('hidden');
    alert('All job details have been fetched!');
    return;
  }

  const { job, index } = detailsQueue[currentDetailsIndex];
  
  // Update progress
  const progressFill = document.getElementById('progress-fill');
  const progressDetail = document.getElementById('progress-detail');
  progressDetail.textContent = `${currentDetailsIndex + 1} / ${detailsQueue.length}`;
  progressFill.style.width = `${((currentDetailsIndex + 1) / detailsQueue.length) * 100}%`;

  // Convert to Greenhouse embed URL
  let ghUrl = job.link;
  let ghJobId = '';
  let boardName = '';

  const ghJidMatch = job.link.match(/gh_jid=(\d+)/);
  const jobsPathMatch = job.link.match(/greenhouse\.io\/([^\/]+)\/jobs\/(\d+)/);

  if (jobsPathMatch) {
    boardName = jobsPathMatch[1];
    ghJobId = jobsPathMatch[2];
  } else if (ghJidMatch) {
    ghJobId = ghJidMatch[1];
    boardName = 'veterinaryinnovativepartners';
  }

  if (ghJobId && boardName) {
    ghUrl = `https://boards.greenhouse.io/embed/job_app?for=${boardName}&token=${ghJobId}`;
  }

  chrome.runtime.sendMessage({
    action: 'fetchJobDetails',
    url: ghUrl,
    jobIndex: index
  });
}

// Listen for description saved messages from background.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'descriptionSaved') {
    chrome.storage.local.get(['vipvetJobs'], (data) => {
      const jobs = data.vipvetJobs || [];
      allJobs = jobs;
      filteredJobs = [...jobs];
      filterJobs();
      updateStats();

      if (isGettingDescriptions) {
        setTimeout(() => processNextJob(), 1500);
      }
    });
  } else if (message.action === 'detailsFetched') {
    const details = message.details;
    chrome.storage.local.get(['vipvetJobs'], (data) => {
      const jobs = data.vipvetJobs || [];
      if (jobs[message.jobIndex]) {
        const job = jobs[message.jobIndex];
        job.areaOfPractice = details.areaOfPractice || job.areaOfPractice || '';
        job.position       = details.position       || job.position       || '';
        job.salary         = details.salary         || job.salary         || '';
        job.jobType        = details.jobType        || job.jobType        || '';

        // Update job title to match the resolved position name
        if (job.position) job.title = job.position;

        if (details.hospitalName) job.hospitalName = details.hospitalName;
        if (details.city)  job.city  = details.city;
        if (details.state) job.state = details.state;

        chrome.storage.local.set({ vipvetJobs: jobs }, () => {
          allJobs = jobs;
          filteredJobs = [...jobs];
          filterJobs();
          updateStats();

          if (isFetchingDetails) {
            currentDetailsIndex++;
            setTimeout(() => processNextDetail(), 1500);
          }
        });
      }
    });
  }
});

// ===== FETCH ADDRESSES =====

async function fetchAddresses() {
  if (isFetchingAddresses) {
    alert('Already fetching addresses. Please wait...');
    return;
  }

  const data = await chrome.storage.local.get(['vipvetJobs']);
  const jobs = data.vipvetJobs || [];

  if (jobs.length === 0) {
    alert('No jobs to fetch addresses for.');
    return;
  }

  // Queue only jobs missing a street address
  addressQueue = jobs
    .map((job, index) => ({ job, index }))
    .filter(({ job }) => !job.streetAddress);

  if (addressQueue.length === 0) {
    if (!confirm('All jobs already have street addresses. Re-fetch all?')) return;
    addressQueue = jobs.map((job, index) => ({ job, index }));
  }

  if (!confirm(`This will fetch street addresses for ${addressQueue.length} job(s) via Google Maps. Continue?`)) return;

  isFetchingAddresses = true;
  currentAddressIndex = 0;

  const btn = document.getElementById('fetch-addresses-btn');
  btn.disabled = true;
  btn.textContent = 'Fetching Addresses...';

  const progressSection = document.getElementById('progress-bar');
  const progressLabel = document.getElementById('progress-label');
  const progressDetail = document.getElementById('progress-detail');
  const progressFill = document.getElementById('progress-fill');
  progressSection.classList.remove('hidden');
  progressLabel.textContent = 'Fetching Addresses';
  progressDetail.textContent = `0 / ${addressQueue.length}`;
  progressFill.style.width = '0%';

  processNextAddress();
}

async function fetchAddressFromGoogleMaps(hospitalName, location) {
  const searchQuery = `${hospitalName}, ${location}`;
  const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`;

  function scrapeGoogleMapsTab(url, queryLabel) {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.warn(`Google Maps timeout for: "${queryLabel}"`);
        resolve({ streetAddress: '', zipCode: '', city: '', state: '', website: '', phone: '' });
      }, 30000);

      chrome.tabs.create({ url: url, active: false }, (tab) => {
        if (!tab) {
          clearTimeout(timeout);
          resolve({ streetAddress: '', zipCode: '', city: '', state: '', website: '', phone: '' });
          return;
        }

        const tabId = tab.id;
        const listener = (updatedTabId, info) => {
          if (updatedTabId === tabId && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            // Wait 2s for Google Maps SPA to finish rendering
            setTimeout(() => {
              chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ['google-maps-scraper.js']
              }).then((results) => {
                clearTimeout(timeout);
                chrome.tabs.remove(tabId).catch(() => {});
                const result = results?.[0]?.result || {};
                resolve({
                  streetAddress: result.streetAddress || '',
                  zipCode: result.zipCode || '',
                  city: result.city || '',
                  state: result.state || '',
                  fullAddress: result.fullAddress || '',
                  website: result.website || '',
                  phone: result.phone || ''
                });
              }).catch((err) => {
                console.error(`Google Maps script error for "${queryLabel}":`, err);
                clearTimeout(timeout);
                chrome.tabs.remove(tabId).catch(() => {});
                resolve({ streetAddress: '', zipCode: '', city: '', state: '', website: '', phone: '' });
              });
            }, 2000);
          }
        };

        chrome.tabs.onUpdated.addListener(listener);
      });
    });
  }

  // Attempt 1: hospital name + location
  console.log(`Google Maps search: "${searchQuery}"`);
  let result = await scrapeGoogleMapsTab(mapsUrl, searchQuery);

  // Attempt 2: simplify hospital name if first attempt failed
  if (!result.streetAddress && !result.zipCode) {
    const simplified = hospitalName
      .replace(/&/g, 'and')
      .replace(/[-–—()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const altQuery = `${simplified}, ${location}`;
    if (altQuery !== searchQuery) {
      console.log(`Retry with simplified name: "${altQuery}"`);
      const altUrl = `https://www.google.com/maps/search/${encodeURIComponent(altQuery)}`;
      result = await scrapeGoogleMapsTab(altUrl, altQuery);
    }
  }

  return {
    streetAddress: result.streetAddress || '',
    zipCode: result.zipCode || '',
    city: result.city || '',
    state: result.state || '',
    fullAddress: result.fullAddress || '',
    website: result.website || '',
    phone: result.phone || ''
  };
}

async function processNextAddress() {
  if (currentAddressIndex >= addressQueue.length) {
    isFetchingAddresses = false;
    const btn = document.getElementById('fetch-addresses-btn');
    btn.disabled = false;
    btn.textContent = 'Fetch Addresses';
    document.getElementById('progress-bar').classList.add('hidden');
    alert(`Address fetching complete! Processed ${addressQueue.length} job(s).`);
    loadJobs();
    return;
  }

  const { index } = addressQueue[currentAddressIndex];

  // Update progress
  const progressFill = document.getElementById('progress-fill');
  const progressDetail = document.getElementById('progress-detail');
  progressDetail.textContent = `${currentAddressIndex + 1} / ${addressQueue.length}`;
  progressFill.style.width = `${((currentAddressIndex + 1) / addressQueue.length) * 100}%`;

  const data = await chrome.storage.local.get(['vipvetJobs']);
  const jobs = data.vipvetJobs || [];
  const job = jobs[index];
  if (!job) {
    currentAddressIndex++;
    setTimeout(() => processNextAddress(), 500);
    return;
  }

  const location = [job.city, job.state].filter(Boolean).join(', ') || 'USA';
  const hospitalName = job.hospitalName || job.title || '';

  console.log(`[${currentAddressIndex + 1}/${addressQueue.length}] Fetching address for: ${hospitalName}, ${location}`);

  const addressData = await fetchAddressFromGoogleMaps(hospitalName, location);

  // Save results back to storage and immediately re-render so user can see results live
  const freshData = await chrome.storage.local.get(['vipvetJobs']);
  const freshJobs = freshData.vipvetJobs || [];
  if (freshJobs[index]) {
    if (addressData.streetAddress) freshJobs[index].streetAddress = addressData.streetAddress;
    if (addressData.zipCode)       freshJobs[index].postalCode = addressData.zipCode;
    if (addressData.city && !freshJobs[index].city)   freshJobs[index].city = addressData.city;
    if (addressData.state && !freshJobs[index].state) freshJobs[index].state = addressData.state;
    if (addressData.website) freshJobs[index].website = addressData.website;
    if (addressData.phone)   freshJobs[index].phone = addressData.phone;
    await chrome.storage.local.set({ vipvetJobs: freshJobs });
    // Update in-memory arrays and re-render table so user sees address appear immediately
    allJobs = freshJobs;
    filteredJobs = [...freshJobs];
    renderJobs();
  }

  currentAddressIndex++;
  setTimeout(() => processNextAddress(), 1000);
}

async function debugMissingSalary() {
  const data = await chrome.storage.local.get(['vipvetJobs']);
  const jobs = data.vipvetJobs || [];

  const noSalary = jobs.filter(j => !j.salary && j.description);
  if (noSalary.length === 0) {
    alert('All jobs with descriptions already have a salary!');
    return;
  }

  // For each job, pull out snippets around $, salary, pay, compensation keywords
  const salaryKeywords = /(\$[\d,]+|\bsalar|\bpay\b|\bpay\s|\bwage|\bcomp|\bhourly|\bannual|\bincome|\bearning)/gi;

  let output = `VIPVet — Jobs Missing Salary (${noSalary.length} jobs)\n`;
  output += '='.repeat(70) + '\n\n';

  noSalary.forEach((job, i) => {
    output += `[${i + 1}] ${job.title || '(no title)'}\n`;
    output += `    Req ID : ${job.reqId || ''}\n`;
    output += `    Link   : ${job.link || ''}\n`;

    const desc = job.description || '';

    // Find all lines containing salary keywords
    const lines = desc.split('\n');
    const salaryLines = lines.filter(l => salaryKeywords.test(l));
    salaryKeywords.lastIndex = 0; // reset regex state

    if (salaryLines.length > 0) {
      output += `    --- Salary-related lines from description ---\n`;
      salaryLines.forEach(l => {
        output += `    > ${l.trim()}\n`;
      });
    } else {
      // No keyword lines — show first 600 chars of description as fallback
      output += `    --- No salary keywords found. First 600 chars of description ---\n`;
      output += `    ${desc.substring(0, 600).replace(/\n/g, '\n    ')}\n`;
    }
    output += '\n' + '-'.repeat(70) + '\n\n';
  });

  downloadFile(output, 'vipvet-missing-salary-debug.txt', 'text/plain');
  alert(`Debug file created for ${noSalary.length} jobs missing salary. Upload it to Claude to fix the patterns.`);
}

function exportCSV() {
  const jobsToExport = selectedIndexes.size > 0
    ? Array.from(selectedIndexes).map(i => filteredJobs[i])
    : allJobs;

  const headers = [
    'Title', 'Req ID', 'Hospital Name',
    'Street Address', 'City', 'State', 'Zip Code', 'Country',
    'Phone', 'Website',
    'Category', 'Area of Practice', 'Position', 'Salary', 'Job Type',
    'Link', 'Description'
  ];

  const csvContent = [
    headers.join(','),
    ...jobsToExport.map(job => [
      `"${escapeCSV(job.title)}"`,
      `"${escapeCSV(job.reqId)}"`,
      `"${escapeCSV(job.hospitalName)}"`,
      `"${escapeCSV(job.streetAddress)}"`,
      `"${escapeCSV(job.city)}"`,
      `"${escapeCSV(job.state)}"`,
      `"${escapeCSV(job.postalCode)}"`,
      `"${escapeCSV(job.country)}"`,
      `"${escapeCSV(job.phone)}"`,
      `"${escapeCSV(job.website)}"`,
      `"${escapeCSV(job.category)}"`,
      `"${escapeCSV(job.areaOfPractice)}"`,
      `"${escapeCSV(job.position)}"`,
      `"${escapeCSV(job.salary)}"`,
      `"${escapeCSV(job.jobType)}"`,
      `"${escapeCSV(job.link)}"`,
      `"${escapeCSV(job.description)}"`
    ].join(','))
  ].join('\n');

  downloadFile(csvContent, 'vipvet-jobs.csv', 'text/csv');
}

async function deleteSelected() {
  if (selectedIndexes.size === 0) {
    alert('No jobs selected.');
    return;
  }

  if (!confirm(`Are you sure you want to delete ${selectedIndexes.size} selected jobs?`)) {
    return;
  }

  const indexesToDelete = new Set(Array.from(selectedIndexes).map(i => allJobs.indexOf(filteredJobs[i])));
  allJobs = allJobs.filter((_, i) => !indexesToDelete.has(i));

  await chrome.storage.local.set({ vipvetJobs: allJobs });

  selectedIndexes.clear();
  filterJobs();
}

async function loadWebhookConfig() {
  const stored = await chrome.storage.local.get('vipvetWebhook');
  if (stored.vipvetWebhook) {
    document.getElementById('webhook-url').value = stored.vipvetWebhook.url || '';
    document.getElementById('parent-client').value = stored.vipvetWebhook.parentClient || 'Veterinary Innovative Partners';
  }
}

async function saveWebhookConfig() {
  const url = document.getElementById('webhook-url').value;
  const parentClient = document.getElementById('parent-client').value;

  await chrome.storage.local.set({
    vipvetWebhook: { url, parentClient }
  });

  alert('Webhook configuration saved!');
}

async function sendToWebhook() {
  const webhookUrl = document.getElementById('webhook-url').value;
  const parentClient = document.getElementById('parent-client').value;

  if (!webhookUrl) {
    alert('Please enter a webhook URL.');
    return;
  }

  const data = await chrome.storage.local.get(['vipvetJobs']);
  const jobs = data.vipvetJobs || [];

  if (!jobs || jobs.length === 0) {
    alert('No jobs to send.');
    return;
  }

  const jobsToSend = jobs.map(job => {
    const city = job.city || '';
    const state = job.state || '';
    const location = city && state ? `${city}, ${state}` : (city || state || '');
    return {
      parent_client: parentClient || 'Veterinary Innovative Partners',
      aggregator: 'VIPVet (Parent Client)',
      job_title: job.title || '',
      job_id: job.reqId || '',
      department_id: job.reqId || '',
      hospital: job.hospitalName || '',
      street_address: job.streetAddress || '',
      city,
      state,
      zip_code: job.postalCode || '',
      county: job.county || '',
      phone: job.phone || '',
      website: job.website || '',
      location,
      country: job.country || '',
      category: job.category || '',
      area_of_practice: job.areaOfPractice || '',
      position: job.position || '',
      salary: job.salary || '',
      job_type: job.jobType || '',
      url: job.link || '',
      link: job.link || '',
      description: job.description || ''
    };
  });

  const BATCH_SIZE = 50;
  const totalBatches = Math.ceil(jobsToSend.length / BATCH_SIZE);

  if (!confirm(`This will send ${jobsToSend.length} jobs in ${totalBatches} batch(es) of up to ${BATCH_SIZE}. Continue?`)) {
    return;
  }

  const sendBtn = document.getElementById('send-webhook-btn');
  sendBtn.disabled = true;
  sendBtn.textContent = 'Sending...';

  // Show progress bar
  const progressSection = document.getElementById('progress-bar');
  const progressLabel = document.getElementById('progress-label');
  const progressDetail = document.getElementById('progress-detail');
  const progressFill = document.getElementById('progress-fill');
  progressSection.classList.remove('hidden');
  progressLabel.textContent = 'Sending Batches';
  progressDetail.textContent = `0 / ${totalBatches}`;
  progressFill.style.width = '0%';

  const syncId = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < totalBatches; i++) {
    const batch = jobsToSend.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    const batchNumber = i + 1;

    const payload = {
      source: 'VIPVet Job Scraper',
      parentClientName: parentClient || 'Veterinary Innovative Partners',
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
        const errorText = await response.text();
        throw new Error(`Batch ${batchNumber}: Status ${response.status}. ${errorText}`);
      }

      successCount++;
    } catch (error) {
      console.error(`Batch ${batchNumber} error:`, error);
      failCount++;
    }

    // Update progress
    progressDetail.textContent = `${batchNumber} / ${totalBatches}`;
    progressFill.style.width = `${(batchNumber / totalBatches) * 100}%`;

    // Delay between batches
    if (i < totalBatches - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  // Hide progress bar
  progressSection.classList.add('hidden');
  sendBtn.disabled = false;
  sendBtn.textContent = 'Send';

  alert(`Webhook send complete!\n\nTotal jobs: ${jobsToSend.length}\nBatches sent: ${successCount}/${totalBatches}\nFailed: ${failCount}`);
}

function showJobDetails(job) {
  document.getElementById('modal-title').textContent = job.title;

  const fullAddressLines = [
    job.streetAddress
      ? `<p><strong>Street Address:</strong> ${escapeHtml(job.streetAddress)}</p>`
      : '<p><strong>Street Address:</strong> <em style="color:#aaa">Not fetched — use Fetch Addresses</em></p>',
    `<p><strong>City:</strong> ${escapeHtml(job.city || '—')}</p>`,
    `<p><strong>State:</strong> ${escapeHtml(job.state || '—')}</p>`,
    `<p><strong>Zip Code:</strong> ${escapeHtml(job.postalCode || '—')}</p>`,
    job.phone   ? `<p><strong>Phone:</strong> ${escapeHtml(job.phone)}</p>` : '',
    job.website ? `<p><strong>Website:</strong> <a href="${escapeHtml(job.website)}" target="_blank">${escapeHtml(job.website)}</a></p>` : '',
  ].join('');

  document.getElementById('modal-body').innerHTML = `
    <p><strong>Req ID:</strong> ${escapeHtml(job.reqId)}</p>
    <p><strong>Hospital:</strong> ${escapeHtml(job.hospitalName || 'N/A')}</p>
    <hr style="margin: 12px 0; border-color: #eee;">
    ${fullAddressLines}
    <hr style="margin: 12px 0; border-color: #eee;">
    <p><strong>Category:</strong> ${escapeHtml(job.category || 'N/A')}</p>
    <p><strong>Area of Practice:</strong> ${escapeHtml(job.areaOfPractice || 'N/A')}</p>
    <p><strong>Position:</strong> ${escapeHtml(job.position || 'N/A')}</p>
    <p><strong>Salary:</strong> ${escapeHtml(job.salary || 'N/A')}</p>
    <p><strong>Job Type:</strong> ${escapeHtml(job.jobType || 'N/A')}</p>
    <p><strong>Link:</strong> <a href="${escapeHtml(job.link)}" target="_blank">${escapeHtml(job.link)}</a></p>
    <hr style="margin: 16px 0;">
    <p><strong>Description:</strong></p>
    <pre>${escapeHtml(job.description || 'No description available.')}</pre>
  `;
  document.getElementById('modal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal').classList.add('hidden');
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeCSV(text) {
  if (!text) return '';
  return text.replace(/"/g, '""').replace(/\n/g, ' ');
}

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
