'use strict';
/**
 * MotoKE — give the demo stock realistic arrival dates.
 *
 * The seed creates every car in the same instant, so the ageing view shows 65 cars all
 * nought days old and the whole feature looks broken. A real forecourt has a spread:
 * most stock moving inside a couple of months, and a tail of cars that have been sitting
 * far too long — which is exactly what the view exists to surface.
 *
 *   node --no-warnings tools/backfill-stock-age.js [--force]
 *
 * Deterministic from the vehicle id, so re-running gives the same answer and the demo
 * does not change shape between showings.
 */
const { all, run } = require('../lib/db');

const force = process.argv.includes('--force');
const rows = all('SELECT id, created_at, price, status FROM vehicles ORDER BY id');

/**
 * A believable ageing curve. Roughly:
 *   ~55%  under 30 days   — healthy stock
 *   ~20%  31 to 45        — worth watching
 *   ~13%  46 to 60        — starting to hurt
 *   ~12%  over 60         — the ones the view is for
 * Expensive cars skew older, which is true of every forecourt: a nine-million-shilling
 * Land Cruiser sits longer than a Vitz.
 */
function ageFor(v) {
  const seed = (v.id * 2654435761) % 100; // cheap deterministic spread
  let days;
  if (seed < 55) days = 2 + (seed % 28);
  else if (seed < 75) days = 31 + (seed % 15);
  else if (seed < 88) days = 46 + (seed % 15);
  else days = 61 + (seed % 90);

  if (v.price > 6_000_000) days = Math.round(days * 1.5);
  return Math.min(210, days);
}

let touched = 0;
const spread = { fresh: 0, watch: 0, ageing: 0, stale: 0 };

for (const v of rows) {
  // Only backdate rows still sitting on the seed's own timestamp, unless forced.
  if (!force && v.created_at && new Date(v.created_at).getTime() < Date.now() - 2 * 864e5) continue;

  const days = ageFor(v);
  const when = new Date(Date.now() - days * 864e5).toISOString().replace('T', ' ').slice(0, 19);
  run('UPDATE vehicles SET created_at=? WHERE id=?', [when, v.id]);
  touched++;

  if (days <= 30) spread.fresh++;
  else if (days <= 45) spread.watch++;
  else if (days <= 60) spread.ageing++;
  else spread.stale++;
}

console.log(`\n  ${touched} of ${rows.length} vehicles given an arrival date.`);
console.log(`    0–30 days  ${spread.fresh}`);
console.log(`   31–45 days  ${spread.watch}`);
console.log(`   46–60 days  ${spread.ageing}`);
console.log(`   over 60     ${spread.stale}\n`);
