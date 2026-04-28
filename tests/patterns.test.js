/**
 * Unit tests for src/core/patterns.js — pure OHLC pattern detection.
 * No CDP, no network. Hand-built bar fixtures.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectPatternsInBars, KNOWN_PATTERNS } from '../src/core/patterns.js';

function bar(time, open, high, low, close, volume = 0) {
  return { time, open, high, low, close, volume };
}

function downtrend(n = 6, start = 110) {
  const bars = [];
  for (let i = 0; i < n; i++) {
    const o = start - i;
    bars.push(bar(i, o, o + 0.2, o - 1, o - 0.5));
  }
  return bars;
}

function uptrend(n = 6, start = 100) {
  const bars = [];
  for (let i = 0; i < n; i++) {
    const o = start + i;
    bars.push(bar(i, o, o + 1, o - 0.2, o + 0.5));
  }
  return bars;
}

describe('KNOWN_PATTERNS', () => {
  it('exports a non-empty list of unique pattern names', () => {
    assert.ok(KNOWN_PATTERNS.length >= 15);
    assert.equal(new Set(KNOWN_PATTERNS).size, KNOWN_PATTERNS.length);
  });
});

describe('detectPatternsInBars — single-bar', () => {
  it('detects doji (open ≈ close, balanced shadows)', () => {
    const bars = [bar(0, 100, 105, 95, 100.05)];
    const hits = detectPatternsInBars(bars).filter(h => h.pattern === 'doji');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].direction, 'neutral');
  });

  it('does not flag doji on a strong-body bar', () => {
    const bars = [bar(0, 100, 105, 99, 104.5)];
    const hits = detectPatternsInBars(bars).filter(h => h.pattern === 'doji');
    assert.equal(hits.length, 0);
  });

  it('detects marubozu (full-body bar)', () => {
    const bars = [bar(0, 100, 110.05, 99.95, 110)];
    const hits = detectPatternsInBars(bars).filter(h => h.pattern === 'marubozu');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].direction, 'bullish');
  });

  it('detects hammer only after a downtrend', () => {
    const trend = downtrend(5, 110);
    const hammerBar = bar(5, 105, 105.2, 100, 104.8);
    const hits = detectPatternsInBars([...trend, hammerBar]).filter(h => h.pattern === 'hammer');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].direction, 'bullish');
  });

  it('does not flag hammer in an uptrend (would be hanging_man)', () => {
    const trend = uptrend(5, 100);
    const hammerLikeBar = bar(5, 110, 110.2, 105, 109.8);
    const hits = detectPatternsInBars([...trend, hammerLikeBar]);
    assert.equal(hits.filter(h => h.pattern === 'hammer').length, 0);
    assert.ok(hits.some(h => h.pattern === 'hanging_man'));
  });

  it('detects shooting_star at top of uptrend', () => {
    const trend = uptrend(5, 100);
    const ssBar = bar(5, 109, 114, 108.8, 109.2);
    const hits = detectPatternsInBars([...trend, ssBar]).filter(h => h.pattern === 'shooting_star');
    assert.equal(hits.length, 1);
  });
});

describe('detectPatternsInBars — two-bar', () => {
  it('detects bullish_engulfing', () => {
    const bars = [
      bar(0, 105, 105.5, 102, 103),
      bar(1, 102.5, 107, 102, 106),
    ];
    const hits = detectPatternsInBars(bars).filter(h => h.pattern === 'bullish_engulfing');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].bar_index, 1);
  });

  it('detects bearish_engulfing', () => {
    const bars = [
      bar(0, 100, 103, 99.5, 102),
      bar(1, 102.5, 103, 98, 99),
    ];
    const hits = detectPatternsInBars(bars).filter(h => h.pattern === 'bearish_engulfing');
    assert.equal(hits.length, 1);
  });

  it('detects piercing_line', () => {
    const bars = [
      bar(0, 110, 110.5, 104, 105),
      bar(1, 103, 108.5, 102.5, 108),
    ];
    const hits = detectPatternsInBars(bars).filter(h => h.pattern === 'piercing_line');
    assert.equal(hits.length, 1);
  });

  it('detects dark_cloud_cover', () => {
    const bars = [
      bar(0, 100, 106, 99.5, 105),
      bar(1, 107, 107.5, 100.5, 101),
    ];
    const hits = detectPatternsInBars(bars).filter(h => h.pattern === 'dark_cloud_cover');
    assert.equal(hits.length, 1);
  });
});

describe('detectPatternsInBars — three-bar', () => {
  it('detects three_white_soldiers', () => {
    const bars = [
      bar(0, 100, 103, 99.8, 102.5),
      bar(1, 102, 105, 101.8, 104.5),
      bar(2, 104, 107, 103.8, 106.5),
    ];
    const hits = detectPatternsInBars(bars).filter(h => h.pattern === 'three_white_soldiers');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].bar_index, 2);
  });

  it('detects three_black_crows', () => {
    const bars = [
      bar(0, 110, 110.2, 107.5, 108),
      bar(1, 108.5, 108.7, 105.5, 106),
      bar(2, 106.5, 106.7, 103.5, 104),
    ];
    const hits = detectPatternsInBars(bars).filter(h => h.pattern === 'three_black_crows');
    assert.equal(hits.length, 1);
  });

  it('detects morning_star', () => {
    const bars = [
      bar(0, 110, 110.5, 102, 103),
      bar(1, 102.5, 103, 101.8, 102.5),
      bar(2, 103, 110, 102.8, 109),
    ];
    const hits = detectPatternsInBars(bars).filter(h => h.pattern === 'morning_star');
    assert.equal(hits.length, 1);
  });

  it('detects evening_star', () => {
    const bars = [
      bar(0, 100, 110, 99.5, 109),
      bar(1, 109.5, 110, 109, 109.5),
      bar(2, 109, 109.5, 100, 101),
    ];
    const hits = detectPatternsInBars(bars).filter(h => h.pattern === 'evening_star');
    assert.equal(hits.length, 1);
  });
});

describe('detectPatternsInBars — filtering & robustness', () => {
  it('respects min_strength filter', () => {
    const bars = [bar(0, 100, 100.5, 99.5, 100.02)];
    const all = detectPatternsInBars(bars).filter(h => h.pattern === 'doji');
    const filtered = detectPatternsInBars(bars, { minStrength: 0.99 }).filter(h => h.pattern === 'doji');
    assert.equal(all.length, 1);
    assert.equal(filtered.length, 0);
  });

  it('respects pattern_filter substring', () => {
    const bars = [
      ...downtrend(5, 110),
      bar(5, 105, 105.2, 100, 104.8),
    ];
    const all = detectPatternsInBars(bars);
    const onlyHammer = detectPatternsInBars(bars, { patternFilter: ['hammer'] });
    assert.ok(all.length > 0);
    assert.ok(onlyHammer.every(h => h.pattern.includes('hammer')));
  });

  it('handles empty / degenerate input', () => {
    assert.deepEqual(detectPatternsInBars([]), []);
    assert.deepEqual(detectPatternsInBars([bar(0, 5, 5, 5, 5)]), []);
  });

  it('does not throw on bars with high == low', () => {
    const bars = [bar(0, 5, 5, 5, 5), bar(1, 100, 105, 99, 104)];
    assert.doesNotThrow(() => detectPatternsInBars(bars));
  });
});
