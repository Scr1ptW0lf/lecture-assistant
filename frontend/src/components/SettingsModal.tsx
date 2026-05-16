import { useEffect, useState } from "react";
import { fetchOllamaModels, fetchSettings, openVolumeMixer, reinitializeEngine, saveSettings } from "../api";
import type { EngineSettings } from "../types";

interface Props {
  onClose: () => void;
}

type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "reinitializing" }
  | { kind: "done"; msg: string }
  | { kind: "error"; msg: string };

const WHISPER_MODELS = ["tiny", "base", "small"];

export function SettingsModal({ onClose }: Props) {
  const [orig, setOrig] = useState<EngineSettings | null>(null);
  const [draft, setDraft] = useState<EngineSettings | null>(null);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [mixerStatus, setMixerStatus] = useState<"idle" | "opening" | "unsupported">("idle");

  useEffect(() => {
    fetchSettings().then((s) => {
      setOrig(s);
      setDraft(s);
    });
    fetchOllamaModels().then(setOllamaModels);
  }, []);

  if (!draft) {
    return (
      <div style={styles.backdrop} onClick={onClose}>
        <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
          <p style={{ color: "#a0aec0", fontSize: "0.85rem", padding: "1rem" }}>Loading…</p>
        </div>
      </div>
    );
  }

  const isDirty =
    orig !== null &&
    (draft.whisper_model !== orig.whisper_model ||
      draft.ollama_model !== orig.ollama_model ||
      draft.ollama_num_gpu !== orig.ollama_num_gpu);

  const busy = status.kind === "saving" || status.kind === "reinitializing";

  const handleSave = async (andReinit: boolean) => {
    setStatus({ kind: andReinit ? "reinitializing" : "saving" });
    try {
      const updated = await saveSettings({
        whisper_model: draft.whisper_model,
        ollama_model: draft.ollama_model,
        ollama_num_gpu: draft.ollama_num_gpu,
      });
      setOrig(updated);
      if (andReinit) {
        await reinitializeEngine();
        setStatus({
          kind: "done",
          msg: "Engine reinitialized. Disconnect and reconnect to apply.",
        });
      } else {
        setStatus({
          kind: "done",
          msg: "Settings saved to .env. Reinitialize to apply Whisper changes.",
        });
      }
    } catch (err) {
      setStatus({ kind: "error", msg: String(err) });
    }
  };

  const setField = <K extends keyof EngineSettings>(field: K) =>
    (val: EngineSettings[K]) =>
      setDraft((d) => (d ? { ...d, [field]: val } : d));

  const handleOpenVolumeMixer = async () => {
    setMixerStatus("opening");
    try {
      const res = await openVolumeMixer();
      setMixerStatus(res.ok ? "idle" : "unsupported");
    } catch {
      setMixerStatus("idle");
    }
  };

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <span style={styles.title}>Model Settings</span>
          <button style={styles.closeBtn} onClick={onClose}>
            ✕
          </button>
        </div>

        <div style={styles.body}>
          {/* Whisper */}
          <Section label="Whisper model">
            <SegmentedControl
              options={WHISPER_MODELS}
              value={draft.whisper_model}
              onChange={setField("whisper_model")}
            />
            <p style={styles.hint}>
              Requires reinitialize to take effect.
            </p>
          </Section>

          {/* Ollama — only in full mode */}
          {draft.mode === "full" && (
            <>
              <Section label="Ollama model">
                {(() => {
                  const opts = ollamaModels.includes(draft.ollama_model)
                    ? ollamaModels
                    : [draft.ollama_model, ...ollamaModels];
                  return (
                    <select
                      style={styles.selectInput}
                      value={draft.ollama_model}
                      onChange={(e) => setField("ollama_model")(e.target.value)}
                    >
                      {opts.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  );
                })()}
                <p style={styles.hint}>
                  Only models already pulled via{" "}
                  <code style={styles.code}>ollama pull</code> appear here.
                  Takes effect immediately on next query.
                </p>
              </Section>

              <Section label="Ollama device">
                <SegmentedControl
                  options={["GPU", "CPU"]}
                  value={draft.ollama_num_gpu === 0 ? "CPU" : "GPU"}
                  onChange={(v) => setField("ollama_num_gpu")(v === "CPU" ? 0 : -1)}
                />
                <p style={styles.hint}>
                  GPU uses all available layers. Takes effect immediately on
                  next query.
                </p>
              </Section>
            </>
          )}
          {/* Audio routing */}
          <Section label="Audio Routing">
            <button
              style={{ ...styles.saveBtn, width: "100%", textAlign: "center" as const }}
              onClick={handleOpenVolumeMixer}
              disabled={mixerStatus === "opening"}
            >
              {mixerStatus === "opening" ? "Opening…" : "Open Volume Mixer"}
            </button>
            {mixerStatus === "unsupported" && (
              <p style={{ ...styles.hint, color: "#fc8181" }}>Only supported on Windows.</p>
            )}
            <p style={styles.hint}>
              Route a specific app (e.g. Teams, Zoom) to a virtual cable without
              capturing all system audio.{" "}
              <strong style={{ color: "#a0aec0" }}>Do not</strong> change the speaker in
              Teams settings — use Windows Volume Mixer instead to avoid the "not working"
              error. Teams → CABLE Input | Scribe device → CABLE Output.
            </p>
          </Section>
        </div>

        {status.kind === "done" && (
          <p style={styles.statusOk}>{status.msg}</p>
        )}
        {status.kind === "error" && (
          <p style={styles.statusErr}>{status.msg}</p>
        )}

        <div style={styles.footer}>
          <button style={styles.cancelBtn} onClick={onClose} disabled={busy}>
            Close
          </button>
          <button
            style={{ ...styles.saveBtn, opacity: !isDirty || busy ? 0.45 : 1 }}
            onClick={() => handleSave(false)}
            disabled={!isDirty || busy}
            title="Write to .env only"
          >
            {status.kind === "saving" ? "Saving…" : "Save"}
          </button>
          <button
            style={{ ...styles.reinitBtn, opacity: !isDirty || busy ? 0.45 : 1 }}
            onClick={() => handleSave(true)}
            disabled={!isDirty || busy}
            title="Save and reload the Whisper engine in-process"
          >
            {status.kind === "reinitializing"
              ? "Reinitializing…"
              : "Save & Reinitialize"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: "1rem" }}>
      <p
        style={{
          margin: "0 0 0.4rem",
          fontSize: "0.75rem",
          color: "#718096",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {label}
      </p>
      {children}
    </div>
  );
}

function SegmentedControl({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {options.map((opt) => (
        <button
          key={opt}
          style={{
            flex: 1,
            padding: "5px 0",
            fontSize: "0.8rem",
            borderRadius: 4,
            border: "1px solid",
            cursor: "pointer",
            background: value === opt ? "#3182ce" : "#2d3148",
            borderColor: value === opt ? "#63b3ed" : "#4a5568",
            color: value === opt ? "#fff" : "#a0aec0",
            fontWeight: value === opt ? 600 : 400,
          }}
          onClick={() => onChange(opt)}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

const styles = {
  backdrop: {
    position: "fixed" as const,
    inset: 0,
    background: "rgba(0,0,0,0.6)",
    zIndex: 100,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  modal: {
    background: "#1a1d27",
    border: "1px solid #2d3148",
    borderRadius: 8,
    width: 400,
    maxWidth: "calc(100vw - 2rem)",
    boxShadow: "0 20px 60px rgba(0,0,0,0.7)",
    display: "flex",
    flexDirection: "column" as const,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0.85rem 1rem",
    borderBottom: "1px solid #2d3148",
  },
  title: { fontWeight: 600, fontSize: "0.95rem", color: "#e2e8f0" },
  closeBtn: {
    background: "none",
    border: "none",
    color: "#718096",
    fontSize: "1rem",
    cursor: "pointer",
    padding: "2px 6px",
    borderRadius: 4,
  },
  body: { padding: "1rem" },
  hint: { fontSize: "0.72rem", color: "#718096", margin: "0.3rem 0 0" },
  code: {
    fontFamily: "monospace",
    fontSize: "0.72rem",
    background: "#2d3148",
    padding: "1px 4px",
    borderRadius: 3,
  },
  selectInput: {
    width: "100%",
    boxSizing: "border-box" as const,
    background: "#2d3148",
    border: "1px solid #4a5568",
    borderRadius: 4,
    color: "#e2e8f0",
    padding: "5px 8px",
    fontSize: "0.85rem",
    fontFamily: "monospace",
  },
  footer: {
    display: "flex",
    gap: "0.5rem",
    justifyContent: "flex-end",
    padding: "0.75rem 1rem",
    borderTop: "1px solid #2d3148",
  },
  cancelBtn: {
    background: "none",
    border: "1px solid #4a5568",
    borderRadius: 4,
    color: "#a0aec0",
    fontSize: "0.8rem",
    padding: "5px 14px",
    cursor: "pointer",
  },
  saveBtn: {
    background: "#2c5282",
    border: "1px solid #4299e1",
    borderRadius: 4,
    color: "#e2e8f0",
    fontSize: "0.8rem",
    padding: "5px 14px",
    cursor: "pointer",
  },
  reinitBtn: {
    background: "#276749",
    border: "1px solid #48bb78",
    borderRadius: 4,
    color: "#e2e8f0",
    fontSize: "0.8rem",
    padding: "5px 14px",
    cursor: "pointer",
  },
  statusOk: {
    fontSize: "0.78rem",
    color: "#68d391",
    margin: "0",
    padding: "0 1rem 0.5rem",
  },
  statusErr: {
    fontSize: "0.78rem",
    color: "#fc8181",
    margin: "0",
    padding: "0 1rem 0.5rem",
  },
};
