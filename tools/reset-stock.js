'use strict';
/**
 * MotoKE — put the demo yard back on sale.
 *
 * The smoke suite books a car on every run. Until it learned to release it again, those
 * holds accumulated and the storefront eventually showed nothing. This clears the
 * leftovers without touching the generated showroom photographs, which is what `--reset`
 * would throw away.
 *
 *   node --no-warnings tools/reset-stock.js          # report only
 *   node --no-warnings tools/reset-stock.js --apply  # actually release them
 */
const { all, run } = require('../lib/db');

const apply = process.argv.includes('--apply');

const held = all(
  `SELECT id, year, make, model, status FROM vehicles
   WHERE status IN ('reserved', 'sold') ORDER BY id`
);

if (!held.length) {
  console.log('\n  Nothing held. The whole yard is on sale.\n');
  process.exit(0);
}

console.log(`\n  ${held.length} vehicle(s) not on sale:\n`);
for (const v of held) {
  console.log(`   #${String(v.id).padStart(3)}  ${v.year} ${v.make} ${v.model}  — ${v.status}`);
}

if (!apply) {
  console.log('\n  Re-run with --apply to put them back on sale.\n');
  process.exit(0);
}

/* Release the bookings too, otherwise the car is available but still shows a live hold
   on the tracker, which reads as a bug to anyone being shown the demo. */
const ids = held.map((v) => v.id);
const marks = ids.map(() => '?').join(',');
run(`UPDATE vehicles SET status='available' WHERE id IN (${marks})`, ids);

let orders = 0;
try {
  const res = run(
    `UPDATE orders SET status='cancelled' WHERE status IN ('paid','pending') AND vehicle_id IN (${marks})`,
    ids
  );
  orders = (res && res.changes) || 0;
} catch {
  /* older databases predate the orders table; releasing the stock is the point */
}

console.log(`\n  ${ids.length} vehicle(s) back on sale, ${orders} booking(s) cancelled.\n`);
