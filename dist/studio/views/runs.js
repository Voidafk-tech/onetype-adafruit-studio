// Saved run history and the downloadable outputs for the open run.
import {esc, num, r3} from '../ui.js';
import {downloadUrl} from '../api.js';
import {exportWorkbook, openRun, refreshRuns} from '../actions.js';

const FILES = [
  ['products.csv', 'Products'], ['changes.csv', 'Changes'], ['evidence.csv', 'Linked records'], ['unmatched.csv', 'Held for review'],
  ['correlations.csv', 'By manufacturer'], ['sources.csv', 'Sources'], ['inputs.json', 'Inputs, for replay'], ['result.json', 'Full result'],
];

export function render(state) {
  const current = state.run?.runId;
  return `
    ${current ? `
    <section class="panel">
      <div class="panel-head"><h2>Downloads</h2><p>${esc(state.run.result.label)}</p></div>
      <div class="files">
        ${state.staticMode ? '' : '<button class="file" data-excel><strong>workbook.xlsx</strong><span>Excel report</span></button>'}
        ${FILES.filter(([file]) => downloadUrl(current, file)).map(([file, note]) => `<a class="file" href="${esc(downloadUrl(current, file))}" download><strong>${esc(file)}</strong><span>${esc(note)}</span></a>`).join('')}
      </div>

    </section>` : ''}
    <section class="panel">
      <div class="panel-head"><h2>Run history</h2>${state.staticMode ? '' : '<button class="ghost" data-refresh>Refresh</button>'}</div>
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
