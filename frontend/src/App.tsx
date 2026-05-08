import { useCallback, useEffect, useRef, useState } from "react";
import { fetchConfig, fetchDevices, fetchRagSources } from "./api";
import { QAPanel } from "./components/QAPanel";
import { SettingsBar } from "./components/SettingsBar";
import { TranscriptPanel } from "./components/TranscriptPanel";
import { UploadPanel } from "./components/UploadPanel";
import { useNotification } from "./hooks/useNotification";
import { useTranscript } from "./hooks/useTranscript";
import type { AppMode, AudioDevice } from "./types";

const LS_NAME = "la_student_name";
const LS_DEVICE = "la_device_index";
const LS_TRANSCRIPT_WIDTH = "la_transcript_width";
const LS_CONTENT_TYPE = "la_content_type";
const LS_USER_CONTEXT = "la_user_context";
const DEFAULT_TRANSCRIPT_WIDTH = 600;
const MIN_TRANSCRIPT_WIDTH = 280;

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
  const [contentType, setContentType] = useState(() => localStorage.getItem(LS_CONTENT_TYPE) ?? "general");
  const [userContext, setUserContext] = useState(() => localStorage.getItem(LS_USER_CONTEXT) ?? "");
  const [ragSources, setRagSources] = useState<string[]>([]);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);

  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

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
    localStorage.setItem(LS_CONTENT_TYPE, type);
  };

  const handleUserContextChange = (ctx: string) => {
    setUserContext(ctx);
    localStorage.setItem(LS_USER_CONTEXT, ctx);
  };

  const refreshSources = useCallback(() => {
    fetchRagSources().then(setRagSources);
  }, []);

  const onNameDetected = useCallback(
    (text: string) => triggerNotification(text),
    [triggerNotification]
  );

  const { lines, bufferText, isConnected, connect, disconnect, clearLines, summaries, requestSummary } = useTranscript({
    studentName,
    deviceIndex: selectedDevice,
    source: selectedSource,
    contentType,
    userContext,
    onNameDetected,
  });

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

      <div style={styles.body}>
        <div style={{ width: showSidebar ? transcriptWidth : "100%", flexShrink: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <TranscriptPanel
            lines={lines}
            bufferText={bufferText}
            onClear={clearLines}
            onSave={() => {
              const text = lines.map((l) => `[${l.id}] ${l.text}`).join("\n");
              const blob = new Blob([text], { type: "text/plain" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `transcript-${new Date().toISOString().slice(0, 16).replace("T", "_")}.txt`;
              a.click();
              URL.revokeObjectURL(a.href);
            }}
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
