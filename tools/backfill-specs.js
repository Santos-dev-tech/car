'use strict';
/**
 * MotoKE — fill in the enthusiast spec columns on an existing database.
 *
 * `--reset` would do this by reseeding, but that also throws away the generated showroom
 * photographs, so this applies the same figures in place. Safe to re-run: it only writes
 * a column that is still empty, so a figure a dealership typed in is never overwritten.
 *
 *   node --no-warnings tools/backfill-specs.js [--force]
 */
const { all, run } = require('../lib/db');
const { MEASURED, inspectionFor } = require('../lib/seed');

const force = process.argv.includes('--force');
const rows = all('SELECT * FROM vehicles');
let touched = 0;
let measuredCount = 0;

for (const v of rows) {
  const patch = {};
  const m = MEASURED[`${v.make} ${v.model}`];
  if (m) {
    const fields = [['power_hp', 0], ['torque_nm', 1], ['zero_to_100', 2], ['top_speed', 3], ['kerb_weight', 4], ['rim_size', 5]];
    for (const [col, i] of fields) {
      if (force || v[col] == null) patch[col] = m[i];
    }
  }
  if (force || v.inspection == null) {
    const insp = inspectionFor(v.condition, v.mileage_km || 0, v.price);
    if (insp) patch.inspection = JSON.stringify(insp);
  }

  const keys = Object.keys(patch);
  if (!keys.length) continue;
  run(
    `UPDATE vehicles SET ${keys.map((k) => k + '=?').join(', ')} WHERE id=?`,
    [...keys.map((k) => patch[k]), v.id]
  );
  touched++;
  if (m) measuredCount++;
  console.log(`  #${String(v.id).padStart(3)}  ${v.year} ${v.make} ${v.model}  ->  ${keys.join(', ')}`);
}

console.log(`\n  ${touched} of ${rows.length} vehicles updated, ${measuredCount} with published figures\n`);
