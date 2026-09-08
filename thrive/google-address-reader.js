'use strict';
// Read one Google business panel. Never mix organic results or other businesses.
(() => {
  const rules = globalThis.ThriveAddressRules;
  const target = globalThis.__thriveAddressTarget;
  if (!rules || !target) return { error: 'Missing lookup target' };
  const read = node => rules.clean(node?.getAttribute('aria-label') || node?.textContent);
  const visible = node => !!node && node.getClientRects().length > 0;
  const pick = (root, selectors) => {
    for (const selector of selectors) {
      const element = [...root.querySelectorAll(selector)].find(visible);
      if (element) return element;
    }
    return null;
  };
  if (document.querySelector('form[action*="/sorry/"], iframe[src*="recaptcha"]') || location.pathname.startsWith('/sorry')) return { blocked: true };
  const maps = location.pathname.startsWith('/maps');
  const roots = maps ? [...document.querySelectorAll('[role="main"]')] :
    [...document.querySelectorAll('#rhs, [role="complementary"], .kp-wholepage')];
  let incomplete = null;
  for (const root of roots.filter(visible)) {
    const heading = pick(root, maps ? ['h1.DUwDvf', 'h1'] : ['[data-attrid="title"]', '.SPZz6b h2', 'h2[data-dtype]', 'h2']);
    const businessName = rules.clean(heading?.textContent);
    if (!rules.nameMatches(target.hospital, businessName, target.location)) continue;
    const addressElement = pick(root, ['[data-item-id="address"]', '[data-attrid*="address"]', '[aria-label^="Address:"]']);
    const addressText = read(addressElement).replace(/^Address:\s*/i, '').replace(/^Address\s*/i, '').trim();
    const phoneElement = pick(root, ['[data-item-id^="phone:tel:"]', '[data-attrid*="phone"]', '[aria-label^="Phone:"]', 'a[href^="tel:"]']);
    const phone = rules.clean(phoneElement?.getAttribute('href')?.replace(/^tel:/, '') ||
      phoneElement?.getAttribute('data-item-id')?.replace(/^phone:tel:/, '') || read(phoneElement)).replace(/^(?:Phone|Call):?\s*/i, '');
    const sites = [...root.querySelectorAll('a[href]')].filter(link => visible(link) && rules.website(link.href));
    const site = sites.find(link => link.getAttribute('data-item-id') === 'authority') ||
      sites.find(link => /\bwebsite\b/i.test(read(link))) ||
      sites.find(link => /\b(?:book online|book appointment|make an appointment|schedule appointment)\b/i.test(read(link)));
    const locality = [...root.querySelectorAll('div, span, button')].filter(visible)
      .map(read).filter(value => value.length <= 160).map(rules.parseLocality).find(value => value.city) || {};
    const result = { businessName, ...rules.parseAddress(addressText),
      localityCity: locality.city || '', localityState: locality.state || '',
      phone, website: rules.website(site?.href) };
    if (rules.complete(result)) return result;
    incomplete = result;
  }
  if (incomplete) return incomplete;
  if (maps) {
    // Maps loads panels asynchronously. Do not burn through all candidate links
    // while the previously selected hospital is still loading.
    if (Date.now() - (globalThis.__thriveAddressClickedAt || 0) < 5000) return {};
    // Opening a result panel does not activate the browser tab.
    const links = [...document.querySelectorAll('a.hfpxzc')].filter(link => {
      if (!visible(link)) return false;
      const card = link.closest('.Nv2PK, [role="article"]') || link.parentElement;
      const evidence = read(card) + ' ' + [...(card?.querySelectorAll('a[href]') || [])].map(item => item.href).join(' ');
      return rules.candidateMatches(target.hospital, link.getAttribute('aria-label'), target.location, evidence);
    });
    const visited = globalThis.__thriveAddressVisited || (globalThis.__thriveAddressVisited = new Set());
    const match = links.find(link => !visited.has(link.href));
    if (match) {
      visited.add(match.href);
      globalThis.__thriveAddressClickedAt = Date.now();
      // Return the exact candidate URL to the worker. Calling click() here can
      // be intercepted by a sponsored card that Google inserts concurrently.
      return { candidateUrl: match.href };
    }
  }
  return {};
})();
