import * as pdfjsLib from 'pdfjs-dist';
import { buildPDFPage } from './pdfModel';
export type { PDFDocument, PDFPage } from './pdfModel';
import type { PDFDocument, PDFPage } from './pdfModel';

// Set up the worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

export async function extractTextFromPDF(file: File): Promise<PDFDocument> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  let pdf: Awaited<typeof loadingTask.promise>;

  try {
    pdf = await loadingTask.promise;
  } catch (error) {
    await loadingTask.destroy();
    throw error;
  }
  const pages: PDFPage[] = [];

  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);

      try {
        const textContent = await page.getTextContent();
        const viewport = page.getViewport({ scale: 1 });
        const textItems = textContent.items.filter(item => 'str' in item);
        pages.push(buildPDFPage(i, viewport, textItems));
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await pdf.destroy();
  }

  return {
    name: file.name,
    pages,
    totalPages: pdf.numPages,
  };
}

export async function renderPageToCanvas(
  file: File,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale: number = 1.5
): Promise<void> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  let pdf: Awaited<typeof loadingTask.promise>;

  try {
    pdf = await loadingTask.promise;
  } catch (error) {
    await loadingTask.destroy();
    throw error;
  }

  try {
    const page = await pdf.getPage(pageNumber);

    try {
      const viewport = page.getViewport({ scale });
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not get canvas context');

      await page.render({
        canvasContext: context,
        viewport,
      }).promise;
    } finally {
      page.cleanup();
    }
  } finally {
    await pdf.destroy();
  }
}
