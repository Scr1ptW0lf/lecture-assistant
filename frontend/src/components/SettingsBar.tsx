import { useRef, useState } from "react";
import { SettingsModal } from "./SettingsModal";
import type { AppMode, AudioDevice } from "../types";

interface Props {
  mode: AppMode;
  studentName: string;
  onNameChange: (name: string) => void;
  selectedDevice: number;
  onDeviceChange: (index: number) => void;
  devices: AudioDevice[];
  isConnected: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  permissionGranted: boolean;
  onRequestPermission: () => void;
  contentType: string;
  onContentTypeChange: (type: string) => void;
  userContext: string;
  onUserContextChange: (ctx: string) => void;
}

const CONTENT_TYPES = [
  { value: "lecture", label: "Lecture" },
  { value: "meeting", label: "Meeting" },
  { value: "video", label: "Video" },
  { value: "podcast", label: "Podcast" },
  { value: "general", label: "General" },
];

export function SettingsBar({
  mode,
  studentName,
  onNameChange,
  selectedDevice,
  onDeviceChange,
  devices,
  isConnected,
  onConnect,
  onDisconnect,
  permissionGranted,
  onRequestPermission,
  contentType,
  onContentTypeChange,
  userContext,
  onUserContextChange,
}: Props) {
  const [contextOpen, setContextOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const contextBtnRef = useRef<HTMLButtonElement>(null);

  return (
    <header style={styles.bar}>
      <span style={styles.logo}>Scribe</span>
      {mode === "lite" && <span style={styles.badge}>Lite</span>}

      <label style={styles.label}>
        Your name
        <input
          style={styles.input}
          value={studentName}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="e.g. Aidan"
        />
      </label>

      <label style={styles.label}>
        Audio device
        <select
          style={styles.select}
          value={selectedDevice}
          onChange={(e) => onDeviceChange(Number(e.target.value))}
        >
          <option value={-1}>Auto-detect</option>
          {devices.map((d) => (
            <option key={d.index} value={d.index}>
              {d.is_recommended ? "★ " : ""}
              {d.name}
            </option>
          ))}
        </select>
      </label>

      <label style={styles.label}>
        Type
        <select
          style={styles.select}
          value={contentType}
          onChange={(e) => onContentTypeChange(e.target.value)}
        >
          {CONTENT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </label>

      <div style={styles.contextWrap}>
        <button
          ref={contextBtnRef}
          style={{
            ...styles.btn,
            background: userContext.trim() ? "#2c5282" : "#2d3148",
            border: userContext.trim() ? "1px solid #63b3ed" : "1px solid #4a5568",
          }}
          onClick={() => setContextOpen((o) => !o)}
          title="Set context for AI summaries and answers"
        >
          Context{userContext.trim() ? " ✓" : ""}
        </button>

        {contextOpen && (
          <>
            <div style={styles.overlay} onClick={() => setContextOpen(false)} />
            <div style={styles.popover}>
              <p style={styles.popoverTitle}>AI Context</p>
              <p style={styles.popoverHint}>
                Describe what's being recorded so the AI can give better summaries and answers.
              </p>
              <textarea
                style={styles.contextArea}
                value={userContext}
                onChange={(e) => onUserContextChange(e.target.value)}
                placeholder="e.g. COMP3900 lecture on dynamic programming — midterm is next week"
                rows={4}
                autoFocus
              />
              <div style={styles.popoverFooter}>
                <button style={styles.popoverBtn} onClick={() => setContextOpen(false)}>
                  Done
                </button>
                {userContext.trim() && (
                  <button
                    style={{ ...styles.popoverBtn, color: "#fc8181", border: "1px solid #744210" }}
                    onClick={() => { onUserContextChange(""); setContextOpen(false); }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {!permissionGranted && (
        <button style={styles.btn} onClick={onRequestPermission}>
          Enable notifications
        </button>
      )}

      <button
        style={{ ...styles.btn, background: "#2d3148", border: "1px solid #4a5568", fontSize: "1rem", padding: "4px 10px" }}
        onClick={() => setSettingsOpen(true)}
        title="Model settings"
      >
        ⚙
      </button>

      <button
        style={{ ...styles.btn, background: isConnected ? "#e53e3e" : "#38a169" }}
        onClick={isConnected ? onDisconnect : onConnect}
      >
        {isConnected ? "Stop" : "Start listening"}
      </button>

      <span title={isConnected ? "Connected" : "Disconnected"} style={styles.dot(isConnected)} />

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </header>
  );
}

const styles = {
  bar: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    padding: "0.6rem 1rem",
    background: "#1a1d27",
    borderBottom: "1px solid #2d3148",
    flexWrap: "wrap" as const,
  },
  logo: { fontWeight: 700, fontSize: "1rem", marginRight: "0.5rem", whiteSpace: "nowrap" as const },
  badge: {
    fontSize: "0.65rem",
    fontWeight: 700,
    background: "#744210",
    color: "#fefcbf",
    padding: "2px 6px",
    borderRadius: 4,
    textTransform: "uppercase" as const,
  },
  label: {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
    fontSize: "0.8rem",
    color: "#a0aec0",
  },
  input: {
    background: "#2d3148",
    border: "1px solid #4a5568",
    borderRadius: 4,
    color: "#e2e8f0",
    padding: "4px 8px",
    fontSize: "0.85rem",
    width: 120,
  },
  select: {
    background: "#2d3148",
    border: "1px solid #4a5568",
    borderRadius: 4,
    color: "#e2e8f0",
    padding: "4px 8px",
    fontSize: "0.85rem",
    maxWidth: 220,
  },
  btn: {
    border: "1px solid transparent",
    borderRadius: 4,
    padding: "5px 12px",
    fontSize: "0.8rem",
    color: "#e2e8f0",
    cursor: "pointer",
    background: "#3182ce",
  },
  dot: (connected: boolean) => ({
    width: 10,
    height: 10,
    borderRadius: "50%",
    background: connected ? "#48bb78" : "#e53e3e",
    flexShrink: 0,
  }),
  contextWrap: {
    position: "relative" as const,
  },
  overlay: {
    position: "fixed" as const,
    inset: 0,
    zIndex: 10,
  },
  popover: {
    position: "absolute" as const,
    top: "calc(100% + 8px)",
    left: 0,
    zIndex: 11,
    background: "#1a1d27",
    border: "1px solid #4a5568",
    borderRadius: 6,
    padding: "0.75rem",
    width: 320,
    boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
  },
  popoverTitle: {
    fontSize: "0.85rem",
    fontWeight: 600,
    color: "#90cdf4",
    margin: "0 0 0.25rem",
  },
  popoverHint: {
    fontSize: "0.75rem",
    color: "#718096",
    margin: "0 0 0.5rem",
  },
  contextArea: {
    width: "100%",
    boxSizing: "border-box" as const,
    background: "#2d3148",
    border: "1px solid #4a5568",
    borderRadius: 4,
    color: "#e2e8f0",
    padding: "6px 8px",
    fontSize: "0.82rem",
    resize: "vertical" as const,
    fontFamily: "inherit",
  },
  popoverFooter: {
    display: "flex",
    gap: "0.5rem",
    justifyContent: "flex-end",
    marginTop: "0.5rem",
  },
  popoverBtn: {
    background: "none",
    border: "1px solid #4a5568",
    borderRadius: 4,
    color: "#e2e8f0",
    fontSize: "0.78rem",
    padding: "3px 10px",
    cursor: "pointer",
  },
};
