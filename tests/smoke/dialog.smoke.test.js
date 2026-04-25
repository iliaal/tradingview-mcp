/**
 * Smoke tests — src/core/dialog.js::dismissBlockingDialogs.
 * The function inlines DOM-pattern matching into a single CDP evaluate call
 * and returns whatever the page-side code resolved with. We don't render a
 * real DOM here — we just verify the function passes through a mocked
 * response and tolerates absence/edge shapes.
 */
import { describe, it, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { installCdpMocks, resetCdpMocks, cleanupConnection } from '../helpers/mock-cdp.js';
import { dismissBlockingDialogs } from '../../src/core/dialog.js';

describe('core/dialog.js — smoke', () => {
  afterEach(() => resetCdpMocks());
  after(cleanupConnection);

  it('test_dismissBlockingDialogs_smoke_no_dialog', async () => {
    installCdpMocks({ evaluate: async () => [] });
    const r = await dismissBlockingDialogs();
    assert.deepEqual(r, []);
  });

  it('test_dismissBlockingDialogs_smoke_leave_replay', async () => {
    installCdpMocks({
      evaluate: async () => [{ note: 'leave_replay', button: 'Leave' }],
    });
    const r = await dismissBlockingDialogs();
    assert.equal(r.length, 1);
    assert.equal(r[0].note, 'leave_replay');
    assert.equal(r[0].button, 'Leave');
  });

  it('test_dismissBlockingDialogs_smoke_continue_replay', async () => {
    installCdpMocks({
      evaluate: async () => [{ note: 'continue_replay', button: 'close' }],
    });
    const r = await dismissBlockingDialogs();
    assert.equal(r[0].note, 'continue_replay');
    assert.equal(r[0].button, 'close');
  });

  it('test_dismissBlockingDialogs_smoke_uses_injected_evaluate', async () => {
    // The function takes evaluate via destructured opts. Verify the override
    // via _deps-style injection (not via __setTestOverrides) works.
    let injectedCallCount = 0;
    const customEvaluate = async () => {
      injectedCallCount++;
      return [{ note: 'unsaved_changes', button: 'Discard' }];
    };
    const r = await dismissBlockingDialogs({ evaluate: customEvaluate });
    assert.equal(injectedCallCount, 1);
    assert.equal(r[0].button, 'Discard');
  });

  it('test_dismissBlockingDialogs_smoke_undefined_returns_empty', async () => {
    // When the page-side code returns undefined (e.g. rare CDP edge case),
    // dismissBlockingDialogs should not throw.
    installCdpMocks({ evaluate: async () => undefined });
    const r = await dismissBlockingDialogs();
    assert.deepEqual(r, []);
  });
});
