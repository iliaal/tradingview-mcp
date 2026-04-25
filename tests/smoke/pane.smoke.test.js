/**
 * Smoke tests — src/core/pane.js.
 */
import { describe, it, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { installCdpMocks, resetCdpMocks, cleanupConnection } from '../helpers/mock-cdp.js';
import * as pane from '../../src/core/pane.js';

const FAKE_LAYOUT = {
  layout: '2h',
  chart_count: 2,
  active_index: 0,
  panes: [
    { index: 0, symbol: 'AAPL', resolution: 'D' },
    { index: 1, symbol: 'MSFT', resolution: 'D' },
  ],
};

describe('core/pane.js — smoke', () => {
  afterEach(() => resetCdpMocks());
  after(cleanupConnection);

  it('test_list_smoke', async () => {
    installCdpMocks({ evaluate: async () => FAKE_LAYOUT });
    const r = await pane.list();
    assert.equal(r.success, true);
    assert.equal(r.layout, '2h');
    assert.equal(r.layout_name, '2 horizontal');
    assert.equal(r.chart_count, 2);
    assert.equal(r.panes.length, 2);
  });

  it('test_setLayout_smoke_validCode', async () => {
    installCdpMocks({
      evaluateAsync: async () => undefined,
      evaluate: async () => FAKE_LAYOUT,
    });
    const r = await pane.setLayout({ layout: '2h' });
    assert.equal(r.success, true);
    assert.equal(r.layout, '2h');
    assert.equal(r.layout_name, '2 horizontal');
  });

  it('test_setLayout_smoke_alias', async () => {
    installCdpMocks({
      evaluateAsync: async () => undefined,
      evaluate: async () => ({ ...FAKE_LAYOUT, layout: '4', chart_count: 4 }),
    });
    const r = await pane.setLayout({ layout: '2x2' });
    assert.equal(r.layout, '4');
    assert.equal(r.layout_name, '2x2 grid');
  });

  it('test_setLayout_smoke_unknown', async () => {
    await assert.rejects(pane.setLayout({ layout: 'zzz' }), /Unknown layout/);
  });

  it('test_focus_smoke', async () => {
    installCdpMocks({ evaluate: async () => ({ focused: 1, total: 2 }) });
    const r = await pane.focus({ index: 1 });
    assert.equal(r.success, true);
    assert.equal(r.focused_index, 1);
    assert.equal(r.total_panes, 2);
  });

  it('test_setSymbol_smoke', async () => {
    installCdpMocks({
      evaluate: async () => ({ focused: 0, total: 2 }),  // focus() inside setSymbol
      evaluateAsync: async () => undefined,              // setSymbol body
    });
    const r = await pane.setSymbol({ index: 0, symbol: 'NVDA' });
    assert.equal(r.success, true);
    assert.equal(r.symbol, 'NVDA');
    assert.equal(r.index, 0);
  });

  // ── B.18 setTimeframe ─────────────────────────────────────────────
  it('test_setTimeframe_smoke', async () => {
    installCdpMocks({
      evaluate: async () => ({ index: 1, timeframe: '60', symbol: 'AAPL' }),
    });
    const r = await pane.setTimeframe({ index: 1, timeframe: '60' });
    assert.equal(r.success, true);
    assert.equal(r.index, 1);
    assert.equal(r.timeframe, '60');
    assert.equal(r.symbol, 'AAPL');
  });

  it('test_setTimeframe_smoke_throws_on_out_of_range_index', async () => {
    installCdpMocks({
      evaluate: async () => ({ error: 'Pane index 5 out of range (have 2 panes)' }),
    });
    await assert.rejects(
      pane.setTimeframe({ index: 5, timeframe: '60' }),
      /out of range/,
    );
  });

  it('test_setTimeframe_smoke_throws_on_setResolution_failure', async () => {
    installCdpMocks({
      evaluate: async () => ({ error: 'setResolution failed: bad timeframe' }),
    });
    await assert.rejects(
      pane.setTimeframe({ index: 0, timeframe: 'bogus' }),
      /setResolution failed/,
    );
  });
});
