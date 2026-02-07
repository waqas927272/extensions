document.addEventListener('DOMContentLoaded', () => {
  const recordsTableBody = document.querySelector('#recordsTable tbody');
  const clearRecordsButton = document.getElementById('clearRecords');
  const downloadCsvButton = document.getElementById('downloadCsv');
  const getJobDescriptionsButton = document.getElementById('getJobDescriptions');
  const searchInput = document.getElementById('searchInput');
  const stateFilter = document.getElementById('stateFilter');
  const positionFilter = document.getElementById('positionFilter');
  const recordCountSpan = document.getElementById('recordCount');
  const emptyState = document.getElementById('emptyState');
  const recordsTable = document.getElementById('recordsTable');

  let allRecords = [];
  let filteredRecords = [];
  let sortColumn = null;
  let sortDirection = 'asc';
  let isGettingDescriptions = false;
  let currentJobIndex = 0;

  const descriptionModal = document.getElementById('descriptionModal');
  const modalDescriptionContent = document.getElementById('modalDescriptionContent');
  const closeButton = document.querySelector('.close-button');

  // Toast notification function
  function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast show ' + type;

    setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  }

  function showDescriptionModal(description) {
    modalDescriptionContent.innerHTML = description;
    descriptionModal.classList.add('show');
  }

  function hideDescriptionModal() {
    descriptionModal.classList.remove('show');
    modalDescriptionContent.textContent = '';
  }

  closeButton.addEventListener('click', hideDescriptionModal);

  window.addEventListener('click', (event) => {
    if (event.target === descriptionModal) {
      hideDescriptionModal();
    }
  });

  function escapeHtml(unsafe) {
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function updateRecordCount(count) {
    recordCountSpan.textContent = count;
  }

  function populateFilters(records) {
    const states = new Set();
    const positions = new Set();

    records.forEach(record => {
      if (record.state) states.add(record.state);
      if (record.position) positions.add(record.position);
    });

    // Populate state filter
    stateFilter.innerHTML = '<option value="">All States</option>';
    Array.from(states).sort().forEach(state => {
      const option = document.createElement('option');
      option.value = state;
      option.textContent = state;
      stateFilter.appendChild(option);
    });

    // Populate position filter
    positionFilter.innerHTML = '<option value="">All Positions</option>';
    Array.from(positions).sort().forEach(position => {
      const option = document.createElement('option');
      option.value = position;
      option.textContent = position;
      positionFilter.appendChild(option);
    });
  }

  function filterRecords() {
    const searchTerm = searchInput.value.toLowerCase();
    const selectedState = stateFilter.value;
    const selectedPosition = positionFilter.value;

    filteredRecords = allRecords.filter(record => {
      const matchesSearch =
        record.title.toLowerCase().includes(searchTerm) ||
        record.city.toLowerCase().includes(searchTerm) ||
        record.state.toLowerCase().includes(searchTerm) ||
        record.position.toLowerCase().includes(searchTerm);

      const matchesState = !selectedState || record.state === selectedState;
      const matchesPosition = !selectedPosition || record.position === selectedPosition;

      return matchesSearch && matchesState && matchesPosition;
    });

    if (sortColumn) {
      sortRecords(sortColumn, sortDirection);
    } else {
      renderTable(filteredRecords);
    }
  }

  function sortRecords(column, direction) {
    filteredRecords.sort((a, b) => {
      let aVal = a[column] || '';
      let bVal = b[column] || '';

      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase();
        bVal = bVal.toLowerCase();
      }

      if (aVal < bVal) return direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return direction === 'asc' ? 1 : -1;
      return 0;
    });

    renderTable(filteredRecords);
  }

  function renderTable(records) {
    recordsTableBody.innerHTML = '';

    if (records.length === 0) {
      recordsTable.style.display = 'none';
      emptyState.classList.add('show');
    } else {
      recordsTable.style.display = 'table';
      emptyState.classList.remove('show');

      records.forEach(record => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${record.title}</td>
          <td class="job-id-cell">${escapeHtml(record.jobId || 'N/A')}</td>
          <td>${record.city}</td>
          <td>${record.state}</td>
          <td><a href="${record.link}" target="_blank">View Job</a></td>
          <td>${record.position}</td>
          <td>
              <button class="view-description-btn" data-description="${escapeHtml(record.description || '')}">View Description</button>
          </td>
        `;
        recordsTableBody.appendChild(row);
      });

      document.querySelectorAll('.view-description-btn').forEach(button => {
        button.addEventListener('click', (event) => {
          const description = event.target.dataset.description;
          if (description && description !== 'N/A' && description !== '') {
            showDescriptionModal(description);
          } else {
            showToast('No description available', 'error');
          }
        });
      });
    }

    updateRecordCount(records.length);
  }

  function loadRecords() {
    chrome.storage.local.get({ records: [] }, (result) => {
      allRecords = result.records;
      filteredRecords = [...allRecords];
      populateFilters(allRecords);
      renderTable(filteredRecords);
    });
  }

  // Search functionality
  searchInput.addEventListener('input', filterRecords);

  // Filter functionality
  stateFilter.addEventListener('change', filterRecords);
  positionFilter.addEventListener('change', filterRecords);

  // Sorting functionality
  document.querySelectorAll('.sortable').forEach(header => {
    header.addEventListener('click', () => {
      const column = header.dataset.column;

      // Remove sorted class from all headers
      document.querySelectorAll('.sortable').forEach(h => {
        h.classList.remove('sorted-asc', 'sorted-desc');
      });

      // Toggle sort direction
      if (sortColumn === column) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        sortDirection = 'asc';
      }

      sortColumn = column;

      // Add sorted class to current header
      header.classList.add(sortDirection === 'asc' ? 'sorted-asc' : 'sorted-desc');

      sortRecords(column, sortDirection);
    });
  });

  clearRecordsButton.addEventListener('click', () => {
    if (allRecords.length === 0) {
      showToast('No records to clear', 'error');
      return;
    }

    if (confirm('Are you sure you want to clear all records?')) {
      chrome.storage.local.set({ records: [] }, () => {
        allRecords = [];
        filteredRecords = [];
        loadRecords();
        showToast('All records cleared successfully', 'success');
      });
    }
  });

  downloadCsvButton.addEventListener('click', () => {
    if (allRecords.length === 0) {
      showToast('No records to download', 'error');
      return;
    }

    const headers = ['Title', 'Job ID', 'City', 'State', 'Link', 'Position', 'Hospital Name', 'Description'];
    let csvContent = headers.join(',') + '\n';

    allRecords.forEach(record => {
      const escapeCsvCell = (cell) => {
        const strCell = String(cell);
        if (strCell.includes(',') || strCell.includes('"') || strCell.includes('\n')) {
          return `"${strCell.replace(/"/g, '""')}"`;
        }
        return strCell;
      };

      const row = [
        escapeCsvCell(record.title),
        escapeCsvCell(record.jobId || 'N/A'),
        escapeCsvCell(record.city),
        escapeCsvCell(record.state),
        escapeCsvCell(record.link),
        escapeCsvCell(record.position),
        escapeCsvCell(record.hospitalName || 'N/A'),
        escapeCsvCell((record.description || '').replace(/[\r\n]+/g, ' '))
      ].join(',');
      csvContent += row + '\n';
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'jobs.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast('CSV downloaded successfully', 'success');
  });

  // Listen for description saved messages from background script
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'descriptionSaved') {
      console.log(`Description saved for job ${request.jobIndex + 1}, success: ${request.success}`);

      // Refresh records from storage
      chrome.storage.local.get({ records: [] }, (result) => {
        allRecords = result.records;
        filteredRecords = [...allRecords];
        filterRecords();

        // Update progress
        const total = allRecords.length;
        const withDesc = allRecords.filter(r => r.description && r.description.trim() !== '').length;
        const percent = Math.round((withDesc / total) * 100);
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
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
    chrome.storage.local.get({ records: [] }, (result) => {
      allRecords = result.records;

      // Find next job without description
      let foundJob = false;
      for (let i = 0; i < allRecords.length; i++) {
        if (!allRecords[i].description || allRecords[i].description.trim() === '') {
          currentJobIndex = i;
          foundJob = true;
          break;
        }
      }

      if (!foundJob) {
        isGettingDescriptions = false;
        getJobDescriptionsButton.disabled = false;
        getJobDescriptionsButton.innerHTML = `
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z" fill="currentColor"/>
          </svg>
          Get Job Descriptions`;
        document.getElementById('progressSection').classList.add('hidden');
        showToast('All jobs have descriptions now!', 'success');
        return;
      }

      const record = allRecords[currentJobIndex];
      console.log(`Processing job ${currentJobIndex + 1} of ${allRecords.length}: ${record.title}`);

      // Update progress
      const withDesc = allRecords.filter(r => r.description && r.description.trim() !== '').length;
      const percent = Math.round((withDesc / allRecords.length) * 100);
      const progressBar = document.getElementById('progressBar');
      const progressText = document.getElementById('progressText');
      progressBar.style.width = `${percent}%`;
      progressText.textContent = `${withDesc} / ${allRecords.length}`;

      // Open tab and send message to background to scrape
      chrome.tabs.create({ url: record.link, active: false }, (tab) => {
        chrome.runtime.sendMessage({
          action: 'scrapeJobDescription',
          tabId: tab.id,
          jobIndex: currentJobIndex,
          jobLink: record.link
        });
      });
    });
  }

  getJobDescriptionsButton.addEventListener('click', () => {
    if (allRecords.length === 0) {
      showToast('No records to get descriptions for', 'error');
      return;
    }

    const recordsWithoutDesc = allRecords.filter(r => !r.description || r.description.trim() === '');
    if (recordsWithoutDesc.length === 0) {
      showToast('All records already have descriptions', 'info');
      return;
    }

    if (confirm(`This will fetch descriptions for ${recordsWithoutDesc.length} jobs. Continue?`)) {
      isGettingDescriptions = true;
      getJobDescriptionsButton.disabled = true;
      getJobDescriptionsButton.textContent = 'Processing...';

      // Show progress
      const progressSection = document.getElementById('progressSection');
      const progressBar = document.getElementById('progressBar');
      const progressText = document.getElementById('progressText');
      progressSection.classList.remove('hidden');
      const withDesc = allRecords.filter(r => r.description && r.description.trim() !== '').length;
      const percent = Math.round((withDesc / allRecords.length) * 100);
      progressBar.style.width = `${percent}%`;
      progressText.textContent = `${withDesc} / ${allRecords.length}`;

      processNextJob();
    }
  });

  const webhookUrlInput = document.getElementById('webhookUrlInput');
  const defaultWebhookBaseUrl = 'http://localhost/zoho-api-main/webhookusvta/api/webhook.php';

  chrome.storage.local.get({ webhookUrl: defaultWebhookBaseUrl }, (result) => {
    webhookUrlInput.value = result.webhookUrl;
  });

  webhookUrlInput.addEventListener('input', () => {
    chrome.storage.local.set({ webhookUrl: webhookUrlInput.value });
  });

  const sendToWebhookButton = document.getElementById('sendToWebhook');
  sendToWebhookButton.addEventListener('click', async () => {
    if (allRecords.length === 0) {
      showToast('No records to send to webhook', 'error');
      return;
    }

    const webhookUrl = webhookUrlInput.value;
    if (!webhookUrl) {
      showToast('Please enter a webhook URL', 'error');
      return;
    }

    const BATCH_SIZE = 50;
    const totalBatches = Math.ceil(allRecords.length / BATCH_SIZE);

    if (!confirm(`Send ${allRecords.length} record(s) in ${totalBatches} batch(es) to webhook?`)) {
      return;
    }

    sendToWebhookButton.disabled = true;
    sendToWebhookButton.textContent = 'Sending...';

    // Show progress
    const progressSection = document.getElementById('progressSection');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    progressSection.classList.remove('hidden');
    progressBar.style.width = '0%';
    progressText.textContent = `0 / ${totalBatches} batches`;

    // Map records to webhook format
    const mappedRecords = allRecords.map(record => ({
      parent_client: 'MedVet',
      job_title: record.title || '',
      job_id: record.jobId || '',
      city: record.city || '',
      state: record.state || '',
      position: record.position || '',
      hospital: record.hospitalName || '',
      link: record.link || '',
      description: record.description || ''
    }));

    // Split into batches
    const batches = [];
    for (let i = 0; i < mappedRecords.length; i += BATCH_SIZE) {
      batches.push(mappedRecords.slice(i, i + BATCH_SIZE));
    }

    // Generate a unique sync ID
    const syncId = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);

    let successCount = 0;
    let errorCount = 0;

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      const batchNumber = batchIndex + 1;

      const percent = Math.round((batchNumber / totalBatches) * 100);
      progressBar.style.width = `${percent}%`;
      progressText.textContent = `Batch ${batchNumber} / ${totalBatches}`;

      const payload = {
        source: 'MedVet Job Scraper',
        parentClientName: 'MedVet',
        syncId: syncId,
        timestamp: new Date().toISOString(),
        batchNumber: batchNumber,
        totalBatches: totalBatches,
        batchSize: batch.length,
        totalRecords: allRecords.length,
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
    sendToWebhookButton.disabled = false;
    sendToWebhookButton.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" fill="currentColor"/>
      </svg>
      Send to Webhook`;

    if (errorCount === 0) {
      showToast(`Success! ${allRecords.length} records sent in ${totalBatches} batch(es).`, 'success');
    } else {
      showToast(`Partial: ${successCount} succeeded, ${errorCount} failed.`, 'error');
    }

    let resultMsg = `Webhook Complete!\nSync ID: ${syncId}\nTotal Records: ${allRecords.length}\nBatches Sent: ${totalBatches} (${BATCH_SIZE} per batch)\nSuccessful: ${successCount} | Failed: ${errorCount}`;
    alert(resultMsg);
  });

  loadRecords();
});
