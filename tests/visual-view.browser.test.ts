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
  const overlay = page.getByAltText('Changes on the modified page page render');
  await overlay.waitFor();

  await page.getByText('Different', { exact: true }).waitFor();
  await page.getByText(/% of rendered pixels differ/).waitFor();
  await page.getByText(/change region/).waitFor();

  // Reviewing all pages is unavailable while the visual layer has no
  // whole-document resource budget.
  await page.getByText('Visual review runs one page at a time').waitFor();
  assert.equal(
    await page.locator('.show-all-checkbox input').isDisabled(),
    true
  );

  const renderedRegions = await page.locator('.visual-region').count();
  assert.ok(renderedRegions > 0, 'changed areas should be outlined on the page');

  await page.getByRole('button', { name: 'Side by side' }).click();
  await page.getByAltText('Original page render').waitFor();
  await page.getByAltText('Modified page render').waitFor();
  assert.equal(await page.getByAltText('Changes on the modified page page render').count(), 0);

  await page.locator('.visual-toggle input').uncheck();
  assert.equal(await page.locator('.visual-region').count(), 0);

  // Switching pages must re-run the comparison rather than reuse the old one.
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
