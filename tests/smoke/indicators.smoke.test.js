/**
 * Smoke tests — src/core/indicators.js.
 */
import { describe, it, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { installCdpMocks, resetCdpMocks, cleanupConnection } from '../helpers/mock-cdp.js';
import * as indicators from '../../src/core/indicators.js';

describe('core/indicators.js — smoke', () => {
  afterEach(() => resetCdpMocks());
  after(cleanupConnection);

  it('test_setInputs_smoke', async () => {
    installCdpMocks({
      evaluate: async () => ({ updated_inputs: { length: 50 } }),
    });
    const r = await indicators.setInputs({ entity_id: 'eFu1', inputs: { length: 50 } });
    assert.equal(r.success, true);
    assert.equal(r.entity_id, 'eFu1');
    assert.deepEqual(r.updated_inputs, { length: 50 });
  });

  it('test_setInputs_smoke_missingEntity', async () => {
    await assert.rejects(
      indicators.setInputs({ entity_id: '', inputs: { length: 50 } }),
      /entity_id is required/,
    );
  });

  it('test_toggleVisibility_smoke', async () => {
    installCdpMocks({ evaluate: async () => ({ visible: false }) });
    const r = await indicators.toggleVisibility({ entity_id: 'eFu1', visible: false });
    assert.equal(r.success, true);
    assert.equal(r.visible, false);
  });

  it('test_toggleVisibility_smoke_badBool', async () => {
    await assert.rejects(
      indicators.toggleVisibility({ entity_id: 'eFu1', visible: 'yes' }),
      /must be a boolean/,
    );
  });
});
