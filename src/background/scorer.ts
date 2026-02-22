/**
 * Multi-signal suggestion scorer.
 *
 * Combines 4 signals to rank spell-check candidates:
 *   1. Word frequency (common words rank higher)
 *   2. Edit distance (closer edits rank higher)
 *   3. Keyboard proximity (QWERTY neighbor typos rank higher)
 *   4. Phonetic similarity (sounds-alike words rank higher)
 */

import { distance as levenshtein } from "fastest-levenshtein";
import { doubleMetaphone } from "double-metaphone";
import { getWordFrequency } from "../shared/word-frequency";
import { averageKeyboardDistance } from "./keyboard-map";

// Weights for each signal (sum to 1.0)
const W_FREQ = 0.30;
const W_EDIT = 0.30;
const W_KEYBOARD = 0.15;
const W_PHONETIC = 0.25;

// Max frequency rank we normalize against
const MAX_FREQ_RANK = 5000;

export interface ScoredSuggestion {
  word: string;
  score: number;
}

/**
 * Score a single candidate against the misspelled original.
 * Higher score = better suggestion.
 */
function scoreCandidate(candidate: string, original: string): number {
  const cLower = candidate.toLowerCase();
  const oLower = original.toLowerCase();

  // 1. Frequency score: lower rank = more common = higher score
  const freqRank = getWordFrequency(cLower);
  const freqScore = Math.max(0, 1 - freqRank / MAX_FREQ_RANK);

  // 2. Edit distance score: normalized by max word length
  const editDist = levenshtein(oLower, cLower);
  const maxLen = Math.max(oLower.length, cLower.length, 1);
  const editScore = Math.max(0, 1 - editDist / maxLen);

  // 3. Keyboard proximity score: close keys = likely typo
  const avgKeyDist = averageKeyboardDistance(original, candidate);
  // avgKeyDist of 0 = identical, ~1 = adjacent keys, >3 = far apart
  const keyboardScore = avgKeyDist === 0 ? 1 : Math.max(0, 1 - avgKeyDist / 4);

  // 4. Phonetic score: compare double metaphone codes
  const [oPrimary, oAlt] = doubleMetaphone(oLower);
  const [cPrimary, cAlt] = doubleMetaphone(cLower);
  let phoneticScore = 0;
  if (oPrimary && cPrimary) {
    if (oPrimary === cPrimary) {
      phoneticScore = 1;
    } else if (oPrimary === cAlt || oAlt === cPrimary) {
      phoneticScore = 0.75;
    } else if (oAlt && cAlt && oAlt === cAlt) {
      phoneticScore = 0.5;
    } else {
      // Partial match: compare metaphone edit distance
      const mDist = levenshtein(oPrimary, cPrimary);
      const mLen = Math.max(oPrimary.length, cPrimary.length, 1);
      phoneticScore = Math.max(0, 1 - mDist / mLen) * 0.5;
    }
  }

  return (
    W_FREQ * freqScore +
    W_EDIT * editScore +
    W_KEYBOARD * keyboardScore +
    W_PHONETIC * phoneticScore
  );
}

/**
 * Score and rank candidates. Returns top `limit` suggestions sorted by score descending.
 */
export function rankSuggestions(
  candidates: string[],
  original: string,
  limit: number = 5
): ScoredSuggestion[] {
  const scored = candidates.map((word) => ({
    word,
    score: scoreCandidate(word, original),
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit);
}
