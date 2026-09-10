(function initializeAreaPracticeUtils(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.InnovetiveAreaPracticeUtils = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  function normalizeText(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function firstDescriptionChars(value, length) {
    const source = normalizeText(value);
    const descriptionIndex = source.search(/\bDescription\b/i);
    return source.slice(descriptionIndex >= 0 ? descriptionIndex : 0, (descriptionIndex >= 0 ? descriptionIndex : 0) + length);
  }

  function qualificationsSection(value) {
    const source = normalizeText(value);
    const match = source.match(/(?:requirements?|qualifications?|what you'?ll need|what we'?re looking for|must have|credentials?)[:\s]/i);
    return match ? source.slice(match.index, match.index + 2200) : '';
  }

  function isExoticPetMedicineRole(title, description) {
    const titleText = normalizeText(title);
    if (/\b(avian|exotics?|exotic pets?|pocket pets?|reptiles?|small mammals?)\b/i.test(titleText)) return true;

    const roleText = normalizeText(`${firstDescriptionChars(description, 900)}\n${qualificationsSection(description)}`);
    return /\b(avian|exotic)\s+(?:veterinarian|patients?|medicine)\b/i.test(roleText) ||
      /\bseeing\s+avian\s+and\s+exotic\s+patients\s+exclusively\b/i.test(roleText) ||
      /\b(avbp|zoological medicine|small mammal|reptile|amphibian)\b/i.test(roleText);
  }

  /**
   * Returns true only when urgent care describes the job itself. A hospital can
   * offer urgent-care appointments without the advertised role being an
   * urgent-care position, so a bare description mention is intentionally not
   * enough.
   */
  function hasPrimaryUrgentCareSignal(title, description) {
    const normalizedTitle = normalizeText(title);
    const normalizedDescription = normalizeText(description);

    // The posting title is the strongest source for the role's practice area.
    if (/\burgent[-\s]+care\b/i.test(normalizedTitle)) return true;

    // Role-oriented language in the description is strong enough even when a
    // generic title such as "Associate Veterinarian" is used.
    const rolePatterns = [
      /\burgent[-\s]+care\s+(?:associate\s+)?(?:veterinarian|doctor|dvm|vmd|position|role|team|department|practice|clinic|hospital|center)\b/i,
      /\b(?:veterinarian|doctor|dvm|vmd|position|role)\s+(?:in|for|within|on)\s+(?:an?\s+|our\s+|the\s+)?urgent[-\s]+care\b/i,
      /\b(?:join|lead|manage)\s+(?:an?\s+|our\s+|the\s+)?urgent[-\s]+care\s+(?:team|department|practice|clinic|hospital|center)\b/i,
      /\b(?:seeking|hiring|recruiting|looking\s+for)\b[^.!?]{0,120}\burgent[-\s]+care\s+(?:veterinarian|doctor|dvm|vmd|position|role)\b/i,
      /\b(?:primary\s+focus|focused|dedicated|specializ(?:e|es|ed|ing))\b[^.!?]{0,100}\burgent[-\s]+care\b/i
    ];

    return rolePatterns.some(pattern => pattern.test(normalizedDescription));
  }

  function classifyGeneralPracticeRole(title, description) {
    return hasPrimaryUrgentCareSignal(title, description)
      ? 'General Practice Care / Urgent Care'
      : 'General Practice Care';
  }

  function hasStaleUrgentCareClassification(storedArea, recalculatedArea) {
    const splitAreas = value => String(value || '')
      .split('/')
      .map(area => area.trim())
      .filter(Boolean);
    const storedAreas = splitAreas(storedArea);
    const recalculatedAreas = splitAreas(recalculatedArea);
    return storedAreas.includes('Urgent Care') && !recalculatedAreas.includes('Urgent Care');
  }

  function determineAreaOfPractice(title, description) {
    const titleText = normalizeText(title);
    const focusText = normalizeText(`${titleText}\n${firstDescriptionChars(description, 1400)}`);
    const generalRoleArea = classifyGeneralPracticeRole(titleText, focusText);

    if (isExoticPetMedicineRole(titleText, description)) return 'Exotic Pet Medicine';

    if (/\b(?:gp\s*(?:\/|&|\+|-|and)\s*er|er\s*(?:\/|&|\+|-|and)\s*gp)\s+hybrid\b/i.test(titleText) ||
        /\b(?:general practice\s*(?:\/|&|\+|-|and)\s*emergency|emergency\s*(?:\/|&|\+|-|and)\s*general practice)\s+hybrid\b/i.test(titleText)) {
      return 'Emergency Care';
    }

    if (/\bmixed[-\s]+animal\b/i.test(titleText) ||
        /\b(?:true\s+)?mixed[-\s]+animal\s+(?:practice|role|veterinarian|medicine)\b/i.test(focusText)) {
      return 'General Practice Care';
    }

    if (/\bmedical director\b/i.test(titleText) &&
        (/\bspecialty\b/i.test(titleText) ||
         /\b(?:board[-\s]+certified specialist|residency[-\s]+trained veterinarian)\b[^.]{0,180}\bspecialty\b/i.test(focusText))) {
      return 'Specialty Care';
    }

    if (/\bemergency\s+veterinarians?\b/i.test(titleText) &&
        /\bveterinary\s+specialists?\b/i.test(titleText)) {
      return 'Emergency Care';
    }

    if (/\b(board[-\s]+certified|residency[-\s]+trained|diplomate|dacv(?:ecc|im|r|s|d|o|aa)?|criticalist|oncologist|cardiologist|dermatologist|neurologist|neurosurgeon|ophthalmologist|radiologist|anesthesiologist|internist|internal medicine|surgeon|specialist|dentist|dental)\b/i.test(titleText)) {
      return 'Specialty Care';
    }

    if (/\b(general practice|\bgp\b|small animal general practice)\b/i.test(titleText)) return generalRoleArea;

    if (/\binternship\b|\bveterinary intern\b/i.test(titleText)) {
      if (/\b(emergency|er|icu)\b/i.test(focusText) && /\b(general practice|\bgp\b)\b/i.test(focusText)) return 'General Practice Care / Emergency Care';
      if (/\b(emergency|er|icu)\b/i.test(focusText)) return 'Emergency Care';
      return 'General Practice Care';
    }

    if (/\b(emergency|er veterinarian|er vet|critical care|ecc)\b/i.test(titleText)) return 'Emergency Care';
    if (/\burgent[-\s]+care\b/i.test(titleText)) return 'Urgent Care';

    if (/\b(medical director|managing dvm|mdvm|team lead|associate veterinarian|full[-\s]?time veterinarian|part[-\s]?time veterinarian|veterinarian\s*\(part[-\s]?time\)|pt gp dvm)\b/i.test(titleText)) {
      return generalRoleArea;
    }

    if (/\b(emergency veterinarian|24\/7 emergency|emergency hospital|emergency & trauma)\b/i.test(focusText)) return 'Emergency Care';
    if (/\b(general practice|preventive care|wellness|small animal practice|full-service veterinary practice|animal hospital|veterinary clinic)\b/i.test(focusText)) return 'General Practice Care';
    return '';
  }

  return {
    hasPrimaryUrgentCareSignal,
    classifyGeneralPracticeRole,
    hasStaleUrgentCareClassification,
    determineAreaOfPractice
  };
});
