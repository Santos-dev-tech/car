'use strict';
/**
 * MotoKE — the logbook transfer, which is where a car sale actually ends.
 *
 * A customer pays, takes the keys, and then owns nothing. Ownership passes when NTSA
 * completes the transfer, and until then the seller is still the registered owner of a
 * car they no longer have — liable for whatever it does.
 *
 * NTSA runs it as a two-party process on eCitizen. The seller applies, the buyer approves
 * from their notifications, the digital eLogbook appears in about three working days, and
 * the physical one is posted seven to ten days after that. None of this is visible to the
 * buyer, so they ring the yard every morning, and the yard cannot answer because nobody
 * wrote down which step it reached.
 *
 * That is the whole feature: write down which step it reached.
 *
 * The stages mirror what actually happens on eCitizen rather than a tidy invention, so a
 * salesperson reading the screen and a clerk looking at TIMS see the same words.
 */

const { get, run, all, insert } = require('./db');

const STAGES = [
  {
    key: 'not_started',
    label: 'Not started',
    who: null,
    blurb: 'The transfer has not been lodged with NTSA yet.',
  },
  {
    key: 'agreement_signed',
    label: 'Sale agreement signed',
    who: 'Both parties',
    blurb: 'Signed by both sides and scanned as a PDF. NTSA will not proceed without it.',
  },
  {
    key: 'seller_applied',
    label: 'Seller has applied',
    who: 'Dealership',
    blurb: 'Lodged on eCitizen against the buyer\'s ID or company PIN. The buyer now has to approve it.',
  },
  {
    key: 'buyer_approved',
    label: 'Buyer has approved',
    who: 'Buyer',
    blurb: 'Approved from the buyer\'s eCitizen notifications. NTSA is now processing.',
  },
  {
    key: 'elogbook_issued',
    label: 'Digital logbook issued',
    who: 'NTSA',
    blurb: 'The eLogbook is in the buyer\'s eCitizen account. They are the registered owner.',
  },
  {
    key: 'physical_received',
    label: 'Physical logbook received',
    who: 'Buyer',
    blurb: 'The printed logbook has arrived. Nothing further is outstanding.',
  },
];

const INDEX = Object.fromEntries(STAGES.map((s, i) => [s.key, i]));

/* What NTSA actually charges, by engine size, plus the one-off sticker. Published, so a
   customer can be told the real figure instead of "there will be some fees". */
const NTSA_FEES = [
  { upToCc: 1000, fee: 2210 },
  { upToCc: 1200, fee: 3050 },
  { upToCc: 1500, fee: 3560 },
  { upToCc: 2000, fee: 4235 },
  { upToCc: 3000, fee: 5410 },
  { upToCc: Infinity, fee: 6465 },
];
const ESTICKER_FEE = 750;

/** Indicative NTSA cost for this engine size. */
function transferCost(engineCc) {
  const cc = Number(engineCc) || 0;
  const band = NTSA_FEES.find((b) => cc <= b.upToCc) || NTSA_FEES[NTSA_FEES.length - 1];
  return {
    ntsaFee: band.fee,
    esticker: ESTICKER_FEE,
    total: band.fee + ESTICKER_FEE,
    basis: 'NTSA transfer fee by engine capacity, plus the one-off Esticker. Indicative — confirm on eCitizen.',
  };
}

/**
 * Where this sale has got to, and who is holding it up.
 *
 * `waitingOn` is the only field anyone actually reads. A progress bar that does not say
 * whose move it is just tells a worried customer that something is happening somewhere.
 */
function statusFor(app, vehicle) {
  const current = app.transfer_stage || 'not_started';
  const i = INDEX[current] != null ? INDEX[current] : 0;
  const next = STAGES[i + 1] || null;

  const started = app.transfer_started_at ? new Date(app.transfer_started_at) : null;
  const days = started ? Math.floor((Date.now() - started.getTime()) / 864e5) : null;

  /* NTSA quotes about three working days to the eLogbook and seven to ten more for the
     printed one. Past that, somebody should be chasing rather than waiting. */
  const slow =
    days != null &&
    ((current === 'buyer_approved' && days > 5) ||
      (current === 'elogbook_issued' && days > 14) ||
      (current === 'seller_applied' && days > 3));

  return {
    stage: current,
    label: STAGES[i].label,
    blurb: STAGES[i].blurb,
    step: i,
    total: STAGES.length - 1,
    done: current === 'physical_received',
    waitingOn: next ? next.who : null,
    nextLabel: next ? next.label : null,
    daysSinceStarted: days,
    slow,
    slowNote: slow ? 'This has taken longer than NTSA normally needs. Worth chasing.' : null,
    note: app.transfer_note || null,
    cost: transferCost(vehicle && vehicle.engine_cc),
    stages: STAGES.map((s, n) => ({ ...s, reached: n <= i })),
  };
}

/**
 * Move a sale to a new stage.
 *
 * Forward only. A transfer that appears to go backwards is almost always somebody
 * mis-clicking, and a customer watching their logbook retreat a step loses whatever
 * confidence the screen was there to build. Correcting a genuine mistake is a
 * conversation, not a button.
 */
function advance(appId, stage, note, actor) {
  if (INDEX[stage] == null) return { ok: false, reason: 'Unknown stage.' };
  const app = get('SELECT * FROM applications WHERE id=?', [appId]);
  if (!app) return { ok: false, reason: 'Application not found.' };

  const from = app.transfer_stage || 'not_started';
  if (INDEX[stage] < INDEX[from]) {
    return { ok: false, reason: `Already at "${STAGES[INDEX[from]].label}". A transfer does not go backwards.` };
  }

  run(
    `UPDATE applications
        SET transfer_stage=?, transfer_note=?,
            transfer_started_at=COALESCE(transfer_started_at, ?),
            updated_at=?
      WHERE id=?`,
    [stage, note || app.transfer_note || null, new Date().toISOString(), new Date().toISOString(), appId]
  );

  insert('application_events', {
    application_id: appId,
    type: 'transfer',
    actor: actor || 'Dealership',
    message: `Logbook transfer: ${STAGES[INDEX[stage]].label}.${note ? ' ' + note : ''}`,
  });

  return { ok: true, status: statusFor(get('SELECT * FROM applications WHERE id=?', [appId]), null) };
}

/** Every sale with a transfer still outstanding, oldest first — the chase list. */
function outstanding(dealerId) {
  const rows = all(
    `SELECT a.*, v.engine_cc, v.reg_no
       FROM applications a
       LEFT JOIN vehicles v ON v.id = a.vehicle_id
      WHERE a.dealer_id = ?
        AND a.status IN ('disbursed','completed')
        AND COALESCE(a.transfer_stage,'not_started') <> 'physical_received'
      ORDER BY a.transfer_started_at IS NULL, a.transfer_started_at ASC`,
    [dealerId]
  );
  return rows.map((r) => ({ id: r.id, ref: r.ref, regNo: r.reg_no, status: statusFor(r, r) }));
}

module.exports = { STAGES, statusFor, advance, outstanding, transferCost, NTSA_FEES, ESTICKER_FEE };
