/**
 * Runtime-neutral pixel comparison for two rendered PDF pages.
 *
 * This module must stay free of DOM, Canvas, and Node APIs so the browser and
 * the CLI can share it. Callers rasterize pages themselves and pass plain RGBA
 * buffers in.
 *
 * Perceptual pixel difference uses the YIQ colour-difference metric described
 * by Kotsarenko and Ramos, "Measuring perceived colour difference using YIQ
 * NTSC transmission colour space in mobile applications".
 */

export interface RasterImage {
  width: number;
  height: number;
  /** RGBA bytes, row-major, four bytes per pixel. */
  data: Uint8ClampedArray | Uint8Array;
}

export type VisualStatus = 'equal' | 'different' | 'indeterminate';

/** Per-pixel classification stored in {@link VisualPageDiff.mask}. */
export const VISUAL_MASK = {
  same: 0,
  /** The original page was darker here: content was removed. */
  removed: 1,
  /** The modified page is darker here: content was added. */
  added: 2,
  /** Similar darkness, different colour. */
  recoloured: 3,
} as const;

export interface VisualRegion {
  /** Normalized [0, 1] rectangle relative to the compared raster. */
  x: number;
  y: number;
  width: number;
  height: number;
  changedPixels: number;
  /** Dominant classification inside the region. */
  kind: 'removed' | 'added' | 'recoloured' | 'mixed';
}

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

export interface VisualDiffOptions {
  /**
   * Perceptual difference required before a pixel counts as changed, 0..1.
   * Larger values ignore more anti-aliasing and compression noise.
   */
  threshold?: number;
  /** Grid cell size, in raster pixels, used to group changes into regions. */
  cellSize?: number;
  /** Changed pixels a cell needs before it joins a region. */
  minCellPixels?: number;
  /** Changed pixels a region needs before it is reported. */
  minRegionPixels?: number;
  /** Cells of slack allowed between two clusters before they stay separate. */
  mergeRadiusCells?: number;
  /** Upper bound on reported regions. */
  maxRegions?: number;
  /** Include the per-pixel mask in the result. */
  includeMask?: boolean;
}

const DEFAULTS = {
  threshold: 0.05,
  cellSize: 8,
  minCellPixels: 2,
  minRegionPixels: 16,
  mergeRadiusCells: 1,
  maxRegions: 128,
  includeMask: false,
} satisfies Required<VisualDiffOptions>;

/** Largest possible YIQ delta between two 8-bit RGB colours. */
const MAX_YIQ_DELTA = 35215;

/** Luminance gap below which a difference reads as a colour change, not ink. */
const RECOLOUR_LUMINANCE_TOLERANCE = 8;

function luminance(r: number, g: number, b: number): number {
  return r * 0.29889531 + g * 0.58662247 + b * 0.11448223;
}

function chromaI(r: number, g: number, b: number): number {
  return r * 0.59597799 - g * 0.2741761 - b * 0.32180189;
}

function chromaQ(r: number, g: number, b: number): number {
  return r * 0.21147017 - g * 0.52261711 + b * 0.31114694;
}

/** Composites a possibly transparent pixel onto a white page background. */
function overWhite(value: number, alpha: number): number {
  return alpha >= 255 ? value : 255 + (value - 255) * (alpha / 255);
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

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

interface RegionAccumulator {
  minCol: number;
  maxCol: number;
  minRow: number;
  maxRow: number;
  changedPixels: number;
  removed: number;
  added: number;
  recoloured: number;
}

function dominantKind(region: RegionAccumulator): VisualRegion['kind'] {
  const { removed, added, recoloured } = region;
  const total = removed + added + recoloured;
  if (total === 0) return 'mixed';
  if (removed / total >= 0.8) return 'removed';
  if (added / total >= 0.8) return 'added';
  if (recoloured / total >= 0.8) return 'recoloured';
  return 'mixed';
}

/**
 * Groups changed pixels into rectangular regions using a coarse cell grid so
 * the result stays small enough to keep in a comparison result or to render as
 * page annotations.
 */
function extractRegions(
  mask: Uint8Array,
  width: number,
  height: number,
  options: Required<VisualDiffOptions>
): { regions: VisualRegion[]; truncated: boolean } {
  const { cellSize, minCellPixels, minRegionPixels, mergeRadiusCells, maxRegions } = options;
  const cols = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);
  if (cols === 0 || rows === 0) return { regions: [], truncated: false };

  const cellChanged = new Int32Array(cols * rows);
  const cellRemoved = new Int32Array(cols * rows);
  const cellAdded = new Int32Array(cols * rows);
  const cellRecoloured = new Int32Array(cols * rows);

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width;
    const cellRowOffset = Math.floor(y / cellSize) * cols;

    for (let x = 0; x < width; x += 1) {
      const value = mask[rowOffset + x];
      if (value === VISUAL_MASK.same) continue;
      const cell = cellRowOffset + Math.floor(x / cellSize);
      cellChanged[cell] += 1;
      if (value === VISUAL_MASK.removed) cellRemoved[cell] += 1;
      else if (value === VISUAL_MASK.added) cellAdded[cell] += 1;
      else cellRecoloured[cell] += 1;
    }
  }

  const active = new Uint8Array(cols * rows);
  for (let cell = 0; cell < active.length; cell += 1) {
    if (cellChanged[cell] >= minCellPixels) active[cell] = 1;
  }

  // Dilating before labelling merges clusters separated by small gaps, so a
  // changed word does not become one region per glyph.
  let connected = active;
  if (mergeRadiusCells > 0) {
    connected = new Uint8Array(cols * rows);
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        if (!active[row * cols + col]) continue;
        const minRow = Math.max(0, row - mergeRadiusCells);
        const maxRow = Math.min(rows - 1, row + mergeRadiusCells);
        const minCol = Math.max(0, col - mergeRadiusCells);
        const maxCol = Math.min(cols - 1, col + mergeRadiusCells);
        for (let r = minRow; r <= maxRow; r += 1) {
          connected.fill(1, r * cols + minCol, r * cols + maxCol + 1);
        }
      }
    }
  }

  const visited = new Uint8Array(cols * rows);
  const stack = new Int32Array(cols * rows);
  const accumulators: RegionAccumulator[] = [];

  for (let start = 0; start < connected.length; start += 1) {
    if (!connected[start] || visited[start]) continue;
    visited[start] = 1;
    let stackSize = 0;
    stack[stackSize++] = start;
    const region: RegionAccumulator = {
      minCol: cols,
      maxCol: -1,
      minRow: rows,
      maxRow: -1,
      changedPixels: 0,
      removed: 0,
      added: 0,
      recoloured: 0,
    };

    while (stackSize > 0) {
      const cell = stack[--stackSize];
      const col = cell % cols;
      const row = (cell - col) / cols;

      if (active[cell]) {
        if (col < region.minCol) region.minCol = col;
        if (col > region.maxCol) region.maxCol = col;
        if (row < region.minRow) region.minRow = row;
        if (row > region.maxRow) region.maxRow = row;
        region.changedPixels += cellChanged[cell];
        region.removed += cellRemoved[cell];
        region.added += cellAdded[cell];
        region.recoloured += cellRecoloured[cell];
      }

      if (col > 0 && connected[cell - 1] && !visited[cell - 1]) {
        visited[cell - 1] = 1;
        stack[stackSize++] = cell - 1;
      }
      if (col + 1 < cols && connected[cell + 1] && !visited[cell + 1]) {
        visited[cell + 1] = 1;
        stack[stackSize++] = cell + 1;
      }
      if (row > 0 && connected[cell - cols] && !visited[cell - cols]) {
        visited[cell - cols] = 1;
        stack[stackSize++] = cell - cols;
      }
      if (row + 1 < rows && connected[cell + cols] && !visited[cell + cols]) {
        visited[cell + cols] = 1;
        stack[stackSize++] = cell + cols;
      }
    }

    if (region.maxCol >= 0 && region.changedPixels >= minRegionPixels) accumulators.push(region);
  }

  accumulators.sort((left, right) => right.changedPixels - left.changedPixels);
  const truncated = accumulators.length > maxRegions;
  const regions = accumulators.slice(0, maxRegions).map((region): VisualRegion => {
    const left = region.minCol * cellSize;
    const top = region.minRow * cellSize;
    const right = Math.min(width, (region.maxCol + 1) * cellSize);
    const bottom = Math.min(height, (region.maxRow + 1) * cellSize);

    return {
      x: round6(left / width),
      y: round6(top / height),
      width: round6((right - left) / width),
      height: round6((bottom - top) / height),
      changedPixels: region.changedPixels,
      kind: dominantKind(region),
    };
  });

  return { regions, truncated };
}

/**
 * Compares two rendered pages of identical raster size. A missing side means
 * the page was added or removed, which is reported as a whole-page change
 * rather than as an unknown result.
 */
export function compareRasters(
  original: RasterImage | null,
  modified: RasterImage | null,
  options: VisualDiffOptions = {}
): VisualPageDiff {
  const settings = { ...DEFAULTS, ...options };

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

  const { width, height } = original;
  if (width !== modified.width || height !== modified.height) {
    return {
      engineVersion: 'visual-v1',
      status: 'indeterminate',
      raster: { width, height },
      changedPixels: 0,
      comparedPixels: 0,
      changeRatio: 0,
      regions: [],
      diagnostics: [{
        code: 'raster-size-mismatch',
        message:
          `Rendered pages have different raster sizes (${width}×${height} and ` +
          `${modified.width}×${modified.height}); they cannot be compared pixel by pixel.`,
      }],
    };
  }

  const comparedPixels = width * height;
  const mask = new Uint8Array(comparedPixels);
  const thresholdDelta = settings.threshold * settings.threshold * MAX_YIQ_DELTA;
  const left = original.data;
  const right = modified.data;
  let changedPixels = 0;

  for (let pixel = 0; pixel < comparedPixels; pixel += 1) {
    const offset = pixel * 4;
    const leftAlpha = left[offset + 3];
    const rightAlpha = right[offset + 3];
    const lr = overWhite(left[offset], leftAlpha);
    const lg = overWhite(left[offset + 1], leftAlpha);
    const lb = overWhite(left[offset + 2], leftAlpha);
    const rr = overWhite(right[offset], rightAlpha);
    const rg = overWhite(right[offset + 1], rightAlpha);
    const rb = overWhite(right[offset + 2], rightAlpha);

    if (lr === rr && lg === rg && lb === rb) continue;

    const leftLuminance = luminance(lr, lg, lb);
    const rightLuminance = luminance(rr, rg, rb);
    const deltaY = leftLuminance - rightLuminance;
    const deltaI = chromaI(lr, lg, lb) - chromaI(rr, rg, rb);
    const deltaQ = chromaQ(lr, lg, lb) - chromaQ(rr, rg, rb);
    const delta = 0.5053 * deltaY * deltaY + 0.299 * deltaI * deltaI + 0.1957 * deltaQ * deltaQ;

    if (delta <= thresholdDelta) continue;

    changedPixels += 1;
    if (Math.abs(deltaY) <= RECOLOUR_LUMINANCE_TOLERANCE) mask[pixel] = VISUAL_MASK.recoloured;
    else if (deltaY < 0) mask[pixel] = VISUAL_MASK.removed;
    else mask[pixel] = VISUAL_MASK.added;
  }

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
export function withDiagnostic(
  diff: VisualPageDiff,
  diagnostic: VisualDiagnostic
): VisualPageDiff {
  return { ...diff, diagnostics: [...diff.diagnostics, diagnostic] };
}

export function describeVisualStatus(diff: VisualPageDiff): string {
  if (diff.status === 'indeterminate') return 'Visual comparison unavailable';
  if (diff.status === 'equal') return 'Pages render identically';
  const percentage = diff.changeRatio * 100;
  const formatted = percentage >= 0.1 ? percentage.toFixed(1) : '<0.1';
  return `${formatted}% of rendered pixels differ`;
}
