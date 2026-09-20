/**
 * Core screenshot/capture logic.
 */
import { getClient as _getClient, evaluate as _evaluate, getChartCollection as _getChartCollection, withReconnect as _withReconnect } from '../connection.js';
import { waitForChartRender as _waitForChartRender } from '../wait.js';
import { execFile as _execFile } from 'node:child_process';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { resolveScreenshotDir } from './paths.js';

// ── Bounded capture ─────────────────────────────────────────────────
// CDP capture can hang indefinitely against a wedged renderer. Every
// Page.captureScreenshot call races a timeout so a stuck frame degrades
// to a structured stage-tagged error instead of hanging the tool call.
// Override the budget with TV_CAPTURE_TIMEOUT_MS (milliseconds).
export const CAPTURE_TIMEOUT_MS = 20000;

export function resolveCaptureTimeoutMs() {
  const v = Number(process.env.TV_CAPTURE_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : CAPTURE_TIMEOUT_MS;
}

export const PREFLIGHT_TIMEOUT_MS = 7000;

export function resolvePreflightTimeoutMs() {
  const v = Number(process.env.TV_PREFLIGHT_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : PREFLIGHT_TIMEOUT_MS;
}

export function withTimeout(promise, ms, stage) {
  const timeoutMs = ms ?? resolveCaptureTimeoutMs();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`capture timed out during ${stage} after ${timeoutMs}ms`));
    }, timeoutMs);
    if (timer.unref) timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function isCaptureTimeout(err) {
  return !!err?.message?.startsWith('capture timed out during ');
}

// Static AppleScript — no interpolated input, so no injection surface.
const TV_ACTIVATE_SCRIPT = 'tell application "TradingView" to activate';
// Bound for the activation child: the outer preflight race caps the wait,
// but without this the hung osascript process itself would linger and keep
// the CLI alive after capture returns.
const ACTIVATE_CHILD_TIMEOUT_MS = 5000;

// Best-effort window focus before capture. Doubly gated: a healthy
// (visible) tab never shells out, and non-macOS platforms never shell out
// at all (osascript is darwin-only). Every failure is swallowed — focus is
// a nicety, never a capture blocker.
async function bringToFront({ evaluate, execFileFn, platform }) {
  try {
    let visibility = null;
    try {
      visibility = await evaluate('document.visibilityState');
    } catch { return; }
    if (visibility === 'visible') return;
    if ((platform ?? process.platform) !== 'darwin') return;
    await new Promise((resolve) => {
      try {
        execFileFn('osascript', ['-e', TV_ACTIVATE_SCRIPT], { timeout: ACTIVATE_CHILD_TIMEOUT_MS }, () => resolve());
      } catch { resolve(); }
    });
  } catch { /* never block capture on focus */ }
}

function _resolve(deps) {
  return {
    getClient: deps?.getClient || _getClient,
    evaluate: deps?.evaluate || _evaluate,
    getChartCollection: deps?.getChartCollection || _getChartCollection,
    withReconnect: deps?.withReconnect || _withReconnect,
    waitForChartRender: deps?.waitForChartRender || _waitForChartRender,
    execFile: deps?.execFile || _execFile,
    platform: deps?.platform,
  };
}

export async function captureScreenshot({ region, filename, method, output_dir, wait_for_render, _deps } = {}) {
  const { evaluate, getChartCollection, withReconnect, waitForChartRender, execFile, platform } = _resolve(_deps);

  // Opt-in stabilizer for callers that just changed symbol/timeframe and
  // would otherwise capture the previous frame. Default off because most
  // callers shoot a known-stable chart and don't want the extra latency.
  // renderStable: null = not requested, true = stabilized, false = timed out.
  let renderStable = null;
  if (wait_for_render) {
    renderStable = await waitForChartRender();
  }
  const renderTimedOut = renderStable === false;

  if (method === 'api') {
    try {
      const colPath = await getChartCollection();
      await evaluate(`${colPath}.takeScreenshot()`);
      return {
        success: true, method: 'api',
        waited_for_render: !!wait_for_render,
        ...(renderTimedOut && { render_stabilized: false, render_note: 'wait_for_render timed out before the chart stabilized; the frame may be mid-repaint' }),
        note: 'takeScreenshot() triggered — TradingView will save/show the screenshot via its own UI',
      };
    } catch {
      // Fall through to CDP method
    }
  }

  // Resolve the save path only on the CDP path — the api path above never
  // writes a file, so it shouldn't create (or fail validating) a directory.
  const targetDir = resolveScreenshotDir(output_dir);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const fname = (filename || `tv_${region || 'full'}_${ts}`).replace(/[/\\]/g, '_');
  const filePath = join(targetDir, `${fname}.png`);

  let clip = undefined;

  if (region === 'chart') {
    const bounds = await evaluate(`
      (function() {
        var el = document.querySelector('.chart-container.active')
          || document.querySelector('.chart-container')
          || document.querySelector('[class*="chart-container"]')
          || document.querySelector('[data-name="pane-canvas"]')
          || document.querySelector('canvas');
        if (!el) return null;
        var rect = el.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      })()
    `);
    // A present-but-collapsed element has a zero-dimension rect; a zero-size
    // clip makes Page.captureScreenshot throw. Fall back to a full capture.
    if (bounds && bounds.width > 0 && bounds.height > 0) clip = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, scale: 1 };
  } else if (region === 'strategy_tester') {
    const bounds = await evaluate(`
      (function() {
        var el = document.querySelector('[data-name="backtesting"]')
          || document.querySelector('[class*="strategyReport"]');
        if (!el) return null;
        var rect = el.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      })()
    `);
    if (bounds && bounds.width > 0 && bounds.height > 0) clip = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, scale: 1 };
  }
  const params = { format: 'png' };
  if (clip) params.clip = clip;

  // Focus the window first (best-effort, never throws), then bound the CDP
  // round-trip: a wedged renderer must surface as a stage-tagged timeout,
  // not a hung tool call — and it must never leave a partial file behind.
  try {
    await withTimeout(
      bringToFront({ evaluate, execFileFn: execFile, platform }),
      resolvePreflightTimeoutMs(),
      'bringToFront',
    );
  } catch { /* never block capture on focus */ }
  const timeoutMs = resolveCaptureTimeoutMs();
  const attemptCapture = () => withTimeout(
    withReconnect(c => c.Page.captureScreenshot(params)),
    timeoutMs,
    'Page.captureScreenshot',
  );
  let data;
  try {
    ({ data } = await attemptCapture());
  } catch (err) {
    // Single retry on stage-timeout only — any other failure throws at once.
    if (!isCaptureTimeout(err)) throw err;
    ({ data } = await attemptCapture());
  }
  writeFileSync(filePath, Buffer.from(data, 'base64'));

  return {
    success: true, method: 'cdp', file_path: filePath, region,
    waited_for_render: !!wait_for_render,
    ...(renderTimedOut && { render_stabilized: false, render_note: 'wait_for_render timed out before the chart stabilized; the frame may be mid-repaint' }),
    size_bytes: Buffer.from(data, 'base64').length,
  };
}
