'use strict';
/**
 * MotoKE — stock ageing, for the dealership rather than the buyer.
 *
 * Every dealer management system leads on the same numbers because they are the ones that
 * decide whether a yard makes money. A car sitting on the forecourt is not idle stock: it
 * is money borrowed against, depreciating, with floor-plan interest running. The industry
 * flags at 45 and 60 days for exactly that reason — past 60 the margin is usually gone.
 *
 * MotoKE knew how many cars were in stock and nothing about how long they had been there,
 * which is the first question any dealer principal asks.
 *
 * The genuinely useful view here is the last one: cars that are BOTH old stock AND priced
 * above comparable cars. Those are not slow because of the market. They are slow because
 * of the price, and they are the list to act on this morning.
 */

const val = require('./valuation');
const market = require('./market');

/** Where the money starts leaking. Named so the numbers are not magic. */
const FRESH_DAYS = 30;
const WATCH_DAYS = 45;
const STALE_DAYS = 60;

const BUCKETS = [
  { key: 'fresh', label: '0–30 days', max: FRESH_DAYS, tone: 'ok', note: 'Still selling itself.' },
  { key: 'watch', label: '31–45 days', max: WATCH_DAYS, tone: '', note: 'Worth a second look at the price.' },
  { key: 'ageing', label: '46–60 days', max: STALE_DAYS, tone: 'warn', note: 'Interest and depreciation are biting.' },
  { key: 'stale', label: 'Over 60 days', max: Infinity, tone: 'err', note: 'Reprice, move it, or send it to auction.' },
];

const DAY = 86400000;

/** Whole days between a stored timestamp and now. Never negative. */
function daysSince(iso, now = Date.now()) {
  if (!iso) return 0;
  const t = new Date(String(iso).replace(' ', 'T')).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((now - t) / DAY));
}

function bucketFor(days) {
  return BUCKETS.find((b) => days <= b.max) || BUCKETS[BUCKETS.length - 1];
}

/**
 * Floor-plan carrying cost: what it costs to keep one car on the forecourt.
 *
 * Interest on the money tied up, plus the value the car quietly loses while it sits.
 * Expressed per day so a manager can read "this car has cost us X to not sell".
 */
function carryingCost(price, days, { annualRate = 0.16, annualDepreciation = 0.14 } = {}) {
  if (!price || !days) {
    return { interest: 0, depreciation: 0, total: 0, perDay: 0, depreciationRatePct: +(annualDepreciation * 100).toFixed(1) };
  }
  const interest = (price * annualRate * days) / 365;
  const depreciation = (price * annualDepreciation * days) / 365;
  const total = interest + depreciation;
  return {
    interest: Math.round(interest),
    depreciation: Math.round(depreciation),
    total: Math.round(total),
    perDay: Math.round(total / days),
    /* Returned so the ageing table can show that two cars in the same bucket are not
       losing money at the same speed. */
    depreciationRatePct: +(annualDepreciation * 100).toFixed(1),
  };
}

/**
 * How fast THIS car loses value, not how fast cars in general do.
 *
 * A flat 14% a year was the old assumption and it is wrong in both directions: a Land
 * Cruiser holds on far better than that, and a big-engined executive saloon falls faster.
 * `market.resale` already knows the badge, body, fuel and engine, so ask it for one year
 * and read the loss straight off.
 */
function depreciationRate(v, fallback = 0.14) {
  if (!v || !v.make) return fallback;
  const age = v.year ? Math.max(0, new Date().getFullYear() - Number(v.year)) : 0;
  const r = market.resale(v.price || 1, v.make, 1, age, {
    bodyType: v.body_type,
    fuel: v.fuel,
    engineCc: v.engine_cc,
  });
  return Math.max(0.04, Math.min(0.25, 1 - r.retentionPerYear / 100));
}

/**
 * Carrying cost for one specific car, using that car's own depreciation curve.
 *
 * `opts.annualDepreciation` is the FALLBACK, not an override — it applies to a car whose
 * badge we do not have a curve for. A real per-car figure always wins, because the whole
 * point of this screen is that a Land Cruiser and an E-Class do not bleed at the same rate.
 */
function carryingFor(v, days, opts = {}) {
  const fallback = opts.annualDepreciation != null ? Number(opts.annualDepreciation) : 0.14;
  return carryingCost(v.price, days, { ...opts, annualDepreciation: depreciationRate(v, fallback) });
}

/**
 * The whole ageing picture for one yard.
 *
 * @param vehicles every vehicle in the dealership, whatever its status
 * @param opts.now overridable so the tests are not hostage to the clock
 */
function ageing(vehicles, opts = {}) {
  const now = opts.now || Date.now();
  const live = (vehicles || []).filter((v) => v.status === 'available' || v.status === 'reserved');
  const sold = (vehicles || []).filter((v) => v.status === 'sold');

  const rows = live.map((v) => {
    const days = daysSince(v.created_at, now);
    const b = bucketFor(days);
    return {
      id: v.id,
      title: `${v.year} ${v.make} ${v.model}${v.variant ? ' ' + v.variant : ''}`,
      make: v.make,
      price: v.price,
      status: v.status,
      views: v.views || 0,
      days,
      bucket: b.key,
      bucketLabel: b.label,
      tone: b.tone,
      carrying: carryingFor(v, days, opts),
    };
  });

  const buckets = BUCKETS.map((b) => {
    const inIt = rows.filter((r) => r.bucket === b.key);
    return {
      ...b,
      max: undefined,
      count: inIt.length,
      value: inIt.reduce((s, r) => s + (r.price || 0), 0),
      carrying: inIt.reduce((s, r) => s + r.carrying.total, 0),
    };
  });

  /* Turn rate per make, from what has actually sold. A lot-wide average hides which
     models are dragging it down, which is the whole reason to break it out. */
  const byMake = {};
  for (const v of live) {
    byMake[v.make] = byMake[v.make] || { make: v.make, inStock: 0, sold: 0, totalDays: 0 };
    byMake[v.make].inStock++;
    byMake[v.make].totalDays += daysSince(v.created_at, now);
  }
  for (const v of sold) {
    byMake[v.make] = byMake[v.make] || { make: v.make, inStock: 0, sold: 0, totalDays: 0 };
    byMake[v.make].sold++;
  }
  const makes = Object.values(byMake)
    .map((m) => ({
      make: m.make,
      inStock: m.inStock,
      sold: m.sold,
      avgDays: m.inStock ? Math.round(m.totalDays / m.inStock) : 0,
      /* Sold against the total we have handled. A make with nothing sold reports null
         rather than 0% — no evidence is not the same as bad evidence. */
      sellThrough: m.inStock + m.sold ? Math.round((m.sold / (m.inStock + m.sold)) * 100) : null,
    }))
    .sort((a, b) => b.avgDays - a.avgDays);

  const totalDays = rows.reduce((s, r) => s + r.days, 0);

  return {
    total: rows.length,
    averageDays: rows.length ? Math.round(totalDays / rows.length) : 0,
    medianDays: rows.length ? val.median(rows.map((r) => r.days)) : 0,
    stockValue: rows.reduce((s, r) => s + (r.price || 0), 0),
    carryingTotal: rows.reduce((s, r) => s + r.carrying.total, 0),
    buckets,
    makes,
    oldest: [...rows].sort((a, b) => b.days - a.days).slice(0, 10),
    thresholds: { fresh: FRESH_DAYS, watch: WATCH_DAYS, stale: STALE_DAYS },
  };
}

/**
 * The morning list: cars that are old stock AND priced above comparable stock.
 *
 * Old-and-fairly-priced is a market problem. Old-and-dear is a price problem, and it is
 * the only one the yard can fix today. Combining the two signals is the point — either
 * alone produces a list too long to act on.
 */
function repricingList(vehicles, opts = {}) {
  const now = opts.now || Date.now();
  const live = (vehicles || []).filter((v) => v.status === 'available');
  const out = [];

  for (const v of live) {
    const days = daysSince(v.created_at, now);
    if (days < WATCH_DAYS) continue;

    const pc = val.priceIndicator(v, live);
    // No comparables means no opinion. Better to say nothing than guess.
    if (!pc || !pc.enough) continue;
    if (!['fair', 'high'].includes(pc.band)) continue;

    out.push({
      id: v.id,
      title: `${v.year} ${v.make} ${v.model}${v.variant ? ' ' + v.variant : ''}`,
      price: v.price,
      days,
      views: v.views || 0,
      band: pc.band,
      label: pc.label,
      typicalPrice: pc.typicalPrice,
      overBy: pc.cheaper ? 0 : pc.difference,
      suggested: Math.round((pc.typicalPrice * 0.99) / 10000) * 10000,
      carrying: carryingFor(v, days, opts),
      why: `${days} days in stock and ${pc.percent}% above ${pc.sample} comparable cars.`,
    });
  }

  // Worst first: the most over-priced, oldest stock is where the money is.
  return out.sort((a, b) => b.overBy - a.overBy || b.days - a.days);
}

module.exports = {
  ageing, repricingList, carryingCost, carryingFor, depreciationRate, daysSince, bucketFor,
  BUCKETS, FRESH_DAYS, WATCH_DAYS, STALE_DAYS,
};
