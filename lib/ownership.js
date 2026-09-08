'use strict';
/**
 * MotoKE - running cost and insurance models.
 *
 * "It's not just the monthly payment." A buyer's real outgoing is the instalment plus
 * fuel, insurance, servicing, tyres and statutory fees. These are indicative Kenyan
 * figures; every assumption is returned alongside the number so nothing is a black box,
 * and the rates live in settings so a dealership can tune them.
 */

const market = require('./market');

const round = (n) => Math.round(n);

/** Defaults, all overridable from Admin -> Settings. */
const DEFAULTS = {
  petrol_price: 195, // KES / litre
  diesel_price: 180,
  electricity_price: 28, // KES / kWh
  third_party_premium: 7500, // KES / year
  insurance_min_premium: 25000,
  licensing_fee: 3000, // annual licensing + inspection, indicative
  tyre_set_cost_pct: 1.1, // % of vehicle value for a set of four
  tyre_life_km: 45000,
  /* Conditions Kenyan lenders IMPOSE on a financed car, which the borrower pays for and
     which were missing from every figure on this site. Leaving them out made the deposit
     look cheaper than it is, which is the one number a buyer plans around. */
  tracker_fitting: 12000, // one-off, at the borrower's cost, to the lender's spec
  tracker_monthly: 1200, // ongoing subscription, required for the whole term
  ntsa_incharge_fee: 3500, // registering the lender's interest against the logbook
};

function settings(overrides = {}) {
  const s = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) {
    if (overrides[k] !== undefined && overrides[k] !== null && overrides[k] !== '') s[k] = Number(overrides[k]);
  }
  return s;
}

/** Litres per 100 km for a combined Nairobi cycle. */
function consumption(engineLitres, fuel) {
  const e = Math.max(0.6, Number(engineLitres) || 1.5);
  const petrol = 5.4 + 2.7 * (e - 1.0); // 1.0L ~ 5.4, 2.0L ~ 8.1, 3.0L ~ 10.8
  switch (String(fuel || 'petrol').toLowerCase()) {
    case 'diesel':
      return petrol * 0.82;
    case 'hybrid':
      return petrol * 0.6;
    case 'electric':
      return 0;
    default:
      return petrol;
  }
}

/** kWh per 100 km for an EV, scaled a little by size. */
function evConsumption(engineLitres) {
  const e = Math.max(0.6, Number(engineLitres) || 1.5);
  return 15 + 2.5 * (e - 1.0);
}

/** Comprehensive premium as a percentage of value, by vehicle age. */
function comprehensiveRate(ageYears) {
  const a = Math.max(0, Number(ageYears) || 0);
  if (a <= 3) return 4.0;
  if (a <= 7) return 4.5;
  if (a <= 12) return 5.0;
  return 5.5;
}

/**
 * Insurance options for one vehicle.
 * @param {object} input { value, ageYears, addons: {excess, political, courtesy, aa} }
 */
function insurance(input, opts = {}) {
  const s = settings(opts);
  const value = Math.max(0, Number(input.value) || 0);
  const age = Math.max(0, Number(input.ageYears) || 0);
  const rate = comprehensiveRate(age);

  const compBase = Math.max(s.insurance_min_premium, (value * rate) / 100);
  const addonCatalogue = [
    { key: 'excess', label: 'Excess protector', note: 'Waives the excess you would otherwise pay on a claim', amount: round(Math.max(5000, value * 0.0025)) },
    { key: 'political', label: 'Political violence & terrorism', note: 'Riot, strike and civil commotion damage', amount: round(Math.max(4000, value * 0.0025)) },
    { key: 'courtesy', label: 'Courtesy car', note: 'A replacement vehicle while yours is in the garage', amount: 6000 },
    { key: 'aa', label: 'AA membership / towing', note: 'Roadside rescue and towing', amount: 5500 },
  ];
  const chosen = input.addons || {};
  const addons = addonCatalogue.map((a) => ({ ...a, selected: !!chosen[a.key] }));
  const addonTotal = addons.filter((a) => a.selected).reduce((sum, a) => sum + a.amount, 0);

  const comprehensive = {
    key: 'comprehensive',
    label: 'Comprehensive',
    annual: round(compBase + addonTotal),
    base: round(compBase),
    addons: round(addonTotal),
    rate,
    covers: [
      'Damage to your own car',
      'Theft of the vehicle',
      'Fire and natural perils',
      'Third-party injury claims',
      'Third-party property damage',
      'Windscreen (up to the policy limit)',
    ],
    excludes: ['Wear and tear', 'Mechanical breakdown', 'Driving without a valid licence'],
  };
  const thirdParty = {
    key: 'third_party',
    label: 'Third party only',
    annual: round(s.third_party_premium),
    base: round(s.third_party_premium),
    addons: 0,
    rate: null,
    covers: ['Third-party injury claims', 'Third-party property damage', 'The legal minimum to drive in Kenya'],
    excludes: ['Any damage to your own car', 'Theft of your vehicle', 'Fire damage to your vehicle'],
  };

  return {
    value,
    ageYears: age,
    options: [comprehensive, thirdParty],
    addons,
    difference: comprehensive.annual - thirdParty.annual,
    monthlyDifference: round((comprehensive.annual - thirdParty.annual) / 12),
    note:
      'Comprehensive cover is compulsory for any vehicle under finance — every lender on the panel requires it, and most will finance the first year’s premium.',
    assumptions: {
      comprehensiveRatePct: rate,
      minimumPremium: s.insurance_min_premium,
      thirdPartyPremium: s.third_party_premium,
    },
  };
}

/**
 * Total cost of ownership.
 * @param {object} input {
 *   price, engineLitres, fuel, kmPerYear, ageYears,
 *   comprehensive (bool), includeLoan (bool),
 *   loan: { monthlyPayment, tenorMonths }  // when includeLoan
 * }
 */
function runningCost(input, opts = {}) {
  const s = settings(opts);
  const price = Math.max(0, Number(input.price) || 0);
  const km = Math.max(0, Number(input.kmPerYear) || 15000);
  const engine = Number(input.engineLitres) || 1.5;
  const fuelType = String(input.fuel || 'petrol').toLowerCase();
  const age = Math.max(0, Number(input.ageYears) || 0);

  // --- fuel: real Nairobi economy for this body, engine, fuel and age ---
  const econ = market.economy(
    {
      engine_cc: Math.round(engine * 1000),
      fuel: fuelType,
      body_type: input.bodyType,
      drivetrain: input.drivetrain,
      ageYears: age,
    },
    s
  );
  const fuelAnnual = (econ.costPer100Km / 100) * km;
  const fuelDetail =
    fuelType === 'electric'
      ? `${econ.kmPerKwh} km/kWh at KES ${s.electricity_price}/kWh`
      : `${econ.kmPerLitre} km/L at KES ${econ.pricePerLitre}/litre`;

  // --- insurance ---
  const ins = insurance({ value: price, ageYears: age, addons: input.addons || {} }, opts);
  const insuranceAnnual = input.comprehensive === false ? ins.options[1].annual : ins.options[0].annual;

  // --- servicing: priced off the badge, the interval and the mileage ---
  const svc = market.servicing({ make: input.make, engine_cc: Math.round(engine * 1000), fuel: fuelType, ageYears: age }, km);
  const maintenanceAnnual = svc.annual;
  const tyresAnnual = ((price * s.tyre_set_cost_pct) / 100) * (km / s.tyre_life_km);

  // --- statutory ---
  const statutoryAnnual = s.licensing_fee;

  // --- finance ---
  const loanMonthly = input.includeLoan && input.loan ? Number(input.loan.monthlyPayment) || 0 : 0;
  const loanAnnual = loanMonthly * 12;

  const lines = [
    { key: 'loan', label: 'Loan repayment', annual: round(loanAnnual), detail: loanMonthly ? `KES ${round(loanMonthly).toLocaleString()} per month` : 'Bought outright — no finance', included: !!loanMonthly },
    { key: 'insurance', label: 'Insurance', annual: round(insuranceAnnual), detail: input.comprehensive === false ? 'Third party only' : `Comprehensive at ${ins.assumptions.comprehensiveRatePct}% of value`, included: true },
    { key: 'fuel', label: 'Fuel', annual: round(fuelAnnual), detail: `${km.toLocaleString()} km/year · ${fuelDetail}`, included: true },
    {
      key: 'maintenance',
      label: 'Servicing & repairs',
      annual: round(maintenanceAnnual),
      detail: `${svc.servicesPerYear} services a year at about ${round(svc.perService).toLocaleString()} each (every ${svc.intervalKm.toLocaleString()} km)`,
      included: true,
    },
    { key: 'tyres', label: 'Tyres', annual: round(tyresAnnual), detail: `A set lasts about ${s.tyre_life_km.toLocaleString()} km`, included: true },
    { key: 'statutory', label: 'Licensing & inspection', annual: round(statutoryAnnual), detail: 'Indicative annual statutory cost', included: true },
  ];

  /* A financed car carries a tracker for the whole term because the lender requires one.
     It is the borrower's cost, it is not optional, and leaving it out understates the
     real monthly figure on exactly the deals where the customer is most stretched. */
  if (input.includeLoan) {
    lines.push({
      key: 'tracker',
      label: 'Tracker subscription',
      annual: round(s.tracker_monthly * 12),
      detail: 'Required by the lender for as long as the loan runs',
      included: true,
    });
  }

  const totalAnnual = lines.reduce((sum, l) => sum + l.annual, 0);
  const runningOnly = totalAnnual - round(loanAnnual);
  const perKm = km ? totalAnnual / km : 0;

  /* Five-year view. The loan only runs for its term, so a 48-month deal contributes
     48 payments to a 60-month window, not 60.

     These are returned BROKEN OUT as well as summed. Showing only the total, directly
     under a line reading "running costs only (no loan)", made the total look like five
     years of running costs — when most of it is the loan repaying the car itself. */
  const loanMonths = input.includeLoan && input.loan ? Math.min(60, Number(input.loan.tenorMonths) || 0) : 0;
  const fiveYearRunning = runningOnly * 5;
  const fiveYearLoan = loanMonthly * loanMonths;
  const fiveYear = fiveYearRunning + fiveYearLoan;

  return {
    price,
    lines,
    totalAnnual: round(totalAnnual),
    totalMonthly: round(totalAnnual / 12),
    runningOnlyAnnual: round(runningOnly),
    runningOnlyMonthly: round(runningOnly / 12),
    perKm: +perKm.toFixed(2),
    fiveYearTotal: round(fiveYear),
    fiveYearRunning: round(fiveYearRunning),
    fiveYearLoan: round(fiveYearLoan),
    fiveYearLoanMonths: loanMonths,
    /* Against the purchase price. Worth reading carefully: with a loan in it this is
       always over 100%, because the loan is repaying the price plus interest. The
       running-cost ratio is the one that says something surprising. */
    fiveYearVsPrice: price ? +((fiveYear / price) * 100).toFixed(0) : 0,
    fiveYearRunningVsPrice: price ? +((fiveYearRunning / price) * 100).toFixed(0) : 0,
    insurance: ins,
    economy: econ,
    servicing: svc,
    /* The spec goes in as well as the badge. Without it an E200 and an E200d — same
       badge, different body pool and different fuel — would depreciate identically. */
    resale: input.make
      ? market.resale(price, input.make, 3, age, {
          bodyType: input.bodyType,
          fuel: fuelType,
          engineCc: Math.round(engine * 1000),
        })
      : null,
    assumptions: {
      kmPerYear: km,
      engineLitres: engine,
      fuel: fuelType,
      ageYears: age,
      bodyType: input.bodyType || null,
      make: input.make || null,
      ...s,
    },
  };
}

module.exports = { runningCost, insurance, consumption, comprehensiveRate, DEFAULTS, settings };
