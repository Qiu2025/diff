/**
 * Generates the deterministic regression corpus in `tests/fixtures/`.
 *
 * These are not demo documents: each one isolates a case the comparison engine
 * has to get right. Regenerate with `npm run generate-fixtures` and commit the
 * result, so `npm test` never depends on generation.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { jsPDF } from 'jspdf';
import sharp from 'sharp';

const outputDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../tests/fixtures');

/** Fixed creation metadata keeps regenerated fixtures byte-stable. */
function createDocument(options = {}, id = 1) {
  const doc = new jsPDF(options);
  doc.setCreationDate("D:20250101000000+00'00'");
  doc.setFileId(String(id).padStart(32, '0'));
  return doc;
}

function write(doc, name) {
  fs.writeFileSync(path.join(outputDir, name), Buffer.from(doc.output('arraybuffer')));
  console.log(`Created ${name}`);
}

const BODY = [
  'Section 1. Definitions',
  'The Supplier means the party providing the services described below.',
  'The Customer means the party receiving those services.',
  'Section 2. Charges',
  'Charges are payable within thirty days of the invoice date.',
  'Late payment accrues interest at two percent per month.',
  'Section 3. Term',
  'This agreement runs for twelve months from the effective date.',
  'Either party may terminate on sixty days written notice.',
  'Section 4. Confidentiality',
  'Each party shall keep the other party confidential information secret.',
  'This obligation survives termination of the agreement.',
];

/**
 * A pure reflow case: the modified document inserts one line near the top and
 * edits one word far below it. Everything after the insertion moves down by a
 * single line, which an exact pixel comparison reports as a whole-page change.
 */
function reflowPair() {
  const render = (doc, lines) => {
    doc.setFontSize(14);
    doc.text('Service Agreement', 20, 20);
    doc.setFontSize(11);
    let y = 35;
    for (const line of lines) {
      doc.text(line, 20, y);
      y += 9;
    }
  };

  const original = createDocument({}, 11);
  render(original, BODY);
  write(original, 'reflow-original.pdf');

  const modified = createDocument({}, 12);
  const changed = [...BODY];
  changed.splice(3, 0, 'The Services means the work set out in the statement of work.');
  changed[changed.indexOf('Late payment accrues interest at two percent per month.')] =
    'Late payment accrues interest at four percent per month.';
  render(modified, changed);
  write(modified, 'reflow-modified.pdf');
}

/** Deterministic pseudo-random source, so regenerated scans stay identical. */
function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/**
 * Builds a grayscale raster that looks like a scanned page: paper-coloured
 * background, sensor noise, and blocks of "text" with no text layer at all.
 */
async function scanImage({ width, height, seed, edit }) {
  const random = createRandom(seed);
  const pixels = Buffer.alloc(width * height);
  const blockSize = 4;

  // Blocky, few-level noise keeps the fixture small enough to commit while
  // still denying the comparison a perfectly flat background.
  for (let blockY = 0; blockY < height; blockY += blockSize) {
    for (let blockX = 0; blockX < width; blockX += blockSize) {
      const shade = 238 + Math.floor(random() * 4) * 3;
      for (let y = blockY; y < blockY + blockSize && y < height; y += 1) {
        pixels.fill(shade, y * width + blockX, y * width + Math.min(blockX + blockSize, width));
      }
    }
  }

  const inkRow = (top, left, right, weight) => {
    for (let y = top; y < top + weight && y < height; y += 1) {
      pixels.fill(55, y * width + left, y * width + Math.min(right, width));
    }
  };

  for (let line = 0; line < 18; line += 1) {
    const top = 40 + line * 22;
    const right = 60 + Math.floor(random() * (width - 120));
    inkRow(top, 40, right, 7);
  }

  if (edit) {
    // A localized change, as if one figure on the page had been altered.
    for (let y = 210; y < 232; y += 1) {
      pixels.fill(20, y * width + 60, y * width + 200);
    }
  }

  return sharp(pixels, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

/**
 * A page whose only content is a raster image. The text layer must report this
 * as indeterminate; only the visual layer can decide it.
 */
async function scanPair() {
  for (const [name, edit, id] of [['scan-original.pdf', false, 21], ['scan-modified.pdf', true, 22]]) {
    const png = await scanImage({ width: 496, height: 640, seed: 20250101, edit });
    // jsPDF embeds image data uncompressed unless the document is compressed.
    const doc = createDocument({ compress: true }, id);
    doc.addImage(`data:image/png;base64,${png.toString('base64')}`, 'PNG', 10, 10, 190, 245);
    write(doc, name);
  }
}

/** The same content on two paper sizes, which must not read as a text change. */
function paperSizePair() {
  for (const [name, format, id] of [['letter.pdf', 'letter', 31], ['a4.pdf', 'a4', 32]]) {
    const doc = createDocument({ format }, id);
    doc.setFontSize(14);
    doc.text('Service Agreement', 20, 20);
    doc.setFontSize(11);
    let y = 35;
    for (const line of BODY.slice(0, 6)) {
      doc.text(line, 20, y);
      y += 9;
    }
    write(doc, name);
  }
}

/** A landscape page, so page geometry is not always portrait in the corpus. */
function landscapePage() {
  const doc = createDocument({ orientation: 'landscape' }, 41);
  doc.setFontSize(14);
  doc.text('Service Agreement (landscape)', 20, 20);
  doc.setFontSize(11);
  doc.text(BODY[1], 20, 35);
  write(doc, 'landscape.pdf');
}

/** A file truncated mid-stream, to keep failure handling honest. */
function damagedFile() {
  const doc = createDocument({}, 51);
  doc.text('This file is deliberately truncated.', 20, 20);
  const bytes = Buffer.from(doc.output('arraybuffer'));
  const truncated = bytes.subarray(0, Math.floor(bytes.length * 0.6));
  fs.writeFileSync(path.join(outputDir, 'damaged.pdf'), truncated);
  console.log('Created damaged.pdf');
}

fs.mkdirSync(outputDir, { recursive: true });
reflowPair();
await scanPair();
paperSizePair();
landscapePage();
damagedFile();
console.log('Fixture corpus generated.');
