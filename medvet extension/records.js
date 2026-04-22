document.addEventListener('DOMContentLoaded', () => {
  const recordsTableBody = document.querySelector('#recordsTable tbody');
  const clearRecordsButton = document.getElementById('clearRecords');
  const downloadCsvButton = document.getElementById('downloadCsv');
  const getJobDescriptionsButton = document.getElementById('getJobDescriptions');
  const searchInput = document.getElementById('searchInput');
  const stateFilter = document.getElementById('stateFilter');
  const positionFilter = document.getElementById('positionFilter');
  const aopFilter = document.getElementById('aopFilter');
  const recordCountSpan = document.getElementById('recordCount');
  const emptyState = document.getElementById('emptyState');
  const recordsTable = document.getElementById('recordsTable');

  let allRecords = [];
  let filteredRecords = [];
  let sortColumn = null;
  let sortDirection = 'asc';
  let isGettingDescriptions = false;
  let currentJobIndex = 0;
  let isFetchingAddresses = false;
  let addressQueue = [];
  let currentAddressIndex = 0;
  let isFetchingDetails = false;
  let detailsQueue = [];
  let currentDetailsIndex = 0;

  // ── Selection state ──
  let selectedIndices = new Set(); // indices into allRecords

  const fetchAddressesBtn = document.getElementById('fetchAddressesBtn');
  const fetchDetailsBtn   = document.getElementById('fetchDetailsBtn');
  const selectionBar              = document.getElementById('selectionBar');
  const selectedCountSpan         = document.getElementById('selectedCount');
  const selectAllCheckbox         = document.getElementById('selectAllCheckbox');
  const clearSelectionBtn         = document.getElementById('clearSelectionBtn');
  const fetchSelectedDetailsBtn   = document.getElementById('fetchSelectedDetailsBtn');
  const fetchSelectedAddressesBtn = document.getElementById('fetchSelectedAddressesBtn');

  const descriptionModal = document.getElementById('descriptionModal');
  const modalDescriptionContent = document.getElementById('modalDescriptionContent');
  const closeButton = document.querySelector('.close-button');

  // Toast notification function
  function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast show ' + type;

    setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  }

  function showDescriptionModal(description) {
    modalDescriptionContent.innerHTML = description;
    descriptionModal.classList.add('show');
  }

  function hideDescriptionModal() {
    descriptionModal.classList.remove('show');
    modalDescriptionContent.textContent = '';
  }

  closeButton.addEventListener('click', hideDescriptionModal);

  window.addEventListener('click', (event) => {
    if (event.target === descriptionModal) {
      hideDescriptionModal();
    }
  });

  function escapeHtml(unsafe) {
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function updateRecordCount(count) {
    recordCountSpan.textContent = count;
  }

  // ── Selection helpers ──
  function updateSelectionUI() {
    const count = selectedIndices.size;
    selectedCountSpan.textContent = count;
    selectionBar.classList.toggle('hidden', count === 0);
    // Update select-all checkbox state
    const visibleBoxes = document.querySelectorAll('.row-checkbox');
    if (visibleBoxes.length === 0) {
      selectAllCheckbox.indeterminate = false;
      selectAllCheckbox.checked = false;
    } else {
      const checkedCount = Array.from(visibleBoxes).filter(cb => cb.checked).length;
      selectAllCheckbox.indeterminate = checkedCount > 0 && checkedCount < visibleBoxes.length;
      selectAllCheckbox.checked = checkedCount === visibleBoxes.length;
    }
  }

  function clearSelection() {
    selectedIndices.clear();
    document.querySelectorAll('.row-checkbox').forEach(cb => {
      cb.checked = false;
      cb.closest('tr').classList.remove('selected-row');
    });
    updateSelectionUI();
  }

  // Select-all checkbox
  selectAllCheckbox.addEventListener('change', () => {
    const check = selectAllCheckbox.checked;
    document.querySelectorAll('.row-checkbox').forEach(cb => {
      const idx = parseInt(cb.dataset.idx, 10);
      cb.checked = check;
      cb.closest('tr').classList.toggle('selected-row', check);
      if (check) selectedIndices.add(idx);
      else selectedIndices.delete(idx);
    });
    updateSelectionUI();
  });

  clearSelectionBtn.addEventListener('click', clearSelection);

  function populateFilters(records) {
    const states    = new Set();
    const positions = new Set();
    const aops      = new Set();

    records.forEach(record => {
      if (record.state) states.add(record.state);
      if (record.position) positions.add(record.position);
      if (record.areaOfPractice) aops.add(record.areaOfPractice);
    });

    // Preserve current selections so filtering survives a reload
    const prevState    = stateFilter.value;
    const prevPosition = positionFilter.value;
    const prevAop      = aopFilter.value;

    // Populate state filter
    stateFilter.innerHTML = '<option value="">All States</option>';
    Array.from(states).sort().forEach(state => {
      const option = document.createElement('option');
      option.value = state;
      option.textContent = state;
      stateFilter.appendChild(option);
    });
    if (prevState) stateFilter.value = prevState;

    // Populate position filter
    positionFilter.innerHTML = '<option value="">All Positions</option>';
    Array.from(positions).sort().forEach(position => {
      const option = document.createElement('option');
      option.value = position;
      option.textContent = position;
      positionFilter.appendChild(option);
    });
    if (prevPosition) positionFilter.value = prevPosition;

    // Populate area-of-practice filter
    aopFilter.innerHTML = '<option value="">All Areas of Practice</option>';
    Array.from(aops).sort().forEach(aop => {
      const option = document.createElement('option');
      option.value = aop;
      option.textContent = aop;
      aopFilter.appendChild(option);
    });
    if (prevAop) aopFilter.value = prevAop;
  }

  function filterRecords() {
    const searchTerm      = searchInput.value.toLowerCase();
    const selectedState    = stateFilter.value;
    const selectedPosition = positionFilter.value;
    const selectedAop      = aopFilter.value;

    filteredRecords = allRecords.filter(record => {
      const matchesSearch =
        (record.title || '').toLowerCase().includes(searchTerm) ||
        (record.city || '').toLowerCase().includes(searchTerm) ||
        (record.state || '').toLowerCase().includes(searchTerm) ||
        (record.position || '').toLowerCase().includes(searchTerm) ||
        (record.hospitalName || '').toLowerCase().includes(searchTerm) ||
        (record.areaOfPractice || '').toLowerCase().includes(searchTerm) ||
        (record.salary || '').toLowerCase().includes(searchTerm);

      const matchesState    = !selectedState    || record.state         === selectedState;
      const matchesPosition = !selectedPosition || record.position      === selectedPosition;
      const matchesAop      = !selectedAop      || record.areaOfPractice === selectedAop;

      return matchesSearch && matchesState && matchesPosition && matchesAop;
    });

    if (sortColumn) {
      sortRecords(sortColumn, sortDirection);
    } else {
      renderTable(filteredRecords);
    }
  }

  function sortRecords(column, direction) {
    filteredRecords.sort((a, b) => {
      let aVal = a[column] || '';
      let bVal = b[column] || '';

      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase();
        bVal = bVal.toLowerCase();
      }

      if (aVal < bVal) return direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return direction === 'asc' ? 1 : -1;
      return 0;
    });

    renderTable(filteredRecords);
  }

  function renderTable(records) {
    recordsTableBody.innerHTML = '';

    if (records.length === 0) {
      recordsTable.style.display = 'none';
      emptyState.classList.add('show');
    } else {
      recordsTable.style.display = 'table';
      emptyState.classList.remove('show');

      records.forEach(record => {
        const realIdx = allRecords.indexOf(record);
        const isSelected = selectedIndices.has(realIdx);
        const row = document.createElement('tr');
        if (record.multiLocation) row.classList.add('multi-location-row');
        if (isSelected) row.classList.add('selected-row');
        row.dataset.realIdx = realIdx;
        row.innerHTML = `
          <td class="col-select"><input type="checkbox" class="row-checkbox" data-idx="${realIdx}" ${isSelected ? 'checked' : ''}></td>
          <td class="col-title">${escapeHtml(record.title || '')}</td>
          <td class="col-jobid">${escapeHtml(record.jobId || 'N/A')}</td>
          <td class="col-aop">${escapeHtml(record.areaOfPractice || '-')}</td>
          <td class="col-position">${escapeHtml(record.position || '-')}</td>
          <td class="col-salary">${escapeHtml(record.salary || '-')}</td>
          <td class="col-jobtype">${escapeHtml(record.jobType || '-')}</td>
          <td class="col-hospital">${escapeHtml(record.hospitalName || '-')}</td>
          <td class="col-city">${escapeHtml(record.city || '')}</td>
          <td class="col-state">${escapeHtml(record.state || '')}</td>
          <td class="col-address">${escapeHtml(record.streetAddress || '')}</td>
          <td class="col-zip">${escapeHtml(record.zipCode || '')}</td>
          <td class="col-phone">${escapeHtml(record.phone || '')}</td>
          <td class="col-website">${record.website ? `<a href="${escapeHtml(record.website)}" target="_blank">Visit</a>` : ''}</td>
          <td class="col-link"><a href="${record.link}" target="_blank">View Job</a></td>
          <td class="col-actions">
              <button class="view-description-btn" data-description="${escapeHtml(record.description || '')}">View Description</button>
          </td>
        `;
        recordsTableBody.appendChild(row);
      });

      // Checkbox row selection
      document.querySelectorAll('.row-checkbox').forEach(cb => {
        cb.addEventListener('change', () => {
          const idx = parseInt(cb.dataset.idx, 10);
          if (cb.checked) {
            selectedIndices.add(idx);
            cb.closest('tr').classList.add('selected-row');
          } else {
            selectedIndices.delete(idx);
            cb.closest('tr').classList.remove('selected-row');
          }
          updateSelectionUI();
        });
      });

      updateSelectionUI();

      document.querySelectorAll('.view-description-btn').forEach(button => {
        button.addEventListener('click', (event) => {
          const description = event.target.dataset.description;
          if (description && description !== 'N/A' && description !== '') {
            showDescriptionModal(description);
          } else {
            showToast('No description available', 'error');
          }
        });
      });
    }

    updateRecordCount(records.length);
  }

  function updateRowInDOM(realIndex, record) {
    const row = document.querySelector(`tr[data-real-idx="${realIndex}"]`);
    if (!row) return;

    // Mapping of classes to record properties
    const cellMap = {
      '.col-title': record.title || '',
      '.col-jobid': record.jobId || 'N/A',
      '.col-aop': record.areaOfPractice || '-',
      '.col-position': record.position || '-',
      '.col-salary': record.salary || '-',
      '.col-jobtype': record.jobType || '-',
      '.col-hospital': record.hospitalName || '-',
      '.col-city': record.city || '',
      '.col-state': record.state || '',
      '.col-address': record.streetAddress || '',
      '.col-zip': record.zipCode || '',
      '.col-phone': record.phone || ''
    };

    Object.entries(cellMap).forEach(([selector, value]) => {
      const cell = row.querySelector(selector);
      if (cell) cell.textContent = value;
    });

    // Update website link
    const webCell = row.querySelector('.col-website');
    if (webCell) {
      webCell.innerHTML = record.website ? `<a href="${escapeHtml(record.website)}" target="_blank">Visit</a>` : '';
    }

    // Update description button
    const descBtn = row.querySelector('.view-description-btn');
    if (descBtn) {
      descBtn.dataset.description = escapeHtml(record.description || '');
    }

    // Update row visual state
    if (record.multiLocation) row.classList.add('multi-location-row');
  }

  // ============ FETCH ADDRESSES VIA GOOGLE MAPS ============
  // Opens a Google Maps search tab, injects google-maps-scraper.js which:
  //   1. Waits for results/place panel to load
  //   2. Matches hospital name from aria-labels and clicks best result
  //   3. Extracts address, zip, city, state from the place detail panel
  // Retries with a simplified query if the first attempt fails.
  async function fetchAddressFromGoogleMaps(hospitalName, location) {
    const searchQuery = `${hospitalName}, ${location}`;
    const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`;

    function scrapeGoogleMapsTab(url, queryLabel) {
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          console.warn(`✗ Google Maps timeout for: "${queryLabel}"`);
          resolve({ streetAddress: '', zipCode: '', city: '', state: '', website: '', phone: '' });
        }, 30000);

        chrome.tabs.create({ url: url, active: false }, (tab) => {
          if (!tab) {
            clearTimeout(timeout);
            resolve({ streetAddress: '', zipCode: '', city: '', state: '', website: '', phone: '' });
            return;
          }

          const tabId = tab.id;
          const listener = (updatedTabId, info) => {
            if (updatedTabId === tabId && info.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              // Wait 2s for Google Maps SPA to start rendering
              setTimeout(() => {
                chrome.scripting.executeScript({
                  target: { tabId: tabId },
                  files: ['google-maps-scraper.js']
                }).then((results) => {
                  clearTimeout(timeout);
                  chrome.tabs.remove(tabId).catch(() => {});
                  const data = results?.[0]?.result || {};
                  resolve({
                    streetAddress: data.streetAddress || '',
                    zipCode: data.zipCode || '',
                    city: data.city || '',
                    state: data.state || '',
                    fullAddress: data.fullAddress || '',
                    website: data.website || '',
                    phone: data.phone || ''
                  });
                }).catch((err) => {
                  console.error(`Google Maps script error for "${queryLabel}":`, err);
                  clearTimeout(timeout);
                  chrome.tabs.remove(tabId).catch(() => {});
                  resolve({ streetAddress: '', zipCode: '', city: '', state: '', website: '', phone: '' });
                });
              }, 2000);
            }
          };

          chrome.tabs.onUpdated.addListener(listener);
        });
      });
    }

    // Attempt 1: search with hospital name + location
    console.log(`🔍 Google Maps search: "${searchQuery}"`);
    let data = await scrapeGoogleMapsTab(mapsUrl, searchQuery);

    // Attempt 2: simplify hospital name if first attempt failed
    if (!data.streetAddress && !data.zipCode) {
      const simplifiedName = hospitalName
        .replace(/&/g, 'and')
        .replace(/[-–—()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const altQuery = `${simplifiedName}, ${location}`;
      if (altQuery !== searchQuery) {
        console.log(`↻ Retry with: "${altQuery}"`);
        const altUrl = `https://www.google.com/maps/search/${encodeURIComponent(altQuery)}`;
        data = await scrapeGoogleMapsTab(altUrl, altQuery);
      }
    }

    if (data.streetAddress || data.zipCode) {
      console.log(`✓ SUCCESS: "${searchQuery}" → Street="${data.streetAddress}", Zip="${data.zipCode}"`);
    } else {
      console.warn(`✗ No address found for: "${searchQuery}"`);
    }

    return {
      streetAddress: data.streetAddress || '',
      zipCode: data.zipCode || '',
      city: data.city || '',
      state: data.state || '',
      fullAddress: data.fullAddress || '',
      website: data.website || '',
      phone: data.phone || ''
    };
  }

  async function processNextAddress() {
    if (currentAddressIndex >= addressQueue.length) {
      // All done
      isFetchingAddresses = false;
      fetchAddressesBtn.disabled = false;
      fetchAddressesBtn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5s2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="currentColor"/>
        </svg>
        Fetch Addresses`;
      document.getElementById('progressSection').classList.add('hidden');
      showToast(`Address fetching complete! Processed ${addressQueue.length} jobs.`, 'success');
      // No need to loadRecords(), as we update rows live
      return;
    }

    const { recordIndex } = addressQueue[currentAddressIndex];
    const record = allRecords[recordIndex];

    // Update progress
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    const percent = Math.round((currentAddressIndex / addressQueue.length) * 100);
    progressBar.style.width = `${percent}%`;
    progressText.textContent = `${currentAddressIndex} / ${addressQueue.length}`;

    // Build location string from existing city/state
    const location = [record.city, record.state].filter(Boolean).join(', ') || 'USA';
    const hospitalName = record.hospitalName || record.title || '';

    // ── Deduplication: if another record with the same hospital name already has
    //    an address (fetched earlier in this run or a previous run), copy it directly
    //    instead of opening Google Maps again.
    const hospitalKey = hospitalName.trim().toLowerCase();
    const donor = allRecords.find((r, i) =>
      i !== recordIndex &&
      (r.hospitalName || '').trim().toLowerCase() === hospitalKey &&
      r.streetAddress
    );

    let addressData;
    if (donor) {
      console.log(`[${currentAddressIndex + 1}/${addressQueue.length}] Copying address from duplicate: ${hospitalName}`);
      addressData = {
        streetAddress: donor.streetAddress || '',
        zipCode:       donor.zipCode       || '',
        city:          donor.city          || '',
        state:         donor.state         || '',
        phone:         donor.phone         || '',
        website:       donor.website       || ''
      };
    } else {
      console.log(`[${currentAddressIndex + 1}/${addressQueue.length}] Fetching address for: ${hospitalName}, ${location}`);
      addressData = await fetchAddressFromGoogleMaps(hospitalName, location);
    }

    // Save to storage
    await new Promise((resolve) => {
      chrome.storage.local.get({ records: [] }, (result) => {
        const records = result.records;
        if (records[recordIndex]) {
          if (addressData.streetAddress) records[recordIndex].streetAddress = addressData.streetAddress;
          if (addressData.zipCode)       records[recordIndex].zipCode       = addressData.zipCode;
          if (addressData.city && !records[recordIndex].city)   records[recordIndex].city  = addressData.city;
          if (addressData.state && !records[recordIndex].state) records[recordIndex].state = addressData.state;
          if (addressData.phone)   records[recordIndex].phone   = addressData.phone.replace(/\s+/g, ' ').trim();
          if (addressData.website) records[recordIndex].website = addressData.website.trim();
          // Update allRecords cache so subsequent duplicates can find this data
          allRecords[recordIndex] = { ...allRecords[recordIndex], ...records[recordIndex] };
          
          // Live update the row in DOM
          updateRowInDOM(recordIndex, allRecords[recordIndex]);
        }
        chrome.storage.local.set({ records: records }, resolve);
      });
    });

    currentAddressIndex++;
    // Small delay between requests to avoid rate limiting
    setTimeout(() => processNextAddress(), 1000);
  }

  // ============ FETCH DETAILS ============
  // Opens each job URL in a background tab, injects detail-extractor.js,
  // and saves: areaOfPractice, position, salary, hospitalName to each record.

  // Opens a job URL in a background tab and returns the extracted detail list.
  function fetchDetailFromTab(url) {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.warn('Fetch Details timeout for:', url);
        resolve([]);
      }, 40000); // 40s — generous for slow connections

      // Add ?nl=1 so Jobvite serves the standalone page (not inside parent iframe)
      let finalUrl = url;
      try {
        const urlObj = new URL(url);
        if (urlObj.hostname.includes('jobvite.com')) {
          urlObj.searchParams.set('nl', '1');
          finalUrl = urlObj.toString();
        }
      } catch (e) {}

      chrome.tabs.create({ url: finalUrl, active: false }, (tab) => {
        if (!tab) {
          clearTimeout(timeout);
          resolve([]);
          return;
        }

        const tabId = tab.id;
        let alreadyResolved = false;

        function injectAndResolve() {
          if (alreadyResolved) return;
          // Wait 3s for Angular/Jobvite page JS to finish rendering
          setTimeout(() => {
            chrome.scripting.executeScript({
              target: { tabId: tabId },
              files: ['detail-extractor.js']
            }).then((results) => {
              if (alreadyResolved) return;
              alreadyResolved = true;
              clearTimeout(timeout);
              chrome.tabs.remove(tabId).catch(() => {});
              const detailsList = results?.[0]?.result || [];
              resolve(Array.isArray(detailsList) ? detailsList : [detailsList]);
            }).catch((err) => {
              if (alreadyResolved) return;
              alreadyResolved = true;
              console.warn('Error injecting detail-extractor:', err);
              clearTimeout(timeout);
              chrome.tabs.remove(tabId).catch(() => {});
              resolve([]);
            });
          }, 3000);
        }

        const listener = (updatedTabId, info) => {
          if (updatedTabId === tabId && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            injectAndResolve();
          }
        };

        chrome.tabs.onUpdated.addListener(listener);

        // Race-condition fix: tab may have already reached 'complete' before
        // the listener was registered (happens with cached/fast-loading pages).
        chrome.tabs.get(tabId, (t) => {
          if (chrome.runtime.lastError) return; // tab gone already
          if (t && t.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            injectAndResolve();
          }
        });
      });
    });
  }

  // Save extracted detail results to the record in chrome storage.
  // If the job has multiple locations (detailsList.length > 1), the existing record
  // gets Location 1 and a new cloned record is appended for each additional location.
  function saveDetailResults(detailsList, recordIndex) {
    return new Promise((resolve) => {
      chrome.storage.local.get({ records: [] }, (result) => {
        const records = result.records;
        const record = records[recordIndex];
        if (!record) { resolve(); return; }

        const firstDetail = detailsList[0];
        if (!firstDetail) { resolve(); return; }

        // ── Helper: apply a detail object to a record ──
        function applyDetail(rec, detail) {
          if (detail.areaOfPractice) rec.areaOfPractice = detail.areaOfPractice;

          const detailAOP = detail.areaOfPractice || rec.areaOfPractice || '';
          if (detail.position) {
            rec.position = detail.position;
          } else {
            rec.position = getPositionFromTitle(rec.title || '', detailAOP, detail.description || rec.description || '');
          }

          if (detail.salary)  rec.salary  = detail.salary;
          if (detail.jobType) rec.jobType  = detail.jobType;

          // Hospital name
          const skipLocs = ['nationwide', 'remote', 'national', 'multiple', 'united states', ''];
          if (detail.hospitalName && detail.hospitalName !== 'MedVet') {
            rec.hospitalName = detail.hospitalName;
          } else if (!rec.hospitalName || rec.hospitalName === 'MedVet') {
            const city = detail.city || rec.city || '';
            rec.hospitalName = (city && !skipLocs.includes(city.toLowerCase()))
              ? 'MedVet ' + city
              : (rec.hospitalName || 'MedVet');
          }

          // City / State — overwrite if "2 Locations" placeholder or empty
          const cityIsPlaceholder = /^\d+\s+location/i.test(rec.city || '');
          if (detail.city && (!rec.city || cityIsPlaceholder)) rec.city  = detail.city;
          if (detail.state && (!rec.state || cityIsPlaceholder)) rec.state = detail.state;

          if (detail.description && (!rec.description || rec.description.trim() === '')) {
            rec.description = detail.description;
          }

          rec.detailsFetched = true;
        }

        // ── Apply Location 1 to the existing record ──
        applyDetail(record, firstDetail);
        // Flag both the original and clones if there are multiple locations
        if (detailsList.length > 1) record.multiLocation = true;

        // ── For each additional location, clone the record and append ──
        for (let i = 1; i < detailsList.length; i++) {
          const extraDetail = detailsList[i];
          if (!extraDetail || (!extraDetail.city && !extraDetail.state)) continue;

          // Deep-clone the (now-updated) base record
          const newRecord = JSON.parse(JSON.stringify(record));

          // Clear address fields — these are location-specific and must be re-fetched
          newRecord.streetAddress = '';
          newRecord.zipCode       = '';
          newRecord.phone         = '';
          newRecord.website       = '';
          newRecord.detailsFetched  = true;
          newRecord.multiLocation   = true;

          // Override location fields with the extra location
          const skipLocs = ['nationwide', 'remote', 'national', 'multiple', 'united states', ''];
          newRecord.city  = extraDetail.city  || '';
          newRecord.state = extraDetail.state || '';
          if (extraDetail.hospitalName && extraDetail.hospitalName !== 'MedVet') {
            newRecord.hospitalName = extraDetail.hospitalName;
          } else {
            const city = extraDetail.city || '';
            newRecord.hospitalName = (city && !skipLocs.includes(city.toLowerCase()))
              ? 'MedVet ' + city
              : 'MedVet';
          }

          records.push(newRecord);
          console.log(`  ↳ Created extra location record: ${newRecord.hospitalName} (${newRecord.city}, ${newRecord.state})`);
        }

        chrome.storage.local.set({ records }, () => {
          // Refresh allRecords so the table and address queue see the new records
          allRecords = records;
          
          if (detailsList.length > 1) {
            // If new rows were added (multi-location), we must re-render the table
            filterRecords();
          } else {
            // Just update the single row live
            updateRowInDOM(recordIndex, allRecords[recordIndex]);
          }
          
          updateSelectionUI();
          resolve();
        });
      });
    });
  }

  // Map raw Jobvite category string to canonical position name.
  // Matches the same logic as detail-extractor.js matchPositionFromCategory().
  function matchPositionFromCategory(category) {
    if (!category) return '';
    const c = category.toLowerCase().trim();
    if (c.includes('criticalist') || c === 'ecc' || c.includes('ecc ') || c.includes(' ecc') ||
        c === 'critical care' || c.includes('critical care') ||
        c.includes('emergency and critical care') || c.includes('emergency & critical care')) return 'ECC Specialist';
    if (c.includes('radiation oncolog')) return 'Radiation Oncologist';
    if (c.includes('medical oncolog')) return 'Medical Oncologist';
    if (c.includes('oncolog') && !c.includes('radiation')) return 'Medical Oncologist';
    if (c.includes('cardiolog')) return 'Cardiologist';
    if (c.includes('neurolog') || c.includes('neurosurg')) return 'Neurologist & Neurosurgeon';
    if (c.includes('dermatolog')) return 'Dermatologist';
    if (c.includes('ophthalmolog') || c.includes('ophtho')) return 'Ophthalmologist';
    if (c.includes('anesthesiolog') || c === 'anesthesia' || c.includes('anesthesia')) return 'Anesthesiologist';
    if (c.includes('theriogenolog')) return 'Theriogenologist';
    if (c.includes('internal medicine') || c.includes('internist') || c.includes('saim')) return 'Internal Medicine Specialist';
    if (c.includes('radiolog') || c.includes('diagnostic imaging')) return 'Radiologist';
    if ((c.includes('surgeon') || c.includes('surgery')) && !c.includes('neurosurg')) return 'Surgeon';
    if (c.includes('dental') || c.includes('dentistry') || c.includes('davdc')) return 'Dental Specialist';
    if (c.includes('dabvp')) return 'DABVP Specialist';
    if (c.includes('rehabilitation') || c.includes('rehab')) return 'Credentialed Veterinary Technician Specialist';
    return '';
  }

  // Derive position from title + AOP + optional category (mirrors detail-extractor.js logic)
  function getPositionFromTitle(title, aop, descriptionText, category) {
    const t = title.toLowerCase();
    const c = (category || '').toLowerCase();

    // ── Is this a TECHNICIAN role? ──
    // Exception: anesthesia technician → Anesthesiologist (per business rule)
    const isTechRole = /\b(technician|technologist|vet\s+tech|nurse)\b/.test(t) &&
                       !t.includes('technician specialist') && !t.match(/\bvts\b/);
    if (isTechRole) {
      // Map technician roles to the specialist position for their department.
      if (t.includes('anesthesia') || t.includes('anesthesiolog')) return 'Anesthesiologist';
      if (t.includes('dental') || t.includes('dentistry') || t.includes('dentist')) return validatePos('Dental Specialist', aop);
      if (t.includes('critical care') || t.match(/\becc\b/) || t.includes('criticalist')) return validatePos('ECC Specialist', aop);
      if (t.includes('radiation oncolog') || (t.includes('radiation') && t.includes('oncol'))) return validatePos('Radiation Oncologist', aop);
      if (t.includes('oncolog') && !t.includes('radiation')) return validatePos('Medical Oncologist', aop);
      if (t.includes('cardiolog') || t.includes('cardiology')) return validatePos('Cardiologist', aop);
      if (t.includes('neurolog') || t.includes('neurosurg')) return validatePos('Neurologist & Neurosurgeon', aop);
      if (t.includes('dermatolog')) return validatePos('Dermatologist', aop);
      if (t.includes('ophthalmolog')) return validatePos('Ophthalmologist', aop);
      if ((t.includes('surgery') || t.includes('surgical') || t.includes('surgeon')) && !t.includes('neurosurg')) return validatePos('Surgeon', aop);
      if (t.includes('radiolog') || t.includes('diagnostic imaging')) return validatePos('Radiologist', aop);
      if (t.includes('internal medicine')) return validatePos('Internal Medicine Specialist', aop);
      const specTechKw = ['rehabilitation', 'emergency', 'imaging', 'specialist', 'specialty'];
      for (const kw of specTechKw) {
        if (t.includes(kw)) return validatePos('Credentialed Veterinary Technician Specialist', aop);
      }
    }

    // ── VTS ──
    if (t.includes('technician specialist') || t.match(/\bvts\b/)) {
      return validatePos('Credentialed Veterinary Technician Specialist', aop);
    }

    // ── Leadership — highest priority ──
    if (t.includes('medical director')) return validatePos('Medical Director', aop);
    if (t.includes('lead veterinarian') || t.includes('lead vet')) return validatePos('Lead Veterinarian', aop);

    // ── ECC Specialist — check BEFORE generic "emergency" ──
    if (t.includes('criticalist') || t.includes('dacvecc') || t.match(/\becc\b/) ||
        (t.includes('emergency') && t.includes('critical care')) ||
        (t.includes('emergency') && t.includes('criticalist'))) {
      return validatePos('ECC Specialist', aop);
    }

    // ── Specialty positions ──
    if (t.includes('neurologist') || t.includes('neurosurgeon') ||
        (t.includes('neurology') && !isTechRole)) return validatePos('Neurologist & Neurosurgeon', aop);
    if (t.includes('dermatologist') ||
        (t.includes('dermatology') && !isTechRole)) return validatePos('Dermatologist', aop);
    if (t.includes('cardiologist') ||
        (t.includes('cardiology') && !isTechRole)) return validatePos('Cardiologist', aop);
    if ((t.includes('oncologist') || t.includes('oncology')) && t.includes('radiation')) return validatePos('Radiation Oncologist', aop);
    if (t.includes('oncologist') ||
        (t.includes('oncology') && !isTechRole)) return validatePos('Medical Oncologist', aop);
    if (t.includes('radiologist') || t.includes('diagnostic imaging') ||
        (t.includes('radiology') && !isTechRole)) return validatePos('Radiologist', aop);
    if (t.includes('ophthalmologist') ||
        (t.includes('ophthalmology') && !isTechRole)) return validatePos('Ophthalmologist', aop);
    if (t.includes('anesthesiologist') ||
        (t.includes('anesthesia') && !isTechRole)) return validatePos('Anesthesiologist', aop);
    if (t.includes('theriogenologist') ||
        (t.includes('theriogenology') && !isTechRole)) return validatePos('Theriogenologist', aop);
    if (t.includes('internist') ||
        (t.includes('internal medicine') && !isTechRole)) return validatePos('Internal Medicine Specialist', aop);
    if (t.includes('dabvp')) return validatePos('DABVP Specialist', aop);
    if ((t.includes('dental') || t.includes('dentist') || t.includes('dentistry')) &&
        !t.includes('assistant')) return validatePos('Dental Specialist', aop);
    if ((t.includes('surgeon') || t.includes('surgery')) &&
        !t.includes('neurosurgeon') && !t.includes('dental') && !isTechRole) return validatePos('Surgeon', aop);
    if (t.includes('equine') || t.includes('bovine') || t.includes('large animal')) return 'Equine/Bovine Veterinarian/Large Animal';
    if (t.includes('avian') || t.includes('exotics')) return 'Avian & Exotics Veterinarian / Associate Exotics';
    if (t.includes('partner veterinarian')) return validatePos('Partner Veterinarian', aop);

    // ── Non-clinical role guard ──
    // Admin/support titles must NOT inherit a specialist position from their department category.
    // e.g. "Client Service Representative" in Ophthalmology dept must NOT become "Ophthalmologist".
    const isNonClinical =
      t.includes('client service') || t.includes('service representative') ||
      t.includes('receptionist') || t.includes('kennel') ||
      t.includes('groomer') || t.includes('grooming') ||
      t.includes('practice manager') || t.includes('hospital manager') ||
      t.includes('office manager') || t.includes('administrator') ||
      t.includes('billing') || t.includes('human resources') ||
      t.includes('patient care coordinator') || t.includes('client care coordinator') ||
      t.includes('customer service') || t.includes('front desk') ||
      t.includes('inventory') || t.includes('housekeeper') || t.includes('janitorial');
    if (isNonClinical) return 'Associate Veterinarian';

    // ── Fallback: try category string mapping ──
    // Only reached by clinical roles (DVM/tech) whose title didn't contain a specialty keyword.
    if (c) {
      const fromCat = matchPositionFromCategory(c);
      if (fromCat) return validatePos(fromCat, aop);
    }

    // ── Try qualifications from description for specialty AOP ──
    if (aop === 'Specialty Care' && descriptionText) {
      const desc = descriptionText.toLowerCase();
      if (desc.includes('dacvecc')) return 'ECC Specialist';
      if (desc.includes('dacvim') && desc.includes('oncology')) return 'Medical Oncologist';
      if (desc.includes('dacvr') && desc.includes('radiation')) return 'Radiation Oncologist';
      if (desc.includes('dacvim') && desc.includes('neurology')) return 'Neurologist & Neurosurgeon';
      if (desc.includes('dacvim') && desc.includes('cardiology')) return 'Cardiologist';
      if (desc.includes('dacvim')) return 'Internal Medicine Specialist';
      if (desc.includes('davdc')) return 'Dental Specialist';
      if (desc.includes('dacvd')) return 'Dermatologist';
      if (desc.includes('dacvs') || desc.includes('acvs')) return 'Surgeon';
      if (desc.includes('dacvr')) return 'Radiologist';
      if (desc.includes('dacvo')) return 'Ophthalmologist';
      if (desc.includes('dacvaa')) return 'Anesthesiologist';
      if (desc.includes('dact')) return 'Theriogenologist';
      if (desc.includes('dabvp')) return 'DABVP Specialist';
    }

    return 'Associate Veterinarian';
  }

  // Validate that a position is allowed for the given AOP
  function validatePos(position, aop) {
    const validPositions = {
      'Emergency Care': ['Associate Veterinarian'],
      'General Practice Care': ['Associate Veterinarian', 'Lead Veterinarian', 'Medical Director'],
      'Specialty Care': [
        'Anesthesiologist', 'Cardiologist', 'Credentialed Veterinary Technician Specialist',
        'DABVP Specialist', 'Dental Specialist', 'Dermatologist', 'ECC Specialist',
        'Internal Medicine Specialist', 'Medical Director', 'Medical Oncologist',
        'Neurologist & Neurosurgeon', 'Ophthalmologist', 'Radiation Oncologist',
        'Radiologist', 'Surgeon'
      ],
      'Urgent Care': ['Associate Veterinarian', 'Partner Veterinarian'],
    };
    if (!aop) return position;
    const aopParts = aop.split('/').map(s => s.trim());
    for (const part of aopParts) {
      const allowed = validPositions[part];
      if (allowed && allowed.includes(position)) return position;
    }
    const hasKnownAOP = aopParts.some(part => validPositions[part]);
    if (hasKnownAOP) {
      // Medical Director is always valid regardless
      if (position === 'Medical Director') return 'Medical Director';
      return 'Associate Veterinarian';
    }
    return position;
  }

  function finishDetailsFetching() {
    isFetchingDetails = false;
    fetchDetailsBtn.disabled = false;
    fetchDetailsBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M11 17h2v-6h-2v6zm1-15C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zM11 9h2V7h-2v2z" fill="currentColor"/>
      </svg>
      Fetch Details`;
    document.getElementById('progressSection').classList.add('hidden');
    showToast(`Details fetched for ${detailsQueue.length} job(s)!`, 'success');
    loadRecords();
  }

  async function processNextDetail() {
    if (currentDetailsIndex >= detailsQueue.length) {
      finishDetailsFetching();
      return;
    }

    const { recordIndex } = detailsQueue[currentDetailsIndex];

    // Update progress bar
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    const percent = Math.round(((currentDetailsIndex + 1) / detailsQueue.length) * 100);
    progressBar.style.width = `${percent}%`;
    progressText.textContent = `${currentDetailsIndex + 1} / ${detailsQueue.length}`;
    fetchDetailsBtn.textContent = `Fetching... (${currentDetailsIndex + 1}/${detailsQueue.length})`;

    const record = allRecords[recordIndex];
    console.log(`[${currentDetailsIndex + 1}/${detailsQueue.length}] Fetching details for: ${record.title}`);

    let detailsList = await fetchDetailFromTab(record.link);

    // Auto-retry once if the first attempt returned nothing (timeout / race condition)
    if (detailsList.length === 0) {
      console.warn(`Retrying (once) for: ${record.title}`);
      await new Promise(r => setTimeout(r, 4000));
      detailsList = await fetchDetailFromTab(record.link);
    }

    if (detailsList.length > 0) {
      await saveDetailResults(detailsList, recordIndex);
    } else {
      console.warn(`Skipped (no data after retry): ${record.title}`);
    }

    currentDetailsIndex++;
    // Small delay between tab openings to avoid rate limiting
    setTimeout(() => processNextDetail(), 1000);
  }

  // ── Shared helper: start a Fetch Details run with a given queue ──
  function startFetchDetails(queue) {
    if (queue.length === 0) {
      showToast('No jobs to fetch details for.', 'error');
      return;
    }
    detailsQueue = queue;
    isFetchingDetails = true;
    currentDetailsIndex = 0;
    fetchDetailsBtn.disabled = true;
    fetchDetailsBtn.textContent = 'Fetching Details...';
    const progressSection = document.getElementById('progressSection');
    const progressBar     = document.getElementById('progressBar');
    const progressText    = document.getElementById('progressText');
    progressSection.classList.remove('hidden');
    progressBar.style.width = '0%';
    progressText.textContent = `0 / ${queue.length}`;
    processNextDetail();
  }

  fetchDetailsBtn.addEventListener('click', async () => {
    if (isFetchingDetails) {
      showToast('Already fetching details. Please wait...', 'error');
      return;
    }
    if (allRecords.length === 0) {
      showToast('No records to fetch details for', 'error');
      return;
    }
    // Queue only records that haven't been fetched yet (resume support)
    let queue = allRecords
      .map((record, index) => ({ record, recordIndex: index }))
      .filter(({ record }) => !record.detailsFetched);
    if (queue.length === 0) {
      if (!confirm('All records already have details. Re-fetch all?')) return;
      queue = allRecords.map((record, index) => ({ record, recordIndex: index }));
    }
    if (!confirm(`This will fetch details for ${queue.length} job(s) by opening each in a background tab. Continue?`)) return;
    startFetchDetails(queue);
  });

  fetchSelectedDetailsBtn.addEventListener('click', () => {
    if (isFetchingDetails) {
      showToast('Already fetching details. Please wait...', 'error');
      return;
    }
    const queue = Array.from(selectedIndices)
      .sort((a, b) => a - b)
      .map(idx => ({ record: allRecords[idx], recordIndex: idx }))
      .filter(({ record }) => record);
    if (!confirm(`Fetch details for ${queue.length} selected job(s)?`)) return;
    startFetchDetails(queue);
  });

  // ============ FETCH ADDRESSES ============

  fetchAddressesBtn.addEventListener('click', async () => {
    if (isFetchingAddresses) {
      showToast('Already fetching addresses. Please wait...', 'error');
      return;
    }

    if (allRecords.length === 0) {
      showToast('No records to fetch addresses for', 'error');
      return;
    }

    // Queue only records that don't already have a street address
    let queue = allRecords
      .map((record, index) => ({ record, recordIndex: index }))
      .filter(({ record }) => !record.streetAddress);

    if (queue.length === 0) {
      if (!confirm('All records already have street addresses. Re-fetch all?')) return;
      queue = allRecords.map((record, index) => ({ record, recordIndex: index }));
    }

    if (!confirm(`This will fetch street addresses for ${queue.length} job(s) via Google Maps. Continue?`)) return;

    startFetchAddresses(queue);
  });

  fetchSelectedAddressesBtn.addEventListener('click', () => {
    if (isFetchingAddresses) {
      showToast('Already fetching addresses. Please wait...', 'error');
      return;
    }
    const queue = Array.from(selectedIndices)
      .sort((a, b) => a - b)
      .map(idx => ({ record: allRecords[idx], recordIndex: idx }))
      .filter(({ record }) => record);
    if (!confirm(`Fetch addresses for ${queue.length} selected job(s) via Google Maps?`)) return;
    startFetchAddresses(queue);
  });

  // ── Shared helper: start a Fetch Addresses run with a given queue ──
  function startFetchAddresses(queue) {
    if (queue.length === 0) {
      showToast('No jobs to fetch addresses for.', 'error');
      return;
    }
    addressQueue = queue;
    isFetchingAddresses = true;
    currentAddressIndex = 0;
    fetchAddressesBtn.disabled = true;
    fetchAddressesBtn.textContent = 'Fetching Addresses...';
    const progressSection = document.getElementById('progressSection');
    const progressBar     = document.getElementById('progressBar');
    const progressText    = document.getElementById('progressText');
    progressSection.classList.remove('hidden');
    progressBar.style.width = '0%';
    progressText.textContent = `0 / ${queue.length}`;
    processNextAddress();
  }

  function loadRecords() {
    chrome.storage.local.get({ records: [] }, (result) => {
      allRecords = result.records;
      filteredRecords = [...allRecords];
      populateFilters(allRecords);
      renderTable(filteredRecords);
      updateSelectionUI();
    });
  }

  // Search functionality
  searchInput.addEventListener('input', filterRecords);

  // Filter functionality
  stateFilter.addEventListener('change', filterRecords);
  positionFilter.addEventListener('change', filterRecords);
  aopFilter.addEventListener('change', filterRecords);

  // Sorting functionality
  document.querySelectorAll('.sortable').forEach(header => {
    header.addEventListener('click', () => {
      const column = header.dataset.column;

      // Remove sorted class from all headers
      document.querySelectorAll('.sortable').forEach(h => {
        h.classList.remove('sorted-asc', 'sorted-desc');
      });

      // Toggle sort direction
      if (sortColumn === column) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        sortDirection = 'asc';
      }

      sortColumn = column;

      // Add sorted class to current header
      header.classList.add(sortDirection === 'asc' ? 'sorted-asc' : 'sorted-desc');

      sortRecords(column, sortDirection);
    });
  });

  clearRecordsButton.addEventListener('click', () => {
    if (allRecords.length === 0) {
      showToast('No records to clear', 'error');
      return;
    }

    if (confirm('Are you sure you want to clear all records?')) {
      chrome.storage.local.set({ records: [] }, () => {
        allRecords = [];
        filteredRecords = [];
        loadRecords();
        showToast('All records cleared successfully', 'success');
      });
    }
  });

  downloadCsvButton.addEventListener('click', () => {
    if (allRecords.length === 0) {
      showToast('No records to download', 'error');
      return;
    }

    const headers = ['Title', 'Job ID', 'Area of Practice', 'Position', 'Salary', 'Job Type', 'Hospital Name', 'City', 'State', 'Street Address', 'Zip Code', 'Phone', 'Website', 'Link', 'Description'];
    let csvContent = headers.join(',') + '\n';

    allRecords.forEach(record => {
      const escapeCsvCell = (cell) => {
        const strCell = String(cell);
        if (strCell.includes(',') || strCell.includes('"') || strCell.includes('\n')) {
          return `"${strCell.replace(/"/g, '""')}"`;
        }
        return strCell;
      };

      const row = [
        escapeCsvCell(record.title || ''),
        escapeCsvCell(record.jobId || 'N/A'),
        escapeCsvCell(record.areaOfPractice || ''),
        escapeCsvCell(record.position || ''),
        escapeCsvCell(record.salary || ''),
        escapeCsvCell(record.jobType || ''),
        escapeCsvCell(record.hospitalName || ''),
        escapeCsvCell(record.city || ''),
        escapeCsvCell(record.state || ''),
        escapeCsvCell(record.streetAddress || ''),
        escapeCsvCell(record.zipCode || ''),
        escapeCsvCell(record.phone || ''),
        escapeCsvCell(record.website || ''),
        escapeCsvCell(record.link || ''),
        escapeCsvCell((record.description || '').replace(/[\r\n]+/g, ' '))
      ].join(',');
      csvContent += row + '\n';
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'jobs.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast('CSV downloaded successfully', 'success');
  });

  // Listen for description saved messages from background script
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'descriptionSaved') {
      console.log(`Description saved for job ${request.jobIndex + 1}, success: ${request.success}`);

      // Refresh records from storage
      chrome.storage.local.get({ records: [] }, (result) => {
        allRecords = result.records;
        
        // Update the row in DOM live
        if (request.jobIndex !== undefined && allRecords[request.jobIndex]) {
          updateRowInDOM(request.jobIndex, allRecords[request.jobIndex]);
        } else {
          filterRecords();
        }

        // Update progress
        const total = allRecords.length;
        const withDesc = allRecords.filter(r => r.description && r.description.trim() !== '').length;
        const percent = Math.round((withDesc / total) * 100);
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        progressBar.style.width = `${percent}%`;
        progressText.textContent = `${withDesc} / ${total}`;

        if (isGettingDescriptions) {
          setTimeout(() => {
            processNextJob();
          }, 1500);
        }
      });
    }
  });

  function processNextJob() {
    // Refresh from storage first
    chrome.storage.local.get({ records: [] }, (result) => {
      allRecords = result.records;

      // Find next job without description
      let foundJob = false;
      for (let i = 0; i < allRecords.length; i++) {
        if (!allRecords[i].description || allRecords[i].description.trim() === '') {
          currentJobIndex = i;
          foundJob = true;
          break;
        }
      }

      if (!foundJob) {
        isGettingDescriptions = false;
        getJobDescriptionsButton.disabled = false;
        getJobDescriptionsButton.innerHTML = `
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z" fill="currentColor"/>
          </svg>
          Get Job Descriptions`;
        document.getElementById('progressSection').classList.add('hidden');
        showToast('All jobs have descriptions now!', 'success');
        return;
      }

      const record = allRecords[currentJobIndex];
      console.log(`Processing job ${currentJobIndex + 1} of ${allRecords.length}: ${record.title}`);

      // Update progress
      const withDesc = allRecords.filter(r => r.description && r.description.trim() !== '').length;
      const percent = Math.round((withDesc / allRecords.length) * 100);
      const progressBar = document.getElementById('progressBar');
      const progressText = document.getElementById('progressText');
      progressBar.style.width = `${percent}%`;
      progressText.textContent = `${withDesc} / ${allRecords.length}`;

      // Open tab and send message to background to scrape
      // Pass city/state so background.js can construct "MedVet [City]" as a fallback
      chrome.tabs.create({ url: record.link, active: false }, (tab) => {
        chrome.runtime.sendMessage({
          action: 'scrapeJobDescription',
          tabId: tab.id,
          jobIndex: currentJobIndex,
          jobLink: record.link,
          recordCity: record.city || '',
          recordState: record.state || ''
        });
      });
    });
  }

  getJobDescriptionsButton.addEventListener('click', () => {
    if (allRecords.length === 0) {
      showToast('No records to get descriptions for', 'error');
      return;
    }

    const recordsWithoutDesc = allRecords.filter(r => !r.description || r.description.trim() === '');
    if (recordsWithoutDesc.length === 0) {
      showToast('All records already have descriptions', 'info');
      return;
    }

    if (confirm(`This will fetch descriptions for ${recordsWithoutDesc.length} jobs. Continue?`)) {
      isGettingDescriptions = true;
      getJobDescriptionsButton.disabled = true;
      getJobDescriptionsButton.textContent = 'Processing...';

      // Show progress
      const progressSection = document.getElementById('progressSection');
      const progressBar = document.getElementById('progressBar');
      const progressText = document.getElementById('progressText');
      progressSection.classList.remove('hidden');
      const withDesc = allRecords.filter(r => r.description && r.description.trim() !== '').length;
      const percent = Math.round((withDesc / allRecords.length) * 100);
      progressBar.style.width = `${percent}%`;
      progressText.textContent = `${withDesc} / ${allRecords.length}`;

      processNextJob();
    }
  });

  const webhookUrlInput = document.getElementById('webhookUrlInput');
  const defaultWebhookBaseUrl = 'http://localhost/zoho-api-main/webhookusvta/api/webhook.php';

  chrome.storage.local.get({ webhookUrl: defaultWebhookBaseUrl }, (result) => {
    webhookUrlInput.value = result.webhookUrl;
  });

  webhookUrlInput.addEventListener('input', () => {
    chrome.storage.local.set({ webhookUrl: webhookUrlInput.value });
  });

  const sendToWebhookButton = document.getElementById('sendToWebhook');
  sendToWebhookButton.addEventListener('click', async () => {
    if (allRecords.length === 0) {
      showToast('No records to send to webhook', 'error');
      return;
    }

    const webhookUrl = webhookUrlInput.value.trim();
    if (!webhookUrl) {
      showToast('Please enter a webhook URL', 'error');
      return;
    }

    try {
      new URL(webhookUrl);
    } catch (e) {
      showToast('Please enter a valid URL for the Webhook.', 'error');
      return;
    }

    // Determine which records to send:
    // 1. If rows are selected → send only those selected rows
    // 2. Else if a filter is active → send only the filtered (visible) rows
    // 3. Else → send all records
    let recordsToSend;
    if (selectedIndices.size > 0) {
      recordsToSend = Array.from(selectedIndices).sort((a, b) => a - b).map(i => allRecords[i]).filter(Boolean);
    } else if (filteredRecords.length !== allRecords.length) {
      recordsToSend = filteredRecords;
    } else {
      recordsToSend = allRecords;
    }

    const BATCH_SIZE = 50;
    const totalBatches = Math.ceil(recordsToSend.length / BATCH_SIZE);

    const filterDesc = selectedIndices.size > 0
      ? `${recordsToSend.length} selected record(s)`
      : filteredRecords.length !== allRecords.length
        ? `${recordsToSend.length} filtered record(s) (AOP/State/Position filter active)`
        : `all ${recordsToSend.length} record(s)`;

    if (!confirm(`Send ${filterDesc} in ${totalBatches} batch(es) to webhook?`)) {
      return;
    }

    sendToWebhookButton.disabled = true;
    sendToWebhookButton.textContent = 'Sending...';

    // Show progress
    const progressSection = document.getElementById('progressSection');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    progressSection.classList.remove('hidden');
    progressBar.style.width = '0%';
    progressText.textContent = `0 / ${totalBatches} batches`;

    // Map records to webhook format — mirrors UVC field structure exactly
    const mappedRecords = recordsToSend.map(record => {
      const city = record.city || '';
      const state = record.state || '';
      const location = city && state ? `${city}, ${state}` : (city || state || '');
      return {
        job_title:        record.title || '',
        job_id:           record.jobId || '',
        department_id:    record.jobId || '',
        hospital:         record.hospitalName || '',
        aggregator:       'MedVet (Parent Client)',
        street_address:   record.streetAddress || '',
        parent_client:    'MedVet',
        city:             city,
        state:            state,
        zip_code:         record.zipCode || '',
        county:           record.county || '',
        phone:            record.phone || '',
        website:          record.website || '',
        location:         location,
        area_of_practice: record.areaOfPractice || '',
        position:         record.position || '',
        salary:           record.salary || '',
        job_type:         record.jobType || '',
        url:              record.link || '',
        link:             record.link || '',
        description:      record.description || ''
      };
    });

    // Split into batches
    const batches = [];
    for (let i = 0; i < mappedRecords.length; i += BATCH_SIZE) {
      batches.push(mappedRecords.slice(i, i + BATCH_SIZE));
    }

    // Generate a unique sync ID
    const syncId = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);

    let successCount = 0;
    let errorCount = 0;

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      const batchNumber = batchIndex + 1;

      const percent = Math.round((batchNumber / totalBatches) * 100);
      progressBar.style.width = `${percent}%`;
      progressText.textContent = `Batch ${batchNumber} / ${totalBatches}`;

      const payload = {
        source: 'MedVet Job Scraper',
        parentClientName: 'MedVet',
        syncId: syncId,
        timestamp: new Date().toISOString(),
        batchNumber: batchNumber,
        totalBatches: totalBatches,
        batchSize: batch.length,
        totalRecords: recordsToSend.length,
        data: batch
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
          console.error(`Failed to send batch ${batchNumber}:`, await response.text());
        }
      } catch (err) {
        errorCount++;
        console.error(`Error sending batch ${batchNumber}:`, err);
      }

      // Small delay between batches
      if (batchIndex < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    progressSection.classList.add('hidden');
    sendToWebhookButton.disabled = false;
    sendToWebhookButton.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" fill="currentColor"/>
      </svg>
      Send to Webhook`;

    if (errorCount === 0) {
      showToast(`Success! ${recordsToSend.length} records sent in ${totalBatches} batch(es).`, 'success');
    } else {
      showToast(`Partial: ${successCount} succeeded, ${errorCount} failed.`, 'error');
    }

    let resultMsg = `Webhook Complete!\nSync ID: ${syncId}\nTotal Records Sent: ${recordsToSend.length}\nBatches Sent: ${totalBatches} (${BATCH_SIZE} per batch)\nSuccessful: ${successCount} | Failed: ${errorCount}`;
    alert(resultMsg);
  });

  loadRecords();
});
