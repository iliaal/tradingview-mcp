/**
 * Smoke tests — src/core/chart.js.
 */
import { describe, it, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { installCdpMocks, resetCdpMocks, cleanupConnection } from '../helpers/mock-cdp.js';
import * as chart from '../../src/core/chart.js';

describe('core/chart.js — smoke', () => {
  afterEach(() => resetCdpMocks());
  after(cleanupConnection);

  it('test_getState_smoke', async () => {
    installCdpMocks({
      evaluate: async () => ({ symbol: 'AAPL', resolution: 'D', chartType: 1, studies: [] }),
    });
    const r = await chart.getState();
    assert.equal(r.success, true);
    assert.equal(r.symbol, 'AAPL');
  });

  it('test_setSymbol_smoke', async () => {
    const deps = {
      evaluateAsync: async () => undefined,
      waitForChartReady: async () => true,
    };
    const r = await chart.setSymbol({ symbol: 'NVDA', _deps: deps });
    assert.equal(r.success, true);
    assert.equal(r.symbol, 'NVDA');
    assert.equal(r.chart_ready, true);
  });

  it('test_setTimeframe_smoke', async () => {
    const deps = {
      evaluate: async () => undefined,
      waitForChartReady: async () => true,
    };
    const r = await chart.setTimeframe({ timeframe: '5', _deps: deps });
    assert.equal(r.success, true);
    assert.equal(r.timeframe, '5');
  });

  it('test_setType_smoke_byName', async () => {
    const r = await chart.setType({ chart_type: 'Candles', _deps: { evaluate: async () => undefined } });
    assert.equal(r.success, true);
    assert.equal(r.type_num, 1);
  });

  it('test_setType_smoke_byNumber', async () => {
    const r = await chart.setType({ chart_type: '8', _deps: { evaluate: async () => undefined } });
    assert.equal(r.type_num, 8);
  });

  it('test_setType_smoke_invalid', async () => {
    await assert.rejects(
      chart.setType({ chart_type: 'Unicorn', _deps: { evaluate: async () => undefined } }),
      /Unknown chart type/,
    );
  });

  it('test_manageIndicator_smoke_add', async () => {
    let call = 0;
    const deps = {
      evaluate: async () => {
        call++;
        if (call === 1) return ['old-1'];      // before
        if (call === 2) return undefined;      // createStudy
        return ['old-1', 'new-42'];            // after
      },
    };
    const r = await chart.manageIndicator({ action: 'add', indicator: 'RSI', _deps: deps });
    assert.equal(r.action, 'add');
    assert.equal(r.entity_id, 'new-42');
    assert.equal(r.success, true);
  });

  it('test_manageIndicator_smoke_remove', async () => {
    const r = await chart.manageIndicator({
      action: 'remove', indicator: 'RSI', entity_id: 'old-1',
      _deps: { evaluate: async () => undefined },
    });
    assert.equal(r.success, true);
    assert.equal(r.action, 'remove');
  });

  it('test_manageIndicator_smoke_missingEntityId', async () => {
    await assert.rejects(
      chart.manageIndicator({ action: 'remove', indicator: 'RSI', _deps: { evaluate: async () => undefined } }),
      /entity_id required/,
    );
  });

  it('test_getVisibleRange_smoke', async () => {
    installCdpMocks({
      evaluate: async () => ({ visible_range: { from: 1, to: 2 }, bars_range: { from: 0, to: 100 } }),
    });
    const r = await chart.getVisibleRange();
    assert.equal(r.success, true);
    assert.equal(r.visible_range.from, 1);
  });

  it('test_setVisibleRange_smoke', async () => {
    let call = 0;
    const deps = {
      evaluate: async () => (++call === 1 ? undefined : { from: 100, to: 200 }),
    };
    const r = await chart.setVisibleRange({ from: 100, to: 200, _deps: deps });
    assert.equal(r.success, true);
    assert.equal(r.requested.from, 100);
    assert.equal(r.actual.to, 200);
  });

  it('test_scrollToDate_smoke_iso', async () => {
    installCdpMocks({ evaluate: async () => 'D' });
    const r = await chart.scrollToDate({ date: '2025-01-15' });
    assert.equal(r.success, true);
    assert.equal(r.date, '2025-01-15');
    assert.equal(r.resolution, 'D');
  });

  it('test_scrollToDate_smoke_unix', async () => {
    installCdpMocks({ evaluate: async () => '5' });
    const r = await chart.scrollToDate({ date: '1700000000' });
    assert.equal(r.centered_on, 1700000000);
  });

  it('test_scrollToDate_smoke_invalid', async () => {
    await assert.rejects(chart.scrollToDate({ date: 'not-a-date' }), /Could not parse date/);
  });

  it('test_symbolInfo_smoke', async () => {
    installCdpMocks({
      evaluate: async () => ({
        symbol: 'AAPL', exchange: 'NASDAQ', description: 'Apple Inc.',
        type: 'stock', resolution: 'D', chart_type: 1,
      }),
    });
    const r = await chart.symbolInfo();
    assert.equal(r.success, true);
    assert.equal(r.symbol, 'AAPL');
    assert.equal(r.exchange, 'NASDAQ');
  });

  it('test_symbolSearch_smoke', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ symbols: [
        { symbol: '<em>AAPL</em>', description: 'Apple', exchange: 'NASDAQ', type: 'stock' },
      ]}),
    });
    try {
      const r = await chart.symbolSearch({ query: 'AAPL' });
      assert.equal(r.success, true);
      assert.equal(r.count, 1);
      assert.equal(r.results[0].symbol, 'AAPL'); // <em> tags stripped
    } finally { globalThis.fetch = realFetch; }
  });
});
