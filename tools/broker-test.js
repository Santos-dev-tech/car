'use strict';
/**
 * MotoKE — broker attribution tests. No server.
 *
 *   node --no-warnings tools/broker-test.js
 *
 * Two things are being guarded here and they are not equally important.
 *
 * The first is that attribution survives the things brokers are actually afraid of: the
 * client buying a different car, a different branch keying the deal in, the phone number
 * arriving in a different shape.
 *
 * The second matters more. A broker must never see another broker's clients. That is not
 * a feature working badly, it is a leak — one broker reading the book of the man working
 * the next yard along.
 */
const path = require('node:path');
const fs = require('node:fs');

// A scratch database, so a test run can never touch the real one.
const TMP = path.join(__dirname, '..', 'data', 'broker-test.db');
for (const suffix of ['', '-wal', '-shm']) fs.rmSync(TMP + suffix, { force: true });
process.env.MOTOKE_DB = TMP;

const { db, insert, get } = require('../lib/db');
const brk = require('../lib/broker');
const auth = require('../lib/auth');

let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok    ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); }
};

/* ---------- fixtures ---------- */
const dealerId = insert('dealers', { slug: 'test-yard', name: 'Test Yard' });
const otherDealer = insert('dealers', { slug: 'other-yard', name: 'Other Yard' });
const mkUser = (name, email) =>
  insert('users', { dealer_id: dealerId, name, email, role: 'broker', password_hash: 'x', salt: 'y' });
const peter = mkUser('Peter Kariuki', 'peter@test.ke');
const mary = mkUser('Mary Wanjiru', 'mary@test.ke');

console.log('\n— the phone number is the key —');
ok('07 becomes +254', brk.key('0712345678') === '+254712345678', brk.key('0712345678'));
ok('254 becomes +254', brk.key('254712345678') === '+254712345678');
ok('+254 is left alone', brk.key('+254712345678') === '+254712345678');
ok('spaces and dashes are ignored', brk.key('0712 345-678') === '+254712345678');
ok('nine digits are assumed local', brk.key('712345678') === '+254712345678');
ok('nothing in, nothing out', brk.key('') === null && brk.key(null) === null);

console.log('\n— registering a client —');
const r1 = brk.registerClient({ dealerId, brokerId: peter, name: 'John Omondi', phone: '0712345678' });
ok('the first registration is accepted', r1.ok === true);
ok('and it holds for 90 days', brk.CLAIM_DAYS === 90);
ok('a phone number is required', brk.registerClient({ dealerId, brokerId: peter, name: 'X', phone: '' }).ok === false);

console.log('\n— first touch wins —');
const r2 = brk.registerClient({ dealerId, brokerId: mary, name: 'John Omondi', phone: '0712345678' });
ok('a second broker cannot take the same client', r2.ok === false, r2);
ok('and is told why, without being told who', r2.reason && !/Peter/.test(r2.reason), r2.reason);
ok('re-registering your own client is harmless', brk.registerClient({ dealerId, brokerId: peter, name: 'John Omondi', phone: '0712345678' }).already === true);
ok('the claim still belongs to the first broker', brk.claimFor(dealerId, '0712345678') === peter);

console.log('\n— the shape of the number does not matter —');
ok('registered as 07, found as +254', brk.claimFor(dealerId, '+254712345678') === peter);
ok('registered as 07, found as 254', brk.claimFor(dealerId, '254712345678') === peter);
ok('registered as 07, found with spaces', brk.claimFor(dealerId, '0712 345 678') === peter);

console.log('\n— the boundaries of a claim —');
ok('an unregistered number belongs to nobody', brk.claimFor(dealerId, '0799999999') === null);
ok('a claim does not cross to another dealership', brk.claimFor(otherDealer, '0712345678') === null);
const later = new Date(Date.now() + 91 * 864e5);
ok('and it expires after 90 days', brk.claimFor(dealerId, '0712345678', later) === null);
ok('but the row survives expiry as evidence',
  !!get('SELECT id FROM broker_clients WHERE dealer_id=? AND phone=?', [dealerId, '+254712345678']));

console.log('\n— the client can confirm it —');
ok('confirmation is recorded', brk.confirmByClient(dealerId, '0712345678') === true);
ok('and is stored against the claim',
  get('SELECT confirmed_by_client c FROM broker_clients WHERE dealer_id=? AND phone=?', [dealerId, '+254712345678']).c === 1);
ok('confirming an unknown number changes nothing', brk.confirmByClient(dealerId, '0700000000') === false);

console.log('\n— the Prado problem: the client, not the car —');
brk.registerClient({ dealerId, brokerId: mary, name: 'Grace Njeri', phone: '0722000111' });
const mkApp = (broker, price, status, title) =>
  insert('applications', {
    ref: 'T' + Math.random().toString(36).slice(2, 8).toUpperCase(),
    dealer_id: dealerId, introduced_by: broker, applicant: '{"fullName":"Someone"}',
    employment: '{}', offer: '{}', price, status,
    vehicle_snapshot: JSON.stringify({ title }),
  });
// Mary showed her a Prado. She bought a Harrier.
mkApp(mary, 4_750_000, 'disbursed', '2019 Toyota Harrier');
const maryBook = brk.bookFor(dealerId, mary);
ok('she is still credited for the car the client actually bought',
  maryBook.applications.length === 1 && /Harrier/.test(maryBook.applications[0].vehicle_snapshot));

console.log('\n— a broker sees only their own book —');
mkApp(peter, 8_900_000, 'disbursed', '2019 Mercedes-Benz GLE 350d');
mkApp(peter, 2_100_000, 'new', '2018 Toyota Axio');
const peterBook = brk.bookFor(dealerId, peter);
ok('Peter sees his own two applications', peterBook.applications.length === 2, peterBook.applications.length);
ok('and none of Mary\'s', peterBook.applications.every((a) => !/Harrier/.test(a.vehicle_snapshot)));
ok('Mary sees only her one', brk.bookFor(dealerId, mary).applications.length === 1);
ok('Peter sees only his own registered clients',
  peterBook.clients.every((c) => Number(c.broker_id) === peter), peterBook.clients.map((c) => c.broker_id));
ok('a broker with no clients gets an empty book, not everyone\'s',
  brk.bookFor(dealerId, 99999).applications.length === 0);

console.log('\n— what is owed, and what is only hoped for —');
const e = brk.earningsFor(dealerId, peter, 4000);
ok('only funded deals count', e.fundedCount === 1, e);
ok('the live one is reported separately', e.liveCount === 1);
ok('earnings are funded deals times the rate', e.earned === 4000, e.earned);
ok('and the wording says the pipeline is not money', /not counted/.test(e.note), e.note);
ok('with no rate set it says so instead of showing zero as if it were a fee',
  /Set a commission rate/.test(brk.earningsFor(dealerId, peter, 0).note));

console.log('\n— the permission boundary —');
ok('a broker is not staff', auth.isStaff({ role: 'broker' }) === false);
ok('but is recognised as a broker', auth.isBroker({ role: 'broker' }) === true);
ok('a broker CANNOT see stock ageing', auth.can({ role: 'broker' }, 'ageing') === false);
ok('a broker CANNOT see every application', auth.can({ role: 'broker' }, 'applications') === false);
ok('a broker CANNOT edit stock', auth.can({ role: 'broker' }, 'inventory.write') === false);
ok('a broker CANNOT edit lenders', auth.can({ role: 'broker' }, 'lenders') === false);
ok('a broker CANNOT manage staff', auth.can({ role: 'broker' }, 'staff') === false);
ok('a broker CANNOT read the audit log', auth.can({ role: 'broker' }, 'audit') === false);
ok('a broker CAN browse the stock', auth.can({ role: 'broker' }, 'inventory') === true);
ok('a broker CAN reach their own book', auth.can({ role: 'broker' }, 'broker') === true);
ok('and no other role holds the broker capability',
  ['dealer_admin', 'finance_officer', 'sales_agent', 'receptionist']
    .every((r) => auth.can({ role: r }, 'broker') === false));

/* The badge is the part with real consequences. If this platform calls a man verified
   and he defrauds a client, the platform owns it — so these tests are less about the
   badge working and more about it being impossible to fake. */
console.log('\n— the badge is earned, not bought —');
const dan = mkUser('Dan Mutiso', 'dan@test.ke');
const v0 = brk.verificationFor(dealerId, dan);
ok('a new broker is unregistered, not verified', v0.status === 'unregistered' && v0.verified === false, v0.status);
ok('and is told all three things that are missing', v0.missing.length === 3, v0.missing);
ok('the basis is spelled out, not just a colour', /identity|vouching|funded/.test(v0.basis));

brk.saveProfile({ dealerId, brokerId: dan, idNumber: 'enc:123', kraPin: 'enc:A00', address: 'Ngong Road' });
const v1 = brk.verificationFor(dealerId, dan);
ok('documents alone move him to pending, not verified', v1.status === 'pending' && v1.verified === false);
ok('identity now passes', v1.checks.find((c) => c.key === 'identity').done === true);
ok('but references and track record do not', v1.missing.length === 2, v1.missing);

brk.addReference({ brokerId: dan, dealerId, vouchedBy: peter, dealershipName: 'Test Yard' });
ok('one dealership vouching is not enough', brk.verificationFor(dealerId, dan).verified === false);
ok('the same dealership cannot vouch twice',
  brk.addReference({ brokerId: dan, dealerId, dealershipName: 'Test Yard' }).ok === false);
brk.addReference({ brokerId: dan, dealerId: otherDealer, dealershipName: 'Other Yard' });
ok('two independent dealerships satisfies the reference test',
  brk.verificationFor(dealerId, dan).checks.find((c) => c.key === 'references').done === true);
ok('but with no funded deals he is still not verified', brk.verificationFor(dealerId, dan).verified === false);

mkApp(dan, 1_000_000, 'new', 'A');
mkApp(dan, 1_000_000, 'approved', 'B');
ok('applications that have not funded do not count',
  brk.verificationFor(dealerId, dan).checks.find((c) => c.key === 'track_record').detail === '0 of 3');
mkApp(dan, 1_000_000, 'disbursed', 'C');
mkApp(dan, 1_000_000, 'completed', 'D');
ok('two funded deals is still short', brk.verificationFor(dealerId, dan).verified === false);
mkApp(dan, 1_000_000, 'disbursed', 'E');
const vFinal = brk.verificationFor(dealerId, dan);
ok('all three tests passed makes him verified', vFinal.status === 'verified' && vFinal.verified === true, vFinal.status);
ok('and nothing is listed as missing', vFinal.missing.length === 0);

console.log('\n— and it can be taken away —');
ok('a verified broker can be suspended', brk.suspend(dan, 'Complaint from a client') === true);
const vSus = brk.verificationFor(dealerId, dan);
ok('suspension beats every other check', vSus.status === 'suspended' && vSus.verified === false);
ok('and the reason is recorded', /Complaint/.test(vSus.suspendedReason), vSus.suspendedReason);
ok('reinstating restores the badge', brk.reinstate(dan) && brk.verificationFor(dealerId, dan).verified === true);

console.log('\n— there is no way to simply switch it on —');
ok('no export sets verified directly',
  !Object.keys(brk).some((k) => /^(set|mark|make)Verified$/i.test(k)), Object.keys(brk));
ok('the badge survives nothing being paid — it is never asked about money',
  !/fee|paid|payment/i.test(String(brk.verificationFor)));

console.log(`\n  ${pass} passed, ${fail} failed\n`);

/* Close the handle before deleting, and never let cleanup decide the exit code.
   Windows keeps the file locked while node:sqlite holds it open, so an unguarded rmSync
   here throws EBUSY and a suite that passed 45 of 45 exits 1 — a green run reported as a
   failure is worse than no run at all. The next run overwrites anything left behind. */
try { db.close(); } catch {}
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(TMP + suffix, { force: true }); } catch {}
}
process.exit(fail);
