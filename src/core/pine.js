/**
 * Core Pine Script logic — shared between MCP tools and CLI.
 * All functions accept plain options objects and return plain JS objects.
 * They throw on error (callers catch and format).
 */
import { evaluate as _evaluate, evaluateAsync as _evaluateAsync, evaluateChecked as _evaluateChecked, getClient as _getClient } from '../connection.js';

function _resolve(deps) {
  return {
    evaluate: deps?.evaluate || _evaluate,
    evaluateAsync: deps?.evaluateAsync || _evaluateAsync,
    evaluateChecked: deps?.evaluateChecked || _evaluateChecked,
    getClient: deps?.getClient || _getClient,
  };
}

// ── Monaco finder (injected into TV page) ──
//
// Resolves TV's Pine Editor Monaco instance via two paths:
//
//   1. FAST PATH: window.monaco.editor.getEditors() — direct Monaco API,
//      filtered to the editor whose container sits under .pine-editor-monaco.
//      Works whenever TV exposes the global monaco namespace (most builds
//      since TV Desktop 3.x). No React-fiber traversal; robust under
//      transitional fiber states (mid-render, post-setValue, post-pine_new).
//
//   2. FALLBACK: React fiber walk — original behaviour. Used when the fast
//      path is unavailable (older TV builds, or window.monaco not exposed).
const FIND_MONACO = `
  (function findMonacoEditor() {
    // Pick the Pine editor (by .pine-editor-monaco ancestor) out of any
    // editors returned by monaco.editor.getEditors(). Falls back to the
    // first editor when no Pine-specific one is found — covers brief
    // windows during tab switches where the editor container hasn't
    // remounted yet.
    function pickPineEditor(monaco) {
      try {
        var editors = monaco.editor.getEditors();
        for (var i = 0; i < editors.length; i++) {
          var ed = editors[i];
          var node = typeof ed.getContainerDomNode === 'function' ? ed.getContainerDomNode() : null;
          if (node && node.closest && node.closest('.pine-editor-monaco')) {
            return { editor: ed, env: { editor: monaco.editor } };
          }
        }
        if (editors.length > 0) return { editor: editors[0], env: { editor: monaco.editor } };
      } catch (e) {}
      return null;
    }

    // Path 1: cached monaco namespace from a prior extraction (~free).
    if (window.__tvMonaco && window.__tvMonaco.editor && typeof window.__tvMonaco.editor.getEditors === 'function') {
      var hit = pickPineEditor(window.__tvMonaco);
      if (hit) return hit;
    }

    // Path 2: legacy window.monaco — kept defensive in case TV re-exposes it.
    // Confirmed undefined on TV Desktop 3.1.0.7818 (2026-05-17).
    try {
      if (window.monaco && window.monaco.editor && typeof window.monaco.editor.getEditors === 'function') {
        var hit2 = pickPineEditor(window.monaco);
        if (hit2) return hit2;
      }
    } catch (e) {}

    // Path 3: extract monaco from webpack chunk registry. TV 3.1+ keeps
    // the monaco namespace inside its webpack bundle but doesn't expose
    // it on window. We push a fake chunk whose runtime callback scans
    // all modules for one exporting editor.getEditors, then cache it on
    // window.__tvMonaco for subsequent calls. One-time ~100 ms cost.
    try {
      var chunkArray = window.webpackChunktradingview;
      if (chunkArray && typeof chunkArray.push === 'function') {
        chunkArray.push([
          ['__tv_monaco_extract__'],
          {},
          function(require) {
            try {
              var ids = Object.keys(require.m || {});
              for (var i = 0; i < ids.length; i++) {
                try {
                  var mod = require(ids[i]);
                  if (mod && mod.editor && typeof mod.editor.getEditors === 'function') {
                    window.__tvMonaco = mod;
                    return;
                  }
                } catch (e) { /* modules that throw at require-time are not monaco */ }
              }
            } catch (e) {}
          },
        ]);
      }
    } catch (e) {}

    if (window.__tvMonaco && window.__tvMonaco.editor && typeof window.__tvMonaco.editor.getEditors === 'function') {
      var hit3 = pickPineEditor(window.__tvMonaco);
      if (hit3) return hit3;
    }
    return null;
  })()
`;

// Pine Editor panel-open trigger. Idempotent — safe to re-invoke during the
// poll loop in ensurePineEditorOpen when the panel self-closes between calls
// (observed on TV 3.1 after pine_new or failed setValue).
//
// Calls BOTH the API method and the toolbar button click, in that order.
// On TV Desktop 3.1.0 the bottomWidgetBar API methods (activateScriptEditorTab,
// showWidget) are silent no-ops — _enabledWidgets is empty and the widget
// system was reworked to use WatchableValue. The button click is what
// actually opens the panel on current builds. Older builds still respond to
// the API calls. Calling both is harmless (idempotent) and covers both eras.
const OPEN_PINE_PANEL = `
  (function() {
    var actions = [];
    var bwb = window.TradingView && window.TradingView.bottomWidgetBar;
    if (bwb) {
      try {
        if (typeof bwb.activateScriptEditorTab === 'function') { bwb.activateScriptEditorTab(); actions.push('activateScriptEditorTab'); }
        else if (typeof bwb.showWidget === 'function') { bwb.showWidget('pine-editor'); actions.push('showWidget'); }
      } catch(e) {}
    }
    // Selector cascade — try the most stable first, fall back through.
    // On TV 3.1.0+ pine-dialog-button is the bottom-toolbar button; if a
    // chart already has a Pine indicator loaded, [data-qa-id="legend-pine-action"]
    // ("Source code" button in the indicator's legend) is also a valid
    // opener and is sometimes present earlier in the cold-start lifecycle
    // than pine-dialog-button.
    var openers = [
      '[data-name="pine-dialog-button"]',
      '[aria-label="Pine"]',
      '[data-qa-id="legend-pine-action"]',
    ];
    for (var i = 0; i < openers.length; i++) {
      var el = document.querySelector(openers[i]);
      if (el && el.offsetParent !== null) {
        el.click();
        actions.push('click:' + openers[i]);
        break;
      }
    }
    return actions.length ? actions.join('+') : null;
  })()
`;

// Fast presence check for "Pine editor is open" — the dialog container has
// a stable data-qa-id and is cheaper to query than the FIND_MONACO React
// fiber walk. Used as a short-circuit before falling back to FIND_MONACO.
const PINE_EDITOR_DIALOG_PRESENT = `
  (function() {
    var d = document.querySelector('[data-qa-id="pine-editor-dialog"]');
    return d !== null && d.offsetParent !== null;
  })()
`;

// Existence-only check for "Pine Monaco editor is reachable". Triggers
// webpack extraction if needed (same as FIND_MONACO's path 3) but returns
// ONLY a boolean — never the editor reference. Critical because
// Runtime.evaluate with returnByValue:true rejects the editor object with
// "Object reference chain is too long"; we hit this when `FIND_MONACO !==
// null` was used as a probe (V8 evaluates to a boolean, but the error
// surface still bites the protocol). Used by ensurePineEditorOpen.
const MONACO_PINE_EDITOR_AVAILABLE = `
  (function() {
    function extractIfNeeded() {
      if (window.__tvMonaco) return;
      try {
        var chunkArray = window.webpackChunktradingview;
        if (chunkArray && typeof chunkArray.push === 'function') {
          chunkArray.push([
            ['__tv_monaco_extract__'],
            {},
            function(require) {
              try {
                var ids = Object.keys(require.m || {});
                for (var i = 0; i < ids.length; i++) {
                  try {
                    var mod = require(ids[i]);
                    if (mod && mod.editor && typeof mod.editor.getEditors === 'function') {
                      window.__tvMonaco = mod;
                      return;
                    }
                  } catch (e) {}
                }
              } catch (e) {}
            },
          ]);
        }
      } catch (e) {}
    }
    extractIfNeeded();
    if (!window.__tvMonaco || !window.__tvMonaco.editor) return false;
    try {
      var editors = window.__tvMonaco.editor.getEditors();
      for (var i = 0; i < editors.length; i++) {
        var ed = editors[i];
        var node = typeof ed.getContainerDomNode === 'function' ? ed.getContainerDomNode() : null;
        if (node && node.closest && node.closest('.pine-editor-monaco')) {
          return true;
        }
      }
      return editors.length > 0;
    } catch (e) {
      return false;
    }
  })()
`;

/**
 * Opens the Pine Editor panel and waits for Monaco to become available.
 * Returns true if editor is accessible, false on timeout.
 *
 * Re-invokes the panel-open trigger every 2s during the poll, to recover
 * from transitional states where the panel auto-closes or Monaco hasn't yet
 * settled. Total budget: 20s (100 × 200ms) — covers fresh-chart cold start
 * where the pine-dialog-button takes longer than the prior 10s window to
 * register in the DOM.
 */
export async function ensurePineEditorOpen({ _deps } = {}) {
  const { evaluate } = _resolve(_deps);

  // Cheap check first: is the dialog visible? Skips the heavier
  // FIND_MONACO walk in the common case.
  const dialogOpen = await evaluate(PINE_EDITOR_DIALOG_PRESENT);
  if (dialogOpen) {
    // MONACO_PINE_EDITOR_AVAILABLE returns boolean only — never the editor
    // reference, which CDP refuses to serialize ("Object reference chain
    // is too long"). FIND_MONACO is still used inside IIFEs that consume
    // the editor without returning it across CDP.
    const monacoReady = await evaluate(MONACO_PINE_EDITOR_AVAILABLE);
    if (monacoReady) return true;
  }

  await evaluate(OPEN_PINE_PANEL);

  for (let i = 0; i < 100; i++) {
    await new Promise(r => setTimeout(r, 200));
    const ready = await evaluate(MONACO_PINE_EDITOR_AVAILABLE);
    if (ready) return true;
    // Re-invoke the panel-open trigger every 2s — idempotent, no-op if
    // panel is already open, recovers if the panel self-closed.
    if (i > 0 && i % 10 === 0) {
      await evaluate(OPEN_PINE_PANEL);
    }
  }
  return false;
}

// ── Pure / offline functions ──

export function analyze({ source }) {
  const lines = source.split('\n');
  const diagnostics = [];

  let isV6 = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//@version=6')) { isV6 = true; break; }
    if (trimmed.startsWith('//@version=')) break;
    if (trimmed === '' || trimmed.startsWith('//')) continue;
    break;
  }

  const arrays = new Map();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fromMatch = line.match(/(\w+)\s*=\s*array\.from\(([^)]*)\)/);
    if (fromMatch) {
      const name = fromMatch[1].trim();
      const args = fromMatch[2].trim();
      const size = args === '' ? 0 : args.split(',').length;
      arrays.set(name, { name, size, line: i + 1 });
      continue;
    }
    const newMatch = line.match(/(\w+)\s*=\s*array\.new(?:<\w+>|_\w+)\((\d+)?/);
    if (newMatch) {
      const name = newMatch[1].trim();
      const size = newMatch[2] !== undefined ? parseInt(newMatch[2], 10) : null;
      arrays.set(name, { name, size, line: i + 1 });
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const pattern = /array\.(get|set)\(\s*(\w+)\s*,\s*(-?\d+)/g;
    let match;
    while ((match = pattern.exec(line)) !== null) {
      const method = match[1];
      const arrName = match[2];
      const idx = parseInt(match[3], 10);
      const info = arrays.get(arrName);
      if (!info || info.size === null) continue;
      if (idx < 0 || idx >= info.size) {
        diagnostics.push({
          line: i + 1, column: match.index + 1,
          message: `array.${method}(${arrName}, ${idx}) — index ${idx} out of bounds (array size is ${info.size})`,
          severity: 'error',
        });
      }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const firstLastPattern = /(\w+)\.(first|last)\(\)/g;
    let match;
    while ((match = firstLastPattern.exec(line)) !== null) {
      const arrName = match[1];
      if (arrName === 'array') continue;
      const info = arrays.get(arrName);
      if (info && info.size === 0) {
        diagnostics.push({
          line: i + 1, column: match.index + 1,
          message: `${arrName}.${match[2]}() called on possibly empty array (declared with size 0)`,
          severity: 'warning',
        });
      }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.includes('strategy.entry') || trimmed.includes('strategy.close')) {
      let hasStrategyDecl = false;
      for (const l of lines) {
        if (l.trim().startsWith('strategy(')) { hasStrategyDecl = true; break; }
      }
      if (!hasStrategyDecl) {
        diagnostics.push({
          line: i + 1, column: 1,
          message: 'strategy.entry/close used but no strategy() declaration found — did you mean to use indicator()?',
          severity: 'error',
        });
        break;
      }
    }
  }

  if (!isV6 && source.includes('//@version=')) {
    const vMatch = source.match(/\/\/@version=(\d+)/);
    if (vMatch && parseInt(vMatch[1]) < 5) {
      diagnostics.push({
        line: 1, column: 1,
        message: `Script uses Pine v${vMatch[1]} — consider upgrading to v6 for latest features`,
        severity: 'info',
      });
    }
  }

  return {
    success: true,
    issue_count: diagnostics.length,
    diagnostics,
    note: diagnostics.length === 0 ? 'No static analysis issues found. Use pine_compile or pine_smart_compile for full server-side compilation check.' : undefined,
  };
}

export async function check({ source }) {
  // check() is pure HTTP to pine-facade — no CDP eval involved, so _deps
  // would be unused. Removed for lint cleanliness; restore if a future
  // call path needs to inject the fetch implementation.
  const formData = new URLSearchParams();
  formData.append('source', source);

  const response = await fetch(
    'https://pine-facade.tradingview.com/pine-facade/translate_light?user_name=Guest&pine_id=00000000-0000-0000-0000-000000000000',
    {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': 'https://www.tradingview.com/',
      },
      body: formData,
    }
  );

  if (!response.ok) {
    throw new Error(`TradingView API returned ${response.status}: ${response.statusText}`);
  }

  const result = await response.json();
  const errors = [];
  const warnings = [];
  const inner = result?.result;

  if (inner) {
    if (inner.errors2 && inner.errors2.length > 0) {
      for (const e of inner.errors2) {
        errors.push({
          line: e.start?.line, column: e.start?.column,
          end_line: e.end?.line, end_column: e.end?.column,
          message: e.message,
        });
      }
    }
    if (inner.warnings2 && inner.warnings2.length > 0) {
      for (const w of inner.warnings2) {
        warnings.push({ line: w.start?.line, column: w.start?.column, message: w.message });
      }
    }
  }

  if (result.error && typeof result.error === 'string') {
    errors.push({ message: result.error });
  }

  const compiled = errors.length === 0;
  return {
    success: true,
    compiled,
    error_count: errors.length,
    warning_count: warnings.length,
    errors: errors.length > 0 ? errors : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
    note: compiled ? 'Pine Script compiled successfully.' : undefined,
  };
}

// ── Functions requiring TradingView connection ──

export async function getSource({ _deps } = {}) {
  const { evaluateChecked } = _resolve(_deps);
  const editorReady = await ensurePineEditorOpen({ _deps });
  if (!editorReady) throw new Error('Could not open Pine Editor or Monaco not found in React fiber tree.');

  // evaluateChecked (not evaluate): a large script's getValue() can exceed
  // CDP's silent-truncation threshold; the length checksum surfaces a cut-off
  // read as an error instead of returning a corrupted source.
  const source = await evaluateChecked(`
    (function() {
      var m = ${FIND_MONACO};
      if (!m) return null;
      return m.editor.getValue();
    })()
  `, { label: 'pine_get_source' });

  if (source === null || source === undefined) {
    throw new Error('Monaco editor found but getValue() returned null.');
  }

  return { success: true, source, line_count: source.split('\n').length, char_count: source.length };
}

export async function setSource({ source, _deps }) {
  const { evaluate } = _resolve(_deps);
  const editorReady = await ensurePineEditorOpen({ _deps });
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  const escaped = JSON.stringify(source);

  // Monaco setValue() is synchronous and can freeze the renderer on large
  // scripts, deadlocking the CDP evaluate() round-trip. Run the work via
  // setTimeout(..., 0) so the eval call returns immediately, then poll a
  // window-scoped status flag for completion. Use pushEditOperations when
  // a model is available (better batching, preserves undo stack).
  const token = `__pineSetSource_${Date.now()}`;
  await evaluate(`
    (function() {
      window.${token} = 'pending';
      setTimeout(function() {
        try {
          var m = ${FIND_MONACO};
          if (!m) { window.${token} = 'no_editor'; return; }
          var model = m.editor.getModel();
          if (model) {
            var fullRange = model.getFullModelRange();
            model.pushEditOperations([], [{ range: fullRange, text: ${escaped} }], function() { return null; });
          } else {
            m.editor.setValue(${escaped});
          }
          window.${token} = 'done';
        } catch(e) { window.${token} = 'error:' + e.message; }
      }, 0);
    })()
  `);

  const maxWait = 15000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    await new Promise(r => setTimeout(r, 200));
    const status = await evaluate(`window.${token}`);
    if (status === 'done') {
      await evaluate(`delete window.${token}`);
      return { success: true, lines_set: source.split('\n').length };
    }
    if (status === 'no_editor') {
      await evaluate(`delete window.${token}`);
      throw new Error('Monaco editor not found during setValue().');
    }
    if (status && status.startsWith('error:')) {
      const msg = status.slice(6);
      await evaluate(`delete window.${token}`);
      throw new Error(`Monaco setValue() failed: ${msg}`);
    }
  }

  await evaluate(`delete window.${token}`);
  throw new Error('Pine Editor setValue() timed out after 15s. The script may be too large or the editor is unresponsive.');
}

export async function compile({ _deps } = {}) {
  const { evaluate, getClient } = _resolve(_deps);
  const editorReady = await ensurePineEditorOpen({ _deps });
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  const clicked = await evaluate(`
    (function() {
      // Fast path: TV's stable selector. Survives icon-only button refactors
      // (Desktop 3.4.x ships no text and no title until a script has been
      // added once) because data-qa-id is a test/QA attribute, not styling.
      var qa = document.querySelector('[data-qa-id="add-script-to-chart"]');
      if (qa && qa.offsetParent !== null) {
        qa.click();
        var t = qa.getAttribute('title') || '';
        return /update on chart/i.test(t) ? 'Update on chart' : 'Add to chart';
      }

      var btns = document.querySelectorAll('button');
      var fallback = null;
      var fallbackLabel = null;
      var saveBtn = null;
      for (var i = 0; i < btns.length; i++) {
        var text = btns[i].textContent.trim();
        // TV Desktop 3.1.0+ ships these as icon-only buttons; label lives in the title attr.
        var title = btns[i].getAttribute('title') || '';
        var label = text || title;
        if (/save and add to chart/i.test(label)) {
          btns[i].click();
          return 'Save and add to chart';
        }
        if (!fallback && /^(Add to chart|Update on chart)$/i.test(label)) {
          fallback = btns[i];
          fallbackLabel = label;
        }
        if (!saveBtn && btns[i].className.indexOf('saveButton') !== -1 && btns[i].offsetParent !== null) {
          saveBtn = btns[i];
        }
      }
      if (fallback) { fallback.click(); return fallbackLabel; }
      if (saveBtn) { saveBtn.click(); return 'Pine Save'; }
      return null;
    })()
  `);

  if (!clicked) {
    const c = await getClient();
    await c.Input.dispatchKeyEvent({ type: 'keyDown', modifiers: 2, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await c.Input.dispatchKeyEvent({ type: 'keyUp', key: 'Enter', code: 'Enter' });
  }

  await new Promise(r => setTimeout(r, 2000));
  return { success: true, button_clicked: clicked || 'keyboard_shortcut', source: 'dom_fallback' };
}

export async function getErrors({ _deps } = {}) {
  const { evaluate } = _resolve(_deps);
  const editorReady = await ensurePineEditorOpen({ _deps });
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  const errors = await evaluate(`
    (function() {
      var m = ${FIND_MONACO};
      if (!m) return [];
      var model = m.editor.getModel();
      if (!model) return [];
      var markers = m.env.editor.getModelMarkers({ resource: model.uri });
      return markers.map(function(mk) {
        return { line: mk.startLineNumber, column: mk.startColumn, message: mk.message, severity: mk.severity };
      });
    })()
  `);

  return {
    success: true,
    has_errors: errors?.length > 0,
    error_count: errors?.length || 0,
    errors: errors || [],
  };
}

export async function save({ _deps } = {}) {
  const { evaluate, getClient } = _resolve(_deps);
  const editorReady = await ensurePineEditorOpen({ _deps });
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  // Focus the Monaco textarea before dispatching Ctrl+S — without this,
  // the keystroke is delivered to whatever input had focus last (chart
  // canvas, watchlist row, etc.) and TV either fires the wrong shortcut
  // or no-ops while we still return `Ctrl+S_dispatched`.
  await evaluate(`
    (function() {
      var ta = document.querySelector('.pine-editor-monaco textarea')
            || document.querySelector('[class*="pine-editor"] textarea')
            || document.querySelector('.monaco-editor textarea.inputarea');
      if (ta && typeof ta.focus === 'function') { try { ta.focus(); } catch(e) {} }
      return !!ta;
    })()
  `);

  const c = await getClient();
  await c.Input.dispatchKeyEvent({ type: 'keyDown', modifiers: 2, key: 's', code: 'KeyS', windowsVirtualKeyCode: 83 });
  await c.Input.dispatchKeyEvent({ type: 'keyUp', modifiers: 2, key: 's', code: 'KeyS', windowsVirtualKeyCode: 83 });
  await new Promise(r => setTimeout(r, 800));

  // Handle "Save Script" name dialog that appears for new/unsaved scripts
  const dialogHandled = await evaluate(`
    (function() {
      var saveBtn = null;
      var btns = document.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        var text = btns[i].textContent.trim();
        if (text === 'Save' && btns[i].offsetParent !== null) {
          // Check if it's in a dialog (not the Pine Editor save button)
          var parent = btns[i].closest('[class*="dialog"], [class*="modal"], [class*="popup"], [role="dialog"]');
          if (parent) { saveBtn = btns[i]; break; }
        }
      }
      if (saveBtn) { saveBtn.click(); return true; }
      return false;
    })()
  `);

  if (dialogHandled) await new Promise(r => setTimeout(r, 500));

  return { success: true, action: dialogHandled ? 'saved_with_dialog' : 'Ctrl+S_dispatched' };
}

export async function getConsole({ _deps } = {}) {
  const { evaluate } = _resolve(_deps);
  const editorReady = await ensurePineEditorOpen({ _deps });
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  const entries = await evaluate(`
    (function() {
      var results = [];
      var rows = document.querySelectorAll('[class*="consoleRow"], [class*="log-"], [class*="consoleLine"]');
      if (rows.length === 0) {
        var bottomArea = document.querySelector('[class*="layout__area--bottom"]')
          || document.querySelector('[class*="bottom-widgetbar-content"]');
        if (bottomArea) {
          rows = bottomArea.querySelectorAll('[class*="message"], [class*="log"], [class*="console"]');
        }
      }
      if (rows.length === 0) {
        var pinePanel = document.querySelector('.pine-editor-container')
          || document.querySelector('[class*="pine-editor"]')
          || document.querySelector('[class*="layout__area--bottom"]');
        if (pinePanel) {
          var allSpans = pinePanel.querySelectorAll('span, div');
          for (var s = 0; s < allSpans.length; s++) {
            var txt = allSpans[s].textContent.trim();
            if (/^\\d{2}:\\d{2}:\\d{2}/.test(txt) || /error|warning|info/i.test(allSpans[s].className)) {
              rows = Array.from(rows || []);
              rows.push(allSpans[s]);
            }
          }
        }
      }
      for (var i = 0; i < rows.length; i++) {
        var text = rows[i].textContent.trim();
        if (!text) continue;
        var ts = null;
        var tsMatch = text.match(/^(\\d{4}-\\d{2}-\\d{2}\\s+)?\\d{2}:\\d{2}:\\d{2}/);
        if (tsMatch) ts = tsMatch[0];
        var type = 'info';
        var cls = rows[i].className || '';
        if (/error/i.test(cls) || /error/i.test(text.substring(0, 30))) type = 'error';
        else if (/compil/i.test(text.substring(0, 40))) type = 'compile';
        else if (/warn/i.test(cls)) type = 'warning';
        results.push({ timestamp: ts, type: type, message: text });
      }
      return results;
    })()
  `);

  return { success: true, entries: entries || [], entry_count: entries?.length || 0 };
}

export async function smartCompile({ _deps } = {}) {
  const { evaluate, getClient } = _resolve(_deps);
  const startedAt = Date.now();
  const editorReady = await ensurePineEditorOpen({ _deps });
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  // Snapshot studies WITH ids so the post-check can tell whether the
  // delta came from this script vs an unrelated study added concurrently
  // (the PasanteAdmin honest-success case). Falls back to legacy count
  // semantics if getAllStudies isn't available.
  const studiesBefore = await evaluate(`
    (function() {
      try {
        var chart = window.TradingViewApi._activeChartWidgetWV.value();
        if (chart && typeof chart.getAllStudies === 'function') {
          return chart.getAllStudies().map(function(s) {
            return { id: s.id, name: s.name || s.title || '' };
          });
        }
      } catch(e) {}
      return null;
    })()
  `);

  // Also read the Pine editor's current script title so we can match
  // it against newly-added studies. Lives in [data-qa-id="pine-script-title-button"].
  const pineTitleBefore = await evaluate(`
    (function() {
      try {
        var btn = document.querySelector('[data-qa-id="pine-script-title-button"]');
        if (!btn) return null;
        var h2 = btn.querySelector('h2') || btn;
        return (h2.textContent || '').trim() || null;
      } catch(e) { return null; }
    })()
  `);

  const buttonClicked = await evaluate(`
    (function() {
      // Fast path: TV's stable selector. Survives icon-only button refactors
      // because data-qa-id is a test/QA attribute, not styling.
      var qa = document.querySelector('[data-qa-id="add-script-to-chart"]');
      if (qa && qa.offsetParent !== null) {
        qa.click();
        var t = qa.getAttribute('title') || '';
        return /update on chart/i.test(t) ? 'Update on chart' : 'Add to chart';
      }

      // Fallback: walk buttons by label. Skip elements whose textContent
      // is the *concatenation* of multiple child labels (an outer wrapper
      // div around several buttons would have textContent like
      // "Untitled scriptAdd to chartAdd to chartPublish script" — never a
      // real single-button label). Real Pine action buttons are leaf
      // BUTTON elements with ≤30 chars of text/title.
      var btns = document.querySelectorAll('button');
      var addBtn = null;
      var updateBtn = null;
      var saveAddBtn = null;
      var saveBtn = null;
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        if (b.offsetParent === null) continue;
        var text = (b.textContent || '').trim();
        var title = b.getAttribute('title') || '';
        var label = text || title;
        // Sanity bound: a legitimate Pine button label is short.
        if (label.length > 30) continue;
        if (!saveAddBtn && /save and add to chart/i.test(label)) saveAddBtn = b;
        if (!addBtn && /^add to chart$/i.test(label)) addBtn = b;
        if (!updateBtn && /^update on chart$/i.test(label)) updateBtn = b;
        if (!saveBtn && (b.className || '').indexOf('saveButton') !== -1) saveBtn = b;
      }
      if (saveAddBtn) { saveAddBtn.click(); return 'Save and add to chart'; }
      if (addBtn) { addBtn.click(); return 'Add to chart'; }
      if (updateBtn) { updateBtn.click(); return 'Update on chart'; }
      if (saveBtn) { saveBtn.click(); return 'Pine Save'; }
      return null;
    })()
  `);

  if (!buttonClicked) {
    const c = await getClient();
    await c.Input.dispatchKeyEvent({ type: 'keyDown', modifiers: 2, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await c.Input.dispatchKeyEvent({ type: 'keyUp', key: 'Enter', code: 'Enter' });
  }

  await new Promise(r => setTimeout(r, 2500));

  const errors = await evaluate(`
    (function() {
      var m = ${FIND_MONACO};
      if (!m) return [];
      var model = m.editor.getModel();
      if (!model) return [];
      var markers = m.env.editor.getModelMarkers({ resource: model.uri });
      return markers.map(function(mk) {
        return { line: mk.startLineNumber, column: mk.startColumn, message: mk.message, severity: mk.severity };
      });
    })()
  `);

  const studiesAfter = await evaluate(`
    (function() {
      try {
        var chart = window.TradingViewApi._activeChartWidgetWV.value();
        if (chart && typeof chart.getAllStudies === 'function') {
          return chart.getAllStudies().map(function(s) {
            return { id: s.id, name: s.name || s.title || '' };
          });
        }
      } catch(e) {}
      return null;
    })()
  `);

  // Identify which studies were added by ID diff, then verify the new
  // one's title matches the Pine script — that's "honest" study_added.
  // If a study was added but its name doesn't match the editor title,
  // it came from somewhere else (user clicked Indicators panel during
  // compile, etc.) and we shouldn't claim our compile added it.
  let studyAdded = null;
  let newStudies = null;
  let titleMatch = null;
  if (Array.isArray(studiesBefore) && Array.isArray(studiesAfter)) {
    const beforeIds = new Set(studiesBefore.map(s => s.id));
    newStudies = studiesAfter.filter(s => !beforeIds.has(s.id));
    if (newStudies.length === 0) {
      studyAdded = false;
    } else if (pineTitleBefore) {
      // Tight match: equality first, then strict prefix `title + " "` so
      // "RSI Divergence" doesn't claim credit when the editor title is
      // "RSI". For titles ≤3 chars the substring match was statistically
      // worthless — bail to the "any new study" fallback there.
      const titleLower = pineTitleBefore.toLowerCase().trim();
      if (titleLower.length <= 3) {
        studyAdded = true;
      } else {
        titleMatch = newStudies.find(s => {
          const name = (s.name || '').toLowerCase();
          return name === titleLower || name.startsWith(titleLower + ' ');
        }) || null;
        studyAdded = !!titleMatch;
      }
    } else {
      // No editor title available — fall back to "any new study counts"
      // semantics rather than reporting a false negative.
      studyAdded = true;
    }
  }

  return {
    success: true,
    button_clicked: buttonClicked || 'keyboard_shortcut',
    has_errors: errors?.length > 0,
    errors: errors || [],
    study_added: studyAdded,
    pine_title: pineTitleBefore,
    new_studies: newStudies,
    matched_study: titleMatch,
    elapsed_ms: Date.now() - startedAt,
  };
}

export async function newScript({ type, _deps }) {
  const { evaluate } = _resolve(_deps);
  const editorReady = await ensurePineEditorOpen({ _deps });
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  const typeMap = { indicator: 'indicator', strategy: 'strategy', library: 'library' };
  const templates = {
    indicator: '//@version=6\nindicator("My script")\nplot(close)',
    strategy: '//@version=6\nstrategy("My strategy", overlay=true)\n',
    library: '//@version=6\n// @description TODO: add library description here\nlibrary("MyLibrary")\n',
  };

  const template = templates[type] || templates.indicator;

  // Simply set the source to a new template — this is the most reliable approach
  const escaped = JSON.stringify(template);
  const set = await evaluate(`
    (function() {
      var m = ${FIND_MONACO};
      if (!m) return false;
      m.editor.setValue(${escaped});
      return true;
    })()
  `);

  if (!set) throw new Error('Monaco editor not found. Ensure Pine Editor is open.');

  // setValue swaps Monaco's buffer but does NOT rebind the editor's active
  // script slot — it still points at whatever cloud script was open. A
  // subsequent pine_save / pine_compile would write this blank template back
  // over that script (the same clobber class #158 fixed for pine_open). Flag
  // it so callers don't blind-save; pine_save_as persists as a distinct script.
  return {
    success: true, type, action: 'new_script_created', template: typeMap[type],
    slot_rebound: false,
    warning: 'pine_new replaced the editor buffer with a blank template but did not rebind the editor to a new script slot. A subsequent pine_save / pine_compile may write this template back over the previously-open script. Use pine_save_as to persist it as a distinct new script.',
  };
}

export async function openScript({ name, id, _deps }) {
  if (!name && !id) throw new Error('openScript requires either `name` or `id` (scriptIdPart, e.g. "USER;0da8b34c...").');

  const { evaluateAsync } = _resolve(_deps);
  const editorReady = await ensurePineEditorOpen({ _deps });
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  // Normalize id: callers may pass "USER;<hash>" or just "<hash>". The
  // pine-facade list returns scripts whose scriptIdPart is the full
  // "USER;<hash>" form, so we compare on that.
  const normalizedId = id ? (id.startsWith('USER;') ? id : ('USER;' + id)) : null;
  const escapedName = name ? JSON.stringify(name.toLowerCase()) : 'null';
  const escapedId = normalizedId ? JSON.stringify(normalizedId) : 'null';

  const result = await evaluateAsync(`
    (function() {
      var targetName = ${escapedName};
      var targetId = ${escapedId};
      return fetch('https://pine-facade.tradingview.com/pine-facade/list/?filter=saved', { credentials: 'include' })
        .then(function(r) { return r.json(); })
        .then(function(scripts) {
          if (!Array.isArray(scripts)) return {error: 'pine-facade returned unexpected data'};
          var match = null;
          // Resolve by ID first when given — IDs are unique.
          if (targetId) {
            for (var i = 0; i < scripts.length; i++) {
              if (scripts[i].scriptIdPart === targetId) { match = scripts[i]; break; }
            }
            if (!match) return {error: 'Script with id "' + targetId + '" not found in your saved scripts.'};
          } else {
            for (var i = 0; i < scripts.length; i++) {
              var sn = (scripts[i].scriptName || '').toLowerCase();
              var st = (scripts[i].scriptTitle || '').toLowerCase();
              if (sn === targetName || st === targetName) { match = scripts[i]; break; }
            }
            if (!match) {
              // Substring fallback, but disambiguate: with multiple
              // matches, refuse rather than picking arbitrarily — the
              // previous "first hit wins" silently opened "Strategy v2"
              // when the user asked for "Strategy" if it appeared first.
              var candidates = [];
              for (var j = 0; j < scripts.length; j++) {
                var sn2 = (scripts[j].scriptName || '').toLowerCase();
                var st2 = (scripts[j].scriptTitle || '').toLowerCase();
                if (sn2.indexOf(targetName) !== -1 || st2.indexOf(targetName) !== -1) candidates.push(scripts[j]);
              }
              if (candidates.length === 1) match = candidates[0];
              else if (candidates.length > 1) {
                var names = candidates.map(function(c){ return c.scriptName || c.scriptTitle; }).slice(0, 10).join(', ');
                return {error: 'Ambiguous open: "' + targetName + '" matches ' + candidates.length + ' scripts (' + names + '). Pass the exact scriptName or use id=.'};
              }
            }
            if (!match) return {error: 'Script "' + targetName + '" not found. Use pine_list_scripts to see available scripts.'};
          }

          var id = match.scriptIdPart;
          var ver = (match.version == null) ? 1 : match.version;
          return fetch('https://pine-facade.tradingview.com/pine-facade/get/' + id + '/' + ver, { credentials: 'include' })
            .then(function(r2) { return r2.json(); })
            .then(function(data) {
              var source = data.source || '';
              if (!source) return {error: 'Script source is empty', name: match.scriptName || match.scriptTitle};

              // Prefer pineEditorTestApi when available: it dispatches the same
              // fetchAndOpenScript Redux action TV's File → Open UI fires,
              // atomically rebinding the editor's active script slot
              // (state.script.scriptIdPart). Without this, a bare
              // m.editor.setValue() updates only Monaco's text buffer; the
              // next pine_save / pine_compile fires its save against the
              // PREVIOUSLY-bound slot and silently clobbers an unrelated
              // cloud script. Three reproductions documented upstream
              // (PR tradesdontlie/tradingview-mcp#158).
              var testApi = window.TradingViewApi && typeof window.TradingViewApi.pineEditorTestApi === 'function'
                ? window.TradingViewApi.pineEditorTestApi()
                : null;
              if (testApi && typeof testApi.openScript === 'function' && typeof testApi.openEditor === 'function') {
                return testApi.openEditor()
                  .then(function() { return testApi.openScript({scriptIdPart: id, version: ver}); })
                  .then(function() {
                    return {success: true, name: match.scriptName || match.scriptTitle, id: id, version: ver, lines: source.split('\\n').length, slot_rebound: true};
                  })
                  .catch(function(e) {
                    return {error: 'pineEditorTestApi.openScript failed: ' + (e && e.message || String(e)), name: match.scriptName || match.scriptTitle};
                  });
              }

              // Fallback for pre-testApi TV builds. Flag slot_rebound:false
              // so callers can detect the unsafe path and avoid a subsequent
              // pine_save / pine_compile that would clobber the prior slot.
              var m = ${FIND_MONACO};
              if (m) {
                m.editor.setValue(source);
                return {success: true, name: match.scriptName || match.scriptTitle, id: id, version: ver, lines: source.split('\\n').length, slot_rebound: false, warning: 'pineEditorTestApi unavailable on this TV build; fell back to setValue. A subsequent pine_save / pine_compile may clobber the previously-bound slot.'};
              }
              return {error: 'Monaco editor not found to inject source and pineEditorTestApi unavailable', name: match.scriptName || match.scriptTitle};
            });
        })
        .catch(function(e) { return {error: e.message}; });
    })()
  `);

  if (!result) {
    throw new Error('openScript: no result returned from page (CDP returned undefined — possibly a dropped or oversized response).');
  }
  if (result.error) {
    throw new Error(result.error);
  }

  const out = {
    success: true,
    name: result.name,
    script_id: result.id,
    version: result.version,
    lines: result.lines,
    slot_rebound: result.slot_rebound,
    source: 'internal_api',
    opened: true,
  };
  // warning only set on the unsafe setValue fallback; omit it on the safe path.
  if (result.warning) out.warning = result.warning;
  return out;
}

export async function listScripts({ _deps } = {}) {
  const { evaluateAsync } = _resolve(_deps);
  const scripts = await evaluateAsync(`
    fetch('https://pine-facade.tradingview.com/pine-facade/list/?filter=saved', { credentials: 'include' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!Array.isArray(data)) return {scripts: [], error: 'Unexpected response from pine-facade'};
        return {
          scripts: data.map(function(s) {
            return {
              id: s.scriptIdPart || null,
              name: s.scriptName || s.scriptTitle || 'Untitled',
              title: s.scriptTitle || null,
              version: s.version || null,
              modified: s.modified || null,
            };
          })
        };
      })
      .catch(function(e) { return {scripts: [], error: e.message}; })
  `);

  return {
    success: true,
    scripts: scripts?.scripts || [],
    count: scripts?.scripts?.length || 0,
    source: 'internal_api',
    error: scripts?.error,
  };
}

/**
 * Switch the Pine editor to a different saved script via the UI.
 * Properly switches editor context (unlike pine_open, which just rewrites
 * the source via Monaco — leaves the title button stale).
 *
 * On TV 3.1+ the title-button dropdown is a *context menu* (Save/Copy/
 * Rename/...), not a script-list dropdown. The recent-scripts subsection
 * only carries ~4 entries. The reliable path is the "Open script…" picker
 * (Ctrl+O), which has a search box and lists every saved script.
 *
 * Steps:
 *   1. Focus the Pine editor and send Ctrl+O.
 *   2. Wait for [data-name="open-user-script-dialog"].
 *   3. Set the search input via the React-friendly native setter, then
 *      dispatch 'input' so React's onChange fires.
 *   4. Find the list row whose title prefix-matches `name`. Use exact
 *      title-portion match (text before "Version:") to disambiguate
 *      "Foo" from "Foo v2".
 *   5. Invoke the React onClick on .itemInfo-gisYB8vu with a full
 *      SyntheticEvent shape (TV's handler calls isDefaultPrevented()).
 *   6. Close the dialog via mouse-event sequence on [data-qa-id="close"]
 *      (ESC is ignored by TV's dialog).
 *   7. Verify the title button now shows the requested name.
 */
export async function switchScript({ name, _deps }) {
  const { evaluate, evaluateAsync } = _resolve(_deps);
  const editorReady = await ensurePineEditorOpen({ _deps });
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  const TITLE_BTN = `(document.querySelector('[data-qa-id="pine-script-title-button"]') || document.querySelector('[class*="nameButton"]'))`;

  const currentBefore = await evaluate(`
    (function() {
      var btn = ${TITLE_BTN};
      return btn ? (btn.textContent || '').trim() : null;
    })()
  `);
  if (currentBefore === name) {
    return { success: true, requested: name, current: name, shortCircuited: true };
  }

  // Clear any open menus (title button may have been clicked earlier).
  await evaluate(`(function() {
    document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', code:'Escape', keyCode:27, which:27, bubbles:true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', code:'Escape', keyCode:27, which:27, bubbles:true }));
  })()`);
  await new Promise(r => setTimeout(r, 200));

  // Focus the Pine editor textarea so Ctrl+O is captured by Monaco /
  // TV's script-editor keybinding, not by some other panel.
  await evaluate(`(function() {
    var c = document.querySelector('.pine-editor-monaco') || document.querySelector('[class*="pine-editor"]');
    var ta = c && c.querySelector('textarea');
    if (ta) ta.focus();
  })()`);
  await new Promise(r => setTimeout(r, 100));

  // Ctrl+O — the shortcut shown on the "Open script…" menu item.
  await evaluate(`(function() {
    var t = document.activeElement || document.body;
    function ev(type) {
      return new KeyboardEvent(type, {
        key: 'o', code: 'KeyO', keyCode: 79, which: 79,
        ctrlKey: true, bubbles: true, cancelable: true,
      });
    }
    t.dispatchEvent(ev('keydown'));
    t.dispatchEvent(ev('keypress'));
    t.dispatchEvent(ev('keyup'));
  })()`);

  // Poll for the picker dialog to mount. Must use evaluateAsync so the
  // Promise actually resolves on the page side before returning.
  const dialogReady = await evaluateAsync(`
    new Promise(function(resolve) {
      var elapsed = 0;
      var iv = setInterval(function() {
        if (document.querySelector('[data-name="open-user-script-dialog"]')) {
          clearInterval(iv); resolve(true);
        }
        elapsed += 50;
        if (elapsed >= 2000) { clearInterval(iv); resolve(false); }
      }, 50);
    })
  `);
  if (!dialogReady) throw new Error('Open-script picker dialog did not appear after Ctrl+O.');

  // Type the name into the search box. React inputs ignore plain
  // `input.value = x` — use the native setter then dispatch 'input'.
  const escapedName = JSON.stringify(name);
  await evaluate(`(function() {
    var dialog = document.querySelector('[data-name="open-user-script-dialog"]');
    var input = dialog && (dialog.querySelector('input[role="searchbox"]') || dialog.querySelector('input'));
    if (!input) return;
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${escapedName});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await new Promise(r => setTimeout(r, 400));

  // Find the row matching `name` and invoke its React onClick.
  // List rows are bare DIVs (no role/data-name); structure is
  //   <div>
  //     <div.itemInfo-gisYB8vu> ← onClick handler lives here
  //       <...title text...>Version: ...
  //     </div>
  //     <span.favorite-_FRQhM5Y onClick> <span.button-... onClick onMouseDown>
  //   </div>
  // Match the title portion (text before "Version:") for exact equality
  // so "Foo" doesn't accidentally select "Foo v2".
  const clickResult = await evaluate(`(function() {
    var dialog = document.querySelector('[data-name="open-user-script-dialog"]');
    if (!dialog) return { error: 'dialog missing after search' };
    var listContainer = dialog.querySelector('.list-AhaeiE0y') || dialog.querySelector('[class*="list-AhaeiE0y"]');
    var itemsRoot = listContainer && listContainer.firstElementChild;
    var items = itemsRoot ? Array.prototype.slice.call(itemsRoot.children) : [];
    if (items.length === 0) return { error: 'no_results_in_picker', searched: ${escapedName} };

    function titlePart(text) {
      var idx = text.indexOf('Version:');
      return (idx >= 0 ? text.slice(0, idx) : text).trim();
    }

    var target = ${escapedName};
    var exact = null;
    var prefix = null;
    for (var i = 0; i < items.length; i++) {
      var t = items[i].textContent || '';
      if (titlePart(t) === target) { exact = items[i]; break; }
      if (!prefix && t.indexOf(target) === 0) prefix = items[i];
    }
    var match = exact || prefix;
    if (!match) {
      return {
        error: 'no_match',
        searched: target,
        results: items.slice(0, 10).map(function(el) { return titlePart(el.textContent || ''); }),
      };
    }

    var info = match.querySelector('.itemInfo-gisYB8vu');
    if (!info) {
      // fallback: first descendant carrying a React onClick
      var all = match.querySelectorAll('*');
      for (var j = 0; j < all.length; j++) {
        var el = all[j];
        var pk = Object.keys(el).find(function(k) { return k.indexOf('__reactProps$') === 0; });
        if (pk && el[pk] && typeof el[pk].onClick === 'function') { info = el; break; }
      }
    }
    if (!info) return { error: 'no_clickable_element_in_row' };

    var propKey = Object.keys(info).find(function(k) { return k.indexOf('__reactProps$') === 0; });
    var props = propKey ? info[propKey] : null;
    if (!props || typeof props.onClick !== 'function') return { error: 'no_react_onclick' };

    var ev = {
      preventDefault: function() {}, stopPropagation: function() {},
      isDefaultPrevented: function() { return false; },
      isPropagationStopped: function() { return false; },
      persist: function() {},
      currentTarget: info, target: info,
      nativeEvent: { type: 'click' }, type: 'click',
      button: 0, buttons: 1, bubbles: true, cancelable: true,
    };
    try { props.onClick(ev); }
    catch (e) { return { error: 'onclick_threw', detail: String(e) }; }
    return { ok: true, matched_via: exact ? 'exact_title' : 'prefix' };
  })()`);

  if (clickResult && clickResult.error) {
    // Close the dialog so the editor isn't left stuck open.
    await _closeOpenScriptDialog(evaluate);
    if (clickResult.error === 'no_match') {
      throw new Error(`Script "${name}" not found in picker. Available results (first 10): ${(clickResult.results || []).join(', ')}`);
    }
    if (clickResult.error === 'no_results_in_picker') {
      throw new Error(`Script "${name}" not found in picker (search returned 0 results). Check pine_list_scripts for available names.`);
    }
    throw new Error(`switchScript failed: ${clickResult.error}${clickResult.detail ? ' — ' + clickResult.detail : ''}`);
  }

  // Wait for title-button text to reflect the new script (TV updates it
  // after the load completes — Monaco setValue is sync, but title binding
  // goes through a redux dispatch).
  let currentName = null;
  for (let i = 0; i < 40; i++) {
    currentName = await evaluate(`
      (function() {
        var btn = ${TITLE_BTN};
        return btn ? (btn.textContent || '').trim() : null;
      })()
    `);
    if (currentName === name) break;
    await new Promise(r => setTimeout(r, 50));
  }

  // Close picker regardless of outcome so the editor is usable.
  await _closeOpenScriptDialog(evaluate);

  if (currentName !== name) {
    throw new Error(
      `switchScript: clicked picker row but title button still shows "${currentName}" (expected "${name}"). ` +
      `Source may have been updated; reload TV if title binding looks stuck.`
    );
  }

  return {
    success: true,
    requested: name,
    current: currentName,
    matched_via: clickResult.matched_via,
  };
}

// Close the open-user-script-dialog by firing a real mouse-event
// sequence on its X button. ESC keydown is silently ignored by TV's
// picker; only mousedown+mouseup+click on [data-qa-id="close"] works.
async function _closeOpenScriptDialog(evaluate) {
  await evaluate(`(function() {
    var dialog = document.querySelector('[data-name="open-user-script-dialog"]');
    if (!dialog) return;
    var btn = dialog.querySelector('[data-qa-id="close"]');
    if (!btn) return;
    var r = btn.getBoundingClientRect();
    function fire(type) {
      btn.dispatchEvent(new MouseEvent(type, {
        bubbles: true, cancelable: true, view: window,
        clientX: r.x + r.width/2, clientY: r.y + r.height/2,
        button: 0, buttons: 1,
      }));
    }
    fire('mousedown'); fire('mouseup'); fire('click');
  })()`);
  await new Promise(r => setTimeout(r, 200));
}

// Open the Pine title-button menu and click an item (with optional submenu).
// Used by version_history and other menu-driven flows. Real MouseEvents
// (mousedown+mouseup+click) are required — TV's React tree ignores .click()
// on these dropdown items in current builds.
async function _pineMenuAction(label, subLabel, _deps) {
  const { evaluateAsync } = _resolve(_deps);
  const result = await evaluateAsync(`
    (function() {
      function mc(el) {
        ['mousedown','mouseup','click'].forEach(function(t) {
          el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
        });
      }
      function poll(fn, interval, timeout) {
        return new Promise(function(resolve, reject) {
          var elapsed = 0;
          var t = setInterval(function() {
            var r = fn();
            if (r !== null) { clearInterval(t); resolve(r); return; }
            elapsed += interval;
            if (elapsed >= timeout) { clearInterval(t); reject(new Error('poll timeout')); }
          }, interval);
        });
      }

      var btn = document.querySelector('[data-qa-id="pine-script-title-button"]');
      if (!btn) return Promise.resolve({ error: 'title button not found' });
      btn.click();

      var menuId = btn.getAttribute('aria-controls');
      return poll(function() {
        var menu = menuId && document.getElementById(menuId);
        if (!menu || menu.querySelectorAll('[role="menuitem"]').length === 0) return null;
        return menu;
      }, 50, 2000).then(function(menu) {
        var items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
        var label = ${JSON.stringify(label)};
        var target = items.find(function(el) {
          return el.getAttribute('aria-label') === label ||
                 (label === 'Create new' && el.getAttribute('aria-haspopup') === 'menu' && !el.getAttribute('aria-label'));
        });
        if (!target) return { error: 'menu item not found: ' + label, available: items.map(function(el) { return el.getAttribute('aria-label'); }) };

        if (!${JSON.stringify(subLabel || null)}) {
          mc(target);
          return { ok: true };
        }

        target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        var subId = target.getAttribute('aria-controls');

        return poll(function() {
          var submenu = subId && document.getElementById(subId);
          if (!submenu || submenu.querySelectorAll('[role="menuitem"]').length === 0) return null;
          return submenu;
        }, 50, 1000).then(function(submenu) {
          var sub = ${JSON.stringify((subLabel || '').toLowerCase())};
          var subTarget = Array.from(submenu.querySelectorAll('[role="menuitem"]')).find(function(el) {
            return (el.getAttribute('aria-label') || '').toLowerCase() === sub;
          });
          if (!subTarget) return { error: 'submenu item not found: ' + sub };
          mc(subTarget);
          return { ok: true };
        });
      }).catch(function(e) { return { error: e.message }; });
    })()
  `);
  if (result?.error) throw new Error(result.error);
}

// Resolve the currently open script's pine-facade {id, name, version}.
// Reads the editor title button's text, then matches it against the saved
// scripts list. When `strict: true` (the default for destructive flows
// like renameScript / deleteScript) the substring fallback is disabled —
// the title button text is authoritative for destructive operations and
// the previous fuzzy fallback could resolve "My Test" to the wrong
// script (e.g. "Test" or "My Test v2") when title-button text was
// truncated or stale.
async function _currentScriptInfo(_deps, { strict = true } = {}) {
  const { evaluateAsync } = _resolve(_deps);
  const result = await evaluateAsync(`
    (function() {
      var titleBtn = document.querySelector('[data-qa-id="pine-script-title-button"]');
      var currentName = titleBtn ? (titleBtn.querySelector('h2') || titleBtn).textContent.trim() : null;
      var strict = ${strict ? 'true' : 'false'};
      return fetch('https://pine-facade.tradingview.com/pine-facade/list/?filter=saved', { credentials: 'include' })
        .then(function(r) { return r.json(); })
        .then(function(scripts) {
          if (!Array.isArray(scripts)) return { error: 'unexpected pine-facade response' };
          var match = null;
          var nameLower = (currentName || '').toLowerCase();
          for (var i = 0; i < scripts.length; i++) {
            var sn = (scripts[i].scriptName || '').toLowerCase();
            var st = (scripts[i].scriptTitle || '').toLowerCase();
            if (sn === nameLower || st === nameLower) { match = scripts[i]; break; }
          }
          if (!match && !strict) {
            for (var j = 0; j < scripts.length; j++) {
              var sn2 = (scripts[j].scriptName || '').toLowerCase();
              if (sn2.indexOf(nameLower) !== -1 || nameLower.indexOf(sn2) !== -1) { match = scripts[j]; break; }
            }
          }
          if (!match) return { error: 'Could not find current script in pine-facade (exact match required). Editor title: ' + currentName };
          return { id: match.scriptIdPart, name: match.scriptName || match.scriptTitle, version: match.version };
        })
        .catch(function(e) { return { error: e.message }; });
    })()
  `);
  if (result?.error) throw new Error(result.error);
  return result;
}

/**
 * Save the current Pine script as a new file via pine-facade REST API,
 * then reopen the new script so the editor reflects the new identity.
 * Without the reopen, subsequent pine_save would write back to the
 * previous script — not the saved-as copy.
 */
export async function saveAs({ name, overwrite = false, _deps }) {
  const { evaluateChecked, evaluateAsync } = _resolve(_deps);
  const editorReady = await ensurePineEditorOpen({ _deps });
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  // evaluateChecked: a large editor buffer can exceed CDP's silent-truncation
  // threshold; without the checksum a cut-off source would be POSTed to the
  // cloud, persisting a corrupted copy.
  const source = await evaluateChecked(`
    (function() { var m = ${FIND_MONACO}; return m ? m.editor.getValue() : null; })()
  `, { label: 'pine_save_as_read' });
  if (!source) throw new Error('Could not read source from Monaco editor.');

  const copyName = name || 'Copy';
  // Default overwrite:false so "save as a copy" never silently replaces an
  // existing same-named cloud script. Caller must pass overwrite:true to replace.
  const result = await evaluateAsync(`
    (function() {
      var fd = new FormData();
      fd.append('source', ${JSON.stringify(source)});
      return fetch('https://pine-facade.tradingview.com/pine-facade/save/new?name=' + encodeURIComponent(${JSON.stringify(copyName)}) + '&allow_overwrite=${overwrite ? 'true' : 'false'}', {
        method: 'POST', credentials: 'include', body: fd,
      })
        .then(function(r) { return r.json().then(function(d) { return { status: r.status, data: d }; }); })
        .catch(function(e) { return { error: e.message }; });
    })()
  `);
  if (result?.error) throw new Error(result.error);
  if (result?.status >= 400) {
    const detail = JSON.stringify(result.data);
    throw new Error(
      overwrite
        ? 'pine-facade save/new failed: ' + detail
        : `pine-facade save/new failed (a script named "${copyName}" may already exist — pass overwrite:true to replace it): ${detail}`,
    );
  }

  const d = result?.data || {};
  // TV 3.2.0 changed the save/new response shape: identity moved from a
  // top-level scriptIdPart to result.metaInfo.id, formatted as
  // "Script$USER;<hash>@tv-scripting-101". Without unwrapping it, scriptId
  // falls back to null and the reopen below degrades to the unsafe
  // reopen-by-name path (can rebind a different same-named script) —
  // re-opening the data-loss window 07d8117 closed. Extract the bare
  // "USER;<hash>" form; keep the legacy top-level keys for older builds.
  let scriptId = d.scriptIdPart || d.id || d.script_id || null;
  if (!scriptId && d.result?.metaInfo?.id) {
    const m = String(d.result.metaInfo.id).match(/USER;[0-9a-fA-F]+/);
    if (m) scriptId = m[0];
  }

  // After save/new, the editor still points at the previous script; reopen
  // the new copy so subsequent pine_save writes back to the right identity.
  // Reopen by the freshly-saved id when available — reopening by name can
  // rebind to a DIFFERENT same-named script. Fall back to name only if the
  // save response carried no id. If the reopen fails, the save itself
  // succeeded — surface the partial success so callers can decide.
  let reopened = true;
  let reopenError = null;
  try {
    if (scriptId) await openScript({ id: scriptId, _deps });
    else await openScript({ name: copyName, _deps });
  } catch (err) {
    reopened = false;
    reopenError = err.message;
  }

  return {
    success: true, action: 'save_as', name: copyName, script_id: scriptId,
    reopened,
    ...(reopenError ? { reopen_error: reopenError, warning: `Saved as "${copyName}" but the editor still points at the original script. Subsequent pine_save will write back to the previous script — open "${copyName}" via pine_open to switch.` } : {}),
  };
}

/**
 * Rename the currently open Pine script via pine-facade REST API.
 */
export async function renameScript({ name, _deps }) {
  const { evaluateAsync } = _resolve(_deps);
  const editorReady = await ensurePineEditorOpen({ _deps });
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  const { id, name: oldName } = await _currentScriptInfo(_deps);
  const encoded = encodeURIComponent(id);

  const result = await evaluateAsync(`
    (function() {
      return fetch('https://pine-facade.tradingview.com/pine-facade/rename/' + ${JSON.stringify(encoded)} + '?name=' + encodeURIComponent(${JSON.stringify(name)}) + '&force=true', {
        method: 'POST', credentials: 'include',
      })
        .then(function(r) { return { status: r.status, ok: r.ok }; })
        .catch(function(e) { return { error: e.message }; });
    })()
  `);
  if (result?.error) throw new Error(result.error);
  if (!result?.ok) throw new Error('pine-facade rename failed with status ' + result?.status);

  return { success: true, action: 'renamed', old_name: oldName, name, script_id: id };
}

/**
 * Open TV's "Version history" dialog for the current script.
 * No way to navigate the history tree programmatically — this just opens
 * the dialog so the user can pick a revision.
 */
export async function versionHistory({ _deps } = {}) {
  const editorReady = await ensurePineEditorOpen({ _deps });
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  await _pineMenuAction('Version history…', null, _deps);
  await new Promise(r => setTimeout(r, 500));

  return { success: true, action: 'version_history_opened' };
}

/**
 * Delete a saved Pine script by name via pine-facade REST API.
 * The Recently Used dropdown still shows the name until next TV reload.
 */
export async function deleteScript({ name, _deps }) {
  const { evaluateAsync } = _resolve(_deps);
  const list = await evaluateAsync(`
    fetch('https://pine-facade.tradingview.com/pine-facade/list/?filter=saved', { credentials: 'include' })
      .then(function(r) { return r.json(); })
      .catch(function(e) { return { error: e.message }; })
  `);
  if (list?.error) throw new Error('Could not fetch script list: ' + list.error);
  if (!Array.isArray(list)) throw new Error('Unexpected pine-facade response');

  const target = name.toLowerCase();
  // Delete is destructive and irreversible. Exact match required; if missing,
  // fall back to substring ONLY when there is exactly one candidate. Multiple
  // substring matches → refuse and ask the caller to disambiguate. The fuzzy
  // single-hit fallback preserves convenience for "delete my one Strategy v2"
  // without risking deletion of an unrelated 'Strategy' / 'Old Strategy'.
  let match = list.find(s => (s.scriptName || '').toLowerCase() === target || (s.scriptTitle || '').toLowerCase() === target);
  if (!match) {
    const candidates = list.filter(s =>
      (s.scriptName || '').toLowerCase().includes(target) ||
      (s.scriptTitle || '').toLowerCase().includes(target)
    );
    if (candidates.length === 1) {
      match = candidates[0];
    } else if (candidates.length > 1) {
      const names = candidates.map(s => s.scriptName || s.scriptTitle).slice(0, 10).join(', ');
      throw new Error(
        `Ambiguous delete: "${name}" matches ${candidates.length} scripts (${names}). ` +
        `Pass the exact scriptName to disambiguate.`
      );
    }
  }
  if (!match) throw new Error(`Script "${name}" not found. Use pine_list_scripts to see available scripts.`);

  const id = match.scriptIdPart;
  const scriptName = match.scriptName || match.scriptTitle;

  const result = await evaluateAsync(`
    fetch('https://pine-facade.tradingview.com/pine-facade/delete/' + encodeURIComponent(${JSON.stringify(id)}), {
      method: 'POST', credentials: 'include',
    }).then(function(r) { return { status: r.status, ok: r.ok }; })
      .catch(function(e) { return { error: e.message }; })
  `);

  if (result?.error) throw new Error('pine-facade delete failed: ' + result.error);
  if (!result?.ok) throw new Error('pine-facade delete returned status ' + result?.status);

  return {
    success: true,
    action: 'deleted',
    name: scriptName,
    script_id: id,
    note: 'Script removed from TV cloud. Recently Used list clears on next TV session reload.',
  };
}
