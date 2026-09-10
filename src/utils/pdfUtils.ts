import * as pdfjsLib from 'pdfjs-dist';
import { buildPDFPage } from './pdfModel';
export type { PDFDocument, PDFPage } from './pdfModel';
import type { PDFDocument, PDFPage } from './pdfModel';

// Set up the worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

type LoadedPDF = Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>;

export interface PageSize {
  width: number;
  height: number;
  rotation: number;
}

let openSessions = 0;

/**
 * Number of PDF documents currently held open.
 *
 * Sessions stay open so pages can be rendered on demand, which makes leaked
 * sessions a real memory risk. This counter lets tests and diagnostics assert
 * that every session is eventually destroyed.
 */
export function getOpenSessionCount(): number {
  return openSessions;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('PDF operation was aborted.', 'AbortError');
  }
}

export async function openPdfSession(file: File, signal?: AbortSignal) {
  throwIfAborted(signal);
  const arrayBuffer = await file.arrayBuffer();
  throwIfAborted(signal);
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const abortLoading = () => void loadingTask.destroy();
  let pdf: LoadedPDF;

  signal?.addEventListener('abort', abortLoading, { once: true });
  try {
    pdf = await loadingTask.promise;
    throwIfAborted(signal);
  } catch (error) {
    await loadingTask.destroy();
    throwIfAborted(signal);
    throw error;
  } finally {
    signal?.removeEventListener('abort', abortLoading);
  }
  let destroyed = false;
  openSessions += 1;

  const getPage = async (pageNumber: number) => {
    if (destroyed) throw new Error('PDF session has been destroyed.');
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.numPages) {
      throw new RangeError(`Page number must be between 1 and ${pdf.numPages}.`);
    }
    return pdf.getPage(pageNumber);
  };

  const extractPage = async (pageNumber: number, signal?: AbortSignal): Promise<PDFPage> => {
    throwIfAborted(signal);
    const page = await getPage(pageNumber);

    try {
      const textContent = await page.getTextContent();
      throwIfAborted(signal);
      const viewport = page.getViewport({ scale: 1 });
      const textItems = textContent.items.filter(item => 'str' in item);
      return buildPDFPage(pageNumber, viewport, textItems);
    } finally {
      page.cleanup();
    }
  };

  return {
    name: file.name,
    totalPages: pdf.numPages,

    extractPage,

    /** Unscaled page geometry, used to plan a render before rasterizing it. */
    async getPageSize(pageNumber: number, signal?: AbortSignal): Promise<PageSize> {
      throwIfAborted(signal);
      const page = await getPage(pageNumber);

      try {
        const viewport = page.getViewport({ scale: 1 });
        return { width: viewport.width, height: viewport.height, rotation: viewport.rotation };
      } finally {
        page.cleanup();
      }
    },

    async extractDocument(signal?: AbortSignal): Promise<PDFDocument> {
      const pages: PDFPage[] = [];

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        pages.push(await extractPage(pageNumber, signal));
      }

      return { name: file.name, pages, totalPages: pdf.numPages };
    },

    async renderPageToCanvas(
      pageNumber: number,
      canvas: HTMLCanvasElement,
      scale = 1.5,
      signal?: AbortSignal
    ): Promise<void> {
      throwIfAborted(signal);
      const page = await getPage(pageNumber);
      const abort = () => renderTask.cancel();
      const viewport = page.getViewport({ scale });
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      const context = canvas.getContext('2d');

      if (!context) {
        page.cleanup();
        throw new Error('Could not get canvas context');
      }

      const renderTask = page.render({ canvasContext: context, viewport });
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) renderTask.cancel();

      try {
        throwIfAborted(signal);
        await renderTask.promise;
      } catch (error) {
        throwIfAborted(signal);
        throw error;
      } finally {
        signal?.removeEventListener('abort', abort);
        page.cleanup();
      }
    },

    async destroy(): Promise<void> {
      if (destroyed) return;
      destroyed = true;
      openSessions -= 1;
      await pdf.destroy();
    },
  };
}

export type PdfSession = Awaited<ReturnType<typeof openPdfSession>>;

export async function extractTextFromPDF(file: File, signal?: AbortSignal): Promise<PDFDocument> {
  const session = await openPdfSession(file, signal);

  try {
    return await session.extractDocument(signal);
  } finally {
    await session.destroy();
  }
}
