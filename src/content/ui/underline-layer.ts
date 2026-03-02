import type { Issue, IssueType } from "../../shared/types";
import { getRectsForIssue, getTextFromElement } from "../injector";

const UNDERLINE_COLORS: Record<IssueType, string> = {
  spelling: "#DC2626",
  grammar: "#2563EB",
  punctuation: "#2563EB",
  tone: "#7C3AED",
};

export interface UnderlineCallbacks {
  onIssueClick: (issue: Issue, anchorRect: DOMRect) => void;
}

export function renderUnderlines(
  shadow: ShadowRoot,
  issues: Issue[],
  editorEl: HTMLElement,
  callbacks: UnderlineCallbacks
): void {
  clearUnderlines(shadow);

  // Issue positions are relative to trimmed text (sent to AI),
  // but getRectsForIssue maps against the raw DOM. Account for
  // leading characters stripped by .trim().
  const rawText = getTextFromElement(editorEl);
  const trimOffset = rawText.length - rawText.trimStart().length;

  for (const issue of issues) {
    const rects = getRectsForIssue(editorEl, issue.position.start + trimOffset, issue.position.end + trimOffset);
    const color = UNDERLINE_COLORS[issue.type] || "#2563EB";

    for (const rect of rects) {
      if (rect.width === 0) continue;

      const div = document.createElement("div");
      div.className = "bambooink-underline";
      div.setAttribute("data-bambooink-underline", issue.id);
      div.style.left = `${rect.left}px`;
      div.style.top = `${rect.bottom - 10}px`;
      div.style.width = `${rect.width}px`;
      div.style.setProperty("--underline-color", color);

      div.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        e.preventDefault();
      });
      div.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        callbacks.onIssueClick(issue, rect);
      });

      shadow.appendChild(div);
    }
  }
}

export function clearUnderlines(shadow: ShadowRoot): void {
  const existing = shadow.querySelectorAll("[data-bambooink-underline]");
  existing.forEach((el) => el.remove());
}
