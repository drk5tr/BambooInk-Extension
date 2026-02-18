export interface LocalRule {
  id: string;
  pattern: RegExp;
  type: "grammar" | "spelling";
  suggestion: string | ((match: RegExpMatchArray) => string);
  explanation: string;
}

export interface AIIssue {
  type: "spelling" | "grammar" | "tone" | "clarity";
  original: string;
  suggestion: string;
  explanation: string;
  confidence?: number;
}

export interface AIResponse {
  issues: AIIssue[];
}
