import * as fs from 'fs';
import * as path from 'path';
import { buildPDFPage } from '../utils/pdfModel.ts';
export type { PDFDocument, PDFPage } from '../utils/pdfModel.ts';
import type { PDFDocument, PDFPage } from '../utils/pdfModel.ts';

// Dynamic import for pdfjs-dist (use legacy build for Node.js compatibility)
let pdfjsLib: typeof import('pdfjs-dist/legacy/build/pdf.mjs') | null = null;

async function getPdfjs() {
  if (!pdfjsLib) {
    pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfjsLib;
}

export async function extractTextFromPDFFile(filePath: string): Promise<PDFDocument> {
  const pdfjs = await getPdfjs();
  const absolutePath = path.resolve(filePath);
  
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found: ${absolutePath}`);
  }
  
  const data = new Uint8Array(fs.readFileSync(absolutePath));
  
  // Configure PDF.js for Node.js text extraction
  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
  });
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
    name: path.basename(filePath),
    pages,
    totalPages: pdf.numPages,
  };
}

export function parsePageSpec(spec: string, maxPages: number): number[] {
  const pages: Set<number> = new Set();
  const parts = spec.split(',');
  
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.includes('-')) {
      const [start, end] = trimmed.split('-').map(n => parseInt(n.trim(), 10));
      for (let i = start; i <= Math.min(end, maxPages); i++) {
        if (i >= 1) pages.add(i);
      }
    } else {
      const num = parseInt(trimmed, 10);
      if (num >= 1 && num <= maxPages) {
        pages.add(num);
      }
    }
  }
  
  return Array.from(pages).sort((a, b) => a - b);
}
