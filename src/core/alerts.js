/**
 * Core alert logic.
 *
 * TV's alert dialog uses hashed CSS-module class names that change per release.
 * We locate elements by stable structural/text features instead of class names:
 *   - Dialog: find an element containing the text "Create alert on"
 *   - Price input: the <fieldset> whose <legend> reads "Value" contains the price input
 *   - Create/Cancel buttons: matched by textContent in the dialog footer
 *   - Message: a <button data-qa-id="alert-message-button"> opens a sub-dialog
 */
import { evaluate as _evaluate, evaluateAsync as _evaluateAsync, getClient as _getClient, safeString } from '../connection.js';

const DIALOG_RE = '/Create alert on/i';

function _resolve(deps) {
  return {
    evaluate: deps?.evaluate || _evaluate,
    evaluateAsync: deps?.evaluateAsync || _evaluateAsync,
    getClient: deps?.getClient || _getClient,
  };
}

async function openDialog({ evaluate, getClient }) {
  // Try keyboard shortcut Alt+A first — most reliable across TV UI revisions.
  const client = await getClient();
  await client.Input.dispatchKeyEvent({
    type: 'keyDown',
    modifiers: 1, // Alt
    key: 'a',
    code: 'KeyA',
    windowsVirtualKeyCode: 65,
  });
  await client.Input.dispatchKeyEvent({ type: 'keyUp', key: 'a', code: 'KeyA' });

  // Poll for the dialog up to ~2s.
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 100));
    const found = await evaluate(`
      (function() {
        var els = document.querySelectorAll('[class*="dialog"]');
        for (var i = 0; i < els.length; i++) {
          if (${DIALOG_RE}.test(els[i].textContent || '')) return true;
        }
        return false;
      })()
    `);
    if (found) return true;
  }
  return false;
}

export async function create({ condition, price, message, _deps }) {
  const { evaluate, getClient } = _resolve(_deps);
  const opened = await openDialog({ evaluate, getClient });
  if (!opened) {
    return { success: false, price, condition, message: message || '(none)', price_set: false, error: 'dialog_not_opened' };
  }

  // Set the price in the "Value" fieldset's input.
  const priceSet = await evaluate(`
    (function() {
      var dialogs = document.querySelectorAll('[class*="dialog"]');
      var dialog = null;
      for (var i = 0; i < dialogs.length; i++) {
        if (${DIALOG_RE}.test(dialogs[i].textContent || '')) { dialog = dialogs[i]; break; }
      }
      if (!dialog) return { ok: false, reason: 'no_dialog' };

      var fieldsets = dialog.querySelectorAll('fieldset');
      var target = null;
      for (var i = 0; i < fieldsets.length; i++) {
        var legend = fieldsets[i].querySelector('legend');
        var text = (legend && legend.textContent || '').trim();
        if (/^value$/i.test(text)) { target = fieldsets[i]; break; }
      }
      // Fallback: first fieldset containing a visible text/number input.
      if (!target) {
        for (var i = 0; i < fieldsets.length; i++) {
          var inp = fieldsets[i].querySelector('input[type="text"], input[type="number"]');
          if (inp && inp.offsetParent !== null) { target = fieldsets[i]; break; }
        }
      }
      if (!target) return { ok: false, reason: 'no_value_fieldset' };

      var input = target.querySelector('input[type="text"], input[type="number"]');
      if (!input) return { ok: false, reason: 'no_input' };

      var nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      nativeSet.call(input, ${safeString(String(price))});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.blur();
      return { ok: true, value: input.value };
    })()
  `);

  // Optional: set message. The "Message" field is a button that opens a sub-dialog.
  let messageSet = false;
  if (message) {
    const messageOpened = await evaluate(`
      (function() {
        var btn = document.querySelector('button[data-qa-id="alert-message-button"]');
        if (!btn) return false;
        btn.click();
        return true;
      })()
    `);
    if (messageOpened) {
      // Wait for sub-dialog and its textarea/input to appear.
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 100));
        const set = await evaluate(`
          (function() {
            var dialogs = document.querySelectorAll('[class*="dialog"]');
            // The most recently opened dialog is typically last in DOM order.
            for (var i = dialogs.length - 1; i >= 0; i--) {
              var d = dialogs[i];
              if (${DIALOG_RE}.test(d.textContent || '')) continue; // skip parent
              var ta = d.querySelector('textarea');
              if (ta && ta.offsetParent !== null) {
                var nativeSet = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
                nativeSet.call(ta, ${JSON.stringify(message)});
                ta.dispatchEvent(new Event('input', { bubbles: true }));
                ta.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
              }
            }
            return false;
          })()
        `);
        if (set) { messageSet = true; break; }
      }
      // Close the sub-dialog by clicking its OK/Apply/Save button, or Escape fallback.
      await new Promise(r => setTimeout(r, 100));
      const closed = await evaluate(`
        (function() {
          var dialogs = document.querySelectorAll('[class*="dialog"]');
          for (var i = dialogs.length - 1; i >= 0; i--) {
            var d = dialogs[i];
            if (${DIALOG_RE}.test(d.textContent || '')) continue;
            var btns = d.querySelectorAll('button');
            for (var j = 0; j < btns.length; j++) {
              var t = (btns[j].textContent || '').trim();
              if (/^(ok|apply|save|done)$/i.test(t)) { btns[j].click(); return true; }
            }
          }
          return false;
        })()
      `);
      if (!closed) {
        const client = await getClient();
        await client.Input.dispatchKeyEvent({ type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        await client.Input.dispatchKeyEvent({ type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      }
      await new Promise(r => setTimeout(r, 200));
    }
  }

  // Click Create in the main dialog footer.
  await new Promise(r => setTimeout(r, 300));
  const created = await evaluate(`
    (function() {
      var dialogs = document.querySelectorAll('[class*="dialog"]');
      var dialog = null;
      for (var i = 0; i < dialogs.length; i++) {
        if (${DIALOG_RE}.test(dialogs[i].textContent || '')) { dialog = dialogs[i]; break; }
      }
      if (!dialog) return false;
      var btns = dialog.querySelectorAll('button');
      // Prefer submit-typed button with text "Create".
      for (var i = 0; i < btns.length; i++) {
        var t = (btns[i].textContent || '').trim();
        if (btns[i].type === 'submit' && /^create$/i.test(t)) { btns[i].click(); return true; }
      }
      for (var i = 0; i < btns.length; i++) {
        var t = (btns[i].textContent || '').trim();
        if (/^create$/i.test(t)) { btns[i].click(); return true; }
      }
      return false;
    })()
  `);

  const ok = !!(created && priceSet && priceSet.ok);
  return {
    success: ok,
    price,
    condition,
    message: message || '(none)',
    price_set: !!(priceSet && priceSet.ok),
    message_set: messageSet,
    price_value: priceSet && priceSet.value,
    error: ok ? undefined : (priceSet && priceSet.reason) || (!created ? 'create_button_not_found' : 'unknown'),
    source: 'dom_fallback',
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

export async function deleteAlerts({ delete_all, _deps }) {
  const { evaluate } = _resolve(_deps);
  if (delete_all) {
    const result = await evaluate(`
      (function() {
        var alertBtn = document.querySelector('[data-name="alerts"]');
        if (alertBtn) alertBtn.click();
        var header = document.querySelector('[data-name="alerts"]');
        if (header) {
          header.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
          return { context_menu_opened: true };
        }
        return { context_menu_opened: false };
      })()
    `);
    return { success: true, note: 'Alert deletion requires manual confirmation in the context menu.', context_menu_opened: result?.context_menu_opened || false, source: 'dom_fallback' };
  }
  throw new Error('Individual alert deletion not yet supported. Use delete_all: true.');
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
