import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  PDFDropZone,
  DiffView,
  DiffStats as DiffStatsComponent,
  PrivacyBanner,
  PrivacyFeatures,
  ViewModeTabs,
  PageSelector,
  ThemeToggle,
  ExportButton,
} from './components';
import type { ViewMode, Theme } from './components';
import { openPdfSession } from './utils/pdfUtils';
import { usePdfSlot } from './hooks/usePdfSlot';
import type { LoadedPdf } from './hooks/usePdfSlot';
import { compareDocuments } from './utils/diffUtils';
import { exportDiffToPDF } from './utils/exportUtils';
import './App.css';

function App() {
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [modifiedFile, setModifiedFile] = useState<File | null>(null);
  const [original, adoptOriginal] = usePdfSlot();
  const [modified, adoptModified] = usePdfSlot();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('side-by-side');
  const [currentPage, setCurrentPage] = useState(1);
  const [showAllPages, setShowAllPages] = useState(false);
  const activeRequest = useRef<{ controller: AbortController } | null>(null);
  const [theme, setTheme] = useState<Theme>(() => {
    const savedTheme = localStorage.getItem('pdf-diff-theme') as Theme;
    return savedTheme || 'system';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('pdf-diff-theme', theme);
  }, [theme]);

  useEffect(() => () => activeRequest.current?.controller.abort(), []);

  const beginRequest = useCallback(() => {
    activeRequest.current?.controller.abort();
    const request = { controller: new AbortController() };
    activeRequest.current = request;
    setIsProcessing(true);
    return request;
  }, []);

  const finishRequest = useCallback((request: { controller: AbortController }) => {
    if (activeRequest.current !== request) return;
    activeRequest.current = null;
    setIsProcessing(false);
  }, []);

  /**
   * Opens a PDF, extracts its text, and hands the still-open session to the
   * caller. A session that loses its race is destroyed instead of leaking.
   */
  const loadPdf = useCallback(async (
    file: File,
    request: { controller: AbortController }
  ): Promise<LoadedPdf | null> => {
    const session = await openPdfSession(file, request.controller.signal);

    try {
      const doc = await session.extractDocument(request.controller.signal);
      if (activeRequest.current !== request) {
        await session.destroy();
        return null;
      }
      return { doc, session };
    } catch (error) {
      await session.destroy();
      throw error;
    }
  }, []);

  /** Loads both sides together, destroying a survivor if its partner fails. */
  const loadPdfPair = useCallback(async (
    files: readonly [File, File],
    request: { controller: AbortController }
  ): Promise<(LoadedPdf | null)[]> => {
    const results = await Promise.allSettled(files.map(file => loadPdf(file, request)));
    const loaded = results.map(result => result.status === 'fulfilled' ? result.value : null);
    const rejected = results.find(result => result.status === 'rejected');

    if (rejected) {
      await Promise.all(loaded.map(entry => entry?.session.destroy()));
      throw rejected.reason;
    }
    return loaded;
  }, [loadPdf]);

  const handleOriginalFile = useCallback(async (file: File) => {
    const request = beginRequest();
    setOriginalFile(file);
    adoptOriginal(null);
    setError(null);
    try {
      const loaded = await loadPdf(file, request);
      if (loaded) adoptOriginal(loaded);
    } catch {
      if (activeRequest.current === request) {
        setError('Failed to process the original PDF. Please try another file.');
      }
    } finally {
      finishRequest(request);
    }
  }, [adoptOriginal, beginRequest, finishRequest, loadPdf]);

  const handleModifiedFile = useCallback(async (file: File) => {
    const request = beginRequest();
    setModifiedFile(file);
    adoptModified(null);
    setError(null);
    try {
      const loaded = await loadPdf(file, request);
      if (loaded) adoptModified(loaded);
    } catch {
      if (activeRequest.current === request) {
        setError('Failed to process the modified PDF. Please try another file.');
      }
    } finally {
      finishRequest(request);
    }
  }, [adoptModified, beginRequest, finishRequest, loadPdf]);

  const handleReset = useCallback(() => {
    activeRequest.current?.controller.abort();
    activeRequest.current = null;
    setIsProcessing(false);
    setOriginalFile(null);
    setModifiedFile(null);
    adoptOriginal(null);
    adoptModified(null);
    setError(null);
    setCurrentPage(1);
  }, [adoptOriginal, adoptModified]);

  const handleTryDemo = useCallback(async () => {
    const request = beginRequest();
    try {
      setError(null);
      adoptOriginal(null);
      adoptModified(null);
      
      // Fetch demo PDFs
      const [originalResponse, modifiedResponse] = await Promise.all([
        fetch('/demo-original.pdf', { signal: request.controller.signal }),
        fetch('/demo-modified.pdf', { signal: request.controller.signal })
      ]);
      
      const [originalBlob, modifiedBlob] = await Promise.all([
        originalResponse.blob(),
        modifiedResponse.blob()
      ]);
      
      // Create File objects
      const originalFile = new File([originalBlob], 'demo-original.pdf', { type: 'application/pdf' });
      const modifiedFile = new File([modifiedBlob], 'demo-modified.pdf', { type: 'application/pdf' });
      
      // Set files
      if (activeRequest.current !== request) return;
      setOriginalFile(originalFile);
      setModifiedFile(modifiedFile);
      
      // Process PDFs
      const [loadedOriginal, loadedModified] = await loadPdfPair([originalFile, modifiedFile], request);
      
      if (loadedOriginal) adoptOriginal(loadedOriginal);
      if (loadedModified) adoptModified(loadedModified);
    } catch {
      if (activeRequest.current === request) {
        setError('Failed to load demo PDFs. Please try again.');
      }
    } finally {
      finishRequest(request);
    }
  }, [adoptOriginal, adoptModified, beginRequest, finishRequest, loadPdfPair]);

  const comparisonResult = useMemo(
    () => original && modified ? compareDocuments(original.doc, modified.doc) : null,
    [original, modified]
  );
  const totalPages = comparisonResult?.pageDiffs.length ?? 0;
  const currentPageDiff = comparisonResult?.pageDiffs[currentPage - 1] ?? comparisonResult?.pageDiffs[0] ?? null;
  const stats = showAllPages ? comparisonResult?.overallStats : currentPageDiff?.stats;

  useEffect(() => {
    if (totalPages > 0 && currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const handleExport = useCallback(() => {
    if (comparisonResult) exportDiffToPDF(comparisonResult);
  }, [comparisonResult]);

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
                <ExportButton onClick={handleExport} disabled={!comparisonResult} />
              </div>
            </div>

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
                  disabled={showAllPages}
                />
                <label className="show-all-checkbox">
                  <input
                    type="checkbox"
                    checked={showAllPages}
                    onChange={(e) => setShowAllPages(e.target.checked)}
                  />
                  <span>Review all pages</span>
                </label>
              </div>
            )}

            {showAllPages ? (
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
                      mode={viewMode}
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
                  mode={viewMode}
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
