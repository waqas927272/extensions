// offscreen.js
function cleanText(html) {
  // First, remove all HTML tags using a regular expression
  let text = html.replace(/<[^>]*>/g, '');

  // Then, decode HTML entities (e.g., &amp; -> &)
  // We can do this by creating a temporary DOM element, though in an offscreen
  // document with limited DOM APIs, we should be careful. A DOMParser is safer.
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'text/html');
  text = doc.body.textContent || '';


  // Finally, normalize whitespace
  text = text.replace(/(\s*\n\s*){2,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim();

  return text;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.command === 'parse-html') {
    const html = message.html;
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    let description = 'Description not found.';
    let hospitalName = 'N/A'; // Initialize hospitalName

    // --- 1. Attempt to extract from JSON-LD (JobPosting schema) ---
    const scriptLdJson = doc.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scriptLdJson) {
      try {
        const json = JSON.parse(script.textContent);
        if (json['@type'] === 'JobPosting') {
          if (json.description) {
            description = cleanText(json.description);
          }
          if (json.hiringOrganization && json.hiringOrganization.name) {
            hospitalName = json.hiringOrganization.name;
          }
          // If both found, we can potentially stop early for JSON-LD
          if (description !== 'Description not found.' && hospitalName !== 'N/A') {
            sendResponse({ description: description, hospitalName: hospitalName });
            return true;
          }
        }
      } catch (e) {
        console.warn('Could not parse JSON-LD script:', e);
      }
    }

    // --- 2. Fallback to DOM parsing, excluding scripts and styles ---
    // Create a clone of the body to remove script and style tags without affecting the original doc
    const cleanBody = doc.body.cloneNode(true);
    cleanBody.querySelectorAll('script, style').forEach(el => el.remove());

    // Attempt to find hospital name from prominent elements
    const possibleHospitalNameContainers = [
      'h1.company-name',
      'h1.hospital-name',
      'h2.company-name',
      'h2.hospital-name',
      'a.company-name',
      'a.hospital-name',
      '.job-company-name',
      '.company-name', // More generic
      '.company-header', // Common
      '.company',
      'strong.employer-name', // Specific for some job boards like Indeed
      'span[itemprop="hiringOrganization"]', // Microdata
      'div[itemprop="hiringOrganization"]',  // Microdata
      'h1',
      'h2'
    ];

    for (const selector of possibleHospitalNameContainers) {
      const element = cleanBody.querySelector(selector);
      if (element && element.textContent.trim().length > 0) {
        hospitalName = element.textContent.trim();
        break;
      }
    }

    // Try to extract from meta tags if not found yet
    if (hospitalName === 'N/A') {
      const ogSiteName = doc.querySelector('meta[property="og:site_name"]');
      if (ogSiteName && ogSiteName.content.trim().length > 0) {
        hospitalName = ogSiteName.content.trim();
      } else {
        const applicationName = doc.querySelector('meta[name="application-name"]');
        if (applicationName && applicationName.content.trim().length > 0) {
          hospitalName = applicationName.content.trim();
        }
      }
    }


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
        description = cleanText(element.innerHTML); // Use innerHTML to preserve some formatting, then clean
        break;
      }
    }
    sendResponse({ description: description, hospitalName: hospitalName });
  }
  return true; // Indicates that the response is sent asynchronously
});