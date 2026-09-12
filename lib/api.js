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
const jobs = require('./jobs');
const com = require('./commerce');
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

  // Staff accounts carry a second factor. Customers do not need one to browse cars.
  if (auth.isStaff(u) && getSetting('require_staff_2fa', 'on') === 'on') {
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
