// Encore Vet - Google Maps Phone Scraper
// Injected into a Google Maps tab to extract the phone number for a hospital.
//
// Strategy:
// 1. Wait for Maps to load — it may either auto-navigate to a single place detail
//    OR show a search-results list.
// 2. If a single place: try extracting phone immediately from the detail panel.
// 3. If a results list: find the best-matching result by comparing aria-label text
//    against the hospital name from the search URL, then click it.
// 4. After clicking, wait for the detail panel to load and extract the phone number.
//
// Phone extraction uses multiple strategies (most → least reliable):
//   a. button[data-item-id^="phone:"] — modern Maps, always present
//   b. [aria-label^="Phone:"]         — present on older Maps layouts
//   c. a[href^="tel:"]               — tel: links always have clean numbers
//   d. body text regex               — last resort

(async () => {
  const MAX_WAIT_MS = 18000;   // 18 s total budget
  const POLL_MS     = 500;     // check every 500 ms
  const startTime   = Date.now();
  const wait        = (ms) => new Promise(r => setTimeout(r, ms));

  // ── Clean a raw string into a formatted phone number ────────────────────
  function cleanPhone(raw) {
    if (!raw) return '';
    // Strip label prefix ("Phone: " etc.)
    let s = raw.replace(/^Phone:\s*/i, '').replace(/\s+/g, ' ').trim();
    // Try to extract a standard NANP number
    const m = s.match(/(\+?1[\s\-.]?)?\(?\d{3}\)?[\s\-\.]\d{3}[\s\-\.]\d{4}/);
    if (m) return m[0].replace(/\s+/g, ' ').trim();
    // Fallback: keep only phone-safe characters
    const stripped = s.replace(/[^\d\+\-\(\) ]/g, '').trim();
    return stripped.length >= 7 ? stripped : '';
  }

  // ── Extract phone number from the visible place detail panel ────────────
  function tryExtractPhone() {
    // Method 1 (most reliable): button with data-item-id starting "phone:"
    // e.g. data-item-id="phone:tel:+17732817110"
    const phoneBtn = document.querySelector('button[data-item-id^="phone:"]');
    if (phoneBtn) {
      // innerText avoids hidden icon glyph characters that textContent includes
      const fromText = cleanPhone(phoneBtn.innerText);
      if (fromText) return fromText;
      const fromAria = cleanPhone(phoneBtn.getAttribute('aria-label'));
      if (fromAria) return fromAria;
      // data-item-id itself encodes the number: "phone:tel:+1XXXXXXXXXX"
      const fromId = cleanPhone(
        (phoneBtn.getAttribute('data-item-id') || '')
          .replace(/^phone:tel:/, '')
          .replace(/^phone:/, '')
      );
      if (fromId) return fromId;
    }

    // Method 2: any element with aria-label starting "Phone:"
    const ariaEl = document.querySelector('[aria-label^="Phone:"]');
    if (ariaEl) {
      const cleaned = cleanPhone(ariaEl.getAttribute('aria-label'));
      if (cleaned) return cleaned;
    }

    // Method 3: tel: links always carry the raw number
    for (const link of document.querySelectorAll('a[href^="tel:"]')) {
      const fromText = cleanPhone(link.innerText || link.textContent);
      if (fromText) return fromText;
      const fromHref = cleanPhone(link.getAttribute('href').replace('tel:', ''));
      if (fromHref) return fromHref;
    }

    // Method 4: broad aria-label scan for phone number patterns
    for (const el of document.querySelectorAll('[aria-label]')) {
      const lbl = el.getAttribute('aria-label') || '';
      if (/^\+?1?\s*[\(]?\d{3}[\)\-.\s]\s*\d{3}[\-.\s]\d{4}/.test(lbl.trim())) {
        return cleanPhone(lbl);
      }
    }

    // Method 5: body text last resort
    const bodyText = document.body.innerText || '';
    const m = bodyText.match(/\+?1?\s*[\(]?\d{3}[\)\-.\s]\s*\d{3}[\-.\s]\d{4}/);
    return m ? cleanPhone(m[0]) : '';
  }

  // ── Get hospital name from the Google Maps search URL ────────────────────
  // URL format: /maps/search/Hospital+Name%2C+Street+Address%2C+City%2C+State+ZIP
  // The query uses comma-delimited format; the hospital name is the first segment.
  function getHospitalNameFromUrl() {
    const match = window.location.href.match(/\/maps\/search\/([^?#@/]+)/);
    if (!match) return '';
    const fullQuery = decodeURIComponent(match[1]).replace(/\+/g, ' ').trim();
    // Split on comma — first segment is the hospital name
    const firstComma = fullQuery.indexOf(',');
    return firstComma > 0 ? fullQuery.substring(0, firstComma).trim() : fullQuery;
  }

  // ── Find the search result that best matches the hospital name ───────────
  // Scores each result by how many query words appear in its aria-label.
  function findBestMatch(links, searchQuery) {
    if (!searchQuery || links.length === 0) return null;

    const normalize = (s) => s.toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const queryWords = normalize(searchQuery).split(' ').filter(w => w.length > 2);
    if (queryWords.length === 0) return links[0]; // no useful words → use first

    let bestLink  = null;
    let bestScore = 0;

    for (const link of links) {
      const label     = (link.getAttribute('aria-label') || '').replace(/·.*$/, '').trim();
      const labelNorm = normalize(label);
      let matchCount  = 0;
      for (const word of queryWords) {
        if (labelNorm.includes(word)) matchCount++;
      }
      const score = matchCount / queryWords.length;
      if (score > bestScore) { bestScore = score; bestLink = link; }
    }

    // Require at least 50 % word overlap, otherwise default to first result
    return bestScore >= 0.5 ? bestLink : links[0];
  }

  // ── PHASE 1: Wait for Maps to settle (place detail OR results list) ──────
  while (Date.now() - startTime < MAX_WAIT_MS) {
    // Check if Maps auto-navigated to a single place (detail panel loaded)
    if (document.querySelector('button[data-item-id^="phone:"]') ||
        document.querySelector('button[data-item-id="address"]') ||
        document.querySelector('[aria-label^="Phone:"]')) {
      // We're on a place detail page — extract phone immediately
      const phone = tryExtractPhone();
      if (phone) {
        chrome.runtime.sendMessage({ action: 'mapsPhoneResult', phone });
        return;
      }
      // Phone element present but not populated yet — keep polling
    }

    // Check if search results list has loaded
    const resultLinks = document.querySelectorAll('a.hfpxzc');
    if (resultLinks.length > 0) break; // → Phase 2

    await wait(POLL_MS);
  }

  // ── PHASE 2: Results list — find the best-matching hospital and click it ─
  const resultLinks = document.querySelectorAll('a.hfpxzc');

  // If still no results but we might already be on a place page, try once more
  if (resultLinks.length === 0) {
    const phone = tryExtractPhone();
    chrome.runtime.sendMessage({ action: 'mapsPhoneResult', phone: phone || '' });
    return;
  }

  const hospitalName  = getHospitalNameFromUrl();
  const targetLink    = findBestMatch(resultLinks, hospitalName);

  console.log(`[Encore Maps] Clicking: "${(targetLink.getAttribute('aria-label') || '').substring(0, 80)}"`);
  targetLink.click();

  // ── PHASE 3: Wait for the place detail panel to load ────────────────────
  const phase3Budget = Math.max(MAX_WAIT_MS - (Date.now() - startTime), 6000);
  const phase3End    = Date.now() + phase3Budget;

  while (Date.now() < phase3End) {
    await wait(POLL_MS);
    const phone = tryExtractPhone();
    if (phone) {
      chrome.runtime.sendMessage({ action: 'mapsPhoneResult', phone });
      return;
    }
  }

  // Timed out
  chrome.runtime.sendMessage({ action: 'mapsPhoneResult', phone: '' });
})();
