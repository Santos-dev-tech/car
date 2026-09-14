'use strict';
/** MotoKE - JSON API. */
const crypto = require('node:crypto');
const { all, get, run, insert, update, audit, setSetting, getSetting } = require('./db');
const fin = require('./finance');
const own = require('./ownership');
const mkt = require('./market');
const sec = require('./security');
const perf = require('./performance');
const fb = require('./firebase');
const val = require('./valuation');
const invy = require('./inventory');
const brk = require('./broker');
const xfer = require('./transfer');
const jobs = require('./jobs');
const com = require('./commerce');
const deal = require('./deal');
const ins = require('./insurance');
const stmt = require('./statement');

/** Whole shillings, the way every page in this app prints them. */
const KES = (n) => 'KES ' + Math.round(Number(n) || 0).toLocaleString('en-KE');

const auth = require('./auth');

/** Owner-tunable running-cost / insurance rates, held in settings. */
function ownershipOpts() {
  const o = {};
  for (const k of Object.keys(own.DEFAULTS)) {
    const v = getSetting('cost_' + k, null);
    if (v !== null) o[k] = v;
  }
  return o;
}

/**
 * Current pump prices, so range-per-tank and economy agree with the Running Cost tab.
 * Cached for a second: shaping a page of 50 vehicles would otherwise re-read every
 * running-cost setting 50 times over.
 */
let _prices = null;
let _pricesAt = 0;
function fuelPrices() {
  const now = Date.now();
  if (!_prices || now - _pricesAt > 1000) {
    _prices = own.settings(ownershipOpts());
    _pricesAt = now;
  }
  return _prices;
}

const J = (v, fallback) => fin.safeJson(v, fallback);
const num = (v, d = 0) => (v === '' || v == null || isNaN(Number(v)) ? d : Number(v));
const str = (v) => (v == null ? null : String(v).trim());
const bool = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);

class ApiError extends Error {
  constructor(status, message, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}
const bad = (m, d) => new ApiError(400, m, d);
const notFound = (m = 'Not found') => new ApiError(404, m);
const denied = (m = 'Not authorised') => new ApiError(403, m);

/* ------------------------------------------------------------------ */
/* shaping                                                             */
/* ------------------------------------------------------------------ */

function shapeVehicle(v, opts = {}) {
  if (!v) return null;
  const base = {
    ...v,
    images: J(v.images, []),
    features: J(v.features, []),
    inspection: J(v.inspection, null),
    history: J(v.history, null),
    transfer_included: !!v.transfer_included,
    featured: !!v.featured,
    duty_paid: !!v.duty_paid,
    title: `${v.year} ${v.make} ${v.model}${v.variant ? ' ' + v.variant : ''}`,
    age: fin.vehicleAge(v),
  };
  // The spec sheet is pure arithmetic over the row, so it costs nothing to attach.
  // Lists get the four figures a card shows; the detail page gets everything.
  const sheet = perf.specSheet(base, mkt.economy({ ...base, ageYears: base.age }, fuelPrices()));
  base.specs = opts.full
    ? sheet
    : {
        hp: sheet.performance.hp,
        torqueNm: sheet.performance.torqueNm,
        zeroTo100: sheet.performance.zeroTo100,
        rimSize: sheet.chassis.rimSize,
        aspiration: sheet.performance.aspiration,
        inspectionScore: sheet.inspection.overall,
        estimated: sheet.estimated,
      };
  return base;
}
function shapeLender(l) {
  if (!l) return null;
  return {
    ...l,
    active: !!l.active,
    allowed_employment: J(l.allowed_employment, []),
    allowed_conditions: J(l.allowed_conditions, []),
    requirements: J(l.requirements, []),
    capitalize_fees: !!l.capitalize_fees,
    insurance_financed: !!l.insurance_financed,
    requires_clean_crb: !!l.requires_clean_crb,
  };
}
const ENCRYPTED_APPLICANT_FIELDS = ['idNumber', 'kraPin', 'dob'];

/**
 * @param opts.reveal  staff see the real identifiers; anyone else gets them masked
 */
function shapeApplication(a, opts = {}) {
  if (!a) return null;
  const applicant = sec.decryptFields(J(a.applicant, {}), ENCRYPTED_APPLICANT_FIELDS);
  if (!opts.reveal) {
    if (applicant.idNumber) applicant.idNumber = sec.mask(applicant.idNumber);
    if (applicant.kraPin) applicant.kraPin = sec.mask(applicant.kraPin);
    delete applicant.dob;
  }
  const out = {
    ...a,
    applicant,
    employment: J(a.employment, {}),
    offer: J(a.offer, {}),
    vehicle_snapshot: J(a.vehicle_snapshot, {}),
    utm: J(a.utm, null),
  };
  /* The signing code's hash must never leave the server. It is an HMAC of six digits -
     trivially reversed offline by anyone who has it - and whoever recovers the code can
     sign the sale agreement in the buyer's name. This shaper spreads the whole row, so
     without this line every staff member reading an application is handed it. */
  delete out.sign_otp_hash;
  delete out.sign_otp_expires;
  delete out.sign_otp_tries;
  if (opts.withEvents) {
    out.events = all('SELECT * FROM application_events WHERE application_id=? ORDER BY id DESC', [a.id]);
    out.documents = all(
      'SELECT id, doc_type, filename, mime, size, uploaded_at FROM application_documents WHERE application_id=? ORDER BY id',
      [a.id]
    );
  }
  return out;
}

/**
 * The one dealership this deployment serves. Each dealer gets their own install, so the
 * storefront never exposes a switcher and a client cannot ask for another yard's data —
 * this is a row-level boundary, not just a hidden menu.
 */
function siteDealer() {
  const slug = getSetting('site_dealer', null);
  if (slug) {
    const d = get('SELECT * FROM dealers WHERE slug=?', [slug]);
    if (d) return d;
  }
  return get('SELECT * FROM dealers WHERE active=1 ORDER BY id LIMIT 1');
}

/**
 * @param q     request query or body
 * @param opts  { any:true } lets platform-level admin tooling address other dealerships
 */
function resolveDealer(q, opts = {}) {
  if (!opts.any) return siteDealer();
  if (q && q.dealer) {
    const found = /^\d+$/.test(String(q.dealer))
      ? get('SELECT * FROM dealers WHERE id=?', [Number(q.dealer)])
      : get('SELECT * FROM dealers WHERE slug=?', [String(q.dealer)]);
    if (found) return found;
  }
  if (q && q.dealerId) return get('SELECT * FROM dealers WHERE id=?', [Number(q.dealerId)]);
  return siteDealer();
}

function lendersForDealer(dealerId, includeInactive = false) {
  const rows = all(
    `SELECT l.* FROM lenders l
     LEFT JOIN dealer_lenders dl ON dl.lender_id = l.id AND dl.dealer_id = ?
     WHERE (? = 1 OR l.active = 1)
       AND (dl.dealer_id IS NULL OR dl.enabled = 1)
     ORDER BY l.sort_order, l.id`,
    [dealerId || 0, includeInactive ? 1 : 0]
  );
  return rows;
}

const DOC_TYPES = ['id', 'kra_pin', 'payslip', 'bank_statement', 'mpesa_statement', 'business_permit', 'logbook', 'other'];

const APP_STATUSES = [
  'new',
  'documents_pending',
  'under_review',
  'submitted_to_lender',
  'approved',
  'declined',
  'disbursed',
  'delivered',
  'cancelled',
];

function newRef() {
  const d = new Date();
  const y = String(d.getFullYear()).slice(2);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `MK-${y}${m}-${rand}`;
}

/* ------------------------------------------------------------------ */
/* quoting                                                             */
/* ------------------------------------------------------------------ */

function buildQuoteInput(body) {
  const dealer = resolveDealer(body);
  if (!dealer) throw bad('No dealership configured');
  let vehicle = null;
  let price = num(body.price);
  if (body.vehicleId) {
    vehicle = get('SELECT * FROM vehicles WHERE id=?', [Number(body.vehicleId)]);
    if (!vehicle) throw notFound('Vehicle not found');
    price = vehicle.price;
  }
  if (!price) throw bad('A vehicle or a price is required');

  const a = body.applicant || {};
  const applicant = {
    netIncome: num(a.netIncome),
    obligations: num(a.obligations),
    employment: str(a.employment) || null,
    crbClean: a.crbClean === false || a.crbClean === 'false' ? false : a.crbClean === undefined ? undefined : true,
    age: num(a.age) || null,
  };
  const depositPct = num(body.depositPct, NaN);
  const deposit = !isNaN(depositPct) && body.deposit == null ? Math.round((price * depositPct) / 100) : num(body.deposit);

  return {
    dealer,
    vehicle,
    input: {
      price,
      deposit,
      tenorMonths: num(body.tenor || body.tenorMonths, 48),
      vehicle: vehicle ? shapeVehicle(vehicle) : body.vehicle || null,
      applicant,
    },
  };
}

/* ------------------------------------------------------------------ */
/* routes                                                              */
/* ------------------------------------------------------------------ */

const routes = [];
const route = (method, pattern, handler, opts = {}) => routes.push({ method, pattern, handler, ...opts });

/* ---------- bootstrap / catalogue ---------- */

route('GET', '/api/bootstrap', (ctx) => {
  const dealer = resolveDealer(ctx.query);
  if (!dealer) return { dealer: null, facets: {}, lenders: [] };
  const fuel = jobs.fuelStatus();
  return {
    // one dealership per deployment — no switcher, no other yard's data
    dealer: sec.pick(dealer, [
      'id', 'slug', 'name', 'tagline', 'logo_text', 'primary_color', 'accent_color',
      'phone', 'whatsapp', 'email', 'address', 'city', 'about',
    ]),
    branches: all('SELECT id, name, city, address, phone FROM branches WHERE dealer_id=? AND active=1', [dealer.id]),
    facets: facets(dealer.id),
    lenders: lendersForDealer(dealer.id).map(shapeLender),
    platform: {
      name: getSetting('platform_name', 'MotoKE'),
      currency: getSetting('currency', 'KES'),
      lastUpdated: getSetting('content_updated_at', null) || getSetting('seeded_at', null),
      fuel: { petrol: fuel.petrol, diesel: fuel.diesel, asAt: fuel.asAt, age: fuel.age },
    },
    /* Every value here is public by design — a Firebase web config is an identifier, not
       a secret. It comes from the server rather than being typed into a JS file so the
       same bundle runs against dev and production without an edit. Null when Firebase is
       off, and the client hides the social buttons rather than rendering dead ones. */
    firebase: fb.clientConfig(),
    user: ctx.user ? sec.pick(ctx.user, ['id', 'name', 'email', 'role', 'dealer_id', 'photo_url', 'auth_provider']) : null,
  };
});

/** Pump prices and how fresh they are — shown as a footnote wherever fuel cost appears. */
route('GET', '/api/fuel', () => {
  const s = jobs.fuelStatus();
  return sec.pick(s, ['petrol', 'diesel', 'kerosene', 'asAt', 'age', 'nextEpraCycle', 'autoUpdate']);
});

function facets(dealerId) {
  const w = dealerId ? "WHERE dealer_id=? AND status='available'" : "WHERE status='available'";
  const p = dealerId ? [dealerId] : [];
  const col = (c) => all(`SELECT ${c} AS v, COUNT(*) AS n FROM vehicles ${w} AND ${c} IS NOT NULL GROUP BY ${c} ORDER BY n DESC`, p);
  const range = get(`SELECT MIN(price) AS minPrice, MAX(price) AS maxPrice, MIN(year) AS minYear, MAX(year) AS maxYear FROM vehicles ${w}`, p);
  const makes = all(
    `SELECT make AS v, COUNT(*) AS n FROM vehicles ${w} GROUP BY make ORDER BY n DESC`, p
  ).map((m) => ({
    ...m,
    models: all(`SELECT model AS v, COUNT(*) AS n FROM vehicles ${w} AND make=? GROUP BY model ORDER BY n DESC`, [...p, m.v]),
  }));
  return {
    makes,
    bodyTypes: col('body_type'),
    fuels: col('fuel'),
    transmissions: col('transmission'),
    conditions: col('condition'),
    drivetrains: col('drivetrain'),
    seats: col('seats'),
    range: range || {},
  };
}
route('GET', '/api/facets', (ctx) => {
  const d = resolveDealer(ctx.query);
  return facets(d ? d.id : null);
});

route('GET', '/api/dealers', () => all('SELECT * FROM dealers ORDER BY id'));

route('GET', '/api/vehicles', (ctx) => {
  const q = ctx.query;
  const where = [];
  const params = [];
  // always scoped to this deployment's dealership, whatever the client asks for
  const d = resolveDealer(q);
  if (d) {
    where.push('v.dealer_id = ?');
    params.push(d.id);
  }
  // the public catalogue only ever exposes sellable stock; drafts stay internal
  where.push(q.status && ['available', 'reserved', 'sold'].includes(q.status) ? 'v.status = ?' : "v.status = 'available'");
  if (q.status && ['available', 'reserved', 'sold'].includes(q.status)) params.push(q.status);

  const like = (col, val) => {
    where.push(`${col} = ?`);
    params.push(val);
  };
  if (q.make) like('v.make', q.make);
  if (q.model) like('v.model', q.model);
  if (q.body) like('v.body_type', q.body);
  if (q.fuel) like('v.fuel', q.fuel);
  if (q.transmission) like('v.transmission', q.transmission);
  if (q.condition) like('v.condition', q.condition);
  if (q.drivetrain) like('v.drivetrain', q.drivetrain);
  if (q.branchId) like('v.branch_id', Number(q.branchId));
  if (q.featured) where.push('v.featured = 1');
  if (q.minPrice) {
    where.push('v.price >= ?');
    params.push(num(q.minPrice));
  }
  if (q.maxPrice) {
    where.push('v.price <= ?');
    params.push(num(q.maxPrice));
  }
  if (q.minYear) {
    where.push('v.year >= ?');
    params.push(num(q.minYear));
  }
  if (q.maxYear) {
    where.push('v.year <= ?');
    params.push(num(q.maxYear));
  }
  if (q.maxMileage) {
    where.push('v.mileage_km <= ?');
    params.push(num(q.maxMileage));
  }
  if (q.seats) {
    where.push('v.seats >= ?');
    params.push(num(q.seats));
  }
  if (q.q) {
    where.push('(v.make LIKE ? OR v.model LIKE ? OR v.variant LIKE ? OR v.description LIKE ? OR v.color LIKE ?)');
    const s = `%${q.q}%`;
    params.push(s, s, s, s, s);
  }

  // "what can I afford" filter: monthly budget -> max price at a reference offer
  if (q.maxMonthly) {
    const budget = num(q.maxMonthly);
    const tenor = num(q.budgetTenor, 48);
    const depositPct = num(q.budgetDepositPct, 20);
    const rate = num(q.budgetRate, 14) / 100 / 12;
    const maxPrincipal = rate ? (budget * (1 - Math.pow(1 + rate, -tenor))) / rate : budget * tenor;
    const maxPrice = Math.round(maxPrincipal / (1 - depositPct / 100));
    where.push('v.price <= ?');
    params.push(maxPrice);
  }

  const sorts = {
    newest: 'v.created_at DESC, v.id DESC',
    price_asc: 'v.price ASC',
    price_desc: 'v.price DESC',
    year_desc: 'v.year DESC',
    mileage_asc: 'v.mileage_km ASC',
    featured: 'v.featured DESC, v.price DESC',
    popular: 'v.views DESC',
  };
  const order = sorts[q.sort] || sorts.featured;
  const page = Math.max(1, num(q.page, 1));
  const pageSize = Math.min(60, Math.max(1, num(q.pageSize, 12)));

  const sql = `SELECT v.*, d.name AS dealer_name, d.slug AS dealer_slug, b.name AS branch_name, b.city AS branch_city
               FROM vehicles v
               JOIN dealers d ON d.id = v.dealer_id
               LEFT JOIN branches b ON b.id = v.branch_id
               WHERE ${where.join(' AND ')}
               ORDER BY ${order} LIMIT ? OFFSET ?`;
  const items = all(sql, [...params, pageSize, (page - 1) * pageSize]).map(shapeVehicle);
  const total = get(`SELECT COUNT(*) AS n FROM vehicles v WHERE ${where.join(' AND ')}`, params).n;
  return { items, total, page, pageSize, pages: Math.ceil(total / pageSize) };
});

route('GET', /^\/api\/vehicles\/(\d+)$/, (ctx) => {
  const id = Number(ctx.params[0]);
  const v = get(
    `SELECT v.*, d.name AS dealer_name, d.slug AS dealer_slug, d.phone AS dealer_phone, d.whatsapp AS dealer_whatsapp,
            b.name AS branch_name, b.city AS branch_city, b.address AS branch_address
     FROM vehicles v JOIN dealers d ON d.id=v.dealer_id LEFT JOIN branches b ON b.id=v.branch_id
     WHERE v.id=?`,
    [id]
  );
  if (!v) throw notFound('Vehicle not found');
  const site = siteDealer();
  if (site && v.dealer_id !== site.id) throw notFound('Vehicle not found');
  if (v.status === 'draft') throw notFound('Vehicle not found');
  run('UPDATE vehicles SET views = views + 1 WHERE id=?', [id]);
  const similar = all(
    `SELECT * FROM vehicles WHERE dealer_id=? AND id<>? AND status='available'
       AND (body_type=? OR make=?) ORDER BY ABS(price - ?) LIMIT 4`,
    [v.dealer_id, id, v.body_type, v.make, v.price]
  ).map(shapeVehicle);
  /* Priced against this yard's own comparable stock. Drafts are excluded — an unpublished
     car is not evidence of anything — and so is the car being priced. */
  const pool = all(
    `SELECT id, make, model, year, price, body_type, condition, mileage_km
     FROM vehicles WHERE dealer_id=? AND status<>'draft' AND id<>?`,
    [v.dealer_id, id]
  );

  const dealer = get('SELECT return_days, return_terms, transfer_included FROM dealers WHERE id=?', [v.dealer_id]) || {};

  return {
    vehicle: shapeVehicle(v, { full: true }),
    similar,
    priceCheck: val.priceIndicator(v, pool),
    /* The variant matters: this car's own body, fuel and engine, not just the badge. */
    futureValue: val.futureValue(v.price, v.make, 3, fin.vehicleAge(v), {
      bodyType: v.body_type,
      fuel: v.fuel,
      engineCc: v.engine_cc,
    }),
    history: shapeHistory(J(v.history, null)),
    /* What the yard promises, alongside what this particular car costs to transfer.
       Both belong on the listing: a return window nobody can find is not a promise. */
    promise: {
      returnDays: Number(dealer.return_days) || 0,
      returnTerms: dealer.return_terms || null,
      warrantyMonths: Number(v.warranty_months) || 0,
      transferIncluded: !!(v.transfer_included || dealer.transfer_included),
      transferFee: v.transfer_fee == null ? null : Number(v.transfer_fee),
    },
    lenders: lendersForDealer(v.dealer_id).map(shapeLender),
  };
});

route('GET', '/api/lenders', (ctx) => {
  const d = resolveDealer(ctx.query);
  return lendersForDealer(d ? d.id : null).map(shapeLender);
});

/* ---------- the finance engine endpoints ---------- */

route('POST', '/api/quote', (ctx) => {
  const { dealer, vehicle, input } = buildQuoteInput(ctx.body);
  let lenders = lendersForDealer(dealer.id);
  if (ctx.body.lenderTypes && Array.isArray(ctx.body.lenderTypes) && ctx.body.lenderTypes.length) {
    lenders = lenders.filter((l) => ctx.body.lenderTypes.includes(l.type));
  }
  if (ctx.body.lenderIds && Array.isArray(ctx.body.lenderIds) && ctx.body.lenderIds.length) {
    lenders = lenders.filter((l) => ctx.body.lenderIds.includes(l.id));
  }
  if (!lenders.length) throw bad('No lenders configured for this dealership');
  const result = fin.compare(lenders, input, str(ctx.body.sortBy) || 'monthly');
  return {
    ...result,
    dealer: { id: dealer.id, name: dealer.name, slug: dealer.slug },
    vehicle: vehicle ? shapeVehicle(vehicle) : null,
    request: { price: input.price, deposit: input.deposit, tenorMonths: input.tenorMonths, applicant: input.applicant },
  };
});

route('POST', '/api/quote/schedule', (ctx) => {
  const b = ctx.body;
  const lender = get('SELECT * FROM lenders WHERE id=?', [Number(b.lenderId)]);
  if (!lender) throw notFound('Lender not found');
  const { input } = buildQuoteInput(b);
  const q = fin.quote(lender, input);
  return { quote: q, schedule: fin.schedule(q.principal, lender.annual_rate, q.tenorMonths, q.rateType) };
});

/** Affordability: given income, what price band and which lenders open up. */
route('POST', '/api/affordability', (ctx) => {
  const dealer = resolveDealer(ctx.body);
  if (!dealer) throw bad('No dealership configured');
  const netIncome = num(ctx.body.netIncome);
  const obligations = num(ctx.body.obligations);
  const tenor = num(ctx.body.tenor, 48);
  const deposit = num(ctx.body.deposit);
  if (!netIncome) throw bad('Net monthly income is required');
  const lenders = lendersForDealer(dealer.id);
  const results = lenders
    .map((l) => {
      const q = fin.quote(l, {
        price: Math.max(deposit + l.min_loan, 1000000),
        deposit,
        tenorMonths: tenor,
        applicant: { netIncome, obligations, employment: str(ctx.body.employment), crbClean: ctx.body.crbClean !== false },
      });
      return { lender: q.lender, maxPrice: q.maxAffordablePrice, minDepositPct: l.min_deposit_pct, rate: l.annual_rate, rateType: q.rateType };
    })
    .filter((r) => r.maxPrice)
    .sort((a, b2) => b2.maxPrice - a.maxPrice);
  const best = results.length ? results[0].maxPrice : 0;
  const matches = best
    ? all("SELECT * FROM vehicles WHERE dealer_id=? AND status='available' AND price <= ? ORDER BY price DESC LIMIT 8", [dealer.id, best]).map(shapeVehicle)
    : [];
  return { netIncome, obligations, tenor, deposit, lenders: results, budget: best, matches };
});

/* ---------- running cost, insurance, pre-qualification ---------- */

/** Total cost of ownership: it is not just the monthly payment. */
route('POST', '/api/running-cost', (ctx) => {
  const b = ctx.body;
  let vehicle = null;
  let price = num(b.price);
  let engineLitres = num(b.engineLitres, 1.5);
  let fuel = str(b.fuel) || 'petrol';
  let ageYears = num(b.ageYears, 0);
  let bodyType = str(b.bodyType);
  let drivetrain = str(b.drivetrain);
  let make = str(b.make);

  if (b.vehicleId) {
    vehicle = get('SELECT * FROM vehicles WHERE id=?', [Number(b.vehicleId)]);
    if (!vehicle) throw notFound('Vehicle not found');
    // the vehicle's own price always wins — it is the dealership's price, not an input
    price = vehicle.price;
    if (vehicle.engine_cc) engineLitres = Math.round((vehicle.engine_cc / 1000) * 10) / 10;
    fuel = String(vehicle.fuel || 'petrol').toLowerCase();
    ageYears = fin.vehicleAge(vehicle);
    bodyType = vehicle.body_type;
    drivetrain = vehicle.drivetrain;
    make = vehicle.make;
  }
  if (!price) throw bad('A vehicle or a price is required');

  // when the buyer wants the loan folded in, quote the cheapest lender that fits
  let loan = null;
  if (b.includeLoan) {
    const dealer = resolveDealer(b);
    const lenders = dealer ? lendersForDealer(dealer.id) : [];
    if (lenders.length) {
      const cmp = fin.compare(lenders, {
        price,
        deposit: num(b.deposit, Math.round(price * 0.2)),
        tenorMonths: num(b.tenor, 48),
        vehicle: vehicle ? shapeVehicle(vehicle) : { year: new Date().getFullYear() - ageYears },
        applicant: {},
      });
      const pick = b.lenderId ? cmp.offers.find((o) => o.lenderId === Number(b.lenderId)) : cmp.offers.find((o) => o.eligible) || cmp.offers[0];
      if (pick) loan = { monthlyPayment: pick.monthlyPayment, tenorMonths: pick.tenorMonths, lender: pick.lender };
    }
  }

  const result = own.runningCost(
    {
      price,
      engineLitres,
      fuel,
      bodyType,
      drivetrain,
      make,
      kmPerYear: num(b.kmPerYear, 15000),
      ageYears,
      comprehensive: b.comprehensive !== false,
      includeLoan: !!b.includeLoan,
      addons: b.addons || {},
      loan,
    },
    ownershipOpts()
  );
  return {
    ...result,
    vehicle: vehicle ? shapeVehicle(vehicle) : null,
    loan,
    priceLocked: !!vehicle,
    fuelPricesAsAt: getSetting('cost_prices_as_at', null),
    fuelPriceAge: mkt.priceAge(getSetting('cost_prices_as_at', null)),
  };
});

/** Comprehensive vs third party, with the add-ons priced. */
route('POST', '/api/insurance', (ctx) => {
  const b = ctx.body;
  let value = num(b.value || b.price);
  let ageYears = num(b.ageYears, 0);
  let vehicle = null;
  if (b.vehicleId) {
    vehicle = get('SELECT * FROM vehicles WHERE id=?', [Number(b.vehicleId)]);
    if (!vehicle) throw notFound('Vehicle not found');
    value = vehicle.price;
    ageYears = fin.vehicleAge(vehicle);
  }
  if (!value) throw bad('A vehicle or a value is required');
  return { ...own.insurance({ value, ageYears, addons: b.addons || {} }, ownershipOpts()), vehicle: vehicle ? shapeVehicle(vehicle) : null };
});

/**
 * Pre-qualification: one form, every lender on the panel answers.
 * Stored so the dealership can work the lead.
 */
route('POST', '/api/prequalify', (ctx) => {
  const b = ctx.body;
  const dealer = resolveDealer(b);
  if (!dealer) throw bad('Unknown dealership');
  const bot = sec.botCheck(b);
  if (!bot.ok) throw new ApiError(429, 'That looked automated. Please try again.');
  const rl = sec.rateLimit(`prequal:${sec.clientIp(ctx.req)}`, 15, 60 * 60 * 1000);
  if (!rl.ok) throw new ApiError(429, 'Too many checks from this connection. Please call us.');

  const name = sec.V.string(b.name, { field: 'Name', min: 2, max: 120, required: true });
  const phone = sec.V.phone(b.phone, { required: true });
  const netIncome = sec.V.money(b.netIncome, { field: 'Net monthly income', required: true });
  if (!netIncome) throw bad('Net monthly income is required');

  let vehicle = b.vehicleId ? get('SELECT * FROM vehicles WHERE id=?', [Number(b.vehicleId)]) : null;
  const price = vehicle ? vehicle.price : num(b.targetPrice);
  if (!price) throw bad('Tell us the car or a target price');

  const deposit = num(b.deposit, Math.round(price * 0.2));
  const tenor = num(b.tenor, 48);
  const applicant = {
    netIncome,
    obligations: num(b.obligations),
    employment: str(b.employment) || 'employed',
    crbClean: b.crbClean !== false,
    age: num(b.age) || null,
  };

  const lenders = lendersForDealer(dealer.id);
  if (!lenders.length) throw bad('No lenders configured for this dealership');
  const cmp = fin.compare(lenders, { price, deposit, tenorMonths: tenor, vehicle: vehicle ? shapeVehicle(vehicle) : null, applicant }, str(b.sortBy) || 'monthly');

  const eligible = cmp.offers.filter((o) => o.eligible);
  const ref = 'PQ-' + newRef().slice(3);
  const id = insert('prequalifications', {
    ref,
    dealer_id: dealer.id,
    vehicle_id: vehicle ? vehicle.id : null,
    name,
    phone,
    email: sec.V.email(b.email),
    id_number: b.idNumber ? sec.encrypt(sec.V.idNumber(b.idNumber)) : null,
    applicant: JSON.stringify(applicant),
    utm: b.utm ? JSON.stringify(b.utm).slice(0, 1000) : null,
    target_price: price,
    deposit,
    tenor_months: tenor,
    /* Resolved from the registry when the customer is already claimed, and otherwise
       from the signed-in broker running the check. The second case is what makes this
       screen his: he checks a client before anyone has registered anything. */
    introduced_by: brk.claimFor(dealer.id, applicant.phone)
      || (auth.isBroker(ctx.user) ? ctx.user.id : null),
    results: JSON.stringify(
      cmp.offers.map((o) => ({
        lenderId: o.lenderId,
        lender: o.lender.name,
        type: o.lender.type,
        eligible: o.eligible,
        monthlyPayment: o.monthlyPayment,
        apr: o.apr,
        blockers: o.blockers,
      }))
    ),
    approved_count: eligible.length,
    best_monthly: eligible.length ? Math.min(...eligible.map((o) => o.monthlyPayment)) : null,
  });
  audit('prequalify.create', 'prequalification', id, { ref, eligible: eligible.length }, ctx.user);

  return {
    ok: true,
    ref,
    id,
    eligibleCount: eligible.length,
    total: cmp.offers.length,
    offers: cmp.offers,
    vehicle: vehicle ? shapeVehicle(vehicle) : null,
    request: { price, deposit, tenor, applicant },
  };
});

/** FAQ content, partly generated from the live lender panel so it never goes stale. */
route('GET', '/api/faq', (ctx) => {
  const dealer = resolveDealer(ctx.query);
  const lenders = dealer ? lendersForDealer(dealer.id).map(shapeLender) : [];
  const minDeposit = lenders.length ? Math.min(...lenders.map((l) => l.min_deposit_pct)) : 20;
  const maxTenor = lenders.length ? Math.max(...lenders.map((l) => l.max_tenor_months)) : 60;
  const fastest = lenders.length ? Math.min(...lenders.map((l) => l.approval_days)) : 1;
  const banks = lenders.filter((l) => l.type === 'bank').length;
  const micro = lenders.filter((l) => l.type === 'microfinance').length;
  const saccos = lenders.filter((l) => l.type === 'sacco').length;
  const noCrb = lenders.filter((l) => !l.requires_clean_crb).map((l) => l.short_name || l.name);
  const maxAge = lenders.length ? Math.max(...lenders.map((l) => l.max_vehicle_age_years)) : 8;

  return [
    {
      q: 'How much deposit do I need?',
      a: `Deposits on this panel start at ${minDeposit}% of the vehicle price. Banks generally want 20–30%, saccos can go as low as ${minDeposit}% for members in good standing, and the dealer in-house plan asks the most. If you enter a deposit below a lender's floor we still quote you — at their minimum — and tell you the shortfall.`,
    },
    {
      q: 'What is the difference between a flat rate and a reducing balance rate?',
      a: 'A reducing balance rate charges interest only on what you still owe, so the interest falls every month. A flat rate charges interest on the original amount for the whole term. A 14% flat rate costs roughly what a 25% reducing rate costs — which is why every quote here shows a true APR, so you can compare the two honestly.',
    },
    {
      q: 'How long can I take to repay?',
      a: `Up to ${maxTenor} months on this panel. A longer term lowers the monthly payment but raises the total interest — the comparison screen shows both figures side by side so you can see the trade-off.`,
    },
    {
      q: 'How fast is approval?',
      a: `From ${fastest} working day${fastest === 1 ? '' : 's'} with the fastest lender on the panel, up to about two weeks for a sacco credit committee. Each offer card shows that lender's indicative turnaround.`,
    },
    {
      q: 'Can I get financing if I am listed on CRB?',
      a: noCrb.length
        ? `Yes, with some lenders. ${noCrb.slice(0, 4).join(', ')}${noCrb.length > 4 ? ' and others' : ''} do not require a clean CRB record. Banks on the panel do. Tick the CRB box honestly on the comparison screen and only lenders that would actually consider you will show as eligible.`
        : 'Every lender currently on this panel requires a clean CRB record.',
    },
    {
      q: 'Can I get financing if I am self-employed or earn from a business?',
      a: 'Yes. Set "How you earn" on the comparison screen and lenders that do not accept your income type drop out automatically, with the reason shown. Self-employed applicants are usually assessed on bank or M-Pesa statements rather than payslips.',
    },
    {
      q: 'How old can the car be?',
      a: `Up to ${maxAge} years with the most flexible lender here. Most banks stop at 8 years. If a car is too old for a lender, that lender's card says so rather than quietly disappearing.`,
    },
    {
      q: 'Who is on the finance panel?',
      a: `${banks} bank${banks === 1 ? '' : 's'}, ${micro} microfinance provider${micro === 1 ? '' : 's'} and ${saccos} sacco${saccos === 1 ? '' : 's'}${lenders.some((l) => l.type === 'inhouse') ? ', plus a dealer in-house plan' : ''}. Every one of them is quoted on every car — you do not choose the lender before you see the numbers.`,
    },
    {
      q: 'Do I have to insure the car comprehensively?',
      a: 'Yes, while it is under finance. Every lender on the panel requires comprehensive cover, and most will finance the first year’s premium alongside the loan so you are not paying it out of pocket on day one.',
    },
    {
      q: 'What else will the car cost me each month?',
      a: 'Fuel, insurance, servicing, tyres and licensing. The Running Cost tab adds all of those to the instalment so you see the real monthly figure before you commit, not just the loan repayment.',
    },
    {
      q: 'Are the figures on this site binding?',
      a: 'No. Everything here is an indicative quotation based on each lender’s published terms. Your final rate, fees and limit are set by the lender after they assess your documents and run their own credit checks.',
    },
    {
      q: 'What documents will I need?',
      a: 'At minimum a national ID, KRA PIN, recent bank or M-Pesa statements, and proof of income. Each lender’s full list is on its offer card, and you can upload them during the application.',
    },
  ];
});

/* ---------- applications ---------- */

route('POST', '/api/applications', (ctx) => {
  const b = ctx.body;
  const dealer = resolveDealer(b);
  if (!dealer) throw bad('Unknown dealership');
  const vehicle = b.vehicleId ? get('SELECT * FROM vehicles WHERE id=?', [Number(b.vehicleId)]) : null;
  if (b.vehicleId && !vehicle) throw notFound('Vehicle not found');
  const lender = get('SELECT * FROM lenders WHERE id=?', [Number(b.lenderId)]);
  if (!lender) throw bad('Choose a financing option');

  const bot = sec.botCheck(b);
  if (!bot.ok) throw new ApiError(429, 'That looked automated. Please try again.');
  const rl = sec.rateLimit(`apply:${sec.clientIp(ctx.req)}`, 10, 60 * 60 * 1000);
  if (!rl.ok) throw new ApiError(429, 'Too many applications from this connection. Please call us.');

  const rawApplicant = b.applicant || {};
  const e0 = b.employment || {};
  const a = {
    fullName: sec.V.string(rawApplicant.fullName, { field: 'Full name', min: 2, max: 120, required: true }),
    idNumber: sec.V.idNumber(rawApplicant.idNumber, { required: true }),
    phone: sec.V.phone(rawApplicant.phone, { required: true }),
    email: sec.V.email(rawApplicant.email),
    kraPin: sec.V.kraPin(rawApplicant.kraPin),
    dob: sec.V.date(rawApplicant.dob, { field: 'Date of birth' }),
    address: sec.stripTags(sec.V.string(rawApplicant.address, { max: 200 })),
    maritalStatus: sec.V.enum(rawApplicant.maritalStatus, ['single', 'married', 'other'], { fallback: 'other' }),
    age: sec.V.int(rawApplicant.age, { field: 'Age', min: 18, max: 90 }),
  };
  const e = {
    type: sec.V.enum(e0.type, ['employed', 'contract', 'self_employed', 'business', 'gig'], { field: 'Employment type', fallback: 'employed' }),
    employer: sec.stripTags(sec.V.string(e0.employer, { max: 120 })),
    position: sec.stripTags(sec.V.string(e0.position, { max: 120 })),
    yearsEmployed: sec.V.int(e0.yearsEmployed, { field: 'Years employed', min: 0, max: 60 }),
    netIncome: sec.V.money(e0.netIncome, { field: 'Net income', required: true }),
    obligations: sec.V.money(e0.obligations, { field: 'Existing repayments', fallback: 0 }) || 0,
    crbClean: e0.crbClean !== false,
  };

  const input = {
    price: vehicle ? vehicle.price : num(b.price),
    deposit: num(b.deposit),
    tenorMonths: num(b.tenor, 48),
    vehicle: vehicle ? shapeVehicle(vehicle) : null,
    applicant: {
      netIncome: num(e.netIncome),
      obligations: num(e.obligations),
      employment: str(e.type),
      crbClean: e.crbClean !== false,
      age: num(a.age) || null,
    },
  };
  const offer = fin.quote(lender, input);

  const ref = newRef();
  /* Stamped at creation and never edited afterwards. This is the record a broker's
     commission claim rests on, so it is resolved from the registry here rather than
     accepted from the request — a client could otherwise name whoever they liked, and
     so could anyone with the endpoint. */
  const introducedBy = brk.claimFor(dealer.id, a.phone);
  const id = insert('applications', {
    ref,
    dealer_id: dealer.id,
    introduced_by: introducedBy,
    introduced_at: introducedBy ? new Date().toISOString() : null,
    vehicle_id: vehicle ? vehicle.id : null,
    lender_id: lender.id,
    user_id: ctx.user ? ctx.user.id : null,
    // identifiers are encrypted at rest; a database dump alone yields no ID numbers
    applicant: JSON.stringify(sec.encryptFields(a, ['idNumber', 'kraPin', 'dob'])),
    employment: JSON.stringify(e),
    offer: JSON.stringify(offer),
    utm: b.utm ? JSON.stringify(b.utm).slice(0, 1000) : null,
    vehicle_snapshot: vehicle ? JSON.stringify(shapeVehicle(vehicle)) : null,
    price: input.price,
    deposit: offer.deposit,
    loan_amount: offer.principal,
    tenor_months: offer.tenorMonths,
    monthly_payment: offer.monthlyPayment,
    status: 'new',
  });
  insert('application_events', {
    application_id: id,
    type: 'created',
    actor: str(a.fullName) || 'Customer',
    message: `Application submitted for ${vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : 'a vehicle'} financed by ${lender.name}.`,
  });

  if (Array.isArray(b.documents) && b.documents.length) {
    let stored = 0;
    for (const d of b.documents.slice(0, 12)) {
      if (!d || !d.data) continue;
      const file = sec.validateUpload(d); // type, magic bytes and size all checked
      insert('application_documents', {
        application_id: id,
        doc_type: sec.V.enum(d.type, DOC_TYPES, { field: 'Document type', fallback: 'other' }),
        filename: file.filename,
        mime: file.mime,
        size: file.size,
        data: sec.encrypt(file.data), // customer documents are encrypted at rest
      });
      stored++;
    }
    if (stored) insert('application_events', { application_id: id, type: 'documents', actor: 'Customer', message: `${stored} document(s) uploaded.` });
  }

  if (vehicle && b.reserve) {
    update('vehicles', vehicle.id, { status: 'reserved', updated_at: new Date().toISOString() });
  }
  audit('application.create', 'application', id, { ref, lender: lender.name }, ctx.user);
  return { ok: true, id, ref, offer, status: 'new' };
});

route('POST', /^\/api\/applications\/(\d+)\/documents$/, (ctx) => {
  const id = Number(ctx.params[0]);
  const site = siteDealer();
  const app = get('SELECT * FROM applications WHERE id=?', [id]);
  if (!app || (site && app.dealer_id !== site.id)) throw notFound('Application not found');

  // Only the applicant (matched on their own phone number) or staff may attach files —
  // otherwise anyone could push documents onto someone else's application by guessing an id.
  const applicant = sec.decryptFields(J(app.applicant, {}), ENCRYPTED_APPLICANT_FIELDS);
  const digits = (s) => String(s || '').replace(/\D/g, '').slice(-9);
  const isStaff = auth.isStaff(ctx.user) && (ctx.user.role === 'superadmin' || Number(ctx.user.dealer_id) === Number(app.dealer_id));
  const isOwner = ctx.user && app.user_id === ctx.user.id;
  const phoneMatches = ctx.body.phone && digits(ctx.body.phone) === digits(applicant.phone);
  if (!isStaff && !isOwner && !phoneMatches) throw denied('Confirm the phone number on the application to attach documents');

  const rl = sec.rateLimit(`upload:${sec.clientIp(ctx.req)}`, 30, 60 * 60 * 1000);
  if (!rl.ok) throw new ApiError(429, 'Too many uploads. Please try again later.');

  const docs = Array.isArray(ctx.body.documents) ? ctx.body.documents : [ctx.body];
  let n = 0;
  for (const d of docs.slice(0, 12)) {
    if (!d || !d.data) continue;
    const file = sec.validateUpload(d);
    insert('application_documents', {
      application_id: id,
      doc_type: sec.V.enum(d.type, DOC_TYPES, { field: 'Document type', fallback: 'other' }),
      filename: file.filename,
      mime: file.mime,
      size: file.size,
      data: sec.encrypt(file.data),
    });
    n++;
  }
  if (n) insert('application_events', { application_id: id, type: 'documents', actor: 'Customer', message: `${n} document(s) uploaded.` });
  return { ok: true, added: n };
});

route('GET', '/api/applications/track', (ctx) => {
  const ref = str(ctx.query.ref);
  const phone = str(ctx.query.phone);
  if (!ref) throw bad('Reference number required');
  const site = siteDealer();
  const app = get('SELECT * FROM applications WHERE ref=?', [ref]);
  if (!app || (site && app.dealer_id !== site.id)) throw notFound('No application with that reference');
  const applicant = J(app.applicant, {});
  const digits = (s) => String(s || '').replace(/\D/g, '').slice(-9);
  if (phone && digits(applicant.phone) !== digits(phone)) throw denied('Phone number does not match this reference');
  const lender = app.lender_id ? get('SELECT name, short_name, logo_text, color, approval_days FROM lenders WHERE id=?', [app.lender_id]) : null;
  const shaped = shapeApplication(app, { withEvents: true });
  return {
    /* Needed by the upload page to post files against. Not a secret: every route that
       accepts it also demands the phone number on the application, so knowing an id on
       its own gets you nothing. */
    id: app.id,
    ref: app.ref,
    status: app.status,
    statusIndex: APP_STATUSES.indexOf(app.status),
    statuses: APP_STATUSES,
    created_at: app.created_at,
    updated_at: app.updated_at,
    lender,
    vehicle: shaped.vehicle_snapshot,
    offer: shaped.offer,
    events: shaped.events,
    documents: shaped.documents,
    applicant: { fullName: applicant.fullName, phone: applicant.phone },
    /* The logbook, which is the half of this the customer actually worries about.
       The transfer is a TWO-PARTY process on eCitizen and most buyers have no idea they
       have to do anything — they sit waiting for a logbook that is waiting for them.
       Attached to the tracker so the moment it is their move, they are told. */
    transfer: app.transfer_stage
      ? xfer.statusFor(app, app.vehicle_id ? get('SELECT engine_cc FROM vehicles WHERE id=?', [app.vehicle_id]) : null)
      : null,
  };
});

/* ---------- e-commerce: reserve a car online ---------- */

/** What it costs to hold this car, and for how long. */
route('GET', /^\/api\/checkout\/(\d+)$/, (ctx) => {
  const v = get('SELECT * FROM vehicles WHERE id=?', [Number(ctx.params[0])]);
  const site = siteDealer();
  if (!v || (site && v.dealer_id !== site.id)) throw notFound('Vehicle not found');
  const fee = com.bookingFee(v.price);
  return {
    vehicle: shapeVehicle(v),
    available: v.status === 'available',
    bookingFee: fee,
    holdDays: com.holdDays(),
    balance: v.price - fee,
    methods: [
      { key: 'mpesa', label: 'M-Pesa', note: 'A payment request is sent to your phone. Enter your PIN to authorise.', instant: true },
      { key: 'card', label: 'Card', note: 'Visa or Mastercard, through our payment gateway.', instant: true },
      { key: 'bank_transfer', label: 'Bank transfer', note: 'We send account details and confirm within one working day.', instant: false },
      { key: 'cash', label: 'Pay at the yard', note: 'Reserve now, pay when you come in. Held for 48 hours.', instant: false },
    ],
    terms: [
      `The booking deposit holds the vehicle for ${com.holdDays()} days and is credited against the purchase price.`,
      'It is refundable in full if the dealership cannot deliver the vehicle as described.',
      'It is not a contract of sale; the sale completes on full payment or on disbursement by your financier.',
    ],
  };
});

/** Create the order and kick off the payment. */
route('POST', '/api/checkout', async (ctx) => {
  const b = ctx.body;
  const dealer = resolveDealer(b);
  if (!dealer) throw bad('Unknown dealership');

  const bot = sec.botCheck(b);
  if (!bot.ok) throw new ApiError(429, 'That looked automated. Please try again.');
  const ip = sec.clientIp(ctx.req);
  const limit = sec.rateLimit(`checkout:${ip}`, 8, 60 * 60 * 1000);
  if (!limit.ok) throw new ApiError(429, 'Too many booking attempts. Please call us instead.');

  const vehicle = get('SELECT * FROM vehicles WHERE id=?', [num(b.vehicleId)]);
  if (!vehicle || vehicle.dealer_id !== dealer.id) throw notFound('Vehicle not found');
  if (vehicle.status !== 'available') throw bad('That vehicle is no longer available');

  const name = sec.V.string(b.name, { field: 'Name', min: 2, max: 120, required: true });
  const phone = sec.V.phone(b.phone, { required: true });
  const email = sec.V.email(b.email);
  const method = sec.V.enum(b.method, ['mpesa', 'card', 'bank_transfer', 'cash'], { field: 'Payment method', required: true });

  // The amount is computed here from the vehicle's own price. Whatever the client sends
  // is ignored, so the booking fee cannot be edited in the browser.
  const amount = com.bookingFee(vehicle.price);

  const ref = com.newOrderRef();
  const id = insert('orders', {
    ref,
    dealer_id: dealer.id,
    vehicle_id: vehicle.id,
    application_id: b.applicationId ? num(b.applicationId) : null,
    user_id: ctx.user ? ctx.user.id : null,
    kind: 'reservation',
    customer: JSON.stringify({ name, phone, email }),
    vehicle_snapshot: JSON.stringify(sec.pick(shapeVehicle(vehicle), ['id', 'title', 'make', 'model', 'year', 'price', 'images'])),
    amount,
    method,
    status: 'pending',
    notes: sec.stripTags(sec.V.string(b.notes, { max: 500 })),
    utm: b.utm ? JSON.stringify(b.utm).slice(0, 1000) : null,
  });
  com.event(id, 'created', `Booking created for ${vehicle.year} ${vehicle.make} ${vehicle.model}.`);

  const provider = com.PROVIDERS[method];
  const intent = await provider({ phone, amount, reference: ref, description: `Booking ${vehicle.make} ${vehicle.model}`, method });
  update('orders', id, { provider_ref: intent.providerRef || null });
  com.event(id, 'intent', intent.message || 'Payment initiated.', { simulated: !!intent.simulated });

  if (!intent.ok) {
    com.markFailed({ id }, intent.error);
    throw bad(intent.error || 'Payment could not be started');
  }
  audit('order.create', 'order', id, { ref, amount, method }, ctx.user);

  return {
    ok: true,
    ref,
    id,
    amount,
    method,
    status: 'pending',
    message: intent.message,
    simulated: !!intent.simulated,
    // In simulator mode the client can confirm the payment itself so the demo completes.
    canSimulate: !!intent.simulated,
  };
});

/** Poll for payment status. */
route('GET', '/api/checkout/status', (ctx) => {
  const ref = sec.V.string(ctx.query.ref, { field: 'Reference', required: true, max: 40 });
  const siteD = siteDealer();
  const o = get('SELECT * FROM orders WHERE ref=?', [ref]);
  if (!o || (siteD && o.dealer_id !== siteD.id)) throw notFound('No booking with that reference');
  return {
    ref: o.ref,
    status: o.status,
    amount: o.amount,
    method: o.method,
    receipt: o.receipt_no,
    holdUntil: o.hold_until,
    vehicle: J(o.vehicle_snapshot, null),
    events: all('SELECT type, message, created_at FROM payment_events WHERE order_id=? ORDER BY id', [o.id]),
  };
});

/**
 * Provider callback. A real M-Pesa deployment points Daraja's CallBackURL here; the
 * simulator posts the same shape so the flow is identical either way.
 */
route('POST', '/api/checkout/callback', (ctx) => {
  const b = ctx.body;
  const ref = sec.V.string(b.ref || b.AccountReference, { field: 'Reference', required: true, max: 40 });
  const siteD = siteDealer();
  const o = get('SELECT * FROM orders WHERE ref=?', [ref]);
  if (!o || (siteD && o.dealer_id !== siteD.id)) throw notFound('Unknown reference');

  const success = b.success !== false && b.ResultCode !== 1 && b.ResultCode !== '1';
  if (!success) {
    com.markFailed(o, sec.V.string(b.reason || b.ResultDesc, { max: 200 }) || 'Cancelled on the handset');
    return { ok: true, status: 'failed' };
  }
  const updated = com.markPaid(o, { providerRef: sec.V.string(b.providerRef, { max: 80 }), receipt: sec.V.string(b.receipt, { max: 40 }) });
  audit('order.paid', 'order', o.id, { ref, amount: o.amount }, null);
  return { ok: true, status: updated.status, receipt: updated.receipt_no, holdUntil: updated.hold_until };
});

/* ---------- offer letter ---------- */

route('GET', '/api/offer-letter', (ctx) => {
  const ref = sec.V.string(ctx.query.ref, { field: 'Reference', required: true, max: 40 });
  const phone = sec.V.string(ctx.query.phone, { max: 24 });
  const site = siteDealer();
  const a = get('SELECT * FROM applications WHERE ref=?', [ref]);
  if (!a || (site && a.dealer_id !== site.id)) throw notFound('No application with that reference');

  const applicant = J(a.applicant, {});
  const digits = (s) => String(s || '').replace(/\D/g, '').slice(-9);
  const isStaff = auth.isStaff(ctx.user) && (ctx.user.role === 'superadmin' || Number(ctx.user.dealer_id) === Number(a.dealer_id));
  if (!isStaff) {
    if (!phone || digits(applicant.phone) !== digits(phone)) throw denied('Phone number does not match this reference');
  }
  if (!['approved', 'disbursed', 'delivered'].includes(a.status)) {
    throw bad('An offer letter is issued once the application is approved. This one is ' + a.status.replace(/_/g, ' ') + '.');
  }

  const dealer = get('SELECT * FROM dealers WHERE id=?', [a.dealer_id]);
  const lender = a.lender_id ? get('SELECT * FROM lenders WHERE id=?', [a.lender_id]) : null;
  const vehicle = J(a.vehicle_snapshot, null);
  const branch = get('SELECT * FROM branches WHERE dealer_id=? ORDER BY id LIMIT 1', [a.dealer_id]);

  if (!a.offer_letter_ref) {
    update('applications', a.id, {
      offer_letter_ref: 'OL-' + a.ref.replace(/^MK-/, ''),
      offer_letter_at: new Date().toISOString(),
    });
    insert('application_events', {
      application_id: a.id,
      type: 'offer_letter',
      actor: isStaff ? ctx.user.name : applicant.fullName || 'Customer',
      message: 'Offer letter generated.',
    });
  }
  const fresh = get('SELECT * FROM applications WHERE id=?', [a.id]);
  return com.offerLetter({ application: fresh, dealer, lender, vehicle, offer: J(a.offer, {}), branch });
});

/**
 * The sale agreement for a funded application.
 *
 * Staff only, and generated from the record rather than typed. NTSA will not process a
 * transfer of ownership without a signed copy of this, so it is the one document that
 * every completed sale in Kenya has to have — which is exactly why it should come out of
 * the system that already holds the correct chassis number.
 */
route('GET', /^\/api\/admin\/applications\/(\d+)\/sale-agreement$/, (ctx) => {
  requirePerm(ctx, 'applications');
  const a = get('SELECT * FROM applications WHERE id=?', [Number(ctx.params[0])]);
  if (!a) throw notFound('Application not found');
  assertOwns(ctx, a.dealer_id);

  const dealer = get('SELECT * FROM dealers WHERE id=?', [a.dealer_id]);
  const vehicle = a.vehicle_id ? get('SELECT * FROM vehicles WHERE id=?', [a.vehicle_id]) : null;
  const branch = vehicle && vehicle.branch_id ? get('SELECT * FROM branches WHERE id=?', [vehicle.branch_id]) : null;
  const lender = a.lender_id ? get('SELECT * FROM lenders WHERE id=?', [a.lender_id]) : null;

  /* Revealed, not masked: the buyer's ID number and KRA PIN belong ON this document —
     NTSA matches the transfer against them. This is why the route is staff-only. */
  const buyer = sec.decryptFields(J(a.applicant, {}), ['idNumber', 'kraPin', 'dob']);

  audit('sale_agreement.generate', 'application', a.id, a.ref, ctx.user);
  return com.saleAgreement({
    dealer,
    branch,
    vehicle,
    buyer,
    price: a.price,
    deposit: a.deposit,
    balance: (Number(a.price) || 0) - (Number(a.deposit) || 0),
    lender,
    ref: 'SA-' + a.ref.replace(/^MK-/, ''),
  });
});

/* ---------- the rest of the deal ----------
   Signing, the balance, insurance and collection. Everything between "the bank said yes"
   and "here are the keys", which is the stretch that used to happen on WhatsApp and in
   person. See lib/deal.js for why three of these are gates rather than reminders.

   THE BUYER HAS NO ACCOUNT. Most never make one. The only identity on the record is the
   phone number they applied with, so that is what every route here checks — the same rule
   the tracker and the document upload already use. It is not a password and it is not
   pretending to be: it stops a stranger acting on a reference they guessed, and the
   signature routes add a one-time code to that phone on top. */

/** The application behind a reference, or a refusal. Buyer-side authentication, one place. */
function dealFor(ctx) {
  const src = ctx.body && Object.keys(ctx.body).length ? ctx.body : ctx.query;
  const ref = str(src.ref);
  const phone = str(src.phone);
  if (!ref) throw bad('Reference number required', { field: 'ref' });
  const site = siteDealer();
  const app = get('SELECT * FROM applications WHERE ref=?', [ref]);
  if (!app || (site && app.dealer_id !== site.id)) throw notFound('No application with that reference');
  const applicant = sec.decryptFields(J(app.applicant, {}), ENCRYPTED_APPLICANT_FIELDS);
  const digits = (s) => String(s || '').replace(/\D/g, '').slice(-9);
  const staff = auth.isStaff(ctx.user) && (ctx.user.role === 'superadmin' || Number(ctx.user.dealer_id) === Number(app.dealer_id));
  if (!staff && digits(applicant.phone) !== digits(phone)) {
    throw denied('Confirm the phone number on the application');
  }
  return { app, applicant };
}

/** The deal's state, with everything stateFor needs to answer honestly. */
function dealState(app) {
  return deal.stateFor(app, {
    signatures: all('SELECT * FROM signatures WHERE application_id=? ORDER BY signed_at', [app.id]),
    documentCount: (get('SELECT COUNT(*) n FROM application_documents WHERE application_id=?', [app.id]) || {}).n || 0,
    depositsPaid: deal.depositsPaid(app.id),
  });
}

/**
 * The agreement as it stands, and the hash of it.
 *
 * The hash deliberately EXCLUDES the date. A buyer opens the document on Tuesday and
 * signs it on Wednesday; if the date were in the hash, the text they agreed to would no
 * longer match the text they signed, and the one mechanism meant to settle disputes would
 * manufacture one. The date is not a term of the deal — every term is hashed. The date of
 * record is the signature's own timestamp, which is stored beside it.
 */
function agreementFor(app, opts = {}) {
  const dealer = get('SELECT * FROM dealers WHERE id=?', [app.dealer_id]);
  const vehicle = app.vehicle_id ? get('SELECT * FROM vehicles WHERE id=?', [app.vehicle_id]) : null;
  const branch = vehicle && vehicle.branch_id ? get('SELECT * FROM branches WHERE id=?', [vehicle.branch_id]) : null;
  const lender = app.lender_id ? get('SELECT * FROM lenders WHERE id=?', [app.lender_id]) : null;
  const buyer = sec.decryptFields(J(app.applicant, {}), ['idNumber', 'kraPin', 'dob']);
  const sigs = all('SELECT * FROM signatures WHERE application_id=? ORDER BY signed_at', [app.id]);
  const buyerSig = sigs.find((s) => s.party === 'buyer');

  const doc = com.saleAgreement({
    dealer, branch, vehicle, buyer,
    price: app.price,
    deposit: app.deposit,
    balance: (Number(app.price) || 0) - (Number(app.deposit) || 0),
    lender,
    ref: 'SA-' + app.ref.replace(/^MK-/, ''),
    /* Once signed the document is dated the day it was signed, for ever. */
    date: buyerSig ? buyerSig.signed_at : undefined,
    signatures: sigs.length
      ? [
          sigRow('Seller', sigs.find((s) => s.party === 'seller'), dealer && dealer.name),
          sigRow('Buyer', buyerSig, buyer.fullName),
        ]
      : null,
  });

  /* The hash covers the TERMS and nothing else. Both of these exclusions are load-bearing
     and the second was found the only way such things are: by countersigning a document
     and being told it had changed.

     - date, because a buyer opens the agreement on Tuesday and signs it on Wednesday. If
       the date were hashed, the text they read would no longer match the text they signed.
     - signatures, because the block listing who has signed is part of the rendered
       document. Hash it and the act of signing changes the hash, so the buyer's signature
       can never match the document the yard is countersigning. A hash that is invalidated
       by being used is not a check, it is a deadlock. */
  const { date, signatures, ...terms } = doc;
  const hash = crypto.createHash('sha256').update(JSON.stringify(terms)).digest('hex');
  return { ...doc, hash, shortHash: hash.slice(0, 12), signed: sigs.map(publicSignature) };
}

function sigRow(role, sig, fallbackName) {
  if (!sig) return { role, name: fallbackName || '—' };
  return {
    role,
    name: sig.name,
    signedAt: sig.signed_at,
    method: sig.method === 'otp'
      ? 'Signed in the app, confirmed by a code to the phone on the application'
      : 'Signed in the staff console by a signed-in user',
  };
}

/** What anyone may see about a signature. Never the IP, which is ours to keep, not to show. */
function publicSignature(s) {
  return { party: s.party, name: s.name, signedAt: s.signed_at, method: s.method, docHash: String(s.doc_hash).slice(0, 12) };
}

/**
 * Where the balance is actually sent.
 *
 * Published rather than messaged. The commonest way a Kenyan car buyer loses money is a
 * set of account details arriving on WhatsApp from someone who is not the dealership, so
 * the app carries one authoritative copy and says plainly that these never change by
 * message and that a personal account is always a fraud.
 */
function settlementDetails(app, owed) {
  const bank = getSetting('settle_bank_name', '');
  if (!bank) {
    return {
      configured: false,
      note: 'The dealership has not published its account details here yet. Ring them and confirm on the phone — never take account details from a message.',
    };
  }
  return {
    configured: true,
    bank,
    accountName: getSetting('settle_account_name', ''),
    accountNumber: getSetting('settle_account_no', ''),
    branch: getSetting('settle_branch', ''),
    paybill: getSetting('settle_paybill', '') || null,
    /* The reference is the application's own, so the yard can match the money to the deal
       without ringing anyone. A payment with no reference is the other half of every
       "we never received it" argument. */
    reference: app.ref,
    amount: owed,
    rail: deal.railFor(owed),
    warning:
      'These details never change. If anyone sends you different ones — by message, by '
      + 'email, from any number — it is a fraud. The account is always in the dealership\'s '
      + 'name, never a person\'s.',
  };
}

/** Everything outstanding, for the customer's own tracker. */
route('GET', '/api/deal', (ctx) => {
  const { app } = dealFor(ctx);
  const st = dealState(app);
  return { ...st, settlement: settlementDetails(app, st.balanceOutstanding) };
});

/** The document itself, before signing it. */
route('GET', '/api/deal/agreement', (ctx) => {
  const { app } = dealFor(ctx);
  return agreementFor(app);
});

/**
 * Start signing: a code to the phone already on the application.
 *
 * Not to a phone number supplied in this request. That distinction is the whole security
 * of it — otherwise anyone with a reference could nominate their own phone and sign in
 * somebody else's name.
 */
route('POST', '/api/deal/sign/start', (ctx) => {
  const { app, applicant } = dealFor(ctx);
  const rl = sec.rateLimit('sign:' + sec.clientIp(ctx.req), 10, 60 * 60 * 1000);
  if (!rl.ok) throw new ApiError(429, 'Too many attempts. Try again in an hour.');

  if (get("SELECT id FROM signatures WHERE application_id=? AND party='buyer'", [app.id])) {
    throw bad('This agreement is already signed.');
  }

  const { code, hash } = sec.makeOtp();
  update('applications', app.id, {
    sign_otp_hash: hash,
    sign_otp_expires: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    sign_otp_tries: 0,
  });
  console.log(`\n  [SIGN] code for ${app.ref}: \x1b[1m${code}\x1b[0m (valid 15 minutes)\n`);
  const demo = getSetting('demo_mode', 'on') === 'on';
  return {
    ok: true,
    sentTo: sec.mask(applicant.phone, 4),
    expiresInMinutes: 15,
    /* Same rule as the staff 2FA: no SMS gateway is wired up, so in demo mode the code is
       shown on screen. Off in production, where it goes to the server console only. */
    demoCode: demo ? code : undefined,
  };
});

/** Sign it. The name is typed by the signer, not copied from the record. */
route('POST', '/api/deal/sign', (ctx) => {
  const { app, applicant } = dealFor(ctx);
  const b = ctx.body || {};

  if (get("SELECT id FROM signatures WHERE application_id=? AND party='buyer'", [app.id])) {
    throw bad('This agreement is already signed.');
  }
  if (!app.sign_otp_hash) throw bad('Ask for a code first.');
  if (new Date(app.sign_otp_expires).getTime() < Date.now()) throw bad('That code has expired. Ask for another.');
  if (Number(app.sign_otp_tries || 0) >= 6) throw bad('Too many wrong codes. Ask for another.');

  const code = String(b.code || '').replace(/\D/g, '');
  if (!sec.verifyOtp(code, app.sign_otp_hash)) {
    update('applications', app.id, { sign_otp_tries: Number(app.sign_otp_tries || 0) + 1 });
    throw bad('That code is not right.', { field: 'code' });
  }

  /* The typed name has to be the buyer's own. Not because a mismatch proves fraud, but
     because a signature in somebody else's name is worthless on an NTSA transfer that
     matches names against the ID. Compared loosely — people type their middle name, or
     do not. */
  const typed = sec.V.string(b.name, { field: 'Full name', min: 3, max: 120, required: true });
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean);
  const onFile = norm(applicant.fullName);
  const given = norm(typed);
  const overlap = given.filter((w) => onFile.includes(w)).length;
  if (overlap < Math.min(2, onFile.length)) {
    throw bad(`Sign in the name on the application — ${applicant.fullName}.`, { field: 'name' });
  }
  if (!b.agreed) throw bad('Tick the box to confirm you have read the agreement.', { field: 'agreed' });

  const agreement = agreementFor(app);
  insert('signatures', {
    dealer_id: app.dealer_id,
    application_id: app.id,
    party: 'buyer',
    name: typed,
    method: 'otp',
    doc_hash: agreement.hash,
    ip: sec.clientIp(ctx.req),
    user_agent: String(ctx.req.headers['user-agent'] || '').slice(0, 300),
  });
  update('applications', app.id, { sign_otp_hash: null, sign_otp_expires: null, sign_otp_tries: 0 });
  insert('application_events', {
    application_id: app.id,
    type: 'signature',
    actor: 'Customer',
    message: `Sale agreement signed by ${typed}, confirmed by code to the phone on the application. Document ${agreement.shortHash}.`,
  });
  return { ok: true, deal: dealState(get('SELECT * FROM applications WHERE id=?', [app.id])) };
});

/**
 * The buyer says they have sent the balance.
 *
 * DELIBERATELY NOT A CONFIRMATION. Money is confirmed by the yard seeing it in the
 * account, never by the payer saying so — a system that releases a car on the buyer's own
 * word is a system that hands out cars for free. This records the claim and the reference
 * so the yard has something to look for, and puts the deal in front of them.
 */
route('POST', '/api/deal/balance', (ctx) => {
  const { app } = dealFor(ctx);
  const b = ctx.body || {};
  const st = dealState(app);
  if (st.balanceOutstanding <= 0) throw bad('There is nothing outstanding on this deal.');

  const amount = Math.round(Number(b.amount) || 0);
  if (amount <= 0) throw bad('How much did you send?', { field: 'amount' });
  const method = sec.V.enum(b.method, ['mpesa', 'pesalink', 'bank_transfer', 'rtgs', 'cheque', 'cash'], {
    field: 'Method', fallback: 'bank_transfer',
  });
  const reference = sec.V.string(b.reference, { field: 'Reference', min: 3, max: 60, required: true });

  insert('application_events', {
    application_id: app.id,
    type: 'payment',
    actor: 'Customer',
    message: `Buyer reports sending ${KES(amount)} by ${method.replace('_', ' ')}, reference ${reference}. Not yet confirmed by the dealership.`,
  });
  update('applications', app.id, { balance_ref: reference, balance_method: method });
  return { ok: true, note: 'Recorded. The dealership will confirm it against the account — you do not need to send it twice.' };
});

/** The buyer's cover note. Still not a confirmation: the yard checks it against the policy. */
route('POST', '/api/deal/insurance', (ctx) => {
  const { app } = dealFor(ctx);
  const b = ctx.body || {};
  const insurer = sec.V.string(b.insurer, { field: 'Insurer', min: 2, max: 120, required: true });
  const policy = sec.V.string(b.policy, { field: 'Policy or cover note number', min: 3, max: 60, required: true });
  const expiry = sec.V.string(b.expiry, { field: 'Cover expires', max: 40 });
  update('applications', app.id, { insurer, insurance_policy: policy, insurance_expiry: expiry || null });
  insert('application_events', {
    application_id: app.id,
    type: 'insurance',
    actor: 'Customer',
    message: `Buyer gave cover details: ${insurer}, ${policy}. Awaiting confirmation by the dealership.`,
  });
  return { ok: true, note: 'The dealership will check this against the policy before releasing the car.' };
});

/** Book the one visit. */
route('POST', '/api/deal/collection', (ctx) => {
  const { app, applicant } = dealFor(ctx);
  const b = ctx.body || {};
  const date = sec.V.string(b.date, { field: 'Date', min: 8, max: 10, required: true });
  const time = sec.V.string(b.time, { field: 'Time', min: 4, max: 8, required: true });
  if (new Date(date + 'T00:00:00').getTime() < Date.now() - 864e5) throw bad('Pick a date in the future.', { field: 'date' });

  const branchId = Number(b.branchId) || null;
  update('applications', app.id, {
    collection_at: date,
    collection_time: time,
    collection_branch_id: branchId,
  });
  insert('bookings', {
    ref: 'CL-' + app.ref.replace(/^MK-/, ''),
    dealer_id: app.dealer_id,
    branch_id: branchId,
    vehicle_id: app.vehicle_id,
    kind: 'delivery',
    slot_date: date,
    slot_time: time,
    name: applicant.fullName || 'Buyer',
    phone: applicant.phone || '',
    notes: 'Collection for ' + app.ref,
    introduced_by: app.introduced_by || null,
  });
  insert('application_events', {
    application_id: app.id,
    type: 'collection',
    actor: 'Customer',
    message: `Collection booked for ${date} at ${time}.`,
  });
  return { ok: true, deal: dealState(get('SELECT * FROM applications WHERE id=?', [app.id])) };
});

/**
 * What to bring on the day, worked out from this deal rather than from a generic list.
 *
 * A financed buyer and a cash buyer need different things in their hand, and being turned
 * away at the gate for a missing document after arranging a day off is exactly the kind of
 * avoidable second visit this whole feature exists to remove.
 */
route('GET', '/api/deal/collection-list', (ctx) => {
  const { app } = dealFor(ctx);
  const st = dealState(app);
  const items = [
    { item: 'Your original national ID', why: 'The yard matches it against the sale agreement and the NTSA transfer.' },
    { item: 'Your driving licence', why: 'You are driving the car away. Nobody at the yard can drive it for you.' },
    {
      item: 'Insurance certificate or cover note',
      why: 'The law requires at least third-party cover before the car moves. Without it the car stays here.',
      legal: true,
    },
  ];
  if (st.balanceOutstanding > 0) {
    items.push({
      item: 'Proof the balance has cleared',
      why: KES(st.balanceOutstanding) + ' is still showing as outstanding. Bring the bank slip or transfer confirmation.',
    });
  }
  if (st.financed) {
    items.push({ item: 'Your copy of the lender\'s offer letter', why: 'Signed. The yard files it with the sale.' });
  }
  return {
    ref: app.ref,
    at: app.collection_at || null,
    time: app.collection_time || null,
    items,
    note:
      'Everything else is already done in the app. This is the only visit — if anything on '
      + 'this list is missing, sort it out before you set off rather than at the gate.',
  };
});

/* ---------- the yard's side of the same deal ---------- */

/** Every deal still in flight, worst first. */
route('GET', '/api/admin/deals', (ctx) => {
  requirePerm(ctx, 'applications');
  const did = scopeDealer(ctx) || (siteDealer() || {}).id;
  return { items: deal.boardFor(did) };
});

/** The yard countersigns. The buyer signs first — always. */
route('POST', /^\/api\/admin\/applications\/(\d+)\/countersign$/, (ctx) => {
  const u = requirePerm(ctx, 'applications');
  const app = get('SELECT * FROM applications WHERE id=?', [Number(ctx.params[0])]);
  if (!app) throw notFound('Application not found');
  assertOwns(ctx, app.dealer_id);

  const buyerSig = get("SELECT * FROM signatures WHERE application_id=? AND party='buyer'", [app.id]);
  if (!buyerSig) throw bad('The buyer has not signed yet. Countersigning a document they have not seen is how disputes start.');
  if (get("SELECT id FROM signatures WHERE application_id=? AND party='seller'", [app.id])) {
    throw bad('Already countersigned.');
  }

  const agreement = agreementFor(app);
  /* If the terms changed after the buyer signed, the hashes differ and the countersignature
     would be sitting under a different document. Refuse, loudly, and say what to do. */
  if (agreement.hash !== buyerSig.doc_hash) {
    throw bad(
      'The agreement has changed since the buyer signed it. Their signature covers document '
      + String(buyerSig.doc_hash).slice(0, 12) + ', this is now ' + agreement.shortHash
      + '. Ask them to sign the new version.'
    );
  }

  insert('signatures', {
    dealer_id: app.dealer_id,
    application_id: app.id,
    party: 'seller',
    name: u.name,
    signed_by: u.id,
    method: 'staff_session',
    doc_hash: agreement.hash,
    ip: sec.clientIp(ctx.req),
    user_agent: String(ctx.req.headers['user-agent'] || '').slice(0, 300),
  });
  insert('application_events', {
    application_id: app.id,
    type: 'signature',
    actor: u.name,
    message: `Sale agreement countersigned for the dealership. Document ${agreement.shortHash}.`,
  });
  audit('deal.countersign', 'application', app.id, app.ref, u);
  return { ok: true, deal: dealState(get('SELECT * FROM applications WHERE id=?', [app.id])) };
});

/** The yard confirms money it can actually see in the account. */
route('POST', /^\/api\/admin\/applications\/(\d+)\/balance$/, (ctx) => {
  const u = requirePerm(ctx, 'applications');
  const app = get('SELECT * FROM applications WHERE id=?', [Number(ctx.params[0])]);
  if (!app) throw notFound('Application not found');
  assertOwns(ctx, app.dealer_id);

  const amount = Math.round(Number((ctx.body || {}).amount) || 0);
  if (amount <= 0) throw bad('How much was received?', { field: 'amount' });
  const method = sec.V.enum((ctx.body || {}).method, ['mpesa', 'pesalink', 'bank_transfer', 'rtgs', 'cheque', 'cash'], {
    field: 'Method', fallback: 'bank_transfer',
  });
  const reference = sec.V.string((ctx.body || {}).reference, { field: 'Reference', max: 60 });

  const now = Number(app.balance_paid || 0) + amount;
  update('applications', app.id, {
    balance_paid: now,
    balance_method: method,
    balance_ref: reference || app.balance_ref || null,
    balance_paid_at: new Date().toISOString(),
    balance_confirmed_by: u.id,
  });
  insert('application_events', {
    application_id: app.id,
    type: 'payment',
    actor: u.name,
    message: `${KES(amount)} confirmed received by ${method.replace('_', ' ')}${reference ? ', reference ' + reference : ''}.`,
  });
  audit('deal.balance', 'application', app.id, app.ref, u);
  return { ok: true, deal: dealState(get('SELECT * FROM applications WHERE id=?', [app.id])) };
});

/** The yard confirms the cover it has actually seen. */
route('POST', /^\/api\/admin\/applications\/(\d+)\/insurance$/, (ctx) => {
  const u = requirePerm(ctx, 'applications');
  const app = get('SELECT * FROM applications WHERE id=?', [Number(ctx.params[0])]);
  if (!app) throw notFound('Application not found');
  assertOwns(ctx, app.dealer_id);
  const b = ctx.body || {};
  const insurer = sec.V.string(b.insurer || app.insurer, { field: 'Insurer', min: 2, max: 120, required: true });
  const policy = sec.V.string(b.policy || app.insurance_policy, { field: 'Policy number', min: 3, max: 60, required: true });
  const expiry = sec.V.string(b.expiry || app.insurance_expiry, { field: 'Expiry', max: 40 });

  update('applications', app.id, {
    insurer,
    insurance_policy: policy,
    insurance_expiry: expiry || null,
    insurance_confirmed_at: new Date().toISOString(),
    insurance_confirmed_by: u.id,
  });
  insert('application_events', {
    application_id: app.id,
    type: 'insurance',
    actor: u.name,
    message: `Cover confirmed: ${insurer}, ${policy}${expiry ? ', to ' + expiry : ''}.`,
  });
  audit('deal.insurance', 'application', app.id, app.ref, u);
  return { ok: true, deal: dealState(get('SELECT * FROM applications WHERE id=?', [app.id])) };
});

/**
 * Hand the car over. The one action in this file that is genuinely gated.
 *
 * Refusing this is the whole point. A yard that can tick "handed over" on an uninsured car
 * with the balance outstanding has a checklist, not a control. The block is overridable
 * only by fixing the thing that is blocking it.
 */
route('POST', /^\/api\/admin\/applications\/(\d+)\/handover$/, (ctx) => {
  const u = requirePerm(ctx, 'applications');
  const app = get('SELECT * FROM applications WHERE id=?', [Number(ctx.params[0])]);
  if (!app) throw notFound('Application not found');
  assertOwns(ctx, app.dealer_id);
  if (app.handed_over_at) throw bad('Already handed over.');

  const st = dealState(app);
  if (st.blockers.length) {
    throw new ApiError(409, 'Cannot release the car while ' + st.blockerText + '.', { blockers: st.blockers });
  }

  const note = sec.stripTags(sec.V.string((ctx.body || {}).note, { max: 500 }));
  const at = new Date().toISOString();
  update('applications', app.id, { handed_over_at: at, handed_over_by: u.id, handover_note: note || null });
  insert('application_events', {
    application_id: app.id,
    type: 'handover',
    actor: u.name,
    message: 'Car handed over to the buyer.' + (note ? ' ' + note : ''),
  });
  /* NTSA's fourteen days start today, not whenever somebody remembers. */
  if (!app.transfer_stage) {
    update('applications', app.id, { transfer_stage: 'agreement_signed', transfer_started_at: at });
  }
  audit('deal.handover', 'application', app.id, app.ref, u);
  return { ok: true, deal: dealState(get('SELECT * FROM applications WHERE id=?', [app.id])) };
});

/* ---------- insurance: real quotes, real policies, real commission ----------

   lib/ownership.js estimates what cover costs so a buyer can budget. This places it.

   The app is standing at the exact moment a financed buyer is obliged to insure — the
   handover gate in lib/deal.js will not release the car without cover — holding the
   vehicle value, the buyer's details and the lender's requirement. Nobody is better
   placed to put that policy on risk, and it renews every year afterwards.

   THE APP NEVER TAKES PREMIUM MONEY. Section 156(2) of the Insurance Act: an intermediary
   may not receive premium on behalf of an insurer, at 20% of the unremitted premium and a
   criminal offence for a director. Every route below quotes, records and hands the buyer
   to the insurer. None of them accepts a payment and none of them ever should. */

/** What an insurer looks like to the public: the cover, never the commission. */
function shapeInsurer(i) {
  return {
    id: i.id,
    name: i.name,
    shortName: i.short_name || i.name,
    logoText: i.logo_text || null,
    color: i.color || null,
    claimDays: i.claim_days || null,
    garages: i.approved_garages || null,
    highlights: J(i.highlights, []),
    excludes: J(i.excludes, []),
    maxVehicleAge: i.max_vehicle_age_years || null,
  };
}

/** The panel this deployment sells. */
route('GET', '/api/insurers', () =>
  all('SELECT * FROM insurers WHERE active=1 ORDER BY sort_order, id').map(shapeInsurer)
);

/**
 * Priced quotes from every insurer on the panel.
 *
 * Public, like /api/quote — a buyer comparing cover before they have applied for anything
 * is exactly the person this is for. The commission is stripped on the way out: it is
 * between the intermediary and the insurer, and a customer reading a commission line
 * beside a price reasonably wonders whether the price was chosen for the commission.
 */
route('POST', '/api/insurance/quote', (ctx) => {
  const b = ctx.body || {};
  const rl = sec.rateLimit('insquote:' + sec.clientIp(ctx.req), 40, 60 * 60 * 1000);
  if (!rl.ok) throw new ApiError(429, 'Too many quotes. Please try again later.');

  const value = Math.round(Number(b.value) || 0);
  if (value <= 0) throw bad('What is the car worth?', { field: 'value' });

  const rows = all('SELECT * FROM insurers WHERE active=1 ORDER BY sort_order, id');
  const res = ins.panel(rows, {
    value,
    ageYears: Number(b.ageYears) || 0,
    cover: b.cover,
    claimFreeYears: Number(b.claimFreeYears) || 0,
    addons: b.addons || {},
  });
  return {
    ...res,
    ...stripCommission(res),
    /* Said plainly wherever a price is shown, because it is the difference between this
       and every "get a quote" form that turns into three weeks of phone calls. */
    note: 'These are priced from each insurer\'s own published rates. You pay the insurer directly — MotoKE never handles premium money.',
  };
});

/** Everything about a quote except what it pays us. */
function publicQuote(q) {
  const { commission, commissionPct, ...rest } = q;
  return rest;
}

/**
 * Every part of a panel result that carries a quote, cleaned in one place.
 *
 * `cheapest` is the SAME OBJECT as quotes[0], and the first version of this stripped the
 * list and forgot the pointer — so the commission on the cheapest quote went out to the
 * public in full while the identical figure was correctly removed three lines above it.
 * Found by grepping a live response for the word rather than by reading the code, which is
 * the only way that class of mistake is ever found. Anything added to the panel later that
 * holds a quote belongs in here too.
 */
function stripCommission(res) {
  return {
    quotes: (res.quotes || []).map(publicQuote),
    cheapest: res.cheapest ? publicQuote(res.cheapest) : null,
  };
}

/**
 * Quotes for THIS deal's car, priced off the record rather than off anything the browser
 * sent. The sum insured on a financed car is the price the bank lent against; letting a
 * browser name it would let a buyer insure a 3M car for 300,000 and hand the lender an
 * uninsurable asset.
 */
route('GET', '/api/deal/insurance/quote', (ctx) => {
  const { app } = dealFor(ctx);
  const v = app.vehicle_id ? get('SELECT * FROM vehicles WHERE id=?', [app.vehicle_id]) : null;
  const snap = J(app.vehicle_snapshot, {});
  const value = Number(app.price) || Number(snap.price) || 0;
  const year = Number((v && v.year) || snap.year) || 0;
  const ageYears = year ? Math.max(0, new Date().getFullYear() - year) : 0;

  const rows = all('SELECT * FROM insurers WHERE active=1 ORDER BY sort_order, id');
  const res = ins.panel(rows, {
    value,
    ageYears,
    cover: ctx.query.cover,
    claimFreeYears: Number(ctx.query.claimFreeYears) || 0,
    addons: parseAddons(ctx.query.addons),
  });
  return {
    ...res,
    ...stripCommission(res),
    vehicle: snap.title || (v ? [v.year, v.make, v.model].filter(Boolean).join(' ') : null),
    ageYears,
    financed: !!app.lender_id,
    requirement: app.lender_id
      ? 'Your lender requires comprehensive cover with their interest noted on the policy before the car is released.'
      : 'Third-party cover is the legal minimum. Comprehensive also covers your own car.',
  };
});

const parseAddons = (s) => {
  const out = {};
  String(s || '').split(',').filter(Boolean).forEach((k) => { out[k.trim()] = true; });
  return out;
};

/**
 * The buyer picks one.
 *
 * This creates a REQUEST, not a policy. The insurer decides whether to write the risk and
 * the yard records the cover note when it arrives — the same shape as the balance and the
 * insurance declaration already in the deal flow, and for the same reason: the app must
 * never confirm on the customer's own word something only a third party can confirm.
 */
route('POST', '/api/deal/insurance/quote', (ctx) => {
  const { app, applicant } = dealFor(ctx);
  const b = ctx.body || {};
  const insurer = get('SELECT * FROM insurers WHERE id=? AND active=1', [Number(b.insurerId) || 0]);
  if (!insurer) throw bad('Choose an insurer', { field: 'insurerId' });

  const snap = J(app.vehicle_snapshot, {});
  const v = app.vehicle_id ? get('SELECT * FROM vehicles WHERE id=?', [app.vehicle_id]) : null;
  const value = Number(app.price) || Number(snap.price) || 0;
  const year = Number((v && v.year) || snap.year) || 0;
  const ageYears = year ? Math.max(0, new Date().getFullYear() - year) : 0;

  const q = ins.quote(insurer, {
    value,
    ageYears,
    cover: b.cover,
    claimFreeYears: Number(b.claimFreeYears) || 0,
    addons: b.addons || {},
  });
  if (!q.eligible) throw bad(q.reason);

  /* One live request per deal. A buyer changing their mind replaces the old one rather
     than stacking a second - two open requests on one car is how a customer ends up
     paying two premiums and blaming the yard. */
  run("DELETE FROM policies WHERE application_id=? AND status='requested'", [app.id]);

  const ref = 'PL-' + app.ref.replace(/^MK-/, '');
  const id = insert('policies', {
    ref,
    dealer_id: app.dealer_id,
    insurer_id: insurer.id,
    application_id: app.id,
    vehicle_id: app.vehicle_id || null,
    introduced_by: app.introduced_by || null,
    customer_name: applicant.fullName || 'Buyer',
    customer_phone: applicant.phone || '',
    vehicle_title: snap.title || null,
    cover: q.cover,
    sum_insured: q.sumInsured,
    premium: q.premium,
    addons: JSON.stringify((q.addons || []).filter((a) => a.selected).map((a) => a.key)),
    commission_pct: q.commissionPct,
    commission: q.commission,
    status: 'requested',
    quote_snapshot: JSON.stringify(publicQuote(q)),
  });

  insert('application_events', {
    application_id: app.id,
    type: 'insurance',
    actor: 'Customer',
    message: `Asked ${insurer.name} for ${q.coverLabel.toLowerCase()} cover at ${KES(q.premium)}. Awaiting the cover note.`,
  });

  return {
    ok: true,
    ref,
    id,
    quote: publicQuote(q),
    next: `${insurer.name} will be in touch to put the cover on risk. You pay them directly — never pay a premium to the dealership or to us.`,
  };
});

/* ---------- the yard's and the platform's side ---------- */

/** The full panel, commission and slot terms included. Staff only. */
route('GET', '/api/admin/insurers', (ctx) => {
  requirePerm(ctx, 'lenders');
  return all('SELECT * FROM insurers ORDER BY sort_order, id').map((i) => ({
    ...shapeInsurer(i),
    active: !!i.active,
    comprehensiveRate: i.comprehensive_rate,
    minPremium: i.min_premium,
    thirdPartyPremium: i.third_party_premium,
    commissionPct: ins.commissionRate(i),
    /* If somebody stored 15, the quote engine uses 10 and the panel says so rather than
       letting a screen quietly disagree with the arithmetic. */
    commissionStored: i.commission_pct,
    commissionCapped: Number(i.commission_pct) > ins.COMMISSION_CAP_PCT,
    commissionCap: ins.COMMISSION_CAP_PCT,
    monthlyFee: i.monthly_fee || 0,
    slotExclusive: !!i.slot_exclusive,
    slotUntil: i.slot_until || null,
    contact: { name: i.contact_name, phone: i.contact_phone, email: i.contact_email },
    notes: i.notes || null,
    sortOrder: i.sort_order,
  }));
});

const INSURER_FIELDS = [
  'name', 'short_name', 'logo_text', 'color', 'active', 'comprehensive_rate', 'min_premium',
  'third_party_premium', 'age_loading_from_years', 'age_loading_pct', 'ncd_pct_per_year',
  'ncd_max_pct', 'excess_pct', 'excess_min', 'max_vehicle_age_years', 'min_sum_insured',
  'max_sum_insured', 'commission_pct', 'claim_days', 'approved_garages', 'contact_name',
  'contact_phone', 'contact_email', 'slot_exclusive', 'slot_until', 'monthly_fee', 'notes',
  'sort_order',
];

function insurerPayload(body) {
  const b = body || {};
  const out = {};
  for (const f of INSURER_FIELDS) if (b[f] !== undefined) out[f] = b[f];
  if (out.name) out.name = sec.stripTags(String(out.name).trim()).slice(0, 120);
  if (out.notes) out.notes = sec.stripTags(String(out.notes)).slice(0, 1000);
  if (Array.isArray(b.highlights)) out.highlights = JSON.stringify(b.highlights.slice(0, 8).map((h) => sec.stripTags(String(h)).slice(0, 140)));
  if (Array.isArray(b.excludes)) out.excludes = JSON.stringify(b.excludes.slice(0, 8).map((h) => sec.stripTags(String(h)).slice(0, 140)));
  return out;
}

route('POST', '/api/admin/insurers', (ctx) => {
  const u = requirePerm(ctx, 'lenders.write');
  if (u.role !== 'superadmin' && u.role !== 'dealer_admin') throw denied('Only admins can add insurers');
  const p = insurerPayload(ctx.body);
  if (!p.name) throw bad('The insurer needs a name', { field: 'name' });
  const id = insert('insurers', p);
  audit('insurer.create', 'insurer', id, p.name, u);
  return { ok: true, id };
});

route('PATCH', /^\/api\/admin\/insurers\/(\d+)$/, (ctx) => {
  const u = requirePerm(ctx, 'lenders.write');
  const id = Number(ctx.params[0]);
  if (!get('SELECT id FROM insurers WHERE id=?', [id])) throw notFound('Insurer not found');
  update('insurers', id, insurerPayload(ctx.body));
  audit('insurer.update', 'insurer', id, null, u);
  return { ok: true };
});

/**
 * The commission book: what is running, what is owed, and what renews next.
 *
 * RENEWALS ARE THE BUSINESS. A policy placed once pays once. A policy renewed for six
 * years pays six times for one introduction, and the only thing standing between those
 * two outcomes is somebody ringing the customer before the cover lapses. Nobody rings
 * unless a screen tells them who and when, so this screen exists.
 */
route('GET', '/api/admin/policies', (ctx) => {
  requirePerm(ctx, 'applications');
  const did = scopeDealer(ctx) || (siteDealer() || {}).id;
  const rows = all(
    `SELECT p.*, i.name insurer_name, i.short_name insurer_short, i.color insurer_color
       FROM policies p LEFT JOIN insurers i ON i.id = p.insurer_id
      WHERE p.dealer_id=? ORDER BY p.created_at DESC`,
    [did]
  );
  const book = ins.bookFor(rows, { withinDays: Number(ctx.query.within) || 60 });
  return {
    ...book,
    items: rows.map((p) => ({
      id: p.id,
      ref: p.ref,
      status: p.status,
      insurer: p.insurer_name,
      insurerColor: p.insurer_color,
      customer: p.customer_name,
      phone: p.customer_phone,
      vehicle: p.vehicle_title,
      cover: p.cover,
      sumInsured: p.sum_insured,
      premium: p.premium,
      commission: p.commission,
      commissionPct: p.commission_pct,
      policyNo: p.policy_no,
      starts: p.starts,
      expiry: p.expiry,
      createdAt: p.created_at,
    })),
    capNote: `Motor commission is capped at ${ins.COMMISSION_CAP_PCT}% of premium by the Eleventh Schedule of the Insurance Regulations. Nothing here can exceed it.`,
    premiumNote: 'Premiums are paid by the customer to the insurer. This platform never receives premium money — Section 156(2) of the Insurance Act.',
  };
});

/**
 * The cover note arrived. This is the only thing that makes a policy real.
 *
 * It also satisfies the handover gate, so one action both records the policy and unblocks
 * the car. Doing it in two places would guarantee they eventually disagree.
 */
route('POST', /^\/api\/admin\/policies\/(\d+)\/confirm$/, (ctx) => {
  const u = requirePerm(ctx, 'applications');
  const p = get('SELECT * FROM policies WHERE id=?', [Number(ctx.params[0])]);
  if (!p) throw notFound('Policy not found');
  assertOwns(ctx, p.dealer_id);

  const b = ctx.body || {};
  const policyNo = sec.V.string(b.policyNo, { field: 'Policy number', min: 3, max: 60, required: true });
  const starts = sec.V.string(b.starts, { field: 'Cover starts', max: 40 }) || new Date().toISOString().slice(0, 10);
  const expiry = sec.V.string(b.expiry, { field: 'Cover expires', max: 40 }) || ins.expiryFor(starts);

  update('policies', p.id, {
    status: 'active',
    policy_no: policyNo,
    starts,
    expiry,
    updated_at: new Date().toISOString(),
  });

  const insurer = get('SELECT name FROM insurers WHERE id=?', [p.insurer_id]);
  if (p.application_id) {
    update('applications', p.application_id, {
      insurer: insurer ? insurer.name : null,
      insurance_policy: policyNo,
      insurance_expiry: expiry,
      insurance_confirmed_at: new Date().toISOString(),
      insurance_confirmed_by: u.id,
    });
    insert('application_events', {
      application_id: p.application_id,
      type: 'insurance',
      actor: u.name,
      message: `Cover confirmed on risk: ${insurer ? insurer.name : 'insurer'}, policy ${policyNo}, to ${expiry}.`,
    });
  }
  audit('policy.confirm', 'policy', p.id, p.ref, u);
  return { ok: true };
});

/** It renewed. A new row, linked to the old one, so a book can be counted year on year. */
route('POST', /^\/api\/admin\/policies\/(\d+)\/renew$/, (ctx) => {
  const u = requirePerm(ctx, 'applications');
  const p = get('SELECT * FROM policies WHERE id=?', [Number(ctx.params[0])]);
  if (!p) throw notFound('Policy not found');
  assertOwns(ctx, p.dealer_id);
  if (p.status !== 'active' && p.status !== 'lapsed') throw bad('Only a live policy can be renewed.');

  const b = ctx.body || {};
  const premium = Math.round(Number(b.premium) || p.premium);
  const insurer = get('SELECT * FROM insurers WHERE id=?', [Number(b.insurerId) || p.insurer_id]);
  if (!insurer) throw bad('Choose an insurer', { field: 'insurerId' });
  const rate = ins.commissionRate(insurer);

  const starts = sec.V.string(b.starts, { max: 40 })
    || (p.expiry ? new Date(new Date(p.expiry).getTime() + 864e5).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));

  const id = insert('policies', {
    ref: p.ref + '-R' + (Number(b.year) || new Date(starts).getFullYear()),
    dealer_id: p.dealer_id,
    insurer_id: insurer.id,
    application_id: p.application_id,
    vehicle_id: p.vehicle_id,
    /* The introducer is carried forward. A broker who put this customer on the books is
       owed on the renewal too - that is the difference between a commission and a tip. */
    introduced_by: p.introduced_by,
    customer_name: p.customer_name,
    customer_phone: p.customer_phone,
    vehicle_title: p.vehicle_title,
    cover: p.cover,
    sum_insured: Math.round(Number(b.sumInsured) || p.sum_insured),
    premium,
    addons: p.addons,
    commission_pct: rate,
    commission: Math.round((premium * rate) / 100),
    status: 'requested',
    renewal_of: p.id,
  });
  update('policies', p.id, { status: 'renewed', updated_at: new Date().toISOString() });
  audit('policy.renew', 'policy', id, p.ref, u);
  return { ok: true, id };
});

/* ---------- statements: getting paid without an argument ----------

   Three parties pay this platform and none of them pay as the deal happens. They add the
   month up and settle 30 to 60 days later, and whoever sends the clearer list wins every
   disagreement about what is owed. Without a list you are arguing from memory against a
   bank's spreadsheet, and you will lose.

   AN ISSUED STATEMENT IS FROZEN. See lib/statement.js for why that is not optional. */

/** How this deployment prices each payer. Settings, so a second dealership can differ. */
function feeTerms() {
  const n = (k, d) => {
    const v = Number(getSetting(k, d));
    return Number.isFinite(v) ? v : d;
  };
  return {
    bands: [
      { upTo: n('fee_band_1_max', 1_500_000), fee: n('fee_band_1', 2_500) },
      { upTo: n('fee_band_2_max', 3_500_000), fee: n('fee_band_2', 5_000) },
      { upTo: Infinity, fee: n('fee_band_3', 10_000) },
    ],
    bankPerDeal: n('bank_fee_per_deal', 10_000),
    bankPctOfLoan: n('bank_fee_pct_of_loan', 0.5),
  };
}

/** Build a statement for one payer and one month, without issuing it. */
function buildStatement(did, payerType, payerId, periodKey) {
  const p = stmt.period(periodKey);
  const terms = feeTerms();
  if (payerType === 'bank') {
    const lender = payerId ? get('SELECT * FROM lenders WHERE id=?', [payerId]) : null;
    if (payerId && !lender) throw notFound('Lender not found');
    return stmt.bankStatement(did, lender, p, { perDeal: terms.bankPerDeal, pctOfLoan: terms.bankPctOfLoan });
  }
  if (payerType === 'dealer') {
    const dealer = get('SELECT * FROM dealers WHERE id=?', [payerId || did]);
    return stmt.dealerStatement(did, dealer, p, { bands: terms.bands });
  }
  if (payerType === 'insurer') {
    const insurer = get('SELECT * FROM insurers WHERE id=?', [payerId]);
    if (!insurer) throw notFound('Insurer not found');
    return stmt.insurerStatement(did, insurer, p);
  }
  throw bad('Unknown payer', { field: 'payerType' });
}

/** Who can be invoiced, and for which months there is anything to invoice. */
route('GET', '/api/admin/statements/payers', (ctx) => {
  requirePerm(ctx, 'stats');
  const did = scopeDealer(ctx) || (siteDealer() || {}).id;
  const dealer = get('SELECT id, name FROM dealers WHERE id=?', [did]) || {};
  const months = all(
    `SELECT DISTINCT substr(funded_at, 1, 7) m FROM applications
      WHERE dealer_id=? AND funded_at IS NOT NULL ORDER BY m DESC LIMIT 24`,
    [did]
  ).map((r) => r.m);
  /* This month is always offered even with nothing in it yet — an empty statement is a
     useful answer ("nothing funded in August") and hiding the month looks like a fault. */
  const now = stmt.period().key;
  if (!months.includes(now)) months.unshift(now);

  return {
    months,
    payers: [
      { type: 'dealer', id: dealer.id, name: dealer.name, pays: 'per funded deal' },
      ...all("SELECT id, name FROM lenders WHERE active=1 ORDER BY sort_order, id")
        .map((l) => ({ type: 'bank', id: l.id, name: l.name, pays: 'per funded deal' })),
      ...all('SELECT id, name FROM insurers WHERE active=1 ORDER BY sort_order, id')
        .map((i) => ({ type: 'insurer', id: i.id, name: i.name, pays: 'commission and slot' })),
    ],
    terms: feeTerms(),
  };
});

/** What a statement WOULD say. Nothing is written. */
route('GET', '/api/admin/statements/preview', (ctx) => {
  requirePerm(ctx, 'stats');
  const did = scopeDealer(ctx) || (siteDealer() || {}).id;
  const s = buildStatement(did, str(ctx.query.payerType), Number(ctx.query.payerId) || null, str(ctx.query.period));
  const existing = get(
    `SELECT id, ref, status, total FROM statements
      WHERE dealer_id=? AND payer_type=? AND COALESCE(payer_id,0)=? AND period=?`,
    [did, s.payerType, s.payerId || 0, s.period]
  );
  return { ...s, alreadyIssued: existing || null };
});

/**
 * Issue it. From here the numbers stop moving.
 *
 * The unique index does the refusing rather than a check somebody can forget: invoicing
 * the same bank twice for the same month is the mistake that costs the relationship
 * rather than the money.
 */
route('POST', '/api/admin/statements', (ctx) => {
  const u = requirePerm(ctx, 'stats');
  const did = scopeDealer(ctx) || (siteDealer() || {}).id;
  const b = ctx.body || {};
  const s = buildStatement(did, str(b.payerType), Number(b.payerId) || null, str(b.period));
  if (!s.lines.length) throw bad('There is nothing to invoice for ' + s.periodLabel + '.');

  const ref = 'INV-' + s.period.replace('-', '') + '-' + s.payerType.slice(0, 3).toUpperCase()
    + '-' + String(s.payerId || 0).padStart(2, '0');
  if (get('SELECT id FROM statements WHERE ref=?', [ref])) {
    throw new ApiError(409, `${s.payerName} has already been invoiced for ${s.periodLabel}.`);
  }

  const id = insert('statements', {
    ref,
    dealer_id: did,
    payer_type: s.payerType,
    payer_id: s.payerId,
    payer_name: s.payerName,
    period: s.period,
    lines: JSON.stringify(s.lines),
    line_count: s.count,
    total: s.total,
    terms: s.terms,
    due_by: s.dueBy,
    issued_by: u.id,
  });
  audit('statement.issue', 'statement', id, ref, u);
  return { ok: true, id, ref, total: s.total, dueBy: s.dueBy };
});

/** Everything issued, and what is overdue. */
route('GET', '/api/admin/statements', (ctx) => {
  requirePerm(ctx, 'stats');
  const did = scopeDealer(ctx) || (siteDealer() || {}).id;
  const rows = all('SELECT * FROM statements WHERE dealer_id=? ORDER BY period DESC, id DESC', [did]);
  const today = new Date().toISOString().slice(0, 10);

  const items = rows.map((r) => ({
    id: r.id,
    ref: r.ref,
    payerType: r.payer_type,
    payer: r.payer_name,
    period: r.period,
    lines: r.line_count,
    total: r.total,
    status: r.status,
    dueBy: r.due_by,
    /* Overdue is computed, never stored. A stored flag needs something to run every night
       to keep it true, and the night it does not run is the night you stop chasing. */
    overdue: r.status === 'issued' && r.due_by && r.due_by < today,
    daysLate: r.status === 'issued' && r.due_by && r.due_by < today
      ? Math.floor((new Date(today) - new Date(r.due_by)) / 864e5)
      : 0,
    paidAt: r.paid_at,
    paidRef: r.paid_ref,
  }));

  const open = items.filter((i) => i.status === 'issued');
  return {
    items,
    outstanding: open.reduce((n, i) => n + i.total, 0),
    overdue: open.filter((i) => i.overdue).reduce((n, i) => n + i.total, 0),
    collected: items.filter((i) => i.status === 'paid').reduce((n, i) => n + (i.total || 0), 0),
  };
});

/** One issued statement, from the snapshot rather than from today's data. */
route('GET', /^\/api\/admin\/statements\/(\d+)$/, (ctx) => {
  requirePerm(ctx, 'stats');
  const r = get('SELECT * FROM statements WHERE id=?', [Number(ctx.params[0])]);
  if (!r) throw notFound('Statement not found');
  assertOwns(ctx, r.dealer_id);
  return {
    id: r.id,
    ref: r.ref,
    payerType: r.payer_type,
    payerName: r.payer_name,
    period: r.period,
    periodLabel: stmt.period(r.period).label,
    lines: J(r.lines, []),
    count: r.line_count,
    total: r.total,
    terms: r.terms,
    dueBy: r.due_by,
    status: r.status,
    paidAt: r.paid_at,
    paidRef: r.paid_ref,
    frozen: 'These figures were fixed when the statement was issued and do not change.',
  };
});

/** The same thing as a spreadsheet, because a finance department will ask. */
route('GET', /^\/api\/admin\/statements\/(\d+)\/csv$/, (ctx) => {
  requirePerm(ctx, 'stats');
  const r = get('SELECT * FROM statements WHERE id=?', [Number(ctx.params[0])]);
  if (!r) throw notFound('Statement not found');
  assertOwns(ctx, r.dealer_id);
  const csv = stmt.toCsv({
    payerName: r.payer_name,
    periodLabel: stmt.period(r.period).label,
    dueBy: r.due_by,
    lines: J(r.lines, []),
    total: r.total,
  });
  /* The house convention for a file response - the router turns __csv and __filename
     into the headers. Writing to ctx.res here would work today and break silently the
     day anything wraps the handler. */
  return { __csv: csv, __filename: `${r.ref}.csv` };
});

/** They paid. */
route('POST', /^\/api\/admin\/statements\/(\d+)\/paid$/, (ctx) => {
  const u = requirePerm(ctx, 'stats');
  const r = get('SELECT * FROM statements WHERE id=?', [Number(ctx.params[0])]);
  if (!r) throw notFound('Statement not found');
  assertOwns(ctx, r.dealer_id);
  if (r.status === 'paid') throw bad('Already marked paid.');
  const b = ctx.body || {};
  update('statements', r.id, {
    status: 'paid',
    paid_at: new Date().toISOString(),
    paid_ref: sec.V.string(b.reference, { field: 'Reference', max: 60 }) || null,
    /* Recorded separately from the total on purpose. A short payment is a conversation to
       have, and overwriting the invoiced figure with what turned up loses the evidence
       that the conversation is needed. */
    paid_amount: Math.round(Number(b.amount) || r.total),
  });
  audit('statement.paid', 'statement', r.id, r.ref, u);
  return { ok: true, short: Math.round(Number(b.amount) || r.total) < r.total };
});

/**
 * Is this broker real? Asked by a member of the public, answered without a login.
 *
 * This is the half of the register that was missing. A badge only shown to dealerships
 * solves the dealership's problem; it does nothing for the buyer, and the buyer is the
 * one being told "give me your ID and a deposit" by a stranger who says he can get them
 * a car. Kenyan forums are full of people warned off brokers for exactly that reason.
 *
 * What comes back is deliberately thin: a name, a standing, and what that standing
 * actually means. No phone number, no email, no client list, no dealerships they work
 * with. Enough to answer the question and nothing that turns the register into a
 * directory for scraping.
 *
 * An unknown number returns a plain "not on the register" rather than an error — that IS
 * the answer, and it is the one the caller most needs to hear.
 */
route('GET', '/api/broker-check', (ctx) => {
  const did = (siteDealer() || {}).id;
  const phone = brk.key(ctx.query.phone || '');
  if (!phone) throw bad('Enter the phone number the broker gave you', { field: 'phone' });

  const u = get("SELECT id, name FROM users WHERE role='broker' AND phone=?", [phone]);
  if (!u) {
    return {
      found: false,
      status: 'unknown',
      label: 'Not on the register',
      means: 'Nobody has registered this number with us. That does not prove they are dishonest — but we have checked nothing about them, so do not hand over money or documents on our word.',
    };
  }

  const v = brk.verificationFor(did, u.id);
  return {
    found: true,
    name: u.name,
    status: v.status,
    label: v.label,
    means: v.means,
    verified: v.verified,
    idChecked: v.idChecked,
    basis: v.basis,
    /* Said out loud, because a green badge invites people to switch their brain off. */
    caution: 'Whatever this says, never send a deposit to a personal account and never hand over original documents.',
  };
});

/* ---------- logbook transfer ---------- */

/** The chase list: every sale whose logbook is still outstanding, oldest first. */
route('GET', '/api/admin/transfers', (ctx) => {
  requirePerm(ctx, 'applications');
  const did = scopeDealer(ctx) || (siteDealer() || {}).id;
  return { items: xfer.outstanding(did), stages: xfer.STAGES };
});

/** Move one sale forward a stage. Forward only — see lib/transfer.js. */
route('POST', /^\/api\/admin\/applications\/(\d+)\/transfer$/, (ctx) => {
  const u = requirePerm(ctx, 'applications');
  const a = get('SELECT dealer_id FROM applications WHERE id=?', [Number(ctx.params[0])]);
  if (!a) throw notFound('Application not found');
  assertOwns(ctx, a.dealer_id);
  const b = ctx.body || {};
  const res = xfer.advance(
    Number(ctx.params[0]),
    sec.V.string(b.stage, { field: 'Stage', required: true }),
    sec.stripTags(sec.V.string(b.note, { max: 300 })),
    u.name
  );
  if (!res.ok) throw bad(res.reason);
  audit('transfer.advance', 'application', Number(ctx.params[0]), b.stage, u);
  return res.status;
});

/* ---------- leads ---------- */

/* ---------- test drives, as appointments ---------- */

/** Opening hours a Kenyan yard actually keeps. Sunday is closed. */
const SLOT_TIMES = ['09:00', '10:00', '11:00', '12:00', '14:00', '15:00', '16:00', '17:00'];
const SATURDAY_TIMES = ['09:00', '10:00', '11:00', '12:00', '13:00'];
const SLOTS_PER_HOUR = 2; // two cars can go out at once without stretching the sales floor

/**
 * Format a Date using its LOCAL parts.
 *
 * `toISOString()` converts to UTC first, so in Kenya (UTC+3) local midnight on Monday
 * comes back as the previous Sunday. That put closed days on the booking screen with a
 * weekday label that disagreed with its own date string.
 */
function localDate(d) {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** The next `days` open days, with the times still free on each. */
function availableSlots(dealerId, days = 10) {
  const out = [];
  const now = new Date();
  for (let i = 0; i < days * 2 && out.length < days; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i + 1);
    const dow = d.getDay();
    if (dow === 0) continue; // closed Sunday
    const date = localDate(d);
    const times = dow === 6 ? SATURDAY_TIMES : SLOT_TIMES;

    const taken = {};
    for (const row of all(
      `SELECT slot_time, COUNT(*) n FROM bookings
       WHERE dealer_id=? AND slot_date=? AND status NOT IN ('cancelled','no_show')
       GROUP BY slot_time`,
      [dealerId, date]
    )) {
      taken[row.slot_time] = row.n;
    }

    const free = times.filter((t) => (taken[t] || 0) < SLOTS_PER_HOUR);
    if (free.length) out.push({ date, weekday: d.toLocaleDateString('en-GB', { weekday: 'short' }), times: free });
  }
  return out;
}

route('GET', '/api/bookings/slots', (ctx) => {
  const d = resolveDealer(ctx.query);
  if (!d) throw notFound('Dealership not found');
  return { slots: availableSlots(d.id), slotsPerHour: SLOTS_PER_HOUR };
});

route('POST', '/api/bookings', (ctx) => {
  const d = resolveDealer(ctx.query);
  if (!d) throw notFound('Dealership not found');
  const b = ctx.body;

  const bot = sec.botCheck(b);
  if (!bot.ok) throw new ApiError(429, 'That looked automated. Please try again.');
  /* Two limits, on purpose.

     The wide one stops someone hammering the endpoint. The narrow one — six actual
     bookings an hour — is checked further down, AFTER validation, because counting
     rejected attempts against it locked out honest customers: mistype the date six times
     and the seventh, correct, attempt was refused for an hour. */
  const attempts = sec.rateLimit(`booking-attempt:${sec.clientIp(ctx.req)}`, 40, 60 * 60 * 1000);
  if (!attempts.ok) throw new ApiError(429, 'Too many booking attempts from this connection. Give us a call instead.');

  const name = sec.V.string(b.name, { field: 'Name', min: 2, max: 120, required: true });
  const phone = sec.V.phone(b.phone, { required: true });
  const email = sec.V.email(b.email);
  const date = sec.V.date(b.date, { field: 'date' });
  const time = sec.V.enum(b.time, [...new Set([...SLOT_TIMES, ...SATURDAY_TIMES])], { field: 'time', required: true });
  const kind = sec.V.enum(b.kind, ['test_drive', 'viewing', 'delivery'], { field: 'kind', fallback: 'test_drive' });
  if (!date) throw bad('Pick a day', { field: 'date' });
  if (new Date(date + 'T23:59:59') < new Date()) throw bad('That day has already passed', { field: 'date' });
  // Belt and braces: the browser sends a date, and a closed day must be refused here too.
  if (new Date(date + 'T12:00:00').getDay() === 0) throw bad('We are closed on Sundays', { field: 'date' });

  /* Re-check the slot at the moment of booking, not just when the page was drawn. Two
     people looking at the same screen will otherwise both take the last slot. */
  const takenNow = get(
    `SELECT COUNT(*) n FROM bookings WHERE dealer_id=? AND slot_date=? AND slot_time=? AND status NOT IN ('cancelled','no_show')`,
    [d.id, date, time]
  ).n;
  if (takenNow >= SLOTS_PER_HOUR) throw bad('Somebody just took that slot. Pick another time.', { field: 'time' });

  let vehicle = null;
  if (b.vehicleId) {
    vehicle = get('SELECT * FROM vehicles WHERE id=? AND dealer_id=?', [num(b.vehicleId), d.id]);
    if (!vehicle) throw notFound('Vehicle not found');
  }

  /* Everything about this request is valid, so it counts. */
  const limit = sec.rateLimit(`booking:${sec.clientIp(ctx.req)}`, 6, 60 * 60 * 1000);
  if (!limit.ok) throw new ApiError(429, 'Too many bookings from this connection. Give us a call instead.');

  const ref = 'TD-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const id = insert('bookings', {
    ref,
    dealer_id: d.id,
    branch_id: vehicle ? vehicle.branch_id : null,
    vehicle_id: vehicle ? vehicle.id : null,
    user_id: ctx.user ? ctx.user.id : null,
    kind,
    slot_date: date,
    slot_time: time,
    name,
    phone,
    email,
    notes: sec.V.string(b.notes, { max: 500, field: 'notes' }),
  });

  /* Also raised as a lead so it lands in the same place the team already works from,
     rather than in a diary nobody has learned to check yet. */
  insert('leads', {
    dealer_id: d.id,
    vehicle_id: vehicle ? vehicle.id : null,
    type: 'test_drive',
    name,
    phone,
    email,
    message: `Booked a ${kind.replace('_', ' ')} for ${date} at ${time}${vehicle ? ` — ${vehicle.year} ${vehicle.make} ${vehicle.model}` : ''}. Ref ${ref}.`,
  });

  audit('booking.create', 'booking', id, `${ref} ${date} ${time}`, ctx.user);
  const branch = vehicle && vehicle.branch_id ? get('SELECT name, address FROM branches WHERE id=?', [vehicle.branch_id]) : null;
  return { ok: true, ref, date, time, kind, branch };
});

/* ---------- saved searches ---------- */

/** The filters we will store. Anything else a client sends is dropped. */
const SEARCH_FILTERS = ['q', 'make', 'model', 'bodyType', 'fuel', 'transmission', 'condition', 'minPrice', 'maxPrice', 'maxMonthly', 'maxMileage', 'minYear'];

function describeSearch(f) {
  const bits = [];
  if (f.condition) bits.push(String(f.condition).replace('_', ' '));
  if (f.make) bits.push(f.make);
  if (f.model) bits.push(f.model);
  if (f.bodyType) bits.push(f.bodyType);
  if (f.fuel) bits.push(f.fuel);
  if (f.maxMonthly) bits.push(`under KES ${Number(f.maxMonthly).toLocaleString()}/month`);
  else if (f.maxPrice) bits.push(`under KES ${Number(f.maxPrice).toLocaleString()}`);
  if (f.minYear) bits.push(`${f.minYear} or newer`);
  if (f.q) bits.push(`"${f.q}"`);
  return bits.length ? bits.join(' · ') : 'Any vehicle';
}

route('POST', '/api/saved-searches', (ctx) => {
  const d = resolveDealer(ctx.query);
  if (!d) throw notFound('Dealership not found');

  const bot = sec.botCheck(ctx.body);
  if (!bot.ok) throw new ApiError(429, 'That looked automated. Please try again.');
  const limit = sec.rateLimit(`savedsearch:${sec.clientIp(ctx.req)}`, 10, 60 * 60 * 1000);
  if (!limit.ok) throw new ApiError(429, 'Too many alerts set up from this connection. Try again later.');

  const filters = sec.pick(ctx.body.filters || {}, SEARCH_FILTERS);
  /* Somewhere to send it. A signed-in customer needs nothing more; anyone else has to
     leave a phone or an email or there is no alert to send. */
  const contact = ctx.user ? null : sec.V.phone(ctx.body.phone) || sec.V.email(ctx.body.email);
  if (!ctx.user && !contact) throw bad('Leave a phone number or email so we can tell you', { field: 'phone' });

  const count = get(
    `SELECT COUNT(*) n FROM vehicles WHERE dealer_id=? AND status='available'`,
    [d.id]
  ).n;

  const id = insert('saved_searches', {
    dealer_id: d.id,
    user_id: ctx.user ? ctx.user.id : null,
    contact,
    label: describeSearch(filters),
    filters: JSON.stringify(filters),
    last_seen_count: count,
  });
  audit('search.saved', 'saved_search', id, describeSearch(filters), ctx.user);
  return { ok: true, id, label: describeSearch(filters) };
});

route('GET', '/api/saved-searches', (ctx) => {
  if (!ctx.user) return { items: [] };
  return {
    items: all('SELECT * FROM saved_searches WHERE user_id=? AND active=1 ORDER BY id DESC', [ctx.user.id]).map((s) => ({
      ...s,
      filters: J(s.filters, {}),
    })),
  };
});

route('DELETE', /^\/api\/saved-searches\/(\d+)$/, (ctx) => {
  if (!ctx.user) throw new ApiError(403, 'Sign in to manage your alerts');
  const id = Number(ctx.params[0]);
  const row = get('SELECT * FROM saved_searches WHERE id=?', [id]);
  // Scoped to the owner: an alert id is guessable, and it carries a phone number.
  if (!row || row.user_id !== ctx.user.id) throw notFound('Alert not found');
  run('DELETE FROM saved_searches WHERE id=?', [id]);
  return { ok: true };
});

route('POST', '/api/leads', (ctx) => {
  const b = ctx.body;
  const dealer = resolveDealer(b);
  if (!dealer) throw bad('Unknown dealership');

  const bot = sec.botCheck(b);
  if (!bot.ok) throw new ApiError(429, 'That looked automated. Please try again.');
  const rl = sec.rateLimit(`lead:${sec.clientIp(ctx.req)}`, 20, 60 * 60 * 1000);
  if (!rl.ok) throw new ApiError(429, 'Too many enquiries from this connection. Please call us instead.');

  const type = sec.V.enum(b.type, ['test_drive', 'trade_in', 'callback', 'enquiry', 'sell_car'], { field: 'Type', fallback: 'enquiry' });
  let vehicleId = null;
  if (b.vehicleId) {
    const v = get('SELECT id, dealer_id FROM vehicles WHERE id=?', [num(b.vehicleId)]);
    if (v && v.dealer_id === dealer.id) vehicleId = v.id;
  }
  const leadPhone = sec.V.phone(b.phone, { required: true });
  const id = insert('leads', {
    dealer_id: dealer.id,
    type,
    vehicle_id: vehicleId,
    introduced_by: brk.claimFor(dealer.id, leadPhone),
    name: sec.V.string(b.name, { field: 'Name', min: 2, max: 120, required: true }),
    phone: leadPhone,
    email: sec.V.email(b.email),
    message: sec.stripTags(sec.V.string(b.message, { max: 2000 })),
    payload: JSON.stringify(b.payload || {}).slice(0, 4000),
    utm: b.utm ? JSON.stringify(b.utm).slice(0, 1000) : null,
  });
  return { ok: true, id, type };
});

/** Rough trade-in indication: straight-line depreciation with a condition multiplier. */
route('POST', '/api/tradein/estimate', (ctx) => {
  const b = ctx.body;
  const year = num(b.year);
  const base = num(b.estimatedNewPrice) || num(b.marketPrice);
  const mileage = num(b.mileage);
  const condition = str(b.condition) || 'good';
  if (!year || !base) throw bad('Year of manufacture and an indicative market price are required');
  const age = Math.max(0, new Date().getFullYear() - year);
  let value = base * Math.pow(0.88, age);
  const mileagePenalty = Math.min(0.25, Math.max(0, (mileage - age * 15000) / 1_000_000));
  value *= 1 - mileagePenalty;
  const condMult = { excellent: 1.06, good: 1.0, fair: 0.9, poor: 0.75 }[condition] || 1;
  value *= condMult;
  const low = Math.round((value * 0.92) / 10000) * 10000;
  const high = Math.round((value * 1.08) / 10000) * 10000;

  /* An offer nobody is held to is a calculator, not an offer. CarMax's whole selling
     point is that theirs stands for seven days in writing — the certainty, not the
     number, is what people come for. So this gets a reference and an expiry, and the
     dealership honours it if the car matches the description. */
  const ref = 'PX-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const validDays = 7;
  const expires = new Date(Date.now() + validDays * 864e5).toISOString().slice(0, 10);

  /* Retail is what comparable stock of that age actually fetches, so consignment can be
     priced honestly beside the cash offer instead of quietly pocketing the difference. */
  const retail = Math.round(value * 1.28);
  const dealer = resolveDealer(ctx.query);
  const consign = val.consignment(low, retail);

  return {
    low,
    high,
    mid: Math.round((low + high) / 2),
    age,
    offer: {
      ref,
      validDays,
      expires,
      amount: low,
      terms: `We will pay ${low.toLocaleString()} for this car until ${expires}, provided it matches what you have told us and passes our inspection. Bring this reference.`,
    },
    consignment: consign,
    dealer: dealer ? dealer.name : null,
    assumptions: { depreciation: '12% per year', mileagePenalty, condMult },
  };
});

/* ---------- customer auth ---------- */

/** Live password feedback for the sign-up form — no account is touched. */
route('POST', '/api/auth/password-strength', (ctx) =>
  sec.passwordStrength(String(ctx.body.password || ''), { name: str(ctx.body.name), email: str(ctx.body.email) })
);

route('POST', '/api/auth/register', (ctx) => {
  const b = ctx.body;
  const ip = sec.clientIp(ctx.req);

  const bot = sec.botCheck(b);
  if (!bot.ok) throw new ApiError(429, 'That looked automated. Please try again.');
  const limit = sec.rateLimit(`register:${ip}`, 5, 60 * 60 * 1000);
  if (!limit.ok) throw new ApiError(429, `Too many sign-ups from this connection. Try again in ${Math.ceil(limit.retryAfter / 60)} minutes.`);

  const name = sec.V.string(b.name, { field: 'Name', min: 2, max: 120, required: true });
  const email = sec.V.email(b.email, { required: true });
  const phone = sec.V.phone(b.phone);
  const password = String(b.password || '');

  const strength = sec.passwordStrength(password, { name, email });
  if (!strength.ok) throw bad(strength.message, { field: 'password', issues: strength.issues });
  if (get('SELECT id FROM users WHERE email=?', [email])) throw bad('That email is already registered');

  const { hash, salt } = auth.hashPassword(password);
  const id = insert('users', { name, email, phone, role: 'customer', password_hash: hash, salt });
  const s = auth.createSession(id);
  ctx.setSession(s.token);
  audit('auth.register', 'user', id, { email }, null);
  return { ok: true, user: get('SELECT id,name,email,phone,role,dealer_id FROM users WHERE id=?', [id]) };
});

/**
 * A broker joins. Free, and open — no invitation and no fee.
 *
 * Open signup is safe here because joining buys nothing. A new broker is `unverified`,
 * sees the same stock a member of the public sees, and sees no clients but their own.
 * The badge is the gate, and it is earned later.
 *
 * Charging at this door would be the mistake: the people worth having are the ones who
 * have been burned by paying upfront for promises, and they will not pay again to find
 * out whether this one is different.
 */
/* ---------- signing a broker up in a field ----------

   The existing /api/broker/join wants a name, an email, a phone and a password that
   survives a strength check. That is the right form for somebody sitting at a desk. It is
   the wrong form entirely for a man standing next to a Harrier at Jamhuri on a Sunday with
   a customer waiting, and every extra box is somebody walking away.

   So: a name and a phone number. Nothing else. No email, no password, ever.

   THE PHONE NUMBER IS THE ACCOUNT, and that is also where the danger is. If typing a
   number were enough to get in, anybody could type a working broker's number and walk off
   with his client book. So creating the account and getting INTO it are two different
   things: anyone may create one, only the person holding the handset can open it, because
   the code goes to that handset. A squatted number is an empty account whose real owner
   can always claim it, since they are the one who receives the code. */

/** A synthetic address for someone who will never have one. */
function phoneEmail(phone) {
  /* .invalid is reserved by RFC 2606 precisely so it can never be a real domain. Anything
     else - .local, a made-up domain, the dealership's own - eventually gets mail sent to
     it by something, and one day that is a customer's details going to a stranger. */
  return String(phone).replace(/\D/g, '') + '@phone.motoke.invalid';
}

/** Issue a fresh sign-in code to a user row and return it. */
function issuePhoneCode(userId) {
  const { code, hash } = sec.makeOtp();
  update('users', userId, {
    otp_hash: hash,
    otp_expires: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  });
  return code;
}

/**
 * Name and phone. That is the whole form.
 *
 * Returns a WhatsApp link rather than sending anything, because there is no SMS gateway
 * and there does not need to be: whoever is doing the signing up already has WhatsApp
 * open, and tapping a wa.me link puts the message in front of the broker with his code in
 * it. Zero infrastructure, works today, and the broker ends up holding his own link.
 */
route('POST', '/api/broker/quick-join', (ctx) => {
  const b = ctx.body || {};
  const ip = sec.clientIp(ctx.req);
  const bot = sec.botCheck(b);
  if (!bot.ok) throw new ApiError(429, 'That looked automated. Please try again.');
  /* Higher than the desk form's 5, because one person signing up a queue of brokers at a
     bazaar is the intended use, not abuse. */
  const limit = sec.rateLimit('quickjoin:' + ip, 40, 60 * 60 * 1000);
  if (!limit.ok) throw new ApiError(429, `That is a lot of sign-ups from one connection. Try again in ${Math.ceil(limit.retryAfter / 60)} minutes.`);

  const name = sec.V.string(b.name, { field: 'Name', min: 2, max: 120, required: true });
  const phone = sec.V.phone(b.phone, { required: true });

  let user = get("SELECT * FROM users WHERE role='broker' AND phone=?", [phone]);
  let created = false;

  if (!user) {
    const email = phoneEmail(phone);
    if (get('SELECT id FROM users WHERE email=?', [email])) {
      throw bad('That number is already registered to a different kind of account.');
    }
    /* A password nobody knows, including us. Password sign-in is not disabled by a flag
       somewhere that can be flipped back on - there simply is no password that works. */
    const { hash, salt } = auth.hashPassword(crypto.randomBytes(32).toString('hex'));
    const id = insert('users', {
      name, email, phone, dealer_id: null, role: 'broker', password_hash: hash, salt,
    });
    user = get('SELECT * FROM users WHERE id=?', [id]);
    created = true;
    audit('broker.quickjoin', 'user', id, { phone }, null);
  }

  const code = issuePhoneCode(user.id);
  const demo = getSetting('demo_mode', 'on') === 'on';
  const link = (getSetting('public_url', '') || '').replace(/\/$/, '') + '/#/join';

  return {
    ok: true,
    created,
    name: user.name,
    phone,
    sentTo: sec.mask(phone, 4),
    expiresInMinutes: 30,
    /* No SMS gateway, so the code is shown to whoever is standing there. In production
       this goes out by message instead and this field disappears. */
    code: demo ? code : undefined,
    /* Tapping this opens WhatsApp with the message already written, addressed to them. */
    whatsapp: 'https://wa.me/' + phone.replace(/\D/g, '') + '?text=' + encodeURIComponent(
      `Hi ${user.name.split(' ')[0]}, you are registered on MotoKE as an introducer.\n\n`
      + `Open ${link || 'the site'} and enter this code to open your account: ${demo ? code : '(sent separately)'}\n\n`
      + 'Register a client BEFORE you introduce them and the deal is credited to you, whatever car they end up buying.'
    ),
  };
});

/** The code opens the account. Nothing else does. */
route('POST', '/api/broker/quick-join/verify', (ctx) => {
  const b = ctx.body || {};
  const ip = sec.clientIp(ctx.req);
  const limit = sec.rateLimit('quickverify:' + ip, 20, 15 * 60 * 1000);
  if (!limit.ok) throw new ApiError(429, 'Too many tries. Wait a few minutes.');

  const phone = sec.V.phone(b.phone, { required: true });
  const user = get("SELECT * FROM users WHERE role='broker' AND phone=?", [phone]);
  /* Deliberately the same message whether the number is unknown or the code is wrong.
     Telling a stranger which numbers exist turns this into a way to enumerate brokers. */
  const refuse = () => bad('That code is not right, or it has expired.', { field: 'code' });
  if (!user) throw refuse();
  if (!user.otp_hash || !user.otp_expires) throw refuse();
  if (new Date(user.otp_expires).getTime() < Date.now()) throw refuse();
  if (!sec.verifyOtp(String(b.code || '').replace(/\D/g, ''), user.otp_hash)) throw refuse();

  update('users', user.id, { otp_hash: null, otp_expires: null, last_login: new Date().toISOString() });
  const s = auth.createSession(user.id);
  ctx.setSession(s.token);
  audit('broker.quickjoin.verify', 'user', user.id, { phone }, null);
  return {
    ok: true,
    user: get('SELECT id,name,phone,role FROM users WHERE id=?', [user.id]),
    next: '/admin#/clients',
  };
});

route('POST', '/api/broker/join', (ctx) => {
  const b = ctx.body;
  const ip = sec.clientIp(ctx.req);

  const bot = sec.botCheck(b);
  if (!bot.ok) throw new ApiError(429, 'That looked automated. Please try again.');
  const limit = sec.rateLimit(`brokerjoin:${ip}`, 5, 60 * 60 * 1000);
  if (!limit.ok) throw new ApiError(429, `Too many sign-ups from this connection. Try again in ${Math.ceil(limit.retryAfter / 60)} minutes.`);

  const dealer = siteDealer();
  if (!dealer) throw notFound('Dealership not found');

  const name = sec.V.string(b.name, { field: 'Name', min: 2, max: 120, required: true });
  const email = sec.V.email(b.email, { required: true });
  const phone = sec.V.phone(b.phone, { required: true });
  const password = String(b.password || '');

  const strength = sec.passwordStrength(password, { name, email });
  if (!strength.ok) throw bad(strength.message, { field: 'password', issues: strength.issues });
  if (get('SELECT id FROM users WHERE email=?', [email])) throw bad('That email is already registered');

  const { hash, salt } = auth.hashPassword(password);
  /* dealer_id is NULL on purpose: a broker belongs to the PLATFORM, not to one yard.
     They find a client and then go looking for the right car - Maridady today, somewhere
     else next week - so tying the account to the dealership whose site they happened to
     sign up through would mean a separate login per yard, which nobody will keep up.
     It would also hand the dealership the broker relationship, which is the one asset
     this platform has that a dealership cannot replace.
     Their CLAIMS are still per-dealership; only the person is global. */
  const id = insert('users', {
    name, email, phone, dealer_id: null, role: 'broker', password_hash: hash, salt,
  });
  const s = auth.createSession(id);
  ctx.setSession(s.token);
  audit('broker.join', 'user', id, { email }, null);
  return {
    ok: true,
    user: get('SELECT id,name,email,phone,role,dealer_id FROM users WHERE id=?', [id]),
    verification: brk.verificationFor(dealer.id, id),
  };
});

/**
 * Every broker who has actually brought this dealership business.
 *
 * Deliberately not "every broker on the platform". A dealership has no business browsing
 * a directory of other people's introducers; what they need is the standing of the ones
 * knocking on their own door.
 */
route('GET', '/api/admin/brokers', (ctx) => {
  requirePerm(ctx, 'applications');
  const did = scopeDealer(ctx) || (siteDealer() || {}).id;
  const rows = all(
    `SELECT u.id, u.name, u.phone, u.email, u.created_at,
            COUNT(DISTINCT a.id) AS introduced,
            SUM(CASE WHEN a.status IN ('disbursed','completed') THEN 1 ELSE 0 END) AS funded,
            SUM(CASE WHEN a.status IN ('disbursed','completed') THEN a.price ELSE 0 END) AS funded_value
       FROM users u
       JOIN applications a ON a.introduced_by = u.id AND a.dealer_id = ?
      WHERE u.role = 'broker'
      GROUP BY u.id
      ORDER BY funded DESC, introduced DESC`,
    [did]
  );
  const myName = (get('SELECT name FROM dealers WHERE id=?', [did]) || {}).name;
  return {
    items: rows.map((r) => {
      const v = brk.verificationFor(did, r.id);
      const vouched = get(
        'SELECT id FROM broker_references WHERE broker_id=? AND dealer_id=?',
        [r.id, did]
      );
      return {
        id: r.id,
        name: r.name,
        phone: r.phone,
        joined: r.created_at,
        introduced: r.introduced,
        funded: r.funded || 0,
        fundedValue: r.funded_value || 0,
        status: v.status,
        label: v.label,
        means: v.means,
        verified: v.verified,
        idChecked: v.idChecked,
        missing: v.missing,
        /* Whether WE have vouched, so the button can say "vouched" instead of offering
           an action that will come back as a conflict. */
        vouchedByUs: !!vouched,
      };
    }),
    dealershipName: myName,
    basis: brk.verificationFor(did, 0).basis,
  };
});

/**
 * Suspend or reinstate a broker's badge.
 *
 * Behind `staff`, so a sales agent cannot quietly pull the standing of an introducer
 * they happen to be competing with for the same customer.
 */
route('POST', '/api/admin/broker/:id/suspend', (ctx) => {
  const u = requirePerm(ctx, 'staff');
  const did = scopeDealer(ctx) || (siteDealer() || {}).id;
  const id = num(ctx.params.id);
  const reason = sec.stripTags(sec.V.string((ctx.body || {}).reason, { field: 'Reason', min: 4, max: 300, required: true }));
  if (!brk.suspend(id, reason)) throw notFound('That broker has not submitted any details yet');
  audit('broker.suspend', 'user', id, reason, u);
  return brk.verificationFor(did, id);
});

route('POST', '/api/admin/broker/:id/reinstate', (ctx) => {
  const u = requirePerm(ctx, 'staff');
  const did = scopeDealer(ctx) || (siteDealer() || {}).id;
  const id = num(ctx.params.id);
  if (!brk.reinstate(id)) throw notFound('That broker has not submitted any details yet');
  audit('broker.reinstate', 'user', id, null, u);
  return brk.verificationFor(did, id);
});

/**
 * Everything this broker holds on one phone number.
 *
 * A broker runs ten checks a month. Six weeks later one of those people rings back and he
 * is starting from nothing: what did they earn, what could they afford, which lender said
 * yes. All of it was worked out at the time and saved - it was simply never shown back to
 * him. Without this the tool is a calculator you use once and forget.
 *
 * Scoped to ctx.user.id inside the query, so a number belonging to another broker's client
 * returns an empty history rather than that broker's book.
 */
route('GET', '/api/admin/broker/history', (ctx) => {
  const u = requirePerm(ctx, 'broker');
  const did = scopeDealer(ctx) || (siteDealer() || {}).id;
  const phone = sec.V.phone(ctx.query.phone, { required: true });
  const h = brk.historyFor(did, u.id, phone);
  if (!h) throw bad('Enter a phone number', { field: 'phone' });
  return {
    phone: h.phone,
    claim: h.claim
      ? {
          name: h.claim.name,
          note: h.claim.note,
          confirmed: !!h.claim.confirmed_by_client,
          expires: h.claim.claim_expires,
          registeredAt: h.claim.created_at,
          expired: new Date(h.claim.claim_expires).getTime() < Date.now(),
        }
      : null,
    checks: h.checks.map(shapeBrokerCheck),
    leads: h.leads.map((l) => ({
      id: l.id,
      type: l.type,
      status: l.status,
      createdAt: l.created_at,
    })),
    /* Masked, exactly as on the book page. An introduction does not entitle anyone to
       read the client's ID number or payslips. */
    applications: h.applications.map((ap) => ({
      ref: ap.ref,
      status: ap.status,
      price: ap.price,
      monthlyPayment: ap.monthly_payment,
      vehicle: (J(ap.vehicle_snapshot, {}) || {}).title || null,
      createdAt: ap.created_at,
    })),
  };
});

/** Where this broker stands, and what is still missing before they are verified. */
route('GET', '/api/admin/broker/verification', (ctx) => {
  const u = requirePerm(ctx, 'broker');
  const did = scopeDealer(ctx) || (siteDealer() || {}).id;
  return brk.verificationFor(did, u.id);
});

/** Submit the identity half. Encrypted at rest, like every other identifier here. */
route('POST', '/api/admin/broker/verification', (ctx) => {
  const u = requirePerm(ctx, 'broker');
  const did = scopeDealer(ctx) || (siteDealer() || {}).id;
  const b = ctx.body || {};
  const enc = sec.encryptFields(
    {
      idNumber: sec.V.string(b.idNumber, { field: 'ID number', min: 5, max: 20, required: true }),
      kraPin: sec.V.string(b.kraPin, { field: 'KRA PIN', min: 9, max: 15, required: true }),
    },
    ['idNumber', 'kraPin']
  );
  const out = brk.saveProfile({
    dealerId: did,
    brokerId: u.id,
    idNumber: enc.idNumber,
    kraPin: enc.kraPin,
    address: sec.stripTags(sec.V.string(b.address, { field: 'Address', min: 4, max: 200, required: true })),
  });
  audit('broker.verify.submit', 'user', u.id, null, u);
  return out;
});

/**
 * A dealership vouches for a broker it has actually dealt with.
 *
 * Behind `staff`, not `broker` — a broker must never be able to file their own reference,
 * which is the obvious way to fake a register.
 */
route('POST', '/api/admin/broker/:id/reference', (ctx) => {
  const u = requirePerm(ctx, 'staff');
  const did = scopeDealer(ctx) || (siteDealer() || {}).id;
  const brokerId = num(ctx.params.id);
  const target = get('SELECT id, role FROM users WHERE id=?', [brokerId]);
  if (!target || target.role !== 'broker') throw notFound('Broker not found');

  const dealer = get('SELECT name FROM dealers WHERE id=?', [did]) || {};
  const res = brk.addReference({
    brokerId,
    dealerId: did,
    vouchedBy: u.id,
    dealershipName: dealer.name || 'This dealership',
    note: sec.stripTags(sec.V.string((ctx.body || {}).note, { max: 300 })),
  });
  if (!res.ok) throw new ApiError(409, res.reason);
  audit('broker.vouch', 'user', brokerId, dealer.name, u);
  return brk.verificationFor(did, brokerId);
});

/**
 * Exchange a verified Firebase ID token for a MotoKE session.
 *
 * Firebase says who you are. MotoKE decides what you may do — the role comes from our
 * own users table and is never read from the token, because a token carries whatever
 * Google was told at sign-up.
 */
route('POST', '/api/auth/firebase', async (ctx) => {
  if (!fb.enabled()) throw new ApiError(404, 'Firebase sign-in is not enabled on this server');
  const ip = sec.clientIp(ctx.req);
  const limit = sec.rateLimit(`fbauth:${ip}`, 20, 15 * 60 * 1000);
  if (!limit.ok) throw new ApiError(429, `Too many sign-in attempts. Try again in ${Math.ceil(limit.retryAfter / 60)} minutes.`);

  let claims;
  try {
    claims = await fb.verifyIdToken(ctx.body.idToken);
  } catch (e) {
    throw new ApiError(401, e.message || 'That sign-in could not be verified');
  }
  const p = fb.profileFrom(claims);

  /* Match on the Firebase uid first. Falling back to email is what links a customer who
     already has a password account to the Google button they just pressed — but only
     when Google says the address is verified, otherwise anyone who can mint a token
     claiming an unverified address takes over that account. */
  let user = get('SELECT * FROM users WHERE firebase_uid=?', [p.uid]);
  if (!user && p.email && p.emailVerified) {
    user = get('SELECT * FROM users WHERE email=?', [p.email]);
    if (user) {
      update('users', user.id, { firebase_uid: p.uid, auth_provider: p.provider, photo_url: p.photo });
      audit('auth.firebase.link', 'user', user.id, { provider: p.provider }, null);
    }
  }

  if (!user) {
    if (!p.email) throw bad('That sign-in did not return an email address, so we cannot create an account');
    const id = insert('users', {
      name: p.name || (p.email ? p.email.split('@')[0] : 'Customer'),
      email: p.email,
      phone: p.phone || null,
      role: 'customer',            // never from the token
      firebase_uid: p.uid,
      auth_provider: p.provider,
      photo_url: p.photo,
      password_hash: null,
      salt: null,
    });
    user = get('SELECT * FROM users WHERE id=?', [id]);
    audit('auth.firebase.register', 'user', id, { email: p.email, provider: p.provider }, null);
  }

  if (!user.active) throw new ApiError(403, 'That account has been disabled. Talk to us and we will sort it out.');

  /* Staff never sign in this way. Their route has a second factor and this one does not,
     so allowing it here would be a way around the OTP. */
  if (auth.isStaff(user)) {
    throw new ApiError(403, 'Staff accounts sign in with a password and a verification code.');
  }

  const s = auth.createSession(user.id);
  ctx.setSession(s.token);
  audit('auth.firebase.login', 'user', user.id, { provider: p.provider }, null);
  return {
    ok: true,
    user: get('SELECT id,name,email,phone,role,dealer_id,photo_url,auth_provider FROM users WHERE id=?', [user.id]),
  };
});

route('POST', '/api/auth/login', (ctx) => {
  const ip = sec.clientIp(ctx.req);
  const email = sec.V.email(ctx.body.email, { required: true });
  const password = String(ctx.body.password || '');

  // Two limiters: one stops a flood from one connection, the other stops one account
  // being ground down from many connections.
  // Generous per-connection ceiling so a shared office NAT is not locked out, with a
  // much tighter per-account one — that is what actually stops a brute force.
  const byIp = sec.rateLimit(`login:ip:${ip}`, 25, 15 * 60 * 1000);
  const byAccount = sec.rateLimit(`login:acct:${email}`, 6, 15 * 60 * 1000);
  if (!byIp.ok || !byAccount.ok) {
    const wait = Math.max(byIp.retryAfter, byAccount.retryAfter);
    audit('auth.login.throttled', 'user', null, { email, ip }, null);
    throw new ApiError(429, `Too many attempts. Try again in ${Math.ceil(wait / 60)} minute${wait > 60 ? 's' : ''}.`);
  }

  const u = get('SELECT * FROM users WHERE email=? AND active=1', [email]);
  if (!u || !auth.verifyPassword(password, u.password_hash, u.salt)) {
    audit('auth.login.failed', 'user', u ? u.id : null, { email, ip }, null);
    throw new ApiError(401, 'Wrong email or password');
  }

  /* Staff accounts carry a second factor. Customers do not need one to browse cars.
     Brokers DO. A broker's account holds a book of real people's names and phone numbers,
     which the Data Protection Act 2019 treats as personal data, and anyone holding his
     password could also register claims in his name and take his commissions. He is not
     staff for any other purpose - see isBroker in auth.js - but he is here. */
  if ((auth.isStaff(u) || auth.isBroker(u)) && getSetting('require_staff_2fa', 'on') === 'on') {
    const { code, hash } = sec.makeOtp();
    update('users', u.id, { otp_hash: hash, otp_expires: new Date(Date.now() + 10 * 60 * 1000).toISOString() });
    audit('auth.otp.issued', 'user', u.id, { email }, null);
    // No SMS gateway in the demo: the code is printed to the server console and, because
    // this is a demo build, echoed to the client so it can be shown on screen.
    console.log(`\n  [2FA] one-time code for ${u.email}: \x1b[1m${code}\x1b[0m (valid 10 minutes)\n`);
    return {
      ok: true,
      needsOtp: true,
      email: u.email,
      hint: `A 6-digit code was sent to ${sec.mask(u.phone || u.email, 4)}.`,
      demoCode: getSetting('demo_mode', 'on') === 'on' ? code : undefined,
    };
  }

  sec.rateLimitReset(`login:acct:${email}`);
  const s = auth.createSession(u.id);
  ctx.setSession(s.token);
  audit('auth.login', 'user', u.id, { ip }, u);
  return { ok: true, user: sec.pick(u, ['id', 'name', 'email', 'phone', 'role', 'dealer_id']) };
});

/** Second step of staff sign-in. */
route('POST', '/api/auth/verify-otp', (ctx) => {
  const ip = sec.clientIp(ctx.req);
  const email = sec.V.email(ctx.body.email, { required: true });
  const code = sec.V.string(ctx.body.code, { field: 'Code', min: 6, max: 6, required: true });

  const limit = sec.rateLimit(`otp:${email}`, 6, 10 * 60 * 1000);
  if (!limit.ok) throw new ApiError(429, 'Too many code attempts. Sign in again to get a new code.');

  const u = get('SELECT * FROM users WHERE email=? AND active=1', [email]);
  if (!u || !u.otp_hash) throw new ApiError(401, 'Sign in again to get a new code');
  if (!u.otp_expires || new Date(u.otp_expires).getTime() < Date.now()) {
    update('users', u.id, { otp_hash: null, otp_expires: null });
    throw new ApiError(401, 'That code has expired. Sign in again.');
  }
  if (!sec.verifyOtp(code, u.otp_hash)) {
    audit('auth.otp.failed', 'user', u.id, { ip }, null);
    throw new ApiError(401, 'That code is not right');
  }

  update('users', u.id, { otp_hash: null, otp_expires: null });
  sec.rateLimitReset(`login:acct:${email}`);
  sec.rateLimitReset(`otp:${email}`);
  const s = auth.createSession(u.id);
  ctx.setSession(s.token);
  audit('auth.login', 'user', u.id, { ip, twoFactor: true }, u);
  return { ok: true, user: sec.pick(u, ['id', 'name', 'email', 'phone', 'role', 'dealer_id']) };
});

route('POST', '/api/auth/logout', (ctx) => {
  auth.destroySession(ctx.token);
  ctx.clearSession();
  return { ok: true };
});

route('GET', '/api/auth/me', (ctx) => {
  if (!ctx.user) return { user: null };
  const dealer = ctx.user.dealer_id ? get('SELECT id,name,slug FROM dealers WHERE id=?', [ctx.user.dealer_id]) : null;
  /* The console builds its menu from this rather than from a hard-coded role check, so
     a permission only has to change in one place — lib/auth.js. */
  return { user: ctx.user, dealer, permissions: auth.permissionsFor(ctx.user) };
});

route('GET', '/api/me/applications', (ctx) => {
  if (!ctx.user) throw denied('Sign in first');
  const rows = all(
    `SELECT a.*, l.name AS lender_name, l.logo_text AS lender_logo FROM applications a
     LEFT JOIN lenders l ON l.id=a.lender_id WHERE a.user_id=? ORDER BY a.id DESC`,
    [ctx.user.id]
  );
  return rows.map((r) => shapeApplication(r));
});

route('GET', '/api/me/saved', (ctx) => {
  if (!ctx.user) throw denied('Sign in first');
  return all(
    'SELECT v.* FROM saved_vehicles s JOIN vehicles v ON v.id=s.vehicle_id WHERE s.user_id=? ORDER BY s.created_at DESC',
    [ctx.user.id]
  ).map(shapeVehicle);
});

route('POST', '/api/me/saved', (ctx) => {
  if (!ctx.user) throw denied('Sign in first');
  const vid = Number(ctx.body.vehicleId);
  if (!get('SELECT id FROM vehicles WHERE id=?', [vid])) throw notFound('Vehicle not found');
  const existing = get('SELECT * FROM saved_vehicles WHERE user_id=? AND vehicle_id=?', [ctx.user.id, vid]);
  if (existing) {
    run('DELETE FROM saved_vehicles WHERE user_id=? AND vehicle_id=?', [ctx.user.id, vid]);
    return { ok: true, saved: false };
  }
  insert('saved_vehicles', { user_id: ctx.user.id, vehicle_id: vid });
  return { ok: true, saved: true };
});

/* ------------------------------------------------------------------ */
/* ADMIN                                                               */
/* ------------------------------------------------------------------ */

function requireStaff(ctx) {
  if (!auth.isStaff(ctx.user)) throw denied('Staff access required');
  return ctx.user;
}

/**
 * May this account open the console at all?
 *
 * Staff, plus brokers — who sign in here but are not employees. Kept separate from
 * requireStaff on purpose: the 23 routes that call requireStaff directly, with no
 * permission alongside it, stay shut to brokers without anyone having to remember to
 * exclude them. New routes are closed to brokers by default and only open when someone
 * deliberately puts a capability in front of them.
 */
function requireConsole(ctx) {
  if (auth.isStaff(ctx.user) || auth.isBroker(ctx.user)) return ctx.user;
  throw denied('Staff access required');
}

/**
 * The real permission boundary.
 *
 * Hiding a menu item is decoration — anybody can type a URL or call the endpoint. Every
 * admin route that is not for everyone goes through this, and the message names the
 * capability so a manager can tell their staff what to ask for.
 */
/**
 * Validate an assignment and check the caller is allowed to make it.
 *
 * Deciding WHO works a customer's file is a management act, so it needs `assign` — with
 * one exception: claiming an item for yourself needs nothing, because picking up work is
 * not the same as handing it out.
 *
 * @returns the user id to store, or null to unassign
 */
function resolveAssignee(ctx, value, dealerId, currentlyHeldBy = null) {
  const me = requireStaff(ctx);
  const to = value ? num(value) : null;

  /* Two things anyone may do with their own workload: pick up something nobody is
     holding, and put down something they are. Everything else — moving a file onto a
     colleague, or taking one off them — is management and needs `assign`. */
  const claimingSelf = to === me.id;
  const releasingOwn = to === null && Number(currentlyHeldBy) === me.id;
  if (!claimingSelf && !releasingOwn) requirePerm(ctx, 'assign');

  if (!to) return null;

  const target = get('SELECT id, name, role, dealer_id, active FROM users WHERE id=?', [to]);
  if (!target || !target.active || !auth.isStaff(target)) {
    throw bad('That person is not a member of staff here', { field: 'assigned_to' });
  }
  /* Only staff at THIS dealership. Without it, work could be handed to somebody at
     another yard who would then be able to open a customer's file. */
  if (target.role !== 'superadmin' && Number(target.dealer_id) !== Number(dealerId)) {
    throw bad('That person works for a different dealership', { field: 'assigned_to' });
  }
  return target.id;
}

function requirePerm(ctx, perm) {
  const u = requireConsole(ctx);
  if (!auth.can(u, perm)) {
    throw denied(`Your role does not have access to this (${perm}). Ask a dealership admin.`);
  }
  return u;
}
function scopeDealer(ctx) {
  const u = requireConsole(ctx);
  if (u.role === 'superadmin') {
    const d = ctx.query.dealer || ctx.query.dealerId || (ctx.body && (ctx.body.dealer_id || ctx.body.dealerId));
    if (d) {
      const found = resolveDealer({ dealer: d }, { any: true });
      return found ? found.id : null;
    }
    return null; // all dealers
  }
  return u.dealer_id;
}
function assertOwns(ctx, dealerId) {
  const u = requireStaff(ctx);
  if (u.role === 'superadmin') return;
  if (Number(u.dealer_id) !== Number(dealerId)) throw denied('That record belongs to another dealership');
}

route('GET', '/api/admin/stats', (ctx) => {
  requirePerm(ctx, 'overview');
  const did = scopeDealer(ctx);
  const w = did ? 'WHERE dealer_id=?' : '';
  const p = did ? [did] : [];
  const one = (sql, params = p) => get(sql, params) || {};

  const vehicles = one(`SELECT COUNT(*) n, SUM(status='available') available, SUM(status='reserved') reserved, SUM(status='sold') sold, SUM(price) value FROM vehicles ${w}`);
  const apps = one(`SELECT COUNT(*) n, SUM(status='new') fresh, SUM(status='approved') approved, SUM(status='declined') declined, SUM(status IN ('disbursed','delivered')) closed, SUM(loan_amount) volume FROM applications ${w}`);
  const leads = one(`SELECT COUNT(*) n, SUM(status='new') fresh FROM leads ${w}`);

  const byStatus = all(`SELECT status, COUNT(*) n, SUM(loan_amount) volume FROM applications ${w} GROUP BY status`, p);
  const byLender = all(
    `SELECT l.name, l.short_name, l.type, l.logo_text, l.color, COUNT(a.id) n, SUM(a.loan_amount) volume,
            SUM(a.status='approved' OR a.status='disbursed' OR a.status='delivered') won
     FROM applications a JOIN lenders l ON l.id=a.lender_id ${did ? 'WHERE a.dealer_id=?' : ''}
     GROUP BY l.id ORDER BY n DESC`,
    p
  );
  const byLenderType = all(
    `SELECT l.type, COUNT(a.id) n FROM applications a JOIN lenders l ON l.id=a.lender_id ${did ? 'WHERE a.dealer_id=?' : ''} GROUP BY l.type`,
    p
  );
  const topVehicles = all(`SELECT id, make, model, year, price, views, status FROM vehicles ${w} ORDER BY views DESC LIMIT 8`, p).map(shapeVehicle);
  const recentApps = all(
    `SELECT a.*, l.short_name AS lender_name FROM applications a LEFT JOIN lenders l ON l.id=a.lender_id
     ${did ? 'WHERE a.dealer_id=?' : ''} ORDER BY a.id DESC LIMIT 8`,
    p
  ).map((r) => shapeApplication(r));
  const timeline = all(
    `SELECT substr(created_at,1,10) day, COUNT(*) n FROM applications ${w} GROUP BY day ORDER BY day DESC LIMIT 30`,
    p
  ).reverse();
  const stock = all(`SELECT body_type v, COUNT(*) n FROM vehicles ${w} GROUP BY body_type ORDER BY n DESC`, p);
  const prequal = one(`SELECT COUNT(*) n, SUM(status='new') fresh, SUM(approved_count > 0) qualified FROM prequalifications ${w}`);

  const approvedN = Number(apps.approved || 0) + Number(apps.closed || 0);

  /* ---- movement, not just totals ----
     A number on its own tells a manager nothing. "412 applications" is only
     meaningful next to "up 18% on the previous thirty days", which is the whole
     point of the delta pill on the reference dashboard. */
  const dayStr = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() - offset);
    return d.toISOString().slice(0, 10);
  };
  const D0 = dayStr(0);
  const D30 = dayStr(30);
  const D60 = dayStr(60);

  const between = (table, from, to, extra = '') => {
    const where = [did ? 'dealer_id=?' : null, 'substr(created_at,1,10) >= ?', 'substr(created_at,1,10) < ?']
      .filter(Boolean)
      .join(' AND ');
    const params = did ? [did, from, to] : [from, to];
    return get(`SELECT COUNT(*) n, ${extra || '0'} v FROM ${table} WHERE ${where}`, params) || { n: 0, v: 0 };
  };

  /** Percentage movement, and null rather than a fake 100% when there is no base. */
  const delta = (now, before) => {
    if (!before) return { value: now, previous: before, percent: null, direction: now > 0 ? 'up' : 'flat' };
    const pct = ((now - before) / before) * 100;
    return {
      value: now,
      previous: before,
      percent: +pct.toFixed(1),
      direction: pct > 0.5 ? 'up' : pct < -0.5 ? 'down' : 'flat',
    };
  };

  const appsThis = between('applications', D30, D0, 'COALESCE(SUM(loan_amount),0)');
  const appsPrev = between('applications', D60, D30, 'COALESCE(SUM(loan_amount),0)');
  const leadsThis = between('leads', D30, D0);
  const leadsPrev = between('leads', D60, D30);
  const stockThis = between('vehicles', D30, D0, 'COALESCE(SUM(price),0)');
  const stockPrev = between('vehicles', D60, D30, 'COALESCE(SUM(price),0)');

  const deltas = {
    applications: delta(appsThis.n, appsPrev.n),
    volume: delta(appsThis.v, appsPrev.v),
    leads: delta(leadsThis.n, leadsPrev.n),
    stockAdded: delta(stockThis.n, stockPrev.n),
    periodDays: 30,
  };

  /* A gap-filled series. The raw GROUP BY skips days with nothing on them, which
     makes a chart lie about its own x-axis — three quiet days become one narrow
     bar instead of a flat stretch. */
  function series(table, days = 30, sumCol = null) {
    const where = [did ? 'dealer_id=?' : null, 'substr(created_at,1,10) >= ?'].filter(Boolean).join(' AND ');
    const params = did ? [did, dayStr(days)] : [dayStr(days)];
    const rows = all(
      `SELECT substr(created_at,1,10) day, COUNT(*) n${sumCol ? `, COALESCE(SUM(${sumCol}),0) v` : ''}
       FROM ${table} WHERE ${where} GROUP BY day`,
      params
    );
    const byDay = {};
    for (const r of rows) byDay[r.day] = r;
    const out = [];
    for (let i = days; i >= 0; i--) {
      const d = dayStr(i);
      const hit = byDay[d];
      out.push({ day: d, n: hit ? hit.n : 0, v: hit && sumCol ? hit.v : 0 });
    }
    return out;
  }

  return {
    dealerId: did,
    deltas,
    series: {
      applications: series('applications', 30, 'loan_amount'),
      leads: series('leads', 30),
      stock: series('vehicles', 30, 'price'),
    },
    vehicles,
    applications: apps,
    leads,
    prequal,
    byStatus,
    byLender,
    byLenderType,
    topVehicles,
    recentApps,
    timeline,
    stock,
    conversion: apps.n ? +((approvedN / apps.n) * 100).toFixed(1) : 0,
    avgLoan: apps.n ? Math.round((apps.volume || 0) / apps.n) : 0,
  };
});

/* ---------- admin: vehicles ---------- */

const VEHICLE_FIELDS = [
  'dealer_id', 'branch_id', 'make', 'model', 'variant', 'year', 'price', 'old_price', 'condition', 'body_type',
  'fuel', 'transmission', 'drivetrain', 'engine_cc', 'mileage_km', 'color', 'seats', 'doors', 'reg_no', 'vin',
  'status', 'featured', 'description', 'images', 'features', 'duty_paid',
  'negotiable', 'verified', 'reg_status', 'reg_expected_date', 'source_ref', 'warranty_months',
  'broker_bonus',
  'power_hp', 'torque_nm', 'zero_to_100', 'top_speed', 'kerb_weight', 'rim_size', 'tyre_size',
  'boot_litres', 'fuel_tank', 'ground_clearance', 'seat_material', 'screen_size',
  'forced_induction', 'inspection',
  'history', 'transfer_included', 'transfer_fee',
];

/**
 * The provenance checks that matter in Kenya.
 *
 * Each is deliberately three-state: `true` checked and clear, `false` checked and a
 * problem, `null` not checked. A missing check must never read as a pass — it is the same
 * rule the condition scorecard follows, and for the same reason.
 */
const HISTORY_CHECKS = [
  ['logbookLoan', 'No outstanding logbook loan', 'Nothing is registered against this car. A vehicle with a live logbook loan is not the seller’s to sell, and the debt follows the car.'],
  ['timsMatch', 'NTSA e-Logbook verified', 'Chassis, engine number and registered owner checked against the NTSA record — not against a printed book, which can be forged.'],
  ['accidentFree', 'No recorded major accident or write-off', 'Not previously written off or structurally rebuilt.'],
  ['odometerVerified', 'Mileage verified against service history', 'The odometer agrees with the stamps and the wear.'],
  ['dutyVerified', 'Import duty paid and the entry checked', 'The KRA entry number was seen, not just claimed.'],
];

/** Spec fields that are whole numbers, and the two that are not. */
const SPEC_INT_FIELDS = ['power_hp', 'torque_nm', 'top_speed', 'kerb_weight', 'rim_size', 'boot_litres', 'fuel_tank', 'ground_clearance'];
const SPEC_REAL_FIELDS = ['zero_to_100', 'screen_size'];

/**
 * Only the five known areas, each 0-100, plus notes and a date. Anything else the browser
 * sends is dropped — an inspection record is evidence, and evidence with arbitrary keys in
 * it is not evidence.
 */
function inspectionPayload(raw) {
  const src = typeof raw === 'string' ? J(raw, {}) : raw || {};
  const out = {};
  for (const [key] of perf.INSPECTION_AREAS) {
    if (src[key] === undefined || src[key] === null || src[key] === '') continue;
    out[key] = Math.max(0, Math.min(100, Math.round(num(src[key]))));
  }
  if (src.notes) out.notes = sec.V.string(src.notes, { max: 600, field: 'notes' });
  if (src.checkedOn) out.checkedOn = sec.V.date(src.checkedOn, { field: 'checkedOn' });
  return out;
}

/** Only the five known checks, each true / false / omitted. Anything else is dropped. */
function historyPayload(raw) {
  const src = typeof raw === 'string' ? J(raw, {}) : raw || {};
  const out = {};
  for (const [key] of HISTORY_CHECKS) {
    if (src[key] === undefined || src[key] === null || src[key] === '') continue;
    out[key] = src[key] === true || src[key] === 'true' || src[key] === 1 || src[key] === '1';
  }
  if (src.importEntry) out.importEntry = sec.V.string(src.importEntry, { max: 40, field: 'importEntry' });
  if (src.keepers) out.keepers = sec.V.int(src.keepers, { min: 0, max: 20, field: 'keepers' });
  if (src.checkedOn) out.checkedOn = sec.V.date(src.checkedOn, { field: 'checkedOn' });
  if (src.notes) out.notes = sec.V.string(src.notes, { max: 600, field: 'notes' });
  return out;
}

/** Shape the stored history for display, naming what was NOT checked. */
function shapeHistory(raw) {
  const stored = raw && typeof raw === 'object' ? raw : {};
  const checks = HISTORY_CHECKS.map(([key, label, detail]) => ({
    key,
    label,
    detail,
    state: stored[key] === undefined ? 'unchecked' : stored[key] ? 'clear' : 'problem',
  }));
  const problems = checks.filter((c) => c.state === 'problem');
  const cleared = checks.filter((c) => c.state === 'clear');
  return {
    checks,
    clearedCount: cleared.length,
    problemCount: problems.length,
    total: checks.length,
    complete: checks.every((c) => c.state !== 'unchecked'),
    importEntry: stored.importEntry || null,
    keepers: stored.keepers == null ? null : stored.keepers,
    checkedOn: stored.checkedOn || null,
    notes: stored.notes || null,
    headline: problems.length
      ? `${problems.length} thing${problems.length > 1 ? 's' : ''} you should know about`
      : cleared.length === checks.length
      ? 'All five provenance checks clear'
      : cleared.length
      ? `${cleared.length} of ${checks.length} checks done`
      : 'Provenance not yet checked',
  };
}

function vehiclePayload(b, ctx) {
  const out = {};
  for (const f of VEHICLE_FIELDS) {
    if (b[f] === undefined) continue;
    if (f === 'images' || f === 'features') out[f] = JSON.stringify(Array.isArray(b[f]) ? b[f] : J(b[f], []));
    else if (f === 'inspection') out[f] = b[f] == null || b[f] === '' ? null : JSON.stringify(inspectionPayload(b[f]));
    else if (f === 'history') out[f] = b[f] == null || b[f] === '' ? null : JSON.stringify(historyPayload(b[f]));
    else if (f === 'transfer_included') out[f] = bool(b[f]);
    else if (f === 'featured' || f === 'duty_paid') out[f] = bool(b[f]);
    else if (f === 'forced_induction') out[f] = b[f] === null || b[f] === '' ? null : bool(b[f]);
    else if (SPEC_REAL_FIELDS.includes(f)) out[f] = b[f] === null || b[f] === '' ? null : num(b[f]) || null;
    else if (SPEC_INT_FIELDS.includes(f)) out[f] = b[f] === null || b[f] === '' ? null : Math.round(num(b[f])) || null;
    else if (['year', 'price', 'old_price', 'engine_cc', 'mileage_km', 'seats', 'doors', 'dealer_id', 'branch_id'].includes(f))
      out[f] = b[f] === null || b[f] === '' ? null : num(b[f]);
    else out[f] = str(b[f]);
  }
  if (out.dealer_id == null && ctx.user && ctx.user.dealer_id) out.dealer_id = ctx.user.dealer_id;
  return out;
}

route('GET', '/api/admin/vehicles', (ctx) => {
  requirePerm(ctx, 'inventory');
  const did = scopeDealer(ctx);
  const where = [];
  const params = [];
  if (did) {
    where.push('v.dealer_id=?');
    params.push(did);
  }
  if (ctx.query.status) {
    where.push('v.status=?');
    params.push(ctx.query.status);
  }
  if (ctx.query.q) {
    where.push('(v.make LIKE ? OR v.model LIKE ? OR v.reg_no LIKE ? OR v.vin LIKE ?)');
    const s = `%${ctx.query.q}%`;
    params.push(s, s, s, s);
  }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const page = Math.max(1, num(ctx.query.page, 1));
  const pageSize = Math.min(200, num(ctx.query.pageSize, 50));
  const items = all(
    `SELECT v.*, d.name dealer_name, b.name branch_name FROM vehicles v JOIN dealers d ON d.id=v.dealer_id
     LEFT JOIN branches b ON b.id=v.branch_id ${w} ORDER BY v.id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  ).map(shapeVehicle);
  const total = get(`SELECT COUNT(*) n FROM vehicles v ${w}`, params).n;
  return { items, total, page, pageSize, pages: Math.ceil(total / pageSize) };
});

route('POST', '/api/admin/vehicles', (ctx) => {
  requirePerm(ctx, 'inventory.write');
  const p = vehiclePayload(ctx.body, ctx);
  if (!p.make || !p.model || !p.year || !p.price) throw bad('Make, model, year and price are required');
  if (!p.dealer_id) throw bad('Dealership is required');
  assertOwns(ctx, p.dealer_id);
  if (!p.images || p.images === '[]') {
    p.images = JSON.stringify([`/img/vehicle.svg?make=${encodeURIComponent(p.make)}&model=${encodeURIComponent(p.model)}&color=${encodeURIComponent(p.color || '#334')}`]);
  }
  const id = insert('vehicles', p);
  audit('vehicle.create', 'vehicle', id, `${p.year} ${p.make} ${p.model}`, ctx.user);
  return { ok: true, id, vehicle: shapeVehicle(get('SELECT * FROM vehicles WHERE id=?', [id])) };
});

route('PATCH', /^\/api\/admin\/vehicles\/(\d+)$/, (ctx) => {
  requirePerm(ctx, 'inventory.write');
  const id = Number(ctx.params[0]);
  const existing = get('SELECT * FROM vehicles WHERE id=?', [id]);
  if (!existing) throw notFound('Vehicle not found');
  assertOwns(ctx, existing.dealer_id);
  const p = vehiclePayload(ctx.body, ctx);
  p.updated_at = new Date().toISOString();
  update('vehicles', id, p);
  audit('vehicle.update', 'vehicle', id, Object.keys(p).join(','), ctx.user);
  return { ok: true, vehicle: shapeVehicle(get('SELECT * FROM vehicles WHERE id=?', [id])) };
});

route('DELETE', /^\/api\/admin\/vehicles\/(\d+)$/, (ctx) => {
  requirePerm(ctx, 'inventory.write');
  const id = Number(ctx.params[0]);
  const existing = get('SELECT * FROM vehicles WHERE id=?', [id]);
  if (!existing) throw notFound('Vehicle not found');
  assertOwns(ctx, existing.dealer_id);
  run('DELETE FROM vehicles WHERE id=?', [id]);
  audit('vehicle.delete', 'vehicle', id, `${existing.year} ${existing.make} ${existing.model}`, ctx.user);
  return { ok: true };
});

/** CSV bulk import: make,model,variant,year,price,condition,body_type,fuel,transmission,mileage_km,color,seats */
route('POST', '/api/admin/vehicles/import', (ctx) => {
  requirePerm(ctx, 'inventory.write');
  const dealerId = num(ctx.body.dealer_id) || ctx.user.dealer_id;
  if (!dealerId) throw bad('Dealership is required');
  assertOwns(ctx, dealerId);
  const rows = parseCsv(String(ctx.body.csv || ''));
  if (!rows.length) throw bad('No rows found in the CSV');
  let created = 0;
  const errors = [];
  rows.forEach((r, i) => {
    try {
      const p = vehiclePayload({ ...r, dealer_id: dealerId }, ctx);
      if (!p.make || !p.model || !p.year || !p.price) throw new Error('make, model, year and price are required');
      if (!p.images || p.images === '[]')
        p.images = JSON.stringify([`/img/vehicle.svg?make=${encodeURIComponent(p.make)}&model=${encodeURIComponent(p.model)}&color=${encodeURIComponent(p.color || '#334')}`]);
      insert('vehicles', p);
      created++;
    } catch (e) {
      errors.push({ row: i + 2, error: e.message });
    }
  });
  audit('vehicle.import', 'vehicle', null, `${created} created`, ctx.user);
  return { ok: true, created, errors };
});

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const split = (line) => {
    const out = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') {
        out.push(cur);
        cur = '';
      } else cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const headers = split(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, '_'));
  return lines.slice(1).map((l) => {
    const cells = split(l);
    const o = {};
    headers.forEach((h, i) => (o[h] = cells[i] === undefined ? '' : cells[i]));
    return o;
  });
}

/* ---------- admin: lenders ---------- */

const LENDER_FIELDS = [
  'name', 'short_name', 'type', 'logo_text', 'color', 'active', 'rate_type', 'annual_rate', 'min_deposit_pct',
  'min_tenor_months', 'max_tenor_months', 'min_loan', 'max_loan', 'min_monthly_income', 'max_dti_pct',
  'max_vehicle_age_years', 'processing_fee_pct', 'processing_fee_min', 'processing_fee_max', 'valuation_fee',
  'tracking_fee', 'legal_fee', 'insurance_rate_pct', 'insurance_financed', 'capitalize_fees', 'allowed_employment',
  'allowed_conditions', 'requires_clean_crb', 'bank_statement_months', 'min_age', 'max_age_at_maturity',
  'approval_days', 'logbook_holder', 'early_settlement_fee_pct', 'notes', 'requirements', 'sort_order',
];
const LENDER_BOOL = ['active', 'insurance_financed', 'capitalize_fees', 'requires_clean_crb'];
const LENDER_JSON = ['allowed_employment', 'allowed_conditions', 'requirements'];
const LENDER_TEXT = ['name', 'short_name', 'type', 'logo_text', 'color', 'rate_type', 'notes', 'logbook_holder'];

function lenderPayload(b) {
  const out = {};
  for (const f of LENDER_FIELDS) {
    if (b[f] === undefined) continue;
    if (LENDER_BOOL.includes(f)) out[f] = bool(b[f]);
    else if (LENDER_JSON.includes(f)) out[f] = JSON.stringify(Array.isArray(b[f]) ? b[f] : J(b[f], []));
    else if (LENDER_TEXT.includes(f)) out[f] = str(b[f]);
    else out[f] = num(b[f]);
  }
  return out;
}

/**
 * Stock ageing — the view a dealer principal opens first.
 *
 * How long has each car been here, what is it costing to keep, and which ones are slow
 * because of their PRICE rather than the market. That last list is the actionable one.
 */
/* ---------- broker ----------
   Every route here is scoped to ctx.user.id in the SQL, not filtered after the fact.
   A broker paging past their own clients into somebody else's book would be the single
   worst failure this feature could have. */

/** One saved affordability check, in the shape the console reads. */
function shapeBrokerCheck(c) {
  return {
    id: c.id,
    ref: c.ref,
    name: c.name,
    phone: c.phone,
    targetPrice: c.target_price,
    deposit: c.deposit,
    tenorMonths: c.tenor_months,
    approvedCount: c.approved_count,
    bestMonthly: c.best_monthly,
    createdAt: c.created_at,
  };
}

/** Register a client, which is what actually protects the introduction. */
route('POST', '/api/admin/broker/clients', (ctx) => {
  const u = requirePerm(ctx, 'broker');
  const did = scopeDealer(ctx) || (siteDealer() || {}).id;
  const b = ctx.body || {};
  const res = brk.registerClient({
    dealerId: did,
    brokerId: u.id,
    name: sec.V.string(b.name, { field: 'Name', min: 2, max: 120, required: true }),
    phone: sec.V.phone(b.phone, { required: true }),
    note: sec.stripTags(sec.V.string(b.note, { max: 500 })),
  });
  if (!res.ok) throw new ApiError(409, res.reason);
  audit('broker.register', 'broker_client', res.claim.id, res.claim.phone, u);
  return { ok: true, already: !!res.already, claim: res.claim, holdsForDays: brk.CLAIM_DAYS };
});

/** This broker's book: their clients, their leads, their applications. Theirs only. */
/**
 * Cars a yard is paying extra to move.
 *
 * The dealer's side of this is a carrying cost: a car sitting 60 days is bleeding
 * interest and value. The broker's side is simply an offer. He sees the money and never
 * the reason, which is the point — the days-in-stock and the cost of holding it are the
 * dealer's private position, and a broker who knew them would be negotiating against the
 * person who pays for this software.
 */
route('GET', '/api/admin/broker/bonus-stock', (ctx) => {
  requirePerm(ctx, 'broker');
  const did = scopeDealer(ctx) || (siteDealer() || {}).id;
  const rows = all(
    `SELECT * FROM vehicles
      WHERE dealer_id=? AND status='available' AND COALESCE(broker_bonus,0) > 0
      ORDER BY broker_bonus DESC, price DESC`,
    [did]
  );
  return {
    items: rows.map((v) => {
      const shaped = shapeVehicle(v);
      return {
        id: shaped.id,
        title: shaped.title,
        price: shaped.price,
        bonus: Number(v.broker_bonus) || 0,
        image: (shaped.images && shaped.images[0]) || null,
        bodyType: v.body_type,
        fuel: v.fuel,
        mileage: v.mileage_km,
        /* Deliberately absent: created_at, days in stock, carrying cost. */
      };
    }),
    note: 'Extra the dealership will pay you on top of your usual commission for moving these.',
  };
});

route('GET', '/api/admin/broker/book', (ctx) => {
  const u = requirePerm(ctx, 'broker');
  const did = scopeDealer(ctx) || (siteDealer() || {}).id;
  const book = brk.bookFor(did, u.id);
  const rate = Number(getSetting('broker_rate_per_deal', 0)) || 0;
  return {
    ...book,
    /* Applications carry ID numbers and payslips. A broker introduced this person; that
       does not entitle them to read their identity documents, so the shaping is the
       masked one and `reveal` is never passed. */
    applications: book.applications.map((a) => ({
      id: a.id,
      ref: a.ref,
      status: a.status,
      price: a.price,
      monthlyPayment: a.monthly_payment,
      createdAt: a.created_at,
      updatedAt: a.updated_at,
      client: (J(a.applicant, {}) || {}).fullName || null,
      vehicle: (J(a.vehicle_snapshot, {}) || {}).title || null,
    })),
    checks: book.checks.map(shapeBrokerCheck),
    earnings: brk.earningsFor(did, u.id, rate),
    claimDays: brk.CLAIM_DAYS,
  };
});

route('GET', '/api/admin/ageing', (ctx) => {
  requirePerm(ctx, 'ageing');
  const did = scopeDealer(ctx) || (siteDealer() || {}).id;
  const rows = all('SELECT * FROM vehicles WHERE dealer_id=?', [did]);
  const opts = {
    annualRate: Number(getSetting('floorplan_rate', 0.16)),
    annualDepreciation: Number(getSetting('floorplan_depreciation', 0.14)),
  };
  return {
    ...invy.ageing(rows, opts),
    reprice: invy.repricingList(rows, opts),
  };
});

route('GET', '/api/admin/lenders', (ctx) => {
  requirePerm(ctx, 'lenders');
  const rows = all('SELECT * FROM lenders ORDER BY sort_order, id').map(shapeLender);
  const did = ctx.user.role === 'superadmin' ? (ctx.query.dealer ? (resolveDealer(ctx.query, { any: true }) || {}).id : null) : ctx.user.dealer_id;
  if (did) {
    const links = all('SELECT * FROM dealer_lenders WHERE dealer_id=?', [did]);
    const map = new Map(links.map((l) => [l.lender_id, !!l.enabled]));
    rows.forEach((r) => (r.enabled_for_dealer = map.has(r.id) ? map.get(r.id) : true));
  }
  return rows;
});

route('POST', '/api/admin/lenders', (ctx) => {
  requirePerm(ctx, 'lenders.write');
  const u = requireStaff(ctx);
  if (u.role !== 'superadmin' && u.role !== 'dealer_admin') throw denied('Only admins can add lenders');
  const p = lenderPayload(ctx.body);
  if (!p.name || !p.annual_rate) throw bad('Lender name and annual rate are required');
  const id = insert('lenders', p);
  audit('lender.create', 'lender', id, p.name, ctx.user);
  return { ok: true, id, lender: shapeLender(get('SELECT * FROM lenders WHERE id=?', [id])) };
});

route('PATCH', /^\/api\/admin\/lenders\/(\d+)$/, (ctx) => {
  requirePerm(ctx, 'lenders.write');
  const u = requireStaff(ctx);
  if (u.role !== 'superadmin' && u.role !== 'dealer_admin' && u.role !== 'finance_officer') throw denied('Not allowed');
  const id = Number(ctx.params[0]);
  if (!get('SELECT id FROM lenders WHERE id=?', [id])) throw notFound('Lender not found');
  update('lenders', id, lenderPayload(ctx.body));
  audit('lender.update', 'lender', id, Object.keys(ctx.body).join(','), ctx.user);
  return { ok: true, lender: shapeLender(get('SELECT * FROM lenders WHERE id=?', [id])) };
});

route('DELETE', /^\/api\/admin\/lenders\/(\d+)$/, (ctx) => {
  requirePerm(ctx, 'lenders.write');
  const u = requireStaff(ctx);
  if (u.role !== 'superadmin') throw denied('Only a platform admin can delete a lender');
  run('DELETE FROM lenders WHERE id=?', [Number(ctx.params[0])]);
  audit('lender.delete', 'lender', ctx.params[0], null, ctx.user);
  return { ok: true };
});

route('POST', '/api/admin/dealer-lenders', (ctx) => {
  requirePerm(ctx, 'lenders');
  const u = requireStaff(ctx);
  const dealerId = num(ctx.body.dealer_id) || u.dealer_id;
  assertOwns(ctx, dealerId);
  const lenderId = num(ctx.body.lender_id);
  const enabled = bool(ctx.body.enabled);
  const existing = get('SELECT * FROM dealer_lenders WHERE dealer_id=? AND lender_id=?', [dealerId, lenderId]);
  if (existing) run('UPDATE dealer_lenders SET enabled=? WHERE dealer_id=? AND lender_id=?', [enabled, dealerId, lenderId]);
  else insert('dealer_lenders', { dealer_id: dealerId, lender_id: lenderId, enabled });
  audit('dealer_lender.toggle', 'lender', lenderId, { dealerId, enabled }, ctx.user);
  return { ok: true };
});

/* ---------- admin: applications ---------- */

route('GET', '/api/admin/applications', (ctx) => {
  requirePerm(ctx, 'applications');
  const did = scopeDealer(ctx);
  const where = [];
  const params = [];
  if (did) {
    where.push('a.dealer_id=?');
    params.push(did);
  }
  if (ctx.query.status) {
    where.push('a.status=?');
    params.push(ctx.query.status);
  }
  if (ctx.query.lenderId) {
    where.push('a.lender_id=?');
    params.push(num(ctx.query.lenderId));
  }
  if (ctx.query.assigned) {
    where.push('a.assigned_to=?');
    params.push(num(ctx.query.assigned));
  }
  if (ctx.query.q) {
    where.push('(a.ref LIKE ? OR a.applicant LIKE ?)');
    const s = `%${ctx.query.q}%`;
    params.push(s, s);
  }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = all(
    `SELECT a.*, l.name lender_name, l.short_name lender_short, l.logo_text lender_logo, l.color lender_color,
            l.type lender_type, d.name dealer_name, u.name assigned_name,
            b.name introduced_name
     FROM applications a
     LEFT JOIN lenders l ON l.id=a.lender_id
     LEFT JOIN dealers d ON d.id=a.dealer_id
     LEFT JOIN users u ON u.id=a.assigned_to
     LEFT JOIN users b ON b.id=a.introduced_by
     ${w} ORDER BY a.id DESC LIMIT ?`,
    [...params, Math.min(500, num(ctx.query.limit, 200))]
  );
  return { items: rows.map((r) => shapeApplication(r)), statuses: APP_STATUSES };
});

route('GET', /^\/api\/admin\/applications\/(\d+)$/, (ctx) => {
  requirePerm(ctx, 'applications');
  const a = get(
    `SELECT a.*, l.name lender_name, l.short_name lender_short, l.color lender_color, l.type lender_type,
            l.requirements lender_requirements, d.name dealer_name, u.name assigned_name,
            b.name introduced_name
     FROM applications a LEFT JOIN lenders l ON l.id=a.lender_id LEFT JOIN dealers d ON d.id=a.dealer_id
     LEFT JOIN users u ON u.id=a.assigned_to
     LEFT JOIN users b ON b.id=a.introduced_by WHERE a.id=?`,
    [Number(ctx.params[0])]
  );
  if (!a) throw notFound('Application not found');
  assertOwns(ctx, a.dealer_id);
  const shaped = shapeApplication(a, { withEvents: true, reveal: true });
  shaped.lender_requirements = J(a.lender_requirements, []);
  /* Everything between the finance and the keys, so one screen answers both halves. */
  shaped.deal = dealState(a);
  shaped.signatures = all('SELECT * FROM signatures WHERE application_id=? ORDER BY signed_at', [a.id])
    .map(publicSignature);
  return shaped;
});

route('PATCH', /^\/api\/admin\/applications\/(\d+)$/, (ctx) => {
  requirePerm(ctx, 'applications.decide');
  const u = requireStaff(ctx);
  const id = Number(ctx.params[0]);
  const a = get('SELECT * FROM applications WHERE id=?', [id]);
  if (!a) throw notFound('Application not found');
  assertOwns(ctx, a.dealer_id);
  const patch = { updated_at: new Date().toISOString() };
  if (ctx.body.status) {
    if (!APP_STATUSES.includes(ctx.body.status)) throw bad('Unknown status');
    patch.status = ctx.body.status;
    /* The day the money actually moved, stamped ONCE.
       Everything this platform invoices is counted from it, so it must not move when the
       deal is touched again - a statement for a closed month cannot be allowed to change
       because somebody edited a record in March. Only the first arrival at disbursed
       counts, and a deal that goes back and forth keeps the original date. */
    if (ctx.body.status === 'disbursed' && !a.funded_at) patch.funded_at = new Date().toISOString();
  }
  if (ctx.body.assigned_to !== undefined) patch.assigned_to = resolveAssignee(ctx, ctx.body.assigned_to, a.dealer_id, a.assigned_to);
  if (ctx.body.stage_note !== undefined) patch.stage_note = str(ctx.body.stage_note);
  if (ctx.body.lender_id) {
    const lender = get('SELECT * FROM lenders WHERE id=?', [num(ctx.body.lender_id)]);
    if (!lender) throw notFound('Lender not found');
    const snap = J(a.vehicle_snapshot, null);
    const emp = J(a.employment, {});
    const offer = fin.quote(lender, {
      price: a.price,
      deposit: a.deposit,
      tenorMonths: a.tenor_months,
      vehicle: snap,
      applicant: { netIncome: num(emp.netIncome), obligations: num(emp.obligations), employment: emp.type, crbClean: emp.crbClean !== false },
    });
    patch.lender_id = lender.id;
    patch.offer = JSON.stringify(offer);
    patch.loan_amount = offer.principal;
    patch.monthly_payment = offer.monthlyPayment;
    patch.deposit = offer.deposit;
    insert('application_events', { application_id: id, type: 'lender_changed', actor: u.name, message: `Re-quoted with ${lender.name}: KES ${offer.monthlyPayment.toLocaleString()}/month.` });
  }
  if (ctx.body.tenor_months || ctx.body.deposit) {
    const lender = get('SELECT * FROM lenders WHERE id=?', [patch.lender_id || a.lender_id]);
    if (lender) {
      const emp = J(a.employment, {});
      const offer = fin.quote(lender, {
        price: a.price,
        deposit: ctx.body.deposit !== undefined ? num(ctx.body.deposit) : a.deposit,
        tenorMonths: ctx.body.tenor_months ? num(ctx.body.tenor_months) : a.tenor_months,
        vehicle: J(a.vehicle_snapshot, null),
        applicant: { netIncome: num(emp.netIncome), obligations: num(emp.obligations), employment: emp.type, crbClean: emp.crbClean !== false },
      });
      patch.offer = JSON.stringify(offer);
      patch.deposit = offer.deposit;
      patch.tenor_months = offer.tenorMonths;
      patch.loan_amount = offer.principal;
      patch.monthly_payment = offer.monthlyPayment;
      insert('application_events', { application_id: id, type: 'restructured', actor: u.name, message: `Restructured to ${offer.tenorMonths} months at KES ${offer.monthlyPayment.toLocaleString()}/month.` });
    }
  }
  update('applications', id, patch);
  if (patch.status) {
    insert('application_events', {
      application_id: id,
      type: 'status',
      actor: u.name,
      message: `Status moved to ${patch.status.replace(/_/g, ' ')}${ctx.body.note ? ` — ${ctx.body.note}` : ''}.`,
    });
    // keep the car in step with the deal
    if (a.vehicle_id) {
      if (['approved', 'submitted_to_lender', 'under_review', 'documents_pending'].includes(patch.status))
        run("UPDATE vehicles SET status='reserved' WHERE id=? AND status='available'", [a.vehicle_id]);
      if (['disbursed', 'delivered'].includes(patch.status)) run("UPDATE vehicles SET status='sold' WHERE id=?", [a.vehicle_id]);
      if (['declined', 'cancelled'].includes(patch.status)) run("UPDATE vehicles SET status='available' WHERE id=? AND status='reserved'", [a.vehicle_id]);
    }
  }
  audit('application.update', 'application', id, patch, u);
  return { ok: true, application: shapeApplication(get('SELECT * FROM applications WHERE id=?', [id]), { withEvents: true, reveal: true }) };
});

route('POST', /^\/api\/admin\/applications\/(\d+)\/notes$/, (ctx) => {
  requirePerm(ctx, 'applications');
  const u = requireStaff(ctx);
  const id = Number(ctx.params[0]);
  const a = get('SELECT * FROM applications WHERE id=?', [id]);
  if (!a) throw notFound('Application not found');
  assertOwns(ctx, a.dealer_id);
  const message = str(ctx.body.message);
  if (!message) throw bad('Note cannot be empty');
  insert('application_events', { application_id: id, type: str(ctx.body.type) || 'note', actor: u.name, message });
  return { ok: true, events: all('SELECT * FROM application_events WHERE application_id=? ORDER BY id DESC', [id]) };
});

route('GET', /^\/api\/admin\/documents\/(\d+)$/, (ctx) => {
  requirePerm(ctx, 'applications');
  const d = get('SELECT * FROM application_documents WHERE id=?', [Number(ctx.params[0])]);
  if (!d) throw notFound('Document not found');
  const a = get('SELECT dealer_id FROM applications WHERE id=?', [d.application_id]);
  assertOwns(ctx, a.dealer_id);
  audit('document.view', 'document', d.id, { application: d.application_id }, ctx.user);
  return { ...d, data: sec.decrypt(d.data) };
});

/* ---------- admin: leads ---------- */

route('GET', '/api/admin/leads', (ctx) => {
  requirePerm(ctx, 'leads');
  const did = scopeDealer(ctx);
  const where = [];
  const params = [];
  if (did) {
    where.push('l.dealer_id=?');
    params.push(did);
  }
  if (ctx.query.type) {
    where.push('l.type=?');
    params.push(ctx.query.type);
  }
  if (ctx.query.status) {
    where.push('l.status=?');
    params.push(ctx.query.status);
  }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  return all(
    `SELECT l.*, v.make, v.model, v.year, d.name dealer_name FROM leads l
     LEFT JOIN vehicles v ON v.id=l.vehicle_id LEFT JOIN dealers d ON d.id=l.dealer_id
     ${w} ORDER BY l.id DESC LIMIT 300`,
    params
  ).map((r) => ({ ...r, payload: J(r.payload, {}) }));
});

route('PATCH', /^\/api\/admin\/leads\/(\d+)$/, (ctx) => {
  requirePerm(ctx, 'leads');
  const u = requireStaff(ctx);
  const id = Number(ctx.params[0]);
  const l = get('SELECT * FROM leads WHERE id=?', [id]);
  if (!l) throw notFound('Lead not found');
  assertOwns(ctx, l.dealer_id);
  const patch = {};
  if (ctx.body.status) patch.status = str(ctx.body.status);
  if (ctx.body.assigned_to !== undefined) patch.assigned_to = resolveAssignee(ctx, ctx.body.assigned_to, l.dealer_id, l.assigned_to);
  update('leads', id, patch);
  audit('lead.update', 'lead', id, patch, u);
  return { ok: true };
});

/* ---------- admin: pre-qualifications ---------- */

route('GET', '/api/admin/prequalifications', (ctx) => {
  requirePerm(ctx, 'prequal');
  const did = scopeDealer(ctx);
  const where = [];
  const params = [];
  if (did) {
    where.push('p.dealer_id=?');
    params.push(did);
  }
  if (ctx.query.status) {
    where.push('p.status=?');
    params.push(ctx.query.status);
  }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  return all(
    `SELECT p.*, d.name dealer_name, v.make, v.model, v.year, u.name assigned_name
     FROM prequalifications p
     LEFT JOIN dealers d ON d.id=p.dealer_id
     LEFT JOIN vehicles v ON v.id=p.vehicle_id
     LEFT JOIN users u ON u.id=p.assigned_to
     ${w} ORDER BY p.id DESC LIMIT 300`,
    params
  ).map((r) => ({ ...r, applicant: J(r.applicant, {}), results: J(r.results, []) }));
});

route('PATCH', /^\/api\/admin\/prequalifications\/(\d+)$/, (ctx) => {
  requirePerm(ctx, 'prequal');
  const u = requireStaff(ctx);
  const id = Number(ctx.params[0]);
  const p = get('SELECT * FROM prequalifications WHERE id=?', [id]);
  if (!p) throw notFound('Pre-qualification not found');
  assertOwns(ctx, p.dealer_id);
  const patch = {};
  if (ctx.body.status) patch.status = str(ctx.body.status);
  if (ctx.body.assigned_to !== undefined) patch.assigned_to = resolveAssignee(ctx, ctx.body.assigned_to, p.dealer_id, p.assigned_to);
  update('prequalifications', id, patch);
  audit('prequalify.update', 'prequalification', id, patch, u);
  return { ok: true };
});

/* ---------- admin: orders / payments ---------- */

route('GET', '/api/admin/orders', (ctx) => {
  requirePerm(ctx, 'bookings');
  const did = scopeDealer(ctx);
  const where = [];
  const params = [];
  if (did) {
    where.push('o.dealer_id=?');
    params.push(did);
  }
  if (ctx.query.status) {
    where.push('o.status=?');
    params.push(str(ctx.query.status));
  }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  return all(
    `SELECT o.*, v.make, v.model, v.year, d.name dealer_name FROM orders o
     LEFT JOIN vehicles v ON v.id=o.vehicle_id LEFT JOIN dealers d ON d.id=o.dealer_id
     ${w} ORDER BY o.id DESC LIMIT 300`,
    params
  ).map((r) => ({ ...r, customer: J(r.customer, {}), vehicle_snapshot: J(r.vehicle_snapshot, {}), utm: J(r.utm, null) }));
});

route('PATCH', /^\/api\/admin\/orders\/(\d+)$/, (ctx) => {
  requirePerm(ctx, 'bookings');
  const u = requireStaff(ctx);
  const id = Number(ctx.params[0]);
  const o = get('SELECT * FROM orders WHERE id=?', [id]);
  if (!o) throw notFound('Booking not found');
  assertOwns(ctx, o.dealer_id);
  const status = sec.V.enum(ctx.body.status, ['pending', 'paid', 'failed', 'cancelled', 'refunded'], { field: 'Status', required: true });

  if (status === 'paid') {
    com.markPaid(o, { receipt: sec.V.string(ctx.body.receipt, { max: 40 }) });
  } else {
    update('orders', id, { status });
    com.event(id, status, `Marked ${status} by ${u.name}.`);
    if (['cancelled', 'refunded', 'failed'].includes(status) && o.vehicle_id) {
      run("UPDATE vehicles SET status='available' WHERE id=? AND status='reserved'", [o.vehicle_id]);
    }
  }
  audit('order.update', 'order', id, { status }, u);
  return { ok: true, order: get('SELECT * FROM orders WHERE id=?', [id]) };
});

/* ---------- admin: fuel prices ---------- */

route('GET', '/api/admin/fuel', (ctx) => {
  requirePerm(ctx, 'costs');
  return jobs.fuelStatus();
});

route('POST', '/api/admin/fuel/refresh', async (ctx) => {
  requirePerm(ctx, 'costs');
  const u = requireStaff(ctx);
  if (u.role !== 'superadmin' && u.role !== 'dealer_admin') throw denied('Only admins can refresh prices');
  const result = await jobs.refreshFuelPrices({ force: true });
  return { ...result, status: jobs.fuelStatus() };
});

/* ---------- admin: dealers, branches, users ---------- */

route('POST', '/api/admin/dealers', (ctx) => {
  const u = requireStaff(ctx);
  if (u.role !== 'superadmin') throw denied('Only a platform admin can add a dealership');
  const b = ctx.body;
  const slug = (str(b.slug) || str(b.name) || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!slug || !str(b.name)) throw bad('Name is required');
  if (get('SELECT id FROM dealers WHERE slug=?', [slug])) throw bad('That slug is taken');
  const id = insert('dealers', {
    slug,
    name: str(b.name),
    tagline: str(b.tagline),
    logo_text: str(b.logo_text) || str(b.name).slice(0, 2).toUpperCase(),
    primary_color: str(b.primary_color) || '#c8102e',
    accent_color: str(b.accent_color) || '#0b1f3a',
    phone: str(b.phone),
    whatsapp: str(b.whatsapp),
    email: str(b.email),
    address: str(b.address),
    city: str(b.city),
    about: str(b.about),
    active: b.active === undefined ? 1 : bool(b.active),
  });
  audit('dealer.create', 'dealer', id, str(b.name), u);
  return { ok: true, id, dealer: get('SELECT * FROM dealers WHERE id=?', [id]) };
});

route('PATCH', /^\/api\/admin\/dealers\/(\d+)$/, (ctx) => {
  requirePerm(ctx, 'dealership');
  const u = requireStaff(ctx);
  const id = Number(ctx.params[0]);
  assertOwns(ctx, id);
  const b = ctx.body;
  const patch = {};
  for (const f of ['name', 'tagline', 'logo_text', 'primary_color', 'accent_color', 'phone', 'whatsapp', 'email', 'address', 'city', 'about'])
    if (b[f] !== undefined) patch[f] = str(b[f]);
  if (b.active !== undefined && u.role === 'superadmin') patch.active = bool(b.active);
  update('dealers', id, patch);
  audit('dealer.update', 'dealer', id, patch, u);
  return { ok: true, dealer: get('SELECT * FROM dealers WHERE id=?', [id]) };
});

route('GET', '/api/admin/branches', (ctx) => {
  requirePerm(ctx, 'dealership');
  const did = scopeDealer(ctx);
  return did ? all('SELECT * FROM branches WHERE dealer_id=? ORDER BY id', [did]) : all('SELECT b.*, d.name dealer_name FROM branches b JOIN dealers d ON d.id=b.dealer_id ORDER BY b.dealer_id, b.id');
});

route('POST', '/api/admin/branches', (ctx) => {
  requirePerm(ctx, 'dealership');
  const u = requireStaff(ctx);
  const dealerId = num(ctx.body.dealer_id) || u.dealer_id;
  assertOwns(ctx, dealerId);
  if (!str(ctx.body.name)) throw bad('Branch name is required');
  const id = insert('branches', {
    dealer_id: dealerId,
    name: str(ctx.body.name),
    city: str(ctx.body.city),
    address: str(ctx.body.address),
    phone: str(ctx.body.phone),
  });
  return { ok: true, id };
});

route('DELETE', /^\/api\/admin\/branches\/(\d+)$/, (ctx) => {
  requirePerm(ctx, 'dealership');
  const b = get('SELECT * FROM branches WHERE id=?', [Number(ctx.params[0])]);
  if (!b) throw notFound('Branch not found');
  assertOwns(ctx, b.dealer_id);
  run('DELETE FROM branches WHERE id=?', [b.id]);
  return { ok: true };
});

route('GET', '/api/admin/users', (ctx) => {
  requirePerm(ctx, 'staff');
  const did = scopeDealer(ctx);
  const w = did ? 'WHERE u.dealer_id=?' : '';
  const p = did ? [did] : [];
  return all(
    `SELECT u.id,u.name,u.email,u.phone,u.role,u.active,u.last_login,u.created_at,u.dealer_id,d.name dealer_name
     FROM users u LEFT JOIN dealers d ON d.id=u.dealer_id ${w} ORDER BY u.id`,
    p
  );
});

route('POST', '/api/admin/users', (ctx) => {
  requirePerm(ctx, 'staff');
  const u = requireStaff(ctx);
  if (u.role !== 'superadmin' && u.role !== 'dealer_admin') throw denied('Only admins can add staff');
  const b = ctx.body;
  const email = str(b.email || '').toLowerCase();
  if (!email || !str(b.name) || !str(b.password)) throw bad('Name, email and password are required');
  if (get('SELECT id FROM users WHERE email=?', [email])) throw bad('That email already exists');
  const role = auth.STAFF_ROLES.includes(b.role) ? b.role : 'sales_agent';
  if (role === 'superadmin' && u.role !== 'superadmin') throw denied('Cannot create a platform admin');
  const dealerId = u.role === 'superadmin' ? (b.dealer_id ? num(b.dealer_id) : null) : u.dealer_id;
  const { hash, salt } = auth.hashPassword(String(b.password));
  const id = insert('users', { name: str(b.name), email, phone: str(b.phone), role, dealer_id: dealerId, password_hash: hash, salt });
  audit('user.create', 'user', id, { email, role }, u);
  return { ok: true, id };
});

route('PATCH', /^\/api\/admin\/users\/(\d+)$/, (ctx) => {
  requirePerm(ctx, 'staff');
  const u = requireStaff(ctx);
  if (u.role !== 'superadmin' && u.role !== 'dealer_admin') throw denied('Only admins can edit staff');
  const id = Number(ctx.params[0]);
  const target = get('SELECT * FROM users WHERE id=?', [id]);
  if (!target) throw notFound('User not found');
  if (u.role !== 'superadmin' && Number(target.dealer_id) !== Number(u.dealer_id)) throw denied('Different dealership');
  const patch = {};
  for (const f of ['name', 'phone']) if (ctx.body[f] !== undefined) patch[f] = str(ctx.body[f]);
  if (ctx.body.role && auth.STAFF_ROLES.concat('customer').includes(ctx.body.role)) {
    if (ctx.body.role === 'superadmin' && u.role !== 'superadmin') throw denied('Cannot grant platform admin');
    patch.role = ctx.body.role;
  }
  if (ctx.body.active !== undefined) patch.active = bool(ctx.body.active);
  if (ctx.body.password) {
    const { hash, salt } = auth.hashPassword(String(ctx.body.password));
    patch.password_hash = hash;
    patch.salt = salt;
  }
  update('users', id, patch);
  audit('user.update', 'user', id, Object.keys(patch).join(','), u);
  return { ok: true };
});

route('GET', '/api/admin/audit', (ctx) => {
  requirePerm(ctx, 'audit');
  return all('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?', [Math.min(500, num(ctx.query.limit, 100))]);
});

route('GET', '/api/admin/settings', (ctx) => {
  requirePerm(ctx, 'dealership');
  const rows = all('SELECT * FROM settings');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
});

route('POST', '/api/admin/settings', (ctx) => {
  requirePerm(ctx, 'dealership');
  const u = requireStaff(ctx);
  if (u.role !== 'superadmin') throw denied('Only a platform admin can change settings');
  Object.entries(ctx.body || {}).forEach(([k, v]) => setSetting(k, v));
  return { ok: true };
});

/* ---------- CSV export ---------- */

function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n');
}

route('GET', /^\/api\/admin\/export\/(vehicles|applications|leads|lenders|prequalifications)$/, (ctx) => {
  requireStaff(ctx);
  const did = scopeDealer(ctx);
  const entity = ctx.params[0];
  let rows = [];
  if (entity === 'vehicles') rows = all(`SELECT id,make,model,variant,year,price,condition,body_type,fuel,transmission,mileage_km,color,status,views FROM vehicles ${did ? 'WHERE dealer_id=?' : ''} ORDER BY id`, did ? [did] : []);
  if (entity === 'lenders') rows = all('SELECT id,name,type,rate_type,annual_rate,min_deposit_pct,max_tenor_months,min_monthly_income,max_dti_pct,approval_days,active FROM lenders ORDER BY sort_order');
  if (entity === 'leads') rows = all(`SELECT id,type,name,phone,email,status,created_at FROM leads ${did ? 'WHERE dealer_id=?' : ''} ORDER BY id DESC`, did ? [did] : []);
  if (entity === 'prequalifications')
    rows = all(
      `SELECT id,ref,name,phone,email,target_price,deposit,tenor_months,approved_count,best_monthly,status,created_at
       FROM prequalifications ${did ? 'WHERE dealer_id=?' : ''} ORDER BY id DESC`,
      did ? [did] : []
    );
  if (entity === 'applications') {
    rows = all(
      `SELECT a.id,a.ref,a.status,a.price,a.deposit,a.loan_amount,a.tenor_months,a.monthly_payment,a.created_at,
              l.name lender, a.applicant
       FROM applications a LEFT JOIN lenders l ON l.id=a.lender_id ${did ? 'WHERE a.dealer_id=?' : ''} ORDER BY a.id DESC`,
      did ? [did] : []
    ).map((r) => {
      const ap = J(r.applicant, {});
      delete r.applicant;
      return { ...r, customer: ap.fullName || '', phone: ap.phone || '' };
    });
  }
  return { __csv: toCsv(rows), __filename: `${entity}-${new Date().toISOString().slice(0, 10)}.csv` };
});

/* ---------- reset (demo convenience) ---------- */

route('POST', '/api/admin/demo/reset-applications', (ctx) => {
  const u = requireStaff(ctx);
  if (u.role !== 'superadmin') throw denied('Platform admin only');
  run('DELETE FROM application_events');
  run('DELETE FROM application_documents');
  run('DELETE FROM applications');
  run('DELETE FROM leads');
  run('DELETE FROM prequalifications');
  run("UPDATE vehicles SET status='available' WHERE status IN ('reserved','sold')");
  audit('demo.reset', null, null, 'applications and leads cleared', u);
  return { ok: true };
});

module.exports = { routes, ApiError, APP_STATUSES, shapeVehicle, shapeLender, toCsv };
