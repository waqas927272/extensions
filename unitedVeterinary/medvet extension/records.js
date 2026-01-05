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

    const headers = ['Title', 'City', 'State', 'Link', 'Position', 'Hospital Name'];
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
        escapeCsvCell(record.city),
        escapeCsvCell(record.state),
        escapeCsvCell(record.link),
        escapeCsvCell(record.position),
        escapeCsvCell(record.hospitalName || 'N/A')
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

  getJobDescriptionsButton.addEventListener('click', async () => {
    const recordsToFetch = allRecords.filter(record => !record.description);

    if (recordsToFetch.length === 0) {
      showToast('All records already have descriptions', 'info');
      return;
    }

    getJobDescriptionsButton.disabled = true;
    getJobDescriptionsButton.textContent = 'Fetching Descriptions...';

    const concurrencyLimit = 5;
    let fetchedCount = 0;

    const updateProgress = () => {
      getJobDescriptionsButton.textContent = `Fetching... (${fetchedCount}/${recordsToFetch.length})`;
    };
    updateProgress();

    const fetchDescription = async (record) => {
      try {
        const response = await chrome.runtime.sendMessage({
          command: 'fetch-job-description',
          url: record.link
        });
        if (response && response.description) {
          record.description = response.description;
          record.hospitalName = response.hospitalName || 'N/A';
        } else {
          record.description = 'Could not fetch description.';
          record.hospitalName = 'N/A';
        }
      } catch (error) {
        console.error('Error fetching description for record:', record, error);
        record.description = 'Error fetching description.';
        record.hospitalName = 'N/A';
      } finally {
        fetchedCount++;
        updateProgress();
      }
    };

    const queue = [];
    for (const record of recordsToFetch) {
      queue.push(record);
    }

    let activeFetches = 0;

    const worker = async () => {
      while (queue.length > 0) {
        if (activeFetches >= concurrencyLimit) {
          await new Promise(resolve => setTimeout(resolve, 100));
          continue;
        }
        activeFetches++;
        const record = queue.shift();
        await fetchDescription(record);
        activeFetches--;
      }
    };

    const workers = Array(concurrencyLimit).fill(null).map(worker);
    await Promise.all(workers);

    chrome.storage.local.set({ records: allRecords }, () => {
      renderTable(filteredRecords);
      getJobDescriptionsButton.disabled = false;
      getJobDescriptionsButton.textContent = 'Get Job Descriptions';
      showToast('Job descriptions fetched successfully!', 'success');
    });
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

    sendToWebhookButton.disabled = true;
    sendToWebhookButton.textContent = 'Sending...';

    const webhookUrl = webhookUrlInput.value;

    try {
      const response = await chrome.runtime.sendMessage({
        command: 'send-to-webhook',
        url: webhookUrl,
        records: allRecords
      });

      if (response && response.success) {
        showToast('Records sent to webhook successfully!', 'success');
      } else {
        showToast('Failed to send records: ' + (response.error || 'Unknown error'), 'error');
      }
    } catch (error) {
      console.error('Error sending records to webhook:', error);
      showToast('An error occurred while sending records', 'error');
    } finally {
      sendToWebhookButton.disabled = false;
      sendToWebhookButton.textContent = 'Send to Webhook';
    }
  });

  loadRecords();
});
