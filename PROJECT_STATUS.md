# PDF Diff Project Status

> Last updated: 2026-09-05. Implementation baseline: `ee6bba6`.
>
> This is the live implementation and verification ledger. Read
> [`PROJECT_CONTEXT.md`](./PROJECT_CONTEXT.md) for the product direction and
> target architecture. When the two documents disagree about current code,
> verify the checkout and update this file.

## Maintenance rule

Every chat or contributor that changes behavior, architecture, fixtures, or
test coverage must update this document as part of the same task:

1. Update the capability and coverage tables below.
2. Move or rewrite the affected next-work item; do not only append new text.
3. Record the commands actually run under **Latest verification**.
4. Label browser/manual checks honestly. Do not call them automated tests.
5. Never claim the project is bug-free. State what was tested and what remains
   unverified.

Keep this file current and concise. Durable product decisions belong in
`PROJECT_CONTEXT.md`; detailed implementation history belongs in Git.

## Implemented foundations

| Area | Current implementation | Regression evidence | Reference |
| --- | --- | --- | --- |
| Baseline fixtures | Deterministic two-page demo PDFs and a Node test entry point | Automated | `d23f6fe` |
| Text diff | Same/add/delete/replace statistics; shared blank lines and boundary spaces are preserved | Automated | `d23f6fe`, `cfe242f` |
| Line alignment | Related and renumbered lines share rows in the side-by-side view | Automated | `cfe242f` |
| Page alignment | Text fingerprints and ordered alignment preserve later page pairing after insertions/removals | Automated | `5ed9544` |
| PDF page model | Page geometry, rotation, positioned text runs, source ranges, line endings, and extraction status | Automated | `7cbf2b4` |
| Comparison result | One versioned result with `equal`, `different`, and `indeterminate`; Web, CLI, JSON, JUnit, HTML, and browser PDF export consume it | Automated for core/HTML/JSON/JUnit; browser PDF export is not automated | `50571a8` |
| PDF session | Browser PDF opens once per session; supports page/document extraction, page rendering, cancellation, and idempotent destruction | Chromium verification only; automated browser regression is still missing | `ee6bba6` |

`src/cli/diffUtils.ts` re-exports the shared core; it is not a second diff
implementation. The browser text-only path currently opens a session, extracts
the document, and destroys it in `finally`. It intentionally does not retain an
open PDF after extraction until visual comparison has a real consumer.

## Regression coverage

`npm test` currently runs 11 cases in `tests/pdf-diff.test.ts`:

| Behavior | Coverage |
| --- | --- |
| Demo PDF page count and expected extracted content | Automated |
| Page geometry, positioned runs, ranges, and extraction status | Automated |
| Basic text diff and statistics | Automated |
| Inserted/renumbered line alignment | Automated |
| Blank-line and word-boundary regression | Automated |
| Inserted/removed page alignment | Automated |
| Textless pages become `indeterminate`, not equal | Automated |
| Versioned equal/different comparison results | Automated |
| CLI page-range parsing | Automated |
| HTML escaping plus JSON result contract | Automated |
| Indeterminate HTML/JSON/JUnit reporting | Automated |
| `PdfSession` extraction/render/cancel/destroy behavior | Manual Chromium check only |
| React upload/replacement/race behavior | Not automated |
| Browser PDF export file contents/layout | Not automated |
| CLI process exit codes and full report generation | Manually smoke-tested, not automated |
| Large, scanned, multilingual, rotated, damaged, or encrypted PDFs | Not covered by the regression corpus |

Automated coverage reduces known regressions; it does not prove the absence of
bugs, especially for arbitrary PDF producers and layouts.

## Current technical constraints

- Text extraction still uses heuristic reading-order reconstruction. Geometry
  is retained, but multi-column, RTL/vertical text, ligatures, and hyphenation
  need dedicated fixtures and normalization work.
- Page and line alignment use quadratic dynamic programming without a large
  document budget.
- Text comparison still runs synchronously from React and materializes the
  complete result for all pages.
- `AbortSignal` is available in `PdfSession`, but `App.tsx` does not yet use a
  request identity/controller to prevent stale file-processing results.
- Visual, structural, and OCR analysis do not exist yet. Textless pages are
  correctly reported as indeterminate instead of being guessed equal.
- The production bundle still reports a chunk larger than 500 kB.

## Next work, in priority order

1. **Automate the browser PDF session regression.** Cover open-once extraction,
   rendering, cancellation, destruction, and the sample comparison flow in a
   repeatable browser test.
2. **Add request identity and cancellation to `App.tsx`.** A replaced file or
   reset must not be overwritten by an older asynchronous extraction result.
3. **Implement a current-page visual diff vertical slice.** Keep visual status
   separate from text status; use fixed render limits and release canvases/image
   data immediately.
4. **Add measured resource limits before all-page visual processing.** Introduce
   one application worker and explicit text/pixel budgets only when the visual
   path demonstrates the need.
5. **Expand the regression corpus.** Prioritize image-only/scanned, rotation,
   multi-column, CJK/RTL, ligatures, damaged/encrypted, and large PDFs.
6. **Then add OCR through the same positioned-page model**, followed by local AI
   change explanation with citations. General document AI and
   layout-preserving translation remain later phases.

Do not add a plugin framework, worker pool, global state library, monorepo,
custom PDF parser, backend, or generic PDF toolbox while these smaller product
foundations remain unfinished.

## Latest verification

Verified on 2026-09-05 against the implementation through `ee6bba6`:

```text
npm test                                                        passed
npm run lint                                                    passed
./node_modules/.bin/tsc -p tsconfig.app.json --noEmit --incremental false   passed
./node_modules/.bin/tsc -p tsconfig.cli.json --noEmit --incremental false   passed
./node_modules/.bin/tsc -p tsconfig.node.json --noEmit --incremental false  passed
npm run build                                                   passed
npm run build:cli                                               passed
```

Additional Chromium checks performed manually:

- `PdfSession` extracted page 1 from the demo, rendered it to a 297 x 420
  canvas, rejected access after destruction, and returned `AbortError` for an
  aborted extraction.
- The sample-file UI produced a two-page comparison and logged no browser
  console errors.

The Web build passed with the existing large-chunk warning.
