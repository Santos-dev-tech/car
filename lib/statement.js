'use strict';
/**
 * MotoKE — the monthly statement. What each payer owes, itemised, so getting paid is a
 * reconciliation rather than an argument.
 *
 * Three parties pay this platform and none of them pay per deal as the deal happens:
 *
 *   THE BANK pays a fee on every deal they funded. They add the month up, reconcile it
 *   against their own book, and settle one amount 30 to 60 days later. Whoever sends the
 *   clearer list wins every disagreement, and without a list you are arguing from memory
 *   against a bank's spreadsheet.
 *
 *   THE DEALERSHIP pays per funded deal too, scaled by the price of the car — a yard
 *   moving Vitzes cannot pay the same as one moving Land Cruisers, and a flat fee makes
 *   the cheap end of their stock not worth putting through the system.
 *
 *   THE INSURER pays commission on each policy plus whatever their slot costs.
 *
 * A STATEMENT IS FROZEN WHEN IT IS ISSUED. This is the part that matters and the part
 * that is easy to get wrong. A live query re-run in March gives a different answer for
 * January than it gave in February — a deal was cancelled, a price was corrected, a
 * policy lapsed — and an invoice whose total moves after it was sent is worthless. So
 * issuing writes the lines and the total into the row, and everything afterwards reads
 * the snapshot rather than recomputing it.
 *
 * FUNDED IS A DATE, NOT A STATUS. A deal that reached disbursed in January belongs in
 * January's statement whatever happens to it in March. That is why applications carry
 * funded_at, stamped once when the status first reaches disbursed and never rewritten.
 */

const { all, get } = require('./db');
const insLib = require('./insurance');

/** What the dealership pays per funded deal, by what the car cost. */
const DEFAULT_BANDS = [
  { upTo: 1_500_000, fee: 2_500 },
  { upTo: 3_500_000, fee: 5_000 },
  { upTo: Infinity, fee: 10_000 },
];

const round = (n) => Math.round(Number(n) || 0);
const money = (n) => 'KES ' + round(n).toLocaleString('en-KE');

/** The first and last instant of a YYYY-MM, as ISO strings. */
function period(p) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(p || ''));
  const now = new Date();
  const year = m ? Number(m[1]) : now.getUTCFullYear();
  const month = m ? Number(m[2]) - 1 : now.getUTCMonth();
  const from = new Date(Date.UTC(year, month, 1));
  const to = new Date(Date.UTC(year, month + 1, 1));
  return {
    key: `${year}-${String(month + 1).padStart(2, '0')}`,
    from: from.toISOString(),
    to: to.toISOString(),
    label: from.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
  };
}

/** The fee band this car falls in. */
function bandFee(price, bands) {
  const list = bands && bands.length ? bands : DEFAULT_BANDS;
  const p = round(price);
  for (const b of list) if (p <= b.upTo) return b.fee;
  return list[list.length - 1].fee;
}

/**
 * Deals funded inside the period.
 *
 * Scoped on funded_at rather than on status so a statement for a closed month cannot be
 * changed by something that happens later. A deal cancelled in March was still funded in
 * January and the bank was still paid for it in January.
 */
function fundedIn(dealerId, { from, to }, lenderId) {
  const args = [dealerId, from, to];
  let sql =
    `SELECT a.*, l.name lender_name
       FROM applications a LEFT JOIN lenders l ON l.id = a.lender_id
      WHERE a.dealer_id=? AND a.funded_at >= ? AND a.funded_at < ?`;
  if (lenderId) {
    sql += ' AND a.lender_id=?';
    args.push(lenderId);
  }
  return all(sql + ' ORDER BY a.funded_at', args);
}

const title = (a) => {
  try {
    return (JSON.parse(a.vehicle_snapshot || '{}') || {}).title || null;
  } catch {
    return null;
  }
};
const applicantName = (a) => {
  try {
    return (JSON.parse(a.applicant || '{}') || {}).fullName || null;
  } catch {
    return null;
  }
};

/**
 * What a bank owes for one month.
 *
 * The greater of a flat fee and a percentage of what they actually lent. A percentage
 * alone makes a small loan not worth processing; a flat fee alone gives away the large
 * ones. Both, and take whichever is bigger, is the arrangement a bank recognises because
 * it is how they price their own facility fees.
 */
function bankStatement(dealerId, lender, p, opts = {}) {
  const per = round(opts.perDeal != null ? opts.perDeal : 10_000);
  const pctOfLoan = Number(opts.pctOfLoan != null ? opts.pctOfLoan : 0.5);
  const rows = fundedIn(dealerId, p, lender && lender.id);

  const lines = rows.map((a) => {
    const financed = round(a.loan_amount || 0);
    const byPct = round((financed * pctOfLoan) / 100);
    const fee = Math.max(per, byPct);
    return {
      ref: a.ref,
      date: (a.funded_at || '').slice(0, 10),
      customer: applicantName(a),
      vehicle: title(a),
      price: round(a.price),
      financed,
      basis: byPct > per ? `${pctOfLoan}% of ${money(financed)}` : `flat fee`,
      amount: fee,
    };
  });

  return statement({
    payerType: 'bank',
    payerName: lender ? lender.name : 'All lenders',
    payerId: lender ? lender.id : null,
    p,
    lines,
    terms:
      `${money(per)} per funded deal, or ${pctOfLoan}% of the amount financed, whichever is greater.`,
    note:
      'Every deal listed was funded inside the period and is evidenced in the platform by a '
      + 'signed sale agreement, a confirmed settlement and a recorded handover.',
  });
}

/** What the dealership owes for one month. Only funded deals — never a lead, never a view. */
function dealerStatement(dealerId, dealer, p, opts = {}) {
  const bands = opts.bands || DEFAULT_BANDS;
  const rows = fundedIn(dealerId, p);
  const lines = rows.map((a) => ({
    ref: a.ref,
    date: (a.funded_at || '').slice(0, 10),
    customer: applicantName(a),
    vehicle: title(a),
    price: round(a.price),
    lender: a.lender_name || null,
    basis: 'funded deal',
    amount: bandFee(a.price, bands),
  }));

  return statement({
    payerType: 'dealer',
    payerName: dealer ? dealer.name : 'The dealership',
    payerId: dealer ? dealer.id : null,
    p,
    lines,
    terms: bands
      .map((b, i) => (b.upTo === Infinity
        ? `over ${money(bands[i - 1].upTo)}: ${money(b.fee)}`
        : `up to ${money(b.upTo)}: ${money(b.fee)}`))
      .join(' · '),
    note:
      'Charged on funded deals only. Nothing is charged for a lead, an enquiry, a '
      + 'pre-qualification or a deal that did not complete.',
  });
}

/**
 * What an insurer owes for one month: commission on policies that went on risk, plus
 * whatever the slot costs.
 *
 * Commission is counted from the day cover STARTED, not the day the quote was accepted.
 * A policy nobody put on risk earns nothing, and dating it from the quote would invoice
 * an insurer for business they declined.
 */
function insurerStatement(dealerId, insurer, p, opts = {}) {
  const rows = all(
    `SELECT * FROM policies
      WHERE dealer_id=? AND insurer_id=? AND status IN ('active','renewed')
        AND starts >= ? AND starts < ?
      ORDER BY starts`,
    [dealerId, insurer.id, p.from.slice(0, 10), p.to.slice(0, 10)]
  );

  const rate = insLib.commissionRate(insurer);
  const lines = rows.map((r) => ({
    ref: r.ref,
    date: r.starts,
    customer: r.customer_name,
    vehicle: r.vehicle_title,
    policyNo: r.policy_no,
    premium: round(r.premium),
    basis: `${rate}% of ${money(r.premium)}${r.renewal_of ? ' (renewal)' : ''}`,
    amount: round(r.commission),
  }));

  const slot = round(opts.monthlyFee != null ? opts.monthlyFee : insurer.monthly_fee);
  if (slot > 0) {
    lines.push({
      ref: 'SLOT-' + p.key,
      date: p.to.slice(0, 10),
      customer: null,
      vehicle: null,
      basis: insurer.slot_exclusive ? 'exclusive panel slot' : 'panel slot',
      amount: slot,
    });
  }

  return statement({
    payerType: 'insurer',
    payerName: insurer.name,
    payerId: insurer.id,
    p,
    lines,
    terms: `${rate}% commission on premium, the legal maximum for motor business`
      + (slot ? `, plus ${money(slot)} a month for the panel slot.` : '.'),
    note:
      'Commission is claimed on policies that went on risk inside the period. Premiums are '
      + 'paid by the policyholder to the insurer direct — this platform receives no premium '
      + 'at any point.',
  });
}

/** The common shape. Every statement is a list of lines and one number at the bottom. */
function statement({ payerType, payerName, payerId, p, lines, terms, note }) {
  const total = lines.reduce((n, l) => n + (Number(l.amount) || 0), 0);
  return {
    payerType,
    payerName,
    payerId,
    period: p.key,
    periodLabel: p.label,
    from: p.from,
    to: p.to,
    lines,
    count: lines.length,
    total: round(total),
    terms,
    note,
    /* When they should pay, said as a date rather than as "monthly" - which means nothing
       at all when you are the one chasing it six weeks later. */
    dueBy: dueDate(p),
  };
}

/** The 15th of the month after the period. */
function dueDate(p) {
  const end = new Date(p.to);
  return new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 15)).toISOString().slice(0, 10);
}

/** Comma-separated, for the finance department that wants it in a spreadsheet. */
function toCsv(s) {
  const esc = (v) => {
    if (v == null) return '';
    const str = String(v);
    return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
  };
  const head = ['Reference', 'Date', 'Customer', 'Vehicle', 'Basis', 'Amount (KES)'];
  const body = s.lines.map((l) => [l.ref, l.date, l.customer, l.vehicle, l.basis, l.amount].map(esc).join(','));
  return [
    `${s.payerName} — ${s.periodLabel}`,
    `Due by,${s.dueBy}`,
    '',
    head.join(','),
    ...body,
    '',
    `,,,,Total,${s.total}`,
  ].join('\n');
}

module.exports = {
  period,
  bandFee,
  fundedIn,
  bankStatement,
  dealerStatement,
  insurerStatement,
  dueDate,
  toCsv,
  DEFAULT_BANDS,
};
