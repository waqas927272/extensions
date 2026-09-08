'use strict';

// One shared rule for listing collection, saved records, and description queues.
// Role detection ignores description prose: staff adverts often mention DVMs.
if (!globalThis.ThriveJobFilter) {
  const normalizeRoleText = value => String(value || '').normalize('NFKC')
    .replace(/[‐‑–—]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();

  function exclusionReason(job) {
    // Check employer/hospital identity at every stage, including legacy records
    // whose employer is only present in the saved Jobvite Specifics block.
    const specifics = job?.jobviteSpecifics || {};
    const legacy = job?.jobviteDetails?.specifics || {};
    const description = String(job?.description || job?.jobviteDetails?.fullText || '');
    const sourceCompany = /^Specifics\s*\r?\n/i.test(description.trim())
      ? description.split(/\r?\nDescription\s*(?:\r?\n|$)/i)[0].match(/^Company:\s*([^\r\n]+)/im)?.[1] : '';
    const identities = [job?.title, job?.primaryHospital, job?.hospital, job?.hospitalName,
      job?.company, job?.listingCompany, specifics.company, specifics.Company,
      legacy.company, legacy.Company, sourceCompany];
    if (identities.some(value => /\bunited\s+veterinary\s+care\b/.test(normalizeRoleText(value)))) {
      return 'United Veterinary Care';
    }
    const title = normalizeRoleText(job?.title);
    const category = normalizeRoleText(
      job?.jobviteSpecifics?.category || job?.jobviteSpecifics?.Category ||
      job?.category || job?.listingCategory || job?.jobviteDetails?.specifics?.category
    );
    const role = title + ' ' + category;
    if (/\bsupport[\s-]*(?:center|centre)\b/.test(role)) return 'Support Center';
    if (/\bassistants?\b/.test(title) && !/\bassistant\s+(?:veterinary\s+)?medical\s+director\b/.test(title)) return 'Non-DVM role';

    // Reject non-doctor roles even if the title/category contains "DVM" or "vet".
    if (/\b(?:technicians?|technologists?|nurs(?:e|es|ing)|receptionists?|recruit(?:er|ers|ing|ment)|recruitment|coordinators?|groom(?:er|ers|ing)|kennel|custodi(?:an|al)|janitor|bookkeep(?:er|ing)|payroll|account(?:ant|ing)|marketing|human resources|customer service|client (?:service|care|experience)|practice manager|hospital (?:manager|administrator)|office manager|operations|business development)\b/.test(role) ||
        /\b(?:techs?|cvt|lvt|rvt|rvn|lpn|rn|vts|csr)\b/.test(role) ||
        /\b(?:veterinary|veterinarian|vet|dvm|vmd|doctor|medical|surgical|administrative|executive|hospital|clinic)\s+(?:care\s+)?assistants?\b/.test(role) ||
        /\bassistant\s+(?:hospital|practice|office)\s+manager\b/.test(role) ||
        /\bstudents?\b(?!\s+loan\b)|\b(?:externs?|externships?|pre[-\s]?vet(?:erinary)?|ambassadors?)\b/.test(role)) {
      return 'Non-DVM role';
    }

    const doctor = /\b(?:veterinarians?|dvm|vmd)\b|\bd\.\s*v\.\s*m\.?|\bv\.\s*m\.\s*d\.?/;
    if (doctor.test(title)) return '';
    if (/\b(?:associate|lead|relief|locum|emergency|urgent care|equine|small animal)\s+vet\b/.test(title) || /^vet(?:\s*\((?:jr)?\d+\))?$/.test(title)) return '';
    // On Thrive, these are veterinarian leadership and specialist roles.
    if (/\b(?:medical director|chief (?:medical|veterinary) officer)\b/.test(title)) return '';
    const specialty = /\b(?:surgeon|cardiologist|oncologist|neurologist|neurosurgeon|dermatologist|ophthalmologist|radiologist|anesthesiologist|anaesthetist|internist|criticalist|dentist|theriogenologist|pathologist|internal medicine specialist|dental specialist|ecc specialist|dabvp specialist)\b/;
    if (specialty.test(title) && /\b(?:veterinary|vet|small animal|equine|animal)\b/.test(title)) return '';
    // Explicit listing categories may identify a doctor role with a short title.
    if (/^(?:veterinarian|veterinarians|dvm|vmd|veterinary specialist|veterinary specialists|doctors)(?:\b|$)/.test(category)) return '';
    return 'Not identified as a DVM role';
  }

  globalThis.ThriveJobFilter = Object.freeze({
    exclusionReason,
    isDvmJob: job => !!job && !exclusionReason(job)
  });
}
