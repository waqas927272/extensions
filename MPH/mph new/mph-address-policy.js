(function (root, factory) {
    const api = factory(root?.MphAddressQuality || (typeof require === 'function' ? require('./mph-address-quality.js') : null));
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.MphAddressPolicy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (quality) => {
    const RESULTS = Object.freeze({
        VERIFIED_MAPS: 'Verified using Google Maps',
        VERIFIED_DESCRIPTION_MAPS: 'Verified using description address + Google Maps',
        VERIFIED_SEARCH: 'Verified using Google Search',
        VERIFIED_DESCRIPTION_SEARCH: 'Verified using description address + Google Search',
        VERIFIED_OFFICIAL_DIRECTORY: 'Verified using official hospital directory',
        DESCRIPTION_ONLY: 'Address from description; Google listing unavailable',
        NO_SPECIFIC_HOSPITAL: 'No specific hospital branch identified',
        NO_VERIFIED_LISTING: 'No verified Google listing found',
        REJECTED_STATE: 'Google result rejected because state did not match',
        REJECTED_CITY: 'Google result rejected because city did not match',
        REJECTED_HOSPITAL: 'Google result rejected because hospital did not match',
        REJECTED_DESCRIPTION_ADDRESS: 'Google result rejected because description address did not match'
    });

    function isPlaceholder(value) {
        return /^(?:|\-|TBD|Not Available|00000)$/i.test(String(value || '').trim());
    }

    function isMissionParentName(value) {
        return /^mission pet health(?:\s*\(parent client\))?$/i.test(String(value || '').trim());
    }

    function extractSpecificHospitalFromDescription(text) {
        const source = String(text || '');
        if (!source) return '';
        const nameWord = "[A-Z][A-Za-z0-9’'&.,()\\-]*";
        const facilitySuffix = '(?:Animal[ \\t]+Hospital|Veterinary[ \\t]+(?:Hospital|Clinic|Center|Centre|Care|Specialists?)|Pet[ \\t]+(?:Hospital|Clinic|Care)|Emergency[ \\t]+(?:Hospital|Clinic|Center)|Specialty[ \\t]+(?:Hospital|Clinic|Center)|Cardiac[ \\t]+Care)';
        const facilityWords = `${nameWord}(?:[ \\t]+${nameWord}){0,8}[ \\t]+${facilitySuffix}`;
        const metadata = source.match(/^\s*(?:Hiring Organization|Practice Name|Practice|Site|Facility|Hospital|Hospital Name|Job Site):\s*(.+)$/im);
        const metadataCandidate = metadata?.[1]?.replace(/\s+/g, ' ').trim() || '';
        if (metadataCandidate && !isMissionParentName(metadataCandidate)
            && new RegExp(`\\b${facilityWords}\\b`, 'i').test(metadataCandidate)) {
            return metadataCandidate;
        }

        const narrativePatterns = [
            new RegExp(`\\b(${facilityWords})\\s+(?:is|are)\\s+(?:seeking|searching|looking|hiring)\\b`, 'i'),
            new RegExp(`\\b(?:join|work|practice|position)[^.\\n]{0,60}?\\bat\\s+(${facilityWords})\\b`, 'i')
        ];
        for (const pattern of narrativePatterns) {
            const candidate = source.match(pattern)?.[1]?.replace(/\s+/g, ' ').trim() || '';
            if (candidate && !isMissionParentName(candidate)) return candidate;
        }
        return '';
    }

    function valueOrDash(value) {
        return isPlaceholder(value) ? '-' : String(value).trim();
    }

    function streetOrTbd(value) {
        return isPlaceholder(value) ? 'TBD' : String(value).trim();
    }

    function zipOrZeros(value) {
        return isPlaceholder(value) ? '00000' : String(value).trim();
    }

    function normalizeLegacyRecord(job) {
        if (!job) return job;
        job.streetAddress = streetOrTbd(job.streetAddress);
        job.zipCode = zipOrZeros(job.zipCode);
        job.phone = valueOrDash(job.phone);
        job.website = valueOrDash(job.website);
        return job;
    }

    function applyVerifiedGoogleResult(job, addressData, resultLabel = RESULTS.VERIFIED_MAPS) {
        if (!job) return job;
        const preserveKnownUnit = quality?.streetAddressesMatch(job.streetAddress, addressData?.streetAddress)
            && String(job.zipCode || '').slice(0, 5) === String(addressData?.zipCode || '').slice(0, 5)
            && quality.isStreetEnrichment(addressData?.streetAddress, job.streetAddress);
        job.streetAddress = streetOrTbd(preserveKnownUnit ? job.streetAddress : addressData?.streetAddress);
        job.zipCode = zipOrZeros(addressData?.zipCode);
        job.phone = valueOrDash(addressData?.phone);
        job.website = valueOrDash(addressData?.website);
        job.addressResult = resultLabel;
        job.addressVerified = true;
        job.addressConflict = '';
        job.addressSource = {
            businessName: addressData?.businessName || '',
            city: addressData?.city || '', state: addressData?.state || '',
            streetAddress: job.streetAddress, zipCode: job.zipCode,
            sourceType: addressData?.sourceType || '', sourceUrl: addressData?.sourceUrl || addressData?.website || '',
            contactSourceUrl: addressData?.contactSourceUrl || ''
        };
        return job;
    }

    function hasCompleteStoredAddress(job) {
        return !!(
            job &&
            !isPlaceholder(job.streetAddress) &&
            !isPlaceholder(job.zipCode) && /^\d{5}(?:-\d{4})?$/.test(String(job.zipCode).trim())
        );
    }

    function applyVerifiedGoogleResultUsingExistingAddress(
        job,
        addressData,
        resultLabel = RESULTS.VERIFIED_MAPS
    ) {
        if (!job) return job;

        // Contacts may be attached to a stored address only after the street and
        // ZIP match. A verified correction replaces the complete bundle instead
        // of attaching a new branch's contacts to an old address.
        if (hasCompleteStoredAddress(job) && quality?.streetAddressesMatch(job.streetAddress, addressData?.streetAddress)
            && String(job.zipCode).slice(0, 5) === String(addressData?.zipCode || '').slice(0, 5)
            && !quality.isStreetEnrichment(job.streetAddress, addressData?.streetAddress)) {
            return applyVerifiedGoogleResult(job, { ...addressData, streetAddress: job.streetAddress, zipCode: job.zipCode }, resultLabel);
        }
        return applyVerifiedGoogleResult(job, addressData, resultLabel);
    }

    function applyDescriptionAddressWithVerifiedContacts(
        job,
        descriptionAddress,
        addressData,
        resultLabel = RESULTS.VERIFIED_DESCRIPTION_MAPS
    ) {
        if (!job) return job;
        job.streetAddress = streetOrTbd(descriptionAddress?.streetAddress);
        job.zipCode = zipOrZeros(descriptionAddress?.zipCode);
        job.phone = valueOrDash(addressData?.phone);
        job.website = valueOrDash(addressData?.website);
        job.addressResult = resultLabel;
        return job;
    }

    function applyUnverifiedResult(job, descriptionAddress, reason = RESULTS.NO_VERIFIED_LISTING) {
        if (!job) return job;
        job.addressVerified = false;
        if (job.addressConflict) {
            job.streetAddress = 'TBD'; job.zipCode = '00000';
            job.phone = '-'; job.website = '-';
            job.addressResult = reason;
            return job;
        }
        if (hasCompleteStoredAddress(job)) {
            // Preserve the uncontradicted address, not unverified old contacts.
            job.phone = '-';
            job.website = '-';
            job.addressResult = reason;
            return job;
        }
        const hasDescriptionStreet = !isPlaceholder(descriptionAddress?.streetAddress);
        const hasDescriptionZip = !isPlaceholder(descriptionAddress?.zipCode);
        const hasDescriptionAddress = hasDescriptionStreet && hasDescriptionZip;
        // A partial address must not look verified in the export. Preserve a
        // description address only when its street and ZIP are both available.
        job.streetAddress = hasDescriptionAddress ? String(descriptionAddress.streetAddress).trim() : 'TBD';
        job.zipCode = hasDescriptionAddress ? String(descriptionAddress.zipCode).trim() : '00000';
        job.phone = '-';
        job.website = '-';
        job.addressResult = hasDescriptionAddress ? RESULTS.DESCRIPTION_ONLY : reason;
        return job;
    }

    function applyNoSpecificHospital(job) {
        if (!job) return job;
        job.streetAddress = 'TBD';
        job.zipCode = '00000';
        job.phone = '-';
        job.website = '-';
        job.addressResult = RESULTS.NO_SPECIFIC_HOSPITAL;
        job.addressVerified = false;
        return job;
    }

    function invalidateConflictingAddress(job, reason) {
        if (!job) return;
        if (hasCompleteStoredAddress(job) && !job.addressConflict) {
            job.previousAddress = { streetAddress: job.streetAddress, zipCode: job.zipCode,
                city: job.city, state: job.state, phone: job.phone, website: job.website };
        }
        job.addressConflict = reason;
        applyUnverifiedResult(job, null, reason);
    }

    function lookupSignature(job) {
        return [job?.hospital, job?.location || [job?.city, job?.state].filter(Boolean).join(', '),
            job?.descriptionAddress?.streetAddress, job?.descriptionAddress?.zipCode]
            .map(value => quality?.normalizeAddressCacheValue(value || '') || String(value || '').trim().toLowerCase()).join('|');
    }

    function isLookupComplete(job, version) {
        return job?.addressLookupVersion === version && job?.addressLookupSignature === lookupSignature(job)
            && job?.addressVerified === true && !job?.addressConflict && hasCompleteStoredAddress(job);
    }

    function recordLookupAttempt(job, version, verified) {
        job.addressLastAttemptAt = new Date().toISOString();
        job.addressLookupVersion = verified ? version : '';
        job.addressLookupSignature = verified ? lookupSignature(job) : '';
        job.addressVerified = verified === true;
    }

    function rejectionResult(validationReason) {
        switch (validationReason) {
            case 'state-mismatch':
            case 'zip-state-mismatch':
                return RESULTS.REJECTED_STATE;
            case 'city-and-hospital-mismatch':
                return RESULTS.REJECTED_CITY;
            case 'hospital-identity-mismatch':
            case 'not-a-verified-veterinary-facility':
                return RESULTS.REJECTED_HOSPITAL;
            case 'description-street-mismatch':
            case 'description-zip-mismatch':
                return RESULTS.REJECTED_DESCRIPTION_ADDRESS;
            default:
                return RESULTS.NO_VERIFIED_LISTING;
        }
    }

    return {
        RESULTS,
        applyDescriptionAddressWithVerifiedContacts,
        applyNoSpecificHospital,
        applyUnverifiedResult,
        applyVerifiedGoogleResult,
        applyVerifiedGoogleResultUsingExistingAddress,
        extractSpecificHospitalFromDescription,
        hasCompleteStoredAddress,
        isMissionParentName,
        invalidateConflictingAddress,
        isLookupComplete,
        lookupSignature,
        recordLookupAttempt,
        isPlaceholder,
        normalizeLegacyRecord,
        rejectionResult,
        streetOrTbd,
        valueOrDash,
        zipOrZeros
    };
});
