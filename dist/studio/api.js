// Thin client for the engine's local HTTP API. All processing happens in C++.

async function call(path, options = {}) {
  const response = await fetch(path, {headers: {'Content-Type': 'application/json'}, ...options});
  const body = await response.json().catch(() => ({error: `Engine returned HTTP ${response.status}`}));
  if (!response.ok) throw new Error(body.error ?? `Engine returned HTTP ${response.status}`);
  return body;
}

export const getConfig = () => call('/api/engine/config');
export const listRuns = () => call('/api/engine/runs');
export const runEngine = request => call('/api/engine/run', {method: 'POST', body: JSON.stringify(request)});
export const exportExcel = runId => call('/api/engine/excel', {method: 'POST', body: JSON.stringify({run_id: runId})});
export const downloadUrl = (runId, file) => `/api/engine/download?run=${encodeURIComponent(runId)}&file=${encodeURIComponent(file)}`;

// The run endpoint previews 50 rows; suggestions and charts need the complete saved result.
export const getFullResult = runId => call(downloadUrl(runId, 'result.json'));

export async function getCatalog() {
  const response = await fetch('/assets/studio/data/catalog.json');
  if (!response.ok) throw new Error('Catalog index missing. Run: node scripts/build-studio-catalog.mjs');
  return response.json();
}
