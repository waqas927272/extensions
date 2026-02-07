// Shore Capital Job Scraper - Results Page Script

let allJobs = [];
let filteredJobs = [];
let selectedIndexes = new Set();
let isGettingDescriptions = false;
let currentJobIndex = 0;

document.addEventListener('DOMContentLoaded', () => {
  loadJobs();
  setupEventListeners();
});

async function loadJobs() {
  const stored = await chrome.storage.local.get('shoreCapitalJobs');
  allJobs = stored.shoreCapitalJobs || [];

  if (allJobs.length === 0) {
    document.getElementById('no-data').classList.remove('hidden');
    document.querySelector('.table-wrapper').classList.add('hidden');
    return;
  }

  document.getElementById('no-data').classList.add('hidden');
  document.querySelector('.table-wrapper').classList.remove('hidden');

  populateCompanyFilter();
  filteredJobs = [...allJobs];
  renderJobs();
  updateStats();
}

function populateCompanyFilter() {
  const companyFilter = document.getElementById('company-filter');
  const companies = [...new Set(allJobs.map(job => job.company).filter(Boolean))].sort();

  companies.forEach(company => {
    const option = document.createElement('option');
    option.value = company;
    option.textContent = company;
    companyFilter.appendChild(option);
  });
}

function setupEventListeners() {
  // Search
  document.getElementById('search-input').addEventListener('input', filterJobs);

  // Company filter
  document.getElementById('company-filter').addEventListener('change', filterJobs);

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
  const companyFilter = document.getElementById('company-filter').value;

  filteredJobs = allJobs.filter((job) => {
    const matchesSearch = !searchTerm ||
      (job.title || '').toLowerCase().includes(searchTerm) ||
      (job.company || '').toLowerCase().includes(searchTerm) ||
      (job.city || '').toLowerCase().includes(searchTerm) ||
      (job.state || '').toLowerCase().includes(searchTerm) ||
      (job.location || '').toLowerCase().includes(searchTerm) ||
      (job.skills || '').toLowerCase().includes(searchTerm) ||
      (job.industry || '').toLowerCase().includes(searchTerm);

    const matchesCompany = companyFilter === 'all' || job.company === companyFilter;

    return matchesSearch && matchesCompany;
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

    const location = [job.city, job.state].filter(Boolean).join(', ') || job.location || '-';
    const typeHtml = job.jobType
      ? `<span class="type-badge">${escapeHtml(job.jobType)}</span>`
      : '-';

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
      <td class="col-company">
        <span class="company-badge">${escapeHtml(job.company)}</span>
      </td>
      <td class="col-location">${escapeHtml(location)}</td>
      <td class="col-type">${typeHtml}</td>
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
  const uniqueCompanies = new Set(allJobs.map(j => j.company).filter(Boolean)).size;

  document.getElementById('total-count').textContent = allJobs.length;
  document.getElementById('selected-count').textContent = selectedIndexes.size;
  document.getElementById('companies-count').textContent = uniqueCompanies;
}

function exportCSV() {
  const jobsToExport = selectedIndexes.size > 0
    ? Array.from(selectedIndexes).map(i => filteredJobs[i])
    : allJobs;

  if (jobsToExport.length === 0) {
    alert('No data to export.');
    return;
  }

  const headers = ['Job Title', 'Job ID', 'Company', 'City', 'State', 'Location', 'Job Type', 'Salary', 'Industry', 'Company Size', 'Posted Date', 'Skills', 'Link', 'Description'];

  const csvContent = [
    headers.join(','),
    ...jobsToExport.map(job => [
      `"${escapeCSV(job.title)}"`,
      `"${escapeCSV(job.jobId)}"`,
      `"${escapeCSV(job.company)}"`,
      `"${escapeCSV(job.city)}"`,
      `"${escapeCSV(job.state)}"`,
      `"${escapeCSV(job.location)}"`,
      `"${escapeCSV(job.jobType)}"`,
      `"${escapeCSV(job.salary)}"`,
      `"${escapeCSV(job.industry)}"`,
      `"${escapeCSV(job.companySize)}"`,
      `"${escapeCSV(job.postedDate)}"`,
      `"${escapeCSV(job.skills)}"`,
      `"${escapeCSV(job.link)}"`,
      `"${escapeCSV(job.description)}"`
    ].join(','))
  ].join('\n');

  downloadFile(csvContent, 'shore-capital-jobs.csv', 'text/csv');
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

  await chrome.storage.local.set({ shoreCapitalJobs: allJobs });

  selectedIndexes.clear();

  // Repopulate company filter
  const companyFilter = document.getElementById('company-filter');
  companyFilter.innerHTML = '<option value="all">All Companies</option>';
  populateCompanyFilter();

  filterJobs();
}

async function clearAllJobs() {
  if (!confirm('Are you sure you want to delete ALL scraped jobs? This cannot be undone.')) {
    return;
  }

  await chrome.storage.local.remove('shoreCapitalJobs');
  allJobs = [];
  filteredJobs = [];
  selectedIndexes.clear();

  document.getElementById('no-data').classList.remove('hidden');
  document.querySelector('.table-wrapper').classList.add('hidden');
  updateStats();
}

async function loadWebhookConfig() {
  const stored = await chrome.storage.local.get('shoreCapitalWebhook');
  if (stored.shoreCapitalWebhook) {
    document.getElementById('webhook-url').value = stored.shoreCapitalWebhook.url || '';
    document.getElementById('parent-client').value = stored.shoreCapitalWebhook.parentClient || 'Shore Capital';
  }
}

async function saveWebhookConfig() {
  const url = document.getElementById('webhook-url').value;
  const parentClient = document.getElementById('parent-client').value;

  await chrome.storage.local.set({
    shoreCapitalWebhook: { url, parentClient }
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
    job_title: job.title || '',
    job_id: job.jobId || '',
    company: job.company || '',
    city: job.city || '',
    state: job.state || '',
    location: job.location || '',
    job_type: job.jobType || '',
    salary: job.salary || '',
    industry: job.industry || '',
    company_size: job.companySize || '',
    posted_date: job.postedDate || '',
    skills: job.skills || '',
    link: job.link || '',
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
      source: 'Shore Capital Job Scraper',
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

function showJobDetails(job) {
  const location = [job.city, job.state].filter(Boolean).join(', ') || job.location || 'N/A';

  let skillsHtml = 'N/A';
  if (job.skills) {
    const skillTags = job.skills.split(',').map(s => s.trim()).filter(Boolean)
      .map(s => `<span class="skill-tag">${escapeHtml(s)}</span>`).join('');
    skillsHtml = `<div class="skills-list">${skillTags}</div>`;
  }

  document.getElementById('modal-title').textContent = job.title;
  document.getElementById('modal-body').innerHTML = `
    <p><strong>Job ID:</strong> ${escapeHtml(job.jobId || 'N/A')}</p>
    <p><strong>Company:</strong> ${escapeHtml(job.company)}</p>
    <p><strong>Location:</strong> ${escapeHtml(location)}</p>
    <p><strong>Job Type:</strong> ${escapeHtml(job.jobType || 'N/A')}</p>
    <p><strong>Salary:</strong> ${escapeHtml(job.salary || 'N/A')}</p>
    <p><strong>Industry:</strong> ${escapeHtml(job.industry || 'N/A')}</p>
    <p><strong>Company Size:</strong> ${escapeHtml(job.companySize || 'N/A')}</p>
    <p><strong>Posted:</strong> ${escapeHtml(job.postedDate || 'N/A')}</p>
    <p><strong>Skills:</strong> ${skillsHtml}</p>
    <p><strong>Link:</strong> <a href="${escapeHtml(job.link)}" target="_blank">${escapeHtml(job.link)}</a></p>
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

// ============ GET DESCRIPTIONS ============

async function getJobDescriptions() {
  if (isGettingDescriptions) {
    alert('Already getting descriptions. Please wait...');
    return;
  }

  const stored = await chrome.storage.local.get('shoreCapitalJobs');
  const jobs = stored.shoreCapitalJobs || [];

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
  const stored = await chrome.storage.local.get('shoreCapitalJobs');
  const jobs = stored.shoreCapitalJobs || [];

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
    chrome.storage.local.get(['shoreCapitalJobs'], (data) => {
      const jobs = data.shoreCapitalJobs || [];
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
