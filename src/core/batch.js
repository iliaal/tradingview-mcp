/**
 * Core batch execution logic.
 */
import {
  evaluate as _evaluate,
  evaluateAsync as _evaluateAsync,
  getClient as _getClient,
  getChartApi as _getChartApi,
  getChartCollection as _getChartCollection,
  withReconnect as _withReconnect,
  safeString,
} from '../connection.js';
import { waitForChartReady as _waitForChartReady } from '../wait.js';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { resolveScreenshotDir } from './paths.js';
import { withTimeout as _withTimeout, isCaptureTimeout as _isCaptureTimeout, resolveCaptureTimeoutMs as _resolveCaptureTimeoutMs } from './capture.js';

function _resolve(deps) {
  return {
    evaluate: deps?.evaluate || _evaluate,
    evaluateAsync: deps?.evaluateAsync || _evaluateAsync,
    getClient: deps?.getClient || _getClient,
    getChartApi: deps?.getChartApi || _getChartApi,
    getChartCollection: deps?.getChartCollection || _getChartCollection,
    withReconnect: deps?.withReconnect || _withReconnect,
    waitForChartReady: deps?.waitForChartReady || _waitForChartReady,
    withTimeout: deps?.withTimeout || _withTimeout,
    isCaptureTimeout: deps?.isCaptureTimeout || _isCaptureTimeout,
    resolveCaptureTimeoutMs: deps?.resolveCaptureTimeoutMs || _resolveCaptureTimeoutMs,
  };
}

export async function batchRun({ symbols, timeframes, action, delay_ms, ohlcv_count, output_dir, _deps }) {
  const { evaluate, evaluateAsync, getChartApi, getChartCollection, withReconnect, waitForChartReady, withTimeout, isCaptureTimeout, resolveCaptureTimeoutMs } = _resolve(_deps);
  const tfs = timeframes && timeframes.length > 0 ? timeframes : [null];
  const delay = delay_ms || 2000;
  const results = [];
  const targetDir = action === 'screenshot' ? resolveScreenshotDir(output_dir) : null;

  let colPath, apiPath;
  try { colPath = await getChartCollection(); } catch {}
  try { apiPath = await getChartApi(); } catch {}

  // Most chart-data actions need the chart API; if we couldn't resolve
  // it, fail fast rather than silently pushing {error: ...} as success
  // per iteration.
  if (action === 'get_ohlcv' && !apiPath) {
    throw new Error('batchRun: chart API path is unavailable; cannot run get_ohlcv');
  }

  // Capture the user's view so a multi-symbol sweep doesn't strand them
  // on the last iteration's symbol/timeframe. Restore in finally so a
  // mid-loop throw still leaves the chart where they left it.
  let originalSymbol = null;
  let originalResolution = null;
  try {
    if (apiPath) {
      const snap = await evaluate(`
        (function() {
          try { return { symbol: ${apiPath}.symbol(), resolution: ${apiPath}.resolution() }; }
          catch (e) { return { error: e.message }; }
        })()
      `);
      if (snap && !snap.error) {
        originalSymbol = snap.symbol || null;
        originalResolution = snap.resolution || null;
      }
    }
  } catch { /* best-effort snapshot */ }

  try {
    for (const symbol of symbols) {
      for (const tf of tfs) {
        const combo = { symbol, timeframe: tf };
        try {
          if (colPath) await evaluate(`${colPath}.setSymbol(${safeString(symbol)})`);
          else if (apiPath) await evaluate(`${apiPath}.setSymbol(${safeString(symbol)})`);

          if (tf) {
            if (colPath) await evaluate(`${colPath}.setResolution(${safeString(tf)})`);
            else if (apiPath) await evaluate(`${apiPath}.setResolution(${safeString(tf)})`);
          }

          await waitForChartReady(symbol);
          await new Promise(r => setTimeout(r, delay));

          let actionResult;
          if (action === 'screenshot') {
            // Bound each sweep capture like the single-shot path: a hung frame
            // becomes a per-combo {success:false} entry (no file written),
            // with a single retry on stage-timeout only.
            const timeoutMs = resolveCaptureTimeoutMs();
            const takeShot = () => withTimeout(
              withReconnect(c => c.Page.captureScreenshot({ format: 'png' })),
              timeoutMs,
              'batch Page.captureScreenshot',
            );
            let shot;
            try {
              shot = await takeShot();
            } catch (err) {
              if (!isCaptureTimeout(err)) throw err;
              shot = await takeShot();
            }
            const { data } = shot;
            const ts = new Date().toISOString().replace(/[:.]/g, '-');
            const fname = `batch_${symbol}_${tf || 'default'}_${ts}`.replace(/[/\\]/g, '_') + '.png';
            const filePath = join(targetDir, fname);
            writeFileSync(filePath, Buffer.from(data, 'base64'));
            actionResult = { file_path: filePath };
          } else if (action === 'get_ohlcv' && apiPath) {
            const limit = Math.min(ohlcv_count || 100, 500);
            actionResult = await evaluateAsync(`
              new Promise(function(resolve, reject) {
                ${apiPath}.exportData({ includeTime: true, includeSeries: true, includeStudies: false })
                  .then(function(result) {
                    var bars = (result.data || []).slice(-${limit});
                    resolve({ bar_count: bars.length, last_bar: bars[bars.length - 1] || null });
                  }).catch(reject);
              })
            `);
          } else if (action === 'get_strategy_results') {
            await new Promise(r => setTimeout(r, 1000));
            actionResult = await evaluate(`
              (function() {
                var metrics = {};
                var panel = document.querySelector('[data-name="backtesting"]') || document.querySelector('[class*="strategyReport"]');
                if (!panel) return { error: 'Strategy Tester not found' };
                var items = panel.querySelectorAll('[class*="reportItem"], [class*="metric"]');
                items.forEach(function(item) {
                  var label = item.querySelector('[class*="label"]');
                  var value = item.querySelector('[class*="value"]');
                  if (label && value) metrics[label.textContent.trim()] = value.textContent.trim();
                });
                return { metric_count: Object.keys(metrics).length, metrics: metrics };
              })()
            `);
          } else {
            actionResult = { error: 'Unknown action or API not available: ' + action };
          }
          // If the in-page script returned an explicit error sentinel,
          // surface it as a failed iteration rather than reporting
          // success with an error payload.
          if (actionResult && actionResult.error) {
            results.push({ ...combo, success: false, error: actionResult.error });
          } else {
            results.push({ ...combo, success: true, result: actionResult });
          }
        } catch (err) {
          results.push({ ...combo, success: false, error: err.message });
        }
      }
    }
  } finally {
    if (originalSymbol && apiPath) {
      try { await evaluate(`${apiPath}.setSymbol(${safeString(originalSymbol)})`); } catch {}
      if (originalResolution) {
        try { await evaluate(`${apiPath}.setResolution(${safeString(originalResolution)})`); } catch {}
      }
    }
  }

  const successCount = results.filter(r => r.success).length;
  return {
    success: true,
    total_iterations: results.length,
    successful: successCount,
    failed: results.length - successCount,
    restored_view: originalSymbol ? { symbol: originalSymbol, resolution: originalResolution } : null,
    results,
  };
}
