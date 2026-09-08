'use strict';
/**
 * MotoKE - zero-dependency HTTP server.
 * Run:  node server.js [--port 4000] [--reset]
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');

const argv = process.argv.slice(2);
const argFlag = (name) => argv.includes('--' + name);
const argVal = (name, fallback) => {
  const i = argv.indexOf('--' + name);
  return i > -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

if (argFlag('reset')) {
  const dataDir = path.join(__dirname, 'data');
  for (const f of fs.existsSync(dataDir) ? fs.readdirSync(dataDir) : []) {
    if (f.startsWith('motoke.db')) fs.rmSync(path.join(dataDir, f), { force: true });
  }
  console.log('· database reset');
}

const { seedIfEmpty } = require('./lib/seed');
const { seedDemoActivity } = require('./lib/demo');
const { routes, ApiError } = require('./lib/api');
const auth = require('./lib/auth');
const sec = require('./lib/security');
const jobs = require('./lib/jobs');
const com = require('./lib/commerce');
const { DB_PATH, getSetting } = require('./lib/db');

const PORT = Number(process.env.PORT || argVal('port', 4000));
const PUBLIC_DIR = path.join(__dirname, 'public');

const seeded = seedIfEmpty();
const activity = seedDemoActivity();

/* ---------------- static ---------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  if (rel === '/admin' || rel === '/admin/') rel = '/admin.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[\/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return true;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return false;
  const ext = path.extname(filePath).toLowerCase();
  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': body.length,
    // app shell is revalidated every load; only static media is cached
    'Cache-Control': ['.html', '.js', '.css'].includes(ext) ? 'no-cache' : 'public, max-age=3600',
  });
  res.end(body);
  return true;
}

/* -------- generated vehicle placeholder image (offline-safe) -------- */

function vehicleSvg(q) {
  const make = String(q.make || 'Vehicle');
  const model = String(q.model || '');
  const colour = String(q.color || '#334155');
  const named = {
    'pearl white': '#eef2f5', white: '#f1f5f9', silver: '#cbd5e1', 'lunar silver': '#cbd5e1', grey: '#94a3b8',
    graphite: '#475569', 'selenite grey': '#64748b', black: '#1e293b', 'obsidian black': '#0f172a',
    'santorini black': '#111827', red: '#dc2626', 'soul red': '#b91c1c', blue: '#2563eb', 'dark blue': '#1e3a8a',
    'deep blue': '#1e40af', bronze: '#a16207', mint: '#6ee7b7', purple: '#7e22ce', 'alpine white': '#f8fafc',
    'crystal white': '#f8fafc', 'urban khaki': '#78716c', 'white pearl': '#eef2f5',
  };
  const body = named[colour.toLowerCase()] || (colour.startsWith('#') ? colour : '#475569');

  /* `bare=1` is the cut-out used by the showcase — no plate behind the car. That changes
     what the outline has to do. On the dark plate a -28 shade is plenty, because the car
     is light against near-black. As a cut-out on light grey, a white car outlined in
     near-white is an invisible car. So a pale body gets a genuinely dark outline; a dark
     body already reads and is left alone. */
  const bare = q.bare === '1' || q.bare === 'true';
  const pale = (() => {
    const m = /^#?([a-f\d]{6})$/i.exec(body);
    if (!m) return false;
    const n = parseInt(m[1], 16);
    return (((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255)) / 3 > 168;
  })();
  const dark = shade(body, bare && pale ? -118 : -28);
  const light = shade(body, 22);
  const label = `${make} ${model}`.trim();
  const view = String(q.view || 'front').toLowerCase();

  // Each gallery slot draws a different scene so thumbnails are distinguishable.
  const scenes = {
    /* Side profile. This is the view the showcase uses, so it is the one that has to
       hold up at 700px wide.

       Drawn to real proportions rather than as a rounded blob: the wheels sit ON the
       ground line with the arches cut into the body over them, the greenhouse is inset
       from the body with visible pillars, and there is a beltline and a door shut. Those
       four things are the difference between a car and a cartoon of a car. */
    side: `
    <ellipse cx="400" cy="408" rx="286" ry="17" fill="#000" opacity="0.35"/>

    <!-- body: bumper, bonnet, screen, roof, rear screen, boot, back to the ground -->
    <path d="M112 352
             C112 328 122 312 146 304
             L214 288
             L286 232 C300 218 320 210 342 210
             L486 210 C512 210 534 219 550 236
             L610 296
             L672 308 C696 314 706 328 706 350
             L706 372 C706 382 698 388 688 388
             L130 388 C119 388 112 381 112 371 Z"
          fill="url(#car)" stroke="${dark}" stroke-width="3" stroke-linejoin="round"/>

    <!-- greenhouse, inset, with a B-pillar between the two panes -->
    <path d="M300 240 C310 230 324 224 340 224 L392 224 L392 288 L250 288 Z" fill="#0f172a" opacity="0.5"/>
    <path d="M408 224 L482 224 C500 224 514 231 526 244 L562 288 L408 288 Z" fill="#0f172a" opacity="0.5"/>

    <!-- beltline and door shut: the two lines that stop it reading as one moulded lump -->
    <path d="M150 306 L668 306" stroke="${dark}" stroke-width="2" opacity="0.45" fill="none"/>
    <path d="M400 288 L400 384" stroke="${dark}" stroke-width="2" opacity="0.35" fill="none"/>

    <!-- lamps, sitting in the bodywork rather than floating on it -->
    <path d="M116 330 L156 326 L156 344 L116 344 Z" fill="#fde68a" opacity="0.92"/>
    <path d="M702 330 L664 326 L664 344 L702 344 Z" fill="#fca5a5" opacity="0.92"/>

    <!-- arches cut into the body, so the wheels belong to the car -->
    <path d="M182 388 A62 62 0 0 1 306 388 Z" fill="${dark}" opacity="0.55"/>
    <path d="M508 388 A62 62 0 0 1 632 388 Z" fill="${dark}" opacity="0.55"/>

    <g fill="#14161a"><circle cx="244" cy="388" r="56"/><circle cx="570" cy="388" r="56"/></g>
    <g fill="#2b3038"><circle cx="244" cy="388" r="34"/><circle cx="570" cy="388" r="34"/></g>
    <g fill="#aeb4bd"><circle cx="244" cy="388" r="21"/><circle cx="570" cy="388" r="21"/></g>
    <g fill="#14161a"><circle cx="244" cy="388" r="7"/><circle cx="570" cy="388" r="7"/></g>`,
    front: `
    <ellipse cx="400" cy="410" rx="250" ry="24" fill="#000" opacity="0.35"/>
    <path d="M180 372 L180 268 C180 236 206 214 240 208 L280 176 C292 166 310 160 330 160 L470 160 C490 160 508 166 520 176 L560 208 C594 214 620 236 620 268 L620 372 C620 382 612 388 602 388 L198 388 C188 388 180 382 180 372 Z" fill="url(#car)" stroke="${dark}" stroke-width="3"/>
    <path d="M296 186 L504 186 L540 236 L260 236 Z" fill="#0f172a" opacity="0.6"/>
    <rect x="196" y="258" width="78" height="30" rx="12" fill="#fef9c3" opacity="0.92"/>
    <rect x="526" y="258" width="78" height="30" rx="12" fill="#fef9c3" opacity="0.92"/>
    <rect x="296" y="300" width="208" height="44" rx="9" fill="#0b1120" opacity="0.75"/>
    <rect x="336" y="312" width="128" height="20" rx="4" fill="#e2e8f0" opacity="0.85"/>
    <rect x="280" y="252" width="240" height="12" rx="6" fill="${dark}"/>`,
    rear: `
    <ellipse cx="400" cy="410" rx="250" ry="24" fill="#000" opacity="0.35"/>
    <path d="M186 372 L186 262 C186 232 210 212 244 206 L282 172 C294 162 312 158 332 158 L468 158 C488 158 506 162 518 172 L556 206 C590 212 614 232 614 262 L614 372 C614 382 606 388 596 388 L204 388 C194 388 186 382 186 372 Z" fill="url(#car)" stroke="${dark}" stroke-width="3"/>
    <path d="M300 184 L500 184 L532 232 L268 232 Z" fill="#0f172a" opacity="0.62"/>
    <rect x="200" y="256" width="92" height="34" rx="10" fill="#f87171" opacity="0.95"/>
    <rect x="508" y="256" width="92" height="34" rx="10" fill="#f87171" opacity="0.95"/>
    <rect x="308" y="304" width="184" height="42" rx="8" fill="#f8fafc" opacity="0.92"/>
    <text x="400" y="333" text-anchor="middle" font-family="ui-monospace,Consolas,monospace" font-size="24" font-weight="700" fill="#0f172a">KAA 000A</text>
    <ellipse cx="264" cy="368" rx="18" ry="9" fill="#0b1120"/><ellipse cx="536" cy="368" rx="18" ry="9" fill="#0b1120"/>`,
    interior: `
    <rect x="60" y="90" width="680" height="300" rx="18" fill="#111827"/>
    <path d="M60 250 L740 250 L740 390 L60 390 Z" fill="${dark}" opacity="0.85"/>
    <rect x="110" y="140" width="260" height="200" rx="22" fill="${body}" stroke="${dark}" stroke-width="3"/>
    <rect x="430" y="140" width="260" height="200" rx="22" fill="${body}" stroke="${dark}" stroke-width="3"/>
    <rect x="140" y="170" width="200" height="60" rx="12" fill="${light}" opacity="0.55"/>
    <rect x="460" y="170" width="200" height="60" rx="12" fill="${light}" opacity="0.55"/>
    <rect x="140" y="248" width="200" height="70" rx="12" fill="${light}" opacity="0.35"/>
    <rect x="460" y="248" width="200" height="70" rx="12" fill="${light}" opacity="0.35"/>
    <rect x="386" y="150" width="28" height="220" rx="10" fill="#0b1120"/>`,
    dash: `
    <rect x="50" y="100" width="700" height="290" rx="20" fill="#0f172a"/>
    <circle cx="250" cy="250" r="86" fill="none" stroke="${light}" stroke-width="7" opacity="0.85"/>
    <circle cx="250" cy="250" r="60" fill="none" stroke="#334155" stroke-width="3"/>
    <path d="M250 250 L250 186" stroke="#f87171" stroke-width="5" stroke-linecap="round"/>
    <circle cx="430" cy="250" r="86" fill="none" stroke="${light}" stroke-width="7" opacity="0.85"/>
    <path d="M430 250 L482 214" stroke="#f87171" stroke-width="5" stroke-linecap="round"/>
    <rect x="546" y="176" width="164" height="120" rx="12" fill="#1e293b" stroke="#334155" stroke-width="3"/>
    <rect x="566" y="198" width="124" height="12" rx="6" fill="#38bdf8" opacity="0.7"/>
    <rect x="566" y="222" width="94" height="12" rx="6" fill="#475569"/>
    <rect x="566" y="246" width="110" height="12" rx="6" fill="#475569"/>
    <rect x="120" y="336" width="560" height="20" rx="10" fill="#1e293b"/>`,
    wheels: `
    <ellipse cx="400" cy="420" rx="240" ry="22" fill="#000" opacity="0.3"/>
    <circle cx="400" cy="250" r="160" fill="#0b1120"/>
    <circle cx="400" cy="250" r="118" fill="#1e293b"/>
    <circle cx="400" cy="250" r="96" fill="#94a3b8"/>
    <circle cx="400" cy="250" r="30" fill="${body}" stroke="${dark}" stroke-width="4"/>
    ${Array.from({ length: 10 }, (_, i) => {
      const a = (i / 10) * Math.PI * 2;
      const x1 = 400 + Math.cos(a) * 36;
      const y1 = 250 + Math.sin(a) * 36;
      const x2 = 400 + Math.cos(a) * 92;
      const y2 = 250 + Math.sin(a) * 92;
      return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="#475569" stroke-width="11" stroke-linecap="round"/>`;
    }).join('')}
    <circle cx="400" cy="250" r="10" fill="#e2e8f0"/>`,
  };
  let scene = scenes[view] || scenes.front;
  const caption = { front: '', rear: 'Rear', side: 'Side', interior: 'Interior', dash: 'Dashboard', wheels: 'Wheels' }[view] || '';

  /* `bare=1` returns the car with no plate behind it — a cut-out, for the showcase, where
     the model name is set enormous behind the car and a dark rectangle would hide it.

     Three things go, not one. The background plate is the obvious part. The caption goes
     too because the showcase already prints the name above the car, larger. And the
     ground shadow is redrawn: 35% black is right under a car on a near-black plate and
     reads as a dirty smudge on a light grey one. */
  if (bare) {
    /* Drop the drawn ground shadow entirely. The showcase puts a CSS drop-shadow on the
       cut-out, and drop-shadow traces the alpha channel — it follows the car's actual
       silhouette, where this ellipse is a flat oval that sat under it as a second,
       differently-shaped shadow. One shadow, and the better one. */
    scene = scene.replace(/\s*<ellipse[^>]*fill="#000"[^>]*\/>/g, '');
  }

  /* Bare images are laid straight onto the stage, so the empty margin inside the 800x500
     box becomes real dead space: the car renders small and low and runs into the price
     below it. Crop to what is actually drawn. */
  const box = bare && view === 'side' ? '96 190 610 246' : '0 0 800 500';
  const [, , bw, bh] = box.split(' ').map(Number);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}" width="${bw}" height="${bh}" role="img" aria-label="${esc(label)}${caption ? ' — ' + caption : ''}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0f172a"/><stop offset="1" stop-color="#1e293b"/>
    </linearGradient>
    <linearGradient id="car" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${light}"/><stop offset="0.55" stop-color="${body}"/><stop offset="1" stop-color="${dark}"/>
    </linearGradient>
  </defs>
  ${bare ? '' : '<rect width="800" height="500" fill="url(#bg)"/>'}
  ${scene}
  ${bare ? '' : `<text x="400" y="470" text-anchor="middle" font-family="system-ui,Segoe UI,sans-serif" font-size="26" font-weight="600" fill="#e2e8f0">${esc(label)}${caption ? ` · ${caption}` : ''}</text>`}
</svg>`;
}
function esc(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
}
function shade(hex, amt) {
  const m = /^#?([a-f\d]{6})$/i.exec(String(hex).trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const clamp = (v) => Math.max(0, Math.min(255, v));
  const r = clamp(((n >> 16) & 255) + amt);
  const g = clamp(((n >> 8) & 255) + amt);
  const b = clamp((n & 255) + amt);
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

/* ---------------- request body ---------------- */

const MAX_BODY = 24 * 1024 * 1024;
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new ApiError(413, 'Upload too large (24MB limit)'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new ApiError(400, 'Request body must be valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/* ---------------- router ---------------- */

function matchRoute(method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue;
    if (typeof r.pattern === 'string') {
      if (r.pattern === pathname) return { route: r, params: [] };
    } else {
      const m = r.pattern.exec(pathname);
      if (m) return { route: r, params: m.slice(1) };
    }
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const https = sec.isHttps(req);
  const local = sec.isLocal(req);

  sec.securityHeaders(res, { https });

  // Force HTTPS everywhere except localhost, which has no certificate in the demo.
  if (!https && !local && process.env.MOTOKE_ALLOW_HTTP !== '1') {
    const host = String(req.headers.host || '').replace(/[^\w.:-]/g, '');
    res.writeHead(308, { Location: `https://${host}${req.url}` });
    return res.end('Redirecting to HTTPS');
  }

  // Same-origin only. No cross-site browser may call this API with the session cookie.
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '600',
    });
    return res.end();
  }

  // Simple CSRF defence for state-changing calls: the browser always sends Origin on
  // cross-site requests, so a mismatch is rejected outright.
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) && pathname.startsWith('/api/')) {
    const origin = req.headers.origin;
    if (origin) {
      let originHost = '';
      try {
        originHost = new URL(origin).host;
      } catch {}
      if (originHost && originHost !== req.headers.host) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Cross-site request blocked' }));
      }
    }
  }

  if (pathname === '/img/vehicle.svg') {
    const svg = vehicleSvg(parsed.query);
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' });
    return res.end(svg);
  }

  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, db: DB_PATH, uptime: process.uptime() }));
  }

  if (pathname.startsWith('/api/')) {
    const hit = matchRoute(req.method, pathname);
    if (!hit) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'No such endpoint', path: pathname }));
    }
    try {
      const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req) : {};
      const token = auth.tokenFrom(req);
      const user = auth.userFromToken(token);
      let cookieToSet = null;
      const ctx = {
        req,
        res,
        query: parsed.query,
        body,
        params: hit.params,
        user,
        token,
        // HttpOnly so no script can read it (it never touches LocalStorage), SameSite=Strict
        // so it is not sent from another site, Secure once we are on TLS.
        setSession: (t) => {
          cookieToSet = `motoke_session=${t}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${auth.SESSION_DAYS * 86400}${https ? '; Secure' : ''}`;
        },
        clearSession: () => {
          cookieToSet = `motoke_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${https ? '; Secure' : ''}`;
        },
      };
      const out = await hit.route.handler(ctx);
      const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
      if (cookieToSet) headers['Set-Cookie'] = cookieToSet;

      if (out && out.__csv !== undefined) {
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${out.__filename || 'export.csv'}"`,
        });
        return res.end(out.__csv);
      }
      res.writeHead(200, headers);
      return res.end(JSON.stringify(out === undefined ? { ok: true } : out));
    } catch (err) {
      const status = err.status || (err instanceof ApiError ? err.status : 500);
      // Internal failures never leak a stack trace or a query to the client.
      if (status >= 500) {
        console.error('API error', pathname, err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Something went wrong on our side. Please try again.' }));
      }
      res.writeHead(status, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: err.message || 'Request failed', field: err.field || null, detail: err.detail || null }));
    }
  }

  if (serveStatic(req, res, pathname)) return;

  // SPA fallback
  if (!path.extname(pathname)) {
    const target = pathname.startsWith('/admin') ? '/admin.html' : '/index.html';
    if (serveStatic(req, res, target)) return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
});

// Pump prices refresh themselves; expired vehicle holds are released hourly.
jobs.startFuelSchedule();
setInterval(() => {
  try {
    com.releaseExpiredHolds();
  } catch (e) {
    console.error('hold sweep failed', e.message);
  }
}, 3600_000).unref?.();

/* Inside a container the process must accept connections from outside its own
   namespace, and 127.0.0.1 does not. Locally the default stays loopback so a dev
   machine is not quietly serving the whole network. */
const HOST = process.env.HOST || (process.env.MOTOKE_CONTAINER ? '0.0.0.0' : '127.0.0.1');

server.listen(PORT, HOST, () => {
  const line = (s) => console.log('  ' + s);
  console.log('\n\x1b[1m  MotoKE\x1b[0m — vehicle sales + asset finance platform');
  console.log('  ' + '-'.repeat(58));
  if (seeded.seeded) line(`seeded ${seeded.dealers} dealerships, ${seeded.lenders} lenders, ${seeded.vehicles} vehicles`);
  if (activity.seeded) line(`seeded ${activity.applications} sample applications, ${activity.leads} leads`);
  line(`database   ${DB_PATH}`);
  line(`storefront http://localhost:${PORT}/`);
  line(`admin      http://localhost:${PORT}/admin`);
  console.log('  ' + '-'.repeat(58));
  line('admin@motoke.demo / admin123        (platform admin — sees all 5 dealers)');
  line('grace@summitmotors.demo / demo123   (dealer admin — Summit Motors only)');
  line('customer@motoke.demo / demo123      (customer account)');
  console.log('');
});
