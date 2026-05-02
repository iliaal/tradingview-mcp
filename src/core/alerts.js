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
function _normalizeCondition(condition) {
  if (!condition) return 'cross';
  const c = String(condition).toLowerCase().trim();
  if (c === 'cross' || c === 'crossing') return 'cross';
  if (c === 'greater_than' || c === 'above' || c === 'cross_above' || c === 'cross_up') return 'cross_up';
  if (c === 'less_than' || c === 'below' || c === 'cross_below' || c === 'cross_down') return 'cross_down';
  return 'cross';
}

const PRICE_ALERT_DEFAULT_EXPIRATION_DAYS = 30;

export async function create({ condition, price, message, _deps } = {}) {
  const { evaluate, evaluateAsync } = _resolve(_deps);
  if (price == null || isNaN(Number(price))) {
    return { success: false, error: 'price is required and must be a number', source: 'rest_api' };
  }
  const numericPrice = Number(price);

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
  const bareTicker = String(symbolInfo.symbol).split(':').pop();
  const defaultMessage = message || `${bareTicker} ${condition ? String(condition).toLowerCase() : 'crossing'} ${numericPrice}`;
  const expiration = new Date(Date.now() + PRICE_ALERT_DEFAULT_EXPIRATION_DAYS * 86400 * 1000).toISOString();

  const payload = {
    symbol: symbolMarker,
    resolution: String(symbolInfo.resolution || '1'),
    message: defaultMessage,
    sound_file: null,
    sound_duration: 0,
    popup: true,
    expiration,
    auto_deactivate: true,
    email: false,
    sms_over_email: false,
    mobile_push: true,
    web_hook: null,
    name: null,
    conditions: [{
      type: condType,
      frequency: 'on_first_fire',
      series: [{ type: 'barset' }, { type: 'value', value: numericPrice }],
      resolution: String(symbolInfo.resolution || '1'),
    }],
    active: true,
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
      symbol: symbolInfo.symbol,
      price: numericPrice,
      condition: condType,
      message: defaultMessage,
      expiration: created.expiration || expiration,
      source: 'rest_api',
    };
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
              message: a.message,
              active: a.active,
              condition: a.condition,
              resolution: a.resolution,
              created: a.create_time,
              last_fired: a.last_fire_time,
              expiration: a.expiration,
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

  if (delete_all) {
    const listed = await list({ _deps });
    ids = (listed?.alerts || []).map(a => a.alert_id).filter(x => x != null);
    if (ids.length === 0) {
      return { success: true, deleted_count: 0, note: 'No alerts to delete', source: 'rest_api' };
    }
  } else if (Array.isArray(alert_ids) && alert_ids.length > 0) {
    ids = alert_ids.map(Number).filter(x => !isNaN(x));
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
