// offscreen.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.command === 'parse-html') {
    const html = message.html;
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    let description = 'Description not found.';

    // Attempt to find common elements that might contain the job description
    const possibleDescriptionContainers = [
      'div.job-description',
      'div.description',
      'div#job-details',
      'div.details',
      'article',
      'body' // Fallback to entire body if nothing else is found
    ];

    for (const selector of possibleDescriptionContainers) {
      const element = doc.querySelector(selector);
      if (element && element.textContent.trim().length > 100) { // Look for substantial content
        description = element.textContent.trim();
        break;
      }
    }
    sendResponse({ description: description });
  }
  return true; // Indicates that the response is sent asynchronously
});