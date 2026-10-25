// Delivery reliability, in the order of the analyst workflow: question → performance →
// compare → investigate → odds → impact → relationship → decide.
import {esc, num, severityBadge, table} from '../ui.js';
import {quickStart} from '../actions.js';
import {update} from '../state.js';
import {DEFAULT_TOLERANCE, MIN_GROUP, compare, describe, filterShipments, findPatterns, formatTime, histogram, impact, performance, relationship, shipmentsFrom, windowOdds} from '../lib/deliveries.js';
import {NOON_EXAMPLE} from '../lib/shipments.js';

const STATUS = {early: {icon: '▼', label: 'Early'}, on_time: {icon: '●', label: 'On time'}, late: {icon: '▲', label: 'Late'}, unknown: {icon: '○', label: 'No arrival'}};
const DIMENSIONS = [['carrier', 'Carrier'], ['route', 'Route'], ['supplier', 'Supplier']];
const FILTERS = [['supplier', 'Supplier'], ['carrier', 'Carrier'], ['route', 'Route'], ['slot', 'Time of day'], ['period', 'Period']];
const SHIPMENT_ROWS = 25;

export let ui = {tolerance: DEFAULT_TOLERANCE, filters: {}, dimension: 'carrier', pattern: null, window: 10, oddsSegment: 'all'};
export const setDeliveryUi = patch => { ui = {...ui, ...patch}; update({}); };

const pct = v => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '—');
const mins = v => (Number.isFinite(v) ? `${v} min` : '—');
const money = v => `$${Math.round(v).toLocaleString()}`;
const statusTag = s => `<span class="st st-${s}"><span aria-hidden="true">${STATUS[s].icon}</span>${STATUS[s].label}</span>`;

export function analysis(result) {
  const {shipments, quality} = shipmentsFrom(result, ui.tolerance);
  const scoped = filterShipments(shipments, ui.filters);
  return {shipments, quality, scoped, patterns: findPatterns(shipments)};
}

function questionCard(shipments) {
  const noon = shipments.find(s => s.record_id === NOON_EXAMPLE.record_id);
  if (!noon) return '';
  return `
    <section class="panel question" id="d-question">
      <p class="eyebrow">The question</p>
      <div class="noon">
        <div><span>Expected</span><strong>${esc(formatTime(noon.expected).slice(11))}</strong></div>
        <div><span>Arrived</span><strong>${esc(formatTime(noon.actual).slice(11))}</strong></div>
        <div class="late"><span>Delay</span><strong>+${noon.delay} min</strong></div>
      </div>
      <h2>One late truck, or a costly pattern?</h2>
      <p class="muted">${esc(noon.product_name)} · ${esc(noon.carrier)} · ${esc(noon.route)}</p>
    </section>`;
}

function histogramSvg(bins) {
  const W = 720, H = 180, P = {l: 36, b: 26, t: 8};
  const max = Math.max(1, ...bins.map(b => b.early + b.on_time + b.late));
  const w = (W - P.l) / bins.length;
  const y = v => H - P.b - (v / max) * (H - P.b - P.t);
  const bars = bins.map((b, i) => {
    let base = 0;
    return ['on_time', 'early', 'late'].map(status => {
      if (!b[status]) return '';
      const top = y(base + b[status]), bottom = y(base);
      base += b[status];
      return `<rect class="bar-${status}" x="${P.l + i * w + 1}" y="${top}" width="${w - 2}" height="${Math.max(1, bottom - top)}" rx="2"><title>${b.start} to ${b.end} min: ${b[status]} ${STATUS[status].label.toLowerCase()}</title></rect>`;
    }).join('');
  }).join('');
  const ticks = bins.filter((b, i) => i % 3 === 0).map(b => `<text class="tick" x="${P.l + ((b.start - bins[0].start) / 5) * w}" y="${H - 8}">${b.start}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="hist" role="img" aria-label="Delay distribution in minutes">${bars}<line class="axis" x1="${P.l}" x2="${W}" y1="${H - P.b}" y2="${H - P.b}"/>${ticks}<text class="tick" x="${W - 4}" y="${H - 8}" text-anchor="end">min late →</text></svg>`;
}

function overview({quality, scoped}) {
  const perf = performance(scoped);
  return `
    <section class="panel" id="d-overview">
      <div class="panel-head"><h2>Delivery performance</h2>
        <label class="inline">On time = within ±<input type="number" min="0" max="60" value="${ui.tolerance}" data-tolerance> min</label></div>
      <div class="kpis">
        <div class="kpi"><span>Shipments</span><strong>${num(perf.n)}</strong></div>
        <div class="kpi"><span>${statusTag('on_time')}</span><strong>${pct(perf.on_time / perf.n)}</strong></div>
        <div class="kpi"><span>${statusTag('late')}</span><strong>${pct(perf.late_rate)}</strong></div>
        <div class="kpi"><span>Typical late delay</span><strong>${mins(perf.median_late_delay)}</strong></div>
        <div class="kpi"><span>Worst 10% late by</span><strong>${mins(perf.p90_late_delay)}+</strong></div>
      </div>
      ${histogramSvg(histogram(scoped))}
      <p class="quality">Cleaned by the engine: ${num(quality.received)} rows in · ${num(quality.duplicates)} duplicates removed · ${num(quality.unmatched)} unknown products held · ${num(quality.missing_arrival + quality.invalid_timestamps)} without a usable arrival time</p>
    </section>`;
}

function filterBar(shipments) {
  const options = key => [...new Set(shipments.map(s => s[key]).filter(Boolean))].sort();
  return `
    <section class="panel filters-panel" id="d-filters">
      ${FILTERS.map(([key, label]) => `<label>${label}<select data-dfilter="${key}"><option value="">All</option>${options(key).map(v => `<option ${ui.filters[key] === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`).join('')}
      ${Object.values(ui.filters).some(Boolean) ? '<button class="ghost" data-dclear>Clear</button>' : ''}
    </section>`;
}

function comparison(scoped) {
  const rows = compare(scoped, ui.dimension);
  const overall = performance(scoped).late_rate ?? 0;
  return `
    <section class="panel" id="d-compare">
      <div class="panel-head"><h2>Compare</h2>
        <div class="seg">${DIMENSIONS.map(([key, label]) => `<button class="chip-btn ${ui.dimension === key ? 'active' : ''}" data-dim="${key}">${label}</button>`).join('')}</div></div>
      <div class="bars">
        ${rows.map(r => `
          <div class="bar-row ${r.small ? 'small' : ''}">
            <span class="bar-label">${esc(r.key)}</span>
            <span class="bar-track"><i style="width:${(r.late_rate * 100).toFixed(1)}%"></i><b style="left:${(r.interval.low * 100).toFixed(1)}%;width:${((r.interval.high - r.interval.low) * 100).toFixed(1)}%"></b><em style="left:${(overall * 100).toFixed(1)}%"></em></span>
            <span class="bar-value">${pct(r.late_rate)} late</span>
            <span class="bar-n">${num(r.n)}${r.small ? ' · small sample' : ''}</span>
          </div>`).join('')}
      </div>
      <p class="hint">Bar = late rate · shaded = 95% range · line = overall ${pct(overall)}</p>
    </section>`;
}

function patternCard(p, kind) {
  const selected = ui.pattern === p.key;
  return `
    <article class="pattern ${kind} ${selected ? 'selected' : ''}">
      <span class="tag">${kind === 'problem' ? 'Pattern' : 'Reliable'}</span>
      <h3>${esc(describe(p))}</h3>
      <p class="big">${pct(p.rate)} <span>late vs ${pct(p.rest_rate)} elsewhere</span></p>
      <p class="muted">${num(p.n)} shipments${p.median_late_delay ? ` · typically ${p.median_late_delay} min late` : ''}${p.aliases.length ? ` · same shipments as ${esc(p.aliases.join(', '))}` : ''}</p>
      <button class="${selected ? 'primary' : ''}" data-pattern="${esc(p.key)}">${selected ? 'Showing shipments' : 'Show shipments'}</button>
    </article>`;
}

function patternsSection({patterns}) {
  return `
    <section class="panel" id="d-patterns">
      <div class="panel-head"><h2>Patterns found</h2><p>Groups of ${MIN_GROUP}+ shipments that stand out</p></div>
      <div class="pattern-grid">
        ${patterns.problems.map(p => patternCard(p, 'problem')).join('')}
        ${patterns.reliable.slice(0, 2).map(p => patternCard(p, 'reliable')).join('')}
      </div>
    </section>`;
}

function shipmentTable({patterns, scoped}) {
  const all = [...patterns.problems, ...patterns.reliable];
  const chosen = all.find(p => p.key === ui.pattern);
  const list = (chosen ? chosen.list : scoped).filter(s => s.delay !== null).sort((a, b) => b.delay - a.delay);
  return `
    <section class="panel" id="d-shipments">
      <div class="panel-head"><h2>${chosen ? esc(describe(chosen)) : 'Shipments'}</h2><p>${num(list.length)} shipments · biggest delay first</p>${chosen ? '<button class="ghost" data-pattern="">Show all</button>' : ''}</div>
      ${table([
        {label: 'Status', html: s => statusTag(s.status)},
        {label: 'Expected', value: s => formatTime(s.expected)},
        {label: 'Arrived', value: s => formatTime(s.actual)},
        {label: 'Delay', num: true, value: s => `${s.delay > 0 ? '+' : ''}${s.delay} min`},
        {label: 'Carrier', value: s => s.carrier},
        {label: 'Route', value: s => s.route},
        {label: 'Product', html: s => `<a data-product="${esc(s.product_id)}">${esc(s.product_name)}</a>`},
        {label: 'PO', value: s => s.po},
      ], list.slice(0, SHIPMENT_ROWS))}
      ${list.length > SHIPMENT_ROWS ? `<p class="hint">First ${SHIPMENT_ROWS} of ${num(list.length)}</p>` : ''}
    </section>`;
}

function oddsSection({shipments, patterns}) {
  const segments = [['all', 'All shipments', shipments], ...patterns.problems.map(p => [p.key, describe(p), p.list]), ...patterns.reliable.slice(0, 2).map(p => [p.key, describe(p), p.list])];
  const current = segments.find(s => s[0] === ui.oddsSegment) ?? segments[0];
  const odds = windowOdds(current[2], ui.window);
  const overall = windowOdds(shipments, ui.window);
  return `
    <section class="panel" id="d-odds">
      <div class="panel-head"><h2>Chance of arriving on time</h2><p>From past deliveries, not a forecast model</p></div>
      <div class="odds">
        <div class="odds-controls">
          <label>For<select data-odds>${segments.map(([key, label]) => `<option value="${esc(key)}" ${key === current[0] ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></label>
          <label>Window<select data-window>${[5, 10, 15, 30].map(w => `<option value="${w}" ${w === ui.window ? 'selected' : ''}>±${w} min (e.g. ${noonWindow(w)})</option>`).join('')}</select></label>
        </div>
        <div class="odds-figure"><strong>${pct(odds.rate)}</strong><span>likely range ${pct(odds.low)}–${pct(odds.high)} · ${num(odds.n)} past shipments</span>
          ${current[0] !== 'all' ? `<em>vs ${pct(overall.rate)} for all shipments</em>` : ''}</div>
      </div>
    </section>`;
}

const noonWindow = w => `${String(11 + Math.floor((60 - w) / 60)).padStart(2, '0')}:${String((60 - w) % 60).padStart(2, '0')}–12:${String(w).padStart(2, '0')}`;

function impactSection(scoped) {
  const result = impact(scoped);
  const max = Math.max(1, ...result.expedite_by_carrier.map(c => c.cost));
  return `
    <section class="panel" id="d-impact">
      <div class="panel-head"><h2>Business impact</h2><p>Where delays cost money or sales</p></div>
      <div class="kpis">
        <div class="kpi"><span>Late shipments</span><strong>${num(result.late)}</strong></div>
        <div class="kpi alert"><span>…for products already sold out</span><strong>${num(result.stockout_late)}</strong></div>
        <div class="kpi"><span>Expedite fees on late shipments</span><strong>${money(result.expedite_total)}</strong></div>
      </div>
      <div class="bars compact">${result.expedite_by_carrier.map(c => `<div class="bar-row"><span class="bar-label">${esc(c.carrier)}</span><span class="bar-track"><i class="cost" style="width:${(c.cost / max) * 100}%"></i></span><span class="bar-value">${money(c.cost)}</span></div>`).join('')}</div>
    </section>`;
}

function relationshipSection(scoped) {
  const rel = relationship(scoped, 'distance');
  return `
    <section class="panel" id="d-relationship">
      <div class="panel-head"><h2>Relationship</h2></div>
      <p class="rel"><strong>r = ${Number.isFinite(rel.r) ? rel.r.toFixed(2) : 'n/a'}</strong> between distance and delay · ${num(rel.n)} shipments</p>
      <p class="muted">A weak link: longer routes are slightly later. Correlation is not a cause. Suppliers and carriers are categories, so they are compared above instead.</p>
    </section>`;
}

function decideSection(state) {
  const actions = (state.run?.insights ?? []).filter(i => i.area === 'Deliveries');
  return `
    <section class="panel" id="d-decide">
      <div class="panel-head"><h2>Decide</h2><p>Suggestions; the analyst makes the call</p></div>
      <ul class="decide">${actions.map(a => `<li>${severityBadge(a.severity)}<div><strong>${esc(a.title)}</strong><span>→ ${esc(a.action)}</span></div></li>`).join('')}</ul>
      <div class="limits">
        <strong>What this shows</strong><span>Connected records, patterns with sample sizes, odds from history, traceable to every shipment.</span>
        <strong>Still to validate</strong><span>Illustrative data with planted patterns. A pilot needs Adafruit's real delivery records and analyst feedback.</span>
      </div>
    </section>`;
}

export function render(state) {
  const result = state.run?.result;
  const data = result ? analysis(result) : null;
  if (!data?.shipments.length) {
    return `<section class="panel empty-state"><h2>No delivery data in this run</h2><p class="muted">Load 12 weeks of example shipments to explore.</p><button class="primary" data-load-deliveries ${state.running ? 'disabled' : ''}>Load delivery history</button></section>`;
  }
  return `<div class="deliveries">${questionCard(data.shipments)}${overview(data)}${filterBar(data.shipments)}${comparison(data.scoped)}${patternsSection(data)}${shipmentTable(data)}${oddsSection(data)}${impactSection(data.scoped)}${relationshipSection(data.scoped)}${decideSection(state)}</div>`;
}

export function bind(root) {
  root.querySelector('[data-load-deliveries]')?.addEventListener('click', async () => { await quickStart('deliveries'); update({view: 'deliveries'}); });
  root.querySelector('[data-tolerance]')?.addEventListener('change', e => setDeliveryUi({tolerance: Math.max(0, Number(e.target.value) || 0)}));
  root.querySelectorAll('[data-dfilter]').forEach(el => el.addEventListener('change', () => setDeliveryUi({filters: {...ui.filters, [el.dataset.dfilter]: el.value}})));
  root.querySelector('[data-dclear]')?.addEventListener('click', () => setDeliveryUi({filters: {}}));
  root.querySelectorAll('[data-dim]').forEach(b => b.addEventListener('click', () => setDeliveryUi({dimension: b.dataset.dim})));
  root.querySelectorAll('[data-pattern]').forEach(b => b.addEventListener('click', () => setDeliveryUi({pattern: b.dataset.pattern || null})));
  root.querySelector('[data-odds]')?.addEventListener('change', e => setDeliveryUi({oddsSegment: e.target.value}));
  root.querySelector('[data-window]')?.addEventListener('change', e => setDeliveryUi({window: Number(e.target.value)}));
}
