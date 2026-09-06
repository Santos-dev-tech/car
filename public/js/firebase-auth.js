/**
 * MotoKE — Firebase sign-in for customers.
 *
 * The flow, and why it is shaped this way:
 *
 *   1. The customer presses Google / Facebook / whatever.
 *   2. Firebase returns an ID token to the browser.
 *   3. We POST that token to our own server, which VERIFIES it and issues the normal
 *      MotoKE HttpOnly session cookie.
 *   4. We sign out of Firebase immediately.
 *
 * Step 4 surprises people. We do not keep a Firebase session in the browser because a
 * token sitting in IndexedDB is readable by any script that gets onto the page, and the
 * whole point of the HttpOnly cookie is that no script can read it. Firebase is the
 * doorman, not the key.
 *
 * The config arrives from /api/bootstrap rather than being typed in here, so the same
 * file runs against dev and production. Those values are public by design — a Firebase
 * web API key identifies a project, it does not authorise anything. The security is in
 * the Firestore rules and the authorised-domains list.
 */
(function () {
  'use strict';

  var app = null;
  var ready = false;

  /** Providers we support, in the order they appear. Add here and in the console. */
  var PROVIDERS = {
    google: { label: 'Continue with Google', mark: 'G', make: function () { return new firebase.auth.GoogleAuthProvider(); } },
    facebook: { label: 'Continue with Facebook', mark: 'f', make: function () { return new firebase.auth.FacebookAuthProvider(); } },
    github: { label: 'Continue with GitHub', mark: '⌘', make: function () { return new firebase.auth.GithubAuthProvider(); } },
  };

  function available() {
    return ready && typeof firebase !== 'undefined' && !!app;
  }

  /** Called once from core.js after bootstrap. Silently does nothing when Firebase is off. */
  function init(config) {
    if (!config || !config.apiKey || typeof firebase === 'undefined') return false;
    if (app) return true;
    try {
      app = firebase.initializeApp(config);
      // Nothing is kept between page loads: our cookie is the session, not Firebase's.
      firebase.auth().setPersistence(firebase.auth.Auth.Persistence.NONE);
      ready = true;
      return true;
    } catch (e) {
      console.warn('Firebase did not start:', e && e.message);
      return false;
    }
  }

  /**
   * Run one provider's popup and hand the token to our server.
   * Resolves with the MotoKE user; rejects with a message fit to show someone.
   */
  async function signInWith(key) {
    if (!available()) throw new Error('Social sign-in is not available right now');
    var spec = PROVIDERS[key];
    if (!spec) throw new Error('Unknown sign-in method');

    var result;
    try {
      result = await firebase.auth().signInWithPopup(spec.make());
    } catch (e) {
      throw new Error(friendly(e));
    }

    var idToken = await result.user.getIdToken();

    try {
      var r = await fetch('/api/auth/firebase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ idToken: idToken }),
      });
      var data = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error(data.error || data.message || 'That sign-in could not be completed');
      return data.user;
    } finally {
      // Whatever happened, do not leave a Firebase session lying around.
      try { await firebase.auth().signOut(); } catch (e) { /* nothing useful to do */ }
    }
  }

  /** Firebase's error codes are not sentences. These are. */
  function friendly(e) {
    var code = (e && e.code) || '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return 'Sign-in was cancelled';
    if (code === 'auth/popup-blocked') return 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.';
    if (code === 'auth/account-exists-with-different-credential') return 'You already have an account with that email. Sign in the way you did the first time.';
    if (code === 'auth/network-request-failed') return 'No connection. Check your internet and try again.';
    if (code === 'auth/unauthorized-domain') return 'This site is not on the Firebase authorised-domains list yet.';
    if (code === 'auth/operation-not-allowed') return 'That sign-in method is not switched on in Firebase.';
    return (e && e.message) || 'Sign-in failed';
  }

  /** The buttons. Returns '' when Firebase is off, so callers need no condition. */
  function buttonsHtml(enabledKeys) {
    if (!available()) return '';
    var keys = (enabledKeys && enabledKeys.length ? enabledKeys : Object.keys(PROVIDERS))
      .filter(function (k) { return PROVIDERS[k]; });
    if (!keys.length) return '';
    return (
      '<div class="social-auth">' +
      keys
        .map(function (k) {
          return (
            '<button class="btn block social" data-social="' + k + '" type="button">' +
            '<span class="social-mark">' + PROVIDERS[k].mark + '</span>' +
            escapeHtml(PROVIDERS[k].label) +
            '</button>'
          );
        })
        .join('') +
      '<div class="social-or"><span>or use your email</span></div>' +
      '</div>'
    );
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  window.MotoKEAuth = {
    init: init,
    available: available,
    signInWith: signInWith,
    buttonsHtml: buttonsHtml,
    PROVIDERS: PROVIDERS,
  };

  /* The SDK is deferred, so this file may load either before or after bootstrap returns.
     Rather than depend on which, both sides publish: store.js parks the config on
     window.__motokeFirebase and fires an event, and we take whichever arrives.
     Order-independent beats a race that only shows up on a slow connection. */
  if (window.__motokeFirebase) init(window.__motokeFirebase);
  window.addEventListener('motoke:firebase-config', function (e) {
    if (init(e.detail)) {
      // The account panel may already be on screen with no buttons on it.
      window.dispatchEvent(new CustomEvent('motoke:firebase-ready'));
    }
  });
})();
