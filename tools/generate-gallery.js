'use strict';
/**
 * MotoKE — extra gallery angles for cars that already have a hero shot.
 *
 *   node tools/generate-gallery.js [cars] [--angles rear,interior,cabin,wheel] [--dry]
 *
 * The research is unanimous that a listing wants 15–20 photographs: exterior angles,
 * interior, dashboard, boot. One hero shot per car is the biggest single gap between this
 * site and a top-tier one. Credits do not stretch to twenty a car, so this adds the four
 * that a buyer actually looks for after the front three-quarter.
 *
 * `generate-photos.js` does the hero shot. This one only ever ADDS, and skips any angle
 * already on disk, so it is safe to re-run and safe to stop half way.
 *
 * Cost: ~0.15 credits per image. It refuses to start if the balance cannot cover the run.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { all, get, run, getSetting } = require('../lib/db');

const NODE = process.execPath;
const HF_JS = 'C:\\Users\\ADMIN\\nodejs-portable\\node-v22.16.0-win-x64\\node_modules\\@higgsfield\\cli\\bin\\higgsfield.js';
const OUT_DIR = path.join(__dirname, '..', 'public', 'img', 'cars');
const COST_EACH = 0.15;

const argv = process.argv.slice(2);
const dry = argv.includes('--dry');
const carLimit = Number(argv.find((a) => /^\d+$/.test(a))) || 10;
const angleArg = (argv.find((a) => a.startsWith('--angles=')) || '').split('=')[1];

/**
 * The four angles a buyer looks for after the hero shot, in the order they matter.
 * `studio` keeps the exterior angles on the same black stage as the hero so a gallery
 * does not jump between locations; the interior shots have to leave it, obviously.
 */
const ANGLES = {
  rear: {
    label: 'rear three-quarter',
    studio: true,
    shot: 'three-quarter REAR view from behind and to the side, showing the tail lights, rear bumper and boot lid',
  },
  interior: {
    label: 'dashboard',
    studio: false,
    shot:
      'INTERIOR photograph shot from the rear seat looking forward at the dashboard, steering wheel, ' +
      'instrument cluster and centre console screen, both front seats visible',
  },
  cabin: {
    label: 'front seats',
    studio: false,
    shot:
      'INTERIOR photograph shot through the open driver door showing the front seats, ' +
      'door card and gear selector, clean upholstery',
  },
  wheel: {
    label: 'wheel detail',
    studio: true,
    shot:
      'tight DETAIL photograph of the front wheel and alloy rim, brake caliper visible behind the spokes, ' +
      'tyre sidewall sharp, lower body panel and wheel arch in frame',
  },
};

const wanted = (angleArg ? angleArg.split(',') : Object.keys(ANGLES)).filter((a) => ANGLES[a]);

/** The car described identically every time, so the gallery looks like one vehicle. */
function subject(v) {
  const colour = (v.color || 'silver').toLowerCase();
  return `${v.year} ${v.make} ${v.model} ${v.body_type || 'car'} in ${colour} paint`;
}

function promptFor(v, key) {
  const a = ANGLES[key];
  const trim = v.seat_material
    ? `${String(v.seat_material).toLowerCase()} seats`
    : Number(v.price) > 3.5e6
    ? 'part leather seats'
    : 'clean fabric seats';

  if (a.studio) {
    return [
      `Cinematic automotive studio photograph of a ${subject(v)}`,
      a.shot,
      'parked in a matte black photography studio, single dramatic overhead spotlight',
      'glossy reflective dark floor with a soft reflection under the car',
      'rim lighting along the body panels, deep black background, high contrast, low key',
      v.condition === 'new' ? 'brand new, flawless paint' : 'immaculate, showroom prepared, no visible wear',
      'no people, no text, no watermark, no licence plate lettering',
      'ultra sharp, editorial car magazine quality, 35mm lens',
    ].join(', ');
  }

  return [
    `Interior photograph inside a ${subject(v)}`,
    a.shot,
    trim,
    'soft even daylight through the windows, clean and spotless, professionally detailed',
    'realistic materials, accurate switchgear, no clutter on the seats',
    'no people, no text, no watermark',
    'ultra sharp, editorial car magazine quality, 24mm lens, natural colour',
  ].join(', ');
}

function credits() {
  try {
    const out = execFileSync(NODE, [HF_JS, 'account', 'status'], { encoding: 'utf8' });
    const m = /(\d+(?:\.\d+)?)\s*credits/i.exec(out);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

function generate(prompt) {
  const out = execFileSync(
    NODE,
    [HF_JS, 'generate', 'create', 'z_image', '--prompt', prompt, '--aspect_ratio', '16:9', '--wait'],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }
  );
  const url = (out.match(/https?:\/\/\S+\.(?:png|jpg|jpeg|webp)/i) || [])[0];
  if (!url) throw new Error('no image URL in output: ' + out.trim().slice(0, 200));
  return url;
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

/** Hero first, then the angles in a fixed order, then the SVG fallbacks. */
function galleryFor(v) {
  const existing = JSON.parse(v.images || '[]');
  const hero = existing.filter((s) => /\/img\/cars\/\d+\.(png|jpg)$/.test(s));
  const svgs = existing.filter((s) => s.startsWith('/img/vehicle.svg'));
  const angles = [];
  for (const key of Object.keys(ANGLES)) {
    for (const ext of ['jpg', 'png']) {
      const file = `${v.id}-${key}.${ext}`;
      if (fs.existsSync(path.join(OUT_DIR, file))) {
        angles.push(`/img/cars/${file}`);
        break;
      }
    }
  }
  return [...hero, ...angles, ...svgs];
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const siteSlug = getSetting('site_dealer', 'summit');
  const dealer = get('SELECT id, name FROM dealers WHERE slug=?', [siteSlug]);

  /* Only cars that already have a hero shot, best-sellers first. An interior with no
     exterior is a worse listing than one good exterior. */
  const rows = all(
    `SELECT * FROM vehicles WHERE dealer_id=? AND status IN ('available','reserved')
     ORDER BY featured DESC, views DESC, price DESC`,
    [dealer.id]
  ).filter((v) => /\/img\/cars\/\d+\.(png|jpg)/.test(v.images || ''));

  const cars = rows.slice(0, carLimit);

  // Build the work list first so the cost is known before a single credit is spent.
  const jobs = [];
  for (const v of cars) {
    for (const key of wanted) {
      const done = ['jpg', 'png'].some((e) => fs.existsSync(path.join(OUT_DIR, `${v.id}-${key}.${e}`)));
      if (!done) jobs.push({ v, key });
    }
  }

  const have = credits();
  const need = jobs.length * COST_EACH;
  console.log(`\n  ${dealer.name}: ${rows.length} cars have a hero shot, taking the top ${cars.length}`);
  console.log(`  angles: ${wanted.join(', ')}`);
  console.log(`  ${jobs.length} images to make — about ${need.toFixed(2)} credits of ${have == null ? '?' : have}\n`);

  if (!jobs.length) return console.log('  Nothing to do — every angle already exists.\n');
  if (have != null && have < need) {
    const affordable = Math.floor(have / COST_EACH);
    console.log(`  Not enough credits. That balance covers ${affordable} images —`);
    console.log(`  re-run with a smaller car count, or --angles=rear,interior\n`);
    process.exit(1);
  }
  if (dry) {
    for (const j of jobs) console.log(`   would shoot  ${j.v.id}-${j.key}  ${j.v.year} ${j.v.make} ${j.v.model}`);
    return console.log(`\n  Dry run. ${jobs.length} images, ~${need.toFixed(2)} credits.\n`);
  }

  let done = 0;
  let failed = 0;
  const touched = new Set();

  for (const { v, key } of jobs) {
    const label = `${v.year} ${v.make} ${v.model}`.slice(0, 30);
    process.stdout.write(`  [${done + failed + 1}/${jobs.length}] ${label.padEnd(31)} ${ANGLES[key].label.padEnd(19)} `);
    try {
      const url = generate(promptFor(v, key));
      const file = path.join(OUT_DIR, `${v.id}-${key}.png`);
      await download(url, file);
      touched.add(v.id);
      done++;
      console.log(`ok  (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
    } catch (e) {
      failed++;
      console.log(`FAILED — ${e.message.slice(0, 70)}`);
    }
  }

  /* Re-read each touched row before rewriting its gallery: the loop above may have run
     for several minutes and `v.images` is stale by now. */
  for (const id of touched) {
    const fresh = get('SELECT * FROM vehicles WHERE id=?', [id]);
    run('UPDATE vehicles SET images=? WHERE id=?', [JSON.stringify(galleryFor(fresh)), id]);
  }

  console.log(`\n  ${done} shot, ${failed} failed, ${touched.size} galleries updated.`);
  console.log(`  Credits left: ${credits() ?? 'unknown'}`);
  console.log(`  Now run:  python tools/optimise-photos.py\n`);
})();
