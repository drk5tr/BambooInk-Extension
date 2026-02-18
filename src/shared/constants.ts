import type { IssueType, Tier, ToneSetting, WritingGoal, Settings } from "./types";

export const TYPE_COLORS: Record<
  IssueType,
  { bg: string; border: string; text: string; dot: string }
> = {
  spelling: { bg: "#FEE2E2", border: "#EF4444", text: "#DC2626", dot: "#EF4444" },
  grammar: { bg: "#FEF3C7", border: "#F59E0B", text: "#D97706", dot: "#F59E0B" },
  tone: { bg: "#E0E7FF", border: "#6366F1", text: "#4F46E5", dot: "#6366F1" },
  clarity: { bg: "#E0F2FE", border: "#0EA5E9", text: "#0284C7", dot: "#0EA5E9" },
};

export const TIER_COLORS: Record<
  Tier,
  { label: string; color: string; bg: string; icon: string }
> = {
  local: { label: "Local", color: "#16A34A", bg: "#F0FDF4", icon: "⚡" },
  ai: { label: "AI", color: "#7C3AED", bg: "#F5F3FF", icon: "🧠" },
};

export const BRAND = {
  primary: "#16A34A",
  primaryDark: "#15803D",
  gradient: "linear-gradient(135deg, #16A34A, #15803D)",
} as const;

export const TONES: ToneSetting[] = [
  "Professional",
  "Friendly",
  "Formal",
  "Casual",
  "Empathetic",
  "Direct",
];

export const GOALS: WritingGoal[] = [
  "Business Writing",
  "Academic Writing",
  "Customer Support",
  "Marketing Copy",
  "Technical Docs",
];

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  tone: "Professional",
  goals: ["Business Writing"],
  spelling: true,
  grammar: true,
  toneCheck: true,
  clarity: true,
  aiEngine: true,
  apiKey: (typeof BAMBOOINK_API_KEY !== "undefined" ? BAMBOOINK_API_KEY : ""),
  debounceMs: 800,
  maxTextLength: 5000,
  customDictionary: [],
};

export const TYPE_LABELS: Record<IssueType, string> = {
  spelling: "Spelling Error",
  grammar: "Grammar Error",
  tone: "Tone Issue",
  clarity: "Clarity",
};
