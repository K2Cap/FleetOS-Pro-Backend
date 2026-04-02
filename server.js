require('dotenv').config();

const { registerDocumentWorkflow, ensureDocumentTables, createTempMulterStorage } = require('./railwayDocumentWorkflow');
const { PDFDocument } = require('pdf-lib');

// --- CRITICAL DEPLOYMENT SAFETY SHIELD ---
process.on('uncaughtException', (err) => {
    console.error('🔥 FATAL UNCAUGHT EXCEPTION:', err.message);
    console.error(err.stack);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('🔥 UNHANDLED REJECTION:', reason);
});
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { parseDocumentWithGemini } = require('./vision-service');
const { tryTesseractDocumentOcr } = require('./local-ocr');
const ExcelJS = require('exceljs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_dev_only';

const app = express();

// --- DIAGNOSTIC TRAFFIC LOGGER ---
app.use((req, res, next) => {
    console.log(`📥 INCOMING REQUEST: ${req.method} ${req.url} from ${req.ip}`);
    next();
});

// --- TOP-PRIORITY HEALTH SIGNAL ---
app.get('/health', (req, res) => res.status(200).json({ status: "healthy", heartbeat: true }));
app.get('/', (req, res) => res.status(200).json({ status: "online", signal: "FleetOS PRO" }));

// --- MOBILE CONNECTIVITY PATCH: Explicit OPTIONS Handling ---
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// --- TOP PRIORITY: Global Unlock ---
app.use(cors()); 

const port = process.env.PORT || 3000;
const MAX_UPLOAD_SIZE_MB = Number(process.env.MAX_UPLOAD_SIZE_MB || 15);
const MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024;
const PASSWORD_KEYLEN = 64;

// --- PRODUCTION CORS: All-Permissive Global Unlock ---
app.use(cors()); 
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json());

app.set('trust proxy', 1);
// Priority to DATABASE_URL for Railway/Heroku/Render cloud environments
const poolConfig = process.env.DATABASE_URL 
    ? { 
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false } 
      }
    : {
        user: process.env.PGUSER || 'postgres',
        host: process.env.PGHOST || 'localhost',
        database: process.env.PGDATABASE || 'fleetos',
        password: process.env.PGPASSWORD || 'postgres',
        port: Number(process.env.PGPORT) || 5432,
    };

const pool = new Pool({
    ...poolConfig,
    max: Number(process.env.PGPOOL_MAX || 20),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
    connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 10000),
});

pool.on('error', (err) => {
    console.error('WATERTIGHT: Unexpected idle PostgreSQL client error:', err.message);
});

function hashLegacyPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const derived = crypto.scryptSync(password, salt, PASSWORD_KEYLEN).toString('hex');
    return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, storedHash) {
    if (!storedHash) return false;

    if (storedHash.startsWith('scrypt$')) {
        const [, salt, expected] = storedHash.split('$');
        if (!salt || !expected) return false;
        const derived = crypto.scryptSync(password, salt, PASSWORD_KEYLEN).toString('hex');
        const left = Buffer.from(derived, 'hex');
        const right = Buffer.from(expected, 'hex');
        return left.length === right.length && crypto.timingSafeEqual(left, right);
    }

    return hashLegacyPassword(password) === storedHash;
}

function isLegacyPasswordHash(storedHash) {
    return !!storedHash && !storedHash.startsWith('scrypt$');
}

function cleanString(value) {
    if (value === undefined || value === null) return null;
    const trimmed = String(value).trim();
    return trimmed === '' ? null : trimmed;
}

function extractExpenseSearchText(...values) {
    return values
        .flatMap((value) => {
            if (value === undefined || value === null) return [];
            if (typeof value === 'object') {
                try {
                    return [JSON.stringify(value)];
                } catch (err) {
                    return [];
                }
            }
            return [String(value)];
        })
        .join(' ')
        .toLowerCase();
}

function classifyExpenseCategory(...values) {
    const text = extractExpenseSearchText(...values);
    if (!text) return 'Other Expense';
    if (/\b(urea|def|adblue|ad blue)\b/.test(text)) return 'Urea Expense';
    if (/\b(diesel|fuel|petrol|cng|lng)\b/.test(text)) return 'Fuel Expense';
    if (/\b(rto|border|police|toll|entry|checkpost|check post|octroi|naka|barrier)\b/.test(text)) return 'Border Expense';
    return 'Other Expense';
}

function normalizePhone(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (digits.length >= 10) return digits.slice(-10);
    return digits;
}

function isSixDigitCode(value) {
    return /^\d{6}$/.test(String(value || ''));
}

function toNumberOrNull(value) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeDownloadName(value, fallback) {
    const raw = cleanString(value) || fallback;
    return raw.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, ' ').trim() || fallback;
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

    const textMatch = cleaned.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{2,4})$/);
    if (textMatch) {
        const parsed = new Date(`${textMatch[1]} ${textMatch[2]} ${textMatch[3]}`);
        if (!Number.isNaN(parsed.getTime())) return parsed;
    }

    const native = new Date(cleaned);
    if (!Number.isNaN(native.getTime())) return native;

    return null;
}

function startOfDay(date) {
    const next = new Date(date);
    next.setHours(0, 0, 0, 0);
    return next;
}

function endOfDay(date) {
    const next = new Date(date);
    next.setHours(23, 59, 59, 999);
    return next;
}

function getTripDateWindow(trip) {
    const start = parseFlexibleDate(trip?.start_date_raw || trip?.start_date);
    if (!start) return null;

    let end = parseFlexibleDate(trip?.end_date_raw || trip?.end_date || trip?.auto_end_date_raw);
    if (!end) {
        if (trip?.status === 'Completed') {
            end = start;
        } else {
            end = new Date();
        }
    }

    return {
        start: startOfDay(start),
        end: endOfDay(end)
    };
}

function getTripAccountingDate(trip) {
    return parseFlexibleDate(trip?.start_date_raw || trip?.start_date || trip?.created_at);
}

function getTripOperationalDayMetrics(trip) {
    const window = getTripDateWindow(trip);
    if (!window) {
        return { actualDays: 0, depreciationDays: 0 };
    }
    const dayMs = 24 * 60 * 60 * 1000;
    const actualDays = Math.max(1, Math.floor((startOfDay(window.end).getTime() - startOfDay(window.start).getTime()) / dayMs) + 1);
    return {
        actualDays,
        depreciationDays: actualDays
    };
}

function getExpenseTotalPaise(expense) {
    const total = toNumberOrNull(expense?.total);
    if (total !== null) return Math.round(total);

    const amount = toNumberOrNull(expense?.amount);
    if (amount !== null) return Math.round(amount * 100);

    return 0;
}

function serializeExpenseRow(row) {
    const metadata = row?.metadata && typeof row.metadata === 'string'
        ? (() => {
            try { return JSON.parse(row.metadata); } catch (err) { return {}; }
        })()
        : (row?.metadata || {});
    const totalPaise = getExpenseTotalPaise(row);
    const canonicalCategory = classifyExpenseCategory(
        row?.type,
        row?.category,
        row?.merchant,
        row?.notes,
        row?.place,
        metadata?.category,
        metadata?.originalCategory,
        metadata?.vendor,
        metadata?.merchant,
        metadata?.description,
        metadata?.expense_item
    );

    return {
        ...row,
        metadata,
        expense_type: canonicalCategory,
        category: canonicalCategory,
        type: canonicalCategory,
        route_from: row?.route_from || metadata?.route_from || null,
        route_to: row?.route_to || metadata?.route_to || null,
        place: row?.place || metadata?.place || null,
        bill_image_data: row?.bill_image_data || metadata?.receiptImageDataUrl || null,
        total_paise: totalPaise,
        total_rupees: Number((totalPaise / 100).toFixed(2))
    };
}

function createRecentMonthBuckets(monthCount = 8) {
    const now = new Date();
    const buckets = [];
    for (let i = monthCount - 1; i >= 0; i--) {
        const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
        buckets.push({
            key: `${date.getFullYear()}-${date.getMonth()}`,
            label: date.toLocaleString('default', { month: 'short' }),
            revenueRupees: 0,
            costRupees: 0
        });
    }
    return buckets;
}

function buildRevenueCostSeries(trips = [], expenses = [], monthCount = 24) {
    const buckets = createRecentMonthBuckets(monthCount);
    const bucketMap = new Map(buckets.map((bucket) => [bucket.key, bucket]));
    const tripAccountingMonthMap = new Map();

    trips.forEach((trip) => {
        const amount = parseFloat(trip?.freight || 0);
        const parsedDate = getTripAccountingDate(trip);
        if (!parsedDate) return;
        const tripId = cleanString(trip?.id);
        if (tripId) {
            tripAccountingMonthMap.set(tripId, `${parsedDate.getFullYear()}-${parsedDate.getMonth()}`);
        }
        const bucket = bucketMap.get(`${parsedDate.getFullYear()}-${parsedDate.getMonth()}`);
        if (!bucket) return;
        if (Number.isFinite(amount) && amount > 0) {
            bucket.revenueRupees += amount;
        }

        const dayMetrics = getTripOperationalDayMetrics(trip);
        const bhattaRupees = Math.max(0, dayMetrics.actualDays * (Number(trip?.bhatta || 0) || 0));
        const depreciationRupees = Math.max(0, (((Number(trip?.truck_purchase_price || 0) || 0) / (365 * 7)) * dayMetrics.depreciationDays) || 0);
        const tyreWearRupees = Math.max(0, ((((Number(trip?.truck_tyres_count || 0) || 0) * 25000) / 60000) * (Number(trip?.distance_km || 0) || 0)) || 0);
        bucket.costRupees += bhattaRupees + depreciationRupees + tyreWearRupees;
    });

    expenses
        .filter((expense) => expense?.status !== 'Rejected')
        .forEach((expense) => {
            const amount = Number(expense?.total_rupees || 0);
            if (!Number.isFinite(amount) || amount <= 0) return;
            const tripId = cleanString(expense?.trip_id);
            const tripBucketKey = tripId ? tripAccountingMonthMap.get(tripId) : null;
            const parsedDate = tripBucketKey ? null : parseFlexibleDate(expense?.date || expense?.issued_at || expense?.created_at);
            const bucketKey = tripBucketKey || (parsedDate ? `${parsedDate.getFullYear()}-${parsedDate.getMonth()}` : null);
            if (!bucketKey) return;
            const bucket = bucketMap.get(bucketKey);
            if (bucket) bucket.costRupees += amount;
        });

    return buckets.map((bucket) => ({
        m: bucket.label,
        r: Number((bucket.revenueRupees / 100000).toFixed(2)),
        c: Number((bucket.costRupees / 100000).toFixed(2))
    }));
}

function buildExpenseBreakdown(expenses = []) {
    const costMap = {};
    expenses
        .filter((expense) => expense?.status !== 'Rejected')
        .forEach((expense) => {
            const key = expense?.expense_type || 'General';
            costMap[key] = (costMap[key] || 0) + Number(expense?.total_rupees || 0);
        });

    return Object.entries(costMap).map(([label, value], index) => ({
        label,
        value,
        color: ['#1a5c3a', '#10b981', '#e8671a', '#c9930a', '#eff6ff'][index % 5]
    }));
}

function verifyDriverPin(pin, storedPin) {
    if (!storedPin) return false;
    if (String(storedPin).startsWith('scrypt$')) {
        return verifyPassword(pin, storedPin);
    }
    return String(storedPin) === String(pin);
}

function sanitizeDriverRow(row, { includeTransporterOtp = false } = {}) {
    if (!row) return null;
    const sanitized = { ...row };
    delete sanitized.password;
    if (!includeTransporterOtp) {
        delete sanitized.temp_password;
    }
    return sanitized;
}

function getPublicBaseUrl(req) {
    if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL;
    return `${req.protocol}://${req.get('host')}`.replace(/\/+$/, '');
}

async function generateUniqueDriverOtp() {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        const candidate = Math.floor(100000 + Math.random() * 900000).toString();
        const existing = await pool.query('SELECT id FROM drivers WHERE temp_password = $1 LIMIT 1', [candidate]);
        if (existing.rows.length === 0) return candidate;
    }
    throw new Error('Unable to generate a unique 6-digit OTP right now');
}

function removeUploadFile(filePath) {
    if (!filePath) return;
    const resolved = path.resolve(__dirname, `.${filePath.startsWith('/') ? filePath : `/${filePath}`}`);
    if (!resolved.startsWith(UPLOADS_DIR + path.sep) && resolved !== UPLOADS_DIR) return;
    fs.promises.unlink(resolved).catch((err) => {
        if (err.code !== 'ENOENT') {
            console.error(`WATERTIGHT: Failed to delete upload ${resolved}: ${err.message}`);
        }
    });
}

// Wrapper to keep existing SQLite-style code working with Postgres
const db = {
    all: (sql, params, cb) => {
        if (typeof params === 'function') { cb = params; params = []; }
        let count = 0;
        const pgSql = sql.replace(/\?/g, () => `$${++count}`);
        pool.query(pgSql, params, (err, res) => cb(err, res ? res.rows : null));
    },
    get: (sql, params, cb) => {
        if (typeof params === 'function') { cb = params; params = []; }
        let count = 0;
        const pgSql = sql.replace(/\?/g, () => `$${++count}`);
        pool.query(pgSql, params, (err, res) => cb(err, res ? res.rows[0] : null));
    },
    run: (sql, params, cb) => {
        if (typeof params === 'function') { cb = params; params = []; }
        let count = 0;
        let pgSql = sql.replace(/\?/g, () => `$${++count}`);
        
        // Handle lastID for Postgres (return ID on inserts)
        if (pgSql.trim().toUpperCase().startsWith('INSERT')) {
            pgSql += ' RETURNING id';
        }

        pool.query(pgSql, params, (err, res) => {
            const context = { 
                lastID: res && res.rows[0] && res.rows[0].id ? res.rows[0].id : null,
                changes: res ? res.rowCount : 0 
            };
            if (cb) cb.call(context, err);
        });
    }
};

// --- STORAGE CONFIG ---
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

const storage = multer.diskStorage(createTempMulterStorage(UPLOADS_DIR));

const upload = multer({
    storage,
    limits: {
        fileSize: MAX_UPLOAD_SIZE_BYTES,
        files: 8,
    },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
        if (!allowed.includes(file.mimetype)) {
            return cb(new Error(`Unsupported file type: ${file.mimetype}`));
        }
        cb(null, true);
    }
});

// --- AUDIT SYSTEM ---
const AUDIT_LOG = path.join(__dirname, 'audit_log.txt');
const auditStream = fs.createWriteStream(AUDIT_LOG, { flags: 'a' });
function logAudit(msg) {
    const entry = `[${new Date().toISOString()}] ${msg}\n`;
    auditStream.write(entry);
    console.log(msg);
}

// Health check endpoint for monitoring tools
app.get('/health', async (req, res) => {
    let dbStatus = dbReady ? 'UP' : 'DOWN';
    try {
        await pool.query('SELECT 1');
    } catch (err) {
        dbStatus = 'DOWN';
    }

    res.status(dbStatus === 'UP' && dbReady ? 200 : 503).json({
        status: dbStatus === 'UP' && dbReady ? 'UP' : 'DEGRADED',
        database: dbStatus,
        ready: dbReady,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        error: dbReady ? null : databaseInitError
    });
});

app.use((req, res, next) => {
    logAudit(`${req.method} ${req.url} - Waiting...`);
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        logAudit(`${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`);
    });
    next();
});

// --- AUTH MIDDLEWARE ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = (authHeader && authHeader.split(' ')[1]) || cleanString(req.query.token);

    if (!token) return res.status(401).json({ error: 'Authentication required' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Session expired or invalid' });
        req.user = user;
        next();
    });
};

const authenticateTransporter = (req, res, next) => {
    authenticateToken(req, res, () => {
        if (req.user?.role === 'driver') {
            return res.status(403).json({ error: 'Transporter access required' });
        }
        next();
    });
};

function getOptionalAuthUser(req) {
    const authHeader = req.headers['authorization'];
    const token = (authHeader && authHeader.split(' ')[1]) || cleanString(req.query.token);
    if (!token) return null;
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (err) {
        return null;
    }
}

app.use('/uploads', authenticateTransporter, express.static(UPLOADS_DIR));

const DASHBOARD_DIR = path.join(__dirname, '..', 'Dashboard');
const APP_DIR = path.join(__dirname, '..', 'APP');
const DRIVER_APP_DIR = path.join(__dirname, '..', 'Driver app');
app.get(['/config.js', '/app/config.js', '/driver/config.js'], (req, res) => {
    const baseUrl = getPublicBaseUrl(req);
    const appBase = `${baseUrl}/app`;
    const driverBase = `${baseUrl}/driver`;
    const mapsApiKey = cleanString(process.env.GOOGLE_MAPS_API_KEY) || cleanString(process.env.GEMINI_API_KEY) || '';

    res.type('application/javascript').send(
        [
            `window.FLEETOS_API_BASE = ${JSON.stringify(baseUrl)};`,
            `window.FLEETOS_APP_BASE = ${JSON.stringify(appBase)};`,
            `window.FLEETOS_DRIVER_BASE = ${JSON.stringify(driverBase)};`,
            `window.FLEETOS_MAPS_API_KEY = ${JSON.stringify(mapsApiKey)};`,
        ].join('\n')
    );
});
app.use(express.static(DASHBOARD_DIR));
app.use('/app', express.static(APP_DIR));
app.use('/driver', express.static(DRIVER_APP_DIR));
app.get('/api/download/:filename', authenticateTransporter, (req, res) => {
    let filename = path.basename(req.params.filename);
    let filePath = path.resolve(UPLOADS_DIR, filename);
    const customName = sanitizeDownloadName(req.query.name, filename);
    
    logAudit(`DOWNLOAD REQUEST: filename=${filename}, customName=${customName}`);
    
    // SMART MATCH FALLBACK
    if (!fs.existsSync(filePath)) {
        console.log(`[Smart Match] File not found: ${filename}. Searching for variants...`);
        const files = fs.readdirSync(UPLOADS_DIR);
        // Try matching by base name without extension
        const base = filename.split('.')[0];
        const match = files.find(f => f.startsWith(base) || (customName && f.includes(decodeURIComponent(customName).split('_')[0])));
        
        if (match) {
            console.log(`[Smart Match] Found alternative: ${match}`);
            filename = match;
            filePath = path.resolve(UPLOADS_DIR, filename);
        }
    }

    if (fs.existsSync(filePath)) {
        let downloadName = customName || filename;
        const ext = path.extname(filename);
        if (ext && !downloadName.toLowerCase().endsWith(ext.toLowerCase())) {
            downloadName += ext;
        }

        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(downloadName)}"`);
        res.setHeader('Content-Type', getMimeType(filename));
        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
    } else {
        logAudit(`DOWNLOAD FAILED: File missing at: ${filePath}`);
        res.status(404).send('File not found in system records');
    }
});

function getMimeType(fn) {
    const ext = path.extname(fn).toLowerCase();
    if (ext === '.pdf') return 'application/pdf';
    return 'image/jpeg';
}

// --- SERVER CONFIG ---
const IS_PRODUCTION = !!process.env.RAILWAY_STATIC_URL || !!process.env.PORT;

app.get('/', (req, res) => {
    if (IS_PRODUCTION) {
        return res.status(200).json({ status: "online", service: "FleetOS Pro API", region: "Cloud" });
    }
    res.sendFile(path.join(DASHBOARD_DIR, 'Index - Landing Page.html'));
});

// health-check
app.get('/health', (req, res) => res.json({ status: "healthy" }));

// Database Initialization
async function initializeDatabase() {
    try {
        dbReady = false;
        databaseInitError = null;

        await pool.query(`CREATE TABLE IF NOT EXISTS trucks (
            id SERIAL PRIMARY KEY,
            reg_no TEXT UNIQUE NOT NULL,
            chassis_no TEXT,
            engine_no TEXT,
            truck_type TEXT,
            make TEXT,
            model TEXT,
            owner_name TEXT,
            year INTEGER,
            fuel_type TEXT,
            displacement INTEGER,
            hp INTEGER,
            tank_capacity INTEGER,
            payload REAL,
            gvw INTEGER,
            axle_config TEXT,
            tyres_count INTEGER,
            status TEXT,
            driver_assigned TEXT,
            odometer INTEGER,
            purchase_date TEXT,
            purchase_price REAL,
            gps_id TEXT,
            insurance_provider TEXT,
            policy_no TEXT,
            ins_start_date TEXT,
            ins_expiry_date TEXT,
            ins_value REAL,
            coverage_type TEXT,
            fitness_cert_no TEXT,
            fitness_expiry_date TEXT,
            puc_cert_no TEXT,
            puc_expiry_date TEXT,
            permit_no TEXT,
            permit_expiry_date TEXT,
            road_tax_paid_date TEXT,
            road_tax_expiry_date TEXT,
            road_tax_amount REAL,
            doc_rc_path TEXT,
            doc_insurance_path TEXT,
            doc_fitness_path TEXT,
            doc_puc_path TEXT,
            doc_permit_path TEXT,
            doc_roadtax_path TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS drivers (
            id SERIAL PRIMARY KEY,
            full_name TEXT NOT NULL,
            dob TEXT,
            blood_group TEXT,
            phone TEXT UNIQUE NOT NULL,
            emergency_phone TEXT,
            join_date TEXT,
            status TEXT,
            emp_type TEXT,
            assigned_truck TEXT,
            salary REAL,
            pay_freq TEXT,
            address TEXT,
            city TEXT,
            state TEXT,
            pin TEXT,
            dl_no TEXT UNIQUE,
            dl_issue TEXT,
            dl_expiry TEXT,
            rto TEXT,
            dl_state TEXT,
            license_type TEXT,
            vehicle_category TEXT,
            hazmat TEXT,
            experience INTEGER,
            aadhar TEXT,
            pan TEXT,
            doc_dl_path TEXT,
            doc_aadhar_path TEXT,
            doc_pan_path TEXT,
            doc_photo_path TEXT,
            temp_password TEXT,
            password TEXT,
            last_lat REAL,
            last_lng REAL,
            last_ping TEXT,
            location_enabled INTEGER DEFAULT 1,
            location_alert TEXT,
            is_onboarded INTEGER DEFAULT 0,
            transporter_id INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS trips (
            id TEXT PRIMARY KEY,
            inv_id TEXT,
            truck_text TEXT,
            driver_text TEXT,
            origin TEXT,
            destination TEXT,
            start_date TEXT,
            start_date_raw TEXT,
            end_date TEXT,
            end_date_raw TEXT,
            auto_end_date_raw TEXT,
            freight REAL,
            advance REAL,
            balance REAL,
            client TEXT,
            lr_no TEXT,
            notes TEXT,
            bhatta REAL DEFAULT 0,
            status TEXT DEFAULT 'Active',
            is_paid INTEGER DEFAULT 0,
            payment_date TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            full_name TEXT NOT NULL,
            company_name TEXT,
            mobile TEXT UNIQUE,
            email TEXT UNIQUE,
            password TEXT NOT NULL,
            role TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS expenses (
            id SERIAL PRIMARY KEY,
            merchant TEXT,
            category TEXT,
            amount REAL,
            total REAL,
            date TEXT,
            issued_at TEXT,
            status TEXT DEFAULT 'Pending',
            driver_id TEXT,
            truck_id TEXT,
            notes TEXT,
            metadata JSONB,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS ocr_scans (
            id SERIAL PRIMARY KEY,
            doc_type TEXT,
            reg_no TEXT,
            owner_name TEXT,
            raw_data JSONB,
            status TEXT,
            error_msg TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        const migrations = [
            `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS chassis_no TEXT`,
            `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS engine_no TEXT`,
            `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS truck_type TEXT`,
            `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS make TEXT`,
            `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS model TEXT`,
            `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS owner_name TEXT`,
            `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS year INTEGER`,
            `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS fuel_type TEXT`,
            `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS displacement INTEGER`,
            `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS hp INTEGER`,
            `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS tank_capacity INTEGER`,
            `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS payload REAL`,
            `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS gvw INTEGER`,
            `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS axle_config TEXT`,
            `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS tyres_count INTEGER`,
            `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS status TEXT`,
            `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS driver_assigned TEXT`,
            `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS odometer INTEGER`,
            `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS purchase_date TEXT`,
            `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS purchase_price REAL`,
            `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS gps_id TEXT`,
            `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS insurance_provider TEXT`,
            `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS policy_no TEXT`,
            `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS ins_start_date TEXT`,
            `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS ins_expiry_date TEXT`,
            `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS ins_value REAL`,
            `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS coverage_type TEXT`,
            `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS fitness_cert_no TEXT`,
            `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS fitness_expiry_date TEXT`,
            `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS puc_cert_no TEXT`,
            `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS puc_expiry_date TEXT`,
            `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS permit_no TEXT`,
            `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS permit_expiry_date TEXT`,
            `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS road_tax_paid_date TEXT`,
            `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS road_tax_expiry_date TEXT`,
            `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS road_tax_amount REAL`,
            `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS doc_rc_path TEXT`,
            `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS doc_insurance_path TEXT`,
            `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS doc_fitness_path TEXT`,
            `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS doc_puc_path TEXT`,
            `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS doc_permit_path TEXT`,
            `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS doc_roadtax_path TEXT`,
            `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
            `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS dob TEXT`,
            `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS blood_group TEXT`,
            `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS emergency_phone TEXT`,
            `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS join_date TEXT`,
            `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS status TEXT`,
            `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS emp_type TEXT`,
            `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS assigned_truck TEXT`,
            `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS salary REAL`,
            `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS pay_freq TEXT`,
            `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS address TEXT`,
            `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS city TEXT`,
            `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS state TEXT`,
            `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS pin TEXT`,
            `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS dl_no TEXT`,
            `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS dl_issue TEXT`,
            `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS dl_expiry TEXT`,
            `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS rto TEXT`,
            `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS dl_state TEXT`,
            `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS license_type TEXT`,
            `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS vehicle_category TEXT`,
            `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS hazmat TEXT`,
            `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS experience INTEGER`,
            `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS aadhar TEXT`,
            `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS pan TEXT`,
            `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS doc_dl_path TEXT`,
            `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS doc_aadhar_path TEXT`,
            `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS doc_pan_path TEXT`,
            `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS doc_photo_path TEXT`,
            `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS temp_password TEXT`,
            `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS password TEXT`,
            `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS last_lat REAL`,
            `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS last_lng REAL`,
            `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS last_ping TEXT`,
            `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS location_enabled INTEGER DEFAULT 1`,
            `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS location_alert TEXT`,
            `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS is_onboarded INTEGER DEFAULT 0`,
            `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS transporter_id INTEGER`,
            `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
            `ALTER TABLE trips ADD COLUMN IF NOT EXISTS inv_id TEXT`,
            `ALTER TABLE trips ADD COLUMN IF NOT EXISTS truck_text TEXT`,
            `ALTER TABLE trips ADD COLUMN IF NOT EXISTS driver_text TEXT`,
            `ALTER TABLE trips ADD COLUMN IF NOT EXISTS origin TEXT`,
            `ALTER TABLE trips ADD COLUMN IF NOT EXISTS destination TEXT`,
            `ALTER TABLE trips ADD COLUMN IF NOT EXISTS start_date TEXT`,
            `ALTER TABLE trips ADD COLUMN IF NOT EXISTS start_date_raw TEXT`,
            `ALTER TABLE trips ADD COLUMN IF NOT EXISTS end_date TEXT`,
            `ALTER TABLE trips ADD COLUMN IF NOT EXISTS end_date_raw TEXT`,
            `ALTER TABLE trips ADD COLUMN IF NOT EXISTS auto_end_date_raw TEXT`,
            `ALTER TABLE trips ADD COLUMN IF NOT EXISTS freight REAL`,
            `ALTER TABLE trips ADD COLUMN IF NOT EXISTS advance REAL`,
            `ALTER TABLE trips ADD COLUMN IF NOT EXISTS balance REAL`,
            `ALTER TABLE trips ADD COLUMN IF NOT EXISTS client TEXT`,
            `ALTER TABLE trips ADD COLUMN IF NOT EXISTS lr_no TEXT`,
        `ALTER TABLE trips ADD COLUMN IF NOT EXISTS notes TEXT`,
        `ALTER TABLE trips ADD COLUMN IF NOT EXISTS bhatta REAL DEFAULT 0`,
        `ALTER TABLE trips ADD COLUMN IF NOT EXISTS distance_km REAL DEFAULT 0`,
        `ALTER TABLE trips ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Active'`,
            `ALTER TABLE trips ADD COLUMN IF NOT EXISTS is_paid INTEGER DEFAULT 0`,
            `ALTER TABLE trips ADD COLUMN IF NOT EXISTS payment_date TEXT`,
            `ALTER TABLE trips ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS company_name TEXT`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS mobile TEXT`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS password TEXT`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
            `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS type TEXT`,
            `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS amount REAL`,
            `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS trip_id TEXT`,
            `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS notes TEXT`,
            `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS date TEXT`,
            `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Pending'`,
            `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS place TEXT`,
            `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS route_from TEXT`,
            `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS route_to TEXT`,
            `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS driver_name TEXT`,
            `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS bill_image_data TEXT`,
            `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS reviewed_at TEXT`,
            `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS reviewed_by TEXT`,
            `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS rejection_reason TEXT`,
            `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS source TEXT`,
            `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
            `ALTER TABLE ocr_scans ADD COLUMN IF NOT EXISTS doc_type TEXT`,
            `ALTER TABLE ocr_scans ADD COLUMN IF NOT EXISTS reg_no TEXT`,
            `ALTER TABLE ocr_scans ADD COLUMN IF NOT EXISTS owner_name TEXT`,
            `ALTER TABLE ocr_scans ADD COLUMN IF NOT EXISTS raw_data JSONB`,
            `ALTER TABLE ocr_scans ADD COLUMN IF NOT EXISTS status TEXT`,
            `ALTER TABLE ocr_scans ADD COLUMN IF NOT EXISTS error_msg TEXT`,
            `ALTER TABLE ocr_scans ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
            `CREATE INDEX IF NOT EXISTS idx_trucks_created_at ON trucks (created_at DESC)`,
            `CREATE INDEX IF NOT EXISTS idx_drivers_created_at ON drivers (created_at DESC)`,
            `CREATE INDEX IF NOT EXISTS idx_trips_created_at ON trips (created_at DESC)`,
            `CREATE INDEX IF NOT EXISTS idx_expenses_trip_id ON expenses (trip_id)`,
            `CREATE INDEX IF NOT EXISTS idx_expenses_created_at ON expenses (created_at DESC)`,
            `CREATE INDEX IF NOT EXISTS idx_ocr_scans_created_at ON ocr_scans (created_at DESC)`,
        ];

        for (const statement of migrations) {
            await pool.query(statement);
        }

        await ensureDocumentTables(pool);
        
        console.log('✅ Postgres Database Initialized & Synced.');

        dbReady = true;
    } catch (err) {
        databaseInitError = err.message;
        console.error('❌ Database Initialization Error:', err.message);
        throw err;
    }
}

// --- HELPER: EXCEL EXPORT ---
async function generateFleetExcel() {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Fleet Register');

    sheet.columns = [
        { header: 'ID', key: 'id', width: 5 },
        { header: 'Reg No', key: 'reg_no', width: 15 },
        { header: 'Owner', key: 'owner_name', width: 20 },
        { header: 'Chassis', key: 'chassis_no', width: 20 },
        { header: 'Make', key: 'make', width: 15 },
        { header: 'Model', key: 'model', width: 15 },
        { header: 'Fuel', key: 'fuel_type', width: 10 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Expiry: Ins', key: 'ins_expiry_date', width: 15 },
        { header: 'Expiry: Fitness', key: 'fitness_expiry_date', width: 15 },
        { header: 'Created At', key: 'created_at', width: 20 }
    ];

    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM trucks ORDER BY created_at DESC', (err, rows) => {
            if (err) return reject(err);
            rows.forEach(r => sheet.addRow(r));
            sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
            sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A5C3A' } };
            resolve(workbook);
        });
    });
}

async function generateDriversExcel() {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Driver Register');

    sheet.columns = [
        { header: 'ID', key: 'id', width: 5 },
        { header: 'Name', key: 'full_name', width: 25 },
        { header: 'Phone', key: 'phone', width: 15 },
        { header: 'DL Number', key: 'dl_no', width: 20 },
        { header: 'DL Expiry', key: 'dl_expiry', width: 15 },
        { header: 'Aadhaar', key: 'aadhar', width: 20 },
        { header: 'PAN', key: 'pan', width: 15 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Join Date', key: 'join_date', width: 15 },
        { header: 'Created At', key: 'created_at', width: 20 }
    ];

    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM drivers ORDER BY created_at DESC', (err, rows) => {
            if (err) return reject(err);
            rows.forEach(r => sheet.addRow(r));
            sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
            sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A5C3A' } };
            resolve(workbook);
        });
    });
}

// --- AUTH API (ENHANCED) ---
app.post('/api/auth/signup', async (req, res) => {
    try {
        console.log('📝 SIGNUP ATTEMPT:', req.body.mobile);
        const fullName = (req.body.fullName || "").toString().trim();
        const companyName = (req.body.companyName || "").toString().trim();
        const mobile = (req.body.mobile || "").toString().trim();
        const email = (req.body.email || "").toString().trim().toLowerCase() || null;
        const password = String(req.body.password || '');
        const role = (req.body.role || "").toString().trim();
        
        if (!fullName || (!email && !mobile) || password.length < 8 || !role) {
            return res.status(400).json({ error: 'Full registration details (Name, Login ID, 8+ Char Password) are required' });
        }

        const hashedPassword = hashPassword(password);
        const result = await pool.query(
            `INSERT INTO users (full_name, company_name, mobile, email, password, role) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [fullName, companyName, mobile, email, hashedPassword, role]
        );
        
        const userId = result.rows[0].id;
        const token = jwt.sign({ id: userId, role }, JWT_SECRET, { expiresIn: '7d' });

        res.status(201).json({ 
            message: 'Account created successfully', 
            token,
            user: { id: userId, fullName, role, companyName } 
        });
    } catch (err) {
        let msg = err.message;
        if (msg.includes('unique')) {
            msg = msg.toLowerCase().includes('email') ? 'Email already registered' : 'Mobile number already registered';
        }
        res.status(400).json({ error: msg });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        console.log('📬 LOGIN ATTEMPT:', req.body.identifier);
        const identifier = (req.body.identifier || req.body.email || req.body.mobile || "").toString().trim();
        const password = req.body.password;
        
        if (!identifier || !password) return res.status(400).json({ error: 'Identifier and password required' });
        
        const sql = `SELECT * FROM users WHERE LOWER(email) = $1 OR mobile = $2 LIMIT 1`;
        const results = await pool.query(sql, [identifier.toLowerCase(), identifier]);
        const user = results.rows[0];

        if (!user || !verifyPassword(String(password), user.password)) {
            console.log('🚫 REJECTED: Invalid credentials');
            return res.status(401).json({ error: 'Invalid credentials. Please check your login ID and password.' });
        }

        // Token generation
        const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
        console.log('✅ LOGIN SUCCESS:', user.mobile);

        return res.json({ 
            message: 'Login successful', 
            token,
            user: { 
                id: user.id, 
                fullName: user.full_name, 
                companyName: user.company_name, 
                role: user.role,
                email: user.email,
                mobile: user.mobile
            } 
        });
    } catch (err) {
        console.error('🔥 CRITICAL LOGIN ERROR:', err.message);
        return res.status(500).json({ error: 'A server error occurred during login.' });
    }
});

// --- PROTECTED ROUTES ---
// Apply auth middleware to all sensitive API groups
// Exclude trip-related endpoints from mandatory auth for the driver app's reactive modals
app.use(['/api/drivers', '/api/dashboard', '/api/export'], authenticateTransporter);
app.use('/api/fleet', authenticateTransporter);
app.use('/api/expenses', authenticateTransporter);

registerDocumentWorkflow({
    app,
    pool,
    upload,
    authenticateTransporter,
    UPLOADS_DIR,
    parseDocumentWithGemini,
    tryLocalGravityOcr,
    tryTesseractDocumentOcr
});


// --- TRIPS API ---
app.post('/api/fleet/trips', async (req, res) => {
    const id = cleanString(req.body.id);
    const invId = cleanString(req.body.invId);
    const truckText = cleanString(req.body.truckText);
    const driverText = cleanString(req.body.driverText);
    const origin = cleanString(req.body.origin);
    const destination = cleanString(req.body.destination);
    const startDate = cleanString(req.body.startDate);
    const startDateRaw = cleanString(req.body.startDateRaw);
    const endDate = cleanString(req.body.endDate);
    const endDateRaw = cleanString(req.body.endDateRaw);
    const autoEndDateRaw = cleanString(req.body.autoEndDateRaw);
    const freight = toNumberOrNull(req.body.freight);
    const advance = toNumberOrNull(req.body.advance) || 0;
    const balance = toNumberOrNull(req.body.balance);
    const distanceKm = toNumberOrNull(req.body.distanceKm) || 0;
    const client = cleanString(req.body.client);
    const lrNo = cleanString(req.body.lrNo);
    const notes = cleanString(req.body.notes);
        const status = cleanString(req.body.status) || 'Upcoming';
    const bhatta = toNumberOrNull(req.body.bhatta) || 0;
    const expenses = Array.isArray(req.body.expenses) ? req.body.expenses : [];

    if (!id || !truckText || !driverText || !origin || !destination || freight === null) {
        return res.status(400).json({ error: 'Trip ID, truck, driver, origin, destination and freight are required' });
    }

    const clientConn = await pool.connect();
    try {
        await clientConn.query('BEGIN');
        await clientConn.query(
            `INSERT INTO trips (id, inv_id, truck_text, driver_text, origin, destination, start_date, start_date_raw, end_date, end_date_raw, auto_end_date_raw, freight, advance, balance, client, lr_no, notes, status, bhatta, distance_km)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
            [id, invId, truckText, driverText, origin, destination, startDate, startDateRaw, endDate, endDateRaw, autoEndDateRaw, freight, advance, balance, client, lrNo, notes, status, bhatta, distanceKm]
        );

        for (const expense of expenses) {
            const rawType = cleanString(expense.type);
            const amount = toNumberOrNull(expense.amount);
            if (!rawType || amount === null || amount < 0) continue;
            const type = classifyExpenseCategory(rawType, expense.notes);

            await clientConn.query(
                `INSERT INTO expenses (type, category, amount, total, trip_id, notes, date) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                    type,
                    type,
                    amount,
                    Math.round(Number(amount) * 100),
                    id,
                    cleanString(expense.notes),
                    cleanString(expense.date) || new Date().toISOString().split('T')[0]
                ]
            );
        }

        await clientConn.query('COMMIT');
        res.status(201).json({ message: 'Trip logged successfully', id });
    } catch (err) {
        await clientConn.query('ROLLBACK');
        const statusCode = err.code === '23505' ? 409 : 500;
        res.status(statusCode).json({ error: err.code === '23505' ? 'Trip ID already exists' : err.message });
    } finally {
        clientConn.release();
    }
});

app.get('/api/fleet/trips', async (req, res) => {
    const sql = `
        SELECT 
            t.*, 
            d.phone as driver_phone,
            tr.purchase_price as truck_purchase_price,
            tr.tyres_count as truck_tyres_count,
            COALESCE((SELECT SUM(amount) FROM expenses WHERE trip_id = t.id AND COALESCE(status, 'In Process') != 'Rejected'), 0) as total_expenses
        FROM trips t
        LEFT JOIN drivers d ON t.driver_text = d.full_name
        LEFT JOIN trucks tr ON t.truck_text = tr.reg_no
        ORDER BY t.created_at DESC
    `;
    try {
        const result = await pool.query(sql);
        const trips = result.rows.map(r => ({
            id: r.id, 
            invId: r.inv_id, 
            truckText: r.truck_text, 
            driverText: r.driver_text, 
            driverPhone: r.driver_phone || '9999999999',
            origin: r.origin, 
            destination: r.destination,
            startDate: r.start_date, 
            startDateRaw: r.start_date_raw, 
            endDate: r.end_date, 
            endDateRaw: r.end_date_raw,
            autoEndDateRaw: r.auto_end_date_raw,
            freight: r.freight, 
            advance: r.advance, 
            balance: r.balance, 
            client: r.client, 
            lrNo: r.lr_no,
            notes: r.notes,
            status: r.status, 
            totalExpenses: r.total_expenses,
            bhatta: r.bhatta || 0,
            distanceKm: r.distance_km || 0,
            truckPurchasePrice: r.truck_purchase_price || 0,
            truckTyresCount: r.truck_tyres_count || 0,
            isPaid: r.is_paid === true || Number(r.is_paid) === 1, 
            paymentDate: r.payment_date
        }));
        res.json(trips);
    } catch (err) {
        res.status(500).json({ error: 'Fetch failed: ' + err.message });
    }
});

app.put('/api/fleet/trips/:id', async (req, res) => {
    const { status, isPaid, paymentDate, endDate, endDateRaw } = req.body;
    let updates = [], params = [];
    let idx = 1;
    if (status !== undefined) { updates.push(`status = $${idx++}`); params.push(status); }
    if (isPaid !== undefined) { updates.push(`is_paid = $${idx++}`); params.push(isPaid ? 1 : 0); }
    if (paymentDate !== undefined) { updates.push(`payment_date = $${idx++}`); params.push(paymentDate); }
    if (endDate !== undefined) { updates.push(`end_date = $${idx++}`); params.push(endDate); }
    if (endDateRaw !== undefined) { updates.push(`end_date_raw = $${idx++}`); params.push(endDateRaw); }
    if (!updates.length) {
        return res.status(400).json({ error: 'No trip fields provided for update' });
    }
    params.push(req.params.id);
    try {
        await pool.query(`UPDATE trips SET ${updates.join(', ')} WHERE id = $${idx}`, params);
        res.json({ message: 'Trip updated' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/fleet/trips/:id/expenses', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT *
             FROM expenses
             WHERE trip_id = $1
               AND COALESCE(status, 'In Process') != 'Rejected'
             ORDER BY created_at ASC`,
            [req.params.id]
        );
        res.json(result.rows.map(serializeExpenseRow));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- EXPENSES API ---
app.post('/api/expenses', async (req, res) => {
    const { type, amount, tripId, notes, date } = req.body;
    if (!cleanString(type) || !cleanString(tripId) || toNumberOrNull(amount) === null) {
        return res.status(400).json({ error: 'Expense type, amount and trip ID are required' });
    }
    try {
        const tripRes = await pool.query('SELECT id, origin, destination, driver_text FROM trips WHERE id = $1 LIMIT 1', [tripId]);
        const trip = tripRes.rows[0];
        if (!trip) {
            return res.status(404).json({ error: 'Trip not found' });
        }

        const canonicalType = classifyExpenseCategory(type, notes);
        const result = await pool.query(
            `INSERT INTO expenses (type, category, amount, total, trip_id, notes, date, status, route_from, route_to, driver_name, source)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'Approved', $8, $9, $10, 'transporter')
             RETURNING id`,
            [canonicalType, canonicalType, amount, Math.round(Number(amount) * 100), tripId, notes, date || new Date().toISOString().split('T')[0], trip.origin, trip.destination, trip.driver_text]
        );
        res.status(201).json({ id: result.rows[0].id, message: 'Expense logged' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/expenses', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM expenses ORDER BY created_at DESC');
        res.json(result.rows.map(serializeExpenseRow));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/expenses/:id', async (req, res) => {
    const { type, amount, notes, date } = req.body;
    if (!cleanString(type) || toNumberOrNull(amount) === null) {
        return res.status(400).json({ error: 'Expense type and amount are required' });
    }
    try {
        const canonicalType = classifyExpenseCategory(type, notes);
        await pool.query(
            `UPDATE expenses SET type = $1, category = $2, amount = $3, total = $4, notes = $5, date = $6 WHERE id = $7`,
            [canonicalType, canonicalType, amount, Math.round(Number(amount) * 100), notes || '', date, req.params.id]
        );
        res.json({ message: 'Expense updated' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/expenses/:id/status', async (req, res) => {
    const status = cleanString(req.body.status);
    const rejectionReason = cleanString(req.body.rejectionReason);
    const reviewer = cleanString(req.body.reviewedBy || req.user?.id);

    if (!['Approved', 'Rejected', 'In Process'].includes(status)) {
        return res.status(400).json({ error: 'Valid expense status is required' });
    }

    try {
        await pool.query(
            `UPDATE expenses
             SET status = $1,
                 rejection_reason = $2,
                 reviewed_at = $3,
                 reviewed_by = $4
             WHERE id = $5`,
            [status, status === 'Rejected' ? rejectionReason : null, new Date().toISOString(), reviewer, req.params.id]
        );
        res.json({ message: 'Expense status updated' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/expenses/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM expenses WHERE id = $1', [req.params.id]);
        res.json({ message: 'Expense deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- FLEET API ---
app.get('/api/fleet', (req, res) => {
    db.all('SELECT * FROM trucks ORDER BY created_at DESC', (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/fleet/:id', (req, res) => {
    db.get('SELECT * FROM trucks WHERE id = ?', [req.params.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Truck not found' });
        res.json(row);
    });
});

app.post('/api/fleet', upload.fields([{ name: 'file_rc' }, { name: 'file_insurance' }, { name: 'file_fitness' }, { name: 'file_puc' }, { name: 'file_permit' }, { name: 'file_roadtax' }]), (req, res) => {
    const d = req.body;
    const f = req.files || {};
    const getPath = (k) => f[k] ? `/uploads/${f[k][0].filename}` : null;

    const cols = ['reg_no', 'chassis_no', 'engine_no', 'truck_type', 'make', 'model', 'owner_name', 'year', 'fuel_type', 'gvw', 'axle_config', 'tyres_count', 'status', 'driver_assigned', 'odometer', 'purchase_date', 'purchase_price', 'insurance_provider', 'policy_no', 'ins_start_date', 'ins_expiry_date', 'ins_value', 'coverage_type', 'fitness_cert_no', 'fitness_expiry_date', 'puc_cert_no', 'puc_expiry_date', 'permit_no', 'permit_expiry_date', 'road_tax_paid_date', 'road_tax_expiry_date', 'road_tax_amount', 'doc_rc_path', 'doc_insurance_path', 'doc_fitness_path', 'doc_puc_path', 'doc_permit_path', 'doc_roadtax_path'];
    const p = [d.regNo, d.chassis, d.engine, d.truckType, d.make, d.model, d.ownerName, d.year || null, d.fuel, d.gvw || 0, d.axle, d.tyres || 0, d.status, d.driver, d.odometer || 0, d.purchaseDate, d.price || 0, d.insurer, d.policyNo, d.insStartDate, d.insExpiry, d.insValue || 0, d.coverage, d.fitnessCertNo, d.fitnessExpiry, d.pucCertNo, d.pucExpiry, d.permitNo, d.permitExpiry, d.taxPaidDate, d.taxExpiry, d.taxAmount || 0, getPath('file_rc'), getPath('file_insurance'), getPath('file_fitness'), getPath('file_puc'), getPath('file_permit'), getPath('file_roadtax')];

    db.run(`INSERT INTO trucks (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, p, function(err) {
        if (err) return res.status(400).json({ error: err.message.includes('unique') ? 'Truck exists' : err.message });
        res.json({ id: this.lastID, message: 'Success' });
    });
});

app.put('/api/fleet/:id', upload.fields([{ name: 'file_rc' }, { name: 'file_insurance' }, { name: 'file_fitness' }, { name: 'file_puc' }, { name: 'file_permit' }, { name: 'file_roadtax' }]), (req, res) => {
    const d = req.body;
    const f = req.files || {};
    const getPath = (k) => f[k] ? `/uploads/${f[k][0].filename}` : null;

    db.get('SELECT * FROM trucks WHERE id = ?', [req.params.id], (findErr, existing) => {
        if (findErr) return res.status(500).json({ error: findErr.message });
        if (!existing) return res.status(404).json({ error: 'Truck not found' });

        const sql = `UPDATE trucks SET reg_no=?, chassis_no=?, engine_no=?, owner_name=?, make=?, model=?, year=?, fuel_type=?, gvw=?, axle_config=?, tyres_count=?, status=?, driver_assigned=?, odometer=?, purchase_date=?, purchase_price=?, insurance_provider=?, policy_no=?, ins_start_date=?, ins_expiry_date=?, ins_value=?, coverage_type=?, fitness_cert_no=?, fitness_expiry_date=?, puc_cert_no=?, puc_expiry_date=?, permit_no=?, permit_expiry_date=?, road_tax_paid_date=?, road_tax_expiry_date=?, road_tax_amount=?, truck_type=?, doc_rc_path=?, doc_insurance_path=?, doc_fitness_path=?, doc_puc_path=?, doc_permit_path=?, doc_roadtax_path=? WHERE id=?`;
        const p = [
            d.regNo,
            d.chassis,
            d.engine,
            d.ownerName,
            d.make,
            d.model,
            d.year,
            d.fuel,
            d.gvw,
            d.axle,
            d.tyres,
            d.status,
            d.driver,
            d.odometer,
            d.purchaseDate,
            d.price,
            d.insurer,
            d.policyNo,
            d.insStartDate,
            d.insExpiry,
            d.insValue,
            d.coverage,
            d.fitnessCertNo,
            d.fitnessExpiry,
            d.pucCertNo,
            d.pucExpiry,
            d.permitNo,
            d.permitExpiry,
            d.taxPaidDate,
            d.taxExpiry,
            d.taxAmount,
            d.truckType,
            getPath('file_rc') || existing.doc_rc_path,
            getPath('file_insurance') || existing.doc_insurance_path,
            getPath('file_fitness') || existing.doc_fitness_path,
            getPath('file_puc') || existing.doc_puc_path,
            getPath('file_permit') || existing.doc_permit_path,
            getPath('file_roadtax') || existing.doc_roadtax_path,
            req.params.id
        ];
        db.run(sql, p, (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Updated' });
        });
    });
});

app.delete('/api/fleet/:id', async (req, res) => {
    try {
        // Absolute Deletion: Purge from registry and AI audit trails
        const truck = await new Promise((resolve, reject) => {
            db.get('SELECT reg_no FROM trucks WHERE id = ?', [req.params.id], (err, row) => err ? reject(err) : resolve(row));
        });

        if (!truck) {
            return res.status(404).json({ error: 'Truck not found' });
        }

        const linkedTrip = await pool.query(
            `SELECT id, status, origin, destination
             FROM trips
             WHERE truck_text = $1
               AND status IN ('Upcoming', 'Active', 'En Route')
             ORDER BY start_date_raw ASC NULLS LAST
             LIMIT 1`,
            [truck.reg_no]
        );
        if (linkedTrip.rows.length > 0) {
            const trip = linkedTrip.rows[0];
            return res.status(409).json({
                error: `Cannot delete this truck because it is linked to trip ${trip.id} (${trip.status}) from ${trip.origin} to ${trip.destination}. Remove or complete that trip first.`,
                code: 'TRUCK_ON_TRIP',
                tripId: trip.id,
                tripStatus: trip.status
            });
        }

        if (truck && truck.reg_no) {
            await new Promise((resolve, reject) => {
                db.run('DELETE FROM ocr_scans WHERE reg_no = ?', [truck.reg_no], (err) => err ? reject(err) : resolve());
            });
        }

        await new Promise((resolve, reject) => {
            db.run('DELETE FROM trucks WHERE id = ?', [req.params.id], (err) => err ? reject(err) : resolve());
        });

        res.json({ message: 'Deleted entirely from records' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- DRIVERS API ---
app.get('/api/drivers', (req, res) => {
    db.all('SELECT * FROM drivers ORDER BY created_at DESC', (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows.map((row) => sanitizeDriverRow(row, { includeTransporterOtp: true })));
    });
});

app.post('/api/drivers', upload.fields([{ name: 'file_dl' }, { name: 'file_aadhar' }, { name: 'file_pan' }, { name: 'file_photo' }]), async (req, res) => {
    const d = req.body;
    const f = req.files || {};
    const getPath = (k) => f[k] ? `/uploads/${f[k][0].filename}` : null;

    const phone = normalizePhone(d.phone);
    const dlNo = cleanString(d.dlNo);
    const pan = cleanString(d.pan);

    if (phone.length !== 10) {
        return res.status(400).json({ error: 'A valid 10-digit mobile number is compulsory for driver registration' });
    }
    if (!dlNo) {
        return res.status(400).json({ error: 'Driving License number is compulsory for driver registration' });
    }
    if (!pan) {
        return res.status(400).json({ error: 'PAN Card number is compulsory for driver registration' });
    }

    try {
        const tempPass = await generateUniqueDriverOtp();
        const cols = ['full_name', 'dob', 'blood_group', 'phone', 'emergency_phone', 'join_date', 'status', 'emp_type', 'assigned_truck', 'salary', 'pay_freq', 'address', 'city', 'state', 'pin', 'dl_no', 'dl_issue', 'dl_expiry', 'rto', 'dl_state', 'license_type', 'vehicle_category', 'hazmat', 'experience', 'aadhar', 'pan', 'doc_dl_path', 'doc_aadhar_path', 'doc_pan_path', 'doc_photo_path', 'temp_password', 'is_onboarded'];
        const p = [d.fullName, d.dob, d.bloodGroup, phone, normalizePhone(d.emergencyPhone), d.joinDate, d.status || 'Active', d.empType || 'Full-time', d.assignedTruck, d.salary || 0, d.payFreq, d.address, d.city, d.state, d.pin, dlNo, d.dlIssue, d.dlExpiry, d.rto, d.dlState, d.licenseType, d.vehicleCategory, d.hazmat, d.experience || 0, d.aadhar, pan.toUpperCase(), getPath('file_dl'), getPath('file_aadhar'), getPath('file_pan'), getPath('file_photo'), tempPass, 0];

        db.run(`INSERT INTO drivers (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, p, function(err) {
            if (err) {
                console.error("Driver Insert Error:", err.message);
                return res.status(400).json({ error: err.message.includes('unique') ? 'Mobile Number or DL already registered' : err.message });
            }
            res.json({ id: this.lastID, message: 'Driver registered successfully', tempPassword: tempPass });
        });
    } catch (err) {
        console.error('Driver OTP generation failed:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- DRIVER APP AUTH API ---

app.post('/api/driver-auth/status', async (req, res) => {
    const phone = normalizePhone(req.body.phone);
    if (phone.length !== 10) return res.status(400).json({ error: 'Valid 10-digit phone number required' });

    db.get('SELECT id, full_name, phone, is_onboarded, temp_password, assigned_truck FROM drivers WHERE phone = ?', [phone], (err, driver) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!driver) return res.status(404).json({ error: 'Driver not found' });

        const finish = (resolvedOtp) => res.json({
            message: 'Driver found',
            driver: {
                id: driver.id,
                name: driver.full_name,
                phone: driver.phone,
                isOnboarded: Number(driver.is_onboarded || 0),
                hasTransporterOtp: !!resolvedOtp,
                assignedTruck: driver.assigned_truck
            }
        });

        if (!driver.temp_password && Number(driver.is_onboarded || 0) === 0) {
            generateUniqueDriverOtp()
                .then((generatedOtp) => {
                    db.run('UPDATE drivers SET temp_password = ? WHERE id = ?', [generatedOtp, driver.id], (updateErr) => {
                        if (updateErr) return res.status(500).json({ error: updateErr.message });
                        finish(generatedOtp);
                    });
                })
                .catch((otpErr) => res.status(500).json({ error: otpErr.message }));
            return;
        }

        finish(driver.temp_password);
    });
});

// Initial Login with Phone + OTP (Transporter Generated)
app.post('/api/driver-auth/login-otp', (req, res) => {
    const phone = normalizePhone(req.body.phone);
    const otp = cleanString(req.body.otp);
    if (phone.length !== 10 || !isSixDigitCode(otp)) return res.status(400).json({ error: 'Valid phone number and 6-digit OTP are required' });

    db.get('SELECT * FROM drivers WHERE phone = ?', [phone], (err, driver) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!driver) return res.status(404).json({ error: 'Driver not found' });
        
        if (driver.temp_password !== otp) {
            return res.status(401).json({ error: 'Invalid OTP provided by transporter' });
        }

        const token = jwt.sign({ id: driver.id, role: 'driver', name: driver.full_name }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ 
            message: 'OTP Verified', 
            token, 
            driver: { id: driver.id, name: driver.full_name, phone: driver.phone, isOnboarded: driver.is_onboarded } 
        });
    });
});

// Set 6-digit PIN after first login
app.post('/api/driver-auth/set-pin', (req, res) => {
    const phone = normalizePhone(req.body.phone);
    const pin = cleanString(req.body.pin);
    if (phone.length !== 10 || !isSixDigitCode(pin)) return res.status(400).json({ error: 'Valid 10-digit phone and 6-digit PIN required' });

    db.run('UPDATE drivers SET password = ?, is_onboarded = 1 WHERE phone = ?', [hashPassword(pin), phone], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'PIN set successfully. You can now login using this PIN.' });
    });
});

// Regular Login with Phone + PIN
app.post('/api/driver-auth/login-pin', (req, res) => {
    const phone = normalizePhone(req.body.phone);
    const pin = cleanString(req.body.pin);
    if (phone.length !== 10 || !isSixDigitCode(pin)) return res.status(400).json({ error: 'Valid phone number and 6-digit PIN are required' });

    db.get('SELECT * FROM drivers WHERE phone = ?', [phone], (err, driver) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!driver) return res.status(404).json({ error: 'Driver not found' });
        
        if (driver.is_onboarded === 0) {
            return res.status(403).json({ error: 'Please login using OTP first to set your PIN' });
        }

        if (!verifyDriverPin(pin, driver.password)) {
            return res.status(401).json({ error: 'Incorrect PIN' });
        }

        if (driver.password && !String(driver.password).startsWith('scrypt$')) {
            db.run('UPDATE drivers SET password = ? WHERE id = ?', [hashPassword(pin), driver.id], (updateErr) => {
                if (updateErr) {
                    console.error(`WATERTIGHT: Failed to upgrade driver PIN hash for driver ${driver.id}: ${updateErr.message}`);
                }
            });
        }

        const token = jwt.sign({ id: driver.id, role: 'driver', name: driver.full_name }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ 
            message: 'Login Successful', 
            token, 
            driver: { id: driver.id, name: driver.full_name, phone: driver.phone } 
        });
    });
});

// Forgot PIN - Reset using initial OTP
app.post('/api/driver-auth/forgot-pin', (req, res) => {
    const phone = normalizePhone(req.body.phone);
    const otp = cleanString(req.body.otp);
    const newPin = cleanString(req.body.newPin);
    if (phone.length !== 10 || !isSixDigitCode(otp) || !isSixDigitCode(newPin)) return res.status(400).json({ error: 'Phone, transporter OTP, and new 6-digit PIN are required' });

    db.get('SELECT * FROM drivers WHERE phone = ?', [phone], (err, driver) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!driver) return res.status(404).json({ error: 'Driver not found' });
        
        if (driver.temp_password !== otp) {
            return res.status(401).json({ error: 'Invalid Transporter OTP' });
        }

        db.run('UPDATE drivers SET password = ?, is_onboarded = 1 WHERE phone = ?', [hashPassword(newPin), phone], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'PIN reset successfully' });
        });
    });
});

// Update Location & Track Alerts
app.post('/api/driver/location', authenticateToken, (req, res) => {
    const { driverId, lat, lng, locationEnabled } = req.body;
    if (!driverId) return res.status(400).json({ error: 'Driver ID required' });
    if (req.user?.role !== 'driver' || String(req.user.id) !== String(driverId)) {
        return res.status(403).json({ error: 'You can only update your own driver location' });
    }

    const lastPing = new Date().toISOString();
    let locationAlert = null;

    // Logic: If driver is on an ACTIVE trip and location is OFF, trigger alert.
    db.get('SELECT d.*, t.id as active_trip_id FROM drivers d LEFT JOIN trips t ON (d.full_name = t.driver_text AND t.status = \'Active\') WHERE d.id = ?', [driverId], (err, data) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!data) return res.status(404).json({ error: 'Driver not found' });

        const locationUnavailable = locationEnabled === false || lat === null || lat === undefined || lng === null || lng === undefined;

        if (data.active_trip_id && locationUnavailable) {
            locationAlert = `Location turned OFF during active trip ${data.active_trip_id}`;
        }

        db.run(`
            UPDATE drivers 
            SET last_lat = ?, last_lng = ?, last_ping = ?, location_enabled = ?, location_alert = ? 
            WHERE id = ?
        `, [lat ?? data.last_lat, lng ?? data.last_lng, lastPing, locationEnabled ? 1 : 0, locationAlert, driverId], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Location updated', alertCreated: !!locationAlert, locationRequired: !!data.active_trip_id });
        });
    });
});


app.put('/api/drivers/:id', (req, res) => {
    const d = req.body;
    const phone = normalizePhone(d.phone);
    const emergencyPhone = normalizePhone(d.emergencyPhone);
    if (phone.length !== 10) {
        return res.status(400).json({ error: 'Valid 10-digit phone number required' });
    }
    if (cleanString(d.emergencyPhone) && emergencyPhone.length !== 10) {
        return res.status(400).json({ error: 'Emergency phone must be a valid 10-digit number' });
    }
    const sql = `UPDATE drivers SET full_name=?, dob=?, blood_group=?, phone=?, emergency_phone=?, join_date=?, status=?, emp_type=?, assigned_truck=?, salary=?, pay_freq=?, address=?, city=?, state=?, pin=?, dl_no=?, dl_issue=?, dl_expiry=?, rto=?, dl_state=?, license_type=?, vehicle_category=?, hazmat=?, experience=?, aadhar=?, pan=? WHERE id=?`;
    const p = [d.fullName, d.dob, d.bloodGroup, phone, emergencyPhone, d.joinDate, d.status, d.empType, d.assignedTruck, d.salary, d.payFreq, d.address, d.city, d.state, d.pin, d.dlNo, d.dlIssue, d.dlExpiry, d.rto, d.dlState, d.licenseType, d.vehicleCategory, d.hazmat, d.experience, d.aadhar, d.pan, req.params.id];
    db.run(sql, p, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Updated' });
    });
});

app.delete('/api/drivers/:id', (req, res) => {
    db.get('SELECT id, full_name FROM drivers WHERE id = ?', [req.params.id], async (err, driver) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!driver) return res.status(404).json({ error: 'Driver not found' });

        try {
            const linkedTrip = await pool.query(
                `SELECT id, status, origin, destination
                 FROM trips
                 WHERE driver_text = $1
                   AND status IN ('Upcoming', 'Active', 'En Route')
                 ORDER BY start_date_raw ASC NULLS LAST
                 LIMIT 1`,
                [driver.full_name]
            );

            if (linkedTrip.rows.length > 0) {
                const trip = linkedTrip.rows[0];
                return res.status(409).json({
                    error: `Cannot delete this driver because they are linked to trip ${trip.id} (${trip.status}) from ${trip.origin} to ${trip.destination}. Remove or complete that trip first.`,
                    code: 'DRIVER_ON_TRIP',
                    tripId: trip.id,
                    tripStatus: trip.status
                });
            }

            db.run('DELETE FROM drivers WHERE id = ?', [req.params.id], (deleteErr) => {
                if (deleteErr) return res.status(500).json({ error: deleteErr.message });
                res.json({ message: 'Deleted' });
            });
        } catch (tripErr) {
            return res.status(500).json({ error: tripErr.message });
        }
    });
});

// --- DASHBOARD STATS API ---
app.get('/api/dashboard/stats', (req, res) => {
    const stats = {
        kpis: { 
            totalRevenue: 0, 
            totalExpenses: 0, 
            netProfit: 0, 
            activeTrips: 0, 
            fleetUtilization: 0, 
            pendingInvoices: 0,
            revenueGrowth: "+12.4%", 
            expenseRise: "+4.1%", 
            profitGrowth: "+28.6%" 
        },
        charts: { revenueVsCost: [], costBreakdown: [] },
        insights: []
    };

    const now = new Date();
    const months = [];
    for(let i=5; i>=0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push({ name: d.toLocaleString('default', { month: 'short' }), mIdx: d.getMonth(), y: d.getFullYear(), r: 0, c: 0 });
    }

    db.all(`SELECT freight, start_date_raw, status FROM trips`, (err, trips) => {
        if (err) return res.status(500).json({ error: err.message });
            trips.forEach(t => {
                if (t.status === 'Active') stats.kpis.activeTrips++;
                if (t.is_paid === 0) stats.kpis.pendingInvoices++;
                stats.kpis.totalRevenue += (t.freight || 0);
                if (t.start_date_raw) {
                    const td = new Date(t.start_date_raw);
                    const m = months.find(mo => mo.mIdx === td.getMonth() && mo.y === td.getFullYear());
                    if (m) m.r += (t.freight || 0);
                }
            });

        db.all(`SELECT amount, type, date FROM expenses`, (err, expenses) => {
            if (err) return res.status(500).json({ error: err.message });
            const catMap = {};
            expenses.forEach(e => {
                stats.kpis.totalExpenses += (e.amount || 0);
                catMap[e.type] = (catMap[e.type] || 0) + (e.amount || 0);
                if (e.date) {
                    const ed = new Date(e.date);
                    const m = months.find(mo => mo.mIdx === ed.getMonth() && mo.y === ed.getFullYear());
                    if (m) m.c += (e.amount || 0);
                }
            });

            db.all(`SELECT COUNT(*) as count FROM trucks`, (err, trCount) => {
                const totalTrucks = trCount && trCount[0] ? trCount[0].count : 0;
                if (totalTrucks > 0) {
                    stats.kpis.fleetUtilization = Math.round((stats.kpis.activeTrips / totalTrucks) * 100);
                }

                stats.kpis.netProfit = stats.kpis.totalRevenue - stats.kpis.totalExpenses;
                stats.charts.revenueVsCost = months.map(m => ({ m: m.name, r: m.r, c: m.c }));
                const colors = ['var(--highway)', 'var(--saffron)', 'var(--gold)', 'var(--blue)', 'var(--muted2)'];
                stats.charts.costBreakdown = Object.keys(catMap).map((cat, i) => ({ label: cat, value: catMap[cat], color: colors[i % colors.length] }));

                // Insights
                db.all(`SELECT COUNT(*) as count FROM drivers WHERE location_alert IS NOT NULL AND location_alert != ''`, (err, drs) => {
                    if (drs && drs[0].count > 0) {
                        stats.insights.push({ type: 'warn', icon: '⚠️', title: 'High Idle Time', body: `${drs[0].count} trucks idle. Loss: ₹${(drs[0].count * 4500).toLocaleString()}.`, tag: 'Cost Leak', tagColor: 'tag-gold' });
                    }
                    db.all(`SELECT origin, destination, SUM(freight) as rev, COUNT(*) as trips FROM trips GROUP BY origin, destination ORDER BY rev DESC LIMIT 1`, (err, rts) => {
                        if (rts && rts.length > 0) {
                            stats.insights.push({ type: 'success', icon: '🏆', title: `Best Route: ${rts[0].origin} → ${rts[0].destination}`, body: `High revenue with ${rts[0].trips} trips.`, tag: 'Expand', tagColor: 'tag-green' });
                        }
                        res.json(stats);
                    });
                });
            });
        });
    });
});
// --- EXPORT API ---
app.get('/api/export/fleet', async (req, res) => {
    try {
        const wb = await generateFleetExcel();
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=Fleet_Register.xlsx');
        await wb.xlsx.write(res);
        res.end();
    } catch (err) {
        res.status(500).json({ error: 'Export failed' });
    }
});

app.get('/api/export/drivers', async (req, res) => {
    try {
        const wb = await generateDriversExcel();
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=Driver_Register.xlsx');
        await wb.xlsx.write(res);
        res.end();
    } catch (err) {
        res.status(500).json({ error: 'Export failed' });
    }
});

// --- ALERTS API ---
app.get('/api/alerts', (req, res) => {
    const alerts = [];
    const now = new Date();
    db.all(`SELECT reg_no, ins_expiry_date, puc_expiry_date, permit_expiry_date, fitness_expiry_date FROM trucks`, (err, trucks) => {
        if (err) return res.status(500).json({ error: err.message });
        trucks.forEach(t => {
            const check = (d, l) => {
                if (!d) return;
                const exp = new Date(d);
                const days = Math.ceil((exp - now) / (86400000));
                if (days <= 0) alerts.push({ type: 'CRITICAL', title: `${l} Expired: ${t.reg_no}`, desc: `Expired on ${d}.`, icon: '🔴' });
                else if (days <= 30) alerts.push({ type: 'WARNING', title: `${l} Due: ${t.reg_no}`, desc: `Expires in ${days} days.`, icon: '⚠️' });
            };
            check(t.ins_expiry_date, 'Insurance');
            check(t.puc_expiry_date, 'PUC');
            check(t.permit_expiry_date, 'Permit');
            check(t.fitness_expiry_date, 'Fitness');
        });
        db.all(`SELECT full_name, assigned_truck, location_enabled, location_alert, last_ping FROM drivers`, (err, drivers) => {
            if (err) return res.status(500).json({ error: err.message });
            drivers.forEach(d => {
                if (d.location_alert) alerts.push({ type: 'CRITICAL', title: `Location Alert: ${d.full_name}`, desc: d.location_alert, icon: '🔴' });
                if (d.last_ping && d.assigned_truck) {
                    const diff = (now - new Date(d.last_ping)) / 3600000;
                    if (diff > 4) alerts.push({ type: 'WARNING', title: `Idle Alert: ${d.assigned_truck}`, desc: `${d.full_name} stationary for ${Math.floor(diff)}h.`, icon: '⚠️' });
                }
            });
            res.json(alerts);
        });
    });
});

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

async function tryLocalGravityOcr(base64Image, mimeType = 'image/jpeg') {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
        const imageBuffer = Buffer.from(base64Image, 'base64');
        const form = new FormData();
        form.append('images', new Blob([imageBuffer], { type: mimeType }), 'document.jpg');

        const response = await fetch('http://127.0.0.1:5001/api/ocr', {
            method: 'POST',
            body: form,
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(`GravityOCR responded ${response.status}`);
        }

        const payload = await response.json();
        const normalized = payload && payload.data && typeof payload.data === 'object'
            ? { ...flattenOcrPayload(payload.data), ...payload }
            : flattenOcrPayload(payload);

        if (!normalized || !Object.keys(normalized).length) {
            throw new Error('GravityOCR returned no usable fields');
        }

        normalized._source = normalized._source || 'GravityOCR';
        return normalized;
    } finally {
        clearTimeout(timeout);
    }
}

// --- VISION OCR (Logistics Documents) ---
app.post('/api/ocr-gemini', authenticateToken, async (req, res) => {
    let result = null;
    let status = 'SUCCESS';
    let errorMsg = null;
    
    try {
        const { image, mimeType, documentType } = req.body;
        if (!image) return res.status(400).json({ error: 'No image' });
        
        console.log(`[OCR] Request received. Mime: ${mimeType || 'image/jpeg'}, Size: ${Math.round(image.length / 1024)} KB`);
        const normalizedDocumentType = cleanString(documentType) || 'logistics';
        result = await parseDocumentWithGemini(image, mimeType || 'image/jpeg', normalizedDocumentType);
        console.log(`[OCR] Success. Extracted keys: ${Object.keys(result).join(', ')}`);
        
        res.json(result);
    } catch (err) {
        status = 'FAILED';
        errorMsg = err.message;
        console.error(`[OCR] Failed: ${err.message}`);
        res.status(500).json({ error: err.message });
    } finally {
        // Record scan history
        try {
            const sql = `INSERT INTO ocr_scans (doc_type, reg_no, owner_name, raw_data, status, error_msg) VALUES (?, ?, ?, ?, ?, ?)`;
            const docType = result ? result["Document Type"] : 'Unknown';
            const regNo = result ? result["Reg No"] : null;
            const owner = result ? result["Owner Name"] : null;
            db.run(sql, [docType, regNo, owner, result ? JSON.stringify(result) : null, status, errorMsg]);
        } catch (dbErr) { console.error("OCR audit record failed:", dbErr.message); }
    }
});

app.post('/api/ocr-truck', authenticateToken, async (req, res) => {
    let result = null;
    let status = 'SUCCESS';
    let errorMsg = null;
    let engine = 'unknown';

    try {
        const { image, mimeType, documentType } = req.body;
        if (!image) return res.status(400).json({ error: 'No image' });

        const normalizedDocumentType = cleanString(documentType) || 'logistics';
        console.log(`[OCR] Smart truck scan request. Mime: ${mimeType || 'image/jpeg'}, Size: ${Math.round(image.length / 1024)} KB`);

        try {
            result = await tryLocalGravityOcr(image, mimeType || 'image/jpeg');
            engine = 'gravityocr';
            console.log(`[OCR] Local GravityOCR success. Extracted keys: ${Object.keys(result).join(', ')}`);
        } catch (localErr) {
            console.warn(`[OCR] Local GravityOCR unavailable, trying Tesseract fallback: ${localErr.message}`);
            try {
                result = await tryTesseractDocumentOcr(image, mimeType || 'image/jpeg', normalizedDocumentType);
                result = flattenOcrPayload(result);
                result._source = result._source || 'TesseractFallback';
                engine = 'tesseract';
                console.log(`[OCR] Tesseract fallback success. Extracted keys: ${Object.keys(result).join(', ')}`);
            } catch (tesseractErr) {
                console.warn(`[OCR] Tesseract fallback unavailable, falling back to Gemini: ${tesseractErr.message}`);
                result = await parseDocumentWithGemini(image, mimeType || 'image/jpeg', normalizedDocumentType);
                result = flattenOcrPayload(result);
                result._source = 'GeminiFallback';
                engine = 'gemini';
                console.log(`[OCR] Gemini fallback success. Extracted keys: ${Object.keys(result).join(', ')}`);
            }
        }

        res.json({
            ...result,
            _engine: engine
        });
    } catch (err) {
        status = 'FAILED';
        errorMsg = err.message;
        console.error(`[OCR] Smart truck scan failed: ${err.message}`);
        res.status(500).json({
            error: 'Scanning could not be completed right now. Please retry with a clearer image or use Add Manually.',
            details: err.message
        });
    } finally {
        try {
            const sql = `INSERT INTO ocr_scans (doc_type, reg_no, owner_name, raw_data, status, error_msg) VALUES (?, ?, ?, ?, ?, ?)`;
            const docType = result ? (result["Document Type"] || result.documentType || 'Unknown') : 'Unknown';
            const regNo = result ? (result["Reg No"] || result.regNo || null) : null;
            const owner = result ? (result["Owner Name"] || result.ownerName || null) : null;
            db.run(sql, [docType, regNo, owner, result ? JSON.stringify(result) : null, status, errorMsg]);
        } catch (dbErr) {
            console.error("OCR audit record failed:", dbErr.message);
        }
    }
});

// --- TAXHACKER RECEIPT ANALYZE ---
app.post('/api/analyze', authenticateToken, async (req, res) => {
    try {
        const { base64, mimeType } = req.body;
        if (!base64) return res.status(400).json({ error: 'No base64 image data' });

        console.log(`[TaxHacker] Processing receipt scan...`);
        const result = await parseDocumentWithGemini(base64, mimeType || 'image/jpeg', 'receipt');
        
        const normalizedAmount = toNumberOrNull(result.total_amount);
        if (normalizedAmount === null || normalizedAmount <= 0 || !cleanString(result.date)) {
            return res.status(422).json({
                error: 'Receipt scan is incomplete. Please scan again clearly or use Add Manually.',
                code: 'UNREADABLE_RECEIPT'
            });
        }

        if (!cleanString(result.category)) {
            result.category = 'Other';
        }

        console.log(`[TaxHacker] Successfully analyzed receipt. Vendor: ${result.vendor}, Amount: ${result.total_amount}`);
        res.json(result);
    } catch (err) {
        console.error(`[TaxHacker] Analysis failed: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/fleet/locations', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                d.id,
                d.full_name,
                d.phone,
                d.last_lat,
                d.last_lng,
                d.last_ping,
                d.location_enabled,
                d.location_alert,
                d.assigned_truck,
                t.id AS active_trip_id,
                t.origin AS active_trip_origin,
                t.destination AS active_trip_destination,
                t.status AS active_trip_status,
                t.start_date AS active_trip_start_date,
                t.end_date AS active_trip_end_date
            FROM drivers d
            LEFT JOIN trips t
                ON d.full_name = t.driver_text
                AND t.status IN ('Active', 'En Route')
            WHERE d.last_lat IS NOT NULL
               OR d.last_lng IS NOT NULL
               OR (d.location_alert IS NOT NULL AND d.location_alert != '')
            ORDER BY
                CASE WHEN d.location_alert IS NOT NULL AND d.location_alert != '' THEN 0 ELSE 1 END,
                d.full_name ASC
        `);

        res.json(result.rows);
    } catch (err) {
        console.error('Fleet locations query failed:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/driver-data', async (req, res) => {
    try {
        const authUser = getOptionalAuthUser(req);
        if (!authUser) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        const userId = authUser.role === 'driver' ? String(authUser.id) : (req.query.userId || String(authUser.id));

        if (authUser.role && authUser.role !== 'driver') {
            const [tripsRes, trucksRes, driversRes, expensesRes] = await Promise.all([
                pool.query(`
                    SELECT
                        t.*,
                        d.phone AS driver_phone,
                        tr.purchase_price AS truck_purchase_price,
                        tr.tyres_count AS truck_tyres_count,
                        COALESCE(SUM(CASE WHEN COALESCE(e.status, 'In Process') != 'Rejected' THEN COALESCE(e.amount, 0) ELSE 0 END), 0) AS total_expenses
                    FROM trips t
                    LEFT JOIN drivers d ON t.driver_text = d.full_name
                    LEFT JOIN trucks tr ON t.truck_text = tr.reg_no
                    LEFT JOIN expenses e ON e.trip_id = t.id
                    GROUP BY t.id, d.phone, tr.purchase_price, tr.tyres_count
                    ORDER BY t.created_at DESC
                `),
                pool.query('SELECT * FROM trucks ORDER BY created_at DESC'),
                pool.query('SELECT * FROM drivers ORDER BY created_at DESC'),
                pool.query(`
                    SELECT
                        e.*,
                        t.origin,
                        t.destination,
                        t.start_date,
                        t.end_date,
                        t.driver_text
                    FROM expenses e
                    LEFT JOIN trips t ON t.id = e.trip_id
                    ORDER BY e.created_at DESC
                `)
            ]);

            const serializedExpenses = expensesRes.rows.map((row) => {
                const exp = serializeExpenseRow(row);
                return {
                    ...exp,
                    desc: `${exp.expense_type} · ${exp.trip_id || 'No Trip'}`,
                    ref: exp.trip_id || `EXP-${exp.id}`,
                    amount: exp.total_paise,
                    tripId: exp.trip_id,
                    from: exp.route_from || row.origin || null,
                    to: exp.route_to || row.destination || null,
                    driverName: exp.driver_name || row.driver_text || null
                };
            });

            const totalRevenue = tripsRes.rows.reduce((sum, trip) => sum + (parseFloat(trip.freight) || 0), 0);
            const totalExpenses = serializedExpenses
                .filter((expense) => expense.status !== 'Rejected')
                .reduce((sum, expense) => sum + expense.total_rupees, 0);
            const activeTrips = tripsRes.rows.filter((trip) => ['Active', 'En Route'].includes(trip.status)).length;
            const pendingInvoices = tripsRes.rows.filter((trip) => !trip.is_paid).length;

            res.json({
                stats: {
                    totalRevenue,
                    totalExpenses,
                    netProfit: totalRevenue - totalExpenses,
                    activeTrips,
                    fleetUtilization: trucksRes.rows.length ? Math.round((activeTrips / trucksRes.rows.length) * 100) : 0,
                    pendingInvoices
                },
                charts: {
            revenueVsCost: buildRevenueCostSeries(tripsRes.rows, serializedExpenses, 24),
                    costBreakdown: buildExpenseBreakdown(serializedExpenses)
                },
                trips: tripsRes.rows.map((t) => ({
                    ...t,
                    truck: t.truck_text,
                    route: t.origin,
                    dest: t.destination,
                    driver: t.driver_text,
                    driverPhone: t.driver_phone,
                    startDate: t.start_date,
                    startDateRaw: t.start_date_raw,
                    endDate: t.end_date,
                    endDateRaw: t.end_date_raw,
                    autoEndDateRaw: t.auto_end_date_raw,
                    totalExpenses: parseFloat(t.total_expenses || 0),
                    distanceKm: parseFloat(t.distance_km || 0),
                    truckPurchasePrice: parseFloat(t.truck_purchase_price || 0),
                    truckTyresCount: parseInt(t.truck_tyres_count || 0, 10) || 0
                })),
                trucks: trucksRes.rows,
                drivers: driversRes.rows.map((row) => sanitizeDriverRow(row, { includeTransporterOtp: true })),
                expenses: serializedExpenses,
                invoices: tripsRes.rows
                    .filter((trip) => !trip.is_paid)
                    .map((trip) => ({
                        num: trip.inv_id || trip.id,
                        client: trip.client || trip.destination || 'Route Client',
                        date: trip.start_date || trip.start_date_raw,
                        amount: Math.round((parseFloat(trip.balance || trip.freight || 0)) / 100),
                        status: 'pending'
                    }))
            });
            return;
        }

        const driverRes = await pool.query('SELECT * FROM drivers WHERE id::text = $1', [String(authUser.id)]);
        const driver = driverRes.rows[0] || null;
        if (!driver) {
            return res.status(404).json({ error: 'Driver not found' });
        }
        const driverName = driver ? driver.full_name : '';

        const lastExpensesRes = await pool.query('SELECT * FROM expenses WHERE driver_id::text = $1 ORDER BY COALESCE(date, created_at::text) DESC LIMIT 20', [userId]);
        const lastTripsRes = await pool.query('SELECT * FROM trips WHERE driver_text = $1 OR driver_text = $2 ORDER BY start_date_raw DESC LIMIT 20', [driverName, userId]);
        const allDriverTripsRes = await pool.query('SELECT * FROM trips WHERE driver_text = $1 OR driver_text = $2 ORDER BY start_date_raw DESC', [driverName, userId]);
        const allDriverExpensesRes = await pool.query('SELECT * FROM expenses WHERE driver_id::text = $1 ORDER BY COALESCE(date, created_at::text) DESC', [userId]);
        const serializedDriverExpenses = allDriverExpensesRes.rows.map((expense) => serializeExpenseRow(expense));

        const tripsCount = allDriverTripsRes.rows.length;
        const totalRevenue = allDriverTripsRes.rows.reduce((sum, trip) => sum + (parseFloat(trip.freight) || 0), 0);
        const activeTrips = allDriverTripsRes.rows.filter((trip) => ['Active', 'En Route'].includes(trip.status)).length;
        const completedTrips = allDriverTripsRes.rows.filter((trip) => String(trip.status || '').toLowerCase() === 'completed');
        const totalKM = completedTrips.reduce((sum, trip) => sum + (parseFloat(trip.distance_km) || 0), 0);
        const totalCosts = serializedDriverExpenses
            .filter((expense) => expense.status !== 'Rejected')
            .reduce((sum, expense) => sum + expense.total_rupees, 0);
        const charts = {
            revenueVsCost: buildRevenueCostSeries(allDriverTripsRes.rows, serializedDriverExpenses, 24),
            costBreakdown: buildExpenseBreakdown(serializedDriverExpenses)
        };
        const pendingInvoices = allDriverTripsRes.rows.filter((trip) => !trip.is_paid).length;
        const trackedTruckCount = new Set(
            allDriverTripsRes.rows
                .map((trip) => cleanString(trip.truck_text))
                .filter(Boolean)
        ).size || (cleanString(driver.assigned_truck) ? 1 : 0);
        const fleetUtilization = trackedTruckCount ? Math.min(100, Math.round((activeTrips / trackedTruckCount) * 100)) : 0;

        const mappedTrips = lastTripsRes.rows.map(t => ({
            ...t,
            truck: t.truck_text,
            route: t.origin,
            dest: t.destination,
            driver: t.driver_text,
            startDate: t.start_date,
            totalExpenses: 0,
            distanceKm: parseFloat(t.distance_km || 0),
            km: parseFloat(t.distance_km || 0),
            earned: Math.round((parseFloat(t.freight) || 0) / 100),
            truckPurchasePrice: 0,
            truckTyresCount: 0
        }));

        const activeTrip = mappedTrips.find(t => ['Active', 'En Route'].includes(t.status)) || null;
        const upcomingTrip = mappedTrips.find(t => t.status === 'Upcoming') || null;

        res.json({
            driver: sanitizeDriverRow(driver),
            stats: {
                tripsCount,
                activeTrips,
                totalRevenue,
                totalEarnings: totalRevenue - totalCosts,
                totalCosts,
                totalKM,
                pendingInvoices,
                fleetUtilization
            },
            expenses: lastExpensesRes.rows.map((expense) => {
                const serialized = serializeExpenseRow(expense);
                return {
                    ...serialized,
                    amount: serialized.total_paise
                };
            }),
            trips: mappedTrips,
            charts,
            activeTrip,
            upcomingTrip
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/save-expense', authenticateToken, async (req, res) => {
    const {
        merchant,
        total,
        amount,
        category,
        date,
        driver_id,
        truck_id,
        metadata,
        trip_id,
        place,
        route_from,
        route_to,
        bill_image_data,
        submission_mode
    } = req.body;

    try {
        if (req.user?.role !== 'driver') {
            return res.status(403).json({ error: 'Driver access required to submit expenses' });
        }

        const driverRes = await pool.query('SELECT * FROM drivers WHERE id::text = $1 OR phone = $1', [cleanString(driver_id)]);
        const driver = driverRes.rows[0];
        if (!driver) {
            return res.status(404).json({ error: 'Driver not found for this expense' });
        }
        if (String(driver.id) !== String(req.user.id)) {
            return res.status(403).json({ error: 'You can only submit expenses for your own driver account' });
        }

        let trip = null;
        if (cleanString(trip_id)) {
            const tripRes = await pool.query('SELECT * FROM trips WHERE id = $1 LIMIT 1', [trip_id]);
            trip = tripRes.rows[0] || null;
        } else {
            const tripRes = await pool.query(
                "SELECT * FROM trips WHERE driver_text = $1 AND status IN ('Active', 'En Route') ORDER BY start_date_raw DESC NULLS LAST LIMIT 1",
                [driver.full_name]
            );
            trip = tripRes.rows[0] || null;
        }

        if (!trip) {
            return res.status(400).json({ error: 'No trip is linked to this expense. Please log it from the correct trip.' });
        }

        const expenseDate = parseFlexibleDate(date);
        const tripWindow = getTripDateWindow(trip);
        if (expenseDate && tripWindow && (expenseDate < tripWindow.start || expenseDate > tripWindow.end)) {
            return res.status(409).json({
                code: 'OUTSIDE_TRIP_RANGE',
                error: 'This expense does not fall inside the selected trip dates. Please log it under the correct trip from the Trips tab.',
                tripId: trip.id,
                tripStart: trip.start_date || trip.start_date_raw,
                tripEnd: trip.end_date || trip.end_date_raw || trip.auto_end_date_raw || new Date().toISOString().split('T')[0]
            });
        }

        const normalizedTotalPaise = Math.round(toNumberOrNull(total) ?? toNumberOrNull(amount) ?? 0);
        const normalizedCategory = classifyExpenseCategory(
            category,
            metadata?.category,
            merchant,
            metadata?.vendor,
            metadata?.merchant,
            metadata?.description,
            metadata?.expense_item,
            place
        );
        const normalizedMerchant = cleanString(merchant) || cleanString(metadata?.vendor) || 'Unknown Vendor';
        const normalizedDate = cleanString(date);
        const receiptImageData = cleanString(bill_image_data || metadata?.receiptImageDataUrl);
        const normalizedSubmissionMode = cleanString(submission_mode) || (receiptImageData ? 'scan' : 'manual');

        if (!normalizedDate) {
            return res.status(400).json({ error: 'Expense date is required' });
        }
        if (normalizedTotalPaise <= 0) {
            return res.status(400).json({ error: 'Expense amount must be greater than zero' });
        }
        if (normalizedSubmissionMode === 'scan' && !receiptImageData) {
            return res.status(400).json({ error: 'Scanned bill image is required for scanner submissions' });
        }

        const normalizedAmountRupees = Number((normalizedTotalPaise / 100).toFixed(2));
        const payload = {
            ...(metadata || {}),
            submission_mode: normalizedSubmissionMode,
            trip_id: trip.id,
            route_from: route_from || trip.origin || null,
            route_to: route_to || trip.destination || null,
            place: place || metadata?.place || metadata?.location || null,
            receiptImageDataUrl: receiptImageData || null,
            category: normalizedCategory,
            originalCategory: cleanString(category) || cleanString(metadata?.category) || null,
            vendor: normalizedMerchant
        };

        const result = await pool.query(
            `INSERT INTO expenses (
                merchant, total, amount, category, type, date, issued_at, status,
                driver_id, driver_name, truck_id, trip_id, place, route_from, route_to,
                bill_image_data, metadata, source
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, 'In Process',
                $8, $9, $10, $11, $12, $13, $14,
                $15, $16, 'driver'
            ) RETURNING id`,
            [
                normalizedMerchant,
                normalizedTotalPaise,
                normalizedAmountRupees,
                normalizedCategory,
                normalizedCategory,
                normalizedDate,
                new Date().toISOString(),
                String(driver.id),
                driver.full_name,
                truck_id || trip.truck_text,
                trip.id,
                place || payload.place,
                route_from || trip.origin,
                route_to || trip.destination,
                receiptImageData || payload.receiptImageDataUrl,
                JSON.stringify(payload)
            ]
        );

        res.json({
            id: result.rows[0].id,
            message: 'Expense saved successfully',
            status: 'In Process',
            tripId: trip.id
        });
    } catch (err) {
        console.error(`[SaveExpense] Database Error: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/expense/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT
                e.*,
                t.origin,
                t.destination,
                t.start_date,
                t.end_date,
                t.truck_text
             FROM expenses e
             LEFT JOIN trips t ON t.id = e.trip_id
             WHERE e.id = $1
             LIMIT 1`,
            [req.params.id]
        );
        const row = result.rows[0];
        if (!row) return res.status(404).json({ error: 'Expense not found' });
        if (req.user?.role === 'driver' && String(row.driver_id) !== String(req.user.id)) {
            return res.status(403).json({ error: 'You can only view your own expenses' });
        }
        res.json(serializeExpenseRow(row));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/driver-data', authenticateToken, async (req, res) => {
    try {
        const action = cleanString(req.body.action);
        const userId = cleanString(req.body.userId);
        const tripId = cleanString(req.body.tripId);

        if (action !== 'START_TRIP') {
            return res.json({ message: 'Action processed successfully' });
        }

        if (!userId) {
            return res.status(400).json({ error: 'Driver userId is required' });
        }

        if (req.user?.role !== 'driver' || String(req.user.id) !== String(userId)) {
            return res.status(403).json({ error: 'You can only start trips for your own driver account' });
        }

        const driverRes = await pool.query('SELECT * FROM drivers WHERE id::text = $1 OR phone = $1', [userId]);
        const driver = driverRes.rows[0];
        if (!driver) {
            return res.status(404).json({ error: 'Driver not found' });
        }

        const activeRes = await pool.query("SELECT id FROM trips WHERE driver_text = $1 AND status IN ('Active', 'En Route') LIMIT 1", [driver.full_name]);
        if (activeRes.rows.length > 0) {
            return res.status(409).json({ error: `Finish active trip ${activeRes.rows[0].id} before starting a new one` });
        }

        const params = [driver.full_name];
        let sql = "SELECT * FROM trips WHERE driver_text = $1 AND status = 'Upcoming'";
        if (tripId) {
            params.push(tripId);
            sql += ' AND id = $2';
        }
        sql += ' ORDER BY start_date_raw ASC NULLS LAST LIMIT 1';

        const upcomingRes = await pool.query(sql, params);
        const upcomingTrip = upcomingRes.rows[0];
        if (!upcomingTrip) {
            return res.status(404).json({ error: 'No upcoming trip found for this driver' });
        }

        await pool.query('UPDATE trips SET status = $1 WHERE id = $2', ['Active', upcomingTrip.id]);
        res.json({ message: 'Trip started successfully', tripId: upcomingTrip.id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/ocr-history', (req, res) => {
    db.all('SELECT * FROM ocr_scans ORDER BY created_at DESC LIMIT 100', (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// --- GLOBAL ERROR HANDLER ---
app.use((err, req, res, next) => {
    console.error(`[ERROR] ${new Date().toISOString()} - ${req.method} ${req.url}:`, err.message);
    if (res.headersSent) return next(err);
    res.status(500).json({ 
        error: 'An internal server error occurred. Our engineers have been notified.',
        detail: process.env.NODE_ENV === 'development' ? err.message : undefined 
    });
});

let server;

// Start Server IMMEDIATELY to prevent hanging on Railway startup
const startProductionServer = () => {
    server = app.listen(port, '0.0.0.0', () => {
        console.log(`🚀 FLEETOS PRO API LIVE: http://0.0.0.0:${port}`);
        console.log(`📡 Health Check: http://localhost:${port}/health`);
        
        // Background DB Initialization
        console.log("🐘 Initializing Database in Background...");
        initializeDatabase().then(() => {
            console.log("✅ Database Synced Successfully");
        }).catch(err => {
            console.error("❌ Database Background Init Failed:", err.message);
        });
    });
};

startProductionServer();

// Graceful Shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    if (server) {
        server.close(() => {
            console.log('HTTP server closed');
            pool.end(() => console.log('Database pool closed'));
        });
    } else {
        process.exit(0);
    }
});
