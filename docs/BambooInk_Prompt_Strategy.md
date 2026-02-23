# BambooInk — Prompt Engineering Strategy

## API Prompt Playbook for GPT-4.1 mini

**Version:** 1.0
**Date:** February 2026
**Model:** GPT-4.1 mini (OpenAI)
**Purpose:** Defines the exact prompt architecture for BambooInk's spelling, grammar, and tone checking engine

---

## 1. Architecture Overview

BambooInk uses a two-part prompt structure:

```
┌─────────────────────────────────────────────────┐
│            SYSTEM PROMPT (cached)                │
│                                                  │
│  • Role definition                               │
│  • Domain context (payroll/HR support)           │
│  • Checking rules (spelling, grammar, tone)      │
│  • Skip lists (acronyms, product names)          │
│  • Response format (JSON schema)                 │
│  • Quality rules (confidence, cap, teaching)     │
│                                                  │
│  ~500 tokens — identical across all requests     │
│  Cached server-side after first call (75% off)   │
└─────────────────────────────────────────────────┘
                      +
┌─────────────────────────────────────────────────┐
│            USER PROMPT (dynamic)                 │
│                                                  │
│  • Tone setting (Professional, Friendly, etc.)   │
│  • Channel type (email, chat, internal note)     │
│  • Previously dismissed issues (skip list)       │
│  • The actual text to check                      │
│                                                  │
│  ~100-200 tokens — changes every request         │
└─────────────────────────────────────────────────┘
```

The system prompt is the "brain" of BambooInk. It determines what gets flagged, what gets skipped, and how suggestions are worded. Tuning this prompt is the single highest-leverage activity for improving the product.

---

## 2. System Prompt (Full)

This is the exact system prompt to send as the `system` message in every API call.

```
You are BambooInk, an expert writing assistant embedded in a customer support agent's workflow. You check spelling, grammar, punctuation, and professional tone in real-time.

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
- Flag commonly confused words used incorrectly in context:
  * their/there/they're
  * your/you're
  * its/it's
  * affect/effect
  * then/than
  * to/too/two
  * here/hear
  * accept/except
  * lose/loose
  * ensure/insure
  * whose/who's
  * complement/compliment
  * principal/principle
  * weather/whether
  * could have (not "could of")
  * should have (not "should of")
  * would have (not "would of")
- Do NOT rewrite sentences that are grammatically acceptable — only flag actual errors
- Do NOT flag sentence-ending prepositions (acceptable in modern English)
- Do NOT flag split infinitives (acceptable in modern English)
- Do NOT suggest overly formal rewrites that sound unnatural

Punctuation:
- Flag missing periods at sentence ends
- Flag missing commas before coordinating conjunctions in compound sentences
- Flag unnecessary apostrophes (e.g. "employee's" when meaning plural "employees")
- Flag missing question marks on questions
- Flag comma splices (two independent clauses joined by only a comma)
- Do NOT flag missing Oxford commas — this is a style choice
- Do NOT flag exclamation marks in chat unless excessive (3+)

Tone:
- Evaluate against the required tone setting provided in the user message
- Flag language that is too casual, too aggressive, too demanding, too passive, or mismatched with the tone requirement
- Suggest rewording that maintains the agent's intent while matching the target tone
- Common patterns to watch for and correct:
  * Demanding language: "You need to" / "You must" / "You have to" → "Could you please" / "Would you be able to"
  * Urgency pressure: "ASAP" / "immediately" / "right now" → "at your earliest convenience" / "when you get a chance"
  * Negative framing: "I can't do that" / "That's not possible" → "What I can do is..." / "An alternative would be..."
  * Blame language: "You didn't" / "You failed to" / "You forgot" → "It looks like" / "I noticed that"
  * ALL CAPS words (except acronyms) → flag as shouting
  * Excessive exclamation marks (3+ in one message) → suggest reducing
  * Passive-aggressive phrasing: "As I already mentioned" / "Per my last email" → neutral alternatives
  * Dismissive language: "Just" / "Simply" / "Obviously" when explaining steps → remove or replace
  * Overly casual (in email): "gonna" / "wanna" / "no worries" / "np" → professional alternatives

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
      "explanation": "one sentence in plain English that helps the agent understand WHY this is an issue, not just what to fix"
    }
  ]
}

QUALITY RULES:
- Only flag issues you are confident about (>90% certainty)
- Maximum 8 issues per check — prioritize the most impactful errors first
- Priority order: spelling errors > grammar errors > punctuation > tone
- Explanations should teach, not just correct — help the agent improve over time
- Preserve the agent's voice — do not make everything sound corporate or robotic
- Keep suggestions concise — do not expand a 5-word phrase into 15 words
- If the original text and suggestion would have identical meaning AND the original is acceptable, do not flag it
- If the text is already well-written, return { "issues": [] }
- Never return duplicate issues for the same text span
- The "original" field must be an exact substring match from the input — if you cannot find the exact text, skip the issue
```

---

## 3. User Prompt Template

This is the dynamic portion that changes with every request.

### TypeScript Implementation

```typescript
// src/engine/prompt.ts

type ToneSetting = "Professional" | "Friendly" | "Formal" | "Casual" | "Empathetic" | "Direct";
type Channel = "email" | "chat" | "internal_note";

export function buildUserPrompt(
  text: string,
  tone: ToneSetting,
  channel: Channel,
  dismissedOriginals?: string[]
): string {
  const parts: string[] = [];

  // 1. Tone requirement
  parts.push(`TONE: ${tone}`);

  // 2. Channel context with leniency rules
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

  // 3. Previously dismissed issues — avoid re-flagging
  if (dismissedOriginals && dismissedOriginals.length > 0) {
    parts.push(
      `SKIP THESE: The agent already dismissed these suggestions. ` +
      `Do not flag them again:\n` +
      dismissedOriginals.map(d => `- "${d}"`).join("\n")
    );
  }

  // 4. The text to check
  parts.push(`\nTEXT TO CHECK:\n---\n${text}\n---`);

  return parts.join("\n\n");
}
```

### Example Outputs

**Email, Professional tone:**
```
TONE: Professional

CHANNEL: email

CHANNEL RULES: This is a customer email. Apply full spelling, grammar,
punctuation, and tone checking. Emails should be complete sentences
with proper structure.

TEXT TO CHECK:
---
Hi Brynlee, Thanks for reaching out about you're payroll issue. I looked
into this and the direct deposit was processed on Febuary 15th. You need
to check with your bank ASAP because their may be a delay on there end.
Let me know if you have any other questions. Best, Chase
---
```

**Expected response:**
```json
{
  "issues": [
    {
      "type": "grammar",
      "original": "you're payroll issue",
      "suggestion": "your payroll issue",
      "explanation": "'You're' means 'you are.' Use 'your' to show possession."
    },
    {
      "type": "spelling",
      "original": "Febuary",
      "suggestion": "February",
      "explanation": "February has an 'r' after 'Feb' — a commonly misspelled word."
    },
    {
      "type": "tone",
      "original": "You need to check with your bank ASAP",
      "suggestion": "I'd recommend checking with your bank when you get a chance",
      "explanation": "'You need to' and 'ASAP' can feel demanding. Softer phrasing keeps a professional tone."
    },
    {
      "type": "grammar",
      "original": "their may be a delay",
      "suggestion": "there may be a delay",
      "explanation": "'Their' is possessive. Use 'there' when referring to existence or location."
    },
    {
      "type": "grammar",
      "original": "on there end",
      "suggestion": "on their end",
      "explanation": "'There' refers to a place. Use 'their' for possession."
    }
  ]
}
```

**Chat, Friendly tone:**
```
TONE: Friendly

CHANNEL: chat

CHANNEL RULES: This is a live chat. Slightly informal phrasing is
acceptable (contractions, sentence fragments for quick replies). Focus
on clarity, spelling, and tone over strict grammar. Do not flag:
single-word replies, casual greetings, or conversational transitions
like 'Sure!' or 'Got it.'

TEXT TO CHECK:
---
Ya I can definately help with that! Let me pull up you're account real quick
---
```

**Expected response:**
```json
{
  "issues": [
    {
      "type": "spelling",
      "original": "Ya",
      "suggestion": "Yeah",
      "explanation": "'Ya' is very informal. 'Yeah' is casual but cleaner."
    },
    {
      "type": "spelling",
      "original": "definately",
      "suggestion": "definitely",
      "explanation": "Common misspelling — there's no 'a' in 'definitely.'"
    },
    {
      "type": "grammar",
      "original": "you're account",
      "suggestion": "your account",
      "explanation": "'You're' means 'you are.' Use 'your' for possession."
    }
  ]
}
```

Notice: "real quick" is NOT flagged because it's chat context — informal phrasing is acceptable.

**Internal note, any tone:**
```
TONE: Professional

CHANNEL: internal_note

CHANNEL RULES: This is an internal case note visible only to the
support team. Skip tone checking entirely. Only check spelling and
major grammar errors. Internal shorthand and abbreviations are
acceptable.

TEXT TO CHECK:
---
Cust called re: missing paycheck. Checked payrol records and found
the DD was sent to wrong acct #. Escalated to payrol team for
reprocessing. ETA 2-3 biz days. F/u scheduled for Thurs.
---
```

**Expected response:**
```json
{
  "issues": [
    {
      "type": "spelling",
      "original": "payrol",
      "suggestion": "payroll",
      "explanation": "'Payroll' has two l's."
    }
  ]
}
```

Notice: Only the misspelling is flagged. Abbreviations (cust, DD, acct, biz, f/u, Thurs) are all acceptable in internal notes. No tone issues flagged.

---

## 4. Tone Profiles

Each tone setting adjusts what the model flags. The tone name is passed in the user prompt.

### Professional (Default)
The baseline. Polite, clear, and respectful. No slang, no excessive casualness, no demanding language. This is the right choice for most customer-facing email.

**Flags:** Demanding language, blame language, ALL CAPS, excessive exclamation marks, slang, overly casual phrasing, passive-aggressive language
**Allows:** Contractions (don't, can't, won't), friendly closings, conversational but structured sentences

### Friendly
Warm and approachable. More personality than Professional but still appropriate for customers.

**Flags:** Stiff/robotic phrasing, overly formal language ("per our correspondence"), blame language, ALL CAPS
**Allows:** Exclamation marks (1-2 per message), casual transitions ("Sure thing!", "Happy to help!"), emoji-adjacent phrasing

### Formal
Strict business communication. Use for executive escalations, legal-adjacent topics, or compliance-related responses.

**Flags:** All contractions, any casual language, exclamation marks, slang, sentence fragments
**Allows:** Longer sentences, passive voice (acceptable in formal context), industry jargon

### Casual
Relaxed and conversational. Use for chat with established customer relationships or internal team chat.

**Flags:** Only major errors — ALL CAPS, blame language, aggressive phrasing
**Allows:** Slang, contractions, sentence fragments, informal greetings, exclamation marks

### Empathetic
Emotionally aware. Use for sensitive topics — payroll errors affecting employees, benefit denials, termination-related inquiries.

**Flags:** Dismissive language ("just", "simply", "obviously"), cold/transactional phrasing, blame language, urgency pressure
**Allows:** Longer responses, acknowledgment phrases ("I understand how frustrating this must be"), softer alternatives for all directives

### Direct
Clear and to the point. Minimal filler. Use for technical instructions or process-heavy responses.

**Flags:** Unnecessary filler ("I just wanted to", "I was wondering if"), hedging language ("maybe", "perhaps", "I think"), passive voice, overly wordy phrasing
**Allows:** Short sentences, imperative mood for instructions ("Click Settings > Payroll"), numbered steps

---

## 5. Dismissed Issue Tracking

When an agent clicks "Dismiss" on a suggestion, store the `original` text in a session-scoped list. Pass this list in subsequent prompts to prevent the same issue from reappearing.

```typescript
// In content script — track per text field
const dismissedOriginals: string[] = [];

function onDismiss(issue: Issue) {
  dismissedOriginals.push(issue.original);
}

// Passed to buildUserPrompt() on next check
buildUserPrompt(text, tone, channel, dismissedOriginals);
```

**Rules:**
- Dismissed list is per text field, per session (resets when agent navigates away or opens a new compose window)
- Maximum 20 dismissed items per field (prevent prompt bloat)
- Do not persist dismissed items across sessions — a fresh compose window starts clean

---

## 6. Channel Detection

Auto-detect the channel based on the URL and DOM context so agents don't have to manually select it.

```typescript
// src/engine/channel-detector.ts

export function detectChannel(url: string, field: HTMLElement): Channel {
  // Salesforce
  if (url.includes("salesforce.com") || url.includes("force.com")) {
    // Internal notes have specific Lightning component classes
    if (field.closest("[data-component-id*='internalNote']") ||
        field.closest(".slds-publisher__toggle-visibility")) {
      return "internal_note";
    }
    // Chatter feed
    if (field.closest("[data-component-id*='chatter']")) {
      return "internal_note";
    }
    // Default Salesforce = email (case response)
    return "email";
  }

  // Gmail
  if (url.includes("mail.google.com")) {
    return "email";
  }

  // Slack
  if (url.includes("app.slack.com")) {
    return "chat";
  }

  // Default
  return "email";
}
```

---

## 7. API Call Implementation

### Full Request

```typescript
// src/engine/ai.ts

const SYSTEM_PROMPT = `...`; // The full system prompt from Section 2

export async function checkText(
  text: string,
  tone: ToneSetting,
  channel: Channel,
  apiKey: string,
  dismissedOriginals?: string[]
): Promise<Issue[]> {
  const userPrompt = buildUserPrompt(text, tone, channel, dismissedOriginals);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        temperature: 0.1,           // Low temp = consistent corrections
        max_tokens: 1024,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      console.error(`BambooInk API error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) return [];

    return parseResponse(content);
  } catch (error) {
    console.error("BambooInk API call failed:", error);
    return []; // Fail silently — no suggestions is better than crashing
  }
}

function parseResponse(content: string): Issue[] {
  try {
    // Strip any accidental markdown fences
    const cleaned = content
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();

    const parsed = JSON.parse(cleaned);

    if (!parsed.issues || !Array.isArray(parsed.issues)) return [];

    return parsed.issues
      .filter((issue: any) =>
        issue.type &&
        issue.original &&
        issue.suggestion &&
        issue.explanation &&
        issue.original !== issue.suggestion // Skip no-ops
      )
      .map((issue: any, idx: number) => ({
        id: `ai-${idx}-${Date.now()}`,
        type: issue.type as IssueType,
        tier: "ai" as Tier,
        label:
          issue.type === "spelling" ? "Spelling" :
          issue.type === "grammar" ? "Grammar" :
          issue.type === "punctuation" ? "Punctuation" :
          "Tone",
        original: issue.original,
        suggestion: issue.suggestion,
        explanation: issue.explanation,
        position: { start: 0, end: 0 }, // Resolved by UI via text search
      }));
  } catch (error) {
    console.error("BambooInk response parse error:", error);
    return [];
  }
}
```

### Temperature Setting

Use `temperature: 0.1` for consistency. Higher temperatures introduce randomness in suggestions — the same text would get different corrections on each check. Low temperature means the model gives the same answer every time, which is what you want for a writing tool.

Do NOT use `temperature: 0`. Some models behave unexpectedly at exactly zero. `0.1` gives you deterministic-enough behavior while avoiding edge cases.

---

## 8. Prompt Caching Strategy

OpenAI automatically caches system prompts server-side. After the first request, identical system prompts get a 75% discount on input tokens.

**What this means for BambooInk:**

```
First request of the day:
  System prompt: 500 tokens × $0.40/M = $0.0002
  User prompt:   150 tokens × $0.40/M = $0.00006
  Total input cost: $0.00026

Every subsequent request:
  System prompt: 500 tokens × $0.10/M = $0.00005  (75% off — cached)
  User prompt:   150 tokens × $0.40/M = $0.00006
  Total input cost: $0.00011
```

**Rules for maintaining cache hits:**
- The system prompt must be EXACTLY identical across requests — any character change invalidates the cache
- Do not put dynamic content (tone, channel, dismissed items) in the system prompt — those go in the user prompt
- Do not append timestamps, request IDs, or any variable data to the system prompt

---

## 9. Validation & Position Resolution

After parsing the API response, validate each issue against the actual text:

```typescript
// src/engine/validate.ts

export function validateAndResolvePositions(
  issues: Issue[],
  sourceText: string
): Issue[] {
  return issues
    .map(issue => {
      // Find the exact position of the original text
      const start = sourceText.indexOf(issue.original);
      
      if (start === -1) {
        // Original text not found in source — skip this issue
        // This happens when the model hallucinates or paraphrases
        return null;
      }

      return {
        ...issue,
        position: {
          start,
          end: start + issue.original.length,
        },
      };
    })
    .filter((issue): issue is Issue => issue !== null);
}
```

This catches cases where the model returns an `original` that doesn't exactly match the text. If it can't be found verbatim, the issue is silently dropped rather than causing a broken correction.

---

## 10. Error Handling & Fallback

The prompt strategy should handle failure gracefully:

| Failure | Behavior |
|---------|----------|
| API timeout (>5 seconds) | Return empty issues array. Agent sees no suggestions. |
| API rate limit (429) | Back off 10 seconds, retry once. If still failing, skip. |
| Invalid JSON response | Log error, return empty array. |
| API key missing/invalid | Show settings prompt to enter API key. Disable AI checks. |
| Network offline | Show "offline" indicator. All checks paused. |
| Budget/daily cap exceeded | Show "limit reached" in popup. All checks paused until reset. |

In every failure case, the extension continues to function — it just doesn't show suggestions. Never crash, never show error modals to the agent, never block their workflow.

---

## 11. Prompt Tuning Playbook

After launch, use this process to improve prompt quality based on agent feedback:

### Collecting Feedback

When an agent dismisses a suggestion, log:
- The issue type
- The original text
- The suggestion
- The full source text (for context)

This creates a dataset of "bad suggestions" that you can analyze.

### Common Tuning Scenarios

**Too many false positives on a specific pattern:**
→ Add an explicit "Do NOT flag..." rule to the system prompt

**Missing a common error pattern:**
→ Add to the "Common patterns to watch for" list with examples

**Suggestions sound too formal/robotic:**
→ Add example rewrites to the tone profile showing natural phrasing

**Model flags industry jargon:**
→ Expand the acronym/term skip list

### A/B Testing Prompts

To test prompt changes safely:
1. Ship the new prompt to 10% of agents (random selection via agent ID hash)
2. Compare dismiss rates between old and new prompt over 1 week
3. If dismiss rate drops (fewer rejected suggestions), roll out to 100%
4. If dismiss rate rises, revert

### Versioning

Keep a version number in the system prompt (as a comment the model ignores) so you can track which version each request used:

```
<!-- BambooInk Prompt v1.3 -->
You are BambooInk, an expert writing assistant...
```

---

## 12. Future Prompt Enhancements (V2+)

### Company Style Guide Integration
Allow admins to append company-specific rules to the system prompt:
```
COMPANY STYLE GUIDE:
- Always refer to the product as "BambooHR" not "Bamboo" or "bamboo hr"
- Use "team member" instead of "employee" in customer-facing communication
- Never use the word "unfortunately" — reframe positively
- Sign off with "The BambooHR Support Team" not individual names
```

### Per-Agent Learning
Track which corrections each agent accepts most frequently and add a personalization block:
```
AGENT CONTEXT:
This agent frequently makes these errors — prioritize checking for them:
- their/there confusion
- Missing commas before "but"
- Using "affect" when they mean "effect"
```

### Multi-Language Support
Add language detection and language-specific rules:
```
DETECTED LANGUAGE: English (non-native speaker patterns detected)
ADDITIONAL CHECKS:
- Article usage (a/an/the)
- Preposition selection
- Word order in complex sentences
```

---

## 13. Quick Reference Card

**Model:** GPT-4.1 mini
**Temperature:** 0.1
**Max tokens:** 1024
**System prompt:** ~500 tokens (cached after first call)
**User prompt:** ~100-200 tokens (dynamic)
**Response format:** JSON only
**Max issues per check:** 8
**Confidence threshold:** >90%
**Priority order:** Spelling > Grammar > Punctuation > Tone
**Tone options:** Professional, Friendly, Formal, Casual, Empathetic, Direct
**Channels:** email (full check), chat (relaxed grammar), internal_note (spelling only)
