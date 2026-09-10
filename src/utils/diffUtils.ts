import { diffWords, diffWordsWithSpace, diffLines } from 'diff';
import { alignSequences } from './sequenceAlignment.ts';
import type { PDFDocument } from './pdfModel';

export interface DiffPart {
  value: string;
  added?: boolean;
  removed?: boolean;
}

export interface TextPage {
  pageNumber: number;
  text: string;
}

export interface PagePair {
  originalPageNumber: number | null;
  modifiedPageNumber: number | null;
  originalText: string;
  modifiedText: string;
  similarity: number | null;
}

export interface PageDiff extends PagePair {
  pageNumber: number;
  label: string;
  parts: DiffPart[];
  stats: DiffStats;
  status: ComparisonStatus;
  hasChanges: boolean;
}

export type ComparisonStatus = 'equal' | 'different' | 'indeterminate';

export interface ComparisonDiagnostic {
  code: 'no-extractable-text';
  comparisonNumber: number;
  side: 'original' | 'modified' | 'both';
  message: string;
}

export interface ComparisonResult {
  schemaVersion: 1;
  engineVersion: 'text-v1';
  status: ComparisonStatus;
  documents: {
    original: { name: string; totalPages: number };
    modified: { name: string; totalPages: number };
  };
  pageDiffs: PageDiff[];
  overallStats: DiffStats;
  diagnostics: ComparisonDiagnostic[];
}

export interface AlignedDiffRow {
  parts: DiffPart[];
}

const MIN_LINE_SIMILARITY = 0.5;
const MIN_PAGE_SIMILARITY = 0.35;

interface Fingerprint {
  normalized: string;
  words: Set<string>;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeLine(value: string): string {
  return normalizeText(value)
    .replace(/^\d+(?:\.\d+)*[.)]?\s+/, '')
}

function createFingerprint(value: string, normalize: (text: string) => string): Fingerprint {
  const normalized = normalize(value);
  return {
    normalized,
    words: new Set(normalized.match(/[\p{L}\p{N}]+/gu) ?? []),
  };
}

function fingerprintSimilarity(left: Fingerprint, right: Fingerprint): number {
  if (!left.normalized || !right.normalized) return 0;
  if (left.normalized === right.normalized) return 1;
  let sharedWords = 0;

  left.words.forEach(word => {
    if (right.words.has(word)) sharedWords += 1;
  });

  return (2 * sharedWords) / (left.words.size + right.words.size);
}

function alignTextLinesUsing(
  oldText: string,
  newText: string,
  diffLine: (oldLine: string, newLine: string) => DiffPart[]
): AlignedDiffRow[] {
  const oldLines = (oldText ? oldText.split('\n') : []).map(line => ({
    line,
    fingerprint: createFingerprint(line, normalizeLine),
  }));
  const newLines = (newText ? newText.split('\n') : []).map(line => ({
    line,
    fingerprint: createFingerprint(line, normalizeLine),
  }));

  return alignSequences(
    oldLines,
    newLines,
    (left, right) => (
      !left.fingerprint.normalized && !right.fingerprint.normalized
        ? 1
        : fingerprintSimilarity(left.fingerprint, right.fingerprint)
    ),
    MIN_LINE_SIMILARITY
  ).map(({ original, modified }) => {
    if (original && modified) {
      return { parts: diffLine(original.line, modified.line) };
    }
    if (original) {
      return { parts: [{ value: original.line, removed: true }] };
    }
    return { parts: [{ value: modified?.line ?? '', added: true }] };
  });
}

export function alignTextLines(oldText: string, newText: string): AlignedDiffRow[] {
  return alignTextLinesUsing(oldText, newText, diffWordsWithSpace);
}

export function alignPages(originalPages: TextPage[], modifiedPages: TextPage[]): PagePair[] {
  const original = originalPages.map(page => ({
    page,
    fingerprint: createFingerprint(page.text, normalizeText),
  }));
  const modified = modifiedPages.map(page => ({
    page,
    fingerprint: createFingerprint(page.text, normalizeText),
  }));

  return alignSequences(
    original,
    modified,
    (left, right) => (
      !left.fingerprint.normalized && !right.fingerprint.normalized
        ? MIN_PAGE_SIMILARITY
        : fingerprintSimilarity(left.fingerprint, right.fingerprint)
    ),
    MIN_PAGE_SIMILARITY
  ).map(({ original: oldPage, modified: newPage }) => ({
    originalPageNumber: oldPage?.page.pageNumber ?? null,
    modifiedPageNumber: newPage?.page.pageNumber ?? null,
    originalText: oldPage?.page.text ?? '',
    modifiedText: newPage?.page.text ?? '',
    similarity: oldPage?.fingerprint.normalized && newPage?.fingerprint.normalized
      ? fingerprintSimilarity(oldPage.fingerprint, newPage.fingerprint)
      : null,
  }));
}

export function formatPagePairLabel(pair: Pick<PagePair, 'originalPageNumber' | 'modifiedPageNumber'>): string {
  if (pair.originalPageNumber !== null && pair.modifiedPageNumber !== null) {
    return pair.originalPageNumber === pair.modifiedPageNumber
      ? `Page ${pair.originalPageNumber}`
      : `Original page ${pair.originalPageNumber} → Modified page ${pair.modifiedPageNumber}`;
  }
  if (pair.originalPageNumber !== null) {
    return `Original page ${pair.originalPageNumber} removed`;
  }
  return `Modified page ${pair.modifiedPageNumber} added`;
}

export function computeTextDiff(oldText: string, newText: string): DiffPart[] {
  const rows = alignTextLinesUsing(oldText, newText, diffWords);

  return rows.flatMap((row, index) => (
    index === rows.length - 1 ? row.parts : [...row.parts, { value: '\n' }]
  ));
}

export function computeLineDiff(oldText: string, newText: string): DiffPart[] {
  return diffLines(oldText, newText);
}

export function filterAdditionsOnly(parts: DiffPart[]): DiffPart[] {
  return parts.filter(part => part.added);
}

export function filterRemovalsOnly(parts: DiffPart[]): DiffPart[] {
  return parts.filter(part => part.removed);
}

export function hasChanges(parts: DiffPart[]): boolean {
  return parts.some(part => part.added || part.removed);
}

export interface DiffStats {
  additions: number;
  deletions: number;
  unchanged: number;
  totalChanges: number;
  changePercentage: number;
}

export function computeStats(parts: DiffPart[]): DiffStats {
  let additions = 0;
  let deletions = 0;
  let unchanged = 0;

  parts.forEach(part => {
    const wordCount = part.value.trim().split(/\s+/).filter(w => w.length > 0).length;
    if (part.added) {
      additions += wordCount;
    } else if (part.removed) {
      deletions += wordCount;
    } else {
      unchanged += wordCount;
    }
  });

  const totalChanges = additions + deletions;
  const totalWords = additions + deletions + unchanged;
  const changePercentage = totalWords > 0 ? (totalChanges / totalWords) * 100 : 0;

  return { 
    additions, 
    deletions, 
    unchanged, 
    totalChanges,
    changePercentage 
  };
}

export function combineStats(statsArray: DiffStats[]): DiffStats {
  const combined = statsArray.reduce((acc, stats) => ({
    additions: acc.additions + stats.additions,
    deletions: acc.deletions + stats.deletions,
    unchanged: acc.unchanged + stats.unchanged,
    totalChanges: acc.totalChanges + stats.totalChanges,
    changePercentage: 0
  }), {
    additions: 0,
    deletions: 0,
    unchanged: 0,
    totalChanges: 0,
    changePercentage: 0
  });

  const totalWords = combined.additions + combined.deletions + combined.unchanged;
  combined.changePercentage = totalWords > 0 ? (combined.totalChanges / totalWords) * 100 : 0;
  
  return combined;
}

export function compareDocuments(
  originalDoc: PDFDocument,
  modifiedDoc: PDFDocument,
  pagePairs: PagePair[] = alignPages(originalDoc.pages, modifiedDoc.pages)
): ComparisonResult {
  const diagnostics: ComparisonDiagnostic[] = [];
  const pageDiffs = pagePairs.map((pair, index): PageDiff => {
    const pageNumber = index + 1;
    const parts = computeTextDiff(pair.originalText, pair.modifiedText);
    const stats = computeStats(parts);
    const pageStructureChanged = pair.originalPageNumber === null || pair.modifiedPageNumber === null;
    const originalTextMissing = pair.originalPageNumber !== null && !pair.originalText.trim();
    const modifiedTextMissing = pair.modifiedPageNumber !== null && !pair.modifiedText.trim();
    let status: ComparisonStatus;

    if (pageStructureChanged) {
      status = 'different';
    } else if (originalTextMissing || modifiedTextMissing) {
      status = 'indeterminate';
      const side = originalTextMissing && modifiedTextMissing
        ? 'both'
        : originalTextMissing ? 'original' : 'modified';
      diagnostics.push({
        code: 'no-extractable-text',
        comparisonNumber: pageNumber,
        side,
        message: `${formatPagePairLabel(pair)} has no extractable text on ${side === 'both' ? 'either side' : `the ${side} side`}.`,
      });
    } else {
      status = hasChanges(parts) ? 'different' : 'equal';
    }

    return {
      ...pair,
      pageNumber,
      label: formatPagePairLabel(pair),
      parts,
      stats,
      status,
      hasChanges: status === 'different',
    };
  });
  const status: ComparisonStatus = pageDiffs.some(page => page.status === 'different')
    ? 'different'
    : pageDiffs.some(page => page.status === 'indeterminate') ? 'indeterminate' : 'equal';

  return {
    schemaVersion: 1,
    engineVersion: 'text-v1',
    status,
    documents: {
      original: { name: originalDoc.name, totalPages: originalDoc.totalPages },
      modified: { name: modifiedDoc.name, totalPages: modifiedDoc.totalPages },
    },
    pageDiffs,
    overallStats: combineStats(pageDiffs.map(page => page.stats)),
    diagnostics,
  };
}
