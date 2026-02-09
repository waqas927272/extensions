// VCA Job Scraper - Results Page Script

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
  let currentDescIndex = 0;
  let descJobIndices = [];

  // Initialize
  init();

  async function init() {
    // Load jobs from storage
    const stored = await chrome.storage.local.get(['vcaJobs', 'vcaWebhook', 'vcaParentClient']);

    if (stored.vcaJobs && stored.vcaJobs.length > 0) {
      jobs = stored.vcaJobs;
      detectDuplicates();
      filterJobs();
      renderTable();
      updateStats();
    } else {
      noData.classList.remove('hidden');
      jobsTable.classList.add('hidden');
    }

    // Load webhook config
    if (stored.vcaWebhook) {
      webhookUrlInput.value = stored.vcaWebhook;
    }
    if (stored.vcaParentClient) {
      parentClientInput.value = stored.vcaParentClient;
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
        (job.title || '').toLowerCase().includes(searchTerm) ||
        (job.reqId || '').toLowerCase().includes(searchTerm) ||
        (job.city || '').toLowerCase().includes(searchTerm) ||
        (job.state || '').toLowerCase().includes(searchTerm) ||
        (job.category || '').toLowerCase().includes(searchTerm);

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
        <td class="col-title">
          <a href="${job.link}" target="_blank">${escapeHtml(job.title)}</a>
        </td>
        <td class="col-reqid">${escapeHtml(job.reqId)}</td>
        <td class="col-hospital">${escapeHtml(job.hospitalName || '')}</td>
        <td class="col-location">${escapeHtml(job.city)}${job.state ? ', ' + escapeHtml(job.state) : ''}</td>
        <td class="col-category">${escapeHtml(job.category)}</td>
        <td class="col-type">${escapeHtml(job.jobType || '')}</td>
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
        <span class="detail-label">Req ID:</span>
        <span class="detail-value">${escapeHtml(job.reqId)}</span>
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
        <span class="detail-label">Country:</span>
        <span class="detail-value">${escapeHtml(job.country)}</span>
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
    await chrome.storage.local.set({ vcaJobs: jobs });
    detectDuplicates();
    filterJobs();
    renderTable();
    updateStats();
  });

  // Get descriptions button (tab-based approach)
  getDescriptionsBtn.addEventListener('click', async () => {
    if (isGettingDescriptions) return;

    descJobIndices = [];

    if (selectedIds.size > 0) {
      descJobIndices = Array.from(selectedIds);
    } else {
      jobs.forEach((job, index) => {
        if (!job.description || job.description.trim() === '') {
          descJobIndices.push(index);
        }
      });
    }

    if (descJobIndices.length === 0) {
      alert('No jobs need descriptions');
      return;
    }

    isGettingDescriptions = true;
    currentDescIndex = 0;
    getDescriptionsBtn.disabled = true;
    progressBar.classList.remove('hidden');

    processNextJob();
  });

  // Process next job for description fetching
  function processNextJob() {
    if (currentDescIndex >= descJobIndices.length) {
      isGettingDescriptions = false;
      getDescriptionsBtn.disabled = false;
      progressBar.classList.add('hidden');
      progressFill.style.width = '0%';
      return;
    }

    const jobIdx = descJobIndices[currentDescIndex];
    const job = jobs[jobIdx];

    const percent = Math.round(((currentDescIndex + 1) / descJobIndices.length) * 100);
    progressLabel.textContent = 'Fetching descriptions...';
    progressDetail.textContent = `${currentDescIndex + 1}/${descJobIndices.length}`;
    progressFill.style.width = `${percent}%`;

    chrome.tabs.create({ url: job.link, active: false }).then(tab => {
      chrome.runtime.sendMessage({
        action: 'scrapeJobDescription',
        tabId: tab.id,
        jobIndex: jobIdx,
        jobLink: job.link
      });
    }).catch(err => {
      console.error('Error creating tab:', err);
      currentDescIndex++;
      setTimeout(processNextJob, 500);
    });
  }

  // Listen for description saved messages
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'descriptionSaved' && isGettingDescriptions) {
      chrome.storage.local.get(['vcaJobs'], (result) => {
        if (result.vcaJobs) {
          jobs = result.vcaJobs;
          filterJobs();
          renderTable();
          updateStats();
        }
      });

      currentDescIndex++;
      setTimeout(processNextJob, 1500);
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

    const headers = ['Title', 'Req ID', 'Hospital Name', 'City', 'State', 'Country', 'Category', 'Job Type', 'Link', 'Description'];
    const rows = jobsToExport.map(job => [
      job.title,
      job.reqId,
      job.hospitalName || '',
      job.city,
      job.state,
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
    link.download = `vca-jobs-${new Date().toISOString().split('T')[0]}.csv`;
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
      vcaWebhook: webhookUrlInput.value,
      vcaParentClient: parentClientInput.value
    });
    alert('Webhook configuration saved');
  });

  // Send to webhook
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

    progressBar.classList.remove('hidden');
    sendWebhookBtn.disabled = true;

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < jobsToSend.length; i++) {
      const job = jobsToSend[i];

      progressLabel.textContent = 'Sending to webhook...';
      progressDetail.textContent = `${i + 1}/${jobsToSend.length}`;
      progressFill.style.width = `${Math.round(((i + 1) / jobsToSend.length) * 100)}%`;

      try {
        const payload = {
          parent_client: parentClient,
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
        };

        console.log('Sending payload:', payload);

        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          successCount++;
          console.log(`Successfully sent job: ${job.title}`);
        } else {
          errorCount++;
          console.error(`Failed to send job ${job.reqId}:`, await response.text());
        }
      } catch (error) {
        errorCount++;
        console.error(`Error sending job ${job.reqId}:`, error);
      }

      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    progressBar.classList.add('hidden');
    sendWebhookBtn.disabled = false;

    alert(`Webhook complete!\nSuccess: ${successCount}\nFailed: ${errorCount}`);
  });

  // Escape HTML
  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
});
