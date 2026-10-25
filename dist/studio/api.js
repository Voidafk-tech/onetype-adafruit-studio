// Client for the engine. Live mode talks to the local C++ HTTP API. Static mode (GitHub Pages)
// replays runs the real engine pre-computed at build time, matched by exact request fingerprint.
import {requestKey} from './lib/hash.js';

const STATIC_MANIFEST = 'data/static/manifest.json';
let manifest = null;

export const isStatic = () => manifest !== null;

async function call(path, options = {}) {
  const response = await fetch(path, {headers: {'Content-Type': 'application/json'}, ...options});
  const body = await response.json().catch(() => ({error: `Engine returned HTTP ${response.status}`}));
  if (!response.ok) throw new Error(body.error ?? `Engine returned HTTP ${response.status}`);
  return body;
}

async function json(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Missing ${path}`);
  return response.json();
}

export async function detectMode() {
  try {
    const response = await fetch(STATIC_MANIFEST);
    if (response.ok) manifest = await response.json();
  } catch {
    manifest = null;
  }
  return isStatic() ? 'static' : 'live';
}

export const getConfig = () => (isStatic() ? json('data/static/config.json') : call('/api/engine/config'));
export const getCatalog = () => json('data/catalog.json');
export const listRuns = async () => (isStatic() ? manifest.runs : call('/api/engine/runs'));

export async function runEngine(request) {
  if (!isStatic()) return call('/api/engine/run', {method: 'POST', body: JSON.stringify(request)});
  const match = manifest.runs.find(run => run.key === requestKey(request));
  if (!match) throw new Error('This online demo only replays the preset scenarios with default settings. Run it locally to process your own data.');
  return {run_id: match.run_id};
}

export function getFullResult(runId) {
  if (!isStatic()) return call(downloadUrl(runId, 'result.json'));
  const run = manifest.runs.find(r => r.run_id === runId);
  return json(run.file);
}

export const exportExcel = runId => call('/api/engine/excel', {method: 'POST', body: JSON.stringify({run_id: runId})});

export function downloadUrl(runId, file) {
  if (isStatic()) return file === 'result.json' ? manifest.runs.find(r => r.run_id === runId)?.file : null;
  return `/api/engine/download?run=${encodeURIComponent(runId)}&file=${encodeURIComponent(file)}`;
}
