/**
 * Ordered sequence alignment shared by the text and visual analyzers.
 *
 * Runtime-neutral: no DOM, Canvas, or Node APIs.
 */

export interface AlignedPair<T> {
  original?: T;
  modified?: T;
}

export interface AlignmentOptions {
  /** Cost of leaving an item unmatched. */
  gapPenalty?: number;
}

const DEFAULT_GAP_PENALTY = 0.75;

/**
 * Global alignment that preserves order, so an insertion cannot make every
 * later item look changed.
 *
 * The similarity function must return 0..1. Pairs scoring below
 * `minimumSimilarity` are never matched.
 *
 * Runs in O(n·m); callers working with large sequences need their own budget.
 */
export function alignSequences<T>(
  original: readonly T[],
  modified: readonly T[],
  similarity: (left: T, right: T) => number,
  minimumSimilarity: number,
  options: AlignmentOptions = {}
): AlignedPair<T>[] {
  const gapPenalty = options.gapPenalty ?? DEFAULT_GAP_PENALTY;
  const directions = Array.from(
    { length: original.length + 1 },
    () => new Uint8Array(modified.length + 1)
  );
  let previousScores = new Float64Array(modified.length + 1);

  for (let j = 1; j <= modified.length; j += 1) {
    previousScores[j] = -j * gapPenalty;
    directions[0][j] = 3;
  }

  // ponytail: O(n*m) ordered alignment; add a budget if large real documents make this measurable.
  for (let i = 1; i <= original.length; i += 1) {
    const currentScores = new Float64Array(modified.length + 1);
    currentScores[0] = -i * gapPenalty;
    directions[i][0] = 2;

    for (let j = 1; j <= modified.length; j += 1) {
      const itemSimilarity = similarity(original[i - 1], modified[j - 1]);
      const matchScore = itemSimilarity >= minimumSimilarity
        ? previousScores[j - 1] + itemSimilarity * 2
        : Number.NEGATIVE_INFINITY;
      const removalScore = previousScores[j] - gapPenalty;
      const additionScore = currentScores[j - 1] - gapPenalty;

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
