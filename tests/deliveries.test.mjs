import assert from 'node:assert/strict';
import {describe, test} from 'node:test';
import {classify, compare, findPatterns, histogram, impact, parseTime, performance, relationship, shipmentsFrom, wilson, windowOdds} from '../dist/studio/lib/deliveries.js';
import {buildScenario} from '../dist/studio/lib/scenarios.js';
import {NOON_EXAMPLE} from '../dist/studio/lib/shipments.js';
import {loadCatalog, runEngine} from './engine-harness.mjs';

const ship = (fields = {}) => ({record_id: Math.random().toString(36), delay: 0, status: 'on_time', carrier: 'A', route: 'R', supplier: 'S', slot: 'Morning', period: 'Earlier', distance: 100, expedite: 0, freight: 10, availability: 'in_stock', product_id: 'ADA:1', ...fields});

describe('timestamps', () => {
  test('parses warehouse local times', () => {
    assert.equal(parseTime('2026-10-20T12:10') - parseTime('2026-10-20T12:00'), 10);
  });
  test('rejects impossible or missing times', () => {
    for (const bad of ['2026-13-40T25:00', 'TBD', '', '2026-02-30T10:00', null]) assert.equal(parseTime(bad), null, String(bad));
  });
});

describe('classification and summaries', () => {
  test('uses the tolerance on both sides', () => {
    assert.deepEqual([-6, -5, 0, 5, 6, null].map(d => classify(d, 5)), ['early', 'on_time', 'on_time', 'on_time', 'late', 'unknown']);
  });

  test('performance ignores shipments without an arrival', () => {
    const p = performance([ship({delay: 10, status: 'late'}), ship(), ship({delay: null, status: 'unknown'})]);
    assert.equal(p.n, 2);
    assert.equal(p.late_rate, 0.5);
  });

  test('wilson interval contains the observed rate and stays in [0, 1]', () => {
    const w = wilson(3, 10);
    assert.ok(w.low < 0.3 && w.high > 0.3 && w.low >= 0 && w.high <= 1);
    assert.equal(wilson(0, 0).rate, null);
  });

  test('histogram clamps outliers into the end bins', () => {
    const bins = histogram([ship({delay: -60, status: 'early'}), ship({delay: 500, status: 'late'})]);
    assert.equal(bins[0].early, 1);
    assert.equal(bins.at(-1).late, 1);
  });

  test('compare flags small groups', () => {
    const rows = compare([...Array(40)].map(() => ship({carrier: 'Big'})).concat([ship({carrier: 'Tiny'})]), 'carrier');
    assert.equal(rows.find(r => r.key === 'Tiny').small, true);
    assert.equal(rows.find(r => r.key === 'Big').small, false);
  });

  test('arrival window odds count shipments within the window', () => {
    const odds = windowOdds([ship({delay: 9}), ship({delay: -10}), ship({delay: 11}), ship({delay: 40})], 10);
    assert.equal(odds.hits, 2);
    assert.equal(odds.n, 4);
  });

  test('relationship needs enough points', () => {
    assert.equal(relationship([ship()]).r, null);
  });

  test('impact counts late shipments for sold-out products', () => {
    const result = impact([ship({status: 'late', availability: 'out_of_stock', expedite: 100}), ship({status: 'late', expedite: 50}), ship()]);
    assert.equal(result.stockout_late, 1);
    assert.equal(result.expedite_total, 150);
  });
});

describe('pattern finding', () => {
  // Afternoon carrier X is late 80% of the time; everything else 10%.
  const data = [];
  for (let i = 0; i < 400; i++) {
    const pm = i % 2 === 0, carrier = i % 4 < 2 ? 'X' : 'Y';
    const late = carrier === 'X' && pm ? i % 5 !== 0 : i % 10 === 0;
    data.push(ship({carrier, slot: pm ? 'Afternoon' : 'Morning', delay: late ? 30 : 0, status: late ? 'late' : 'on_time', route: carrier === 'X' ? 'RX' : 'RY'}));
  }

  test('finds the specific segment rather than the broad one', () => {
    const {problems} = findPatterns(data);
    assert.equal(problems[0].key, 'X · Afternoon');
    assert.ok(!problems.some(p => p.key === 'X'), 'carrier X alone is explained by its afternoons');
  });

  test('ignores segments below the minimum sample size', () => {
    const {problems} = findPatterns(data.slice(0, 20));
    assert.equal(problems.length, 0);
  });
});

describe('delivery scenario through the engine', () => {
  const catalog = loadCatalog();
  const {request} = buildScenario(catalog, 'deliveries');
  const {shipments, quality} = shipmentsFrom(runEngine(request));

  test('keeps the noon example from the brief: expected 12:00, arrived 12:10', () => {
    const noon = shipments.find(s => s.record_id === NOON_EXAMPLE.record_id);
    assert.equal(noon.delay, 10);
    assert.equal(noon.status, 'late');
  });

  test('every matched shipment is traceable to its source row', () => {
    assert.equal(quality.matched, shipments.length);
    assert.ok(shipments.every(s => s.raw.record_id && s.po));
  });
});
