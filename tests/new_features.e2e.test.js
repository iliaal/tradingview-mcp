/**
 * E2E validation for behaviors added after 1.1.0 that were committed without
 * being exercised against a live TradingView (commits a3e5160, 7d62d78,
 * e2f4601, 07d8117). Each test calls the actual core wrapper — never an inline
 * re-implementation — so a wrapper regression cannot pass silently (see
 * ~/ai/wiki/debugging/review-traps.md on inline-IIFE tests).
 *
 * Requires TradingView Desktop running with --remote-debugging-port=9222.
 * Run: node --test tests/new_features.e2e.test.js
 *
 * Live-account safety: switches the chart to a throwaway symbol/timeframe for
 * the duration and restores the original on teardown. Performs NO drawing ops
 * (the live chart carries the user's hand-drawn levels). Pine coverage creates
 * exactly one throwaway cloud script and deletes it in teardown.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, rmSync, mkdtempSync } from 'node:fs';

import { connect, evaluate, disconnect, KNOWN_PATHS } from '../src/connection.js';
import * as coreChart from '../src/core/chart.js';
import * as coreData from '../src/core/data.js';
import * as coreCapture from '../src/core/capture.js';
import * as corePine from '../src/core/pine.js';
import { waitForChartRender } from '../src/wait.js';

const CHART_API = KNOWN_PATHS.chartApi;
const THROWAWAY_SYMBOL = 'AAPL';
const THROWAWAY_TF = 'D';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// bare ticker (drop EXCHANGE: prefix) for loose comparison
const bare = (s) => String(s || '').split(':').pop().toUpperCase();

async function activeSymbol() {
  return evaluate(`${CHART_API}.symbol()`);
}
async function activeResolution() {
  return evaluate(`${CHART_API}.resolution()`);
}

// Offline-safe: SKIP_NETWORK_TESTS=1 (used by `npm run test:offline`) skips
// this live-CDP suite instead of failing in before(connect). Wired into
// `npm run test:e2e-all`; see package.json.
const OFFLINE_SKIP = process.env.SKIP_NETWORK_TESTS === '1'
  ? 'requires live TradingView (SKIP_NETWORK_TESTS=1)'
  : false;

describe('TradingView MCP — post-1.1.0 feature E2E', { skip: OFFLINE_SKIP }, () => {
  let originalSymbol;
  let originalTF;
  let tmpShotDir;
  const tempScriptNames = [];

  before(async () => {
    await connect();

    // Reset lingering replay/dialog state so setSymbol/setTimeframe below don't
    // silently no-op behind a blocking modal (same defense the main e2e uses).
    try {
      await evaluate(`
        (function() {
          try {
            var api = window.TradingViewApi && window.TradingViewApi._replayApi;
            if (api) { try { api.stopReplay(); } catch(e) {} try { api.goToRealtime(); } catch(e) {} }
            var col = window.TradingViewApi && window.TradingViewApi._chartWidgetCollection;
            if (col) col._replaySessionState = null;
            var linking = window.TradingViewApi && window.TradingViewApi._activeChartWidgetWV
              && window.TradingViewApi._activeChartWidgetWV.value()
              && window.TradingViewApi._activeChartWidgetWV.value()._chartWidget
              && window.TradingViewApi._activeChartWidgetWV.value()._chartWidget._linking;
            if (linking && linking._chartWidgetCollection) linking._chartWidgetCollection._replaySessionState = null;
          } catch(e) {}
        })()
      `);
    } catch {}

    originalSymbol = await activeSymbol();
    originalTF = await activeResolution();
    assert.ok(originalSymbol, 'captured original symbol');
    assert.ok(originalTF, 'captured original timeframe');

    // Move off the live chart for the destructive symbol/TF churn below.
    await coreChart.setSymbol({ symbol: THROWAWAY_SYMBOL });
    await sleep(800);
    await coreChart.setTimeframe({ timeframe: THROWAWAY_TF });
    await sleep(800);

    tmpShotDir = mkdtempSync(join(tmpdir(), 'tvmcp-shots-'));
  });

  after(async () => {
    // Delete any throwaway Pine scripts created by the slot-rebind test.
    for (const n of tempScriptNames) {
      try { await corePine.deleteScript({ name: n }); } catch { /* best effort */ }
    }
    // Restore the user's original symbol + timeframe.
    try { await coreChart.setSymbol({ symbol: originalSymbol }); } catch {}
    await sleep(800);
    try { await coreChart.setTimeframe({ timeframe: originalTF }); } catch {}
    await sleep(500);
    if (tmpShotDir) { try { rmSync(tmpShotDir, { recursive: true, force: true }); } catch {} }
    try { await disconnect(); } catch {}
  });

  // ── #148 capture_screenshot wait_for_render (a3e5160, e2f4601) ──────────
  describe('capture_screenshot wait_for_render (#148)', () => {
    it('waitForChartRender stabilizes on a settled chart', async () => {
      // Chart has been sitting on AAPL/D since before(); should reach 3 stable
      // polls well inside the timeout.
      const stable = await waitForChartRender(8000);
      assert.equal(stable, true, 'render stabilized on a settled chart');
    });

    it('waitForChartRender returns false when it cannot stabilize in time', async () => {
      // 1ms budget cannot collect 3 consecutive stable polls (200ms apart).
      const stable = await waitForChartRender(1);
      assert.equal(stable, false, 'timeout path returns false, not throw');
    });

    it('captureScreenshot wait_for_render:true echoes waited_for_render and writes a file', async () => {
      const r = await coreCapture.captureScreenshot({ wait_for_render: true, output_dir: tmpShotDir });
      assert.equal(r.success, true);
      assert.equal(r.waited_for_render, true, 'waited_for_render echoed true');
      assert.equal(r.method, 'cdp');
      assert.ok(r.file_path && existsSync(r.file_path), `screenshot written to ${r.file_path}`);
      // A chart that did stabilize must NOT carry the timed-out disclosure.
      assert.equal(r.render_stabilized, undefined, 'no render_stabilized field when it did stabilize');
    });

    it('captureScreenshot wait_for_render:false does not stabilize or disclose', async () => {
      const r = await coreCapture.captureScreenshot({ wait_for_render: false, output_dir: tmpShotDir });
      assert.equal(r.success, true);
      assert.equal(r.waited_for_render, false, 'waited_for_render echoed false');
      assert.equal(r.render_stabilized, undefined, 'no render fields when not requested');
    });

    it('captureScreenshot discloses render_stabilized:false + note on timeout (cdp path)', async () => {
      // Inject a waiter that times out; the real CDP capture still runs.
      const r = await coreCapture.captureScreenshot({
        wait_for_render: true,
        output_dir: tmpShotDir,
        _deps: { waitForChartRender: async () => false },
      });
      assert.equal(r.success, true);
      assert.equal(r.waited_for_render, true);
      assert.equal(r.render_stabilized, false, 'timeout disclosed');
      assert.match(r.render_note || '', /timed out/i, 'render_note explains the stale-frame risk');
    });

    it('captureScreenshot api path also discloses render_stabilized:false on timeout', async () => {
      const r = await coreCapture.captureScreenshot({
        method: 'api',
        wait_for_render: true,
        _deps: {
          waitForChartRender: async () => false,
          getChartCollection: async () => 'window.__tvmcp_noop',
          evaluate: async () => true,
        },
      });
      assert.equal(r.success, true);
      assert.equal(r.method, 'api');
      assert.equal(r.render_stabilized, false, 'api branch carries the same disclosure');
    });
  });

  // ── chart_set_timeframe resolution readback (07d8117) ───────────────────
  describe('chart_set_timeframe readback', () => {
    after(async () => {
      try { await coreChart.setTimeframe({ timeframe: THROWAWAY_TF }); } catch {}
      await sleep(600);
    });

    it('returns the ACTUAL resolution, requested, and changed:true', async () => {
      const r = await coreChart.setTimeframe({ timeframe: '60' });
      assert.equal(r.success, true);
      assert.equal(r.requested, '60', 'echoes the requested string');
      assert.equal(r.changed, true, 'changed from daily');
      assert.equal(r.timeframe, '60', 'timeframe is the read-back resolution, not the request echo');
      const live = await activeResolution();
      assert.equal(live, '60', 'chart actually moved to 60');
    });

    it('reports changed:false when the timeframe is already set', async () => {
      const r = await coreChart.setTimeframe({ timeframe: '60' });
      assert.equal(r.success, true);
      assert.equal(r.changed, false, 'no-op change reported honestly');
      assert.equal(r.timeframe, '60');
    });
  });

  // ── chart_set_symbol (07d8117) ──────────────────────────────────────────
  describe('chart_set_symbol', () => {
    after(async () => {
      try { await coreChart.setSymbol({ symbol: THROWAWAY_SYMBOL }); } catch {}
      await sleep(800);
    });

    it('switches the active symbol and confirms via read-back', async () => {
      const r = await coreChart.setSymbol({ symbol: 'MSFT' });
      assert.equal(r.success, true, 'setSymbol succeeded');
      const live = await activeSymbol();
      assert.equal(bare(live), 'MSFT', `active chart moved to MSFT (got ${live})`);
    });
  });

  // ── data_get_multi_timeframe restores original TF (07d8117) ──────────────
  describe('data_get_multi_timeframe', () => {
    it('always restores the original timeframe after sweeping', async () => {
      // Park on a distinctive TF first, then sweep others; it must come back.
      await coreChart.setTimeframe({ timeframe: '15' });
      await sleep(800);
      const before = await activeResolution();
      assert.equal(before, '15', 'parked on 15m');

      const r = await coreData.getMultiTimeframe({ timeframes: ['D', '60'], include_ohlcv: true });
      assert.equal(r.success ?? true, true);
      assert.ok(r.timeframes || r.results || r, 'returned per-TF data');

      const restored = await activeResolution();
      assert.equal(restored, '15', `original TF restored after sweep (got ${restored})`);
    });
  });

  // ── cross-symbol reads refuse-vs-strand (07d8117) ───────────────────────
  describe('cross-symbol reads do not strand the chart', () => {
    it('getQuote({symbol}) for a non-active symbol leaves the active chart untouched', async () => {
      const symBefore = await activeSymbol();
      const r = await coreData.getQuote({ symbol: 'TSLA' });
      assert.equal(r.success ?? true, true);
      const symAfter = await activeSymbol();
      assert.equal(bare(symAfter), bare(symBefore), 'active symbol unchanged by cross-symbol quote');
    });

    it('getOhlcv({symbol}) switches, reads, then restores the active symbol', async () => {
      const symBefore = await activeSymbol();
      const r = await coreData.getOhlcv({ symbol: 'TSLA', summary: true });
      assert.equal(r.success ?? true, true);
      assert.equal(r.source, 'chart_switch', 'used the cross-symbol switch path');
      assert.equal(r.restored, true, 'reported restoring the original symbol');
      const symAfter = await activeSymbol();
      assert.equal(bare(symAfter), bare(symBefore), `active symbol restored (got ${symAfter})`);
    });

    it('getOhlcv refuses rather than strand when the current symbol cannot be read', async () => {
      // Inject an evaluate that never yields a symbol: the wrapper must refuse
      // before any setSymbol, so the chart can never be left on the target.
      await assert.rejects(
        () => coreData.getOhlcv({
          symbol: 'TSLA',
          _deps: { evaluate: async () => null, setSymbol: async () => { throw new Error('setSymbol must not run'); } },
        }),
        /Cannot safely read a non-active symbol/,
        'refuses with the strand-guard message',
      );
    });
  });

  // ── #158 pine_open slot rebind (a3e5160, e2f4601) ───────────────────────
  describe('pine_open slot rebind (#158)', () => {
    // KNOWN BROKEN on TV Desktop 3.2.0 — pending the pine_open/pine_save
    // rework (tracked in ~/ai/wiki/vendors/tradingview-desktop.md). Root cause,
    // verified by live CDP probing on 3.2.0.7916:
    //   - pineEditorTestApi().openEditor() instantiates a SEPARATE editor
    //     instance, desynced from the live on-screen Monaco. testApi.openScript
    //     / setEditorText resolve but never touch the live buffer.
    //   - The slot lives at the live Redux store.script.scriptIdPart. The
    //     fetchAndOpenScript thunk CAN rebind it, but its createAsyncThunk
    //     `condition` guard ABORTS ("condition callback returning false") when
    //     the target id already equals the current slot — which newScript
    //     leaves stale, so re-opening the just-saved id silently no-ops.
    //   - Even with the slot rebound (target≠current), the live Monaco text
    //     does not follow, the title button stays "Untitled script", and a
    //     Ctrl+S save does not persist the Monaco buffer to the cloud.
    //   - openScript() nonetheless hardcodes slot_rebound:true whenever the
    //     testApi promise resolves — so it reports success while doing nothing.
    // Un-skip and assert real post-rework behavior once pine_open is fixed.
    const KNOWN_BROKEN_ON_TV_3_2 = true;

    it('rebinds the editor slot to the opened script (deterministic, no save-over)', async (t) => {
      if (KNOWN_BROKEN_ON_TV_3_2) {
        t.skip('pine_open #158 broken on TV 3.2.0 (testApi editor desync; openScript falsely reports slot_rebound:true) — pending pine_open/pine_save rework');
        return;
      }

      const ts = Date.now();
      const tmpName = `ZZ_TMP_REBIND_${ts}`;
      const marker = `// rebind-marker-${ts}`;
      const src = `//@version=6\nindicator("${tmpName}")\n${marker}\nplot(close)\n`;

      // 1) Create the throwaway script and persist it to the cloud.
      await corePine.newScript({ type: 'indicator' });
      await sleep(800);
      await corePine.setSource({ source: src });
      await sleep(800);
      const saved = await corePine.saveAs({ name: tmpName });
      assert.equal(saved.success, true, 'throwaway script saved to cloud');
      tempScriptNames.push(tmpName);
      const savedId = saved.script_id;
      assert.ok(savedId, 'saveAs returned a script id');
      await sleep(800);

      // 2) Unbind the editor from the throwaway by opening a fresh blank buffer.
      await corePine.newScript({ type: 'indicator' });
      await sleep(1000);

      // 3) Re-open the throwaway by id — the behavior under test.
      const opened = await corePine.openScript({ id: savedId });
      assert.equal(opened.success, true, 'openScript succeeded');
      assert.equal(opened.slot_rebound, true, 'pineEditorTestApi rebound the slot (slot_rebound:true)');
      assert.ok(opened.version != null, 'version reported');
      assert.equal(opened.script_id, savedId, 'opened the requested id');
      assert.equal(opened.warning, undefined, 'no unsafe-fallback warning on the testApi path');

      // 4) The editor buffer reflects the opened script.
      await sleep(800);
      const back = await corePine.getSource();
      assert.match(back.source, new RegExp(`rebind-marker-${ts}`), 'editor buffer holds the opened script');

      assert.equal(opened.name?.toLowerCase(), tmpName.toLowerCase(), 'name resolves to the opened script');

      // 5) Proof the SLOT (not just the buffer) rebound: the Pine Editor title
      //    button now shows the opened script's name. A bare Monaco setValue
      //    leaves the title — and thus the save target — on the blank buffer;
      //    the pineEditorTestApi rebind updates it.
      const titleText = await evaluate(`
        (function() {
          var b = document.querySelector('[data-qa-id="pine-script-title-button"]');
          if (!b) return null;
          var h = b.querySelector('h2') || b;
          return (h.textContent || '').trim();
        })()
      `);
      assert.ok(titleText, 'pine-script title button found');
      assert.ok(
        titleText.toLowerCase().includes(tmpName.toLowerCase()),
        `editor title reflects the rebound slot (got "${titleText}")`,
      );
    });
  });
});
