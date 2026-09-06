'use strict';
/**
 * MotoKE — Firebase ID token verification tests. No server, no network.
 *
 * We mint our own RSA key, sign tokens with it, and inject the certificate into the
 * module's cache so verification runs the real code path offline. Then we try to forge
 * our way past it. Every test below is an attack that works against a verifier that
 * skips one check.
 *
 *   node --no-warnings tools/firebase-test.js
 */
const crypto = require('node:crypto');

process.env.MOTOKE_FIREBASE_PROJECT = 'car99-e2768';
const fb = require('../lib/firebase');

const PROJECT = 'car99-e2768';
const KID = 'test-key-1';

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) {
    pass++;
    console.log('  ok    ' + name);
  } else {
    fail++;
    console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : ''));
  }
}

/* A throwaway key pair plus a self-signed certificate standing in for Google's. */
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const OTHER = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

/** node:crypto has no certificate builder, so verifyIdToken is given a public key PEM,
    which createPublicKey accepts exactly as it accepts a certificate. */
const CERT = publicKey.export({ type: 'spki', format: 'pem' });
const OTHER_CERT = OTHER.publicKey.export({ type: 'spki', format: 'pem' });

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

function mint(claimOverrides = {}, { key = privateKey, header = {} } = {}) {
  const nowSec = Math.floor(Date.now() / 1000);
  const head = { alg: 'RS256', kid: KID, typ: 'JWT', ...header };
  const claims = {
    aud: PROJECT,
    iss: `https://securetoken.google.com/${PROJECT}`,
    sub: 'uid-abc-123',
    iat: nowSec - 30,
    auth_time: nowSec - 30,
    exp: nowSec + 3600,
    email: 'Buyer@Example.com',
    email_verified: true,
    name: 'Test Buyer',
    picture: 'https://lh3.googleusercontent.com/a/photo.jpg',
    firebase: { sign_in_provider: 'google.com' },
    ...claimOverrides,
  };
  const signing = `${b64(head)}.${b64(claims)}`;
  if (key === null) return `${signing}.`; // unsigned
  const sig = crypto.sign('RSA-SHA256', Buffer.from(signing), key).toString('base64url');
  return `${signing}.${sig}`;
}

/* Serve our certificate instead of Google's, without touching the network. */
function loadCerts(map = { [KID]: CERT }) {
  fb.clearCertCache();
  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: (h) => (h.toLowerCase() === 'cache-control' ? 'public, max-age=3600' : null) },
    json: async () => map,
  });
}

async function rejects(name, token, expected) {
  try {
    await fb.verifyIdToken(token);
    ok(name, false, 'it was ACCEPTED');
  } catch (e) {
    ok(name, expected ? new RegExp(expected, 'i').test(e.message) : true, e.message);
  }
}

(async () => {
  console.log('\n— a good token —');
  loadCerts();
  const claims = await fb.verifyIdToken(mint());
  ok('a properly signed token verifies', claims.sub === 'uid-abc-123');
  ok('and carries its claims through', claims.email === 'Buyer@Example.com');

  console.log('\n— forgeries —');
  loadCerts();
  await rejects('a token signed with somebody else\'s key', mint({}, { key: OTHER.privateKey }), 'signature');
  await rejects('alg: none', mint({}, { key: null, header: { alg: 'none' } }), 'algorithm');
  await rejects('alg swapped to HS256', mint({}, { header: { alg: 'HS256' } }), 'algorithm');
  await rejects('a token for a different Firebase project', mint({ aud: 'someone-elses-app' }), 'different Firebase project');
  await rejects('a token from the wrong issuer', mint({ iss: 'https://evil.example.com/' }), 'issuer');
  await rejects('a token naming an unpublished signing key', mint({}, { header: { kid: 'not-a-real-key' } }), 'not publishing');
  await rejects('a tampered payload', (() => {
    const t = mint().split('.');
    t[1] = b64({ aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, sub: 'somebody-else', exp: 9e9, iat: 1 });
    return t.join('.');
  })(), 'signature');

  console.log('\n— lifetime —');
  loadCerts();
  const nowSec = Math.floor(Date.now() / 1000);
  await rejects('an expired token', mint({ exp: nowSec - 3600 }), 'expired');
  await rejects('a token issued in the future', mint({ iat: nowSec + 3600 }), 'future');
  await rejects('a sign-in timestamped in the future', mint({ auth_time: nowSec + 3600 }), 'future');
  const nearlyExpired = await fb.verifyIdToken(mint({ exp: nowSec - 10 }));
  ok('a token seconds past expiry is allowed through on clock skew', nearlyExpired.sub === 'uid-abc-123');

  console.log('\n— malformed input —');
  loadCerts();
  await rejects('an empty string', '', 'no token');
  await rejects('a non-JWT string', 'hello', 'not a JWT');
  await rejects('two segments instead of three', 'aaa.bbb', 'not a JWT');
  await rejects('a header that is not JSON', 'bm90LWpzb24.bm90LWpzb24.x', 'Malformed');
  await rejects('null', null, 'No token');
  await rejects('a number', 12345, 'No token');
  await rejects('a token with no subject', mint({ sub: '' }), 'user id');
  await rejects('a token with an absurd subject', mint({ sub: 'x'.repeat(200) }), 'user id');

  console.log('\n— key rotation —');
  loadCerts({ 'old-key': OTHER_CERT });
  let refetched = 0;
  fb.clearCertCache();
  global.fetch = async () => {
    refetched++;
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'public, max-age=3600' },
      json: async () => (refetched === 1 ? { 'old-key': OTHER_CERT } : { [KID]: CERT }),
    };
  };
  const afterRotation = await fb.verifyIdToken(mint());
  ok('an unknown key id triggers one refetch, then verifies', afterRotation.sub === 'uid-abc-123');
  ok('and it refetched exactly once', refetched === 2, String(refetched));

  console.log('\n— the profile we keep —');
  loadCerts();
  const p = fb.profileFrom(await fb.verifyIdToken(mint()));
  ok('the email is lowercased', p.email === 'buyer@example.com');
  ok('the provider is recorded', p.provider === 'google.com');
  ok('a verified email is marked verified', p.emailVerified === true);
  const spoof = fb.profileFrom(await fb.verifyIdToken(mint({ role: 'superadmin', dealer_id: 1 })));
  ok('a role claimed in the token is ignored', spoof.role === undefined && spoof.dealer_id === undefined);
  const httpPhoto = fb.profileFrom(await fb.verifyIdToken(mint({ picture: 'http://evil.example/x.jpg' })));
  ok('a non-https photo url is dropped', httpPhoto.photo === null);
  const longName = fb.profileFrom(await fb.verifyIdToken(mint({ name: 'n'.repeat(500) })));
  ok('an over-long display name is truncated', longName.name.length === 120);

  console.log('\n— switched off —');
  const savedProject = process.env.MOTOKE_FIREBASE_PROJECT;
  delete process.env.MOTOKE_FIREBASE_PROJECT;
  ok('with no project set, Firebase reports itself off', fb.enabled() === false);
  ok('and hands the browser no config', fb.clientConfig() === null);
  await rejects('and refuses to verify anything', mint(), 'not configured');
  process.env.MOTOKE_FIREBASE_PROJECT = savedProject;

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail);
})().catch((e) => {
  console.error('firebase test crashed:', e);
  process.exit(1);
});
