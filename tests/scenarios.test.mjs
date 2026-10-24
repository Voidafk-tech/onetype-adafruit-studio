import assert from 'node:assert/strict';
import {describe, test} from 'node:test';
import {SCENARIOS, buildScenario, defaultKnobs} from '../dist/studio/lib/scenarios.js';
import {parseCsv} from '../dist/studio/lib/csv.js';
import {loadCatalog} from './engine-harness.mjs';

const catalog = loadCatalog();
const ids = new Set(catalog.products.map(p => p.id));
const SOURCE_ID = /^[A-Za-z0-9_.:-]{1,80}$/;
const recordsOf = source => source.records ?? parseCsv(source.csv).records;

describe('scenario generators', () => {
  for (const scenario of SCENARIOS) {
    describe(scenario.id, () => {
      const built = buildScenario(catalog, scenario.id);

      test('is reproducible from the same seed', () => {
        assert.deepEqual(buildScenario(catalog, scenario.id).request, built.request);
      });

      test('labels synthetic data as a simulation', () => {
        const synthetic = built.request.sources.length > 0 || built.request.patches.length > 0;
        assert.equal(built.request.mode, synthetic ? 'simulation' : 'observed');
      });

      test('uses valid, distinct source IDs and supported kinds', () => {
        const sourceIds = built.request.sources.map(s => s.id);
        assert.equal(new Set(sourceIds).size, sourceIds.length);
        for (const source of built.request.sources) {
          assert.match(source.id, SOURCE_ID);
          assert.ok(recordsOf(source).length > 0 && recordsOf(source).length <= 20000);
        }
      });

      test('patches only real products with supported fields', () => {
        for (const patch of built.request.patches) {
          assert.ok(ids.has(patch.product_id), patch.product_id);
          assert.ok(['price_value', 'shipping_weight_g', 'public_quantity'].includes(patch.field));
          assert.ok(Number.isFinite(patch.value) && patch.value >= 0);
        }
      });

      test('exposes a default for every knob', () => {
        for (const knob of scenario.knobs) assert.notEqual(defaultKnobs(scenario)[knob.id], undefined, knob.id);
      });
    });
  }

  test('a different seed produces different data', () => {
    const a = buildScenario(catalog, 'warehouse', {seed: 1}).request.sources[0].csv;
    const b = buildScenario(catalog, 'warehouse', {seed: 2}).request.sources[0].csv;
    assert.notEqual(a, b);
  });

  test('planted unknown IDs are genuinely absent from the catalog', () => {
    const {request} = buildScenario(catalog, 'ops-morning');
    const unknown = request.sources.flatMap(recordsOf).filter(r => /^(99999|88880|77770|66660|99990)/.test(r.product_id));
    assert.ok(unknown.length > 0);
    for (const row of unknown) assert.ok(!ids.has(`ADA:${row.product_id}`), row.product_id);
  });

  test('knob changes scale the generated data', () => {
    const small = buildScenario(catalog, 'tariff-shock', {share: 20}).request.patches.length;
    const large = buildScenario(catalog, 'tariff-shock', {share: 100}).request.patches.length;
    assert.ok(large > small);
  });

  test('tariff patches raise prices by the configured percentage', () => {
    const {request} = buildScenario(catalog, 'tariff-shock', {pct: 25});
    const before = new Map(catalog.products.map(p => [p.id, p.price]));
    for (const patch of request.patches) assert.ok(Math.abs(patch.value - before.get(patch.product_id) * 1.25) < 0.01);
  });
});
