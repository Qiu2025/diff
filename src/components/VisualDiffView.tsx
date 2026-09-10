import { useCallback, useEffect, useRef, useState } from 'react';

import { compareRenderedPages } from '../utils/visualPageRenderer';
import type { VisualPageComparison } from '../utils/visualPageRenderer';
import { describeVisualStatus } from '../utils/visualDiff';
import type { VisualRegion } from '../utils/visualDiff';
import type { ComparisonStatus } from '../utils/diffUtils';
import type { PdfSession } from '../utils/pdfUtils';
import './VisualDiffView.css';

interface VisualDiffViewProps {
  originalSession: PdfSession | null;
  originalPageNumber: number | null;
  modifiedSession: PdfSession | null;
  modifiedPageNumber: number | null;
  /** Text-layer verdict for the same page pair, reported independently. */
  textStatus: ComparisonStatus;
}

type DisplayMode = 'overlay' | 'side-by-side';

/**
 * A finished run, tagged with the inputs that produced it. Tagging lets the
 * render decide whether the stored result still describes what is on screen,
 * so no state has to be reset synchronously when the page selection changes.
 */
interface VisualResult {
  originalSession: PdfSession | null;
  originalPageNumber: number | null;
  modifiedSession: PdfSession | null;
  modifiedPageNumber: number | null;
  comparison: VisualPageComparison | null;
  error?: string;
}

const STATUS_LABELS = {
  equal: 'Identical',
  different: 'Different',
  indeterminate: 'Unavailable',
} as const;

const REGION_LABELS = {
  removed: 'removed',
  added: 'added',
  recoloured: 'recoloured',
  mixed: 'changed',
} as const;

/**
 * Text and pixels are separate evidence. When they disagree the difference is
 * the interesting part, so it is stated instead of being averaged away.
 */
function reconcile(textStatus: ComparisonStatus, visualStatus: ComparisonStatus): string | null {
  if (textStatus === 'equal' && visualStatus === 'different') {
    return 'The extracted text is identical, but the pages do not render the same. '
      + 'The change is visual: layout, spacing, images, or formatting.';
  }
  if (textStatus === 'different' && visualStatus === 'equal') {
    return 'The extracted text differs, but the pages render identically. '
      + 'This usually means invisible or overlapping text changed.';
  }
  if (textStatus === 'indeterminate' && visualStatus !== 'indeterminate') {
    return 'No text could be extracted from this page, so the rendered comparison is the only evidence.';
  }
  return null;
}

function regionStyle(region: VisualRegion) {
  return {
    left: `${region.x * 100}%`,
    top: `${region.y * 100}%`,
    width: `${region.width * 100}%`,
    height: `${region.height * 100}%`,
  };
}

function RegionOverlay({ regions }: { regions: VisualRegion[] }) {
  return (
    <div className="visual-regions" aria-hidden="true">
      {regions.map((region, index) => (
        <span
          key={index}
          className={`visual-region ${region.kind}`}
          style={regionStyle(region)}
          title={`${region.changedPixels} pixels ${REGION_LABELS[region.kind]}`}
        />
      ))}
    </div>
  );
}

function PagePane({
  title,
  url,
  regions,
  showRegions,
}: {
  title: string;
  url: string | null;
  regions: VisualRegion[];
  showRegions: boolean;
}) {
  return (
    <figure className="visual-pane">
      <figcaption>{title}</figcaption>
      {url ? (
        <div className="visual-page">
          <img src={url} alt={`${title} page render`} />
          {showRegions && <RegionOverlay regions={regions} />}
        </div>
      ) : (
        <p className="visual-missing">This page does not exist in this document.</p>
      )}
    </figure>
  );
}

export function VisualDiffView({
  originalSession,
  originalPageNumber,
  modifiedSession,
  modifiedPageNumber,
  textStatus,
}: VisualDiffViewProps) {
  const [result, setResult] = useState<VisualResult | null>(null);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('overlay');
  const [showRegions, setShowRegions] = useState(true);
  const active = useRef<VisualPageComparison | null>(null);

  const adopt = useCallback((comparison: VisualPageComparison | null) => {
    const previous = active.current;
    active.current = comparison;
    if (previous && previous !== comparison) previous.release();
  }, []);

  useEffect(() => () => adopt(null), [adopt]);

  useEffect(() => {
    const original = originalSession && originalPageNumber !== null
      ? { session: originalSession, pageNumber: originalPageNumber }
      : null;
    const modified = modifiedSession && modifiedPageNumber !== null
      ? { session: modifiedSession, pageNumber: modifiedPageNumber }
      : null;
    // The previous render is released before the next one starts so two
    // full-page rasters are never held at once.
    adopt(null);
    if (!original && !modified) return;

    const controller = new AbortController();
    let cancelled = false;
    const inputs = { originalSession, originalPageNumber, modifiedSession, modifiedPageNumber };

    compareRenderedPages(original, modified, { signal: controller.signal }).then(
      comparison => {
        if (cancelled) {
          comparison.release();
          return;
        }
        adopt(comparison);
        setResult({ ...inputs, comparison });
      },
      (error: unknown) => {
        if (cancelled || controller.signal.aborted) return;
        setResult({
          ...inputs,
          comparison: null,
          error: error instanceof Error ? error.message : 'The pages could not be rendered.',
        });
      }
    );

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [adopt, originalSession, originalPageNumber, modifiedSession, modifiedPageNumber]);

  const isCurrent = result !== null
    && result.originalSession === originalSession
    && result.originalPageNumber === originalPageNumber
    && result.modifiedSession === modifiedSession
    && result.modifiedPageNumber === modifiedPageNumber;

  if (!isCurrent || !result) {
    return (
      <div className="visual-diff" role="status" aria-live="polite">
        <div className="visual-loading">
          <span className="spinner" aria-hidden="true" />
          Rendering both pages on this device…
        </div>
      </div>
    );
  }

  if (!result.comparison) {
    return (
      <div className="visual-diff">
        <div className="visual-error" role="alert">
          <strong>Visual comparison failed</strong>
          <span>{result.error ?? 'The pages could not be rendered.'}</span>
        </div>
      </div>
    );
  }

  const { diff, images, scale } = result.comparison;
  const note = reconcile(textStatus, diff.status);
  const regionSummary = diff.regions.length === 0
    ? null
    : `${diff.regions.length} change region${diff.regions.length === 1 ? '' : 's'}`;

  return (
    <div className="visual-diff">
      <div className="visual-summary">
        <span className={`visual-status ${diff.status}`}>{STATUS_LABELS[diff.status]}</span>
        <span className="visual-headline">{describeVisualStatus(diff)}</span>
        {regionSummary && <span className="visual-meta">{regionSummary}</span>}
        <span className="visual-meta">Rendered at ≈{Math.round(scale * 72)} DPI</span>
      </div>

      {note && <p className="visual-note">{note}</p>}

      {diff.diagnostics.map(diagnostic => (
        <p key={diagnostic.code} className="visual-note warning">{diagnostic.message}</p>
      ))}

      <div className="visual-controls">
        <div className="visual-mode" role="group" aria-label="Visual comparison layout">
          <button
            type="button"
            className={displayMode === 'overlay' ? 'active' : ''}
            aria-pressed={displayMode === 'overlay'}
            onClick={() => setDisplayMode('overlay')}
          >
            Overlay
          </button>
          <button
            type="button"
            className={displayMode === 'side-by-side' ? 'active' : ''}
            aria-pressed={displayMode === 'side-by-side'}
            onClick={() => setDisplayMode('side-by-side')}
          >
            Side by side
          </button>
        </div>
        <label className="visual-toggle">
          <input
            type="checkbox"
            checked={showRegions}
            onChange={event => setShowRegions(event.target.checked)}
          />
          <span>Outline changed areas</span>
        </label>
        {displayMode === 'overlay' && (
          <ul className="visual-legend">
            <li className="removed">Removed</li>
            <li className="added">Added</li>
            <li className="recoloured">Recoloured</li>
          </ul>
        )}
      </div>

      {displayMode === 'overlay' ? (
        <PagePane
          title="Changes on the modified page"
          url={images.overlay}
          regions={diff.regions}
          showRegions={showRegions}
        />
      ) : (
        <div className="visual-pair">
          <PagePane
            title="Original"
            url={images.original}
            regions={diff.regions}
            showRegions={showRegions}
          />
          <PagePane
            title="Modified"
            url={images.modified}
            regions={diff.regions}
            showRegions={showRegions}
          />
        </div>
      )}
    </div>
  );
}
