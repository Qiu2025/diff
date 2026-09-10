import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { compareDocuments } from '../src/utils/diffUtils.ts';
import { extractTextFromPDFFile } from '../src/cli/pdfUtils.ts';

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

function fixture(name: string): string {
  return path.join(fixtures, `${name}.pdf`);
}

async function compareFixtures(original: string, modified: string) {
  const [originalDoc, modifiedDoc] = await Promise.all([
    extractTextFromPDFFile(fixture(original)),
    extractTextFromPDFFile(fixture(modified)),
  ]);
  return compareDocuments(originalDoc, modifiedDoc);
}

test('an inserted line is reported as an insertion, not as a rewrite', async () => {
  const result = await compareFixtures('reflow-original', 'reflow-modified');

  assert.equal(result.status, 'different');
  assert.equal(result.pageDiffs.length, 1);

  const added = result.pageDiffs[0].parts.filter(part => part.added).map(part => part.value);
  const removed = result.pageDiffs[0].parts.filter(part => part.removed).map(part => part.value);

  // Everything after the insertion moves down a line, but the text layer
  // realigns it, so the whole change is one inserted line and one edited word.
  assert.deepEqual(added, [
    'The Services means the work set out in the statement of work.',
    'four',
  ]);
  assert.deepEqual(removed, ['two']);
  assert.equal(result.pageDiffs[0].stats.deletions, 1);
});

test('an image-only page is indeterminate for the text layer, never equal', async () => {
  const result = await compareFixtures('scan-original', 'scan-modified');

  assert.equal(result.status, 'indeterminate');
  assert.equal(result.pageDiffs[0].status, 'indeterminate');
  assert.equal(result.pageDiffs[0].stats.totalChanges, 0);
  assert.deepEqual(
    result.diagnostics.map(diagnostic => diagnostic.code),
    ['no-extractable-text']
  );
  assert.equal(result.diagnostics[0].side, 'both');
});

test('the same content on different paper sizes has no text change', async () => {
  const [letter, a4] = await Promise.all([
    extractTextFromPDFFile(fixture('letter')),
    extractTextFromPDFFile(fixture('a4')),
  ]);

  assert.notEqual(Math.round(letter.pages[0].width), Math.round(a4.pages[0].width));
  const result = compareDocuments(letter, a4);
  assert.equal(result.status, 'equal');
  assert.equal(result.overallStats.totalChanges, 0);
});

test('a landscape page reports landscape geometry', async () => {
  const doc = await extractTextFromPDFFile(fixture('landscape'));
  const page = doc.pages[0];

  assert.ok(page.width > page.height);
  assert.equal(page.extraction.status, 'ok');
});

test('a damaged file is rejected rather than compared', async () => {
  await assert.rejects(() => extractTextFromPDFFile(fixture('damaged')));
});
