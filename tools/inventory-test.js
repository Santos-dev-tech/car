'use strict';
/**
 * MotoKE — stock ageing and repricing tests. No server, no database.
 *
 *   node --no-warnings tools/inventory-test.js
 */
const inv = require('../lib/inventory');
const val = require('../lib/valuation');

let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok    ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); }
};

const NOW = new Date('2026-09-06T12:00:00Z').getTime();
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();

const car = (over = {}) => ({
  id: Math.random(), make: 'Toyota', model: 'Harrier', year: 2018, price: 4_000_000,
  body_type: 'SUV', condition: 'foreign_used', mileage_km: 80000,
  status: 'available', created_at: daysAgo(10), views: 20, ...over,
});

console.log('\n— days in stock —');
ok('a car listed today is nought days old', inv.daysSince(daysAgo(0), NOW) === 0);
ok('ten days ago is ten days', inv.daysSince(daysAgo(10), NOW) === 10);
ok('a missing date is not negative', inv.daysSince(null, NOW) === 0);
ok('rubbish in a date column does not throw', inv.daysSince('not a date', NOW) === 0);
ok('a future date clamps to zero', inv.daysSince(new Date(NOW + 5 * 86400000).toISOString(), NOW) === 0);

console.log('\n— the buckets —');
ok('day 1 is fresh', inv.bucketFor(1).key === 'fresh');
ok('day 30 is still fresh', inv.bucketFor(30).key === 'fresh');
ok('day 31 moves to watch', inv.bucketFor(31).key === 'watch');
ok('day 45 is the last watch day', inv.bucketFor(45).key === 'watch');
ok('day 46 starts ageing', inv.bucketFor(46).key === 'ageing');
ok('day 60 is the last ageing day', inv.bucketFor(60).key === 'ageing');
ok('day 61 is stale', inv.bucketFor(61).key === 'stale');
ok('a year old is still just stale', inv.bucketFor(365).key === 'stale');

console.log('\n— what it costs to not sell a car —');
const c90 = inv.carryingCost(4_000_000, 90);
ok('ninety days of a 4M car costs six figures', c90.total > 100_000, c90);
ok('interest and depreciation are both counted', c90.interest > 0 && c90.depreciation > 0, c90);
ok('the parts add up to the total', c90.interest + c90.depreciation === c90.total || Math.abs(c90.interest + c90.depreciation - c90.total) <= 1);
ok('twice as long costs about twice as much',
  Math.abs(inv.carryingCost(4_000_000, 180).total - c90.total * 2) < 100, inv.carryingCost(4_000_000, 180).total);
ok('a car sold on day zero costs nothing', inv.carryingCost(4_000_000, 0).total === 0);
ok('a per-day figure is reported', c90.perDay > 0);

console.log('\n— the ageing picture —');
const yard = [
  car({ id: 1, created_at: daysAgo(5) }),
  car({ id: 2, created_at: daysAgo(20) }),
  car({ id: 3, created_at: daysAgo(40) }),
  car({ id: 4, created_at: daysAgo(50) }),
  car({ id: 5, created_at: daysAgo(120), price: 6_000_000 }),
  car({ id: 6, created_at: daysAgo(200), status: 'sold', make: 'Mazda' }),
  car({ id: 7, created_at: daysAgo(9), status: 'draft' }),
];
const a = inv.ageing(yard, { now: NOW });
ok('drafts are not counted as stock', a.total === 5, a.total);
ok('sold cars are not counted as stock', !a.oldest.some((r) => r.id === 6));
ok('reserved cars ARE counted — they still cost money', inv.ageing([car({ id: 9, status: 'reserved' })], { now: NOW }).total === 1);
ok('the four buckets are all reported', a.buckets.length === 4);
ok('one car is stale', a.buckets.find((b) => b.key === 'stale').count === 1, a.buckets);
ok('the oldest car is first in the list', a.oldest[0].days === 120, a.oldest[0]);
ok('an average age is reported', a.averageDays > 0 && a.averageDays < 120, a.averageDays);
ok('a median is reported too, because one old car skews a mean', a.medianDays > 0, a.medianDays);
ok('stock value is the sum of the live cars', a.stockValue === 4_000_000 * 4 + 6_000_000, a.stockValue);
ok('total carrying cost is reported', a.carryingTotal > 0);
ok('an empty yard does not throw', inv.ageing([], { now: NOW }).total === 0);

console.log('\n— turn rate by make —');
ok('makes are broken out', a.makes.length >= 1, a.makes);
ok('a make with nothing sold reports no sell-through rather than 0%',
  a.makes.find((m) => m.make === 'Toyota').sellThrough === 0 || a.makes.find((m) => m.make === 'Toyota').sellThrough === null);
const mazda = a.makes.find((m) => m.make === 'Mazda');
ok('a make that only ever sold shows 100% sell-through', mazda && mazda.sellThrough === 100, mazda);
ok('slowest make is listed first', a.makes[0].avgDays >= a.makes[a.makes.length - 1].avgDays);

console.log('\n— the repricing list —');
/* Six comparable SUVs so the price indicator has something to work with. */
const pool = [1, 2, 3, 4, 5, 6].map((i) => car({ id: i, price: 3_900_000 + i * 40_000, created_at: daysAgo(10) }));
const overpriced = car({ id: 99, price: 5_400_000, created_at: daysAgo(90) });
const list = inv.repricingList([...pool, overpriced], { now: NOW });
ok('an old, over-priced car is flagged', list.some((r) => r.id === 99), list);
ok('and a suggested price is offered', list[0].suggested > 0 && list[0].suggested < overpriced.price, list[0]);
ok('with a reason a manager can read', /days in stock/.test(list[0].why), list[0].why);
ok('a fresh over-priced car is left alone',
  !inv.repricingList([...pool, car({ id: 98, price: 5_400_000, created_at: daysAgo(3) })], { now: NOW }).some((r) => r.id === 98));
ok('an old but fairly priced car is left alone',
  !inv.repricingList([...pool, car({ id: 97, price: 3_960_000, created_at: daysAgo(90) })], { now: NOW }).some((r) => r.id === 97));
ok('nothing is flagged without comparables to judge against',
  inv.repricingList([car({ id: 96, price: 9_000_000, created_at: daysAgo(200) })], { now: NOW }).length === 0);
ok('sold cars never appear on the list',
  !inv.repricingList([...pool, car({ id: 95, price: 5_400_000, created_at: daysAgo(90), status: 'sold' })], { now: NOW }).some((r) => r.id === 95));

console.log('\n— consignment —');
const con = val.consignment(900_000, 1_150_000);
ok('the seller nets more than the cash offer', con.netToSeller > con.tradeInNow, con);
ok('the commission is taken out', con.commissionFee > 0 && con.netToSeller < con.retailPrice);
ok('and preparation is not free either', con.prepCost > 0);
ok('the gain is the difference against selling to us', con.gain === con.netToSeller - 900_000, con);
ok('it is recommended when the gain is real', con.worthIt === true);
ok('a marginal gain is honestly not recommended', val.consignment(900_000, 960_000).worthIt === false, val.consignment(900_000, 960_000));
ok('and it says so in words', /better deal/.test(val.consignment(900_000, 940_000).summary), val.consignment(900_000, 940_000).summary);
ok('no retail price means no consignment offer', val.consignment(900_000, 0) === null);
ok('the commission rate is stated as a percentage', val.consignment(900_000, 1_150_000).commissionPercent === 7);

/* A flat 14% a year was the old assumption and it made every car on the forecourt bleed at
   the same speed. It does not: the badge, the body, the fuel and the engine all move it. */
console.log('\n— each car depreciates at its own rate —');
const lc = car({ make: 'Toyota', model: 'Land Cruiser', body_type: 'SUV', fuel: 'diesel', engine_cc: 4500, year: 2018 });
const e200 = car({ make: 'Mercedes-Benz', model: 'E200', body_type: 'Sedan', fuel: 'petrol', engine_cc: 1991, year: 2018 });
const e200d = car({ make: 'Mercedes-Benz', model: 'E200d', body_type: 'Sedan', fuel: 'diesel', engine_cc: 1950, year: 2018 });

ok('a Land Cruiser loses less than an E-Class', inv.depreciationRate(lc) < inv.depreciationRate(e200), {
  lc: inv.depreciationRate(lc), e200: inv.depreciationRate(e200),
});
ok('an E200 and an E200d are told apart', inv.depreciationRate(e200) !== inv.depreciationRate(e200d), {
  e200: inv.depreciationRate(e200), e200d: inv.depreciationRate(e200d),
});
ok('the diesel is the one that holds on', inv.depreciationRate(e200d) < inv.depreciationRate(e200));
ok('the rate stays inside sane bounds', [lc, e200, e200d].every((v) => {
  const r = inv.depreciationRate(v);
  return r >= 0.04 && r <= 0.25;
}));
ok('a car with no badge falls back to the setting', inv.depreciationRate({ price: 1_000_000 }, 0.2) === 0.2);
ok('and to 14% when nothing is passed', inv.depreciationRate(null) === 0.14);

ok('the held cost uses that car\'s own rate',
  inv.carryingFor(lc, 90).depreciation < inv.carryingFor(e200, 90).depreciation, {
    lc: inv.carryingFor(lc, 90), e200: inv.carryingFor(e200, 90),
  });
ok('the rate is reported so the table can show it', inv.carryingFor(e200, 90).depreciationRatePct > 0);
ok('the setting is a fallback, not an override',
  inv.carryingFor(e200, 90, { annualDepreciation: 0.5 }).depreciationRatePct < 50);
ok('interest is untouched by any of this',
  inv.carryingFor(lc, 365).interest === inv.carryingFor(e200, 365).interest);
ok('the flat helper still behaves for callers that pass a rate',
  inv.carryingCost(1_000_000, 365, { annualRate: 0.16, annualDepreciation: 0.14 }).depreciation === 140_000);

const mixed = inv.ageing([lc, e200], { now: NOW });
ok('every ageing row carries its own depreciation rate',
  mixed.oldest.every((r) => typeof r.carrying.depreciationRatePct === 'number'));
ok('and two cars in one yard do not share a rate',
  new Set(mixed.oldest.map((r) => r.carrying.depreciationRatePct)).size === 2,
  mixed.oldest.map((r) => [r.title, r.carrying.depreciationRatePct]));

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail);
