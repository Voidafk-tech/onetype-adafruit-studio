// Baseline-versus-run numbers, the pairs scatter, manufacturer cohorts and the change log.
import {delta, esc, num, r3, table} from '../ui.js';
import {bindScatter, scatter} from '../chart.js';
import {label} from '../lib/insights.js';
import {update} from '../state.js';

const CHANGE_ROWS = 60;

function kpi(name, after, before, digits = 0, format = v => num(v, digits)) {
  return `<div class="kpi"><span>${esc(name)}</span><strong>${format(after)}</strong><em>baseline ${format(before)} ${delta(after, before, digits)}</em></div>`;
}

const fmtValue = v => (v === null || v === undefined ? '—' : typeof v === 'number' ? num(v, v % 1 ? 2 : 0) : String(v).replaceAll('_', ' '));

export function render(state) {
  if (!state.run) return '<section class="panel"><p class="empty">Run the engine to see the analysis.</p></section>';
  const {result, insights} = state.run;
  const s = result.summary, b = result.baseline;
  const flagged = new Set(insights.filter(i => i.id.startsWith('outliers-')).flatMap(i => i.products));
  const rDigits = v => r3(v);
  return `
    <section class="panel">
      <div class="panel-head"><h2>${esc(result.label)}</h2><p>${esc(result.interpretation)}</p></div>
      <div class="kpis">
        ${kpi('Products in view', s.selected_products, b.selected_products)}
        ${kpi('Complete pairs', s.n, b.n)}
        ${kpi(`r · ${label(result.analysis.x)} vs ${label(result.analysis.y)}`, s.r, b.r, 3, rDigits)}
        ${kpi('Rows processed', s.distinct_rows, b.distinct_rows)}
        ${kpi('Quarantined rows', s.unmatched_rows, b.unmatched_rows)}
        ${kpi('Spec conflicts', s.conflicts, b.conflicts)}
      </div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>${esc(label(result.analysis.x))} vs ${esc(label(result.analysis.y))}</h2><p>Status: ${esc(result.analysis.status.replaceAll('_', ' '))}. Click a point to open the product.</p></div>
      ${scatter(result, {highlight: flagged})}
    </section>
    <div class="two-col">
      <section class="panel">
        <div class="panel-head"><h2>Manufacturer cohorts</h2><p>Groups with at least 8 pairs</p></div>
        ${table([
          {label: 'Manufacturer', value: m => m.manufacturer},
          {label: 'Pairs', num: true, value: m => num(m.n)},
          {label: 'r', num: true, html: m => `<span class="rbar"><i style="--w:${Math.abs(m.r ?? 0) * 100}%;--c:${(m.r ?? 0) < 0 ? 'var(--neg)' : 'var(--series-1)'}"></i>${r3(m.r)}</span>`},
        ], result.manufacturer_correlations.slice(0, 15), {empty: 'No manufacturer has 8 or more complete pairs in this selection.'})}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>What changed</h2><p>${num(result.changes.length)} field changes versus the baseline</p></div>
        ${table([
          {label: 'Product', html: c => `<a data-product="${esc(c.product_id)}" class="mono">${esc(c.product_id)}</a>`},
          {label: 'Field', value: c => c.field},
          {label: 'Before', num: true, value: c => fmtValue(c.before)},
          {label: 'After', num: true, value: c => fmtValue(c.after)},
          {label: 'Basis', value: c => (c.basis === 'scenario_patch' ? 'what-if' : 'import')},
        ], result.changes.slice(0, CHANGE_ROWS), {empty: 'No values changed in this run.'})}
        ${result.changes.length > CHANGE_ROWS ? `<p class="muted">Showing ${CHANGE_ROWS}. The full list is in changes.csv on the Runs page.</p>` : ''}
      </section>
    </div>`;
}

export function bind(root) {
  bindScatter(root, id => update({drawer: id}));
}
