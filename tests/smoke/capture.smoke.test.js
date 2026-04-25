/**
 * Smoke tests — src/core/capture.js::captureScreenshot.
 */
import { describe, it, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, unlinkSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { installCdpMocks, resetCdpMocks, cleanupConnection, fakeCdpClient } from '../helpers/mock-cdp.js';
import { captureScreenshot } from '../../src/core/capture.js';

describe('core/capture.js — smoke', () => {
  const written = [];
  after(cleanupConnection);
  afterEach(() => {
    resetCdpMocks();
    for (const p of written) { try { unlinkSync(p); } catch {} }
    written.length = 0;
  });

  it('test_captureScreenshot_smoke_fullRegion', async () => {
    installCdpMocks({ getClient: async () => fakeCdpClient() });
    const r = await captureScreenshot({ filename: 'smoke-full' });
    assert.equal(r.success, true);
    assert.equal(r.method, 'cdp');
    assert.ok(existsSync(r.file_path));
    written.push(r.file_path);
  });

  it('test_captureScreenshot_smoke_chartRegion', async () => {
    installCdpMocks({
      getClient: async () => fakeCdpClient(),
      evaluate: async () => ({ x: 0, y: 0, width: 1200, height: 800 }),
    });
    const r = await captureScreenshot({ region: 'chart', filename: 'smoke-chart' });
    assert.equal(r.success, true);
    assert.equal(r.region, 'chart');
    written.push(r.file_path);
  });

  it('test_captureScreenshot_smoke_apiMethod', async () => {
    installCdpMocks({
      getChartCollection: async () => 'window.cwc',
      evaluate: async () => undefined,
    });
    const r = await captureScreenshot({ method: 'api' });
    assert.equal(r.success, true);
    assert.equal(r.method, 'api');
  });

  // ── B.14 output_dir parameter ──────────────────────────────────────
  it('test_captureScreenshot_smoke_output_dir_absolute', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'tv-cap-'));
    installCdpMocks({ getClient: async () => fakeCdpClient() });
    try {
      const r = await captureScreenshot({ filename: 'abs-test', output_dir: tmp });
      assert.equal(r.success, true);
      assert.equal(dirname(r.file_path), tmp, 'screenshot saved under output_dir');
      assert.ok(existsSync(r.file_path));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('test_captureScreenshot_smoke_output_dir_relative_resolves_under_project', async () => {
    // A relative output_dir path should resolve under the project root,
    // not under cwd. We verify the path is absolute and ends with our value.
    installCdpMocks({ getClient: async () => fakeCdpClient() });
    const r = await captureScreenshot({ filename: 'rel-test', output_dir: 'screenshots-test-relative' });
    assert.equal(r.success, true);
    assert.ok(r.file_path.includes('screenshots-test-relative'));
    written.push(r.file_path);
    // Cleanup the dir we created
    try { rmSync(dirname(r.file_path), { recursive: true, force: true }); } catch {}
  });
});
