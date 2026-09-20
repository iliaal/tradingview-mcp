/**
 * Core drawing logic.
 */
import { evaluate as _evaluate, evaluateAsync as _evaluateAsync, getChartApi as _getChartApi, safeString, requireFinite } from '../connection.js';

/**
 * Shape names accepted by TradingView's createShape/createMultipointShape.
 * Verified on TradingView Desktop 3.4.1 (2026-09-17). The name is passed
 * through untouched, so any other LineTool name TradingView knows also works.
 */
export const SHAPE_TYPES = {
  one_point: ['horizontal_line', 'vertical_line', 'horizontal_ray', 'text', 'price_label', 'arrow_up', 'arrow_down', 'flag', 'note', 'anchored_vwap'],
  two_point: ['trend_line', 'ray', 'extended', 'rectangle', 'ellipse', 'fib_retracement', 'fib_extension', 'parallel_channel',
    'long_position', 'short_position', 'fixed_range_volume_profile', 'anchored_volume_profile', 'date_range', 'price_range'],
  multi_point: ['path', 'polyline', 'triangle'],
};

const VOLUME_PROFILE_SHAPES = new Set(['fixed_range_volume_profile', 'anchored_volume_profile']);

function _resolve(deps) {
  return {
    evaluate: deps?.evaluate || _evaluate,
    // Fall back to the injected sync evaluate so offline tests that only mock
    // `evaluate` keep working; the before/after id diff still resolves the id.
    evaluateAsync: deps?.evaluateAsync || deps?.evaluate || _evaluateAsync,
    getChartApi: deps?.getChartApi || _getChartApi,
  };
}

/**
 * Style shorthand -> TradingView override keys.
 *
 * `draw_shape` callers naturally pass `color` / `linewidth` / `linestyle` —
 * the names every other charting API uses — so accept the obvious names here
 * and report what actually landed so a future mismatch is visible without a
 * screenshot. Explicit `overrides` wins on conflict: it is the lower-level
 * escape hatch.
 */
export function buildOverrides({ overrides: raw, color, linecolor, linewidth, linestyle, textcolor, fontsize } = {}) {
  let explicit = {};
  if (raw) {
    explicit = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (typeof explicit !== 'object' || Array.isArray(explicit)) {
      throw new Error('overrides must be a JSON object');
    }
  }
  const shorthand = {};
  const lc = linecolor !== undefined ? linecolor : color;
  if (lc !== undefined) shorthand.linecolor = lc;
  if (linewidth !== undefined) shorthand.linewidth = linewidth;
  if (linestyle !== undefined) shorthand.linestyle = linestyle;
  if (textcolor !== undefined) shorthand.textcolor = textcolor;
  if (fontsize !== undefined) shorthand.fontsize = fontsize;
  return { ...shorthand, ...explicit };
}

/** Compare a requested override against what the chart reports back. */
export function stylesEqual(applied, requested) {
  if (applied === undefined || applied === null) return false;
  if (typeof requested === 'number') return Number(applied) === requested;
  if (typeof requested === 'string' && typeof applied === 'string') {
    return normalizeColor(applied) === normalizeColor(requested);
  }
  return applied === requested;
}

/** #RRGGBB / #rgb / rgb(a)(...) -> a comparable "r,g,b" string. */
export function normalizeColor(v) {
  if (typeof v !== 'string') return v;
  const s = v.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) {
    const [r, g, b] = m[1].split('');
    return [r + r, g + g, b + b].map(h => parseInt(h, 16)).join(',');
  }
  m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) {
    return [m[1].slice(0, 2), m[1].slice(2, 4), m[1].slice(4, 6)].map(h => parseInt(h, 16)).join(',');
  }
  m = /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/.exec(s);
  if (m) return [m[1], m[2], m[3]].map(n => Math.round(Number(n))).join(',');
  return s;
}

/** Normalize {point, point2, points} into a validated points array. Exported for tests. */
export function normalizePoints({ point, point2, points }) {
  let list = [];
  let names = null;
  if (points) list = typeof points === 'string' ? JSON.parse(points) : points;
  else { list = [point]; names = ['point']; if (point2) { list.push(point2); names.push('point2'); } }
  if (!Array.isArray(list) || list.length === 0) throw new Error('at least one point is required');
  return list.map((pt, i) => {
    const n = names ? names[i] : `points[${i}]`;
    return { time: requireFinite(pt?.time, `${n}.time`), price: requireFinite(pt?.price, `${n}.price`) };
  });
}

/**
 * Convert a price distance into ticks for long_position/short_position
 * (their stopLevel/profitLevel are tick counts, not prices). Exported for tests.
 */
export function priceToTicks(from, to, minTick) {
  const mt = requireFinite(minTick, 'minTick');
  if (mt <= 0) throw new Error('minTick must be > 0');
  return Math.max(1, Math.round(Math.abs(to - from) / mt));
}

export async function drawShape({ shape, point, point2, points, overrides: overridesRaw, text, color, linecolor, linewidth, linestyle, textcolor, fontsize, _deps }) {
  const { evaluate, evaluateAsync, getChartApi } = _resolve(_deps);
  const overrides = buildOverrides({ overrides: overridesRaw, color, linecolor, linewidth, linestyle, textcolor, fontsize });
  const apiPath = await getChartApi();
  const overridesStr = JSON.stringify(overrides || {});
  const textStr = text ? JSON.stringify(text) : '""';
  const pts = normalizePoints({ point, point2, points });

  const before = await evaluate(`${apiPath}.getAllShapes().map(function(s) { return s.id; })`);

  // Both create calls return a Promise<entityId> on recent builds; await it.
  let created;
  if (pts.length > 1) {
    created = await evaluateAsync(`
      ${apiPath}.createMultipointShape(
        ${JSON.stringify(pts)},
        { shape: ${safeString(shape)}, overrides: ${overridesStr}, text: ${textStr} }
      )
    `);
  } else {
    created = await evaluateAsync(`
      ${apiPath}.createShape(
        ${JSON.stringify(pts[0])},
        { shape: ${safeString(shape)}, overrides: ${overridesStr}, text: ${textStr} }
      )
    `);
  }

  await new Promise(r => setTimeout(r, 200));
  const after = await evaluate(`${apiPath}.getAllShapes().map(function(s) { return s.id; })`);
  const newId = (typeof created === 'string' && created) || (after || []).find(id => !(before || []).includes(id)) || null;

  // Volume profiles: show value-area lines by default (POC is already on).
  // Runs BEFORE the style read-back so the read-back sees the final state.
  if (newId && VOLUME_PROFILE_SHAPES.has(shape) && !overrides.graphics) {
    await evaluate(`
      (function() {
        var s = ${apiPath}.getShapeById(${safeString(newId)});
        if (s) s.setProperties({ graphics: { horizlines: { vahLines: { visible: true }, valLines: { visible: true } } } });
      })()
    `);
  }

  const result = { success: true, shape, entity_id: newId, points: pts };

  // Read the style back. A requested override that did not land shows up here
  // instead of only on the chart. `graphics` is excluded from the mismatch
  // comparison: the VAH/VAL default above writes graphics keys itself.
  if (newId && Object.keys(overrides).length) {
    result.style_requested = overrides;
    try {
      const applied = await evaluate(`
        (function() {
          var s = ${apiPath}.getShapeById(${safeString(newId)});
          if (!s) return null;
          try { return s.getProperties(); } catch (e) { return null; }
        })()
      `);
      if (applied) {
        result.style_applied = {};
        const mismatched = [];
        for (const k of Object.keys(overrides)) {
          result.style_applied[k] = applied[k];
          if (k === 'graphics') continue;
          if (!stylesEqual(applied[k], overrides[k])) mismatched.push(k);
        }
        if (mismatched.length) result.style_not_applied = mismatched;
      }
    } catch { /* readback is diagnostic only — never fail the draw over it */ }
  }

  return result;
}

/** Move an existing drawing by replacing its anchor points. */
export async function movePoints({ entity_id, points, _deps }) {
  const { evaluate, getChartApi } = _resolve(_deps);
  if (!entity_id) throw new Error('entity_id is required');
  const pts = normalizePoints({ points });
  const apiPath = await getChartApi();
  const result = await evaluate(`
    (function() {
      var s = ${apiPath}.getShapeById(${safeString(entity_id)});
      if (!s) return { error: 'Shape not found: ' + ${safeString(entity_id)} };
      s.setPoints(${JSON.stringify(pts)});
      return { points: s.getPoints() };
    })()
  `);
  if (result?.error) throw new Error(result.error);
  return { success: true, entity_id, points: result?.points };
}

/** Change style/properties of an existing drawing (deep-merged by TradingView). */
export async function setProperties({ entity_id, properties: propsRaw, _deps }) {
  const { evaluate, getChartApi } = _resolve(_deps);
  if (!entity_id) throw new Error('entity_id is required');
  const props = typeof propsRaw === 'string' ? JSON.parse(propsRaw) : propsRaw;
  if (!props || typeof props !== 'object' || Array.isArray(props)) throw new Error('properties must be a JSON object');
  const apiPath = await getChartApi();
  const result = await evaluate(`
    (function() {
      var s = ${apiPath}.getShapeById(${safeString(entity_id)});
      if (!s) return { error: 'Shape not found: ' + ${safeString(entity_id)} };
      s.setProperties(${JSON.stringify(props)});
      var p = s.getProperties(); var out = {};
      for (var k in ${JSON.stringify(props)}) out[k] = p[k];
      return out;
    })()
  `);
  if (result?.error) throw new Error(result.error);
  return { success: true, entity_id, applied: result };
}

/** Show or hide a drawing without deleting it. */
export async function setVisible({ entity_id, visible, _deps }) {
  const { evaluate, getChartApi } = _resolve(_deps);
  if (!entity_id) throw new Error('entity_id is required');
  const apiPath = await getChartApi();
  const result = await evaluate(`
    (function() {
      var s = ${apiPath}.getShapeById(${safeString(entity_id)});
      if (!s) return { error: 'Shape not found: ' + ${safeString(entity_id)} };
      s.setVisible(${visible ? 'true' : 'false'});
      return { hidden: s.isHidden() };
    })()
  `);
  if (result?.error) throw new Error(result.error);
  return { success: true, entity_id, visible: !result?.hidden };
}

/**
 * Draw a long/short position box from prices (entry, stop, target) spanning
 * two anchor points at the entry price. TradingView stores stop/profit as
 * tick counts; this converts using the chart's min tick.
 *
 * Parameter aliases (`side`/`entry`/`stop`/`target`/`time`/`time2`,
 * `entry_time2`) exist so the CLI (`draw position --side … --time …`) and the
 * MCP tool (our `direction`/`entry_price`/… names) share one implementation.
 *
 * `text` is accepted for API symmetry but ignored: position tools reject a
 * text payload ("Value is undefined" from _createMultipointShape, TV 3.4.1).
 */
export async function drawPosition({ direction, side, entry_price, entry, stop_loss, stop, take_profit, target, entry_time, time, entry_time2, time2, account_size, risk, lot_size, text, _deps }) {
  const { evaluate, getChartApi } = _resolve(_deps);

  const dir = String(direction ?? side ?? 'long').toLowerCase();
  if (dir !== 'long' && dir !== 'short') {
    throw new Error('direction must be "long" or "short"');
  }

  const entryP = requireFinite(entry_price ?? entry, 'entry_price');
  const sl = requireFinite(stop_loss ?? stop, 'stop_loss');
  const tp = requireFinite(take_profit ?? target, 'take_profit');

  if (dir === 'long') {
    if (sl >= entryP) throw new Error('long position: stop_loss must be below entry_price');
    if (tp <= entryP) throw new Error('long position: take_profit must be above entry_price');
  } else {
    if (sl <= entryP) throw new Error('short position: stop_loss must be above entry_price');
    if (tp >= entryP) throw new Error('short position: take_profit must be below entry_price');
  }

  const apiPath = await getChartApi();

  let t1 = entry_time ?? time;
  if (t1 == null) {
    const range = await evaluate(`${apiPath}.getVisibleRange()`);
    t1 = range?.to || Math.floor(Date.now() / 1000);
  }
  t1 = requireFinite(t1, 'entry_time');
  const t2raw = entry_time2 ?? time2;
  const t2 = t2raw != null ? requireFinite(t2raw, 'entry_time2') : t1 + 86400;

  // Prefer the chart's own price formatter; fall back to symbolInfo().pricescale.
  let minTick = await evaluate(
    `(function() { try { var f = ${apiPath}.priceFormatter(); if (f && f._minMove != null && f._priceScale) return f._minMove / f._priceScale; } catch (e) {} return null; })()`
  );
  if (!(minTick > 0)) {
    const pricescale = await evaluate(
      `${apiPath}._chartWidget.model().mainSeries().symbolInfo().pricescale`
    );
    if (pricescale && pricescale > 0) minTick = 1 / pricescale;
  }
  if (!(minTick > 0)) {
    throw new Error('Could not determine minTick from price formatter or symbol info');
  }

  const stopLevel = priceToTicks(entryP, sl, minTick);
  const profitLevel = priceToTicks(entryP, tp, minTick);

  const shapeName = dir === 'long' ? 'long_position' : 'short_position';

  const overrides = { stopLevel, profitLevel };
  if (account_size != null) overrides.accountSize = requireFinite(account_size, 'account_size');
  if (risk != null) overrides.risk = requireFinite(risk, 'risk');
  if (lot_size != null) overrides.lotSize = requireFinite(lot_size, 'lot_size');

  const res = await drawShape({
    shape: shapeName,
    points: [{ time: t1, price: entryP }, { time: t2, price: entryP }],
    overrides, _deps,
  });

  const rr = stopLevel > 0 ? Math.round((profitLevel / stopLevel) * 100) / 100 : null;

  return {
    ...res,
    direction: dir,
    side: dir,
    entry_price: entryP,
    stop_loss: sl,
    take_profit: tp,
    risk_reward_ratio: rr,
    r_multiple: rr,
    stop_ticks: stopLevel,
    profit_ticks: profitLevel,
    min_tick: minTick,
    ...(text ? { text_ignored: true } : {}),
  };
}

export async function listDrawings({ _deps } = {}) {
  const { evaluate, getChartApi } = _resolve(_deps);
  const apiPath = await getChartApi();
  const shapes = await evaluate(`
    (function() {
      var api = ${apiPath};
      var all = api.getAllShapes();
      return all.map(function(s) { var price = null, title = ''; try { var shape = api.getShapeById(s.id); if (shape) { try { var pts = shape.getPoints(); if (pts && pts[0] && pts[0].price != null) price = pts[0].price; } catch(e) {} try { var lds = (typeof shape.lineDataSource === 'function') ? shape.lineDataSource() : null; var props = (lds && typeof lds.properties === 'function') ? lds.properties() : null; var t = props ? props.title : undefined; if (typeof t === 'function') { try { t = t(); } catch(e) { t = undefined; } } if (t != null && typeof t === 'object') { try { t = (typeof t.value === 'function') ? t.value() : ((t._value !== undefined) ? t._value : undefined); } catch(e) { t = undefined; } } if (typeof t === 'string') title = t; else if (typeof t === 'number') title = String(t); } catch(e) {} } } catch(e) {} return { id: s.id, name: s.name, price: price, title: title }; });
    })()
  `);
  return { success: true, count: shapes?.length || 0, shapes: shapes || [] };
}

export async function getProperties({ entity_id, _deps }) {
  const { evaluate, getChartApi } = _resolve(_deps);
  const apiPath = await getChartApi();
  const result = await evaluate(`
    (function() {
      var api = ${apiPath};
      var eid = ${safeString(entity_id)};
      var props = { entity_id: eid };
      var shape = api.getShapeById(eid);
      if (!shape) return { error: 'Shape not found: ' + eid };
      var methods = [];
      try { for (var key in shape) { if (typeof shape[key] === 'function') methods.push(key); } props.available_methods = methods; } catch(e) {}
      try { var pts = shape.getPoints(); if (pts) props.points = pts; } catch(e) { props.points_error = e.message; }
      try { var ovr = shape.getProperties(); if (ovr) props.properties = ovr; } catch(e) {
        try { var ovr2 = shape.properties(); if (ovr2) props.properties = ovr2; } catch(e2) { props.properties_error = e2.message; }
      }
      try { props.visible = !shape.isHidden(); } catch(e) {}
      try { props.locked = shape.isLocked(); } catch(e) {}
      try { props.selectable = shape.isSelectionEnabled(); } catch(e) {}
      try {
        var all = api.getAllShapes();
        for (var i = 0; i < all.length; i++) { if (all[i].id === eid) { props.name = all[i].name; break; } }
      } catch(e) {}
      return props;
    })()
  `);
  if (result?.error) throw new Error(result.error);
  return { success: true, ...result };
}

export async function removeOne({ entity_id, _deps }) {
  const { evaluate, getChartApi } = _resolve(_deps);
  const apiPath = await getChartApi();
  const result = await evaluate(`
    (function() {
      var api = ${apiPath};
      var eid = ${safeString(entity_id)};
      var before = api.getAllShapes();
      var found = false;
      for (var i = 0; i < before.length; i++) { if (before[i].id === eid) { found = true; break; } }
      if (!found) return { removed: false, error: 'Shape not found: ' + eid, available: before.map(function(s) { return s.id; }) };
      api.removeEntity(eid);
      var after = api.getAllShapes();
      var stillExists = false;
      for (var j = 0; j < after.length; j++) { if (after[j].id === eid) { stillExists = true; break; } }
      return { removed: !stillExists, entity_id: eid, remaining_shapes: after.length };
    })()
  `);
  if (result?.error) throw new Error(result.error);
  return { success: true, entity_id: result?.entity_id, removed: result?.removed, remaining_shapes: result?.remaining_shapes };
}

export async function clearAll({ _deps } = {}) {
  const { evaluate, getChartApi } = _resolve(_deps);
  const apiPath = await getChartApi();
  await evaluate(`${apiPath}.removeAllShapes()`);
  return { success: true, action: 'all_shapes_removed' };
}
