/**
 * Smoke tests — src/core/data.js.
 * Pure helpers (summarizeBars, processPine*, clampBarCount, etc.) are
 * already unit-tested. These cover the async CDP-dependent exports.
 */
import { describe, it, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { installCdpMocks, resetCdpMocks, cleanupConnection } from '../helpers/mock-cdp.js';
import * as data from '../../src/core/data.js';

const SAMPLE_BARS = [
  { time: 1, open: 100, high: 105, low: 99,  close: 104, volume: 1000 },
  { time: 2, open: 104, high: 110, low: 103, close: 108, volume: 1500 },
  { time: 3, open: 108, high: 112, low: 107, close: 111, volume: 2000 },
];

describe('core/data.js — smoke', () => {
  afterEach(() => resetCdpMocks());
  after(cleanupConnection);

  it('test_getOhlcv_smoke_default', async () => {
    installCdpMocks({
      evaluate: async () => ({ bars: SAMPLE_BARS, total_bars: 500, source: 'direct_bars' }),
    });
    const r = await data.getOhlcv({ count: 3 });
    assert.equal(r.success, true);
    assert.equal(r.bar_count, 3);
    assert.equal(r.source, 'direct_bars');
    assert.equal(r.bars.length, 3);
  });

  it('test_getOhlcv_smoke_summary', async () => {
    installCdpMocks({
      evaluate: async () => ({ bars: SAMPLE_BARS, total_bars: 500, source: 'direct_bars' }),
    });
    const r = await data.getOhlcv({ summary: true });
    assert.equal(r.success, true);
    assert.equal(r.high, 112);
    assert.equal(r.low, 99);
    assert.ok(r.change_pct.endsWith('%'));
  });

  it('test_getOhlcv_smoke_emptyBars', async () => {
    installCdpMocks({ evaluate: async () => null });
    await assert.rejects(data.getOhlcv(), /Could not extract OHLCV/);
  });

  it('test_getIndicator_smoke', async () => {
    installCdpMocks({
      evaluate: async () => ({ visible: true, inputs: [{ id: 'length', value: 14 }] }),
    });
    const r = await data.getIndicator({ entity_id: 'st-1' });
    assert.equal(r.success, true);
    assert.equal(r.entity_id, 'st-1');
    assert.equal(r.inputs[0].id, 'length');
  });

  it('test_getIndicator_smoke_notFound', async () => {
    installCdpMocks({ evaluate: async () => ({ error: 'Study not found: st-99' }) });
    await assert.rejects(data.getIndicator({ entity_id: 'st-99' }), /not found/);
  });

  it('test_getStrategyResults_smoke', async () => {
    installCdpMocks({
      evaluate: async () => ({ metrics: { netProfit: 1234, winRate: 0.55 }, source: 'internal_api' }),
    });
    const r = await data.getStrategyResults();
    assert.equal(r.success, true);
    assert.equal(r.metric_count, 2);
    assert.equal(r.metrics.netProfit, 1234);
  });

  it('test_getTrades_smoke', async () => {
    installCdpMocks({
      evaluate: async () => ({
        trades: [{ entry_time: 1, exit_time: 2, profit: 50 }],
        source: 'internal_api',
      }),
    });
    const r = await data.getTrades({ max_trades: 10 });
    assert.equal(r.success, true);
    assert.equal(r.trade_count, 1);
  });

  it('test_getEquity_smoke', async () => {
    installCdpMocks({
      evaluate: async () => ({
        data: [{ time: 1, equity: 10000, drawdown: 0 }, { time: 2, equity: 10500, drawdown: -50 }],
        source: 'internal_api',
      }),
    });
    const r = await data.getEquity();
    assert.equal(r.success, true);
    assert.equal(r.data_points, 2);
  });

  it('test_getQuote_smoke', async () => {
    installCdpMocks({
      evaluate: async () => ({ symbol: 'AAPL', time: 1, open: 189, high: 191, low: 188.5, close: 190, last: 190, volume: 100000 }),
    });
    const r = await data.getQuote({});
    assert.equal(r.success, true);
    assert.equal(r.symbol, 'AAPL');
    assert.equal(r.last, 190);
  });

  it('test_getQuote_smoke_emptyFails', async () => {
    installCdpMocks({ evaluate: async () => ({ symbol: 'AAPL' }) }); // no last/close
    await assert.rejects(data.getQuote({}), /Could not retrieve quote/);
  });

  it('test_getQuote_smoke_skipsSwitchWhenSymbolMatches', async () => {
    // Chart already on NVDA; bare-ticker comparison should skip the route
    // entirely and read in place via active_chart path.
    installCdpMocks({
      evaluate: async (expr) => {
        if (typeof expr === 'string' && /\.symbol\(\)\s*$/.test(expr)) return 'NASDAQ:NVDA';
        return { symbol: 'NASDAQ:NVDA', last: 500, close: 500 };
      },
    });
    let switchCount = 0;
    let scannerCount = 0;
    const r = await data.getQuote({
      symbol: 'NVDA',
      _deps: {
        setSymbol: async () => { switchCount++; },
        evaluateAsync: async () => { scannerCount++; return { ok: true, status: 200, json: { data: [] } }; },
      },
    });
    assert.equal(r.success, true);
    assert.equal(r.source, 'active_chart');
    assert.equal(switchCount, 0);
    assert.equal(scannerCount, 0);
  });

  it('test_getQuote_smoke_routeAuto_usesScannerForCrossSymbol', async () => {
    // Chart on TSLA, ask for NVDA. Default route is 'auto' — scanner first.
    let scannerCalls = 0;
    let switchCalls = 0;
    installCdpMocks({
      evaluate: async (expr) => {
        if (typeof expr === 'string' && /\.symbol\(\)\s*$/.test(expr)) return 'NASDAQ:TSLA';
        return null;
      },
    });
    const r = await data.getQuote({
      symbol: 'NVDA',
      _deps: {
        setSymbol: async () => { switchCalls++; },
        evaluateAsync: async () => {
          scannerCalls++;
          return {
            ok: true, status: 200,
            json: { data: [{ s: 'NASDAQ:NVDA', d: [500, 495, 510, 490, 1000000, 'NVIDIA Corp', 'NASDAQ', 'stock'] }] },
          };
        },
      },
    });
    assert.equal(r.success, true);
    assert.equal(r.source, 'scanner_rest');
    assert.equal(r.symbol, 'NASDAQ:NVDA');
    assert.equal(r.last, 500);
    assert.equal(r.close, 500);
    assert.equal(r.exchange, 'NASDAQ');
    assert.equal(scannerCalls, 1);
    assert.equal(switchCalls, 0, 'no chart switch when scanner succeeds');
  });

  it('test_getQuote_smoke_routeAuto_fallsBackToChartSwitchOnScannerEmpty', async () => {
    // Scanner returns no data (e.g., crypto symbol). Auto should fall back.
    installCdpMocks({
      evaluate: async (expr) => {
        if (typeof expr === 'string' && /\.symbol\(\)\s*$/.test(expr)) return 'NASDAQ:TSLA';
        return { symbol: 'BINANCE:BTCUSDT', last: 50000, close: 50000 };
      },
    });
    const switchCalls = [];
    const r = await data.getQuote({
      symbol: 'BINANCE:BTCUSDT',
      _deps: {
        setSymbol: async ({ symbol }) => { switchCalls.push(symbol); },
        evaluateAsync: async () => ({ ok: true, status: 200, json: { data: [] } }),
      },
    });
    assert.equal(r.success, true);
    assert.equal(r.source, 'chart_switch');
    assert.equal(r.last, 50000);
    assert.deepEqual(switchCalls, ['BINANCE:BTCUSDT', 'NASDAQ:TSLA'], 'switched then restored');
  });

  it('test_getQuote_smoke_routeRest_throwsWhenScannerEmpty', async () => {
    // Explicit route:'rest' must NOT fall back to chart-switch.
    let switchCalls = 0;
    installCdpMocks({
      evaluate: async (expr) => {
        if (typeof expr === 'string' && /\.symbol\(\)\s*$/.test(expr)) return 'NASDAQ:TSLA';
        return null;
      },
    });
    await assert.rejects(
      data.getQuote({
        symbol: 'BINANCE:BTCUSDT',
        route: 'rest',
        _deps: {
          setSymbol: async () => { switchCalls++; },
          evaluateAsync: async () => ({ ok: true, status: 200, json: { data: [] } }),
        },
      }),
      /scanner returned no data/,
    );
    assert.equal(switchCalls, 0);
  });

  it('test_getQuote_smoke_routeChartSwitch_skipsScanner', async () => {
    let scannerCalls = 0;
    installCdpMocks({
      evaluate: async (expr) => {
        if (typeof expr === 'string' && /\.symbol\(\)\s*$/.test(expr)) return 'NASDAQ:TSLA';
        return { symbol: 'NASDAQ:NVDA', last: 500, close: 500 };
      },
    });
    const switchCalls = [];
    const r = await data.getQuote({
      symbol: 'NVDA',
      route: 'chart_switch',
      _deps: {
        setSymbol: async ({ symbol }) => { switchCalls.push(symbol); },
        evaluateAsync: async () => { scannerCalls++; return { ok: true, status: 200, json: { data: [] } }; },
      },
    });
    assert.equal(r.success, true);
    assert.equal(r.source, 'chart_switch');
    assert.equal(scannerCalls, 0);
    assert.deepEqual(switchCalls, ['NVDA', 'NASDAQ:TSLA']);
  });

  it('test_getQuote_smoke_chartSwitch_restoresOnFailure', async () => {
    // Read fails after the switch — original symbol must still be restored.
    installCdpMocks({
      evaluate: async (expr) => {
        if (typeof expr === 'string' && /\.symbol\(\)\s*$/.test(expr)) return 'NASDAQ:TSLA';
        return { symbol: 'NASDAQ:NVDA' }; // no last/close → throws
      },
    });
    const switchCalls = [];
    await assert.rejects(
      data.getQuote({
        symbol: 'NVDA',
        route: 'chart_switch',
        _deps: {
          setSymbol: async ({ symbol }) => { switchCalls.push(symbol); },
          evaluateAsync: async () => ({ ok: true, status: 200, json: { data: [] } }),
        },
      }),
      /Could not retrieve quote/,
    );
    assert.deepEqual(switchCalls, ['NVDA', 'NASDAQ:TSLA']);
  });

  it('test_getQuote_smoke_scannerHttpErrorSurfaces', async () => {
    installCdpMocks({
      evaluate: async (expr) => {
        if (typeof expr === 'string' && /\.symbol\(\)\s*$/.test(expr)) return 'NASDAQ:TSLA';
        return null;
      },
    });
    await assert.rejects(
      data.getQuote({
        symbol: 'NVDA',
        route: 'rest',
        _deps: {
          setSymbol: async () => {},
          evaluateAsync: async () => ({ ok: false, status: 503, body: 'service unavailable' }),
        },
      }),
      /scanner HTTP 503/,
    );
  });

  it('test_getDepth_smoke', async () => {
    installCdpMocks({
      evaluate: async () => ({
        found: true,
        bids: [{ price: 189.9, size: 100 }],
        asks: [{ price: 190.1, size: 100 }],
        spread: 0.2,
      }),
    });
    const r = await data.getDepth();
    assert.equal(r.success, true);
    assert.equal(r.bid_levels, 1);
    assert.equal(r.ask_levels, 1);
    assert.equal(r.spread, 0.2);
  });

  it('test_getStudyValues_smoke', async () => {
    installCdpMocks({
      evaluate: async () => [
        { name: 'RSI', values: { RSI: 65.4 } },
        { name: 'MACD', values: { MACD: 0.5, Signal: 0.3 } },
      ],
    });
    const r = await data.getStudyValues();
    assert.equal(r.success, true);
    assert.equal(r.study_count, 2);
  });

  it('test_getPineLines_smoke', async () => {
    installCdpMocks({
      evaluate: async () => [{
        name: 'Profiler', count: 2, items: [
          { id: 'l1', raw: { y1: 100, y2: 100, x1: 1, x2: 2 } },
          { id: 'l2', raw: { y1: 90, y2: 90, x1: 1, x2: 2 } },
        ],
      }],
    });
    const r = await data.getPineLines({ study_filter: 'Profiler' });
    assert.equal(r.success, true);
    assert.equal(r.studies[0].horizontal_levels.length, 2);
  });

  it('test_getPineLabels_smoke', async () => {
    installCdpMocks({
      evaluate: async () => [{
        name: 'Levels', count: 1, items: [{ id: 'lb1', raw: { t: 'PDH', y: 190.5 } }],
      }],
    });
    const r = await data.getPineLabels({});
    assert.equal(r.success, true);
    assert.equal(r.studies[0].labels[0].text, 'PDH');
  });

  it('test_getPineLabels_smoke_signalPriceAndBar', async () => {
    // Items decorated by buildGraphicsJS expose bar_time + bar_ohlcv. Format
    // surfaces signal_price (= ohlcv.close) + bar object.
    installCdpMocks({
      evaluate: async () => [{
        name: 'Signals', count: 1, items: [{
          id: 'lb1',
          raw: { t: 'BUY', y: 195.55 }, // visual offset above candle
          bar_time: 1735776000,
          bar_ohlcv: { time: 1735776000, open: 190.1, high: 191.2, low: 189.3, close: 190.8, volume: 12345 },
        }],
      }],
    });
    const r = await data.getPineLabels({});
    assert.equal(r.success, true);
    const lbl = r.studies[0].labels[0];
    assert.equal(lbl.text, 'BUY');
    assert.equal(lbl.price, 195.55);
    assert.equal(lbl.signal_price, 190.8);
    assert.deepEqual(lbl.bar, { open: 190.1, high: 191.2, low: 189.3, close: 190.8, volume: 12345 });
    assert.equal(lbl.bar_time, 1735776000);
  });

  it('test_getPineLabels_smoke_sinceUntilFilters', async () => {
    installCdpMocks({
      evaluate: async () => [{
        name: 'Signals', count: 3, items: [
          { id: 'a', raw: { t: 'A', y: 1 }, bar_time: 1700000000, bar_ohlcv: null },
          { id: 'b', raw: { t: 'B', y: 2 }, bar_time: 1700001000, bar_ohlcv: null },
          { id: 'c', raw: { t: 'C', y: 3 }, bar_time: 1700002000, bar_ohlcv: null },
        ],
      }],
    });
    // ISO date strings normalize to unix seconds via Date.parse.
    const r = await data.getPineLabels({ since: 1700000500, until: 1700001500 });
    assert.equal(r.success, true);
    assert.equal(r.studies[0].labels.length, 1);
    assert.equal(r.studies[0].labels[0].text, 'B');
  });

  it('test_getPineLabels_smoke_isoDateSinceFilter', async () => {
    installCdpMocks({
      evaluate: async () => [{
        name: 'S', count: 2, items: [
          { id: 'a', raw: { t: 'OLD', y: 1 }, bar_time: 1577836800 /* 2020-01-01 */, bar_ohlcv: null },
          { id: 'b', raw: { t: 'NEW', y: 2 }, bar_time: 1735689600 /* 2025-01-01 */, bar_ohlcv: null },
        ],
      }],
    });
    const r = await data.getPineLabels({ since: '2024-01-01' });
    assert.equal(r.studies[0].labels.length, 1);
    assert.equal(r.studies[0].labels[0].text, 'NEW');
  });

  it('test_getPineLabels_smoke_handlesNullBarTime', async () => {
    // Studies whose primitives have no resolvable bar idx (sentinel _indexes
    // entries) decorate to bar_time=null. since/until filters drop those.
    installCdpMocks({
      evaluate: async () => [{
        name: 'S', count: 2, items: [
          { id: 'a', raw: { t: 'TIMED', y: 1 }, bar_time: 1700000000, bar_ohlcv: null },
          { id: 'b', raw: { t: 'UNRESOLVED', y: 2 }, bar_time: null, bar_ohlcv: null },
        ],
      }],
    });
    const noFilter = await data.getPineLabels({});
    assert.equal(noFilter.studies[0].labels.length, 2, 'both labels included without filter');
    const withFilter = await data.getPineLabels({ since: 1699999000 });
    assert.equal(withFilter.studies[0].labels.length, 1, 'unresolved bar_time dropped by filter');
    assert.equal(withFilter.studies[0].labels[0].text, 'TIMED');
  });

  it('test_getPineTables_smoke', async () => {
    installCdpMocks({
      evaluate: async () => [{
        name: 'Stats', count: 2, items: [
          { id: 'c1', raw: { tid: 0, row: 0, col: 0, t: 'A' } },
          { id: 'c2', raw: { tid: 0, row: 0, col: 1, t: 'B' } },
        ],
      }],
    });
    const r = await data.getPineTables({});
    assert.equal(r.success, true);
    assert.equal(r.studies[0].tables[0].rows[0], 'A | B');
  });

  it('test_getPineBoxes_smoke', async () => {
    installCdpMocks({
      evaluate: async () => [{
        name: 'Zones', count: 1, items: [{ id: 'b1', raw: { y1: 100, y2: 110 } }],
      }],
    });
    const r = await data.getPineBoxes({});
    assert.equal(r.success, true);
    assert.deepEqual(r.studies[0].zones[0], { high: 110, low: 100 });
  });

  // ── B.12 getPineShapes ──────────────────────────────────────────────
  it('test_getPineShapes_smoke', async () => {
    installCdpMocks({
      evaluate: async () => [{
        name: 'Buy/Sell signals',
        shapePlots: [{ plotIndex: 0, dataIndex: 1, id: 'p0', title: 'Long', shape: 'triangleup', location: 'BelowBar', color: '#0f0', size: 'auto' }],
        signals: [
          { plot: 'Long', shape: 'triangleup', location: 'BelowBar', color: '#0f0', barIndex: 100, value: 1, ohlc: { time: '2026-01-01T00:00:00Z', timestamp: 1735689600, open: 50, high: 51, low: 49, close: 50.5 } },
        ],
        signalCount: 1,
        barsScanned: 50,
      }],
    });
    const r = await data.getPineShapes({ study_filter: 'signals', last_n_bars: 50 });
    assert.equal(r.success, true);
    assert.equal(r.study_count, 1);
    assert.equal(r.studies[0].name, 'Buy/Sell signals');
    assert.equal(r.studies[0].signal_count, 1);
    assert.equal(r.studies[0].signals[0].shape, 'triangleup');
    assert.equal(r.studies[0].signals[0].ohlc.close, 50.5);
  });

  it('test_getPineShapes_smoke_empty', async () => {
    installCdpMocks({ evaluate: async () => [] });
    const r = await data.getPineShapes({});
    assert.equal(r.success, true);
    assert.equal(r.study_count, 0);
    assert.deepEqual(r.studies, []);
  });

  it('test_getPineShapes_smoke_caps_last_n_bars', async () => {
    // last_n_bars > 500 should be capped at 500 in the JS we send to TV.
    let captured = null;
    installCdpMocks({
      evaluate: async (expr) => { captured = expr; return []; },
    });
    await data.getPineShapes({ last_n_bars: 9999 });
    assert.ok(captured.includes('var maxBars = 500;'), 'last_n_bars capped at 500');
  });

  // ── B.20 study_filter on getStudyValues ──────────────────────────────
  it('test_getStudyValues_smoke_with_study_filter', async () => {
    let captured = null;
    installCdpMocks({
      evaluate: async (expr) => {
        captured = expr;
        return [{ name: 'RSI (14)', values: { 'RSI': 50 } }];
      },
    });
    const r = await data.getStudyValues({ study_filter: 'RSI' });
    assert.equal(r.success, true);
    assert.ok(captured.includes('"RSI"'), 'study_filter passed via safeString into evaluate');
  });

  // ── B.18 batchReadPanes ─────────────────────────────────────────────
  it('test_batchReadPanes_smoke_throws_without_reads', async () => {
    await assert.rejects(
      data.batchReadPanes({}),
      /reads.*is required/i,
    );
  });

  it('test_batchReadPanes_smoke_basic', async () => {
    installCdpMocks({
      evaluate: async () => ({
        layout: 's',
        pane_count: 1,
        panes: [{
          index: 0,
          symbol: 'AAPL',
          resolution: '5',
          ohlcv_summary: { bar_count: 5, period: { from: 1, to: 2 }, open: 100, close: 105, high: 110, low: 95 },
          study_values: [{ name: 'RSI', values: { RSI: 55 } }],
        }],
      }),
    });
    const r = await data.batchReadPanes({
      reads: { study_values: true, ohlcv_summary: { bars: 5 } },
    });
    assert.equal(r.success, true);
    assert.equal(r.layout, 's');
    assert.equal(r.pane_count, 1);
    assert.equal(r.requested, 1);
    assert.equal(r.panes[0].symbol, 'AAPL');
    assert.equal(r.panes[0].ohlcv_summary.bar_count, 5);
  });

  it('test_batchReadPanes_smoke_pine_lines_format_passthrough', async () => {
    // Verify format helpers convert raw items to deduplicated horizontal_levels.
    installCdpMocks({
      evaluate: async () => ({
        layout: '2h',
        pane_count: 2,
        panes: [{
          index: 0,
          symbol: 'AAPL',
          resolution: 'D',
          pine_lines: [{
            name: 'Levels',
            count: 3,
            items: [
              { id: 'l1', raw: { y1: 100, y2: 100, x1: 1, x2: 2, st: 0, w: 1, ci: 'red' } },
              { id: 'l2', raw: { y1: 110, y2: 110, x1: 1, x2: 2, st: 0, w: 1, ci: 'green' } },
              { id: 'l3', raw: { y1: 100, y2: 100, x1: 3, x2: 4, st: 0, w: 1, ci: 'red' } },  // duplicate level 100
            ],
          }],
        }],
      }),
    });
    const r = await data.batchReadPanes({ reads: { pine_lines: {} } });
    assert.equal(r.success, true);
    assert.deepEqual(r.panes[0].pine_lines[0].horizontal_levels, [110, 100]);  // deduped, sorted
    assert.equal(r.panes[0].pine_lines[0].total_lines, 3);
  });

  it('test_batchReadPanes_smoke_caps_wait_ms', async () => {
    let evaluateCalled = false;
    installCdpMocks({
      evaluate: async () => {
        evaluateCalled = true;
        return { layout: 's', pane_count: 1, panes: [] };
      },
    });
    const start = Date.now();
    await data.batchReadPanes({ reads: { study_values: true }, wait_ms: 100 });
    const elapsed = Date.now() - start;
    assert.ok(evaluateCalled);
    assert.ok(elapsed >= 100, `waited at least 100ms (got ${elapsed}ms)`);
    // Cap test would require waiting 5s+, skipping for fast suite.
  });

  // Regression: batchReadPanes' readGraphics must unwrap WatchableValue with
  // inner.get(false)._primitivesDataById, matching single-pane buildGraphicsJS.
  // Earlier code dropped the .get(false) step so readGraphics returned [].
  it('test_batchReadPanes_smoke_unwrap_path_in_expression', async () => {
    let captured = '';
    installCdpMocks({
      evaluate: async (expr) => {
        captured = String(expr);
        return { layout: 's', pane_count: 1, panes: [] };
      },
    });
    await data.batchReadPanes({ reads: { pine_lines: {} } });
    assert.match(captured, /inner\.get\(false\)/);
    assert.match(captured, /coll\._primitivesDataById/);
  });

  // Regression: buildGraphicsJS pushes a per-study item cap into the IIFE so
  // huge label sets aren't shipped over CDP just to be sliced server-side.
  it('test_getPineLabels_smoke_passes_cap_into_iife', async () => {
    let captured = '';
    installCdpMocks({
      evaluate: async (expr) => {
        captured = String(expr);
        return [];
      },
    });
    await data.getPineLabels({ max_labels: 17 });
    assert.match(captured, /var maxItems = 17/);
    assert.match(captured, /items\.slice\(-maxItems\)/);
  });
});
