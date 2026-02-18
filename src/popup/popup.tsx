import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Settings } from "../shared/types";
import { BRAND } from "../shared/constants";
import "./popup.css";

function Popup() {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    chrome.runtime.sendMessage({ action: "get-settings" }, (s: Settings) => {
      setSettings(s);
    });
  }, []);

  if (!settings) return <div style={{ padding: 16 }}>Loading...</div>;

  const toggle = () => {
    const next = !settings.enabled;
    chrome.runtime.sendMessage(
      { action: "update-settings", settings: { enabled: next } },
      (s: Settings) => setSettings(s)
    );
  };

  const hasApiKey = !!settings.apiKey;

  return (
    <div style={{ fontFamily: "'Segoe UI', sans-serif", padding: 16, minWidth: 280 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: BRAND.primaryDark, display: "flex",
          alignItems: "center", justifyContent: "center",
          color: "white", fontWeight: 700, fontSize: 16,
        }}>
          B
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>BambooInk</div>
          <div style={{ fontSize: 11, color: "#6b7280" }}>Writing Assistant</div>
        </div>
      </div>

      {!hasApiKey && (
        <div style={{
          background: "#FEF3C7", border: "1px solid #F59E0B",
          borderRadius: 8, padding: 10, marginBottom: 12, fontSize: 12,
        }}>
          No API key configured.{" "}
          <a href="#" onClick={(e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); }}
            style={{ color: "#D97706", fontWeight: 600 }}>
            Set up in Settings
          </a>
        </div>
      )}

      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 12px", background: "#f9fafb", borderRadius: 8,
        marginBottom: 12,
      }}>
        <span style={{ fontSize: 13, fontWeight: 500 }}>
          {settings.enabled ? "Active" : "Paused"}
        </span>
        <button onClick={toggle} style={{
          padding: "4px 14px", borderRadius: 16, border: "none", cursor: "pointer",
          fontSize: 12, fontWeight: 600,
          background: settings.enabled ? BRAND.primaryDark : "#e5e7eb",
          color: settings.enabled ? "white" : "#6b7280",
        }}>
          {settings.enabled ? "ON" : "OFF"}
        </button>
      </div>

      <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 8 }}>
        Tone: <strong style={{ color: "#374151" }}>{settings.tone}</strong>
      </div>

      <button onClick={() => chrome.runtime.openOptionsPage()} style={{
        width: "100%", padding: "8px 0", borderRadius: 8,
        border: "1px solid #e5e7eb", background: "white",
        cursor: "pointer", fontSize: 12, fontWeight: 500, color: "#374151",
      }}>
        Open Settings
      </button>
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<Popup />);
