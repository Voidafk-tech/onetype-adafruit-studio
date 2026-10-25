// Run configuration plus the pipeline view. Stage figures come straight from the engine summary.
import {KIND_LABELS, esc, num, r3} from '../ui.js';
import {runNow} from '../actions.js';
import {buildRequest, recordsOf, update} from '../state.js';
import {label} from '../lib/insights.js';

const STAGE_DELAY_MS = 260;
let revealedFor = null;

function stages(result, insights) {
  const s = result.summary, b = result.baseline;
  const supplied = result.sources.filter(src => result.supplied_sources.includes(src.id));
  const open = result.conflicts.filter(c => c.status === 'conflict_requires_review').length;
  const high = insights.filter(i => i.severity === 'high').length;
  return [
    {name: 'Ingest', figure: num(s.input_rows), unit: 'rows', note: `${num(s.supplied_rows)} new this run`, log: supplied.map(src => `read ${src.id} (${KIND_LABELS[src.kind] ?? src.kind}) · ${num(src.record_count)} rows`)},
    {name: 'Validate', figure: num(result.sources.length), unit: 'sources accepted', note: 'One bad row rejects the batch', log: []},
    {name: 'Deduplicate', figure: num(s.duplicate_rows_suppressed), unit: 'duplicates suppressed', note: `${num(s.distinct_rows)} unique rows`, log: supplied.filter(src => src.duplicate_rows).map(src => `${src.id}: ${num(src.duplicate_rows)} exact duplicates dropped`)},
    {name: 'Match IDs', figure: num(s.matched_rows), unit: 'rows matched', note: `${num(s.unmatched_rows)} held for review`, tone: s.unmatched_rows ? 'warn' : '', log: supplied.filter(src => src.unmatched_rows).map(src => `${src.id}: ${num(src.unmatched_rows)} rows quarantined`)},
    {name: 'Resolve claims', figure: num(s.selected_conflicts), unit: 'spec conflicts', note: `${num(open)} need review`, tone: open ? 'warn' : '', log: result.conflicts.map(c => `product ${c.product_id} ${c.property}: ${c.status.replaceAll('_', ' ')}`)},
    {name: 'Apply what-ifs', figure: num(s.scenario_patches), unit: 'what-ifs', note: `${num(s.changed_fields)} values changed`, log: []},
    {name: 'Analyse', figure: r3(s.r), unit: `r · ${label(result.analysis.x)} vs ${label(result.analysis.y)}`, note: `baseline ${r3(b.r)}`, log: []},
    {name: 'Suggest', figure: num(insights.length), unit: 'suggestions', note: `${num(high)} high priority`, tone: high ? 'bad' : '', log: []},
  ];
}

function config(state) {
  const {config, filters, analysis} = state;
  const option = (value, text, current) => `<option value="${esc(value)}" ${String(current ?? '') === String(value) ? 'selected' : ''}>${esc(text)}</option>`;
  const categories = Object.entries(config.category_labels).sort((a, b) => a[1].localeCompare(b[1]));
  const metrics = which => config.metrics.map(m => option(m.id, m.label, analysis[which])).join('');
  const request = buildRequest(state);
  const rows = state.staged.reduce((sum, s) => sum + recordsOf(s).length, 0);
  return `
    <section class="panel run-config">
      <div class="panel-head"><h2>Settings</h2><p>${esc(request.label)}</p></div>
      <div class="form-grid">
        <label>Manufacturer<select data-filter="manufacturer">${option('', 'All manufacturers', filters.manufacturer)}${config.manufacturers.map(m => option(m, m, filters.manufacturer)).join('')}</select></label>
        <label>Category<select data-filter="category_id">${option('', 'All categories', filters.category_id)}${categories.map(([id, name]) => option(id, `${name} (${id})`, filters.category_id)).join('')}</select></label>
        <label>Availability<select data-filter="availability">${['', 'in_stock', 'out_of_stock', 'unknown'].map(v => option(v, v ? v.replaceAll('_', ' ') : 'Any status', filters.availability)).join('')}</select></label>
        <label>Min price<input type="number" min="0" step="any" data-filter="min_price" value="${esc(filters.min_price ?? '')}"></label>
        <label>Max price<input type="number" min="0" step="any" data-filter="max_price" value="${esc(filters.max_price ?? '')}"></label>
        <label>Analyse X<select data-metric="x">${metrics('x')}</select></label>
        <label>Analyse Y<select data-metric="y">${metrics('y')}</select></label>
      </div>
      <div class="run-inputs">
        <span>${num(state.staged.length)} source${state.staged.length === 1 ? '' : 's'} · ${num(rows)} rows · ${num(state.patches.length)} what-ifs</span>
        <span class="pill ${request.mode === 'simulation' ? 'pill-sim' : ''}">${request.mode === 'simulation' ? 'Simulation' : 'Observed'}</span>
        ${state.staged.some(s => s.origin === 'upload') && !state.patches.length && !state.staged.some(s => s.origin === 'scenario') ? `<label class="check"><input type="checkbox" data-real ${state.treatUploadsAsReal ? 'checked' : ''}> Uploads are real data</label>` : ''}
        <a data-go="sources">Edit</a>
      </div>
      <button class="primary big" data-run ${state.running ? 'disabled' : ''}>${state.running ? 'Engine running…' : 'Run engine'}</button>
    </section>`;
}

function pipeline(state) {
  if (state.runError) return `<section class="panel"><div class="stage stage-bad"><h3>${state.staticMode ? 'Not available online' : 'Rejected'}</h3><p>${esc(state.runError)}</p>${state.staticMode ? '' : '<p class="muted">Nothing was saved.</p>'}</div></section>`;
  if (state.running) return `<section class="panel"><div class="pipeline">${['Ingest', 'Validate', 'Deduplicate', 'Match IDs', 'Resolve claims', 'Apply what-ifs', 'Analyse', 'Suggest'].map((n, i) => `<div class="stage pending ${i === 0 ? 'active' : ''}"><h3>${n}</h3><div class="spinner"></div></div>`).join('')}</div></section>`;
  if (!state.run) return `<section class="panel"><p class="empty">Press <strong>Run engine</strong> to start.</p></section>`;
  const {result, insights, runId} = state.run;
  const animate = revealedFor !== runId;
  revealedFor = runId;
  return `
    <section class="panel">
      <div class="panel-head"><h2>Pipeline · ${esc(result.label)}</h2><p class="mono">${esc(runId)}</p></div>
      <div class="pipeline">
        ${stages(result, insights).map((st, i) => `
          <div class="stage ${st.tone ? `stage-${st.tone}` : ''} ${animate ? 'reveal' : ''}" style="--delay:${i * STAGE_DELAY_MS}ms">
            <h3><span class="step">${i + 1}</span>${esc(st.name)}</h3>
            <strong class="figure">${esc(st.figure)}</strong><span class="unit">${esc(st.unit)}</span>
            <p>${esc(st.note)}</p>
            ${st.log.length ? `<ul class="log">${st.log.slice(0, 4).map(l => `<li>${esc(l)}</li>`).join('')}${st.log.length > 4 ? `<li class="muted">+ ${st.log.length - 4} more</li>` : ''}</ul>` : ''}
          </div>`).join('')}
      </div>
      <div class="actions"><button class="primary" data-go="insights">Suggestions</button><button data-go="analysis">Analysis</button></div>
    </section>`;
}

export function render(state) {
  return `<div class="run-layout">${config(state)}${pipeline(state)}</div>`;
}

export function bind(root) {
  root.querySelector('[data-run]')?.addEventListener('click', runNow);
  root.querySelectorAll('[data-filter]').forEach(el => el.addEventListener('change', () => {
    const value = el.type === 'number' ? (el.value === '' ? undefined : Number(el.value)) : el.value;
    update(s => ({filters: {...s.filters, [el.dataset.filter]: value}}));
  }));
  root.querySelectorAll('[data-metric]').forEach(el => el.addEventListener('change', () => update(s => ({analysis: {...s.analysis, [el.dataset.metric]: el.value}}))));
  root.querySelector('[data-real]')?.addEventListener('change', e => update({treatUploadsAsReal: e.target.checked}));
}
