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

/* Broker attribution.
 *
 * A broker's whole business is the introduction, and their whole fear is doing the work
 * and watching someone else collect: the bank's own agent takes the customer, or the
 * client they walked round the yard buys a different car through somebody else.
 *
 * This is the record that settles it. The broker registers a client BEFORE the
 * introduction, and from then until claim_expires any lead, booking or application on
 * that phone number belongs to them - whatever car it turns out to be, whichever branch
 * keys it in.
 *
 * The key is the PHONE NUMBER, not a browser cookie. A cookie is useless here: Kenyan
 * buyers browse on a friend's handset, arrive through WhatsApp's in-app browser, and come
 * back on a laptop three weeks later. One phone number survives all of that, and
 * sec.V.phone() already normalises 07.., 254.. and +254.. to a single shape.
 *
 * First touch wins. A second broker registering the same number does not displace the
 * first, because the person who made the introduction is the one owed for it. */
CREATE TABLE IF NOT EXISTS broker_clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dealer_id INTEGER NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
  broker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,              -- normalised +254..., the attribution key
  name TEXT NOT NULL,
  note TEXT,                        -- what the broker is looking for on their behalf
  claim_expires TEXT NOT NULL,      -- first touch holds for this long, then it is open again
  confirmed_by_client INTEGER DEFAULT 0,  -- the client tapped "yes, they introduced me"
  created_at TEXT DEFAULT (datetime('now'))
);
/* One live claim per number per dealership. The uniqueness IS the first-touch rule:
   a second broker registering the same client is refused rather than silently queued. */
CREATE UNIQUE INDEX IF NOT EXISTS idx_broker_claim ON broker_clients(dealer_id, phone);
CREATE INDEX IF NOT EXISTS idx_broker_clients_broker ON broker_clients(broker_id);

/* Broker verification.
 *
 * The industry's own associations say in public that they cannot tell a real broker from
 * a chancer who hovers at the gate and demands a fee on somebody else's sale. Nobody has
 * built the register, so this is it.
 *
 * The one rule that matters: the badge is EARNED, never bought. A registration fee proves
 * a man has the fee. If this platform calls someone verified and that someone defrauds a
 * client, the platform owns it - so the verified flag is computed from evidence every time
 * it is asked for, and there is deliberately no column anywhere that can be set to true.
 *
 * (No backticks in this comment on purpose: SCHEMA is a JS template literal and a stray
 *  backtick ends the string, which is a parse error a hundred lines further down.)
 */
CREATE TABLE IF NOT EXISTS broker_profiles (
  broker_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- Which dealership's site they signed up through. A record of where they came from,
  -- NOT a scope: a broker's identity and badge are platform-wide, because he works
  -- across yards and a register held by one yard is worth nothing to the next.
  dealer_id INTEGER REFERENCES dealers(id) ON DELETE SET NULL,
  id_number TEXT,                   -- encrypted at rest, like every other identifier here
  kra_pin TEXT,                     -- encrypted
  address TEXT,
  submitted_at TEXT,
  suspended INTEGER DEFAULT 0,      -- overrides everything below; a badge must be revocable
  suspended_reason TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

/* A dealership vouching for a broker it has actually dealt with. */
CREATE TABLE IF NOT EXISTS broker_references (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  broker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dealer_id INTEGER NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
  vouched_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  dealership_name TEXT NOT NULL,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
/* One dealership, one voucher. Without this a single friendly yard could file both
   references and the "two independent dealers" test would mean nothing. */
CREATE UNIQUE INDEX IF NOT EXISTS idx_broker_ref_once ON broker_references(broker_id, dealer_id);
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

/* Who signed the sale agreement, when, and WHICH VERSION OF IT.

   doc_hash is the point of this table. A signature on "the agreement" is worth nothing if
   nobody can say which text was on the screen at the time - the yard edits a price, the
   document regenerates, and the signature now sits under different terms. The hash is
   taken of the exact rendered agreement, so a later dispute is settled by comparing
   hashes rather than by two people remembering differently.

   BE HONEST ABOUT WHAT THIS IS. Kenyan law gives an ADVANCED electronic signature - one
   from a certification service provider licensed by the Communications Authority - the
   same standing as a wet signature. This is not that. It is a simple electronic signature
   with an audit trail: a one-time code to the phone number already on the application,
   the typed name, the time, the address it came from, and the hash of what was agreed.
   That is strong evidence of who agreed to what and it settles arguments; it is not the
   same as a certificated signature and the app must not pretend otherwise. */
CREATE TABLE IF NOT EXISTS signatures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dealer_id INTEGER NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  party TEXT NOT NULL,              -- buyer | seller
  name TEXT NOT NULL,               -- typed by the signer, not copied from the record
  signed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,  -- staff, for the seller side
  method TEXT NOT NULL DEFAULT 'otp',   -- otp | staff_session
  doc_hash TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  signed_at TEXT DEFAULT (datetime('now'))
);
/* One signature per side. A second one means something went wrong, and silently keeping
   both would leave a dispute with two answers. */
CREATE UNIQUE INDEX IF NOT EXISTS idx_signature_once ON signatures(application_id, party);

/* The insurance panel.

   The same shape as lenders, and for the same reason: two insurers disagree about what a
   risk is worth, and a quote engine that averages them away has nothing to sell. Every
   number a quote is built from lives on the insurer's own row.

   commission_pct is capped at 10 by lib/insurance.js whatever is stored here - that is
   the Eleventh Schedule of the Insurance Regulations and it is not ours to raise. */
CREATE TABLE IF NOT EXISTS insurers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  short_name TEXT,
  logo_text TEXT,
  color TEXT DEFAULT '#1e3a5f',
  active INTEGER DEFAULT 1,
  comprehensive_rate REAL NOT NULL DEFAULT 4.0,   -- % of sum insured, per year
  min_premium INTEGER DEFAULT 25000,
  third_party_premium INTEGER DEFAULT 7500,
  age_loading_from_years INTEGER DEFAULT 8,
  age_loading_pct REAL DEFAULT 0.15,              -- added to the rate per year over the threshold
  ncd_pct_per_year REAL DEFAULT 10,               -- no-claims discount earned per clean year
  ncd_max_pct REAL DEFAULT 30,
  excess_pct REAL DEFAULT 2.5,                    -- what the owner pays on a claim
  excess_min INTEGER DEFAULT 20000,
  max_vehicle_age_years INTEGER DEFAULT 15,
  min_sum_insured INTEGER DEFAULT 0,
  max_sum_insured INTEGER DEFAULT 0,              -- 0 means no ceiling
  commission_pct REAL DEFAULT 10,
  claim_days INTEGER DEFAULT 21,
  approved_garages INTEGER DEFAULT 0,
  highlights TEXT DEFAULT '[]',
  excludes TEXT DEFAULT '[]',
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  -- What this insurer is paying for, and until when. A slot sold is a slot promised.
  slot_exclusive INTEGER DEFAULT 0,
  slot_until TEXT,
  monthly_fee INTEGER DEFAULT 0,
  notes TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

/* A policy, from the moment a buyer accepts a quote to the moment it renews or lapses.

   NOTE WHAT IS NOT HERE: there is no premium_paid column, no payment reference, no
   provider. Section 156(2) of the Insurance Act forbids an intermediary from receiving
   premium on behalf of an insurer - 20% of the unremitted premium and a criminal offence
   for a director. The buyer pays the insurer directly and this table records that it
   happened, nothing more. Do not add a payment column here. */
CREATE TABLE IF NOT EXISTS policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT UNIQUE NOT NULL,
  dealer_id INTEGER NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
  insurer_id INTEGER NOT NULL REFERENCES insurers(id) ON DELETE RESTRICT,
  application_id INTEGER REFERENCES applications(id) ON DELETE SET NULL,
  vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  introduced_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  vehicle_title TEXT,
  cover TEXT NOT NULL DEFAULT 'comprehensive',    -- comprehensive | third_party
  sum_insured INTEGER NOT NULL DEFAULT 0,
  premium INTEGER NOT NULL DEFAULT 0,
  addons TEXT DEFAULT '[]',
  commission_pct REAL DEFAULT 0,
  commission INTEGER DEFAULT 0,
  -- requested: the buyer chose it. accepted: the insurer took it on.
  -- active: the cover note exists. lapsed / cancelled / renewed speak for themselves.
  status TEXT NOT NULL DEFAULT 'requested',
  policy_no TEXT,
  starts TEXT,
  expiry TEXT,
  renewal_of INTEGER REFERENCES policies(id) ON DELETE SET NULL,
  quote_snapshot TEXT,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_policies_expiry ON policies(dealer_id, status, expiry);

/* An issued statement, frozen.

   This is the whole point of storing it rather than recomputing it. A live query re-run in
   March gives a different answer for January than it gave in February - a deal was
   cancelled, a price corrected, a policy lapsed - and an invoice whose total moves after
   it has been sent is worthless. Issuing writes the lines and the total in, and everything
   afterwards reads the snapshot.

   One statement per payer per period, enforced by the index rather than by remembering:
   invoicing the same bank twice for the same month is the one mistake that costs you the
   relationship rather than the money. */
CREATE TABLE IF NOT EXISTS statements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT UNIQUE NOT NULL,
  dealer_id INTEGER NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
  payer_type TEXT NOT NULL,        -- bank | dealer | insurer
  payer_id INTEGER,
  payer_name TEXT NOT NULL,
  period TEXT NOT NULL,            -- YYYY-MM
  lines TEXT NOT NULL,             -- json: the snapshot, never recomputed
  line_count INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  terms TEXT,
  due_by TEXT,
  status TEXT NOT NULL DEFAULT 'issued',   -- issued | paid | written_off
  paid_at TEXT,
  paid_ref TEXT,
  paid_amount INTEGER,
  issued_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_statement_once
  ON statements(dealer_id, payer_type, COALESCE(payer_id, 0), period);
`);

/* ---------- additive migrations ----------
   New columns are added here rather than in SCHEMA so an existing database
   picks them up on the next boot without being wiped. */
const MIGRATIONS = [
  /* Who introduced this customer, stamped once and never edited. The dealer sees it on
     the application; it is what a broker's commission claim rests on. Nullable because
     most business still walks in off the street. */
  ['applications', 'introduced_by', 'INTEGER'],
  ['applications', 'introduced_at', 'TEXT'],
  ['leads', 'introduced_by', 'INTEGER'],
  /* A broker's client checks are his working record, not the yard's. Stamped so he can
     pull up what he already ran for someone and so the same claim rule reaches the
     screen he actually uses every day. */
  ['prequalifications', 'introduced_by', 'INTEGER'],
  /* The logbook transfer, which is where a sale actually ends.
     NTSA's transfer is a two-party process on eCitizen: the seller starts it, the buyer
     approves, the digital logbook appears in about three working days and the physical
     one in seven to ten. In between, the buyer has paid for a car they do not legally own
     yet and rings the yard every day to ask where the logbook is. Nobody can answer,
     because nobody wrote down which of the four steps it reached. */
  ['applications', 'transfer_stage', 'TEXT'],
  ['applications', 'transfer_started_at', 'TEXT'],
  ['applications', 'transfer_note', 'TEXT'],
  ['bookings', 'introduced_by', 'INTEGER'],
  /* THE REST OF THE DEAL, after the finance is agreed.
     The application status says where the money is. These say whether the customer can
     actually drive away, which is a different question and the one the yard spends its
     day on. See lib/deal.js for why three of them are gates rather than reminders. */
  ['applications', 'balance_paid', 'INTEGER DEFAULT 0'],
  ['applications', 'balance_method', 'TEXT'],
  ['applications', 'balance_ref', 'TEXT'],
  ['applications', 'balance_paid_at', 'TEXT'],
  ['applications', 'balance_confirmed_by', 'INTEGER'],
  /* Insurance is the law, not a preference: a car may not be driven on a Kenyan road
     without at least third-party cover under Cap 405, and an uninsured car is impounded
     with the owner personally liable. So the yard records the cover before it releases
     the keys, and deal.js will not let it mark a handover without this. */
  ['applications', 'insurer', 'TEXT'],
  ['applications', 'insurance_policy', 'TEXT'],
  ['applications', 'insurance_expiry', 'TEXT'],
  ['applications', 'insurance_confirmed_at', 'TEXT'],
  ['applications', 'insurance_confirmed_by', 'INTEGER'],
  ['applications', 'collection_at', 'TEXT'],
  ['applications', 'collection_time', 'TEXT'],
  ['applications', 'collection_branch_id', 'INTEGER'],
  ['applications', 'handed_over_at', 'TEXT'],
  ['applications', 'handed_over_by', 'INTEGER'],
  ['applications', 'handover_note', 'TEXT'],
  /* The code that lets a buyer sign. Held on the application rather than on a user row
     because most buyers never create an account - the phone number on the application is
     the only identity there is, and it is the one the code goes to. */
  ['applications', 'sign_otp_hash', 'TEXT'],
  ['applications', 'sign_otp_expires', 'TEXT'],
  ['applications', 'sign_otp_tries', 'INTEGER DEFAULT 0'],
  /* The day the money actually moved, stamped once and never rewritten.
     Everything this platform invoices is counted from it, and a statement for a closed
     month must not be able to change because something happened in March. updated_at
     cannot do this job - it moves every time anybody touches the row. */
  ['applications', 'funded_at', 'TEXT'],
  /* An extra sum a yard will pay a broker for shifting THIS car.
     A car sitting 60 days is costing the dealer real money in interest and lost value.
     Rather than show a broker that carrying cost - which is the dealer's private
     position and would be a weapon in the wrong hands - the dealer converts it into an
     offer: move this one and there is more in it for you. The broker sees the offer and
     never the reason. */
  ['vehicles', 'broker_bonus', 'INTEGER DEFAULT 0'],
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
