/**
 * Smoke tests — src/core/batch.js::batchRun.
 * Original mukeshyadavus227 batch.smoke depended on src/progress.js which
 * doesn't exist in our fork. This is our own minimal smoke suite focused
 * on the output_dir parameter (B.14) and the basic action dispatch path.
 */
import { describe, it, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installCdpMocks, resetCdpMocks, cleanupConnection, fakeCdpClient } from '../helpers/mock-cdp.js';
import { batchRun } from '../../src/core/batch.js';

describe('core/batch.js — smoke', () => {
  after(cleanupConnection);
  afterEach(() => resetCdpMocks());

  it('test_batchRun_smoke_screenshot_with_output_dir', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'tv-batch-'));
    installCdpMocks({
      getChartApi: async () => 'window.chartApi',
      getChartCollection: async () => 'window.cwc',
      getClient: async () => fakeCdpClient(),
      // waitForChartReady's IIFE shape — return stable so it converges fast
      evaluate: async (expr) => {
        if (typeof expr === 'string' && expr.includes('isLoading')) {
          return { isLoading: false, barCount: 100, currentSymbol: 'AAPL' };
        }
        return undefined;
      },
    });
    try {
      const r = await batchRun({
        symbols: ['AAPL'],
        action: 'screenshot',
        delay_ms: 50,
        output_dir: tmp,
      });
      assert.equal(r.success, true);
      assert.equal(r.total_iterations, 1);
      assert.equal(r.successful, 1);
      const files = readdirSync(tmp);
      assert.equal(files.length, 1, 'one screenshot file written under output_dir');
      assert.ok(files[0].endsWith('.png'));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('test_batchRun_smoke_no_output_dir_creates_default', async () => {
    // When output_dir is omitted, batchRun should still succeed and write
    // to the project's default screenshots dir. Just verify the success
    // path executes — the file ends up in the (real) screenshots dir
    // which we then clean up.
    installCdpMocks({
      getChartApi: async () => 'window.chartApi',
      getChartCollection: async () => 'window.cwc',
      getClient: async () => fakeCdpClient(),
      evaluate: async (expr) => {
        if (typeof expr === 'string' && expr.includes('isLoading')) {
          return { isLoading: false, barCount: 100, currentSymbol: 'MSFT' };
        }
        return undefined;
      },
    });
    const r = await batchRun({
      symbols: ['MSFT'],
      action: 'screenshot',
      delay_ms: 50,
    });
    assert.equal(r.success, true);
    // Cleanup any file we wrote
    for (const item of r.results || []) {
      if (item.result?.file_path) {
        try { rmSync(item.result.file_path); } catch {}
      }
    }
  });
});
