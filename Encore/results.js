// Encore Vet Job Scraper - Results Page Script

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const jobsTable        = document.getElementById('jobs-table');
  const jobsTbody        = document.getElementById('jobs-tbody');
  const noData           = document.getElementById('no-data');
  const totalCount       = document.getElementById('total-count');
  const selectedCount    = document.getElementById('selected-count');
  const duplicateCount   = document.getElementById('duplicate-count');
  const searchInput      = document.getElementById('search-input');
  const filterSelect     = document.getElementById('filter-select');
  const selectAllCheckbox = document.getElementById('select-all-checkbox');

  // Buttons
  const selectAllBtn      = document.getElementById('select-all-btn');
  const deselectAllBtn    = document.getElementById('deselect-all-btn');
  const selectDuplicatesBtn = document.getElementById('select-duplicates-btn');
  const getDescriptionsBtn  = document.getElementById('get-descriptions-btn');
  const exportCsvBtn        = document.getElementById('export-csv-btn');
  const deleteSelectedBtn   = document.getElementById('delete-selected-btn');
  const toggleWebhookBtn    = document.getElementById('toggle-webhook');
  const saveWebhookBtn      = document.getElementById('save-webhook-btn');
  const sendWebhookBtn      = document.getElementById('send-webhook-btn');
  const fetchDetailsBtn     = document.getElementById('fetch-details-btn');
  const fetchAddressBtn     = document.getElementById('fetch-address-btn');

  // Webhook
  const webhookConfig    = document.getElementById('webhook-config');
  const webhookUrlInput  = document.getElementById('webhook-url');
  const parentClientInput = document.getElementById('parent-client');

  // Progress
  const progressBar    = document.getElementById('progress-bar');
  const progressLabel  = document.getElementById('progress-label');
  const progressDetail = document.getElementById('progress-detail');
  const progressFill   = document.getElementById('progress-fill');

  // Modal
  const modal      = document.getElementById('modal');
  const modalTitle = document.getElementById('modal-title');
  const modalBody  = document.getElementById('modal-body');
  const modalClose = document.getElementById('modal-close');

  let jobs = [];
  let filteredJobs = [];
  let selectedIds = new Set();
  let duplicateIds = new Set();
  let isGettingDescriptions = false;
  let isFetchingDetails = false;
  let isFetchingAddress = false;
  let currentJobIndex = 0;
  let detailsQueue = [];
  let addressQueue = [];
  let currentDetailsIndex = 0;
  let currentAddressIndex = 0;

  // Initialize
  init();

  async function init() {
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

    if (stored.encoreWebhook)      webhookUrlInput.value   = stored.encoreWebhook;
    if (stored.encoreParentClient) parentClientInput.value = stored.encoreParentClient;
  }

  // ─── Duplicate detection ───────────────────────────────────────────────────
  function detectDuplicates() {
    duplicateIds.clear();
    const seen = new Map();
    jobs.forEach((job, index) => {
      const key = job.reqId || job.link;
      if (seen.has(key)) {
        duplicateIds.add(index);
        duplicateIds.add(seen.get(key));
      } else {
        seen.set(key, index);
      }
    });
  }

  // ─── Filter ────────────────────────────────────────────────────────────────
  function filterJobs() {
    const term = searchInput.value.toLowerCase();
    const fv   = filterSelect.value;

    filteredJobs = jobs.filter((job, index) => {
      const matchesSearch = !term ||
        (job.title       || '').toLowerCase().includes(term) ||
        (job.reqId       || '').toLowerCase().includes(term) ||
        (job.hospitalName|| '').toLowerCase().includes(term) ||
        (job.city        || '').toLowerCase().includes(term) ||
        (job.state       || '').toLowerCase().includes(term) ||
        (job.category    || '').toLowerCase().includes(term) ||
        (job.position    || '').toLowerCase().includes(term);

      let matchesFilter = true;
      if (fv === 'duplicates')      matchesFilter = duplicateIds.has(index);
      else if (fv === 'unique')     matchesFilter = !duplicateIds.has(index);
      else if (fv === 'no-details') matchesFilter = !job.detailsFetched;
      else if (fv === 'no-description') matchesFilter = !job.description || job.description.trim() === '';

      return matchesSearch && matchesFilter;
    });
  }

  // ─── Render table ──────────────────────────────────────────────────────────
  function renderTable() {
    jobsTbody.innerHTML = '';

    if (filteredJobs.length === 0) {
      noData.classList.remove('hidden');
      jobsTable.classList.add('hidden');
      return;
    }

    noData.classList.add('hidden');
    jobsTable.classList.remove('hidden');

    filteredJobs.forEach((job) => {
      const originalIndex = jobs.indexOf(job);
      const isDuplicate = duplicateIds.has(originalIndex);
      const isSelected  = selectedIds.has(originalIndex);
      const hasDesc     = job.description && job.description.trim() !== '';

      const tr = document.createElement('tr');
      tr.className = (isDuplicate ? 'duplicate ' : '') + (isSelected ? 'selected' : '');
      tr.dataset.index = originalIndex;

      tr.innerHTML = `
        <td class="col-checkbox">
          <input type="checkbox" class="job-checkbox" data-index="${originalIndex}" ${isSelected ? 'checked' : ''}>
        </td>
        <td class="col-status">
          ${isDuplicate
            ? '<span class="badge badge-duplicate">Duplicate</span>'
            : '<span class="badge badge-unique">Unique</span>'}
        </td>
        <td class="col-jobid">${escapeHtml(job.jobId || 'N/A')}</td>
        <td class="col-title">
          <a href="${job.link}" target="_blank">${escapeHtml(job.title)}</a>
        </td>
        <td class="col-reqid">${escapeHtml(job.reqId)}</td>
        <td class="col-position">${escapeHtml(job.position || 'N/A')}</td>
        <td class="col-aop">${escapeHtml(job.areaOfPractice || 'N/A')}</td>
        <td class="col-salary">${escapeHtml(job.salary || 'N/A')}</td>
        <td class="col-jobtype">${escapeHtml(job.jobType || 'N/A')}</td>
        <td class="col-hospital">${escapeHtml(job.hospitalName)}</td>
        <td class="col-city">${escapeHtml(job.city || 'N/A')}</td>
        <td class="col-state">${escapeHtml(job.state || 'N/A')}</td>
        <td class="col-address">${escapeHtml(job.streetAddress || 'N/A')}</td>
        <td class="col-zip">${escapeHtml(job.postalCode || 'N/A')}</td>
        <td class="col-phone">${escapeHtml(job.phone || 'N/A')}</td>
        <td class="col-category">${escapeHtml(job.category)}</td>
        <td class="col-description">
          ${hasDesc
            ? `<span class="description-preview" title="${escapeHtml(job.description.substring(0, 200))}">${escapeHtml(job.description.substring(0, 50))}...</span>`
            : '<span class="badge badge-missing">Missing</span>'}
        </td>
        <td class="col-actions">
          <button class="btn btn-sm view-btn" data-index="${originalIndex}">View</button>
        </td>
      `;

      jobsTbody.appendChild(tr);
    });

    // Checkbox listeners
    document.querySelectorAll('.job-checkbox').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.index);
        if (e.target.checked) selectedIds.add(idx); else selectedIds.delete(idx);
        updateStats();
        renderTable();
      });
    });

    // View button listeners
    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', (e) => showJobDetails(jobs[parseInt(e.target.dataset.index)]));
    });
  }

  // ─── Stats ─────────────────────────────────────────────────────────────────
  function updateStats() {
    totalCount.textContent     = `Total: ${jobs.length}`;
    selectedCount.textContent  = `Selected: ${selectedIds.size}`;
    duplicateCount.textContent = `Duplicates: ${duplicateIds.size}`;
  }

  // ─── Modal ─────────────────────────────────────────────────────────────────
  function showJobDetails(job) {
    modalTitle.textContent = job.title;
    modalBody.innerHTML = `
      <div class="detail-row"><span class="detail-label">Job ID:</span><span class="detail-value">${escapeHtml(job.jobId || 'N/A')}</span></div>
      <div class="detail-row"><span class="detail-label">Req ID:</span><span class="detail-value">${escapeHtml(job.reqId)}</span></div>
      <div class="detail-row"><span class="detail-label">Position:</span><span class="detail-value">${escapeHtml(job.position || 'N/A')}</span></div>
      <div class="detail-row"><span class="detail-label">Area of Practice:</span><span class="detail-value">${escapeHtml(job.areaOfPractice || 'N/A')}</span></div>
      <div class="detail-row"><span class="detail-label">Salary:</span><span class="detail-value">${escapeHtml(job.salary || 'N/A')}</span></div>
      <div class="detail-row"><span class="detail-label">Job Type:</span><span class="detail-value">${escapeHtml(job.jobType || 'N/A')}</span></div>
      <div class="detail-row"><span class="detail-label">Hospital:</span><span class="detail-value">${escapeHtml(job.hospitalName)}</span></div>
      <div class="detail-row"><span class="detail-label">Address:</span><span class="detail-value">${escapeHtml(job.streetAddress)}</span></div>
      <div class="detail-row"><span class="detail-label">City:</span><span class="detail-value">${escapeHtml(job.city)}</span></div>
      <div class="detail-row"><span class="detail-label">State:</span><span class="detail-value">${escapeHtml(job.state)}</span></div>
      <div class="detail-row"><span class="detail-label">Postal Code:</span><span class="detail-value">${escapeHtml(job.postalCode || 'N/A')}</span></div>
      <div class="detail-row"><span class="detail-label">Phone:</span><span class="detail-value">${escapeHtml(job.phone || 'N/A')}</span></div>
      <div class="detail-row"><span class="detail-label">Category:</span><span class="detail-value">${escapeHtml(job.category)}</span></div>
      <div class="detail-row"><span class="detail-label">Link:</span><span class="detail-value"><a href="${job.link}" target="_blank">${escapeHtml(job.link)}</a></span></div>
      <h4 style="margin-top:20px;margin-bottom:10px;">Description</h4>
      <div class="description-full">${job.description ? escapeHtml(job.description) : 'No description available'}</div>
    `;
    modal.classList.remove('hidden');
  }

  modalClose.addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });

  // ─── Search / Filter ───────────────────────────────────────────────────────
  searchInput.addEventListener('input', () => { filterJobs(); renderTable(); });
  filterSelect.addEventListener('change', () => { filterJobs(); renderTable(); });

  // ─── Select all checkbox ───────────────────────────────────────────────────
  selectAllCheckbox.addEventListener('change', (e) => {
    filteredJobs.forEach(job => {
      const i = jobs.indexOf(job);
      if (e.target.checked) selectedIds.add(i); else selectedIds.delete(i);
    });
    updateStats();
    renderTable();
  });

  selectAllBtn.addEventListener('click', () => {
    jobs.forEach((_, i) => selectedIds.add(i));
    updateStats(); renderTable();
  });

  deselectAllBtn.addEventListener('click', () => {
    selectedIds.clear();
    updateStats(); renderTable();
  });

  selectDuplicatesBtn.addEventListener('click', () => {
    duplicateIds.forEach(id => selectedIds.add(id));
    updateStats(); renderTable();
  });

  // ─── Delete selected ───────────────────────────────────────────────────────
  deleteSelectedBtn.addEventListener('click', async () => {
    if (selectedIds.size === 0) { alert('No jobs selected'); return; }
    if (!confirm(`Delete ${selectedIds.size} selected job(s)?`)) return;
    jobs = jobs.filter((_, i) => !selectedIds.has(i));
    selectedIds.clear();
    await chrome.storage.local.set({ encoreJobs: jobs });
    detectDuplicates(); filterJobs(); renderTable(); updateStats();
  });

  // ─── Get Descriptions ──────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'descriptionSaved') {
      chrome.storage.local.get(['encoreJobs'], (result) => {
        jobs = result.encoreJobs || [];
        detectDuplicates(); filterJobs(); renderTable(); updateStats();

        const total    = jobs.length;
        const withDesc = jobs.filter(j => j.description && j.description.trim() !== '').length;
        progressFill.style.width = `${Math.round((withDesc / total) * 100)}%`;
        progressDetail.textContent = `${withDesc} / ${total}`;

        if (isGettingDescriptions) setTimeout(() => processNextDescription(), 1500);
      });
    }
  });

  function processNextDescription() {
    chrome.storage.local.get(['encoreJobs'], (result) => {
      jobs = result.encoreJobs || [];
      let found = -1;
      for (let i = 0; i < jobs.length; i++) {
        if (!jobs[i].description || jobs[i].description.trim() === '') { found = i; break; }
      }
      if (found === -1) {
        isGettingDescriptions = false;
        getDescriptionsBtn.textContent = 'Get Descriptions';
        getDescriptionsBtn.disabled = false;
        progressBar.classList.add('hidden');
        alert('All jobs have descriptions!');
        return;
      }
      const job = jobs[found];
      const withDesc = jobs.filter(j => j.description && j.description.trim() !== '').length;
      progressFill.style.width = `${Math.round((withDesc / jobs.length) * 100)}%`;
      progressDetail.textContent = `${withDesc} / ${jobs.length}`;

      chrome.tabs.create({ url: job.link, active: false }, (tab) => {
        chrome.runtime.sendMessage({ action: 'scrapeJobDescription', tabId: tab.id, jobIndex: found, jobLink: job.link });
      });
    });
  }

  getDescriptionsBtn.addEventListener('click', () => {
    if (jobs.length === 0) { alert('No jobs to get descriptions for.'); return; }
    const missing = jobs.filter(j => !j.description || j.description.trim() === '');
    if (missing.length === 0) { alert('All jobs already have descriptions!'); return; }
    if (!confirm(`Fetch descriptions for ${missing.length} jobs. Continue?`)) return;
    isGettingDescriptions = true;
    getDescriptionsBtn.disabled = true;
    getDescriptionsBtn.textContent = 'Processing...';
    progressBar.classList.remove('hidden');
    const withDesc = jobs.filter(j => j.description && j.description.trim() !== '').length;
    progressFill.style.width = `${Math.round((withDesc / jobs.length) * 100)}%`;
    progressLabel.textContent = 'Fetching descriptions...';
    progressDetail.textContent = `${withDesc} / ${jobs.length}`;
    processNextDescription();
  });

  // ─── Export CSV ────────────────────────────────────────────────────────────
  exportCsvBtn.addEventListener('click', () => {
    const toExport = selectedIds.size > 0 ? jobs.filter((_, i) => selectedIds.has(i)) : jobs;
    if (toExport.length === 0) { alert('No jobs to export'); return; }

    const headers = [
      'Title','Job ID','Req ID','Position','Area of Practice','Salary','Job Type',
      'Hospital Name','City','State','Street Address','Postal Code','Phone',
      'Country','Category','Link','Description'
    ];
    const rows = toExport.map(job => [
      job.title, job.jobId || '', job.reqId,
      job.position || '', job.areaOfPractice || '', job.salary || '', job.jobType || '',
      job.hospitalName, job.city, job.state, job.streetAddress, job.postalCode || '', job.phone || '',
      job.country, job.category, job.link,
      (job.description || '').replace(/[\r\n]+/g, ' ')
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${(cell || '').replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `encore-vet-jobs-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // ─── Webhook ───────────────────────────────────────────────────────────────
  toggleWebhookBtn.addEventListener('click', () => webhookConfig.classList.toggle('hidden'));

  saveWebhookBtn.addEventListener('click', async () => {
    await chrome.storage.local.set({ encoreWebhook: webhookUrlInput.value, encoreParentClient: parentClientInput.value });
    alert('Webhook configuration saved');
  });

  sendWebhookBtn.addEventListener('click', async () => {
    const webhookUrl  = webhookUrlInput.value;
    const parentClient = parentClientInput.value;
    if (!webhookUrl) { alert('Please enter a webhook URL'); return; }

    const toSend = selectedIds.size > 0 ? jobs.filter((_, i) => selectedIds.has(i)) : jobs;
    if (toSend.length === 0) { alert('No jobs to send'); return; }

    const BATCH_SIZE  = 50;
    const totalBatches = Math.ceil(toSend.length / BATCH_SIZE);
    if (!confirm(`Send ${toSend.length} job(s) in ${totalBatches} batch(es) to webhook?`)) return;

    progressBar.classList.remove('hidden');
    sendWebhookBtn.disabled = true;
    const syncId = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    let successCount = 0, errorCount = 0;

    const mapped = toSend.map(job => ({
      parent_client: parentClient,
      job_id: job.jobId || '', req_id: job.reqId || '',
      job_title: job.title || '', position: job.position || '',
      area_of_practice: job.areaOfPractice || '', salary: job.salary || '',
      job_type: job.jobType || '', hospital: job.hospitalName || '',
      city: job.city || '', state: job.state || '',
      address: job.streetAddress || '', zip_code: job.postalCode || '',
      phone: job.phone || '', country: job.country || 'USA',
      category: job.category || '', link: job.link || '',
      description: job.description || ''
    }));

    const batches = [];
    for (let i = 0; i < mapped.length; i += BATCH_SIZE) batches.push(mapped.slice(i, i + BATCH_SIZE));

    for (let bi = 0; bi < batches.length; bi++) {
      progressLabel.textContent  = 'Sending to webhook...';
      progressDetail.textContent = `Batch ${bi + 1} / ${totalBatches}`;
      progressFill.style.width   = `${Math.round(((bi + 1) / totalBatches) * 100)}%`;
      try {
        const res = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: 'Encore Vet Job Scraper', parentClientName: parentClient, syncId, timestamp: new Date().toISOString(), batchNumber: bi + 1, totalBatches, batchSize: batches[bi].length, totalRecords: toSend.length, data: batches[bi] })
        });
        if (res.ok) successCount++; else errorCount++;
      } catch (e) { errorCount++; }
      if (bi < batches.length - 1) await new Promise(r => setTimeout(r, 500));
    }

    progressBar.classList.add('hidden');
    sendWebhookBtn.disabled = false;
    alert(`Webhook Complete!\nSync ID: ${syncId}\nTotal: ${toSend.length}\nBatches: ${totalBatches}\nSuccess: ${successCount} | Failed: ${errorCount}`);
  });

  // ─── FETCH DETAILS ─────────────────────────────────────────────────────────

  // Receive detail results from background.js
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action !== 'detailsFetched') return;
    const details  = request.details || {};
    const jobIndex = request.jobIndex;

    chrome.storage.local.get(['encoreJobs'], (result) => {
      const allJobs = result.encoreJobs || [];
      if (allJobs[jobIndex]) {
        const job = allJobs[jobIndex];

        // Update all fields from detail page — window.jobDescriptionConfig.job is
        // the authoritative API source; it has better data than the listing card.
        // Only overwrite if detail has a value (preserve listing-card data if detail is empty).
        if (details.postalCode)     job.postalCode     = details.postalCode;
        if (details.jobType)        job.jobType        = details.jobType;
        if (details.salary)         job.salary         = details.salary;
        if (details.position)       job.position       = details.position;
        if (details.areaOfPractice) job.areaOfPractice = details.areaOfPractice;
        if (details.hospitalName)   job.hospitalName   = details.hospitalName;
        if (details.streetAddress)  job.streetAddress  = details.streetAddress;
        if (details.city)           job.city           = details.city;
        if (details.state)          job.state          = details.state;
        if (details.category)       job.category       = details.category;

        job.detailsFetched = true;

        chrome.storage.local.set({ encoreJobs: allJobs }, () => {
          jobs = allJobs;
          detectDuplicates(); filterJobs(); renderTable(); updateStats();

          if (isFetchingDetails) {
            currentDetailsIndex++;
            progressDetail.textContent = `${currentDetailsIndex} / ${detailsQueue.length}`;
            progressFill.style.width   = `${Math.round((currentDetailsIndex / detailsQueue.length) * 100)}%`;

            if (currentDetailsIndex < detailsQueue.length) {
              setTimeout(() => processNextDetail(), 1500);
            } else {
              finishDetailsFetching();
            }
          }
        });
      }
    });
  });

  function startFetchDetails(queue) {
    if (queue.length === 0) { alert('No jobs to fetch details for.'); return; }
    detailsQueue       = queue;
    currentDetailsIndex = 0;
    isFetchingDetails   = true;
    fetchDetailsBtn.disabled = true;
    fetchDetailsBtn.textContent = 'Fetching Details...';
    progressBar.classList.remove('hidden');
    progressLabel.textContent  = 'Fetching details...';
    progressDetail.textContent = `0 / ${detailsQueue.length}`;
    progressFill.style.width   = '0%';
    processNextDetail();
  }

  function processNextDetail() {
    if (currentDetailsIndex >= detailsQueue.length) { finishDetailsFetching(); return; }
    const { job, index } = detailsQueue[currentDetailsIndex];
    chrome.runtime.sendMessage({
      action: 'fetchJobDetails',
      url: job.link,
      jobIndex: index,
      jobTitle: job.title,
      jobCategory: job.category
    });
  }

  function finishDetailsFetching() {
    isFetchingDetails = false;
    fetchDetailsBtn.disabled = false;
    fetchDetailsBtn.textContent = 'Fetch Details';
    progressBar.classList.add('hidden');
    detailsQueue = []; currentDetailsIndex = 0;
    alert('Details fetching completed!');
  }

  fetchDetailsBtn.addEventListener('click', () => {
    if (isFetchingDetails) return;

    // If rows are selected, fetch only those; otherwise fetch all without details
    let queue;
    if (selectedIds.size > 0) {
      queue = [...selectedIds].map(i => ({ job: jobs[i], index: i })).filter(({ job }) => job);
    } else {
      // Fetch jobs that either: have never been fetched, OR were fetched but are missing salary
      queue = jobs.map((job, i) => ({ job, index: i })).filter(({ job }) => !job.detailsFetched || !job.salary);
    }

    if (queue.length === 0) {
      if (confirm('All jobs already have details and salary. Re-fetch for all jobs?')) {
        queue = jobs.map((job, i) => ({ job, index: i }));
      } else return;
    }

    if (!confirm(`Fetch details for ${queue.length} jobs by opening each job page. Continue?`)) return;
    startFetchDetails(queue);
  });

  // ─── FETCH ADDRESS (Phone via Google Maps) ─────────────────────────────────

  // Shared "save phone result and advance queue" logic.
  // Called both from the background message handler (real Maps lookup)
  // AND directly from processNextAddress when deduplication fires.
  // Must NOT use chrome.runtime.sendMessage to itself — pages cannot receive
  // their own messages, which would freeze the queue silently.
  function savePhoneAndAdvance(jobIndex, phone) {
    chrome.storage.local.get(['encoreJobs'], (result) => {
      const allJobs = result.encoreJobs || [];
      if (allJobs[jobIndex]) {
        if (phone) allJobs[jobIndex].phone = phone;
        allJobs[jobIndex].addressFetched = true;

        chrome.storage.local.set({ encoreJobs: allJobs }, () => {
          jobs = allJobs;
          detectDuplicates(); filterJobs(); renderTable(); updateStats();

          if (isFetchingAddress) {
            currentAddressIndex++;
            progressDetail.textContent = `${currentAddressIndex} / ${addressQueue.length}`;
            progressFill.style.width   = `${Math.round((currentAddressIndex / addressQueue.length) * 100)}%`;

            if (currentAddressIndex < addressQueue.length) {
              // Short delay for dedup path; normal 1.5 s delay for Maps path
              const delay = phone ? 300 : 1500;
              setTimeout(() => processNextAddress(), delay);
            } else {
              finishAddressFetching();
            }
          }
        });
      }
    });
  }

  // Listen for real Maps results sent by background.js
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action !== 'addressFetched') return;
    savePhoneAndAdvance(request.jobIndex, request.phone || '');
  });

  function startFetchAddresses(queue) {
    if (queue.length === 0) { alert('No jobs to fetch addresses for.'); return; }
    addressQueue        = queue;
    currentAddressIndex = 0;
    isFetchingAddress   = true;
    fetchAddressBtn.disabled = true;
    fetchAddressBtn.textContent = 'Fetching Phones...';
    progressBar.classList.remove('hidden');
    progressLabel.textContent  = 'Fetching phone numbers...';
    progressDetail.textContent = `0 / ${addressQueue.length}`;
    progressFill.style.width   = '0%';
    processNextAddress();
  }

  function processNextAddress() {
    if (currentAddressIndex >= addressQueue.length) { finishAddressFetching(); return; }
    const { job, index } = addressQueue[currentAddressIndex];

    // Skip jobs that lack the minimum location data needed to do a meaningful Maps lookup.
    // Without at least a hospital name AND (city or state), we cannot find the right place.
    if (!job.hospitalName || (!job.city && !job.state)) {
      savePhoneAndAdvance(index, ''); // mark as attempted, move on
      return;
    }

    // Deduplication: if another job at the same hospital OUTSIDE the current queue
    // already has a phone, copy it directly (saves a Maps lookup).
    // IMPORTANT: exclude jobs that are IN the current queue — if we're re-fetching a
    // group of same-hospital jobs because the old number was wrong, we must not copy
    // the wrong number from one queued sibling to another. Only copy from jobs that
    // are NOT being re-fetched (i.e., already resolved and trusted).
    // Also: call savePhoneAndAdvance() directly — pages cannot receive their own messages.
    const queueIndices = new Set(addressQueue.map(item => item.index));
    const existing = jobs.find((j, ji) =>
      j.hospitalName &&
      j.hospitalName === job.hospitalName &&
      j.phone &&
      ji !== index &&
      !queueIndices.has(ji)   // only trust phones from jobs NOT in the current queue
    );
    if (existing) {
      savePhoneAndAdvance(index, existing.phone);
      return;
    }

    // Clean street address for Maps search:
    // Strip suite/unit suffixes like "#1249", "Suite 200", "Apt 3B" — these
    // confuse Google Maps and can cause it to match the wrong location.
    const streetClean = (job.streetAddress || '')
      .replace(/\s*[,#]\s*(?:suite|ste\.?|apt\.?|unit|floor|fl\.?)?\s*[\w-]+\s*$/i, '')
      .replace(/\s*#[\w-]+\s*$/i, '')   // fallback: strip any trailing "#XYZ"
      .trim();

    // Build search query with full address for maximum Maps precision.
    // Format: "Hospital Name, Street Address, City, State ZIP"
    // Comma-delimited = standard Google Maps address format; also lets the
    // scraper extract the hospital name (first segment) for result-list matching.
    const searchQuery = [
      job.hospitalName,
      streetClean || null,
      job.city,
      job.state,
      job.postalCode && job.postalCode !== 'N/A' ? job.postalCode : null
    ].filter(Boolean).join(', ');
    chrome.runtime.sendMessage({ action: 'fetchAddress', jobIndex: index, searchQuery });
  }

  function finishAddressFetching() {
    isFetchingAddress = false;
    fetchAddressBtn.disabled = false;
    fetchAddressBtn.textContent = 'Fetch Address (Phone)';
    progressBar.classList.add('hidden');
    addressQueue = []; currentAddressIndex = 0;
    alert('Phone fetching completed!');
  }

  fetchAddressBtn.addEventListener('click', () => {
    if (isFetchingAddress) return;

    let queue;
    if (selectedIds.size > 0) {
      queue = [...selectedIds].map(i => ({ job: jobs[i], index: i })).filter(({ job }) => job);
    } else {
      queue = jobs.map((job, i) => ({ job, index: i })).filter(({ job }) => !job.addressFetched);
    }

    if (queue.length === 0) {
      if (confirm('All jobs already have phone numbers. Re-fetch for all?')) {
        queue = jobs.map((job, i) => ({ job, index: i }));
      } else return;
    }

    if (!confirm(`Fetch phone numbers for ${queue.length} jobs via Google Maps. Continue?`)) return;
    startFetchAddresses(queue);
  });

  // ─── Escape HTML ───────────────────────────────────────────────────────────
  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
});
