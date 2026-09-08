'use strict';
/**
 * MotoKE — price indicator tests. No server, no database.
 *
 *   node --no-warnings tools/valuation-test.js
 *
 * The thing being guarded here is honesty: the badge must never claim more than the sample
 * supports, and must never call an expensive car cheap.
 */
const val = require('../lib/valuation');
const market = require('../lib/market');

let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok    ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  -> ' + JSON.stringify(detail) : '')); }
};

const car = (over = {}) => ({
  id: Math.random(), make: 'Toyota', model: 'Harrier', year: 2018, price: 4_000_000,
  body_type: 'SUV', condition: 'foreign_used', mileage_km: 80000, ...over,
});

/** Six near-identical SUVs around 4M. */
const pool = () => [1, 2, 3, 4, 5, 6].map((i) => car({ id: i, price: 3_900_000 + i * 40_000 }));

console.log('\n— the sample gate —');
ok('two comparables is not enough to judge anything', val.priceIndicator(car({ id: 99 }), pool().slice(0, 2)).enough === false);
ok('and it says why', /Not enough/.test(val.priceIndicator(car({ id: 99 }), pool().slice(0, 2)).note));
ok('an empty yard produces no badge', val.priceIndicator(car({ id: 99 }), []).enough === false);
ok('a car with no price produces nothing at all', val.priceIndicator(car({ price: 0 }), pool()) === null);
ok('six comparables is enough', val.priceIndicator(car({ id: 99 }), pool()).enough === true);

console.log('\n— the bands —');
const cheap = val.priceIndicator(car({ id: 99, price: 3_200_000 }), pool());
ok('a car well under the pack reads low or great', ['low', 'great'].includes(cheap.band), cheap.band);
ok('and is marked as cheaper', cheap.cheaper === true);
const level = val.priceIndicator(car({ id: 99, price: 4_060_000 }), pool());
ok('a car in the middle of the pack reads good', level.band === 'good', level.band);
const dear = val.priceIndicator(car({ id: 99, price: 5_200_000 }), pool());
ok('a car well above the pack is flagged', dear.band === 'high', dear.band);
ok('and is not described as cheaper', dear.cheaper === false);
ok('an expensive car is never called a great price', dear.band !== 'great' && dear.band !== 'low');

console.log('\n— an absurd gap is a bad comparison, not a bargain —');
/* Priced far enough out to be nonsense, but still close enough that the comparability
   band lets the cars through — which is precisely the case the guard exists for. */
const absurd = val.priceIndicator(car({ id: 99, price: 5_800_000 }), pool());
ok('a car priced far above the pack is refused, not flagged high', absurd.enough === false, absurd);
ok('and it is marked as an outlier', absurd.outlier === true, absurd);
ok('with wording that blames the comparison, not the price', /not a fair comparison/.test(absurd.note), absurd.note);
const absurdLow = val.priceIndicator(car({ id: 99, price: 2_500_000 }), pool());
ok('the same applies far below the pack', absurdLow.enough === false && absurdLow.outlier === true, absurdLow);
ok('a 30% gap is still inside what we will judge',
  val.priceIndicator(car({ id: 99, price: 4_060_000 * 1.3 }), pool()).enough === true);

console.log('\n— comparability —');
const prado = car({ id: 50, price: 7_000_000, model: 'Prado' });
ok('a Vitz is not comparable to a Prado', !val.isComparable(prado, car({ id: 51, price: 1_100_000, body_type: 'Hatchback' })));
ok('a different body type is never comparable', !val.isComparable(prado, car({ id: 52, price: 6_800_000, body_type: 'Sedan' })));
ok('a car ten years apart is not comparable', !val.isComparable(prado, car({ id: 53, price: 6_800_000, year: 2008 })));
ok('a similar SUV at a similar price is comparable', val.isComparable(prado, car({ id: 54, price: 6_500_000 })));
ok('a car is never comparable to itself', !val.isComparable(prado, prado));

console.log('\n— the adjustments —');
const subject = car({ year: 2018, mileage_km: 80000 });
ok('an older comparable adjusts upward toward a newer subject',
  val.adjust(car({ year: 2015, price: 4_000_000 }), subject) > 4_000_000);
ok('a higher-mileage comparable adjusts upward',
  val.adjust(car({ mileage_km: 150000, price: 4_000_000 }), subject) > 4_000_000);
ok('a lower-mileage comparable adjusts downward',
  val.adjust(car({ mileage_km: 20000, price: 4_000_000 }), subject) < 4_000_000);
ok('a locally used comparable adjusts up toward an imported subject',
  val.adjust(car({ condition: 'used', price: 4_000_000 }), subject) > 4_000_000);
ok('an identical comparable is not adjusted at all',
  Math.abs(val.adjust(car({ price: 4_000_000 }), subject) - 4_000_000) < 1);
ok('an extreme mileage outlier cannot swing it more than 18%',
  val.adjust(car({ mileage_km: 900000, price: 4_000_000 }), subject) <= 4_000_000 * 1.181);

console.log('\n— the median holds against an outlier —');
const withOutlier = [...pool(), car({ id: 77, price: 20_000_000 })];
const a = val.priceIndicator(car({ id: 99, price: 4_060_000 }), pool());
const b = val.priceIndicator(car({ id: 99, price: 4_060_000 }), withOutlier);
ok('one absurdly priced car barely moves the typical price',
  Math.abs(a.typicalPrice - b.typicalPrice) < a.typicalPrice * 0.1, { a: a.typicalPrice, b: b.typicalPrice });

console.log('\n— what it says about itself —');
const r = val.priceIndicator(car({ id: 99, price: 3_400_000 }), pool());
ok('the basis names the sample size', r.basis.includes(String(r.sample)));
ok('the basis says it is this yard, not the market', /this yard/.test(r.basis));
ok('the money difference is rounded to the nearest thousand', r.difference % 1000 === 0);
ok('the typical price is rounded to the nearest thousand', r.typicalPrice % 1000 === 0);
ok('the difference is never negative', r.difference >= 0);
ok('a percentage is reported', r.percent > 0);

console.log('\n— guaranteed future value —');
const fv = val.futureValue(4_000_000, 'Toyota', 3, 2);
ok('the guaranteed floor sits below the projection', fv.guaranteedFloor < fv.projected);
ok('and below today\'s price', fv.guaranteedFloor < 4_000_000);
ok('a Toyota holds better than a Land Rover',
  val.futureValue(4_000_000, 'Toyota', 3, 2).guaranteedFloor > val.futureValue(4_000_000, 'Land Rover', 3, 2).guaranteedFloor);
ok('a longer term is worth less', val.futureValue(4_000_000, 'Toyota', 5, 2).guaranteedFloor < fv.guaranteedFloor);
ok('the note warns it is a projection', /projection/i.test(fv.note));
ok('no price means no offer', val.futureValue(0, 'Toyota') === null);

/* The badge on its own is too blunt. An E200 and an E200d are both a Mercedes and they do
   not hold value the same way, so the curve has to see the variant. */
console.log('\n— the variant, not just the badge —');
const mb = (spec) => market.resale(6_000_000, 'Mercedes-Benz', 3, 2, spec);
const e200 = mb({ bodyType: 'Sedan', fuel: 'petrol', engineCc: 1991 });
const e200d = mb({ bodyType: 'Sedan', fuel: 'diesel', engineCc: 1950 });
const gle = mb({ bodyType: 'SUV', fuel: 'diesel', engineCc: 2925 });
const v8 = mb({ bodyType: 'Sedan', fuel: 'petrol', engineCc: 4000 });

ok('an E200 and an E200d are not the same car', e200.estimatedValue !== e200d.estimatedValue, {
  e200: e200.estimatedValue, e200d: e200d.estimatedValue,
});
ok('the diesel holds on better', e200d.estimatedValue > e200.estimatedValue);
ok('the SUV holds better than the saloon', gle.retentionPerYear > e200d.retentionPerYear);
ok('a big petrol engine is punished', v8.retentionPerYear < e200.retentionPerYear, {
  v8: v8.retentionPerYear, e200: e200.retentionPerYear,
});
ok('no spec still returns a number', market.resale(6_000_000, 'Mercedes-Benz', 3, 2).estimatedValue > 0);
ok('and says it was the badge alone', market.resale(6_000_000, 'Mercedes-Benz', 3, 2).basis.variantAware === false);
ok('with a spec it says the variant was used', e200d.basis.variantAware === true);
ok('the badge figure is shown so the adjustment is visible', e200d.basis.badge === 81.5, e200d.basis);
ok('the fuel adjustment is reported as a percentage', e200d.basis.fuelEffect > 0 && e200.basis.fuelEffect === 0);
ok('the body adjustment is negative for a saloon', e200.basis.bodyEffect < 0);
ok('a badge nobody has a curve for still works', market.resale(1_000_000, 'Chery', 3, 0).estimatedValue > 0);
ok('the retention never runs above 95%', market.resale(1_000_000, 'Toyota', 3, 30).retentionPerYear <= 95);

/* The age easing used to ADD a flat amount, which pushed every strong holder into the
   ceiling and made a 1.5-litre Probox and a 4.5-litre V8 Land Cruiser identical. */
console.log('\n— age easing must not flatten the variants —');
const probox = market.resale(1_000_000, 'Toyota', 3, 10, { bodyType: 'Van', fuel: 'petrol', engineCc: 1500 });
const lcV8 = market.resale(9_000_000, 'Toyota', 3, 10, { bodyType: 'SUV', fuel: 'diesel', engineCc: 4500 });
const pradoResale = market.resale(7_000_000, 'Toyota', 3, 9, { bodyType: 'SUV', fuel: 'diesel', engineCc: 2800 });
const hilux = market.resale(3_000_000, 'Toyota', 3, 10, { bodyType: 'Pickup', fuel: 'diesel', engineCc: 2400 });
ok('a Hilux and a Probox are still told apart at ten years old',
  hilux.retentionPerYear !== probox.retentionPerYear, { hilux: hilux.retentionPerYear, probox: probox.retentionPerYear });
ok('nothing in a varied old Toyota set collapses onto the ceiling',
  [probox, lcV8, hilux].every((c) => c.retentionPerYear < 95),
  [probox, lcV8, hilux].map((c) => c.retentionPerYear));
ok('the 2.8 Prado holds better than the 4.5 V8', pradoResale.retentionPerYear > lcV8.retentionPerYear);
ok('an old strong holder does not sit on the ceiling', pradoResale.retentionPerYear < 95);
ok('age still flattens the curve', pradoResale.retentionPerYear > market.resale(7_000_000, 'Toyota', 3, 0, { bodyType: 'SUV', fuel: 'diesel', engineCc: 2800 }).retentionPerYear);
ok('a brand new car gets no easing at all — the badge figure is used as-is',
  market.resale(1_000_000, 'Toyota', 3, 0).retentionPerYear === 90.5,
  market.resale(1_000_000, 'Toyota', 3, 0).retentionPerYear);

console.log('\n— the future value carries the variant through —');
const fvPetrol = val.futureValue(6_000_000, 'Mercedes-Benz', 3, 2, { bodyType: 'Sedan', fuel: 'petrol', engineCc: 1991 });
const fvDiesel = val.futureValue(6_000_000, 'Mercedes-Benz', 3, 2, { bodyType: 'Sedan', fuel: 'diesel', engineCc: 1950 });
ok('the two variants get different floors', fvDiesel.guaranteedFloor > fvPetrol.guaranteedFloor, {
  petrol: fvPetrol.guaranteedFloor, diesel: fvDiesel.guaranteedFloor,
});
ok('the basis comes with it', fvDiesel.basis.variantAware === true);
ok('and the note says the variant was used', /this exact/.test(fvDiesel.note));
ok('without a spec the note stays general', !/this exact/.test(fv.note));

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail);
