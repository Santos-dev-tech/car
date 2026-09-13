'use strict';
/**
 * MotoKE — the insurance panel, the quotes, and the commission. No server.
 *
 *   node --no-warnings tools/insurance-test.js
 *
 * The thing being guarded here is a legal ceiling, not a business rule. Motor commission
 * is capped at 10% of premium by the Eleventh Schedule of the Insurance Regulations, and a
 * number typed into an admin form must not be able to put anyone outside it. So the cap is
 * tested from both directions: a sensible rate is honoured, and a greedy one is clamped.
 *
 * The rest is the quote engine. Two insurers disagreeing about the same car is the entire
 * reason a panel exists, so a test that let them agree would be testing nothing.
 */
const ins = require('../lib/insurance');

let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok    ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); }
};

/* ---------- fixtures: a cheap strict insurer and a dear generous one ---------- */
const strict = {
  id: 1, name: 'Tumaini Insurance', short_name: 'Tumaini', active: 1,
  comprehensive_rate: 3.5, min_premium: 35000, third_party_premium: 8200,
  age_loading_from_years: 5, age_loading_pct: 0.3,
  ncd_pct_per_year: 10, ncd_max_pct: 25,
  excess_pct: 3, excess_min: 25000,
  max_vehicle_age_years: 10, min_sum_insured: 800000,
  commission_pct: 10, claim_days: 10,
};
const generous = {
  id: 2, name: 'Harambee General', short_name: 'Harambee', active: 1,
  comprehensive_rate: 4.25, min_premium: 25000, third_party_premium: 7500,
  age_loading_from_years: 6, age_loading_pct: 0.2,
  ncd_pct_per_year: 12.5, ncd_max_pct: 40,
  excess_pct: 2.5, excess_min: 15000,
  max_vehicle_age_years: 18,
  commission_pct: 10, claim_days: 21,
};

/* ---------- the cap ---------- */
console.log('\n— commission is capped by law, not by the form —');
ok('10% is honoured', ins.commissionRate({ commission_pct: 10 }) === 10);
ok('7.5% is honoured', ins.commissionRate({ commission_pct: 7.5 }) === 7.5);
ok('15% is clamped to 10', ins.commissionRate({ commission_pct: 15 }) === 10, ins.commissionRate({ commission_pct: 15 }));
ok('so is 100', ins.commissionRate({ commission_pct: 100 }) === 10);
ok('a negative rate is nothing, not a rebate', ins.commissionRate({ commission_pct: -5 }) === 0);
ok('a missing rate is nothing', ins.commissionRate({}) === 0);
ok('the cap is stated, not hidden in a branch', ins.COMMISSION_CAP_PCT === 10);
{
  const greedy = { ...generous, commission_pct: 25 };
  const q = ins.quote(greedy, { value: 2_000_000, ageYears: 3 });
  ok('a quote from a greedy row still pays at the cap', q.commissionPct === 10, q.commissionPct);
  ok('and the money matches the capped rate', q.commission === Math.round(q.premium * 0.1), [q.commission, q.premium]);
}

/* ---------- the arithmetic ---------- */
console.log('\n— what a year costs —');
{
  const q = ins.quote(generous, { value: 2_000_000, ageYears: 3 });
  ok('rate times value', q.basePremium === 85_000, q.basePremium);
  ok('no age loading on a young car', q.ageLoading === 0);
  ok('no discount without a clean record', q.noClaimsDiscount === 0);
  ok('premium is the base when nothing is added', q.premium === 85_000, q.premium);
  ok('and a monthly figure comes with it', q.monthly === Math.round(85_000 / 12));
}
{
  const cheap = ins.quote(generous, { value: 300_000, ageYears: 2 });
  ok('a cheap car pays the minimum premium, not the rate',
    cheap.premium === 25_000, [cheap.basePremium, cheap.premium]);
}
{
  const old = ins.quote(generous, { value: 2_000_000, ageYears: 10 });
  ok('an old car is loaded', old.ratePct > 4.25, old.ratePct);
  ok('by the insurer\'s own step, per year over their threshold',
    old.ratePct === 4.25 + 0.2 * 4, old.ratePct);
  ok('and the loading is shown separately, not buried in the price', old.ageLoading > 0, old.ageLoading);
}

console.log('\n— a clean record is worth money —');
{
  const none = ins.quote(generous, { value: 2_000_000, ageYears: 3, claimFreeYears: 0 });
  const two = ins.quote(generous, { value: 2_000_000, ageYears: 3, claimFreeYears: 2 });
  const many = ins.quote(generous, { value: 2_000_000, ageYears: 3, claimFreeYears: 5 });
  ok('two clean years earns 25%', two.noClaimsPct === 25, two.noClaimsPct);
  ok('and takes it off the premium', two.premium < none.premium);
  ok('five clean years hits the insurer\'s ceiling', many.noClaimsPct === 40, many.noClaimsPct);
  ok('which is their number, not a global one',
    ins.quote(strict, { value: 2_000_000, ageYears: 3, claimFreeYears: 5 }).noClaimsPct === 25);
}

console.log('\n— the extras —');
{
  const bare = ins.quote(generous, { value: 2_000_000, ageYears: 3 });
  const loaded = ins.quote(generous, { value: 2_000_000, ageYears: 3, addons: { excess: true, pvt: true, aa: true } });
  ok('three extras cost more than none', loaded.premium > bare.premium);
  ok('and the total is itemised', loaded.addonTotal > 0 && loaded.addonTotal === loaded.premium - bare.premium,
    [loaded.addonTotal, loaded.premium - bare.premium]);
  ok('every extra is listed whether chosen or not', loaded.addons.length === ins.ADDONS.length);
  ok('with only the chosen ones marked',
    loaded.addons.filter((a) => a.selected).length === 3, loaded.addons.map((a) => [a.key, a.selected]));
  ok('political violence is on the list, because Kenyan policies exclude it as standard',
    loaded.addons.some((a) => a.key === 'pvt'));
}

/* ---------- who will not write it ---------- */
console.log('\n— an insurer is allowed to say no —');
{
  const tooOld = ins.quote(strict, { value: 2_000_000, ageYears: 12 });
  ok('a 12-year-old car is refused by the strict insurer', tooOld.eligible === false);
  ok('and the reason is in plain words', /over 10 years old/.test(tooOld.reason), tooOld.reason);
  ok('the generous one takes it', ins.quote(generous, { value: 2_000_000, ageYears: 12 }).eligible === true);

  const tooCheap = ins.quote(strict, { value: 400_000, ageYears: 2 });
  ok('and a car under their floor is refused too', tooCheap.eligible === false, tooCheap.reason);

  const off = ins.quote({ ...generous, active: 0 }, { value: 2_000_000, ageYears: 3 });
  ok('an insurer switched off quotes nothing', off.eligible === false);
}

console.log('\n— third party is the legal minimum and priced flat —');
{
  const tp = ins.quote(generous, { value: 5_000_000, ageYears: 3, cover: 'third_party' });
  ok('it ignores the value of the car', tp.premium === 7500, tp.premium);
  ok('it is labelled for what it is', tp.coverLabel === 'Third party only');
  const none = ins.quote({ ...generous, third_party_premium: 0 }, { value: 2_000_000, cover: 'third_party' });
  ok('an insurer with no third-party product says so', none.eligible === false, none.reason);
}

/* ---------- the panel ---------- */
console.log('\n— the panel only earns its keep if they disagree —');
{
  const p = ins.panel([strict, generous], { value: 2_000_000, ageYears: 3 });
  ok('both quote', p.quotes.length === 2);
  ok('cheapest first', p.quotes[0].premium <= p.quotes[1].premium, p.quotes.map((q) => q.premium));
  ok('and the cheapest is named', p.cheapest.insurerId === p.quotes[0].insurerId);
  ok('the spread is reported, because it is the argument for comparing',
    p.spread === p.quotes[1].premium - p.quotes[0].premium, p.spread);
  ok('and it is not zero on this car', p.spread > 0, p.spread);

  const old = ins.panel([strict, generous], { value: 2_000_000, ageYears: 12 });
  ok('a refusal is separated from a price', old.quotes.length === 1 && old.declined.length === 1);
  ok('the one who will write it is still offered', old.quotes[0].insurer === 'Harambee General');
}

/* ---------- policies, and the renewals that are the actual business ---------- */
console.log('\n— a policy runs a year less a day —');
ok('from the first of January', ins.expiryFor('2026-01-01') === '2026-12-31', ins.expiryFor('2026-01-01'));
ok('and across a year boundary', ins.expiryFor('2026-09-13') === '2027-09-12', ins.expiryFor('2026-09-13'));
ok('rubbish in gives null', ins.expiryFor('not a date') === null);

console.log('\n— the renewal list is the whole point —');
{
  const now = new Date('2026-09-13T00:00:00Z');
  const day = (n) => new Date(now.getTime() + n * 864e5).toISOString().slice(0, 10);
  const policies = [
    { id: 1, status: 'active', expiry: day(200), commission: 8000, customer_name: 'Far Away' },
    { id: 2, status: 'active', expiry: day(30), commission: 9000, customer_name: 'Soon' },
    { id: 3, status: 'active', expiry: day(5), commission: 7000, customer_name: 'Very Soon' },
    { id: 4, status: 'active', expiry: day(-9), commission: 6000, customer_name: 'Already Lapsed' },
    { id: 5, status: 'requested', expiry: null, commission: 5000, customer_name: 'Not On Risk' },
    { id: 6, status: 'cancelled', expiry: day(10), commission: 4000, customer_name: 'Gone' },
  ];
  const b = ins.bookFor(policies, { now, withinDays: 60 });

  ok('only live policies are counted as live', b.liveCount === 4, b.liveCount);
  ok('a cancelled policy earns nothing', !JSON.stringify(b.renewals).includes('Gone'));
  /* A requested policy is money nobody has agreed to yet. Counting it would put a figure
     on the screen that an insurer can still refuse, which is the fastest way to make every
     other figure on the page untrustworthy. */
  ok('a policy nobody has accepted yet earns nothing',
    b.accrued === 8000 + 9000 + 7000 + 6000, b.accrued);
  ok('three are due inside 60 days, the lapsed one among them',
    b.renewals.length === 3, b.renewals.map((r) => r.customer));
  ok('the far-off one is not chased yet', !b.renewals.some((r) => r.customer === 'Far Away'));
  ok('the most urgent is first', b.renewals[0].customer === 'Already Lapsed', b.renewals.map((r) => r.daysLeft));
  ok('a lapsed policy is flagged rather than dropped', b.renewals[0].lapsed === true);
  ok('because a financed car with no cover breaks the loan and the law',
    b.renewals[0].daysLeft < 0);
  ok('and the money at stake is added up', b.renewalValue === 9000 + 7000 + 6000, b.renewalValue);
}

/* ---------- what a customer must never be shown ---------- */
console.log('\n— commission belongs between us and the insurer —');
{
  const q = ins.quote(generous, { value: 2_000_000, ageYears: 3 });
  ok('the quote does carry it, for our own screens', typeof q.commission === 'number');
  ok('and it says plainly who holds the premium', /never handles premium/i.test(q.settlesWith), q.settlesWith);
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail);
