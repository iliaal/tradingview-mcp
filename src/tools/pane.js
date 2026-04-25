import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/pane.js';
import * as dataCore from '../core/data.js';

export function registerPaneTools(server) {
  server.tool('pane_list', 'List all chart panes in the current layout with their symbols and active state', {}, async () => {
    try { return jsonResult(await core.list()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pane_set_layout', 'Change the chart grid layout (e.g., single, 2x2, 2h, 3v)', {
    layout: z.string().describe('Layout code: s (single), 2h, 2v, 2-1, 1-2, 3h, 3v, 4 (2x2), 6, 8. Also accepts: single, 2x1, 1x2, 2x2, quad'),
  }, async ({ layout }) => {
    try { return jsonResult(await core.setLayout({ layout })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pane_focus', 'Focus a specific chart pane by index (0-based)', {
    index: z.coerce.number().describe('Pane index (0-based, from pane_list)'),
  }, async ({ index }) => {
    try { return jsonResult(await core.focus({ index })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pane_set_symbol', 'Set the symbol on a specific pane by index', {
    index: z.coerce.number().describe('Pane index (0-based)'),
    symbol: z.string().describe('Symbol to set (e.g., NQ1!, ES1!, AAPL)'),
  }, async ({ index, symbol }) => {
    try { return jsonResult(await core.setSymbol({ index, symbol })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pane_set_timeframe', 'Set the timeframe on a specific pane by index without focusing it. Useful when prepping a multi-pane grid without disturbing the active pane.', {
    index: z.coerce.number().describe('Pane index (0-based)'),
    timeframe: z.string().describe('Timeframe (e.g., "1", "5", "15", "60", "D", "W", "M")'),
  }, async ({ index, timeframe }) => {
    try { return jsonResult(await core.setTimeframe({ index, timeframe })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pane_read_batch', 'Read data from multiple panes in ONE CDP call. Replaces the pane_focus + data_* per-pane loop over a grid layout. Supports pine_tables/lines/labels/boxes, study_values, ohlcv_summary, and drawings.', {
    indices: z.array(z.coerce.number()).optional().describe('Which panes (0-based). Omit = all panes.'),
    reads: z.object({
      pine_tables:   z.object({ study_filter: z.string().optional() }).optional().describe('Read pine table data. Optional study_filter to target one indicator by name substring.'),
      pine_lines:    z.object({ study_filter: z.string().optional(), verbose: z.boolean().optional() }).optional().describe('Read pine horizontal/level lines.'),
      pine_labels:   z.object({ study_filter: z.string().optional(), max_labels: z.number().optional(), verbose: z.boolean().optional() }).optional().describe('Read pine text labels. max_labels caps per-study (default 50).'),
      pine_boxes:    z.object({ study_filter: z.string().optional(), verbose: z.boolean().optional() }).optional().describe('Read pine box/zone rectangles.'),
      study_values:  z.boolean().optional().describe('Read current values from all visible indicators per pane.'),
      ohlcv_summary: z.union([z.boolean(), z.object({ bars: z.number().optional() })]).optional().describe('Read compact OHLCV summary per pane. Pass { bars: N } to override default 20.'),
      drawings:      z.union([z.boolean(), z.object({ with_properties: z.boolean().optional() })]).optional().describe('Read hand-drawn objects per pane.'),
    }).describe('Which data types to read per pane. At least one must be set.'),
    wait_ms: z.number().optional().describe('Optional sleep before evaluation — insurance after layout/symbol mutations (max 5000).'),
  }, async ({ indices, reads, wait_ms }) => {
    try { return jsonResult(await dataCore.batchReadPanes({ indices, reads, wait_ms })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}
