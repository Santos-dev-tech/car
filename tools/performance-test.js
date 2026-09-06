'use strict';
/**
 * MotoKE — spec-sheet tests. No server, no database.
 *
 * These check the model behaves the way a car person expects: more power is quicker,
 * more weight is slower, a diesel out-torques a petrol, an override beats an estimate,
 * and nothing ever returns a number that would embarrass us on a forecourt.
 *
 *   node --no-warnings tools/performance-test.js
 */
const perf = require('../lib/performance');

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) {
    pass++;
    console.log('  ok    ' + name);
  } else {
    fail++;
    console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : ''));
  }
}
function near(name, actual, low, high) {
  ok(name, actual >= low && actual <= high, `${actual} not in ${low}..${high}`);
}

const car = (over = {}) => ({
  make: 'Toyota', model: 'Corolla', year: 2018, price: 1_800_000,
  body_type: 'Sedan', fuel: 'Petrol', transmission: 'Automatic', drivetrain: '2WD',
  engine_cc: 1800, seats: 5, doors: 4, features: [], ...over,
});

console.log('\n— aspiration —');
ok('a diesel is treated as turbocharged', perf.isForced(car({ fuel: 'Diesel' })));
ok('a plain petrol Corolla is not', !perf.isForced(car()));
ok('a GTI is', perf.isForced(car({ make: 'Volkswagen', model: 'Golf', variant: 'GTI' })));
ok('a modern BMW is', perf.isForced(car({ make: 'BMW', model: '320i', year: 2019 })));
ok('a 2005 BMW is not assumed to be', !perf.isForced(car({ make: 'BMW', model: '320i', year: 2005 })));
ok('an explicit 0 override wins over the diesel rule', !perf.isForced(car({ fuel: 'Diesel', forced_induction: 0 })));

console.log('\n— power —');
near('1.8 petrol makes a believable 120-140 hp', perf.power(car()).hp, 118, 140);
near('a 2.0 turbo diesel makes 140-200 hp', perf.power(car({ engine_cc: 2000, fuel: 'Diesel' })).hp, 140, 200);
near('a 1.5 hybrid lands near 130 hp combined', perf.power(car({ engine_cc: 1500, fuel: 'Hybrid' })).hp, 120, 150);
ok('a bigger engine always makes more power',
  perf.power(car({ engine_cc: 3000 })).hp > perf.power(car({ engine_cc: 1800 })).hp);
ok('an electric car gets an output without displacement',
  perf.power(car({ fuel: 'Electric', engine_cc: null })).hp > 100);

console.log('\n— torque —');
ok('a diesel out-torques an equivalent petrol',
  perf.torque(150, 'Diesel', true) > perf.torque(150, 'Petrol', false));
ok('a turbo petrol out-torques the same power naturally aspirated',
  perf.torque(150, 'Petrol', true) > perf.torque(150, 'Petrol', false));

console.log('\n— weight —');
ok('an SUV is heavier than a hatchback of the same engine',
  perf.kerbWeight(car({ body_type: 'SUV' })) > perf.kerbWeight(car({ body_type: 'Hatchback' })));
ok('4WD adds weight over 2WD',
  perf.kerbWeight(car({ drivetrain: '4WD' })) > perf.kerbWeight(car({ drivetrain: '2WD' })));
near('a 1.8 sedan weighs 1200-1400 kg', perf.kerbWeight(car()), 1150, 1400);
ok('a stored kerb weight is used verbatim', perf.kerbWeight(car({ kerb_weight: 1234 })) === 1234);

console.log('\n— 0-100 —');
const corolla = perf.specSheet(car()).performance.zeroTo100;
near('a 1.8 Corolla is 9-13 seconds', corolla, 8.5, 13.5);
near('a 3.0 turbo BMW is 5-8 seconds',
  perf.specSheet(car({ make: 'BMW', model: '330i', engine_cc: 3000, year: 2019, price: 6_500_000 })).performance.zeroTo100, 4.5, 8);
near('a 2.8 diesel pickup is 10-16 seconds',
  perf.specSheet(car({ make: 'Toyota', model: 'Hilux', body_type: 'Pickup', engine_cc: 2800, fuel: 'Diesel', drivetrain: '4WD' })).performance.zeroTo100, 9.5, 16);
ok('more power on the same weight is quicker',
  perf.zeroTo100(200, 1400, {}) < perf.zeroTo100(120, 1400, {}));
ok('more weight on the same power is slower',
  perf.zeroTo100(150, 2200, {}) > perf.zeroTo100(150, 1200, {}));
ok('an electric car launches harder than a petrol on the same numbers',
  perf.zeroTo100(200, 1800, { fuel: 'electric' }) < perf.zeroTo100(200, 1800, { fuel: 'petrol' }));
ok('nothing is ever quicker than 2.5s', perf.zeroTo100(2000, 900, {}) >= 2.5);
ok('nothing is ever slower than 30s', perf.zeroTo100(20, 3000, {}) <= 30);
ok('no power means no claim', perf.zeroTo100(0, 1400, {}) === null);

console.log('\n— top speed —');
near('a 1.8 sedan tops out 175-215', perf.topSpeed(130, 'Sedan'), 175, 215);
ok('a truck is limited below a sedan on the same power',
  perf.topSpeed(200, 'Truck') < perf.topSpeed(200, 'Sedan'));
ok('top speed is capped at 330', perf.topSpeed(2000, 'Sedan') <= 330);

console.log('\n— wheels and stance —');
ok('a cheap hatchback rides on 15s', perf.rimSize(car({ body_type: 'Hatchback', price: 900_000 })) === 15);
ok('an expensive SUV rides on 20s', perf.rimSize(car({ body_type: 'SUV', price: 9_000_000 })) === 20);
ok('a stored rim size wins', perf.rimSize(car({ rim_size: 19 })) === 19);
ok('the tyre size names the same rim', /R18$/.test(perf.tyreSize(car({ body_type: 'SUV' }), 18)));
ok('the tyre reads like a tyre', /^\d{3}\/\d{2} R\d{2}$/.test(perf.tyreSize(car(), perf.rimSize(car()))));
ok('a pickup sits higher than a sedan',
  perf.groundClearance(car({ body_type: 'Pickup' })) > perf.groundClearance(car({ body_type: 'Sedan' })));
ok('4WD lifts clearance further',
  perf.groundClearance(car({ body_type: 'SUV', drivetrain: '4WD' })) > perf.groundClearance(car({ body_type: 'SUV', drivetrain: '2WD' })));

console.log('\n— practicality —');
ok('a seven seater loses boot space to the third row',
  perf.bootLitres(car({ body_type: 'SUV', seats: 7 })) < perf.bootLitres(car({ body_type: 'SUV', seats: 5 })));
ok('a pickup carries more than a hatchback',
  perf.bootLitres(car({ body_type: 'Pickup' })) > perf.bootLitres(car({ body_type: 'Hatchback' })));
ok('an SUV holds more fuel than a hatchback',
  perf.fuelTank(car({ body_type: 'SUV' })) > perf.fuelTank(car({ body_type: 'Hatchback' })));

console.log('\n— inspection scorecard —');
const empty = perf.inspection(null);
ok('an uninspected car scores nothing, not a default pass', empty.overall === null);
ok('and says so plainly', empty.headline === 'Not yet inspected');
ok('all five areas are still listed', empty.areas.length === 5);
const partial = perf.inspection({ exterior: 90, interior: 80 });
ok('a partial inspection averages only what was scored', partial.overall === 85);
ok('and reports it as incomplete', partial.complete === false && partial.scoredCount === 2);
ok('an unscored area stays null', partial.areas.find((a) => a.key === 'tyres').score === null);
const full = perf.inspection({ exterior: 95, interior: 92, mechanical: 90, tyres: 88, electronics: 95 });
ok('a full inspection is marked complete', full.complete === true);
ok('and grades as excellent', full.headline.includes('Excellent'));
ok('a score above 100 is clamped', perf.inspection({ exterior: 500 }).areas[0].score === 100);
ok('a negative score is clamped', perf.inspection({ exterior: -20 }).areas[0].score === 0);
ok('60 is fair, not good', perf.inspection({ exterior: 60 }).areas[0].rating === 'Fair');
ok('75 is good', perf.inspection({ exterior: 75 }).areas[0].rating === 'Good');

console.log('\n— interior —');
const leathery = perf.interior(car({ features: ['Leather seats', 'Sunroof', 'Reverse camera'] }), empty);
ok('leather is read off the feature list', leathery.seats === 'Leather');
ok('a sunroof is spotted', leathery.sunroof === true);
ok('a camera is spotted', leathery.camera === true);
ok('a cheap car without a leather feature is fabric', perf.interior(car({ price: 900_000 }), empty).seats === 'Fabric');
ok('a stated seat material wins', perf.interior(car({ seat_material: 'Alcantara' }), empty).seats === 'Alcantara');

console.log('\n— the sheet —');
const sheet = perf.specSheet(car(), { kmPerLitre: 12 });
ok('an all-estimated sheet says so', sheet.estimated === true);
ok('and warns before anyone buys on it', /estimated/i.test(sheet.disclaimer));
ok('range per tank is economy times the tank', sheet.practical.rangePerTank === Math.round(12 * sheet.practical.fuelTank));
ok('power to weight is reported per tonne', sheet.performance.powerToWeight > 50 && sheet.performance.powerToWeight < 200);
ok('kW is stated alongside hp', sheet.performance.kw === Math.round(sheet.performance.hp * 0.7457));

const overridden = perf.specSheet(car({ power_hp: 300, zero_to_100: 5.2 }), { kmPerLitre: 12 });
ok('a stated horsepower overrides the estimate', overridden.performance.hp === 300);
ok('a stated 0-100 overrides the estimate', overridden.performance.zeroTo100 === 5.2);
ok('and the sheet is no longer wholly estimated', overridden.estimated === false);
ok('the measured fields are named', overridden.measured.includes('power') && overridden.measured.includes('zeroTo100'));
ok('the disclaimer names the measured figures in plain English',
  /power and 0–100 km\/h are this car's own recorded figures/.test(overridden.disclaimer), overridden.disclaimer);
ok('and never leaks an internal field name at the customer',
  !/zeroTo100|topSpeed|power_hp/.test(overridden.disclaimer), overridden.disclaimer);
ok('an unstated figure on the same car is still estimated', !overridden.measured.includes('topSpeed'));

ok('an electric car reports no range per tank',
  perf.specSheet(car({ fuel: 'Electric', engine_cc: null }), { kmPerLitre: null }).practical.rangePerTank === null);
ok('a sheet built with no economy at all does not throw',
  perf.specSheet(car(), null).practical.rangePerTank === null);
ok('a nearly empty vehicle row still produces a sheet',
  perf.specSheet({ make: 'Unknown', model: 'X', year: 2015 }).performance.hp > 0);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail);
