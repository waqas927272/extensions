(async function() {
  const allJobs = [];
  let currentPage = 1;
  let hasNextPage = true;
  const TARGET_DEPARTMENT = 'Veterinarians';

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function waitForElement(selector, timeout = 5000) {
    return new Promise((resolve) => {
      const existing = document.querySelector(selector);
      if (existing) {
        resolve(existing);
        return;
      }

      const startTime = Date.now();
      const check = () => {
        const element = document.querySelector(selector);
        if (element) {
          resolve(element);
          return;
        }

        if (Date.now() - startTime >= timeout) {
          resolve(null);
          return;
        }

        setTimeout(check, 100);
      };

      check();
    });
  }

  function setNativeInputValue(input, value) {
    const valueSetter = Object.getOwnPropertyDescriptor(input, 'value')?.set;
    const prototype = Object.getPrototypeOf(input);
    const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

    if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
      prototypeValueSetter.call(input, value);
    } else if (valueSetter) {
      valueSetter.call(input, value);
    } else {
      input.value = value;
    }

    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function getDepartmentFilterButton() {
    return Array.from(document.querySelectorAll('.filter__button'))
      .find(button => button.innerText.trim().includes('All Departments') || button.innerText.trim().includes(TARGET_DEPARTMENT));
  }

  function shouldSkipListingJob(title) {
    return /\binternship\b|\bintern\b|\bexternship\b|\bextern\b/i.test(title || '');
  }

  async function applyDepartmentFilter() {
    const departmentButton = getDepartmentFilterButton();
    if (!departmentButton) {
      throw new Error('Department filter button not found.');
    }

    departmentButton.click();

    const dropdown = await waitForElement('.filter__dropdown', 5000);
    if (!dropdown) {
      throw new Error('Department filter dropdown did not open.');
    }

    const searchInput = dropdown.querySelector('input[type="search"].filter__dropdown-search');
    if (searchInput) {
      searchInput.focus();
      setNativeInputValue(searchInput, TARGET_DEPARTMENT);
      await sleep(500);
    }

    const targetItem = Array.from(document.querySelectorAll('.filter__dropdown .filter__dropdown-item'))
      .find(item => {
        const label = item.querySelector('.filter__dropdown-item-label');
        return label && label.innerText.trim() === TARGET_DEPARTMENT;
      });

    if (!targetItem) {
      throw new Error(`${TARGET_DEPARTMENT} department option not found.`);
    }

    if (targetItem.getAttribute('aria-selected') !== 'true') {
      targetItem.click();
      await sleep(300);
    }

    const applyButton = Array.from(document.querySelectorAll('.filter__dropdown button'))
      .find(button => button.innerText.trim().toLowerCase() === 'apply filters');

    if (!applyButton) {
      throw new Error('Apply Filters button not found.');
    }

    applyButton.click();
    await sleep(5000);
  }

  // Function to scrape jobs from the current page
  function scrapeCurrentPage() {
    const jobRows = document.querySelectorAll('.rt-tr-group');
    const jobs = [];

    jobRows.forEach(row => {
      const titleEl = row.querySelector('.rt-td:nth-child(1)');
      const locationEl = row.querySelector('.rt-td:nth-child(2)');
      const clinicEl = row.querySelector('.rt-td:nth-child(4)');

      // Only add if we have valid data (skip empty rows)
      if (titleEl && titleEl.innerText.trim()) {
        const jobTitle = titleEl.innerText.trim();
        if (shouldSkipListingJob(jobTitle)) {
          return;
        }

        // Get the job link if available
        const linkEl = row.querySelector('a[href*="/postings/"]');
        const jobLink = linkEl ? linkEl.href : '';

        // Extract job ID from URL (handles /postings/1234 pattern)
        const jobIdMatch = jobLink.match(/\/postings\/([^\/\?#]+)/);
        const rawJobId = jobIdMatch ? jobIdMatch[1] : (jobLink ? jobLink.split('/').pop() : '');
        const jobId = rawJobId ? 'INV-' + rawJobId : '';

        jobs.push({
          jobTitle,
          jobId: jobId,
          location: locationEl ? locationEl.innerText.trim() : '',
          areaOfPractice: '',
          hospitalName: clinicEl ? clinicEl.innerText.trim() : '',
          jobType: '',
          link: jobLink
        });
      }
    });

    return jobs;
  }

  // Function to get the Next page button
  function getNextPageButton() {
    // The Next button is inside .pagination-bottom with title="Next"
    const nextBtn = document.querySelector('.pagination-bottom button.bp3-icon-button[title="Next"]');
    if (nextBtn) {
      return nextBtn;
    }

    // Fallback: look for any button with title="Next"
    const fallbackBtn = document.querySelector('button[title="Next"]');
    if (fallbackBtn) {
      return fallbackBtn;
    }

    return null;
  }

  // Function to check if button is disabled
  function isButtonDisabled(button) {
    if (!button) return true;
    return button.disabled ||
           button.hasAttribute('disabled') ||
           button.classList.contains('bp3-disabled');
  }

  // Function to get current page info from "Showing X to Y of Z" text
  function getPageInfo() {
    const infoEl = document.querySelector('.pagination-bottom .bp3-caption, .pagination-bottom .bp3-text-muted');
    if (infoEl) {
      const text = infoEl.innerText;
      // Parse "Showing 1 to 10 of 140"
      const match = text.match(/Showing\s+(\d+)\s+to\s+(\d+)\s+of\s+(\d+)/i);
      if (match) {
        return {
          from: parseInt(match[1]),
          to: parseInt(match[2]),
          total: parseInt(match[3])
        };
      }
    }
    return null;
  }

  // Function to wait for table to update after clicking next
  function waitForTableUpdate(previousPageInfo, maxWait = 5000) {
    return new Promise((resolve) => {
      const startTime = Date.now();

      const checkUpdate = () => {
        const currentPageInfo = getPageInfo();

        // Check if the page info has changed (from value increased)
        if (currentPageInfo && previousPageInfo) {
          if (currentPageInfo.from > previousPageInfo.from) {
            // Give it a tiny bit more time for rows to render
            setTimeout(() => resolve(true), 200);
            return;
          }
        }

        // Also check if first job title changed
        const jobRows = document.querySelectorAll('.rt-tr-group');
        const firstRow = jobRows[0];
        const firstTitle = firstRow?.querySelector('.rt-td:nth-child(1)')?.innerText?.trim();

        // Timeout check
        if (Date.now() - startTime > maxWait) {
          resolve(false);
          return;
        }

        // Check again after a short delay
        setTimeout(checkUpdate, 300);
      };

      // Start checking after a brief initial delay
      setTimeout(checkUpdate, 500);
    });
  }

  // Send progress update to extension
  function sendProgress(message) {
    chrome.runtime.sendMessage({
      status: 'scraping_progress',
      message: message
    }).catch(() => {});
  }

  // Main scraping loop
  try {
    sendProgress(`Applying ${TARGET_DEPARTMENT} department filter...`);
    await applyDepartmentFilter();

    sendProgress('Starting scrape...');

    // Get initial page info
    const initialPageInfo = getPageInfo();
    if (initialPageInfo) {
      sendProgress(`Found ${initialPageInfo.total} total jobs`);
    }

    while (hasNextPage) {
      // Get current page info before scraping
      const currentPageInfo = getPageInfo();

      // Scrape current page
      const pageJobs = scrapeCurrentPage();

      if (pageJobs.length > 0) {
        allJobs.push(...pageJobs);
        const pageInfoStr = currentPageInfo
          ? `(${currentPageInfo.from}-${currentPageInfo.to} of ${currentPageInfo.total})`
          : '';
        sendProgress(`Page ${currentPage}: Found ${pageJobs.length} jobs ${pageInfoStr} - Total: ${allJobs.length}`);
      }

      // Look for next page button
      const nextButton = getNextPageButton();

      if (nextButton && !isButtonDisabled(nextButton)) {
        // Click next page
        nextButton.click();
        currentPage++;

        sendProgress(`Loading page ${currentPage}...`);

        // Wait for table to update
        const updated = await waitForTableUpdate(currentPageInfo);

        if (!updated) {
          // Check if we've reached the end
          const newPageInfo = getPageInfo();
          if (newPageInfo && newPageInfo.to >= newPageInfo.total) {
            hasNextPage = false;
          } else if (!updated) {
            // Table didn't update and we're not at the end - retry once
            await new Promise(r => setTimeout(r, 1000));
            const retryUpdate = await waitForTableUpdate(currentPageInfo, 3000);
            if (!retryUpdate) {
              hasNextPage = false;
            }
          }
        }
      } else {
        // No next button or it's disabled - we're done
        hasNextPage = false;
      }
    }

    // Send final results
    sendProgress(`Complete! Scraped ${allJobs.length} jobs from ${currentPage} page(s)`);

    chrome.runtime.sendMessage({
      jobs: allJobs,
      status: 'scraping_complete',
      totalJobs: allJobs.length,
      totalPages: currentPage
    }).catch(() => {});

  } catch (error) {
    console.error('Scraping error:', error);
    chrome.runtime.sendMessage({
      status: 'scraping_error',
      error: error.message
    }).catch(() => {});
  }
})();
