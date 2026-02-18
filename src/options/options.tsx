import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Settings, ToneSetting, WritingGoal } from "../shared/types";
import { TONES, GOALS, BRAND } from "../shared/constants";
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

      {/* API Key */}
      <Section title="API Key">
        <label style={{ fontSize: 13, color: "#6b7280", display: "block", marginBottom: 4 }}>
          Anthropic API Key
        </label>
        <input
          type="password"
          value={settings.apiKey}
          onChange={(e) => update({ apiKey: e.target.value })}
          placeholder="sk-ant-api..."
          style={{
            width: "100%", padding: "8px 12px", borderRadius: 8,
            border: "1px solid #d1d5db", fontSize: 13, outline: "none",
          }}
        />
        <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
          Get your key at{" "}
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer"
            style={{ color: BRAND.primary }}>
            console.anthropic.com
          </a>
        </p>
      </Section>

      {/* Tone */}
      <Section title="Tone">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {TONES.map((tone) => (
            <button
              key={tone}
              onClick={() => update({ tone })}
              style={{
                padding: "6px 14px", borderRadius: 20, border: "1px solid",
                borderColor: settings.tone === tone ? BRAND.primaryDark : "#d1d5db",
                background: settings.tone === tone ? BRAND.primaryDark : "white",
                color: settings.tone === tone ? "white" : "#374151",
                fontSize: 12, fontWeight: 500, cursor: "pointer",
              }}
            >
              {tone}
            </button>
          ))}
        </div>
      </Section>

      {/* Goals */}
      <Section title="Writing Goals">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {GOALS.map((goal) => {
            const active = settings.goals.includes(goal);
            return (
              <button
                key={goal}
                onClick={() => {
                  const next = active
                    ? settings.goals.filter((g) => g !== goal)
                    : [...settings.goals, goal];
                  update({ goals: next });
                }}
                style={{
                  padding: "6px 14px", borderRadius: 20, border: "1px solid",
                  borderColor: active ? BRAND.primaryDark : "#d1d5db",
                  background: active ? BRAND.primaryDark : "white",
                  color: active ? "white" : "#374151",
                  fontSize: 12, fontWeight: 500, cursor: "pointer",
                }}
              >
                {goal}
              </button>
            );
          })}
        </div>
      </Section>

      {/* Check Types */}
      <Section title="Check Types">
        <Toggle label="Spelling" checked={settings.spelling} onChange={(v) => update({ spelling: v })} />
        <Toggle label="Grammar" checked={settings.grammar} onChange={(v) => update({ grammar: v })} />
        <Toggle label="Tone" checked={settings.toneCheck} onChange={(v) => update({ toneCheck: v })} />
        <Toggle label="Clarity" checked={settings.clarity} onChange={(v) => update({ clarity: v })} />
      </Section>

      {/* Debounce */}
      <Section title="Debounce">
        <label style={{ fontSize: 13, color: "#6b7280", display: "block", marginBottom: 4 }}>
          Wait time after typing stops (ms)
        </label>
        <input
          type="number"
          value={settings.debounceMs}
          onChange={(e) => update({ debounceMs: parseInt(e.target.value) || 800 })}
          style={{
            width: 120, padding: "6px 10px", borderRadius: 8,
            border: "1px solid #d1d5db", fontSize: 13,
          }}
        />
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
