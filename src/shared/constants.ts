import type { Settings } from "./types";

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
