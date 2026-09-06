'use strict';
/**
 * MotoKE — is this car fairly priced?
 *
 * Auto Trader answers this for every advert in the UK with a Great/Good/Fair badge and the
 * exact money difference from their valuation. Nobody in the Kenyan market answers it at
 * all, and it is the first question every buyer asks.
 *
 * The method: find genuinely comparable cars in the yard, adjust each for the ways it
 * differs from the one being priced (age, mileage, condition, how well the badge holds
 * value), take the median, and compare. The median rather than the mean, because one
 * mispriced Land Cruiser should not drag the whole comparison.
 *
 * WHAT THIS IS NOT: a valuation. It compares one dealership's stock against itself, so it
 * says "this is priced below similar cars we hold", not "this is below market". The wording
 * on the page has to stay inside what the data can actually support, and `basis` carries
 * the sample size so the page can refuse to show a badge built on two cars.
 */

const market = require('./market');

/** Bands, widest first. The gap either side of "Good" is deliberately narrow. */
const BANDS = [
  { key: 'low', label: 'Low price', max: -0.12, tone: 'ok', blurb: 'Priced well below similar stock — worth asking why.' },
  { key: 'great', label: 'Great price', max: -0.05, tone: 'ok', blurb: 'Cheaper than the comparable cars in this yard.' },
  { key: 'good', label: 'Good price', max: 0.03, tone: 'ok', blurb: 'In line with comparable cars in this yard.' },
  { key: 'fair', label: 'Fair price', max: 0.1, tone: '', blurb: 'A little above comparable cars, often for a reason.' },
  { key: 'high', label: 'Above the rest', max: Infinity, tone: 'warn', blurb: 'Priced above comparable cars in this yard.' },
];

const MIN_SAMPLE = 4; // below this, any median is noise

/* Beyond this gap, the comparison itself is the thing that is wrong. 35% is wide enough
   to catch a genuinely keen price and narrow enough to reject a nonsense pairing. */
const MAX_CREDIBLE_GAP = 0.35;

/**
 * Comparable means: same body type, and either the same make or a price within half an
 * order of magnitude. A Vitz does not price a Prado, and a Prado does not price a Vitz.
 */
function isComparable(subject, other) {
  if (other.id === subject.id) return false;
  if (!other.price || !subject.price) return false;
  if (other.body_type !== subject.body_type) return false;
  const ratio = other.price / subject.price;
  if (ratio < 0.45 || ratio > 2.2) return false;
  const yearGap = Math.abs((Number(other.year) || 0) - (Number(subject.year) || 0));
  return yearGap <= 6;
}

/** Normalise a comparable to the subject's age, mileage and condition. */
function adjust(comp, subject) {
  let price = Number(comp.price);

  /* Age. Depreciation per year comes from the same retention curve the running-cost
     screen uses, so the two never disagree with each other on the same car. */
  const yearGap = (Number(subject.year) || 0) - (Number(comp.year) || 0);
  if (yearGap) {
    const retention = market.RETENTION[comp.make] || 0.86;
    price *= Math.pow(retention, -yearGap);
  }

  /* Mileage. Roughly 1.2% of value per 10,000 km of difference, capped so an outlier
     with 300,000 km cannot swing the median on its own. */
  const kmGap = (Number(comp.mileage_km) || 0) - (Number(subject.mileage_km) || 0);
  const kmAdj = Math.max(-0.18, Math.min(0.18, (kmGap / 10000) * 0.012));
  price *= 1 + kmAdj;

  /* Condition. A locally used car and a fresh import are not the same product. */
  const CONDITION = { new: 1.12, foreign_used: 1.0, used: 0.94 };
  const from = CONDITION[comp.condition] || 1;
  const to = CONDITION[subject.condition] || 1;
  price *= to / from;

  return price;
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Price one vehicle against a pool of others.
 *
 * @param subject the vehicle being looked at
 * @param pool    every other vehicle to compare against
 * @returns null when there is not enough to say anything honest
 */
function priceIndicator(subject, pool) {
  if (!subject || !subject.price) return null;

  const comparables = (pool || []).filter((v) => isComparable(subject, v));
  if (comparables.length < MIN_SAMPLE) {
    return {
      enough: false,
      sample: comparables.length,
      minSample: MIN_SAMPLE,
      note: 'Not enough similar cars in stock to compare this one fairly.',
    };
  }

  const adjusted = comparables.map((c) => adjust(c, subject));
  const typical = median(adjusted);
  const delta = subject.price - typical;
  const ratio = delta / typical;

  /* An extreme reading is not a bargain, it is a bad comparison.
     Body type, price band and year are enough to separate a Vitz from a Prado, but not a
     79 Series Land Cruiser from a Hilux — both Pickups, both Toyotas, entirely different
     vehicles. When the gap gets this wide the honest conclusion is that the model is out
     of its depth on this car, not that the yard has mispriced it by half. Saying nothing
     beats sending a dealership to cut a price by 91%. */
  if (Math.abs(ratio) > MAX_CREDIBLE_GAP) {
    return {
      enough: false,
      sample: comparables.length,
      minSample: MIN_SAMPLE,
      outlier: true,
      note: 'This one is unusual enough that the cars we hold are not a fair comparison.',
    };
  }

  const band = BANDS.find((b) => ratio <= b.max) || BANDS[BANDS.length - 1];

  return {
    enough: true,
    band: band.key,
    label: band.label,
    tone: band.tone,
    blurb: band.blurb,
    typicalPrice: Math.round(typical / 1000) * 1000,
    difference: Math.round(Math.abs(delta) / 1000) * 1000,
    cheaper: delta < 0,
    percent: +(Math.abs(ratio) * 100).toFixed(1),
    sample: comparables.length,
    /* Said plainly so nobody reads this as a market valuation. It compares this
       dealership's own stock, and the sentence says so. */
    basis: `Compared with ${comparables.length} similar ${String(subject.body_type || 'vehicle').toLowerCase()}s in this yard, adjusted for year, mileage and condition.`,
  };
}

/**
 * A guaranteed-future-value figure, from the same retention curve the running-cost screen
 * already shows. Reported as a RANGE with a deliberately conservative floor: an offer to
 * buy a car back is a real commitment, and the number a dealership commits to should sit
 * below the projection, not on it.
 */
function futureValue(price, make, years = 3, currentAge = 0) {
  if (!price) return null;
  const projected = market.resale(price, make, years, currentAge);
  const floor = Math.round((projected.estimatedValue * 0.88) / 1000) * 1000;
  return {
    years,
    projected: projected.estimatedValue,
    guaranteedFloor: floor,
    percentOfToday: +((floor / price) * 100).toFixed(1),
    monthlyDepreciation: projected.lossPerMonth,
    strongHolder: projected.strongHolder,
    note: `A projection from how ${projected.make} holds value in Kenya, with a margin taken off. A dealership offering a buyback should quote at or below the floor.`,
  };
}

/**
 * Sell it to us today, or let us sell it for you.
 *
 * A trade-in is a WHOLESALE number — the least a seller can get, because the yard is
 * taking the risk, the money and the time. Consignment puts their car on the forecourt at
 * a retail price for a commission, and the seller usually nets far more.
 *
 * Both numbers are shown together on purpose. A dealership that only quotes the trade-in
 * is quietly taking the difference, and a seller who finds that out later does not come
 * back. Showing the trade-off is the honest version and it wins the stock, which is the
 * thing a yard is actually short of.
 *
 * @param tradeIn   what we would pay today (the low end of the estimate)
 * @param retail    what comparable stock actually sells for
 * @param commission the yard's cut, as a fraction
 */
function consignment(tradeIn, retail, { commission = 0.07, prepCost = 25000, weeks = 3 } = {}) {
  if (!retail || retail <= 0) return null;

  const fee = Math.round(retail * commission);
  const netToSeller = Math.round(retail - fee - prepCost);
  const gain = netToSeller - (tradeIn || 0);

  return {
    retailPrice: Math.round(retail / 1000) * 1000,
    commissionPercent: +(commission * 100).toFixed(1),
    commissionFee: fee,
    prepCost,
    netToSeller,
    tradeInNow: tradeIn || 0,
    gain,
    /* Only worth offering when it actually beats the cash offer by enough to be worth
       the wait. Below that the honest advice is to take the money. */
    worthIt: gain > Math.max(40000, (tradeIn || 0) * 0.06),
    typicalWeeks: weeks,
    summary:
      gain > 0
        ? `Selling it for you nets about ${netToSeller.toLocaleString()} — roughly ${gain.toLocaleString()} more than selling it to us today, in about ${weeks} weeks.`
        : `Our cash offer is the better deal on this car. Consignment would net about ${netToSeller.toLocaleString()} and take around ${weeks} weeks.`,
  };
}

module.exports = {
  priceIndicator, futureValue, consignment, isComparable, adjust, median,
  BANDS, MIN_SAMPLE, MAX_CREDIBLE_GAP,
};
