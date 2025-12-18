document.addEventListener('DOMContentLoaded', () => {
  const jobRecordsTableBody = document.querySelector('#jobRecordsTable tbody');
  const clearRecordsBtn = document.getElementById('clearRecords');
  const downloadCsvBtn = document.getElementById('downloadCsv');
  const getDescriptionsBtn = document.getElementById('getDescriptions');
  const sendToWebhooksBtn = document.getElementById('sendToWebhooks');
  const searchInput = document.getElementById('searchInput');

  // Stats elements
  const totalRecordsEl = document.getElementById('totalRecords');
  const withDescriptionsEl = document.getElementById('withDescriptions');
  const pendingDescriptionsEl = document.getElementById('pendingDescriptions');

  // Progress elements
  const progressSection = document.getElementById('progressSection');
  const progressBar = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');

  // Modal elements
  const descriptionModal = document.getElementById('descriptionModal');
  const modalTitle = document.getElementById('modalTitle');
  const modalBody = document.getElementById('modalBody');
  const closeModal = document.getElementById('closeModal');

  // Webhook elements
  const webhookModal = document.getElementById('webhookModal');
  const webhookModalTitle = document.getElementById('webhookModalTitle');
  const webhookForm = document.getElementById('webhookForm');
  const webhookNameInput = document.getElementById('webhookName');
  const webhookUrlInput = document.getElementById('webhookUrl');
  const webhookEnabledInput = document.getElementById('webhookEnabled');
  const webhookIdInput = document.getElementById('webhookId');
  const closeWebhookModal = document.getElementById('closeWebhookModal');
  const cancelWebhook = document.getElementById('cancelWebhook');
  const addWebhookBtn = document.getElementById('addWebhook');
  const webhooksList = document.getElementById('webhooksList');

  let storedJobs = [];
  let webhooks = [];
  let currentJobIndex = 0;
  let isGettingDescriptions = false;

  function updateStats() {
    const total = storedJobs.length;
    const withDesc = storedJobs.filter(job => job.description).length;
    const pending = total - withDesc;

    totalRecordsEl.textContent = total;
    withDescriptionsEl.textContent = withDesc;
    pendingDescriptionsEl.textContent = pending;
  }

  function displayRecords(filter = '') {
    chrome.storage.local.get(['jobs'], (result) => {
      storedJobs = result.jobs || [];
      jobRecordsTableBody.innerHTML = '';

      updateStats();

      if (storedJobs.length === 0) {
        jobRecordsTableBody.innerHTML = `
          <tr>
            <td colspan="7" class="no-records">
              <svg class="no-records-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
              </svg>
              <p class="no-records-text">No records scraped yet. Start scraping from the extension popup.</p>
            </td>
          </tr>
        `;
        downloadCsvBtn.disabled = true;
        getDescriptionsBtn.disabled = true;
        return;
      }

      downloadCsvBtn.disabled = false;
      getDescriptionsBtn.disabled = false;

      const filteredJobs = filter
        ? storedJobs.filter(job =>
            job.title.toLowerCase().includes(filter.toLowerCase()) ||
            job.hospitalName.toLowerCase().includes(filter.toLowerCase()) ||
            (job.city && job.city.toLowerCase().includes(filter.toLowerCase())) ||
            job.state.toLowerCase().includes(filter.toLowerCase())
          )
        : storedJobs;

      if (filteredJobs.length === 0) {
        jobRecordsTableBody.innerHTML = `
          <tr>
            <td colspan="7" class="no-records">
              <svg class="no-records-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <p class="no-records-text">No jobs match your search.</p>
            </td>
          </tr>
        `;
        return;
      }

      filteredJobs.forEach((job, index) => {
        const row = document.createElement('tr');
        const actualIndex = storedJobs.indexOf(job);

        const hasDescription = job.description && job.description.length > 0;
        const descriptionHtml = hasDescription
          ? `<div class="description-preview">
               <span class="status-badge status-done">Done</span>
               <button class="view-desc-btn" data-index="${actualIndex}">View</button>
             </div>`
          : `<span class="status-badge status-pending">Pending</span>`;

        row.innerHTML = `
          <td>${index + 1}</td>
          <td class="job-title">${escapeHtml(job.title)}</td>
          <td class="hospital-name">${escapeHtml(job.hospitalName)}</td>
          <td class="city-cell">${escapeHtml(job.city || 'N/A')}</td>
          <td class="state-cell">${escapeHtml(job.state || 'N/A')}</td>
          <td class="description-cell">${descriptionHtml}</td>
          <td>
            <a href="${job.link}" target="_blank" class="link-btn">
              Open →
            </a>
          </td>
        `;
        jobRecordsTableBody.appendChild(row);
      });

      // Add click handlers for view description buttons
      document.querySelectorAll('.view-desc-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const index = parseInt(e.target.dataset.index);
          showDescriptionModal(index);
        });
      });
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function showDescriptionModal(index) {
    const job = storedJobs[index];
    if (job && job.description) {
      modalTitle.textContent = job.title;
      modalBody.textContent = job.description;
      descriptionModal.classList.remove('hidden');
    }
  }

  function hideDescriptionModal() {
    descriptionModal.classList.add('hidden');
  }

  // Modal close handlers
  closeModal.addEventListener('click', hideDescriptionModal);
  descriptionModal.addEventListener('click', (e) => {
    if (e.target === descriptionModal) {
      hideDescriptionModal();
    }
  });

  // Search functionality
  searchInput.addEventListener('input', (e) => {
    displayRecords(e.target.value);
  });

  function convertToCsv(data) {
    if (data.length === 0) return '';

    const headers = Object.keys(data[0]);
    const csvRows = [];

    csvRows.push(headers.join(','));

    for (const row of data) {
      const values = headers.map(header => {
        const escaped = ('' + (row[header] || '')).replace(/"/g, '""');
        return `"${escaped}"`;
      });
      csvRows.push(values.join(','));
    }

    return csvRows.join('\n');
  }

  function downloadCsv() {
    if (storedJobs.length === 0) {
      alert("No records to download.");
      return;
    }

    const csvString = convertToCsv(storedJobs);
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'aah_job_records.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  clearRecordsBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear all records? This cannot be undone.')) {
      chrome.storage.local.remove('jobs', () => {
        console.log('Scraped jobs cleared from storage.');
        displayRecords();
      });
    }
  });

  downloadCsvBtn.addEventListener('click', downloadCsv);

  // Listen for description saved messages
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'descriptionSaved') {
      console.log(`Description saved for job ${request.jobIndex + 1}, success: ${request.success}`);

      // Refresh storedJobs from storage
      chrome.storage.local.get(['jobs'], (result) => {
        storedJobs = result.jobs || [];
        displayRecords(searchInput.value);

        // Update progress
        const total = storedJobs.length;
        const withDesc = storedJobs.filter(job => job.description).length;
        const percent = Math.round((withDesc / total) * 100);
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
      storedJobs = result.jobs || [];

      // Find next job without description
      let foundJob = false;
      for (let i = 0; i < storedJobs.length; i++) {
        if (!storedJobs[i].description) {
          currentJobIndex = i;
          foundJob = true;
          break;
        }
      }

      if (!foundJob) {
        isGettingDescriptions = false;
        getDescriptionsBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Get Descriptions';
        getDescriptionsBtn.disabled = false;
        progressSection.classList.add('hidden');
        alert("All jobs have descriptions now!");
        return;
      }

      const job = storedJobs[currentJobIndex];
      console.log(`Processing job ${currentJobIndex + 1} of ${storedJobs.length}: ${job.title}`);

      // Update progress
      const withDesc = storedJobs.filter(j => j.description).length;
      const percent = Math.round((withDesc / storedJobs.length) * 100);
      progressBar.style.width = `${percent}%`;
      progressText.textContent = `${withDesc} / ${storedJobs.length}`;

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

  // Get Descriptions button
  getDescriptionsBtn.addEventListener('click', () => {
    if (storedJobs.length === 0) {
      alert("No records to get descriptions for.");
      return;
    }

    const jobsWithoutDesc = storedJobs.filter(job => !job.description);
    if (jobsWithoutDesc.length === 0) {
      alert("All jobs already have descriptions!");
      return;
    }

    if (confirm(`This will fetch descriptions for ${jobsWithoutDesc.length} jobs. Continue?`)) {
      isGettingDescriptions = true;
      getDescriptionsBtn.disabled = true;
      getDescriptionsBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg> Processing...';

      // Show progress section
      progressSection.classList.remove('hidden');
      const withDesc = storedJobs.filter(j => j.description).length;
      const percent = Math.round((withDesc / storedJobs.length) * 100);
      progressBar.style.width = `${percent}%`;
      progressText.textContent = `${withDesc} / ${storedJobs.length}`;

      processNextJob();
    }
  });

  // ==================== WEBHOOK FUNCTIONS ====================

  // Load webhooks from storage
  function loadWebhooks() {
    chrome.storage.local.get(['webhooks'], (result) => {
      webhooks = result.webhooks || [];
      renderWebhooks();
    });
  }

  // Save webhooks to storage
  function saveWebhooks() {
    chrome.storage.local.set({ webhooks: webhooks }, () => {
      console.log('Webhooks saved');
    });
  }

  // Render webhooks list
  function renderWebhooks() {
    if (webhooks.length === 0) {
      webhooksList.innerHTML = '<div class="no-webhooks">No webhooks configured</div>';
      return;
    }

    webhooksList.innerHTML = webhooks.map(webhook => `
      <div class="webhook-item ${webhook.enabled ? '' : 'disabled'}" data-id="${webhook.id}">
        <div class="webhook-status ${webhook.enabled ? '' : 'inactive'}"></div>
        <span class="webhook-name" title="${webhook.url}">${webhook.name}</span>
        <div class="webhook-actions">
          <button class="webhook-btn edit" data-id="${webhook.id}" title="Edit">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
          <button class="webhook-btn delete" data-id="${webhook.id}" title="Delete">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      </div>
    `).join('');

    // Add event listeners for edit/delete buttons
    webhooksList.querySelectorAll('.webhook-btn.edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        editWebhook(id);
      });
    });

    webhooksList.querySelectorAll('.webhook-btn.delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        deleteWebhook(id);
      });
    });
  }

  // Open webhook modal for adding
  function openAddWebhookModal() {
    webhookModalTitle.textContent = 'Add Webhook';
    webhookForm.reset();
    webhookIdInput.value = '';
    webhookEnabledInput.checked = true;
    webhookModal.classList.remove('hidden');
  }

  // Open webhook modal for editing
  function editWebhook(id) {
    const webhook = webhooks.find(w => w.id === id);
    if (!webhook) return;

    webhookModalTitle.textContent = 'Edit Webhook';
    webhookIdInput.value = webhook.id;
    webhookNameInput.value = webhook.name;
    webhookUrlInput.value = webhook.url;
    webhookEnabledInput.checked = webhook.enabled;
    webhookModal.classList.remove('hidden');
  }

  // Delete webhook
  function deleteWebhook(id) {
    const webhook = webhooks.find(w => w.id === id);
    if (!webhook) return;

    if (confirm(`Delete webhook "${webhook.name}"?`)) {
      webhooks = webhooks.filter(w => w.id !== id);
      saveWebhooks();
      renderWebhooks();
    }
  }

  // Close webhook modal
  function closeWebhookModalFn() {
    webhookModal.classList.add('hidden');
    webhookForm.reset();
  }

  // Save webhook (add or update)
  function saveWebhook(e) {
    e.preventDefault();

    const id = webhookIdInput.value || Date.now().toString();
    const name = webhookNameInput.value.trim();
    const url = webhookUrlInput.value.trim();
    const enabled = webhookEnabledInput.checked;

    if (!name || !url) {
      alert('Please fill in all fields');
      return;
    }

    const existingIndex = webhooks.findIndex(w => w.id === id);
    const webhookData = { id, name, url, enabled };

    if (existingIndex >= 0) {
      webhooks[existingIndex] = webhookData;
    } else {
      webhooks.push(webhookData);
    }

    saveWebhooks();
    renderWebhooks();
    closeWebhookModalFn();
  }

  // Send data to all enabled webhooks
  async function sendToWebhooks() {
    const enabledWebhooks = webhooks.filter(w => w.enabled);

    if (enabledWebhooks.length === 0) {
      alert('No enabled webhooks. Please add and enable at least one webhook.');
      return;
    }

    if (storedJobs.length === 0) {
      alert('No records to send.');
      return;
    }

    if (!confirm(`Send ${storedJobs.length} records to ${enabledWebhooks.length} webhook(s)?`)) {
      return;
    }

    sendToWebhooksBtn.disabled = true;
    sendToWebhooksBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg> Sending...';

    const results = [];

    for (const webhook of enabledWebhooks) {
      try {
        const response = await fetch(webhook.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            source: 'AAH Job Scraper',
            timestamp: new Date().toISOString(),
            totalRecords: storedJobs.length,
            data: storedJobs
          })
        });

        if (response.ok) {
          results.push({ name: webhook.name, success: true });
        } else {
          results.push({ name: webhook.name, success: false, error: `HTTP ${response.status}` });
        }
      } catch (error) {
        results.push({ name: webhook.name, success: false, error: error.message });
      }
    }

    // Show results
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success);

    let message = `Sent to ${successful}/${enabledWebhooks.length} webhooks successfully.`;
    if (failed.length > 0) {
      message += '\n\nFailed webhooks:\n' + failed.map(f => `- ${f.name}: ${f.error}`).join('\n');
    }

    alert(message);

    sendToWebhooksBtn.disabled = false;
    sendToWebhooksBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg> Send to Webhooks';
  }

  // Webhook event listeners
  addWebhookBtn.addEventListener('click', openAddWebhookModal);
  closeWebhookModal.addEventListener('click', closeWebhookModalFn);
  cancelWebhook.addEventListener('click', closeWebhookModalFn);
  webhookForm.addEventListener('submit', saveWebhook);
  sendToWebhooksBtn.addEventListener('click', sendToWebhooks);

  webhookModal.addEventListener('click', (e) => {
    if (e.target === webhookModal) {
      closeWebhookModalFn();
    }
  });

  // Initial load
  displayRecords();
  loadWebhooks();
});
