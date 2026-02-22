/**
 * QWERTY keyboard coordinate map for proximity-based typo scoring.
 * Each key maps to [row, col] coordinates.
 * Distance = Euclidean between key positions.
 */

const QWERTY: Record<string, [number, number]> = {
  q: [0, 0], w: [0, 1], e: [0, 2], r: [0, 3], t: [0, 4],
  y: [0, 5], u: [0, 6], i: [0, 7], o: [0, 8], p: [0, 9],
  a: [1, 0], s: [1, 1], d: [1, 2], f: [1, 3], g: [1, 4],
  h: [1, 5], j: [1, 6], k: [1, 7], l: [1, 8],
  z: [2, 0], x: [2, 1], c: [2, 2], v: [2, 3], b: [2, 4],
  n: [2, 5], m: [2, 6],
};

/**
 * Euclidean distance between two keys on a QWERTY keyboard.
 * Returns Infinity if either key is not in the map.
 */
export function keyDistance(a: string, b: string): number {
  const posA = QWERTY[a.toLowerCase()];
  const posB = QWERTY[b.toLowerCase()];
  if (!posA || !posB) return Infinity;
  const dr = posA[0] - posB[0];
  const dc = posA[1] - posB[1];
  return Math.sqrt(dr * dr + dc * dc);
}

/**
 * Average keyboard distance between character substitutions in two words.
 * Only considers positions where the characters differ and both are in the map.
 * Returns 0 if the words are identical or no comparable substitutions exist.
 */
export function averageKeyboardDistance(word: string, candidate: string): number {
  const a = word.toLowerCase();
  const b = candidate.toLowerCase();
  const len = Math.min(a.length, b.length);
  let totalDist = 0;
  let count = 0;

  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) {
      const d = keyDistance(a[i], b[i]);
      if (d !== Infinity) {
        totalDist += d;
        count++;
      }
    }
  }

  // Penalize length differences
  const lengthDiff = Math.abs(a.length - b.length);
  if (lengthDiff > 0) {
    totalDist += lengthDiff * 2;
    count += lengthDiff;
  }

  return count > 0 ? totalDist / count : 0;
}
