import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/data.js';

export function registerDataTools(server) {
  server.tool('data_get_ohlcv', 'Get OHLCV bar data from the chart. Use summary=true for compact stats instead of all bars (saves context).', {
    count: z.coerce.number().optional().describe('Number of bars to retrieve (max 500, default 100)'),
    summary: z.coerce.boolean().optional().describe('Return summary stats (high, low, open, close, avg volume, range) instead of all bars — much smaller output'),
  }, async ({ count, summary }) => {
    try { return jsonResult(await core.getOhlcv({ count, summary })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('data_get_indicator', 'Get indicator/study info and input values', {
    entity_id: z.string().describe('Study entity ID (from chart_get_state)'),
  }, async ({ entity_id }) => {
    try { return jsonResult(await core.getIndicator({ entity_id })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('data_get_strategy_results', 'Get strategy performance metrics from Strategy Tester', {}, async () => {
    try { return jsonResult(await core.getStrategyResults()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('data_get_trades', 'Get trade list from Strategy Tester', {
    max_trades: z.coerce.number().optional().describe('Maximum trades to return'),
  }, async ({ max_trades }) => {
    try { return jsonResult(await core.getTrades({ max_trades })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('data_get_equity', 'Get equity curve data from Strategy Tester', {}, async () => {
    try { return jsonResult(await core.getEquity()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('quote_get', 'Get real-time quote data for a symbol (price, OHLC, volume). Returns source: "active_chart" (symbol matches active chart, includes bid/ask), "scanner_rest" (fast cross-symbol via TV scanner — US equities only), or "chart_switch" (chart was briefly switched to read non-US assets).', {
    symbol: z.string().optional().describe('Symbol to quote (blank = current chart symbol)'),
    route: z.enum(['auto', 'rest', 'chart_switch']).optional().describe('Cross-symbol routing: "auto" (default — scanner REST first, chart-switch fallback), "rest" (scanner only — fails for non-US assets), "chart_switch" (always switch chart, slower but universal and matches active-chart schema including bid/ask).'),
  }, async ({ symbol, route }) => {
    try { return jsonResult(await core.getQuote({ symbol, route })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('depth_get', 'Get order book / DOM (Depth of Market) data from the chart', {}, async () => {
    try { return jsonResult(await core.getDepth()); }
    catch (err) { return jsonResult({ success: false, error: err.message, hint: 'Open the DOM panel in TradingView before using this tool.' }, true); }
  });

  server.tool('data_get_pine_lines', 'Read horizontal price levels drawn by Pine Script indicators (line.new). Returns deduplicated price levels per study. Use study_filter to target a specific indicator.', {
    study_filter: z.string().optional().describe('Substring to match study name (e.g., "Profiler", "NY Levels"). Omit for all.'),
    verbose: z.coerce.boolean().optional().describe('Return raw line data with IDs, coordinates, colors (default false — returns only unique price levels)'),
  }, async ({ study_filter, verbose }) => {
    try { return jsonResult(await core.getPineLines({ study_filter, verbose })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('data_get_pine_labels', 'Read text labels drawn by Pine Script indicators (label.new). Returns text, price (label\'s display y), signal_price (close of the bar where the label was drawn — the actual market price when the signal fired), bar (OHLCV of that bar), and bar_time (unix seconds). Use study_filter to target a specific indicator, and since/until to restrict to a time range.', {
    study_filter: z.string().optional().describe('Substring to match study name. Omit for all.'),
    max_labels: z.coerce.number().optional().describe('Max labels per study (default 50). Set higher if you need all.'),
    verbose: z.coerce.boolean().optional().describe('Return raw label data with IDs, colors, positions (default false — returns text + price + signal_price + bar + bar_time)'),
    since: z.union([z.string(), z.number()]).optional().describe('Only return labels at or after this time. Unix seconds or ISO date string (e.g., "2025-01-15").'),
    until: z.union([z.string(), z.number()]).optional().describe('Only return labels at or before this time. Unix seconds or ISO date string.'),
  }, async ({ study_filter, max_labels, verbose, since, until }) => {
    try { return jsonResult(await core.getPineLabels({ study_filter, max_labels, verbose, since, until })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('data_get_pine_tables', 'Read table data drawn by Pine Script indicators (table.new). Returns formatted text rows per table. Use study_filter to target a specific indicator.', {
    study_filter: z.string().optional().describe('Substring to match study name. Omit for all.'),
  }, async ({ study_filter }) => {
    try { return jsonResult(await core.getPineTables({ study_filter })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('data_get_pine_boxes', 'Read box/zone boundaries drawn by Pine Script indicators (box.new). Returns deduplicated {high, low} price zones. Use study_filter to target a specific indicator.', {
    study_filter: z.string().optional().describe('Substring to match study name. Omit for all.'),
    verbose: z.coerce.boolean().optional().describe('Return all boxes with IDs and coordinates (default false — returns unique price zones)'),
  }, async ({ study_filter, verbose }) => {
    try { return jsonResult(await core.getPineBoxes({ study_filter, verbose })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('data_get_pine_shapes', 'Read plotshape/plotchar markers from Pine Script indicators. Returns which bars have active shape signals (triangles, diamonds, squares, circles, labels) with OHLC data. Use study_filter to target a specific indicator.', {
    study_filter: z.string().optional().describe('Substring to match study name (e.g., "Flow Matrix"). Omit for all.'),
    last_n_bars: z.coerce.number().optional().describe('Number of recent bars to scan (default 100, max 500)'),
  }, async ({ study_filter, last_n_bars }) => {
    try { return jsonResult(await core.getPineShapes({ study_filter, last_n_bars })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('data_get_study_values', 'Get current indicator values from the data window for all visible studies (RSI, MACD, Bollinger Bands, EMAs, custom indicators with plot()). Use study_filter to target one indicator by name substring.', {
    study_filter: z.string().optional().describe('Substring to match study name (e.g., "RSI", "MACD"). Omit for all studies.'),
  }, async ({ study_filter }) => {
    try { return jsonResult(await core.getStudyValues({ study_filter })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('data_get_multi_timeframe', 'Read indicator values + price summary across multiple timeframes in a single call. Saves current timeframe, iterates the list, restores original. Useful for top-down analysis (W→D→4H→1H→15m alignment). Requires the same indicators to be loaded on the chart.', {
    timeframes: z.union([z.array(z.string()), z.string()]).describe('Array or comma-separated list of timeframes (e.g., ["W","D","240","60","15"] or "D,60,15"). Max 10.'),
    study_filter: z.string().optional().describe('Substring to match study name (e.g., "RSI"). Omit for all studies.'),
    include_ohlcv: z.coerce.boolean().optional().describe('Include compact price summary per timeframe (default true)'),
  }, async ({ timeframes, study_filter, include_ohlcv }) => {
    try { return jsonResult(await core.getMultiTimeframe({ timeframes, study_filter, include_ohlcv })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('data_detect_candlestick_patterns', 'Detect classic candlestick patterns (doji, hammer, engulfing, morning/evening star, three white soldiers, etc.) over recent bars on the current chart. Native scan over OHLC — no chart pollution, no Pine indicator required. 17 patterns supported.', {
    last_n_bars: z.coerce.number().optional().describe('How many recent bars to scan (default 100, min 3, max 500)'),
    min_strength: z.coerce.number().optional().describe('Filter by minimum pattern strength 0..1 (default 0 = include all)'),
    pattern_filter: z.union([z.array(z.string()), z.string()]).optional().describe('Restrict to specific patterns by substring (e.g., ["engulfing","hammer"] or "star,doji"). Omit for all.'),
  }, async ({ last_n_bars, min_strength, pattern_filter }) => {
    try { return jsonResult(await core.detectCandlestickPatterns({ last_n_bars, min_strength, pattern_filter })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}
