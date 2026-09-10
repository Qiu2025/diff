/**
 * Exact pixel comparison of two rendered PDF pages.
 *
 * This module must stay free of DOM, Canvas, and Node APIs so the browser and
 * the CLI can share it. Shared raster primitives live in `raster.ts`;
 * reflow-aware comparison lives in `visualBands.ts`.
 */

import {
  compareRowRange,
  extractRegions,
  round6,
  thresholdDeltaFor,
} from './raster.ts';
import type { RasterImage, RegionOptions, VisualRegion } from './raster.ts';

export { VISUAL_MASK } from './raster.ts';
export type { RasterImage, VisualRegion, VisualRegionKind } from './raster.ts';

export type VisualStatus = 'equal' | 'different' | 'indeterminate';

export interface VisualDiagnostic {
  code:
    | 'raster-size-mismatch'
    | 'page-added'
    | 'page-removed'
    | 'both-sides-missing'
    | 'region-budget-exceeded'
    | 'page-size-mismatch'
    | 'render-failed';
  message: string;
}

export interface VisualPageDiff {
  engineVersion: 'visual-v1';
  status: VisualStatus;
  raster: { width: number; height: number };
  changedPixels: number;
  comparedPixels: number;
  /** Changed share of the compared raster, 0..1. */
  changeRatio: number;
  regions: VisualRegion[];
  /** Optional per-pixel {@link VISUAL_MASK} values, one byte per pixel. */
  mask?: Uint8Array;
  diagnostics: VisualDiagnostic[];
}

export interface VisualDiffOptions extends Partial<RegionOptions> {
  /**
   * Perceptual difference required before a pixel counts as changed, 0..1.
   * Larger values ignore more anti-aliasing and compression noise.
   */
  threshold?: number;
  /** Include the per-pixel mask in the result. */
  includeMask?: boolean;
}

export const VISUAL_DEFAULTS = {
  threshold: 0.05,
  cellSize: 8,
  minCellPixels: 2,
  minRegionPixels: 16,
  mergeRadiusCells: 1,
  maxRegions: 128,
  includeMask: false,
} satisfies Required<VisualDiffOptions>;

function fullPageRegion(kind: VisualRegion['kind'], changedPixels: number): VisualRegion {
  return { x: 0, y: 0, width: 1, height: 1, changedPixels, kind };
}

function missingSideResult(
  present: RasterImage | null,
  diagnostic: VisualDiagnostic
): VisualPageDiff {
  const width = present?.width ?? 0;
  const height = present?.height ?? 0;
  const pixels = width * height;

  return {
    engineVersion: 'visual-v1',
    status: pixels > 0 ? 'different' : 'indeterminate',
    raster: { width, height },
    changedPixels: pixels,
    comparedPixels: pixels,
    changeRatio: pixels > 0 ? 1 : 0,
    regions: pixels > 0
      ? [fullPageRegion(diagnostic.code === 'page-removed' ? 'removed' : 'added', pixels)]
      : [],
    diagnostics: [diagnostic],
  };
}

/** Shared handling of the cases where one or both sides could not be rendered. */
export function missingSideDiff(
  original: RasterImage | null,
  modified: RasterImage | null
): VisualPageDiff | null {
  if (!original && !modified) {
    return missingSideResult(null, {
      code: 'both-sides-missing',
      message: 'Neither side of this comparison could be rendered.',
    });
  }
  if (!original) {
    return missingSideResult(modified, {
      code: 'page-added',
      message: 'This page exists only in the modified document.',
    });
  }
  if (!modified) {
    return missingSideResult(original, {
      code: 'page-removed',
      message: 'This page exists only in the original document.',
    });
  }
  return null;
}

/** Shared handling of rasters that cannot be compared position by position. */
export function sizeMismatchDiagnostic(
  original: RasterImage,
  modified: RasterImage
): VisualDiagnostic | null {
  if (original.width === modified.width && original.height === modified.height) return null;
  return {
    code: 'raster-size-mismatch',
    message:
      `Rendered pages have different raster sizes (${original.width}×${original.height} and ` +
      `${modified.width}×${modified.height}); they cannot be compared pixel by pixel.`,
  };
}

/**
 * Compares two rendered pages of identical raster size, position by position.
 *
 * This is the exact comparison: content that merely moved counts as changed.
 * See `compareAlignedRasters()` for the reflow-aware result.
 */
export function compareRasters(
  original: RasterImage | null,
  modified: RasterImage | null,
  options: VisualDiffOptions = {}
): VisualPageDiff {
  const settings = { ...VISUAL_DEFAULTS, ...options };
  const missing = missingSideDiff(original, modified);
  if (missing || !original || !modified) {
    return missing ?? missingSideResult(null, {
      code: 'both-sides-missing',
      message: 'Neither side of this comparison could be rendered.',
    });
  }

  const mismatch = sizeMismatchDiagnostic(original, modified);
  if (mismatch) {
    return {
      engineVersion: 'visual-v1',
      status: 'indeterminate',
      raster: { width: original.width, height: original.height },
      changedPixels: 0,
      comparedPixels: 0,
      changeRatio: 0,
      regions: [],
      diagnostics: [mismatch],
    };
  }

  const { width, height } = original;
  const comparedPixels = width * height;
  const mask = new Uint8Array(comparedPixels);
  const changedPixels = compareRowRange({
    original,
    modified,
    originalTop: 0,
    modifiedTop: 0,
    rows: height,
    thresholdDelta: thresholdDeltaFor(settings.threshold),
    modifiedMask: mask,
  });

  const diagnostics: VisualDiagnostic[] = [];
  const { regions, truncated } = changedPixels > 0
    ? extractRegions(mask, width, height, settings)
    : { regions: [], truncated: false };

  if (truncated) {
    diagnostics.push({
      code: 'region-budget-exceeded',
      message:
        `More than ${settings.maxRegions} changed regions were found; only the largest ` +
        `${settings.maxRegions} are listed.`,
    });
  }

  return {
    engineVersion: 'visual-v1',
    status: changedPixels > 0 ? 'different' : 'equal',
    raster: { width, height },
    changedPixels,
    comparedPixels,
    changeRatio: round6(changedPixels / comparedPixels),
    regions,
    ...(settings.includeMask ? { mask } : {}),
    diagnostics,
  };
}

/** Adds a diagnostic to an existing result without mutating it. */
export function withDiagnostic<T extends { diagnostics: VisualDiagnostic[] }>(
  diff: T,
  diagnostic: VisualDiagnostic
): T {
  return { ...diff, diagnostics: [...diff.diagnostics, diagnostic] };
}

export function describeVisualStatus(diff: Pick<VisualPageDiff, 'status' | 'changeRatio'>): string {
  if (diff.status === 'indeterminate') return 'Visual comparison unavailable';
  if (diff.status === 'equal') return 'Pages render identically';
  const percentage = diff.changeRatio * 100;
  const formatted = percentage >= 0.1 ? percentage.toFixed(1) : '<0.1';
  return `${formatted}% of rendered pixels differ`;
}
