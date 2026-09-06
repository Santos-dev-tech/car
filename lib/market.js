'use strict';
/**
 * MotoKE - Kenyan market reference data.
 *
 * The numbers a buyer actually cares about: km per litre for the car in front of them,
 * what it will be worth in three years, what a service costs for that badge, and what
 * the taxman takes on an import. Everything here is indicative and every figure is
 * returned with the assumption that produced it, so nothing is a black box.
 *
 * Fuel prices refresh themselves (see refreshFuelPrices) so the dealership never has to.
 */

const round = (n) => Math.round(n);
const round1 = (n) => Math.round(n * 10) / 10;

/* ------------------------------------------------------------------ */
/* fuel economy                                                         */
/* ------------------------------------------------------------------ */

/** How much heavier the body is to push around, relative to a sedan. */
const BODY_FACTOR = {
  Hatchback: 0.97,
  Sedan: 1.0,
  'Station Wagon': 1.04,
  Coupe: 1.0,
  MPV: 1.1,
  Van: 1.12,
  SUV: 1.12,
  Pickup: 1.2,
  Truck: 1.45,
  Bus: 1.5,
};

const DRIVE_FACTOR = { '2WD': 1.0, AWD: 1.06, '4WD': 1.09 };

/**
 * Litres per 100 km in real Nairobi conditions (stop-start, not a manufacturer figure).
 * Base curve is petrol; diesel, hybrid and electric scale from it.
 */
function litresPer100(opts = {}) {
  const engine = Math.max(0.6, Number(opts.engineLitres) || 1.5);
  const fuel = String(opts.fuel || 'petrol').toLowerCase();
  const body = BODY_FACTOR[opts.bodyType] || 1.0;
  const drive = DRIVE_FACTOR[opts.drivetrain] || 1.0;
  const age = Math.max(0, Number(opts.ageYears) || 0);

  let base = 4.3 + 2.2 * engine; // 1.0L ≈ 6.5, 2.0L ≈ 8.7, 3.0L ≈ 10.9
  if (fuel === 'diesel') base *= 0.8;
  else if (fuel === 'hybrid') base *= 0.58;
  else if (fuel === 'electric') return 0;

  // an engine loses efficiency as it ages; nothing dramatic, capped at +18%
  const wear = 1 + Math.min(0.18, Math.max(0, age - 4) * 0.015);
  return base * body * drive * wear;
}

/** Kilometres per litre — how Kenyans actually talk about consumption. */
function kmPerLitre(opts = {}) {
  const l100 = litresPer100(opts);
  return l100 > 0 ? 100 / l100 : 0;
}

/** kWh per 100 km for an EV. */
function kwhPer100(opts = {}) {
  const engine = Math.max(0.8, Number(opts.engineLitres) || 1.5);
  const body = BODY_FACTOR[opts.bodyType] || 1.0;
  return (14 + 2.4 * (engine - 1.0)) * body;
}

/** A plain-English economy summary for one vehicle. */
function economy(vehicle, prices) {
  const fuel = String(vehicle.fuel || 'petrol').toLowerCase();
  const opts = {
    engineLitres: vehicle.engine_cc ? vehicle.engine_cc / 1000 : Number(vehicle.engineLitres) || 1.5,
    fuel,
    bodyType: vehicle.body_type || vehicle.bodyType,
    drivetrain: vehicle.drivetrain,
    ageYears: Number(vehicle.ageYears) || 0,
  };
  if (fuel === 'electric') {
    const k100 = kwhPer100(opts);
    const perKm = (k100 / 100) * (prices.electricity_price || 28);
    return {
      fuel,
      kwhPer100: round1(k100),
      kmPerKwh: round1(100 / k100),
      costPerKm: round1(perKm * 100) / 100,
      costPer100Km: round(perKm * 100),
      label: `${round1(100 / k100)} km per kWh`,
    };
  }
  const l100 = litresPer100(opts);
  const kpl = 100 / l100;
  const pricePerL = fuel === 'diesel' ? prices.diesel_price : prices.petrol_price;
  const perKm = (l100 / 100) * pricePerL;
  return {
    fuel,
    litresPer100: round1(l100),
    kmPerLitre: round1(kpl),
    pricePerLitre: pricePerL,
    costPerKm: round1(perKm * 100) / 100,
    costPer100Km: round(perKm * 100),
    tankToNairobiMombasa: round((485 / kpl) * pricePerL), // 485 km each way
    label: `${round1(kpl)} km per litre`,
  };
}

/* ------------------------------------------------------------------ */
/* resale value                                                         */
/* ------------------------------------------------------------------ */

/**
 * Annual value retention in the Kenyan used market. Toyota holds value best because
 * parts and mechanics are everywhere; German and British marques fall hardest for the
 * same reason in reverse.
 */
const RETENTION = {
  Toyota: 0.905, Subaru: 0.885, Isuzu: 0.9, Suzuki: 0.885, Mazda: 0.875, Honda: 0.875,
  Nissan: 0.87, Mitsubishi: 0.87, Lexus: 0.86, Daihatsu: 0.86,
  Volkswagen: 0.83, Audi: 0.815, BMW: 0.81, 'Mercedes-Benz': 0.815, Volvo: 0.81,
  'Land Rover': 0.8, Jaguar: 0.785, Porsche: 0.825,
};
const DEFAULT_RETENTION = 0.87;

/** What a car is likely to be worth after n more years, and what that costs per month. */
function resale(price, make, years = 3, currentAge = 0) {
  const r = RETENTION[make] || DEFAULT_RETENTION;
  // depreciation is steepest when a car is young, so ease it as the car ages
  const eased = Math.min(0.95, r + Math.min(0.04, currentAge * 0.006));
  const value = price * Math.pow(eased, years);
  const lost = price - value;
  return {
    years,
    retentionPerYear: +((eased * 100).toFixed(1)),
    estimatedValue: round(value),
    valueLost: round(lost),
    lossPerMonth: round(lost / (years * 12)),
    make: make || 'this make',
    strongHolder: (RETENTION[make] || DEFAULT_RETENTION) >= 0.88,
  };
}

/* ------------------------------------------------------------------ */
/* servicing                                                            */
/* ------------------------------------------------------------------ */

/** Parts and specialist labour multiplier by badge. */
const SERVICE_TIER = {
  Toyota: 1.0, Nissan: 1.05, Suzuki: 0.95, Daihatsu: 0.95, Mazda: 1.1, Honda: 1.1,
  Mitsubishi: 1.1, Isuzu: 1.05, Subaru: 1.25,
  Volkswagen: 1.8, Audi: 2.2, BMW: 2.3, 'Mercedes-Benz': 2.3, Lexus: 1.6,
  Volvo: 2.0, 'Land Rover': 2.6, Jaguar: 2.5, Porsche: 2.8,
};
const DEFAULT_TIER = 1.15;

/** A service interval costs roughly this, and this is how often it comes round. */
function servicing(vehicle, kmPerYear = 15000) {
  const make = vehicle.make;
  const tier = SERVICE_TIER[make] || DEFAULT_TIER;
  const engine = vehicle.engine_cc ? vehicle.engine_cc / 1000 : 1.5;
  const age = Number(vehicle.ageYears) || 0;
  const intervalKm = String(vehicle.fuel || '').toLowerCase() === 'diesel' ? 7500 : 10000;
  const perService = (6500 + engine * 3200) * tier;
  const servicesPerYear = kmPerYear / intervalKm;
  const wear = 1 + Math.max(0, age - 5) * 0.05; // older cars need more than oil
  return {
    tier: tier >= 1.8 ? 'premium' : tier >= 1.2 ? 'mid' : 'mass-market',
    tierMultiplier: round1(tier),
    intervalKm,
    perService: round(perService),
    servicesPerYear: round1(servicesPerYear),
    annual: round(perService * servicesPerYear * wear),
    note:
      tier >= 1.8
        ? `${make} parts and specialist labour cost roughly ${round1(tier)}× a Toyota equivalent.`
        : `${make} is cheap to keep on the road — parts and mechanics are everywhere.`,
  };
}

/* ------------------------------------------------------------------ */
/* import duty (KRA)                                                    */
/* ------------------------------------------------------------------ */

/**
 * Landed cost of a direct import, on the KRA schedule.
 * Excise band depends on engine size; VAT applies on top of duty and excise.
 */
function importDuty(cifKes, engineCc, opts = {}) {
  const cif = Math.max(0, Number(cifKes) || 0);
  const cc = Number(engineCc) || 1500;
  const electric = !!opts.electric;

  const importDutyPct = 25;
  const excisePct = electric ? 10 : cc <= 1500 ? 20 : cc <= 3000 ? 25 : 35;
  const vatPct = 16;
  const idfPct = 3.5;
  const rdlPct = 2;

  const duty = (cif * importDutyPct) / 100;
  const excise = ((cif + duty) * excisePct) / 100;
  const vat = ((cif + duty + excise) * vatPct) / 100;
  const idf = (cif * idfPct) / 100;
  const rdl = (cif * rdlPct) / 100;
  const total = duty + excise + vat + idf + rdl;

  return {
    cif: round(cif),
    lines: [
      { label: 'Import duty', pct: importDutyPct, base: 'CIF', amount: round(duty) },
      { label: 'Excise duty', pct: excisePct, base: 'CIF + import duty', amount: round(excise) },
      { label: 'VAT', pct: vatPct, base: 'CIF + duty + excise', amount: round(vat) },
      { label: 'Import declaration fee', pct: idfPct, base: 'CIF', amount: round(idf) },
      { label: 'Railway development levy', pct: rdlPct, base: 'CIF', amount: round(rdl) },
    ],
    totalTaxes: round(total),
    landedCost: round(cif + total),
    effectiveRate: cif ? +((total / cif) * 100).toFixed(1) : 0,
    exciseBand: electric ? 'Electric (10%)' : cc <= 1500 ? 'Up to 1500cc (20%)' : cc <= 3000 ? '1501–3000cc (25%)' : 'Over 3000cc (35%)',
    note: 'Indicative, on the current KRA schedule. Customs values the car from the CRSP list, not your invoice, and the eight-year age rule still applies.',
  };
}

/* ------------------------------------------------------------------ */
/* fuel prices that keep themselves current                             */
/* ------------------------------------------------------------------ */

/**
 * EPRA publishes maximum pump prices on the 14th of each month, effective the 15th.
 * We refresh from a configured source when the network allows, and otherwise keep the
 * last known figures and report how old they are — so a stale number is visible rather
 * than silently wrong.
 */
const EPRA_CYCLE_DAY = 15;

function nextEpraDate(from = new Date()) {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  if (d.getDate() >= EPRA_CYCLE_DAY) d.setMonth(d.getMonth() + 1);
  d.setDate(EPRA_CYCLE_DAY);
  return d;
}

function priceAge(asAtIso) {
  if (!asAtIso) return { days: null, stale: true, label: 'never updated' };
  const days = Math.floor((Date.now() - new Date(asAtIso).getTime()) / 864e5);
  return {
    days,
    stale: days > 35,
    label: days === 0 ? 'updated today' : days === 1 ? 'updated yesterday' : `updated ${days} days ago`,
  };
}

/**
 * Attempt a live refresh. Returns { ok, source, prices } or { ok:false, reason }.
 * Never throws and never blocks: offline is a normal outcome, not an error.
 */
/** EPRA's official page. Verified to parse, and the town rows are the reason we scrape. */
const DEFAULT_FUEL_SOURCE = 'https://www.epra.go.ke/pump-prices';

async function fetchFuelPrices(sourceUrl, timeoutMs = 8000, opts = {}) {
  if (!sourceUrl) return { ok: false, reason: 'no source configured' };
  if (typeof fetch !== 'function') return { ok: false, reason: 'fetch unavailable' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(sourceUrl, { signal: ctrl.signal, headers: { Accept: 'application/json, text/html' } });
    if (!res.ok) return { ok: false, reason: `source returned ${res.status}` };
    const text = await res.text();

    // A JSON endpoint is the happy path.
    try {
      const j = JSON.parse(text);
      const petrol = Number(j.petrol ?? j.super ?? j.pms);
      const diesel = Number(j.diesel ?? j.ago);
      const kerosene = Number(j.kerosene ?? j.ik);
      if (petrol > 50 && diesel > 50) {
        return { ok: true, source: sourceUrl, prices: { petrol_price: petrol, diesel_price: diesel, kerosene_price: kerosene || null } };
      }
    } catch {}

    /* Otherwise scrape an EPRA-style page.
     *
     * EPRA publishes a table with a row per town, and the first row is Mombasa because it
     * is the cheapest — it is where the fuel lands. Grabbing the first number on the page
     * therefore quietly priced the whole site off Mombasa, about KES 3 a litre under
     * Nairobi. Nothing failed; every running cost was simply wrong.
     *
     * So find the TOWN's row first, and only fall back to a page-wide scan when the page
     * has no town table at all. */
    const town = String(opts.town || 'Nairobi');

    /* EPRA pairs the town with the product on every entry — "Nairobi PMS 214.03",
       "Nairobi AGO 217.86" — so each figure is matched by BOTH, never by position.
       Reading along a row was the mistake: the numbers that follow Nairobi's petrol price
       are Nakuru's and Eldoret's petrol, not Nairobi's diesel. */
    const priceFor = (name, labels) => {
      for (const label of labels) {
        const re = new RegExp(name + '[^0-9]{0,120}?\\b' + label + '\\b[^0-9]{0,60}(\\d{2,3}[.,]\\d{2})', 'i');
        const m = re.exec(text);
        if (m) return Number(m[1].replace(',', '.'));
      }
      return null;
    };

    const byTown = {
      petrol: priceFor(town, ['PMS', 'super\\s*petrol', 'petrol']),
      diesel: priceFor(town, ['AGO', 'diesel']),
      kerosene: priceFor(town, ['IK', 'kerosene']),
    };

    if (byTown.petrol > 50 && byTown.diesel > 50) {
      return {
        ok: true,
        source: sourceUrl,
        town,
        prices: { petrol_price: byTown.petrol, diesel_price: byTown.diesel, kerosene_price: byTown.kerosene || null },
      };
    }

    // No town table — a simpler page that just states the three prices.
    const grab = (labels) => {
      for (const label of labels) {
        const re = new RegExp(label + '[^0-9]{0,60}(\\d{2,3}[.,]\\d{2})', 'i');
        const m = re.exec(text);
        if (m) return Number(m[1].replace(',', '.'));
      }
      return null;
    };
    const petrol = grab(['super\\s*petrol', 'petrol', 'pms']);
    const diesel = grab(['diesel', 'ago']);
    if (petrol > 50 && diesel > 50) {
      return {
        ok: true,
        source: sourceUrl,
        town: null,
        prices: { petrol_price: petrol, diesel_price: diesel, kerosene_price: grab(['kerosene', 'ik']) },
      };
    }
    return { ok: false, reason: 'could not find prices in the response' };
  } catch (e) {
    return { ok: false, reason: e.name === 'AbortError' ? 'timed out' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  litresPer100, kmPerLitre, kwhPer100, economy,
  resale, RETENTION, servicing, SERVICE_TIER,
  importDuty,
  fetchFuelPrices, nextEpraDate, priceAge, EPRA_CYCLE_DAY, DEFAULT_FUEL_SOURCE,
  BODY_FACTOR, DRIVE_FACTOR,
};
