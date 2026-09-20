/**
 * Capture/data hardening — mocked unit tests (no live TradingView needed).
 *
 * Covers the basghari capture/data adoption:
 *   - withTimeout: passthrough, stage-tagged timeout, timer cleanup implied
 *   - resolveCaptureTimeoutMs: TV_CAPTURE_TIMEOUT_MS override + default
 *   - capture hang → structured timeout error, no file written
 *   - single retry on stage-timeout only (timeout-then-success; boom → 1 call)
 *   - bringToFront gating: linux never shells out, healthy path never shells
 *     out, darwin-hidden uses execFile argv-form with static AppleScript and
 *     swallows failures
 *   - region chart selector fallback chain order (+ zero-dim guard → no clip)
 *   - batch sweep hang → per-combo {success:false}, no file written
 *   - bars/count precedence + default at tool and CLI level
 *
 * Run: TV_CAPTURE_TIMEOUT_MS=60 node --test tests/capture_hardening.test.js
 * (each timeout test sets the env var itself; no global setting required).
 */
import { describe, it, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installCdpMocks, resetCdpMocks, cleanupConnection } from './helpers/mock-cdp.js';
import {
  captureScreenshot,
  withTimeout,
  isCaptureTimeout,
  CAPTURE_TIMEOUT_MS,
  resolveCaptureTimeoutMs,
} from '../src/core/capture.js';
import { batchRun } from '../src/core/batch.js';
import { registerDataTools } from '../src/tools/data.js';
import { runOnce } from '../src/cli/router.js';
import '../src/cli/commands/data.js';

const PNG_B64 = Buffer.from('fake-png').toString('base64');
const savedTimeoutEnv = process.env.TV_CAPTURE_TIMEOUT_MS;
const tmpDirs = [];
const writtenFiles = [];
function trackFile(p) {
  writtenFiles.push(p);
  return p;
}

afterEach(() => {
  resetCdpMocks();
  if (savedTimeoutEnv === undefined) delete process.env.TV_CAPTURE_TIMEOUT_MS;
  else process.env.TV_CAPTURE_TIMEOUT_MS = savedTimeoutEnv;
});

function makeTmp() {
  const dir = mkdtempSync(join(tmpdir(), 'tv-cap-harden-'));
  tmpDirs.push(dir);
  return dir;
}

function shotClient(recorder) {
  return {
    Page: {
      captureScreenshot: async (params) => {
        recorder?.push(params);
        return { data: PNG_B64 };
      },
    },
  };
}
after(async () => {
  await cleanupConnection();
  for (const f of writtenFiles) { try { unlinkSync(f); } catch {} }
  for (const d of tmpDirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
});

/** evaluate mock that serves N bars for whatever limit the expression embeds. */
function barsEvaluate() {
  return async (expr) => {
    if (typeof expr !== 'string') return undefined;
    const m = /end - (\d+) \+ 1/.exec(expr);
    if (m) {
      const n = Number(m[1]);
      return {
        bars: Array.from({ length: n }, (_, i) => ({
          time: 1700000000 + i * 60, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100,
        })),
        total_bars: 500,
        source: 'direct_bars',
      };
    }
    if (expr.includes('isLoading')) return { isLoading: false, barCount: 100, currentSymbol: 'AAPL' };
    return undefined;
  };
}

function toolResultText(res) {
  assert.ok(res.content?.[0]?.text);
  return JSON.parse(res.content[0].text);
}

describe('withTimeout / resolveCaptureTimeoutMs', () => {
  it('passes values through', async () => {
    assert.equal(await withTimeout(Promise.resolve(42), 1000, 'Stage'), 42);
  });

  it('rejects with a stage-tagged error', async () => {
    await assert.rejects(
      withTimeout(new Promise(() => {}), 20, 'StageX'),
      /capture timed out during StageX after 20ms/,
    );
  });

  it('isCaptureTimeout discriminates', () => {
    assert.equal(isCaptureTimeout(new Error('capture timed out during Foo after 1ms')), true);
    assert.equal(isCaptureTimeout(new Error('boom')), false);
    assert.equal(isCaptureTimeout(null), false);
  });

  it('default is 20000 with env override + invalid fallback', () => {
    assert.equal(CAPTURE_TIMEOUT_MS, 20000);
    delete process.env.TV_CAPTURE_TIMEOUT_MS;
    assert.equal(resolveCaptureTimeoutMs(), 20000);
    process.env.TV_CAPTURE_TIMEOUT_MS = '250';
    assert.equal(resolveCaptureTimeoutMs(), 250);
    process.env.TV_CAPTURE_TIMEOUT_MS = 'bogus';
    assert.equal(resolveCaptureTimeoutMs(), 20000);
  });
});

describe('captureScreenshot — bounded capture', () => {
  it('hang → structured timeout, no file written', async () => {
    process.env.TV_CAPTURE_TIMEOUT_MS = '60';
    const tmp = makeTmp();
    installCdpMocks({
      evaluate: async () => undefined,
      withReconnect: () => new Promise(() => {}),
    });
    await assert.rejects(
      captureScreenshot({ filename: 'hang-no-write', output_dir: tmp }),
      /capture timed out during Page\.captureScreenshot after 60ms/,
    );
    assert.deepEqual(readdirSync(tmp), [], 'timeout must not leave a file behind');
  });

  it('single retry: timeout-then-success recovers with 2 calls', async () => {
    process.env.TV_CAPTURE_TIMEOUT_MS = '60';
    const tmp = makeTmp();
    let calls = 0;
    installCdpMocks({
      evaluate: async () => undefined,
      withReconnect: (op) => {
        calls += 1;
        if (calls === 1) return new Promise(() => {});
        return op(shotClient());
      },
    });
    const r = await captureScreenshot({ filename: 'retry-ok', output_dir: tmp });
    assert.equal(r.success, true);
    assert.equal(calls, 2, 'exactly one retry after the stage-timeout');
    trackFile(r.file_path);
  });

  it('no retry on non-timeout errors', async () => {
    const tmp = makeTmp();
    let calls = 0;
    installCdpMocks({
      evaluate: async () => undefined,
      withReconnect: () => { calls += 1; return Promise.reject(new Error('boom')); },
    });
    await assert.rejects(captureScreenshot({ filename: 'no-retry', output_dir: tmp }), /boom/);
    assert.equal(calls, 1, 'plain failures must not retry');
    assert.deepEqual(readdirSync(tmp), []);
  });
});

describe('captureScreenshot — bringToFront gating', () => {
  function visDeps(state, { platform, execFile } = {}) {
    return {
      platform,
      execFile,
      evaluate: async (expr) => (expr === 'document.visibilityState' ? state : null),
      withReconnect: async (op) => op(shotClient()),
    };
  }

  it('linux + hidden tab never shells out', async () => {
    const tmp = makeTmp();
    const shellCalls = [];
    const r = await captureScreenshot({
      filename: 'linux-no-shell', output_dir: tmp,
      _deps: visDeps('hidden', { platform: 'linux', execFile: (...a) => shellCalls.push(a) }),
    });
    assert.equal(r.success, true);
    assert.equal(shellCalls.length, 0);
    trackFile(r.file_path);
  });

  it('healthy (visible) path never shells out, even on darwin', async () => {
    const tmp = makeTmp();
    const shellCalls = [];
    const r = await captureScreenshot({
      filename: 'healthy-no-shell', output_dir: tmp,
      _deps: visDeps('visible', { platform: 'darwin', execFile: (...a) => shellCalls.push(a) }),
    });
    assert.equal(r.success, true);
    assert.equal(shellCalls.length, 0);
    trackFile(r.file_path);
  });

  it('darwin + hidden uses argv-form osascript with static script, failures swallowed', async () => {
    const tmp = makeTmp();
    const shellCalls = [];
    const fakeExec = (file, args, cb) => {
      shellCalls.push([file, args]);
      cb(new Error('osascript failed')); // must be swallowed
    };
    const r = await captureScreenshot({
      filename: 'darwin-activate', output_dir: tmp,
      _deps: visDeps('hidden', { platform: 'darwin', execFile: fakeExec }),
    });
    assert.equal(r.success, true, 'activation failure must not block capture');
    assert.equal(shellCalls.length, 1);
    const [file, args] = shellCalls[0];
    assert.equal(file, 'osascript');
    assert.ok(Array.isArray(args), 'argv-form, no shell string');
    assert.equal(args[0], '-e');
    assert.ok(args[1].includes('tell application'), 'static AppleScript');
    trackFile(r.file_path);
  });

  it('hung visibility probe + hung exec callback resolve via preflight budget', async () => {
    const tmp = makeTmp();
    const prev = process.env.TV_PREFLIGHT_TIMEOUT_MS;
    process.env.TV_PREFLIGHT_TIMEOUT_MS = '60';
    try {
      const shellCalls = [];
      const r = await captureScreenshot({
        filename: 'hung-preflight', output_dir: tmp,
        _deps: {
          platform: 'darwin',
          execFile: (...a) => { shellCalls.push(a); /* callback never fires */ },
          evaluate: async () => new Promise(() => {}), // visibility probe hangs
          withReconnect: async (op) => op(shotClient()),
        },
      });
      assert.equal(r.success, true, 'hung preflight must not block capture');
      trackFile(r.file_path);
    } finally {
      if (prev === undefined) delete process.env.TV_PREFLIGHT_TIMEOUT_MS;
      else process.env.TV_PREFLIGHT_TIMEOUT_MS = prev;
    }
  });
});
describe('captureScreenshot — chart selector chain', () => {
  it('tries .active → plain → substring → pane-canvas → canvas, in order', async () => {
    const tmp = makeTmp();
    const seen = [];
    const r = await captureScreenshot({
      region: 'chart', filename: 'selector-order', output_dir: tmp,
      _deps: {
        platform: 'linux',
        evaluate: async (expr) => { seen.push(expr); return null; },
        withReconnect: async (op) => op(shotClient()),
      },
    });
    assert.equal(r.success, true);
    trackFile(r.file_path);
    const expr = seen.find((e) => typeof e === 'string' && e.includes('querySelector'));
    assert.ok(expr, 'expected a bounds query expression');
    const chain = [
      "querySelector('.chart-container.active')",
      "querySelector('.chart-container')",
      'querySelector(\'[class*="chart-container"]\')',
      'querySelector(\'[data-name="pane-canvas"]\')',
      "querySelector('canvas')",
    ];
    let last = -1;
    for (const s of chain) {
      const i = expr.indexOf(s);
      assert.ok(i > last, `selector ${s} present and after previous (idx ${i})`);
      last = i;
    }
  });

  it('zero-dimension bounds still fall back to full capture (no clip)', async () => {
    const tmp = makeTmp();
    const shots = [];
    const client = shotClient(shots);
    const r = await captureScreenshot({
      region: 'chart', filename: 'zero-dim', output_dir: tmp,
      _deps: {
        platform: 'linux',
        evaluate: async (expr) => (
          typeof expr === 'string' && expr.includes('querySelector')
            ? { x: 0, y: 0, width: 0, height: 0 }
            : null
        ),
        withReconnect: async (op) => op(client),
      },
    });
    assert.equal(r.success, true);
    assert.equal(shots.length, 1);
    assert.ok(!('clip' in shots[0]), 'collapsed element must not produce a zero-size clip');
    trackFile(r.file_path);
  });
});

describe('batchRun — bounded sweep capture', () => {
  it('hang → per-combo {success:false} entry, no file written', async () => {
    process.env.TV_CAPTURE_TIMEOUT_MS = '60';
    const tmp = makeTmp();
    installCdpMocks({
      getChartApi: async () => 'window.chartApi',
      getChartCollection: async () => 'window.cwc',
      evaluate: barsEvaluate(),
      withReconnect: () => new Promise(() => {}),
    });
    const r = await batchRun({ symbols: ['AAPL'], action: 'screenshot', delay_ms: 10, output_dir: tmp });
    assert.equal(r.results.length, 1);
    assert.equal(r.results[0].success, false);
    assert.match(r.results[0].error, /capture timed out during batch Page\.captureScreenshot/);
    assert.deepEqual(readdirSync(tmp), [], 'timed-out sweep must not write a file');
  });
});

describe('bars alias — tool + CLI parity', () => {
  const defs = {};
  registerDataTools({ tool: (name, _desc, schema, handler) => { defs[name] = { schema, handler }; } });

  it('tool schema coerces bars like count', () => {
    assert.equal(defs.data_get_ohlcv.schema.bars.parse('25'), 25);
    assert.equal(defs.data_get_ohlcv.schema.count.parse('30'), 30);
    assert.equal(defs.data_get_ohlcv.schema.bars.parse(undefined), undefined);
  });

  it('tool handler: count wins, bars is fallback, default 100', async () => {
    installCdpMocks({ evaluate: barsEvaluate() });
    const h = defs.data_get_ohlcv.handler;
    assert.equal(toolResultText(await h({ bars: 7 })).bar_count, 7);
    assert.equal(toolResultText(await h({ count: 10, bars: 5 })).bar_count, 10);
    assert.equal(toolResultText(await h({})).bar_count, 100);
  });

  it('CLI: --bars parity, --count precedence, default 100', async () => {
    installCdpMocks({ evaluate: barsEvaluate() });
    assert.equal((await runOnce(['ohlcv', '--bars', '7'])).bar_count, 7);
    assert.equal((await runOnce(['ohlcv', '--count', '10', '--bars', '5'])).bar_count, 10);
    assert.equal((await runOnce(['ohlcv'])).bar_count, 100);
  });
});
