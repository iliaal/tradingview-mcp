/**
 * Smoke tests — src/core/health.js (launch flagged for real test, not smoke).
 */
import { describe, it, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { installCdpMocks, resetCdpMocks, cleanupConnection, fakeCdpClient } from '../helpers/mock-cdp.js';
import * as health from '../../src/core/health.js';

describe('core/health.js — smoke', () => {
  afterEach(() => resetCdpMocks());
  after(cleanupConnection);

  it('test_healthCheck_smoke', async () => {
    installCdpMocks({
      getClient: async () => fakeCdpClient(),
      getTargetInfo: async () => ({ id: 'tgt-1', url: 'tv://chart', title: 'Chart' }),
      evaluate: async () => ({ url: 'tv://', title: 'Chart', symbol: 'AAPL', resolution: 'D', chartType: 1, apiAvailable: true }),
    });
    const r = await health.healthCheck();
    assert.equal(r.success, true);
    assert.equal(r.cdp_connected, true);
    assert.equal(r.target_id, 'tgt-1');
    assert.equal(r.chart_symbol, 'AAPL');
    assert.equal(r.api_available, true);
  });

  it('test_discover_smoke', async () => {
    installCdpMocks({
      evaluate: async () => ({
        chartApi: { available: true, path: 'x', methodCount: 10, methods: [] },
        chartWidgetCollection: { available: false, error: 'nope' },
        replayApi: { available: true, path: 'y' },
      }),
    });
    const r = await health.discover();
    assert.equal(r.success, true);
    assert.equal(r.apis_total, 3);
    assert.equal(r.apis_available, 2);
  });

  it('test_uiState_smoke', async () => {
    installCdpMocks({
      evaluate: async () => ({
        bottom_panel: { open: true, height: 200 },
        pine_editor: { open: true, width: 800, height: 400 },
        buttons: {},
        chart: { symbol: 'AAPL', resolution: '5', chartType: 1, study_count: 3 },
      }),
    });
    const r = await health.uiState();
    assert.equal(r.success, true);
    assert.equal(r.chart.symbol, 'AAPL');
    assert.equal(r.pine_editor.open, true);
  });

  // ── B.11 reconnect ───────────────────────────────────────────────────
  it('test_reconnect_smoke', async () => {
    let pageReloadCalled = false;
    // waitForChartReady's inline IIFE returns { isLoading, barCount, currentSymbol }.
    // Return a stable shape so the poll-stability check converges fast (2 polls × 200ms = 400ms).
    const stableShape = { isLoading: false, barCount: 100, currentSymbol: 'AAPL' };
    let callIdx = 0;
    installCdpMocks({
      getClient: async () => ({
        Page: { reload: async () => { pageReloadCalled = true; } },
        Runtime: { evaluate: async () => ({ result: { value: null } }) },
        Input: {},
        close: async () => {},
      }),
      getTargetInfo: async () => ({ id: 't', url: 'tv://', title: 'C' }),
      evaluate: async (expr) => {
        callIdx++;
        // Call 1: priorState (chart.symbol/resolution shape)
        if (callIdx === 1) return { symbol: 'AAPL', resolution: 'D' };
        // waitForChartReady polls — return stable shape so convergence is fast
        if (typeof expr === 'string' && expr.includes('isLoading')) return stableShape;
        // healthCheck inline shape
        return { symbol: 'AAPL', resolution: 'D', chartType: 1, apiAvailable: true, url: 'tv://', title: 'C' };
      },
    });
    const r = await health.reconnect();
    assert.equal(r.success, true);
    assert.equal(r.reconnected, true);
    assert.equal(r.prior_symbol, 'AAPL');
    assert.equal(pageReloadCalled, true, 'Page.reload was invoked');
  });

  // ensureCDP isn't smoke-testable: it probes http://localhost:port/json/version
  // with raw http.get (no override hook), and on probe failure falls through
  // to launch() which spawns OS processes. Coverage lives in e2e against
  // a live TV instead.
});
