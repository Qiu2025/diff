/**
 * Whole-document visual sweep.
 *
 * The per-page view answers "what changed on this page". A reviewer's first
 * question is usually "which pages changed at all" — and for a scanned
 * document the text layer cannot answer it. This walks every page pair through
 * the visual engine and reports one verdict per pair.
 *
 * The sweep runs one page at a time on purpose: there is one comparison worker,
 * and rendering two pages already costs two full-page canvases. Bounded work
 * beats a burst that exhausts memory on a long document.
 */

import { compareRenderedPages } from './visualPageRenderer.ts';
import type { PageRenderSource } from './visualPageRenderer.ts';
import type { VisualStatus } from './visualDiff.ts';
import type { BandStatus } from './visualBands.ts';
import type { PdfSession } from './pdfUtils';

export interface ScanPagePair {
  /** 1-based position of this pair in the comparison. */
  comparisonNumber: number;
  label: string;
  originalPageNumber: number | null;
  modifiedPageNumber: number | null;
}

export interface VisualPageSummary extends ScanPagePair {
  status: VisualStatus;
  bandCounts: Record<BandStatus, number> | null;
  changedPixels: number;
  changeRatio: number;
  diagnostics: string[];
  /** Set when this page pair could not be compared at all. */
  error?: string;
}

export interface VisualScanResult {
  engineVersion: 'visual-bands-v1';
  /** Points-to-pixels factor pages were swept at. */
  scale: number;
  status: VisualStatus;
  pages: VisualPageSummary[];
  /** Number of pairs whose renders differ. */
  differing: number;
}

export interface VisualScanOptions {
  original: PdfSession | null;
  modified: PdfSession | null;
  pairs: readonly ScanPagePair[];
  /**
   * Sweep resolution. Lower than the per-page view: a sweep answers "did this
   * page change", which does not need 150 DPI.
   */
  maxPixels?: number;
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
}

/** Roughly 95 DPI for Letter: enough to see a change, a quarter of the work. */
const SCAN_MAX_PIXELS = 900_000;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('Visual scan was aborted.', 'AbortError');
  }
}

function worstStatus(pages: readonly VisualPageSummary[]): VisualStatus {
  if (pages.some(page => page.status === 'different')) return 'different';
  if (pages.some(page => page.status === 'indeterminate')) return 'indeterminate';
  return 'equal';
}

/** Compares every page pair and reports one verdict each. */
export async function scanDocumentVisually(
  options: VisualScanOptions
): Promise<VisualScanResult> {
  const { original, modified, pairs, signal, onProgress } = options;
  const maxPixels = options.maxPixels ?? SCAN_MAX_PIXELS;
  const pages: VisualPageSummary[] = [];
  let scale = 0;

  for (const pair of pairs) {
    throwIfAborted(signal);
    const originalSource: PageRenderSource | null = original && pair.originalPageNumber !== null
      ? { session: original, pageNumber: pair.originalPageNumber }
      : null;
    const modifiedSource: PageRenderSource | null = modified && pair.modifiedPageNumber !== null
      ? { session: modified, pageNumber: pair.modifiedPageNumber }
      : null;

    try {
      const comparison = await compareRenderedPages(originalSource, modifiedSource, {
        mode: 'aligned',
        maxPixels,
        images: false,
        signal,
      });
      const diff = comparison.mode === 'aligned' ? comparison.diff : null;
      scale = comparison.scale || scale;
      pages.push({
        ...pair,
        status: comparison.diff.status,
        bandCounts: diff?.bandCounts ?? null,
        changedPixels: comparison.diff.changedPixels,
        changeRatio: comparison.diff.changeRatio,
        diagnostics: comparison.diff.diagnostics.map(diagnostic => diagnostic.code),
      });
    } catch (error) {
      throwIfAborted(signal);
      // One unreadable page must not discard the verdicts already collected.
      pages.push({
        ...pair,
        status: 'indeterminate',
        bandCounts: null,
        changedPixels: 0,
        changeRatio: 0,
        diagnostics: ['render-failed'],
        error: error instanceof Error ? error.message : 'This page could not be rendered.',
      });
    }

    onProgress?.(pages.length, pairs.length);
  }

  return {
    engineVersion: 'visual-bands-v1',
    scale,
    status: worstStatus(pages),
    pages,
    differing: pages.filter(page => page.status === 'different').length,
  };
}

export function describeScanSummary(result: VisualScanResult): string {
  const total = result.pages.length;
  const unavailable = result.pages.filter(page => page.status === 'indeterminate').length;
  const pageWord = total === 1 ? 'page' : 'pages';
  const suffix = unavailable > 0 ? `; ${unavailable} could not be compared` : '';

  if (result.differing === 0) {
    return unavailable > 0
      ? `No visual change found on ${total - unavailable} of ${total} ${pageWord}${suffix}`
      : `All ${total} ${pageWord} render identically`;
  }

  const verb = result.differing === 1 ? 'renders' : 'render';
  return `${result.differing} of ${total} ${pageWord} ${verb} differently${suffix}`;
}
