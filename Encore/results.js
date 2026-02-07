// Encore Vet Job Scraper - Results Page Script

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const jobsTable = document.getElementById('jobs-table');
  const jobsTbody = document.getElementById('jobs-tbody');
  const noData = document.getElementById('no-data');
  const totalCount = document.getElementById('total-count');
  const selectedCount = document.getElementById('selected-count');
  const duplicateCount = document.getElementById('duplicate-count');
  const searchInput = document.getElementById('search-input');
  const filterSelect = document.getElementById('filter-select');
  const selectAllCheckbox = document.getElementById('select-all-checkbox');

  // Buttons
  const selectAllBtn = document.getElementById('select-all-btn');
  const deselectAllBtn = document.getElementById('deselect-all-btn');
  const selectDuplicatesBtn = document.getElementById('select-duplicates-btn');
  const getDescriptionsBtn = document.getElementById('get-descriptions-btn');
  const exportCsvBtn = document.getElementById('export-csv-btn');
  const deleteSelectedBtn = document.getElementById('delete-selected-btn');
  const toggleWebhookBtn = document.getElementById('toggle-webhook');
  const saveWebhookBtn = document.getElementById('save-webhook-btn');
  const sendWebhookBtn = document.getElementById('send-webhook-btn');

  // Webhook
  const webhookConfig = document.getElementById('webhook-config');
  const webhookUrlInput = document.getElementById('webhook-url');
  const parentClientInput = document.getElementById('parent-client');

  // Progress
  const progressBar = document.getElementById('progress-bar');
  const progressLabel = document.getElementById('progress-label');
  const progressDetail = document.getElementById('progress-detail');
  const progressFill = document.getElementById('progress-fill');

  // Modal
  const modal = document.getElementById('modal');
  const modalTitle = document.getElementById('modal-title');
  const modalBody = document.getElementById('modal-body');
  const modalClose = document.getElementById('modal-close');

  let jobs = [];
  let filteredJobs = [];
  let selectedIds = new Set();
  let duplicateIds = new Set();
  let isGettingDescriptions = false;
  let currentJobIndex = 0;

  // Initialize
  init();

  async function init() {
    // Load jobs from storage
    const stored = await chrome.storage.local.get(['encoreJobs', 'encoreWebhook', 'encoreParentClient']);

    if (stored.encoreJobs && stored.encoreJobs.length > 0) {
      jobs = stored.encoreJobs;
      detectDuplicates();
      filterJobs();
      renderTable();
      updateStats();
    } else {
      noData.classList.remove('hidden');
      jobsTable.classList.add('hidden');
    }

    // Load webhook config
    if (stored.encoreWebhook) {
      webhookUrlInput.value = stored.encoreWebhook;
    }
    if (stored.encoreParentClient) {
      parentClientInput.value = stored.encoreParentClient;
    }
  }

  // Detect duplicates based on reqId
  function detectDuplicates() {
    duplicateIds.clear();
    const seenReqIds = new Map();

    jobs.forEach((job, index) => {
      const key = job.reqId || job.link;
      if (seenReqIds.has(key)) {
        duplicateIds.add(index);
        duplicateIds.add(seenReqIds.get(key));
      } else {
        seenReqIds.set(key, index);
      }
    });
  }

  // Filter jobs based on search and filter
  function filterJobs() {
    const searchTerm = searchInput.value.toLowerCase();
    const filterValue = filterSelect.value;

    filteredJobs = jobs.filter((job, index) => {
      // Search filter
      const matchesSearch = !searchTerm ||
        job.title.toLowerCase().includes(searchTerm) ||
        job.reqId.toLowerCase().includes(searchTerm) ||
        job.hospitalName.toLowerCase().includes(searchTerm) ||
        job.city.toLowerCase().includes(searchTerm) ||
        job.state.toLowerCase().includes(searchTerm) ||
        job.category.toLowerCase().includes(searchTerm);

      // Type filter
      let matchesFilter = true;
      if (filterValue === 'duplicates') {
        matchesFilter = duplicateIds.has(index);
      } else if (filterValue === 'unique') {
        matchesFilter = !duplicateIds.has(index);
      } else if (filterValue === 'no-description') {
        matchesFilter = !job.description || job.description.trim() === '';
      }

      return matchesSearch && matchesFilter;
    });
  }

  // Render table
  function renderTable() {
    jobsTbody.innerHTML = '';

    if (filteredJobs.length === 0) {
      noData.classList.remove('hidden');
      jobsTable.classList.add('hidden');
      return;
    }

    noData.classList.add('hidden');
    jobsTable.classList.remove('hidden');

    filteredJobs.forEach((job, filteredIndex) => {
      const originalIndex = jobs.indexOf(job);
      const isDuplicate = duplicateIds.has(originalIndex);
      const isSelected = selectedIds.has(originalIndex);
      const hasDescription = job.description && job.description.trim() !== '';

      const tr = document.createElement('tr');
      tr.className = `${isDuplicate ? 'duplicate' : ''} ${isSelected ? 'selected' : ''}`;
      tr.dataset.index = originalIndex;

      tr.innerHTML = `
        <td class="col-checkbox">
          <input type="checkbox" class="job-checkbox" data-index="${originalIndex}" ${isSelected ? 'checked' : ''}>
        </td>
        <td class="col-status">
          ${isDuplicate ? '<span class="badge badge-duplicate">Duplicate</span>' : '<span class="badge badge-unique">Unique</span>'}
        </td>
        <td class="col-jobid">${escapeHtml(job.jobId || 'N/A')}</td>
        <td class="col-title">
          <a href="${job.link}" target="_blank">${escapeHtml(job.title)}</a>
        </td>
        <td class="col-reqid">${escapeHtml(job.reqId)}</td>
        <td class="col-hospital">${escapeHtml(job.hospitalName)}</td>
        <td class="col-location">${escapeHtml(job.city)}${job.state ? ', ' + escapeHtml(job.state) : ''}</td>
        <td class="col-category">${escapeHtml(job.category)}</td>
        <td class="col-description">
          ${hasDescription
            ? `<span class="description-preview" title="${escapeHtml(job.description.substring(0, 200))}">${escapeHtml(job.description.substring(0, 50))}...</span>`
            : '<span class="badge badge-missing">Missing</span>'
          }
        </td>
        <td class="col-actions">
          <div class="table-actions">
            <button class="btn btn-sm view-btn" data-index="${originalIndex}">View</button>
          </div>
        </td>
      `;

      jobsTbody.appendChild(tr);
    });

    // Add event listeners to checkboxes
    document.querySelectorAll('.job-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const index = parseInt(e.target.dataset.index);
        if (e.target.checked) {
          selectedIds.add(index);
        } else {
          selectedIds.delete(index);
        }
        updateStats();
        renderTable();
      });
    });

    // Add event listeners to view buttons
    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.target.dataset.index);
        showJobDetails(jobs[index]);
      });
    });
  }

  // Update stats
  function updateStats() {
    totalCount.textContent = `Total: ${jobs.length}`;
    selectedCount.textContent = `Selected: ${selectedIds.size}`;
    duplicateCount.textContent = `Duplicates: ${duplicateIds.size}`;
  }

  // Show job details in modal
  function showJobDetails(job) {
    modalTitle.textContent = job.title;
    modalBody.innerHTML = `
      <div class="detail-row">
        <span class="detail-label">Job ID:</span>
        <span class="detail-value">${escapeHtml(job.jobId || 'N/A')}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Req ID:</span>
        <span class="detail-value">${escapeHtml(job.reqId)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Hospital:</span>
        <span class="detail-value">${escapeHtml(job.hospitalName)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Address:</span>
        <span class="detail-value">${escapeHtml(job.streetAddress)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">City:</span>
        <span class="detail-value">${escapeHtml(job.city)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">State:</span>
        <span class="detail-value">${escapeHtml(job.state)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Postal Code:</span>
        <span class="detail-value">${escapeHtml(job.postalCode || 'N/A')}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Category:</span>
        <span class="detail-value">${escapeHtml(job.category)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Job Type:</span>
        <span class="detail-value">${escapeHtml(job.jobType || 'N/A')}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Link:</span>
        <span class="detail-value"><a href="${job.link}" target="_blank">${escapeHtml(job.link)}</a></span>
      </div>
      <h4 style="margin-top: 20px; margin-bottom: 10px;">Description</h4>
      <div class="description-full">${job.description ? escapeHtml(job.description) : 'No description available'}</div>
    `;
    modal.classList.remove('hidden');
  }

  // Close modal
  modalClose.addEventListener('click', () => {
    modal.classList.add('hidden');
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.add('hidden');
    }
  });

  // Search and filter
  searchInput.addEventListener('input', () => {
    filterJobs();
    renderTable();
  });

  filterSelect.addEventListener('change', () => {
    filterJobs();
    renderTable();
  });

  // Select all checkbox
  selectAllCheckbox.addEventListener('change', (e) => {
    if (e.target.checked) {
      filteredJobs.forEach(job => {
        selectedIds.add(jobs.indexOf(job));
      });
    } else {
      filteredJobs.forEach(job => {
        selectedIds.delete(jobs.indexOf(job));
      });
    }
    updateStats();
    renderTable();
  });

  // Select all button
  selectAllBtn.addEventListener('click', () => {
    jobs.forEach((_, index) => selectedIds.add(index));
    updateStats();
    renderTable();
  });

  // Deselect all button
  deselectAllBtn.addEventListener('click', () => {
    selectedIds.clear();
    updateStats();
    renderTable();
  });

  // Select duplicates button
  selectDuplicatesBtn.addEventListener('click', () => {
    duplicateIds.forEach(id => selectedIds.add(id));
    updateStats();
    renderTable();
  });

  // Delete selected button
  deleteSelectedBtn.addEventListener('click', async () => {
    if (selectedIds.size === 0) {
      alert('No jobs selected');
      return;
    }

    if (!confirm(`Are you sure you want to delete ${selectedIds.size} selected job(s)?`)) {
      return;
    }

    jobs = jobs.filter((_, index) => !selectedIds.has(index));
    selectedIds.clear();
    await chrome.storage.local.set({ encoreJobs: jobs });
    detectDuplicates();
    filterJobs();
    renderTable();
    updateStats();
  });

  // Listen for description saved messages from background script
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'descriptionSaved') {
      console.log(`Description saved for job ${request.jobIndex + 1}, success: ${request.success}`);

      // Refresh jobs from storage
      chrome.storage.local.get(['encoreJobs'], (result) => {
        jobs = result.encoreJobs || [];
        detectDuplicates();
        filterJobs();
        renderTable();
        updateStats();

        // Update progress
        const total = jobs.length;
        const withDesc = jobs.filter(job => job.description && job.description.trim() !== '').length;
        const percent = Math.round((withDesc / total) * 100);
        progressFill.style.width = `${percent}%`;
        progressLabel.textContent = 'Fetching descriptions...';
        progressDetail.textContent = `${withDesc} / ${total}`;

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
    chrome.storage.local.get(['encoreJobs'], (result) => {
      jobs = result.encoreJobs || [];

      // Find next job without description
      let foundJob = false;
      for (let i = 0; i < jobs.length; i++) {
        if (!jobs[i].description || jobs[i].description.trim() === '') {
          currentJobIndex = i;
          foundJob = true;
          break;
        }
      }

      if (!foundJob) {
        isGettingDescriptions = false;
        getDescriptionsBtn.textContent = 'Get Descriptions';
        getDescriptionsBtn.disabled = false;
        progressBar.classList.add('hidden');
        alert('All jobs have descriptions now!');
        return;
      }

      const job = jobs[currentJobIndex];
      console.log(`Processing job ${currentJobIndex + 1} of ${jobs.length}: ${job.title}`);

      // Update progress
      const withDesc = jobs.filter(j => j.description && j.description.trim() !== '').length;
      const percent = Math.round((withDesc / jobs.length) * 100);
      progressFill.style.width = `${percent}%`;
      progressLabel.textContent = 'Fetching descriptions...';
      progressDetail.textContent = `${withDesc} / ${jobs.length}`;

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

  // Get descriptions button
  getDescriptionsBtn.addEventListener('click', () => {
    if (jobs.length === 0) {
      alert('No jobs to get descriptions for.');
      return;
    }

    const jobsWithoutDesc = jobs.filter(job => !job.description || job.description.trim() === '');
    if (jobsWithoutDesc.length === 0) {
      alert('All jobs already have descriptions!');
      return;
    }

    if (confirm(`This will fetch descriptions for ${jobsWithoutDesc.length} jobs. Continue?`)) {
      isGettingDescriptions = true;
      getDescriptionsBtn.disabled = true;
      getDescriptionsBtn.textContent = 'Processing...';

      // Show progress
      progressBar.classList.remove('hidden');
      const withDesc = jobs.filter(j => j.description && j.description.trim() !== '').length;
      const percent = Math.round((withDesc / jobs.length) * 100);
      progressFill.style.width = `${percent}%`;
      progressLabel.textContent = 'Fetching descriptions...';
      progressDetail.textContent = `${withDesc} / ${jobs.length}`;

      processNextJob();
    }
  });

  // Export CSV button
  exportCsvBtn.addEventListener('click', () => {
    const jobsToExport = selectedIds.size > 0
      ? jobs.filter((_, index) => selectedIds.has(index))
      : jobs;

    if (jobsToExport.length === 0) {
      alert('No jobs to export');
      return;
    }

    const headers = ['Title', 'Job ID', 'Req ID', 'Hospital Name', 'Street Address', 'City', 'State', 'Postal Code', 'Country', 'Category', 'Job Type', 'Link', 'Description'];
    const rows = jobsToExport.map(job => [
      job.title,
      job.jobId || '',
      job.reqId,
      job.hospitalName,
      job.streetAddress,
      job.city,
      job.state,
      job.postalCode || '',
      job.country,
      job.category,
      job.jobType || '',
      job.link,
      (job.description || '').replace(/[\r\n]+/g, ' ')
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${(cell || '').replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `encore-vet-jobs-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  });

  // Toggle webhook config
  toggleWebhookBtn.addEventListener('click', () => {
    webhookConfig.classList.toggle('hidden');
  });

  // Save webhook config
  saveWebhookBtn.addEventListener('click', async () => {
    await chrome.storage.local.set({
      encoreWebhook: webhookUrlInput.value,
      encoreParentClient: parentClientInput.value
    });
    alert('Webhook configuration saved');
  });

  // Send to webhook in batches of 50
  sendWebhookBtn.addEventListener('click', async () => {
    const webhookUrl = webhookUrlInput.value;
    const parentClient = parentClientInput.value;

    if (!webhookUrl) {
      alert('Please enter a webhook URL');
      return;
    }

    const jobsToSend = selectedIds.size > 0
      ? jobs.filter((_, index) => selectedIds.has(index))
      : jobs;

    if (jobsToSend.length === 0) {
      alert('No jobs to send');
      return;
    }

    const BATCH_SIZE = 50;
    const totalBatches = Math.ceil(jobsToSend.length / BATCH_SIZE);

    if (!confirm(`Send ${jobsToSend.length} job(s) in ${totalBatches} batch(es) to webhook?`)) {
      return;
    }

    progressBar.classList.remove('hidden');
    sendWebhookBtn.disabled = true;

    // Map job records to webhook format
    const mappedJobs = jobsToSend.map(job => ({
      parent_client: parentClient,
      job_id: job.jobId || '',
      job_title: job.title || '',
      job_type: job.jobType || '',
      hospital: job.hospitalName || '',
      address: job.streetAddress || '',
      city: job.city || '',
      state: job.state || '',
      zip_code: job.postalCode || '',
      country: job.country || 'USA',
      category: job.category || '',
      req_id: job.reqId || '',
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

      progressLabel.textContent = 'Sending to webhook...';
      progressDetail.textContent = `Batch ${batchNumber} / ${totalBatches}`;
      progressFill.style.width = `${Math.round((batchNumber / totalBatches) * 100)}%`;

      const payload = {
        source: 'Encore Vet Job Scraper',
        parentClientName: parentClient,
        syncId: syncId,
        timestamp: new Date().toISOString(),
        batchNumber: batchNumber,
        totalBatches: totalBatches,
        batchSize: batch.length,
        totalRecords: jobsToSend.length,
        data: batch
      };

      console.log(`Sending batch ${batchNumber}/${totalBatches}:`, payload);

      try {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          successCount++;
          console.log(`Successfully sent batch ${batchNumber}/${totalBatches}`);
        } else {
          errorCount++;
          console.error(`Failed to send batch ${batchNumber}:`, await response.text());
        }
      } catch (error) {
        errorCount++;
        console.error(`Error sending batch ${batchNumber}:`, error);
      }

      // Small delay between batches
      if (batchIndex < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    progressBar.classList.add('hidden');
    sendWebhookBtn.disabled = false;

    let resultMsg = `Webhook Complete!\n`;
    resultMsg += `Sync ID: ${syncId}\n`;
    resultMsg += `Total Records: ${jobsToSend.length}\n`;
    resultMsg += `Batches Sent: ${totalBatches} (${BATCH_SIZE} per batch)\n`;
    resultMsg += `Successful: ${successCount} | Failed: ${errorCount}`;
    alert(resultMsg);
  });

  // Escape HTML
  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
});
