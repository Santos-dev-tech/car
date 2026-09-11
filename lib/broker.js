'use strict';
/**
 * MotoKE — broker attribution.
 *
 * A broker's entire business is the introduction, and their entire fear is doing the work
 * and watching somebody else collect. Two versions of that fear come up constantly:
 *
 *   "If I take my client's papers to the bank, their agent takes my customer."
 *   "If I show him a Prado and he buys a Harrier, I get nothing."
 *
 * They are the same fear, so one record answers both. The broker registers a client
 * BEFORE the introduction. From then until the claim expires, any lead, booking or
 * application on that phone number is theirs — whatever car it turns out to be, whichever
 * branch keys it in, whoever ends up selling it.
 *
 * THE KEY IS THE PHONE NUMBER. Not a cookie. A cookie cannot survive how Kenyans actually
 * shop: browsing on a friend's handset, arriving through WhatsApp's in-app browser,
 * coming back on a laptop three weeks later. One phone number survives all of it, and
 * sec.V.phone() already folds 07…, 254… and +254… into a single stored shape.
 *
 * FIRST TOUCH WINS. A unique index on (dealer_id, phone) enforces it at the database
 * rather than in a branch somebody can forget: the second broker to register a number is
 * refused outright. The person who made the introduction is the one owed for it, and a
 * rule that quietly reassigns the claim to whoever registered most recently rewards
 * exactly the behaviour dealers already complain about.
 *
 * WHAT THIS DOES NOT DO. It cannot see a deal that happens somewhere else. If the client
 * buys from a yard that is not on this platform, no record here will find it, and telling
 * a broker otherwise is the fastest way to lose them.
 */

const { get, all, run, insert } = require('./db');

/** How long a registration holds the claim. Long enough for a real finance deal to run. */
const CLAIM_DAYS = 90;

/** Normalised to the one shape the rest of the app stores. */
function key(phone) {
  const digits = String(phone || '').replace(/[^\d+]/g, '');
  if (!digits) return null;
  if (digits.startsWith('+254')) return digits;
  if (digits.startsWith('254')) return '+' + digits;
  if (digits.startsWith('0')) return '+254' + digits.slice(1);
  if (digits.length === 9) return '+254' + digits;
  return digits;
}

/**
 * Register a client to a broker. Returns { ok } or { ok: false, reason, heldBy }.
 *
 * Refusing a duplicate is the feature, not a limitation — see FIRST TOUCH above.
 */
function registerClient({ dealerId, brokerId, name, phone, note }) {
  const p = key(phone);
  if (!p) return { ok: false, reason: 'A phone number is required to protect a claim.' };

  const existing = get(
    'SELECT * FROM broker_clients WHERE dealer_id=? AND phone=?',
    [dealerId, p]
  );
  if (existing) {
    if (Number(existing.broker_id) === Number(brokerId)) {
      return { ok: true, already: true, claim: existing };
    }
    /* Deliberately vague about WHO holds it. Naming the other broker turns a private
       ledger into a list of other people's clients. */
    return {
      ok: false,
      reason: 'Another introducer registered this number first. If that is wrong, the dealership can settle it.',
      heldBy: existing.broker_id,
    };
  }

  const expires = new Date(Date.now() + CLAIM_DAYS * 864e5).toISOString();
  const id = insert('broker_clients', {
    dealer_id: dealerId,
    broker_id: brokerId,
    phone: p,
    name: String(name || '').trim(),
    note: note ? String(note).trim() : null,
    claim_expires: expires,
  });
  return { ok: true, claim: get('SELECT * FROM broker_clients WHERE id=?', [id]) };
}

/**
 * Who, if anyone, introduced the person on this number?
 *
 * Called at every point a customer record is created. Returns the broker's user id, or
 * null. An expired claim returns null without being deleted — the row is evidence of what
 * was true at the time, and a commission dispute three months later needs it.
 */
function claimFor(dealerId, phone, at = new Date()) {
  const p = key(phone);
  if (!p) return null;
  const row = get(
    'SELECT * FROM broker_clients WHERE dealer_id=? AND phone=?',
    [dealerId, p]
  );
  if (!row) return null;
  if (new Date(row.claim_expires).getTime() < at.getTime()) return null;
  return row.broker_id;
}

/** The client confirms the introduction. One tap, and disputes stop being he-said-she-said. */
function confirmByClient(dealerId, phone) {
  const p = key(phone);
  if (!p) return false;
  const r = run(
    'UPDATE broker_clients SET confirmed_by_client=1 WHERE dealer_id=? AND phone=?',
    [dealerId, p]
  );
  return !!(r && r.changes);
}

/**
 * One broker's book: every client they registered, and what has happened to them.
 *
 * Scoped to the broker in the SQL rather than filtered afterwards. A broker must never be
 * able to page past their own clients into somebody else's.
 */
function bookFor(dealerId, brokerId) {
  const clients = all(
    `SELECT * FROM broker_clients WHERE dealer_id=? AND broker_id=? ORDER BY created_at DESC`,
    [dealerId, brokerId]
  );
  const apps = all(
    `SELECT id, ref, status, price, monthly_payment, created_at, updated_at, applicant, vehicle_snapshot
     FROM applications WHERE dealer_id=? AND introduced_by=? ORDER BY created_at DESC`,
    [dealerId, brokerId]
  );
  const leads = all(
    `SELECT id, type, name, phone, status, created_at FROM leads
     WHERE dealer_id=? AND introduced_by=? ORDER BY created_at DESC`,
    [dealerId, brokerId]
  );
  return { clients, applications: apps, leads };
}

/**
 * What a book is worth, and what is actually owed.
 *
 * `funded` is the only figure anyone gets paid on, and it is kept separate from the
 * pipeline on purpose: a broker looking at a number that mixes maybe-money with
 * definitely-money will believe the wrong one.
 */
function earningsFor(dealerId, brokerId, ratePerDeal = 0) {
  const rows = all(
    `SELECT status, price FROM applications WHERE dealer_id=? AND introduced_by=?`,
    [dealerId, brokerId]
  );
  const funded = rows.filter((r) => r.status === 'disbursed' || r.status === 'completed');
  const live = rows.filter((r) => !['disbursed', 'completed', 'declined', 'withdrawn'].includes(r.status));
  const sum = (list) => list.reduce((n, r) => n + (Number(r.price) || 0), 0);
  return {
    fundedCount: funded.length,
    fundedValue: sum(funded),
    liveCount: live.length,
    liveValue: sum(live),
    declinedCount: rows.length - funded.length - live.length,
    ratePerDeal,
    earned: funded.length * ratePerDeal,
    /* Said in words because a number on its own invites the wrong reading. */
    note: ratePerDeal
      ? `Paid on funded deals only. ${live.length} still in progress are not counted here.`
      : 'Set a commission rate on this dealership to see what is owed.',
  };
}

module.exports = { registerClient, claimFor, confirmByClient, bookFor, earningsFor, key, CLAIM_DAYS };
