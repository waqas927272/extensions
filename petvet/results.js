// PetVet Care Centers Job Scraper - Results Script

let allJobs = [];
let filteredJobs = [];
let selectedIndexes = new Set();

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

    const location = [job.city, job.state].filter(Boolean).join(', ') || job.fullLocation || '-';

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
      <td class="col-hospital">
        <span class="hospital-badge">${escapeHtml(job.hospitalName)}</span>
      </td>
      <td class="col-location">${escapeHtml(location)}</td>
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

  const headers = ['Job ID', 'Job Title', 'Hospital', 'Street Address', 'City', 'State', 'Country', 'Full Location', 'Link'];

  const csvContent = [
    headers.join(','),
    ...jobsToExport.map(job => [
      `"${escapeCSV(job.jobId)}"`,
      `"${escapeCSV(job.title)}"`,
      `"${escapeCSV(job.hospitalName)}"`,
      `"${escapeCSV(job.streetAddress)}"`,
      `"${escapeCSV(job.city)}"`,
      `"${escapeCSV(job.state)}"`,
      `"${escapeCSV(job.country)}"`,
      `"${escapeCSV(job.fullLocation)}"`,
      `"${escapeCSV(job.link)}"`
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
      job_id: job.jobId,
      job_title: job.title,
      hospital: job.hospitalName,
      street_address: job.streetAddress,
      city: job.city,
      state: job.state,
      country: job.country,
      full_location: job.fullLocation,
      link: job.link,
      category: job.category,
      job_type: job.jobType,
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
  const location = [job.streetAddress, job.city, job.state, job.country].filter(Boolean).join(', ') || job.fullLocation || 'N/A';

  document.getElementById('modal-title').textContent = job.title;
  document.getElementById('modal-body').innerHTML = `
    <p><strong>Job ID:</strong> ${escapeHtml(job.jobId || 'N/A')}</p>
    <p><strong>Hospital:</strong> ${escapeHtml(job.hospitalName)}</p>
    <p><strong>Location:</strong> ${escapeHtml(location)}</p>
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
