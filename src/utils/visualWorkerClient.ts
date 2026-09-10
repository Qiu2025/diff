/**
 * Client for the single application worker that runs page comparison.
 *
 * One worker is deliberate: comparison is an on-demand, one-page-at-a-time
 * operation, so a pool would add scheduling without removing any wait. The
 * worker is created on first use and kept warm; cancelling a job terminates it,
 * because a running comparison cannot be interrupted from the outside.
 */

import { compareRasters } from './visualDiff.ts';
import type { VisualDiffOptions, VisualPageDiff } from './visualDiff.ts';
import { compareAlignedRasters } from './visualBands.ts';
import type { AlignedPageDiff, BandOptions } from './visualBands.ts';
import type { RasterImage } from './raster.ts';
import type {
  VisualWorkerRequest,
  VisualWorkerResponse,
  WorkerRaster,
} from '../workers/visualComparison.ts';
import type { VisualMode } from './visualPageRenderer.ts';

export interface VisualComparisonJob {
  mode: VisualMode;
  original: RasterImage | null;
  modified: RasterImage | null;
  options: VisualDiffOptions & BandOptions;
  signal?: AbortSignal;
}

export type VisualComparisonOutcome =
  | { mode: 'exact'; diff: VisualPageDiff }
  | { mode: 'aligned'; diff: AlignedPageDiff };

interface PendingJob {
  resolve: (outcome: VisualComparisonOutcome) => void;
  reject: (error: unknown) => void;
}

let worker: Worker | null = null;
let nextJobId = 1;
const pending = new Map<number, PendingJob>();

function workersAvailable(): boolean {
  return typeof Worker !== 'undefined';
}

function disposeWorker(reason: unknown): void {
  worker?.terminate();
  worker = null;
  const abandoned = [...pending.values()];
  pending.clear();
  abandoned.forEach(job => job.reject(reason));
}

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/visualComparison.worker.ts', import.meta.url), {
    type: 'module',
  });
  worker.addEventListener('message', (event: MessageEvent<VisualWorkerResponse>) => {
    const response = event.data;
    const job = pending.get(response.id);
    if (!job) return;
    pending.delete(response.id);
    if (response.ok) job.resolve({ mode: response.mode, diff: response.diff } as VisualComparisonOutcome);
    else job.reject(new Error(response.message));
  });
  worker.addEventListener('error', event => {
    disposeWorker(new Error(event.message || 'The visual comparison worker failed.'));
  });
  return worker;
}

/**
 * Copies a raster into a transferable buffer.
 *
 * The source belongs to a canvas the caller still needs for its overlays, so it
 * is copied rather than detached.
 */
function toWorkerRaster(raster: RasterImage | null): WorkerRaster | null {
  if (!raster) return null;
  const copy = new Uint8ClampedArray(raster.data);
  return { width: raster.width, height: raster.height, data: copy.buffer };
}

function runInline(job: VisualComparisonJob): VisualComparisonOutcome {
  if (job.mode === 'exact') {
    return {
      mode: 'exact',
      diff: compareRasters(job.original, job.modified, { ...job.options, includeMask: true }),
    };
  }
  return {
    mode: 'aligned',
    diff: compareAlignedRasters(job.original, job.modified, { ...job.options, includeMasks: true }),
  };
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Visual comparison was aborted.', 'AbortError');
}

/**
 * Runs one comparison, on the worker where possible.
 *
 * Falls back to running inline when workers are unavailable, so the feature
 * degrades to a slower UI rather than to no result.
 */
export function runVisualComparison(job: VisualComparisonJob): Promise<VisualComparisonOutcome> {
  const { signal } = job;
  if (signal?.aborted) return Promise.reject(abortError(signal));
  if (!workersAvailable()) {
    try {
      return Promise.resolve(runInline(job));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  const id = nextJobId++;
  const original = toWorkerRaster(job.original);
  const modified = toWorkerRaster(job.modified);
  const request: VisualWorkerRequest = {
    id,
    mode: job.mode,
    original,
    modified,
    options: job.options,
  };
  const transfer = [original?.data, modified?.data].filter((buffer): buffer is ArrayBuffer =>
    buffer !== undefined
  );

  return new Promise<VisualComparisonOutcome>((resolve, reject) => {
    const onAbort = () => {
      pending.delete(id);
      // A running comparison cannot be interrupted, so the worker is discarded
      // rather than left to finish work nobody wants.
      disposeWorker(abortError(signal as AbortSignal));
      reject(abortError(signal as AbortSignal));
    };

    pending.set(id, {
      resolve: outcome => {
        signal?.removeEventListener('abort', onAbort);
        resolve(outcome);
      },
      reject: error => {
        signal?.removeEventListener('abort', onAbort);
        reject(error);
      },
    });
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      ensureWorker().postMessage(request, transfer);
    } catch (error) {
      pending.delete(id);
      signal?.removeEventListener('abort', onAbort);
      reject(error);
    }
  });
}

/** Releases the worker. Exposed for tests and teardown. */
export function shutdownVisualWorker(): void {
  disposeWorker(new Error('The visual comparison worker was shut down.'));
}
