'use strict';

// Records page controller. External text is displayed as text, never as markup.
// Description scraping is owned by description-queue.js in the background worker.
document.addEventListener('DOMContentLoaded', () => {
    const PARENT_CLIENT_NAME = 'Thrive Pet Healthcare (Parent Client)';
    const byId = id => document.getElementById(id);
    const table = byId('jobRecordsTable');
    const tableBody = table.querySelector('tbody');
    const buttons = [
        'getDescriptionsBtn', 'fetchDetailsBtn', 'fetchAddressesBtn', 'exportCsv',
        'sendToWebhook', 'deleteSelectedJobs', 'clearDetailsBtn',
        'clearDescriptions', 'clearAddresses', 'clearRecords'
    ];
    const buttonTemplates = new Map(buttons.map(id => [
        id, Array.from(byId(id).childNodes, node => node.cloneNode(true))
    ]));
    const state = {
        jobs: [], visible: [], selected: new Set(), sort: '', direction: 1,
        run: null, addressRun: null, busy: false, initialized: false, jobsVersion: 0, runVersion: 0, addressVersion: 0
    };
    const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
    const text = value => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
    const textFields = [
        'title', 'jobId', 'hospital', 'hospitalName', 'company', 'streetAddress',
        'city', 'state', 'zipCode', 'phone', 'website', 'location', 'areaOfPractice',
        'position', 'salary', 'jobType', 'experience', 'link', 'description',
        'category', 'requisitionId', 'lastUpdated', 'primaryHospital'
    ];

    function normalizeJobs(jobs) {
        return (Array.isArray(jobs) ? jobs : [])
            .filter(job => job && typeof job === 'object' && !Array.isArray(job))
            .filter(ThriveJobFilter.isDvmJob)
            .map(job => {
                const normalized = { ...job };
                for (const field of textFields) normalized[field] = text(job[field]);
                // Remove annotations saved by earlier versions, including when
                // exporting existing records before running Fetch Details again.
                delete normalized.detailNotes;
                for (const field of ['salary', 'hospital', 'hospitalName', 'company']) {
                    normalized[field] = normalized[field].replace(/ \((?:full-time rate|verify source|verify names?)\)/g, '');
                }
                normalized.jobType = ThriveDetailRules.extractJobType(normalized.description);
                // Keep eligibility evidence when Clear Details clears editable metadata.
                normalized.listingCategory = text(job.listingCategory || job.category);
                return normalized;
            });
    }

    function httpUrl(value) {
        try {
            const url = new URL(text(value).trim());
            if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return '';
            return url.href;
        } catch {
            return '';
        }
    }

    function showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = type === 'error' ? 'toast error' : 'toast success';
        toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
        toast.textContent = text(message);
        byId('toastContainer').replaceChildren(toast);
        setTimeout(() => toast.remove(), 6000);
    }

    function labelButton(id, label) {
        if (label) byId(id).textContent = label;
        else byId(id).replaceChildren(...buttonTemplates.get(id).map(node => node.cloneNode(true)));
    }

    function isLocked() {
        return !state.initialized || state.busy || state.run?.status === 'running' || state.addressRun?.status === 'running';
    }

    function jobKey(job) {
        return JSON.stringify([job.link, job.jobId, job.title, job.hospital, job.location]);
    }

    function hasDescription(job) {
        const description = text(job.description).trim();
        return !!description && !job.descriptionFetchFailed &&
            !/^Description fetch failed\.?$/i.test(description) &&
            !(/^Specifics\s*\n/i.test(description) && /\nDescription\s*$/i.test(description));
    }

    function updateControls() {
        for (const id of buttons) byId(id).disabled = isLocked();
        byId('webhookUrl').disabled = isLocked();
        byId('selectAllJobs').disabled = isLocked();
        byId('deleteSelectedJobs').disabled = isLocked() || state.selected.size === 0;
        labelButton('deleteSelectedJobs', 'Delete Jobs (' + state.selected.size + ')');
        const selectedVisible = state.visible.filter(job => state.selected.has(jobKey(job))).length;
        byId('selectAllJobs').checked = state.visible.length > 0 && selectedVisible === state.visible.length;
        byId('selectAllJobs').indeterminate = selectedVisible > 0 && selectedVisible < state.visible.length;
        for (const checkbox of tableBody.querySelectorAll('.job-select-checkbox')) checkbox.disabled = isLocked();
    }

    function showProgress(label, completed, total) {
        byId('progressSection').classList.remove('hidden');
        byId('progressLabel').textContent = label;
        byId('progressText').textContent = completed + ' / ' + total;
        byId('progressBar').style.width = (total ? Math.min(100, completed / total * 100) : 0) + '%';
    }

    function applyRun(run) {
        const previous = state.run;
        state.run = run || null;
        if (run?.status === 'running') {
            const retry = run.attempt ? ' (retrying current job)' : '';
            showProgress('Getting descriptions' + retry, run.next, run.total);
            labelButton('getDescriptionsBtn', 'Getting Descriptions (' + run.next + '/' + run.total + ')');
        } else {
            labelButton('getDescriptionsBtn');
            if (run) {
                const label = run.status === 'error' ? run.error :
                    'Descriptions: ' + run.fetched + ' saved, ' + run.failed + ' failed, ' + run.skipped + ' already complete or removed';
                if (!state.busy) showProgress(label, run.next, run.total);
                if (previous?.id === run.id && previous.status === 'running') {
                    showToast(label, run.status === 'completed' ? 'success' : 'error');
                }
            }
        }
        updateControls();
    }

    function appendLink(cell, value, label) {
        const url = httpUrl(value);
        if (!url) {
            cell.textContent = value ? 'Invalid link' : '-';
            return;
        }
        const link = document.createElement('a');
        link.href = url;
        link.textContent = label;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        cell.appendChild(link);
    }

    function showDescription(description) {
        byId('modalDescriptionContent').textContent = description;
        byId('descriptionModal').classList.add('show');
        byId('closeDescriptionModal').focus();
    }

    function hideDescription() {
        byId('descriptionModal').classList.remove('show');
        byId('modalDescriptionContent').replaceChildren();
    }

    function renderRecords() {
        const term = byId('searchInput').value.trim().toLowerCase();
        const searchFields = textFields.filter(field => field !== 'description');
        state.visible = state.jobs.filter(job => !term || searchFields.some(field => job[field].toLowerCase().includes(term)));
        if (state.sort) state.visible.sort((a, b) =>
            text(a[state.sort]).localeCompare(text(b[state.sort]), undefined, { numeric: true, sensitivity: 'base' }) * state.direction);
        const keys = new Set(state.jobs.map(jobKey));
        state.selected = new Set([...state.selected].filter(key => keys.has(key)));
        const fragment = document.createDocumentFragment();
        state.visible.forEach((job, index) => {
            const row = document.createElement('tr');
            const key = jobKey(job);
            row.classList.toggle('selected-row', state.selected.has(key));
            row.classList.toggle('row-name-updated', !!job.hospitalNameUpdated);
            row.classList.toggle('row-city-mismatch', !!job.cityMismatchFlag);
            if (job.isNewLocation) row.style.backgroundColor = '#eaf3fb';
            const cell = value => {
                const element = document.createElement('td');
                element.textContent = text(value);
                row.appendChild(element);
                return element;
            };
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'job-select-checkbox';
            checkbox.setAttribute('aria-label', 'Select job ' + (index + 1));
            checkbox.checked = state.selected.has(key);
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) state.selected.add(key);
                else state.selected.delete(key);
                row.classList.toggle('selected-row', checkbox.checked);
                updateControls();
            });
            cell('').appendChild(checkbox);
            cell(index + 1);
            cell(job.title);
            cell(job.jobId || 'N/A');
            cell(job.hospital);
            cell(PARENT_CLIENT_NAME);
            cell(formatStreetAddress(job.streetAddress) || '-');
            cell(formatCityName(job.city));
            cell(formatStateName(job.state));
            cell(job.zipCode || '-');
            cell(job.phone || '-');
            appendLink(cell(''), job.website, 'Visit');
            for (const field of ['location', 'areaOfPractice', 'position', 'salary', 'jobType', 'experience']) cell(job[field] || '-');
            appendLink(cell(''), job.link, 'View Job');
            const descriptionCell = cell('');
            if (hasDescription(job)) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'view-description-btn';
                button.textContent = 'View Description';
                button.addEventListener('click', () => showDescription(job.description));
                descriptionCell.appendChild(button);
            } else {
                descriptionCell.textContent = job.descriptionFetchFailed ? 'Failed — click Get Descriptions to retry' : 'Not scraped';
                descriptionCell.title = text(job.descriptionFetchError);
            }
            fragment.appendChild(row);
        });
        tableBody.replaceChildren(fragment);
        byId('totalCount').textContent = state.visible.length;
        table.classList.toggle('hidden', state.visible.length === 0);
        byId('emptyState').classList.toggle('hidden', state.visible.length > 0);
        updateControls();
    }

    async function readEditableJobs() {
        const stored = await chrome.storage.local.get(['scrapedJobs', 'descriptionRun', 'addressRun']);
        if (stored.descriptionRun?.status === 'running') throw new Error('Wait for description scraping to finish.');
        if (stored.addressRun?.status === 'running') throw new Error('Wait for address lookup to finish.');
        return normalizeJobs(stored.scrapedJobs);
    }

    async function saveJobs(jobs) {
        jobs = normalizeJobs(jobs);
        await chrome.storage.local.set({ scrapedJobs: jobs });
        state.jobs = normalizeJobs(jobs);
        renderRecords();
    }

    async function localTask(work) {
        if (isLocked()) return;
        state.busy = true;
        updateControls();
        try {
            await work();
        } catch (error) {
            showToast(error.message || 'The operation could not be completed.', 'error');
        } finally {
            state.busy = false;
            byId('progressSection').classList.add('hidden');
            for (const id of ['fetchDetailsBtn', 'fetchAddressesBtn', 'sendToWebhook']) labelButton(id);
            applyRun(state.run);
            applyAddressRun(state.addressRun);
        }
    }

    async function startDescriptions() {
        if (isLocked()) return;
        state.busy = true;
        updateControls();
        try {
            const sourceTab = await chrome.tabs.getCurrent();
            if (!sourceTab?.id) throw new Error('Open Records in a browser tab and try again.');
            const response = await chrome.runtime.sendMessage({ action: 'startDescriptionRun', sourceTabId: sourceTab.id });
            if (!response?.success) throw new Error(response?.error || 'Could not start description scraping.');
            // Read persisted state: the worker may already have progressed beyond its response.
            const version = state.runVersion;
            const stored = await chrome.storage.local.get('descriptionRun');
            if (version === state.runVersion) applyRun(stored.descriptionRun);
            if (stored.descriptionRun?.total === 0) showToast('All jobs already have descriptions.');
        } catch (error) {
            showToast(error.message, 'error');
        } finally {
            state.busy = false;
            updateControls();
        }
    }

    function csvCell(value) {
        let result = text(value);
        // Spreadsheet applications can interpret untrusted text as a formula.
        if (/^[\s\u0000-\u001f]*[=+@-]/.test(result)) result = "'" + result;
        return '"' + result.replace(/"/g, '""') + '"';
    }

    function exportCsv() {
        if (!state.jobs.length) return showToast('No jobs to export.', 'error');
        const headers = ['#', 'Job Title', 'Job ID', 'Hospital', 'Aggregator', 'Street Address', 'City', 'State', 'Zip Code', 'Phone', 'Website', 'Location', 'Area of Practice', 'Position', 'Salary', 'Job Type', 'Experience', 'Link', 'Description'];
        const rows = state.jobs.map((job, index) => [
            index + 1, job.title, job.jobId, job.hospital, PARENT_CLIENT_NAME,
            formatStreetAddress(job.streetAddress), formatCityName(job.city), formatStateName(job.state),
            job.zipCode, job.phone, job.website, job.location, job.areaOfPractice, job.position,
            job.salary, job.jobType, job.experience, job.link, job.description
        ]);
        const csv = [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'thrive_jobs_' + new Date().toISOString().slice(0, 10) + '.csv';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast('Exported ' + state.jobs.length + ' jobs.');
    }

    function webhookJob(job) {
        return {
            job_title: job.title, job_id: job.jobId, department_id: job.jobId,
            hospital: job.hospital, aggregator: PARENT_CLIENT_NAME, parent_client: PARENT_CLIENT_NAME,
            street_address: formatStreetAddress(job.streetAddress), city: formatCityName(job.city),
            state: formatStateName(job.state), zip_code: job.zipCode, phone: job.phone,
            website: httpUrl(job.website), location: job.location, area_of_practice: job.areaOfPractice,
            position: job.position, salary: job.salary, job_type: job.jobType,
            experience: job.experience, url: httpUrl(job.link), link: httpUrl(job.link), description: job.description
        };
    }

    async function sendWebhook() {
        const url = httpUrl(byId('webhookUrl').value);
        if (!url) throw new Error('Enter a valid HTTP or HTTPS webhook URL without embedded credentials.');
        const jobs = (await readEditableJobs()).map(webhookJob);
        if (!jobs.length) throw new Error('No jobs to send.');
        if (!confirm('Send ' + jobs.length + ' jobs to ' + url + '?')) return;
        await chrome.storage.local.set({ webhookUrl: url });
        const totalBatches = Math.ceil(jobs.length / 50);
        const syncId = crypto.randomUUID();
        labelButton('sendToWebhook', 'Sending...');
        let failed = 0;
        let lastError = '';
        for (let index = 0; index < totalBatches; index++) {
            const data = jobs.slice(index * 50, (index + 1) * 50);
            showProgress('Sending batches', index, totalBatches);
            try {
                const response = await chrome.runtime.sendMessage({
                    action: 'sendWebhook', url, payload: {
                        source: 'Thrive Job Scraper', parentClientName: PARENT_CLIENT_NAME, syncId,
                        timestamp: new Date().toISOString(), batchNumber: index + 1, totalBatches,
                        batchSize: data.length, totalRecords: jobs.length, data
                    }
                });
                if (!response?.success) throw new Error(response?.error || 'No response from the webhook.');
            } catch (error) {
                failed++;
                lastError = text(error.message);
            }
        }
        showToast(failed ? failed + ' of ' + totalBatches + ' batches failed: ' + lastError :
            'All ' + totalBatches + ' batches sent.', failed ? 'error' : 'success');
    }

    function deriveDetails(job, existingJobs = []) {
        if (!hasDescription(job)) return [job];
        const extracted = extractDetailsFromDescription(job.title, job.description);
        const specifics = getJobviteSpecificsForJob(job);
        const category = specifics.category || job.category;
        const nonClinical = shouldLeaveClinicalFieldsBlank(job.title, category);
        const areaOfPractice = nonClinical ? '' : (
            hasSpecialtyRequirementSignal(job.description) ? 'Specialty Care' :
                (getAOPFromTitle(job.title) || getAOPFromCategory(category) || extracted.areaOfPractice)
        );
        let position = nonClinical ? '' : getValidatedPosition(getPositionFromTitle(job.title) || extracted.position, areaOfPractice);
        if (!nonClinical && !position) position = getDefaultPositionForAOP(areaOfPractice, job.title);
        if (!nonClinical && /medical director/i.test(job.title)) position = 'Medical Director';
        const primaryHospital = !ThriveDetailRules.isGenericHospital(specifics.company) ? specifics.company :
            (extracted.hospitalName || specifics.company || job.hospital || '');
        const hospitalInfo = ThriveDetailRules.hospitalDetails(job.description, primaryHospital || '');
        const hospital = hospitalInfo.hospital;
        const requisitionId = specifics.requisitionId || job.requisitionId;
        const jobId = formatJobviteJobId(requisitionId) || job.jobId;
        // User-confirmed correction for this job's "$150/year" source typo.
        // Limit it to the erroneous amount so later source updates still apply.
        const salary = jobId === 'THR-35380' && extracted.salary === '$150+ per year' ?
            '$150,000+ per year' : extracted.salary;
        const base = {
            ...job, category, listingCategory: job.listingCategory || category || '',
            areaOfPractice, position, hospital, hospitalName: hospital, company: hospital, primaryHospital,
            requisitionId, jobId,
            lastUpdated: specifics.lastUpdated || job.lastUpdated,
            salary, jobType: extracted.jobType,
            experience: extracted.experience, detailsFetched: true
        };
        const locations = specifics.city || specifics.state ? [{
            city: specifics.city, state: specifics.state, location: formatSpecificsLocation(specifics.city, specifics.state)
        }] : extracted.locations.length ? extracted.locations : [{}];
        delete base.isNewLocation;
        delete base.sourceLink;
        delete base.detailNotes;
        const resolved = locations.map(location => {
            const city = formatCityName(location.city || extracted.addressCity || job.city);
            const state = formatStateName(location.state || extracted.addressState || job.state);
            const samePlace = (otherCity, otherState) =>
                formatCityName(otherCity).toLowerCase() === city.toLowerCase() && formatStateName(otherState).toLowerCase() === state.toLowerCase();
            const related = existingJobs.filter(other => (other.sourceLink || other.link) === job.link);
            const previous = related.find(other => samePlace(other.city, other.state)) ||
                (job.jobLocations || []).find(other => samePlace(other.city, other.state)) ||
                (samePlace(job.city, job.state) || locations.length === 1 ? job : {});
            const addressFits = !!extracted.streetAddress && samePlace(extracted.addressCity, extracted.addressState);
            return {
                ...base, city, state,
                location: location.location || extracted.addressLocation || job.location,
                streetAddress: addressFits ? extracted.streetAddress : (ThriveDetailRules.isStreetAddress(previous.streetAddress) ? previous.streetAddress : ''),
                zipCode: addressFits ? (extracted.zipCode || previous.zipCode || '') : (previous.zipCode || ''),
                phone: previous.phone || '', website: previous.website || ''
            };
        });
        const result = resolved[0];
        if (resolved.length > 1) {
            result.location = [...new Set(resolved.map(item => item.location).filter(Boolean))].join(' / ');
            // Keep secondary location data on the job, never as additional rows.
            result.jobLocations = resolved.map(item => Object.fromEntries(
                ['city', 'state', 'streetAddress', 'zipCode', 'phone', 'website'].map(field => [field, item[field]])));
        }
        return [result];
    }

    function combineLocationRecords(saved) {
        const groups = new Map();
        saved.forEach((job, index) => {
            const key = job.sourceLink || job.link || 'unlinked:' + index;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(job);
        });
        return [...groups.values()].map(group => {
            const original = group.find(job => !job.sourceLink) || group[0];
            const source = hasDescription(original) ? original : group.find(hasDescription);
            const job = { ...original };
            if (source && source !== original) {
                job.description = source.description;
                job.descriptionFetchFailed = false;
                job.jobviteSpecifics = source.jobviteSpecifics || original.jobviteSpecifics;
            }
            if (job.sourceLink) {
                job.link = job.sourceLink;
                // Only old generated copies carry sourceLink and an added suffix.
                job.jobId = text(job.jobId).replace(/^(THR-[^-]+)-\d+$/, '$1');
            }
            if (group.length > 1) {
                const locations = group.flatMap(item => [item, ...(item.jobLocations || [])]);
                const unique = new Map();
                for (const location of locations) {
                    if (!location.city && !location.state) continue;
                    const key = formatCityName(location.city) + '|' + formatStateName(location.state);
                    const previous = unique.get(key) || {};
                    unique.set(key, Object.fromEntries(
                        ['city', 'state', 'streetAddress', 'zipCode', 'phone', 'website'].map(field => [field, previous[field] || location[field] || ''])));
                }
                if (unique.size > 1) job.jobLocations = [...unique.values()];
            }
            delete job.sourceLink;
            delete job.isNewLocation;
            return job;
        });
    }

    async function fetchDetails() {
        const saved = await readEditableJobs();
        const jobs = combineLocationRecords(saved);
        const result = [];
        let analyzed = 0;
        labelButton('fetchDetailsBtn', 'Analyzing...');
        for (let index = 0; index < jobs.length; index++) {
            const job = jobs[index];
            if (hasDescription(job)) {
                result.push(...deriveDetails(job, saved));
                analyzed++;
            } else result.push(job);
            if (index % 10 === 0) {
                showProgress('Analyzing saved descriptions', index, jobs.length);
                await wait(0);
            }
        }
        await saveJobs(result);
        showToast(analyzed ? 'Extracted details for ' + analyzed + ' jobs.' : 'Get Descriptions first; no saved descriptions are available.');
    }

    async function fetchAddresses() {
        const sourceTab = await chrome.tabs.getCurrent();
        if (!sourceTab?.id) throw new Error('Open Records in a browser tab.');
        const response = await chrome.runtime.sendMessage({ action: 'startAddressRun', sourceTabId: sourceTab.id });
        if (!response?.success) throw new Error(response?.error || 'Could not start address lookup.');
        const stored = await chrome.storage.local.get('addressRun');
        applyAddressRun(stored.addressRun);
    }

    function applyAddressRun(run) {
        const previous = state.addressRun;
        state.addressRun = run || null;
        if (run?.status === 'running') {
            showProgress('Looking up addresses', run.next, run.total);
            labelButton('fetchAddressesBtn', 'Fetching Addresses (' + run.next + '/' + run.total + ')');
        } else {
            labelButton('fetchAddressesBtn');
            if (run && !state.run?.status?.includes('running')) {
                const label = run.status === 'stopped' ? 'Address lookup stopped. ' + run.saved + ' completed jobs saved.' :
                    'Addresses: ' + run.saved + ' complete, ' + run.failed + ' not found or incomplete, ' + run.skipped + ' removed';
                if (!state.busy) showProgress(label, run.next, run.total);
                if (previous?.id === run.id && previous.status === 'running') showToast(label, run.failed ? 'error' : 'success');
            }
        }
        updateControls();
    }

    async function clearFields(kind) {
        if (!confirm('Clear ' + kind + ' from all saved jobs?')) return;
        const savedJobs = await readEditableJobs();
        // Keep the original record when clearing multi-location detail expansion.
        const jobs = kind === 'details' ? savedJobs.filter(job => !job.sourceLink) : savedJobs;
        const fields = kind === 'descriptions' ?
            ['description', 'descriptionBody', 'descriptionHtml', 'jobviteDetails', 'descriptionFetched', 'descriptionFetchFailed', 'descriptionFetchError'] :
            kind === 'addresses' ? ['streetAddress', 'city', 'state', 'zipCode', 'phone', 'website', 'cityMismatchFlag'] :
                ['jobId', 'hospital', 'hospitalName', 'company', 'primaryHospital', 'detailNotes', 'category', 'requisitionId', 'lastUpdated',
                    'city', 'state', 'location', 'areaOfPractice', 'position', 'salary', 'jobType', 'experience',
                    'detailsFetched', 'isNewLocation', 'sourceLink'];
        for (const job of jobs) {
            for (const field of fields) delete job[field];
            if (kind === 'descriptions') job.description = '';
        }
        await saveJobs(jobs);
        showToast('Cleared ' + kind + '.');
    }

    byId('getDescriptionsBtn').addEventListener('click', startDescriptions);
    byId('fetchDetailsBtn').addEventListener('click', () => localTask(fetchDetails));
    byId('fetchAddressesBtn').addEventListener('click', () => localTask(fetchAddresses));
    byId('sendToWebhook').addEventListener('click', () => localTask(sendWebhook));
    byId('exportCsv').addEventListener('click', exportCsv);
    byId('clearDescriptions').addEventListener('click', () => localTask(() => clearFields('descriptions')));
    byId('clearAddresses').addEventListener('click', () => localTask(() => clearFields('addresses')));
    byId('clearDetailsBtn').addEventListener('click', () => localTask(() => clearFields('details')));
    byId('clearRecords').addEventListener('click', () => localTask(async () => {
        if (!confirm('Clear all saved job records?')) return;
        await readEditableJobs();
        state.selected.clear();
        await saveJobs([]);
        showToast('All records cleared.');
    }));
    byId('deleteSelectedJobs').addEventListener('click', () => localTask(async () => {
        const jobs = await readEditableJobs();
        const remaining = jobs.filter(job => !state.selected.has(jobKey(job)));
        const deleted = jobs.length - remaining.length;
        state.selected.clear();
        await saveJobs(remaining);
        showToast('Deleted ' + deleted + ' jobs.');
    }));
    byId('selectAllJobs').addEventListener('change', event => {
        for (const job of state.visible) {
            if (event.target.checked) state.selected.add(jobKey(job));
            else state.selected.delete(jobKey(job));
        }
        renderRecords();
    });
    byId('searchInput').addEventListener('input', renderRecords);
    for (const header of table.querySelectorAll('th[data-sort]')) {
        header.addEventListener('click', () => {
            state.direction = state.sort === header.dataset.sort ? -state.direction : 1;
            state.sort = header.dataset.sort;
            for (const other of table.querySelectorAll('th')) other.classList.remove('sort-asc', 'sort-desc');
            header.classList.add(state.direction === 1 ? 'sort-asc' : 'sort-desc');
            renderRecords();
        });
    }
    byId('closeDescriptionModal').addEventListener('click', hideDescription);
    byId('descriptionModal').addEventListener('click', event => {
        if (event.target === byId('descriptionModal')) hideDescription();
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') hideDescription(); });
    byId('webhookUrl').addEventListener('change', () => {
        const value = byId('webhookUrl').value.trim();
        const url = httpUrl(value);
        if (value && !url) return showToast('Use an HTTP or HTTPS webhook URL without embedded credentials.', 'error');
        chrome.storage.local.set({ webhookUrl: url }).catch(error => showToast(error.message, 'error'));
    });

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.scrapedJobs) {
            state.jobsVersion++;
            state.jobs = normalizeJobs(changes.scrapedJobs.newValue);
            renderRecords();
        }
        if (changes.descriptionRun) {
            state.runVersion++;
            applyRun(changes.descriptionRun.newValue);
        }
        if (changes.addressRun) {
            state.addressVersion++;
            applyAddressRun(changes.addressRun.newValue);
        }
    });

    async function initialize() {
        updateControls();
        if (performance.getEntriesByType('navigation')[0]?.type === 'reload') {
            const stopped = await chrome.runtime.sendMessage({ action: 'stopAddressRun' });
            if (!stopped?.success) throw new Error(stopped?.error || 'Could not stop address lookup.');
        }
        // Ensure legacy storage is migrated before reading or modifying records.
        const response = await chrome.runtime.sendMessage({ action: 'getDescriptionRun' });
        if (!response?.success) throw new Error(response?.error || 'The background worker did not respond. Reload the extension.');
        const jobsVersion = state.jobsVersion;
        const runVersion = state.runVersion;
        const addressVersion = state.addressVersion;
        const stored = await chrome.storage.local.get(['scrapedJobs', 'descriptionRun', 'addressRun', 'webhookUrl']);
        if (jobsVersion === state.jobsVersion) state.jobs = normalizeJobs(stored.scrapedJobs);
        if (runVersion === state.runVersion) state.run = stored.descriptionRun || null;
        if (addressVersion === state.addressVersion) state.addressRun = stored.addressRun || null;
        byId('webhookUrl').value = httpUrl(stored.webhookUrl);
        state.initialized = true;
        renderRecords();
        applyRun(state.run);
        applyAddressRun(state.addressRun);
    }
    void initialize().catch(error => showToast(error.message, 'error'));

    // Local job parsing: string operations only; no browser or network access.
    const stateAbbreviations = {
        'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas', 'CA': 'California',
        'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware', 'FL': 'Florida', 'GA': 'Georgia',
        'HI': 'Hawaii', 'ID': 'Idaho', 'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa',
        'KS': 'Kansas', 'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
        'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi', 'MO': 'Missouri',
        'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada', 'NH': 'New Hampshire', 'NJ': 'New Jersey',
        'NM': 'New Mexico', 'NY': 'New York', 'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio',
        'OK': 'Oklahoma', 'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
        'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah', 'VT': 'Vermont',
        'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia', 'WI': 'Wisconsin', 'WY': 'Wyoming',
        'DC': 'District of Columbia', 'PR': 'Puerto Rico'
    };

    // Convert state abbreviation to full name if needed
    function getFullStateName(state) {
        if (!state) return '';
        const cleaned = String(state).trim();
        const upper = cleaned.toUpperCase();
        if (stateAbbreviations[upper]) return stateAbbreviations[upper];
        const fullMatch = Object.values(stateAbbreviations).find(full => full.toLowerCase() === cleaned.toLowerCase());
        return fullMatch || cleaned;
    }

    function getStateAbbrev(state) {
        if (!state) return '';
        const cleaned = String(state).trim();
        const upper = cleaned.toUpperCase();
        if (stateAbbreviations[upper]) return upper;
        const match = Object.entries(stateAbbreviations).find(([, fullName]) => fullName.toLowerCase() === cleaned.toLowerCase());
        return match ? match[0] : '';
    }

    function toAddressCase(value) {
        const text = String(value || '').replace(/\s+/g, ' ').trim();
        if (!text) return '';
        if (/^(?:TBD|Not Found \(TBD\))$/i.test(text)) return text.replace(/^tbd$/i, 'TBD').replace(/^not found \(tbd\)$/i, 'Not Found (TBD)');

        const keepUpper = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW', 'US', 'PO']);
        return text.replace(/[A-Za-z][A-Za-z']*/g, (word, offset, fullText) => {
            const upper = word.toUpperCase();
            if (keepUpper.has(upper)) return upper;
            if (word.length === 1 && /\d\s*$/i.test(fullText.slice(0, offset))) return upper;
            if (word.length === 2 && /^Mc$/i.test(word)) return 'Mc';
            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        });
    }

    function formatStreetAddress(value) {
        return toAddressCase(value)
            .replace(/\bP\.?\s*O\.?\s*Box\b/gi, 'PO Box')
            .replace(/\bUs\b/g, 'US');
    }

    function formatCityName(value) {
        return toAddressCase(value);
    }

    function formatStateName(value) {
        return toAddressCase(getFullStateName(value || ''));
    }

    function getDescriptionLines(text) {
        return String(text || '')
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean);
    }

    function getJobDescriptionBody(text) {
        const lines = getDescriptionLines(text);
        const start = lines.findIndex(line => /^job description$/i.test(line));
        const end = lines.findIndex((line, index) => index > start && /^qualifications$/i.test(line));

        if (start >= 0 && end > start) {
            return lines.slice(start + 1, end).join('\n');
        }
        if (start >= 0) {
            return lines.slice(start + 1).join('\n');
        }
        return lines.join('\n');
    }

    const APPROVED_POSITIONS = [
        'Associate Veterinarian',
        'Medical Director',
        'Anesthesiologist',
        'Avian & Exotic Specialist',
        'Cardiologist',
        'Credentialed Veterinary Technician Specialist',
        'DABVP Specialist',
        'Dental Specialist',
        'Dermatologist',
        'ECC Specialist',
        'Internal Medicine Specialist',
        'Lead Veterinarian',
        'Medical Oncologist',
        'Neurologist & Neurosurgeon',
        'Ophthalmologist',
        'Radiation Oncologist',
        'Radiologist',
        'Surgeon',
        'Partner Veterinarian'
    ];
    const APPROVED_POSITION_SET = new Set(APPROVED_POSITIONS);
    const VALID_POSITIONS_BY_AOP = {
        'Emergency Care': ['Associate Veterinarian', 'Lead Veterinarian', 'Medical Director'],
        'Exotic Pet Medicine': ['Associate Veterinarian', 'Avian & Exotic Specialist', 'Lead Veterinarian', 'Medical Director'],
        'General Practice Care': ['Associate Veterinarian', 'Lead Veterinarian', 'Medical Director'],
        'Specialty Care': [
            'Anesthesiologist', 'Avian & Exotic Specialist', 'Cardiologist', 'Credentialed Veterinary Technician Specialist',
            'DABVP Specialist', 'Dental Specialist', 'Dermatologist', 'ECC Specialist',
            'Internal Medicine Specialist', 'Medical Director', 'Medical Oncologist',
            'Neurologist & Neurosurgeon', 'Ophthalmologist', 'Radiation Oncologist',
            'Radiologist', 'Surgeon'
        ],
        'Urgent Care': ['Associate Veterinarian', 'Partner Veterinarian', 'Medical Director']
    };

    function hasEccSpecialtyTrainingSignal(text) {
        const source = String(text || '');
        const trainingBeforeRole = /\b(?:board certified|board[-\s]+certified|residency[-\s]+trained|residential[-\s]+trained)\b[\s\S]{0,120}\b(?:ecc|critical care|criticalist|emergency\s*(?:care|medicine)?|er)\b/i;
        const roleBeforeTraining = /\b(?:ecc|critical care|criticalist|emergency\s*(?:care|medicine)?|er)\b[\s\S]{0,120}\b(?:board certified|board[-\s]+certified|residency[-\s]+trained|residential[-\s]+trained)\b/i;
        return trainingBeforeRole.test(source) || roleBeforeTraining.test(source) || /\bdacvecc\b/i.test(source);
    }

    function hasSpecialtyTrainingSignal(text) {
        const source = String(text || '');
        const specialtyTerms = '(?:ecc|critical care|criticalist|emergency\\s*(?:care|medicine)?|er|oncolog|cardiolog|neurolog|dermatolog|radiolog|ophthalmolog|anesth|internal medicine|surgeon|surgery|dent|dacv\\w+|dabvp|davdc)';
        const trainingBeforeSpecialty = new RegExp(`\\b(?:board certified|board[-\\s]+certified|residency[-\\s]+trained|residential[-\\s]+trained|diplomate)\\b[\\s\\S]{0,120}\\b${specialtyTerms}\\b`, 'i');
        const specialtyBeforeTraining = new RegExp(`\\b${specialtyTerms}\\b[\\s\\S]{0,120}\\b(?:board certified|board[-\\s]+certified|residency[-\\s]+trained|residential[-\\s]+trained|diplomate)\\b`, 'i');
        return hasEccSpecialtyTrainingSignal(source) || trainingBeforeSpecialty.test(source) || specialtyBeforeTraining.test(source);
    }

    function extractRequirementSection(text) {
        const source = String(text || '');
        const patterns = [
            /(?:experience\s*&\s*skills\s*requirements?|experience\s+and\s+skills\s+requirements?|your experience\s*&\s*skills|requirements?|qualifications?|what you'?ll need|what we'?re looking for|credentials?|must have|what we need)[:\s]*([\s\S]{0,900}?)(?=(?:benefits?|compensation|salary|about(?:\s+(?:the|our)\s+hospital|\s+thrive)?|our culture|location|equal|join us|why|facility|what we offer|ready to|provide your best care)[:\s])/i,
            /(?:experience\s*&\s*skills\s*requirements?|experience\s+and\s+skills\s+requirements?|your experience\s*&\s*skills|requirements?|qualifications?|what you'?ll need|what we'?re looking for|credentials?|must have|what we need)[:\s]*([\s\S]{0,600})/i
        ];
        for (const pattern of patterns) {
            const match = source.match(pattern);
            if (match) return match[1];
        }
        return '';
    }

    function hasSpecialtyRequirementSignal(text) {
        const requirements = extractRequirementSection(text);
        return !!(
            requirements &&
            (
                hasSpecialtyTrainingSignal(requirements) ||
                /\b(?:board certified|board[-\s]+certified|residency[-\s]+trained|residential[-\s]+trained|diplomate)\b/i.test(requirements)
            )
        );
    }

    function hasExoticRequirementSignal(text) {
        const source = String(text || '');
        if (/\b(?:would\s+not\s+be|required\s+is\s+not|not)\s+required\b/i.test(source) || /\bnot\s+a\s+requirement\b/i.test(source)) {
            return false;
        }
        const exoticNearRequirement = /\b(?:exotic|avian|reptiles?|small mammals?|pocket pets?)\b[\s\S]{0,100}\b(?:required|must|need|looking for|experience|skilled|proficient)\b/i;
        const requirementNearExotic = /\b(?:required|must|need|looking for|experience|skilled|proficient)\b[\s\S]{0,100}\b(?:exotic|avian|reptiles?|small mammals?|pocket pets?)\b/i;
        return exoticNearRequirement.test(source) || requirementNearExotic.test(source);
    }

    function matchApprovedPositionFromText(text) {
        if (!text) return '';

        const rules = [
            ['Medical Director', [/\bmedical director\b/i]],
            ['Lead Veterinarian', [/\blead veterinarian\b/i, /\blead vet\b/i]],
            ['Avian & Exotic Specialist', [/\b(?:avian|exotic)\b[^\n]{0,80}\bspecialist\b/i, /\bspecialist\b[^\n]{0,80}\b(?:avian|exotic)\b/i]],
            ['Neurologist & Neurosurgeon', [/\bneurologist\b/i, /\bneurosurgeon\b/i, /\bboard certified\b.*\bneurolog/i, /\bresidency[-\s]+trained\b.*\bneurolog/i, /\bdacvim\b.*\bneurolog/i]],
            ['Dermatologist', [/\bdermatologist\b/i, /\bboard certified\b.*\bdermatolog/i, /\bresidency[-\s]+trained\b.*\bdermatolog/i, /\bdacvd\b/i]],
            ['Cardiologist', [/\bcardiologist\b/i, /\bboard certified\b.*\bcardiolog/i, /\bresidency[-\s]+trained\b.*\bcardiolog/i, /\bdacvim\b.*\bcardiolog/i]],
            ['Radiation Oncologist', [/\bradiation oncolog/i, /\bdacvr[-\s]?ro\b/i, /\bdacvr\b.*\bradiation\b/i]],
            ['Medical Oncologist', [/\bmedical oncolog/i, /\bboard certified\b.*\boncolog/i, /\bresidency[-\s]+trained\b.*\boncolog/i, /\bdacvim\b.*\boncology\b/i]],
            ['Radiologist', [/\bradiologist\b/i, /\bdiagnostic imaging specialist\b/i, /\bboard certified\b.*\bradiolog/i, /\bresidency[-\s]+trained\b.*\bradiolog/i, /\bdacvr\b/i]],
            ['Ophthalmologist', [/\bophthalmologist\b/i, /\bboard certified\b.*\bophthalmolog/i, /\bresidency[-\s]+trained\b.*\bophthalmolog/i, /\bdacvo\b/i]],
            ['Anesthesiologist', [/\banesthesiologist\b/i, /\bboard certified\b.*\banesth/i, /\bresidency[-\s]+trained\b.*\banesth/i, /\bdacvaa\b/i]],
            ['Internal Medicine Specialist', [/\binternist\b/i, /\binternal medicine specialist\b/i, /\bboard certified\b.*\binternal medicine\b/i, /\bresidency[-\s]+trained\b.*\binternal medicine\b/i, /\bdacvim\b(?!.*oncology)(?!.*cardiology)(?!.*neurology)/i]],
            ['ECC Specialist', [/\bcriticalist\b/i, /\becc specialist\b/i, /\bemergency\s*(?:&|and)?\s*critical care specialist\b/i, /\bboard certified\b.*\bcritical/i, /\bresidency[-\s]+trained\b.*\bcritical/i, /\bdacvecc\b/i]],
            ['DABVP Specialist', [/\bdabvp\b/i]],
            ['Dental Specialist', [/\bdental specialist\b/i, /\bveterinary dentist\b/i, /\boral surgeon\b/i, /\bboard certified\b.*\bdent/i, /\bresidency[-\s]+trained\b.*\bdent/i, /\bdavdc\b/i]],
            ['Surgeon', [/\bveterinary surgeon\b/i, /\bsurgeon\b/i, /\bboard certified\b.*\bsurgeon\b/i, /\bresidency[-\s]+trained\b.*\bsurgeon\b/i, /\bdacvs\b/i, /\bacvs\b/i]],
            ['Credentialed Veterinary Technician Specialist', [/\bcredentialed veterinary technician specialist\b/i, /\btechnician specialist\b/i, /\bvts\b/i]]
        ];

        for (const [position, patterns] of rules) {
            if (patterns.some(pattern => pattern.test(text))) {
                if (position === 'Medical Oncologist' && /\bradiation oncolog/i.test(text)) continue;
                if (position === 'Radiologist' && /\bradiation oncolog/i.test(text)) continue;
                if (position === 'Surgeon' && /\bneuro(?:logy|surgeon)\b/i.test(text)) continue;
                if (position === 'Dental Specialist' && /\bassistant\b/i.test(text)) continue;
                return position;
            }
        }

        return '';
    }

    function getPositionFromDescription(text) {
        const matched = matchApprovedPositionFromText(text || '');
        return APPROVED_POSITION_SET.has(matched) ? matched : '';
    }

    // ============ TOP-LEVEL POSITION MATCHING (used by both detail extraction and save) ============

    // Match position from the job listing title — this is the authoritative source for position.
    // The listing title (e.g. "Veterinary Cardiologist") is always more specific than
    // generic detail page content, so we use it as the primary position signal.
    function getPositionFromTitle(title) {
        const t = (title || '').toLowerCase();

        // === HIGHEST PRIORITY: Leadership positions ===
        // "Group Medical Director - The Oncology Service" → Medical Director, NOT Medical Oncologist
        if (t.includes('medical director')) return 'Medical Director';
        if (/\blead[)\s-]*(?:(?:emergency|er|urgent care)\s+)?(?:veterinarian|vet)\b/.test(t)) return 'Lead Veterinarian';
        if (/\b(?:avian|exotic)\b/.test(t) && /\bspecialist\b/.test(t)) return 'Avian & Exotic Specialist';

        // === SPECIALTY POSITION NAMES ===
        if (t.includes('neurologist') || t.includes('neurosurgeon') || t.includes('neurology')) return 'Neurologist & Neurosurgeon';
        if (t.includes('dermatologist') || t.includes('dermatology')) return 'Dermatologist';
        if (t.includes('cardiologist') || t.includes('cardiology')) return 'Cardiologist';
        if (t.includes('oncologist') && t.includes('radiation')) return 'Radiation Oncologist';
        if (t.includes('oncologist') || t.includes('oncology')) return 'Medical Oncologist';
        if (t.includes('radiologist') || t.includes('diagnostic imaging') || t.includes('radiology')) return 'Radiologist';
        if (t.includes('ophthalmologist') || t.includes('ophthalmology')) return 'Ophthalmologist';
        if (t.includes('anesthesiologist') || t.includes('anesthesia')) return 'Anesthesiologist';
        if (t.includes('internist') || t.includes('internal medicine')) return 'Internal Medicine Specialist';
        if (t.includes('criticalist') || t.match(/\becc\b/) || t.includes('emergency medicine')) return 'ECC Specialist';
        if (t.includes('dabvp')) return 'DABVP Specialist';
        if ((t.includes('dental') || t.includes('dentist') || t.includes('dentistry')) && !t.includes('assistant')) return 'Dental Specialist';
        if ((t.includes('surgeon') || t.includes('surgery')) && !t.includes('neurosurgeon') && !t.includes('neurology') && !t.includes('dental') && !t.includes('dentistry')) return 'Surgeon';

        // === VTS/CREDENTIALED SPECIALIST ===
        if (t.includes('technician specialist') || (t.match(/\bvts\b/) && t.includes('specialist'))) return 'Credentialed Veterinary Technician Specialist';

        // === GENERIC VETERINARIAN ROLES ===
        if (t.includes('partner veterinarian') || t.includes('partner vet') || t.includes('equity owner')) return 'Partner Veterinarian';
        if (/\b(?:associate\s+)?(?:emergency|er|urgent care|urgent)?\s*(?:veterinarian|vet|dvm)\b/.test(t)) return 'Associate Veterinarian';
        if (/\bassociate veterinarian\b|\bassociate vet\b/.test(t)) return 'Associate Veterinarian';

        return '';
    }

    function getAOPParts(aop) {
        return (aop || '').split('/').map(part => part.trim()).filter(Boolean);
    }

    // Validate that a position is allowed for the given AOP
    function getValidatedPosition(position, aop) {
        if (!APPROVED_POSITION_SET.has(position)) return '';

        const aopParts = getAOPParts(aop);
        if (aopParts.length === 0) return position;

        for (const part of aopParts) {
            const allowed = VALID_POSITIONS_BY_AOP[part];
            if (allowed && allowed.includes(position)) return position;
        }

        return '';
    }

    function getDefaultPositionForAOP(aop, title = '') {
        const aopParts = getAOPParts(aop);
        const t = (title || '').toLowerCase();

        if (aopParts.includes('Urgent Care') && (t.includes('partner veterinarian') || t.includes('partner vet'))) {
            return 'Partner Veterinarian';
        }

        if (aopParts.some(part => ['General Practice Care', 'Emergency Care', 'Urgent Care', 'Exotic Pet Medicine'].includes(part))) {
            return 'Associate Veterinarian';
        }

        return '';
    }

    function isNonClinicalCategory(category) {
        const cat = (category || '').toLowerCase();
        return !!(
            cat &&
            !/\bveterinarian\b|\bveterinary\b|\bvet\b|\bdvm\b/i.test(cat) &&
            /\b(?:business development|support center|corporate|operations|marketing|finance|accounting|human resources|recruiting|talent|administrative|management|technology|it|sales)\b/i.test(cat)
        );
    }

    function hasClinicalTitleSignal(title) {
        const t = (title || '').toLowerCase();
        return /\b(?:veterinarian|veterinary|vet|dvm|medical director|surgeon|oncologist|cardiologist|radiologist|internist|dermatologist|neurologist|ophthalmologist|anesthesiologist|criticalist|dentist|oral surgeon)\b/i.test(t);
    }

    function shouldLeaveClinicalFieldsBlank(title, category) {
        return isNonClinicalCategory(category) && !hasClinicalTitleSignal(title);
    }

    function isExoticRoleTitle(title) {
        const t = (title || '').toLowerCase();
        return /\b(?:exotic|avian)\s+(?:veterinarian|vet|dvm)\b/i.test(t) ||
            /\b(?:veterinarian|vet|dvm)\b[^,\n()]{0,40}\b(?:exotic|avian)\b/i.test(t);
    }

    // Determine AOP from the Jobvite category string
    function getAOPFromCategory(category) {
        if (!category) return '';
        if (isNonClinicalCategory(category)) return '';
        const cat = category.toLowerCase().trim();
        if (cat.includes('urgent care')) return 'Urgent Care';
        if (cat.includes('specialist') || cat.includes('specialty') || cat.includes('diplomate') || cat.includes('surgeon')) return 'Specialty Care';
        if (cat.includes('gen practice') || /\bgp\b/.test(cat)) return 'General Practice Care';
        if (cat.includes('(er)') || /\b(?:er|emergency)\b/.test(cat)) return 'Emergency Care';
        return '';
    }

    // Determine AOP from title keywords when category is not available
    function getAOPFromTitle(title) {
        const t = title.toLowerCase();

        if (/\bpriority\s*pet\b/i.test(t)) return 'Urgent Care';
        if (/\bspecialty\b/.test(t) && /\bmedical director\b/.test(t)) return 'Specialty Care';
        if (/\b(?:avian|exotic)\b/.test(t) && /\bspecialist\b/.test(t)) return 'Specialty Care';
        if (isExoticRoleTitle(title)) return 'Exotic Pet Medicine';

        // Specialty indicators
        const specialtyNames = ['oncologist', 'cardiologist', 'neurologist', 'neurosurgeon',
            'dermatologist', 'ophthalmologist', 'anesthesiologist', 'theriogenologist',
            'radiologist', 'internist', 'criticalist',
            'oncology', 'cardiology', 'neurology', 'dermatology', 'ophthalmology',
            'anesthesia', 'theriogenology', 'radiology'];
        for (const sp of specialtyNames) {
            if (t.includes(sp)) return 'Specialty Care';
        }

        const specialtyCerts = ['board certified', 'residency trained', 'residential trained',
            'diplomate', 'dacvecc', 'dacvim', 'dacvr', 'dacvs', 'dacvd', 'dacvo', 'dacvaa',
            'dact', 'davdc', 'dabvp', 'acvs', 'acvim'];
        for (const cert of specialtyCerts) {
            if (t.includes(cert)) return 'Specialty Care';
        }

        if (t.includes('specialist') && !t.includes('technician specialist')) return 'Specialty Care';
        if (t.match(/\bsurgeon\b/)) return 'Specialty Care';

        // Urgent Care — check before Emergency since "urgent care" is more specific
        if (t.includes('urgent care')) return 'Urgent Care';

        // Emergency
        if (t.includes('emergency') || t.match(/\ber\b/) || t.includes('er vet') || t.includes('er dvm')) return 'Emergency Care';

        // Equine/Bovine/Exotics
        if (isExoticRoleTitle(title)) return 'Exotic Pet Medicine';
        if (t.includes('equine') || t.includes('bovine') || t.includes('large animal')) return 'General Practice Care';

        return '';
    }

    // ============ LOCAL DETAIL EXTRACTION (mirrors detail-extractor.js) ============

    function extractDetailsFromDescription(positionTitle, descriptionText) {
        const extractSalary = ThriveDetailRules.extractSalary;

        // Extract industry/category from stored description text
        function getIndustryCategory(text) {
            const match = text.match(/Industry\/Category:\s*([^\n]+)/i);
            return match ? match[1].trim() : '';
        }

        // Extract qualifications/requirements section from description
        function extractQualificationsSection(text) {
            const patterns = [
                /(?:requirements?|qualifications?|what you'?ll need|what we'?re looking for|credentials?|must have|what we need)[:\s]*([\s\S]{0,800}?)(?=(?:benefits?|compensation|salary|about|our culture|location|equal|join us|why|facility|what we offer|ready to)[:\s])/i,
                /(?:requirements?|qualifications?|what you'?ll need|what we'?re looking for|credentials?|must have|what we need)[:\s]*([\s\S]{0,500})/i
            ];
            for (const pattern of patterns) {
                const match = text.match(pattern);
                if (match) return match[1];
            }
            return null;
        }

        function extractRoleSignalText(text) {
            if (!text) return '';

            const rolePattern = /\b(?:medical director|lead veterinarian|lead vet|board certified|residency[-\s]+trained|residential[-\s]+trained|diplomate|criticalist|ecc specialist|emergency\s*(?:&|and)?\s*critical care specialist|internist|internal medicine specialist|cardiologist|dermatologist|neurologist|neurosurgeon|ophthalmologist|radiologist|diagnostic imaging specialist|anesthesiologist|medical oncologist|radiation oncologist|veterinary dentist|dental specialist|oral surgeon|veterinary surgeon|credentialed veterinary technician specialist|technician specialist|\bvts\b|\bdacv(?:ecc|im|r|s|d|o|aa)?\b|\bdacvr[-\s]?ro\b|\bdavdc\b|\bdabvp\b)\b/i;
            const blockedPattern = /\b(?:our services|services include|specialties include|benefits|medical(?:,\s*|\s+)dental|dental insurance|our hospital|our team has|state[-\s]?of[-\s]?the[-\s]?art|we offer|years of experience in specialty and emergency services)\b/i;
            const qualificationsSection = extractQualificationsSection(text);
            const collected = [];
            const seen = new Set();

            if (qualificationsSection) {
                seen.add(qualificationsSection);
                collected.push(qualificationsSection);
            }

            for (const rawLine of text.split('\n')) {
                const line = rawLine.trim();
                if (!line || !rolePattern.test(line) || blockedPattern.test(line) || seen.has(line)) continue;
                seen.add(line);
                collected.push(line);
            }

            return collected.join('\n');
        }

        // Determine Area of Practice
        // Priority: 1) Title-specific overrides (urgent care), 2) Industry/Category from JSON-LD, 3) title keywords, 4) description qualifications
        function determineAreaOfPractice(positionText, descriptionText) {
            const title = positionText.toLowerCase();
            const category = getIndustryCategory(descriptionText).toLowerCase();
            const qualSection = extractQualificationsSection(descriptionText) || '';

            if (shouldLeaveClinicalFieldsBlank(positionText, category)) return '';
            if (/\bpriority\s*pet\b/i.test(`${positionText}\n${descriptionText}`)) return 'Urgent Care';
            if (/\b(?:avian|exotic)\b/i.test(title) && /\bspecialist\b/i.test(title)) return 'Specialty Care';
            if (/\b(?:board certified|board[-\s]+certified|residency[-\s]+trained|residential[-\s]+trained|diplomate)\b/i.test(qualSection)) return 'Specialty Care';
            if (isExoticRoleTitle(positionText)) return 'Exotic Pet Medicine';

            // STEP 0: Title-specific overrides — these are MORE specific than Jobvite categories.
            // e.g. "Urgent Care Veterinarian" is categorized as "Veterinarian (ER)" on Jobvite,
            // but "urgent care" in the title is a more precise signal than the broad ER bucket.
            if (title.includes('urgent care')) return 'Urgent Care';

            // STEP 1: Use industry/category - most reliable signal for broad categories
            if (category) {
                if (category.includes('urgent care')) return 'Urgent Care';
                if (category.includes('specialist') || category.includes('specialty') || category.includes('diplomate') || category.includes('surgeon')) return 'Specialty Care';
                if (category.includes('gen practice') || /\bgp\b/.test(category)) return 'General Practice Care';
                if (category === 'veterinarian (er)' || category.includes('(er)') || /\b(?:er|emergency)\b/.test(category)) return 'Emergency Care';
                if (category.includes('medical director')) {
                    const combined = `${positionText}\n${qualSection}`;
                    if (/\bspecialty medical director\b|\bspecialty hospital\b|\bspecialty services?\b/i.test(combined)) return 'Specialty Care';
                    if (/\bemergency veterinary medical director\b|\bemergency (?:&|and)? referral\b/i.test(combined)) return 'Emergency Care';
                    if (hasExoticRequirementSignal(qualSection)) return 'Exotic Pet Medicine';
                    return 'General Practice Care';
                }
            }

            // STEP 2: Check TITLE for clear specialty position names (COMPREHENSIVE LIST)
            const specialtyPositionNames = [
                'oncologist', 'cardiologist', 'neurologist', 'neurosurgeon',
                'dermatologist', 'ophthalmologist', 'anesthesiologist', 'theriogenologist',
                'radiologist', 'internist', 'criticalist', 'ecc specialist',
                'oncology', 'cardiology', 'neurology', 'dermatology', 'ophthalmology',
                'anesthesia', 'theriogenology', 'radiology'
            ];
            for (const sp of specialtyPositionNames) {
                if (title.includes(sp)) return 'Specialty Care';
            }

            // Check title for board cert / diplomate / DACV* indicators
            const specialtyCerts = ['board certified', 'residency trained', 'residential trained',
                'diplomate', 'dacvecc', 'dacvim', 'dacvr', 'dacvs', 'dacvd', 'dacvo', 'dacvaa',
                'dact', 'davdc', 'dabvp', 'acvs', 'acvim'];
            for (const cert of specialtyCerts) {
                if (title.includes(cert)) return 'Specialty Care';
            }

            // Check for specialist or surgeon keywords
            if (title.includes('specialist') && !title.includes('technician specialist')) return 'Specialty Care';
            if (title.match(/\bsurgeon\b/) && !title.includes('neurosurgeon')) return 'Specialty Care';

            // STEP 3: Check TITLE for Emergency Care
            if (title.includes('emergency') || title.match(/\ber\b/) || title.includes('er vet') ||
                title.includes('er dvm') || title.includes('er veterinarian') || title.includes('ecc')) {
                return 'Emergency Care';
            }

            // STEP 4: Check TITLE for exotics/avian or large animal focus.
            if (isExoticRoleTitle(positionText)) return 'Exotic Pet Medicine';
            if (title.includes('equine') || title.includes('bovine') || title.includes('large animal')) return 'General Practice Care';

            // STEP 5: For generic titles, check ONLY the qualifications/role section.
            // ER listings often mention specialty teams, which should not override an ER category/title.
            if (qualSection && hasSpecialtyTrainingSignal(qualSection)) return 'Specialty Care';
            if (qualSection) {
                const qualLower = qualSection.toLowerCase();
                for (const cert of specialtyCerts) {
                    if (qualLower.includes(cert)) return 'Specialty Care';
                }
            }

            // STEP 6: Check page text for ER category
            if (descriptionText.match(/Veterinarian \(ER\)/i)) return 'Emergency Care';

            return hasClinicalTitleSignal(positionText) ? 'General Practice Care' : '';
        }

        // Match position from title keywords
        // PRIORITY ORDER: Leadership first (to avoid false matches on service names), then specialty, then generic
        function matchPositionFromTitle(title) {
            const t = (title || '').toLowerCase();

            // === HIGHEST PRIORITY: Leadership positions ===
            // Must be checked FIRST — "Group Medical Director - The Oncology Service" should be
            // Medical Director, NOT Medical Oncologist. The specialty word is the service name, not the role.
            if (t.includes('medical director')) return 'Medical Director';
            if (t.includes('lead veterinarian') || t.includes('lead vet')) return 'Lead Veterinarian';
            if (/\b(?:avian|exotic)\b/.test(t) && /\bspecialist\b/.test(t)) return 'Avian & Exotic Specialist';

            // === SPECIALTY POSITION NAMES ===
            if (t.includes('neurologist') || t.includes('neurosurgeon') || t.includes('neurology')) return 'Neurologist & Neurosurgeon';
            if (t.includes('dermatologist') || t.includes('dermatology')) return 'Dermatologist';
            if (t.includes('cardiologist') || t.includes('cardiology')) return 'Cardiologist';
            if (t.includes('oncologist') && t.includes('radiation')) return 'Radiation Oncologist';
            if (t.includes('oncologist') || t.includes('oncology')) return 'Medical Oncologist';
            if (t.includes('radiologist') || t.includes('diagnostic imaging') || t.includes('radiology')) return 'Radiologist';
            if (t.includes('ophthalmologist') || t.includes('ophthalmology')) return 'Ophthalmologist';
            if (t.includes('anesthesiologist') || t.includes('anesthesia')) return 'Anesthesiologist';
            if (t.includes('internist') || t.includes('internal medicine')) return 'Internal Medicine Specialist';
            if (t.includes('criticalist') || t.match(/\becc\b/) || t.includes('emergency medicine')) return 'ECC Specialist';
            if (t.includes('dabvp')) return 'DABVP Specialist';
            if ((t.includes('dental') || t.includes('dentist') || t.includes('dentistry')) && !t.includes('assistant')) return 'Dental Specialist';
            // For surgeon, be specific - check it's not part of neurosurgeon (already handled)
            if ((t.includes('surgeon') || t.includes('surgery')) && !t.includes('neurosurgeon') && !t.includes('neurology') && !t.includes('dental') && !t.includes('dentistry')) return 'Surgeon';

            // === VTS/CREDENTIALED SPECIALIST (check before generic technician) ===
            if (t.includes('technician specialist') || (t.match(/\bvts\b/) && t.includes('specialist'))) return 'Credentialed Veterinary Technician Specialist';

            // === GENERIC VETERINARIAN ROLES ===
            if (t.includes('partner veterinarian') || t.includes('partner vet') || t.includes('equity owner')) return 'Partner Veterinarian';
            if (/\b(?:associate\s+)?(?:emergency|er|urgent care|urgent)?\s*(?:veterinarian|vet|dvm)\b/.test(t)) return 'Associate Veterinarian';
            if (/\bassociate veterinarian\b|\bassociate vet\b/.test(t)) return 'Associate Veterinarian';

            return '';
        }

        // Match position from qualifications section
        function matchPositionFromQualifications(descriptionText) {
            return getPositionFromDescription(extractRoleSignalText(descriptionText));
        }

        // Validate position is allowed for given AOP per CorrectJobNames.txt
        function validatePositionForAOP(position, aop) {
            const validPositions = {
                'Emergency Care': ['Associate Veterinarian', 'Medical Director'],
                'Exotic Pet Medicine': ['Associate Veterinarian', 'Avian & Exotic Specialist'],
                'General Practice Care': ['Associate Veterinarian', 'Lead Veterinarian', 'Medical Director'],
                'Specialty Care': [
                    'Anesthesiologist', 'Avian & Exotic Specialist', 'Cardiologist', 'Credentialed Veterinary Technician Specialist',
                    'DABVP Specialist', 'Dental Specialist', 'Dermatologist', 'ECC Specialist',
                    'Internal Medicine Specialist', 'Medical Director', 'Medical Oncologist',
                    'Neurologist & Neurosurgeon', 'Ophthalmologist', 'Radiation Oncologist',
                    'Radiologist', 'Surgeon'
                ],
                'Urgent Care': ['Associate Veterinarian', 'Partner Veterinarian', 'Medical Director'],
            };

            // For compound AOPs like "General Practice Care / Emergency Care / Urgent Care",
            // accept the position if it's valid in ANY of the listed AOPs
            const aopParts = aop.split('/').map(s => s.trim());
            for (const part of aopParts) {
                const allowed = validPositions[part];
                if (allowed && allowed.includes(position)) return position;
            }

            // If we found at least one known AOP but position wasn't valid in any of them, default
            const hasKnownAOP = aopParts.some(part => validPositions[part]);
            if (hasKnownAOP) return 'Associate Veterinarian';

            // Completely unknown AOP — still validate against all known positions
            const allValid = new Set(Object.values(validPositions).flat());
            if (allValid.has(position)) return position;

            return 'Associate Veterinarian';
        }

        // Determine Position
        function determinePosition(positionText, descriptionText, areaOfPractice) {
            if (!areaOfPractice) return '';
            let position = matchPositionFromTitle(positionText);
            if (!position) {
                position = matchPositionFromQualifications(descriptionText);
            }
            return APPROVED_POSITION_SET.has(position) ? position : '';
        }

        // Extract locations from stored description (which now includes JSON-LD data)
        function extractLocations(text) {
            const locations = [];

            // First try to extract from structured JSON-LD data in the text
            // Format from description-scraper: "  - City, ST, Country" or "  - City, State"
            const locationsSection = text.match(/Locations:\n((?:\s*-\s*[^\n]+\n?)+)/i);
            if (locationsSection) {
                const locationLines = locationsSection[1].split('\n');
                for (const line of locationLines) {
                    const trimmed = line.trim();
                    if (!trimmed.startsWith('-')) continue;
                    // Remove leading "- " and split by comma
                    const parts = trimmed.replace(/^-\s*/, '').split(',').map(s => s.trim()).filter(s => s);
                    if (parts.length >= 2) {
                        const city = parts[0];
                        let state = parts[1];
                        // Try to find a 2-letter state abbreviation elsewhere in the text for this city
                        if (state.length > 2) {
                            const stateAbbrev = text.match(new RegExp(`${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')},\\s*([A-Z]{2})\\b`));
                            if (stateAbbrev) {
                                state = stateAbbrev[1];
                            }
                        }
                        locations.push({ city, state, location: `${city}, ${state}` });
                    }
                }
            }

            // If no locations found, fall back to pattern matching
            if (locations.length === 0) {
                // Clean up the text
                text = text.replace(/^Description\s*/i, '');
                text = text.replace(/^Position at\s*/i, '');
                const searchText = text.substring(0, 500);

                // Match patterns like "City, ST"
                const matches = searchText.matchAll(/\b([A-Za-z][\w\s.'()-]*[A-Za-z])\s*,\s*([A-Z]{2})\b/g);
                for (const match of matches) {
                    let city = match[1].trim();
                    const state = match[2].trim();

                    const invalidWords = ['description', 'position', 'associate', 'veterinarian', 'hospital', 'care', 'center', 'clinic', 'location'];
                    if (!invalidWords.some(word => city.toLowerCase().includes(word)) && city.length > 1 && city.length < 50) {
                        locations.push({ city, state, location: `${city}, ${state}` });
                    }
                }
            }

            // Deduplicate
            const uniqueLocations = [];
            const seen = new Set();
            for (const loc of locations) {
                const key = `${loc.city}|${loc.state}`.toLowerCase();
                if (!seen.has(key)) {
                    seen.add(key);
                    uniqueLocations.push(loc);
                }
            }

            return uniqueLocations;
        }

        function extractCompleteAddress(text) {
            const lines = getDescriptionLines(text);

            function parseAddressLine(rawLine) {
                let line = rawLine.replace(/^\s*-\s*/, '').replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim();
                if (!line) return null;
                if (/\||\blocations?\s+(?:and\s+locations?\s+)?(?:coming\s+soon\s+)?include\b/i.test(line)) return null;

                const parts = line.split(',').map(part => part.trim()).filter(Boolean);
                const last = parts[parts.length - 1] || '';
                if (/^(?:USA|United States)$/i.test(last)) parts.pop();
                if (parts.length === 2 && /^TBD$/i.test(parts[0]) && /^TBD$/i.test(parts[1])) {
                    return {
                        streetAddress: 'TBD',
                        city: 'TBD',
                        state: 'TBD',
                        stateAbbrev: '',
                        zipCode: '',
                        location: 'TBD'
                    };
                }
                if (parts.length < 3) return null;

                const statePart = parts[parts.length - 1];
                let stateAbbrev = '';
                let stateFull = '';
                let zipCode = '';
                const abbrevZip = statePart.match(/^([A-Z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/);
                if (abbrevZip) {
                    stateAbbrev = abbrevZip[1];
                    stateFull = getFullStateName(stateAbbrev);
                    zipCode = abbrevZip[2] || '';
                } else {
                    const fullStateZip = statePart.match(/^([A-Za-z][A-Za-z\s.]+?)(?:\s+(\d{5}(?:-\d{4})?))?$/);
                    if (!fullStateZip) return null;
                    if (/^[A-Za-z]{2}$/.test(fullStateZip[1]) && !/^TBD$/i.test(fullStateZip[1])) return null;
                    stateAbbrev = getStateAbbrev(fullStateZip[1]);
                    if (!stateAbbrev && !/^TBD$/i.test(fullStateZip[1])) return null;
                    stateFull = /^TBD$/i.test(fullStateZip[1]) ? 'TBD' : getFullStateName(fullStateZip[1]);
                    zipCode = fullStateZip[2] || '';
                }

                const city = parts[parts.length - 2] || '';
                let street = parts.slice(0, -2).join(', ').trim();
                street = street.replace(/^TBD-?$/i, 'TBD');
                if (!street || !city || !/^(?:TBD|[A-Za-z][A-Za-z\s.'-]*)$/i.test(city)) return null;
                if (/\bto\b/i.test(city)) return null;
                if (!ThriveDetailRules.isStreetAddress(street)) return null;

                return {
                    streetAddress: street,
                    city,
                    state: stateFull,
                    stateAbbrev,
                    zipCode,
                    location: stateAbbrev ? `${city}, ${stateAbbrev}` : city
                };
            }

            for (let i = lines.length - 1; i >= 0; i--) {
                const parsed = parseAddressLine(lines[i]);
                if (parsed) return parsed;
            }

            return { streetAddress: '', city: '', state: '', stateAbbrev: '', zipCode: '', location: '' };
        }

        const extractHospitalName = ThriveDetailRules.extractHospital;
        const extractJobType = ThriveDetailRules.extractJobType;
        const extractExperience = ThriveDetailRules.extractExperience;

        // Run all extractions
        const salary = extractSalary(descriptionText);
        const areaOfPractice = determineAreaOfPractice(positionTitle, descriptionText);
        const position = determinePosition(positionTitle, descriptionText, areaOfPractice);
        const locations = extractLocations(descriptionText);
        const completeAddress = extractCompleteAddress(descriptionText);
        const hospitalName = extractHospitalName(descriptionText);
        const jobType = extractJobType(descriptionText);
        const experience = extractExperience(descriptionText);

        return {
            salary,
            areaOfPractice,
            position,
            locations,
            streetAddress: formatStreetAddress(completeAddress.streetAddress),
            addressCity: formatCityName(completeAddress.city),
            addressState: formatStateName(completeAddress.state),
            addressLocation: completeAddress.location,
            zipCode: completeAddress.zipCode,
            hospitalName,
            jobType,
            experience
        };
    }

    function getJobviteSpecificsForJob(job) {
        const stored = job.jobviteSpecifics || job.jobviteDetails?.specifics || {};
        const description = job.description || '';

        function clean(value) {
            return String(value || '').replace(/\s+/g, ' ').trim();
        }

        function lineValue(label) {
            const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const match = description.match(new RegExp(`^${escaped}:[ \\t]*([^\\n]*)`, 'im'));
            return clean(match?.[1] || '');
        }

        return {
            company: clean(stored.company || stored.Company || lineValue('Company')),
            category: clean(stored.category || stored.Category || lineValue('Category') || lineValue('Industry/Category')),
            city: formatCityName(clean(stored.city || stored.City || lineValue('City'))),
            state: formatStateName(clean(stored.state || stored.State || lineValue('State'))),
            lastUpdated: clean(stored.lastUpdated || stored.LastUpdated || stored['Last Updated'] || lineValue('Last Updated')),
            requisitionId: clean(stored.requisitionId || stored.RequisitionId || stored['Requisition Id'] || lineValue('Requisition Id'))
        };
    }

    function formatJobviteJobId(requisitionId) {
        const raw = String(requisitionId || '').trim();
        if (!raw) return '';
        return /^THR-/i.test(raw) ? raw : `THR-${raw}`;
    }

    function formatSpecificsLocation(city, state) {
        const parts = [city, state].filter(Boolean);
        return parts.join(', ');
    }

});
