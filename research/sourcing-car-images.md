# Where to get car photographs, legally, that look expensive

Research pass, 6 September 2026. The brief: source classy images of the high-end stock —
Prados, Land Cruisers, Range Rovers, Macans — without generating every one by hand.

Everything below was **tested**, not just read about.

---

## The answer: IMAGIN.studio

A car-imagery API built for exactly this job. You ask for a make, model, angle and colour;
it returns a studio render. It is what Auto Trader-class dealer platforms use, and the
imagery is licensed for automotive retail — that is the entire product.

**Tested against real MotoKE stock.** Every request returned a correct, current render:

| Requested | Result |
|---|---|
| `make=toyota&modelFamily=prado` | Correct 150-series Prado |
| `make=porsche&modelFamily=macan` | Correct Macan |
| `make=mercedes&modelFamily=gle` | Correct GLE |
| `make=land-rover&modelFamily=range-rover-evoque` | Correct Evoque |
| `make=toyota&modelFamily=harrier` | Correct Harrier |
| `make=mazda&modelFamily=demio` | Correct Demio |

**Colour matching works.** The same Prado came back in black, pearl white and red from
`paintDescription`, so the picture can match the actual car on the forecourt rather than
being a generic silver one.

### The request

```
https://cdn.imagin.studio/getImage
  ?customer=<your key>
  &make=toyota
  &modelFamily=prado
  &angle=01
  &paintDescription=black
  &width=1200
  &fileType=png
```

`customer=img` is the public demo key — it works and it is how the tests above were run,
but it **stamps a watermark across the image**. A paid key removes it. Licensing is per
image ("one Micro Use License per request"), with plans from startup to enterprise and a
free tier via RapidAPI.

### Two honest limitations

1. **Older Japanese-domestic models resolve to their modern export equivalent.** Asking
   for a Vitz returned a current Yaris — right car lineage, wrong generation for a 2017
   grey import. Since JDM imports are a large slice of the Kenyan market, expect this to
   be excellent for the premium half of the stock and approximate for the cheap half.
2. **These are renders on a white background**, not photographs on a dark stage. They will
   not sit next to the current generated showroom shots without a decision about which
   look wins. White-background renders are the industry standard for a reason — they are
   clean, consistent, and every car looks the same weight on the page.

---

## The others, ranked

### 2. Manufacturer press and media libraries — free, high quality, restricted use

Toyota, Mercedes-Benz, BMW, Land Rover and Porsche all run press sites with high-resolution
photography. It is genuinely free and genuinely beautiful. **The licence is usually
editorial or press use**, and an authorised dealer normally gets a separate brand asset
pack through the manufacturer. If any of the five dealerships is a franchised dealer, this
is the best imagery available to them and it costs nothing — they just have to ask their
brand contact.

Do not lift it from a press site and put it on a sales page without checking the terms.

### 3. Unsplash and Pexels — free, commercial use, no attribution

Good for **atmosphere**, not for stock. A moody Range Rover at dusk makes a fine hero
image or a section header. It is the wrong tool for a listing, because the photo is of a
different car and my earlier research lists exactly that as a top reason buyers abandon a
dealer site.

Use for: hero backgrounds, the financing band, the About page, editorial.
Never use for: a specific vehicle listing.

### 4. Paid stock — Getty, Shutterstock, Adobe Stock, Alamy

Reliable, properly licensed, and the same limitation as above: generic cars. Worth it for
one or two hero images if you want something more polished than Unsplash. Not worth it
per listing.

### 5. A local automotive photographer — the real answer for a live yard

Half a day with someone who shoots cars, in a consistent spot with consistent light, gets
a whole forecourt done properly. My earlier research is unambiguous that **the actual car,
photographed from the same angles every time, outperforms anything else** — and it is the
only option that is honest, because the buyer is looking at the car they will collect.

For a dealership in Nairobi this is a modest recurring cost and it is what the good
operators already do.

### 6. Keep generating

What has been done so far, and it works — the Prado interior and wheel shots are
convincing. It costs credits, it is slow, and each image is one-of-a-kind rather than a
consistent set. Best kept for filling gaps.

---

## What I would actually do

**Layered, because no single source covers everything:**

1. **Real photographs wherever the yard has them.** Always first. Build the bulk uploader
   so a dealership can drag in a folder from a phone shoot.
2. **IMAGIN.studio for everything unphotographed** — correct model, correct colour, on
   demand, licensed, and instant. It turns "42 cars with placeholders" into "42 cars with
   a clean studio render" for the cost of a subscription rather than 6 credits and an hour.
3. **Unsplash or a bought hero shot** for the atmosphere pieces where no specific car is
   being sold.
4. **Generated images** to fill anything the catalogue misses — the older JDM models.

The current SVG placeholder stays as the last resort, and it should: it is obviously a
placeholder, which is more honest than a photograph of somebody else's car.

---

## One thing to be clear about

For a **demo**, a licensed render of the right model in the right colour is completely
legitimate and looks far better than what is there now.

For a **live listing**, the image has to be the actual car. A buyer who drives to Parklands
and finds the car does not match the photograph does not buy — and in Kenya, where the
whole market runs on trust about provenance, that is the one mistake a dealership cannot
afford. Every render on a live site should carry a line saying it is a representative
image of the model.

---

## Sources

- [IMAGIN.studio — getImage API documentation](https://docs.imagin.studio/guides/getting-images)
- [IMAGIN.studio — CDN data points and parameters](https://docs.imagin.studio/api-integration/manuals/cdn-data-points)
- [IMAGIN.studio — what they do](https://docs.imagin.studio/overview/what-we-do-ai-driven-car-imagery-at-scale)
- [IMAGIN.studio — plans](https://www.imagin.studio/subscriptions/pricing)
- [IMAGIN.studio and JATO partnership — Motor Trade News](https://www.motortradenews.com/dealer-insights/imagin-studio-and-jato-to-provide-vehicle-imagery/)
- [EVOX Images — dealer imagery library and API](https://evoximages.com/resources/api-for-car-images/)
- [Car image API providers compared](https://vehicledatabases.com/articles/car-image-api-providers)
- [Unsplash — Land Cruiser, free for commercial use](https://unsplash.com/s/photos/land-cruiser)
- [Pexels — Land Cruiser](https://www.pexels.com/search/land%20cruiser/)

*Generated by the MotoKE build session, 2026-09-06.*
