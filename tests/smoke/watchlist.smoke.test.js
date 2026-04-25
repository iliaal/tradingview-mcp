/**
 * Smoke tests — src/core/watchlist.js.
 */
import { describe, it, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { installCdpMocks, resetCdpMocks, cleanupConnection, fakeCdpClient } from '../helpers/mock-cdp.js';
import * as watchlist from '../../src/core/watchlist.js';

describe('core/watchlist.js — smoke', () => {
  afterEach(() => resetCdpMocks());
  after(cleanupConnection);

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

  // ── B.15 remove ─────────────────────────────────────────────────────
  it('test_remove_smoke_throws_when_no_panel', async () => {
    // remove() reads the active watchlist's React fiber state; with no panel
    // open, listInfo is null and we throw a clear error.
    installCdpMocks({
      getClient: async () => fakeCdpClient(),
      evaluate: async () => null,
    });
    await assert.rejects(
      watchlist.remove({ symbols: ['AAPL'] }),
      /watchlist panel|Cannot read/i,
    );
  });

  it('test_remove_smoke_skips_unknown_symbols', async () => {
    // listInfo returns AAPL only; we ask to remove TSLA → all skipped, no
    // CDP fetch needed (skipped without round-trip is the early return).
    installCdpMocks({
      getClient: async () => fakeCdpClient(),
      evaluate: async () => ({
        id: 'list-1', name: 'Default', symbols: ['NASDAQ:AAPL'],
      }),
    });
    const r = await watchlist.remove({ symbols: ['TSLA'] });
    assert.equal(r.success, true);
    assert.deepEqual(r.removed, []);
    assert.deepEqual(r.skipped, ['TSLA']);
  });

  // ── B.15 addBulk ───────────────────────────────────────────────────
  it('test_addBulk_smoke_throws_when_add_button_missing', async () => {
    // addBulk: ensures panel open (no-op if missing button), then clicks
    // the "Add symbol" button. We mock evaluate to return found:false
    // for the second call so the Add-button-missing branch fires.
    let call = 0;
    installCdpMocks({
      getClient: async () => fakeCdpClient(),
      evaluate: async () => {
        call++;
        if (call === 1) return undefined;          // panel-open IIFE returns nothing
        return { found: false };                   // add-button missing
      },
    });
    await assert.rejects(
      watchlist.addBulk({ symbols: ['AAPL', 'MSFT'] }),
      /Add symbol button not found/,
    );
  });
});
