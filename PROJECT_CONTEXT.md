# PDF Diff Project Context

> Last audited: 2026-09-10 through commit `b47e28c` (`feat(export): carry visual verdicts and evidence into the report`).
>
> This is a context document, not a backlog. New contributors and Codex chats
> should verify the current checkout before applying any path-specific detail.
> Current implementation progress, test coverage, and prioritized next work are
> maintained in [`PROJECT_STATUS.md`](./PROJECT_STATUS.md); update it with every
> completed task.

## Product direction

PDF Diff should become a privacy-first PDF processor and local document
analysis platform. Its differentiation is depth, not the number of PDF tools:

- high-quality, evidence-backed comparison of two PDF versions;
- local processing, with document data staying on the user's device by default;
- visual and structural change detection in addition to text diff;
- OCR for scanned documents;
- local AI for change explanation, document Q&A, summaries, translation, and
  analysis;
- browser-side execution through technologies such as WebGPU and WASM where
  practical;
- eventual layout-preserving PDF translation.

This is deliberately not a Stirling PDF-style collection of merge, split,
rotate, and other generic PDF utilities. New features should improve document
understanding, comparison, evidence, or local intelligence.

## Product and privacy principles

1. Document bytes and derived content should not leave the device unless the
   user explicitly chooses an external provider or export destination.
2. Model or application assets may need to be downloaded. Model download and
   document upload are different actions and must be communicated separately.
3. There must be no silent cloud fallback, content telemetry, or hidden upload.
4. Deterministic evidence remains the source of truth. AI may explain a change,
   but it must not replace the underlying page, text, geometry, or visual result.
5. Local persistence should be explicit. Exported reports, cached models, and
   any future document/index cache need separate retention and deletion rules.
6. Privacy claims should be precise and verifiable. Prefer "document content is
   processed locally and is not uploaded by the application" over absolute
   claims such as "zero risk".

## Current repository shape

The project is a small, single-package TypeScript application with two user
surfaces.

### Browser application

- React 19 and Vite 7.
- PDF parsing and rendering through `pdfjs-dist`.
- Text comparison through `diff`/jsdiff.
- Browser PDF report generation through `jsPDF`.
- Main orchestration and state live in `src/App.tsx`.
- Presentational controls live in `src/components/`.
- Browser PDF, diff, and export helpers live in `src/utils/`.
- Raster primitives live in `src/utils/raster.ts`, exact pixel comparison in
  `src/utils/visualDiff.ts`, reflow-aware comparison in
  `src/utils/visualBands.ts`, and the browser rasterization adapter in
  `src/utils/visualPageRenderer.ts`.
- Ordered sequence alignment is shared by the text and visual layers in
  `src/utils/sequenceAlignment.ts`.
- Optional OCR lives in `src/utils/ocr.ts` (engine) and
  `src/utils/ocrDocument.ts` (which pages to read, and how results rejoin the
  comparison). Its assets are prepared by `scripts/prepare-ocr-assets.mjs`.

The browser build is served as static files. The current source contains no
document upload API. Its automatic fetches are the two same-origin demo PDFs,
and the PDF.js worker is bundled locally. The OCR engine and language data are
also same-origin, prepared into `public/ocr/` by `npm run prepare-ocr`; the
application never falls back to the CDN Tesseract.js would use by default.

### CLI

- Entry point: `src/cli/index.ts`.
- Node PDF.js adapter: `src/cli/pdfUtils.ts`.
- `src/cli/diffUtils.ts` re-exports the shared runtime-neutral diff core.
- HTML, text, JSON, and JUnit rendering: `src/cli/reportGenerator.ts`.
- PDF report generation launches Chromium through Playwright.
- `scripts/build-cli.mjs` bundles the CLI with esbuild while leaving runtime
  packages external.

### Deployment and project support

- The web application is built in Docker and served by Nginx.
- `.github/workflows/docker-build.yml` builds and pushes the Docker image after
  pushes to `main`.
- `npm test` runs the core and Chromium regression cases in `tests/`. Browser
  tests launch Chromium through `tests/helpers/browser.ts`, which honours
  `PDF_DIFF_CHROMIUM_EXECUTABLE`.
- `npm run generate-fixtures` regenerates the committed corpus in
  `tests/fixtures/`.
- The static CLI documentation is maintained separately in `public/cli.html`.

## Current processing flow

The browser path is currently:

```text
File
  -> openPdfSession() / PDF.js getDocument()
  -> extract geometry and positioned text runs page by page
  -> keep the session open for on-demand page rendering
  -> align pages, then related lines
  -> compareDocuments()
  -> one versioned ComparisonResult
  -> React UI and report/export renderers
```

The browser session also exposes cancellable page extraction, page geometry,
and Canvas rendering. Each side of a comparison now keeps its session open for
the life of that comparison so pages can be rendered on demand; the session is
destroyed when the side is replaced, the comparison is cleared, a load is
cancelled, or the application unmounts. Browser export consumes the existing
comparison result instead of recomputing it.

Visual comparison runs as a separate, on-demand path:

```text
PdfSession (both sides)
  -> getPageSize() to plan one shared render scale within a pixel budget
  -> render both pages into one raster size
  -> the comparison worker
     compareAlignedRasters()   band segmentation, matching, per-band comparison
     or compareRasters()       exact, position by position
  -> status, changed pixels, bands, regions, per-pixel masks
  -> overlay canvas per side -> object URLs -> React
  -> canvases, image data, and masks released before the result is returned
```

The visual result is deliberately not merged into `ComparisonResult`. Text and
pixels are separate evidence with separate statuses; the UI reconciles them in
words rather than averaging them into one number.

The CLI uses a Node-specific PDF.js adapter but produces the same page model and
calls the shared alignment/comparison core. Text, HTML, JSON, JUnit, and PDF
reports consume the resulting `ComparisonResult`.

PDF.js has its own worker in the browser, but text reconstruction, jsdiff,
statistics, result assembly, and React rendering still run on the caller/UI
thread.

## Foundations that should be preserved

- The static browser-only deployment is aligned with the local-first goal.
- PDF.js is a suitable parsing and rendering foundation; replacing it is not a
  prerequisite for the planned direction.
- Browser and CLI support are valuable and can share a runtime-neutral core.
- The current React components are small and mostly presentational. A new state
  framework is not required.
- TypeScript strictness and linting are already enabled.
- CLI HTML output escapes filenames and extracted document text.
- The repository is still small enough to establish better boundaries without
  a large rewrite.

## Remaining architectural limitations

### 1. Text reconstruction and reading order are still heuristic

The shared page model now preserves geometry, rotation, positioned text runs,
direction, font identity, ranges, and explicit end-of-line information. The
flattened reading order still relies on fixed X/Y spacing thresholds.

This is unreliable for multi-column layouts, RTL or vertical text, rotations,
superscripts, ligatures, line-end hyphenation, and PDFs whose content-stream
order differs from visual reading order.

### 2. Page matching has no visual evidence yet

`PagePair` keeps original and modified page identities separate, and ordered
text fingerprints handle inserted and removed text pages. Pages with no
extractable text can be paired by position but have no similarity score; highly
dissimilar text pages can also be represented as one-sided pairs.

Pixel comparison now exists, but it runs *after* alignment on a pair the text
layer chose. Visual fingerprints are still needed before image-only page
matching can be treated as reliable.

### 3. Pixel comparison models vertical reflow only

The aligned engine segments each render into horizontal bands of content,
matches them between versions, and compares each matched band where it sits, so
an inserted line no longer marks the rest of the page as changed. Two limits
remain:

- horizontal displacement is not modelled, so a line whose content shifts
  sideways is reported as edited rather than moved;
- bands span the full page width, so a multi-column layout attributes a change
  in one column to the whole row. Column detection is not implemented.

The exact engine stays available and makes no alignment assumptions; its
changed-pixel percentage is not an edit-size metric and must not be presented
as one.

### 4. Work is synchronous and has no resource budget

`compareDocuments()` is called synchronously from React `useMemo()`. The text
comparison phase has no cancellation, timeout, maximum edit complexity, or
text-item budget.

Visual comparison is the exception: it runs in one application worker for one
page pair at a time, is cancellable, and has an explicit rendered-pixel budget.
Page rendering and PNG encoding still happen on the UI thread.

A whole-document sweep runs the same engine over every page pair, one at a time,
at a lower render budget and with images turned off. It answers "which pages
changed" — the question the text layer cannot answer for a scanned document.

When a sweep has been run, the browser PDF export carries its verdicts and, for
a capped number of changed pages, landscape sheets of the marked-up renders.
Evidence images are encoded as lossy data URLs: a report has to carry its bytes,
and a reviewer needs to see which line changed, not to re-read the document from
the report.

"Review all pages" retains every page's original text, modified text, diff
parts, and statistics, then mounts all page details in the DOM.

### 5. Browser cancellation stops extraction, not synchronous comparison

`PdfSession` opens a browser PDF once, validates page access, supports
`AbortSignal`, cleans up pages, and destroys the document. `App.tsx` keeps one
active request identity *per side* and aborts older extraction when that side's
file is replaced, the demo is restarted, or the comparison resets. Per-side
identity matters: a single shared identity meant choosing the second document
cancelled the first, leaving no comparison and no error. CLI extraction also cleans up
pages and documents. Sessions are now kept open for the life of a comparison
and destroyed on replacement, reset, cancellation, and unmount; an open-session
counter makes that lifecycle testable. Cancellation does not interrupt the
synchronous `compareDocuments()` call once extraction is complete. Visual
comparison, which is asynchronous, does honour cancellation end to end.

### 6. Comparison semantics and metrics remain intentionally narrow

The result has a schema version, text-engine version, page pairs, per-page
statistics, diagnostics, and explicit `equal`, `different`, and `indeterminate`
states. The current primary operation remains word diff. Whitespace/layout
changes are not part of that semantic result, replacement statistics count
both a deletion and an addition, and multilingual percentage semantics are not
defined.

Text-semantic, text-exact, visual, and structural results should remain
separate instead of being compressed into one ambiguous change percentage. The
visual layer follows this rule today: it has its own status, its own metrics,
and its own diagnostics, and it is not folded into the text result.

### 7. Test and fixture coverage is still narrow

The regression suite covers the deterministic demo, core text behavior, line
and page alignment, the page model, explicit comparison states, HTML escaping,
JSON/JUnit result contracts, `PdfSession`, the sample browser flow, stale
replacement/reset races, PDF session lifetime, exact and reflow-aware pixel
comparison, page rasterization, and the Visual view in Chromium.

`tests/fixtures/` adds a deterministic corpus generated by
`npm run generate-fixtures`: a pure reflow pair, an image-only "scanned" pair,
Letter and A4 versions of one page, a landscape page, and a truncated file.

The corpus still needs true `/Rotate` pages, multi-column text, RTL and CJK
text, ligatures, line wrapping/hyphenation, encrypted PDFs, and very long
documents.

### 8. CLI and public contract details have drifted

- `package.json` reports version `0.0.3`; the CLI hard-codes `1.0.4`.
- The repository URL in `package.json` contains a duplicated `https://`.
- Machine-readable CLI output is mixed with human-oriented output.
- Report/format/threshold options are not fully validated at runtime.
- PDF report failure can be printed but not propagated as a failed command.
- PDF-only mode can delete its temporary HTML even after PDF generation fails.
- The CLI may automatically download Chromium while processing a comparison.
- Machine-readable output has a schema and engine version, but normalization
  and metrics versions are not explicit.

These are not reasons to redesign the CLI, but they matter for trust and for a
stable automation contract.

## Minimal target architecture

```text
React UI                         Node CLI
   |                                |
Browser source adapter          Node source adapter
   +---------------+----------------+
                   |
                PdfSession
       open once / page API / dispose
                   |
       page-scoped document artifacts
     geometry / text runs / diagnostics
                   |
             page alignment
                   |
       deterministic analyzers
       text / visual / structure
                   |
            ComparisonResult
 page pairs / changes / anchors / warnings
                   |
 UI / HTML / PDF / JSON / JUnit renderers

OCR -> produces the same positioned text-run contract (implemented)
AI  -> consumes document artifacts and cites deterministic evidence
Translation -> separate layout reconstruction and PDF writing pipeline
```

### Runtime-neutral core

Only code that is independent of React, the DOM, Canvas, and Node `fs` should
be shared. This includes:

- domain types;
- text-item normalization;
- page fingerprints and alignment;
- text diff and metrics;
- compact, versioned comparison results.

Browser `File`/Canvas handling and Node path/`fs` handling should remain small
adapters. A monorepo or separately published core package is not currently
necessary.

### Page-scoped document representation

A minimal page artifact should be able to describe:

- page index, size, and rotation;
- extraction status and warnings;
- normalized text;
- compact text runs with bbox, direction, font reference, and original range;
- provenance such as `native` or `ocr`, with confidence where applicable.

The representation should be consumable page by page. Full-resolution rasters,
Canvas objects, and complete PDF operator lists should not be retained in the
long-lived result.

### Explicit page matching

Page comparison should use a type that keeps original and modified page
identities separate. Text fingerprints and sequence alignment are a reasonable
first implementation. Visual fingerprints can later support pages with little
or no text.

### One comparison result

UI and every report format should consume the same immutable result rather
than rerunning the engine. The result should record:

- schema and engine version;
- analysis scope and normalization mode;
- page pairs and match confidence/status;
- per-layer status and changes;
- coordinate anchors for relevant changes;
- metrics;
- incomplete, failed, or budget-limited diagnostics.

### Controlled processing job

The browser needs one cancellable comparison job with progress and resource
budgets. One application worker is enough initially; a worker pool and generic
task framework are not justified.

Each document should be opened once per job through a controlled session and
disposed reliably. Rendering and OCR should be page-based with bounded
concurrency and immediate release of large image buffers.

## Long-term dependency order

The technical dependencies suggest the following direction:

Pixel comparison of one page pair, with and without reflow tolerance, is
implemented. Whole-document visual review, visual page fingerprints for
alignment, column-aware banding, and visual evidence in exports are not.

OCR is implemented for English, on demand, and feeds the same page model, so
alignment, comparison, statistics and export work on a scanned document without
knowing where the words came from.

```text
reliable text extraction and page alignment
  -> visual and lightweight structural diff
  -> OCR fallback using the same page model
  -> local AI change intelligence and document analysis
  -> layout-preserving translation and PDF reconstruction
```

Visual work should precede OCR because OCR also needs stable page rendering,
page alignment, coordinate transforms, and pixel budgets. OCR should feed the
same positioned-text contract rather than create a second document model.

The first local AI capability should ideally reinforce the core product: explain
and summarize important changes with page citations. General PDF Q&A and
summaries can follow. Model runtime selection, WebGPU/WASM fallback, model
caching, and capability detection should be based on a real runtime prototype,
not designed speculatively.

Layout-preserving translation is a separate read/layout/write problem. It
depends on reading order, positioned text, OCR, font shaping and embedding,
overflow/reflow policy, and a real PDF writing path. The current jsPDF report
generator is not that writing path.

## Boundaries against premature architecture

Do not introduce these without a demonstrated need:

- a generic plugin platform, analyzer registry, dependency-injection container,
  or task graph;
- a worker pool;
- Redux or another global state framework;
- a monorepo or multiple published packages;
- a custom PDF parser or a Rust/WASM rewrite of the current core;
- a complete PDF AST or long-term storage of all page bitmaps;
- a vector database or general RAG platform;
- a universal abstraction over every browser AI runtime;
- persistent document storage in IndexedDB/OPFS;
- a backend, account system, cloud sync, or desktop shell;
- COOP/COEP headers before a selected WASM runtime actually requires them;
- generic merge, split, rotate, or similar PDF toolbox features.

Cross-origin isolation, service-worker/PWA support, model storage, subpath
self-hosting, and package separation remain valid future concerns, but they are
cheap to decide when a concrete runtime or deployment requirement exists.

## Known small correctness and maintenance issues

- Browser export and the evidence renderer are dynamic imports, so jsPDF stays
  out of the initial feature graph.
- The Docker build uses `npm ci` and the repository has a `.dockerignore`. OCR
  assets are prepared inside the image, and can be skipped with
  `--build-arg ENABLE_OCR=false`.
- Nginx currently has no CSP or explicit cross-origin isolation headers.
- The manifest exists without a service worker, so the project is not an
  offline-reloadable PWA.

## Validation snapshot

At the current audit snapshot:

- `npm test` passed 12 core and Chromium regression cases;
- `npm run lint` passed;
- non-incremental TypeScript checks passed for browser, CLI, and Node configs;
- Web and CLI builds passed; the Web build retained its existing large-chunk
  warning;
- the source diff check passed;
- the automated Chromium session, sample-flow, and request-race checks passed.
