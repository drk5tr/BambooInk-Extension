import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Settings } from "../shared/types";
import { BRAND } from "../shared/constants";
import "./options.css";

function Options() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    chrome.runtime.sendMessage({ action: "get-settings" }, (s: Settings) => {
      setSettings(s);
    });
  }, []);

  const update = (partial: Partial<Settings>) => {
    chrome.runtime.sendMessage(
      { action: "update-settings", settings: partial },
      (s: Settings) => {
        setSettings(s);
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      }
    );
  };

  if (!settings) return <div style={{ padding: 32 }}>Loading...</div>;

  return (
    <div style={{ fontFamily: "'Segoe UI', sans-serif", maxWidth: 600, margin: "0 auto", padding: 32 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 32 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10,
          background: BRAND.primaryDark, display: "flex",
          alignItems: "center", justifyContent: "center",
          color: "white", fontWeight: 700, fontSize: 20,
        }}>
          B
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>BambooInk Settings</h1>
          <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Configure your writing assistant</p>
        </div>
        {saved && (
          <span style={{ marginLeft: "auto", color: BRAND.primary, fontSize: 13, fontWeight: 600 }}>
            Saved!
          </span>
        )}
      </div>

      {/* Check Types */}
      <Section title="Check Types">
        <Toggle label="Spelling" checked={settings.spelling} onChange={(v) => update({ spelling: v })} />
        <Toggle label="Grammar" checked={settings.grammar} onChange={(v) => update({ grammar: v })} />
      </Section>

      {/* AI Grammar */}
      <Section title="AI Grammar (OpenAI)">
        <p style={{ fontSize: 12, color: "#6b7280", marginTop: 0, marginBottom: 8 }}>
          Uses OpenAI GPT-4.1 mini for advanced grammar checking. Requires an OpenAI API key.
        </p>
        <Toggle label="AI Grammar" checked={settings.aiGrammar} onChange={(v) => update({ aiGrammar: v })} />
        <div style={{ marginTop: 8 }}>
          <label style={{ fontSize: 13, color: "#6b7280", display: "block", marginBottom: 4 }}>
            OpenAI API Key
          </label>
          <input
            type="password"
            value={settings.openaiApiKey}
            placeholder="sk-..."
            onChange={(e) => update({ openaiApiKey: e.target.value })}
            style={{
              width: "100%", padding: "6px 10px", borderRadius: 8,
              border: "1px solid #d1d5db", fontSize: 13, boxSizing: "border-box",
            }}
          />
        </div>
        <div style={{ marginTop: 8 }}>
          <label style={{ fontSize: 13, color: "#6b7280", display: "block", marginBottom: 4 }}>
            Pause before AI check (ms)
          </label>
          <input
            type="number"
            value={settings.aiIdleMs}
            onChange={(e) => update({ aiIdleMs: parseInt(e.target.value) || 1000 })}
            style={{
              width: 120, padding: "6px 10px", borderRadius: 8,
              border: "1px solid #d1d5db", fontSize: 13,
            }}
          />
        </div>
      </Section>

    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24, padding: 16, background: "#f9fafb", borderRadius: 12 }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>{title}</h2>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 0" }}>
      <span style={{ fontSize: 13 }}>{label}</span>
      <button
        onClick={() => onChange(!checked)}
        style={{
          width: 40, height: 22, borderRadius: 11, border: "none", cursor: "pointer",
          background: checked ? BRAND.primaryDark : "#d1d5db",
          position: "relative", transition: "background 0.2s",
        }}
      >
        <div style={{
          width: 18, height: 18, borderRadius: 9, background: "white",
          position: "absolute", top: 2,
          left: checked ? 20 : 2,
          transition: "left 0.2s",
        }} />
      </button>
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<Options />);
