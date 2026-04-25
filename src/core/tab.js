/**
 * Core tab management logic.
 * Controls TradingView Desktop tabs via CDP and Electron keyboard shortcuts.
 */
import CDP from 'chrome-remote-interface';
import { getClient, evaluate, connectToTarget } from '../connection.js';

const CDP_HOST = process.env.TV_CDP_HOST || 'localhost';
const CDP_PORT = Number(process.env.TV_CDP_PORT) || 9222;

/**
 * Open a short-lived CDP client for a specific target and read its Pine
 * editor's currently-active script name (if any). Returns null when the
 * Pine editor isn't open in that tab or the read fails.
 *
 * Walks the title-button DOM rather than a JS API since the latter requires
 * the React fiber dance our FIND_MONACO does, which is slow per-tab. The
 * title button is a single querySelector; we grab its h2 textContent.
 *
 * cdpFactory is injectable for tests — defaults to chrome-remote-interface's
 * CDP() function.
 */
async function _readActivePineScript(targetId, cdpFactory = CDP) {
  let c;
  try {
    c = await cdpFactory({ host: CDP_HOST, port: CDP_PORT, target: targetId });
    await c.Runtime.enable();
    const { result } = await c.Runtime.evaluate({
      expression: `
        (function() {
          var btn = document.querySelector('[data-qa-id="pine-script-title-button"]');
          if (!btn) return null;
          var h2 = btn.querySelector('h2') || btn;
          var name = (h2.textContent || '').trim();
          return name || null;
        })()
      `,
      returnByValue: true,
    });
    return result?.value || null;
  } catch {
    return null;
  } finally {
    if (c) try { await c.close(); } catch {}
  }
}

/**
 * List all open chart tabs (CDP page targets). Each entry includes the
 * tab's currently-active Pine script name when readable; null when the
 * Pine editor isn't open in that tab.
 *
 * @param {object} opts
 * @param {boolean} [opts.include_pine_script=true] - probe each tab's Pine
 *   title button. Adds ~50ms per tab; pass false for a faster bare list.
 */
export async function list({ include_pine_script = true, _deps } = {}) {
  const cdpFactory = _deps?.cdpFactory || CDP;
  const resp = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/list`);
  const targets = await resp.json();

  const baseTabs = targets
    .filter(t => t.type === 'page' && /tradingview\.com\/chart/i.test(t.url))
    .map((t, i) => ({
      index: i,
      id: t.id,
      title: t.title.replace(/^Live stock.*charts on /, ''),
      url: t.url,
      chart_id: t.url.match(/\/chart\/([^/?]+)/)?.[1] || null,
    }));

  let tabs = baseTabs;
  if (include_pine_script && baseTabs.length > 0) {
    // Fan out per-tab Pine reads in parallel — each is its own
    // short-lived CDP connection so they don't serialize.
    const pineNames = await Promise.all(baseTabs.map(t => _readActivePineScript(t.id, cdpFactory)));
    tabs = baseTabs.map((t, i) => ({ ...t, pine_script: pineNames[i] }));
  }

  return { success: true, tab_count: tabs.length, tabs };
}

/**
 * Open a new chart tab via keyboard shortcut (Ctrl+T / Cmd+T).
 */
export async function newTab() {
  const c = await getClient();

  // Electron/TradingView Desktop uses Ctrl+T for new tab on macOS too
  // But some versions use Cmd+T
  const isMac = process.platform === 'darwin';
  const mod = isMac ? 4 : 2; // 4 = meta (Cmd), 2 = ctrl

  await c.Input.dispatchKeyEvent({
    type: 'keyDown',
    modifiers: mod,
    key: 't',
    code: 'KeyT',
    windowsVirtualKeyCode: 84,
  });
  await c.Input.dispatchKeyEvent({ type: 'keyUp', key: 't', code: 'KeyT' });

  await new Promise(r => setTimeout(r, 2000));

  // Verify a new tab appeared
  const state = await list();
  return { success: true, action: 'new_tab_opened', ...state };
}

/**
 * Close the current tab via keyboard shortcut (Ctrl+W / Cmd+W).
 */
export async function closeTab() {
  const before = await list();
  if (before.tab_count <= 1) {
    throw new Error('Cannot close the last tab. Use tv_launch to restart TradingView instead.');
  }

  const c = await getClient();
  const isMac = process.platform === 'darwin';
  const mod = isMac ? 4 : 2;

  await c.Input.dispatchKeyEvent({
    type: 'keyDown',
    modifiers: mod,
    key: 'w',
    code: 'KeyW',
    windowsVirtualKeyCode: 87,
  });
  await c.Input.dispatchKeyEvent({ type: 'keyUp', key: 'w', code: 'KeyW' });

  await new Promise(r => setTimeout(r, 1000));

  const after = await list();
  return { success: true, action: 'tab_closed', tabs_before: before.tab_count, tabs_after: after.tab_count };
}

/**
 * Switch to a tab by index. Reconnects CDP to the new target.
 */
export async function switchTab({ index }) {
  const tabs = await list({ include_pine_script: false });
  const idx = Number(index);

  if (idx >= tabs.tab_count) {
    throw new Error(`Tab index ${idx} out of range (have ${tabs.tab_count} tabs)`);
  }

  const target = tabs.tabs[idx];

  // Activate the tab visually and reconnect CDP client to the new target.
  // Use CDP Target.activateTarget rather than the /json/activate REST hook —
  // Electron honors the CDP method but ignores the REST call for visual focus
  // changes, so the user sees the tab "switch" but the active widget stays
  // on the previous one until reload.
  try {
    const currentClient = await getClient();
    await currentClient.Target.activateTarget({ targetId: target.id });
    await new Promise(r => setTimeout(r, 500));
    await connectToTarget(target.id);
    return { success: true, action: 'switched', index: idx, tab_id: target.id, chart_id: target.chart_id };
  } catch (e) {
    throw new Error(`Failed to activate tab ${idx}: ${e.message}`);
  }
}

/**
 * Switch to a tab by Pine script name. Useful when tab indices shift across
 * sessions but the user knows the script title in the editor.
 *
 * Strategy: list all tabs (with Pine script reads), find the first whose
 * pine_script matches `name` exactly (case-insensitive), then delegate to
 * switchTab(index). Falls back to substring match if no exact hit. Throws
 * with the available script names when nothing matches.
 */
export async function switchTabByName({ name, _deps } = {}) {
  if (!name || typeof name !== 'string') {
    throw new Error('name (string) is required');
  }
  const tabs = await list({ include_pine_script: true, _deps });
  const target = name.toLowerCase();

  // Exact match first
  let match = tabs.tabs.find(t => (t.pine_script || '').toLowerCase() === target);
  // Fuzzy fallback: substring
  if (!match) {
    match = tabs.tabs.find(t => (t.pine_script || '').toLowerCase().includes(target));
  }

  if (!match) {
    const available = tabs.tabs
      .map(t => t.pine_script)
      .filter(Boolean);
    throw new Error(
      `No tab found with Pine script "${name}". ` +
      (available.length
        ? `Available scripts: ${available.join(', ')}.`
        : `No tabs have a Pine script open.`),
    );
  }

  return switchTab({ index: match.index });
}
