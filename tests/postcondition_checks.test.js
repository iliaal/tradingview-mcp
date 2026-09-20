/**
 * Postcondition read-backs — mocked unit tests (no TV Desktop needed).
 *
 * Regression class: TV silently absorbs chart mutations (resolution change
 * swallowed by a dialog, zoom clamped to the loaded bar buffer), so a
 * fire-and-forget call reports success while the chart never moved. These
 * tests pin the read-back fields that make such misses visible:
 * - setTimeframe: requested/changed/warning via extended _normalizeResolution
 *   spellings (4H/240, 15m/15, seconds, TV-canonical 1M — never NMO).
 * - scrollToDate: target_in_visible_range via getVisibleRange re-read;
 *   a miss stays success:true (diagnostic, not a throw).
 * - listDrawings: price/title enrichment with null/'' defaults.
 * - watchlist anchor: locale-independent right-toolbar/base anchor opens the
 *   panel with legacy anchors absent; legacy fallback still works.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { setTimeframe, scrollToDate } from '../src/core/chart.js';
import { listDrawings } from '../src/core/drawing.js';
import { add as watchlistAdd } from '../src/core/watchlist.js';
import { openPanel } from '../src/core/ui.js';

// ---------------------------------------------------------------------------
// setTimeframe resolution matching
// ---------------------------------------------------------------------------

function tfDeps({ before, after }) {
  let resCalls = 0;
  const evaluate = async (expr) => {
    if (expr.includes('setResolution')) return undefined;
    if (expr.includes('resolution()')) {
      resCalls += 1;
      return resCalls === 1 ? before : after;
    }
    return undefined;
  };
  return {
    _deps: {
      evaluate,
      waitForChartReady: async () => true,
      waitForStudiesReady: async () => true,
      dismissBlockingDialogs: async () => [],
    },
  };
}

describe('setTimeframe — extended resolution spellings', () => {
  it('4H requested matches 240 actual (no warning)', async () => {
    const r = await setTimeframe({ timeframe: '4H', ...tfDeps({ before: '60', after: '240' }) });
    assert.equal(r.success, true);
    assert.equal(r.timeframe, '240');
    assert.equal(r.changed, true);
    assert.equal(r.warning, undefined);
  });

  it('12H requested matches 720 actual', async () => {
    const r = await setTimeframe({ timeframe: '12H', ...tfDeps({ before: '60', after: '720' }) });
    assert.equal(r.warning, undefined);
  });

  it('15m requested matches bare-minutes 15 actual', async () => {
    const r = await setTimeframe({ timeframe: '15m', ...tfDeps({ before: '60', after: '15' }) });
    assert.equal(r.warning, undefined);
  });

  it('D requested matches 1D actual', async () => {
    const r = await setTimeframe({ timeframe: 'D', ...tfDeps({ before: '60', after: '1D' }) });
    assert.equal(r.warning, undefined);
  });

  it('1MO normalizes to TV-canonical 1M (never NMO)', async () => {
    const r = await setTimeframe({ timeframe: '1MO', ...tfDeps({ before: '1D', after: '1M' }) });
    assert.equal(r.warning, undefined);
    assert.equal(r.timeframe, '1M');
  });

  it('seconds spelling 30s matches 30S actual', async () => {
    const r = await setTimeframe({ timeframe: '30s', ...tfDeps({ before: '60', after: '30S' }) });
    assert.equal(r.warning, undefined);
  });

  it('genuine mismatch surfaces a warning but success stays true', async () => {
    const r = await setTimeframe({ timeframe: '1D', ...tfDeps({ before: '1D', after: '1W' }) });
    assert.equal(r.success, true);
    assert.match(r.warning, /1W/);
  });
});

// ---------------------------------------------------------------------------
// scrollToDate read-back
// ---------------------------------------------------------------------------

function scrollDeps({ resolution, range }) {
  const evaluate = async (expr) => {
    if (expr.includes('resolution()')) return resolution;
    if (expr.includes('getVisibleRange')) return range;
    return undefined; // zoom writes return nothing
  };
  return { _deps: { evaluate } };
}

const TS = 1700000000;

describe('scrollToDate — target_in_visible_range read-back', () => {
  it('reports true when the target lands inside the re-read range', async () => {
    const r = await scrollToDate({
      date: String(TS),
      ...scrollDeps({ resolution: '60', range: { from: TS - 100, to: TS + 100 } }),
    });
    assert.equal(r.success, true);
    assert.equal(r.centered_on, TS);
    assert.equal(r.target_in_visible_range, true);
    assert.deepEqual(r.actual, { from: TS - 100, to: TS + 100 });
    assert.equal(r.actual_read_failed, undefined);
  });

  it('reports false on snap-back but keeps success:true (non-fatal)', async () => {
    const r = await scrollToDate({
      date: String(TS),
      ...scrollDeps({ resolution: '60', range: { from: TS + 10_000_000, to: TS + 20_000_000 } }),
    });
    assert.equal(r.success, true);
    assert.equal(r.target_in_visible_range, false);
  });

  it('probe failure surfaces actual_read_failed, still success:true', async () => {
    const r = await scrollToDate({
      date: String(TS),
      ...scrollDeps({ resolution: '60', range: { from: 0, to: 0, error: 'boom' } }),
    });
    assert.equal(r.success, true);
    assert.equal(r.target_in_visible_range, false);
    assert.equal(r.actual_read_failed, true);
    assert.equal(r.actual_read_error, 'boom');
  });

  it('treats a 13-digit epoch as milliseconds', async () => {
    const r = await scrollToDate({
      date: '1700000000000',
      ...scrollDeps({ resolution: '60', range: { from: TS - 100, to: TS + 100 } }),
    });
    assert.equal(r.centered_on, TS);
  });

  it('sizes the window from the resolution (240 -> 50 bars of 240 min)', async () => {
    const r = await scrollToDate({
      date: String(TS),
      ...scrollDeps({ resolution: '240', range: { from: TS - 100, to: TS + 100 } }),
    });
    assert.equal(r.window.to - r.window.from, 50 * 240 * 60);
  });

  it('throws on an unparseable date', async () => {
    await assert.rejects(
      scrollToDate({ date: 'not-a-date', ...scrollDeps({ resolution: '60', range: {} }) }),
      /Could not parse date/,
    );
  });
});

// ---------------------------------------------------------------------------
// listDrawings price+title enrichment (page JS executed in vm against fakes)
// ---------------------------------------------------------------------------

function runListDrawingsExpr(expr, api) {
  const sandbox = { window: { __t: api } };
  vm.createContext(sandbox);
  // JSON round-trip: vm-realm objects carry a foreign prototype, which
  // assert.deepEqual rejects — and CDP would serialize the same way.
  return JSON.parse(JSON.stringify(vm.runInContext(expr, sandbox)));
}

function drawingsDeps(api) {
  const calls = [];
  const evaluate = async (expr) => {
    calls.push(expr);
    return runListDrawingsExpr(expr, api);
  };
  return { _deps: { evaluate, getChartApi: async () => 'window.__t' }, calls };
}

describe('listDrawings — price+title enrichment', () => {
  it('resolves price from first point and title from lineDataSource', async () => {
    const api = {
      getAllShapes: () => [{ id: 'a', name: 'Long Position' }],
      getShapeById: () => ({
        getPoints: () => [{ price: 123.45, time: TS }],
        lineDataSource: () => ({ properties: () => ({ title: 'My idea' }) }),
      }),
    };
    const r = await listDrawings(drawingsDeps(api));
    assert.equal(r.success, true);
    assert.equal(r.count, 1);
    assert.deepEqual(r.shapes, [{ id: 'a', name: 'Long Position', price: 123.45, title: 'My idea' }]);
  });

  it('calls title when it is a function, defaults when accessors throw', async () => {
    const api = {
      getAllShapes: () => [
        { id: 'fn', name: 'Trend Line' },
        { id: 'bare', name: 'HLine' },
      ],
      getShapeById: (id) => {
        if (id === 'fn') {
          return {
            getPoints: () => [{ price: 99.5, time: TS }],
            lineDataSource: () => ({ properties: () => ({ title: () => 'fn title' }) }),
          };
        }
        return {
          getPoints: () => { throw new Error('no points'); },
        };
      },
    };
    const r = await listDrawings(drawingsDeps(api));
    assert.deepEqual(r.shapes, [
      { id: 'fn', name: 'Trend Line', price: 99.5, title: 'fn title' },
      { id: 'bare', name: 'HLine', price: null, title: '' },
    ]);
  });

  it('falls back to null/empty defaults when the shape is gone', async () => {
    const api = {
      getAllShapes: () => [{ id: 'gone', name: 'X' }],
      getShapeById: () => null,
    };
    const r = await listDrawings(drawingsDeps(api));
    assert.deepEqual(r.shapes, [{ id: 'gone', name: 'X', price: null, title: '' }]);
  });

  it('unwraps WatchedValue-shaped titles, never emitting [object Object]', async () => {
    const api = {
      getAllShapes: () => [
        { id: 'data', name: 'A' },
        { id: 'method', name: 'B' },
        { id: 'opaque', name: 'C' },
      ],
      getShapeById: (id) => ({
        getPoints: () => [{ price: 1, time: 2 }],
        lineDataSource: () => ({
          properties: () => ({
            title: id === 'data' ? { _value: 'data title' }
              : id === 'method' ? { value: () => 'method title' }
              : { nested: { deep: true } },
          }),
        }),
      }),
    };
    const r = await listDrawings(drawingsDeps(api));
    assert.deepEqual(r.shapes.map((s) => s.title), ['data title', 'method title', '']);
  });
});
// ---------------------------------------------------------------------------
// watchlist locale-independent anchor (page JS executed in vm against fakes)
// ---------------------------------------------------------------------------

function fakeWlButton() {
  return {
    getAttribute: () => null,
    classList: { toString: () => '' },
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 10, height: 10 }),
    dispatchEvent: () => {},
    offsetParent: {},
  };
}

function wlAddDeps(anchors) {
  const btn = fakeWlButton();
  const available = [...anchors, 'add-symbol-button'];
  const document = {
    querySelector: (sel) => (available.some((a) => String(sel).includes(a)) ? btn : null),
    querySelectorAll: () => [{}], // dropdown always has a match
  };
  const sandbox = {
    document,
    window: {},
    MouseEvent: function () {},
  };
  vm.createContext(sandbox);
  const evaluate = async (expr) => {
    if (expr.includes('add-symbol-button') || expr.includes('Add symbol')) {
      return { found: true, selector: '[data-name="add-symbol-button"]' };
    }
    if (expr.includes('symbol-search')) return { count: 1 };
    return vm.runInContext(expr, sandbox); // panel-open expression
  };
  const client = {
    Input: {
      insertText: async () => {},
      dispatchKeyEvent: async () => {},
    },
  };
  return { _deps: { evaluate, getClient: async () => client } };
}

describe('watchlist — locale-independent toolbar anchor', () => {
  it('opens the panel via right-toolbar/base with legacy anchors absent', async () => {
    const r = await watchlistAdd({ symbol: 'NASDAQ:AAPL', ...wlAddDeps(['right-toolbar']) });
    assert.equal(r.success, true);
    assert.equal(r.symbol, 'NASDAQ:AAPL');
  });

  it('falls back to the legacy data-name anchor', async () => {
    const r = await watchlistAdd({ symbol: 'NASDAQ:AAPL', ...wlAddDeps(['base-watchlist-widget-button']) });
    assert.equal(r.success, true);
  });

  it('throws when no anchor matches', async () => {
    await assert.rejects(
      watchlistAdd({ symbol: 'NASDAQ:AAPL', ...wlAddDeps([]) }),
      /Watchlist button not found/,
    );
  });
});

// ---------------------------------------------------------------------------
// ui.js openPanel watchlist mirror
// ---------------------------------------------------------------------------

describe('openPanel — watchlist toolbar anchor mirror', () => {
  function panelDeps(anchors) {
    const clicked = [];
    const btn = {
      click: () => clicked.push(true),
      getAttribute: () => null,
      classList: { contains: () => false, toString: () => '' },
    };
    const available = [...anchors];
    const document = {
      querySelector: (sel) => {
        if (String(sel).includes('layout__area--right')) return { offsetWidth: 0 };
        return available.some((a) => String(sel).includes(a)) ? btn : null;
      },
    };
    const sandbox = { document, window: {} };
    vm.createContext(sandbox);
    return { _deps: { evaluate: async (expr) => vm.runInContext(expr, sandbox) }, clicked };
  }

  it('opens via the toolbar anchor with legacy anchors absent', async () => {
    const { _deps } = panelDeps(['right-toolbar']);
    const r = await openPanel({ panel: 'watchlist', action: 'open', _deps });
    assert.equal(r.success, true);
    assert.equal(r.performed, 'opened');
  });

  it('throws when no anchor matches', async () => {
    const { _deps } = panelDeps([]);
    await assert.rejects(
      openPanel({ panel: 'watchlist', action: 'open', _deps }),
      /Button not found for panel: watchlist/,
    );
  });
});
