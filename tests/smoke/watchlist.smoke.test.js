/**
 * Smoke tests — src/core/watchlist.js.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installCdpMocks, resetCdpMocks, fakeCdpClient } from '../helpers/mock-cdp.js';
import * as watchlist from '../../src/core/watchlist.js';

describe('core/watchlist.js — smoke', () => {
  afterEach(() => resetCdpMocks());

  it('test_get_smoke', async () => {
    installCdpMocks({
      evaluate: async () => ({
        symbols: [
          { symbol: 'AAPL', last: '190.00', change: '+1.2', change_percent: '+0.6%' },
          { symbol: 'MSFT', last: '400.00', change: '-0.5', change_percent: '-0.1%' },
        ],
        source: 'data_attributes',
      }),
    });
    const r = await watchlist.get();
    assert.equal(r.success, true);
    assert.equal(r.count, 2);
    assert.equal(r.source, 'data_attributes');
    assert.equal(r.symbols[0].symbol, 'AAPL');
  });

  it('test_add_smoke', async () => {
    let call = 0;
    installCdpMocks({
      getClient: async () => fakeCdpClient(),
      // First evaluate → panel state; second → addClicked
      evaluate: async () => (++call === 1 ? { opened: true } : { found: true, selector: 'add-btn' }),
    });
    const r = await watchlist.add({ symbol: 'NVDA' });
    assert.equal(r.success, true);
    assert.equal(r.symbol, 'NVDA');
    assert.equal(r.action, 'added');
  });
});
