import { diffWords, diffLines } from 'diff';

export interface DiffPart {
  value: string;
  added?: boolean;
  removed?: boolean;
}

export interface PageDiff {
  pageNumber: number;
  parts: DiffPart[];
  hasChanges: boolean;
}

export interface AlignedDiffRow {
  parts: DiffPart[];
}

const GAP_PENALTY = 0.75;
const MIN_LINE_SIMILARITY = 0.5;

function normalizeLine(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\d+(?:\.\d+)*[.)]?\s+/, '')
    .replace(/\s+/g, ' ');
}

function lineSimilarity(left: string, right: string): number {
  const normalizedLeft = normalizeLine(left);
  const normalizedRight = normalizeLine(right);

  if (normalizedLeft === normalizedRight) return 1;
  if (!normalizedLeft || !normalizedRight) return 0;

  const leftWords = new Set(normalizedLeft.match(/[\p{L}\p{N}]+/gu) ?? []);
  const rightWords = new Set(normalizedRight.match(/[\p{L}\p{N}]+/gu) ?? []);
  let sharedWords = 0;

  leftWords.forEach(word => {
    if (rightWords.has(word)) sharedWords += 1;
  });

  return (2 * sharedWords) / (leftWords.size + rightWords.size);
}

export function alignTextLines(oldText: string, newText: string): AlignedDiffRow[] {
  const oldLines = oldText ? oldText.split('\n') : [];
  const newLines = newText ? newText.split('\n') : [];
  const directions = Array.from(
    { length: oldLines.length + 1 },
    () => new Uint8Array(newLines.length + 1)
  );
  let previousScores = new Float64Array(newLines.length + 1);

  for (let j = 1; j <= newLines.length; j += 1) {
    previousScores[j] = -j * GAP_PENALTY;
    directions[0][j] = 3;
  }

  // ponytail: page-scoped O(lines²) alignment; add a budget if dense pages make this measurable.
  for (let i = 1; i <= oldLines.length; i += 1) {
    const currentScores = new Float64Array(newLines.length + 1);
    currentScores[0] = -i * GAP_PENALTY;
    directions[i][0] = 2;

    for (let j = 1; j <= newLines.length; j += 1) {
      const similarity = lineSimilarity(oldLines[i - 1], newLines[j - 1]);
      const matchScore = similarity >= MIN_LINE_SIMILARITY
        ? previousScores[j - 1] + similarity * 2
        : Number.NEGATIVE_INFINITY;
      const removalScore = previousScores[j] - GAP_PENALTY;
      const additionScore = currentScores[j - 1] - GAP_PENALTY;

      if (matchScore >= removalScore && matchScore >= additionScore) {
        currentScores[j] = matchScore;
        directions[i][j] = 1;
      } else if (removalScore >= additionScore) {
        currentScores[j] = removalScore;
        directions[i][j] = 2;
      } else {
        currentScores[j] = additionScore;
        directions[i][j] = 3;
      }
    }

    previousScores = currentScores;
  }

  const rows: AlignedDiffRow[] = [];
  let oldIndex = oldLines.length;
  let newIndex = newLines.length;

  while (oldIndex > 0 || newIndex > 0) {
    const direction = directions[oldIndex][newIndex];

    if (direction === 1) {
      rows.push({ parts: diffWords(oldLines[oldIndex - 1], newLines[newIndex - 1]) });
      oldIndex -= 1;
      newIndex -= 1;
    } else if (direction === 2) {
      rows.push({ parts: [{ value: oldLines[oldIndex - 1], removed: true }] });
      oldIndex -= 1;
    } else {
      rows.push({ parts: [{ value: newLines[newIndex - 1], added: true }] });
      newIndex -= 1;
    }
  }

  return rows.reverse();
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
