// Durable description processing. The Records page only starts and observes a run.
const DESCRIPTION_RUN_KEY = 'descriptionRun';
const DESCRIPTION_ALARM = 'thrive-description-queue';
let jobStorageReady = null;
let descriptionPumpBusy = false;
let descriptionStartPromise = null;

function compactJobDescription(job) {
  const legacy = job.jobviteDetails;
  if (!job.jobviteSpecifics && legacy?.specifics) job.jobviteSpecifics = legacy.specifics;
  // An explicitly empty description was cleared by the user; do not restore it.
  if (job.description == null) {
    job.description = legacy?.fullText || job.descriptionBody || legacy?.description || '';
  }
  job.jobType = ThriveDetailRules.extractJobType(job.description);
  delete job.descriptionBody;
  delete job.descriptionHtml;
  delete job.jobviteDetails;
  return job;
}

function ensureJobStorage() {
  if (!jobStorageReady) {
    jobStorageReady = (async () => {
      const stored = await chrome.storage.local.get(['scrapedJobs', 'thriveJobs']);
      const jobs = Array.isArray(stored.scrapedJobs) ? stored.scrapedJobs : (stored.thriveJobs || []);
      const dvmJobs = jobs.filter(ThriveJobFilter.isDvmJob);
      if (stored.thriveJobs || dvmJobs.length !== jobs.length || jobs.some(job =>
        'descriptionBody' in job || 'descriptionHtml' in job || 'jobviteDetails' in job ||
        job.jobType !== ThriveDetailRules.extractJobType(job.description))) {
        // Commit the canonical records before removing the legacy duplicate.
        await chrome.storage.local.set({ scrapedJobs: dvmJobs.map(compactJobDescription) });
        await chrome.storage.local.remove('thriveJobs');
      }
    })().catch(error => {
      jobStorageReady = null;
      throw error;
    });
  }
  return jobStorageReady;
}

function needsJobDescription(job) {
  if (!ThriveJobFilter.isDvmJob(job)) return false;
  if (!job.link) return false;
  const description = String(job.description || '').trim();
  return !description || job.descriptionFetchFailed || /^Description fetch failed\.?$/i.test(description) ||
    (/^Specifics\s*\n/i.test(description) && /\nDescription\s*$/i.test(description));
}

async function resolveDescriptionWindow(request, sender = {}) {
  let windowId = sender.tab?.windowId;
  const tabId = request.sourceTabId ?? request.tabId;
  if (windowId == null && Number.isInteger(tabId)) windowId = (await chrome.tabs.get(tabId)).windowId;
  if (windowId == null) windowId = request.windowId;
  if (!Number.isInteger(windowId) || windowId < 0) {
    throw new Error('Open Records in the window you want to use and click Get Descriptions again.');
  }
  await chrome.windows.get(windowId);
  return windowId;
}

async function saveDescriptionRun(run) {
  run.updatedAt = Date.now();
  await chrome.storage.local.set({ [DESCRIPTION_RUN_KEY]: run });
}

async function startDescriptionRun(request, sender) {
  if (descriptionStartPromise) return descriptionStartPromise;
  descriptionStartPromise = (async () => {
    await ensureJobStorage();
    const stored = await chrome.storage.local.get(['scrapedJobs', DESCRIPTION_RUN_KEY, 'addressRun']);
    if (stored.addressRun?.status === 'running') throw new Error('Wait for address lookup to finish.');
    if (stored[DESCRIPTION_RUN_KEY]?.status === 'running') {
      await chrome.alarms.create(DESCRIPTION_ALARM, { periodInMinutes: 0.5 });
      void pumpDescriptionQueue();
      return stored[DESCRIPTION_RUN_KEY];
    }
    const windowId = await resolveDescriptionWindow(request, sender);
    const queue = (stored.scrapedJobs || [])
      .map((job, index) => ({ job, index }))
      .filter(item => needsJobDescription(item.job))
      .map(item => ({ link: item.job.link, index: item.index }));
    const run = {
      id: crypto.randomUUID(), windowId, status: queue.length ? 'running' : 'completed',
      queue, total: queue.length, next: 0, fetched: 0, failed: 0, skipped: 0,
      attempt: 0, activeTabId: null, error: '', startedAt: Date.now()
    };
    await saveDescriptionRun(run);
    if (queue.length) {
      await chrome.alarms.create(DESCRIPTION_ALARM, { periodInMinutes: 0.5 });
      void pumpDescriptionQueue();
    }
    return run;
  })();
  try { return await descriptionStartPromise; }
  finally { descriptionStartPromise = null; }
}

async function pumpDescriptionQueue() {
  if (descriptionPumpBusy) return;
  descriptionPumpBusy = true;
  let run;
  let continueRun = false;
  try {
    await ensureJobStorage();
    const stored = await chrome.storage.local.get([DESCRIPTION_RUN_KEY, 'scrapedJobs']);
    run = stored[DESCRIPTION_RUN_KEY];
    if (run?.status !== 'running') return;

    try { await chrome.windows.get(run.windowId); }
    catch { throw new Error('The original scraping window was closed. Open Records in the desired window and click Get Descriptions to resume.'); }

    // A stopped/restarted worker may have left a temporary tab behind. Reuse it
    // only when both its URL and window still belong to the current queued job.
    const queued = run.queue[run.next];
    let existingTabId;
    if (run.activeTabId != null) {
      const tab = await chrome.tabs.get(run.activeTabId).catch(() => null);
      if (tab?.windowId === run.windowId && queued &&
          tab.url === withJobviteStandaloneUrl(queued.link)) existingTabId = tab.id;
      else if (tab?.windowId === run.windowId) await chrome.tabs.remove(tab.id).catch(() => {});
      run.activeTabId = existingTabId ?? null;
    }

    if (queued) {
      const jobs = stored.scrapedJobs || [];
      const index = jobs[queued.index]?.link === queued.link && needsJobDescription(jobs[queued.index])
        ? queued.index : jobs.findIndex(job => job.link === queued.link && needsJobDescription(job));
      if (index < 0) {
        if (existingTabId) await chrome.tabs.remove(existingTabId).catch(() => {});
        run.skipped++;
        run.next++;
        run.attempt = 0;
      } else {
        const result = await scrapeJobDescription({
          jobIndex: index, jobLink: queued.link, windowId: run.windowId, tabId: existingTabId,
          onTabCreated: async tabId => {
            run.activeTabId = tabId;
            await saveDescriptionRun(run);
          }
        });
        if (result.excluded) {
          run.skipped++;
          run.next++;
          run.attempt = 0;
          run.error = '';
        } else if (result.success) {
          run.fetched++;
          run.next++;
          run.attempt = 0;
          run.error = '';
        } else if (run.attempt < 1) {
          run.attempt++;
          run.error = result.error;
        } else {
          run.failed++;
          run.next++;
          run.attempt = 0;
          run.error = result.error;
        }
      }
      run.activeTabId = null;
    }
    if (run.next >= run.total) {
      run.status = run.failed ? 'completed_with_errors' : 'completed';
      run.finishedAt = Date.now();
      run.queue = [];
    }
    await saveDescriptionRun(run);
    continueRun = run.status === 'running';
    if (!continueRun) await chrome.alarms.clear(DESCRIPTION_ALARM);
  } catch (error) {
    console.error('Description queue paused:', error);
    if (run) {
      run.status = 'error';
      run.error = error.message;
      await saveDescriptionRun(run).catch(() => {});
    }
    await chrome.alarms.clear(DESCRIPTION_ALARM).catch(() => {});
  } finally {
    descriptionPumpBusy = false;
    // Each job is a bounded task. The alarm resumes from storage if Chrome
    // terminates the worker before the next task starts.
    if (continueRun) setTimeout(() => { void pumpDescriptionQueue(); }, 0);
  }
}

async function resumeDescriptionRun() {
  await ensureJobStorage();
  const stored = await chrome.storage.local.get([DESCRIPTION_RUN_KEY]);
  if (stored[DESCRIPTION_RUN_KEY]?.status === 'running') {
    await chrome.alarms.create(DESCRIPTION_ALARM, { periodInMinutes: 0.5 });
    void pumpDescriptionQueue();
  }
}

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === DESCRIPTION_ALARM) void pumpDescriptionQueue();
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startDescriptionRun') {
    startDescriptionRun(request, sender)
      .then(run => sendResponse({ success: true, run }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === 'getDescriptionRun') {
    ensureJobStorage()
      .then(() => chrome.storage.local.get([DESCRIPTION_RUN_KEY]))
      .then(stored => sendResponse({ success: true, run: stored[DESCRIPTION_RUN_KEY] || null }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

// Run on every worker startup, not only when the browser launches.
void resumeDescriptionRun().catch(error => console.error('Could not restore descriptions:', error));
