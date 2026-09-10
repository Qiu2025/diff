import { useCallback, useEffect, useRef, useState } from 'react';

import { describeScanSummary, scanDocumentVisually } from '../utils/visualScan';
import type { ScanPagePair, VisualPageSummary, VisualScanResult } from '../utils/visualScan';
import type { ComparisonStatus } from '../utils/diffUtils';
import type { PdfSession } from '../utils/pdfUtils';
import './VisualScan.css';

interface VisualScanProps {
  originalSession: PdfSession | null;
  modifiedSession: PdfSession | null;
  pairs: readonly (ScanPagePair & { textStatus: ComparisonStatus })[];
  currentComparison: number;
  onSelectPage: (comparisonNumber: number) => void;
}

interface ScanState {
  phase: 'idle' | 'running' | 'done' | 'error';
  completed: number;
  total: number;
  result: VisualScanResult | null;
  message?: string;
}

const IDLE: ScanState = { phase: 'idle', completed: 0, total: 0, result: null };

const STATUS_LABELS = {
  equal: 'Same',
  different: 'Changed',
  indeterminate: 'Unknown',
} as const;

const TEXT_STATUS_LABELS = {
  equal: 'text same',
  different: 'text changed',
  indeterminate: 'no text',
} as const;

function describeBands(page: VisualPageSummary): string {
  if (!page.bandCounts) return page.error ?? 'Not compared';
  const { added, removed, changed, moved } = page.bandCounts;
  const parts: string[] = [];
  if (added) parts.push(`+${added}`);
  if (removed) parts.push(`−${removed}`);
  if (changed) parts.push(`~${changed}`);
  if (parts.length === 0) return moved > 0 ? 'moved only' : 'no change';
  return `${parts.join(' ')} lines${moved ? `, ${moved} moved` : ''}`;
}

export function VisualScan({
  originalSession,
  modifiedSession,
  pairs,
  currentComparison,
  onSelectPage,
}: VisualScanProps) {
  const [state, setState] = useState<ScanState>(IDLE);
  const controller = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);
  // A new pair of documents invalidates any verdicts already on screen.
  useEffect(() => {
    cancel();
    setState(IDLE);
  }, [cancel, originalSession, modifiedSession]);

  const run = useCallback(async () => {
    cancel();
    const own = new AbortController();
    controller.current = own;
    setState({ phase: 'running', completed: 0, total: pairs.length, result: null });

    try {
      const result = await scanDocumentVisually({
        original: originalSession,
        modified: modifiedSession,
        pairs,
        signal: own.signal,
        onProgress: (completed, total) => {
          if (controller.current !== own) return;
          setState(current => (
            current.phase === 'running' ? { ...current, completed, total } : current
          ));
        },
      });
      if (controller.current !== own) return;
      setState({ phase: 'done', completed: pairs.length, total: pairs.length, result });
    } catch (error) {
      if (controller.current !== own || own.signal.aborted) return;
      setState({
        phase: 'error',
        completed: 0,
        total: pairs.length,
        result: null,
        message: error instanceof Error ? error.message : 'The scan could not be completed.',
      });
    } finally {
      if (controller.current === own) controller.current = null;
    }
  }, [cancel, modifiedSession, originalSession, pairs]);

  return (
    <section className="visual-scan" aria-labelledby="visual-scan-title">
      <div className="visual-scan-header">
        <div>
          <h3 id="visual-scan-title">Every page</h3>
          <p>
            {state.phase === 'done' && state.result
              ? describeScanSummary(state.result)
              : 'Compare the rendered pages of the whole document, including pages with no text.'}
          </p>
        </div>
        {state.phase === 'running' ? (
          <div className="visual-scan-progress">
            <span aria-live="polite">
              Comparing page {Math.min(state.completed + 1, state.total)} of {state.total}…
            </span>
            <button type="button" className="scan-btn" onClick={cancel}>Stop</button>
          </div>
        ) : (
          <button type="button" className="scan-btn primary" onClick={run}>
            {state.phase === 'done' ? 'Scan again' : 'Scan all pages'}
          </button>
        )}
      </div>

      {state.phase === 'error' && (
        <p className="visual-scan-error" role="alert">{state.message}</p>
      )}

      {state.phase === 'done' && state.result && (
        <ol className="visual-scan-list">
          {state.result.pages.map(page => {
            const textStatus = pairs.find(
              pair => pair.comparisonNumber === page.comparisonNumber
            )?.textStatus;

            return (
              <li key={page.comparisonNumber}>
                <button
                  type="button"
                  className={`visual-scan-row${
                    page.comparisonNumber === currentComparison ? ' current' : ''}`}
                  onClick={() => onSelectPage(page.comparisonNumber)}
                >
                  <span className={`scan-status ${page.status}`}>
                    {STATUS_LABELS[page.status]}
                  </span>
                  <span className="scan-label">{page.label}</span>
                  <span className="scan-detail">{describeBands(page)}</span>
                  {textStatus && (
                    <span className={`scan-text-status ${textStatus}`}>
                      {TEXT_STATUS_LABELS[textStatus]}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {state.phase === 'done' && state.result && state.result.scale > 0 && (
        <p className="visual-scan-note">
          Swept at ≈{Math.round(state.result.scale * 72)} DPI. Open a page for a full-resolution
          comparison.
        </p>
      )}
    </section>
  );
}
