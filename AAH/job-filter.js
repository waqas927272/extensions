(function initializeJobFilter(root) {
    const excludedHospitals = new Set([
        'alliance animal health',
        'alliance animal health - central support team'
    ]);

    function isExcludedHospital(name) {
        const normalized = String(name || '').trim().toLowerCase()
            .replace(/\s+/g, ' ')
            .replace(/\s*[-–—]\s*/g, ' - ');
        return excludedHospitals.has(normalized);
    }

    function filterJobs(jobs) {
        // Match the hospital field only; the aggregator is shared by valid jobs.
        return jobs.filter(job => !isExcludedHospital(job.hospital));
    }

    const api = { isExcludedHospital, filterJobs };
    root.AAHJobFilter = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
