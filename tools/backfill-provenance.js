'use strict';
/**
 * MotoKE — fill in provenance checks and the dealership's promises.
 *
 * Same rule as `backfill-specs.js`: applied in place so a database that already holds
 * generated photographs survives, and never overwrites something a yard typed in.
 *
 *   node --no-warnings tools/backfill-provenance.js [--force]
 */
const { all, get, run, getSetting } = require('../lib/db');

const force = process.argv.includes('--force');

/* The dealership's standing promises. Fictional, like every other figure in the seed —
   a real install sets these in Admin → Dealership before saying anything commercial. */
const siteSlug = getSetting('site_dealer', 'summit');
const dealer = get('SELECT * FROM dealers WHERE slug=?', [siteSlug]);
if (dealer && (force || !dealer.return_days)) {
  run(
    'UPDATE dealers SET return_days=?, return_terms=?, transfer_included=1 WHERE id=?',
    [
      7,
      'Change your mind within 7 days and bring it back, provided it has done under 300 km and is in the condition it left in. Financed deals are unwound with the lender.',
      dealer.id,
    ]
  );
  console.log(`\n  ${dealer.name}: 7-day return window, transfer included.\n`);
}

/**
 * A car cleared through a yard's own workshop gets the checks that yard actually does.
 * Deliberately NOT all-clear on everything: a page where every car passes every check
 * teaches a buyer to ignore the checks. Older and higher-mileage stock leaves the
 * odometer check unverified, which is the honest state for most Kenyan imports.
 */
function historyFor(v) {
  const age = new Date().getFullYear() - (Number(v.year) || 2015);
  const km = Number(v.mileage_km) || 0;
  const imported = v.condition === 'foreign_used';

  const h = {
    logbookLoan: true,
    timsMatch: true,
    accidentFree: true,
    checkedOn: new Date(Date.now() - ((v.id % 30) + 2) * 864e5).toISOString().slice(0, 10),
  };

  // Verified against stamps only where there is a service history to check it against.
  if (km < 120000 && age <= 8) h.odometerVerified = true;

  if (imported) {
    h.dutyVerified = !!v.duty_paid;
    h.importEntry = v.source_ref ? `KRA/${String(v.source_ref).replace(/\D/g, '').slice(0, 8)}` : null;
    h.keepers = 1;
  } else {
    h.dutyVerified = !!v.duty_paid;
    h.keepers = age > 8 ? 3 : 2;
  }

  // A handful of older, harder-worked cars honestly carry a mark against them.
  if (age >= 9 && v.id % 4 === 0) {
    h.accidentFree = false;
    h.notes = 'Repaired front-end damage on record. Panel work inspected and sound; priced accordingly.';
  }

  for (const k of Object.keys(h)) if (h[k] === null) delete h[k];
  return h;
}

const rows = all('SELECT * FROM vehicles');
let touched = 0;
for (const v of rows) {
  if (!force && v.history) continue;
  const h = historyFor(v);
  run('UPDATE vehicles SET history=?, transfer_included=1 WHERE id=?', [JSON.stringify(h), v.id]);
  touched++;
}

console.log(`  ${touched} of ${rows.length} vehicles given provenance checks.\n`);
