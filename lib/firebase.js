'use strict';
/**
 * MotoKE — Firebase ID token verification.
 *
 * The official way to do this is `firebase-admin`, which is an npm package with a large
 * dependency tree. This project has zero dependencies and `tools/audit.js` fails if that
 * stops being true, so the verification is done here with `node:crypto` against Google's
 * published signing certificates. It is the same algorithm the Admin SDK runs, written out.
 *
 * WHY VERIFY AT ALL: the browser sends a token it obtained from Google. Without checking
 * the signature, anyone can POST a hand-written JSON blob claiming to be any uid. The
 * signature is the only thing that makes the claim mean anything.
 *
 * A verified token gets a MotoKE session cookie — the same HttpOnly cookie the password
 * login issues. Firebase decides WHO you are; MotoKE still decides what you may do.
 */
const crypto = require('node:crypto');

const CERT_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

/** Set MOTOKE_FIREBASE_PROJECT to switch this on. Unset, every call below refuses. */
function projectId() {
  return process.env.MOTOKE_FIREBASE_PROJECT || null;
}
function enabled() {
  return !!projectId();
}

class TokenError extends Error {
  constructor(message) {
    super(message);
    this.status = 401;
  }
}

/* ------------------------------------------------------------------ */
/* Google's signing certificates                                       */
/* ------------------------------------------------------------------ */

let certCache = { keys: null, expires: 0 };

/**
 * Google rotates these roughly daily and tells us how long to keep them in the
 * Cache-Control header. Refetching per request would add a round trip to every sign-in
 * and would rate-limit us; never refetching would break the morning after a rotation.
 */
async function signingCerts({ force = false } = {}) {
  const now = Date.now();
  if (!force && certCache.keys && now < certCache.expires) return certCache.keys;

  const res = await fetch(CERT_URL);
  if (!res.ok) throw new TokenError(`Could not fetch Google signing certificates (${res.status})`);
  const keys = await res.json();

  const cc = res.headers.get('cache-control') || '';
  const maxAge = Number((cc.match(/max-age=(\d+)/) || [])[1] || 3600);
  certCache = { keys, expires: now + Math.max(60, maxAge) * 1000 };
  return keys;
}

/** Exposed so tests can start from a known state. */
function clearCertCache() {
  certCache = { keys: null, expires: 0 };
}

/* ------------------------------------------------------------------ */
/* JWT plumbing                                                        */
/* ------------------------------------------------------------------ */

function b64urlToBuffer(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function decodeSegment(seg, what) {
  let obj;
  try {
    obj = JSON.parse(b64urlToBuffer(seg).toString('utf8'));
  } catch {
    throw new TokenError(`Malformed token ${what}`);
  }
  if (!obj || typeof obj !== 'object') throw new TokenError(`Malformed token ${what}`);
  return obj;
}

/* ------------------------------------------------------------------ */
/* verification                                                        */
/* ------------------------------------------------------------------ */

/**
 * Verify a Firebase ID token and return its claims.
 *
 * Every check below is one the Admin SDK performs. Dropping any of them turns the token
 * from proof into a suggestion:
 *
 *   alg        must be RS256 — 'none' and HS256 are the classic JWT forgeries
 *   kid        must name a certificate Google is currently publishing
 *   signature  must verify against that certificate
 *   aud        must be OUR project, or a token minted for a different app would work here
 *   iss        must be Google's issuer for our project
 *   exp / iat  must place us inside the token's lifetime
 *   auth_time  must be in the past — the sign-in cannot have happened later than now
 *   sub        must be a usable uid
 */
async function verifyIdToken(token, { now = Date.now(), leewaySeconds = 60 } = {}) {
  const project = projectId();
  if (!project) throw new TokenError('Firebase sign-in is not configured on this server');
  if (typeof token !== 'string' || !token) throw new TokenError('No token supplied');

  const parts = token.split('.');
  if (parts.length !== 3) throw new TokenError('Token is not a JWT');

  const header = decodeSegment(parts[0], 'header');
  if (header.alg !== 'RS256') throw new TokenError(`Unexpected token algorithm: ${header.alg}`);
  if (!header.kid) throw new TokenError('Token does not name a signing key');

  // A rotation we have not picked up yet looks exactly like an unknown key, so on a miss
  // refetch once before deciding the token is bad.
  let certs = await signingCerts();
  if (!certs[header.kid]) certs = await signingCerts({ force: true });
  const cert = certs[header.kid];
  if (!cert) throw new TokenError('Token was signed with a key Google is not publishing');

  const signed = Buffer.from(`${parts[0]}.${parts[1]}`, 'utf8');
  const signature = b64urlToBuffer(parts[2]);
  let publicKey;
  try {
    publicKey = crypto.createPublicKey(cert);
  } catch {
    throw new TokenError('Google signing certificate could not be read');
  }
  if (!crypto.verify('RSA-SHA256', signed, publicKey, signature)) {
    throw new TokenError('Token signature is not valid');
  }

  const claims = decodeSegment(parts[1], 'payload');
  const nowSec = Math.floor(now / 1000);
  const skew = Math.max(0, leewaySeconds);

  if (claims.aud !== project) throw new TokenError('Token was issued for a different Firebase project');
  if (claims.iss !== `https://securetoken.google.com/${project}`) throw new TokenError('Token has the wrong issuer');
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 128) throw new TokenError('Token has no usable user id');
  if (typeof claims.exp !== 'number' || claims.exp + skew < nowSec) throw new TokenError('Token has expired — sign in again');
  if (typeof claims.iat !== 'number' || claims.iat - skew > nowSec) throw new TokenError('Token was issued in the future');
  if (claims.auth_time != null && claims.auth_time - skew > nowSec) throw new TokenError('Token reports a sign-in in the future');

  return claims;
}

/**
 * The subset of a verified token MotoKE stores against a user.
 *
 * Note what is NOT taken from the token: role and dealer. Those are ours. A token can say
 * anything Google was told during sign-up — a display name of "Admin" is not a promotion.
 */
function profileFrom(claims) {
  const provider =
    (claims.firebase && claims.firebase.sign_in_provider) || 'unknown';
  return {
    uid: claims.sub,
    email: typeof claims.email === 'string' ? claims.email.toLowerCase() : null,
    emailVerified: claims.email_verified === true,
    name: typeof claims.name === 'string' ? claims.name.slice(0, 120) : null,
    photo: typeof claims.picture === 'string' && /^https:\/\//.test(claims.picture) ? claims.picture : null,
    phone: typeof claims.phone_number === 'string' ? claims.phone_number : null,
    provider,
  };
}

/** The config the browser needs. Every value here is public by design. */
function clientConfig() {
  if (!enabled()) return null;
  return {
    apiKey: process.env.MOTOKE_FIREBASE_API_KEY || null,
    authDomain: process.env.MOTOKE_FIREBASE_AUTH_DOMAIN || `${projectId()}.firebaseapp.com`,
    projectId: projectId(),
    storageBucket: process.env.MOTOKE_FIREBASE_BUCKET || `${projectId()}.firebasestorage.app`,
    messagingSenderId: process.env.MOTOKE_FIREBASE_SENDER_ID || null,
    appId: process.env.MOTOKE_FIREBASE_APP_ID || null,
  };
}

module.exports = {
  enabled, projectId, clientConfig,
  verifyIdToken, profileFrom,
  signingCerts, clearCertCache,
  TokenError, CERT_URL,
};
