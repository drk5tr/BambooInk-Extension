/**
 * Text monitoring: event listeners, mutation observers, shadow DOM walking,
 * CKEditor iframe detection, and polling fallback.
 */

import { isTextField, getTextFromElement, getRealTarget, getWordAtCursor, replaceTextInElement, resolveEditorRoot } from "./injector";
import type { WordAtCursor } from "./injector";
import { bumpAcceptGeneration, setLastAcceptedText } from "./overlay";

export interface ObserverCallbacks {
  onWordChange: (wordInfo: WordAtCursor, element: HTMLElement) => void;
  onTextChange: (text: string, element: HTMLElement) => void;
  onCursorMove: (element: HTMLElement) => void;
  onFocusIn: (element: HTMLElement) => void;
  onFocusOut: () => void;
}

// Module state
let callbacks: ObserverCallbacks;
let activeElement: HTMLElement | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let lastCheckedText = "";
let lastPolledText = "";
let aiIdleMs = 1000;
let suppressNextIdle = false;
let suppressUntil = 0;

const isInIframe = window !== window.top;
let iframeSelector = "";

// Shadow root tracking
const listenedShadowRoots = new WeakSet<ShadowRoot>();
const knownShadowRoots: ShadowRoot[] = [];

export function getActiveElement(): HTMLElement | null {
  return activeElement;
}

export function setActiveElement(el: HTMLElement | null): void {
  activeElement = el;
}

export function getIframeSelector(): string {
  return iframeSelector;
}

export function getIsInIframe(): boolean {
  return isInIframe;
}

export function setLastCheckedText(text: string): void {
  lastCheckedText = text;
  lastPolledText = text;
}

export function setAiIdleMs(ms: number): void {
  aiIdleMs = ms;
}

export function suppressNextIdleCheck(): void {
  suppressNextIdle = true;
  // Block all recheck paths (idle timers, polling, mutation observer) for 10s
  suppressUntil = Date.now() + 10000;
}

export function isTextCheckSuppressed(): boolean {
  return Date.now() < suppressUntil;
}

// --- Shadow DOM walking ---

function getShadowRoot(el: Element): ShadowRoot | null {
  if (el.shadowRoot) return el.shadowRoot;
  try {
    return (chrome.dom as any).openOrClosedShadowRoot(el) as ShadowRoot | null;
  } catch {
    return null;
  }
}

function attachShadowListeners(shadow: ShadowRoot): void {
  if (listenedShadowRoots.has(shadow)) return;
  listenedShadowRoots.add(shadow);
  knownShadowRoots.push(shadow);
  shadow.addEventListener("input", handleInput, true);
  shadow.addEventListener("focusin", handleFocusIn as EventListener, true);
  shadow.addEventListener("focusout", handleFocusOut as EventListener, true);
  shadow.addEventListener("keyup", handleCursorMove, true);
  shadow.addEventListener("click", handleCursorMove, true);

  const shadowObserver = new MutationObserver(() => {
    walkDOMForShadowRoots(shadow);
  });
  shadowObserver.observe(shadow, { childList: true, subtree: true });
}

function walkDOMForShadowRoots(root: ShadowRoot | Element): void {
  const elements = root.querySelectorAll("*");
  for (const el of elements) {
    const shadow = getShadowRoot(el);
    if (shadow) {
      attachShadowListeners(shadow);
      walkDOMForShadowRoots(shadow);
    }
  }
  if (root instanceof Element) {
    const shadow = getShadowRoot(root);
    if (shadow) {
      attachShadowListeners(shadow);
    }
  }
}

// --- Placeholder detection ---

const PLACEHOLDER_PATTERNS = [
  /^press\s+\/\s+for\b/i,         // Gmail "Press / for Help me write"
  /^type\s+\/\s+to\b/i,           // Docs-style "Type / to ..."
  /^write\s+something/i,          // Generic placeholder
  /^compose\s+(an?\s+)?/i,        // "Compose a ..."
];

function isPlaceholderText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length > 80) return false; // Real content won't be short placeholder
  return PLACEHOLDER_PATTERNS.some(p => p.test(trimmed));
}

// --- Event Handlers ---

function handleCursorMove(e: Event): void {
  const el = getRealTarget(e);
  if (!el || !isTextField(el)) return;
  if (el === activeElement) {
    callbacks.onCursorMove(el);
  }
}

function handleInput(e: Event): void {
  const rawEl = getRealTarget(e);
  if (!rawEl || !isTextField(rawEl)) return;
  const el = resolveEditorRoot(rawEl);
  activeElement = el;

  // Reposition icon immediately
  callbacks.onCursorMove(el);

  // Full-text check after 1s idle (includes spelling + grammar)
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (suppressNextIdle) {
      suppressNextIdle = false;
      return;
    }
    if (Date.now() < suppressUntil) return;
    const text = getTextFromElement(el).trim();
    if (text.length >= 10 && text !== lastCheckedText && !isPlaceholderText(text)) {
      lastCheckedText = text;
      callbacks.onTextChange(text, el);
    }
  }, aiIdleMs);
}

function handleFocusIn(e: FocusEvent): void {
  const rawEl = getRealTarget(e);
  if (!rawEl || !isTextField(rawEl)) return;
  const el = resolveEditorRoot(rawEl);
  activeElement = el;
  callbacks.onFocusIn(el);

  // Run full-text check on focus (with idle delay)
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (Date.now() < suppressUntil) return;
    const text = getTextFromElement(el).trim();
    if (text.length >= 10 && text !== lastCheckedText && !isPlaceholderText(text)) {
      lastCheckedText = text;
      callbacks.onTextChange(text, el);
    }
  }, aiIdleMs);
}

function handleFocusOut(_e: FocusEvent): void {
  callbacks.onFocusOut();
}

// --- CKEditor iframe self-detection ---

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
  } catch {
    // Cross-origin iframe — cannot access frameElement
  }

  // Listen for text replacement commands from the top frame
  if (chrome.runtime?.id) {
    try {
      chrome.runtime.onMessage.addListener((message: any) => {
        if (message.action === "replace-text-in-iframe") {
          const target = activeElement || document.body;
          if (
            target &&
            (target.isContentEditable || target instanceof HTMLTextAreaElement)
          ) {
            suppressNextIdle = true;
            suppressUntil = Date.now() + 10000;
            bumpAcceptGeneration();
            replaceTextInElement(target, message.original, message.suggestion);
            // Immediately update so idle/poll checks see the new text and skip
            const newText = getTextFromElement(target).trim();
            lastPolledText = newText;
            lastCheckedText = newText;
            setLastAcceptedText(newText);
          }
        }
      });
    } catch {
      // Context invalidated
    }
  }

  function checkAndAttach(): void {
    if (
      document.body &&
      (document.body.isContentEditable || document.designMode === "on")
    ) {
      document.body.addEventListener("input", handleInput, true);
      document.body.addEventListener(
        "focusin",
        handleFocusIn as EventListener,
        true
      );
      document.body.addEventListener(
        "focusout",
        handleFocusOut as EventListener,
        true
      );
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

    if (
      document.body &&
      (document.body.isContentEditable || document.designMode === "on")
    ) {
      const rawText = (document.body.innerText || "").replace(/\u00a0/g, " ");
      const text = rawText.trim();
      if (text.length >= 10 && text !== lastPolledText && !idleTimer && Date.now() >= suppressUntil) {
        activeElement = document.body;
        lastPolledText = text;
        callbacks.onTextChange(text, document.body);
      }
    }

    if (selfPollCount > 30) {
      clearInterval(selfPollInterval);
    }
  }, 2000);
}

// --- Main setup ---

export function setupObservers(cbs: ObserverCallbacks): void {
  callbacks = cbs;

  // Attach to document
  document.addEventListener("input", handleInput, true);
  document.addEventListener("focusin", handleFocusIn as EventListener, true);
  document.addEventListener("focusout", handleFocusOut as EventListener, true);
  document.addEventListener("keyup", handleCursorMove, true);
  document.addEventListener("click", handleCursorMove, true);

  // Scan existing shadow DOM
  walkDOMForShadowRoots(document.documentElement);

  // MutationObserver for SPA support
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLElement) {
          walkDOMForShadowRoots(node);

          const fields = node.querySelectorAll
            ? [node, ...node.querySelectorAll("textarea, input, [contenteditable]")]
            : [node];
          for (const field of fields) {
            if (
              field instanceof HTMLElement &&
              isTextField(field) &&
              document.activeElement === field
            ) {
              activeElement = field;
              const text = getTextFromElement(field).trim();
              if (text.length >= 10 && Date.now() >= suppressUntil) {
                callbacks.onTextChange(text, field);
              }
            }
          }
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Polling fallback for shadow DOM
  setInterval(() => {
    walkDOMForShadowRoots(document.documentElement);

    for (const shadow of knownShadowRoots) {
      try {
        const active = shadow.activeElement;
        if (active instanceof HTMLElement && isTextField(active)) {
          const text = getTextFromElement(active).trim();
          if (text.length >= 10 && text !== lastPolledText && Date.now() >= suppressUntil) {
            activeElement = active;
            lastPolledText = text;
            callbacks.onTextChange(text, active);
            return;
          }
        }
      } catch (e) {
        // Shadow root may have been detached
      }
    }
  }, 2000);

  // CKEditor iframe support
  setupCKEditorSelfDetection();
}
