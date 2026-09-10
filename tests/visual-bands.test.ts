import assert from 'node:assert/strict';
import test from 'node:test';

import { compareRasters, type RasterImage } from '../src/utils/visualDiff.ts';
import {
  compareAlignedRasters,
  describeAlignedStatus,
  extractBands,
} from '../src/utils/visualBands.ts';

const WIDTH = 160;
const HEIGHT = 320;

function blankPage(width = WIDTH, height = HEIGHT): RasterImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) };
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

/** Draws bars of the given widths as evenly spaced "lines of text". */
function page(lines: { width: number; colour?: [number, number, number] }[], top = 10): RasterImage {
  const image = blankPage();
  lines.forEach((line, index) => {
    paint(image, 10, top + index * 20, line.width, 8, line.colour);
  });
  return image;
}

test('bands are found one per line of content', () => {
  const bands = extractBands(page([{ width: 100 }, { width: 80 }, { width: 120 }]));

  assert.equal(bands.length, 3);
  assert.deepEqual(bands.map(band => band.top), [10, 30, 50]);
  assert.deepEqual(bands.map(band => band.height), [8, 8, 8]);
  assert.ok(bands.every(band => band.inkPixels > 0));
});

test('an inserted line does not make the rest of the page look changed', () => {
  const body = [60, 100, 80, 120, 90, 110, 70, 130, 85, 95, 105].map(width => ({ width }));
  const original = page(body);
  const modified = page([body[0], { width: 140 }, ...body.slice(1)]);

  const exact = compareRasters(original, modified);
  const aligned = compareAlignedRasters(original, modified);

  // These bars sit on a uniform pitch, so shifting them by one line lands each
  // one on its neighbour's slot and the exact comparison only sees the width
  // differences. The size of the win on real text is measured in the Chromium
  // test against the reflow fixture; what this case pins down is the
  // classification.
  assert.equal(exact.status, 'different');
  assert.ok(exact.changedPixels > aligned.changedPixels);

  assert.equal(aligned.status, 'different');
  assert.equal(aligned.bandCounts.added, 1);
  assert.equal(aligned.bandCounts.removed, 0);
  assert.equal(aligned.bandCounts.changed, 0);
  assert.equal(aligned.bandCounts.equal, 1);
  assert.equal(aligned.bandCounts.moved, body.length - 1);
  assert.equal(aligned.changedPixels, 140 * 8, 'only the inserted line counts as changed');
  assert.equal(describeAlignedStatus(aligned), '1 added line, 10 unchanged but moved');
});

test('a removed line is reported on the original page', () => {
  const original = page([{ width: 100 }, { width: 140 }, { width: 80 }]);
  const modified = page([{ width: 100 }, { width: 80 }]);
  const aligned = compareAlignedRasters(original, modified);

  assert.equal(aligned.bandCounts.removed, 1);
  assert.equal(aligned.bandCounts.added, 0);
  assert.equal(aligned.removedRegions.length, 1);
  assert.equal(aligned.removedRegions[0].kind, 'removed');
  assert.equal(aligned.regions.length, 0, 'nothing was added to the modified page');
});

test('an edited line is reported as edited, not as an add plus a remove', () => {
  const original = page([{ width: 100 }, { width: 80 }, { width: 120 }]);
  const modified = page([{ width: 100 }, { width: 88 }, { width: 120 }]);
  const aligned = compareAlignedRasters(original, modified);

  assert.equal(aligned.bandCounts.changed, 1);
  assert.equal(aligned.bandCounts.added, 0);
  assert.equal(aligned.bandCounts.removed, 0);
  assert.equal(aligned.bandCounts.equal, 2);
  assert.equal(aligned.changedPixels, 8 * 8);
  assert.match(describeAlignedStatus(aligned), /1 edited line/);
});

test('identical pages report no change and no moved content', () => {
  const lines = [{ width: 100 }, { width: 80 }, { width: 120 }];
  const aligned = compareAlignedRasters(page(lines), page(lines));

  assert.equal(aligned.status, 'equal');
  assert.equal(aligned.changedPixels, 0);
  assert.equal(aligned.inkChangeRatio, 0);
  assert.equal(aligned.bandCounts.equal, 3);
  assert.equal(aligned.bandCounts.moved, 0);
  assert.equal(describeAlignedStatus(aligned), 'Pages render identically');
});

test('content that only moved is called moved, not changed', () => {
  const lines = [{ width: 100 }, { width: 80 }];
  const aligned = compareAlignedRasters(page(lines, 10), page(lines, 40));

  assert.equal(aligned.status, 'equal');
  assert.equal(aligned.changedPixels, 0);
  assert.equal(aligned.bandCounts.moved, 2);
  assert.equal(aligned.bands[0].shift, 30);
  assert.equal(describeAlignedStatus(aligned), 'Same content, moved on the page');
});

test('a dark page is banded against its own background, not against white', () => {
  const dark = (extra: number) => {
    const image: RasterImage = {
      width: WIDTH,
      height: HEIGHT,
      data: new Uint8ClampedArray(WIDTH * HEIGHT * 4),
    };
    for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel += 1) {
      const offset = pixel * 4;
      image.data[offset] = 30;
      image.data[offset + 1] = 30;
      image.data[offset + 2] = 30;
      image.data[offset + 3] = 255;
    }
    // Light "text" on a dark page still has to read as content.
    paint(image, 10, 10, 100, 8, [240, 240, 240]);
    paint(image, 10, 30, extra, 8, [240, 240, 240]);
    return image;
  };

  const bands = extractBands(dark(80));
  assert.equal(bands.length, 2);

  const aligned = compareAlignedRasters(dark(80), dark(100));
  assert.equal(aligned.bandCounts.changed, 1);
  assert.equal(aligned.bandCounts.equal, 1);
});

test('missing sides stay whole-page results', () => {
  const added = compareAlignedRasters(null, page([{ width: 100 }]));
  assert.equal(added.status, 'different');
  assert.equal(added.bandCounts.added, 1);
  assert.equal(added.regions.length, 1);
  assert.equal(added.removedRegions.length, 0);
  assert.deepEqual(added.diagnostics.map(entry => entry.code), ['page-added']);

  const removed = compareAlignedRasters(page([{ width: 100 }]), null);
  assert.equal(removed.bandCounts.removed, 1);
  assert.equal(removed.removedRegions.length, 1);
  assert.equal(removed.regions.length, 0);

  const neither = compareAlignedRasters(null, null);
  assert.equal(neither.status, 'indeterminate');
  assert.equal(describeAlignedStatus(neither), 'Visual comparison unavailable');
});

test('mismatched raster sizes stay indeterminate', () => {
  const aligned = compareAlignedRasters(blankPage(WIDTH, HEIGHT), blankPage(WIDTH, HEIGHT + 1));

  assert.equal(aligned.status, 'indeterminate');
  assert.deepEqual(aligned.diagnostics.map(entry => entry.code), ['raster-size-mismatch']);
});

test('masks are produced only on request and cover both pages', () => {
  const original = page([{ width: 100 }, { width: 140 }]);
  const modified = page([{ width: 100 }]);

  assert.equal(compareAlignedRasters(original, modified).masks, undefined);
  const aligned = compareAlignedRasters(original, modified, { includeMasks: true });
  assert.ok(aligned.masks);
  assert.equal(aligned.masks?.original.length, WIDTH * HEIGHT);
  assert.equal(aligned.masks?.modified.length, WIDTH * HEIGHT);
  assert.ok(aligned.masks && aligned.masks.original.some(value => value !== 0));
  assert.ok(aligned.masks && aligned.masks.modified.every(value => value === 0));
});

test('a page with too many bands falls back to exact comparison', () => {
  const many = (offset: number) => {
    const image = blankPage(WIDTH, 620);
    for (let line = 0; line < 100; line += 1) paint(image, 10, line * 6 + offset, 100, 2);
    return image;
  };
  const aligned = compareAlignedRasters(many(0), many(0), { maxBands: 10 });

  assert.equal(aligned.status, 'equal');
  assert.deepEqual(aligned.diagnostics.map(entry => entry.code), ['region-budget-exceeded']);
  assert.match(aligned.diagnostics[0].message, /exact comparison/);
});
