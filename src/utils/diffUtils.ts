import { diffWords, diffLines } from 'diff';

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
  hasChanges: boolean;
}

export interface AlignedDiffRow {
  parts: DiffPart[];
}

const GAP_PENALTY = 0.75;
const MIN_LINE_SIMILARITY = 0.5;
const MIN_PAGE_SIMILARITY = 0.35;

interface Fingerprint {
  normalized: string;
  words: Set<string>;
}

interface AlignedPair<T> {
  original?: T;
  modified?: T;
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

function alignSequences<T>(
  original: T[],
  modified: T[],
  similarity: (left: T, right: T) => number,
  minimumSimilarity: number
): AlignedPair<T>[] {
  const directions = Array.from(
    { length: original.length + 1 },
    () => new Uint8Array(modified.length + 1)
  );
  let previousScores = new Float64Array(modified.length + 1);

  for (let j = 1; j <= modified.length; j += 1) {
    previousScores[j] = -j * GAP_PENALTY;
    directions[0][j] = 3;
  }

  // ponytail: O(n*m) ordered alignment; add a budget if large real documents make this measurable.
  for (let i = 1; i <= original.length; i += 1) {
    const currentScores = new Float64Array(modified.length + 1);
    currentScores[0] = -i * GAP_PENALTY;
    directions[i][0] = 2;

    for (let j = 1; j <= modified.length; j += 1) {
      const itemSimilarity = similarity(original[i - 1], modified[j - 1]);
      const matchScore = itemSimilarity >= minimumSimilarity
        ? previousScores[j - 1] + itemSimilarity * 2
        : Number.NEGATIVE_INFINITY;
      const removalScore = previousScores[j] - GAP_PENALTY;
      const additionScore = currentScores[j - 1] - GAP_PENALTY;

      if (matchScore >= removalScore && matchScore >= additionScore) {
        currentScores[j] = matchScore;
        directions[i][j] = 1;
      } else if (additionScore >= removalScore) {
        currentScores[j] = additionScore;
        directions[i][j] = 3;
      } else {
        currentScores[j] = removalScore;
        directions[i][j] = 2;
      }
    }

    previousScores = currentScores;
  }

  const pairs: AlignedPair<T>[] = [];
  let originalIndex = original.length;
  let modifiedIndex = modified.length;

  while (originalIndex > 0 || modifiedIndex > 0) {
    const direction = directions[originalIndex][modifiedIndex];

    if (direction === 1) {
      pairs.push({
        original: original[originalIndex - 1],
        modified: modified[modifiedIndex - 1],
      });
      originalIndex -= 1;
      modifiedIndex -= 1;
    } else if (direction === 2) {
      pairs.push({ original: original[originalIndex - 1] });
      originalIndex -= 1;
    } else {
      pairs.push({ modified: modified[modifiedIndex - 1] });
      modifiedIndex -= 1;
    }
  }

  return pairs.reverse();
}

export function alignTextLines(oldText: string, newText: string): AlignedDiffRow[] {
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
    (left, right) => fingerprintSimilarity(left.fingerprint, right.fingerprint),
    MIN_LINE_SIMILARITY
  ).map(({ original, modified }) => {
    if (original && modified) {
      return { parts: diffWords(original.line, modified.line) };
    }
    if (original) {
      return { parts: [{ value: original.line, removed: true }] };
    }
    return { parts: [{ value: modified?.line ?? '', added: true }] };
  });
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
    (left, right) => fingerprintSimilarity(left.fingerprint, right.fingerprint),
    MIN_PAGE_SIMILARITY
  ).map(({ original: oldPage, modified: newPage }) => ({
    originalPageNumber: oldPage?.page.pageNumber ?? null,
    modifiedPageNumber: newPage?.page.pageNumber ?? null,
    originalText: oldPage?.page.text ?? '',
    modifiedText: newPage?.page.text ?? '',
    similarity: oldPage && newPage
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
  const rows = alignTextLines(oldText, newText);

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
