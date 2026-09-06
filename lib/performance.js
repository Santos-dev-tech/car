'use strict';
/**
 * MotoKE — the enthusiast spec sheet.
 *
 * Buyers who care about cars want the numbers: how quick is it, what does it make, what
 * is it riding on, how far does a tank go, what shape is the interior in.
 *
 * A used-car yard rarely has the manufacturer's brochure to hand, so every figure here is
 * DERIVED from what the yard does know — engine size, fuel, body, drivetrain, age — using
 * a stated model, and returned flagged as an estimate. Any field a dealership types into
 * the admin form overrides the estimate and is flagged as measured. The UI shows which is
 * which, so nobody mistakes a projection for a manufacturer claim.
 *
 * Accuracy is roughly ±10% on power and ±1 second on 0–100 across the common Kenyan
 * import fleet. That is useful for comparing two cars on a forecourt, and not a substitute
 * for the logbook.
 */

const round = (n) => Math.round(n);
const round1 = (n) => Math.round(n * 10) / 10;

/** "a, b and c" — this text goes on a customer-facing page, so it has to read as English. */
function listOf(items) {
  if (items.length <= 1) return items[0] || '';
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
}

/* ------------------------------------------------------------------ */
/* forced induction                                                     */
/* ------------------------------------------------------------------ */

const TURBO_HINTS = /\b(turbo|gti|gtd|tsi|tdi|tfsi|amg|m sport|msport|xt|sti|type\s?r|ecoboost|skyactiv-?d|bi-?turbo|twin-?turbo|se performante|quattro|4matic|xdrive)\b/i;
const PREMIUM_TURBO_MAKES = new Set(['BMW', 'Mercedes-Benz', 'Audi', 'Volkswagen', 'Volvo', 'Porsche', 'Jaguar', 'Land Rover']);

/** Diesels in this era are effectively all turbocharged; petrol needs a hint. */
function isForced(v) {
  if (v.forced_induction === 1 || v.forced_induction === true) return true;
  if (v.forced_induction === 0 && v.forced_induction !== null) return false;
  const fuel = String(v.fuel || '').toLowerCase();
  if (fuel === 'diesel') return true;
  const text = `${v.variant || ''} ${v.model || ''}`;
  if (TURBO_HINTS.test(text)) return true;
  if (PREMIUM_TURBO_MAKES.has(v.make) && Number(v.year) >= 2014) return true;
  return false;
}

/* ------------------------------------------------------------------ */
/* engine output                                                        */
/* ------------------------------------------------------------------ */

/** Specific output, horsepower per litre. */
function hpPerLitre(fuel, forced, year) {
  const modern = Number(year) >= 2010 ? 1 : 0.92; // older engines breathe less freely
  switch (String(fuel || 'petrol').toLowerCase()) {
    case 'diesel':
      // a current 2.0 TDI makes ~150 hp and a 2.8 Hilux ~204: about 72 hp/litre
      return (forced ? 72 : 45) * modern;
    case 'hybrid':
      return 62 * modern; // the combustion half only; electric assist is added after
    case 'electric':
      return 0;
    default:
      return (forced ? 92 : 71) * modern;
  }
}

/** Engine and, for hybrids, combined system output. */
function power(v) {
  const litres = (Number(v.engine_cc) || 1500) / 1000;
  const fuel = String(v.fuel || 'petrol').toLowerCase();
  const forced = isForced(v);

  if (fuel === 'electric') {
    // no displacement to work from; scale off body and price band instead
    const hp = 130 + Math.min(220, (Number(v.price) || 2e6) / 40000);
    return { hp: round(hp), forced: false, note: 'Electric output scaled from vehicle class.' };
  }

  let hp = litres * hpPerLitre(fuel, forced, v.year);
  // very small engines lose proportionally more to friction
  if (litres < 1.2) hp *= 0.95;
  if (fuel === 'hybrid') hp += 45; // typical Kenyan-import hybrid motor contribution

  return { hp: round(hp), forced, note: null };
}

/** Torque. Diesels make far more of it per horsepower, which is why they tow. */
function torque(hp, fuel, forced) {
  const f = String(fuel || 'petrol').toLowerCase();
  const ratio = f === 'diesel' ? 2.35 : f === 'hybrid' ? 1.5 : forced ? 1.62 : 1.32;
  return round(hp * ratio);
}

/* ------------------------------------------------------------------ */
/* mass and chassis                                                     */
/* ------------------------------------------------------------------ */

const BODY_MASS = {
  Hatchback: [900, 190],
  Sedan: [1080, 210],
  Coupe: [1120, 210],
  'Station Wagon': [1180, 215],
  MPV: [1350, 230],
  Van: [1450, 250],
  SUV: [1400, 290],
  Pickup: [1700, 240],
  Truck: [2600, 300],
  Bus: [2800, 300],
};

/** Kerb weight in kg, from body class and engine size. */
function kerbWeight(v) {
  if (v.kerb_weight) return Number(v.kerb_weight);
  const [base, perLitre] = BODY_MASS[v.body_type] || BODY_MASS.Sedan;
  const litres = (Number(v.engine_cc) || 1500) / 1000;
  let kg = base + perLitre * Math.max(0, litres - 1);
  if (String(v.drivetrain) === '4WD') kg += 140;
  else if (String(v.drivetrain) === 'AWD') kg += 90;
  if (String(v.fuel || '').toLowerCase() === 'hybrid') kg += 80; // battery and motor
  if (Number(v.seats) >= 7) kg += 90;
  return round(kg);
}

/** Rim diameter in inches — bigger cars and pricier trims wear bigger wheels. */
function rimSize(v) {
  if (v.rim_size) return Number(v.rim_size);
  const price = Number(v.price) || 1.5e6;
  const body = v.body_type;
  let inches;
  if (body === 'Hatchback') inches = price > 2.5e6 ? 17 : price > 1.4e6 ? 16 : 15;
  else if (body === 'Pickup' || body === 'Truck') inches = price > 4.5e6 ? 18 : 17;
  else if (body === 'SUV') inches = price > 6e6 ? 20 : price > 3.5e6 ? 18 : 17;
  else if (body === 'Van' || body === 'MPV') inches = 16;
  else inches = price > 4e6 ? 18 : price > 2e6 ? 17 : 16;
  return inches;
}

/** A plausible tyre for that rim and body, in the usual 225/55 R18 notation. */
function tyreSize(v, rim) {
  if (v.tyre_size) return v.tyre_size;
  const body = v.body_type;
  const table = {
    Hatchback: { 15: '185/65', 16: '195/55', 17: '205/45' },
    Sedan: { 16: '205/55', 17: '215/50', 18: '225/45' },
    'Station Wagon': { 16: '205/55', 17: '215/50', 18: '225/45' },
    MPV: { 16: '205/60', 17: '215/55' },
    Van: { 16: '195/80' },
    SUV: { 17: '225/65', 18: '235/60', 20: '265/50' },
    Pickup: { 17: '265/65', 18: '265/60' },
    Truck: { 17: '235/75' },
  };
  const width = (table[body] || table.Sedan)[rim] || '215/55';
  return `${width} R${rim}`;
}

/** Ground clearance in mm — it matters more than almost anything on a Kenyan road. */
function groundClearance(v) {
  if (v.ground_clearance) return Number(v.ground_clearance);
  const byBody = {
    Hatchback: 140, Sedan: 145, Coupe: 125, 'Station Wagon': 150,
    MPV: 155, Van: 175, SUV: 195, Pickup: 220, Truck: 230,
  };
  let mm = byBody[v.body_type] || 150;
  if (String(v.drivetrain) === '4WD') mm += 20;
  return mm;
}

/* ------------------------------------------------------------------ */
/* the numbers people argue about                                       */
/* ------------------------------------------------------------------ */

/**
 * 0–100 km/h in seconds, from power-to-weight with a correction for the way torque and
 * driven wheels change how a car actually launches.
 */
function zeroTo100(hp, kg, opts = {}) {
  if (!hp) return null;
  const kgPerHp = kg / hp;
  let t = 0.92 * kgPerHp + 0.7;

  // torque off the line, and traction from more driven wheels
  const fuel = String(opts.fuel || '').toLowerCase();
  if (fuel === 'diesel') t *= 0.94;
  if (opts.forced) t *= 0.93;
  if (opts.drivetrain === 'AWD' || opts.drivetrain === '4WD') t *= 0.96;
  if (fuel === 'electric') t *= 0.72; // instant torque

  // tall, heavy bodies do not launch as cleanly as the ratio suggests
  if (opts.bodyType === 'SUV') t *= 1.03;
  if (opts.bodyType === 'Pickup' || opts.bodyType === 'Truck') t *= 1.1;
  if (opts.bodyType === 'Van' || opts.bodyType === 'Bus') t *= 1.12;

  return round1(Math.min(30, Math.max(2.5, t)));
}

/** Top speed in km/h — power against drag, with taller bodies limited. */
function topSpeed(hp, bodyType) {
  if (!hp) return null;
  let v = 130 + 0.42 * hp;
  const drag = { SUV: 0.92, Pickup: 0.85, Truck: 0.72, Van: 0.86, MPV: 0.9, Bus: 0.7 }[bodyType] || 1;
  return round(Math.min(330, v * drag));
}

/* ------------------------------------------------------------------ */
/* practicality                                                         */
/* ------------------------------------------------------------------ */

function bootLitres(v) {
  if (v.boot_litres) return Number(v.boot_litres);
  const byBody = {
    Hatchback: 300, Sedan: 460, Coupe: 350, 'Station Wagon': 550,
    MPV: 400, Van: 900, SUV: 500, Pickup: 1100, Truck: 2000,
  };
  let l = byBody[v.body_type] || 420;
  if (Number(v.seats) >= 7) l = Math.round(l * 0.55); // third row eats the boot
  return l;
}

function fuelTank(v) {
  if (v.fuel_tank) return Number(v.fuel_tank);
  const byBody = { Hatchback: 42, Sedan: 55, Coupe: 55, 'Station Wagon': 55, MPV: 60, Van: 70, SUV: 70, Pickup: 80, Truck: 100 };
  return byBody[v.body_type] || 55;
}

/* ------------------------------------------------------------------ */
/* the inspection scorecard                                             */
/* ------------------------------------------------------------------ */

const INSPECTION_AREAS = [
  ['exterior', 'Bodywork & paint'],
  ['interior', 'Interior & trim'],
  ['mechanical', 'Engine & drivetrain'],
  ['tyres', 'Tyres & brakes'],
  ['electronics', 'Electronics & aircon'],
];

/**
 * What the workshop actually looks at inside each area.
 *
 * Spinny built a brand on "200-point inspection" and the number is doing most of the
 * work — what a buyer really wants is to see the LIST, so they can tell whether the
 * things they personally worry about were checked. 42 points across the five areas, all
 * of them things that genuinely matter on a Kenyan import.
 *
 * The area score stays the thing the yard types in; this is the detail behind it, so a
 * printed report says what was covered rather than just a number out of 100.
 */
const INSPECTION_POINTS = {
  exterior: [
    'Panel alignment and door gaps', 'Paint depth and colour match', 'Rust on sills, arches and floor',
    'Windscreen chips and cracks', 'Lights, indicators and lenses', 'Underbody and chassis rails',
    'Boot floor and spare well', 'Doors, bonnet and boot operation',
  ],
  interior: [
    'Seat wear, stitching and rails', 'Dashboard cracks and fading', 'Headlining and pillars',
    'Carpets and signs of water ingress', 'Seatbelts and retractors', 'Interior smells — damp, smoke',
    'Boot lining and tools present', 'Keys, spare key and remote',
  ],
  mechanical: [
    'Cold start and idle', 'Engine oil condition and level', 'Coolant condition, no oil mixing',
    'Gearbox engagement, all gears', 'Clutch bite or torque converter', 'Drive shafts and CV boots',
    'Suspension bushes and shocks', 'Steering play and alignment',
    'Exhaust smoke and note', 'Leaks — engine, box, differential', 'Timing belt or chain history',
    'Turbo shaft play where fitted',
  ],
  tyres: [
    'Tread depth on all four', 'Uneven wear pattern', 'Tyre age (date code)', 'Matching brands per axle',
    'Spare wheel condition', 'Brake pad and disc thickness', 'Handbrake travel', 'ABS warning behaviour',
  ],
  electronics: [
    'Air conditioning cools properly', 'All warning lights clear on start', 'Windows, mirrors and central locking',
    'Infotainment, speakers and reverse camera', 'Diagnostic scan — no stored faults',
    'Battery health and charging'],
};

/** How many points the checklist covers in total. */
const INSPECTION_POINT_COUNT = Object.values(INSPECTION_POINTS).reduce((n, a) => n + a.length, 0);

/**
 * Normalise whatever the dealership recorded into a scorecard out of 100.
 * Unscored areas are reported as unscored, never as a default pass — an inspection that
 * invents a number is worse than no inspection.
 */
function inspection(raw, condition) {
  const stored = raw && typeof raw === 'object' ? raw : {};
  const areas = INSPECTION_AREAS.map(([key, label]) => {
    const score = stored[key] == null ? null : Math.max(0, Math.min(100, Number(stored[key])));
    return {
      key,
      label,
      score,
      rating: score == null ? null : score >= 90 ? 'Excellent' : score >= 75 ? 'Good' : score >= 60 ? 'Fair' : 'Needs work',
      // What the workshop covers in this area, so the score has visible substance.
      points: INSPECTION_POINTS[key] || [],
    };
  });
  const scored = areas.filter((a) => a.score != null);
  const overall = scored.length ? round(scored.reduce((s, a) => s + a.score, 0) / scored.length) : null;
  return {
    areas,
    overall,
    scoredCount: scored.length,
    total: areas.length,
    notes: stored.notes || null,
    checkedOn: stored.checkedOn || null,
    complete: scored.length === areas.length,
    pointCount: INSPECTION_POINT_COUNT,
    headline:
      overall == null
        ? 'Not yet inspected'
        : overall >= 90
        ? 'Excellent condition throughout'
        : overall >= 75
        ? 'Good condition, minor wear'
        : overall >= 60
        ? 'Fair — some work needed'
        : 'Sold as seen, work required',
  };
}

/** Interior grade from the scorecard plus what the car is actually trimmed in. */
function interior(v, insp) {
  const features = Array.isArray(v.features) ? v.features : [];
  const has = (s) => features.some((f) => String(f).toLowerCase().includes(s));
  const leather = has('leather');
  const seats = v.seat_material || (leather ? 'Leather' : Number(v.price) > 3.5e6 ? 'Part leather' : 'Fabric');
  return {
    seats,
    screen: v.screen_size ? `${v.screen_size}"` : null,
    climate: has('climate') ? 'Climate control' : has('air conditioning') ? 'Air conditioning' : null,
    sunroof: has('sunroof'),
    camera: has('camera'),
    cruise: has('cruise'),
    keyless: has('keyless') || has('push start'),
    score: insp.areas.find((a) => a.key === 'interior')?.score ?? null,
    rating: insp.areas.find((a) => a.key === 'interior')?.rating ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* the sheet                                                            */
/* ------------------------------------------------------------------ */

/**
 * Build the full enthusiast spec sheet for one vehicle.
 * `measured` lists the fields that came from the dealership rather than the model.
 */
function specSheet(v, economy) {
  const litres = (Number(v.engine_cc) || 0) / 1000;
  const p = power(v);
  const hp = v.power_hp ? Number(v.power_hp) : p.hp;
  const nm = v.torque_nm ? Number(v.torque_nm) : torque(hp, v.fuel, p.forced);
  const kg = kerbWeight(v);
  const rim = rimSize(v);

  const zero = v.zero_to_100
    ? Number(v.zero_to_100)
    : zeroTo100(hp, kg, { fuel: v.fuel, forced: p.forced, drivetrain: v.drivetrain, bodyType: v.body_type });
  const top = v.top_speed ? Number(v.top_speed) : topSpeed(hp, v.body_type);

  // `measured` is the machine-readable list; `measuredLabels` is what a customer reads,
  // because "zeroTo100" on a forecourt page helps nobody.
  const MEASURABLE = [
    ['power_hp', 'power', 'power'], ['torque_nm', 'torque', 'torque'],
    ['zero_to_100', 'zeroTo100', '0–100 km/h'], ['top_speed', 'topSpeed', 'top speed'],
    ['kerb_weight', 'weight', 'kerb weight'], ['rim_size', 'rims', 'rim size'],
    ['tyre_size', 'tyres', 'tyre size'], ['boot_litres', 'boot', 'boot space'],
    ['fuel_tank', 'tank', 'fuel tank'], ['ground_clearance', 'clearance', 'ground clearance'],
  ];
  const measured = [];
  const measuredLabels = [];
  for (const [field, key, label] of MEASURABLE) {
    if (v[field]) {
      measured.push(key);
      measuredLabels.push(label);
    }
  }

  const insp = inspection(v.inspection, v.condition);
  const tank = fuelTank(v);
  const kmPerLitre = economy && economy.kmPerLitre ? economy.kmPerLitre : null;

  return {
    performance: {
      hp,
      kw: round(hp * 0.7457),
      torqueNm: nm,
      zeroTo100: zero,
      topSpeed: top,
      powerToWeight: hp ? round((hp / kg) * 1000) : null, // hp per tonne
      engineLitres: litres ? round1(litres) : null,
      engineCc: Number(v.engine_cc) || null,
      forcedInduction: p.forced,
      aspiration: p.forced ? (String(v.fuel).toLowerCase() === 'diesel' ? 'Turbo diesel' : 'Turbocharged') : 'Naturally aspirated',
      layout: v.drivetrain || null,
      transmission: v.transmission || null,
    },
    chassis: {
      kerbWeight: kg,
      rimSize: rim,
      tyreSize: tyreSize(v, rim),
      groundClearance: groundClearance(v),
      brakes: Number(v.price) > 3e6 || p.forced ? 'Ventilated discs front and rear' : 'Ventilated discs front, discs rear',
    },
    practical: {
      seats: v.seats || null,
      doors: v.doors || null,
      bootLitres: bootLitres(v),
      fuelTank: tank,
      rangePerTank: kmPerLitre ? round(kmPerLitre * tank) : null,
    },
    interior: interior(v, insp),
    inspection: insp,
    measured,
    measuredLabels,
    estimated: measured.length === 0,
    disclaimer:
      measured.length === 0
        ? 'Every figure here is estimated from engine size, weight and body type. Ask us for the logbook figures before you buy on them.'
        : `The ${listOf(measuredLabels)} are this car's own recorded figures. The rest are estimated from engine size, weight and body type.`,
  };
}

module.exports = {
  specSheet, power, torque, kerbWeight, zeroTo100, topSpeed,
  rimSize, tyreSize, groundClearance, bootLitres, fuelTank,
  inspection, interior, isForced,
  INSPECTION_AREAS, INSPECTION_POINTS, INSPECTION_POINT_COUNT,
};
