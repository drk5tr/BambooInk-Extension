import type { Issue } from "../../shared/types";

const POPUP_ID = "bambooink-issue-popup";

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

export interface PopupCallbacks {
  onAccept: (issue: Issue) => void;
  onDismiss: (issue: Issue) => void;
}

export function showIssuePopup(
  shadow: ShadowRoot,
  issue: Issue,
  anchorRect: DOMRect,
  callbacks: PopupCallbacks
): void {
  hideIssuePopup(shadow);

  const popup = document.createElement("div");
  popup.id = POPUP_ID;
  popup.className = "bambooink-issue-popup";

  popup.addEventListener("mousedown", (e) => e.stopPropagation());

  const typeClass = `type-${issue.type}`;

  popup.innerHTML = `
    <span class="bambooink-issue-type bambooink-popup-label ${typeClass}">${escapeHtml(issue.label)}</span>
    <div class="bambooink-popup-text">
      <span class="bambooink-original">${escapeHtml(issue.original)}</span>
      <span class="bambooink-arrow">&rarr;</span>
      <span class="bambooink-suggestion">${escapeHtml(issue.suggestion)}</span>
    </div>
    <div class="bambooink-popup-explanation">${escapeHtml(issue.explanation)}</div>
    <div class="bambooink-popup-actions"></div>
  `;

  const actions = popup.querySelector(".bambooink-popup-actions")!;

  const acceptBtn = document.createElement("button");
  acceptBtn.className = "bambooink-btn bambooink-btn-accept";
  acceptBtn.textContent = "Accept";
  acceptBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    callbacks.onAccept(issue);
  });
  actions.appendChild(acceptBtn);

  const dismissBtn = document.createElement("button");
  dismissBtn.className = "bambooink-btn bambooink-btn-dismiss";
  dismissBtn.textContent = "Dismiss";
  dismissBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    callbacks.onDismiss(issue);
  });
  actions.appendChild(dismissBtn);

  shadow.appendChild(popup);

  // Position: above the underline by default, flip below if clipped
  requestAnimationFrame(() => {
    const popupRect = popup.getBoundingClientRect();
    let top = anchorRect.top - popupRect.height - 6;
    let left = anchorRect.left;

    // Flip below if clipped at top
    if (top < 4) {
      top = anchorRect.bottom + 6;
    }

    // Clamp horizontally
    if (left + popupRect.width > window.innerWidth - 4) {
      left = window.innerWidth - popupRect.width - 4;
    }
    if (left < 4) left = 4;

    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
  });
}

export function hideIssuePopup(shadow: ShadowRoot): void {
  const existing = shadow.getElementById(POPUP_ID);
  if (existing) existing.remove();
}
