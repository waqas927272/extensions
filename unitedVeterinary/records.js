document.addEventListener('DOMContentLoaded', () => {
    const tableBody = document.querySelector('#jobRecordsTable tbody');
    const tableHeaders = document.querySelectorAll('#jobRecordsTable th');
    const clearRecordsButton = document.getElementById('clearRecords');
    const jobCountElement = document.getElementById('jobCount'); // Get the job count element
    let currentSortColumn = null;
    let currentSortDirection = 'asc'; // 'asc' or 'desc'
  
    function updateJobCount(count) {
      jobCountElement.textContent = `Total Scraped Jobs: ${count}`;
    }

    function displayRecords(jobs) {
      tableBody.innerHTML = ''; // Clear existing records
      updateJobCount(jobs.length); // Update the count display

      if (jobs.length === 0) {
        const row = tableBody.insertRow();
        const cell = row.insertCell(0);
        cell.colSpan = 5;
        cell.textContent = 'No records found.';
        return;
      }
  
      jobs.forEach(job => {
        const row = tableBody.insertRow();
        row.insertCell(0).textContent = job.title;
        row.insertCell(1).textContent = job.hospital;
        row.insertCell(2).textContent = job.state;
        row.insertCell(3).textContent = job.country;
        const linkCell = row.insertCell(4);
        const link = document.createElement('a');
        link.href = job.link;
        link.textContent = job.link;
        link.target = '_blank'; // Open link in a new tab
        linkCell.appendChild(link);
      });
    }
  
    function sortRecords(column, direction, records) {
      return [...records].sort((a, b) => {
        const valA = a[column].toLowerCase();
        const valB = b[column].toLowerCase();
  
        if (valA < valB) {
          return direction === 'asc' ? -1 : 1;
        }
        if (valA > valB) {
          return direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }
  
    // Load and display records initially
    chrome.storage.local.get(['scrapedJobs'], (result) => {
      let jobs = result.scrapedJobs || [];
      displayRecords(jobs); // This will also update the job count
  
      // Add sort functionality to headers
      tableHeaders.forEach(header => {
        header.addEventListener('click', () => {
          const column = header.dataset.sort;
          if (!column) return;
  
          // Reset sort direction if clicking a new column
          if (currentSortColumn === column) {
            currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
          } else {
            currentSortColumn = column;
            currentSortDirection = 'asc';
          }
  
          // Clear previous sort indicators
          tableHeaders.forEach(th => {
            th.classList.remove('sort-asc', 'sort-desc');
          });
  
          // Add current sort indicator
          header.classList.add(`sort-${currentSortDirection}`);
  
          const sortedJobs = sortRecords(currentSortColumn, currentSortDirection, jobs);
          displayRecords(sortedJobs);
        });
      });
    });
  
    // Clear records functionality
    clearRecordsButton.addEventListener('click', () => {
      if (confirm('Are you sure you want to clear all scraped job records?')) {
        chrome.storage.local.set({ scrapedJobs: [] }, () => {
          displayRecords([]); // Clear table display and update count to 0
          console.log('All scraped job records cleared.');
        });
      }
    });
  });