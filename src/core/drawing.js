/**
 * Core drawing logic.
 */
import { evaluate as _evaluate, getChartApi as _getChartApi, safeString, requireFinite } from '../connection.js';

function _resolve(deps) {
  return { evaluate: deps?.evaluate || _evaluate, getChartApi: deps?.getChartApi || _getChartApi };
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

export async function drawShape({ shape, point, point2, overrides: overridesRaw, text, color, linecolor, linewidth, linestyle, textcolor, fontsize, _deps }) {
  const { evaluate, getChartApi } = _resolve(_deps);
  const overrides = buildOverrides({ overrides: overridesRaw, color, linecolor, linewidth, linestyle, textcolor, fontsize });
  const apiPath = await getChartApi();
  const overridesStr = JSON.stringify(overrides || {});
  const textStr = text ? JSON.stringify(text) : '""';

  const p1time = requireFinite(point.time, 'point.time');
  const p1price = requireFinite(point.price, 'point.price');

  const before = await evaluate(`${apiPath}.getAllShapes().map(function(s) { return s.id; })`);

  if (point2) {
    const p2time = requireFinite(point2.time, 'point2.time');
    const p2price = requireFinite(point2.price, 'point2.price');
    await evaluate(`
      ${apiPath}.createMultipointShape(
        [{ time: ${p1time}, price: ${p1price} }, { time: ${p2time}, price: ${p2price} }],
        { shape: ${safeString(shape)}, overrides: ${overridesStr}, text: ${textStr} }
      )
    `);
  } else {
    await evaluate(`
      ${apiPath}.createShape(
        { time: ${p1time}, price: ${p1price} },
        { shape: ${safeString(shape)}, overrides: ${overridesStr}, text: ${textStr} }
      )
    `);
  }

  await new Promise(r => setTimeout(r, 200));
  const after = await evaluate(`${apiPath}.getAllShapes().map(function(s) { return s.id; })`);
  const newId = (after || []).find(id => !(before || []).includes(id)) || null;

  const result = { success: true, shape, entity_id: newId };

  // Read the style back. A requested override that did not land shows up here
  // instead of only on the chart.
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
          if (!stylesEqual(applied[k], overrides[k])) mismatched.push(k);
        }
        if (mismatched.length) result.style_not_applied = mismatched;
      }
    } catch { /* readback is diagnostic only — never fail the draw over it */ }
  }

  return result;
}

export async function drawPosition({ direction, entry_price, stop_loss, take_profit, entry_time, account_size, risk, lot_size, _deps }) {
  const { evaluate, getChartApi } = _resolve(_deps);

  if (direction !== 'long' && direction !== 'short') {
    throw new Error('direction must be "long" or "short"');
  }

  const entry = requireFinite(entry_price, 'entry_price');
  const sl = requireFinite(stop_loss, 'stop_loss');
  const tp = requireFinite(take_profit, 'take_profit');

  if (direction === 'long') {
    if (sl >= entry) throw new Error('long position: stop_loss must be below entry_price');
    if (tp <= entry) throw new Error('long position: take_profit must be above entry_price');
  } else {
    if (sl <= entry) throw new Error('short position: stop_loss must be above entry_price');
    if (tp >= entry) throw new Error('short position: take_profit must be below entry_price');
  }

  const apiPath = await getChartApi();

  const pricescale = await evaluate(
    `${apiPath}._chartWidget.model().mainSeries().symbolInfo().pricescale`
  );
  if (!pricescale || pricescale <= 0) {
    throw new Error('Could not determine pricescale from symbol info');
  }

  const stopLevel = Math.round(Math.abs(entry - sl) * pricescale);
  const profitLevel = Math.round(Math.abs(tp - entry) * pricescale);

  let time = entry_time;
  if (time == null) {
    const range = await evaluate(`${apiPath}.getVisibleRange()`);
    time = range?.to || Math.floor(Date.now() / 1000);
  }
  time = requireFinite(time, 'entry_time');

  const shapeName = direction === 'long' ? 'long_position' : 'short_position';

  const overrides = { stopLevel, profitLevel };
  if (account_size != null) overrides.accountSize = requireFinite(account_size, 'account_size');
  if (risk != null) overrides.risk = requireFinite(risk, 'risk');
  if (lot_size != null) overrides.lotSize = requireFinite(lot_size, 'lot_size');

  const overridesStr = JSON.stringify(overrides);

  const before = await evaluate(`${apiPath}.getAllShapes().map(function(s) { return s.id; })`);

  await evaluate(`
    ${apiPath}.createShape(
      { time: ${time}, price: ${entry} },
      { shape: ${safeString(shapeName)}, overrides: ${overridesStr} }
    )
  `);

  await new Promise(r => setTimeout(r, 200));
  const after = await evaluate(`${apiPath}.getAllShapes().map(function(s) { return s.id; })`);
  const entityId = (after || []).find(id => !(before || []).includes(id)) || null;

  const rr = stopLevel > 0 ? Math.round((profitLevel / stopLevel) * 100) / 100 : null;

  return {
    success: true,
    direction,
    entity_id: entityId,
    entry_price: entry,
    stop_loss: sl,
    take_profit: tp,
    risk_reward_ratio: rr,
  };
}

export async function listDrawings({ _deps } = {}) {
  const { evaluate, getChartApi } = _resolve(_deps);
  const apiPath = await getChartApi();
  const shapes = await evaluate(`
    (function() {
      var api = ${apiPath};
      var all = api.getAllShapes();
      return all.map(function(s) { return { id: s.id, name: s.name }; });
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
      try { props.visible = shape.isVisible(); } catch(e) {}
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
