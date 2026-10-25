// One-button guided demo. Loads the delivery scenario through the engine, then walks the
// analyst workflow with captions, auto-advancing so it can be presented or screen-recorded.
import {quickStart} from './actions.js';
import {state, subscribe, update} from './state.js';
import {analysis, setDeliveryUi} from './views/deliveries.js';
import {describe, impact, performance, relationship, windowOdds} from './lib/deliveries.js';
import {plantedChecks} from './lib/planted.js';
import {esc} from './ui.js';

const MIN_MS = 5500, MAX_MS = 11000, MS_PER_CHAR = 55;
const pct = v => `${Math.round((v ?? 0) * 100)}%`;
const num = v => (v ?? 0).toLocaleString();

let index = -1, timer = null, paused = false, bar = null, hooked = false, busy = false;

// Facts for the captions, computed from the run that is on screen.
function facts() {
  const data = analysis(state.run.result);
  const [first, second] = data.patterns.problems;
  const perf = performance(data.shipments);
  const cost = impact(data.shipments);
  const checks = plantedChecks('deliveries', state.run.planted, state.run.result, state.run.insights);
  return {data, first, second, perf, cost, checks, rel: relationship(data.shipments), odds: first ? windowOdds(first.list, 10) : null, all: windowOdds(data.shipments, 10)};
}

const STEPS = [
  {view: 'overview', target: '.hero', title: 'OneType', text: () => 'Organizes supply data so analysts can spot delivery problems, investigate causes and decide what to do.'},
  {
    title: 'Import', target: '.pipeline',
    before: async () => {
      setDeliveryUi({tolerance: 5, filters: {}, dimension: 'carrier', pattern: null, window: 10, oddsSegment: 'all'});
      await quickStart('deliveries');
    },
    text: f => `${num(f.data.quality.received)} shipment records cleaned and matched to products: ${f.data.quality.duplicates} duplicates removed, ${f.data.quality.unmatched} unknown products held for review.`,
  },
  {view: 'deliveries', target: '#d-question', title: 'The question', text: () => 'A shipment expected at noon arrived at 12:10. A one-off, or part of a costly pattern?'},
  {view: 'deliveries', target: '#d-overview', title: 'Review performance', text: f => `${pct(f.perf.late_rate)} of ${num(f.perf.n)} shipments arrived late. When late, typically by ${f.perf.median_late_delay} minutes.`},
  {view: 'deliveries', target: '#d-compare', title: 'Compare', before: () => setDeliveryUi({dimension: 'carrier'}), text: f => `By carrier, ${f.first.values.carrier ?? f.first.key} stands out against the rest.`},
  {
    view: 'deliveries', target: '#d-patterns', title: 'Investigate', before: f => setDeliveryUi({pattern: f.first.key}),
    text: f => `It's specific: ${describe(f.first)} are ${pct(f.first.rate)} late vs ${pct(f.first.rest_rate)} elsewhere.${f.second ? ` A second pattern: ${describe(f.second)}.` : ''}`,
  },
  {view: 'deliveries', target: '#d-shipments', title: 'Traceable', text: f => `Every figure opens to the ${num(f.first.list.length)} shipments behind it, down to the purchase order.`},
  {
    view: 'deliveries', target: '#d-odds', title: 'Arrival odds', before: f => setDeliveryUi({oddsSegment: f.first.key, window: 10}),
    text: f => `Chance a ${describe(f.first)} delivery lands between 11:50 and 12:10: ${pct(f.odds.rate)}, against ${pct(f.all.rate)} overall. Based on history, with its uncertainty shown.`,
  },
  {view: 'deliveries', target: '#d-impact', title: 'Impact', text: f => `${num(f.cost.stockout_late)} late shipments were for products already sold out, and $${Math.round(f.cost.expedite_total).toLocaleString()} went on expedite fees.`},
  {view: 'deliveries', target: '#d-relationship', title: 'Association, not cause', text: f => `Distance and delay are only weakly linked (r = ${f.rel.r.toFixed(2)}). It shows where to look, not why.`},
  {view: 'deliveries', target: '#d-decide', title: 'Decide', text: f => `OneType suggests actions, like moving ${f.first.values.carrier ?? 'these'} deliveries to mornings. The analyst decides.`},
  {
    view: 'insights', target: '.scorecard', title: 'Checked', before: () => update({revealPlanted: true}),
    text: f => `The demo data is synthetic with planted problems. OneType found ${f.checks.filter(c => c.caught === c.planted).length} of ${f.checks.length}.`,
  },
  {view: 'deliveries', target: '#d-decide .limits', title: 'Next step', text: () => "Pilot with Adafruit's real delivery records and a small group of analysts.", last: true},
];

function ensureBar() {
  if (bar) return;
  bar = document.createElement('div');
  bar.className = 'demo-bar';
  bar.setAttribute('role', 'dialog');
  bar.setAttribute('aria-live', 'polite');
  document.body.append(bar);
  bar.addEventListener('click', event => {
    const action = event.target.closest('[data-demo]')?.dataset.demo;
    if (action === 'next') go(index + 1);
    if (action === 'back') go(index - 1);
    if (action === 'pause') togglePause();
    if (action === 'close') stopDemo();
    if (action === 'replay') startDemo();
  });
}

function onKey(event) {
  if (index < 0) return;
  if (event.key === 'ArrowRight') go(index + 1);
  if (event.key === 'ArrowLeft') go(index - 1);
  if (event.key === ' ') { event.preventDefault(); togglePause(); }
  if (event.key === 'Escape') stopDemo();
}

function spotlight() {
  document.querySelectorAll('.spotlight').forEach(el => el.classList.remove('spotlight'));
  const step = STEPS[index];
  if (!step) return null;
  const target = document.querySelector(step.target);
  target?.classList.add('spotlight');
  return target;
}

function renderBar(text) {
  const step = STEPS[index];
  const duration = Math.min(MAX_MS, Math.max(MIN_MS, text.length * MS_PER_CHAR));
  bar.innerHTML = `
    <div class="demo-progress"><i style="width:${((index + 1) / STEPS.length) * 100}%"></i></div>
    <div class="demo-body">
      <span class="demo-step">${index + 1} / ${STEPS.length}</span>
      <div class="demo-text"><strong>${esc(step.title)}</strong><p>${esc(text)}</p></div>
      <div class="demo-controls">
        <button data-demo="back" ${index === 0 ? 'disabled' : ''} aria-label="Back">◀</button>
        ${step.last ? '<button data-demo="replay" class="primary">Replay</button>' : `<button data-demo="pause" aria-label="${paused ? 'Play' : 'Pause'}">${paused ? '▶' : '❚❚'}</button><button data-demo="next" aria-label="Next">▶▶</button>`}
        <button data-demo="close" aria-label="Close demo">✕</button>
      </div>
    </div>
    ${paused || step.last ? '' : `<div class="demo-timer" style="animation-duration:${duration}ms"></div>`}`;
  return duration;
}

async function go(next) {
  if (busy || next < 0 || next >= STEPS.length) return;
  clearTimeout(timer);
  busy = true;
  index = next;
  const step = STEPS[index];
  try {
    bar.classList.add('loading');
    if (step.before) await step.before(index > 1 && state.run ? facts() : null);
    if (step.view && state.view !== step.view) update({view: step.view, drawer: null});
    const text = step.text(state.run ? facts() : null);
    const duration = renderBar(text);
    spotlight()?.scrollIntoView({behavior: 'smooth', block: 'start'});
    if (!paused && !step.last) timer = setTimeout(() => go(index + 1), duration);
  } catch (error) {
    bar.innerHTML = `<div class="demo-body"><div class="demo-text"><strong>Demo stopped</strong><p>${esc(error.message)}</p></div><div class="demo-controls"><button data-demo="close">✕</button></div></div>`;
  } finally {
    bar.classList.remove('loading');
    busy = false;
  }
}

function togglePause() {
  paused = !paused;
  clearTimeout(timer);
  const text = STEPS[index].text(state.run ? facts() : null);
  const duration = renderBar(text);
  if (!paused && !STEPS[index].last) timer = setTimeout(() => go(index + 1), duration);
}

export function startDemo() {
  ensureBar();
  if (!hooked) {
    subscribe(() => { if (index >= 0) spotlight(); });
    document.addEventListener('keydown', onKey);
    hooked = true;
  }
  paused = false;
  document.body.classList.add('demo-on');
  index = -1;
  go(0);
}

export function stopDemo() {
  clearTimeout(timer);
  index = -1;
  document.body.classList.remove('demo-on');
  document.querySelectorAll('.spotlight').forEach(el => el.classList.remove('spotlight'));
  bar?.remove();
  bar = null;
}
