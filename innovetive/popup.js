document.getElementById('scrape-jobs').addEventListener('click', () => {
  document.getElementById('loading-spinner').classList.remove('hidden');
  document.getElementById('message').classList.add('hidden'); // Hide any previous messages

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      files: ['content.js']
    }, () => {
      // Script injection complete, now content.js should send a message back
      // No need to hide spinner here, background.js will handle it.
    });
  });
});

document.getElementById('view-saved-jobs').addEventListener('click', () => {
  chrome.tabs.create({ url: 'saved_jobs.html' });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.status === 'scraping_complete') {
    document.getElementById('loading-spinner').classList.add('hidden');
    const messageElement = document.getElementById('message');
    messageElement.textContent = 'Scraping complete!';
    messageElement.classList.remove('hidden');
  }
});