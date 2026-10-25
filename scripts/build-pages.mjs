// Builds the static GitHub Pages site: the studio UI plus every preset scenario
// pre-computed by the real C++ engine, so the online demo replays genuine engine output.
import {execFileSync, spawn} from 'node:child_process';
import {cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SCENARIOS, buildScenario} from '../dist/studio/lib/scenarios.js';
import {requestKey} from '../dist/studio/lib/hash.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const engine = join(root, 'build/adafruit-engine');
const site = join(root, process.argv[2] ?? 'site');
const PORT = 4199;

async function engineConfig() {
  const server = spawn(engine, ['--port', String(PORT), '--runs', mkdtempSync(join(tmpdir(), 'pages-cfg-'))], {cwd: root, stdio: 'ignore'});
  try {
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        const response = await fetch(`http://127.0.0.1:${PORT}/api/engine/config`);
        if (response.ok) return await response.json();
      } catch {
        // Server still starting.
      }
      await new Promise(r => setTimeout(r, 200));
    }
    throw new Error('Engine server did not start');
  } finally {
    server.kill();
  }
}

function runScenario(request, runs) {
  const file = join(runs, 'request.json');
  writeFileSync(file, JSON.stringify(request));
  const out = JSON.parse(execFileSync(engine, ['--request', file, '--runs', runs], {cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024}));
  return JSON.parse(readFileSync(join(runs, out.run_id, 'result.json'), 'utf8'));
}

rmSync(site, {recursive: true, force: true});
cpSync(join(root, 'dist/studio'), site, {recursive: true});
mkdirSync(join(site, 'data/static/runs'), {recursive: true});
writeFileSync(join(site, '.nojekyll'), '');

const catalog = JSON.parse(readFileSync(join(site, 'data/catalog.json'), 'utf8'));
writeFileSync(join(site, 'data/static/config.json'), JSON.stringify(await engineConfig()));

const runs = mkdtempSync(join(tmpdir(), 'pages-runs-'));
const manifest = {built_at: new Date().toISOString(), runs: []};
for (const scenario of SCENARIOS) {
  const {request} = buildScenario(catalog, scenario.id, {});
  const full = runScenario(request, runs);
  // The UI never reads the echoed request rows; keep source metadata only to keep downloads small.
  const result = {...full, request: {...full.request, sources: full.request.sources.map(({csv, records, ...meta}) => meta)}};
  const file = `data/static/runs/${scenario.id}.json`;
  writeFileSync(join(site, file), JSON.stringify(result));
  manifest.runs.push({run_id: result.run_id, label: result.label, mode: result.mode, created_at: result.created_at, summary: result.summary, key: requestKey(request), scenario: scenario.id, file});
  console.log(`${scenario.id}: r=${result.summary.r} rows=${result.summary.input_rows}`);
}
rmSync(runs, {recursive: true, force: true});
writeFileSync(join(site, 'data/static/manifest.json'), JSON.stringify(manifest));
console.log(`Static site written to ${site} (${readdirSync(join(site, 'data/static/runs')).length} pre-computed runs)`);
