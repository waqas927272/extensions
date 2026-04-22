// PetVet Care Centers Job Scraper - Results Script

let allJobs = [];
let filteredJobs = [];
let selectedIndexes = new Set();
let isGettingDescriptions = false;
let currentJobIndex = 0;
let isFetchingAddresses = false;
let addressQueue = [];
let currentAddressIndex = 0;

document.addEventListener('DOMContentLoaded', () => {
  loadJobs();
  setupEventListeners();
});

async function loadJobs() {
  const stored = await chrome.storage.local.get('petvetJobs');
  allJobs = stored.petvetJobs || [];

  if (allJobs.length === 0) {
    document.getElementById('no-data').classList.remove('hidden');
    document.querySelector('.table-wrapper').classList.add('hidden');
    return;
  }

  document.getElementById('no-data').classList.add('hidden');
  document.querySelector('.table-wrapper').classList.remove('hidden');

  // Populate hospital filter
  populateHospitalFilter();

  filteredJobs = [...allJobs];
  renderJobs();
  updateStats();
}

function populateHospitalFilter() {
  const hospitalFilter = document.getElementById('hospital-filter');
  const hospitals = [...new Set(allJobs.map(job => job.hospitalName))].sort();

  hospitals.forEach(hospital => {
    const option = document.createElement('option');
    option.value = hospital;
    option.textContent = hospital;
    hospitalFilter.appendChild(option);
  });
}

function setupEventListeners() {
  // Search
  document.getElementById('search-input').addEventListener('input', filterJobs);

  // Hospital filter
  document.getElementById('hospital-filter').addEventListener('change', filterJobs);

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

  document.getElementById('get-descriptions-btn').addEventListener('click', getJobDescriptions);
  document.getElementById('fetch-details-btn').addEventListener('click', fetchDetails);
  document.getElementById('fetch-addresses-btn').addEventListener('click', fetchAddresses);
  document.getElementById('export-csv-btn').addEventListener('click', exportCSV);
  document.getElementById('delete-selected-btn').addEventListener('click', deleteSelected);
  document.getElementById('clear-all-btn').addEventListener('click', clearAllJobs);

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
  const hospitalFilter = document.getElementById('hospital-filter').value;

  filteredJobs = allJobs.filter((job) => {
    // Search filter
    const matchesSearch = !searchTerm ||
      job.title.toLowerCase().includes(searchTerm) ||
      job.hospitalName.toLowerCase().includes(searchTerm) ||
      (job.city && job.city.toLowerCase().includes(searchTerm)) ||
      (job.state && job.state.toLowerCase().includes(searchTerm)) ||
      (job.fullLocation && job.fullLocation.toLowerCase().includes(searchTerm));

    // Hospital filter
    const matchesHospital = hospitalFilter === 'all' || job.hospitalName === hospitalFilter;

    return matchesSearch && matchesHospital;
  });

  selectedIndexes.clear();
  renderJobs();
  updateStats();
}

function renderJobs() {
  const tbody = document.getElementById('jobs-tbody');
  tbody.innerHTML = '';

  filteredJobs.forEach((job, index) => {
    const originalIndex = allJobs.indexOf(job);
    const isSelected = selectedIndexes.has(index);

    const tr = document.createElement('tr');
    tr.className = isSelected ? 'selected' : '';
    tr.dataset.index = originalIndex;

    tr.innerHTML = `
      <td class="col-checkbox">
        <input type="checkbox" class="job-checkbox" data-index="${index}" ${isSelected ? 'checked' : ''}>
      </td>
      <td class="col-title">
        <a href="${escapeHtml(job.link)}" target="_blank">${escapeHtml(job.title)}</a>
      </td>
      <td class="col-jobid">${escapeHtml(job.jobId || 'N/A')}</td>
      <td class="col-areaofpractice">${escapeHtml(job.areaOfPractice || '-')}</td>
      <td class="col-position">${escapeHtml(job.position || '-')}</td>
      <td class="col-jobtype">${escapeHtml(job.jobType || '-')}</td>
      <td class="col-salary">${escapeHtml(job.salary || '-')}</td>
      <td class="col-hospital">
        <span class="hospital-badge">${escapeHtml(job.hospitalName)}</span>
      </td>
      <td class="col-city">${escapeHtml(job.city || '-')}</td>
      <td class="col-state">${escapeHtml(job.state || '-')}</td>
      <td class="col-address">${escapeHtml(job.streetAddress || '-')}</td>
      <td class="col-zipcode">${escapeHtml(job.zipCode || '-')}</td>
      <td class="col-phone">${escapeHtml(job.phone || '-')}</td>
      <td class="col-actions">
        <button class="view-btn" data-index="${originalIndex}">View</button>
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
}

function updateStats() {
  const uniqueHospitals = new Set(allJobs.map(j => j.hospitalName)).size;

  document.getElementById('total-count').textContent = allJobs.length;
  document.getElementById('selected-count').textContent = selectedIndexes.size;
  document.getElementById('hospitals-count').textContent = uniqueHospitals;
}

function exportCSV() {
  const jobsToExport = selectedIndexes.size > 0
    ? Array.from(selectedIndexes).map(i => filteredJobs[i])
    : allJobs;

  const headers = ['Job ID', 'Job Title', 'Area of Practice', 'Position', 'Job Type', 'Salary', 'Hospital', 'Street Address', 'City', 'State', 'Zip Code', 'Phone', 'Website', 'Country', 'Full Location', 'Link', 'Description'];

  const csvContent = [
    headers.join(','),
    ...jobsToExport.map(job => [
      `"${escapeCSV(job.jobId)}"`,
      `"${escapeCSV(job.title)}"`,
      `"${escapeCSV(job.areaOfPractice)}"`,
      `"${escapeCSV(job.position)}"`,
      `"${escapeCSV(job.jobType)}"`,
      `"${escapeCSV(job.salary)}"`,
      `"${escapeCSV(job.hospitalName)}"`,
      `"${escapeCSV(job.streetAddress)}"`,
      `"${escapeCSV(job.city)}"`,
      `"${escapeCSV(job.state)}"`,
      `"${escapeCSV(job.zipCode)}"`,
      `"${escapeCSV(job.phone)}"`,
      `"${escapeCSV(job.website)}"`,
      `"${escapeCSV(job.country)}"`,
      `"${escapeCSV(job.fullLocation)}"`,
      `"${escapeCSV(job.link)}"`,
      `"${escapeCSV(job.description)}"`
    ].join(','))
  ].join('\n');

  downloadFile(csvContent, 'petvet-jobs.csv', 'text/csv');
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

  await chrome.storage.local.set({ petvetJobs: allJobs });

  selectedIndexes.clear();

  // Repopulate hospital filter
  const hospitalFilter = document.getElementById('hospital-filter');
  hospitalFilter.innerHTML = '<option value="all">All Hospitals</option>';
  populateHospitalFilter();

  filterJobs();
}

async function clearAllJobs() {
  if (!confirm('Are you sure you want to delete ALL scraped jobs? This cannot be undone.')) {
    return;
  }

  await chrome.storage.local.remove('petvetJobs');
  allJobs = [];
  filteredJobs = [];
  selectedIndexes.clear();

  document.getElementById('no-data').classList.remove('hidden');
  document.querySelector('.table-wrapper').classList.add('hidden');
  updateStats();
}

async function loadWebhookConfig() {
  const stored = await chrome.storage.local.get('petvetWebhook');
  if (stored.petvetWebhook) {
    document.getElementById('webhook-url').value = stored.petvetWebhook.url || '';
    document.getElementById('parent-client').value = stored.petvetWebhook.parentClient || 'PetVet Care Centers';
  }
}

async function saveWebhookConfig() {
  const url = document.getElementById('webhook-url').value;
  const parentClient = document.getElementById('parent-client').value;

  await chrome.storage.local.set({
    petvetWebhook: { url, parentClient }
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

  const jobsToSendRaw = selectedIndexes.size > 0
    ? Array.from(selectedIndexes).map(i => filteredJobs[i])
    : allJobs;

  if (jobsToSendRaw.length === 0) {
    alert('No jobs to send.');
    return;
  }

  const jobsToSend = jobsToSendRaw.map(job => ({
    parent_client: parentClient,
    job_id: job.jobId,
    job_title: job.title,
    area_of_practice: job.areaOfPractice,
    position: job.position,
    salary: job.salary,
    hospital: job.hospitalName,
    street_address: job.streetAddress,
    city: job.city,
    state: job.state,
    zip_code: job.zipCode,
    phone: job.phone,
    website: job.website,
    country: job.country,
    full_location: job.fullLocation,
    link: job.link,
    category: job.category,
    job_type: job.jobType,
    description: job.description || ''
  }));

  const BATCH_SIZE = 50;
  const totalBatches = Math.ceil(jobsToSend.length / BATCH_SIZE);

  if (!confirm(`This will send ${jobsToSend.length} jobs in ${totalBatches} batch(es) of up to ${BATCH_SIZE}. Continue?`)) {
    return;
  }

  const sendBtn = document.getElementById('send-webhook-btn');
  sendBtn.disabled = true;
  sendBtn.textContent = 'Sending...';

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
      source: 'PetVet Care Centers Job Scraper',
      parentClientName: parentClient,
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
  sendBtn.disabled = false;
  sendBtn.textContent = 'Send';

  alert(`Webhook send complete!\n\nTotal jobs: ${jobsToSend.length}\nBatches sent: ${successCount}/${totalBatches}\nFailed: ${failCount}`);
}

// ============ FETCH DETAILS ============

let isFetchingDetails = false;
let detailsQueue = [];
let currentDetailIndex = 0;

async function fetchDetails() {
  if (isFetchingDetails) {
    alert('Already fetching details. Please wait...');
    return;
  }

  const stored = await chrome.storage.local.get('petvetJobs');
  const jobs = stored.petvetJobs || [];

  // Get ALL jobs with a link
  const jobsToFetch = jobs.filter(job => job.link);
  if (jobsToFetch.length === 0) {
    alert('No jobs with links found!');
    return;
  }

  isFetchingDetails = true;
  detailsQueue = jobsToFetch.map((job, idx) => ({
    ...job,
    originalIndex: idx
  }));
  currentDetailIndex = 0;

  const fetchBtn = document.getElementById('fetch-details-btn');
  fetchBtn.disabled = true;
  fetchBtn.textContent = 'Fetching Details...';

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
}

async function processNextDetail() {
  if (currentDetailIndex >= detailsQueue.length) {
    console.log('All details processed!');
    isFetchingDetails = false;
    const fetchBtn = document.getElementById('fetch-details-btn');
    fetchBtn.disabled = false;
    fetchBtn.textContent = 'Fetch Details';

    const progressSection = document.getElementById('progressSection');
    progressSection.classList.add('hidden');

    loadJobs();
    alert('All details have been fetched!');
    return;
  }

  const job = detailsQueue[currentDetailIndex];
  const jobIndex = detailsQueue[currentDetailIndex].originalIndex;

  console.log(`Processing detail ${currentDetailIndex + 1}/${detailsQueue.length}: Job ${jobIndex} - ${job.hospital}`);

  // Update progress BEFORE opening tab
  const progressBar = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');
  progressText.textContent = `${currentDetailIndex + 1} / ${detailsQueue.length}`;
  progressBar.style.width = `${((currentDetailIndex + 1) / detailsQueue.length) * 100}%`;

  try {
    const tab = await chrome.tabs.create({ url: job.link, active: false });
    console.log(`Opened tab ${tab.id} for job ${jobIndex}`);
    
    chrome.runtime.sendMessage({
      action: 'fetchJobDetails',
      tabId: tab.id,
      jobIndex: jobIndex,
      jobLink: job.link
    });
  } catch (error) {
    console.error('Error opening job details tab:', error);
    // On error, increment and continue with next job
    currentDetailIndex++;
    setTimeout(processNextDetail, 1500);
  }
}

// ============ FETCH ADDRESSES ============

async function fetchAddresses() {
  if (isFetchingAddresses) {
    alert('Already fetching addresses. Please wait...');
    return;
  }

  const stored = await chrome.storage.local.get('petvetJobs');
  const jobs = stored.petvetJobs || [];

  // Get ALL jobs that have a hospital name (process all records)
  const jobsToFetch = jobs.filter(job => job.hospitalName);
  if (jobsToFetch.length === 0) {
    alert('No jobs with hospital names found!');
    return;
  }

  isFetchingAddresses = true;
  addressQueue = jobsToFetch.map((job, idx) => ({
    ...job,
    originalIndex: idx
  }));
  currentAddressIndex = 0;

  const fetchBtn = document.getElementById('fetch-addresses-btn');
  fetchBtn.disabled = true;
  fetchBtn.textContent = 'Fetching Addresses...';

  // Show progress
  const progressSection = document.getElementById('progressSection');
  const progressBar = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');
  const progressLabel = document.getElementById('progressLabel');
  progressSection.classList.remove('hidden');
  progressLabel.textContent = 'Fetching Addresses';
  progressText.textContent = `0 / ${addressQueue.length}`;
  progressBar.style.width = '0%';

  processNextAddress();
}

async function processNextAddress() {
  if (currentAddressIndex >= addressQueue.length) {
    isFetchingAddresses = false;
    const fetchBtn = document.getElementById('fetch-addresses-btn');
    fetchBtn.disabled = false;
    fetchBtn.textContent = 'Fetch Addresses';
    document.getElementById('progressSection').classList.add('hidden');
    
    // Reload jobs
    const stored = await chrome.storage.local.get('petvetJobs');
    allJobs = stored.petvetJobs || [];
    filteredJobs = [...allJobs];
    filterJobs();
    
    alert('All addresses have been fetched!');
    return;
  }

  const job = addressQueue[currentAddressIndex];
  const jobIndex = job.originalIndex;

  // Update progress
  const progressBar = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');
  progressText.textContent = `${currentAddressIndex + 1} / ${addressQueue.length}`;
  progressBar.style.width = `${((currentAddressIndex + 1) / addressQueue.length) * 100}%`;

  try {
    // Build Google Maps search URL
    const searchQuery = `${job.hospitalName} ${job.city || ''} ${job.state || ''}`.trim();
    const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`;
    
    const tab = await chrome.tabs.create({ url: mapsUrl, active: false });
    chrome.runtime.sendMessage({
      action: 'scrapeJobAddress',
      tabId: tab.id,
      jobIndex: jobIndex,
      hospitalName: job.hospitalName,
      city: job.city,
      state: job.state
    });
  } catch (error) {
    console.error('Error opening tab for address:', error);
    currentAddressIndex++;
    setTimeout(() => processNextAddress(), 1500);
  }
}

// Listen for address saved messages from background.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Message received in results.js:', message);
  if (message.action === 'addressSaved') {
    console.log('Address saved, incrementing index to:', currentAddressIndex + 1);
    currentAddressIndex++;
    setTimeout(() => processNextAddress(), 1500);
  } else if (message.action === 'detailSaved') {
    console.log('Detail saved for job', message.jobIndex, 'incrementing index to:', currentDetailIndex + 1);
    currentDetailIndex++;
    setTimeout(() => processNextDetail(), 1500);
  }
})

// ============ GET DESCRIPTIONS ============

async function getJobDescriptions() {
  if (isGettingDescriptions) {
    alert('Already getting descriptions. Please wait...');
    return;
  }

  const stored = await chrome.storage.local.get('petvetJobs');
  const jobs = stored.petvetJobs || [];

  const jobsWithoutDesc = jobs.filter(job => !job.description && job.link);
  if (jobsWithoutDesc.length === 0) {
    alert('All jobs already have descriptions!');
    return;
  }

  isGettingDescriptions = true;
  currentJobIndex = 0;

  const getBtn = document.getElementById('get-descriptions-btn');
  getBtn.disabled = true;
  getBtn.textContent = 'Getting Descriptions...';

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
  const stored = await chrome.storage.local.get('petvetJobs');
  const jobs = stored.petvetJobs || [];

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
    const getBtn = document.getElementById('get-descriptions-btn');
    getBtn.disabled = false;
    getBtn.textContent = 'Get Descriptions';
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
    chrome.storage.local.get(['petvetJobs'], (data) => {
      const jobs = data.petvetJobs || [];
      allJobs = jobs;
      filteredJobs = [...jobs];
      filterJobs();
      updateStats();

      if (isGettingDescriptions) {
        setTimeout(() => processNextJob(), 1500);
      }
    });
  }
})

function showJobDetails(job) {
  const location = [job.streetAddress, job.city, job.state, job.country].filter(Boolean).join(', ') || job.fullLocation || 'N/A';

  document.getElementById('modal-title').textContent = job.title;
  document.getElementById('modal-body').innerHTML = `
    <p><strong>Job ID:</strong> ${escapeHtml(job.jobId || 'N/A')}</p>
    <p><strong>Area of Practice:</strong> ${escapeHtml(job.areaOfPractice || 'N/A')}</p>
    <p><strong>Position:</strong> ${escapeHtml(job.position || 'N/A')}</p>
    <p><strong>Job Type:</strong> ${escapeHtml(job.jobType || 'N/A')}</p>
    <p><strong>Salary:</strong> ${escapeHtml(job.salary || 'N/A')}</p>
    <p><strong>Hospital:</strong> ${escapeHtml(job.hospitalName)}</p>
    <p><strong>Location:</strong> ${escapeHtml(location)}</p>
    <p><strong>Zip Code:</strong> ${escapeHtml(job.zipCode || 'N/A')}</p>
    <p><strong>Phone:</strong> ${escapeHtml(job.phone || 'N/A')}</p>
    <p><strong>Website:</strong> ${job.website ? `<a href="${escapeHtml(job.website)}" target="_blank">${escapeHtml(job.website)}</a>` : 'N/A'}</p>
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
