import { DEFAULT_SETTINGS } from "./constants";
import type { Settings } from "./types";

export async function getSettings(): Promise<Settings> {
  const data = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return data as Settings;
}

export async function updateSettings(partial: Partial<Settings>): Promise<Settings> {
  await chrome.storage.sync.set(partial);
  return getSettings();
}

export function onSettingsChanged(callback: (settings: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync") {
      getSettings().then(callback);
    }
  });
}
