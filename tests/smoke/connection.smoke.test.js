/**
 * Smoke tests — src/connection.js CDP path helpers and evaluate/getClient.
 * Uses installCdpMocks so we never touch a real CDP socket.
 */
import { describe, it, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { installCdpMocks, resetCdpMocks, cleanupConnection, fakeCdpClient } from '../helpers/mock-cdp.js';
import * as conn from '../../src/connection.js';

describe('connection.js — smoke', () => {
  afterEach(() => resetCdpMocks());
  after(cleanupConnection);

  it('test_getClient_smoke', async () => {
    const fake = fakeCdpClient();
    installCdpMocks({ getClient: async () => fake });
    const c = await conn.getClient();
    assert.equal(c, fake);
  });

  it('test_evaluate_smoke', async () => {
    // Route through full body: mock getClient; Runtime.evaluate returns 42.
    const fake = fakeCdpClient();
    fake.Runtime.evaluate = async () => ({ result: { value: 42 } });
    installCdpMocks({ getClient: async () => fake });
    assert.equal(await conn.evaluate('1 + 41'), 42);
  });

  it('test_evaluateAsync_smoke', async () => {
    installCdpMocks({ evaluateAsync: async (expr) => ({ expr, async: true }) });
    const r = await conn.evaluateAsync('Promise.resolve(1)');
    assert.equal(r.async, true);
    assert.equal(r.expr, 'Promise.resolve(1)');
  });

  it('test_getTargetInfo_smoke', async () => {
    installCdpMocks({ getTargetInfo: async () => ({ id: 'abc', url: 'tv://chart' }) });
    const info = await conn.getTargetInfo();
    assert.equal(info.id, 'abc');
  });

  it('test_getChartApi_smoke', async () => {
    // Exercise verifyAndReturn via evaluate override returning true.
    installCdpMocks({ evaluate: async () => true });
    assert.equal(await conn.getChartApi(), conn.KNOWN_PATHS.chartApi);
  });

  it('test_getChartCollection_smoke', async () => {
    installCdpMocks({ evaluate: async () => true });
    assert.equal(await conn.getChartCollection(), conn.KNOWN_PATHS.chartWidgetCollection);
  });

  it('test_getBottomBar_smoke', async () => {
    installCdpMocks({ evaluate: async () => true });
    assert.equal(await conn.getBottomBar(), conn.KNOWN_PATHS.bottomWidgetBar);
  });

  it('test_getReplayApi_smoke', async () => {
    installCdpMocks({ evaluate: async () => true });
    assert.equal(await conn.getReplayApi(), conn.KNOWN_PATHS.replayApi);
  });

  it('test_getMainSeriesBars_smoke', async () => {
    installCdpMocks({ evaluate: async () => true });
    assert.equal(await conn.getMainSeriesBars(), conn.KNOWN_PATHS.mainSeriesBars);
  });

  it('test_disconnect_smoke', async () => {
    // No client cached — should resolve without throwing.
    await conn.disconnect();
  });
});
