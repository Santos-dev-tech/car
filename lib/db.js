'use strict';
/**
 * MotoKE - database layer.
 * Zero dependencies: uses node:sqlite (built into Node 22.5+).
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = process.env.MOTOKE_DB || path.join(DATA_DIR, 'motoke.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS dealers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  tagline TEXT,
  logo_text TEXT,
  primary_color TEXT DEFAULT '#c8102e',
  accent_color TEXT DEFAULT '#0b1f3a',
  phone TEXT,
  whatsapp TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  about TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS branches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dealer_id INTEGER NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  city TEXT,
  address TEXT,
  phone TEXT,
  active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dealer_id INTEGER REFERENCES dealers(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'customer',
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  last_login TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dealer_id INTEGER NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
  branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  variant TEXT,
  year INTEGER NOT NULL,
  price INTEGER NOT NULL,
  old_price INTEGER,
  condition TEXT NOT NULL DEFAULT 'used',      -- new | used | foreign_used
  body_type TEXT,
  fuel TEXT,
  transmission TEXT,
  drivetrain TEXT,
  engine_cc INTEGER,
  mileage_km INTEGER DEFAULT 0,
  color TEXT,
  seats INTEGER,
  doors INTEGER,
  reg_no TEXT,
  vin TEXT,
  status TEXT NOT NULL DEFAULT 'available',    -- available | reserved | sold | draft
  featured INTEGER DEFAULT 0,
  description TEXT,
  images TEXT DEFAULT '[]',
  features TEXT DEFAULT '[]',
  duty_paid INTEGER DEFAULT 1,
  views INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_vehicles_dealer ON vehicles(dealer_id, status);
CREATE INDEX IF NOT EXISTS idx_vehicles_make ON vehicles(make, model);

CREATE TABLE IF NOT EXISTS lenders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  short_name TEXT,
  type TEXT NOT NULL DEFAULT 'bank',           -- bank | microfinance | sacco | inhouse
  logo_text TEXT,
  color TEXT DEFAULT '#0b1f3a',
  active INTEGER DEFAULT 1,
  rate_type TEXT NOT NULL DEFAULT 'reducing',  -- reducing | flat
  annual_rate REAL NOT NULL,
  min_deposit_pct REAL DEFAULT 20,
  min_tenor_months INTEGER DEFAULT 12,
  max_tenor_months INTEGER DEFAULT 60,
  min_loan INTEGER DEFAULT 200000,
  max_loan INTEGER DEFAULT 15000000,
  min_monthly_income INTEGER DEFAULT 30000,
  max_dti_pct REAL DEFAULT 50,
  max_vehicle_age_years INTEGER DEFAULT 8,
  processing_fee_pct REAL DEFAULT 2,
  processing_fee_min INTEGER DEFAULT 0,
  processing_fee_max INTEGER DEFAULT 0,
  valuation_fee INTEGER DEFAULT 0,
  tracking_fee INTEGER DEFAULT 0,
  legal_fee INTEGER DEFAULT 0,
  insurance_rate_pct REAL DEFAULT 0,           -- comprehensive premium, % of value, year 1
  insurance_financed INTEGER DEFAULT 0,
  capitalize_fees INTEGER DEFAULT 0,
  allowed_employment TEXT DEFAULT '["employed","self_employed","business","contract"]',
  allowed_conditions TEXT DEFAULT '["new","used","foreign_used"]',
  requires_clean_crb INTEGER DEFAULT 1,
  bank_statement_months INTEGER DEFAULT 6,
  min_age INTEGER DEFAULT 21,
  max_age_at_maturity INTEGER DEFAULT 65,
  approval_days INTEGER DEFAULT 5,
  logbook_holder TEXT DEFAULT 'lender',
  early_settlement_fee_pct REAL DEFAULT 0,
  notes TEXT,
  requirements TEXT DEFAULT '[]',
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- which lenders a given dealer offers; empty = lender available to all dealers
CREATE TABLE IF NOT EXISTS dealer_lenders (
  dealer_id INTEGER NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
  lender_id INTEGER NOT NULL REFERENCES lenders(id) ON DELETE CASCADE,
  enabled INTEGER DEFAULT 1,
  PRIMARY KEY (dealer_id, lender_id)
);

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT UNIQUE NOT NULL,
  dealer_id INTEGER NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
  vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  lender_id INTEGER REFERENCES lenders(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  applicant TEXT NOT NULL,       -- json: name, id_no, phone, email, dob, address...
  employment TEXT NOT NULL,      -- json: type, employer, net_income, obligations...
  offer TEXT NOT NULL,           -- json snapshot of the quote at submission
  vehicle_snapshot TEXT,         -- json snapshot of the car
  price INTEGER,
  deposit INTEGER,
  loan_amount INTEGER,
  tenor_months INTEGER,
  monthly_payment INTEGER,
  status TEXT NOT NULL DEFAULT 'new',
  stage_note TEXT,
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS application_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT,
  size INTEGER,
  data TEXT,
  uploaded_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS application_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  actor TEXT,
  message TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dealer_id INTEGER NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
  type TEXT NOT NULL,            -- test_drive | trade_in | callback | enquiry
  vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  message TEXT,
  payload TEXT DEFAULT '{}',
  status TEXT DEFAULT 'new',
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS saved_vehicles (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, vehicle_id)
);

/* A saved SEARCH, not a saved car. The customer who cannot find what they want today is
   the one most worth hearing from again, and every serious marketplace stores this while
   MotoKE only stored the cars people had already found.
   The contact column lets someone who is not signed in still be told — most Kenyan
   buyers will not make an account before they have found a car. */
/* A test drive as a real appointment rather than "someone will call you back".
   Every callback is a phone call the dealership has to make and a customer has to wait
   for; a slot is a diary entry both sides can see. */
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT UNIQUE NOT NULL,
  dealer_id INTEGER NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
  branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'test_drive',   -- test_drive | viewing | delivery
  slot_date TEXT NOT NULL,
  slot_time TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'booked',     -- booked | confirmed | done | cancelled | no_show
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bookings_slot ON bookings(dealer_id, slot_date, slot_time);

CREATE TABLE IF NOT EXISTS saved_searches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dealer_id INTEGER NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  contact TEXT,
  label TEXT,
  filters TEXT NOT NULL DEFAULT '{}',
  last_seen_count INTEGER DEFAULT 0,
  notified_at TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_saved_searches_dealer ON saved_searches(dealer_id, active);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  actor TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  detail TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

db.exec(SCHEMA);

/* ---------- tables added after the first release ---------- */
db.exec(`
CREATE TABLE IF NOT EXISTS prequalifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT UNIQUE NOT NULL,
  dealer_id INTEGER NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
  vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  id_number TEXT,
  applicant TEXT NOT NULL,   -- json: income, obligations, employment, crb, age
  target_price INTEGER,
  deposit INTEGER,
  tenor_months INTEGER,
  results TEXT,              -- json: per-lender outcome snapshot
  approved_count INTEGER DEFAULT 0,
  best_monthly INTEGER,
  status TEXT DEFAULT 'new',
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- online booking deposits / reservations
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT UNIQUE NOT NULL,
  dealer_id INTEGER NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
  vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  application_id INTEGER REFERENCES applications(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'reservation',   -- reservation | deposit | full_payment
  customer TEXT NOT NULL,                     -- json: name, phone, email
  vehicle_snapshot TEXT,
  amount INTEGER NOT NULL,
  currency TEXT DEFAULT 'KES',
  method TEXT NOT NULL DEFAULT 'mpesa',       -- mpesa | card | bank_transfer | cash
  status TEXT NOT NULL DEFAULT 'pending',     -- pending | paid | failed | cancelled | refunded
  provider_ref TEXT,
  receipt_no TEXT,
  hold_until TEXT,
  notes TEXT,
  utm TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  paid_at TEXT
);

CREATE TABLE IF NOT EXISTS payment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  message TEXT,
  payload TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

/* ---------- additive migrations ----------
   New columns are added here rather than in SCHEMA so an existing database
   picks them up on the next boot without being wiped. */
const MIGRATIONS = [
  ['vehicles', 'negotiable', 'INTEGER DEFAULT 0'],
  ['vehicles', 'verified', 'INTEGER DEFAULT 0'],
  ['vehicles', 'reg_status', "TEXT DEFAULT 'registered'"], // registered | awaiting_registration | in_transit
  ['vehicles', 'reg_expected_date', 'TEXT'],
  ['vehicles', 'source_ref', 'TEXT'],
  ['vehicles', 'warranty_months', 'INTEGER DEFAULT 0'],
  /* Enthusiast spec sheet. All nullable on purpose: lib/performance.js estimates every one
     of these from engine size, body and weight, and a stored value overrides the estimate.
     A yard that has the logbook types the real number in; one that does not, leaves it. */
  ['vehicles', 'power_hp', 'INTEGER'],
  ['vehicles', 'torque_nm', 'INTEGER'],
  ['vehicles', 'zero_to_100', 'REAL'],
  ['vehicles', 'top_speed', 'INTEGER'],
  ['vehicles', 'kerb_weight', 'INTEGER'],
  ['vehicles', 'rim_size', 'INTEGER'],
  ['vehicles', 'tyre_size', 'TEXT'],
  ['vehicles', 'boot_litres', 'INTEGER'],
  ['vehicles', 'fuel_tank', 'INTEGER'],
  ['vehicles', 'ground_clearance', 'INTEGER'],
  ['vehicles', 'seat_material', 'TEXT'],
  ['vehicles', 'screen_size', 'REAL'],
  ['vehicles', 'forced_induction', 'INTEGER'],
  ['vehicles', 'inspection', 'TEXT'], // JSON scorecard: exterior/interior/mechanical/tyres/electronics
  /* Firebase sign-in. `firebase_uid` is the link back to the Google account; `provider`
     records which button they used, which is the only way to tell someone why their
     password does not work when they signed up with Google. */
  /* Provenance. In Kenya these matter more than a Western history check: an outstanding
     logbook loan means the car is not the seller's to sell, and a TIMS record that does
     not match the logbook in your hand is the classic forecourt fraud. */
  ['vehicles', 'history', 'TEXT'], // JSON: logbookLoan, timsMatch, accidentFree, odometerVerified, importEntry, keepers
  /* What the yard does about the paperwork, and what it charges. */
  ['vehicles', 'transfer_included', 'INTEGER DEFAULT 0'],
  ['vehicles', 'transfer_fee', 'INTEGER'],
  /* A stated change-of-mind window. Cinch give 14 days, CarMax 10. Zero means none. */
  ['dealers', 'return_days', 'INTEGER DEFAULT 0'],
  ['dealers', 'return_terms', 'TEXT'],
  ['dealers', 'transfer_included', 'INTEGER DEFAULT 0'],
  /* Saved searches, so a customer who cannot find the car today hears when it lands. */
  ['users', 'firebase_uid', 'TEXT'],
  ['users', 'auth_provider', "TEXT DEFAULT 'password'"],
  ['users', 'photo_url', 'TEXT'],
  ['dealers', 'locations_note', 'TEXT'],
  ['users', 'otp_hash', 'TEXT'],
  ['users', 'otp_expires', 'TEXT'],
  ['applications', 'offer_letter_ref', 'TEXT'],
  ['applications', 'offer_letter_at', 'TEXT'],
  ['leads', 'utm', 'TEXT'],
  ['applications', 'utm', 'TEXT'],
  ['prequalifications', 'utm', 'TEXT'],
];
for (const [table, column, decl] of MIGRATIONS) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
}

/* One Google account maps to exactly one MotoKE user. Without this, a race between two
   simultaneous sign-ins creates two rows for the same person and the second one silently
   loses their saved cars. Partial index: password users have no firebase_uid. */
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_firebase ON users(firebase_uid) WHERE firebase_uid IS NOT NULL');


/* ---------- tiny query helpers ---------- */
function all(sql, params = []) {
  return db.prepare(sql).all(...params);
}
function get(sql, params = []) {
  return db.prepare(sql).get(...params);
}
function run(sql, params = []) {
  return db.prepare(sql).run(...params);
}
function insert(table, obj) {
  const keys = Object.keys(obj);
  const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
  const r = db.prepare(sql).run(...keys.map((k) => obj[k]));
  return Number(r.lastInsertRowid);
}
function update(table, id, obj) {
  const keys = Object.keys(obj);
  if (!keys.length) return 0;
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`;
  const r = db.prepare(sql).run(...keys.map((k) => obj[k]), id);
  return Number(r.changes);
}
function setSetting(key, value) {
  run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [
    key,
    typeof value === 'string' ? value : JSON.stringify(value),
  ]);
}
function getSetting(key, fallback = null) {
  const row = get('SELECT value FROM settings WHERE key=?', [key]);
  return row ? row.value : fallback;
}
function audit(action, entity, entityId, detail, user) {
  insert('audit_log', {
    user_id: user ? user.id : null,
    actor: user ? `${user.name} (${user.role})` : 'system',
    action,
    entity: entity || null,
    entity_id: entityId == null ? null : String(entityId),
    detail: detail ? (typeof detail === 'string' ? detail : JSON.stringify(detail)) : null,
  });
}

module.exports = { db, all, get, run, insert, update, setSetting, getSetting, audit, DB_PATH };
