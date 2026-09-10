import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { launchChromium, startDevServer } from './helpers/browser.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ocrInstalled = fs.existsSync(path.join(repoRoot, 'public', 'ocr', 'manifest.json'));

test('OCR reads a scanned document into a real text comparison', { skip: ocrInstalled ? false : 'OCR assets are not installed; run "npm run prepare-ocr" first' }, async t => {
  const server = await startDevServer();
  t.after(() => server.close());

  const browser = await launchChromium();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const browserErrors: string[] = [];
  const externalRequests: string[] = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('request', request => {
    const url = request.url();
    const local = url.startsWith(server.baseUrl)
      || url.startsWith('data:')
      || url.startsWith('blob:');
    if (!local) externalRequests.push(url);
  });

  await page.goto(server.baseUrl);
  // Importing a dependency for the first time makes Vite re-optimize and
  // reload, which would destroy the execution context mid-test.
  await page.evaluate(() => import('/src/utils/ocr.ts').then(() => {}, () => {}));
  await page.waitForTimeout(1_500);
  await page.goto(server.baseUrl);

  await page.locator('#file-input-original-pdf').setInputFiles('tests/fixtures/scan-original.pdf');
  await page.locator('#file-input-modified-pdf').setInputFiles('tests/fixtures/scan-modified.pdf');
  await page.getByRole('heading', { name: 'Comparison results' }).waitFor();

  // These pages are images. Before OCR there is nothing to compare as text.
  await page.getByText(/no extractable text/).waitFor();
  await page.getByText(/2 pages contain no text layer/).waitFor();
  await page.getByText(/application download, not a document upload/).waitFor();

  await page.getByRole('button', { name: 'Read 2 pages with OCR' }).click();
  await page.getByText(/2 pages were read with OCR on this device/).waitFor({ timeout: 180_000 });

  // The scanned fixtures are images of the same documents as the reflow pair,
  // whose text layer produces 13 additions and 1 deletion. Recognition has to
  // land on the same comparison.
  const stats = await page.locator('.diff-stats').textContent() ?? '';
  assert.match(stats, /\+13/);
  assert.match(stats, /−1/);
  assert.match(stats, /14\.0%/);
  assert.equal(
    await page.locator('.comparison-warning').count(),
    0,
    'no page should still be missing text'
  );

  const sideText = await page.locator('.diff-side-cell.modified').allTextContents();
  assert.match(sideText.join('\n'), /statement of work/);
  assert.match(sideText.join('\n'), /four percent/);

  assert.deepEqual(
    externalRequests,
    [],
    'OCR must not reach any third party: engine and language data are self-hosted'
  );
  assert.deepEqual(browserErrors, []);
});
