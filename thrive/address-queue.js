'use strict';
// One persisted job at a time; alarms recover work after worker/browser restarts.
const ADDRESS_RUN_KEY = 'addressRun';
const ADDRESS_ALARM = 'thrive-address-queue';
let addressBusy = false;
let addressStarting = null;
let addressStopping = null;
let addressWrites = Promise.resolve();
const cancelledAddressRuns = new Set();
const addressIdleWaiters = [];
const addressWait = ms => new Promise(resolve => setTimeout(resolve, ms));
const addressIdentity = job => JSON.stringify([job.link || '', job.jobId || '', job.title || '']);
const addressInput = job => JSON.stringify(['primaryHospital', 'hospital', 'location', 'streetAddress', 'city', 'state', 'zipCode', 'phone', 'website'].map(key => job[key] || ''));

async function saveAddressRun(run) {
  run.updatedAt = Date.now();
  await commitAddressRun(run);
}

function commitAddressRun(run, jobs) {
  // Serialize checkpoints and cancellation so a late result cannot revive a run.
  const write = addressWrites.then(() => {
    if (cancelledAddressRuns.has(run.id) && run.status !== 'stopped') throw new Error('Address lookup stopped.');
    return chrome.storage.local.set({ [ADDRESS_RUN_KEY]: run, ...(jobs ? { scrapedJobs: jobs } : {}) });
  });
  addressWrites = write.catch(() => {});
  return write;
}

async function closeAddressMarker(run) {
  if (run.markerTabId == null) return;
  const marker = await chrome.tabs.get(run.markerTabId).catch(() => null);
  if (marker?.url === run.markerUrl) await chrome.tabs.remove(marker.id).catch(() => {});
}

async function stopAddressRun() {
  if (addressStopping) return addressStopping;
  addressStopping = (async () => {
    if (addressStarting) await addressStarting;
    const stored = await chrome.storage.local.get(ADDRESS_RUN_KEY);
    const run = stored.addressRun;
    if (run?.status !== 'running') return run || null;
    cancelledAddressRuns.add(run.id);
    await addressWrites;
    const latest = (await chrome.storage.local.get(ADDRESS_RUN_KEY)).addressRun;
    if (latest?.id === run.id) Object.assign(run, latest);
    run.status = 'stopped'; run.error = ''; run.finishedAt = Date.now();
    await saveAddressRun(run);
    await chrome.alarms.clear(ADDRESS_ALARM);
    await closeAddressTab(run);
    await closeAddressMarker(run);
    // Wait until any in-flight reader has discarded its result and closed its tab.
    if (addressBusy) await new Promise(resolve => addressIdleWaiters.push(resolve));
    await saveAddressRun(run);
    return run;
  })();
  try { return await addressStopping; } finally { addressStopping = null; }
}

async function startAddressRun(request, sender = {}) {
  if (addressStopping) await addressStopping;
  if (addressStarting) return addressStarting;
  addressStarting = (async () => {
    await ensureJobStorage();
    if (typeof isScraping !== 'undefined' && isScraping) throw new Error('Wait for job scraping to finish.');
    const stored = await chrome.storage.local.get(['scrapedJobs', ADDRESS_RUN_KEY, 'descriptionRun']);
    if (stored.descriptionRun?.status === 'running') throw new Error('Wait for description scraping to finish.');
    if (stored.addressRun?.status === 'running') {
      void pumpAddressQueue();
      return stored.addressRun;
    }
    const windowId = await resolveDescriptionWindow(request, sender);
    const sourceWindow = await chrome.windows.get(windowId);
    const eligibleJobs = (stored.scrapedJobs || []).filter(ThriveJobFilter.isDvmJob);
    const queue = eligibleJobs.map(addressIdentity);
    const run = { id: crypto.randomUUID(), windowId, status: queue.length ? 'running' : 'completed',
      queue, total: queue.length, next: 0, saved: 0, failed: 0, skipped: 0, step: 0,
      activeTabId: null, activeUrl: '', error: '', startedAt: Date.now() };
    if (queue.length) {
      const marker = await chrome.tabs.create({ windowId, active: false, url: chrome.runtime.getURL('address-run.html') + '#' + run.id });
      run.markerUrl = chrome.runtime.getURL('address-run.html') + '#' + run.id;
      run.markerTabId = marker.id;
      if (sourceWindow.state === 'minimized') await chrome.windows.update(windowId, { state: 'minimized' });
    }
    await commitAddressRun(run, eligibleJobs);
    await chrome.storage.session.set({ addressWindowRun: run.id });
    if (queue.length) {
      await chrome.alarms.create(ADDRESS_ALARM, { periodInMinutes: 0.5 });
      void pumpAddressQueue();
    }
    return run;
  })();
  try { return await addressStarting; } finally { addressStarting = null; }
}

async function addressWindow(run) {
  // A marker identifies the original window even when Chrome renumbers it.
  const tabs = await chrome.tabs.query({});
  const marker = tabs.find(tab => tab.url === run.markerUrl);
  if (marker) {
    run.windowId = marker.windowId; run.markerTabId = marker.id; run.browserRestart = false;
    await chrome.storage.session.set({ addressWindowRun: run.id });
    return;
  }
  // If the marker alone was closed, keep using the original window in this session.
  const session = await chrome.storage.session.get('addressWindowRun');
  if (session.addressWindowRun === run.id && !run.browserRestart) {
    const existing = await chrome.windows.get(run.windowId).catch(() => null);
    if (existing) return;
  }
  // Never borrow whichever browser window happens to be active after a restart.
  const created = await chrome.windows.create({ url: run.markerUrl, focused: false, state: 'minimized', type: 'normal' });
  run.windowId = created.id;
  run.markerTabId = created.tabs?.[0]?.id ?? null;
  run.browserRestart = false;
  await chrome.storage.session.set({ addressWindowRun: run.id });
  await saveAddressRun(run);
}

async function closeAddressTab(run) {
  if (run.activeTabId != null) {
    const tab = await chrome.tabs.get(run.activeTabId).catch(() => null);
    // Ownership is lost if the user navigated the temporary tab elsewhere.
    if (tab?.windowId === run.windowId && (tab.url === run.activeUrl || tab.pendingUrl === run.activeUrl)) await chrome.tabs.remove(tab.id).catch(() => {});
  }
  run.activeTabId = null;
  run.activeUrl = '';
}

async function readGoogleAddress(run, job, search) {
  const url = new URL(search.url);
  if (url.origin !== 'https://www.google.com') throw new Error('Unsupported address source');
  let tab = run.activeTabId == null ? null : await chrome.tabs.get(run.activeTabId).catch(() => null);
  if (!tab || tab.windowId !== run.windowId || tab.url !== run.activeUrl) {
    const sourceWindow = await chrome.windows.get(run.windowId);
    tab = await chrome.tabs.create({ windowId: run.windowId, active: false, url: search.url });
    run.activeTabId = tab.id;
    run.activeUrl = search.url;
    await saveAddressRun(run);
    if (sourceWindow.state === 'minimized') await chrome.windows.update(run.windowId, { state: 'minimized' });
  }
  const deadline = Date.now() + 25000;
  let lastComplete = '';
  try {
    while (Date.now() < deadline) {
      if (cancelledAddressRuns.has(run.id)) return null;
      const current = await chrome.tabs.get(tab.id);
      if (current.status !== 'complete') { await addressWait(750); continue; }
      const page = new URL(current.url);
      if (page.origin !== 'https://www.google.com' || (!page.pathname.startsWith('/maps') && page.pathname !== '/search')) return null;
      // Google Maps changes its URL while opening a panel; record ownership.
      if (run.activeUrl !== current.url) { run.activeUrl = current.url; await saveAddressRun(run); }
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: value => {
        globalThis.__thriveAddressTarget = value;
      }, args: [{ hospital: ThriveAddressRules.hospital(job), location: ThriveAddressRules.location(job) }] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['address-rules.js'] });
      const response = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['google-address-reader.js'] });
      const result = response?.[0]?.result || {};
      if (result.blocked) throw new Error('Google requested verification. No address was accepted.');
      if (result.candidateUrl) {
        const candidate = new URL(result.candidateUrl);
        if (candidate.origin !== 'https://www.google.com' || !candidate.pathname.startsWith('/maps/')) {
          throw new Error('Google returned an invalid address candidate.');
        }
        await chrome.tabs.update(tab.id, { url: candidate.href, active: false });
        run.activeUrl = candidate.href;
        await saveAddressRun(run);
        await addressWait(750);
        continue;
      }
      if (ThriveAddressRules.accept(job, result, search)) {
        const signature = JSON.stringify(result);
        if (signature === lastComplete) return result;
        lastComplete = signature;
      } else lastComplete = '';
      await addressWait(750);
    }
    return null;
  } finally {
    await closeAddressTab(run);
  }
}

async function pumpAddressQueue() {
  if (addressBusy) return;
  addressBusy = true;
  let run;
  let again = false;
  try {
    await ensureJobStorage();
    const stored = await chrome.storage.local.get([ADDRESS_RUN_KEY, 'scrapedJobs', 'descriptionRun']);
    run = stored.addressRun;
    if (run?.status !== 'running' || stored.descriptionRun?.status === 'running') return;
    if (run.next >= run.total) {
      await finishAddressRun(run);
      return;
    }
    await addressWindow(run);
    if (cancelledAddressRuns.has(run.id)) return;
    const identity = run.queue[run.next];
    const job = (stored.scrapedJobs || []).find(item => addressIdentity(item) === identity);
    if (!job || !ThriveJobFilter.isDvmJob(job)) {
      await closeAddressTab(run);
      run.skipped++; run.next++; run.step = 0;
      if (job) await commitAddressRun(run, (stored.scrapedJobs || []).filter(ThriveJobFilter.isDvmJob));
    } else {
      const fingerprint = addressInput(job);
      // Restart the current lookup if another extension view changed its inputs.
      if (run.input && run.input !== fingerprint) { await closeAddressTab(run); run.step = 0; }
      run.input = fingerprint;
      const searches = ThriveAddressRules.searches(job);
      let result = null;
      if (searches[run.step]) {
        try { result = await readGoogleAddress(run, job, searches[run.step]); }
        catch (error) { run.error = error.message; }
        run.step++;
      }
      if (cancelledAddressRuns.has(run.id)) return;
      if (result || run.step >= searches.length) {
        const latest = await chrome.storage.local.get('scrapedJobs');
        const jobs = latest.scrapedJobs || [];
        const index = jobs.findIndex(item => addressIdentity(item) === identity);
        if (index < 0) run.skipped++;
        else if (!ThriveJobFilter.isDvmJob(jobs[index])) {
          jobs.splice(index, 1);
          run.skipped++; run.next++; run.step = 0; run.input = '';
          await commitAddressRun(run, jobs);
        } else if (addressInput(jobs[index]) !== fingerprint) {
          run.step = 0; run.input = ''; again = true;
          await saveAddressRun(run);
          return;
        } else {
          jobs[index] = ThriveAddressRules.apply(jobs[index], result);
          if (result) { run.saved++; run.error = ''; } else run.failed++;
          run.next++; run.step = 0; run.input = '';
          // Commit job and checkpoint together so restarts cannot double-process it.
          await commitAddressRun(run, jobs);
        }
        if (index < 0) { run.next++; run.step = 0; run.input = ''; }
      }
    }
    if (run.next >= run.total) {
      await finishAddressRun(run);
      return;
    }
    await saveAddressRun(run);
    again = run.status === 'running';
  } catch (error) {
    if (run) { run.error = error.message; await saveAddressRun(run).catch(() => {}); }
    // Keep the persisted run and let the alarm retry transient browser failures.
  } finally {
    if (run && cancelledAddressRuns.has(run.id)) {
      await closeAddressTab(run);
      await closeAddressMarker(run);
      again = false;
    }
    addressBusy = false;
    addressIdleWaiters.splice(0).forEach(resolve => resolve());
    if (again) setTimeout(() => { void pumpAddressQueue(); }, 0);
  }
}

async function finishAddressRun(run) {
  run.status = run.failed ? 'completed_with_errors' : 'completed';
  run.finishedAt = Date.now(); run.queue = [];
  await closeAddressTab(run);
  await closeAddressMarker(run);
  await chrome.alarms.clear(ADDRESS_ALARM);
  await saveAddressRun(run);
}

async function resumeAddressRun(browserRestart = false) {
  const stored = await chrome.storage.local.get(ADDRESS_RUN_KEY);
  const run = stored.addressRun;
  if (run?.status !== 'running') return;
  if (browserRestart) {
    run.browserRestart = true; run.activeTabId = null; run.activeUrl = '';
    await saveAddressRun(run);
  }
  await chrome.alarms.create(ADDRESS_ALARM, { periodInMinutes: 0.5 });
  void pumpAddressQueue();
}
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ADDRESS_ALARM) void pumpAddressQueue(); });
chrome.runtime.onStartup.addListener(() => { void resumeAddressRun(true); });
chrome.runtime.onMessage.addListener((request, sender, respond) => {
  if (request.action === 'stopAddressRun') {
    stopAddressRun().then(run => respond({ success: true, run }))
      .catch(error => respond({ success: false, error: error.message }));
    return true;
  }
  if (request.action !== 'startAddressRun') return;
  startAddressRun(request, sender).then(run => respond({ success: true, run }))
    .catch(error => respond({ success: false, error: error.message }));
  return true;
});
void resumeAddressRun().catch(() => {});
