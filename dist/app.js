// HTML handles presentation. Searches, joins and evidence traversal run in C++.
const $ = (selector) => document.querySelector(selector);
const state = {selected: 'V_PICO2', type: 'product_variants', tab: 'overview', results: [], listRequest: 0, detailRequest: 0};
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const friendly = value => String(value ?? '').replaceAll('_', ' ');
const display = value => value === null || value === undefined ? 'Unknown' : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value);
const badge = (text, kind = '') => `<span class="badge ${kind}">${escapeHtml(text)}</span>`;
const recordButton = (id, text) => `<button class="link-button" data-entity="${escapeHtml(id)}">${escapeHtml(text ?? id)}</button>`;
const section = (title, content) => content ? `<section class="detail-section"><h3>${escapeHtml(title)}</h3>${content}</section>` : '';
const safeUrl = value => {try {const u = new URL(value); return u.protocol === 'https:' ? u.href : '#';} catch {return '#';}};

async function api(path) {
  const response = await fetch(path);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}
function showError(error) {$('#error').hidden = false; $('#error').textContent = error.message;}
function view(name) {
  for (const element of document.querySelectorAll('.view')) element.hidden = element.id !== `${name}-view`;
  for (const button of document.querySelectorAll('[data-view]')) button.classList.toggle('active', button.dataset.view === name);
  if (name === 'graph') loadGraph().catch(showError);
}

async function search() {
  const request = ++state.listRequest;
  const params = new URLSearchParams({type: state.type, q: $('#search').value});
  const results = await api(`/api/entities?${params}`);
  if (request !== state.listRequest) return;
  state.results = results;
  $('#result-count').textContent = results.length;
  $('#entity-list').innerHTML = results.map(row => `<button class="entity-button ${row.id === state.selected ? 'selected' : ''}" data-entity="${escapeHtml(row.id)}"><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.id)}</small>${row.status ? badge(friendly(row.status), row.status === 'proposed' || row.status === 'open' ? 'amber' : 'green') : ''}</button>`).join('') || '<p class="empty">No records match this search. Try another term or select all record types.</p>';
}

function priceText(price) {
  const currency = price.currency ? ` ${price.currency}` : ' · currency unconfirmed';
  return `${price.raw_price}${currency}${price.min_quantity > 1 ? ` · ${price.min_quantity}+ units` : ''}`;
}
function listingCards(rows) {
  return rows.map(row => `<div class="listing-card"><div class="listing-top">${recordButton(row.id, `${row.company_name} · ${row.native_sku}`)}${badge(row.mapping_status === 'proposed' ? 'Proposed match' : 'Design match', row.mapping_status === 'proposed' ? 'amber' : 'green')}</div><div class="listing-values">${row.availability.map(a => `<span><strong>${escapeHtml(a.raw_status)}</strong></span>`).join('')}${row.prices.filter(p => p.price_kind === 'displayed_base').map(p => `<span>${escapeHtml(priceText(p))}</span>`).join('')}</div></div>`).join('');
}
function issueCards(rows) {
  return rows.map(row => `<div class="issue-card ${row.status === 'open' ? '' : 'resolved'}">${recordButton(row.id, friendly(row.category))} ${badge(row.status === 'open' ? 'Open' : 'Resolved with evidence', row.status === 'open' ? 'amber' : 'green')}<p>${escapeHtml(row.explanation)}</p></div>`).join('');
}
function relations(rows, current) {
  return rows.map(edge => {
    const other = edge.from_id === current ? edge.to : edge.from;
    const direction = edge.from_id === current ? '→' : '←';
    return `<div class="connection-row"><span class="predicate">${direction} ${escapeHtml(friendly(edge.predicate))}</span>${recordButton(other.id, other.name)}${edge.mapping_status === 'proposed' ? badge('Proposed', 'amber') : ''}</div>`;
  }).join('');
}
function claimsTable(rows) {
  if (!rows.length) return '<p class="empty">No source claims are attached to this record.</p>';
  return `<div class="table-wrap"><table><thead><tr><th>Claim</th><th>Original value</th><th>Source / evidence</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escapeHtml(friendly(row.property))}</td><td>${escapeHtml(row.raw_value)}</td><td>${row.source_ids.map(id => recordButton(id)).join(' · ')}<br>${recordButton(row.raw_record_id, 'Original record')}</td></tr>`).join('')}</tbody></table></div>`;
}
function sourceCards(rows) {
  return rows.map(source => `<div class="source-card"><a href="${escapeHtml(safeUrl(source.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title)} ↗</a><small>${escapeHtml(source.id)} · ${escapeHtml(source.publisher)} · ${escapeHtml(source.media_type)}<br>Captured ${escapeHtml(source.captured_on)} · underlying update time unknown</small></div>`).join('');
}

function renderDetail(detail) {
  const row = detail.record;
  const tabs = ['overview', 'claims', 'evidence', 'record'];
  let content = '';
  if (state.tab === 'overview') {
    if (row.explanation) content += section('What this issue means', `<p>${escapeHtml(row.explanation)}</p>`);
    if (row.mapping_rationale) content += section('Match decision', `<p>${escapeHtml(row.mapping_rationale)}</p>`);
    if (detail.resolved_specifications.length) content += section('Selected design facts', `<div class="fact-grid">${detail.resolved_specifications.map(fact => `<div class="fact"><span>${escapeHtml(friendly(fact.property))}</span><strong>${escapeHtml(fact.value.toLocaleString())} ${escapeHtml(fact.unit)}${fact.qualifier === 'up_to' ? ' maximum' : ''}</strong></div>`).join('')}</div><p class="small-note">Selected with source evidence. Original claims remain available in the Claims tab.</p>`);
    if (detail.related_listings.length) content += section('Retailer listings', listingCards(detail.related_listings));
    if (detail.prices.length) content += section('Observed prices', `<div class="table-wrap"><table><thead><tr><th>Price</th><th>Minimum quantity</th><th>Capture date</th></tr></thead><tbody>${detail.prices.map(p => `<tr><td>${escapeHtml(priceText(p))}</td><td>${p.min_quantity} ${p.min_quantity === 1 ? '(default unit inferred)' : ''}</td><td>${escapeHtml(p.observed_on)}</td></tr>`).join('')}</tbody></table></div>`);
    if (detail.availability.length) content += section('Reported availability', detail.availability.map(a => `<p>${escapeHtml(a.raw_status)} · ${escapeHtml(a.observed_on)}<br>Explicit numeric quantity: ${escapeHtml(display(a.reported_quantity))}</p>`).join(''));
    if (detail.affected_records.length) content += section('Affected records', detail.affected_records.map(r => `<div class="connection-row">${recordButton(r.id, r.name)}</div>`).join(''));
    if (detail.relationships.length) content += section('Connections', relations(detail.relationships, row.id));
    if (detail.issues.length) {
      const important = detail.issues.filter(issue => issue.category === 'conflicting_specification' || issue.category === 'unconfirmed_configuration_match');
      content += section('Evidence and review', issueCards(important.length ? important : detail.issues.slice(0, 3)) + `<p class="small-note">${detail.issues.length} attached issue records. Inspect all issues through the Data quality filter.</p>`);
    }
    if (!content) content = `<pre>${escapeHtml(JSON.stringify(row, null, 2))}</pre>`;
  } else if (state.tab === 'claims') {
    content = section('Retained source claims', claimsTable(detail.claims));
    content += section('Resolution decisions', detail.resolved_specifications.map(fact => `<div class="listing-card"><strong>${escapeHtml(friendly(fact.property))}: ${escapeHtml(fact.value)} ${escapeHtml(fact.unit)}</strong><p class="small-note">${escapeHtml(fact.resolution_rationale)}</p><div>${fact.source_ids.map(id => recordButton(id)).join(' · ')}</div></div>`).join(''));
  } else if (state.tab === 'evidence') {
    content = section('Original source records', detail.raw_records.map(raw => `<details class="raw-card"><summary>${escapeHtml(raw.id)} · ${escapeHtml(raw.source_id)} · ${escapeHtml(friendly(raw.record_type))}</summary><p>${escapeHtml(raw.locator)}</p><pre>${escapeHtml(JSON.stringify(raw.fields, null, 2))}</pre><p>${escapeHtml(raw.notes)}</p></details>`).join('') || '<p class="empty">No raw extract is attached.</p>');
    content += section('Source documents and pages', sourceCards(detail.sources));
    content += '<p class="small-note">These are selected factual transcriptions with source links. Complete page HTML and PDFs were not archived. Source collection was manual.</p>';
  } else {
    content = `<p class="small-note">The exact JSON record loaded by C++. Unknown fields remain null; agent review is separate from your team’s confirmation.</p><pre>${escapeHtml(JSON.stringify(row, null, 2))}</pre>`;
  }
  $('#inspector').innerHTML = `<p class="detail-kicker">${escapeHtml(friendly(detail.type))}</p><h2 class="detail-title">${escapeHtml(row.name || row.title || friendly(row.category || row.property) || row.id)}</h2><p class="record-id">${escapeHtml(row.id)}</p><div class="badges">${row.mapping_status ? badge(friendly(row.mapping_status), row.mapping_status === 'proposed' ? 'amber' : 'green') : ''}${badge(row.review_status ? 'Agent reviewed' : 'Source capture')}${badge('Team confirmation pending')}${row.revision === null ? badge('Physical revision unknown') : ''}</div><div class="detail-tabs" role="tablist" aria-label="Record details">${tabs.map(tab => `<button role="tab" aria-selected="${state.tab === tab}" class="${state.tab === tab ? 'active' : ''}" data-tab="${tab}">${tab === 'record' ? 'JSON record' : tab[0].toUpperCase()+tab.slice(1)}</button>`).join('')}</div><div role="tabpanel">${content}</div>`;
}
let currentDetail;
async function inspect(id, switchView = true) {
  const request = ++state.detailRequest;
  if (switchView) view('explore');
  const detail = await api(`/api/entity?${new URLSearchParams({id})}`);
  if (request !== state.detailRequest) return;
  state.selected = id; state.tab = 'overview'; currentDetail = detail;
  renderDetail(detail);
  for (const button of document.querySelectorAll('.entity-button')) button.classList.toggle('selected', button.dataset.entity === id);
}

const svgElement = (tag, attributes, text) => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
};
async function loadGraph() {
  const graph = await api(`/api/graph?proposed=${$('#show-proposed').checked ? '1' : '0'}`);
  const canvas = svgElement('svg', {viewBox: '0 0 1220 680', role: 'img', 'aria-label': 'Interactive entity relationship graph'});
  const columns = [['companies', 25, 'COMPANIES'], ['listings', 320, 'RETAILER LISTINGS'], ['product_variants', 625, 'PRODUCT DESIGNS'], ['components', 935, 'COMPONENTS / DOCUMENTS']];
  const positions = new Map();
  for (const [type, x, title] of columns) {
    canvas.append(svgElement('text', {x, y: 35, class: 'graph-heading'}, title));
    graph.nodes.filter(n => n.type === type || (type === 'components' && n.type === 'documents')).forEach((node, i) => positions.set(node.id, {x, y: 65+i*90, node}));
  }
  for (const edge of graph.edges) {
    const a = positions.get(edge.from_id), b = positions.get(edge.to_id);
    if (!a || !b) continue;
    const right = a.x <= b.x, x1 = a.x + (right ? 240 : 0), x2 = b.x + (right ? 0 : 240), y1 = a.y+28, y2 = b.y+28;
    const mid = (x1+x2)/2;
    const path = svgElement('path', {d: `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`, class: `graph-edge ${edge.mapping_status === 'proposed' ? 'proposed' : ''}`});
    path.append(svgElement('title', {}, `${edge.from_id} → ${friendly(edge.predicate)} → ${edge.to_id}`)); canvas.append(path);
  }
  for (const [id, {x, y, node}] of positions) {
    const group = svgElement('g', {transform: `translate(${x},${y})`, class: 'graph-node', role: 'button', tabindex: '0', 'aria-label': `Inspect ${node.name}`});
    group.append(svgElement('rect', {width: 240, height: 57}));
    group.append(svgElement('text', {x: 12, y: 24}, node.name.length > 31 ? node.name.slice(0, 29)+'…' : node.name));
    group.append(svgElement('text', {x: 12, y: 43, class: 'node-id'}, id));
    group.append(svgElement('title', {}, node.name));
    group.addEventListener('click', () => inspect(id).catch(showError));
    group.addEventListener('keydown', event => {if (event.key === 'Enter' || event.key === ' ') {event.preventDefault(); inspect(id).catch(showError);}});
    canvas.append(group);
  }
  $('#graph').replaceChildren(canvas);
}

document.addEventListener('click', event => {
  const entity = event.target.closest('[data-entity], [data-demo]');
  if (entity) inspect(entity.dataset.entity || entity.dataset.demo).catch(showError);
  const nav = event.target.closest('[data-view]'); if (nav) view(nav.dataset.view);
  const tab = event.target.closest('[data-tab]'); if (tab && currentDetail) {state.tab = tab.dataset.tab; renderDetail(currentDetail);}
});
$('#entity-type').addEventListener('change', () => {state.type = $('#entity-type').value; search().catch(showError);});
let searchTimer;
$('#search').addEventListener('input', () => {clearTimeout(searchTimer); searchTimer = setTimeout(() => search().catch(showError), 150);});
$('#show-proposed').addEventListener('change', () => loadGraph().catch(showError));
$('#learn-graph').addEventListener('click', () => view('graph'));

async function start() {
  const summary = await api('/api/summary');
  $('#capture-date').textContent = `Source capture · ${summary.observed_on}`;
  $('#backend-note').textContent = `${summary.backend} backend connected`;
  const metrics = [[summary.listings, 'Retailer listings'], [summary.shared_designs.length, 'Shared design matches · agent reviewed'], [summary.relationships, 'Recorded relationships'], [summary.sources, 'Traceable public sources']];
  $('#metrics').innerHTML = metrics.map(([value, title]) => `<div class="metric"><strong>${value}</strong><span>${escapeHtml(title)}</span></div>`).join('');
  await Promise.all([search(), inspect(state.selected, false)]);
}
start().catch(error => {$('#backend-note').textContent = 'Backend unavailable'; showError(error);});
