/* MotoKE storefront. */
(() => {
  const view = $('#view');
  const S = {
    boot: null,
    dealer: null,
    user: null,
    saved: store.get('saved', []),
    compare: store.get('compare', []),
    profile: store.get('profile', { netIncome: '', obligations: '', employment: 'employed', crbClean: true, age: '' }),
    filters: {},
  };

  // This deployment serves exactly one dealership; the server decides which.
  const dq = () => '';

  /* ---------------- boot ---------------- */
  async function boot() {
    S.boot = await GET('/api/bootstrap');
    S.dealer = S.boot.dealer;
    S.user = S.boot.user;
    /* Off unless the server hands over a config, in which case the buttons render as
       nothing rather than as dead controls. Published both ways because the SDK is
       deferred and may load either side of this. */
    if (S.boot.firebase) {
      window.__motokeFirebase = S.boot.firebase;
      if (window.MotoKEAuth) MotoKEAuth.init(S.boot.firebase);
      window.dispatchEvent(new CustomEvent('motoke:firebase-config', { detail: S.boot.firebase }));
    }
    applyBrand(S.dealer);
    captureUtm();
    paintChrome();
    installChrome();
  }

  function paintChrome() {
    const d = S.dealer;
    if (d) {
      document.title = `${d.name} — cars and vehicle financing`;
      $('#brandMark').textContent = d.logo_text || 'MK';
      $('#brandName').textContent = d.name;
      $('#brandTag').textContent = d.tagline || 'vehicle sales & asset finance';
      $('#footName').textContent = d.name;
      $('#footTag').textContent = d.tagline || '';
      $('#footContact').innerHTML = `<span class="dim">${esc(d.address || '')} · ${esc(d.phone || '')} · ${esc(d.email || '')}</span>`;
    }
    const updated = S.boot.platform && S.boot.platform.lastUpdated;
    if (updated) $('#footUpdated').innerHTML = `<span class="dim">Stock and pricing last updated ${esc(relativeDate(updated))}.</span>`;
    $('#navAccount').textContent = S.user ? S.user.name.split(' ')[0] : 'Sign in';
  }

  let chromeInstalled = false;
  function installChrome() {
    if (chromeInstalled) return;
    chromeInstalled = true;
    initChrome();
    initBurger('#nav');
    const slot = $('#chromeSlot');
    slot.appendChild(h('<button class="searchbtn" id="searchBtn" aria-label="Search inventory">🔍 <span>Search</span> <kbd>/</kbd></button>'));
    slot.appendChild(initTheme());
    $('#searchBtn').onclick = openSearch;
    document.addEventListener('keydown', (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (!typing && (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'))) {
        e.preventDefault();
        openSearch();
      }
    });
    initCookieBar();
    const d = S.dealer || {};
    initFab([
      { label: '💬 WhatsApp us', href: waLink(`Hi ${d.name}, `), external: true },
      { label: `📞 ${d.phone || 'Call us'}`, href: `tel:${(d.phone || '').replace(/\s/g, '')}` },
      { label: '✉ Send a message', href: '#/contact' },
      { label: '🚗 Book a test drive', href: '#/browse' },
    ]);
  }

  /* ---------------- site search ---------------- */
  function openSearch() {
    const m = modal('Search the yard', `
      <input type="text" id="searchInput" placeholder="Try “Prado”, “hybrid under 2M”, “financing”…" autocomplete="off">
      <div class="search-results" id="searchResults"></div>
      <div class="dim mt" style="font-size:.78rem">↑ ↓ to move · Enter to open · Esc to close</div>`);
    m.el.querySelector('.modal').classList.add('search-modal');
    const input = $('#searchInput', m.body);
    const out = $('#searchResults', m.body);
    let hits = [];
    let sel = 0;

    const PAGES = [
      { t: 'Browse the inventory', s: 'Every car in stock', href: '#/browse' },
      { t: 'Financing calculator', s: 'Work out a monthly payment', href: '#/financing/calculator' },
      { t: 'What can I afford?', s: 'Price range from your income', href: '#/financing/afford' },
      { t: 'Compare lenders', s: 'Every bank, sacco and microfinance side by side', href: '#/financing/compare' },
      { t: 'Running cost', s: 'Fuel, insurance, servicing and tyres', href: '#/financing/running' },
      { t: 'Insurance', s: 'Comprehensive against third party', href: '#/financing/insurance' },
      { t: 'Get pre-qualified', s: 'One form, every lender answers', href: '#/financing/prequalify' },
      { t: 'Sell your car', s: 'Valuation and trade-in', href: '#/sell' },
      { t: 'Track an application', s: 'Progress by reference number', href: '#/track' },
      { t: 'FAQs', s: 'Financing questions answered', href: '#/financing/faq' },
      { t: 'Contact us', s: 'Phone, WhatsApp and branches', href: '#/contact' },
    ];

    const paint = () => {
      out.innerHTML = hits.length
        ? hits
            .map(
              (r, i) => `<div class="search-hit ${i === sel ? 'sel' : ''}" data-go="${esc(r.href)}">
          ${r.img ? `<img src="${esc(r.img)}" alt="">` : '<div style="width:64px;text-align:center;font-size:1.3rem">›</div>'}
          <div class="grow"><div class="t">${esc(r.t)}</div><div class="s">${esc(r.s)}</div></div>
        </div>`
            )
            .join('')
        : '<div class="empty" style="padding:24px">Nothing found. Try a make, a model or a budget.</div>';
    };

    const run = debounce(async () => {
      const q = input.value.trim();
      if (!q) {
        hits = PAGES.slice(0, 6).map((p) => ({ ...p }));
        sel = 0;
        return paint();
      }
      const pageHits = PAGES.filter((p) => (p.t + ' ' + p.s).toLowerCase().includes(q.toLowerCase()));
      let cars = [];
      try {
        const res = await GET(`/api/vehicles?q=${encodeURIComponent(q)}&pageSize=6`);
        cars = res.items.map((v) => ({
          t: v.title,
          s: `${KES(v.price)} · ${num(v.mileage_km)} km · ${v.fuel}`,
          href: `#/vehicle/${v.id}`,
          img: vehImg(v),
        }));
      } catch {}
      hits = [...cars, ...pageHits];
      sel = 0;
      paint();
    }, 200);

    input.addEventListener('input', run);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        sel = Math.min(hits.length - 1, sel + 1);
        paint();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        sel = Math.max(0, sel - 1);
        paint();
      } else if (e.key === 'Enter' && hits[sel]) {
        m.close();
        go(hits[sel].href);
      }
    });
    on(out, 'click', '[data-go]', (e, el) => {
      m.close();
      go(el.dataset.go);
    });
    run();
    setTimeout(() => input.focus(), 40);
  }

  /* ---------------- shared bits ---------------- */

  const vehImg = (v) => (v.images && v.images[0]) || `/img/vehicle.svg?make=${encodeURIComponent(v.make)}&model=${encodeURIComponent(v.model)}`;

  /** Deep link into WhatsApp with the enquiry already typed. */
  function waLink(message) {
    const d = S.dealer || {};
    const number = String(d.whatsapp || d.phone || '').replace(/\D/g, '');
    const text = encodeURIComponent(message || `Hi ${d.name || ''}, I'd like to know more.`);
    return number ? `https://wa.me/${number}?text=${text}` : `https://wa.me/?text=${text}`;
  }
  /**
   * What the lender panel actually allows.
   *
   * The deposit slider used to start at 0% and the term slider ran to 72 months, while no
   * lender on the panel accepts under 10% down or lends beyond 60. Offering a setting that
   * can only ever return "no offers" wastes the customer's time and makes the site look
   * like it does not know its own rules.
   *
   * Derived from the live panel rather than hard-coded, so adding a lender who does 84
   * months moves the slider on its own.
   */
  function panelBounds() {
    const ls = (S.boot && S.boot.lenders) || [];
    const nums = (key, fallback) => {
      const vals = ls.map((l) => Number(l[key])).filter((n) => Number.isFinite(n) && n > 0);
      return vals.length ? vals : [fallback];
    };
    const minDeps = nums('min_deposit_pct', 10);
    const maxTens = nums('max_tenor_months', 60);
    const minTens = nums('min_tenor_months', 12);
    return {
      minDeposit: Math.min(...minDeps),
      easiestDeposit: Math.min(...minDeps),
      hardestDeposit: Math.max(...minDeps),
      minTenor: Math.min(...minTens),
      maxTenor: Math.max(...maxTens),
    };
  }

  /** Only the terms a lender on the panel actually offers. */
  function panelTerms(candidates) {
    const b = panelBounds();
    const inRange = candidates.filter((t) => t >= b.minTenor && t <= b.maxTenor);
    return inRange.length ? inRange : candidates;
  }

  const waVehicle = (v) =>
    waLink(`Hi ${S.dealer.name}, I'm interested in the ${v.title} listed at ${KES(v.price)}. Is it still available?`);
  /** Opens WhatsApp with the reference already typed, so nobody has to read it out. */
  const waDealer = (ref) =>
    waLink(
      ref
        ? `Hi ${(S.dealer && S.dealer.name) || ''}, I'd like an update on my application ${ref}.`
        : `Hi ${(S.dealer && S.dealer.name) || ''}, I'd like an update on my finance application.`
    );

  const REG_LABEL = {
    registered: 'Registered in Kenya',
    awaiting_registration: 'Awaiting KE registration',
    in_transit: 'In transit / on the water',
  };
  const REG_TONE = { registered: 'ok', awaiting_registration: 'warn', in_transit: 'info' };

  function estimateMonthly(price) {
    // headline "from" figure: cheapest active lender at its own minimum deposit, 60 months
    const lenders = (S.boot && S.boot.lenders) || [];
    let best = null;
    for (const l of lenders) {
      const tenor = Math.min(60, l.max_tenor_months);
      const principal = price * (1 - l.min_deposit_pct / 100);
      const r = l.annual_rate / 100 / 12;
      const pay =
        l.rate_type === 'flat'
          ? (principal + principal * (l.annual_rate / 100) * (tenor / 12)) / tenor
          : r
          ? (principal * r) / (1 - Math.pow(1 + r, -tenor))
          : principal / tenor;
      if (best === null || pay < best) best = pay;
    }
    return best;
  }

  /* ---------------- the spec sheet ----------------
     Every figure comes from the server. `specs.measured` names the ones the dealership
     actually recorded; the rest are modelled, and the page says so rather than letting a
     buyer take a projection for a manufacturer claim. */

  const dash = (x) => (x == null || x === '' ? '—' : x);

  /** The four numbers a car person looks for first. */
  function specStrip(s) {
    if (!s || !s.performance) return '';
    const p = s.performance;
    const cells = [
      ['0–100 km/h', p.zeroTo100 == null ? null : p.zeroTo100.toFixed(1), 's'],
      ['Power', p.hp, 'hp'],
      ['Torque', p.torqueNm, 'Nm'],
      ['Top speed', p.topSpeed, 'km/h'],
    ].filter((c) => c[1] != null);
    if (!cells.length) return '';
    return `<div class="specstrip">${cells
      .map(
        (c, i) => `<div class="ss-cell${i === 0 ? ' lead' : ''}">
          <div class="ss-num">${esc(c[1])}<span class="ss-unit">${esc(c[2])}</span></div>
          <div class="ss-lbl">${esc(c[0])}</div>
        </div>`
      )
      .join('')}</div>`;
  }

  /** One titled block of label/value pairs. */
  function specGroup(title, pairs) {
    const rows = pairs.filter((r) => r[1] != null && r[1] !== '' && r[1] !== '—');
    if (!rows.length) return '';
    return `<div class="specgroup">
      <div class="lbl">${esc(title)}</div>
      <dl>${rows.map((r) => `<div><dt>${esc(r[0])}</dt><dd>${esc(r[1])}</dd></div>`).join('')}</dl>
    </div>`;
  }

  /** The five-area workshop scorecard. Unscored areas say so; they never read as a pass. */
  function scorecard(insp) {
    if (!insp) return '';
    if (insp.overall == null) {
      return `<div class="panel mt"><div class="lbl" style="margin:0">Condition</div>
        <div class="muted">Not yet inspected. Ask us for a workshop report before you commit.</div></div>`;
    }
    return `<h3 class="mt-lg">Condition report</h3>
      <div class="scorecard" id="scorecard">
        <div class="sc-head">
          <div class="sc-overall"><span>${insp.overall}</span><small>/100</small></div>
          <div>
            <b>${esc(insp.headline)}</b>
            <div class="muted" style="font-size:.84rem">
              ${insp.pointCount ? `${insp.pointCount}-point check · ` : ''}${insp.scoredCount} of ${insp.total} areas scored${insp.checkedOn ? ' · ' + dateFmt(insp.checkedOn) : ''}
            </div>
          </div>
          <button class="btn sm ghost" data-act="print-report" title="Print or save as PDF">Print report</button>
        </div>
        ${insp.areas
          .map(
            (a) => `<div class="sc-row">
              <div class="sc-name">${esc(a.label)}</div>
              <div class="sc-bar"><i style="width:${a.score == null ? 0 : a.score}%"></i></div>
              <div class="sc-val">${a.score == null ? '<span class="dim">Not checked</span>' : a.score + ' · ' + esc(a.rating)}</div>
            </div>`
          )
          .join('')}

        <details class="sc-points">
          <summary>What the workshop checks — all ${insp.pointCount} points</summary>
          <div class="sc-point-groups">
            ${insp.areas
              .map(
                (a) => `<div>
                  <div class="lbl">${esc(a.label)}${a.score == null ? ' — not scored' : ''}</div>
                  <ul>${(a.points || []).map((pt) => `<li>${esc(pt)}</li>`).join('')}</ul>
                </div>`
              )
              .join('')}
          </div>
        </details>

        ${insp.notes ? `<p class="muted mt" style="font-size:.84rem">${esc(insp.notes)}</p>` : ''}
      </div>`;
  }

  /** The full sheet as it appears on a vehicle page. */
  function specSheetHtml(v, s) {
    if (!s || !s.performance) return '';
    const p = s.performance;
    const c = s.chassis;
    const pr = s.practical;
    const it = s.interior;
    return `
      <h3 class="mt-lg">Under the bonnet</h3>
      <div class="specgroups">
        ${specGroup('Engine & drive', [
          ['Engine', p.engineCc ? `${p.engineLitres}L · ${num(p.engineCc)} cc` : null],
          ['Aspiration', p.aspiration],
          ['Power', p.hp ? `${p.hp} hp (${p.kw} kW)` : null],
          ['Torque', p.torqueNm ? `${p.torqueNm} Nm` : null],
          ['Power to weight', p.powerToWeight ? `${p.powerToWeight} hp per tonne` : null],
          ['Transmission', p.transmission],
          ['Drive layout', p.layout],
        ])}
        ${specGroup('Performance', [
          ['0–100 km/h', p.zeroTo100 == null ? null : `${p.zeroTo100.toFixed(1)} s`],
          ['Top speed', p.topSpeed ? `${p.topSpeed} km/h` : null],
          ['Fuel', v.fuel],
          ['Range per tank', pr.rangePerTank ? `${num(pr.rangePerTank)} km` : null],
        ])}
        ${specGroup('Wheels & stance', [
          ['Rim diameter', c.rimSize ? `${c.rimSize} inch` : null],
          ['Tyre size', c.tyreSize],
          ['Ground clearance', c.groundClearance ? `${c.groundClearance} mm` : null],
          ['Kerb weight', c.kerbWeight ? `${num(c.kerbWeight)} kg` : null],
          ['Brakes', c.brakes],
        ])}
        ${specGroup('Space & practicality', [
          ['Seats', pr.seats],
          ['Doors', pr.doors],
          ['Boot space', pr.bootLitres ? `${pr.bootLitres} litres` : null],
          ['Fuel tank', pr.fuelTank ? `${pr.fuelTank} litres` : null],
          ['Colour', v.color],
        ])}
        ${specGroup('Inside', [
          ['Seat trim', it.seats],
          ['Condition', it.rating],
          ['Screen', it.screen],
          ['Climate', it.climate],
          ['Sunroof', it.sunroof ? 'Yes' : null],
          ['Reverse camera', it.camera ? 'Yes' : null],
          ['Cruise control', it.cruise ? 'Yes' : null],
          ['Keyless / push start', it.keyless ? 'Yes' : null],
        ])}
        ${specGroup('Paperwork', [
          ['Year', v.year],
          ['Mileage', `${num(v.mileage_km)} km`],
          ['Reg. no', v.reg_no],
          ['Branch', v.branch_name],
        ])}
      </div>
      <p class="dim mt" style="font-size:.78rem;max-width:70ch">${esc(s.disclaimer)}</p>`;
  }

  /**
   * "Am I being overcharged?" — the first question every buyer asks and the one no
   * Kenyan site answers. Shown only when there is enough comparable stock to mean it,
   * and worded as a comparison against this yard rather than a market valuation,
   * because that is all the data actually supports.
   */
  function priceBadge(pc) {
    if (!pc) return '';
    if (!pc.enough) {
      return `<div class="pricecheck thin"><span class="dim">${esc(pc.note)}</span></div>`;
    }
    return `<div class="pricecheck ${esc(pc.band)}">
      <div class="pc-head">
        <span class="pc-label">${esc(pc.label)}</span>
        <span class="pc-delta">${pc.cheaper ? '−' : '+'}${KES(pc.difference).replace('KES ', '')}</span>
      </div>
      <div class="pc-blurb">${esc(pc.blurb)}</div>
      <div class="pc-basis">${esc(pc.basis)}</div>
    </div>`;
  }

  /**
   * Provenance. In Kenya this is the block that decides a sale: an outstanding logbook
   * loan means the car is not the seller's to sell, and a TIMS record that disagrees with
   * the logbook in your hand is the classic forecourt fraud.
   *
   * A check nobody ran says so. It never reads as a pass, and a problem is shown rather
   * than hidden — a yard that only publishes clean checks has published nothing.
   */
  function historyBlock(h) {
    if (!h) return '';
    const icon = { clear: '✓', problem: '!', unchecked: '–' };
    return `<h3 class="mt-lg">Provenance</h3>
      <div class="provenance ${h.problemCount ? 'flagged' : ''}">
        <div class="pv-head">
          <b>${esc(h.headline)}</b>
          ${h.checkedOn ? `<span class="dim">checked ${dateFmt(h.checkedOn)}</span>` : ''}
        </div>
        ${h.checks
          .map(
            (c) => `<div class="pv-row ${c.state}">
              <span class="pv-mark">${icon[c.state]}</span>
              <div>
                <div class="pv-label">${esc(c.label)}</div>
                <div class="pv-detail">${c.state === 'unchecked' ? 'Not checked — ask us before you commit.' : esc(c.detail)}</div>
              </div>
            </div>`
          )
          .join('')}
        ${
          h.importEntry || h.keepers != null
            ? `<div class="pv-foot">
                ${h.importEntry ? `<span>Import entry <b>${esc(h.importEntry)}</b></span>` : ''}
                ${h.keepers != null ? `<span>${h.keepers} previous ${h.keepers === 1 ? 'keeper' : 'keepers'}</span>` : ''}
              </div>`
            : ''
        }
        ${h.notes ? `<p class="pv-note">${esc(h.notes)}</p>` : ''}
      </div>`;
  }

  /** What the dealership stands behind, said where the customer is deciding. */
  function promiseStrip(p) {
    if (!p) return '';
    const items = [
      p.returnDays ? [`${p.returnDays}-day returns`, p.returnTerms || 'Change your mind and bring it back.'] : null,
      p.warrantyMonths ? [`${p.warrantyMonths}-month warranty`, 'Covered from the day you drive away.'] : null,
      p.transferIncluded
        ? ['Transfer handled', 'We do the NTSA logbook transfer for you — no queue, no agent.']
        : p.transferFee != null
        ? [`Transfer ${KES(p.transferFee)}`, 'We handle the NTSA logbook transfer at cost.']
        : null,
    ].filter(Boolean);
    if (!items.length) return '';
    return `<div class="promises">${items
      .map((i) => `<div class="promise"><b>${esc(i[0])}</b><span>${esc(i[1])}</span></div>`)
      .join('')}</div>`;
  }

  /** Three figures on a listing card: quick, strong, and what it rolls on. */
  function cardStats(s) {
    if (!s) return '';
    const bits = [
      s.zeroTo100 == null ? null : `<span><b>${s.zeroTo100.toFixed(1)}s</b> 0–100</span>`,
      s.hp ? `<span><b>${s.hp}</b> hp</span>` : null,
      s.rimSize ? `<span><b>${s.rimSize}"</b> rims</span>` : null,
    ].filter(Boolean);
    return bits.length ? `<div class="cardstats">${bits.join('')}</div>` : '';
  }

  function vehicleCard(v) {
    const saved = S.saved.includes(v.id);
    const inCompare = S.compare.includes(v.id);
    const monthly = estimateMonthly(v.price);
    return `<article class="veh">
      <a class="shot" href="#/vehicle/${v.id}">
        <img src="${esc(vehImg(v))}" alt="${esc(v.title)}" loading="lazy">
        <div class="flags">
          ${v.status === 'available' ? '<span class="tag ok">Available</span>' : `<span class="tag err">${esc(titleCase(v.status))}</span>`}
          ${v.condition === 'new' ? '<span class="tag brand">Brand new</span>' : ''}
          ${v.featured ? '<span class="tag warn">Featured</span>' : ''}
          ${v.reg_status && v.reg_status !== 'registered' ? `<span class="tag ${REG_TONE[v.reg_status]}">${esc(REG_LABEL[v.reg_status])}</span>` : ''}
        </div>
        <button class="save ${saved ? 'on' : ''}" data-save="${v.id}" title="Save">${saved ? '♥' : '♡'}</button>
      </a>
      <div class="body">
        <a href="#/vehicle/${v.id}"><div class="name">${esc(v.title)}</div></a>
        <div class="meta">${esc(CONDITION_LABEL[v.condition] || v.condition)} · ${num(v.mileage_km)} km · ${esc(v.transmission || '')} · ${esc(v.fuel || '')}</div>
        ${cardStats(v.specs)}
        <div class="price">${KES(v.price)}${v.old_price && v.old_price > v.price ? `<span class="was">${KES(v.old_price)}</span>` : ''}</div>
        ${v.negotiable ? '<div class="dim" style="font-size:.76rem">• Price negotiable</div>' : ''}
        <div class="fin">from <b>${KES(monthly)}</b> / month with financing</div>
        <div class="actions">
          <a class="btn primary sm grow" href="#/finance/${v.id}">Finance this car</a>
          ${v.status === 'available' ? `<a class="btn sm ok" href="#/reserve/${v.id}" title="Reserve online">Reserve</a>` : ''}
          <a class="btn sm wa" href="${esc(waVehicle(v))}" target="_blank" rel="noopener" title="WhatsApp the dealership">WhatsApp</a>
          <button class="btn sm ${inCompare ? 'primary' : ''}" data-compare="${v.id}" title="Compare">⇄</button>
        </div>
      </div>
    </article>`;
  }

  /* ---------------- showcase view ---------------- */

  /**
   * Kenyan stock lists paint by name, never as a hex code, and the names are marketing
   * names — "Soul Red", "Machine Grey", "Urban Khaki". These cover what is actually in
   * the yard; anything unrecognised falls back to the dealership's own colour, which is
   * always a safe answer rather than a wrong one.
   */
  const CAR_PAINT = {
    white: '#dcdcde', 'pearl white': '#e2ded6', 'white pearl': '#e2ded6',
    'glacier white': '#dfe3e4', 'crystal white': '#e4e4e6', 'alpine white': '#e8e8ea',
    'carrara white': '#e6e3dd', 'white orchid': '#e4e0dc',
    silver: '#b4b7ba', 'lunar silver': '#a9adb2', 'iridium silver': '#9fa3a8',
    'cool silver': '#b8bcc0', 'sonic titanium': '#8e9396',
    grey: '#6f7276', gray: '#6f7276', 'storm grey': '#5c6064', 'selenite grey': '#63676b',
    'machine grey': '#4c5155', 'mineral grey': '#5a5f63', 'ammonite grey': '#71757a',
    graphite: '#45484c', 'gun metallic': '#4a4e52',
    black: '#232326', 'santorini black': '#1c1c1f', 'precious black': '#1d1d20',
    'obsidian black': '#1a1a1d',
    red: '#b31b26', 'soul red': '#8f1420', 'tornado red': '#c01722', 'firenze red': '#96131f',
    blue: '#1f4e87', 'deep blue': '#173a63', 'dark blue': '#152f52', 'lagoon blue': '#2a6b8e',
    orange: '#c85a1b', bronze: '#8a6135', beige: '#c3b394', cream: '#ddd3bd',
    purple: '#4d2c5e', mint: '#9ec9b6', 'kinetic yellow': '#d8a417', 'urban khaki': '#7d7657',
  };

  /**
   * The car's own paint, as a hex we can put behind a button — but only when it will
   * actually read as a button.
   *
   * The reference sells this idea on a slate-blue Mustang and a red Lexus. Kenyan stock
   * is not that: 22 of the 77 cars in this yard are white or silver, and Carrara White on
   * the light stage is a near-invisible button on a near-invisible background. So the
   * paint is used only when it clears 2.5:1 against the stage it sits on, and otherwise
   * the button falls back to the dealership's own colour. A button you cannot see is
   * worse than a button that is not the same colour as the car.
   */
  const PAINT_MIN_CONTRAST = 2.5;

  /**
   * The showcase wants a cut-out, not a framed photograph — the model name is set
   * enormous behind the car, and a rectangle with its own background hides it.
   *
   * 54 of the 77 cars are drawn by our own /img/vehicle.svg endpoint, so for those the
   * cut-out is free and exact: ask for bare=1 and it omits the plate. The rest are real
   * photographs with real backgrounds, and they stay as they are — a framed photo on the
   * stage is honest, and inventing a cut-out from a JPEG is a job for a person, not a
   * regex. Nothing here breaks if the URL is one we do not recognise.
   */
  function showcaseImg(v) {
    const src = vehImg(v);
    if (!src || src.indexOf('/img/vehicle.svg') === -1) return src;
    /* bare=1 drops the plate. view=side because the reference shows every car in
       profile, and because the front elevation in our own generator is a blunt
       symmetrical shape that reads as a cartoon at this size — the side profile has an
       actual silhouette. Any view already in the URL is replaced, not appended. */
    const base = src.split('?')[0];
    const q = new URLSearchParams(src.split('?')[1] || '');
    q.set('view', 'side');
    q.set('bare', '1');
    return base + '?' + q.toString();
  }

  /** True when the showcase image has no background of its own. */
  const isCutout = (v) => String(vehImg(v) || '').indexOf('/img/vehicle.svg') !== -1;

  function paintOf(v) {
    const name = String(v.color || '').trim().toLowerCase();
    const hex = CAR_PAINT[name];
    if (!hex) return null;
    const stage = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    return contrastRatio(hex, stage) >= PAINT_MIN_CONTRAST ? hex : null;
  }

  /**
   * One car, full stage. The model name is set enormous and ghosted behind the car; the
   * primary button takes the car's own paint.
   *
   * The ghosted name is aria-hidden because it repeats the heading immediately above it,
   * and a screen reader announcing the model twice is noise, not emphasis.
   */
  function showcaseSlide(v, i, total) {
    const monthly = estimateMonthly(v.price);
    const s = v.specs || {};
    const model = `${v.model || ''}`.trim();
    return `<article class="sc-slide" data-vid="${v.id}">
      <div class="sc-flags">
        ${v.status === 'available' ? '<span class="tag ok">Available</span>' : `<span class="tag err">${esc(titleCase(v.status))}</span>`}
        ${v.condition === 'new' ? '<span class="tag brand">Brand new</span>' : ''}
      </div>

      <div class="sc-head">
        <h2 class="sc-brand">${esc(v.make)}</h2>
        <div class="sc-model" aria-hidden="true">${esc(model)}</div>
      </div>

      <a class="sc-figure" href="#/vehicle/${v.id}" aria-label="${esc(v.title)}">
        <img class="sc-shot ${isCutout(v) ? 'cutout' : 'framed'}" src="${esc(showcaseImg(v))}" alt="${esc(v.title)}">
      </a>

      <div class="sc-foot">
        <div class="sc-price">${KES(v.price)}</div>
        <div class="sc-sub">from ${KES(monthly)} / month with financing</div>
        <div class="sc-meta">${v.year} · ${num(v.mileage_km)} km · ${esc(v.transmission || '')} · ${esc(v.fuel || '')}</div>
        <div class="sc-cta">
          <a class="btn primary" href="#/finance/${v.id}">Finance</a>
          <a class="btn" href="#/vehicle/${v.id}">Details</a>
        </div>
      </div>

      <div class="sc-specs">
        ${s.hp ? `<div><div class="lbl">Power</div><div class="v">${s.hp} hp</div></div>` : ''}
        ${s.zeroTo100 ? `<div><div class="lbl">0–100</div><div class="v">${s.zeroTo100}s</div></div>` : ''}
        ${s.rimSize ? `<div><div class="lbl">Rims</div><div class="v">${s.rimSize}"</div></div>` : ''}
      </div>

      <div class="sc-count">${i + 1} / ${total}</div>
    </article>`;
  }

  /**
   * Save this search and be told when something matching arrives.
   *
   * The customer who cannot find what they want today is the one most worth hearing from
   * again, and saving a *car* — which is all this did before — only helps the ones who
   * already found something. No account needed: most Kenyan buyers will not make one
   * before they have found a car.
   */
  on(document, 'click', '[data-act="save-search"]', async (e) => {
    e.preventDefault();
    const filters = { ...(S.filters || {}) };
    delete filters.page;
    const m = modal('Tell me when one arrives', `
      <p class="muted">We will let you know as soon as a car matching this search comes into stock.</p>
      <div class="panel"><div class="lbl" style="margin:0">Your search</div>
        <div id="ssLabel">${esc(Object.keys(filters).length ? Object.entries(filters).map(([k, v]) => `${k}: ${v}`).join(' · ') : 'Everything in stock')}</div>
      </div>
      ${S.user ? '<p class="muted mt">We will email you at ' + esc(S.user.email) + '.</p>' : `
        <div class="field mt"><label>Phone number</label><input type="tel" id="ssPhone" placeholder="0712 345 678"></div>
        <div class="field"><label>…or email</label><input type="email" id="ssEmail" placeholder="you@example.com"></div>`}
      ${honeypot()}
      <div class="row mt" style="justify-content:flex-end;gap:8px">
        <button class="btn" data-close>Cancel</button>
        <button class="btn primary" id="ssGo">Set the alert</button>
      </div>`);

    $('#ssGo', m.body).onclick = async () => {
      const btn = $('#ssGo', m.body);
      btn.disabled = true;
      try {
        const r = await POST('/api/saved-searches', {
          filters,
          phone: S.user ? '' : $('#ssPhone', m.body).value,
          email: S.user ? '' : $('#ssEmail', m.body).value,
          ...botFields(),
        });
        m.close();
        toast(`Alert set — ${r.label}`, 'ok');
      } catch (err) {
        toast(err.message, 'err');
        btn.disabled = false;
      }
    };
  });

  /**
   * Book a test drive on a real slot.
   *
   * This replaces "someone will call you back", which costs the dealership a phone call
   * on every enquiry and leaves the customer waiting to find out if they even can come.
   * The slot is re-checked server-side at the moment of booking, so two people looking at
   * the same screen cannot both take the last one.
   */
  on(document, 'click', '[data-book]', async (e, el) => {
    e.preventDefault();
    const vehicleId = Number(el.dataset.book);
    const m = modal('Book a test drive', '<div class="spinner"></div>');
    let slots;
    try {
      slots = (await GET('/api/bookings/slots')).slots;
    } catch (err) {
      m.body.innerHTML = `<div class="err-text">${esc(err.message)}</div>`;
      return;
    }
    if (!slots.length) {
      m.body.innerHTML = '<p>We have no free slots in the next fortnight. Give us a call and we will fit you in.</p>';
      return;
    }

    const p = S.profile || {};
    m.body.innerHTML = `
      <p class="muted">Pick a day and a time. You will get a reference straight away — no waiting for a call back.</p>
      <div class="lbl">Day</div>
      <div class="slot-days" id="bDays">
        ${slots.map((s, i) => `<button type="button" class="slot-day ${i === 0 ? 'on' : ''}" data-day="${i}">
          <span>${esc(s.weekday)}</span><b>${dateFmt(s.date).replace(/ \\d{4}$/, '')}</b>
        </button>`).join('')}
      </div>
      <div class="lbl mt">Time</div>
      <div class="slot-times" id="bTimes"></div>
      <div class="grid-2 mt">
        <div class="field"><label>Your name *</label><input type="text" id="bName" value="${esc(S.user ? S.user.name : '')}"></div>
        <div class="field"><label>Phone *</label><input type="tel" id="bPhone" value="${esc(p.phone || '')}" placeholder="0712 345 678"></div>
      </div>
      <div class="field"><label>Email</label><input type="email" id="bEmail" value="${esc(S.user ? S.user.email : '')}"></div>
      <div class="field"><label>Anything we should know?</label><input type="text" id="bNotes" placeholder="e.g. I want to bring my mechanic"></div>
      ${honeypot()}
      <div class="row mt" style="justify-content:flex-end;gap:8px">
        <button class="btn" data-close>Cancel</button>
        <button class="btn primary" id="bGo">Confirm booking</button>
      </div>`;

    let day = 0;
    let time = slots[0].times[0];
    const paintTimes = () => {
      $('#bTimes', m.body).innerHTML = slots[day].times
        .map((t) => `<button type="button" class="slot-time ${t === time ? 'on' : ''}" data-time="${t}">${t}</button>`)
        .join('');
    };
    paintTimes();

    on(m.body, 'click', '[data-day]', (ev, b) => {
      day = Number(b.dataset.day);
      time = slots[day].times[0];
      $$('.slot-day', m.body).forEach((x) => x.classList.toggle('on', x === b));
      paintTimes();
    });
    on(m.body, 'click', '[data-time]', (ev, b) => {
      time = b.dataset.time;
      $$('.slot-time', m.body).forEach((x) => x.classList.toggle('on', x === b));
    });

    $('#bGo', m.body).onclick = async () => {
      const btn = $('#bGo', m.body);
      btn.disabled = true;
      btn.textContent = 'Booking…';
      try {
        const r = await POST('/api/bookings', {
          vehicleId,
          date: slots[day].date,
          time,
          kind: 'test_drive',
          name: $('#bName', m.body).value,
          phone: $('#bPhone', m.body).value,
          email: $('#bEmail', m.body).value,
          notes: $('#bNotes', m.body).value,
          ...botFields(),
        });
        m.body.innerHTML = `<div class="form-note ok"><span>✓</span><div>
          <b>Booked — ${esc(dateFmt(r.date))} at ${esc(r.time)}</b>
          <div class="muted">Your reference is <b class="mono">${esc(r.ref)}</b>.
          ${r.branch ? `Come to ${esc(r.branch.name)}${r.branch.address ? ', ' + esc(r.branch.address) : ''}.` : ''}
          Bring your driving licence and ID.</div>
        </div>
        <div class="row mt" style="justify-content:flex-end"><button class="btn primary" data-close>Done</button></div>`;
      } catch (err) {
        toast(err.message, 'err');
        btn.disabled = false;
        btn.textContent = 'Confirm booking';
      }
    };
  });

  /* Print the condition report. Opening every point first, because a collapsed
     <details> prints collapsed and the whole value of the report is the list. */
  on(document, 'click', '[data-act="print-report"]', (e) => {
    e.preventDefault();
    const d = $('.sc-points');
    if (d) d.open = true;
    document.body.classList.add('printing-report');
    // Give the browser a frame to lay the expanded list out before it snapshots.
    setTimeout(() => {
      window.print();
      document.body.classList.remove('printing-report');
    }, 60);
  });

  /* Social sign-in. Delegated because the CSP forbids inline handlers, and because the
     buttons are re-rendered every time the account panel repaints. */
  on(document, 'click', '[data-social]', async (e, el) => {
    e.preventDefault();
    if (el.disabled) return;
    const was = el.innerHTML;
    el.disabled = true;
    el.innerHTML = 'Opening sign-in…';
    try {
      const user = await MotoKEAuth.signInWith(el.dataset.social);
      S.user = user;
      paintChrome();
      toast('Welcome, ' + String(user.name || '').split(' ')[0], 'ok');
      render();
    } catch (err) {
      toast(err.message, 'err');
      el.disabled = false;
      el.innerHTML = was;
    }
  });

  on(document, 'click', '[data-save]', (e, el) => {
    e.preventDefault();
    const id = Number(el.dataset.save);
    S.saved = S.saved.includes(id) ? S.saved.filter((x) => x !== id) : [...S.saved, id];
    store.set('saved', S.saved);
    if (S.user) POST('/api/me/saved', { vehicleId: id }).catch(() => {});
    toast(S.saved.includes(id) ? 'Saved to your shortlist' : 'Removed from shortlist');
    render();
  });

  on(document, 'click', '[data-compare]', (e, el) => {
    e.preventDefault();
    const id = Number(el.dataset.compare);
    if (S.compare.includes(id)) S.compare = S.compare.filter((x) => x !== id);
    else if (S.compare.length >= 3) return toast('You can compare up to 3 cars at a time', 'err');
    else S.compare = [...S.compare, id];
    store.set('compare', S.compare);
    render();
  });

  /* ---------------- pages ---------------- */

  async function pageHome() {
    view.innerHTML = `<div class="hero-stage skel" style="height:70vh"></div><div class="wrap mt-lg">${skelCards(3)}</div>`;

    // The hero and the stock rail are the same query: the cars this yard wants seen.
    const featured = await GET(`/api/vehicles?featured=1&pageSize=10&sort=featured`);
    let cars = featured.items;
    // Featured cars sell. Top the rail up from live stock so it is always worth scrolling.
    if (cars.length < 9) {
      const fill = await GET(`/api/vehicles?pageSize=12&sort=featured`);
      const seen = new Set(cars.map((c) => c.id));
      cars = cars.concat(fill.items.filter((c) => !seen.has(c.id))).slice(0, 9);
    }
    const stage = cars.slice(0, 5);
    const total = (await GET(`/api/vehicles?pageSize=1`)).total;
    const f = S.boot.facets;

    view.innerHTML = `
      <!-- ============ 1. the stage: full-bleed cars, one at a time ============ -->
      <section class="hero-stage" id="stage" aria-roledescription="carousel" aria-label="Featured vehicles">
        ${stage
          .map(
            (v, i) => `<article class="slide ${i === 0 ? 'on' : ''}" data-slide="${i}" ${i === 0 ? '' : 'aria-hidden="true"'}>
              <img class="slide-img" src="${esc(vehImg(v))}" alt="${esc(v.title)}" ${i === 0 ? '' : 'loading="lazy"'}>
              <div class="slide-copy wrap">
                <div class="lbl">${esc(CONDITION_LABEL[v.condition] || '')}${v.reg_status && v.reg_status !== 'registered' ? ' · ' + esc(REG_LABEL[v.reg_status]) : ''}</div>
                <h1>${esc(v.make)}<br>${esc(v.model)}</h1>
                <div class="slide-meta">
                  <span>${v.year}</span><span>${num(v.mileage_km)} km</span><span>${esc(v.transmission || '')}</span><span>${esc(v.fuel || '')}</span>
                </div>
                <div class="slide-price">${KES(v.price)}<span class="dim"> · from ${KES(estimateMonthly(v.price))}/month</span></div>
                <div class="row wrap-r mt">
                  <a class="btn primary" href="#/vehicle/${v.id}">View this car <span aria-hidden="true">→</span></a>
                  <a class="btn" href="#/finance/${v.id}">Finance it <span aria-hidden="true">→</span></a>
                </div>
              </div>
            </article>`
          )
          .join('')}
        <div class="stage-ctl">
          <button class="stage-play" id="stagePlay" aria-label="Pause the carousel" aria-pressed="false">❚❚</button>
          <div class="pips" id="stagePips" role="tablist" aria-label="Choose a vehicle">
            ${stage.map((v, i) => `<button class="pip ${i === 0 ? 'on' : ''}" data-pip="${i}" role="tab" aria-selected="${i === 0}" aria-label="${esc(v.title)}"></button>`).join('')}
          </div>
        </div>
      </section>

      <!-- ============ 2. financing band ============ -->
      <!-- Financing is what this business actually sells, so it is the first thing
           below the hero rather than something a visitor scrolls past cars to find. -->
      <section class="band">
        <div class="wrap section-head">
          <div>
            <div class="lbl">Vehicle financing</div>
            <h2>Find the right loan<br>for your next car.</h2>
            <p class="muted" style="max-width:56ch">Compare rates from ${S.boot.lenders.length} Kenyan lenders, work out what you can
            afford, see the true cost of ownership, and pre-qualify in minutes.</p>
          </div>
          <div class="row wrap-r">
            <a class="btn primary lg" href="#/financing/afford">What can I afford? <span aria-hidden="true">→</span></a>
            <a class="btn lg" href="#/financing/calculator">Work out a payment</a>
          </div>
        </div>
      </section>

      <!-- ============ 3. search ============ -->
      <section class="wrap">
        <div class="quick-search">
          <div>
            <label class="lbl" for="hMake">Make</label>
            <select id="hMake"><option value="">Any make</option>
              ${f.makes.map((m) => `<option value="${esc(m.v)}">${esc(m.v)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="lbl" for="hBody">Type</label>
            <select id="hBody"><option value="">Any type</option>
              ${f.bodyTypes.map((b) => `<option value="${esc(b.v)}">${esc(b.v)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="lbl" for="hBudget">Budget</label>
            <select id="hBudget"><option value="">Any price</option>
              ${[1000000, 2000000, 3000000, 5000000, 10000000].map((n) => `<option value="${n}">Under ${K(n)}</option>`).join('')}
            </select>
          </div>
          <button class="btn primary lg" id="hGo">Search</button>
        </div>
        <div class="pills mt">
          ${[['body=SUV', 'SUVs'], ['body=Sedan', 'Sedans'], ['body=Pickup', 'Pickups'], ['condition=foreign_used', 'Imports'],
             ['condition=new', 'Brand new'], ['maxPrice=2000000', 'Under 2M'], ['maxPrice=5000000', 'Under 5M'], ['fuel=Hybrid', 'Hybrids']]
            .map((q) => `<button class="pill" data-quick="${q[0]}">${q[1]}</button>`).join('')}
        </div>
        <div class="muted mt" style="font-size:.86rem">${total} vehicles available · updated daily</div>
      </section>

      <!-- ============ 4. the stock rail ============ -->
      <section class="wrap section">
        <div class="section-head">
          <h2>The stock</h2>
          <a class="btn ghost" href="#/browse">Discover all vehicles</a>
        </div>
        <div class="rail-wrap">
          <button class="rail-nav prev" id="railPrev" aria-label="Previous vehicles">‹</button>
          <div class="rail" id="rail" data-lenis-prevent>
            ${cars
              .map(
                (v) => `<article class="rail-card">
                  <a href="#/vehicle/${v.id}" class="rail-shot"><img src="${esc(vehImg(v))}" alt="${esc(v.title)}" loading="lazy"></a>
                  <div class="lbl mt">${esc(CONDITION_LABEL[v.condition] || '')}</div>
                  <h3>${esc(v.title)}</h3>
                  <div class="rail-price">${KES(v.price)}</div>
                  <div class="rail-meta">${num(v.mileage_km)} km · ${esc(v.transmission || '')} · ${esc(v.fuel || '')}</div>
                  ${cardStats(v.specs)}
                  <div class="rail-actions">
                    <a class="btn ghost sm" href="#/vehicle/${v.id}">View details</a>
                    <a class="btn ghost sm" href="#/finance/${v.id}">Finance this car</a>
                    ${v.status === 'available' ? `<a class="btn ghost sm" href="#/reserve/${v.id}">Reserve</a>` : ''}
                  </div>
                </article>`
              )
              .join('')}
          </div>
          <button class="rail-nav next" id="railNext" aria-label="More vehicles">›</button>
        </div>
      </section>

      <!-- ============ 5. find us ============ -->
      <section class="wrap section">
        <div class="section-head">
          <h2>Find us</h2>
          <a class="btn ghost" href="#/contact">All contact details</a>
        </div>
        <div class="grid-3">
          ${S.boot.branches
            .map(
              (b) => `<div class="panel">
                <div class="lbl">${esc(b.city || '')}</div>
                <h3>${esc(b.name)}</h3>
                <p class="muted" style="margin:0">${esc(b.address || '')}</p>
                <div class="mt"><a class="btn ghost sm" href="tel:${esc((b.phone || '').replace(/\s/g, ''))}">${esc(b.phone || '')}</a></div>
              </div>`
            )
            .join('')}
        </div>
      </section>

      <!-- ============ 6. the finance panel ============ -->
      <section class="wrap section">
        <div class="section-head">
          <h2>Our finance panel</h2>
          <a class="btn ghost" href="#/financing/compare">Compare every lender</a>
        </div>
        <div class="lender-strip">
          ${S.boot.lenders
            .map(
              (l) => `<div class="lender-chip">
                <span class="badge-lender" style="background:${esc(l.color)}">${esc(l.logo_text || '?')}</span>
                <span><b>${esc(l.short_name || l.name)}</b><span class="dim"> · ${l.annual_rate}% ${l.rate_type === 'flat' ? 'flat' : 'p.a.'}</span></span>
              </div>`
            )
            .join('')}
        </div>
      </section>`;

    /* ---- search ---- */
    $('#hGo').onclick = () => {
      const q = {};
      if ($('#hMake').value) q.make = $('#hMake').value;
      if ($('#hBody').value) q.body = $('#hBody').value;
      if ($('#hBudget').value) q.maxPrice = $('#hBudget').value;
      go('#/browse' + (Object.keys(q).length ? '?' + new URLSearchParams(q).toString() : ''));
    };
    on(view, 'click', '[data-quick]', (e, el) => {
      const [k, v] = el.dataset.quick.split('=');
      go('#/browse?' + new URLSearchParams({ [k]: v }).toString());
    });

    /* ---- the stage carousel ---- */
    const slides = $$('#stage .slide');
    const pips = $$('#stagePips .pip');
    let at = 0;
    let timer = null;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const show = (n) => {
      at = (n + slides.length) % slides.length;
      slides.forEach((s, i) => {
        s.classList.toggle('on', i === at);
        s.toggleAttribute('aria-hidden', i !== at);
      });
      pips.forEach((p, i) => {
        p.classList.toggle('on', i === at);
        p.setAttribute('aria-selected', String(i === at));
      });
    };
    const stop = () => {
      clearInterval(timer);
      timer = null;
      $('#stagePlay').textContent = '▶';
      $('#stagePlay').setAttribute('aria-pressed', 'true');
      $('#stagePlay').setAttribute('aria-label', 'Play the carousel');
    };
    const play = () => {
      if (reduced || slides.length < 2) return;
      clearInterval(timer);
      timer = setInterval(() => show(at + 1), 6000);
      $('#stagePlay').textContent = '❚❚';
      $('#stagePlay').setAttribute('aria-pressed', 'false');
      $('#stagePlay').setAttribute('aria-label', 'Pause the carousel');
    };

    on($('#stagePips'), 'click', '[data-pip]', (e, el) => {
      show(Number(el.dataset.pip));
      stop();
    });
    $('#stagePlay').onclick = () => (timer ? stop() : play());

    // arrow keys when the stage has focus, and a swipe on touch
    $('#stage').tabIndex = 0;
    $('#stage').addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { show(at + 1); stop(); }
      if (e.key === 'ArrowLeft') { show(at - 1); stop(); }
    });
    let touchX = null;
    $('#stage').addEventListener('touchstart', (e) => (touchX = e.changedTouches[0].clientX), { passive: true });
    $('#stage').addEventListener('touchend', (e) => {
      if (touchX == null) return;
      const dx = e.changedTouches[0].clientX - touchX;
      if (Math.abs(dx) > 50) { show(at + (dx < 0 ? 1 : -1)); stop(); }
      touchX = null;
    });
    // A carousel that keeps moving while nobody is looking is just wasted battery.
    document.addEventListener('visibilitychange', () => (document.hidden ? clearInterval(timer) : timer && play()));

    /* Once the hero is scrolled past, stop the slide timer AND the drift animation.
       A full-viewport image being re-scaled every frame behind the content you are
       actually reading is what made the homepage scroll badly. */
    const stageEl = $('#stage');
    if (stageEl && 'IntersectionObserver' in window) {
      const wasPlaying = { on: true };
      new IntersectionObserver(
        ([entry]) => {
          const visible = entry.isIntersecting;
          stageEl.classList.toggle('offscreen', !visible);
          if (!visible) {
            wasPlaying.on = !!timer;
            clearInterval(timer);
            timer = null;
          } else if (wasPlaying.on && !reduced) {
            play();
          }
        },
        { threshold: 0.01 }
      ).observe(stageEl);
    }

    play();
    S.stopStage = stop;

    /* ---- the stock rail ---- */
    const rail = $('#rail');
    const step = () => Math.max(280, rail.clientWidth * 0.8);
    $('#railPrev').onclick = () => rail.scrollBy({ left: -step(), behavior: 'smooth' });
    $('#railNext').onclick = () => rail.scrollBy({ left: step(), behavior: 'smooth' });
    const syncRail = () => {
      $('#railPrev').disabled = rail.scrollLeft < 8;
      $('#railNext').disabled = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 8;
    };
    rail.addEventListener('scroll', syncRail, { passive: true });
    syncRail();
  }

  /* ---------------- browse ---------------- */

  async function pageBrowse(query) {
    const f = { ...query };
    S.filters = f;
    const facets = S.boot.facets;
    const r = facets.range || {};
    view.innerHTML = `
      <h1 class="mt">Browse stock</h1>
      <div class="split" id="browseSplit">
        <aside class="card filters sticky" id="filters">
          <div class="row between"><strong>Filters</strong><button class="btn sm ghost" id="clearF">Clear</button></div>
          <div class="grp">
            <label class="lbl">Search</label>
            <input type="text" id="fq" placeholder="Prado, Vitz, red…" value="${esc(f.q || '')}">
          </div>
          <div class="grp">
            <label class="lbl">Monthly budget (KES)</label>
            <input type="number" id="fMonthly" placeholder="e.g. 45000" value="${esc(f.maxMonthly || '')}">
            <small class="dim">Shows only cars whose instalment fits, at a ${f.budgetDepositPct || 20}% deposit over ${f.budgetTenor || 48} months.</small>
          </div>
          <div class="grp">
            <label class="lbl">Price (KES)</label>
            <div class="grid-2">
              <input type="number" id="fMin" placeholder="${num(r.minPrice || 0)}" value="${esc(f.minPrice || '')}">
              <input type="number" id="fMax" placeholder="${num(r.maxPrice || 0)}" value="${esc(f.maxPrice || '')}">
            </div>
          </div>
          <div class="grp">
            <label class="lbl">Make</label>
            <select id="fMake"><option value="">Any make</option>
              ${facets.makes.map((m) => `<option value="${esc(m.v)}" ${f.make === m.v ? 'selected' : ''}>${esc(m.v)} (${m.n})</option>`).join('')}
            </select>
          </div>
          <div class="grp">
            <label class="lbl">Body type</label>
            <div class="pills">
              ${facets.bodyTypes.map((b) => `<button class="pill ${f.body === b.v ? 'on' : ''}" data-f="body" data-v="${esc(b.v)}">${esc(b.v)}</button>`).join('')}
            </div>
          </div>
          <div class="grp">
            <label class="lbl">Condition</label>
            <div class="pills">
              ${facets.conditions.map((c) => `<button class="pill ${f.condition === c.v ? 'on' : ''}" data-f="condition" data-v="${esc(c.v)}">${esc(CONDITION_LABEL[c.v] || c.v)}</button>`).join('')}
            </div>
          </div>
          <div class="grp">
            <label class="lbl">Fuel</label>
            <div class="pills">
              ${facets.fuels.map((c) => `<button class="pill ${f.fuel === c.v ? 'on' : ''}" data-f="fuel" data-v="${esc(c.v)}">${esc(c.v)}</button>`).join('')}
            </div>
          </div>
          <div class="grp">
            <label class="lbl">Transmission</label>
            <div class="pills">
              ${facets.transmissions.map((c) => `<button class="pill ${f.transmission === c.v ? 'on' : ''}" data-f="transmission" data-v="${esc(c.v)}">${esc(c.v)}</button>`).join('')}
            </div>
          </div>
          <div class="grp">
            <label class="lbl">Year from</label>
            <input type="number" id="fYear" placeholder="${r.minYear || ''}" value="${esc(f.minYear || '')}">
          </div>
          <div class="grp">
            <label class="lbl">Max mileage (km)</label>
            <input type="number" id="fKm" placeholder="200000" value="${esc(f.maxMileage || '')}">
          </div>
        </aside>
        <div>
          <div class="browse-bar">
            <button class="btn sm ghost" id="filterBtn" hidden>Filters</button>
            <div id="count" class="muted grow">Loading…</div>
            <div class="row">
              <div class="pills" id="viewToggle" role="group" aria-label="How to show the stock">
                <button class="pill" data-view="showcase" aria-pressed="false">Showcase</button>
                <button class="pill" data-view="grid" aria-pressed="false">Grid</button>
              </div>
              <button class="btn sm ghost" data-act="save-search" title="Tell me when a car like this arrives">♢ Alert me</button>
              ${S.compare.length ? `<a class="btn sm" href="#/compare">Compare (${S.compare.length})</a>` : ''}
              <select id="sort" style="width:auto">
                <option value="featured">Sort: featured</option>
                <option value="price_asc">Price: low to high</option>
                <option value="price_desc">Price: high to low</option>
                <option value="year_desc">Newest year</option>
                <option value="mileage_asc">Lowest mileage</option>
                <option value="popular">Most viewed</option>
              </select>
            </div>
          </div>
          <section class="showcase" id="showcase" hidden aria-label="Stock showcase">
            <div id="scStage" aria-live="polite"></div>
            <button class="sc-arrow sc-prev" id="scPrev" aria-label="Previous car">‹</button>
            <button class="sc-arrow sc-next" id="scNext" aria-label="Next car">›</button>
            <div class="sc-dots" id="scDots"></div>
          </section>
          <div class="veh-grid" id="results"><div class="spinner"></div></div>
          <div class="row center mt-lg" id="pager" style="justify-content:center"></div>
        </div>
      </div>`;

    $('#sort').value = f.sort || 'featured';

    /* Filters refresh the results in place.
       The URL is kept in step with history.replaceState rather than by changing the hash:
       changing the hash would fire the router, which rebuilds the whole page — including
       the search box — and pulls the input out from under anyone still typing in it. */
    let currentPage = Number(f.page) || 1;

    const syncUrl = () => {
      const clean = { ...S.filters };
      if (currentPage > 1) clean.page = currentPage;
      const qs = new URLSearchParams(clean).toString();
      history.replaceState(null, '', '#/browse' + (qs ? '?' + qs : ''));
    };

    /* ---- showcase state ----
       The showcase is a way of LOOKING at the same result set, not a second source of
       truth. It renders whatever loadResults() last fetched, so every filter, the sort
       and the pager keep working untouched. The choice is remembered per browser. */
    let pageItems = [];
    let scIndex = 0;
    let scView = store.get('browseView', 'showcase');

    /**
     * Build every slide once and leave them stacked.
     *
     * The first version replaced innerHTML on each move, which cannot crossfade: there is
     * only ever one slide, so the outgoing car vanishes the instant the incoming one
     * appears. The reference keeps all the slides in the DOM and toggles a class, and
     * that is the whole reason its transition feels smooth. Same thing here.
     */
    function buildSlides() {
      const stage = $('#scStage');
      const dots = $('#scDots');
      if (!stage) return;
      if (!pageItems.length) {
        stage.innerHTML = `<div class="empty">Nothing matches those filters. <button class="btn sm mt" data-act="clear-filters">Clear filters</button></div>`;
        dots.innerHTML = '';
        return;
      }
      stage.innerHTML = pageItems.map((v, i) => showcaseSlide(v, i, pageItems.length)).join('');
      /* Only the first car is worth fetching eagerly; the other eleven are one click away
         and should not compete with it for bandwidth on a Kenyan mobile connection. */
      $$('.sc-slide', stage).forEach((el, i) => {
        const img = el.querySelector('.sc-shot');
        if (img && i !== 0) img.loading = 'lazy';
      });
      renderShowcase();
    }

    function renderShowcase() {
      const stage = $('#scStage');
      const dots = $('#scDots');
      if (!stage || !pageItems.length) return;
      scIndex = Math.max(0, Math.min(scIndex, pageItems.length - 1));
      const v = pageItems[scIndex];

      const slides = $$('.sc-slide', stage);
      slides.forEach((el, i) => {
        const on = i === scIndex;
        el.classList.toggle('on', on);
        el.setAttribute('aria-hidden', on ? 'false' : 'true');
        /* Off-stage slides must not be reachable by tab. They are still in the DOM and
           their links would otherwise take focus into a car nobody can see. */
        el.querySelectorAll('a, button').forEach((f) => {
          if (on) f.removeAttribute('tabindex');
          else f.setAttribute('tabindex', '-1');
        });
      });

      /* The car's own paint drives the primary button. Set on the showcase element, not
         on :root, so it can never leak into the rest of the page. Falls back to --brand
         when the paint name is one we do not have a hex for. */
      const paint = paintOf(v);
      const sc = $('#showcase');
      if (paint) {
        sc.style.setProperty('--car-accent', paint);
        sc.style.setProperty('--car-accent-ink', readableInk(paint));
      } else {
        sc.style.removeProperty('--car-accent');
        sc.style.removeProperty('--car-accent-ink');
      }

      fitGhost();

      dots.innerHTML = pageItems
        .map((it, i) => `<button class="sc-dot ${i === scIndex ? 'on' : ''}" data-sc="${i}" aria-label="Car ${i + 1} of ${pageItems.length}"${i === scIndex ? ' aria-current="true"' : ''}></button>`)
        .join('');
      $('#scPrev').disabled = scIndex === 0;
      $('#scNext').disabled = scIndex === pageItems.length - 1;
    }

    /**
     * Size the ghosted model name to the stage.
     *
     * It is set nowrap and enormous on purpose, so a CSS clamp cannot do this: "LAND
     * CRUISER" and "A3" want wildly different sizes, and the first attempt let the long
     * one run off both edges of the stage. Measure the text at a known size, then scale
     * to fill 94% of the width, capped so a two-letter model does not become a billboard.
     */
    function fitGhost() {
      const active = $('#scStage') && $('#scStage').querySelector('.sc-slide.on');
      const el = active && active.querySelector('.sc-model');
      const stage = $('#showcase');
      if (!el || !stage) return;
      const avail = stage.clientWidth - 96;
      if (avail <= 0) return;
      el.style.fontSize = '100px';
      const w = el.scrollWidth;
      if (!w) return;
      const size = Math.max(44, Math.min(190, (avail / w) * 100));
      el.style.fontSize = size.toFixed(1) + 'px';
    }

    /* Every slide, not only the visible one. A hidden slide still has a real width, and
       sizing it only when it appears would show one frame of the wrong size mid-fade. */
    function fitAllGhosts() {
      const stage = $('#scStage');
      if (!stage) return;
      const avail = $('#showcase').clientWidth - 96;
      if (avail <= 0) return;
      $$('.sc-model', stage).forEach((el) => {
        el.style.fontSize = '100px';
        const w = el.scrollWidth;
        if (!w) return;
        el.style.fontSize = Math.max(44, Math.min(190, (avail / w) * 100)).toFixed(1) + 'px';
      });
    }

    function applyView() {
      const showcase = scView === 'showcase';
      $('#showcase').hidden = !showcase;
      $('#results').hidden = showcase;
      $('#pager').hidden = showcase;

      /* A stage with a sidebar beside it is not a stage. In showcase mode the filters
         become a drawer and the stage takes the full width; in grid mode the sidebar is
         exactly what it was. Same filters either way, one button apart. */
      $('#browseSplit').classList.toggle('stage-mode', showcase);
      if (!showcase) closeDrawer();
      $('#filterBtn').hidden = !showcase;

      $$('#viewToggle .pill').forEach((b) => {
        const on = b.dataset.view === scView;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      store.set('browseView', scView);
      if (showcase) fitAllGhosts();
    }

    function closeDrawer() {
      const split = $('#browseSplit');
      if (split) split.classList.remove('drawer-open');
      const veil = $('#drawerVeil');
      if (veil) veil.remove();
      const btn = $('#filterBtn');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    }

    function openDrawer() {
      const split = $('#browseSplit');
      split.classList.add('drawer-open');
      $('#filterBtn').setAttribute('aria-expanded', 'true');
      if (!$('#drawerVeil')) {
        const veil = document.createElement('button');
        veil.id = 'drawerVeil';
        veil.className = 'drawer-veil';
        veil.setAttribute('aria-label', 'Close filters');
        veil.onclick = closeDrawer;
        document.body.appendChild(veil);
      }
      const first = $('#fq');
      if (first) first.focus();
    }

    async function loadResults() {
      const box = $('#results');
      box.style.opacity = '.45';
      const params = new URLSearchParams({ ...S.filters, page: currentPage, pageSize: 12 });
      let res;
      try {
        res = await GET('/api/vehicles?' + params.toString());
      } catch (err) {
        box.style.opacity = '1';
        box.innerHTML = `<div class="card err-text" style="grid-column:1/-1">${esc(err.message)}</div>`;
        return;
      }
      const filtered = Object.keys(S.filters).length > 0;
      $('#count').innerHTML =
        `<strong>${res.total}</strong> vehicle${res.total === 1 ? '' : 's'} ${filtered ? 'match your filters' : 'in stock'}`;
      box.innerHTML = res.items.length
        ? res.items.map(vehicleCard).join('')
        : `<div class="empty" style="grid-column:1/-1">Nothing matches those filters. <button class="btn sm mt" data-act="clear-filters">Clear filters</button></div>`;
      box.style.opacity = '1';
      pageItems = res.items;
      scIndex = 0;
      buildSlides();
      fitAllGhosts();
      $('#pager').innerHTML =
        res.pages > 1
          ? Array.from({ length: res.pages }, (_, i) => i + 1)
              .map((pn) => `<button class="pill ${pn === res.page ? 'on' : ''}" data-page="${pn}">${pn}</button>`)
              .join('')
          : '';
    }

    const applyFilters = (patch) => {
      Object.assign(S.filters, patch);
      Object.keys(S.filters).forEach((k) => {
        if (S.filters[k] === '' || S.filters[k] == null) delete S.filters[k];
      });
      delete S.filters.page;
      currentPage = 1;
      syncUrl();
      loadResults();
    };

    on($('#filters'), 'click', '[data-f]', (e, el) => {
      const key = el.dataset.f;
      const wasOn = S.filters[key] === el.dataset.v;
      // the sidebar is no longer rebuilt, so keep the pill state in step by hand
      $$(`[data-f="${key}"]`, $('#filters')).forEach((pill) => pill.classList.remove('on'));
      if (!wasOn) el.classList.add('on');
      applyFilters({ [key]: wasOn ? '' : el.dataset.v });
    });

    $('#clearF').onclick = () => {
      S.filters = {};
      currentPage = 1;
      $$('#filters input').forEach((i) => (i.value = ''));
      $$('#filters .pill.on').forEach((pill) => pill.classList.remove('on'));
      $('#fMake').value = '';
      syncUrl();
      loadResults();
      $('#fq').focus();
    };

    $('#fMake').onchange = (e) => applyFilters({ make: e.target.value });
    $('#sort').onchange = (e) => applyFilters({ sort: e.target.value });

    const deb = debounce((patch) => applyFilters(patch), 320);
    $('#fq').oninput = (e) => deb({ q: e.target.value });
    $('#fMin').oninput = (e) => deb({ minPrice: e.target.value });
    $('#fMax').oninput = (e) => deb({ maxPrice: e.target.value });
    $('#fYear').oninput = (e) => deb({ minYear: e.target.value });
    $('#fKm').oninput = (e) => deb({ maxMileage: e.target.value });
    $('#fMonthly').oninput = (e) => deb({ maxMonthly: e.target.value });
    // Enter searches immediately instead of waiting out the debounce
    $('#fq').onkeydown = (e) => {
      if (e.key === 'Enter') applyFilters({ q: e.target.value });
    };

    on($('#pager'), 'click', '[data-page]', (e, el) => {
      currentPage = Number(el.dataset.page);
      syncUrl();
      loadResults();
      window.scrollTo(0, 0);
    });

    /* ---- showcase navigation ---- */
    const scGo = (n) => {
      scIndex = n;
      renderShowcase();
    };
    $('#scPrev').onclick = () => scGo(scIndex - 1);
    $('#scNext').onclick = () => scGo(scIndex + 1);
    on($('#scDots'), 'click', '[data-sc]', (e, el) => scGo(Number(el.dataset.sc)));

    on($('#viewToggle'), 'click', '[data-view]', (e, el) => {
      scView = el.dataset.view;
      applyView();
    });

    $('#filterBtn').onclick = () => {
      const open = $('#browseSplit').classList.contains('drawer-open');
      if (open) closeDrawer();
      else openDrawer();
    };

    /* The ghost is sized from a measurement, so it has to be re-measured when the stage
       changes width. Debounced: this fires on every pixel of a window drag. */
    const onResize = debounce(() => {
      if (!document.getElementById('showcase')) {
        window.removeEventListener('resize', onResize);
        return;
      }
      if (scView === 'showcase') fitAllGhosts();
    }, 140);
    window.addEventListener('resize', onResize);

    /* Arrow keys move between cars, but only when the showcase is the visible view and
       the customer is not typing in a filter — otherwise left/right would fight the
       caret in the search box. */
    const scKeys = (e) => {
      /* The router rebuilds this page on every navigation, so without this the old
         listener would survive, hold a stale closure, and move a slider that is no
         longer on screen. Unbinding on the first keypress after the node is gone is
         simpler than tracking teardown across every route. */
      if (!document.getElementById('showcase')) {
        document.removeEventListener('keydown', scKeys);
        return;
      }
      if (scView !== 'showcase') return;
      const t = e.target;
      if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      if (t && t.isContentEditable) return;
      if (e.key === 'ArrowLeft' && scIndex > 0) scGo(scIndex - 1);
      else if (e.key === 'ArrowRight' && scIndex < pageItems.length - 1) scGo(scIndex + 1);
    };
    document.addEventListener('keydown', scKeys);

    /* Swipe. Bound to the stage rather than the document so it cannot hijack a scroll
       elsewhere on the page, and it ignores mostly-vertical drags for the same reason. */
    let tx = 0;
    let ty = 0;
    const stageEl = $('#showcase');
    stageEl.addEventListener('touchstart', (e) => {
      tx = e.touches[0].clientX;
      ty = e.touches[0].clientY;
    }, { passive: true });
    stageEl.addEventListener('touchend', (e) => {
      const dx = tx - e.changedTouches[0].clientX;
      const dy = ty - e.changedTouches[0].clientY;
      if (Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy)) return;
      if (dx > 0 && scIndex < pageItems.length - 1) scGo(scIndex + 1);
      else if (dx < 0 && scIndex > 0) scGo(scIndex - 1);
    }, { passive: true });

    applyView();
    await loadResults();
  }

  /* ---------------- vehicle detail ---------------- */

  async function pageVehicle(id) {
    view.innerHTML = '<div class="spinner"></div>';
    const { vehicle: v, similar, priceCheck, futureValue, history, promise } = await GET(`/api/vehicles/${id}`);
    const monthly = estimateMonthly(v.price);
    const shots = v.images && v.images.length ? v.images : [vehImg(v)];
    view.innerHTML = `
      <nav class="crumbs mt"><a href="#/">Home</a> <span>›</span> <a href="#/browse">Inventory</a> <span>›</span> <b>${esc(v.title)}</b></nav>
      <div class="split-r mt">
        <div>
          <div class="gallery">
            <div class="main">
              <img id="gMain" src="${esc(shots[0])}" alt="${esc(v.title)}">
              ${shots.length > 1 ? '<button class="gnav prev" id="gPrev" aria-label="Previous photo">‹</button><button class="gnav next" id="gNext" aria-label="Next photo">›</button>' : ''}
              <div class="gcount"><span id="gIdx">1</span> / ${shots.length}</div>
              <div class="flags">
                ${v.featured ? '<span class="tag warn">Featured</span>' : ''}
                ${v.reg_status && v.reg_status !== 'registered' ? `<span class="tag ${REG_TONE[v.reg_status]}">${esc(REG_LABEL[v.reg_status])}</span>` : ''}
              </div>
            </div>
            ${shots.length > 1 ? `<div class="thumbs" id="gThumbs" data-lenis-prevent>${shots.map((s, i) => `<button class="th ${i === 0 ? 'on' : ''}" data-shot="${i}"><img src="${esc(s)}" alt=""></button>`).join('')}</div>` : ''}
          </div>
          <h1 class="mt">${esc(v.title)}</h1>
          <div class="row wrap-r" style="gap:6px">
            <span class="tag ${v.status === 'available' ? 'ok' : 'err'}">${esc(titleCase(v.status))}</span>
            <span class="tag">${esc(CONDITION_LABEL[v.condition] || v.condition)}</span>
            ${v.verified ? '<span class="tag info">✓ Inspected &amp; verified</span>' : ''}
            ${v.duty_paid ? '<span class="tag">Duty paid</span>' : '<span class="tag warn">Duty not paid</span>'}
            ${v.warranty_months ? `<span class="tag">${v.warranty_months}-month warranty</span>` : ''}
            <span class="tag">${num(v.views)} views</span>
          </div>
          ${specStrip(v.specs)}
          <div class="dim mt" style="font-size:.82rem">
            Listed by ${esc(v.dealer_name)} on ${dateFmt(v.created_at)}${v.source_ref ? ` · import ref ${esc(v.source_ref)}` : ''}
          </div>
          <p class="muted mt">${esc(v.description || '')}</p>

          ${
            v.reg_status && v.reg_status !== 'registered'
              ? `<div class="panel mt" style="border-color:var(--warn)">
                  <div class="lbl">Registration</div>
                  <div class="row between wrap-r">
                    <div>
                      <b>${esc(REG_LABEL[v.reg_status])}</b>
                      <div class="muted" style="font-size:.86rem">This unit is a direct import and is still going through its Kenyan registration. You can reserve it now and take delivery on plates.</div>
                    </div>
                    ${v.reg_expected_date ? `<div style="text-align:right"><div class="dim" style="font-size:.72rem;text-transform:uppercase;letter-spacing:.06em">Expected</div><b>${dateFmt(v.reg_expected_date)}</b></div>` : ''}
                  </div>
                </div>`
              : ''
          }

          ${promiseStrip(promise)}

          ${specSheetHtml(v, v.specs)}

          ${scorecard(v.specs && v.specs.inspection)}

          ${historyBlock(history)}

          ${
            v.features && v.features.length
              ? `<h3 class="mt-lg">Features</h3><div class="spec-chips">${v.features.map((f) => `<span>${esc(f)}</span>`).join('')}</div>`
              : ''
          }

          ${similar.length ? `<h3 class="mt-lg">Similar in this yard</h3><div class="veh-grid">${similar.map(vehicleCard).join('')}</div>` : ''}
        </div>

        <aside class="sticky stack">
          <div class="card">
            <div class="dim" style="font-size:.78rem;text-transform:uppercase;letter-spacing:.07em">Cash price</div>
            <div style="font-size:2rem;font-weight:750;letter-spacing:-.03em">${KES(v.price)}</div>
            ${v.old_price && v.old_price > v.price ? `<div class="dim"><s>${KES(v.old_price)}</s> — save ${KES(v.old_price - v.price)}</div>` : ''}
            ${v.negotiable ? '<div class="tag mt">• Price negotiable</div>' : ''}
            ${priceBadge(priceCheck)}
            <hr>
            <div class="dim" style="font-size:.78rem;text-transform:uppercase;letter-spacing:.07em">Or finance from</div>
            <div style="font-size:1.5rem;font-weight:750">${KES(monthly)}<span class="muted" style="font-size:.9rem;font-weight:500"> / month</span></div>
            <a class="btn primary block lg mt" href="#/finance/${v.id}">Compare ${S.boot.lenders.length} financing options</a>
            ${v.status === 'available' ? `<a class="btn ok block lg mt" href="#/reserve/${v.id}">Reserve it online</a>` : ''}
            <a class="btn wa block lg mt" href="${esc(waVehicle(v))}" target="_blank" rel="noopener">Inquire on WhatsApp</a>
            <div class="row mt" style="gap:8px">
              <button class="btn grow" data-lead="enquiry" data-veh="${v.id}">Send inquiry</button>
              <button class="btn" data-save="${v.id}" title="Save">${S.saved.includes(v.id) ? '♥' : '♡'}</button>
              <button class="btn" data-share="${v.id}" title="Share this listing">↗</button>
            </div>
            <div class="row mt" style="gap:8px">
              <button class="btn ghost grow" data-book="${v.id}">Book a test drive</button>
              <button class="btn ghost grow" data-lead="callback" data-veh="${v.id}">Call me back</button>
            </div>
            <a class="btn ghost block mt" href="#/financing/running?vehicle=${v.id}">What will it really cost to run?</a>
          </div>
          ${
            futureValue
              ? `<div class="card">
                  <div class="lbl">What it should still be worth</div>
                  <div style="font-size:1.6rem;font-weight:750;letter-spacing:-.03em">${KES(futureValue.guaranteedFloor)}</div>
                  <div class="muted" style="font-size:.86rem">in ${futureValue.years} years — about ${futureValue.percentOfToday}% of today's price</div>
                  <div class="row between mt" style="font-size:.84rem">
                    <span class="dim">Losing roughly</span><b>${KES(futureValue.monthlyDepreciation)} / month</b>
                  </div>
                  ${futureValue.strongHolder ? '<div class="tag ok mt">Holds its value well in Kenya</div>' : ''}
                  <p class="dim mt" style="font-size:.78rem">${esc(futureValue.note)}</p>
                </div>`
              : ''
          }
          <div class="card">
            <strong>${esc(v.dealer_name)}</strong>
            <div class="muted" style="font-size:.86rem">${esc(v.branch_name || '')}${v.branch_address ? ' · ' + esc(v.branch_address) : ''}</div>
            <div class="muted" style="font-size:.86rem;margin-top:6px">${esc(v.dealer_phone || '')}</div>
          </div>
        </aside>
      </div>

      <!-- Thumb-reach actions on a phone. Hidden on desktop, where the sticky sidebar
           already carries them. -->
      <nav class="sticky-actions" aria-label="Quick actions">
        ${v.dealer_phone ? `<a href="tel:${esc(String(v.dealer_phone).replace(/\s/g, ''))}">Call</a>` : ''}
        <a href="${esc(waVehicle(v))}" target="_blank" rel="noopener">WhatsApp</a>
        <a class="primary" href="#/finance/${v.id}">Finance</a>
      </nav>`;

    // gallery
    let idx = 0;
    const show = (n) => {
      idx = (n + shots.length) % shots.length;
      $('#gMain').src = shots[idx];
      $('#gIdx').textContent = idx + 1;
      $$('#gThumbs .th').forEach((t, i) => t.classList.toggle('on', i === idx));
    };
    if (shots.length > 1) {
      $('#gPrev').onclick = () => show(idx - 1);
      $('#gNext').onclick = () => show(idx + 1);
      on($('#gThumbs'), 'click', '[data-shot]', (e, el) => show(Number(el.dataset.shot)));
    }
  }

  on(document, 'click', '[data-share]', async (e, el) => {
    const url = location.origin + `/#/vehicle/${el.dataset.share}`;
    try {
      if (navigator.share) await navigator.share({ title: document.title, url });
      else {
        await navigator.clipboard.writeText(url);
        toast('Link copied to your clipboard', 'ok');
      }
    } catch {
      modal('Share this listing', `<div class="field"><label>Link</label><input type="text" value="${esc(url)}" data-act="select-all"></div>`);
    }
  });

  /* ---------------- the finance comparison screen ---------------- */

  async function pageFinance(id) {
    view.innerHTML = '<div class="spinner"></div>';
    const { vehicle: v } = await GET(`/api/vehicles/${id}`);
    const p = S.profile;
    const saved = store.get('finance:' + id, null);
    const bounds = panelBounds();
    const state = saved || { depositPct: 20, tenor: 48, sortBy: 'monthly', types: [] };
    /* A setting saved before the panel changed can sit outside what any lender now
       accepts. Pull it back inside rather than showing a quote nobody would honour. */
    state.depositPct = Math.max(bounds.minDeposit, Math.min(70, state.depositPct));
    state.tenor = Math.max(bounds.minTenor, Math.min(bounds.maxTenor, state.tenor));

    view.innerHTML = `
      <div class="row wrap-r mt"><a href="#/vehicle/${id}" class="dim">← ${esc(v.title)}</a></div>
      <h1 class="mt">Compare your financing</h1>
      <p class="muted">Every lender on ${esc(S.dealer.name)}'s panel, quoted on this exact car. Ineligible lenders are shown too, with the reason.</p>

      <div class="split-r mt">
        <div>
          <div class="card mb">
            <div class="row between wrap-r">
              <div class="row" style="gap:12px">
                <img src="${esc(vehImg(v))}" style="width:104px;border-radius:10px" alt="">
                <div>
                  <div style="font-weight:650">${esc(v.title)}</div>
                  <div class="muted" style="font-size:.85rem">${esc(CONDITION_LABEL[v.condition])} · ${num(v.mileage_km)} km</div>
                  <div style="font-size:1.2rem;font-weight:700;margin-top:4px">${KES(v.price)}</div>
                </div>
              </div>
              <div class="row">
                <label class="lbl" style="margin:0">Rank by</label>
                <select id="sortBy" style="width:auto">
                  <option value="monthly">Lowest monthly payment</option>
                  <option value="total">Cheapest overall</option>
                  <option value="deposit">Least cash upfront</option>
                  <option value="rate">Lowest true APR</option>
                  <option value="speed">Fastest approval</option>
                </select>
              </div>
            </div>
          </div>

          <div id="offers"><div class="spinner"></div></div>
        </div>

        <aside class="sticky">
          <div class="card">
            <h3>Your deal</h3>
            <label class="lbl">Deposit — <span id="depLabel"></span></label>
            <input type="range" id="dep" min="${bounds.minDeposit}" max="70" step="5" value="${Math.max(bounds.minDeposit, state.depositPct)}">
            <div class="row between dim" style="font-size:.75rem"><span>${bounds.minDeposit}%</span><span>70%</span></div>
            <small class="dim">${bounds.minDeposit}% is the least any lender on our panel will accept.</small>

            <label class="lbl mt">Repayment period — <span id="tenLabel"></span></label>
            <input type="range" id="ten" min="${bounds.minTenor}" max="${bounds.maxTenor}" step="6" value="${Math.min(bounds.maxTenor, state.tenor)}">
            <div class="row between dim" style="font-size:.75rem"><span>${bounds.minTenor} mo</span><span>${bounds.maxTenor} mo</span></div>
            <small class="dim">${bounds.maxTenor} months is the longest term on the panel.</small>

            <hr>
            <h3>About you</h3>
            <p class="dim" style="font-size:.8rem;margin-top:-4px">Used only to check which lenders would approve you. Nothing is submitted until you apply.</p>
            <div class="field"><label>Net monthly income (KES)</label><input type="number" id="inc" value="${esc(p.netIncome)}" placeholder="e.g. 120000"></div>
            <div class="field"><label>Existing loan repayments (KES)</label><input type="number" id="obl" value="${esc(p.obligations)}" placeholder="e.g. 15000"></div>
            <div class="field"><label>How you earn</label>
              <select id="emp">${Object.entries(EMPLOYMENT_LABEL).map(([k, l]) => `<option value="${k}" ${p.employment === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
            </div>
            <div class="field"><label>Your age</label><input type="number" id="age" value="${esc(p.age)}" placeholder="e.g. 34" min="18" max="80"></div>
            <label class="check"><input type="checkbox" id="crb" ${p.crbClean ? 'checked' : ''}><span>My CRB record is clean</span></label>

            <hr>
            <h3>Have a car to trade in?</h3>
            <p class="dim" style="font-size:.8rem;margin-top:-4px">Most people's deposit is the car already on their driveway.
            Value it here and it goes straight into the deposit above.</p>
            <div class="grid-2">
              <div class="field"><label>Year</label><input type="number" id="tiYear" placeholder="2015" min="1980" max="${new Date().getFullYear()}"></div>
              <div class="field"><label>Mileage (km)</label><input type="number" id="tiKm" placeholder="120000"></div>
            </div>
            <div class="field"><label>What it would sell for today (KES)</label><input type="number" id="tiPrice" placeholder="e.g. 900000"></div>
            <div class="field"><label>Condition</label>
              <select id="tiCond">
                ${[['excellent', 'Excellent'], ['good', 'Good'], ['fair', 'Fair'], ['poor', 'Needs work']]
                  .map((c) => `<option value="${c[0]}" ${c[0] === 'good' ? 'selected' : ''}>${c[1]}</option>`)
                  .join('')}
              </select>
            </div>
            <button class="btn block" id="tiGo">Value my car</button>
            <div id="tiOut" class="mt"></div>

            <label class="lbl mt">Lender type</label>
            <div class="pills" id="types">
              ${Object.entries(LENDER_TYPE_LABEL).map(([k, l]) => `<button class="pill ${state.types.includes(k) ? 'on' : ''}" data-type="${k}">${l}</button>`).join('')}
            </div>
          </div>
        </aside>
      </div>`;

    const els = {
      dep: $('#dep'),
      ten: $('#ten'),
      inc: $('#inc'),
      obl: $('#obl'),
      emp: $('#emp'),
      age: $('#age'),
      crb: $('#crb'),
      sortBy: $('#sortBy'),
    };
    els.sortBy.value = state.sortBy;

    const readState = () => ({
      depositPct: Number(els.dep.value),
      tenor: Number(els.ten.value),
      sortBy: els.sortBy.value,
      types: $$('#types .pill.on').map((b) => b.dataset.type),
    });

    const refresh = debounce(async () => {
      const st = readState();
      store.set('finance:' + id, st);
      S.profile = {
        netIncome: els.inc.value,
        obligations: els.obl.value,
        employment: els.emp.value,
        crbClean: els.crb.checked,
        age: els.age.value,
      };
      store.set('profile', S.profile);
      $('#depLabel').innerHTML = `<b>${st.depositPct}%</b> · ${KES((v.price * st.depositPct) / 100)}`;
      $('#tenLabel').innerHTML = `<b>${st.tenor}</b> months`;
      const box = $('#offers');
      box.style.opacity = '.55';
      try {
        const res = await POST('/api/quote', {
                    vehicleId: v.id,
          depositPct: st.depositPct,
          tenor: st.tenor,
          sortBy: st.sortBy,
          lenderTypes: st.types,
          applicant: {
            netIncome: Number(els.inc.value) || 0,
            obligations: Number(els.obl.value) || 0,
            employment: els.emp.value,
            crbClean: els.crb.checked,
            age: Number(els.age.value) || 0,
          },
        });
        renderOffers(box, res, v);
      } catch (e) {
        box.innerHTML = `<div class="card err-text">${esc(e.message)}</div>`;
      }
      box.style.opacity = '1';
    }, 200);

    ['input', 'change'].forEach((ev) => {
      [els.dep, els.ten, els.inc, els.obl, els.emp, els.age, els.crb, els.sortBy].forEach((el) => el.addEventListener(ev, refresh));
    });

    /* Trade-in straight into the deposit.
       The estimator existed but lived on its own page, so its answer never reached the
       number it was actually about. Most Kenyan buyers have a car, and its value IS the
       deposit they are worried about raising. */
    $('#tiGo').onclick = async () => {
      const out = $('#tiOut');
      const btn = $('#tiGo');
      const price = Number($('#tiPrice').value);
      const year = Number($('#tiYear').value);
      if (!year || !price) return toast('Year and an indicative price are both needed', 'err');
      btn.disabled = true;
      out.innerHTML = '<div class="spinner"></div>';
      try {
        const r = await POST('/api/tradein/estimate', {
          year,
          mileage: Number($('#tiKm').value) || 0,
          estimatedNewPrice: price,
          condition: $('#tiCond').value,
        });
        /* The estimator returns a range. Take the LOW end into the deposit: a customer
           who plans around the top of a range and is then offered the bottom has been
           misled by our own tool. */
        const value = r.low;
        // The deposit slider is a percentage of THIS car, so express the part-exchange
        // in the same units and let the customer add cash on top by dragging further.
        const pct = Math.min(70, Math.round((value / v.price) * 100 / 5) * 5);
        out.innerHTML = `<div class="panel" style="border-left:3px solid var(--brand)">
          <div class="lbl" style="margin:0">We would allow</div>
          <div style="font-size:1.5rem;font-weight:750;letter-spacing:-.03em">${KES(r.low)} – ${KES(r.high)}</div>
          <div class="muted" style="font-size:.84rem">Using the lower figure, that covers a ${pct}% deposit on this car.</div>
          <button class="btn primary block mt" id="tiApply">Put ${pct}% down with this car</button>
          <div class="dim" style="font-size:.76rem;margin-top:6px">
            Adding cash on top? Drag the deposit slider higher afterwards — every extra shilling comes off the instalment.
            This is an indication from year, mileage and condition; we confirm it once we have seen the car.
          </div>
        </div>`;
        $('#tiApply').onclick = () => {
          const had = Number(els.dep.value) || 0;
          els.dep.value = String(pct);
          els.dep.dispatchEvent(new Event('input', { bubbles: true }));
          /* Say it plainly when the trade-in is worth less than the deposit they already
             had set, rather than quietly making their quote worse. */
          toast(
            pct < had
              ? `Deposit now ${pct}% — your car alone. It was ${had}%, so drag it back up if you are adding cash.`
              : `Deposit set to ${pct}% — ${KES(Math.round((v.price * pct) / 100))}`,
            pct < had ? 'warn' : 'ok'
          );
          els.dep.scrollIntoView({ block: 'center', behavior: 'smooth' });
        };
      } catch (e) {
        out.innerHTML = `<div class="err-text">${esc(e.message)}</div>`;
      }
      btn.disabled = false;
    };
    on($('#types'), 'click', '[data-type]', (e, el) => {
      el.classList.toggle('on');
      refresh();
    });
    refresh();
  }

  function renderOffers(box, res, v) {
    const offers = res.offers || [];
    const eligible = offers.filter((o) => o.eligible);
    box.innerHTML = `
      <div class="row between wrap-r mb">
        <div><strong>${eligible.length}</strong> of ${offers.length} lenders would consider this deal</div>
        ${eligible.length ? `<div class="muted">Cheapest: <b>${KES(Math.min(...eligible.map((o) => o.monthlyPayment)))}</b>/month</div>` : ''}
      </div>
      <div class="stack">${offers.map((o, i) => offerCard(o, i === 0 && o.eligible, v)).join('')}</div>
      ${
        !eligible.length
          ? `<div class="card mt" style="border-color:var(--warn)">
              <h3>No lender fits yet</h3>
              <p class="muted">Try a bigger deposit, a longer term, or a cheaper car. The reasons on each card tell you exactly which rule you are hitting.</p>
              <a class="btn mt" href="#/afford">Work out my budget</a>
            </div>`
          : ''
      }`;
  }

  function offerCard(o, isBest, v) {
    const l = o.lender;
    return `<article class="offer ${o.eligible ? '' : 'blocked'} ${isBest ? 'best' : ''}" style="--lender:${esc(l.color || '#334')}">
      <div class="head">
        <div class="badge-lender" style="background:${esc(l.color || '#334')}">${esc(l.logo_text || '?')}</div>
        <div>
          <div style="font-weight:650">${esc(l.name)}</div>
          <div class="dim" style="font-size:.8rem">${esc(LENDER_TYPE_LABEL[l.type] || l.type)} · ${o.annualRate}% ${o.rateType === 'flat' ? 'flat rate' : 'reducing balance'} · approval in ${l.approval_days} day${l.approval_days === 1 ? '' : 's'}</div>
          <div class="badges">
            ${(o.badges || []).map((b) => `<span class="tag ok">${esc(b)}</span>`).join('')}
            ${o.eligible ? '' : '<span class="tag err">Not eligible on these terms</span>'}
          </div>
        </div>
        <div class="pay">
          <span class="dim" style="font-size:.72rem;text-transform:uppercase;letter-spacing:.06em">Monthly</span>
          <b>${KES(o.monthlyPayment)}</b>
          <span class="dim" style="font-size:.78rem">${o.tenorMonths} months</span>
        </div>
      </div>

      <div class="facts">
        <div><span>Deposit</span><b>${KES(o.deposit)}</b><small class="dim">${o.depositPct}%</small></div>
        <div><span>Cash on day one</span><b>${KES(o.cashUpfront)}</b><small class="dim">incl. fees</small></div>
        <div><span>True APR</span><b>${o.apr}%</b><small class="dim">all-in cost</small></div>
        <div><span>Total you pay</span><b>${KESK(o.totalCost)}</b><small class="dim">over ${o.tenorMonths} mo</small></div>
      </div>

      ${
        o.blockers.length
          ? `<ul class="why err-text" style="padding-left:18px;margin:12px 0 0">${o.blockers.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`
          : ''
      }
      ${
        o.warnings.length
          ? `<ul class="why" style="padding-left:18px;margin:8px 0 0;color:#fcd34d">${o.warnings.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`
          : ''
      }

      <div class="row mt" style="gap:8px">
        <button class="btn sm" data-detail='${esc(JSON.stringify({ lenderId: o.lenderId, vehicleId: v.id, deposit: o.deposit, tenor: o.tenorMonths }))}'>Full breakdown</button>
        <a class="btn sm ${o.eligible ? 'primary' : ''} ${o.eligible ? '' : 'ghost'}" href="#/apply/${v.id}/${o.lenderId}?deposit=${o.deposit}&tenor=${o.tenorMonths}">
          ${o.eligible ? 'Apply with ' + esc(l.short_name || l.name) : 'Apply anyway'}
        </a>
      </div>
    </article>`;
  }

  on(document, 'click', '[data-detail]', async (e, el) => {
    const args = JSON.parse(el.dataset.detail);
    const m = modal('Full cost breakdown', '<div class="spinner"></div>', { wide: true });
    const res = await POST('/api/quote/schedule', { ...args });
    const q = res.quote;
    m.body.innerHTML = `
      <div class="row between wrap-r mb">
        <div class="row" style="gap:12px">
          <div class="badge-lender" style="background:${esc(q.lender.color)};width:46px;height:46px;border-radius:11px;display:grid;place-items:center;font-weight:800;color:#fff">${esc(q.lender.logo_text)}</div>
          <div><div style="font-weight:650">${esc(q.lender.name)}</div>
          <div class="dim" style="font-size:.82rem">${q.annualRate}% ${q.rateType} balance over ${q.tenorMonths} months</div></div>
        </div>
        <div style="text-align:right"><div class="dim" style="font-size:.75rem">MONTHLY</div><div style="font-size:1.5rem;font-weight:750">${KES(q.monthlyPayment)}</div></div>
      </div>

      <div class="grid-2">
        <div>
          <h4>What you pay upfront</h4>
          <table class="tbl">
            <tr><td>Deposit (${q.depositPct}%)</td><td class="num">${KES(q.deposit)}</td></tr>
            ${q.fees.map((f) => `<tr><td>${esc(f.label)}${q.feesCapitalised ? ' <span class="tag info">financed</span>' : ''}</td><td class="num">${KES(f.amount)}</td></tr>`).join('')}
            ${q.insurance ? `<tr><td>Comprehensive insurance, year 1${q.insuranceFinanced ? ' <span class="tag info">financed</span>' : ''}</td><td class="num">${KES(q.insurance)}</td></tr>` : ''}
            <tr style="font-weight:700"><td>Cash needed on day one</td><td class="num">${KES(q.cashUpfront)}</td></tr>
          </table>

          <h4 class="mt">The loan</h4>
          <table class="tbl">
            <tr><td>Vehicle price</td><td class="num">${KES(q.price)}</td></tr>
            <tr><td>Less deposit</td><td class="num">− ${KES(q.deposit)}</td></tr>
            <tr><td>Amount financed</td><td class="num">${KES(q.principal)}</td></tr>
            <tr><td>Interest over the term</td><td class="num">${KES(q.totalInterest)}</td></tr>
            <tr><td>Total of ${q.tenorMonths} instalments</td><td class="num">${KES(q.totalRepaid)}</td></tr>
            <tr style="font-weight:700"><td>Total cost of the car</td><td class="num">${KES(q.totalCost)}</td></tr>
            <tr><td>True annual cost (APR)</td><td class="num">${q.apr}%</td></tr>
          </table>
        </div>
        <div>
          <h4>What this lender needs from you</h4>
          <ul class="muted" style="padding-left:18px">${(q.lender.requirements || []).map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
          ${q.notes.length ? `<h4 class="mt">Terms</h4><ul class="muted" style="padding-left:18px">${q.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
          ${q.lender.notes ? `<div class="panel mt"><small>${esc(q.lender.notes)}</small></div>` : ''}
        </div>
      </div>

      <h4 class="mt-lg">Repayment schedule</h4>
      <div class="scroll-x" data-lenis-prevent style="max-height:320px;overflow-y:auto">
        <table class="tbl">
          <thead><tr><th>#</th><th class="num">Payment</th><th class="num">Interest</th><th class="num">Principal</th><th class="num">Balance</th></tr></thead>
          <tbody>${res.schedule.map((r) => `<tr><td>${r.n}</td><td class="num">${num(r.payment)}</td><td class="num">${num(r.interest)}</td><td class="num">${num(r.principal)}</td><td class="num">${num(r.balance)}</td></tr>`).join('')}</tbody>
        </table>
      </div>
      <div class="row mt" style="justify-content:flex-end">
        <a class="btn primary" href="#/apply/${args.vehicleId}/${args.lenderId}?deposit=${q.deposit}&tenor=${q.tenorMonths}" data-close>Apply with this lender</a>
      </div>`;
  });

  /* ---------------- application flow ---------------- */

  const APPLY_STEPS = ['Your details', 'Income', 'Documents', 'Review'];
  let applyState = null;

  async function pageApply(vehicleId, lenderId, query) {
    view.innerHTML = '<div class="spinner"></div>';
    const { vehicle: v } = await GET(`/api/vehicles/${vehicleId}`);
    const p = S.profile;
    if (!applyState || applyState.vehicleId !== Number(vehicleId) || applyState.lenderId !== Number(lenderId)) {
      applyState = {
        vehicleId: Number(vehicleId),
        lenderId: Number(lenderId),
        deposit: Number(query.deposit) || Math.round(v.price * 0.2),
        tenor: Number(query.tenor) || 48,
        step: 0,
        applicant: { fullName: S.user ? S.user.name : '', email: S.user ? S.user.email : '', phone: '', idNumber: '', kraPin: '', dob: '', address: '', maritalStatus: 'single', age: p.age },
        employment: { type: p.employment, employer: '', position: '', yearsEmployed: '', netIncome: p.netIncome, obligations: p.obligations, crbClean: p.crbClean },
        documents: [],
      };
    }
    renderApply(v);
  }

  async function renderApply(v) {
    const a = applyState;
    const lender = S.boot.lenders.find((l) => l.id === a.lenderId);
    const quote = await POST('/api/quote', {
            vehicleId: a.vehicleId,
      deposit: a.deposit,
      tenor: a.tenor,
      lenderIds: [a.lenderId],
      applicant: {
        netIncome: Number(a.employment.netIncome) || 0,
        obligations: Number(a.employment.obligations) || 0,
        employment: a.employment.type,
        crbClean: a.employment.crbClean,
        /* Worked out from the date of birth, which is the only place it is asked for now.
           Falls back to a stored age so a quote started before this change still prices. */
        age: ageFromDob(a.applicant.dob) || Number(a.applicant.age) || 0,
      },
    });
    const offer = quote.offers[0];

    view.innerHTML = `
      <h1 class="mt">Apply for financing</h1>
      <div class="steps">${APPLY_STEPS.map((s, i) => `<div class="s ${i === a.step ? 'on' : i < a.step ? 'done' : ''}"><b>Step ${i + 1}</b>${s}</div>`).join('')}</div>
      <div class="split-r">
        <div class="card" id="stepBody"></div>
        <aside class="sticky card">
          <div class="row" style="gap:10px">
            <img src="${esc(vehImg(v))}" style="width:88px;border-radius:9px" alt="">
            <div><div style="font-weight:650;font-size:.92rem">${esc(v.title)}</div><div class="muted" style="font-size:.84rem">${KES(v.price)}</div></div>
          </div>
          <hr>
          <div class="row" style="gap:10px">
            <div class="badge-lender" style="background:${esc(lender.color)};width:38px;height:38px;border-radius:9px;display:grid;place-items:center;font-weight:800;color:#fff;font-size:.8rem">${esc(lender.logo_text)}</div>
            <div><div style="font-weight:600;font-size:.9rem">${esc(lender.short_name || lender.name)}</div><div class="dim" style="font-size:.78rem">${esc(LENDER_TYPE_LABEL[lender.type])}</div></div>
          </div>
          <table class="tbl mt">
            <tr><td>Deposit</td><td class="num">${KES(offer.deposit)}</td></tr>
            <tr><td>Financed</td><td class="num">${KES(offer.principal)}</td></tr>
            <tr><td>Term</td><td class="num">${offer.tenorMonths} mo</td></tr>
            <tr style="font-weight:700"><td>Monthly</td><td class="num">${KES(offer.monthlyPayment)}</td></tr>
            <tr><td>APR</td><td class="num">${offer.apr}%</td></tr>
          </table>
          ${offer.eligible ? '<div class="tag ok mt">Meets this lender\'s published criteria</div>' : `<div class="tag warn mt">Outside criteria — will need review</div>`}
          <a class="btn ghost block mt" href="#/finance/${a.vehicleId}">← Change lender or terms</a>
        </aside>
      </div>`;

    const body = $('#stepBody');
    if (a.step === 0) stepDetails(body, v);
    else if (a.step === 1) stepIncome(body, v, lender);
    else if (a.step === 2) stepDocs(body, v, lender);
    else stepReview(body, v, lender, offer);
  }

  /**
   * The same rules the server enforces, checked as the customer types.
   *
   * Finding out your KRA PIN is wrong at the end of a five-step credit application, after
   * uploading documents, is the worst possible moment to hear it. These mirror `sec.V.*`
   * in lib/security.js — if you change one, change both.
   */
  const FIELD_RULES = {
    kraPin: (s) => (!s || /^[A-Za-z]\d{9}[A-Za-z]$/.test(s.trim()) ? null : 'A KRA PIN looks like A012345678Z — one letter, nine digits, one letter'),
    idNumber: (s) => (!s || /^[A-Za-z0-9]{6,15}$/.test(s.trim()) ? null : 'An ID number is 6 to 15 letters or digits, no spaces'),
    phone: (s) => (!s || /^(?:\+?254|0)?[17]\d{8}$/.test(s.replace(/[\s-]/g, '')) ? null : 'Enter a Kenyan number, e.g. 0712 345 678'),
    email: (s) => (!s || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim()) ? null : 'That email address is not valid'),
    age: (s) => {
      if (!s) return null;
      const n = Number(s);
      if (!Number.isFinite(n) || n < 18) return 'You must be at least 18 to take vehicle finance';
      if (n > 80) return 'Enter your age in years';
      return null;
    },
    dob: (s) => {
      if (!s) return null;
      const years = ageFromDob(s);
      if (years === null) return 'That is not a valid date';
      if (years < 18) return 'You must be at least 18 to take vehicle finance';
      if (years > 90) return 'Please check that date of birth';
      return null;
    },
  };

  /** Whole years between a date of birth and today. Null if the date is unusable. */
  function ageFromDob(dob) {
    if (!dob) return null;
    const d = new Date(dob + 'T12:00:00');
    if (isNaN(d.getTime()) || d > new Date()) return null;
    const now = new Date();
    let years = now.getFullYear() - d.getFullYear();
    // Not had this year's birthday yet? Then you are a year younger than the subtraction.
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) years--;
    return years;
  }

  /** Show or clear a message under one field. */
  function fieldError(el, message) {
    const wrap = el.closest('.field') || el.parentElement;
    const existing = wrap.querySelector('.field-err');
    if (existing) existing.remove();
    wrap.classList.toggle('has-err', !!message);
    if (message) {
      const p = document.createElement('small');
      p.className = 'field-err';
      p.textContent = message;
      wrap.appendChild(p);
    }
    return !message;
  }

  /** Validate every checkable field in a step. Returns the first message, or null. */
  function validateFields(root) {
    let first = null;
    $$('[data-check]', root).forEach((el) => {
      const rule = FIELD_RULES[el.dataset.check];
      const msg = rule ? rule(el.value) : null;
      fieldError(el, msg);
      if (msg && !first) first = msg;
    });
    return first;
  }

  const bind = (root, obj) =>
    $$('[data-k]', root).forEach((el) => {
      const k = el.dataset.k;
      el.addEventListener('input', () => {
        obj[k] = el.type === 'checkbox' ? el.checked : el.value;
        // Clear a showing error the moment it stops being true; do not nag mid-typing.
        if (el.dataset.check && el.closest('.field')?.classList.contains('has-err')) {
          const rule = FIELD_RULES[el.dataset.check];
          if (rule && !rule(el.value)) fieldError(el, null);
        }
      });
      // Judge the value once they have finished with the field, not on every keystroke.
      if (el.dataset.check) {
        el.addEventListener('blur', () => {
          const rule = FIELD_RULES[el.dataset.check];
          if (rule) fieldError(el, rule(el.value));
        });
      }
    });

  function navButtons(canBack, nextLabel, onNext) {
    return `<div class="row mt-lg" style="justify-content:space-between">
      ${canBack ? '<button class="btn" id="back">← Back</button>' : '<span></span>'}
      <button class="btn primary lg" id="next">${nextLabel}</button>
    </div>`;
  }

  function wireNav(root, v, validate) {
    const back = $('#back', root);
    if (back)
      back.onclick = () => {
        applyState.step--;
        renderApply(v);
      };
    $('#next', root).onclick = () => {
      /* Field format first, then the step's own rules. Nothing gets to the last screen
         with a malformed KRA PIN in it any more. */
      const fieldErr = validateFields(root);
      if (fieldErr) {
        const bad = $('.has-err [data-check]', root) || $('[data-check]', root);
        if (bad) bad.focus();
        return toast(fieldErr, 'err');
      }
      const err = validate ? validate() : null;
      if (err) return toast(err, 'err');
      applyState.step++;
      renderApply(v);
    };
  }

  function stepDetails(root, v) {
    const a = applyState.applicant;
    root.innerHTML = `<h3>Your details</h3>
      <div class="grid-2">
        <div class="field"><label>Full name (as on your ID) *</label><input type="text" data-k="fullName" value="${esc(a.fullName)}"></div>
        <div class="field"><label>National ID / passport number *</label><input type="text" data-k="idNumber" value="${esc(a.idNumber)}" data-check="idNumber"></div>
        <div class="field"><label>Phone number *</label><input type="tel" data-k="phone" value="${esc(a.phone)}" placeholder="0712 345 678" data-check="phone"></div>
        <div class="field"><label>Email address</label><input type="email" data-k="email" value="${esc(a.email)}" data-check="email"></div>
        <div class="field"><label>KRA PIN</label>
          <input type="text" data-k="kraPin" value="${esc(a.kraPin)}" placeholder="A012345678Z"
                 maxlength="11" autocapitalize="characters" spellcheck="false" data-check="kraPin">
          <small class="dim">One letter, nine digits, one letter — as printed on your KRA certificate.</small>
        </div>
        ${/* Date of birth only. Asking for both a birth date and an age was asking the
             same question twice and inviting them to disagree — and a lender checks the
             logbook date, not what somebody typed. The age is worked out below. */ ''}
        <div class="field"><label>Date of birth *</label>
          <input type="date" data-k="dob" value="${esc(a.dob)}" max="${new Date().toISOString().slice(0, 10)}" data-check="dob">
          <small class="dim" id="ageNote">Lenders cap how old you can be when the loan finishes, so this changes who will lend.</small>
        </div>
        <div class="field"><label>Marital status</label><select data-k="maritalStatus">
          ${['single', 'married', 'other'].map((s) => `<option value="${s}" ${a.maritalStatus === s ? 'selected' : ''}>${titleCase(s)}</option>`).join('')}
        </select></div>
      </div>
      <div class="field"><label>Physical address</label><input type="text" data-k="address" value="${esc(a.address)}" placeholder="Estate, road, town"></div>
      ${navButtons(false, 'Continue to income →')}`;
    bind(root, a);

    /* Say the age back as they pick the date. It is used to price the loan, so the
       customer should be able to see we read it correctly. */
    const dobEl = $('[data-k="dob"]', root);
    const note = $('#ageNote', root);
    const showAge = () => {
      const years = ageFromDob(dobEl.value);
      note.textContent = years === null
        ? 'Lenders cap how old you can be when the loan finishes, so this changes who will lend.'
        : `That makes you ${years}. Lenders cap how old you can be when the loan finishes, so this changes who will lend.`;
    };
    dobEl.addEventListener('input', showAge);
    showAge();

    wireNav(root, v, () => {
      if (!a.fullName || !a.idNumber || !a.phone) return 'Name, ID number and phone are required';
      if (!a.dob) return 'Date of birth is required — lenders price on it';
      return null;
    });
  }

  function stepIncome(root, v, lender) {
    const e = applyState.employment;
    root.innerHTML = `<h3>Income and commitments</h3>
      <p class="muted">${esc(lender.short_name || lender.name)} needs to see that the instalment fits inside your monthly income.</p>
      <div class="grid-2">
        <div class="field"><label>How you earn *</label><select data-k="type">
          ${Object.entries(EMPLOYMENT_LABEL).map(([k, l]) => `<option value="${k}" ${e.type === k ? 'selected' : ''}>${l}</option>`).join('')}
        </select></div>
        <div class="field"><label>Employer / business name</label><input type="text" data-k="employer" value="${esc(e.employer)}"></div>
        <div class="field"><label>Position / trade</label><input type="text" data-k="position" value="${esc(e.position)}"></div>
        <div class="field"><label>Years there</label><input type="number" data-k="yearsEmployed" value="${esc(e.yearsEmployed)}"></div>
        <div class="field"><label>Net monthly income (KES) *</label><input type="number" data-k="netIncome" value="${esc(e.netIncome)}"></div>
        <div class="field"><label>Existing monthly loan repayments (KES)</label><input type="number" data-k="obligations" value="${esc(e.obligations)}"></div>
      </div>
      <label class="check"><input type="checkbox" data-k="crbClean" ${e.crbClean ? 'checked' : ''}>
        <span>My CRB record is clean — no active adverse listing</span>
      </label>
      <div class="panel mt">
        <div class="lbl" style="margin:0">What is a CRB listing?</div>
        <p style="font-size:.86rem;margin:6px 0 0">
          A Credit Reference Bureau — Metropol, TransUnion or Creditinfo — keeps a record of
          how you have repaid past loans. If you defaulted and it was never cleared, you are
          <b>negatively listed</b>. Being listed does not mean nobody will lend to you; it means
          fewer will, and usually at a higher rate.
        </p>
        <p style="font-size:.86rem;margin:6px 0 0">
          Not sure? You are entitled to <b>one free report a year</b> from each bureau.
          Tick this only if you are confident — the lender checks properly, and a wrong answer
          here just wastes your time and theirs.
        </p>
        ${
          lender.requires_clean_crb
            ? `<p class="mt" style="font-size:.86rem"><b>${esc(lender.short_name || lender.name)} requires a clean record.</b>
               If yours is listed, go back and pick a microfinance or in-house option — several on
               the panel will still consider you.</p>`
            : '<p class="mt" style="font-size:.86rem">This lender will still look at your application if you are listed.</p>'
        }
      </div>
      ${navButtons(true, 'Continue to documents →')}`;
    bind(root, e);
    wireNav(root, v, () => {
      if (!e.netIncome) return 'Net monthly income is required';
      return null;
    });
  }

  function stepDocs(root, v, lender) {
    const docs = applyState.documents;
    const required = lender.requirements || [];
    root.innerHTML = `<h3>Documents</h3>
      <p class="muted">${esc(lender.short_name || lender.name)} asks for the following. You can upload now or send them later — the dealership will chase whatever is missing.</p>
      <ul class="muted">${required.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
      <div class="field mt">
        <label>Document type</label>
        <select id="docType">
          ${['id', 'kra_pin', 'payslip', 'bank_statement', 'mpesa_statement', 'business_permit', 'logbook', 'other']
            .map((t) => `<option value="${t}">${titleCase(t)}</option>`)
            .join('')}
        </select>
      </div>
      <div class="dropzone" id="drop">Click to choose a file, or drop it here<br><small class="dim">PDF, JPG or PNG — up to 5 MB each</small></div>
      <input type="file" id="file" class="hide" multiple accept=".pdf,.jpg,.jpeg,.png">
      <div id="docList" class="mt"></div>
      ${navButtons(true, 'Review application →')}`;

    const list = $('#docList', root);
    const paint = () => {
      list.innerHTML = docs.length
        ? docs
            .map(
              (d, i) =>
                `<div class="doc-row"><span class="tag">${esc(titleCase(d.type))}</span><span class="grow">${esc(d.filename)}</span><span class="dim">${K(d.size)}B</span><button class="btn sm danger" data-rm="${i}">Remove</button></div>`
            )
            .join('')
        : '<div class="dim" style="font-size:.85rem">No documents attached yet.</div>';
    };
    paint();
    on(list, 'click', '[data-rm]', (e, el) => {
      docs.splice(Number(el.dataset.rm), 1);
      paint();
    });

    const input = $('#file', root);
    const drop = $('#drop', root);
    drop.onclick = () => input.click();
    ['dragover', 'dragenter'].forEach((ev) =>
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.add('over');
      })
    );
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      addFiles(e.dataTransfer.files);
    });
    input.onchange = () => addFiles(input.files);

    async function addFiles(files) {
      for (const f of Array.from(files)) {
        if (f.size > 5 * 1024 * 1024) {
          toast(`${f.name} is larger than 5 MB`, 'err');
          continue;
        }
        docs.push({ type: $('#docType', root).value, filename: f.name, mime: f.type, size: f.size, data: await fileToBase64(f) });
      }
      paint();
      toast('Attached');
    }

    /* `v` must be passed through. It used to be null here, so Back threw on vehImg(null)
       and the customer was stuck on Documents with no way to correct their income —
       a dead end in the middle of a credit application, and silent, because the throw
       happened inside a promise nobody was watching. */
    wireNav(root, v, null);
  }

  function stepReview(root, v, lender, offer) {
    const a = applyState.applicant;
    const e = applyState.employment;
    root.innerHTML = `<h3>Review and submit</h3>
      <div class="grid-2">
        <div class="panel"><div class="lbl">Applicant</div>
          ${[['Name', a.fullName], ['ID', a.idNumber], ['Phone', a.phone], ['Email', a.email], ['KRA PIN', a.kraPin],
             ['Date of birth', a.dob ? `${dateFmt(a.dob)} (age ${ageFromDob(a.dob)})` : null], ['Address', a.address]]
            .map((r) => `<div class="row between"><span class="dim">${r[0]}</span><span>${esc(r[1] || '—')}</span></div>`)
            .join('')}
        </div>
        <div class="panel"><div class="lbl">Income</div>
          ${[
            ['Type', EMPLOYMENT_LABEL[e.type]],
            ['Employer', e.employer],
            ['Net income', e.netIncome ? KES(e.netIncome) : '—'],
            ['Commitments', e.obligations ? KES(e.obligations) : 'None'],
            ['CRB', e.crbClean ? 'Clean' : 'Listed'],
          ]
            .map((r) => `<div class="row between"><span class="dim">${r[0]}</span><span>${esc(r[1] || '—')}</span></div>`)
            .join('')}
        </div>
      </div>

      <div class="panel mt"><div class="lbl">The facility you are applying for</div>
        <div class="row between"><span class="dim">Vehicle</span><span>${esc(v.title)} — ${KES(v.price)}</span></div>
        <div class="row between"><span class="dim">Lender</span><span>${esc(lender.name)}</span></div>
        <div class="row between"><span class="dim">Deposit</span><span>${KES(offer.deposit)}</span></div>
        <div class="row between"><span class="dim">Financed</span><span>${KES(offer.principal)} over ${offer.tenorMonths} months</span></div>
        <div class="row between" style="font-weight:700"><span>Monthly instalment</span><span>${KES(offer.monthlyPayment)}</span></div>
      </div>

      <div class="panel mt"><div class="lbl">Documents attached</div>
        ${applyState.documents.length ? applyState.documents.map((d) => `<div class="row between"><span class="dim">${esc(titleCase(d.type))}</span><span>${esc(d.filename)}</span></div>`).join('') : '<span class="dim">None — the dealership will request them</span>'}
      </div>

      <label class="check mt"><input type="checkbox" id="consent"><span>I confirm the information above is true, and I authorise ${esc(S.dealer.name)} and ${esc(lender.short_name || lender.name)} to verify it, including a CRB search.</span></label>
      <label class="check"><input type="checkbox" id="reserve" checked><span>Hold this vehicle for me while the application is processed</span></label>

      <div class="row mt-lg" style="justify-content:space-between">
        <button class="btn" id="back">← Back</button>
        <button class="btn primary lg" id="submit">Submit application</button>
      </div>`;

    $('#back', root).onclick = () => {
      applyState.step--;
      renderApply(v);
    };
    $('#submit', root).onclick = async () => {
      if (!$('#consent', root).checked) return toast('Please confirm and authorise before submitting', 'err');
      const btn = $('#submit', root);
      btn.disabled = true;
      btn.textContent = 'Submitting…';
      try {
        const res = await POST('/api/applications', {
                    vehicleId: applyState.vehicleId,
          lenderId: applyState.lenderId,
          deposit: applyState.deposit,
          tenor: applyState.tenor,
          applicant: applyState.applicant,
          employment: applyState.employment,
          documents: applyState.documents,
          reserve: $('#reserve', root).checked,
          utm: utm(),
          ...botFields(),
        });
        store.set('lastRef', res.ref);
        applyState = null;
        go(`#/done/${res.ref}`);
      } catch (err) {
        toast(err.message, 'err');
        btn.disabled = false;
        btn.textContent = 'Submit application';
      }
    };
  }

  function pageDone(ref) {
    view.innerHTML = `<div class="card mt-lg center" style="max-width:660px;margin-left:auto;margin-right:auto;padding:44px">
      <div style="font-size:3rem">✅</div>
      <h1>Application received</h1>
      <p class="muted">${esc(S.dealer.name)} has your application and will be in touch within one working day.</p>
      <div class="panel mt"><div class="lbl">Your reference</div>
        <div class="mono" style="font-size:1.6rem;font-weight:700;letter-spacing:.05em">${esc(ref)}${copyBtn(ref)}</div></div>
      <p class="muted mt">Keep this reference. You can check progress any time with it and your phone number.</p>
      <div class="row mt" style="justify-content:center">
        <a class="btn primary" href="#/track?ref=${encodeURIComponent(ref)}">Track this application</a>
        <a class="btn" href="#/browse">Keep browsing</a>
      </div>
    </div>`;
  }

  /* ---------------- tracking ---------------- */

  /* ---------------- the tracker ----------------
     This is the page a customer comes back to, over and over, between applying and
     driving away. It is built around one question — "where is my application, and what
     do I do now" — with the lookup form demoted to a small panel once they are in. */

  /** The step rail. Done, current and still-to-come are visually distinct, not just coloured. */
  function trackRail(statusKey) {
    const idx = TRACK_STEPS.findIndex((s) => s.key === statusKey);
    return `<ol class="track-rail">
      ${TRACK_STEPS.map((s, i) => {
        const state = i < idx ? 'done' : i === idx ? 'on' : 'todo';
        return `<li class="tr-step ${state}">
          <span class="tr-dot">${i < idx ? '✓' : i + 1}</span>
          <span class="tr-label">${esc(s.label)}</span>
        </li>`;
      }).join('')}
    </ol>`;
  }

  /** Where you are, what it means, and what happens next. The whole point of the page. */
  function trackNow(r, phone) {
    const ended = TRACK_ENDED[r.status];
    if (ended) {
      return `<div class="track-now ended">
        <div class="lbl">Where this stands</div>
        <h2>${esc(ended.label)}</h2>
        <p>${esc(ended.means)}</p>
        <p class="track-next"><b>What now:</b> ${esc(ended.next)}</p>
        <div class="row mt" style="gap:8px">
          <a class="btn primary" href="#/financing/afford">See what else you can afford</a>
          <a class="btn wa" href="${esc(waDealer())}" target="_blank" rel="noopener">Talk to us</a>
        </div>
      </div>`;
    }

    const step = TRACK_STEPS.find((s) => s.key === r.status) || TRACK_STEPS[0];
    return `<div class="track-now ${step.you ? 'yours' : ''}">
      <div class="lbl">${step.you ? 'Waiting on you' : 'Where it is right now'}</div>
      <h2>${esc(step.label)}</h2>
      <p>${esc(step.means)}</p>
      <p class="track-next"><b>Next:</b> ${esc(step.next)}</p>
      ${step.eta ? `<p class="track-eta">${esc(step.eta)}</p>` : ''}
      ${
        step.you && r.status === 'documents_pending'
          ? `<a class="btn primary lg mt" href="#/upload?ref=${encodeURIComponent(r.ref)}&phone=${encodeURIComponent(phone)}">Upload your documents</a>`
          : ''
      }
      ${
        step.you && r.status === 'approved'
          ? `<a class="btn primary lg mt" href="#/offer?ref=${encodeURIComponent(r.ref)}&phone=${encodeURIComponent(phone)}">Read your offer letter</a>`
          : ''
      }
    </div>`;
  }

  function pageTrack(query) {
    const savedRef = query.ref || store.get('lastRef', '');
    const savedPhone = query.phone || store.get('lastPhone', '');

    view.innerHTML = `
      <section class="track-head">
        <div class="lbl">Your application</div>
        <h1>Where is my car?</h1>
        <p class="muted" style="max-width:56ch">Every step, what it means, and what happens next.
        No need to ring anyone — this is the same view our team sees.</p>
      </section>
      <div id="tOut" class="mt"></div>
      <div id="tForm" class="mt-lg"></div>`;

    const formPanel = (compact) => `
      <div class="card" style="max-width:${compact ? '100%' : '560px'}">
        <div class="lbl">${compact ? 'Check a different application' : 'Find your application'}</div>
        <div class="${compact ? 'grid-3' : ''}">
          <div class="field"><label>Reference number</label><input type="text" id="tRef" value="${esc(savedRef)}" placeholder="MK-2609-A1B2C3"></div>
          <div class="field"><label>Phone number used</label><input type="tel" id="tPhone" value="${esc(savedPhone)}" placeholder="07…"></div>
          ${compact ? '<div class="field"><label>&nbsp;</label><button class="btn block" id="tGo">Check</button></div>' : ''}
        </div>
        ${compact ? '' : '<button class="btn primary block" id="tGo">Check status</button>'}
        <p class="dim mt" style="font-size:.8rem">The reference is on the confirmation we sent you.
        Applied without an account? This is all you need — no password.</p>
      </div>`;

    const wire = () => {
      $('#tGo').onclick = load;
      ['tRef', 'tPhone'].forEach((id) => {
        const el = $('#' + id);
        if (el) el.onkeydown = (e) => { if (e.key === 'Enter') load(); };
      });
    };

    async function load() {
      const ref = $('#tRef').value.trim();
      const phone = $('#tPhone').value.trim();
      const out = $('#tOut');
      if (!ref) return toast('Enter your reference number', 'err');
      out.innerHTML = '<div class="spinner"></div>';
      try {
        const r = await GET(`/api/applications/track?ref=${encodeURIComponent(ref)}&phone=${encodeURIComponent(phone)}`);
        // Remembered so the next visit opens straight onto the answer.
        store.set('lastRef', r.ref);
        store.set('lastPhone', phone);

        out.innerHTML = `
          ${trackNow(r, phone)}
          ${TRACK_ENDED[r.status] ? '' : trackRail(r.status)}

          <div class="split-r mt">
            <div>
              <h3>What you applied for</h3>
              <div class="specgroups">
                ${specGroup('The car', [
                  ['Vehicle', (r.vehicle && r.vehicle.title) || null],
                  ['Reference', r.ref],
                  ['Applied', r.created_at ? dateFmt(r.created_at) : null],
                ])}
                ${specGroup('The finance', [
                  ['Lender', (r.lender && r.lender.name) || null],
                  ['Monthly instalment', r.offer ? KES(r.offer.monthlyPayment) : null],
                  ['Deposit', r.offer ? KES(r.offer.deposit) : null],
                  ['Term', r.offer ? r.offer.tenorMonths + ' months' : null],
                ])}
              </div>

              <h3 class="mt-lg">Everything that has happened</h3>
              <div class="timeline">
                ${r.events.map((e) => `<div class="ev"><div>${esc(e.message)}</div><div class="t">${esc(e.actor || '')} · ${dateTimeFmt(e.created_at)}</div></div>`).join('')}
              </div>

              <h3 class="mt-lg">Documents</h3>
              ${
                r.documents.length
                  ? r.documents.map((d) => `<div class="doc-row"><span class="tag ok">✓</span><span class="tag">${esc(titleCase(d.doc_type))}</span><span class="grow">${esc(d.filename)}</span><span class="dim">${dateFmt(d.uploaded_at)}</span></div>`).join('')
                  : '<p class="muted">Nothing received yet.</p>'
              }
              <a class="btn ghost mt" href="#/upload?ref=${encodeURIComponent(r.ref)}&phone=${encodeURIComponent(phone)}">Send a document</a>
            </div>

            <aside class="sticky stack">
              <div class="card">
                <div class="lbl">Reference</div>
                <div class="mono" style="font-size:1.15rem;font-weight:700">${esc(r.ref)}</div>
                <span class="tag ${STATUS_TONE[r.status] || ''} mt">${esc(STATUS_LABEL[r.status] || r.status)}</span>
                <hr>
                ${
                  ['approved', 'disbursed', 'delivered'].includes(r.status)
                    ? `<a class="btn primary block" href="#/offer?ref=${encodeURIComponent(r.ref)}&phone=${encodeURIComponent(phone)}">Open offer letter</a>`
                    : ''
                }
                <a class="btn wa block mt" href="${esc(waDealer())}" target="_blank" rel="noopener">Ask about this application</a>
                <button class="btn ghost block mt" data-act="track-refresh">Refresh</button>
              </div>
              ${
                r.vehicle
                  ? `<div class="card"><div class="lbl">Your car</div>
                      <a href="#/vehicle/${r.vehicle.id}"><img src="${esc(vehImg(r.vehicle))}" alt="${esc(r.vehicle.title)}" style="width:100%;margin:8px 0"></a>
                      <a class="btn ghost block" href="#/vehicle/${r.vehicle.id}">View the listing</a></div>`
                  : ''
              }
            </aside>
          </div>`;

        $('#tForm').innerHTML = formPanel(true);
        wire();
        const rf = $('[data-act="track-refresh"]');
        if (rf) rf.onclick = load;
      } catch (e) {
        out.innerHTML = `<div class="card"><div class="err-text"><b>${esc(e.message)}</b></div>
          <p class="muted mt">Check the reference and the phone number match what you applied with.
          If you are still stuck, message us and we will find it.</p>
          <a class="btn wa mt" href="${esc(waDealer())}" target="_blank" rel="noopener">Message us</a></div>`;
        $('#tForm').innerHTML = formPanel(false);
        wire();
      }
    }

    $('#tForm').innerHTML = formPanel(false);
    wire();
    if (savedRef) load();
  }

  /* ---------------- financing hub ---------------- */

  /* Affordability first, and it is the default.
     A customer opening a calculator does not yet know what to type into it. Working out
     the budget before looking at instalments is the order every reputable lender's own
     tooling uses, and it stops someone falling for a car they cannot service. */
  /**
   * A budget with no reasoning behind it is just a number. This is the rule lenders and
   * financial advisers actually use — payment under a tenth of gross income — stated
   * plainly so the customer can disagree with it if their situation is different.
   */
  function ruleOfThumb(income, instalment) {
    if (!income || !instalment) return '';
    const pct = (instalment / income) * 100;
    const within = pct <= 10;
    return `<div class="panel mt" style="border-left:3px solid var(--${within ? 'ok' : 'warn'})">
      <div class="lbl" style="margin:0">The rule of thumb</div>
      <div style="font-size:.88rem">
        A car payment is usually considered comfortable at <b>up to 10% of gross monthly income</b>,
        with no more than four years of repayments. This works out at <b>${pct.toFixed(1)}%</b> of yours —
        ${within
          ? 'comfortably inside it.'
          : 'above that line, so it is worth a bigger deposit or a cheaper car.'}
      </div>
      <div class="muted" style="font-size:.8rem;margin-top:6px">
        Fuel, insurance and servicing come on top of the instalment. The Running cost tab adds them up.
      </div>
    </div>`;
  }

  const FIN_TABS = [
    ['afford', 'What can I afford?'],
    ['calculator', 'Calculator'],
    ['compare', 'Lender comparison'],
    ['running', 'Running cost'],
    ['insurance', 'Insurance'],
    ['prequalify', 'Pre-qualify'],
    ['faq', 'FAQs'],
  ];

  async function pageFinancing(tab, query) {
    tab = FIN_TABS.some((t) => t[0] === tab) ? tab : 'afford';
    const lenders = S.boot.lenders;
    view.innerHTML = `
      <section class="hero" style="padding:38px 34px">
        <div class="lbl" style="color:#cbd5e1">Vehicle financing</div>
        <h1 style="margin-top:6px;font-size:2.2rem">Find the right loan for your next car.</h1>
        <p>Compare rates from ${lenders.length} Kenyan lenders, calculate the true cost of ownership,
        and pre-qualify in minutes — all in one place.</p>
        <div class="row wrap-r" style="gap:6px">
          <span class="tag">${lenders.length} lenders compared</span>
          <span class="tag">Reducing balance &amp; flat rates</span>
          <span class="tag">True APR on every quote</span>
          <span class="tag">Free, no obligation</span>
        </div>
      </section>
      <nav class="subnav" id="finTabs">
        ${FIN_TABS.map((t) => `<a href="#/financing/${t[0]}" class="${t[0] === tab ? 'on' : ''}">${t[1]}</a>`).join('')}
      </nav>
      <div id="finBody" class="mt"><div class="spinner"></div></div>`;

    const body = $('#finBody');
    if (tab === 'calculator') return finCalculator(body, query);
    if (tab === 'afford') return finAfford(body);
    if (tab === 'compare') return finCompare(body, query);
    if (tab === 'running') return finRunning(body, query);
    if (tab === 'insurance') return finInsurance(body, query);
    if (tab === 'prequalify') return finPrequalify(body, query);
    if (tab === 'faq') return finFaq(body);
  }

  /* --- tab 1: calculator (works with or without a chosen car) --- */
  async function finCalculator(box, query) {
    const cars = (await GET(`/api/vehicles?${dq()}&pageSize=60`)).items;
    const preset = query.vehicle ? cars.find((c) => c.id === Number(query.vehicle)) : null;
    const startPrice = preset ? preset.price : 2500000;
    const cb = panelBounds();

    box.innerHTML = `
      <h2>Calculate financing</h2>
      <p class="muted">Estimate your monthly payment with any lender on the panel.</p>
      <div class="split-r">
        <div class="card">
          <div class="grid-2">
            <div class="field"><label>Pick a car from stock (optional)</label>
              <select id="cCar"><option value="">Enter a price instead</option>
                ${cars.map((c) => `<option value="${c.id}" data-price="${c.price}" ${preset && preset.id === c.id ? 'selected' : ''}>${esc(c.title)} — ${KES(c.price)}</option>`).join('')}
              </select>
            </div>
            <div class="field" id="cPriceField">
              <label>Vehicle price (KES)</label>
              <input type="number" id="cPrice" value="${startPrice}">
              <div class="locked-price hide" id="cPriceLocked"></div>
            </div>
          </div>

          <label class="lbl">Deposit — <span id="cDepLabel"></span></label>
          <input type="range" id="cDep" min="${cb.minDeposit}" max="70" step="5" value="${Math.max(20, cb.minDeposit)}">
          <div class="row between dim" style="font-size:.75rem"><span>${cb.minDeposit}%</span><span>70%</span></div>
          <small class="dim">${cb.minDeposit}% is the least any lender on our panel will accept.</small>

          <label class="lbl mt">Loan tenure</label>
          <div class="pills" id="cTenor">
            ${/* Only terms a lender on the panel actually offers. A 72-month button that
                 can never return an offer is a dead end dressed up as a choice. */ ''}
            ${[12, 24, 36, 48, 60, 72]
              .filter((t) => t >= cb.minTenor && t <= cb.maxTenor)
              .map((t) => `<button class="pill ${t === Math.min(48, cb.maxTenor) ? 'on' : ''}" data-tenor="${t}">${t} mo</button>`)
              .join('')}
          </div>

          <label class="lbl mt">Financing partner</label>
          <div class="lender-pick" id="cLender">
            ${lendersPickHtml(S.boot.lenders, S.boot.lenders[0].id)}
          </div>
        </div>
        <aside class="card sticky" id="cOut"><div class="spinner"></div></aside>
      </div>`;

    let lenderId = S.boot.lenders[0].id;
    let tenor = 48;

    const refresh = debounce(async () => {
      const price = Number($('#cPrice').value) || 0;
      const depPct = Number($('#cDep').value);
      $('#cDepLabel').innerHTML = `<b>${depPct}%</b> · ${KES((price * depPct) / 100)}`;
      if (!price) return ($('#cOut').innerHTML = '<div class="empty">Enter a price.</div>');
      const res = await POST('/api/quote', {
                price,
        depositPct: depPct,
        tenor,
        lenderIds: [lenderId],
        applicant: {},
      });
      const o = res.offers[0];
      $('#cOut').innerHTML = `
        <div class="lbl">Estimated monthly payment</div>
        <div style="font-size:2.2rem;font-weight:750;letter-spacing:-.03em;line-height:1.1">${KES(o.monthlyPayment)}</div>
        <div class="muted">${esc(o.lender.name)} · ${o.annualRate}% ${o.rateType === 'flat' ? 'flat' : 'reducing balance'} · ${o.tenorMonths} months</div>
        <hr>
        <table class="tbl">
          <tr><td>Deposit</td><td class="num">${KES(o.deposit)}</td></tr>
          <tr><td>Loan amount</td><td class="num">${KES(o.principal)}</td></tr>
          <tr><td>Total interest</td><td class="num">${KES(o.totalInterest)}</td></tr>
          <tr><td>Fees &amp; insurance</td><td class="num">${KES(o.feeTotal + o.insurance)}</td></tr>
          <tr style="font-weight:700"><td>Total to repay</td><td class="num">${KES(o.totalRepaid)}</td></tr>
          <tr><td>True APR</td><td class="num">${o.apr}%</td></tr>
        </table>
        ${o.depositShortfall ? `<div class="tag warn mt">Quoted at this lender's ${o.minDepositPct}% minimum deposit</div>` : ''}
        <a class="btn primary block mt" href="#/financing/prequalify?price=${o.price}&deposit=${o.deposit}&tenor=${o.tenorMonths}">Get pre-qualified</a>
        <a class="btn wa block mt" href="${esc(waLink(`Hi ${S.dealer.name}, I used your calculator: ${KES(o.price)} car, ${KES(o.deposit)} deposit over ${o.tenorMonths} months with ${o.lender.name} — about ${KES(o.monthlyPayment)}/month. Can we talk?`))}" target="_blank" rel="noopener">Discuss on WhatsApp</a>
        <a class="btn ghost block mt" href="#/financing/compare?price=${o.price}&deposit=${o.deposit}&tenor=${o.tenorMonths}">Compare all ${S.boot.lenders.length} lenders →</a>
        <small class="dim" style="display:block;margin-top:10px">Estimates only. Actual rates, fees and limits are set by the lender after assessment.</small>`;
    }, 180);

    // When a car is picked the price is the dealership's price, not an input.
    const lockPrice = () => {
      const opt = $('#cCar').selectedOptions[0];
      const picked = opt && opt.value;
      const box = $('#cPriceLocked');
      const input = $('#cPrice');
      if (picked) {
        input.value = opt.dataset.price;
        input.classList.add('hide');
        box.classList.remove('hide');
        box.innerHTML = `${KES(opt.dataset.price)} <span class="lock">🔒 our listed price</span>`;
      } else {
        input.classList.remove('hide');
        box.classList.add('hide');
      }
    };
    $('#cCar').onchange = () => {
      lockPrice();
      refresh();
    };
    lockPrice();
    $('#cPrice').oninput = refresh;
    $('#cDep').oninput = refresh;
    on($('#cTenor'), 'click', '[data-tenor]', (e, el) => {
      $$('#cTenor .pill').forEach((p) => p.classList.toggle('on', p === el));
      tenor = Number(el.dataset.tenor);
      refresh();
    });
    on($('#cLender'), 'click', '[data-lender]', (e, el) => {
      $$('#cLender .lp').forEach((p) => p.classList.toggle('on', p === el));
      lenderId = Number(el.dataset.lender);
      refresh();
    });
    refresh();
  }

  function lendersPickHtml(lenders, selectedId) {
    return lenders
      .map(
        (l) => `<button class="lp ${l.id === selectedId ? 'on' : ''}" data-lender="${l.id}">
          <span class="badge-lender" style="background:${esc(l.color)};width:30px;height:30px;border-radius:8px;font-size:.7rem">${esc(l.logo_text || '?')}</span>
          <span class="grow" style="text-align:left">
            <b style="display:block;font-size:.86rem">${esc(l.short_name || l.name)}</b>
            <span class="dim" style="font-size:.74rem">${esc(LENDER_TYPE_LABEL[l.type] || l.type)}</span>
          </span>
          <span class="nowrap" style="font-size:.82rem">${l.annual_rate}%<span class="dim" style="font-size:.7rem"> ${l.rate_type === 'flat' ? 'flat' : 'p.a.'}</span></span>
        </button>`
      )
      .join('');
  }

  /* --- tab 2: affordability --- */
  function finAfford(box) {
    const p = S.profile;
    box.innerHTML = `
      <div class="lbl">Before you shop</div>
      <h2>What can I afford?</h2>
      <p class="muted">Tell us your income and we'll show you the right car price range.</p>
      <!-- Stacked, not side by side. The answer and the two things you can do with it
           belong UNDER the questions: a "Browse cars in this range" button sitting beside
           an empty form is offering an answer before it has been asked anything. -->
      <div class="afford-flow">
        <div class="card">
          <div class="field"><label>Net monthly income (after tax)</label>
            <input type="number" id="aInc" value="${esc(p.netIncome || 150000)}">
            <small class="dim">Your take-home pay each month.</small>
          </div>
          <div class="field"><label>Existing monthly loan repayments</label>
            <input type="number" id="aObl" value="${esc(p.obligations || 0)}">
            <small class="dim">Other loans you are already servicing — mortgage, student loan, sacco.</small>
          </div>
          <div class="field"><label>How aggressive can you be?</label>
            <div class="pills" id="aAgg">
              <button class="pill" data-agg="20">Conservative</button>
              <button class="pill on" data-agg="30">Balanced</button>
              <button class="pill" data-agg="40">Aggressive</button>
            </div>
            <small class="dim" id="aAggNote">Banks allow up to 50% of income. We recommend 30%.</small>
          </div>
          <div class="field"><label>How long do you want to repay?</label>
            <div class="pills" id="aTen">
              ${panelTerms([24, 36, 48, 60, 72]).map((t, i, a) => `<button class="pill ${t === a[a.length - 1] ? 'on' : ''}" data-ten="${t}">${t} mo</button>`).join('')}
            </div>
          </div>
          <div class="field"><label>How much can you put down?</label><input type="number" id="aDep" value="200000"></div>
          <div class="field"><label>Estimated interest rate — <b id="aRateLabel">15.5%</b></label>
            <input type="range" id="aRate" min="9" max="26" step="0.5" value="15.5">
            <small class="dim">Move this to see how the rate changes what you can buy.</small>
          </div>
        </div>
        <section class="afford-results" id="aOut"><div class="spinner"></div></section>
      </div>`;

    let agg = 30;
    let tenor = 60;

    const refresh = debounce(async () => {
      const income = Number($('#aInc').value) || 0;
      const obl = Number($('#aObl').value) || 0;
      const dep = Number($('#aDep').value) || 0;
      const rate = Number($('#aRate').value);
      $('#aRateLabel').textContent = rate.toFixed(1) + '%';
      $('#aAggNote').textContent = `${agg}% of your income goes to the car. Banks allow up to 50%; we recommend 30%.`;
      if (!income) return ($('#aOut').innerHTML = '<div class="card empty">Enter your income.</div>');

      // the affordable instalment, and the loan it supports at the chosen rate
      const maxInstalment = Math.max(0, (income * agg) / 100 - obl);
      const r = rate / 100 / 12;
      const principal = r ? (maxInstalment * (1 - Math.pow(1 + r, -tenor))) / r : maxInstalment * tenor;
      const maxPrice = Math.round(principal + dep);
      const totalRepay = Math.round(maxInstalment * tenor);
      const dti = income ? ((maxInstalment + obl) / income) * 100 : 0;
      const verdict =
        dti <= 30 ? ['ok', 'Comfortable — this leaves room for fuel, insurance and servicing.'] :
        dti <= 40 ? ['warn', 'Manageable, but watch your budget once running costs are added.'] :
        ['err', 'Stretched. Most lenders will decline above 50%, and life gets tight.'];

      const matches = await GET(`/api/vehicles?${dq()}&maxPrice=${maxPrice}&sort=price_desc&pageSize=6`);
      const panel = await POST('/api/affordability', {
                netIncome: income,
        obligations: obl,
        deposit: dep,
        tenor,
        employment: p.employment || 'employed',
      }).catch(() => null);

      S.profile = { ...S.profile, netIncome: income, obligations: obl };
      store.set('profile', S.profile);

      $('#aOut').innerHTML = `
        <div class="card" style="background:linear-gradient(150deg,var(--card-2),var(--card))">
          <div class="lbl">Your maximum</div>
          <div style="font-size:2.4rem;font-weight:750;letter-spacing:-.03em;line-height:1.05">${KES(maxPrice)}</div>
          <div class="muted">comfortable car price range</div>
          <div class="grid-2 mt">
            <div class="panel"><div class="lbl" style="margin:0">Monthly payment</div><b>${KES(maxInstalment)}</b></div>
            <div class="panel"><div class="lbl" style="margin:0">Down payment</div><b>${KES(dep)}</b></div>
            <div class="panel"><div class="lbl" style="margin:0">Loan amount</div><b>${KES(principal)}</b></div>
            <div class="panel"><div class="lbl" style="margin:0">Total to repay</div><b>${KES(totalRepay)}</b></div>
          </div>
          <div class="lbl mt">Debt-to-income ratio</div>
          <div class="bar"><i style="width:${Math.min(100, dti)}%;background:var(--${verdict[0] === 'ok' ? 'ok' : verdict[0] === 'warn' ? 'warn' : 'err'})"></i></div>
          <div class="row between mt" style="font-size:.84rem"><span class="tag ${verdict[0]}">${dti.toFixed(0)}%</span><span class="muted">${verdict[1]}</span></div>
          ${ruleOfThumb(income, maxInstalment)}
          <div class="row mt" style="gap:8px">
            <a class="btn primary grow" href="#/browse?maxPrice=${maxPrice}">Browse cars in this range</a>
            <a class="btn" href="#/financing/prequalify?price=${maxPrice}&deposit=${dep}&tenor=${tenor}">Pre-qualify</a>
          </div>
        </div>
        ${
          panel && panel.lenders.length
            ? `<div class="afford-block"><h3>What each lender would allow</h3>
              <p class="muted" style="margin-top:-8px">Same income, different rules. This is why comparing lenders is worth the ten minutes.</p>
              <div class="scroll-x"><table class="tbl">
                <thead><tr><th>Lender</th><th class="num">Deposit</th><th class="num">Max car price</th></tr></thead>
                <tbody>${panel.lenders
                  .slice(0, 8)
                  .map(
                    (l) =>
                      `<tr><td><span class="tag" style="background:${esc(l.lender.color)};color:#fff;border:0">${esc(l.lender.logo_text)}</span> ${esc(l.lender.name)}</td>
                       <td class="num">${l.minDepositPct}%</td><td class="num"><b>${KES(l.maxPrice)}</b></td></tr>`
                  )
                  .join('')}</tbody>
              </table></div></div>`
            : ''

        }
        <div class="afford-block">
          <div class="row between wrap-r">
            <h3 style="margin:0">${matches.total} car${matches.total === 1 ? '' : 's'} you could buy</h3>
            ${matches.total > 6 ? `<a class="btn ghost sm" href="#/browse?maxPrice=${maxPrice}">See all ${matches.total} →</a>` : ''}
          </div>
          <div class="veh-grid mt">${matches.items.slice(0, 6).map(vehicleCard).join('') || '<div class="empty">Nothing in stock at that price yet.</div>'}</div>
        </div>`;
    }, 260);

    on($('#aAgg'), 'click', '[data-agg]', (e, el) => {
      $$('#aAgg .pill').forEach((p) => p.classList.toggle('on', p === el));
      agg = Number(el.dataset.agg);
      refresh();
    });
    on($('#aTen'), 'click', '[data-ten]', (e, el) => {
      $$('#aTen .pill').forEach((p) => p.classList.toggle('on', p === el));
      tenor = Number(el.dataset.ten);
      refresh();
    });
    ['aInc', 'aObl', 'aDep', 'aRate'].forEach((id) => ($('#' + id).oninput = refresh));
    refresh();
  }

  /* --- tab 3: lender comparison --- */
  async function finCompare(box, query) {
    box.innerHTML = `
      <h2>Compare every lender side by side</h2>
      <p class="muted">The same deal, quoted by all ${S.boot.lenders.length} partners. Sorted so the cheapest is first.</p>
      <div class="card mb">
        <div class="grid-3">
          <div class="field"><label>Vehicle price (KES)</label><input type="number" id="kPrice" value="${Number(query.price) || 2500000}"></div>
          <div class="field"><label>Deposit (KES)</label><input type="number" id="kDep" value="${Number(query.deposit) || 500000}"></div>
          <div class="field"><label>Term (months)</label>
            <select id="kTen">${panelTerms([12, 24, 36, 48, 60, 72]).map((t) => `<option value="${t}" ${t === (Number(query.tenor) || 48) ? 'selected' : ''}>${t} months</option>`).join('')}</select>
          </div>
        </div>
      </div>
      <div id="kOut"><div class="spinner"></div></div>`;

    const refresh = debounce(async () => {
      const res = await POST('/api/quote', {
                price: Number($('#kPrice').value) || 0,
        deposit: Number($('#kDep').value) || 0,
        tenor: Number($('#kTen').value),
        applicant: {},
      }).catch((e) => ({ error: e.message }));
      if (res.error) return ($('#kOut').innerHTML = `<div class="card err-text">${esc(res.error)}</div>`);
      $('#kOut').innerHTML = `<div class="bank-grid">${res.offers.map(bankCard).join('')}</div>`;
    }, 220);
    ['kPrice', 'kDep'].forEach((id) => ($('#' + id).oninput = refresh));
    $('#kTen').onchange = refresh;
    refresh();
  }

  function bankCard(o) {
    const l = o.lender;
    return `<div class="card bankc ${o.eligible ? '' : 'blocked'}" style="--lender:${esc(l.color)}">
      <div class="row" style="gap:10px;align-items:flex-start">
        <div class="badge-lender" style="background:${esc(l.color)};width:38px;height:38px;border-radius:9px;font-size:.78rem">${esc(l.logo_text || '?')}</div>
        <div class="grow">
          <b style="display:block">${esc(l.short_name || l.name)}</b>
          <span class="dim" style="font-size:.78rem">${o.annualRate}% ${o.rateType === 'flat' ? 'flat' : 'p.a.'} · ${esc(LENDER_TYPE_LABEL[l.type] || l.type)}</span>
        </div>
      </div>
      <div style="font-size:1.7rem;font-weight:750;letter-spacing:-.03em;margin-top:12px">${KES(o.monthlyPayment)}</div>
      <div class="dim" style="font-size:.8rem">/month · ${o.rateType === 'flat' ? 'flat rate' : 'reducing balance'}</div>
      <table class="tbl mt">
        <tr><td>Loan amount</td><td class="num">${KES(o.principal)}</td></tr>
        <tr><td>Total interest</td><td class="num">${KES(o.totalInterest)}</td></tr>
        <tr><td>Total to repay</td><td class="num">${KES(o.totalRepaid)}</td></tr>
        <tr><td>True APR</td><td class="num">${o.apr}%</td></tr>
      </table>
      ${(o.badges || []).map((b) => `<span class="tag ok">${esc(b)}</span>`).join(' ')}
      ${o.blockers.length ? `<div class="err-text mt" style="font-size:.8rem">${esc(o.blockers[0])}</div>` : ''}
      <a class="btn ${o.eligible ? 'primary' : ''} block mt" href="#/financing/prequalify?price=${o.price}&deposit=${o.deposit}&tenor=${o.tenorMonths}&lender=${o.lenderId}">Apply with ${esc(l.short_name || l.name)}</a>
    </div>`;
  }

  /* --- tab 4: running cost --- */
  async function finRunning(box, query) {
    const cars = (await GET(`/api/vehicles?${dq()}&pageSize=60`)).items;
    const preset = query.vehicle ? cars.find((c) => c.id === Number(query.vehicle)) : null;

    box.innerHTML = `
      <div class="lbl">The real cost of ownership</div>
      <h2>It's not just the monthly payment.</h2>
      <p class="muted">Fuel, insurance, servicing, tyres and licensing — add them to the instalment and see the number that actually leaves your account.</p>
      <div class="split-r">
        <div class="card">
          <div class="field"><label>Pick a car from stock (optional)</label>
            <select id="rCar"><option value="">Enter details manually</option>
              ${cars.map((c) => `<option value="${c.id}" ${preset && preset.id === c.id ? 'selected' : ''}>${esc(c.title)} — ${KES(c.price)}</option>`).join('')}
            </select>
          </div>
          <div class="grid-2">
            <div class="field" id="rPriceField">
              <label>Vehicle price (KES)</label>
              <input type="number" id="rPrice" value="${preset ? preset.price : 3000000}">
              <div class="locked-price hide" id="rPriceLocked"></div>
            </div>
            <div class="field"><label>Vehicle age (years)</label><input type="number" id="rAge" value="${preset ? preset.age : 5}"></div>
          </div>
          <label class="lbl">Engine size</label>
          <div class="pills" id="rEng">
            ${[1.0, 1.3, 1.5, 1.8, 2.0, 2.5, 3.0, 4.0].map((e) => `<button class="pill ${e === 2.0 ? 'on' : ''}" data-eng="${e}">${e.toFixed(1)}L</button>`).join('')}
          </div>
          <label class="lbl mt">Fuel type</label>
          <div class="pills" id="rFuel">
            ${['Petrol', 'Diesel', 'Hybrid', 'Electric'].map((f) => `<button class="pill ${f === 'Petrol' ? 'on' : ''}" data-fuel="${f}">${f}</button>`).join('')}
          </div>
          <label class="lbl mt">Kilometres per year — <b id="rKmLabel">15,000 km</b></label>
          <input type="range" id="rKm" min="3000" max="60000" step="1000" value="15000">
          <label class="check mt"><input type="checkbox" id="rComp" checked><span>Comprehensive insurance <span class="dim">(off = third party only)</span></span></label>
          <label class="check"><input type="checkbox" id="rLoan" checked><span>Include loan repayment <span class="dim">(off = bought outright)</span></span></label>
          <div class="grid-2" id="rLoanBox">
            <div class="field"><label>Deposit (KES)</label><input type="number" id="rDep" value="600000"></div>
            <div class="field"><label>Term (months)</label><select id="rTen">${[24, 36, 48, 60].map((t) => `<option value="${t}" ${t === 48 ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
          </div>
        </div>
        <aside class="sticky" id="rOut"><div class="spinner"></div></aside>
      </div>`;

    let engine = preset && preset.engine_cc ? Math.round((preset.engine_cc / 1000) * 10) / 10 : 2.0;
    let fuel = preset ? preset.fuel || 'Petrol' : 'Petrol';
    const syncPills = () => {
      $$('#rEng .pill').forEach((p) => p.classList.toggle('on', Number(p.dataset.eng) === engine));
      $$('#rFuel .pill').forEach((p) => p.classList.toggle('on', p.dataset.fuel === fuel));
    };
    syncPills();

    const refresh = debounce(async () => {
      const km = Number($('#rKm').value);
      $('#rKmLabel').textContent = km.toLocaleString() + ' km';
      $('#rLoanBox').classList.toggle('hide', !$('#rLoan').checked);
      const chosen = Number($('#rCar').value) || null;
      const res = await POST('/api/running-cost', {
        vehicleId: chosen,
        price: Number($('#rPrice').value) || 0,
        ageYears: Number($('#rAge').value) || 0,
        engineLitres: engine,
        fuel,
        bodyType: chosen ? undefined : $('#rBody') ? $('#rBody').value : undefined,
        kmPerYear: km,
        comprehensive: $('#rComp').checked,
        includeLoan: $('#rLoan').checked,
        deposit: Number($('#rDep').value) || 0,
        tenor: Number($('#rTen').value),
      }).catch((e) => ({ error: e.message }));
      if (res.error) return ($('#rOut').innerHTML = `<div class="card err-text">${esc(res.error)}</div>`);

      const max = Math.max(...res.lines.map((l) => l.annual)) || 1;
      const ec = res.economy || {};
      $('#rOut').innerHTML = `
        <div class="card">
          <div class="lbl">Total cost of ownership</div>
          <div style="font-size:2.2rem;font-weight:750;letter-spacing:-.03em;line-height:1.05">${KES(res.totalMonthly)}<span class="muted" style="font-size:.95rem;font-weight:500"> / month</span></div>
          <div class="muted">${KES(res.totalAnnual)} a year · KES ${res.perKm.toFixed(2)} per kilometre</div>

          <div class="stat-strip mt">
            <div class="s"><div class="k">Economy</div><div class="v">${ec.kmPerLitre || ec.kmPerKwh || '—'}</div><div class="d">${ec.fuel === 'electric' ? 'km per kWh' : 'km per litre'}</div></div>
            <div class="s"><div class="k">Fuel per 100 km</div><div class="v">${KES(ec.costPer100Km || 0)}</div><div class="d">${ec.fuel === 'electric' ? `${ec.kwhPer100} kWh` : `${ec.litresPer100} litres`}</div></div>
            ${ec.tankToNairobiMombasa ? `<div class="s"><div class="k">Nairobi → Mombasa</div><div class="v">${KES(ec.tankToNairobiMombasa)}</div><div class="d">485 km of fuel</div></div>` : ''}
            <div class="s"><div class="k">Service tier</div><div class="v" style="text-transform:capitalize">${esc(res.servicing.tier)}</div><div class="d">every ${num(res.servicing.intervalKm)} km</div></div>
          </div>
          <hr>
          ${res.lines
            .map(
              (l) => `<div style="margin-bottom:11px;${l.annual ? '' : 'opacity:.5'}">
                <div class="row between" style="font-size:.87rem"><span>${esc(l.label)}</span><b>${KES(Math.round(l.annual / 12))}<span class="dim" style="font-weight:400">/mo</span></b></div>
                <div class="bar" style="margin-top:4px"><i style="width:${(l.annual / max) * 100}%"></i></div>
                <div class="dim" style="font-size:.74rem;margin-top:3px">${esc(l.detail)}</div>
              </div>`
            )
            .join('')}
          <hr>
          ${/* Broken out rather than summed into one figure. The old single total sat
                under "running costs only" and read as five years of running costs, when
                most of it was the loan repaying the car. */ ''}
          <div class="row between"><span class="muted">Running costs only (no loan)</span><b>${KES(res.runningOnlyMonthly)}/mo</b></div>
          <div class="row between mt"><span class="muted">Running costs over 5 years</span><b>${KES(res.fiveYearRunning)}</b></div>
          ${
            res.fiveYearLoan
              ? `<div class="row between"><span class="muted">Loan repayments (${res.fiveYearLoanMonths} months)</span><b>${KES(res.fiveYearLoan)}</b></div>
                 <div class="row between mt" style="border-top:1px solid var(--line);padding-top:8px">
                   <span><b>Everything, over 5 years</b></span><b style="font-size:1.1rem">${KES(res.fiveYearTotal)}</b>
                 </div>`
              : ''
          }
          <div class="dim mt" style="font-size:.8rem">
            Running costs alone come to <b>${res.fiveYearRunningVsPrice}%</b> of what you paid for the car.
            ${res.fiveYearLoan ? `With the loan on top it is ${res.fiveYearVsPrice}% — a loan repays the price plus interest, so that part is expected.` : ''}
          </div>
          ${
            res.resale
              ? `<div class="panel mt"><div class="lbl" style="margin:0">What it will be worth in 3 years</div>
                 <div class="row between"><b style="font-size:1.15rem">${KES(res.resale.estimatedValue)}</b>
                 <span class="tag ${res.resale.strongHolder ? 'ok' : 'warn'}">${res.resale.retentionPerYear}% a year</span></div>
                 <div class="dim" style="font-size:.8rem">${esc(res.resale.make)} ${res.resale.strongHolder ? 'holds its value well in Kenya' : 'depreciates faster than a Toyota equivalent'} — that is ${KES(res.resale.lossPerMonth)} a month of value lost.</div>
                 ${
                   res.resale.basis && res.resale.basis.variantAware
                     ? `<div class="dim mt" style="font-size:.76rem">Starts from the badge (${res.resale.basis.badge}% a year) and is then adjusted for this exact variant — its body, its fuel and its engine size. Two cars wearing the same badge do not hold value the same way.</div>`
                     : ''
                 }</div>`
              : ''
          }
          ${res.loan ? `<div class="tag mt">Loan quoted with ${esc(res.loan.lender.name)}</div>` : ''}
          <div class="dim mt" style="font-size:.76rem">
            Fuel at ${KES(res.assumptions.petrol_price)}/L petrol, ${KES(res.assumptions.diesel_price)}/L diesel${res.fuelPriceAge ? ` — ${esc(res.fuelPriceAge.label)}` : ''}.
            Prices track the EPRA cycle automatically.
          </div>
          <a class="btn ghost block mt" href="#/financing/insurance">Compare insurance options →</a>
        </div>`;
    }, 220);

    const lockR = () => {
      const c = cars.find((x) => x.id === Number($('#rCar').value));
      const box = $('#rPriceLocked');
      const input = $('#rPrice');
      if (c) {
        input.value = c.price;
        input.classList.add('hide');
        box.classList.remove('hide');
        box.innerHTML = `${KES(c.price)} <span class="lock">🔒 our listed price</span>`;
      } else {
        input.classList.remove('hide');
        box.classList.add('hide');
      }
      return c;
    };
    $('#rCar').onchange = () => {
      const c = lockR();
      if (c) {
        $('#rAge').value = c.age;
        if (c.engine_cc) engine = Math.round((c.engine_cc / 1000) * 10) / 10;
        if (c.fuel) fuel = c.fuel;
        syncPills();
      }
      refresh();
    };
    lockR();
    on($('#rEng'), 'click', '[data-eng]', (e, el) => {
      engine = Number(el.dataset.eng);
      syncPills();
      refresh();
    });
    on($('#rFuel'), 'click', '[data-fuel]', (e, el) => {
      fuel = el.dataset.fuel;
      syncPills();
      refresh();
    });
    ['rPrice', 'rAge', 'rKm', 'rDep'].forEach((id) => ($('#' + id).oninput = refresh));
    ['rComp', 'rLoan', 'rTen'].forEach((id) => ($('#' + id).onchange = refresh));
    refresh();
  }

  /* --- tab 5: insurance --- */
  async function finInsurance(box, query) {
    const cars = (await GET(`/api/vehicles?${dq()}&pageSize=60`)).items;
    const preset = query.vehicle ? cars.find((c) => c.id === Number(query.vehicle)) : null;
    box.innerHTML = `
      <div class="lbl">Insurance</div>
      <h2>Compare insurance options.</h2>
      <p class="muted">Comprehensive or third party — what each one covers, and what the difference actually costs you.</p>
      <div class="split-r">
        <div class="card">
          <div class="field"><label>Pick a car from stock (optional)</label>
            <select id="iCar"><option value="">Enter a value instead</option>
              ${cars.map((c) => `<option value="${c.id}" ${preset && preset.id === c.id ? 'selected' : ''}>${esc(c.title)} — ${KES(c.price)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Vehicle value (KES)</label>
            <input type="number" id="iVal" value="${preset ? preset.price : 3000000}">
            <div class="locked-price hide" id="iValLocked"></div>
          </div>
          <label class="lbl">Vehicle age</label>
          <div class="pills" id="iAge">
            ${[[2, '1–3 years'], [6, '4–7 years'], [10, '8–12 years'], [15, '13+ years']].map((a, i) => `<button class="pill ${i === 0 ? 'on' : ''}" data-age="${a[0]}">${a[1]}</button>`).join('')}
          </div>
          <label class="lbl mt">Optional extras</label>
          <div id="iAddons"></div>
        </div>
        <aside class="sticky" id="iOut"><div class="spinner"></div></aside>
      </div>`;

    let age = preset ? preset.age : 2;
    const addons = {};
    $$('#iAge .pill').forEach((p) => p.classList.toggle('on', Number(p.dataset.age) === age));

    const refresh = debounce(async () => {
      const res = await POST('/api/insurance', {
        value: Number($('#iVal').value) || 0,
        ageYears: age,
        addons,
      }).catch((e) => ({ error: e.message }));
      if (res.error) return ($('#iOut').innerHTML = `<div class="card err-text">${esc(res.error)}</div>`);

      $('#iAddons').innerHTML = res.addons
        .map(
          (a) => `<label class="check"><input type="checkbox" data-addon="${a.key}" ${a.selected ? 'checked' : ''}>
            <span><b>${esc(a.label)}</b> <span class="dim">~${KES(a.amount)}/year</span><br><span class="dim" style="font-size:.8rem">${esc(a.note)}</span></span></label>`
        )
        .join('');

      $('#iOut').innerHTML = `
        <div class="grid-2" style="gap:14px">
          ${res.options
            .map(
              (o, i) => `<div class="card ${i === 0 ? '' : 'muted-card'}" style="${i === 0 ? 'border-color:var(--brand)' : ''}">
              <div class="row between"><b>${esc(o.label)}</b>${i === 0 ? '<span class="tag brand">Required under finance</span>' : ''}</div>
              <div style="font-size:1.7rem;font-weight:750;letter-spacing:-.03em;margin-top:6px">${KES(o.annual)}</div>
              <div class="dim" style="font-size:.8rem">per year · ${KES(Math.round(o.annual / 12))}/month${o.rate ? ` · ${o.rate}% of value` : ''}</div>
              ${o.addons ? `<div class="dim" style="font-size:.78rem">includes ${KES(o.addons)} of extras</div>` : ''}
              <div class="lbl mt">Covers</div>
              <ul class="muted" style="padding-left:18px;font-size:.84rem;margin:0">${o.covers.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
              <div class="lbl mt">Does not cover</div>
              <ul class="dim" style="padding-left:18px;font-size:.84rem;margin:0">${o.excludes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
            </div>`
            )
            .join('')}
        </div>
        <div class="card mt">
          <div class="row between"><span>Comprehensive costs you</span><b>${KES(res.difference)} more a year</b></div>
          <div class="row between"><span class="muted">That is</span><b>${KES(res.monthlyDifference)} a month</b></div>
          <div class="muted mt" style="font-size:.86rem">${esc(res.note)}</div>
          <a class="btn ghost block mt" href="#/financing/running">See it inside the full running cost →</a>
        </div>`;

      on($('#iAddons'), 'change', '[data-addon]', (e, el) => {
        addons[el.dataset.addon] = el.checked;
        refresh();
      });
    }, 200);

    const lockI = () => {
      const c = cars.find((x) => x.id === Number($('#iCar').value));
      const box = $('#iValLocked');
      const input = $('#iVal');
      if (c) {
        input.value = c.price;
        input.classList.add('hide');
        box.classList.remove('hide');
        box.innerHTML = `${KES(c.price)} <span class="lock">🔒 our listed price</span>`;
      } else {
        input.classList.remove('hide');
        box.classList.add('hide');
      }
      return c;
    };
    $('#iCar').onchange = () => {
      const c = lockI();
      if (c) {
        age = c.age;
        $$('#iAge .pill').forEach((p) => p.classList.toggle('on', Number(p.dataset.age) === age));
      }
      refresh();
    };
    lockI();
    $('#iVal').oninput = refresh;
    on($('#iAge'), 'click', '[data-age]', (e, el) => {
      $$('#iAge .pill').forEach((p) => p.classList.toggle('on', p === el));
      age = Number(el.dataset.age);
      refresh();
    });
    refresh();
  }

  /* --- tab 6: pre-qualify --- */
  function finPrequalify(box, query) {
    const p = S.profile;
    box.innerHTML = `
      <div class="lbl">Get pre-qualified</div>
      <h2>Apply once, hear back from every lender.</h2>
      <p class="muted">One form. We run it against all ${S.boot.lenders.length} partners on the panel and tell you immediately who would lend to you — then ${esc(S.dealer.name)} follows up within one working day.</p>
      <div class="split-r">
        <div class="card">
          <div class="grid-2">
            <div class="field"><label>Full name *</label><input type="text" id="qName" value="${esc(S.user ? S.user.name : '')}"></div>
            <div class="field"><label>Phone *</label><input type="tel" id="qPhone" placeholder="+254…"></div>
            <div class="field"><label>Email</label><input type="email" id="qEmail" value="${esc(S.user ? S.user.email : '')}"></div>
            <div class="field"><label>National ID</label><input type="text" id="qId"></div>
            <div class="field"><label>Net monthly income (KES) *</label><input type="number" id="qInc" value="${esc(p.netIncome)}"></div>
            <div class="field"><label>Existing monthly repayments</label><input type="number" id="qObl" value="${esc(p.obligations)}"></div>
            <div class="field"><label>How you earn</label><select id="qEmp">
              ${Object.entries(EMPLOYMENT_LABEL).map(([k, l]) => `<option value="${k}" ${p.employment === k ? 'selected' : ''}>${l}</option>`).join('')}
            </select></div>
            <div class="field"><label>Your age</label><input type="number" id="qAge" value="${esc(p.age)}"></div>
            <div class="field"><label>Target car price (KES) *</label><input type="number" id="qPrice" value="${Number(query.price) || 2500000}"></div>
            <div class="field"><label>Deposit you can raise (KES)</label><input type="number" id="qDep" value="${Number(query.deposit) || 500000}"></div>
            <div class="field"><label>Term</label><select id="qTen">
              ${panelTerms([24, 36, 48, 60, 72]).map((t) => `<option value="${t}" ${t === (Number(query.tenor) || 48) ? 'selected' : ''}>${t} months</option>`).join('')}
            </select></div>
          </div>
          <label class="check"><input type="checkbox" id="qCrb" ${p.crbClean ? 'checked' : ''}><span>My CRB record is clean</span></label>
          ${honeypot()}
          <label class="check"><input type="checkbox" id="qConsent"><span>I authorise ${esc(S.dealer.name)} and its finance partners to contact me and verify these details.</span></label>
          <button class="btn primary block lg mt" id="qGo">Check which lenders would approve me</button>
          <small class="dim" style="display:block;margin-top:8px">This is an indicative screening, not a credit decision, and it does not affect your CRB record.</small>
        </div>
        <aside class="sticky" id="qOut">
          <div class="card empty">Fill in the form to see who would lend to you.</div>
        </aside>
      </div>`;

    $('#qGo').onclick = async () => {
      if (!$('#qConsent').checked) return toast('Please tick the authorisation box', 'err');
      const btn = $('#qGo');
      btn.disabled = true;
      btn.textContent = 'Checking…';
      try {
        const res = await POST('/api/prequalify', {
                    name: $('#qName').value,
          phone: $('#qPhone').value,
          email: $('#qEmail').value,
          idNumber: $('#qId').value,
          netIncome: Number($('#qInc').value),
          obligations: Number($('#qObl').value) || 0,
          employment: $('#qEmp').value,
          age: Number($('#qAge').value) || 0,
          crbClean: $('#qCrb').checked,
          targetPrice: Number($('#qPrice').value),
          deposit: Number($('#qDep').value) || 0,
          tenor: Number($('#qTen').value),
          utm: utm(),
          ...botFields(),
        });
        S.profile = {
          netIncome: $('#qInc').value,
          obligations: $('#qObl').value,
          employment: $('#qEmp').value,
          crbClean: $('#qCrb').checked,
          age: $('#qAge').value,
        };
        store.set('profile', S.profile);
        const yes = res.offers.filter((o) => o.eligible);
        $('#qOut').innerHTML = `
          <div class="card">
            <div class="row between"><div class="lbl" style="margin:0">Your reference</div><span class="mono">${esc(res.ref)}</span></div>
            <div style="font-size:2.2rem;font-weight:750;letter-spacing:-.03em;line-height:1.1">${res.eligibleCount} of ${res.total}</div>
            <div class="muted">lenders would consider you on these terms.</div>
            ${yes.length ? `<div class="panel mt"><div class="lbl" style="margin:0">Best monthly payment</div><b style="font-size:1.3rem">${KES(Math.min(...yes.map((o) => o.monthlyPayment)))}</b></div>` : ''}
            <hr>
            ${res.offers
              .slice(0, 8)
              .map(
                (o) => `<div class="row between" style="padding:7px 0;border-bottom:1px solid var(--line)">
                  <span style="font-size:.87rem">${o.eligible ? '<span class="tag ok">✓</span>' : '<span class="tag err">✕</span>'} ${esc(o.lender.short_name || o.lender.name)}</span>
                  <span style="font-size:.87rem">${o.eligible ? `<b>${KES(o.monthlyPayment)}</b>/mo` : `<span class="dim">${esc((o.blockers[0] || '').slice(0, 44))}</span>`}</span>
                </div>`
              )
              .join('')}
            <a class="btn primary block mt" href="#/browse?maxPrice=${Number($('#qPrice').value)}">Browse cars in this range</a>
            <a class="btn wa block mt" href="${esc(waLink(`Hi ${S.dealer.name}, I pre-qualified on your site (ref ${res.ref}) — ${res.eligibleCount} lenders matched. Can you help me pick a car?`))}" target="_blank" rel="noopener">Continue on WhatsApp</a>
          </div>`;
        toast('Pre-qualification saved — the dealership will follow up', 'ok');
      } catch (e) {
        toast(e.message, 'err');
      }
      btn.disabled = false;
      btn.textContent = 'Check which lenders would approve me';
    };
  }

  /* --- tab 7: FAQs --- */
  async function finFaq(box) {
    const faqs = await GET(`/api/faq?${dq()}`);
    box.innerHTML = `
      <h2>Financing questions, answered</h2>
      <p class="muted">Generated from the live rules of the ${S.boot.lenders.length} lenders on ${esc(S.dealer.name)}'s panel — so it stays true when the rates change.</p>
      <div class="faqs">${faqs
        .map(
          (f, i) => `<details ${i === 0 ? 'open' : ''}><summary>${esc(f.q)}</summary><p class="muted">${esc(f.a)}</p></details>`
        )
        .join('')}</div>
      <div class="card mt-lg row between wrap-r">
        <div><h3 style="margin:0">Still not sure?</h3><p class="muted" style="margin:0">Talk to ${esc(S.dealer.name)} directly.</p></div>
        <div class="row">
          <a class="btn wa" href="${esc(waLink(`Hi ${S.dealer.name}, I have a question about financing.`))}" target="_blank" rel="noopener">WhatsApp us</a>
          <a class="btn" href="#/contact">Contact page</a>
        </div>
      </div>`;
  }

  /* ---------------- checkout: reserve a car online ---------------- */

  async function pageCheckout(vehicleId) {
    view.innerHTML = `<div class="mt">${skelLines(5)}</div>`;
    let q;
    try {
      q = await GET(`/api/checkout/${vehicleId}`);
    } catch (e) {
      view.innerHTML = `<div class="card mt-lg err-text">${esc(e.message)}</div>`;
      return;
    }
    const v = q.vehicle;
    if (!q.available) {
      view.innerHTML = `<div class="card mt-lg center" style="max-width:560px;margin:40px auto">
        <h2>${esc(v.title)} is already held</h2>
        <p class="muted">Someone reserved this one. We can tell you if it comes back, or show you something similar.</p>
        <div class="row mt" style="justify-content:center">
          <a class="btn primary" href="#/browse">See similar cars</a>
          <button class="btn" data-lead="callback" data-veh="${v.id}">Tell me if it frees up</button>
        </div>
      </div>`;
      return;
    }

    view.innerHTML = `
      <nav class="crumbs mt"><a href="#/">Home</a> <span>›</span> <a href="#/vehicle/${v.id}">${esc(v.title)}</a> <span>›</span> <b>Reserve</b></nav>
      <h1 class="mt">Reserve this car</h1>
      <p class="muted">Pay the booking deposit and we hold it in your name for ${q.holdDays} days. It comes off the price — it is not an extra.</p>

      <div class="split-r mt">
        <div class="card" id="coBody">
          <h3>Your details</h3>
          <div class="grid-2">
            <div class="field"><label for="coName">Full name *</label><input type="text" id="coName" value="${esc(S.user ? S.user.name : '')}"><div class="msg"></div></div>
            <div class="field"><label for="coPhone">Phone (M-Pesa number) *</label><input type="tel" id="coPhone" placeholder="0712 345 678"><div class="msg"></div></div>
          </div>
          <div class="field"><label for="coEmail">Email</label><input type="email" id="coEmail" value="${esc(S.user ? S.user.email : '')}"><div class="msg"></div></div>

          <h3 class="mt">How would you like to pay?</h3>
          <div class="stack" id="coMethods">
            ${q.methods
              .map(
                (m, i) => `<label class="check" style="border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:0">
                  <input type="radio" name="method" value="${m.key}" ${i === 0 ? 'checked' : ''}>
                  <span><b>${esc(m.label)}</b>${m.instant ? ' <span class="tag ok">instant</span>' : ''}<br>
                  <span class="dim" style="font-size:.84rem">${esc(m.note)}</span></span>
                </label>`
              )
              .join('')}
          </div>

          <div class="field mt"><label for="coNotes">Anything we should know?</label><textarea id="coNotes" placeholder="Collection date, questions, part exchange…"></textarea></div>
          ${honeypot()}
          <label class="check"><input type="checkbox" id="coTerms"><span>I have read and accept the booking terms below.</span></label>
          <button class="btn primary block lg mt" id="coGo">Pay ${KES(q.bookingFee)} and hold this car</button>
          <div id="coMsg" class="mt"></div>
        </div>

        <aside class="sticky stack">
          <div class="card">
            <div class="row" style="gap:12px">
              <img src="${esc(vehImg(v))}" style="width:96px;border-radius:9px" alt="">
              <div><div style="font-weight:650">${esc(v.title)}</div><div class="muted" style="font-size:.85rem">${esc(CONDITION_LABEL[v.condition] || '')}</div></div>
            </div>
            <hr>
            <table class="tbl">
              <tr><td>Vehicle price</td><td class="num">${KES(v.price)}</td></tr>
              <tr style="font-weight:700"><td>Booking deposit today</td><td class="num">${KES(q.bookingFee)}</td></tr>
              <tr><td>Balance on collection</td><td class="num">${KES(q.balance)}</td></tr>
              <tr><td>Held for</td><td class="num">${q.holdDays} days</td></tr>
            </table>
            <a class="btn ghost block mt" href="#/finance/${v.id}">Finance the balance instead →</a>
          </div>
          <div class="card">
            <div class="lbl">Booking terms</div>
            <ul class="muted" style="padding-left:18px;font-size:.85rem;margin:0">
              ${q.terms.map((t) => `<li>${esc(t)}</li>`).join('')}
            </ul>
          </div>
        </aside>
      </div>`;

    $('#coGo').onclick = async () => {
      clearErrors(view);
      const btn = $('#coGo');
      if (!$('#coTerms').checked) return toast('Please accept the booking terms', 'err');
      btn.disabled = true;
      btn.textContent = 'Starting payment…';
      try {
        const res = await POST('/api/checkout', {
          vehicleId: v.id,
          name: $('#coName').value,
          phone: $('#coPhone').value,
          email: $('#coEmail').value,
          method: $$('#coMethods input:checked')[0].value,
          notes: $('#coNotes').value,
          utm: utm(),
          ...botFields(),
        });
        awaitPayment(res, v, q);
      } catch (e) {
        showFormError(e, view);
        btn.disabled = false;
        btn.textContent = `Pay ${KES(q.bookingFee)} and hold this car`;
      }
    };
  }

  /** Pending → paid. Polls the server; in simulator mode offers a button to complete it. */
  function awaitPayment(res, v, q) {
    $('#coBody').innerHTML = `
      <div class="center" style="padding:22px 6px">
        <div class="spinner" style="margin:10px auto 18px"></div>
        <h2 style="margin-bottom:6px">Waiting for your payment</h2>
        <p class="muted">${esc(res.message || 'Follow the prompt to complete the payment.')}</p>
        <div class="panel mt" style="display:inline-block;text-align:left">
          <div class="lbl" style="margin:0">Booking reference</div>
          <span class="mono" style="font-size:1.1rem;font-weight:700">${esc(res.ref)}</span>${copyBtn(res.ref)}
        </div>
        ${
          res.canSimulate
            ? `<div class="form-note mt" style="text-align:left"><span>⚙</span><div>
                 <b>Demo mode.</b> No real money moves. Use these to show either outcome.
                 <div class="row mt" style="gap:8px"><button class="btn sm primary" id="simOk">Simulate a successful payment</button>
                 <button class="btn sm" id="simFail">Simulate a cancellation</button></div>
               </div></div>`
            : ''
        }
      </div>`;

    const finish = async () => {
      const s = await GET(`/api/checkout/status?ref=${encodeURIComponent(res.ref)}`);
      if (s.status === 'paid') {
        clearInterval(poll);
        $('#coBody').innerHTML = successPanel(
          'Reserved — it is yours to collect',
          `We have held the <b>${esc(v.title)}</b> until <b>${dateFmt(s.holdUntil)}</b>.
           ${esc(S.dealer.name)} will call you today to arrange collection.`,
          `<div class="panel mt" style="display:inline-block;text-align:left">
             <div class="row between" style="gap:24px"><span class="dim">Booking</span><span class="mono">${esc(s.ref)}</span></div>
             <div class="row between" style="gap:24px"><span class="dim">Receipt</span><span class="mono">${esc(s.receipt || '—')}</span></div>
             <div class="row between" style="gap:24px"><span class="dim">Paid</span><span>${KES(s.amount)}</span></div>
             <div class="row between" style="gap:24px"><span class="dim">Balance</span><span>${KES(q.balance)}</span></div>
           </div>
           <div class="row mt no-print" style="justify-content:center">
             <button class="btn primary" data-act="print">Print this receipt</button>
             <a class="btn" href="#/finance/${v.id}">Arrange financing for the balance</a>
             <a class="btn ghost" href="#/browse">Back to the yard</a>
           </div>`
        );
        toast('Payment received — vehicle held', 'ok');
      } else if (s.status === 'failed' || s.status === 'cancelled') {
        clearInterval(poll);
        $('#coBody').innerHTML = `<div class="form-note err"><span>✕</span><div>
          <b>That payment did not go through.</b>
          <div class="dim">${esc((s.events.slice(-1)[0] || {}).message || 'No further detail.')}</div>
          <button class="btn sm mt" data-act="reload">Try again</button></div></div>`;
      }
    };
    const poll = setInterval(finish, 2500);

    const sim = async (success) => {
      await POST('/api/checkout/callback', { ref: res.ref, success, providerRef: 'SIM', receipt: success ? 'SIM' + Date.now().toString().slice(-6) : undefined, reason: 'Cancelled on the handset' });
      finish();
    };
    if ($('#simOk')) $('#simOk').onclick = () => sim(true);
    if ($('#simFail')) $('#simFail').onclick = () => sim(false);
  }

  /* ---------------- offer letter ---------------- */

  async function pageOfferLetter(query) {
    const ref = query.ref || '';
    if (!ref) {
      view.innerHTML = `<h1 class="mt">Your offer letter</h1>
        <div class="card" style="max-width:520px">
          <p class="muted">Enter the reference from your application and the phone number you applied with.</p>
          <div class="field"><label for="olRef">Application reference</label><input type="text" id="olRef" placeholder="MK-2609-A1B2C3"><div class="msg"></div></div>
          <div class="field"><label for="olPhone">Phone number</label><input type="tel" id="olPhone" placeholder="0712 345 678"><div class="msg"></div></div>
          <button class="btn primary block" id="olGo">Open my offer letter</button>
        </div>`;
      $('#olGo').onclick = () => go(`#/offer?ref=${encodeURIComponent($('#olRef').value.trim())}&phone=${encodeURIComponent($('#olPhone').value.trim())}`);
      return;
    }

    view.innerHTML = `<div class="mt">${skelLines(6)}</div>`;
    let L;
    try {
      L = await GET(`/api/offer-letter?ref=${encodeURIComponent(ref)}&phone=${encodeURIComponent(query.phone || '')}`);
    } catch (e) {
      view.innerHTML = `<div class="card mt-lg"><div class="form-note err"><span>✕</span><div>${esc(e.message)}</div></div>
        <a class="btn mt" href="#/offer">Try another reference</a></div>`;
      return;
    }

    view.innerHTML = `
      <div class="row between wrap-r mt no-print">
        <a href="#/track?ref=${encodeURIComponent(L.applicationRef)}" class="dim">← Back to your application</a>
        <div class="row">
          <button class="btn" data-act="print">Print / save as PDF</button>
          ${copyBtn(location.href, 'Copy link')}
        </div>
      </div>
      <div class="letter mt">
        <div class="head">
          <div class="row" style="gap:12px;align-items:center">
            <div class="mark">${esc(L.dealer.logoText || '')}</div>
            <div>
              <div style="font-weight:700;font-size:1.05rem">${esc(L.dealer.name)}</div>
              <div style="font-size:.82rem;color:#4b5563">${esc(L.dealer.address || '')}</div>
              <div style="font-size:.82rem;color:#4b5563">${esc(L.dealer.phone || '')} · ${esc(L.dealer.email || '')}</div>
            </div>
          </div>
          <div style="text-align:right;font-size:.84rem;color:#4b5563">
            <div><b>${esc(L.ref)}</b></div>
            <div>${esc(L.issuedOnLabel)}</div>
          </div>
        </div>

        <div style="margin-bottom:22px">
          <div><b>${esc(L.customer.name)}</b></div>
          ${L.customer.address ? `<div>${esc(L.customer.address)}</div>` : ''}
          ${L.customer.phone ? `<div>${esc(L.customer.phone)}</div>` : ''}
        </div>

        <h1>${esc(L.subject)}</h1>
        <p>${esc(L.salutation)}</p>
        ${L.body.map((p) => `<p>${esc(p)}</p>`).join('')}

        <h2 style="font-size:1.05rem;margin-top:26px">Schedule</h2>
        <table>${L.schedule.map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td></tr>`).join('')}</table>

        ${
          L.fees.length
            ? `<h2 style="font-size:1.05rem;margin-top:22px">Fees and charges</h2>
               <table>${L.fees.map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td></tr>`).join('')}
               ${L.insurance ? `<tr><td>Comprehensive insurance, year one</td><td>${esc(L.insurance)}</td></tr>` : ''}
               <tr><td><b>Cash required on collection</b></td><td>${esc(L.cashUpfront)}</td></tr></table>`
            : ''
        }

        <h2 style="font-size:1.05rem;margin-top:22px">Conditions</h2>
        <ol>${L.conditions.map((c) => `<li>${esc(c)}</li>`).join('')}</ol>

        <div class="sign">
          <div>Signed for and on behalf of ${esc(L.dealer.name)}</div>
          <div>Accepted by ${esc(L.customer.name)} — signature and date</div>
        </div>

        <div class="foot">
          Offer reference ${esc(L.ref)} · application ${esc(L.applicationRef)} · issued ${esc(L.issuedOnLabel)} ·
          valid until ${esc(L.expiresOnLabel)}. Figures are indicative and subject to the financier's approval.
        </div>
      </div>`;
  }

  /* ---------------- privacy ---------------- */

  function pagePrivacy() {
    const d = S.dealer;
    view.innerHTML = `
      <div class="lbl mt">Privacy</div>
      <h1>How we handle your data</h1>
      <p class="muted">Plain English, because you are handing us your ID number and your payslip.</p>
      <div class="card mt" style="max-width:75ch">
        ${[
          ['What we collect', 'Your name, phone number, email, national ID or passport number, KRA PIN, income details and any documents you upload with a finance application. If you only browse, we collect nothing about you personally.'],
          ['Why', 'To quote you accurately, to check which lenders would approve you, and to submit your application to the lender you choose. Nothing else.'],
          ['Who we share it with', `Only the lender you select, and only when you submit an application to them. We do not sell data and we do not pass it to advertisers.`],
          ['How it is stored', 'Your ID number, KRA PIN, date of birth and every uploaded document are encrypted at rest. Staff access is logged. Passwords are hashed and can never be read back, by us or anyone else.'],
          ['Cookies', 'One cookie keeps you signed in. Your theme choice and shortlist are stored in your own browser and never sent to us. We run no advertising trackers.'],
          ['Your rights', `Ask us for a copy of what we hold, ask us to correct it, or ask us to delete it — email ${d.email || 'the dealership'} and we will action it within 30 days, as the Data Protection Act 2019 requires.`],
          ['Keeping it', 'Applications and the documents attached to them are kept for seven years, which is what lenders and the tax authority require. Enquiries that go nowhere are cleared after two years.'],
        ]
          .map((s) => `<h3>${s[0]}</h3><p class="muted">${esc(s[1])}</p>`)
          .join('')}
        <hr>
        <p class="dim" style="font-size:.85rem">Questions about any of this: ${esc(d.email || '')} · ${esc(d.phone || '')}</p>
      </div>`;
  }

  /* ---------------- sell your car ---------------- */

  function pageSell() {
    view.innerHTML = `
      <div class="lbl mt">Sell or trade in</div>
      <h1>Sell your car to ${esc(S.dealer.name)}.</h1>
      <p class="muted">Get an indicative figure in seconds, then book a physical valuation. We buy outright, or put the
      value straight onto the deposit of your next car.</p>

      <div class="grid-3 mt">
        ${[
          ['1', 'Tell us about it', 'Make, model, year, mileage and condition — takes a minute.'],
          ['2', 'Get an indicative range', 'Based on depreciation, mileage and condition in the Kenyan market.'],
          ['3', 'Book an inspection', 'We confirm the figure in person and pay out, or offset your next purchase.'],
        ]
          .map((s) => `<div class="card"><div class="tag brand">Step ${s[0]}</div><h3 style="margin-top:10px">${s[1]}</h3><p class="muted" style="margin:0">${s[2]}</p></div>`)
          .join('')}
      </div>

      <div class="split-r mt-lg">
        <div id="sOut"><div class="empty">Fill in the panel for an indicative value.</div></div>
        <aside class="card sticky">
          <h3>Your car</h3>
          <div class="grid-2">
            <div class="field"><label>Make *</label><input type="text" id="sMake" placeholder="Toyota"></div>
            <div class="field"><label>Model *</label><input type="text" id="sModel" placeholder="Axio"></div>
            <div class="field"><label>Year *</label><input type="number" id="sYear" placeholder="2015"></div>
            <div class="field"><label>Mileage (km)</label><input type="number" id="sKm" placeholder="150000"></div>
          </div>
          <div class="field"><label>What would it sell for new / today (KES) *</label><input type="number" id="sPrice" placeholder="2200000"></div>
          <div class="field"><label>Condition</label><select id="sCond">
            ${['excellent', 'good', 'fair', 'poor'].map((c) => `<option value="${c}" ${c === 'good' ? 'selected' : ''}>${titleCase(c)}</option>`).join('')}
          </select></div>
          <div class="field"><label>What do you want to do?</label><select id="sIntent">
            <option value="sell">Sell it outright for cash</option>
            <option value="trade">Trade it in against another car</option>
            <option value="consign">List it on your yard on my behalf</option>
          </select></div>
          <button class="btn primary block" id="sGo">Get my valuation</button>
        </aside>
      </div>`;

    $('#sGo').onclick = async () => {
      const out = $('#sOut');
      if (!$('#sYear').value || !$('#sPrice').value) return toast('Year and an indicative price are required', 'err');
      try {
        const r = await POST('/api/tradein/estimate', {
          year: Number($('#sYear').value),
          estimatedNewPrice: Number($('#sPrice').value),
          mileage: Number($('#sKm').value) || 0,
          condition: $('#sCond').value,
        });
        const desc = `${$('#sYear').value} ${$('#sMake').value} ${$('#sModel').value}`.trim();
        const intent = $('#sIntent').value;
        out.innerHTML = `
          <div class="card">
            <div class="lbl">Indicative offer for your ${esc(desc)}</div>
            <div style="font-size:2.2rem;font-weight:750;letter-spacing:-.03em">${KES(r.low)} – ${KES(r.high)}</div>
            <p class="muted">Based on ${r.age} year${r.age === 1 ? '' : 's'} of depreciation, your mileage and condition. A physical
            inspection sets the final figure — bodywork, service history and accident record all move it.</p>
            ${
              intent === 'trade'
                ? `<div class="panel mt"><div class="lbl" style="margin:0">Put toward your next car</div>
                   <div class="muted">A deposit of about <b>${KES(r.mid)}</b> would open up cars around
                   <b>${KES(Math.round(r.mid * 4))}</b> on most lenders' minimum deposit.</div>
                   <a class="btn sm mt" href="#/browse?maxPrice=${Math.round(r.mid * 4)}">See those cars</a></div>`
                : ''
            }
            <hr>
            <h3>Book the inspection</h3>
            <div class="grid-2">
              <div class="field"><label>Your name *</label><input type="text" id="sName"></div>
              <div class="field"><label>Phone *</label><input type="tel" id="sPhone"></div>
            </div>
            <div class="field"><label>Anything we should know?</label><textarea id="sNote" placeholder="Service history, accident record, why you're selling…"></textarea></div>
            <div class="row">
              <button class="btn primary" id="sSend">Send to ${esc(S.dealer.name)}</button>
              <a class="btn wa" href="${esc(waLink(`Hi ${S.dealer.name}, I'd like to sell my ${desc}. Your site estimated ${KES(r.low)}–${KES(r.high)}.`))}" target="_blank" rel="noopener">Send on WhatsApp</a>
            </div>
          </div>`;
        $('#sSend').onclick = async () => {
          if (!$('#sName').value || !$('#sPhone').value) return toast('Name and phone are required', 'err');
          await POST('/api/leads', {
            utm: utm(),
            ...botFields(),
            type: intent === 'sell' ? 'sell_car' : 'trade_in',
            name: $('#sName').value,
            phone: $('#sPhone').value,
            message: `${titleCase(intent)}: ${desc}, ${$('#sKm').value || 0} km, ${$('#sCond').value}. ${$('#sNote').value}`,
            payload: { estimate: r, vehicle: desc, intent, mileage: $('#sKm').value, condition: $('#sCond').value },
          });
          toast('Sent — the dealership will call you to arrange the inspection', 'ok');
        };
      } catch (e) {
        toast(e.message, 'err');
      }
    };
  }

  /* ---------------- about / contact ---------------- */

  async function pageAbout() {
    const d = S.dealer;
    const stock = await GET(`/api/vehicles?${dq()}&pageSize=1`);
    view.innerHTML = `
      <div class="lbl mt">About us</div>
      <h1>${esc(d.name)}</h1>
      <p class="muted" style="max-width:70ch;font-size:1.05rem">${esc(d.about || d.tagline || '')}</p>

      <div class="kpi-grid mt-lg">
        <div class="kpi"><div class="k">Vehicles in stock</div><div class="v">${stock.total}</div><div class="d">updated daily</div></div>
        <div class="kpi"><div class="k">Locations</div><div class="v">${S.boot.branches.length}</div><div class="d">${esc(S.boot.branches.map((b) => b.city).join(', '))}</div></div>
        <div class="kpi"><div class="k">Finance partners</div><div class="v">${S.boot.lenders.length}</div><div class="d">banks, saccos &amp; microfinance</div></div>
        <div class="kpi"><div class="k">Every unit</div><div class="v">✓</div><div class="d">inspected before it is listed</div></div>
      </div>

      <h2 class="mt-lg">How we work</h2>
      <div class="grid-3">
        ${[
          ['Inspected, not just parked', 'Every unit goes through a mechanical and bodywork check before it reaches the site. If something is wrong with a car, it is written on the listing.'],
          ['Honest pricing', 'The price on the screen is the price. Where there is room to move, the listing says "negotiable" instead of making you guess.'],
          ['Financing without the runaround', 'We hold a panel of banks, saccos and microfinance houses. You see all of their numbers at once, including the ones that would decline you and why.'],
        ]
          .map((c) => `<div class="card"><h3>${c[0]}</h3><p class="muted" style="margin:0">${c[1]}</p></div>`)
          .join('')}
      </div>

      <h2 class="mt-lg">Where to find us</h2>
      <div class="grid-3">
        ${S.boot.branches
          .map(
            (b) => `<div class="card"><h3 style="margin-bottom:4px">${esc(b.name)}</h3>
            <div class="muted">${esc(b.address || '')}</div>
            <div class="muted">${esc(b.city || '')}</div>
            <div class="mt"><a class="btn sm" href="tel:${esc(b.phone || d.phone || '')}">${esc(b.phone || d.phone || '')}</a></div></div>`
          )
          .join('')}
      </div>

      <div class="card mt-lg row between wrap-r">
        <div><h3 style="margin:0">Ready to look at a car?</h3><p class="muted" style="margin:0">Browse the yard or talk to us directly.</p></div>
        <div class="row"><a class="btn primary" href="#/browse">Browse inventory</a>
        <a class="btn wa" href="${esc(waLink(`Hi ${d.name}, I'd like to visit the yard.`))}" target="_blank" rel="noopener">WhatsApp us</a></div>
      </div>`;
  }

  function pageContact() {
    const d = S.dealer;
    view.innerHTML = `
      <div class="lbl mt">Contact</div>
      <h1>Talk to ${esc(d.name)}</h1>
      <div class="split-r mt">
        <div class="card" id="xForm">
          <h3>Send us a message</h3>
          <div class="grid-2">
            <div class="field"><label>Your name *</label><input type="text" id="xName" value="${esc(S.user ? S.user.name : '')}"></div>
            <div class="field"><label>Phone *</label><input type="tel" id="xPhone"></div>
          </div>
          <div class="field"><label>Email</label><input type="email" id="xEmail" value="${esc(S.user ? S.user.email : '')}"></div>
          <div class="field"><label>What is it about?</label><select id="xTopic">
            <option value="enquiry">A car in your stock</option>
            <option value="callback">Financing</option>
            <option value="trade_in">Selling or trading in my car</option>
            <option value="enquiry">Something else</option>
          </select></div>
          <div class="field"><label for="xMsg">Message</label><textarea id="xMsg"></textarea></div>
          ${honeypot()}
          <button class="btn primary" id="xGo">Send message</button>
        </div>
        <aside class="stack">
          <div class="card">
            <h3>Direct</h3>
            <div class="doc-row"><span class="dim grow">Phone</span><a href="tel:${esc(d.phone || '')}">${esc(d.phone || '—')}</a></div>
            <div class="doc-row"><span class="dim grow">Email</span><a href="mailto:${esc(d.email || '')}">${esc(d.email || '—')}</a></div>
            <div class="doc-row"><span class="dim grow">Head office</span><span>${esc(d.address || '—')}</span></div>
            <a class="btn wa block mt" href="${esc(waLink(`Hi ${d.name},`))}" target="_blank" rel="noopener">Chat on WhatsApp</a>
          </div>
          <div class="card">
            <h3>Branches</h3>
            ${S.boot.branches.map((b) => `<div class="doc-row"><div class="grow"><b>${esc(b.name)}</b><div class="dim" style="font-size:.78rem">${esc(b.address || '')}, ${esc(b.city || '')}</div></div><span class="dim">${esc(b.phone || '')}</span></div>`).join('')}
          </div>
          <div class="card">
            <h3>Opening hours</h3>
            <div class="doc-row"><span class="grow">Monday – Friday</span><span>8:00 – 18:00</span></div>
            <div class="doc-row"><span class="grow">Saturday</span><span>9:00 – 16:00</span></div>
            <div class="doc-row"><span class="grow">Sunday</span><span>By appointment</span></div>
          </div>
        </aside>
      </div>`;
    $('#xGo').onclick = async () => {
      if (!$('#xName').value || !$('#xPhone').value) return toast('Name and phone are required', 'err');
      try {
        await POST('/api/leads', {
          type: $('#xTopic').value,
          name: $('#xName').value,
          phone: $('#xPhone').value,
          email: $('#xEmail').value,
          message: $('#xMsg').value,
          utm: utm(),
          ...botFields(),
        });
      } catch (err) {
        return showFormError(err, view);
      }
      $('#xForm').innerHTML = successPanel(
        'Message sent',
        `${esc(S.dealer.name)} will come back to you within one working day. If it is urgent, WhatsApp is faster.`,
        `<a class="btn wa mt" href="${esc(waLink('Hi ' + S.dealer.name + ', '))}" target="_blank" rel="noopener">Open WhatsApp</a>`
      );
    };
  }

  /* ---------------- compare ---------------- */

  async function pageCompare() {
    if (!S.compare.length) {
      view.innerHTML = '<div class="empty mt-lg">No cars selected. Use the ⇄ button on any listing to compare up to three.</div>';
      return;
    }
    view.innerHTML = '<div class="spinner"></div>';
    const cars = await Promise.all(S.compare.map((id) => GET(`/api/vehicles/${id}`).then((r) => r.vehicle)));
    // the detail endpoint always returns the full sheet, but guard anyway rather than
    // letting one missing field blank the whole table
    const sp = (v) => v.specs || { performance: {}, chassis: {}, practical: {}, interior: {}, inspection: {} };
    const rows = [
      ['Price', (v) => KES(v.price)],
      ['From / month', (v) => KES(estimateMonthly(v.price))],
      ['Year', (v) => v.year],
      ['Condition', (v) => CONDITION_LABEL[v.condition]],
      ['Mileage', (v) => num(v.mileage_km) + ' km'],
      ['Engine', (v) => (v.engine_cc ? v.engine_cc + ' cc' : '—')],
      ['Aspiration', (v) => sp(v).performance.aspiration],
      ['Power', (v) => (sp(v).performance.hp ? sp(v).performance.hp + ' hp' : '—')],
      ['Torque', (v) => (sp(v).performance.torqueNm ? sp(v).performance.torqueNm + ' Nm' : '—')],
      ['0–100 km/h', (v) => (sp(v).performance.zeroTo100 == null ? '—' : sp(v).performance.zeroTo100.toFixed(1) + ' s')],
      ['Top speed', (v) => (sp(v).performance.topSpeed ? sp(v).performance.topSpeed + ' km/h' : '—')],
      ['Power to weight', (v) => (sp(v).performance.powerToWeight ? sp(v).performance.powerToWeight + ' hp/t' : '—')],
      ['Kerb weight', (v) => num(sp(v).chassis.kerbWeight) + ' kg'],
      ['Rims', (v) => sp(v).chassis.rimSize + '" · ' + sp(v).chassis.tyreSize],
      ['Ground clearance', (v) => sp(v).chassis.groundClearance + ' mm'],
      ['Fuel', (v) => v.fuel],
      ['Range per tank', (v) => (sp(v).practical.rangePerTank ? num(sp(v).practical.rangePerTank) + ' km' : '—')],
      ['Transmission', (v) => v.transmission],
      ['Drive', (v) => v.drivetrain],
      ['Body', (v) => v.body_type],
      ['Seats', (v) => v.seats],
      ['Boot space', (v) => sp(v).practical.bootLitres + ' litres'],
      ['Seat trim', (v) => sp(v).interior.seats],
      ['Condition score', (v) => (sp(v).inspection.overall == null ? 'Not inspected' : sp(v).inspection.overall + ' / 100')],
      ['Features', (v) => (v.features || []).length + ' listed'],
    ];
    view.innerHTML = `<h1 class="mt">Compare</h1>
      <div class="scroll-x" data-lenis-prevent><table class="tbl">
        <thead><tr><th></th>${cars
          .map(
            (v) => `<th style="min-width:210px"><img src="${esc(vehImg(v))}" style="border-radius:9px;margin-bottom:6px"><div>${esc(v.title)}</div>
            <button class="btn sm danger mt" data-compare="${v.id}">Remove</button></th>`
          )
          .join('')}</tr></thead>
        <tbody>${rows
          .map((r) => `<tr><td class="dim">${r[0]}</td>${cars.map((v) => `<td>${esc(r[1](v))}</td>`).join('')}</tr>`)
          .join('')}
          <tr><td></td>${cars.map((v) => `<td><a class="btn primary sm" href="#/finance/${v.id}">Finance this</a></td>`).join('')}</tr>
        </tbody>
      </table></div>
      <p class="dim mt" style="font-size:.78rem;max-width:70ch">Performance and dimension figures are the manufacturer's where we hold them
      and estimated from engine size, weight and body type where we do not. Each car's own page says which is which.</p>`;
  }

  /* ---------------- account ---------------- */

  async function pageAccount() {
    if (!S.user) {
      view.innerHTML = `<div class="card mt-lg" style="max-width:420px;margin:40px auto">
        <div class="pills mb"><button class="pill on" id="tabIn">Sign in</button><button class="pill" id="tabUp">Create account</button></div>
        <div id="authBody"></div>
      </div>`;
      const paint = (mode) => {
        const social = window.MotoKEAuth ? MotoKEAuth.buttonsHtml() : '';
        $('#authBody').innerHTML =
          social +
          (mode === 'in'
            ? `<div class="field"><label>Email</label><input type="email" id="ae" value="customer@motoke.demo"></div>
               <div class="field"><label>Password</label><input type="password" id="ap" value="demo123"></div>
               <button class="btn primary block" id="ago">Sign in</button>
               <p class="dim mt" style="font-size:.8rem">Demo customer: customer@motoke.demo / demo123</p>`
            : `<div class="field"><label>Full name</label><input type="text" id="an"></div>
               <div class="field"><label>Email</label><input type="email" id="ae"></div>
               <div class="field"><label>Phone</label><input type="tel" id="aph"></div>
               <div class="field"><label>Password</label><input type="password" id="ap"></div>
               <button class="btn primary block" id="ago">Create account</button>`);
        $('#ago').onclick = async () => {
          try {
            const payload =
              mode === 'in'
                ? { email: $('#ae').value, password: $('#ap').value }
                : { name: $('#an').value, email: $('#ae').value, phone: $('#aph').value, password: $('#ap').value };
            const r = await POST(mode === 'in' ? '/api/auth/login' : '/api/auth/register', payload);
            S.user = r.user;
            paintChrome();
            toast('Welcome, ' + r.user.name.split(' ')[0], 'ok');
            render();
          } catch (e) {
            toast(e.message, 'err');
          }
        };
      };
      paint('in');
      // If the SDK finished loading after this panel painted, repaint so the buttons appear.
      window.addEventListener('motoke:firebase-ready', () => paint('in'), { once: true });
      $('#tabIn').onclick = () => {
        $('#tabIn').classList.add('on');
        $('#tabUp').classList.remove('on');
        paint('in');
      };
      $('#tabUp').onclick = () => {
        $('#tabUp').classList.add('on');
        $('#tabIn').classList.remove('on');
        paint('up');
      };
      return;
    }

    view.innerHTML = `<div class="row between wrap-r mt"><h1>Hello, ${esc(S.user.name.split(' ')[0])}</h1><button class="btn" id="out">Sign out</button></div>
      <h3 class="mt">Your applications</h3><div id="myApps"><div class="spinner"></div></div>
      <h3 class="mt-lg">Your shortlist</h3><div class="veh-grid" id="mySaved"></div>`;
    $('#out').onclick = async () => {
      await POST('/api/auth/logout');
      S.user = null;
      paintChrome();
      render();
    };
    const apps = await GET('/api/me/applications');
    $('#myApps').innerHTML = apps.length
      ? `<div class="scroll-x" data-lenis-prevent><table class="tbl"><thead><tr><th>Reference</th><th>Vehicle</th><th>Lender</th><th class="num">Monthly</th><th>Status</th><th></th></tr></thead><tbody>
        ${apps
          .map(
            (a) => `<tr><td class="mono">${esc(a.ref)}</td><td>${esc((a.vehicle_snapshot && a.vehicle_snapshot.title) || '—')}</td>
            <td>${esc(a.lender_name || '—')}</td><td class="num">${KES(a.monthly_payment)}</td>
            <td><span class="tag ${STATUS_TONE[a.status] || ''}">${esc(STATUS_LABEL[a.status] || a.status)}</span></td>
            <td><a class="btn sm" href="#/track?ref=${encodeURIComponent(a.ref)}">Track</a></td></tr>`
          )
          .join('')}</tbody></table></div>`
      : '<div class="empty">No applications yet.</div>';

    const savedIds = S.saved;
    if (savedIds.length) {
      const cars = await Promise.all(savedIds.map((id) => GET(`/api/vehicles/${id}`).then((r) => r.vehicle).catch(() => null)));
      $('#mySaved').innerHTML = cars.filter(Boolean).map(vehicleCard).join('');
    } else {
      $('#mySaved').innerHTML = '<div class="empty">Nothing saved yet.</div>';
    }
  }

  /* ---------------- leads modal ---------------- */

  on(document, 'click', '[data-lead]', (e, el) => {
    const type = el.dataset.lead;
    const vehicleId = el.dataset.veh;
    const titles = { test_drive: 'Book a test drive', callback: 'Request a call back', enquiry: 'Send an enquiry' };
    const m = modal(titles[type] || 'Get in touch', `
      <div class="grid-2">
        <div class="field"><label>Your name *</label><input type="text" id="ln" value="${esc(S.user ? S.user.name : '')}"></div>
        <div class="field"><label>Phone *</label><input type="tel" id="lp"></div>
      </div>
      <div class="field"><label>Email</label><input type="email" id="le" value="${esc(S.user ? S.user.email : '')}"></div>
      ${type === 'test_drive' ? '<div class="field"><label>Preferred date</label><input type="date" id="ld"></div>' : ''}
      <div class="field"><label>Message</label><textarea id="lm"></textarea></div>
      ${honeypot()}
      <button class="btn primary block" id="lgo">Send</button>`);
    $('#lgo', m.body).onclick = async () => {
      const name = $('#ln', m.body).value.trim();
      const phone = $('#lp', m.body).value.trim();
      if (!name || !phone) return toast('Name and phone are required', 'err');
      await POST('/api/leads', {
        type,
        vehicleId,
        name,
        phone,
        email: $('#le', m.body).value,
        message: $('#lm', m.body).value,
        payload: $('#ld', m.body) ? { preferredDate: $('#ld', m.body).value } : {},
        utm: utm(),
        ...botFields(),
      });
      m.close();
      toast('Sent — the dealership will be in touch shortly', 'ok');
    };
  });

  /* Delegated actions — keeps the page free of inline handlers so the CSP stays strict. */
  on(document, 'click', '[data-act]', (e, el) => {
    const act = el.dataset.act;
    if (act === 'print') window.print();
    else if (act === 'reload') location.reload();
    else if (act === 'clear-filters') go('#/browse');
    else if (act === 'select-all') el.select();
  });

  /* ---------------- router ---------------- */

  async function render() {
    const { path, query } = parseHash();
    $$('.modal-bg').forEach((m) => m.remove()); // a route change closes any open dialog
    const navKey = { finance: 'financing', afford: 'financing', tradein: 'sell', vehicle: 'browse', apply: 'financing', compare: 'browse' }[path[0]] || path[0] || '';
    $$('#nav a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#/' + navKey));
    /* Hash routing does not reset scroll on its own, so a customer moving from halfway
       down one page lands halfway down the next. The smooth-scroll layer takes this over
       when it is running; otherwise the plain jump below does the job. */
    window.dispatchEvent(new CustomEvent('motoke:route'));
    if (!window.MotoKEScroll) window.scrollTo(0, 0);
    try {
      switch (path[0]) {
        case undefined:
        case '':
          return await pageHome();
        case 'browse':
          return await pageBrowse(query);
        case 'vehicle':
          return await pageVehicle(path[1]);
        case 'finance':
          return await pageFinance(path[1]);
        case 'apply':
          return await pageApply(path[1], path[2], query);
        case 'done':
          return pageDone(path[1]);
        case 'track':
          return pageTrack(query);
        case 'financing':
          return await pageFinancing(path[1], query);
        case 'reserve':
          return await pageCheckout(path[1]);
        case 'offer':
          return await pageOfferLetter(query);
        case 'privacy':
          return pagePrivacy();
        case 'sell':
          return pageSell();
        case 'about':
          return await pageAbout();
        case 'contact':
          return pageContact();
        case 'afford':
          return await pageFinancing('afford', query);
        case 'tradein':
          return pageSell();
        case 'compare':
          return await pageCompare();
        case 'account':
          return await pageAccount();
        default:
          view.innerHTML = '<div class="empty mt-lg">Page not found. <a href="#/">Go home</a></div>';
      }
    } catch (e) {
      view.innerHTML = `<div class="card mt-lg err-text">${esc(e.message)}</div>`;
      console.error(e);
    }
  }

  window.addEventListener('hashchange', render);
  boot().then(render).catch((e) => {
    view.innerHTML = `<div class="card mt-lg err-text">Could not start: ${esc(e.message)}</div>`;
  });
})();
