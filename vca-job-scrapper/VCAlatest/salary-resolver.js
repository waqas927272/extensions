(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.VcaSalaryResolver = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const NUMBER_WORD = {
        one: 1,
        two: 2,
        three: 3,
        four: 4,
        five: 5,
        six: 6,
        seven: 7,
        eight: 8,
        nine: 9,
        ten: 10,
        eleven: 11,
        twelve: 12
    };

    function normalizeText(value) {
        return String(value || '')
            .replace(/\u00a0/g, ' ')
            .replace(/[\u2012\u2013\u2014\u2212]/g, '-')
            .replace(/[ \t]+/g, ' ')
            .trim();
    }

    function normalizeMalformedThousands(value) {
        return normalizeText(value).replace(
            /(\$\s*\d{1,3}(?:,\d{3})*)\s*(-|\bto\b)\s*(\$?\s*)(\d{2,3})-(\d{3})(?!\s*k\b)/gi,
            '$1 $2 $3$4,$5'
        );
    }

    function formatMoney(value) {
        if (!Number.isFinite(value)) return '';
        if (Number.isInteger(value)) return '$' + value.toLocaleString('en-US');
        return '$' + value.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    function normalizeUnit(value, amounts = []) {
        const text = normalizeText(value);
        if (/(?:\/\s*hr\b|\bper\s+(?:hour|hr)\b|\bhourly\b|\ban\s+hour\b)/i.test(text)) {
            return 'hour';
        }
        if (/(?:\/\s*shift\b|\bper\s+shift\b|\beach\s+shift\b|\bfor\s+(?:a|one)\s+shift\b)/i.test(text)) {
            return 'shift';
        }

        const durationMatch = text.match(/\bfor\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+hours?\b/i);
        const duration = durationMatch
            ? (NUMBER_WORD[durationMatch[1].toLowerCase()] || Number(durationMatch[1]))
            : 0;
        const largestAmount = amounts.length ? Math.max(...amounts) : 0;
        if (duration >= 4 && duration <= 24 && largestAmount > 0 && largestAmount <= 5000) {
            return 'shift';
        }

        return 'year';
    }

    function parseAmount(value, hasThousandsSuffix) {
        let amount = Number(String(value || '').replace(/,/g, ''));
        if (!Number.isFinite(amount) || amount <= 0) return 0;
        if (hasThousandsSuffix) amount *= 1000;
        return amount;
    }

    function normalizeRangeAmounts(first, second, context) {
        let min = parseAmount(first.value, first.hasThousandsSuffix);
        let max = parseAmount(second.value, second.hasThousandsSuffix);
        const hasThousandsSuffix = first.hasThousandsSuffix || second.hasThousandsSuffix;
        const unit = normalizeUnit(context, [min, max]);

        if (hasThousandsSuffix) {
            if (!first.hasThousandsSuffix && min < 1000) min *= 1000;
            if (!second.hasThousandsSuffix && max < 1000) max *= 1000;
        } else if (
            unit === 'year' &&
            min >= 50 && min < 1000 &&
            max >= 50 && max < 1000 &&
            /\b(?:annual|yearly|salary|compensation|pay)\b/i.test(context)
        ) {
            min *= 1000;
            max *= 1000;
        }

        return { min: Math.min(min, max), max: Math.max(min, max), unit };
    }

    function formatSalaryValues(amounts, context, qualifier = '') {
        const unit = normalizeUnit(context, amounts);
        const unitLabel = unit === 'hour' ? 'per hour' : (unit === 'shift' ? 'per shift' : 'per year');
        if (amounts.length >= 2) {
            const min = Math.min(amounts[0], amounts[1]);
            const max = Math.max(amounts[0], amounts[1]);
            return `${formatMoney(min)}-${formatMoney(max)} ${unitLabel}`;
        }
        if (!amounts.length) return '';
        const prefix = qualifier === 'up-to' ? 'Up to ' : '';
        return `${prefix}${formatMoney(amounts[0])} ${unitLabel}`;
    }

    function parseSalaryCandidate(value) {
        const text = normalizeMalformedThousands(value);
        if (!text) return '';

        const rangePattern = /(?:\$\s*)?(\d[\d,]*(?:\.\d{1,2})?)\s*(k)?\s*(?:-|\bto\b)\s*(?:\$\s*)?(\d[\d,]*(?:\.\d{1,2})?)\s*(k)?/gi;
        const ranges = [];
        let match;
        while ((match = rangePattern.exec(text)) !== null) {
            const first = { value: match[1], hasThousandsSuffix: !!match[2] };
            const second = { value: match[3], hasThousandsSuffix: !!match[4] };
            const normalized = normalizeRangeAmounts(first, second, text);
            if (!normalized.min || !normalized.max) continue;
            const hasCurrency = match[0].includes('$');
            const salaryContext = /\b(?:salary|compensation|pay|range|earn|base)\b/i.test(text);
            const rawFirst = parseAmount(first.value, first.hasThousandsSuffix);
            const rawSecond = parseAmount(second.value, second.hasThousandsSuffix);
            if (!hasCurrency && !first.hasThousandsSuffix && !second.hasThousandsSuffix && !salaryContext) continue;
            if (!hasCurrency && !first.hasThousandsSuffix && !second.hasThousandsSuffix && Math.min(rawFirst, rawSecond) < 50) continue;
            ranges.push({
                ...normalized,
                score: (hasCurrency ? 40 : 0) +
                    ((first.hasThousandsSuffix || second.hasThousandsSuffix) ? 25 : 0) +
                    (salaryContext ? 20 : 0) +
                    Math.min(normalized.max / 10000, 20)
            });
        }

        if (ranges.length) {
            ranges.sort((a, b) => b.score - a.score);
            const best = ranges[0];
            return formatSalaryValues([best.min, best.max], best.unit === 'hour' ? 'per hour' : (best.unit === 'shift' ? 'per shift' : 'per year'));
        }

        const singleContext = /\b(?:salary|compensation|pay|earn|earning|base|hourly|per\s+hour|per\s+shift|range\s+for\s+this\s+position)\b/i.test(text);
        if (!singleContext) return '';

        const singlePattern = /\$\s*(\d[\d,]*(?:\.\d{1,2})?)\s*(k)?/gi;
        const singles = [];
        while ((match = singlePattern.exec(text)) !== null) {
            let amount = parseAmount(match[1], !!match[2]);
            const unit = normalizeUnit(text, [amount]);
            if (!match[2] && unit === 'year' && amount >= 50 && amount < 1000 && /\b(?:annual|yearly|salary|compensation|pay)\b/i.test(text)) {
                amount *= 1000;
            }
            singles.push({ amount, index: match.index });
        }
        if (!singles.length) return '';

        const qualifier = /\b(?:up\s+to|maximum|max(?:imum)?)\b/i.test(text) ? 'up-to' : '';
        return formatSalaryValues([singles[0].amount], text, qualifier);
    }

    function candidateScore(line, index) {
        let score = 0;
        if (/\b(?:salary\s+range|annual\s+salary|base\s+salary|pay\s+range|compensation\s+range)\b/i.test(line)) score += 80;
        else if (/\b(?:salary|compensation|pay)\b/i.test(line)) score += 55;
        if (/\b(?:annual|annually|yearly|per\s+year|per\s+hour|hourly|per\s+shift|\/hr|\/shift)\b/i.test(line)) score += 20;
        if (/\b(?:range|up\s+to|starting\s+at|starts?\s+at|earn(?:ing)?)\b/i.test(line)) score += 15;
        if (/\$\s*\d/i.test(line)) score += 25;
        if (/\b(?:sign(?:ing|-on)\s+bonus|relocation|stipend|allowance|pet\s+discount|401\s*\(?k)\b/i.test(line) &&
            !/\b(?:salary\s+range|annual\s+salary|base\s+salary)\b/i.test(line)) score -= 120;
        return score - index * 0.001;
    }

    function extractSalaryFromText(value) {
        let text = String(value || '');
        if (!text.trim()) return '';

        const sourceMarker = /=== SOURCE JOB DESCRIPTION ===/i;
        if (sourceMarker.test(text)) {
            text = text.split(sourceMarker).pop() || text;
        }

        const lines = text
            .split(/\r?\n/)
            .map(normalizeText)
            .filter(Boolean);
        const candidates = [];

        for (let index = 0; index < lines.length; index++) {
            const line = lines[index];
            const hasAmount = /\$\s*\d/i.test(line) ||
                /\b\d[\d,]*(?:\.\d{1,2})?\s*k\b/i.test(line) ||
                (/\b(?:salary|compensation|pay)\b/i.test(line) && /\b\d[\d,]*\s*(?:-|\bto\b)\s*\d/i.test(line));
            if (!hasAmount) continue;
            const parsed = parseSalaryCandidate(line);
            if (!parsed) continue;
            candidates.push({ value: parsed, score: candidateScore(line, index), line });
        }

        if (!candidates.length) return '';
        candidates.sort((a, b) => b.score - a.score);

        const earningAmounts = candidates
            .filter(candidate => /\b(?:earn|earning\s+potential|total\s+compensation)\b/i.test(candidate.line))
            .filter(candidate => !/\b(?:bonus|stipend|relocation|allowance)\b/i.test(candidate.line))
            .map(candidate => {
                const amounts = [...candidate.value.matchAll(/\$([\d,]+(?:\.\d+)?)/g)]
                    .map(match => Number(match[1].replace(/,/g, '')))
                    .filter(Number.isFinite);
                return amounts.length === 1 && /per year/i.test(candidate.value) ? amounts[0] : 0;
            })
            .filter(Boolean);
        const uniqueEarningAmounts = [...new Set(earningAmounts)].sort((a, b) => a - b);
        if (uniqueEarningAmounts.length >= 2) {
            return formatSalaryValues(
                [uniqueEarningAmounts[0], uniqueEarningAmounts[uniqueEarningAmounts.length - 1]],
                'per year'
            );
        }

        return candidates[0].score > 0 ? candidates[0].value : '';
    }

    function extractSalaryFromJsonLd(jsonLd) {
        const salary = jsonLd && jsonLd.baseSalary;
        const value = salary && salary.value;
        if (!value) return '';

        const minText = value.minValue !== undefined && value.minValue !== null ? String(value.minValue).trim() : '';
        const maxText = value.maxValue !== undefined && value.maxValue !== null ? String(value.maxValue).trim() : '';
        const unitText = normalizeText(value.unitText || salary.unitText || 'per year');
        const explicitUnit = /hour/i.test(unitText)
            ? 'per hour'
            : (/shift/i.test(unitText) ? 'per shift' : 'per year');
        const currency = normalizeText(salary.currency || '$');
        const symbol = currency === '$' || /^usd$/i.test(currency) ? '$' : `${currency} `;

        if (minText && maxText) {
            return parseSalaryCandidate(`Salary Range: ${symbol}${minText} - ${symbol}${maxText} ${explicitUnit}`);
        }
        if (minText || maxText) {
            const amount = minText || maxText;
            return parseSalaryCandidate(`Salary: ${symbol}${amount} ${explicitUnit}`);
        }
        return '';
    }

    function extractSalary(descriptionText, jsonLd) {
        return extractSalaryFromJsonLd(jsonLd) || extractSalaryFromText(descriptionText);
    }

    return {
        extractSalary,
        extractSalaryFromJsonLd,
        extractSalaryFromText,
        parseSalaryCandidate
    };
});
