export type IssueType = "spelling" | "grammar" | "tone" | "clarity";
export type Tier = "local" | "ai";
export type ToneSetting =
  | "Professional"
  | "Friendly"
  | "Formal"
  | "Casual"
  | "Empathetic"
  | "Direct";
export type WritingGoal =
  | "Business Writing"
  | "Academic Writing"
  | "Customer Support"
  | "Marketing Copy"
  | "Technical Docs";

export interface Issue {
  id: string;
  type: IssueType;
  tier: Tier;
  label: string;
  original: string;
  suggestion: string;
  explanation: string;
  position: { start: number; end: number };
  latency: number;
  confidence?: number;
}

export interface Settings {
  enabled: boolean;
  tone: ToneSetting;
  goals: WritingGoal[];
  spelling: boolean;
  grammar: boolean;
  toneCheck: boolean;
  clarity: boolean;
  aiEngine: boolean;
  apiKey: string;
  debounceMs: number;
  maxTextLength: number;
  customDictionary: string[];
}

export interface EngineResult {
  tier: Tier;
  issues: Issue[];
  latency: number;
}

export interface AcceptFixPayload {
  issueId: string;
  original: string;
  suggestion: string;
}

// Message types for chrome.runtime messaging
export type MessageAction =
  | "check-text"
  | "get-settings"
  | "update-settings"
  | "add-dictionary-word"
  | "remove-dictionary-word";

export interface CheckTextMessage {
  action: "check-text";
  text: string;
  tone: ToneSetting;
  goals: WritingGoal[];
}

export interface GetSettingsMessage {
  action: "get-settings";
}

export interface UpdateSettingsMessage {
  action: "update-settings";
  settings: Partial<Settings>;
}

export interface AddDictionaryWordMessage {
  action: "add-dictionary-word";
  word: string;
}

export interface RemoveDictionaryWordMessage {
  action: "remove-dictionary-word";
  word: string;
}

export interface RelayOverlayMessage {
  action: "relay-overlay-to-top";
  issues: Issue[];
  iframeSelector: string;
}

export interface RenderOverlayFromIframeMessage {
  action: "render-overlay-from-iframe";
  issues: Issue[];
  iframeSelector: string;
}

export interface RelayReplaceToIframeMessage {
  action: "relay-replace-to-iframe";
  original: string;
  suggestion: string;
}

export type ExtensionMessage =
  | CheckTextMessage
  | GetSettingsMessage
  | UpdateSettingsMessage
  | AddDictionaryWordMessage
  | RemoveDictionaryWordMessage
  | RelayOverlayMessage
  | RenderOverlayFromIframeMessage
  | RelayReplaceToIframeMessage;
