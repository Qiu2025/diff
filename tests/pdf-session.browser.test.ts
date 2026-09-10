import assert from 'node:assert/strict';
import test from 'node:test';

import { launchChromium, startDevServer } from './helpers/browser.ts';

test('browser PdfSession and sample comparison flow', async t => {
  const server = await startDevServer();
  t.after(() => server.close());

  const { baseUrl } = server;
  const browser = await launchChromium();
  t.after(() => browser.close());
  const page = await browser.newPage();
  const browserErrors: string[] = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });

  await page.goto(baseUrl);
  const sessionResult = await page.evaluate(async () => {
    const { openPdfSession } = await import('/src/utils/pdfUtils.ts');
    const response = await fetch('/demo-original.pdf');
    if (!response.ok) throw new Error(`Demo PDF request failed: ${response.status}`);

    const file = new File([await response.blob()], 'demo-original.pdf', {
      type: 'application/pdf',
    });
    const session = await openPdfSession(file);
    const pageOne = await session.extractPage(1);
    const canvas = document.createElement('canvas');
    await session.renderPageToCanvas(1, canvas, 0.5);

    const controller = new AbortController();
    controller.abort();
    let abortName = '';
    try {
      await session.extractPage(1, controller.signal);
    } catch (error) {
      abortName = error instanceof Error ? error.name : String(error);
    }

    await session.destroy();
    await session.destroy();
    let destroyedMessage = '';
    try {
      await session.extractPage(1);
    } catch (error) {
      destroyedMessage = error instanceof Error ? error.message : String(error);
    }

    return {
      totalPages: session.totalPages,
      text: pageOne.text,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      imageLength: canvas.toDataURL().length,
      abortName,
      destroyedMessage,
    };
  });

  assert.equal(sessionResult.totalPages, 2);
  assert.match(sessionResult.text, /Version 1\.0/);
  assert.ok(sessionResult.canvasWidth > 0);
  assert.ok(sessionResult.canvasHeight > 0);
  assert.ok(sessionResult.imageLength > 1_000);
  assert.equal(sessionResult.abortName, 'AbortError');
  assert.equal(sessionResult.destroyedMessage, 'PDF session has been destroyed.');

  await page.getByRole('button', { name: 'Use sample files' }).click();
  await page.getByRole('heading', { name: 'Comparison results' }).waitFor();
  await assert.doesNotReject(() => page.getByText('1 of 2', { exact: true }).waitFor());
  assert.equal(await page.getByText('demo-original.pdf', { exact: true }).count(), 1);
  assert.equal(await page.getByText('demo-modified.pdf', { exact: true }).count(), 1);
  await page.getByRole('button', { name: 'Next page' }).click();
  await assert.doesNotReject(() => page.getByText('2 of 2', { exact: true }).waitFor());
  await assert.doesNotReject(() => page.getByText('7. Privacy', { exact: true }).first().waitFor());

  await page.getByRole('button', { name: 'Clear both files' }).click();
  await page.evaluate(async () => {
    const arrayBuffer = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      if (this.name !== 'slow.pdf') return arrayBuffer.call(this);
      return new Promise(resolve => setTimeout(resolve, 700))
        .then(() => arrayBuffer.call(this));
    };

    const [slowResponse, fastResponse] = await Promise.all([
      fetch('/demo-original.pdf'),
      fetch('/demo-modified.pdf'),
    ]);
    const slowFile = new File([await slowResponse.blob()], 'slow.pdf', { type: 'application/pdf' });
    const fastFile = new File([await fastResponse.blob()], 'fast.pdf', { type: 'application/pdf' });
    const input = document.querySelector('#file-input-original-pdf');
    if (!(input instanceof HTMLInputElement)) throw new Error('Original PDF input was not found');

    for (const file of [slowFile, fastFile]) {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  });
  await page.getByText('fast.pdf', { exact: true }).waitFor();
  await page.locator('.processing-indicator').waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('alert').count(), 0);
  await page.locator('#file-input-modified-pdf').setInputFiles('public/demo-modified.pdf');
  await page.getByText('demo-modified.pdf', { exact: true }).waitFor();
  await page.locator('.processing-indicator').waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('alert').count(), 0);
  await page.getByRole('heading', { name: 'Comparison results' }).waitFor();
  await page.waitForTimeout(800);
  assert.equal(await page.getByText('fast.pdf', { exact: true }).count(), 1);
  await assert.doesNotReject(() => page.getByText('0.0%', { exact: true }).waitFor());

  await page.getByRole('button', { name: 'Clear both files' }).click();
  await page.evaluate(async () => {
    const response = await fetch('/demo-original.pdf');
    const file = new File([await response.blob()], 'slow.pdf', { type: 'application/pdf' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.querySelector('#file-input-original-pdf');
    if (!(input instanceof HTMLInputElement)) throw new Error('Original PDF input was not found');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 20));
  });
  await page.getByRole('button', { name: 'Clear both files' }).click();
  await page.waitForTimeout(800);
  assert.equal(await page.getByText('Choose a PDF', { exact: true }).count(), 2);
  assert.equal(await page.getByRole('heading', { name: 'Comparison results' }).count(), 0);
  assert.deepEqual(browserErrors, []);
});
