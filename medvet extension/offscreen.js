// offscreen.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.command === 'parse-html') {
    const html = message.html;
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    let description = 'Description not found.';

    // --- 1. Attempt to extract from JSON-LD (JobPosting schema) ---
    const scriptLdJson = doc.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scriptLdJson) {
      try {
        const json = JSON.parse(script.textContent);
        if (json['@type'] === 'JobPosting' && json.description && json.description.length > 100) {
          description = json.description;
          sendResponse({ description: description });
          return true; // Stop and send response
        }
      } catch (e) {
        console.warn('Could not parse JSON-LD script:', e);
      }
    }

    // --- 2. Fallback to DOM parsing, excluding scripts and styles ---
    // Create a clone of the body to remove script and style tags without affecting the original doc
    const cleanBody = doc.body.cloneNode(true);
    cleanBody.querySelectorAll('script, style').forEach(el => el.remove());

    // Attempt to find common elements that might contain the job description
    const possibleDescriptionContainers = [
      'div.job-description',
      'div.description',
      'div#job-details',
      'div.details',
      'article',
      'body' // Fallback to entire clean body if nothing else is found
    ];

    for (const selector of possibleDescriptionContainers) {
      const element = cleanBody.querySelector(selector); // Query on the clean body
      if (element && element.textContent.trim().length > 100) { // Look for substantial content
        description = element.textContent.trim();
        break;
      }
    }
    sendResponse({ description: description });
  }
  return true; // Indicates that the response is sent asynchronously
});