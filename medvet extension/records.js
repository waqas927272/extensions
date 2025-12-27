document.addEventListener('DOMContentLoaded', () => {
  const recordsTableBody = document.querySelector('#recordsTable tbody');
  const clearRecordsButton = document.getElementById('clearRecords');
  const downloadCsvButton = document.getElementById('downloadCsv');
  const getJobDescriptionsButton = document.getElementById('getJobDescriptions');
  let allRecords = [];

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
        <td>${record.description || 'N/A'}</td>
      `;
      recordsTableBody.appendChild(row);
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

    const headers = ['Title', 'City', 'State', 'Link', 'Position', 'Description'];
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
        escapeCsvCell(record.position),
        escapeCsvCell(record.description || 'N/A')
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

    for (let i = 0; i < allRecords.length; i++) {
      const record = allRecords[i];
      if (!record.description) { // Only fetch if description is not already present
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
        }
      }
    }

    // Save updated records to local storage
    chrome.storage.local.set({ records: allRecords }, () => {
      renderTable(allRecords); // Re-render the table with updated descriptions
      getJobDescriptionsButton.disabled = false;
      getJobDescriptionsButton.textContent = 'Get Job Descriptions';
      alert('Job descriptions fetched and updated!');
    });
  });

  loadRecords();
});
