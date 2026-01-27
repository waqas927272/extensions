// Load and display job count on popup open
function updateJobCount() {
  chrome.storage.local.get('jobs', (data) => {
    const count = data.jobs ? data.jobs.length : 0;
    document.getElementById('job-count').textContent = count;
  });
}

// Initialize
updateJobCount();

// Set up message listener for progress updates and completion
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const spinner = document.getElementById('loading-spinner');
  const spinnerText = spinner.querySelector('span');
  const messageElement = document.getElementById('message');

  if (request.status === 'scraping_progress') {
    // Update spinner text with progress
    spinnerText.textContent = request.message;
  }

  if (request.status === 'scraping_complete') {
    spinner.classList.add('hidden');
    spinnerText.textContent = 'Scraping jobs...';

    const totalJobs = request.totalJobs || 0;
    const totalPages = request.totalPages || 1;

    messageElement.textContent = `Done! Scraped ${totalJobs} jobs from ${totalPages} page(s)`;
    messageElement.className = 'success';
    updateJobCount();
  }

  if (request.status === 'scraping_error') {
    spinner.classList.add('hidden');
    spinnerText.textContent = 'Scraping jobs...';
    messageElement.textContent = `Error: ${request.error}`;
    messageElement.className = 'error';
  }
});

document.getElementById('scrape-jobs').addEventListener('click', () => {
  const spinner = document.getElementById('loading-spinner');
  const spinnerText = spinner.querySelector('span');

  spinnerText.textContent = 'Starting scrape...';
  spinner.classList.remove('hidden');
  document.getElementById('message').classList.add('hidden');

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) {
      spinner.classList.add('hidden');
      const messageElement = document.getElementById('message');
      messageElement.textContent = 'No active tab found.';
      messageElement.className = 'error';
      return;
    }

    chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      files: ['content.js']
    }).catch((error) => {
      spinner.classList.add('hidden');
      const messageElement = document.getElementById('message');
      messageElement.textContent = 'Navigate to Innovetive Careers page first.';
      messageElement.className = 'error';
    });
  });
});

document.getElementById('view-saved-jobs').addEventListener('click', () => {
  chrome.tabs.create({ url: 'saved_jobs.html' });
});

document.getElementById('clear-jobs').addEventListener('click', () => {
  if (confirm('Are you sure you want to clear all saved jobs?')) {
    chrome.storage.local.remove('jobs', () => {
      updateJobCount();
      const messageElement = document.getElementById('message');
      messageElement.textContent = 'All jobs cleared!';
      messageElement.className = 'success';
    });
  }
});
