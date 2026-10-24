// Small CSV helpers for previews and generated files. The engine does the authoritative parsing.

export function toCsv(records, headers = columnsOf(records)) {
  const cell = value => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [headers.map(cell).join(','), ...records.map(row => headers.map(h => cell(row[h])).join(','))].join('\n') + '\n';
}

export function columnsOf(records) {
  const names = [];
  for (const row of records) for (const key of Object.keys(row)) if (!names.includes(key)) names.push(key);
  return names;
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const input = text.startsWith('﻿') ? text.slice(1) : text;
  const endRow = () => {
    row.push(cell);
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
    cell = '';
  };
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && input[i + 1] === '\n') i++; endRow(); }
    else cell += c;
  }
  if (cell !== '' || row.length) endRow();
  if (!rows.length) return {headers: [], records: []};
  const [headers, ...body] = rows;
  const names = headers.map(h => h.trim());
  return {headers: names, records: body.map(values => Object.fromEntries(names.map((h, i) => [h, values[i] ?? ''])))};
}

// Guess the engine source kind from CSV headers so uploads need fewer clicks.
export function detectKind(headers) {
  const has = name => headers.includes(name);
  if (has('warehouse_id')) return 'inventory';
  if (has('purchase_order_id')) return 'purchase_orders';
  if (has('subject')) return 'communications';
  if (has('property') && has('value')) return 'specifications';
  if (has('title') && has('url')) return 'documents';
  if (has('product_name') && (has('product_price') || has('price'))) return 'catalog';
  if (has('availability') || has('price')) return 'observations';
  return 'specifications';
}
