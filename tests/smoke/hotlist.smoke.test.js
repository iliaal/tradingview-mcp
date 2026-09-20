/**
 * Smoke tests — src/core/hotlist.js via the shared CDP-mock helper.
 *
 * Unlike tests/hotlist.test.js (which injects evaluateAsync through _deps),
 * this file exercises the production wiring: getHotlist() with no _deps, so
 * the call flows through src/connection.js evaluateAsync into the mocks
 * installed by installCdpMocks. A refactor that renames the connection
 * import or drops the override gate fails here even if the _deps tests pass.
 */
import { describe, it, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { installCdpMocks, resetCdpMocks, cleanupConnection } from '../helpers/mock-cdp.js';
import { getHotlist, HOTLIST_SLUGS } from '../../src/core/hotlist.js';

const HAPPY_BODY = {
  totalCount: 1500,
  fields: ['change'],
  symbols: [
    { s: 'NASDAQ:NVDA', f: [12.5] },
    { s: 'NYSE:JPM', f: [3.1] },
  ],
  time: 1772000000000,
};

function installHappy() {
  const calls = [];
  installCdpMocks({
    evaluateAsync: async (expr) => {
      calls.push(expr);
      return { ok: true, status: 200, body: '', json: HAPPY_BODY };
    },
  });
  return calls;
}

describe('core/hotlist.js — smoke (CDP-mock wiring)', () => {
  afterEach(() => resetCdpMocks());
  after(cleanupConnection);

  it('test_getHotlist_smoke_happy_path', async () => {
    const calls = installHappy();
    const r = await getHotlist({ slug: 'percent_change_gainers' });
    assert.equal(r.success, true);
    assert.equal(r.slug, 'percent_change_gainers');
    assert.equal(r.total_count, 1500);
    assert.equal(r.field, 'change');
    assert.equal(r.symbols.length, 2);
    assert.deepEqual(r.symbols[0], {
      symbol: 'NASDAQ:NVDA',
      ticker: 'NVDA',
      exchange: 'NASDAQ',
      value: 12.5,
    });
    assert.equal(calls.length, 1);
    assert.match(
      calls[0],
      /scanner\.tradingview\.com\/presets\/US_percent_change_gainers\?label-product=right-hotlists/,
    );
  });

  it('test_getHotlist_smoke_rejects_unknown_slug_before_cdp', async () => {
    const calls = installHappy();
    const r = await getHotlist({ slug: 'nope_not_a_list' });
    assert.equal(r.success, false);
    assert.match(r.error, /Unknown slug/);
    assert.equal(calls.length, 0);
  });

  it('test_getHotlist_smoke_surfaces_fetch_error', async () => {
    installCdpMocks({
      evaluateAsync: async () => ({ error: 'NetworkError' }),
    });
    const r = await getHotlist({ slug: 'volume_gainers' });
    assert.equal(r.success, false);
    assert.equal(r.error, 'NetworkError');
  });

  it('test_hotlist_slugs_smoke_known_set', () => {
    assert.ok(Array.isArray(HOTLIST_SLUGS) && HOTLIST_SLUGS.length > 5);
    assert.ok(HOTLIST_SLUGS.includes('volume_gainers'));
    assert.ok(HOTLIST_SLUGS.includes('percent_change_gainers'));
  });
});
