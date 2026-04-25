/**
 * Smoke tests — src/wait.js::waitForChartReady.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installCdpMocks, resetCdpMocks } from '../helpers/mock-cdp.js';
import { waitForChartReady } from '../../src/wait.js';

describe('wait.js — smoke', () => {
  afterEach(() => resetCdpMocks());

  it('test_waitForChartReady_smoke_ready', async () => {
    // Stable state (not loading, bar count > 0, unchanged across polls) → true
    installCdpMocks({
      evaluate: async () => ({ isLoading: false, barCount: 50, currentSymbol: 'AAPL' }),
    });
    assert.equal(await waitForChartReady('AAPL', null, 2000), true);
  });

  it('test_waitForChartReady_smoke_timeout', async () => {
    // Always loading → timeout → false
    installCdpMocks({
      evaluate: async () => ({ isLoading: true, barCount: 0, currentSymbol: '' }),
    });
    assert.equal(await waitForChartReady(null, null, 400), false);
  });

  it('test_waitForChartReady_smoke_symbolMismatch', async () => {
    // Symbol never matches → timeout → false
    installCdpMocks({
      evaluate: async () => ({ isLoading: false, barCount: 100, currentSymbol: 'MSFT' }),
    });
    assert.equal(await waitForChartReady('AAPL', null, 400), false);
  });
});
