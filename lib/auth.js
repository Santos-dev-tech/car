'use strict';
/** MotoKE - sessions and password hashing (node:crypto scrypt, no dependencies). */
const crypto = require('node:crypto');
const { get, run, insert, update } = require('./db');

const SESSION_DAYS = 14;

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const candidate = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  insert('sessions', { token, user_id: userId, expires_at: expires });
  update('users', userId, { last_login: new Date().toISOString() });
  return { token, expires };
}

function destroySession(token) {
  if (token) run('DELETE FROM sessions WHERE token=?', [token]);
}

function userFromToken(token) {
  if (!token) return null;
  const row = get(
    `SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND u.active = 1`,
    [token]
  );
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    destroySession(token);
    return null;
  }
  delete row.password_hash;
  delete row.salt;
  return row;
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function tokenFrom(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return parseCookies(req).motoke_session || null;
}

const STAFF_ROLES = ['superadmin', 'dealer_admin', 'finance_officer', 'sales_agent', 'receptionist'];
const isStaff = (u) => !!u && STAFF_ROLES.includes(u.role);

/**
 * What each job actually needs, and nothing else.
 *
 * Every staff role used to see every screen, because the only check was "is this person
 * staff". That is wrong in a car yard: a finance officer has no business editing stock
 * prices, and the person on reception should not be reading customers' ID numbers and
 * income statements to book a test drive.
 *
 * These are enforced on the SERVER. The console hides what you cannot use, but hiding a
 * menu item is decoration — `requirePerm` in api.js is the actual boundary.
 *
 *   overview          the business dashboard: revenue, conversion, pipeline value
 *   inventory         see the stock list
 *   inventory.write   add, edit, price and delete cars
 *   ageing            stock ageing and the repricing list
 *   applications      open a credit application — contains ID numbers, KRA PINs, payslips
 *   applications.decide  move it through the stages, restructure it, re-quote it
 *   assign            hand any work item — application, lead, pre-qualification — to a
 *                     named member of staff. Deliberately separate from doing the work:
 *                     a caseworker quietly moving files onto a colleague is how
 *                     accountability for a customer's money disappears. Claiming an
 *                     unassigned item for YOURSELF needs no permission; that is just
 *                     picking up the phone.
 *   prequal           pre-qualification screenings
 *   bookings          deposits taken, and the test-drive diary
 *   leads             enquiries and callbacks
 *   lenders           see the lender panel and its rules
 *   lenders.write     change a lender's published rates and fees
 *   costs             running-cost assumptions used across the site
 *   dealership        branding, branches, opening hours, the return policy
 *   staff             create and disable staff accounts
 *   audit             the activity log
 */
const ROLE_PERMISSIONS = {
  superadmin: ['*'],

  /* The principal or general manager. Runs the yard, but a bank's published rates are a
     platform-level record, not something one dealership edits for everybody. */
  dealer_admin: [
    'overview', 'inventory', 'inventory.write', 'ageing',
    'applications', 'applications.decide', 'assign', 'prequal',
    'bookings', 'leads', 'lenders', 'dealership', 'staff', 'audit',
  ],

  /* Works the deals. Needs the lender panel to restructure a declined application, and
     needs nothing at all from the stock screens — pricing cars is not their job. */
  finance_officer: [
    'applications', 'applications.decide', 'prequal', 'lenders', 'bookings',
  ],

  /* Sells cars. Lives in stock, leads and the diary. Sees applications so they know where
     their customer stands, but does not decide them. */
  sales_agent: [
    'inventory', 'inventory.write', 'ageing', 'leads', 'bookings', 'prequal', 'applications',
  ],

  /* The front desk. Books people in and takes messages. Deliberately narrow: this role
     should not be reading anybody's financial or identity documents. */
  receptionist: ['bookings', 'leads'],
};

/** Does this user hold a capability? */
function can(user, perm) {
  if (!user) return false;
  const list = ROLE_PERMISSIONS[user.role];
  if (!list) return false;
  if (list.includes('*')) return true;
  if (list.includes(perm)) return true;
  /* Holding `inventory.write` implies holding `inventory` — otherwise every caller has to
     remember to check both, and one day somebody forgets. */
  if (perm.includes('.')) return false;
  return list.some((p) => p.split('.')[0] === perm);
}

/** Everything this user can do, for the console to build its menu from. */
function permissionsFor(user) {
  if (!user) return [];
  const list = ROLE_PERMISSIONS[user.role] || [];
  if (!list.includes('*')) return list;
  return [...new Set(Object.values(ROLE_PERMISSIONS).flat().filter((p) => p !== '*'))];
}
const canManageDealer = (u, dealerId) =>
  !!u && (u.role === 'superadmin' || (isStaff(u) && Number(u.dealer_id) === Number(dealerId)));

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  userFromToken,
  tokenFrom,
  parseCookies,
  isStaff,
  canManageDealer,
  can,
  permissionsFor,
  ROLE_PERMISSIONS,
  STAFF_ROLES,
  SESSION_DAYS,
};
