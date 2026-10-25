// Seeded inbound delivery history. Illustrative only: patterns are planted so the
// investigation tools can be checked against a known answer. Times are warehouse local time.
import {createRandom, round} from './random.js';

export const HISTORY_END = '2026-10-23';
export const NOON_EXAMPLE = {record_id: 'ship-noon-example', product_id: 'ADA:6006', expected: '2026-10-20T12:00', actual: '2026-10-20T12:10'};
const WEEKS = 12;
const RECENT_WEEKS = 4;

export const ROUTES = [
  {id: 'Shenzhen → JFK (air)', km: 12900, mode: 'air', freight: 420},
  {id: 'Taipei → JFK (air)', km: 12500, mode: 'air', freight: 390},
  {id: 'Cambridge UK → JFK (air)', km: 5300, mode: 'air', freight: 260},
  {id: 'Minneapolis → NYC (ground)', km: 1900, mode: 'ground', freight: 140},
  {id: 'Dallas → NYC (ground)', km: 2500, mode: 'ground', freight: 160},
  {id: 'Newark → NYC (ground)', km: 25, mode: 'ground', freight: 45},
];
export const CARRIERS = {
  air: ['Atlas Air Cargo', 'Northline Freight', 'Harbor Express'],
  ground: ['Metro Ground', 'Northline Freight', 'Harbor Express'],
};
const SUPPLIERS = [
  {name: 'Raspberry Pi Ltd', routes: ['Cambridge UK → JFK (air)'], makers: ['Raspberry Pi Foundation']},
  {name: 'Espressif Systems', routes: ['Shenzhen → JFK (air)'], makers: ['Espressif']},
  {name: 'Shenzhen PCB Works', routes: ['Shenzhen → JFK (air)'], makers: []},
  {name: 'Taipei Assembly Co', routes: ['Taipei → JFK (air)'], makers: []},
  {name: 'Digi-Key Distribution', routes: ['Minneapolis → NYC (ground)'], makers: []},
  {name: 'Mouser Electronics', routes: ['Dallas → NYC (ground)'], makers: []},
  {name: 'Adafruit Factory (NJ)', routes: ['Newark → NYC (ground)'], makers: ['Adafruit']},
];

// The answer key: what the investigation should find.
export const PLANTED_PATTERNS = {
  afternoon_carrier: {carrier: 'Northline Freight', slot: 'Afternoon'},
  worsening_route: {route: 'Shenzhen → JFK (air)', period: 'Last 4 weeks'},
  reliable_supplier: {supplier: 'Raspberry Pi Ltd'},
};

const pad = n => String(n).padStart(2, '0');
const stamp = minutes => {
  const d = new Date(minutes * 60000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

function normal(rand, mean, sd) {
  const u = Math.max(rand.next(), 1e-9), v = rand.next();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function delayFor(rand, {route, carrier, supplier, hour, recent}) {
  let delay = normal(rand, 0, supplier.name === 'Raspberry Pi Ltd' ? 2 : 3) + route.km / 8000;
  if (carrier === PLANTED_PATTERNS.afternoon_carrier.carrier && hour >= 13 && rand.chance(0.75)) delay += 15 + rand.next() * 30;
  if (route.id === PLANTED_PATTERNS.worsening_route.route && recent && rand.chance(0.6)) delay += 20 + rand.next() * 70;
  return Math.round(delay);
}

function productPool(catalog) {
  return catalog.products.filter(p => !p.virtual && Number.isFinite(p.price) && p.price > 0);
}

export function generateShipments(catalog, {seed = 42, shipments = 2000} = {}) {
  const rand = createRandom(seed + 11);
  const pool = productPool(catalog);
  const end = Date.UTC(2026, 9, 23) / 60000;
  const start = end - WEEKS * 7 * 1440;
  const records = [];
  for (let i = 0; i < shipments; i++) {
    const supplier = rand.pick(SUPPLIERS);
    const route = ROUTES.find(r => r.id === rand.pick(supplier.routes));
    const carrier = supplier.name === 'Raspberry Pi Ltd' ? 'Atlas Air Cargo' : rand.pick(CARRIERS[route.mode]);
    const makers = pool.filter(p => supplier.makers.includes(p.manufacturer));
    const product = rand.pick(makers.length ? makers : pool);
    let day = start + rand.int(0, WEEKS * 7 - 1) * 1440;
    const weekday = new Date(day * 60000).getUTCDay();
    if (weekday === 0 || weekday === 6) day += (weekday === 6 ? 2 : 1) * 1440;
    const hour = rand.int(8, 16);
    const expected = day + hour * 60 + rand.pick([0, 30]);
    const recent = expected >= end - RECENT_WEEKS * 7 * 1440;
    const delay = delayFor(rand, {route, carrier, supplier, hour, recent});
    const late = delay > 30;
    records.push({
      record_id: `ship-${i + 1}`,
      purchase_order_id: `PO-${7000 + Math.floor(i / 3)}`,
      product_id: product.id.replace('ADA:', ''),
      quantity: rand.int(1, 40) * 10,
      supplier: supplier.name,
      carrier,
      route: route.id,
      distance_km: route.km,
      expected_arrival: stamp(expected),
      actual_arrival: rand.chance(0.02) ? '' : stamp(expected + delay),
      freight_cost: round(route.freight * (0.8 + rand.next() * 0.4)),
      expedite_cost: late && rand.chance(0.4) ? round(80 + rand.next() * 320) : 0,
    });
  }
  // Data problems a real export would have.
  records[5] = {...records[5], actual_arrival: 'TBD'};
  records[17] = {...records[17], expected_arrival: '2026-13-40T25:00'};
  const unknown = ['99999901', '88880042', '77770005'].map((id, i) => ({...records[i + 30], record_id: `ship-unknown-${i + 1}`, product_id: id}));
  const duplicates = [records[40], records[41], records[42], records[43]].map(r => ({...r}));
  // The opening example from the brief: expected at noon, arrived ten minutes late.
  const noon = {
    record_id: NOON_EXAMPLE.record_id, purchase_order_id: 'PO-6006-NOON', product_id: '6006', quantity: 200,
    supplier: 'Taipei Assembly Co', carrier: 'Northline Freight', route: 'Taipei → JFK (air)', distance_km: 12500,
    expected_arrival: NOON_EXAMPLE.expected, actual_arrival: NOON_EXAMPLE.actual, freight_cost: 410, expedite_cost: 0,
  };
  return {
    records: [...records, noon, ...unknown, ...duplicates],
    planted: {...PLANTED_PATTERNS, duplicates: duplicates.length, unknown_ids: unknown.length, invalid_timestamps: 2},
  };
}
