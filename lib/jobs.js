'use strict';
/**
 * MotoKE - background jobs.
 *
 * The only one so far keeps pump prices current. EPRA publishes maximum retail prices
 * on the 14th of each month, effective the 15th, and every running-cost figure on the
 * site depends on them — so the site refreshes itself rather than waiting for someone
 * at the dealership to remember.
 */
const { get, getSetting, setSetting, insert } = require('./db');
const market = require('./market');

const DAY = 86_400_000;

function log(action, detail) {
  try {
    insert('audit_log', { user_id: null, actor: 'system', action, entity: 'settings', entity_id: 'fuel', detail: JSON.stringify(detail) });
  } catch {}
}

/**
 * Try to refresh fuel prices. Safe to call any time: offline is a normal outcome and
 * leaves the previous figures in place with their original "as at" date.
 */
async function refreshFuelPrices({ force = false } = {}) {
  if (getSetting('fuel_auto_update', 'on') !== 'on' && !force) {
    return { ok: false, skipped: 'auto-update is off' };
  }
  const asAt = getSetting('cost_prices_as_at', null);
  const age = market.priceAge(asAt);

  // nothing to do if we already refreshed today and are not being forced
  if (!force && age.days !== null && age.days < 1) {
    return { ok: false, skipped: 'already refreshed today', asAt };
  }

  /* EPRA's own page is the default, because it is the authority that sets these prices
     and it is the one source verified to parse correctly. A dealership can point this
     somewhere else in Admin → Running costs. */
  const source = getSetting('fuel_source_url', '') || market.DEFAULT_FUEL_SOURCE;

  /* EPRA prices differ by town — Mombasa is about KES 3 a litre under Nairobi because
     that is where the fuel lands. Use the dealership's own city so the running costs
     match what its customers actually pay at the pump. */
  const town = getSetting('fuel_town', '') || (get('SELECT city FROM dealers WHERE slug=?', [getSetting('site_dealer', 'summit')]) || {}).city || 'Nairobi';

  const result = await market.fetchFuelPrices(source, 8000, { town });
  const now = new Date().toISOString();
  setSetting('fuel_last_attempt', now);

  if (!result.ok) {
    setSetting('fuel_last_error', result.reason || 'unknown');
    log('fuel.refresh.failed', { reason: result.reason, source });
    return { ok: false, reason: result.reason, asAt, age: market.priceAge(asAt) };
  }

  const before = {
    petrol: Number(getSetting('cost_petrol_price', null)),
    diesel: Number(getSetting('cost_diesel_price', null)),
  };
  setSetting('cost_petrol_price', result.prices.petrol_price);
  setSetting('cost_diesel_price', result.prices.diesel_price);
  if (result.prices.kerosene_price) setSetting('cost_kerosene_price', result.prices.kerosene_price);
  setSetting('cost_prices_as_at', now);
  setSetting('fuel_last_error', '');
  log('fuel.refresh.ok', { before, after: result.prices, source: result.source });

  return { ok: true, prices: result.prices, before, asAt: now, source: result.source };
}

/** Current fuel status for the admin panel and the customer-facing footnote. */
function fuelStatus() {
  const asAt = getSetting('cost_prices_as_at', null);
  const age = market.priceAge(asAt);
  return {
    petrol: Number(getSetting('cost_petrol_price', 195)),
    diesel: Number(getSetting('cost_diesel_price', 180)),
    kerosene: Number(getSetting('cost_kerosene_price', 0)) || null,
    asAt,
    age,
    autoUpdate: getSetting('fuel_auto_update', 'on') === 'on',
    source: getSetting('fuel_source_url', '') || market.DEFAULT_FUEL_SOURCE,
    sourceIsDefault: !getSetting('fuel_source_url', ''),
    lastAttempt: getSetting('fuel_last_attempt', null),
    lastError: getSetting('fuel_last_error', '') || null,
    nextEpraCycle: market.nextEpraDate().toISOString().slice(0, 10),
  };
}

let timer = null;

/**
 * Check once shortly after boot, then daily. The daily tick is cheap: it returns
 * immediately unless a day has passed, and it only reaches the network when it must.
 */
function startFuelSchedule() {
  const kick = () => {
    refreshFuelPrices().catch(() => {});
  };
  setTimeout(kick, 5_000).unref?.();
  timer = setInterval(kick, DAY);
  timer.unref?.();
  return timer;
}

function stopFuelSchedule() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { refreshFuelPrices, fuelStatus, startFuelSchedule, stopFuelSchedule };
