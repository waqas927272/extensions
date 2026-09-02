(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.VcaJobRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    function getDescriptionBody(description) {
        const source = String(description || '').replace(/\r\n?/g, '\n');
        const marker = '=== JOB DESCRIPTION ===';
        const index = source.lastIndexOf(marker);
        return (index >= 0 ? source.slice(index + marker.length) : source).trim();
    }

    function isReliefOnlyJob(title, description) {
        const titleText = String(title || '').replace(/\s+/g, ' ').trim();
        if (/\b(?:relief|per[\s-]?diem|locum(?:s)?)\b/i.test(titleText)) return true;

        const body = getDescriptionBody(description);
        if (!body) return false;
        const opening = body.slice(0, 1800).replace(/\s+/g, ' ').trim();

        // Require an explicit recruiting statement for a relief-only role. Do
        // not remove permanent jobs whose schedules merely say "Relief possible"
        // or that mention a relief colleague.
        const recruitingSignal = /\b(?:we(?:'re|\s+are)?\s+(?:seeking|hiring|looking\s+for)|(?:is|are)\s+seeking|seeking|hiring|looking\s+for|join\s+us\s+as|position(?:\s+is)?(?:\s+for)?|opportunity(?:\s+is)?(?:\s+for)?)\b[\s\S]{0,140}\b(?:experienced\s+)?(?:emergency\s+|associate\s+|specialty\s+|veterinary\s+)?(?:relief|per[\s-]?diem|locum(?:s)?)\s+(?:veterinarian|specialist|surgeon|doctor|dvm)\b/i;
        const directRoleOpening = /^(?:we\s+need\s+an?\s+)?(?:experienced\s+)?(?:emergency\s+|associate\s+|specialty\s+|veterinary\s+)?(?:relief|per[\s-]?diem|locum(?:s)?)\s+(?:veterinarian|specialist|surgeon|doctor|dvm)\b/i;
        const perDiemTeamRecruiting = /\b(?:seeking|hiring|looking\s+for)\b[\s\S]{0,180}\bper[\s-]?diem\s+veterinarian\s+team\b/i;

        return recruitingSignal.test(opening) || directRoleOpening.test(opening) || perDiemTeamRecruiting.test(opening);
    }

    function normalizeJobTypeValue(value) {
        const text = String(value || '').replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
        const hasPartTime = /\bpart\s*time\b/i.test(text);
        const hasFullTime = /\bfull\s*time\b/i.test(text);
        return hasPartTime && !hasFullTime ? 'Part time' : 'Full time';
    }

    function extractJobType(description) {
        const scheduleSignals = String(description || '')
            .replace(/\r\n?/g, '\n')
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
            .filter(line => /\b(?:full|part)[\s_-]*time\b/i.test(line))
            .filter(line => !/\b(?:eligible\s+full[\s-]*time\s+(?:employees|associates)|benefits?\s+(?:for|available\s+to)\s+full[\s-]*time|full[\s-]*time\s+(?:employee|associate)\s+benefits?)\b/i.test(line));
        return normalizeJobTypeValue(scheduleSignals.join('\n'));
    }

    function normalizeUsPhone(value) {
        const raw = String(value || '').trim();
        if (!raw) return '';
        let digits = raw.replace(/\D/g, '');
        if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
        if (digits.length !== 10) return raw;
        return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
    }

    function normalizeIdentity(value) {
        return String(value || '')
            .replace(/&/g, ' and ')
            .replace(/[^a-z0-9]+/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    // A corporate search-result title is not a hospital identity. Treating a
    // title such as "VCA Animal Hospitals: World-Class Veterinary Care" as a
    // facility can combine it with an unrelated local knowledge-panel address.
    function isGenericVcaOrganizationName(value) {
        const clean = String(value || '').replace(/\s+/g, ' ').trim();
        if (!clean) return false;
        if (/^VCA(?:\s+Animal\s+Hospitals?)?$/i.test(clean)) return true;
        if (/^VCA\s+Animal\s+Hospitals?\s*[:|\-–—]\s*(?:World[-\s]+Class\s+Veterinary\s+Care|Veterinary\s+Care|Home|Careers?)\s*$/i.test(clean)) return true;
        return /\bVCA\s+Animal\s+Hospitals?\b[\s:|\-–—]*\bWorld[-\s]+Class\s+Veterinary\s+Care\b/i.test(clean);
    }

    function isVcaWebsite(value) {
        try {
            const url = new URL(value || '');
            if (!/^https?:$/.test(url.protocol)) return false;
            const host = url.hostname.replace(/^www\./i, '').toLowerCase();
            return host === 'vcahospitals.com' || host.endsWith('.vcahospitals.com') ||
                host === 'vca.com' || host.endsWith('.vca.com');
        } catch (_) {
            return false;
        }
    }

    function isConfirmedVcaAddressResult(addressData) {
        if (!addressData || addressData.permanentlyClosed === true) return false;
        const businessName = String(addressData.businessName || addressData.hospitalName || '').trim();
        const website = String(addressData.website || '').trim();
        // A VCA-looking title on an old directory/search snippet is not proof.
        // Require an official facility URL or a directly inspected business panel.
        if (website && website !== '-') {
            if (!isVcaWebsite(website)) return false;
            const path = new URL(website).pathname.replace(/^\/+|\/+$/g, '');
            return !!path && !/^(?:find-a-hospital|about-us|careers|know-your-pet)(?:\/|$)/i.test(path);
        }
        return /^VCA\b/i.test(businessName) && !isGenericVcaOrganizationName(businessName) &&
            /^(?:google_maps_place|google_knowledge_panel)$/.test(addressData.source || '');
    }

    // Keep a result atomic. Combining the name from one card with another
    // card's street/contact fields can silently assign a competitor's address.
    function chooseAddressCandidate(primary = {}, secondary = {}) {
        const score = data => {
            if (data.permanentlyClosed === true) return -1;
            return (data.streetAddress && data.zipCode && data.city && data.state ? 100 : 0) +
                (data.verifiedOfficial === true ? 50 : 0) +
                (data.businessName ? 8 : 0) + (data.website ? 4 : 0) + (data.phone ? 2 : 0);
        };
        return { ...(score(secondary) > score(primary) ? secondary : primary) };
    }

    function getSplitSourceIdentity(job) {
        return String(job?.sourceJobId || job?.originalJobId || '')
            .replace(/-(?:loc\d+|[A-Z]+)$/i, '')
            .trim();
    }

    function isOfficiallyResolvedSplitJob(job) {
        const isSplit = !!job?.isMultiLocationSplit || !!job?.sourceLink || /-(?:loc\d+|[A-Z]+)$/i.test(job?.jobId || job?.departmentId || '');
        const isOfficial = job?.addressVerified === true &&
            (job?.addressSource === 'official-vca-directory' || job?.addressConfidence === 'Official');
        return isSplit && isOfficial && !!getSplitSourceIdentity(job);
    }

    // Multi-location jobs remain separate. Collapse only rows from the same
    // source job after the official directory proves they became the exact same
    // hospital, advertised title/position, physical location and address.
    function collapseVerifiedOfficialSplitDuplicates(inputJobs) {
        const jobs = Array.isArray(inputJobs) ? inputJobs : [];
        const seen = new Map();
        const kept = [];
        const removedJobIds = [];

        for (const job of jobs) {
            if (!isOfficiallyResolvedSplitJob(job)) {
                kept.push(job);
                continue;
            }

            const hospital = normalizeIdentity(job.hospital || job.hospitalName || '');
            const location = normalizeIdentity(job.location || [job.city, job.state].filter(Boolean).join(', '));
            const street = normalizeIdentity(job.streetAddress || job.address || '');
            const zip = String(job.zipCode || '').replace(/\D/g, '').slice(0, 5);
            const title = normalizeIdentity(job.title || '');
            const position = normalizeIdentity(job.position || '');
            const source = normalizeIdentity(getSplitSourceIdentity(job));
            const link = normalizeIdentity(job.link || job.url || job.sourceLink || '');

            if (!hospital || !location || !street || !zip || !title || !position) {
                kept.push(job);
                continue;
            }

            const key = [source, link, hospital, location, street, zip, title, position].join('|');
            if (!seen.has(key)) {
                seen.set(key, job);
                kept.push(job);
                continue;
            }

            removedJobIds.push(job.jobId || job.departmentId || '');
        }

        return { jobs: kept, removedJobIds };
    }

    return {
        getDescriptionBody,
        isReliefOnlyJob,
        normalizeJobTypeValue,
        extractJobType,
        normalizeUsPhone,
        isGenericVcaOrganizationName,
        isVcaWebsite,
        isConfirmedVcaAddressResult,
        chooseAddressCandidate,
        collapseVerifiedOfficialSplitDuplicates
    };
});
