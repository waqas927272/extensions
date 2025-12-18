document.addEventListener('DOMContentLoaded', () => {
  const jobRecordsTableBody = document.querySelector('#jobRecordsTable tbody');
  const clearRecordsBtn = document.getElementById('clearRecords');
  const downloadCsvBtn = document.getElementById('downloadCsv');
  const getDescriptionsBtn = document.getElementById('getDescriptions');
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

  let storedJobs = [];
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

  // Initial load
  displayRecords();
});
