import { useCallback, useEffect, useRef, useState } from 'react';

import { checkOcrAvailability } from '../utils/ocr';
import type { OcrAvailability } from '../utils/ocr';
import { runOcrSweep } from '../utils/ocrDocument';
import type { OcrTarget, PdfSideName } from '../utils/ocrDocument';
import type { PDFDocument, PDFPage } from '../utils/pdfModel';
import type { PdfSession } from '../utils/pdfUtils';
import './OcrPanel.css';

interface OcrPanelProps {
  sessions: Record<PdfSideName, PdfSession | null>;
  documents: Record<PdfSideName, PDFDocument | null>;
  targets: readonly OcrTarget[];
  onPageRecognized: (target: OcrTarget, page: PDFPage) => void;
}

interface SweepState {
  phase: 'idle' | 'running' | 'done' | 'error';
  completed: number;
  total: number;
  message?: string;
}

const IDLE: SweepState = { phase: 'idle', completed: 0, total: 0 };

function pages(count: number): string {
  return count === 1 ? '1 page' : `${count} pages`;
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

/**
 * Offers OCR for the pages a PDF's own text layer leaves empty.
 *
 * The offer is explicit and states the download, because downloading a
 * recognition model and uploading a document are different actions and a
 * privacy-first tool must not let them blur together.
 */
export function OcrPanel({ sessions, documents, targets, onPageRecognized }: OcrPanelProps) {
  const [availability, setAvailability] = useState<OcrAvailability | null>(null);
  const [state, setState] = useState<SweepState>(IDLE);
  const controller = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  // A new pair of documents starts a new question.
  useEffect(() => {
    cancel();
    setState(IDLE);
  }, [cancel, sessions]);

  useEffect(() => {
    let active = true;
    checkOcrAvailability().then(result => {
      if (active) setAvailability(result);
    });
    return () => { active = false; };
  }, []);

  const run = useCallback(async () => {
    cancel();
    const own = new AbortController();
    controller.current = own;
    setState({ phase: 'running', completed: 0, total: targets.length });

    try {
      await runOcrSweep({
        sessions,
        documents,
        targets,
        signal: own.signal,
        onPage: onPageRecognized,
        onProgress: (completed, total) => {
          if (controller.current !== own) return;
          setState({ phase: 'running', completed, total });
        },
      });
      if (controller.current !== own) return;
      setState({ phase: 'done', completed: targets.length, total: targets.length });
    } catch (error) {
      if (controller.current !== own || own.signal.aborted) return;
      setState({
        phase: 'error',
        completed: 0,
        total: targets.length,
        message: error instanceof Error ? error.message : 'Recognition failed.',
      });
    } finally {
      if (controller.current === own) controller.current = null;
    }
  }, [cancel, documents, onPageRecognized, sessions, targets]);

  // The panel stays mounted after a successful sweep even though nothing is
  // left to recognize: disappearing on success would leave the reader with no
  // idea where the text came from.
  if (targets.length === 0 && state.phase !== 'done') return null;
  const finished = state.phase === 'done';

  return (
    <section className={`ocr-panel${finished ? ' finished' : ''}`} aria-labelledby="ocr-panel-title">
      <div className="ocr-panel-body">
        <h3 id="ocr-panel-title">{finished ? 'Scanned pages read' : 'Read scanned pages'}</h3>
        <p>
          {finished
            ? `${pages(state.completed)} were read with OCR on this device. The comparison below `
              + 'now includes that text.'
            : `${pages(targets.length)} contain no text layer, so they cannot be compared as text. `
              + 'Recognition runs on this device and the documents are not uploaded.'}
        </p>
        {availability?.available && !finished && (
          <p className="ocr-panel-note">
            The first run downloads about {formatMegabytes(availability.downloadBytes)} of
            recognition engine and language data from this site. That is an application download,
            not a document upload.
          </p>
        )}
        {availability && !availability.available && (
          <p className="ocr-panel-note warning">{availability.reason}</p>
        )}
        {state.phase === 'error' && (
          <p className="ocr-panel-note warning" role="alert">{state.message}</p>
        )}
        {finished && (
          <p className="ocr-panel-note">
            Recognition can be wrong. Check anything that matters against the page itself.
          </p>
        )}
      </div>

      {state.phase === 'running' ? (
        <div className="ocr-panel-progress">
          <span aria-live="polite">
            Reading page {Math.min(state.completed + 1, state.total)} of {state.total}…
          </span>
          <button type="button" className="ocr-btn" onClick={cancel}>Stop</button>
        </div>
      ) : targets.length > 0 ? (
        <button
          type="button"
          className="ocr-btn primary"
          onClick={run}
          disabled={!availability?.available}
        >
          Read {pages(targets.length)} with OCR
        </button>
      ) : null}
    </section>
  );
}
