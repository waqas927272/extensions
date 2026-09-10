document.addEventListener('DOMContentLoaded', () => {
  const AGGREGATOR_NAME = 'Innovetive Pet Care (Parent Client)';
  const addressUtils = globalThis.InnovetiveAddressUtils;
  if (!addressUtils) throw new Error('Address utilities failed to load.');
  const areaPracticeUtils = globalThis.InnovetiveAreaPracticeUtils;
  if (!areaPracticeUtils) throw new Error('Area-of-practice utilities failed to load.');
  const tableBody = document.querySelector('#jobRecordsTable tbody');
  const tableHeaders = document.querySelectorAll('#jobRecordsTable th[data-sort]');
  const clearRecordsButton = document.getElementById('clearRecords');
  const clearDescriptionsButton = document.getElementById('clearDescriptions');
  const clearDetailsButton = document.getElementById('clearDetailsBtn');
  const clearAddressesButton = document.getElementById('clearAddressesBtn');
  const deleteSelectedButton = document.getElementById('deleteSelectedRecords');
  const selectAllRecordsCheckbox = document.getElementById('selectAllRecords');
  const webhookUrlInput = document.getElementById('webhookUrl');
  const sendToWebhookButton = document.getElementById('sendToWebhook');
  const totalCountElement = document.getElementById('totalCount');
  const emptyState = document.getElementById('emptyState');
  const table = document.getElementById('jobRecordsTable');
  const searchInput = document.getElementById('searchInput');
  const exportCsvButton = document.getElementById('exportCsv');
  const getDescriptionsBtn = document.getElementById('getDescriptionsBtn');
  const fetchDetailsBtn = document.getElementById('fetchDetailsBtn');
  const fetchAddressesBtn = document.getElementById('fetchAddressesBtn');
  const descriptionModal = document.getElementById('descriptionModal');
  const descriptionModalTitle = document.getElementById('descriptionModalTitle');
  const descriptionModalSubtitle = document.getElementById('descriptionModalSubtitle');
  const descriptionModalBody = document.getElementById('descriptionModalBody');
  const descriptionModalClose = document.getElementById('descriptionModalClose');

  let allJobs = [];
  let filteredJobs = [];
  let currentSortColumn = null;
  let currentSortDirection = 'asc';
  let isGettingDescriptions = false;
  let descriptionQueue = [];
  let currentDescriptionIndex = 0;
  let descriptionFailureCount = 0;
  let activeDescriptionRequestId = '';
  let descriptionRetryRound = 0;
  const MAX_DESCRIPTION_RETRY_ROUNDS = 1;
  const SALARY_PARSER_VERSION = 2;
  let detailsWereCleared = false;
  let isFetchingDetails = false;
  let currentJobIndex = 0;
  let detailsQueue = [];
  let currentDetailsIndex = 0;
  let isFetchingAddresses = false;
  let addressQueue = [];
  let currentAddressIndex = 0;
  let addressCache = new Map();
  let addressSuccessCount = 0;
  let addressFailCount = 0;
  let addressSkippedTbdCount = 0;
  let selectedRecordKeys = new Set();

  loadWebhookUrl();
  loadRecords();

  searchInput.addEventListener('input', () => {
    applySearch();
    displayRecords(filteredJobs);
  });

  tableHeaders.forEach(header => {
    header.addEventListener('click', () => sortByColumn(header.dataset.sort, header));
  });

  webhookUrlInput.addEventListener('change', async () => {
    const url = webhookUrlInput.value.trim();
    if (url) {
      await chrome.storage.local.set({ webhookUrl: url });
      showToast('Webhook URL saved!', 'success');
    }
  });

  sendToWebhookButton.addEventListener('click', sendToWebhook);
  exportCsvButton.addEventListener('click', exportCsv);
  clearRecordsButton.addEventListener('click', clearRecords);
  clearDescriptionsButton.addEventListener('click', clearDescriptions);
  clearDetailsButton.addEventListener('click', clearDetails);
  clearAddressesButton.addEventListener('click', clearAddresses);
  deleteSelectedButton.addEventListener('click', deleteSelectedRecords);
  selectAllRecordsCheckbox.addEventListener('change', toggleSelectAllVisible);
  tableBody.addEventListener('change', handleRowSelection);
  tableBody.addEventListener('click', handleTableClick);
  descriptionModalClose.addEventListener('click', closeDescriptionModal);
  descriptionModal.addEventListener('click', (event) => {
    if (event.target === descriptionModal) closeDescriptionModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !descriptionModal.classList.contains('hidden')) {
      closeDescriptionModal();
    }
  });
  getDescriptionsBtn.addEventListener('click', startGetDescriptions);
  fetchDetailsBtn.addEventListener('click', startFetchDetails);
  fetchAddressesBtn.addEventListener('click', startFetchAddresses);

  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'descriptionSaved' &&
        isGettingDescriptions &&
        request.requestId === activeDescriptionRequestId) {
      handleDescriptionSaved(request);
    }

  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    if (changes.detailsCleared) {
      detailsWereCleared = changes.detailsCleared.newValue === true;
    }

    const jobsChange = changes.scrapedJobs || changes.jobs;
    if (!jobsChange) return;

    syncRecordsFromStorage(jobsChange.newValue || []);
  });

  async function loadWebhookUrl() {
    const result = await chrome.storage.local.get(['webhookUrl']);
    webhookUrlInput.value = result.webhookUrl || '';
  }

  async function loadRecords() {
    const result = await chrome.storage.local.get(['scrapedJobs', 'jobs', 'salaryParserVersion', 'detailsCleared']);
    const sourceJobs = result.scrapedJobs || result.jobs || [];
    const normalizedJobs = sourceJobs.map(normalizeJob);
    const allDerivedFieldsAreBlank = normalizedJobs.length > 0 && normalizedJobs.every(job =>
      !job.areaOfPractice && !job.position && !job.salary && !job.jobType && !job.experience
    );
    // Treat the flag as authoritative only when storage is actually cleared.
    // Older builds could leave a stale true flag beside populated detail fields.
    detailsWereCleared = (result.detailsCleared === true && allDerivedFieldsAreBlank) ||
      (result.detailsCleared === undefined &&
       result.salaryParserVersion === SALARY_PARSER_VERSION &&
       allDerivedFieldsAreBlank);
    syncRecordsFromStorage(detailsWereCleared
      ? normalizedJobs
      : refreshPersistedDetailsFromDescriptions(normalizedJobs));
    await chrome.storage.local.set({
      scrapedJobs: allJobs,
      jobs: allJobs,
      salaryParserVersion: SALARY_PARSER_VERSION,
      detailsCleared: detailsWereCleared
    });
  }

  function refreshPersistedDetailsFromDescriptions(jobs) {
    return (jobs || []).map(job => {
      if (!job.description || !job.description.trim()) return job;
      const title = job.jobTitle || job.title || extractFieldValue(job.description, 'Title') || '';
      const recalculatedArea = determineAreaOfPracticeFromText(title, job.description);
      const hasStaleUrgentCare = areaPracticeUtils.hasStaleUrgentCareClassification(
        job.areaOfPractice,
        recalculatedArea
      );

      return {
        ...job,
        // Preserve existing classifications except when the old broad urgent-care
        // rule is demonstrably stale. New Fetch Details runs use the new parser.
        areaOfPractice: hasStaleUrgentCare ? recalculatedArea : job.areaOfPractice,
        salary: extractSalaryFromText(job.description)
      };
    });
  }

  async function refreshStoredParsedDetails() {
    const allDerivedFieldsAreBlank = allJobs.length > 0 && allJobs.every(job =>
      !job.areaOfPractice && !job.position && !job.salary && !job.jobType && !job.experience
    );
    if (detailsWereCleared && allDerivedFieldsAreBlank) return;

    // Recover from a stale flag written by an older build. Populated detail
    // fields mean the user did not leave the current dataset in a cleared state.
    if (detailsWereCleared) detailsWereCleared = false;

    const refreshedJobs = refreshPersistedDetailsFromDescriptions(allJobs);
    const detailsChanged = refreshedJobs.some((job, index) =>
      job.areaOfPractice !== allJobs[index]?.areaOfPractice ||
      job.salary !== allJobs[index]?.salary
    );

    if (!detailsChanged) return;

    syncRecordsFromStorage(refreshedJobs);
    await chrome.storage.local.set({
      scrapedJobs: allJobs,
      jobs: allJobs,
      salaryParserVersion: SALARY_PARSER_VERSION,
      detailsCleared: false
    });
  }

  function clearDerivedDetailsFromJobs(jobs) {
    return (jobs || []).map(job => ({
      ...job,
      areaOfPractice: '',
      position: '',
      salary: '',
      jobType: '',
      experience: ''
    }));
  }

  function syncRecordsFromStorage(sourceJobs) {
    allJobs = (sourceJobs || []).map(normalizeJob);

    const availableKeys = new Set(allJobs.map(getRecordKey));
    selectedRecordKeys = new Set([...selectedRecordKeys].filter(key => availableKeys.has(key)));

    applySearch();
    displayRecords(filteredJobs);

    if (isGettingDescriptions && allJobs.length > 0) {
      updateProgress(currentDescriptionIndex, descriptionQueue.length);
    }
  }

  function normalizeJob(job) {
    return {
      jobTitle: job.jobTitle || job.title || '',
      title: job.title || job.jobTitle || '',
      jobId: job.jobId || '',
      hospitalName: job.hospitalName || job.hospital || '',
      hospital: job.hospital || job.hospitalName || '',
      streetAddress: job.streetAddress || '',
      city: job.city || '',
      state: job.state || '',
      zipCode: job.zipCode || '',
      phone: job.phone || '',
      website: job.website || '',
      location: job.location || '',
      areaOfPractice: job.areaOfPractice || '',
      position: job.position || '',
      salary: job.salary || '',
      jobType: job.jobType || job.employmentType || '',
      experience: job.experience || '',
      link: job.link || '',
      description: job.description || ''
    };
  }

  function getRecordKey(job) {
    return job.jobId || job.link || `${job.jobTitle}|${job.hospitalName}|${job.location}`;
  }

  function displayRecords(jobs) {
    tableBody.innerHTML = '';
    totalCountElement.textContent = allJobs.length;

    if (allJobs.length === 0) {
      table.classList.add('hidden');
      emptyState.classList.remove('hidden');
      return;
    }

    table.classList.remove('hidden');
    emptyState.classList.add('hidden');

    jobs.forEach((job, index) => {
      const row = document.createElement('tr');
      const recordKey = getRecordKey(job);
      const isSelected = selectedRecordKeys.has(recordKey);
      const hasDescription = Boolean(job.description && job.description.trim());
      const linkHtml = job.link
        ? `<a href="${escapeHtml(job.link)}" target="_blank">Open</a>`
        : '<span style="color:#a0aec0;">N/A</span>';
      const descriptionHtml = hasDescription
        ? `<button type="button" class="description-view-btn" data-record-key="${escapeHtml(recordKey)}">View Description</button>`
        : '<span style="color:#dd6b20; font-weight:700;">Pending</span>';

      row.innerHTML = `
        <td><input type="checkbox" class="record-checkbox" data-record-key="${escapeHtml(recordKey)}" ${isSelected ? 'checked' : ''} aria-label="Select record"></td>
        <td>${index + 1}</td>
        <td><strong>${escapeHtml(job.jobTitle)}</strong></td>
        <td>${escapeHtml(job.jobId || 'N/A')}</td>
        <td>${escapeHtml(job.hospitalName || '')}</td>
        <td>${AGGREGATOR_NAME}</td>
        <td>${escapeHtml(job.streetAddress || '')}</td>
        <td>${escapeHtml(job.city || '')}</td>
        <td>${escapeHtml(job.state || '')}</td>
        <td>${escapeHtml(job.zipCode || '')}</td>
        <td>${escapeHtml(job.phone || '')}</td>
        <td>${job.website ? `<a href="${escapeHtml(job.website)}" target="_blank">Website</a>` : ''}</td>
        <td>${escapeHtml(job.location || '')}</td>
        <td>${escapeHtml(job.areaOfPractice || '')}</td>
        <td>${escapeHtml(job.position || '')}</td>
        <td>${escapeHtml(job.salary || '')}</td>
        <td>${escapeHtml(job.jobType || '')}</td>
        <td>${escapeHtml(job.experience || '')}</td>
        <td>${linkHtml}</td>
        <td>${descriptionHtml}</td>
      `;
      tableBody.appendChild(row);
    });

    updateSelectionUi();
  }

  function handleRowSelection(event) {
    if (!event.target.classList.contains('record-checkbox')) return;

    const key = event.target.dataset.recordKey;
    if (!key) return;

    if (event.target.checked) {
      selectedRecordKeys.add(key);
    } else {
      selectedRecordKeys.delete(key);
    }

    updateSelectionUi();
  }

  function handleTableClick(event) {
    const button = event.target.closest('.description-view-btn');
    if (!button) return;

    const key = button.dataset.recordKey;
    const job = allJobs.find(record => getRecordKey(record) === key);
    if (!job) {
      showToast('Description record was not found.', 'error');
      return;
    }

    openDescriptionModal(job);
  }

  function openDescriptionModal(job) {
    descriptionModalTitle.textContent = job.jobTitle || 'Job Description';
    descriptionModalSubtitle.textContent = [job.hospitalName, job.location].filter(Boolean).join(' | ');
    descriptionModalBody.textContent = job.description || 'No description available.';
    descriptionModal.classList.remove('hidden');
  }

  function closeDescriptionModal() {
    descriptionModal.classList.add('hidden');
    descriptionModalBody.textContent = '';
  }

  function toggleSelectAllVisible() {
    const visibleKeys = filteredJobs.map(getRecordKey);

    if (selectAllRecordsCheckbox.checked) {
      visibleKeys.forEach(key => selectedRecordKeys.add(key));
    } else {
      visibleKeys.forEach(key => selectedRecordKeys.delete(key));
    }

    displayRecords(filteredJobs);
  }

  function updateSelectionUi() {
    const visibleKeys = filteredJobs.map(getRecordKey);
    const selectedVisibleCount = visibleKeys.filter(key => selectedRecordKeys.has(key)).length;

    selectAllRecordsCheckbox.checked = visibleKeys.length > 0 && selectedVisibleCount === visibleKeys.length;
    selectAllRecordsCheckbox.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleKeys.length;
    deleteSelectedButton.disabled = selectedRecordKeys.size === 0;
    deleteSelectedButton.textContent = selectedRecordKeys.size > 0
      ? `Delete Selected (${selectedRecordKeys.size})`
      : 'Delete Selected';
  }

  function applySearch() {
    const query = searchInput.value.trim().toLowerCase();
    filteredJobs = allJobs.filter(job => {
      if (!query) return true;
      return [
        job.jobTitle,
        job.jobId,
        job.hospitalName,
        job.location,
        job.streetAddress,
        job.city,
        job.state,
        job.zipCode,
        job.phone,
        job.website,
        job.areaOfPractice,
        job.position,
        job.salary,
        job.jobType,
        job.experience,
        job.link,
        job.description
      ].some(value => String(value || '').toLowerCase().includes(query));
    });

    if (currentSortColumn) {
      sortJobs(filteredJobs, currentSortColumn, currentSortDirection);
    }
  }

  function sortByColumn(column, header) {
    if (currentSortColumn === column) {
      currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      currentSortColumn = column;
      currentSortDirection = 'asc';
    }

    tableHeaders.forEach(th => th.classList.remove('sort-asc', 'sort-desc'));
    header.classList.add(currentSortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
    sortJobs(filteredJobs, column, currentSortDirection);
    displayRecords(filteredJobs);
  }

  function sortJobs(jobs, column, direction) {
    jobs.sort((a, b) => {
      const aValue = String(a[column] || '').toLowerCase();
      const bValue = String(b[column] || '').toLowerCase();
      if (aValue < bValue) return direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return direction === 'asc' ? 1 : -1;
      return 0;
    });
  }

  async function deleteSelectedRecords() {
    if (selectedRecordKeys.size === 0) {
      showToast('Select at least one record to delete.', 'error');
      return;
    }

    const selectedCount = selectedRecordKeys.size;
    if (!confirm(`Delete ${selectedCount} selected record(s)? This cannot be undone.`)) return;

    allJobs = allJobs.filter(job => !selectedRecordKeys.has(getRecordKey(job)));
    selectedRecordKeys = new Set();
    await chrome.storage.local.set({ scrapedJobs: allJobs, jobs: allJobs });
    applySearch();
    displayRecords(filteredJobs);
    showToast(`Deleted ${selectedCount} selected record(s).`, 'success');
  }

  function startGetDescriptions() {
    if (isGettingDescriptions) {
      showToast('Already getting descriptions. Please wait...', 'error');
      return;
    }

    const missingDescriptions = allJobs.filter(job => !job.description || !job.description.trim());
    if (missingDescriptions.length === 0) {
      showToast('All jobs already have descriptions.', 'success');
      return;
    }

    if (!confirm(`This will fetch descriptions for ${missingDescriptions.length} jobs. Continue?`)) return;

    isGettingDescriptions = true;
    descriptionQueue = buildMissingDescriptionQueue(allJobs);
    currentDescriptionIndex = 0;
    descriptionFailureCount = 0;
    descriptionRetryRound = 0;
    getDescriptionsBtn.disabled = true;
    getDescriptionsBtn.textContent = 'Processing...';
    showProgress('Getting Descriptions', 0, descriptionQueue.length);
    processNextDescription();
  }

  function buildMissingDescriptionQueue(jobs) {
    return jobs
      .map((job, jobIndex) => ({
        jobIndex,
        jobKey: getRecordKey(job),
        jobLink: job.link || ''
      }))
      .filter(item => !jobs[item.jobIndex].description || !jobs[item.jobIndex].description.trim());
  }

  function processNextDescription() {
    if (!isGettingDescriptions) return;

    if (currentDescriptionIndex >= descriptionQueue.length) {
      finishDescriptions();
      return;
    }

    const queueItem = descriptionQueue[currentDescriptionIndex];
    currentJobIndex = queueItem.jobIndex;
    activeDescriptionRequestId = `${Date.now()}-${currentDescriptionIndex}-${Math.random().toString(36).slice(2, 9)}`;
    updateProgress(currentDescriptionIndex, descriptionQueue.length);

    chrome.runtime.sendMessage({
      action: 'scrapeJobDescription',
      requestId: activeDescriptionRequestId,
      jobIndex: queueItem.jobIndex,
      jobKey: queueItem.jobKey,
      jobLink: queueItem.jobLink
    }, () => {
      if (chrome.runtime.lastError) {
        handleDescriptionSaved({
          action: 'descriptionSaved',
          requestId: activeDescriptionRequestId,
          jobIndex: queueItem.jobIndex,
          success: false,
          error: chrome.runtime.lastError.message
        });
      }
    });
  }

  async function handleDescriptionSaved(request) {
    const result = await chrome.storage.local.get(['scrapedJobs', 'jobs']);
    syncRecordsFromStorage(result.scrapedJobs || result.jobs || []);

    if (isGettingDescriptions) {
      activeDescriptionRequestId = '';
      currentDescriptionIndex++;
      if (request.success === false) descriptionFailureCount++;
      updateProgress(currentDescriptionIndex, descriptionQueue.length);
      setTimeout(processNextDescription, 1200);
    }

    if (request.success === false) {
      showToast(request.error || 'A description could not be fetched.', 'error');
    }
  }

  async function finishDescriptions() {
    const result = await chrome.storage.local.get(['scrapedJobs', 'jobs']);
    syncRecordsFromStorage(result.scrapedJobs || result.jobs || []);
    const missingDescriptions = buildMissingDescriptionQueue(allJobs);

    if (missingDescriptions.length > 0 && descriptionRetryRound < MAX_DESCRIPTION_RETRY_ROUNDS) {
      descriptionRetryRound++;
      descriptionQueue = missingDescriptions;
      currentDescriptionIndex = 0;
      activeDescriptionRequestId = '';
      showProgress(`Retrying ${missingDescriptions.length} Missing Description(s)`, 0, missingDescriptions.length);
      setTimeout(processNextDescription, 2400);
      return;
    }

    isGettingDescriptions = false;
    activeDescriptionRequestId = '';
    getDescriptionsBtn.disabled = false;
    getDescriptionsBtn.textContent = 'Get Descriptions';
    hideProgress();
    if (missingDescriptions.length > 0) {
      showToast(`${missingDescriptions.length} description(s) are still missing after automatic retries.`, 'error');
    } else {
      showToast(`Descriptions are available for all ${allJobs.length} jobs.`, 'success');
    }
  }

  function extractDetailsFromSavedDescription(job) {
    const description = job.description || '';
    const title = job.jobTitle || job.title || extractFieldValue(description, 'Title') || '';
    const areaOfPractice = determineAreaOfPracticeFromText(title, description);

    return {
      areaOfPractice,
      position: validatePositionForAop(matchPositionFromText(title, description), areaOfPractice, title),
      salary: extractSalaryFromText(description),
      jobType: extractJobTypeFromText(description),
      experience: extractExperienceFromText(description)
    };
  }

  function extractLineValue(text, label) {
    const match = (text || '').match(new RegExp(`^${label}:\\s*(.+)$`, 'im'));
    return match ? match[1].trim() : '';
  }

  function extractFieldValue(text, label) {
    const source = normalizeParserText(text);
    const nextLabels = 'Industry/Category|Employment Type|Salary Range|Department|Location|Reporting To|Compensation|Description';
    const pattern = new RegExp(`${label}:\\s*(.*?)(?=\\s*(?:${nextLabels}):|\\s*===|$)`, 'i');
    const match = source.match(pattern);
    return match ? cleanParserValue(match[1]) : '';
  }

  function normalizeParserText(text) {
    return String(text || '')
      .replace(/\u00a0/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/gi, '"')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function cleanParserValue(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .replace(/^\W+|\W+$/g, '')
      .trim();
  }

  function extractQualificationsSection(text) {
    const source = text || '';
    const match = source.match(/(?:requirements?|qualifications?|what you'?ll need|what we'?re looking for|must have|credentials?)[:\s]/i);
    if (!match) return '';

    const section = source.slice(match.index, match.index + 2200);
    const endMatch = section.slice(match[0].length).search(/(?:\n|\s{2,}|\s)(benefits?|compensation|salary|equal opportunity|apply)\s*:|(?:\n|\s{2,})(about|our culture|location|why)\b/i);
    return endMatch >= 0 ? section.slice(0, match[0].length + endMatch) : section;
  }

  function determineAreaOfPracticeFromText(title, description) {
    return areaPracticeUtils.determineAreaOfPractice(title, description);
  }

  function firstDescriptionChars(text, length) {
    const source = normalizeParserText(text);
    const descriptionIndex = source.search(/\bDescription\b/i);
    const start = descriptionIndex >= 0 ? descriptionIndex : 0;
    return source.slice(start, start + length);
  }

  function isExoticPetMedicineRole(title, description) {
    const titleText = normalizeParserText(title);
    if (/\b(avian|exotics?|exotic pets?|pocket pets?|reptiles?|small mammals?)\b/i.test(titleText)) return true;

    const opening = firstDescriptionChars(description, 900);
    const qualifications = extractQualificationsSection(description);
    const roleText = normalizeParserText(`${opening}\n${qualifications}`);

    return /\b(avian|exotic)\s+(?:veterinarian|patients?|medicine)\b/i.test(roleText) ||
      /\bseeing\s+avian\s+and\s+exotic\s+patients\s+exclusively\b/i.test(roleText) ||
      /\b(avbp|zoological medicine|small mammal|reptile|amphibian)\b/i.test(roleText);
  }

  function matchPositionFromText(title, description) {
    const value = normalizeParserText(title).toLowerCase();
    const rules = [
      ['Medical Director', /\bmedical director\b/],
      ['Medical Director', /\bmanaging doctor of veterinary medicine\b|\bmanaging dvm\b|\bmdvm\b/],
      ['Lead Veterinarian', /\blead veterinarian\b|\blead vet\b/],
      ['Lead Veterinarian', /\bveterinarian team lead\b/],
      ['Veterinary Intern', /\binternship\b|\bveterinary intern\b/],
      ['Neurologist & Neurosurgeon', /\bneurologist\b|\bneurosurgeon\b|\bneurology\b/],
      ['Dermatologist', /\bdermatologist\b|\bdermatology\b/],
      ['Cardiologist', /\bcardiologist\b|\bcardiology\b/],
      ['Radiation Oncologist', /\bradiation oncolog/],
      ['Medical Oncologist', /\bmedical oncolog|\boncologist\b|\boncology\b/],
      ['Radiologist', /\bradiologist\b|\bradiology\b|\bdiagnostic imaging\b/],
      ['Ophthalmologist', /\bophthalmologist\b|\bophthalmology\b/],
      ['Anesthesiologist', /\banesthesiologist\b|\banesthesia\b/],
      ['Internal Medicine Specialist', /\binternist\b|\binternal medicine\b/],
      ['ECC Specialist', /\bcriticalist\b|\becc specialist\b|\bemergency\s*(?:and|&)?\s*critical care\b|\bdacvecc\b/],
      ['DABVP Specialist', /\bdabvp\b/],
      ['Dental Specialist', /\bdentist\b|\bdental specialist\b|\bveterinary dentist\b|\boral surgeon\b|\bdavdc\b/],
      ['Surgeon', /\bsurgeon\b|\bdacvs\b|\bacvs\b/],
      ['Credentialed Veterinary Technician Specialist', /\bcredentialed veterinary technician specialist\b|\btechnician specialist\b|\bvts\b/],
      ['Partner Veterinarian', /\bpartner veterinarian\b|\bpartner vet\b/],
      ['Associate Veterinarian', /\bassociate veterinarian\b|\bassociate vet\b|\bveterinarian\b|\bdvm\b|\bvmd\b/]
    ];

    const match = rules.find(([, pattern]) => pattern.test(value));
    if (match) return match[0];

    const opening = firstDescriptionChars(description, 900).toLowerCase();
    if (/\bmedical director\b|\bmanaging dvm\b|\bmdvm\b/.test(opening)) return 'Medical Director';
    if (/\blead veterinarian\b|\bveterinarian team lead\b/.test(opening)) return 'Lead Veterinarian';
    if (/\binternship\b|\bveterinary intern\b/.test(opening)) return 'Veterinary Intern';
    if (/\bassociate veterinarian\b|\bveterinarian\b|\bdvm\b|\bvmd\b/.test(opening)) return 'Associate Veterinarian';
    return '';
  }

  function validatePositionForAop(position, areaOfPractice, title) {
    const validPositions = {
      'Emergency Care': ['Associate Veterinarian'],
      'General Practice Care': ['Associate Veterinarian', 'Lead Veterinarian', 'Medical Director'],
      'Exotic Pet Medicine': ['Associate Veterinarian'],
      'Specialty Care': [
        'Anesthesiologist',
        'Cardiologist',
        'Credentialed Veterinary Technician Specialist',
        'DABVP Specialist',
        'Dental Specialist',
        'Dermatologist',
        'ECC Specialist',
        'Internal Medicine Specialist',
        'Medical Director',
        'Medical Oncologist',
        'Neurologist & Neurosurgeon',
        'Ophthalmologist',
        'Radiation Oncologist',
        'Radiologist',
        'Surgeon'
      ],
      'Urgent Care': ['Associate Veterinarian', 'Partner Veterinarian']
    };

    if (position === 'Veterinary Intern') return position;
    const parts = (areaOfPractice || '').split('/').map(part => part.trim()).filter(Boolean);
    if (position && parts.some(part => validPositions[part]?.includes(position))) return position;
    if (position && parts.length === 0) return position;
    if (/partner veterinarian|partner vet/i.test(title || '') && parts.includes('Urgent Care')) return 'Partner Veterinarian';
    if (parts.some(part => ['General Practice Care', 'Emergency Care', 'Urgent Care', 'Exotic Pet Medicine'].includes(part))) return 'Associate Veterinarian';
    return '';
  }

  function extractJobTypeFromText(text) {
    const employmentLine = extractFieldValue(text, 'Employment Type');
    const source = employmentLine || '';
    if (/part[-_\s]?time/i.test(source)) return 'Part Time';
    if (/part_time/i.test(source)) return 'Part Time';
    if (/full[-_\s]?time/i.test(source)) return 'Full Time';
    if (/full_time/i.test(source)) return 'Full Time';
    if (/\bcontract\b/i.test(source)) return 'Contract';
    if (/\binternship\b|\bintern\b/i.test(source)) return 'Internship';
    if (/\btemporary\b/i.test(source)) return 'Temporary';

    const title = extractFieldValue(text, 'Title');
    if (/\bpart[-\s]?time\b|\bpt\b/i.test(title)) return 'Part Time';
    if (/\binternship\b/i.test(title)) return 'Full Time';

    const firstBlock = firstDescriptionChars(text, 1000);
    const fallback = firstBlock.match(/\b(Full[-_\s]?Time|Part[-_\s]?Time|FULL_TIME|PART_TIME|Contract|Temporary|Internship)\b/i);
    return fallback ? extractJobTypeFromText(`Employment Type: ${fallback[1]}`) : '';
  }

  function formatSalaryFromAmounts(amounts, unit = 'YEAR') {
    const filtered = amounts
      .map(amount => Number(amount))
      .filter(amount => Number.isFinite(amount) && amount > 0);

    if (filtered.length === 0) return '';
    const isHourly = /hour|hr/i.test(unit);
    const valid = filtered.filter(amount => isHourly ? amount >= 8 && amount <= 1000 : amount >= 25000);
    if (valid.length === 0) return '';
    const formatter = (amount) => `$${amount.toLocaleString('en-US', { maximumFractionDigits: Number.isInteger(amount) ? 0 : 2 })}`;
    const suffix = isHourly ? 'per hour' : 'per year';
    if (valid.length >= 2) return `${formatter(Math.min(valid[0], valid[1]))}-${formatter(Math.max(valid[0], valid[1]))} ${suffix}`;
    return `${formatter(valid[0])} ${suffix}`;
  }

  function parseMoneyAmount(value, hasK = false) {
    let amount = Number(String(value || '').replace(/,/g, ''));
    if (!Number.isFinite(amount)) return 0;
    if (hasK || amount < 1000 && amount >= 25) amount *= 1000;
    return amount;
  }

  function formatSalaryFromText(raw) {
    if (!raw) return '';
    const isHourly = /(?:per\s+)?(?:hour|hr|\/hr|HOUR)/i.test(raw);
    const amounts = [];
    const amountPattern = /\$?\s*([\d,]+(?:\.\d{2})?)\s*(k)?/gi;
    let match;

    while ((match = amountPattern.exec(raw)) !== null) {
      const amount = parseMoneyAmount(match[1], Boolean(match[2]));
      if (amount > 0) amounts.push(amount);
    }

    return formatSalaryFromAmounts(amounts, isHourly ? 'HOUR' : 'YEAR');
  }

  function extractSalaryFromText(text) {
    const source = normalizeParserText(text);
    const salaryRange = source.match(/Salary Range:\s*(?:USD|\$)?\s*([\d,]+(?:\.\d{2})?)\s*(k)?\s*(?:-|\u2013|\u2014|to)\s*(?:USD|\$)?\s*([\d,]+(?:\.\d{2})?)\s*(k)?\s*(YEAR|HOUR|year|hour)?/i);
    if (salaryRange) {
      return formatSalaryFromAmounts([
        parseMoneyAmount(salaryRange[1], Boolean(salaryRange[2])),
        parseMoneyAmount(salaryRange[3], Boolean(salaryRange[4]))
      ], salaryRange[5] || 'YEAR');
    }

    const compensation = source.match(/Compensation:\s*\$?\s*([\d,]+(?:\.\d{2})?)\s*(k)?\s*(?:-|\u2013|\u2014|to)\s*\$?\s*([\d,]+(?:\.\d{2})?)\s*(k)?\s*(?:\/|\s+per\s+)?\s*(year|hour|hr)?/i);
    if (compensation) {
      return formatSalaryFromAmounts([
        parseMoneyAmount(compensation[1], Boolean(compensation[2])),
        parseMoneyAmount(compensation[3], Boolean(compensation[4]))
      ], compensation[5] || 'YEAR');
    }

    const singleCompensation = source.match(/Compensation:\s*\$?\s*([\d,]+(?:\.\d{2})?)\s*(k)?\+?\s*(?:\/|\s+per\s+)?\s*(year|hour|hr)?/i);
    if (singleCompensation) {
      return formatSalaryFromAmounts([
        parseMoneyAmount(singleCompensation[1], Boolean(singleCompensation[2]))
      ], singleCompensation[3] || 'YEAR');
    }

    const moneyMatches = [...source.matchAll(/\$[\d,]+(?:\.\d{2})?\s*k?(?:\+)?(?:\s*(?:-|\u2013|\u2014|to)\s*\$?[\d,]+(?:\.\d{2})?\s*k?)?(?:\s*(?:\/|\bper\s+)?(?:year|annually|annual|hour|hr))?/gi)];
    for (const moneyMatch of moneyMatches) {
      const start = Math.max(0, moneyMatch.index - 90);
      const end = Math.min(source.length, moneyMatch.index + moneyMatch[0].length + 90);
      const context = source.slice(start, end);
      if (!isSalaryContext(context)) continue;
      const formatted = formatSalaryFromText(moneyMatch[0]);
      if (formatted) return formatted;
    }

    return '';
  }

  function isSalaryContext(context) {
    const text = context || '';
    if (!/\b(compensation|salary|pay|prosal|base)\b/i.test(text)) return false;
    if (/\btotal compensation exceeding\b/i.test(text)) return false;
    if (/\b(ce|continuing education|allowance|pto|paid time off|sign[-\s]?on|bonus|relocation|student loan|401\(k\)|match|dues|license|licensure|dea|stipend|gift of college|parental leave)\b/i.test(text)) {
      return /\b(base salary|prosal)\b/i.test(text);
    }
    return true;
  }

  function extractExperienceFromText(text) {
    const section = normalizeParserText(extractQualificationsSection(text));
    const source = section ? `${section}\n${normalizeParserText(text)}` : normalizeParserText(text);
    const lines = splitParserSentences(source)
      .map(line => line.trim())
      .filter(line =>
        /\b(experience|experienced|minimum|min\.?|at least|required|preferred|years in practice)\b/i.test(line) &&
        !/\b(student loan|per year for|ce allowance|continuing education|served|serving|over\s+\d+\s+years)\b/i.test(line)
      );
    const patterns = [
      /\b(\d+)\s*(?:-|to)\s*(\d+)\s*(?:years?|yrs?)\b/i,
      /\b(?:minimum|min\.?|at least)\s*(\d+)\+?\s*(?:years?|yrs?)\b/i,
      /\b(?:ideally|preferred|requires?|required)\s*,?\s*(\d+)\+?\s*(?:years?|yrs?)\b/i,
      /\b(\d+)\+?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:\w+\s+){0,3}experience\b/i
    ];

    for (const line of lines) {
      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (!match) continue;
        if (match[2]) return `${match[1]}-${match[2]} years`;
        return `${match[1]}+ years`;
      }
    }

    return '';
  }

  function splitParserSentences(text) {
    return normalizeParserText(text)
      .replace(/[•●▪◦]/g, '\n')
      .replace(/\s+(Benefits?|Compensation|Salary|About|Why|Location|Equal Opportunity|Apply)\b\s*:?\s/gi, '\n$1 ')
      .replace(/([.!?])\s+/g, '$1\n')
      .replace(/\s+(?=(?:Active|Doctor|Minimum|Ideally|Preferred|Proven|Positive|Strong|Experience|Experienced)\b)/g, '\n')
      .split(/\n+/)
      .filter(Boolean);
  }

  async function startFetchDetails() {
    if (isFetchingDetails) {
      showToast('Already fetching details. Please wait...', 'error');
      return;
    }

    const result = await chrome.storage.local.get(['scrapedJobs', 'jobs']);
    allJobs = (result.scrapedJobs || result.jobs || []).map(normalizeJob);
    detailsQueue = allJobs.map((job, index) => ({ job, index }))
      .filter(item => item.job.description && item.job.description.trim());

    if (detailsQueue.length === 0) {
      showToast('No saved descriptions are available. Run Get Descriptions first.', 'error');
      return;
    }

    detailsWereCleared = false;
    await chrome.storage.local.set({ detailsCleared: false });
    isFetchingDetails = true;
    currentDetailsIndex = 0;
    fetchDetailsBtn.disabled = true;
    fetchDetailsBtn.textContent = 'Processing...';
    showProgress('Fetching Details', 0, detailsQueue.length);
    processNextDetail();
  }

  async function processNextDetail() {
    if (currentDetailsIndex >= detailsQueue.length) {
      finishDetails();
      return;
    }

    const { job, index } = detailsQueue[currentDetailsIndex];
    updateProgress(currentDetailsIndex + 1, detailsQueue.length);

    const result = await chrome.storage.local.get(['scrapedJobs', 'jobs']);
    const jobs = (result.scrapedJobs || result.jobs || []).map(normalizeJob);
    if (jobs[index]) {
      const details = extractDetailsFromSavedDescription(jobs[index]);
      jobs[index].areaOfPractice = details.areaOfPractice || '';
      jobs[index].position = details.position || '';
      jobs[index].salary = details.salary || '';
      jobs[index].jobType = details.jobType || '';
      jobs[index].experience = details.experience || '';

      await chrome.storage.local.set({ scrapedJobs: jobs, jobs });
      allJobs = jobs;
      applySearch();
      displayRecords(filteredJobs);
    }

    currentDetailsIndex++;
    setTimeout(processNextDetail, 50);
  }

  function finishDetails() {
    isFetchingDetails = false;
    fetchDetailsBtn.disabled = false;
    fetchDetailsBtn.textContent = 'Fetch Details';
    hideProgress();
    showToast(`Details fetched for ${detailsQueue.length} jobs.`, 'success');
  }

  async function startFetchAddresses() {
    if (isFetchingAddresses) {
      showToast('Already fetching addresses. Please wait...', 'error');
      return;
    }

    const result = await chrome.storage.local.get(['scrapedJobs', 'jobs']);
    allJobs = (result.scrapedJobs || result.jobs || []).map(normalizeJob);
    addressCache = new Map();

    // A Fetch Addresses run is always fresh. Group duplicate job records so each
    // hospital/location is looked up once, then propagated to every matching job.
    const groupedAddresses = addressUtils.buildUniqueAddressQueue(allJobs, job => {
      if (!(job.hospitalName || job.hospital) || !job.location) return;

      const prepared = prepareAddressSearch(job);
      const cacheKeys = getAddressCacheKeys(prepared.hospital, prepared.location, prepared.originalHospital);
      return cacheKeys[0] || `${prepared.hospital}|${prepared.location}`.toLowerCase();
    });

    addressQueue = groupedAddresses.queue;
    addressSkippedTbdCount = groupedAddresses.skippedTbdCount;

    if (addressQueue.length === 0) {
      const message = addressSkippedTbdCount
        ? `No address lookups needed. Kept ${addressSkippedTbdCount} intentional TBD location${addressSkippedTbdCount === 1 ? '' : 's'}.`
        : 'No jobs have hospital and location data to fetch addresses.';
      showToast(message, addressSkippedTbdCount ? 'success' : 'error');
      return;
    }

    isFetchingAddresses = true;
    currentAddressIndex = 0;
    addressSuccessCount = 0;
    addressFailCount = 0;
    fetchAddressesBtn.disabled = true;
    fetchAddressesBtn.textContent = 'Fetching Addresses...';
    showProgress('Fetching Addresses, Websites & Phones', 0, addressQueue.length);
    processNextAddress();
  }

  async function processNextAddress() {
    if (currentAddressIndex >= addressQueue.length) {
      finishAddressFetching();
      return;
    }

    const { job, index } = addressQueue[currentAddressIndex];
    let attemptCounted = false;
    updateProgress(currentAddressIndex + 1, addressQueue.length);
    fetchAddressesBtn.textContent = `Fetching... (${currentAddressIndex + 1}/${addressQueue.length})`;

    try {
      const prepared = prepareAddressSearch(job);
      const cacheKeys = getAddressCacheKeys(prepared.hospital, prepared.location, prepared.originalHospital);
      let addressData = getRememberedAddress(cacheKeys);

      if (!addressData) {
        addressData = await fetchAddressFromGoogleMaps(prepared.hospital, prepared.location, prepared.originalHospital);
        rememberAddressData(cacheKeys, addressData);
      }

      const result = await chrome.storage.local.get(['scrapedJobs', 'jobs']);
      const jobs = (result.scrapedJobs || result.jobs || []).map(normalizeJob);

      if (jobs[index]) {
        if (hasUsableCachedAddress(addressData)) {
          addressSuccessCount++;
          attemptCounted = true;
          const remembered = addressUtils.mergeFetchedAddress(jobs[index], addressData, {
            city: prepared.city,
            state: getFullStateName(prepared.state || addressData.state || '')
          });
          remembered.phone = normalizePhoneNumber(remembered.phone);
          remembered.fullAddress = addressData.fullAddress || [
            remembered.streetAddress,
            remembered.city,
            [remembered.state, remembered.zipCode].filter(Boolean).join(' ')
          ].filter(Boolean).join(', ');

          rememberAddressData(cacheKeys, remembered);
          applyAddressCacheToMatchingJobs(jobs, prepared, remembered);
        } else {
          addressFailCount++;
          attemptCounted = true;
          applyAddressFailureToMatchingJobs(jobs, prepared);
        }

        await chrome.storage.local.set({ scrapedJobs: jobs, jobs });
        allJobs = jobs;
        applySearch();
        displayRecords(filteredJobs);
      }
    } catch (error) {
      if (!attemptCounted) addressFailCount++;
      console.error('Address fetch failed:', error);
    }

    currentAddressIndex++;
    setTimeout(processNextAddress, 250);
  }

  function finishAddressFetching() {
    isFetchingAddresses = false;
    fetchAddressesBtn.disabled = false;
    fetchAddressesBtn.textContent = 'Fetch Addresses';
    hideProgress();
    const skippedText = addressSkippedTbdCount
      ? ` Skipped ${addressSkippedTbdCount} intentional TBD location${addressSkippedTbdCount === 1 ? '' : 's'}.`
      : '';
    showToast(
      `Address fetching completed. Updated ${addressSuccessCount} hospital location${addressSuccessCount === 1 ? '' : 's'}, failed ${addressFailCount}.${skippedText}`,
      addressFailCount ? 'error' : 'success'
    );
  }

  function applyAddressFailureToMatchingJobs(jobs, preparedSource) {
    const sourceKeys = new Set(getAddressCacheKeys(preparedSource.hospital, preparedSource.location, preparedSource.originalHospital));

    jobs.forEach(job => {
      const prepared = prepareAddressSearch(job);
      const keys = getAddressCacheKeys(prepared.hospital, prepared.location, prepared.originalHospital);
      if (!keys.some(key => sourceKeys.has(key)) || addressUtils.isIntentionalTbdAddress(job)) return;

      job.streetAddress = job.streetAddress || 'TBD';
      job.city = job.city || prepared.city || '';
      job.state = getFullStateName(job.state || prepared.state || '');
      job.zipCode = job.zipCode || '00000';
    });
  }

  function parseLocationParts(location) {
    const parts = (location || '').split(',').map(part => part.trim()).filter(Boolean);
    return {
      city: parts[0] || '',
      state: parts[1] || ''
    };
  }

  function cleanHospitalName(name) {
    return (name || '')
      .replace(/\s+/g, ' ')
      .replace(/\s*-\s*$/, '')
      .trim();
  }

  function prepareAddressSearch(job) {
    let hospital = cleanHospitalName(job.hospitalName || job.hospital || '');
    const originalHospital = hospital;
    const { city, state } = parseLocationParts(job.location || '');

    if (hospital && !/\b(?:hospital|clinic|center|centre|specialists?|specialty|service|services|care|emergency|referral|veterinary|animal|pet)\b/i.test(hospital)) {
      hospital = `${hospital} Hospital`;
    }

    return {
      hospital,
      originalHospital,
      location: [city, state].filter(Boolean).join(', '),
      city,
      state
    };
  }

  async function fetchAddressFromGoogleMaps(hospitalName, location, originalHospitalName = '') {
    const searchQuery = `${hospitalName}, ${location}`.replace(/\s+/g, ' ').trim();
    const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`;
    const expectedLocation = parseExpectedLocation(location);

    function emptyAddressResult() {
      return { streetAddress: '', zipCode: '', city: '', state: '', fullAddress: '', website: '', phone: '' };
    }

    function normalizeForCompare(value) {
      return (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    function parseExpectedLocation(locationText) {
      const parts = (locationText || '').split(',').map(part => part.trim()).filter(Boolean);
      return {
        city: parts[0] || '',
        state: parts.length >= 2 ? normalizeStateForCompare(parts[1]) : ''
      };
    }

    function normalizeStateForCompare(value) {
      const state = (value || '').trim();
      if (!state) return '';
      if (/^[A-Z]{2}$/i.test(state)) return state.toUpperCase();
      const normalizedState = normalizeForCompare(state);
      const match = Object.entries(stateAbbreviations).find(([, fullName]) => normalizeForCompare(fullName) === normalizedState);
      return match ? match[0] : state.toUpperCase();
    }

    function resultMatchesExpectedLocation(result) {
      const resultCity = normalizeForCompare(result.city || '');
      const resultState = normalizeStateForCompare(result.state || '');
      const expectedCity = normalizeForCompare(expectedLocation.city);
      const expectedState = expectedLocation.state;

      if (expectedCity && resultCity && resultCity !== expectedCity) return false;
      if (expectedState && resultState && resultState !== expectedState) return false;
      return true;
    }

    function filterDataForExpectedLocation(data, sourceLabel) {
      const result = data || emptyAddressResult();
      const hasLocationSignal = Boolean(result.streetAddress || result.zipCode || result.fullAddress || result.city || result.state);

      if (hasLocationSignal && !resultMatchesExpectedLocation(result)) {
        console.warn(`Ignoring address result outside requested location "${location}" from "${sourceLabel}".`);
        return emptyAddressResult();
      }

      return result;
    }

    function mergeMapsData(primary, secondary, sourceLabel = '') {
      const safeSecondary = filterDataForExpectedLocation(secondary, sourceLabel);
      return {
        streetAddress: primary.streetAddress || safeSecondary.streetAddress || '',
        zipCode: primary.zipCode || safeSecondary.zipCode || '',
        city: primary.city || safeSecondary.city || '',
        state: primary.state || safeSecondary.state || '',
        fullAddress: primary.fullAddress || safeSecondary.fullAddress || '',
        website: primary.website || safeSecondary.website || '',
        phone: primary.phone || safeSecondary.phone || ''
      };
    }

    function needsMapsRetry(data) {
      return !data.streetAddress || !data.zipCode;
    }

    function uniqueQueries(names) {
      const seen = new Set();
      const queries = [];
      for (const name of names) {
        const normalizedName = (name || '').replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim();
        if (!normalizedName) continue;
        const query = `${normalizedName}, ${location}`.replace(/\s+/g, ' ').trim();
        const key = query.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        queries.push(query);
      }
      return queries;
    }

    function buildHospitalNameVariants() {
      const rawNames = [hospitalName, originalHospitalName].filter(Boolean);
      const city = (location || '').split(',')[0]?.trim() || '';
      const names = [];

      for (const rawName of rawNames) {
        const base = rawName.replace(/\s+/g, ' ').trim();
        if (!base) continue;

        const withoutParens = base.replace(/\s*\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
        const expandedParens = base.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
        const plain = base.replace(/&/g, 'and').replace(/[-\u2013\u2014()]/g, ' ').replace(/\s+/g, ' ').trim();

        names.push(base, withoutParens, expandedParens, plain);

        if (city) {
          for (const candidate of [withoutParens, plain]) {
            if (candidate && !candidate.toLowerCase().includes(city.toLowerCase())) {
              names.push(`${candidate} ${city}`);
            }
          }
        }
      }

      return names;
    }

    let data = mergeMapsData(emptyAddressResult(), await scrapeGoogleMapsTabSafe(mapsUrl, searchQuery), searchQuery);

    if (needsMapsRetry(data)) {
      const simplifiedName = hospitalName
        .replace(/&/g, 'and')
        .replace(/[-\u2013\u2014()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const altQuery = `${simplifiedName}, ${location}`;
      if (altQuery !== searchQuery) {
        const altUrl = `https://www.google.com/maps/search/${encodeURIComponent(altQuery)}`;
        data = mergeMapsData(data, await scrapeGoogleMapsTabSafe(altUrl, altQuery), altQuery);
      }
    }

    if (needsMapsRetry(data)) {
      for (const query of uniqueQueries(buildHospitalNameVariants()).slice(0, 6)) {
        if (!needsMapsRetry(data)) break;
        if (query === searchQuery) continue;
        const variantUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
        data = mergeMapsData(data, await scrapeGoogleMapsTabSafe(variantUrl, query), query);
      }
    }

    if (needsMapsRetry(data)) {
      for (const query of uniqueQueries(buildHospitalNameVariants()).slice(0, 4)) {
        if (!needsMapsRetry(data)) break;
        data = mergeMapsData(data, await scrapeGoogleSearchTabSafe(query), query);
      }
    }

    return {
      streetAddress: data.streetAddress || '',
      zipCode: data.zipCode || '',
      city: data.city || '',
      state: data.state || '',
      fullAddress: data.fullAddress || '',
      website: data.website || '',
      phone: normalizePhoneNumber(data.phone)
    };
  }

  function scrapeGoogleMapsTabSafe(url, queryLabel) {
    return new Promise((resolve) => {
      let settled = false;
      let mapsTabId = null;
      let listener = null;

      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (listener) chrome.tabs.onUpdated.removeListener(listener);
        if (mapsTabId) chrome.tabs.remove(mapsTabId).catch(() => {});
        resolve(result || emptyAddressResult());
      };

      const emptyAddressResult = () => ({ streetAddress: '', zipCode: '', city: '', state: '', fullAddress: '', website: '', phone: '' });
      const timeout = setTimeout(() => {
        console.warn(`Google Maps timeout for "${queryLabel}"`);
        finish(emptyAddressResult());
      }, 22000);

      chrome.tabs.create({ url, active: false }, (tab) => {
        if (!tab) {
          finish(emptyAddressResult());
          return;
        }

        mapsTabId = tab.id;
        listener = (updatedTabId, info) => {
          if (updatedTabId === mapsTabId && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            listener = null;

            setTimeout(() => {
              if (settled) return;
              chrome.scripting.executeScript({
                target: { tabId: mapsTabId },
                files: ['google-maps-scraper.js']
              }).then((results) => {
                const data = results?.[0]?.result || {};
                finish({
                  streetAddress: data.streetAddress || '',
                  zipCode: data.zipCode || '',
                  city: data.city || '',
                  state: data.state || '',
                  fullAddress: data.fullAddress || '',
                  website: data.website || '',
                  phone: normalizePhoneNumber(data.phone)
                });
              }).catch((error) => {
                console.error(`Google Maps script error for "${queryLabel}":`, error);
                finish(emptyAddressResult());
              });
            }, 1400);
          }
        };

        chrome.tabs.onUpdated.addListener(listener);
      });
    });
  }

  function scrapeGoogleSearchTabSafe(queryLabel) {
    return new Promise((resolve) => {
      let settled = false;
      let searchTabId = null;
      let listener = null;

      const emptyAddressResult = () => ({ streetAddress: '', zipCode: '', city: '', state: '', fullAddress: '', website: '', phone: '' });
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (listener) chrome.tabs.onUpdated.removeListener(listener);
        if (searchTabId) chrome.tabs.remove(searchTabId).catch(() => {});
        resolve(result || emptyAddressResult());
      };

      const timeout = setTimeout(() => {
        console.warn(`Google Search timeout for "${queryLabel}"`);
        finish(emptyAddressResult());
      }, 26000);

      chrome.tabs.create({ url: `https://www.google.com/search?q=${encodeURIComponent(queryLabel)}`, active: false }, (tab) => {
        if (!tab) {
          finish(emptyAddressResult());
          return;
        }

        searchTabId = tab.id;
        listener = (updatedTabId, info) => {
          if (updatedTabId === searchTabId && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            listener = null;

            setTimeout(() => {
              if (settled) return;
              chrome.scripting.executeScript({
                target: { tabId: searchTabId },
                files: ['google-search-scraper.js']
              }).then((results) => {
                const data = results?.[0]?.result || {};
                finish({
                  streetAddress: data.streetAddress || '',
                  zipCode: data.zipCode || '',
                  city: data.city || '',
                  state: data.state || '',
                  fullAddress: data.fullAddress || '',
                  website: data.website || '',
                  phone: normalizePhoneNumber(data.phone)
                });
              }).catch((error) => {
                console.error(`Google Search script error for "${queryLabel}":`, error);
                finish(emptyAddressResult());
              });
            }, 1200);
          }
        };

        chrome.tabs.onUpdated.addListener(listener);
      });
    });
  }

  function normalizeAddressCacheValue(value) {
    return (value || '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/[-\u2013\u2014]/g, ' ')
      .replace(/\b(?:hospital|clinic|center|centre|veterinary|animal|pet)\b/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function makeAddressCacheKey(hospital, location) {
    const hospitalKey = normalizeAddressCacheValue(hospital);
    const locationKey = normalizeAddressCacheValue(location);
    return hospitalKey && locationKey ? `${hospitalKey}|${locationKey}` : '';
  }

  function getAddressCacheKeys(hospital, location, originalHospital = '') {
    const keys = new Set();
    [hospital, originalHospital].filter(Boolean).forEach(name => {
      const key = makeAddressCacheKey(name, location);
      if (key) keys.add(key);
    });
    return [...keys];
  }

  function hasUsableCachedAddress(data) {
    return addressUtils.hasUsableAddress(data);
  }

  function rememberAddressData(keys, data) {
    if (!hasUsableCachedAddress(data)) return;
    keys.forEach(key => addressCache.set(key, { ...data }));
  }

  function getRememberedAddress(keys) {
    for (const key of keys) {
      const cached = addressCache.get(key);
      if (hasUsableCachedAddress(cached)) return { ...cached };
    }
    return null;
  }

  function applyAddressCacheToMatchingJobs(jobs, preparedSource, addressData) {
    if (!hasUsableCachedAddress(addressData)) return;
    const sourceKeys = new Set(getAddressCacheKeys(preparedSource.hospital, preparedSource.location, preparedSource.originalHospital));

    jobs.forEach(job => {
      const prepared = prepareAddressSearch(job);
      const keys = getAddressCacheKeys(prepared.hospital, prepared.location, prepared.originalHospital);
      if (!keys.some(key => sourceKeys.has(key))) return;

      if (addressUtils.isIntentionalTbdAddress(job)) return;

      const updated = addressUtils.mergeFetchedAddress(job, addressData, {
        city: prepared.city,
        state: getFullStateName(prepared.state || addressData.state || '')
      });
      Object.assign(job, updated, { phone: normalizePhoneNumber(updated.phone) });
    });
  }

  function normalizedLocationPart(value) {
    return (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function jobLocationMismatch(job) {
    const expected = parseLocationParts(job.location);
    return Boolean(
      (expected.city && job.city && normalizedLocationPart(job.city) !== normalizedLocationPart(expected.city)) ||
      (expected.state && job.state && normalizedLocationPart(getFullStateName(job.state)) !== normalizedLocationPart(getFullStateName(expected.state)))
    );
  }

  const stateAbbreviations = {
    AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
    CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
    HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
    KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
    MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
    MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
    NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
    OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
    SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
    VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
    DC: 'District of Columbia', PR: 'Puerto Rico'
  };

  function getFullStateName(state) {
    const value = String(state || '').trim();
    if (!value) return '';
    if (value.length > 2) {
      const canonical = Object.values(stateAbbreviations).find(name => name.toLowerCase() === value.toLowerCase());
      return canonical || value;
    }
    return stateAbbreviations[value.toUpperCase()] || value;
  }

  function normalizePhoneNumber(phone) {
    const raw = (phone || '').trim();
    if (!raw) return '';
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
    if (raw.startsWith('+') && digits.length >= 10) return `+${digits}`;
    return raw;
  }

  async function sendToWebhook() {
    const webhookUrl = webhookUrlInput.value.trim();
    if (!webhookUrl || !isValidUrl(webhookUrl)) {
      showToast('Please enter a valid webhook URL.', 'error');
      return;
    }

    await refreshStoredParsedDetails();
    const jobs = filteredJobs.length ? filteredJobs : allJobs;
    if (jobs.length === 0) {
      showToast('No job records to send.', 'error');
      return;
    }

    const batchSize = 50;
    const batches = [];
    for (let i = 0; i < jobs.length; i += batchSize) {
      batches.push(jobs.slice(i, i + batchSize));
    }

    if (!confirm(`Send ${jobs.length} job(s) in ${batches.length} batch(es) to webhook?`)) return;

    await chrome.storage.local.set({ webhookUrl });
    sendToWebhookButton.disabled = true;
    sendToWebhookButton.textContent = 'Sending...';
    showProgress('Sending to Webhook', 0, batches.length);

    const syncId = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    let successCount = 0;
    let errorCount = 0;

    for (let index = 0; index < batches.length; index++) {
      updateProgress(index + 1, batches.length);

      const payload = {
        source: 'Innovetive Petcare Job Scraper',
        parentClientName: AGGREGATOR_NAME,
        syncId,
        timestamp: new Date().toISOString(),
        batchNumber: index + 1,
        totalBatches: batches.length,
        batchSize: batches[index].length,
        totalRecords: jobs.length,
        data: batches[index].map(mapJobForWebhook)
      };

      try {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          successCount++;
        } else {
          errorCount++;
        }
      } catch (error) {
        errorCount++;
      }

      if (index < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    sendToWebhookButton.disabled = false;
    sendToWebhookButton.textContent = 'Send to Webhook';
    hideProgress();

    if (errorCount === 0) {
      showToast(`Sent ${jobs.length} jobs in ${batches.length} batch(es).`, 'success');
    } else {
      showToast(`Webhook completed with ${successCount} success and ${errorCount} failed batch(es).`, 'error');
    }
  }

  function mapJobForWebhook(job) {
    return {
      parent_client: AGGREGATOR_NAME,
      job_title: job.jobTitle || '',
      job_id: job.jobId || '',
      hospital: job.hospitalName || '',
      aggregator: AGGREGATOR_NAME,
      street_address: job.streetAddress || '',
      city: job.city || '',
      state: job.state || '',
      zip_code: job.zipCode || '',
      phone: job.phone || '',
      website: job.website || '',
      location: job.location || '',
      area_of_practice: job.areaOfPractice || '',
      position: job.position || '',
      salary: job.salary || '',
      job_type: job.jobType || '',
      experience: job.experience || '',
      link: job.link || '',
      description: job.description || ''
    };
  }

  async function exportCsv() {
    await refreshStoredParsedDetails();

    const jobs = filteredJobs.length ? filteredJobs : allJobs;
    if (jobs.length === 0) {
      showToast('No records to export.', 'error');
      return;
    }

    const headers = ['Job Title', 'Job ID', 'Hospital', 'Aggregator', 'Street Address', 'City', 'State', 'Zip Code', 'Phone', 'Website', 'Location', 'Area of Practice', 'Position', 'Salary', 'Job Type', 'Experience', 'Link', 'Description'];
    const rows = jobs.map(job => [
      job.jobTitle,
      job.jobId,
      job.hospitalName,
      AGGREGATOR_NAME,
      job.streetAddress,
      job.city,
      job.state,
      job.zipCode,
      job.phone,
      job.website,
      job.location,
      job.areaOfPractice,
      job.position,
      job.salary,
      job.jobType,
      job.experience,
      job.link,
      job.description
    ]);

    const csv = [headers, ...rows]
      .map(row => row.map(value => `"${String(value || '').replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'innovetive-petcare-jobs.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async function clearDetails() {
    if (!confirm('Clear Area of Practice, Position, Salary, Job Type, and Experience?')) return;

    detailsWereCleared = true;
    const clearedJobs = clearDerivedDetailsFromJobs(allJobs);
    syncRecordsFromStorage(clearedJobs);

    try {
      await chrome.storage.local.set({
        scrapedJobs: clearedJobs,
        jobs: clearedJobs,
        salaryParserVersion: SALARY_PARSER_VERSION,
        detailsCleared: true
      });

      const verification = await chrome.storage.local.get(['scrapedJobs', 'jobs', 'detailsCleared']);
      const storedJobs = (verification.scrapedJobs || verification.jobs || []).map(normalizeJob);
      const detailsRemain = storedJobs.some(job =>
        job.areaOfPractice || job.position || job.salary || job.jobType || job.experience
      );

      if (verification.detailsCleared !== true || detailsRemain) {
        throw new Error('Cleared details could not be verified in storage.');
      }

      syncRecordsFromStorage(storedJobs);
      showToast('Area, Position, Salary, Job Type, and Experience cleared.', 'success');
    } catch (error) {
      syncRecordsFromStorage(clearedJobs);
      showToast(error?.message || 'Details could not be cleared from storage.', 'error');
    }
  }

  async function clearAddresses() {
    if (!confirm('Clear Street Address, City, State, Zip Code, Phone, and Website?')) return;
    allJobs = allJobs.map(job => ({
      ...job,
      streetAddress: '',
      city: '',
      state: '',
      zipCode: '',
      phone: '',
      website: ''
    }));
    await chrome.storage.local.set({ scrapedJobs: allJobs, jobs: allJobs });
    applySearch();
    displayRecords(filteredJobs);
    showToast('Addresses cleared.', 'success');
  }

  async function clearDescriptions() {
    if (!confirm('Clear all saved descriptions?')) return;
    allJobs = allJobs.map(job => ({ ...job, description: '' }));
    await chrome.storage.local.set({ scrapedJobs: allJobs, jobs: allJobs });
    applySearch();
    displayRecords(filteredJobs);
    showToast('Descriptions cleared.', 'success');
  }

  async function clearRecords() {
    if (!confirm('Clear all scraped job records? This cannot be undone.')) return;
    allJobs = [];
    filteredJobs = [];
    selectedRecordKeys = new Set();
    await chrome.storage.local.remove(['scrapedJobs', 'jobs']);
    displayRecords(filteredJobs);
    showToast('All records cleared.', 'success');
  }

  function showProgress(label, current, total) {
    document.getElementById('progressSection').classList.remove('hidden');
    document.getElementById('progressLabel').textContent = label;
    updateProgress(current, total);
  }

  function updateProgress(current, total) {
    const safeTotal = total || 1;
    const percent = Math.round((current / safeTotal) * 100);
    document.getElementById('progressText').textContent = `${current} / ${total}`;
    document.getElementById('progressBar').style.width = `${percent}%`;
  }

  function hideProgress() {
    document.getElementById('progressSection').classList.add('hidden');
    document.getElementById('progressBar').style.width = '0%';
    document.getElementById('progressText').textContent = '0 / 0';
  }

  function showToast(message, type = 'success') {
    const toastContainer = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  }

  function isValidUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (error) {
      return false;
    }
  }

  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value || '';
    return div.innerHTML;
  }
});
