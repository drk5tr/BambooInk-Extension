import "./content-script.css";
import type { Issue, Settings } from "../shared/types";

const isInIframe = window !== window.top;

let settings: Settings | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let currentIssues: Issue[] = [];
let lastCheckedText = "";
let activeElement: HTMLElement | null = null;
let overlayContainer: HTMLDivElement | null = null;
let shadowRoot: ShadowRoot | null = null;
let checkGeneration = 0;
let interactingWithOverlay = false;
// For iframe→top-frame overlay relay: identifies which iframe we're in
let iframeSelector = "";

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
  if (!chrome.runtime?.sendMessage) {
    console.log("[BambooInk] Check skipped — chrome.runtime unavailable (extension context invalidated)");
    return;
  }
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
          if (isInIframe) {
            // Relay issues to the top frame for rendering
            chrome.runtime.sendMessage({
              action: "relay-overlay-to-top",
              issues: response.issues,
              iframeSelector: iframeSelector,
            });
          } else {
            renderOverlay();
          }
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

// --- Polling fallback for CKEditor iframes + Shadow DOM ---
// CKEditor replaces the iframe document after content script loads,
// destroying all event listeners. We poll to find and attach to these iframes.
let lastPolledText = "";
const attachedIframeDocs = new WeakSet<Document>();

function attachToIframeDoc(doc: Document): void {
  if (attachedIframeDocs.has(doc)) return;
  attachedIframeDocs.add(doc);
  doc.addEventListener("input", handleInput, true);
  doc.addEventListener("focusin", handleFocusIn as EventListener, true);
  doc.addEventListener("focusout", handleFocusOut as EventListener, true);
  console.log("[BambooInk] Attached listeners to iframe document:", doc.title || "untitled");
}

function findCKEditorIframes(): void {
  // Look for CKEditor iframes (class cke_wysiwyg_frame) and any contenteditable iframes
  const iframes = document.querySelectorAll("iframe.cke_wysiwyg_frame, iframe[title*='Email'], iframe[title*='Editor']");
  for (const iframe of iframes) {
    try {
      const doc = (iframe as HTMLIFrameElement).contentDocument;
      if (doc && doc.body) {
        attachToIframeDoc(doc);
        // Check for text while we're here
        if (doc.body.isContentEditable || doc.designMode === "on") {
          const text = (doc.body.innerText || "").replace(/\u00a0/g, " ");
          if (text.trim().length >= 10 && text !== lastPolledText) {
            console.log("[BambooInk] Poller found CKEditor content, length:", text.trim().length);
            activeElement = doc.body;
            lastPolledText = text;
            scheduleCheck(text);
            return;
          }
        }
      }
    } catch (e) {
      // Cross-origin iframe, skip
    }
  }
}

setInterval(() => {
  if (!settings?.enabled || !settings?.apiKey) return;

  // Re-scan DOM for any new shadow roots (SPA navigation, lazy-loaded components)
  walkDOMForShadowRoots(document.documentElement);

  // Find and attach to CKEditor iframes
  findCKEditorIframes();

  // Search for focused contenteditable elements inside tracked shadow roots
  for (const shadow of knownShadowRoots) {
    try {
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
    } catch (e) {
      // Shadow root may have been detached
    }
  }
}, 2000);

// --- Self-detection for CKEditor iframe ---
// If this content script is running inside a CKEditor iframe (body is contentEditable),
// CKEditor may replace the document after initial load via document.open()/write()/close().
// We use a MutationObserver on <html> to re-attach listeners when the document is replaced.
function setupCKEditorSelfDetection(): void {
  // Check if we're inside a frame with contentEditable body
  if (window === window.top) return; // Only in iframes

  // Build an iframe selector so the top frame can find us
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
    // Cross-origin, can't access frameElement
  }

  // Listen for text replacement commands from the top frame
  chrome.runtime.onMessage.addListener((message: any) => {
    if (message.action === "replace-text-in-iframe") {
      // Use document.body directly — activeElement may have been cleared by focusout
      const target = activeElement || document.body;
      if (target && (target.isContentEditable || target instanceof HTMLTextAreaElement)) {
        console.log("[BambooInk] Iframe received replace command, target:", target.tagName);
        replaceTextInElement(target, message.original, message.suggestion);
        // Reset checked text so next poll picks up the change
        lastCheckedText = "";
        lastPolledText = "";
      }
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

  // Check immediately
  checkAndAttach();

  // Also watch for document body changes (CKEditor replaces the whole document)
  // We observe the <html> element for child changes since <body> gets replaced
  const htmlEl = document.documentElement;
  if (htmlEl) {
    const bodyObserver = new MutationObserver(() => {
      checkAndAttach();
    });
    bodyObserver.observe(htmlEl, { childList: true });
  }

  // Polling fallback: CKEditor may replace the document after a delay
  let selfPollCount = 0;
  const selfPollInterval = setInterval(() => {
    selfPollCount++;
    checkAndAttach();

    // Also directly check for text and trigger analysis
    if (document.body && (document.body.isContentEditable || document.designMode === "on")) {
      const text = (document.body.innerText || "").replace(/\u00a0/g, " ");
      if (text.trim().length >= 10 && text !== lastPolledText) {
        console.log("[BambooInk] CKEditor self-poll found text, length:", text.trim().length);
        activeElement = document.body;
        lastPolledText = text;
        scheduleCheck(text);
      }
    }

    // Stop polling after 60 seconds (30 checks at 2s interval)
    if (selfPollCount > 30) {
      clearInterval(selfPollInterval);
    }
  }, 2000);
}

setupCKEditorSelfDetection();

// --- Top-frame: listen for overlay relay from iframes ---
if (!isInIframe) {
  // Track the source iframe selector for relaying Accept commands back
  let iframeOverlaySource = "";

  // Find the outermost iframe in the top document that contains the editor
  // (walks all direct iframes and picks the one related to the email composer)
  function findEditorIframeRect(): DOMRect | null {
    // Look for common Salesforce/CKEditor container iframes in the top document
    const selectors = [
      "iframe[title*='Email']",
      "iframe[title*='editor' i]",
      "iframe[title*='CK']",
      "iframe[title*='Composer']",
      "iframe[title*='Publisher']",
    ];
    for (const sel of selectors) {
      const iframe = document.querySelector(sel) as HTMLIFrameElement | null;
      if (iframe) return iframe.getBoundingClientRect();
    }
    // Fallback: find the largest visible iframe (likely the main Salesforce content area)
    let bestIframe: HTMLIFrameElement | null = null;
    let bestArea = 0;
    const iframes = document.querySelectorAll("iframe");
    for (const iframe of iframes) {
      const rect = (iframe as HTMLIFrameElement).getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > bestArea && rect.width > 200 && rect.height > 100) {
        bestArea = area;
        bestIframe = iframe as HTMLIFrameElement;
      }
    }
    return bestIframe ? bestIframe.getBoundingClientRect() : null;
  }

  chrome.runtime.onMessage.addListener((message: any) => {
    if (message.action === "render-overlay-from-iframe") {
      console.log("[BambooInk] Top frame received overlay from iframe, issues:", message.issues.length);
      iframeOverlaySource = message.iframeSelector || "";
      currentIssues = message.issues;

      if (currentIssues.length > 0) {
        const { container } = ensureOverlayContainer();

        // Position near the editor iframe in the top document
        const iframeRect = findEditorIframeRect();
        if (iframeRect) {
          // Bottom-right corner of the iframe, inside the visible area
          let x = iframeRect.right - 360;
          let y = iframeRect.bottom - 80;
          if (x < iframeRect.left) x = iframeRect.left + 10;
          if (x < 10) x = 10;
          if (y + 200 > window.innerHeight) y = iframeRect.top + 10;
          if (y < 10) y = 10;
          container.style.left = `${x}px`;
          container.style.top = `${y}px`;
        } else {
          // No iframe found — position bottom-right of viewport
          container.style.right = "20px";
          container.style.bottom = "20px";
          container.style.left = "auto";
          container.style.top = "auto";
        }

        renderOverlayForIframe(iframeOverlaySource);
      } else {
        hideOverlay();
      }
    }
  });

  function renderOverlayForIframe(sourceIframeSelector: string): void {
    const { container, shadow } = ensureOverlayContainer();

    const oldPanel = shadow.querySelector(".bambooink-root");
    if (oldPanel) oldPanel.remove();

    if (currentIssues.length === 0) {
      container.style.display = "none";
      return;
    }

    container.style.display = "block";

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
        renderOverlayForIframe(sourceIframeSelector);
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
        renderOverlayForIframe(sourceIframeSelector);
      });
      panel.appendChild(header);

      for (const issue of currentIssues) {
        const issueEl = document.createElement("div");
        issueEl.className = "bambooink-issue";

        const typeClass = `type-${issue.type}`;
        issueEl.innerHTML = `
          <span class="bambooink-issue-type ${typeClass}">${escapeHtml(issue.label)}</span>
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

        // Accept: relay replacement to the iframe
        issueEl.querySelector(".bambooink-btn-accept")?.addEventListener("click", (e) => {
          e.stopPropagation();
          e.preventDefault();
          // Send replacement command to all frames — the iframe with the active element will handle it
          chrome.runtime.sendMessage({
            action: "relay-replace-to-iframe",
            original: issue.original,
            suggestion: issue.suggestion,
          });
          currentIssues = currentIssues.filter((i) => i.id !== issue.id);
          lastCheckedText = "";
          setTimeout(() => renderOverlayForIframe(sourceIframeSelector), 100);
        });

        issueEl.querySelector(".bambooink-btn-dismiss")?.addEventListener("click", (e) => {
          e.stopPropagation();
          currentIssues = currentIssues.filter((i) => i.id !== issue.id);
          renderOverlayForIframe(sourceIframeSelector);
        });

        panel.appendChild(issueEl);
      }

      root.appendChild(panel);
    }

    shadow.appendChild(root);
  }
}

console.log("[BambooInk] Content script loaded");
