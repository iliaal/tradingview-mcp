import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/drawing.js';

export function registerDrawingTools(server) {
  server.tool('draw_shape', 'Draw a shape/line on the chart. Style it with color/linewidth/linestyle (or a full `overrides` object). The result echoes style_applied — read back from the chart — and lists any style_not_applied keys.', {
    shape: z.string().describe('Shape type: horizontal_line, vertical_line, trend_line, rectangle, text'),
    point: z.object({ time: z.coerce.number(), price: z.coerce.number() }).describe('{ time: unix_timestamp, price: number }'),
    point2: z.object({ time: z.coerce.number(), price: z.coerce.number() }).optional().describe('Second point for two-point shapes (trend_line, rectangle)'),
    text: z.string().optional().describe('Text content for text shapes'),
    color: z.string().optional().describe('Line color, e.g. "#FF80AB" (alias for linecolor)'),
    linecolor: z.string().optional().describe('Line color, e.g. "#FF80AB" (takes precedence over color)'),
    linewidth: z.coerce.number().optional().describe('Line width in px, e.g. 2'),
    linestyle: z.coerce.number().optional().describe('0 = solid, 1 = dotted, 2 = dashed'),
    textcolor: z.string().optional().describe('Label text color, e.g. "#FFFFFF"'),
    fontsize: z.coerce.number().optional().describe('Label font size, e.g. 14'),
    overrides: z.union([z.string(), z.record(z.any())]).optional().describe('Full style override object, or a JSON string of one (e.g. \'{"linecolor": "#ff0000", "linewidth": 2}\'). Wins over the shorthand params above.'),
  }, async ({ shape, point, point2, overrides, text, color, linecolor, linewidth, linestyle, textcolor, fontsize }) => {
    try { return jsonResult(await core.drawShape({ shape, point, point2, overrides, text, color, linecolor, linewidth, linestyle, textcolor, fontsize })); }
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

  server.tool('draw_position', 'Draw a Long or Short position on the chart with entry, take-profit, and stop-loss price levels', {
    direction: z.enum(['long', 'short']).describe('Trade direction'),
    entry_price: z.coerce.number().describe('Entry price level'),
    stop_loss: z.coerce.number().describe('Stop-loss price level'),
    take_profit: z.coerce.number().describe('Take-profit price level'),
    entry_time: z.coerce.number().optional().describe('Unix timestamp for horizontal placement (defaults to latest visible bar)'),
    account_size: z.coerce.number().optional().describe('Account balance for P&L calculation'),
    risk: z.coerce.number().optional().describe('Risk as percentage of account (e.g. 2 for 2%)'),
    lot_size: z.coerce.number().optional().describe('Lot/contract size'),
  }, async ({ direction, entry_price, stop_loss, take_profit, entry_time, account_size, risk, lot_size }) => {
    try { return jsonResult(await core.drawPosition({ direction, entry_price, stop_loss, take_profit, entry_time, account_size, risk, lot_size })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}
