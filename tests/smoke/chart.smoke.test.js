/**
 * Smoke tests — src/core/chart.js.
 */
import { describe, it, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { installCdpMocks, resetCdpMocks, cleanupConnection } from '../helpers/mock-cdp.js';
import * as chart from '../../src/core/chart.js';

describe('core/chart.js — setSymbol verification (post-call retry)', () => {
  afterEach(() => resetCdpMocks());
  after(cleanupConnection);

  it('test_setSymbol_throws_when_change_silently_failed', async () => {
    // Simulate TV in a stuck state: setSymbol's IIFE returns OK but the
    // actual symbol stays the same (reproducer for the cascading-failures
    // scenario from saved replay state). The wrapper detects this, retries
    // once after dismissing dialogs, then throws with SYMBOL_DID_NOT_CHANGE.
    let dismissedCalls = 0;
    installCdpMocks({
      evaluate: async (expr) => {
        if (typeof expr === 'string' && /\.symbol\(\)/.test(expr) && !expr.includes('setSymbol')) {
          return 'CME_MINI:ESM2026'; // stuck — never changes
        }
        return undefined;
      },
      evaluateAsync: async () => undefined,
    });
    await assert.rejects(
      chart.setSymbol({
        symbol: 'NASDAQ:AAPL',
        _deps: {
          waitForChartReady: async () => true,
          waitForStudiesReady: async () => true,
          dismissBlockingDialogs: async () => { dismissedCalls++; return [{ note: 'leave_replay', button: 'Leave' }]; },
        },
      }),
      (err) => {
        assert.equal(err.code, 'SYMBOL_DID_NOT_CHANGE');
        assert.equal(err.requested, 'NASDAQ:AAPL');
        assert.equal(err.actual, 'CME_MINI:ESM2026');
        assert.deepEqual(err.dismissed_dialogs, [{ note: 'leave_replay', button: 'Leave' }]);
        return true;
      },
    );
    assert.equal(dismissedCalls, 1, 'dismissBlockingDialogs invoked exactly once on retry');
  });

  it('test_setSymbol_succeeds_when_actual_matches_after_normalize', async () => {
    // TV resolves 'AAPL' to 'NASDAQ:AAPL' or 'BATS:AAPL'; the verify check
    // strips the exchange prefix before comparing.
    installCdpMocks({
      evaluate: async (expr) => {
        if (typeof expr === 'string' && /\.symbol\(\)/.test(expr) && !expr.includes('setSymbol')) {
          return 'BATS:AAPL';
        }
        return undefined;
      },
      evaluateAsync: async () => undefined,
    });
    const r = await chart.setSymbol({
      symbol: 'AAPL',
      _deps: {
        waitForChartReady: async () => true,
        waitForStudiesReady: async () => true,
        dismissBlockingDialogs: async () => [],
      },
    });
    assert.equal(r.success, true);
    assert.equal(r.symbol, 'BATS:AAPL');
    assert.equal(r.requested, 'AAPL');
  });

  it('test_setSymbol_succeeds_after_retry_dismissing_dialog', async () => {
    // First .symbol() check returns the old symbol (TV stuck on a dialog).
    // Dialog dismissed → retry sets the symbol → second .symbol() returns
    // the new value. The retry path takes the wrapper to success.
    let symbolCalls = 0;
    let dismissedCalls = 0;
    installCdpMocks({
      evaluate: async (expr) => {
        if (typeof expr === 'string' && /\.symbol\(\)/.test(expr) && !expr.includes('setSymbol')) {
          symbolCalls++;
          if (symbolCalls === 1) return 'CME_MINI:ESM2026';  // before retry: stuck
          return 'NASDAQ:AAPL';                              // after retry: changed
        }
        return undefined;
      },
      evaluateAsync: async () => undefined,
    });
    const r = await chart.setSymbol({
      symbol: 'NASDAQ:AAPL',
      _deps: {
        waitForChartReady: async () => true,
        waitForStudiesReady: async () => true,
        dismissBlockingDialogs: async () => { dismissedCalls++; return [{ note: 'leave_replay', button: 'Leave' }]; },
      },
    });
    assert.equal(r.success, true);
    assert.equal(r.symbol, 'NASDAQ:AAPL');
    assert.deepEqual(r.dismissed_dialogs, [{ note: 'leave_replay', button: 'Leave' }]);
    assert.equal(dismissedCalls, 1);
  });
});

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
      evaluate: async (expr) => {
        // setSymbol's verification reads .symbol() — echo back so the check passes
        if (typeof expr === 'string' && /\.symbol\(\)/.test(expr) && !expr.includes('setSymbol')) {
          return 'NVDA';
        }
        return undefined;
      },
      evaluateAsync: async () => undefined,
      waitForChartReady: async () => true,
      waitForStudiesReady: async () => true,
      dismissBlockingDialogs: async () => [],
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
