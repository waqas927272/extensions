(function initializeAddressLookup(root, factory) {
    const validation = typeof module !== 'undefined' && module.exports
        ? require('./address-validation.js') : root.AAHAddressValidation;
    const api = factory(validation);
    root.AAHAddressLookup = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (a) => {
    function getContext(job) {
        const location = a.parseFilterLocation(job.location);
        const city = job.city || location.city;
        const state = job.state || location.state;
        return {
            hospitalName: String(job.hospital || '').trim(),
            originalHospitalName: String(job.hospital || '').trim(),
            location: [city, state].filter(Boolean).join(', '),
            city, state, streetAddress: job.streetAddress || '', zipCode: job.zipCode || '',
            searchable: !a.isMissingValue(city) && !!a.getStateAbbrev(state) && !a.isMissingValue(job.hospital)
        };
    }

    function buildSearchPlan(job) {
        const context = getContext(job);
        if (!context.searchable) return [];
        const location = `${context.city}, ${a.getStateAbbrev(context.state)}`;
        const plans = [];
        if (a.isUsableStreetAddress(job.streetAddress)) {
            plans.push({ stage: 'saved-address', query: [context.hospitalName,
                job.streetAddress, location, a.isValidZipCode(job.zipCode) ? job.zipCode : ''].filter(Boolean).join(', ') });
        }
        const names = [context.hospitalName,
            context.hospitalName.replace(/&/g, 'and').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim()];
        for (const name of new Set(names)) plans.push({ stage: 'hospital-name', query: `${name}, ${location}` });
        // Providers and records are awaited sequentially. Never fan out queries.
        return plans.flatMap(plan => ['search', 'maps'].map(provider => ({ ...plan, provider })));
    }

    function enoughData(result) {
        return a.isCompleteAddressResult(result) && !a.isMissingValue(result.phone) && !a.isMissingValue(result.website);
    }

    function conflicts(first, second) {
        return a.compareStreetAddresses(first.streetAddress, second.streetAddress, first.state).status === 'mismatch' ||
            (a.isValidZipCode(first.zipCode) && a.isValidZipCode(second.zipCode) && !a.zipCodesMatch(first.zipCode, second.zipCode));
    }

    async function lookup(job, providers) {
        const context = getContext(job);
        const attempts = [];
        if (!context.searchable) return { accepted: false, reason: 'missing-confirmed-location', result: null, attempts };
        let confirmed = null;
        let fallback = null;
        let ambiguous = false;
        const contacts = [];
        for (const plan of buildSearchPlan(job)) {
            let raw;
            const requestContext = { ...context, confirmedResult: confirmed || (!ambiguous && fallback) || null };
            try {
                raw = await providers[plan.provider](plan.query, requestContext);
            } catch (error) {
                attempts.push({ ...plan, accepted: false, reason: 'lookup-error', error: String(error.message || error) });
                continue;
            }
            const checked = a.validateGoogleResult(raw, requestContext);
            const attempt = { ...plan, accepted: checked.accepted, reason: checked.reason };
            attempts.push(attempt);
            if (!checked.accepted) continue;
            const candidate = { ...checked.result, sourceUrl: raw.sourceUrl || (plan.provider === 'maps'
                ? `https://www.google.com/maps/search/${encodeURIComponent(plan.query)}`
                : `https://www.google.com/search?q=${encodeURIComponent(plan.query)}`) };
            const sameSavedStreet = a.compareStreetAddresses(job.streetAddress, candidate.streetAddress, context.state).status === 'match';
            if (!a.isUsableStreetAddress(candidate.streetAddress)) {
                // Keep contact-only evidence until an address-bearing result can
                // bind it to the same hospital. Never use name/city alone.
                contacts.push({ candidate, attempt });
                attempt.accepted = false;
                attempt.reason = 'contact-identity-unconfirmed';
            } else {
                if (plan.stage === 'saved-address' && !sameSavedStreet) {
                    attempt.accepted = false;
                    attempt.reason = 'saved-street-not-confirmed';
                    continue;
                }
                if (confirmed) {
                    // A confirmed saved street wins over another branch in this city.
                    if (!sameSavedStreet || conflicts(confirmed, candidate)) {
                        attempt.accepted = false;
                        attempt.reason = 'confirmed-branch-conflict';
                        continue;
                    }
                    confirmed = a.chooseCompleteAddressResult(confirmed, candidate);
                } else if (sameSavedStreet) {
                    confirmed = candidate;
                } else if (fallback && conflicts(fallback, candidate)) {
                    ambiguous = true;
                    attempt.accepted = false;
                    attempt.reason = 'ambiguous-results';
                } else {
                    fallback = a.chooseCompleteAddressResult(fallback, candidate);
                }
            }
            let anchor = confirmed || (!ambiguous && fallback);
            if (anchor) {
                for (const contact of contacts) {
                    if (!a.sameContactEntity(anchor, contact.candidate)) continue;
                    anchor = a.chooseCompleteAddressResult(anchor, contact.candidate);
                    contact.attempt.accepted = true;
                    contact.attempt.reason = 'confirmed-hospital-contact';
                }
                if (confirmed) confirmed = anchor;
                else fallback = anchor;
            }
            const best = confirmed || (!ambiguous && fallback);
            if (best && enoughData(best)) break;
        }
        const result = confirmed || (!ambiguous && fallback);
        if (!result) return { accepted: false, reason: ambiguous ? 'ambiguous-results' : 'no-google-result', result: null, attempts };
        const checked = a.validateGoogleResult(result, context);
        return { ...checked, lookupStage: confirmed ? 'saved-address' : 'hospital-name', attempts };
    }

    return { getContext, buildSearchPlan, lookup };
});
