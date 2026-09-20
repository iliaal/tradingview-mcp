/**
 * Tool-count parity: the registered MCP surface vs the documented size.
 *
 * The documented reference is the "~93 tools" header in tests/e2e.test.js
 * (2026-04-25). The surface grows as groups are added, so this is a
 * tolerant band — not an exact pin. It fails loudly on a mass drop
 * (deleted group, registration typo swallowing a group) or an explosion
 * (duplicate registration), while normal growth stays green.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { registerEnabledTools, TOOL_GROUPS } from '../src/tools/registry.js';

// Documented surface size; see tests/e2e.test.js header ("93 tools as of 2026-04-25").
const DOCUMENTED_COUNT = 93;
// Headroom for legitimate growth (and a floor against mass deletion).
const TOLERANCE = 35;

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

  it('total stays within tolerance of the documented count', () => {
    const { tools } = collectAll();
    assert.ok(
      Math.abs(tools.length - DOCUMENTED_COUNT) <= TOLERANCE,
      `registered ${tools.length} tools, documented ~${DOCUMENTED_COUNT} ` +
      `(tolerance ±${TOLERANCE}) — update DOCUMENTED_COUNT if the surface grew intentionally`,
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
