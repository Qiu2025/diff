import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VISUAL_MASK,
  compareRasters,
  describeVisualStatus,
  withDiagnostic,
  type RasterImage,
} from '../src/utils/visualDiff.ts';

function blankPage(width: number, height: number): RasterImage {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  return { width, height, data };
}

function paint(
  image: RasterImage,
  x: number,
  y: number,
  width: number,
  height: number,
  colour: [number, number, number] = [0, 0, 0]
): RasterImage {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      const offset = (row * image.width + column) * 4;
      image.data[offset] = colour[0];
      image.data[offset + 1] = colour[1];
      image.data[offset + 2] = colour[2];
      image.data[offset + 3] = 255;
    }
  }
  return image;
}

test('identical rasters compare as equal', () => {
  const diff = compareRasters(paint(blankPage(64, 64), 8, 8, 16, 16), paint(blankPage(64, 64), 8, 8, 16, 16));

  assert.equal(diff.status, 'equal');
  assert.equal(diff.changedPixels, 0);
  assert.equal(diff.changeRatio, 0);
  assert.deepEqual(diff.regions, []);
  assert.deepEqual(diff.diagnostics, []);
  assert.equal(describeVisualStatus(diff), 'Pages render identically');
});

test('added content is located and classified', () => {
  const original = blankPage(64, 64);
  const modified = paint(blankPage(64, 64), 16, 32, 16, 8);
  const diff = compareRasters(original, modified);

  assert.equal(diff.status, 'different');
  assert.equal(diff.changedPixels, 16 * 8);
  assert.equal(diff.comparedPixels, 64 * 64);
  assert.equal(diff.regions.length, 1);

  const [region] = diff.regions;
  assert.equal(region.kind, 'added');
  // The region grid is coarse, so the box must contain the change without
  // drifting far from it.
  assert.ok(region.x <= 16 / 64 && region.x >= 8 / 64);
  assert.ok(region.y <= 32 / 64 && region.y >= 24 / 64);
  assert.ok(region.x + region.width >= 32 / 64);
  assert.ok(region.y + region.height >= 40 / 64);
});

test('removed content is classified separately from added content', () => {
  const original = paint(blankPage(64, 64), 4, 4, 8, 8);
  const modified = paint(blankPage(64, 64), 48, 48, 8, 8);
  const diff = compareRasters(original, modified, { includeMask: true });

  assert.equal(diff.status, 'different');
  assert.equal(diff.regions.length, 2);
  assert.deepEqual(
    diff.regions.map(region => region.kind).sort(),
    ['added', 'removed']
  );
  assert.ok(diff.mask);
  assert.equal(diff.mask?.[(6 * 64) + 6], VISUAL_MASK.removed);
  assert.equal(diff.mask?.[(50 * 64) + 50], VISUAL_MASK.added);
  assert.equal(diff.mask?.[(30 * 64) + 30], VISUAL_MASK.same);
});

test('a colour change with matching darkness is reported as recoloured', () => {
  const original = paint(blankPage(64, 64), 8, 8, 16, 16, [200, 0, 0]);
  const modified = paint(blankPage(64, 64), 8, 8, 16, 16, [0, 70, 164]);
  const diff = compareRasters(original, modified);

  assert.equal(diff.status, 'different');
  assert.equal(diff.regions.length, 1);
  assert.equal(diff.regions[0].kind, 'recoloured');
});

test('the mask is omitted unless requested', () => {
  const diff = compareRasters(blankPage(32, 32), paint(blankPage(32, 32), 1, 1, 8, 8));

  assert.equal(diff.mask, undefined);
});

test('sub-threshold noise does not count as a change', () => {
  const original = paint(blankPage(32, 32), 4, 4, 8, 8, [250, 250, 250]);
  const modified = paint(blankPage(32, 32), 4, 4, 8, 8, [248, 248, 248]);
  const diff = compareRasters(original, modified);

  assert.equal(diff.status, 'equal');
  assert.equal(diff.changedPixels, 0);
});

test('isolated specks stay out of the reported regions', () => {
  const original = blankPage(64, 64);
  const modified = paint(blankPage(64, 64), 30, 30, 1, 1);
  const diff = compareRasters(original, modified);

  assert.equal(diff.status, 'different');
  assert.equal(diff.changedPixels, 1);
  assert.deepEqual(diff.regions, []);
});

test('a missing side is a whole-page change, not an unknown result', () => {
  const added = compareRasters(null, blankPage(32, 32));
  assert.equal(added.status, 'different');
  assert.equal(added.changeRatio, 1);
  assert.equal(added.regions[0].kind, 'added');
  assert.equal(added.diagnostics[0].code, 'page-added');

  const removed = compareRasters(blankPage(32, 32), null);
  assert.equal(removed.status, 'different');
  assert.equal(removed.regions[0].kind, 'removed');
  assert.equal(removed.diagnostics[0].code, 'page-removed');

  const neither = compareRasters(null, null);
  assert.equal(neither.status, 'indeterminate');
  assert.equal(neither.diagnostics[0].code, 'both-sides-missing');
});

test('mismatched raster sizes are indeterminate rather than different', () => {
  const diff = compareRasters(blankPage(32, 32), blankPage(32, 33));

  assert.equal(diff.status, 'indeterminate');
  assert.equal(diff.comparedPixels, 0);
  assert.equal(diff.diagnostics[0].code, 'raster-size-mismatch');
  assert.equal(describeVisualStatus(diff), 'Visual comparison unavailable');
});

test('transparent pixels are composited onto the page background', () => {
  const opaqueWhite = blankPage(16, 16);
  const transparent: RasterImage = {
    width: 16,
    height: 16,
    data: new Uint8ClampedArray(16 * 16 * 4),
  };
  const diff = compareRasters(opaqueWhite, transparent);

  assert.equal(diff.status, 'equal');
});

test('the region budget is enforced and reported', () => {
  const original = blankPage(256, 256);
  const modified = blankPage(256, 256);
  for (let index = 0; index < 12; index += 1) {
    const x = (index % 4) * 64 + 8;
    const y = Math.floor(index / 4) * 64 + 8;
    paint(modified, x, y, 16, 16);
  }
  const diff = compareRasters(original, modified, { maxRegions: 5 });

  assert.equal(diff.regions.length, 5);
  assert.equal(diff.diagnostics[0].code, 'region-budget-exceeded');
});

test('nearby changes merge into one region', () => {
  const original = blankPage(128, 128);
  const modified = blankPage(128, 128);
  paint(modified, 16, 16, 8, 8);
  paint(modified, 28, 16, 8, 8);
  const diff = compareRasters(original, modified);

  assert.equal(diff.regions.length, 1);
});

test('diagnostics can be appended without mutating the result', () => {
  const diff = compareRasters(blankPage(16, 16), blankPage(16, 16));
  const annotated = withDiagnostic(diff, { code: 'page-size-mismatch', message: 'Different paper size.' });

  assert.equal(diff.diagnostics.length, 0);
  assert.equal(annotated.diagnostics.length, 1);
  assert.equal(annotated.status, 'equal');
});

test('the change summary rounds small differences honestly', () => {
  const original = blankPage(1000, 100);
  const modified = blankPage(1000, 100);
  paint(modified, 0, 0, 10, 1);

  assert.equal(describeVisualStatus(compareRasters(original, modified)), '<0.1% of rendered pixels differ');
});
