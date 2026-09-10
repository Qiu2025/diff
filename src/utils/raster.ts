/**
 * Raster primitives shared by every pixel-level analyzer.
 *
 * Runtime-neutral: no DOM, Canvas, or Node APIs. Callers rasterize pages
 * themselves and pass plain RGBA buffers in.
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

/** Per-pixel classification stored in comparison masks. */
export const VISUAL_MASK = {
  same: 0,
  /** The original page was darker here: content was removed. */
  removed: 1,
  /** The modified page is darker here: content was added. */
  added: 2,
  /** Similar darkness, different colour. */
  recoloured: 3,
} as const;

export type VisualRegionKind = 'removed' | 'added' | 'recoloured' | 'mixed';

export interface VisualRegion {
  /** Normalized [0, 1] rectangle relative to the compared raster. */
  x: number;
  y: number;
  width: number;
  height: number;
  changedPixels: number;
  /** Dominant classification inside the region. */
  kind: VisualRegionKind;
}

export interface RegionOptions {
  /** Grid cell size, in raster pixels, used to group changes into regions. */
  cellSize: number;
  /** Changed pixels a cell needs before it joins a region. */
  minCellPixels: number;
  /** Changed pixels a region needs before it is reported. */
  minRegionPixels: number;
  /** Cells of slack allowed between two clusters before they stay separate. */
  mergeRadiusCells: number;
  /** Upper bound on reported regions. */
  maxRegions: number;
}

/** Largest possible YIQ delta between two 8-bit RGB colours. */
const MAX_YIQ_DELTA = 35215;

/** Luminance gap below which a difference reads as a colour change, not ink. */
const RECOLOUR_LUMINANCE_TOLERANCE = 8;

/** Luminance at or below which a pixel counts as ink rather than paper. */
export const INK_LUMINANCE = 245;

export function luminance(r: number, g: number, b: number): number {
  return r * 0.29889531 + g * 0.58662247 + b * 0.11448223;
}

function chromaI(r: number, g: number, b: number): number {
  return r * 0.59597799 - g * 0.2741761 - b * 0.32180189;
}

function chromaQ(r: number, g: number, b: number): number {
  return r * 0.21147017 - g * 0.52261711 + b * 0.31114694;
}

/** Composites a possibly transparent pixel onto a white page background. */
export function overWhite(value: number, alpha: number): number {
  return alpha >= 255 ? value : 255 + (value - 255) * (alpha / 255);
}

/** Converts a 0..1 sensitivity into the squared YIQ delta used per pixel. */
export function thresholdDeltaFor(threshold: number): number {
  return threshold * threshold * MAX_YIQ_DELTA;
}

export function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export interface RowRangeComparison {
  original: RasterImage;
  modified: RasterImage;
  /** First row of the original raster to compare. */
  originalTop: number;
  /** First row of the modified raster to compare. */
  modifiedTop: number;
  rows: number;
  thresholdDelta: number;
  /** Optional mask written in original-raster coordinates. */
  originalMask?: Uint8Array | null;
  /** Optional mask written in modified-raster coordinates. */
  modifiedMask?: Uint8Array | null;
}

/**
 * Compares a horizontal band of two rasters of equal width, optionally
 * recording the classification in either coordinate space.
 *
 * Taking the two tops separately is what makes reflow-aware comparison
 * possible: the same content can be compared where it actually sits on each
 * page.
 *
 * @returns the number of pixels that differ.
 */
export function compareRowRange(options: RowRangeComparison): number {
  const {
    original,
    modified,
    originalTop,
    modifiedTop,
    rows,
    thresholdDelta,
    originalMask,
    modifiedMask,
  } = options;
  const width = original.width;
  const left = original.data;
  const right = modified.data;
  let changedPixels = 0;

  for (let row = 0; row < rows; row += 1) {
    const originalRow = (originalTop + row) * width;
    const modifiedRow = (modifiedTop + row) * width;
    if (originalRow < 0 || modifiedRow < 0) continue;
    if (originalTop + row >= original.height || modifiedTop + row >= modified.height) break;

    for (let column = 0; column < width; column += 1) {
      const leftOffset = (originalRow + column) * 4;
      const rightOffset = (modifiedRow + column) * 4;
      const leftAlpha = left[leftOffset + 3];
      const rightAlpha = right[rightOffset + 3];
      const lr = overWhite(left[leftOffset], leftAlpha);
      const lg = overWhite(left[leftOffset + 1], leftAlpha);
      const lb = overWhite(left[leftOffset + 2], leftAlpha);
      const rr = overWhite(right[rightOffset], rightAlpha);
      const rg = overWhite(right[rightOffset + 1], rightAlpha);
      const rb = overWhite(right[rightOffset + 2], rightAlpha);

      if (lr === rr && lg === rg && lb === rb) continue;

      const deltaY = luminance(lr, lg, lb) - luminance(rr, rg, rb);
      const deltaI = chromaI(lr, lg, lb) - chromaI(rr, rg, rb);
      const deltaQ = chromaQ(lr, lg, lb) - chromaQ(rr, rg, rb);
      const delta = 0.5053 * deltaY * deltaY + 0.299 * deltaI * deltaI + 0.1957 * deltaQ * deltaQ;

      if (delta <= thresholdDelta) continue;

      changedPixels += 1;
      let classification: number;
      if (Math.abs(deltaY) <= RECOLOUR_LUMINANCE_TOLERANCE) classification = VISUAL_MASK.recoloured;
      else if (deltaY < 0) classification = VISUAL_MASK.removed;
      else classification = VISUAL_MASK.added;

      if (originalMask) originalMask[originalRow + column] = classification;
      if (modifiedMask) modifiedMask[modifiedRow + column] = classification;
    }
  }

  return changedPixels;
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

function dominantKind(region: RegionAccumulator): VisualRegionKind {
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
export function extractRegions(
  mask: Uint8Array,
  width: number,
  height: number,
  options: RegionOptions
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
