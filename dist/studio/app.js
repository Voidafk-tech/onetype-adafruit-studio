// Studio shell: boot, navigation and rendering of the active view.
import * as api from './api.js';
import {state, subscribe, update} from './state.js';
import {refreshRuns} from './actions.js';
import {esc, num} from './ui.js';
import * as overview from './views/overview.js';
import * as sources from './views/sources.js';
import * as run from './views/run.js';
import * as insights from './views/insights.js';
import * as analysis from './views/analysis.js';
import * as products from './views/products.js';
import * as runs from './views/runs.js';
import * as deliveries from './views/deliveries.js';
import {startDemo} from './demo.js';
import {startStory} from './story.js';

const VIEWS = {overview, deliveries, sources, run, insights, analysis, products, runs};
const NAV = [
  ['overview', 'Overview'], ['deliveries', 'Deliveries'], ['sources', 'Data inputs'], ['run', 'Engine run'],
  ['insights', 'Suggestions'], ['analysis', 'Analysis'], ['products', 'Products'], ['runs', 'Runs & exports'],
];

const root = document.getElementById('view');
const nav = document.getElementById('nav');
const drawer = document.getElementById('drawer');
let lastView = null;

function badge(id) {
  if (id === 'sources' && (state.staged.length || state.patches.length)) return state.staged.length + (state.patches.length ? 1 : 0);
  if (id === 'insights' && state.run) return state.run.insights.filter(i => !state.dismissed.includes(i.id) && i.severity === 'high').length || '';
  return '';
}

function render() {
  nav.innerHTML = NAV.map(([id, label]) => `<a class="${state.view === id ? 'active' : ''}" data-go="${id}">${esc(label)}${badge(id) ? `<span class="count">${num(badge(id))}</span>` : ''}</a>`).join('');
  const view = VIEWS[state.view];
  root.innerHTML = view.render(state);
  view.bind?.(root, state);
  // Same view: leave scrolling alone so in-progress smooth scrolls (demo) are not cancelled.
  if (lastView !== state.view) window.scrollTo(0, 0);
  lastView = state.view;
  drawer.innerHTML = products.drawer(state);
  drawer.classList.toggle('open', Boolean(state.drawer));
  products.bindDrawer(drawer);
  document.getElementById('run-status').innerHTML = state.running
    ? '<span class="dot busy"></span>Engine running'
    : state.staticMode ? '<span class="dot ok"></span>Online demo · preset runs' : state.run ? `<span class="dot ok"></span>Run ${esc(state.run.runId)}` : '<span class="dot ok"></span>Engine connected';
}

document.getElementById('play-demo').addEventListener('click', () => startStory());
document.addEventListener('click', event => {
  if (event.target.closest('[data-play-demo]')) { startStory(); return; }
  const go = event.target.closest('[data-go]');
  if (go) { event.preventDefault(); update({view: go.dataset.go, drawer: null}); return; }
  const product = event.target.closest('[data-product]');
  if (product) { event.preventDefault(); update({drawer: product.dataset.product}); }
});
document.addEventListener('keydown', event => { if (event.key === 'Escape' && state.drawer) update({drawer: null}); });

async function boot() {
  try {
    const mode = await api.detectMode();
    const [config, catalog] = await Promise.all([api.getConfig(), api.getCatalog()]);
    subscribe(render);
    update({config, catalog, staticMode: mode === 'static'});
    refreshRuns();
    const params = new URLSearchParams(location.search);
    if (params.has('demo')) startStory();
    else if (params.has('tour')) startDemo();
  } catch (error) {
    root.innerHTML = `<section class="panel"><h2>Cannot reach the engine</h2><p>${esc(error.message)}</p><p>Start it with <code>sh run-studio.sh</code> and open <code>http://127.0.0.1:4181/assets/studio/</code>.</p></section>`;
    document.getElementById('run-status').innerHTML = '<span class="dot bad"></span>Engine offline';
  }
}

boot();
