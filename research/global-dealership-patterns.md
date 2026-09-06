# What the best car retailers in the world do that MotoKE doesn't

Second research pass, 6 September 2026. The first pass (`showroom-patterns.md`) looked at
Kenya and at general dealer-website advice. This one looks at the operators who have
actually changed how cars are sold: the US consolidators, the UK online retailers, the
Indian and South-East Asian inspection-led platforms, and the two African players who are
genuinely trying.

Everything below was checked against the codebase first. Nothing is listed as missing if
it is already built.

---

## Who was looked at

**United States** — CarMax, Carvana, AutoNation, Lithia/Driveway, Sonic/EchoPark,
Penske, Hendrick, Group 1, Asbury, Vroom, Shift, TrueCar, Cars.com, Autotrader.com, CarGurus.

**United Kingdom and Europe** — Cinch, Cazoo, Carwow, Motorpoint, Arnold Clark,
Evans Halshaw, Auto Trader UK, mobile.de, AutoScout24, Aramisauto, Carvago.

**India and South-East Asia** — Spinny, Cars24, CarDekho, CarWale, Carsome, Carro.

**Africa** — Autochek, Peach Cars, Cheki, Jiji, Cars45, Kai & Karo.

**Manufacturer certified-used programmes** — Toyota Certified, BMW Premium Selection,
Mercedes Certified, Porsche Approved.

---

## The ten worth stealing

Ranked by what they would do for a Kenyan buyer, not by how impressive they sound.

### 1. A price indicator against the live market — *Auto Trader UK*

Auto Trader labels every advert **Low / Great / Good / Fair / High price**, computed by
comparing the asking price against their own valuation for that make, model, derivative,
age and mileage, from roughly half a million trade listings a day. They also show the
exact money difference between the asking price and the valuation.

**Why it matters here.** The single biggest anxiety in the Kenyan used market is *"am I
being overcharged?"* Every buyer asks it and no local site answers it. A dealership that
labels its own stock against the market is making a claim its competitors cannot copy
without opening their pricing too.

**MotoKE could do this today.** `lib/market.js` already holds `RETENTION` per make,
`priceAge()` and the depreciation curve, and the database holds 77 comparable cars. A
"priced KES 180,000 below similar 2018 Harriers" badge is arithmetic on data already
present. **This is the highest-value missing feature.**

### 2. A stated return window — *Cinch 14 days · CarMax 10 days or 1,000 miles · Spinny 5 days*

Every serious online retailer now guarantees a refund if the buyer changes their mind.
Cinch collects the car and refunds in full. CarMax gives 10 days or 1,000 miles.

**MotoKE has `warranty_months` but no return policy at all.** For a market where buyers
are frightened of being stuck with someone else's problem, a stated return window is
worth more than a longer warranty. It is a policy decision for the dealership rather than
a technical one — but the site needs somewhere to say it, and a field to hold it.

### 3. Vehicle history, checked and shown — *HPI in the UK, Carfax in the US*

No serious Western listing ships without a history check: outstanding finance, write-off
category, stolen marker, mileage discrepancy, number of keepers.

**The Kenyan equivalents are more important, not less:**

- Is there an **outstanding logbook loan** against the car?
- Does the **NTSA/TIMS record** match the logbook in front of you?
- Has it been **written off or rebuilt**?
- Does the **odometer** agree with the service history?
- Is **import duty** genuinely paid, with the entry number?

Cars24 sells this as a **Guarantee Certificate** — no accident, no odometer tampering, no
water damage. That is the single strongest trust artefact found in this entire research
pass, and it is a document, not a feature.

MotoKE has `duty_paid`, `source_ref` and a five-area condition score. It does not have a
history check, and in Kenya that is the gap that costs deals.

### 4. Paperwork done for you — *Spinny free RC transfer · Peach Cars TIMS navigation*

Spinny includes free registration transfer. Peach Cars explicitly sells "TIMS navigation"
as part of what you are paying for, because transferring ownership in Kenya is genuinely
painful and people will pay to have it handled.

**Nothing in MotoKE mentions the transfer at all.** For a Kenyan buyer this is a real
cost and a real fear, and the dealership is already doing the work — it just is not
visible or costed anywhere on the site.

### 5. Guaranteed future value — *Spinny buyback · every European PCP*

Spinny offers assured resale: buy now, and we will buy it back at a known price. Every
PCP deal in Europe is built on the same idea — a guaranteed minimum future value.

**MotoKE already computes this.** `market.resale()` projects retention per make over any
number of years. Turning a projection into an offer is a commercial decision for the
dealership, but the number is already on the screen. "We will buy this back at KES X in
three years" turns a depreciation warning into a reason to buy.

### 6. Saved searches with alerts — *every US marketplace*

CarMax, Cars.com, CarGurus and Autotrader all let you save a search and get told when a
matching car lands. MotoKE lets you save a *car*, which is the less useful half: the
customer who cannot find what they want today is the one you most want to hear from
again.

Cheap to build — the filter state is already serialisable, and there is already a leads
table and an email field.

### 7. Delivery and test drives as booked slots — *Carvana, Cinch, Spinny*

Carvana books a delivery window. Spinny brings a sanitised car to your door for the test
drive. MotoKE treats "book a test drive" as a **lead** — someone will call you back.

Turning it into a real slot on a real calendar removes a phone call from every single
deal, and gives the dealership a diary instead of a to-do list.

### 8. A deeper inspection, presented as a document — *Spinny 200 points · Cars24 200+*

Spinny's whole brand is the 200-point inspection, taking 45–60 minutes, presented as a
report the buyer can read. MotoKE scores five areas out of 100.

The five-area scorecard is the right *shape* — it already refuses to invent a score for
an unchecked area, which is more honest than most. What it lacks is depth and a printable
artefact. A 40-point checklist grouped under the existing five headings would be a
genuine differentiator and needs no new architecture.

### 9. The trade-in feeding the deal — *every UK retailer*

Cinch and Motorpoint put part-exchange in the same flow as the finance quote: your old
car's value becomes your deposit, live, and the monthly payment moves as you type.

**MotoKE has a trade-in estimator, but it is a separate page.** Its output never reaches
the deposit field. Wiring `POST /api/tradein/estimate` into the deposit on the finance
screen is a small change with a large effect: most Kenyan buyers *have* a car, and its
value is the deposit they are worried about raising.

### 10. Editorial that answers the real question — *Carwow reviews, named experts*

Carwow publishes rated reviews and long-term ownership reports under named journalists.
Cinch has "Which car should I buy?".

MotoKE has a FAQ generated from live lender rules, which is good and unusual. It has no
buying guidance. Deliberately deferred — noting it here for completeness, not as a
recommendation to build a blog.

---

## Considered and rejected

| Pattern | Why not |
|---|---|
| 360° spins and AR | Needs a photo rig per car and a heavy viewer. Wrong trade on a Kenyan mobile connection. |
| Dealer bidding (Carwow) | MotoKE's lender comparison is the same idea applied where it actually helps — the finance, not the metal. |
| Subscription / salary sacrifice | No Kenyan market for it yet. |
| Live chat | Real value, but WhatsApp already occupies that slot here and is what people actually use. |
| Native app | The site is the demo. An app is a separate build with its own review cycle. |
| No-haggle fixed pricing | A brand promise, not a feature — and it contradicts the `negotiable` flag the dealerships asked for. |

---

## Ordered by value for effort

| | Change | Effort | Data already there? |
|---|---|---|---|
| 1 | Price indicator vs the local market | Medium | **Yes** — `market.js` + 77 comparables |
| 2 | Trade-in value flows into the deposit | Low | **Yes** — endpoint exists |
| 3 | Saved searches with alerts | Low | Partly — filters and leads exist |
| 4 | Return-window policy field, shown on the listing | Low | No — one column |
| 5 | Vehicle history / logbook-loan check block | Medium | No — needs a data source |
| 6 | Deeper inspection checklist and a printable report | Medium | Partly — scorecard exists |
| 7 | Test drive and delivery as booked slots | Medium | No |
| 8 | Guaranteed future value offer | Low | **Yes** — `market.resale()` |
| 9 | Ownership paperwork: transfer, fines, insurance expiry | High | No |

---

## Sources

- [CarMax pre-qualification — soft credit check, 5 minutes, terms valid 30 days](https://investors.carmax.com/news-and-events/news/news-details/2023/CarMax-Launches-New-Online-Pre-Qualification-Capability-Where-Customers-Can-Shop-Cars-Nationwide-with-Personalized-Financing-Terms/default.aspx)
- [CarMax review — 10-day / 1,000-mile return](https://www.nerdwallet.com/reviews/loans/auto-loans/carmax-financing-buying-selling)
- [Cinch — 14-day money back, 90-day warranty, 100+ collection points](https://www.cinch.co.uk/)
- [Carwow — dealer bidding, sell-your-car, reviews](https://www.carwow.co.uk/)
- [Auto Trader Price Indicator — how the bands are calculated](https://www.autotrader.co.uk/partners/retailer/terms-and-conditions/price-indicator)
- [Auto Trader Price Indicator launch](https://www.motortradenews.com/news/auto-trader-adds-price-indicators/)
- [Spinny — 200-point inspection, 1-year warranty, 5-day money back, buyback](https://www.spinny.com/)
- [Cars24 vs Spinny — inspection depth and guarantee certificate](https://cararth.com/throttle-talk/guide/cars24-vs-spinny)
- [Peach Cars — inspection, TIMS navigation, secure handover](https://peachcars.co.ke/)
- [Peach Cars raises $11M to build Africa's most trusted used-car marketplace](https://launchbaseafrica.com/2025/06/19/kenyas-peach-cars-raises-11m-to-build-africas-most-trusted-used-car-marketplace/)
- [Autochek Kenya](https://autochek.africa/ke)
- [Carvana vs CarMax comparison 2026](https://wealthvieu.com/carvana-vs-carmax/)
- [Car dealership technology trends 2026](https://autocorp.ai/resources/articles/the-future-of-car-dealership-technology-2026-trends-to-watch)

*Generated by the MotoKE build session, 2026-09-06.*
