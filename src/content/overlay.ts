/**
 * UI orchestration: shadow DOM container, icon + panel rendering,
 * scroll/resize repositioning, and iframe relay.
 */

import type { Issue } from "../shared/types";
import { SHADOW_STYLES } from "./ui/styles";
import { renderIcon, repositionIcon, hideIcon } from "./ui/floating-icon";
import { renderPanel, hidePanel } from "./ui/suggestions-panel";
import type { PanelState } from "./ui/suggestions-panel";
import { renderUnderlines, clearUnderlines } from "./ui/underline-layer";
import { showIssuePopup, hideIssuePopup } from "./ui/issue-popup";
import { getCaretRectForTopFrame, replaceTextInElement, getTextFromElement } from "./injector";
import { getActiveElement, getIframeSelector, getIsInIframe, setLastCheckedText, suppressNextIdleCheck } from "./observer";

function resetAIGateIfEmpty(): void {
  if (currentIssues.length === 0) {
    try {
      chrome.runtime.sendMessage({ action: "reset-ai-gate" });
    } catch { /* context invalidated */ }
  }
}

let resizeObserver: ResizeObserver | null = null;
let observedElement: HTMLElement | null = null;
let bodyObserved = false;
let inputRepositionHandler: (() => void) | null = null;

// --- Dismissed issue tracking ---
const MAX_DISMISSED = 20;
let dismissedOriginals: string[] = [];

export function getDismissedOriginals(): string[] {
  return dismissedOriginals;
}

export function resetDismissedOriginals(): void {
  dismissedOriginals = [];
}

function trackDismissed(original: string): void {
  if (dismissedOriginals.length >= MAX_DISMISSED) return;
  if (!dismissedOriginals.includes(original)) {
    dismissedOriginals.push(original);
  }
}

let overlayContainer: HTMLDivElement | null = null;
let shadowRoot: ShadowRoot | null = null;
let interactingWithOverlay = false;
let panelOpen = false;
let currentIssues: Issue[] = [];
let acceptGeneration = 0;
let lastAcceptedText = "";
let currentError: string | undefined;
let activePopupIssueId: string | null = null;

export function getAcceptGeneration(): number {
  return acceptGeneration;
}

export function bumpAcceptGeneration(): void {
  acceptGeneration++;
}

export function getLastAcceptedText(): string {
  return lastAcceptedText;
}

export function setLastAcceptedText(text: string): void {
  lastAcceptedText = text;
}

export function getCurrentIssues(): Issue[] {
  return currentIssues;
}

export function setCurrentIssues(issues: Issue[]): void {
  currentIssues = issues;
}

export function getCurrentError(): string | undefined {
  return currentError;
}

export function setCurrentError(error: string | undefined): void {
  currentError = error;
}

function ensureOverlayContainer(): { container: HTMLDivElement; shadow: ShadowRoot } {
  if (overlayContainer && shadowRoot) {
    return { container: overlayContainer, shadow: shadowRoot };
  }

  overlayContainer = document.createElement("div");
  overlayContainer.id = "bambooink-overlay";
  overlayContainer.setAttribute("contenteditable", "false");
  overlayContainer.style.cssText =
    "position: fixed; z-index: 2147483647; pointer-events: none; top: 0; left: 0; width: 0; height: 0;";
  // Append to documentElement if body is contenteditable (e.g. CKEditor iframe)
  const appendTarget = document.body.isContentEditable ? document.documentElement : document.body;
  appendTarget.appendChild(overlayContainer);

  shadowRoot = overlayContainer.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = SHADOW_STYLES;
  shadowRoot.appendChild(style);

  // Track interaction via capture phase so it fires before panel's stopPropagation
  shadowRoot.addEventListener("mousedown", () => {
    interactingWithOverlay = true;
  }, true);
  shadowRoot.addEventListener("mouseup", () => {
    setTimeout(() => {
      interactingWithOverlay = false;
    }, 400);
  }, true);

  return { container: overlayContainer, shadow: shadowRoot };
}

export function isInteractingWithOverlay(): boolean {
  return interactingWithOverlay;
}

function observeElement(el: HTMLElement | null): void {
  if (el === observedElement) return;
  if (resizeObserver && observedElement) {
    resizeObserver.unobserve(observedElement);
  }
  // Remove previous input listener for auto-growing textareas
  if (inputRepositionHandler && observedElement) {
    observedElement.removeEventListener("input", inputRepositionHandler);
    inputRepositionHandler = null;
  }
  observedElement = el;
  if (!el) return;
  // For auto-growing textareas, reposition on every input since the top shifts
  if (el instanceof HTMLTextAreaElement) {
    inputRepositionHandler = () => {
      if (!shadowRoot || !observedElement) return;
      requestAnimationFrame(() => {
        const pos = getElementBottomRight(observedElement);
        if (pos) repositionIcon(shadowRoot!, pos.x, pos.y);
      });
    };
    el.addEventListener("input", inputRepositionHandler);
  }
  if (!resizeObserver) {
    resizeObserver = new ResizeObserver(() => {
      if (!shadowRoot || !observedElement) return;
      const pos = getElementBottomRight(observedElement);
      if (!pos) {
        hideIcon(shadowRoot);
        hidePanel(shadowRoot);
      } else {
        repositionIcon(shadowRoot, pos.x, pos.y);
      }
      requestAnimationFrame(() => refreshUnderlines());
    });
  }
  resizeObserver.observe(el);
  // Also observe body so layout shifts (e.g. banners) trigger a reposition
  if (!bodyObserved && document.body) {
    resizeObserver.observe(document.body);
    bodyObserved = true;
  }
}

function getElementBottomRight(el: HTMLElement | null): { x: number; y: number } | null {
  if (!el) return null;
  // Hidden or minimized (e.g. Gmail minimized compose) — skip check for body/html
  if (el !== document.body && el !== document.documentElement
    && el.offsetParent === null && getComputedStyle(el).position !== "fixed") return null;

  // For body/html (e.g. CKEditor iframe), use viewport dimensions
  if (el === document.body || el === document.documentElement) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (vw === 0 || vh === 0) return null;
    return { x: vw - 36, y: vh - 36 };
  }

  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;

  // Salesforce Live Agent: anchor to top of textarea so auto-grow doesn't shift icon
  const isSFChat = el instanceof HTMLTextAreaElement && el.classList.contains("messaging-textarea");
  if (isSFChat) {
    return {
      x: rect.right - 36,
      y: rect.top - 40,
    };
  }
  return {
    x: rect.right - 36,
    y: rect.bottom - 36,
  };
}

/** Shift positions of remaining issues after a text replacement */
function adjustIssuePositions(acceptedIssue: Issue): void {
  const delta = acceptedIssue.suggestion.length - acceptedIssue.original.length;
  if (delta === 0) return;
  const end = acceptedIssue.position.end;
  for (const issue of currentIssues) {
    if (issue.id === acceptedIssue.id) continue;
    if (issue.position.start >= end) {
      issue.position = {
        start: issue.position.start + delta,
        end: issue.position.end + delta,
      };
    }
  }
}

function refreshUnderlines(): void {
  if (!shadowRoot) return;
  const activeElement = getActiveElement();
  if (!activeElement || (!activeElement.isContentEditable && !(activeElement instanceof HTMLTextAreaElement))) {
    clearUnderlines(shadowRoot);
    return;
  }
  renderUnderlines(shadowRoot, currentIssues, activeElement, {
    onIssueClick: (issue, anchorRect) => {
      if (!shadowRoot) return;
      // Close the panel if open
      if (panelOpen) {
        panelOpen = false;
        hidePanel(shadowRoot);
      }
      // Toggle popup: close if same issue clicked again
      if (activePopupIssueId === issue.id) {
        hideIssuePopup(shadowRoot);
        activePopupIssueId = null;
        return;
      }
      activePopupIssueId = issue.id;
      showIssuePopup(shadowRoot, issue, anchorRect, {
        onAccept: (iss) => {
          acceptGeneration++;
          trackDismissed(iss.suggestion);
          const targetEl = getActiveElement();
          if (targetEl) {
            suppressNextIdleCheck();
            replaceTextInElement(targetEl, iss.original, iss.suggestion);
            const newText = getTextFromElement(targetEl).trim();
            lastAcceptedText = newText;
            setLastCheckedText(newText);
            try {
              chrome.runtime.sendMessage({ action: "update-ai-gate", text: newText });
            } catch { /* context invalidated */ }
          }
          adjustIssuePositions(iss);
          currentIssues = currentIssues.filter((i) => i.id !== iss.id);
          activePopupIssueId = null;
          if (shadowRoot) hideIssuePopup(shadowRoot);
          updateUI();
        },
        onDismiss: (iss) => {
          trackDismissed(iss.original);
          currentIssues = currentIssues.filter((i) => i.id !== iss.id);
          activePopupIssueId = null;
          if (shadowRoot) hideIssuePopup(shadowRoot);
          resetAIGateIfEmpty();
          updateUI();
        },
      });
    },
  });
}

export function updateUI(): void {
  const { shadow } = ensureOverlayContainer();
  const activeElement = getActiveElement();
  observeElement(activeElement);

  const pos = getElementBottomRight(activeElement);
  if (!pos) {
    hideIcon(shadow);
    hidePanel(shadow);
    return;
  }

  const iconX = pos.x;
  const iconY = pos.y;

  const inIframe = getIsInIframe();

  renderIcon(
    shadow,
    { issueCount: currentIssues.length, isLoading: false, hasError: !!currentError },
    iconX,
    iconY,
    () => {
      if (inIframe) {
        // Relay panel toggle to top frame
        panelOpen = !panelOpen;
        if (panelOpen && activePopupIssueId) {
          hideIssuePopup(shadow);
          activePopupIssueId = null;
        }
        relayPanelToTop();
      } else {
        panelOpen = !panelOpen;
        if (panelOpen && activePopupIssueId) {
          hideIssuePopup(shadow);
          activePopupIssueId = null;
        }
        updateUI();
      }
    }
  );

  if (!inIframe) {
    if (panelOpen) {
      const panelX = iconX;
      const panelY = iconY + 36;

      const panelState: PanelState = {
        issues: currentIssues,
        error: currentError,
      };

      renderPanel(shadow, panelState, panelX, panelY, {
        onAccept: (issue: Issue) => {
          acceptGeneration++;
          trackDismissed(issue.suggestion);
          const targetEl = activeElement;
          if (targetEl) {
            suppressNextIdleCheck();
            replaceTextInElement(targetEl, issue.original, issue.suggestion);
            const newText = getTextFromElement(targetEl).trim();
            lastAcceptedText = newText;
            setLastCheckedText(newText);
            try {
              chrome.runtime.sendMessage({ action: "update-ai-gate", text: newText });
            } catch { /* context invalidated */ }
          }
          adjustIssuePositions(issue);
          currentIssues = currentIssues.filter((i) => i.id !== issue.id);
          updateUI();
        },
        onDismiss: (issue: Issue) => {
          trackDismissed(issue.original);
          currentIssues = currentIssues.filter((i) => i.id !== issue.id);
          resetAIGateIfEmpty();
          updateUI();
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

  // Render underlines after icon/panel
  requestAnimationFrame(() => refreshUnderlines());
}

export function hideUI(): void {
  if (shadowRoot) {
    hideIcon(shadowRoot);
    hidePanel(shadowRoot);
    clearUnderlines(shadowRoot);
    hideIssuePopup(shadowRoot);
  }
  currentIssues = [];
  currentError = undefined;
  panelOpen = false;
  activePopupIssueId = null;
  lastAcceptedText = "";
  resetDismissedOriginals();
}

function getIframeRectForTopFrame(): { x: number; y: number; width: number; height: number } | null {
  // Build the iframe's bounding rect in top-frame coordinates
  let rect = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
  let win: Window = window;
  while (win !== win.top) {
    try {
      const fe = win.frameElement;
      if (!fe) break;
      const feRect = fe.getBoundingClientRect();
      rect.x += feRect.x;
      rect.y += feRect.y;
      rect.width = feRect.width;
      rect.height = feRect.height;
      win = win.parent;
    } catch {
      break;
    }
  }
  return rect;
}

function relayPanelToTop(): void {
  if (!chrome.runtime?.id) return;
  const iframeRect = getIframeRectForTopFrame();
  // Send the actual icon position in iframe-local coordinates
  const activeElement = getActiveElement();
  const iconPos = getElementBottomRight(activeElement);
  try {
    chrome.runtime.sendMessage({
      action: "relay-panel-to-top",
      issues: currentIssues,
      iframeRect,
      iconPos,
      panelOpen,
    });
  } catch {
    // Context invalidated
  }
}

// --- Scroll/resize repositioning + click-outside ---

export function initUI(): void {
  // Close panel/popup on click outside
  document.addEventListener("click", (e) => {
    if (overlayContainer && !overlayContainer.contains(e.target as Node)) {
      let changed = false;
      if (panelOpen) {
        panelOpen = false;
        changed = true;
      }
      if (activePopupIssueId && shadowRoot) {
        hideIssuePopup(shadowRoot);
        activePopupIssueId = null;
        changed = true;
      }
      if (changed) updateUI();
    }
  });

  // Reposition icon + underlines on scroll/resize
  window.addEventListener(
    "scroll",
    () => {
      const activeElement = getActiveElement();
      if (activeElement && shadowRoot) {
        const pos = getElementBottomRight(activeElement);
        if (pos) {
          repositionIcon(shadowRoot, pos.x, pos.y);
        }
        // Close popup on scroll (anchor rect has moved)
        if (activePopupIssueId) {
          hideIssuePopup(shadowRoot);
          activePopupIssueId = null;
        }
        requestAnimationFrame(() => refreshUnderlines());
      }
    },
    true
  );

  window.addEventListener("resize", () => {
    if (getActiveElement()) {
      updateUI();
    }
  });

  // Top-frame: listen for panel relay from iframes
  if (!getIsInIframe()) {
    setupTopFrameIframeListener();
  }

  // Iframe: listen for issue updates from top frame
  if (getIsInIframe() && chrome.runtime?.id) {
    try {
      chrome.runtime.onMessage.addListener((message: any) => {
        if (message.action === "update-issues-in-iframe") {
          currentIssues = message.issues || [];
          updateUI();
        }
      });
    } catch { /* context invalidated */ }
  }
}

function setupTopFrameIframeListener(): void {
  if (!chrome.runtime?.id) return;

  chrome.runtime.onMessage.addListener((message: any) => {
    if (message.action === "render-panel-from-iframe") {
      const iframeRect = message.iframeRect;
      const isPanelOpen = message.panelOpen;
      currentIssues = message.issues;

      const { shadow } = ensureOverlayContainer();

      if (!isPanelOpen || !iframeRect) {
        hidePanel(shadow);
        return;
      }

      // Use relayed icon position if available, fallback to iframe bottom-right
      const iconLocalPos = message.iconPos;
      const panelX = iconLocalPos
        ? iframeRect.x + iconLocalPos.x
        : iframeRect.x + iframeRect.width - 36;
      // Icon top in top-frame coordinates; panel will be placed above it
      const iconTopY = iconLocalPos
        ? iframeRect.y + iconLocalPos.y
        : iframeRect.y + iframeRect.height - 36;
      const panelY = iconTopY;

      function syncIssuesToIframe(): void {
        if (chrome.runtime?.id) {
          try {
            chrome.runtime.sendMessage({
              action: "relay-update-issues-to-iframe",
              issues: currentIssues,
            });
          } catch { /* context invalidated */ }
        }
      }

      function renderIframePanel(): void {
        renderPanel(shadow, { issues: currentIssues }, panelX, panelY, {
          onAccept: (issue: Issue) => {
            acceptGeneration++;
            trackDismissed(issue.suggestion);
            if (chrome.runtime?.id) {
              try {
                chrome.runtime.sendMessage({
                  action: "relay-replace-to-iframe",
                  original: issue.original,
                  suggestion: issue.suggestion,
                });
              } catch { /* context invalidated */ }
            }
            currentIssues = currentIssues.filter((i) => i.id !== issue.id);
            syncIssuesToIframe();
            renderIframePanel();
          },
          onDismiss: (issue: Issue) => {
            trackDismissed(issue.original);
            currentIssues = currentIssues.filter((i) => i.id !== issue.id);
            syncIssuesToIframe();
            renderIframePanel();
          },
          onClose: () => {
            panelOpen = false;
            hidePanel(shadow);
          },
        }, { above: true });
      }
      renderIframePanel();
    }
  });
}
