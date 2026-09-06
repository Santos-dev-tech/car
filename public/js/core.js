/* MotoKE - shared browser helpers (no framework, no build step). */

/* ---------- api ---------- */
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}
const GET = (p) => api('GET', p);
const POST = (p, b) => api('POST', p, b);
const PATCH = (p, b) => api('PATCH', p, b);
const DEL = (p) => api('DELETE', p);

/* ---------- formatting ---------- */
const KES = (n) => 'KES ' + Math.round(Number(n) || 0).toLocaleString('en-KE');
const K = (n) => {
  n = Number(n) || 0;
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2).replace(/\.00$/, '') + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(Math.round(n));
};
const KESK = (n) => 'KES ' + K(n);
const num = (n) => (Number(n) || 0).toLocaleString('en-KE');
const pct = (n) => (Number(n) || 0).toFixed(1) + '%';
const titleCase = (s) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const dateFmt = (s) => {
  if (!s) return '—';
  const d = new Date(String(s).replace(' ', 'T'));
  return isNaN(d) ? s : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};
const dateTimeFmt = (s) => {
  if (!s) return '—';
  const d = new Date(String(s).replace(' ', 'T'));
  return isNaN(d) ? s : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};
const ago = (s) => {
  const d = new Date(String(s || '').replace(' ', 'T'));
  if (isNaN(d)) return '';
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  if (mins < 1440) return Math.floor(mins / 60) + 'h ago';
  return Math.floor(mins / 1440) + 'd ago';
};
const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- dom ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function on(root, event, selector, handler) {
  root.addEventListener(event, (e) => {
    const target = e.target.closest(selector);
    if (target && root.contains(target)) handler(e, target);
  });
}

/* ---------- toast ---------- */
function toast(message, kind = '') {
  let box = $('#toasts');
  if (!box) {
    box = h('<div id="toasts"></div>');
    document.body.appendChild(box);
  }
  const t = h(`<div class="toast ${kind}">${esc(message)}</div>`);
  box.appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity .3s';
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 320);
  }, 3600);
}

/* ---------- modal ---------- */
function modal(title, bodyHtml, opts = {}) {
  const bg = h(`<div class="modal-bg">
    <div class="modal ${opts.wide ? 'wide' : ''}">
      <div class="m-head"><h3 style="margin:0">${esc(title)}</h3><button class="x" data-close>&times;</button></div>
      <div class="m-body"></div>
    </div>
  </div>`);
  const body = $('.m-body', bg);
  if (typeof bodyHtml === 'string') body.innerHTML = bodyHtml;
  else body.appendChild(bodyHtml);
  /* Tell the smooth-scroll layer to hold the page still while a dialog is open, so the
     background does not drift behind it. No-op when smooth scrolling is off. */
  const close = () => {
    bg.remove();
    window.dispatchEvent(new CustomEvent('motoke:modal-close'));
  };
  bg.addEventListener('click', (e) => {
    if (e.target === bg || e.target.hasAttribute('data-close')) close();
  });
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') {
      close();
      document.removeEventListener('keydown', onKey);
    }
  });
  document.body.appendChild(bg);
  window.dispatchEvent(new CustomEvent('motoke:modal-open'));
  return { el: bg, body, close };
}

function confirmBox(message, onYes) {
  const m = modal('Please confirm', `<p>${esc(message)}</p>
    <div class="row" style="justify-content:flex-end;margin-top:18px">
      <button class="btn" data-close>Cancel</button>
      <button class="btn primary" id="cy">Yes, continue</button>
    </div>`);
  $('#cy', m.body).onclick = () => {
    m.close();
    onYes();
  };
}

/* ---------- routing ---------- */
function parseHash() {
  const raw = (location.hash || '#/').slice(1);
  const [pathPart, queryPart] = raw.split('?');
  const parts = pathPart.split('/').filter(Boolean);
  const query = {};
  new URLSearchParams(queryPart || '').forEach((v, k) => (query[k] = v));
  return { path: parts, query, raw };
}
function go(hash) {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = hash;
}

/* ---------- theming from dealer branding ---------- */
function applyBrand(dealer) {
  if (!dealer) return;
  document.documentElement.style.setProperty('--brand', dealer.primary_color || '#c8102e');
  document.documentElement.style.setProperty('--accent', dealer.accent_color || '#0b1f3a');
}

/* ---------- misc ---------- */
const LENDER_TYPE_LABEL = { bank: 'Bank', microfinance: 'Microfinance', sacco: 'Sacco', inhouse: 'Dealer in-house' };
const CONDITION_LABEL = { new: 'Brand new', used: 'Locally used', foreign_used: 'Foreign used (import)' };
/** Mirrors INSPECTION_AREAS in lib/performance.js — the five areas a workshop scores. */
const INSPECTION_AREAS = [
  ['exterior', 'Bodywork & paint'],
  ['interior', 'Interior & trim'],
  ['mechanical', 'Engine & drivetrain'],
  ['tyres', 'Tyres & brakes'],
  ['electronics', 'Electronics & aircon'],
];
const EMPLOYMENT_LABEL = {
  employed: 'Employed (permanent)',
  contract: 'Employed (contract)',
  self_employed: 'Self-employed / professional',
  business: 'Business owner',
  gig: 'Gig / informal income',
};
const STATUS_LABEL = {
  new: 'New',
  documents_pending: 'Documents pending',
  under_review: 'Under review',
  submitted_to_lender: 'With the lender',
  approved: 'Approved',
  declined: 'Declined',
  disbursed: 'Disbursed',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};
const STATUS_TONE = {
  new: 'info',
  documents_pending: 'warn',
  under_review: 'warn',
  submitted_to_lender: 'info',
  approved: 'ok',
  declined: 'err',
  disbursed: 'ok',
  delivered: 'ok',
  cancelled: '',
};

/**
 * The journey, as the customer experiences it.
 *
 * Every step carries three things a bare status label does not: what it means in plain
 * words, WHAT HAPPENS NEXT, and roughly how long. Research on lending trackers is
 * consistent that the missing "next" is what generates the phone calls — a customer who
 * can see the road ahead does not ring to ask where they are on it.
 *
 * `you` marks the steps where the business is waiting on the customer rather than the
 * other way round. Those get a callout they cannot miss.
 */
const TRACK_STEPS = [
  {
    key: 'new',
    label: 'Received',
    means: 'We have your application and a person has been assigned to it.',
    next: 'We check the details and tell you which documents to send.',
    eta: 'Usually within a few hours',
    you: false,
  },
  {
    key: 'documents_pending',
    label: 'Documents',
    means: 'We need your paperwork before a lender will look at this.',
    next: 'Upload the documents listed below and we take it from there.',
    eta: 'As soon as you can — nothing moves until this is done',
    you: true,
  },
  {
    key: 'under_review',
    label: 'Under review',
    means: 'Our finance team is checking everything hangs together.',
    next: 'We package it and send it to your lender.',
    eta: 'Usually 1 working day',
    you: false,
  },
  {
    key: 'submitted_to_lender',
    label: 'With the lender',
    means: 'It is with the bank or microfinance now. This is the waiting part.',
    next: 'The lender approves, declines, or comes back with questions.',
    eta: 'Typically 2 to 5 working days',
    you: false,
  },
  {
    key: 'approved',
    label: 'Approved',
    means: 'The lender said yes. Your offer letter is ready to read.',
    next: 'Read the offer letter, then sign and pay your deposit.',
    eta: 'The offer is open for a limited time — check the letter',
    you: true,
  },
  {
    key: 'disbursed',
    label: 'Paid out',
    means: 'The lender has released the money to the dealership.',
    next: 'We prepare the car, finish the paperwork and book your handover.',
    eta: 'Usually 1 to 3 working days',
    you: false,
  },
  {
    key: 'delivered',
    label: 'Delivered',
    means: 'The car is yours. Congratulations.',
    next: 'Your first instalment date is on the offer letter.',
    eta: '',
    you: false,
  },
];

const TRACK_ENDED = {
  declined: {
    label: 'Declined',
    means: 'This lender said no. That is one lender, not all of them.',
    next: 'Talk to us — a different lender, a bigger deposit or a longer term often works.',
  },
  cancelled: {
    label: 'Cancelled',
    means: 'This application was stopped.',
    next: 'Start a new one whenever you are ready.',
  },
};

function debounce(fn, ms = 280) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/* ==================================================================
   Global UI furniture — installed once by both the storefront and the
   staff console. Nothing here knows about cars or lenders.
   ================================================================== */

/* ---------- theme ---------- */
function initTheme() {
  const saved = store.get('theme', null);
  if (saved) document.documentElement.setAttribute('data-theme', saved);
  const btn = h('<button class="theme-btn" id="themeBtn" title="Switch between light and dark" aria-label="Switch theme"></button>');
  const paint = () => {
    const explicit = document.documentElement.getAttribute('data-theme');
    const dark = explicit ? explicit === 'dark' : !window.matchMedia('(prefers-color-scheme: light)').matches;
    btn.textContent = dark ? '☀' : '☾';
    btn.setAttribute('aria-pressed', String(!dark));
  };
  btn.onclick = () => {
    const explicit = document.documentElement.getAttribute('data-theme');
    const dark = explicit ? explicit === 'dark' : !window.matchMedia('(prefers-color-scheme: light)').matches;
    const next = dark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    store.set('theme', next);
    paint();
  };
  paint();
  return btn;
}

/* ---------- skip link, scroll progress, back to top ---------- */
function initChrome() {
  document.body.prepend(h('<a class="skip-link" href="#view">Skip to content</a>'));
  const bar = h('<div id="scrollbar"></div>');
  const top = h('<button id="toTop" title="Back to top" aria-label="Back to top">↑</button>');
  document.body.append(bar, top);
  top.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
  const onScroll = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.width = (max > 0 ? (window.scrollY / max) * 100 : 0) + '%';
    top.classList.toggle('on', window.scrollY > 500);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

/* ---------- cookie banner ---------- */
function initCookieBar(onAccept) {
  if (store.get('cookies', null)) return;
  const bar = h(`<div id="cookieBar" role="region" aria-label="Cookie notice">
    <p>We use a single cookie to keep you signed in, and remember your theme and shortlist in this browser.
    No advertising trackers. <a href="#/privacy" style="text-decoration:underline">How we handle your data</a>.</p>
    <div class="row">
      <button class="btn sm ghost" data-cookie="essential">Essential only</button>
      <button class="btn sm primary" data-cookie="all">Accept</button>
    </div>
  </div>`);
  on(bar, 'click', '[data-cookie]', (e, el) => {
    store.set('cookies', { choice: el.dataset.cookie, at: new Date().toISOString() });
    bar.remove();
    if (onAccept) onAccept(el.dataset.cookie);
  });
  document.body.appendChild(bar);
}

/* ---------- floating contact ---------- */
function initFab(links) {
  if (!links || !links.length) return;
  const wrap = h('<div class="fab-wrap"></div>');
  const menu = h('<div class="fab-menu" id="fabMenu"></div>');
  links.forEach((l) => {
    const a = h(`<a href="${esc(l.href)}"${l.external ? ' target="_blank" rel="noopener"' : ''}>${esc(l.label)}</a>`);
    menu.appendChild(a);
  });
  const btn = h('<button class="fab" aria-label="Contact us" aria-expanded="false">💬</button>');
  btn.onclick = () => {
    const open = menu.classList.toggle('on');
    btn.setAttribute('aria-expanded', String(open));
    btn.textContent = open ? '✕' : '💬';
  };
  wrap.append(menu, btn);
  document.body.appendChild(wrap);
}

/* ---------- mobile menu ---------- */
function initBurger(navSelector) {
  const nav = $(navSelector);
  if (!nav) return;
  const burger = h('<button class="burger" aria-label="Menu" aria-expanded="false">☰</button>');
  nav.parentElement.insertBefore(burger, nav);
  burger.onclick = () => {
    const open = nav.classList.toggle('open');
    burger.setAttribute('aria-expanded', String(open));
    burger.textContent = open ? '✕' : '☰';
  };
  on(nav, 'click', 'a', () => {
    nav.classList.remove('open');
    burger.textContent = '☰';
    burger.setAttribute('aria-expanded', 'false');
  });
}

/* ---------- UTM capture ----------
   Recorded once per visit and attached to every lead, application and booking, so the
   dealership can see which campaign actually produced a sale. */
function captureUtm() {
  const q = new URLSearchParams(location.search);
  const keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'];
  const found = {};
  keys.forEach((k) => {
    const v = q.get(k);
    if (v) found[k] = String(v).slice(0, 120);
  });
  const existing = store.get('utm', null);
  if (Object.keys(found).length) {
    const payload = { ...found, landedOn: location.pathname + location.hash, referrer: document.referrer || null, at: new Date().toISOString() };
    store.set('utm', payload);
    return payload;
  }
  if (!existing && document.referrer && !document.referrer.includes(location.host)) {
    const payload = { referrer: document.referrer, at: new Date().toISOString() };
    store.set('utm', payload);
    return payload;
  }
  return existing;
}
const utm = () => store.get('utm', null);

/* ---------- bot protection helpers ----------
   A hidden field no human fills in, plus the time the form was opened. */
const FORM_OPENED = Date.now();
function honeypot() {
  return '<div aria-hidden="true" style="position:absolute;left:-9999px;height:0;overflow:hidden"><label>Website<input type="text" name="website" id="hp_website" tabindex="-1" autocomplete="off"></label></div>';
}
function botFields() {
  const el = $('#hp_website');
  return { website: el ? el.value : '', formStartedAt: FORM_OPENED };
}

/* ---------- password field ---------- */
function passwordField(id, label, { autocomplete = 'current-password', meter = false } = {}) {
  return `<div class="field" id="${id}_field">
    <label for="${id}">${esc(label)}</label>
    <div class="pw-wrap">
      <input type="password" id="${id}" autocomplete="${autocomplete}">
      <button type="button" class="pw-toggle" data-pw="${id}" aria-label="Show password" title="Show password">👁</button>
    </div>
    ${meter ? `<div class="pw-meter" id="${id}_meter"><i></i><i></i><i></i><i></i></div><div class="dim" id="${id}_hint" style="font-size:.8rem;margin-top:5px"></div>` : ''}
    <div class="msg"></div>
  </div>`;
}
on(document, 'click', '[data-pw]', (e, el) => {
  const input = $('#' + el.dataset.pw);
  if (!input) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  el.textContent = show ? '🙈' : '👁';
  el.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  el.title = show ? 'Hide password' : 'Show password';
});

/** Live strength meter, scored on the server so the rules cannot drift apart. */
function wirePasswordMeter(id, getContext) {
  const input = $('#' + id);
  const meter = $('#' + id + '_meter');
  const hint = $('#' + id + '_hint');
  if (!input || !meter) return;
  const check = debounce(async () => {
    if (!input.value) {
      $$('i', meter).forEach((b) => (b.className = ''));
      hint.textContent = '';
      return;
    }
    try {
      const r = await POST('/api/auth/password-strength', { password: input.value, ...(getContext ? getContext() : {}) });
      $$('i', meter).forEach((b, i) => (b.className = i < Math.max(1, r.score) ? 'on-' + r.score : ''));
      hint.textContent = r.ok ? r.label + ' — good to go.' : r.message;
      hint.style.color = r.ok ? 'var(--ok)' : 'var(--muted)';
    } catch {}
  }, 260);
  input.addEventListener('input', check);
}

/* ---------- form state helpers ---------- */
function fieldError(id, message) {
  const wrap = $('#' + id)?.closest('.field');
  if (!wrap) return;
  wrap.classList.add('invalid');
  const msg = $('.msg', wrap);
  if (msg) msg.textContent = message;
}
function clearErrors(root = document) {
  $$('.field.invalid', root).forEach((f) => {
    f.classList.remove('invalid');
    const m = $('.msg', f);
    if (m) m.textContent = '';
  });
}
/** Show a server error against the right input when it names one. */
function showFormError(err, root = document) {
  clearErrors(root);
  if (err && err.field) {
    const candidates = [err.field, err.field.replace(/([A-Z])/g, '_$1').toLowerCase()];
    for (const c of candidates) {
      const el = $$('input,select,textarea', root).find((i) => i.id.toLowerCase().includes(c.toLowerCase()));
      if (el) {
        const wrap = el.closest('.field');
        if (wrap) {
          wrap.classList.add('invalid');
          const m = $('.msg', wrap);
          if (m) m.textContent = err.message;
          el.focus();
          return;
        }
      }
    }
  }
  toast(err.message || 'Something went wrong', 'err');
}
const successPanel = (title, body, actions = '') =>
  `<div class="success-panel"><div class="tick">✓</div><h2>${esc(title)}</h2><p class="muted">${body}</p>${actions}</div>`;

/* ---------- copy button ---------- */
on(document, 'click', '[data-copy]', async (e, el) => {
  const text = el.dataset.copy;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } catch {}
    ta.remove();
  }
  const was = el.textContent;
  el.textContent = 'Copied';
  el.classList.add('done');
  setTimeout(() => {
    el.textContent = was;
    el.classList.remove('done');
  }, 1600);
});
const copyBtn = (text, label = 'Copy') => `<button class="copy" data-copy="${esc(text)}">${esc(label)}</button>`;

/* ---------- skeletons ---------- */
const skelCards = (n = 6) =>
  Array.from({ length: n })
    .map(() => '<div class="skel-card"><div class="skel a"></div><div class="b"><div class="skel skel-line" style="width:70%"></div><div class="skel skel-line" style="width:45%"></div><div class="skel skel-line" style="width:60%;height:20px"></div></div></div>')
    .join('');
const skelLines = (n = 4) =>
  '<div class="stack">' + Array.from({ length: n }).map((_, i) => `<div class="skel skel-line" style="width:${90 - i * 12}%"></div>`).join('') + '</div>';

/* ---------- last updated ---------- */
function relativeDate(iso) {
  if (!iso) return '';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return days + ' days ago';
  return dateFmt(iso);
}

const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('motoke:' + k);
      return v === null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('motoke:' + k, JSON.stringify(v));
    } catch {}
  },
};
