/**
 * Smoke tests — src/core/drawing.js.
 * drawShape and sanitizeOverrides are already unit-tested; these cover the
 * remaining async CDP-dependent functions end-to-end with mocked evaluate.
 */
import { describe, it, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { installCdpMocks, resetCdpMocks, cleanupConnection } from '../helpers/mock-cdp.js';
import * as drawing from '../../src/core/drawing.js';

describe('core/drawing.js — smoke', () => {
  afterEach(() => resetCdpMocks());
  after(cleanupConnection);

  it('test_drawShape_smoke_singlePoint', async () => {
    // evaluate sequence: before-ids → createShape → after-ids
    let call = 0;
    installCdpMocks({
      getChartApi: async () => 'window.chartApi',
      evaluate: async () => {
        call++;
        if (call === 1) return ['old-1'];
        if (call === 2) return undefined;       // createShape
        return ['old-1', 'new-123'];           // after-ids
      },
    });
    const r = await drawing.drawShape({
      shape: 'horizontal_line',
      point: { time: 1700000000, price: 190.5 },
    });
    assert.equal(r.success, true);
    assert.equal(r.shape, 'horizontal_line');
    assert.equal(r.entity_id, 'new-123');
  });

  it('test_drawShape_smoke_multipoint', async () => {
    let call = 0;
    installCdpMocks({
      getChartApi: async () => 'window.chartApi',
      evaluate: async () => {
        call++;
        if (call === 1) return [];
        if (call === 2) return undefined;
        return ['new-456'];
      },
    });
    const r = await drawing.drawShape({
      shape: 'trend_line',
      point: { time: 1700000000, price: 190 },
      point2: { time: 1700003600, price: 195 },
    });
    assert.equal(r.entity_id, 'new-456');
  });

  it('test_listDrawings_smoke', async () => {
    installCdpMocks({
      getChartApi: async () => 'window.chartApi',
      evaluate: async () => [
        { id: 'sh-1', name: 'horizontal_line' },
        { id: 'sh-2', name: 'trend_line' },
      ],
    });
    const r = await drawing.listDrawings();
    assert.equal(r.success, true);
    assert.equal(r.count, 2);
    assert.equal(r.shapes[0].id, 'sh-1');
  });

  it('test_getProperties_smoke', async () => {
    installCdpMocks({
      getChartApi: async () => 'window.chartApi',
      evaluate: async () => ({
        entity_id: 'sh-1', points: [{ time: 1, price: 2 }], visible: true, name: 'horizontal_line',
      }),
    });
    const r = await drawing.getProperties({ entity_id: 'sh-1' });
    assert.equal(r.success, true);
    assert.equal(r.entity_id, 'sh-1');
    assert.equal(r.visible, true);
  });

  it('test_removeOne_smoke', async () => {
    installCdpMocks({
      getChartApi: async () => 'window.chartApi',
      evaluate: async () => ({ removed: true, entity_id: 'sh-1', remaining_shapes: 3 }),
    });
    const r = await drawing.removeOne({ entity_id: 'sh-1' });
    assert.equal(r.success, true);
    assert.equal(r.removed, true);
    assert.equal(r.remaining_shapes, 3);
  });

  it('test_clearAll_smoke', async () => {
    installCdpMocks({
      getChartApi: async () => 'window.chartApi',
      evaluate: async () => undefined,
    });
    const r = await drawing.clearAll();
    assert.equal(r.success, true);
    assert.equal(r.action, 'all_shapes_removed');
  });

  // ── B.13 drawPosition ──────────────────────────────────────────────
  it('test_drawPosition_smoke_long', async () => {
    // evaluate call sequence:
    //   1. pricescale lookup → 100
    //   2. (no entry_time given) getVisibleRange → { to: 1700003600 }
    //   3. before-ids
    //   4. createShape (returns undefined)
    //   5. after-ids → adds 'pos-1'
    let call = 0;
    installCdpMocks({
      getChartApi: async () => 'window.chartApi',
      evaluate: async () => {
        call++;
        if (call === 1) return 100;                   // pricescale
        if (call === 2) return { to: 1700003600 };    // getVisibleRange
        if (call === 3) return ['old-1'];             // before
        if (call === 4) return undefined;             // createShape
        return ['old-1', 'pos-1'];                    // after
      },
    });
    const r = await drawing.drawPosition({
      direction: 'long', entry_price: 100, stop_loss: 95, take_profit: 110,
    });
    assert.equal(r.success, true);
    assert.equal(r.direction, 'long');
    assert.equal(r.entity_id, 'pos-1');
    // R:R = (10 * 100) / (5 * 100) = 1000 / 500 = 2.0
    assert.equal(r.risk_reward_ratio, 2);
  });

  it('test_drawPosition_smoke_short', async () => {
    let call = 0;
    installCdpMocks({
      getChartApi: async () => 'window.chartApi',
      evaluate: async () => {
        call++;
        if (call === 1) return 100;
        if (call === 2) return { to: 1700003600 };
        if (call === 3) return [];
        if (call === 4) return undefined;
        return ['pos-2'];
      },
    });
    const r = await drawing.drawPosition({
      direction: 'short', entry_price: 100, stop_loss: 105, take_profit: 90,
    });
    assert.equal(r.success, true);
    assert.equal(r.direction, 'short');
    assert.equal(r.entity_id, 'pos-2');
  });

  it('test_drawPosition_smoke_rejects_invalid_long', async () => {
    installCdpMocks({ getChartApi: async () => 'window.chartApi', evaluate: async () => 100 });
    // long: stop_loss must be below entry_price
    await assert.rejects(
      drawing.drawPosition({ direction: 'long', entry_price: 100, stop_loss: 105, take_profit: 110 }),
      /stop_loss must be below entry_price/,
    );
  });

  it('test_drawPosition_smoke_rejects_invalid_short', async () => {
    installCdpMocks({ getChartApi: async () => 'window.chartApi', evaluate: async () => 100 });
    // short: take_profit must be below entry_price
    await assert.rejects(
      drawing.drawPosition({ direction: 'short', entry_price: 100, stop_loss: 105, take_profit: 110 }),
      /take_profit must be below entry_price/,
    );
  });

  it('test_drawPosition_smoke_rejects_invalid_direction', async () => {
    await assert.rejects(
      drawing.drawPosition({ direction: 'sideways', entry_price: 100, stop_loss: 95, take_profit: 110 }),
      /direction must be "long" or "short"/,
    );
  });

  it('test_drawPosition_smoke_rejects_zero_pricescale', async () => {
    installCdpMocks({ getChartApi: async () => 'window.chartApi', evaluate: async () => 0 });
    await assert.rejects(
      drawing.drawPosition({ direction: 'long', entry_price: 100, stop_loss: 95, take_profit: 110 }),
      /pricescale/,
    );
  });
});
