// User intents that touch more than one view: staging inputs, running the engine, loading runs.
import * as api from './api.js';
import {buildRequest, recordsOf, state, uniqueSourceId, update} from './state.js';
import {buildScenario} from './lib/scenarios.js';
import {deriveInsights} from './lib/insights.js';
import {detectKind, parseCsv} from './lib/csv.js';
import {toast} from './ui.js';

const today = () => new Date().toISOString().slice(0, 10);
const takenIds = () => state.staged.map(s => s.id);

export function generateScenario(id, knobs) {
  const {scenario, request, planted} = buildScenario(state.catalog, id, knobs);
  update({
    scenario: {id, title: scenario.title, label: request.label, knobs, planted},
    staged: request.sources.map(source => ({...source, origin: 'scenario'})),
    patches: request.patches,
    filters: request.filters,
    analysis: request.analysis,
    run: null,
  });
  const rows = request.sources.reduce((sum, s) => sum + recordsOf(s).length, 0);
  const parts = [
    request.sources.length && `${request.sources.length} source${request.sources.length === 1 ? '' : 's'} (${rows.toLocaleString()} rows)`,
    request.patches.length && `${request.patches.length.toLocaleString()} what-if changes`,
  ].filter(Boolean);
  toast(`${scenario.title}: ${parts.length ? `staged ${parts.join(' and ')}` : 'baseline only, nothing synthetic staged'}`);
}

export function clearInputs() {
  update({scenario: null, staged: [], patches: [], filters: {}, analysis: {x: 'shipping_weight_g', y: 'price_value'}});
}

export const removeSource = id => update(s => ({staged: s.staged.filter(src => src.id !== id)}));
export const setSourceKind = (id, kind) => update(s => ({staged: s.staged.map(src => (src.id === id ? {...src, kind} : src))}));

function sanitizeId(name) {
  return name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_.:-]+/g, '_').slice(0, 60).toUpperCase() || 'UPLOAD';
}

function stageUploaded(sources, patches = []) {
  const taken = takenIds();
  const staged = sources.map(source => {
    const id = uniqueSourceId(source.id, taken);
    taken.push(id);
    return {...source, id};
  });
  update(s => ({staged: [...s.staged, ...staged], patches: [...s.patches, ...patches]}));
  return staged.length;
}

async function readUpload(file) {
  const text = await file.text();
  if (/\.csv$/i.test(file.name) || file.type === 'text/csv') {
    const {headers, records} = parseCsv(text);
    if (!records.length) throw new Error(`${file.name} has no data rows`);
    return {sources: [{id: sanitizeId(file.name), kind: detectKind(headers), label: `Upload · ${file.name}`, captured_at: today(), csv: text, origin: 'upload', fileName: file.name}]};
  }
  const json = JSON.parse(text);
  if (Array.isArray(json)) return {sources: json.map(s => ({...s, origin: 'upload', fileName: file.name}))};
  if (json.sources || json.patches) {
    return {sources: (json.sources ?? []).map(s => ({...s, origin: 'upload', fileName: file.name})), patches: json.patches ?? [], filters: json.filters, analysis: json.analysis, label: json.label};
  }
  if (json.kind) return {sources: [{...json, origin: 'upload', fileName: file.name}]};
  throw new Error(`${file.name} is not a source envelope, list of sources or engine request`);
}

export async function uploadFiles(files) {
  for (const file of files) {
    try {
      const parsed = await readUpload(file);
      const count = stageUploaded(parsed.sources, parsed.patches);
      if (parsed.filters || parsed.analysis) update(s => ({filters: parsed.filters ?? s.filters, analysis: parsed.analysis ?? s.analysis}));
      const kinds = parsed.sources.map(s => s.kind).join(', ');
      toast(`${file.name}: staged ${count} source${count === 1 ? '' : 's'}${kinds ? ` (${kinds})` : ''}${parsed.patches?.length ? ` and ${parsed.patches.length} what-if changes` : ''}`, 'good');
    } catch (error) {
      toast(`${file.name}: ${error.message}`, 'bad');
    }
  }
}

export async function runNow() {
  if (state.running) return;
  const request = buildRequest();
  update({running: true, runError: null, view: 'run', runStartedAt: Date.now(), pendingRequest: request});
  try {
    const preview = await api.runEngine(request);
    const result = await api.getFullResult(preview.run_id);
    const insights = deriveInsights(result);
    update({running: false, run: {runId: preview.run_id, result, insights, scenarioId: state.scenario?.id ?? null, planted: state.scenario?.planted ?? null}, dismissed: []});
    refreshRuns();
  } catch (error) {
    update({running: false, runError: error.message});
  }
}

export async function openRun(runId) {
  try {
    const result = await api.getFullResult(runId);
    update({run: {runId, result, insights: deriveInsights(result), scenarioId: null, planted: null}, view: 'insights', dismissed: []});
  } catch (error) {
    toast(error.message, 'bad');
  }
}

export async function refreshRuns() {
  try {
    update({runs: await api.listRuns()});
  } catch (error) {
    toast(`Could not list runs: ${error.message}`, 'bad');
  }
}

export async function exportWorkbook(runId) {
  try {
    toast('Building Excel workbook…');
    const {url} = await api.exportExcel(runId);
    window.location.href = url;
  } catch (error) {
    toast(error.message, 'bad');
  }
}

export async function quickStart(id) {
  generateScenario(id, {});
  await runNow();
}
