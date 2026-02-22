import type { Issue } from "../shared/types";

const SYSTEM_PROMPT = `You are a spelling, grammar, and professional tone checker. Given text, return ONLY a JSON object.
Format: { "issues": [{ "type": "spelling" | "grammar", "original": "exact matched text", "suggestion": "corrected", "explanation": "brief reason", "start": charIndex, "end": charIndex }] }
STRICT RULES:
- Report spelling mistakes, typos, grammar, punctuation, and word-choice errors.
- Flag overly casual, unprofessional, or weak phrasing (slang, filler words, vague language) and suggest clearer, more professional alternatives. Use type "grammar" for these.
- Set "type" to "spelling" for misspellings and typos, "grammar" for everything else (grammar, punctuation, word-choice, tone).
- "start" and "end" must be exact character indices in the input text.
- "original" must be the exact substring from the input.
Return {"issues":[]} if no issues found.`;

const CACHE_TTL_MS = 5 * 60 * 1000;

// --- FNV-1a hash ---
function fnv1a(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

// --- Cache ---
const cache = new Map<string, { result: Issue[]; timestamp: number }>();

function getCached(text: string): Issue[] | null {
  const key = fnv1a(text);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.result;
}

function setCache(text: string, result: Issue[]): void {
  const key = fnv1a(text);
  cache.set(key, { result, timestamp: Date.now() });

  // Evict old entries
  if (cache.size > 100) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (now - v.timestamp > CACHE_TTL_MS) cache.delete(k);
    }
  }
}

// --- Change tracking ---
let lastAICheckedText = "";

export function resetGate(): void {
  lastAICheckedText = "";
}

export function hasTextChanged(text: string): boolean {
  return text !== lastAICheckedText;
}

interface AIIssue {
  type?: "spelling" | "grammar";
  original: string;
  suggestion: string;
  explanation: string;
  start: number;
  end: number;
}

export async function checkGrammarAI(
  text: string,
  apiKey: string
): Promise<Issue[]> {
  // Skip very short inputs
  if (text.length < 15) return [];

  // Cache check
  const cached = getCached(text);
  if (cached) return cached;

  // Update tracking immediately to prevent duplicate calls during async API request
  lastAICheckedText = text;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: text },
        ],
        temperature: 0,
        max_tokens: 512,
      }),
    });

    if (!res.ok) {
      console.warn("[BambooInk] AI grammar API error:", res.status);
      return [];
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return [];

    const parsed = JSON.parse(content);
    const aiIssues: AIIssue[] = parsed.issues || [];

    const issues: Issue[] = [];
    for (let idx = 0; idx < aiIssues.length; idx++) {
      const ai = aiIssues[idx];
      const issueType = ai.type === "spelling" ? "spelling" : "grammar";

      // Validate: check if the original text actually exists at the reported position
      let start = ai.start;
      let end = ai.end;
      const atPosition = text.substring(start, end);

      if (atPosition !== ai.original) {
        // Position is wrong — try to find the original text in the input
        const foundIdx = text.indexOf(ai.original);
        if (foundIdx === -1) {
          // AI hallucinated the original text — skip this issue
          continue;
        }
        start = foundIdx;
        end = foundIdx + ai.original.length;
      }

      issues.push({
        id: `ai-${issueType}-${start}-${idx}`,
        type: issueType as "spelling" | "grammar",
        label: issueType === "spelling" ? "Spelling (AI)" : "Grammar (AI)",
        original: ai.original,
        suggestion: ai.suggestion,
        explanation: ai.explanation,
        position: { start, end },
      });
    }

    setCache(text, issues);
    return issues;
  } catch (err) {
    console.warn("[BambooInk] AI grammar error:", err);
    return [];
  }
}
