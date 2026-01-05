const jobRows = document.querySelectorAll('.rt-tr-group');
const jobs = [];

jobRows.forEach(row => {
  const jobTitle = row.querySelector('.rt-td:nth-child(1)').innerText;
  const location = row.querySelector('.rt-td:nth-child(2)').innerText;
  const department = row.querySelector('.rt-td:nth-child(3)').innerText;
  const clinic = row.querySelector('.rt-td:nth-child(4)').innerText;
  const employmentType = row.querySelector('.rt-td:nth-child(5)').innerText;

  jobs.push({
    jobTitle,
    location,
    areaOfPractice: department,
    hospitalName: clinic,
    jobType: employmentType,
  });
});

chrome.runtime.sendMessage({ jobs: jobs, status: 'scraping_complete' });