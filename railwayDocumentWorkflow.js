const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

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

function normalizeTruckPayload(payload) {
  const flat = flattenOcrPayload(payload || {});
  return {
    regNo: firstNonEmpty(flat['Reg No'], flat.regNo, flat.registration_no, flat.registrationNumber),
    ownerName: firstNonEmpty(flat['Owner Name'], flat.ownerName, flat.owner_name),
    chassisNo: firstNonEmpty(flat['Chassis No'], flat.chassisNo, flat.chassis_number),
    engineNo: firstNonEmpty(flat['Engine No'], flat.engineNo, flat.engine_number),
    insuranceProvider: firstNonEmpty(flat['Insurer'], flat.insurer, flat.insuranceProvider),
    policyNo: firstNonEmpty(flat['Policy No'], flat.policyNo, flat.policy_number),
    insuranceExpiry: parseDateToText(firstNonEmpty(flat['Insurance Expiry'], flat.insExpiry, flat.expiry, flat.expiryDate)),
    fitnessCertNo: firstNonEmpty(flat['Fitness Certificate No'], flat.fitnessCertNo, flat.certificateNo),
    fitnessExpiry: parseDateToText(firstNonEmpty(flat['Fitness Expiry'], flat.fitnessExpiry, flat.expiry, flat.expiryDate)),
    pucCertNo: firstNonEmpty(flat['PUC Certificate No'], flat.pucCertNo, flat.certificateNo),
    pucExpiry: parseDateToText(firstNonEmpty(flat['PUC Expiry'], flat.pucExpiry, flat.expiry, flat.expiryDate)),
    permitNo: firstNonEmpty(flat['Permit No'], flat.permitNo),
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
  roadtax: 'Road Tax',
};

const DRIVER_DOCUMENT_LABELS = {
  dl: 'DL',
  aadhar: 'Aadhaar Card',
  pan: 'Pan Card',
  photo: 'Photo',
};

async function ensureDocumentTables(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS documents (
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

  await pool.query(`CREATE TABLE IF NOT EXISTS document_pages (
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

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_documents_entity ON documents (entity_type, entity_id, document_type)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_document_pages_document ON document_pages (document_id, page_number)`);
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
  if (deps.tryLocalGravityOcr) {
    try {
      const localResult = await deps.tryLocalGravityOcr(base64, mimeType || 'image/jpeg');
      return { engine: 'gravityocr', payload: flattenOcrPayload(localResult) };
    } catch (_err) {}
  }
  const geminiResult = await deps.parseDocumentWithGemini(
    base64,
    mimeType || 'image/jpeg',
    documentType || 'logistics'
  );
  return { engine: 'gemini', payload: flattenOcrPayload(geminiResult) };
}

async function upsertTruckFromDocument(client, mergedPayload, documentType, mergedStoredPath, regNoHint = null) {
  const regNo = firstNonEmpty(mergedPayload.regNo, regNoHint);
  if (!regNo) throw new Error('Truck registration number could not be resolved from OCR');

  const existing = await client.query('SELECT * FROM trucks WHERE reg_no = $1 LIMIT 1', [regNo]);
  const row = existing.rows[0];

  const patch = {
    reg_no: regNo,
    owner_name: mergedPayload.ownerName,
    chassis_no: mergedPayload.chassisNo,
    engine_no: mergedPayload.engineNo,
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

  if (documentType === 'rc') patch.doc_rc_path = mergedStoredPath;
  if (documentType === 'insurance') patch.doc_insurance_path = mergedStoredPath;
  if (documentType === 'fitness') patch.doc_fitness_path = mergedStoredPath;
  if (documentType === 'puc') patch.doc_puc_path = mergedStoredPath;
  if (documentType === 'permit') patch.doc_permit_path = mergedStoredPath;
  if (documentType === 'roadtax') patch.doc_roadtax_path = mergedStoredPath;

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
}) {
  app.post('/api/fleet/documents/batch', authenticateTransporter, upload.array('documents', 12), async (req, res) => {
    const regNo = cleanString(req.body.regNo);
    const documentType = cleanString(req.body.documentType);
    const ownerUserId = toNumberOrNull(req.body.ownerUserId || req.user?.id);
    const pageLabels = normalizePageLabels(req.body.pageLabels);
    const files = Array.isArray(req.files) ? req.files : [];

    if (!regNo) return res.status(400).json({ error: 'Truck registration number is required' });
    if (!documentType) return res.status(400).json({ error: 'documentType is required' });
    if (!ownerUserId) return res.status(400).json({ error: 'ownerUserId is required' });
    if (!files.length) return res.status(400).json({ error: 'At least one document image is required' });

    if (documentType === 'rc') {
      if (files.length !== 2) {
        return res.status(400).json({ error: 'RC upload must include both front and back images' });
      }
      const normalized = pageLabels.map((item) => String(item).toLowerCase());
      const hasFront = normalized.includes('front side') || normalized.includes('front');
      const hasBack = normalized.includes('back side') || normalized.includes('back');
      if (!hasFront || !hasBack) {
        return res.status(400).json({ error: 'RC upload must include Front Side and Back Side labels' });
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await ensureDocumentTables(pool);

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
    const fullName = cleanString(req.body.fullName);
    const documentType = cleanString(req.body.documentType);
    const ownerUserId = toNumberOrNull(req.body.ownerUserId || req.user?.id);
    const pageLabels = normalizePageLabels(req.body.pageLabels);
    const files = Array.isArray(req.files) ? req.files : [];

    if (!fullName) return res.status(400).json({ error: 'Driver fullName is required' });
    if (!documentType) return res.status(400).json({ error: 'documentType is required' });
    if (!ownerUserId) return res.status(400).json({ error: 'ownerUserId is required' });
    if (!files.length) return res.status(400).json({ error: 'At least one document image is required' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await ensureDocumentTables(pool);

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
      await ensureDocumentTables(pool);

      const docRes = await client.query('SELECT * FROM documents WHERE id = $1 AND entity_type = $2 LIMIT 1', [documentId, 'truck']);
      const document = docRes.rows[0];
      if (!document) return res.status(404).json({ error: 'Truck document not found' });

      const pageRes = await client.query('SELECT * FROM document_pages WHERE document_id = $1 ORDER BY page_number ASC', [documentId]);
      const pages = pageRes.rows;
      if (!pages.length) return res.status(400).json({ error: 'No document pages found for scanning' });

      const ocrResults = [];
      for (const page of pages) {
        const absolutePath = path.join(UPLOADS_DIR, page.stored_name);
        const ocr = await runStoredFileOcr(absolutePath, page.mime_type, document.document_type, {
          parseDocumentWithGemini,
          tryLocalGravityOcr,
        });
        ocrResults.push(ocr);
        await client.query(
          `UPDATE document_pages SET ocr_status = 'completed', ocr_payload = $1 WHERE id = $2`,
          [ocr.payload, page.id]
        );
      }

      const mergedPayload = mergeTruckPayloads(document.document_type, ocrResults.map((item) => item.payload));
      const mergedStoredPath = document.storage_key ? `/uploads/${document.storage_key}` : null;
      const truckId = await upsertTruckFromDocument(client, mergedPayload, document.document_type, mergedStoredPath, req.body.regNo);

      await client.query(
        `UPDATE documents
         SET entity_id = $1, status = 'scanned', extracted_data = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [truckId, mergedPayload, documentId]
      );

      await client.query(
        `INSERT INTO ocr_scans (doc_type, reg_no, owner_name, raw_data, status, error_msg)
         VALUES ($1, $2, $3, $4, 'SUCCESS', NULL)`,
        [document.document_type, mergedPayload.regNo, mergedPayload.ownerName, mergedPayload]
      );

      await client.query('COMMIT');
      res.json({
        message: 'Truck document scanned successfully',
        documentId,
        truckId,
        extracted: mergedPayload,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: err.message });
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
      await ensureDocumentTables(pool);

      const docRes = await client.query('SELECT * FROM documents WHERE id = $1 AND entity_type = $2 LIMIT 1', [documentId, 'driver']);
      const document = docRes.rows[0];
      if (!document) return res.status(404).json({ error: 'Driver document not found' });

      const pageRes = await client.query('SELECT * FROM document_pages WHERE document_id = $1 ORDER BY page_number ASC', [documentId]);
      const pages = pageRes.rows;
      if (!pages.length) return res.status(400).json({ error: 'No document pages found for scanning' });

      const ocrResults = [];
      for (const page of pages) {
        const absolutePath = path.join(UPLOADS_DIR, page.stored_name);
        const ocr = await runStoredFileOcr(absolutePath, page.mime_type, document.document_type, {
          parseDocumentWithGemini,
          tryLocalGravityOcr,
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

      await client.query(
        `UPDATE documents
         SET entity_id = $1, status = 'scanned', extracted_data = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [driverId, mergedPayload, documentId]
      );

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
      await client.query('ROLLBACK');
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  app.get('/api/fleet/prefill/:regNo', authenticateTransporter, async (req, res) => {
    const regNo = cleanString(req.params.regNo);
    const truckRes = await pool.query('SELECT * FROM trucks WHERE reg_no = $1 LIMIT 1', [regNo]);
    const truck = truckRes.rows[0];
    if (!truck) return res.status(404).json({ error: 'Truck not found' });

    await ensureDocumentTables(pool);
    const docsRes = await pool.query(
      `SELECT d.*, dp.stored_path, dp.page_number
       FROM documents d
       LEFT JOIN document_pages dp ON dp.document_id = d.id
       WHERE d.entity_type = 'truck' AND d.entity_id = $1
       ORDER BY d.id DESC, dp.page_number ASC`,
      [truck.id]
    );

    const documents = [];
    const byId = new Map();
    for (const row of docsRes.rows) {
      if (!byId.has(row.id)) {
        const doc = {
          documentId: row.id,
          documentType: row.document_type,
          displayName: row.display_name,
          mergedFile: row.storage_key ? `/uploads/${row.storage_key}` : null,
          pageCount: row.page_count,
          storedPages: [],
        };
        byId.set(row.id, doc);
        documents.push(doc);
      }
      if (row.stored_path) byId.get(row.id).storedPages.push(row.stored_path);
    }

    res.json({ truck, documents });
  });

  app.get('/api/drivers/prefill/:fullName', authenticateTransporter, async (req, res) => {
    const fullName = cleanString(req.params.fullName);
    const driverRes = await pool.query('SELECT * FROM drivers WHERE full_name = $1 LIMIT 1', [fullName]);
    const driver = driverRes.rows[0];
    if (!driver) return res.status(404).json({ error: 'Driver not found' });

    await ensureDocumentTables(pool);
    const docsRes = await pool.query(
      `SELECT d.*, dp.stored_path, dp.page_number
       FROM documents d
       LEFT JOIN document_pages dp ON dp.document_id = d.id
       WHERE d.entity_type = 'driver' AND d.entity_id = $1
       ORDER BY d.id DESC, dp.page_number ASC`,
      [driver.id]
    );

    const documents = [];
    const byId = new Map();
    for (const row of docsRes.rows) {
      if (!byId.has(row.id)) {
        const doc = {
          documentId: row.id,
          documentType: row.document_type,
          displayName: row.display_name,
          mergedFile: row.storage_key ? `/uploads/${row.storage_key}` : null,
          pageCount: row.page_count,
          storedPages: [],
        };
        byId.set(row.id, doc);
        documents.push(doc);
      }
      if (row.stored_path) byId.get(row.id).storedPages.push(row.stored_path);
    }

    res.json({ driver, documents });
  });
}

module.exports = {
  registerDocumentWorkflow,
  ensureDocumentTables,
  createTempMulterStorage,
};
