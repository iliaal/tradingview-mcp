/**
 * Smoke tests — src/core/capture.js::captureScreenshot.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, unlinkSync } from 'node:fs';
import { installCdpMocks, resetCdpMocks, fakeCdpClient } from '../helpers/mock-cdp.js';
import { captureScreenshot } from '../../src/core/capture.js';

describe('core/capture.js — smoke', () => {
  const written = [];
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
});
