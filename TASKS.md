# MotoKE — build task list

Everything asked for on 2026-09-05, plus the three reference videos.
Every ticked item is implemented **and covered by an automated test**.

Run the proof:

```bash
node --no-warnings tools/audit.js            # 37 security + front-end checks
node --no-warnings tools/finance-test.js     # 42 finance assertions
node --no-warnings tools/ownership-test.js   # 39 running-cost assertions
node --no-warnings tools/smoke.js 4000       # 140 API assertions
```

---

## A. Direct requests

- [x] **A1 — Locked price.** Pick a car in the Calculator, Running cost or Insurance tab and
      the price field is replaced by `KES 4,250,000 🔒 our listed price`. The server also
      overwrites any price the client sends when a `vehicleId` is present, so it cannot be
      edited in the browser either.
      *Test: "the price is locked to the vehicle".*
- [x] **A2 — E-commerce.** `#/reserve/:id` takes a booking deposit (2% of the price, floor
      20k, cap 150k) by M-Pesa STK push, card, bank transfer or pay-at-the-yard. Paying
      holds the car for 7 days, issues a receipt, and releases it automatically when the
      hold lapses. The fee is computed server-side; a replayed callback cannot double-charge.
      Real Daraja credentials drop straight in — without them it runs a faithful simulator.
      *Tests: 10, including "the fee comes from the server, not the client".*
- [x] **A3 — Offer letter.** `#/offer?ref=…` renders a printable letter on the dealership's
      letterhead: schedule, fees, six conditions, signature blocks, expiry date. Generated
      from the stored application, so the figures cannot be edited before printing. Only
      available once approved, and only to the applicant (phone match) or staff.
      *Tests: 5, including "no offer letter before approval".*
- [x] **A4 — One dealership.** The switcher is gone. The server resolves every public request
      to the single configured dealership and refuses to serve another yard's vehicle,
      application, offer letter or booking — a row-level boundary, not a hidden menu. The
      platform admin switches which dealership an install serves on the Dealership page.
      *Tests: "another yard's car is not reachable from the storefront", plus 3 more.*
- [x] **A5 — Smarter numbers.** Fuel economy is now modelled from engine size, fuel type,
      **body type and drivetrain**, and reported the way Kenyans talk: **km per litre**, cost
      per 100 km, and what a Nairobi–Mombasa run costs in fuel. Servicing is priced off the
      badge (a BMW is 2.3× a Toyota) with the real interval. Resale is projected from
      make-specific Kenyan retention. Import duty follows the KRA schedule.
      *Tests: 8, including "a 4WD pickup drinks more than the same-engine sedan" and
      "a BMW costs more to service than a Toyota".*
- [x] **A6 — Self-updating running costs.** EPRA publishes pump prices on the 14th monthly.
      The server checks daily, updates itself, and records the date. If it cannot reach the
      source it keeps the last good figures and says how old they are, on the customer's
      screen and in admin — a stale number is visible, never silently wrong.
      *Tests: 5, including "the storefront can show the price and its age".*

- [x] **A7 — Car-guy stats.** 0–100 km/h, power in hp and kW, torque, top speed, power to
      weight, aspiration, kerb weight, rim diameter, tyre size, ground clearance, brakes,
      boot litres, tank size, range per tank, seat trim, screen size and a five-area workshop
      condition score. They appear as a four-figure headline strip and six grouped panels on
      the vehicle page, three figures on every listing and rail card, and nineteen rows in the
      comparison table.

      `lib/performance.js` derives every figure from engine size, body, drivetrain and age.
      A dealership that has the logbook types the real number into the admin form and it
      overrides the estimate — the page then names which figures are the car's own and which
      are modelled. It never presents an estimate as a manufacturer claim. The condition
      scorecard follows the same principle: an area nobody scored reads "not checked", never
      as a pass.
      *Tests: 71 in `performance-test.js` + 19 in `smoke.js`, including "a typed-in
      horsepower overrides the estimate", "clearing the box goes back to the estimate",
      "an unscored area reads as not checked, never as a pass" and "never leaks an internal
      field name at the customer".*

## B. Video 1 — "20 things to have Claude do before launching your app"

All 20 are asserted by `tools/audit.js`, which exits non-zero if any regress.

- [x] **B1 Hide API keys** — no key is hard-coded; M-Pesa credentials come from the
      environment and never reach the browser. The audit greps for eight key formats.
- [x] **B2 Purge Git secrets** — `.gitignore` excludes `data/`, `.env`, `*.db` and `.secret`;
      the audit fails if any of those entries goes missing and warns if a `.git` folder exists.
- [x] **B3 Public DB key** — the encryption key lives in `data/.secret` (gitignored, mode 600)
      or `MOTOKE_SECRET`. Nothing privileged is reachable from the client.
- [x] **B4 Row-level security** — every query is scoped to the install's dealership, and
      staff to their own; a dealer admin gets 403 on another yard's record.
- [x] **B5 Encrypt sensitive data** — ID numbers, KRA PINs, dates of birth and every uploaded
      document are AES-256-GCM encrypted at rest.
- [x] **B6 Server-side auth** — `requireStaff` / `assertOwns` on every admin route.
- [x] **B7 Lock record access** — a stranger cannot attach documents to your application, and
      the tracker demands a matching phone number.
- [x] **B8 Block field tampering** — payloads are allowlisted; prices, booking fees and loan
      amounts are always recomputed server-side from the vehicle record.
- [x] **B9 Secure session cookies** — HttpOnly, SameSite=Strict, Secure over TLS.
- [x] **B10 Hash passwords** — scrypt with a per-user salt, compared in constant time.
- [x] **B11 Rate limit login** — 6 attempts per account and 25 per connection in 15 minutes.
- [x] **B12 Bot protection** — a honeypot field plus a minimum time-on-form, on every public
      form. No third-party captcha, no tracking.
- [x] **B13 Parameterised queries** — every value is bound; the audit checks no SQL string
      interpolates request data.
- [x] **B14 Validate all input** — one `security.V` validator set: Kenyan phone numbers are
      normalised to +254, ID numbers and KRA PINs are format-checked, money is bounded.
- [x] **B15 Escape user content** — markup is stripped server-side on the way in and escaped
      on the way out.
- [x] **B16 Restrict file uploads** — PDF/JPG/PNG/WebP only, 5 MB cap, and the real bytes must
      match the declared type's magic number. "evil.pdf" that is actually an executable is refused.
- [x] **B17 Trim API responses** — password hashes, salts, OTP hashes and document blobs are
      stripped from every response; the public tracker masks the ID number.
- [x] **B18 Security headers** — CSP, X-Frame-Options DENY, nosniff, Referrer-Policy,
      Permissions-Policy, COOP, HSTS over TLS. **The CSP is strict `script-src 'self'`, so the
      app contains no inline JavaScript at all.**
- [x] **B19 Force HTTPS** — 308 redirect off localhost, HSTS once secure.
- [x] **B20 Scan dependencies** — there are none. Every import is a `node:` builtin or a local
      file, and the audit fails if that ever stops being true.

## C. Video 2 — "20 things to add to your website right now"

- [x] **C1 Dark / light toggle** — remembered per browser, follows the system until you choose.
- [x] **C2 Cookie banner** — honest about the one cookie, links to the privacy page.
- [x] **C3 Site search** — `/` or `⌘K`, searches stock and pages, arrow keys and Enter.
- [x] **C4 Back-to-top** — appears past 500px.
- [x] **C5 Mobile menu** — hamburger under 900px, closes on navigation.
- [x] **C6 Loading animations** — shimmer skeletons for cards and text.
- [x] **C7 Hover states** — on every interactive element.
- [x] **C8 Scroll progress bar** — across the top.
- [x] **C9 Copy button** — on reference numbers, receipts, 2FA codes and share links.
- [x] **C10 Print stylesheet** — chrome hidden, cards flattened, link URLs expanded, page
      margins set. The offer letter and payment receipt are built to print.
- [x] **C11 Sticky header** — with backdrop blur.
- [x] **C12 Skip to content** — first tab stop; visible focus rings throughout.
- [x] **C13 Password visibility toggle** — plus a live strength meter scored by the server.
- [x] **C14 UTM tracking** — captured once per visit and attached to every lead, application,
      pre-qualification and booking, so the dealership can see which campaign sold a car.
- [x] **C15 Form success state** — the contact form and checkout swap to a tick panel.
- [x] **C16 Form error state** — server errors land on the field that caused them.
- [x] **C17 Confirmation modals** — on every destructive action.
- [x] **C18 Last updated date** — in the footer, relative ("updated today").
- [x] **C19 Expandable FAQ** — generated from the live lender rules so it cannot go stale.
- [x] **C20 Floating contact** — WhatsApp, phone, message and test-drive.

## D. Video 3 — "5 ways your vibecoded login endpoint isn't secure"

- [x] **D1 No session token in LocalStorage** — the session is an HttpOnly cookie no script
      can read. The audit greps the client bundle to prove no token is ever stored there.
- [x] **D2 No client-side admin checks** — the UI hides what you cannot use, but every
      decision is made on the server. An anonymous call to `/api/admin/stats` gets 403.
- [x] **D3 2FA / OTP** — staff sign-in issues a 6-digit code, hashed with HMAC before storage,
      10-minute expiry, 6 attempts. No session exists until the code is verified.
- [x] **D4 Rate limiting on /login** — per account and per connection, with a clear message.
- [x] **D5 Password strength check** — length, mixed case, digit, symbol, no common password,
      no sequence, and not your own name or email.

---

## Deliberately not built

- **A blog / CMS.** The nav in the reference video had one. It is a content system, not a
  feature — say the word and it is a separate build.
- **Real SMS.** The 2FA code prints to the server console and, in demo mode, on screen.
  Wire an Africa's Talking or Twilio key into `lib/security.js` to send it for real.
- **Live lender APIs.** Submitting to a lender is a status change, not an API call.
- **CRB lookup.** Still a self-declared checkbox.
