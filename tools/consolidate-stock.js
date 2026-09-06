'use strict';
/**
 * MotoKE — move the whole book into the one dealership this install serves.
 *
 * The seed still lays stock out across five fictional dealerships, which is a leftover
 * from when this was a multi-tenant demo. Since it became a single-dealership product,
 * that meant roughly four cars in five were invisible to the storefront — including most
 * of the expensive stock, which is exactly what a dealership wants to show.
 *
 *   node --no-warnings tools/consolidate-stock.js [--apply] [--keep-foreign 3]
 *
 * A few cars are deliberately LEFT with the other dealerships. `siteDealer()` is a real
 * server-side boundary and `smoke.js` proves it by trying to reach another yard's car —
 * with nothing behind that boundary there is nothing to prove, and the test would pass
 * for the wrong reason.
 *
 * Branches move too. A vehicle keeps a `branch_id`, so a car moved between dealerships
 * without re-pointing it would show another company's branch name on the listing.
 */
const { all, get, run, getSetting } = require('../lib/db');

const apply = process.argv.includes('--apply');
const keepIdx = process.argv.indexOf('--keep-foreign');
const KEEP_FOREIGN = keepIdx > -1 ? Number(process.argv[keepIdx + 1]) || 0 : 3;

const siteSlug = getSetting('site_dealer', 'summit');
const site = get('SELECT * FROM dealers WHERE slug=?', [siteSlug]);
if (!site) {
  console.log(`\n  No dealership matches the site_dealer setting (${siteSlug}).\n`);
  process.exit(1);
}

const branches = all('SELECT id, name FROM branches WHERE dealer_id=? AND active=1 ORDER BY id', [site.id]);
if (!branches.length) {
  console.log('\n  The site dealership has no active branches to move stock into.\n');
  process.exit(1);
}

const others = all('SELECT * FROM dealers WHERE id<>? ORDER BY id', [site.id]);
const moving = [];
const staying = [];

for (const d of others) {
  /* Keep the cheapest few with each other yard: the boundary test only needs SOMETHING
     on the far side, and the showroom would rather keep the interesting cars. */
  const rows = all('SELECT * FROM vehicles WHERE dealer_id=? ORDER BY price ASC', [d.id]);
  staying.push(...rows.slice(0, KEEP_FOREIGN));
  moving.push(...rows.slice(KEEP_FOREIGN));
}

console.log(`\n  Site dealership: ${site.name} (${siteSlug})`);
console.log(`  Currently holds: ${get('SELECT COUNT(*) n FROM vehicles WHERE dealer_id=?', [site.id]).n} vehicles`);
console.log(`  Moving in:       ${moving.length}`);
console.log(`  Left elsewhere:  ${staying.length}  (so the single-tenant boundary stays testable)\n`);

if (!apply) {
  for (const v of moving.slice(0, 10)) console.log(`   would move  #${String(v.id).padStart(3)}  ${v.year} ${v.make} ${v.model}`);
  if (moving.length > 10) console.log(`   …and ${moving.length - 10} more`);
  console.log('\n  Re-run with --apply to move them.\n');
  process.exit(0);
}

/* Spread the incoming cars across the site's branches rather than dumping them all in
   one, so the branch filter on the storefront still means something. */
let i = 0;
for (const v of moving) {
  const branch = branches[i % branches.length];
  run('UPDATE vehicles SET dealer_id=?, branch_id=? WHERE id=?', [site.id, branch.id, v.id]);
  i++;
}

/* Any car already at the site dealership but pointing at a foreign branch gets fixed too
   — otherwise the listing shows another company's address. */
let repointed = 0;
const ours = all('SELECT id, branch_id FROM vehicles WHERE dealer_id=?', [site.id]);
const validBranchIds = new Set(branches.map((b) => b.id));
for (const v of ours) {
  if (v.branch_id == null || !validBranchIds.has(v.branch_id)) {
    run('UPDATE vehicles SET branch_id=? WHERE id=?', [branches[v.id % branches.length].id, v.id]);
    repointed++;
  }
}

const now = get('SELECT COUNT(*) n FROM vehicles WHERE dealer_id=?', [site.id]).n;
const forSale = get("SELECT COUNT(*) n FROM vehicles WHERE dealer_id=? AND status='available'", [site.id]).n;

console.log(`  ${moving.length} moved, ${repointed} branch pointers corrected.`);
console.log(`  ${site.name} now holds ${now} vehicles, ${forSale} of them on sale.\n`);
