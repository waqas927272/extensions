(function (root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.InnovetiveAddressUtils = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function normalizeValue(value) {
    return String(value || '').trim();
  }

  function isPlaceholderStreetAddress(value) {
    return /^(?:tbd|to be determined|unknown|n\/?a|not available|pending|-+)$/i.test(normalizeValue(value));
  }

  function isPlaceholderZipCode(value) {
    const zipCode = normalizeValue(value);
    return !zipCode || /^(?:0{5}(?:-0{4})?|tbd|unknown|n\/?a|pending|-+)$/i.test(zipCode);
  }

  function hasUsableAddress(data) {
    if (!data || isPlaceholderStreetAddress(data.streetAddress) || isPlaceholderZipCode(data.zipCode)) {
      return false;
    }

    return Boolean(normalizeValue(data.streetAddress) && /^\d{5}(?:-\d{4})?$/.test(normalizeValue(data.zipCode)));
  }

  function isIntentionalTbdAddress(job) {
    return /^tbd$/i.test(normalizeValue(job?.streetAddress)) && /^0{5}(?:-0{4})?$/.test(normalizeValue(job?.zipCode));
  }

  function buildUniqueAddressQueue(jobs, getIdentity) {
    const groups = new Map();

    (jobs || []).forEach((job, index) => {
      const identity = normalizeValue(getIdentity(job, index));
      if (!identity) return;

      const group = groups.get(identity) || { job, index, allIntentionalTbd: true };
      group.allIntentionalTbd = group.allIntentionalTbd && isIntentionalTbdAddress(job);
      groups.set(identity, group);
    });

    const queue = [];
    let skippedTbdCount = 0;
    groups.forEach(group => {
      if (group.allIntentionalTbd) skippedTbdCount++;
      else queue.push({ job: group.job, index: group.index });
    });

    return { queue, skippedTbdCount };
  }

  function mergeFetchedAddress(existingJob, fetchedAddress, expectedLocation = {}) {
    if (!hasUsableAddress(fetchedAddress)) {
      return { ...existingJob };
    }

    return {
      ...existingJob,
      streetAddress: normalizeValue(fetchedAddress.streetAddress),
      city: normalizeValue(expectedLocation.city) || normalizeValue(fetchedAddress.city) || normalizeValue(existingJob?.city),
      state: normalizeValue(expectedLocation.state) || normalizeValue(fetchedAddress.state) || normalizeValue(existingJob?.state),
      zipCode: normalizeValue(fetchedAddress.zipCode),
      phone: normalizeValue(fetchedAddress.phone) || normalizeValue(existingJob?.phone),
      website: normalizeValue(fetchedAddress.website) || normalizeValue(existingJob?.website)
    };
  }

  return {
    buildUniqueAddressQueue,
    hasUsableAddress,
    isIntentionalTbdAddress,
    isPlaceholderStreetAddress,
    isPlaceholderZipCode,
    mergeFetchedAddress
  };
});
