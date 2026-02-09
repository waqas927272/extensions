// Shore Capital Job Scraper - Background Script

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'scrapeJobDescription') {
    const { tabId, jobIndex, jobLink } = request;

    chrome.tabs.onUpdated.addListener(function listener(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);

        // Use async polling function since jobs.shorecp.com is a React SPA
        // that renders content after page load completes
        chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: async () => {
            const maxAttempts = 20; // 10 seconds max (20 x 500ms)
            for (let attempt = 0; attempt < maxAttempts; attempt++) {
              // Try JSON-LD structured data first
              const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
              for (const script of jsonLdScripts) {
                try {
                  const data = JSON.parse(script.textContent);
                  if (data['@type'] === 'JobPosting' && data.description && data.description.length > 50) {
                    const temp = document.createElement('div');
                    temp.innerHTML = data.description;
                    let text = temp.innerText.trim();
                    if (/<[a-z][\s\S]*>/i.test(text)) {
                      temp.innerHTML = text;
                      text = temp.innerText.trim();
                    }
                    return text;
                  }
                } catch (e) {}
              }

              // Try DOM selectors for the job description
              const selectors = [
                '.job-description',
                '.job-details-description',
                '.job-detail-description',
                '.job-detail-body',
                '.job-content',
                '.job-detail-content',
                '.posting-description',
                '[class*="job-description"]',
                '[class*="jobDescription"]',
                '[class*="description-body"]',
                '[itemprop="description"]',
                '.rich-text-content',
                '.ql-editor'
              ];

              for (const selector of selectors) {
                const el = document.querySelector(selector);
                if (el && el.innerText.trim().length > 50) {
                  const cloned = el.cloneNode(true);
                  cloned.querySelectorAll('script, style, nav, header, footer, form, button, .apply-button').forEach(node => node.remove());
                  let text = cloned.innerText.trim();
                  if (/<[a-z][\s\S]*>/i.test(text)) {
                    const temp = document.createElement('div');
                    temp.innerHTML = text;
                    text = temp.innerText.trim();
                  }
                  if (text.length > 50) return text;
                }
              }

              // Wait 500ms before trying again
              await new Promise(r => setTimeout(r, 500));
            }
            return '';
          }
        }).then((results) => {
          const description = (results && results[0] && results[0].result) ? results[0].result : '';

          chrome.storage.local.get(['shoreCapitalJobs'], (result) => {
            const jobs = result.shoreCapitalJobs || [];
            if (jobs[jobIndex]) {
              jobs[jobIndex].description = description;

              chrome.storage.local.set({ shoreCapitalJobs: jobs }, () => {
                console.log(`Description saved for job ${jobIndex + 1}`);
                chrome.tabs.remove(tabId);
                chrome.runtime.sendMessage({
                  action: 'descriptionSaved',
                  jobIndex: jobIndex,
                  success: true
                });
              });
            }
          });
        }).catch(err => {
          console.error('Error extracting description:', err);
          chrome.tabs.remove(tabId).catch(() => {});
          chrome.runtime.sendMessage({
            action: 'descriptionSaved',
            jobIndex: jobIndex,
            success: false
          });
        });
      }
    });

    return true;
  }

  return true;
});
