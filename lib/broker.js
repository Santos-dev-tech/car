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

/* ------------------------------------------------------------------ */
/* verification                                                        */
/* ------------------------------------------------------------------ */

/**
 * What a broker has to have before this platform will call them verified.
 *
 * Three tests, and the third is the one no competitor can copy quickly: a record of deals
 * that actually funded, on this platform, under their name.
 */
const NEEDS_REFERENCES = 2;
const NEEDS_FUNDED_DEALS = 3;

/** A deal only counts once the money moved. Anything earlier is a hope, not a record. */
const FUNDED = ['disbursed', 'completed'];

/**
 * Is this broker verified, and if not, what is missing?
 *
 * COMPUTED EVERY TIME, from evidence. There is no `verified` column to set, on purpose:
 * a badge that can be switched on is a badge that will be switched on as a favour, and
 * the moment that happens the register is worth nothing. If someone pays a fee, they have
 * proved they have the fee.
 *
 * Suspension overrides everything. A register you cannot revoke from is not a register.
 */
function verificationFor(dealerId, brokerId) {
  /* Counted across EVERY dealership, deliberately — dealerId is only here so callers can
     pass the yard they are asking from, and it is not used to filter.
     A broker belongs to the platform, not to one yard: he finds a client and then goes
     looking for the right car wherever it is. A register scoped to a single dealership
     would be that dealership's private list, which is worth nothing to the next yard he
     walks into, and the whole value of a register is that it is THE register. Two
     references from two different yards, and three deals funded anywhere on MotoKE. */
  const profile = get('SELECT * FROM broker_profiles WHERE broker_id=?', [brokerId]);
  const refs = all('SELECT dealership_name, created_at FROM broker_references WHERE broker_id=?', [brokerId]);
  const funded = all(
    `SELECT id FROM applications WHERE introduced_by=? AND status IN (${FUNDED.map(() => '?').join(',')})`,
    [brokerId, ...FUNDED]
  ).length;

  const hasIdentity = !!(profile && profile.id_number && profile.kra_pin && profile.address);

  const checks = [
    {
      key: 'identity',
      label: 'ID number, KRA PIN and a physical address on file',
      done: hasIdentity,
      detail: hasIdentity ? 'On file' : 'Not submitted yet',
    },
    {
      key: 'references',
      label: `${NEEDS_REFERENCES} dealerships vouching for you`,
      done: refs.length >= NEEDS_REFERENCES,
      detail: `${refs.length} of ${NEEDS_REFERENCES}`,
      from: refs.map((r) => r.dealership_name),
    },
    {
      key: 'track_record',
      label: `${NEEDS_FUNDED_DEALS} deals funded through this platform`,
      done: funded >= NEEDS_FUNDED_DEALS,
      detail: `${funded} of ${NEEDS_FUNDED_DEALS}`,
    },
  ];

  const suspended = !!(profile && profile.suspended);
  const allDone = checks.every((c) => c.done);

  /* LEVELS, not one badge — and this is a correction, not a refinement.
   *
   * The first version had a single test needing three funded deals. That is unreachable
   * on day one: deals need dealerships, dealerships are sold on the strength of the
   * broker network, and the network needs brokers who can show something. Every broker
   * would have sat at "pending" forever, which is the same as having no register.
   *
   * So `id_checked` stands on its own. It is reachable the moment someone has looked at
   * a broker's ID, needs nothing from any dealership, and already beats what a yard has
   * today, which is nothing at all about the man at their gate. `verified` is then the
   * thing worth working toward, and the brokers who join first reach it first. */
  const level = suspended
    ? 'suspended'
    : allDone
      ? 'verified'
      : hasIdentity
        ? 'id_checked'
        : profile
          ? 'pending'
          : 'unregistered';

  const LEVEL_LABEL = {
    unregistered: 'Not registered',
    pending: 'Registered',
    id_checked: 'ID checked',
    verified: 'Verified',
    suspended: 'Suspended',
  };
  const LEVEL_MEANS = {
    unregistered: 'Nothing has been checked.',
    pending: 'Signed up, but no documents submitted yet.',
    id_checked: 'We have seen their national ID, KRA PIN and address. Their track record is still being built.',
    verified: `Identity checked, ${NEEDS_REFERENCES} independent dealerships vouching, and ${NEEDS_FUNDED_DEALS} deals funded through MotoKE.`,
    suspended: 'A dealership has raised a problem. Treat with caution.',
  };

  return {
    status: level,
    label: LEVEL_LABEL[level],
    means: LEVEL_MEANS[level],
    verified: level === 'verified',
    /* Kept separate from `verified` because a dealer asking "has anyone actually seen
       this man's ID" is a different, lower-stakes question than "is he proven". */
    idChecked: hasIdentity && !suspended,
    checks,
    suspendedReason: suspended ? profile.suspended_reason : null,
    missing: checks.filter((c) => !c.done).map((c) => c.label),
    /* Written out because a badge means nothing unless a dealer knows what was actually
       checked. A badge with no stated basis is just a colour. */
    basis: `ID checked means we have seen their national ID, KRA PIN and address. Verified additionally means ${NEEDS_REFERENCES} independent dealerships vouching and ${NEEDS_FUNDED_DEALS} deals funded through MotoKE.`,
  };
}

/** Store the identity half. Identifiers arrive already encrypted by the caller. */
function saveProfile({ dealerId, brokerId, idNumber, kraPin, address }) {
  const existing = get('SELECT broker_id FROM broker_profiles WHERE broker_id=?', [brokerId]);
  if (existing) {
    run(
      `UPDATE broker_profiles SET id_number=?, kra_pin=?, address=?, submitted_at=? WHERE broker_id=?`,
      [idNumber, kraPin, address, new Date().toISOString(), brokerId]
    );
  } else {
    insert('broker_profiles', {
      broker_id: brokerId,
      dealer_id: dealerId,
      id_number: idNumber,
      kra_pin: kraPin,
      address,
      submitted_at: new Date().toISOString(),
    });
  }
  return verificationFor(dealerId, brokerId);
}

/**
 * A dealership vouches for a broker.
 *
 * One dealership can only vouch once — enforced by a unique index, not by a check here,
 * because the whole value of "two independent dealers" dies the moment one yard can file
 * both references.
 */
function addReference({ brokerId, dealerId, vouchedBy, dealershipName, note }) {
  const already = get(
    'SELECT id FROM broker_references WHERE broker_id=? AND dealer_id=?',
    [brokerId, dealerId]
  );
  if (already) return { ok: false, reason: 'This dealership has already vouched for this broker.' };
  insert('broker_references', {
    broker_id: brokerId,
    dealer_id: dealerId,
    vouched_by: vouchedBy || null,
    dealership_name: String(dealershipName || '').trim(),
    note: note ? String(note).trim() : null,
  });
  return { ok: true };
}

/** Pull the badge, with a reason. Revocable is the point. */
function suspend(brokerId, reason) {
  const r = run('UPDATE broker_profiles SET suspended=1, suspended_reason=? WHERE broker_id=?', [
    String(reason || '').trim() || 'Suspended by the dealership',
    brokerId,
  ]);
  return !!(r && r.changes);
}

function reinstate(brokerId) {
  const r = run('UPDATE broker_profiles SET suspended=0, suspended_reason=NULL WHERE broker_id=?', [brokerId]);
  return !!(r && r.changes);
}

module.exports = {
  registerClient, claimFor, confirmByClient, bookFor, earningsFor, key, CLAIM_DAYS,
  verificationFor, saveProfile, addReference, suspend, reinstate,
  NEEDS_REFERENCES, NEEDS_FUNDED_DEALS,
};
