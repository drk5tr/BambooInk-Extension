import type { IssueType, Settings } from "./types";

export const TYPE_COLORS: Record<
  IssueType,
  { bg: string; border: string; text: string; dot: string }
> = {
  spelling: { bg: "#FEE2E2", border: "#EF4444", text: "#DC2626", dot: "#EF4444" },
  grammar: { bg: "#FEF3C7", border: "#F59E0B", text: "#D97706", dot: "#F59E0B" },
  punctuation: { bg: "#DBEAFE", border: "#3B82F6", text: "#2563EB", dot: "#3B82F6" },
  tone: { bg: "#E0E7FF", border: "#6366F1", text: "#4F46E5", dot: "#6366F1" },
};

export const BRAND = {
  primary: "#16A34A",
  primaryDark: "#15803D",
  gradient: "linear-gradient(135deg, #16A34A, #15803D)",
} as const;

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  spelling: true,
  grammar: true,
  maxTextLength: 5000,
  customDictionary: [],
  openaiApiKey: "",
  aiGrammar: true,
  aiIdleMs: 1000,
};

export const TYPE_LABELS: Record<IssueType, string> = {
  spelling: "Spelling Error",
  grammar: "Grammar Error",
  punctuation: "Punctuation",
  tone: "Tone",
};
