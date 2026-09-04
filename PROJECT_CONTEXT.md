# PDF Diff Project Context

> Last audited: 2026-09-05 at commit `91e2451` (`refactor: rebuild frontend`).
>
> This is a context document, not a backlog. New contributors and Codex chats
> should verify the current checkout before applying any path-specific detail.

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
- A second copy of the diff helpers: `src/cli/diffUtils.ts`.
- HTML, text, JSON, and JUnit rendering: `src/cli/reportGenerator.ts`.
- PDF report generation launches Chromium through Playwright.
- `scripts/build-cli.mjs` bundles the CLI with esbuild while leaving runtime
  packages external.

### Deployment and project support

- The web application is built in Docker and served by Nginx.
- `.github/workflows/docker-build.yml` builds and pushes the Docker image after
  pushes to `main`.
- There is currently no automated core test suite or `test` script.
- The static CLI documentation is maintained separately in `public/cli.html`.

## Current processing flow

The browser path is currently:

```text
File
  -> File.arrayBuffer()
  -> PDF.js getDocument()
  -> getTextContent() for every page
  -> flatten each page to one text string
  -> store both complete text documents in React state
  -> compare pages with the same array index using diffWords()
  -> compute statistics inside React useMemo()
  -> render the selected page or every page
```

Export does not consume the already calculated result. It computes every page
diff again in `src/utils/exportUtils.ts`.

The CLI follows a parallel but separate path: it reads both complete files,
extracts all pages, pairs pages by array index, computes another copy of the
same text diff, then sends the result to its report generators.

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

## Confirmed architectural limitations

### 1. Page identity is incorrectly assumed to equal page index

Browser, CLI, and browser export compare `original.pages[i]` with
`modified.pages[i]`. Inserting or deleting one page can therefore cause every
following page to be reported as changed.

The current `PageDiff` type has one `pageNumber`; it cannot represent an
original page matched to a different modified page, a one-sided page, or an
ambiguous match.

### 2. Empty extracted text can be mistaken for equality

The page model contains only `{ pageNumber, text }`. Two scanned or image-only
pages can both produce an empty string and be reported as unchanged. The CLI
can then state that the PDFs are identical even though only their extractable
text was compared.

A comparison needs at least `equal`, `different`, and `indeterminate` outcomes,
plus extraction and analysis diagnostics.

### 3. Text reconstruction is a fragile heuristic

Both browser and CLI reconstruct text using fixed X/Y spacing thresholds. They
discard direction, page geometry, height, font identity, explicit end-of-line
information, and the relation between characters and page coordinates.

This is unreliable for multi-column layouts, RTL or vertical text, rotations,
superscripts, ligatures, line-end hyphenation, and PDFs whose content-stream
order differs from visual reading order.

### 4. The current model loses evidence needed by future features

Flattening a page to one string prevents reliable coordinate highlights,
layout comparison, moved-text detection, font comparison, OCR integration,
page citations, and layout-preserving translation.

The project does not need a complete PDF object model now. It does need a
small, page-scoped representation that preserves page geometry and compact
text runs with coordinates and provenance.

### 5. Work is synchronous and has no resource budget

`diffWords()` is called synchronously from React `useMemo()`. There is no job
identity, cancellation, timeout, maximum edit complexity, text-item budget, or
rendered-pixel budget.

"Review all pages" retains every page's original text, modified text, diff
parts, and statistics, then mounts all page details in the DOM. Export performs
the diff a second time.

### 6. PDF resource lifetime is uncontrolled

Browser and CLI extraction do not explicitly clean up pages or destroy opened
PDF documents. The existing `renderPageToCanvas()` helper re-reads and reopens
the complete PDF for every rendered page and must not become the basis of
visual diff or OCR.

### 7. Core behavior has multiple sources of truth

Browser and CLI maintain nearly identical diff and text-reconstruction code.
React also contains a separate statistics aggregation, and browser export runs
another comparison. Future normalization, page matching, OCR, and visual logic
would drift between these surfaces if this continues.

### 8. Comparison semantics and metrics are underspecified

The current primary operation is word diff. Whitespace/layout changes are not
part of that semantic result, while replacement statistics count both a
deletion and an addition. Multilingual token and percentage semantics are not
defined, but the CLI threshold already treats the percentage as a stable
machine decision.

Text-semantic, text-exact, visual, and structural results should remain
separate instead of being compressed into one ambiguous change percentage.

### 9. Test and fixture coverage is insufficient

There is no automated core test suite. The current modified demo generator also
duplicates a block of content on its second page, so the demos cannot be treated
as trustworthy correctness fixtures.

A future regression corpus needs to cover at least page insertion/removal,
blank and image-only pages, scanned pages, multi-column text, rotation, RTL and
CJK text, ligatures, line wrapping/hyphenation, damaged/encrypted PDFs, and very
different long pages.

### 10. CLI and public contract details have drifted

- `package.json` reports version `0.0.3`; the CLI hard-codes `1.0.4`.
- The repository URL in `package.json` contains a duplicated `https://`.
- Machine-readable CLI output is mixed with human-oriented output.
- Report/format/threshold options are not fully validated at runtime.
- PDF report failure can be printed but not propagated as a failed command.
- PDF-only mode can delete its temporary HTML even after PDF generation fails.
- The CLI may automatically download Chromium while processing a comparison.
- JSON output has no schema, engine, normalization, or metrics version.

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

- Replacing a selected file updates the displayed `File` before parsing. If
  parsing fails, the old parsed document can remain paired with the new name.
- A late result from an older selection can overwrite a newer selection because
  there is no job/request identity.
- Current-page state is not always clamped after replacing documents with a
  smaller document.
- Browser export is statically imported and contributes to the initial feature
  graph even when no export is requested.
- The Docker build uses `npm install`, and the repository has no `.dockerignore`.
- Nginx currently has no CSP or explicit cross-origin isolation headers.
- The manifest exists without a service worker, so the project is not an
  offline-reloadable PWA.

## Validation snapshot

At the audit snapshot:

- `npm run lint` passed;
- non-incremental TypeScript checks passed for browser, CLI, and Node configs;
- the Git working tree was clean;
- there was no automated core test suite, so static checks did not establish PDF
  comparison correctness.

