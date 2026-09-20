/**
 * Registry surface contract: every tool group registers, and no tool
 * name is registered twice.
 *
 * Deliberately no total-count assertion: the surface grows as groups are
 * added, so a pinned or banded count is either a stale tripwire or a
 * tautology. Mass deletion is caught per-group below (a removed group
 * fails loudly via the missing-module import, a gutted group via the
 * non-empty check).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { registerEnabledTools, TOOL_GROUPS } from '../src/tools/registry.js';


function fakeServer() {
  const tools = [];
  return { tools, tool(name) { tools.push(name); } };
}

function collectAll(env = {}) {
  const server = fakeServer();
  const result = registerEnabledTools(server, { env });
  return { tools: server.tools, result };
}

describe('tool-count parity — registry vs documented surface', () => {
  it('every group registers at least one tool', () => {
    for (const [name, register] of Object.entries(TOOL_GROUPS)) {
      const server = fakeServer();
      register(server);
      assert.ok(
        server.tools.length > 0,
        `group "${name}" registered zero tools`,
      );
    }
  });

  it('default registration matches the all-groups sum (no silent drop)', () => {
    const { tools } = collectAll();
    let expected = 0;
    for (const register of Object.values(TOOL_GROUPS)) {
      const server = fakeServer();
      register(server);
      expected += server.tools.length;
    }
    assert.equal(
      tools.length, expected,
      `default registration dropped tools (got ${tools.length}, groups sum ${expected})`,
    );
  });

  it('registers no duplicate tool names', () => {
    const { tools } = collectAll();
    const unique = new Set(tools);
    assert.equal(
      unique.size, tools.length,
      `duplicate tool names: ${tools.filter((t, i) => tools.indexOf(t) !== i).join(', ')}`,
    );
  });
});
