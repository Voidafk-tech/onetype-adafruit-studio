// Rendering helpers shared by every view. All source values are escaped before display.

export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

export const num = (value, digits = 0) => (Number.isFinite(value) ? value.toLocaleString(undefined, {minimumFractionDigits: digits, maximumFractionDigits: digits}) : '—');
export const r3 = value => (Number.isFinite(value) ? value.toFixed(3) : 'n/a');

export function delta(after, before, digits = 0) {
  if (!Number.isFinite(after) || !Number.isFinite(before) || after === before) return '';
  const diff = after - before;
  return `<span class="delta ${diff > 0 ? 'up' : 'down'}">${diff > 0 ? '▲' : '▼'} ${num(Math.abs(diff), digits)}</span>`;
}

export const SEVERITY = {
  high: {icon: '●', label: 'High'},
  medium: {icon: '▲', label: 'Medium'},
  low: {icon: '◆', label: 'Low'},
  info: {icon: 'ℹ', label: 'Info'},
};

export const severityBadge = level => `<span class="sev sev-${level}"><span aria-hidden="true">${SEVERITY[level].icon}</span>${SEVERITY[level].label}</span>`;

export const KIND_LABELS = {
  catalog: 'Catalog', specifications: 'Specifications', observations: 'Page observations', documents: 'Documents',
  inventory: 'Warehouse inventory', purchase_orders: 'Purchase orders', communications: 'Communications',
};

export function table(columns, rows, {empty = 'No rows', rowAttr = () => ''} = {}) {
  if (!rows.length) return `<p class="empty">${esc(empty)}</p>`;
  const head = columns.map(c => `<th class="${c.num ? 'num' : ''}">${esc(c.label)}</th>`).join('');
  const body = rows.map(row => `<tr ${rowAttr(row)}>${columns.map(c => `<td class="${c.num ? 'num' : ''}">${c.html ? c.html(row) : esc(c.value(row))}</td>`).join('')}</tr>`).join('');
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

export function rawTable(records, limit = 8) {
  if (!records.length) return '<p class="empty">No rows</p>';
  const headers = [...new Set(records.flatMap(r => Object.keys(r)))];
  const columns = headers.map(h => ({label: h, value: r => (typeof r[h] === 'object' ? JSON.stringify(r[h]) : r[h])}));
  return table(columns, records.slice(0, limit));
}

export function download(name, text, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], {type}));
  const link = Object.assign(document.createElement('a'), {href: url, download: name});
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toast(message, tone = 'info') {
  const el = Object.assign(document.createElement('div'), {className: `toast toast-${tone}`, textContent: message, role: 'status'});
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), 5200);
}
