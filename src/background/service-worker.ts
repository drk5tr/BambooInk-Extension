import { getSettings, updateSettings } from "../shared/storage";
import type { ExtensionMessage } from "../shared/types";
import { checkGrammarAI, hasTextChanged, resetGate, updateGate } from "./ai-grammar";

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    switch (message.action) {
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
          const channel = message.channel || "email";
          const dismissed = message.dismissed || [];
          const result = await checkGrammarAI(message.text, apiKey, channel, dismissed);
          sendResponse({ issues: result.issues, error: result.error });
        });
        return true;
      }

      case "reset-ai-gate": {
        resetGate();
        sendResponse({ ok: true });
        return false;
      }

      case "update-ai-gate": {
        updateGate((message as any).text || "");
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
              iconPos: (message as any).iconPos,
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
