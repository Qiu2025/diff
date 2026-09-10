/**
 * Optional OCR for pages with no text layer.
 *
 * Two rules shape this module.
 *
 * First, nothing is fetched from a third party. Tesseract.js defaults to a CDN
 * for its engine and language data; every path is overridden to point at
 * `/ocr/`, prepared by `npm run prepare-ocr`. When those assets are absent OCR
 * reports itself unavailable rather than quietly reaching out to the network.
 *
 * Second, OCR produces the same page model as native extraction. It fills in
 * `PDFPage`, with provenance and confidence, so the existing alignment and
 * text comparison work on a scanned document without knowing where the words
 * came from.
 */

import { buildPDFPage } from './pdfModel.ts';
import type { PDFPage, PDFTextItemInput } from './pdfModel.ts';

export interface OcrAvailability {
  available: boolean;
  /** Bytes a browser downloads the first time OCR runs in a session. */
  downloadBytes: number;
  languages: string[];
  engineVersion: string | null;
  /** Why OCR cannot run, when it cannot. */
  reason?: string;
}

export interface OcrPageRequest {
  /** Rendered page. Its pixels are read, not retained. */
  image: HTMLCanvasElement | ImageData;
  /** Unscaled page geometry, so results land in PDF coordinates. */
  page: { pageNumber: number; width: number; height: number; rotation: number };
  /** Points-to-pixels factor `image` was rendered at. */
  scale: number;
  language?: string;
  signal?: AbortSignal;
  onProgress?: (status: string, progress: number) => void;
}

/** Base path for the self-hosted engine, worker, and language data. */
const OCR_BASE = '/ocr';

/** Words below this confidence are kept but reported, not silently trusted. */
const LOW_CONFIDENCE = 60;

interface TesseractWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

interface TesseractLine {
  words: TesseractWord[];
}

interface TesseractBlock {
  paragraphs: { lines: TesseractLine[] }[];
}

let cachedAvailability: Promise<OcrAvailability> | null = null;

/**
 * Reports whether the self-hosted assets are present.
 *
 * The answer is cached for the page's lifetime: it cannot change without a
 * redeploy, and asking costs a request.
 */
export function checkOcrAvailability(): Promise<OcrAvailability> {
  cachedAvailability ??= (async (): Promise<OcrAvailability> => {
    const unavailable = (reason: string): OcrAvailability => ({
      available: false,
      downloadBytes: 0,
      languages: [],
      engineVersion: null,
      reason,
    });

    try {
      const response = await fetch(`${OCR_BASE}/manifest.json`, { cache: 'no-cache' });
      if (!response.ok) {
        return unavailable(
          'OCR assets are not installed on this deployment. Run "npm run prepare-ocr" and rebuild.'
        );
      }
      const manifest = await response.json();
      return {
        available: true,
        downloadBytes: Number(manifest.approximateDownloadBytes) || 0,
        languages: Array.isArray(manifest.languages) ? manifest.languages : ['eng'],
        engineVersion: typeof manifest.engineVersion === 'string' ? manifest.engineVersion : null,
      };
    } catch {
      return unavailable('The OCR assets could not be read from this deployment.');
    }
  })();

  return cachedAvailability;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('OCR was aborted.', 'AbortError');
  }
}

/**
 * Converts recognized words into the positioned-run contract.
 *
 * Tesseract reports pixel boxes with a top-left origin; PDF text runs use the
 * page's own coordinate space with a bottom-left origin, so the y axis is
 * flipped and every measurement is divided back out of the render scale.
 */
function toTextItems(
  blocks: readonly TesseractBlock[],
  scale: number,
  pageHeight: number
): { items: PDFTextItemInput[]; confidence: number; lowConfidenceWords: number } {
  const items: PDFTextItemInput[] = [];
  let confidenceSum = 0;
  let words = 0;
  let lowConfidenceWords = 0;

  for (const block of blocks) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        const recognized = line.words.filter(word => word.text.trim().length > 0);

        recognized.forEach((word, index) => {
          const left = word.bbox.x0 / scale;
          const right = word.bbox.x1 / scale;
          const top = word.bbox.y0 / scale;
          const bottom = word.bbox.y1 / scale;

          items.push({
            str: word.text,
            dir: 'ltr',
            // Baseline-ish origin: the bottom-left of the word box, in PDF
            // coordinates, matching what a native text run reports.
            transform: [1, 0, 0, 1, left, pageHeight - bottom],
            width: Math.max(0, right - left),
            height: Math.max(0, bottom - top),
            fontName: 'ocr',
            hasEOL: index === recognized.length - 1,
          });

          confidenceSum += word.confidence;
          words += 1;
          if (word.confidence < LOW_CONFIDENCE) lowConfidenceWords += 1;
        });
      }
    }
  }

  return {
    items,
    confidence: words > 0 ? confidenceSum / words / 100 : 0,
    lowConfidenceWords,
  };
}

export interface OcrSession {
  language: string;
  recognize(request: OcrPageRequest): Promise<PDFPage>;
  destroy(): Promise<void>;
}

export interface OcrSessionOptions {
  language?: string;
  signal?: AbortSignal;
  onProgress?: (status: string, progress: number) => void;
}

/**
 * Starts the recognizer and loads its language model once.
 *
 * Engine startup and model loading cost more than recognizing a page, so a
 * sweep over several pages must not pay them per page. The session holds the
 * model in memory, which is why it is created for a deliberate action and
 * destroyed as soon as that action finishes.
 */
export async function createOcrSession(options: OcrSessionOptions = {}): Promise<OcrSession> {
  const language = options.language ?? 'eng';
  throwIfAborted(options.signal);

  const { createWorker } = await import('tesseract.js');
  throwIfAborted(options.signal);

  const { onProgress } = options;
  const worker = await createWorker(language, 1, {
    workerPath: `${OCR_BASE}/worker.min.js`,
    corePath: OCR_BASE,
    langPath: OCR_BASE,
    // The hosted language data is not gzipped, and no cache layer is used:
    // repeat loads are the browser's HTTP cache, not storage this app manages.
    gzip: false,
    cacheMethod: 'none',
    // Passing `logger: undefined` overrides the engine's own default with a
    // non-function, so the key is only present when there is a listener.
    ...(onProgress
      ? {
        logger: (message: { status?: unknown; progress?: unknown }) =>
          onProgress(String(message.status), Number(message.progress) || 0),
      }
      : {}),
  });
  let destroyed = false;

  return {
    language,

    async recognize(request: OcrPageRequest): Promise<PDFPage> {
      if (destroyed) throw new Error('OCR session has been destroyed.');
      const { image, page, scale, signal } = request;
      throwIfAborted(signal);

      const { data } = await worker.recognize(image, {}, { blocks: true });
      throwIfAborted(signal);

      const blocks = (data.blocks ?? []) as unknown as TesseractBlock[];
      const { items, confidence, lowConfidenceWords } = toTextItems(blocks, scale, page.height);
      const built = buildPDFPage(
        page.pageNumber,
        { width: page.width, height: page.height, rotation: page.rotation },
        items
      );

      return {
        ...built,
        extraction: {
          source: 'ocr',
          status: built.text.trim() ? 'ok' : 'empty',
          itemCount: items.length,
          confidence,
          lowConfidenceWords,
          language,
        },
      };
    },

    async destroy(): Promise<void> {
      if (destroyed) return;
      destroyed = true;
      await worker.terminate();
    },
  };
}

/** Recognizes a single page, starting and stopping its own engine. */
export async function recognizePage(request: OcrPageRequest): Promise<PDFPage> {
  const session = await createOcrSession({
    language: request.language,
    signal: request.signal,
    onProgress: request.onProgress,
  });

  try {
    return await session.recognize(request);
  } finally {
    await session.destroy();
  }
}
