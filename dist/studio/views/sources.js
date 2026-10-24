// Data inputs: connected sources, scenario generator, live upload and the staged batch.
import {KIND_LABELS, download, esc, num, rawTable, table} from '../ui.js';
import {clearInputs, generateScenario, removeSource, runNow, setSourceKind, uploadFiles} from '../actions.js';
import {recordsOf, update} from '../state.js';
import {SCENARIOS, defaultKnobs} from '../lib/scenarios.js';

const REQUIRED = {
  inventory: ['warehouse_id', 'quantity'], purchase_orders: ['purchase_order_id', 'quantity'], specifications: ['property', 'value', 'unit'],
  communications: ['subject'], documents: ['title', 'url'], catalog: ['product_name'], observations: [],
};
let selected = 'ops-morning';
let knobs = {};

function knobInput(knob, value, state) {
  const id = `knob-${knob.id}`;
  if (knob.type === 'manufacturer') {
    const options = ['', ...state.config.manufacturers].map(m => `<option value="${esc(m)}" ${m === value ? 'selected' : ''}>${esc(m || 'All manufacturers')}</option>`).join('');
    return `<label>${esc(knob.label)}<select id="${id}" data-knob="${knob.id}">${options}</select></label>`;
  }
  if (knob.type === 'category') {
    const counts = new Map();
    for (const p of state.catalog.products) counts.set(p.category_id, {name: p.category, n: (counts.get(p.category_id)?.n ?? 0) + 1});
    const options = [...counts].filter(([, c]) => c.n >= 10).sort((a, b) => b[1].n - a[1].n)
      .map(([cid, c]) => `<option value="${esc(cid)}" ${cid === value ? 'selected' : ''}>${esc(c.name)} · ${c.n} products</option>`).join('');
    return `<label>${esc(knob.label)}<select id="${id}" data-knob="${knob.id}">${options}</select></label>`;
  }
  if (knob.type === 'range') {
    return `<label>${esc(knob.label)} <output for="${id}">${esc(value)}</output><input id="${id}" type="range" min="${knob.min}" max="${knob.max}" value="${esc(value)}" data-knob="${knob.id}"></label>`;
  }
  return `<label>${esc(knob.label)}<input id="${id}" type="number" min="${knob.min}" max="${knob.max}" value="${esc(value)}" data-knob="${knob.id}"></label>`;
}

function generator(state) {
  const scenario = SCENARIOS.find(s => s.id === selected);
  const values = {...defaultKnobs(scenario), ...knobs};
  return `
    <section class="panel">
      <div class="panel-head"><h2>Generate scenario data</h2><p>Seeded and reproducible. Every generated value is hypothetical and runs in simulation mode.</p></div>
      <div class="scenario-grid">
        ${SCENARIOS.map(s => `<button class="scenario ${s.id === selected ? 'active' : ''}" data-scenario="${s.id}"><span class="tag">${esc(s.area)}</span><strong>${esc(s.title)}</strong></button>`).join('')}
      </div>
      <div class="scenario-detail">
        <p>${esc(scenario.story)}</p>
        <div class="knobs">${scenario.knobs.map(k => knobInput(k, values[k.id], state)).join('')}</div>
        <div class="actions"><button class="primary" data-generate>Generate inputs</button><button data-generate-run ${state.running ? 'disabled' : ''}>Generate and run</button></div>
      </div>
    </section>`;
}

function stagedCard(source) {
  const records = recordsOf(source);
  const headers = [...new Set(records.flatMap(r => Object.keys(r)))];
  const missing = (REQUIRED[source.kind] ?? []).filter(h => !headers.includes(h));
  const kinds = Object.entries(KIND_LABELS).map(([k, l]) => `<option value="${k}" ${k === source.kind ? 'selected' : ''}>${l}</option>`).join('');
  return `
    <article class="staged">
      <header>
        <div><strong>${esc(source.label)}</strong><span class="muted mono">${esc(source.id)}</span></div>
        <span class="pill ${source.origin === 'scenario' ? 'pill-sim' : 'pill-up'}">${source.origin === 'scenario' ? 'Generated' : 'Uploaded'}</span>
      </header>
      <div class="staged-meta">
        <label>Type<select data-kind="${esc(source.id)}">${kinds}</select></label>
        <span>${num(records.length)} rows · ${headers.length} columns · captured ${esc(source.captured_at)}</span>
        ${missing.length ? `<span class="warn">Missing column${missing.length > 1 ? 's' : ''} for this type: ${esc(missing.join(', '))}</span>` : ''}
      </div>
      <details><summary>Preview first rows</summary>${rawTable(records)}</details>
      <div class="actions"><button data-download="${esc(source.id)}">Download ${source.csv ? 'CSV' : 'JSON'}</button><button class="ghost" data-remove="${esc(source.id)}">Remove</button></div>
    </article>`;
}

function patchTable(state) {
  if (!state.patches.length) return '';
  const byId = new Map(state.catalog.products.map(p => [p.id, p]));
  const field = {price_value: 'price', shipping_weight_g: 'weight_g', public_quantity: 'quantity'};
  return `
    <article class="staged">
      <header><div><strong>What-if changes</strong><span class="muted">${num(state.patches.length)} hypothetical values, applied after matching</span></div><span class="pill pill-sim">Simulation</span></header>
      <details><summary>Preview first changes</summary>${table([
        {label: 'Product', value: p => byId.get(p.product_id)?.name ?? p.product_id},
        {label: 'Field', value: p => p.field},
        {label: 'Current', num: true, value: p => byId.get(p.product_id)?.[field[p.field]] ?? '—'},
        {label: 'What-if', num: true, value: p => p.value},
      ], state.patches.slice(0, 12))}</details>
    </article>`;
}

function catalogBrowser(state) {
  const q = state.catalogQuery.trim().toLowerCase();
  const rows = q ? state.catalog.products.filter(p => `${p.id} ${p.name} ${p.manufacturer} ${p.category}`.toLowerCase().includes(q)) : state.catalog.products;
  return `
    <section class="panel">
      <div class="panel-head"><h2>Catalog baseline</h2><p>${num(rows.length)} of ${num(state.catalog.products.length)} products · read-only snapshot the engine starts from</p></div>
      <input class="search" type="search" placeholder="Search name, ID, manufacturer or category" value="${esc(state.catalogQuery)}" data-catalog-search>
      ${table([
        {label: 'ID', html: p => `<a data-product="${esc(p.id)}" class="mono">${esc(p.id)}</a>`},
        {label: 'Product', value: p => p.name},
        {label: 'Manufacturer', value: p => p.manufacturer || '—'},
        {label: 'Category', value: p => p.category},
        {label: 'Price', num: true, value: p => (Number.isFinite(p.price) ? p.price.toFixed(2) : '—')},
        {label: 'Weight g', num: true, value: p => p.weight_g ?? '—'},
        {label: 'Availability', value: p => p.availability.replaceAll('_', ' ')},
      ], rows.slice(0, 25))}
    </section>`;
}

export function render(state) {
  const total = state.staged.reduce((sum, s) => sum + recordsOf(s).length, 0);
  return `
    <section class="panel">
      <div class="panel-head"><h2>Connected sources</h2><p>Already in the engine's baseline workspace.</p></div>
      ${table([
        {label: 'Source', value: s => s.label},
        {label: 'Type', value: s => KIND_LABELS[s.kind] ?? s.kind},
        {label: 'Rows', num: true, value: s => num(s.record_count)},
        {label: 'Captured', value: s => s.captured_at},
      ], state.catalog.sources)}
    </section>
    ${generator(state)}
    <section class="panel">
      <div class="panel-head"><h2>Upload data</h2><p>CSV or JSON. The type is detected from the headers; the engine validates every row before accepting the batch.</p></div>
      <label class="dropzone" data-dropzone>
        <input type="file" multiple accept=".csv,.json,text/csv,application/json" data-files hidden>
        <strong>Drop files here or click to choose</strong>
        <span>Warehouse counts, purchase orders, supplier messages, spec sheets, catalog captures, or a saved engine request.</span>
        <span class="muted">Demo files: <code>demo/scenarios/uploads/</code></span>
      </label>
    </section>
    <section class="panel">
      <div class="panel-head">
        <h2>Staged for the next run</h2>
        <p>${state.staged.length || state.patches.length ? `${num(state.staged.length)} source${state.staged.length === 1 ? '' : 's'} · ${num(total)} rows · ${num(state.patches.length)} what-if changes` : 'Nothing staged: a run will use the live baseline only.'}</p>
      </div>
      <div class="staged-list">${state.staged.map(stagedCard).join('')}${patchTable(state)}</div>
      <div class="actions">
        <button class="primary" data-run ${state.running ? 'disabled' : ''}>Run engine</button>
        ${state.staged.length || state.patches.length ? '<button class="ghost" data-clear>Clear staged inputs</button>' : ''}
      </div>
    </section>
    ${catalogBrowser(state)}`;
}

function readKnobs(root) {
  const values = {};
  root.querySelectorAll('[data-knob]').forEach(el => { values[el.dataset.knob] = el.type === 'range' || el.type === 'number' ? Number(el.value) : el.value; });
  return values;
}

export function bind(root, state) {
  root.querySelectorAll('[data-scenario]').forEach(b => b.addEventListener('click', () => { selected = b.dataset.scenario; knobs = {}; update({}); }));
  root.querySelectorAll('[data-knob]').forEach(el => el.addEventListener('input', () => {
    knobs = readKnobs(root);
    const out = el.parentElement.querySelector('output');
    if (out) out.textContent = el.value;
  }));
  root.querySelector('[data-generate]')?.addEventListener('click', () => generateScenario(selected, readKnobs(root)));
  root.querySelector('[data-generate-run]')?.addEventListener('click', () => { generateScenario(selected, readKnobs(root)); runNow(); });
  root.querySelector('[data-run]')?.addEventListener('click', runNow);
  root.querySelector('[data-clear]')?.addEventListener('click', clearInputs);
  root.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => removeSource(b.dataset.remove)));
  root.querySelectorAll('[data-kind]').forEach(s => s.addEventListener('change', () => setSourceKind(s.dataset.kind, s.value)));
  root.querySelectorAll('[data-download]').forEach(b => b.addEventListener('click', () => {
    const source = state.staged.find(s => s.id === b.dataset.download);
    if (source.csv) download(`${source.id}.csv`, source.csv);
    else download(`${source.id}.json`, JSON.stringify({...source, origin: undefined, fileName: undefined}, null, 2), 'application/json');
  }));
  const input = root.querySelector('[data-files]');
  const zone = root.querySelector('[data-dropzone]');
  input?.addEventListener('change', () => { uploadFiles([...input.files]); input.value = ''; });
  zone?.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
  zone?.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone?.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('over'); uploadFiles([...e.dataTransfer.files]); });
  const search = root.querySelector('[data-catalog-search]');
  search?.addEventListener('input', () => {
    update({catalogQuery: search.value});
    const again = document.querySelector('[data-catalog-search]');
    again.focus();
    again.setSelectionRange(again.value.length, again.value.length);
  });
}

