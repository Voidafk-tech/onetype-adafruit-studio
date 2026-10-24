import assert from 'node:assert/strict';
import {describe, test} from 'node:test';
import {deriveInsights, trend} from '../dist/studio/lib/insights.js';
import {detectKind, parseCsv, toCsv} from '../dist/studio/lib/csv.js';

const product = (id, fields = {}) => ({product_id: id, product_name: id, availability: 'in_stock', public_quantity: 20, decision: 'Included', ...fields});
const stock = (id, warehouse, quantity, captured_at = '2026-10-24') => ({kind: 'inventory', product_id: id, captured_at, raw: {warehouse_id: warehouse}, normalized: {quantity}});
const result = (fields = {}) => ({
  products: [], evidence: [], conflicts: [], quarantine: [], changes: [], sources: [], supplied_sources: [],
  summary: {missing_manufacturer: 0, unconfirmed_currency: 0, selected_products: 0},
  analysis: {x: 'price_value', y: 'public_quantity'},
  ...fields,
});
const ids = (insights, id) => insights.find(i => i.id === id)?.products ?? [];

describe('inventory rules', () => {
  test('uses the latest count per warehouse', () => {
    const insights = deriveInsights(result({
      products: [product('ADA:1')],
      evidence: [stock('ADA:1', 'NYC', 40, '2026-10-01'), stock('ADA:1', 'NYC', 0, '2026-10-20')],
    }));
    assert.deepEqual(ids(insights, 'listed-empty'), ['ADA:1']);
  });

  test('sums distinct warehouses before deciding', () => {
    const insights = deriveInsights(result({
      products: [product('ADA:2', {availability: 'out_of_stock'})],
      evidence: [stock('ADA:2', 'NYC', 0), stock('ADA:2', 'NJ', 7)],
    }));
    assert.deepEqual(ids(insights, 'stocked-unlisted'), ['ADA:2']);
  });

  test('does not suggest a reorder when a PO is open', () => {
    const insights = deriveInsights(result({
      products: [product('ADA:3')],
      evidence: [stock('ADA:3', 'NYC', 2), {kind: 'purchase_orders', product_id: 'ADA:3', raw: {}, normalized: {quantity: 50}}],
    }));
    assert.deepEqual(ids(insights, 'reorder'), []);
  });
});

describe('supplier signals', () => {
  test('raises severity when the product is already out of stock', () => {
    const insights = deriveInsights(result({
      products: [product('ADA:4', {availability: 'out_of_stock'})],
      evidence: [{kind: 'communications', product_id: 'ADA:4', raw: {subject: 'Shipment delay on PO-1', excerpt: ''}}],
    }));
    assert.equal(insights.find(i => i.id === 'signal-delay').severity, 'high');
  });

  test('ignores routine messages', () => {
    const insights = deriveInsights(result({
      products: [product('ADA:5')],
      evidence: [{kind: 'communications', product_id: 'ADA:5', raw: {subject: 'Updated datasheet', excerpt: 'New photos attached.'}}],
    }));
    assert.equal(insights.filter(i => i.id.startsWith('signal-')).length, 0);
  });
});

describe('ordering and pricing', () => {
  test('sorts by severity first', () => {
    const insights = deriveInsights(result({
      products: [product('ADA:6'), product('ADA:7', {availability: 'out_of_stock'})],
      evidence: [stock('ADA:6', 'NYC', 0)],
      summary: {missing_manufacturer: 1, unconfirmed_currency: 2, selected_products: 2},
    }));
    assert.deepEqual(insights.map(i => i.severity), ['high', 'low', 'info']);
  });

  test('fits an exact log-log line', () => {
    const points = [1, 2, 3, 4].map(lx => ({lx, ly: 0.5 + 2 * lx}));
    const fit = trend(points);
    assert.ok(Math.abs(fit.slope - 2) < 1e-9 && Math.abs(fit.intercept - 0.5) < 1e-9);
  });

  test('flags a product priced far above its weight trend', () => {
    const products = Array.from({length: 60}, (_, i) => product(`ADA:${i + 10}`, {pair_x: 10 + i, pair_y: (10 + i) * (1 + 0.02 * Math.sin(i))}));
    products.push(product('ADA:999', {pair_x: 30, pair_y: 3000}));
    const insights = deriveInsights(result({products, analysis: {x: 'shipping_weight_g', y: 'price_value'}}));
    assert.ok(ids(insights, 'outliers-above').includes('ADA:999'));
  });
});

describe('csv helpers', () => {
  test('round-trips quotes, commas and newlines', () => {
    const records = [{a: 'x, "y"', b: 'line\nbreak'}, {a: '1', b: ''}];
    assert.deepEqual(parseCsv(toCsv(records)).records, records);
  });

  test('detects the source kind from headers', () => {
    assert.equal(detectKind(['record_id', 'product_id', 'warehouse_id', 'quantity']), 'inventory');
    assert.equal(detectKind(['purchase_order_id', 'product_id', 'quantity']), 'purchase_orders');
    assert.equal(detectKind(['product_id', 'subject']), 'communications');
    assert.equal(detectKind(['product_id', 'property', 'value', 'unit']), 'specifications');
    assert.equal(detectKind(['product_id', 'product_name', 'product_price']), 'catalog');
  });
});
