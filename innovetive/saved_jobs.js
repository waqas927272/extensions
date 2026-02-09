let allJobs = [];
let filteredJobs = [];
let currentSort = { field: null, direction: 'asc' };
let isGettingDescriptions = false;
let currentJobIndex = 0;

document.addEventListener('DOMContentLoaded', () => {
  loadJobs();

  // Action buttons
  document.getElementById('export-csv-btn').addEventListener('click', exportCSV);
  document.getElementById('clear-all-btn').addEventListener('click', clearAllData);
  document.getElementById('save-webhook-btn').addEventListener('click', saveWebhookConfig);
  document.getElementById('send-webhook-btn').addEventListener('click', sendToWebhook);
  document.getElementById('get-descriptions-btn').addEventListener('click', startGetDescriptions);

  // Webhook toggle
  document.getElementById('toggle-webhook').addEventListener('click', toggleWebhook);

  // Search and filters
  document.getElementById('search-input').addEventListener('input', applyFilters);
  document.getElementById('state-filter').addEventListener('change', applyFilters);
  document.getElementById('type-filter').addEventListener('change', applyFilters);

  // Sorting
  document.querySelectorAll('.sortable').forEach(th => {
    th.addEventListener('click', () => handleSort(th.dataset.sort));
  });

  // Load saved webhook config
  loadWebhookConfig();
});

function loadJobs() {
  chrome.storage.local.get('jobs', (data) => {
    if (!data.jobs || data.jobs.length === 0) {
      showEmptyState();
      return;
    }

    allJobs = data.jobs;
    filteredJobs = [...allJobs];

    updateStats();
    populateFilters();
    displayJobs(filteredJobs);
  });
}

function showEmptyState() {
  document.getElementById('table-wrapper').classList.add('hidden');
  document.getElementById('no-data').classList.remove('hidden');
  document.getElementById('no-results').classList.add('hidden');
}

function updateStats() {
  document.getElementById('total-count').textContent = allJobs.length;
  const uniqueLocations = new Set(allJobs.map(j => j.location).filter(Boolean)).size;
  document.getElementById('locations-count').textContent = uniqueLocations;
}

function populateFilters() {
  // State filter - extract state from location (e.g., "City, ST" -> "ST")
  const stateFilter = document.getElementById('state-filter');
  const states = [...new Set(allJobs.map(job => {
    const loc = job.location || '';
    const parts = loc.split(',');
    if (parts.length >= 2) {
      const stateStr = parts[parts.length - 1].trim().split(' ')[0];
      if (stateStr.length === 2) return stateStr.toUpperCase();
    }
    return '';
  }).filter(Boolean))].sort();

  stateFilter.innerHTML = '<option value="all">All States</option>';
  states.forEach(state => {
    const opt = document.createElement('option');
    opt.value = state;
    opt.textContent = state;
    stateFilter.appendChild(opt);
  });

  // Job type filter
  const typeFilter = document.getElementById('type-filter');
  const types = [...new Set(allJobs.map(j => j.jobType).filter(Boolean))].sort();

  typeFilter.innerHTML = '<option value="all">All Job Types</option>';
  types.forEach(type => {
    const opt = document.createElement('option');
    opt.value = type;
    opt.textContent = type;
    typeFilter.appendChild(opt);
  });
}

function applyFilters() {
  const searchTerm = document.getElementById('search-input').value.toLowerCase().trim();
  const stateVal = document.getElementById('state-filter').value;
  const typeVal = document.getElementById('type-filter').value;

  filteredJobs = allJobs.filter(job => {
    // Search
    const matchesSearch = !searchTerm ||
      (job.jobTitle || '').toLowerCase().includes(searchTerm) ||
      (job.hospitalName || '').toLowerCase().includes(searchTerm) ||
      (job.location || '').toLowerCase().includes(searchTerm) ||
      (job.areaOfPractice || '').toLowerCase().includes(searchTerm) ||
      (job.jobType || '').toLowerCase().includes(searchTerm) ||
      (job.jobId || '').toLowerCase().includes(searchTerm);

    // State filter
    let matchesState = true;
    if (stateVal !== 'all') {
      const loc = job.location || '';
      const parts = loc.split(',');
      if (parts.length >= 2) {
        const stateStr = parts[parts.length - 1].trim().split(' ')[0].toUpperCase();
        matchesState = stateStr === stateVal;
      } else {
        matchesState = false;
      }
    }

    // Job type filter
    const matchesType = typeVal === 'all' || job.jobType === typeVal;

    return matchesSearch && matchesState && matchesType;
  });

  // Re-apply sort
  if (currentSort.field) {
    sortJobs(currentSort.field, currentSort.direction);
  }

  displayJobs(filteredJobs);
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

function displayJobs(jobs) {
  const tbody = document.getElementById('jobs-tbody');
  const tableWrapper = document.getElementById('table-wrapper');
  const noResults = document.getElementById('no-results');
  const noData = document.getElementById('no-data');

  tbody.innerHTML = '';
  noData.classList.add('hidden');

  if (jobs.length === 0) {
    tableWrapper.classList.add('hidden');
    noResults.classList.remove('hidden');
    return;
  }

  tableWrapper.classList.remove('hidden');
  noResults.classList.add('hidden');

  jobs.forEach((job, i) => {
    const row = document.createElement('tr');

    const linkHtml = job.link
      ? `<a href="${escapeHtml(job.link)}" target="_blank" class="job-link-btn">View</a>`
      : '<span style="color:#a0aec0;">N/A</span>';

    const hasDescription = job.description && job.description.trim() !== '';
    const descHtml = hasDescription
      ? `<div class="description-cell">${escapeHtml(job.description)}</div>`
      : '<span style="color:#ed8936; font-weight:600;">Pending</span>';

    row.innerHTML = `
      <td style="text-align:center; font-weight:600; color:#a0aec0;">${i + 1}</td>
      <td><strong>${escapeHtml(job.jobTitle || '')}</strong></td>
      <td class="col-jobid">${escapeHtml(job.jobId || 'N/A')}</td>
      <td>${escapeHtml(job.hospitalName || '')}</td>
      <td>${escapeHtml(job.location || '')}</td>
      <td>${escapeHtml(job.areaOfPractice || '')}</td>
      <td>${escapeHtml(job.jobType || '')}</td>
      <td style="text-align:center;">${descHtml}</td>
      <td style="text-align:center;">${linkHtml}</td>
    `;
    tbody.appendChild(row);
  });
}

function exportCSV() {
  const jobs = filteredJobs.length > 0 ? filteredJobs : allJobs;

  if (jobs.length === 0) {
    alert('No data to export.');
    return;
  }

  let csv = 'Job Title,Job ID,Hospital,Location,Area of Practice,Job Type,Link,Description\n';
  jobs.forEach(job => {
    csv += `"${(job.jobTitle || '').replace(/"/g, '""')}",`;
    csv += `"${(job.jobId || '').replace(/"/g, '""')}",`;
    csv += `"${(job.hospitalName || '').replace(/"/g, '""')}",`;
    csv += `"${(job.location || '').replace(/"/g, '""')}",`;
    csv += `"${(job.areaOfPractice || '').replace(/"/g, '""')}",`;
    csv += `"${(job.jobType || '').replace(/"/g, '""')}",`;
    csv += `"${(job.link || '').replace(/"/g, '""')}",`;
    csv += `"${((job.description || '').replace(/[\r\n]+/g, ' ')).replace(/"/g, '""')}"\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'innovetive-petcare-jobs.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function clearAllData() {
  if (!confirm('Are you sure you want to clear all saved jobs? This cannot be undone.')) return;

  chrome.storage.local.remove('jobs', () => {
    allJobs = [];
    filteredJobs = [];
    updateStats();
    showEmptyState();
  });
}

// Webhook
function toggleWebhook() {
  const section = document.querySelector('.webhook-section');
  const config = document.getElementById('webhook-config');
  section.classList.toggle('expanded');
  config.classList.toggle('hidden');
}

function loadWebhookConfig() {
  chrome.storage.local.get(['webhookUrl', 'parentClient'], (data) => {
    if (data.webhookUrl) {
      document.getElementById('webhook-url').value = data.webhookUrl;
    }
    if (data.parentClient) {
      document.getElementById('parent-client').value = data.parentClient;
    }
  });
}

function saveWebhookConfig() {
  const url = document.getElementById('webhook-url').value;
  const client = document.getElementById('parent-client').value;
  const status = document.getElementById('webhook-status');

  chrome.storage.local.set({ webhookUrl: url, parentClient: client }, () => {
    status.textContent = 'Configuration saved!';
    status.className = 'webhook-status success';
    setTimeout(() => { status.textContent = ''; }, 3000);
  });
}

async function sendToWebhook() {
  const webhookUrl = document.getElementById('webhook-url').value;
  const parentClient = document.getElementById('parent-client').value;
  const statusEl = document.getElementById('webhook-status');
  const sendBtn = document.getElementById('send-webhook-btn');
  const progressSection = document.getElementById('progress-section');
  const progressBar = document.getElementById('progress-bar');
  const progressText = document.getElementById('progress-text');

  if (!webhookUrl || !isValidUrl(webhookUrl)) {
    statusEl.textContent = 'Please enter a valid webhook URL.';
    statusEl.className = 'webhook-status error';
    return;
  }

  const jobs = filteredJobs.length > 0 ? filteredJobs : allJobs;
  if (jobs.length === 0) {
    statusEl.textContent = 'No job data to send.';
    statusEl.className = 'webhook-status error';
    return;
  }

  const BATCH_SIZE = 50;
  const totalBatches = Math.ceil(jobs.length / BATCH_SIZE);

  if (!confirm(`Send ${jobs.length} job(s) in ${totalBatches} batch(es) to webhook?`)) {
    return;
  }

  sendBtn.disabled = true;
  sendBtn.textContent = 'Sending...';
  statusEl.textContent = '';
  statusEl.className = 'webhook-status';

  // Show progress
  progressSection.classList.remove('hidden');
  progressBar.style.width = '0%';
  progressText.textContent = `0 / ${totalBatches} batches`;

  // Map job records to webhook format
  const mappedJobs = jobs.map(job => ({
    parent_client: parentClient,
    job_title: job.jobTitle || '',
    job_id: job.jobId || '',
    hospital: job.hospitalName || '',
    location: job.location || '',
    area_of_practice: job.areaOfPractice || '',
    job_type: job.jobType || '',
    link: job.link || '',
    description: job.description || ''
  }));

  // Split into batches
  const batches = [];
  for (let i = 0; i < mappedJobs.length; i += BATCH_SIZE) {
    batches.push(mappedJobs.slice(i, i + BATCH_SIZE));
  }

  // Generate a unique sync ID for this entire send operation
  const syncId = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);

  let successCount = 0;
  let errorCount = 0;

  // Send each batch
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    const batchNumber = batchIndex + 1;

    const percent = Math.round((batchNumber / totalBatches) * 100);
    progressBar.style.width = `${percent}%`;
    progressText.textContent = `Batch ${batchNumber} / ${totalBatches}`;

    const payload = {
      source: 'Innovetive Petcare Job Scraper',
      parentClientName: parentClient,
      syncId: syncId,
      timestamp: new Date().toISOString(),
      batchNumber: batchNumber,
      totalBatches: totalBatches,
      batchSize: batch.length,
      totalRecords: jobs.length,
      data: batch
    };

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        successCount++;
      } else {
        errorCount++;
        console.error(`Failed to send batch ${batchNumber}:`, await response.text());
      }
    } catch (err) {
      errorCount++;
      console.error(`Error sending batch ${batchNumber}:`, err);
    }

    // Small delay between batches
    if (batchIndex < batches.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  progressSection.classList.add('hidden');
  sendBtn.disabled = false;
  sendBtn.textContent = 'Send';

  let resultMsg = `Webhook Complete!\nSync ID: ${syncId}\nTotal Records: ${jobs.length}\nBatches Sent: ${totalBatches} (${BATCH_SIZE} per batch)\nSuccessful: ${successCount} | Failed: ${errorCount}`;

  if (errorCount === 0) {
    statusEl.textContent = `Success! ${jobs.length} jobs sent in ${totalBatches} batch(es).`;
    statusEl.className = 'webhook-status success';
  } else {
    statusEl.textContent = `Partial: ${successCount} succeeded, ${errorCount} failed.`;
    statusEl.className = 'webhook-status error';
  }

  alert(resultMsg);
}

function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// ==================== GET DESCRIPTIONS ====================

// Listen for description saved messages from background script
chrome.runtime.onMessage.addListener((request) => {
  if (request.action === 'descriptionSaved') {
    console.log(`Description saved for job ${request.jobIndex + 1}, success: ${request.success}`);

    // Refresh jobs from storage
    chrome.storage.local.get(['jobs'], (result) => {
      allJobs = result.jobs || [];
      filteredJobs = [...allJobs];
      applyFilters();
      updateStats();

      // Update progress
      const total = allJobs.length;
      const withDesc = allJobs.filter(job => job.description && job.description.trim() !== '').length;
      const percent = Math.round((withDesc / total) * 100);
      const progressBar = document.getElementById('progress-bar');
      const progressText = document.getElementById('progress-text');
      progressBar.style.width = `${percent}%`;
      progressText.textContent = `${withDesc} / ${total}`;

      if (isGettingDescriptions) {
        setTimeout(() => {
          processNextJob();
        }, 1500);
      }
    });
  }
});

function processNextJob() {
  // Refresh from storage first
  chrome.storage.local.get(['jobs'], (result) => {
    allJobs = result.jobs || [];

    // Find next job without description
    let foundJob = false;
    for (let i = 0; i < allJobs.length; i++) {
      if (!allJobs[i].description || allJobs[i].description.trim() === '') {
        currentJobIndex = i;
        foundJob = true;
        break;
      }
    }

    if (!foundJob) {
      isGettingDescriptions = false;
      const btn = document.getElementById('get-descriptions-btn');
      btn.textContent = 'Get Descriptions';
      btn.disabled = false;
      document.getElementById('progress-section').classList.add('hidden');
      alert('All jobs have descriptions now!');
      return;
    }

    const job = allJobs[currentJobIndex];
    console.log(`Processing job ${currentJobIndex + 1} of ${allJobs.length}: ${job.jobTitle}`);

    // Update progress
    const withDesc = allJobs.filter(j => j.description && j.description.trim() !== '').length;
    const percent = Math.round((withDesc / allJobs.length) * 100);
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');
    progressBar.style.width = `${percent}%`;
    progressText.textContent = `${withDesc} / ${allJobs.length}`;

    // Open tab and send message to background to scrape
    chrome.tabs.create({ url: job.link, active: false }, (tab) => {
      chrome.runtime.sendMessage({
        action: 'scrapeJobDescription',
        tabId: tab.id,
        jobIndex: currentJobIndex,
        jobLink: job.link
      });
    });
  });
}

function startGetDescriptions() {
  if (allJobs.length === 0) {
    alert('No jobs to get descriptions for.');
    return;
  }

  const jobsWithoutDesc = allJobs.filter(job => !job.description || job.description.trim() === '');
  if (jobsWithoutDesc.length === 0) {
    alert('All jobs already have descriptions!');
    return;
  }

  if (confirm(`This will fetch descriptions for ${jobsWithoutDesc.length} jobs. Continue?`)) {
    isGettingDescriptions = true;
    const btn = document.getElementById('get-descriptions-btn');
    btn.disabled = true;
    btn.textContent = 'Processing...';

    // Show progress
    const progressSection = document.getElementById('progress-section');
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');
    progressSection.classList.remove('hidden');
    const withDesc = allJobs.filter(j => j.description && j.description.trim() !== '').length;
    const percent = Math.round((withDesc / allJobs.length) * 100);
    progressBar.style.width = `${percent}%`;
    progressText.textContent = `${withDesc} / ${allJobs.length}`;

    processNextJob();
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}
