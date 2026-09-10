/**
 * Marked-up page renders prepared for an exported report.
 *
 * On screen, page images live behind object URLs the viewer releases. A report
 * has to carry its bytes, so evidence is encoded as data URLs instead, in a
 * lossy format and at a lower resolution: a reviewer needs to see which line
 * changed, not to re-read the document from the report.
 */

import { compareRenderedPages } from './visualPageRenderer.ts';
import type { PageRenderSource } from './visualPageRenderer.ts';
import { describeAlignedStatus } from './visualBands.ts';
import type { ScanPagePair, VisualScanResult } from './visualScan.ts';
import type { PdfSession } from './pdfUtils';

export interface VisualEvidencePage {
  comparisonNumber: number;
  label: string;
  summary: string;
  /** Original page with removals marked, as a data URL. */
  original: string | null;
  /** Modified page with additions and edits marked, as a data URL. */
  modified: string | null;
}

export interface VisualEvidence {
  /** Points-to-pixels factor the evidence was rendered at. */
  scale: number;
  pages: VisualEvidencePage[];
  /** Differing pages left out because of the page cap. */
  omitted: number;
}

export interface VisualEvidenceOptions {
  original: PdfSession | null;
  modified: PdfSession | null;
  pairs: readonly ScanPagePair[];
  scan: VisualScanResult;
  /** Most pages to illustrate. A long document must not produce a huge report. */
  maxPages?: number;
  maxPixels?: number;
  quality?: number;
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
}

/** Roughly 110 DPI for Letter: readable in a report without inflating it. */
const EVIDENCE_MAX_PIXELS = 1_200_000;
const EVIDENCE_MAX_PAGES = 6;
const EVIDENCE_QUALITY = 0.72;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('Evidence rendering was aborted.', 'AbortError');
  }
}

/**
 * Renders marked-up pages for the pairs a scan found to differ.
 *
 * Pages the scan already settled as identical are skipped: re-rendering them
 * would cost the most and show the least.
 */
export async function buildVisualEvidence(
  options: VisualEvidenceOptions
): Promise<VisualEvidence> {
  const { original, modified, pairs, scan, signal, onProgress } = options;
  const maxPages = options.maxPages ?? EVIDENCE_MAX_PAGES;
  const differing = scan.pages.filter(page => page.status === 'different');
  const selected = differing.slice(0, maxPages);
  const byNumber = new Map(pairs.map(pair => [pair.comparisonNumber, pair]));
  const pages: VisualEvidencePage[] = [];
  let scale = 0;

  for (const summary of selected) {
    throwIfAborted(signal);
    const pair = byNumber.get(summary.comparisonNumber);
    if (!pair) continue;

    const originalSource: PageRenderSource | null = original && pair.originalPageNumber !== null
      ? { session: original, pageNumber: pair.originalPageNumber }
      : null;
    const modifiedSource: PageRenderSource | null = modified && pair.modifiedPageNumber !== null
      ? { session: modified, pageNumber: pair.modifiedPageNumber }
      : null;

    try {
      const comparison = await compareRenderedPages(originalSource, modifiedSource, {
        mode: 'aligned',
        maxPixels: options.maxPixels ?? EVIDENCE_MAX_PIXELS,
        images: {
          format: 'image/jpeg',
          quality: options.quality ?? EVIDENCE_QUALITY,
          encoding: 'data-url',
        },
        signal,
      });
      scale = comparison.scale || scale;
      pages.push({
        comparisonNumber: pair.comparisonNumber,
        label: pair.label,
        summary: comparison.mode === 'aligned'
          ? describeAlignedStatus(comparison.diff)
          : 'Rendered pages differ',
        original: comparison.images.originalOverlay ?? comparison.images.original,
        modified: comparison.images.overlay ?? comparison.images.modified,
      });
      // Data URLs are plain strings; there is nothing to revoke, but calling
      // release() keeps the contract honest if the encoding ever changes.
      comparison.release();
    } catch (error) {
      throwIfAborted(signal);
      pages.push({
        comparisonNumber: pair.comparisonNumber,
        label: pair.label,
        summary: error instanceof Error ? error.message : 'This page could not be rendered.',
        original: null,
        modified: null,
      });
    }

    onProgress?.(pages.length, selected.length);
  }

  return { scale, pages, omitted: Math.max(0, differing.length - selected.length) };
}
