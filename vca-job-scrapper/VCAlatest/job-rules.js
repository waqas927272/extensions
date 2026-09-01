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

    return { getDescriptionBody, isReliefOnlyJob, normalizeJobTypeValue, extractJobType, normalizeUsPhone };
});
