/**
 * MotoKE — smooth scrolling.
 *
 * Lenis interpolates the real scroll position frame by frame, which is what makes a long
 * editorial page feel considered rather than jumpy. `scroll-behavior: smooth` cannot do
 * this — it only smooths anchor jumps, not the wheel.
 *
 * Three cases where it stays OFF, because smoothing them is worse than not:
 *
 *   1. `prefers-reduced-motion` — Lenis handles this itself, and we check too.
 *   2. Touch devices — the phone's own momentum scrolling is better than any polyfill,
 *      and hijacking it is the most common way these libraries ruin a mobile site.
 *   3. Anything inside `[data-lenis-prevent]` — our scroll rails and modals keep native
 *      scrolling so a nested scroll never fights the page.
 */
(function () {
  'use strict';

  /**
   * OFF BY DEFAULT — and this is the important comment in the file.
   *
   * Lenis works by cancelling the browser's own scroll and re-driving the position from a
   * requestAnimationFrame loop. That moves scrolling onto the MAIN THREAD. Native scroll
   * runs on the compositor, where nothing this app does can interrupt it.
   *
   * So on a page that is doing anything at all — a hash router, a carousel timer,
   * observers, image decode — Lenis produces *less* smooth scrolling than doing nothing,
   * because every hitch on the main thread now shows up as a stutter in the scroll. That
   * is exactly what was reported here, and it persisted after the animation and paint
   * costs were removed, which is what pointed at the mechanism rather than the content.
   *
   * The library is still vendored and this module still works. To try it again:
   *
   *     window.MOTOKE_SMOOTH_SCROLL = true;   // before this file runs
   *
   * or flip the default below. Native scrolling is the recommendation.
   */
  var ENABLED = window.MOTOKE_SMOOTH_SCROLL === true;

  var lenis = null;

  function reducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  function coarsePointer() {
    return window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  }

  function start() {
    if (!ENABLED) return;
    if (lenis || typeof Lenis === 'undefined') return;
    if (reducedMotion() || coarsePointer()) return;

    lenis = new Lenis({
      duration: 1.05,          // long enough to read as deliberate, short enough to obey
      smoothWheel: true,
      wheelMultiplier: 1,
      touchMultiplier: 1.6,
      // Standard ease-out expo: fast to start, settles without a bounce.
      easing: function (t) { return t === 1 ? 1 : 1 - Math.pow(2, -10 * t); },
    });

    function raf(time) {
      if (!lenis) return;
      lenis.raf(time);
      requestAnimationFrame(raf);
    }
    requestAnimationFrame(raf);

    window.MotoKEScroll = {
      lenis: lenis,
      to: function (target, opts) { lenis.scrollTo(target, opts || { offset: -80 }); },
      stop: function () { lenis.stop(); },
      resume: function () { lenis.start(); },
    };
  }

  function destroy() {
    if (!lenis) return;
    lenis.destroy();
    lenis = null;
    window.MotoKEScroll = null;
  }

  /* React to the preference changing while the page is open — someone turning reduced
     motion on should not have to reload to be rid of this. */
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    var onChange = function () { (mq.matches ? destroy : start)(); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  /**
   * Fetch the library only if it is actually wanted. Off by default that means the page
   * downloads and parses nothing at all for this feature, rather than 18 kB it will never
   * run. Same-origin, so `script-src 'self'` is satisfied.
   */
  function load() {
    if (!ENABLED) return;
    if (typeof Lenis !== 'undefined') return start();

    var css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/vendor/lenis/lenis.css';
    document.head.appendChild(css);

    var s = document.createElement('script');
    s.src = '/vendor/lenis/lenis.min.js';
    s.onload = start;
    s.onerror = function () {
      console.warn('Smooth scrolling could not load; native scrolling is in use.');
    };
    document.head.appendChild(s);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();

  /* A modal must not scroll the page behind it. core.js dispatches these. */
  window.addEventListener('motoke:modal-open', function () { if (lenis) lenis.stop(); });
  window.addEventListener('motoke:modal-close', function () { if (lenis) lenis.start(); });

  /* Hash routing changes the view without a navigation, so the browser does not reset
     the scroll position and the customer lands halfway down the next page. */
  window.addEventListener('motoke:route', function () {
    if (lenis) lenis.scrollTo(0, { immediate: true });
    else window.scrollTo(0, 0);
  });
})();
