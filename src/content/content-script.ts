import "./content-script.css";
import type { Issue, Settings } from "../shared/types";
import { runLocalCheck } from "./checking/local-checker";
import { mergeResults } from "../shared/engine/merge";
import { SHADOW_STYLES } from "./ui/styles";
import { renderIcon, repositionIcon, hideIcon } from "./ui/floating-icon";
import { renderPanel, hidePanel } from "./ui/suggestions-panel";
import type { PanelState } from "./ui/suggestions-panel";

const isInIframe = window !== window.top;

let settings: Settings | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let currentIssues: Issue[] = [];
let lastCheckedText = "";
let activeElement: HTMLElement | null = null;
let overlayContainer: HTMLDivElement | null = null;
let shadowRoot: ShadowRoot | null = null;
let interactingWithOverlay = false;
let isAiLoading = false;
let isAiComplete = false;
let panelOpen = false;

// For iframe→top-frame relay
let iframeSelector = "";

// Track shadow roots we've already attached listeners to
const listenedShadowRoots = new WeakSet<ShadowRoot>();
const knownShadowRoots: ShadowRoot[] = [];

// --- Attach listeners to a shadow root (idempotent) ---
function attachShadowListeners(shadow: ShadowRoot): void {
  if (listenedShadowRoots.has(shadow)) return;
  listenedShadowRoots.add(shadow);
  knownShadowRoots.push(shadow);
  shadow.addEventListener("input", handleInput, true);
  shadow.addEventListener("focusin", handleFocusIn as EventListener, true);
  shadow.addEventListener("focusout", handleFocusOut as EventListener, true);
  console.log("[BambooInk] Attached listeners to shadow root on", shadow.host?.tagName);

  const shadowObserver = new MutationObserver(() => {
    walkDOMForShadowRoots(shadow);
  });
  shadowObserver.observe(shadow, { childList: true, subtree: true });
}

// --- Recursively walk DOM/shadow trees to find open shadow roots ---
function walkDOMForShadowRoots(root: ShadowRoot | Element): void {
  const elements = root.querySelectorAll("*");
  for (const el of elements) {
    if (el.shadowRoot) {
      attachShadowListeners(el.shadowRoot);
      walkDOMForShadowRoots(el.shadowRoot);
    }
  }
  if (root instanceof Element && root.shadowRoot) {
    attachShadowListeners(root.shadowRoot);
  }
}

// Load settings on init (retry if service worker isn't ready)
function loadSettings(): void {
  chrome.runtime.sendMessage({ action: "get-settings" }, (s: Settings) => {
    if (chrome.runtime.lastError) {
      console.log("[BambooInk] Settings load failed, retrying in 1s:", chrome.runtime.lastError.message);
      setTimeout(loadSettings, 1000);
      return;
    }
    settings = s;
    console.log("[BambooInk] Settings loaded, enabled:", s?.enabled);
  });
}
loadSettings();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync") {
    loadSettings();
  }
});

// --- Text Field Detection ---

function isTextField(el: Element): el is HTMLElement {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    const type = el.type.toLowerCase();
    return ["text", "email", "search", "url", "tel", ""].includes(type);
  }
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  return false;
}

function getTextFromElement(el: HTMLElement): string {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    return el.value;
  }
  if (el.isContentEditable) {
    return (el.innerText || el.textContent || "").replace(/\u00a0/g, " ");
  }
  return "";
}

function replaceTextInElement(el: HTMLElement, original: string, suggestion: string): void {
  console.log("[BambooInk] replaceTextInElement called", { tagName: el.tagName, original, suggestion });

  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const start = el.value.indexOf(original);
    if (start === -1) {
      console.log("[BambooInk] Original text not found in value");
      return;
    }
    el.value = el.value.substring(0, start) + suggestion + el.value.substring(start + original.length);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } else if (el.isContentEditable) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const textNodes: { node: Text; start: number }[] = [];
    let fullText = "";
    let tNode: Text | null;
    while ((tNode = walker.nextNode() as Text | null)) {
      textNodes.push({ node: tNode, start: fullText.length });
      fullText += tNode.textContent || "";
    }

    const normalize = (s: string) => s.replace(/[\u00a0\u200b\u200c\u200d\ufeff]/g, " ").replace(/\s+/g, " ");
    const normalizedFull = normalize(fullText);
    const normalizedOriginal = normalize(original);

    const normalizedIdx = normalizedFull.indexOf(normalizedOriginal);
    if (normalizedIdx === -1) {
      console.log("[BambooInk] Original text not found in contenteditable");
      return;
    }

    let rawIdx = 0;
    let normCount = 0;
    while (normCount < normalizedIdx && rawIdx < fullText.length) {
      rawIdx++;
      normCount++;
    }
    const idx = rawIdx;

    let rawEnd = idx;
    let matchedNorm = 0;
    while (matchedNorm < normalizedOriginal.length && rawEnd < fullText.length) {
      rawEnd++;
      matchedNorm++;
    }

    const matchEnd = rawEnd;
    let startNode: Text | null = null;
    let startOffset = 0;
    let endNode: Text | null = null;
    let endOffset = 0;

    for (let i = 0; i < textNodes.length; i++) {
      const tn = textNodes[i];
      const nodeEnd = tn.start + (tn.node.textContent?.length || 0);
      if (!startNode && idx < nodeEnd) {
        startNode = tn.node;
        startOffset = idx - tn.start;
      }
      if (matchEnd <= nodeEnd) {
        endNode = tn.node;
        endOffset = matchEnd - tn.start;
        break;
      }
    }

    if (!startNode || !endNode) {
      console.log("[BambooInk] Could not locate text node boundaries");
      return;
    }

    el.focus();
    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
      sel.removeAllRanges();
      sel.addRange(range);
      if (document.execCommand("insertText", false, suggestion)) {
        return;
      }
    }

    // Fallback: range manipulation
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    range.deleteContents();
    const textNode = document.createTextNode(suggestion);
    range.insertNode(textNode);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
  }
}

// --- Caret Position ---

function getCaretRect(): DOMRect | null {
  const el = activeElement;
  if (!el) return null;

  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const rect = el.getBoundingClientRect();
    return new DOMRect(rect.right - 20, rect.bottom, 0, 0);
  }

  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0).cloneRange();
  range.collapse(false);

  const rects = range.getClientRects();
  if (rects.length > 0) {
    return rects[rects.length - 1];
  }

  return el.getBoundingClientRect();
}

function getCaretRectForTopFrame(): { x: number; y: number; width: number; height: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0).cloneRange();
  range.collapse(false);
  const rects = range.getClientRects();
  let rect: { x: number; y: number; width: number; height: number } | null = null;
  if (rects.length > 0) {
    const r = rects[rects.length - 1];
    rect = { x: r.x, y: r.y, width: r.width, height: r.height };
  } else if (activeElement) {
    const r = activeElement.getBoundingClientRect();
    rect = { x: r.right - 20, y: r.bottom, width: 0, height: 0 };
  }
  if (!rect) return null;

  let win: Window = window;
  while (win !== win.top) {
    try {
      const fe = win.frameElement;
      if (!fe) break;
      const feRect = fe.getBoundingClientRect();
      rect.x += feRect.x;
      rect.y += feRect.y;
      win = win.parent;
    } catch (e) {
      break;
    }
  }
  return rect;
}

// Get the real target, even inside Shadow DOM
function getRealTarget(e: Event): HTMLElement | null {
  const path = e.composedPath();
  const el = (path.length > 0 ? path[0] : e.target) as HTMLElement;
  return el || null;
}

// --- Shadow DOM Overlay Container ---

function ensureOverlayContainer(): { container: HTMLDivElement; shadow: ShadowRoot } {
  if (overlayContainer && shadowRoot) {
    return { container: overlayContainer, shadow: shadowRoot };
  }

  overlayContainer = document.createElement("div");
  overlayContainer.id = "bambooink-overlay";
  overlayContainer.style.cssText = "position: fixed; z-index: 2147483647; pointer-events: none; top: 0; left: 0; width: 0; height: 0;";
  document.body.appendChild(overlayContainer);

  shadowRoot = overlayContainer.attachShadow({ mode: "open" });

  // Track overlay interaction to prevent focusout from hiding it
  overlayContainer.addEventListener("mousedown", () => { interactingWithOverlay = true; });
  overlayContainer.addEventListener("mouseup", () => {
    setTimeout(() => { interactingWithOverlay = false; }, 400);
  });

  const style = document.createElement("style");
  style.textContent = SHADOW_STYLES;
  shadowRoot.appendChild(style);

  return { container: overlayContainer, shadow: shadowRoot };
}

// --- Local Check ---

async function scheduleLocalCheck(text: string): Promise<void> {
  if (!settings?.enabled) return;

  const trimmed = text.trim();
  if (trimmed.length < 10) {
    currentIssues = [];
    updateUI();
    return;
  }

  if (trimmed === lastCheckedText) return;

  if (debounceTimer) clearTimeout(debounceTimer);

  debounceTimer = setTimeout(async () => {
    debounceTimer = null;

    try {
      const localIssues = await runLocalCheck(trimmed, settings?.customDictionary || []);
      lastCheckedText = trimmed;

      // Keep any existing AI issues, merge with new local issues
      const aiIssues = currentIssues.filter((i) => i.tier === "ai");
      if (aiIssues.length > 0) {
        currentIssues = mergeResults(
          { tier: "local", issues: localIssues, latency: 0 },
          { tier: "ai", issues: aiIssues, latency: 0 }
        );
      } else {
        currentIssues = localIssues;
      }

      if (isInIframe) {
        relayIconToTop();
      } else {
        updateUI();
      }
    } catch (err) {
      console.error("[BambooInk] Local check error:", err);
    }
  }, 300);
}

// --- AI Enhancement (on-demand) ---

function enhanceWithAI(): void {
  if (!settings?.apiKey || !activeElement || isAiLoading) return;

  const text = getTextFromElement(activeElement).trim();
  if (text.length < 10) return;

  isAiLoading = true;
  isAiComplete = false;
  updateUI();

  chrome.runtime.sendMessage(
    { action: "check-text", text, tone: settings.tone, goals: settings.goals },
    (response: { issues: Issue[] } | undefined) => {
      isAiLoading = false;

      if (chrome.runtime.lastError) {
        console.error("[BambooInk] AI check failed:", chrome.runtime.lastError.message);
        updateUI();
        return;
      }

      if (!response) {
        updateUI();
        return;
      }

      isAiComplete = true;

      // Merge AI issues with existing local issues
      const localIssues = currentIssues.filter((i) => i.tier === "local");
      currentIssues = mergeResults(
        { tier: "local", issues: localIssues, latency: 0 },
        { tier: "ai", issues: response.issues, latency: 0 }
      );

      if (isInIframe) {
        relayIconToTop();
      } else {
        updateUI();
      }
    }
  );
}

// --- UI Rendering ---

function updateUI(): void {
  const { shadow } = ensureOverlayContainer();

  const caretRect = getCaretRect();
  if (!caretRect && !activeElement) {
    hideIcon(shadow);
    hidePanel(shadow);
    return;
  }

  // Position icon just below the caret
  const iconX = caretRect ? caretRect.x + 10 : 100;
  const iconY = caretRect ? caretRect.y + caretRect.height + 8 : 100;

  renderIcon(
    shadow,
    { issueCount: currentIssues.length, isLoading: isAiLoading },
    iconX,
    iconY,
    () => {
      panelOpen = !panelOpen;
      updateUI();
    }
  );

  if (panelOpen) {
    const panelX = iconX;
    const panelY = iconY + 36;

    const panelState: PanelState = {
      issues: currentIssues,
      isAiLoading,
      isAiComplete,
    };

    renderPanel(shadow, panelState, panelX, panelY, {
      onAccept: (issue: Issue) => {
        const targetEl = activeElement;
        if (targetEl) {
          replaceTextInElement(targetEl, issue.original, issue.suggestion);
          setTimeout(() => {
            if (targetEl) {
              lastCheckedText = getTextFromElement(targetEl).trim();
            }
          }, 250);
        }
        currentIssues = currentIssues.filter((i) => i.id !== issue.id);
        updateUI();
      },
      onDismiss: (issue: Issue) => {
        currentIssues = currentIssues.filter((i) => i.id !== issue.id);
        updateUI();
      },
      onEnhance: () => {
        enhanceWithAI();
      },
      onClose: () => {
        panelOpen = false;
        updateUI();
      },
    });
  } else {
    hidePanel(shadow);
  }
}

function hideUI(): void {
  if (shadowRoot) {
    hideIcon(shadowRoot);
    hidePanel(shadowRoot);
  }
  currentIssues = [];
  panelOpen = false;
  isAiComplete = false;
  isAiLoading = false;
}

// --- Iframe Relay ---

function relayIconToTop(): void {
  if (!chrome.runtime?.sendMessage) return;
  chrome.runtime.sendMessage({
    action: "relay-icon-to-top",
    issues: currentIssues,
    iframeSelector: iframeSelector,
    caretRect: getCaretRectForTopFrame(),
    isAiLoading,
    isAiComplete,
  });
}

// --- Event Handlers ---

function handleInput(e: Event): void {
  const el = getRealTarget(e);
  if (!el || !isTextField(el)) return;
  activeElement = el;
  const text = getTextFromElement(el);
  scheduleLocalCheck(text);
}

function handleFocusIn(e: FocusEvent): void {
  const el = getRealTarget(e);
  if (!el || !isTextField(el)) return;
  activeElement = el;
  const text = getTextFromElement(el);
  if (text.trim().length >= 10) {
    scheduleLocalCheck(text);
  } else {
    // Show icon even with no text
    updateUI();
  }
}

function handleFocusOut(e: FocusEvent): void {
  setTimeout(() => {
    if (interactingWithOverlay) return;
    hideUI();
    activeElement = null;
    lastCheckedText = "";
  }, 300);
}

// --- Event Listeners ---

document.addEventListener("input", handleInput, true);
document.addEventListener("focusin", handleFocusIn, true);
document.addEventListener("focusout", handleFocusOut, true);

// Close panel on click outside
document.addEventListener("click", (e) => {
  if (panelOpen && overlayContainer && !overlayContainer.contains(e.target as Node)) {
    panelOpen = false;
    updateUI();
  }
});

// Reposition icon on scroll/resize
window.addEventListener("scroll", () => {
  if (activeElement && shadowRoot) {
    const caretRect = getCaretRect();
    if (caretRect) {
      repositionIcon(shadowRoot, caretRect.x + 10, caretRect.y + caretRect.height + 8);
    }
  }
}, true);

window.addEventListener("resize", () => {
  if (activeElement) {
    updateUI();
  }
});

// --- Shadow DOM: scan existing DOM for open shadow roots ---

walkDOMForShadowRoots(document.documentElement);
console.log("[BambooInk] Initial shadow root scan complete, tracked:", knownShadowRoots.length);

// --- MutationObserver for SPA support ---
const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node instanceof HTMLElement) {
        walkDOMForShadowRoots(node);

        const fields = node.querySelectorAll
          ? [node, ...node.querySelectorAll("textarea, input, [contenteditable]")]
          : [node];
        for (const field of fields) {
          if (field instanceof HTMLElement && isTextField(field) && document.activeElement === field) {
            activeElement = field;
            const text = getTextFromElement(field);
            if (text.trim().length >= 10) {
              scheduleLocalCheck(text);
            }
          }
        }
      }
    }
  }
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
});

// --- Polling fallback for Shadow DOM ---
let lastPolledText = "";

setInterval(() => {
  if (!settings?.enabled) return;

  walkDOMForShadowRoots(document.documentElement);

  for (const shadow of knownShadowRoots) {
    try {
      const active = shadow.activeElement;
      if (active instanceof HTMLElement && isTextField(active)) {
        const text = getTextFromElement(active);
        if (text.trim().length >= 10 && text !== lastPolledText) {
          activeElement = active;
          lastPolledText = text;
          scheduleLocalCheck(text);
          return;
        }
      }
    } catch (e) {
      // Shadow root may have been detached
    }
  }
}, 2000);

// --- Self-detection for CKEditor iframe ---
function setupCKEditorSelfDetection(): void {
  if (window === window.top) return;

  try {
    const fe = window.frameElement;
    if (fe) {
      if (fe.classList.contains("cke_wysiwyg_frame")) {
        iframeSelector = "iframe.cke_wysiwyg_frame";
      } else if (fe.getAttribute("title")) {
        iframeSelector = `iframe[title="${fe.getAttribute("title")}"]`;
      } else if (fe.id) {
        iframeSelector = `iframe#${fe.id}`;
      } else {
        iframeSelector = "iframe[contenteditable-body]";
      }
    }
  } catch (e) {
    // Cross-origin
  }

  // Listen for text replacement commands from the top frame
  chrome.runtime.onMessage.addListener((message: any) => {
    if (message.action === "replace-text-in-iframe") {
      const target = activeElement || document.body;
      if (target && (target.isContentEditable || target instanceof HTMLTextAreaElement)) {
        replaceTextInElement(target, message.original, message.suggestion);
        setTimeout(() => {
          const newText = (document.body.innerText || "").replace(/\u00a0/g, " ");
          lastPolledText = newText;
          lastCheckedText = newText.trim();
        }, 250);
      }
    }
    if (message.action === "enhance-from-top") {
      enhanceWithAI();
    }
  });

  function checkAndAttach(): void {
    if (document.body && (document.body.isContentEditable || document.designMode === "on")) {
      console.log("[BambooInk] Detected contentEditable body in iframe, attaching listeners");
      document.body.addEventListener("input", handleInput, true);
      document.body.addEventListener("focusin", handleFocusIn as EventListener, true);
      document.body.addEventListener("focusout", handleFocusOut as EventListener, true);
    }
  }

  checkAndAttach();

  const htmlEl = document.documentElement;
  if (htmlEl) {
    const bodyObserver = new MutationObserver(() => {
      checkAndAttach();
    });
    bodyObserver.observe(htmlEl, { childList: true });
  }

  let selfPollCount = 0;
  const selfPollInterval = setInterval(() => {
    selfPollCount++;
    checkAndAttach();

    if (document.body && (document.body.isContentEditable || document.designMode === "on")) {
      const text = (document.body.innerText || "").replace(/\u00a0/g, " ");
      if (text.trim().length >= 10 && text !== lastPolledText) {
        activeElement = document.body;
        lastPolledText = text;
        scheduleLocalCheck(text);
      }
    }

    if (selfPollCount > 30) {
      clearInterval(selfPollInterval);
    }
  }, 2000);
}

setupCKEditorSelfDetection();

// --- Top-frame: listen for icon relay from iframes ---
if (!isInIframe) {
  let iframeOverlaySource = "";

  chrome.runtime.onMessage.addListener((message: any) => {
    if (message.action === "render-icon-from-iframe") {
      iframeOverlaySource = message.iframeSelector || "";
      currentIssues = message.issues;
      isAiLoading = message.isAiLoading || false;
      isAiComplete = message.isAiComplete || false;

      const { shadow } = ensureOverlayContainer();
      const caret = message.caretRect;

      if (caret) {
        const iconX = caret.x + 10;
        const iconY = caret.y + (caret.height || 16) + 8;

        renderIcon(
          shadow,
          { issueCount: currentIssues.length, isLoading: isAiLoading },
          iconX,
          iconY,
          () => {
            panelOpen = !panelOpen;
            renderTopFramePanel(shadow, iconX, iconY, iframeOverlaySource);
          }
        );

        if (panelOpen) {
          renderTopFramePanel(shadow, iconX, iconY, iframeOverlaySource);
        }
      }
    }
  });

  function renderTopFramePanel(shadow: ShadowRoot, iconX: number, iconY: number, sourceSelector: string): void {
    if (!panelOpen) {
      hidePanel(shadow);
      return;
    }

    const panelX = iconX;
    const panelY = iconY + 36;

    const panelState: PanelState = {
      issues: currentIssues,
      isAiLoading,
      isAiComplete,
    };

    renderPanel(shadow, panelState, panelX, panelY, {
      onAccept: (issue: Issue) => {
        chrome.runtime.sendMessage({
          action: "relay-replace-to-iframe",
          original: issue.original,
          suggestion: issue.suggestion,
        });
        currentIssues = currentIssues.filter((i) => i.id !== issue.id);
        renderTopFramePanel(shadow, iconX, iconY, sourceSelector);
        renderIcon(
          shadow,
          { issueCount: currentIssues.length, isLoading: isAiLoading },
          iconX,
          iconY,
          () => {
            panelOpen = !panelOpen;
            renderTopFramePanel(shadow, iconX, iconY, sourceSelector);
          }
        );
      },
      onDismiss: (issue: Issue) => {
        currentIssues = currentIssues.filter((i) => i.id !== issue.id);
        renderTopFramePanel(shadow, iconX, iconY, sourceSelector);
        renderIcon(
          shadow,
          { issueCount: currentIssues.length, isLoading: isAiLoading },
          iconX,
          iconY,
          () => {
            panelOpen = !panelOpen;
            renderTopFramePanel(shadow, iconX, iconY, sourceSelector);
          }
        );
      },
      onEnhance: () => {
        // Tell the iframe to run AI check
        chrome.runtime.sendMessage({
          action: "relay-enhance-to-iframe",
        });
      },
      onClose: () => {
        panelOpen = false;
        hidePanel(shadow);
      },
    });
  }
}

console.log("[BambooInk] Content script loaded");
