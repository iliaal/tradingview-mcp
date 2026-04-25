/**
 * Core screenshot/capture logic.
 */
import { getClient as _getClient, evaluate as _evaluate, getChartCollection as _getChartCollection } from '../connection.js';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { resolveScreenshotDir } from './paths.js';

function _resolve(deps) {
  return {
    getClient: deps?.getClient || _getClient,
    evaluate: deps?.evaluate || _evaluate,
    getChartCollection: deps?.getChartCollection || _getChartCollection,
  };
}

export async function captureScreenshot({ region, filename, method, output_dir, _deps } = {}) {
  const { getClient, evaluate, getChartCollection } = _resolve(_deps);
  const targetDir = resolveScreenshotDir(output_dir);

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const fname = (filename || `tv_${region || 'full'}_${ts}`).replace(/[/\\]/g, '_');
  const filePath = join(targetDir, `${fname}.png`);

  if (method === 'api') {
    try {
      const colPath = await getChartCollection();
      await evaluate(`${colPath}.takeScreenshot()`);
      return {
        success: true, method: 'api',
        note: 'takeScreenshot() triggered — TradingView will save/show the screenshot via its own UI',
      };
    } catch {
      // Fall through to CDP method
    }
  }

  const client = await getClient();
  let clip = undefined;

  if (region === 'chart') {
    const bounds = await evaluate(`
      (function() {
        var el = document.querySelector('[data-name="pane-canvas"]')
          || document.querySelector('[class*="chart-container"]')
          || document.querySelector('canvas');
        if (!el) return null;
        var rect = el.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      })()
    `);
    if (bounds) clip = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, scale: 1 };
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
    if (bounds) clip = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, scale: 1 };
  }

  const params = { format: 'png' };
  if (clip) params.clip = clip;

  const { data } = await client.Page.captureScreenshot(params);
  writeFileSync(filePath, Buffer.from(data, 'base64'));

  return {
    success: true, method: 'cdp', file_path: filePath, region,
    size_bytes: Buffer.from(data, 'base64').length,
  };
}
