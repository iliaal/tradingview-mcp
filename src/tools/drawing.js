import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/drawing.js';

export function registerDrawingTools(server) {
  server.tool('draw_shape', 'Draw a shape/line on the chart. Style it with color/linewidth/linestyle (or a full `overrides` object). The result echoes style_applied — read back from the chart — and lists any style_not_applied keys.', {
    shape: z.string().describe(`Shape type. 1-point: ${core.SHAPE_TYPES.one_point.join(', ')}. 2-point: ${core.SHAPE_TYPES.two_point.join(', ')}. N-point: ${core.SHAPE_TYPES.multi_point.join(', ')}. Other TradingView line-tool names pass through.`),
    point: z.object({ time: z.coerce.number(), price: z.coerce.number() }).optional().describe('{ time: unix_timestamp, price: number } (first point; omit when using points)'),
    point2: z.object({ time: z.coerce.number(), price: z.coerce.number() }).optional().describe('Second point for two-point shapes (trend_line, rectangle, fib, volume profile, position)'),
    points: z.array(z.object({ time: z.coerce.number(), price: z.coerce.number() })).optional().describe('Full points array (overrides point/point2; required for 3+ point shapes)'),
    text: z.string().optional().describe('Text content for text shapes'),
    color: z.string().optional().describe('Line color, e.g. "#FF80AB" (alias for linecolor)'),
    linecolor: z.string().optional().describe('Line color, e.g. "#FF80AB" (takes precedence over color)'),
    linewidth: z.coerce.number().optional().describe('Line width in px, e.g. 2'),
    linestyle: z.coerce.number().optional().describe('0 = solid, 1 = dotted, 2 = dashed'),
    textcolor: z.string().optional().describe('Label text color, e.g. "#FFFFFF"'),
    fontsize: z.coerce.number().optional().describe('Label font size, e.g. 14'),
    overrides: z.union([z.string(), z.record(z.any())]).optional().describe('Full style override object, or a JSON string of one (e.g. \'{"linecolor": "#ff0000", "linewidth": 2}\'). Wins over the shorthand params above.'),
  }, async ({ shape, point, point2, points, overrides, text, color, linecolor, linewidth, linestyle, textcolor, fontsize }) => {
    try { return jsonResult(await core.drawShape({ shape, point, point2, points, overrides, text, color, linecolor, linewidth, linestyle, textcolor, fontsize })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('draw_list', 'List all shapes/drawings on the chart', {}, async () => {
    try { return jsonResult(await core.listDrawings()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('draw_clear', 'Remove all drawings from the chart', {}, async () => {
    try { return jsonResult(await core.clearAll()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('draw_remove_one', 'Remove a specific drawing by entity ID', {
    entity_id: z.string().describe('Entity ID of the drawing to remove (from draw_list)'),
  }, async ({ entity_id }) => {
    try { return jsonResult(await core.removeOne({ entity_id })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('draw_get_properties', 'Get properties and points of a specific drawing', {
    entity_id: z.string().describe('Entity ID of the drawing (from draw_list)'),
  }, async ({ entity_id }) => {
    try { return jsonResult(await core.getProperties({ entity_id })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('draw_position', 'Draw a Long or Short position box on the chart with entry, take-profit, and stop-loss price levels. Reports tick counts and the R multiple. `text` is accepted but ignored (position tools reject text payloads).', {
    direction: z.enum(['long', 'short']).describe('Trade direction'),
    entry_price: z.coerce.number().describe('Entry price level'),
    stop_loss: z.coerce.number().describe('Stop-loss price level'),
    take_profit: z.coerce.number().describe('Take-profit price level'),
    entry_time: z.coerce.number().optional().describe('Unix timestamp for the box start (defaults to latest visible bar)'),
    time2: z.coerce.number().optional().describe('Box end timestamp (defaults to entry_time + 1 day)'),
    text: z.string().optional().describe('Accepted but ignored (position tools reject text payloads)'),
    account_size: z.coerce.number().optional().describe('Account balance for P&L calculation'),
    risk: z.coerce.number().optional().describe('Risk as percentage of account (e.g. 2 for 2%)'),
    lot_size: z.coerce.number().optional().describe('Lot/contract size'),
  }, async ({ direction, entry_price, stop_loss, take_profit, entry_time, time2, text, account_size, risk, lot_size }) => {
    try { return jsonResult(await core.drawPosition({ direction, entry_price, stop_loss, take_profit, entry_time, time2, text, account_size, risk, lot_size })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('draw_move', 'Move an existing drawing by replacing its anchor points', {
    entity_id: z.string().describe('Entity ID (from draw_list)'),
    points: z.array(z.object({ time: z.coerce.number(), price: z.coerce.number() })).describe('New points, same count as the shape has'),
  }, async ({ entity_id, points }) => {
    try { return jsonResult(await core.movePoints({ entity_id, points })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('draw_set_properties', 'Change style/properties of an existing drawing (deep-merged)', {
    entity_id: z.string().describe('Entity ID (from draw_list)'),
    properties: z.string().describe('JSON object, keys from draw_get_properties → properties'),
  }, async ({ entity_id, properties }) => {
    try { return jsonResult(await core.setProperties({ entity_id, properties })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('draw_set_visible', 'Show or hide a drawing without deleting it', {
    entity_id: z.string().describe('Entity ID (from draw_list)'),
    visible: z.boolean(),
  }, async ({ entity_id, visible }) => {
    try { return jsonResult(await core.setVisible({ entity_id, visible })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}
