// Compares what a scenario deliberately planted with what the engine and suggestions caught.
// Used for the "planted vs caught" scorecard in demos.

const ids = (insights, id) => new Set(insights.find(i => i.id === id)?.products ?? []);
const caughtList = (planted, found) => planted.filter(id => found.has(id)).length;

function sourceRow(result, prefix) {
  return (result.sources ?? []).find(s => s.id.startsWith(prefix)) ?? {duplicate_rows: 0, unmatched_rows: 0};
}

function sourceChecks(name, planted, source) {
  const checks = [];
  if ('duplicates' in planted) checks.push({label: `${name}: exact duplicates suppressed`, planted: planted.duplicates, caught: source.duplicate_rows});
  if ('unknown_ids' in planted) checks.push({label: `${name}: unknown IDs quarantined`, planted: planted.unknown_ids, caught: source.unmatched_rows});
  return checks;
}

function listCheck(label, planted, found) {
  return planted?.length ? [{label, planted: planted.length, caught: caughtList(planted, found)}] : [];
}

const BUILDERS = {
  specs: (p, result) => [
    ...sourceChecks('Spec feed', p, sourceRow(result, 'DISTRIBUTOR_SPECS')),
    // The disputed product can fall outside the run's filters; only score it when it is in view.
    ...(result.products.some(x => x.product_id === p.disputed_product)
      ? [{label: 'Spec feed: disagreement with no trusted reference left open', planted: p.open_conflicts, caught: result.conflicts.filter(c => c.status === 'conflict_requires_review').length}]
      : []),
  ],
  inventory: (p, result, insights) => [
    ...sourceChecks('Cycle count', p, sourceRow(result, 'WMS_COUNT')),
    ...listCheck('Listed in stock, empty shelf', p.listed_but_empty, ids(insights, 'listed-empty')),
    ...listCheck('On hand, shown out of stock', p.stocked_but_unlisted, ids(insights, 'stocked-unlisted')),
    ...listCheck('Low stock with no PO', p.low_stock, ids(insights, 'reorder')),
  ],
  purchase_orders: (p, result, insights) => [
    ...sourceChecks('Purchase orders', p, sourceRow(result, 'ERP_OPEN_POS')),
    ...listCheck('POs covering stock-outs', p.covers_stockout, ids(insights, 'po-covers-stockout')),
    ...listCheck('Overstock risk', p.overstock_risk, ids(insights, 'overstock')),
  ],
  inbox: (p, result) => [{label: 'Messages without an ID held for review', planted: p.name_only_rows, caught: sourceRow(result, 'SUPPLIER_INBOX').unmatched_rows}],
};

export function plantedChecks(scenarioId, planted, result, insights) {
  if (!planted || !result) return [];
  const filtered = scenarioId === 'ops-morning' ? planted : {
    'spec-feed': {specs: planted}, warehouse: {inventory: planted}, 'purchase-orders': {purchase_orders: planted}, 'supplier-inbox': {inbox: planted},
  }[scenarioId];
  const checks = [];
  if (filtered) {
    const map = {specs: 'specs', inventory: 'inventory', purchase_orders: 'purchase_orders', inbox: 'inbox'};
    for (const [key, value] of Object.entries(filtered)) if (map[key]) checks.push(...BUILDERS[map[key]](value, result, insights));
  }
  if ('price_patches' in planted) checks.push({label: 'Hypothetical price changes applied', planted: planted.price_patches, caught: result.changes.filter(c => c.field === 'price_value').length});
  if ('weight_patches' in planted) checks.push({label: 'Hypothetical weight changes applied', planted: planted.weight_patches, caught: result.changes.filter(c => c.field === 'shipping_weight_g').length});
  if ('sold_out' in planted) checks.push(...listCheck('Products that sell out', planted.sold_out, ids(insights, 'sold-out')));
  if ('price_moves' in planted) checks.push({label: 'Price moves detected in new capture', planted: planted.price_moves, caught: result.changes.filter(c => c.field === 'price_value').length});
  if (planted.dropped_from_capture?.length) {
    const kept = result.products.filter(p => planted.dropped_from_capture.includes(p.product_id) && !p.virtual);
    checks.push({label: 'Dropped listings kept out of the new price cohort', planted: kept.length, caught: kept.filter(p => p.decision === 'other_price_source_or_currency').length});
  }
  return checks;
}
