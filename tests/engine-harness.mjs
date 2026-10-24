// Runs requests through the real engine binary (CLI mode) in a throwaway run directory.
import {execFileSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const engine = join(root, 'build/adafruit-engine');

export function loadCatalog() {
  return JSON.parse(readFileSync(join(root, 'dist/studio/data/catalog.json'), 'utf8'));
}

export function runEngine(request) {
  if (!existsSync(engine)) throw new Error('Build the engine first: sh build-engine.sh');
  const dir = mkdtempSync(join(tmpdir(), 'studio-test-'));
  try {
    const file = join(dir, 'request.json');
    writeFileSync(file, JSON.stringify(request));
    const out = JSON.parse(execFileSync(engine, ['--request', file, '--runs', join(dir, 'runs')], {cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024}));
    return JSON.parse(readFileSync(join(dir, 'runs', out.run_id, 'result.json'), 'utf8'));
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}

export function engineError(request) {
  try {
    runEngine(request);
  } catch (error) {
    return String(error.stderr ?? error.message);
  }
  return null;
}
