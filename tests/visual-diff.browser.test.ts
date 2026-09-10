import assert from 'node:assert/strict';
import test from 'node:test';

import { launchChromium, startDevServer } from './helpers/browser.ts';

test('browser exact page rendering and comparison', async t => {
  const server = await startDevServer();
  t.after(() => server.close());

  const browser = await launchChromium();
  t.after(() => browser.close());
  const page = await browser.newPage();
  const browserErrors: string[] = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('console', message => {
    // Fetching the deliberately revoked object URL below logs a load failure.
    if (message.type() === 'error' && !message.text().includes('ERR_FILE_NOT_FOUND')) {
      browserErrors.push(message.text());
    }
  });

  await page.goto(server.baseUrl);

  const result = await page.evaluate(async () => {
    const { openPdfSession } = await import('/src/utils/pdfUtils.ts');
    const { compareRenderedPages } = await import('/src/utils/visualPageRenderer.ts');

    const load = async (name: string) => {
      const response = await fetch(`/${name}`);
      if (!response.ok) throw new Error(`${name} request failed: ${response.status}`);
      return openPdfSession(new File([await response.blob()], name, { type: 'application/pdf' }));
    };

    const original = await load('demo-original.pdf');
    const modified = await load('demo-modified.pdf');

    try {
      const changed = await compareRenderedPages(
        { session: original, pageNumber: 1 },
        { session: modified, pageNumber: 1 },
        { mode: 'exact', maxPixels: 400_000 }
      );
      const identical = await compareRenderedPages(
        { session: original, pageNumber: 1 },
        { session: original, pageNumber: 1 },
        { mode: 'exact', maxPixels: 400_000 }
      );
      const oneSided = await compareRenderedPages(
        null,
        { session: modified, pageNumber: 2 },
        { mode: 'exact', maxPixels: 400_000 }
      );

      const overlayUrl = changed.images.overlay ?? '';
      const overlayBlobSize = overlayUrl
        ? (await (await fetch(overlayUrl)).blob()).size
        : 0;

      changed.release();
      identical.release();
      oneSided.release();
      const revokedOverlayFailed = await fetch(overlayUrl).then(() => false, () => true);

      const aborter = new AbortController();
      aborter.abort();
      let abortName = '';
      try {
        await compareRenderedPages(
          { session: original, pageNumber: 1 },
          { session: modified, pageNumber: 1 },
          { signal: aborter.signal }
        );
      } catch (error) {
        abortName = error instanceof Error ? error.name : String(error);
      }

      return {
        changed: {
          status: changed.diff.status,
          engineVersion: changed.diff.engineVersion,
          raster: changed.diff.raster,
          changeRatio: changed.diff.changeRatio,
          regionCount: changed.diff.regions.length,
          regionKinds: [...new Set(changed.diff.regions.map(region => region.kind))].sort(),
          hasMask: 'mask' in changed.diff,
          diagnostics: changed.diff.diagnostics.map(diagnostic => diagnostic.code),
          hasImages: Boolean(changed.images.original && changed.images.modified),
          scale: changed.scale,
        },
        identicalStatus: identical.diff.status,
        identicalChangedPixels: identical.diff.changedPixels,
        oneSided: {
          status: oneSided.diff.status,
          diagnostics: oneSided.diff.diagnostics.map(diagnostic => diagnostic.code),
          hasOriginalImage: oneSided.images.original !== null,
          hasOverlay: oneSided.images.overlay !== null,
        },
        overlayBlobSize,
        revokedOverlayFailed,
        abortName,
      };
    } finally {
      await original.destroy();
      await modified.destroy();
    }
  });

  assert.equal(result.changed.status, 'different');
  assert.equal(result.changed.engineVersion, 'visual-v1');
  assert.ok(result.changed.raster.width > 0 && result.changed.raster.height > 0);
  assert.ok(
    result.changed.raster.width * result.changed.raster.height <= 400_000,
    'the render budget must be respected'
  );
  assert.ok(result.changed.changeRatio > 0);
  assert.ok(result.changed.changeRatio < 0.5, 'the demo pages share most of their pixels');
  assert.ok(result.changed.regionCount > 0);
  assert.ok(result.changed.regionKinds.length > 0);
  assert.equal(result.changed.hasMask, false, 'the pixel mask must not escape the adapter');
  assert.deepEqual(result.changed.diagnostics, []);
  assert.equal(result.changed.hasImages, true);
  assert.ok(result.changed.scale > 0);
  assert.ok(result.overlayBlobSize > 1_000);

  assert.equal(result.identicalStatus, 'equal');
  assert.equal(result.identicalChangedPixels, 0);

  assert.equal(result.oneSided.status, 'different');
  assert.deepEqual(result.oneSided.diagnostics, ['page-added']);
  assert.equal(result.oneSided.hasOriginalImage, false);
  assert.equal(result.oneSided.hasOverlay, true);

  assert.equal(result.revokedOverlayFailed, true, 'release() must revoke its object URLs');
  assert.equal(result.abortName, 'AbortError');
  assert.deepEqual(browserErrors, []);
});

test('reflow-aware comparison separates edits from displacement', async t => {
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

  const result = await page.evaluate(async () => {
    const { openPdfSession } = await import('/src/utils/pdfUtils.ts');
    const { compareRenderedPages } = await import('/src/utils/visualPageRenderer.ts');

    const load = async (name: string) => {
      const response = await fetch(`/tests/fixtures/${name}.pdf`);
      if (!response.ok) throw new Error(`${name} request failed: ${response.status}`);
      return openPdfSession(new File([await response.blob()], `${name}.pdf`, {
        type: 'application/pdf',
      }));
    };

    const compare = async (originalName: string, modifiedName: string) => {
      const original = await load(originalName);
      const modified = await load(modifiedName);
      try {
        const exact = await compareRenderedPages(
          { session: original, pageNumber: 1 },
          { session: modified, pageNumber: 1 },
          { mode: 'exact' }
        );
        const aligned = await compareRenderedPages(
          { session: original, pageNumber: 1 },
          { session: modified, pageNumber: 1 },
          { mode: 'aligned' }
        );
        const summary = {
          exactChangedPixels: exact.diff.changedPixels,
          exactMode: exact.mode,
          alignedMode: aligned.mode,
          alignedChangedPixels: aligned.diff.changedPixels,
          status: aligned.diff.status,
          bandCounts: 'bandCounts' in aligned.diff ? aligned.diff.bandCounts : null,
          regions: aligned.diff.regions.length,
          removedRegions: 'removedRegions' in aligned.diff ? aligned.diff.removedRegions.length : -1,
          hasMasks: 'masks' in aligned.diff,
          hasOriginalOverlay: aligned.images.originalOverlay !== null,
          hasOverlay: aligned.images.overlay !== null,
        };
        exact.release();
        aligned.release();
        return summary;
      } finally {
        await original.destroy();
        await modified.destroy();
      }
    };

    return {
      reflow: await compare('reflow-original', 'reflow-modified'),
      scan: await compare('scan-original', 'scan-modified'),
    };
  });

  const { reflow } = result;
  assert.equal(reflow.exactMode, 'exact');
  assert.equal(reflow.alignedMode, 'aligned');
  assert.equal(reflow.status, 'different');
  assert.equal(reflow.hasMasks, false, 'the pixel masks must not escape the adapter');

  // One line was inserted and one word was edited; everything else only moved.
  assert.deepEqual(reflow.bandCounts && {
    added: reflow.bandCounts.added,
    removed: reflow.bandCounts.removed,
    changed: reflow.bandCounts.changed,
  }, { added: 1, removed: 0, changed: 1 });
  assert.ok(
    (reflow.bandCounts?.moved ?? 0) >= 5,
    'the lines below the insertion must be reported as moved, not changed'
  );
  assert.ok(
    reflow.alignedChangedPixels * 5 < reflow.exactChangedPixels,
    `aligned found ${reflow.alignedChangedPixels} of the exact comparison's ${reflow.exactChangedPixels} changed pixels`
  );
  assert.equal(reflow.hasOverlay, true);
  assert.equal(reflow.hasOriginalOverlay, true);

  // A scanned page has no text layer at all, so this is the only verdict
  // available for it.
  assert.equal(result.scan.status, 'different');
  assert.ok(result.scan.regions > 0);
  assert.ok(result.scan.removedRegions > 0);

  assert.deepEqual(browserErrors, []);
});
