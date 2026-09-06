'use strict';
/** MotoKE - finance engine unit tests (no server needed). node tools/finance-test.js */
const fin = require('../lib/finance');

let pass = 0;
let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) {
    pass++;
    console.log(`  \x1b[32mPASS\x1b[0m ${name}`);
  } else {
    fail++;
    console.log(`  \x1b[31mFAIL\x1b[0m ${name}${extra !== undefined ? ' -> ' + JSON.stringify(extra) : ''}`);
  }
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const plainLender = (over = {}) => ({
  id: 99,
  name: 'Test Lender',
  type: 'bank',
  rate_type: 'reducing',
  annual_rate: 12,
  min_deposit_pct: 0,
  min_tenor_months: 1,
  max_tenor_months: 120,
  min_loan: 0,
  max_loan: 1e12,
  min_monthly_income: 0,
  max_dti_pct: 100,
  max_vehicle_age_years: 0,
  processing_fee_pct: 0,
  processing_fee_min: 0,
  processing_fee_max: 0,
  valuation_fee: 0,
  tracking_fee: 0,
  legal_fee: 0,
  insurance_rate_pct: 0,
  insurance_financed: 0,
  capitalize_fees: 0,
  allowed_employment: '[]',
  allowed_conditions: '[]',
  requires_clean_crb: 0,
  bank_statement_months: 0,
  min_age: 0,
  max_age_at_maturity: 200,
  approval_days: 1,
  logbook_holder: 'lender',
  requirements: '[]',
  ...over,
});

console.log('\n\x1b[1mMotoKE finance engine\x1b[0m\n');

console.log('· amortisation');
// Textbook check: 1,000,000 at 12% p.a. reducing over 12 months = 88,848.79/month
ok('reducing instalment matches the textbook figure', near(fin.pmtReducing(1_000_000, 12, 12), 88848.79, 0.01), fin.pmtReducing(1_000_000, 12, 12));
ok('zero-rate loan is principal / months', fin.pmtReducing(1_200_000, 0, 24) === 50000);
// Flat: 1,000,000 at 10% flat for 24 months -> interest 200,000, total 1,200,000, 50,000/month
ok('flat instalment adds simple interest', near(fin.pmtFlat(1_000_000, 10, 24), 50000, 0.01), fin.pmtFlat(1_000_000, 10, 24));

const sch = fin.schedule(1_000_000, 12, 12, 'reducing');
ok('schedule length equals tenor', sch.length === 12);
ok('schedule closes at zero balance', sch[11].balance === 0, sch[11]);
const principalSum = sch.reduce((s, r) => s + r.principal, 0);
ok('principal repayments sum to the loan', near(principalSum, 1_000_000, 2), principalSum);
const interestSum = sch.reduce((s, r) => s + r.interest, 0);
ok('interest matches total repaid less principal', near(interestSum, 88848.79 * 12 - 1_000_000, 5), interestSum);

console.log('\n· APR');
// With no fees, the effective APR of a reducing loan is its nominal rate.
const clean = fin.quote(plainLender(), { price: 1_000_000, deposit: 0, tenorMonths: 36, applicant: {} });
ok('no-fee reducing APR equals the headline rate', near(clean.apr, 12, 0.05), clean.apr);
ok('no-fee APR is not the runaway 1200% bound', clean.apr < 100, clean.apr);

// Upfront fees push the true cost above the headline rate.
const withFees = fin.quote(plainLender({ processing_fee_pct: 3, valuation_fee: 10000 }), {
  price: 1_000_000,
  deposit: 0,
  tenorMonths: 36,
  applicant: {},
});
ok('upfront fees raise the APR above the headline', withFees.apr > 12 && withFees.apr < 30, withFees.apr);

// A flat rate always costs far more than the same headline reducing rate.
const flat = fin.quote(plainLender({ rate_type: 'flat', annual_rate: 12 }), { price: 1_000_000, deposit: 0, tenorMonths: 36, applicant: {} });
ok('flat 12% costs roughly double a reducing 12%', flat.apr > 20 && flat.apr < 26, flat.apr);
ok('flat instalment exceeds the reducing one', flat.monthlyPayment > clean.monthlyPayment, { flat: flat.monthlyPayment, reducing: clean.monthlyPayment });

console.log('\n· totals');
const q = fin.quote(plainLender({ processing_fee_pct: 2, valuation_fee: 7500, insurance_rate_pct: 4, min_deposit_pct: 20 }), {
  price: 2_000_000,
  deposit: 500_000,
  tenorMonths: 48,
  applicant: { netIncome: 200_000, obligations: 20_000 },
});
ok('deposit honoured when above the lender floor', q.deposit === 500_000, q.deposit);
ok('loan base = price - deposit', q.loanBase === 1_500_000, q.loanBase);
ok('fees itemised', q.fees.length === 2, q.fees);
/* Cash on day one is deposit + unfinanced fees + the conditions the lender imposes.
   The tracker and the NTSA in-charge registration are compulsory and the borrower pays
   them at signing, so a figure that leaves them out sends someone to the branch short. */
ok('cash upfront = deposit + unfinanced fees + lender conditions',
  q.cashUpfront === q.deposit + q.upfrontFees + q.lenderConditions.total,
  { cashUpfront: q.cashUpfront, deposit: q.deposit, upfront: q.upfrontFees, conditions: q.lenderConditions.total });
ok('the tracker and in-charge fee are itemised, not buried',
  q.lenderConditions.trackerFitting > 0 && q.lenderConditions.inchargeFee > 0, q.lenderConditions);
ok('and the quote says who requires them', /lender requires/i.test(q.lenderConditions.note));
ok('total cost = cash upfront + all instalments', near(q.totalCost, q.cashUpfront + q.monthlyPayment * q.tenorMonths, q.tenorMonths), q.totalCost);
ok('DTI computed', near(q.dti, ((q.monthlyPayment + 20000) / 200000) * 100, 0.2), q.dti);

console.log('\n· deposit floor');
const low = fin.quote(plainLender({ min_deposit_pct: 30 }), { price: 2_000_000, deposit: 200_000, tenorMonths: 48, applicant: {} });
ok('quotes at the lender floor when the deposit is short', low.deposit === 600_000, low.deposit);
ok('shortfall reported', low.depositShortfall === 400_000, low.depositShortfall);
ok('shortfall raised as a warning, not a blocker', low.warnings.length > 0 && low.eligible, { warnings: low.warnings, blockers: low.blockers });

console.log('\n· eligibility gates');
const gate = (over, applicant, vehicle) =>
  fin.quote(plainLender(over), { price: 2_000_000, deposit: 600_000, tenorMonths: 48, applicant, vehicle });

ok('income floor blocks', !gate({ min_monthly_income: 100_000 }, { netIncome: 50_000 }).eligible);
ok('DTI ceiling blocks', !gate({ max_dti_pct: 20 }, { netIncome: 100_000, obligations: 10_000 }).eligible);
ok('vehicle age blocks', !gate({ max_vehicle_age_years: 5 }, {}, { year: new Date().getFullYear() - 12 }).eligible);
ok('vehicle age passes inside the limit', gate({ max_vehicle_age_years: 15 }, {}, { year: new Date().getFullYear() - 12 }).eligible);
ok('employment type blocks', !gate({ allowed_employment: '["employed"]' }, { employment: 'gig' }).eligible);
ok('CRB requirement blocks', !gate({ requires_clean_crb: 1 }, { crbClean: false }).eligible);
ok('CRB requirement ignored when the lender does not care', gate({ requires_clean_crb: 0 }, { crbClean: false }).eligible);
ok('tenor above the cap blocks', !fin.quote(plainLender({ max_tenor_months: 24 }), { price: 2_000_000, deposit: 600_000, tenorMonths: 48, applicant: {} }).eligible);
ok('facility minimum blocks a small loan', !fin.quote(plainLender({ min_loan: 3_000_000 }), { price: 2_000_000, deposit: 600_000, tenorMonths: 48, applicant: {} }).eligible);
ok('age at maturity blocks', !gate({ max_age_at_maturity: 60 }, { age: 59 }).eligible);
ok('condition restriction blocks', !gate({ allowed_conditions: '["new"]' }, {}, { year: 2020, condition: 'used' }).eligible);
ok('a clean profile passes every gate', gate({}, { netIncome: 300_000, obligations: 10_000, employment: 'employed', crbClean: true, age: 35 }, { year: 2020, condition: 'used' }).eligible);

console.log('\n· affordability');
const aff = fin.quote(plainLender({ max_dti_pct: 50, min_deposit_pct: 20 }), {
  price: 2_000_000,
  deposit: 400_000,
  tenorMonths: 60,
  applicant: { netIncome: 100_000, obligations: 10_000 },
});
ok('max affordable price returned', aff.maxAffordablePrice > 0, aff.maxAffordablePrice);
// at 50% DTI on 100k with 10k obligations, the ceiling instalment is 40k
const impliedPrincipal = fin.pmtReducing(1, 12, 60);
ok('affordable price is consistent with a 40k instalment', near(aff.maxAffordablePrice, 40000 / impliedPrincipal / 0.8, 5000), aff.maxAffordablePrice);

console.log('\n· comparison');
const panel = [
  plainLender({ id: 1, name: 'Cheap Slow', annual_rate: 11, approval_days: 14 }),
  plainLender({ id: 2, name: 'Dear Fast', annual_rate: 19, approval_days: 1 }),
  plainLender({ id: 3, name: 'Blocked', annual_rate: 9, min_monthly_income: 999_999 }),
];
const cmp = fin.compare(panel, { price: 2_000_000, deposit: 500_000, tenorMonths: 48, applicant: { netIncome: 200_000, obligations: 10_000 } });
ok('all lenders quoted', cmp.total === 3);
ok('eligible count excludes the blocked lender', cmp.eligibleCount === 2, cmp.eligibleCount);
ok('eligible offers come first', cmp.offers[0].eligible && !cmp.offers[2].eligible);
ok('cheapest monthly wins the default sort', cmp.offers[0].lender.name === 'Cheap Slow', cmp.offers[0].lender.name);
ok('lowest-monthly badge on the winner', (cmp.offers[0].badges || []).includes('Lowest monthly'), cmp.offers[0].badges);
ok('fastest-approval badge on the quick lender', (cmp.offers.find((o) => o.lender.name === 'Dear Fast').badges || []).includes('Fastest approval'));
const bySpeed = fin.compare(panel, { price: 2_000_000, deposit: 500_000, tenorMonths: 48, applicant: { netIncome: 200_000, obligations: 10_000 } }, 'speed');
ok('sorting by speed reorders', bySpeed.offers[0].lender.name === 'Dear Fast', bySpeed.offers[0].lender.name);

console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m\n`);
process.exit(fail ? 1 : 0);
