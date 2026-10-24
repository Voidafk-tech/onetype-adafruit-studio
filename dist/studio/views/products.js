// Connected product records for the current run, and the product detail drawer.
import {KIND_LABELS, esc, num, severityBadge, table} from '../ui.js';
import {update} from '../state.js';

const PAGE = 50;
let page = 0;
let onlyLinked = false;

const money = v => (Number.isFinite(v) ? v.toFixed(2) : '—');

export function render(state) {
  if (!state.run) return '<section class="panel"><p class="empty">Run the engine to see connected products. The read-only catalog is on <a data-go="sources">Data inputs</a>.</p></section>';
  const {result} = state.run;
  const q = state.productQuery.trim().toLowerCase();
  const rows = result.products.filter(p => (!onlyLinked || p.linked_records > 0 || p.scenario_modified) && (!q || `${p.product_id} ${p.product_name} ${p.manufacturer} ${p.category}`.toLowerCase().includes(q)));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  page = Math.min(page, pages - 1);
  return `
    <section class="panel">
      <div class="panel-head"><h2>Connected products</h2><p>${num(rows.length)} of ${num(result.products.length)} in view</p></div>
      <div class="filters">
        <input class="search" type="search" placeholder="Search products" value="${esc(state.productQuery)}" data-product-search>
        <label class="check"><input type="checkbox" data-linked ${onlyLinked ? 'checked' : ''}> Only products with linked evidence or changes</label>
      </div>
      ${table([
        {label: 'ID', html: p => `<a data-product="${esc(p.product_id)}" class="mono">${esc(p.product_id)}</a>`},
        {label: 'Product', value: p => p.product_name},
        {label: 'Manufacturer', value: p => p.manufacturer || '—'},
        {label: 'Price', num: true, value: p => money(p.price_value)},
        {label: 'Weight g', num: true, value: p => p.shipping_weight_g ?? '—'},
        {label: 'Availability', value: p => p.availability.replaceAll('_', ' ')},
        {label: 'Linked', num: true, value: p => p.linked_records},
        {label: 'Analysis', value: p => (p.decision === 'Included' ? 'Included' : p.decision.replaceAll('_', ' '))},
        {label: 'Flags', html: p => `${p.scenario_modified ? '<span class="pill pill-sim">what-if</span>' : ''}${p.quality_flags.filter(f => f !== 'currency_unconfirmed').map(f => `<span class="pill">${esc(f.replaceAll('_', ' '))}</span>`).join('')}`},
      ], rows.slice(page * PAGE, page * PAGE + PAGE))}
      <div class="pager"><button data-page="-1" ${page === 0 ? 'disabled' : ''}>Previous</button><span>Page ${page + 1} of ${pages}</span><button data-page="1" ${page >= pages - 1 ? 'disabled' : ''}>Next</button></div>
    </section>`;
}

export function bind(root) {
  const search = root.querySelector('[data-product-search]');
  search?.addEventListener('input', () => {
    page = 0;
    update({productQuery: search.value});
    const again = document.querySelector('[data-product-search]');
    again.focus();
    again.setSelectionRange(again.value.length, again.value.length);
  });
  root.querySelector('[data-linked]')?.addEventListener('change', e => { onlyLinked = e.target.checked; page = 0; update({}); });
  root.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => { page += Number(b.dataset.page); update({}); }));
}

function evidenceText(row) {
  const r = row.raw;
  if (row.kind === 'inventory') return `${r.warehouse_id}: ${r.quantity} units${r.bin ? ` · bin ${r.bin}` : ''}`;
  if (row.kind === 'purchase_orders') return `${r.purchase_order_id}: ${r.quantity} units${r.supplier ? ` from ${r.supplier}` : ''}${r.expected_date ? ` · due ${r.expected_date}` : ''}`;
  if (row.kind === 'communications') return `${r.subject}${r.excerpt ? ` — ${r.excerpt}` : ''}`;
  if (row.kind === 'specifications') return `${r.property} ${r.value} ${r.unit}`;
  if (row.kind === 'documents') return r.title;
  if (row.kind === 'observations') return `${r.availability ?? ''} ${r.price ?? ''}`.trim();
  return JSON.stringify(r);
}

export function drawer(state) {
  if (!state.drawer) return '';
  const id = state.drawer;
  const result = state.run?.result;
  const product = result?.products.find(p => p.product_id === id);
  const fallback = state.catalog.products.find(p => p.id === id);
  if (!product && !fallback) return '';
  const name = product?.product_name ?? fallback.name;
  const evidence = (result?.evidence ?? []).filter(e => e.product_id === id);
  const conflicts = (result?.conflicts ?? []).filter(c => `ADA:${c.product_id}` === id);
  const related = (state.run?.insights ?? []).filter(i => i.products.includes(id));
  const changes = (result?.changes ?? []).filter(c => c.product_id === id);
  const facts = product
    ? [['Manufacturer', product.manufacturer || '—'], ['Category', product.category], ['Price', money(product.price_value)], ['Shipping weight', `${product.shipping_weight_g ?? '—'} g`], ['Availability', product.availability.replaceAll('_', ' ')], ['Public quantity', product.public_quantity ?? 'unknown'], ['Clock', product.clock_mhz ? `${product.clock_mhz} MHz` : '—'], ['SRAM', product.sram_kb ? `${product.sram_kb} kB` : '—'], ['Flash', product.flash_mb ? `${product.flash_mb} MB` : '—'], ['Captured', product.captured_at]]
    : [['Manufacturer', fallback.manufacturer || '—'], ['Category', fallback.category], ['Price', money(fallback.price)], ['Availability', fallback.availability], ['Note', 'Outside the current run selection']];
  return `
    <aside class="drawer" role="dialog" aria-label="${esc(name)}">
      <header><div><p class="mono muted">${esc(id)}</p><h2>${esc(name)}</h2></div><button class="ghost" data-close aria-label="Close">✕</button></header>
      <a href="https://www.adafruit.com/product/${esc(id.replace('ADA:', ''))}" target="_blank" rel="noopener noreferrer">Official product page ↗</a>
      <dl class="facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      ${related.length ? `<h3>Suggestions</h3><ul class="top-list">${related.map(i => `<li>${severityBadge(i.severity)}<span>${esc(i.title)}</span></li>`).join('')}</ul>` : ''}
      ${changes.length ? `<h3>Changed in this run</h3>${table([{label: 'Field', value: c => c.field}, {label: 'Before', value: c => c.before ?? '—'}, {label: 'After', value: c => c.after ?? '—'}], changes)}` : ''}
      ${conflicts.length ? `<h3>Spec claims</h3>${conflicts.map(c => `<p><strong>${esc(c.property)}</strong> · ${esc(c.status.replaceAll('_', ' '))}</p><ul class="log">${c.claims.map(cl => `<li>${esc(cl.source_label)}: ${esc(cl.raw.value)} ${esc(cl.raw.unit)}</li>`).join('')}</ul>`).join('')}` : ''}
      <h3>Linked evidence (${num(evidence.length)})</h3>
      ${evidence.length ? `<ul class="evidence">${evidence.map(e => `<li><span class="tag">${esc(KIND_LABELS[e.kind] ?? e.kind)}</span><span>${esc(evidenceText(e))}</span><span class="muted">${esc(e.source_label)} · ${esc(e.captured_at)} · matched by ${esc(e.match_basis.replaceAll('_', ' '))}</span></li>`).join('')}</ul>` : '<p class="empty">No linked records beyond the catalog row.</p>'}
    </aside>`;
}

export function bindDrawer(root) {
  root.querySelector('[data-close]')?.addEventListener('click', () => update({drawer: null}));
}
