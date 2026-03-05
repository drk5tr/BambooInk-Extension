import nlp from "compromise/three";

export interface PiiScrubResult {
  sanitized: string;
  replacements: Array<{ placeholder: string; original: string; index: number }>;
}

interface PiiPattern {
  label: string;
  regex: RegExp;
}

// Order matters: more specific patterns first to prevent overlap.
// URLs/keys first (contain emails, digits, tokens), then addresses (multi-token),
// then dates, proper nouns, structured IDs, and broad catch-alls last.
const PII_PATTERNS: PiiPattern[] = [
  // --- URLs & Keys (run first — URLs contain emails, digits, tokens) ---

  // URLs with credentials: password=, token=, api_key= params, or basic-auth user:pass@host
  {
    label: "URL_CRED",
    regex: /https?:\/\/(?:[^\s:@]+:[^\s:@]+@[^\s]+|[^\s]*(?:password|token|api_key|apikey|secret)=[^\s&]+[^\s]*)/gi,
  },

  // Known API key prefixes
  {
    label: "API_KEY",
    regex: /\b(?:sk-[A-Za-z0-9_-]{20,}|pk-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|ghp_[A-Za-z0-9]{36}|gho_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,}|xox[bpas]-[A-Za-z0-9-]{10,})/g,
  },

  // --- Addresses (multi-token, run before shorter patterns) ---

  // Full address: 123 Oak St, Springfield, IL 62704
  {
    label: "ADDRESS",
    regex: /\b\d{1,6}\s+(?:[A-Za-z]+\s+){1,3}(?:Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Road|Rd|Lane|Ln|Court|Ct|Place|Pl|Way|Circle|Cir|Terrace|Ter|Trail|Trl|Parkway|Pkwy|Highway|Hwy)\.?,?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,?\s+[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/g,
  },

  // Street only: 123 Oak St
  {
    label: "STREET",
    regex: /\b\d{1,6}\s+(?:[A-Za-z]+\s+){1,3}(?:Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Road|Rd|Lane|Ln|Court|Ct|Place|Pl|Way|Circle|Cir|Terrace|Ter|Trail|Trl|Parkway|Pkwy|Highway|Hwy)\.?\b/gi,
  },

  // City, ST ZIP: Springfield, IL 62704
  {
    label: "CITY_STATE_ZIP",
    regex: /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s+[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/g,
  },

  // --- Dates (multiple formats, all labeled DOB) ---

  // Written long: March 15, 1990 / 15 March 1990 / Mar 15, 1990
  {
    label: "DOB",
    regex: /\b(?:(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?,?\s+\d{4})\b/gi,
  },

  // ISO: 1990-03-15
  {
    label: "DOB",
    regex: /\b(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\b/g,
  },

  // US numeric: 03/15/1990 (existing)
  {
    label: "DOB",
    regex: /\b(?:0[1-9]|1[0-2])[/\-](?:0[1-9]|[12]\d|3[01])[/\-](?:19|20)\d{2}\b/g,
  },

  // --- Structured identifiers ---

  // Email addresses (existing)
  {
    label: "EMAIL",
    regex: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,
  },

  // SSN: ###-##-#### (existing)
  { label: "SSN", regex: /\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/g },

  // EIN: ##-####### (existing)
  { label: "EIN", regex: /\b\d{2}-\d{7}\b/g },

  // Credit/debit cards — separated formats + unseparated with known prefixes
  {
    label: "CARD",
    regex:
      /\b(?:\d{4}[-\s]\d{4}[-\s]\d{4}[-\s]\d{1,7}|\d{4}[-\s]\d{6}[-\s]\d{5}|4\d{15}|4\d{12}|5[1-5]\d{14}|3[47]\d{13}|6(?:011|5\d{2})\d{12}|3(?:0[0-5]|[68]\d)\d{11})\b/g,
  },

  // International phone (requires + prefix): +44 20 7946 0958
  {
    label: "PHONE",
    regex: /\+\d{1,3}[\s.-]?\(?\d{1,4}\)?[\s.-]?\d{1,5}[\s.-]?\d{1,5}(?:[\s.-]?\d{1,5})?\b/g,
  },

  // US/CA phone + optional extension (existing, expanded)
  {
    label: "PHONE",
    regex:
      /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}(?:\s*(?:ext|x|extension)\.?\s*\d{1,6})?\b/gi,
  },

  // IPv6 addresses (hex groups with colons)
  {
    label: "IP",
    regex:
      /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b|(?:[0-9a-fA-F]{1,4}:){1,7}:|(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|::(?:[0-9a-fA-F]{1,4}:){0,5}[0-9a-fA-F]{1,4}\b/g,
  },

  // IPv4 addresses (validated octets 0-255)
  {
    label: "IP",
    regex:
      /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
  },

  // Passport (context-required keyword + letter + 8 digits)
  {
    label: "PASSPORT",
    regex:
      /\bpassport\s*(?:#|number|no\.?|num\.?)\s*[A-Za-z]\d{6,9}\b/gi,
  },

  // Driver's license (context-required keyword + alphanumeric)
  {
    label: "DL",
    regex:
      /\b(?:driver'?s?\s*licen[sc]e|DL)\s*(?:#|number|no\.?|num\.?)\s*[A-Za-z0-9]{5,15}\b/gi,
  },

  // --- Broad catch-alls (run last) ---

  // Routing numbers: exactly 9 digits
  { label: "ROUTING", regex: /\b\d{9}\b/g },

  // Account numbers: 8-17 digits
  { label: "ACCOUNT", regex: /\b\d{8,17}\b/g },
];

export function scrubPii(text: string): PiiScrubResult {
  const replacements: PiiScrubResult["replacements"] = [];
  // Track which character positions are already claimed by a replacement
  const claimed = new Set<number>();
  const counters = new Map<string, number>();

  for (const pattern of PII_PATTERNS) {
    // Reset regex lastIndex for each pass
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.regex.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;

      // Skip if any part of this match overlaps an already-claimed range
      let overlaps = false;
      for (let i = start; i < end; i++) {
        if (claimed.has(i)) { overlaps = true; break; }
      }
      if (overlaps) continue;

      // Claim these positions
      for (let i = start; i < end; i++) claimed.add(i);

      const count = (counters.get(pattern.label) || 0) + 1;
      counters.set(pattern.label, count);

      replacements.push({
        placeholder: `[${pattern.label}-${count}]`,
        original: match[0],
        index: start,
      });
    }
  }

  // --- NLP-based proper noun detection (people, places, organizations) ---
  const doc = nlp(text);
  const entities = [
    ...doc.people().out("array") as string[],
    ...doc.places().out("array") as string[],
    ...doc.organizations().out("array") as string[],
  ];

  for (const raw of entities) {
    // Compromise can include trailing punctuation (e.g. "Chase,") — strip it
    const entity = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
    if (!entity) continue;
    let searchFrom = 0;
    while (true) {
      const idx = text.indexOf(entity, searchFrom);
      if (idx === -1) break;
      const end = idx + entity.length;

      // Skip if any part overlaps an already-claimed range
      let overlaps = false;
      for (let i = idx; i < end; i++) {
        if (claimed.has(i)) { overlaps = true; break; }
      }
      if (overlaps) { searchFrom = idx + 1; continue; }

      // Claim these positions
      for (let i = idx; i < end; i++) claimed.add(i);

      const count = (counters.get("PROPN") || 0) + 1;
      counters.set("PROPN", count);

      replacements.push({
        placeholder: `[PROPN-${count}]`,
        original: entity,
        index: idx,
      });

      searchFrom = end;
    }
  }

  // Sort replacements by index descending so we can replace from end to start
  // without shifting earlier indices.
  replacements.sort((a, b) => b.index - a.index);

  let sanitized = text;
  for (const r of replacements) {
    sanitized =
      sanitized.slice(0, r.index) +
      r.placeholder +
      sanitized.slice(r.index + r.original.length);
  }

  // Re-sort ascending for the caller's convenience
  replacements.sort((a, b) => a.index - b.index);

  if (replacements.length > 0) {
    console.log("[BambooInk][PII] Scrubbed %d item(s)", replacements.length);
  }

  return { sanitized, replacements };
}

export function restorePii(
  text: string,
  replacements: PiiScrubResult["replacements"]
): string {
  let result = text;
  for (const r of replacements) {
    result = result.split(r.placeholder).join(r.original);
  }
  return result;
}
