// End-to-end demo checks: each scenario goes through the real engine binary and the
// engine must catch exactly what the generator planted.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {before, describe, test} from 'node:test';
import {buildScenario} from '../dist/studio/lib/scenarios.js';
import {deriveInsights} from '../dist/studio/lib/insights.js';
import {plantedChecks} from '../dist/studio/lib/planted.js';
import {SCENARIOS} from '../dist/studio/lib/scenarios.js';
import {engineError, loadCatalog, root, runEngine} from './engine-harness.mjs';

const catalog = loadCatalog();
const workspaceHash = () => createHash('sha256').update(readFileSync(join(root, 'data/workspace.json'))).digest('hex');
const find = (insights, id) => insights.find(i => i.id === id);
const sorted = list => [...list].sort();

function scenarioRun(id, knobs) {
  const context = {};
  before(() => {
    context.built = buildScenario(catalog, id, knobs);
    context.result = runEngine(context.built.request);
    context.insights = deriveInsights(context.result);
  });
  return context;
}

describe('baseline', () => {
  const run = scenarioRun('baseline');
  test('reproduces the published catalog numbers', () => {
    assert.equal(run.result.summary.total_products, 5587);
    assert.equal(run.result.summary.n, 5578);
    assert.ok(Math.abs(run.result.summary.r - 0.7251) < 0.0001);
    assert.equal(run.result.summary.unmatched_rows, 0);
  });
});

describe('messy distributor spec feed', () => {
  const run = scenarioRun('spec-feed');
  test('suppresses every planted duplicate', () => {
    assert.equal(run.result.summary.duplicate_rows_suppressed, run.built.planted.duplicates);
  });
  test('quarantines every unknown ID', () => {
    assert.equal(run.result.summary.unmatched_rows, run.built.planted.unknown_ids);
  });
  test('keeps the manufacturer value for Pico 2 and both claims', () => {
    const clock = run.result.conflicts.find(c => c.product_id === '6006' && c.property === 'clock_hz');
    assert.equal(clock.status, 'conflict_reference_selected');
    assert.equal(clock.selected.value, 150e6);
    assert.ok(clock.claims.some(c => c.normalized.value === 160e6));
  });
  test('leaves the unreferenced dispute open and flags it as high priority', () => {
    const product = run.built.planted.disputed_product.replace('ADA:', '');
    const dispute = run.result.conflicts.find(c => c.product_id === product && c.property === 'flash_mb');
    assert.equal(dispute.status, 'conflict_requires_review');
    assert.equal(dispute.selected, null);
    assert.equal(find(run.insights, `conflict-${product}-flash_mb`).severity, 'high');
  });
});

describe('tariff price shock', () => {
  const run = scenarioRun('tariff-shock');
  test('changes exactly the patched prices', () => {
    assert.equal(run.result.summary.changed_fields, run.built.planted.price_patches);
    assert.ok(run.result.changes.every(c => c.basis === 'scenario_patch' && c.after > c.before));
  });
  test('recalculates the correlation against the untouched baseline', () => {
    assert.notEqual(run.result.summary.r, run.result.baseline.r);
    assert.ok(find(run.insights, 'correlation-shift'));
  });
  test('a uniform increase across the whole range leaves r unchanged (up to cent rounding)', () => {
    const result = runEngine(buildScenario(catalog, 'tariff-shock', {share: 100}).request);
    assert.ok(Math.abs(result.summary.r - result.baseline.r) < 1e-4);
  });
});

describe('packaging redesign', () => {
  const run = scenarioRun('packaging');
  test('analyses the whole chosen category', () => {
    assert.ok(run.result.summary.n >= 8);
    assert.equal(run.result.summary.changed_fields, run.built.planted.weight_patches);
  });
});

describe('warehouse cycle count', () => {
  const run = scenarioRun('warehouse');
  test('catches duplicates and unknown SKUs', () => {
    assert.equal(run.result.summary.duplicate_rows_suppressed, run.built.planted.duplicates);
    assert.equal(run.result.summary.unmatched_rows, run.built.planted.unknown_ids);
  });
  test('finds every listing that is in stock with an empty shelf', () => {
    assert.deepEqual(sorted(find(run.insights, 'listed-empty').products), sorted(run.built.planted.listed_but_empty));
  });
  test('finds every product on hand but shown out of stock', () => {
    assert.deepEqual(sorted(find(run.insights, 'stocked-unlisted').products), sorted(run.built.planted.stocked_but_unlisted));
  });
  test('suggests reorders for the planted low-stock products', () => {
    assert.deepEqual(sorted(find(run.insights, 'reorder').products), sorted(run.built.planted.low_stock));
  });
  test('quarantined stock is high priority because quantities are attached', () => {
    assert.equal(run.insights.find(i => i.id.startsWith('quarantine-WMS')).severity, 'high');
  });
});

describe('open purchase orders', () => {
  const run = scenarioRun('purchase-orders');
  test('links POs to stock-outs and flags overstock', () => {
    assert.deepEqual(sorted(find(run.insights, 'po-covers-stockout').products), sorted(run.built.planted.covers_stockout));
    assert.deepEqual(sorted(find(run.insights, 'overstock').products), sorted(run.built.planted.overstock_risk));
  });
});

describe('supplier inbox', () => {
  const run = scenarioRun('supplier-inbox');
  test('holds name-only messages for review and proposes exact name matches', () => {
    const named = run.insights.find(i => i.id.endsWith('-name'));
    assert.equal(named.count, run.built.planted.name_only_rows);
    assert.equal(named.products.length, run.built.planted.name_only_rows - run.built.planted.unmatched_names);
  });
  test('classifies supplier signals', () => {
    assert.ok(run.insights.some(i => i.id.startsWith('signal-')));
  });
});

describe('weekend sell-through', () => {
  const run = scenarioRun('sell-through');
  test('reports exactly the products that sell out', () => {
    assert.deepEqual(sorted(find(run.insights, 'sold-out').products), sorted(run.built.planted.sold_out));
  });
});

describe('next monthly catalog capture', () => {
  const run = scenarioRun('next-capture');
  test('diffs prices against the current capture', () => {
    const prices = run.result.changes.filter(c => c.field === 'price_value');
    assert.equal(prices.length, run.built.planted.price_moves);
    assert.ok(prices.every(c => c.basis === 'source_import'));
  });
  test('does not pool dropped listings with the new capture', () => {
    for (const id of run.built.planted.dropped_from_capture) {
      const product = run.result.products.find(p => p.product_id === id);
      if (!product.virtual) assert.equal(product.decision, 'other_price_source_or_currency', id);
    }
  });
});

describe('Monday operations review', () => {
  const run = scenarioRun('ops-morning');
  test('connects four synthetic sources in one run', () => {
    assert.equal(run.result.supplied_sources.length, 4);
    const kinds = new Set(run.result.evidence.map(e => e.kind));
    for (const kind of ['inventory', 'purchase_orders', 'communications']) assert.ok(kinds.has(kind), kind);
  });
  test('ranks high-severity suggestions first', () => {
    assert.equal(run.insights[0].severity, 'high');
  });
});

describe('engine safety', () => {
  test('an observed run rejects hypothetical patches', () => {
    const {request} = buildScenario(catalog, 'tariff-shock');
    assert.match(engineError({...request, mode: 'observed'}), /simulation mode/);
  });
  test('a batch with an unsupported unit is rejected as a whole', () => {
    const source = {id: 'BAD_UNITS', kind: 'specifications', label: 'Bad', captured_at: '2026-10-24', csv: 'record_id,product_id,property,value,unit\na,6006,clock,150,GHz\n'};
    assert.match(engineError({label: 'Bad', mode: 'simulation', sources: [source]}), /Supported specifications/);
  });
  test('demo runs never modify the source workspace', () => {
    const hash = workspaceHash();
    runEngine(buildScenario(catalog, 'ops-morning').request);
    assert.equal(workspaceHash(), hash);
  });
});

describe('planted vs caught scorecard', () => {
  for (const {id} of SCENARIOS.filter(s => s.id !== 'baseline')) {
    for (const seed of [42, 7]) {
      test(`${id} (seed ${seed}) catches everything it planted`, () => {
        const {request, planted} = buildScenario(catalog, id, {seed});
        const result = runEngine(request);
        const checks = plantedChecks(id, planted, result, deriveInsights(result));
        assert.ok(checks.length > 0, 'scenario should produce at least one check');
        for (const check of checks) assert.equal(check.caught, check.planted, check.label);
      });
    }
  }
});
