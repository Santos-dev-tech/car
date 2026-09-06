'use strict';
/**
 * MotoKE — try candidate fuel-price sources against the real parser.
 *
 *   node --no-warnings tools/probe-fuel-source.js [url ...]
 *
 * Recommending a URL without fetching it is guessing. This runs each candidate through
 * `market.fetchFuelPrices()` — the same code the nightly job uses — and reports what came
 * back, so the default we ship is one that has actually been seen to work.
 */
const market = require('../lib/market');

const CANDIDATES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      'https://www.epra.go.ke/pump-prices',
      'https://www.epra.go.ke/EPRA%20Pump%20Prices',
      'https://fuelkenya.com/',
      'https://fuelpoa.com/prices',
    ];

(async () => {
  console.log('\n  Probing fuel-price sources with the live parser\n');
  const results = [];

  for (const url of CANDIDATES) {
    process.stdout.write(`  ${url}\n    `);
    const started = Date.now();
    let r;
    try {
      r = await market.fetchFuelPrices(url, 15000);
    } catch (e) {
      r = { ok: false, reason: 'threw: ' + e.message };
    }
    const ms = Date.now() - started;

    if (r.ok) {
      const p = r.prices;
      console.log(`OK  petrol ${p.petrol_price}  diesel ${p.diesel_price}  kerosene ${p.kerosene_price ?? '—'}   (${ms}ms)`);
      /* Sanity, not just "it parsed". Kenyan pump prices have sat between 120 and 260 for
         years; anything outside that is a number scraped off the wrong part of a page. */
      const sane =
        p.petrol_price > 120 && p.petrol_price < 300 &&
        p.diesel_price > 120 && p.diesel_price < 300;
      if (!sane) console.log('    …but those figures look wrong for Kenya — not trustworthy');
      results.push({ url, ok: sane, ...p, ms });
    } else {
      console.log(`no  ${r.reason}   (${ms}ms)`);
      results.push({ url, ok: false, reason: r.reason, ms });
    }
  }

  const winners = results.filter((r) => r.ok);
  console.log('\n  ---');
  if (!winners.length) {
    console.log('  Nothing usable. Leave the source blank and set prices by hand.\n');
    process.exit(1);
  }
  winners.sort((a, b) => a.ms - b.ms);
  console.log(`  ${winners.length} usable source(s). Fastest:\n    ${winners[0].url}`);
  console.log(`    petrol ${winners[0].petrol_price} · diesel ${winners[0].diesel_price}\n`);
})();
