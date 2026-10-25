# OneType Studio

A showcase UI on top of the unchanged C++ Adafruit engine. You can:

- see the input data
- generate realistic synthetic scenarios or upload files live
- watch the engine process them stage by stage
- review ranked suggestions for what to do next

The C++ engine is untouched. Everything here talks to its existing HTTP API.

## Run it

```sh
sh run-studio.sh
```

Open **http://127.0.0.1:4181/assets/studio/**. You can also double-click `start-studio.command`, which opens the browser for you.

The online demo on GitHub Pages replays the preset scenarios, pre-computed by the real engine during the deploy. To process your own uploads or change scenario settings, run it locally.

On the first run, the script compiles the engine and builds `dist/studio/data/catalog.json` from the engine's own baseline run. It needs a C++17 compiler, libcurl and Node.js 18 or later. The original test console is still served at `/`.

## Demo script (about 3 minutes)

1. **Overview**: show the 5,587 real catalog products, then click **Monday operations review**. This generates four synthetic sources for the Raspberry Pi line and runs the engine:
   - a warehouse cycle count
   - open purchase orders
   - a supplier inbox export
   - a messy spec feed
2. **Engine run**: the pipeline fills in stage by stage: ingest → validate → deduplicate → match IDs → resolve claims → apply what-ifs → analyse → suggest. Every figure comes from the engine's result.
3. **Suggestions**: click **Reveal answers**. The scorecard shows the engine caught every problem the generator planted (12/12). The ranked cards below turn those findings into actions. Click a product chip to open its record with linked evidence.
4. **Data inputs**: drag in a file from `demo/scenarios/uploads/`, or your own CSV. The type is detected from the headers. Run again.
5. **Upload a bad file** (for example, a spec row in `GHz`). The engine rejects the whole batch, shows why, and saves nothing.
6. **Analysis**: run **Tariff price shock**. Changed products move on the scatter, drawn from their baseline position, and the price/weight correlation is recomputed against the untouched baseline.
7. **Runs & exports**: download CSV/JSON for any run, or replay it from the terminal.

## Scenarios

All scenarios are seeded and reproducible. Each one runs in simulation mode, and each records what it **planted** so the run can be checked against it.

| Scenario | What it generates | What the engine should catch |
| --- | --- | --- |
| Live catalog baseline | Nothing (real data only) | r ≈ 0.725 on 5,578 pairs |
| Messy distributor spec feed | Spec CSV: mixed units, 6 ID spellings, duplicates, unknown IDs | Duplicates suppressed, unknown IDs quarantined, Pico 2 claim overruled by the reference, an unreferenced dispute left open |
| Tariff price shock | Price what-ifs on a share of one manufacturer | Changed prices, correlation shift (a 100% uniform rise leaves r unchanged) |
| Packaging redesign | Weight what-ifs on one category | Changed weights, correlation shift |
| Warehouse cycle count | 3-warehouse inventory CSV | Listed-but-empty, on-hand-but-hidden, low stock with no PO |
| Open purchase orders | ERP PO CSV | POs covering stock-outs, overstock risk, unknown SKU |
| Supplier inbox | Communications CSV | Delay / EOL / cost / allocation signals; name-only rows held for review |
| Weekend sell-through | Public-quantity what-ifs | Products that sell out |
| Next month's catalog | Full 5,579-row catalog capture with price drift and dropped listings | Price changes as imports; dropped listings kept out of the new price cohort |
| Monday operations review | Four sources at once | All of the above for one product line |

Knobs (seed, size, messiness, percentages, manufacturer, category) are exposed in **Data inputs**.

## How suggestions are made

`dist/studio/lib/insights.js` is a rule layer over the complete engine result. It never re-decides matching or spec selection. It reads quarantine, duplicates, conflicts, linked inventory/PO/communication evidence, changes and analysis pairs, and produces ranked cards with a suggested action. Pricing outliers come from a log price vs log weight trend line (|z| > 2.5). They are worth a look, but they don't prove anything is wrong.

## Files

| Path | Purpose |
| --- | --- |
| `dist/studio/` | The UI (vanilla ES modules, no build step) |
| `dist/studio/lib/scenarios.js` | Seeded scenario generators |
| `dist/studio/lib/insights.js` | Suggestion rules |
| `dist/studio/lib/planted.js` | Planted-vs-caught scorecard |
| `scripts/build-studio-catalog.mjs` | Builds the catalog index from an engine baseline run |
| `scripts/export-scenarios.mjs` | Writes `demo/scenarios/*.request.json` and upload files |
| `tests/` | Generator, suggestion and end-to-end engine tests |

## Tests

```sh
npm test
```

There are 107 tests. They check that:

- each generator is deterministic and only produces valid inputs
- the suggestion rules behave correctly on hand-built results
- every scenario, run through the real engine binary with two seeds, catches exactly what it planted
- invalid batches are rejected
- `data/workspace.json` is never modified

Regenerate demo files after changing generators:

```sh
node scripts/export-scenarios.mjs
```

Replay any of them without the UI:

```sh
sh run-engine.sh --request demo/scenarios/ops-morning.request.json
```

## Known limits

- **Excel export** needs the spreadsheet runtime described in `ENGINE_GUIDE.md`. Without it, the UI shows the engine's error and CSV/JSON downloads still work.
- **Suggestions** are rules over engine output, not forecasts. The engine itself still computes no demand, reorder points or margins.
- **Synthetic data** is all hypothetical and labelled as simulation in every run and export.
