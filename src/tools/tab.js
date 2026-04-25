import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/tab.js';

export function registerTabTools(server) {
  server.tool('tab_list', 'List all open TradingView chart tabs. Includes the active Pine script per tab unless include_pine_script is false.', {
    include_pine_script: z.coerce.boolean().optional().describe('Probe each tab for its active Pine script name (adds ~50ms per tab). Default true.'),
  }, async ({ include_pine_script }) => {
    try { return jsonResult(await core.list({ include_pine_script })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('tab_new', 'Open a new chart tab', {}, async () => {
    try { return jsonResult(await core.newTab()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('tab_close', 'Close the current chart tab', {}, async () => {
    try { return jsonResult(await core.closeTab()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('tab_switch', 'Switch to a chart tab by index', {
    index: z.coerce.number().describe('Tab index (0-based, from tab_list)'),
  }, async ({ index }) => {
    try { return jsonResult(await core.switchTab({ index })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('tab_switch_by_name', 'Switch to a chart tab by the Pine script name open in its editor. Exact match first, then substring fallback. Throws with available names when no match.', {
    name: z.string().describe('Pine script name to match against the editor title in each tab'),
  }, async ({ name }) => {
    try { return jsonResult(await core.switchTabByName({ name })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}
