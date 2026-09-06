# MotoKE

A **vehicle sales + asset finance** platform for Kenyan dealerships. One install serves one
dealership — its branding, its yard, its lender panel — so the site a customer sees belongs
to that dealership and nobody else. The same build is handed to the next dealership by
pointing the install at them.

The point of the product is the middle step everyone else skips: the customer picks a car,
then picks **how to pay for it**, with every bank, microfinance house and sacco on the panel
quoted side by side on that exact car — including who would actually approve them, and why
the others would not.

---

## Running it

Double-click **`START.bat`**, or:

```bash
node --no-warnings server.js --port 4000
```

- Storefront: <http://localhost:4000/>
- Staff console: <http://localhost:4000/admin>

**No `npm install`.** There are zero dependencies — the database is Node 22's built-in
`node:sqlite`, the server is `node:http`, and the front end is plain HTML/CSS/JS. It runs
offline and the whole thing is one folder you can copy to a laptop before a pitch.

Requires Node 22.5+. On this machine Node is portable at
`C:\Users\ADMIN\nodejs-portable\node-v22.16.0-win-x64\node.exe` (START.bat already knows).

`node server.js --reset` wipes the database and re-seeds it from scratch.

### Demo logins

| Who | Email | Password | Sees |
|---|---|---|---|
| Platform admin | `admin@motoke.demo` | `admin123` | everything, and can repoint the install |
| Dealer admin | `grace@summitmotors.demo` | `demo123` | this dealership |
| Sales agent | `brian@summitmotors.demo` | `demo123` | stock, applications, leads |
| Finance officer | `faith@summitmotors.demo` | `demo123` | the above, plus lender rules |
| Customer | `customer@motoke.demo` | `demo123` | storefront account |

Staff sign-in asks for a **6-digit one-time code** after the password. There is no SMS
gateway in the demo, so the code is printed to the server console and shown on screen.

---

## One dealership per install

The storefront presents **one** dealership — its branding, its stock, its lender panel. That
is a server-side boundary, not a hidden menu: a request for another yard's vehicle,
application or booking returns 404. To hand the same build to a different dealership, a
platform admin changes it in **Admin → Dealership → This install serves**, or you copy the
folder and run a second instance on another port. Each dealership gets its own database.

## Security

`node tools/audit.js` gates the whole thing: 37 checks covering committed secrets,
dependencies, 23 named security controls and 7 front-end invariants. Highlights:

- Staff sign-in has **two factors** — password, then a 6-digit code (hashed with HMAC before
  storage, 10-minute expiry). No session exists until the code is verified.
- The session is an **HttpOnly, SameSite=Strict cookie**. No token is ever written to
  LocalStorage; the audit greps the client bundle to prove it.
- **ID numbers, KRA PINs, dates of birth and every uploaded document are encrypted at rest**
  with AES-256-GCM. The key lives outside git. The public tracker masks the ID number.
- **Uploads are checked by magic number** — a file claiming to be a PDF must actually start
  with `%PDF`.
- The **Content-Security-Policy is strict `script-src 'self'`**, so the app contains no
  inline JavaScript anywhere.
- Prices, booking fees and loan amounts are **always recomputed server-side** from the
  vehicle record; nothing the browser sends about money is trusted.
- **Zero third-party dependencies**, so there is no supply chain to audit.

## Where the feature set came from

The scope was set by a reference video of a competing Kenyan car-yard site (Carduka / AutoVault).
Everything that site does is here — inventory with filters, a financing hub with a calculator,
affordability, bank comparison, running cost, insurance, pre-qualify and FAQs, plus WhatsApp
throughout, photo galleries, import/registration status, sell-your-car, about and contact.

On top of that, this platform adds what a dealership actually needs behind the site:
a full staff console, a lender rules engine, an applications
pipeline, true APR by IRR, eligibility gating with plain-English reasons, and microfinance and
sacco lenders alongside the banks.

## What a customer can do

- **Browse** the yard with real filters — make, body, fuel, transmission, condition, year,
  mileage, price, and a **"monthly budget"** filter that hides anything whose instalment
  will not fit.
- **See an indicative instalment on every listing**, computed from the cheapest lender
  actually on that dealership's panel.
- **Compare financing** (`#/finance/:id`) — the money screen. Move the deposit and term
  sliders, add income, commitments, employment type, age and CRB status, and every lender
  re-quotes live. Rank by lowest monthly, cheapest overall, least cash upfront, lowest APR,
  or fastest approval.
- **See the true cost.** Flat-rate microfinance quotes carry a low headline number and a
  much higher real cost; the engine computes an effective **APR by IRR** for every offer so
  a 14% flat quote is shown next to a 13.5% reducing quote honestly (it lands around 31%).
- **Look properly at the car** — photo gallery with arrows, thumbnails and a counter,
  breadcrumbs, an inspected-and-verified badge, price-negotiable flag, warranty, listing date,
  and for direct imports a **registration panel** showing "Awaiting KE registration" with the
  expected on-the-road date.
- **Read the full breakdown** — itemised fees, what is capitalised, insurance, cash needed
  on day one, and a complete month-by-month repayment schedule.
- **See why a lender said no** — ineligible lenders are still shown, each with the exact
  rule being hit ("will not finance vehicles older than 6 years", "repayment would be 71%
  of your income").
- **Apply online** — four steps (details, income, documents, review), file upload, consent,
  optional vehicle hold. Returns a reference like `MK-2609-E3F6DF`.
- **Track the application** by reference + phone, with a stage tracker and the full event trail.
- **Use the financing hub** (`#/financing`) — seven tools, standalone from any one car:
  - **Calculator** — price, deposit slider, tenure pills, pick any lender on the panel; returns
    the monthly payment, loan amount, total interest, total to repay and true APR, with
    *Get pre-qualified* and *Discuss on WhatsApp*.
  - **Affordability** — income, existing repayments, a Conservative / Balanced / Aggressive
    stance (20 / 30 / 40% of income), term, deposit and an interest-rate slider. Returns the
    maximum car price, monthly payment, loan amount, total to repay, and a **debt-to-income
    bar with a verdict** — plus what each individual lender would allow.
  - **Lender comparison** — one card per lender: monthly, loan amount, total interest, total
    to repay, APR and an *Apply with &lt;lender&gt;* button.
  - **Running cost** — "it's not just the monthly payment". Engine size, fuel type, annual
    mileage, comprehensive on/off, loan on/off → loan, insurance, fuel, servicing, tyres and
    licensing broken out per month, cost per kilometre, and the five-year total as a
    percentage of the purchase price.
  - **Insurance** — comprehensive vs third party side by side, what each covers and excludes,
    four priced add-ons, and the real monthly difference.
  - **Pre-qualify** — apply once, and every lender on the panel answers immediately with a
    yes/no and a monthly figure. Saved to the console as a warm lead with the numbers done.
  - **FAQs** — generated from the live lender rules, so it cannot go stale when rates change.
- **Sell or trade in** (`#/sell`) — indicative valuation in seconds, then sell outright,
  trade in against a deposit, or consign. Books a physical inspection.
- **About and Contact** pages driven by the dealership's own record and branches.
- Shortlist cars, compare up to three side by side, book a test drive, request a call back,
  share a listing, and keep an account with saved cars and past applications.
- **WhatsApp everywhere** — every listing, offer, quote and page deep-links into WhatsApp with
  the enquiry already written.

## What staff can do

- **Overview** — stock on hand and value, pipeline by stage, finance volume, approval rate,
  which lender is winning the business, applications over 30 days, most-viewed stock.
- **Applications** — kanban board or table, search, filter, and a detail drawer with the
  full deal, affordability (DTI), documents, lender requirements and event history. Move
  status, assign an agent, add notes, open uploaded documents, and **restructure** — switch
  lender, deposit or term and the instalment is recomputed against that lender's live rules.
  Moving an application also moves the car (reserved → sold → back to available).
- **Inventory** — full CRUD, CSV bulk import with per-row errors, CSV export, status,
  featured flag, images, features.
- **Lenders & rules** — the differentiator. Every field the engine uses is editable:
  rate and rate type, all four fees, insurance and whether it is financed, deposit floor,
  term range, facility limits, income floor, DTI ceiling, vehicle age cap, applicant age
  limits, accepted employment types, accepted vehicle conditions, CRB requirement, documents
  required, approval turnaround. Change a rate here and the customer's comparison changes on
  the next keystroke. Each dealership can also switch individual lenders on or off.
- **Pre-qualifications** — everyone who ran the "hear back from every lender" check, with
  their income, target price, how many lenders matched, the best monthly figure, and a drawer
  showing exactly what each lender said. The warmest leads on the site.
- **Running costs** — the fuel prices, insurance rates, licensing fee and tyre assumptions
  behind the customer-facing Running cost and Insurance tabs. Move the petrol price and every
  quote on the site follows.
- **Leads** — test drives, trade-ins, sell-your-car, call-backs, enquiries, with status.
- **Dealership** — branding (name, tagline, colours, initials), contact details, branches.
  The storefront re-themes from these.
- **Staff** — roles and access. **Activity log** — every change, who made it, when.

### Roles

| Role | Scope |
|---|---|
| `superadmin` | every dealership; can add dealerships and lenders |
| `dealer_admin` | own dealership: stock, applications, staff, lenders on/off |
| `sales_agent` | own dealership: stock, applications, leads |
| `finance_officer` | own dealership + can edit lender rules |

Isolation is enforced server-side, not in the UI — a dealer admin who calls the API directly
for another dealership's vehicle gets a 403. There is a test for exactly this.

---

## The finance engine

`lib/finance.js` — the only place money is calculated. Nothing is hard-coded in the UI.

- **Reducing balance**: standard amortisation, `P·r / (1 − (1+r)^−n)`.
- **Flat rate**: interest on the original principal for the full term — how most Kenyan
  micro-lenders actually quote.
- **Fees**: processing (percentage with a floor and cap), valuation, tracking, legal.
  Each lender either takes them upfront or capitalises them into the facility.
- **Insurance**: comprehensive year one as a percentage of value, optionally financed (IPF).
- **APR**: effective annual rate by bisection IRR over the real cashflows, so flat and
  reducing quotes are comparable.
- **Eligibility gates**: income floor, DTI ceiling, deposit floor, term range, facility
  min/max, vehicle age, vehicle condition, employment type, CRB, applicant age at maturity.
  A short deposit is a *warning* (quoted at the lender's floor with the shortfall named);
  everything else is a *blocker* with a plain-English reason.
- **Affordability**: inverts the amortisation to give a maximum instalment, principal, and
  therefore vehicle price per lender.

---

## Tests

```bash
node --no-warnings tools/audit.js            # 37 pre-launch + front-end checks, no server
node --no-warnings tools/finance-test.js     # 42 assertions, no server needed
node --no-warnings tools/ownership-test.js   # 39 assertions, no server needed
node --no-warnings tools/performance-test.js # 71 assertions, no server needed
node --no-warnings tools/smoke.js 4000       # 140 assertions against a running server
```

**351 assertions in total, all green.** `TASKS.md` maps every one of them to the thing it
proves — including all 45 items from the three reference videos.

`audit.js` is the deploy gate: it greps the source for committed secrets, refuses any
third-party import, and asserts that 23 named security controls (and 7 front-end invariants) are still in place. It exits
non-zero if any of them regress, so it can run in CI.

`finance-test.js` checks the maths against textbook figures (a 1,000,000 loan at 12% over
12 months must be 88,848.79/month), that a schedule amortises to zero, that a no-fee
reducing loan's APR equals its headline rate, that a flat 12% lands near 23%, and that every
eligibility gate blocks and passes correctly.

`ownership-test.js` checks the running-cost and insurance models: that a 2.0L petrol lands at
8.1 L/100 km, that diesel beats petrol and a hybrid beats diesel, that the cost lines sum to
the total, that removing the loan removes exactly the loan, that tripling the mileage triples
the fuel but leaves licensing alone, and that a fuel-price change flows through proportionally.

`smoke.js` walks the whole API: catalogue and filters, quoting, schedules, affordability,
running cost, insurance, pre-qualification, application submission, document upload, tracking
(including rejecting a wrong phone number), leads, trade-in, login, admin CRUD, CSV
import/export, audit log, and multi-tenant isolation. It also proves the two loops that
matter: **edit a lender's rate in admin and the customer's cheapest offer changes**, and
**edit the petrol price in admin and the customer's running-cost figure changes.**

---

## Layout

```
motoke/
  server.js            zero-dep HTTP server, routing, static, SVG placeholder images
  lib/
    db.js              node:sqlite schema, additive migrations, query helpers
    finance.js         the quotation and eligibility engine
    ownership.js       running cost + insurance models
    api.js             every JSON endpoint
    auth.js            scrypt passwords, sessions
    seed.js            5 dealerships, 11 lenders, 77 vehicles, staff
    demo.js            22 sample applications + leads so the console looks alive
  public/
    index.html  js/store.js    customer storefront (SPA)
    admin.html  js/admin.js    staff console (SPA)
    css/app.css                shared stylesheet, dealer branding via CSS variables
  tools/
    finance-test.js  ownership-test.js  performance-test.js  smoke.js
  data/motoke.db       created on first run
```

Vehicle photos are generated as SVG on the fly (`/img/vehicle.svg?make=…&color=…`) so the
demo has no external image dependencies and works with no internet. Paste real image URLs
into any vehicle in admin and they take over.

---

## Before showing this to a real dealership

**Every dealership and lender in here is fictional, and every rate and fee is sample data.**
They exist so the engine has something to price. Replace them in
**Admin → Lenders & rules** with the institution's own published terms, and in
**Admin → Dealership** with the real branding, before anything commercial is said about them.

Not yet built, in rough order of what a real deployment needs:

- M-Pesa STK push for the deposit or booking fee
- SMS/email notification on every status change (the events already exist to hang it on)
- Real lender integrations — today submission is a status change, not an API call
- CRB lookup instead of a self-declared checkbox
- Document storage on disk or object storage (currently base64 in SQLite — fine for a demo,
  not for volume) and HTTPS + rate limiting for a public deployment
