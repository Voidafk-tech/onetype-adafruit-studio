// Saved run history and the downloadable outputs for the open run.
import {esc, num, r3} from '../ui.js';
import {downloadUrl} from '../api.js';
import {exportWorkbook, openRun, refreshRuns} from '../actions.js';

const FILES = [
  ['products.csv', 'Every product in view, with analysis inclusion reasons'],
  ['changes.csv', 'Field-level before/after values'],
  ['evidence.csv', 'Linked inventory, PO, message and spec records'],
  ['unmatched.csv', 'Quarantined rows awaiting review'],
  ['correlations.csv', 'Manufacturer cohorts'],
  ['sources.csv', 'Source provenance and match counts'],
  ['inputs.json', 'Exact inputs, for replay'],
  ['result.json', 'Complete engine result'],
];

export function render(state) {
  const current = state.run?.runId;
  return `
    ${current ? `
    <section class="panel">
      <div class="panel-head"><h2>Outputs · ${esc(state.run.result.label)}</h2><p class="mono">${esc(current)}</p></div>
      <div class="files">
        <button class="file" data-excel><strong>workbook.xlsx</strong><span>Formatted Excel report (needs the configured spreadsheet runtime)</span></button>
        ${FILES.map(([file, note]) => `<a class="file" href="${downloadUrl(current, file)}"><strong>${esc(file)}</strong><span>${esc(note)}</span></a>`).join('')}
      </div>
      <p class="hint">Replay from the terminal: <code>sh run-engine.sh --replay runs/${esc(current)}/inputs.json</code></p>
    </section>` : ''}
    <section class="panel">
      <div class="panel-head"><h2>Run history</h2><p>Latest 20 saved runs. Each holds its own inputs and outputs; the baseline is never modified.</p><button class="ghost" data-refresh>Refresh</button></div>
      <ul class="run-list">
        ${state.runs.map(r => `<li class="${r.run_id === current ? 'current' : ''}"><a data-open-run="${esc(r.run_id)}">${esc(r.label)}</a><span class="pill ${r.mode === 'simulation' ? 'pill-sim' : ''}">${esc(r.mode)}</span><span class="muted">${esc(r.created_at)} · ${num(r.summary?.selected_products)} products · r ${r3(r.summary?.r)}</span></li>`).join('') || '<li class="empty">No runs yet.</li>'}
      </ul>
    </section>`;
}

export function bind(root, state) {
  root.querySelectorAll('[data-open-run]').forEach(a => a.addEventListener('click', () => openRun(a.dataset.openRun)));
  root.querySelector('[data-refresh]')?.addEventListener('click', refreshRuns);
  root.querySelector('[data-excel]')?.addEventListener('click', () => exportWorkbook(state.run.runId));
}
