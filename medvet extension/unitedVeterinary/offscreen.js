// offscreen.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.command === 'parse-html') {
    console.log("Offscreen document received 'parse-html' command.");
    const html = message.html;
    const parser = new DOMParser();
    let description = 'Description not found.';
    let hospitalName = 'N/A'; // Initialize hospitalName
    let doc;

    try {
      doc = parser.parseFromString(html, 'text/html');
    } catch (parseError) {
      console.error("Offscreen document: Error parsing HTML:", parseError);
      sendResponse({ description: 'Error parsing HTML.', hospitalName: 'N/A' });
      return true;
    }

    // --- 1. Attempt to extract from JSON-LD (JobPosting schema) ---
    const scriptLdJson = doc.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scriptLdJson) {
      try {
        const json = JSON.parse(script.textContent);
        if (json['@type'] === 'JobPosting') {
          if (json.description && json.description.length > 100) {
            description = json.description;
          }
          if (json.hiringOrganization && json.hiringOrganization.name) {
            hospitalName = json.hiringOrganization.name;
          }
          // If both found, we can potentially stop early for JSON-LD
          if (description !== 'Description not found.' && hospitalName !== 'N/A') {
            console.log("Offscreen document: Found description and hospital name from JSON-LD.");
            sendResponse({ description: description, hospitalName: hospitalName });
            return true;
          }
        }
      } catch (e) {
        console.warn('Offscreen document: Could not parse JSON-LD script:', e);
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
        console.log("Offscreen document: Found hospital name from DOM selector:", selector);
        break;
      }
    }

    // Try to extract from meta tags if not found yet
    if (hospitalName === 'N/A') {
      const ogSiteName = doc.querySelector('meta[property="og:site_name"]');
      if (ogSiteName && ogSiteName.content.trim().length > 0) {
        hospitalName = ogSiteName.content.trim();
        console.log("Offscreen document: Found hospital name from og:site_name meta tag.");
      } else {
        const applicationName = doc.querySelector('meta[name="application-name"]');
        if (applicationName && applicationName.content.trim().length > 0) {
          hospitalName = applicationName.content.trim();
          console.log("Offscreen document: Found hospital name from application-name meta tag.");
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
        description = element.textContent.trim();
        console.log("Offscreen document: Found description from DOM selector:", selector);
        break;
      }
    }
    console.log("Offscreen document: Sending response with description and hospitalName.");
    sendResponse({ description: description, hospitalName: hospitalName });
  }
  return true; // Indicates that the response is sent asynchronously
});