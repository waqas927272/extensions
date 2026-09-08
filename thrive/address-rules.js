'use strict';
// Shared by the worker and the Google reader. No network or DOM dependencies.
(() => {
  const states = 'AL:Alabama|AK:Alaska|AZ:Arizona|AR:Arkansas|CA:California|CO:Colorado|CT:Connecticut|DE:Delaware|FL:Florida|GA:Georgia|HI:Hawaii|ID:Idaho|IL:Illinois|IN:Indiana|IA:Iowa|KS:Kansas|KY:Kentucky|LA:Louisiana|ME:Maine|MD:Maryland|MA:Massachusetts|MI:Michigan|MN:Minnesota|MS:Mississippi|MO:Missouri|MT:Montana|NE:Nebraska|NV:Nevada|NH:New Hampshire|NJ:New Jersey|NM:New Mexico|NY:New York|NC:North Carolina|ND:North Dakota|OH:Ohio|OK:Oklahoma|OR:Oregon|PA:Pennsylvania|RI:Rhode Island|SC:South Carolina|SD:South Dakota|TN:Tennessee|TX:Texas|UT:Utah|VT:Vermont|VA:Virginia|WA:Washington|WV:West Virginia|WI:Wisconsin|WY:Wyoming|DC:District of Columbia|PR:Puerto Rico'.split('|').map(item => item.split(':'));
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const norm = value => clean(value).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  const stateName = value => states.find(([abbr, name]) => [abbr.toLowerCase(), name.toLowerCase()].includes(clean(value).toLowerCase()))?.[1] || '';
  const validZip = value => /^\d{5}(?:-\d{4})?$/.test(clean(value)) && !/^00000/.test(clean(value));
  const validStreet = value => /^\d+[a-z]?\s+\S+/i.test(clean(value));
  function parseLocality(value) {
    const match = clean(value).match(/\bin\s+([^,]+),\s*([A-Za-z .]+?)(?:\s*[·|]|$)/i);
    const state = stateName(match?.[2]);
    return match && state ? { city: clean(match[1]), state } : {};
  }
  function website(value) {
    try {
      let url = new URL(clean(value));
      if (url.hostname === 'www.google.com' && url.pathname === '/url') url = new URL(url.searchParams.get('q') || url.searchParams.get('url'));
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
      if (/(^|\.)(google\.com|googleadservices\.com|gstatic\.com)$/.test(url.hostname)) return '';
      return url.href;
    } catch { return ''; }
  }
  function location(job) {
    // The listing's location is authoritative; existing address fields may be wrong.
    let listing = clean(job.location);
    if (listing.includes(' / ')) {
      const primary = listing.split(' / ')[0].split(',').map(clean);
      if (primary.length !== 2 || norm(primary[0]) !== norm(job.city) || !stateName(primary[1]) || stateName(primary[1]) !== stateName(job.state)) return null;
      listing = listing.split(' / ')[0];
    }
    if (listing) {
      const parts = listing.split(',').map(clean);
      if (parts.length === 2 && stateName(parts[1])) return { city: parts[0], state: stateName(parts[1]) };
      if (parts.length === 3 && /^(?:USA|United States)$/i.test(parts[2]) && stateName(parts[1])) return { city: parts[0], state: stateName(parts[1]) };
      return null; // Never guess which city a multi-location or malformed label means.
    }
    const city = clean(job.jobviteSpecifics?.city || job.city);
    const state = stateName(job.jobviteSpecifics?.state || job.state);
    return city && state ? { city, state } : null;
  }
  function hospital(job) {
    const choices = [job.primaryHospital, job.hospital, job.jobviteSpecifics?.company].map(value => clean(value).split(' / ')[0]).filter(Boolean);
    return choices.find(value => !/^(?:thrive|thrive pet healthcare(?: parent client)?|multiple locations)$/.test(norm(value))) || choices[0] || '';
  }
  const genericNameWords = new Set('the and at of animal veterinary hospital hospitals clinic pet center centre llc inc group small healthcare vet thrive'.split(' '));
  const serviceNameWords = new Set('care specialty specialist emergency referral urgent medical'.split(' '));
  function stateWords(place) {
    const name = stateName(place?.state);
    const pair = states.find(([, full]) => full === name) || [];
    // A trailing abbreviation such as "- UT" is metadata; a full state word
    // such as "Texas" can be part of a hospital's actual brand.
    return new Set([norm(pair[0])].filter(Boolean));
  }
  function nameProfile(value, place) {
    const withoutAffiliation = clean(value).replace(/[,|–—-]?\s*(?:a\s+)?Thrive Pet Healthcare Partner\s*$/i, '').trim();
    const stateTokens = stateWords(place);
    const words = norm(withoutAffiliation).split(' ').filter(Boolean).map(word =>
      ({ specialists: 'specialist', specialties: 'specialty' })[word] || word);
    const core = words.filter(word => !genericNameWords.has(word) && !stateTokens.has(word));
    return { clean: withoutAffiliation, words, core, key: [...new Set(core)].sort().join(' '), compact: [...new Set(core)].sort().join('') };
  }
  function nameRelation(expected, actual, place) {
    if (!clean(expected) || !clean(actual)) return { matched: false, strong: false, needsBranchEvidence: false };
    const wanted = nameProfile(expected, place), found = nameProfile(actual, place);
    if (norm(wanted.clean) === norm(found.clean)) return { matched: true, strong: wanted.core.length >= 2, needsBranchEvidence: false };
    if (wanted.key && (wanted.key === found.key || wanted.compact === found.compact)) {
      return { matched: true, strong: wanted.core.length >= 2, needsBranchEvidence: false };
    }
    const wantedSet = new Set(wanted.core), foundSet = new Set(found.core);
    const common = [...wantedSet].filter(word => foundSet.has(word));
    const different = [...wantedSet, ...foundSet].filter(word => !wantedSet.has(word) || !foundSet.has(word));
    if (common.length >= 2 && different.every(word => serviceNameWords.has(word) || /^\d+(?:st|nd|rd|th)$/.test(word))) {
      return { matched: true, strong: true, needsBranchEvidence: false };
    }
    // Rebranded location-named hospitals can change every service descriptor.
    // The exact listing city remains compulsory for this weaker relationship.
    const placeTokens = new Set(norm(place?.city).split(' ').filter(Boolean));
    if (common.length && different.length && different.every(word => placeTokens.has(word))) {
      return { matched: true, strong: common.length >= 2, needsBranchEvidence: false };
    }
    if (common.length && common.every(word => placeTokens.has(word)) &&
        [...wantedSet, ...foundSet].filter(word => !placeTokens.has(word)).every(word => serviceNameWords.has(word))) {
      return { matched: true, strong: false, needsBranchEvidence: false };
    }
    // Google sometimes uses a shared group name for multiple branches. Allow the
    // panel to be opened, but require its official website URL to name the branch.
    const branch = wanted.clean.match(/\(([^)]+)\)\s*$/)?.[1] || '';
    const base = wanted.clean.replace(/\s*\([^)]+\)\s*$/, '');
    if (branch && norm(base) === norm(found.clean)) {
      return { matched: true, strong: false, needsBranchEvidence: true,
        branchWords: nameProfile(branch, place).core };
    }
    return { matched: false, strong: false, needsBranchEvidence: false };
  }
  function nameMatches(expected, actual, place) {
    return nameRelation(expected, actual, place).matched;
  }
  function candidateMatches(expected, actual, place, evidence = '') {
    const relation = nameRelation(expected, actual, place);
    if (!relation.matched) return false;
    if (!relation.needsBranchEvidence) return true;
    const haystack = norm(evidence);
    return !!relation.branchWords?.length && relation.branchWords.every(word => haystack.includes(word));
  }
  function matches(job, result) {
    const place = location(job);
    if (!place || place.state !== stateName(result.state)) return false;
    const relation = nameRelation(hospital(job), result.businessName, place);
    if (!relation.matched) return false;
    if (relation.needsBranchEvidence) {
      const evidence = norm(website(result.website) + ' ' + result.streetAddress);
      if (!relation.branchWords?.length || !relation.branchWords.every(word => evidence.includes(word))) return false;
    }
    const cityKey = value => norm(value).replace(/\s+/g, '');
    const addressCity = cityKey(place.city) === cityKey(result.city);
    const panelCity = cityKey(place.city) === cityKey(result.localityCity) &&
      place.state === stateName(result.localityState);
    const websiteWords = new Set(norm(website(result.website)).split(' '));
    const websiteCity = relation.strong && norm(place.city).split(' ').filter(Boolean).every(word => websiteWords.has(word));
    // A postal city may differ, but Google must explicitly identify the business
    // as being in the listing locality through its panel or official location URL.
    return addressCity || panelCity || websiteCity;
  }
  function complete(result) {
    const digits = clean(result.phone).replace(/\D/g, '');
    return validStreet(result.streetAddress) && !!clean(result.city) && !!stateName(result.state) && validZip(result.zipCode) &&
      /^(?:1)?\d{10}$/.test(digits) && !!website(result.website);
  }
  function parseAddress(value) {
    const full = clean(value).replace(/^Address:\s*/i, '').replace(/,?\s+(?:United States|USA)$/i, '');
    const match = full.match(/^(.+?),\s*([^,]+),\s*([^,]+?)\s+(\d{5}(?:-\d{4})?)$/);
    if (!match || !stateName(match[3])) return {};
    const streetParts = match[1].split(',').map(clean);
    const streetStart = streetParts.findIndex(validStreet);
    if (streetStart < 0) return {};
    return { streetAddress: streetParts.slice(streetStart).join(', '), city: match[2], state: stateName(match[3]), zipCode: match[4] };
  }
  const streetKey = value => norm(value).replace(/\b(street|avenue|boulevard|road|drive|lane|court|parkway|highway|suite)\b/g,
    word => ({ street: 'st', avenue: 'ave', boulevard: 'blvd', road: 'rd', drive: 'dr', lane: 'ln', court: 'ct', parkway: 'pkwy', highway: 'hwy', suite: 'ste' })[word]);
  function searches(job) {
    const place = location(job), name = hospital(job);
    if (!place || !name) return [];
    const queries = [];
    if (validStreet(job.streetAddress) && clean(job.city) && stateName(job.state) && validZip(job.zipCode)) {
      queries.push({ kind: 'address', query: [job.streetAddress, job.city, job.state, job.zipCode].join(', ') });
    }
    queries.push({ kind: 'hospital', query: [name, place.city, place.state].join(', ') });
    return queries.flatMap(search => [
      { ...search, url: 'https://www.google.com/maps/search/' + encodeURIComponent(search.query) },
      { ...search, url: 'https://www.google.com/search?q=' + encodeURIComponent(search.query) }
    ]);
  }
  function accept(job, result, search) {
    return matches(job, result) && complete(result) && (search.kind !== 'address' ||
      (streetKey(job.streetAddress) === streetKey(result.streetAddress) && clean(job.zipCode).slice(0, 5) === clean(result.zipCode).slice(0, 5)));
  }
  function apply(job, result) {
    const place = location(job);
    if (!result) return { ...job, city: clean(job.city) || clean(place?.city), state: clean(job.state) || place?.state || '',
      streetAddress: clean(job.streetAddress) || 'TBD', zipCode: clean(job.zipCode) || '00000' };
    return { ...job, streetAddress: clean(result.streetAddress), city: clean(place?.city || result.city), state: place?.state || stateName(result.state),
      zipCode: clean(result.zipCode), phone: clean(result.phone), website: website(result.website), cityMismatchFlag: false };
  }
  globalThis.ThriveAddressRules = { clean, norm, stateName, website, parseLocality, location, hospital, nameMatches, candidateMatches, matches, complete, parseAddress, searches, accept, apply };
  if (typeof module !== 'undefined') module.exports = globalThis.ThriveAddressRules;
})();
