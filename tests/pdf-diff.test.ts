import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { alignPages, alignTextLines, compareDocuments, computeStats, computeTextDiff, hasChanges, type DiffPart } from '../src/utils/diffUtils.ts';
import { extractTextFromPDFFile, parsePageSpec } from '../src/cli/pdfUtils.ts';
import { generateHtmlReport, generateJsonOutput, generateJunitOutput, type ReportData } from '../src/cli/reportGenerator.ts';
import { buildPDFPage, type PDFDocument, type PDFPage } from '../src/utils/pdfModel.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function textPage(pageNumber: number, text: string): PDFPage {
  return buildPDFPage(pageNumber, { width: 612, height: 792, rotation: 0 }, [{
    str: text,
    dir: 'ltr',
    transform: [1, 0, 0, 1, 20, 700],
    width: text.length * 5,
    height: 12,
    fontName: 'TestFont',
    hasEOL: false,
  }]);
}

function pdfDocument(name: string, pages: PDFPage[]): PDFDocument {
  return { name, pages, totalPages: pages.length };
}

function sideText(parts: DiffPart[], side: 'original' | 'modified'): string {
  return parts
    .filter(part => side === 'original' ? !part.added : !part.removed)
    .map(part => part.value)
    .join('');
}

test('demo PDFs have two pages and expected extracted text', async () => {
  const original = await extractTextFromPDFFile(path.join(repoRoot, 'public/demo-original.pdf'));
  const modified = await extractTextFromPDFFile(path.join(repoRoot, 'public/demo-modified.pdf'));

  assert.equal(original.totalPages, 2);
  assert.equal(modified.totalPages, 2);
  assert.match(original.pages[0]?.text ?? '', /Version 1\.0/);
  assert.match(modified.pages[0]?.text ?? '', /Version 2\.0/);
  assert.match(modified.pages[1]?.text ?? '', /7\. Privacy/);
  assert.match(modified.pages[1]?.text ?? '', /We collect minimal usage data to improve the software\./);
  assert.match(modified.pages[1]?.text ?? '', /Last updated: March 1, 2025/);
  assert.doesNotMatch(modified.pages[1]?.text ?? '', /You may not reverse engineer/);
  assert.equal(original.pages[0]?.extraction.status, 'ok');
  assert.ok((original.pages[0]?.textRuns.length ?? 0) > 0);
  assert.ok((original.pages[0]?.width ?? 0) > 0);
});

test('PDF page model preserves text geometry, ranges, and explicit line endings', () => {
  const page = buildPDFPage(3, { width: 600, height: 800, rotation: 90 }, [
    { str: 'Hello', dir: 'ltr', transform: [1, 0, 0, 1, 10, 700], width: 25, height: 10, fontName: 'A', hasEOL: false },
    { str: 'world', dir: 'ltr', transform: [1, 0, 0, 1, 40, 700], width: 25, height: 10, fontName: 'A', hasEOL: true },
    { str: 'Next', dir: 'ltr', transform: [1, 0, 0, 1, 10, 680], width: 20, height: 10, fontName: 'B', hasEOL: false },
  ]);

  assert.equal(page.text, 'Hello world\nNext');
  assert.deepEqual(
    page.textRuns.map(run => [run.text, run.textStart, run.textEnd]),
    [['Hello', 0, 5], ['world', 6, 11], ['Next', 12, 16]]
  );
  assert.deepEqual([page.width, page.height, page.rotation], [600, 800, 90]);
  assert.equal(page.extraction.status, 'ok');
  assert.equal(
    buildPDFPage(4, { width: 600, height: 800, rotation: 0 }, []).extraction.status,
    'empty'
  );
});

test('diffUtils detects same, added, deleted, and replaced text and computes stats', () => {
  const cases = [
    { oldText: 'alpha beta', newText: 'alpha beta', changes: false, stats: { additions: 0, deletions: 0, unchanged: 2, totalChanges: 0, changePercentage: 0 } },
    { oldText: 'alpha', newText: 'alpha beta', changes: true, stats: { additions: 1, deletions: 0, unchanged: 1, totalChanges: 1, changePercentage: 50 } },
    { oldText: 'alpha beta', newText: 'alpha', changes: true, stats: { additions: 0, deletions: 1, unchanged: 1, totalChanges: 1, changePercentage: 50 } },
    { oldText: 'alpha beta', newText: 'alpha gamma', changes: true, stats: { additions: 1, deletions: 1, unchanged: 1, totalChanges: 2, changePercentage: (2 / 3) * 100 } },
  ];

  for (const { oldText, newText, changes, stats } of cases) {
    const parts = computeTextDiff(oldText, newText);
    assert.equal(hasChanges(parts), changes);
    assert.deepEqual(computeStats(parts), stats);
  }
});

test('line alignment keeps inserted and renumbered sections with their headings', () => {
  const original = [
    'Additional Terms',
    '7. Liability Limitation',
    'Maximum liability is limited to the purchase price.',
    '8. Dispute Resolution',
  ].join('\n');
  const modified = [
    'Additional Terms',
    '7. Privacy',
    'Your data is never sold to third parties.',
    '8. Liability Limitation',
    'Maximum liability is limited to twice the purchase price.',
    '9. Dispute Resolution',
  ].join('\n');
  const rows = alignTextLines(original, modified);

  assert.ok(rows.some(row => sideText(row.parts, 'original') === '' && sideText(row.parts, 'modified') === '7. Privacy'));
  assert.ok(rows.some(row => sideText(row.parts, 'original') === '7. Liability Limitation' && sideText(row.parts, 'modified') === '8. Liability Limitation'));
  assert.ok(rows.some(row => sideText(row.parts, 'original') === '8. Dispute Resolution' && sideText(row.parts, 'modified') === '9. Dispute Resolution'));
});

test('side-by-side alignment preserves shared blank lines and boundary spaces', () => {
  const originalLine = 'The licensor grants a non-exclusive license for personal purposes only.';
  const modifiedLine = 'The licensor grants a non-exclusive, worldwide license for both personal and commercial purposes.';
  const rows = alignTextLines(`Agreement\n\n${originalLine}`, `Agreement\n\n${modifiedLine}`);

  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1]?.parts, []);
  assert.equal(sideText(rows[2]?.parts ?? [], 'original'), originalLine);
  assert.equal(sideText(rows[2]?.parts ?? [], 'modified'), modifiedLine);
  assert.equal(hasChanges(computeTextDiff('Agreement\n\nTerms', 'Agreement\n\nTerms')), false);
});

test('page alignment keeps later pages paired after insertions and removals', () => {
  const original = [
    { pageNumber: 1, text: 'Cover page for the agreement' },
    { pageNumber: 2, text: 'Payment terms are due within thirty days' },
    { pageNumber: 3, text: 'Appendix with contact details' },
  ];
  const modified = [
    { pageNumber: 1, text: 'Cover page for the agreement' },
    { pageNumber: 2, text: 'New executive summary and approval record' },
    { pageNumber: 3, text: 'Payment terms are due within sixty days' },
    { pageNumber: 4, text: 'Appendix with contact details' },
  ];

  assert.deepEqual(
    alignPages(original, modified).map(pair => [pair.originalPageNumber, pair.modifiedPageNumber]),
    [[1, 1], [null, 2], [2, 3], [3, 4]]
  );

  assert.deepEqual(
    alignPages(modified, original).map(pair => [pair.originalPageNumber, pair.modifiedPageNumber]),
    [[1, 1], [2, null], [3, 2], [4, 3]]
  );
});

test('textless pages stay paired but comparison remains indeterminate', () => {
  const original = pdfDocument('original.pdf', [textPage(1, '')]);
  const modified = pdfDocument('modified.pdf', [textPage(1, '')]);
  const pairs = alignPages(original.pages, modified.pages);
  const result = compareDocuments(original, modified, pairs);

  assert.deepEqual(
    pairs.map(pair => [pair.originalPageNumber, pair.modifiedPageNumber, pair.similarity]),
    [[1, 1, null]]
  );
  assert.equal(result.status, 'indeterminate');
  assert.equal(result.pageDiffs[0]?.status, 'indeterminate');
  assert.equal(result.pageDiffs[0]?.hasChanges, false);
  assert.equal(result.diagnostics[0]?.code, 'no-extractable-text');
  assert.equal(result.diagnostics[0]?.side, 'both');
});

test('comparison result is versioned and reports equal and different states', () => {
  const original = pdfDocument('original.pdf', [textPage(1, 'same text')]);
  const equal = compareDocuments(original, pdfDocument('copy.pdf', [textPage(1, 'same text')]));
  const different = compareDocuments(original, pdfDocument('modified.pdf', [textPage(1, 'changed text')]));

  assert.equal(equal.schemaVersion, 1);
  assert.equal(equal.engineVersion, 'text-v1');
  assert.equal(equal.status, 'equal');
  assert.equal(equal.pageDiffs[0]?.status, 'equal');
  assert.equal(different.status, 'different');
  assert.equal(different.pageDiffs[0]?.status, 'different');
});

test('parsePageSpec returns sorted unique pages within the document', () => {
  assert.deepEqual(parsePageSpec('3, 1-3, 5, 99, invalid, 0-2', 5), [1, 2, 3, 5]);
});

test('HTML reports escape filenames and extracted PDF text', () => {
  const pdfText = `<script>alert("pdf")</script> & "quoted" 'single'`;
  const result = compareDocuments(
    pdfDocument(`original<&"'pdf`, [textPage(1, pdfText)]),
    pdfDocument(`modified<&"'pdf`, [textPage(1, 'safe')]),
    [{
      originalPageNumber: 1,
      modifiedPageNumber: 1,
      originalText: pdfText,
      modifiedText: 'safe',
      similarity: 0,
    }]
  );
  const data: ReportData = {
    result,
    generatedAt: '2026-09-05',
  };

  const html = generateHtmlReport(data);

  assert.ok(html.includes('original&lt;&amp;&quot;&#039;pdf'));
  assert.ok(html.includes('modified&lt;&amp;&quot;&#039;pdf'));
  assert.ok(html.includes('&lt;script&gt;alert(&quot;pdf&quot;)&lt;/script&gt; &amp; &quot;quoted&quot; &#039;single&#039;'));
  assert.ok(!html.includes('<script>alert("pdf")</script>'));

  const json = JSON.parse(generateJsonOutput(data));
  assert.equal(json.schemaVersion, 1);
  assert.equal(json.engineVersion, 'text-v1');
  assert.equal(json.status, 'different');
  assert.deepEqual(json.diagnostics, []);
  assert.deepEqual(json.pages[0], {
    pageNumber: 1,
    comparisonNumber: 1,
    originalPageNumber: 1,
    modifiedPageNumber: 1,
    status: 'different',
    hasChanges: true,
  });
});

test('JUnit reports indeterminate text comparisons as errors', () => {
  const data: ReportData = {
    result: compareDocuments(
      pdfDocument('original.pdf', [textPage(1, '')]),
      pdfDocument('modified.pdf', [textPage(1, '')])
    ),
    generatedAt: '2026-09-05',
  };

  const html = generateHtmlReport(data);
  const json = JSON.parse(generateJsonOutput(data));
  const junit = generateJunitOutput(data);

  assert.match(html, /Text unavailable/);
  assert.match(html, /Visual comparison or OCR is required/);
  assert.equal(json.status, 'indeterminate');
  assert.equal(json.pages[0]?.status, 'indeterminate');
  assert.match(junit, /failures="0" errors="1"/);
  assert.match(junit, /<error message="Page 1 could not be verified">/);
});
