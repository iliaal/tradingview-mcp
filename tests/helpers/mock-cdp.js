/**
 * Test helper: install/reset CDP mocks on connection.js so any core
 * function can run without a live TradingView.
 *
 *   import { installCdpMocks, resetCdpMocks } from './helpers/mock-cdp.js';
 *
 *   installCdpMocks({
 *     evaluate: async (expr) => ({ ... mocked response ... }),
 *   });
 *   try { await core.someFn({}); }
 *   finally { resetCdpMocks(); }
 */
import { __setTestOverrides } from '../../src/connection.js';

/**
 * Install mocks. Any key omitted falls through to the real implementation
 * (which will fail loudly without CDP — so callers should cover every
 * CDP function their code touches).
 */
export function installCdpMocks(mocks) {
  __setTestOverrides(mocks);
}

export function resetCdpMocks() {
  __setTestOverrides(null);
}

/**
 * Build an evaluate() mock from a table of expression-substring → value
 * mappings. First matching substring wins. Unmatched expressions return
 * undefined (which many TV paths treat as "not available" and handle).
 */
export function mockEvaluateFromTable(table) {
  const calls = [];
  const fn = async (expression) => {
    calls.push(expression);
    for (const [key, val] of Object.entries(table)) {
      if (expression.includes(key)) {
        return typeof val === 'function' ? val(expression) : val;
      }
    }
    return undefined;
  };
  fn.calls = calls;
  return fn;
}

/** Fake CDP client that records Input.* and Page.captureScreenshot calls. */
export function fakeCdpClient() {
  const log = [];
  const client = {
    log,
    Input: {
      dispatchKeyEvent: async (args) => { log.push({ type: 'key', ...args }); },
      dispatchMouseEvent: async (args) => { log.push({ type: 'mouse', ...args }); },
      insertText: async (args) => { log.push({ type: 'insertText', ...args }); },
    },
    Page: {
      captureScreenshot: async () => ({ data: Buffer.from('fake-png').toString('base64') }),
    },
    Runtime: {
      evaluate: async ({ expression }) => ({ result: { value: null }, expression }),
    },
    close: async () => { log.push({ type: 'close' }); },
  };
  return client;
}
