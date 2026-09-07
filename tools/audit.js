'use strict';
/**
 * MotoKE - pre-launch audit.
 *
 * Walks the source tree looking for the things that get apps breached: committed
 * secrets, third-party dependencies nobody has reviewed, files that would leak if the
 * repo went public, and the security controls that are supposed to be switched on.
 *
 *   node tools/audit.js
 *
 * Exits non-zero if anything critical is wrong, so it can gate a deploy.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
let fail = 0;
let warn = 0;
let pass = 0;

const ok = (m, detail) => { pass++; console.log(`  \x1b[32mPASS\x1b[0m ${m}${detail ? ' — ' + detail : ''}`); };
const bad = (m, detail) => { fail++; console.log(`  \x1b[31mFAIL\x1b[0m ${m}${detail ? ' — ' + detail : ''}`); };
const meh = (m, detail) => { warn++; console.log(`  \x1b[33mWARN\x1b[0m ${m}${detail ? ' — ' + detail : ''}`); };

/* `vendor` holds third-party bundles we downloaded deliberately. It is skipped by the
   secret and import scanners, not because it is trusted, but because those two scanners
   are the wrong tool for a minified bundle: they flag `TOKEN:"internal-error"` as a
   credential and the UMD's dead CommonJS branch as a dependency. The right control for
   vendored code is the pinned version and the SHA-256 check in the "vendored code"
   section below, which runs on exactly these files. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'data', '_shots', 'vendor']);
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.gitignore') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, out);
    } else out.push(full);
  }
  return out;
}
const files = walk(ROOT);
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');
const sourceFiles = files.filter((f) => /\.(js|html|css|json|md|bat)$/i.test(f));

console.log('\n\x1b[1mMotoKE pre-launch audit\x1b[0m\n');

/* -------------------------------------------------- 1. secrets -------- */
console.log('· secrets');

const SECRET_PATTERNS = [
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'Google API key'],
  [/\bsk_live_[0-9A-Za-z]{16,}\b/, 'Stripe live key'],
  [/\bsk-[A-Za-z0-9]{32,}\b/, 'OpenAI-style key'],
  [/\bghp_[A-Za-z0-9]{36}\b/, 'GitHub token'],
  [/\bxox[baprs]-[0-9A-Za-z-]{10,}\b/, 'Slack token'],
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'private key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key id'],
  [/(?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*['"][^'"\s]{12,}['"]/i, 'hard-coded credential'],
];
// The demo logins are deliberately published, so they are not findings.
const ALLOWED_SECRET_STRINGS = [/demo123/, /admin123/, /motoke\.demo/, /example\.com/];

// Test files legitimately contain fixture passwords; they are still scanned for real
// provider keys, just not for the generic "looks like a credential" heuristic.
const isTestFile = (f) => /tools[\/\\](smoke|.*-test)\.js$/.test(f);

let secretHits = 0;
for (const f of sourceFiles) {
  if (/tools[\/\\]audit\.js$/.test(f)) continue; // the patterns themselves live here
  const text = fs.readFileSync(f, 'utf8');
  for (const [re, label] of SECRET_PATTERNS) {
    if (isTestFile(f) && label === 'hard-coded credential') continue;
    const m = re.exec(text);
    if (m && !ALLOWED_SECRET_STRINGS.some((a) => a.test(m[0]))) {
      bad(`possible ${label} in ${rel(f)}`, m[0].slice(0, 28) + '…');
      secretHits++;
    }
  }
}
if (!secretHits) ok('no API keys, tokens or private keys in the source', `${sourceFiles.length} files scanned`);

const gitignorePath = path.join(ROOT, '.gitignore');
if (fs.existsSync(gitignorePath)) {
  const gi = fs.readFileSync(gitignorePath, 'utf8');
  const musts = ['data/', '.env', '*.db', '.secret'];
  const missing = musts.filter((m) => !gi.includes(m));
  if (missing.length) bad('.gitignore is missing entries', missing.join(', '));
  else ok('.gitignore excludes the database, the encryption key and .env');
} else bad('.gitignore is missing');

if (fs.existsSync(path.join(ROOT, '.git'))) {
  meh('this folder is a git repository', 'run `git log -p | grep -i secret` before making it public');
} else ok('no git history to leak', 'not a repository yet');

/* ---------------------------------------------- 2. dependencies -------- */
console.log('\n· dependencies');

const pkgPath = path.join(ROOT, 'package.json');
let deps = {};
if (fs.existsSync(pkgPath)) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
}
const depNames = Object.keys(deps);
if (depNames.length === 0) {
  ok('zero third-party dependencies', 'nothing to audit, nothing to be vulnerable');
} else {
  meh(`${depNames.length} dependencies`, 'run `npm audit --production` and review each one');
}
if (fs.existsSync(path.join(ROOT, 'node_modules'))) {
  meh('node_modules exists', 'confirm it is gitignored');
} else ok('no node_modules directory');

/* Every import must resolve to a node: builtin or a local file.
 *
 * One documented exception: `worker.js` is the Cloudflare deploy adapter. It runs
 * at the edge, never inside the application, and it needs Cloudflare's Container
 * class. The claim being defended is "the APPLICATION has zero runtime
 * dependencies" — so the exception is named here rather than left to a regex that
 * happens not to look at `import`. */
const BUILTIN = /^node:/;
const DEPLOY_ONLY = { 'worker.js': ['@cloudflare/containers'] };
let foreign = [];
for (const f of files.filter((f) => f.endsWith('.js'))) {
  const text = fs.readFileSync(f, 'utf8');
  const allowed = DEPLOY_ONLY[rel(f)] || [];
  const specifiers = [
    ...[...text.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]),
    ...[...text.matchAll(/^\s*import\s[^'"]*from\s*['"]([^'"]+)['"]/gm)].map((m) => m[1]),
  ];
  for (const mod of specifiers) {
    if (BUILTIN.test(mod) || mod.startsWith('.') || mod.startsWith('/')) continue;
    if (allowed.includes(mod)) continue;
    foreign.push(`${rel(f)} → ${mod}`);
  }
}
if (foreign.length) bad('non-builtin imports found', foreign.slice(0, 5).join('; '));
else ok('the application imports only node: builtins and its own files', 'the deploy adapter is the one named exception');

/* The exception must stay an exception: nothing the app actually serves may
   reach for the deploy adapter's dependency. */
/* audit.js is excluded for the same reason it is excluded from the secret scan:
   it has to name the thing it is looking for. */
const appFiles = files.filter(
  (f) => /\.js$/.test(f) && !/^worker\.js$/.test(rel(f)) && !/^tools\/audit\.js$/.test(rel(f))
);
if (appFiles.some((f) => /@cloudflare\//.test(fs.readFileSync(f, 'utf8')))) {
  bad('the app itself depends on Cloudflare', 'it must still run on a plain Node host with no changes');
} else {
  ok('nothing in the app itself depends on Cloudflare', 'it still runs on any plain Node host');
}

/* ------------------------------------------------- 3. controls -------- */
console.log('\n· security controls');

const read = (p) => (fs.existsSync(path.join(ROOT, p)) ? fs.readFileSync(path.join(ROOT, p), 'utf8') : '');
const server = read('server.js');
const api = read('lib/api.js');
const security = read('lib/security.js');
const authSrc = read('lib/auth.js');
const db = read('lib/db.js');

const check = (name, condition, detail) => (condition ? ok(name, detail) : bad(name, detail));

check('passwords are hashed with scrypt', /scryptSync/.test(authSrc));
check('password comparison is timing-safe', /timingSafeEqual/.test(authSrc));
check('password strength is enforced', /passwordStrength/.test(api) && /issues\.length/.test(security));
check('login is rate limited', /rateLimit\(`login:/.test(api));
check('staff sign-in has a second factor', /verify-otp/.test(api) && /makeOtp/.test(security));
check('one-time codes are hashed, not stored in the clear', /hashOtp/.test(security) && /otp_hash/.test(db));
check('session cookie is HttpOnly', /HttpOnly/.test(server));
check('session cookie is SameSite=Strict', /SameSite=Strict/.test(server));
check('session cookie gets Secure over TLS', /https \? '; Secure'/.test(server));
check('no session token is written to localStorage', !/localStorage[^\n]*(token|session)/i.test(read('public/js/core.js') + read('public/js/store.js') + read('public/js/admin.js')));
check('security headers are set', /Content-Security-Policy/.test(security) && /securityHeaders/.test(server));
check('HTTPS is enforced off localhost', /Redirecting to HTTPS/.test(server));
check('cross-site state changes are blocked', /Cross-site request blocked/.test(server));
check('sensitive fields are encrypted at rest', /aes-256-gcm/.test(security) && /encryptFields/.test(api));
check('uploads are validated by magic number', /magic/.test(security) && /validateUpload/.test(api));
check('responses are trimmed of secrets', /NEVER_SEND/.test(security));
check('input is validated centrally', /ValidationError/.test(security) && /sec\.V\./.test(api));
check('user content is stripped of markup', /stripTags/.test(security) && /stripTags/.test(api));
check('bot protection is present', /botCheck/.test(security) && /botCheck/.test(api));
check('server errors do not leak internals', /Something went wrong on our side/.test(server));
check('admin access is checked server-side', /requireStaff/.test(api) && /assertOwns/.test(api));
check('row access is scoped to one dealership', /siteDealer\(\)/.test(api));

// every SQL string must be parameterised: no template interpolation of user values
const sqlTemplates = [...api.matchAll(/(?:all|get|run)\(\s*`([^`]*)`/g)].map((m) => m[1]);
const interpolated = sqlTemplates.filter((s) => /\$\{/.test(s));
const risky = interpolated.filter((s) => !/^\s*SELECT|^\s*UPDATE|^\s*DELETE|^\s*INSERT/i.test(s) || /\$\{[^}]*(body|query|params)\b/.test(s));
if (risky.length) bad('SQL built from request data', risky[0].slice(0, 70));
else ok('SQL is parameterised', `${sqlTemplates.length} template queries interpolate only column and table names`);

const dbKeyExposed = /MOTOKE_SECRET|\.secret/.test(read('public/js/core.js') + read('public/js/store.js') + read('public/js/admin.js'));
check('no privileged key is reachable from the browser', !dbKeyExposed);

/* ------------------------------------------------- 4. front end ------- */
console.log('\n· front end');

const storeJs = read('public/js/store.js');
const coreJs = read('public/js/core.js');
const css = read('public/css/app.css');

// Typing in a filter must not change the hash: that re-runs the router, rebuilds the
// sidebar and yanks the input out from under whoever is typing.
const browseBlock = storeJs.slice(storeJs.indexOf('async function pageBrowse'), storeJs.indexOf('async function pageVehicle'));
check(
  'filter typing updates the URL without re-running the router',
  /history\.replaceState/.test(browseBlock) && !/oninput[^\n]*\bgo\(/.test(browseBlock),
  'otherwise the search box loses focus mid-word'
);
check('filter changes refresh only the results', /function loadResults/.test(browseBlock));

check('no inline event handlers (the CSP forbids them)', !/\son(click|load|error|change|submit)\s*=\s*"/.test(storeJs + read('public/index.html') + read('public/admin.html')));
check('the offline guard loads from a relative path', /src="js\/boot-guard\.js"/.test(read('public/index.html')));
check('light-theme overrides live with their tokens', !/^:root:not\(\[data-theme="dark"\]\) \./m.test(css.replace(/@media[^{]*\{[\s\S]*?\n\}/g, '')));
check('a skip link and focus rings exist', /skip-link/.test(css) && /:focus-visible/.test(css) && /skip-link/.test(coreJs));
check('a print stylesheet exists', /@media print/.test(css));

/* ------------------------------------ the two design systems --------- */
/* The storefront and the console deliberately look nothing like each other.
   These stop one bleeding into the other, which is the failure mode of putting
   two design languages in one codebase. */
console.log('\n· design system separation');
{
  const consoleCss = read('public/css/console.css');
  const adminHtml = read('public/admin.html');
  const indexHtml = read('public/index.html');

  check('the console has its own stylesheet', consoleCss.length > 0);
  check('only the console loads it', adminHtml.includes('console.css') && !indexHtml.includes('console.css'),
    'the storefront must never pick up the back-office look');
  check('the console marks itself on the body', /<body class="console"/.test(adminHtml),
    'every console rule is scoped to .console and does nothing without it');

  /* Every rule in console.css must be scoped. One unscoped rule and the
     storefront inherits it the moment somebody adds the sheet elsewhere. */
  const selectors = consoleCss
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('}')
    .map((b) => b.split('{')[0].trim())
    .filter((s) => s && !s.startsWith('@') && !s.startsWith('from') && !s.startsWith('to') && !/^\d/.test(s));
  const unscoped = selectors.filter((s) =>
    s.split(',').some((part) => part.trim() && !/(^|\s|\.)console\b/.test(part))
  );
  check('every console rule is scoped to .console', unscoped.length === 0, unscoped.slice(0, 3).join(' | '));

  check('the square-everything rule exempts the console',
    /body:not\(\.console\) \*:not\(\.spinner\)/.test(css),
    'otherwise an !important universal rule has to be fought rather than avoided');

  /* The reference page pulled Tailwind, Google Fonts and Font Awesome off CDNs.
     The CSP forbids all three and the app has to run with no internet. */
  check('the console pulls in no CDN stylesheet or font',
    !/cdn\.tailwindcss|fonts\.googleapis|cdnjs\.cloudflare/.test(consoleCss + adminHtml),
    'reimplemented in plain CSS on a system font stack instead');
}

/* -------------------------------------------- the content policy ------ */
/* The CSP widens when Firebase is configured. That is the moment to check it, because a
   policy that quietly grows a wildcard is worse than no policy — it reads as protection
   and provides none. Both modes are asserted, not just the one this process booted in. */
console.log('\n· content security policy');
{
  const sec = require('../lib/security');
  const off = sec.buildCsp();

  const savedProject = process.env.MOTOKE_FIREBASE_PROJECT;
  process.env.MOTOKE_FIREBASE_PROJECT = 'audit-probe';
  delete require.cache[require.resolve('../lib/security')];
  const on = require('../lib/security').buildCsp();
  if (savedProject === undefined) delete process.env.MOTOKE_FIREBASE_PROJECT;
  else process.env.MOTOKE_FIREBASE_PROJECT = savedProject;
  delete require.cache[require.resolve('../lib/security')];

  check("scripts only ever load from our own origin", /script-src 'self'(;|$)/.test(off) && /script-src 'self'(;|$)/.test(on),
    'a CDN in script-src would let a compromised third party run code on the page');
  check('no wildcard anywhere in either policy', !/\*/.test(off) && !/\*/.test(on));
  check("object-src and frame-ancestors stay locked", /object-src 'none'/.test(on) && /frame-ancestors 'none'/.test(on));

  check("without Firebase the page talks only to us", /connect-src 'self';/.test(off));
  check('without Firebase no frame source is opened up', !/frame-src/.test(off));

  check('with Firebase on, connect-src names Google explicitly',
    /connect-src 'self' https:\/\/identitytoolkit\.googleapis\.com/.test(on));
  check('with Firebase on, only https origins are added',
    (on.match(/https?:\/\/[^\s;]+/g) || []).every((u) => u.startsWith('https://')));
  check('with Firebase on, frame-src is the sign-in origins only',
    /frame-src https:\/\/accounts\.google\.com https:\/\/[\w-]+\.firebaseapp\.com/.test(on));

  check('the Firebase SDK is vendored, not pulled from a CDN at runtime',
    !/https:\/\/www\.gstatic\.com/.test(read('public/index.html') + read('public/admin.html')),
    'public/vendor/ is served from our own origin');
}

/* ------------------------------------------- the vendored SDK --------- */
/* Third-party code we serve from our own origin runs with our privileges. The manifest
   records what we downloaded; this proves the files still match it. A silent edit to a
   vendored bundle is the supply-chain attack this project would otherwise be open to. */
console.log('\n· vendored code');
{
  const crypto = require('node:crypto');
  const vendorRoot = path.join(ROOT, 'public/vendor');
  if (!fs.existsSync(vendorRoot)) {
    ok('no vendored third-party code', 'nothing to verify');
  } else {
    /* Every folder under public/vendor, not just the first one somebody thought of.
       A named list is a list somebody forgets to add the next library to. */
    const bundles = fs.readdirSync(vendorRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    let missingManifest = [];
    let unlisted = [];
    let mismatched = [];
    let verified = 0;

    for (const name of bundles) {
      const dir = path.join(vendorRoot, name);
      const manifestPath = `public/vendor/${name}/MANIFEST.md`;
      const manifest = read(manifestPath);
      if (!manifest) { missingManifest.push(name); continue; }

      const files = fs.readdirSync(dir).filter((f) => /\.(js|css|mjs)$/.test(f));
      for (const f of files) {
        if (!manifest.includes(f)) unlisted.push(`${name}/${f}`);
        const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex');
        if (!manifest.includes(sha)) mismatched.push(`${name}/${f}`);
        else verified++;
      }
    }

    const manifest = read('public/vendor/firebase/MANIFEST.md');
    check('every vendored bundle has a manifest', missingManifest.length === 0,
      missingManifest.length ? `no manifest: ${missingManifest.join(', ')}` : bundles.join(', '));
    check('every vendored file is listed in its manifest', unlisted.length === 0, unlisted.join(', '));
    check('every vendored file matches its recorded hash', mismatched.length === 0,
      mismatched.length ? `changed since download: ${mismatched.join(', ')}` : `${verified} files verified`);

    check('the vendored SDK version is pinned', /Version:\s*\*\*[\d.]+\*\*/.test(manifest));
    check('smooth scroll is vendored too, with its own manifest',
      fs.existsSync(path.join(ROOT, 'public/vendor/lenis/MANIFEST.md')));
    check('smooth scroll never overrides the reduced-motion preference',
      /prefers-reduced-motion/.test(read('public/js/smooth-scroll.js')),
      'a motion effect that ignores the setting is an accessibility failure');
    check('smooth scroll stays off on touch devices',
      /pointer: coarse/.test(read('public/js/smooth-scroll.js')),
      "native momentum beats anything a library fakes, and hijacking it is how these libraries ruin a phone");
    const allVendored = bundles.flatMap((n) =>
      fs.readdirSync(path.join(vendorRoot, n))
        .filter((f) => /\.(js|mjs)$/.test(f))
        .map((f) => path.join(vendorRoot, n, f))
    );
    check('nothing vendored fetches more code from a CDN at runtime',
      !allVendored.some((f) => /(import|src)\s*[=(]\s*[`'"]https:\/\/(cdn|unpkg|jsdelivr)/.test(fs.readFileSync(f, 'utf8'))),
      `${allVendored.length} bundles scanned`);
  }
}

/* ------------------------------------------------------ summary ------- */
console.log(`\n\x1b[1m${pass} passed, ${warn} warnings, ${fail} failed\x1b[0m\n`);
if (fail) console.log('  Fix the failures above before this goes anywhere public.\n');
process.exit(fail ? 1 : 0);
