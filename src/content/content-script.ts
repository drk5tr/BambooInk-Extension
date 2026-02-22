import "./content-script.css";
import type { Settings, CheckWordResponse, CheckTextResponse, CheckGrammarAIResponse, Issue } from "../shared/types";
import { setupObservers, setAiIdleMs, setActiveElement } from "./observer";
import { initUI, updateUI, hideUI, setCurrentIssues, getCurrentIssues, isInteractingWithOverlay } from "./overlay";

let settings: Settings | null = null;

/** Returns false if extension was reloaded and this content script is orphaned. */
function contextValid(): boolean {
  return !!chrome.runtime?.id;
}

function safeSendMessage(message: any, callback?: (response: any) => void): void {
  if (!contextValid()) return;
  try {
    chrome.runtime.sendMessage(message, (response: any) => {
      if (chrome.runtime.lastError || !contextValid()) return;
      callback?.(response);
    });
  } catch {
    // Context invalidated
  }
}

// Load settings with retry
function loadSettings(): void {
  if (!contextValid()) return;
  safeSendMessage({ action: "get-settings" }, (s: Settings) => {
    if (!s) return;
    settings = s;
    if (!s.enabled) {
      setCurrentIssues([]);
      hideUI();
    }
    if (s.aiIdleMs) {
      setAiIdleMs(s.aiIdleMs);
    }
  });
}

loadSettings();

if (contextValid()) {
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "sync") loadSettings();
    });
  } catch {
    // Context invalidated
  }
}

// Set up observers with callbacks
setupObservers({
  onWordChange: (wordInfo, _element) => {
    if (!settings?.enabled || !settings.spelling) return;

    safeSendMessage(
      { action: "check-word", word: wordInfo.word, context: wordInfo.context },
      (response: CheckWordResponse) => {
        if (!response) return;
        if (response.misspelled && response.suggestions.length > 0) {
          const existing = getCurrentIssues();
          const filtered = existing.filter(
            (i) => !(i.position.start === wordInfo.start && i.position.end === wordInfo.end)
          );
          const casedSuggestions = response.suggestions.map((s) => s.word);
          const issue: Issue = {
            id: `spell-${wordInfo.start}-${wordInfo.word}`,
            type: "spelling",
            label: "Spelling",
            original: wordInfo.word,
            suggestion: casedSuggestions[0],
            alternatives: casedSuggestions.length > 1 ? casedSuggestions : undefined,
            explanation: `Did you mean "${casedSuggestions[0]}"?`,
            position: { start: wordInfo.start, end: wordInfo.end },
          };
          setCurrentIssues([...filtered, issue]);

          updateUI();
        }
      }
    );
  },

  onTextChange: (text, _element) => {
    if (!settings?.enabled) return;

    const aiEnabled = settings.aiGrammar && !!settings.openaiApiKey;

    if (aiEnabled) {
      // AI handles both spelling and grammar — skip local checks
      safeSendMessage(
        { action: "check-grammar-ai", text },
        (aiResponse: CheckGrammarAIResponse & { gated?: boolean }) => {
          if (!aiResponse || aiResponse.gated) return;
          setCurrentIssues(aiResponse.issues || []);
          updateUI();
        }
      );
    } else {
      // Local-only fallback
      safeSendMessage(
        { action: "check-text", text },
        (response: CheckTextResponse) => {
          if (!response) return;

          const existing = getCurrentIssues();
          const newPositions = new Set(
            response.issues.map(i => `${i.position.start}-${i.position.end}`)
          );
          const preserved = existing.filter(
            i => i.type === "spelling" && !newPositions.has(`${i.position.start}-${i.position.end}`)
          );
          setCurrentIssues([...response.issues, ...preserved]);

          updateUI();
        }
      );
    }
  },

  onCursorMove: (_element) => {
    // Icon is fixed to bottom-right of editor; no per-keystroke repositioning needed
  },

  onFocusIn: (_element) => {
    if (!settings?.enabled) return;
    updateUI();
  },

  onFocusOut: () => {
    // Keep icon visible when extension is on; only hide if disabled
    if (!settings?.enabled) {
      setTimeout(() => {
        hideUI();
        setActiveElement(null);
      }, 300);
    }
  },
});

initUI();

console.log("[BambooInk] Content script loaded", { hostname: location.hostname, inIframe: window !== window.top, url: location.href.substring(0, 100) });
