/**
 * Text field detection, text extraction, replacement, and cursor word extraction.
 */

import type { Channel } from "../shared/types";

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
    if (el instanceof HTMLInputElement) return false;
    if (el instanceof HTMLElement) {
      // Skip search fields, lookups, and comboboxes — but not chat/compose areas
      const role = el.getAttribute("role");
      const isChat = !!el.closest("conversation-message-input, lightning-formatted-rich-text, [class*='chat'], [class*='Chat']");
      const isRichText = !!el.closest("lightning-input-rich-text");
      const isCke = el.classList.contains("cke_editable");

      if (!isChat && !isRichText && !isCke) {
        if (role === "combobox" || role === "searchbox") return false;
        if (el.closest("lightning-input, lightning-combobox, lightning-lookup, lightning-grouped-combobox, [role='search']")) return false;
      }

      if (el.isContentEditable) {
        if (isRichText) return true;
        if (isCke) return true;
        if (isChat) return true;
        // Fallback: if inside iframe with contenteditable body, likely an editor
        if (window !== window.top && (el === document.body || el.closest("body"))) {
          return true;
        }
        return false;
      }
    }
    // Textareas used in chat widgets
    if (el instanceof HTMLTextAreaElement) {
      if (el.classList.contains("messaging-textarea")) return true;
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
  return h.endsWith(".force.com") || h.endsWith(".salesforce.com") || h.endsWith(".salesforceliveagent.com");
}

/** Auto-detect channel type based on current site */
export function detectChannel(): Channel {
  if (isGmail()) return "email";
  if (isSlack()) return "chat";
  if (isSalesforce()) {
    const active = document.activeElement as HTMLElement | null;
    if (active) {
      const isInternal =
        active.closest("[data-component-id*='internalNote']") ||
        active.closest(".slds-publisher__toggle-visibility") ||
        active.closest("[data-component-id*='chatter']");
      if (isInternal) return "internal_note";
    }
    return "email";
  }
  return "email";
}

/** Resolve to the outermost editor container (e.g. .ql-editor on Slack) */
export function resolveEditorRoot(el: HTMLElement): HTMLElement {
  const qlEditor = el.closest(".ql-editor") as HTMLElement | null;
  if (qlEditor) return qlEditor;
  return el;
}

// --- Text Extraction ---

// Selectors for signature/boilerplate blocks to exclude from text extraction
const SIGNATURE_SELECTORS = [
  ".gmail_signature",          // Gmail signature
  "[data-smartmail='gmail_signature']",
  ".gmail_quote",              // Gmail reply/forward thread
  ".gmail_extra",              // Gmail quoted/forwarded text (legacy)
];

export function getTextFromElement(el: HTMLElement): string {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    return el.value;
  }
  if (el.isContentEditable) {
    // Clone the element and remove signature blocks before extracting text
    const clone = el.cloneNode(true) as HTMLElement;
    for (const selector of SIGNATURE_SELECTORS) {
      clone.querySelectorAll(selector).forEach(node => node.remove());
    }
    // Insert explicit newlines for block elements and <br> so they survive text extraction
    clone.querySelectorAll("br").forEach(br => br.replaceWith("\n"));
    clone.querySelectorAll("div, p, li, tr, blockquote").forEach(block => {
      block.insertAdjacentText("beforebegin", "\n");
    });
    const text = (clone.textContent || "").replace(/\u00a0/g, " ");
    return text;
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

    // Build a map from each normalized character index to its raw index.
    // This accounts for unicode chars replaced 1-to-1 and whitespace runs
    // collapsed to a single space during normalization.
    const normToRaw: number[] = [];
    let prevWasSpace = false;
    for (let ri = 0; ri < fullText.length; ri++) {
      let ch = fullText[ri];
      if (/[\u00a0\u200b\u200c\u200d\ufeff]/.test(ch)) ch = " ";
      const isSpace = /\s/.test(ch);
      if (isSpace && prevWasSpace) continue; // collapsed away in normalized text
      normToRaw.push(ri);
      prevWasSpace = isSpace;
    }
    normToRaw.push(fullText.length); // sentinel for end-of-string

    const idx = normToRaw[normalizedIdx] ?? 0;
    const matchEnd = normToRaw[normalizedIdx + normalizedOriginal.length] ?? fullText.length;
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

// --- Plain-text offset → DOMRect mapping ---

export function getRectsForIssue(
  el: HTMLElement,
  start: number,
  end: number
): DOMRect[] {
  if (el instanceof HTMLTextAreaElement) {
    return getRectsForTextarea(el, start, end);
  }
  if (!el.isContentEditable) return [];

  // Walk the live DOM mirroring getTextFromElement()'s transformations,
  // building a plainToRaw index map.
  const BLOCK_TAGS = new Set(["DIV", "P", "LI", "TR", "BLOCKQUOTE"]);

  // Collect mapping entries: { node: Text, rawOffset: number, plainOffset: number }
  interface MapEntry {
    node: Text;
    rawOffset: number;   // char offset within this text node
    plainOffset: number; // corresponding plain-text offset
  }
  const map: MapEntry[] = [];
  let plainLen = 0;

  function walk(node: Node, isRoot: boolean): void {
    // Skip signature blocks (same selectors as getTextFromElement)
    if (node instanceof HTMLElement) {
      for (const sel of [
        ".gmail_signature",
        "[data-smartmail='gmail_signature']",
        ".gmail_quote",
        ".gmail_extra",
      ]) {
        if (node.matches(sel)) return;
      }
    }

    if (node instanceof HTMLBRElement) {
      plainLen++;
      return;
    }

    if (node instanceof HTMLElement && !isRoot && BLOCK_TAGS.has(node.tagName)) {
      plainLen++;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || "";
      for (let i = 0; i < text.length; i++) {
        map.push({ node: node as Text, rawOffset: i, plainOffset: plainLen });
        plainLen++;
      }
      return;
    }

    const children = node.childNodes;
    for (let i = 0; i < children.length; i++) {
      walk(children[i], false);
    }
  }

  walk(el, true);

  // Apply the same normalization getTextFromElement does: \u00a0 → space
  // The plain offsets already account for \n insertions from br/block.
  // We need to adjust for \u00a0→space: the character count doesn't change,
  // so the offsets are the same.

  if (start >= plainLen || end > plainLen || start >= end) return [];

  // Find the map entry for start and end
  let startEntry: MapEntry | null = null;
  let endEntry: MapEntry | null = null;

  for (let i = 0; i < map.length; i++) {
    if (!startEntry && map[i].plainOffset >= start) {
      startEntry = map[i];
    }
    if (map[i].plainOffset < end) {
      endEntry = map[i];
    }
  }

  if (!startEntry || !endEntry) return [];

  try {
    const range = document.createRange();
    range.setStart(startEntry.node, startEntry.rawOffset);
    range.setEnd(endEntry.node, endEntry.rawOffset + 1);
    return Array.from(range.getClientRects());
  } catch {
    return [];
  }
}

// --- Textarea mirror-div for rect measurement ---

const MIRROR_PROPS = [
  "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing",
  "wordSpacing", "lineHeight", "textTransform", "textIndent",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  "boxSizing", "whiteSpace", "wordWrap", "overflowWrap", "direction",
] as const;

function getRectsForTextarea(
  ta: HTMLTextAreaElement,
  start: number,
  end: number
): DOMRect[] {
  const text = ta.value;
  if (start >= text.length || end > text.length || start >= end) return [];

  const mirror = document.createElement("div");
  const style = getComputedStyle(ta);
  for (const prop of MIRROR_PROPS) {
    mirror.style[prop as any] = style[prop as any];
  }
  mirror.style.position = "absolute";
  mirror.style.top = "0";
  mirror.style.left = "-9999px";
  mirror.style.visibility = "hidden";
  mirror.style.overflow = "hidden";
  mirror.style.width = `${ta.clientWidth}px`;
  mirror.style.height = "auto";
  // whiteSpace must preserve wrapping like textarea
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordBreak = "break-word";

  // Build content: before + span(target) + after
  const before = text.slice(0, start);
  const target = text.slice(start, end);
  const after = text.slice(end);

  mirror.textContent = "";
  const beforeNode = document.createTextNode(before);
  const span = document.createElement("span");
  span.textContent = target;
  const afterNode = document.createTextNode(after);
  mirror.appendChild(beforeNode);
  mirror.appendChild(span);
  mirror.appendChild(afterNode);

  document.body.appendChild(mirror);

  const taRect = ta.getBoundingClientRect();
  const spanRects = span.getClientRects();
  const result: DOMRect[] = [];

  // Convert mirror-relative rects to viewport coordinates,
  // accounting for textarea scroll position
  const mirrorRect = mirror.getBoundingClientRect();
  for (const r of spanRects) {
    if (r.width === 0) continue;
    const offsetX = r.left - mirrorRect.left;
    const offsetY = r.top - mirrorRect.top;
    result.push(new DOMRect(
      taRect.left + offsetX,
      taRect.top + offsetY - ta.scrollTop,
      r.width,
      r.height
    ));
  }

  mirror.remove();
  return result;
}

// --- Caret Position ---

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
