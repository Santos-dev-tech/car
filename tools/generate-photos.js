'use strict';
/**
 * MotoKE — generate showroom photography for the catalogue.
 *
 *   node tools/generate-photos.js [count] [--all]
 *
 * Builds one prompt per vehicle from its own record (year, make, model, colour, body,
 * condition), sends it to Higgsfield's Z Image model, downloads the result into
 * public/img/cars/, and points the vehicle's images array at the local file.
 *
 * Images are DOWNLOADED, never hot-linked: the whole app has to keep working with no
 * internet, and a demo that shows broken images at a pitch is worse than no photos.
 * Any vehicle without a photo keeps falling back to the generated SVG, so the grid is
 * never half-empty.
 *
 * Cost: Z Image is ~0.15 credits per image. Check `higgsfield account status` first —
 * the script refuses to start if the balance cannot cover the batch.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { all, get, run, getSetting } = require('../lib/db');

// Call the CLI's own JS entry with node rather than the .cmd shim: Node on Windows
// cannot execFile a .cmd without a shell, and going through a shell would mangle the
// long prompt's punctuation.
const NODE = process.execPath;
const HF_JS = 'C:\\Users\\ADMIN\\nodejs-portable\\node-v22.16.0-win-x64\\node_modules\\@higgsfield\\cli\\bin\\higgsfield.js';
const OUT_DIR = path.join(__dirname, '..', 'public', 'img', 'cars');
const COST_EACH = 0.15;

const args = process.argv.slice(2);
const wantAll = args.includes('--all');
const count = Number(args.find((a) => /^\d+$/.test(a))) || 12;

/* --ids 29,47 shoots exactly those cars and nothing else.
   The default ordering (featured, then views, then price) is right when you are working
   through the whole yard, and useless when the balance only covers two images and you
   know precisely which two you want. Spending the last credits on whatever happened to
   sort first is not a decision anyone would make on purpose. */
const idsArg = (() => {
  const i = args.indexOf('--ids');
  return i > -1 && args[i + 1] ? args[i + 1] : null;
})();
const wantIds = idsArg ? idsArg.split(',').map((n) => Number(n.trim())).filter(Boolean) : null;

/** Body-specific framing, so a pickup is not shot like a hatchback. */
const FRAMING = {
  Pickup: 'three-quarter front view, slightly low camera angle to show ride height and the load bed',
  Truck: 'three-quarter front view, wide shot showing the full body length',
  SUV: 'three-quarter front view, low camera angle emphasising stance and ground clearance',
  Van: 'three-quarter front view showing the full side profile and sliding door',
  MPV: 'three-quarter front view showing the full side profile',
  'Station Wagon': 'three-quarter front view showing the long roofline',
  Sedan: 'three-quarter front view at hip height, classic press-shot framing',
  Hatchback: 'three-quarter front view at hip height, compact framing',
  Coupe: 'low three-quarter front view, dramatic and close',
};

function promptFor(v) {
  const framing = FRAMING[v.body_type] || 'three-quarter front view, classic press-shot framing';
  const colour = (v.color || 'silver').toLowerCase();
  const age = v.condition === 'new' ? 'brand new, flawless paint' : 'immaculate, showroom prepared, no visible wear';
  return [
    `Cinematic automotive studio photograph of a ${v.year} ${v.make} ${v.model}`,
    `${v.body_type || 'car'} in ${colour} paint`,
    framing,
    'parked in a matte black photography studio, single dramatic overhead spotlight',
    'glossy reflective dark floor with a soft reflection under the car',
    'rim lighting along the body panels, deep black background, high contrast, low key',
    age,
    'no people, no text, no watermark, no licence plate lettering',
    'ultra sharp, editorial car magazine quality, 35mm lens',
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

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const siteSlug = getSetting('site_dealer', 'summit');
  const dealer = get('SELECT id, name FROM dealers WHERE slug=?', [siteSlug]);

  // Featured and most-viewed first — those are the cars a visitor actually sees.
  const rows = all(
    `SELECT * FROM vehicles WHERE dealer_id=? AND status IN ('available','reserved')
     ORDER BY featured DESC, views DESC, price DESC`,
    [dealer.id]
  );
  /* Look for BOTH extensions. The optimiser converts the PNG to JPEG and deletes the
     original, so a .png-only check thinks every already-photographed car still needs
     shooting — which quietly spends the whole balance re-doing work. */
  const hasPhoto = (id) => ['png', 'jpg'].some((e) => fs.existsSync(path.join(OUT_DIR, `${id}.${e}`)));
  const pool = wantIds
    ? wantIds.map((id) => rows.find((v) => v.id === id)).filter(Boolean)
    : wantAll
      ? rows
      : rows.slice(0, count);
  if (wantIds && pool.length !== wantIds.length) {
    const missing = wantIds.filter((id) => !rows.some((v) => v.id === id));
    console.log(`  Not in this dealer's live stock, skipped: ${missing.join(', ')}`);
  }
  const todo = pool.filter((v) => !hasPhoto(v.id));

  const have = credits();
  const need = todo.length * COST_EACH;
  console.log(`\n  ${dealer.name}: ${rows.length} vehicles, ${todo.length} still need a photo`);
  console.log(`  budget: ${have == null ? 'unknown' : have} credits, this batch needs ~${need.toFixed(2)}\n`);
  if (have != null && have < need) {
    console.log(`  Not enough credits for ${todo.length} images. Run with a smaller count.`);
    process.exit(1);
  }
  if (!todo.length) {
    console.log('  Nothing to do — every selected vehicle already has a photo.');
    return;
  }

  let done = 0;
  let failed = 0;
  for (const v of todo) {
    const label = `${v.year} ${v.make} ${v.model}`;
    process.stdout.write(`  [${done + failed + 1}/${todo.length}] ${label.padEnd(38)} `);
    try {
      const url = generate(promptFor(v));
      const file = path.join(OUT_DIR, `${v.id}.png`);
      await download(url, file);

      // Local path first, generated SVG views kept behind it as the gallery tail.
      const existing = JSON.parse(v.images || '[]').filter((s) => s.startsWith('/img/vehicle.svg'));
      run('UPDATE vehicles SET images=? WHERE id=?', [
        JSON.stringify([`/img/cars/${v.id}.png`, ...existing]),
        v.id,
      ]);
      done++;
      console.log(`ok  (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
    } catch (e) {
      failed++;
      console.log(`FAILED — ${e.message.slice(0, 80)}`);
    }
  }

  console.log(`\n  ${done} photographed, ${failed} failed. Remaining credits: ${credits() ?? 'unknown'}\n`);
})();
