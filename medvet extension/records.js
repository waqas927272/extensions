document.addEventListener('DOMContentLoaded', () => {
  const recordsTableBody = document.querySelector('#recordsTable tbody');
  const clearRecordsButton = document.getElementById('clearRecords');
  const downloadCsvButton = document.getElementById('downloadCsv');
  const getJobDescriptionsButton = document.getElementById('getJobDescriptions');
  let allRecords = [];

  const descriptionModal = document.getElementById('descriptionModal');
  const modalDescriptionContent = document.getElementById('modalDescriptionContent');
  const closeButton = document.querySelector('.close-button');

  function showDescriptionModal(description) {
    modalDescriptionContent.innerHTML = description;
    descriptionModal.style.display = 'block';
  }

  function hideDescriptionModal() {
    descriptionModal.style.display = 'none';
    modalDescriptionContent.textContent = ''; // Clear content on close
  }

  closeButton.addEventListener('click', hideDescriptionModal);

  window.addEventListener('click', (event) => {
    if (event.target === descriptionModal) {
      hideDescriptionModal();
    }
  });

  // Helper function to HTML-escape a string
  function escapeHtml(unsafe) {
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function loadRecords() {
    chrome.storage.local.get({ records: [] }, (result) => {
      allRecords = result.records;
      renderTable(allRecords);
    });
  }

  function renderTable(records) {
    recordsTableBody.innerHTML = ''; // Clear existing rows
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

    // Add event listeners to the new buttons
    document.querySelectorAll('.view-description-btn').forEach(button => {
        button.addEventListener('click', (event) => {
            const description = event.target.dataset.description;
            if (description && description !== 'N/A') {
                showDescriptionModal(description);
            } else {
                alert('No description available.');
            }
        });
    });
  }

  clearRecordsButton.addEventListener('click', () => {
    chrome.storage.local.set({ records: [] }, () => {
      loadRecords(); // Refresh the table
    });
  });

  downloadCsvButton.addEventListener('click', () => {
    if (allRecords.length === 0) {
      alert('No records to download.');
      return;
    }

    const headers = ['Title', 'City', 'State', 'Link', 'Position'];
    let csvContent = headers.join(',') + '\n';

    allRecords.forEach(record => {
      const escapeCsvCell = (cell) => {
        const strCell = String(cell);
        if (strCell.includes(',')) {
          return `"${strCell}"`;
        }
        return strCell;
      };

      const row = [
        escapeCsvCell(record.title),
        escapeCsvCell(record.city),
        escapeCsvCell(record.state),
        escapeCsvCell(record.link),
        escapeCsvCell(record.position)
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
  });

  getJobDescriptionsButton.addEventListener('click', async () => {
    getJobDescriptionsButton.disabled = true; // Disable button during fetching
    getJobDescriptionsButton.textContent = 'Fetching Descriptions...';

    const recordsToFetch = allRecords.filter(record => !record.description);
    const concurrencyLimit = 5; // Number of concurrent requests

    let activeFetches = 0;
    let fetchedCount = 0;
    const updateProgress = () => {
      getJobDescriptionsButton.textContent = `Fetching Descriptions... (${fetchedCount}/${recordsToFetch.length})`;
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
        } else {
          record.description = 'Could not fetch description.';
        }
      } catch (error) {
        console.error('Error fetching description for record:', record, error);
        record.description = 'Error fetching description.';
      } finally {
        fetchedCount++;
        updateProgress();
      }
    };

    const queue = [];
    for (const record of recordsToFetch) {
      queue.push(record);
    }

    const worker = async () => {
      while (queue.length > 0) {
        if (activeFetches >= concurrencyLimit) {
          await new Promise(resolve => setTimeout(resolve, 100)); // Wait a bit before checking again
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

    // Save updated records to local storage
    chrome.storage.local.set({ records: allRecords }, () => {
      renderTable(allRecords); // Re-render the table with updated descriptions
      getJobDescriptionsButton.disabled = false;
      getJobDescriptionsButton.textContent = 'Get Job Descriptions';
      alert('Job descriptions fetched and updated!');
    });
  });

  // Webhook URL input and storage
  const webhookUrlInput = document.getElementById('webhookUrlInput');
  const defaultWebhookBaseUrl = 'http://localhost/zoho-api-main/webhookusvta/'; // Keep default for new users

  // Function to ensure URL has ?action=receive
  const ensureReceiveAction = (url) => {
    if (url.includes('?')) {
        const urlObj = new URL(url);
        if (!urlObj.searchParams.has('action')) {
            urlObj.searchParams.set('action', 'receive');
            return urlObj.toString();
        }
        return url;
    }
    return `${url}?action=receive`;
  };

  // Load saved webhook URL
  chrome.storage.local.get({ webhookUrl: ensureReceiveAction(defaultWebhookBaseUrl) }, (result) => {
    webhookUrlInput.value = result.webhookUrl;
  });

  // Save webhook URL on input change
  webhookUrlInput.addEventListener('input', () => {
    chrome.storage.local.set({ webhookUrl: ensureReceiveAction(webhookUrlInput.value) });
  });

  // Send to Webhook button functionality
  const sendToWebhookButton = document.getElementById('sendToWebhook');
  sendToWebhookButton.addEventListener('click', async () => {
    if (allRecords.length === 0) {
      alert('No records to send to webhook.');
      return;
    }

    sendToWebhookButton.disabled = true;
    sendToWebhookButton.textContent = 'Sending...';

    const webhookUrl = ensureReceiveAction(webhookUrlInput.value); // Get URL from input field and ensure action

    try {
      const response = await chrome.runtime.sendMessage({
        command: 'send-to-webhook',
        url: webhookUrl,
        records: allRecords
      });

      if (response && response.success) {
        alert('Records successfully sent to webhook!');
      } else {
        alert('Failed to send records to webhook: ' + (response.error || 'Unknown error.'));
      }
    } catch (error) {
      console.error('Error sending records to webhook:', error);
      alert('An error occurred while sending records to webhook.');
    } finally {
      sendToWebhookButton.disabled = false;
      sendToWebhookButton.textContent = 'Send to Webhook';
    }
  });

  loadRecords();
});
