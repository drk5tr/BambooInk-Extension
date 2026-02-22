export type IssueType = "spelling" | "grammar";

export interface Issue {
  id: string;
  type: IssueType;
  label: string;
  original: string;
  suggestion: string;
  alternatives?: string[];
  explanation: string;
  position: { start: number; end: number };
}

export interface Settings {
  enabled: boolean;
  spelling: boolean;
  grammar: boolean;
  maxTextLength: number;
  customDictionary: string[];
  openaiApiKey: string;
  aiGrammar: boolean;
  aiIdleMs: number;
}

// --- Check-word: single word at cursor ---

export interface CheckWordMessage {
  action: "check-word";
  word: string;
  context: string;
}

export interface CheckWordResponse {
  misspelled: boolean;
  suggestions: Array<{ word: string; score: number }>;
}

// --- Check-text: full text for grammar rules + batch spell ---

export interface CheckTextMessage {
  action: "check-text";
  text: string;
}

export interface CheckTextResponse {
  issues: Issue[];
}

// --- Settings & dictionary messages ---

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

// --- Iframe relay messages ---

export interface RelayPanelToTopMessage {
  action: "relay-panel-to-top";
  issues: Issue[];
  iframeRect: { x: number; y: number; width: number; height: number } | null;
  panelOpen: boolean;
}

export interface RelayReplaceToIframeMessage {
  action: "relay-replace-to-iframe";
  original: string;
  suggestion: string;
}

export interface RelayUpdateIssuesToIframeMessage {
  action: "relay-update-issues-to-iframe";
  issues: Issue[];
}

// --- AI grammar check ---

export interface CheckGrammarAIMessage {
  action: "check-grammar-ai";
  text: string;
}

export interface CheckGrammarAIResponse {
  issues: Issue[];
}

export interface ResetAIGateMessage {
  action: "reset-ai-gate";
}

export type ExtensionMessage =
  | CheckWordMessage
  | CheckTextMessage
  | CheckGrammarAIMessage
  | GetSettingsMessage
  | UpdateSettingsMessage
  | AddDictionaryWordMessage
  | RemoveDictionaryWordMessage
  | RelayPanelToTopMessage
  | RelayReplaceToIframeMessage
  | RelayUpdateIssuesToIframeMessage
  | ResetAIGateMessage;
