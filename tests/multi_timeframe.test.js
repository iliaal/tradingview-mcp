/**
 * Unit tests for getMultiTimeframe — loop semantics and original-TF restore.
 * Uses _deps injection to stub all CDP-touching primitives.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getMultiTimeframe } from '../src/core/data.js';

function makeDeps({ startTf = 'D', failOn = null } = {}) {
  let currentTf = startTf;
  const setCalls = [];
  const evaluate = async (expr) => {
    if (/\.resolution\(\)/.test(expr) && !/setResolution/.test(expr)) return currentTf;
    const setMatch = expr.match(/setResolution\("([^"]+)"/);
    if (setMatch) {
      const tf = setMatch[1];
      setCalls.push(tf);
      if (failOn && tf === failOn) throw new Error(`mock: forced fail on ${tf}`);
      currentTf = tf;
      return null;
    }
    if (/dataWindowView|dataSources/.test(expr)) {
      return [{ name: `MockStudy@${currentTf}`, values: { Plot: '42' } }];
    }
    if (/lastIndex|valueAt/.test(expr)) {
      return {
        bars: [
          { time: 1, open: 100, high: 101, low: 99, close: 100.5, volume: 1000 },
          { time: 2, open: 100.5, high: 102, low: 100, close: 101.5, volume: 1100 },
        ],
        total_bars: 2,
        source: 'direct_bars',
      };
    }
    return undefined;
  };
  const waitForChartReady = async () => true;
  const waitForStudiesReady = async () => true;
  return {
    deps: { evaluate, waitForChartReady, waitForStudiesReady },
    getCurrentTf: () => currentTf,
    setCalls,
  };
}

describe('getMultiTimeframe', () => {
  it('iterates timeframes and aggregates per-TF results', async () => {
    const { deps, setCalls } = makeDeps({ startTf: 'D' });
    const result = await getMultiTimeframe({
      timeframes: ['W', 'D', '60'],
      include_ohlcv: false,
      _deps: deps,
    });
    assert.equal(result.success, true);
    assert.equal(result.original_timeframe, 'D');
    assert.deepEqual(result.timeframes, ['W', 'D', '60']);
    assert.equal(Object.keys(result.results).length, 3);
    assert.ok(result.results['W'].studies.length > 0);
    assert.ok(result.results['60'].studies.length > 0);
    assert.ok(setCalls.includes('W'));
    assert.ok(setCalls.includes('D'));
    assert.ok(setCalls.includes('60'));
  });

  it('restores the original timeframe when not last in list', async () => {
    const { deps, getCurrentTf } = makeDeps({ startTf: 'D' });
    await getMultiTimeframe({
      timeframes: ['W', '60', '15'],
      include_ohlcv: false,
      _deps: deps,
    });
    assert.equal(getCurrentTf(), 'D', 'should restore original TF');
  });

  it('does not redundantly set TF when original is last in list', async () => {
    const { deps, setCalls } = makeDeps({ startTf: 'D' });
    await getMultiTimeframe({
      timeframes: ['W', '60', 'D'],
      include_ohlcv: false,
      _deps: deps,
    });
    assert.equal(setCalls[setCalls.length - 1], 'D');
    assert.equal(setCalls.filter(t => t === 'D').length, 1, 'no extra restore call');
  });

  it('captures errors per-timeframe without aborting the loop', async () => {
    const { deps, getCurrentTf } = makeDeps({ startTf: 'D', failOn: '60' });
    const result = await getMultiTimeframe({
      timeframes: ['W', '60', '15'],
      include_ohlcv: false,
      _deps: deps,
    });
    assert.ok(result.results['W']);
    assert.ok(result.results['15']);
    assert.ok(result.errors['60']);
    assert.equal(getCurrentTf(), 'D', 'still restores after partial failure');
  });

  it('includes price summary by default', async () => {
    const { deps } = makeDeps({ startTf: 'D' });
    const result = await getMultiTimeframe({
      timeframes: ['D'],
      _deps: deps,
    });
    assert.ok(result.results['D'].price);
    assert.equal(typeof result.results['D'].price.close, 'number');
  });

  it('rejects empty timeframes list', async () => {
    const { deps } = makeDeps();
    await assert.rejects(
      () => getMultiTimeframe({ timeframes: [], _deps: deps }),
      /timeframes is required/
    );
  });

  it('rejects more than 10 timeframes', async () => {
    const { deps } = makeDeps();
    await assert.rejects(
      () => getMultiTimeframe({ timeframes: Array(11).fill('D'), _deps: deps }),
      /Maximum 10/
    );
  });

  it('accepts comma-separated string', async () => {
    const { deps } = makeDeps({ startTf: 'D' });
    const result = await getMultiTimeframe({
      timeframes: 'W, D, 60',
      include_ohlcv: false,
      _deps: deps,
    });
    assert.deepEqual(result.timeframes, ['W', 'D', '60']);
  });
});
