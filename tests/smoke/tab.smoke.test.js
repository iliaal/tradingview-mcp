/**
 * Smoke tests — src/core/tab.js::list.
 * newTab/closeTab/switchTab flagged: they dispatch real keyboard events
 * and hit http://localhost:9222/json/*, which needs more than a 10-line
 * mock. They belong in a real integration test, not a smoke test.
 */
import { describe, it, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { cleanupConnection } from '../helpers/mock-cdp.js';
import * as tab from '../../src/core/tab.js';

describe('core/tab.js — smoke', () => {
  const realFetch = globalThis.fetch;
  after(cleanupConnection);
  afterEach(() => { globalThis.fetch = realFetch; });

  // Mock CDP factory: returns a fake client whose Runtime.evaluate hands
  // back the configured pine_script name per target.
  function fakeCdpFactory(scriptByTarget) {
    return async ({ target }) => ({
      Runtime: {
        enable: async () => {},
        evaluate: async () => ({ result: { value: scriptByTarget[target] ?? null } }),
      },
      close: async () => {},
    });
  }

  function mockTabsFetch(tabs) {
    globalThis.fetch = async () => ({ json: async () => tabs });
  }

  it('test_list_smoke', async () => {
    mockTabsFetch([
      { id: 't1', type: 'page', title: 'Live stock charts on AAPL', url: 'https://www.tradingview.com/chart/abc123/' },
      { id: 't2', type: 'page', title: 'Chart', url: 'https://www.tradingview.com/chart/xyz789/' },
      { id: 't3', type: 'page', title: 'Some other page', url: 'https://example.com' },
      { id: 'wk1', type: 'worker', url: 'https://www.tradingview.com/chart/' },
    ]);
    const r = await tab.list({ include_pine_script: false });
    assert.equal(r.success, true);
    assert.equal(r.tab_count, 2);
    assert.equal(r.tabs[0].id, 't1');
    assert.equal(r.tabs[0].chart_id, 'abc123');
    assert.equal(r.tabs[1].chart_id, 'xyz789');
  });

  it('test_list_smoke_with_pine_script', async () => {
    mockTabsFetch([
      { id: 't1', type: 'page', title: 'Live stock charts on AAPL', url: 'https://www.tradingview.com/chart/abc123/' },
      { id: 't2', type: 'page', title: 'Chart', url: 'https://www.tradingview.com/chart/xyz789/' },
    ]);
    const r = await tab.list({
      include_pine_script: true,
      _deps: { cdpFactory: fakeCdpFactory({ t1: 'My Strategy', t2: null }) },
    });
    assert.equal(r.success, true);
    assert.equal(r.tab_count, 2);
    assert.equal(r.tabs[0].pine_script, 'My Strategy');
    assert.equal(r.tabs[1].pine_script, null);
  });

  it('test_switchTabByName_smoke_throws_when_no_match', async () => {
    mockTabsFetch([
      { id: 't1', type: 'page', title: 'Chart', url: 'https://www.tradingview.com/chart/abc/' },
    ]);
    await assert.rejects(
      tab.switchTabByName({
        name: 'Nonexistent',
        _deps: { cdpFactory: fakeCdpFactory({ t1: 'Different Script' }) },
      }),
      /No tab found.*Nonexistent.*Available scripts: Different Script/i,
    );
  });

  it('test_switchTabByName_smoke_throws_with_no_pine_scripts', async () => {
    mockTabsFetch([
      { id: 't1', type: 'page', title: 'Chart', url: 'https://www.tradingview.com/chart/abc/' },
    ]);
    await assert.rejects(
      tab.switchTabByName({
        name: 'Anything',
        _deps: { cdpFactory: fakeCdpFactory({ t1: null }) },
      }),
      /No tabs have a Pine script open/i,
    );
  });

  it('test_switchTabByName_smoke_validates_name', async () => {
    await assert.rejects(
      tab.switchTabByName({}),
      /name \(string\) is required/i,
    );
  });
});
