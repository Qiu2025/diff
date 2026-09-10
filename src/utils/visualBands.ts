/**
 * Reflow-aware comparison of two rendered PDF pages.
 *
 * Exact pixel comparison answers "do these two pages look the same", which is
 * the wrong question for a document review: inserting one line moves every
 * later line, and an exact comparison then reports most of the page as changed.
 *
 * This module segments each render into horizontal bands of content, matches
 * the bands between the two versions, and compares matched bands where they
 * actually sit on each page. What survives is content that was really added,
 * removed, or edited, separated from content that merely moved.
 *
 * Runtime-neutral: no DOM, Canvas, or Node APIs.
 */

import {
  VISUAL_MASK,
  compareRowRange,
  extractRegions,
  luminance,
  overWhite,
  round6,
  thresholdDeltaFor,
} from './raster.ts';
import type { RasterImage, VisualRegion } from './raster.ts';
import { alignSequences } from './sequenceAlignment.ts';
import {
  VISUAL_DEFAULTS,
  missingSideDiff,
  sizeMismatchDiagnostic,
} from './visualDiff.ts';
import type { VisualDiagnostic, VisualDiffOptions, VisualStatus } from './visualDiff.ts';

export interface RasterBand {
  top: number;
  height: number;
  inkPixels: number;
  /** Normalized horizontal ink distribution, used to match bands. */
  profile: Float64Array;
}

export type BandStatus = 'equal' | 'moved' | 'changed' | 'added' | 'removed';

export interface BandChange {
  status: BandStatus;
  /** Band position on the original page, in normalized [0, 1] coordinates. */
  original: { top: number; height: number } | null;
  modified: { top: number; height: number } | null;
  /** Vertical displacement in raster pixels, positive when content moved down. */
  shift: number | null;
  similarity: number | null;
  changedPixels: number;
}

export interface AlignedPageDiff {
  engineVersion: 'visual-bands-v1';
  status: VisualStatus;
  raster: { width: number; height: number };
  /** Pixels that differ once vertical displacement has been removed. */
  changedPixels: number;
  comparedPixels: number;
  changeRatio: number;
  /** Changed share of the content (ink) rather than of the whole page. */
  inkChangeRatio: number;
  bandCounts: Record<BandStatus, number>;
  bands: BandChange[];
  /** Changed and added areas, in modified-page coordinates. */
  regions: VisualRegion[];
  /** Removed areas, in original-page coordinates. */
  removedRegions: VisualRegion[];
  masks?: { original: Uint8Array; modified: Uint8Array };
  diagnostics: VisualDiagnostic[];
}

export interface BandOptions {
  /** Ink pixels a row needs, as a share of raster width, to count as content. */
  minRowInkRatio?: number;
  /** Blank rows tolerated inside one band. */
  mergeGap?: number;
  /** Rows a band needs before it is kept. */
  minBandHeight?: number;
  /** Bands beyond this count make alignment too expensive to be worthwhile. */
  maxBands?: number;
}

export interface AlignedDiffOptions extends VisualDiffOptions, BandOptions {
  /** Include the per-pixel masks in the result. */
  includeMasks?: boolean;
}

export const BAND_DEFAULTS = {
  minRowInkRatio: 0.001,
  mergeGap: 2,
  minBandHeight: 2,
  maxBands: 400,
} satisfies Required<BandOptions>;

/** Buckets in a band's horizontal ink profile. */
const PROFILE_BUCKETS = 64;

/** How far from the page background a pixel must be to count as ink. */
const INK_CONTRAST = 45;

/** Similarity two bands need before they are treated as the same content. */
const MIN_BAND_SIMILARITY = 0.65;

/**
 * Finds the page background by taking the most common luminance.
 *
 * Assuming white would misread scans, which sit at a paper tone, and inverted
 * or coloured pages, which have no white at all.
 */
function backgroundLuminance(image: RasterImage): number {
  const histogram = new Int32Array(256);
  const { data } = image;
  const pixels = image.width * image.height;

  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const offset = pixel * 4;
    const alpha = data[offset + 3];
    const value = luminance(
      overWhite(data[offset], alpha),
      overWhite(data[offset + 1], alpha),
      overWhite(data[offset + 2], alpha)
    );
    histogram[Math.min(255, Math.max(0, Math.round(value)))] += 1;
  }

  let background = 255;
  let best = -1;
  for (let level = 0; level < 256; level += 1) {
    if (histogram[level] > best) {
      best = histogram[level];
      background = level;
    }
  }
  return background;
}

interface InkProfile {
  background: number;
  /** Ink pixels per row. */
  rows: Int32Array;
  /** 1 where the pixel is ink, one byte per pixel. */
  ink: Uint8Array;
  totalInk: number;
}

function measureInk(image: RasterImage): InkProfile {
  const { width, height, data } = image;
  const background = backgroundLuminance(image);
  const rows = new Int32Array(height);
  const ink = new Uint8Array(width * height);
  let totalInk = 0;

  for (let pixel = 0; pixel < ink.length; pixel += 1) {
    const offset = pixel * 4;
    const alpha = data[offset + 3];
    const value = luminance(
      overWhite(data[offset], alpha),
      overWhite(data[offset + 1], alpha),
      overWhite(data[offset + 2], alpha)
    );
    // Content is whatever stands out from the background, in either direction,
    // so light text on a dark page is content too.
    if (Math.abs(value - background) <= INK_CONTRAST) continue;
    ink[pixel] = 1;
    rows[(pixel / width) | 0] += 1;
    totalInk += 1;
  }

  return { background, rows, ink, totalInk };
}

function buildProfile(ink: Uint8Array, width: number, top: number, height: number): Float64Array {
  const profile = new Float64Array(PROFILE_BUCKETS);
  let total = 0;

  for (let row = top; row < top + height; row += 1) {
    const rowOffset = row * width;
    for (let column = 0; column < width; column += 1) {
      if (!ink[rowOffset + column]) continue;
      profile[Math.min(PROFILE_BUCKETS - 1, ((column * PROFILE_BUCKETS) / width) | 0)] += 1;
      total += 1;
    }
  }

  if (total > 0) {
    for (let bucket = 0; bucket < PROFILE_BUCKETS; bucket += 1) profile[bucket] /= total;
  }
  return profile;
}

function segmentBands(
  image: RasterImage,
  profile: InkProfile,
  options: BandOptions
): RasterBand[] {
  const settings = { ...BAND_DEFAULTS, ...options };
  const { ink, rows } = profile;
  const minRowInk = Math.max(1, Math.round(image.width * settings.minRowInkRatio));
  const bands: RasterBand[] = [];
  let top = -1;
  let blankRun = 0;

  const closeBand = (bottom: number) => {
    if (top < 0) return;
    const height = bottom - top;
    if (height >= settings.minBandHeight) {
      let inkPixels = 0;
      for (let row = top; row < bottom; row += 1) inkPixels += rows[row];
      bands.push({ top, height, inkPixels, profile: buildProfile(ink, image.width, top, height) });
    }
    top = -1;
  };

  for (let row = 0; row < image.height; row += 1) {
    if (rows[row] >= minRowInk) {
      if (top < 0) top = row;
      blankRun = 0;
      continue;
    }
    if (top < 0) continue;
    blankRun += 1;
    if (blankRun > settings.mergeGap) closeBand(row - blankRun + 1);
  }
  closeBand(image.height - blankRun);

  return bands;
}

/**
 * Splits a render into horizontal bands of content, one per line of text or
 * per block of graphics.
 */
export function extractBands(image: RasterImage, options: BandOptions = {}): RasterBand[] {
  return segmentBands(image, measureInk(image), options);
}

function profileSimilarity(left: Float64Array, right: Float64Array): number {
  let distance = 0;
  for (let bucket = 0; bucket < PROFILE_BUCKETS; bucket += 1) {
    distance += Math.abs(left[bucket] - right[bucket]);
  }
  return Math.max(0, 1 - distance / 2);
}

function ratio(left: number, right: number): number {
  const larger = Math.max(left, right);
  return larger === 0 ? 1 : Math.min(left, right) / larger;
}

function bandSimilarity(left: RasterBand, right: RasterBand): number {
  return profileSimilarity(left.profile, right.profile) * 0.6
    + ratio(left.height, right.height) * 0.2
    + ratio(left.inkPixels, right.inkPixels) * 0.2;
}

/** Marks a band's ink in a mask, which is how a wholly added or removed band is shown. */
function markBandInk(
  profile: InkProfile,
  width: number,
  mask: Uint8Array,
  band: RasterBand,
  classification: number
): number {
  let marked = 0;

  for (let row = band.top; row < band.top + band.height; row += 1) {
    const rowOffset = row * width;
    for (let column = 0; column < width; column += 1) {
      const pixel = rowOffset + column;
      if (!profile.ink[pixel]) continue;
      mask[pixel] = classification;
      marked += 1;
    }
  }

  return marked;
}

function normalizeBand(
  band: RasterBand | undefined,
  height: number
): { top: number; height: number } | null {
  if (!band) return null;
  return { top: round6(band.top / height), height: round6(band.height / height) };
}

function emptyCounts(): Record<BandStatus, number> {
  return { equal: 0, moved: 0, changed: 0, added: 0, removed: 0 };
}

/**
 * Compares two rendered pages after removing vertical displacement.
 *
 * Content that only moved is reported as moved, not as changed. Horizontal
 * displacement is not modelled: a line whose content shifts sideways is
 * reported as changed, which is conservative rather than misleading.
 */
export function compareAlignedRasters(
  original: RasterImage | null,
  modified: RasterImage | null,
  options: AlignedDiffOptions = {}
): AlignedPageDiff {
  const settings = { ...VISUAL_DEFAULTS, ...BAND_DEFAULTS, ...options };
  const missing = missingSideDiff(original, modified);

  if (missing || !original || !modified) {
    const pageRemoved = missing?.diagnostics[0]?.code === 'page-removed';
    const counts = emptyCounts();
    if (missing?.status === 'different') counts[pageRemoved ? 'removed' : 'added'] = 1;

    return {
      engineVersion: 'visual-bands-v1',
      status: missing?.status ?? 'indeterminate',
      raster: missing?.raster ?? { width: 0, height: 0 },
      changedPixels: missing?.changedPixels ?? 0,
      comparedPixels: missing?.comparedPixels ?? 0,
      changeRatio: missing?.changeRatio ?? 0,
      inkChangeRatio: missing?.changeRatio ?? 0,
      bandCounts: counts,
      bands: [],
      regions: pageRemoved ? [] : (missing?.regions ?? []),
      removedRegions: pageRemoved ? (missing?.regions ?? []) : [],
      diagnostics: missing?.diagnostics ?? [],
    };
  }

  const mismatch = sizeMismatchDiagnostic(original, modified);
  if (mismatch) {
    return {
      engineVersion: 'visual-bands-v1',
      status: 'indeterminate',
      raster: { width: original.width, height: original.height },
      changedPixels: 0,
      comparedPixels: 0,
      changeRatio: 0,
      inkChangeRatio: 0,
      bandCounts: emptyCounts(),
      bands: [],
      regions: [],
      removedRegions: [],
      diagnostics: [mismatch],
    };
  }

  const { width, height } = original;
  const comparedPixels = width * height;
  const originalInk = measureInk(original);
  const modifiedInk = measureInk(modified);
  const originalBands = segmentBands(original, originalInk, settings);
  const modifiedBands = segmentBands(modified, modifiedInk, settings);
  const diagnostics: VisualDiagnostic[] = [];

  if (originalBands.length > settings.maxBands || modifiedBands.length > settings.maxBands) {
    diagnostics.push({
      code: 'region-budget-exceeded',
      message:
        `This page has more than ${settings.maxBands} bands of content; ` +
        'reflow-aware comparison was skipped in favour of an exact comparison.',
    });
  }

  const alignable = diagnostics.length === 0;
  const pairs = alignable
    ? alignSequences(originalBands, modifiedBands, bandSimilarity, MIN_BAND_SIMILARITY)
    : [{ original: undefined, modified: undefined }];
  const originalMask = new Uint8Array(comparedPixels);
  const modifiedMask = new Uint8Array(comparedPixels);
  const thresholdDelta = thresholdDeltaFor(settings.threshold);
  const bandCounts = emptyCounts();
  const bands: BandChange[] = [];
  let changedPixels = 0;
  let comparedInk = 0;

  if (!alignable) {
    // Fall back to one whole-page comparison rather than an unbounded alignment.
    changedPixels = compareRowRange({
      original,
      modified,
      originalTop: 0,
      modifiedTop: 0,
      rows: height,
      thresholdDelta,
      originalMask,
      modifiedMask,
    });
    comparedInk = comparedPixels;
    bandCounts.changed = changedPixels > 0 ? 1 : 0;
    bandCounts.equal = changedPixels > 0 ? 0 : 1;
  } else {
    for (const pair of pairs) {
      const left = pair.original;
      const right = pair.modified;

      if (left && right) {
        const rows = Math.min(left.height, right.height);
        const bandChanged = compareRowRange({
          original,
          modified,
          originalTop: left.top,
          modifiedTop: right.top,
          rows,
          thresholdDelta,
          originalMask,
          modifiedMask,
        });
        const shift = right.top - left.top;
        const heightsMatch = left.height === right.height;
        const status: BandStatus = bandChanged > 0 || !heightsMatch
          ? 'changed'
          : shift === 0 ? 'equal' : 'moved';

        changedPixels += bandChanged;
        comparedInk += Math.max(left.inkPixels, right.inkPixels);
        bandCounts[status] += 1;
        bands.push({
          status,
          original: normalizeBand(left, height),
          modified: normalizeBand(right, height),
          shift,
          similarity: round6(bandSimilarity(left, right)),
          changedPixels: bandChanged,
        });
        continue;
      }

      if (left) {
        const marked = markBandInk(originalInk, width, originalMask, left, VISUAL_MASK.removed);
        changedPixels += marked;
        comparedInk += left.inkPixels;
        bandCounts.removed += 1;
        bands.push({
          status: 'removed',
          original: normalizeBand(left, height),
          modified: null,
          shift: null,
          similarity: null,
          changedPixels: marked,
        });
        continue;
      }

      if (right) {
        const marked = markBandInk(modifiedInk, width, modifiedMask, right, VISUAL_MASK.added);
        changedPixels += marked;
        comparedInk += right.inkPixels;
        bandCounts.added += 1;
        bands.push({
          status: 'added',
          original: null,
          modified: normalizeBand(right, height),
          shift: null,
          similarity: null,
          changedPixels: marked,
        });
      }
    }
  }

  const modifiedRegions = extractRegions(modifiedMask, width, height, settings);
  const originalRegions = extractRegions(originalMask, width, height, settings);

  if (modifiedRegions.truncated || originalRegions.truncated) {
    diagnostics.push({
      code: 'region-budget-exceeded',
      message:
        `More than ${settings.maxRegions} changed regions were found; only the largest ` +
        `${settings.maxRegions} are listed.`,
    });
  }

  return {
    engineVersion: 'visual-bands-v1',
    status: changedPixels > 0 ? 'different' : 'equal',
    raster: { width, height },
    changedPixels,
    comparedPixels,
    changeRatio: round6(changedPixels / comparedPixels),
    inkChangeRatio: comparedInk > 0 ? round6(Math.min(1, changedPixels / comparedInk)) : 0,
    bandCounts,
    bands,
    regions: modifiedRegions.regions,
    removedRegions: originalRegions.regions.filter(region => region.kind === 'removed'),
    ...(settings.includeMasks ? { masks: { original: originalMask, modified: modifiedMask } } : {}),
    diagnostics,
  };
}

function lines(count: number): string {
  return count === 1 ? '1 line' : `${count} lines`;
}

export function describeAlignedStatus(diff: AlignedPageDiff): string {
  if (diff.status === 'indeterminate') return 'Visual comparison unavailable';
  const { added, removed, changed, moved } = diff.bandCounts;
  const total = added + removed + changed;
  const suffix = moved > 0 ? `; ${moved} more only moved` : '';

  if (total === 0) {
    return moved > 0 ? 'Same content, moved on the page' : 'Pages render identically';
  }

  const parts: string[] = [];
  if (added) parts.push(`${added} added`);
  if (removed) parts.push(`${removed} removed`);
  if (changed) parts.push(`${changed} edited`);

  if (parts.length === 1) {
    const [word] = parts[0].split(' ').slice(1);
    return `${lines(total)} ${word}${suffix}`;
  }
  return `${lines(total)} changed: ${parts.join(', ')}${suffix}`;
}
