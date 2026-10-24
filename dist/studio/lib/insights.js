// Rule layer that turns a complete engine result into ranked, actionable suggestions.
// It reads only what the engine returned (products, evidence, conflicts, quarantine,
// changes, sources) and never re-decides matching or specification selection.

export const SEVERITY_ORDER = {high: 0, medium: 1, low: 2, info: 3};
export const LOW_STOCK = 5;
const OUTLIER_Z = 2.5;
const OUTLIER_LIMIT = 8;
export const OVERSTOCK_PUBLIC = 50;
export const OVERSTOCK_PO = 300;
const SIGNALS = [
  {id: 'delay', label: 'Supplier delay', pattern: /\b(delay|delayed|late|slip|rolled|revised eta)\b/i},
  {id: 'eol', label: 'End-of-life notice', pattern: /\b(end-of-life|end of life|eol|last time buy|discontinu)/i},
  {id: 'cost', label: 'Cost increase', pattern: /\b(price increase|surcharge|tariff|cost rises)\b/i},
  {id: 'allocation', label: 'Allocation / shortage', pattern: /\b(allocation|shortage)\b/i},
];

const fmt = value => (Number.isFinite(value) ? (Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(2)) : 'unknown');
const plural = (n, word, many = `${word}s`) => `${n.toLocaleString()} ${n === 1 ? word : many}`;

export function deriveInsights(result) {
  const products = new Map(result.products.map(p => [p.product_id, p]));
  const supplied = new Set(result.supplied_sources ?? []);
  const items = [
    ...quarantineInsights(result),
    ...duplicateInsights(result, supplied),
    ...conflictInsights(result, products, supplied),
    ...inventoryInsights(result, products),
    ...communicationInsights(result, products),
    ...scenarioInsights(result),
    ...pricingInsights(result),
    ...coverageInsights(result),
  ];
  return items.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.count - a.count);
}

function insight(fields) {
  return {products: [], count: fields.products?.length ?? 0, ...fields};
}

function quarantineInsights(result) {
  const groups = new Map();
  for (const row of result.quarantine ?? []) {
    const named = row.reason.startsWith('No exact');
    const key = `${row.source_id}|${named ? 'name' : 'id'}`;
    if (!groups.has(key)) groups.set(key, {row, named, rows: []});
    groups.get(key).rows.push(row);
  }
  return [...groups.values()].map(({row, named, rows}) => {
    const candidates = [...new Set(rows.flatMap(r => r.candidate_ids ?? []))].map(id => `ADA:${id}`);
    const money = row.kind === 'inventory' || row.kind === 'purchase_orders';
    const references = rows.map(r => r.raw.product_id || r.raw.product_name).filter(Boolean);
    return insight({
      id: `quarantine-${row.source_id}-${named ? 'name' : 'id'}`,
      severity: money ? 'high' : 'medium',
      area: 'Data quality',
      title: named
        ? `${plural(rows.length, 'row')} in ${row.source_label} ${rows.length === 1 ? 'names' : 'name'} a product without an ID`
        : `${plural(rows.length, 'row')} in ${row.source_label} ${rows.length === 1 ? 'points' : 'point'} at IDs not in the catalog`,
      detail: named
        ? `Held for review instead of guessing. ${candidates.length ? `${plural(candidates.length, 'exact name match', 'exact name matches')} found for confirmation.` : 'No catalog title matches exactly.'}`
        : `Unknown references: ${references.slice(0, 6).join(', ')}${references.length > 6 ? '…' : ''}. ${money ? 'Stock or money is attached to records the catalog cannot see.' : ''}`.trim(),
      action: named ? 'Confirm the suggested product or add the ID to the export' : 'Correct the ID mapping upstream or add the missing products to the catalog',
      products: candidates,
      count: rows.length,
    });
  });
}

function duplicateInsights(result, supplied) {
  return (result.sources ?? [])
    .filter(s => supplied.has(s.id) && s.duplicate_rows > 0)
    .map(s => insight({
      id: `duplicates-${s.id}`,
      severity: 'low',
      area: 'Data quality',
      title: `${plural(s.duplicate_rows, 'exact duplicate row')} suppressed in ${s.label}`,
      detail: `${plural(s.record_count, 'row')} received, ${plural(s.unique_rows, 'distinct row')} processed once each.`,
      action: 'Fix the export so each record is sent once',
      count: s.duplicate_rows,
    }));
}

function claimText(claim) {
  const n = claim.normalized;
  return n.property === 'clock_hz' ? `${fmt(n.value / 1e6)} MHz` : `${fmt(n.value)} ${n.unit.replace(' as published', '')}`;
}

function conflictInsights(result, products, supplied) {
  return (result.conflicts ?? []).map(conflict => {
    const id = `ADA:${conflict.product_id}`;
    const name = products.get(id)?.product_name ?? id;
    const values = [...new Set(conflict.claims.map(claimText))];
    const fromUpload = conflict.claims.some(c => supplied.has(c.source_id));
    const open = conflict.status === 'conflict_requires_review';
    return insight({
      id: `conflict-${conflict.product_id}-${conflict.property}`,
      severity: open ? 'high' : fromUpload ? 'medium' : 'info',
      area: 'Data quality',
      title: open
        ? `${name}: ${conflict.property.replace('_', ' ')} claims disagree with no trusted reference`
        : `${name}: ${fromUpload ? 'new' : 'existing'} claim disagrees with the manufacturer reference`,
      detail: `Claims seen: ${values.join(' vs ')}. ${open ? 'Nothing is selected until someone reviews it.' : `Selected ${claimText({normalized: conflict.selected ?? conflict.claims[0].normalized})} from the reviewed reference; every claim is kept.`}`,
      action: open ? 'Review the source documents and record the correct value' : 'Correct the disagreeing source so listings stay consistent',
      products: [id],
    });
  });
}

function evidenceBy(result, kind) {
  const map = new Map();
  for (const row of result.evidence ?? []) {
    if (row.kind !== kind) continue;
    if (!map.has(row.product_id)) map.set(row.product_id, []);
    map.get(row.product_id).push(row);
  }
  return map;
}

// Latest count per warehouse, so a later capture replaces an earlier one.
function onHand(rows) {
  const latest = new Map();
  for (const row of rows) {
    const site = row.raw.warehouse_id;
    if (!latest.has(site) || latest.get(site).captured_at <= row.captured_at) latest.set(site, row);
  }
  return [...latest.values()].reduce((sum, row) => sum + (row.normalized?.quantity ?? 0), 0);
}

function inventoryInsights(result, products) {
  const stock = evidenceBy(result, 'inventory');
  const orders = evidenceBy(result, 'purchase_orders');
  const listedEmpty = [], hidden = [], reorder = [], covered = [], overstock = [];
  for (const [id, rows] of stock) {
    const product = products.get(id);
    if (!product) continue;
    const total = onHand(rows);
    if (product.availability === 'in_stock' && total === 0) listedEmpty.push(id);
    else if (product.availability === 'out_of_stock' && total > 0) hidden.push(id);
    else if (total > 0 && total <= LOW_STOCK && !orders.has(id)) reorder.push(id);
  }
  for (const [id, rows] of orders) {
    const product = products.get(id);
    if (!product) continue;
    const ordered = rows.reduce((sum, row) => sum + (row.normalized?.quantity ?? 0), 0);
    if (product.availability === 'out_of_stock') covered.push(id);
    else if ((product.public_quantity ?? 0) >= OVERSTOCK_PUBLIC && ordered >= OVERSTOCK_PO) overstock.push(id);
  }
  const make = (ids, fields) => (ids.length ? [insight({...fields, products: ids})] : []);
  return [
    ...make(listedEmpty, {id: 'listed-empty', severity: 'high', area: 'Inventory', title: `${plural(listedEmpty.length, 'product')} listed in stock with nothing on the shelf`, detail: 'The storefront shows in stock, but every counted warehouse reports zero. Orders would oversell.', action: 'Pause or mark these listings out of stock until the count is confirmed'}),
    ...make(hidden, {id: 'stocked-unlisted', severity: 'medium', area: 'Inventory', title: `${plural(hidden.length, 'product')} in a warehouse but shown out of stock`, detail: 'Units are on hand while the public listing says out of stock, so sales are being turned away.', action: 'Release the counted stock to the storefront'}),
    ...make(reorder, {id: 'reorder', severity: 'medium', area: 'Supply', title: `${plural(reorder.length, 'product')} at ${LOW_STOCK} units or fewer with no open PO`, detail: 'Low on-hand quantity and nothing inbound in the purchase order export.', action: 'Raise purchase orders or confirm these are being run down on purpose'}),
    ...make(covered, {id: 'po-covers-stockout', severity: 'info', area: 'Supply', title: `${plural(covered.length, 'stock-out')} already covered by an open PO`, detail: 'Inbound orders exist for products currently shown out of stock.', action: 'Show the expected date on these listings'}),
    ...make(overstock, {id: 'overstock', severity: 'low', area: 'Supply', title: `${plural(overstock.length, 'large PO', 'large POs')} on products that already have plenty`, detail: `Public quantity is ${OVERSTOCK_PUBLIC}+ and ${OVERSTOCK_PO}+ more units are on order.`, action: 'Check whether these orders can be reduced or delayed'}),
  ];
}

function communicationInsights(result, products) {
  const hits = new Map(SIGNALS.map(s => [s.id, []]));
  for (const [id, rows] of evidenceBy(result, 'communications')) {
    for (const row of rows) {
      const text = `${row.raw.subject ?? ''} ${row.raw.excerpt ?? ''}`;
      const signal = SIGNALS.find(s => s.pattern.test(text));
      if (signal && !hits.get(signal.id).includes(id)) hits.get(signal.id).push(id);
    }
  }
  return SIGNALS.filter(s => hits.get(s.id).length).map(signal => {
    const ids = hits.get(signal.id);
    const exposed = ids.filter(id => products.get(id)?.availability !== 'in_stock' || (products.get(id)?.public_quantity ?? Infinity) <= LOW_STOCK);
    return insight({
      id: `signal-${signal.id}`,
      severity: exposed.length && signal.id !== 'cost' ? 'high' : 'medium',
      area: 'Supply',
      title: `${signal.label} affects ${plural(ids.length, 'product')}`,
      detail: `${exposed.length ? `${plural(exposed.length, 'of them is', 'of them are')} already out of stock or low. ` : ''}Linked from supplier messages by exact product ID.`,
      action: signal.id === 'cost' ? 'Review margins and decide whether to reprice' : signal.id === 'eol' ? 'Decide on a last-time buy and plan a replacement' : 'Update expected dates and customer messaging',
      products: ids,
    });
  });
}

function scenarioInsights(result) {
  const items = [];
  const before = result.baseline_analysis?.r, after = result.analysis?.r;
  if (Number.isFinite(before) && Number.isFinite(after) && Math.abs(after - before) >= 0.005) {
    items.push(insight({
      id: 'correlation-shift', severity: 'info', area: 'Scenario',
      title: `${label(result.analysis.x)} vs ${label(result.analysis.y)} correlation moved ${fmt(before)} → ${fmt(after)}`,
      detail: `Same filters, ${plural(result.analysis.n, 'pair')} after versus ${plural(result.baseline_analysis.n, 'pair')} in the baseline. An association, not a cause.`,
      action: 'Use this to judge how far the change pulls products off the existing pattern',
      count: 1,
    }));
  }
  const prices = (result.changes ?? []).filter(c => c.field === 'price_value' && Number.isFinite(c.before) && Number.isFinite(c.after) && c.before > 0);
  if (prices.length) {
    const moves = prices.map(c => (c.after - c.before) / c.before);
    const up = moves.filter(m => m > 0).length;
    const largest = [...prices].sort((a, b) => Math.abs(b.after - b.before) / b.before - Math.abs(a.after - a.before) / a.before).slice(0, OUTLIER_LIMIT);
    items.push(insight({
      id: 'price-changes', severity: 'medium', area: 'Pricing',
      title: `${plural(prices.length, 'price')} changed (${up} up, ${prices.length - up} down)`,
      detail: `Average move ${fmt(100 * moves.reduce((a, b) => a + b, 0) / moves.length)}%. ${prices[0].basis === 'scenario_patch' ? 'Hypothetical what-if values.' : 'From the newly supplied catalog capture.'}`,
      action: 'Check the largest moves before they reach the storefront',
      products: largest.map(c => c.product_id), count: prices.length,
    }));
  }
  const soldOut = (result.changes ?? []).filter(c => c.field === 'availability' && c.before === 'in_stock' && c.after === 'out_of_stock');
  if (soldOut.length) {
    items.push(insight({id: 'sold-out', severity: 'high', area: 'Inventory', title: `${plural(soldOut.length, 'product')} would go out of stock`, detail: 'Public quantity reaches zero under this scenario.', action: 'Prioritise these for replenishment', products: soldOut.map(c => c.product_id)}));
  }
  const left = [...new Set((result.changes ?? []).filter(c => !c.in_selected_output).map(c => c.product_id))];
  if (left.length) {
    items.push(insight({id: 'left-selection', severity: 'info', area: 'Scenario', title: `${plural(left.length, 'changed product')} fall outside the current filters`, detail: 'They changed but are not part of this selection, so they are not in the analysis.', action: 'Widen the filters to include them', products: left}));
  }
  return items;
}

// Log-log trend between weight and price; products far from it are worth a pricing review.
function pricingInsights(result) {
  const {x, y} = result.analysis ?? {};
  if (x !== 'shipping_weight_g' || y !== 'price_value') return [];
  const points = result.products.filter(p => p.decision === 'Included' && p.pair_x > 0 && p.pair_y > 0)
    .map(p => ({id: p.product_id, lx: Math.log10(p.pair_x), ly: Math.log10(p.pair_y)}));
  if (points.length < 20) return [];
  const fit = trend(points);
  const scored = points.map(p => ({...p, z: (p.ly - (fit.intercept + fit.slope * p.lx)) / fit.sd}));
  const high = scored.filter(p => p.z >= OUTLIER_Z).sort((a, b) => b.z - a.z);
  const low = scored.filter(p => p.z <= -OUTLIER_Z).sort((a, b) => a.z - b.z);
  const make = (list, direction) => (list.length ? [insight({
    id: `outliers-${direction}`, severity: 'low', area: 'Pricing',
    title: `${plural(list.length, 'product')} priced well ${direction} the weight trend`,
    detail: `More than ${OUTLIER_Z} standard deviations from the log price vs log weight line across ${plural(points.length, 'product')}. Often legitimate (chips, tools, bulk packs), sometimes a pricing or weight error.`,
    action: direction === 'above' ? 'Check for overpricing or a wrong shipping weight' : 'Check for underpricing or an inflated shipping weight',
    products: list.slice(0, OUTLIER_LIMIT).map(p => p.id), count: list.length,
  })] : []);
  return [...make(high, 'above'), ...make(low, 'below')];
}

export function trend(points) {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.lx, 0) / n;
  const my = points.reduce((s, p) => s + p.ly, 0) / n;
  let sxx = 0, sxy = 0;
  for (const p of points) { sxx += (p.lx - mx) ** 2; sxy += (p.lx - mx) * (p.ly - my); }
  const slope = sxx ? sxy / sxx : 0;
  const intercept = my - slope * mx;
  const sd = Math.sqrt(points.reduce((s, p) => s + (p.ly - intercept - slope * p.lx) ** 2, 0) / Math.max(1, n - 2)) || 1;
  return {slope, intercept, sd};
}

function coverageInsights(result) {
  const s = result.summary;
  const items = [];
  if (s.missing_manufacturer > 0) items.push(insight({id: 'missing-manufacturer', severity: 'low', area: 'Data quality', title: `${plural(s.missing_manufacturer, 'selected product')} ${s.missing_manufacturer === 1 ? 'has' : 'have'} no manufacturer`, detail: `That is ${fmt(100 * s.missing_manufacturer / Math.max(1, s.selected_products))}% of the selection, which weakens per-manufacturer analysis.`, action: 'Fill manufacturer in the catalog source', count: s.missing_manufacturer}));
  if (s.unconfirmed_currency > 0) items.push(insight({id: 'currency', severity: 'info', area: 'Data quality', title: 'Currency is not stated in the catalog feed', detail: `${plural(s.unconfirmed_currency, 'price')} use source units. Prices are never pooled across currencies or captures.`, action: 'Add an ISO currency code to the catalog export', count: s.unconfirmed_currency}));
  return items;
}

const LABELS = {price_value: 'Price', shipping_weight_g: 'Weight', public_quantity: 'Public quantity', clock_mhz: 'Clock', sram_kb: 'SRAM', flash_mb: 'Flash'};
export const label = metric => LABELS[metric] ?? metric;
