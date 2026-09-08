'use strict';

// Pure rules shared by the Records page and regression tests. No job IDs or
// hospital-specific corrections: values must be supported by the description.
(function (root) {
    const normalize = value => String(value || '').normalize('NFKC')
        .replace(/[\u2010-\u2014\u2212]/g, '-').replace(/[‘’]/g, "'");
    const linesOf = value => normalize(value).split(/\r?\n/).map(line => line.trim()).filter(Boolean);

    function salaryCandidate(text) {
        const unit = String.raw`(?:\/\s*(?:year|yr|hour|hr|month|mo|day)|per\s+(?:year|hour|month|day)|annually|annual|yearly|hourly)`;
        const amounts = new RegExp(String.raw`\$\s*(?<min>\d[\d,]*(?:\.\d+)?)\s*(?<minK>\/?k)?\s*(?<unit1>${unit})?(?:\s*-?\s*to\s*|\s*-\s*)(?:\$\s*)?(?<max>\d[\d,]*(?:\.\d+)?)\s*(?<maxK>\/?k)?\s*(?<unit2>${unit})?|\$\s*(?<single>\d[\d,]*(?:\.\d+)?)\s*(?<singleK>\/?k)?\+?\s*(?<singleUnit>${unit})?`, 'gi');
        const compensation = /\b(?:salary|salaries|pay|compensation|prosal|earnings?|earning|earn)\b/gi;
        const otherMoney = /\b(?:sign(?:ing|[ -]?on)?\s*bonus|bonus|SOB|relocation|insurance|tuition|loan|stipend|exam\s+fee|equipment|reimbursement)\b/gi;
        const candidates = [];
        // Sentence boundaries preserve decimals and keep unrelated benefits apart.
        for (const line of linesOf(text)) {
            for (const sentence of line.split(/(?<=[.!?;])\s+(?=[A-Z])/)) {
                for (const match of sentence.matchAll(amounts)) {
                    const before = sentence.slice(0, match.index);
                    const after = sentence.slice(match.index + match[0].length);
                    const payCues = [...before.matchAll(compensation)];
                    const otherCues = [...before.matchAll(otherMoney)];
                    const lastPay = payCues.at(-1)?.index ?? -1;
                    const lastOther = otherCues.at(-1)?.index ?? -1;
                    // A bonus immediately following the amount is also explicit,
                    // e.g. "$50K sign-on bonus"; later clauses don't relabel salary.
                    if (/^\s*(?:sign(?:ing|[ -]?on)?\s*bonus|SOB\b|relocation|(?:annual\s+)?(?:bonus|stipend)|life\s+insurance)/i.test(after)) continue;
                    if (lastOther > lastPay && !/\b(?:base\s+salary|salary\s+range|(?:full|part)[ -]?time\s+(?:salary\s+)?range)\b/i.test(before.slice(lastOther))) continue;
                    const suffixPay = /^\s*(?:base\s+)?(?:salary|pay|compensation)\b/i.test(after);
                    const g = match.groups;
                    const period = g.unit2 || g.unit1 || g.singleUnit || '';
                    if (lastPay < 0 && !suffixPay && !period && !/^\s*(?:annual\s+)?base\s*$/i.test(before)) continue;
                    const rawMin = g.min || g.single;
                    const hasK = !!(g.minK || g.maxK || g.singleK);
                    const value = raw => Number(raw.replace(/,/g, '')) * (hasK && Number(raw.replace(/,/g, '')) < 1000 ? 1000 : 1);
                    const min = value(rawMin);
                    const max = g.max ? value(g.max) : null;
                    if (!Number.isFinite(min) || min <= 0 || (max !== null && (!Number.isFinite(max) || max < min))) continue;
                    const unitText = /hour|hr/i.test(period) ? 'per hour' : /month|mo\b/i.test(period) ? 'per month' : /day/i.test(period) ? 'per day' : 'per year';
                    const money = number => '$' + number.toLocaleString('en-US', { maximumFractionDigits: 2 });
                    const minimum = /\b(?:starting\s+at|starts?\s+at|from|minimum|at least)\s*$/i.test(before) || /\+/.test(match[0]);
                    const formatted = max !== null ? money(min) + '–' + money(max) : money(min) + (minimum ? '+' : '');
                    // Prefer explicit base pay/ranges to earnings claims and floors.
                    const score = (lastPay >= 0 || suffixPay ? 10 : 0) + (max !== null ? 4 : 0) +
                        (/\bbase\s+salary\b/i.test(before + after) ? 3 : 0);
                    candidates.push({ score, value: formatted + ' ' + unitText });
                }
            }
        }
        return candidates.sort((a, b) => b.score - a.score)[0] || null;
    }

    function extractSalary(text) {
        return salaryCandidate(text)?.value || '';
    }

    function extractJobType(text) {
        const source = normalize(text);
        const full = /\bfull[ _-]?time\b/i.test(source);
        const part = /\bpart[ _-]?time\b/i.test(source);
        // Job type is a required two-value field. Full Time is the default and
        // wins whenever the description offers or mentions both schedules.
        return part && !full ? 'Part Time' : 'Full Time';
    }

    function extractExperience(text) {
        const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
            'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
        const candidates = [];
        for (const raw of linesOf(text)) {
            if (!/\bexperience\b/i.test(raw)) continue;
            if (/^(?:our team|we have|we are a)\b|\b(?:has over|have over|serving|founded|established|combined|collective)\b/i.test(raw)) continue;
            const line = raw.replace(new RegExp('\\b(' + words.join('|') + ')\\b', 'gi'), word => String(words.indexOf(word.toLowerCase())));
            const match = line.match(/\b(?:(minimum(?:\s+of)?|at least|more than|over)\s+)?(\d+(?:\.\d+)?)(?:\s*(?:-|to)\s*(\d+(?:\.\d+)?))?\s*(\+|or more)?\s*(?:years?|yrs?\.?)'?\s+(?:of\s+)?(?:(?:clinical|veterinary|practice|professional|relevant|related|work|hands-on|small[ -]animal|general[ -]practice)\s+){0,5}experience\b/i) ||
                line.match(/\bexperience\s*(?:required|of|must be|should be|is|requires)?\s*[:=-]?\s*(?:(minimum(?:\s+of)?|at least|more than|over)\s+)?(\d+(?:\.\d+)?)(?:\s*(?:-|to)\s*(\d+(?:\.\d+)?))?\s*(\+|or more)?\s*(?:years?|yrs?\.?)\b/i);
            if (!match) continue;
            const [, minimum, low, high, plus] = match;
            if (Number(low) > 60 || (high && (Number(high) < Number(low) || Number(high) > 60))) continue;
            const count = high ? low + '-' + high : low + (minimum || plus ? '+' : '');
            const preferred = /\b(?:preferred|recommended|ideally|ideal)\b/i.test(line) && !/\brequired\b/i.test(line.replace(/not required/gi, ''));
            candidates.push({ score: preferred ? 0 : 1, value: count + (count === '1' ? ' year' : ' years') + (preferred ? ' (preferred)' : '') });
        }
        return candidates.sort((a, b) => b.score - a.score)[0]?.value || '';
    }

    function isStreetAddress(value) {
        const street = normalize(value).trim();
        return /^(?:TBD|Not Found \(TBD\))$/i.test(street) || /^P\.?\s*O\.?\s+Box\s+\d+\b/i.test(street) ||
            /^\d+[A-Z]?(?:-\d+)?\s+[A-Z][A-Za-z\d .,'#/-]+$/i.test(street) &&
            !/\b(?:hospital|clinic|years?|experience|salary|bonus|square[ -]feet)\b/i.test(street);
    }

    function isGenericHospital(value) {
        return !value || /^(?:Thrive(?: Pet Healthcare)?|Alliance Animal Health|United Veterinary Care)(?:\s*\(Parent Client\))?$/i.test(String(value).trim());
    }

    function extractHospital(text) {
        const lines = linesOf(text);
        function clean(value) {
            return String(value || '').replace(/^At\s+/i, '').replace(/,?\s*\(?a (?:partner of|Thrive Pet Healthcare)[\s\S]*$/i, '')
                .replace(/\s+team$/i, '').replace(/[.,!;:]+$/, '').trim();
        }
        function valid(value) {
            return /^[A-Z]/.test(value) && value.length <= 160 && !isGenericHospital(value) &&
                /\b(?:hospital|clinic|center|veterinary|animal|pet|Thrive|PriorityPet)\b/i.test(value) &&
                !/^(?:Our|The role|We|You|Come|Join|Learn)\b/i.test(value);
        }
        const patterns = [
            /^(?:Hospital Name|Position at):?\s+(.+)$/i,
            /^(.+?)\s+(?:is|are)\s+(?:looking|seeking|hiring)\b/i,
            /^At\s+([^,]+),/,
            /^Learn more about\s+(.+?)[.!]?$/i,
            /^(.+?),\s+a\s+partner\s+of\b/i
        ];
        for (const pattern of patterns) {
            for (const line of lines) {
                const match = line.match(pattern);
                if (!match) continue;
                const name = clean(match[1]);
                if (valid(name)) return name;
            }
        }
        const company = lines.find(line => /^Company:/i.test(line));
        return company ? company.replace(/^Company:\s*/i, '') : '';
    }

    function hospitalDetails(text, primary) {
        const key = value => value.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
        const valid = name => /^[A-Z]/.test(name) && name.length < 130 &&
            /\b(?:Hospital|Clinic|Center|Veterinary Specialists|Pet Care)(?:\s+of\s+[A-Z][\w ]+)?$/i.test(name) &&
            !/^(?:About|Our|The role|We|Join|At)\b/i.test(name);
        const lists = [];
        for (const line of linesOf(text)) {
            let names = [];
            if (line.includes('/') && /\b(?:veterinarian|medical director)\b/i.test(line)) {
                names = line.split(/\s*\/\s*/).filter(name => valid(name));
            }
            const hiring = line.match(/^(.+?)\s+(?:are|is)\s+(?:looking|seeking|hiring)\b/i);
            if (hiring) {
                const parts = hiring[1].split(/\s+(?:and|&)\s+(?=[A-Z])/);
                if (parts.length > 1 && parts.every(valid)) names = parts;
            }
            // A shared hospital with the listing ties this list to this job;
            // other hospitals mentioned in referral/benefit text aren't added.
            if (names.length > 1 && names.some(name => key(name) === key(primary))) lists.push(names);
        }
        if (!lists.length) return { hospital: primary };
        const byName = new Map([[key(primary), primary]]);
        for (const names of lists) for (const name of names) if (!byName.has(key(name))) byName.set(key(name), name);
        return { hospital: [...byName.values()].join(' / ') };
    }

    const api = { extractSalary, extractJobType, extractExperience, isStreetAddress, isGenericHospital, extractHospital, hospitalDetails };
    root.ThriveDetailRules = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
