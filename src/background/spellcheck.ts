/**
 * Spell checker running in the service worker context.
 * Uses typo.js for dictionary validation and raw candidate generation.
 */

import Typo from "typo-js";

let typoInstance: Typo | null = null;
let loading: Promise<void> | null = null;
let customDict = new Set<string>();

export interface SpellingIssue {
  word: string;
  start: number;
  end: number;
  suggestions: string[];
}

export async function initSpellChecker(): Promise<void> {
  if (typoInstance) return;
  if (loading) {
    await loading;
    return;
  }
  loading = (async () => {
    try {
      const affUrl = chrome.runtime.getURL("dictionaries/en_US.aff");
      const dicUrl = chrome.runtime.getURL("dictionaries/en_US.dic");
      const [affData, dicData] = await Promise.all([
        fetch(affUrl).then((r) => r.text()),
        fetch(dicUrl).then((r) => r.text()),
      ]);
      typoInstance = new Typo("en_US", affData, dicData);
      console.log("[BambooInk] Spell checker initialized in service worker");
    } catch (e) {
      console.error("[BambooInk] Failed to load dictionary:", e);
    }
  })();
  await loading;
}

export function updateCustomDictionary(words: string[]): void {
  customDict = new Set(words.map((w) => w.toLowerCase()));
}

export function checkWord(word: string): boolean {
  if (!typoInstance) return true;
  if (customDict.has(word.toLowerCase())) return true;
  return typoInstance.check(word);
}

export function suggestWord(word: string, limit: number = 15): string[] {
  if (!typoInstance) return [];
  const suggestions = typoInstance.suggest(word, limit);

  // Supplement with edit-distance-1 candidates typo.js may miss
  const seen = new Set(suggestions.map((s) => s.toLowerCase()));
  const edits = generateEdits1(word.toLowerCase());
  for (const edit of edits) {
    if (!seen.has(edit) && typoInstance.check(edit)) {
      suggestions.push(edit);
      seen.add(edit);
    }
  }

  return suggestions;
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyz";

function generateEdits1(word: string): string[] {
  const results: string[] = [];

  // Insertions: add one letter at each position
  for (let i = 0; i <= word.length; i++) {
    for (const c of ALPHABET) {
      results.push(word.slice(0, i) + c + word.slice(i));
    }
  }

  // Deletions: remove one letter at each position
  for (let i = 0; i < word.length; i++) {
    results.push(word.slice(0, i) + word.slice(i + 1));
  }

  // Substitutions: replace one letter at each position
  for (let i = 0; i < word.length; i++) {
    for (const c of ALPHABET) {
      if (c !== word[i]) {
        results.push(word.slice(0, i) + c + word.slice(i + 1));
      }
    }
  }

  // Transpositions: swap adjacent letters
  for (let i = 0; i < word.length - 1; i++) {
    results.push(word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2));
  }

  return results;
}

interface WordToken {
  word: string;
  start: number;
  end: number;
}

function tokenizeWords(text: string): WordToken[] {
  const tokens: WordToken[] = [];
  const regex = /[a-zA-Z']+/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const word = match[0];
    if (word.length === 1 && word !== "I" && word !== "a") continue;
    if (word.replace(/'/g, "").length === 0) continue;
    tokens.push({
      word,
      start: match.index,
      end: match.index + word.length,
    });
  }
  return tokens;
}

function isLikelyProperNoun(word: string, start: number, text: string): boolean {
  if (word[0] !== word[0].toUpperCase()) return false;
  if (start === 0) return false;
  const before = text.substring(Math.max(0, start - 3), start).trimEnd();
  if (before.endsWith(".") || before.endsWith("!") || before.endsWith("?")) return false;
  return true;
}

function isSkippable(word: string): boolean {
  if (/^\d+$/.test(word)) return true;
  if (word.includes("@")) return true;
  if (/^https?/i.test(word)) return true;
  if (word.length <= 1) return true;
  return false;
}

/**
 * Check all words in a text block. Returns raw spelling issues with unranked suggestions.
 * The service worker will score and rank suggestions via the scorer.
 */
export function checkSpelling(text: string): SpellingIssue[] {
  if (!typoInstance) return [];
  const tokens = tokenizeWords(text);
  const issues: SpellingIssue[] = [];

  for (const token of tokens) {
    if (isSkippable(token.word)) continue;
    if (customDict.has(token.word.toLowerCase())) continue;
    if (isLikelyProperNoun(token.word, token.start, text)) continue;

    if (!typoInstance.check(token.word)) {
      const raw = suggestWord(token.word, 15);
      issues.push({
        word: token.word,
        start: token.start,
        end: token.end,
        suggestions: raw,
      });
    }
  }
  return issues;
}
