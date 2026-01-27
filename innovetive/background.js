chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Save jobs to storage when received
  if (request.jobs) {
    chrome.storage.local.set({ jobs: request.jobs });
  }

  // Forward all status messages to the popup
  if (request.status) {
    chrome.runtime.sendMessage({
      status: request.status,
      message: request.message,
      totalJobs: request.totalJobs,
      totalPages: request.totalPages,
      error: request.error
    }).catch(() => {
      // Popup may be closed, ignore the error
    });
  }
});
