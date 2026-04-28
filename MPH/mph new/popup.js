document.addEventListener('DOMContentLoaded', () => {
    const startScrapingButton = document.getElementById('startScraping');
    const stopScrapingButton = document.getElementById('stopScraping');
    const viewRecordsButton = document.getElementById('viewRecords');
    const loadingIndicator = document.getElementById('loadingIndicator');
    const spinnerText = loadingIndicator.querySelector('span');

    let hasShownTerminalAlert = false;

    function setButtonsState({ scraping }) {
        startScrapingButton.disabled = !!scraping;
        stopScrapingButton.disabled = !scraping;
    }

    function setLoading(message, visible) {
        if (spinnerText) {
            spinnerText.textContent = message || 'Scraping... Please wait.';
        }
        loadingIndicator.classList.toggle('hidden', !visible);
    }

    async function refreshPopupState(showAlerts = false) {
        const data = await chrome.storage.local.get([
            'scraping',
            'scrapingStatus',
            'scrapingComplete',
            'scrapedJobs'
        ]);

        const scraping = !!data.scraping;
        const scrapingComplete = !!data.scrapingComplete;
        const scrapedCount = (data.scrapedJobs || []).length;
        const message = data.scrapingStatus || 'Scraping... Please wait.';

        setButtonsState({ scraping });

        if (scraping) {
            setLoading(message, true);
            hasShownTerminalAlert = false;
            return;
        }

        setLoading('Scraping... Please wait.', false);

        if (showAlerts && scrapingComplete && !hasShownTerminalAlert) {
            hasShownTerminalAlert = true;
            alert(message || `Scraping completed! Scraped ${scrapedCount} jobs.`);
            await chrome.storage.local.set({ scrapingComplete: false });
        }
    }

    startScrapingButton.addEventListener('click', () => {
        hasShownTerminalAlert = false;
        setLoading('Initializing scraping...', true);
        setButtonsState({ scraping: true });

        chrome.runtime.sendMessage({ action: 'startScraping' }, (response) => {
            if (chrome.runtime.lastError) {
                setLoading('Scraping... Please wait.', false);
                setButtonsState({ scraping: false });
                alert(`Scraping error: ${chrome.runtime.lastError.message}`);
                return;
            }

            if (response?.status === 'error') {
                setLoading('Scraping... Please wait.', false);
                setButtonsState({ scraping: false });
                alert(response.message || 'Unable to start scraping.');
            }
        });
    });

    stopScrapingButton.addEventListener('click', () => {
        if (spinnerText) spinnerText.textContent = 'Stopping scraping...';
        chrome.runtime.sendMessage({ action: 'stopScraping' });
    });

    viewRecordsButton.addEventListener('click', () => {
        chrome.tabs.create({ url: 'records.html' });
    });

    refreshPopupState(false);
    setInterval(() => {
        refreshPopupState(true).catch((error) => {
            console.error('Failed to refresh popup state:', error);
        });
    }, 1000);
});
