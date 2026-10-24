# OneType ontology explorer

A runnable HTML/CSS interface and C++17 backend for inspecting connected company data. It uses the real Adafruit/SparkFun pilot captured on **2026-10-23**, with selected factual transcriptions and source links. It runs locally and requires no API key or JavaScript package installation.

## Run it

On macOS, open Terminal in this folder and run:

```sh
sh run.sh
```

The first launch compiles the C++ backend. Open **http://127.0.0.1:4180** in a browser, keep Terminal open, and press **Control+C** to stop. Alternatively, double-click `start.command` in Finder. If the port is busy, use `sh run.sh --port 4181` and visit that port.

A C++17 compiler is required. If `c++ --version` fails on macOS, install Apple's command line tools with `xcode-select --install` and retry. Vendored libraries are already included. The shell scripts target macOS/Linux; Windows requires WSL or adaptation.

## Try this walkthrough

1. The explorer opens **Pico 2**. Its canonical ID is `V_PICO2`.
2. Under **Retailer listings**, inspect Adafruit `6006` and SparkFun `DEV-26124`. Each listing owns its own dated price and availability; both connect to the same design identity.
3. Choose **Claims**. Adafruit's original claims include both **512KB** and **520KB**. The model retains both and selects **520 kB** with manufacturer evidence.
4. Choose **Evidence**. Expand `R05` to see the selected original Adafruit fields and evidence location. Follow the source link to the original page. `S09` links to the manufacturer PDF.
5. Open **Connections**. Select nodes to inspect them. Turn on **Include proposed matches** to see the unconfirmed Teensy configuration links.
6. Use **Data quality** in the type filter to inspect uncertainties. A blank/unknown revision stays `null`.
7. Open **How it works** for the data flow and the real C++ API response.

## The files to read

| File | Responsibility |
| --- | --- |
| `dist/index.html` | The page structure: navigation, search, record inspector, graph and walkthrough. |
| `dist/styles.css` | Responsive presentation and keyboard focus styles. System fonts work offline; optional web fonts improve appearance when available. |
| `dist/app.js` | Sends requests to C++ and renders the returned JSON. It does not compute shared-design matches or resolve specifications. |
| `cpp/server.cpp` | Loads records, validates ID references, searches fields, joins connected records and serves HTTP responses. |
| `data/raw_records.json` | Ten official source references and selected original factual fields. These are not archived full HTML/PDF responses. |
| `data/clean_model.json` | Companies, product variants, listings, observations, claims, resolved specifications and quality issues. |
| `data/relationships.json` | Twenty typed connections with evidence and match-review metadata. |

The data files are copies of the reviewed pilot. The original pilot and older inventory-planning prototype remain separate.

## Follow a request through the code

The browser calls:

```js
const detail = await api('/api/entity?id=V_PICO2');
```

The route in C++ calls:

```cpp
model.inspect("V_PICO2");
```

`inspect()` retrieves the design, finds listings whose `variant_id` matches it, follows evidence references and returns related claims, resolutions, issues and sources. JavaScript's `renderDetail()` displays that response. It uses escaped text to display source values.

At startup, the `Ontology` constructor reads the three data files, indexes each record by ID and rejects broken references. `summary()` performs a separate query: group listings by variant, retain accepted mappings, and count distinct retailers. The dataset yields two shared design matches and one candidate Teensy model correspondence. These are selected-sample results, not catalog-wide statistics.

## API you can try

These read-only JSON endpoints can also be consumed by another application or a future AI agent. No AI integration is included.

| Endpoint | Response |
| --- | --- |
| `/api/health` | Backend status. |
| `/api/summary` | Counts, capture date and computed shared/candidate design results. |
| `/api/entities?type=product_variants&q=pico` | Case-insensitive search over a record type. Use `type=all` to search every record type. |
| `/api/entity?id=V_PICO2` | The record, connected listings, observations, claims, issues and original evidence. |
| `/api/entity?id=Q_SRAM` | The source disagreement and affected records. |
| `/api/graph?proposed=0` | Connected nodes and edges with proposed mapping links excluded. |
| `/api/graph?proposed=1` | All twenty recorded relationships. |

An unknown record ID returns HTTP 404. The process listens on the local computer's loopback interface. It is a local demonstration, without user accounts, enterprise permissions or deployment configuration.

## What is implemented

The code runs real searches and joins on the supplied model, displays evidence and unknowns, distinguishes proposed mappings, and visualizes the relationships. Captured facts do not update when a remote web page changes.

Source collection, identity mapping and specification resolution were prepared manually for this pilot. The C++ code loads those decisions; it does not discover that two arbitrary uploaded records match or automatically decide which source is correct. New records require editing the JSON consistently and restarting the server. Startup reference checks protect connectivity; they do not prove source accuracy or validate every business rule.

Live databases, PDF parsing, emails, sensor streams, CSV/form imports, continuous refresh and AI-agent execution are future work. Private company operating data is not present. Adafruit ISO currency remains unconfirmed in this capture, so no cross-retailer price spread is calculated. Team confirmation is pending; agent review is not human approval.

## Edit and restart

HTML, CSS and JavaScript changes appear after a browser refresh. For C++ or JSON changes, stop the server with Control+C and run `sh run.sh` again. The script rebuilds changed C++ automatically. Data files are read on startup and held in memory for consistent read-only queries.

`third_party/` includes nlohmann JSON and cpp-httplib with their MIT licenses and dependency provenance. An internet connection is not needed to compile or run the demo.
