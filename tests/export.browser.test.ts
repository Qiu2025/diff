import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { extractTextFromPDFFile } from '../src/cli/pdfUtils.ts';
import { launchChromium, startDevServer } from './helpers/browser.ts';

test('the exported report carries the visual verdicts and evidence', async t => {
  const server = await startDevServer();
  t.after(() => server.close());

  const browser = await launchChromium();
  t.after(() => browser.close());
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-diff-export-'));
  t.after(() => fs.rm(outputDir, { recursive: true, force: true }));

  const page = await browser.newPage({ acceptDownloads: true });
  const browserErrors: string[] = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });

  await page.goto(server.baseUrl);
  await page.getByRole('button', { name: 'Use sample files' }).click();
  await page.getByRole('heading', { name: 'Comparison results' }).waitFor();

  const download = async (name: string) => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export PDF/ }).click();
    const file = await pending;
    const target = path.join(outputDir, name);
    await file.saveAs(target);
    return extractTextFromPDFFile(target);
  };

  // Without a scan there is no visual evidence to report, and the text report
  // must be unaffected.
  const textOnly = await download('text-only.pdf');
  const textOnlyContent = textOnly.pages.map(reportPage => reportPage.text).join('\n');
  assert.match(textOnlyContent, /PDF Diff Report/);
  assert.doesNotMatch(textOnlyContent, /Visual Comparison/);

  await page.getByRole('button', { name: 'Visual' }).click();
  await page.getByRole('button', { name: 'Scan all pages' }).click();
  await page.getByText('2 of 2 pages render differently').waitFor({ timeout: 60_000 });

  const withVisual = await download('with-visual.pdf');
  const visualContent = withVisual.pages.map(reportPage => reportPage.text).join('\n');

  assert.match(visualContent, /Visual Comparison/);
  assert.match(visualContent, /2 of 2 pages render differently/);
  assert.match(visualContent, /independent of the text comparison/);
  assert.match(visualContent, /Text Comparison/);
  // Each illustrated page names both sides of the evidence.
  assert.match(visualContent, /Original[\s\S]*Modified/);
  assert.ok(
    withVisual.totalPages > textOnly.totalPages,
    `the illustrated report has ${withVisual.totalPages} pages, the text-only one ${textOnly.totalPages}`
  );

  const size = (await fs.stat(path.join(outputDir, 'with-visual.pdf'))).size;
  assert.ok(size > 20_000, 'the report should contain rendered page images');
  assert.ok(size < 12_000_000, `the report grew to ${size} bytes`);

  assert.deepEqual(browserErrors, []);
});
