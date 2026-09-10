import assert from 'node:assert/strict';
import test from 'node:test';

import { launchChromium, startDevServer } from './helpers/browser.ts';

test('the Visual tab compares the selected page pair', async t => {
  const server = await startDevServer();
  t.after(() => server.close());

  const browser = await launchChromium();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const browserErrors: string[] = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });

  await page.goto(server.baseUrl);
  await page.getByRole('button', { name: 'Use sample files' }).click();
  await page.getByRole('heading', { name: 'Comparison results' }).waitFor();

  await page.getByRole('button', { name: 'Visual' }).click();

  // Aligned is the default: both pages are marked up, because a removal only
  // exists on the original and an addition only on the modified.
  await page.getByAltText('Original page render').waitFor();
  await page.getByAltText('Modified page render').waitFor();
  await page.getByText('Different', { exact: true }).waitFor();
  await page.getByText(/more only moved/).waitFor();

  const bands = page.locator('.visual-bands');
  await bands.waitFor();
  const counts = await bands.locator('div').evaluateAll(nodes =>
    Object.fromEntries(nodes.map(node => [
      node.querySelector('dt')?.textContent ?? '',
      Number(node.querySelector('dd')?.textContent ?? '0'),
    ]))
  );
  assert.deepEqual(Object.keys(counts).sort(), ['Added', 'Edited', 'Moved', 'Removed', 'Unchanged']);
  assert.ok(counts.Added > 0, 'the sample documents add content to page 1');
  assert.ok(counts.Moved > 0, 'the added content pushes later lines down the page');

  // Reviewing all pages is unavailable while the visual layer has no
  // whole-document resource budget.
  await page.getByText('Visual review runs one page at a time').waitFor();
  assert.equal(await page.locator('.show-all-checkbox input').isDisabled(), true);

  assert.ok(await page.locator('.visual-region').count() > 0, 'changed areas should be outlined');
  await page.locator('.visual-toggle input').uncheck();
  assert.equal(await page.locator('.visual-region').count(), 0);
  await page.locator('.visual-toggle input').check();

  // The exact engine paints removals and additions onto one image.
  await page.getByRole('button', { name: 'Exact' }).click();
  await page.getByAltText('Changes on the modified page page render').waitFor();
  await page.getByText(/% of rendered pixels differ/).waitFor();
  assert.equal(await page.locator('.visual-bands').count(), 0);
  assert.equal(await page.getByAltText('Original page render').count(), 0);

  await page.getByRole('button', { name: 'Plain pages' }).click();
  await page.getByAltText('Original page render').waitFor();
  await page.getByAltText('Modified page render').waitFor();

  await page.getByRole('button', { name: 'Aligned' }).click();
  await page.getByText(/more only moved/).waitFor();

  // Switching pages must re-run the comparison rather than reuse the old one.
  await page.getByRole('button', { name: 'Marked up' }).click();
  await page.getByRole('button', { name: 'Next page' }).click();
  await page.getByText('Rendering both pages on this device…').waitFor();
  await page.getByAltText('Original page render').waitFor();
  await page.getByText('2 of 2', { exact: true }).waitFor();

  // The text layer and the pixel layer report independently.
  await page.getByRole('button', { name: 'Split' }).click();
  await page.getByRole('heading', { name: 'Original' }).first().waitFor();
  assert.equal(await page.locator('.visual-diff').count(), 0);

  assert.deepEqual(browserErrors, []);
});

test('both documents can be chosen without waiting for the first to finish', async t => {
  const server = await startDevServer();
  t.after(() => server.close());

  const browser = await launchChromium();
  t.after(() => browser.close());
  const page = await browser.newPage();
  const browserErrors: string[] = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });

  await page.goto(server.baseUrl);
  // Each side owns its own request, so choosing the second document must not
  // cancel the first one and leave the comparison stranded.
  await page.locator('#file-input-original-pdf').setInputFiles('tests/fixtures/reflow-original.pdf');
  await page.locator('#file-input-modified-pdf').setInputFiles('tests/fixtures/reflow-modified.pdf');

  await page.getByRole('heading', { name: 'Comparison results' }).waitFor();
  await page.locator('.processing-indicator').waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('alert').count(), 0);
  assert.equal(
    await page.evaluate(async () => (await import('/src/utils/pdfUtils.ts')).getOpenSessionCount()),
    2
  );

  await page.getByRole('button', { name: 'Visual' }).click();
  await page.getByAltText('Original page render').waitFor();
  // One line was inserted and one word edited; the rest of the page only moved.
  await page.getByText(/more only moved/).waitFor();

  assert.deepEqual(browserErrors, []);
});
