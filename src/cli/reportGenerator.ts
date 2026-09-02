import type { DiffPart, DiffStats, PageDiff } from './diffUtils.js';
import type { PDFDocument } from './pdfUtils.js';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/\n/g, '<br>');
}

export interface ReportData {
  originalDoc: PDFDocument;
  modifiedDoc: PDFDocument;
  pageDiffs: PageDiff[];
  overallStats: DiffStats;
  generatedAt: string;
}

export function generateHtmlReport(data: ReportData): string {
  const { originalDoc, modifiedDoc, pageDiffs, overallStats, generatedAt } = data;
  const changedPages = pageDiffs.filter(p => p.hasChanges);
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PDF Diff Report</title>
  <style>
    :root {
      --canvas: #f1efe8;
      --paper: #fbfaf6;
      --paper-muted: #e9e6de;
      --ink: #1b1e1a;
      --ink-soft: #444a43;
      --muted: #686d65;
      --rule: #c9c7be;
      --rule-strong: #8e938b;
      --accent: #2457d6;
      --accent-soft: #e4eaff;
      --added: #245f3a;
      --added-soft: #dcebdd;
      --removed: #8b3028;
      --removed-soft: #f1deda;
      color-scheme: light;
      font-synthesis: none;
      text-rendering: optimizeLegibility;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    html {
      scroll-behavior: smooth;
    }

    body {
      padding: 24px;
      background: var(--canvas);
      color: var(--ink);
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.6;
    }

    ::selection {
      background: var(--accent);
      color: #fff;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      overflow: hidden;
      border: 1px solid var(--rule-strong);
      border-top: 4px solid var(--accent);
      background: var(--paper);
    }

    header {
      padding: 38px 40px 34px;
      border-bottom: 1px solid var(--rule-strong);
      background: var(--paper);
      color: var(--ink);
    }

    header h1 {
      margin-bottom: 12px;
      font-family: ui-serif, Georgia, Cambria, "Times New Roman", serif;
      font-size: clamp(34px, 5vw, 52px);
      font-weight: 500;
      letter-spacing: -0.04em;
      line-height: 1;
    }

    header .meta {
      color: var(--muted);
      font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .summary {
      padding: 32px 40px 40px;
      border-bottom: 1px solid var(--rule-strong);
    }

    .files {
      display: grid;
      grid-template-columns: 1fr 1fr;
      margin-bottom: 28px;
      border-top: 1px solid var(--rule);
      border-left: 1px solid var(--rule);
    }

    .file-card {
      min-width: 0;
      padding: 18px 20px;
      border-right: 1px solid var(--rule);
      border-bottom: 1px solid var(--rule);
      background: transparent;
    }

    .file-card h3 {
      margin-bottom: 8px;
      color: var(--muted);
      font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.09em;
      text-transform: uppercase;
    }

    .file-card:first-child h3::before {
      content: "01 / ";
      color: var(--accent);
    }

    .file-card:last-child h3::before {
      content: "02 / ";
      color: var(--accent);
    }

    .file-card .filename {
      color: var(--ink);
      font-family: ui-serif, Georgia, Cambria, "Times New Roman", serif;
      font-size: 18px;
      font-weight: 600;
      word-break: break-all;
    }

    .file-card .pages {
      margin-top: 6px;
      color: var(--muted);
      font-size: 12px;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      border-top: 1px solid var(--rule);
      border-left: 1px solid var(--rule);
    }

    .stat-card {
      padding: 18px 20px 20px;
      border-top: 3px solid var(--rule-strong);
      border-right: 1px solid var(--rule);
      border-bottom: 1px solid var(--rule);
      background: transparent;
      text-align: left;
    }

    .stat-card.additions {
      border-top-color: var(--added);
      color: var(--added);
    }

    .stat-card.deletions {
      border-top-color: var(--removed);
      color: var(--removed);
    }

    .stat-card.unchanged {
      color: var(--ink-soft);
    }

    .stat-card.percentage {
      border-top-color: var(--accent);
      color: var(--accent);
    }

    .stat-card .value {
      font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
      font-size: clamp(24px, 4vw, 34px);
      font-weight: 700;
      line-height: 1.1;
    }

    .stat-card .label {
      margin-top: 7px;
      color: var(--muted);
      font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .page-index {
      padding: 26px 40px 30px;
      border-bottom: 1px solid var(--rule-strong);
      background: var(--paper-muted);
    }

    .page-index h2 {
      margin-bottom: 16px;
      color: var(--ink);
      font-family: ui-serif, Georgia, Cambria, "Times New Roman", serif;
      font-size: 20px;
      font-weight: 500;
      letter-spacing: -0.015em;
    }

    .page-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 7px;
    }

    .page-chip {
      display: inline-block;
      padding: 7px 11px;
      border: 1px solid var(--rule-strong);
      color: var(--ink-soft);
      font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
      font-size: 11px;
      font-weight: 700;
      text-decoration: none;
    }

    .page-chip:hover {
      border-color: var(--accent);
      background: var(--accent);
      color: #fff;
    }

    .page-chip:focus-visible,
    footer a:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 3px;
    }

    .page-chip.changed {
      border-color: var(--accent);
      background: var(--accent-soft);
      color: var(--accent);
    }

    .page-chip.changed:hover {
      background: var(--accent);
      color: #fff;
    }

    .page-chip.unchanged {
      background: transparent;
      color: var(--muted);
    }

    .diff-content {
      padding: 40px;
    }

    .page-diff {
      margin-bottom: 32px;
      overflow: hidden;
      border: 1px solid var(--rule-strong);
      background: var(--paper);
    }

    .page-diff:last-child {
      margin-bottom: 0;
    }

    .page-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 13px 16px;
      border-bottom: 1px solid var(--rule);
      background: var(--paper-muted);
    }

    .page-header h3 {
      color: var(--ink);
      font-family: ui-serif, Georgia, Cambria, "Times New Roman", serif;
      font-size: 17px;
      font-weight: 600;
    }

    .page-header .badge {
      padding: 4px 8px;
      border: 1px solid currentColor;
      background: transparent;
      font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .page-header .badge.changed {
      color: var(--removed);
    }

    .page-header .badge.unchanged {
      color: var(--added);
    }

    .diff-text {
      padding: 22px;
      background: var(--paper);
      color: var(--ink-soft);
      font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
      font-size: 13px;
      line-height: 1.8;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .diff-added {
      padding: 2px 0;
      background: var(--added-soft);
      color: var(--added);
      text-decoration: underline;
      text-decoration-color: var(--added);
      text-decoration-thickness: 2px;
      text-underline-offset: 2px;
    }

    .diff-removed {
      padding: 2px 0;
      background: var(--removed-soft);
      color: var(--removed);
      text-decoration: line-through;
      text-decoration-thickness: 2px;
    }

    footer {
      padding: 20px 30px;
      border-top: 1px solid var(--rule-strong);
      background: var(--paper-muted);
      color: var(--muted);
      font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
      font-size: 11px;
      text-align: center;
    }

    footer a {
      color: var(--ink);
      text-decoration-color: var(--rule-strong);
      text-underline-offset: 2px;
    }

    footer a:hover {
      color: var(--accent);
    }

    @media print {
      html {
        scroll-behavior: auto;
      }

      body {
        padding: 0;
        background: #fff;
      }

      .container {
        border: 0;
      }

      .page-diff {
        break-inside: avoid;
        page-break-inside: avoid;
      }
    }

    @media (max-width: 768px) {
      body {
        padding: 0;
      }

      .container {
        border-right: 0;
        border-left: 0;
      }

      header,
      .summary,
      .page-index,
      .diff-content {
        padding-right: 18px;
        padding-left: 18px;
      }

      header {
        padding-top: 28px;
        padding-bottom: 26px;
      }

      .files {
        grid-template-columns: 1fr;
      }

      .stats-grid {
        grid-template-columns: repeat(2, 1fr);
      }

      .stat-card {
        padding: 15px;
      }

      .diff-content {
        padding-top: 24px;
        padding-bottom: 24px;
      }

      .diff-text {
        padding: 16px;
        font-size: 12px;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      html {
        scroll-behavior: auto;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>PDF Diff Report</h1>
      <div class="meta">Generated on ${escapeHtml(generatedAt)}</div>
    </header>
    
    <section class="summary">
      <div class="files">
        <div class="file-card">
          <h3>Original File</h3>
          <div class="filename">${escapeHtml(originalDoc.name)}</div>
          <div class="pages">${originalDoc.totalPages} page${originalDoc.totalPages !== 1 ? 's' : ''}</div>
        </div>
        <div class="file-card">
          <h3>Modified File</h3>
          <div class="filename">${escapeHtml(modifiedDoc.name)}</div>
          <div class="pages">${modifiedDoc.totalPages} page${modifiedDoc.totalPages !== 1 ? 's' : ''}</div>
        </div>
      </div>
      
      <div class="stats-grid">
        <div class="stat-card additions">
          <div class="value">+${overallStats.additions}</div>
          <div class="label">Additions</div>
        </div>
        <div class="stat-card deletions">
          <div class="value">-${overallStats.deletions}</div>
          <div class="label">Deletions</div>
        </div>
        <div class="stat-card unchanged">
          <div class="value">${overallStats.unchanged}</div>
          <div class="label">Unchanged</div>
        </div>
        <div class="stat-card percentage">
          <div class="value">${overallStats.changePercentage.toFixed(1)}%</div>
          <div class="label">Changed</div>
        </div>
      </div>
    </section>
    
    <section class="page-index">
      <h2>Page Overview (${changedPages.length} of ${pageDiffs.length} pages changed)</h2>
      <div class="page-chips">
        ${pageDiffs.map(p => `
          <a href="#page-${p.pageNumber}" class="page-chip ${p.hasChanges ? 'changed' : 'unchanged'}">
            Page ${p.pageNumber}${p.hasChanges ? ' ✎' : ''}
          </a>
        `).join('')}
      </div>
    </section>
    
    <section class="diff-content">
      ${pageDiffs.map(pageDiff => `
        <div id="page-${pageDiff.pageNumber}" class="page-diff">
          <div class="page-header">
            <h3>Page ${pageDiff.pageNumber}</h3>
            <span class="badge ${pageDiff.hasChanges ? 'changed' : 'unchanged'}">
              ${pageDiff.hasChanges ? 'Changed' : 'Unchanged'}
            </span>
          </div>
          <div class="diff-text">${renderDiffParts(pageDiff.parts)}</div>
        </div>
      `).join('')}
    </section>
    
    <footer>
      Generated by <a href="https://diff.sqiu.dev" target="_blank" rel="noopener noreferrer">PDF Diff</a>
    </footer>
  </div>
</body>
</html>`;
}

function renderDiffParts(parts: DiffPart[]): string {
  return parts.map(part => {
    const text = escapeHtml(part.value);
    if (part.added) {
      return `<span class="diff-added">${text}</span>`;
    } else if (part.removed) {
      return `<span class="diff-removed">${text}</span>`;
    }
    return text;
  }).join('');
}

export function generateTextOutput(data: ReportData): string {
  const { originalDoc, modifiedDoc, pageDiffs, overallStats } = data;
  const lines: string[] = [];
  
  lines.push('═'.repeat(60));
  lines.push('                    PDF DIFF REPORT');
  lines.push('═'.repeat(60));
  lines.push('');
  lines.push(`Original: ${originalDoc.name} (${originalDoc.totalPages} pages)`);
  lines.push(`Modified: ${modifiedDoc.name} (${modifiedDoc.totalPages} pages)`);
  lines.push('');
  lines.push('─'.repeat(60));
  lines.push('                     STATISTICS');
  lines.push('─'.repeat(60));
  lines.push(`  + Additions:  ${overallStats.additions}`);
  lines.push(`  - Deletions:  ${overallStats.deletions}`);
  lines.push(`    Unchanged:  ${overallStats.unchanged}`);
  lines.push(`    Changed:    ${overallStats.changePercentage.toFixed(1)}%`);
  lines.push('');
  
  const changedPages = pageDiffs.filter(p => p.hasChanges);
  lines.push('─'.repeat(60));
  lines.push(`                  PAGE SUMMARY (${changedPages.length}/${pageDiffs.length} changed)`);
  lines.push('─'.repeat(60));
  
  for (const page of pageDiffs) {
    const status = page.hasChanges ? '✎ CHANGED' : '✓ OK';
    lines.push(`  Page ${page.pageNumber}: ${status}`);
  }
  
  lines.push('');
  lines.push('═'.repeat(60));
  
  return lines.join('\n');
}

export function generateJsonOutput(data: ReportData): string {
  return JSON.stringify({
    summary: {
      originalFile: data.originalDoc.name,
      originalPages: data.originalDoc.totalPages,
      modifiedFile: data.modifiedDoc.name,
      modifiedPages: data.modifiedDoc.totalPages,
      generatedAt: data.generatedAt,
    },
    statistics: data.overallStats,
    pages: data.pageDiffs.map(p => ({
      pageNumber: p.pageNumber,
      hasChanges: p.hasChanges,
    })),
  }, null, 2);
}

export function generateJunitOutput(data: ReportData): string {
  const changedPages = data.pageDiffs.filter(p => p.hasChanges);
  const failures = changedPages.length;
  const tests = data.pageDiffs.length;
  
  const testcases = data.pageDiffs.map(page => {
    if (page.hasChanges) {
      return `    <testcase name="Page ${page.pageNumber}" classname="pdf-diff">
      <failure message="Page ${page.pageNumber} has differences">Changes detected on page ${page.pageNumber}</failure>
    </testcase>`;
    }
    return `    <testcase name="Page ${page.pageNumber}" classname="pdf-diff"/>`;
  }).join('\n');
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="PDF Diff" tests="${tests}" failures="${failures}" errors="0">
${testcases}
</testsuite>`;
}
