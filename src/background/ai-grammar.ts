import type { Issue, IssueType, Channel } from "../shared/types";
import { scrubPii, restorePii } from "./pii-scrubber";

const SYSTEM_PROMPT = `You are BambooInk, an expert writing assistant embedded in a customer support agent's workflow. You check spelling, grammar, punctuation, and professional tone in real-time.

ROLE CONTEXT:
The writer is a customer support agent at a payroll/HR software company. They communicate with business owners, HR managers, and employees about payroll, benefits, time tracking, and HR topics.

CHECKING RULES:

Spelling:
- Flag misspelled words and provide the correct spelling
- Do NOT flag proper nouns, people's names, company names, or product/feature names (e.g. BambooHR, QuickBooks, Gusto, Xero, ADP, Paychex)
- Do NOT flag common industry acronyms (PTO, FMLA, W-2, W-4, 1099, I-9, COBRA, HSA, FSA, ACA, FLSA, EIN, SSN, YTD, QTD, MTD, EFT, ACH, EOD, SLA, CX, CSAT, NPS, QA, SOP)
- Do NOT flag technical terms common in support (e.g. screenshot, login, dropdown, checkbox, navbar, admin, sync, timezone, workflow, onboarding, offboarding, reprocessing)
- If unsure whether a word is a name or a misspelling, skip it — false positives are worse than missed errors

Grammar:
- Flag incorrect verb tense, subject-verb disagreement, sentence fragments, run-on sentences, and dangling modifiers
- Flag commonly confused words used incorrectly in context (their/there/they're, your/you're, its/it's, affect/effect, then/than, to/too/two, lose/loose, ensure/insure, could have not "could of", etc.)
- Do NOT rewrite sentences that are grammatically acceptable — only flag actual errors
- Do NOT flag sentence-ending prepositions or split infinitives
- Do NOT suggest overly formal rewrites that sound unnatural

Punctuation:
- Flag missing periods at sentence ends, missing commas before coordinating conjunctions in compound sentences
- Flag unnecessary apostrophes, missing question marks on questions, comma splices
- Do NOT flag missing Oxford commas — this is a style choice
- Do NOT flag exclamation marks in chat unless excessive (3+)
- Do NOT flag line breaks, paragraph breaks, or blank lines between sentences or sign-offs (e.g. "Thanks," followed by a new line is normal formatting)
- Newlines in the input represent real line breaks in the editor. Do NOT treat a newline as a missing space — "this.\nThanks," is two separate lines, not "this.Thanks,"

Tone (Professional):
- All communication should maintain a professional tone
- Flag language that is too casual, too aggressive, too demanding, or too passive for professional customer support
- Common patterns: demanding language, urgency pressure, negative framing, blame language, ALL CAPS, passive-aggressive phrasing, dismissive language

RESPONSE FORMAT:
Return ONLY a valid JSON object. No markdown, no code fences, no explanation outside the JSON.

If no issues found:
{ "issues": [] }

If issues found:
{
  "issues": [
    {
      "type": "spelling | grammar | punctuation | tone",
      "original": "exact text from the input to replace — must appear verbatim in the source text",
      "suggestion": "corrected text",
      "explanation": "one sentence in plain English that helps the agent understand WHY this is an issue"
    }
  ]
}

QUALITY RULES:
- Only flag issues you are confident about (>90% certainty)
- Maximum 8 issues per check
- Return ALL issue types in a single response — spelling, grammar, punctuation, and tone issues must all be included together, not separately
- Explanations should teach, not just correct
- Preserve the agent's voice — do not make everything sound corporate or robotic
- Keep suggestions concise — do not expand a 5-word phrase into 15 words
- If the original text and suggestion would be identical, do not flag it
- If the text is already well-written, return { "issues": [] }
- Never return duplicate issues for the same text span
- The "original" field must be an exact substring match from the input
- The input may contain placeholders like [SSN-1], [PHONE-1], [EMAIL-1], etc. These represent redacted sensitive data. Do not flag them as spelling or punctuation errors. Treat them as normal words.`;

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

function getCached(text: string, channel: Channel): Issue[] | null {
  const key = fnv1a(text + channel);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.result;
}

function setCache(text: string, channel: Channel, result: Issue[]): void {
  const key = fnv1a(text + channel);
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

export function updateGate(text: string): void {
  lastAICheckedText = text;
}

export function hasTextChanged(text: string): boolean {
  return text !== lastAICheckedText;
}

// --- User prompt builder ---
function buildUserPrompt(
  text: string,
  channel: Channel,
  dismissed: string[]
): string {
  const parts: string[] = [];

  parts.push("TONE: Professional");

  parts.push(`CHANNEL: ${channel}`);

  switch (channel) {
    case "chat":
      parts.push(
        "CHANNEL RULES: This is a live chat. Slightly informal phrasing " +
        "is acceptable (contractions, sentence fragments for quick replies). " +
        "Focus on clarity, spelling, and tone over strict grammar. " +
        "Do not flag: single-word replies, casual greetings, or " +
        "conversational transitions like 'Sure!' or 'Got it.'"
      );
      break;
    case "email":
      parts.push(
        "CHANNEL RULES: This is a customer email. Apply full spelling, " +
        "grammar, punctuation, and tone checking. Emails should be " +
        "complete sentences with proper structure."
      );
      break;
    case "internal_note":
      parts.push(
        "CHANNEL RULES: This is an internal case note visible only to " +
        "the support team. Skip tone checking entirely. Only check " +
        "spelling and major grammar errors. Internal shorthand and " +
        "abbreviations are acceptable."
      );
      break;
  }

  if (dismissed.length > 0) {
    parts.push(
      `SKIP THESE: The agent already reviewed or accepted corrections for these phrases. ` +
      `Do not flag any of them for any issue type (spelling, grammar, punctuation, or tone):\n` +
      dismissed.map(d => `- "${d}"`).join("\n")
    );
  }

  parts.push(`\nTEXT TO CHECK:\n---\n${text}\n---`);

  return parts.join("\n\n");
}

// --- AI issue interface (no start/end from API) ---
interface AIIssue {
  type?: string;
  original: string;
  suggestion: string;
  explanation: string;
}

export async function checkGrammarAI(
  text: string,
  apiKey: string,
  channel: Channel = "email",
  dismissed: string[] = []
): Promise<Issue[]> {
  // Skip very short inputs
  if (text.length < 15) return [];

  // Cache check
  const cached = getCached(text, channel);
  if (cached) return cached;

  // Update tracking immediately to prevent duplicate calls during async API request
  lastAICheckedText = text;

  try {
    // Scrub PII before sending to the API
    const { sanitized, replacements } = scrubPii(text);
    const userPrompt = buildUserPrompt(sanitized, channel, dismissed);

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
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 1024,
      }),
    });

    if (!res.ok) {
      console.warn("[BambooInk] AI grammar API error:", res.status);
      return [];
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return [];

    // Strip markdown fences before parsing
    const cleaned = content
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();

    const parsed = JSON.parse(cleaned);
    const aiIssues: AIIssue[] = parsed.issues || [];

    const issues: Issue[] = [];
    const usedPositions = new Set<number>();

    for (let idx = 0; idx < aiIssues.length; idx++) {
      const ai = aiIssues[idx];

      // Restore PII in the AI response fields
      ai.original = restorePii(ai.original, replacements);
      ai.suggestion = restorePii(ai.suggestion, replacements);
      ai.explanation = restorePii(ai.explanation, replacements);

      // Skip no-ops
      if (ai.original === ai.suggestion) continue;
      if (!ai.original || !ai.suggestion || !ai.explanation) continue;

      // Map issue type
      const validTypes = ["spelling", "grammar", "punctuation", "tone"];
      const issueType: IssueType = validTypes.includes(ai.type || "")
        ? (ai.type as IssueType)
        : "grammar";

      // Resolve position against the ORIGINAL unsanitized text
      let searchFrom = 0;
      let foundIdx = -1;
      while (true) {
        foundIdx = text.indexOf(ai.original, searchFrom);
        if (foundIdx === -1) break;
        if (!usedPositions.has(foundIdx)) break;
        searchFrom = foundIdx + 1;
      }

      if (foundIdx === -1) continue; // Original not found in text — skip

      usedPositions.add(foundIdx);
      const start = foundIdx;
      const end = start + ai.original.length;

      const labelMap: Record<IssueType, string> = {
        spelling: "Spelling (AI)",
        grammar: "Grammar (AI)",
        punctuation: "Punctuation (AI)",
        tone: "Tone (AI)",
      };

      issues.push({
        id: `ai-${issueType}-${start}-${idx}`,
        type: issueType,
        label: labelMap[issueType],
        original: ai.original,
        suggestion: ai.suggestion,
        explanation: ai.explanation,
        position: { start, end },
      });
    }

    setCache(text, channel, issues);
    return issues;
  } catch (err) {
    console.warn("[BambooInk] AI grammar error:", err instanceof Error ? err.message : "unknown error");
    return [];
  }
}
