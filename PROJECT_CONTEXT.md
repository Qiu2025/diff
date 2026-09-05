# PDF Diff Project Context

> Last audited: 2026-09-05 through commit `ee6bba6` (`feat: add reusable PDF sessions`).
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

The browser build is served as static files. The current source contains no
document upload API. Its automatic fetches are the two same-origin demo PDFs,
and the PDF.js worker is bundled locally.

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
- `npm test` runs the core regression cases in `tests/pdf-diff.test.ts`.
- The static CLI documentation is maintained separately in `public/cli.html`.

## Current processing flow

The browser path is currently:

```text
File
  -> openPdfSession() / PDF.js getDocument()
  -> extract geometry and positioned text runs page by page
  -> destroy the text-only session in finally
  -> align pages, then related lines
  -> compareDocuments()
  -> one versioned ComparisonResult
  -> React UI and report/export renderers
```

The browser session also exposes cancellable page extraction and Canvas
rendering for future visual analysis. The current text-only UI does not retain
an open PDF after extraction. Browser export consumes the existing comparison
result instead of recomputing it.

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

Visual fingerprints are needed before image-only page matching can be treated
as reliable.

### 3. Work is synchronous and has no resource budget

`compareDocuments()` is called synchronously from React `useMemo()`. The
comparison phase has no cancellation, timeout, maximum edit complexity,
text-item budget, or rendered-pixel budget.

"Review all pages" retains every page's original text, modified text, diff
parts, and statistics, then mounts all page details in the DOM.

### 4. Browser cancellation stops extraction, not synchronous comparison

`PdfSession` opens a browser PDF once, validates page access, supports
`AbortSignal`, cleans up pages, and destroys the document. `App.tsx` keeps one
active request identity and aborts older extraction when a file is replaced,
the demo is restarted, or the comparison resets. CLI extraction also cleans up
pages and documents. Cancellation does not interrupt the synchronous
`compareDocuments()` call once extraction is complete.

### 5. Comparison semantics and metrics remain intentionally narrow

The result has a schema version, text-engine version, page pairs, per-page
statistics, diagnostics, and explicit `equal`, `different`, and `indeterminate`
states. The current primary operation remains word diff. Whitespace/layout
changes are not part of that semantic result, replacement statistics count
both a deletion and an addition, and multilingual percentage semantics are not
defined.

Text-semantic, text-exact, visual, and structural results should remain
separate instead of being compressed into one ambiguous change percentage.

### 6. Test and fixture coverage is still narrow

The regression suite covers the deterministic demo, core text behavior, line
and page alignment, the page model, explicit comparison states, HTML escaping,
JSON/JUnit result contracts, `PdfSession`, the sample browser flow, and stale
replacement/reset races in Chromium.

The corpus still needs scanned/image-only pages, multi-column text, rotation,
RTL and CJK text, ligatures, line wrapping/hyphenation, damaged/encrypted PDFs,
and very different long pages.

### 7. CLI and public contract details have drifted

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

OCR -> produces the same positioned text-run contract
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

- Browser export is statically imported and contributes to the initial feature
  graph even when no export is requested.
- The Docker build uses `npm install`, and the repository has no `.dockerignore`.
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
