'use strict';
/**
 * MotoKE — monthly statements. No server.
 *
 *   node --no-warnings tools/statement-test.js
 *
 * The thing being guarded is the boundary. A statement for January must contain exactly
 * the deals funded in January — not the ones created then, not the ones still open, and
 * not the ones that changed afterwards. Every invoicing argument anybody has ever had is
 * about a line that should or should not be on the list, and the only defence is a rule
 * that a date decides rather than a status.
 */
const path = require('node:path');
const fs = require('node:fs');

const TMP = path.join(__dirname, '..', 'data', 'statement-test.db');
for (const suffix of ['', '-wal', '-shm']) fs.rmSync(TMP + suffix, { force: true });
process.env.MOTOKE_DB = TMP;

const { db, insert, run } = require('../lib/db');
const stmt = require('../lib/statement');

let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok    ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); }
};

/* ---------- fixtures ---------- */
const dealerId = insert('dealers', { slug: 'test-yard', name: 'Test Yard' });
const otherDealer = insert('dealers', { slug: 'other-yard', name: 'Other Yard' });
const bankA = insert('lenders', { name: 'Bank A', annual_rate: 0.15 });
const bankB = insert('lenders', { name: 'Bank B', annual_rate: 0.16 });
const insurerId = insert('insurers', { name: 'Test Assurance', commission_pct: 10, monthly_fee: 0 });

let n = 0;
function mkDeal({ price, loan, fundedAt, lender = bankA, dealer = dealerId, status = 'disbursed' }) {
  return insert('applications', {
    ref: 'MK-ST-' + String(++n).padStart(4, '0'),
    dealer_id: dealer,
    lender_id: lender,
    applicant: JSON.stringify({ fullName: 'Grace Njeri', phone: '+254722000111' }),
    employment: '{}',
    offer: '{}',
    vehicle_snapshot: JSON.stringify({ title: '2018 Toyota Harrier' }),
    price,
    loan_amount: loan,
    status,
    funded_at: fundedAt,
  });
}

/* ---------- the period ---------- */
console.log('\n— a month is a month —');
{
  const p = stmt.period('2026-01');
  ok('January starts on the first', p.from === '2026-01-01T00:00:00.000Z', p.from);
  ok('and ends where February begins', p.to === '2026-02-01T00:00:00.000Z', p.to);
  ok('it is labelled for a human', p.label === 'January 2026', p.label);
  ok('December rolls the year', stmt.period('2026-12').to === '2027-01-01T00:00:00.000Z');
  ok('February gets 28 days, not 30', stmt.period('2026-02').to === '2026-03-01T00:00:00.000Z');
  ok('rubbish falls back to this month rather than throwing',
    /^\d{4}-\d{2}$/.test(stmt.period('not a month').key), stmt.period('nonsense').key);
}

console.log('\n— the due date is a date, not the word "monthly" —');
ok('the 15th of the month after', stmt.dueDate(stmt.period('2026-01')) === '2026-02-15', stmt.dueDate(stmt.period('2026-01')));
ok('and it rolls the year too', stmt.dueDate(stmt.period('2026-12')) === '2027-01-15');

/* ---------- fee bands ---------- */
console.log('\n— a yard moving Vitzes cannot pay what one moving Land Cruisers pays —');
ok('a 900,000 car is the bottom band', stmt.bandFee(900_000) === 2_500);
ok('exactly 1.5M is still the bottom band', stmt.bandFee(1_500_000) === 2_500);
ok('1.5M and one shilling is the middle', stmt.bandFee(1_500_001) === 5_000);
ok('3.5M is the middle', stmt.bandFee(3_500_000) === 5_000);
ok('anything above is the top', stmt.bandFee(9_800_000) === 10_000);
ok('the bands can be overridden per deployment',
  stmt.bandFee(900_000, [{ upTo: 1_000_000, fee: 1_000 }, { upTo: Infinity, fee: 9_000 }]) === 1_000);

/* ---------- the boundary, which is the whole point ---------- */
console.log('\n— January means funded in January —');
const jan = stmt.period('2026-01');
mkDeal({ price: 2_000_000, loan: 1_600_000, fundedAt: '2026-01-01T00:00:00.000Z' });   // first instant
mkDeal({ price: 2_000_000, loan: 1_600_000, fundedAt: '2026-01-31T23:59:59.000Z' });   // last instant
mkDeal({ price: 2_000_000, loan: 1_600_000, fundedAt: '2025-12-31T23:59:59.000Z' });   // the day before
mkDeal({ price: 2_000_000, loan: 1_600_000, fundedAt: '2026-02-01T00:00:00.000Z' });   // the day after
mkDeal({ price: 2_000_000, loan: 1_600_000, fundedAt: null, status: 'approved' });     // never funded
mkDeal({ price: 2_000_000, loan: 1_600_000, fundedAt: '2026-01-15T00:00:00.000Z', dealer: otherDealer });

{
  const rows = stmt.fundedIn(dealerId, jan);
  ok('both January deals are in', rows.length === 2, rows.map((r) => r.funded_at));
  ok('the last instant of the month counts',
    rows.some((r) => r.funded_at === '2026-01-31T23:59:59.000Z'));
  ok('December is out', !rows.some((r) => r.funded_at.startsWith('2025')));
  ok('February is out', !rows.some((r) => r.funded_at.startsWith('2026-02')));
  ok('a deal that never funded is out', rows.every((r) => !!r.funded_at));
  ok('another yard\'s deal is out', rows.every((r) => r.dealer_id === dealerId));
}

console.log('\n— a closed month cannot be changed by what happens later —');
{
  const id = mkDeal({ price: 2_000_000, loan: 1_600_000, fundedAt: '2026-01-10T00:00:00.000Z' });
  const before = stmt.dealerStatement(dealerId, { id: dealerId, name: 'Test Yard' }, jan).count;
  /* The customer cancelled in March. The bank was still paid for it in January. */
  run("UPDATE applications SET status='cancelled', updated_at=? WHERE id=?", ['2026-03-02T00:00:00.000Z', id]);
  const after = stmt.dealerStatement(dealerId, { id: dealerId, name: 'Test Yard' }, jan).count;
  ok('a deal cancelled in March is still on January\'s statement', before === after, [before, after]);
  run('DELETE FROM applications WHERE id=?', [id]);
}

/* ---------- the bank ---------- */
console.log('\n— the bank pays the greater of a fee and a percentage —');
{
  run('DELETE FROM applications');
  mkDeal({ price: 1_200_000, loan: 800_000, fundedAt: '2026-01-05T00:00:00.000Z' });   // 0.5% = 4,000 -> flat wins
  mkDeal({ price: 6_000_000, loan: 4_800_000, fundedAt: '2026-01-06T00:00:00.000Z' }); // 0.5% = 24,000 -> pct wins
  const s = stmt.bankStatement(dealerId, { id: bankA, name: 'Bank A' }, jan, { perDeal: 10_000, pctOfLoan: 0.5 });

  ok('a small loan pays the flat fee', s.lines[0].amount === 10_000, s.lines[0]);
  ok('and says so', /flat fee/.test(s.lines[0].basis), s.lines[0].basis);
  ok('a large loan pays the percentage', s.lines[1].amount === 24_000, s.lines[1]);
  ok('and shows the working', /0\.5% of KES 4,800,000/.test(s.lines[1].basis), s.lines[1].basis);
  ok('the total is the sum', s.total === 34_000, s.total);
  ok('the terms are stated on the statement itself', /whichever is greater/.test(s.terms), s.terms);
  ok('and it is addressed to the payer', s.payerName === 'Bank A' && s.payerType === 'bank');
}

console.log('\n— one bank is not billed for another bank\'s deals —');
{
  mkDeal({ price: 3_000_000, loan: 2_400_000, fundedAt: '2026-01-07T00:00:00.000Z', lender: bankB });
  const a = stmt.bankStatement(dealerId, { id: bankA, name: 'Bank A' }, jan);
  const b = stmt.bankStatement(dealerId, { id: bankB, name: 'Bank B' }, jan);
  ok('Bank A sees two', a.count === 2, a.count);
  ok('Bank B sees one', b.count === 1, b.count);
  ok('and it is theirs', b.lines[0].financed === 2_400_000);
  const both = stmt.bankStatement(dealerId, null, jan);
  ok('with no lender named, all three are listed', both.count === 3, both.count);
}

console.log('\n— the dealership pays on funded deals only —');
{
  const s = stmt.dealerStatement(dealerId, { id: dealerId, name: 'Test Yard' }, jan);
  ok('all three funded deals are billed', s.count === 3, s.count);
  ok('priced by band, not flat',
    new Set(s.lines.map((l) => l.amount)).size > 1, s.lines.map((l) => [l.price, l.amount]));
  ok('1.2M pays 2,500', s.lines.find((l) => l.price === 1_200_000).amount === 2_500);
  ok('6M pays 10,000', s.lines.find((l) => l.price === 6_000_000).amount === 10_000);
  ok('3M pays 5,000', s.lines.find((l) => l.price === 3_000_000).amount === 5_000);
  ok('the total adds up', s.total === 17_500, s.total);
  ok('and it says nothing is charged for a lead', /lead|enquiry/i.test(s.note), s.note);
}

/* ---------- the insurer ---------- */
console.log('\n— the insurer pays on cover that went on risk —');
{
  const mkPolicy = (over) => insert('policies', {
    ref: 'PL-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
    dealer_id: dealerId, insurer_id: insurerId,
    customer_name: 'Grace Njeri', customer_phone: '+254722000111',
    cover: 'comprehensive', sum_insured: 2_000_000,
    premium: 80_000, commission_pct: 10, commission: 8_000,
    status: 'active', ...over,
  });
  mkPolicy({ starts: '2026-01-09' });
  mkPolicy({ starts: '2026-01-20', renewal_of: 1 });
  mkPolicy({ starts: '2026-02-02' });                       // next month
  mkPolicy({ starts: '2026-01-11', status: 'requested' });  // nobody put it on risk

  const s = stmt.insurerStatement(dealerId, { id: insurerId, name: 'Test Assurance', commission_pct: 10, monthly_fee: 0 }, jan);
  ok('two policies started in January', s.count === 2, s.lines.map((l) => l.date));
  ok('a policy nobody put on risk is not invoiced', s.count === 2);
  ok('February is not in January', !s.lines.some((l) => String(l.date).startsWith('2026-02')));
  ok('commission is 10% of premium', s.total === 16_000, s.total);
  ok('a renewal is marked as one', s.lines.some((l) => /renewal/.test(l.basis)), s.lines.map((l) => l.basis));
  ok('and it says the platform never receives premium',
    /receives no premium/i.test(s.note), s.note);

  const withSlot = stmt.insurerStatement(dealerId,
    { id: insurerId, name: 'Test Assurance', commission_pct: 10, monthly_fee: 40_000, slot_exclusive: 1 }, jan);
  ok('the slot fee is a line of its own', withSlot.count === 3, withSlot.lines.map((l) => l.ref));
  ok('and is added to the total', withSlot.total === 56_000, withSlot.total);
  ok('described as what it is', /exclusive panel slot/.test(withSlot.lines[2].basis), withSlot.lines[2].basis);

  const capped = stmt.insurerStatement(dealerId,
    { id: insurerId, name: 'Test Assurance', commission_pct: 25, monthly_fee: 0 }, jan);
  ok('a greedy commission rate is still stated at the legal cap',
    /10% commission/.test(capped.terms), capped.terms);
}

/* ---------- an empty month is an answer ---------- */
console.log('\n— an empty month is an answer, not a failure —');
{
  const s = stmt.dealerStatement(dealerId, { id: dealerId, name: 'Test Yard' }, stmt.period('2025-06'));
  ok('no lines', s.count === 0);
  ok('a total of nothing rather than a broken one', s.total === 0);
  ok('and it still knows who and when', s.payerName === 'Test Yard' && s.periodLabel === 'June 2025');
}

/* ---------- the spreadsheet ---------- */
console.log('\n— a finance department will ask for a spreadsheet —');
{
  const s = stmt.bankStatement(dealerId, { id: bankA, name: 'Bank A' }, jan);
  const csv = stmt.toCsv(s);
  const lines = csv.split('\n');
  ok('it opens with who and when', /Bank A .* January 2026/.test(lines[0]), lines[0]);
  ok('the due date is on it', /Due by,2026-02-15/.test(csv));
  ok('there is a header row', lines.some((l) => l.startsWith('Reference,Date,Customer')));
  ok('one row per deal', csv.split('\n').filter((l) => /^MK-ST-/.test(l)).length === s.count);
  ok('and a total at the bottom', new RegExp('Total,' + s.total).test(csv), csv.slice(-60));

  const nasty = stmt.toCsv({
    payerName: 'A, Bank', periodLabel: 'January 2026', dueBy: '2026-02-15', total: 1,
    lines: [{ ref: 'X', date: '2026-01-01', customer: 'Njeri, "Grace"', vehicle: 'Car\nTruck', basis: 'x', amount: 1 }],
  });
  ok('a comma in a name does not shift the columns', /"Njeri, ""Grace"""/.test(nasty), nasty);
  ok('and neither does a newline', /"Car\nTruck"/.test(nasty));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);

try { db.close(); } catch {}
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(TMP + suffix, { force: true }); } catch {}
}
process.exit(fail);
