import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { alignPages, alignTextLines, computeStats, computeTextDiff, hasChanges } from '../src/utils/diffUtils.ts';
import { extractTextFromPDFFile, parsePageSpec } from '../src/cli/pdfUtils.ts';
import { generateHtmlReport, generateJsonOutput, type ReportData } from '../src/cli/reportGenerator.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
  const sideText = (parts: typeof rows[number]['parts'], side: 'original' | 'modified') => parts
    .filter(part => side === 'original' ? !part.added : !part.removed)
    .map(part => part.value)
    .join('');

  assert.ok(rows.some(row => sideText(row.parts, 'original') === '' && sideText(row.parts, 'modified') === '7. Privacy'));
  assert.ok(rows.some(row => sideText(row.parts, 'original') === '7. Liability Limitation' && sideText(row.parts, 'modified') === '8. Liability Limitation'));
  assert.ok(rows.some(row => sideText(row.parts, 'original') === '8. Dispute Resolution' && sideText(row.parts, 'modified') === '9. Dispute Resolution'));
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

test('page alignment does not treat textless pages as equal', () => {
  assert.deepEqual(
    alignPages(
      [{ pageNumber: 1, text: '' }],
      [{ pageNumber: 1, text: '' }]
    ).map(pair => [pair.originalPageNumber, pair.modifiedPageNumber]),
    [[1, null], [null, 1]]
  );
});

test('parsePageSpec returns sorted unique pages within the document', () => {
  assert.deepEqual(parsePageSpec('3, 1-3, 5, 99, invalid, 0-2', 5), [1, 2, 3, 5]);
});

test('HTML reports escape filenames and extracted PDF text', () => {
  const pdfText = `<script>alert("pdf")</script> & "quoted" 'single'`;
  const pageParts = [{ value: pdfText }];
  const data: ReportData = {
    originalDoc: { name: `original<&"'pdf`, pages: [{ pageNumber: 1, text: pdfText }], totalPages: 1 },
    modifiedDoc: { name: `modified<&"'pdf`, pages: [{ pageNumber: 1, text: 'safe' }], totalPages: 1 },
    pageDiffs: [{
      pageNumber: 1,
      originalPageNumber: 1,
      modifiedPageNumber: 1,
      originalText: pdfText,
      modifiedText: 'safe',
      similarity: 0,
      label: 'Page 1',
      parts: pageParts,
      hasChanges: false,
    }],
    overallStats: computeStats(pageParts),
    generatedAt: '2026-09-05',
  };

  const html = generateHtmlReport(data);

  assert.ok(html.includes('original&lt;&amp;&quot;&#039;pdf'));
  assert.ok(html.includes('modified&lt;&amp;&quot;&#039;pdf'));
  assert.ok(html.includes('&lt;script&gt;alert(&quot;pdf&quot;)&lt;/script&gt; &amp; &quot;quoted&quot; &#039;single&#039;'));
  assert.ok(!html.includes('<script>alert("pdf")</script>'));

  const json = JSON.parse(generateJsonOutput(data));
  assert.deepEqual(json.pages[0], {
    pageNumber: 1,
    comparisonNumber: 1,
    originalPageNumber: 1,
    modifiedPageNumber: 1,
    hasChanges: false,
  });
});
