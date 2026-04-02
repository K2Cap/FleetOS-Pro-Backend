function cleanString(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

function flattenOcrPayload(value) {
  const flat = {};
  const walk = (input) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return;
    Object.entries(input).forEach(([key, nestedValue]) => {
      if (nestedValue && typeof nestedValue === 'object' && !Array.isArray(nestedValue)) {
        walk(nestedValue);
      } else {
        flat[key] = nestedValue;
      }
    });
  };
  walk(value);
  return flat;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const cleaned = cleanString(value);
    if (cleaned) return cleaned;
  }
  return null;
}

function normalizeRegNo(value) {
  const cleaned = String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!cleaned) return null;
  return /^[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{1,4}$/.test(cleaned) ? cleaned : null;
}

function normalizeRawText(value) {
  return String(value || '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function sanitizePersonOrgName(value) {
  const raw = String(value || '')
    .replace(/[^A-Za-z0-9&.,()\/ -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return null;
  const lowered = raw.toLowerCase();
  const blocked = [
    'insurance provider',
    'policy as per details given',
    'as per details given',
    'fitness cert no',
    'puc cert no',
    'permit no',
    'engine no',
    'motor no',
    'chassis no',
  ];
  if (blocked.some((item) => lowered.includes(item))) return null;
  return raw;
}

function sanitizeDocNumber(value) {
  const raw = String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9\/-]/g, '');
  if (!raw) return null;
  if (/(CERT|CERTIFICATE|POLICY|PERMIT|PUC|FITNESS|NUMBER|DETAILS)/.test(raw) && !/\d{3,}/.test(raw)) {
    return null;
  }
  return raw.length >= 4 ? raw : null;
}

function cleanupIdentifierCandidate(token, kind) {
  if (!token) return null;
  let cleaned = String(token || '')
    .toUpperCase()
    .replace(/[\s:;,_./\\|()[\]{}]+/g, '');

  cleaned = cleaned
    .replace(/^(CHASSISNO|CHASSISNUMBER|CHASSIS|VINNO|VINNUMBER|VIN)+/, '')
    .replace(/^(ENGINENO|ENGINENUMBER|ENGINE|MOTORNO|MOTORNUMBER|MOTOR)+/, '')
    .replace(/^(NO|NUMBER)+/, '')
    .replace(/(CHASSISNO|CHASSISNUMBER|CHASSIS|VINNO|VINNUMBER|VIN)+$/, '')
    .replace(/(ENGINENO|ENGINENUMBER|ENGINE|MOTORNO|MOTORNUMBER|MOTOR)+$/, '')
    .replace(/(NO|NUMBER)+$/, '');

  if (kind === 'chassis') {
    cleaned = cleaned.replace(/[IL]{1,3}$/g, '');
  }

  cleaned = cleaned.replace(/[^A-Z0-9]/g, '');
  if (!cleaned || !/[A-Z]/.test(cleaned) || !/\d/.test(cleaned)) return null;

  if (kind === 'chassis') {
    if (cleaned.length < 14 || cleaned.length > 22) return null;
  } else if (kind === 'engine') {
    if (cleaned.length < 6 || cleaned.length > 22) return null;
  }

  return cleaned;
}

function extractCandidatesFromText(text) {
  return Array.from(new Set(
    String(text || '')
      .toUpperCase()
      .match(/[A-Z0-9][A-Z0-9\s:/._-]{4,40}/g) || []
  ));
}

function extractLabeledSegments(text, labels) {
  const segments = [];
  const body = normalizeRawText(text);
  if (!body) return segments;
  const escaped = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(?:${escaped.join('|')})\\s*[:\\-]?\\s*([^\\n]{0,48})`, 'gi');
  let match;
  while ((match = pattern.exec(body))) {
    if (match[1]) segments.push(match[1]);
  }
  return segments;
}

function scoreIdentifier(candidate, kind) {
  if (!candidate) return -1;
  let score = 0;
  if (/[A-Z]/.test(candidate)) score += 3;
  if (/\d/.test(candidate)) score += 3;
  if (/^[A-Z0-9]+$/.test(candidate)) score += 2;
  if (kind === 'chassis') {
    if (candidate.length === 17) score += 8;
    else if (candidate.length === 18) score += 6;
    else score += Math.max(0, 4 - Math.abs(candidate.length - 17));
    if (/\d{5,}$/.test(candidate)) score += 2;
  } else {
    if (candidate.length >= 8 && candidate.length <= 18) score += 5;
    if ((candidate.match(/\d/g) || []).length >= 3) score += 2;
  }
  if (/^(MOTOR|ENGINE|CHASSIS|VIN|NUMBER|NO)/.test(candidate)) score -= 10;
  return score;
}

function chooseIdentifier(rawValues, rawText, labels, kind, options = {}) {
  const { useGlobalText = true, reject = [] } = options;
  const candidates = [];

  rawValues.forEach((value) => {
    const cleaned = cleanupIdentifierCandidate(value, kind);
    if (cleaned) candidates.push(cleaned);
  });

  extractLabeledSegments(rawText, labels).forEach((segment) => {
    extractCandidatesFromText(segment).forEach((candidate) => {
      const cleaned = cleanupIdentifierCandidate(candidate, kind);
      if (cleaned) candidates.push(cleaned);
    });
  });

  if (useGlobalText) {
    extractCandidatesFromText(rawText).forEach((candidate) => {
      const cleaned = cleanupIdentifierCandidate(candidate, kind);
      if (cleaned) candidates.push(cleaned);
    });
  }

  const rejected = new Set(reject.filter(Boolean).map((item) => String(item).toUpperCase()));
  const unique = Array.from(new Set(candidates)).filter((item) => !rejected.has(item));
  unique.sort((left, right) => scoreIdentifier(right, kind) - scoreIdentifier(left, kind));
  return unique[0] || null;
}

function normalizeTruckOcrPayload(payload) {
  const flat = flattenOcrPayload(payload || {});
  const rawText = normalizeRawText(firstNonEmpty(flat._rawText, flat._raw_text, flat.text, flat.rawText));

  const regNo = normalizeRegNo(firstNonEmpty(
    flat['Reg No'],
    flat['Registration Number'],
    flat['Registration No'],
    flat.regNo,
    flat.registration_no,
    flat.registrationNumber
  ));

  const chassisNo = chooseIdentifier(
    [
      flat['Chassis No'],
      flat['Chassis Number'],
      flat['VIN'],
      flat['VIN / Chassis No'],
      flat.chassisNo,
      flat.chassis_number,
    ],
    rawText,
    ['Chassis No', 'Chassis Number', 'Chassis', 'VIN', 'VIN / Chassis No'],
    'chassis'
  );

  const engineNo = chooseIdentifier(
    [
      flat['Engine No'],
      flat['Engine Number'],
      flat['Motor No'],
      flat['Motor Number'],
      flat.engineNo,
      flat.engine_number,
    ],
    rawText,
    ['Engine No', 'Engine Number', 'Engine', 'Motor No', 'Motor Number', 'Motor'],
    'engine',
    { useGlobalText: false, reject: [chassisNo] }
  );

  return {
    regNo,
    ownerName: sanitizePersonOrgName(firstNonEmpty(flat['Owner Name'], flat.ownerName, flat.owner_name)),
    chassisNo,
    engineNo,
    insuranceProvider: sanitizePersonOrgName(firstNonEmpty(flat['Insurance Provider'], flat['Insurer'], flat.insuranceProvider, flat.insurer)),
    policyNo: sanitizeDocNumber(firstNonEmpty(flat['Policy No'], flat['Policy Number'], flat.policyNo, flat.policy_number)),
    fitnessCertNo: sanitizeDocNumber(firstNonEmpty(flat['Fitness Cert No'], flat['Fitness Certificate No'], flat.fitnessCertNo, flat.certificateNo)),
    pucCertNo: sanitizeDocNumber(firstNonEmpty(flat['PUC Cert No'], flat['PUC Certificate No'], flat.pucCertNo, flat.certificateNo)),
    permitNo: sanitizeDocNumber(firstNonEmpty(flat['Permit No'], flat['Route Permit No'], flat.permitNo)),
    raw: flat,
  };
}

module.exports = {
  flattenOcrPayload,
  normalizeTruckOcrPayload,
};
