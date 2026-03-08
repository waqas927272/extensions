document.addEventListener('DOMContentLoaded', () => {
  const jobRecordsTableBody = document.querySelector('#jobRecordsTable tbody');
  const duplicateRecordsTableBody = document.querySelector('#duplicateRecordsTable tbody');
  const clearRecordsBtn = document.getElementById('clearRecords');
  const downloadCsvBtn = document.getElementById('downloadCsv');
  const getDescriptionsBtn = document.getElementById('getDescriptions');
  const sendToWebhooksBtn = document.getElementById('sendToWebhooks');
  const searchInput = document.getElementById('searchInput');

  const duplicatesSection = document.getElementById('duplicatesSection');
  const duplicateCount = document.getElementById('duplicateCount');
  const goToDuplicatesBtn = document.getElementById('goToDuplicates');
  const duplicateBtnCount = document.getElementById('duplicateBtnCount');

  const selectAllUnique = document.getElementById('selectAllUnique');
  const selectAllDuplicate = document.getElementById('selectAllDuplicate');
  const uniqueSelectionCount = document.getElementById('uniqueSelectionCount');
  const duplicateSelectionCount = document.getElementById('duplicateSelectionCount');
  const sendSelectedUniqueBtn = document.getElementById('sendSelectedUnique');
  const sendSelectedDuplicateBtn = document.getElementById('sendSelectedDuplicate');

  const totalRecordsEl = document.getElementById('totalRecords');
  const withDescriptionsEl = document.getElementById('withDescriptions');
  const pendingDescriptionsEl = document.getElementById('pendingDescriptions');

  const progressSection = document.getElementById('progressSection');
  const progressBar = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');

  const descriptionModal = document.getElementById('descriptionModal');
  const modalTitle = document.getElementById('modalTitle');
  const modalBody = document.getElementById('modalBody');
  const closeModal = document.getElementById('closeModal');

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

  const resultsModal = document.getElementById('resultsModal');
  const resultsModalHeader = document.getElementById('resultsModalHeader');
  const resultsModalTitle = document.getElementById('resultsModalTitle');
  const resultsModalBody = document.getElementById('resultsModalBody');
  const closeResultsModal = document.getElementById('closeResultsModal');
  const closeResultsBtn = document.getElementById('closeResultsBtn');
  const copyResultsBtn = document.getElementById('copyResults');

  let storedJobs = [];
  let uniqueJobs = [];
  let duplicateJobs = [];
  let webhooks = [];
  let currentJobIndex = 0;
  let isGettingDescriptions = false;

  const STORAGE_KEY = 'coveJobs';
  const PARENT_CLIENT_NAME = 'Cove Animal Health (Parent Client)';
  const SOURCE_NAME = 'Cove Job Scraper';

  // Detect duplicates based on title + hospitalName + city + state
  function separateDuplicates(jobs) {
    const seen = new Map();
    const unique = [];
    const duplicates = [];

    jobs.forEach((job, index) => {
      const key = [
        (job.title || '').toLowerCase().trim(),
        (job.hospitalName || '').toLowerCase().trim(),
        (job.city || '').toLowerCase().trim(),
        (job.state || '').toLowerCase().trim()
      ].join('|');

      if (seen.has(key)) {
        duplicates.push({ ...job, originalIndex: index });
      } else {
        seen.set(key, index);
        unique.push({ ...job, originalIndex: index });
      }
    });

    return { unique, duplicates };
  }

  // Selection tracking
  let selectedUniqueIndices = new Set();
  let selectedDuplicateIndices = new Set();

  function updateSelectionCount(type) {
    if (type === 'unique') {
      const count = selectedUniqueIndices.size;
      uniqueSelectionCount.textContent = `${count} selected`;
      sendSelectedUniqueBtn.disabled = count === 0;
    } else {
      const count = selectedDuplicateIndices.size;
      duplicateSelectionCount.textContent = `${count} selected`;
      sendSelectedDuplicateBtn.disabled = count === 0;
    }
  }

  function handleRowCheckbox(checkbox, index, type) {
    const row = checkbox.closest('tr');
    const selectedSet = type === 'unique' ? selectedUniqueIndices : selectedDuplicateIndices;
    const selectAllCheckbox = type === 'unique' ? selectAllUnique : selectAllDuplicate;
    const jobsArray = type === 'unique' ? uniqueJobs : duplicateJobs;

    if (checkbox.checked) {
      selectedSet.add(index);
      row.classList.add('selected');
    } else {
      selectedSet.delete(index);
      row.classList.remove('selected');
    }

    selectAllCheckbox.checked = selectedSet.size === jobsArray.length && jobsArray.length > 0;
    selectAllCheckbox.indeterminate = selectedSet.size > 0 && selectedSet.size < jobsArray.length;

    updateSelectionCount(type);
  }

  function handleSelectAll(selectAllCheckbox, type) {
    const tableBody = type === 'unique' ? jobRecordsTableBody : duplicateRecordsTableBody;
    const selectedSet = type === 'unique' ? selectedUniqueIndices : selectedDuplicateIndices;

    const checkboxes = tableBody.querySelectorAll('input[type="checkbox"]');

    if (selectAllCheckbox.checked) {
      checkboxes.forEach((cb, idx) => {
        cb.checked = true;
        cb.closest('tr').classList.add('selected');
        selectedSet.add(idx);
      });
    } else {
      checkboxes.forEach((cb) => {
        cb.checked = false;
        cb.closest('tr').classList.remove('selected');
      });
      selectedSet.clear();
    }

    selectAllCheckbox.indeterminate = false;
    updateSelectionCount(type);
  }

  function resetSelections() {
    selectedUniqueIndices.clear();
    selectedDuplicateIndices.clear();
    selectAllUnique.checked = false;
    selectAllUnique.indeterminate = false;
    selectAllDuplicate.checked = false;
    selectAllDuplicate.indeterminate = false;
    updateSelectionCount('unique');
    updateSelectionCount('duplicate');
  }

  function updateStats() {
    const total = storedJobs.length;
    const withDesc = storedJobs.filter(job => job.description).length;
    const pending = total - withDesc;

    totalRecordsEl.textContent = total;
    withDescriptionsEl.textContent = withDesc;
    pendingDescriptionsEl.textContent = pending;
  }

  function buildRowHtml(job, index, actualIndex, type) {
    const hasDescription = job.description && job.description.length > 0;
    const descriptionHtml = hasDescription
      ? `<div class="description-preview">
           <span class="status-badge status-done">Done</span>
           <button class="view-desc-btn" data-index="${actualIndex}">View</button>
         </div>`
      : `<span class="status-badge status-pending">Pending</span>`;

    return `
      <td class="checkbox-cell">
        <input type="checkbox" class="row-checkbox" data-index="${index}" data-type="${type}">
      </td>
      <td>${index + 1}</td>
      <td class="job-id-cell">${escapeHtml(job.jobId || 'N/A')}</td>
      <td class="parent-client-cell">${escapeHtml(PARENT_CLIENT_NAME)}</td>
      <td class="job-title">${escapeHtml(job.title)}</td>
      <td class="department-cell">${escapeHtml(job.department || 'N/A')}</td>
      <td class="hospital-name">${escapeHtml(job.hospitalName)}</td>
      <td class="address-cell">${escapeHtml(job.streetAddress || 'N/A')}</td>
      <td class="city-cell">${escapeHtml(job.city || 'N/A')}</td>
      <td class="state-cell">${escapeHtml(job.state || 'N/A')}</td>
      <td class="zip-cell">${escapeHtml(job.postalCode || 'N/A')}</td>
      <td class="description-cell">${descriptionHtml}</td>
      <td>
        <a href="${job.link}" target="_blank" class="link-btn">
          Open &rarr;
        </a>
      </td>
    `;
  }

  function displayRecords(filter = '') {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      storedJobs = result[STORAGE_KEY] || [];
      jobRecordsTableBody.innerHTML = '';
      duplicateRecordsTableBody.innerHTML = '';

      resetSelections();
      updateStats();

      if (storedJobs.length === 0) {
        jobRecordsTableBody.innerHTML = `
          <tr>
            <td colspan="13" class="no-records">
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
        duplicatesSection.classList.add('hidden');
        goToDuplicatesBtn.classList.add('hidden');
        return;
      }

      downloadCsvBtn.disabled = false;
      getDescriptionsBtn.disabled = false;

      const { unique, duplicates } = separateDuplicates(storedJobs);
      uniqueJobs = unique;
      duplicateJobs = duplicates;

      if (duplicateJobs.length > 0) {
        duplicateCount.textContent = duplicateJobs.length;
        duplicateBtnCount.textContent = duplicateJobs.length;
        duplicatesSection.classList.remove('hidden');
        goToDuplicatesBtn.classList.remove('hidden');
      } else {
        duplicatesSection.classList.add('hidden');
        goToDuplicatesBtn.classList.add('hidden');
      }

      const filteredUniqueJobs = filter
        ? uniqueJobs.filter(job =>
            job.title.toLowerCase().includes(filter.toLowerCase()) ||
            job.hospitalName.toLowerCase().includes(filter.toLowerCase()) ||
            (job.city && job.city.toLowerCase().includes(filter.toLowerCase())) ||
            (job.state && job.state.toLowerCase().includes(filter.toLowerCase())) ||
            (job.department && job.department.toLowerCase().includes(filter.toLowerCase()))
          )
        : uniqueJobs;

      const filteredDuplicateJobs = filter
        ? duplicateJobs.filter(job =>
            job.title.toLowerCase().includes(filter.toLowerCase()) ||
            job.hospitalName.toLowerCase().includes(filter.toLowerCase()) ||
            (job.city && job.city.toLowerCase().includes(filter.toLowerCase())) ||
            (job.state && job.state.toLowerCase().includes(filter.toLowerCase())) ||
            (job.department && job.department.toLowerCase().includes(filter.toLowerCase()))
          )
        : duplicateJobs;

      if (filteredUniqueJobs.length === 0) {
        jobRecordsTableBody.innerHTML = `
          <tr>
            <td colspan="13" class="no-records">
              <svg class="no-records-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <p class="no-records-text">No jobs match your search.</p>
            </td>
          </tr>
        `;
      } else {
        filteredUniqueJobs.forEach((job, index) => {
          const row = document.createElement('tr');
          row.innerHTML = buildRowHtml(job, index, job.originalIndex, 'unique');
          jobRecordsTableBody.appendChild(row);
        });
      }

      if (filteredDuplicateJobs.length > 0) {
        filteredDuplicateJobs.forEach((job, index) => {
          const row = document.createElement('tr');
          row.innerHTML = buildRowHtml(job, index, job.originalIndex, 'duplicate');
          duplicateRecordsTableBody.appendChild(row);
        });
      } else if (duplicateJobs.length > 0) {
        duplicateRecordsTableBody.innerHTML = `
          <tr>
            <td colspan="13" class="no-records">
              <p class="no-records-text">No duplicates match your search.</p>
            </td>
          </tr>
        `;
      }

      // Add click handlers for view description buttons
      document.querySelectorAll('.view-desc-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const index = parseInt(e.target.dataset.index);
          showDescriptionModal(index);
        });
      });

      // Add click handlers for row checkboxes
      document.querySelectorAll('.row-checkbox').forEach(cb => {
        cb.addEventListener('change', (e) => {
          const index = parseInt(e.target.dataset.index);
          const type = e.target.dataset.type;
          handleRowCheckbox(e.target, index, type);
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

  closeModal.addEventListener('click', hideDescriptionModal);
  descriptionModal.addEventListener('click', (e) => {
    if (e.target === descriptionModal) {
      hideDescriptionModal();
    }
  });

  searchInput.addEventListener('input', (e) => {
    displayRecords(e.target.value);
  });

  goToDuplicatesBtn.addEventListener('click', () => {
    duplicatesSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  selectAllUnique.addEventListener('change', () => {
    handleSelectAll(selectAllUnique, 'unique');
  });

  selectAllDuplicate.addEventListener('change', () => {
    handleSelectAll(selectAllDuplicate, 'duplicate');
  });

  sendSelectedUniqueBtn.addEventListener('click', () => {
    sendSelectedToWebhook('unique');
  });

  sendSelectedDuplicateBtn.addEventListener('click', () => {
    sendSelectedToWebhook('duplicate');
  });

  // Send selected records to webhook
  async function sendSelectedToWebhook(type) {
    const enabledWebhooks = webhooks.filter(w => w.enabled);

    if (enabledWebhooks.length === 0) {
      showResultsModal('Warning', 'No enabled webhooks. Please add and enable at least one webhook.', 'warning');
      return;
    }

    const selectedIndices = type === 'unique' ? selectedUniqueIndices : selectedDuplicateIndices;
    const jobsArray = type === 'unique' ? uniqueJobs : duplicateJobs;
    const sendBtn = type === 'unique' ? sendSelectedUniqueBtn : sendSelectedDuplicateBtn;

    if (selectedIndices.size === 0) {
      showResultsModal('Warning', 'No records selected. Please select at least one record.', 'warning');
      return;
    }

    const selectedJobs = Array.from(selectedIndices).map(idx => jobsArray[idx]);

    const BATCH_SIZE = 50;
    const totalBatches = Math.ceil(selectedJobs.length / BATCH_SIZE);
    const tableType = type === 'unique' ? 'Unique Records' : 'Duplicate Records';

    if (!confirm(`Send ${selectedJobs.length} selected ${tableType} in ${totalBatches} batch(es) to ${enabledWebhooks.length} webhook(s)?`)) {
      return;
    }

    const originalBtnHtml = sendBtn.innerHTML;
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><circle cx="12" cy="12" r="10"></circle></svg> Sending...';

    progressSection.classList.remove('hidden');
    progressBar.style.width = '0%';
    progressText.textContent = `0 / ${totalBatches} batches`;

    const jobsWithParentClient = selectedJobs.map(job => ({
      parent_client: PARENT_CLIENT_NAME,
      job_id: job.jobId || '',
      job_title: job.title || '',
      department: job.department || '',
      hospital: job.hospitalName || '',
      address: job.streetAddress || '',
      city: job.city || '',
      state: job.state || '',
      zip_code: job.postalCode || '',
      description: job.description || '',
      link: job.link || ''
    }));

    const batches = [];
    for (let i = 0; i < jobsWithParentClient.length; i += BATCH_SIZE) {
      batches.push(jobsWithParentClient.slice(i, i + BATCH_SIZE));
    }

    const allResults = [];
    let batchesSent = 0;
    const syncId = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      const batchNumber = batchIndex + 1;

      const payload = {
        source: SOURCE_NAME,
        parentClientName: PARENT_CLIENT_NAME,
        recordType: type,
        syncId: syncId,
        timestamp: new Date().toISOString(),
        batchNumber: batchNumber,
        totalBatches: totalBatches,
        batchSize: batch.length,
        totalRecords: selectedJobs.length,
        data: batch
      };

      for (const webhook of enabledWebhooks) {
        const response = await sendWebhookRequest(webhook.url, payload);
        allResults.push({
          name: webhook.name,
          url: webhook.url,
          batch: batchNumber,
          ...response
        });
      }

      batchesSent++;
      const percent = Math.round((batchesSent / totalBatches) * 100);
      progressBar.style.width = `${percent}%`;
      progressText.textContent = `${batchesSent} / ${totalBatches} batches`;

      if (batchIndex < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    progressSection.classList.add('hidden');

    const successful = allResults.filter(r => r.success);
    const failed = allResults.filter(r => !r.success);
    const timestamp = new Date().toISOString();

    let message = `Webhook Results (${tableType})\n`;
    message += `${'='.repeat(30)}\n`;
    message += `Sync ID: ${syncId}\n`;
    message += `Timestamp: ${timestamp}\n`;
    message += `Record Type: ${tableType}\n`;
    message += `Selected Records: ${selectedJobs.length}\n`;
    message += `Batches Sent: ${totalBatches} (${BATCH_SIZE} records each)\n`;
    message += `Webhooks: ${enabledWebhooks.length}\n`;
    message += `Total Requests: ${allResults.length}\n`;
    message += `Successful: ${successful.length} | Failed: ${failed.length}\n\n`;

    if (successful.length > 0) {
      message += `Successful Batches:\n`;
      const successByWebhook = {};
      successful.forEach(s => {
        if (!successByWebhook[s.name]) successByWebhook[s.name] = [];
        successByWebhook[s.name].push(s.batch);
      });
      Object.entries(successByWebhook).forEach(([name, batchNums]) => {
        message += `  [OK] ${name}: Batches ${batchNums.join(', ')}\n`;
      });
      message += `\n`;
    }

    if (failed.length > 0) {
      message += `Failed Batches:\n`;
      failed.forEach(f => {
        message += `  [ERROR] ${f.name} (Batch ${f.batch})\n`;
        message += `          ${f.url}\n`;
        message += `          Error: ${f.error}\n`;
      });
    }

    const modalType = failed.length === 0 ? 'success' : (successful.length === 0 ? 'error' : 'warning');
    const mTitle = failed.length === 0 ? 'Success' : (successful.length === 0 ? 'Failed' : 'Partial Success');

    showResultsModal(mTitle, message, modalType);

    sendBtn.disabled = false;
    sendBtn.innerHTML = originalBtnHtml;
  }

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
    a.download = 'cove_job_records.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  clearRecordsBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear all records? This cannot be undone.')) {
      chrome.storage.local.remove(STORAGE_KEY, () => {
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

      chrome.storage.local.get([STORAGE_KEY], (result) => {
        storedJobs = result[STORAGE_KEY] || [];
        displayRecords(searchInput.value);

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
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      storedJobs = result[STORAGE_KEY] || [];

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

      const withDesc = storedJobs.filter(j => j.description).length;
      const percent = Math.round((withDesc / storedJobs.length) * 100);
      progressBar.style.width = `${percent}%`;
      progressText.textContent = `${withDesc} / ${storedJobs.length}`;

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

      progressSection.classList.remove('hidden');
      const withDesc = storedJobs.filter(j => j.description).length;
      const percent = Math.round((withDesc / storedJobs.length) * 100);
      progressBar.style.width = `${percent}%`;
      progressText.textContent = `${withDesc} / ${storedJobs.length}`;

      processNextJob();
    }
  });

  // ==================== RESULTS MODAL FUNCTIONS ====================

  let currentResultsText = '';

  function showResultsModal(title, message, type = 'default') {
    currentResultsText = message;
    resultsModalTitle.textContent = title;
    resultsModalBody.textContent = message;

    resultsModalHeader.classList.remove('success', 'error', 'warning');
    if (type !== 'default') {
      resultsModalHeader.classList.add(type);
    }

    resultsModal.classList.remove('hidden');
  }

  function hideResultsModal() {
    resultsModal.classList.add('hidden');
    currentResultsText = '';
  }

  function copyResultsToClipboard() {
    navigator.clipboard.writeText(currentResultsText).then(() => {
      const originalText = copyResultsBtn.innerHTML;
      copyResultsBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg> Copied!';
      copyResultsBtn.classList.add('btn-success');
      copyResultsBtn.classList.remove('btn-primary');

      setTimeout(() => {
        copyResultsBtn.innerHTML = originalText;
        copyResultsBtn.classList.remove('btn-success');
        copyResultsBtn.classList.add('btn-primary');
      }, 2000);
    }).catch(err => {
      console.error('Failed to copy:', err);
    });
  }

  closeResultsModal.addEventListener('click', hideResultsModal);
  closeResultsBtn.addEventListener('click', hideResultsModal);
  copyResultsBtn.addEventListener('click', copyResultsToClipboard);
  resultsModal.addEventListener('click', (e) => {
    if (e.target === resultsModal) {
      hideResultsModal();
    }
  });

  // ==================== WEBHOOK FUNCTIONS ====================

  function loadWebhooks() {
    chrome.storage.local.get(['coveWebhook'], (result) => {
      webhooks = result.coveWebhook || [];
      renderWebhooks();
    });
  }

  function saveWebhooks() {
    chrome.storage.local.set({ coveWebhook: webhooks }, () => {
      console.log('Webhooks saved');
    });
  }

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

  function openAddWebhookModal() {
    webhookModalTitle.textContent = 'Add Webhook';
    webhookForm.reset();
    webhookIdInput.value = '';
    webhookEnabledInput.checked = true;
    webhookModal.classList.remove('hidden');
  }

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

  function deleteWebhook(id) {
    const webhook = webhooks.find(w => w.id === id);
    if (!webhook) return;

    if (confirm(`Delete webhook "${webhook.name}"?`)) {
      webhooks = webhooks.filter(w => w.id !== id);
      saveWebhooks();
      renderWebhooks();
    }
  }

  function closeWebhookModalFn() {
    webhookModal.classList.add('hidden');
    webhookForm.reset();
  }

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

  function sendWebhookRequest(url, payload) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          action: 'sendWebhook',
          url: url,
          payload: payload
        },
        (response) => {
          resolve(response || { success: false, error: 'No response from background script' });
        }
      );
    });
  }

  // Send data to all enabled webhooks in batches
  async function sendToWebhooks() {
    const enabledWebhooks = webhooks.filter(w => w.enabled);

    if (enabledWebhooks.length === 0) {
      showResultsModal('Warning', 'No enabled webhooks. Please add and enable at least one webhook.', 'warning');
      return;
    }

    if (storedJobs.length === 0) {
      showResultsModal('Warning', 'No records to send.', 'warning');
      return;
    }

    const BATCH_SIZE = 50;
    const totalBatches = Math.ceil(storedJobs.length / BATCH_SIZE);

    if (!confirm(`Send ${storedJobs.length} records in ${totalBatches} batch(es) of ${BATCH_SIZE} to ${enabledWebhooks.length} webhook(s)?`)) {
      return;
    }

    sendToWebhooksBtn.disabled = true;
    sendToWebhooksBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg> Sending...';

    progressSection.classList.remove('hidden');
    progressBar.style.width = '0%';
    progressText.textContent = `0 / ${totalBatches} batches`;

    const jobsWithParentClient = storedJobs.map(job => ({
      parent_client: PARENT_CLIENT_NAME,
      job_id: job.jobId || '',
      job_title: job.title || '',
      department: job.department || '',
      hospital: job.hospitalName || '',
      address: job.streetAddress || '',
      city: job.city || '',
      state: job.state || '',
      zip_code: job.postalCode || '',
      description: job.description || '',
      link: job.link || ''
    }));

    const batches = [];
    for (let i = 0; i < jobsWithParentClient.length; i += BATCH_SIZE) {
      batches.push(jobsWithParentClient.slice(i, i + BATCH_SIZE));
    }

    const allResults = [];
    let batchesSent = 0;

    const syncId = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      const batchNumber = batchIndex + 1;

      const payload = {
        source: SOURCE_NAME,
        parentClientName: PARENT_CLIENT_NAME,
        syncId: syncId,
        timestamp: new Date().toISOString(),
        batchNumber: batchNumber,
        totalBatches: totalBatches,
        batchSize: batch.length,
        totalRecords: storedJobs.length,
        data: batch
      };

      for (const webhook of enabledWebhooks) {
        const response = await sendWebhookRequest(webhook.url, payload);
        allResults.push({
          name: webhook.name,
          url: webhook.url,
          batch: batchNumber,
          ...response
        });
      }

      batchesSent++;
      const percent = Math.round((batchesSent / totalBatches) * 100);
      progressBar.style.width = `${percent}%`;
      progressText.textContent = `${batchesSent} / ${totalBatches} batches`;

      if (batchIndex < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    progressSection.classList.add('hidden');

    const successful = allResults.filter(r => r.success);
    const failed = allResults.filter(r => !r.success);
    const timestamp = new Date().toISOString();

    let message = `Webhook Results\n`;
    message += `===============\n`;
    message += `Sync ID: ${syncId}\n`;
    message += `Timestamp: ${timestamp}\n`;
    message += `Total Records: ${storedJobs.length}\n`;
    message += `Batches Sent: ${totalBatches} (${BATCH_SIZE} records each)\n`;
    message += `Webhooks: ${enabledWebhooks.length}\n`;
    message += `Total Requests: ${allResults.length}\n`;
    message += `Successful: ${successful.length} | Failed: ${failed.length}\n\n`;

    if (successful.length > 0) {
      message += `Successful Batches:\n`;
      const successByWebhook = {};
      successful.forEach(s => {
        if (!successByWebhook[s.name]) successByWebhook[s.name] = [];
        successByWebhook[s.name].push(s.batch);
      });
      Object.entries(successByWebhook).forEach(([name, batchNums]) => {
        message += `  [OK] ${name}: Batches ${batchNums.join(', ')}\n`;
      });
      message += `\n`;
    }

    if (failed.length > 0) {
      message += `Failed Batches:\n`;
      failed.forEach(f => {
        message += `  [ERROR] ${f.name} (Batch ${f.batch})\n`;
        message += `          ${f.url}\n`;
        message += `          Error: ${f.error}\n`;
      });
    }

    const modalType = failed.length === 0 ? 'success' : (successful.length === 0 ? 'error' : 'warning');
    const mTitle = failed.length === 0 ? 'Success' : (successful.length === 0 ? 'Failed' : 'Partial Success');

    showResultsModal(mTitle, message, modalType);

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
