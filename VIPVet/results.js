// VIPVet Job Scraper - Results Script

let allJobs = [];
let filteredJobs = [];
let selectedIndexes = new Set();

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
  document.getElementById('export-csv-btn').addEventListener('click', exportCSV);
  document.getElementById('delete-selected-btn').addEventListener('click', deleteSelected);

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
      job.title.toLowerCase().includes(searchTerm) ||
      job.hospitalName.toLowerCase().includes(searchTerm) ||
      job.city.toLowerCase().includes(searchTerm) ||
      job.state.toLowerCase().includes(searchTerm);

    // Type filter
    let matchesFilter = true;
    if (filterValue === 'duplicates') {
      matchesFilter = duplicateIds.has(job.reqId);
    } else if (filterValue === 'unique') {
      matchesFilter = !duplicateIds.has(job.reqId);
    } else if (filterValue === 'no-description') {
      matchesFilter = !job.description;
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
      <td class="col-location">${escapeHtml(job.city)}${job.state ? ', ' + escapeHtml(job.state) : ''}</td>
      <td class="col-category">${escapeHtml(job.category || '')}</td>
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
  const btn = document.getElementById('get-descriptions-btn');
  const progressSection = document.getElementById('progress-bar');
  const progressLabel = document.getElementById('progress-label');
  const progressDetail = document.getElementById('progress-detail');
  const progressFill = document.getElementById('progress-fill');

  const jobsToFetch = allJobs.filter(j => !j.description);

  if (jobsToFetch.length === 0) {
    alert('All jobs already have descriptions.');
    return;
  }

  btn.disabled = true;
  progressSection.classList.remove('hidden');

  for (let i = 0; i < jobsToFetch.length; i++) {
    const job = jobsToFetch[i];
    const percent = Math.round(((i + 1) / jobsToFetch.length) * 100);

    progressLabel.textContent = 'Fetching descriptions...';
    progressDetail.textContent = `${i + 1}/${jobsToFetch.length}`;
    progressFill.style.width = `${percent}%`;

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'fetchDescription',
        url: job.link
      });

      if (response && response.description) {
        const idx = allJobs.indexOf(job);
        allJobs[idx].description = response.description;
        if (response.jobType) allJobs[idx].jobType = response.jobType;
      }
    } catch (e) {
      console.error('Error fetching description:', e);
    }

    await new Promise(r => setTimeout(r, 300));
  }

  await chrome.storage.local.set({ vipvetJobs: allJobs });

  btn.disabled = false;
  progressSection.classList.add('hidden');

  filterJobs();
  alert('Descriptions fetched successfully!');
}

function exportCSV() {
  const jobsToExport = selectedIndexes.size > 0
    ? Array.from(selectedIndexes).map(i => filteredJobs[i])
    : allJobs;

  const headers = ['Title', 'Req ID', 'Hospital Name', 'City', 'State', 'Country', 'Category', 'Job Type', 'Link', 'Description'];

  const csvContent = [
    headers.join(','),
    ...jobsToExport.map(job => [
      `"${escapeCSV(job.title)}"`,
      `"${escapeCSV(job.reqId)}"`,
      `"${escapeCSV(job.hospitalName)}"`,
      `"${escapeCSV(job.city)}"`,
      `"${escapeCSV(job.state)}"`,
      `"${escapeCSV(job.country)}"`,
      `"${escapeCSV(job.category)}"`,
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
  const url = document.getElementById('webhook-url').value;
  const parentClient = document.getElementById('parent-client').value;

  if (!url) {
    alert('Please enter a webhook URL.');
    return;
  }

  const jobsToSend = selectedIndexes.size > 0
    ? Array.from(selectedIndexes).map(i => filteredJobs[i])
    : allJobs;

  if (jobsToSend.length === 0) {
    alert('No jobs to send.');
    return;
  }

  const payload = {
    data: jobsToSend.map(job => ({
      parent_client: parentClient,
      job_title: job.title,
      req_id: job.reqId,
      hospital: job.hospitalName,
      city: job.city,
      state: job.state,
      country: job.country,
      category: job.category,
      job_type: job.jobType,
      link: job.link,
      job_description: job.description
    }))
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      alert(`Successfully sent ${jobsToSend.length} jobs to webhook!`);
    } else {
      alert(`Webhook error: ${response.status} ${response.statusText}`);
    }
  } catch (e) {
    alert(`Error sending to webhook: ${e.message}`);
  }
}

function showJobDetails(job) {
  document.getElementById('modal-title').textContent = job.title;
  document.getElementById('modal-body').innerHTML = `
    <p><strong>Req ID:</strong> ${escapeHtml(job.reqId)}</p>
    <p><strong>Hospital:</strong> ${escapeHtml(job.hospitalName || 'N/A')}</p>
    <p><strong>Location:</strong> ${escapeHtml(job.city)}${job.state ? ', ' + escapeHtml(job.state) : ''}</p>
    <p><strong>Category:</strong> ${escapeHtml(job.category || 'N/A')}</p>
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
