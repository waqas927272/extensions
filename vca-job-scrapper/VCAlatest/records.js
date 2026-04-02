document.addEventListener('DOMContentLoaded', function() {
  const jobsTableBody = document.getElementById('jobsTableBody');
  const emptyState = document.getElementById('emptyState');
  const recordCount = document.getElementById('recordCount');
  const selectAllCheckbox = document.getElementById('selectAllCheckbox');
  const selectAllBtn = document.getElementById('selectAllBtn');
  const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
  const fetchDescBtn = document.getElementById('fetchDescBtn');
  const fetchDetailsBtn = document.getElementById('fetchDetailsBtn');
  const clearDetailsBtn = document.getElementById('clearDetailsBtn');
  const exportCsvBtn = document.getElementById('exportCsvBtn');

  // Google Sheets elements
  const sendGSheetBtn = document.getElementById('sendGSheetBtn');
  const gsheetSection = document.getElementById('gsheetSection');
  const gsheetUrl = document.getElementById('gsheetUrl');
  const sendGSheetDataBtn = document.getElementById('sendGSheetDataBtn');
  const cancelGSheetBtn = document.getElementById('cancelGSheetBtn');
  const gsheetStatus = document.getElementById('gsheetStatus');

  // Webhook elements
  const sendWebhookBtn = document.getElementById('sendWebhookBtn');
  const webhookExportSection = document.getElementById('webhookExportSection');
  const webhookUrl = document.getElementById('webhookUrl');
  const sendWebhookDataBtn = document.getElementById('sendWebhookDataBtn');
  const cancelWebhookBtn = document.getElementById('cancelWebhookBtn');
  const webhookStatus = document.getElementById('webhookStatus');
  const descriptionModal = document.getElementById('descriptionModal');
  const closeModal = document.getElementById('closeModal');
  const modalJobTitle = document.getElementById('modalJobTitle');
  const modalJobDetails = document.getElementById('modalJobDetails');
  const modalDescription = document.getElementById('modalDescription');
  const totalJobsFound = document.getElementById('totalJobsFound');
  const totalJobsSkipped = document.getElementById('totalJobsSkipped');
  const totalJobsSaved = document.getElementById('totalJobsSaved');
  const skippedByKeyword = document.getElementById('skippedByKeyword');

  let allJobs = [];
  let selectedJobs = new Set();
  let isFetchingDescriptions = false;
  let isFetchingDetails = false;
  let currentTabId = null;
  let descriptionQueue = [];
  let currentFetchIndex = 0;
  let detailsQueue = [];
  let currentDetailsIndex = 0;
  let skippedJobsStats = { total: 0, byKeyword: { Relief: 0, Intern: 0, Locum: 0 } };

  // Get current tab ID
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length > 0) {
      currentTabId = tabs[0].id;
    }
  });

  const GOOGLE_SHEET_ID = '19EEAS2gqmZwyWYGZY7PPlsMrSMLCr6YScxc3sFgh6n0';
  
  class GoogleSheetsExporter {
    constructor() {
      this.serviceAuth = new ServiceAccountAuth();
    }

    async getExistingData(spreadsheetId) {
      try {
        const accessToken = await this.serviceAuth.getAccessToken();
        
        const response = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A:Q`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
            }
          }
        );

        if (!response.ok) {
          throw new Error(`Failed to read sheet: ${response.statusText}`);
        }

        const data = await response.json();
        return data.values || [];
      } catch (error) {
        console.error('Error reading existing data:', error);
        return [];
      }
    }

    async exportToSheet(spreadsheetId, jobs) {
      try {
        const accessToken = await this.serviceAuth.getAccessToken();

        const existingData = await this.getExistingData(spreadsheetId);
        const existingDepartmentIds = new Set();
        
        if (existingData.length > 1) {
          for (let i = 1; i < existingData.length; i++) {
            if (existingData[i][0]) {
              existingDepartmentIds.add(existingData[i][0]);
            }
          }
        }

        const newJobs = jobs.filter(job => !existingDepartmentIds.has(job.departmentId));
        
        if (newJobs.length === 0) {
          throw new Error('No new jobs to add - all jobs already exist in the sheet');
        }

        let dataToAdd = [];
        let startRow = existingData.length + 1;

        if (existingData.length === 0) {
          const headers = ['Department ID', 'Title', 'Location', 'Category', 'Job Type', 'Area of Practice', 'Position', 'Salary', 'Hospital Name', 'City', 'State', 'Address', 'Phone', 'Website', 'URL', 'Description', 'Scraped At'];
          dataToAdd.push(headers);
          startRow = 1;
        }

        const jobData = newJobs.map(job => [
          job.departmentId || '',
          job.title || '',
          job.jobType || '',
          job.areaOfPractice || '',
          job.position || '',
          job.salary || '',
          job.hospitalName || '',
          job.city || '',
          job.state || '',
          job.address || '',
          job.phone || '',
          job.websiteUrl || '',
          job.url || '',
          job.description || '-',
          new Date(job.scrapedAt).toLocaleString()
        ]);

        dataToAdd = [...dataToAdd, ...jobData];

        const response = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A${startRow}:Q${startRow + dataToAdd.length - 1}?valueInputOption=RAW`,
          {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              values: dataToAdd
            })
          }
        );

        if (!response.ok) {
          const error = await response.json();
          throw new Error(`Google Sheets API error: ${error.error?.message || response.statusText}`);
        }

        if (existingData.length === 0) {
          await this.formatHeaderRow(spreadsheetId);
        }

        return { addedCount: newJobs.length, skippedCount: jobs.length - newJobs.length };

      } catch (error) {
        console.error('Error exporting to Google Sheets:', error);
        throw error;
      }
    }

    async formatHeaderRow(spreadsheetId) {
      try {
        const accessToken = await this.serviceAuth.getAccessToken();

        const response = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              requests: [
                {
                  repeatCell: {
                    range: {
                      sheetId: 0,
                      startRowIndex: 0,
                      endRowIndex: 1,
                      startColumnIndex: 0,
                      endColumnIndex: 17
                    },
                    cell: {
                      userEnteredFormat: {
                        backgroundColor: {
                          red: 0.18,
                          green: 0.52,
                          blue: 0.67
                        },
                        textFormat: {
                          foregroundColor: {
                            red: 1.0,
                            green: 1.0,
                            blue: 1.0
                          },
                          bold: true
                        }
                      }
                    },
                    fields: 'userEnteredFormat(backgroundColor,textFormat)'
                  }
                },
                {
                  autoResizeDimensions: {
                    dimensions: {
                      sheetId: 0,
                      dimension: 'COLUMNS',
                      startIndex: 0,
                      endIndex: 17
                    }
                  }
                }
              ]
            })
          }
        );

        if (!response.ok) {
          console.warn('Failed to format header row:', response.statusText);
        }
      } catch (error) {
        console.warn('Error formatting header row:', error);
      }
    }
  }

  const gsheetExporter = new GoogleSheetsExporter();

  // Event listeners
  selectAllCheckbox.addEventListener('change', toggleSelectAll);
  selectAllBtn.addEventListener('click', toggleSelectAll);
  deleteSelectedBtn.addEventListener('click', deleteSelected);
  fetchDescBtn.addEventListener('click', fetchDescriptions);
  fetchDetailsBtn.addEventListener('click', fetchDetails);
  clearDetailsBtn.addEventListener('click', clearFetchedDetails);
  exportCsvBtn.addEventListener('click', exportToCSV);

  // Google Sheets event listeners
  sendGSheetBtn.addEventListener('click', showGSheetForm);
  sendGSheetDataBtn.addEventListener('click', exportToGSheet);
  cancelGSheetBtn.addEventListener('click', hideGSheetForm);

  // Webhook event listeners
  sendWebhookBtn.addEventListener('click', showWebhookForm);
  sendWebhookDataBtn.addEventListener('click', sendToWebhook);
  cancelWebhookBtn.addEventListener('click', hideWebhookForm);

  closeModal.addEventListener('click', hideModal);

  window.addEventListener('click', function(event) {
    if (event.target === descriptionModal) {
      hideModal();
    }
  });

  // Listen for messages from other scripts
  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === 'descriptionFetched') {
      allJobs[request.jobIndex].description = request.description;
      chrome.storage.local.set({ jobs: allJobs });

      const currentJob = descriptionQueue[currentFetchIndex];
      if (currentJob && currentJob.index === request.jobIndex) {
        currentFetchIndex++;
        fetchDescBtn.textContent = `Fetching... (${currentFetchIndex}/${descriptionQueue.length})`;

        if (currentFetchIndex < descriptionQueue.length) {
          setTimeout(() => {
            processNextDescription();
          }, 1000);
        } else {
          finishDescriptionFetching();
        }
      }

      displayJobs();
    } else if (request.action === 'skippedStatsUpdate' && request.data) {
      skippedJobsStats = request.data;
      updateSkippedStatsUI();
    }
  });

  // Load initial data
  loadJobs();
  chrome.storage.local.get(['skippedJobsStats'], (result) => {
    if (result.skippedJobsStats) {
      skippedJobsStats = result.skippedJobsStats;
      updateSkippedStatsUI();
    }
  });

  async function loadJobs() {
    const result = await chrome.storage.local.get(['jobs']);
    allJobs = result.jobs || [];
    displayJobs();
    updateRecordCount();
    updateSkippedStatsUI();
  }

  function displayJobs() {
    if (allJobs.length === 0) {
      jobsTableBody.style.display = 'none';
      emptyState.style.display = 'block';
      return;
    }

    jobsTableBody.style.display = 'table-row-group';
    emptyState.style.display = 'none';

    jobsTableBody.innerHTML = allJobs.map((job, index) => `
      <tr>
        <td>
          <input type="checkbox" class="job-checkbox" data-index="${index}"
                 ${selectedJobs.has(index) ? 'checked' : ''}>
        </td>
        <td>${escapeHtml(job.departmentId)}</td>
        <td class="job-title">${escapeHtml(job.title)}</td>
        <td>
          <span class="job-type">${escapeHtml(job.jobType)}</span>
        </td>
        <td>${escapeHtml(job.areaOfPractice || '-')}</td>
        <td>${escapeHtml(job.position || '-')}</td>
        <td>${escapeHtml(job.salary || '-')}</td>
        <td>${escapeHtml(job.hospitalName || '-')}</td>
        <td>${escapeHtml(job.city || '-')}</td>
        <td>${escapeHtml(job.state || '-')}</td>
        <td>${escapeHtml(job.address || '-')}</td>
        <td>${escapeHtml(job.phone || '-')}</td>
        <td class="job-url">
          ${job.websiteUrl
            ? `<a href="${escapeHtml(job.websiteUrl)}" target="_blank" title="${escapeHtml(job.websiteUrl)}">Visit</a>`
            : '-'
          }
        </td>
        <td class="job-url">
          <a href="${escapeHtml(job.url)}" target="_blank" title="${escapeHtml(job.url)}">
            ${job.url ? 'View Job' : 'N/A'}
          </a>
        </td>
        <td>
          ${job.description && job.description !== '-'
            ? `<button class="btn btn-outline description-btn" data-index="${index}">View</button>`
            : '<span class="description-pending">-</span>'
          }
        </td>
        <td class="scraped-date">
          ${new Date(job.scrapedAt).toLocaleDateString()}
        </td>
        <td>
          <button class="btn btn-danger action-btn delete-btn" data-index="${index}">
            Delete
          </button>
        </td>
      </tr>
    `).join('');

    document.querySelectorAll('.job-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', handleCheckboxChange);
    });

    document.querySelectorAll('.description-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.target.dataset.index);
        showDescription(index);
      });
    });

    document.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.target.dataset.index);
        deleteJob(index);
      });
    });

    updateSelectAllState();
  }

  async function fetchDescriptions() {
    if (isFetchingDescriptions) return;

    const jobsToFetch = selectedJobs.size > 0 
      ? Array.from(selectedJobs).map(index => ({ job: allJobs[index], index }))
      : allJobs.map((job, index) => ({ job, index })).filter(item => !item.job.description || item.job.description === '-');

    if (jobsToFetch.length === 0) {
      alert('No jobs need description fetching.');
      return;
    }

    descriptionQueue = jobsToFetch;
    currentFetchIndex = 0;
    isFetchingDescriptions = true;
    fetchDescBtn.disabled = true;
    fetchDescBtn.textContent = `Fetching... (0/${descriptionQueue.length})`;

    processNextDescription();
  }

  function processNextDescription() {
    if (currentFetchIndex >= descriptionQueue.length) {
      finishDescriptionFetching();
      return;
    }

    const { job, index } = descriptionQueue[currentFetchIndex];
    
    if (!job.description || job.description === '-') {
      chrome.runtime.sendMessage({
        action: 'fetchJobDescription',
        url: job.url,
        jobIndex: index,
        responseTabId: currentTabId
      });
    } else {
      currentFetchIndex++;
      fetchDescBtn.textContent = `Fetching... (${currentFetchIndex}/${descriptionQueue.length})`;
      
      if (currentFetchIndex < descriptionQueue.length) {
        setTimeout(() => {
          processNextDescription();
        }, 500);
      } else {
        finishDescriptionFetching();
      }
    }
  }

  function finishDescriptionFetching() {
    isFetchingDescriptions = false;
    fetchDescBtn.disabled = false;
    fetchDescBtn.textContent = 'Fetch Descriptions';
    const fetchedCount = currentFetchIndex;
    descriptionQueue = [];
    currentFetchIndex = 0;
    
    alert(`Description fetching completed for ${fetchedCount} jobs.`);
    displayJobs();
  }

  async function fetchDetails() {
    if (isFetchingDetails) return;

    let jobsToFetch;
    if (selectedJobs.size > 0) {
      jobsToFetch = Array.from(selectedJobs).map(index => ({ job: allJobs[index], index }));
    } else {
      jobsToFetch = allJobs.map((job, index) => ({ job, index })).filter(item => {
        return !item.job.detailsFetched;
      });
    }

    if (jobsToFetch.length === 0) {
      if (confirm('All jobs appear to have details. Do you want to re-fetch for all jobs anyway?')) {
        jobsToFetch = allJobs.map((job, index) => ({ job, index }));
      } else {
        return;
      }
    }

    detailsQueue = jobsToFetch;
    currentDetailsIndex = 0;
    isFetchingDetails = true;
    fetchDetailsBtn.disabled = true;
    fetchDetailsBtn.textContent = `Fetching... (0/${detailsQueue.length})`;

    processNextDetail();
  }

  function processNextDetail() {
    if (currentDetailsIndex >= detailsQueue.length) {
      finishDetailsFetching();
      return;
    }

    const { job, index } = detailsQueue[currentDetailsIndex];

    chrome.runtime.sendMessage(
      {
        action: 'fetchJobDetails',
        url: job.url,
        jobIndex: index
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error("Message failed:", chrome.runtime.lastError.message);
          // Skip to the next item on error to avoid getting stuck
          currentDetailsIndex++;
          if (currentDetailsIndex < detailsQueue.length) {
            setTimeout(processNextDetail, 1500);
          } else {
            finishDetailsFetching();
          }
          return;
        }
        
        // Handle the response here
        if (response && response.action === 'detailsFetched') {
          const details = response.details;
          const job = allJobs[response.jobIndex];
          if (job && details) {
              // Check if we got meaningful data back (page actually loaded)
              const hasMeaningfulData = details.city || details.state || details.hospitalName || details.position || details.salary;

              job.areaOfPractice = details.areaOfPractice || job.areaOfPractice || '';
              job.position = details.position || job.position || job.title || '';
              job.salary = details.salary || job.salary || '';
              job.hospitalName = details.hospitalName || job.hospitalName || '';
              job.jobType = details.jobType || job.jobType || '';
              job.city = details.city || job.city || '';
              job.state = details.state || job.state || '';

              // Fallback: parse city/state from the job's location field if still missing
              if ((!job.city || !job.state) && job.location) {
                const locStr = job.location.replace(/,?\s*United States of America/gi, '').replace(/,?\s*USA$/gi, '').trim();
                const locParts = locStr.split(',').map(s => s.trim()).filter(Boolean);
                if (locParts.length >= 2) {
                  if (!job.city) job.city = locParts[0];
                  if (!job.state) job.state = locParts[1];
                }
              }

              job.address = details.address || job.address || '';
              job.phone = details.phone || job.phone || '';
              job.websiteUrl = details.websiteUrl || job.websiteUrl || '';

              // Handle multiple locations: update original with first, create new records for the rest
              if (details.allLocations && details.allLocations.length > 1) {
                const firstLoc = details.allLocations[0];
                job.location = firstLoc.location || job.location;
                job.city = firstLoc.city || job.city;
                job.state = firstLoc.state || job.state;
                job.address = firstLoc.address || '';
                if (job.hospitalName) {
                  job.address = job.address ? job.hospitalName + ', ' + job.address : job.hospitalName;
                }

                for (let i = 1; i < details.allLocations.length; i++) {
                  const loc = details.allLocations[i];
                  let locAddress = loc.address || '';
                  if (details.hospitalName) {
                    locAddress = locAddress ? details.hospitalName + ', ' + locAddress : details.hospitalName;
                  }
                  // Parse city/state from location string if missing
                  let locCity = loc.city || '';
                  let locState = loc.state || '';
                  if ((!locCity || !locState) && loc.location) {
                    const locStr = loc.location.replace(/,?\s*United States of America/gi, '').replace(/,?\s*USA$/gi, '').trim();
                    const locParts = locStr.split(',').map(s => s.trim()).filter(Boolean);
                    if (locParts.length >= 2) {
                      if (!locCity) locCity = locParts[0];
                      if (!locState) locState = locParts[1];
                    }
                  }
                  allJobs.push({
                    departmentId: job.departmentId + '-loc' + (i + 1),
                    title: job.title,
                    location: loc.location || '',
                    category: job.category,
                    url: job.url,
                    jobType: job.jobType,
                    scrapedAt: job.scrapedAt,
                    areaOfPractice: details.areaOfPractice || '',
                    position: details.position || '',
                    salary: details.salary || '',
                    hospitalName: details.hospitalName || '',
                    city: locCity,
                    state: locState,
                    address: locAddress,
                    description: job.description || '',
                    phone: details.phone || '',
                    websiteUrl: details.websiteUrl || ''
                  });
                }
                console.log(`Job has ${details.allLocations.length} locations. Created ${details.allLocations.length - 1} extra record(s).`);
              }

              // Only mark as fetched if we got meaningful data
              if (hasMeaningfulData) {
                job.detailsFetched = true;
              }
          }
          chrome.storage.local.set({ jobs: allJobs });
          updateRecordCount();

          const currentDetail = detailsQueue[currentDetailsIndex];
          if (currentDetail && currentDetail.index === response.jobIndex) {
              currentDetailsIndex++;
              fetchDetailsBtn.textContent = `Fetching... (${currentDetailsIndex}/${detailsQueue.length})`;

              if (currentDetailsIndex < detailsQueue.length) {
                  setTimeout(processNextDetail, 1500);
              } else {
                  finishDetailsFetching();
              }
          }
          displayJobs();
        }
      }
    );
  }

  function moveToNextDetail(jobIndex) {
    const currentDetail = detailsQueue[currentDetailsIndex];
    if (currentDetail && currentDetail.index === jobIndex) {
      currentDetailsIndex++;
      fetchDetailsBtn.textContent = `Fetching... (${currentDetailsIndex}/${detailsQueue.length})`;

      if (currentDetailsIndex < detailsQueue.length) {
        setTimeout(() => {
          processNextDetail();
        }, 1500);
      } else {
        finishDetailsFetching();
      }
    }
  }

  function finishDetailsFetching() {
    isFetchingDetails = false;
    fetchDetailsBtn.disabled = false;
    fetchDetailsBtn.textContent = 'Fetch Details';
    const fetched = currentDetailsIndex;
    detailsQueue = [];
    currentDetailsIndex = 0;

    alert(`Details fetching completed for ${fetched} jobs.`);
    displayJobs();
  }

  function showDescription(index) {
    const job = allJobs[index];
    modalJobTitle.textContent = job.title;
    
    modalJobDetails.innerHTML = `
      <p><strong>Department ID:</strong> ${escapeHtml(job.departmentId)}</p>
      <p><strong>Job Type:</strong> ${escapeHtml(job.jobType)}</p>
      <p><strong>Area of Practice:</strong> ${escapeHtml(job.areaOfPractice || '-')}</p>
      <p><strong>Position:</strong> ${escapeHtml(job.position || '-')}</p>
      <p><strong>Salary:</strong> ${escapeHtml(job.salary || '-')}</p>
      <p><strong>Hospital Name:</strong> ${escapeHtml(job.hospitalName || '-')}</p>
      <p><strong>City:</strong> ${escapeHtml(job.city || '-')}</p>
      <p><strong>State:</strong> ${escapeHtml(job.state || '-')}</p>
      <p><strong>Address:</strong> ${escapeHtml(job.address || '-')}</p>
      <p><strong>Phone:</strong> ${escapeHtml(job.phone || '-')}</p>
      <p><strong>Website:</strong> ${job.websiteUrl ? `<a href="${escapeHtml(job.websiteUrl)}" target="_blank">${escapeHtml(job.websiteUrl)}</a>` : '-'}</p>
      <p><strong>URL:</strong> <a href="${escapeHtml(job.url)}" target="_blank">View Original</a></p>
    `;
    
    modalDescription.innerHTML = job.description.replace(/\n/g, '<br>');
    descriptionModal.style.display = 'block';
  }

  function hideModal() {
    descriptionModal.style.display = 'none';
  }

  function handleCheckboxChange(event) {
    const index = parseInt(event.target.dataset.index);
    
    if (event.target.checked) {
      selectedJobs.add(index);
    } else {
      selectedJobs.delete(index);
    }
    
    updateSelectAllState();
    updateDeleteButtonState();
  }

  function toggleSelectAll() {
    const shouldSelectAll = selectedJobs.size !== allJobs.length;
    
    selectedJobs.clear();
    
    if (shouldSelectAll) {
      allJobs.forEach((_, index) => selectedJobs.add(index));
    }
    
    updateSelectAllState();
    updateDeleteButtonState();
    
    document.querySelectorAll('.job-checkbox').forEach((checkbox, index) => {
      checkbox.checked = shouldSelectAll;
    });
  }

  function updateSelectAllState() {
    const allSelected = selectedJobs.size === allJobs.length && allJobs.length > 0;
    const someSelected = selectedJobs.size > 0;
    
    selectAllCheckbox.checked = allSelected;
    selectAllCheckbox.indeterminate = someSelected && !allSelected;
    selectAllBtn.textContent = allSelected ? 'Deselect All' : 'Select All';
  }

  function updateDeleteButtonState() {
    deleteSelectedBtn.disabled = selectedJobs.size === 0;
  }

  function updateRecordCount() {
    recordCount.textContent = `${allJobs.length} record${allJobs.length !== 1 ? 's' : ''}`;
  }

  async function deleteSelected() {
    if (selectedJobs.size === 0) return;
    
    if (!confirm(`Are you sure you want to delete ${selectedJobs.size} selected job(s)?`)) {
      return;
    }

    const selectedIndices = Array.from(selectedJobs).sort((a, b) => b - a);
    selectedIndices.forEach(index => {
      allJobs.splice(index, 1);
    });

    await chrome.storage.local.set({ jobs: allJobs });
    
    selectedJobs.clear();
    
    displayJobs();
    updateRecordCount();
    updateDeleteButtonState();
  }

  async function clearFetchedDetails() {
    if (!confirm("Are you sure you want to clear all fetched details (Position, Salary, Hospital, etc.) from all records? This will not delete the jobs themselves.")) {
      return;
    }

    if (allJobs.length === 0) {
      alert('No records to clear.');
      return;
    }

    // Reset the detail fields for each job
    allJobs.forEach(job => {
      job.areaOfPractice = '';
      job.position = '';
      job.salary = '';
      job.hospitalName = '';
      job.city = '';
      job.state = '';
      job.description = '';
      job.detailsFetched = false;
    });

    // Save the cleared data back to storage
    await chrome.storage.local.set({ jobs: allJobs });

    // Refresh the UI
    displayJobs();
    
    alert('All fetched details have been cleared.');
  }

  function showGSheetForm() {
    gsheetSection.style.display = 'block';
    webhookExportSection.style.display = 'none';
    gsheetUrl.value = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/edit`;
    gsheetUrl.disabled = true;
    gsheetStatus.textContent = '';
  }

  function hideGSheetForm() {
    gsheetSection.style.display = 'none';
    gsheetStatus.textContent = '';
  }

  function showWebhookForm() {
    webhookExportSection.style.display = 'block';
    gsheetSection.style.display = 'none';
    webhookStatus.textContent = '';

    // Load saved webhook URL if exists
    chrome.storage.local.get(['webhookUrl'], function(result) {
      if (result.webhookUrl) {
        webhookUrl.value = result.webhookUrl;
      }
    });
  }

  function hideWebhookForm() {
    webhookExportSection.style.display = 'none';
    webhookStatus.textContent = '';
  }

  async function exportToGSheet() {
    if (allJobs.length === 0) {
      showGSheetStatus('No jobs data to export', 'error');
      return;
    }

    try {
      sendGSheetDataBtn.disabled = true;
      sendGSheetDataBtn.textContent = 'Authenticating...';
      showGSheetStatus('Authenticating with service account...', 'info');

      sendGSheetDataBtn.textContent = 'Exporting...';
      showGSheetStatus('Checking for duplicates and exporting data...', 'info');

      const result = await gsheetExporter.exportToSheet(GOOGLE_SHEET_ID, allJobs);

      if (result.skippedCount > 0) {
        showGSheetStatus(`Export completed! Added ${result.addedCount} new jobs, skipped ${result.skippedCount} duplicates.`, 'success');
      } else {
        showGSheetStatus(`Successfully exported ${result.addedCount} jobs to Google Sheets!`, 'success');
      }

      setTimeout(() => {
        hideGSheetForm();
      }, 3000);

    } catch (error) {
      console.error('Export error:', error);

      if (error.message.includes('access') || error.message.includes('permission') || error.message.includes('403')) {
        showGSheetStatus('Access denied. Please make sure the service account has edit access to the Google Sheet.', 'error');
      } else if (error.message.includes('not found') || error.message.includes('404')) {
        showGSheetStatus('Google Sheet not found. Please check if the sheet exists and is accessible.', 'error');
      } else if (error.message.includes('No new jobs')) {
        showGSheetStatus(error.message, 'error');
      } else if (error.message.includes('Token exchange failed')) {
        showGSheetStatus('Service account authentication failed. Please check the configuration.', 'error');
      } else {
        showGSheetStatus('Export failed: ' + error.message, 'error');
      }
    } finally {
      sendGSheetDataBtn.disabled = false;
      sendGSheetDataBtn.textContent = 'Export Data';
    }
  }

  async function sendToWebhook() {
    const url = webhookUrl.value.trim();

    if (!url) {
      showWebhookStatus('Please enter a webhook URL', 'error');
      return;
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      showWebhookStatus('Please enter a valid URL (starting with http:// or https://)', 'error');
      return;
    }

    if (allJobs.length === 0) {
      showWebhookStatus('No jobs data to send', 'error');
      return;
    }

    if (!confirm(`Are you sure you want to send ${allJobs.length} jobs to the webhook?`)) {
      return;
    }

    try {
      sendWebhookDataBtn.disabled = true;
      sendWebhookDataBtn.textContent = 'Sending...';

      // Save webhook URL for future use
      chrome.storage.local.set({ webhookUrl: url });

      // Prepare jobs data
      const jobsData = allJobs.map(job => ({
        departmentId: job.departmentId || '',
        title: job.title || '',
        location: job.location || '',
        category: job.category || '',
        jobType: job.jobType || '',
        areaOfPractice: job.areaOfPractice || '',
        position: job.position || '',
        salary: job.salary || '',
        parentClientName: 'VCA Animal Hospitals (Parent Client)',
        city: job.city || '',
        state: job.state || '',
        address: job.address || '',
        phone: job.phone || '',
        websiteUrl: job.websiteUrl || '',
        url: job.url || '',
        description: job.description || '',
        scrapedAt: job.scrapedAt || ''
      }));

      // Send in batches of 50
      const BATCH_SIZE = 50;
      const totalBatches = Math.ceil(jobsData.length / BATCH_SIZE);
      const syncId = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
      const timestamp = new Date().toISOString();

      for (let i = 0; i < totalBatches; i++) {
        const batchNumber = i + 1;
        const start = i * BATCH_SIZE;
        const batchData = jobsData.slice(start, start + BATCH_SIZE);

        showWebhookStatus(`Sending batch ${batchNumber}/${totalBatches}...`, 'info');
        sendWebhookDataBtn.textContent = `Sending ${batchNumber}/${totalBatches}...`;

        const payload = {
          source: 'VCA Animal Hospitals',
          parentClientName: 'VCA Animal Hospitals (Parent Client)',
          syncId: syncId,
          timestamp: timestamp,
          batchNumber: batchNumber,
          totalBatches: totalBatches,
          batchSize: batchData.length,
          totalRecords: jobsData.length,
          data: batchData
        };

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          throw new Error(`Webhook returned status ${response.status} on batch ${batchNumber}: ${response.statusText}`);
        }

        // 500ms delay between batches
        if (batchNumber < totalBatches) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      showWebhookStatus(`Successfully sent ${allJobs.length} jobs in ${totalBatches} batch(es)!`, 'success');

      setTimeout(() => {
        hideWebhookForm();
      }, 3000);

    } catch (error) {
      console.error('Webhook error:', error);

      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        showWebhookStatus('Network error: Could not reach the webhook URL. Please check the URL and try again.', 'error');
      } else {
        showWebhookStatus('Failed to send data: ' + error.message, 'error');
      }
    } finally {
      sendWebhookDataBtn.disabled = false;
      sendWebhookDataBtn.textContent = 'Send Data';
    }
  }

  function showGSheetStatus(message, type) {
    gsheetStatus.textContent = message;
    gsheetStatus.className = `export-status ${type}`;
  }

  function showWebhookStatus(message, type) {
    webhookStatus.textContent = message;
    webhookStatus.className = `export-status ${type}`;
  }

  function exportToCSV() {
    if (allJobs.length === 0) {
      alert('No jobs data to export');
      return;
    }

    try {
      // Define CSV headers
      const headers = [
        'Department ID',
        'Title',
        'Job Type',
        'Area of Practice',
        'Position',
        'Salary',
        'Hospital Name',
        'City',
        'State',
        'URL',
        'Description',
        'Scraped At'
      ];

      // Convert jobs to CSV rows
      const rows = allJobs.map(job => [
        job.departmentId || '',
        job.title || '',
        job.jobType || '',
        job.areaOfPractice || '',
        job.position || '',
        job.salary || '',
        job.hospitalName || '',
        job.city || '',
        job.state || '',
        job.url || '',
        job.description || '',
        job.scrapedAt ? new Date(job.scrapedAt).toLocaleString() : ''
      ]);

      // Escape CSV values (handle commas, quotes, newlines)
      const escapeCSVValue = (value) => {
        if (value === null || value === undefined) return '';
        const stringValue = String(value);
        // If value contains comma, quote, or newline, wrap in quotes and escape quotes
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n') || stringValue.includes('\r')) {
          return '"' + stringValue.replace(/"/g, '""') + '"';
        }
        return stringValue;
      };

      // Build CSV content
      let csvContent = headers.map(escapeCSVValue).join(',') + '\n';
      rows.forEach(row => {
        csvContent += row.map(escapeCSVValue).join(',') + '\n';
      });

      // Create blob and download
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);

      // Generate filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const filename = `vca-jobs-export-${timestamp}.csv`;

      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      alert(`Successfully exported ${allJobs.length} jobs to CSV file: ${filename}`);

    } catch (error) {
      console.error('CSV export error:', error);
      alert('Failed to export CSV: ' + error.message);
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  async function deleteJob(index) {
    if (!confirm('Are you sure you want to delete this job?')) {
      return;
    }

    allJobs.splice(index, 1);
    await chrome.storage.local.set({ jobs: allJobs });
    
    selectedJobs.delete(index);
    
    const newSelectedJobs = new Set();
    selectedJobs.forEach(selectedIndex => {
      if (selectedIndex < index) {
        newSelectedJobs.add(selectedIndex);
      } else if (selectedIndex > index) {
        newSelectedJobs.add(selectedIndex - 1);
      }
    });
    selectedJobs = newSelectedJobs;
    
    displayJobs();
    updateRecordCount();
    updateDeleteButtonState();
  }

  function updateSkippedStatsUI() {
    // Total found = saved + skipped
    totalJobsFound.textContent = allJobs.length + skippedJobsStats.total;
    totalJobsSkipped.textContent = skippedJobsStats.total;
    totalJobsSaved.textContent = allJobs.length;
    // Populate the keyword table
    const tbody = document.getElementById('skippedByKeywordTable');
    tbody.innerHTML = '';
    for (const [keyword, count] of Object.entries(skippedJobsStats.byKeyword)) {
      const row = document.createElement('tr');
      const keywordCell = document.createElement('td');
      keywordCell.textContent = keyword;
      const countCell = document.createElement('td');
      countCell.textContent = count;
      row.appendChild(keywordCell);
      row.appendChild(countCell);
      tbody.appendChild(row);
    }
  }
});