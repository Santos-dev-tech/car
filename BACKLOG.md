# MotoKE — running task list

Every request Zain has made, in order, with its current state. `TASKS.md` is the *scope
record* (what was built and the test that proves it); this is the *working list* (what is
asked, in flight, or waiting).

Update this file when a request lands, changes state, or is delivered.

Last updated: 2026-09-05

---

## Done

| # | Request | Proof |
|---|---|---|
| 1 | Car-dealership demo site: pick a car, pick how to finance it, microfinance + multiple banks, admin section, "fully functional", functionality before design | 5 gates, 351 assertions |
| 2 | Fix "not showing well in browser" | `js/boot-guard.js`, loaded by relative path |
| 3 | Restart localhost links (×2) | server on :4000 |
| 4 | Extract 0.2s frames from the reference video, match all its functionality | `TASKS.md` §C, 20 items |
| 5 | **A1** Lock the vehicle price when a car is picked from stock | Server takes price from the row; `smoke.js` |
| 6 | **A2** E-commerce | Booking deposits, M-Pesa simulator, `commerce.js` |
| 7 | **A3** Offer letter | `commerce.js`, scoped to `siteDealer()` |
| 8 | **A4** Remove multi-dealership — build for one | `siteDealer()` boundary + isolation tests |
| 9 | **A5** Smarter stats in every section | `market.js`, `ownership.js` |
| 10 | **A6** Running costs that update themselves | `jobs.js`, EPRA cycle, staleness shown |
| 11 | 20 pre-launch security items | `audit.js` §B |
| 12 | 20 UX additions | `TASKS.md` §C |
| 13 | 5 login-endpoint security failures | `TASKS.md` §D |
| 14 | Create `CLAUDE.md` | `motoke/CLAUDE.md` |
| 15 | Add Communication Style / Rules / File Naming / Folder Structure / Agent Behavior / Success Criteria | `CLAUDE.md` + `~/.claude/CLAUDE.md` |
| 16 | Global AI workflow system inside `~/.claude/`, runnable, `deep-research` kept as-is | `~/.claude/skills/`, `~/.claude/workflows/` |
| 17 | Apply the Lamborghini.com design system, keep functionality | `app.css` token layer; all gates still green |
| 18 | Log out Higgsfield, prompt the new email to authorise | Authed as beautyexpress211@gmail.com |
| 19 | Fix invisible form fields in light and dark mode | Select + option driven from the same tokens |
| 20 | "the choices under any make are not visible" | Verified in both themes with `select.size=8` |
| 21 | Load car images, look exactly like Lamborghini, scrollable car rail, design loop | 14 photos, hero carousel, 9-card rail |
| 22 | **A7** Car-guy stats — 0–100, interior quality, rim size "and all" | `performance.js`, 71 + 19 assertions |

---

## In flight

| # | Request | State |
|---|---|---|
| 23 | **Firebase** — Auth (multiple sign-in methods) + Firestore for the whole data model, added to MotoKE | Rules written (`firestore.rules`, `storage.rules`). Integration plan below, not yet built. |

### 23 — remaining steps

- [x] `firestore.rules` — full model, deny by default, money and identity server-only
- [x] `storage.rules` — photos public-read, ID documents write-only from the browser
- [x] CSP widens for Google's endpoints only, and only when `MOTOKE_FIREBASE_PROJECT` is
      set — a site without Firebase keeps the tighter policy
- [x] `Cross-Origin-Opener-Policy` → `same-origin-allow-popups` when Firebase is on.
      Without this `signInWithPopup` never settles and every social button looks broken
      with nothing in the console
- [x] 9 new audit checks asserting both policies — no wildcard, no CDN in `script-src`,
      `frame-src` limited to the two sign-in origins
- [ ] **Blocked on permission:** vendor the Firebase SDK to `public/vendor/`
- [ ] Verify the ID token server-side and mint a MotoKE session from it
- [ ] Verify the ID token server-side and mint a MotoKE session from it
- [ ] Set custom claims (`role`, `dealerId`) with the Admin SDK — never from the browser
- [ ] Mirror SQLite → Firestore, or cut over; decide which is the source of truth
- [ ] Add a sixth gate: `tools/firebase-test.js`, with the rules emulator

---

## Batch of 2026-09-06 (later)

### Role permissions — least privilege per job

Every staff role could reach every screen, because the only check was "is this person
staff". A sales agent could open lender rate cards and the activity log; reception could
read customers' ID numbers and payslips. `lib/auth.js` now holds a capability matrix and
`requirePerm` enforces it on **35 admin routes** — the console menu is built from the same
list, so the two can never disagree.

| Role | Sees |
|---|---|
| **superadmin** | everything, plus lender rate cards and running-cost assumptions |
| **dealer_admin** | the whole yard — overview, inventory, ageing, applications, staff, audit |
| **finance_officer** | applications, pre-qualifications, bookings, the lender panel. **No overview, no inventory.** |
| **sales_agent** | inventory, ageing, leads, bookings, pre-quals, applications (cannot decide them) |
| **receptionist** | the diary and the enquiries. Nothing else — no financial or identity documents. |

Demo account added: `janet@summitmotors.demo` / `demo123`.
Proved by 21 assertions in `smoke.js` that check the **server** refuses, not the menu.

### The five from `research/next-five.md`

| # | Feature | State |
|---|---|---|
| 43 | **Stock ageing** | **Done** — `lib/inventory.js`, buckets at 30/45/60 days, carrying cost, turn rate by make, and a repricing list. New console page. |
| 44 | **Consignment beside trade-in** | **Done** — retail less commission and prep, against the cash offer, and it says plainly when the cash offer is the better deal. |
| 45 | **Tracker, in-charge and IPF** | **Done** — tracker fitting and NTSA in-charge now in Cash on day one; tracker subscription in the running cost of a financed car. |
| 46 | **A trade-in offer that is held** | **Done** — reference, seven-day expiry and written terms. |
| 47 | **e-Logbook wording** | **Done** — provenance now checks the NTSA e-Logbook record rather than a printed book. |

### Also fixed

- **The price indicator could be badly wrong on unusual cars.** A 79 Series Land Cruiser
  was being compared with Hilux pickups — same body, different vehicle — and reported as
  91% overpriced. Any gap beyond 35% is now treated as evidence the comparison is wrong
  rather than the price, and it declines instead. Saying nothing beats telling a
  dealership to halve a price.
- **The demo stock all had the same arrival date**, so the ageing view showed 65 cars at
  nought days. `tools/backfill-stock-age.js` gives it a believable curve.
- **A smoke test was quoting a 9.8M Land Cruiser to an applicant on 180k** and asserting
  lenders would approve — it fell back to `items[0]` when its price band was off the first
  page. Now it asks the server for the band.

## Batch of 2026-09-06

### Bugs reported from real use

| # | Report | State |
|---|---|---|
| 30 | Home page scrolls badly / laggy | **Fixed.** Five full-viewport hero images were being scale-animated forever — including the four hidden ones, and while scrolled past. Now one animates, the browser skips the hero entirely once it leaves the screen, `content-visibility` skips off-screen sections and the rail, and the blurred sticky header is gone. |
| 31 | "Assign to" saves the moment you pick a name | **Fixed.** It saved on `change` *and* closed the modal, so any half-typed restructure was thrown away. Now an explicit Assign button, disabled until the choice actually differs, and the modal stays open across saves. |
| 32 | Cannot delete the email and password on the staff sign-in | **Fixed.** The form pre-filled real credentials, so the browser's password manager kept re-filling them. Fields now start empty and the demo logins are click-to-fill buttons — which also stops a live install shipping with a working password in the login box. |

### The top ten from `research/global-dealership-patterns.md`

Ordered as agreed — the ones whose data already exists come first.

| # | Feature | Data already there? |
|---|---|---|
| 33 | **Price indicator** | **Done** — `lib/valuation.js`, 35 tests. Low/Great/Good/Fair/Above, with the shilling difference. Refuses to judge on fewer than 4 comparables and says so. |
| 34 | **Trade-in value flows into the deposit** | **Done** — valuer now sits on the finance screen and its answer drives the deposit slider. Uses the LOW end of the range, and says so when that is less than the deposit already set. |
| 35 | **Guaranteed future value** | **Done** — on the vehicle page, with a conservative floor 12% under the projection because a buyback is a real commitment. |
| 36 | **Return window** | **Done** — `dealers.return_days` + terms, shown in a promise strip on every listing. Seeded at 7 days. |
| 37 | **Saved searches with alerts** | **Done** — `saved_searches` table, works signed-in or with just a phone number, scoped so nobody can read or delete another person's. UI still to add to the browse page. |
| 38 | **Vehicle history block** | **Done** — five Kenyan provenance checks: outstanding logbook loan, NTSA/TIMS match, write-off, odometer, duty entry. Three-state: an unchecked item never reads as a pass. |
| 39 | **Deeper inspection** | **Done** — a 42-point checklist behind the five scores, collapsible on the page and forced open when printed, because the list is the whole point of a report. |
| 40 | **Paperwork** | **Done** — transfer handled / costed, per car or per dealership, on the listing. |
| 41 | **Test drive as booked slots** | **Done** — real diary with a cap of 2 per hour, closed Sundays, re-checked server-side at booking so two people cannot take the last slot. Still raises a lead so the team works from one place. |
| 42 | Editorial / buying guidance | Deferred — noted in the research, not recommended |

**10 of 10 built.** Item 42 was flagged in the research as *not* recommended, so the
list is complete.

### Also fixed in this batch

- **Four cars in five were invisible.** The seed still laid stock across five fictional
  dealerships from the old multi-tenant demo, so Summit held 16 of 77 — the Prados, the
  Land Cruiser V8, the Macan and the Evoque were all hidden. `seedIfEmpty` now brings the
  book home on a fresh install, and `tools/consolidate-stock.js` fixes an existing
  database. **65 cars, 16 makes, both Prados visible.** Three cars stay with each other
  dealership on purpose, so the single-tenant boundary still has something to prove.
- **A timezone bug in the booking slots.** Dates were built from local parts then
  formatted with `toISOString()`, which shifts back a day anywhere east of UTC — so the
  screen offered "Sunday" under a label reading "Mon". Now formatted from local parts,
  with a server-side refusal of closed days as well.

## Queued — batch of 2026-09-05

| # | Request | State |
|---|---|---|
| 24 | Explain the Restructure / Re-quote panel | **Answered.** Staff rescue panel for a declined or unaffordable deal. |
| 25 | Explain "Cash on day one" and "True APR" | **Answered.** Deposit + non-capitalised fees; and the all-in rate that exposes flat-rate lenders. |
| 26 | **Affordability before the calculator** | **Done.** It is now the first tab *and* the default, and the homepage leads with it. Added a rule-of-thumb panel (payment ≤10% of gross) so the budget has reasoning attached. |
| 27 | **Tracker as the main purpose of the page** | **Done.** Rebuilt around "Where is my car?": step rail, plain-English state, what-happens-next with a timescale, an unmissable *Waiting on you* block, and a sidebar carrying the offer letter and the car. |
| 28 | **Research car showroom sites** | **Done.** `research/showroom-patterns.md`. Four findings implemented so far; the rest ranked by value against effort. |
| 29 | **Lenis smooth scroll** | **Done.** Vendored 1.3.26, hash-checked. Off on touch and under reduced motion, both asserted by the audit. |

### From the global research pass (`research/global-dealership-patterns.md`)

Ranked by value for effort. The top two need no new data source.

- [ ] **Price indicator vs the local market** — Auto Trader's Great/Good/Fair badge, with
      the shilling difference. `market.js` and 77 comparables already hold everything needed.
      Highest-value gap: it answers "am I being overcharged", which no Kenyan site answers.
- [ ] **Trade-in value flows into the deposit** — the estimator exists but its answer never
      reaches the finance screen. Most Kenyan buyers have a car; its value *is* their deposit.
- [ ] Saved searches with alerts — currently you can save a car but not a search
- [ ] Return window (Cinch 14 days, CarMax 10 days) — a policy field, then show it
- [ ] Vehicle history block — outstanding logbook loan, TIMS match, write-off, odometer
- [ ] Deeper inspection checklist and a printable report (Spinny 200-point is their whole brand)
- [ ] Test drive and delivery as booked slots rather than a callback lead
- [ ] Guaranteed future value — `market.resale()` already projects it

### Taken from the first research pass, still to do

- [ ] Price-bracket chips on browse (under 1M / 1–2M / 2–3M / 3–5M / 5M+) — Autochek's pattern, fewer decisions than a slider
- [ ] State the deposit floor before a customer invests effort in a quote
- [x] More photographs per car — **done for the top 10.** Four extra angles each (rear
      three-quarter, dashboard, front seats, wheel detail) via `tools/generate-gallery.js`.
      40 images, 0 failed, 6.00 credits. Compressed 117 MB → 5.4 MB. The SVG placeholder
      views are now dropped from any car that has real angles, since a real rear shot
      followed by a cartoon one reads as broken.
      **1.75 credits left** — enough for about 11 more images, so roughly two more cars.

### Fixed while working on the above

- The smoke suite booked a car on every run and never released it. Over many runs it sold
  the entire demo yard and the storefront came up empty. The suite now releases what it
  holds and asserts stock survives; `tools/reset-stock.js` repairs a database that already
  drifted. This had been silently degrading the demo for a while.

---

## Waiting on a decision

| Item | The question |
|---|---|
| Source of truth | Firestore and SQLite both holding the model is two databases to keep in step. Which one wins on a disagreement? |
| Encrypted identifiers | `idNumber`, `kraPin`, `dob` are AES-256-GCM today. Keep them in SQLite, or move to Firestore encrypted by a Cloud Function? |
| Hosting | Firebase Hosting + Cloud Functions, or keep the Node server and use Firebase only for auth and data? |

---

## Offered, not taken up

- Rear / interior / wheel photographs for the top cars (~3 credits of the 7.75 left) to
  replace the SVG gallery views on detail pages.

## Deliberately not built

- A blog / CMS. The reference site had one; it is a content system, not a feature.
- Real SMS. The 2FA code prints to the server console.
- Live lender APIs. Submitting is a status change, not an API call.
- CRB lookup. Still a self-declared checkbox.

---

## Standing notes

- **Demo data is fictional.** Every dealership, lender, rate and fee in `seed.js` is
  indicative. Replace with published terms before any commercial conversation.
- **`demo_mode` echoes the 2FA code to the browser.** Turn it off for production.
- **The `MEASURED` specs in `seed.js` are real published figures**, but check each against
  the actual unit's logbook before quoting them commercially.
- **`tools/backfill-specs.js`, not `--reset`.** A reset throws away the generated
  showroom photographs.

*Generated by the MotoKE build session — keep it current.*
