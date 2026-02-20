import type { Issue } from "../../shared/types";

export interface PanelState {
  issues: Issue[];
  isAiLoading: boolean;
  isAiComplete: boolean;
}

export interface PanelCallbacks {
  onAccept: (issue: Issue) => void;
  onDismiss: (issue: Issue) => void;
  onEnhance: () => void;
  onClose: () => void;
}

const PANEL_ID = "bambooink-suggestions-panel";

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

export function renderPanel(
  shadow: ShadowRoot,
  state: PanelState,
  x: number,
  y: number,
  callbacks: PanelCallbacks
): void {
  // Remove existing panel
  hidePanel(shadow);

  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.className = "bambooink-panel";
  panel.style.left = `${x}px`;
  panel.style.top = `${y}px`;

  // Prevent clicks from bubbling to the page
  panel.addEventListener("mousedown", (e) => e.stopPropagation());

  // Header
  const header = document.createElement("div");
  header.className = "bambooink-panel-header";
  const count = state.issues.length;
  header.innerHTML = `
    <span>BambooInk${count > 0 ? ` \u2014 ${count} issue${count !== 1 ? "s" : ""}` : ""}</span>
  `;
  const closeBtn = document.createElement("button");
  closeBtn.className = "bambooink-panel-close";
  closeBtn.innerHTML = "&#x2715;";
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    callbacks.onClose();
  });
  header.appendChild(closeBtn);
  panel.appendChild(header);

  // Body
  const body = document.createElement("div");
  body.className = "bambooink-panel-body";

  if (state.issues.length === 0) {
    const noIssues = document.createElement("div");
    noIssues.className = "bambooink-no-issues";
    noIssues.innerHTML = `<span class="check">\u2713</span>Looking good! No issues found.`;
    body.appendChild(noIssues);
  } else {
    for (const issue of state.issues) {
      const row = document.createElement("div");
      row.className = "bambooink-issue";

      const typeClass = `type-${issue.type}`;
      const tierLabel = issue.tier === "ai" ? " \uD83E\uDDE0" : "";

      row.innerHTML = `
        <span class="bambooink-issue-type ${typeClass}">${escapeHtml(issue.label)}${tierLabel}</span>
        <div>
          <span class="bambooink-original">${escapeHtml(issue.original)}</span>
          <span class="bambooink-arrow">&rarr;</span>
          <span class="bambooink-suggestion">${escapeHtml(issue.suggestion)}</span>
        </div>
        <div class="bambooink-explanation">${escapeHtml(issue.explanation)}</div>
        <div class="bambooink-actions"></div>
      `;

      const actions = row.querySelector(".bambooink-actions")!;

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

      body.appendChild(row);
    }
  }

  panel.appendChild(body);

  // Enhance with AI section
  const enhanceSection = document.createElement("div");
  enhanceSection.className = "bambooink-enhance-section";

  if (state.isAiComplete) {
    enhanceSection.innerHTML = `<div class="bambooink-ai-done">\u2713 AI enhancement complete</div>`;
  } else {
    const enhanceBtn = document.createElement("button");
    enhanceBtn.className = "bambooink-enhance-btn";
    enhanceBtn.disabled = state.isAiLoading;
    if (state.isAiLoading) {
      enhanceBtn.innerHTML = `<span class="spinner"></span> Analyzing...`;
    } else {
      enhanceBtn.innerHTML = `\uD83E\uDDE0 Enhance with AI`;
    }
    enhanceBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!state.isAiLoading) {
        callbacks.onEnhance();
      }
    });
    enhanceSection.appendChild(enhanceBtn);
  }

  panel.appendChild(enhanceSection);
  shadow.appendChild(panel);

  // Adjust if panel goes off-screen
  requestAnimationFrame(() => {
    const rect = panel.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      panel.style.left = `${window.innerWidth - rect.width - 10}px`;
    }
    if (rect.bottom > window.innerHeight) {
      // Show above the icon instead
      panel.style.top = `${y - rect.height - 40}px`;
    }
    if (rect.left < 0) panel.style.left = "10px";
    if (rect.top < 0) panel.style.top = "10px";
  });
}

export function hidePanel(shadow: ShadowRoot): void {
  const existing = shadow.getElementById(PANEL_ID);
  if (existing) existing.remove();
}
