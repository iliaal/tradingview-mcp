/**
 * Unit tests for src/core/data.js formatting: sub-cent price rounding (8 dp)
 * and box text passthrough. Uses a mocked `evaluate` so no live chart is
 * needed — the raw shapes match what buildGraphicsJS / _readOhlcvBars return.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getPineLines, getPineBoxes, getOhlcv } from '../src/core/data.js';

describe('price rounding preserves sub-cent levels (8 dp)', () => {
  it('getPineLines keeps a 5-dp horizontal level instead of flattening to 0.00', async () => {
    const raw = [{
      name: 'Levels', count: 1,
      items: [{ id: 'l1', raw: { y1: 0.00234, y2: 0.00234, x1: 0, x2: 5, st: 0, w: 1, ci: '#fff' } }],
    }];
    const r = await getPineLines({ verbose: true, _deps: { evaluate: async () => raw } });
    assert.equal(r.studies[0].all_lines[0].y1, 0.00234);
    assert.deepEqual(r.studies[0].horizontal_levels, [0.00234]);
  });

  it('getPineBoxes keeps sub-cent zone bounds and exposes box text (verbose)', async () => {
    const raw = [{
      name: 'SMC', count: 1,
      items: [{ id: 'b1', raw: { y1: 0.00234, y2: 0.0025, t: 'Supply', x1: 0, x2: 5, c: '#f00', bc: '#f001' } }],
    }];
    const r = await getPineBoxes({ verbose: true, _deps: { evaluate: async () => raw } });
    const box = r.studies[0].all_boxes[0];
    assert.equal(box.high, 0.0025);
    assert.equal(box.low, 0.00234);
    assert.equal(box.text, 'Supply'); // #382
    assert.deepEqual(r.studies[0].zones[0], { high: 0.0025, low: 0.00234 });
  });

  it('getPineBoxes emits empty string when a box has no text', async () => {
    const raw = [{ name: 'Z', count: 1, items: [{ id: 'b1', raw: { y1: 1, y2: 2, x1: 0, x2: 1 } }] }];
    const r = await getPineBoxes({ verbose: true, _deps: { evaluate: async () => raw } });
    assert.equal(r.studies[0].all_boxes[0].text, '');
  });

  it('getOhlcv summary keeps sub-cent range/change (would be 0.00 at 2 dp)', async () => {
    const bars = [
      { time: 1, open: 0.0023, high: 0.0025, low: 0.0022, close: 0.00245, volume: 100 },
      { time: 2, open: 0.00245, high: 0.0026, low: 0.0024, close: 0.00255, volume: 200 },
    ];
    const _deps = { evaluate: async () => ({ bars, total_bars: 2, source: 'direct_bars' }) };
    const r = await getOhlcv({ summary: true, _deps });
    assert.equal(r.range, 0.0004);  // 0.0026 - 0.0022
    assert.equal(r.change, 0.00025); // 0.00255 - 0.0023
    assert.ok(r.range > 0 && r.change > 0);
  });
});
