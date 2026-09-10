/**
 * Worker that runs page comparison off the UI thread.
 *
 * Comparing one page pair at ~150 DPI takes a few hundred milliseconds. On the
 * UI thread that freezes the page, including the spinner that is meant to show
 * work is happening.
 */

import { compareRasters } from '../utils/visualDiff.ts';
import type { RasterImage } from '../utils/raster.ts';
import { compareAlignedRasters } from '../utils/visualBands.ts';
import type { VisualWorkerRequest, VisualWorkerResponse, WorkerRaster } from './visualComparison.ts';

/** Minimal worker-scope surface, so this file compiles against the DOM lib. */
interface WorkerScope {
  postMessage(message: VisualWorkerResponse, transfer?: Transferable[]): void;
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<VisualWorkerRequest>) => void
  ): void;
}

const scope = self as unknown as WorkerScope;

function toRaster(raster: WorkerRaster | null): RasterImage | null {
  if (!raster) return null;
  return { width: raster.width, height: raster.height, data: new Uint8ClampedArray(raster.data) };
}

scope.addEventListener('message', event => {
  const { id, mode, original, modified, options } = event.data;

  try {
    if (mode === 'exact') {
      const diff = compareRasters(toRaster(original), toRaster(modified), {
        ...options,
        includeMask: true,
      });
      scope.postMessage(
        { id, ok: true, mode, diff },
        diff.mask ? [diff.mask.buffer] : []
      );
      return;
    }

    const diff = compareAlignedRasters(toRaster(original), toRaster(modified), {
      ...options,
      includeMasks: true,
    });
    scope.postMessage(
      { id, ok: true, mode, diff },
      diff.masks ? [diff.masks.original.buffer, diff.masks.modified.buffer] : []
    );
  } catch (error) {
    scope.postMessage({
      id,
      ok: false,
      message: error instanceof Error ? error.message : 'Visual comparison failed.',
    });
  }
});
