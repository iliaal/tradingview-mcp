/**
 * Smoke tests — src/core/ui.js.
 * Pure helpers (modifierMask, resolveKey, scrollDelta, findLayoutMatch)
 * are already unit-tested. These cover the CDP-dependent exports.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installCdpMocks, resetCdpMocks, fakeCdpClient } from '../helpers/mock-cdp.js';
import * as ui from '../../src/core/ui.js';

describe('core/ui.js — smoke', () => {
  afterEach(() => resetCdpMocks());

  it('test_click_smoke', async () => {
    installCdpMocks({
      evaluate: async () => ({ found: true, tag: 'button', text: 'Save', aria_label: null, data_name: null }),
    });
    const r = await ui.click({ by: 'text', value: 'Save' });
    assert.equal(r.success, true);
    assert.equal(r.clicked.tag, 'button');
  });

  it('test_click_smoke_notFound', async () => {
    installCdpMocks({ evaluate: async () => ({ found: false }) });
    await assert.rejects(ui.click({ by: 'text', value: 'Ghost' }), /No matching element/);
  });

  it('test_openPanel_smoke_bottomPanel', async () => {
    installCdpMocks({ evaluate: async () => ({ was_open: false, performed: 'opened' }) });
    const r = await ui.openPanel({ panel: 'pine-editor', action: 'open' });
    assert.equal(r.success, true);
    assert.equal(r.performed, 'opened');
  });

  it('test_openPanel_smoke_sidePanel', async () => {
    installCdpMocks({ evaluate: async () => ({ was_open: true, performed: 'closed' }) });
    const r = await ui.openPanel({ panel: 'watchlist', action: 'toggle' });
    assert.equal(r.success, true);
    assert.equal(r.performed, 'closed');
  });

  it('test_fullscreen_smoke', async () => {
    installCdpMocks({ evaluate: async () => ({ found: true }) });
    const r = await ui.fullscreen();
    assert.equal(r.success, true);
    assert.equal(r.action, 'fullscreen_toggled');
  });

  it('test_layoutList_smoke', async () => {
    installCdpMocks({
      evaluateAsync: async () => ({
        layouts: [{ id: 'L1', name: 'Day Trading', symbol: 'AAPL', resolution: '5' }],
        source: 'internal_api',
      }),
    });
    const r = await ui.layoutList();
    assert.equal(r.success, true);
    assert.equal(r.layout_count, 1);
    assert.equal(r.layouts[0].name, 'Day Trading');
  });

  it('test_layoutSwitch_smoke', async () => {
    installCdpMocks({
      evaluateAsync: async () => ({ success: true, method: 'loadChartFromServer', id: 'L1', name: 'Day Trading' }),
      evaluate: async () => false,   // no unsaved-changes dialog
    });
    const r = await ui.layoutSwitch({ name: 'Day Trading' });
    assert.equal(r.success, true);
    assert.equal(r.layout, 'Day Trading');
    assert.equal(r.action, 'switched');
    assert.equal(r.unsaved_dialog_dismissed, false);
  });

  it('test_keyboard_smoke', async () => {
    installCdpMocks({ getClient: async () => fakeCdpClient() });
    const r = await ui.keyboard({ key: 'Enter', modifiers: ['ctrl'] });
    assert.equal(r.success, true);
    assert.deepEqual(r.modifiers, ['ctrl']);
  });

  it('test_typeText_smoke', async () => {
    installCdpMocks({ getClient: async () => fakeCdpClient() });
    const r = await ui.typeText({ text: 'hello' });
    assert.equal(r.success, true);
    assert.equal(r.typed, 'hello');
    assert.equal(r.length, 5);
  });

  it('test_hover_smoke', async () => {
    installCdpMocks({
      getClient: async () => fakeCdpClient(),
      evaluate: async () => ({ x: 100, y: 200, tag: 'button' }),
    });
    const r = await ui.hover({ by: 'aria-label', value: 'Save' });
    assert.equal(r.success, true);
    assert.equal(r.hovered.x, 100);
  });

  it('test_scroll_smoke', async () => {
    installCdpMocks({
      getClient: async () => fakeCdpClient(),
      evaluate: async () => ({ x: 600, y: 400 }),
    });
    const r = await ui.scroll({ direction: 'down', amount: 200 });
    assert.equal(r.success, true);
    assert.equal(r.direction, 'down');
    assert.equal(r.amount, 200);
  });

  it('test_mouseClick_smoke_singleClick', async () => {
    installCdpMocks({ getClient: async () => fakeCdpClient() });
    const r = await ui.mouseClick({ x: 100, y: 200 });
    assert.equal(r.success, true);
    assert.equal(r.button, 'left');
    assert.equal(r.double_click, false);
  });

  it('test_mouseClick_smoke_doubleClick', async () => {
    installCdpMocks({ getClient: async () => fakeCdpClient() });
    const r = await ui.mouseClick({ x: 100, y: 200, button: 'right', double_click: true });
    assert.equal(r.button, 'right');
    assert.equal(r.double_click, true);
  });

  it('test_findElement_smoke_css', async () => {
    installCdpMocks({
      evaluate: async () => [
        { tag: 'button', text: 'Save', aria_label: null, data_name: 'save', x: 0, y: 0, width: 80, height: 32, visible: true },
      ],
    });
    const r = await ui.findElement({ query: 'button', strategy: 'css' });
    assert.equal(r.success, true);
    assert.equal(r.count, 1);
  });

  it('test_findElement_smoke_text', async () => {
    installCdpMocks({
      evaluate: async () => [
        { tag: 'span', text: 'Alerts', aria_label: null, data_name: null, x: 100, y: 100, width: 50, height: 20, visible: true },
      ],
    });
    const r = await ui.findElement({ query: 'Alerts' });
    assert.equal(r.strategy, 'text');
    assert.equal(r.count, 1);
  });

  // uiEvaluate was removed in security PR #54 (the unrestricted-JS hole).
});
