import "./content-script.css";
import type { Settings, CheckWordResponse, CheckTextResponse, CheckGrammarAIResponse, Issue } from "../shared/types";
import { setupObservers, setAiIdleMs, setActiveElement, isTextCheckSuppressed, getActiveElement } from "./observer";
import { initUI, updateUI, hideUI, setCurrentIssues, getCurrentIssues, isInteractingWithOverlay, getDismissedOriginals, getAcceptGeneration, getLastAcceptedText } from "./overlay";
import { detectChannel, getTextFromElement } from "./injector";

let settings: Settings | null = null;

/** Returns false if extension was reloaded and this content script is orphaned. */
function contextValid(): boolean {
  return !!chrome.runtime?.id;
}

function safeSendMessage(message: any, callback?: (response: any) => void, _retry = false): void {
  if (!contextValid()) return;
  try {
    chrome.runtime.sendMessage(message, (response: any) => {
      if (chrome.runtime.lastError) {
        if (!_retry) {
          console.warn("[BambooInk] Service worker waking up, retrying in 500ms...", message.action);
          setTimeout(() => safeSendMessage(message, callback, true), 500);
        } else {
          console.warn("[BambooInk] Retry failed for", message.action, chrome.runtime.lastError.message);
        }
        return;
      }
      if (!contextValid()) return;
      if (_retry) {
        console.info("[BambooInk] Retry succeeded for", message.action);
      }
      callback?.(response);
    });
  } catch {
    if (!_retry) {
      console.warn("[BambooInk] Send failed, retrying in 500ms...", message.action);
      setTimeout(() => safeSendMessage(message, callback, true), 500);
    } else {
      console.warn("[BambooInk] Retry failed for", message.action);
    }
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
    if (isTextCheckSuppressed()) return;

    const aiEnabled = settings.aiGrammar && !!settings.openaiApiKey;

    if (aiEnabled) {
      // Capture state so we can discard stale responses after an accept
      const gen = getAcceptGeneration();
      const requestText = text;
      safeSendMessage(
        { action: "check-grammar-ai", text, channel: detectChannel(), dismissed: getDismissedOriginals() },
        (aiResponse: CheckGrammarAIResponse & { gated?: boolean }) => {
          if (!aiResponse || aiResponse.gated) return;
          // Discard stale responses — an accept happened while this was in flight
          if (gen !== getAcceptGeneration()) return;
          // Discard if the editor text changed since we sent the request (e.g. accept replaced text)
          const currentEl = getActiveElement();
          if (currentEl) {
            const currentText = getTextFromElement(currentEl).trim();
            if (currentText !== requestText) return;
          }
          let issues = aiResponse.issues || [];
          // Filter out issues on text that existed at accept time —
          // prevents re-flagging corrected text for a different issue type (e.g. tone)
          const acceptedText = getLastAcceptedText();
          if (acceptedText) {
            issues = issues.filter(i => !acceptedText.includes(i.original));
          }
          setCurrentIssues(issues);
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
