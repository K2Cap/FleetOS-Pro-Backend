const { recognize } = require('tesseract.js');

function cleanString(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

function normalizeText(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function normalizeDocKind(documentType) {
  const text = String(documentType || '').toLowerCase();
  if (text.includes('receipt')) return 'receipt';
  if (text.includes('insurance')) return 'insurance';
  if (text.includes('fitness')) return 'fitness';
  if (text.includes('puc')) return 'puc';
  if (text.includes('permit')) return 'permit';
  if (text.includes('roadtax') || text.includes('road tax')) return 'roadtax';
  if (text === 'dl' || text.includes('driving') || text.includes('license')) return 'dl';
  if (text.includes('aadhaar') || text.includes('aadhar')) return 'aadhar';
  if (text.includes('pan')) return 'pan';
  if (text === 'rc' || text.includes('registration') || text.includes('logistics')) return 'rc';
  if (text.includes('photo')) return 'photo';
  return text || 'logistics';
}

function findFirstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) return cleanString(match[1]);
    if (match && match[0]) return cleanString(match[0]);
  }
  return null;
}

function extractDate(text) {
  return findFirstMatch(text, [
    /\b(\d{4}-\d{2}-\d{2})\b/,
    /\b(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})\b/,
    /\b(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4})\b/,
  ]);
}

function extractRegNo(text) {
  const compact = text.replace(/\s+/g, ' ');
  return findFirstMatch(compact, [
    /\b([A-Z]{2}\s?\d{1,2}\s?[A-Z]{1,3}\s?\d{1,4})\b/i,
  ]);
}

function extractLabelValue(text, labels) {
  const escaped = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return findFirstMatch(text, [
    new RegExp(`(?:${escaped.join('|')})\\s*[:\\-]?\\s*([A-Z0-9\\/\\- ]{4,})`, 'i'),
  ]);
}

function extractPan(text) {
  return findFirstMatch(text.toUpperCase(), [/\b([A-Z]{5}\d{4}[A-Z])\b/]);
}

function extractAadhaar(text) {
  const value = findFirstMatch(text, [/\b(\d{4}\s?\d{4}\s?\d{4})\b/]);
  return value ? value.replace(/\s+/g, '') : null;
}

function extractDl(text) {
  return findFirstMatch(text.toUpperCase(), [
    /\b([A-Z]{2}[ -]?\d{2,4}[ -]?\d{4,12})\b/,
    /\b(DL[- ]?[A-Z0-9-]{6,})\b/,
  ]);
}

function extractName(text, label = 'Name') {
  return extractLabelValue(text, [label, 'Owner Name', 'Cardholder', 'S/O', 'D/O']) || null;
}

function buildPayloadFromText(text, documentType) {
  const normalized = normalizeText(text);
  if (!normalized || normalized.length < 8) {
    throw new Error('Tesseract OCR returned insufficient text');
  }

  const kind = normalizeDocKind(documentType);
  const payload = { _source: 'TesseractFallback', _rawText: normalized };

  if (kind === 'rc') {
    payload['Document Type'] = 'Indian Union Vehicle Registration Certificate';
    payload['Reg No'] = extractRegNo(normalized);
    payload['Owner Name'] = extractName(normalized, 'Owner Name');
    payload['Chassis No'] = extractLabelValue(normalized, ['Chassis No', 'Chassis Number', 'Chassis']);
    payload['Engine No'] = extractLabelValue(normalized, ['Engine No', 'Engine Number', 'Engine']);
  } else if (kind === 'insurance') {
    payload['Document Type'] = 'Insurance';
    payload['Reg No'] = extractRegNo(normalized);
    payload['Insurance Provider'] = extractLabelValue(normalized, ['Insurer', 'Insurance Provider', 'Company']);
    payload['Policy No'] = extractLabelValue(normalized, ['Policy No', 'Policy Number', 'Policy']);
    payload['Insurance Expiry'] = extractLabelValue(normalized, ['Expiry Date', 'Valid Upto', 'Valid Till', 'End Date']) || extractDate(normalized);
  } else if (kind === 'fitness') {
    payload['Document Type'] = 'Fitness';
    payload['Reg No'] = extractRegNo(normalized);
    payload['Fitness Cert No'] = extractLabelValue(normalized, ['Fitness Certificate No', 'Certificate No', 'Fitness No']);
    payload['Fitness Expiry'] = extractLabelValue(normalized, ['Expiry Date', 'Valid Upto', 'Valid Till']) || extractDate(normalized);
  } else if (kind === 'puc') {
    payload['Document Type'] = 'puc';
    payload['Reg No'] = extractRegNo(normalized);
    payload['PUC Cert No'] = extractLabelValue(normalized, ['Certificate No', 'PUC Certificate No', 'Certificate']);
    payload['PUC Expiry'] = extractLabelValue(normalized, ['Valid Upto', 'Expiry Date', 'Valid Till']) || extractDate(normalized);
  } else if (kind === 'permit') {
    payload['Document Type'] = 'Permit';
    payload['Reg No'] = extractRegNo(normalized);
    payload['Permit No'] = extractLabelValue(normalized, ['Permit No', 'Permit Number']);
    payload['Permit Expiry'] = extractLabelValue(normalized, ['Valid Upto', 'Expiry Date', 'Valid Till']) || extractDate(normalized);
  } else if (kind === 'roadtax') {
    payload['Document Type'] = 'Road Tax';
    payload['Reg No'] = extractRegNo(normalized);
    payload['Road Tax Expiry'] = extractLabelValue(normalized, ['Valid Upto', 'Expiry Date', 'Valid Till']) || extractDate(normalized);
  } else if (kind === 'dl') {
    payload['Document Type'] = 'Driving License';
    payload['Name'] = extractName(normalized);
    payload['DL No'] = extractDl(normalized);
    payload['DL Expiry'] = extractLabelValue(normalized, ['Valid Till', 'Expiry Date', 'DL Expiry']) || extractDate(normalized);
    payload['DOB'] = extractLabelValue(normalized, ['DOB', 'Date of Birth']) || extractDate(normalized);
  } else if (kind === 'aadhar') {
    payload['Document Type'] = 'Aadhaar Card';
    payload['Name'] = extractName(normalized);
    payload['Aadhaar Number'] = extractAadhaar(normalized);
  } else if (kind === 'pan') {
    payload['Document Type'] = 'PAN Card';
    payload['Name'] = extractName(normalized);
    payload['PAN Number'] = extractPan(normalized);
  } else {
    payload['Document Type'] = cleanString(documentType) || 'Unknown';
    payload['Reg No'] = extractRegNo(normalized);
  }

  const usefulKeys = Object.entries(payload)
    .filter(([key, value]) => !key.startsWith('_') && cleanString(value))
    .length;

  if (usefulKeys === 0) {
    throw new Error('Tesseract OCR could not extract usable fields');
  }

  return payload;
}

async function tryTesseractDocumentOcr(base64Image, mimeType = 'image/jpeg', documentType = 'logistics') {
  const normalizedMime = String(mimeType || '').toLowerCase();
  if (normalizedMime.includes('pdf')) {
    throw new Error('Tesseract fallback does not support PDFs');
  }

  const imageBuffer = Buffer.from(base64Image, 'base64');
  const result = await recognize(imageBuffer, 'eng', {});
  const text = result?.data?.text || '';
  return buildPayloadFromText(text, documentType);
}

module.exports = {
  buildPayloadFromText,
  tryTesseractDocumentOcr,
};
