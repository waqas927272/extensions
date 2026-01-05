// job-scraper-extension/content.js
(async () => {
    try {
        const data = await chrome.storage.local.get(['scraping', 'scrapedJobs', 'scrapedJobIds']);

        if (data.scraping) {
            const jobCount = data.scrapedJobs ? data.scrapedJobs.length : 0;
            const pageNum = Math.floor(jobCount / 6) + 1; // Rough page number
            await chrome.storage.local.set({ scrapingStatus: `Scraping page ${pageNum}... (${jobCount} jobs found so far)` });

            const scrapedJobIds = new Set(data.scrapedJobIds || []);
            const newScrape = scrapeCurrentPage(scrapedJobIds);

            const allJobs = (data.scrapedJobs || []).concat(newScrape.jobs);
            const allJobIds = Array.from(newScrape.scrapedJobIds);

            await chrome.storage.local.set({ 
                scrapedJobs: allJobs, 
                scrapedJobIds: allJobIds
            });
            
            const nextPageUrl = findNextPageUrl();

            if (nextPageUrl) {
                window.location.href = nextPageUrl;
            } else {
                await chrome.storage.local.set({
                    scraping: false,
                    scrapingComplete: true,
                    scrapingStatus: `Scraping complete! Found ${allJobs.length} total jobs.`,
                });
            }
        }
    } catch (error) {
        await chrome.storage.local.set({
            scraping: false,
            scrapingComplete: false,
            scrapingStatus: `An error occurred: ${error.message}`
        });
        console.error('Scraper content script error:', error);
    }
})();

function scrapeCurrentPage(scrapedJobIds) {
    const jobs = [];
    const jobArticles = document.querySelectorAll('article.article--result');

    jobArticles.forEach((article) => {
        try {
            const titleElement = article.querySelector('h3.article__header__text__title a.link');
            const jobLink = titleElement ? titleElement.href : null;

            if (!jobLink) {
                console.warn('Skipping article without a job link.');
                return;
            }

            // Use the numeric ID from the job link as the unique identifier
            const jobIdMatch = jobLink.match(/\/(\d+)/);
            const jobId = jobIdMatch ? jobIdMatch[1] : jobLink;

            if (scrapedJobIds.has(jobId)) {
                return; // Skip already scraped job
            }
            scrapedJobIds.add(jobId);

            const jobTitle = titleElement ? titleElement.textContent.trim() : 'N/A';

            const subtitleSpans = article.querySelectorAll('.article__header__subtitle span.paragraph--inline');
            let location = 'N/A';
            let city = 'N/A';
            let state = 'N/A';

            subtitleSpans.forEach((span) => {
                const text = span.textContent;
                if (text.includes('Location:')) {
                    location = text.replace('Location:', '').trim();
                } else if (text.includes('City:')) {
                    city = text.replace('City:', '').trim();
                } else if (text.includes('State:')) {
                    state = text.replace('State:', '').trim();
                }
            });

            jobs.push({
                jobTitle,
                location,
                city,
                state,
                link: jobLink
            });

        } catch (error) {
            console.error('Error parsing article:', error, article);
        }
    });

    return { jobs, scrapedJobIds };
}

function findNextPageUrl() {
    const nextButtonContainer = document.querySelector('.list-controls__pagination__item.next');
    if (!nextButtonContainer) {
        return null;
    }

    // On the last page, the 'next' container might exist but hold a span instead of an 'a'
    const nextButton = nextButtonContainer.querySelector('a');
    if (!nextButton || !nextButton.href) {
        return null;
    }

    // Also check if it's disabled by comparing with current URL
    if (nextButton.href === window.location.href) {
        return null;
    }

    return nextButton.href;
}