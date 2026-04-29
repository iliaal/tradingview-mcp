/**
 * Unit tests for src/core/scanner.js + src/core/hotlist.js.
 * Pure logic, no CDP — hotlist tests inject a mock evaluateAsync via _deps.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  exchangeToScannerCountry,
  scannerScanUrl,
  scannerPresetUrl,
  SCANNER_COUNTRIES,
} from '../src/core/scanner.js';
import { getHotlist, HOTLIST_SLUGS } from '../src/core/hotlist.js';

describe('scanner — exchange→country mapping', () => {
  it('maps US exchanges to america', () => {
    assert.equal(exchangeToScannerCountry('NASDAQ:NVDA'), 'america');
    assert.equal(exchangeToScannerCountry('NYSE:JPM'), 'america');
    assert.equal(exchangeToScannerCountry('BATS:TSLA'), 'america');
  });

  it('maps crypto exchanges to crypto', () => {
    assert.equal(exchangeToScannerCountry('BINANCE:BTCUSDT'), 'crypto');
    assert.equal(exchangeToScannerCountry('COINBASE:ETHUSD'), 'crypto');
  });

  it('maps forex providers to forex', () => {
    assert.equal(exchangeToScannerCountry('OANDA:XAUUSD'), 'forex');
    assert.equal(exchangeToScannerCountry('FX_IDC:EURUSD'), 'forex');
  });

  it('maps futures to futures', () => {
    assert.equal(exchangeToScannerCountry('CME:ES1!'), 'futures');
    assert.equal(exchangeToScannerCountry('NYMEX:CL1!'), 'futures');
  });

  it('maps known regional exchanges correctly', () => {
    assert.equal(exchangeToScannerCountry('LSE:HSBA'), 'uk');
    assert.equal(exchangeToScannerCountry('XETR:BMW'), 'germany');
    assert.equal(exchangeToScannerCountry('TSE:7203'), 'japan');
    assert.equal(exchangeToScannerCountry('ASX:CBA'), 'australia');
  });

  it('falls back to america for unknown prefix or no prefix', () => {
    assert.equal(exchangeToScannerCountry('FOO:BAR'), 'america');
    assert.equal(exchangeToScannerCountry('AAPL'), 'america');
    assert.equal(exchangeToScannerCountry(''), 'america');
  });

  it('builds correct URLs', () => {
    assert.equal(scannerScanUrl('NASDAQ:AAPL'), 'https://scanner.tradingview.com/america/scan');
    assert.equal(scannerScanUrl('BINANCE:BTCUSDT'), 'https://scanner.tradingview.com/crypto/scan');
    assert.equal(
      scannerPresetUrl('volume_gainers'),
      'https://scanner.tradingview.com/presets/US_volume_gainers?label-product=right-hotlists'
    );
  });

  it('exports SCANNER_COUNTRIES list', () => {
    assert.ok(SCANNER_COUNTRIES.includes('america'));
    assert.ok(SCANNER_COUNTRIES.includes('crypto'));
    assert.ok(SCANNER_COUNTRIES.includes('forex'));
  });
});

function mockEvaluateAsync(response) {
  const calls = [];
  const fn = async (expr) => {
    calls.push(expr);
    return typeof response === 'function' ? response(expr) : response;
  };
  fn.calls = calls;
  return fn;
}

describe('getHotlist — input validation', () => {
  it('rejects missing slug', async () => {
    const result = await getHotlist({});
    assert.equal(result.success, false);
    assert.match(result.error, /slug is required/);
  });

  it('rejects unknown slug', async () => {
    const result = await getHotlist({ slug: 'nonexistent_thing' });
    assert.equal(result.success, false);
    assert.match(result.error, /Unknown slug/);
    assert.match(result.error, /volume_gainers/);
  });

  it('strips US_ prefix from slug', async () => {
    const evalFn = mockEvaluateAsync({
      ok: true, status: 200, body: '', json: { totalCount: 0, fields: [], symbols: [] },
    });
    const result = await getHotlist({ slug: 'US_volume_gainers', _deps: { evaluateAsync: evalFn } });
    assert.equal(result.success, true);
    assert.equal(result.slug, 'volume_gainers');
  });

  it('exports HOTLIST_SLUGS list', () => {
    assert.ok(HOTLIST_SLUGS.includes('volume_gainers'));
    assert.ok(HOTLIST_SLUGS.includes('percent_change_losers'));
    assert.ok(HOTLIST_SLUGS.includes('gap_gainers'));
  });
});

describe('getHotlist — response shaping', () => {
  it('maps a happy-path response to symbols array', async () => {
    const evalFn = mockEvaluateAsync({
      ok: true,
      status: 200,
      body: '',
      json: {
        totalCount: 1500,
        fields: ['change'],
        symbols: [
          { s: 'NASDAQ:NVDA', f: [12.5] },
          { s: 'NYSE:JPM', f: [3.1] },
          { s: 'BATS:TSLA', f: [-5.7] },
        ],
        time: 1772000000000,
      },
    });
    const result = await getHotlist({
      slug: 'percent_change_gainers',
      _deps: { evaluateAsync: evalFn },
    });
    assert.equal(result.success, true);
    assert.equal(result.slug, 'percent_change_gainers');
    assert.equal(result.total_count, 1500);
    assert.equal(result.field, 'change');
    assert.equal(result.symbols.length, 3);
    assert.deepEqual(result.symbols[0], {
      symbol: 'NASDAQ:NVDA',
      ticker: 'NVDA',
      exchange: 'NASDAQ',
      value: 12.5,
    });
  });

  it('respects limit parameter', async () => {
    const symbols = Array.from({ length: 20 }, (_, i) => ({ s: `NASDAQ:T${i}`, f: [i] }));
    const evalFn = mockEvaluateAsync({
      ok: true,
      status: 200,
      body: '',
      json: { totalCount: 100, fields: ['volume'], symbols, time: 0 },
    });
    const result = await getHotlist({
      slug: 'volume_gainers',
      limit: 5,
      _deps: { evaluateAsync: evalFn },
    });
    assert.equal(result.symbols.length, 5);
  });

  it('caps limit at 20 (TV page size)', async () => {
    const symbols = Array.from({ length: 20 }, (_, i) => ({ s: `NASDAQ:T${i}`, f: [i] }));
    const evalFn = mockEvaluateAsync({
      ok: true, status: 200, body: '', json: { totalCount: 100, fields: ['volume'], symbols },
    });
    const result = await getHotlist({
      slug: 'volume_gainers',
      limit: 50,
      _deps: { evaluateAsync: evalFn },
    });
    assert.equal(result.symbols.length, 20);
  });

  it('handles HTTP error response', async () => {
    const evalFn = mockEvaluateAsync({
      ok: false, status: 503, body: 'Service Unavailable', json: null,
    });
    const result = await getHotlist({
      slug: 'volume_gainers',
      _deps: { evaluateAsync: evalFn },
    });
    assert.equal(result.success, false);
    assert.match(result.error, /HTTP 503/);
  });

  it('handles fetch failure', async () => {
    const evalFn = mockEvaluateAsync({ error: 'NetworkError' });
    const result = await getHotlist({
      slug: 'volume_gainers',
      _deps: { evaluateAsync: evalFn },
    });
    assert.equal(result.success, false);
    assert.equal(result.error, 'NetworkError');
  });

  it('handles missing/malformed body fields gracefully', async () => {
    const evalFn = mockEvaluateAsync({
      ok: true, status: 200, body: '', json: {},
    });
    const result = await getHotlist({
      slug: 'volume_gainers',
      _deps: { evaluateAsync: evalFn },
    });
    assert.equal(result.success, true);
    assert.equal(result.field, null);
    assert.deepEqual(result.symbols, []);
  });

  it('builds the correct URL in the evaluated expression', async () => {
    const evalFn = mockEvaluateAsync({
      ok: true, status: 200, body: '', json: { fields: [], symbols: [] },
    });
    await getHotlist({
      slug: 'gap_gainers',
      _deps: { evaluateAsync: evalFn },
    });
    assert.equal(evalFn.calls.length, 1);
    assert.match(
      evalFn.calls[0],
      /scanner\.tradingview\.com\/presets\/US_gap_gainers\?label-product=right-hotlists/
    );
  });
});
