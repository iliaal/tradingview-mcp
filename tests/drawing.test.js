/**
 * Unit tests for src/core/drawing.js helpers and the position-box tick math.
 * No TradingView needed: evaluate/getChartApi are injected via _deps.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePoints, priceToTicks, drawPosition, drawShape, movePoints, setProperties, setVisible, SHAPE_TYPES } from '../src/core/drawing.js';
import { TOOL_GROUPS } from '../src/tools/registry.js';

describe('normalizePoints', () => {
  it('builds from point/point2', () => {
    assert.deepEqual(normalizePoints({ point: { time: 1, price: 2 }, point2: { time: 3, price: 4 } }),
      [{ time: 1, price: 2 }, { time: 3, price: 4 }]);
  });
  it('accepts a JSON string points array', () => {
    assert.deepEqual(normalizePoints({ points: '[{"time":1,"price":2},{"time":3,"price":4},{"time":5,"price":6}]' }).length, 3);
  });
  it('rejects NaN', () => {
    assert.throws(() => normalizePoints({ point: { time: 'x', price: 1 } }), /finite/);
  });
});

describe('priceToTicks', () => {
  it('rounds to whole ticks, min 1', () => {
    assert.equal(priceToTicks(0.003856, 0.003800, 0.000001), 56);
    assert.equal(priceToTicks(100, 100.0000001, 0.01), 1);
  });
  it('rejects bad tick', () => { assert.throws(() => priceToTicks(1, 2, 0)); });
});

function mockChart() {
  const state = { shapes: [], props: {} };
  const evaluate = async (expr) => {
    if (/getAllShapes\(\)\.map/.test(expr)) return state.shapes.slice();
    if (/priceFormatter/.test(expr)) return 0.000001;
    if (/setProperties/.test(expr)) { state.props.va = true; return {}; }
    return undefined;
  };
  const evaluateAsync = async (expr) => {
    const m = expr.match(/shape: "([a-z_]+)"/);
    const id = 'id_' + (state.shapes.length + 1);
    state.shapes.push(id); state.lastShape = m?.[1]; state.lastExpr = expr;
    return id;
  };
  return { state, _deps: { evaluate, evaluateAsync, getChartApi: async () => 'CHART' } };
}

describe('drawShape', () => {
  it('uses the awaited entity id and passes N points', async () => {
    const { state, _deps } = mockChart();
    const r = await drawShape({ shape: 'path', points: [{ time: 1, price: 1 }, { time: 2, price: 2 }, { time: 3, price: 3 }], _deps });
    assert.equal(r.entity_id, 'id_1');
    assert.equal(state.lastShape, 'path');
    assert.match(state.lastExpr, /createMultipointShape/);
  });
  it('turns on value-area lines for volume profiles', async () => {
    const { state, _deps } = mockChart();
    await drawShape({ shape: 'fixed_range_volume_profile', point: { time: 1, price: 1 }, point2: { time: 2, price: 2 }, _deps });
    assert.equal(state.props.va, true);
  });
});

describe('drawPosition', () => {
  it('converts prices to ticks and reports R', async () => {
    const { state, _deps } = mockChart();
    const r = await drawPosition({ side: 'long', entry: 0.003856, stop: 0.003800, target: 0.004320, time: 1000, _deps });
    assert.equal(r.stop_ticks, 56);
    assert.equal(r.profit_ticks, 464);
    assert.equal(r.r_multiple, 8.29);
    assert.equal(state.lastShape, 'long_position');
    assert.match(state.lastExpr, /"stopLevel":56/);
  });
  it('rejects inconsistent long levels', async () => {
    const { _deps } = mockChart();
    await assert.rejects(drawPosition({ side: 'long', entry: 10, stop: 11, target: 12, time: 1, _deps }), /must be below/);
  });
  it('lists volume profile among two-point shapes', () => {
    assert.ok(SHAPE_TYPES.two_point.includes('fixed_range_volume_profile'));
  });
});

// ── Merge additions: move/set/visible + short-side + time2 + text_ignored ──

function mockShapeApi({ notFound = false } = {}) {
  const calls = [];
  const evaluate = async (expr) => {
    calls.push(expr);
    if (/getShapeById/.test(expr)) {
      if (notFound) return { error: 'Shape not found: x' };
      if (/setPoints/.test(expr)) {
        const m = expr.match(/setPoints\((\[.*?\])\)/s);
        return { points: JSON.parse(m[1]) };
      }
      if (/setVisible\(true\)/.test(expr)) return { hidden: false };
      if (/setVisible\(false\)/.test(expr)) return { hidden: true };
    }
    return undefined;
  };
  return { calls, _deps: { evaluate, getChartApi: async () => 'CHART' } };
}

describe('movePoints', () => {
  it('echoes the moved points', async () => {
    const { _deps } = mockShapeApi();
    const pts = [{ time: 1, price: 10 }, { time: 2, price: 20 }];
    const r = await movePoints({ entity_id: 's1', points: pts, _deps });
    assert.equal(r.success, true);
    assert.deepEqual(r.points, pts);
  });
  it('requires entity_id', async () => {
    const { _deps } = mockShapeApi();
    await assert.rejects(movePoints({ points: [{ time: 1, price: 1 }], _deps }), /entity_id is required/);
  });
  it('throws on unknown shape', async () => {
    const { _deps } = mockShapeApi({ notFound: true });
    await assert.rejects(movePoints({ entity_id: 'nope', points: [{ time: 1, price: 1 }], _deps }), /Shape not found/);
  });
  it('validates points', async () => {
    const { _deps } = mockShapeApi();
    await assert.rejects(movePoints({ entity_id: 's1', points: [{ time: 'x', price: 1 }], _deps }), /finite/);
  });
});

describe('setProperties', () => {
  it('echoes the applied keys by executing the page script', async () => {
    // Executes the REAL evaluate payload against a fake shape so a missing
    // `return` (or any echo-shape drift) fails here instead of only live.
    const { default: vm } = await import('node:vm');
    const shape = {
      props: { linecolor: '#000000', linewidth: 1 },
      setProperties(p) { Object.assign(this.props, JSON.parse(JSON.stringify(p))); },
      getProperties() { return { ...this.props }; },
    };
    const sandbox = { CHART: { getShapeById: () => shape } };
    let captured = '';
    const _deps = {
      getChartApi: async () => 'CHART',
      evaluate: async (expr) => {
        captured = expr;
        return vm.runInNewContext(expr, sandbox);
      },
    };
    const r = await setProperties({ entity_id: 's1', properties: '{"linecolor":"#ff0000"}', _deps });
    assert.equal(r.success, true);
    // JSON round-trip: vm-realm objects carry a foreign prototype, which
    // deepStrictEqual rejects despite identical content.
    assert.deepEqual(JSON.parse(JSON.stringify(r.applied)), { linecolor: '#ff0000' });
  });
  it('requires entity_id', async () => {
    const { _deps } = mockShapeApi();
    await assert.rejects(setProperties({ properties: '{"a":1}', _deps }), /entity_id is required/);
  });
  it('rejects a non-object payload', async () => {
    const { _deps } = mockShapeApi();
    await assert.rejects(setProperties({ entity_id: 's1', properties: '[1,2]', _deps }), /must be a JSON object/);
  });
  it('throws on unknown shape', async () => {
    const { _deps } = mockShapeApi({ notFound: true });
    await assert.rejects(setProperties({ entity_id: 'nope', properties: '{"a":1}', _deps }), /Shape not found/);
  });
});

describe('setVisible', () => {
  it('normalizes hidden=false to visible=true', async () => {
    const { _deps } = mockShapeApi();
    const r = await setVisible({ entity_id: 's1', visible: true, _deps });
    assert.deepEqual(r, { success: true, entity_id: 's1', visible: true });
  });
  it('normalizes hidden=true to visible=false', async () => {
    const { _deps } = mockShapeApi();
    const r = await setVisible({ entity_id: 's1', visible: false, _deps });
    assert.deepEqual(r, { success: true, entity_id: 's1', visible: false });
  });
  it('requires entity_id', async () => {
    const { _deps } = mockShapeApi();
    await assert.rejects(setVisible({ visible: true, _deps }), /entity_id is required/);
  });
  it('throws on unknown shape', async () => {
    const { _deps } = mockShapeApi({ notFound: true });
    await assert.rejects(setVisible({ entity_id: 'nope', visible: true, _deps }), /Shape not found/);
  });
});

describe('drawPosition merge cases', () => {
  it('short side mirrors the tick math (our param names)', async () => {
    const { state, _deps } = mockChart();
    const r = await drawPosition({
      direction: 'short', entry_price: 0.004320, stop_loss: 0.004376,
      take_profit: 0.003856, entry_time: 1000, _deps,
    });
    assert.equal(r.direction, 'short');
    assert.equal(r.stop_ticks, 56);
    assert.equal(r.profit_ticks, 464);
    assert.equal(r.r_multiple, 8.29);
    assert.equal(r.risk_reward_ratio, 8.29);
    assert.equal(state.lastShape, 'short_position');
  });
  it('rejects inconsistent short levels', async () => {
    const { _deps } = mockChart();
    await assert.rejects(
      drawPosition({ direction: 'short', entry_price: 10, stop_loss: 9, take_profit: 11, entry_time: 1, _deps }),
      /stop_loss must be above/,
    );
  });
  it('defaults time2 to time + 1 day', async () => {
    const { state, _deps } = mockChart();
    await drawPosition({ side: 'long', entry: 0.003856, stop: 0.003800, target: 0.004320, time: 1000, _deps });
    assert.match(state.lastExpr, /"time":87400/);
  });
  it('honours an explicit time2', async () => {
    const { state, _deps } = mockChart();
    await drawPosition({ side: 'long', entry: 0.003856, stop: 0.003800, target: 0.004320, time: 1000, time2: 2000, _deps });
    assert.match(state.lastExpr, /"time":2000/);
  });
  it('marks text_ignored only when text is passed', async () => {
    const { _deps } = mockChart();
    const withText = await drawPosition({ side: 'long', entry: 0.003856, stop: 0.003800, target: 0.004320, time: 1000, text: 'hi', _deps });
    assert.equal(withText.text_ignored, true);
    const without = await drawPosition({ side: 'long', entry: 0.003856, stop: 0.003800, target: 0.004320, time: 1000, _deps });
    assert.equal(without.text_ignored, undefined);
  });
  it('falls back to symbolInfo pricescale when the formatter is missing', async () => {
    const inner = mockChart();
    const evaluate = async (expr) => {
      if (/priceFormatter/.test(expr)) return null;
      if (/symbolInfo/.test(expr)) return 100;
      return inner._deps.evaluate(expr);
    };
    const _deps = { ...inner._deps, evaluate };
    const r = await drawPosition({ side: 'long', entry: 10.5, stop: 10.0, target: 12.0, time: 1000, _deps });
    assert.equal(r.min_tick, 0.01);
    assert.equal(r.stop_ticks, 50);
    assert.equal(r.profit_ticks, 150);
  });
});

describe('drawing tool registry — new tools', () => {
  it('exposes draw_move, draw_set_properties, draw_set_visible', () => {
    const tools = [];
    TOOL_GROUPS.drawing({ tool: (name) => tools.push(name) });
    for (const name of ['draw_shape', 'draw_position', 'draw_move', 'draw_set_properties', 'draw_set_visible', 'draw_list', 'draw_clear', 'draw_remove_one', 'draw_get_properties']) {
      assert.ok(tools.includes(name), `missing tool: ${name}`);
    }
    assert.equal(tools.length, 9);
  });
});
