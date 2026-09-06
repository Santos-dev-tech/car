'use strict';
/**
 * MotoKE - online payments and offer letters.
 *
 * Payments: a customer reserves a car by paying a booking deposit. The provider layer is
 * pluggable — a real M-Pesa Daraja STK push drops straight in where the simulator sits,
 * which is why every provider returns the same shape. Nothing here ever sees a card PAN
 * or an M-Pesa PIN: the customer authorises on their own handset or at the gateway.
 */
const crypto = require('node:crypto');
const { all, get, run, insert, update, getSetting } = require('./db');

const round = (n) => Math.round(n);

/* ------------------------------------------------------------------ */
/* pricing the booking                                                  */
/* ------------------------------------------------------------------ */

/**
 * What it costs to hold a car. A percentage of the price with a floor and a ceiling,
 * so a 900k Vitz and a 9M Land Cruiser both land somewhere sensible.
 */
function bookingFee(price) {
  const pct = Number(getSetting('booking_fee_pct', 2));
  const min = Number(getSetting('booking_fee_min', 20000));
  const max = Number(getSetting('booking_fee_max', 150000));
  const raw = (Number(price) || 0) * (pct / 100);
  return round(Math.min(max, Math.max(min, raw)));
}

function holdDays() {
  return Number(getSetting('booking_hold_days', 7));
}

/* ------------------------------------------------------------------ */
/* providers                                                            */
/* ------------------------------------------------------------------ */

/**
 * M-Pesa STK push.
 *
 * With Daraja credentials configured this posts to Safaricom and returns their
 * CheckoutRequestID. Without them it runs a faithful simulation so the whole flow —
 * pending, callback, receipt, vehicle held — can be demonstrated end to end.
 */
async function mpesaStkPush({ phone, amount, reference, description }) {
  const shortcode = getSetting('mpesa_shortcode', '');
  const key = process.env.MPESA_CONSUMER_KEY;
  const secret = process.env.MPESA_CONSUMER_SECRET;

  if (shortcode && key && secret) {
    // Real Daraja call. Credentials come from the environment, never the database,
    // and never reach the browser.
    try {
      const base = getSetting('mpesa_base_url', 'https://sandbox.safaricom.co.ke');
      const auth = Buffer.from(`${key}:${secret}`).toString('base64');
      const tokenRes = await fetch(`${base}/oauth/v1/generate?grant_type=client_credentials`, {
        headers: { Authorization: `Basic ${auth}` },
      });
      const { access_token } = await tokenRes.json();
      const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
      const passkey = process.env.MPESA_PASSKEY || '';
      const password = Buffer.from(`${shortcode}${passkey}${stamp}`).toString('base64');
      const res = await fetch(`${base}/mpesa/stkpush/v1/processrequest`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          BusinessShortCode: shortcode,
          Password: password,
          Timestamp: stamp,
          TransactionType: 'CustomerPayBillOnline',
          Amount: Math.round(amount),
          PartyA: String(phone).replace(/\D/g, ''),
          PartyB: shortcode,
          PhoneNumber: String(phone).replace(/\D/g, ''),
          CallBackURL: getSetting('mpesa_callback_url', ''),
          AccountReference: reference,
          TransactionDesc: description,
        }),
      });
      const json = await res.json();
      if (json.ResponseCode === '0') {
        return { ok: true, simulated: false, providerRef: json.CheckoutRequestID, message: json.CustomerMessage };
      }
      return { ok: false, simulated: false, error: json.errorMessage || json.ResponseDescription || 'M-Pesa declined the request' };
    } catch (e) {
      return { ok: false, simulated: false, error: `Could not reach M-Pesa: ${e.message}` };
    }
  }

  // Simulator: same shape, no network.
  return {
    ok: true,
    simulated: true,
    providerRef: 'SIM-' + crypto.randomBytes(6).toString('hex').toUpperCase(),
    message: `A payment request for KES ${round(amount).toLocaleString()} has been sent to ${phone}. Enter your M-Pesa PIN on your handset to authorise it.`,
  };
}

/** Card and bank transfer are recorded as pending until the desk confirms settlement. */
async function offlineIntent({ method, amount, reference }) {
  return {
    ok: true,
    simulated: true,
    providerRef: (method === 'card' ? 'CARD-' : 'BNK-') + crypto.randomBytes(5).toString('hex').toUpperCase(),
    message:
      method === 'card'
        ? 'You will be redirected to the payment gateway to authorise this card payment.'
        : `Transfer KES ${round(amount).toLocaleString()} quoting reference ${reference}. We will confirm within one working day.`,
  };
}

const PROVIDERS = { mpesa: mpesaStkPush, card: offlineIntent, bank_transfer: offlineIntent, cash: offlineIntent };

/* ------------------------------------------------------------------ */
/* orders                                                               */
/* ------------------------------------------------------------------ */

function newOrderRef() {
  const d = new Date();
  return `BK-${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}-${crypto
    .randomBytes(3)
    .toString('hex')
    .toUpperCase()}`;
}

function receiptNo() {
  return 'R' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

function event(orderId, type, message, payload) {
  insert('payment_events', {
    order_id: orderId,
    type,
    message: message || null,
    payload: payload ? JSON.stringify(payload) : null,
  });
}

/**
 * Mark an order paid: stamp the receipt, hold the vehicle, and record the event.
 * Idempotent — a repeated callback will not double-reserve or re-stamp.
 */
function markPaid(order, { providerRef, receipt } = {}) {
  const fresh = get('SELECT * FROM orders WHERE id=?', [order.id]);
  if (!fresh || fresh.status === 'paid') return fresh;

  const now = new Date().toISOString();
  const hold = new Date(Date.now() + holdDays() * 864e5).toISOString();
  update('orders', fresh.id, {
    status: 'paid',
    paid_at: now,
    receipt_no: receipt || receiptNo(),
    provider_ref: providerRef || fresh.provider_ref,
    hold_until: hold,
  });
  if (fresh.vehicle_id) {
    run("UPDATE vehicles SET status='reserved' WHERE id=? AND status='available'", [fresh.vehicle_id]);
  }
  event(fresh.id, 'paid', 'Payment confirmed. Vehicle held.', { providerRef });
  return get('SELECT * FROM orders WHERE id=?', [fresh.id]);
}

function markFailed(order, reason) {
  update('orders', order.id, { status: 'failed' });
  event(order.id, 'failed', reason || 'Payment was not completed.');
  return get('SELECT * FROM orders WHERE id=?', [order.id]);
}

/** Release cars whose hold has lapsed without the sale completing. */
function releaseExpiredHolds() {
  const now = new Date().toISOString();
  const stale = all("SELECT * FROM orders WHERE status='paid' AND hold_until IS NOT NULL AND hold_until < ?", [now]);
  let released = 0;
  for (const o of stale) {
    if (o.vehicle_id) {
      const v = get('SELECT status FROM vehicles WHERE id=?', [o.vehicle_id]);
      if (v && v.status === 'reserved') {
        run("UPDATE vehicles SET status='available' WHERE id=?", [o.vehicle_id]);
        released++;
      }
    }
    update('orders', o.id, { status: 'cancelled' });
    event(o.id, 'expired', 'Hold lapsed; vehicle returned to stock.');
  }
  return { released, checked: stale.length };
}

/* ------------------------------------------------------------------ */
/* offer letter                                                         */
/* ------------------------------------------------------------------ */

const money = (n) => 'KES ' + Math.round(Number(n) || 0).toLocaleString('en-KE');
const dateLong = (d = new Date()) =>
  d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * Build the offer letter for an application. Returns structured content the client
 * renders and prints — keeping the numbers server-side means the customer cannot edit
 * the letter's figures before printing it.
 */
function offerLetter({ application, dealer, lender, vehicle, offer, branch }) {
  const ref = application.offer_letter_ref || 'OL-' + application.ref.replace(/^MK-/, '');
  const today = new Date();
  const expiry = new Date(Date.now() + 14 * 864e5);
  const applicant = typeof application.applicant === 'string' ? JSON.parse(application.applicant) : application.applicant || {};

  const schedule = [
    ['Vehicle', vehicle && vehicle.title ? vehicle.title : '—'],
    ['Registration / VIN', (vehicle && (vehicle.reg_no || vehicle.vin)) || 'To be advised on registration'],
    ['Purchase price', money(application.price)],
    ['Deposit payable by you', money(application.deposit)],
    ['Amount financed', money(application.loan_amount)],
    ['Financier', lender ? lender.name : '—'],
    ['Interest rate', lender ? `${lender.annual_rate}% per annum, ${lender.rate_type === 'flat' ? 'flat' : 'on a reducing balance'}` : '—'],
    ['Repayment period', `${application.tenor_months} months`],
    ['Monthly instalment', money(application.monthly_payment)],
    ['Total repayable', money(offer && offer.totalRepaid ? offer.totalRepaid : application.monthly_payment * application.tenor_months)],
    ['Indicative APR', offer && offer.apr ? `${offer.apr}%` : '—'],
  ];

  const fees = (offer && offer.fees) || [];
  const conditions = [
    'This offer is subject to the financier’s own credit approval, satisfactory verification of the documents you have supplied, and a clear CRB report.',
    'Comprehensive motor insurance must be in place before the vehicle is released, with the financier noted as the interested party.',
    'The vehicle remains the property of the dealership until the purchase price is received in full and, where financed, until the financier disburses.',
    `The deposit of ${money(application.deposit)} is payable before delivery. A booking deposit already paid is credited against it.`,
    `This offer is open for acceptance until ${dateLong(expiry)} and lapses automatically thereafter.`,
    'Figures quoted are indicative and may be adjusted by the financier following its own assessment.',
  ];

  return {
    ref,
    issuedOn: today.toISOString(),
    issuedOnLabel: dateLong(today),
    expiresOn: expiry.toISOString(),
    expiresOnLabel: dateLong(expiry),
    dealer: {
      name: dealer.name,
      address: [branch && branch.address, branch && branch.city, dealer.address].filter(Boolean).join(', '),
      phone: dealer.phone,
      email: dealer.email,
      logoText: dealer.logo_text,
    },
    customer: {
      name: applicant.fullName || '—',
      address: applicant.address || '',
      phone: applicant.phone || '',
      email: applicant.email || '',
      idNumber: applicant.idNumber || '',
    },
    applicationRef: application.ref,
    schedule,
    fees: fees.map((f) => [f.label, money(f.amount)]),
    insurance: offer && offer.insurance ? money(offer.insurance) : null,
    cashUpfront: offer && offer.cashUpfront ? money(offer.cashUpfront) : money(application.deposit),
    conditions,
    salutation: `Dear ${(applicant.fullName || 'Customer').split(' ')[0]},`,
    subject: `Offer of sale — ${vehicle && vehicle.title ? vehicle.title : 'motor vehicle'}`,
    body: [
      `Further to your application reference ${application.ref}, we are pleased to offer you the vehicle described below on the terms set out in the schedule.`,
      lender
        ? `We have arranged asset finance for this purchase with ${lender.name}, who have indicated approval subject to their standard conditions.`
        : 'This offer is made on a cash basis.',
      'Please sign and return one copy of this letter to accept. We will then confirm a delivery date and prepare the transfer documents.',
    ],
  };
}

module.exports = {
  bookingFee, holdDays, PROVIDERS, mpesaStkPush,
  newOrderRef, receiptNo, event, markPaid, markFailed, releaseExpiredHolds,
  offerLetter,
};
