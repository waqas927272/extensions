// PetVet Care Centers Job Scraper - Background Script

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchJobDescription') {
    fetchJobDescription(request.url)
      .then(data => sendResponse(data))
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }
});

async function fetchJobDescription(url) {
  try {
    const response = await fetch(url);
    const html = await response.text();

    // Extract description using regex since we can't use DOMParser in service worker
    let description = '';

    // Try to find job description content
    const descMatch = html.match(/<div[^>]*class="[^"]*job-description[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (descMatch) {
      description = descMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    return { description };
  } catch (error) {
    console.error('Error fetching description:', error);
    return { error: error.message };
  }
}
