export interface IconState {
  issueCount: number;
  isLoading: boolean;
}

const ICON_ID = "bambooink-floating-icon";

export function renderIcon(
  shadow: ShadowRoot,
  state: IconState,
  x: number,
  y: number,
  onClick: () => void
): void {
  let icon = shadow.getElementById(ICON_ID) as HTMLDivElement | null;
  if (!icon) {
    icon = document.createElement("div");
    icon.id = ICON_ID;
    icon.className = "bambooink-icon";
    icon.innerHTML = `<span class="bambooink-icon-text">B</span>`;
    icon.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      e.preventDefault();
    });
    icon.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      onClick();
    });
    shadow.appendChild(icon);
  }

  // Update position
  icon.style.left = `${x}px`;
  icon.style.top = `${y}px`;
  icon.style.display = "flex";

  // Loading state
  if (state.isLoading) {
    icon.classList.add("loading");
  } else {
    icon.classList.remove("loading");
  }

  // Badge
  let badge = icon.querySelector(".bambooink-badge") as HTMLElement | null;
  if (state.issueCount > 0) {
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "bambooink-badge";
      icon.appendChild(badge);
    }
    badge.textContent = String(state.issueCount);
    // Green icon when no issues would show checkmark, but with issues show count
    icon.style.background = "#15803D";
  } else {
    if (badge) badge.remove();
    icon.style.background = "#15803D";
  }
}

export function repositionIcon(shadow: ShadowRoot, x: number, y: number): void {
  const icon = shadow.getElementById(ICON_ID);
  if (icon) {
    icon.style.left = `${x}px`;
    icon.style.top = `${y}px`;
  }
}

export function hideIcon(shadow: ShadowRoot): void {
  const icon = shadow.getElementById(ICON_ID);
  if (icon) {
    icon.style.display = "none";
  }
}
