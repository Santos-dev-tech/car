'use strict';
/**
 * MotoKE — point vehicles at the photographs that are sitting in public/img/cars.
 *
 *   node --no-warnings tools/link-photos.js          # report
 *   node --no-warnings tools/link-photos.js --apply  # write
 *
 * The photographs ship with the code. The database does not: a fresh install seeds its
 * stock from lib/seed.js, which writes drawn-SVG urls because a seed cannot know which
 * photographs a particular deployment happens to carry. So a newly deployed copy shows
 * drawings while the real photographs sit on disk beside it, unreferenced.
 *
 * That is what this fixes, and it is the opposite job to tools/repair-images.js — that one
 * removes references to files that have gone, this one adds references to files that are
 * there.
 *
 * SAFE TO RUN TWICE. It only ever prepends a photograph that exists on disk and is not
 * already in the row, and it never removes the SVG fallbacks: a drawing that renders is
 * worth more than a gap, and the SVGs cover the views no photograph exists for.
 */
const path = require('node:path');
const fs = require('node:fs');
const { all, run } = require('../lib/db');

const PUB = path.join(__dirname, '..', 'public');
const apply = process.argv.includes('--apply');
const exists = (rel) => fs.existsSync(path.join(PUB, rel.replace(/^\//, '')));

/* The order a showroom page wants them in: the car first, then the back, then inside.
   A wheel close-up is never the hero image. */
const SUFFIXES = ['', '-rear', '-interior', '-cabin', '-wheel'];

let touched = 0;
let added = 0;
let already = 0;
let none = 0;

for (const v of all('SELECT id, make, model, images FROM vehicles ORDER BY id')) {
  const photos = SUFFIXES
    .map((s) => `/img/cars/${v.id}${s}.jpg`)
    .filter(exists);

  if (!photos.length) { none++; continue; }

  let list;
  try { list = JSON.parse(v.images || '[]'); } catch { list = []; }
  if (!Array.isArray(list)) list = [];

  const missing = photos.filter((p) => !list.includes(p));
  if (!missing.length) { already++; continue; }

  /* Photographs in front, in view order; whatever was there follows. */
  const next = photos.concat(list.filter((u) => !photos.includes(u)));
  touched++;
  added += missing.length;
  console.log(
    `  ${String(v.id).padStart(3)}  ${(v.make + ' ' + v.model).padEnd(28)} ` +
    `+${missing.length} photo${missing.length === 1 ? '' : 's'}`
  );
  if (apply) run('UPDATE vehicles SET images=? WHERE id=?', [JSON.stringify(next), v.id]);
}

console.log(
  `\n  ${touched} vehicles would gain ${added} photographs` +
  `  ·  ${already} already linked  ·  ${none} have none on disk`
);
console.log(apply ? '  written.\n' : '  nothing written. Re-run with --apply.\n');
