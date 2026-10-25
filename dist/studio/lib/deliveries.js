// Delivery reliability analysis over shipment records the engine has validated, de-duplicated
// and matched to products. Descriptive statistics only: patterns are associations, odds come
// from past deliveries (not a distributional model), and every figure keeps its sample size.

export const DEFAULT_TOLERANCE = 5;      // minutes either side of expected that still count as on time
export const MIN_GROUP = 30;             // smaller groups are shown but flagged as small samples
const RECENT_DAYS = 28;
const PATTERN_LIFT = 1.6;
const PATTERN_GAP = 0.1;
const Z95 = 1.96;

const TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function parseTime(text) {
  const m = TIME.exec(String(text ?? '').trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const ms = Date.UTC(y, mo - 1, d, h, mi);
  const back = new Date(ms);
  if (back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d || h > 23 || mi > 59) return null;
  return ms / 60000;
}

export const formatTime = minutes => {
  const d = new Date(minutes * 60000);
  return `${d.toISOString().slice(0, 10)} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

export function classify(delay, tolerance = DEFAULT_TOLERANCE) {
  if (delay === null) return 'unknown';
  if (delay > tolerance) return 'late';
  if (delay < -tolerance) return 'early';
  return 'on_time';
}

export const isShipment = row => row.kind === 'purchase_orders' && row.raw && 'expected_arrival' in row.raw;

export function shipmentsFrom(result, tolerance = DEFAULT_TOLERANCE) {
  const products = new Map(result.products.map(p => [p.product_id, p]));
  const rows = (result.evidence ?? []).filter(isShipment);
  const parsed = rows.map(row => {
    const expected = parseTime(row.raw.expected_arrival);
    const actual = parseTime(row.raw.actual_arrival);
    const delay = expected !== null && actual !== null ? actual - expected : null;
    const product = products.get(row.product_id);
    return {
      record_id: row.raw.record_id, po: row.raw.purchase_order_id, product_id: row.product_id,
      product_name: product?.product_name ?? row.product_id, availability: product?.availability ?? 'unknown',
      supplier: row.raw.supplier, carrier: row.raw.carrier, route: row.raw.route, distance: Number(row.raw.distance_km),
      expected, actual, delay, status: classify(delay, tolerance),
      slot: expected === null ? null : new Date(expected * 60000).getUTCHours() >= 13 ? 'Afternoon' : 'Morning',
      freight: Number(row.raw.freight_cost) || 0, expedite: Number(row.raw.expedite_cost) || 0,
      invalid: expected === null || (row.raw.actual_arrival !== '' && actual === null),
      raw: row.raw,
    };
  });
  const latest = Math.max(...parsed.map(s => s.expected).filter(v => v !== null));
  const shipments = parsed.map(s => ({...s, period: s.expected === null ? null : s.expected >= latest - RECENT_DAYS * 1440 ? 'Last 4 weeks' : 'Earlier'}));
  const shipmentSources = new Set(rows.map(r => r.source_id));
  const sources = (result.sources ?? []).filter(s => shipmentSources.has(s.id));
  return {
    shipments,
    quality: {
      received: sources.reduce((sum, s) => sum + s.record_count, 0),
      duplicates: sources.reduce((sum, s) => sum + s.duplicate_rows, 0),
      unmatched: (result.quarantine ?? []).filter(isShipment).length,
      matched: shipments.length,
      missing_arrival: shipments.filter(s => s.raw.actual_arrival === '').length,
      invalid_timestamps: shipments.filter(s => s.invalid).length,
    },
  };
}

export function wilson(hits, n) {
  if (!n) return {rate: null, low: null, high: null};
  const p = hits / n, z2 = Z95 * Z95;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (Z95 * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return {rate: p, low: Math.max(0, centre - half), high: Math.min(1, centre + half)};
}

const quantile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null);

export function performance(shipments) {
  const known = shipments.filter(s => s.delay !== null);
  const count = status => known.filter(s => s.status === status).length;
  const lateDelays = known.filter(s => s.status === 'late').map(s => s.delay).sort((a, b) => a - b);
  const delays = known.map(s => s.delay).sort((a, b) => a - b);
  return {
    n: known.length, early: count('early'), on_time: count('on_time'), late: count('late'),
    late_rate: known.length ? count('late') / known.length : null,
    median_delay: quantile(delays, 0.5), median_late_delay: quantile(lateDelays, 0.5), p90_late_delay: quantile(lateDelays, 0.9),
  };
}

export function histogram(shipments, {bin = 5, min = -15, max = 90} = {}) {
  const bins = [];
  for (let start = min; start < max; start += bin) bins.push({start, end: start + bin, early: 0, on_time: 0, late: 0});
  for (const s of shipments) {
    if (s.delay === null) continue;
    const index = Math.min(bins.length - 1, Math.max(0, Math.floor((s.delay - min) / bin)));
    bins[index][s.status] += 1;
  }
  return bins;
}

export function compare(shipments, dimension) {
  const groups = new Map();
  for (const s of shipments) {
    if (s.delay === null || !s[dimension]) continue;
    if (!groups.has(s[dimension])) groups.set(s[dimension], []);
    groups.get(s[dimension]).push(s);
  }
  return [...groups].map(([key, list]) => {
    const perf = performance(list);
    return {key, ...perf, interval: wilson(perf.late, perf.n), small: perf.n < MIN_GROUP};
  }).sort((a, b) => b.late_rate - a.late_rate);
}

// Candidate segments: single dimensions plus the two cross-cuts analysts ask about most.
const SEGMENTS = [
  {dims: ['carrier']}, {dims: ['route']}, {dims: ['supplier']},
  {dims: ['carrier', 'slot']}, {dims: ['route', 'period']}, {dims: ['supplier', 'period']},
];

function segmentRows(shipments, dims) {
  const groups = new Map();
  for (const s of shipments) {
    if (s.delay === null || dims.some(d => !s[d])) continue;
    const key = dims.map(d => s[d]).join(' · ');
    if (!groups.has(key)) groups.set(key, {key, dims, values: Object.fromEntries(dims.map(d => [d, s[d]])), list: []});
    groups.get(key).list.push(s);
  }
  return [...groups.values()];
}

export function findPatterns(shipments) {
  const known = shipments.filter(s => s.delay !== null);
  const totalLate = known.filter(s => s.status === 'late').length;
  const patterns = [];
  for (const {dims} of SEGMENTS) {
    for (const group of segmentRows(known, dims)) {
      const n = group.list.length;
      if (n < MIN_GROUP) continue;
      const late = group.list.filter(s => s.status === 'late').length;
      const restN = known.length - n;
      if (restN < MIN_GROUP) continue; // nothing meaningful to compare against
      const restRate = restN ? (totalLate - late) / restN : 0;
      const rate = late / n;
      const perf = performance(group.list);
      const base = {...group, n, late, rate, rest_rate: restRate, interval: wilson(late, n), median_late_delay: perf.median_late_delay, excess: Math.round(late - n * restRate)};
      if (rate >= restRate * PATTERN_LIFT && rate - restRate >= PATTERN_GAP) patterns.push({...base, kind: 'problem'});
      else if (dims.length === 1 && restRate > 0 && rate <= restRate / 2) patterns.push({...base, kind: 'reliable'});
    }
  }
  const problems = patterns.filter(p => p.kind === 'problem').sort((a, b) => b.excess - a.excess);
  // Prefer the most specific segment that explains a broader one (e.g. carrier · afternoon over carrier).
  const specific = problems.filter(p => !problems.some(q => q !== p && q.dims.length > p.dims.length && p.dims.every(d => q.values[d] === p.values[d]) && q.excess >= p.excess * 0.7));
  return {problems: mergeOverlaps(specific), reliable: mergeOverlaps(patterns.filter(p => p.kind === 'reliable').sort((a, b) => a.rate - b.rate))};
}

// Segments made of (almost) the same shipments are one finding seen through different labels,
// e.g. a supplier that only ships on one route. Keep the first and list the others as aliases.
const OVERLAP = 0.8;
const SAME_RATE = 0.25;   // relative difference in late rate still treated as the same finding
function mergeOverlaps(list) {
  const kept = [];
  for (const pattern of list) {
    const ids = new Set(pattern.list.map(s => s.record_id));
    const parent = kept.find(k => Math.abs(k.rate - pattern.rate) <= SAME_RATE * Math.max(k.rate, pattern.rate) + 0.02
      && k.list.filter(s => ids.has(s.record_id)).length >= OVERLAP * Math.min(ids.size, k.list.length));
    if (parent) parent.aliases.push(pattern.key);
    else kept.push({...pattern, aliases: []});
  }
  return kept;
}

export function windowOdds(shipments, halfWidth = 10) {
  const known = shipments.filter(s => s.delay !== null);
  const hits = known.filter(s => Math.abs(s.delay) <= halfWidth).length;
  return {n: known.length, hits, ...wilson(hits, known.length)};
}

export function impact(shipments) {
  const late = shipments.filter(s => s.status === 'late');
  const stockouts = late.filter(s => s.availability === 'out_of_stock');
  const byCarrier = new Map();
  for (const s of late) byCarrier.set(s.carrier, (byCarrier.get(s.carrier) ?? 0) + s.expedite);
  return {
    late: late.length,
    expedite_total: late.reduce((sum, s) => sum + s.expedite, 0),
    freight_total: shipments.reduce((sum, s) => sum + s.freight, 0),
    stockout_late: stockouts.length,
    stockout_products: [...new Set(stockouts.map(s => s.product_id))],
    expedite_by_carrier: [...byCarrier].map(([carrier, cost]) => ({carrier, cost})).sort((a, b) => b.cost - a.cost),
  };
}

export function relationship(shipments, x = 'distance') {
  const points = shipments.filter(s => s.delay !== null && Number.isFinite(s[x]));
  const n = points.length;
  if (n < 8) return {n, r: null};
  const mx = points.reduce((a, s) => a + s[x], 0) / n, my = points.reduce((a, s) => a + s.delay, 0) / n;
  let xx = 0, yy = 0, xy = 0;
  for (const s of points) { const dx = s[x] - mx, dy = s.delay - my; xx += dx * dx; yy += dy * dy; xy += dx * dy; }
  return {n, r: xx && yy ? xy / Math.sqrt(xx * yy) : null};
}

export function filterShipments(shipments, filters) {
  return shipments.filter(s => Object.entries(filters).every(([key, value]) => !value || s[key] === value));
}

export function describe(pattern) {
  const v = pattern.values;
  const parts = [v.carrier, v.route, v.supplier].filter(Boolean);
  const when = [v.slot && `${v.slot.toLowerCase()} deliveries`, v.period && v.period.toLowerCase()].filter(Boolean).join(', ');
  return `${parts.join(' · ')}${when ? `, ${when}` : ''}`;
}
