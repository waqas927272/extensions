// PetVet Care Centers Job Scraper - Content Script

// Listen for messages from popup or background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getJobCount') {
    const count = document.querySelectorAll('.results-list__item').length;
    sendResponse({ count: count });
  }
  return true;
});

console.log('PetVet Job Scraper content script loaded');
