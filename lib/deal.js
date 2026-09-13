'use strict';
/**
 * MotoKE — what is still outstanding on a deal, and who everyone is waiting for.
 *
 * The application status says where the FINANCE is. It says nothing about the seven other
 * things that have to be true before a customer can drive away, and those are what the
 * yard actually spends its day chasing: has he signed, has the balance landed, is the car
 * insured, when is he coming for it, and has anybody lodged the transfer.
 *
 * Today all of that lives in a salesman's head and a WhatsApp thread. This is the one
 * place that knows the answer, for the buyer and the yard at the same time.
 *
 * THREE OF THESE ARE THE LAW, NOT HOUSE RULES, and the difference matters because a rule
 * you invented can be waived by whoever is standing there and a legal one cannot:
 *
 *   - A car may not be driven on a Kenyan road without at least third-party cover. The
 *     Insurance (Motor Vehicles Third Party Risks) Act, Cap 405. An uninsured car is
 *     impounded and the owner is personally liable for whatever it does. So "insured" is
 *     a hard gate on handover, not a reminder.
 *   - NTSA gives fourteen days from the date of purchase to lodge the transfer. After
 *     that the buyer is driving a car registered to somebody else and both parties are in
 *     breach. The clock starts at handover, so the app starts it too.
 *   - The balance is payable before release unless a financier is settling it directly.
 *     That is in the sale agreement both parties sign, so the app holds it as a gate.
 *
 * WHY GATES AT ALL. A checklist nobody can fail is decoration. The point of this file is
 * that the yard cannot mark a car handed over while it is uninsured, and can see exactly
 * whose move it is on every deal at once. That is also what makes the website impossible
 * to work around: the deal is not "done" anywhere else.
 */

const { get, all } = require('./db');

/** Statuses at which the lender has said yes and money is coming or has come. */
const APPROVED = ['approved', 'disbursed', 'delivered', 'completed'];
const FUNDED = ['disbursed', 'delivered', 'completed'];

/** NTSA's own deadline, counted from the day the car changes hands. */
const TRANSFER_DEADLINE_DAYS = 14;

const days = (ms) => Math.ceil(ms / 864e5);
const iso = (d) => new Date(d).toISOString();

/**
 * Which rail can actually carry this amount.
 *
 * Worth being exact about, because the single most common way a car sale stalls for a day
 * is a buyer trying to send the balance on M-Pesa and discovering the cap at the counter.
 * These are the limits set by Safaricom under CBK approval and by the banks on PesaLink;
 * they are not the dealership's rules and cannot be raised by asking nicely.
 */
const MPESA_PER_TXN = 250_000;
const MPESA_PER_DAY = 500_000;
const PESALINK_PER_TXN = 999_999;

function railFor(amount) {
  const n = Math.max(0, Math.round(Number(amount) || 0));
  if (n <= MPESA_PER_TXN) {
    return {
      rail: 'mpesa',
      label: 'M-Pesa',
      why: 'Under the KES 250,000 single-transaction cap, so M-Pesa will carry it in one go.',
      alsoFine: ['PesaLink', 'Bank transfer'],
    };
  }
  if (n <= MPESA_PER_DAY) {
    return {
      rail: 'pesalink',
      label: 'PesaLink',
      why:
        'Over the KES 250,000 M-Pesa cap for a single transaction. Splitting it across two '
        + 'M-Pesa sends works but still hits the KES 500,000 daily ceiling, so PesaLink is the '
        + 'cleaner route — bank to bank, seconds, one reference.',
      alsoFine: ['Bank transfer'],
    };
  }
  if (n <= PESALINK_PER_TXN) {
    return {
      rail: 'pesalink',
      label: 'PesaLink',
      why: 'Above every M-Pesa limit. PesaLink carries up to KES 999,999 in one transfer and settles in seconds.',
      alsoFine: ['Bank transfer', 'Banker\'s cheque'],
    };
  }
  return {
    rail: 'rtgs',
    label: 'RTGS transfer',
    why:
      'Above KES 1,000,000, which is past both M-Pesa and PesaLink. This goes as an RTGS '
      + 'wire through the buyer\'s bank. Same day if it is lodged before the bank\'s cut-off, '
      + 'otherwise the next working day — worth telling the buyer BEFORE they set off for the yard.',
    alsoFine: ['Banker\'s cheque'],
  };
}

/* ------------------------------------------------------------------ */
/* the steps                                                           */
/* ------------------------------------------------------------------ */

/**
 * Everything outstanding on one application.
 *
 * Pure: it reads the record and returns a shape. Nothing here writes, so the same call
 * serves the customer's tracker and the yard's board without one of them quietly changing
 * the deal by looking at it.
 */
function stateFor(app, opts = {}) {
  if (!app) return null;
  const offer = safe(app.offer);
  const financed = !!app.lender_id;
  const price = Number(app.price) || 0;

  const deposit = Number(offer.deposit || app.deposit || 0);
  const loan = Number(offer.loanAmount || offer.principal || 0);

  /* WHAT THE BUYER OWES IN CASH, and the first version of this got it wrong in a way worth
     recording. It subtracted the agreed deposit from the price and reported "nothing
     further to pay" - but an agreed deposit is a number in an offer, not money in the
     account. A buyer who had paid nothing was being told they were square.

     The lender's share really does leave the buyer: the bank settles it to the dealership
     directly. Everything else is the buyer's own money and stays owed until somebody at
     the yard confirms it arrived. */
  const cashRequired = Math.max(0, price - (financed ? loan : 0));
  const received = Number(opts.depositsPaid || 0) + Number(app.balance_paid || 0);
  const cashDue = cashRequired;
  const paidBalance = received;
  const stillOwed = Math.max(0, cashRequired - received);

  const sigs = opts.signatures || [];
  const buyerSig = sigs.find((s) => s.party === 'buyer') || null;
  const sellerSig = sigs.find((s) => s.party === 'seller') || null;

  const insured = !!app.insurance_confirmed_at;
  const handedOver = !!app.handed_over_at;
  const booked = !!app.collection_at;

  const steps = [];
  const step = (o) => { steps.push(o); return o; };

  step({
    key: 'application',
    label: 'Application received',
    who: 'Buyer',
    done: true,
    detail: 'Reference ' + app.ref + '.',
  });

  step({
    key: 'documents',
    label: 'Documents uploaded',
    who: 'Buyer',
    done: (opts.documentCount || 0) > 0,
    detail: (opts.documentCount || 0) > 0
      ? (opts.documentCount === 1 ? 'One document on file.' : opts.documentCount + ' documents on file.')
      : 'ID, KRA PIN and pay records. Nothing moves until these are in.',
    action: 'upload',
  });

  step({
    key: 'approved',
    label: financed ? 'Finance approved' : 'Price agreed',
    who: financed ? 'Lender' : 'Dealership',
    done: APPROVED.includes(app.status),
    detail: financed
      ? (APPROVED.includes(app.status)
          ? 'Approved.'
          : 'With the lender. Nothing for the buyer to do while this runs.')
      : 'A cash sale, so there is no lender to wait for.',
  });

  /* SIGNING. Two signatures, and the buyer's first - a yard countersigning a document the
     customer has not seen yet is how disputes start. */
  step({
    key: 'agreement_buyer',
    label: 'Sale agreement signed by the buyer',
    who: 'Buyer',
    done: !!buyerSig,
    detail: buyerSig
      ? 'Signed ' + shortDate(buyerSig.signed_at) + ' by ' + buyerSig.name + '.'
      : 'Read it and sign in the app. A code goes to the phone on the application.',
    action: 'sign',
  });

  step({
    key: 'agreement_seller',
    label: 'Countersigned by the dealership',
    who: 'Dealership',
    done: !!sellerSig,
    blocked: !buyerSig,
    detail: sellerSig
      ? 'Countersigned ' + shortDate(sellerSig.signed_at) + '.'
      : buyerSig
        ? 'Waiting on the yard.'
        : 'The buyer signs first.',
  });

  /* THE BALANCE. Gated on the agreement because the agreement is what says what is owed. */
  const railInfo = railFor(stillOwed || cashDue);
  step({
    key: 'balance',
    label: cashDue > 0 ? 'Balance settled' : 'Nothing further to pay',
    who: 'Buyer',
    done: cashDue === 0 || stillOwed === 0,
    amount: stillOwed,
    rail: railInfo,
    detail: cashDue === 0
      ? 'The lender is settling the full price directly.'
      : stillOwed === 0
        ? money(received) + ' received in full.'
        : money(stillOwed) + ' outstanding of ' + money(cashRequired) + '. ' + railInfo.why,
    action: 'pay-balance',
  });

  /* INSURANCE. A legal gate, and the one people are most surprised by. */
  step({
    key: 'insurance',
    label: 'Insurance in force',
    who: 'Buyer',
    done: insured,
    legal: true,
    detail: insured
      ? [app.insurer, app.insurance_policy].filter(Boolean).join(' · ')
        + (app.insurance_expiry ? ', to ' + shortDate(app.insurance_expiry) : '')
      : 'The law says a car cannot be driven on a Kenyan road without at least third-party '
        + 'cover. The yard cannot release the car until the cover note is on file.',
    action: 'insurance',
  });

  step({
    key: 'collection',
    label: 'Collection booked',
    who: 'Buyer',
    /* A walk-in never books anything - he turns up, the car is clear, he drives it away.
       Leaving this outstanding on a car that is already gone puts a permanent red mark on
       a finished deal and teaches everyone to ignore the board. */
    done: booked || handedOver,
    detail: booked
      ? shortDate(app.collection_at) + (app.collection_time ? ' at ' + app.collection_time : '')
      : handedOver
        ? 'Collected without booking a slot.'
        : 'Pick a time. Everything above can be done from home; this is the one visit.',
    action: 'book-collection',
  });

  const blockers = [];
  if (!buyerSig || !sellerSig) blockers.push('the sale agreement is not signed by both sides');
  if (stillOwed > 0) blockers.push(money(stillOwed) + ' of the balance is outstanding');
  if (!insured) blockers.push('the car is not insured');

  step({
    key: 'handover',
    label: 'Car handed over',
    who: 'Dealership',
    done: handedOver,
    blocked: !handedOver && blockers.length > 0,
    blockers,
    detail: handedOver
      ? 'Handed over ' + shortDate(app.handed_over_at) + '.'
      : blockers.length
        ? 'Cannot release the car while ' + list(blockers) + '.'
        : 'Everything is clear. The car can be released.',
  });

  /* THE TRANSFER. Fourteen days from handover, by NTSA's own notice. */
  const xferDue = app.handed_over_at
    ? new Date(new Date(app.handed_over_at).getTime() + TRANSFER_DEADLINE_DAYS * 864e5)
    : null;
  const xferDone = app.transfer_stage === 'elogbook_issued' || app.transfer_stage === 'physical_received';
  const daysLeft = xferDue ? days(xferDue.getTime() - Date.now()) : null;

  step({
    key: 'transfer',
    label: 'Logbook transferred',
    who: 'NTSA',
    done: xferDone,
    legal: true,
    deadline: xferDue ? iso(xferDue) : null,
    daysLeft,
    detail: xferDone
      ? 'The buyer is the registered owner.'
      : xferDue
        ? (daysLeft > 0
            ? 'NTSA allows fourteen days from the date of purchase to lodge the transfer. '
              + daysLeft + (daysLeft === 1 ? ' day' : ' days') + ' left.'
            : 'Past NTSA\'s fourteen-day window. Until this is lodged the buyer is driving a '
              + 'car registered to somebody else.')
        : 'Starts when the car is handed over.',
  });

  const outstanding = steps.filter((s) => !s.done);
  const next = outstanding.find((s) => !s.blocked) || outstanding[0] || null;

  return {
    ref: app.ref,
    financed,
    price,
    deposit,
    loan,
    cashDue,
    balancePaid: paidBalance,
    balanceOutstanding: stillOwed,
    rail: railInfo,
    steps,
    doneCount: steps.filter((s) => s.done).length,
    total: steps.length,
    next: next ? { key: next.key, label: next.label, who: next.who, detail: next.detail } : null,
    /* Whose move it is, in two words, for a board showing forty deals at once. */
    waitingOn: next ? next.who : null,
    canRelease: blockers.length === 0 && !handedOver,
    blockers,
    /* The same list as a sentence. Built here so the screen and the refusal message read
       identically - two places composing the same list in slightly different English is
       how a customer ends up being told two different things about one deal. */
    blockerText: blockers.length ? list(blockers) : '',
  };
}

/**
 * Every deal not yet handed over, worst first.
 *
 * "Worst" is deliberately not "oldest". A deal blocked on the yard's own countersignature
 * is the yard's fault and should sit at the top; a deal waiting on a bank is not something
 * anybody here can move today.
 */
function boardFor(dealerId, opts = {}) {
  const rows = all(
    `SELECT * FROM applications
      WHERE dealer_id=? AND status NOT IN ('declined','cancelled','withdrawn')
      ORDER BY created_at DESC`,
    [dealerId]
  );
  const out = [];
  for (const app of rows) {
    const st = stateFor(app, {
      signatures: all('SELECT * FROM signatures WHERE application_id=?', [app.id]),
      documentCount: (get('SELECT COUNT(*) n FROM application_documents WHERE application_id=?', [app.id]) || {}).n || 0,
      depositsPaid: depositsPaid(app.id),
    });
    if (!st) continue;
    if (st.steps.every((s) => s.done)) continue;
    const applicant = safe(app.applicant);
    out.push({
      id: app.id,
      ref: app.ref,
      client: applicant.fullName || null,
      phone: applicant.phone || null,
      vehicle: (safe(app.vehicle_snapshot) || {}).title || null,
      price: app.price,
      status: app.status,
      waitingOn: st.waitingOn,
      next: st.next,
      canRelease: st.canRelease,
      blockers: st.blockers,
      balanceOutstanding: st.balanceOutstanding,
      doneCount: st.doneCount,
      total: st.total,
      transferDaysLeft: (st.steps.find((s) => s.key === 'transfer') || {}).daysLeft,
    });
  }
  const rank = (r) => {
    if (r.transferDaysLeft != null && r.transferDaysLeft <= 0) return 0;  // past a legal deadline
    if (r.canRelease) return 1;                                           // car could go today
    if (r.waitingOn === 'Dealership') return 2;                           // our own move
    if (r.waitingOn === 'Buyer') return 3;
    return 4;                                                             // lender, NTSA
  };
  out.sort((a, b) => rank(a) - rank(b) || (a.ref < b.ref ? -1 : 1));
  if (opts.limit) return out.slice(0, opts.limit);
  return out;
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

/** Money already through the till against this application, and only money confirmed paid. */
function depositsPaid(applicationId) {
  const row = get(
    "SELECT COALESCE(SUM(amount),0) n FROM orders WHERE application_id=? AND status='paid'",
    [applicationId]
  );
  return (row && row.n) || 0;
}

function safe(s) {
  if (!s) return {};
  if (typeof s === 'object') return s;
  try { return JSON.parse(s) || {}; } catch { return {}; }
}
const money = (n) => 'KES ' + Math.round(Number(n) || 0).toLocaleString('en-KE');
function shortDate(s) {
  if (!s) return '—';
  const d = new Date(String(s).replace(' ', 'T'));
  return isNaN(d) ? String(s) : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function list(arr) {
  if (arr.length === 1) return arr[0];
  return arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1];
}

module.exports = {
  stateFor,
  boardFor,
  depositsPaid,
  railFor,
  TRANSFER_DEADLINE_DAYS,
  MPESA_PER_TXN,
  MPESA_PER_DAY,
  PESALINK_PER_TXN,
};
