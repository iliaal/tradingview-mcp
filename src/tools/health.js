import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/health.js';

export function registerHealthTools(server) {
  server.tool('tv_health_check', 'Check CDP connection to TradingView and return current chart state', {}, async () => {
    try { return jsonResult(await core.healthCheck()); }
    catch (err) { return jsonResult({ success: false, error: err.message, hint: 'TradingView is not running with CDP enabled. Use the tv_launch tool to start it automatically.' }, true); }
  });

  server.tool('tv_discover', 'Report which known TradingView API paths are available and their methods', {}, async () => {
    try { return jsonResult(await core.discover()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('tv_ui_state', 'Get current UI state: which panels are open, what buttons are visible/enabled/disabled', {}, async () => {
    try { return jsonResult(await core.uiState()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('tv_launch', 'Launch TradingView Desktop with Chrome DevTools Protocol (remote debugging) enabled. Auto-detects install location on Mac, Windows, Linux, and Windows MSIX (Microsoft Store) on native or WSL.', {
    port: z.coerce.number().optional().describe('CDP port (default: matches the MCP server\'s configured port, env TV_CDP_PORT or 9222). Passing a non-default port launches TV on that port but the MCP server cannot talk to it without TV_CDP_PORT and a restart.'),
    kill_existing: z.coerce.boolean().optional().describe('Kill existing TradingView instances first (default true)'),
  }, async ({ port, kill_existing }) => {
    try { return jsonResult(await core.launch({ port, kill_existing })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('tv_ensure', 'Ensure TradingView Desktop is running with CDP enabled. Idempotent: no-op if CDP is already up. If TV is running without CDP, kills and relaunches. If TV is not running, launches it. Call this before any TV tool when unsure if CDP is available. Uses the MCP server\'s configured CDP port (default 9222, override via TV_CDP_PORT env var).', {
  }, async () => {
    try { return jsonResult(await core.ensureCDP()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('tv_reconnect', 'Reconnect TradingView Desktop by reloading the page to reclaim the backend session. Use when TV was opened in a browser/phone and the Desktop session went stale.', {}, async () => {
    try { return jsonResult(await core.reconnect()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}
