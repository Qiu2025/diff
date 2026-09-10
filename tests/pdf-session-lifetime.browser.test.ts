import assert from 'node:assert/strict';
import test from 'node:test';

import { launchChromium, startDevServer } from './helpers/browser.ts';

/**
 * The application keeps PDFs open after text extraction so pages can be
 * rendered for visual comparison. That makes leaked sessions a real memory
 * risk, so the lifecycle is asserted rather than assumed.
 */
test('the app releases every PDF session it opens', async t => {
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
  const openSessions = () => page.evaluate(async () => {
    const { getOpenSessionCount } = await import('/src/utils/pdfUtils.ts');
    return getOpenSessionCount();
  });

  assert.equal(await openSessions(), 0);

  await page.getByRole('button', { name: 'Use sample files' }).click();
  await page.getByRole('heading', { name: 'Comparison results' }).waitFor();
  assert.equal(await openSessions(), 2, 'a comparison holds exactly one session per side');

  // Replacing a side must destroy the session it replaces.
  await page.locator('#file-input-original-pdf').setInputFiles('public/demo-modified.pdf');
  await page.locator('.processing-indicator').waitFor({ state: 'hidden' });
  await page.waitForFunction(async () => {
    const { getOpenSessionCount } = await import('/src/utils/pdfUtils.ts');
    return getOpenSessionCount() === 2;
  });

  await page.getByRole('button', { name: 'Clear both files' }).click();
  await page.waitForFunction(async () => {
    const { getOpenSessionCount } = await import('/src/utils/pdfUtils.ts');
    return getOpenSessionCount() === 0;
  });

  // A selection cancelled mid-flight must not leave its session behind.
  await page.evaluate(async () => {
    const arrayBuffer = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      if (this.name !== 'slow.pdf') return arrayBuffer.call(this);
      return new Promise(resolve => setTimeout(resolve, 400)).then(() => arrayBuffer.call(this));
    };

    const response = await fetch('/demo-original.pdf');
    const file = new File([await response.blob()], 'slow.pdf', { type: 'application/pdf' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.querySelector('#file-input-original-pdf');
    if (!(input instanceof HTMLInputElement)) throw new Error('Original PDF input was not found');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Clear both files' }).click();
  await page.waitForTimeout(900);
  assert.equal(await openSessions(), 0, 'a cancelled load must not leak its session');

  assert.deepEqual(browserErrors, []);
});
