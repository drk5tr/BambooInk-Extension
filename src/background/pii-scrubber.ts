export interface PiiScrubResult {
  sanitized: string;
  replacements: Array<{ placeholder: string; original: string; index: number }>;
}

interface PiiPattern {
  label: string;
  regex: RegExp;
}

// Order matters: more specific patterns first to avoid partial matches.
// SSN before routing (9 digits), credit card before account (8-17 digits).
const PII_PATTERNS: PiiPattern[] = [
  { label: "SSN",     regex: /\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/g },
  { label: "EIN",     regex: /\b\d{2}-\d{7}\b/g },
  { label: "DOB",     regex: /\b(?:0[1-9]|1[0-2])[/\-](?:0[1-9]|[12]\d|3[01])[/\-](?:19|20)\d{2}\b/g },
  { label: "CARD",    regex: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g },
  { label: "PHONE",   regex: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g },
  { label: "EMAIL",   regex: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g },
  { label: "ACCOUNT", regex: /\b\d{8,17}\b/g },
  { label: "ROUTING", regex: /\b\d{9}\b/g },
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
    result = result.replace(r.placeholder, r.original);
  }
  return result;
}
