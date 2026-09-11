/* MotoKE staff console. */
(() => {
  const view = $('#view');
  const A = { user: null, dealers: [], scope: '', site: null, lenders: [], staff: [] };

  const scopeQ = (extra = '') => {
    const p = new URLSearchParams();
    if (A.scope) p.set('dealer', A.scope);
    const s = p.toString();
    return (s ? '?' + s : '') + (extra ? (s ? '&' : '?') + extra : '');
  };

  /* [label, route, icon, permission].
     The menu is built from what the signed-in person may actually do. Hiding an item is
     only tidiness — lib/api.js refuses the request either way — but a console showing
     screens that error when clicked is worse than one that shows fewer screens. */
  const NAV = [
    ['Overview', '', '▤', 'overview'],
    ['Applications', 'applications', '▦', 'applications'],
    ['Pre-qualifications', 'prequal', '✓', 'prequal'],
    ['Bookings', 'orders', '💳', 'bookings'],
    ['Inventory', 'inventory', '🚗', 'inventory'],
    ['Stock ageing', 'ageing', '⏳', 'ageing'],
    ['Leads', 'leads', '☎', 'leads'],
    ['Introducers', 'brokers', '🤝', 'applications'],
    /* A broker holds only `broker`, `inventory` and `prequal`, so these two are the only
       entries that survive the filter for them and every screen above vanishes. */
    ['Check a client', 'check', '🧮', 'broker'],
    ['My clients', 'clients', '👥', 'broker'],
    ['My verification', 'verify', '🛡', 'broker'],
    ['SECTION', 'Finance'],
    ['Lenders & rules', 'lenders', '％', 'lenders'],
    ['Running costs', 'costs', '⛽', 'costs'],
    ['SECTION', 'Setup'],
    ['Dealership', 'dealership', '🏢', 'dealership'],
    ['Staff', 'users', '👤', 'staff'],
    ['Activity log', 'audit', '🕘', 'audit'],
  ];

  /* ---------------- shell ---------------- */

  async function boot() {
    try {
      const me = await GET('/api/auth/me');
      A.user = me.user && me.user.role !== 'customer' ? me.user : null;
      A.permissions = A.user ? me.permissions || [] : [];
    } catch {
      A.user = null;
      A.permissions = [];
    }
    if (!A.user) return renderLogin();
    A.dealers = await GET('/api/dealers');
    const settings = await GET('/api/admin/settings').catch(() => ({}));
    A.site = settings.site_dealer || null;
    // Everyone, platform admin included, works inside the dealership this install serves.
    const siteDealer = A.dealers.find((d) => d.slug === A.site);
    A.scope = siteDealer ? siteDealer.slug : A.user.dealer_id ? String(A.user.dealer_id) : '';
    paintShell();
    render();
  }

  /* Demo accounts, offered as buttons rather than typed into the boxes.
     Pre-filling them meant the browser's password manager kept re-filling the fields the
     moment you cleared them, so a real account could not be typed in — and it also meant
     a live install shipped with a working password sitting in the login form. */
  const DEMO_LOGINS = [
    { email: 'admin@motoke.demo', password: 'admin123', role: 'Platform admin' },
    { email: 'grace@summitmotors.demo', password: 'demo123', role: 'Dealer admin' },
    { email: 'brian@summitmotors.demo', password: 'demo123', role: 'Sales agent' },
    { email: 'faith@summitmotors.demo', password: 'demo123', role: 'Finance officer' },
  ];

  function renderLogin() {
    $('#side').classList.add('hide');
    $('#topRight').innerHTML = '<a class="btn sm ghost" href="/">← Storefront</a>';
    const slot = $('#topRight');
    slot.appendChild(initTheme());

    view.innerHTML = `<div class="card" style="max-width:420px;margin:8vh auto">
      <h2>Staff sign in</h2>
      <p class="muted" style="font-size:.88rem">Console for dealership staff — inventory, applications, lenders and rules.</p>
      <div class="field"><label for="e">Email</label><input type="email" id="e" autocomplete="username"><div class="msg"></div></div>
      ${passwordField('p', 'Password')}
      <button class="btn primary block lg" id="go">Sign in</button>
      <div id="loginMsg" class="mt"></div>
      <div class="panel mt"><div class="lbl">Demo logins — click one to fill</div>
        <div class="demo-logins">
          ${DEMO_LOGINS.map(
            (d) =>
              `<button type="button" class="demo-login" data-demo="${esc(d.email)}|${esc(d.password)}">
                 <b>${esc(d.email)}</b><span>${esc(d.role)}</span>
               </button>`
          ).join('')}
        </div>
      </div>
    </div>`;

    const submit = async () => {
      clearErrors(view);
      const btn = $('#go');
      btn.disabled = true;
      btn.textContent = 'Checking…';
      try {
        const r = await POST('/api/auth/login', { email: $('#e').value, password: $('#p').value });
        if (r.needsOtp) return otpStep($('#e').value, r);
        if (r.user.role === 'customer') throw new Error('That is a customer account — use the storefront to sign in.');
        boot();
      } catch (err) {
        $('#loginMsg').innerHTML = `<div class="form-note err"><span>✕</span><div>${esc(err.message)}</div></div>`;
        btn.disabled = false;
        btn.textContent = 'Sign in';
      }
    };
    $('#go').onclick = submit;
    $('#p').onkeydown = (e) => e.key === 'Enter' && submit();
    $('#e').onkeydown = (e) => e.key === 'Enter' && submit();

    on(view, 'click', '[data-demo]', (ev, el) => {
      const [email, password] = el.dataset.demo.split('|');
      $('#e').value = email;
      $('#p').value = password;
      $('#p').focus();
    });
  }

  /** Second factor. Staff accounts always carry one. */
  function otpStep(email, r) {
    view.innerHTML = `<div class="card" style="max-width:420px;margin:8vh auto">
      <h2>Enter your code</h2>
      <p class="muted" style="font-size:.9rem">${esc(r.hint || 'We sent you a 6-digit code.')} It expires in 10 minutes.</p>
      <div class="field"><label for="otp">6-digit code</label>
        <input type="text" id="otp" inputmode="numeric" maxlength="6" autocomplete="one-time-code"
               style="font-size:1.6rem;letter-spacing:.4em;text-align:center;font-family:var(--mono)">
        <div class="msg"></div>
      </div>
      <button class="btn primary block lg" id="otpGo">Verify and sign in</button>
      <button class="btn ghost block mt" id="otpBack">← Use a different account</button>
      ${
        r.demoCode
          ? `<div class="form-note mt" style="background:rgba(56,189,248,.12);border:1px solid rgba(56,189,248,.4);color:#7dd3fc">
               <span>⚙</span><div><b>Demo mode.</b> There is no SMS gateway wired up, so the code is shown here
               (and printed to the server console): <b class="mono" style="font-size:1.1rem">${esc(r.demoCode)}</b>
               ${copyBtn(r.demoCode)}</div></div>`
          : ''
      }
      <div id="otpMsg" class="mt"></div>
    </div>`;

    const go2 = async () => {
      const btn = $('#otpGo');
      btn.disabled = true;
      btn.textContent = 'Verifying…';
      try {
        await POST('/api/auth/verify-otp', { email, code: $('#otp').value.trim() });
        boot();
      } catch (err) {
        $('#otpMsg').innerHTML = `<div class="form-note err"><span>✕</span><div>${esc(err.message)}</div></div>`;
        btn.disabled = false;
        btn.textContent = 'Verify and sign in';
        $('#otp').select();
      }
    };
    $('#otpGo').onclick = go2;
    $('#otp').onkeydown = (e) => e.key === 'Enter' && go2();
    $('#otp').oninput = (e) => {
      e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
      if (e.target.value.length === 6) go2();
    };
    $('#otpBack').onclick = renderLogin;
    setTimeout(() => $('#otp').focus(), 60);
  }

  function paintShell() {
    const side = $('#side');
    side.classList.remove('hide');
    const { path } = parseHash();
    const cur = path[0] || '';
    /* Drop what this person cannot use, then drop any section heading left with nothing
       under it — an empty "Finance" heading tells a receptionist there is something they
       are missing, which is both untidy and unkind. */
    const allowed = NAV.filter((n) => n[0] === 'SECTION' || !n[3] || allow(n[3]));
    const visible = allowed.filter((n, i) => n[0] !== 'SECTION' || allowed.slice(i + 1).some((x) => x[0] !== 'SECTION'));

    side.innerHTML = visible.map((n) =>
      n[0] === 'SECTION' ? `<div class="sec">${n[1]}</div>` : `<a href="#/${n[1]}" class="${cur === n[1] ? 'on' : ''}"><span>${n[2]}</span>${n[0]}</a>`
    ).join('');

    // One install serves one dealership. Its name is a label, not a switcher — the
    // platform admin changes which dealership on the Dealership page.
    const siteName = (A.dealers.find((d) => d.slug === A.site) || A.dealers.find((d) => d.id === A.user.dealer_id) || {}).name || '';

    $('#topRight').innerHTML = `<span class="tag brand">${esc(siteName)}</span>
      <span class="tag">${esc(titleCase(A.user.role))}</span>
      <span class="muted" style="font-size:.86rem">${esc(A.user.name)}</span>
      <a class="btn sm ghost" href="/" target="_blank">Storefront ↗</a>
      <button class="btn sm" id="out">Sign out</button>`;
    $('#topRight').appendChild(initTheme());
    $('#out').onclick = async () => {
      await POST('/api/auth/logout');
      A.user = null;
      renderLogin();
    };
    if (!A.chrome) {
      A.chrome = true;
      initChrome();
    }
  }

  const can = (...roles) => roles.includes(A.user.role);

  /**
   * Does this person hold a capability? Driven by what the server sent on sign-in, so the
   * menu and the server can never disagree about who may do what.
   *
   * `allow('inventory')` is also satisfied by holding `inventory.write`, matching the
   * server's rule — otherwise every caller has to check both and one day somebody forgets.
   */
  const allow = (perm) => {
    const list = (A.permissions || []);
    if (list.includes(perm)) return true;
    return perm.includes('.') ? false : list.some((p) => p.split('.')[0] === perm);
  };

  /* ---------------- overview ---------------- */

  /** Which ring colour each pipeline stage gets in the donut. */
  const DONUT_TONE = {
    new: 'info',
    documents_pending: 'warn',
    under_review: 'warn',
    submitted_to_lender: 'info',
    approved: 'ok',
    disbursed: 'ok',
    delivered: 'ok',
    declined: 'err',
    cancelled: 'ash',
  };

  /**
   * One KPI card: label, figure, a line of context, and — where we have the
   * data — how it has moved and a sparkline behind it.
   */
  function kpi(label, value, detail, delta, series) {
    return `<div class="kpi">
      <div class="k">${esc(label)}</div>
      <div class="kpi-row">
        <div class="v">${value}</div>
        ${series ? `<div class="kpi-spark">${Charts.spark(series)}</div>` : ''}
      </div>
      <div class="d">
        ${delta ? Charts.deltaPill(delta) : ''}
        <span>${esc(detail)}</span>
      </div>
    </div>`;
  }

  async function pageOverview() {
    view.innerHTML = '<div class="spinner"></div>';
    const s = await GET('/api/admin/stats' + scopeQ());
    const v = s.vehicles || {};
    const ap = s.applications || {};

    view.innerHTML = `
      <div class="row between wrap-r mb"><h1>Overview</h1><span class="muted">${A.scope ? esc((A.dealers.find((d) => d.slug === A.scope) || {}).name) : 'All dealerships'}</span></div>

      ${/* The headline figure, its movement, and a trend behind it — the three
            things the reference dashboard puts together. A number with no
            direction of travel tells a manager nothing. */ ''}
      <div class="hero-stat card mb">
        <div class="hero-stat-main">
          <div class="k">Finance volume · last 30 days</div>
          <div class="hero-v">${KESK((s.deltas && s.deltas.volume.value) || 0)}</div>
          <div class="hero-sub">
            ${Charts.deltaPill(s.deltas && s.deltas.volume)}
            <span class="muted">${num((s.deltas && s.deltas.applications.value) || 0)} applications · avg ${KESK(s.avgLoan)} each</span>
          </div>
        </div>
        <div class="hero-stat-chart">
          ${Charts.area((s.series && s.series.applications) || [], { value: 'v', height: 150, label: 'Finance volume over the last 30 days' })}
        </div>
      </div>

      <div class="kpi-grid mb">
        ${kpi('Stock on hand', num(v.n), `${num(v.available)} available · ${num(v.reserved)} reserved`, s.deltas && s.deltas.stockAdded, s.series && s.series.stock)}
        ${kpi('Stock value', KESK(v.value), 'at listed prices')}
        ${kpi('Applications', num(ap.n), `${num(ap.fresh)} not yet actioned`, s.deltas && s.deltas.applications, s.series && s.series.applications)}
        ${kpi('Approval rate', s.conversion + '%', `${num(ap.approved)} approved · ${num(ap.declined)} declined`)}
        ${kpi('Open leads', num(s.leads.fresh), `of ${num(s.leads.n)} total`, s.deltas && s.deltas.leads, s.series && s.series.leads)}
        ${kpi('Pre-qualifications', num((s.prequal || {}).n), `${num((s.prequal || {}).qualified)} matched a lender`)}
      </div>

      <div class="split-r">
        <div class="stack">
          <div class="card">
            <h3>Pipeline</h3>
            <p class="muted" style="margin-top:-6px">Where every live application currently sits.</p>
            ${Charts.donut(
              s.byStatus.map((b) => ({
                label: STATUS_LABEL[b.status] || b.status,
                value: b.n,
                display: `${b.n} · ${KESK(b.volume)}`,
                tone: DONUT_TONE[b.status] || 'ink',
              })),
              { caption: 'applications', empty: 'No applications yet.' }
            )}
          </div>

          <div class="card">
            <h3>Where the money is coming from</h3>
            <div class="scroll-x"><table class="tbl">
              <thead><tr><th>Lender</th><th>Type</th><th class="num">Applications</th><th class="num">Won</th><th class="num">Volume</th></tr></thead>
              <tbody>${s.byLender
                .map(
                  (l) => `<tr>
                  <td><span class="tag" style="background:${esc(l.color)};color:#fff;border:0">${esc(l.logo_text)}</span> ${esc(l.short_name || l.name)}</td>
                  <td class="muted">${esc(LENDER_TYPE_LABEL[l.type] || l.type)}</td>
                  <td class="num">${l.n}</td><td class="num">${l.won || 0}</td><td class="num">${KESK(l.volume)}</td></tr>`
                )
                .join('') || '<tr><td colspan="5" class="empty">No data yet.</td></tr>'}</tbody>
            </table></div>
          </div>

          <div class="card">
            <div class="row between wrap-r">
              <h3 style="margin:0">Applications a day</h3>
              ${Charts.deltaPill(s.deltas && s.deltas.applications)}
            </div>
            <div class="chart-wrap mt">
              ${Charts.area((s.series && s.series.applications) || [], { height: 170, label: 'Applications per day over the last 30 days' })}
            </div>
            <div class="chart-axis">
              <span>${(s.series && s.series.applications[0] || {}).day || ''}</span>
              <span>today</span>
            </div>
          </div>

          <div class="card">
            <h3>Stock by body type</h3>
            ${Charts.bars(
              (s.stock || []).slice(0, 8).map((r) => ({ label: r.v || 'Unspecified', value: r.n })),
              { empty: 'No stock yet.' }
            )}
          </div>
        </div>

        <div class="stack">
          <div class="card">
            <h3>Latest applications</h3>
            ${s.recentApps
              .map(
                (a) => `<a class="doc-row" href="#/applications?open=${a.id}">
                  <span class="mono" style="font-size:.78rem">${esc(a.ref)}</span>
                  <span class="grow">${esc(a.applicant.fullName || '—')}</span>
                  <span class="tag ${STATUS_TONE[a.status] || ''}">${esc(STATUS_LABEL[a.status] || a.status)}</span>
                </a>`
              )
              .join('') || '<div class="empty">Nothing yet.</div>'}
          </div>
          <div class="card">
            <h3>Most viewed stock</h3>
            ${s.topVehicles
              .map(
                (t) => `<div class="doc-row"><span class="grow">${esc(t.title)}</span><span class="dim">${num(t.views)} views</span></div>`
              )
              .join('') || '<div class="empty">No stock.</div>'}
          </div>
          <div class="card">
            <h3>Stock mix</h3>
            ${s.stock
              .map(
                (b) => `<div class="row between" style="font-size:.87rem;margin-bottom:4px"><span class="muted">${esc(b.v || '—')}</span><span>${b.n}</span></div>`
              )
              .join('')}
          </div>
        </div>
      </div>`;
  }

  /* ---------------- applications ---------------- */

  const PIPE = ['new', 'documents_pending', 'under_review', 'submitted_to_lender', 'approved', 'disbursed', 'delivered'];

  async function pageApplications(query) {
    view.innerHTML = '<div class="spinner"></div>';
    const res = await GET('/api/admin/applications' + scopeQ());
    const items = res.items;
    const mode = store.get('appsView', 'board');

    view.innerHTML = `
      <div class="row between wrap-r mb">
        <h1>Applications <span class="muted" style="font-size:1rem">${items.length}</span></h1>
        <div class="row">
          <input type="text" id="q" placeholder="Search name or reference…" style="width:230px">
          <select id="fStatus" style="width:auto"><option value="">All statuses</option>
            ${res.statuses.map((s) => `<option value="${s}">${esc(STATUS_LABEL[s] || s)}</option>`).join('')}</select>
          <div class="pills"><button class="pill ${mode === 'board' ? 'on' : ''}" data-view="board">Board</button><button class="pill ${mode === 'table' ? 'on' : ''}" data-view="table">Table</button></div>
          <a class="btn sm" href="/api/admin/export/applications${scopeQ()}">Export CSV</a>
        </div>
      </div>
      <div id="appsBody"></div>`;

    const paint = () => {
      const q = ($('#q').value || '').toLowerCase();
      const st = $('#fStatus').value;
      const rows = items.filter(
        (a) =>
          (!st || a.status === st) &&
          (!q || a.ref.toLowerCase().includes(q) || String(a.applicant.fullName || '').toLowerCase().includes(q))
      );
      $('#appsBody').innerHTML = store.get('appsView', 'board') === 'board' ? board(rows) : table(rows);
    };

    const board = (rows) => `<div class="kanban">${PIPE.concat(['declined', 'cancelled'])
      .map((st) => {
        const col = rows.filter((r) => r.status === st);
        return `<div class="col">
          <div class="row between"><h4>${esc(STATUS_LABEL[st] || st)}</h4><span class="tag">${col.length}</span></div>
          <div class="mt">${col
            .map(
              (a) => `<div class="kc" data-open="${a.id}">
                <div class="row between"><span class="mono" style="font-size:.72rem">${esc(a.ref)}</span><span class="dim" style="font-size:.72rem">${ago(a.created_at)}</span></div>
                <div style="font-weight:600;font-size:.9rem;margin-top:3px">${esc(a.applicant.fullName || '—')}</div>
                <div class="dim" style="font-size:.78rem">${esc((a.vehicle_snapshot && a.vehicle_snapshot.title) || '—')}</div>
                <div class="row between mt" style="font-size:.8rem">
                  <span class="tag" style="background:${esc(a.lender_color || '#334')};color:#fff;border:0">${esc(a.lender_logo || '?')}</span>
                  <b>${KES(a.monthly_payment)}/mo</b>
                </div>
              </div>`
            )
            .join('') || '<div class="dim" style="font-size:.8rem;padding:8px">—</div>'}</div>
        </div>`;
      })
      .join('')}</div>`;

    const table = (rows) => `<div class="card scroll-x"><table class="tbl">
      <thead><tr><th>Ref</th><th>Customer</th><th>Vehicle</th><th>Lender</th><th class="num">Price</th><th class="num">Deposit</th><th class="num">Monthly</th><th>Status</th><th>Agent</th><th>Introduced by</th><th>Age</th></tr></thead>
      <tbody>${rows
        .map(
          (a) => `<tr data-open="${a.id}" style="cursor:pointer">
          <td class="mono">${esc(a.ref)}</td>
          <td>${esc(a.applicant.fullName || '—')}<div class="dim" style="font-size:.76rem">${esc(a.applicant.phone || '')}</div></td>
          <td>${esc((a.vehicle_snapshot && a.vehicle_snapshot.title) || '—')}</td>
          <td>${esc(a.lender_short || a.lender_name || '—')}</td>
          <td class="num">${KESK(a.price)}</td><td class="num">${KESK(a.deposit)}</td><td class="num">${KES(a.monthly_payment)}</td>
          <td><span class="tag ${STATUS_TONE[a.status] || ''}">${esc(STATUS_LABEL[a.status] || a.status)}</span></td>
          <td class="muted">${esc(a.assigned_name || '—')}</td>
          <td class="muted">${a.introduced_name ? esc(a.introduced_name) : '<span class="dim">Walk-in</span>'}</td>
          <td class="dim">${ago(a.created_at)}</td>
        </tr>`
        )
        .join('') || '<tr><td colspan="11" class="empty">Nothing matches.</td></tr>'}</tbody>
    </table></div>`;

    paint();
    $('#q').oninput = debounce(paint, 200);
    $('#fStatus').onchange = paint;
    on(view, 'click', '[data-view]', (e, el) => {
      store.set('appsView', el.dataset.view);
      $$('[data-view]').forEach((b) => b.classList.toggle('on', b === el));
      paint();
    });
    on(view, 'click', '[data-open]', (e, el) => openApplication(el.dataset.open));
    if (query.open) openApplication(query.open);
  }

  async function openApplication(id) {
    const m = modal('Application', '<div class="spinner"></div>', { wide: true });
    const a = await GET(`/api/admin/applications/${id}`);
    if (!A.staff.length) A.staff = await GET('/api/admin/users' + scopeQ()).catch(() => []);
    if (!A.lenders.length) A.lenders = await GET('/api/admin/lenders' + scopeQ()).catch(() => []);
    const o = a.offer || {};
    const v = a.vehicle_snapshot || {};
    const ap = a.applicant || {};
    const em = a.employment || {};

    m.body.innerHTML = `
      <div class="row between wrap-r mb">
        <div>
          <div class="mono dim" style="font-size:.82rem">${esc(a.ref)}</div>
          <h2 style="margin:2px 0">${esc(ap.fullName || '—')}</h2>
          <div class="muted">${esc(ap.phone || '')} · ${esc(ap.email || '')} · ID ${esc(ap.idNumber || '—')}</div>
        </div>
        <div style="text-align:right">
          <span class="tag ${STATUS_TONE[a.status] || ''}" style="font-size:.9rem">${esc(STATUS_LABEL[a.status] || a.status)}</span>
          <div class="dim mt" style="font-size:.8rem">Received ${dateTimeFmt(a.created_at)}</div>
        </div>
      </div>

      <div class="split-r" style="grid-template-columns:1fr 320px">
        <div class="stack">
          <div class="panel">
            <div class="lbl">The deal</div>
            <div class="grid-2">
              <div>
                <div class="row between"><span class="dim">Vehicle</span><span>${esc(v.title || '—')}</span></div>
                <div class="row between"><span class="dim">Price</span><span>${KES(a.price)}</span></div>
                <div class="row between"><span class="dim">Deposit</span><span>${KES(a.deposit)} (${o.depositPct || 0}%)</span></div>
                <div class="row between"><span class="dim">Financed</span><span>${KES(a.loan_amount)}</span></div>
              </div>
              <div>
                <div class="row between"><span class="dim">Lender</span><span>${esc(a.lender_name || '—')}</span></div>
                <div class="row between"><span class="dim">Rate</span><span>${o.annualRate || '—'}% ${esc(o.rateType === 'flat' ? 'flat' : 'reducing')}</span></div>
                <div class="row between"><span class="dim">Term</span><span>${a.tenor_months} months</span></div>
                <div class="row between" style="font-weight:700"><span>Monthly</span><span>${KES(a.monthly_payment)}</span></div>
              </div>
            </div>
            ${
              o.blockers && o.blockers.length
                ? `<div class="mt err-text" style="font-size:.85rem"><b>Outside lender criteria:</b><ul style="padding-left:18px;margin:4px 0">${o.blockers.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></div>`
                : '<div class="tag ok mt">Inside this lender\'s published criteria</div>'
            }
          </div>

          <div class="panel">
            <div class="lbl">Affordability</div>
            <div class="grid-3">
              <div><div class="dim" style="font-size:.78rem">Net income</div><b>${KES(em.netIncome)}</b></div>
              <div><div class="dim" style="font-size:.78rem">Commitments</div><b>${KES(em.obligations || 0)}</b></div>
              <div><div class="dim" style="font-size:.78rem">Debt ratio</div><b>${o.dti != null ? o.dti + '%' : '—'}</b></div>
            </div>
            <div class="grid-3 mt">
              <div><div class="dim" style="font-size:.78rem">Employment</div><b>${esc(EMPLOYMENT_LABEL[em.type] || em.type || '—')}</b></div>
              <div><div class="dim" style="font-size:.78rem">Employer</div><b>${esc(em.employer || '—')}</b></div>
              <div><div class="dim" style="font-size:.78rem">CRB</div><b>${em.crbClean === false ? 'Listed' : 'Clean'}</b></div>
            </div>
          </div>

          <div class="panel">
            <div class="row between"><div class="lbl" style="margin:0">Documents (${a.documents.length})</div></div>
            <div class="mt">${
              a.documents.length
                ? a.documents
                    .map(
                      (d) => `<div class="doc-row"><span class="tag">${esc(titleCase(d.doc_type))}</span><span class="grow">${esc(d.filename)}</span>
                      <span class="dim">${dateFmt(d.uploaded_at)}</span><button class="btn sm" data-doc="${d.id}">Open</button></div>`
                    )
                    .join('')
                : '<div class="dim" style="font-size:.85rem">Nothing uploaded yet.</div>'
            }</div>
            <div class="lbl mt">This lender requires</div>
            <ul class="muted" style="padding-left:18px;font-size:.85rem">${(a.lender_requirements || []).map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
          </div>

          <div class="panel">
            <div class="lbl">History</div>
            <div class="timeline mt">${a.events
              .map((e) => `<div class="ev"><div>${esc(e.message)}</div><div class="t">${esc(e.actor || '')} · ${dateTimeFmt(e.created_at)}</div></div>`)
              .join('')}</div>
            <div class="row mt"><input type="text" id="note" placeholder="Add a note…" class="grow"><button class="btn" id="addNote">Add</button></div>
          </div>
        </div>

        <div class="stack">
          <div class="panel">
            <div class="lbl">Move to</div>
            <div class="stack">
              ${PIPE.concat(['declined', 'cancelled'])
                .map(
                  (s) =>
                    `<button class="btn sm block ${s === a.status ? 'primary' : ''}" data-status="${s}" ${s === a.status ? 'disabled' : ''}>${esc(STATUS_LABEL[s] || s)}</button>`
                )
                .join('')}
            </div>
          </div>
          ${
            a.introduced_name
              ? `<div class="panel">
                   <div class="lbl">Introduced by</div>
                   <div style="font-size:1.05rem;font-weight:600">${esc(a.introduced_name)}</div>
                   <small class="dim">Registered this customer before the introduction.
                     This is what their commission claim rests on — it cannot be edited.</small>
                 </div>`
              : ''
          }
          <div class="panel">
            <div class="lbl">Assigned to</div>
            ${
              allow('assign')
                ? `<select id="assign">
                     <option value="">Unassigned</option>
                     ${A.staff
                       .filter((u) => u.role !== 'customer' && u.role !== 'receptionist')
                       .map((u) => `<option value="${u.id}" ${a.assigned_to === u.id ? 'selected' : ''}>${esc(u.name)} — ${esc(titleCase(u.role))}</option>`)
                       .join('')}
                   </select>
                   <button class="btn block mt" id="assignGo" disabled>Assign</button>
                   <small class="dim">Nothing is saved until you press this.</small>`
                : /* Deciding who works a file is a management act. A caseworker can still
                     claim an unassigned one for themselves, which is just picking it up. */
                  `<div>${esc((A.staff.find((u) => u.id === a.assigned_to) || {}).name || 'Nobody yet')}</div>
                   ${
                     a.assigned_to === A.user.id
                       ? '<button class="btn block mt" id="assignGo" data-self="release">Hand it back</button>'
                       : !a.assigned_to
                       ? '<button class="btn block mt" id="assignGo" data-self="claim">I will take this one</button>'
                       : '<small class="dim">Ask a dealership admin to reassign it.</small>'
                   }`
            }
          </div>
          <div class="panel">
            ${/* The old wording implied you could edit a bank's rate. You cannot — the
                  rate and fees are the lender's own published terms. The only things
                  that change here are WHICH lender, and the deposit and term. */ ''}
            <div class="lbl">Try a different lender or terms</div>
            <p class="muted" style="font-size:.84rem;margin-top:-4px">
              Rates and fees belong to each lender and are not editable here. Pick a different
              lender, deposit or term and the deal is re-priced against <em>their</em> published rules.
            </p>

            <div class="panel" style="margin-bottom:12px">
              <div class="row between"><span class="dim">Currently</span>
                <span>${esc((A.lenders.find((l) => l.id === a.lender_id) || {}).short_name || '—')}</span></div>
              <div class="row between"><span class="dim">Instalment</span>
                <b>${KES(a.monthly_payment)}/mo</b></div>
              <div class="row between"><span class="dim">Deposit · term</span>
                <span>${KES(a.deposit)} · ${a.tenor_months} months</span></div>
            </div>

            <div class="field"><label>Lender</label>
              <select id="reLender">${A.lenders
                .map((l) => `<option value="${l.id}" ${l.id === a.lender_id ? 'selected' : ''}>${esc(l.short_name || l.name)} — ${l.annual_rate}% ${esc(l.rate_type === 'flat' ? 'flat' : 'reducing')}, ${l.min_deposit_pct}% down min</option>`)
                .join('')}</select>
              <small class="dim">Their rate, their minimum deposit. Shown so you can see what you are moving to.</small>
            </div>
            <div class="grid-2">
              <div class="field"><label>Deposit the customer can raise</label><input type="number" id="reDep" value="${a.deposit}"></div>
              <div class="field"><label>Term (months)</label><input type="number" id="reTen" value="${a.tenor_months}"></div>
            </div>
            <button class="btn block primary" id="reGo">Re-price this deal</button>
            <small class="dim">Nothing is sent to the lender. This works out what the customer would pay, so you know before you ask.</small>
          </div>
        </div>
      </div>`;

    /**
     * Save one change and reopen the modal on the fresh record.
     *
     * It used to close the modal after every save, which meant assigning somebody threw
     * away whatever restructure the officer was part way through typing. Now the panel
     * stays open and repaints, so several changes can be made in one sitting.
     */
    const patch = async (body, msg) => {
      try {
        await PATCH(`/api/admin/applications/${a.id}`, body);
        toast(msg || 'Updated', 'ok');
        m.close();
        openApplication(a.id);   // reopen on the updated record
        render();                // and refresh the list behind it
      } catch (e) {
        toast(e.message, 'err');
      }
    };

    on(m.body, 'click', '[data-status]', (e, el) => patch({ status: el.dataset.status }, 'Status updated'));

    /* Assignment is an explicit act. Saving on `change` meant the moment a name was
       picked it was already assigned — before the officer had decided anything else —
       and the modal shut in their face. The button only wakes up once the choice
       actually differs from what is stored. */
    const assignSel = $('#assign', m.body);
    const assignBtn = $('#assignGo', m.body);
    if (assignSel && assignBtn) {
      const currentAssignee = a.assigned_to == null ? '' : String(a.assigned_to);
      assignSel.onchange = () => {
        assignBtn.disabled = assignSel.value === currentAssignee;
        assignBtn.textContent = assignSel.value ? 'Assign' : 'Unassign';
      };
      assignBtn.onclick = () =>
        patch({ assigned_to: assignSel.value }, assignSel.value ? 'Assigned' : 'Unassigned');
    } else if (assignBtn) {
      // Claiming it for yourself, or putting it back down. Allowed without `assign`.
      assignBtn.onclick = () =>
        assignBtn.dataset.self === 'claim'
          ? patch({ assigned_to: A.user.id }, 'It is yours')
          : patch({ assigned_to: null }, 'Handed back');
    }

    $('#reGo', m.body).onclick = () =>
      patch(
        { lender_id: $('#reLender', m.body).value, deposit: $('#reDep', m.body).value, tenor_months: $('#reTen', m.body).value },
        'Re-priced against that lender'
      );
    $('#addNote', m.body).onclick = async () => {
      const message = $('#note', m.body).value.trim();
      if (!message) return;
      await POST(`/api/admin/applications/${a.id}/notes`, { message });
      m.close();
      openApplication(a.id);
    };
    on(m.body, 'click', '[data-doc]', async (e, el) => {
      const d = await GET(`/api/admin/documents/${el.dataset.doc}`);
      const w = window.open('', '_blank');
      if (!w) return toast('Allow pop-ups to preview documents', 'err');
      w.document.write(
        d.mime && d.mime.startsWith('image/')
          ? `<title>${esc(d.filename)}</title><img src="${d.data}" style="max-width:100%">`
          : `<title>${esc(d.filename)}</title><iframe src="${d.data}" style="border:0;width:100%;height:100vh"></iframe>`
      );
    });
  }

  /* ---------------- inventory ---------------- */

  async function pageInventory() {
    view.innerHTML = '<div class="spinner"></div>';
    const res = await GET('/api/admin/vehicles' + scopeQ('pageSize=200'));
    view.innerHTML = `
      <div class="row between wrap-r mb">
        <h1>Inventory <span class="muted" style="font-size:1rem">${res.total}</span></h1>
        <div class="row">
          <input type="text" id="q" placeholder="Search…" style="width:200px">
          <select id="st" style="width:auto"><option value="">All statuses</option>
            ${['available', 'reserved', 'sold', 'draft'].map((s) => `<option value="${s}">${titleCase(s)}</option>`).join('')}</select>
          <a class="btn sm" href="/api/admin/export/vehicles${scopeQ()}">Export</a>
          <button class="btn sm" id="import">Import CSV</button>
          <button class="btn primary sm" id="add">+ Add vehicle</button>
        </div>
      </div>
      <div class="card scroll-x"><table class="tbl">
        <thead><tr><th></th><th>Vehicle</th><th>Dealer</th><th>Condition</th><th class="num">Year</th><th class="num">Mileage</th><th class="num">Price</th><th>Status</th><th class="num">Views</th><th></th></tr></thead>
        <tbody id="rows"></tbody>
      </table></div>`;

    const paint = () => {
      const q = ($('#q').value || '').toLowerCase();
      const st = $('#st').value;
      const rows = res.items.filter(
        (v) => (!st || v.status === st) && (!q || `${v.make} ${v.model} ${v.reg_no || ''}`.toLowerCase().includes(q))
      );
      $('#rows').innerHTML =
        rows
          .map(
            (v) => `<tr>
        <td><img src="${esc((v.images && v.images[0]) || '')}" style="width:60px;border-radius:6px"></td>
        <td><b>${esc(v.title)}</b><div class="dim" style="font-size:.76rem">${esc(v.reg_no || '')} · ${esc(v.body_type || '')} · ${esc(v.fuel || '')}</div></td>
        <td class="muted">${esc(v.dealer_name)}</td>
        <td class="muted">${esc(CONDITION_LABEL[v.condition] || v.condition)}</td>
        <td class="num">${v.year}</td><td class="num">${num(v.mileage_km)}</td><td class="num">${KES(v.price)}</td>
        <td><span class="tag ${v.status === 'available' ? 'ok' : v.status === 'sold' ? '' : 'warn'}">${esc(titleCase(v.status))}</span></td>
        <td class="num dim">${num(v.views)}</td>
        <td class="nowrap"><button class="btn sm" data-edit="${v.id}">Edit</button> <button class="btn sm danger" data-del="${v.id}">×</button></td>
      </tr>`
          )
          .join('') || '<tr><td colspan="10" class="empty">No vehicles.</td></tr>';
    };
    paint();
    $('#q').oninput = debounce(paint, 200);
    $('#st').onchange = paint;
    $('#add').onclick = () => vehicleForm(null);
    $('#import').onclick = importCsv;
    on(view, 'click', '[data-edit]', (e, el) => vehicleForm(res.items.find((v) => v.id === Number(el.dataset.edit))));
    on(view, 'click', '[data-del]', (e, el) =>
      confirmBox('Delete this vehicle permanently?', async () => {
        await DEL(`/api/admin/vehicles/${el.dataset.del}`);
        toast('Deleted', 'ok');
        render();
      })
    );
  }

  /**
   * Stock ageing — the screen a dealer principal opens first.
   *
   * A car on the forecourt is not idle stock. It is borrowed money, depreciating, with
   * interest running. The repricing list at the bottom is the point of the whole page:
   * cars that are slow because of their PRICE rather than the market, which is the only
   * kind the yard can fix this morning.
   */
  async function pageAgeing() {
    view.innerHTML = '<div class="spinner"></div>';
    const a = await GET('/api/admin/ageing');

    view.innerHTML = `
      <div class="row between wrap-r">
        <h2>Stock ageing</h2>
        <div class="muted">${a.total} cars on the forecourt · average ${a.averageDays} days · median ${a.medianDays}</div>
      </div>

      <div class="kpis mt">
        <div class="kpi"><div class="k">Stock value</div><div class="v">${KES(a.stockValue)}</div><div class="d">tied up right now</div></div>
        <div class="kpi"><div class="k">Cost of holding it</div><div class="v">${KES(a.carryingTotal)}</div><div class="d">interest and depreciation so far</div></div>
        <div class="kpi"><div class="k">Over ${a.thresholds.stale} days</div><div class="v">${a.buckets.find((b) => b.key === 'stale').count}</div><div class="d">margin is usually gone by here</div></div>
        <div class="kpi"><div class="k">To reprice</div><div class="v">${a.reprice.length}</div><div class="d">old stock priced above the pack</div></div>
      </div>

      <h3 class="mt-lg">How long it has been here</h3>
      <div class="grid-4">
        ${a.buckets
          .map(
            (b) => `<div class="panel">
              <div class="row between"><span class="lbl" style="margin:0">${esc(b.label)}</span><span class="tag ${b.tone}">${b.count}</span></div>
              <div style="font-size:1.15rem;font-weight:700">${KES(b.value)}</div>
              <div class="muted" style="font-size:.8rem">${KES(b.carrying)} spent holding it</div>
              <div class="dim" style="font-size:.78rem;margin-top:6px">${esc(b.note)}</div>
            </div>`
          )
          .join('')}
      </div>

      ${
        a.reprice.length
          ? `<h3 class="mt-lg">Worth repricing today</h3>
             <p class="muted" style="margin-top:-8px">Old stock that is also priced above comparable cars. Slow <em>and</em> dear is a price problem, not a market one.</p>
             <div class="scroll-x"><table class="tbl">
               <thead><tr><th>Vehicle</th><th class="num">Days</th><th class="num">Asking</th><th class="num">Over by</th><th class="num">Suggested</th><th class="num">Held cost</th><th></th></tr></thead>
               <tbody>${a.reprice
                 .map(
                   (r) => `<tr>
                     <td><b>${esc(r.title)}</b><div class="dim" style="font-size:.78rem">${esc(r.why)}</div></td>
                     <td class="num">${r.days}</td>
                     <td class="num">${KES(r.price)}</td>
                     <td class="num err-text">${KES(r.overBy)}</td>
                     <td class="num"><b>${KES(r.suggested)}</b></td>
                     <td class="num">${KES(r.carrying.total)}</td>
                     <td><button class="btn sm" data-reprice="${r.id}" data-to="${r.suggested}">Apply</button></td>
                   </tr>`
                 )
                 .join('')}</tbody>
             </table></div>`
          : '<div class="panel mt-lg">Nothing needs repricing. Either the stock is fresh or it is keenly priced.</div>'
      }

      <h3 class="mt-lg">By make</h3>
      <div class="scroll-x"><table class="tbl">
        <thead><tr><th>Make</th><th class="num">In stock</th><th class="num">Sold</th><th class="num">Avg days</th><th class="num">Sell-through</th></tr></thead>
        <tbody>${a.makes
          .map(
            (m) => `<tr><td>${esc(m.make)}</td><td class="num">${m.inStock}</td><td class="num">${m.sold}</td>
              <td class="num">${m.avgDays}</td>
              <td class="num">${m.sellThrough == null ? '<span class="dim">—</span>' : m.sellThrough + '%'}</td></tr>`
          )
          .join('')}</tbody>
      </table></div>

      <h3 class="mt-lg">Longest in stock</h3>
      <div class="scroll-x"><table class="tbl">
        <thead><tr><th>Vehicle</th><th class="num">Days</th><th class="num">Price</th><th class="num">Views</th><th class="num">Held cost</th><th class="num">Losing</th></tr></thead>
        <tbody>${a.oldest
          .map(
            (r) => `<tr><td>${esc(r.title)} ${r.status === 'reserved' ? '<span class="tag">reserved</span>' : ''}</td>
              <td class="num"><span class="tag ${r.tone}">${r.days}</span></td>
              <td class="num">${KES(r.price)}</td><td class="num">${r.views}</td>
              <td class="num">${KES(r.carrying.total)}</td>
              <td class="num">${r.carrying.depreciationRatePct}%<div class="dim" style="font-size:.72rem">a year, this car</div></td></tr>`
          )
          .join('')}</tbody>
      </table></div>`;

    on(view, 'click', '[data-reprice]', (e, el) => {
      const to = Number(el.dataset.to);
      confirmBox(`Reprice this car to ${KES(to)}?`, async () => {
        try {
          await PATCH(`/api/admin/vehicles/${el.dataset.reprice}`, { price: to });
          toast('Repriced', 'ok');
          render();
        } catch (err) {
          toast(err.message, 'err');
        }
      });
    });
  }

  function vehicleForm(v) {
    const isNew = !v;
    v = v || { condition: 'used', status: 'available', year: new Date().getFullYear(), features: [], images: [] };
    const insp = v.inspection || {};
    const dealerOpts = A.dealers.map((d) => `<option value="${d.id}" ${v.dealer_id === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('');
    const m = modal(isNew ? 'Add vehicle' : 'Edit vehicle', `
      <div class="grid-3">
        <div class="field"><label>Make *</label><input type="text" data-k="make" value="${esc(v.make || '')}"></div>
        <div class="field"><label>Model *</label><input type="text" data-k="model" value="${esc(v.model || '')}"></div>
        <div class="field"><label>Variant / trim</label><input type="text" data-k="variant" value="${esc(v.variant || '')}"></div>
        <div class="field"><label>Year *</label><input type="number" data-k="year" value="${esc(v.year)}"></div>
        <div class="field"><label>Price (KES) *</label><input type="number" data-k="price" value="${esc(v.price || '')}"></div>
        <div class="field"><label>Was price (KES)</label><input type="number" data-k="old_price" value="${esc(v.old_price || '')}"></div>
        <div class="field"><label>Condition</label><select data-k="condition">
          ${Object.entries(CONDITION_LABEL).map(([k, l]) => `<option value="${k}" ${v.condition === k ? 'selected' : ''}>${l}</option>`).join('')}
        </select></div>
        <div class="field"><label>Body type</label><input type="text" data-k="body_type" value="${esc(v.body_type || '')}"></div>
        <div class="field"><label>Fuel</label><select data-k="fuel">
          ${['Petrol', 'Diesel', 'Hybrid', 'Electric'].map((f) => `<option ${v.fuel === f ? 'selected' : ''}>${f}</option>`).join('')}
        </select></div>
        <div class="field"><label>Transmission</label><select data-k="transmission">
          ${['Automatic', 'Manual', 'CVT'].map((f) => `<option ${v.transmission === f ? 'selected' : ''}>${f}</option>`).join('')}
        </select></div>
        <div class="field"><label>Drivetrain</label><select data-k="drivetrain">
          ${['2WD', 'AWD', '4WD'].map((f) => `<option ${v.drivetrain === f ? 'selected' : ''}>${f}</option>`).join('')}
        </select></div>
        <div class="field"><label>Engine (cc)</label><input type="number" data-k="engine_cc" value="${esc(v.engine_cc || '')}"></div>
        <div class="field"><label>Mileage (km)</label><input type="number" data-k="mileage_km" value="${esc(v.mileage_km || 0)}"></div>
        <div class="field"><label>Colour</label><input type="text" data-k="color" value="${esc(v.color || '')}"></div>
        <div class="field"><label>Seats</label><input type="number" data-k="seats" value="${esc(v.seats || '')}"></div>
        <div class="field"><label>Reg. number</label><input type="text" data-k="reg_no" value="${esc(v.reg_no || '')}"></div>
        <div class="field"><label>Status</label><select data-k="status">
          ${['available', 'reserved', 'sold', 'draft'].map((s) => `<option value="${s}" ${v.status === s ? 'selected' : ''}>${titleCase(s)}</option>`).join('')}
        </select></div>
        <div class="field"><label>Dealership</label><select data-k="dealer_id" ${can('superadmin') ? '' : 'disabled'}>${dealerOpts}</select></div>
      </div>
      <h4>Import &amp; registration</h4>
      <div class="grid-3">
        <div class="field"><label>Registration status</label><select data-k="reg_status">
          ${[['registered', 'Registered in Kenya'], ['awaiting_registration', 'Awaiting KE registration'], ['in_transit', 'In transit / on the water']]
            .map((r) => `<option value="${r[0]}" ${(v.reg_status || 'registered') === r[0] ? 'selected' : ''}>${r[1]}</option>`)
            .join('')}
        </select></div>
        <div class="field"><label>Expected on the road</label><input type="date" data-k="reg_expected_date" value="${esc(v.reg_expected_date || '')}"></div>
        <div class="field"><label>Import / source reference</label><input type="text" data-k="source_ref" value="${esc(v.source_ref || '')}" placeholder="e.g. CFJ2763900"></div>
        <div class="field"><label>Warranty (months)</label><input type="number" data-k="warranty_months" value="${esc(v.warranty_months || 0)}"></div>
      </div>
      <h4>Specification</h4>
      <p class="muted" style="font-size:.84rem;margin-top:-6px">Leave a box empty and the listing estimates it from engine size, weight and
      body type, labelled as an estimate. Type the logbook or brochure figure in and the listing shows it as measured.</p>
      <div class="grid-3">
        <div class="field"><label>Power (hp)</label><input type="number" data-k="power_hp" value="${esc(v.power_hp || '')}" placeholder="estimated"></div>
        <div class="field"><label>Torque (Nm)</label><input type="number" data-k="torque_nm" value="${esc(v.torque_nm || '')}" placeholder="estimated"></div>
        <div class="field"><label>0–100 km/h (seconds)</label><input type="number" step="0.1" data-k="zero_to_100" value="${esc(v.zero_to_100 || '')}" placeholder="estimated"></div>
        <div class="field"><label>Top speed (km/h)</label><input type="number" data-k="top_speed" value="${esc(v.top_speed || '')}" placeholder="estimated"></div>
        <div class="field"><label>Kerb weight (kg)</label><input type="number" data-k="kerb_weight" value="${esc(v.kerb_weight || '')}" placeholder="estimated"></div>
        <div class="field"><label>Rim diameter (inches)</label><input type="number" data-k="rim_size" value="${esc(v.rim_size || '')}" placeholder="estimated"></div>
        <div class="field"><label>Tyre size</label><input type="text" data-k="tyre_size" value="${esc(v.tyre_size || '')}" placeholder="e.g. 225/55 R18"></div>
        <div class="field"><label>Ground clearance (mm)</label><input type="number" data-k="ground_clearance" value="${esc(v.ground_clearance || '')}" placeholder="estimated"></div>
        <div class="field"><label>Boot space (litres)</label><input type="number" data-k="boot_litres" value="${esc(v.boot_litres || '')}" placeholder="estimated"></div>
        <div class="field"><label>Fuel tank (litres)</label><input type="number" data-k="fuel_tank" value="${esc(v.fuel_tank || '')}" placeholder="estimated"></div>
        <div class="field"><label>Seat trim</label><input type="text" data-k="seat_material" value="${esc(v.seat_material || '')}" placeholder="e.g. Leather"></div>
        <div class="field"><label>Screen size (inches)</label><input type="number" step="0.1" data-k="screen_size" value="${esc(v.screen_size || '')}"></div>
        <div class="field"><label>Aspiration</label><select data-k="forced_induction">
          ${[['', 'Work it out from the engine'], ['1', 'Turbocharged / supercharged'], ['0', 'Naturally aspirated']]
            .map((o) => `<option value="${o[0]}" ${String(v.forced_induction == null ? '' : v.forced_induction) === o[0] ? 'selected' : ''}>${o[1]}</option>`)
            .join('')}
        </select></div>
      </div>

      <h4>Condition report</h4>
      <p class="muted" style="font-size:.84rem;margin-top:-6px">Score each area out of 100 after your workshop check. Anything you leave blank
      shows on the listing as "not checked" — it never shows as a pass.</p>
      <div class="grid-3">
        ${INSPECTION_AREAS.map(
          ([k, label]) =>
            `<div class="field"><label>${label}</label><input type="number" min="0" max="100" data-insp="${k}" value="${esc(insp[k] == null ? '' : insp[k])}" placeholder="not checked"></div>`
        ).join('')}
        <div class="field"><label>Checked on</label><input type="date" data-insp="checkedOn" value="${esc(insp.checkedOn || '')}"></div>
      </div>
      <div class="field"><label>Inspection notes</label><input type="text" data-insp="notes" value="${esc(insp.notes || '')}" placeholder="What the workshop found, in one line"></div>

      <div class="field"><label>Description</label><textarea data-k="description">${esc(v.description || '')}</textarea></div>
      <div class="grid-2">
        <div class="field"><label>Features (one per line)</label><textarea data-k="features">${esc((v.features || []).join('\n'))}</textarea></div>
        <div class="field"><label>Image URLs (one per line)</label><textarea data-k="images" placeholder="Leave blank to auto-generate a placeholder">${esc((v.images || []).join('\n'))}</textarea></div>
      </div>
      <label class="check"><input type="checkbox" data-k="featured" ${v.featured ? 'checked' : ''}><span>Show in featured stock</span></label>
      <label class="check"><input type="checkbox" data-k="duty_paid" ${v.duty_paid !== false ? 'checked' : ''}><span>Duty paid</span></label>
      <label class="check"><input type="checkbox" data-k="verified" ${v.verified ? 'checked' : ''}><span>Inspected &amp; verified — shows a badge on the listing</span></label>
      <label class="check"><input type="checkbox" data-k="negotiable" ${v.negotiable ? 'checked' : ''}><span>Price negotiable</span></label>
      <div class="row mt" style="justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn primary" id="save">${isNew ? 'Create' : 'Save changes'}</button></div>
    `, { wide: true });

    $('#save', m.body).onclick = async () => {
      const payload = {};
      $$('[data-k]', m.body).forEach((el) => {
        const k = el.dataset.k;
        if (el.type === 'checkbox') payload[k] = el.checked;
        else if (k === 'features' || k === 'images') payload[k] = el.value.split('\n').map((s) => s.trim()).filter(Boolean);
        else payload[k] = el.value;
      });
      // the scorecard is one JSON column, so gather it separately; an all-blank card is
      // stored as nothing rather than as five zeroes
      const card = {};
      $$('[data-insp]', m.body).forEach((el) => {
        if (el.value !== '') card[el.dataset.insp] = el.value;
      });
      payload.inspection = Object.keys(card).length ? card : null;
      if (!payload.dealer_id) payload.dealer_id = A.user.dealer_id;
      try {
        if (isNew) await POST('/api/admin/vehicles', payload);
        else await PATCH(`/api/admin/vehicles/${v.id}`, payload);
        toast('Saved', 'ok');
        m.close();
        render();
      } catch (e) {
        toast(e.message, 'err');
      }
    };
  }

  function importCsv() {
    const m = modal('Import stock from CSV', `
      <p class="muted">Paste a CSV with a header row. Recognised columns:
      <code class="mono">make, model, variant, year, price, condition, body_type, fuel, transmission, drivetrain, engine_cc, mileage_km, color, seats, reg_no, status, description</code></p>
      <div class="field"><label>Dealership</label><select id="d">${A.dealers.map((d) => `<option value="${d.id}" ${String(d.id) === String(A.user.dealer_id) ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></div>
      <div class="field"><label>CSV</label><textarea id="csv" style="min-height:200px" class="mono" placeholder="make,model,year,price,condition,body_type,fuel,transmission,mileage_km,color
Toyota,Vitz,2019,1150000,foreign_used,Hatchback,Petrol,Automatic,62000,Silver"></textarea></div>
      <button class="btn primary" id="go">Import</button>
      <div id="out" class="mt"></div>`);
    $('#go', m.body).onclick = async () => {
      try {
        const r = await POST('/api/admin/vehicles/import', { dealer_id: $('#d', m.body).value, csv: $('#csv', m.body).value });
        $('#out', m.body).innerHTML = `<div class="tag ok">${r.created} created</div>
          ${r.errors.length ? `<ul class="err-text mt">${r.errors.map((e) => `<li>Row ${e.row}: ${esc(e.error)}</li>`).join('')}</ul>` : ''}`;
        if (r.created) toast(`${r.created} vehicles imported`, 'ok');
      } catch (e) {
        toast(e.message, 'err');
      }
    };
  }

  /* ---------------- check a client ----------------
     The screen a broker opens every day, and the only one that is useful with no
     dealership signed up at all.

     The job it does is subtraction. A client says "Prado"; on his salary no lender in
     the country will fund one, and finding that out the usual way costs the broker two
     weeks of walking between banks and a customer who gives up. Here it costs ninety
     seconds, and the answer comes with the reason, which is what lets him say something
     useful instead of "they refused".

     Declines are shown as prominently as approvals on purpose. A tool that only tells
     him the good news is a tool he stops believing the first time a "yes" turns into a
     no at the bank counter. */

  async function pageBrokerCheck() {
    view.innerHTML = `
      <h2>Check a client</h2>
      <p class="muted" style="margin-top:-6px">Before you walk anyone into a bank. Ninety
        seconds here saves a fortnight of being refused.</p>

      <div class="card mt">
        <div class="grid-3">
          <div class="field"><label for="ckName">Client name</label><input id="ckName" placeholder="James Mwangi"></div>
          <div class="field"><label for="ckPhone">Phone</label><input id="ckPhone" placeholder="0733 445 566" inputmode="tel"></div>
          <div class="field"><label for="ckAge">Age</label><input id="ckAge" type="number" value="34"></div>
        </div>
        <div class="grid-3 mt">
          <div class="field"><label for="ckIncome">Takes home / month</label><input id="ckIncome" type="number" placeholder="95000" inputmode="numeric"></div>
          <div class="field"><label for="ckOblig">Already pays out / month</label><input id="ckOblig" type="number" placeholder="18000" inputmode="numeric"></div>
          <div class="field"><label for="ckEmp">Employment</label>
            <select id="ckEmp">
              <option value="employed">Employed</option>
              <option value="self_employed">Self-employed</option>
              <option value="business">Business owner</option>
              <option value="contract">Contract</option>
              <option value="gig">Gig / casual</option>
            </select></div>
        </div>
        <div class="grid-3 mt">
          <div class="field"><label for="ckPrice">Car they are after (KES)</label><input id="ckPrice" type="number" placeholder="3200000" inputmode="numeric"></div>
          <div class="field"><label for="ckDep">Deposit they have</label><input id="ckDep" type="number" placeholder="640000" inputmode="numeric"></div>
          <div class="field"><label for="ckTenor">Over how long</label>
            <select id="ckTenor">
              <option value="24">24 months</option>
              <option value="36">36 months</option>
              <option value="48" selected>48 months</option>
              <option value="60">60 months</option>
            </select></div>
        </div>
        <label class="check mt"><input type="checkbox" id="ckCrb" checked> <span>Clean CRB</span></label>
        <button class="btn primary block lg mt" id="ckGo">Check this client</button>
        <div id="ckMsg" class="mt"></div>
      </div>

      <div id="ckOut"></div>`;

    $('#ckGo').onclick = async () => {
      const btn = $('#ckGo');
      const price = Number($('#ckPrice').value) || 0;
      btn.disabled = true;
      btn.textContent = 'Checking…';
      $('#ckMsg').innerHTML = '';
      try {
        const r = await POST('/api/prequalify', {
          dealer: A.site,   // the slug the console booted against; A.dealer does not exist
          name: $('#ckName').value,
          phone: $('#ckPhone').value,
          netIncome: Number($('#ckIncome').value) || 0,
          obligations: Number($('#ckOblig').value) || 0,
          employment: $('#ckEmp').value,
          crbClean: $('#ckCrb').checked,
          age: Number($('#ckAge').value) || 0,
          targetPrice: price,
          deposit: Number($('#ckDep').value) || 0,
          tenor: Number($('#ckTenor').value),
        });
        await renderCheck(r, price);
      } catch (err) {
        $('#ckMsg').innerHTML = `<div class="form-note err"><span>✕</span><div>${esc(err.message)}</div></div>`;
      }
      btn.disabled = false;
      btn.textContent = 'Check this client';
    };

    async function renderCheck(r, price) {
      const yes = r.offers.filter((o) => o.eligible).sort((a, b) => a.monthlyPayment - b.monthlyPayment);
      const no = r.offers.filter((o) => !o.eligible);
      const best = yes[0];

      /* What the car costs to RUN, not just to repay. A broker who only quotes the
         instalment has a client who defaults in month four and blames him for it. */
      let run = null;
      if (best && price) {
        try {
          run = await POST('/api/running-cost', {
            price,
            engineLitres: 1.8,
            fuel: 'petrol',
            kmPerYear: 15000,
            ageYears: 6,
            comprehensive: true,
            includeLoan: true,
            loan: { monthlyPayment: best.monthlyPayment, tenorMonths: Number($('#ckTenor').value) },
          });
        } catch { /* the answer above still stands without it */ }
      }

      $('#ckOut').innerHTML = `
        <div class="card mt-lg" style="border-left:4px solid var(--${yes.length ? 'ok' : 'err'})">
          <div style="font-size:1.6rem;font-weight:700">
            ${yes.length ? `${yes.length} of ${r.total} lenders would approve him` : `No lender will fund this`}
          </div>
          ${
            best
              ? `<div class="mt">Cheapest: <b>${esc(best.lender.name)}</b> —
                   <b>${KES(best.monthlyPayment)}/month</b> at ${best.apr}% APR</div>`
              : `<div class="mt muted">Try a cheaper car, a bigger deposit, or a longer term.</div>`
          }
          ${
            run
              ? `<div class="mt" style="font-size:.95rem">
                   Real cost of owning it: <b>${KES(run.totalMonthly)}/month</b> —
                   the loan plus fuel, insurance, servicing and tyres.
                   <div class="dim" style="font-size:.82rem">Tell him this number, not the instalment.
                     It is why people default in month four.</div>
                 </div>`
              : ''
          }
        </div>

        ${
          yes.length
            ? `<h3 class="mt-lg">Who will fund it</h3>
               <div class="scroll-x"><table class="tbl">
                 <thead><tr><th>Lender</th><th>Type</th><th class="num">Monthly</th><th class="num">APR</th></tr></thead>
                 <tbody>${yes
                   .map(
                     (o) => `<tr>
                       <td><b>${esc(o.lender.name)}</b></td>
                       <td class="dim">${esc(titleCase(o.lender.type || ''))}</td>
                       <td class="num"><b>${KES(o.monthlyPayment)}</b></td>
                       <td class="num">${o.apr}%</td>
                     </tr>`
                   )
                   .join('')}</tbody></table></div>`
            : ''
        }

        ${
          no.length
            ? `<h3 class="mt-lg">Who will not, and why</h3>
               <p class="muted" style="margin-top:-6px">Read these out to the client. It is
                 the difference between "they refused" and advice.</p>
               <div class="scroll-x"><table class="tbl">
                 <thead><tr><th>Lender</th><th>Reason</th></tr></thead>
                 <tbody>${no
                   .map(
                     (o) => `<tr>
                       <td>${esc(o.lender.name)}</td>
                       <td class="dim">${esc((o.blockers || []).join(' · ') || 'Does not fit their rules')}</td>
                     </tr>`
                   )
                   .join('')}</tbody></table></div>`
            : ''
        }

        <p class="dim mt-lg" style="font-size:.8rem">Saved as <code>${esc(r.ref)}</code> against
          this client, so you can pull it up when they call back.</p>`;
    }
  }

  /* ---------------- introducers (the dealer's view) ----------------
     Only brokers who have actually brought THIS dealership business. A directory of
     other people's introducers is not a dealership's business. */

  async function pageIntroducers() {
    view.innerHTML = '<div class="spinner"></div>';
    const d = await GET('/api/admin/brokers');

    view.innerHTML = `
      <h2>Introducers</h2>
      <p class="muted" style="margin-top:-6px">Brokers who have brought you business.
        ${esc(d.basis)}</p>

      ${
        d.items.length
          ? `<div class="scroll-x"><table class="tbl">
              <thead><tr><th>Broker</th><th>Phone</th><th class="num">Introduced</th><th class="num">Funded</th><th class="num">Value</th><th>Standing</th><th></th></tr></thead>
              <tbody>${d.items
                .map(
                  (b) => `<tr>
                    <td><b>${esc(b.name)}</b></td>
                    <td class="dim">${esc(b.phone || '—')}</td>
                    <td class="num">${b.introduced}</td>
                    <td class="num">${b.funded}</td>
                    <td class="num">${KES(b.fundedValue)}</td>
                    <td>
                      <span class="tag ${b.verified ? 'ok' : b.status === 'suspended' ? 'err' : 'warn'}">${esc(titleCase(b.status))}</span>
                      ${b.missing.length ? `<div class="dim" style="font-size:.74rem">Needs: ${b.missing.map(esc).join('; ')}</div>` : ''}
                    </td>
                    <td>
                      ${
                        b.vouchedByUs
                          ? '<span class="tag ok">You vouched</span>'
                          : `<button class="btn sm" data-vouch="${b.id}">Vouch for them</button>`
                      }
                      ${
                        allow('staff')
                          ? b.status === 'suspended'
                            ? `<button class="btn sm ok" data-reinstate="${b.id}">Reinstate</button>`
                            : `<button class="btn sm err" data-suspend="${b.id}">Suspend</button>`
                          : ''
                      }
                    </td>
                  </tr>`
                )
                .join('')}</tbody></table></div>
             <p class="dim mt" style="font-size:.8rem">Vouching says this person is real and
               you have dealt with them. It is one of three tests and you can only do it once —
               the badge needs two different dealerships, so one yard cannot make a broker
               verified on its own.</p>`
          : `<div class="empty">No broker has introduced business here yet.
               They appear the moment one of their registered clients applies.</div>`
      }`;

    on(view, 'click', '[data-vouch]', (e, el) => {
      confirmBox(`Vouch for this broker? You are telling other dealerships they are real.`, async () => {
        try {
          await POST(`/api/admin/broker/${el.dataset.vouch}/reference`, {});
          toast('Vouched', 'ok');
          render();
        } catch (err) {
          toast(err.message, 'err');
        }
      });
    });

    on(view, 'click', '[data-suspend]', (e, el) => {
      const reason = prompt('Why are you suspending them? This is recorded.');
      if (!reason) return;
      POST(`/api/admin/broker/${el.dataset.suspend}/suspend`, { reason })
        .then(() => { toast('Suspended', 'ok'); render(); })
        .catch((err) => toast(err.message, 'err'));
    });

    on(view, 'click', '[data-reinstate]', (e, el) => {
      POST(`/api/admin/broker/${el.dataset.reinstate}/reinstate`, {})
        .then(() => { toast('Reinstated', 'ok'); render(); })
        .catch((err) => toast(err.message, 'err'));
    });
  }

  /* ---------------- broker ----------------
     Two screens, and both exist to answer one question a broker has been burned by
     before: "will I actually get paid for this one?" Everything here is either the
     claim that protects them or the evidence that builds their standing. */

  const CLAIM_TONE = (daysLeft) => (daysLeft > 30 ? 'ok' : daysLeft > 0 ? 'warn' : 'err');

  async function pageBrokerClients() {
    view.innerHTML = '<div class="spinner"></div>';
    const b = await GET('/api/admin/broker/book');
    const e = b.earnings || {};

    view.innerHTML = `
      <div class="row between wrap-r">
        <div><h2>My clients</h2>
          <p class="muted" style="margin-top:-6px">Register a client before you introduce them.
            For ${b.claimDays} days after that, any car they buy here is credited to you.</p></div>
      </div>

      <div class="kpis mt">
        <div class="kpi"><div class="k">Funded</div><div class="v">${e.fundedCount || 0}</div>
          <div class="d">${KES(e.fundedValue || 0)} of cars</div></div>
        <div class="kpi"><div class="k">Still going</div><div class="v">${e.liveCount || 0}</div>
          <div class="d">${KES(e.liveValue || 0)} in play</div></div>
        <div class="kpi"><div class="k">Earned</div><div class="v">${e.ratePerDeal ? KES(e.earned || 0) : '—'}</div>
          <div class="d">${esc(e.note || '')}</div></div>
      </div>

      <div class="card mt">
        <div class="lbl">Register a client</div>
        <p class="muted" style="font-size:.86rem">Their phone number is what protects the
          introduction — not the car. If you show them a Prado and they buy a Harrier, you
          are still credited.</p>
        <div class="grid-3 mt">
          <div class="field"><label for="bcName">Name</label><input id="bcName" placeholder="John Omondi"></div>
          <div class="field"><label for="bcPhone">Phone</label><input id="bcPhone" placeholder="0712 345 678" inputmode="tel"></div>
          <div class="field"><label for="bcNote">What they are after (optional)</label><input id="bcNote" placeholder="Prado or similar, up to 7M"></div>
        </div>
        <button class="btn primary mt" id="bcSave">Register and protect</button>
        <div id="bcMsg" class="mt"></div>
      </div>

      <h3 class="mt-lg">Registered (${b.clients.length})</h3>
      ${
        b.clients.length
          ? `<div class="scroll-x"><table class="tbl">
              <thead><tr><th>Client</th><th>Phone</th><th>Looking for</th><th class="num">Protected until</th><th>Confirmed</th></tr></thead>
              <tbody>${b.clients
                .map((c) => {
                  const left = Math.ceil((new Date(c.claim_expires) - Date.now()) / 864e5);
                  return `<tr>
                    <td><b>${esc(c.name)}</b></td>
                    <td>${esc(c.phone)}</td>
                    <td class="dim">${esc(c.note || '—')}</td>
                    <td class="num"><span class="tag ${CLAIM_TONE(left)}">${left > 0 ? left + ' days left' : 'expired'}</span></td>
                    <td>${c.confirmed_by_client ? '<span class="tag ok">By the client</span>' : '<span class="dim">Not yet</span>'}</td>
                  </tr>`;
                })
                .join('')}</tbody></table></div>`
          : '<div class="empty">No clients registered yet. Register one above before you introduce them — that is the whole point.</div>'
      }

      <h3 class="mt-lg">Their applications (${b.applications.length})</h3>
      ${
        b.applications.length
          ? `<div class="scroll-x"><table class="tbl">
              <thead><tr><th>Ref</th><th>Client</th><th>Car</th><th class="num">Price</th><th>Stage</th></tr></thead>
              <tbody>${b.applications
                .map(
                  (a) => `<tr>
                    <td><code>${esc(a.ref)}</code></td>
                    <td>${esc(a.client || '—')}</td>
                    <td>${esc(a.vehicle || '—')}</td>
                    <td class="num">${KES(a.price || 0)}</td>
                    <td><span class="tag ${STATUS_TONE[a.status] || ''}">${esc(titleCase(a.status))}</span></td>
                  </tr>`
                )
                .join('')}</tbody></table></div>
             <p class="dim mt" style="font-size:.8rem">Names only. Your clients' ID numbers,
               payslips and bank statements are not shown to introducers.</p>`
          : '<div class="empty">Nothing yet. An application appears here the moment one of your registered clients applies.</div>'
      }`;

    $('#bcSave').onclick = async () => {
      const btn = $('#bcSave');
      btn.disabled = true;
      try {
        const r = await POST('/api/admin/broker/clients', {
          name: $('#bcName').value,
          phone: $('#bcPhone').value,
          note: $('#bcNote').value,
        });
        toast(r.already ? 'Already yours — nothing changed' : `Protected for ${r.holdsForDays} days`, 'ok');
        render();
      } catch (err) {
        $('#bcMsg').innerHTML = `<div class="form-note err"><span>✕</span><div>${esc(err.message)}</div></div>`;
        btn.disabled = false;
      }
    };
  }

  async function pageBrokerVerify() {
    view.innerHTML = '<div class="spinner"></div>';
    const v = await GET('/api/admin/broker/verification');
    const done = v.checks.filter((c) => c.done).length;

    view.innerHTML = `
      <h2>My verification</h2>
      <p class="muted" style="margin-top:-6px">${esc(v.basis)}</p>

      <div class="card mt">
        <div class="row between">
          <div>
            <div class="lbl" style="margin:0">Status</div>
            <div style="font-size:1.5rem;font-weight:600">${
              v.verified ? 'Verified' : titleCase(v.status)
            }</div>
          </div>
          <span class="tag ${v.verified ? 'ok' : v.status === 'suspended' ? 'err' : 'warn'}">${done} of ${v.checks.length} done</span>
        </div>
        ${
          v.suspendedReason
            ? `<div class="form-note err mt"><span>✕</span><div>${esc(v.suspendedReason)}</div></div>`
            : ''
        }
      </div>

      <div class="mt">
        ${v.checks
          .map(
            (c) => `<div class="card tight mt">
              <div class="row between">
                <div>
                  <b>${c.done ? '✓' : '○'} ${esc(c.label)}</b>
                  <div class="dim" style="font-size:.84rem">${esc(c.detail)}${
                    c.from && c.from.length ? ' — ' + c.from.map(esc).join(', ') : ''
                  }</div>
                </div>
                <span class="tag ${c.done ? 'ok' : ''}">${c.done ? 'Done' : 'Outstanding'}</span>
              </div>
            </div>`
          )
          .join('')}
      </div>

      ${
        v.checks.find((c) => c.key === 'identity').done
          ? ''
          : `<div class="card mt">
              <div class="lbl">Send your details</div>
              <p class="muted" style="font-size:.86rem">Stored encrypted. A dealership sees
                that you are verified — never your ID number.</p>
              <div class="grid-3 mt">
                <div class="field"><label for="bvId">ID number</label><input id="bvId" inputmode="numeric"></div>
                <div class="field"><label for="bvKra">KRA PIN</label><input id="bvKra" placeholder="A000000000X"></div>
                <div class="field"><label for="bvAddr">Physical address</label><input id="bvAddr" placeholder="Ngong Road, Nairobi"></div>
              </div>
              <button class="btn primary mt" id="bvSave">Submit</button>
              <div id="bvMsg" class="mt"></div>
            </div>`
      }

      <p class="dim mt-lg" style="font-size:.8rem">Nobody can buy this badge, including you.
        It is worked out from what you have actually done, every time it is checked — which
        is the only reason a dealership has any reason to trust it.</p>`;

    const save = $('#bvSave');
    if (save) {
      save.onclick = async () => {
        save.disabled = true;
        try {
          await POST('/api/admin/broker/verification', {
            idNumber: $('#bvId').value,
            kraPin: $('#bvKra').value,
            address: $('#bvAddr').value,
          });
          toast('Details received', 'ok');
          render();
        } catch (err) {
          $('#bvMsg').innerHTML = `<div class="form-note err"><span>✕</span><div>${esc(err.message)}</div></div>`;
          save.disabled = false;
        }
      };
    }
  }

  /* ---------------- lenders ---------------- */

  async function pageLenders() {
    view.innerHTML = '<div class="spinner"></div>';
    A.lenders = await GET('/api/admin/lenders' + scopeQ());
    view.innerHTML = `
      <div class="row between wrap-r mb">
        <div>
          <h1>Lenders &amp; rules</h1>
          <p class="muted" style="margin:0">Everything the comparison screen shows comes from here. Change a rate or a rule and the customer's quote changes immediately.</p>
        </div>
        <div class="row">
          <a class="btn sm" href="/api/admin/export/lenders">Export</a>
          ${can('superadmin', 'dealer_admin') ? '<button class="btn primary sm" id="add">+ Add lender</button>' : ''}
        </div>
      </div>
      <div class="card scroll-x"><table class="tbl">
        <thead><tr><th></th><th>Lender</th><th>Type</th><th>Rate</th><th class="num">Min deposit</th><th class="num">Max term</th><th class="num">Min income</th><th class="num">Max DTI</th><th class="num">Max age</th><th class="num">Approval</th><th>Offered</th><th></th></tr></thead>
        <tbody>${A.lenders
          .map(
            (l) => `<tr>
          <td><span class="tag" style="background:${esc(l.color)};color:#fff;border:0">${esc(l.logo_text || '?')}</span></td>
          <td><b>${esc(l.name)}</b>${l.active ? '' : ' <span class="tag err">inactive</span>'}</td>
          <td class="muted">${esc(LENDER_TYPE_LABEL[l.type] || l.type)}</td>
          <td>${l.annual_rate}% <span class="dim">${esc(l.rate_type)}</span></td>
          <td class="num">${l.min_deposit_pct}%</td>
          <td class="num">${l.max_tenor_months} mo</td>
          <td class="num">${KESK(l.min_monthly_income)}</td>
          <td class="num">${l.max_dti_pct}%</td>
          <td class="num">${l.max_vehicle_age_years} yr</td>
          <td class="num">${l.approval_days}d</td>
          <td>${
            A.scope || A.user.role !== 'superadmin'
              ? `<label class="check" style="margin:0"><input type="checkbox" data-toggle="${l.id}" ${l.enabled_for_dealer !== false ? 'checked' : ''}></label>`
              : '<span class="dim">—</span>'
          }</td>
          <td><button class="btn sm" data-edit="${l.id}">Rules</button></td>
        </tr>`
          )
          .join('')}</tbody>
      </table></div>
      <div class="card mt">
        <h3>What each rule does</h3>
        <div class="grid-2 muted" style="font-size:.87rem">
          <div>
            <p><b>Rate type</b> — reducing balance charges interest on what you still owe; flat charges it on the original amount for the whole term. A 14% flat rate costs roughly what a 25% reducing rate costs. The customer's screen shows the true APR for both, so the comparison is honest.</p>
            <p><b>Minimum deposit</b> — if a customer asks for less, the engine quotes at this floor and tells them the shortfall rather than hiding the lender.</p>
            <p><b>Debt-to-income ceiling</b> — the instalment plus existing repayments as a share of net income. This is the rule that blocks most applications.</p>
          </div>
          <div>
            <p><b>Maximum vehicle age</b> — banks typically stop at 8 years; microfinance houses go further. Set it and old stock stops being quoted at lenders who would reject it.</p>
            <p><b>Capitalise fees</b> — roll the fees into the loan so the customer only brings the deposit on day one.</p>
            <p><b>Employment types &amp; CRB</b> — the gates that decide whether a boda operator or a listed applicant sees any offer at all.</p>
          </div>
        </div>
      </div>`;
    const add = $('#add');
    if (add) add.onclick = () => lenderForm(null);
    on(view, 'click', '[data-edit]', (e, el) => lenderForm(A.lenders.find((l) => l.id === Number(el.dataset.edit))));
    on(view, 'change', '[data-toggle]', async (e, el) => {
      const dealer = A.dealers.find((d) => d.slug === A.scope) || A.dealers.find((d) => d.id === A.user.dealer_id);
      await POST('/api/admin/dealer-lenders', { dealer_id: dealer.id, lender_id: Number(el.dataset.toggle), enabled: el.checked });
      toast(el.checked ? 'Offered to customers' : 'Hidden from customers', 'ok');
    });
  }

  function lenderForm(l) {
    const isNew = !l;
    l = l || {
      type: 'bank',
      rate_type: 'reducing',
      annual_rate: 14,
      min_deposit_pct: 20,
      min_tenor_months: 12,
      max_tenor_months: 60,
      min_loan: 300000,
      max_loan: 10000000,
      min_monthly_income: 40000,
      max_dti_pct: 55,
      max_vehicle_age_years: 8,
      processing_fee_pct: 2,
      processing_fee_min: 5000,
      valuation_fee: 6000,
      tracking_fee: 0,
      legal_fee: 0,
      insurance_rate_pct: 4,
      approval_days: 5,
      min_age: 21,
      max_age_at_maturity: 65,
      bank_statement_months: 6,
      active: true,
      color: '#1d4ed8',
      allowed_employment: ['employed', 'contract', 'self_employed', 'business'],
      allowed_conditions: ['new', 'used', 'foreign_used'],
      requirements: [],
      logbook_holder: 'lender',
    };
    const nf = (k, label, suffix) =>
      `<div class="field"><label>${label}${suffix ? ` <span class="dim">(${suffix})</span>` : ''}</label><input type="number" step="any" data-k="${k}" value="${esc(l[k] == null ? '' : l[k])}"></div>`;

    const m = modal(isNew ? 'Add lender' : `Rules — ${l.name}`, `
      <div class="grid-3">
        <div class="field"><label>Name *</label><input type="text" data-k="name" value="${esc(l.name || '')}"></div>
        <div class="field"><label>Short name</label><input type="text" data-k="short_name" value="${esc(l.short_name || '')}"></div>
        <div class="field"><label>Badge initials</label><input type="text" data-k="logo_text" maxlength="3" value="${esc(l.logo_text || '')}"></div>
        <div class="field"><label>Type</label><select data-k="type">
          ${Object.entries(LENDER_TYPE_LABEL).map(([k, v]) => `<option value="${k}" ${l.type === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select></div>
        <div class="field"><label>Brand colour</label><input type="text" data-k="color" value="${esc(l.color || '#1d4ed8')}"></div>
        <div class="field"><label>Sort order</label><input type="number" data-k="sort_order" value="${esc(l.sort_order || 0)}"></div>
      </div>

      <h4>Pricing</h4>
      <div class="grid-3">
        <div class="field"><label>Rate type</label><select data-k="rate_type">
          <option value="reducing" ${l.rate_type === 'reducing' ? 'selected' : ''}>Reducing balance</option>
          <option value="flat" ${l.rate_type === 'flat' ? 'selected' : ''}>Flat rate</option>
        </select></div>
        ${nf('annual_rate', 'Annual rate', '%')}
        ${nf('early_settlement_fee_pct', 'Early settlement fee', '% of balance')}
        ${nf('processing_fee_pct', 'Processing fee', '% of loan')}
        ${nf('processing_fee_min', 'Processing fee floor', 'KES')}
        ${nf('processing_fee_max', 'Processing fee cap', 'KES, 0 = none')}
        ${nf('valuation_fee', 'Valuation fee', 'KES')}
        ${nf('tracking_fee', 'Tracking device', 'KES')}
        ${nf('legal_fee', 'Legal / chattels', 'KES')}
        ${nf('insurance_rate_pct', 'Comprehensive insurance', '% of value, year 1')}
      </div>
      <label class="check"><input type="checkbox" data-k="capitalize_fees" ${l.capitalize_fees ? 'checked' : ''}><span>Roll fees into the loan (customer brings only the deposit)</span></label>
      <label class="check"><input type="checkbox" data-k="insurance_financed" ${l.insurance_financed ? 'checked' : ''}><span>Finance the first year's insurance premium (IPF)</span></label>

      <h4 class="mt">Who qualifies</h4>
      <div class="grid-3">
        ${nf('min_deposit_pct', 'Minimum deposit', '% of price')}
        ${nf('min_tenor_months', 'Minimum term', 'months')}
        ${nf('max_tenor_months', 'Maximum term', 'months')}
        ${nf('min_loan', 'Minimum facility', 'KES')}
        ${nf('max_loan', 'Maximum facility', 'KES')}
        ${nf('min_monthly_income', 'Minimum net income', 'KES/month')}
        ${nf('max_dti_pct', 'Debt-to-income ceiling', '%')}
        ${nf('max_vehicle_age_years', 'Maximum vehicle age', 'years')}
        ${nf('min_age', 'Minimum applicant age', 'years')}
        ${nf('max_age_at_maturity', 'Maximum age at maturity', 'years')}
        ${nf('bank_statement_months', 'Bank statements needed', 'months')}
        ${nf('approval_days', 'Typical approval', 'working days')}
      </div>

      <div class="grid-2">
        <div class="field"><label>Accepted employment types</label>
          <div class="pills" id="emp">${Object.entries(EMPLOYMENT_LABEL)
            .map(([k, v]) => `<button type="button" class="pill ${(l.allowed_employment || []).includes(k) ? 'on' : ''}" data-emp="${k}">${v}</button>`)
            .join('')}</div>
        </div>
        <div class="field"><label>Vehicle conditions financed</label>
          <div class="pills" id="cond">${Object.entries(CONDITION_LABEL)
            .map(([k, v]) => `<button type="button" class="pill ${(l.allowed_conditions || []).includes(k) ? 'on' : ''}" data-cond="${k}">${v}</button>`)
            .join('')}</div>
        </div>
      </div>
      <label class="check"><input type="checkbox" data-k="requires_clean_crb" ${l.requires_clean_crb ? 'checked' : ''}><span>Requires a clean CRB record</span></label>
      <label class="check"><input type="checkbox" data-k="active" ${l.active ? 'checked' : ''}><span>Active — quoted to customers</span></label>

      <div class="grid-2 mt">
        <div class="field"><label>Documents required (one per line)</label><textarea data-k="requirements" style="min-height:130px">${esc((l.requirements || []).join('\n'))}</textarea></div>
        <div class="field"><label>Note shown to the customer</label><textarea data-k="notes" style="min-height:130px">${esc(l.notes || '')}</textarea></div>
      </div>

      <div class="row mt" style="justify-content:space-between">
        ${!isNew && can('superadmin') ? `<button class="btn danger" id="del">Delete lender</button>` : '<span></span>'}
        <div class="row"><button class="btn" data-close>Cancel</button><button class="btn primary" id="save">${isNew ? 'Create lender' : 'Save rules'}</button></div>
      </div>`, { wide: true });

    on(m.body, 'click', '[data-emp]', (e, el) => el.classList.toggle('on'));
    on(m.body, 'click', '[data-cond]', (e, el) => el.classList.toggle('on'));

    $('#save', m.body).onclick = async () => {
      const payload = {};
      $$('[data-k]', m.body).forEach((el) => {
        const k = el.dataset.k;
        if (el.type === 'checkbox') payload[k] = el.checked;
        else if (k === 'requirements') payload[k] = el.value.split('\n').map((s) => s.trim()).filter(Boolean);
        else payload[k] = el.value;
      });
      payload.allowed_employment = $$('#emp .pill.on', m.body).map((b) => b.dataset.emp);
      payload.allowed_conditions = $$('#cond .pill.on', m.body).map((b) => b.dataset.cond);
      try {
        if (isNew) await POST('/api/admin/lenders', payload);
        else await PATCH(`/api/admin/lenders/${l.id}`, payload);
        toast('Rules saved — customer quotes updated', 'ok');
        m.close();
        render();
      } catch (e) {
        toast(e.message, 'err');
      }
    };
    const del = $('#del', m.body);
    if (del)
      del.onclick = () =>
        confirmBox(`Delete ${l.name}? Applications already submitted keep their saved quote.`, async () => {
          await DEL(`/api/admin/lenders/${l.id}`);
          toast('Deleted', 'ok');
          m.close();
          render();
        });
  }

  /* ---------------- pre-qualifications ---------------- */

  async function pagePrequal() {
    view.innerHTML = '<div class="spinner"></div>';
    const rows = await GET('/api/admin/prequalifications' + scopeQ());
    view.innerHTML = `
      <div class="row between wrap-r mb">
        <div>
          <h1>Pre-qualifications <span class="muted" style="font-size:1rem">${rows.length}</span></h1>
          <p class="muted" style="margin:0">People who ran the "apply once, hear back from every lender" check. Warm leads with the numbers already done.</p>
        </div>
        <a class="btn sm" href="/api/admin/export/prequalifications${scopeQ()}">Export CSV</a>
      </div>
      <div class="card scroll-x"><table class="tbl">
        <thead><tr><th>Ref</th><th>Person</th><th>Income</th><th class="num">Target</th><th class="num">Deposit</th><th class="num">Term</th><th>Qualified</th><th class="num">Best monthly</th><th>Status</th><th>When</th><th></th></tr></thead>
        <tbody>${rows
          .map(
            (r) => `<tr>
          <td class="mono">${esc(r.ref)}</td>
          <td><b>${esc(r.name)}</b><div class="dim" style="font-size:.76rem">${esc(r.phone)}${r.email ? ' · ' + esc(r.email) : ''}</div></td>
          <td>${KES(r.applicant.netIncome)}<div class="dim" style="font-size:.76rem">${esc(titleCase(r.applicant.employment || ''))}${r.applicant.crbClean === false ? ' · CRB listed' : ''}</div></td>
          <td class="num">${KESK(r.target_price)}</td>
          <td class="num">${KESK(r.deposit)}</td>
          <td class="num">${r.tenor_months} mo</td>
          <td><span class="tag ${r.approved_count ? 'ok' : 'err'}">${r.approved_count} lender${r.approved_count === 1 ? '' : 's'}</span></td>
          <td class="num">${r.best_monthly ? KES(r.best_monthly) : '—'}</td>
          <td><select data-pq="${r.id}" style="width:auto">
            ${['new', 'contacted', 'converted', 'closed'].map((s) => `<option value="${s}" ${r.status === s ? 'selected' : ''}>${titleCase(s)}</option>`).join('')}
          </select></td>
          <td class="dim">${ago(r.created_at)}</td>
          <td><button class="btn sm" data-pqopen="${r.id}">View</button></td>
        </tr>`
          )
          .join('') || '<tr><td colspan="11" class="empty">No pre-qualifications yet.</td></tr>'}</tbody>
      </table></div>`;

    on(view, 'change', '[data-pq]', async (e, el) => {
      await PATCH(`/api/admin/prequalifications/${el.dataset.pq}`, { status: el.value });
      toast('Updated', 'ok');
    });
    on(view, 'click', '[data-pqopen]', (e, el) => {
      const r = rows.find((x) => x.id === Number(el.dataset.pqopen));
      modal(`Pre-qualification ${r.ref}`, `
        <div class="row between wrap-r mb">
          <div><h2 style="margin:0">${esc(r.name)}</h2><div class="muted">${esc(r.phone)}${r.email ? ' · ' + esc(r.email) : ''}${r.id_number ? ' · ID ' + esc(r.id_number) : ''}</div></div>
          <span class="tag ${r.approved_count ? 'ok' : 'err'}" style="font-size:.9rem">${r.approved_count} of ${r.results.length} lenders</span>
        </div>
        <div class="grid-3">
          <div class="panel"><div class="lbl" style="margin:0">Net income</div><b>${KES(r.applicant.netIncome)}</b></div>
          <div class="panel"><div class="lbl" style="margin:0">Commitments</div><b>${KES(r.applicant.obligations || 0)}</b></div>
          <div class="panel"><div class="lbl" style="margin:0">Employment</div><b>${esc(titleCase(r.applicant.employment || '—'))}</b></div>
          <div class="panel"><div class="lbl" style="margin:0">Target price</div><b>${KES(r.target_price)}</b></div>
          <div class="panel"><div class="lbl" style="margin:0">Deposit</div><b>${KES(r.deposit)}</b></div>
          <div class="panel"><div class="lbl" style="margin:0">Term</div><b>${r.tenor_months} months</b></div>
        </div>
        <h3 class="mt">What each lender said</h3>
        <table class="tbl">
          <thead><tr><th>Lender</th><th>Type</th><th class="num">Monthly</th><th class="num">APR</th><th>Outcome</th></tr></thead>
          <tbody>${r.results
            .map(
              (o) => `<tr><td>${esc(o.lender)}</td><td class="muted">${esc(titleCase(o.type))}</td>
              <td class="num">${KES(o.monthlyPayment)}</td><td class="num">${o.apr}%</td>
              <td>${o.eligible ? '<span class="tag ok">Would lend</span>' : `<span class="dim" style="font-size:.8rem">${esc(o.blockers[0] || 'Declined')}</span>`}</td></tr>`
            )
            .join('')}</tbody>
        </table>`, { wide: true });
    });
  }

  /* ---------------- bookings ---------------- */

  async function pageOrders() {
    view.innerHTML = `<div class="card">${skelLines(6)}</div>`;
    const rows = await GET('/api/admin/orders' + scopeQ());
    const paid = rows.filter((r) => r.status === 'paid');
    const value = paid.reduce((s, r) => s + r.amount, 0);
    view.innerHTML = `
      <div class="row between wrap-r mb">
        <div>
          <h1>Bookings <span class="muted" style="font-size:1rem">${rows.length}</span></h1>
          <p class="muted" style="margin:0">Deposits taken online. A paid booking holds the car automatically and releases it when the hold lapses.</p>
        </div>
      </div>
      <div class="kpi-grid mb">
        <div class="kpi"><div class="k">Paid bookings</div><div class="v">${paid.length}</div><div class="d">of ${rows.length} started</div></div>
        <div class="kpi"><div class="k">Deposits collected</div><div class="v">${KESK(value)}</div><div class="d">credited against purchase</div></div>
        <div class="kpi"><div class="k">Awaiting payment</div><div class="v">${rows.filter((r) => r.status === 'pending').length}</div><div class="d">not yet settled</div></div>
        <div class="kpi"><div class="k">Cars on hold now</div><div class="v">${paid.filter((r) => r.hold_until && new Date(r.hold_until) > new Date()).length}</div><div class="d">reserved for a buyer</div></div>
      </div>
      <div class="card scroll-x"><table class="tbl">
        <thead><tr><th>Ref</th><th>Customer</th><th>Vehicle</th><th class="num">Deposit</th><th>Method</th><th>Status</th><th>Receipt</th><th>Held until</th><th>When</th><th></th></tr></thead>
        <tbody>${rows
          .map(
            (o) => `<tr>
          <td class="mono">${esc(o.ref)}</td>
          <td><b>${esc(o.customer.name || '—')}</b><div class="dim" style="font-size:.76rem">${esc(o.customer.phone || '')}</div></td>
          <td>${esc(o.vehicle_snapshot.title || (o.make ? `${o.year} ${o.make} ${o.model}` : '—'))}</td>
          <td class="num">${KES(o.amount)}</td>
          <td class="muted">${esc(titleCase(o.method))}</td>
          <td><span class="tag ${o.status === 'paid' ? 'ok' : o.status === 'pending' ? 'warn' : 'err'}">${esc(titleCase(o.status))}</span></td>
          <td class="mono dim">${esc(o.receipt_no || '—')}</td>
          <td class="dim">${o.hold_until ? dateFmt(o.hold_until) : '—'}</td>
          <td class="dim">${ago(o.created_at)}</td>
          <td><select data-order="${o.id}" style="width:auto">
            ${['pending', 'paid', 'cancelled', 'refunded', 'failed'].map((s) => `<option value="${s}" ${o.status === s ? 'selected' : ''}>${titleCase(s)}</option>`).join('')}
          </select></td>
        </tr>`
          )
          .join('') || '<tr><td colspan="10" class="empty">No online bookings yet.</td></tr>'}</tbody>
      </table></div>`;
    on(view, 'change', '[data-order]', async (e, el) => {
      try {
        await PATCH(`/api/admin/orders/${el.dataset.order}`, { status: el.value });
        toast('Booking updated', 'ok');
        render();
      } catch (err) {
        toast(err.message, 'err');
      }
    });
  }

  /* ---------------- running cost settings ---------------- */

  async function pageCosts() {
    view.innerHTML = `<div class="card">${skelLines(6)}</div>`;
    const [s, fuel] = await Promise.all([GET('/api/admin/settings'), GET('/api/admin/fuel')]);
    const FIELDS = [
      ['cost_petrol_price', 'Petrol price', 'KES per litre', 195],
      ['cost_diesel_price', 'Diesel price', 'KES per litre', 180],
      ['cost_electricity_price', 'Electricity', 'KES per kWh', 28],
      ['cost_third_party_premium', 'Third party premium', 'KES per year', 7500],
      ['cost_insurance_min_premium', 'Minimum comprehensive premium', 'KES per year', 25000],
      ['cost_licensing_fee', 'Licensing & inspection', 'KES per year', 3000],
      ['cost_tyre_set_cost_pct', 'Cost of a set of tyres', '% of vehicle value', 1.1],
      ['cost_tyre_life_km', 'Tyre life', 'kilometres', 45000],
    ];
    view.innerHTML = `
      <h1>Running cost assumptions</h1>
      <p class="muted">These drive the customer-facing <b>Running cost</b> and <b>Insurance</b> tabs.</p>

      <div class="card mb" style="max-width:760px;border-color:${fuel.age.stale ? 'var(--warn)' : 'var(--ok)'}">
        <div class="row between wrap-r">
          <div>
            <div class="lbl" style="margin:0">Pump prices — these look after themselves</div>
            <div class="row" style="gap:22px;margin-top:6px">
              <div><div class="dim" style="font-size:.74rem">PETROL</div><b style="font-size:1.3rem">${KES(fuel.petrol)}</b><span class="dim">/L</span></div>
              <div><div class="dim" style="font-size:.74rem">DIESEL</div><b style="font-size:1.3rem">${KES(fuel.diesel)}</b><span class="dim">/L</span></div>
              ${fuel.kerosene ? `<div><div class="dim" style="font-size:.74rem">KEROSENE</div><b style="font-size:1.3rem">${KES(fuel.kerosene)}</b><span class="dim">/L</span></div>` : ''}
            </div>
            <div class="mt">
              <span class="tag ${fuel.age.stale ? 'warn' : 'ok'}">${esc(fuel.age.label)}</span>
              <span class="tag">${fuel.autoUpdate ? 'auto-update on' : 'auto-update off'}</span>
              <span class="tag">next EPRA cycle ${esc(fuel.nextEpraCycle)}</span>
            </div>
          </div>
          <div class="row"><button class="btn sm" id="fuelRefresh">Refresh now</button></div>
        </div>
        <div class="muted mt" style="font-size:.86rem">
          EPRA publishes maximum pump prices on the 14th of each month, effective the 15th. The site checks daily and
          updates itself — nobody here has to remember. ${
            fuel.lastError
              ? `<span class="err-text">Last attempt failed: ${esc(fuel.lastError)}. Prices above are still the last good figures.</span>`
              : ''
          }
        </div>
        ${
          can('superadmin')
            ? `<div class="grid-2 mt">
                 <div class="field"><label>Price source URL</label><input type="text" id="fuelSrc" value="${esc(fuel.source || '')}" placeholder="https://…  (JSON or an EPRA page)"></div>
                 <div class="field"><label>Automatic updates</label><select id="fuelAuto">
                   <option value="on" ${fuel.autoUpdate ? 'selected' : ''}>On — check daily</option>
                   <option value="off" ${fuel.autoUpdate ? '' : 'selected'}>Off — I will set prices by hand</option>
                 </select></div>
               </div>
               <button class="btn sm" id="fuelSave">Save source</button>`
            : ''
        }
      </div>

      <p class="muted">Everything below is set by hand and rarely changes.</p>
      <div class="card" style="max-width:620px">
        ${FIELDS.map(
          (f) => `<div class="field"><label>${f[1]} <span class="dim">(${f[2]})</span></label>
            <input type="number" step="any" data-k="${f[0]}" value="${esc(s[f[0]] !== undefined ? s[f[0]] : f[3])}"></div>`
        ).join('')}
        ${can('superadmin') ? '<button class="btn primary" id="saveCosts">Save</button>' : '<div class="tag warn">Only a platform admin can change these.</div>'}
      </div>
      <div class="card mt" style="max-width:620px">
        <h3>How the model works</h3>
        <ul class="muted" style="font-size:.88rem;padding-left:18px">
          <li><b>Fuel</b> — litres per 100 km derived from engine size, then adjusted for diesel (×0.82), hybrid (×0.60) or electric (kWh).</li>
          <li><b>Insurance</b> — comprehensive at 4.0–5.5% of value depending on the car's age, with a floor; third party is a flat annual figure.</li>
          <li><b>Servicing</b> — scales with vehicle value, engine size, age and annual mileage.</li>
          <li><b>Tyres</b> — a set costs a percentage of value and lasts a set number of kilometres.</li>
        </ul>
      </div>`;
    const b = $('#saveCosts');
    if (b)
      b.onclick = async () => {
        const payload = { cost_prices_as_at: new Date().toISOString() };
        $$('[data-k]', view).forEach((el) => (payload[el.dataset.k] = el.value));
        await POST('/api/admin/settings', payload);
        toast('Saved — customer quotes updated', 'ok');
        render();
      };

    $('#fuelRefresh').onclick = async () => {
      const btn = $('#fuelRefresh');
      btn.disabled = true;
      btn.textContent = 'Checking…';
      const r = await POST('/api/admin/fuel/refresh', {});
      if (r.ok) toast(`Updated: petrol ${KES(r.prices.petrol_price)}, diesel ${KES(r.prices.diesel_price)}`, 'ok');
      else toast(`No update: ${r.reason || r.skipped}. Existing prices kept.`, 'err');
      render();
    };
    const fs = $('#fuelSave');
    if (fs)
      fs.onclick = async () => {
        await POST('/api/admin/settings', { fuel_source_url: $('#fuelSrc').value.trim(), fuel_auto_update: $('#fuelAuto').value });
        toast('Saved', 'ok');
        render();
      };
  }

  /* ---------------- leads ---------------- */

  async function pageLeads() {
    view.innerHTML = '<div class="spinner"></div>';
    const rows = await GET('/api/admin/leads' + scopeQ());
    const types = { test_drive: 'Test drive', trade_in: 'Trade-in', callback: 'Call back', enquiry: 'Enquiry', sell_car: 'Wants to sell' };
    view.innerHTML = `
      <div class="row between wrap-r mb"><h1>Leads <span class="muted" style="font-size:1rem">${rows.length}</span></h1>
        <a class="btn sm" href="/api/admin/export/leads${scopeQ()}">Export CSV</a></div>
      <div class="card scroll-x"><table class="tbl">
        <thead><tr><th>Type</th><th>Name</th><th>Phone</th><th>Vehicle</th><th>Message</th><th>Status</th><th>When</th></tr></thead>
        <tbody>${rows
          .map(
            (l) => `<tr>
          <td><span class="tag">${esc(types[l.type] || l.type)}</span></td>
          <td><b>${esc(l.name)}</b><div class="dim" style="font-size:.76rem">${esc(l.email || '')}</div></td>
          <td class="mono">${esc(l.phone)}</td>
          <td class="muted">${l.make ? esc(`${l.year} ${l.make} ${l.model}`) : '—'}</td>
          <td class="muted" style="max-width:280px">${esc(l.message || '')}</td>
          <td><select data-lead="${l.id}" style="width:auto">
            ${['new', 'contacted', 'booked', 'closed'].map((s) => `<option value="${s}" ${l.status === s ? 'selected' : ''}>${titleCase(s)}</option>`).join('')}
          </select></td>
          <td class="dim">${ago(l.created_at)}</td>
        </tr>`
          )
          .join('') || '<tr><td colspan="7" class="empty">No leads yet.</td></tr>'}</tbody>
      </table></div>`;
    on(view, 'change', '[data-lead]', async (e, el) => {
      await PATCH(`/api/admin/leads/${el.dataset.lead}`, { status: el.value });
      toast('Updated', 'ok');
    });
  }

  /* ---------------- dealership ---------------- */

  async function pageDealership() {
    const id = A.user.role === 'superadmin' ? (A.dealers.find((d) => d.slug === A.scope) || {}).id : A.user.dealer_id;
    if (!id) {
      view.innerHTML = `<h1>Dealerships</h1>
        <p class="muted">Pick a dealership in the top bar to edit its branding, or add a new one.</p>
        <div class="dealer-pick mt">${A.dealers
          .map(
            (d) => `<div class="d"><div class="row" style="gap:10px"><span class="swatch" style="background:${esc(d.primary_color)}">${esc(d.logo_text)}</span>
            <div><b>${esc(d.name)}</b><div class="dim" style="font-size:.8rem">${esc(d.city || '')} · /${esc(d.slug)}</div></div></div>
            <div class="row mt" style="gap:6px"><a class="btn sm" href="/?d=${esc(d.slug)}" target="_blank">Open storefront ↗</a></div></div>`
          )
          .join('')}</div>
        ${can('superadmin') ? '<button class="btn primary mt-lg" id="addD">+ Add dealership</button>' : ''}`;
      const b = $('#addD');
      if (b) b.onclick = dealerForm;
      return;
    }
    view.innerHTML = '<div class="spinner"></div>';
    const d = A.dealers.find((x) => x.id === id);
    const branches = await GET('/api/admin/branches' + scopeQ());
    view.innerHTML = `
      <h1>${esc(d.name)}</h1>
      ${
        can('superadmin')
          ? `<div class="card mb" style="max-width:620px">
              <div class="lbl" style="margin:0">This install serves</div>
              <p class="muted" style="font-size:.87rem;margin:6px 0 10px">
                Each dealership gets its own deployment, so the storefront shows one brand and one yard.
                Switch it here to hand the same build to a different dealership.</p>
              <div class="row">
                <select id="siteDealer" style="width:auto">
                  ${A.dealers.map((x) => `<option value="${x.slug}" ${A.site === x.slug ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
                </select>
                <button class="btn sm" id="siteSave">Switch this install</button>
              </div>
            </div>`
          : ''
      }
      <div class="split-r">
        <div class="card">
          <h3>Branding &amp; contact</h3>
          <div class="grid-2">
            <div class="field"><label>Trading name</label><input type="text" data-k="name" value="${esc(d.name)}"></div>
            <div class="field"><label>Tagline</label><input type="text" data-k="tagline" value="${esc(d.tagline || '')}"></div>
            <div class="field"><label>Badge initials</label><input type="text" data-k="logo_text" maxlength="3" value="${esc(d.logo_text || '')}"></div>
            <div class="field"><label>Primary colour</label><input type="text" data-k="primary_color" value="${esc(d.primary_color)}"></div>
            <div class="field"><label>Accent colour</label><input type="text" data-k="accent_color" value="${esc(d.accent_color)}"></div>
            <div class="field"><label>City</label><input type="text" data-k="city" value="${esc(d.city || '')}"></div>
            <div class="field"><label>Phone</label><input type="text" data-k="phone" value="${esc(d.phone || '')}"></div>
            <div class="field"><label>WhatsApp</label><input type="text" data-k="whatsapp" value="${esc(d.whatsapp || '')}"></div>
            <div class="field"><label>Email</label><input type="email" data-k="email" value="${esc(d.email || '')}"></div>
            <div class="field"><label>Address</label><input type="text" data-k="address" value="${esc(d.address || '')}"></div>
          </div>
          <div class="field"><label>About</label><textarea data-k="about">${esc(d.about || '')}</textarea></div>
          <button class="btn primary" id="saveD">Save</button>
          <a class="btn ghost" href="/?d=${esc(d.slug)}" target="_blank">Preview storefront ↗</a>
        </div>
        <div class="card">
          <h3>Branches</h3>
          <div id="brs">${branches
            .map(
              (b) => `<div class="doc-row"><div class="grow"><b>${esc(b.name)}</b><div class="dim" style="font-size:.78rem">${esc(b.city || '')} · ${esc(b.phone || '')}</div></div>
              <button class="btn sm danger" data-delb="${b.id}">×</button></div>`
            )
            .join('') || '<div class="dim">No branches.</div>'}</div>
          <hr>
          <div class="field"><label>New branch name</label><input type="text" id="bn"></div>
          <div class="grid-2">
            <div class="field"><label>City</label><input type="text" id="bc"></div>
            <div class="field"><label>Phone</label><input type="text" id="bp"></div>
          </div>
          <button class="btn block" id="addB">Add branch</button>
        </div>
      </div>`;

    const ss = $('#siteSave');
    if (ss)
      ss.onclick = () =>
        confirmBox(
          `Point this install at ${$('#siteDealer').selectedOptions[0].text}? The storefront will show that dealership's branding and stock.`,
          async () => {
            await POST('/api/admin/settings', { site_dealer: $('#siteDealer').value });
            toast('Install switched', 'ok');
            boot();
          }
        );

    $('#saveD').onclick = async () => {
      const payload = {};
      $$('[data-k]', view).forEach((el) => (payload[el.dataset.k] = el.value));
      await PATCH(`/api/admin/dealers/${id}`, payload);
      A.dealers = await GET('/api/dealers');
      toast('Saved', 'ok');
      paintShell();
      render();
    };
    $('#addB').onclick = async () => {
      if (!$('#bn').value) return toast('Branch name required', 'err');
      await POST('/api/admin/branches', { dealer_id: id, name: $('#bn').value, city: $('#bc').value, phone: $('#bp').value });
      toast('Branch added', 'ok');
      render();
    };
    on(view, 'click', '[data-delb]', (e, el) =>
      confirmBox('Remove this branch?', async () => {
        await DEL(`/api/admin/branches/${el.dataset.delb}`);
        render();
      })
    );
  }

  function dealerForm() {
    const m = modal('Add dealership', `
      <div class="grid-2">
        <div class="field"><label>Trading name *</label><input type="text" data-k="name"></div>
        <div class="field"><label>URL slug</label><input type="text" data-k="slug" placeholder="auto from the name"></div>
        <div class="field"><label>Tagline</label><input type="text" data-k="tagline"></div>
        <div class="field"><label>Badge initials</label><input type="text" data-k="logo_text" maxlength="3"></div>
        <div class="field"><label>Primary colour</label><input type="text" data-k="primary_color" value="#c8102e"></div>
        <div class="field"><label>Accent colour</label><input type="text" data-k="accent_color" value="#0b1f3a"></div>
        <div class="field"><label>City</label><input type="text" data-k="city"></div>
        <div class="field"><label>Phone</label><input type="text" data-k="phone"></div>
      </div>
      <button class="btn primary" id="go">Create</button>`);
    $('#go', m.body).onclick = async () => {
      const payload = {};
      $$('[data-k]', m.body).forEach((el) => (payload[el.dataset.k] = el.value));
      try {
        await POST('/api/admin/dealers', payload);
        A.dealers = await GET('/api/dealers');
        toast('Dealership created', 'ok');
        m.close();
        paintShell();
        render();
      } catch (e) {
        toast(e.message, 'err');
      }
    };
  }

  /* ---------------- users ---------------- */

  async function pageUsers() {
    view.innerHTML = '<div class="spinner"></div>';
    const rows = await GET('/api/admin/users' + scopeQ());
    A.staff = rows;
    view.innerHTML = `
      <div class="row between wrap-r mb"><h1>Staff &amp; customers</h1>
        ${can('superadmin', 'dealer_admin') ? '<button class="btn primary sm" id="add">+ Add staff</button>' : ''}</div>
      <div class="card scroll-x"><table class="tbl">
        <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Dealership</th><th>Last login</th><th>Active</th><th></th></tr></thead>
        <tbody>${rows
          .map(
            (u) => `<tr>
          <td><b>${esc(u.name)}</b></td><td class="muted">${esc(u.email)}</td><td class="muted">${esc(u.phone || '—')}</td>
          <td><span class="tag ${u.role === 'superadmin' ? 'brand' : ''}">${esc(titleCase(u.role))}</span></td>
          <td class="muted">${esc(u.dealer_name || '—')}</td>
          <td class="dim">${u.last_login ? dateTimeFmt(u.last_login) : 'never'}</td>
          <td>${u.active ? '<span class="tag ok">Yes</span>' : '<span class="tag err">No</span>'}</td>
          <td>${can('superadmin', 'dealer_admin') ? `<button class="btn sm" data-edit="${u.id}">Edit</button>` : ''}</td>
        </tr>`
          )
          .join('')}</tbody>
      </table></div>`;
    const add = $('#add');
    if (add) add.onclick = () => userForm(null);
    on(view, 'click', '[data-edit]', (e, el) => userForm(rows.find((u) => u.id === Number(el.dataset.edit))));
  }

  function userForm(u) {
    const isNew = !u;
    u = u || { role: 'sales_agent', active: 1 };
    const roles = ['receptionist', 'sales_agent', 'finance_officer', 'dealer_admin'].concat(can('superadmin') ? ['superadmin'] : []);
    const m = modal(isNew ? 'Add staff member' : 'Edit ' + u.name, `
      <div class="grid-2">
        <div class="field"><label>Full name *</label><input type="text" data-k="name" value="${esc(u.name || '')}"></div>
        <div class="field"><label>Email *</label><input type="email" data-k="email" value="${esc(u.email || '')}" ${isNew ? '' : 'disabled'}></div>
        <div class="field"><label>Phone</label><input type="text" data-k="phone" value="${esc(u.phone || '')}"></div>
        <div class="field"><label>Role</label><select data-k="role">
          ${roles.map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${titleCase(r)}</option>`).join('')}
        </select></div>
        ${can('superadmin') ? `<div class="field"><label>Dealership</label><select data-k="dealer_id">
          <option value="">Platform-wide</option>
          ${A.dealers.map((d) => `<option value="${d.id}" ${u.dealer_id === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
        </select></div>` : ''}
        <div class="field"><label>${isNew ? 'Password *' : 'New password (leave blank to keep)'}</label><input type="password" data-k="password"></div>
      </div>
      ${isNew ? '' : `<label class="check"><input type="checkbox" data-k="active" ${u.active ? 'checked' : ''}><span>Account active</span></label>`}
      <div class="row mt" style="justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn primary" id="save">${isNew ? 'Create' : 'Save'}</button></div>`);
    $('#save', m.body).onclick = async () => {
      const payload = {};
      $$('[data-k]', m.body).forEach((el) => {
        if (el.type === 'checkbox') payload[el.dataset.k] = el.checked;
        else if (el.value !== '') payload[el.dataset.k] = el.value;
      });
      try {
        if (isNew) await POST('/api/admin/users', payload);
        else await PATCH(`/api/admin/users/${u.id}`, payload);
        toast('Saved', 'ok');
        m.close();
        render();
      } catch (e) {
        toast(e.message, 'err');
      }
    };
  }

  /* ---------------- audit ---------------- */

  async function pageAudit() {
    view.innerHTML = '<div class="spinner"></div>';
    const rows = await GET('/api/admin/audit?limit=200');
    view.innerHTML = `
      <div class="row between wrap-r mb"><h1>Activity log</h1>
        ${can('superadmin') ? '<button class="btn danger sm" id="reset">Reset demo pipeline</button>' : ''}</div>
      <div class="card scroll-x"><table class="tbl">
        <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Entity</th><th>Detail</th></tr></thead>
        <tbody>${rows
          .map(
            (r) => `<tr><td class="dim nowrap">${dateTimeFmt(r.created_at)}</td><td>${esc(r.actor || '—')}</td>
            <td><span class="tag">${esc(r.action)}</span></td><td class="muted">${esc(r.entity || '')} ${esc(r.entity_id || '')}</td>
            <td class="muted mono" style="font-size:.76rem;max-width:420px;overflow:hidden;text-overflow:ellipsis">${esc(r.detail || '')}</td></tr>`
          )
          .join('') || '<tr><td colspan="5" class="empty">Nothing logged yet.</td></tr>'}</tbody>
      </table></div>`;
    const rst = $('#reset');
    if (rst)
      rst.onclick = () =>
        confirmBox('Clear every application and lead, and return all stock to available? Inventory, lenders and staff are untouched.', async () => {
          await POST('/api/admin/demo/reset-applications', {});
          toast('Demo pipeline cleared', 'ok');
          render();
        });
  }

  /* ---------------- router ---------------- */

  async function render() {
    if (!A.user) return;
    $$('.modal-bg').forEach((m) => m.remove()); // a route change closes any open drawer
    paintShell();
    const { path, query } = parseHash();
    try {
      switch (path[0]) {
        case undefined:
        case '':
          return await pageOverview();
        case 'applications':
          return await pageApplications(query);
        case 'prequal':
          return await pagePrequal();
        case 'orders':
          return await pageOrders();
        case 'costs':
          return await pageCosts();
        case 'inventory':
          return await pageInventory();
        case 'ageing':
          return await pageAgeing();
        case 'brokers':
          return await pageIntroducers();
        case 'check':
          return await pageBrokerCheck();
        case 'clients':
          return await pageBrokerClients();
        case 'verify':
          return await pageBrokerVerify();
        case 'lenders':
          return await pageLenders();
        case 'leads':
          return await pageLeads();
        case 'dealership':
          return await pageDealership();
        case 'users':
          return await pageUsers();
        case 'audit':
          return await pageAudit();
        default:
          view.innerHTML = '<div class="empty">Page not found.</div>';
      }
    } catch (e) {
      view.innerHTML = `<div class="card err-text">${esc(e.message)}</div>`;
      console.error(e);
    }
  }

  window.addEventListener('hashchange', render);
  boot();
})();
