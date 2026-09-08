# Working on MotoKE

`README.md` is the entry point — what it is, what it does, who it is for.
`TASKS.md` is the scope record — every requested item mapped to the test that proves it.

This file is the shorter thing: **how to work in here without breaking something.**
Almost every rule below exists because something actually broke.

---

# Communication style

- Write in clear, conversational English.
- Use simple language whenever possible.
- Avoid buzzwords, corporate jargon, and vague statements.
- Focus on practical examples and actionable insights.
- Prioritise clarity over sophistication.
- Explain concepts as if speaking to an intelligent beginner.
- Use short paragraphs and strong structure.

# Rules

- Always ask at least three clarifying questions before starting any complex task.
- Always present a plan before execution.
- Never make assumptions when important information is missing.
- Keep outputs concise and relevant.
- Do not add filler content to increase length.
- Stay within requested word counts and formats.
- Use practical examples whenever possible.
- When multiple approaches exist, explain the tradeoffs.
- If uncertain, ask before proceeding.
- Review outputs before final delivery.

**The one exception:** when the instruction is explicitly "god mode", "just build it", or
similar, skip the questions and the plan and go. Everything else on this list still stands —
especially reviewing the output before delivering it.

# Agent behaviour

Before starting any task:

1. Understand the objective.
2. Ask clarifying questions if needed.
3. Create a plan.
4. Execute step by step.
5. Review the output.
6. Improve weak areas.
7. Deliver the final result.

Never skip planning for complex tasks.
Never prioritise speed over quality.
Always optimise for usefulness and accuracy.

# Success criteria

A successful output is:

- Clear
- Actionable
- Accurate
- Concise
- Easy to understand
- Immediately useful

In this project there is a harder test on top of those: **a change is not done until a test
proves it.** See "The gates" below. Do not report something as working on the strength of
having written it.

---

## Run it

```powershell
$env:Path="C:\Users\ADMIN\nodejs-portable\node-v22.16.0-win-x64;$env:Path"
node --no-warnings server.js --port 4000
```

Or double-click `START.bat`, which knows the path.

- Storefront <http://localhost:4000/> · Staff console <http://localhost:4000/admin>
- `--reset` wipes `data/motoke.db` and re-seeds.
- `--no-warnings` matters: without it `node:sqlite` prints an experimental warning to
  stderr and PowerShell reports the whole run as a `NativeCommandError`.

**Node is portable and not on PATH.** The Bash tool cannot see it at all — use PowerShell
for anything that runs node. Bash is fine for `curl`, `grep` and `python`.

**Never open the HTML files from disk.** `public/index.html` on its own is an empty shell:
`/css`, `/js` and `/api` cannot resolve over `file://`. `js/boot-guard.js` catches this and
says so. Always go through the server.

---

## The gates

```powershell
node --no-warnings tools/audit.js             # 60  secrets, deps, security controls, front end
node --no-warnings tools/finance-test.js      # 44  quoting + eligibility, no server
node --no-warnings tools/ownership-test.js    # 44  running cost + insurance, no server
node --no-warnings tools/performance-test.js  # 71  the spec sheet, no server
node --no-warnings tools/firebase-test.js     # 32  ID token verification, no server
node --no-warnings tools/valuation-test.js    # 62  price indicator + depreciation, no server
node --no-warnings tools/inventory-test.js    # 63  stock ageing + repricing, no server
node --no-warnings tools/smoke.js 4000        # 263 the whole API, needs the server up
```

**639 assertions. All eight pass.** Each exits with its failure count, so any of them can
gate a deploy. `audit.js` is the one that matters before anything goes public — it greps
for committed secrets, refuses third-party imports, and asserts the named security controls
and front-end invariants are still in place.

Run all eight after any change to `lib/`. Run `audit.js` after any change to `public/`.

**Restart the server between smoke runs.** The login limiter and the booking limiter are
in-memory, and a second run against the same process trips them — the suite then fails on
authentication, which looks like a real defect and is not one.

---

## File naming

- Lowercase file names.
- Hyphens instead of spaces.
- Descriptive names.
- No special characters.

```
boot-guard.js      finance-test.js      ownership-test.js      performance-test.js
```

The four shouting files at the root — `README.md`, `CLAUDE.md`, `TASKS.md`, `START.bat` —
keep their uppercase names on purpose. That is the convention for entry-point documents and
the launcher, and Claude Code looks for `CLAUDE.md` by that exact name. Everything else is
lowercase-with-hyphens.

---

## Folder structure

```
/lib          engine and API modules — the server's brain
/public       everything the browser gets: HTML, CSS, client JS
/tools        test suites and the pre-launch audit
/data         the SQLite database and the encryption key. Never committed, never edited by hand.
```

Four folders. If you are about to add a fifth, check it earns its place.

There are no `/workflows`, `/outputs`, `/drafts` or `/templates` folders here. Those belong
to a document-and-research workspace; this is a running application, so the equivalents are:

- **Reference material** → `README.md` (what it does), `TASKS.md` (scope and proof).
- **Work in progress** → the session scratchpad, not the repo. Nothing half-finished gets
  committed into `motoke/`.
- **Reusable templates** → `lib/seed.js` for demo content, `lib/market.js` for the Kenyan
  reference figures. Change the data there, not in the pages that display it.

---

## Where things live

```
server.js          http, routing, static, security headers, the SVG image endpoint
lib/db.js          schema, additive migrations, query helpers
lib/api.js         every JSON endpoint (the big one)
lib/finance.js     quoting + eligibility — the only place a loan is priced
lib/ownership.js   running cost + insurance
lib/market.js      Kenyan reference data: economy, resale, servicing, import duty
lib/performance.js the enthusiast spec sheet: power, 0-100, wheels, the condition scorecard
lib/security.js    validation, rate limiting, encryption, OTP, uploads, headers
lib/commerce.js    booking deposits, payment providers, offer letters
lib/jobs.js        the self-refreshing fuel price schedule
lib/seed.js        demo dealerships, lenders, stock, staff
lib/demo.js        sample pipeline so the console is not empty on first run
public/js/core.js  shared helpers + global UI furniture (theme, search, cookies, forms)
public/js/store.js the storefront SPA
public/js/admin.js the staff console SPA
```

**Money is calculated in `finance.js` and `ownership.js`, nowhere else.** If a number
appears in the UI, it came from an endpoint. Do not compute a payment in the browser.

---

## Hard rules

### SQLite here rejects double-quoted string literals

`status="available"` fails with `no such column: "available"`. Use single quotes inside a
double-quoted JS string:

```js
run("UPDATE vehicles SET status='sold' WHERE id=?", [id]);
```

### Do not `sed` JavaScript

Quote-swapping with `sed` mangles the surrounding JS and produces a file that looks fine in
a diff and does not parse. Write a Python patch script to the scratchpad and run it. Same
for heredocs — **Bash heredocs are broken on this machine** and fail with `unexpected EOF`
even when nothing is unbalanced.

### The CSP is strict `script-src 'self'` — no inline JavaScript anywhere

No `<script>` blocks in the HTML, and **no `onclick=` attributes**. Use a delegated
`[data-act]` handler (there is one at the bottom of `store.js`). `audit.js` fails if an
inline handler reappears.

`boot-guard.js` is loaded with a **relative** path (`js/boot-guard.js`) on purpose: that
resolves both when served and when the file is opened from disk. Do not make it absolute.

### Filters must never change the hash

Changing the hash fires the router, which rebuilds the whole page — including the input the
customer is typing in. Browse filters use `history.replaceState` and refresh only
`#results`, `#count` and `#pager`. `audit.js` asserts this.

### Light-theme rules live inside the media query

`:root:not([data-theme="dark"]) .topbar { ... }` outside `@media (prefers-color-scheme: light)`
also matches the dark default, which gave a white header on a dark page. Token overrides and
the rules that depend on them go in the same block.

### Never trust the client on money

If the request names a `vehicleId`, the server takes the price from the vehicle row and
ignores whatever the browser sent. Booking fees are computed server-side from that price.
This is why `A1` (locked price) is a server rule, not just a disabled input.

### One dealership per install

`siteDealer()` in `api.js` resolves every public request to the configured dealership.
`resolveDealer(q)` ignores any `?dealer=` from a client; only `resolveDealer(q, {any:true})`
honours it, and only admin tooling calls it that way.

**Any new endpoint that looks a record up by reference must check `dealer_id` against
`siteDealer()`.** The tracker, offer letter, booking status and document upload all shipped
without that check and leaked across dealerships until it was added.

### Encrypted columns need decrypting on read

`idNumber`, `kraPin`, `dob` and document blobs are AES-256-GCM at rest. Read them through
`sec.decryptFields(...)` / `sec.decrypt(...)`. `shapeApplication()` takes `{ reveal: true }`
for staff; without it identifiers come back masked. Never add an encrypted field to a
response without deciding which of those two applies.

### A spec figure is either measured or estimated, and the page must say which

`lib/performance.js` derives power, torque, 0-100, top speed, weight, rims, tyres, boot,
tank and clearance from engine size, body and drivetrain. A value stored on the vehicle row
**overrides** the estimate and lands in `specs.measured`. Never present an estimate as a
manufacturer figure: the sheet ships a `disclaimer` string and every page that shows the
numbers must show it too.

The condition scorecard has the same rule in reverse. An area nobody scored comes back
`null` and renders as "not checked". **Do not default it to a pass** — an inspection that
invents a number is worse than no inspection at all.

Published figures for the demo stock live in `MEASURED` in `seed.js`.
`tools/backfill-specs.js` applies them to a database that already exists, which is how you
add specs without `--reset` throwing away the generated showroom photographs.

### Migrations run after the tables exist

`db.js` creates the base schema, then the post-release tables, **then** the `MIGRATIONS`
loop. A migration naming a table created later fails on boot. Add new columns to
`MIGRATIONS`, never to `SCHEMA` — an existing database must survive a restart.

### Staff sign-in has two steps

`POST /api/auth/login` for a staff account returns `{ needsOtp: true }` and **no session**.
The session only exists after `POST /api/auth/verify-otp`. Any test or script that logs in
as staff must do both. In demo mode the code comes back as `demoCode`; it is also printed
to the server console.

---

## Conventions

- **Zero dependencies.** Every import is a `node:` builtin or a local file. `audit.js`
  fails if that stops being true. Do not add a package.
- **Money is whole shillings**, stored as integers. Format with `KES()` in the client.
- **Phone numbers** are normalised to `+254…` by `sec.V.phone()`. Accept `07…`, `01…`,
  `+254…`, `254…`; store one shape.
- **Every public form** carries `honeypot()` and `botFields()`, and validates through
  `sec.V.*` on the server. Adding a form without them is a regression.
- **New endpoints** go through `sec.V` for input and `sec.pick`/`sec.trim` for output.
- Comments explain **why**, not what. Match the surrounding density.

---

## Demo data — replace before anything commercial

Every dealership and lender in `seed.js` is fictional and every rate is indicative. They
exist so the engine has something to price. Before a real conversation:

- **Admin → Lenders & rules** — the institution's own published terms.
- **Admin → Dealership** — real branding, branches, and which dealership this install serves.
- **Admin → Running costs** — the fuel source URL, so prices refresh themselves.

`demo_mode` in settings controls one thing: whether the 2FA code is echoed to the browser
as well as the server console. **Turn it off for production.**

The payment simulator is separate — it engages whenever Daraja credentials are absent from
the environment. Set `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_PASSKEY` and the
`mpesa_shortcode` / `mpesa_callback_url` settings and `commerce.js` calls Safaricom for real.
Credentials come from the environment, never the database.

---

## Not built

M-Pesa is a faithful simulator until Daraja credentials are in the environment. Submitting
to a lender is a status change, not an API call. CRB is a self-declared checkbox. There is
no SMS gateway, so the OTP prints to the console. No blog or CMS.
