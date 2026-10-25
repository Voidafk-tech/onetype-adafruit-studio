// Ranked suggestions for the current run, plus the planted-vs-caught scorecard for demos.
import {esc, num, severityBadge} from '../ui.js';
import {update} from '../state.js';
import {plantedChecks} from '../lib/planted.js';

let area = 'All';
const PRODUCT_CHIPS = 6;

function scorecard(state) {
  const {run} = state;
  const checks = plantedChecks(run.scenarioId, run.planted, run.result, run.insights);
  if (!checks.length) return '';
  const caught = checks.filter(c => c.caught === c.planted).length;
  return `
    <section class="panel scorecard">
      <div class="panel-head">
        <h2>Planted vs caught</h2>
        <p>${caught}/${checks.length} found</p>
        <button class="ghost" data-reveal>${state.revealPlanted ? 'Hide' : 'Reveal'} answers</button>
      </div>
      ${state.revealPlanted ? `<ul class="checks">${checks.map(c => `<li class="${c.caught === c.planted ? 'ok' : 'miss'}"><span aria-hidden="true">${c.caught === c.planted ? '✓' : '✗'}</span>${esc(c.label)}<strong>${num(c.caught)} / ${num(c.planted)}</strong></li>`).join('')}</ul>` : ''}
    </section>`;
}

function card(item, products, dismissed) {
  const names = item.products.slice(0, PRODUCT_CHIPS).map(id => `<a class="chip" data-product="${esc(id)}">${esc(products.get(id)?.product_name ?? id)}</a>`).join('');
  return `
    <article class="insight sev-border-${item.severity} ${dismissed ? 'done' : ''}">
      <header>${severityBadge(item.severity)}<span class="tag">${esc(item.area)}</span>${item.count > 1 ? `<span class="muted">${num(item.count)} affected</span>` : ''}</header>
      <h3>${esc(item.title)}</h3>
      <p>${esc(item.detail)}</p>
      <p class="action">→ ${esc(item.action)}</p>
      ${names ? `<div class="chips">${names}${item.products.length > PRODUCT_CHIPS ? `<span class="muted">+${num(item.products.length - PRODUCT_CHIPS)} more</span>` : ''}</div>` : ''}
      <footer><button class="ghost" data-dismiss="${esc(item.id)}">${dismissed ? 'Reopen' : 'Done'}</button></footer>
    </article>`;
}

export function render(state) {
  if (!state.run) return '<section class="panel"><p class="empty">No run yet. <a data-go="overview">Try a demo</a>.</p></section>';
  const {insights, result} = state.run;
  const products = new Map(result.products.map(p => [p.product_id, p]));
  const areas = ['All', ...new Set(insights.map(i => i.area))];
  if (!areas.includes(area)) area = 'All';
  const visible = insights.filter(i => area === 'All' || i.area === area);
  const open = visible.filter(i => !state.dismissed.includes(i.id));
  const done = visible.filter(i => state.dismissed.includes(i.id));
  return `
    ${scorecard(state)}
    <section class="panel">
      <div class="panel-head"><h2>Suggestions</h2><p>${num(open.length)} open · ${num(done.length)} done</p></div>
      <div class="filters">${areas.map(a => `<button class="chip-btn ${a === area ? 'active' : ''}" data-area="${esc(a)}">${esc(a)} <span>${a === 'All' ? insights.length : insights.filter(i => i.area === a).length}</span></button>`).join('')}</div>
      <div class="insight-grid">${open.map(i => card(i, products, false)).join('') || '<p class="empty">Nothing open in this area.</p>'}</div>
      ${done.length ? `<h3 class="sub">Done</h3><div class="insight-grid">${done.map(i => card(i, products, true)).join('')}</div>` : ''}
    </section>`;
}

export function bind(root) {
  root.querySelectorAll('[data-area]').forEach(b => b.addEventListener('click', () => { area = b.dataset.area; update({}); }));
  root.querySelector('[data-reveal]')?.addEventListener('click', () => update(s => ({revealPlanted: !s.revealPlanted})));
  root.querySelectorAll('[data-dismiss]').forEach(b => b.addEventListener('click', () => update(s => ({
    dismissed: s.dismissed.includes(b.dataset.dismiss) ? s.dismissed.filter(id => id !== b.dataset.dismiss) : [...s.dismissed, b.dataset.dismiss],
  }))));
}
