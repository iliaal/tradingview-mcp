import { z } from 'zod';
import { boolish } from './_validation.js';
import { jsonResult } from './_format.js';
import * as core from '../core/alerts.js';

export function registerAlertTools(server) {
  server.tool('alert_create', 'Create a price alert on the active chart symbol via TradingView\'s REST API. Returns the assigned alert_id. Symbol/currency/resolution are inferred from the active chart.', {
    condition: z.string().describe('Alert condition. "crossing" (any direction, default), "greater_than" / "above" / "cross_up" (price crosses upward), "less_than" / "below" / "cross_down" (price crosses downward). For a stop-loss below price use "less_than" / "below" / "cross_down" — plain "crossing" fires in BOTH directions, so a rally back up through a sell level would dispatch a sell. Note a crossing is an EVENT: if price is already beyond the level when the alert is created, it will not fire until price returns across it.'),
    price: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? NaN : v),
      z.coerce.number().refine((n) => Number.isFinite(n), { message: 'price is required and must be a number' }),
    ).describe('Price level for the alert'),
    message: z.string().optional().describe('Alert message. Defaults to "<TICKER> <condition> <price>".'),
    name: z.string().optional().describe('Alert name (shown in TradingView\'s Alert name field, and in the alert list UI).'),
    webhook: z.string().optional().describe('Webhook URL TV will POST the message to when the alert fires. OMIT THIS AND THE ALERT DISPATCHES NOTHING — it fires, updates last_fire_time and shows a popup, but no request is ever sent. Must be a public http(s) URL.'),
    email: boolish.optional().describe('Also send the email notification (default false).'),
    frequency: z.string().optional().describe('How often the alert may fire ("on_first_fire" default).'),
    expiration: z.union([z.string(), z.number()]).optional().describe('Days until expiry, or "never" for open-ended (default 30). A 30-day stop-loss quietly stops existing — pass "never" for protection alerts.'),
    auto_deactivate: boolish.optional().describe('Switch the alert off after it fires (default true). Set false with cross_up/cross_down so it re-arms on the next genuine crossing.'),
  }, async ({ condition, price, message, name, webhook, email, frequency, expiration, auto_deactivate }) => {
    try { return jsonResult(await core.create({ condition, price, message, name, webhook, email, frequency, expiration, auto_deactivate })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('alert_list', 'List active alerts', {}, async () => {
    try { return jsonResult(await core.list()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('alert_delete', 'Delete one or more alerts via REST. Pass alert_id for one, alert_ids for bulk, or delete_all for everything.', {
    alert_id: z.coerce.number().optional().describe('Single alert id to delete (from alert_list).'),
    alert_ids: z.array(z.coerce.number()).optional().describe('Multiple alert ids to delete in one request.'),
    delete_all: boolish.optional().describe('Delete every alert returned by alert_list.'),
  }, async ({ alert_id, alert_ids, delete_all }) => {
    try { return jsonResult(await core.deleteAlerts({ alert_id, alert_ids, delete_all })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('alert_create_indicator', 'Create an indicator alert that fires on a Pine alertcondition() signal (e.g. strategy BUY/SELL). Posts directly to pricealerts.tradingview.com/create_alert with an alert_cond condition. Companion to alert_create (which targets the price-alert dialog). Returns alert_id on success.', {
    pine_id: z.string().describe('Saved Pine script id (e.g. "USER;abc123...") from pine_list_scripts.'),
    alert_cond_id: z.string().describe('Pine plot index of the target alertcondition (e.g. "plot_12"). TV counts plot/plotshape/bgcolor/alertcondition in source order; hline does NOT count. To discover: create one alert manually in the TV UI, then call alert_list and read the alert_cond_id.'),
    inputs: z.record(z.string(), z.any()).describe('Pine input map matching the script\'s input.X declarations in order. Must include `__profile: false` and `pineFeatures` bitset. Example: { pineFeatures: \'{"indicator":1,"plot":1,"ta":1,"alertcondition":1}\', in_0: 14, in_1: 75, __profile: false }'),
    offsets_by_plot: z.record(z.string(), z.number()).describe('Plot offsets map: { plot_0: 0, plot_1: 0, ..., plot_N-1: 0 } where N = the alert_cond_id index. Each plot before the alertcondition needs an entry, all zero is fine.'),
    pine_version: z.string().optional().describe('Saved script version from pine_list_scripts (default "1.0")'),
    symbol: z.string().optional().describe('TV symbol (e.g. "OANDA:USDJPY"). Defaults to active chart.'),
    currency: z.string().optional().describe('currency-id for the symbol marker (e.g. "JPY", "USD"). Defaults to active chart.'),
    resolution: z.string().optional().describe('Timeframe (e.g. "60", "240", "D"). Defaults to active chart.'),
    message: z.string().optional().describe('Alert payload. Supports {{ticker}}, {{close}}, and other TV placeholders. Sent verbatim to web_hook.'),
    web_hook: z.string().optional().describe('Webhook URL TV will POST the message to on fire. Omit for no webhook.'),
    frequency: z.string().optional().describe('"on_bar_close" (default), "once_per_bar", or "all".'),
    expiration_days: z.coerce.number().int().min(1).max(60).optional().describe('Days until auto-expiration (default 30, capped at 60).'),
    active: boolish.optional().describe('Whether the alert starts active (default true).'),
  }, async (args) => {
    try { return jsonResult(await core.createIndicator(args)); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}
