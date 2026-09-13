'use strict';
/**
 * MotoKE — real quotes from a real panel of insurers, and the commission they generate.
 *
 * lib/ownership.js estimates what insurance costs so a buyer can budget. This is the other
 * thing: an actual price from an actual insurer that a buyer can accept, and a record of
 * the policy that follows. "From about KES 80,000" is a guess. "Jubilee, KES 78,400,
 * accept" is a sale.
 *
 * WHY THIS IS WORTH BUILDING. Every financed car must carry comprehensive cover before the
 * bank releases a shilling — lib/deal.js already refuses to let the car leave without it.
 * So the app is standing at the exact moment the customer is legally obliged to buy
 * insurance, holding the vehicle value, the buyer's details and the lender's requirement.
 * Nobody is better placed to place that policy, and the policy renews every year after.
 *
 * THREE RULES THE LAW SETS, and they are built in rather than left to whoever is typing:
 *
 *   1. COMMISSION ON MOTOR IS CAPPED AT 10% OF PREMIUM. The Eleventh Schedule of the
 *      Insurance Regulations, set in 1986 and still in force. An insurer offering more is
 *      offering something that is not commission, so the cap is enforced here and an
 *      attempt to store a higher rate is clamped rather than obeyed.
 *
 *   2. ONLY A LICENSED INTERMEDIARY MAY RECEIVE COMMISSION. Nothing in the code can fix
 *      that, but the commission figures are marked `accrued` rather than `earned` and the
 *      panel carries the platform's own licence number, so a screen that shows money never
 *      implies a right to it that does not exist.
 *
 *   3. AN INTERMEDIARY MUST NOT RECEIVE PREMIUM ON BEHALF OF AN INSURER. Section 156(2) —
 *      the penalty is 20% of the unremitted premium and a criminal offence for a director.
 *      THIS APPLICATION THEREFORE NEVER TAKES PREMIUM MONEY. It quotes, it records, it
 *      hands the buyer straight to the insurer. There is no premium field in the payment
 *      code and there must never be one. If a future version needs to collect premium, it
 *      needs a licence that permits it first, not a new endpoint.
 */

/** The legal ceiling on motor commission, as a percentage of premium. */
const COMMISSION_CAP_PCT = 10;

/** What a Kenyan motor policy actually carries, beyond the base cover. */
const ADDONS = [
  {
    key: 'excess',
    label: 'Excess protector',
    note: 'Waives the excess you would otherwise pay out of pocket on a claim.',
    pct: 0.25,
    min: 5000,
  },
  {
    key: 'pvt',
    label: 'Political violence & terrorism',
    note: 'Riot, strike and civil commotion. Excluded from the base policy as standard in Kenya.',
    pct: 0.25,
    min: 4000,
  },
  {
    key: 'courtesy',
    label: 'Courtesy car',
    note: 'A replacement car while yours is in the garage.',
    flat: 6000,
  },
  {
    key: 'aa',
    label: 'AA membership and towing',
    note: 'Roadside rescue and recovery anywhere in Kenya.',
    flat: 5500,
  },
];

const round = (n) => Math.round(Number(n) || 0);
const pct = (n) => Math.max(0, Number(n) || 0);

/**
 * How much a year's cover costs with one insurer.
 *
 * Everything is derived from the insurer's own published numbers on their row, never from
 * a global assumption — the whole point of a panel is that two insurers disagree, and a
 * quote engine that averages them away has nothing to sell.
 */
function quote(insurer, input = {}) {
  const value = Math.max(0, Number(input.value) || 0);
  const age = Math.max(0, Number(input.ageYears) || 0);
  const cover = input.cover === 'third_party' ? 'third_party' : 'comprehensive';
  const claimFree = Math.max(0, Math.min(5, Number(input.claimFreeYears) || 0));

  const refusal = declineReason(insurer, { value, age, cover });
  if (refusal) {
    return {
      insurerId: insurer.id,
      insurer: insurer.name,
      shortName: insurer.short_name || insurer.name,
      color: insurer.color || null,
      eligible: false,
      reason: refusal,
    };
  }

  if (cover === 'third_party') {
    const premium = round(insurer.third_party_premium || 0);
    return shape(insurer, {
      cover,
      value,
      base: premium,
      loading: 0,
      discount: 0,
      addons: [],
      addonTotal: 0,
      premium,
      rateUsed: null,
      claimFree: 0,
    });
  }

  /* Base rate, then the age loading. An older car is a bigger risk per shilling insured
     and every Kenyan insurer prices it, but they disagree about how much - which is
     exactly why the loading lives on the insurer's row. */
  const baseRate = pct(insurer.comprehensive_rate);
  const loadRate = age > pct(insurer.age_loading_from_years)
    ? pct(insurer.age_loading_pct) * (age - pct(insurer.age_loading_from_years))
    : 0;
  const effective = baseRate + loadRate;

  const gross = (value * effective) / 100;
  const base = Math.max(pct(insurer.min_premium), gross);
  const loading = base - Math.max(pct(insurer.min_premium), (value * baseRate) / 100);

  /* No-claims discount, capped by the insurer's own maximum. A buyer switching insurers
     carries their record with them; that is the whole reason to ask. */
  const ncdRate = Math.min(pct(insurer.ncd_pct_per_year) * claimFree, pct(insurer.ncd_max_pct));
  const discount = (base * ncdRate) / 100;

  const chosen = input.addons || {};
  const addons = ADDONS.map((a) => ({
    key: a.key,
    label: a.label,
    note: a.note,
    amount: round(a.flat != null ? a.flat : Math.max(a.min, (value * a.pct) / 100)),
    selected: !!chosen[a.key],
  }));
  const addonTotal = addons.filter((a) => a.selected).reduce((n, a) => n + a.amount, 0);

  const premium = round(base - discount + addonTotal);
  return shape(insurer, {
    cover,
    value,
    base: round(base),
    loading: round(loading),
    discount: round(discount),
    ncdRate,
    addons,
    addonTotal: round(addonTotal),
    premium,
    rateUsed: Math.round(effective * 100) / 100,
    claimFree,
  });
}

function shape(insurer, q) {
  const commissionPct = commissionRate(insurer);
  return {
    insurerId: insurer.id,
    insurer: insurer.name,
    shortName: insurer.short_name || insurer.name,
    color: insurer.color || null,
    eligible: true,
    cover: q.cover,
    coverLabel: q.cover === 'comprehensive' ? 'Comprehensive' : 'Third party only',
    sumInsured: q.value,
    basePremium: q.base,
    ageLoading: q.loading,
    noClaimsDiscount: q.discount,
    noClaimsPct: q.ncdRate || 0,
    addons: q.addons,
    addonTotal: q.addonTotal,
    premium: q.premium,
    monthly: round(q.premium / 12),
    ratePct: q.rateUsed,
    excess: excessFor(insurer, q.value),
    /* What the platform stands to be paid if this quote becomes a policy. Never shown to
       the buyer - it is between the intermediary and the insurer, and a customer reading
       a commission line beside a price reasonably asks whether the price was chosen for
       the commission. */
    commissionPct,
    commission: round((q.premium * commissionPct) / 100),
    settlesWith: 'The premium is paid to ' + insurer.name + ' directly. MotoKE never handles premium money.',
    highlights: safeList(insurer.highlights),
    excludes: safeList(insurer.excludes),
    claimDays: Number(insurer.claim_days) || null,
    garages: Number(insurer.approved_garages) || null,
  };
}

/** Why this insurer will not write this risk, or null if they will. */
function declineReason(insurer, { value, age, cover }) {
  if (!insurer || !insurer.active) return 'Not currently writing new business.';
  if (cover === 'third_party') {
    return pct(insurer.third_party_premium) > 0 ? null : 'Does not sell third-party-only cover.';
  }
  const maxAge = Number(insurer.max_vehicle_age_years) || 0;
  if (maxAge && age > maxAge) return `Will not write comprehensive cover on a car over ${maxAge} years old.`;
  const minValue = Number(insurer.min_sum_insured) || 0;
  if (minValue && value < minValue) return `Minimum sum insured is KES ${minValue.toLocaleString('en-KE')}.`;
  const maxValue = Number(insurer.max_sum_insured) || 0;
  if (maxValue && value > maxValue) return `Will not insure a vehicle worth more than KES ${maxValue.toLocaleString('en-KE')}.`;
  return null;
}

/** The excess: what the owner pays themselves before the insurer pays anything. */
function excessFor(insurer, value) {
  const p = pct(insurer.excess_pct);
  const min = pct(insurer.excess_min);
  if (!p && !min) return null;
  return round(Math.max(min, (value * p) / 100));
}

/**
 * The commission rate this insurer pays, clamped to what the law allows.
 *
 * Clamped rather than rejected on purpose. A number typed into an admin form at half past
 * six should not be able to put the platform outside the Eleventh Schedule, and quietly
 * refusing the row would leave the insurer looking broken. It takes the legal maximum and
 * says so.
 */
function commissionRate(insurer) {
  const asked = pct(insurer && insurer.commission_pct);
  return Math.min(asked, COMMISSION_CAP_PCT);
}

/** Every insurer's answer to the same question, cheapest eligible first. */
function panel(insurers, input = {}) {
  const quotes = (insurers || []).map((i) => quote(i, input));
  const yes = quotes.filter((q) => q.eligible).sort((a, b) => a.premium - b.premium);
  const no = quotes.filter((q) => !q.eligible);
  return {
    cover: input.cover === 'third_party' ? 'third_party' : 'comprehensive',
    sumInsured: Math.max(0, Number(input.value) || 0),
    quotes: yes,
    declined: no,
    cheapest: yes[0] || null,
    /* The spread, because it is the argument for using the panel at all. Two insurers on
       the same car routinely differ by a third. */
    spread: yes.length > 1 ? yes[yes.length - 1].premium - yes[0].premium : 0,
  };
}

/* ------------------------------------------------------------------ */
/* policies and what they are worth                                    */
/* ------------------------------------------------------------------ */

/** A year from the start date, less a day, which is how a motor policy runs. */
function expiryFor(startISO) {
  const d = new Date(String(startISO || '').replace(' ', 'T'));
  if (isNaN(d)) return null;
  const out = new Date(d);
  out.setFullYear(out.getFullYear() + 1);
  out.setDate(out.getDate() - 1);
  return out.toISOString().slice(0, 10);
}

const DAY = 864e5;

/**
 * What is owed, what is running, and what is about to renew.
 *
 * RENEWALS ARE THE WHOLE BUSINESS. A policy placed once pays once; a policy renewed for
 * six years pays six times for one introduction. The only way that happens is if somebody
 * rings the customer before it lapses, and the only way anybody rings is if a screen tells
 * them who and when. That is what `renewals` is for.
 */
function bookFor(policies, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  const within = Number(opts.withinDays) || 60;
  const live = [];
  const renewals = [];
  let accrued = 0;
  let annualised = 0;

  for (const p of policies || []) {
    const active = p.status === 'active';
    if (active) {
      live.push(p);
      annualised += Number(p.commission) || 0;
    }
    if (p.status === 'active' || p.status === 'accepted') accrued += Number(p.commission) || 0;

    if (!active || !p.expiry) continue;
    const daysLeft = Math.ceil((new Date(p.expiry).getTime() - now.getTime()) / DAY);
    if (daysLeft <= within) {
      renewals.push({
        id: p.id,
        policyNo: p.policy_no,
        customer: p.customer_name,
        phone: p.customer_phone,
        insurer: p.insurer_name,
        vehicle: p.vehicle_title,
        premium: p.premium,
        commission: p.commission,
        expiry: p.expiry,
        daysLeft,
        /* Lapsed is worse than late. A financed car with no cover breaks the loan
           agreement and breaks the law, so an expired row stays on the list shouting
           rather than dropping off it. */
        lapsed: daysLeft < 0,
      });
    }
  }

  renewals.sort((a, b) => a.daysLeft - b.daysLeft);
  return {
    liveCount: live.length,
    accrued: round(accrued),
    annualised: round(annualised),
    renewals,
    renewalValue: round(renewals.reduce((n, r) => n + (Number(r.commission) || 0), 0)),
  };
}

function safeList(s) {
  if (Array.isArray(s)) return s;
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

module.exports = {
  quote,
  panel,
  bookFor,
  expiryFor,
  commissionRate,
  declineReason,
  excessFor,
  COMMISSION_CAP_PCT,
  ADDONS,
};
