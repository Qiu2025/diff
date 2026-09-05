import { useState, useCallback, useMemo, useEffect } from 'react';
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
import { extractTextFromPDF } from './utils/pdfUtils';
import type { PDFDocument } from './utils/pdfUtils';
import { alignPages, combineStats, computeTextDiff, computeStats, formatPagePairLabel } from './utils/diffUtils';
import type { DiffPart, DiffStats, PagePair } from './utils/diffUtils';
import { exportDiffToPDF } from './utils/exportUtils';
import './App.css';

interface PageDiffResult extends PagePair {
  comparisonNumber: number;
  label: string;
  parts: DiffPart[];
  stats: DiffStats;
}

function App() {
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [modifiedFile, setModifiedFile] = useState<File | null>(null);
  const [originalDoc, setOriginalDoc] = useState<PDFDocument | null>(null);
  const [modifiedDoc, setModifiedDoc] = useState<PDFDocument | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('side-by-side');
  const [currentPage, setCurrentPage] = useState(1);
  const [showAllPages, setShowAllPages] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => {
    const savedTheme = localStorage.getItem('pdf-diff-theme') as Theme;
    return savedTheme || 'system';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('pdf-diff-theme', theme);
  }, [theme]);

  const handleOriginalFile = useCallback(async (file: File) => {
    setOriginalFile(file);
    setError(null);
    try {
      setIsProcessing(true);
      const doc = await extractTextFromPDF(file);
      setOriginalDoc(doc);
    } catch {
      setError('Failed to process the original PDF. Please try another file.');
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const handleModifiedFile = useCallback(async (file: File) => {
    setModifiedFile(file);
    setError(null);
    try {
      setIsProcessing(true);
      const doc = await extractTextFromPDF(file);
      setModifiedDoc(doc);
    } catch {
      setError('Failed to process the modified PDF. Please try another file.');
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const handleReset = useCallback(() => {
    setOriginalFile(null);
    setModifiedFile(null);
    setOriginalDoc(null);
    setModifiedDoc(null);
    setError(null);
    setCurrentPage(1);
  }, []);

  const handleTryDemo = useCallback(async () => {
    try {
      setIsProcessing(true);
      setError(null);
      
      // Fetch demo PDFs
      const [originalResponse, modifiedResponse] = await Promise.all([
        fetch('/demo-original.pdf'),
        fetch('/demo-modified.pdf')
      ]);
      
      const [originalBlob, modifiedBlob] = await Promise.all([
        originalResponse.blob(),
        modifiedResponse.blob()
      ]);
      
      // Create File objects
      const originalFile = new File([originalBlob], 'demo-original.pdf', { type: 'application/pdf' });
      const modifiedFile = new File([modifiedBlob], 'demo-modified.pdf', { type: 'application/pdf' });
      
      // Set files
      setOriginalFile(originalFile);
      setModifiedFile(modifiedFile);
      
      // Process PDFs
      const [originalDoc, modifiedDoc] = await Promise.all([
        extractTextFromPDF(originalFile),
        extractTextFromPDF(modifiedFile)
      ]);
      
      setOriginalDoc(originalDoc);
      setModifiedDoc(modifiedDoc);
    } catch {
      setError('Failed to load demo PDFs. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const pagePairs = useMemo(
    () => originalDoc && modifiedDoc ? alignPages(originalDoc.pages, modifiedDoc.pages) : [],
    [originalDoc, modifiedDoc]
  );

  const { diffParts, stats, totalPages, allPagesDiffs, currentPair } = useMemo(() => {
    if (!originalDoc || !modifiedDoc) {
      return { diffParts: null, stats: null, totalPages: 0, allPagesDiffs: null, currentPair: null };
    }

    if (showAllPages) {
      // Compute diffs for all pages
      const allDiffs: PageDiffResult[] = [];
      const allStats: DiffStats[] = [];
      
      for (let i = 0; i < pagePairs.length; i++) {
        const pair = pagePairs[i];
        const parts = computeTextDiff(pair.originalText, pair.modifiedText);
        const pageStats = computeStats(parts);
        
        allDiffs.push({
          ...pair,
          comparisonNumber: i + 1,
          label: formatPagePairLabel(pair),
          parts,
          stats: pageStats
        });
        allStats.push(pageStats);
      }
      
      return {
        diffParts: null,
        stats: combineStats(allStats),
        totalPages: pagePairs.length,
        allPagesDiffs: allDiffs,
        currentPair: null,
      };
    } else {
      const pair = pagePairs[currentPage - 1] ?? pagePairs[0];
      const parts = computeTextDiff(pair?.originalText ?? '', pair?.modifiedText ?? '');
      const diffStats = computeStats(parts);

      return {
        diffParts: parts,
        stats: diffStats,
        totalPages: pagePairs.length,
        allPagesDiffs: null as PageDiffResult[] | null,
        currentPair: pair ?? null,
      };
    }
  }, [originalDoc, modifiedDoc, pagePairs, currentPage, showAllPages]);

  useEffect(() => {
    if (totalPages > 0 && currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const handleExport = useCallback(() => {
    if (!originalDoc || !modifiedDoc) return;
    
    exportDiffToPDF(originalDoc, modifiedDoc);
  }, [originalDoc, modifiedDoc]);

  const showComparison = originalDoc && modifiedDoc && (diffParts || allPagesDiffs);

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
                <button type="button" className="reset-btn" onClick={handleReset} disabled={isProcessing}>
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
                <ExportButton onClick={handleExport} disabled={!originalDoc || !modifiedDoc} />
              </div>
            </div>

            {stats && <DiffStatsComponent {...stats} />}

            {totalPages > 1 && (
              <div className="page-controls">
                <PageSelector
                  currentPage={currentPage}
                  totalPages={totalPages}
                  pageLabel={currentPair ? formatPagePairLabel(currentPair) : undefined}
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
              allPagesDiffs ? (
                <div className="all-pages-view">
                  {allPagesDiffs.map(({ comparisonNumber, label, parts, originalText, modifiedText, stats: pageStats }) => (
                    <section key={comparisonNumber} className="page-section" aria-labelledby={`page-${comparisonNumber}-title`}>
                      <div className="page-section-header">
                        <h3 id={`page-${comparisonNumber}-title`}>{label}</h3>
                        <div className="page-stats" aria-label={`${pageStats.additions} additions and ${pageStats.deletions} removals`}>
                          <span className="stat-badge additions">+{pageStats.additions}</span>
                          <span className="stat-badge deletions">−{pageStats.deletions}</span>
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
              ) : null
            ) : (
              diffParts && (
                <DiffView
                  parts={diffParts}
                  mode={viewMode}
                  originalText={currentPair?.originalText ?? ''}
                  modifiedText={currentPair?.modifiedText ?? ''}
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
