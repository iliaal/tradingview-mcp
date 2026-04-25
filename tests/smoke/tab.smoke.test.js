/**
 * Smoke tests — src/core/tab.js::list.
 * newTab/closeTab/switchTab flagged: they dispatch real keyboard events
 * and hit http://localhost:9222/json/*, which needs more than a 10-line
 * mock. They belong in a real integration test, not a smoke test.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as tab from '../../src/core/tab.js';

describe('core/tab.js — smoke', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it('test_list_smoke', async () => {
    globalThis.fetch = async () => ({
      json: async () => [
        // A TradingView chart tab (included)
        { id: 't1', type: 'page', title: 'Live stock charts on AAPL', url: 'https://www.tradingview.com/chart/abc123/' },
        // A second chart tab
        { id: 't2', type: 'page', title: 'Chart', url: 'https://www.tradingview.com/chart/xyz789/' },
        // A non-chart page (filtered out)
        { id: 't3', type: 'page', title: 'Some other page', url: 'https://example.com' },
        // A non-page target (filtered out)
        { id: 'wk1', type: 'worker', url: 'https://www.tradingview.com/chart/' },
      ],
    });
    const r = await tab.list();
    assert.equal(r.success, true);
    assert.equal(r.tab_count, 2);
    assert.equal(r.tabs[0].id, 't1');
    assert.equal(r.tabs[0].chart_id, 'abc123');
    assert.equal(r.tabs[1].chart_id, 'xyz789');
  });
});
