import type { IssueType, Settings } from "./types";

export const TYPE_COLORS: Record<
  IssueType,
  { bg: string; border: string; text: string; dot: string }
> = {
  spelling: { bg: "#FEE2E2", border: "#EF4444", text: "#DC2626", dot: "#EF4444" },
  grammar: { bg: "#FEF3C7", border: "#F59E0B", text: "#D97706", dot: "#F59E0B" },
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
};
