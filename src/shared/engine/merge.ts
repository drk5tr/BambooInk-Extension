import type { Issue, EngineResult } from "../types";

/**
 * Merge results from local and AI engines.
 * - Deduplicates overlapping issues (>50% character overlap = same issue)
 * - AI takes priority over local on conflicts
 * - Results ordered by position in text
 */
export function mergeResults(
  localResult: EngineResult | null,
  aiResult: EngineResult | null
): Issue[] {
  const localIssues = localResult?.issues ?? [];
  const aiIssues = aiResult?.issues ?? [];

  if (localIssues.length === 0) return [...aiIssues].sort(byPosition);
  if (aiIssues.length === 0) return [...localIssues].sort(byPosition);

  // Start with all AI issues (they take priority)
  const merged: Issue[] = [...aiIssues];

  // Add local issues that don't overlap with any AI issue
  for (const local of localIssues) {
    const hasOverlap = aiIssues.some((ai) => computeOverlap(local, ai) > 0.5);
    if (!hasOverlap) {
      merged.push(local);
    }
  }

  return merged.sort(byPosition);
}

function computeOverlap(a: Issue, b: Issue): number {
  const aStart = a.position.start;
  const aEnd = a.position.end;
  const bStart = b.position.start;
  const bEnd = b.position.end;

  const overlapStart = Math.max(aStart, bStart);
  const overlapEnd = Math.min(aEnd, bEnd);

  if (overlapStart >= overlapEnd) return 0;

  const overlapLength = overlapEnd - overlapStart;
  const minLength = Math.min(aEnd - aStart, bEnd - bStart);

  if (minLength === 0) return 0;

  return overlapLength / minLength;
}

function byPosition(a: Issue, b: Issue): number {
  return a.position.start - b.position.start;
}
