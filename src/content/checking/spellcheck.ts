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
      console.log("[BambooInk] Spell checker initialized");
    } catch (e) {
      console.error("[BambooInk] Failed to load dictionary:", e);
    }
  })();
  await loading;
}

export function updateCustomDictionary(words: string[]): void {
  customDict = new Set(words.map((w) => w.toLowerCase()));
}

// Tokenize text into words with their positions
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
    // Skip single characters (except "I" and "a")
    if (word.length === 1 && word !== "I" && word !== "a") continue;
    // Skip words that are all apostrophes
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
  // First letter is uppercase
  if (word[0] !== word[0].toUpperCase()) return false;
  // If it's the first word in the text or after a period, don't assume proper noun
  if (start === 0) return false;
  const before = text.substring(Math.max(0, start - 3), start).trimEnd();
  if (before.endsWith(".") || before.endsWith("!") || before.endsWith("?")) return false;
  // Mid-sentence capitalized word — likely a proper noun
  return true;
}

function isSkippable(word: string): boolean {
  // Skip URLs, emails, numbers
  if (/^\d+$/.test(word)) return true;
  if (word.includes("@")) return true;
  if (/^https?/i.test(word)) return true;
  // Skip very short words that are likely abbreviations
  if (word.length <= 1) return true;
  return false;
}

export function checkSpelling(text: string): SpellingIssue[] {
  if (!typoInstance) return [];
  const tokens = tokenizeWords(text);
  const issues: SpellingIssue[] = [];

  for (const token of tokens) {
    if (isSkippable(token.word)) continue;
    if (customDict.has(token.word.toLowerCase())) continue;
    if (isLikelyProperNoun(token.word, token.start, text)) continue;

    if (!typoInstance.check(token.word)) {
      const suggestions = typoInstance.suggest(token.word, 3);
      issues.push({
        word: token.word,
        start: token.start,
        end: token.end,
        suggestions,
      });
    }
  }
  return issues;
}
