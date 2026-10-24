**Showcase UI:** run `sh run-studio.sh` and open **http://127.0.0.1:4181/assets/studio/**. See [STUDIO.md](STUDIO.md) for the demo script, synthetic scenarios and tests.

# OneType: Adafruit company-data workspace

**New: testable Adafruit processing engine.** Run `sh run-engine.sh` and open **http://127.0.0.1:4181/** for isolated inputs, simulations, baseline comparisons and Excel/CSV/JSON outputs. See [ENGINE_GUIDE.md](ENGINE_GUIDE.md) for the judge demo, architecture, input contract and replay instructions. The company-model explorer below remains available on port 4180.

HTML/CSS interface and C++17 pipeline for importing, simplifying and connecting company data. The starter has **5,587 real product records fetched from Adafruit's public catalog API on 2026-10-24**, plus reviewed product-page observations and manufacturer references captured on 2026-10-23. Private warehouse stock, orders and emails are not bundled; their import types are implemented for records you actually possess.

## Run

In Terminal inside this folder, run `sh run.sh` and open **http://127.0.0.1:4180**. Keep Terminal open; Control+C stops it. On macOS you can double-click `start.command`. Use `sh run.sh --port 4181` if the default port is occupied. The first run compiles C++.

Requirements: C++17 and system libcurl headers/library. macOS Xcode Command Line Tools provide both; run `xcode-select --install` if `c++ --version` fails. Linux needs a compiler and libcurl development package. No API key or JavaScript package installation is needed. Bundled data works offline; catalog refresh needs internet access.

## Try it

1. Select **Inspect Pico 2**. Its API record, old product-page observation, manufacturer specifications and PDF reference link through product ID 6006.
2. Expand **Before and after cleaning** to compare raw fields with normalized numbers, weights and IDs.
3. Inspect the SRAM conflict: 512 KB and 520 KB source claims stay visible; the bundled reviewed manufacturer reference selects 520 kB. That reference was prepared manually, not extracted from a newly uploaded PDF.
4. Open **Connect sources**, load the real document example, preview, then save. `ADA6006` and the official product URL resolve automatically. The example reuses bundled references and is labeled as non-independent evidence.
5. For your own records, choose a source type and edit its empty template or upload JSON/CSV. CSV headers match the fields below. Choose the CSV source capture date. Unknown IDs are quarantined; names alone never trigger a merge.
6. Open **Patterns & quality**, filter to a manufacturer/category, and inspect the sample size, exclusions, coefficient and source disagreements.
7. **Refresh official catalog** makes a real HTTPS request, saves a new dated capture and keeps prior sources/imports. Failures retain accepted data. Requests are limited to one attempt per 15 seconds.

## What the code does

`cpp/pipeline.cpp` implements typed parsing, exact ID normalization, matching, conflict retention, import validation, persistence, HTTPS refresh and Pearson correlation. `cpp/server.cpp` serves APIs. `dist/workspace.js` renders responses; the browser does not decide which records match.

- `6006`, `ADA6006`, `adafruit:6006` and the exact official product URL resolve to `ADA:6006`. Different retailer product IDs remain separate, including header/wireless variants.
- Numeric strings become typed values; kg converts to grams. Missing/invalid optional catalog numbers remain unknown with flags. Memory units remain as published.
- Negative API stock sentinel values remain unknown. Website availability is kept separate from imported warehouse inventory.
- Raw factual fields and source capture dates remain saved. Identical rows within a source are processed once. Re-importing an identical source ID/content is a no-op; reusing an ID with changed content is rejected.
- The entire import validates before saving. Invalid batches and stale revisions leave accepted data unchanged. A temporary file is renamed over the saved state before the in-memory model changes.
- All technical claims survive. Bundled reviewed manufacturer references have explicit priority; uploads cannot mark themselves trusted. Conflicting unreviewed claims remain unresolved.
- Unknown identities remain quarantined and can link after a missing catalog identity is added. Matching names can produce review candidates, never automatic merges.

This prototype has no enterprise accounts/permissions, arbitrary PDF parser, email-account connector, private database integration or operational action execution. Document imports carry metadata/extracted facts and PDF links. Communication imports accept structured exports. Capture dates do not establish actual underlying update times.

## Import contract

A JSON source envelope has `id`, `kind`, `label`, `captured_at` and a nonempty `records` array. Dates use `YYYY-MM-DD` or UTC `YYYY-MM-DDTHH:MM:SSZ`. Use a new source ID for a new capture. Each record needs an Adafruit `product_id` or exact `product_url`; non-catalog records may instead provide `product_name` for manual candidate review.

| Kind | Additional fields |
| --- | --- |
| `catalog` | `product_name`; optional `product_price`, `product_shipping_weight` (grams), `product_stock`, `product_manufacturer`, `product_master_category`, `currency`. Generic `shipping_weight` requires `weight_unit` of g/kg. |
| `observations` | Optional `price`, `availability`, evidence and effective-date metadata. |
| `specifications` | `property`, numeric `value`, `unit`: clock Hz/MHz; sram kB/KB; flash MB. |
| `documents` | `title`, HTTPS `url`; optional version/page information. |
| `inventory` | `warehouse_id`, whole nonnegative `quantity`. |
| `purchase_orders` | `purchase_order_id`, whole nonnegative `quantity`; optional supplier/line metadata. |
| `communications` | `subject`; optional excerpt/message metadata. |

Optional `record_id` identifies an individual record within a source. CSV columns use the same field names. The C++ parser supports quoted commas, escaped quotes, embedded newlines and CRLF; original fields remain strings until typed normalization. An example inventory header is `record_id,product_id,warehouse_id,quantity`. Templates contain placeholders rather than fictional Adafruit operations. Limits: 20,000 rows per source and 20 MB per HTTP request.

## Correlation scope

Product IDs establish record relationships. Pearson correlation separately measures shipping weight versus displayed price units in a selected cross-section. It requires at least 8 complete pairs with variation. Virtual products, zero/missing weights and invalid prices are excluded. Different capture sources and currency groups are never mixed; the largest eligible group is identified. The plot samples up to 200 records plus the actual range extremes, while the coefficient uses all eligible pairs.

Product mix, packaging and outliers can dominate the result. It establishes no causation, demand, profitability or fulfillment behavior. ISO currency remains unconfirmed when absent from source fields. No cross-retailer price spread or exchange rate is inferred.

## Files and API

- `data/workspace.json`: mutable saved source history; imports survive restart.
- `data/workspace.initial.json`: original public starter for recovery; never automatically restored over imports.
- `cpp/pipeline.cpp`, `cpp/pipeline.hpp`: core pipeline.
- `dist/index.html`, `dist/workspace.js`, `dist/workspace.css`: one-company interface.
- `PILOT_README.md`, `dist/pilot.html`: earlier two-company reference explorer, still available separately.

Read endpoints: `/api/workspace`, `/api/products?q=&manufacturer=&category=&page=0` (50 rows/page), `/api/product?id=6006`, `/api/patterns?manufacturer=&category=`, `/api/workspace/export`.

Write endpoints: `/api/import/preview` accepts `{source}`; `/api/import/csv-preview` accepts source metadata plus `csv`; `/api/import` accepts source plus integer `expected_revision` from preview; `/api/refresh-catalog` fetches the fixed public API. There is one local server process per workspace; it coordinates browser revisions. Multiple independent server processes must not write the same workspace file.

The latest catalog value per product is retained alongside its older source rows. Products absent from later captures keep their last-captured records; absence alone does not prove an availability change. `product_mpn` stays `retailer_mpn_raw`, since ADA-prefixed values are not assumed to be manufacturer part numbers. Images are not hotlinked.

Run `sh test.sh` for native tests of IDs, units, nulls, stock codes, CSV, duplicates, conflict retention, quarantine, atomic rejection, stale revisions, persistence and Pearson edge cases. Run `sh build.sh` to build explicitly. Stop/restart after C++ changes; refresh the browser after HTML/JS/CSS changes.

The source archive is packaged with public starter data, not mutable user imports. Bundled nlohmann JSON and cpp-httplib retain their licenses; system libcurl is linked rather than redistributed.
