// Scatter of the engine's analysed pairs. Changed products are drawn on top with a line
// from their baseline position, so a what-if is visible at a glance.
import {esc, num} from './ui.js';
import {label} from './lib/insights.js';

const W = 760, H = 420, PAD = {l: 64, r: 18, t: 16, b: 46};
const HIT_RADIUS = 14;
let plotted = [];

function scale(values, size, start) {
  const positive = values.every(v => v > 0);
  const lo = Math.min(...values), hi = Math.max(...values);
  const log = positive && hi / lo > 100;
  const f = log ? Math.log10 : v => v;
  const a = f(lo), b = f(hi) === f(lo) ? f(lo) + 1 : f(hi);
  const pad = (b - a) * 0.04;
  const map = v => start + ((f(v) - (a - pad)) / (b - a + 2 * pad)) * size;
  const ticks = log
    ? Array.from({length: Math.floor(b) - Math.ceil(a) + 1}, (_, i) => 10 ** (Math.ceil(a) + i))
    : Array.from({length: 5}, (_, i) => lo + ((hi - lo) * i) / 4);
  return {map, ticks, log};
}

const tickLabel = v => (v >= 1000 ? `${num(v / 1000, v % 1000 ? 1 : 0)}k` : v < 1 ? v.toFixed(2) : num(v, v < 10 && v % 1 ? 1 : 0));

export function scatter(result, {highlight = new Set()} = {}) {
  const {x, y} = result.analysis;
  const pairs = result.products.filter(p => p.decision === 'Included' && Number.isFinite(p.pair_x) && Number.isFinite(p.pair_y));
  if (pairs.length < 2) return `<p class="empty">Not enough complete pairs to plot (${pairs.length}).</p>`;
  const before = new Map();
  for (const c of result.changes) {
    if (!before.has(c.product_id)) before.set(c.product_id, {});
    before.get(c.product_id)[c.field] = c.before;
  }
  const xs = pairs.map(p => p.pair_x), ys = pairs.map(p => p.pair_y);
  const sx = scale(xs, W - PAD.l - PAD.r, PAD.l);
  const syRaw = scale(ys, H - PAD.t - PAD.b, 0);
  const sy = v => H - PAD.b - syRaw.map(v);
  const field = metric => (metric === 'public_quantity' ? 'public_quantity' : metric);

  const points = pairs.map(p => {
    const prior = before.get(p.product_id);
    const bx = prior && field(x) in prior ? prior[field(x)] : p.pair_x;
    const by = prior && field(y) in prior ? prior[field(y)] : p.pair_y;
    const changed = Boolean(prior) && (bx !== p.pair_x || by !== p.pair_y);
    const valid = Number.isFinite(bx) && Number.isFinite(by) && (!sx.log || bx > 0) && (!syRaw.log || by > 0);
    return {id: p.product_id, name: p.product_name, vx: p.pair_x, vy: p.pair_y, cx: sx.map(p.pair_x), cy: sy(p.pair_y), changed, flagged: highlight.has(p.product_id), from: changed && valid ? {x: sx.map(bx), y: sy(by)} : null};
  });
  const grid = [
    ...sx.ticks.map(t => `<line class="grid" x1="${sx.map(t)}" x2="${sx.map(t)}" y1="${PAD.t}" y2="${H - PAD.b}"/><text class="tick" x="${sx.map(t)}" y="${H - PAD.b + 18}" text-anchor="middle">${tickLabel(t)}</text>`),
    ...syRaw.ticks.map(t => `<line class="grid" x1="${PAD.l}" x2="${W - PAD.r}" y1="${sy(t)}" y2="${sy(t)}"/><text class="tick" x="${PAD.l - 8}" y="${sy(t) + 4}" text-anchor="end">${tickLabel(t)}</text>`),
  ].join('');
  const base = points.filter(p => !p.changed && !p.flagged).map(p => `<circle class="pt" cx="${p.cx.toFixed(1)}" cy="${p.cy.toFixed(1)}" r="2.4"/>`).join('');
  const flagged = points.filter(p => p.flagged && !p.changed).map(p => `<circle class="pt-flag" cx="${p.cx.toFixed(1)}" cy="${p.cy.toFixed(1)}" r="4.5"/>`).join('');
  const moved = points.filter(p => p.changed).map(p => `${p.from ? `<line class="move" x1="${p.from.x.toFixed(1)}" y1="${p.from.y.toFixed(1)}" x2="${p.cx.toFixed(1)}" y2="${p.cy.toFixed(1)}"/><circle class="pt-before" cx="${p.from.x.toFixed(1)}" cy="${p.from.y.toFixed(1)}" r="3"/>` : ''}<circle class="pt-changed" cx="${p.cx.toFixed(1)}" cy="${p.cy.toFixed(1)}" r="4.5"/>`).join('');
  const changedCount = points.filter(p => p.changed).length;
  const flaggedCount = points.filter(p => p.flagged && !p.changed).length;
  plotted = points;
  return `
    <div class="legend">
      <span><i class="key key-base"></i>Product (${num(points.length - changedCount - flaggedCount)})</span>
      ${changedCount ? `<span><i class="key key-changed"></i>Changed by this run (${num(changedCount)})</span><span><i class="key key-before"></i>Baseline position</span>` : ''}
      ${flaggedCount ? `<span><i class="key key-flag"></i>Pricing outlier (${num(flaggedCount)})</span>` : ''}
      ${sx.log || syRaw.log ? '<span class="muted">Log scale</span>' : ''}
    </div>
    <div class="chart" data-chart>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${label(x)} versus ${label(y)} for ${points.length} products`)}">
        ${grid}
        <line class="axis" x1="${PAD.l}" x2="${W - PAD.r}" y1="${H - PAD.b}" y2="${H - PAD.b}"/>
        <text class="axis-label" x="${(PAD.l + W - PAD.r) / 2}" y="${H - 6}" text-anchor="middle">${esc(axisTitle(x))}</text>
        <text class="axis-label" transform="rotate(-90)" x="${-(PAD.t + H - PAD.b) / 2}" y="16" text-anchor="middle">${esc(axisTitle(y))}</text>
        <g>${base}</g><g>${flagged}</g><g>${moved}</g>
        <circle class="hover-ring" r="7" cx="-20" cy="-20"/>
      </svg>
      <div class="tooltip" hidden></div>
    </div>`;
}

const axisTitle = metric => ({price_value: 'Catalog price (source units)', shipping_weight_g: 'Shipping weight (g)', public_quantity: 'Public quantity'}[metric] ?? label(metric));

export function bindScatter(root, onSelect) {
  const box = root.querySelector('[data-chart]');
  if (!box) return;
  const svg = box.querySelector('svg'), tip = box.querySelector('.tooltip'), ring = box.querySelector('.hover-ring');
  let current = null, frame = 0;
  const nearest = event => {
    const rect = svg.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * W, py = ((event.clientY - rect.top) / rect.height) * H;
    let best = null, bestD = (HIT_RADIUS * W / rect.width) ** 2;
    for (const p of plotted) {
      const d = (p.cx - px) ** 2 + (p.cy - py) ** 2;
      if (d < bestD || (d === bestD && p.changed)) { best = p; bestD = d; }
    }
    return best;
  };
  svg.addEventListener('mousemove', event => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      current = nearest(event);
      if (!current) { tip.hidden = true; ring.setAttribute('cx', -20); return; }
      ring.setAttribute('cx', current.cx); ring.setAttribute('cy', current.cy);
      const rect = svg.getBoundingClientRect();
      tip.innerHTML = `<strong>${esc(current.name)}</strong><span>${esc(current.id)}</span><span>x ${num(current.vx, 2)} · y ${num(current.vy, 2)}</span>${current.changed ? '<span class="tip-flag">Changed by this run</span>' : ''}`;
      tip.hidden = false;
      const left = (current.cx / W) * rect.width;
      tip.style.left = `${Math.min(left + 14, rect.width - 220)}px`;
      tip.style.top = `${(current.cy / H) * rect.height + 10}px`;
    });
  });
  svg.addEventListener('mouseleave', () => { tip.hidden = true; ring.setAttribute('cx', -20); current = null; });
  svg.addEventListener('click', () => current && onSelect(current.id));
}
