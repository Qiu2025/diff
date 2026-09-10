# PDF Diff Project Status

> Last updated: 2026-09-10. Implementation baseline: `c7e1896`.
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
| PDF session | Browser PDF opens once per session; supports page/document extraction, page rendering, cancellation, and idempotent destruction | Automated in Chromium, including the sample comparison flow | `ee6bba6` |
| Browser request lifecycle | New file/demo requests cancel and invalidate older extraction; reset aborts active work and stale results cannot restore cleared state | Automated in Chromium for replacement and reset races | `932b8ff` |
| Session lifetime | Each side holds one open PDF for the life of a comparison; replacing a side, clearing, unmounting, or cancelling a load destroys the session it replaces | Automated in Chromium through `getOpenSessionCount()`; the check was confirmed to fail when the destroy call is removed | `d3c4a93` |
| Visual comparison core | `compareRasters()` reports a visual status, changed-pixel metrics, coarse change regions in normalized coordinates, and an optional removed/added/recoloured mask | Automated | `ce109f6` |
| Visual rasterization | Both sides of a page pair render at one shared scale inside a pixel budget (~150 DPI for Letter, hard-capped); canvases and the pixel mask are released before the result returns | Automated in Chromium | `6694619` |
| Visual view | The Visual tab renders the current page pair, shows an overlay and a side-by-side layout, outlines changed areas, and reconciles the text verdict with the pixel verdict in words | Automated in Chromium | `c7e1896` |

`src/cli/diffUtils.ts` re-exports the shared core; it is not a second diff
implementation. The browser text-only path currently opens a session, extracts
the document, and destroys it in `finally`. It intentionally does not retain an
open PDF after extraction until visual comparison has a real consumer.

## Regression coverage

`npm test` currently runs 29 cases across the core and browser regression files:

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
| `PdfSession` extraction/render/cancel/destroy behavior | Automated in Chromium |
| Pixel comparison: equality, added/removed/recoloured classification, thresholding, region merging, region budget, missing sides, size mismatch | Automated |
| Page rasterization: shared render budget, overlay production, object-URL release, cancellation | Automated in Chromium |
| Visual tab: overlay and side-by-side layouts, region outlines, per-page re-run, single-page restriction | Automated in Chromium |
| Open PDF session accounting across load, replace, clear, and cancel | Automated in Chromium |
| Sample-file browser comparison flow | Automated in Chromium |
| React upload/replacement/race behavior | Automated in Chromium for replacement and reset races |
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
- `App.tsx` uses one active request identity/controller so replacement, demo,
  and reset operations cancel and invalidate stale extraction results.
- Visual comparison exists for one page pair at a time in the browser only. It
  is not part of `ComparisonResult`, not available in the CLI, and not included
  in any export. Whole-document visual analysis is blocked on resource budgets.
- Pixel comparison has no reflow tolerance. Inserting a line shifts everything
  below it, so the changed-pixel percentage overstates the size of an edit near
  the top of a page. The change regions remain accurate about *where* the page
  differs; the percentage should not be read as an edit-size metric.
- Structural and OCR analysis do not exist yet. Textless pages are correctly
  reported as indeterminate by the text layer instead of being guessed equal,
  and the visual layer can now decide such pages.
- The production bundle still reports a chunk larger than 500 kB.

## Next work, in priority order

1. **Expand the regression corpus.** Prioritize image-only/scanned, rotation,
   multi-column, CJK/RTL, ligatures, damaged/encrypted, and large PDFs. The
   visual layer makes image-only fixtures newly meaningful: a scanned page that
   the text layer calls `indeterminate` should now get a real visual verdict.
2. **Give the visual layer reflow tolerance.** Align rendered content bands
   before comparing pixels so a one-line insertion does not mark the rest of the
   page as changed. This is the difference between a demo and a reviewable
   result on real documents.
3. **Add measured resource limits before all-page visual processing.** Introduce
   one application worker and explicit text/pixel budgets only when the visual
   path demonstrates the need. Whole-document visual review and visual evidence
   in exports both depend on this.
4. **Then add OCR through the same positioned-page model**, followed by local AI
   change explanation with citations. General document AI and
   layout-preserving translation remain later phases.

Do not add a plugin framework, worker pool, global state library, monorepo,
custom PDF parser, backend, or generic PDF toolbox while these smaller product
foundations remain unfinished.

## Latest verification

Verified on 2026-09-10 against the current working tree at `c7e1896`:

```text
npm test                                                        passed (29 cases, including Chromium)
npm run lint                                                    passed
./node_modules/.bin/tsc -p tsconfig.app.json --noEmit --incremental false   passed
./node_modules/.bin/tsc -p tsconfig.cli.json --noEmit --incremental false   passed
./node_modules/.bin/tsc -p tsconfig.node.json --noEmit --incremental false  passed
npm run build                                                   passed
npm run build:cli                                               passed
git diff --check -- . ':(exclude)public/demo-original.pdf' ':(exclude)public/demo-modified.pdf'   passed
```

Automated Chromium coverage now verifies:

- one `PdfSession` extracts and renders the demo, returns `AbortError` for an
  aborted extraction, rejects access after destruction, and allows repeated
  destruction;
- the sample-file UI produces a two-page comparison without browser errors;
- a slow replaced selection cannot overwrite a newer result, and clearing the
  UI during extraction prevents stale state from returning;
- the application holds exactly one open PDF per side, and none after clearing
  or after a cancelled load;
- rendered page pairs stay inside their pixel budget, produce an overlay,
  release their object URLs, and abort on demand;
- the Visual tab renders the current pair, outlines changed areas, switches
  layouts, and re-runs when the page changes.

Browser tests launch Chromium through `tests/helpers/browser.ts`, which honours
`PDF_DIFF_CHROMIUM_EXECUTABLE` for environments that ship a preinstalled
browser build.

Browser PDF export contents and layout were not manually rechecked in this
task, and the export still contains no visual evidence. The visual view was
checked manually in Chromium in light and dark themes. The Web build passed
with the existing large-chunk warning.
