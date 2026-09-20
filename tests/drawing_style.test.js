/**
 * draw_shape style plumbing.
 *
 * Regression: the tool schema silently STRIPPED unknown keys, so a caller
 * passing `color` / `linewidth` / `linestyle` — the names every other
 * charting API uses — got a default-yellow, width-1, solid line back with
 * `success: true`. 31 levels were plotted wrong before a screenshot caught
 * it. These tests pin the shorthand mapping AND the read-back that makes a
 * dropped style visible in the result instead of only on the chart.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { drawShape, buildOverrides, normalizeColor, stylesEqual } from '../src/core/drawing.js';

function mockDeps({ shapeProps = null, ids = ['s1'] } = {}) {
  const calls = [];
  const evaluate = async (expr) => {
    calls.push(expr);
    if (expr.includes('getAllShapes')) {
      // first call = "before" (empty), later = "after" (the new shape)
      return calls.filter(c => c.includes('getAllShapes')).length === 1 ? [] : ids;
    }
    if (expr.includes('getShapeById')) return shapeProps;
    return undefined;
  };
  evaluate.calls = calls;
  return { _deps: { evaluate, getChartApi: async () => 'window.__api' }, evaluate };
}

const POINT = { time: 1700000000, price: 100 };

describe('buildOverrides() — shorthand style params', () => {
  it('maps color -> linecolor', () => {
    assert.deepEqual(buildOverrides({ color: '#FF80AB' }), { linecolor: '#FF80AB' });
  });

  it('linecolor takes precedence over color', () => {
    assert.deepEqual(
      buildOverrides({ color: '#000000', linecolor: '#FF80AB' }),
      { linecolor: '#FF80AB' },
    );
  });

  it('passes linewidth, linestyle, textcolor, fontsize through', () => {
    assert.deepEqual(
      buildOverrides({ linewidth: 2, linestyle: 2, textcolor: '#FFF', fontsize: 14 }),
      { linewidth: 2, linestyle: 2, textcolor: '#FFF', fontsize: 14 },
    );
  });

  it('accepts overrides as a JSON string (back-compat)', () => {
    assert.deepEqual(
      buildOverrides({ overrides: '{"linecolor":"#ff0000","linewidth":3}' }),
      { linecolor: '#ff0000', linewidth: 3 },
    );
  });

  it('accepts overrides as an object', () => {
    assert.deepEqual(buildOverrides({ overrides: { linewidth: 3 } }), { linewidth: 3 });
  });

  it('explicit overrides wins over shorthand on conflict', () => {
    assert.deepEqual(
      buildOverrides({ color: '#111111', overrides: { linecolor: '#222222' } }),
      { linecolor: '#222222' },
    );
  });

  it('merges shorthand and non-conflicting overrides keys', () => {
    assert.deepEqual(
      buildOverrides({ color: '#FF80AB', overrides: { showPrice: false } }),
      { linecolor: '#FF80AB', showPrice: false },
    );
  });

  it('returns {} when nothing is styled', () => {
    assert.deepEqual(buildOverrides({}), {});
    assert.deepEqual(buildOverrides(), {});
  });

  it('rejects a non-object overrides payload', () => {
    assert.throws(() => buildOverrides({ overrides: '[1,2]' }), /must be a JSON object/);
  });
});

describe('normalizeColor() / stylesEqual()', () => {
  it('treats #RRGGBB and rgba() as equal', () => {
    assert.equal(normalizeColor('#FF80AB'), '255,128,171');
    assert.equal(normalizeColor('rgba(255, 128, 171, 0.98)'), '255,128,171');
    assert.ok(stylesEqual('rgba(255, 128, 171, 0.98)', '#FF80AB'));
  });

  it('expands 3-digit hex', () => {
    assert.equal(normalizeColor('#f0a'), normalizeColor('#ff00aa'));
  });

  it('flags a color that did NOT land', () => {
    // the actual regression: requested pink, chart reports TradingView yellow
    assert.equal(stylesEqual('rgba(255, 235, 59, 0.9809)', '#FF80AB'), false);
  });

  it('compares numbers numerically', () => {
    assert.ok(stylesEqual(2, 2));
    assert.equal(stylesEqual(1, 2), false);
  });

  it('undefined applied is never equal', () => {
    assert.equal(stylesEqual(undefined, '#FF80AB'), false);
    assert.equal(stylesEqual(null, 2), false);
  });
});

describe('drawShape() — style reaches the chart and is reported back', () => {
  it('puts shorthand styles into the createShape overrides payload', async () => {
    const { _deps, evaluate } = mockDeps();
    await drawShape({ shape: 'horizontal_line', point: POINT, color: '#FF80AB', linewidth: 2, linestyle: 2, _deps });
    const call = evaluate.calls.find(c => c.includes('createShape'));
    assert.ok(call.includes('"linecolor":"#FF80AB"'), 'linecolor in payload');
    assert.ok(call.includes('"linewidth":2'), 'linewidth in payload');
    assert.ok(call.includes('"linestyle":2'), 'linestyle in payload');
  });

  it('reports style_applied when the chart confirms it', async () => {
    const { _deps } = mockDeps({ shapeProps: { linecolor: 'rgba(255, 128, 171, 0.98)', linewidth: 2 } });
    const res = await drawShape({ shape: 'horizontal_line', point: POINT, color: '#FF80AB', linewidth: 2, _deps });
    assert.equal(res.success, true);
    assert.deepEqual(res.style_requested, { linecolor: '#FF80AB', linewidth: 2 });
    assert.equal(res.style_not_applied, undefined, 'nothing flagged when styles land');
  });

  it('flags style_not_applied when the chart ignored the override', async () => {
    // exactly the observed failure: yellow, width 1, solid
    const { _deps } = mockDeps({ shapeProps: { linecolor: 'rgba(255, 235, 59, 0.9809)', linewidth: 1, linestyle: 0 } });
    const res = await drawShape({ shape: 'horizontal_line', point: POINT, color: '#FF80AB', linewidth: 2, linestyle: 2, _deps });
    assert.deepEqual(res.style_not_applied.sort(), ['linecolor', 'linestyle', 'linewidth']);
  });

  it('omits style fields entirely when no style was requested', async () => {
    const { _deps } = mockDeps({ shapeProps: { linecolor: 'x' } });
    const res = await drawShape({ shape: 'horizontal_line', point: POINT, _deps });
    assert.equal(res.style_requested, undefined);
    assert.equal(res.style_applied, undefined);
  });

  it('a failed read-back never fails the draw', async () => {
    let seen = 0;
    const _deps = {
      getChartApi: async () => 'window.__api',
      evaluate: async (expr) => {
        if (expr.includes('getShapeById')) throw new Error('CDP gone');
        if (expr.includes('getAllShapes')) return (++seen === 1) ? [] : ['s1'];
        return undefined;
      },
    };
    const res = await drawShape({ shape: 'horizontal_line', point: POINT, color: '#FF80AB', _deps });
    assert.equal(res.success, true);
    assert.equal(res.entity_id, 's1');
  });
});
