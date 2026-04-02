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

  const fetchDetailsBtn = document.getElementById('fetchDetails');
  const withDetailsEl = document.getElementById('withDetails');

  let storedJobs = [];
  let uniqueJobs = [];
  let duplicateJobs = [];
  let webhooks = [];
  let currentJobIndex = 0;
  let isGettingDescriptions = false;
  let isFetchingDetails = false;
  let detailsQueue = [];
  let currentDetailsIndex = 0;

  const STORAGE_KEY = 'laaserJobs';
  const PARENT_CLIENT_NAME = 'Los Angeles Animal Specialty Emergency and Rehabilitation (LAASER)';
  const SOURCE_NAME = 'LAASER Job Scraper';

  function separateDuplicates(jobs) {
    const seen = new Map();
    const unique = [];
    const duplicates = [];
    jobs.forEach((job, index) => {
      const key = [
        (job.title || '').toLowerCase().trim(),
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
    if (checkbox.checked) { selectedSet.add(index); row.classList.add('selected'); }
    else { selectedSet.delete(index); row.classList.remove('selected'); }
    selectAllCheckbox.checked = selectedSet.size === jobsArray.length && jobsArray.length > 0;
    selectAllCheckbox.indeterminate = selectedSet.size > 0 && selectedSet.size < jobsArray.length;
    updateSelectionCount(type);
  }

  function handleSelectAll(selectAllCheckbox, type) {
    const tableBody = type === 'unique' ? jobRecordsTableBody : duplicateRecordsTableBody;
    const selectedSet = type === 'unique' ? selectedUniqueIndices : selectedDuplicateIndices;
    const checkboxes = tableBody.querySelectorAll('input[type="checkbox"]');
    if (selectAllCheckbox.checked) {
      checkboxes.forEach((cb, idx) => { cb.checked = true; cb.closest('tr').classList.add('selected'); selectedSet.add(idx); });
    } else {
      checkboxes.forEach((cb) => { cb.checked = false; cb.closest('tr').classList.remove('selected'); });
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
    const withDet = storedJobs.filter(job => job.detailsFetched).length;
    totalRecordsEl.textContent = total;
    withDescriptionsEl.textContent = withDesc;
    pendingDescriptionsEl.textContent = total - withDesc;
    withDetailsEl.textContent = withDet;
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
      <td class="checkbox-cell"><input type="checkbox" class="row-checkbox" data-index="${index}" data-type="${type}"></td>
      <td>${index + 1}</td>
      <td class="job-id-cell">${escapeHtml(job.jobId || 'N/A')}</td>
      <td class="parent-client-cell">${escapeHtml(PARENT_CLIENT_NAME)}</td>
      <td class="job-title">${escapeHtml(job.title)}</td>
      <td class="job-type-cell">${escapeHtml(job.jobType || 'N/A')}</td>
      <td class="salary-cell">${escapeHtml(job.salary || 'N/A')}</td>
      <td>${escapeHtml(job.hospitalName || 'N/A')}</td>
      <td class="city-cell">${escapeHtml(job.city || 'N/A')}</td>
      <td class="state-cell">${escapeHtml(job.state || 'N/A')}</td>
      <td>${escapeHtml(job.position || 'N/A')}</td>
      <td>${escapeHtml(job.areaOfPractice || 'N/A')}</td>
      <td class="description-cell">${descriptionHtml}</td>
      <td><a href="${job.link}" target="_blank" class="link-btn">Open &rarr;</a></td>
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
        jobRecordsTableBody.innerHTML = `<tr><td colspan="14" class="no-records">
          <svg class="no-records-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
          </svg>
          <p class="no-records-text">No records scraped yet. Start scraping from the extension popup.</p></td></tr>`;
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

      const lc = (filter || '').toLowerCase();
      const filteredUnique = lc ? uniqueJobs.filter(job =>
        job.title.toLowerCase().includes(lc) || job.city.toLowerCase().includes(lc) ||
        (job.jobType || '').toLowerCase().includes(lc) || (job.salary || '').toLowerCase().includes(lc)
      ) : uniqueJobs;

      const filteredDuplicate = lc ? duplicateJobs.filter(job =>
        job.title.toLowerCase().includes(lc) || job.city.toLowerCase().includes(lc) ||
        (job.jobType || '').toLowerCase().includes(lc) || (job.salary || '').toLowerCase().includes(lc)
      ) : duplicateJobs;

      if (filteredUnique.length === 0) {
        jobRecordsTableBody.innerHTML = `<tr><td colspan="14" class="no-records"><p class="no-records-text">No jobs match your search.</p></td></tr>`;
      } else {
        filteredUnique.forEach((job, index) => {
          const row = document.createElement('tr');
          row.innerHTML = buildRowHtml(job, index, job.originalIndex, 'unique');
          jobRecordsTableBody.appendChild(row);
        });
      }

      if (filteredDuplicate.length > 0) {
        filteredDuplicate.forEach((job, index) => {
          const row = document.createElement('tr');
          row.innerHTML = buildRowHtml(job, index, job.originalIndex, 'duplicate');
          duplicateRecordsTableBody.appendChild(row);
        });
      } else if (duplicateJobs.length > 0) {
        duplicateRecordsTableBody.innerHTML = `<tr><td colspan="14" class="no-records"><p class="no-records-text">No duplicates match your search.</p></td></tr>`;
      }

      document.querySelectorAll('.view-desc-btn').forEach(btn => {
        btn.addEventListener('click', (e) => showDescriptionModal(parseInt(e.target.dataset.index)));
      });
      document.querySelectorAll('.row-checkbox').forEach(cb => {
        cb.addEventListener('change', (e) => handleRowCheckbox(e.target, parseInt(e.target.dataset.index), e.target.dataset.type));
      });
    });
  }

  function escapeHtml(text) { const div = document.createElement('div'); div.textContent = text; return div.innerHTML; }

  function showDescriptionModal(index) {
    const job = storedJobs[index];
    if (job && job.description) { modalTitle.textContent = job.title; modalBody.textContent = job.description; descriptionModal.classList.remove('hidden'); }
  }

  function hideDescriptionModal() { descriptionModal.classList.add('hidden'); }
  closeModal.addEventListener('click', hideDescriptionModal);
  descriptionModal.addEventListener('click', (e) => { if (e.target === descriptionModal) hideDescriptionModal(); });

  searchInput.addEventListener('input', (e) => displayRecords(e.target.value));
  goToDuplicatesBtn.addEventListener('click', () => duplicatesSection.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  selectAllUnique.addEventListener('change', () => handleSelectAll(selectAllUnique, 'unique'));
  selectAllDuplicate.addEventListener('change', () => handleSelectAll(selectAllDuplicate, 'duplicate'));
  sendSelectedUniqueBtn.addEventListener('click', () => sendSelectedToWebhook('unique'));
  sendSelectedDuplicateBtn.addEventListener('click', () => sendSelectedToWebhook('duplicate'));

  async function sendSelectedToWebhook(type) {
    const enabledWebhooks = webhooks.filter(w => w.enabled);
    if (enabledWebhooks.length === 0) { showResultsModal('Warning', 'No enabled webhooks.', 'warning'); return; }
    const selectedIndices = type === 'unique' ? selectedUniqueIndices : selectedDuplicateIndices;
    const jobsArray = type === 'unique' ? uniqueJobs : duplicateJobs;
    const sendBtn = type === 'unique' ? sendSelectedUniqueBtn : sendSelectedDuplicateBtn;
    if (selectedIndices.size === 0) { showResultsModal('Warning', 'No records selected.', 'warning'); return; }

    const selectedJobs = Array.from(selectedIndices).map(idx => jobsArray[idx]);
    const BATCH_SIZE = 50;
    const totalBatches = Math.ceil(selectedJobs.length / BATCH_SIZE);
    const tableType = type === 'unique' ? 'Unique Records' : 'Duplicate Records';

    if (!confirm(`Send ${selectedJobs.length} selected ${tableType} in ${totalBatches} batch(es) to ${enabledWebhooks.length} webhook(s)?`)) return;

    const originalBtnHtml = sendBtn.innerHTML;
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><circle cx="12" cy="12" r="10"></circle></svg> Sending...';
    progressSection.classList.remove('hidden');
    progressBar.style.width = '0%';
    progressText.textContent = `0 / ${totalBatches} batches`;

    const jobsPayload = selectedJobs.map(job => ({
      parent_client: PARENT_CLIENT_NAME, job_id: job.jobId || '', job_title: job.title || '',
      job_type: job.jobType || '', salary: job.salary || '', hospital: job.hospitalName || '',
      city: job.city || '', state: job.state || '', position: job.position || '',
      area_of_practice: job.areaOfPractice || '', description: job.description || '', link: job.link || ''
    }));

    const batches = [];
    for (let i = 0; i < jobsPayload.length; i += BATCH_SIZE) batches.push(jobsPayload.slice(i, i + BATCH_SIZE));

    const allResults = [];
    let batchesSent = 0;
    const syncId = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);

    for (let bi = 0; bi < batches.length; bi++) {
      const payload = {
        source: SOURCE_NAME, parentClientName: PARENT_CLIENT_NAME, recordType: type,
        syncId, timestamp: new Date().toISOString(), batchNumber: bi + 1,
        totalBatches, batchSize: batches[bi].length, totalRecords: selectedJobs.length, data: batches[bi]
      };
      for (const webhook of enabledWebhooks) {
        const response = await sendWebhookRequest(webhook.url, payload);
        allResults.push({ name: webhook.name, url: webhook.url, batch: bi + 1, ...response });
      }
      batchesSent++;
      progressBar.style.width = `${Math.round((batchesSent / totalBatches) * 100)}%`;
      progressText.textContent = `${batchesSent} / ${totalBatches} batches`;
      if (bi < batches.length - 1) await new Promise(r => setTimeout(r, 500));
    }

    progressSection.classList.add('hidden');
    const successful = allResults.filter(r => r.success);
    const failed = allResults.filter(r => !r.success);
    let message = `Webhook Results (${tableType})\n${'='.repeat(30)}\nSync ID: ${syncId}\nTimestamp: ${new Date().toISOString()}\nSelected: ${selectedJobs.length}\nBatches: ${totalBatches}\nSuccessful: ${successful.length} | Failed: ${failed.length}\n`;
    if (failed.length > 0) failed.forEach(f => { message += `\n[ERROR] ${f.name} (Batch ${f.batch}): ${f.error}`; });
    showResultsModal(failed.length === 0 ? 'Success' : 'Partial Success', message, failed.length === 0 ? 'success' : 'warning');
    sendBtn.disabled = false;
    sendBtn.innerHTML = originalBtnHtml;
  }

  function convertToCsv(data) {
    if (data.length === 0) return '';
    const headers = Object.keys(data[0]);
    const csvRows = [headers.join(',')];
    for (const row of data) {
      csvRows.push(headers.map(h => `"${('' + (row[h] || '')).replace(/"/g, '""')}"`).join(','));
    }
    return csvRows.join('\n');
  }

  function downloadCsv() {
    if (storedJobs.length === 0) { alert("No records to download."); return; }
    const blob = new Blob([convertToCsv(storedJobs)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'laaser_job_records.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  clearRecordsBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear all records?')) {
      chrome.storage.local.remove(STORAGE_KEY, () => displayRecords());
    }
  });
  downloadCsvBtn.addEventListener('click', downloadCsv);

  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'descriptionSaved') {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        storedJobs = result[STORAGE_KEY] || [];
        displayRecords(searchInput.value);
        const total = storedJobs.length;
        const withDesc = storedJobs.filter(j => j.description).length;
        progressBar.style.width = `${Math.round((withDesc / total) * 100)}%`;
        progressText.textContent = `${withDesc} / ${total}`;
        if (isGettingDescriptions) setTimeout(() => processNextJob(), 1500);
      });
    }
  });

  function processNextJob() {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      storedJobs = result[STORAGE_KEY] || [];
      let foundJob = false;
      for (let i = 0; i < storedJobs.length; i++) {
        if (!storedJobs[i].description) { currentJobIndex = i; foundJob = true; break; }
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
      const withDesc = storedJobs.filter(j => j.description).length;
      progressBar.style.width = `${Math.round((withDesc / storedJobs.length) * 100)}%`;
      progressText.textContent = `${withDesc} / ${storedJobs.length}`;
      chrome.tabs.create({ url: job.link, active: false }, (tab) => {
        chrome.runtime.sendMessage({ action: 'scrapeJobDescription', tabId: tab.id, jobIndex: currentJobIndex, jobLink: job.link });
      });
    });
  }

  getDescriptionsBtn.addEventListener('click', () => {
    if (storedJobs.length === 0) { alert("No records."); return; }
    const pending = storedJobs.filter(j => !j.description);
    if (pending.length === 0) { alert("All jobs already have descriptions!"); return; }
    if (confirm(`Fetch descriptions for ${pending.length} jobs?`)) {
      isGettingDescriptions = true;
      getDescriptionsBtn.disabled = true;
      getDescriptionsBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><circle cx="12" cy="12" r="10"></circle></svg> Processing...';
      progressSection.classList.remove('hidden');
      const withDesc = storedJobs.filter(j => j.description).length;
      progressBar.style.width = `${Math.round((withDesc / storedJobs.length) * 100)}%`;
      progressText.textContent = `${withDesc} / ${storedJobs.length}`;
      processNextJob();
    }
  });

  // Results modal
  let currentResultsText = '';
  function showResultsModal(title, message, type = 'default') {
    currentResultsText = message; resultsModalTitle.textContent = title; resultsModalBody.textContent = message;
    resultsModalHeader.classList.remove('success', 'error', 'warning');
    if (type !== 'default') resultsModalHeader.classList.add(type);
    resultsModal.classList.remove('hidden');
  }
  function hideResultsModal() { resultsModal.classList.add('hidden'); currentResultsText = ''; }
  closeResultsModal.addEventListener('click', hideResultsModal);
  closeResultsBtn.addEventListener('click', hideResultsModal);
  copyResultsBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(currentResultsText).then(() => {
      const orig = copyResultsBtn.innerHTML;
      copyResultsBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg> Copied!';
      setTimeout(() => { copyResultsBtn.innerHTML = orig; }, 2000);
    });
  });
  resultsModal.addEventListener('click', (e) => { if (e.target === resultsModal) hideResultsModal(); });

  // Webhook functions
  // ==================== FETCH DETAILS FUNCTIONS ====================

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'detailsFetched') {
      const details = request.details || {};
      const jobIndex = request.jobIndex;

      chrome.storage.local.get([STORAGE_KEY], (result) => {
        const jobs = result[STORAGE_KEY] || [];
        if (jobs[jobIndex]) {
          if (details.hospitalName) jobs[jobIndex].hospitalName = details.hospitalName;
          if (details.streetAddress) jobs[jobIndex].streetAddress = details.streetAddress;
          if (details.city) jobs[jobIndex].city = details.city;
          if (details.state) jobs[jobIndex].state = details.state;
          if (details.postalCode) jobs[jobIndex].postalCode = details.postalCode;
          if (details.jobType) jobs[jobIndex].jobType = details.jobType;
          if (details.salary) jobs[jobIndex].salary = details.salary;
          if (details.position) jobs[jobIndex].position = details.position;
          if (details.areaOfPractice) jobs[jobIndex].areaOfPractice = details.areaOfPractice;
          jobs[jobIndex].detailsFetched = true;

          chrome.storage.local.set({ [STORAGE_KEY]: jobs }, () => {
            storedJobs = jobs;
            displayRecords(searchInput.value);

            if (isFetchingDetails) {
              currentDetailsIndex++;
              const percent = Math.round((currentDetailsIndex / detailsQueue.length) * 100);
              progressBar.style.width = `${percent}%`;
              progressText.textContent = `${currentDetailsIndex} / ${detailsQueue.length} details`;

              if (currentDetailsIndex < detailsQueue.length) {
                setTimeout(() => processNextDetail(), 1500);
              } else {
                finishDetailsFetching();
              }
            }
          });
        }
      });
    }
  });

  function fetchDetails() {
    if (isFetchingDetails) return;
    const jobsToFetch = storedJobs.map((job, index) => ({ job, index })).filter(item => !item.job.detailsFetched);
    if (jobsToFetch.length === 0) {
      if (confirm('All jobs already have details. Re-fetch for all jobs?')) {
        detailsQueue = storedJobs.map((job, index) => ({ job, index }));
      } else return;
    } else {
      if (!confirm(`Fetch details for ${jobsToFetch.length} jobs by opening each job page. Continue?`)) return;
      detailsQueue = jobsToFetch;
    }
    currentDetailsIndex = 0;
    isFetchingDetails = true;
    fetchDetailsBtn.disabled = true;
    fetchDetailsBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg> Fetching Details...';
    progressSection.classList.remove('hidden');
    progressBar.style.width = '0%';
    progressText.textContent = `0 / ${detailsQueue.length} details`;
    processNextDetail();
  }

  function processNextDetail() {
    if (currentDetailsIndex >= detailsQueue.length) { finishDetailsFetching(); return; }
    const { job, index } = detailsQueue[currentDetailsIndex];
    chrome.runtime.sendMessage({ action: 'fetchJobDetails', url: job.link, jobIndex: index });
  }

  function finishDetailsFetching() {
    isFetchingDetails = false;
    fetchDetailsBtn.disabled = false;
    fetchDetailsBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg> Fetch Details';
    progressSection.classList.add('hidden');
    detailsQueue = [];
    currentDetailsIndex = 0;
    alert('Details fetching completed!');
  }

  fetchDetailsBtn.addEventListener('click', fetchDetails);

  // ==================== WEBHOOK FUNCTIONS ====================

  function loadWebhooks() { chrome.storage.local.get(['laaserWebhook'], (r) => { webhooks = r.laaserWebhook || []; renderWebhooks(); }); }
  function saveWebhooks() { chrome.storage.local.set({ laaserWebhook: webhooks }); }
  function renderWebhooks() {
    if (webhooks.length === 0) { webhooksList.innerHTML = '<div class="no-webhooks">No webhooks configured</div>'; return; }
    webhooksList.innerHTML = webhooks.map(w => `
      <div class="webhook-item ${w.enabled ? '' : 'disabled'}" data-id="${w.id}">
        <div class="webhook-status ${w.enabled ? '' : 'inactive'}"></div>
        <span class="webhook-name" title="${w.url}">${w.name}</span>
        <div class="webhook-actions">
          <button class="webhook-btn edit" data-id="${w.id}" title="Edit"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>
          <button class="webhook-btn delete" data-id="${w.id}" title="Delete"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
        </div>
      </div>`).join('');
    webhooksList.querySelectorAll('.webhook-btn.edit').forEach(btn => btn.addEventListener('click', (e) => editWebhook(e.currentTarget.dataset.id)));
    webhooksList.querySelectorAll('.webhook-btn.delete').forEach(btn => btn.addEventListener('click', (e) => deleteWebhook(e.currentTarget.dataset.id)));
  }
  function openAddWebhookModal() { webhookModalTitle.textContent = 'Add Webhook'; webhookForm.reset(); webhookIdInput.value = ''; webhookEnabledInput.checked = true; webhookModal.classList.remove('hidden'); }
  function editWebhook(id) { const w = webhooks.find(x => x.id === id); if (!w) return; webhookModalTitle.textContent = 'Edit Webhook'; webhookIdInput.value = w.id; webhookNameInput.value = w.name; webhookUrlInput.value = w.url; webhookEnabledInput.checked = w.enabled; webhookModal.classList.remove('hidden'); }
  function deleteWebhook(id) { const w = webhooks.find(x => x.id === id); if (w && confirm(`Delete "${w.name}"?`)) { webhooks = webhooks.filter(x => x.id !== id); saveWebhooks(); renderWebhooks(); } }
  function closeWebhookModalFn() { webhookModal.classList.add('hidden'); webhookForm.reset(); }
  function saveWebhookHandler(e) {
    e.preventDefault();
    const id = webhookIdInput.value || Date.now().toString();
    const name = webhookNameInput.value.trim();
    const url = webhookUrlInput.value.trim();
    if (!name || !url) { alert('Fill in all fields'); return; }
    const data = { id, name, url, enabled: webhookEnabledInput.checked };
    const idx = webhooks.findIndex(w => w.id === id);
    if (idx >= 0) webhooks[idx] = data; else webhooks.push(data);
    saveWebhooks(); renderWebhooks(); closeWebhookModalFn();
  }
  function sendWebhookRequest(url, payload) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'sendWebhook', url, payload }, (response) => {
        resolve(response || { success: false, error: 'No response' });
      });
    });
  }

  async function sendToWebhooks() {
    const enabledWebhooks = webhooks.filter(w => w.enabled);
    if (enabledWebhooks.length === 0) { showResultsModal('Warning', 'No enabled webhooks.', 'warning'); return; }
    if (storedJobs.length === 0) { showResultsModal('Warning', 'No records to send.', 'warning'); return; }
    const BATCH_SIZE = 50;
    const totalBatches = Math.ceil(storedJobs.length / BATCH_SIZE);
    if (!confirm(`Send ${storedJobs.length} records in ${totalBatches} batch(es) to ${enabledWebhooks.length} webhook(s)?`)) return;

    sendToWebhooksBtn.disabled = true;
    sendToWebhooksBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><circle cx="12" cy="12" r="10"></circle></svg> Sending...';
    progressSection.classList.remove('hidden');
    progressBar.style.width = '0%';

    const jobsPayload = storedJobs.map(job => ({
      parent_client: PARENT_CLIENT_NAME, job_id: job.jobId || '', job_title: job.title || '',
      job_type: job.jobType || '', salary: job.salary || '', hospital: job.hospitalName || '',
      city: job.city || '', state: job.state || '', position: job.position || '',
      area_of_practice: job.areaOfPractice || '', description: job.description || '', link: job.link || ''
    }));

    const batches = [];
    for (let i = 0; i < jobsPayload.length; i += BATCH_SIZE) batches.push(jobsPayload.slice(i, i + BATCH_SIZE));
    const allResults = [];
    const syncId = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);

    for (let bi = 0; bi < batches.length; bi++) {
      const payload = {
        source: SOURCE_NAME, parentClientName: PARENT_CLIENT_NAME, syncId,
        timestamp: new Date().toISOString(), batchNumber: bi + 1, totalBatches,
        batchSize: batches[bi].length, totalRecords: storedJobs.length, data: batches[bi]
      };
      for (const wh of enabledWebhooks) {
        const res = await sendWebhookRequest(wh.url, payload);
        allResults.push({ name: wh.name, batch: bi + 1, ...res });
      }
      progressBar.style.width = `${Math.round(((bi + 1) / totalBatches) * 100)}%`;
      progressText.textContent = `${bi + 1} / ${totalBatches} batches`;
      if (bi < batches.length - 1) await new Promise(r => setTimeout(r, 500));
    }

    progressSection.classList.add('hidden');
    const ok = allResults.filter(r => r.success).length;
    const fail = allResults.filter(r => !r.success).length;
    let msg = `Sync ID: ${syncId}\nRecords: ${storedJobs.length}\nBatches: ${totalBatches}\nSuccess: ${ok} | Failed: ${fail}`;
    showResultsModal(fail === 0 ? 'Success' : 'Partial Success', msg, fail === 0 ? 'success' : 'warning');
    sendToWebhooksBtn.disabled = false;
    sendToWebhooksBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg> Send to Webhooks';
  }

  addWebhookBtn.addEventListener('click', openAddWebhookModal);
  closeWebhookModal.addEventListener('click', closeWebhookModalFn);
  cancelWebhook.addEventListener('click', closeWebhookModalFn);
  webhookForm.addEventListener('submit', saveWebhookHandler);
  sendToWebhooksBtn.addEventListener('click', sendToWebhooks);
  webhookModal.addEventListener('click', (e) => { if (e.target === webhookModal) closeWebhookModalFn(); });

  displayRecords();
  loadWebhooks();
});
