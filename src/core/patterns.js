/**
 * Candlestick pattern detection over OHLCV bar arrays.
 *
 * Pure functions: no CDP, no network. Each detector takes (bars, i) and
 * returns null or { pattern, direction, strength } where strength is in
 * [0, 1]. Higher = cleaner match.
 *
 * Bar shape: { time, open, high, low, close, volume }
 */

const TREND_LOOKBACK = 5;
const TREND_THRESHOLD = 0.005;

function _shape(bar) {
  const range = bar.high - bar.low;
  if (!(range > 0) || !Number.isFinite(range)) return null;
  const body = Math.abs(bar.close - bar.open);
  const upperShadow = bar.high - Math.max(bar.open, bar.close);
  const lowerShadow = Math.min(bar.open, bar.close) - bar.low;
  const bullish = bar.close > bar.open;
  const bearish = bar.close < bar.open;
  return {
    range,
    body,
    upperShadow,
    lowerShadow,
    bullish,
    bearish,
    bodyPct: body / range,
    upperPct: upperShadow / range,
    lowerPct: lowerShadow / range,
    midpoint: (bar.open + bar.close) / 2,
  };
}

function _trendBefore(bars, i) {
  if (i < TREND_LOOKBACK) return 'unknown';
  const start = bars[i - TREND_LOOKBACK].close;
  const end = bars[i - 1].close;
  if (!(start > 0)) return 'unknown';
  const drift = (end - start) / start;
  if (drift > TREND_THRESHOLD) return 'up';
  if (drift < -TREND_THRESHOLD) return 'down';
  return 'flat';
}

// ── Single-bar patterns ──────────────────────────────────────────────────

function detectDoji(bars, i) {
  const s = _shape(bars[i]);
  if (!s) return null;
  if (s.bodyPct > 0.1) return null;
  const strength = 1 - s.bodyPct / 0.1;
  return { pattern: 'doji', direction: 'neutral', strength: +strength.toFixed(2) };
}

function detectHammer(bars, i) {
  const s = _shape(bars[i]);
  if (!s) return null;
  if (s.bodyPct > 0.35) return null;
  if (s.lowerShadow < 2 * s.body) return null;
  if (s.upperPct > 0.1) return null;
  if (_trendBefore(bars, i) !== 'down') return null;
  const strength = Math.min(1, s.lowerShadow / (3 * Math.max(s.body, s.range * 0.05)));
  return { pattern: 'hammer', direction: 'bullish', strength: +strength.toFixed(2) };
}

function detectHangingMan(bars, i) {
  const s = _shape(bars[i]);
  if (!s) return null;
  if (s.bodyPct > 0.35) return null;
  if (s.lowerShadow < 2 * s.body) return null;
  if (s.upperPct > 0.1) return null;
  if (_trendBefore(bars, i) !== 'up') return null;
  const strength = Math.min(1, s.lowerShadow / (3 * Math.max(s.body, s.range * 0.05)));
  return { pattern: 'hanging_man', direction: 'bearish', strength: +strength.toFixed(2) };
}

function detectInvertedHammer(bars, i) {
  const s = _shape(bars[i]);
  if (!s) return null;
  if (s.bodyPct > 0.35) return null;
  if (s.upperShadow < 2 * s.body) return null;
  if (s.lowerPct > 0.1) return null;
  if (_trendBefore(bars, i) !== 'down') return null;
  const strength = Math.min(1, s.upperShadow / (3 * Math.max(s.body, s.range * 0.05)));
  return { pattern: 'inverted_hammer', direction: 'bullish', strength: +strength.toFixed(2) };
}

function detectShootingStar(bars, i) {
  const s = _shape(bars[i]);
  if (!s) return null;
  if (s.bodyPct > 0.35) return null;
  if (s.upperShadow < 2 * s.body) return null;
  if (s.lowerPct > 0.1) return null;
  if (_trendBefore(bars, i) !== 'up') return null;
  const strength = Math.min(1, s.upperShadow / (3 * Math.max(s.body, s.range * 0.05)));
  return { pattern: 'shooting_star', direction: 'bearish', strength: +strength.toFixed(2) };
}

function detectMarubozu(bars, i) {
  const s = _shape(bars[i]);
  if (!s) return null;
  if (s.bodyPct < 0.95) return null;
  const direction = s.bullish ? 'bullish' : s.bearish ? 'bearish' : 'neutral';
  if (direction === 'neutral') return null;
  return { pattern: 'marubozu', direction, strength: +((s.bodyPct - 0.95) / 0.05).toFixed(2) };
}

function detectSpinningTop(bars, i) {
  const s = _shape(bars[i]);
  if (!s) return null;
  if (s.bodyPct > 0.3 || s.bodyPct < 0.1) return null;
  if (s.upperPct < 0.25 || s.lowerPct < 0.25) return null;
  return { pattern: 'spinning_top', direction: 'neutral', strength: 0.7 };
}

// ── Two-bar patterns ─────────────────────────────────────────────────────

function detectBullishEngulfing(bars, i) {
  if (i < 1) return null;
  const prev = _shape(bars[i - 1]);
  const curr = _shape(bars[i]);
  if (!prev || !curr) return null;
  if (!prev.bearish || !curr.bullish) return null;
  if (bars[i].open > bars[i - 1].close) return null;
  if (bars[i].close < bars[i - 1].open) return null;
  if (curr.body <= prev.body) return null;
  const strength = Math.min(1, curr.body / Math.max(prev.body, 1e-9) / 2);
  return { pattern: 'bullish_engulfing', direction: 'bullish', strength: +strength.toFixed(2) };
}

function detectBearishEngulfing(bars, i) {
  if (i < 1) return null;
  const prev = _shape(bars[i - 1]);
  const curr = _shape(bars[i]);
  if (!prev || !curr) return null;
  if (!prev.bullish || !curr.bearish) return null;
  if (bars[i].open < bars[i - 1].close) return null;
  if (bars[i].close > bars[i - 1].open) return null;
  if (curr.body <= prev.body) return null;
  const strength = Math.min(1, curr.body / Math.max(prev.body, 1e-9) / 2);
  return { pattern: 'bearish_engulfing', direction: 'bearish', strength: +strength.toFixed(2) };
}

function detectBullishHarami(bars, i) {
  if (i < 1) return null;
  const prev = _shape(bars[i - 1]);
  const curr = _shape(bars[i]);
  if (!prev || !curr) return null;
  if (!prev.bearish || !curr.bullish) return null;
  if (prev.body < prev.range * 0.4) return null;
  if (bars[i].open <= bars[i - 1].close) return null;
  if (bars[i].close >= bars[i - 1].open) return null;
  return { pattern: 'bullish_harami', direction: 'bullish', strength: 0.7 };
}

function detectBearishHarami(bars, i) {
  if (i < 1) return null;
  const prev = _shape(bars[i - 1]);
  const curr = _shape(bars[i]);
  if (!prev || !curr) return null;
  if (!prev.bullish || !curr.bearish) return null;
  if (prev.body < prev.range * 0.4) return null;
  if (bars[i].open >= bars[i - 1].close) return null;
  if (bars[i].close <= bars[i - 1].open) return null;
  return { pattern: 'bearish_harami', direction: 'bearish', strength: 0.7 };
}

function detectPiercingLine(bars, i) {
  if (i < 1) return null;
  const prev = _shape(bars[i - 1]);
  const curr = _shape(bars[i]);
  if (!prev || !curr) return null;
  if (!prev.bearish || !curr.bullish) return null;
  if (bars[i].open >= bars[i - 1].low) return null;
  if (bars[i].close <= prev.midpoint) return null;
  if (bars[i].close >= bars[i - 1].open) return null;
  return { pattern: 'piercing_line', direction: 'bullish', strength: 0.75 };
}

function detectDarkCloudCover(bars, i) {
  if (i < 1) return null;
  const prev = _shape(bars[i - 1]);
  const curr = _shape(bars[i]);
  if (!prev || !curr) return null;
  if (!prev.bullish || !curr.bearish) return null;
  if (bars[i].open <= bars[i - 1].high) return null;
  if (bars[i].close >= prev.midpoint) return null;
  if (bars[i].close <= bars[i - 1].open) return null;
  return { pattern: 'dark_cloud_cover', direction: 'bearish', strength: 0.75 };
}

// ── Three-bar patterns ───────────────────────────────────────────────────

function detectMorningStar(bars, i) {
  if (i < 2) return null;
  const a = _shape(bars[i - 2]);
  const b = _shape(bars[i - 1]);
  const c = _shape(bars[i]);
  if (!a || !b || !c) return null;
  if (!a.bearish || !c.bullish) return null;
  if (a.body < a.range * 0.5) return null;
  if (b.bodyPct > 0.35) return null;
  if (Math.max(bars[i - 1].open, bars[i - 1].close) > bars[i - 2].close) return null;
  if (bars[i].close < (bars[i - 2].open + bars[i - 2].close) / 2) return null;
  return { pattern: 'morning_star', direction: 'bullish', strength: 0.85 };
}

function detectEveningStar(bars, i) {
  if (i < 2) return null;
  const a = _shape(bars[i - 2]);
  const b = _shape(bars[i - 1]);
  const c = _shape(bars[i]);
  if (!a || !b || !c) return null;
  if (!a.bullish || !c.bearish) return null;
  if (a.body < a.range * 0.5) return null;
  if (b.bodyPct > 0.35) return null;
  if (Math.min(bars[i - 1].open, bars[i - 1].close) < bars[i - 2].close) return null;
  if (bars[i].close > (bars[i - 2].open + bars[i - 2].close) / 2) return null;
  return { pattern: 'evening_star', direction: 'bearish', strength: 0.85 };
}

function detectThreeWhiteSoldiers(bars, i) {
  if (i < 2) return null;
  for (let k = i - 2; k <= i; k++) {
    const s = _shape(bars[k]);
    if (!s || !s.bullish) return null;
    if (s.bodyPct < 0.5) return null;
  }
  if (!(bars[i - 1].close > bars[i - 2].close)) return null;
  if (!(bars[i].close > bars[i - 1].close)) return null;
  if (!(bars[i - 1].open > bars[i - 2].open && bars[i - 1].open < bars[i - 2].close)) return null;
  if (!(bars[i].open > bars[i - 1].open && bars[i].open < bars[i - 1].close)) return null;
  return { pattern: 'three_white_soldiers', direction: 'bullish', strength: 0.9 };
}

function detectThreeBlackCrows(bars, i) {
  if (i < 2) return null;
  for (let k = i - 2; k <= i; k++) {
    const s = _shape(bars[k]);
    if (!s || !s.bearish) return null;
    if (s.bodyPct < 0.5) return null;
  }
  if (!(bars[i - 1].close < bars[i - 2].close)) return null;
  if (!(bars[i].close < bars[i - 1].close)) return null;
  if (!(bars[i - 1].open < bars[i - 2].open && bars[i - 1].open > bars[i - 2].close)) return null;
  if (!(bars[i].open < bars[i - 1].open && bars[i].open > bars[i - 1].close)) return null;
  return { pattern: 'three_black_crows', direction: 'bearish', strength: 0.9 };
}

const DETECTORS = [
  detectDoji,
  detectHammer,
  detectHangingMan,
  detectInvertedHammer,
  detectShootingStar,
  detectMarubozu,
  detectSpinningTop,
  detectBullishEngulfing,
  detectBearishEngulfing,
  detectBullishHarami,
  detectBearishHarami,
  detectPiercingLine,
  detectDarkCloudCover,
  detectMorningStar,
  detectEveningStar,
  detectThreeWhiteSoldiers,
  detectThreeBlackCrows,
];

export const KNOWN_PATTERNS = [
  'doji', 'hammer', 'hanging_man', 'inverted_hammer', 'shooting_star',
  'marubozu', 'spinning_top',
  'bullish_engulfing', 'bearish_engulfing',
  'bullish_harami', 'bearish_harami',
  'piercing_line', 'dark_cloud_cover',
  'morning_star', 'evening_star',
  'three_white_soldiers', 'three_black_crows',
];

export function detectPatternsInBars(bars, { minStrength = 0, patternFilter = null } = {}) {
  if (!Array.isArray(bars) || bars.length === 0) return [];
  const filterTerms = patternFilter
    ? (Array.isArray(patternFilter) ? patternFilter : String(patternFilter).split(',')).map(s => s.trim().toLowerCase()).filter(Boolean)
    : null;
  const hits = [];
  for (let i = 0; i < bars.length; i++) {
    for (const det of DETECTORS) {
      const result = det(bars, i);
      if (!result) continue;
      if (result.strength < minStrength) continue;
      if (filterTerms && !filterTerms.some(t => result.pattern.includes(t))) continue;
      hits.push({
        bar_index: i,
        bars_back: bars.length - 1 - i,
        time: bars[i].time,
        ...result,
      });
    }
  }
  return hits;
}
