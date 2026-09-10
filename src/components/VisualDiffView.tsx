import { useCallback, useEffect, useRef, useState } from 'react';

import { compareRenderedPages } from '../utils/visualPageRenderer';
import type { VisualMode, VisualPageComparison } from '../utils/visualPageRenderer';
import { describeVisualStatus } from '../utils/visualDiff';
import type { VisualStatus } from '../utils/visualDiff';
import type { VisualRegion } from '../utils/raster';
import { describeAlignedStatus } from '../utils/visualBands';
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

type Layout = 'marked' | 'pages';

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
  engine: VisualMode;
  comparison: VisualPageComparison | null;
  error?: string;
}

const STATUS_LABELS: Record<VisualStatus, string> = {
  equal: 'Identical',
  different: 'Different',
  indeterminate: 'Unavailable',
};

const REGION_LABELS = {
  removed: 'removed',
  added: 'added',
  recoloured: 'recoloured',
  mixed: 'changed',
} as const;

const ENGINE_HELP: Record<VisualMode, string> = {
  aligned: 'Content that only moved down the page is reported as moved, not as changed.',
  exact: 'Every pixel is compared where it sits, so shifted content counts as changed.',
};

/**
 * Text and pixels are separate evidence. When they disagree the difference is
 * the interesting part, so it is stated instead of being averaged away.
 */
function reconcile(textStatus: ComparisonStatus, visualStatus: VisualStatus): string | null {
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
          {showRegions && (
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
          )}
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
  const [engine, setEngine] = useState<VisualMode>('aligned');
  const [layout, setLayout] = useState<Layout>('marked');
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
    const inputs = {
      originalSession,
      originalPageNumber,
      modifiedSession,
      modifiedPageNumber,
      engine,
    };

    compareRenderedPages(original, modified, { mode: engine, signal: controller.signal }).then(
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
  }, [adopt, engine, originalSession, originalPageNumber, modifiedSession, modifiedPageNumber]);

  const isCurrent = result !== null
    && result.originalSession === originalSession
    && result.originalPageNumber === originalPageNumber
    && result.modifiedSession === modifiedSession
    && result.modifiedPageNumber === modifiedPageNumber
    && result.engine === engine;

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

  const comparison = result.comparison;
  const { diff, images, scale } = comparison;
  const aligned = comparison.mode === 'aligned' ? comparison.diff : null;
  const note = reconcile(textStatus, diff.status);
  const headline = aligned ? describeAlignedStatus(aligned) : describeVisualStatus(diff);
  const removedRegions = aligned?.removedRegions ?? [];
  const regionSummary = diff.regions.length + removedRegions.length === 0
    ? null
    : `${diff.regions.length + removedRegions.length} marked area${
      diff.regions.length + removedRegions.length === 1 ? '' : 's'}`;
  // Exact mode paints removals and additions on one image; aligned mode marks
  // each page with what happened to it, so both pages have to be shown.
  const singlePane = layout === 'marked' && !aligned;

  return (
    <div className="visual-diff">
      <div className="visual-summary">
        <span className={`visual-status ${diff.status}`}>{STATUS_LABELS[diff.status]}</span>
        <span className="visual-headline">{headline}</span>
        {regionSummary && <span className="visual-meta">{regionSummary}</span>}
        <span className="visual-meta">Rendered at ≈{Math.round(scale * 72)} DPI</span>
      </div>

      {aligned && diff.status !== 'indeterminate' && (
        <dl className="visual-bands" aria-label="Content bands by outcome">
          <div className="added"><dt>Added</dt><dd>{aligned.bandCounts.added}</dd></div>
          <div className="removed"><dt>Removed</dt><dd>{aligned.bandCounts.removed}</dd></div>
          <div className="changed"><dt>Edited</dt><dd>{aligned.bandCounts.changed}</dd></div>
          <div className="moved"><dt>Moved</dt><dd>{aligned.bandCounts.moved}</dd></div>
          <div className="equal"><dt>Unchanged</dt><dd>{aligned.bandCounts.equal}</dd></div>
        </dl>
      )}

      {note && <p className="visual-note">{note}</p>}

      {diff.diagnostics.map(diagnostic => (
        <p key={diagnostic.code} className="visual-note warning">{diagnostic.message}</p>
      ))}

      <div className="visual-controls">
        <div className="visual-mode" role="group" aria-label="Comparison engine">
          <button
            type="button"
            className={engine === 'aligned' ? 'active' : ''}
            aria-pressed={engine === 'aligned'}
            onClick={() => setEngine('aligned')}
          >
            Aligned
          </button>
          <button
            type="button"
            className={engine === 'exact' ? 'active' : ''}
            aria-pressed={engine === 'exact'}
            onClick={() => setEngine('exact')}
          >
            Exact
          </button>
        </div>
        <div className="visual-mode" role="group" aria-label="Page layout">
          <button
            type="button"
            className={layout === 'marked' ? 'active' : ''}
            aria-pressed={layout === 'marked'}
            onClick={() => setLayout('marked')}
          >
            Marked up
          </button>
          <button
            type="button"
            className={layout === 'pages' ? 'active' : ''}
            aria-pressed={layout === 'pages'}
            onClick={() => setLayout('pages')}
          >
            Plain pages
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
        {layout === 'marked' && (
          <ul className="visual-legend">
            <li className="removed">Removed</li>
            <li className="added">Added</li>
            <li className="recoloured">Recoloured</li>
          </ul>
        )}
      </div>

      <p className="visual-engine-help">{ENGINE_HELP[engine]}</p>

      {singlePane ? (
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
            url={layout === 'marked' ? images.originalOverlay ?? images.original : images.original}
            regions={removedRegions}
            showRegions={showRegions}
          />
          <PagePane
            title="Modified"
            url={layout === 'marked' ? images.overlay ?? images.modified : images.modified}
            regions={layout === 'marked' ? diff.regions : []}
            showRegions={showRegions}
          />
        </div>
      )}
    </div>
  );
}
