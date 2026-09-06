'use strict';
/**
 * MotoKE — add the reception demo account to a database that predates the role.
 *
 * `seed.js` creates it on a fresh install; this brings an existing one into line without
 * a reset. Safe to re-run.
 *
 *   node --no-warnings tools/add-receptionist.js
 */
const { get, insert, getSetting } = require('../lib/db');
const { hashPassword } = require('../lib/auth');

const EMAIL = 'janet@summitmotors.demo';

if (get('SELECT id FROM users WHERE email=?', [EMAIL])) {
  console.log('\n  Reception account already exists.\n');
  process.exit(0);
}

const dealer = get('SELECT id, name FROM dealers WHERE slug=?', [getSetting('site_dealer', 'summit')]);
if (!dealer) {
  console.log('\n  No site dealership found.\n');
  process.exit(1);
}

const { hash, salt } = hashPassword('demo123');
const id = insert('users', {
  name: 'Janet Muthoni',
  email: EMAIL,
  role: 'receptionist',
  dealer_id: dealer.id,
  password_hash: hash,
  salt,
  active: 1,
});

console.log(`\n  Reception account #${id} created for ${dealer.name}.`);
console.log(`  ${EMAIL} / demo123 — sees the diary and the enquiries, nothing else.\n`);
