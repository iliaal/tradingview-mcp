/**
 * Smoke tests — src/core/drawing.js.
 * drawShape and sanitizeOverrides are already unit-tested; these cover the
 * remaining async CDP-dependent functions end-to-end with mocked evaluate.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installCdpMocks, resetCdpMocks } from '../helpers/mock-cdp.js';
import * as drawing from '../../src/core/drawing.js';

describe('core/drawing.js — smoke', () => {
  afterEach(() => resetCdpMocks());

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
});
