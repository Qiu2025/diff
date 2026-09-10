import assert from 'node:assert/strict';
import test from 'node:test';

import { applyOcrPages, findPagesNeedingOcr } from '../src/utils/ocrDocument.ts';
import { buildPDFPage, type PDFDocument, type PDFPage } from '../src/utils/pdfModel.ts';

function page(pageNumber: number, text: string): PDFPage {
  return buildPDFPage(pageNumber, { width: 595, height: 842, rotation: 0 }, text
    ? [{
      str: text,
      dir: 'ltr',
      transform: [1, 0, 0, 1, 20, 700],
      width: text.length * 5,
      height: 12,
      fontName: 'TestFont',
      hasEOL: false,
    }]
    : []);
}

function document(name: string, pages: PDFPage[]): PDFDocument {
  return { name, pages, totalPages: pages.length };
}

function recognized(pageNumber: number, text: string): PDFPage {
  const built = page(pageNumber, text);
  return {
    ...built,
    extraction: {
      source: 'ocr',
      status: 'ok',
      itemCount: 1,
      confidence: 0.91,
      lowConfidenceWords: 0,
      language: 'eng',
    },
  };
}

test('only pages with no text of their own are offered to OCR', () => {
  const targets = findPagesNeedingOcr({
    original: document('a.pdf', [page(1, 'Has text'), page(2, ''), page(3, '')]),
    modified: document('b.pdf', [page(1, ''), page(2, 'Has text')]),
  });

  assert.deepEqual(targets, [
    { side: 'original', pageNumber: 2 },
    { side: 'original', pageNumber: 3 },
    { side: 'modified', pageNumber: 1 },
  ]);
});

test('a page already recognized is not offered again', () => {
  const withOcr = applyOcrPages(
    document('a.pdf', [page(1, ''), page(2, '')]),
    { 1: recognized(1, 'Recognized text') }
  );
  const targets = findPagesNeedingOcr({ original: withOcr, modified: null });

  assert.deepEqual(targets, [{ side: 'original', pageNumber: 2 }]);
});

test('applying OCR pages replaces them without mutating the document', () => {
  const original = document('a.pdf', [page(1, 'Native'), page(2, '')]);
  const patched = applyOcrPages(original, { 2: recognized(2, 'From the scan') });

  assert.notEqual(patched, original);
  assert.equal(original.pages[1].text, '');
  assert.equal(patched?.pages[1].text, 'From the scan');
  assert.equal(patched?.pages[1].extraction.source, 'ocr');
  assert.equal(patched?.pages[0], original.pages[0], 'untouched pages keep their identity');
  assert.equal(patched?.totalPages, 2);
});

test('a document with no recognized pages is returned unchanged', () => {
  const original = document('a.pdf', [page(1, 'Native')]);

  assert.equal(applyOcrPages(original, {}), original);
  assert.equal(applyOcrPages(null, { 1: recognized(1, 'x') }), null);
});

test('recognized pages carry their provenance and confidence', () => {
  const patched = applyOcrPages(
    document('a.pdf', [page(1, '')]),
    { 1: recognized(1, 'Recognized') }
  );

  assert.deepEqual(patched?.pages[0].extraction, {
    source: 'ocr',
    status: 'ok',
    itemCount: 1,
    confidence: 0.91,
    lowConfidenceWords: 0,
    language: 'eng',
  });
});
