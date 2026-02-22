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
    icon.innerHTML = `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <!-- Bamboo stalk -->
      <rect x="14.5" y="4" width="3" height="24" rx="1.5" fill="white"/>
      <!-- Stalk nodes -->
      <rect x="13.5" y="10" width="5" height="1.5" rx="0.75" fill="rgba(255,255,255,0.6)"/>
      <rect x="13.5" y="17" width="5" height="1.5" rx="0.75" fill="rgba(255,255,255,0.6)"/>
      <!-- Leaves right -->
      <ellipse cx="22" cy="8" rx="5.5" ry="2.2" transform="rotate(-35 22 8)" fill="white" opacity="0.9"/>
      <ellipse cx="23" cy="14" rx="4.5" ry="1.8" transform="rotate(-25 23 14)" fill="white" opacity="0.85"/>
      <!-- Leaves left -->
      <ellipse cx="10" cy="11" rx="5" ry="2" transform="rotate(30 10 11)" fill="white" opacity="0.9"/>
      <ellipse cx="9" cy="19" rx="4" ry="1.6" transform="rotate(40 9 19)" fill="white" opacity="0.85"/>
    </svg>`;
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
