// Cove Detail Extractor - Extracts job details from Paylocity job detail pages
(function () {
  function stripHtml(html) {
    const temp = document.createElement('div');
    temp.innerHTML = html;
    return temp.textContent || temp.innerText || '';
  }

  function extractSalary(text) {
    if (!text) return '';
    const salaryPatterns = [
      /\$[\d,]+k?\s*[-–]+\s*\$?[\d,]+k/i,
      /\$[\d,]+(?:,\d{3})*\s*[-–]+\s*\$[\d,]+(?:,\d{3})*/i,
      /\$[\d,]+(?:\.\d{2})?\s*[-–\/]+\s*\$?[\d,]+(?:\.\d{2})?\s*(?:per\s+)?(?:hourly|hour|hr|\/hr|\/\s*hour)/i,
      /\$[\d,]+(?:\.\d{2})?\s*[-–]+\s*\$?[\d,]+(?:\.\d{2})?\s*(?:per\s+)?(?:year|annually|annum|annual)/i,
      /\$[\d,]+(?:\.\d{2})?\s*(?:per\s+)?(?:hourly|hour|hr|\/hr|\/\s*hour)/i,
      /\$[\d,]+(?:\.\d{2})?\s*(?:per\s+)?(?:year|annually|annum|annual)/i,
      /salary\s+range[^.\n]*?\$[\d,]+k?[^.\n]{0,40}/i,
      /pay[:\s]+\$[\d,]+(?:\.\d{2})?[^.\n]{0,60}/i,
      /compensation[:\s]+\$[\d,]+[^.\n]{0,60}/i,
      /\$[\d]{2,3}(?:,\d{3})*k?\s*[-–]+\s*\$?[\d]{2,3}(?:,\d{3})*k?/i,
      /\$[\d,]+k\+?/i
    ];
    for (const pattern of salaryPatterns) {
      const m = text.match(pattern);
      if (m) {
        let sal = m[0].trim().replace(/[.,;:\s]+$/, '').trim();
        if (sal.length > 100) sal = sal.substring(0, 100).trim();
        return sal;
      }
    }
    const negMatch = text.match(/(?:salary|compensation)\s+(?:is\s+)?negotiable/i);
    if (negMatch) return 'Negotiable';
    return '';
  }

  function extractHospitalName(text) {
    if (!text) return '';
    const patterns = [
      /\b([\w'.&-]+(?:\s+[\w'.&-]+){0,5}\s+(?:Veterinary\s+(?:Clinic|Hospital|Center|Care|Practice|Group)|Animal\s+(?:Hospital|Clinic|Care|Center)|Pet\s+(?:Hospital|Clinic|Care|Center)|Emergency\s+(?:Hospital|Center|Clinic)))\b/i,
      /\b([\w'.&-]+(?:\s+[\w'.&-]+){0,5}\s+(?:Veterinary))\b/i
    ];
    for (const pattern of patterns) {
      const m = text.match(pattern);
      if (m) {
        let name = m[1].trim();
        name = name.replace(/^(the|a|an|our|at)\s+/i, '').trim();
        if (name.length >= 5 && name.length <= 100) return name;
      }
    }
    return '';
  }

  // Extract position and hospital from description text patterns (same as VCA scrapper)
  function extractPositionAndHospital(text) {
    if (!text) return { position: '', hospital: '' };

    // PATTERN GROUP 1: "[position] at [hospital]" format
    const positionAtHospitalPatterns = [
      { regex: /join\s+us\s+as\s+(?:an?\s+)?(?:board[- ]certified\s+)?(?:or\s+)?(?:residency[- ]trained\s+)?(.+?)\s+at\s+([^.!?\n]+?(?:Hospital|Center|Clinic|Care|Specialists?|Veterinary|Animal|Emergency|Medical)[^.!?\n]*?)(?:\.|!|\n|$)/i, posIndex: 1, hospIndex: 2 },
      { regex: /join\s+us\s+as\s+(?:an?\s+)?(.+?)\s+at\s+([^.!?\n]+?(?:Hospital|Center|Clinic|Care|Specialists?|Veterinary|Animal|Emergency|Medical)[^.!?\n]*?)(?:\.|!|\n|$)/i, posIndex: 1, hospIndex: 2 },
      { regex: /seeking\s+(?:an?\s+)?(.+?)\s+at\s+([^.!?\n]+?(?:Hospital|Center|Clinic|Care|Specialists?|Veterinary|Animal|Emergency|Medical)[^.!?\n]*?)(?:\.|!|\n|$)/i, posIndex: 1, hospIndex: 2 },
      { regex: /looking\s+for\s+(?:an?\s+)?(.+?)\s+at\s+([^.!?\n]+?(?:Hospital|Center|Clinic|Care|Specialists?|Veterinary|Animal|Emergency|Medical)[^.!?\n]*?)(?:\.|!|\n|$)/i, posIndex: 1, hospIndex: 2 }
    ];

    // PATTERN GROUP 2: "[hospital] located/in [location] is looking/seeking for [position]" format
    const hospitalFirstPatterns = [
      { regex: /^([^,.!?\n]+(?:Hospital|Center|Clinic|Care|Veterinary|Animal|Emergency|Medical)[^,.!?\n]*?)\s+located\s+in\s+[^,.]+?,\s*[A-Z]{2}\s+is\s+(?:looking|seeking)\s+for\s+(?:a\s+|an\s+)?(.+?)(?:\.|!|\n|$)/i, hospIndex: 1, posIndex: 2 },
      { regex: /([^,.!?\n]+(?:Hospital|Center|Clinic|Care|Veterinary|Animal|Emergency|Medical)[^,.!?\n]*?)\s+located\s+in\s+[^,.]+?,\s*[A-Z]{2}\s+is\s+(?:looking|seeking)\s+for\s+(?:a\s+|an\s+)?(.+?)(?:\.|!|\n|$)/i, hospIndex: 1, posIndex: 2 },
      { regex: /^([^,.!?\n]+(?:Hospital|Center|Clinic|Care|Veterinary|Animal|Emergency|Medical)[^,.!?\n]*?)\s+in\s+[^,.]+?,\s*[A-Z]{2}\s+is\s+(?:looking|seeking)\s+for\s+(?:a\s+|an\s+)?(.+?)(?:\.|!|\n|$)/i, hospIndex: 1, posIndex: 2 },
      { regex: /([^,.!?\n]+(?:Hospital|Center|Clinic|Care|Veterinary|Animal|Emergency|Medical)[^,.!?\n]*?)\s+in\s+[^,.]+?,\s*[A-Z]{2}\s+is\s+(?:looking|seeking)\s+for\s+(?:a\s+|an\s+)?(.+?)(?:\.|!|\n|$)/i, hospIndex: 1, posIndex: 2 }
    ];

    // PATTERN GROUP 3: "looking for a dedicated [position] to join" (no hospital in same sentence)
    const positionOnlyPatterns = [
      /looking\s+for\s+(?:a\s+|an\s+)?(?:dedicated\s+|experienced\s+|skilled\s+)?(.+?)(?:\s+to\s+join|\s+for\s+our|\s+who)/i,
      /seeking\s+(?:a\s+|an\s+)?(?:dedicated\s+|experienced\s+|skilled\s+)?(.+?)(?:\s+to\s+join|\s+for\s+our|\s+who)/i,
      /join\s+(?:us|our\s+team)\s+as\s+(?:a\s+|an\s+)?(.+?)(?:\.|!|\n|$)/i
    ];

    // Try Pattern Group 1 first (position at hospital)
    for (const pattern of positionAtHospitalPatterns) {
      const match = text.match(pattern.regex);
      if (match) {
        let position = match[pattern.posIndex].trim();
        let hospital = match[pattern.hospIndex].trim();
        position = position.replace(/\s+(?:to\s+join|for|with|in|on)\s*$/i, '').trim();
        hospital = hospital.replace(/[\s,;:.!]+$/, '').trim();
        const hospitalEndMatch = hospital.match(/^([^,;.\n]+(?:Hospital|Center|Clinic|Care|Specialists?|Veterinary|Animal|Emergency|Medical))/i);
        if (hospitalEndMatch) hospital = hospitalEndMatch[1].trim();
        if (position.length > 100) position = position.substring(0, 100).trim();
        if (hospital.length > 100) hospital = hospital.substring(0, 100).trim();
        if (position.length >= 3 && hospital.length >= 5) {
          return { position, hospital };
        }
      }
    }

    // Try Pattern Group 2 (hospital first format)
    for (const pattern of hospitalFirstPatterns) {
      const match = text.match(pattern.regex);
      if (match) {
        let hospital = match[pattern.hospIndex].trim();
        let position = match[pattern.posIndex].trim();
        hospital = hospital.replace(/[\s,;:.!]+$/, '').trim();
        position = position.replace(/[\s,;:.!\n]+$/, '').trim();
        position = position.replace(/\s+(?:to\s+join|for|with)\s*$/i, '').trim();
        if (position.length > 100) position = position.substring(0, 100).trim();
        if (hospital.length > 100) hospital = hospital.substring(0, 100).trim();
        if (position.length >= 3 && hospital.length >= 5) {
          return { position, hospital };
        }
      }
    }

    // Try Pattern Group 3 (position only)
    for (const pattern of positionOnlyPatterns) {
      const match = text.match(pattern);
      if (match) {
        let position = match[1].trim();
        position = position.replace(/[\s,;:.!\n]+$/, '').trim();
        if (position.length >= 3 && position.length <= 100) {
          return { position, hospital: '' };
        }
      }
    }

    return { position: '', hospital: '' };
  }

  // Area of Practice keyword mapping from jobs.docx (same as VCA scrapper)
  const areaOfPracticeMap = [
    {
      area: 'General Practice Care',
      keywords: ['medical director', 'veterinarian medical director', 'associate veterinarian', 'gp vet', 'quick care veterinarian', 'dvm', 'vmd', 'relief veterinarian', 'relief dvm', 'locum veterinarian', 'veterinarian']
    },
    {
      area: 'Emergency Care',
      keywords: ['emergency veterinarian', 'er vet', 'er veterinarian', 'er dvm', 'urgent care veterinarian', 'relief emergency veterinarian', 'relief emergency vet']
    },
    {
      area: 'Urgent Care',
      keywords: ['urgent care veterinarian', 'urgent veterinarian']
    },
    {
      area: 'General Practice Care / Emergency Care / Urgent Care',
      keywords: ['equine veterinarian', 'equine vet', 'bovine veterinarian', 'large animal', 'equine dvm', 'avian veterinarian', 'exotics veterinarian', 'avian vet', 'exotics vet', 'associate exotics veterinarian', 'avian & exotics', 'equine/bovine']
    },
    {
      area: 'Specialty Care',
      keywords: ['criticalist', 'dacvecc', 'board certified criticalist', 'residency trained criticalist', 'emergency & critical care', 'ecc',
        'medical oncologist', 'oncologist', 'dacvim', 'acvim', 'medonc',
        'radiation oncologist', 'dacvr-ro', 'radonc',
        'internal medicine specialist', 'internist', 'veterinary internist', 'saim', 'small animal internal medicine',
        'neurologist', 'neurosurgeon', 'veterinary neurologist',
        'cardiologist', 'veterinary cardiologist', 'small animal cardiologist',
        'dentist', 'oral surgeon', 'dentist & oral surgeon', 'davdc',
        'dermatologist', 'veterinary dermatologist', 'dacvd', 'acvd',
        'surgeon', 'veterinary surgery', 'dacvs', 'acvs', 'small animal surgeon',
        'radiologist', 'veterinary radiologist', 'diagnostic imaging specialist', 'dacvr', 'acvr',
        'ophthalmologist', 'veterinary ophthalmologist', 'dacvo', 'acvo',
        'anesthesiologist', 'veterinary anesthesiologist', 'dacvaa', 'acvaa',
        'theriogenologist', 'veterinary theriogenologist', 'dact',
        'rehabilitation therapist', 'ccrt', 'canine rehabilitation',
        'veterinary technician specialist', 'vts', 'vts anesthesia', 'vts ecc', 'vts emergency', 'vts dentistry', 'vts internal medicine', 'vts neurology', 'vts cardiology', 'vts dermatology', 'vts ophthalmology', 'vts ophtho', 'vts diagnostic imaging',
        'residency trained', 'board certified', 'veterinary specialist', 'specialty doctor']
    }
  ];

  function lookupAreaOfPractice(positionText) {
    if (!positionText) return '';
    const posLower = positionText.toLowerCase();
    // Check from most specific (Specialty) to least specific
    for (let i = areaOfPracticeMap.length - 1; i >= 0; i--) {
      const entry = areaOfPracticeMap[i];
      for (const kw of entry.keywords) {
        if (posLower.includes(kw)) {
          return entry.area;
        }
      }
    }
    return '';
  }

  const result = {
    hospitalName: '',
    streetAddress: '',
    city: '',
    state: '',
    postalCode: '',
    jobType: '',
    salary: '',
    position: '',
    areaOfPractice: ''
  };

  // Source 1: JSON-LD structured data (most reliable)
  const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const s of ldScripts) {
    try {
      const ld = JSON.parse(s.textContent);
      if (ld['@type'] === 'JobPosting') {
        if (ld.title) {
          result.position = ld.title;
        }
        if (ld.jobLocation && ld.jobLocation.address) {
          const addr = ld.jobLocation.address;
          result.streetAddress = addr.streetAddress || '';
          result.city = addr.addressLocality || '';
          result.state = addr.addressRegion || '';
          result.postalCode = addr.postalCode || '';
        }
        if (ld.description) {
          const descText = stripHtml(ld.description);
          if (!result.salary) result.salary = extractSalary(descText);
          if (!result.hospitalName) result.hospitalName = extractHospitalName(descText);

          // Extract position and hospital from description text patterns
          const extracted = extractPositionAndHospital(descText);
          if (extracted.position) result.position = extracted.position;
          if (extracted.hospital) result.hospitalName = extracted.hospital;
        }
        break;
      }
    } catch (e) { /* skip */ }
  }

  // Source 2: DOM - Job Type from "Job Type" header, description fallback
  const headers = document.querySelectorAll('.job-listing-header');
  for (const header of headers) {
    const headerText = header.textContent.trim();
    if (headerText === 'Job Type' && header.nextElementSibling) {
      result.jobType = header.nextElementSibling.textContent.trim();
    }
    if (headerText === 'Description' && header.nextElementSibling) {
      const descText = header.nextElementSibling.innerText || '';
      if (!result.salary) result.salary = extractSalary(descText);
      if (!result.hospitalName) result.hospitalName = extractHospitalName(descText);

      // Try extracting position/hospital from DOM description too
      if (!result.position || !result.hospitalName) {
        const extracted = extractPositionAndHospital(descText);
        if (!result.position && extracted.position) result.position = extracted.position;
        if (!result.hospitalName && extracted.hospital) result.hospitalName = extracted.hospital;
      }
    }
  }

  // Source 3: Location from preview-location link
  if (!result.city || !result.state) {
    const locLink = document.querySelector('.preview-location a');
    if (locLink) {
      const locText = locLink.textContent.trim();
      const parts = locText.split(',').map(s => s.trim());
      if (parts[0] && !result.city) result.city = parts[0];
      if (parts[1] && !result.state) result.state = parts[1];
    }
  }

  // Source 4: Position from DOM job title
  if (!result.position) {
    const titleSpan = document.querySelector('.job-preview-title span');
    if (titleSpan) {
      result.position = titleSpan.textContent.trim();
    }
  }

  // Source 5: Breadcrumb title as position fallback
  if (!result.position) {
    const breadcrumbTitle = document.querySelector('.breadcrumb-title');
    if (breadcrumbTitle) {
      result.position = breadcrumbTitle.textContent.trim();
    }
  }

  // Source 6: og:title meta tag as fallback for hospital name
  if (!result.hospitalName) {
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) {
      const titleContent = ogTitle.getAttribute('content') || '';
      // Format: "Pieper Veterinary - Job Title"
      const parts = titleContent.split(' - ');
      if (parts.length > 1) {
        result.hospitalName = parts[0].trim();
      }
    }
  }

  // Lookup area of practice based on position (using jobs.docx keyword mapping)
  if (result.position) {
    result.areaOfPractice = lookupAreaOfPractice(result.position);
  }

  // If no area of practice found from position, also try scanning the full description
  if (!result.areaOfPractice) {
    const descEl = document.querySelector('.job-listing-header + div');
    if (descEl) {
      const fullText = descEl.innerText || '';
      result.areaOfPractice = lookupAreaOfPractice(fullText);
    }
  }

  return result;
})();
