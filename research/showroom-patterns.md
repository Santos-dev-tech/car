# What good car sites do — and what MotoKE should take from it

Research pass, 5 September 2026. Sources at the bottom.

Two questions drove this: **what makes a car site convert**, and **what should the
customer's own page actually be for**. Everything below is either already in MotoKE
(marked ✓), worth taking (→), or deliberately skipped (✗ with the reason).

---

## The numbers worth knowing

| Finding | Why it matters here |
|---|---|
| Vehicle-page view → lead runs **2.5–4%**, best-in-class **6–7%** | Sets the bar. Small friction costs real sales. |
| Visitors who touch a **finance tool convert at roughly double** the rate of those who only look at prices | MotoKE's whole reason to exist. It should be harder to *miss* the finance tools than to find them. |
| Rich media lifts time on a vehicle page **35–45%** | Argues for more photos per car, not more cars per page. |
| Lenders who automate status tracking report **30–50% fewer** post-submission calls | Directly supports making the tracker the centre of the page. |

---

## The vehicle page

**✓ Already right:** price and monthly payment side by side; specs above the fold;
enquiry, WhatsApp and test-drive all reachable without navigating away; similar cars;
a finance calculator on the page rather than behind a tab; real photographs, not stock.

**→ Take these:**

1. **A sticky action bar on mobile** — call, WhatsApp, finance — visible while scrolling.
   Named repeatedly as the single highest-impact mobile pattern.
2. **More photos per car.** The consistent recommendation is **15–20 minimum**: exterior
   angles, interior, dashboard, boot. MotoKE has one real photograph per car and SVG
   fallbacks. This is the biggest gap between MotoKE and a top-tier site.
3. **"Book a Test Drive" beats "Contact Us."** Specific verbs outperform generic ones.
   MotoKE already has the action; the label can be sharper in places.

**✗ Skipped:** 360° spins and AR overlays. Real value, but they need a photo rig per car
and a heavy viewer. Wrong trade on a Kenyan mobile connection, and wrong trade for a demo.

---

## What the Kenyan market actually does

**Autochek KE** — the closest direct comparison.

- Leads with **"Drive Now, Pay Later"**, not with cars. Financing *is* the headline.
- **Monthly payment on every single card**, plus a "car loan available" badge.
- **Price brackets** rather than a slider: under 1M, 1–2M, 2–3M, 3–5M, above 5M.
- A **Prequalify** link in the main navigation.
- States **40% minimum down payment** openly.
- **No application tracker.** Nothing to log into after you apply.

**Cheki KE** — calculator only: value, deposit, rate, term (12/24/36/48/60/72), showing
monthly, principal, total interest, total cost. And a line that matters:
*"We don't offer loans directly."* No application, no tracking.

**The gap.** Not one of them tracks an application after submission. MotoKE already has a
tracker, an offer letter and a document upload. That is the genuine advantage, and burying
it below a calculator throws it away. This is the strongest single argument for the
change requested.

**→ Take these:**

4. **Price brackets as one-tap chips**, not just a slider. Fewer decisions, thumb-friendly.
5. **State the deposit floor openly**, the way Autochek states 40%. MotoKE computes it per
   lender and should say it before the customer invests effort.
6. **Monthly payment on every card** — ✓ already there via `estimateMonthly`.

---

## Affordability before the calculator

The reverse calculator — *"what payment can I manage?"* → *"what does that buy?"* — is
standard at KBB, NerdWallet and most credit unions, and it is the right order. A customer
who opens a calculator does not yet know what to type into it.

Published rules of thumb worth showing rather than hiding:

- **20-4-10** — 20% down, no more than 4 years, payments under 10% of gross income.
- Total running cost, not just the instalment, under **~20% of take-home**.

MotoKE already computes affordability *and* full running cost, so it can state this more
honestly than any site above. It is currently the second tab.

**→ Take these:**

7. **Put affordability first in the finance journey.** Budget → cars in range → quote.
8. **Show the rule of thumb next to the result**, so the number has a reason attached.

---

## The tracker

NN/g and the lending case studies agree on what a status tracker must do:

- Show **every step**, where you are, and **what is still to come** — not just the current state.
- Say **what happens next and roughly when**. Absence of this is what generates the calls.
- Be **returnable** — save and come back, without re-entering anything.
- Show **what is needed from the customer** distinctly from what the business is doing.

MotoKE's tracker has the states. What it lacks is the *next step* and *who is waiting on
whom* — the two things that actually stop a phone call.

**→ Take these:**

9. **Tracker as the page's purpose**, calculator as a tool on it.
10. **A step rail** — Submitted → Under review → Approved → Offer letter → Documents →
    Disbursed → Delivered — with completed, current and upcoming visually distinct.
11. **A "what happens next" line** on every state, with an expected timescale.
12. **A waiting-on-you block** that is unmissable when the customer must act.
13. **Reference-based access** so someone who applied without an account can still return.
    ✓ MotoKE already does this; it should be prominent rather than hidden.

---

## Motion

Lenis is under 5 kB, and **honours `prefers-reduced-motion` by default** — smoothing off,
programmatic scrolls jump instantly, and it picks the preference up live without a reload.
That makes it safe to adopt. It must be vendored like the Firebase SDK: pinned version,
recorded hash, served from our own origin, because `script-src 'self'` allows nothing else.

**✗ Skipped:** scroll-jacked full-page sections. They fight the user on a phone and break
in-page anchors.

---

## Ordered by value for the effort

| | Change | Effort |
|---|---|---|
| 1 | Tracker becomes the page's purpose, with step rail + next step + waiting-on-you | High |
| 2 | Affordability first in the finance journey | Low |
| 3 | Sticky mobile action bar on the vehicle page | Low |
| 4 | Price-bracket chips | Low |
| 5 | Lenis smooth scroll, reduced-motion respected | Low |
| 6 | Deposit floor stated up front | Low |
| 7 | More photographs per car | High — needs generation credits |

---

## Sources

- [Car Dealer Website Design Guide 2026 — Vehiso](https://www.vehiso.com/blog/car-dealer-website-design-guide/)
- [The Car Dealer's Website Playbook — Dealer Inspire / Cars Commerce](https://www.carscommerce.inc/website-playbook-chapter-4/)
- [Automotive Landing Page Statistics 2026 — Web Tonic](https://www.webtonic.io/blog/automotive-landing-page-statistics)
- [Autochek Kenya](https://autochek.africa/ke)
- [Cheki Kenya — car loans](https://cheki.co.ke/car-loans)
- [Kai & Karo](https://www.kaiandkaro.com/)
- [Status Trackers and Progress Updates: 16 Design Guidelines — NN/g](https://www.nngroup.com/articles/status-tracker-progress-update/)
- [Progress Tracker Design: UX Best Practices — UXPin](https://www.uxpin.com/studio/blog/design-progress-trackers/)
- [Car Affordability Calculator — KBB](https://kbb.com/car-affordability-calculator/)
- [Reverse Auto Loan Calculator — NerdWallet](https://www.nerdwallet.com/auto-loans/learn/reverse-auto-loan-calculator)
- [Lenis — darkroomengineering](https://github.com/darkroomengineering/lenis)

*Generated by the MotoKE build session, 2026-09-05.*
