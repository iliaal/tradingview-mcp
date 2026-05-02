/**
 * Smoke tests — src/core/alerts.js.
 */
import { describe, it, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { installCdpMocks, resetCdpMocks, cleanupConnection } from '../helpers/mock-cdp.js';
import * as alerts from '../../src/core/alerts.js';

describe('core/alerts.js — smoke', () => {
  afterEach(() => resetCdpMocks());
  after(cleanupConnection);

  it('test_create_smoke', async () => {
    // alerts.create was rewritten in A.6 (ttnsx888 23524283). New flow:
    //   1. Alt+A keystroke via injected getClient (Input.dispatchKeyEvent)
    //   2. Poll-for-dialog evaluate (returns true once dialog visible)
    //   3. Set price evaluate (returns { ok: true, value })
    //   4. Click Create evaluate (returns true)
    let call = 0;
    installCdpMocks({
      getClient: async () => ({
        Input: { dispatchKeyEvent: async () => {} },
      }),
      evaluate: async () => {
        call++;
        if (call === 1) return true;                            // dialog visible
        if (call === 2) return { ok: true, value: '190.5' };    // priceSet
        return true;                                             // Create clicked
      },
    });
    const r = await alerts.create({ condition: 'crossing', price: 190.5 });
    assert.equal(r.success, true);
    assert.equal(r.price, 190.5);
    assert.equal(r.condition, 'crossing');
    assert.equal(r.price_set, true);
  });

  it('test_list_smoke', async () => {
    installCdpMocks({
      evaluateAsync: async () => ({
        alerts: [
          { alert_id: 1, symbol: 'AAPL', price: 190, type: 'price', active: true },
          { alert_id: 2, symbol: 'MSFT', price: 400, type: 'price', active: true },
        ],
      }),
    });
    const r = await alerts.list();
    assert.equal(r.success, true);
    assert.equal(r.alert_count, 2);
    assert.equal(r.alerts[0].symbol, 'AAPL');
  });

  it('test_deleteAlerts_smoke_all', async () => {
    installCdpMocks({ evaluate: async () => ({ context_menu_opened: true }) });
    const r = await alerts.deleteAlerts({ delete_all: true });
    assert.equal(r.success, true);
    assert.equal(r.context_menu_opened, true);
  });

  it('test_deleteAlerts_smoke_single', async () => {
    await assert.rejects(
      alerts.deleteAlerts({ delete_all: false }),
      /not yet supported/,
    );
  });

  describe('createIndicator', () => {
    const VALID = {
      pine_id: 'USER;abc123',
      alert_cond_id: 'plot_12',
      inputs: { pineFeatures: '{"indicator":1}', in_0: 14, __profile: false },
      offsets_by_plot: { plot_0: 0, plot_1: 0 },
      symbol: 'NASDAQ:AAPL',
      currency: 'USD',
      resolution: '60',
    };

    it('test_createIndicator_smoke_missingPineId', async () => {
      const r = await alerts.createIndicator({ ...VALID, pine_id: undefined });
      assert.equal(r.success, false);
      assert.match(r.error, /pine_id is required/);
    });

    it('test_createIndicator_smoke_missingAlertCondId', async () => {
      const r = await alerts.createIndicator({ ...VALID, alert_cond_id: undefined });
      assert.equal(r.success, false);
      assert.match(r.error, /alert_cond_id is required/);
    });

    it('test_createIndicator_smoke_missingInputs', async () => {
      const r = await alerts.createIndicator({ ...VALID, inputs: undefined });
      assert.equal(r.success, false);
      assert.match(r.error, /inputs is required/);
    });

    it('test_createIndicator_smoke_missingOffsets', async () => {
      const r = await alerts.createIndicator({ ...VALID, offsets_by_plot: undefined });
      assert.equal(r.success, false);
      assert.match(r.error, /offsets_by_plot is required/);
    });

    it('test_createIndicator_smoke_success', async () => {
      let captured = null;
      installCdpMocks({
        evaluateAsync: async (script) => {
          captured = script;
          return { status: 200, body: JSON.stringify({ s: 'ok', r: { alert_id: 'al-9001', expiration: '2026-06-01T00:00:00Z' } }) };
        },
      });
      const r = await alerts.createIndicator({ ...VALID, message: 'BUY {{ticker}}', web_hook: 'https://example.com/hook' });
      assert.equal(r.success, true);
      assert.equal(r.alert_id, 'al-9001');
      assert.equal(r.symbol, 'NASDAQ:AAPL');
      assert.equal(r.alert_cond_id, 'plot_12');
      assert.equal(r.web_hook, 'https://example.com/hook');
      assert.match(captured, /pricealerts\.tradingview\.com\/create_alert/);
      // Body is embedded as a JSON-encoded string literal; recover the
      // original payload by parsing twice.
      const bodyMatch = captured.match(/body:\s*("(?:[^"\\]|\\.)*")/);
      assert.ok(bodyMatch, 'body literal present');
      const obj = JSON.parse(JSON.parse(bodyMatch[1]));
      assert.equal(obj.payload.conditions[0].alert_cond_id, 'plot_12');
      assert.equal(obj.payload.conditions[0].series[0].pine_id, 'USER;abc123');
      assert.equal(obj.payload.message, 'BUY {{ticker}}');
    });

    it('test_createIndicator_smoke_apiError', async () => {
      installCdpMocks({
        evaluateAsync: async () => ({ status: 400, body: JSON.stringify({ s: 'error', errmsg: 'invalid alert_cond_id' }) }),
      });
      const r = await alerts.createIndicator(VALID);
      assert.equal(r.success, false);
      assert.equal(r.http_status, 400);
      assert.match(r.error, /invalid alert_cond_id/);
      assert.match(r.hint, /alert_cond_id off-by-one/);
    });

    it('test_createIndicator_smoke_resolvesActiveChart', async () => {
      // Caller omits symbol/currency/resolution → core reads them from chart.
      let evalCall = 0;
      installCdpMocks({
        evaluate: async () => {
          evalCall++;
          return { symbol: 'OANDA:USDJPY', currency: 'JPY', resolution: '240' };
        },
        evaluateAsync: async () => ({ status: 200, body: JSON.stringify({ s: 'ok', r: { alert_id: 'al-1' } }) }),
      });
      const r = await alerts.createIndicator({
        pine_id: VALID.pine_id,
        alert_cond_id: VALID.alert_cond_id,
        inputs: VALID.inputs,
        offsets_by_plot: VALID.offsets_by_plot,
      });
      assert.equal(r.success, true);
      assert.equal(r.symbol, 'OANDA:USDJPY');
      assert.equal(r.resolution, '240');
      assert.ok(evalCall >= 1);
    });

    it('test_createIndicator_smoke_chartReadFailureSurfaces', async () => {
      installCdpMocks({ evaluate: async () => ({ error: 'chart not ready' }) });
      const r = await alerts.createIndicator({
        pine_id: VALID.pine_id,
        alert_cond_id: VALID.alert_cond_id,
        inputs: VALID.inputs,
        offsets_by_plot: VALID.offsets_by_plot,
      });
      assert.equal(r.success, false);
      assert.match(r.error, /Could not read active chart symbol/);
    });

    it('test_createIndicator_smoke_capsExpiration', async () => {
      let captured = null;
      installCdpMocks({
        evaluateAsync: async (script) => {
          captured = script;
          return { status: 200, body: JSON.stringify({ s: 'ok', r: {} }) };
        },
      });
      await alerts.createIndicator({ ...VALID, expiration_days: 999 });
      const bodyMatch = captured.match(/body:\s*("(?:[^"\\]|\\.)*")/);
      const obj = JSON.parse(JSON.parse(bodyMatch[1]));
      const ms = new Date(obj.payload.expiration).getTime() - Date.now();
      const days = ms / (24 * 60 * 60 * 1000);
      assert.ok(days <= 60.1 && days >= 59.9, `expiration capped at 60 days, got ${days}`);
    });
  });
});
