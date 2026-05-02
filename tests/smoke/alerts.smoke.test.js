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

  // Common chart-info mock — every alerts.create needs the active chart's
  // symbol/currency/resolution before posting to TV's REST endpoint.
  const CHART_INFO = { symbol: 'NASDAQ:AAPL', currency: 'USD', resolution: '60' };

  it('test_create_smoke_success', async () => {
    let captured = null;
    installCdpMocks({
      evaluate: async () => CHART_INFO,
      evaluateAsync: async (script) => {
        captured = script;
        return { status: 200, body: JSON.stringify({ s: 'ok', r: { alert_id: 42, expiration: '2026-06-01T00:00:00Z' } }) };
      },
    });
    const r = await alerts.create({ condition: 'crossing', price: 190.5 });
    assert.equal(r.success, true);
    assert.equal(r.alert_id, 42);
    assert.equal(r.symbol, 'NASDAQ:AAPL');
    assert.equal(r.price, 190.5);
    assert.equal(r.condition, 'cross');
    assert.equal(r.source, 'rest_api');
    assert.match(captured, /pricealerts\.tradingview\.com\/create_alert/);

    // Body decodes back to a plausible payload.
    const bodyMatch = captured.match(/body:\s*("(?:[^"\\]|\\.)*")/);
    const obj = JSON.parse(JSON.parse(bodyMatch[1]));
    assert.equal(obj.payload.conditions[0].type, 'cross');
    assert.equal(obj.payload.conditions[0].series[1].value, 190.5);
    assert.equal(obj.payload.resolution, '60');
    assert.match(obj.payload.symbol, /^=/, 'symbol marker prefix');
  });

  it('test_create_smoke_normalizesConditionAliases', async () => {
    const captured = [];
    installCdpMocks({
      evaluate: async () => CHART_INFO,
      evaluateAsync: async (script) => {
        captured.push(script);
        return { status: 200, body: JSON.stringify({ s: 'ok', r: { alert_id: 1 } }) };
      },
    });
    const r1 = await alerts.create({ condition: 'greater_than', price: 100 });
    assert.equal(r1.condition, 'cross_up');
    const r2 = await alerts.create({ condition: 'below', price: 100 });
    assert.equal(r2.condition, 'cross_down');
    const r3 = await alerts.create({ condition: 'crossing', price: 100 });
    assert.equal(r3.condition, 'cross');
  });

  it('test_create_smoke_rejectsMissingPrice', async () => {
    installCdpMocks({});
    const r = await alerts.create({ condition: 'crossing' });
    assert.equal(r.success, false);
    assert.match(r.error, /price is required/);
  });

  it('test_create_smoke_chartReadFailureSurfaces', async () => {
    installCdpMocks({ evaluate: async () => ({ error: 'chart not loaded' }) });
    const r = await alerts.create({ condition: 'crossing', price: 100 });
    assert.equal(r.success, false);
    assert.match(r.error, /Could not read active chart symbol/);
  });

  it('test_create_smoke_apiError', async () => {
    installCdpMocks({
      evaluate: async () => CHART_INFO,
      evaluateAsync: async () => ({ status: 400, body: JSON.stringify({ s: 'error', errmsg: 'invalid price' }) }),
    });
    const r = await alerts.create({ condition: 'crossing', price: 100 });
    assert.equal(r.success, false);
    assert.equal(r.http_status, 400);
    assert.match(r.error, /invalid price/);
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

  it('test_deleteAlerts_smoke_singleId', async () => {
    let captured = null;
    installCdpMocks({
      evaluateAsync: async (script) => {
        captured = script;
        return { status: 200, body: JSON.stringify({ s: 'ok' }) };
      },
    });
    const r = await alerts.deleteAlerts({ alert_id: 99 });
    assert.equal(r.success, true);
    assert.equal(r.deleted_count, 1);
    assert.deepEqual(r.deleted_ids, [99]);
    assert.equal(r.source, 'rest_api');
    assert.match(captured, /delete_alerts/);
  });

  it('test_deleteAlerts_smoke_bulkIds', async () => {
    let captured = null;
    installCdpMocks({
      evaluateAsync: async (script) => {
        captured = script;
        return { status: 200, body: JSON.stringify({ s: 'ok' }) };
      },
    });
    const r = await alerts.deleteAlerts({ alert_ids: [1, 2, 3] });
    assert.equal(r.success, true);
    assert.equal(r.deleted_count, 3);
    assert.deepEqual(r.deleted_ids, [1, 2, 3]);
    const bodyMatch = captured.match(/body:\s*("(?:[^"\\]|\\.)*")/);
    const obj = JSON.parse(JSON.parse(bodyMatch[1]));
    assert.deepEqual(obj.payload.alert_ids, [1, 2, 3]);
  });

  it('test_deleteAlerts_smoke_deleteAll', async () => {
    // delete_all → list() first, then bulk-delete.
    let listCall = 0;
    installCdpMocks({
      evaluateAsync: async (script) => {
        if (/list_alerts/.test(script)) {
          listCall++;
          return { alerts: [{ alert_id: 11 }, { alert_id: 12 }] };
        }
        return { status: 200, body: JSON.stringify({ s: 'ok' }) };
      },
    });
    const r = await alerts.deleteAlerts({ delete_all: true });
    assert.equal(r.success, true);
    assert.equal(r.deleted_count, 2);
    assert.deepEqual(r.deleted_ids, [11, 12]);
    assert.equal(listCall, 1);
  });

  it('test_deleteAlerts_smoke_deleteAllEmpty', async () => {
    installCdpMocks({
      evaluateAsync: async () => ({ alerts: [] }),
    });
    const r = await alerts.deleteAlerts({ delete_all: true });
    assert.equal(r.success, true);
    assert.equal(r.deleted_count, 0);
    assert.match(r.note, /No alerts to delete/);
  });

  it('test_deleteAlerts_smoke_throwsWithoutArgs', async () => {
    await assert.rejects(alerts.deleteAlerts({}), /Pass one of/);
  });

  it('test_deleteAlerts_smoke_invalidId', async () => {
    await assert.rejects(alerts.deleteAlerts({ alert_id: 'not-a-number' }), /must be a number/);
  });

  it('test_deleteAlerts_smoke_apiError', async () => {
    installCdpMocks({
      evaluateAsync: async () => ({ status: 404, body: JSON.stringify({ s: 'error', errmsg: 'alert not found' }) }),
    });
    const r = await alerts.deleteAlerts({ alert_id: 999 });
    assert.equal(r.success, false);
    assert.equal(r.http_status, 404);
    assert.match(r.error, /alert not found/);
    assert.deepEqual(r.attempted_ids, [999]);
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
