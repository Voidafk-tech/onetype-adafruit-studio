// Single application store. Views read `state` and call `update` with a patch; never mutate.
import {parseCsv} from './lib/csv.js';

const listeners = new Set();

export let state = {
  view: 'overview',
  config: null,
  catalog: null,
  staged: [],            // input sources waiting for the next run
  patches: [],           // hypothetical what-if changes
  scenario: null,        // {id, title, knobs, planted}
  filters: {},
  analysis: {x: 'shipping_weight_g', y: 'price_value'},
  treatUploadsAsReal: false,
  running: false,
  run: null,             // {result, insights, runId}
  runs: [],
  dismissed: [],
  revealPlanted: false,
  productQuery: '',
  catalogQuery: '',
  drawer: null,
};

export function update(patch) {
  state = {...state, ...(typeof patch === 'function' ? patch(state) : patch)};
  for (const listener of listeners) listener(state);
}

export const subscribe = listener => listeners.add(listener);

export const recordsOf = source => source.records ?? parseCsv(source.csv).records;

export function uniqueSourceId(id, taken) {
  if (!taken.includes(id)) return id;
  let n = 2;
  while (taken.includes(`${id}_${n}`)) n++;
  return `${id}_${n}`;
}

export function hasSyntheticInputs(s = state) {
  return s.patches.length > 0 || s.staged.some(src => src.origin === 'scenario') || (s.staged.length > 0 && !s.treatUploadsAsReal);
}

export function buildRequest(s = state) {
  const filters = Object.fromEntries(Object.entries(s.filters).filter(([, v]) => v !== '' && v !== null && v !== undefined));
  const label = s.scenario ? s.scenario.label : s.staged.length ? `Custom run · ${s.staged.length} uploaded source${s.staged.length === 1 ? '' : 's'}` : 'Live catalog baseline';
  return {
    label: label.slice(0, 140),
    base: 'workspace',
    mode: hasSyntheticInputs(s) ? 'simulation' : 'observed',
    filters,
    analysis: s.analysis,
    sources: s.staged.map(({origin, fileName, ...source}) => source),
    patches: s.patches,
  };
}
