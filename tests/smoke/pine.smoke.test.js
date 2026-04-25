/**
 * Smoke tests — src/core/pine.js.
 * analyze() and check() pure logic already unit-tested via pine_helpers.
 * These cover the remaining Monaco/DOM-dependent async exports.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installCdpMocks, resetCdpMocks, fakeCdpClient } from '../helpers/mock-cdp.js';
import * as pine from '../../src/core/pine.js';

describe('core/pine.js — smoke', () => {
  afterEach(() => resetCdpMocks());

  it('test_ensurePineEditorOpen_smoke_alreadyOpen', async () => {
    installCdpMocks({ evaluate: async () => true });
    assert.equal(await pine.ensurePineEditorOpen(), true);
  });

  it('test_ensurePineEditorOpen_smoke_opens', async () => {
    let call = 0;
    installCdpMocks({
      evaluate: async () => {
        call++;
        if (call === 1) return false;   // initial Monaco check — not open
        if (call <= 3) return undefined; // activate tab + click button
        return true;                     // first poll succeeds
      },
    });
    assert.equal(await pine.ensurePineEditorOpen(), true);
  });

  it.todo('test_ensurePineEditorOpen_smoke_timeout', () => {
    // Timeout path polls 50 × 200ms = 10s — too slow for smoke.
    // Flagged for a real integration test.
  });

  it('test_getSource_smoke', async () => {
    // Call 1: ensurePineEditorOpen → true; Call 2: getValue returns source
    let call = 0;
    installCdpMocks({
      evaluate: async () => (++call === 1 ? true : '//@version=6\nindicator("test")\nplot(close)'),
    });
    const r = await pine.getSource();
    assert.equal(r.success, true);
    assert.equal(r.line_count, 3);
    assert.ok(r.char_count > 0);
  });

  it('test_setSource_smoke', async () => {
    // pine_set_source now uses a setTimeout-poll architecture (A.7 KarmicP fix
    // for hangs on large scripts). The mocked evaluate returns 'done' for the
    // status poll on the second call.
    let callIdx = 0;
    installCdpMocks({
      evaluate: async () => {
        callIdx++;
        if (callIdx === 1) return undefined; // initial setTimeout-wrap
        return 'done'; // poll status
      },
    });
    const r = await pine.setSource({ source: 'line1\nline2' });
    assert.equal(r.success, true);
    assert.equal(r.lines_set, 2);
  });

  it('test_compile_smoke_buttonFound', async () => {
    // Call 1: ensurePineEditorOpen → true
    // Call 2: click button → returns label
    let call = 0;
    installCdpMocks({
      evaluate: async () => (++call === 1 ? true : 'Save and add to chart'),
    });
    const r = await pine.compile();
    assert.equal(r.success, true);
    assert.equal(r.button_clicked, 'Save and add to chart');
  });

  it('test_compile_smoke_keyboardFallback', async () => {
    let call = 0;
    installCdpMocks({
      getClient: async () => fakeCdpClient(),
      evaluate: async () => (++call === 1 ? true : null),
    });
    const r = await pine.compile();
    assert.equal(r.button_clicked, 'keyboard_shortcut');
  });

  it('test_getErrors_smoke', async () => {
    let call = 0;
    installCdpMocks({
      evaluate: async () => (++call === 1 ? true : [
        { line: 3, column: 5, message: 'Undeclared identifier', severity: 8 },
      ]),
    });
    const r = await pine.getErrors();
    assert.equal(r.success, true);
    assert.equal(r.has_errors, true);
    assert.equal(r.error_count, 1);
  });

  it('test_save_smoke', async () => {
    let call = 0;
    installCdpMocks({
      getClient: async () => fakeCdpClient(),
      evaluate: async () => (++call === 1 ? true : false),  // no save-dialog
    });
    const r = await pine.save();
    assert.equal(r.success, true);
    assert.equal(r.action, 'Ctrl+S_dispatched');
  });

  it('test_getConsole_smoke', async () => {
    let call = 0;
    installCdpMocks({
      evaluate: async () => (++call === 1 ? true : [
        { timestamp: '12:00:00', type: 'info', message: 'compiled' },
      ]),
    });
    const r = await pine.getConsole();
    assert.equal(r.success, true);
    assert.equal(r.entry_count, 1);
  });

  it('test_smartCompile_smoke', async () => {
    let call = 0;
    installCdpMocks({
      evaluate: async () => {
        call++;
        if (call === 1) return true;    // ensurePineEditorOpen
        if (call === 2) return 3;       // studiesBefore
        if (call === 3) return 'Add to chart';
        if (call === 4) return [];      // errors after
        return 4;                        // studiesAfter
      },
    });
    const r = await pine.smartCompile();
    assert.equal(r.success, true);
    assert.equal(r.button_clicked, 'Add to chart');
    assert.equal(r.has_errors, false);
    assert.equal(r.study_added, true);
  });

  it('test_newScript_smoke', async () => {
    installCdpMocks({ evaluate: async () => true });
    const r = await pine.newScript({ type: 'strategy' });
    assert.equal(r.success, true);
    assert.equal(r.type, 'strategy');
    assert.equal(r.action, 'new_script_created');
  });

  it('test_openScript_smoke', async () => {
    installCdpMocks({
      evaluate: async () => true,                   // ensurePineEditorOpen
      evaluateAsync: async () => ({ success: true, name: 'My Script', id: 'id_1', lines: 20 }),
    });
    const r = await pine.openScript({ name: 'My Script' });
    assert.equal(r.success, true);
    assert.equal(r.name, 'My Script');
    assert.equal(r.lines, 20);
  });

  it('test_listScripts_smoke', async () => {
    installCdpMocks({
      evaluateAsync: async () => ({
        scripts: [
          { id: 'id_1', name: 'Script A', title: 'Script A', version: 1, modified: null },
          { id: 'id_2', name: 'Script B', title: 'Script B', version: 3, modified: null },
        ],
      }),
    });
    const r = await pine.listScripts();
    assert.equal(r.success, true);
    assert.equal(r.count, 2);
    assert.equal(r.scripts[0].name, 'Script A');
  });
});
