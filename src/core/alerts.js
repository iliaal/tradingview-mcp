/**
 * Core alert logic.
 *
 * Both create() and deleteAlerts() POST to pricealerts.tradingview.com — the
 * same endpoint list() already uses. Earlier versions of this file scraped
 * the alert dialog via DOM/keystroke automation; that approach was brittle
 * across TV UI revisions and locales, didn't return the assigned alert_id,
 * and couldn't bulk-delete. The REST path is locale-proof and aligns with
 * createIndicator() (Pine `alertcondition()` alerts).
 *
 * CORS gotcha: do NOT add a Content-Type header — a custom Content-Type
 * triggers a preflight OPTIONS that pricealerts.tradingview.com rejects.
 * We embed the body via JSON.stringify so it lands as a JS string literal.
 */
import { evaluate as _evaluate, evaluateAsync as _evaluateAsync } from '../connection.js';

function _resolve(deps) {
  return {
    evaluate: deps?.evaluate || _evaluate,
    evaluateAsync: deps?.evaluateAsync || _evaluateAsync,
  };
}

// Map user-friendly names to TV's internal alert condition types.
//   cross       — fires on either direction
//   cross_up    — fires only when price crosses up through the level
//   cross_down  — fires only when price crosses down through the level
// Returns null for unknown values so the caller can surface the error
// instead of silently defaulting to bidirectional 'cross' (previous
// behavior masked typos like "greather_than" by treating them as 'cross').
function _normalizeCondition(condition) {
  if (!condition) return 'cross';
  const c = String(condition).toLowerCase().trim();
  if (c === 'cross' || c === 'crossing') return 'cross';
  if (c === 'greater_than' || c === 'above' || c === 'cross_above' || c === 'cross_up') return 'cross_up';
  if (c === 'less_than' || c === 'below' || c === 'cross_below' || c === 'cross_down') return 'cross_down';
  return null;
}

const PRICE_ALERT_DEFAULT_EXPIRATION_DAYS = 30;

// Parse boolean-ish input (MCP boolish / CLI booleans arrive normalized, but
// direct core callers may pass strings). Unknown values fall back to Boolean().
function _coerceBool(v) {
  if (typeof v !== 'string') return Boolean(v);
  const s = v.trim().toLowerCase();
  if (s === 'false' || s === '0' || s === 'no' || s === 'off' || s === '') return false;
  if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
  return Boolean(v);
}

// Resolve the opt-in `expiration` param. Omitted → historic 30-day expiry.
// Explicit 'never' → TV's open-ended shape (expiration null +
// expiration_policy { time: null, policy: 'never' }). Anything else must be a
// positive number of days. Throws on invalid input (mirrors the fork's error).
function _resolvePriceExpiration(expiration) {
  if (expiration == null) {
    return {
      expiration: new Date(Date.now() + PRICE_ALERT_DEFAULT_EXPIRATION_DAYS * 86400 * 1000).toISOString(),
      expirationPolicy: null,
    };
  }
  if (typeof expiration === 'string' && expiration.trim().toLowerCase() === 'never') {
    return { expiration: null, expirationPolicy: { time: null, policy: 'never' } };
  }
  const days = Number(expiration);
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error(`expiration must be a positive number of days, or 'never' (got ${expiration})`);
  }
  return {
    expiration: new Date(Date.now() + days * 86400 * 1000).toISOString(),
    expirationPolicy: null,
  };
}

export async function create({ condition, price, message, name, webhook, email, frequency, expiration, auto_deactivate, _deps } = {}) {
  const { evaluate, evaluateAsync } = _resolve(_deps);
  if (price == null || isNaN(Number(price))) {
    return { success: false, error: 'price is required and must be a number', source: 'rest_api' };
  }
  const numericPrice = Number(price);

  // web_hook and email are OPT-IN with the historic behavior as default
  // (web_hook null, email false): omitting them leaves the payload
  // byte-identical to before. An alert without either fires, updates
  // last_fire_time and shows a popup — but dispatches NOTHING.
  const hook = (typeof webhook === 'string' && webhook.trim()) ? webhook.trim() : null;
  _assertSafeWebhook(hook);
  const wantEmail = email == null ? false : _coerceBool(email);

  const freq = (typeof frequency === 'string' && frequency.trim()) ? frequency.trim() : 'on_first_fire';

  const { expiration: expirationValue, expirationPolicy } = _resolvePriceExpiration(expiration);

  // Default true preserves historic fire-once behavior; a self-re-arming
  // cross_up/cross_down alert wants false, and the caller says so explicitly.
  const autoDeact = auto_deactivate == null ? true : _coerceBool(auto_deactivate);

  const alertName = (typeof name === 'string' && name.trim()) ? name.trim() : null;
  const symbolInfo = await evaluate(`
    (function() {
      try {
        var chart = window.TradingViewApi._activeChartWidgetWV.value()._chartWidget;
        var model = chart.model();
        var sym = model.mainSeries().symbol();
        var info = model.mainSeries().symbolInfo ? model.mainSeries().symbolInfo() : null;
        return {
          symbol: sym,
          currency: (info && info.currency_code) || 'USD',
          resolution: model.mainSeries().properties().interval.value() || '1'
        };
      } catch(e) { return { error: e.message }; }
    })()
  `);
  if (!symbolInfo || symbolInfo.error || !symbolInfo.symbol) {
    return { success: false, error: 'Could not read active chart symbol: ' + (symbolInfo?.error || 'unknown'), source: 'rest_api' };
  }

  const symbolMarker = '=' + JSON.stringify({
    symbol: symbolInfo.symbol,
    adjustment: 'dividends',
    'currency-id': symbolInfo.currency,
  });

  const condType = _normalizeCondition(condition);
  if (condType === null) {
    return {
      success: false,
      error: `Unknown condition "${condition}". Use one of: crossing, greater_than/above/cross_up, less_than/below/cross_down.`,
      source: 'rest_api',
    };
  }
  const bareTicker = String(symbolInfo.symbol).split(':').pop();
  const defaultMessage = message || `${bareTicker} ${condition ? String(condition).toLowerCase() : 'crossing'} ${numericPrice}`;

  const payload = {
    symbol: symbolMarker,
    resolution: String(symbolInfo.resolution || '1'),
    message: defaultMessage,
    sound_file: null,
    sound_duration: 0,
    popup: true,
    auto_deactivate: autoDeact,
    email: wantEmail,
    sms_over_email: false,
    mobile_push: true,
    web_hook: hook,
    name: alertName,
    conditions: [{
      type: condType,
      frequency: freq,
      series: [{ type: 'barset' }, { type: 'value', value: numericPrice }],
      resolution: String(symbolInfo.resolution || '1'),
    }],
    active: true,
    ignore_warnings: true,
  };

  if (expirationPolicy) {
    payload.expiration = null;
    payload.expiration_policy = expirationPolicy;
  } else {
    payload.expiration = expirationValue;
  }

  const body = JSON.stringify({ payload });
  const response = await evaluateAsync(`
    fetch('https://pricealerts.tradingview.com/create_alert', {
      method: 'POST',
      credentials: 'include',
      body: ${JSON.stringify(body)}
    }).then(function(r) { return r.text().then(function(t) { return { status: r.status, body: t }; }); })
      .catch(function(e) { return { error: e.message }; })
  `);

  if (!response || response.error) {
    return { success: false, error: response?.error || 'no response', source: 'rest_api' };
  }

  let parsed = null;
  try { parsed = JSON.parse(response.body); } catch { /* not JSON */ }

  if (parsed?.s === 'ok' && parsed?.r) {
    const created = parsed.r;
    const out = {
      success: true,
      alert_id: created.alert_id || null,
      symbol: symbolInfo.symbol,
      price: numericPrice,
      condition: condType,
      message: defaultMessage,
      name: alertName,
      web_hook: hook,
      email: wantEmail,
      frequency: freq,
      auto_deactivate: autoDeact,
      resolution: String(symbolInfo.resolution || '1'),
      expiration: created.expiration || expirationValue,
      source: 'rest_api',
    };
    if (expirationPolicy) out.expiration_policy = expirationPolicy;
    return out;
  }

  return {
    success: false,
    error: parsed?.errmsg || parsed?.err?.code || (response.body ? String(response.body).substring(0, 200) : 'unknown'),
    http_status: response.status,
    source: 'rest_api',
  };
}

export async function list({ _deps } = {}) {
  const { evaluateAsync } = _resolve(_deps);
  // Use pricealerts REST API — returns structured data with alert_id, symbol, price, conditions
  const result = await evaluateAsync(`
    fetch('https://pricealerts.tradingview.com/list_alerts', { credentials: 'include' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.s !== 'ok' || !Array.isArray(data.r)) return { alerts: [], error: data.errmsg || 'Unexpected response' };
        return {
          alerts: data.r.map(function(a) {
            var sym = '';
            try { sym = JSON.parse(a.symbol.replace(/^=/, '')).symbol || a.symbol; } catch(e) { sym = a.symbol; }
            return {
              alert_id: a.alert_id,
              symbol: sym,
              type: a.type,
              name: a.name == null ? null : a.name,
              message: a.message,
              active: a.active,
              condition: a.condition,
              resolution: a.resolution,
              created: a.create_time,
              last_fired: a.last_fire_time,
              expiration: a.expiration,
              // Notification channels — the API returns them; dropping them
              // made a silently-unarmed alert impossible to audit (an alert
              // with web_hook null and email false fires and dispatches NOTHING).
              web_hook: a.web_hook || null,
              email: !!a.email,
              popup: !!a.popup,
              mobile_push: !!a.mobile_push,
              // Whether the alert switches itself off after firing, and how
              // often it may fire. The condition shape differs between price
              // and indicator alerts, so read frequency from both.
              auto_deactivate: !!a.auto_deactivate,
              frequency: ((a.condition && typeof a.condition === 'object' && !Array.isArray(a.condition) && a.condition.frequency) || (a.conditions && a.conditions[0] && a.conditions[0].frequency) || null),
              // Why TradingView last refused/stopped it, when it says anything.
              last_error: a.last_error || null,
              last_stop_reason: a.last_stop_reason || null,
            };
          })
        };
      })
      .catch(function(e) { return { alerts: [], error: e.message }; })
  `);
  return { success: true, alert_count: result?.alerts?.length || 0, source: 'internal_api', alerts: result?.alerts || [], error: result?.error };
}

/**
 * Delete one or more alerts via TV's REST API.
 *
 *   POST https://pricealerts.tradingview.com/delete_alerts
 *   Body: { payload: { alert_ids: [...] } }
 *
 * Accepts:
 *   - { alert_id: 12345 }       — single
 *   - { alert_ids: [1, 2, 3] }  — bulk in one call (TV supports natively)
 *   - { delete_all: true }      — list() first, then delete every id
 */
export async function deleteAlerts({ alert_id, alert_ids, delete_all, _deps } = {}) {
  const { evaluateAsync } = _resolve(_deps);
  let ids = [];
  let invalidInputs = [];

  if (delete_all) {
    const listed = await list({ _deps });
    ids = (listed?.alerts || []).map(a => a.alert_id).filter(x => x != null);
    if (ids.length === 0) {
      return { success: true, deleted_count: 0, note: 'No alerts to delete', source: 'rest_api' };
    }
  } else if (Array.isArray(alert_ids) && alert_ids.length > 0) {
    // Partition: keep valid numerics, surface invalids so the caller sees
    // typos instead of getting a silent partial-success.
    for (const raw of alert_ids) {
      const n = Number(raw);
      if (Number.isFinite(n)) ids.push(n);
      else invalidInputs.push(raw);
    }
    if (ids.length === 0) {
      return {
        success: false,
        error: `No valid alert_ids in input (got ${alert_ids.length}, all non-numeric).`,
        invalid_ids: invalidInputs,
        source: 'rest_api',
      };
    }
  } else if (alert_id != null) {
    const n = Number(alert_id);
    if (isNaN(n)) throw new Error('alert_id must be a number');
    ids = [n];
  } else {
    throw new Error('Pass one of: alert_id (number), alert_ids (array), or delete_all: true');
  }

  const body = JSON.stringify({ payload: { alert_ids: ids } });
  const response = await evaluateAsync(`
    fetch('https://pricealerts.tradingview.com/delete_alerts', {
      method: 'POST',
      credentials: 'include',
      body: ${JSON.stringify(body)}
    }).then(function(r) { return r.text().then(function(t) { return { status: r.status, body: t }; }); })
      .catch(function(e) { return { error: e.message }; })
  `);

  if (!response || response.error) {
    return { success: false, error: response?.error || 'no response', attempted_ids: ids, source: 'rest_api' };
  }

  let parsed = null;
  try { parsed = JSON.parse(response.body); } catch { /* not JSON */ }

  if (parsed?.s === 'ok') {
    return {
      success: true,
      deleted_count: ids.length,
      deleted_ids: ids,
      invalid_ids: invalidInputs.length > 0 ? invalidInputs : undefined,
      source: 'rest_api',
    };
  }

  return {
    success: false,
    error: parsed?.errmsg || parsed?.err?.code || (response.body ? String(response.body).substring(0, 200) : 'unknown'),
    http_status: response.status,
    attempted_ids: ids,
    source: 'rest_api',
  };
}

const INDICATOR_DEFAULT_EXPIRATION_DAYS = 30;
const INDICATOR_MAX_EXPIRATION_DAYS = 60;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Create an *indicator* alert that fires on a Pine `alertcondition()` signal.
 *
 * Companion to `create()` — where `create()` produces a price-level alert via
 * the TV alert dialog, this posts directly to TV's REST endpoint with an
 * `alert_cond` condition referencing a saved Pine script's plot index. The
 * intended use is automating strategy-style Pine alerts (BUY/SELL signals
 * piped to a webhook URL) without clicking through the UI for each one.
 *
 * Determining `alert_cond_id` (gotcha): TV counts plot-emitting calls in
 * source order — `plot()`, `plotshape()`, `bgcolor()`, AND `alertcondition()`.
 * `hline()` is NOT counted. So a script with 10 `plot()` + 2 `plotshape()` +
 * 2 `alertcondition()` (BUY then SELL) yields BUY = `plot_12`, SELL = `plot_13`.
 * Easiest discovery: create one alert manually in the TV UI, then call
 * `alert_list` and read the resulting `alert_cond_id` plus the `inputs` /
 * `offsets_by_plot` shape from the response.
 *
 * CORS note: do NOT add a Content-Type header on the fetch — a custom
 * Content-Type triggers a preflight OPTIONS that pricealerts.tradingview.com
 * rejects. The server happily parses the body without an explicit Content-Type.
 */
// Reject webhook URLs that aren't plain http(s) or that target loopback /
// link-local / private hosts. TradingView's servers POST to this URL when the
// alert fires; an attacker-shaped value (e.g. a cloud metadata endpoint) would
// turn alert creation into a server-side request the user never intended.
function _assertSafeWebhook(web_hook) {
  if (!web_hook) return;
  let u;
  try { u = new URL(web_hook); } catch { throw new Error(`web_hook is not a valid URL: ${web_hook}`); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`web_hook must be an http(s) URL, got "${u.protocol}".`);
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  // Note: URL() already canonicalizes decimal/hex IPv4 (2130706433, 0x7f000001)
  // to dotted form, so the IPv4 regexes below catch those obfuscations. The
  // gap is IPv4-mapped IPv6 (::ffff:169.254.169.254 → ::ffff:a9fe:a9fe), which
  // no legitimate public webhook uses — reject the whole ::ffff: class.
  const isPrivate =
    host === 'localhost' || host === '0.0.0.0' || host === '::1' ||
    host.startsWith('::ffff:') ||
    /^127\./.test(host) || /^169\.254\./.test(host) ||
    /^10\./.test(host) || /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^(fc|fd)[0-9a-f]{2}:/.test(host) || /^fe80:/.test(host);
  if (isPrivate) {
    throw new Error(`web_hook host "${u.hostname}" is loopback/link-local/private — not a valid public webhook target.`);
  }
}

export async function createIndicator({
  pine_id,
  pine_version,
  alert_cond_id,
  inputs,
  offsets_by_plot,
  symbol,
  currency,
  resolution,
  message,
  web_hook,
  frequency,
  expiration_days,
  active,
  _deps,
} = {}) {
  _assertSafeWebhook(web_hook);
  const { evaluate, evaluateAsync } = _resolve(_deps);

  if (!pine_id || typeof pine_id !== 'string') {
    return { success: false, error: 'pine_id is required (e.g. "USER;abc123..." from pine_list_scripts)', source: 'rest_api' };
  }
  if (!alert_cond_id || typeof alert_cond_id !== 'string') {
    return { success: false, error: 'alert_cond_id is required (e.g. "plot_12")', source: 'rest_api' };
  }
  if (!inputs || typeof inputs !== 'object') {
    return { success: false, error: 'inputs is required (object matching the script\'s input.X order)', source: 'rest_api' };
  }
  if (!offsets_by_plot || typeof offsets_by_plot !== 'object') {
    return { success: false, error: 'offsets_by_plot is required (e.g. { plot_0: 0, plot_1: 0, ... })', source: 'rest_api' };
  }

  let resolvedSymbol = symbol;
  let resolvedCurrency = currency;
  let resolvedResolution = resolution;

  if (!resolvedSymbol || !resolvedCurrency || !resolvedResolution) {
    const symbolInfo = await evaluate(`
      (function() {
        try {
          var chart = window.TradingViewApi._activeChartWidgetWV.value()._chartWidget;
          var model = chart.model();
          var sym = model.mainSeries().symbol();
          var info = model.mainSeries().symbolInfo ? model.mainSeries().symbolInfo() : null;
          return {
            symbol: sym,
            currency: (info && info.currency_code) || 'USD',
            resolution: model.mainSeries().properties().interval.value() || '1'
          };
        } catch(e) { return { error: e.message }; }
      })()
    `);
    if (!symbolInfo || symbolInfo.error || !symbolInfo.symbol) {
      return { success: false, error: 'Could not read active chart symbol: ' + (symbolInfo?.error || 'unknown') + ' — pass symbol/currency/resolution explicitly', source: 'rest_api' };
    }
    resolvedSymbol = resolvedSymbol || symbolInfo.symbol;
    resolvedCurrency = resolvedCurrency || symbolInfo.currency;
    resolvedResolution = resolvedResolution || String(symbolInfo.resolution || '1');
  }

  const symbolMarker = '=' + JSON.stringify({
    symbol: resolvedSymbol,
    adjustment: 'dividends',
    'currency-id': resolvedCurrency,
  });

  const days = Number.isFinite(Number(expiration_days)) && Number(expiration_days) > 0
    ? Math.min(Math.floor(Number(expiration_days)), INDICATOR_MAX_EXPIRATION_DAYS)
    : INDICATOR_DEFAULT_EXPIRATION_DAYS;
  const expiration = new Date(Date.now() + days * MS_PER_DAY).toISOString();

  const payload = {
    symbol: symbolMarker,
    resolution: String(resolvedResolution),
    message: message || '',
    sound_file: null,
    sound_duration: 0,
    popup: false,
    expiration,
    auto_deactivate: false,
    email: false,
    sms_over_email: false,
    mobile_push: false,
    web_hook: web_hook || null,
    name: null,
    conditions: [{
      type: 'alert_cond',
      frequency: frequency || 'on_bar_close',
      alert_cond_id,
      series: [{
        type: 'study',
        study: 'Script@tv-scripting-101',
        offsets_by_plot,
        inputs,
        pine_id,
        pine_version: pine_version || '1.0',
      }],
      resolution: String(resolvedResolution),
    }],
    active: active !== false,
    ignore_warnings: true,
  };

  const body = JSON.stringify({ payload });
  const response = await evaluateAsync(`
    fetch('https://pricealerts.tradingview.com/create_alert', {
      method: 'POST',
      credentials: 'include',
      body: ${JSON.stringify(body)}
    }).then(function(r) { return r.text().then(function(t) { return { status: r.status, body: t }; }); })
      .catch(function(e) { return { error: e.message }; })
  `);

  if (!response || response.error) {
    return { success: false, error: response?.error || 'no response', source: 'rest_api' };
  }

  let parsed = null;
  try { parsed = JSON.parse(response.body); } catch { /* not JSON */ }

  if (parsed?.s === 'ok' && parsed?.r) {
    const created = parsed.r;
    return {
      success: true,
      alert_id: created.alert_id || null,
      symbol: resolvedSymbol,
      pine_id,
      alert_cond_id,
      resolution: String(resolvedResolution),
      message: payload.message,
      web_hook: payload.web_hook,
      expiration: created.expiration || expiration,
      source: 'rest_api',
    };
  }

  return {
    success: false,
    error: parsed?.errmsg || parsed?.err?.code || (response.body ? String(response.body).substring(0, 200) : 'unknown'),
    http_status: response.status,
    hint: 'Common cause: alert_cond_id off-by-one (try plot_N+/-1) or inputs schema mismatch. Create one alert manually in the TV UI and call alert_list to compare.',
    source: 'rest_api',
  };
}
