import { useCallback, useEffect, useRef, useState } from "react";
import { fetchConfig, fetchDevices, fetchRagSources } from "./api";
import { QAPanel } from "./components/QAPanel";
import { SettingsBar } from "./components/SettingsBar";
import { TranscriptPanel } from "./components/TranscriptPanel";
import { UploadPanel } from "./components/UploadPanel";
import { useNotification } from "./hooks/useNotification";
import { useTranscript } from "./hooks/useTranscript";
import type { AppMode, AudioDevice, SessionData } from "./types";

const LS_NAME = "la_student_name";
const LS_DEVICE = "la_device_index";
const LS_TRANSCRIPT_WIDTH = "la_transcript_width";
const LS_AUTOSAVE = "la_autosave_session";
const DEFAULT_TRANSCRIPT_WIDTH = 600;
const MIN_TRANSCRIPT_WIDTH = 280;
const AUTOSAVE_DEBOUNCE_MS = 30_000;

function formatSavedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export default function App() {
  const [mode, setMode] = useState<AppMode>("full");
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [studentName, setStudentName] = useState(() => localStorage.getItem(LS_NAME) ?? "");
  const [selectedDevice, setSelectedDevice] = useState<number>(
    () => Number(localStorage.getItem(LS_DEVICE) ?? -1)
  );
  const [transcriptWidth, setTranscriptWidth] = useState<number>(
    () => Number(localStorage.getItem(LS_TRANSCRIPT_WIDTH) ?? DEFAULT_TRANSCRIPT_WIDTH)
  );
  const [contentType, setContentType] = useState("general");
  const [userContext, setUserContext] = useState("");
  const [ragSources, setRagSources] = useState<string[]>([]);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [pendingRestore, setPendingRestore] = useState<SessionData | null>(null);

  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { permissionGranted, requestPermission, triggerNotification } = useNotification();

  const handleNameChange = (name: string) => {
    setStudentName(name);
    localStorage.setItem(LS_NAME, name);
  };

  const handleDeviceChange = (idx: number) => {
    setSelectedDevice(idx);
    localStorage.setItem(LS_DEVICE, String(idx));
  };

  const handleContentTypeChange = (type: string) => {
    setContentType(type);
    sendContextUpdate(type, userContext);
  };

  const handleUserContextChange = (ctx: string) => {
    setUserContext(ctx);
    sendContextUpdate(contentType, ctx);
  };

  const refreshSources = useCallback(() => {
    fetchRagSources().then(setRagSources);
  }, []);

  const onNameDetected = useCallback(
    (text: string) => triggerNotification(text),
    [triggerNotification]
  );

  const { lines, bufferText, isConnected, connect, disconnect, clearLines, restoreSession, summaries, requestSummary, sendContextUpdate } = useTranscript({
    studentName,
    deviceIndex: selectedDevice,
    source: selectedSource,
    contentType,
    userContext,
    onNameDetected,
  });

  // Check for a previous autosaved session on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_AUTOSAVE);
      if (!raw) return;
      const data = JSON.parse(raw) as SessionData;
      if (data.lines?.length > 0 || data.summaries?.length > 0) {
        setPendingRestore(data);
      }
    } catch {
      // corrupted autosave — ignore
    }
  }, []);

  // Autosave session to localStorage (debounced) whenever transcript changes.
  useEffect(() => {
    if (lines.length === 0 && summaries.length === 0) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      const data: SessionData = {
        version: 1,
        saved_at: new Date().toISOString(),
        student_name: studentName,
        content_type: contentType,
        user_context: userContext,
        lines,
        summaries,
      };
      try {
        localStorage.setItem(LS_AUTOSAVE, JSON.stringify(data));
      } catch {
        // localStorage quota exceeded — ignore
      }
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [lines, summaries, studentName, contentType, userContext]);

  useEffect(() => {
    fetchConfig().then((cfg) => {
      setMode(cfg.mode);
      if (cfg.mode === "full") refreshSources();
    });
    fetchDevices().then(setDevices);
  }, [refreshSources]);

  const onDividerMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = transcriptWidth;
    e.preventDefault();
  };

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = e.clientX - dragStartX.current;
      const newWidth = Math.max(MIN_TRANSCRIPT_WIDTH, dragStartWidth.current + delta);
      setTranscriptWidth(newWidth);
    };
    const onMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        setTranscriptWidth((w) => {
          localStorage.setItem(LS_TRANSCRIPT_WIDTH, String(w));
          return w;
        });
      }
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const buildSessionData = (): SessionData => ({
    version: 1,
    saved_at: new Date().toISOString(),
    student_name: studentName,
    content_type: contentType,
    user_context: userContext,
    lines,
    summaries,
  });

  const handleSaveSession = () => {
    const data = buildSessionData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `scribe-session-${new Date().toISOString().slice(0, 16).replace("T", "_")}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const handleLoadSession = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text) as SessionData;
        if (!Array.isArray(data.lines)) throw new Error("Invalid session file");
        restoreSession(data.lines, data.summaries ?? []);
        setPendingRestore(null);
      } catch {
        alert("Could not load session file. Make sure it is a valid Scribe JSON session.");
      }
    };
    input.click();
  };

  const handleRestoreAutosave = () => {
    if (!pendingRestore) return;
    restoreSession(pendingRestore.lines, pendingRestore.summaries ?? []);
    setPendingRestore(null);
  };

  const handleDismissRestore = () => {
    setPendingRestore(null);
    localStorage.removeItem(LS_AUTOSAVE);
  };

  const showSidebar = mode === "full";

  return (
    <div style={styles.root}>
      <SettingsBar
        mode={mode}
        studentName={studentName}
        onNameChange={handleNameChange}
        selectedDevice={selectedDevice}
        onDeviceChange={handleDeviceChange}
        devices={devices}
        isConnected={isConnected}
        onConnect={connect}
        onDisconnect={disconnect}
        permissionGranted={permissionGranted}
        onRequestPermission={requestPermission}
        contentType={contentType}
        onContentTypeChange={handleContentTypeChange}
        userContext={userContext}
        onUserContextChange={handleUserContextChange}
      />

      {pendingRestore && (
        <div style={styles.restoreBanner}>
          <span style={styles.restoreText}>
            Unsaved session found from {formatSavedAt(pendingRestore.saved_at)} —
            {" "}{pendingRestore.lines.length} lines
          </span>
          <button style={styles.restoreBtn} onClick={handleRestoreAutosave}>Restore</button>
          <button style={styles.dismissBtn} onClick={handleDismissRestore}>Dismiss</button>
        </div>
      )}

      <div style={styles.body}>
        <div style={{ width: showSidebar ? transcriptWidth : "100%", flexShrink: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <TranscriptPanel
            lines={lines}
            bufferText={bufferText}
            onClear={clearLines}
            onSave={() => {
              const text = lines.map((l) => `[${l.displayTs}] ${l.text}`).join("\n");
              const blob = new Blob([text], { type: "text/plain" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `transcript-${new Date().toISOString().slice(0, 16).replace("T", "_")}.txt`;
              a.click();
              URL.revokeObjectURL(a.href);
            }}
            onSaveSession={handleSaveSession}
            onLoadSession={handleLoadSession}
          />
        </div>

        {showSidebar && (
          <>
            <div
              style={styles.divider}
              onMouseDown={onDividerMouseDown}
              title="Drag to resize"
            />
            <div style={styles.sidebar}>
              <UploadPanel
                sources={ragSources}
                selectedSource={selectedSource}
                onSourceChange={setSelectedSource}
                onUploadDone={refreshSources}
              />
              <QAPanel summaries={summaries} source={selectedSource} onRequestSummary={requestSummary} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const styles = {
  root: { display: "flex", flexDirection: "column" as const, height: "100vh", overflow: "hidden" },
  body: { display: "flex", flex: 1, overflow: "hidden" },
  restoreBanner: {
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
    padding: "0.4rem 1rem",
    background: "#1e2a3a",
    borderBottom: "1px solid #2d4a6a",
    fontSize: "0.8rem",
    flexShrink: 0,
  },
  restoreText: { color: "#90cdf4", flex: 1 },
  restoreBtn: {
    background: "#3182ce",
    border: "none",
    borderRadius: 4,
    color: "#fff",
    padding: "3px 10px",
    cursor: "pointer",
    fontSize: "0.78rem",
  },
  dismissBtn: {
    background: "none",
    border: "1px solid #4a5568",
    borderRadius: 4,
    color: "#a0aec0",
    padding: "3px 10px",
    cursor: "pointer",
    fontSize: "0.78rem",
  },
  divider: {
    width: 5,
    flexShrink: 0,
    cursor: "col-resize",
    background: "#2d3148",
    transition: "background 0.15s",
    userSelect: "none" as const,
  },
  sidebar: {
    flex: 1,
    minWidth: 300,
    display: "flex",
    flexDirection: "column" as const,
    overflow: "hidden",
    borderLeft: "none",
  },
};
