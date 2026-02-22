/**
 * Text monitoring: event listeners, mutation observers, shadow DOM walking,
 * CKEditor iframe detection, and polling fallback.
 */

import { isTextField, getTextFromElement, getRealTarget, getWordAtCursor, replaceTextInElement, resolveEditorRoot } from "./injector";
import type { WordAtCursor } from "./injector";

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
}

// --- Shadow DOM walking ---

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
    if (el.shadowRoot) {
      attachShadowListeners(el.shadowRoot);
      walkDOMForShadowRoots(el.shadowRoot);
    }
  }
  if (root instanceof Element && root.shadowRoot) {
    attachShadowListeners(root.shadowRoot);
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
  console.log("[BambooInk] handleInput:", rawEl?.tagName, rawEl?.className, "isTextField:", rawEl ? isTextField(rawEl) : false, "inIframe:", isInIframe);
  if (!rawEl || !isTextField(rawEl)) return;
  const el = resolveEditorRoot(rawEl);
  console.log("[BambooInk] handleInput accepted, resolved:", el.tagName, el.className);
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

  console.log("[BambooInk][iframe] setupCKEditorSelfDetection running, hostname:", location.hostname);
  try {
    const fe = window.frameElement;
    console.log("[BambooInk][iframe] frameElement:", fe?.tagName, fe?.id, fe?.className, "title:", fe?.getAttribute("title"));
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
    } else {
      console.log("[BambooInk][iframe] frameElement is null — likely cross-origin");
    }
    console.log("[BambooInk][iframe] resolved iframeSelector:", iframeSelector);
  } catch (e) {
    console.log("[BambooInk][iframe] cross-origin error:", e);
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
            replaceTextInElement(target, message.original, message.suggestion);
            setTimeout(() => {
              const newText = (document.body.innerText || "").replace(
                /\u00a0/g,
                " "
              );
              lastPolledText = newText;
              lastCheckedText = newText.trim();
            }, 250);
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
      const text = (document.body.innerText || "").replace(/\u00a0/g, " ");
      if (text.trim().length >= 10 && text !== lastPolledText && !idleTimer) {
        activeElement = document.body;
        lastPolledText = text;
        callbacks.onTextChange(text.trim(), document.body);
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
              if (text.length >= 10) {
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
          const text = getTextFromElement(active);
          if (text.trim().length >= 10 && text !== lastPolledText) {
            activeElement = active;
            lastPolledText = text;
            callbacks.onTextChange(text.trim(), active);
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
