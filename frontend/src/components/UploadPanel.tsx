import { useCallback, useState } from "react";
import { clearRagDb, uploadPDF } from "../api";

type Status = "idle" | "uploading" | "done" | "error";

interface Props {
  sources: string[];
  selectedSource: string | null;
  onSourceChange: (source: string | null) => void;
  onUploadDone: () => void;
}

export function UploadPanel({ sources, selectedSource, onSourceChange, onUploadDone }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [filename, setFilename] = useState("");
  const [chunks, setChunks] = useState(0);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [clearing, setClearing] = useState(false);

  const handleClearDb = useCallback(async () => {
    if (!confirm("Clear all uploaded textbooks from the database?")) return;
    setClearing(true);
    try {
      await clearRagDb();
      onSourceChange(null);
      onUploadDone();
      setStatus("idle");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Clear failed");
    } finally {
      setClearing(false);
    }
  }, [onSourceChange, onUploadDone]);

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("Only PDF files are accepted.");
      setStatus("error");
      return;
    }
    setStatus("uploading");
    setProgress(0);
    setError("");
    try {
      const result = await uploadPDF(file, setProgress);
      setFilename(result.filename);
      setChunks(result.chunks_stored);
      setStatus("done");
      onUploadDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
      setStatus("error");
    }
  }, [onUploadDone]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const onInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  return (
    <section style={styles.panel}>
      <div style={styles.titleRow}>
        <h2 style={styles.title}>Textbook</h2>
        {sources.length > 0 && (
          <button style={styles.clearDbBtn} onClick={handleClearDb} disabled={clearing}>
            {clearing ? "…" : "Clear DB"}
          </button>
        )}
      </div>

      <div
        style={{ ...styles.dropzone, ...(dragOver ? styles.dropzoneActive : {}) }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        {status === "idle" && (
          <p>Drag & drop a PDF or <label style={styles.link}>browse<input type="file" accept=".pdf" style={{ display: "none" }} onChange={onInput} /></label></p>
        )}
        {status === "uploading" && <p>Uploading… {progress}%</p>}
        {status === "done" && (
          <p style={{ color: "#68d391" }}>
            ✓ {filename} — {chunks} chunks.{" "}
            <label style={styles.link}>Upload another<input type="file" accept=".pdf" style={{ display: "none" }} onChange={onInput} /></label>
          </p>
        )}
        {status === "error" && (
          <p style={{ color: "#fc8181" }}>
            {error}{" "}
            <label style={styles.link}>Try again<input type="file" accept=".pdf" style={{ display: "none" }} onChange={onInput} /></label>
          </p>
        )}
      </div>

      <div style={styles.selectorRow}>
        <label style={styles.selectorLabel}>Active textbook</label>
        <select
          style={styles.selector}
          value={selectedSource ?? ""}
          onChange={(e) => onSourceChange(e.target.value || null)}
        >
          <option value="">— None (general knowledge) —</option>
          {sources.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
    </section>
  );
}

const styles = {
  panel: { padding: "0.75rem 1rem", borderBottom: "1px solid #2d3148" },
  titleRow: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" },
  title: { fontSize: "0.9rem", fontWeight: 600, color: "#90cdf4", margin: 0 },
  clearDbBtn: {
    background: "none",
    border: "1px solid #744210",
    borderRadius: 4,
    color: "#f6ad55",
    fontSize: "0.72rem",
    cursor: "pointer",
    padding: "2px 8px",
  },
  dropzone: {
    border: "2px dashed #4a5568",
    borderRadius: 6,
    padding: "0.75rem 1rem",
    textAlign: "center" as const,
    fontSize: "0.85rem",
    color: "#a0aec0",
    cursor: "pointer",
    transition: "border-color 0.15s",
  },
  dropzoneActive: { borderColor: "#63b3ed" },
  link: { color: "#63b3ed", cursor: "pointer", textDecoration: "underline" },
  selectorRow: {
    marginTop: "0.6rem",
    display: "flex",
    flexDirection: "column" as const,
    gap: "0.3rem",
  },
  selectorLabel: { fontSize: "0.75rem", color: "#718096" },
  selector: {
    background: "#2d3148",
    border: "1px solid #4a5568",
    borderRadius: 4,
    color: "#e2e8f0",
    fontSize: "0.82rem",
    padding: "4px 6px",
    width: "100%",
  },
};
