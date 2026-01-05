chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.jobs) {
    chrome.storage.local.set({ jobs: request.jobs });
  }
  // Forward the status message to the popup
  if (request.status) {
    chrome.runtime.sendMessage({ status: request.status });
  }
});