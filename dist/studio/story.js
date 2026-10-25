// Cinematic one-button story for non-technical audiences: messy delivery rows are cleaned,
// become one dot per delivery, then regroup to reveal the delay pattern. Every number comes
// from the same engine run the app shows.
import {quickStart} from './actions.js';
import {state, update} from './state.js';
import {analysis, setDeliveryUi} from './views/deliveries.js';
import {impact, performance as deliveryPerformance, windowOdds} from './lib/deliveries.js';
import {plantedChecks} from './lib/planted.js';
import {parseCsv} from './lib/csv.js';
import {startDemo as startTour} from './demo.js';
import {esc} from './ui.js';

const COLORS = {early: '#3987e5', on_time: '#2fbf5b', late: '#ff5a52', unknown: '#77756f', dim: '#2c2c2a'};
const SLOTS = ['Morning', 'Afternoon'];
const MESSY_ROWS = 11;
const CELL_HEAD = 34;   // space above each block for its late %
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const wait = ms => new Promise(resolve => { timers.push(setTimeout(resolve, ms)); });
const pct = v => `${Math.round((v ?? 0) * 100)}%`;

let root = null, canvas = null, ctx = null, dots = [], frame = 0, timers = [], running = false, paused = false, sceneIndex = 0, runPromise = null, facts = null, token = 0;

// ---------- dot engine ----------

function resize() {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = innerWidth * ratio;
  canvas.height = innerHeight * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function moveDots(targetOf, {duration = 1400, stagger = 0.35} = {}) {
  const now = performance.now();
  dots.forEach((d, i) => {
    const target = targetOf(d, i);
    Object.assign(d, {fx: d.x, fy: d.y, fa: d.a, fr: d.r, tx: target.x ?? d.x, ty: target.y ?? d.y, ta: target.a ?? d.a, tr: target.r ?? d.r, color: target.color ?? d.color, start: now + (i / dots.length) * stagger * duration, duration});
  });
}

function draw(now) {
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  for (const d of dots) {
    const t = Math.min(1, Math.max(0, (now - d.start) / d.duration));
    const e = ease(t);
    d.x = d.fx + (d.tx - d.fx) * e; d.y = d.fy + (d.ty - d.fy) * e;
    d.a = d.fa + (d.ta - d.fa) * e; d.r = d.fr + (d.tr - d.fr) * e;
    if (d.a <= 0.01) continue;
    ctx.globalAlpha = d.a;
    ctx.fillStyle = d.color;
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  if (running) frame = requestAnimationFrame(draw);
}

// Deterministic jitter so the cloud looks the same on every replay.
const jitter = (i, salt) => ((Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453) % 1 + 1) % 1;

function timelineTarget(d, i) {
  const left = innerWidth * 0.1, width = innerWidth * 0.8;
  const delay = Math.max(-15, Math.min(90, d.s.delay));
  const band = Math.min(220, innerHeight * 0.26);
  return {x: left + ((delay + 15 + jitter(i, 1)) / 105) * width, y: innerHeight * 0.56 + (jitter(i, 2) - 0.5) * band, a: 0.9, r: 2.4, color: COLORS[d.s.status]};
}

// A carrier × time-of-day matrix: carriers across the top, morning/afternoon down the side.
function groupLayout() {
  const carriers = [...new Set(dots.map(d => d.s.carrier))].sort();
  const left = Math.max(110, innerWidth * 0.1), right = innerWidth * 0.04, gap = Math.max(18, innerWidth * 0.018);
  const headerY = innerHeight * 0.3, top = headerY + 40, bottom = innerHeight - 90;
  const cellW = (innerWidth - left - right - gap * (carriers.length - 1)) / carriers.length;
  const cellH = (bottom - top - gap) / SLOTS.length;
  const cells = new Map();
  carriers.forEach((carrier, c) => SLOTS.forEach((slot, r) => cells.set(`${carrier}|${slot}`, {carrier, slot, x: left + c * (cellW + gap), y: top + r * (cellH + gap), w: cellW, h: cellH, list: []})));
  for (const d of dots) cells.get(`${d.s.carrier}|${d.s.slot}`)?.list.push(d);
  // Size dots so the largest group fills its box: big, countable blocks read across a room.
  const largest = Math.max(...[...cells.values()].map(c => c.list.length));
  const spacing = Math.max(4, Math.min(16, Math.sqrt((cellW * (cellH - CELL_HEAD)) / (largest * 1.15))));
  const perRow = Math.max(1, Math.floor(cellW / spacing));
  for (const cell of cells.values()) {
    cell.list.sort((a, b) => (b.s.status === 'late') - (a.s.status === 'late'));
    cell.contentH = CELL_HEAD + Math.ceil(cell.list.length / perRow) * spacing;
  }
  return {cells, carriers, spacing, perRow, left, headerY};
}

function groupTarget({cells, spacing, perRow}, focusKey) {
  const radius = spacing * 0.38;
  const positions = new Map();
  for (const [key, cell] of cells) {
    cell.list.forEach((d, i) => positions.set(d, {x: cell.x + (i % perRow) * spacing + spacing / 2, y: cell.y + CELL_HEAD + Math.floor(i / perRow) * spacing + spacing / 2, dim: focusKey && key !== focusKey}));
  }
  return d => {
    const p = positions.get(d);
    return {x: p.x, y: p.y, r: radius, a: p.dim ? 0.12 : 0.95, color: COLORS[d.s.status]};
  };
}

// ---------- scenes ----------

function stage(html, className = '') {
  const el = root.querySelector('.story-stage');
  el.className = `story-stage ${className}`;
  el.innerHTML = html;
  return el;
}

const caption = (big, small = '') => {
  root.querySelector('.story-caption').innerHTML = `<strong class="pop">${esc(big)}</strong>${small ? `<span class="pop late-in">${esc(small)}</span>` : ''}`;
};

function messyRows() {
  const source = state.staged.find(s => s.id.startsWith('DELIVERY_HISTORY'));
  const {records} = parseCsv(source.csv);
  const pick = id => records.find(r => r.record_id === id);
  const flags = [
    {row: records[0]}, {row: records[1]}, {row: pick('ship-6'), tag: 'missing time', field: 'actual_arrival'},
    {row: records[2]}, {row: pick('ship-unknown-1'), tag: 'unknown product', field: 'product_id'},
    {row: records[3]}, {row: pick('ship-18'), tag: 'impossible time', field: 'expected_arrival'},
    {row: pick('ship-41')}, {row: records.at(-4), tag: 'duplicate', field: 'record_id'},
    {row: records[4]}, {row: pick('ship-unknown-2'), tag: 'unknown product', field: 'product_id'},
  ];
  return {flags: flags.slice(0, MESSY_ROWS), total: records.length};
}

const COLUMNS = [['record_id', 'Row'], ['product_id', 'Product'], ['carrier', 'Carrier'], ['expected_arrival', 'Expected'], ['actual_arrival', 'Arrived']];

async function sceneHook() {
  caption('One late delivery.');
  const el = stage('<div class="clock"><span class="clock-label">Expected</span><strong>12:00</strong><span class="clock-label">Arrived</span><strong class="clock-actual">12:00</strong></div>', 'center');
  const actual = el.querySelector('.clock-actual');
  for (let m = 0; m <= 10; m++) {
    if (!running) return;
    actual.textContent = `12:${String(m).padStart(2, '0')}`;
    if (m > 0) actual.classList.add('late');
    await wait(160);
  }
  await wait(900);
  caption('One late delivery.', 'Bad luck… or a pattern?');
  await wait(2600);
}

async function sceneMessy() {
  const {flags, total} = messyRows();
  caption(`${total.toLocaleString()} delivery records`, 'Straight from the export. Messy.');
  const el = stage(`
    <div class="sheet">
      <div class="sheet-row head">${COLUMNS.map(([, label]) => `<span>${label}</span>`).join('')}</div>
      ${flags.map((f, i) => `<div class="sheet-row ${f.tag ? 'bad' : ''}" style="--i:${i}" data-tag="${esc(f.tag ?? '')}">${COLUMNS.map(([key]) => `<span class="${f.field === key ? 'cell-bad' : ''}">${esc(f.row[key] || '—')}</span>`).join('')}${f.tag ? `<em>${esc(f.tag)}</em>` : ''}</div>`).join('')}
    </div>`, 'center');
  await wait(1800);
  el.classList.add('show-problems');
  await wait(3600);
}

async function sceneClean() {
  const q = facts.data.quality;
  caption('OneType cleans it.', 'Checks every row. Matches every product.');
  const el = root.querySelector('.story-stage');
  el.classList.add('cleaning');
  await wait(1300);
  el.insertAdjacentHTML('beforeend', `<div class="bins">
    <div><strong>${q.duplicates}</strong>duplicates removed</div>
    <div><strong>${q.unmatched}</strong>unknown products held</div>
    <div><strong>${q.invalid_timestamps + q.missing_arrival}</strong>missing or bad times</div>
  </div>`);
  await wait(1500);
  el.insertAdjacentHTML('beforeend', `<div class="matched"><strong>${q.matched.toLocaleString()}</strong> deliveries ready</div>`);
  await wait(2200);
}

async function sceneDots() {
  const sheet = root.querySelector('.sheet')?.getBoundingClientRect() ?? {left: innerWidth * 0.2, top: innerHeight * 0.3, width: innerWidth * 0.6, height: innerHeight * 0.4};
  dots = facts.data.shipments.filter(s => s.delay !== null).map((s, i) => {
    const x = sheet.left + jitter(i, 3) * sheet.width, y = sheet.top + jitter(i, 4) * sheet.height;
    return {s, x, y, fx: x, fy: y, tx: x, ty: y, a: 0, fa: 0, ta: 0, r: 1.5, fr: 1.5, tr: 1.5, color: COLORS[s.status], start: 0, duration: 1};
  });
  stage('', 'fade');
  caption('Every dot is one delivery.');
  moveDots(timelineTarget, {duration: 1800, stagger: 0.45});
  await wait(2000);
  stage(`<div class="axis-labels"><span class="early">◀ Early</span><span class="ontime">On time</span><span class="late">Late ▶</span></div>`, 'fade-in');
  await wait(1500);
  caption(`${pct(facts.perf.late_rate)} arrive late.`, 'Every dot is one delivery.');
  await wait(2800);
}

async function scenePattern() {
  const layout = groupLayout();
  const {cells, carriers, left, headerY} = layout;
  const first = facts.data.patterns.problems[0];
  const focusKey = first?.values.carrier && first?.values.slot ? `${first.values.carrier}|${first.values.slot}` : null;
  caption('Split by carrier and time of day.');
  moveDots(groupTarget(layout, null), {duration: 1600, stagger: 0.3});
  const anyRow = SLOTS.map(slot => cells.get(`${carriers[0]}|${slot}`));
  const columns = carriers.map(carrier => {
    const cell = cells.get(`${carrier}|${SLOTS[0]}`);
    return `<div class="col-head" data-carrier="${esc(carrier)}" style="left:${cell.x}px;top:${headerY}px;width:${cell.w}px">${esc(carrier)}</div>`;
  }).join('');
  const rows = anyRow.map(cell => `<div class="row-head" data-slot="${cell.slot}" style="top:${cell.y + CELL_HEAD}px;width:${left - 24}px">${cell.slot}</div>`).join('');
  const rates = [...cells.values()].map(c => {
    const late = c.list.filter(d => d.s.status === 'late').length;
    return `<div class="cell-rate" data-key="${esc(`${c.carrier}|${c.slot}`)}" style="left:${c.x}px;top:${c.y}px;width:${c.w}px">${c.list.length ? pct(late / c.list.length) : '—'}<span>late</span></div>`;
  }).join('');
  stage(`<div class="legend-big"><span class="late">● Late</span><span class="ontime">● On time</span></div>${columns}${rows}${rates}`, 'fade-in');
  await wait(3200);
  if (!focusKey) return;
  const cell = cells.get(focusKey);
  moveDots(groupTarget(layout, focusKey), {duration: 900, stagger: 0});
  const el = root.querySelector('.story-stage');
  el.classList.add('focusing');
  el.querySelector(`.cell-rate[data-key="${CSS.escape(focusKey)}"]`)?.classList.add('focus');
  el.querySelector(`.col-head[data-carrier="${CSS.escape(cell.carrier)}"]`)?.classList.add('focus');
  el.querySelector(`.row-head[data-slot="${cell.slot}"]`)?.classList.add('focus');
  const pad = 12;
  el.insertAdjacentHTML('beforeend', `<div class="cell-ring" style="left:${cell.x - pad}px;top:${cell.y - pad}px;width:${cell.w + pad * 2}px;height:${cell.contentH + pad * 2}px"></div>`);
  caption(`${first.values.carrier} · afternoons`, `${pct(first.rate)} late. Everyone else: ${pct(first.rest_rate)}.`);
  await wait(4600);
}

function ring(value, label, tone) {
  const r = 70, c = 2 * Math.PI * r;
  return `<div class="ring ${tone}"><svg viewBox="0 0 180 180"><circle cx="90" cy="90" r="${r}" class="track"/><circle cx="90" cy="90" r="${r}" class="fill" style="--dash:${c};--to:${c * (1 - value)}"/></svg><strong>${pct(value)}</strong><span>${esc(label)}</span></div>`;
}

async function sceneOdds() {
  moveDots(d => ({a: 0, r: 0.5}), {duration: 700, stagger: 0});
  const first = facts.data.patterns.problems[0];
  caption('Chance of arriving on time', '11:50 – 12:10');
  stage(`<div class="rings">${ring(facts.all.rate, 'All deliveries', 'good')}${first ? ring(facts.odds.rate, `${first.values.carrier} afternoons`, 'bad') : ''}</div>`, 'center');
  await wait(4800);
}

function countUp(el, to, {prefix = '', duration = 1400} = {}) {
  const start = performance.now();
  const step = now => {
    const t = Math.min(1, (now - start) / duration);
    el.textContent = `${prefix}${Math.round(to * ease(t)).toLocaleString()}`;
    if (t < 1 && running) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

async function sceneImpact() {
  caption('What it costs');
  const el = stage(`<div class="impact-big"><div><strong data-count="${Math.round(facts.cost.expedite_total)}" data-prefix="$">$0</strong><span>in rush shipping fees</span></div><div><strong data-count="${facts.cost.stockout_late}">0</strong><span>late deliveries of sold-out products</span></div></div>`, 'center');
  el.querySelectorAll('[data-count]').forEach(n => countUp(n, Number(n.dataset.count), {prefix: n.dataset.prefix ?? ''}));
  await wait(4300);
}

async function sceneAction() {
  const first = facts.data.patterns.problems[0];
  const found = facts.checks.filter(c => c.caught === c.planted).length;
  caption('The decision');
  stage(`<div class="action-big"><span class="check">✓</span><strong>Move ${esc(first?.values.carrier ?? 'late')} deliveries to mornings</strong></div><p class="footnote">Found ${found} of ${facts.checks.length} planted problems · synthetic demo data</p>`, 'center');
  await wait(4800);
}

async function sceneEnd() {
  caption('');
  root.querySelector('.story-logo')?.classList.add('hide');
  stage(`<div class="end"><img class="brand-big" src="assets/logo-on-dark.png" alt="OneType"><p>From messy delivery records to a clear next step.</p>
    <div class="end-actions"><button class="primary" data-story="replay">↺ Replay</button><button data-story="explore">Explore the app</button><button data-story="tour">Guided tour</button></div></div>`, 'center');
}

const SCENES = [sceneHook, sceneMessy, sceneClean, sceneDots, scenePattern, sceneOdds, sceneImpact, sceneAction, sceneEnd];

// ---------- lifecycle ----------

function buildFacts() {
  setDeliveryUi({tolerance: 5, filters: {}, dimension: 'carrier', pattern: null, window: 10, oddsSegment: 'all'});
  const data = analysis(state.run.result);
  const first = data.patterns.problems[0];
  return {
    data, perf: deliveryPerformance(data.shipments), cost: impact(data.shipments),
    odds: first ? windowOdds(first.list, 10) : null, all: windowOdds(data.shipments, 10),
    checks: plantedChecks('deliveries', state.run.planted, state.run.result, state.run.insights),
  };
}

function renderProgress() {
  root.querySelector('.story-progress').innerHTML = SCENES.map((_, i) => `<i class="${i < sceneIndex ? 'done' : i === sceneIndex ? 'now' : ''}"></i>`).join('');
}

async function play(from = 0) {
  const mine = ++token;
  for (sceneIndex = from; sceneIndex < SCENES.length; sceneIndex++) {
    if (!running || mine !== token) return;
    renderProgress();
    if (sceneIndex === 1) await runPromise;               // messy rows come from the generated export
    if (sceneIndex === 2 && !facts) { await runPromise; facts = buildFacts(); }
    while (paused && running) await wait(200);
    await SCENES[sceneIndex]();
  }
}

function build() {
  root = document.createElement('div');
  root.className = 'story';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'OneType demo');
  root.innerHTML = `<canvas></canvas><img class="story-logo" src="assets/logo-on-dark.png" alt="OneType"><div class="story-caption"></div><div class="story-stage"></div>
    <div class="story-controls"><div class="story-progress"></div><button data-story="pause" aria-label="Pause">❚❚</button><button data-story="close" aria-label="Close">✕</button></div>`;
  document.body.append(root);
  canvas = root.querySelector('canvas');
  ctx = canvas.getContext('2d');
  resize();
  root.addEventListener('click', event => {
    const action = event.target.closest('[data-story]')?.dataset.story;
    if (action === 'close') closeStory();
    if (action === 'replay') startStory();
    if (action === 'explore') { closeStory(); update({view: 'deliveries'}); }
    if (action === 'tour') { closeStory(); startTour(); }
    if (action === 'pause') { paused = !paused; event.target.textContent = paused ? '▶' : '❚❚'; }
  });
}

function onKey(event) {
  if (!root) return;
  if (event.key === 'Escape') closeStory();
  if (event.key === ' ') { event.preventDefault(); root.querySelector('[data-story="pause"]')?.click(); }
}

export function startStory() {
  closeStory();
  build();
  running = true;
  paused = false;
  document.body.classList.add('story-on');
  facts = null;
  dots = [];
  addEventListener('resize', resize);
  addEventListener('keydown', onKey);
  frame = requestAnimationFrame(draw);
  runPromise = quickStart('deliveries').then(() => { if (state.runError) throw new Error(state.runError); });
  runPromise.catch(error => {
    if (!root) return;
    stage(`<div class="end"><p>${esc(error.message)}</p><button data-story="close">Close</button></div>`, 'center');
  });
  play(0);
}

export function closeStory() {
  running = false;
  token++;
  timers.forEach(clearTimeout);
  timers = [];
  cancelAnimationFrame(frame);
  removeEventListener('resize', resize);
  removeEventListener('keydown', onKey);
  root?.remove();
  root = null;
  document.body.classList.remove('story-on');
}
