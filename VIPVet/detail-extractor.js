(() => {
    // ===== VIPVet Greenhouse Embed Page — Detail Extractor =====
    //
    // Page structure (job-boards.greenhouse.io/embed/job_app?for=veterinaryinnovativepartners&token=ID):
    //   h1.section-header--large        → full title: "Role - Hospital Name" or "Role - Hospital Name - STATE"
    //   div.job__location > div         → hospital name only: "Hospital Name"
    //   div.job__description            → body text (no JSON-LD on these pages)
    //
    // Description body typically starts with:
    //   <strong>Role Title</strong>
    //   <strong>Hospital Name | City, STATE</strong>   (newer format)
    //   OR
    //   <strong>Hospital Name City, STATE | Job Type</strong>  (older format)

    // ── State full-name → abbreviation ──
    const STATE_ABBREV = {
        'alabama':'AL','alaska':'AK','arizona':'AZ','arkansas':'AR','california':'CA',
        'colorado':'CO','connecticut':'CT','delaware':'DE','florida':'FL','georgia':'GA',
        'hawaii':'HI','idaho':'ID','illinois':'IL','indiana':'IN','iowa':'IA','kansas':'KS',
        'kentucky':'KY','louisiana':'LA','maine':'ME','maryland':'MD','massachusetts':'MA',
        'michigan':'MI','minnesota':'MN','mississippi':'MS','missouri':'MO','montana':'MT',
        'nebraska':'NE','nevada':'NV','new hampshire':'NH','new jersey':'NJ','new mexico':'NM',
        'new york':'NY','north carolina':'NC','north dakota':'ND','ohio':'OH','oklahoma':'OK',
        'oregon':'OR','pennsylvania':'PA','rhode island':'RI','south carolina':'SC',
        'south dakota':'SD','tennessee':'TN','texas':'TX','utah':'UT','vermont':'VT',
        'virginia':'VA','washington':'WA','west virginia':'WV','wisconsin':'WI','wyoming':'WY',
        'district of columbia':'DC'
    };
    function normalizeState(s) {
        if (!s) return '';
        const t = s.trim();
        if (t.length === 2) return t.toUpperCase();
        return STATE_ABBREV[t.toLowerCase()] || t;
    }

    // ── STEP 1: Extract raw DOM fields ──

    // H1 title (full title including hospital suffix)
    const h1El = document.querySelector('h1');
    const rawTitle = h1El ? h1El.innerText.trim() : '';

    // Hospital name from .job__location
    const locationEl = document.querySelector('.job__location');
    const hospitalName = locationEl ? locationEl.innerText.trim() : '';

    // Description body
    const descEl = document.querySelector('.job__description');
    const bodyText = descEl ? descEl.innerText.trim() : document.body.innerText.trim();

    // ── STEP 2: Extract roleTitle (the job role, stripped of hospital name suffix) ──
    //
    // Title formats:
    //   "Associate Veterinarian - Ark Animal Clinic"
    //   "Lead Licensed Veterinary Technician - Dakota Veterinary Center - NY"
    //   "Veterinary Internal Medicine Specialist (DACVIM)- Veterinary Emergency Center of Redlands"
    //   "Relief Emergency Veterinarian- Knoxville Pet Emergency Clinic (KPEC)"
    //
    // Strategy 1: find where hospitalName starts in rawTitle, take everything before it.
    // Strategy 2 (fallback): split at first dash-space separator (handles "- " with or without leading space).

    let roleTitle = rawTitle;
    if (hospitalName && rawTitle.includes(hospitalName)) {
        // Exact hospital name found in title
        const idx = rawTitle.indexOf(hospitalName);
        if (idx > 0) {
            roleTitle = rawTitle.substring(0, idx).replace(/\s*[-–—]\s*$/, '').trim();
        }
    } else {
        // Fallback: split at first dash followed by a space (handles "- " and also "- " without leading space)
        // Pattern: anything up to the first [-–] that is followed by a space or uppercase word
        const dashSplit = rawTitle.match(/^(.*?)\s*[-–]\s+/);
        if (dashSplit) {
            roleTitle = dashSplit[1].trim();
        }
    }

    // ── STEP 3: Extract city and state from body text ──
    //
    // VIPVet description body has two formats in the first few lines:
    //
    // Format A (pipe AFTER hospital, city AFTER pipe):
    //   "Hospital Name | White Plains, NY"
    //   → look for "| City, ST" where city is what follows the pipe
    //
    // Format B (city BEFORE pipe, inline with hospital):
    //   "Hospital Name City, STATE | Job Type"
    //   e.g. "Veterinary Emergency Center of Redlands Redlands, CA | Full-Time Specialty Role"
    //   → city is the single word directly before ", STATE |"
    //
    // Only look at the first ~300 characters to avoid false matches from body text.

    let city = '', state = '';
    const headerText = bodyText.substring(0, 400);

    // Format A: pipe then city/state (0-4 words after pipe, then comma, then 2-letter state)
    const pipeAfterMatch = headerText.match(/\|\s*([A-Za-z][A-Za-z .']{0,50}?),\s*([A-Z]{2})\b/);
    if (pipeAfterMatch) {
        city = pipeAfterMatch[1].trim();
        state = pipeAfterMatch[2].trim();
    }

    // Format B: single word directly before ", STATE |" (city inline with hospital name)
    if (!city) {
        const pipeBeforeMatch = headerText.match(/\b([A-Za-z]+(?:\s+[A-Za-z]+)?),\s*([A-Z]{2})\s*\|/);
        if (pipeBeforeMatch) {
            // Take only the LAST word of the match (avoids "Redlands Redlands" → "Redlands")
            const words = pipeBeforeMatch[1].trim().split(/\s+/);
            city = words[words.length - 1];
            state = pipeBeforeMatch[2].trim();
        }
    }

    // Fallback: any "City, STATE" in header
    if (!city) {
        const fallbackMatch = headerText.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),\s*([A-Z]{2})\b/);
        if (fallbackMatch) {
            city = fallbackMatch[1].trim();
            state = fallbackMatch[2].trim();
        }
    }

    // Normalize state to 2-letter abbreviation
    state = normalizeState(state);

    // ── STEP 4: Extract salary ──
    // Patterns tried in priority order — specific labels first to avoid capturing
    // wrong dollar amounts from benefit descriptions or bonus text.
    //   "Pay Rate: $80 - $140/hr"        "Hourly Rate: $X - $Y"
    //   "Base salary range- $X-$Y"       "Annual Salary: $X"
    //   "Salary range: $X-$Y"            "Compensation: $X - $Y"
    //   "Guaranteed base: $X"            "$X - $Y per hour/year" (unlabeled)
    function extractSalary(text) {
        if (!text) return '';

        // ── PHASE 1: Multiline check ──
        // Some VIPVet jobs put "Compensation & Benefits:" as a heading on one line,
        // then the dollar range on the very next line with no label.
        // e.g. "Compensation & Benefits:\n$200,000 – $230,000+ (base only...)"
        const mlMatch = text.match(
            /(?:compensation|benefits|pay)[^\n]*\n\s*[^\$\n]{0,15}(\$[\d,]+(?:\.\d{1,2})?\s*[-–]\s*\$[\d,]+(?:\.\d{1,2})?(?:\+)?)/i
        );
        if (mlMatch && mlMatch[1]) return mlMatch[1].trim();

        // ── PHASE 2: Labeled single-line patterns (most specific first) ──
        const labeled = [
            // Pay Rate: $80 - $140 per hour  |  Pay Rate: $100,000 - $150,000 annually
            /Pay\s*Rate\s*[:\-]\s*(\$[\d,]+(?:\.\d{1,2})?\s*[-–]\s*\$[\d,]+(?:\.\d{1,2})?(?:\+)?(?:\s+per\s+(?:hr|hour|year|yr|annum|annually))?)/i,
            // Pay Rate: $80/hr  |  Pay Rate: $80 per hour (single value)
            /Pay\s*Rate\s*[:\-]\s*(\$[\d,]+(?:\.\d{1,2})?(?:\/(?:hr|hour|year|yr)|\s+per\s+(?:hr|hour|year|yr))?)/i,
            // Hourly Rate / Hourly Pay: $X-$Y or $X
            /Hourly\s*(?:Rate|Pay)\s*[:\-]\s*(\$[\d,]+(?:\.\d{1,2})?\s*(?:[-–]\s*\$[\d,]+(?:\.\d{1,2})?)?(?:\/(?:hr|hour)|\s+per\s+(?:hr|hour))?)/i,
            // Pay: $X (short form)
            /\bPay\s*[:\-]\s*(\$[\d,]+(?:\.\d{1,2})?\s*(?:[-–]\s*\$[\d,]+(?:\.\d{1,2})?)?(?:\/(?:hr|hour)|\s+per\s+(?:hr|hour))?)/i,
            // Base salary range: $X-$Y
            /[Bb]ase\s+[Ss]alary\s+[Rr]ange\s*[-:]\s*(\$[\d,]+(?:\.\d{1,2})?\s*[-–]\s*\$[\d,]+(?:\.\d{1,2})?)/i,
            // Base salary / Base pay: $X-$Y or $X
            /[Bb]ase\s+(?:[Ss]alary|[Pp]ay)\s*[:\-]\s*(\$[\d,]+(?:\.\d{1,2})?\s*(?:[-–]\s*\$[\d,]+(?:\.\d{1,2})?)?(?:\s+per\s+(?:hr|hour|year|yr))?)/i,
            // Salary range: $X-$Y
            /[Ss]alary\s+[Rr]ange\s*[-:]\s*(\$[\d,]+(?:\.\d{1,2})?\s*[-–]\s*\$[\d,]+(?:\.\d{1,2})?)/i,
            // Salary range of $X to $Y
            /[Ss]alary\s+[Rr]ange\s+of\s+(\$[\d,]+(?:\.\d{1,2})?\s+to\s+\$[\d,]+(?:\.\d{1,2})?)/i,
            // Annual salary / Annual compensation / Annual income: $X
            /Annual\s+(?:[Ss]alary|[Cc]ompensation|[Ii]ncome)\s*[:\-]\s*(\$[\d,]+(?:\.\d{1,2})?\s*(?:[-–]\s*\$[\d,]+(?:\.\d{1,2})?)?)/i,
            // Total/Overall compensation range/package: $X
            /(?:Total|Overall)\s+[Cc]ompensation\s*(?:[Rr]ange|[Pp]ackage)?\s*[:\-]\s*(\$[\d,]+(?:\.\d{1,2})?\s*(?:[-–]\s*\$[\d,]+(?:\.\d{1,2})?)?)/i,
            // Compensation range/package: $X
            /[Cc]ompensation\s+(?:[Rr]ange|[Pp]ackage)\s*[:\-]\s*(\$[\d,]+(?:\.\d{1,2})?\s*(?:[-–]\s*\$[\d,]+(?:\.\d{1,2})?)?)/i,
            // Compensation: $X-$Y or $X
            /[Cc]ompensation\s*:\s*(\$[\d,]+(?:\.\d{1,2})?\s*(?:[-–]\s*\$[\d,]+(?:\.\d{1,2})?)?)/i,
            // Salary: $X-$Y or $X
            /[Ss]alary\s*:\s*(\$[\d,]+(?:\.\d{1,2})?\s*(?:[-–]\s*\$[\d,]+(?:\.\d{1,2})?)?)/i,
            // ── salary — $X  or  compensation — $X  (em-dash/dash instead of colon) ──
            // e.g. "✨ Competitive salary — $110,000–$160,000 (DOE)"
            /(?:[Ss]alary|[Cc]ompensation)\s*[-–—]\s*(\$[\d,]+(?:\.\d{1,2})?\s*(?:[-–]\s*\$[\d,]+(?:\.\d{1,2})?)?(?:\+)?)/i,
            // Starting salary of $X
            /[Ss]tarting\s+(?:[Ss]alary|[Pp]ay)\s+(?:of\s+)?(\$[\d,]+(?:\.\d{1,2})?(?:\s+per\s+(?:hour|hr|year|yr))?)/i,
            // Guaranteed base salary/pay: $X
            /[Gg]uaranteed\s+(?:[Bb]ase\s+)?(?:[Ss]alary|[Pp]ay|[Cc]ompensation)\s*[:\-]?\s*(?:of\s+)?(\$[\d,]+(?:\.\d{1,2})?\s*(?:[-–]\s*\$[\d,]+(?:\.\d{1,2})?)?)/i,
            // Earning potential: $X
            /[Ee]arning\s+[Pp]otential\s*[:\-]\s*(\$[\d,]+(?:\.\d{1,2})?\s*(?:[-–]\s*\$[\d,]+(?:\.\d{1,2})?)?(?:\+)?)/i,
            // Income: $X
            /\b[Ii]ncome\s*[:\-]\s*(\$[\d,]+(?:\.\d{1,2})?\s*(?:[-–]\s*\$[\d,]+(?:\.\d{1,2})?)?)/i,
        ];

        for (const p of labeled) {
            const m = text.match(p);
            if (m && m[1]) return m[1].trim();
        }

        // ── PHASE 3: Unlabeled patterns (dollar range with strong contextual signals) ──

        // $X–$Y+ salary/base  →  e.g. "$110,000–$160,000+ salary, based on experience"
        const salaryWordMatch = text.match(
            /(\$[\d,]+(?:\.\d{1,2})?\s*[-–]\s*\$[\d,]+(?:\.\d{1,2})?(?:\+)?)\s+(?:salary|base\s+salary|base)/i
        );
        if (salaryWordMatch && salaryWordMatch[1]) return salaryWordMatch[1].trim();

        // $X–$Y+ per hour/year/annually  (optional + before unit, no space required before /)
        // e.g. "$150,000 – $180,000/year"  "$110,000–$160,000+ annually"
        const unitRangeMatch = text.match(
            /(\$[\d,]+(?:\.\d{1,2})?\s*[-–]\s*\$[\d,]+(?:\.\d{1,2})?(?:\+)?)\s*(?:per\s+(?:hr|hour|year|yr|annum)|annually|an\s+(?:hr|hour)|\/(?:hr|hour|year|yr))/i
        );
        if (unitRangeMatch && unitRangeMatch[1]) return unitRangeMatch[1].trim();

        // $X to $Y per hour/year  (unlabeled "to" range with time unit)
        const toRangeMatch = text.match(
            /(\$[\d,]+(?:\.\d{1,2})?\s+to\s+\$[\d,]+(?:\.\d{1,2})?)\s+(?:per\s+(?:hr|hour|year|yr)|annually)/i
        );
        if (toRangeMatch && toRangeMatch[1]) return toRangeMatch[1].trim();

        // $X/hr or $X per hour  (single hourly value)
        const singleHourly = text.match(
            /(\$[\d,]+(?:\.\d{1,2})?(?:\/(?:hr|hour)|\s+per\s+(?:hr|hour)))/i
        );
        if (singleHourly && singleHourly[1]) return singleHourly[1].trim();

        return '';
    }

    // ── STEP 4b: Normalize salary to "$X-$Y per year" / "$X-$Y per hour" format ──
    function normalizeSalary(raw, fullText) {
        if (!raw) return '';

        // ── Determine hourly vs annual ──
        // 1. Check the captured string itself
        let unit = '';
        if (/per\s*h(?:ou)?r|\/h(?:ou)?r|\ban\s+h(?:ou)?r/i.test(raw)) {
            unit = 'per hour';
        } else if (/per\s*(?:year|yr|annum)|annually|\/ye?a?r/i.test(raw)) {
            unit = 'per year';
        } else {
            // 2. Look at the full line in the description that contains this amount
            const firstAmt = (raw.match(/\$[\d,]+/) || [])[0] || '';
            if (firstAmt) {
                const matchLine = (fullText || '').split('\n').find(l => l.includes(firstAmt)) || '';
                if (/per\s*h(?:ou)?r|\/h(?:ou)?r|\ban\s+h(?:ou)?r/i.test(matchLine)) {
                    unit = 'per hour';
                } else if (/per\s*(?:year|yr|annum)|annually|\/ye?a?r/i.test(matchLine)) {
                    unit = 'per year';
                } else {
                    // 3. Heuristic: amounts under $1,000 are hourly rates
                    const val = parseInt(firstAmt.replace(/[\$,]/g, ''), 10);
                    unit = val < 1000 ? 'per hour' : 'per year';
                }
            }
        }

        // ── Extract dollar amounts ──
        const rawAmounts = raw.match(/\$[\d,]+(?:\.\d{1,2})?/g) || [];
        if (rawAmounts.length === 0) return raw;

        // Clean each: remove trailing .00 / .0 (e.g. $100,000.00 → $100,000)
        const cleanAmt = s => s.replace(/\.0+$/, '');
        const amounts = rawAmounts.map(cleanAmt);

        // Check for a + sign immediately after the last dollar amount (open-ended range)
        const hasPlus = /\$[\d,]+(?:\.\d{1,2})?\+/.test(raw);

        // ── Build formatted string ──
        const rangePart = amounts.length >= 2
            ? amounts[0] + '-' + amounts[1] + (hasPlus ? '+' : '')
            : amounts[0] + (hasPlus ? '+' : '');

        return rangePart + (unit ? ' ' + unit : '');
    }

    const salary = normalizeSalary(extractSalary(bodyText), bodyText);

    // ── STEP 4b: Extract job type ──
    // Rules:
    //   - "Part Time" only if part-time is mentioned AND full-time is NOT mentioned
    //   - "Full Time" if full-time is mentioned, both are mentioned, or neither is mentioned
    function extractJobType(text) {
        const t = (text || '').toLowerCase();
        const hasPart = /part[\s\-]?time/.test(t);
        const hasFull = /full[\s\-]?time/.test(t);

        if (hasPart && !hasFull) return 'Part Time';
        return 'Full Time';  // full-time only, both, or neither
    }

    const jobType = extractJobType(bodyText);

    // ── STEP 5: Non-clinical role guard ──
    // These roles should have no position or AOP returned.
    function isNonClinical(t) {
        return (
            t.includes('client service') ||
            t.includes('service representative') ||
            t.includes('receptionist') ||
            t.includes('kennel') ||
            t.includes('groomer') ||
            t.includes('grooming') ||
            t.includes('practice manager') ||
            t.includes('hospital manager') ||
            t.includes('office manager') ||
            t.includes('administrator') ||
            t.includes('billing') ||
            t.includes('human resources') ||
            t.includes('patient care coordinator') ||
            t.includes('client care coordinator') ||
            t.includes('customer service') ||
            t.includes('front desk') ||
            t.includes('inventory') ||
            t.includes('housekeeper') ||
            t.includes('janitorial') ||
            t.includes('externship') ||
            t.includes('general job application') ||
            t.includes('clinic support') ||
            t.includes('join our team')
        );
    }

    // ── STEP 6: Determine canonical position name ──
    //
    // Canonical names mirror MedVet/UVC convention.
    // Lookup order: DACV credentials in title → specialty keywords → tech roles → DVM roles
    function determinePosition(role, body) {
        const t = role.toLowerCase();
        const b = (body || '').toLowerCase();

        // Non-clinical → empty
        if (isNonClinical(t)) return '';

        // ── Medical Director ──
        if (t.includes('medical director')) return 'Medical Director';

        // ── Board-certified specialist — credential abbreviations in title ──
        // DACVECC (Emergency & Critical Care)
        if (t.includes('dacvecc') ||
            (t.includes('emergency') && t.includes('critical care') && (t.includes('specialist') || t.includes('criticalist')))) {
            return 'ECC Specialist';
        }
        if (t.includes('criticalist')) return 'ECC Specialist';

        // DACVIM sub-specialties (check specific sub before generic DACVIM)
        if (t.includes('dacvim') && (t.includes('oncology') || t.includes('oncologist'))) return 'Medical Oncologist';
        if (t.includes('dacvr') && (t.includes('radiation') || t.includes('-ro'))) return 'Radiation Oncologist';
        if (t.includes('dacvim') && (t.includes('neurology') || t.includes('neurosurgery'))) return 'Neurologist & Neurosurgeon';
        if (t.includes('dacvim') && t.includes('cardiology')) return 'Cardiologist';
        if (t.includes('dacvim')) return 'Internal Medicine Specialist';
        if (t.includes('davdc') || t.includes('avdc')) return 'Dental Specialist';
        if (t.includes('dacvd')) return 'Dermatologist';
        if (t.includes('dacvs') || (t.includes('acvs') && !t.includes('dacvim'))) return 'Surgeon';
        if (t.includes('dacvr')) return 'Radiologist';
        if (t.includes('dacvo')) return 'Ophthalmologist';
        if (t.includes('dacvaa') || t.includes('dacva')) return 'Anesthesiologist';
        if (t.includes('dact')) return 'Theriogenologist';
        if (t.includes('dabvp')) return 'DABVP Specialist';

        // ── Specialty keywords in title ──
        if (t.includes('internal medicine') && (t.includes('specialist') || t.includes('internist') || t.includes('dacvim'))) return 'Internal Medicine Specialist';
        if (t.includes('internist')) return 'Internal Medicine Specialist';
        if (t.includes('radiation oncol')) return 'Radiation Oncologist';
        if (t.includes('oncologist') && t.includes('radiation')) return 'Radiation Oncologist';
        if (t.includes('oncologist') || (t.includes('oncology') && t.includes('specialist'))) return 'Medical Oncologist';
        if (t.includes('cardiologist') || (t.includes('cardiology') && t.includes('specialist'))) return 'Cardiologist';
        if (t.includes('neurologist') || t.includes('neurosurgeon') ||
            (t.includes('neurology') && t.includes('specialist'))) return 'Neurologist & Neurosurgeon';
        if (t.includes('dermatologist') || (t.includes('dermatology') && t.includes('specialist'))) return 'Dermatologist';
        if (t.includes('ophthalmologist') || (t.includes('ophthalmology') && t.includes('specialist'))) return 'Ophthalmologist';
        if (t.includes('anesthesiologist') ||
            (t.includes('anesthesia') && t.includes('specialist') && !t.includes('technician'))) return 'Anesthesiologist';
        if (t.includes('theriogenologist')) return 'Theriogenologist';
        if (t.includes('radiologist') || (t.includes('radiology') && t.includes('specialist'))) return 'Radiologist';
        if ((t.includes('dental') || t.includes('dentistry')) && t.includes('specialist')) return 'Dental Specialist';
        if ((t.includes('surgeon') || (t.includes('surgery') && t.includes('specialist'))) &&
            !t.includes('neurosurgeon') && !t.includes('dental') && !t.includes('technician')) {
            return 'Surgeon';
        }

        // ── Scan body text for DACV credentials when title is generic "specialist" or "board certified" ──
        if (t.includes('specialist') || t.includes('board certified') || t.includes('residency') || t.includes('diplomate')) {
            if (b.includes('dacvecc')) return 'ECC Specialist';
            if (b.includes('dacvim') && b.includes('oncology')) return 'Medical Oncologist';
            if (b.includes('dacvr') && b.includes('radiation')) return 'Radiation Oncologist';
            if (b.includes('dacvim') && b.includes('neurology')) return 'Neurologist & Neurosurgeon';
            if (b.includes('dacvim') && b.includes('cardiology')) return 'Cardiologist';
            if (b.includes('dacvim')) return 'Internal Medicine Specialist';
            if (b.includes('davdc') || b.includes('avdc')) return 'Dental Specialist';
            if (b.includes('dacvd')) return 'Dermatologist';
            if (b.includes('dacvs') || b.includes('acvs')) return 'Surgeon';
            if (b.includes('dacvr')) return 'Radiologist';
            if (b.includes('dacvo')) return 'Ophthalmologist';
            if (b.includes('dacvaa')) return 'Anesthesiologist';
            if (b.includes('dact')) return 'Theriogenologist';
            if (b.includes('dabvp')) return 'DABVP Specialist';
            if (b.includes('internal medicine')) return 'Internal Medicine Specialist';
            if (b.includes('criticalist')) return 'ECC Specialist';
        }

        // ── Veterinary Technician roles ──
        const isTech = /\b(technician|vet\s*tech|lvt|rdvt|cvt|registered\s+veterinary\s+tech)\b/.test(t);
        if (isTech) {
            // Specialty tech roles — map to the specialist position they support
            if (t.includes('anesthesia') || t.includes('anesthesiolog')) return 'Anesthesiologist';
            if (t.includes('dental') || t.includes('dentistry')) return 'Dental Specialist';
            if (t.includes('critical care') || /\becc\b/.test(t) || t.includes('criticalist')) return 'ECC Specialist';
            if (t.includes('radiation oncol')) return 'Radiation Oncologist';
            if (t.includes('oncol') && !t.includes('radiation')) return 'Medical Oncologist';
            if (t.includes('cardiolog')) return 'Cardiologist';
            if (t.includes('neurolog') || t.includes('neurosurg')) return 'Neurologist & Neurosurgeon';
            if (t.includes('dermatolog')) return 'Dermatologist';
            if (t.includes('ophthalmolog')) return 'Ophthalmologist';
            if (t.includes('surgery') || t.includes('surgical')) return 'Surgeon';
            if (t.includes('radiolog') || t.includes('diagnostic imaging')) return 'Radiologist';
            if (t.includes('internal medicine')) return 'Internal Medicine Specialist';
            if (t.includes('emergency') || t.includes('er vet')) return 'Credentialed Veterinary Technician Specialist';
            if (t.includes('rehabilitation') || t.includes('specialist')) return 'Credentialed Veterinary Technician Specialist';
            // Generic tech title (Lead LVT, Overnight LVT, etc.)
            if (t.includes('licensed') || t.includes('lvt') || t.includes('registered') || t.includes('cvt') || t.includes('rdvt')) {
                return 'Licensed Veterinary Technician';
            }
            return 'Veterinary Technician';
        }

        // ── VTS ──
        if (t.includes('technician specialist') || /\bvts\b/.test(t)) {
            return 'Credentialed Veterinary Technician Specialist';
        }

        // ── Veterinary Assistant ──
        if (t.includes('veterinary assistant') || t.includes('vet assistant')) return 'Veterinary Assistant';

        // ── Veterinary Technician Assistant ──
        if (t.includes('technician assistant')) return 'Veterinary Technician Assistant';

        // ── Equine / Large Animal ──
        if (t.includes('equine') || t.includes('bovine') || t.includes('large animal')) {
            return 'Equine/Bovine Veterinarian/Large Animal';
        }

        // ── Avian / Exotics ──
        if (t.includes('avian') || t.includes('exotics')) {
            return 'Avian & Exotics Veterinarian / Associate Exotics';
        }

        // ── Emergency / Relief / Associate Veterinarian ──
        // (all non-specialist DVM roles → Associate Veterinarian; AOP carries the emergency/GP flag)
        if (t.includes('veterinarian') || t.includes('veterinary') || t.includes('dvm') || t.includes('relief')) {
            return 'Associate Veterinarian';
        }

        return '';
    }

    // ── STEP 7: Determine Area of Practice ──
    function determineAOP(role, hospital, body) {
        const t = role.toLowerCase();
        const h = (hospital || '').toLowerCase();
        const b = (body || '').toLowerCase();

        // Non-clinical → empty
        if (isNonClinical(t)) return '';

        // ── Medical Director: only GP Care or Specialty Care, never Emergency Care ──
        // Medical Directors are practice leadership regardless of what facility type they're in.
        if (t.includes('medical director')) {
            // If the body mentions board certifications or specialist disciplines → Specialty Care
            const specialtyCreds2 = ['dacvim','dacvecc','dacvr','dacvs','dacvd','dacvo','dacvaa','dact','davdc','dabvp',
                'board certified','residency trained','diplomate','specialist','oncology','cardiology',
                'neurology','dermatology','ophthalmology','anesthesia','radiology','surgery','internal medicine'];
            for (const kw of specialtyCreds2) {
                if (b.includes(kw)) return 'Specialty Care';
            }
            return 'General Practice Care';
        }

        // ── Specialty Care signals ──
        const specialtyCreds = [
            'dacvecc','dacvim','dacvr','dacvs','dacvd','dacvo','dacvaa','dact','davdc','avdc','dabvp',
            'board certified','residency trained','residency-trained','diplomate'
        ];
        for (const kw of specialtyCreds) {
            if (t.includes(kw) || b.includes(kw)) return 'Specialty Care';
        }

        const specialtyTitleKw = [
            'criticalist','internal medicine','oncologist','oncology specialist',
            'cardiologist','cardiology specialist','neurologist','neurosurgeon','neurosurgery specialist',
            'dermatologist','dermatology specialist','ophthalmologist','ophthalmology specialist',
            'anesthesiologist','theriogenologist','radiologist','radiology specialist',
            'surgeon','surgery specialist','dental specialist','ecc specialist','dacvim'
        ];
        for (const kw of specialtyTitleKw) {
            if (t.includes(kw)) return 'Specialty Care';
        }

        // Generic "specialist" title (board-certified level) → Specialty Care
        if ((t.includes('specialist') || t.includes('board certified') || t.includes('residency')) &&
            !t.includes('technician') && !t.includes('assistant')) {
            return 'Specialty Care';
        }

        // ── Emergency Care signals ──
        // Title explicitly mentions emergency
        if (t.includes('emergency') || t.includes('er vet') || t.includes('er dvm') ||
            (t.includes('critical care') && !t.includes('criticalist'))) {
            return 'Emergency Care';
        }
        // Hospital name implies emergency facility
        if (h.includes('emergency') || h.includes('er vet') || h.includes('critical care')) {
            return 'Emergency Care';
        }

        // ── Urgent Care signals ──
        if (t.includes('urgent care') || h.includes('urgent care') || h.includes('urgent vet')) {
            return 'Urgent Care';
        }

        // ── Default: General Practice Care ──
        return 'General Practice Care';
    }

    // ── STEP 8: Assemble results ──
    const position = determinePosition(roleTitle, bodyText);
    const areaOfPractice = determineAOP(roleTitle, hospitalName, bodyText);

    return {
        position: position,
        areaOfPractice: areaOfPractice,
        salary: salary,
        jobType: jobType,
        hospitalName: hospitalName,
        city: city,
        state: state,
        description: bodyText
    };
})();
