/**
 * Browser adapter that rasterizes a page pair and runs the runtime-neutral
 * visual comparison over it.
 *
 * Rendering is the most expensive thing this application does, so every render
 * happens inside an explicit pixel budget and every canvas and image buffer is
 * released before the result is returned. Nothing here is retained in the
 * long-lived comparison result.
 */

import { compareRasters, withDiagnostic, VISUAL_MASK } from './visualDiff';
import type { RasterImage, VisualDiffOptions, VisualPageDiff } from './visualDiff';
import type { PageSize, PdfSession } from './pdfUtils';

export interface PageRenderSource {
  session: Pick<PdfSession, 'getPageSize' | 'renderPageToCanvas'>;
  pageNumber: number;
}

export interface VisualPageComparison {
  diff: VisualPageDiff;
  /** Object URLs for display. Call {@link VisualPageComparison.release}. */
  images: {
    original: string | null;
    modified: string | null;
    overlay: string | null;
  };
  /** Points-to-pixels factor both pages were rendered at. */
  scale: number;
  release: () => void;
}

export interface RenderComparisonOptions {
  /** Hard cap on the rasterized area of one page. */
  maxPixels?: number;
  minScale?: number;
  maxScale?: number;
  signal?: AbortSignal;
  /** Forwarded to the runtime-neutral comparison. */
  diff?: VisualDiffOptions;
}

/** Roughly 150 DPI for US Letter, which is legible without being wasteful. */
const DEFAULT_MAX_PIXELS = 2_200_000;
const DEFAULT_MIN_SCALE = 0.25;
const DEFAULT_MAX_SCALE = 3;

/** Page-point difference tolerated before two pages count as different sizes. */
const PAGE_SIZE_TOLERANCE = 1;

const OVERLAY_COLOURS: Record<number, [number, number, number]> = {
  [VISUAL_MASK.removed]: [220, 38, 38],
  [VISUAL_MASK.added]: [21, 128, 61],
  [VISUAL_MASK.recoloured]: [180, 83, 9],
};

/** Whitening applied to the page underneath the overlay so marks stand out. */
const OVERLAY_PAGE_WASH = 0.6;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('Visual comparison was aborted.', 'AbortError');
  }
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function contextOf(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Could not get a 2D canvas context.');
  return context;
}

/** Drops the backing store of a canvas that is no longer needed. */
function releaseCanvas(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

function toObjectUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(URL.createObjectURL(blob));
      else reject(new Error('Could not encode a rendered page.'));
    }, 'image/png');
  });
}

function planScale(
  sizes: PageSize[],
  options: RenderComparisonOptions
): { scale: number; width: number; height: number } {
  const maxPixels = options.maxPixels ?? DEFAULT_MAX_PIXELS;
  const minScale = options.minScale ?? DEFAULT_MIN_SCALE;
  const maxScale = options.maxScale ?? DEFAULT_MAX_SCALE;
  const boxWidth = Math.max(...sizes.map(size => size.width), 1);
  const boxHeight = Math.max(...sizes.map(size => size.height), 1);
  const budgetScale = Math.sqrt(maxPixels / (boxWidth * boxHeight));
  const scale = Math.min(maxScale, Math.max(minScale, budgetScale));

  return {
    scale,
    width: Math.max(1, Math.floor(boxWidth * scale)),
    height: Math.max(1, Math.floor(boxHeight * scale)),
  };
}

/**
 * Renders one page into a canvas of exactly the shared target size. Pages that
 * are smaller than the shared box are anchored top-left on white, which keeps
 * a Letter/A4 pair comparable instead of offsetting every line.
 */
async function renderToTarget(
  source: PageRenderSource,
  size: PageSize,
  target: { scale: number; width: number; height: number },
  signal?: AbortSignal
): Promise<HTMLCanvasElement> {
  const naturalWidth = Math.max(1, Math.floor(size.width * target.scale));
  const naturalHeight = Math.max(1, Math.floor(size.height * target.scale));

  if (naturalWidth === target.width && naturalHeight === target.height) {
    const canvas = createCanvas(target.width, target.height);
    try {
      await source.session.renderPageToCanvas(source.pageNumber, canvas, target.scale, signal);
    } catch (error) {
      releaseCanvas(canvas);
      throw error;
    }
    return canvas;
  }

  const page = createCanvas(naturalWidth, naturalHeight);
  try {
    await source.session.renderPageToCanvas(source.pageNumber, page, target.scale, signal);
    const canvas = createCanvas(target.width, target.height);
    const context = contextOf(canvas);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, target.width, target.height);
    context.drawImage(page, 0, 0);
    return canvas;
  } finally {
    releaseCanvas(page);
  }
}

function readRaster(canvas: HTMLCanvasElement): RasterImage {
  const { width, height } = canvas;
  const { data } = contextOf(canvas).getImageData(0, 0, width, height);
  return { width, height, data };
}

/** Draws the page washed out, ready for change marks to be painted on top. */
function beginOverlay(
  base: HTMLCanvasElement,
  width: number,
  height: number
): { overlay: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const overlay = createCanvas(width, height);
  const context = contextOf(overlay);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(base, 0, 0);
  context.fillStyle = `rgba(255, 255, 255, ${OVERLAY_PAGE_WASH})`;
  context.fillRect(0, 0, width, height);
  return { overlay, context };
}

/**
 * Tints a whole page, which is how an added or removed page is shown: there is
 * no counterpart to compare it against pixel by pixel.
 */
function renderPageTint(
  base: HTMLCanvasElement,
  kind: typeof VISUAL_MASK.added | typeof VISUAL_MASK.removed,
  width: number,
  height: number
): HTMLCanvasElement {
  const { overlay, context } = beginOverlay(base, width, height);
  const [red, green, blue] = OVERLAY_COLOURS[kind];
  context.fillStyle = `rgba(${red}, ${green}, ${blue}, 0.18)`;
  context.fillRect(0, 0, width, height);
  return overlay;
}

/** Paints the change mask over a washed-out copy of the modified page. */
function renderOverlay(
  base: HTMLCanvasElement,
  mask: Uint8Array,
  width: number,
  height: number
): HTMLCanvasElement {
  const { overlay, context } = beginOverlay(base, width, height);
  const marks = context.createImageData(width, height);
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    const colour = OVERLAY_COLOURS[mask[pixel]];
    if (!colour) continue;
    const offset = pixel * 4;
    marks.data[offset] = colour[0];
    marks.data[offset + 1] = colour[1];
    marks.data[offset + 2] = colour[2];
    marks.data[offset + 3] = 255;
  }

  const markCanvas = createCanvas(width, height);
  contextOf(markCanvas).putImageData(marks, 0, 0);
  context.drawImage(markCanvas, 0, 0);
  releaseCanvas(markCanvas);
  return overlay;
}

function emptyComparison(diff: VisualPageDiff): VisualPageComparison {
  return {
    diff,
    images: { original: null, modified: null, overlay: null },
    scale: 0,
    release: () => {},
  };
}

/**
 * Renders both sides of a page pair at one shared scale and compares them.
 *
 * The returned object owns object URLs; callers must call `release()` when the
 * comparison leaves the screen.
 */
export async function compareRenderedPages(
  original: PageRenderSource | null,
  modified: PageRenderSource | null,
  options: RenderComparisonOptions = {}
): Promise<VisualPageComparison> {
  const { signal, diff: diffOptions } = options;
  throwIfAborted(signal);

  if (!original && !modified) return emptyComparison(compareRasters(null, null, diffOptions));

  const [originalSize, modifiedSize] = await Promise.all([
    original ? original.session.getPageSize(original.pageNumber, signal) : null,
    modified ? modified.session.getPageSize(modified.pageNumber, signal) : null,
  ]);
  throwIfAborted(signal);

  const target = planScale(
    [originalSize, modifiedSize].filter((size): size is PageSize => size !== null),
    options
  );
  let originalCanvas: HTMLCanvasElement | null = null;
  let modifiedCanvas: HTMLCanvasElement | null = null;
  let overlayCanvas: HTMLCanvasElement | null = null;
  const urls: string[] = [];
  const release = () => {
    urls.splice(0).forEach(url => URL.revokeObjectURL(url));
  };

  try {
    if (original && originalSize) {
      originalCanvas = await renderToTarget(original, originalSize, target, signal);
    }
    if (modified && modifiedSize) {
      modifiedCanvas = await renderToTarget(modified, modifiedSize, target, signal);
    }
    throwIfAborted(signal);

    const originalRaster = originalCanvas ? readRaster(originalCanvas) : null;
    const modifiedRaster = modifiedCanvas ? readRaster(modifiedCanvas) : null;
    let diff = compareRasters(originalRaster, modifiedRaster, {
      ...diffOptions,
      includeMask: true,
    });

    if (
      originalSize && modifiedSize && (
        Math.abs(originalSize.width - modifiedSize.width) > PAGE_SIZE_TOLERANCE ||
        Math.abs(originalSize.height - modifiedSize.height) > PAGE_SIZE_TOLERANCE
      )
    ) {
      diff = withDiagnostic(diff, {
        code: 'page-size-mismatch',
        message:
          `Page sizes differ (${Math.round(originalSize.width)}×${Math.round(originalSize.height)} pt ` +
          `and ${Math.round(modifiedSize.width)}×${Math.round(modifiedSize.height)} pt). ` +
          'Both pages were rendered at the same scale and anchored top-left.',
      });
    }

    const overlayBase = modifiedCanvas ?? originalCanvas;
    if (overlayBase) {
      const { width, height } = diff.raster;
      if (diff.mask) {
        overlayCanvas = renderOverlay(overlayBase, diff.mask, width, height);
      } else if (!originalCanvas) {
        overlayCanvas = renderPageTint(overlayBase, VISUAL_MASK.added, width, height);
      } else if (!modifiedCanvas) {
        overlayCanvas = renderPageTint(overlayBase, VISUAL_MASK.removed, width, height);
      }
    }

    const [originalUrl, modifiedUrl, overlayUrl] = await Promise.all([
      originalCanvas ? toObjectUrl(originalCanvas) : null,
      modifiedCanvas ? toObjectUrl(modifiedCanvas) : null,
      overlayCanvas ? toObjectUrl(overlayCanvas) : null,
    ]);
    [originalUrl, modifiedUrl, overlayUrl].forEach(url => {
      if (url) urls.push(url);
    });
    throwIfAborted(signal);

    // The mask is a full-page buffer; it has done its job once the overlay is
    // drawn, so it never reaches application state.
    const result: VisualPageDiff = { ...diff };
    delete result.mask;

    return {
      diff: result,
      images: { original: originalUrl, modified: modifiedUrl, overlay: overlayUrl },
      scale: target.scale,
      release,
    };
  } catch (error) {
    release();
    throw error;
  } finally {
    releaseCanvas(originalCanvas);
    releaseCanvas(modifiedCanvas);
    releaseCanvas(overlayCanvas);
  }
}
