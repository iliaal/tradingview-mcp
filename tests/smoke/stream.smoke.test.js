/**
 * Smoke tests — src/core/stream.js.
 *
 * pollLoop is an infinite poll-and-emit loop in production. _deps lets the
 * test bound iterations (maxIterations), inject a mock evaluate, capture
 * stdout/stderr writes, and replace sleep with a no-op so tests run
 * synchronously instead of waiting real interval ms.
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { cleanupConnection } from '../helpers/mock-cdp.js';
import * as stream from '../../src/core/stream.js';

function makeRecorder({ values, captureExpr } = {}) {
  const stdout = [];
  const stderr = [];
  const seenExprs = [];
  let i = 0;
  const evalSeq = Array.isArray(values) ? values : [values];
  const _deps = {
    evaluate: async (expr) => {
      if (captureExpr) seenExprs.push(String(expr));
      const out = evalSeq[Math.min(i, evalSeq.length - 1)];
      i++;
      return typeof out === 'function' ? out() : out;
    },
    writeStdout: (s) => stdout.push(s),
    writeStderr: (s) => stderr.push(s),
    sleep: async () => {},
    registerSignal: () => {},
    removeSignal: () => {},
  };
  return { _deps, stdout, stderr, seenExprs };
}

describe('core/stream.js — smoke', () => {
  after(cleanupConnection);

  it('test_streamQuote_smoke_emits_jsonl_with_metadata', async () => {
    const { _deps, stdout, stderr } = makeRecorder({
      values: { symbol: 'AAPL', time: 1700000000, open: 100, high: 101, low: 99, close: 100.5, volume: 1234 },
    });
    _deps.maxIterations = 1;
    await stream.streamQuote({ interval: 10, _deps });
    assert.equal(stdout.length, 1);
    const parsed = JSON.parse(stdout[0]);
    assert.equal(parsed.symbol, 'AAPL');
    assert.equal(parsed._stream, 'quote');
    assert.equal(typeof parsed._ts, 'number');
    // Compliance header must show on stderr regardless of evaluate output.
    assert.ok(stderr.some(s => s.includes('Unofficial tool')), 'compliance banner emitted');
  });

  it('test_streamQuote_smoke_dedupe_skips_unchanged_payload', async () => {
    // Same payload three iterations in a row → only the first should hit stdout.
    const payload = { symbol: 'AAPL', time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 };
    const { _deps, stdout } = makeRecorder({ values: [payload, payload, payload] });
    _deps.maxIterations = 3;
    await stream.streamQuote({ interval: 10, _deps });
    assert.equal(stdout.length, 1, 'dedup suppresses repeated identical payloads');
  });

  it('test_streamQuote_smoke_emits_again_when_payload_changes', async () => {
    const { _deps, stdout } = makeRecorder({
      values: [
        { symbol: 'AAPL', time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 },
        { symbol: 'AAPL', time: 1, open: 1, high: 1, low: 1, close: 2, volume: 1 },  // close changed
        { symbol: 'AAPL', time: 1, open: 1, high: 1, low: 1, close: 2, volume: 1 },  // duplicate of #2
      ],
    });
    _deps.maxIterations = 3;
    await stream.streamQuote({ interval: 10, _deps });
    assert.equal(stdout.length, 2, 'first emit + first change emit; the duplicate of #2 is suppressed');
  });

  it('test_streamQuote_smoke_skips_emit_on_null_fetch', async () => {
    const { _deps, stdout } = makeRecorder({ values: null });
    _deps.maxIterations = 2;
    await stream.streamQuote({ interval: 10, _deps });
    assert.equal(stdout.length, 0, 'null fetcher result is not emitted');
  });

  it('test_streamQuote_smoke_recovers_from_cdp_error', async () => {
    const happy = { symbol: 'AAPL', time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 };
    let n = 0;
    const _deps = {
      evaluate: async () => {
        n++;
        if (n === 1) throw new Error('CDP connection lost');
        return happy;
      },
      writeStdout: () => {},
      writeStderr: () => {},
      sleep: async () => {},
      registerSignal: () => {},
      removeSignal: () => {},
      maxIterations: 2,
    };
    // The CDP-shaped error path retries silently — call shouldn't reject.
    await stream.streamQuote({ interval: 10, _deps });
  });

  it('test_streamQuote_smoke_logs_non_cdp_error_to_stderr', async () => {
    const { _deps, stderr } = makeRecorder({
      values: () => { throw new Error('totally unexpected'); },
    });
    _deps.maxIterations = 1;
    await stream.streamQuote({ interval: 10, _deps });
    assert.ok(
      stderr.some(s => s.includes('totally unexpected')),
      'non-CDP errors surface on stderr',
    );
  });

  // Regression: stream.js's Pine line/label readers must use
  // <map>.get(false)._primitivesDataById — same hop the batchReadPanes bug
  // missed. Capture the JS expression and assert the path is present.
  it('test_streamLines_smoke_uses_get_false_unwrap', async () => {
    const { _deps, seenExprs } = makeRecorder({
      values: { symbol: 'AAPL', study_count: 0, studies: [] },
      captureExpr: true,
    });
    _deps.maxIterations = 1;
    await stream.streamLines({ interval: 10, _deps });
    assert.ok(seenExprs.length > 0);
    assert.match(seenExprs[0], /linesMap\.get\(false\)/);
    assert.match(seenExprs[0], /_primitivesDataById/);
  });

  it('test_streamLabels_smoke_uses_get_false_unwrap', async () => {
    const { _deps, seenExprs } = makeRecorder({
      values: { symbol: 'AAPL', study_count: 0, studies: [] },
      captureExpr: true,
    });
    _deps.maxIterations = 1;
    await stream.streamLabels({ interval: 10, _deps });
    assert.ok(seenExprs.length > 0);
    assert.match(seenExprs[0], /labelsMap\.get\(false\)/);
    assert.match(seenExprs[0], /_primitivesDataById/);
  });

  it('test_streamAllPanes_smoke_emits_pane_collection', async () => {
    const { _deps, stdout } = makeRecorder({
      values: {
        layout: '2h', pane_count: 2,
        panes: [
          { index: 0, symbol: 'AAPL', resolution: 'D', time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 },
          { index: 1, symbol: 'NVDA', resolution: 'D', time: 1, open: 2, high: 2, low: 2, close: 2, volume: 2 },
        ],
      },
    });
    _deps.maxIterations = 1;
    await stream.streamAllPanes({ interval: 10, _deps });
    assert.equal(stdout.length, 1);
    const parsed = JSON.parse(stdout[0]);
    assert.equal(parsed._stream, 'all-panes');
    assert.equal(parsed.pane_count, 2);
    assert.equal(parsed.panes[1].symbol, 'NVDA');
  });

  it('test_streamLines_smoke_threads_filter_into_expression', async () => {
    const { _deps, seenExprs } = makeRecorder({
      values: { symbol: 'AAPL', study_count: 0, studies: [] },
      captureExpr: true,
    });
    _deps.maxIterations = 1;
    await stream.streamLines({ interval: 10, filter: 'Profiler', _deps });
    assert.match(seenExprs[0], /"Profiler"/);
  });
});
