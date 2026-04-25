/**
 * Core UI automation logic.
 */
import { evaluate as _evaluate, evaluateAsync as _evaluateAsync, getClient as _getClient } from '../connection.js';

function _resolve(deps) {
  return {
    evaluate: deps?.evaluate || _evaluate,
    evaluateAsync: deps?.evaluateAsync || _evaluateAsync,
    getClient: deps?.getClient || _getClient,
  };
}

export async function click({ by, value, _deps }) {
  const { evaluate } = _resolve(_deps);
  const escaped = JSON.stringify(value);
  const result = await evaluate(`
    (function() {
      var by = ${JSON.stringify(by)};
      var value = ${escaped};
      var el = null;
      if (by === 'aria-label') el = document.querySelector('[aria-label="' + value.replace(/"/g, '\\\\"') + '"]');
      else if (by === 'data-name') el = document.querySelector('[data-name="' + value.replace(/"/g, '\\\\"') + '"]');
      else if (by === 'text') {
        var candidates = document.querySelectorAll('button, a, [role="button"], [role="menuitem"], [role="tab"]');
        for (var i = 0; i < candidates.length; i++) {
          var text = candidates[i].textContent.trim();
          if (text === value || text.toLowerCase() === value.toLowerCase()) { el = candidates[i]; break; }
        }
      } else if (by === 'class-contains') el = document.querySelector('[class*="' + value.replace(/"/g, '\\\\"') + '"]');
      if (!el) return { found: false };
      el.click();
      return { found: true, tag: el.tagName.toLowerCase(), text: (el.textContent || '').trim().substring(0, 80), aria_label: el.getAttribute('aria-label') || null, data_name: el.getAttribute('data-name') || null };
    })()
  `);
  if (!result || !result.found) throw new Error('No matching element found for ' + by + '="' + value + '"');
  return { success: true, clicked: result };
}

export async function openPanel({ panel, action, _deps }) {
  const { evaluate } = _resolve(_deps);
  const isBottomPanel = panel === 'pine-editor' || panel === 'strategy-tester';
  if (isBottomPanel) {
    const widgetName = panel === 'pine-editor' ? 'pine-editor' : 'backtesting';
    // TV Desktop 3.1.0 reworked the bottomWidgetBar: hideWidget() is gone,
    // showWidget()/activateScriptEditorTab() are silent no-ops, and
    // _enabledWidgets is empty. The toolbar buttons (data-name="pine-dialog-button"
    // and the strategy tester header button) toggle the panel in both eras —
    // we click them and infer open/close from a post-click visibility check.
    const result = await evaluate(`
      (function() {
        var bwb = window.TradingView && window.TradingView.bottomWidgetBar;
        var panelName = ${JSON.stringify(panel)};
        var widgetName = ${JSON.stringify(widgetName)};
        var action = ${JSON.stringify(action)};

        function isPanelOpen() {
          // Canonical state across TV builds: the bottom-panel toggle button's
          // aria-label is "Collapse panel" when expanded and "Open panel" when
          // collapsed. Height thresholds were unreliable (bottom area is ~68px
          // even when collapsed because of the always-visible toolbar strip).
          var collapseBtn = document.querySelector('[data-name="toggle-visibility-button"]');
          if (collapseBtn) {
            var aria = (collapseBtn.getAttribute('aria-label') || '').toLowerCase();
            // "Collapse panel" => panel is currently open
            // "Open panel" => panel is currently closed
            if (aria.indexOf('collapse') !== -1) return isCorrectWidget();
            if (aria.indexOf('open') !== -1) return false;
          }
          // Older TV fallback: large bottom area + content visible
          var bottomArea = document.querySelector('[class*="layout__area--bottom"]');
          if (bottomArea && bottomArea.offsetHeight > 150) return isCorrectWidget();
          return false;
        }

        function isCorrectWidget() {
          // Even when the panel is open, it might be showing a different widget.
          // Verify the requested widget's content is actually rendered.
          if (panelName === 'pine-editor') {
            var monacoEl = document.querySelector('.monaco-editor.pine-editor-monaco');
            if (!monacoEl) return false;
            // Walk up to find an ancestor whose offsetHeight indicates real visibility.
            var rect = monacoEl.getBoundingClientRect();
            return rect.height > 50 && rect.width > 50;
          }
          if (panelName === 'strategy-tester') {
            var stratPanel = document.querySelector('[data-name="backtesting"]')
              || document.querySelector('[class*="strategyReport"]');
            if (!stratPanel) return false;
            var sr = stratPanel.getBoundingClientRect();
            return sr.height > 50 && sr.width > 50;
          }
          return true;
        }

        function findToolbarButton() {
          if (panelName === 'pine-editor') {
            return document.querySelector('[data-name="pine-dialog-button"]')
              || document.querySelector('[aria-label="Pine"]');
          }
          // strategy-tester
          return document.querySelector('[data-name="backtesting-button"]')
            || document.querySelector('[aria-label="Strategy Tester"]')
            || document.querySelector('[data-name="backtesting"]');
        }

        function callApi(open) {
          if (!bwb) return null;
          try {
            if (open) {
              if (panelName === 'pine-editor' && typeof bwb.activateScriptEditorTab === 'function') { bwb.activateScriptEditorTab(); return 'activateScriptEditorTab'; }
              if (typeof bwb.showWidget === 'function') { bwb.showWidget(widgetName); return 'showWidget'; }
            } else {
              // TV Desktop 3.1.0 removed hideWidget; the underscore-prefixed
              // _hideWidget is still present, and toggleWidget (public) closes
              // the panel when called with the currently-open widget.
              if (typeof bwb.hideWidget === 'function') { bwb.hideWidget(widgetName); return 'hideWidget'; }
              if (typeof bwb._hideWidget === 'function') { bwb._hideWidget(widgetName); return '_hideWidget'; }
              if (typeof bwb.toggleWidget === 'function') { bwb.toggleWidget(widgetName); return 'toggleWidget'; }
            }
          } catch(e) {}
          return null;
        }

        // The bottom-panel "Collapse panel" button (data-name=toggle-visibility-button)
        // is the explicit close UX in TV's UI on all builds — used as a fallback
        // when the API methods don't actually close the panel.
        function findCollapseButton() {
          return document.querySelector('[data-name="toggle-visibility-button"][aria-label*="Collapse" i]')
            || document.querySelector('[data-name="toggle-visibility-button"]');
        }

        var wasOpen = isPanelOpen();
        var performed = 'none';
        var apiAction = null;
        var clickedButton = false;

        // Only mutate state when needed. Idempotent on already-open / already-closed.
        if (action === 'open' || (action === 'toggle' && !wasOpen)) {
          if (wasOpen) {
            // Already open — only ensure the right tab is active.
            apiAction = callApi(true);
            var tabBtn = findToolbarButton();
            if (tabBtn) { tabBtn.click(); clickedButton = true; }
            performed = 'already_open';
          } else {
            // Closed → need to expand the panel AND select the right widget.
            // Order matters: toolbar tab first (may auto-expand on some builds),
            // then the API call, then the collapse-toggle as guarantee.
            var tabBtn = findToolbarButton();
            if (tabBtn) { tabBtn.click(); clickedButton = true; }
            apiAction = callApi(true);
            // Click the bottom-panel toggle-visibility button when its label
            // says "Open panel" — this is the canonical expand path on TV 3.1.0.
            var collapseToggle = findCollapseButton();
            if (collapseToggle && /open/i.test(collapseToggle.getAttribute('aria-label') || '')) {
              collapseToggle.click();
            }
            performed = 'opened';
          }
        } else if (action === 'close' || (action === 'toggle' && wasOpen)) {
          if (!wasOpen) {
            performed = 'already_closed';
          } else {
            // TV Desktop 3.1.0: hideWidget / _hideWidget / toggleWidget are all
            // silent no-ops on this build. The collapse-panel button is the
            // only path that actually closes. We try the API call (records
            // intent + works on older TV) and click the collapse button.
            apiAction = callApi(false);
            var collapseBtn = findCollapseButton();
            if (collapseBtn && /collapse/i.test(collapseBtn.getAttribute('aria-label') || '')) {
              collapseBtn.click();
              clickedButton = true;
            }
            performed = 'closed';
          }
        }

        return { was_open: wasOpen, performed: performed, api_action: apiAction, clicked_button: clickedButton };
      })()
    `);
    if (result && result.error) throw new Error(result.error);
    return { success: true, panel, action, was_open: result?.was_open ?? false, performed: result?.performed ?? 'unknown', api_action: result?.api_action, clicked_button: result?.clicked_button };
  } else {
    const selectorMap = {
      'watchlist': { dataName: 'base-watchlist-widget-button', ariaLabel: 'Watchlist' },
      'alerts': { dataName: 'alerts-button', ariaLabel: 'Alerts' },
      'trading': { dataName: 'trading-button', ariaLabel: 'Trading Panel' },
    };
    const sel = selectorMap[panel];
    const result = await evaluate(`
      (function() {
        var dataName = ${JSON.stringify(sel.dataName)};
        var ariaLabel = ${JSON.stringify(sel.ariaLabel)};
        var action = ${JSON.stringify(action)};
        var btn = document.querySelector('[data-name="' + dataName + '"]') || document.querySelector('[aria-label="' + ariaLabel + '"]');
        if (!btn) return { error: 'Button not found for panel: ' + ${JSON.stringify(panel)} };
        var isActive = btn.getAttribute('aria-pressed') === 'true' || btn.classList.contains('isActive') || btn.classList.toString().indexOf('active') !== -1 || btn.classList.toString().indexOf('Active') !== -1;
        var rightArea = document.querySelector('[class*="layout__area--right"]');
        var sidebarOpen = !!(rightArea && rightArea.offsetWidth > 50);
        var isOpen = isActive && sidebarOpen;
        var performed = 'none';
        if (action === 'open' && !isOpen) { btn.click(); performed = 'opened'; }
        else if (action === 'close' && isOpen) { btn.click(); performed = 'closed'; }
        else if (action === 'toggle') { btn.click(); performed = isOpen ? 'closed' : 'opened'; }
        else { performed = isOpen ? 'already_open' : 'already_closed'; }
        return { was_open: isOpen, performed: performed };
      })()
    `);
    if (result && result.error) throw new Error(result.error);
    return { success: true, panel, action, was_open: result?.was_open ?? false, performed: result?.performed ?? 'unknown' };
  }
}

export async function fullscreen({ _deps } = {}) {
  const { evaluate } = _resolve(_deps);
  const result = await evaluate(`
    (function() {
      var btn = document.querySelector('[data-name="header-toolbar-fullscreen"]');
      if (!btn) return { found: false };
      btn.click();
      return { found: true };
    })()
  `);
  if (!result || !result.found) throw new Error('Fullscreen button not found');
  return { success: true, action: 'fullscreen_toggled' };
}

export async function layoutList({ _deps } = {}) {
  const { evaluateAsync } = _resolve(_deps);
  const layouts = await evaluateAsync(`
    new Promise(function(resolve) {
      try {
        window.TradingViewApi.getSavedCharts(function(charts) {
          if (!charts || !Array.isArray(charts)) { resolve({layouts: [], source: 'internal_api', error: 'getSavedCharts returned no data'}); return; }
          var result = charts.map(function(c) { return { id: c.id || c.chartId || null, name: c.name || c.title || 'Untitled', symbol: c.symbol || null, resolution: c.resolution || null, modified: c.timestamp || c.modified || null }; });
          resolve({layouts: result, source: 'internal_api'});
        });
        setTimeout(function() { resolve({layouts: [], source: 'internal_api', error: 'getSavedCharts timed out'}); }, 5000);
      } catch(e) { resolve({layouts: [], source: 'internal_api', error: e.message}); }
    })
  `);
  return { success: true, layout_count: layouts?.layouts?.length || 0, source: layouts?.source, layouts: layouts?.layouts || [], error: layouts?.error };
}

export async function layoutSwitch({ name, _deps }) {
  const { evaluate, evaluateAsync } = _resolve(_deps);
  const escaped = JSON.stringify(name);
  const result = await evaluateAsync(`
    new Promise(function(resolve) {
      try {
        var target = ${escaped};
        if (/^\\d+$/.test(target)) { window.TradingViewApi.loadChartFromServer(target); resolve({success: true, method: 'loadChartFromServer', id: target, source: 'internal_api'}); return; }
        window.TradingViewApi.getSavedCharts(function(charts) {
          if (!charts || !Array.isArray(charts)) { resolve({success: false, error: 'getSavedCharts returned no data', source: 'internal_api'}); return; }
          var match = null;
          for (var i = 0; i < charts.length; i++) { var cname = charts[i].name || charts[i].title || ''; if (cname === target || cname.toLowerCase() === target.toLowerCase()) { match = charts[i]; break; } }
          if (!match) { for (var j = 0; j < charts.length; j++) { var cn = (charts[j].name || charts[j].title || '').toLowerCase(); if (cn.indexOf(target.toLowerCase()) !== -1) { match = charts[j]; break; } } }
          if (!match) { resolve({success: false, error: 'Layout "' + target + '" not found.', source: 'internal_api'}); return; }
          var chartId = match.id || match.chartId;
          window.TradingViewApi.loadChartFromServer(chartId);
          resolve({success: true, method: 'loadChartFromServer', id: chartId, name: match.name || match.title, source: 'internal_api'});
        });
        setTimeout(function() { resolve({success: false, error: 'getSavedCharts timed out', source: 'internal_api'}); }, 5000);
      } catch(e) { resolve({success: false, error: e.message, source: 'internal_api'}); }
    })
  `);
  if (!result?.success) throw new Error(result?.error || 'Unknown error switching layout');

  // Handle "unsaved changes" confirmation dialog (multilingual)
  await new Promise(r => setTimeout(r, 500));
  const dismissed = await evaluate(`
    (function() {
      // Match the "proceed / discard changes" button across locales.
      // EN: "Open anyway", "Don't save", "Discard"
      // PT: "Abrir mesmo assim", "Descartar", "Não salvar"
      // ES: "Abrir de todos modos", "Descartar", "No guardar"
      // FR: "Ouvrir quand même", "Ne pas enregistrer", "Abandonner"
      // DE: "Trotzdem öffnen", "Nicht speichern", "Verwerfen"
      var rx = /open anyway|don'?t save|discard|abrir mesmo|descartar|não salvar|abrir de todos|no guardar|ouvrir quand|ne pas enregistrer|abandonner|trotzdem öffnen|nicht speichern|verwerfen/i;
      var btns = document.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        var text = btns[i].textContent.trim();
        if (rx.test(text)) {
          btns[i].click();
          return true;
        }
      }
      return false;
    })()
  `);

  if (dismissed) await new Promise(r => setTimeout(r, 1000));
  return { success: true, layout: result.name || name, layout_id: result.id, source: result.source, action: 'switched', unsaved_dialog_dismissed: dismissed };
}

export async function keyboard({ key, modifiers, _deps }) {
  const { getClient } = _resolve(_deps);
  const c = await getClient();
  let mod = 0;
  if (modifiers) {
    if (modifiers.includes('alt')) mod |= 1;
    if (modifiers.includes('ctrl')) mod |= 2;
    if (modifiers.includes('meta')) mod |= 4;
    if (modifiers.includes('shift')) mod |= 8;
  }
  const keyMap = {
    'Enter': { code: 'Enter', vk: 13 }, 'Escape': { code: 'Escape', vk: 27 }, 'Tab': { code: 'Tab', vk: 9 },
    'Backspace': { code: 'Backspace', vk: 8 }, 'Delete': { code: 'Delete', vk: 46 },
    'ArrowUp': { code: 'ArrowUp', vk: 38 }, 'ArrowDown': { code: 'ArrowDown', vk: 40 },
    'ArrowLeft': { code: 'ArrowLeft', vk: 37 }, 'ArrowRight': { code: 'ArrowRight', vk: 39 },
    'Space': { code: 'Space', vk: 32 }, 'Home': { code: 'Home', vk: 36 }, 'End': { code: 'End', vk: 35 },
    'PageUp': { code: 'PageUp', vk: 33 }, 'PageDown': { code: 'PageDown', vk: 34 },
    'F1': { code: 'F1', vk: 112 }, 'F2': { code: 'F2', vk: 113 }, 'F5': { code: 'F5', vk: 116 },
  };
  const mapped = keyMap[key] || { code: 'Key' + key.toUpperCase(), vk: key.toUpperCase().charCodeAt(0) };
  await c.Input.dispatchKeyEvent({ type: 'keyDown', modifiers: mod, key, code: mapped.code, windowsVirtualKeyCode: mapped.vk });
  await c.Input.dispatchKeyEvent({ type: 'keyUp', key, code: mapped.code });
  return { success: true, key, modifiers: modifiers || [] };
}

export async function typeText({ text, _deps }) {
  const { getClient } = _resolve(_deps);
  const c = await getClient();
  await c.Input.insertText({ text });
  return { success: true, typed: text.substring(0, 100), length: text.length };
}

export async function hover({ by, value, _deps }) {
  const { evaluate, getClient } = _resolve(_deps);
  const coords = await evaluate(`
    (function() {
      var by = ${JSON.stringify(by)};
      var value = ${JSON.stringify(value)};
      var el = null;
      if (by === 'aria-label') {
        el = document.querySelector('[aria-label="' + value.replace(/"/g, '\\\\"') + '"]');
        if (!el) el = document.querySelector('[aria-label*="' + value.replace(/"/g, '\\\\"') + '"]');
      }
      else if (by === 'data-name') el = document.querySelector('[data-name="' + value.replace(/"/g, '\\\\"') + '"]');
      else if (by === 'text') {
        var candidates = document.querySelectorAll('button, a, [role="button"], [role="menuitem"], [role="tab"], span, div');
        for (var i = 0; i < candidates.length; i++) { var text = candidates[i].textContent.trim(); if (text === value || text.toLowerCase() === value.toLowerCase()) { el = candidates[i]; break; } }
      } else if (by === 'class-contains') el = document.querySelector('[class*="' + value.replace(/"/g, '\\\\"') + '"]');
      if (!el) return null;
      var rect = el.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, tag: el.tagName.toLowerCase() };
    })()
  `);
  if (!coords) throw new Error('Element not found for ' + by + '="' + value + '"');
  const c = await getClient();
  await c.Input.dispatchMouseEvent({ type: 'mouseMoved', x: coords.x, y: coords.y });
  return { success: true, hovered: { by, value, tag: coords.tag, x: coords.x, y: coords.y } };
}

export async function scroll({ direction, amount, _deps }) {
  const { evaluate, getClient } = _resolve(_deps);
  const c = await getClient();
  const px = amount || 300;
  const center = await evaluate(`
    (function() {
      var el = document.querySelector('[data-name="pane-canvas"]') || document.querySelector('[class*="chart-container"]') || document.querySelector('canvas');
      if (!el) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      var rect = el.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()
  `);
  let deltaX = 0, deltaY = 0;
  if (direction === 'up') deltaY = -px; else if (direction === 'down') deltaY = px;
  else if (direction === 'left') deltaX = -px; else if (direction === 'right') deltaX = px;
  await c.Input.dispatchMouseEvent({ type: 'mouseWheel', x: center.x, y: center.y, deltaX, deltaY });
  return { success: true, direction, amount: px };
}

export async function mouseClick({ x, y, button, double_click, _deps }) {
  const { getClient } = _resolve(_deps);
  const c = await getClient();
  const btn = button === 'right' ? 'right' : button === 'middle' ? 'middle' : 'left';
  const btnNum = btn === 'right' ? 2 : btn === 'middle' ? 1 : 0;
  await c.Input.dispatchMouseEvent({ type: 'mouseMoved', x, y });
  await c.Input.dispatchMouseEvent({ type: 'mousePressed', x, y, button: btn, buttons: btnNum, clickCount: 1 });
  await c.Input.dispatchMouseEvent({ type: 'mouseReleased', x, y, button: btn });
  if (double_click) {
    await new Promise(r => setTimeout(r, 50));
    await c.Input.dispatchMouseEvent({ type: 'mousePressed', x, y, button: btn, buttons: btnNum, clickCount: 2 });
    await c.Input.dispatchMouseEvent({ type: 'mouseReleased', x, y, button: btn });
  }
  return { success: true, x, y, button: btn, double_click: !!double_click };
}

export async function findElement({ query, strategy, _deps }) {
  const { evaluate } = _resolve(_deps);
  const strat = strategy || 'text';
  const results = await evaluate(`
    (function() {
      var query = ${JSON.stringify(query)};
      var strategy = ${JSON.stringify(strat)};
      var results = [];
      if (strategy === 'css') {
        var els = document.querySelectorAll(query);
        for (var i = 0; i < Math.min(els.length, 20); i++) {
          var rect = els[i].getBoundingClientRect();
          results.push({ tag: els[i].tagName.toLowerCase(), text: (els[i].textContent || '').trim().substring(0, 80), aria_label: els[i].getAttribute('aria-label') || null, data_name: els[i].getAttribute('data-name') || null, x: rect.x, y: rect.y, width: rect.width, height: rect.height, visible: els[i].offsetParent !== null });
        }
      } else if (strategy === 'aria-label') {
        var els = document.querySelectorAll('[aria-label*="' + query.replace(/"/g, '\\\\"') + '"]');
        for (var i = 0; i < Math.min(els.length, 20); i++) {
          var rect = els[i].getBoundingClientRect();
          results.push({ tag: els[i].tagName.toLowerCase(), text: (els[i].textContent || '').trim().substring(0, 80), aria_label: els[i].getAttribute('aria-label') || null, data_name: els[i].getAttribute('data-name') || null, x: rect.x, y: rect.y, width: rect.width, height: rect.height, visible: els[i].offsetParent !== null });
        }
      } else {
        var all = document.querySelectorAll('button, a, [role="button"], [role="menuitem"], [role="tab"], input, select, label, span, div, h1, h2, h3, h4');
        for (var i = 0; i < all.length; i++) {
          var text = all[i].textContent.trim();
          if (text.toLowerCase().indexOf(query.toLowerCase()) !== -1 && text.length < 200) {
            var rect = all[i].getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              results.push({ tag: all[i].tagName.toLowerCase(), text: text.substring(0, 80), aria_label: all[i].getAttribute('aria-label') || null, data_name: all[i].getAttribute('data-name') || null, x: rect.x, y: rect.y, width: rect.width, height: rect.height, visible: all[i].offsetParent !== null });
              if (results.length >= 20) break;
            }
          }
        }
      }
      return results;
    })()
  `);
  return { success: true, query, strategy: strat, count: results?.length || 0, elements: results || [] };
}
