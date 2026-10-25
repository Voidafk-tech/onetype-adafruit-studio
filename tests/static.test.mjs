// The Pages demo finds pre-computed runs by request fingerprint, so the request the UI builds
// for a preset scenario must be byte-identical to the one used at build time.
import assert from 'node:assert/strict';
import {describe, test} from 'node:test';
import {SCENARIOS, buildScenario} from '../dist/studio/lib/scenarios.js';
import {requestKey} from '../dist/studio/lib/hash.js';
import {buildRequest} from '../dist/studio/state.js';
import {loadCatalog} from './engine-harness.mjs';

const catalog = loadCatalog();

// Mirrors what actions.generateScenario stores in the UI state.
function uiState(scenarioId, knobs = {}) {
  const {request} = buildScenario(catalog, scenarioId, knobs);
  return {
    scenario: {id: scenarioId, label: request.label},
    staged: request.sources.map(source => ({...source, origin: 'scenario'})),
    patches: request.patches,
    filters: request.filters,
    analysis: request.analysis,
    treatUploadsAsReal: false,
  };
}

describe('static demo request matching', () => {
  for (const {id} of SCENARIOS) {
    test(`${id}: UI request matches the pre-computed request`, () => {
      const {request} = buildScenario(catalog, id, {});
      assert.equal(requestKey(buildRequest(uiState(id))), requestKey(request));
    });
  }

  test('changing a knob produces a different key', () => {
    const base = requestKey(buildScenario(catalog, 'warehouse', {}).request);
    assert.notEqual(requestKey(buildRequest(uiState('warehouse', {seed: 43}))), base);
  });

  test('key is stable and length-qualified', () => {
    assert.match(requestKey({a: 1}), /^[0-9a-f]{8}-\d+$/);
    assert.equal(requestKey({a: 1}), requestKey({a: 1}));
  });
});
