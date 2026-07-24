import { z } from 'zod';
import { boolish } from './_validation.js';
import { jsonResult } from './_format.js';
import * as core from '../core/chart.js';

export function registerChartTools(server) {
  server.tool('chart_get_state', 'Get current chart state (symbol, timeframe, chart type, indicators)', {}, async () => {
    try { return jsonResult(await core.getState()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('chart_set_symbol', 'Change the chart symbol', {
    symbol: z.string().describe('Symbol to set (e.g., BTCUSD, AAPL, ES1!, NYMEX:CL1!)'),
    discard_unsaved: boolish.optional().describe('Proceed past an unsaved-changes dialog and lose unsaved Pine/drawing edits (default false — the switch is refused with an UNSAVED_CHANGES error so work is never silently discarded).'),
  }, async ({ symbol, discard_unsaved }) => {
    try { return jsonResult(await core.setSymbol({ symbol, discard_unsaved })); }
    catch (err) { return jsonResult({ success: false, error: err.message, ...(err.code ? { code: err.code } : {}), ...(err.unsaved_changes ? { unsaved_changes: true } : {}) }, true); }
  });

  server.tool('chart_set_timeframe', 'Change the chart timeframe/resolution', {
    timeframe: z.string().describe('Timeframe (e.g., 1, 5, 15, 60, D, W, M)'),
  }, async ({ timeframe }) => {
    try { return jsonResult(await core.setTimeframe({ timeframe })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('chart_set_type', 'Change chart type', {
    chart_type: z.string().describe('Chart type: Bars(0), Candles(1), Line(2), Area(3), Renko(4), Kagi(5), PointAndFigure(6), LineBreak(7), HeikinAshi(8), HollowCandles(9) — pass name or number'),
  }, async ({ chart_type }) => {
    try { return jsonResult(await core.setType({ chart_type })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('chart_manage_indicator', 'Add or remove an indicator/study on the chart. For built-in studies pass the full name (e.g. "Relative Strength Index"). For user-saved Pine scripts, pass the scriptIdPart in "USER;<hash>" form (from pine_list_scripts) — the tool will open the script in the Pine editor and click Add to chart since chart.createStudy() does not accept user scripts directly.', {
    action: z.enum(['add', 'remove']).describe('Action: add or remove'),
    indicator: z.string().optional().describe('Full built-in indicator name (required for add): "Relative Strength Index", "MACD", "Volume", "Moving Average", "Bollinger Bands", "Moving Average Exponential" — short names like RSI/EMA do NOT work. OR user Pine script id in "USER;<hash>" form (from pine_list_scripts). Not needed for remove.'),
    entity_id: z.string().optional().describe('Entity ID (from chart_get_state). Required for remove.'),
    inputs: z.string().optional().describe('JSON string of input overrides for the indicator (e.g., \'{"length": 20}\'). Only honored for built-in studies, not USER; scripts.'),
  }, async ({ action, indicator, entity_id, inputs }) => {
    try {
      if (action === 'add' && !indicator) throw new Error('indicator name is required for add action.');
      return jsonResult(await core.manageIndicator({ action, indicator, entity_id, inputs }));
    }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('chart_remove_studies_by_title', 'Remove all studies/indicators whose name contains the given substring (case-insensitive). Returns matched + removed lists. Useful for cleaning up duplicates or removing by Pine script name without first calling chart_get_state.', {
    title_match: z.string().describe('Case-insensitive substring of study name (e.g., "SMC Engine", "Volume Profile")'),
  }, async ({ title_match }) => {
    try { return jsonResult(await core.removeStudiesByTitle({ title_match })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('chart_get_visible_range', 'Get the visible date range (unix timestamps) and bars range on the chart', {}, async () => {
    try { return jsonResult(await core.getVisibleRange()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('chart_set_visible_range', 'Zoom the chart to a specific date range (unix seconds). When `from` predates the loaded bar buffer, TV silently clamps the zoom; `auto_extend_cache=true` (default) detects the clamp and briefly enters replay mode at `from` to preload historical bars, then retries. Response carries `cache_extended` + final `clamped` flag.', {
    from: z.coerce.number().describe('Start of range (unix timestamp in seconds)'),
    to: z.coerce.number().describe('End of range (unix timestamp in seconds)'),
    auto_extend_cache: boolish.optional().describe('Default true. When the requested range pre-dates the loaded bar buffer, auto-preload via brief replay-mode entry.'),
  }, async ({ from, to, auto_extend_cache }) => {
    try { return jsonResult(await core.setVisibleRange({ from, to, auto_extend_cache })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('chart_scroll_to_date', 'Jump the chart view to center on a specific date', {
    date: z.string().describe('ISO date string (e.g., "2024-01-15") or unix timestamp as a string'),
  }, async ({ date }) => {
    try { return jsonResult(await core.scrollToDate({ date })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('symbol_info', 'Get detailed metadata about the current symbol (name, exchange, type, description)', {}, async () => {
    try { return jsonResult(await core.symbolInfo()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('symbol_search', 'Search for symbols by name or keyword', {
    query: z.string().describe('Search query (e.g., "AAPL", "crude oil", "ES")'),
    type: z.string().optional().describe('Filter by type (e.g., "stock", "futures", "crypto", "forex")'),
  }, async ({ query, type }) => {
    try { return jsonResult(await core.symbolSearch({ query, type })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}
