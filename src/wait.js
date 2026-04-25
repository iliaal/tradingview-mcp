import { evaluate } from './connection.js';

const DEFAULT_TIMEOUT = 10000;
const POLL_INTERVAL = 200;

const STUDY_COLLECTIONS = {
  dwglabels: 'labels',
  dwglines: 'lines',
  dwgboxes: 'boxes',
  dwgtablecells: 'tableCells',
};
const STUDY_SIGNATURE_JS = `
  (function() {
    try {
      var chart = window.TradingViewApi._activeChartWidgetWV.value()._chartWidget;
      if (!chart) return 'no-chart';
      var sources = chart.model().model().dataSources();
      var parts = [];
      try {
        var bars = chart.model().mainSeries().bars();
        if (bars && typeof bars.lastIndex === 'function') {
          var lb = bars.valueAt(bars.lastIndex());
          parts.push('mb:' + (lb ? lb[0] : 0) + ':' + (typeof bars.size === 'function' ? bars.size() : 0));
        }
      } catch(e) {}
      var keyMap = ${JSON.stringify(STUDY_COLLECTIONS)};
      for (var si = 0; si < sources.length; si++) {
        var s = sources[si];
        if (!s || !s.metaInfo || !s._graphics || !s._graphics._primitivesCollection) continue;
        var pc = s._graphics._primitivesCollection;
        for (var k in keyMap) {
          try {
            var outer = pc[k];
            if (!outer || typeof outer.get !== 'function') continue;
            var inner = outer.get(keyMap[k]);
            if (!inner || typeof inner.get !== 'function') continue;
            var coll = inner.get(false);
            if (!coll || !coll._primitivesDataById) continue;
            var size = coll._primitivesDataById.size;
            if (size === 0) { parts.push(si + ':' + k + ':0:0'); continue; }
            var maxX = 0;
            coll._primitivesDataById.forEach(function(v) {
              if (!v) return;
              var x = v.x != null ? v.x : (v.x2 != null ? v.x2 : 0);
              if (typeof x === 'number' && x > maxX) maxX = x;
            });
            parts.push(si + ':' + k + ':' + size + ':' + maxX);
          } catch(e) {}
        }
      }
      return parts.join('|');
    } catch(e) { return 'err:' + (e && e.message || 'unknown'); }
  })()
`;

export async function waitForChartReady(expectedSymbol = null, expectedTf = null, timeout = DEFAULT_TIMEOUT) {
  const start = Date.now();
  let lastBarCount = -1;
  let stableCount = 0;

  while (Date.now() - start < timeout) {
    const state = await evaluate(`
      (function() {
        // Check for loading spinner
        var spinner = document.querySelector('[class*="loader"]')
          || document.querySelector('[class*="loading"]')
          || document.querySelector('[data-name="loading"]');
        var isLoading = spinner && spinner.offsetParent !== null;

        // Try to get bar count from data window or chart
        var barCount = -1;
        try {
          var bars = document.querySelectorAll('[class*="bar"]');
          barCount = bars.length;
        } catch {}

        // Get current symbol from header
        var symbolEl = document.querySelector('[data-name="legend-source-title"]')
          || document.querySelector('[class*="title"] [class*="apply-common-tooltip"]');
        var currentSymbol = symbolEl ? symbolEl.textContent.trim() : '';

        return { isLoading: !!isLoading, barCount: barCount, currentSymbol: currentSymbol };
      })()
    `);

    if (!state) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      continue;
    }

    // Not ready if still loading
    if (state.isLoading) {
      stableCount = 0;
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      continue;
    }

    // Check symbol match if expected
    if (expectedSymbol && state.currentSymbol && !state.currentSymbol.toUpperCase().includes(expectedSymbol.toUpperCase())) {
      stableCount = 0;
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      continue;
    }

    // Check bar count stability
    if (state.barCount === lastBarCount && state.barCount > 0) {
      stableCount++;
    } else {
      stableCount = 0;
    }
    lastBarCount = state.barCount;

    if (stableCount >= 2) {
      return true;
    }

    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }

  // Timeout — return true anyway, caller should verify
  return false;
}

/**
 * Wait until all Pine studies have finished re-executing.
 * Polls the studies' _graphics._primitivesCollection (labels/lines/boxes/tables)
 * plus the main series last-bar timestamp, and waits for the combined signature
 * to stabilize across several consecutive polls. Also enforces a minimum warmup
 * so callers that just triggered a resolution change don't return before the
 * study pipeline has had a chance to start.
 *
 * Returns true when stable, false on timeout.
 */
export async function waitForStudiesReady({
  timeout = 8000,
  minWarmupMs = 600,
  stablePolls = 3,
  pollInterval = POLL_INTERVAL,
  evaluateFn = evaluate,
} = {}) {
  const start = Date.now();
  let prev = null;
  let stable = 0;

  while (Date.now() - start < timeout) {
    let sig;
    try { sig = await evaluateFn(STUDY_SIGNATURE_JS); }
    catch { sig = null; }

    if (prev !== null && sig === prev) stable++;
    else stable = 0;
    prev = sig;

    const elapsed = Date.now() - start;
    if (stable >= stablePolls && elapsed >= minWarmupMs) return true;

    await new Promise(r => setTimeout(r, pollInterval));
  }
  return false;
}
