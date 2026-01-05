chrome.storage.local.get('jobs', (data) => {
  const jobsTable = document.getElementById('jobs-table').getElementsByTagName('tbody')[0];
  if (data.jobs) {
    data.jobs.forEach(job => {
      const newRow = jobsTable.insertRow();
      newRow.innerHTML = `
        <td>${job.jobTitle}</td>
        <td>${job.location}</td>
        <td>${job.areaOfPractice}</td>
        <td>${job.hospitalName}</td>
        <td>${job.jobType}</td>
      `;
    });
  }
});
