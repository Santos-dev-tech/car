'use strict';
/**
 * MotoKE — the rest of the deal. No server.
 *
 *   node --no-warnings tools/deal-test.js
 *
 * Two things are guarded here.
 *
 * The first is the money arithmetic, because the first version of it was wrong in a way
 * that would have been expensive: it subtracted the AGREED deposit from the price and told
 * a buyer who had paid nothing that there was nothing further to pay. An agreed deposit is
 * a number in an offer. Money is money somebody confirmed arriving.
 *
 * The second matters more. The handover gate has to refuse. A checklist nobody can fail is
 * decoration, and the one that must never be waved through is insurance — a car driven
 * without cover is impounded and its owner is personally liable for whatever it does.
 */
const path = require('node:path');
const fs = require('node:fs');

const TMP = path.join(__dirname, '..', 'data', 'deal-test.db');
for (const suffix of ['', '-wal', '-shm']) fs.rmSync(TMP + suffix, { force: true });
process.env.MOTOKE_DB = TMP;

const { db, insert, get, run } = require('../lib/db');
const deal = require('../lib/deal');

let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok    ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); }
};

/* ---------- fixtures ---------- */
const dealerId = insert('dealers', { slug: 'test-yard', name: 'Test Yard' });
const lenderId = insert('lenders', { name: 'Test Bank', annual_rate: 0.15 });

let n = 0;
function mkApp(over = {}) {
  const price = over.price != null ? over.price : 2_000_000;
  const loan = over.loan != null ? over.loan : 1_600_000;
  const id = insert('applications', {
    ref: 'MK-TEST-' + String(++n).padStart(4, '0'),
    dealer_id: dealerId,
    applicant: JSON.stringify({ fullName: 'Grace Njeri', phone: '+254722000111' }),
    employment: '{}',
    offer: JSON.stringify({ deposit: price - loan, loanAmount: loan }),
    vehicle_snapshot: JSON.stringify({ title: '2018 Toyota Harrier' }),
    price,
    deposit: price - loan,
    lender_id: over.cash ? null : lenderId,
    status: over.status || 'approved',
    ...over.columns,
  });
  return get('SELECT * FROM applications WHERE id=?', [id]);
}
const state = (app, opts) => deal.stateFor(app, Object.assign({ documentCount: 1 }, opts));
const stepOf = (st, key) => st.steps.find((s) => s.key === key);

/* ---------- which rail carries the money ---------- */
console.log('\n— which rail can actually carry it —');
ok('200,000 goes on M-Pesa', deal.railFor(200_000).rail === 'mpesa');
ok('exactly 250,000 still goes on M-Pesa', deal.railFor(250_000).rail === 'mpesa');
ok('250,001 does not', deal.railFor(250_001).rail !== 'mpesa', deal.railFor(250_001).rail);
ok('440,000 goes on PesaLink', deal.railFor(440_000).rail === 'pesalink');
ok('999,999 is the top of PesaLink', deal.railFor(999_999).rail === 'pesalink');
ok('a million goes RTGS', deal.railFor(1_000_000).rail === 'rtgs', deal.railFor(1_000_000).rail);
ok('3.2M goes RTGS', deal.railFor(3_200_000).rail === 'rtgs');
ok('and the reason is given, not just the name',
  /M-Pesa|PesaLink|RTGS/.test(deal.railFor(3_200_000).why) && deal.railFor(3_200_000).why.length > 40);

/* ---------- the money ---------- */
console.log('\n— an agreed deposit is not a paid deposit —');
{
  const app = mkApp({ price: 2_000_000, loan: 1_600_000 });
  const st = state(app);
  ok('the buyer owes their own 400,000', st.balanceOutstanding === 400_000, st.balanceOutstanding);
  ok('the bank\'s share is not the buyer\'s problem', st.cashDue === 400_000, st.cashDue);
  ok('and nothing is counted as received', st.balancePaid === 0);
  ok('the balance step is not done', stepOf(st, 'balance').done === false);

  const half = state(app, { depositsPaid: 150_000 });
  ok('a paid booking deposit counts', half.balanceOutstanding === 250_000, half.balanceOutstanding);
  ok('and it is still not settled', stepOf(half, 'balance').done === false);

  run('UPDATE applications SET balance_paid=? WHERE id=?', [250_000, app.id]);
  const done = state(get('SELECT * FROM applications WHERE id=?', [app.id]), { depositsPaid: 150_000 });
  ok('deposit plus balance settles it', done.balanceOutstanding === 0, done.balanceOutstanding);
  ok('and the step goes green', stepOf(done, 'balance').done === true);
}

console.log('\n— a cash sale owes the whole price —');
{
  const app = mkApp({ price: 1_200_000, cash: true, loan: 0 });
  const st = state(app);
  ok('no lender means no lender share', st.financed === false);
  ok('so the buyer owes all of it', st.balanceOutstanding === 1_200_000, st.balanceOutstanding);
  ok('and that is an RTGS amount', st.rail.rail === 'rtgs');
}

console.log('\n— a lender settling the whole price leaves nothing to pay —');
{
  const app = mkApp({ price: 1_000_000, loan: 1_000_000 });
  const st = state(app);
  ok('nothing outstanding', st.balanceOutstanding === 0);
  ok('the step says why rather than going quiet',
    /lender is settling/i.test(stepOf(st, 'balance').detail), stepOf(st, 'balance').detail);
}

/* ---------- the gate ---------- */
console.log('\n— the handover gate has to refuse —');
{
  const app = mkApp({ price: 2_000_000, loan: 1_600_000 });
  let st = state(app);
  ok('a fresh deal cannot be released', st.canRelease === false);
  ok('and says all three reasons', st.blockers.length === 3, st.blockers);
  ok('the sentence reads as English, not as a list',
    / and /.test(st.blockerText) && !/, and /.test(st.blockerText), st.blockerText);

  const sigs = [
    { party: 'buyer', name: 'Grace Njeri', signed_at: '2026-09-01' },
    { party: 'seller', name: 'Test Yard', signed_at: '2026-09-01' },
  ];
  st = state(app, { signatures: sigs });
  ok('signing removes one reason', st.blockers.length === 2, st.blockers);

  run('UPDATE applications SET balance_paid=? WHERE id=?', [400_000, app.id]);
  st = state(get('SELECT * FROM applications WHERE id=?', [app.id]), { signatures: sigs });
  ok('paying removes another', st.blockers.length === 1, st.blockers);
  ok('and the one left is the insurance', /insured/.test(st.blockers[0]), st.blockers[0]);
  ok('STILL cannot be released', st.canRelease === false);

  run('UPDATE applications SET insurance_confirmed_at=? WHERE id=?', ['2026-09-02T09:00:00Z', app.id]);
  st = state(get('SELECT * FROM applications WHERE id=?', [app.id]), { signatures: sigs });
  ok('with cover on file it is finally clear', st.canRelease === true, st.blockers);
  ok('and nothing is blocking', st.blockers.length === 0);
}

console.log('\n— insurance is marked as the law, not as our preference —');
{
  const st = state(mkApp());
  ok('the insurance step carries the legal flag', stepOf(st, 'insurance').legal === true);
  ok('so does the transfer', stepOf(st, 'transfer').legal === true);
  ok('the signature step does not, because it is not',
    !stepOf(st, 'agreement_buyer').legal);
}

console.log('\n— the buyer signs before the yard —');
{
  const app = mkApp();
  const st = state(app);
  ok('countersigning is blocked with no buyer signature', stepOf(st, 'agreement_seller').blocked === true);
  const one = state(app, { signatures: [{ party: 'buyer', name: 'Grace Njeri', signed_at: '2026-09-01' }] });
  ok('and unblocked once they have', stepOf(one, 'agreement_seller').blocked === false);
  ok('with the yard named as whose move it is', one.waitingOn === 'Dealership', one.waitingOn);
}

/* ---------- NTSA's fourteen days ---------- */
console.log('\n— NTSA gives fourteen days, and it starts at handover —');
{
  const app = mkApp();
  ok('the clock has not started', stepOf(state(app), 'transfer').daysLeft == null);

  const today = new Date().toISOString();
  run('UPDATE applications SET handed_over_at=? WHERE id=?', [today, app.id]);
  const st = state(get('SELECT * FROM applications WHERE id=?', [app.id]));
  ok('fourteen days from today', stepOf(st, 'transfer').daysLeft === 14, stepOf(st, 'transfer').daysLeft);
  ok('and the deadline is a real date', !!stepOf(st, 'transfer').deadline);

  const old = new Date(Date.now() - 20 * 864e5).toISOString();
  run('UPDATE applications SET handed_over_at=? WHERE id=?', [old, app.id]);
  const late = state(get('SELECT * FROM applications WHERE id=?', [app.id]));
  ok('twenty days ago is overdue', stepOf(late, 'transfer').daysLeft < 0, stepOf(late, 'transfer').daysLeft);
  ok('and it says what that means for the buyer',
    /registered to somebody else/.test(stepOf(late, 'transfer').detail), stepOf(late, 'transfer').detail);

  run("UPDATE applications SET transfer_stage='elogbook_issued' WHERE id=?", [app.id]);
  const done = state(get('SELECT * FROM applications WHERE id=?', [app.id]));
  ok('an issued eLogbook finishes it', stepOf(done, 'transfer').done === true);
}

console.log('\n— a car already gone is not waiting to be collected —');
{
  const app = mkApp({ columns: { handed_over_at: new Date().toISOString() } });
  const st = state(app);
  ok('collection counts as done', stepOf(st, 'collection').done === true);
  ok('and says so plainly', /without booking/.test(stepOf(st, 'collection').detail), stepOf(st, 'collection').detail);
}

/* ---------- the board ---------- */
console.log('\n— the board is ordered by what somebody can do today —');
{
  run("DELETE FROM applications WHERE dealer_id=?", [dealerId]);

  /* One of each: overdue, ready to go, ours to move, theirs to move. */
  const overdue = mkApp({ columns: {
    handed_over_at: new Date(Date.now() - 30 * 864e5).toISOString(),
    balance_paid: 400_000,
    insurance_confirmed_at: '2026-01-01',
  } });
  const ready = mkApp({ columns: { balance_paid: 400_000, insurance_confirmed_at: '2026-01-01' } });
  const ours = mkApp({ columns: { balance_paid: 400_000, insurance_confirmed_at: '2026-01-01' } });
  const theirs = mkApp();
  for (const a of [overdue, ready, ours]) {
    insert('signatures', { dealer_id: dealerId, application_id: a.id, party: 'buyer', name: 'Grace Njeri', doc_hash: 'x' });
  }
  for (const a of [overdue, ready]) {
    insert('signatures', { dealer_id: dealerId, application_id: a.id, party: 'seller', name: 'Test Yard', doc_hash: 'x' });
  }
  /* Every one of them has their papers in. Without this the board ranks three of them on
     "documents uploaded" instead of on the step being tested, which is a fixture fault
     that reads like a sorting bug. */
  for (const a of [overdue, ready, ours, theirs]) {
    insert('application_documents', { application_id: a.id, doc_type: 'id', filename: 'a.pdf', mime: 'application/pdf', size: 10, data: 'x' });
  }

  const board = deal.boardFor(dealerId);
  ok('all four are in flight', board.length === 4, board.length);
  ok('the one past NTSA\'s deadline is first', board[0].ref === overdue.ref, board.map((b) => b.ref));
  ok('then the car that could go out today', board[1].ref === ready.ref, board.map((b) => [b.ref, b.canRelease]));
  ok('then the one waiting on the yard', board[2].waitingOn === 'Dealership', board[2]);
  ok('the board says whose move each one is', board.every((b) => !!b.waitingOn));
  ok('and how far along', board.every((b) => b.total === 10 && b.doneCount > 0));

  /* Nothing in here should carry a customer's identity documents. */
  const dump = JSON.stringify(board);
  ok('no ID numbers on the board', !/idNumber|kraPin/.test(dump));

  run("UPDATE applications SET status='cancelled' WHERE id=?", [theirs.id]);
  ok('a cancelled deal drops off', deal.boardFor(dealerId).length === 3);
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);

/* Close before deleting: Windows keeps the file locked while node:sqlite holds it, and an
   unguarded rmSync turns a green run into exit 1. */
try { db.close(); } catch {}
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(TMP + suffix, { force: true }); } catch {}
}
process.exit(fail);
