/**
 * UI orchestration: shadow DOM container, icon + panel rendering,
 * scroll/resize repositioning, and iframe relay.
 */

import type { Issue } from "../shared/types";
import { SHADOW_STYLES } from "./ui/styles";
import { renderIcon, repositionIcon, hideIcon } from "./ui/floating-icon";
import { renderPanel, hidePanel } from "./ui/suggestions-panel";
import type { PanelState } from "./ui/suggestions-panel";
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

let overlayContainer: HTMLDivElement | null = null;
let shadowRoot: ShadowRoot | null = null;
let interactingWithOverlay = false;
let panelOpen = false;
let currentIssues: Issue[] = [];

export function getCurrentIssues(): Issue[] {
  return currentIssues;
}

export function setCurrentIssues(issues: Issue[]): void {
  currentIssues = issues;
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
  observedElement = el;
  if (!el) return;
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
  return {
    x: rect.right - 36,
    y: rect.bottom - 36,
  };
}

export function repositionAtCursor(): void {
  if (!shadowRoot) return;
  const activeElement = getActiveElement();
  const pos = getElementBottomRight(activeElement);
  if (pos) {
    repositionIcon(shadowRoot, pos.x, pos.y);
  }
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
    { issueCount: currentIssues.length, isLoading: false },
    iconX,
    iconY,
    () => {
      if (inIframe) {
        // Relay panel toggle to top frame
        panelOpen = !panelOpen;
        relayPanelToTop();
      } else {
        panelOpen = !panelOpen;
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
      };

      renderPanel(shadow, panelState, panelX, panelY, {
        onAccept: (issue: Issue) => {
          const targetEl = activeElement;
          if (targetEl) {
            suppressNextIdleCheck();
            replaceTextInElement(targetEl, issue.original, issue.suggestion);
            setTimeout(() => {
              if (targetEl) {
                setLastCheckedText(getTextFromElement(targetEl).trim());
              }
            }, 250);
          }
          currentIssues = currentIssues.filter((i) => i.id !== issue.id);
          resetAIGateIfEmpty();
          updateUI();
        },
        onDismiss: (issue: Issue) => {
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
}

export function hideUI(): void {
  if (shadowRoot) {
    hideIcon(shadowRoot);
    hidePanel(shadowRoot);
  }
  currentIssues = [];
  panelOpen = false;
}

function getIframeRectForTopFrame(): { x: number; y: number; width: number; height: number } | null {
  // Build the iframe's bounding rect in top-frame coordinates
  let rect = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
  let reachedTop = false;
  let win: Window = window;
  while (win !== win.top) {
    try {
      const fe = win.frameElement;
      console.log("[BambooInk][iframe] getIframeRectForTopFrame frameElement:", fe?.tagName, fe?.id, "feIsNull:", !fe);
      if (!fe) break;
      const feRect = fe.getBoundingClientRect();
      rect.x += feRect.x;
      rect.y += feRect.y;
      rect.width = feRect.width;
      rect.height = feRect.height;
      win = win.parent;
    } catch (e) {
      console.log("[BambooInk][iframe] getIframeRectForTopFrame cross-origin error:", e);
      break;
    }
  }
  reachedTop = (win === win.top);
  console.log("[BambooInk][iframe] getIframeRectForTopFrame result:", rect, "reachedTop:", reachedTop);
  return rect;
}

function relayPanelToTop(): void {
  if (!chrome.runtime?.id) return;
  const iframeRect = getIframeRectForTopFrame();
  try {
    chrome.runtime.sendMessage({
      action: "relay-panel-to-top",
      issues: currentIssues,
      iframeRect,
      panelOpen,
    });
  } catch {
    // Context invalidated
  }
}

// --- Scroll/resize repositioning + click-outside ---

export function initUI(): void {
  // Close panel on click outside
  document.addEventListener("click", (e) => {
    if (
      panelOpen &&
      overlayContainer &&
      !overlayContainer.contains(e.target as Node)
    ) {
      panelOpen = false;
      updateUI();
    }
  });

  // Reposition icon on scroll/resize
  window.addEventListener(
    "scroll",
    () => {
      const activeElement = getActiveElement();
      if (activeElement && shadowRoot) {
        const pos = getElementBottomRight(activeElement);
        if (pos) {
          repositionIcon(shadowRoot, pos.x, pos.y);
        }
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

      // Position panel just below where the icon sits (bottom-right of iframe viewport)
      const panelX = iframeRect.x + iframeRect.width - 36;
      // Icon is at iframeRect bottom - 36, panel starts just below icon (+36)
      const panelY = iframeRect.y + iframeRect.height;

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
        if (currentIssues.length === 0) {
          hidePanel(shadow);
          syncIssuesToIframe();
          return;
        }
        renderPanel(shadow, { issues: currentIssues }, panelX, panelY, {
          onAccept: (issue: Issue) => {
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
            resetAIGateIfEmpty();
            syncIssuesToIframe();
            renderIframePanel();
          },
          onDismiss: (issue: Issue) => {
            currentIssues = currentIssues.filter((i) => i.id !== issue.id);
            resetAIGateIfEmpty();
            syncIssuesToIframe();
            renderIframePanel();
          },
          onClose: () => {
            panelOpen = false;
            hidePanel(shadow);
          },
        });
      }
      renderIframePanel();
    }
  });
}
