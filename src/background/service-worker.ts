import { initAiEngine, runAiCheck } from "../shared/engine/ai";
import { getSettings, updateSettings } from "../shared/storage";
import type { ExtensionMessage, Settings } from "../shared/types";

// Initialize on startup
getSettings().then((settings) => {
  if (settings.apiKey) {
    initAiEngine(settings.apiKey);
  }
});

// Re-init when settings change
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.apiKey) {
    initAiEngine(changes.apiKey.newValue || "");
  }
});

// Handle messages from content scripts and popup/options
chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  switch (message.action) {
    case "relay-overlay-to-top": {
      // Forward overlay data from iframe content script to the top frame
      const tabId = _sender.tab?.id;
      if (tabId != null) {
        chrome.tabs.sendMessage(tabId, {
          action: "render-overlay-from-iframe",
          issues: (message as any).issues,
          iframeSelector: (message as any).iframeSelector,
        }, { frameId: 0 });
      }
      sendResponse({ ok: true });
      return false;
    }

    case "relay-replace-to-iframe": {
      // Broadcast replacement command to all frames in the tab
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
    case "check-text": {
      runAiCheck(message.text, message.tone, message.goals).then((result) => {
        sendResponse({ issues: result.issues });
      });
      return true; // Keep channel open for async response
    }

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
        const dict = settings.customDictionary.filter((w) => w !== message.word);
        updateSettings({ customDictionary: dict }).then(sendResponse);
      });
      return true;
    }
  }
});

console.log("[BambooInk] Service worker started");
