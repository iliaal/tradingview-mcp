/**
 * Smoke tests — src/core/data.js.
 * Pure helpers (summarizeBars, processPine*, clampBarCount, etc.) are
 * already unit-tested. These cover the async CDP-dependent exports.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installCdpMocks, resetCdpMocks } from '../helpers/mock-cdp.js';
import * as data from '../../src/core/data.js';

const SAMPLE_BARS = [
  { time: 1, open: 100, high: 105, low: 99,  close: 104, volume: 1000 },
  { time: 2, open: 104, high: 110, low: 103, close: 108, volume: 1500 },
  { time: 3, open: 108, high: 112, low: 107, close: 111, volume: 2000 },
];

describe('core/data.js — smoke', () => {
  afterEach(() => resetCdpMocks());

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
});
