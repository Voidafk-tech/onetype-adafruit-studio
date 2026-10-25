import {esc, num, r3, severityBadge} from '../ui.js';
import {quickStart, openRun} from '../actions.js';
import {SCENARIOS} from '../lib/scenarios.js';
import {update} from '../state.js';

const QUICK = ['deliveries', 'ops-morning', 'warehouse', 'tariff-shock'];

export function render(state) {
  const {catalog, run, runs} = state;
  const result = run?.result;
  const counts = run ? run.insights.reduce((acc, i) => ({...acc, [i.severity]: (acc[i.severity] ?? 0) + 1}), {}) : {};
  return `
    <section class="hero">
      <p class="eyebrow">Adafruit operations</p>
      <h1>Every source, one product model, <br>clear next actions.</h1>
      <p class="lede">Organizes supply data so analysts can find delivery problems, investigate causes and decide what to do.</p>
      <button class="play big-play" data-play-demo>▶ Play the demo <span>about 2 minutes</span></button>
      <div class="hero-stats">
        <div><strong>${num(catalog.products.length)}</strong><span>catalog products</span></div>
        <div><strong>${num(catalog.sources.length)}</strong><span>connected sources</span></div>
        <div><strong>${esc(catalog.catalog_captured_at)}</strong><span>catalog captured</span></div>
        <div><strong>${num(runs.length)}</strong><span>saved runs</span></div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><h2>Try a demo</h2></div>
      <div class="quick-grid">
        ${QUICK.map(id => SCENARIOS.find(s => s.id === id)).map(s => `
          <button class="quick" data-quick="${s.id}" ${state.running ? 'disabled' : ''}>
            <span class="tag">${esc(s.area)}</span>
            <strong>${esc(s.title)}</strong>
            <span>${esc(s.story)}</span>
          </button>`).join('')}
      </div>
      <p class="hint"><a data-go="sources">More scenarios or upload your own →</a></p>
    </section>

    ${result ? `
    <section class="panel">
      <div class="panel-head"><h2>Latest run · ${esc(result.label)}</h2><p>${result.mode === 'simulation' ? '<span class="pill pill-sim">Simulation</span>' : '<span class="pill">Observed</span>'}</p></div>
      <div class="kpis">
        <div class="kpi"><span>Products in view</span><strong>${num(result.summary.selected_products)}</strong></div>
        <div class="kpi"><span>Rows processed</span><strong>${num(result.summary.distinct_rows)}</strong></div>
        <div class="kpi"><span>Quarantined</span><strong>${num(result.summary.unmatched_rows)}</strong></div>
        <div class="kpi"><span>Correlation r</span><strong>${r3(result.summary.r)}</strong></div>
      </div>
      <div class="sev-row">${['high', 'medium', 'low', 'info'].map(level => `<span>${severityBadge(level)} ${num(counts[level] ?? 0)}</span>`).join('')}</div>
      <ul class="top-list">
        ${run.insights.slice(0, 5).map(i => `<li>${severityBadge(i.severity)}<span>${esc(i.title)}</span></li>`).join('')}
      </ul>
      <button class="primary" data-go="insights">See all ${num(run.insights.length)}</button>
    </section>` : ''}

    ${runs.length ? `
    <section class="panel">
      <div class="panel-head"><h2>Recent runs</h2></div>
      <ul class="run-list">
        ${runs.slice(0, 6).map(r => `<li><a data-open-run="${esc(r.run_id)}">${esc(r.label)}</a><span class="muted">${esc(r.mode)} · ${esc(r.created_at)} · r ${r3(r.summary?.r)}</span></li>`).join('')}
      </ul>
    </section>` : ''}`;
}

export function bind(root) {
  root.querySelectorAll('[data-quick]').forEach(b => b.addEventListener('click', async () => {
    await quickStart(b.dataset.quick);
    if (b.dataset.quick === 'deliveries') update({view: 'deliveries'});
  }));
  root.querySelectorAll('[data-open-run]').forEach(a => a.addEventListener('click', () => openRun(a.dataset.openRun)));
}
