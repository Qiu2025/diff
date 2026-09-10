/**
 * Applying OCR to the pages of a comparison.
 *
 * OCR is expensive and optional, so it is only ever offered for the pages that
 * actually need it: the ones a PDF's own text layer leaves empty. Recognized
 * pages replace those pages in the document, and everything downstream — page
 * alignment, the text diff, the statistics, the export — carries on unchanged.
 */

import { createOcrSession } from './ocr.ts';
import type { PDFDocument, PDFPage } from './pdfModel';
import type { PdfSession } from './pdfUtils';

export type PdfSideName = 'original' | 'modified';

export interface OcrTarget {
  side: PdfSideName;
  pageNumber: number;
}

export interface OcrSweepOptions {
  sessions: Record<PdfSideName, PdfSession | null>;
  documents: Record<PdfSideName, PDFDocument | null>;
  targets: readonly OcrTarget[];
  language?: string;
  /** Render budget per page. OCR reads better at a higher resolution than the eye needs. */
  maxPixels?: number;
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number, target: OcrTarget) => void;
  onPage: (target: OcrTarget, page: PDFPage) => void;
}

/** Roughly 200 DPI for Letter. Below this, recognition quality drops sharply. */
const OCR_MAX_PIXELS = 4_000_000;
const OCR_MIN_SCALE = 1;
const OCR_MAX_SCALE = 5;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('OCR was aborted.', 'AbortError');
  }
}

/** Pages whose own text layer produced nothing, and which OCR has not replaced. */
export function findPagesNeedingOcr(
  documents: Record<PdfSideName, PDFDocument | null>
): OcrTarget[] {
  const targets: OcrTarget[] = [];

  (['original', 'modified'] as const).forEach(side => {
    for (const page of documents[side]?.pages ?? []) {
      if (page.extraction.source === 'native' && page.extraction.status === 'empty') {
        targets.push({ side, pageNumber: page.pageNumber });
      }
    }
  });

  return targets;
}

/** Replaces recognized pages in a document without mutating the original. */
export function applyOcrPages(
  document: PDFDocument | null,
  recognized: Readonly<Record<number, PDFPage>>
): PDFDocument | null {
  if (!document) return null;
  const numbers = Object.keys(recognized);
  if (numbers.length === 0) return document;

  return {
    ...document,
    pages: document.pages.map(page => recognized[page.pageNumber] ?? page),
  };
}

/**
 * Recognizes each target page in turn, reporting results as they arrive.
 *
 * Results are reported per page rather than returned at the end: recognition
 * takes seconds per page, and a reviewer should see the first page's text
 * without waiting for the last one.
 */
export async function runOcrSweep(options: OcrSweepOptions): Promise<void> {
  const { sessions, documents, targets, signal, onProgress, onPage } = options;
  if (targets.length === 0) return;

  const maxPixels = options.maxPixels ?? OCR_MAX_PIXELS;
  const ocr = await createOcrSession({ language: options.language, signal });
  const canvas = document.createElement('canvas');
  let completed = 0;

  try {
    for (const target of targets) {
      throwIfAborted(signal);
      const session = sessions[target.side];
      const geometry = documents[target.side]?.pages
        .find(page => page.pageNumber === target.pageNumber);
      if (!session || !geometry) continue;

      const budgetScale = Math.sqrt(maxPixels / Math.max(1, geometry.width * geometry.height));
      const scale = Math.min(OCR_MAX_SCALE, Math.max(OCR_MIN_SCALE, budgetScale));
      await session.renderPageToCanvas(target.pageNumber, canvas, scale, signal);
      throwIfAborted(signal);

      const page = await ocr.recognize({
        image: canvas,
        page: {
          pageNumber: target.pageNumber,
          width: geometry.width,
          height: geometry.height,
          rotation: geometry.rotation,
        },
        scale,
        signal,
      });

      onPage(target, page);
      completed += 1;
      onProgress?.(completed, targets.length, target);
    }
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    await ocr.destroy();
  }
}
