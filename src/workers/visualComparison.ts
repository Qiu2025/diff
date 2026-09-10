/**
 * Message contract between the application and its visual comparison worker.
 *
 * Rasters and masks cross the boundary as transferable `ArrayBuffer`s, so a
 * full-page image is never copied.
 */

import type { VisualDiffOptions, VisualPageDiff } from '../utils/visualDiff.ts';
import type { AlignedPageDiff, BandOptions } from '../utils/visualBands.ts';
import type { VisualMode } from '../utils/visualPageRenderer.ts';

export interface WorkerRaster {
  width: number;
  height: number;
  /** RGBA bytes. Transferred, so the sender loses access to it. */
  data: ArrayBuffer;
}

export interface VisualWorkerRequest {
  id: number;
  mode: VisualMode;
  original: WorkerRaster | null;
  modified: WorkerRaster | null;
  options: VisualDiffOptions & BandOptions;
}

export type VisualWorkerResponse =
  | { id: number; ok: true; mode: 'exact'; diff: VisualPageDiff }
  | { id: number; ok: true; mode: 'aligned'; diff: AlignedPageDiff }
  | { id: number; ok: false; message: string };
