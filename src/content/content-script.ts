import "./content-script.css";
import type { Settings, CheckGrammarAIResponse, Issue } from "../shared/types";
import { setupObservers, setAiIdleMs, setActiveElement, isTextCheckSuppressed, getActiveElement } from "./observer";
import { initUI, updateUI, hideUI, setCurrentIssues, setCurrentError, getCurrentIssues, isInteractingWithOverlay, getDismissedOriginals, getAcceptGeneration, getLastAcceptedText } from "./overlay";
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
  onTextChange: (text, _element) => {
    if (!settings?.enabled) return;
    if (isTextCheckSuppressed()) return;
    if (!settings.aiGrammar || !settings.openaiApiKey) return;

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
        setCurrentError(aiResponse.error);
        updateUI();
      }
    );
  },

  onCursorMove: (element) => {
    // Immediately prune issues whose original text was deleted from the editor
    const issues = getCurrentIssues();
    if (issues.length === 0) return;
    const raw = element instanceof HTMLTextAreaElement
      ? element.value
      : (element.textContent || "").replace(/\u00a0/g, " ");
    const pruned = issues.filter(i => raw.includes(i.original));
    if (pruned.length !== issues.length) {
      setCurrentIssues(pruned);
      updateUI();
    }
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
