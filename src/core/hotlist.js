/**
 * TradingView Hotlists — public scanner presets.
 *
 * Endpoint: GET https://scanner.tradingview.com/presets/US_{slug}?label-product=right-hotlists
 * Origin  : scanner.tradingview.com (cross-origin from www.tradingview.com).
 *           Simple GET, no custom headers, no credentials needed — returns
 *           JSON without a CORS preflight.
 *
 * Response shape:
 *   {
 *     totalCount: <int>,       // size of the underlying universe, not the page
 *     fields:     [<string>],  // one field per column in f[] (e.g. ["volume"])
 *     symbols:    [{ s: "NASDAQ:NVDA", f: [<value>] }, ...],  // 20 rows max
 *     time:       <ms since epoch, server-side>
 *   }
 *
 * No auth required. Rate limit is generous but not unlimited.
 *
 * Ported from lnv-louis/tradingview-mcp 2026-04-29.
 */
import { evaluateAsync as _evaluateAsync, safeBacktickBody } from '../connection.js';
import { scannerPresetUrl } from './scanner.js';

function _resolve(deps) {
  return { evaluateAsync: deps?.evaluateAsync || _evaluateAsync };
}

const ALLOWED_SLUGS = new Set([
  'volume_gainers',
  'percent_change_gainers', 'percent_change_losers',
  'percent_range_gainers', 'percent_range_losers',
  'gap_gainers', 'gap_losers',
  'percent_gap_gainers', 'percent_gap_losers',
]);

/**
 * Fetch a hotlist by slug.
 * @param {string} slug       One of HOTLIST_SLUGS (without the "US_" prefix).
 * @param {number} limit      Cap returned symbols (default 20, max 20 — TV page size).
 * @returns {Promise<{success, slug, total_count, field, symbols, time}>}
 *   symbols := [{symbol: "NASDAQ:NVDA", ticker: "NVDA", exchange: "NASDAQ", value: <num>}]
 */
export async function getHotlist({ slug, limit = 20, _deps } = {}) {
  if (!slug || typeof slug !== 'string') {
    return { success: false, error: 'slug is required (string)' };
  }
  const s = slug.trim().replace(/^US_/, '');
  if (!ALLOWED_SLUGS.has(s)) {
    return {
      success: false,
      error: `Unknown slug "${slug}". Allowed: ${Array.from(ALLOWED_SLUGS).sort().join(', ')}`,
    };
  }
  const cap = Math.max(1, Math.min(20, Number.isFinite(limit) ? Math.floor(limit) : 20));

  const { evaluateAsync } = _resolve(_deps);
  const url = scannerPresetUrl(safeBacktickBody(s));

  const expr = `
    fetch(\`${url}\`, { method: 'GET' })
      .then(function(r) {
        return r.text().then(function(t) {
          var parsed = null;
          try { parsed = t ? JSON.parse(t) : null; } catch(e) {}
          return { status: r.status, ok: r.ok, body: t, json: parsed };
        });
      })
      .catch(function(e) { return { error: e.message }; })
  `;
  const resp = await evaluateAsync(expr);
  if (!resp || resp.error) {
    return { success: false, error: resp?.error || 'no response', slug: s };
  }
  if (!resp.ok) {
    return {
      success: false,
      error: `HTTP ${resp.status}: ${String(resp.body || '').slice(0, 200)}`,
      slug: s,
    };
  }
  const body = resp.json || {};
  const fields = Array.isArray(body.fields) ? body.fields : [];
  const field = fields[0] || null;
  const rawSymbols = Array.isArray(body.symbols) ? body.symbols.slice(0, cap) : [];
  const symbols = rawSymbols.map((row) => {
    const full = String(row.s || '');
    const [exchange, ticker] = full.includes(':') ? full.split(':') : ['', full];
    const value = Array.isArray(row.f) && row.f.length > 0 ? row.f[0] : null;
    return { symbol: full, ticker, exchange, value };
  });
  return {
    success: true,
    slug: s,
    total_count: Number.isFinite(body.totalCount) ? body.totalCount : null,
    field,
    symbols,
    time: body.time || null,
  };
}

export const HOTLIST_SLUGS = Array.from(ALLOWED_SLUGS).sort();
