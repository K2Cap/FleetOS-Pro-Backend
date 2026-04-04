const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { PDFDocument } = require('pdf-lib');
const ExcelJS = require('exceljs');
const { flattenOcrPayload, normalizeTruckOcrPayload } = require('./ocr-normalizers');

function cleanString(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeStorageToken(value, fallback = 'unnamed') {
  const cleaned = String(value || '')
    .trim()
    .replace(/[^\w\s()-]+/g, '_')
    .replace(/\s+/g, ' ');
  return cleaned || fallback;
}

function extractTruckNumberSuffix(regNo) {
  const normalized = String(regNo || '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ');
  const matches = normalized.match(/\d+/g);
  if (!matches || !matches.length) return null;
  return matches[matches.length - 1];
}

function normalizeTruckRegNo(regNo) {
  return String(regNo || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .trim();
}

function formatTruckRegNo(regNo) {
  const compact = normalizeTruckRegNo(regNo);
  const match = compact.match(/^([A-Z]{2})(\d{1,2})([A-Z]{1,3})(\d{1,4})$/);
  if (!match) return cleanString(regNo);
  return `${match[1]} ${match[2].padStart(2, '0')} ${match[3]} ${match[4].padStart(4, '0')}`;
}

function isResolvableTruckRegNo(regNo) {
  const normalized = normalizeTruckRegNo(regNo);
  if (!normalized) return false;
  if (normalized === 'NEW') return false;
  if (normalized.startsWith('PENDING')) return false;
  return true;
}

function appendPageSuffix(baseName, pageIndex) {
  return pageIndex === 0 ? baseName : `${baseName} (${pageIndex})`;
}

function buildTruckDocumentBaseName(regNo, documentLabel) {
  const suffix = extractTruckNumberSuffix(regNo) || 'UNKNOWN';
  return sanitizeStorageToken(`${suffix}_${documentLabel}`, `${suffix}_${documentLabel}`);
}

function buildDriverDocumentBaseName(fullName, documentLabel) {
  const safeName = sanitizeStorageToken(fullName, 'Driver');
  return sanitizeStorageToken(`${safeName}_${documentLabel}`, `${safeName}_${documentLabel}`);
}

function normalizePageLabels(raw) {
  if (Array.isArray(raw)) return raw.map((item) => cleanString(item)).filter(Boolean);
  const cleaned = cleanString(raw);
  if (!cleaned) return [];
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => cleanString(item)).filter(Boolean);
    }
  } catch (_err) {}
  return cleaned.split(',').map((item) => cleanString(item)).filter(Boolean);
}

function getFileExtensionFromMimeOrName(file) {
  const originalExt = path.extname(file?.originalname || '');
  if (originalExt) return originalExt.toLowerCase();
  const mime = String(file?.mimetype || '').toLowerCase();
  if (mime.includes('png')) return '.png';
  if (mime.includes('webp')) return '.webp';
  if (mime.includes('pdf')) return '.pdf';
  return '.jpg';
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const cleaned = cleanString(value);
    if (cleaned) return cleaned;
  }
  return null;
}

function parseFlexibleDate(value) {
  const cleaned = cleanString(value);
  if (!cleaned) return null;

  const isoMatch = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const parsed = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const slashMatch = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (slashMatch) {
    const day = Number(slashMatch[1]);
    const month = Number(slashMatch[2]) - 1;
    const year = Number(slashMatch[3].length === 2 ? `20${slashMatch[3]}` : slashMatch[3]);
    const parsed = new Date(year, month, day);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const native = new Date(cleaned);
  if (!Number.isNaN(native.getTime())) return native;

  return null;
}

function parseDateToText(value) {
  const parsed = parseFlexibleDate(value);
  if (!parsed) return cleanString(value);
  return parsed.toISOString().split('T')[0];
}

function normalizeTruckPayload(payload) {
  const flat = flattenOcrPayload(payload || {});
  const normalized = normalizeTruckOcrPayload(flat);
  return {
    regNo: normalized.regNo || firstNonEmpty(flat['Reg No'], flat.regNo, flat.registration_no, flat.registrationNumber),
    ownerName: normalized.ownerName || firstNonEmpty(flat['Owner Name'], flat.ownerName, flat.owner_name),
    chassisNo: normalized.chassisNo,
    engineNo: normalized.engineNo,
    make: normalized.make || firstNonEmpty(flat['Make'], flat.make, flat["Maker's Name"], flat.manufacturer, flat.brand),
    model: normalized.model || firstNonEmpty(flat['Model'], flat.model, flat["Maker's Model Name"], flat.variant, flat.vehicleModel),
    fuelType: normalized.fuelType || firstNonEmpty(flat['Fuel Type'], flat.fuelType, flat.fuel),
    registrationDate: parseDateToText(firstNonEmpty(flat['Registration Date'], flat['Date of Registration'], flat['Date of Regn'], flat.registrationDate, normalized.registrationDate)),
    registrationValidity: parseDateToText(firstNonEmpty(flat['Regn. Validity'], flat['Regn Validity'], flat['Registration Validity'], flat['Registration Valid Upto'], flat.registrationValidity, normalized.registrationValidity)),
    bodyType: firstNonEmpty(flat['Body Type'], flat['Type of Body'], flat.bodyType, normalized.bodyType),
    capacity: firstNonEmpty(flat['Gross Combination Weight'], flat['GCW'], flat['GVW'], flat.capacity, normalized.capacity),
    purchaseDate: parseDateToText(firstNonEmpty(flat['Purchase Date'], flat.purchaseDate, flat['Invoice Date'], flat.invoiceDate)),
    purchasePrice: firstNonEmpty(flat['Purchase Price'], flat.purchasePrice, flat['Invoice Value'], flat.invoiceValue, flat['Ex Showroom Price'], flat['Sale Amount'], flat.saleAmount),
    insuranceProvider: normalized.insuranceProvider || firstNonEmpty(flat['Insurer'], flat.insurer, flat.insuranceProvider),
    policyNo: normalized.policyNo || firstNonEmpty(flat['Policy No'], flat.policyNo, flat.policy_number),
    insuranceExpiry: parseDateToText(firstNonEmpty(flat['Insurance Expiry'], flat.insExpiry, flat.expiry, flat.expiryDate)),
    fitnessCertNo: normalized.fitnessCertNo || firstNonEmpty(flat['Fitness Certificate No'], flat.fitnessCertNo, flat.certificateNo),
    fitnessExpiry: parseDateToText(firstNonEmpty(flat['Fitness Expiry'], flat.fitnessExpiry, flat.expiry, flat.expiryDate)),
    pucCertNo: normalized.pucCertNo || firstNonEmpty(flat['PUC Certificate No'], flat.pucCertNo, flat.certificateNo),
    pucExpiry: parseDateToText(firstNonEmpty(flat['PUC Expiry'], flat.pucExpiry, flat.expiry, flat.expiryDate)),
    permitNo: normalized.permitNo || firstNonEmpty(flat['Permit No'], flat.permitNo),
    permitExpiry: parseDateToText(firstNonEmpty(flat['Permit Expiry'], flat.permitExpiry, flat.expiry, flat.expiryDate)),
    roadTaxExpiry: parseDateToText(firstNonEmpty(flat['Road Tax Expiry'], flat.roadTaxExpiry, flat.expiry, flat.expiryDate)),
    raw: flat,
  };
}

function normalizeDriverPayload(payload) {
  const flat = flattenOcrPayload(payload || {});
  return {
    fullName: firstNonEmpty(flat['Name'], flat['Driver Name'], flat.fullName, flat.name),
    dob: parseDateToText(firstNonEmpty(flat['DOB'], flat.dob, flat.dateOfBirth)),
    phone: firstNonEmpty(flat['Mobile'], flat.phone, flat.mobile),
    dlNo: firstNonEmpty(flat['DL No'], flat.dlNo, flat.licenseNumber),
    dlIssue: parseDateToText(firstNonEmpty(flat['DL Issue Date'], flat.dlIssue, flat.issueDate)),
    dlExpiry: parseDateToText(firstNonEmpty(flat['DL Expiry'], flat.dlExpiry, flat.expiry, flat.expiryDate)),
    aadhar: firstNonEmpty(flat['Aadhaar'], flat['Aadhar'], flat.aadhar, flat.aadhaar),
    pan: firstNonEmpty(flat['PAN'], flat.pan, flat.panNumber),
    raw: flat,
  };
}

function mergeTruckPayloads(documentType, payloads) {
  const normalized = payloads.map(normalizeTruckPayload);
  return {
    regNo: firstNonEmpty(...normalized.map((p) => p.regNo)),
    ownerName: firstNonEmpty(...normalized.map((p) => p.ownerName)),
    chassisNo: firstNonEmpty(...normalized.map((p) => p.chassisNo)),
    engineNo: firstNonEmpty(...normalized.map((p) => p.engineNo)),
    make: firstNonEmpty(...normalized.map((p) => p.make)),
    model: firstNonEmpty(...normalized.map((p) => p.model)),
    fuelType: firstNonEmpty(...normalized.map((p) => p.fuelType)),
    registrationDate: firstNonEmpty(...normalized.map((p) => p.registrationDate)),
    registrationValidity: firstNonEmpty(...normalized.map((p) => p.registrationValidity)),
    bodyType: firstNonEmpty(...normalized.map((p) => p.bodyType)),
    capacity: firstNonEmpty(...normalized.map((p) => p.capacity)),
    purchaseDate: firstNonEmpty(...normalized.map((p) => p.purchaseDate)),
    purchasePrice: firstNonEmpty(...normalized.map((p) => p.purchasePrice)),
    insuranceProvider: firstNonEmpty(...normalized.map((p) => p.insuranceProvider)),
    policyNo: firstNonEmpty(...normalized.map((p) => p.policyNo)),
    insuranceExpiry: firstNonEmpty(...normalized.map((p) => p.insuranceExpiry)),
    fitnessCertNo: firstNonEmpty(...normalized.map((p) => p.fitnessCertNo)),
    fitnessExpiry: firstNonEmpty(...normalized.map((p) => p.fitnessExpiry)),
    pucCertNo: firstNonEmpty(...normalized.map((p) => p.pucCertNo)),
    pucExpiry: firstNonEmpty(...normalized.map((p) => p.pucExpiry)),
    permitNo: firstNonEmpty(...normalized.map((p) => p.permitNo)),
    permitExpiry: firstNonEmpty(...normalized.map((p) => p.permitExpiry)),
    roadTaxExpiry: firstNonEmpty(...normalized.map((p) => p.roadTaxExpiry)),
    documentType,
    pages: normalized.map((p) => p.raw),
  };
}

function mergeDriverPayloads(documentType, payloads) {
  const normalized = payloads.map(normalizeDriverPayload);
  return {
    fullName: firstNonEmpty(...normalized.map((p) => p.fullName)),
    dob: firstNonEmpty(...normalized.map((p) => p.dob)),
    phone: firstNonEmpty(...normalized.map((p) => p.phone)),
    dlNo: firstNonEmpty(...normalized.map((p) => p.dlNo)),
    dlIssue: firstNonEmpty(...normalized.map((p) => p.dlIssue)),
    dlExpiry: firstNonEmpty(...normalized.map((p) => p.dlExpiry)),
    aadhar: firstNonEmpty(...normalized.map((p) => p.aadhar)),
    pan: firstNonEmpty(...normalized.map((p) => p.pan)),
    documentType,
    pages: normalized.map((p) => p.raw),
  };
}

const TRUCK_DOCUMENT_LABELS = {
  rc: 'RC',
  rc_front: 'RC Front',
  rc_back: 'RC Back',
  insurance: 'Insurance',
  fitness: 'Fitness',
  puc: 'PUC',
  permit: 'Permit',
  purchase_invoice: 'Purchase Invoice',
};

const DRIVER_DOCUMENT_LABELS = {
  dl: 'DL',
  aadhar: 'Aadhaar Card',
  pan: 'Pan Card',
  photo: 'Photo',
};

function normalizeTruckDocumentType(value) {
  const cleaned = String(value || '').trim().toLowerCase();
  if (!cleaned) return cleaned;
  if (['tax', 'roadtax', 'road_tax', 'purchase invoice', 'purchase_invoice'].includes(cleaned)) {
    return 'purchase_invoice';
  }
  return cleaned;
}

async function ensureDocumentTables(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS documents (
      id SERIAL PRIMARY KEY,
      owner_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('truck', 'driver')),
      entity_id INTEGER,
      document_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'uploaded',
      display_name TEXT,
      storage_key TEXT,
      page_count INTEGER NOT NULL DEFAULT 0,
      extracted_data JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  await db.query(`CREATE TABLE IF NOT EXISTS document_pages (
      id SERIAL PRIMARY KEY,
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      page_number INTEGER NOT NULL,
      page_label TEXT,
      original_name TEXT,
      stored_name TEXT NOT NULL,
      stored_path TEXT NOT NULL,
      mime_type TEXT,
      file_size_bytes BIGINT,
      ocr_status TEXT NOT NULL DEFAULT 'pending',
      ocr_payload JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (document_id, page_number)
  )`);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_documents_entity ON documents (entity_type, entity_id, document_type)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_document_pages_document ON document_pages (document_id, page_number)`);
  await db.query(`CREATE TABLE IF NOT EXISTS document_field_values (
      id SERIAL PRIMARY KEY,
      owner_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('truck', 'driver')),
      entity_id INTEGER,
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      document_type TEXT NOT NULL,
      display_order INTEGER,
      field_name TEXT NOT NULL,
      field_value TEXT,
      source_engine TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  await db.query(`ALTER TABLE document_field_values ADD COLUMN IF NOT EXISTS display_order INTEGER`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_document_field_values_document ON document_field_values (document_id, field_name)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_document_field_values_entity ON document_field_values (entity_type, entity_id, document_type)`);
  await db.query(`CREATE TABLE IF NOT EXISTS truck_document_registers (
      truck_id INTEGER PRIMARY KEY REFERENCES trucks(id) ON DELETE CASCADE,
      owner_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      reg_no TEXT,
      rc_document JSONB,
      insurance_document JSONB,
      fitness_document JSONB,
      puc_document JSONB,
      permit_document JSONB,
      purchase_invoice_document JSONB,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS driver_document_registers (
      driver_id INTEGER PRIMARY KEY REFERENCES drivers(id) ON DELETE CASCADE,
      owner_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      full_name TEXT,
      dl_document JSONB,
      aadhar_document JSONB,
      pan_document JSONB,
      photo_document JSONB,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  await db.query(`ALTER TABLE truck_document_registers ADD COLUMN IF NOT EXISTS purchase_invoice_document JSONB`);
}

function formatFieldLabel(key) {
  const cleaned = String(key || '')
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  if (!cleaned) return null;
  return cleaned
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeLookupKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function findValueInPayloads(payloads, candidateKeys) {
  const normalizedCandidates = candidateKeys.map(normalizeLookupKey);
  for (const payload of payloads) {
    const flat = flattenOcrPayload(payload || {});
    for (const [key, value] of Object.entries(flat)) {
      if (value === undefined || value === null || value === '') continue;
      if (normalizedCandidates.includes(normalizeLookupKey(key))) {
        return String(value).trim();
      }
    }
  }
  return null;
}

function buildFieldRowsFromPayload(payload, documentType, sourceEngine) {
  const rawPayloads = Array.isArray(payload?.pages) ? payload.pages : [];
  const read = (candidateKeys, ...fallbackValues) => {
    const fromRaw = findValueInPayloads(rawPayloads, candidateKeys);
    if (fromRaw) return fromRaw;
    for (const value of fallbackValues) {
      const cleaned = cleanString(value);
      if (cleaned) return cleaned;
    }
    return null;
  };

  const specs = {
    rc: [
      ['Document Type', ['Document Type', 'Certificate Type', 'Form Type'], payload.documentType || 'Registration Certificate'],
      ['Vehicle No', ['Vehicle No', 'Vehicle Number'], payload.regNo],
      ['Registration No', ['Reg No', 'Registration No', 'Registration Number'], payload.regNo],
      ['Owner Name', ['Owner Name', 'Registered Owner'], payload.ownerName],
      ['Chassis No', ['Chassis No', 'Chassis Number', 'VIN'], payload.chassisNo],
      ['Engine No', ['Engine No', 'Engine Number', 'Motor No'], payload.engineNo],
      ['Make', ['Make', 'Maker', 'Manufacturer'], payload.make],
      ['Model', ['Model', 'Vehicle Model'], payload.model],
      ['Fuel Type', ['Fuel Type', 'Fuel'], payload.fuelType],
      ['Manufacturing Year', ['Manufacturing Year', 'Year of Manufacture'], payload.year],
      ['Registration Date', ['Registration Date', 'Date of Registration'], payload.registrationDate],
      ['Regn. Validity', ['Regn. Validity', 'Regn Validity', 'Registration Validity'], payload.registrationValidity],
      ['Body Type', ['Body Type', 'Type of Body'], payload.bodyType],
      ['Gross Combination Weight', ['Gross Combination Weight', 'GCW', 'GVW'], payload.capacity],
    ],
    insurance: [
      ['Document Type', ['Document Type', 'Policy Type'], payload.documentType || 'Insurance Certificate'],
      ['Insurance Provider', ['Insurance Provider', 'Insurer', 'Company Name'], payload.insuranceProvider],
      ['Policy Number', ['Policy No', 'Policy Number', 'Policy No.'], payload.policyNo],
      ['Insurance Expiry', ['Insurance Expiry', 'Expiry Date', 'Policy Expiry'], payload.insuranceExpiry],
      ['Coverage Type', ['Coverage Type', 'Insurance Type'], payload.coverageType],
      ['Registration No', ['Reg No', 'Registration No', 'Vehicle No'], payload.regNo],
      ['Owner Name', ['Owner Name', 'Insured Name'], payload.ownerName],
      ['Chassis No', ['Chassis No', 'Chassis Number', 'VIN'], payload.chassisNo],
      ['Engine No', ['Engine No', 'Engine Number', 'Motor No'], payload.engineNo],
    ],
    fitness: [
      ['Department', ['Department', 'Office', 'Authority'], null],
      ['Issuing Authority', ['Issuing Authority', 'DTO', 'RTO', 'Authority'], null],
      ['Document Type', ['Document Type', 'Certificate Type', 'Form Type'], payload.documentType || 'Fitness Certificate'],
      ['Vehicle No', ['Vehicle No', 'Vehicle Number'], payload.regNo],
      ['Registration No', ['Reg No', 'Registration No', 'Registration Number'], payload.regNo],
      ['Application No', ['Application No', 'Application Number'], null],
      ['Inspection Fee Receipt No', ['Inspection Fee Receipt No', 'Receipt No', 'Receipt Number'], null],
      ['Receipt Date', ['Receipt Date'], null],
      ['Chassis No', ['Chassis No', 'Chassis Number', 'VIN'], payload.chassisNo],
      ['Engine No', ['Engine No', 'Engine Number', 'Motor No'], payload.engineNo],
      ['Seating Capacity', ['Seating Capacity'], null],
      ['Type of Body', ['Type of Body', 'Body Type'], payload.bodyType],
      ['Manufacturing Year', ['Manufacturing Year', 'Year of Manufacture'], null],
      ['Category of Vehicle', ['Category of Vehicle', 'Vehicle Category'], null],
      ['Inspected on', ['Inspected On', 'Inspected Date', 'Inspection Date'], null],
      ['Certificate expiry', ['Fitness Expiry', 'Certificate will expire on', 'Certificate Expiry'], payload.fitnessExpiry],
      ['Next Inspection Due Date', ['Next Inspection Due Date', 'Inspection Due Date'], null],
      ['Printed on', ['Printed On', 'Print Date'], null],
      ['Inspector', ['Inspector', 'Inspected By'], null],
    ],
    puc: [
      ['Document Type', ['Document Type', 'Certificate Type'], payload.documentType || 'Pollution Under Control Certificate'],
      ['Authorised By', ['Authorised By', 'Authorized By', 'Issued By'], null],
      ['Date', ['Date', 'Issue Date'], null],
      ['Time', ['Time'], null],
      ['Validity Upto', ['Validity Upto', 'Valid Upto', 'Validity Up To', 'Expiry Date'], payload.pucExpiry],
      ['Certificate SL. No.', ['Certificate SL No', 'Certificate Sl No', 'Certificate No', 'PUC Certificate No'], payload.pucCertNo],
      ['Registration No', ['Reg No', 'Registration No', 'Vehicle No'], payload.regNo],
      ['Date of Registration', ['Date of Registration'], null],
      ['Month & Year of Mfg', ['Month & Year of Mfg', 'Month and Year of Mfg'], null],
      ['Emission Norms', ['Emission Norms'], null],
      ['Fuel', ['Fuel', 'Fuel Type'], null],
      ['PUC Code', ['PUC Code'], null],
      ['Fees', ['Fees', 'Fee'], null],
      ['MIL observation', ['MIL Observation', 'MIL observation'], null],
    ],
    permit: [
      ['Document Type', ['Document Type', 'Permit Type'], payload.documentType || 'Route Permit'],
      ['Permit Number', ['Permit No', 'Permit Number'], payload.permitNo],
      ['Permit Expiry', ['Permit Expiry', 'Validity Upto', 'Expiry Date'], payload.permitExpiry],
      ['Registration No', ['Reg No', 'Registration No', 'Vehicle No'], payload.regNo],
      ['Owner Name', ['Owner Name'], payload.ownerName],
    ],
    purchase_invoice: [
      ['Document Type', ['Document Type'], payload.documentType || 'Purchase Invoice'],
      ['Registration No', ['Reg No', 'Registration No', 'Vehicle No'], payload.regNo],
      ['Owner Name', ['Owner Name'], payload.ownerName],
      ['Make', ['Make', "Maker's Name", 'Manufacturer'], payload.make],
      ['Model', ['Model', "Maker's Model Name", 'Variant'], payload.model],
      ['Chassis No', ['Chassis No', 'Chassis Number', 'VIN'], payload.chassisNo],
      ['Engine No', ['Engine No', 'Engine Number', 'Motor No'], payload.engineNo],
      ['Purchase Date', ['Purchase Date', 'Invoice Date'], payload.purchaseDate],
      ['Purchase Price', ['Purchase Price', 'Invoice Value', 'Sale Amount', 'Ex Showroom Price'], payload.purchasePrice],
      ['Fuel Type', ['Fuel Type', 'Fuel'], payload.fuelType],
    ],
    dl: [
      ['Document Type', ['Document Type'], payload.documentType || 'Driving License'],
      ['Full Name', ['Name', 'Driver Name'], payload.fullName],
      ['DOB', ['DOB', 'Date of Birth'], payload.dob],
      ['DL Number', ['DL No', 'DL Number', 'License Number'], payload.dlNo],
      ['DL Issue Date', ['DL Issue Date', 'Issue Date'], payload.dlIssue],
      ['DL Expiry', ['DL Expiry', 'Expiry Date'], payload.dlExpiry],
      ['Address', ['Address'], null],
    ],
    aadhar: [
      ['Document Type', ['Document Type'], payload.documentType || 'Aadhaar Card'],
      ['Full Name', ['Name'], payload.fullName],
      ['DOB', ['DOB', 'Date of Birth'], payload.dob],
      ['Aadhaar Number', ['Aadhaar Number', 'Aadhar Number'], payload.aadhar],
      ['Address', ['Address'], null],
    ],
    pan: [
      ['Document Type', ['Document Type'], payload.documentType || 'Pan Card'],
      ['Full Name', ['Name'], payload.fullName],
      ['PAN Number', ['PAN Number', 'PAN'], payload.pan],
      ['DOB', ['DOB', 'Date of Birth'], payload.dob],
    ],
    photo: [
      ['Document Type', ['Document Type'], payload.documentType || 'Photo'],
      ['Full Name', ['Name'], payload.fullName],
    ],
  };

  const selectedSpecs = specs[documentType] || [];
  const rows = [];
  const seen = new Set();

  selectedSpecs.forEach(([label, keys, fallback], index) => {
    const value = read(keys, fallback);
    if (!value) return;
    seen.add(normalizeLookupKey(label));
    rows.push({
      displayOrder: index + 1,
      fieldName: label,
      fieldValue: String(value),
      sourceEngine: sourceEngine || null,
      documentType,
    });
  });

  if (!rows.length) {
    const skipKeys = new Set(['raw', 'pages', 'documentType']);
    let order = 1;
    for (const [key, value] of Object.entries(payload || {})) {
      if (skipKeys.has(key)) continue;
      if (value === undefined || value === null || value === '') continue;
      const fieldName = formatFieldLabel(key);
      if (!fieldName) continue;
      rows.push({
        displayOrder: order++,
        fieldName,
        fieldValue: String(value),
        sourceEngine: sourceEngine || null,
        documentType,
      });
    }
  }

  return rows;
}

async function replaceDocumentFieldRows(client, payload) {
  await client.query('DELETE FROM document_field_values WHERE document_id = $1', [payload.documentId]);
  if (!payload.rows.length) return;
  for (const row of payload.rows) {
    await client.query(
      `INSERT INTO document_field_values
       (owner_user_id, entity_type, entity_id, document_id, document_type, display_order, field_name, field_value, source_engine)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        payload.ownerUserId || null,
        payload.entityType,
        payload.entityId || null,
        payload.documentId,
        payload.documentType,
        row.displayOrder || null,
        row.fieldName,
        row.fieldValue,
        row.sourceEngine || null,
      ]
    );
  }
}

function buildRegisterDocumentSnapshot(document, mergedPayload, fieldRows, mergedStoredPath, sourceEngine) {
  return {
    documentId: document.id,
    documentType: document.document_type,
    displayName: document.display_name,
    status: 'scanned',
    mergedFile: mergedStoredPath,
    sourceEngine: sourceEngine || null,
    fields: fieldRows.map((row) => ({
      order: row.displayOrder || null,
      field: row.fieldName,
      value: row.fieldValue,
    })),
    extractedData: mergedPayload,
    updatedAt: new Date().toISOString(),
  };
}

function getTruckRegisterColumn(documentType) {
  const mapping = {
    rc: 'rc_document',
    insurance: 'insurance_document',
    fitness: 'fitness_document',
    puc: 'puc_document',
    permit: 'permit_document',
    purchase_invoice: 'purchase_invoice_document',
    roadtax: 'purchase_invoice_document',
  };
  return mapping[documentType] || null;
}

function getDriverRegisterColumn(documentType) {
  const mapping = {
    dl: 'dl_document',
    aadhar: 'aadhar_document',
    pan: 'pan_document',
    photo: 'photo_document',
  };
  return mapping[documentType] || null;
}

async function upsertTruckDocumentRegister(client, payload) {
  const column = getTruckRegisterColumn(payload.documentType);
  if (!column) return;
  const safeRegNo = payload.documentType === 'rc'
    ? (formatTruckRegNo(payload.regNo) || null)
    : (isResolvableTruckRegNo(payload.regNo) ? formatTruckRegNo(payload.regNo) : null);
  await client.query(
    `INSERT INTO truck_document_registers (truck_id, owner_user_id, reg_no, ${column}, updated_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
     ON CONFLICT (truck_id)
     DO UPDATE SET
       owner_user_id = COALESCE(EXCLUDED.owner_user_id, truck_document_registers.owner_user_id),
       reg_no = COALESCE(EXCLUDED.reg_no, truck_document_registers.reg_no),
       ${column} = EXCLUDED.${column},
       updated_at = CURRENT_TIMESTAMP`,
    [
      payload.truckId,
      payload.ownerUserId || null,
      safeRegNo,
      payload.snapshot,
    ]
  );
}

async function upsertDriverDocumentRegister(client, payload) {
  const column = getDriverRegisterColumn(payload.documentType);
  if (!column) return;
  await client.query(
    `INSERT INTO driver_document_registers (driver_id, owner_user_id, full_name, ${column}, updated_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
     ON CONFLICT (driver_id)
     DO UPDATE SET
       owner_user_id = EXCLUDED.owner_user_id,
       full_name = EXCLUDED.full_name,
       ${column} = EXCLUDED.${column},
       updated_at = CURRENT_TIMESTAMP`,
    [payload.driverId, payload.ownerUserId || null, payload.fullName || null, payload.snapshot]
  );
}

function flattenRegisterDocument(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return '';
  const rows = Array.isArray(snapshot.fields) ? snapshot.fields : [];
  return rows.map((row) => `${row.field}: ${row.value}`).join('\n');
}

async function createDocumentRecord(client, payload) {
  const result = await client.query(
    `INSERT INTO documents
     (owner_user_id, entity_type, entity_id, document_type, display_name, storage_key, page_count, extracted_data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      payload.ownerUserId,
      payload.entityType,
      payload.entityId || null,
      payload.documentType,
      payload.displayName,
      payload.storageKey || null,
      payload.pageCount || 0,
      payload.extractedData || null,
    ]
  );
  return result.rows[0].id;
}

async function createDocumentPageRecord(client, payload) {
  await client.query(
    `INSERT INTO document_pages
     (document_id, page_number, page_label, original_name, stored_name, stored_path, mime_type, file_size_bytes, ocr_status, ocr_payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      payload.documentId,
      payload.pageNumber,
      payload.pageLabel || null,
      payload.originalName || null,
      payload.storedName,
      payload.storedPath,
      payload.mimeType || null,
      payload.fileSizeBytes || null,
      payload.ocrStatus || 'pending',
      payload.ocrPayload || null,
    ]
  );
}

async function renameUploadedFile(uploadsDir, tempFilename, targetFilename) {
  const sourcePath = path.join(uploadsDir, tempFilename);
  const destinationPath = path.join(uploadsDir, targetFilename);
  await fs.promises.rename(sourcePath, destinationPath);
  return {
    storedName: targetFilename,
    storedPath: `/uploads/${targetFilename}`,
    absolutePath: destinationPath,
  };
}

async function createMergedPdfFromPages(pageFiles, outputAbsolutePath) {
  const pdfDoc = await PDFDocument.create();

  for (const pageFile of pageFiles) {
    const bytes = await fs.promises.readFile(pageFile.absolutePath);
    if (String(pageFile.mimeType || '').includes('pdf')) {
      const srcPdf = await PDFDocument.load(bytes);
      const copiedPages = await pdfDoc.copyPages(srcPdf, srcPdf.getPageIndices());
      copiedPages.forEach((page) => pdfDoc.addPage(page));
      continue;
    }

    let image;
    if (String(pageFile.mimeType || '').includes('png')) {
      image = await pdfDoc.embedPng(bytes);
    } else {
      image = await pdfDoc.embedJpg(bytes);
    }

    const page = pdfDoc.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  }

  const pdfBytes = await pdfDoc.save();
  await fs.promises.writeFile(outputAbsolutePath, pdfBytes);
}

function createTempMulterStorage(uploadsDir) {
  return {
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
      const ext = getFileExtensionFromMimeOrName(file);
      cb(null, `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
    },
  };
}

async function fileToBase64(absolutePath) {
  const bytes = await fs.promises.readFile(absolutePath);
  return bytes.toString('base64');
}

async function runStoredFileOcr(absolutePath, mimeType, documentType, deps) {
  const base64 = await fileToBase64(absolutePath);
  try {
    const geminiResult = await deps.parseDocumentWithGemini(
      base64,
      mimeType || 'image/jpeg',
      documentType || 'logistics'
    );
    return { engine: 'gemini', payload: flattenOcrPayload(geminiResult) };
  } catch (_err) {}
  if (deps.tryLocalGravityOcr) {
    try {
      const localResult = await deps.tryLocalGravityOcr(base64, mimeType || 'image/jpeg');
      return { engine: 'gravityocr', payload: flattenOcrPayload(localResult) };
    } catch (_err) {}
  }
  throw new Error('All OCR engines failed');
}

function classifyOcrError(err) {
  const message = String(err?.message || '');
  const quota = /quota exceeded|too many requests|\b429\b/i.test(message);
  return {
    message,
    code: quota ? 'AI_QUOTA_EXCEEDED' : 'SCAN_FAILED',
    status: quota ? 429 : 500,
  };
}

async function upsertTruckFromDocument(client, mergedPayload, documentType, mergedStoredPath, regNoHint = null, ownerUserId = null, existingTruckIdHint = null) {
  const hintedTruckId = toNumberOrNull(existingTruckIdHint);
  let row = null;
  if (hintedTruckId) {
    const hinted = await client.query(
      `SELECT *
         FROM trucks
        WHERE id = $1
        LIMIT 1`,
      [hintedTruckId]
    );
    row = hinted.rows[0] || null;
  }

  const hintedRegNo = isResolvableTruckRegNo(regNoHint) ? normalizeTruckRegNo(regNoHint) : null;
  const existingTruckRegNo = isResolvableTruckRegNo(row?.reg_no) ? normalizeTruckRegNo(row?.reg_no) : null;
  const rawRegNo = documentType === 'rc'
    ? firstNonEmpty(mergedPayload.regNo, regNoHint, row?.reg_no)
    : firstNonEmpty(existingTruckRegNo, hintedRegNo, row?.reg_no, isResolvableTruckRegNo(mergedPayload.regNo) ? mergedPayload.regNo : null);
  const regNo = isResolvableTruckRegNo(rawRegNo) ? formatTruckRegNo(rawRegNo) : null;

  if (!row && regNo) {
    const existing = await client.query(
      `SELECT *
         FROM trucks
        WHERE UPPER(REGEXP_REPLACE(COALESCE(reg_no, ''), '[^A-Z0-9]', '', 'g')) = $1
        LIMIT 1`,
      [normalizeTruckRegNo(regNo)]
    );
    row = existing.rows[0] || null;
  }

  const chassisNo = cleanString(mergedPayload.chassisNo);
  const engineNo = cleanString(mergedPayload.engineNo);

  if (!row && chassisNo) {
    const existingByChassis = await client.query(
      `SELECT *
         FROM trucks
        WHERE UPPER(COALESCE(chassis_no, '')) = UPPER($1)
          AND ($2::int IS NULL OR owner_user_id = $2 OR owner_user_id IS NULL)
        ORDER BY COALESCE(updated_at, created_at) DESC NULLS LAST, id DESC
        LIMIT 1`,
      [chassisNo, ownerUserId || null]
    );
    row = existingByChassis.rows[0] || null;
  }

  if (!row && engineNo) {
    const existingByEngine = await client.query(
      `SELECT *
         FROM trucks
        WHERE UPPER(COALESCE(engine_no, '')) = UPPER($1)
          AND ($2::int IS NULL OR owner_user_id = $2 OR owner_user_id IS NULL)
        ORDER BY COALESCE(updated_at, created_at) DESC NULLS LAST, id DESC
        LIMIT 1`,
      [engineNo, ownerUserId || null]
    );
    row = existingByEngine.rows[0] || null;
  }

  const patch = {
    owner_user_id: ownerUserId,
    reg_no: regNo,
    owner_name: mergedPayload.ownerName,
    chassis_no: mergedPayload.chassisNo,
    engine_no: mergedPayload.engineNo,
    make: mergedPayload.make,
    model: mergedPayload.model,
    fuel_type: mergedPayload.fuelType,
    registration_date: mergedPayload.registrationDate,
    registration_validity: mergedPayload.registrationValidity,
    body_type: mergedPayload.bodyType,
    gvw: toNumberOrNull(mergedPayload.capacity),
    purchase_date: mergedPayload.purchaseDate,
    purchase_price: mergedPayload.purchasePrice,
    insurance_provider: mergedPayload.insuranceProvider,
    policy_no: mergedPayload.policyNo,
    ins_expiry_date: mergedPayload.insuranceExpiry,
    fitness_cert_no: mergedPayload.fitnessCertNo,
    fitness_expiry_date: mergedPayload.fitnessExpiry,
    puc_cert_no: mergedPayload.pucCertNo,
    puc_expiry_date: mergedPayload.pucExpiry,
    permit_no: mergedPayload.permitNo,
    permit_expiry_date: mergedPayload.permitExpiry,
    road_tax_expiry_date: mergedPayload.roadTaxExpiry,
  };

  if (row?.owner_user_id && !patch.owner_user_id) {
    patch.owner_user_id = row.owner_user_id;
  }

  if (!regNo) {
    delete patch.reg_no;
  }

  if (documentType === 'rc') patch.doc_rc_path = mergedStoredPath;
  if (documentType === 'insurance') patch.doc_insurance_path = mergedStoredPath;
  if (documentType === 'fitness') patch.doc_fitness_path = mergedStoredPath;
  if (documentType === 'puc') patch.doc_puc_path = mergedStoredPath;
  if (documentType === 'permit') patch.doc_permit_path = mergedStoredPath;
  if (documentType === 'roadtax' || documentType === 'purchase_invoice') patch.doc_roadtax_path = mergedStoredPath;

  if (row) {
    const columns = Object.keys(patch);
    const values = columns.map((key) => patch[key]);
    const setClause = columns.map((key, index) => `${key} = $${index + 1}`).join(', ');
    values.push(row.id);
    await client.query(`UPDATE trucks SET ${setClause} WHERE id = $${values.length}`, values);
    return row.id;
  }

  const columns = Object.keys(patch);
  const values = columns.map((key) => patch[key] ?? null);
  const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
  const result = await client.query(
    `INSERT INTO trucks (${columns.join(', ')}) VALUES (${placeholders}) RETURNING id`,
    values
  );
  return result.rows[0].id;
}


function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

async function upsertDriverFromDocument(client, mergedPayload, documentType, mergedStoredPath, fullNameHint = null) {
  const fullName = firstNonEmpty(mergedPayload.fullName, fullNameHint);
  if (!fullName) throw new Error('Driver name could not be resolved from OCR');

  const phone = normalizePhone(mergedPayload.phone || '');
  const existing = await client.query(
    `SELECT * FROM drivers
     WHERE full_name = $1
        OR (phone = $2 AND $2 != '')
        OR (dl_no = $3 AND $3 IS NOT NULL)
     LIMIT 1`,
    [fullName, phone, mergedPayload.dlNo]
  );
  const row = existing.rows[0];

  const patch = {
    full_name: fullName,
    dob: mergedPayload.dob,
    phone: phone || null,
    dl_no: mergedPayload.dlNo,
    dl_issue: mergedPayload.dlIssue,
    dl_expiry: mergedPayload.dlExpiry,
    aadhar: mergedPayload.aadhar,
    pan: mergedPayload.pan,
  };

  if (documentType === 'dl') patch.doc_dl_path = mergedStoredPath;
  if (documentType === 'aadhar') patch.doc_aadhar_path = mergedStoredPath;
  if (documentType === 'pan') patch.doc_pan_path = mergedStoredPath;
  if (documentType === 'photo') patch.doc_photo_path = mergedStoredPath;

  if (row) {
    const columns = Object.keys(patch);
    const values = columns.map((key) => patch[key]);
    const setClause = columns.map((key, index) => `${key} = $${index + 1}`).join(', ');
    values.push(row.id);
    await client.query(`UPDATE drivers SET ${setClause} WHERE id = $${values.length}`, values);
    return row.id;
  }

  const driverPhone = phone || `${Date.now()}`.slice(-10);
  const columns = ['full_name', 'phone', 'status', ...Object.keys(patch).filter((key) => !['full_name', 'phone'].includes(key))];
  const values = [fullName, driverPhone, 'Active', ...Object.keys(patch).filter((key) => !['full_name', 'phone'].includes(key)).map((key) => patch[key] ?? null)];
  const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
  const result = await client.query(
    `INSERT INTO drivers (${columns.join(', ')}) VALUES (${placeholders}) RETURNING id`,
    values
  );
  return result.rows[0].id;
}

function registerDocumentWorkflow({
  app,
  pool,
  upload,
  authenticateTransporter,
  UPLOADS_DIR,
  parseDocumentWithGemini,
  tryLocalGravityOcr = null,
  tryTesseractDocumentOcr = null,
}) {
  async function getDocumentsForEntity(entityType, entityId) {
    const docsRes = await pool.query(
      `SELECT d.*, dp.id AS page_id, dp.stored_path, dp.stored_name, dp.page_number, dp.page_label, dp.ocr_status, dp.ocr_payload
       FROM documents d
       LEFT JOIN document_pages dp ON dp.document_id = d.id
       WHERE d.entity_type = $1 AND d.entity_id = $2
       ORDER BY d.id DESC, dp.page_number ASC`,
      [entityType, entityId]
    );

    const docIds = docsRes.rows.map((row) => row.id).filter(Boolean);
    const fieldRowsByDocument = new Map();
    if (docIds.length) {
      const fieldRes = await pool.query(
        `SELECT document_id, display_order, field_name, field_value, source_engine, created_at
         FROM document_field_values
         WHERE document_id = ANY($1::int[])
         ORDER BY document_id ASC, display_order ASC NULLS LAST, field_name ASC`,
        [docIds]
      );
      for (const row of fieldRes.rows) {
        if (!fieldRowsByDocument.has(row.document_id)) fieldRowsByDocument.set(row.document_id, []);
        fieldRowsByDocument.get(row.document_id).push({
          displayOrder: row.display_order,
          fieldName: row.field_name,
          fieldValue: row.field_value,
          sourceEngine: row.source_engine,
          createdAt: row.created_at,
        });
      }
    }

    const documents = [];
    const byId = new Map();
    for (const row of docsRes.rows) {
      if (!byId.has(row.id)) {
        const doc = {
          documentId: row.id,
          documentType: row.document_type,
          displayName: row.display_name,
          status: row.status,
          pageCount: row.page_count,
          extractedData: row.extracted_data || null,
          mergedFile: row.storage_key ? `/uploads/${row.storage_key}` : null,
          storedPages: [],
          fieldRows: fieldRowsByDocument.get(row.id) || [],
        };
        byId.set(row.id, doc);
        documents.push(doc);
      }
      if (row.stored_path) {
        byId.get(row.id).storedPages.push({
          pageId: row.page_id,
          pageNumber: row.page_number,
          pageLabel: row.page_label,
          storedName: row.stored_name,
          storedPath: row.stored_path,
          ocrStatus: row.ocr_status,
          ocrPayload: row.ocr_payload || null,
        });
      }
    }
    return documents;
  }

  async function generateOcrWorkbook() {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('OCR Fields');
    sheet.columns = [
      { header: 'Owner User ID', key: 'owner_user_id', width: 14 },
      { header: 'Entity Type', key: 'entity_type', width: 12 },
      { header: 'Entity ID', key: 'entity_id', width: 10 },
      { header: 'Document ID', key: 'document_id', width: 12 },
      { header: 'Document Type', key: 'document_type', width: 18 },
      { header: 'Display Name', key: 'display_name', width: 24 },
      { header: 'Document Status', key: 'status', width: 16 },
      { header: 'Field', key: 'field_name', width: 28 },
      { header: 'Extracted Details', key: 'field_value', width: 40 },
      { header: 'OCR Engine', key: 'source_engine', width: 16 },
      { header: 'Created At', key: 'created_at', width: 24 },
    ];

    const result = await pool.query(
      `SELECT d.owner_user_id, d.entity_type, d.entity_id, d.id AS document_id, d.document_type, d.display_name, d.status,
              f.display_order, f.field_name, f.field_value, f.source_engine, f.created_at
       FROM document_field_values f
       JOIN documents d ON d.id = f.document_id
       ORDER BY f.created_at DESC, d.id DESC, f.display_order ASC NULLS LAST, f.field_name ASC`
    );

    result.rows.forEach((row) => sheet.addRow(row));
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    return workbook;
  }

  async function generateTruckDocumentRegisterWorkbook() {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Truck Documents');
    sheet.columns = [
      { header: 'Truck ID', key: 'truck_id', width: 10 },
      { header: 'Registration No', key: 'reg_no', width: 18 },
      { header: 'Owner User ID', key: 'owner_user_id', width: 14 },
      { header: 'RC', key: 'rc_document', width: 40 },
      { header: 'Insurance', key: 'insurance_document', width: 40 },
      { header: 'Fitness', key: 'fitness_document', width: 40 },
      { header: 'PUC', key: 'puc_document', width: 40 },
      { header: 'Permit', key: 'permit_document', width: 40 },
      { header: 'Purchase Invoice', key: 'purchase_invoice_document', width: 40 },
      { header: 'Updated At', key: 'updated_at', width: 24 },
    ];

    const result = await pool.query(
      `SELECT truck_id, reg_no, owner_user_id, rc_document, insurance_document, fitness_document, puc_document, permit_document,
              purchase_invoice_document, updated_at
       FROM truck_document_registers
       ORDER BY updated_at DESC, truck_id DESC`
    );

    result.rows.forEach((row) => {
      sheet.addRow({
        truck_id: row.truck_id,
        reg_no: row.reg_no,
        owner_user_id: row.owner_user_id,
        rc_document: flattenRegisterDocument(row.rc_document),
        insurance_document: flattenRegisterDocument(row.insurance_document),
        fitness_document: flattenRegisterDocument(row.fitness_document),
        puc_document: flattenRegisterDocument(row.puc_document),
        permit_document: flattenRegisterDocument(row.permit_document),
        purchase_invoice_document: flattenRegisterDocument(row.purchase_invoice_document),
        updated_at: row.updated_at,
      });
    });

    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    return workbook;
  }

  app.post('/api/fleet/documents/batch', authenticateTransporter, upload.array('documents', 12), async (req, res) => {
    const regNo = cleanString(req.body.regNo) || `PENDING_${Date.now()}`;
    const documentType = normalizeTruckDocumentType(cleanString(req.body.documentType));
    const ownerUserId = toNumberOrNull(req.body.ownerUserId || req.user?.id);
    let pageLabels = normalizePageLabels(req.body.pageLabels);
    const files = Array.isArray(req.files) ? req.files : [];

    if (!documentType) return res.status(400).json({ error: 'documentType is required' });
    if (!files.length) return res.status(400).json({ error: 'At least one document image is required' });

    if (documentType === 'rc') {
      if (files.length !== 2) {
        return res.status(400).json({ error: 'RC upload must include both front and back images' });
      }
      if (!pageLabels.length) {
        pageLabels = ['Front Side', 'Back Side'];
      }
      const normalized = pageLabels.map((item) => String(item).toLowerCase());
      const hasFront = normalized.includes('front side') || normalized.includes('front');
      const hasBack = normalized.includes('back side') || normalized.includes('back');
      if (!hasFront || !hasBack) {
        pageLabels = ['Front Side', 'Back Side'];
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const displayName = TRUCK_DOCUMENT_LABELS[documentType] || sanitizeStorageToken(documentType, 'Truck Document');
      const documentId = await createDocumentRecord(client, {
        ownerUserId,
        entityType: 'truck',
        documentType,
        displayName,
        storageKey: null,
        pageCount: files.length,
      });

      const storedPages = [];
      const mergeSourcePages = [];
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const pageLabel = pageLabels[index] || null;
        const ext = getFileExtensionFromMimeOrName(file);

        let documentLabel = displayName;
        if (documentType === 'rc') {
          const normalizedLabel = String(pageLabel || '').toLowerCase();
          documentLabel = normalizedLabel.includes('back') ? TRUCK_DOCUMENT_LABELS.rc_back : TRUCK_DOCUMENT_LABELS.rc_front;
        }

        const baseName = buildTruckDocumentBaseName(regNo, documentLabel);
        const finalName = `${appendPageSuffix(baseName, documentType === 'rc' ? 0 : index)}${ext}`;
        const renamed = await renameUploadedFile(UPLOADS_DIR, file.filename, finalName);

        await createDocumentPageRecord(client, {
          documentId,
          pageNumber: index + 1,
          pageLabel,
          originalName: file.originalname,
          storedName: renamed.storedName,
          storedPath: renamed.storedPath,
          mimeType: file.mimetype,
          fileSizeBytes: file.size,
        });

        storedPages.push({
          pageNumber: index + 1,
          pageLabel,
          storedName: renamed.storedName,
          storedPath: renamed.storedPath,
        });

        mergeSourcePages.push({
          absolutePath: renamed.absolutePath,
          mimeType: file.mimetype,
        });
      }

      const mergedBaseName = buildTruckDocumentBaseName(
        regNo,
        documentType === 'rc' ? TRUCK_DOCUMENT_LABELS.rc : displayName
      );
      const mergedFileName = `${mergedBaseName}.pdf`;
      const mergedAbsolutePath = path.join(UPLOADS_DIR, mergedFileName);
      await createMergedPdfFromPages(mergeSourcePages, mergedAbsolutePath);
      const mergedStoredPath = `/uploads/${mergedFileName}`;

      await client.query(
        `UPDATE documents
         SET storage_key = $1, display_name = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [mergedFileName, documentType === 'rc' ? TRUCK_DOCUMENT_LABELS.rc : displayName, documentId]
      );

      await client.query('COMMIT');
      res.status(201).json({
        message: 'Truck document batch uploaded',
        documentId,
        regNo,
        truckNumberSuffix: extractTruckNumberSuffix(regNo),
        storedPages,
        mergedFile: {
          storedName: mergedFileName,
          storedPath: mergedStoredPath,
        },
        readyForScan: documentType === 'rc' ? files.length === 2 : true,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  app.post('/api/drivers/documents/batch', authenticateTransporter, upload.array('documents', 12), async (req, res) => {
    const fullName = cleanString(req.body.fullName) || `PENDING_DRIVER_${Date.now()}`;
    const documentType = normalizeTruckDocumentType(cleanString(req.body.documentType));
    const ownerUserId = toNumberOrNull(req.body.ownerUserId || req.user?.id);
    const pageLabels = normalizePageLabels(req.body.pageLabels);
    const files = Array.isArray(req.files) ? req.files : [];

    if (!documentType) return res.status(400).json({ error: 'documentType is required' });
    if (!files.length) return res.status(400).json({ error: 'At least one document image is required' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const displayName = DRIVER_DOCUMENT_LABELS[documentType] || sanitizeStorageToken(documentType, 'Driver Document');
      const documentId = await createDocumentRecord(client, {
        ownerUserId,
        entityType: 'driver',
        documentType,
        displayName,
        storageKey: null,
        pageCount: files.length,
      });

      const storedPages = [];
      const mergeSourcePages = [];
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const pageLabel = pageLabels[index] || null;
        const ext = getFileExtensionFromMimeOrName(file);
        const baseName = buildDriverDocumentBaseName(fullName, displayName);
        const finalName = `${appendPageSuffix(baseName, index)}${ext}`;
        const renamed = await renameUploadedFile(UPLOADS_DIR, file.filename, finalName);

        await createDocumentPageRecord(client, {
          documentId,
          pageNumber: index + 1,
          pageLabel,
          originalName: file.originalname,
          storedName: renamed.storedName,
          storedPath: renamed.storedPath,
          mimeType: file.mimetype,
          fileSizeBytes: file.size,
        });

        storedPages.push({
          pageNumber: index + 1,
          pageLabel,
          storedName: renamed.storedName,
          storedPath: renamed.storedPath,
        });

        mergeSourcePages.push({
          absolutePath: renamed.absolutePath,
          mimeType: file.mimetype,
        });
      }

      const mergedBaseName = buildDriverDocumentBaseName(fullName, displayName);
      const mergedFileName = `${mergedBaseName}.pdf`;
      const mergedAbsolutePath = path.join(UPLOADS_DIR, mergedFileName);
      await createMergedPdfFromPages(mergeSourcePages, mergedAbsolutePath);
      const mergedStoredPath = `/uploads/${mergedFileName}`;

      await client.query(
        `UPDATE documents
         SET storage_key = $1, display_name = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [mergedFileName, displayName, documentId]
      );

      await client.query('COMMIT');
      res.status(201).json({
        message: 'Driver document batch uploaded',
        documentId,
        fullName,
        storedPages,
        mergedFile: {
          storedName: mergedFileName,
          storedPath: mergedStoredPath,
        },
        readyForScan: true,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  app.post('/api/fleet/documents/:documentId/scan', authenticateTransporter, async (req, res) => {
    const documentId = toNumberOrNull(req.params.documentId);
    if (!documentId) return res.status(400).json({ error: 'Valid documentId is required' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const docRes = await client.query(
        'SELECT * FROM documents WHERE id = $1 AND entity_type = $2 LIMIT 1 FOR UPDATE',
        [documentId, 'truck']
      );
      const document = docRes.rows[0];
      if (!document) return res.status(404).json({ error: 'Truck document not found' });
      if (document.status === 'scanned') {
        await client.query('COMMIT');
        return res.json({
          message: 'Truck document already scanned',
          documentId,
          truckId: document.entity_id,
          extracted: document.extracted_data || null,
        });
      }

      await client.query(
        `UPDATE documents
         SET status = 'scanning', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [documentId]
      );

      const pageRes = await client.query('SELECT * FROM document_pages WHERE document_id = $1 ORDER BY page_number ASC', [documentId]);
      const pages = pageRes.rows;
      if (!pages.length) return res.status(400).json({ error: 'No document pages found for scanning' });

      const ocrResults = [];
      for (const page of pages) {
        const absolutePath = path.join(UPLOADS_DIR, page.stored_name);
        const ocr = await runStoredFileOcr(absolutePath, page.mime_type, document.document_type, {
          parseDocumentWithGemini,
          tryLocalGravityOcr,
          tryTesseractDocumentOcr,
        });
        ocrResults.push(ocr);
        await client.query(
          `UPDATE document_pages SET ocr_status = 'completed', ocr_payload = $1 WHERE id = $2`,
          [ocr.payload, page.id]
        );
      }

      const mergedPayload = mergeTruckPayloads(document.document_type, ocrResults.map((item) => item.payload));
      const mergedStoredPath = document.storage_key ? `/uploads/${document.storage_key}` : null;
      const truckId = await upsertTruckFromDocument(
        client,
        mergedPayload,
        document.document_type,
        mergedStoredPath,
        req.body.regNo,
        document.owner_user_id,
        req.body.truckId
      );
      const truckRegRes = await client.query('SELECT reg_no FROM trucks WHERE id = $1 LIMIT 1', [truckId]);
        const resolvedTruckRegNo = formatTruckRegNo(
          truckRegRes.rows[0]?.reg_no ||
          (document.document_type === 'rc' ? mergedPayload.regNo : null) ||
          req.body.regNo ||
          null
        ) || null;
      const sourceEngine = ocrResults.map((item) => item.engine).filter(Boolean).join(', ');
      const fieldRows = buildFieldRowsFromPayload(mergedPayload, document.document_type, sourceEngine);

      await client.query(
        `UPDATE documents
         SET entity_id = $1, status = 'scanned', extracted_data = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [truckId, mergedPayload, documentId]
      );

      await replaceDocumentFieldRows(client, {
        ownerUserId: document.owner_user_id,
        entityType: 'truck',
        entityId: truckId,
        documentId,
        documentType: document.document_type,
        rows: fieldRows,
      });
      await upsertTruckDocumentRegister(client, {
        truckId,
        ownerUserId: document.owner_user_id,
        regNo: resolvedTruckRegNo,
        documentType: document.document_type,
        snapshot: buildRegisterDocumentSnapshot(document, mergedPayload, fieldRows, mergedStoredPath, sourceEngine),
      });

        await client.query(
          `INSERT INTO ocr_scans (doc_type, reg_no, owner_name, raw_data, status, error_msg)
           VALUES ($1, $2, $3, $4, 'SUCCESS', NULL)`,
          [document.document_type, formatTruckRegNo(resolvedTruckRegNo) || resolvedTruckRegNo, mergedPayload.ownerName, mergedPayload]
        );

      await client.query('COMMIT');
      res.json({
        message: 'Truck document scanned successfully',
        documentId,
        truckId,
        extracted: mergedPayload,
      });
    } catch (err) {
      const classified = classifyOcrError(err);
      console.error(`[SCAN][truck][document:${documentId}] ${classified.code}: ${classified.message}`);
      if (err?.stack) {
        console.error(err.stack);
      }
      try {
        await client.query('ROLLBACK');
        await client.query(
          `UPDATE documents
           SET status = 'scan_failed', extracted_data = jsonb_build_object('error', $1, 'code', $2), updated_at = CURRENT_TIMESTAMP
           WHERE id = $3`,
          [classified.message, classified.code, documentId]
        );
        await client.query(
          `UPDATE document_pages
           SET ocr_status = 'failed'
           WHERE document_id = $1 AND ocr_status != 'completed'`,
          [documentId]
        );
        await client.query('DELETE FROM document_field_values WHERE document_id = $1', [documentId]);
          await client.query(
            `INSERT INTO ocr_scans (doc_type, reg_no, owner_name, raw_data, status, error_msg)
             VALUES ($1, $2, $3, NULL, 'FAILED', $4)`,
            ['Unknown', formatTruckRegNo(req.body.regNo) || req.body.regNo || null, null, classified.message]
          );
      } catch (_innerErr) {}
      res.status(classified.status).json({ error: classified.message, code: classified.code });
    } finally {
      client.release();
    }
  });

  app.post('/api/drivers/documents/:documentId/scan', authenticateTransporter, async (req, res) => {
    const documentId = toNumberOrNull(req.params.documentId);
    if (!documentId) return res.status(400).json({ error: 'Valid documentId is required' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const docRes = await client.query(
        'SELECT * FROM documents WHERE id = $1 AND entity_type = $2 LIMIT 1 FOR UPDATE',
        [documentId, 'driver']
      );
      const document = docRes.rows[0];
      if (!document) return res.status(404).json({ error: 'Driver document not found' });
      if (document.status === 'scanned') {
        await client.query('COMMIT');
        return res.json({
          message: 'Driver document already scanned',
          documentId,
          driverId: document.entity_id,
          extracted: document.extracted_data || null,
        });
      }

      await client.query(
        `UPDATE documents
         SET status = 'scanning', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [documentId]
      );

      const pageRes = await client.query('SELECT * FROM document_pages WHERE document_id = $1 ORDER BY page_number ASC', [documentId]);
      const pages = pageRes.rows;
      if (!pages.length) return res.status(400).json({ error: 'No document pages found for scanning' });

      const ocrResults = [];
      for (const page of pages) {
        const absolutePath = path.join(UPLOADS_DIR, page.stored_name);
        const ocr = await runStoredFileOcr(absolutePath, page.mime_type, document.document_type, {
          parseDocumentWithGemini,
          tryLocalGravityOcr,
          tryTesseractDocumentOcr,
        });
        ocrResults.push(ocr);
        await client.query(
          `UPDATE document_pages SET ocr_status = 'completed', ocr_payload = $1 WHERE id = $2`,
          [ocr.payload, page.id]
        );
      }

      const mergedPayload = mergeDriverPayloads(document.document_type, ocrResults.map((item) => item.payload));
      const mergedStoredPath = document.storage_key ? `/uploads/${document.storage_key}` : null;
      const driverId = await upsertDriverFromDocument(client, mergedPayload, document.document_type, mergedStoredPath, req.body.fullName);
      const sourceEngine = ocrResults.map((item) => item.engine).filter(Boolean).join(', ');
      const fieldRows = buildFieldRowsFromPayload(mergedPayload, document.document_type, sourceEngine);

      await client.query(
        `UPDATE documents
         SET entity_id = $1, status = 'scanned', extracted_data = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [driverId, mergedPayload, documentId]
      );

      await replaceDocumentFieldRows(client, {
        ownerUserId: document.owner_user_id,
        entityType: 'driver',
        entityId: driverId,
        documentId,
        documentType: document.document_type,
        rows: fieldRows,
      });
      await upsertDriverDocumentRegister(client, {
        driverId,
        ownerUserId: document.owner_user_id,
        fullName: mergedPayload.fullName,
        documentType: document.document_type,
        snapshot: buildRegisterDocumentSnapshot(document, mergedPayload, fieldRows, mergedStoredPath, sourceEngine),
      });

      await client.query(
        `INSERT INTO ocr_scans (doc_type, reg_no, owner_name, raw_data, status, error_msg)
         VALUES ($1, NULL, $2, $3, 'SUCCESS', NULL)`,
        [document.document_type, mergedPayload.fullName, mergedPayload]
      );

      await client.query('COMMIT');
      res.json({
        message: 'Driver document scanned successfully',
        documentId,
        driverId,
        extracted: mergedPayload,
      });
    } catch (err) {
      const classified = classifyOcrError(err);
      console.error(`[SCAN][driver][document:${documentId}] ${classified.code}: ${classified.message}`);
      if (err?.stack) {
        console.error(err.stack);
      }
      try {
        await client.query('ROLLBACK');
        await client.query(
          `UPDATE documents
           SET status = 'scan_failed', extracted_data = jsonb_build_object('error', $1, 'code', $2), updated_at = CURRENT_TIMESTAMP
           WHERE id = $3`,
          [classified.message, classified.code, documentId]
        );
        await client.query(
          `UPDATE document_pages
           SET ocr_status = 'failed'
           WHERE document_id = $1 AND ocr_status != 'completed'`,
          [documentId]
        );
        await client.query('DELETE FROM document_field_values WHERE document_id = $1', [documentId]);
        await client.query(
          `INSERT INTO ocr_scans (doc_type, reg_no, owner_name, raw_data, status, error_msg)
           VALUES ($1, NULL, $2, NULL, 'FAILED', $3)`,
          ['Unknown', req.body.fullName || null, classified.message]
        );
      } catch (_innerErr) {}
      res.status(classified.status).json({ error: classified.message, code: classified.code });
    } finally {
      client.release();
    }
  });

  app.get('/api/fleet/prefill/:regNo', authenticateTransporter, async (req, res) => {
    const regNo = cleanString(req.params.regNo);
    const normalizedRegNo = normalizeTruckRegNo(regNo);
    const truckRes = await pool.query(
      `SELECT *
       FROM trucks
       WHERE (
             UPPER(REGEXP_REPLACE(COALESCE(reg_no, ''), '[^A-Z0-9]', '', 'g')) = $1
          OR id IN (
               SELECT truck_id
               FROM truck_document_registers
               WHERE UPPER(REGEXP_REPLACE(COALESCE(reg_no, ''), '[^A-Z0-9]', '', 'g')) = $1
                 AND (owner_user_id = $2 OR owner_user_id IS NULL)
             )
       )
         AND (owner_user_id = $2 OR owner_user_id IS NULL)
       ORDER BY COALESCE(updated_at, created_at) DESC NULLS LAST, id DESC
       LIMIT 1`,
      [normalizedRegNo, req.user?.id || null]
    );
    const truck = truckRes.rows[0];
    if (!truck) return res.status(404).json({ error: 'Truck not found' });

    const documents = await getDocumentsForEntity('truck', truck.id);

    res.json({ truck, documents });
  });

  app.get('/api/fleet/:id/documents', authenticateTransporter, async (req, res) => {
    const id = toNumberOrNull(req.params.id);
    if (!id) return res.status(400).json({ error: 'Valid truck id is required' });
    const truckRes = await pool.query(
      `SELECT *
       FROM trucks
       WHERE id = $1
         AND (owner_user_id = $2 OR owner_user_id IS NULL)
       LIMIT 1`,
      [id, req.user?.id || null]
    );
    const truck = truckRes.rows[0];
    if (!truck) return res.status(404).json({ error: 'Truck not found' });
    const documents = await getDocumentsForEntity('truck', truck.id);
    res.json({ truck, documents });
  });

  app.get('/api/fleet/documents/:documentId/download-originals', authenticateTransporter, async (req, res) => {
    const documentId = toNumberOrNull(req.params.documentId);
    if (!documentId) return res.status(400).json({ error: 'Valid documentId is required' });

    const docRes = await pool.query(
      `SELECT d.*
       FROM documents d
       LEFT JOIN trucks t ON d.entity_type = 'truck' AND d.entity_id = t.id
       WHERE d.id = $1
         AND d.entity_type = 'truck'
         AND (d.owner_user_id = $2 OR d.owner_user_id IS NULL OR t.owner_user_id = $2 OR t.owner_user_id IS NULL)
       LIMIT 1`,
      [documentId, req.user?.id || null]
    );
    const document = docRes.rows[0];
    if (!document) return res.status(404).json({ error: 'Truck document not found' });

    const pageRes = await pool.query(
      `SELECT page_number, page_label, original_name, stored_name, stored_path
       FROM document_pages
       WHERE document_id = $1
       ORDER BY page_number ASC`,
      [documentId]
    );
    const pages = pageRes.rows || [];
    if (!pages.length) return res.status(404).json({ error: 'No stored upload pages found for this document' });

    if (pages.length === 1) {
      const page = pages[0];
      const safeName = sanitizeStorageToken(page.page_label || page.original_name || page.stored_name || document.display_name || 'document');
      const absolutePath = path.join(UPLOADS_DIR, page.stored_name);
      if (!fs.existsSync(absolutePath)) {
        return res.status(404).json({ error: 'Stored upload file could not be found' });
      }
      return res.download(absolutePath, page.page_label || page.original_name || `${safeName}${path.extname(page.stored_name || '') || ''}`);
    }

    const zipBase = sanitizeStorageToken(document.display_name || document.document_type || `truck-document-${documentId}`);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipBase}.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || 'Could not prepare document download' });
      } else {
        res.end();
      }
    });
    archive.pipe(res);

    pages.forEach((page, index) => {
      const absolutePath = path.join(UPLOADS_DIR, page.stored_name);
      if (!fs.existsSync(absolutePath)) return;
      const ext = path.extname(page.stored_name || page.original_name || '') || '.jpg';
      const entryName = `${String(index + 1).padStart(2, '0')}_${sanitizeStorageToken(page.page_label || page.original_name || page.stored_name || `page_${index + 1}`)}${ext}`;
      archive.file(absolutePath, { name: entryName });
    });
    await archive.finalize();
  });

  app.get('/api/fleet/documents/:documentId/download-pdf', authenticateTransporter, async (req, res) => {
    const documentId = toNumberOrNull(req.params.documentId);
    if (!documentId) return res.status(400).json({ error: 'Valid documentId is required' });

    const docRes = await pool.query(
      `SELECT d.*
       FROM documents d
       LEFT JOIN trucks t ON d.entity_type = 'truck' AND d.entity_id = t.id
       WHERE d.id = $1
         AND d.entity_type = 'truck'
         AND (d.owner_user_id = $2 OR d.owner_user_id IS NULL OR t.owner_user_id = $2 OR t.owner_user_id IS NULL)
       LIMIT 1`,
      [documentId, req.user?.id || null]
    );
    const document = docRes.rows[0];
    if (!document) return res.status(404).json({ error: 'Truck document not found' });

    let pdfAbsolutePath = null;
    let pdfDownloadName = sanitizeStorageToken(document.display_name || document.document_type || `truck-document-${documentId}`) || `truck-document-${documentId}`;

    if (document.storage_key) {
      const storedPdf = path.join(UPLOADS_DIR, document.storage_key);
      if (fs.existsSync(storedPdf)) {
        pdfAbsolutePath = storedPdf;
      }
    }

    if (!pdfAbsolutePath) {
      const pageRes = await pool.query(
        `SELECT page_number, page_label, original_name, stored_name, stored_path, mime_type
         FROM document_pages
         WHERE document_id = $1
         ORDER BY page_number ASC`,
        [documentId]
      );
      const pages = pageRes.rows || [];
      if (!pages.length) return res.status(404).json({ error: 'No stored pages found for this document' });

      const mergeSourcePages = pages
        .map((page) => {
          const absolutePath = path.join(UPLOADS_DIR, page.stored_name);
          if (!fs.existsSync(absolutePath)) return null;
          return {
            absolutePath,
            mimeType: page.mime_type || null,
          };
        })
        .filter(Boolean);

      if (!mergeSourcePages.length) return res.status(404).json({ error: 'Stored page files could not be found' });

      const mergedFileName = `${pdfDownloadName}_${documentId}.pdf`;
      pdfAbsolutePath = path.join(UPLOADS_DIR, mergedFileName);
      await createMergedPdfFromPages(mergeSourcePages, pdfAbsolutePath);
    }

    return res.download(pdfAbsolutePath, `${pdfDownloadName}.pdf`);
  });

  app.get('/api/fleet/document-register', authenticateTransporter, async (req, res) => {
    const result = await pool.query(
      `SELECT *
       FROM truck_document_registers
       WHERE owner_user_id = $1
       ORDER BY updated_at DESC, truck_id DESC`
      ,
      [req.user?.id || null]
    );
    res.json({ rows: result.rows });
  });

  app.get('/api/drivers/prefill/:fullName', authenticateTransporter, async (req, res) => {
    const fullName = cleanString(req.params.fullName);
    const driverRes = await pool.query('SELECT * FROM drivers WHERE full_name = $1 LIMIT 1', [fullName]);
    const driver = driverRes.rows[0];
    if (!driver) return res.status(404).json({ error: 'Driver not found' });

    const documents = await getDocumentsForEntity('driver', driver.id);

    res.json({ driver, documents });
  });

  app.get('/api/drivers/:id/documents', authenticateTransporter, async (req, res) => {
    const id = toNumberOrNull(req.params.id);
    if (!id) return res.status(400).json({ error: 'Valid driver id is required' });
    const driverRes = await pool.query(
      `SELECT *
       FROM drivers
       WHERE id = $1
         AND (owner_user_id = $2 OR owner_user_id IS NULL)
       LIMIT 1`,
      [id, req.user?.id || null]
    );
    const driver = driverRes.rows[0];
    if (!driver) return res.status(404).json({ error: 'Driver not found' });
    const documents = await getDocumentsForEntity('driver', driver.id);
    res.json({ driver, documents });
  });

  app.get('/api/drivers/document-register', authenticateTransporter, async (req, res) => {
    const result = await pool.query(
      `SELECT *
       FROM driver_document_registers
       WHERE owner_user_id = $1
       ORDER BY updated_at DESC, driver_id DESC`
      ,
      [req.user?.id || null]
    );
    res.json({ rows: result.rows });
  });

  app.get('/api/export/ocr-fields', authenticateTransporter, async (_req, res) => {
    try {
      const workbook = await generateOcrWorkbook();
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename=OCR_Field_Register.xlsx');
      await workbook.xlsx.write(res);
      res.end();
    } catch (err) {
      res.status(500).json({ error: err.message || 'OCR export failed' });
    }
  });

  app.get('/api/export/truck-document-register', authenticateTransporter, async (_req, res) => {
    try {
      const workbook = await generateTruckDocumentRegisterWorkbook();
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename=Truck_Document_Register.xlsx');
      await workbook.xlsx.write(res);
      res.end();
    } catch (err) {
      res.status(500).json({ error: err.message || 'Truck document register export failed' });
    }
  });
}

module.exports = {
  registerDocumentWorkflow,
  ensureDocumentTables,
  createTempMulterStorage,
};
