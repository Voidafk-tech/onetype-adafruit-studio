// Builds the studio's read-only catalog index by running the engine's own baseline.
// The index lets the browser and scenario generators pick real product IDs.
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist/studio/data/catalog.json');
const runs = mkdtempSync(join(tmpdir(), 'studio-catalog-'));

try {
  execFileSync(join(root, 'build/adafruit-engine'), ['--request', 'demo/baseline.json', '--runs', runs], {cwd: root, stdio: 'pipe'});
  const [run] = readdirSync(runs).filter(name => !name.startsWith('.'));
  const result = JSON.parse(readFileSync(join(runs, run, 'result.json'), 'utf8'));
  const products = result.products.map(p => ({
    id: p.product_id,
    name: p.product_name,
    manufacturer: p.manufacturer,
    category: p.category,
    category_id: p.category_id,
    price: p.price_value,
    weight_g: p.shipping_weight_g,
    availability: p.availability,
    quantity: p.public_quantity,
    stock_raw: p.stock_raw,
    virtual: p.virtual,
  }));
  const catalog = {
    generated_from: 'demo/baseline.json',
    catalog_captured_at: result.sources.find(s => s.kind === 'catalog')?.captured_at ?? null,
    sources: result.sources.map(s => ({id: s.id, kind: s.kind, label: s.label, captured_at: s.captured_at, url: s.url ?? null, record_count: s.record_count})),
    products,
  };
  writeFileSync(output, JSON.stringify(catalog));
  console.log(`Wrote ${products.length} products to ${output}`);
} finally {
  rmSync(runs, {recursive: true, force: true});
}
