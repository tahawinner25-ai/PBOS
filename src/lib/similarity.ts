const STOP = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'your', 'with', 'this', 'that', 'from', 'have',
  'has', 'was', 'were', 'will', 'can', 'how', 'why', 'what', 'when', 'who', 'its', 'our', 'their',
  'they', 'them', 'than', 'then', 'into', 'about', 'just', 'out', 'all', 'any', 'one', 'get',
]);

export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/** Token-set Jaccard similarity in [0, 1]. Identical text scores 1. */
export function jaccard(a: string, b: string): number {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (A.size === 0 && B.size === 0) return a.trim().toLowerCase() === b.trim().toLowerCase() ? 1 : 0;
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  A.forEach((t) => {
    if (B.has(t)) inter += 1;
  });
  return inter / (A.size + B.size - inter);
}

/** Near-duplicate threshold used for lazy cross-platform copies. */
export const DUPLICATE_THRESHOLD = 0.8;
/** Threshold for "minor rewording" between hook variants / captions. */
export const REWORD_THRESHOLD = 0.6;

export function isNearDuplicate(a: string, b: string, threshold = DUPLICATE_THRESHOLD): boolean {
  return jaccard(a, b) >= threshold;
}
