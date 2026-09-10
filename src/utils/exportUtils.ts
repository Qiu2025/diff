import jsPDF from 'jspdf';
import type { ComparisonResult } from './diffUtils';
import { describeScanSummary } from './visualScan';
import type { VisualScanResult } from './visualScan';
import type { VisualEvidence } from './visualEvidence';

export interface VisualExportSection {
  scan: VisualScanResult;
  evidence?: VisualEvidence | null;
}

const VISUAL_STATUS_LABELS = {
  equal: 'Same',
  different: 'Changed',
  indeterminate: 'Unknown',
} as const;

function describeScanRow(page: VisualScanResult['pages'][number]): string {
  if (!page.bandCounts) return page.error ?? 'Not compared';
  const { added, removed, changed, moved } = page.bandCounts;
  const parts: string[] = [];
  if (added) parts.push(`+${added}`);
  if (removed) parts.push(`-${removed}`);
  if (changed) parts.push(`~${changed}`);
  if (parts.length === 0) return moved > 0 ? 'moved only' : 'no change';
  return `${parts.join(' ')} lines${moved ? `, ${moved} moved` : ''}`;
}

export function exportDiffToPDF(result: ComparisonResult, visual?: VisualExportSection): void {
  const { documents, pageDiffs, overallStats, status } = result;
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  const maxWidth = pageWidth - 2 * margin;
  let yPosition = margin;

  // Helper function to check if we need a new page
  const checkPageBreak = (requiredSpace: number) => {
    if (yPosition + requiredSpace > pageHeight - margin) {
      doc.addPage();
      yPosition = margin;
      return true;
    }
    return false;
  };

  // Title
  doc.setFontSize(20);
  doc.setTextColor(99, 102, 241);
  doc.text('PDF Diff Report', margin, yPosition);
  yPosition += 10;

  // Document info
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text(`Generated on: ${new Date().toLocaleString()}`, margin, yPosition);
  yPosition += 6;
  doc.text(`Result: ${status}`, margin, yPosition);
  yPosition += 6;
  doc.text(`Page comparisons: ${pageDiffs.length}`, margin, yPosition);
  yPosition += 10;

  // File names
  doc.setFontSize(11);
  doc.setTextColor(50, 50, 50);
  doc.text('Original:', margin, yPosition);
  doc.setTextColor(100, 100, 100);
  const origName = doc.splitTextToSize(documents.original.name, maxWidth - 20);
  doc.text(origName, margin + 20, yPosition);
  yPosition += 6 * origName.length;
  
  doc.setTextColor(50, 50, 50);
  doc.text('Modified:', margin, yPosition);
  doc.setTextColor(100, 100, 100);
  const modName = doc.splitTextToSize(documents.modified.name, maxWidth - 20);
  doc.text(modName, margin + 20, yPosition);
  yPosition += 6 * modName.length + 4;

  // Statistics section
  checkPageBreak(35);
  doc.setFontSize(14);
  doc.setTextColor(50, 50, 50);
  doc.text('Overall Statistics', margin, yPosition);
  yPosition += 8;

  doc.setFontSize(10);
  
  // Stats box background
  doc.setFillColor(248, 250, 252);
  doc.rect(margin, yPosition - 5, maxWidth, 25, 'F');
  
  const statSpacing = maxWidth / 4;
  
  doc.setTextColor(34, 197, 94);
  doc.text(`+ ${overallStats.additions}`, margin + 5, yPosition);
  doc.setTextColor(100, 100, 100);
  doc.text('Additions', margin + 5, yPosition + 5);
  
  doc.setTextColor(239, 68, 68);
  doc.text(`- ${overallStats.deletions}`, margin + statSpacing, yPosition);
  doc.setTextColor(100, 100, 100);
  doc.text('Deletions', margin + statSpacing, yPosition + 5);
  
  doc.setTextColor(100, 116, 139);
  doc.text(`${overallStats.unchanged}`, margin + statSpacing * 2, yPosition);
  doc.setTextColor(100, 100, 100);
  doc.text('Unchanged', margin + statSpacing * 2, yPosition + 5);
  
  doc.setTextColor(99, 102, 241);
  doc.text(`${overallStats.changePercentage.toFixed(1)}%`, margin + statSpacing * 3, yPosition);
  doc.setTextColor(100, 100, 100);
  doc.text('Changed', margin + statSpacing * 3, yPosition + 5);
  
  yPosition += 28;

  // Visual comparison: separate evidence, reported separately.
  if (visual) {
    checkPageBreak(30);
    doc.setFontSize(14);
    doc.setTextColor(50, 50, 50);
    doc.text('Visual Comparison', margin, yPosition);
    yPosition += 7;

    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text(describeScanSummary(visual.scan), margin, yPosition);
    yPosition += 5;
    if (visual.scan.scale > 0) {
      doc.text(
        `Pages compared as rendered at approximately ${Math.round(visual.scan.scale * 72)} DPI.`,
        margin,
        yPosition
      );
      yPosition += 5;
    }
    doc.text(
      'This is independent of the text comparison below. A page can differ visually '
        + 'while its text is identical, and the reverse.',
      margin,
      yPosition,
      { maxWidth }
    );
    yPosition += 9;

    for (const page of visual.scan.pages) {
      checkPageBreak(7);
      doc.setFontSize(9);
      if (page.status === 'different') doc.setTextColor(185, 28, 28);
      else if (page.status === 'equal') doc.setTextColor(21, 128, 61);
      else doc.setTextColor(161, 98, 7);
      doc.text(VISUAL_STATUS_LABELS[page.status], margin, yPosition);
      doc.setTextColor(50, 50, 50);
      doc.text(page.label, margin + 22, yPosition);
      doc.setTextColor(120, 120, 120);
      doc.text(describeScanRow(page), margin + 85, yPosition);
      yPosition += 5.5;
    }
    yPosition += 6;

    // Evidence pages are landscape: two portrait page renders side by side fit
    // a landscape sheet far better than a portrait one.
    for (const page of visual.evidence?.pages ?? []) {
      if (!page.original && !page.modified) continue;
      doc.addPage('a4', 'landscape');
      const sheetWidth = doc.internal.pageSize.getWidth();
      const sheetHeight = doc.internal.pageSize.getHeight();
      const sheetContentWidth = sheetWidth - 2 * margin;
      yPosition = margin;

      doc.setFontSize(12);
      doc.setTextColor(50, 50, 50);
      doc.text(page.label, margin, yPosition);
      yPosition += 6;
      doc.setFontSize(9);
      doc.setTextColor(120, 120, 120);
      doc.text(page.summary, margin, yPosition, { maxWidth: sheetContentWidth });
      yPosition += 8;

      const columnWidth = (sheetContentWidth - 8) / 2;
      const availableHeight = sheetHeight - margin - yPosition - 8;
      const images: [string, string | null][] = [
        ['Original', page.original],
        ['Modified', page.modified],
      ];

      images.forEach(([caption, image], index) => {
        const x = margin + index * (columnWidth + 8);
        doc.setFontSize(8);
        doc.setTextColor(120, 120, 120);
        doc.text(caption, x, yPosition);
        if (!image) return;
        const properties = doc.getImageProperties(image);
        const ratio = properties.height / properties.width;
        const width = Math.min(columnWidth, availableHeight / ratio);
        doc.addImage(image, 'JPEG', x, yPosition + 3, width, width * ratio);
      });

      yPosition = sheetHeight - margin;
    }

    if (visual.evidence && visual.evidence.omitted > 0) {
      doc.addPage();
      yPosition = margin;
      doc.setFontSize(9);
      doc.setTextColor(161, 98, 7);
      doc.text(
        `${visual.evidence.omitted} further changed page${
          visual.evidence.omitted === 1 ? ' was' : 's were'} not illustrated in this report.`,
        margin,
        yPosition,
        { maxWidth }
      );
      yPosition += 8;
    }

    doc.addPage();
    yPosition = margin;
  }

  // Diff content for all pages
  doc.setFontSize(14);
  doc.setTextColor(50, 50, 50);
  doc.text('Text Comparison', margin, yPosition);
  yPosition += 9;

  for (const { label, parts, status: pageStatus } of pageDiffs) {
    checkPageBreak(20);
    
    doc.setTextColor(50, 50, 50);
    doc.text(label, margin, yPosition);
    yPosition += 8;

    doc.setFontSize(9);

    if (pageStatus === 'indeterminate') {
      doc.setTextColor(161, 98, 7);
      doc.text('Text comparison unavailable: no extractable text.', margin, yPosition);
      yPosition += 10;
      doc.setFontSize(14);
      continue;
    }
    
    // Process diff parts for this page
    for (const part of parts) {
      if (!part.value.trim()) continue;

      const lines = part.value.split('\n');
      
      for (const line of lines) {
        if (!line.trim()) {
          yPosition += 3;
          continue;
        }
        
        checkPageBreak(6);

        // Wrap text if too long
        const wrappedText = doc.splitTextToSize(line, maxWidth - 5);
        
        for (let i = 0; i < wrappedText.length; i++) {
          checkPageBreak(6);
          
          // Background color based on change type
          if (part.added) {
            doc.setFillColor(220, 252, 231);
            doc.rect(margin, yPosition - 4, maxWidth, 5, 'F');
            doc.setTextColor(21, 128, 61);
            doc.text('+ ', margin + 2, yPosition);
          } else if (part.removed) {
            doc.setFillColor(254, 226, 226);
            doc.rect(margin, yPosition - 4, maxWidth, 5, 'F');
            doc.setTextColor(185, 28, 28);
            doc.text('- ', margin + 2, yPosition);
          } else {
            doc.setTextColor(100, 100, 100);
            doc.text('  ', margin + 2, yPosition);
          }
          
          doc.text(wrappedText[i], margin + 7, yPosition);
          yPosition += 5;
        }
      }
    }
    
    doc.setFontSize(14);
    yPosition += 5;
  }

  // Footer
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(
      `Page ${i} of ${pageCount}`,
      pageWidth / 2,
      pageHeight - 10,
      { align: 'center' }
    );
  }

  // Save the PDF
  const timestamp = new Date().toISOString().slice(0, 10);
  doc.save(`pdf-diff-${timestamp}.pdf`);
}
