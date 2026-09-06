# Five more worth building

Third research pass, 6 September 2026. The brief: things MotoKE does not have that would
genuinely help a **buyer**, a **seller**, or the **dealership** — after the top ten from
`global-dealership-patterns.md` were all built.

Everything was checked against the code first. Nothing here is already in the app.

---

## 1. The NTSA e-Logbook — the ground just moved under this feature

**Who it helps:** buyer and seller, and it is time-sensitive.

**NTSA launched the e-Logbook on 10 June 2026.** Physical logbooks are being phased out.
The new record carries digital encryption specifically to make forgery impractical, and it
is aimed squarely at the fake-logbook trade.

This matters to MotoKE right now because the provenance block built this week says
*"NTSA/TIMS record matches the logbook"* — wording from the paper era. In the e-Logbook
world the check is different and stronger: the record can be verified digitally rather
than eyeballed against a printed book.

The scams this closes are the ones Kenyan buyers actually lose money to:

- **Fake logbooks** — a convincing forgery for a car that is not the seller's, or does not exist.
- **Encumbered vehicles** — the seller took a logbook loan, never cleared it, and sells anyway. You inherit the debt.
- **Stolen vehicles** with cloned papers, traced and repossessed months later.

**What to build:** re-word the provenance checks for the e-Logbook, add a field for the
e-Logbook reference, and — the valuable half — a **seller-side** step that tells someone
listing a car what they need before it can be transferred. Doing this early is a
positioning win: being the site that already speaks e-Logbook while competitors still say
"logbook available" is a real signal of competence.

---

## 2. The costs a lender makes mandatory, which the quote currently leaves out

**Who it helps:** buyer. And it makes an existing MotoKE feature more honest.

Kenyan asset finance is not just the loan. Lenders **require**, as a condition of the facility:

- **A GPS tracker**, installed to the lender's specification, **at the borrower's cost** —
  fitting plus an ongoing subscription.
- **Comprehensive insurance**, maintained for the whole term, not just year one.
- **NTSA joint registration ("in-charge")** so the lender's interest is recorded against the car.

MotoKE models comprehensive insurance already, and lenders carry an `insurance_financed`
flag. It models **none of the tracker**, and nothing of the in-charge registration.

That matters because **Cash on day one** — one of the best things on the site — is
currently understating itself. A buyer who budgets from that figure and then meets a
tracker bill and a registration fee at signing has been let down by the number they
trusted most.

**What to build:** tracker fitting and subscription as running-cost lines, the in-charge
fee in Cash on day one, and **Insurance Premium Financing** as a proper option — Kenyan
banks finance up to 100% of the premium, and spreading it changes what a marginal
applicant can afford.

---

## 3. Sell on behalf — the seller side is missing entirely

**Who it helps:** seller, and the dealership's margin.

MotoKE has a trade-in estimator. Trade-in is a **wholesale** number — it is the least a
seller can get. The alternative every serious dealer offers is **consignment**: the car
sits on the forecourt priced like retail stock, the dealer takes a commission (typically
5–10% of the sale), and the seller pockets far more than a trade-in.

Kai & Karo run "Sell On Behalf" as a named service. MotoKE has no seller path at all
beyond a valuation.

**What to build:** a consignment option beside the trade-in quote, showing the honest
trade-off — *"We will buy it today for KES 900,000, or sell it for you at KES 1,150,000
and take 7%, which nets you KES 1,069,500 in roughly three weeks."* MotoKE can price both
sides already: `valuation.js` knows what comparable stock sells for, and the trade-in
endpoint knows the wholesale figure. This is arithmetic on data the app holds.

It also feeds the thing a dealership needs most — **stock**. A consignment pipeline is a
sourcing channel, not just a service.

---

## 4. An offer that is actually held

**Who it helps:** seller.

CarMax's instant offer is **valid for seven days**, in writing, with no last-minute
reductions. That single promise is most of why people use it — not the number, the
certainty.

MotoKE's trade-in returns a range and no commitment. A seller cannot plan around it, and
the dealership cannot be held to it, so neither side treats it as real.

**What to build:** turn the estimate into a **written offer with a reference and an expiry
date**, honoured on inspection if the car matches what was described. Cheap to build —
the offer letter machinery already exists for finance — and it converts a calculator into
a commitment, which is the whole difference.

---

## 5. Stock ageing — the dealership is a user too

**Who it helps:** the dealership. This is the one that makes them keep using it.

Every dealer management system built in the last decade leads on the same numbers, because
they are the ones that decide whether a yard makes money:

- **Days in stock** per car, in buckets — the industry flags at **45 and 60 days**, before
  floor-plan interest and depreciation start eating the margin.
- **Turn rate by model**, not just lot-wide — a single average hides which models are
  dragging.
- **Margin per unit** and gross-profit trend.
- **Days' supply** — how long current stock lasts at the current rate of sale.

MotoKE's console has counts and a pipeline. It has **no ageing at all** — no concept of how
long a car has been sitting, which is the first question any dealer principal asks.

**What to build:** `created_at` is already on every vehicle, so days-in-stock is a
subtraction. Ageing buckets on the inventory screen, a flag at 45 and 60 days, turn rate
per make, and — tying it to work already done — **cars whose price indicator says "above
the rest" *and* which are over 60 days old are the ones to reprice.** That is a genuinely
useful daily view that nothing else in this market offers.

---

## Ordered by value for effort

| | Change | Who | Data already there? |
|---|---|---|---|
| 1 | Stock ageing and repricing view | Dealership | **Yes** — `created_at` + the price indicator |
| 2 | Consignment beside trade-in | Seller | **Yes** — `valuation.js` + trade-in endpoint |
| 3 | Tracker, in-charge and IPF in the quote | Buyer | Partly — insurance modelled, tracker not |
| 4 | A trade-in offer with a reference and an expiry | Seller | **Yes** — offer-letter machinery exists |
| 5 | e-Logbook wording and a seller readiness step | Both | No — needs new fields |

---

## Sources

- [NTSA lists the features of the new e-Logbook ahead of the 10 June rollout](https://www.kenyans.co.ke/news/123304-ntsa-lists-10-features-new-e-logbooks-ahead-june-10-rollout)
- [How NTSA's e-Logbook changes buying and selling in Kenya](https://nairobiwire.com/2026/05/ntsa-e-logbook-kenya-launch-june-2026-benefits-vehicle-ownership.html)
- [Nine common car scams in Kenya](https://kifedha.co.ke/blog/avoiding-9-common-car-scams-in-kenya-and-how-a-logbook-loan-secures-your-purchase/)
- [NTSA questioned over logbook and car fraud — Daily Nation](https://nation.africa/kenya/news/ntsa-on-the-spot-over-alleged-car-fraud-3849684)
- [The process of car financing in Kenya — deposit, tracker, comprehensive insurance, NTSA in-charge](https://www.money254.co.ke/post/full-guide-the-process-of-car-financing-in-kenya-auto-loans)
- [Insurance Premium Financing — DTB Kenya](https://dtbk.dtbafrica.com/loans/insurance-premium-financing)
- [Co-operative Bank asset finance terms](https://www.co-opbank.co.ke/borrow/asset-finance/)
- [Selling on consignment: what it is and why it pays more](https://www.carpro.com/blog/selling-your-car-on-consignment-what-it-is-and-why-it-pays-more)
- [Best instant cash offer sites — offers held about seven days](https://caredge.com/guides/best-instant-cash-offer-websites)
- [Auto inventory software features for 2026 — ageing buckets and turn rate](https://www.autoxloo.com/news/must-have-auto-inventory-software-features-for-2026.html)
- [Car inventory software with analytics — flagging at 45 and 60 days](https://www.spyne.ai/blogs/car-inventory-software-with-analytics)

*Generated by the MotoKE build session, 2026-09-06.*
