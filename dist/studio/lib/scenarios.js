// Seeded demo scenarios. Each builds a valid engine request from the real catalog index,
// plus a list of what was deliberately planted so the run can be checked against it.
// All generated values are hypothetical and every scenario runs in simulation mode.
import {createRandom, round} from './random.js';
import {toCsv} from './csv.js';

export const DEMO_DATE = '2026-10-24';
const WAREHOUSES = ['NYC-MAIN', 'NJ-OVERFLOW', 'RENO-WEST'];
const SUPPLIERS = ['Raspberry Pi Ltd', 'Espressif Systems', 'Digi-Key Distribution', 'Shenzhen PCB Works', 'Mouser Electronics'];
const UNKNOWN_IDS = ['99999901', '99999917', '88880042', '77770005', '99990333', '66660021'];
const BOARD_NAME = /(pico|feather|esp32|qt py|metro|itsybitsy|trinket|circuit playground|kb2040|rp2040|rp2350|arduino)/i;

// Plausible chip figures keyed by name fragments; anything unmatched gets a generic profile.
const CHIP_PROFILES = [
  {match: /rp2350|pico 2/i, clock: 150, sram: 520, flash: 4},
  {match: /rp2040|pico|kb2040/i, clock: 133, sram: 264, flash: 2},
  {match: /esp32-s3/i, clock: 240, sram: 512, flash: 8},
  {match: /esp32-s2/i, clock: 240, sram: 320, flash: 4},
  {match: /esp32/i, clock: 240, sram: 520, flash: 4},
  {match: /m4|samd51/i, clock: 120, sram: 192, flash: 2},
  {match: /nrf52840|bluefruit/i, clock: 64, sram: 256, flash: 1},
  {match: /m0|samd21|trinket|qt py/i, clock: 48, sram: 32, flash: 4},
];
const GENERIC_PROFILE = {clock: 48, sram: 32, flash: 2};

const COMMUNICATION_TEMPLATES = [
  {signal: 'delay', subject: 'Shipment delay on PO {po}', excerpt: 'Carrier rolled the container; revised ETA is {weeks} weeks later than confirmed.'},
  {signal: 'cost', subject: 'Price increase notice effective next quarter', excerpt: 'Unit cost rises {pct}% due to tariff and substrate surcharges.'},
  {signal: 'eol', subject: 'End-of-life notice and last time buy window', excerpt: 'Last time buy orders accepted for {weeks} more weeks; no drop-in replacement yet.'},
  {signal: 'allocation', subject: 'Allocation: shortage on wafer supply', excerpt: 'We can fill {pct}% of open quantity this month under allocation.'},
  {signal: 'none', subject: 'Updated datasheet and packaging photos', excerpt: 'Attached the new revision of the datasheet and packaging photos for listing.'},
];

const fill = (template, values) => template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '');
const sourceId = (prefix, seed) => `${prefix}_${seed}`;
const physical = catalog => catalog.products.filter(p => !p.virtual);
const boards = catalog => physical(catalog).filter(p => BOARD_NAME.test(p.name));
const profileFor = name => CHIP_PROFILES.find(p => p.match.test(name)) ?? GENERIC_PROFILE;
const inScope = (catalog, manufacturer) => physical(catalog).filter(p => !manufacturer || p.manufacturer === manufacturer);

// Exactly one of several ID spellings the engine accepts, so the run shows normalization.
function messyId(rand, product) {
  const numeric = product.id.replace('ADA:', '');
  return rand.pick([numeric, `ADA${numeric}`, ` ${numeric} `, `adafruit:${numeric}`, `https://www.adafruit.com/product/${numeric}`, `000${numeric}`]);
}

function source({id, kind, label, records, headers}) {
  return {id, kind, label, captured_at: DEMO_DATE, csv: toCsv(records, headers)};
}

function request({label, filters = {}, analysis, sources = [], patches = []}) {
  return {label, base: 'workspace', mode: 'simulation', filters, analysis: analysis ?? {x: 'shipping_weight_g', y: 'price_value'}, sources, patches};
}

function withDuplicates(rand, records, count) {
  const copies = rand.sample(records, count).map(row => ({...row}));
  return {records: [...records, ...copies], duplicates: copies.length};
}

function unknownRows(rand, count, make) {
  return rand.sample(UNKNOWN_IDS, count).map((id, i) => make(id, i));
}

// ---------- individual source builders (reused by the combined scenario) ----------

function specFeed(catalog, {seed, rows, messiness}) {
  const rand = createRandom(seed);
  const targets = rand.sample(boards(catalog), rows);
  const records = [];
  targets.forEach((product, i) => {
    const profile = profileFor(product.name);
    const property = rand.pick(['clock', 'sram', 'flash']);
    const inHz = rand.chance(0.3);
    const value = property === 'clock' ? (inHz ? profile.clock * 1e6 : profile.clock) : profile[property];
    const unit = property === 'clock' ? (inHz ? 'Hz' : 'MHz') : property === 'sram' ? rand.pick(['kB', 'KB']) : 'MB';
    records.push({record_id: `spec-${i + 1}`, product_id: messyId(rand, product), property, value, unit});
  });
  // Planted disagreement with the bundled manufacturer reference for Pico 2.
  records.push({record_id: 'spec-pico2-clock', product_id: 'ADA6006', property: 'clock', value: 160, unit: 'MHz'});
  // Planted disagreement with no trusted reference: two supplier claims that cannot both be right.
  const disputed = targets.find(p => !/pico/i.test(p.name)) ?? targets[0];
  const disputedId = disputed.id.replace('ADA:', '');
  if (disputed) {
    records.push({record_id: 'spec-dispute-a', product_id: disputedId, property: 'flash', value: 4, unit: 'MB'});
    records.push({record_id: 'spec-dispute-b', product_id: disputedId, property: 'flash', value: 8, unit: 'MB'});
  }
  const unknown = unknownRows(rand, Math.max(1, Math.round(rows * messiness / 10)), (id, i) => ({record_id: `spec-unknown-${i + 1}`, product_id: id, property: 'sram', value: 64, unit: 'kB'}));
  const dup = withDuplicates(rand, [...records, ...unknown], Math.max(1, Math.round(rows * messiness / 5)));
  return {
    source: source({id: sourceId('DISTRIBUTOR_SPECS', seed), kind: 'specifications', label: 'Distributor spec feed (synthetic)', records: dup.records, headers: ['record_id', 'product_id', 'property', 'value', 'unit']}),
    planted: {duplicates: dup.duplicates, unknown_ids: unknown.length, reference_conflicts: 1, open_conflicts: disputed ? 1 : 0, disputed_product: disputed ? disputed.id : null},
  };
}

function warehouseCount(catalog, {seed, rows, manufacturer, mismatches}) {
  const rand = createRandom(seed + 1);
  const pool = inScope(catalog, manufacturer);
  const targets = rand.sample(pool, rows);
  const inStock = targets.filter(p => p.availability === 'in_stock');
  const outOfStock = targets.filter(p => p.availability === 'out_of_stock');
  const ghost = new Set(rand.sample(inStock, mismatches).map(p => p.id));
  const hidden = new Set(rand.sample(outOfStock, mismatches).map(p => p.id));
  const low = new Set(rand.sample(inStock.filter(p => !ghost.has(p.id)), mismatches).map(p => p.id));
  const records = [];
  let n = 0;
  for (const product of targets) {
    const sites = rand.sample(WAREHOUSES, rand.int(1, WAREHOUSES.length));
    for (const warehouse of sites) {
      let quantity = product.availability === 'in_stock' ? rand.int(8, 400) : 0;
      if (ghost.has(product.id)) quantity = 0;
      if (hidden.has(product.id)) quantity = warehouse === sites[0] ? rand.int(12, 90) : 0;
      if (low.has(product.id)) quantity = warehouse === sites[0] ? rand.int(1, 4) : 0;
      records.push({record_id: `inv-${++n}`, product_id: messyId(rand, product), warehouse_id: warehouse, quantity, bin: `${warehouse.slice(0, 3)}-${rand.int(1, 40)}-${rand.pick('ABCDEF')}`, counted_at: DEMO_DATE});
    }
  }
  const unknown = unknownRows(rand, 2, (id, i) => ({record_id: `inv-unknown-${i + 1}`, product_id: id, warehouse_id: 'NYC-MAIN', quantity: rand.int(5, 50), bin: 'NYC-99-Z', counted_at: DEMO_DATE}));
  const dup = withDuplicates(rand, [...records, ...unknown], 3);
  return {
    source: source({id: sourceId('WMS_COUNT', seed), kind: 'inventory', label: 'Warehouse cycle count export (synthetic)', records: dup.records, headers: ['record_id', 'product_id', 'warehouse_id', 'quantity', 'bin', 'counted_at']}),
    planted: {duplicates: dup.duplicates, unknown_ids: unknown.length, listed_but_empty: [...ghost], stocked_but_unlisted: [...hidden], low_stock: [...low]},
  };
}

function purchaseOrders(catalog, {seed, rows, manufacturer}) {
  const rand = createRandom(seed + 2);
  const pool = inScope(catalog, manufacturer);
  const stockouts = rand.sample(pool.filter(p => p.availability === 'out_of_stock'), Math.ceil(rows / 2));
  const heavy = rand.sample(pool.filter(p => (p.quantity ?? 0) >= 50), Math.max(1, Math.floor(rows / 6)));
  const rest = rand.sample(pool.filter(p => p.availability === 'in_stock'), Math.max(0, rows - stockouts.length - heavy.length));
  const records = [];
  let po = 4100 + (seed % 500);
  const add = (product, quantity) => records.push({
    record_id: `po-${records.length + 1}`,
    purchase_order_id: `PO-${++po}`,
    product_id: messyId(rand, product),
    quantity,
    supplier: rand.pick(SUPPLIERS),
    expected_date: `2026-${rand.pick(['11', '12'])}-${String(rand.int(1, 28)).padStart(2, '0')}`,
    status: 'open',
  });
  stockouts.forEach(p => add(p, rand.int(50, 500)));
  heavy.forEach(p => add(p, rand.int(300, 1500)));
  rest.forEach(p => add(p, rand.int(20, 200)));
  const unknown = unknownRows(rand, 1, (id, i) => ({record_id: `po-unknown-${i + 1}`, purchase_order_id: `PO-${++po}`, product_id: id, quantity: 100, supplier: rand.pick(SUPPLIERS), expected_date: '2026-12-01', status: 'open'}));
  const dup = withDuplicates(rand, [...records, ...unknown], 1);
  return {
    source: source({id: sourceId('ERP_OPEN_POS', seed), kind: 'purchase_orders', label: 'ERP open purchase orders (synthetic)', records: dup.records, headers: ['record_id', 'purchase_order_id', 'product_id', 'quantity', 'supplier', 'expected_date', 'status']}),
    planted: {duplicates: dup.duplicates, unknown_ids: unknown.length, covers_stockout: stockouts.map(p => p.id), overstock_risk: heavy.map(p => p.id)},
    poNumbers: records.map(r => r.purchase_order_id),
  };
}

function supplierInbox(catalog, {seed, rows, manufacturer, poNumbers = []}) {
  const rand = createRandom(seed + 3);
  const pool = inScope(catalog, manufacturer);
  const targets = rand.sample(pool, rows);
  const records = targets.map((product, i) => {
    const template = rand.pick(COMMUNICATION_TEMPLATES);
    const values = {po: rand.pick(poNumbers.length ? poNumbers : ['PO-4188']), weeks: rand.int(2, 10), pct: rand.int(6, 35)};
    const byName = i % 7 === 3;
    return {
      record_id: `msg-${i + 1}`,
      product_id: byName ? '' : messyId(rand, product),
      product_name: byName ? product.name : '',
      subject: fill(template.subject, values),
      excerpt: fill(template.excerpt, values),
      from: `${rand.pick(['ops', 'sales', 'account-team', 'logistics'])}@${rand.pick(['supplier-one.example', 'distributor.example', 'fab-partner.example'])}`,
      received_at: DEMO_DATE,
    };
  });
  const nameOnly = records.filter(r => !r.product_id).length;
  records.push({record_id: 'msg-unknown', product_id: '', product_name: 'Mystery Dev Board v9', subject: 'Allocation: shortage on wafer supply', excerpt: 'Board name does not match any catalog listing.', from: 'sales@distributor.example', received_at: DEMO_DATE});
  return {
    source: source({id: sourceId('SUPPLIER_INBOX', seed), kind: 'communications', label: 'Supplier inbox export (synthetic)', records, headers: ['record_id', 'product_id', 'product_name', 'subject', 'excerpt', 'from', 'received_at']}),
    planted: {name_only_rows: nameOnly + 1, unmatched_names: 1},
  };
}

// ---------- price, weight and quantity what-ifs ----------

function pricePatches(catalog, {seed, manufacturer, pct, share}) {
  const rand = createRandom(seed + 4);
  const pool = inScope(catalog, manufacturer).filter(p => Number.isFinite(p.price));
  const affected = rand.sample(pool, Math.round(pool.length * share / 100));
  return affected.map(p => ({product_id: p.id, field: 'price_value', value: round(p.price * (1 + pct / 100))}));
}

function weightPatches(catalog, {seed, category, pct, share}) {
  const rand = createRandom(seed + 5);
  const pool = physical(catalog).filter(p => p.category_id === category && Number.isFinite(p.weight_g) && p.weight_g > 0);
  return rand.sample(pool, Math.round(pool.length * share / 100)).map(p => ({product_id: p.id, field: 'shipping_weight_g', value: round(p.weight_g * (1 + pct / 100), 1)}));
}

function sellThroughPatches(catalog, {seed, manufacturer, share, sellout}) {
  const rand = createRandom(seed + 6);
  const pool = inScope(catalog, manufacturer).filter(p => Number.isInteger(p.quantity) && p.quantity > 0);
  const affected = rand.sample(pool, Math.round(pool.length * share / 100));
  const soldOut = new Set(rand.sample(affected, Math.round(affected.length * sellout / 100)).map(p => p.id));
  return {
    patches: affected.map(p => ({product_id: p.id, field: 'public_quantity', value: soldOut.has(p.id) ? 0 : Math.max(1, Math.round(p.quantity * rand.next() * 0.6))})),
    soldOut: [...soldOut],
  };
}

function nextCapture(catalog, {seed, drift, share, dropped}) {
  const rand = createRandom(seed + 7);
  const all = catalog.products;
  const removed = new Set(rand.sample(all, dropped).map(p => p.id));
  const moved = new Set(rand.sample(all.filter(p => !removed.has(p.id)), Math.round(all.length * share / 100)).map(p => p.id));
  const repriced = [];
  const records = all.filter(p => !removed.has(p.id)).map(p => {
    const change = moved.has(p.id) && Number.isFinite(p.price) ? 1 + (rand.next() * 2 - 1) * drift / 100 : 1;
    if (Number.isFinite(p.price) && round(p.price * change) !== round(p.price)) repriced.push(p.id);
    return {
      product_id: p.id.replace('ADA:', ''),
      product_name: p.name,
      product_price: Number.isFinite(p.price) ? round(p.price * change).toFixed(2) : '',
      product_shipping_weight: Number.isFinite(p.weight_g) ? p.weight_g : '',
      product_stock: p.stock_raw ?? '',
      product_manufacturer: p.manufacturer,
      product_master_category: p.category_id,
      products_virtual: p.virtual ? '1' : '0',
    };
  });
  return {
    source: {id: sourceId('CATALOG_NEXT_CAPTURE', seed), kind: 'catalog', label: 'Next monthly catalog capture (synthetic)', captured_at: '2026-11-24', records},
    planted: {price_moves: repriced.length, dropped_from_capture: [...removed]},
  };
}

// ---------- public scenario list ----------

const seedKnob = {id: 'seed', label: 'Seed', type: 'number', min: 1, max: 99999, default: 42};
const manufacturerKnob = fallback => ({id: 'manufacturer', label: 'Manufacturer', type: 'manufacturer', default: fallback});

export const SCENARIOS = [
  {
    id: 'baseline',
    title: 'Live catalog baseline',
    area: 'Baseline',
    story: 'The real public catalog as captured. No synthetic data: this is the reference every other scenario is compared against.',
    knobs: [manufacturerKnob('')],
    build: (catalog, k) => ({
      request: {label: k.manufacturer ? `Baseline · ${k.manufacturer}` : 'Live catalog baseline', base: 'workspace', mode: 'observed', filters: k.manufacturer ? {manufacturer: k.manufacturer} : {}, analysis: {x: 'shipping_weight_g', y: 'price_value'}, sources: [], patches: []},
      planted: {},
    }),
  },
  {
    id: 'spec-feed',
    title: 'Messy distributor spec feed',
    area: 'Data quality',
    story: 'A distributor sends a spec sheet for dev boards: mixed units, five ID spellings, copy-paste duplicates, IDs that are not in the catalog, and two claims that contradict each other.',
    knobs: [seedKnob, {id: 'rows', label: 'Products in feed', type: 'range', min: 10, max: 120, default: 40}, {id: 'messiness', label: 'Messiness', type: 'range', min: 1, max: 10, default: 4}],
    build: (catalog, k) => {
      const feed = specFeed(catalog, k);
      return {request: request({label: 'Distributor spec feed check', sources: [feed.source]}), planted: feed.planted};
    },
  },
  {
    id: 'tariff-shock',
    title: 'Tariff price shock',
    area: 'Pricing',
    story: 'A tariff lands on part of one manufacturer’s range. Prices for the affected share rise; the engine re-runs the price/weight relationship against the untouched baseline.',
    knobs: [seedKnob, manufacturerKnob('Raspberry Pi Foundation'), {id: 'pct', label: 'Price increase %', type: 'range', min: 5, max: 60, default: 25}, {id: 'share', label: 'Share of range affected %', type: 'range', min: 10, max: 100, default: 60}],
    build: (catalog, k) => {
      const patches = pricePatches(catalog, k);
      return {request: request({label: `Tariff +${k.pct}% on ${k.share}% of ${k.manufacturer || 'catalog'}`, filters: k.manufacturer ? {manufacturer: k.manufacturer} : {}, patches}), planted: {price_patches: patches.length}};
    },
  },
  {
    id: 'packaging',
    title: 'Packaging redesign',
    area: 'Logistics',
    story: 'A category moves to heavier retail packaging. Shipping weights change for part of the category and the engine shows how weight-driven pricing would look.',
    knobs: [seedKnob, {id: 'category', label: 'Category', type: 'category', default: '183'}, {id: 'pct', label: 'Weight change %', type: 'range', min: -50, max: 150, default: 40}, {id: 'share', label: 'Share of category %', type: 'range', min: 10, max: 100, default: 80}],
    build: (catalog, k) => {
      const patches = weightPatches(catalog, k);
      const name = catalog.products.find(p => p.category_id === k.category)?.category ?? k.category;
      return {request: request({label: `Packaging ${k.pct > 0 ? '+' : ''}${k.pct}% · ${name}`, filters: {category_id: k.category}, patches}), planted: {weight_patches: patches.length}};
    },
  },
  {
    id: 'warehouse',
    title: 'Warehouse cycle count',
    area: 'Inventory',
    story: 'Three warehouses export a cycle count. Some products are listed in stock online but have nothing on the shelf; others sit in a bin while the site says out of stock.',
    knobs: [seedKnob, manufacturerKnob(''), {id: 'rows', label: 'Products counted', type: 'range', min: 20, max: 600, default: 200}, {id: 'mismatches', label: 'Planted mismatches (each kind)', type: 'range', min: 1, max: 15, default: 4}],
    build: (catalog, k) => {
      const count = warehouseCount(catalog, k);
      return {request: request({label: 'Warehouse cycle count reconciliation', filters: k.manufacturer ? {manufacturer: k.manufacturer} : {}, sources: [count.source]}), planted: count.planted};
    },
  },
  {
    id: 'purchase-orders',
    title: 'Open purchase orders',
    area: 'Supply',
    story: 'The ERP exports open POs. Some cover current stock-outs, some pile more stock onto items that already have plenty, and one PO points at a product ID nobody recognises.',
    knobs: [seedKnob, manufacturerKnob(''), {id: 'rows', label: 'Purchase orders', type: 'range', min: 6, max: 120, default: 36}],
    build: (catalog, k) => {
      const pos = purchaseOrders(catalog, k);
      return {request: request({label: 'Open purchase order review', filters: k.manufacturer ? {manufacturer: k.manufacturer} : {}, sources: [pos.source]}), planted: pos.planted};
    },
  },
  {
    id: 'supplier-inbox',
    title: 'Supplier inbox',
    area: 'Supply',
    story: 'A week of supplier emails, exported as structured rows: delays, price increases, end-of-life notices and allocations. Some name a product without its ID.',
    knobs: [seedKnob, manufacturerKnob(''), {id: 'rows', label: 'Messages', type: 'range', min: 5, max: 80, default: 24}],
    build: (catalog, k) => {
      const inbox = supplierInbox(catalog, k);
      return {request: request({label: 'Supplier inbox triage', filters: k.manufacturer ? {manufacturer: k.manufacturer} : {}, sources: [inbox.source]}), planted: inbox.planted};
    },
  },
  {
    id: 'sell-through',
    title: 'Weekend sell-through',
    area: 'Inventory',
    story: 'A promotion drains public stock. Part of the range sells down and some items sell out, changing what the storefront would show.',
    knobs: [seedKnob, manufacturerKnob('Adafruit'), {id: 'share', label: 'Share of in-stock range sold %', type: 'range', min: 5, max: 100, default: 35}, {id: 'sellout', label: 'Of those, sold out %', type: 'range', min: 0, max: 100, default: 30}],
    build: (catalog, k) => {
      const {patches, soldOut} = sellThroughPatches(catalog, k);
      return {request: request({label: `Sell-through · ${k.manufacturer || 'catalog'}`, filters: k.manufacturer ? {manufacturer: k.manufacturer} : {}, analysis: {x: 'price_value', y: 'public_quantity'}, patches}), planted: {quantity_patches: patches.length, sold_out: soldOut}};
    },
  },
  {
    id: 'next-capture',
    title: 'Next month’s catalog',
    area: 'Pricing',
    story: 'A full catalog capture one month later: prices drift on part of the range and a handful of listings disappear. The engine diffs it against today’s capture.',
    knobs: [seedKnob, {id: 'drift', label: 'Max price drift ±%', type: 'range', min: 1, max: 40, default: 12}, {id: 'share', label: 'Share of products repriced %', type: 'range', min: 1, max: 60, default: 15}, {id: 'dropped', label: 'Listings dropped', type: 'range', min: 0, max: 40, default: 8}],
    build: (catalog, k) => {
      const capture = nextCapture(catalog, k);
      return {request: request({label: 'Next monthly catalog capture', sources: [capture.source]}), planted: capture.planted};
    },
  },
  {
    id: 'ops-morning',
    title: 'Monday operations review',
    area: 'Combined',
    story: 'Everything lands at once for one product line: cycle count, open POs, supplier emails and a messy spec feed. The engine connects it all by product ID.',
    knobs: [seedKnob, manufacturerKnob('Raspberry Pi Foundation')],
    build: (catalog, k) => {
      const scope = {seed: k.seed, manufacturer: k.manufacturer};
      const count = warehouseCount(catalog, {...scope, rows: 60, mismatches: 3});
      const pos = purchaseOrders(catalog, {...scope, rows: 18});
      const inbox = supplierInbox(catalog, {...scope, rows: 14, poNumbers: pos.poNumbers});
      const feed = specFeed(catalog, {seed: k.seed, rows: 30, messiness: 4});
      return {
        request: request({label: `Monday operations review · ${k.manufacturer || 'catalog'}`, filters: k.manufacturer ? {manufacturer: k.manufacturer} : {}, sources: [count.source, pos.source, inbox.source, feed.source]}),
        planted: {inventory: count.planted, purchase_orders: pos.planted, inbox: inbox.planted, specs: feed.planted},
      };
    },
  },
];

export function defaultKnobs(scenario) {
  return Object.fromEntries(scenario.knobs.map(k => [k.id, k.default]));
}

export function buildScenario(catalog, id, knobs = {}) {
  const scenario = SCENARIOS.find(s => s.id === id);
  if (!scenario) throw new Error(`Unknown scenario: ${id}`);
  return {scenario, ...scenario.build(catalog, {...defaultKnobs(scenario), ...knobs})};
}
