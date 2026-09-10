export interface PDFTextRun {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontName: string;
  direction: string;
  hasEOL: boolean;
  textStart: number;
  textEnd: number;
}

export interface PDFPage {
  pageNumber: number;
  width: number;
  height: number;
  rotation: number;
  text: string;
  textRuns: PDFTextRun[];
  extraction: PageExtraction;
}

export interface PageExtraction {
  /** Where the text came from. OCR results are not native text. */
  source: 'native' | 'ocr';
  status: 'ok' | 'empty';
  itemCount: number;
  /** Mean recognition confidence, 0..1. Only meaningful for OCR. */
  confidence?: number;
  /** Recognized words the engine was unsure about. */
  lowConfidenceWords?: number;
  /** Language the recognizer was run with. */
  language?: string;
}

export interface PDFDocument {
  name: string;
  pages: PDFPage[];
  totalPages: number;
}

export interface PDFTextItemInput {
  str: string;
  dir: string;
  transform: ArrayLike<number>;
  width: number;
  height: number;
  fontName: string;
  hasEOL: boolean;
}

interface PageGeometry {
  width: number;
  height: number;
  rotation: number;
}

function finite(value: number | undefined): number {
  return Number.isFinite(value) ? value ?? 0 : 0;
}

export function buildPDFPage(
  pageNumber: number,
  geometry: PageGeometry,
  items: readonly PDFTextItemInput[]
): PDFPage {
  const textRuns: PDFTextRun[] = [];
  let text = '';
  let previous: PDFTextRun | undefined;

  for (const item of items) {
    const x = finite(item.transform[4]);
    const y = finite(item.transform[5]);
    const width = finite(item.width);
    const height = finite(item.height);

    if (previous) {
      const changedLine = previous.hasEOL || Math.abs(y - previous.y) > 5;
      const hasWordGap = x - (previous.x + previous.width) > 2;
      if (changedLine) text += '\n';
      else if (hasWordGap) text += ' ';
    }

    const textStart = text.length;
    text += item.str;
    const run: PDFTextRun = {
      text: item.str,
      x,
      y,
      width,
      height,
      fontName: item.fontName,
      direction: item.dir,
      hasEOL: item.hasEOL,
      textStart,
      textEnd: text.length,
    };
    textRuns.push(run);
    previous = run;
  }

  return {
    pageNumber,
    width: finite(geometry.width),
    height: finite(geometry.height),
    rotation: finite(geometry.rotation),
    text,
    textRuns,
    extraction: {
      source: 'native',
      status: text.trim() ? 'ok' : 'empty',
      itemCount: items.length,
    },
  };
}
