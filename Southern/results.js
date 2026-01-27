// Shore Capital Job Scraper - Results Script

let allCompanies = [];
let filteredCompanies = [];
let selectedIndexes = new Set();
let isGettingJobs = false;
let stopJobsRequested = false;

document.addEventListener('DOMContentLoaded', () => {
  loadCompanies();
  setupEventListeners();
});

async function loadCompanies() {
  const stored = await chrome.storage.local.get('shoreCapitalData');
  allCompanies = stored.shoreCapitalData || [];

  if (allCompanies.length === 0) {
    document.getElementById('no-data').classList.remove('hidden');
    document.querySelector('.table-wrapper').classList.add('hidden');
    return;
  }

  document.getElementById('no-data').classList.add('hidden');
  document.querySelector('.table-wrapper').classList.remove('hidden');

  filteredCompanies = [...allCompanies];
  renderCompanies();
  updateStats();
}

function setupEventListeners() {
  // Search
  document.getElementById('search-input').addEventListener('input', filterCompanies);

  // Filter select
  document.getElementById('filter-select').addEventListener('change', filterCompanies);

  // Select all checkbox
  document.getElementById('select-all-checkbox').addEventListener('change', (e) => {
    if (e.target.checked) {
      filteredCompanies.forEach((_, i) => selectedIndexes.add(i));
    } else {
      selectedIndexes.clear();
    }
    renderCompanies();
    updateStats();
  });

  // Action buttons
  document.getElementById('select-all-btn').addEventListener('click', () => {
    filteredCompanies.forEach((_, i) => selectedIndexes.add(i));
    renderCompanies();
    updateStats();
  });

  document.getElementById('deselect-all-btn').addEventListener('click', () => {
    selectedIndexes.clear();
    renderCompanies();
    updateStats();
  });

  document.getElementById('select-with-jobs-btn').addEventListener('click', selectWithJobs);
  document.getElementById('get-jobs-btn').addEventListener('click', getJobsFromCompanies);
  document.getElementById('view-jobs-btn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('jobs.html') });
  });
  document.getElementById('stop-jobs-btn').addEventListener('click', () => {
    stopJobsRequested = true;
  });
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

function filterCompanies() {
  const searchTerm = document.getElementById('search-input').value.toLowerCase();
  const filterValue = document.getElementById('filter-select').value;

  filteredCompanies = allCompanies.filter((company) => {
    // Search filter
    const matchesSearch = !searchTerm ||
      company.title.toLowerCase().includes(searchTerm) ||
      (company.industry && company.industry.toLowerCase().includes(searchTerm)) ||
      (company.location && company.location.toLowerCase().includes(searchTerm)) ||
      (company.description && company.description.toLowerCase().includes(searchTerm));

    // Type filter
    let matchesFilter = true;
    if (filterValue === 'with-jobs') {
      matchesFilter = company.numJobs > 0;
    } else if (filterValue === 'no-jobs') {
      matchesFilter = company.numJobs === 0;
    }

    return matchesSearch && matchesFilter;
  });

  selectedIndexes.clear();
  renderCompanies();
  updateStats();
}

function renderCompanies() {
  const tbody = document.getElementById('jobs-tbody');
  tbody.innerHTML = '';

  filteredCompanies.forEach((company, index) => {
    const originalIndex = allCompanies.indexOf(company);
    const isSelected = selectedIndexes.has(index);
    const hasJobs = company.numJobs > 0;

    const tr = document.createElement('tr');
    tr.className = isSelected ? 'selected' : '';
    tr.dataset.index = originalIndex;

    tr.innerHTML = `
      <td class="col-checkbox">
        <input type="checkbox" class="company-checkbox" data-index="${index}" ${isSelected ? 'checked' : ''}>
      </td>
      <td class="col-name">
        <a href="${escapeHtml(company.link)}" target="_blank">${escapeHtml(company.title)}</a>
      </td>
      <td class="col-jobs">
        <span class="jobs-badge ${hasJobs ? 'has-jobs' : 'no-jobs'}">${company.numJobs}</span>
      </td>
      <td class="col-industry">${escapeHtml(company.industry || '-')}</td>
      <td class="col-location">${escapeHtml(company.location || '-')}</td>
      <td class="col-employees">${escapeHtml(company.jobType || '-')}</td>
      <td class="col-description">
        ${company.description
          ? `<span class="description-preview" title="${escapeHtml(company.description.substring(0, 200))}" data-index="${originalIndex}">${escapeHtml(company.description.substring(0, 60))}...</span>`
          : '-'
        }
      </td>
      <td class="col-actions">
        <button class="view-btn" data-index="${originalIndex}">View</button>
      </td>
    `;

    tbody.appendChild(tr);
  });

  // Add event listeners
  document.querySelectorAll('.company-checkbox').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.index);
      if (e.target.checked) {
        selectedIndexes.add(idx);
      } else {
        selectedIndexes.delete(idx);
      }
      renderCompanies();
      updateStats();
    });
  });

  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.index);
      showCompanyDetails(allCompanies[idx]);
    });
  });

  document.querySelectorAll('.description-preview').forEach(el => {
    el.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.index);
      showCompanyDetails(allCompanies[idx]);
    });
  });
}

function updateStats() {
  const totalJobsCount = allCompanies.reduce((sum, c) => sum + (c.numJobs || 0), 0);

  document.getElementById('total-count').textContent = allCompanies.length;
  document.getElementById('selected-count').textContent = selectedIndexes.size;
  document.getElementById('total-jobs').textContent = totalJobsCount;
}

function selectWithJobs() {
  selectedIndexes.clear();

  filteredCompanies.forEach((company, index) => {
    if (company.numJobs > 0) {
      selectedIndexes.add(index);
    }
  });

  renderCompanies();
  updateStats();
}

async function getJobsFromCompanies() {
  if (isGettingJobs) return;

  // Get companies to process (selected or all)
  let companiesToProcess = [];
  if (selectedIndexes.size > 0) {
    companiesToProcess = Array.from(selectedIndexes).map(i => filteredCompanies[i]);
  } else {
    companiesToProcess = [...allCompanies];
  }

  if (companiesToProcess.length === 0) {
    alert('No companies to process. Please scrape companies first.');
    return;
  }

  if (!confirm(`This will fetch jobs from ${companiesToProcess.length} companies. Continue?`)) {
    return;
  }

  isGettingJobs = true;
  stopJobsRequested = false;

  const progressSection = document.getElementById('jobs-progress');
  const progressLabel = document.getElementById('jobs-progress-label');
  const progressCount = document.getElementById('jobs-progress-count');
  const progressFill = document.getElementById('jobs-progress-fill');
  const getJobsBtn = document.getElementById('get-jobs-btn');

  progressSection.classList.remove('hidden');
  getJobsBtn.disabled = true;

  let allJobs = [];

  // Load existing jobs
  const stored = await chrome.storage.local.get('shoreCapitalJobs');
  if (stored.shoreCapitalJobs) {
    allJobs = stored.shoreCapitalJobs;
  }

  for (let i = 0; i < companiesToProcess.length && !stopJobsRequested; i++) {
    const company = companiesToProcess[i];
    const percent = Math.round(((i + 1) / companiesToProcess.length) * 100);

    progressLabel.textContent = company.title.substring(0, 20) + (company.title.length > 20 ? '...' : '');
    progressCount.textContent = `${i + 1}/${companiesToProcess.length}`;
    progressFill.style.width = `${percent}%`;

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'fetchCompanyJobs',
        url: company.link,
        companyName: company.title
      });

      if (response && response.jobs && response.jobs.length > 0) {
        // Add jobs, avoiding duplicates by checking link
        response.jobs.forEach(job => {
          const exists = allJobs.some(j => j.link === job.link || (j.title === job.title && j.hospitalName === job.hospitalName));
          if (!exists) {
            allJobs.push(job);
          }
        });
      }
    } catch (e) {
      console.error(`Error fetching jobs from ${company.title}:`, e);
    }

    // Delay between requests
    await new Promise(r => setTimeout(r, 500));
  }

  // Save all jobs
  await chrome.storage.local.set({ shoreCapitalJobs: allJobs });

  progressSection.classList.add('hidden');
  getJobsBtn.disabled = false;
  isGettingJobs = false;

  alert(`Done! Fetched jobs from ${companiesToProcess.length} companies.\nTotal jobs saved: ${allJobs.length}\n\nClick "View Scraped Jobs" to see them.`);
}

function exportCSV() {
  const companiesToExport = selectedIndexes.size > 0
    ? Array.from(selectedIndexes).map(i => filteredCompanies[i])
    : allCompanies;

  const headers = ['Company Name', 'Open Jobs', 'Industry', 'Location', 'Employees', 'Link', 'Description'];

  const csvContent = [
    headers.join(','),
    ...companiesToExport.map(company => [
      `"${escapeCSV(company.title)}"`,
      `"${company.numJobs}"`,
      `"${escapeCSV(company.industry)}"`,
      `"${escapeCSV(company.location)}"`,
      `"${escapeCSV(company.jobType)}"`,
      `"${escapeCSV(company.link)}"`,
      `"${escapeCSV(company.description)}"`
    ].join(','))
  ].join('\n');

  downloadFile(csvContent, 'shore-capital-companies.csv', 'text/csv');
}

async function deleteSelected() {
  if (selectedIndexes.size === 0) {
    alert('No companies selected.');
    return;
  }

  if (!confirm(`Are you sure you want to delete ${selectedIndexes.size} selected companies?`)) {
    return;
  }

  const indexesToDelete = new Set(Array.from(selectedIndexes).map(i => allCompanies.indexOf(filteredCompanies[i])));
  allCompanies = allCompanies.filter((_, i) => !indexesToDelete.has(i));

  await chrome.storage.local.set({ shoreCapitalData: allCompanies });

  selectedIndexes.clear();
  filterCompanies();
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
  const url = document.getElementById('webhook-url').value;
  const parentClient = document.getElementById('parent-client').value;

  if (!url) {
    alert('Please enter a webhook URL.');
    return;
  }

  // Get jobs from storage
  const stored = await chrome.storage.local.get('shoreCapitalJobs');
  const allJobs = stored.shoreCapitalJobs || [];

  if (allJobs.length === 0) {
    alert('No jobs to send. Please scrape jobs first using "Get Jobs from Companies".');
    return;
  }

  const payload = {
    data: allJobs.map(job => ({
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
      alert(`Successfully sent ${allJobs.length} jobs to webhook!`);
    } else {
      alert(`Webhook error: ${response.status} ${response.statusText}`);
    }
  } catch (e) {
    alert(`Error sending to webhook: ${e.message}`);
  }
}

function showCompanyDetails(company) {
  document.getElementById('modal-title').textContent = company.title;
  document.getElementById('modal-body').innerHTML = `
    <p><strong>Open Jobs:</strong> ${company.numJobs}</p>
    <p><strong>Industry:</strong> ${escapeHtml(company.industry || 'N/A')}</p>
    <p><strong>Location:</strong> ${escapeHtml(company.location || 'N/A')}</p>
    <p><strong>Employees:</strong> ${escapeHtml(company.jobType || 'N/A')}</p>
    <p><strong>Link:</strong> <a href="${escapeHtml(company.link)}" target="_blank">${escapeHtml(company.link)}</a></p>
    <hr>
    <p><strong>Description:</strong></p>
    <pre>${escapeHtml(company.description || 'No description available.')}</pre>
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
