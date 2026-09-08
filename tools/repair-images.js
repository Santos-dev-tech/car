'use strict';
/**
 * MotoKE — point vehicle images at files that actually exist.
 *
 *   node --no-warnings tools/repair-images.js          # report
 *   node --no-warnings tools/repair-images.js --apply  # fix
 *
 * tools/optimise-photos.py converts the generated PNGs to JPEG and deletes the originals,
 * but nothing ever rewrote the rows that referenced them. Nine cars were left pointing at
 * files that had been deleted, and a broken <img> in a showcase is not a small cosmetic
 * problem: it is the hero of the page showing its alt text to a dealer.
 *
 * Anything with no replacement on disk falls back to the drawn SVG, which always renders.
 */
const path = require('node:path');
const fs = require('node:fs');
const { all, run } = require('../lib/db');

const PUB = path.join(__dirname, '..', 'public');
const apply = process.argv.includes('--apply');
const exists = (url) => fs.existsSync(path.join(PUB, url.replace(/^\//, '').split('?')[0]));

const svgFor = (v, view) =>
  `/img/vehicle.svg?make=${encodeURIComponent(v.make)}&model=${encodeURIComponent(v.model)}` +
  `&color=${encodeURIComponent(v.color || '')}&view=${view || 'front'}`;

const VIEWS = ['front', 'side', 'rear', 'interior', 'dash', 'wheels'];

let broken = 0;
let fixed = 0;
let dropped = 0;

for (const v of all("SELECT id, make, model, color, images FROM vehicles WHERE status<>'draft'")) {
  let list;
  try {
    list = JSON.parse(v.images || '[]');
  } catch {
    list = [];
  }
  if (!Array.isArray(list) || !list.length) continue;

  let changed = false;
  const out = list.map((url, i) => {
    if (typeof url !== 'string' || !url.startsWith('/img/cars/')) return url;
    if (exists(url)) return url;
    broken++;

    // The optimiser writes .jpg beside the .png it deletes.
    const jpg = url.replace(/\.png$/i, '.jpg');
    if (jpg !== url && exists(jpg)) {
      changed = true;
      fixed++;
      console.log(`  #${v.id} ${v.make} ${v.model}: ${url} -> ${jpg}`);
      return jpg;
    }

    // Nothing on disk. The drawn car always renders, so it is a better answer than a
    // broken image — and on the showcase it is the better-looking one anyway.
    changed = true;
    dropped++;
    console.log(`  #${v.id} ${v.make} ${v.model}: ${url} -> drawn SVG (no file)`);
    return svgFor(v, VIEWS[i] || 'front');
  });

  if (changed && apply) run('UPDATE vehicles SET images=? WHERE id=?', [JSON.stringify(out), v.id]);
}

console.log(`\n  ${broken} broken reference(s): ${fixed} repointed to .jpg, ${dropped} fell back to the drawn car.`);
if (!apply && broken) console.log('  Re-run with --apply to write them.\n');
else if (apply) console.log('  Written.\n');
