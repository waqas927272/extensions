document.addEventListener('DOMContentLoaded', () => {
  const recordsTableBody = document.querySelector('#recordsTable tbody');
  const clearRecordsButton = document.getElementById('clearRecords');
  const downloadCsvButton = document.getElementById('downloadCsv');
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

  loadRecords();
});
