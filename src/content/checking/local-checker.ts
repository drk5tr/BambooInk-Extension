import { checkSpelling, initSpellChecker, updateCustomDictionary } from "./spellcheck";
import { RULES } from "../../shared/engine/rules";
import type { Issue } from "../../shared/types";

let initialized = false;

export async function ensureLocalChecker(customDict: string[]): Promise<void> {
  if (!initialized) {
    await initSpellChecker();
    initialized = true;
  }
  updateCustomDictionary(customDict);
}

export async function runLocalCheck(text: string, customDict: string[]): Promise<Issue[]> {
  await ensureLocalChecker(customDict);

  const issues: Issue[] = [];

  // 1. Spell check via typo.js
  const spellingIssues = checkSpelling(text);
  for (const sp of spellingIssues) {
    issues.push({
      id: `local-spell-${sp.start}-${sp.word}`,
      type: "spelling",
      tier: "local",
      label: "Spelling",
      original: sp.word,
      suggestion: sp.suggestions[0] || sp.word,
      explanation: sp.suggestions.length > 0
        ? `Did you mean "${sp.suggestions[0]}"?`
        : `"${sp.word}" may be misspelled.`,
      position: { start: sp.start, end: sp.end },
      latency: 0,
    });
  }

  // 2. Regex-based grammar rules
  for (const rule of RULES) {
    // Reset lastIndex for global regexes
    rule.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rule.pattern.exec(text)) !== null) {
      const original = match[0];
      const start = match.index;
      const end = start + original.length;

      // Build suggestion from rule
      let suggestion: string;
      if (typeof rule.suggestion === "function") {
        suggestion = rule.suggestion(match);
      } else {
        // Handle backreferences like $1
        suggestion = rule.suggestion.replace(/\$(\d+)/g, (_, idx) => match![parseInt(idx)] || "");
      }

      issues.push({
        id: `local-rule-${rule.id}-${start}`,
        type: rule.type === "spelling" ? "spelling" : "grammar",
        tier: "local",
        label: rule.type === "spelling" ? "Spelling" : "Grammar",
        original,
        suggestion,
        explanation: rule.explanation,
        position: { start, end },
        latency: 0,
      });
    }
  }

  // Sort by position
  issues.sort((a, b) => a.position.start - b.position.start);
  return issues;
}
