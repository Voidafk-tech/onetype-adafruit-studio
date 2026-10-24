// Writes every default scenario as replayable engine requests plus standalone upload files,
// so the same data can go on slides, be uploaded live in the studio, or run from the CLI.
import {mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SCENARIOS, buildScenario} from '../dist/studio/lib/scenarios.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(readFileSync(join(root, 'dist/studio/data/catalog.json'), 'utf8'));
const out = join(root, 'demo/scenarios');
rmSync(out, {recursive: true, force: true});
mkdirSync(out, {recursive: true});

const index = [];
for (const scenario of SCENARIOS) {
  const {request, planted} = buildScenario(catalog, scenario.id);
  writeFileSync(join(out, `${scenario.id}.request.json`), JSON.stringify(request, null, 2) + '\n');
  if (request.sources.length) mkdirSync(join(out, 'uploads', scenario.id), {recursive: true});
  const files = request.sources.map(source => {
    const name = `${scenario.id}/${source.id}.${source.csv ? 'csv' : 'json'}`;
    const {csv, ...envelope} = source;
    writeFileSync(join(out, 'uploads', name), csv ?? JSON.stringify(envelope) + '\n');
    return name;
  });
  index.push({id: scenario.id, title: scenario.title, request: `${scenario.id}.request.json`, uploads: files, patches: request.patches.length, planted});
}
writeFileSync(join(out, 'index.json'), JSON.stringify(index, null, 2) + '\n');
console.log(`Wrote ${index.length} scenarios to ${out}`);
