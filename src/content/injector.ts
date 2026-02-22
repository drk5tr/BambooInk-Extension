/**
 * Text field detection, text extraction, replacement, and cursor word extraction.
 */

// --- Text Field Detection ---

export function isTextField(el: Element): el is HTMLElement {
  // Gmail: only activate on the compose body, skip recipients/subject
  if (isGmail()) {
    if (el instanceof HTMLInputElement) return false;
    if (el instanceof HTMLElement && el.isContentEditable) {
      const role = el.getAttribute("role");
      const label = (el.getAttribute("aria-label") || "").toLowerCase();
      // Skip recipient chips (combobox) and other small contenteditable widgets
      if (role === "combobox") return false;
      // Only match the message body
      if (label.includes("message body") || el.classList.contains("Am")) return true;
      // Skip other small contenteditable elements (e.g. subject on some layouts)
      return false;
    }
    return false;
  }

  // Slack: only activate on the message editor (Quill)
  if (isSlack()) {
    if (el instanceof HTMLElement && el.isContentEditable) {
      // Match the .ql-editor itself or any child inside it
      const editor = el.closest(".ql-editor") || el.querySelector(".ql-editor");
      if (editor) return true;
    }
    return false;
  }

  // Salesforce: only activate on email compose body and chat widget
  if (isSalesforce()) {
    console.log("[BambooInk][SF] isTextField check:", el.tagName, el.className, "contentEditable:", (el as any).isContentEditable, "inIframe:", window !== window.top);
    if (el instanceof HTMLInputElement) return false;
    if (el instanceof HTMLElement && el.isContentEditable) {
      const closestLIRT = el.closest("lightning-input-rich-text");
      const isCke = el.classList.contains("cke_editable");
      const closestChat = el.closest("conversation-message-input, lightning-formatted-rich-text");
      console.log("[BambooInk][SF] contentEditable:", { closestLIRT: !!closestLIRT, isCke, closestChat: !!closestChat });
      // Email compose: rich text editor inside lightning-input-rich-text
      if (closestLIRT) return true;
      // CKEditor-based email body
      if (isCke) return true;
      // Chat / Omni-Channel message input
      if (closestChat) return true;
      // Fallback: if inside iframe with contenteditable body, likely an editor
      if (window !== window.top && (el === document.body || el.closest("body"))) {
        console.log("[BambooInk][SF] iframe body contenteditable — accepting");
        return true;
      }
      return false;
    }
    // Textareas used in chat widgets
    if (el instanceof HTMLTextAreaElement) {
      if (el.closest("conversation-message-input, [class*='chat'], [class*='Chat']")) return true;
      return false;
    }
    return false;
  }

  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    const type = el.type.toLowerCase();
    return ["text", "email", "search", "url", "tel", ""].includes(type);
  }
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  return false;
}

function isGmail(): boolean {
  return location.hostname === "mail.google.com";
}

function isSlack(): boolean {
  return location.hostname.endsWith("slack.com");
}

function isSalesforce(): boolean {
  const h = location.hostname;
  return h.endsWith(".force.com") || h.endsWith(".salesforce.com");
}

/** Resolve to the outermost editor container (e.g. .ql-editor on Slack) */
export function resolveEditorRoot(el: HTMLElement): HTMLElement {
  const qlEditor = el.closest(".ql-editor") as HTMLElement | null;
  if (qlEditor) return qlEditor;
  return el;
}

// --- Text Extraction ---

export function getTextFromElement(el: HTMLElement): string {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    return el.value;
  }
  if (el.isContentEditable) {
    return (el.innerText || el.textContent || "").replace(/\u00a0/g, " ");
  }
  return "";
}

// --- Cursor Positioning ---

function moveCursorToEnd(el: HTMLElement): void {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    el.selectionStart = el.selectionEnd = el.value.length;
    return;
  }
  if (el.isContentEditable) {
    el.focus();
    const sel = window.getSelection();
    if (!sel) return;
    sel.selectAllChildren(el);
    sel.collapseToEnd();
  }
}

// --- Text Replacement ---

export function replaceTextInElement(
  el: HTMLElement,
  original: string,
  suggestion: string
): void {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const start = el.value.indexOf(original);
    if (start === -1) return;
    el.value =
      el.value.substring(0, start) +
      suggestion +
      el.value.substring(start + original.length);
    el.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "insertText" })
    );
    el.dispatchEvent(new Event("change", { bubbles: true }));
    moveCursorToEnd(el);
  } else if (el.isContentEditable) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const textNodes: { node: Text; start: number }[] = [];
    let fullText = "";
    let tNode: Text | null;
    while ((tNode = walker.nextNode() as Text | null)) {
      textNodes.push({ node: tNode, start: fullText.length });
      fullText += tNode.textContent || "";
    }

    const normalize = (s: string) =>
      s
        .replace(/[\u00a0\u200b\u200c\u200d\ufeff]/g, " ")
        .replace(/\s+/g, " ");
    const normalizedFull = normalize(fullText);
    const normalizedOriginal = normalize(original);

    const normalizedIdx = normalizedFull.indexOf(normalizedOriginal);
    if (normalizedIdx === -1) return;

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

    if (!startNode || !endNode) return;

    el.focus();
    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
      sel.removeAllRanges();
      sel.addRange(range);
      if (document.execCommand("insertText", false, suggestion)) {
        moveCursorToEnd(el);
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
    el.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "insertText" })
    );
    moveCursorToEnd(el);
  }
}

// --- Caret Position ---

export function getCaretRect(activeElement: HTMLElement | null): DOMRect | null {
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

export function getCaretRectForTopFrame(
  activeElement: HTMLElement | null
): { x: number; y: number; width: number; height: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0).cloneRange();
  range.collapse(false);
  const rects = range.getClientRects();
  let rect: { x: number; y: number; width: number; height: number } | null =
    null;
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

// --- Shadow DOM event target ---

export function getRealTarget(e: Event): HTMLElement | null {
  const path = e.composedPath();
  const el = (path.length > 0 ? path[0] : e.target) as HTMLElement;
  return el || null;
}

// --- Word at cursor ---

export interface WordAtCursor {
  word: string;
  start: number;
  end: number;
  context: string;
}

const WORD_BOUNDARY = /[^a-zA-Z']/;

export function getWordAtCursor(el: HTMLElement): WordAtCursor | null {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const pos = el.selectionStart;
    if (pos == null) return null;
    const text = el.value;
    return extractWordAt(text, pos);
  }

  if (el.isContentEditable) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;

    // Get full text and cursor offset
    const range = sel.getRangeAt(0);
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let offset = 0;
    let tNode: Text | null;
    while ((tNode = walker.nextNode() as Text | null)) {
      if (tNode === range.startContainer) {
        offset += range.startOffset;
        break;
      }
      offset += tNode.textContent?.length || 0;
    }

    const text = (el.innerText || el.textContent || "").replace(
      /\u00a0/g,
      " "
    );
    return extractWordAt(text, offset);
  }

  return null;
}

function extractWordAt(
  text: string,
  pos: number
): WordAtCursor | null {
  if (pos > text.length) pos = text.length;

  // Walk backwards to find word start
  let start = pos;
  while (start > 0 && !WORD_BOUNDARY.test(text[start - 1])) {
    start--;
  }

  // Walk forwards to find word end
  let end = pos;
  while (end < text.length && !WORD_BOUNDARY.test(text[end])) {
    end++;
  }

  const word = text.slice(start, end);
  if (word.length === 0) return null;

  // Context: grab surrounding words (up to 3 words before and after)
  const before = text.slice(Math.max(0, start - 40), start).trim();
  const after = text.slice(end, Math.min(text.length, end + 40)).trim();
  const context = `${before} ${word} ${after}`.trim();

  return { word, start, end, context };
}
