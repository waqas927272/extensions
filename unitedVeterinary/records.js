document.addEventListener('DOMContentLoaded', () => {
    const tableBody = document.querySelector('#jobRecordsTable tbody');
    const tableHeaders = document.querySelectorAll('#jobRecordsTable th');
    const clearRecordsButton = document.getElementById('clearRecords');
    const webhookUrlInput = document.getElementById('webhookUrl');
    const sendToWebhookButton = document.getElementById('sendToWebhook');
    const jobCountElement = document.getElementById('jobCount');
    let currentSortColumn = null;
    let currentSortDirection = 'asc';
    let allJobs = [];

    if (!tableBody) {
        console.error('Could not find table body!');
        return;
    }

    function updateJobCount(count) {
      jobCountElement.textContent = `Total Scraped Jobs: ${count}`;
    }

    function displayRecords(jobs) {
      tableBody.innerHTML = '';
      updateJobCount(jobs.length);

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
        row.insertCell(2).textContent = job.city;
        row.insertCell(3).textContent = job.location;
        const linkCell = row.insertCell(4);
        const link = document.createElement('a');
        link.href = job.link;
        link.textContent = job.link;
        link.target = '_blank';
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

    chrome.storage.local.get(['scrapedJobs'], (result) => {
      allJobs = result.scrapedJobs || [];
      displayRecords(allJobs);
  
      tableHeaders.forEach(header => {
        header.addEventListener('click', () => {
          const column = header.dataset.sort;
          if (!column) return;
  
          if (currentSortColumn === column) {
            currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
          } else {
            currentSortColumn = column;
            currentSortDirection = 'asc';
          }
  
          tableHeaders.forEach(th => {
            th.classList.remove('sort-asc', 'sort-desc');
          });
  
          header.classList.add(`sort-${currentSortDirection}`);
  
          const sortedJobs = sortRecords(currentSortColumn, currentSortDirection, allJobs);
          displayRecords(sortedJobs);
        });
      });
    });
  
    clearRecordsButton.addEventListener('click', () => {
      if (confirm('Are you sure you want to clear all scraped job records?')) {
        chrome.storage.local.set({ scrapedJobs: [] }, () => {
          allJobs = [];
          displayRecords([]);
        });
      }
    });

    sendToWebhookButton.addEventListener('click', () => {
        const webhookUrl = webhookUrlInput.value.trim();

        if (!webhookUrl) {
            alert('Please enter a Webhook URL.');
            return;
        }

        try {
            new URL(webhookUrl);
        } catch (e) {
            alert('Please enter a valid URL for the Webhook.');
            return;
        }

        chrome.storage.local.get(['scrapedJobs'], async (result) => {
            const jobsToSend = result.scrapedJobs || [];

            if (jobsToSend.length === 0) {
                alert('No job records to send.');
                return;
            }

            const formattedJobs = jobsToSend.map(job => {
                return {
                    job_title: job.title,
                    hospital: job.hospital,
                    parent_client: "United Veterinary Care",
                    city: job.city,
                    state: job.state,
                    location: job.location,
                    link: job.link
                };
            });

            try {
                const response = await fetch(webhookUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ data: formattedJobs, mode: 'add' }),
                });

                if (response.ok) {
                    alert('Job records successfully sent to webhook!');
                } else {
                    const errorText = await response.text();
                    alert(`Failed to send job records to webhook. Status: ${response.status}. Response: ${errorText}`);
                }
            } catch (error) {
                console.error('Error sending to webhook:', error);
                alert('An error occurred while sending data to the webhook. Check console for details.');
            }
        });
    });
});