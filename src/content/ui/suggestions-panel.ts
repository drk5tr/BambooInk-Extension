import type { Issue } from "../../shared/types";

export interface PanelState {
  issues: Issue[];
  error?: string;
}

export interface PanelCallbacks {
  onAccept: (issue: Issue) => void;
  onDismiss: (issue: Issue) => void;
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
  callbacks: PanelCallbacks,
  options?: { above?: boolean }
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

  if (state.error && state.issues.length === 0) {
    const errorDiv = document.createElement("div");
    errorDiv.className = "bambooink-error";
    errorDiv.innerHTML = `<span class="warning">\u26A0</span>${escapeHtml(state.error)}`;
    body.appendChild(errorDiv);
  } else if (state.issues.length === 0) {
    const noIssues = document.createElement("div");
    noIssues.className = "bambooink-no-issues";
    noIssues.innerHTML = `<span class="check">\u2713</span>Looking good! No issues found.`;
    body.appendChild(noIssues);
  } else {
    for (const issue of state.issues) {
      const row = document.createElement("div");
      row.className = "bambooink-issue";

      const typeClass = `type-${issue.type}`;

      row.innerHTML = `
        <span class="bambooink-issue-type ${typeClass}">${escapeHtml(issue.label)}</span>
        <div>
          <span class="bambooink-original">${escapeHtml(issue.original)}</span>
          <span class="bambooink-arrow">&rarr;</span>
          <span class="bambooink-suggestion">${escapeHtml(issue.suggestion)}</span>
        </div>
        <div class="bambooink-explanation">${escapeHtml(issue.explanation)}</div>
        <div class="bambooink-alternatives"></div>
        <div class="bambooink-actions"></div>
      `;

      // Show clickable alternatives for spelling issues
      if (issue.alternatives && issue.alternatives.length > 1) {
        const altContainer = row.querySelector(".bambooink-alternatives")!;
        for (const alt of issue.alternatives) {
          const altBtn = document.createElement("button");
          altBtn.className = "bambooink-alt-btn";
          altBtn.textContent = alt;
          altBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            callbacks.onAccept({ ...issue, suggestion: alt });
          });
          altContainer.appendChild(altBtn);
        }
      }

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
  shadow.appendChild(panel);

  // Adjust position after render
  requestAnimationFrame(() => {
    const rect = panel.getBoundingClientRect();
    // If requested above, position panel so its bottom edge is at y
    if (options?.above) {
      panel.style.top = `${y - rect.height - 8}px`;
    }
    if (rect.right > window.innerWidth) {
      panel.style.left = `${window.innerWidth - rect.width - 10}px`;
    }
    // Re-read after horizontal adjustment
    const updated = panel.getBoundingClientRect();
    if (updated.bottom > window.innerHeight) {
      panel.style.top = `${y - updated.height - 8}px`;
    }
    if (updated.left < 0) panel.style.left = "10px";
    if (updated.top < 0) panel.style.top = "10px";
  });
}

export function hidePanel(shadow: ShadowRoot): void {
  const existing = shadow.getElementById(PANEL_ID);
  if (existing) existing.remove();
}
