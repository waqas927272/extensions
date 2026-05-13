document.addEventListener('DOMContentLoaded', () => {
  const tableBody = document.querySelector('#jobRecordsTable tbody');
  const tableHeaders = document.querySelectorAll('#jobRecordsTable th[data-sort]');
  const clearRecordsButton = document.getElementById('clearRecords');
  const clearDescriptionsButton = document.getElementById('clearDescriptions');
  const clearDetailsButton = document.getElementById('clearDetailsBtn');
  const webhookUrlInput = document.getElementById('webhookUrl');
  const sendToWebhookButton = document.getElementById('sendToWebhook');
  const totalCountElement = document.getElementById('totalCount');
  const emptyState = document.getElementById('emptyState');
  const table = document.getElementById('jobRecordsTable');
  const searchInput = document.getElementById('searchInput');
  const exportCsvButton = document.getElementById('exportCsv');
  const getDescriptionsBtn = document.getElementById('getDescriptionsBtn');
  const fetchDetailsBtn = document.getElementById('fetchDetailsBtn');

  let allJobs = [];
  let filteredJobs = [];
  let currentSortColumn = null;
  let currentSortDirection = 'asc';
  let isGettingDescriptions = false;
  let isFetchingDetails = false;
  let currentJobIndex = 0;
  let detailsQueue = [];
  let currentDetailsIndex = 0;

  loadWebhookUrl();
  loadRecords();

  searchInput.addEventListener('input', () => {
    applySearch();
    displayRecords(filteredJobs);
  });

  tableHeaders.forEach(header => {
    header.addEventListener('click', () => sortByColumn(header.dataset.sort, header));
  });

  webhookUrlInput.addEventListener('change', async () => {
    const url = webhookUrlInput.value.trim();
    if (url) {
      await chrome.storage.local.set({ webhookUrl: url });
      showToast('Webhook URL saved!', 'success');
    }
  });

  sendToWebhookButton.addEventListener('click', sendToWebhook);
  exportCsvButton.addEventListener('click', exportCsv);
  clearRecordsButton.addEventListener('click', clearRecords);
  clearDescriptionsButton.addEventListener('click', clearDescriptions);
  clearDetailsButton.addEventListener('click', clearDetails);
  getDescriptionsBtn.addEventListener('click', startGetDescriptions);
  fetchDetailsBtn.addEventListener('click', startFetchDetails);

  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'descriptionSaved') {
      handleDescriptionSaved(request);
    }

    if (request.action === 'detailsFetched') {
      handleDetailsFetched(request);
    }
  });

  async function loadWebhookUrl() {
    const result = await chrome.storage.local.get(['webhookUrl']);
    webhookUrlInput.value = result.webhookUrl || '';
  }

  async function loadRecords() {
    const result = await chrome.storage.local.get(['scrapedJobs', 'jobs']);
    const sourceJobs = result.scrapedJobs || result.jobs || [];
    allJobs = sourceJobs.map(normalizeJob);
    filteredJobs = [...allJobs];
    await chrome.storage.local.set({ scrapedJobs: allJobs, jobs: allJobs });
    displayRecords(filteredJobs);
  }

  function normalizeJob(job) {
    return {
      jobTitle: job.jobTitle || job.title || '',
      title: job.title || job.jobTitle || '',
      jobId: job.jobId || '',
      hospitalName: job.hospitalName || job.hospital || '',
      hospital: job.hospital || job.hospitalName || '',
      location: job.location || '',
      areaOfPractice: job.areaOfPractice || '',
      position: job.position || '',
      salary: job.salary || '',
      jobType: job.jobType || job.employmentType || '',
      link: job.link || '',
      description: job.description || ''
    };
  }

  function displayRecords(jobs) {
    tableBody.innerHTML = '';
    totalCountElement.textContent = allJobs.length;

    if (allJobs.length === 0) {
      table.classList.add('hidden');
      emptyState.classList.remove('hidden');
      return;
    }

    table.classList.remove('hidden');
    emptyState.classList.add('hidden');

    jobs.forEach((job, index) => {
      const row = document.createElement('tr');
      const hasDescription = Boolean(job.description && job.description.trim());
      const linkHtml = job.link
        ? `<a href="${escapeHtml(job.link)}" target="_blank">Open</a>`
        : '<span style="color:#a0aec0;">N/A</span>';
      const descriptionHtml = hasDescription
        ? `<div class="description-cell">${escapeHtml(job.description)}</div>`
        : '<span style="color:#dd6b20; font-weight:700;">Pending</span>';

      row.innerHTML = `
        <td>${index + 1}</td>
        <td><strong>${escapeHtml(job.jobTitle)}</strong></td>
        <td>${escapeHtml(job.jobId || 'N/A')}</td>
        <td>${escapeHtml(job.hospitalName || '')}</td>
        <td>Innovetive Petcare</td>
        <td>${escapeHtml(job.location || '')}</td>
        <td>${escapeHtml(job.areaOfPractice || '')}</td>
        <td>${escapeHtml(job.position || '')}</td>
        <td>${escapeHtml(job.salary || '')}</td>
        <td>${escapeHtml(job.jobType || '')}</td>
        <td>${linkHtml}</td>
        <td>${descriptionHtml}</td>
      `;
      tableBody.appendChild(row);
    });
  }

  function applySearch() {
    const query = searchInput.value.trim().toLowerCase();
    filteredJobs = allJobs.filter(job => {
      if (!query) return true;
      return [
        job.jobTitle,
        job.jobId,
        job.hospitalName,
        job.location,
        job.areaOfPractice,
        job.position,
        job.salary,
        job.jobType,
        job.link,
        job.description
      ].some(value => String(value || '').toLowerCase().includes(query));
    });

    if (currentSortColumn) {
      sortJobs(filteredJobs, currentSortColumn, currentSortDirection);
    }
  }

  function sortByColumn(column, header) {
    if (currentSortColumn === column) {
      currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      currentSortColumn = column;
      currentSortDirection = 'asc';
    }

    tableHeaders.forEach(th => th.classList.remove('sort-asc', 'sort-desc'));
    header.classList.add(currentSortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
    sortJobs(filteredJobs, column, currentSortDirection);
    displayRecords(filteredJobs);
  }

  function sortJobs(jobs, column, direction) {
    jobs.sort((a, b) => {
      const aValue = String(a[column] || '').toLowerCase();
      const bValue = String(b[column] || '').toLowerCase();
      if (aValue < bValue) return direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return direction === 'asc' ? 1 : -1;
      return 0;
    });
  }

  function startGetDescriptions() {
    if (isGettingDescriptions) {
      showToast('Already getting descriptions. Please wait...', 'error');
      return;
    }

    const missingDescriptions = allJobs.filter(job => !job.description || !job.description.trim());
    if (missingDescriptions.length === 0) {
      showToast('All jobs already have descriptions.', 'success');
      return;
    }

    if (!confirm(`This will fetch descriptions for ${missingDescriptions.length} jobs. Continue?`)) return;

    isGettingDescriptions = true;
    getDescriptionsBtn.disabled = true;
    getDescriptionsBtn.textContent = 'Processing...';
    showProgress('Getting Descriptions', 0, missingDescriptions.length);
    processNextDescription();
  }

  function processNextDescription() {
    const nextIndex = allJobs.findIndex(job => !job.description || !job.description.trim());
    if (nextIndex === -1) {
      finishDescriptions();
      return;
    }

    currentJobIndex = nextIndex;
    const completed = allJobs.filter(job => job.description && job.description.trim()).length;
    updateProgress(completed, allJobs.length);

    chrome.tabs.create({ url: allJobs[currentJobIndex].link, active: false }, (tab) => {
      if (!tab) {
        finishDescriptions();
        return;
      }

      chrome.runtime.sendMessage({
        action: 'scrapeJobDescription',
        tabId: tab.id,
        jobIndex: currentJobIndex,
        jobLink: allJobs[currentJobIndex].link
      });
    });
  }

  async function handleDescriptionSaved(request) {
    const result = await chrome.storage.local.get(['scrapedJobs', 'jobs']);
    allJobs = (result.scrapedJobs || result.jobs || []).map(normalizeJob);
    applySearch();
    displayRecords(filteredJobs);

    const completed = allJobs.filter(job => job.description && job.description.trim()).length;
    updateProgress(completed, allJobs.length);

    if (isGettingDescriptions) {
      setTimeout(processNextDescription, 1200);
    }

    if (request.success === false) {
      showToast('A description could not be fetched.', 'error');
    }
  }

  function finishDescriptions() {
    isGettingDescriptions = false;
    getDescriptionsBtn.disabled = false;
    getDescriptionsBtn.textContent = 'Get Descriptions';
    hideProgress();
    showToast('Descriptions fetched.', 'success');
  }

  async function startFetchDetails() {
    if (isFetchingDetails) {
      showToast('Already fetching details. Please wait...', 'error');
      return;
    }

    const result = await chrome.storage.local.get(['scrapedJobs', 'jobs']);
    allJobs = (result.scrapedJobs || result.jobs || []).map(normalizeJob);
    detailsQueue = allJobs.map((job, index) => ({ job, index }))
      .filter(item => item.job.link && (!item.job.areaOfPractice || !item.job.position || !item.job.salary));

    if (detailsQueue.length === 0) {
      if (!confirm('All jobs already have details. Re-fetch details for all jobs?')) return;
      detailsQueue = allJobs.map((job, index) => ({ job, index })).filter(item => item.job.link);
    }

    if (detailsQueue.length === 0) {
      showToast('No job links are available for detail fetching.', 'error');
      return;
    }

    isFetchingDetails = true;
    currentDetailsIndex = 0;
    fetchDetailsBtn.disabled = true;
    fetchDetailsBtn.textContent = 'Processing...';
    showProgress('Fetching Details', 0, detailsQueue.length);
    processNextDetail();
  }

  function processNextDetail() {
    if (currentDetailsIndex >= detailsQueue.length) {
      finishDetails();
      return;
    }

    const { job, index } = detailsQueue[currentDetailsIndex];
    updateProgress(currentDetailsIndex + 1, detailsQueue.length);
    chrome.runtime.sendMessage({
      action: 'fetchJobDetails',
      url: job.link,
      jobIndex: index
    });
  }

  async function handleDetailsFetched(request) {
    const result = await chrome.storage.local.get(['scrapedJobs', 'jobs']);
    const jobs = (result.scrapedJobs || result.jobs || []).map(normalizeJob);
    const details = request.details || {};

    if (jobs[request.jobIndex]) {
      const job = jobs[request.jobIndex];
      job.areaOfPractice = details.areaOfPractice || job.areaOfPractice || '';
      job.position = details.position || job.position || '';
      job.salary = details.salary || job.salary || '';
      job.hospitalName = details.hospitalName || job.hospitalName || '';
      job.hospital = job.hospitalName;

      if (details.city && details.state) {
        job.location = `${details.city}, ${details.state}`;
      } else if (details.city) {
        job.location = details.city;
      }

      if (details.description && (!job.description || details.description.length > job.description.length)) {
        job.description = details.description;
      }

      await chrome.storage.local.set({ scrapedJobs: jobs, jobs });
      allJobs = jobs;
      applySearch();
      displayRecords(filteredJobs);
    }

    if (isFetchingDetails) {
      currentDetailsIndex++;
      setTimeout(processNextDetail, 1200);
    }
  }

  function finishDetails() {
    isFetchingDetails = false;
    fetchDetailsBtn.disabled = false;
    fetchDetailsBtn.textContent = 'Fetch Details';
    hideProgress();
    showToast(`Details fetched for ${detailsQueue.length} jobs.`, 'success');
  }

  async function sendToWebhook() {
    const webhookUrl = webhookUrlInput.value.trim();
    if (!webhookUrl || !isValidUrl(webhookUrl)) {
      showToast('Please enter a valid webhook URL.', 'error');
      return;
    }

    const jobs = filteredJobs.length ? filteredJobs : allJobs;
    if (jobs.length === 0) {
      showToast('No job records to send.', 'error');
      return;
    }

    const batchSize = 50;
    const batches = [];
    for (let i = 0; i < jobs.length; i += batchSize) {
      batches.push(jobs.slice(i, i + batchSize));
    }

    if (!confirm(`Send ${jobs.length} job(s) in ${batches.length} batch(es) to webhook?`)) return;

    await chrome.storage.local.set({ webhookUrl });
    sendToWebhookButton.disabled = true;
    sendToWebhookButton.textContent = 'Sending...';
    showProgress('Sending to Webhook', 0, batches.length);

    const syncId = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    let successCount = 0;
    let errorCount = 0;

    for (let index = 0; index < batches.length; index++) {
      updateProgress(index + 1, batches.length);

      const payload = {
        source: 'Innovetive Petcare Job Scraper',
        parentClientName: 'Innovetive Petcare',
        syncId,
        timestamp: new Date().toISOString(),
        batchNumber: index + 1,
        totalBatches: batches.length,
        batchSize: batches[index].length,
        totalRecords: jobs.length,
        data: batches[index].map(mapJobForWebhook)
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
        }
      } catch (error) {
        errorCount++;
      }

      if (index < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    sendToWebhookButton.disabled = false;
    sendToWebhookButton.textContent = 'Send to Webhook';
    hideProgress();

    if (errorCount === 0) {
      showToast(`Sent ${jobs.length} jobs in ${batches.length} batch(es).`, 'success');
    } else {
      showToast(`Webhook completed with ${successCount} success and ${errorCount} failed batch(es).`, 'error');
    }
  }

  function mapJobForWebhook(job) {
    return {
      parent_client: 'Innovetive Petcare',
      job_title: job.jobTitle || '',
      job_id: job.jobId || '',
      hospital: job.hospitalName || '',
      aggregator: 'Innovetive Petcare',
      location: job.location || '',
      area_of_practice: job.areaOfPractice || '',
      position: job.position || '',
      salary: job.salary || '',
      job_type: job.jobType || '',
      link: job.link || '',
      description: job.description || ''
    };
  }

  function exportCsv() {
    const jobs = filteredJobs.length ? filteredJobs : allJobs;
    if (jobs.length === 0) {
      showToast('No records to export.', 'error');
      return;
    }

    const headers = ['Job Title', 'Job ID', 'Hospital', 'Aggregator', 'Location', 'Area of Practice', 'Position', 'Salary', 'Job Type', 'Link', 'Description'];
    const rows = jobs.map(job => [
      job.jobTitle,
      job.jobId,
      job.hospitalName,
      'Innovetive Petcare',
      job.location,
      job.areaOfPractice,
      job.position,
      job.salary,
      job.jobType,
      job.link,
      job.description
    ]);

    const csv = [headers, ...rows]
      .map(row => row.map(value => `"${String(value || '').replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'innovetive-petcare-jobs.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async function clearDetails() {
    if (!confirm('Clear area of practice, position, salary, and enriched hospital/location details?')) return;
    allJobs = allJobs.map(job => ({
      ...job,
      areaOfPractice: '',
      position: '',
      salary: ''
    }));
    await chrome.storage.local.set({ scrapedJobs: allJobs, jobs: allJobs });
    applySearch();
    displayRecords(filteredJobs);
    showToast('Details cleared.', 'success');
  }

  async function clearDescriptions() {
    if (!confirm('Clear all saved descriptions?')) return;
    allJobs = allJobs.map(job => ({ ...job, description: '' }));
    await chrome.storage.local.set({ scrapedJobs: allJobs, jobs: allJobs });
    applySearch();
    displayRecords(filteredJobs);
    showToast('Descriptions cleared.', 'success');
  }

  async function clearRecords() {
    if (!confirm('Clear all scraped job records? This cannot be undone.')) return;
    allJobs = [];
    filteredJobs = [];
    await chrome.storage.local.remove(['scrapedJobs', 'jobs']);
    displayRecords(filteredJobs);
    showToast('All records cleared.', 'success');
  }

  function showProgress(label, current, total) {
    document.getElementById('progressSection').classList.remove('hidden');
    document.getElementById('progressLabel').textContent = label;
    updateProgress(current, total);
  }

  function updateProgress(current, total) {
    const safeTotal = total || 1;
    const percent = Math.round((current / safeTotal) * 100);
    document.getElementById('progressText').textContent = `${current} / ${total}`;
    document.getElementById('progressBar').style.width = `${percent}%`;
  }

  function hideProgress() {
    document.getElementById('progressSection').classList.add('hidden');
    document.getElementById('progressBar').style.width = '0%';
    document.getElementById('progressText').textContent = '0 / 0';
  }

  function showToast(message, type = 'success') {
    const toastContainer = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  }

  function isValidUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (error) {
      return false;
    }
  }

  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value || '';
    return div.innerHTML;
  }
});
