import { TYPE_LABELS } from "../constants";
import type { Issue, EngineResult, ToneSetting, WritingGoal } from "../types";
import type { AIResponse } from "./types";

let apiKey = "";
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 2000;
let lastTextHash = "";
let lastCachedResult: EngineResult | null = null;

function hashText(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const chr = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return hash.toString();
}

export function initAiEngine(key: string): void {
  apiKey = key?.trim() || "";
  lastTextHash = "";
  lastCachedResult = null;
  if (apiKey) {
    console.log("[AI Engine] Initialized");
  } else {
    console.log("[AI Engine] No API key, disabled");
  }
}

function buildPrompt(
  text: string,
  tone: ToneSetting,
  goals: WritingGoal[]
): string {
  return `You are BambooInk, a writing enhancement assistant. Basic spelling and grammar have already been checked locally. Focus your analysis on higher-level writing quality.

Check for:
1. GRAMMAR — Contextual grammar errors that regex rules miss: wrong homophones (their/there/they're, affect/effect, your/you're, its/it's, then/than, loose/lose), subject-verb disagreement, incorrect tense, and subtle structural issues.
2. TONE — Text that violates the required tone: "${tone}"
3. CLARITY — Vague, unclear, overly complex, or jargon-heavy phrasing
4. SPELLING — Only flag contextual misspellings missed by a dictionary (e.g., "defiantly" when "definitely" was intended).

Tone setting: ${tone}
Writing goals: ${goals.join(", ")}

Respond with ONLY valid JSON, no markdown fences, no other text:
{
  "issues": [
    {
      "type": "spelling" | "grammar" | "tone" | "clarity",
      "original": "exact text to replace (must appear verbatim in the source text)",
      "suggestion": "corrected text",
      "explanation": "1 sentence explaining why"
    }
  ]
}

If no issues found, return: { "issues": [] }

Text to analyze:
---
${text}
---`;
}

export async function runAiCheck(
  text: string,
  tone: ToneSetting,
  goals: WritingGoal[]
): Promise<EngineResult> {
  const start = performance.now();

  if (!apiKey) {
    return { tier: "ai", issues: [], latency: 0 };
  }

  if (text.trim().length < 10) {
    return { tier: "ai", issues: [], latency: 0 };
  }

  // Cache check
  const textHash = hashText(text);
  if (textHash === lastTextHash && lastCachedResult) {
    return lastCachedResult;
  }

  // Rate limiting
  const now = Date.now();
  if (lastRequestTime > 0 && now - lastRequestTime < MIN_REQUEST_INTERVAL) {
    return { tier: "ai", issues: [], latency: 0 };
  }

  lastRequestTime = now;
  lastTextHash = textHash;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [{ role: "user", content: buildPrompt(text, tone, goals) }],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error("[AI Engine] HTTP error:", response.status, errBody);
      return { tier: "ai", issues: [], latency: Math.round(performance.now() - start) };
    }

    const data = await response.json();
    const content = data.content?.[0];

    if (!content || content.type !== "text") {
      return { tier: "ai", issues: [], latency: Math.round(performance.now() - start) };
    }

    // Strip markdown fences if present
    let jsonText = content.text.trim();
    if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }

    const parsed: AIResponse = JSON.parse(jsonText);
    const latency = Math.round(performance.now() - start);

    console.log(`[AI Engine] Found ${parsed.issues.length} issues in ${latency}ms`);

    const issues: Issue[] = parsed.issues.map((aiIssue, idx) => {
      const startPos = text.indexOf(aiIssue.original);
      return {
        id: `ai-${idx}-${Date.now()}`,
        type: aiIssue.type,
        tier: "ai" as const,
        label: TYPE_LABELS[aiIssue.type] || aiIssue.type,
        original: aiIssue.original,
        suggestion: aiIssue.suggestion,
        explanation: aiIssue.explanation,
        position: {
          start: startPos >= 0 ? startPos : 0,
          end: startPos >= 0 ? startPos + aiIssue.original.length : 0,
        },
        latency,
        confidence: aiIssue.confidence,
      };
    });

    const result: EngineResult = { tier: "ai", issues, latency };
    lastCachedResult = result;
    return result;
  } catch (err: any) {
    console.error("[AI Engine] Error:", err?.message || err);
    return { tier: "ai", issues: [], latency: Math.round(performance.now() - start) };
  }
}
