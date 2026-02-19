import "./content-script.css";
import type { Issue, Settings } from "../shared/types";

let settings: Settings | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let currentIssues: Issue[] = [];
let lastCheckedText = "";
let activeElement: HTMLElement | null = null;
let overlayContainer: HTMLDivElement | null = null;
let shadowRoot: ShadowRoot | null = null;
let checkGeneration = 0;
let interactingWithOverlay = false;

// Track shadow roots we've already attached listeners to
const listenedShadowRoots = new WeakSet<ShadowRoot>();
// Keep a strong reference list for polling
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

  // Also observe mutations inside this shadow root
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
  // Check root itself if it's an element
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
    console.log("[BambooInk] Settings loaded, enabled:", s?.enabled, "hasKey:", !!s?.apiKey);
  });
}
loadSettings();

// Listen for settings changes
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
    // Normalize non-breaking spaces so AI sees same text we'll match against
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
    // Direct value replacement — most reliable approach
    el.value = el.value.substring(0, start) + suggestion + el.value.substring(start + original.length);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    console.log("[BambooInk] Replaced in textarea/input via direct value set");
  } else if (el.isContentEditable) {
    // Build a map of all text nodes and their positions in the full text
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const textNodes: { node: Text; start: number }[] = [];
    let fullText = "";
    let tNode: Text | null;
    while ((tNode = walker.nextNode() as Text | null)) {
      textNodes.push({ node: tNode, start: fullText.length });
      fullText += tNode.textContent || "";
    }

    // Normalize whitespace: email editors use non-breaking spaces (\u00a0)
    const normalize = (s: string) => s.replace(/[\u00a0\u200b\u200c\u200d\ufeff]/g, " ").replace(/\s+/g, " ");
    const normalizedFull = normalize(fullText);
    const normalizedOriginal = normalize(original);

    // Search in normalized text, but map position back to raw text
    const normalizedIdx = normalizedFull.indexOf(normalizedOriginal);
    if (normalizedIdx === -1) {
      console.log("[BambooInk] Original text not found in contenteditable. Full text:", JSON.stringify(fullText), "Searching for:", JSON.stringify(original));
      return;
    }

    // Map normalized index back to raw index by walking char-by-char
    let rawIdx = 0;
    let normCount = 0;
    while (normCount < normalizedIdx && rawIdx < fullText.length) {
      rawIdx++;
      normCount++;
    }
    const idx = rawIdx;

    // Calculate raw end
    let rawEnd = idx;
    let matchedNorm = 0;
    while (matchedNorm < normalizedOriginal.length && rawEnd < fullText.length) {
      rawEnd++;
      matchedNorm++;
    }
    console.log("[BambooInk] Found match at raw idx:", idx, "rawEnd:", rawEnd, "in fullText length:", fullText.length);

    // Find the start and end text nodes that the match spans
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

    // Try execCommand first for undo support
    el.focus();
    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
      sel.removeAllRanges();
      sel.addRange(range);
      if (document.execCommand("insertText", false, suggestion)) {
        console.log("[BambooInk] Replaced in contenteditable via execCommand");
        return;
      }
    }

    // Fallback: delete the range and insert text
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    range.deleteContents();
    const textNode = document.createTextNode(suggestion);
    range.insertNode(textNode);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    console.log("[BambooInk] Replaced in contenteditable via range manipulation");
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

  // For contenteditable, use selection API
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

// --- Overlay UI ---

function ensureOverlayContainer(): { container: HTMLDivElement; shadow: ShadowRoot } {
  if (overlayContainer && shadowRoot) {
    return { container: overlayContainer, shadow: shadowRoot };
  }

  overlayContainer = document.createElement("div");
  overlayContainer.id = "bambooink-overlay";
  overlayContainer.style.cssText = "position: fixed; z-index: 2147483647; pointer-events: none;";
  document.body.appendChild(overlayContainer);

  shadowRoot = overlayContainer.attachShadow({ mode: "open" });

  // Track overlay interaction to prevent focusout from hiding it
  overlayContainer.addEventListener("mousedown", () => { interactingWithOverlay = true; });
  overlayContainer.addEventListener("mouseup", () => {
    setTimeout(() => { interactingWithOverlay = false; }, 400);
  });

  // Inject styles into shadow DOM
  const style = document.createElement("style");
  style.textContent = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    .bambooink-panel {
      pointer-events: auto;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: white;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.15), 0 2px 8px rgba(0,0,0,0.1);
      overflow: hidden;
      max-width: 340px;
      border: 1px solid #e5e7eb;
    }
    .bambooink-pill {
      pointer-events: auto;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      background: #15803D;
      color: white;
      font-size: 12px;
      font-weight: 600;
      border-radius: 20px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      user-select: none;
      white-space: nowrap;
    }
    .bambooink-pill:hover { background: #16A34A; }
    .bambooink-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      background: #15803D;
      color: white;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .bambooink-issue {
      padding: 10px 14px;
      border-bottom: 1px solid #f3f4f6;
    }
    .bambooink-issue:last-child { border-bottom: none; }
    .bambooink-issue-type {
      display: inline-block;
      font-size: 10px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 4px;
      margin-bottom: 4px;
    }
    .type-spelling { background: #FEE2E2; color: #DC2626; }
    .type-grammar { background: #FEF3C7; color: #D97706; }
    .type-tone { background: #E0E7FF; color: #4F46E5; }
    .type-clarity { background: #E0F2FE; color: #0284C7; }
    .bambooink-original {
      text-decoration: line-through;
      color: #9ca3af;
      font-size: 13px;
    }
    .bambooink-arrow { color: #9ca3af; margin: 0 4px; font-size: 12px; }
    .bambooink-suggestion {
      color: #15803D;
      font-weight: 600;
      font-size: 13px;
    }
    .bambooink-explanation {
      font-size: 11px;
      color: #6b7280;
      margin-top: 4px;
    }
    .bambooink-actions {
      display: flex;
      gap: 6px;
      margin-top: 6px;
    }
    .bambooink-btn {
      font-size: 11px;
      padding: 3px 10px;
      border-radius: 4px;
      border: none;
      cursor: pointer;
      font-weight: 500;
    }
    .bambooink-btn-accept {
      background: #15803D;
      color: white;
    }
    .bambooink-btn-accept:hover { background: #16A34A; }
    .bambooink-btn-dismiss {
      background: #f3f4f6;
      color: #6b7280;
    }
    .bambooink-btn-dismiss:hover { background: #e5e7eb; }
  `;
  shadowRoot.appendChild(style);

  return { container: overlayContainer, shadow: shadowRoot };
}

function renderOverlay(): void {
  const { container, shadow } = ensureOverlayContainer();

  // Remove old content (keep style)
  const oldPanel = shadow.querySelector(".bambooink-root");
  if (oldPanel) oldPanel.remove();

  if (currentIssues.length === 0) {
    container.style.display = "none";
    return;
  }

  container.style.display = "block";

  // Position near caret
  const caretRect = getCaretRect();
  if (caretRect) {
    let x = caretRect.x + 10;
    let y = caretRect.y + caretRect.height + 8;
    if (x + 350 > window.innerWidth) x = window.innerWidth - 360;
    if (x < 10) x = 10;
    if (y + 300 > window.innerHeight) y = caretRect.y - 308;
    if (y < 10) y = 10;
    container.style.left = `${x}px`;
    container.style.top = `${y}px`;
  }

  const root = document.createElement("div");
  root.className = "bambooink-root";

  const isExpanded = container.dataset.expanded === "true";

  if (!isExpanded) {
    const pill = document.createElement("div");
    pill.className = "bambooink-pill";
    pill.innerHTML = `<span>${currentIssues.length} issue${currentIssues.length !== 1 ? "s" : ""}</span>`;
    pill.addEventListener("click", (e) => {
      e.stopPropagation();
      container.dataset.expanded = "true";
      renderOverlay();
    });
    root.appendChild(pill);
  } else {
    const panel = document.createElement("div");
    panel.className = "bambooink-panel";

    const header = document.createElement("div");
    header.className = "bambooink-header";
    header.innerHTML = `<span>BambooInk - ${currentIssues.length} issue${currentIssues.length !== 1 ? "s" : ""}</span><span style="font-size:16px">&#x2715;</span>`;
    header.addEventListener("click", (e) => {
      e.stopPropagation();
      container.dataset.expanded = "false";
      renderOverlay();
    });
    panel.appendChild(header);

    for (const issue of currentIssues) {
      const issueEl = document.createElement("div");
      issueEl.className = "bambooink-issue";

      const typeClass = `type-${issue.type}`;
      issueEl.innerHTML = `
        <span class="bambooink-issue-type ${typeClass}">${issue.label}</span>
        <div>
          <span class="bambooink-original">${escapeHtml(issue.original)}</span>
          <span class="bambooink-arrow">&rarr;</span>
          <span class="bambooink-suggestion">${escapeHtml(issue.suggestion)}</span>
        </div>
        <div class="bambooink-explanation">${escapeHtml(issue.explanation)}</div>
        <div class="bambooink-actions">
          <button class="bambooink-btn bambooink-btn-accept" data-issue-id="${issue.id}">Accept</button>
          <button class="bambooink-btn bambooink-btn-dismiss" data-issue-id="${issue.id}">Dismiss</button>
        </div>
      `;

      // Accept handler
      issueEl.querySelector(".bambooink-btn-accept")?.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        const targetEl = activeElement;
        console.log("[BambooInk] Accept clicked, activeElement:", targetEl?.tagName, "original:", issue.original);
        if (targetEl) {
          replaceTextInElement(targetEl, issue.original, issue.suggestion);
        }
        currentIssues = currentIssues.filter((i) => i.id !== issue.id);
        lastCheckedText = "";
        setTimeout(() => renderOverlay(), 100);
      });

      // Dismiss handler
      issueEl.querySelector(".bambooink-btn-dismiss")?.addEventListener("click", (e) => {
        e.stopPropagation();
        currentIssues = currentIssues.filter((i) => i.id !== issue.id);
        renderOverlay();
      });

      panel.appendChild(issueEl);
    }

    root.appendChild(panel);
  }

  shadow.appendChild(root);
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function hideOverlay(): void {
  if (overlayContainer) {
    overlayContainer.style.display = "none";
    overlayContainer.dataset.expanded = "false";
  }
  currentIssues = [];
}

// --- Main Logic ---

function scheduleCheck(text: string): void {
  if (!settings?.enabled || !settings?.apiKey) {
    console.log("[BambooInk] Check skipped — enabled:", settings?.enabled, "hasKey:", !!settings?.apiKey);
    return;
  }

  const trimmed = text.trim();
  if (trimmed.length < 10) {
    hideOverlay();
    return;
  }

  if (trimmed === lastCheckedText) return;

  if (debounceTimer) clearTimeout(debounceTimer);

  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    const thisGeneration = ++checkGeneration;

    console.log("[BambooInk] Sending check for", trimmed.length, "chars");
    chrome.runtime.sendMessage(
      { action: "check-text", text: trimmed, tone: settings!.tone, goals: settings!.goals },
      (response: { issues: Issue[] } | undefined) => {
        if (chrome.runtime.lastError) {
          console.error("[BambooInk] Check failed:", chrome.runtime.lastError.message);
          return;
        }
        if (thisGeneration !== checkGeneration) return;
        if (!response) { console.log("[BambooInk] No response from service worker"); return; }

        lastCheckedText = trimmed;
        currentIssues = response.issues;

        if (currentIssues.length > 0) {
          renderOverlay();
        } else {
          hideOverlay();
        }
      }
    );
  }, settings.debounceMs || 800);
}

// Get the real target, even inside Shadow DOM
function getRealTarget(e: Event): HTMLElement | null {
  const path = e.composedPath();
  const el = (path.length > 0 ? path[0] : e.target) as HTMLElement;
  return el || null;
}

function handleInput(e: Event): void {
  const el = getRealTarget(e);
  if (!el || !isTextField(el)) return;
  activeElement = el;
  const text = getTextFromElement(el);
  scheduleCheck(text);
}

function handleFocusIn(e: FocusEvent): void {
  const el = getRealTarget(e);
  if (!el || !isTextField(el)) return;
  activeElement = el;
  const text = getTextFromElement(el);
  if (text.trim().length >= 10) {
    scheduleCheck(text);
  }
}

function handleFocusOut(e: FocusEvent): void {
  setTimeout(() => {
    if (interactingWithOverlay) return;
    hideOverlay();
    activeElement = null;
    lastCheckedText = "";
  }, 300);
}

// --- Event Listeners ---

document.addEventListener("input", handleInput, true);
document.addEventListener("focusin", handleFocusIn, true);
document.addEventListener("focusout", handleFocusOut, true);

// Handle clicks outside overlay to close it
document.addEventListener("click", (e) => {
  if (overlayContainer && overlayContainer.dataset.expanded === "true") {
    if (!overlayContainer.contains(e.target as Node)) {
      overlayContainer.dataset.expanded = "false";
      renderOverlay();
    }
  }
});

// --- Shadow DOM: scan existing DOM for open shadow roots ---

walkDOMForShadowRoots(document.documentElement);
console.log("[BambooInk] Initial shadow root scan complete, tracked:", knownShadowRoots.length);

// --- MutationObserver for SPA support (Salesforce, etc.) ---
// Watch for dynamically added elements, check for shadow roots and text fields
const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node instanceof HTMLElement) {
        // Check for shadow roots on new elements
        walkDOMForShadowRoots(node);

        // Check for text fields in light DOM
        const fields = node.querySelectorAll
          ? [node, ...node.querySelectorAll("textarea, input, [contenteditable]")]
          : [node];
        for (const field of fields) {
          if (field instanceof HTMLElement && isTextField(field) && document.activeElement === field) {
            activeElement = field;
            const text = getTextFromElement(field);
            if (text.trim().length >= 10) {
              scheduleCheck(text);
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

// --- Polling fallback for Salesforce ---
// Catches cases where events are swallowed by Salesforce's event handlers
// or where shadow roots are created after our MutationObserver fires
let lastPolledText = "";
setInterval(() => {
  if (!settings?.enabled || !settings?.apiKey) return;

  // Re-scan DOM for any new shadow roots (SPA navigation, lazy-loaded components)
  walkDOMForShadowRoots(document.documentElement);

  // Search for focused contenteditable elements inside tracked shadow roots
  for (const shadow of knownShadowRoots) {
    try {
      // Look for focused contenteditable inside this shadow root
      const active = shadow.activeElement;
      if (active instanceof HTMLElement && isTextField(active)) {
        const text = getTextFromElement(active);
        if (text.trim().length >= 10 && text !== lastPolledText) {
          console.log("[BambooInk] Poller found active text field in shadow root:", active.tagName, "text length:", text.length);
          activeElement = active;
          lastPolledText = text;
          scheduleCheck(text);
          return;
        }
      }

      // Also check for contenteditable elements that might be focused
      const editables = shadow.querySelectorAll("[contenteditable]");
      for (const el of editables) {
        if (el instanceof HTMLElement) {
          const text = getTextFromElement(el);
          if (text.trim().length >= 10 && text !== lastPolledText) {
            // Check if this element or its parent has focus
            if (el.contains(document.activeElement) || shadow.activeElement === el || document.activeElement?.contains(shadow.host)) {
              console.log("[BambooInk] Poller found contenteditable in shadow root:", el.className || el.tagName);
              activeElement = el;
              lastPolledText = text;
              scheduleCheck(text);
              return;
            }
          }
        }
      }
    } catch (e) {
      // Shadow root may have been detached
    }
  }
}, 2000);

console.log("[BambooInk] Content script loaded");
