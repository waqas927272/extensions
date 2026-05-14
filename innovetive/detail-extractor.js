(() => {
  const APPROVED_POSITIONS = [
    'Associate Veterinarian',
    'Medical Director',
    'Anesthesiologist',
    'Cardiologist',
    'Credentialed Veterinary Technician Specialist',
    'DABVP Specialist',
    'Dental Specialist',
    'Dermatologist',
    'ECC Specialist',
    'Internal Medicine Specialist',
    'Lead Veterinarian',
    'Medical Oncologist',
    'Neurologist & Neurosurgeon',
    'Ophthalmologist',
    'Radiation Oncologist',
    'Radiologist',
    'Surgeon',
    'Partner Veterinarian'
  ];
  const APPROVED_POSITION_SET = new Set(APPROVED_POSITIONS);

  const VALID_POSITIONS_BY_AOP = {
    'Emergency Care': ['Associate Veterinarian'],
    'General Practice Care': ['Associate Veterinarian', 'Lead Veterinarian', 'Medical Director'],
    'Exotic Pet Medicine': ['Associate Veterinarian'],
    'Specialty Care': [
      'Anesthesiologist',
      'Cardiologist',
      'Credentialed Veterinary Technician Specialist',
      'DABVP Specialist',
      'Dental Specialist',
      'Dermatologist',
      'ECC Specialist',
      'Internal Medicine Specialist',
      'Medical Director',
      'Medical Oncologist',
      'Neurologist & Neurosurgeon',
      'Ophthalmologist',
      'Radiation Oncologist',
      'Radiologist',
      'Surgeon'
    ],
    'Urgent Care': ['Associate Veterinarian', 'Partner Veterinarian']
  };

  function cleanText(value) {
    const div = document.createElement('div');
    div.innerHTML = value || '';
    return (div.innerText || div.textContent || value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function getJsonLdData() {
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const parsed = JSON.parse(script.textContent);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        const job = items.find(item => item && item['@type'] === 'JobPosting');
        if (job) return job;
      } catch (error) {}
    }
    return null;
  }

  function getDescription(jsonLd) {
    const parts = [];

    if (jsonLd) {
      parts.push('=== JOB POSTING DATA ===');
      parts.push(`Title: ${jsonLd.title || ''}`);
      parts.push(`Industry/Category: ${jsonLd.industry || ''}`);
      parts.push(`Employment Type: ${Array.isArray(jsonLd.employmentType) ? jsonLd.employmentType.join(', ') : (jsonLd.employmentType || '')}`);

      if (jsonLd.baseSalary?.value) {
        const salary = jsonLd.baseSalary.value;
        parts.push(`Salary Range: ${jsonLd.baseSalary.currency || '$'}${salary.minValue || ''} - ${salary.maxValue || ''} ${salary.unitText || ''}`);
      }

      if (jsonLd.description) {
        parts.push('=== FULL JOB DESCRIPTION ===');
        parts.push(cleanText(jsonLd.description));
      }
    }

    const descriptionSelectors = [
      '[class*="job-description"]',
      '[class*="posting-description"]',
      '[class*="description"]',
      'main',
      'body'
    ];

    for (const selector of descriptionSelectors) {
      const element = document.querySelector(selector);
      const text = cleanText(element?.innerHTML || element?.innerText || '');
      if (text && text.length > 200) {
        parts.push('=== PAGE CONTENT ===');
        parts.push(text);
        break;
      }
    }

    return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function getTitle(jsonLd, description) {
    return cleanText(jsonLd?.title || document.querySelector('h1')?.innerText || description.match(/^Title:\s*(.+)$/m)?.[1] || '');
  }

  function getHospitalName(jsonLd, description) {
    let hospitalName = cleanText(jsonLd?.hiringOrganization?.name || '');

    if (!hospitalName || /innovetive petcare/i.test(hospitalName)) {
      const sidebarLink = document.querySelector('a[href*="/at-"]');
      if (sidebarLink && /opportunities at/i.test(sidebarLink.innerText || '')) {
        hospitalName = cleanText(sidebarLink.innerText.replace(/View all opportunities at/i, ''));
      }
    }

    if (!hospitalName || /innovetive petcare/i.test(hospitalName)) {
      const match = description.match(/\bat\s+((?:[\w'.&-]+\s+){1,6}(?:Animal\s+Hospital|Veterinary\s+(?:Hospital|Center|Clinic|Care|Specialists?)|Pet\s+(?:Hospital|Clinic|Care)|Emergency\s+(?:Hospital|Center|Clinic)))\b/i);
      if (match) hospitalName = cleanText(match[1]);
    }

    return hospitalName;
  }

  function normalizeEmploymentType(value) {
    const text = Array.isArray(value) ? value.join(' ') : String(value || '');
    if (/part[-_\s]?time/i.test(text)) return 'Part Time';
    if (/full[-_\s]?time/i.test(text)) return 'Full Time';
    if (/contract/i.test(text)) return 'Contract';
    if (/intern/i.test(text)) return 'Internship';
    return cleanText(text);
  }

  function extractJobType(jsonLd, description) {
    const fromJsonLd = normalizeEmploymentType(jsonLd?.employmentType);
    if (fromJsonLd) return fromJsonLd;

    const match = description.match(/\b(Full[-\s]?Time|Part[-\s]?Time|Contract|Internship|Temporary)\b/i);
    return match ? normalizeEmploymentType(match[1]) : '';
  }

  function formatMoney(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '';
    return `$${number.toLocaleString('en-US', { maximumFractionDigits: Number.isInteger(number) ? 0 : 2 })}`;
  }

  function formatSalary(raw) {
    if (!raw) return '';
    const isHourly = /(?:per\s+)?(?:hour|hr|\/hr|HOUR)/i.test(raw);
    const amounts = [];
    const amountPattern = /\$?\s*([\d,]+(?:\.\d{2})?)\s*(k)?/gi;
    let match;

    while ((match = amountPattern.exec(raw)) !== null) {
      let amount = Number(match[1].replace(/,/g, ''));
      if (!Number.isFinite(amount) || amount <= 0) continue;
      if (match[2] || /k/i.test(raw.slice(match.index + match[0].length, match.index + match[0].length + 2))) {
        amount *= 1000;
      }
      if (amount >= 8) amounts.push(amount);
    }

    if (amounts.length === 0) return cleanText(raw);
    const unit = isHourly ? 'per hour' : 'per year';
    if (amounts.length >= 2) {
      const min = Math.min(amounts[0], amounts[1]);
      const max = Math.max(amounts[0], amounts[1]);
      return `${formatMoney(min)}-${formatMoney(max)} ${unit}`;
    }
    return `${formatMoney(amounts[0])} ${unit}`;
  }

  function extractSalary(jsonLd, description) {
    const salaryValue = jsonLd?.baseSalary?.value;
    if (salaryValue) {
      const min = salaryValue.minValue || salaryValue.value;
      const max = salaryValue.maxValue;
      const unit = salaryValue.unitText || '';
      if (min && max) return formatSalary(`${min} - ${max} ${unit}`);
      if (min) return formatSalary(`${min} ${unit}`);
    }

    const patterns = [
      /(?:base\s+salary|salary|compensation|pay)\s*(?:range|ranges)?\s*(?:of|from|is|:)?\s*\$?[\d,]+(?:\.\d{2})?\s*k?\s*(?:-|to|through)\s*\$?[\d,]+(?:\.\d{2})?\s*k?(?:\s*(?:per\s+)?(?:year|annually|annual|hour|hr|\/hr))?/i,
      /\$?[\d,]+(?:\.\d{2})?\s*k?\s*(?:-|to)\s*\$?[\d,]+(?:\.\d{2})?\s*k?\s*(?:per\s+)?(?:year|annually|annual|hour|hr|\/hr)/i,
      /(?:salary|compensation|pay)\s*(?:is|:)?\s*\$?[\d,]+(?:\.\d{2})?\s*k?\s*(?:per\s+)?(?:year|annually|annual|hour|hr|\/hr)/i,
      /\$?[\d,]+(?:\.\d{2})?\s*k?\s*(?:per\s+)?(?:year|annually|annual|hour|hr|\/hr)/i
    ];

    for (const pattern of patterns) {
      const match = description.match(pattern);
      if (match) return formatSalary(match[0]);
    }

    return '';
  }

  function extractExperience(description) {
    const qualifications = extractSection(description, /(requirements?|qualifications?|what you'?ll need|what we'?re looking for|must have|credentials?)[:\s]/i);
    const text = qualifications || description;
    const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
    const candidateLines = lines.filter(line => /\b(experience|experienced|minimum|min\.?|at least|required|practice setting|years in practice)\b/i.test(line));
    const patterns = [
      /\b(\d+)\s*(?:-|to)\s*(\d+)\s*(?:years?|yrs?)\b/i,
      /\b(?:minimum|min\.?|at least)\s*(\d+)\+?\s*(?:years?|yrs?)\b/i,
      /\b(\d+)\+?\s*(?:years?|yrs?)\s+(?:of\s+)?experience\b/i
    ];

    for (const line of candidateLines) {
      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (!match) continue;
        if (match[2]) return `${match[1]}-${match[2]} years`;
        return `${match[1]}+ years`;
      }
    }

    return '';
  }

  function extractSection(text, startPattern) {
    const match = text.match(startPattern);
    if (!match) return '';
    const start = match.index;
    const after = text.slice(start, start + 1000);
    const endMatch = after.slice(match[0].length).search(/\n\s*(benefits?|compensation|salary|about|our culture|location|equal opportunity|apply|why)\b/i);
    return endMatch >= 0 ? after.slice(0, match[0].length + endMatch) : after;
  }

  function hasSpecialtySignal(text) {
    return /\b(board certified|residency[-\s]+trained|diplomate|dacv(?:ecc|im|r|s|d|o|aa)?|criticalist|oncologist|cardiologist|dermatologist|neurologist|neurosurgeon|ophthalmologist|radiologist|anesthesiologist|internist|surgeon|specialist)\b/i.test(text || '');
  }

  function determineAreaOfPractice(title, description) {
    const combined = `${title}\n${description}`;
    if (isExoticPetMedicineRole(title, description)) return 'Exotic Pet Medicine';
    if (hasSpecialtySignal(combined)) return 'Specialty Care';
    if (/\burgent care\b/i.test(combined)) return 'Urgent Care';
    if (/\b(emergency|er veterinarian|er vet|critical care|ecc)\b/i.test(combined)) return 'Emergency Care';
    if (/\b(equine|bovine|large animal)\b/i.test(combined)) return 'General Practice Care / Emergency Care / Urgent Care';
    if (/\b(veterinarian|dvm|vmd|medical director|lead veterinarian|general practice|clinic|hospital)\b/i.test(combined)) return 'General Practice Care';
    return '';
  }

  function matchPosition(text) {
    const t = (text || '').toLowerCase();
    const rules = [
      ['Medical Director', /\bmedical director\b/],
      ['Lead Veterinarian', /\blead veterinarian\b|\blead vet\b/],
      ['Neurologist & Neurosurgeon', /\bneurologist\b|\bneurosurgeon\b|\bneurology\b/],
      ['Dermatologist', /\bdermatologist\b|\bdermatology\b/],
      ['Cardiologist', /\bcardiologist\b|\bcardiology\b/],
      ['Radiation Oncologist', /\bradiation oncolog/],
      ['Medical Oncologist', /\bmedical oncolog|\boncologist\b|\boncology\b/],
      ['Radiologist', /\bradiologist\b|\bradiology\b|\bdiagnostic imaging\b/],
      ['Ophthalmologist', /\bophthalmologist\b|\bophthalmology\b/],
      ['Anesthesiologist', /\banesthesiologist\b|\banesthesia\b/],
      ['Internal Medicine Specialist', /\binternist\b|\binternal medicine\b/],
      ['ECC Specialist', /\bcriticalist\b|\becc specialist\b|\bemergency\s*(?:and|&)?\s*critical care\b|\bdacvecc\b/],
      ['DABVP Specialist', /\bdabvp\b/],
      ['Dental Specialist', /\bdental specialist\b|\bveterinary dentist\b|\boral surgeon\b|\bdavdc\b/],
      ['Surgeon', /\bsurgeon\b|\bsurgery\b|\bdacvs\b|\bacvs\b/],
      ['Credentialed Veterinary Technician Specialist', /\bcredentialed veterinary technician specialist\b|\btechnician specialist\b|\bvts\b/],
      ['Partner Veterinarian', /\bpartner veterinarian\b|\bpartner vet\b/],
      ['Associate Veterinarian', /\bassociate veterinarian\b|\bassociate vet\b|\bveterinarian\b|\bdvm\b|\bvmd\b/]
    ];

    for (const [position, pattern] of rules) {
      if (pattern.test(t)) return position;
    }

    return '';
  }

  function validatePosition(position, areaOfPractice, title) {
    if (!APPROVED_POSITION_SET.has(position)) return defaultPosition(areaOfPractice, title);

    const parts = (areaOfPractice || '').split('/').map(part => part.trim()).filter(Boolean);
    if (parts.length === 0) return position;

    if (parts.some(part => VALID_POSITIONS_BY_AOP[part]?.includes(position))) return position;
    return defaultPosition(areaOfPractice, title);
  }

  function defaultPosition(areaOfPractice, title) {
    if (/partner veterinarian|partner vet/i.test(title || '') && /Urgent Care/i.test(areaOfPractice || '')) {
      return 'Partner Veterinarian';
    }
    if (/(General Practice Care|Emergency Care|Urgent Care|Exotic Pet Medicine)/i.test(areaOfPractice || '')) {
      return 'Associate Veterinarian';
    }
    return '';
  }

  function isExoticPetMedicineRole(title, description) {
    if (/\b(avian|exotics?|exotic pets?|pocket pets?|reptiles?|small mammals?)\b/i.test(title || '')) return true;
    const opening = (description || '').slice(0, 1200);
    const qualifications = extractSection(description || '', /(requirements?|qualifications?|what you'?ll need|what we'?re looking for|must have|credentials?)[:\s]/i);
    const roleText = `${opening}\n${qualifications}`;

    return /\b(avian|exotic)\s+(?:veterinarian|patients?|medicine)\b/i.test(roleText) ||
      /\bseeing\s+avian\s+and\s+exotic\s+patients\s+exclusively\b/i.test(roleText) ||
      /\b(avbp|zoological medicine|small mammal|reptile|amphibian)\b/i.test(roleText);
  }

  const jsonLd = getJsonLdData();
  const description = getDescription(jsonLd);
  const title = getTitle(jsonLd, description);
  const areaOfPractice = determineAreaOfPractice(title, description);
  const matchedPosition = matchPosition(`${title}\n${extractSection(description, /(requirements?|qualifications?|what you'?ll need|what we'?re looking for|must have|credentials?)[:\s]/i)}`);

  return {
    areaOfPractice,
    position: validatePosition(matchedPosition, areaOfPractice, title),
    salary: extractSalary(jsonLd, description),
    jobType: extractJobType(jsonLd, description),
    experience: extractExperience(description),
    hospitalName: getHospitalName(jsonLd, description),
    description
  };
})();
