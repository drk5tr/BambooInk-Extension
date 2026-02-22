export interface LocalRule {
  id: string;
  pattern: RegExp;
  type: "grammar" | "spelling";
  suggestion: string | ((match: RegExpMatchArray) => string);
  explanation: string;
}
