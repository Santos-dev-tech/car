/**
 * MotoKE — charts for the staff console.
 *
 * Inline SVG, no library. The app has zero dependencies by design and the CSP
 * allows scripts from our own origin only, so Chart.js and friends are out —
 * and for four chart types they would be 200 kB to draw a line anyway.
 *
 * The look comes from the reference dashboard: a soft gradient area sitting on
 * a single accent stroke, quiet gridlines, and the numbers carried by the
 * surrounding type rather than by the chart itself.
 *
 * Everything here takes plain arrays and returns an SVG string. Colour comes
 * from CSS custom properties, so the charts follow light and dark without
 * knowing which one they are in.
 */
(function () {
  'use strict';

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** A unique id per gradient, or two charts on one page share one fill. */
  let seq = 0;
  const uid = (p) => `${p}${++seq}`;

  /**
   * The signature chart: a filled area fading to nothing, on an accent stroke.
   *
   * @param data   [{ day, n }] or [{ label, value }]
   * @param opts.value   which key holds the number
   * @param opts.height  drawing height in px
   * @param opts.accent  css var name for the line colour
   */
  function area(data, opts = {}) {
    const key = opts.value || 'n';
    const h = opts.height || 160;
    const w = 600; // viewBox width; the svg scales to its container
    const pad = 4;
    const pts = (data || []).map((d) => Number(d[key]) || 0);

    if (pts.length < 2) return emptyChart(h, 'Not enough data yet');

    const max = Math.max(...pts, 1);
    const min = Math.min(...pts, 0);
    const span = max - min || 1;
    const stepX = (w - pad * 2) / (pts.length - 1);
    const y = (v) => pad + (1 - (v - min) / span) * (h - pad * 2);

    const line = pts.map((v, i) => `${pad + i * stepX},${y(v)}`).join(' ');
    const fill = `${pad},${h} ${line} ${pad + (pts.length - 1) * stepX},${h}`;
    const gid = uid('g');

    /* The last point gets a dot. On a trend chart the eye wants to know where
       "now" is, and without it the line just stops. */
    const lastX = pad + (pts.length - 1) * stepX;
    const lastY = y(pts[pts.length - 1]);

    return `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img"
      aria-label="${esc(opts.label || 'Trend over time')}">
      <defs>
        <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" class="cg-from"/>
          <stop offset="100%" class="cg-to"/>
        </linearGradient>
      </defs>
      <polygon class="c-area" points="${fill}" fill="url(#${gid})"/>
      <polyline class="c-line" points="${line}" fill="none"/>
      <circle class="c-dot" cx="${lastX}" cy="${lastY}" r="4"/>
    </svg>`;
  }

  /**
   * A tiny inline trend for a KPI card. No axes, no labels — it is a texture
   * that says "rising" or "falling" at a glance, not something to read values off.
   */
  function spark(data, opts = {}) {
    const key = opts.value || 'n';
    const pts = (data || []).map((d) => Number(d[key]) || 0);
    if (pts.length < 2) return '';
    const w = 120;
    const h = 30;
    const max = Math.max(...pts, 1);
    const min = Math.min(...pts, 0);
    const span = max - min || 1;
    const stepX = w / (pts.length - 1);
    const line = pts.map((v, i) => `${i * stepX},${(1 - (v - min) / span) * (h - 4) + 2}`).join(' ');
    return `<svg class="spark-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <polyline class="c-line" points="${line}" fill="none"/>
    </svg>`;
  }

  /**
   * Horizontal bars. Better than vertical for named categories, because the
   * labels read left to right instead of being turned on their side.
   *
   * @param rows [{ label, value, tone?, note? }]
   */
  function bars(rows, opts = {}) {
    const list = (rows || []).filter((r) => r);
    if (!list.length) return `<div class="chart-empty">${esc(opts.empty || 'Nothing to show yet')}</div>`;
    const max = Math.max(...list.map((r) => Number(r.value) || 0), 1);
    return `<div class="cbars">
      ${list
        .map(
          (r) => `<div class="cbar ${r.tone ? 'tone-' + esc(r.tone) : ''}">
            <div class="cbar-head">
              <span class="cbar-label">${esc(r.label)}</span>
              <span class="cbar-value">${esc(r.display != null ? r.display : r.value)}</span>
            </div>
            <div class="cbar-track"><i style="width:${((Number(r.value) || 0) / max) * 100}%"></i></div>
            ${r.note ? `<div class="cbar-note">${esc(r.note)}</div>` : ''}
          </div>`
        )
        .join('')}
    </div>`;
  }

  /**
   * A donut for a part-to-whole split. Drawn with stroke-dasharray on a circle,
   * which needs no path maths and stays crisp at any size.
   *
   * @param slices [{ label, value, tone }]
   */
  function donut(slices, opts = {}) {
    const list = (slices || []).filter((s) => Number(s.value) > 0);
    const total = list.reduce((sum, s) => sum + Number(s.value), 0);
    if (!total) return `<div class="chart-empty">${esc(opts.empty || 'Nothing to show yet')}</div>`;

    const r = 60;
    const c = 2 * Math.PI * r;
    let offset = 0;

    const rings = list
      .map((s) => {
        const frac = Number(s.value) / total;
        const seg = `<circle class="c-slice tone-${esc(s.tone || 'ink')}" cx="80" cy="80" r="${r}"
          fill="none" stroke-width="18"
          stroke-dasharray="${(frac * c).toFixed(2)} ${(c - frac * c).toFixed(2)}"
          stroke-dashoffset="${(-offset * c).toFixed(2)}"
          transform="rotate(-90 80 80)"><title>${esc(s.label)}: ${s.value}</title></circle>`;
        offset += frac;
        return seg;
      })
      .join('');

    return `<div class="cdonut">
      <svg viewBox="0 0 160 160" class="cdonut-svg" role="img" aria-label="${esc(opts.label || 'Breakdown')}">
        ${rings}
        <text x="80" y="76" class="cdonut-total">${esc(opts.centre != null ? opts.centre : total)}</text>
        <text x="80" y="95" class="cdonut-caption">${esc(opts.caption || 'total')}</text>
      </svg>
      <div class="cdonut-key">
        ${list
          .map(
            (s) => `<div class="ckey">
              <span class="ckey-dot tone-${esc(s.tone || 'ink')}"></span>
              <span class="ckey-label">${esc(s.label)}</span>
              <span class="ckey-value">${esc(s.display != null ? s.display : s.value)}</span>
            </div>`
          )
          .join('')}
      </div>
    </div>`;
  }

  /**
   * The reference's delta pill: "+8.4%" in green, "−3.1%" in red, flat in grey.
   * Takes the delta object the stats endpoint returns.
   */
  function deltaPill(d, opts = {}) {
    if (!d) return '';
    if (d.percent === null) {
      return `<span class="cdelta flat" title="Nothing in the previous period to compare with">new</span>`;
    }
    const arrow = d.direction === 'up' ? '↑' : d.direction === 'down' ? '↓' : '→';
    const sign = d.percent > 0 ? '+' : '';
    /* Some numbers are better going down. A fall in declined applications is
       good news, and colouring it red would say the opposite. */
    const good = opts.inverse ? d.direction === 'down' : d.direction === 'up';
    const tone = d.direction === 'flat' ? 'flat' : good ? 'up' : 'down';
    return `<span class="cdelta ${tone}" title="vs the previous ${opts.days || 30} days">${arrow} ${sign}${d.percent}%</span>`;
  }

  function emptyChart(h, msg) {
    return `<div class="chart-empty" style="height:${h}px">${esc(msg)}</div>`;
  }

  window.Charts = { area, spark, bars, donut, deltaPill };
})();
