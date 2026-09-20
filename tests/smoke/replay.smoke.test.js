/**
 * Smoke tests — replay session lifecycle (src/core/replay.js) via _deps DI
 * plus the CLI parser → core handoff (src/cli/replay_parsers.js).
 *
 * Everything here runs with injected mocks: no live TradingView, no CDP, no
 * sleeps beyond a single 300ms settle in the dated-start path. The thorough
 * per-function edge cases live in tests/replay.test.js and the parser matrix
 * in tests/smoke/replay_parsers.smoke.test.js; this file proves the pieces
 * compose — a full start → step → autoplay → status → trade → stop session
 * completes against one coherent mock, and parsed CLI values are accepted
 * by the core functions that consume them.
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { cleanupConnection } from '../helpers/mock-cdp.js';
import {
  start, step, autoplay, stop, trade, status, setResolution,
  VALID_AUTOPLAY_DELAYS,
} from '../../src/core/replay.js';
import { parseSpeed, parseFlexDate } from '../../src/cli/replay_parsers.js';

// ── Mock harness ─────────────────────────────────────────────────────
// Substring table like tests/replay.test.js, but stateful so multi-call
// sequences (isReplayStarted false→true, currentDate advancing) behave
// like a live session. First matching key wins — put specific keys first.
function mockSession({ currentDate } = {}) {
  const calls = [];
  const state = { startedCalls: 0, dateCalls: 0, autoplayCalls: 0 };
  const table = {
    is_replay_available: () => ({
      is_replay_available: true,
      is_replay_started: true,
      is_autoplay_started: false,
      replay_mode: 'AllCharts',
      current_date: currentDate,
      autoplay_delay: 1000,
    }),
    isReplayAvailable: () => true,
    isReplayStarted: () => {
      state.startedCalls += 1;
      return state.startedCalls === 1 ? false : true;
    },
    isAutoplayStarted: () => {
      state.autoplayCalls += 1;
      return state.autoplayCalls === 1 ? false : true;
    },
    _allReplayResolutions: () => ['1', '5', '15'],
    _currentReplayResolution: () => '5',
    _autoReplayResolution: () => 'auto',
    currentDate: () => {
      state.dateCalls += 1;
      // First two reads return the parked cursor (start poll, step "before");
      // later reads advance, so step()'s change-detection breaks immediately.
      return state.dateCalls <= 2 ? currentDate : currentDate + 300;
    },
    autoplayDelay: () => 200,
    realizedPL: () => 12.5,
    'position()': () => ({ side: 'long', qty: 1 }),
    dismissed: () => [],
  };
  const evaluate = async (expr) => {
    calls.push(expr);
    for (const [key, val] of Object.entries(table)) {
      if (expr.includes(key)) return val(expr);
    }
    return undefined;
  };
  evaluate.calls = calls;
  const _deps = {
    evaluate,
    getReplayApi: async () => 'window.__rp',
    getReplayUIController: async () => 'window.__rc',
  };
  return { _deps, evaluate };
}

describe('core/replay.js — session lifecycle smoke (_deps DI)', () => {
  after(cleanupConnection);

  it('full session: start → step → autoplay → status → trade → stop', async () => {
    const { _deps, evaluate } = mockSession({ currentDate: 946684800 });

    const started = await start({ _deps });
    assert.equal(started.success, true);
    assert.equal(started.replay_started, true);
    assert.equal(started.date, '(first available)');
    assert.equal(started.current_date, 946684800);
    assert.ok(evaluate.calls.some((c) => c.includes('selectFirstAvailableDate')));

    const stepped = await step({ _deps });
    assert.equal(stepped.success, true);
    assert.equal(stepped.current_date, 946684800 + 300);

    const played = await autoplay({ speed: 200, _deps });
    assert.equal(played.success, true);
    assert.equal(played.autoplay_active, true);
    assert.equal(played.delay_ms, 200);

    const st = await status({ _deps });
    assert.equal(st.success, true);
    assert.equal(st.is_replay_started, true);
    assert.deepEqual(st.position, { side: 'long', qty: 1 });
    assert.equal(st.realized_pnl, 12.5);

    const bought = await trade({ action: 'buy', _deps });
    assert.equal(bought.success, true);
    assert.equal(bought.action, 'buy');

    const stopped = await stop({ _deps });
    assert.equal(stopped.success, true);
    assert.equal(stopped.action, 'replay_stopped');
  });

  it('start with a date lands the cursor on the requested target', async () => {
    const targetSec = Math.floor(new Date('2026-03-15').getTime() / 1000);
    const { _deps, evaluate } = mockSession({ currentDate: targetSec });
    const r = await start({ date: '2026-03-15', _deps });
    assert.equal(r.success, true);
    assert.equal(r.current_date, targetSec);
    assert.equal(r.drift_seconds, 0);
    assert.equal(r.warning, null);
    const selectCall = evaluate.calls.find((c) => c.includes('selectDate'));
    assert.ok(selectCall && selectCall.includes('.then('), 'selectDate promise is awaited');
  });

  it('stop on an idle chart reports already_stopped without touching replay', async () => {
    const calls = [];
    const _deps = {
      evaluate: async (expr) => {
        calls.push(expr);
        if (expr.includes('isReplayStarted')) return false;
        if (expr.includes('dismissed')) return [];
        return undefined;
      },
      getReplayApi: async () => 'window.__rp',
    };
    const r = await stop({ _deps });
    assert.equal(r.success, true);
    assert.equal(r.action, 'already_stopped');
    assert.ok(!calls.some((c) => c.includes('stopReplay')));
  });

  it('setResolution validates against available resolutions then applies', async () => {
    const { _deps } = mockSession({ currentDate: 946684800 });
    await start({ _deps }); // prime isReplayStarted past the cold-start false
    const r = await setResolution({ interval: '5', _deps });
    assert.equal(r.success, true);
    assert.equal(r.resolution, '5');
    assert.equal(r.resolution_label, '5 min');
    await assert.rejects(
      () => setResolution({ interval: 'bogus', _deps }),
      /Invalid replay resolution/,
    );
  });

  it('autoplay rejects an invalid delay before any CDP call', async () => {
    const { _deps, evaluate } = mockSession({ currentDate: 946684800 });
    await assert.rejects(() => autoplay({ speed: 999, _deps }), /Invalid autoplay delay/);
    assert.equal(evaluate.calls.length, 0);
  });

  it('parser → core handoff: parseSpeed/parseFlexDate outputs are accepted', async () => {
    const speed = parseSpeed('5x');
    assert.ok(VALID_AUTOPLAY_DELAYS.includes(speed));
    const date = parseFlexDate('20260508');
    assert.equal(date, '2026-05-08');

    const targetSec = Math.floor(new Date(date).getTime() / 1000);
    const { _deps } = mockSession({ currentDate: targetSec });
    const started = await start({ date, _deps });
    assert.equal(started.success, true);
    assert.equal(started.current_date, targetSec);
    const played = await autoplay({ speed, _deps });
    assert.equal(played.success, true);
  });
});
