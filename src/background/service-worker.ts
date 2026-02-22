import { getSettings, updateSettings } from "../shared/storage";
import type {
  ExtensionMessage,
  CheckWordResponse,
  CheckTextResponse,
  Issue,
} from "../shared/types";
import {
  initSpellChecker,
  updateCustomDictionary,
  checkWord,
  suggestWord,
  checkSpelling,
} from "./spellcheck";
import { rankSuggestions } from "./scorer";
import { RULES } from "../shared/engine/rules";
import { checkGrammarAI, hasTextChanged, resetGate } from "./ai-grammar";

// Initialize dictionary on startup
initSpellChecker();

function isStartOfSentence(text: string, wordStart: number): boolean {
  if (wordStart === 0) return true;
  const before = text.substring(0, wordStart).trimEnd();
  if (before.length === 0) return true;
  const lastChar = before[before.length - 1];
  return lastChar === "." || lastChar === "!" || lastChar === "?";
}

function matchCase(
  original: string,
  suggestion: string,
  capitalize?: boolean
): string {
  if (original.length === 0 || suggestion.length === 0) return suggestion;
  if (original === original.toUpperCase() && original !== original.toLowerCase()) {
    return suggestion.toUpperCase();
  }
  if (original[0] === original[0].toUpperCase() || capitalize) {
    return suggestion[0].toUpperCase() + suggestion.slice(1);
  }
  return suggestion;
}

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    switch (message.action) {
      // --- Single word check (per-keystroke) ---
      case "check-word": {
        initSpellChecker().then(async () => {
          const settings = await getSettings();
          updateCustomDictionary(settings.customDictionary);

          const { word, context } = message;
          if (!word || word.length <= 1) {
            sendResponse({ misspelled: false, suggestions: [] } as CheckWordResponse);
            return;
          }

          const misspelled = !checkWord(word);
          let suggestions: Array<{ word: string; score: number }> = [];

          if (misspelled) {
            // Detect if word is at start of sentence using context
            const wordIdx = context.indexOf(word);
            const sentenceStart = wordIdx >= 0 && isStartOfSentence(context, wordIdx);

            const raw = suggestWord(word, 15);
            const scored = rankSuggestions(raw, word, 5);
            suggestions = scored.map((s) => ({
              word: matchCase(word, s.word, sentenceStart),
              score: s.score,
            }));
          }

          sendResponse({ misspelled, suggestions } as CheckWordResponse);
        });
        return true;
      }

      // --- Full text check (grammar rules + batch spell) ---
      case "check-text": {
        initSpellChecker().then(async () => {
          const settings = await getSettings();
          updateCustomDictionary(settings.customDictionary);

          const { text } = message;
          const issues: Issue[] = [];

          // 1. Spell check all words
          if (settings.spelling) {
            const spellingIssues = checkSpelling(text);
            for (const sp of spellingIssues) {
              const sentenceStart = isStartOfSentence(text, sp.start);
              const scored = rankSuggestions(sp.suggestions, sp.word, 5);
              const casedSuggestions = scored.map((s) =>
                matchCase(sp.word, s.word, sentenceStart)
              );

              issues.push({
                id: `spell-${sp.start}-${sp.word}`,
                type: "spelling",
                label: "Spelling",
                original: sp.word,
                suggestion: casedSuggestions[0] || sp.word,
                alternatives:
                  casedSuggestions.length > 1 ? casedSuggestions : undefined,
                explanation:
                  casedSuggestions.length > 0
                    ? `Did you mean "${casedSuggestions[0]}"?`
                    : `"${sp.word}" may be misspelled.`,
                position: { start: sp.start, end: sp.end },
              });
            }
          }

          // 2. Grammar rules
          if (settings.grammar) {
            for (const rule of RULES) {
              rule.pattern.lastIndex = 0;
              let match: RegExpExecArray | null;
              while ((match = rule.pattern.exec(text)) !== null) {
                const original = match[0];
                const start = match.index;
                const end = start + original.length;

                let suggestion: string;
                if (typeof rule.suggestion === "function") {
                  suggestion = rule.suggestion(match);
                } else {
                  suggestion = rule.suggestion.replace(
                    /\$(\d+)/g,
                    (_, idx) => match![parseInt(idx)] || ""
                  );
                }
                const ruleAtSentenceStart = isStartOfSentence(text, start);
                suggestion = matchCase(original, suggestion, ruleAtSentenceStart);

                issues.push({
                  id: `rule-${rule.id}-${start}`,
                  type: rule.type === "spelling" ? "spelling" : "grammar",
                  label: rule.type === "spelling" ? "Spelling" : "Grammar",
                  original,
                  suggestion,
                  explanation: rule.explanation,
                  position: { start, end },
                });
              }
            }
          }

          issues.sort((a, b) => a.position.start - b.position.start);
          sendResponse({ issues } as CheckTextResponse);
        });
        return true;
      }

      // --- AI grammar check ---
      case "check-grammar-ai": {
        getSettings().then(async (settings) => {
          const apiKey = settings.openaiApiKey;
          if (!apiKey || !settings.aiGrammar) {
            sendResponse({ issues: [] });
            return;
          }
          // Skip if text hasn't changed since last check
          if (!hasTextChanged(message.text)) {
            sendResponse({ gated: true });
            return;
          }
          const issues = await checkGrammarAI(message.text, apiKey);
          sendResponse({ issues });
        });
        return true;
      }

      case "reset-ai-gate": {
        resetGate();
        sendResponse({ ok: true });
        return false;
      }

      // --- Iframe relay ---
      case "relay-panel-to-top": {
        const tabId = _sender.tab?.id;
        if (tabId != null) {
          chrome.tabs.sendMessage(
            tabId,
            {
              action: "render-panel-from-iframe",
              issues: (message as any).issues,
              iframeRect: (message as any).iframeRect,
              panelOpen: (message as any).panelOpen,
            },
            { frameId: 0 }
          );
        }
        sendResponse({ ok: true });
        return false;
      }

      case "relay-replace-to-iframe": {
        const replaceTabId = _sender.tab?.id;
        if (replaceTabId != null) {
          chrome.tabs.sendMessage(replaceTabId, {
            action: "replace-text-in-iframe",
            original: (message as any).original,
            suggestion: (message as any).suggestion,
          });
        }
        sendResponse({ ok: true });
        return false;
      }

      case "relay-update-issues-to-iframe": {
        const issueTabId = _sender.tab?.id;
        if (issueTabId != null) {
          chrome.tabs.sendMessage(issueTabId, {
            action: "update-issues-in-iframe",
            issues: (message as any).issues,
          });
        }
        sendResponse({ ok: true });
        return false;
      }

      // --- Settings ---
      case "get-settings": {
        getSettings().then(sendResponse);
        return true;
      }

      case "update-settings": {
        updateSettings(message.settings).then(sendResponse);
        return true;
      }

      case "add-dictionary-word": {
        getSettings().then((settings) => {
          const dict = [...settings.customDictionary];
          if (!dict.includes(message.word)) {
            dict.push(message.word);
            updateSettings({ customDictionary: dict }).then(sendResponse);
          } else {
            sendResponse(settings);
          }
        });
        return true;
      }

      case "remove-dictionary-word": {
        getSettings().then((settings) => {
          const dict = settings.customDictionary.filter(
            (w) => w !== message.word
          );
          updateSettings({ customDictionary: dict }).then(sendResponse);
        });
        return true;
      }
    }
  }
);

console.log("[BambooInk] Service worker started");
