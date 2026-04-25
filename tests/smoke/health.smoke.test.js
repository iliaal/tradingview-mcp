/**
 * Smoke tests — src/core/health.js (launch flagged for real test, not smoke).
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installCdpMocks, resetCdpMocks, fakeCdpClient } from '../helpers/mock-cdp.js';
import * as health from '../../src/core/health.js';

describe('core/health.js — smoke', () => {
  afterEach(() => resetCdpMocks());

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
});
