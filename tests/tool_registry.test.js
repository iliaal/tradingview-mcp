/**
 * Tests for TV_DISABLED_TOOLS tool-group gating (#52).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseDisabledTools, registerEnabledTools, TOOL_GROUPS } from '../src/tools/registry.js';

// Fake MCP server that records the tool names each group registers.
function fakeServer() {
  const tools = [];
  return { tools, tool(name) { tools.push(name); } };
}

describe('parseDisabledTools()', () => {
  it('splits, trims, lowercases, and drops empties', () => {
    assert.deepEqual([...parseDisabledTools('  News , ,HOTLIST ')], ['news', 'hotlist']);
  });
  it('returns an empty set for undefined / empty', () => {
    assert.equal(parseDisabledTools(undefined).size, 0);
    assert.equal(parseDisabledTools('').size, 0);
  });
});

describe('registerEnabledTools() — selection logic', () => {
  const calls = () => {
    const called = [];
    const groups = { a: (s) => { called.push('a'); s.tool('a1'); }, b: (s) => { called.push('b'); s.tool('b1'); }, news: (s) => { called.push('news'); s.tool('news1'); } };
    return { called, groups };
  };

  it('registers every group when nothing is disabled', () => {
    const { called, groups } = calls();
    const r = registerEnabledTools(fakeServer(), { env: {}, groups });
    assert.deepEqual(called.sort(), ['a', 'b', 'news']);
    assert.deepEqual(r.disabled, []);
    assert.deepEqual(r.registered.sort(), ['a', 'b', 'news']);
  });

  it('skips a disabled group', () => {
    const { called, groups } = calls();
    const r = registerEnabledTools(fakeServer(), { env: { TV_DISABLED_TOOLS: 'news' }, groups });
    assert.deepEqual(called.sort(), ['a', 'b']);
    assert.deepEqual(r.disabled, ['news']);
    assert.ok(!r.registered.includes('news'));
  });

  it('reports unknown names without crashing and still registers real groups', () => {
    const { called, groups } = calls();
    const r = registerEnabledTools(fakeServer(), { env: { TV_DISABLED_TOOLS: 'bogus,news' }, groups });
    assert.deepEqual(r.unknown, ['bogus']);
    assert.deepEqual(called.sort(), ['a', 'b']);
  });
});

describe('registerEnabledTools() — against the real TOOL_GROUPS', () => {
  it('registers the news tools by default', () => {
    const s = fakeServer();
    registerEnabledTools(s, { env: {} });
    assert.ok(s.tools.includes('news_get_ticker'));
    assert.ok(s.tools.includes('signal_get_snapshot'));
    assert.ok(s.tools.length > 50); // full surface still registered
  });

  it('TV_DISABLED_TOOLS=news drops exactly the news tools', () => {
    const s = fakeServer();
    const r = registerEnabledTools(s, { env: { TV_DISABLED_TOOLS: 'news' } });
    assert.ok(!s.tools.includes('news_get_ticker'));
    assert.ok(!s.tools.includes('signal_get_snapshot'));
    assert.deepEqual(r.disabled, ['news']);
    // Everything else is untouched.
    assert.ok(s.tools.includes('quote_get'));
    assert.equal(r.registered.length, Object.keys(TOOL_GROUPS).length - 1);
  });
});
