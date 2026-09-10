import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  PDFDropZone,
  DiffView,
  DiffStats as DiffStatsComponent,
  PrivacyBanner,
  PrivacyFeatures,
  ViewModeTabs,
  VisualDiffView,
  VisualScan,
  OcrPanel,
  PageSelector,
  ThemeToggle,
  ExportButton,
} from './components';
import type { ViewMode, Theme } from './components';
import { openPdfSession } from './utils/pdfUtils';
import { usePdfSlot } from './hooks/usePdfSlot';
import type { LoadedPdf } from './hooks/usePdfSlot';

type PdfSide = 'original' | 'modified';
type PdfRequest = { controller: AbortController };
import { compareDocuments } from './utils/diffUtils';
import type { VisualScanResult } from './utils/visualScan';
import { applyOcrPages, findPagesNeedingOcr } from './utils/ocrDocument';
import type { OcrTarget } from './utils/ocrDocument';
import type { PDFPage } from './utils/pdfModel';
import './App.css';

function App() {
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [modifiedFile, setModifiedFile] = useState<File | null>(null);
  const [original, adoptOriginal] = usePdfSlot();
  const [modified, adoptModified] = usePdfSlot();
  const [busy, setBusy] = useState<Record<PdfSide, boolean>>({ original: false, modified: false });
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('side-by-side');
  const [currentPage, setCurrentPage] = useState(1);
  const [showAllPages, setShowAllPages] = useState(false);
  const [visualScan, setVisualScan] = useState<VisualScanResult | null>(null);
  const [ocrPages, setOcrPages] = useState<Record<PdfSide, Record<number, PDFPage>>>({
    original: {},
    modified: {},
  });
  const [isExporting, setIsExporting] = useState(false);
  // One request identity per side: replacing the original must not cancel work
  // already under way on the modified document.
  const activeRequests = useRef<Record<PdfSide, PdfRequest | null>>({
    original: null,
    modified: null,
  });
  const [theme, setTheme] = useState<Theme>(() => {
    const savedTheme = localStorage.getItem('pdf-diff-theme') as Theme;
    return savedTheme || 'system';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('pdf-diff-theme', theme);
  }, [theme]);

  useEffect(() => () => {
    Object.values(activeRequests.current).forEach(request => request?.controller.abort());
  }, []);

  const isCurrent = useCallback(
    (side: PdfSide, request: PdfRequest) => activeRequests.current[side] === request,
    []
  );

  const beginRequest = useCallback((side: PdfSide): PdfRequest => {
    activeRequests.current[side]?.controller.abort();
    const request = { controller: new AbortController() };
    activeRequests.current[side] = request;
    setBusy(current => ({ ...current, [side]: true }));
    return request;
  }, []);

  const finishRequest = useCallback((side: PdfSide, request: PdfRequest) => {
    if (activeRequests.current[side] !== request) return;
    activeRequests.current[side] = null;
    setBusy(current => ({ ...current, [side]: false }));
  }, []);

  const abortSide = useCallback((side: PdfSide) => {
    activeRequests.current[side]?.controller.abort();
    activeRequests.current[side] = null;
  }, []);

  /**
   * Opens a PDF, extracts its text, and hands the still-open session to the
   * caller. A session that loses its race is destroyed instead of leaking.
   */
  const loadPdf = useCallback(async (
    file: File,
    side: PdfSide,
    request: PdfRequest
  ): Promise<LoadedPdf | null> => {
    const session = await openPdfSession(file, request.controller.signal);

    try {
      const doc = await session.extractDocument(request.controller.signal);
      if (!isCurrent(side, request)) {
        await session.destroy();
        return null;
      }
      return { doc, session };
    } catch (error) {
      await session.destroy();
      throw error;
    }
  }, [isCurrent]);

  /** Loads both sides together, destroying a survivor if its partner fails. */
  const loadPdfPair = useCallback(async (
    entries: readonly { file: File; side: PdfSide; request: PdfRequest }[]
  ): Promise<(LoadedPdf | null)[]> => {
    const results = await Promise.allSettled(
      entries.map(entry => loadPdf(entry.file, entry.side, entry.request))
    );
    const loaded = results.map(result => result.status === 'fulfilled' ? result.value : null);
    const rejected = results.find(result => result.status === 'rejected');

    if (rejected) {
      await Promise.all(loaded.map(entry => entry?.session.destroy()));
      throw rejected.reason;
    }
    return loaded;
  }, [loadPdf]);

  const handleFile = useCallback(async (
    side: PdfSide,
    file: File,
    adopt: (next: LoadedPdf | null) => void
  ) => {
    const request = beginRequest(side);
    (side === 'original' ? setOriginalFile : setModifiedFile)(file);
    adopt(null);
    setOcrPages(current => ({ ...current, [side]: {} }));
    setError(null);
    try {
      const loaded = await loadPdf(file, side, request);
      if (loaded) adopt(loaded);
    } catch {
      if (isCurrent(side, request)) {
        setError(`Failed to process the ${side} PDF. Please try another file.`);
      }
    } finally {
      finishRequest(side, request);
    }
  }, [beginRequest, finishRequest, isCurrent, loadPdf]);

  const handleOriginalFile = useCallback(
    (file: File) => handleFile('original', file, adoptOriginal),
    [adoptOriginal, handleFile]
  );

  const handleModifiedFile = useCallback(
    (file: File) => handleFile('modified', file, adoptModified),
    [adoptModified, handleFile]
  );

  const handleReset = useCallback(() => {
    abortSide('original');
    abortSide('modified');
    setBusy({ original: false, modified: false });
    setOriginalFile(null);
    setModifiedFile(null);
    adoptOriginal(null);
    adoptModified(null);
    setError(null);
    setCurrentPage(1);
    setVisualScan(null);
    setOcrPages({ original: {}, modified: {} });
  }, [abortSide, adoptOriginal, adoptModified]);

  const handleTryDemo = useCallback(async () => {
    const requests: Record<PdfSide, PdfRequest> = {
      original: beginRequest('original'),
      modified: beginRequest('modified'),
    };
    const stale = () => !isCurrent('original', requests.original)
      || !isCurrent('modified', requests.modified);

    try {
      setError(null);
      adoptOriginal(null);
      adoptModified(null);
      setOcrPages({ original: {}, modified: {} });

      const [originalResponse, modifiedResponse] = await Promise.all([
        fetch('/demo-original.pdf', { signal: requests.original.controller.signal }),
        fetch('/demo-modified.pdf', { signal: requests.modified.controller.signal })
      ]);
      const [originalBlob, modifiedBlob] = await Promise.all([
        originalResponse.blob(),
        modifiedResponse.blob()
      ]);
      const originalFile = new File([originalBlob], 'demo-original.pdf', { type: 'application/pdf' });
      const modifiedFile = new File([modifiedBlob], 'demo-modified.pdf', { type: 'application/pdf' });

      if (stale()) return;
      setOriginalFile(originalFile);
      setModifiedFile(modifiedFile);

      const [loadedOriginal, loadedModified] = await loadPdfPair([
        { file: originalFile, side: 'original', request: requests.original },
        { file: modifiedFile, side: 'modified', request: requests.modified },
      ]);

      if (loadedOriginal) adoptOriginal(loadedOriginal);
      if (loadedModified) adoptModified(loadedModified);
    } catch {
      if (!stale()) setError('Failed to load demo PDFs. Please try again.');
    } finally {
      finishRequest('original', requests.original);
      finishRequest('modified', requests.modified);
    }
  }, [adoptOriginal, adoptModified, beginRequest, finishRequest, isCurrent, loadPdfPair]);

  /** Documents as compared: the extracted text, with recognized pages folded in. */
  const documents = useMemo(() => ({
    original: applyOcrPages(original?.doc ?? null, ocrPages.original),
    modified: applyOcrPages(modified?.doc ?? null, ocrPages.modified),
  }), [modified, ocrPages, original]);

  const comparisonResult = useMemo(
    () => documents.original && documents.modified
      ? compareDocuments(documents.original, documents.modified)
      : null,
    [documents]
  );

  const ocrTargets = useMemo(() => findPagesNeedingOcr(documents), [documents]);
  const sessions = useMemo(() => ({
    original: original?.session ?? null,
    modified: modified?.session ?? null,
  }), [modified, original]);

  const handlePageRecognized = useCallback((target: OcrTarget, page: PDFPage) => {
    setOcrPages(current => ({
      ...current,
      [target.side]: { ...current[target.side], [target.pageNumber]: page },
    }));
  }, []);
  const totalPages = comparisonResult?.pageDiffs.length ?? 0;
  const currentPageDiff = comparisonResult?.pageDiffs[currentPage - 1] ?? comparisonResult?.pageDiffs[0] ?? null;
  // Rendering every page at once has no resource budget yet, so the visual
  // layer deliberately stays on one page pair at a time.
  const isVisualMode = viewMode === 'visual';
  const textViewMode = viewMode === 'visual' ? 'side-by-side' : viewMode;
  const reviewAllPages = showAllPages && !isVisualMode;
  const scanPairs = useMemo(
    () => (comparisonResult?.pageDiffs ?? []).map(pageDiff => ({
      comparisonNumber: pageDiff.pageNumber,
      label: pageDiff.label,
      originalPageNumber: pageDiff.originalPageNumber,
      modifiedPageNumber: pageDiff.modifiedPageNumber,
      textStatus: pageDiff.status,
    })),
    [comparisonResult]
  );
  const stats = reviewAllPages ? comparisonResult?.overallStats : currentPageDiff?.stats;

  useEffect(() => {
    if (totalPages > 0 && currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  /**
   * Exports the report, including visual evidence when a scan has been run.
   *
   * The export path is loaded on demand: jsPDF and the evidence renderer are
   * large, and most sessions never export.
   */
  const handleExport = useCallback(async () => {
    if (!comparisonResult) return;
    setIsExporting(true);
    try {
      const { exportDiffToPDF } = await import('./utils/exportUtils');
      if (!visualScan) {
        exportDiffToPDF(comparisonResult);
        return;
      }

      const { buildVisualEvidence } = await import('./utils/visualEvidence');
      let evidence = null;
      try {
        evidence = await buildVisualEvidence({
          original: original?.session ?? null,
          modified: modified?.session ?? null,
          pairs: scanPairs,
          scan: visualScan,
        });
      } catch {
        // Losing the illustrations must not cost the reader the verdicts.
        evidence = null;
      }
      exportDiffToPDF(comparisonResult, { scan: visualScan, evidence });
    } finally {
      setIsExporting(false);
    }
  }, [comparisonResult, modified, original, scanPairs, visualScan]);

  const isProcessing = busy.original || busy.modified;
  const showComparison = comparisonResult !== null;

  return (
    <div className="app">
      <header className="app-header">
        <a className="wordmark" href="/" aria-label="PDF Diff home">
          <span className="wordmark-mark" aria-hidden="true">D/</span>
          <span>PDF Diff</span>
        </a>
        <div className="header-actions">
          <span className="local-status">
            <span aria-hidden="true" />
            Runs on this device
          </span>
          <nav className="header-nav" aria-label="Project links">
            <a href="/cli.html">CLI</a>
            <a href="https://github.com/qiu2025/diff" target="_blank" rel="noopener noreferrer">GitHub</a>
          </nav>
          <ThemeToggle theme={theme} onThemeChange={setTheme} />
        </div>
      </header>

      <main className="app-main">
        <section className={`hero${showComparison ? ' hero-compact' : ''}`} aria-labelledby="page-title">
          <div className="hero-copy">
            <p className="eyebrow">Document review / Local-first</p>
            <h1 id="page-title">See exactly<br />what changed.</h1>
            <p className="hero-intro">
              Compare the text in two PDF versions without handing either document to a server.
            </p>
            <PrivacyBanner />
          </div>

          <section className="upload-section" aria-labelledby="upload-title">
            <div className="upload-header">
              <div>
                <p className="section-index">01 / New comparison</p>
                <h2 id="upload-title">Choose two documents</h2>
              </div>
              <button type="button" className="demo-btn" onClick={handleTryDemo} disabled={isProcessing}>
                Use sample files
                <span aria-hidden="true">↗</span>
              </button>
            </div>

            {error && (
              <div className="error-banner" role="alert">
                <span aria-hidden="true">!</span>
                <span>{error}</span>
              </div>
            )}

            <div className="upload-grid">
              <PDFDropZone
                label="Original PDF"
                file={originalFile}
                onFileSelect={handleOriginalFile}
                disabled={isProcessing}
              />
              <PDFDropZone
                label="Modified PDF"
                file={modifiedFile}
                onFileSelect={handleModifiedFile}
                disabled={isProcessing}
              />
            </div>

            <div className="upload-footer">
              <span>PDF files · text comparison · no upload</span>
              {(originalFile || modifiedFile) && (
                <button type="button" className="reset-btn" onClick={handleReset}>
                  Clear both files
                </button>
              )}
            </div>

            {isProcessing && (
              <div className="processing-indicator" role="status" aria-live="polite">
                <span className="spinner" aria-hidden="true" />
                Reading documents…
              </div>
            )}
          </section>
        </section>

        {showComparison && (
          <section className="comparison-section" aria-labelledby="results-title">
            <div className="comparison-header">
              <div>
                <p className="section-index">02 / Review</p>
                <h2 id="results-title">Comparison results</h2>
              </div>
              <div className="comparison-actions">
                <ViewModeTabs activeMode={viewMode} onModeChange={setViewMode} />
                <ExportButton
                  onClick={handleExport}
                  disabled={!comparisonResult || isExporting}
                  busy={isExporting}
                />
              </div>
            </div>

            <OcrPanel
              sessions={sessions}
              documents={documents}
              targets={ocrTargets}
              onPageRecognized={handlePageRecognized}
            />

            {comparisonResult.diagnostics.length > 0 && (
              <div className="comparison-warning" role="status">
                <strong>Text comparison incomplete</strong>
                <span>
                  {comparisonResult.diagnostics.length} page comparison{comparisonResult.diagnostics.length === 1 ? '' : 's'} contain no extractable text. Visual comparison or OCR is required to verify them.
                </span>
              </div>
            )}

            {stats && <DiffStatsComponent {...stats} />}

            {totalPages > 1 && (
              <div className="page-controls">
                <PageSelector
                  currentPage={currentPage}
                  totalPages={totalPages}
                  pageLabel={currentPageDiff?.label}
                  onPageChange={setCurrentPage}
                  disabled={reviewAllPages}
                />
                <label className="show-all-checkbox">
                  <input
                    type="checkbox"
                    checked={reviewAllPages}
                    disabled={isVisualMode}
                    onChange={(e) => setShowAllPages(e.target.checked)}
                  />
                  <span>
                    {isVisualMode ? 'Visual review runs one page at a time' : 'Review all pages'}
                  </span>
                </label>
              </div>
            )}

            {isVisualMode ? (
              currentPageDiff && (
                <>
                  <VisualScan
                    originalSession={original?.session ?? null}
                    modifiedSession={modified?.session ?? null}
                    pairs={scanPairs}
                    currentComparison={currentPageDiff.pageNumber}
                    onSelectPage={setCurrentPage}
                    onResult={setVisualScan}
                  />
                  <VisualDiffView
                    originalSession={original?.session ?? null}
                    originalPageNumber={currentPageDiff.originalPageNumber}
                    modifiedSession={modified?.session ?? null}
                    modifiedPageNumber={currentPageDiff.modifiedPageNumber}
                    textStatus={currentPageDiff.status}
                  />
                </>
              )
            ) : reviewAllPages ? (
              <div className="all-pages-view">
                {comparisonResult.pageDiffs.map(({ pageNumber, label, parts, originalText, modifiedText, stats: pageStats, status }) => (
                  <section key={pageNumber} className="page-section" aria-labelledby={`page-${pageNumber}-title`}>
                    <div className="page-section-header">
                      <h3 id={`page-${pageNumber}-title`}>{label}</h3>
                      <div className="page-stats" aria-label={`${pageStats.additions} additions and ${pageStats.deletions} removals`}>
                        {status === 'indeterminate' ? (
                          <span className="stat-badge indeterminate">Text unavailable</span>
                        ) : (
                          <>
                            <span className="stat-badge additions">+{pageStats.additions}</span>
                            <span className="stat-badge deletions">−{pageStats.deletions}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <DiffView
                      parts={parts}
                      mode={textViewMode}
                      originalText={originalText}
                      modifiedText={modifiedText}
                    />
                  </section>
                ))}
              </div>
            ) : (
              currentPageDiff && (
                <DiffView
                  parts={currentPageDiff.parts}
                  mode={textViewMode}
                  originalText={currentPageDiff.originalText}
                  modifiedText={currentPageDiff.modifiedText}
                />
              )
            )}
          </section>
        )}

        {!showComparison && <PrivacyFeatures />}
      </main>

      <footer className="app-footer">
        <p>PDF Diff — a small, local document review tool.</p>
        <div className="footer-links">
          <a href="https://github.com/qiu2025/diff" target="_blank" rel="noopener noreferrer">Source</a>
          <a href="/cli.html">CLI documentation</a>
        </div>
      </footer>
    </div>
  );
}

export default App;
