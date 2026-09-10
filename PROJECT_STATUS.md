# PDF Diff Project Status

> Last updated: 2026-09-10. Implementation baseline: `b6fab9f` plus the working tree.
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
| Visual view | The Visual tab renders the current page pair, offers the aligned and exact engines with marked-up and plain layouts, outlines changed areas, and reconciles the text verdict with the pixel verdict in words | Automated in Chromium | `c7e1896`, current working tree |
| Reflow-aware comparison | Renders are segmented into content bands, matched between versions, and compared where each band actually sits; bands are reported as equal, moved, changed, added, or removed | Automated, plus a Chromium check on the reflow fixture | `a0c77cf` |
| Fixture corpus | Deterministic reflow, image-only/scanned, Letter/A4, landscape, and truncated fixtures in `tests/fixtures/` | Automated | `a2d03df` |
| Per-side request lifecycle | Each document owns its own request identity, so choosing the second file no longer cancels the first | Automated in Chromium | `e718055` |
| Comparison worker | Band segmentation and pixel comparison run in one application worker; rasters and masks cross as transferable buffers, cancellation discards the worker, and an inline fallback covers runtimes without workers | Automated in Chromium, including a frame-count check that fails when the work runs inline | `b6fab9f` |
| Whole-document visual scan | Every page pair is swept sequentially at a reduced budget with progress and cancellation, giving each pair a visual verdict next to its text verdict; rows link to the full-resolution comparison | Automated in Chromium on the image-only fixture and the demo | Current working tree |

`src/cli/diffUtils.ts` re-exports the shared core; it is not a second diff
implementation. The browser text-only path currently opens a session, extracts
the document, and destroys it in `finally`. It intentionally does not retain an
open PDF after extraction until visual comparison has a real consumer.

## Regression coverage

`npm test` currently runs 49 cases across the core and browser regression files:

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
| Band segmentation, matching, and the moved/added/removed/edited classification | Automated |
| Reflow fixture: an inserted line stays one insertion for both the text and the visual layer | Automated for text; automated in Chromium for pixels |
| Image-only page: indeterminate for text, decided by the visual layer | Automated for text; automated in Chromium for pixels |
| Letter/A4, landscape, and truncated fixtures | Automated |
| Choosing both documents without waiting for the first | Automated in Chromium |
| The UI thread keeps painting during a comparison, and a cancelled job does not break later ones | Automated in Chromium |
| Whole-document scan verdicts, including an image-only document the text layer cannot read; scan state resets with new documents; a row selects its page | Automated in Chromium |
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
  complete result for all pages. Visual comparison does not: it runs in one
  application worker.
- `App.tsx` uses one active request identity/controller so replacement, demo,
  and reset operations cancel and invalidate stale extraction results.
- Visual comparison is browser-only. It is not part of `ComparisonResult`, not
  available in the CLI, and not included in any export. The whole-document scan
  produces verdicts but they are not persisted with the comparison result.
- Pixel comparison models vertical reflow only. A line whose content shifts
  sideways is reported as edited rather than moved, which is conservative but
  can overstate an edit. The exact engine remains available and makes no
  alignment assumptions at all.
- Band segmentation assumes horizontal bands of content. Multi-column layouts
  produce bands spanning both columns, so a change in one column is attributed
  to the whole row. Column detection is not implemented.
- Structural and OCR analysis do not exist yet. Textless pages are correctly
  reported as indeterminate by the text layer instead of being guessed equal,
  and the visual layer can now decide such pages.
- The production bundle still reports a chunk larger than 500 kB.

## Next work, in priority order

1. **Carry visual evidence into the exported report.** The scan produces
   per-page verdicts and the page view produces marked-up renders; neither
   reaches the PDF or HTML export, so a reviewer cannot hand the result to
   anyone. Rendering and PNG encoding also still run on the UI thread.
2. **Continue expanding the corpus.** Still missing: true `/Rotate` pages,
   multi-column text, CJK/RTL, ligatures, encrypted files, and large documents.
3. **Detect columns before banding.** Horizontal bands attribute a change in one
   column to the whole row, which is the main remaining source of noise on real
   layouts.
4. **Then add OCR through the same positioned-page model**, followed by local AI
   change explanation with citations. General document AI and
   layout-preserving translation remain later phases.

Do not add a plugin framework, worker pool, global state library, monorepo,
custom PDF parser, backend, or generic PDF toolbox while these smaller product
foundations remain unfinished.

## Latest verification

Verified on 2026-09-10 against the current working tree after `b6fab9f`:

```text
npm test                                                        passed (49 cases, including Chromium)
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
  engine and layout, and re-runs when the page changes;
- reflow-aware comparison on the reflow fixture reports one added line, one
  edited line and the rest as moved, with under a fifth of the exact
  comparison's changed pixels;
- choosing both documents in quick succession produces a comparison instead of
  stranding the first selection.

Measured in Chromium on the reflow fixture at ~151 DPI (1247×1763): the exact
comparison reports 49,253 changed pixels, the aligned comparison 6,110.

Comparison of one 1250×1767 page pair takes about 200 ms. Run inline it painted
0 animation frames in that time; run in the worker it painted 14, about 67 fps.
Page rendering and PNG encoding still happen on the UI thread.

The whole-document scan sweeps at ≈96 DPI and skips overlay and PNG work
entirely. On the image-only fixture, which has no text layer at all, it reports
the single page as changed; on the demo it reports both pages as changed with
per-page band counts.

Browser tests launch Chromium through `tests/helpers/browser.ts`, which honours
`PDF_DIFF_CHROMIUM_EXECUTABLE` for environments that ship a preinstalled
browser build.

Browser PDF export contents and layout were not manually rechecked in this
task, and the export still contains no visual evidence. The visual view was
checked manually in Chromium in light and dark themes. The Web build passed
with the existing large-chunk warning.
