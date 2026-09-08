'use strict';
/** MotoKE - running cost + insurance unit tests. node tools/ownership-test.js */
const own = require('../lib/ownership');

let pass = 0;
let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) {
    pass++;
    console.log(`  \x1b[32mPASS\x1b[0m ${name}`);
  } else {
    fail++;
    console.log(`  \x1b[31mFAIL\x1b[0m ${name}${extra !== undefined ? ' -> ' + JSON.stringify(extra) : ''}`);
  }
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const line = (r, key) => r.lines.find((l) => l.key === key).annual;

console.log('\n\x1b[1mMotoKE running cost & insurance\x1b[0m\n');

console.log('· fuel consumption');
ok('a 1.0L petrol sits near 5.4 L/100km', near(own.consumption(1.0, 'petrol'), 5.4, 0.01), own.consumption(1.0, 'petrol'));
ok('a 2.0L petrol sits near 8.1 L/100km', near(own.consumption(2.0, 'petrol'), 8.1, 0.01), own.consumption(2.0, 'petrol'));
ok('consumption rises with engine size', own.consumption(3.0, 'petrol') > own.consumption(2.0, 'petrol'));
ok('diesel is thriftier than petrol', own.consumption(2.0, 'diesel') < own.consumption(2.0, 'petrol'));
ok('a hybrid is thriftier than diesel', own.consumption(2.0, 'hybrid') < own.consumption(2.0, 'diesel'));
ok('an electric burns no fuel', own.consumption(2.0, 'electric') === 0);

console.log('\n· insurance');
ok('a new car is cheapest to insure', own.comprehensiveRate(1) < own.comprehensiveRate(9));
ok('rates step up by age band', own.comprehensiveRate(2) === 4.0 && own.comprehensiveRate(6) === 4.5 && own.comprehensiveRate(10) === 5.0 && own.comprehensiveRate(20) === 5.5);

const ins = own.insurance({ value: 3_000_000, ageYears: 6 });
ok('comprehensive is the rate applied to value', ins.options[0].annual === 135000, ins.options[0].annual);
ok('third party is the flat annual figure', ins.options[1].annual === 7500, ins.options[1].annual);
ok('the difference is reported', ins.difference === 127500, ins.difference);
ok('comprehensive covers your own car, third party does not',
  ins.options[0].covers.some((c) => /own car/i.test(c)) && ins.options[1].covers.every((c) => !/own car/i.test(c)));

const insMin = own.insurance({ value: 200_000, ageYears: 2 });
ok('a minimum premium applies to cheap cars', insMin.options[0].annual === 25000, insMin.options[0].annual);

const insAdd = own.insurance({ value: 3_000_000, ageYears: 6, addons: { excess: true, aa: true } });
ok('selected add-ons raise the premium', insAdd.options[0].annual > ins.options[0].annual);
ok('add-on total is itemised', insAdd.options[0].addons === insAdd.addons.filter((a) => a.selected).reduce((s, a) => s + a.amount, 0));
ok('unselected add-ons are still priced for display', insAdd.addons.every((a) => a.amount > 0));

console.log('\n· running cost');
const base = { price: 3_000_000, engineLitres: 2.0, fuel: 'petrol', kmPerYear: 15000, ageYears: 5, comprehensive: true, includeLoan: false };
const r = own.runningCost(base);
ok('every cost line is present', ['loan', 'insurance', 'fuel', 'maintenance', 'tyres', 'statutory'].every((k) => r.lines.some((l) => l.key === k)));
ok('total is the sum of the lines', r.totalAnnual === r.lines.reduce((s, l) => s + l.annual, 0));
ok('monthly is the annual over twelve', near(r.totalMonthly, r.totalAnnual / 12, 1));
ok('no loan means a zero loan line', line(r, 'loan') === 0);
// economy now comes from the market model, which accounts for body, drive and age
const market = require('../lib/market');
const l100 = market.litresPer100({ engineLitres: 2.0, fuel: 'petrol', ageYears: 5 });
// the engine rounds cost to the nearest shilling per 100 km before scaling, hence the tolerance
ok('fuel is 15,000 km at the modelled consumption and 195/litre', near(line(r, 'fuel'), (15000 / 100) * l100 * 195, 60), { got: line(r, 'fuel'), l100 });
ok('a 2.0L petrol lands in a believable band', l100 > 7.5 && l100 < 10, l100);
ok('per-km cost is reported', r.perKm > 0 && near(r.perKm, r.totalAnnual / 15000, 0.02));

const withLoan = own.runningCost({ ...base, includeLoan: true, loan: { monthlyPayment: 56234, tenorMonths: 48 } });
ok('a loan adds twelve instalments a year', line(withLoan, 'loan') === 56234 * 12);
ok('financing raises the monthly total', withLoan.totalMonthly > r.totalMonthly);
ok('running-only strips the loan back out', withLoan.runningOnlyAnnual === withLoan.totalAnnual - line(withLoan, 'loan'));
ok('the five-year view stops paying the loan at its term', withLoan.fiveYearTotal === withLoan.runningOnlyAnnual * 5 + 56234 * 48, withLoan.fiveYearTotal);

const thirdParty = own.runningCost({ ...base, comprehensive: false });
ok('third party cover lowers the total', thirdParty.totalAnnual < r.totalAnnual);
ok('third party uses the flat premium', line(thirdParty, 'insurance') === 7500);

const older = own.runningCost({ ...base, ageYears: 15 });
ok('an older car costs more to run', older.totalAnnual > r.totalAnnual, { old: older.totalAnnual, young: r.totalAnnual });
ok('the extra is in servicing and insurance', line(older, 'maintenance') > line(r, 'maintenance') && line(older, 'insurance') > line(r, 'insurance'));

const bigger = own.runningCost({ ...base, engineLitres: 4.0 });
ok('a bigger engine costs more in fuel', line(bigger, 'fuel') > line(r, 'fuel'));

const driven = own.runningCost({ ...base, kmPerYear: 45000 });
ok('tripling the mileage triples the fuel', near(line(driven, 'fuel'), line(r, 'fuel') * 3, 3));
ok('mileage also drives tyre and servicing spend', line(driven, 'tyres') > line(r, 'tyres') && line(driven, 'maintenance') > line(r, 'maintenance'));
ok('licensing does not move with mileage', line(driven, 'statutory') === line(r, 'statutory'));

console.log('\n· tunable assumptions');
const pricey = own.runningCost(base, { petrol_price: 260 });
ok('a fuel price rise flows through', line(pricey, 'fuel') > line(r, 'fuel'));
ok('the change is proportional', near(line(pricey, 'fuel') / line(r, 'fuel'), 260 / 195, 0.01));
ok('assumptions are returned with the answer', r.assumptions.petrol_price === 195 && r.assumptions.kmPerYear === 15000, r.assumptions);
ok('every line explains itself', r.lines.every((l) => typeof l.detail === 'string' && l.detail.length > 0));

/* The resale figure on the running-cost screen has to see the actual car, not just the
   badge — otherwise every Mercedes on the forecourt reads the same. */
console.log('\n· resale follows the variant, not the badge');
const mbBase = { ...base, price: 6_000_000, make: 'Mercedes-Benz', bodyType: 'Sedan', ageYears: 8 };
const petrol = own.runningCost({ ...mbBase, fuel: 'petrol', engineLitres: 2.0 });
const diesel = own.runningCost({ ...mbBase, fuel: 'diesel', engineLitres: 1.95 });
const suv = own.runningCost({ ...mbBase, fuel: 'diesel', engineLitres: 2.9, bodyType: 'SUV' });

ok('an E200 and an E200d get different resale values',
  petrol.resale.estimatedValue !== diesel.resale.estimatedValue,
  { petrol: petrol.resale.estimatedValue, diesel: diesel.resale.estimatedValue });
ok('the diesel holds on better', diesel.resale.estimatedValue > petrol.resale.estimatedValue);
ok('the SUV holds better again', suv.resale.retentionPerYear > diesel.resale.retentionPerYear);
ok('and the answer says the variant was used', petrol.resale.basis.variantAware === true);
ok('no make means no resale claim', own.runningCost(base).resale === null);

console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m\n`);
process.exit(fail ? 1 : 0);
