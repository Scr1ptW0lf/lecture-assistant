import { useCallback, useEffect, useRef, useState } from "react";
import { streamAnswer } from "../api";
import type { QAPair, Summary } from "../types";
import { MarkdownText } from "./MarkdownText";

interface Props {
  summaries?: Summary[];
  source: string | null;
  onRequestSummary: () => void;
}

export function QAPanel({ summaries = [], source, onRequestSummary }: Props) {
  const [manualPairs, setManualPairs] = useState<QAPair[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const summaryBoxRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = summaryBoxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [summaries]);

  useEffect(() => {
    const el = historyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [manualPairs]);

  const ask = useCallback(async () => {
    const q = question.trim();
    if (!q || loading) return;

    const id = `${Date.now()}-${Math.random()}`;
    setManualPairs((prev) => [...prev, { id, question: q, answer: "", streaming: true }]);
    setQuestion("");
    setLoading(true);

    try {
      for await (const token of streamAnswer(q, source)) {
        setManualPairs((prev) =>
          prev.map((p) => (p.id === id ? { ...p, answer: p.answer + token } : p))
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error";
      setManualPairs((prev) =>
        prev.map((p) => (p.id === id ? { ...p, answer: `Error: ${msg}`, streaming: false } : p))
      );
    } finally {
      setManualPairs((prev) => prev.map((p) => (p.id === id ? { ...p, streaming: false } : p)));
      setLoading(false);
    }
  }, [question, loading]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      ask();
    }
  };

  const latestSummary = summaries.length > 0 ? summaries[summaries.length - 1] : null;

  return (
    <section style={styles.panel}>
      {/* Left pane: Live Summary */}
      <div style={styles.summaryPane}>
        <div style={styles.paneHeader}>
          <h2 style={styles.title}>Live Summary</h2>
          <button style={styles.updateBtn} onClick={onRequestSummary} title="Generate summary now">
            Update
          </button>
        </div>
        <div ref={summaryBoxRef} style={styles.summaryScroll}>
          {!latestSummary ? (
            <p style={styles.empty}>A summary will appear here every 2 minutes of lecture.</p>
          ) : (
            <div style={styles.summaryContent}>
              <MarkdownText
                text={latestSummary.text}
                style={styles.summaryText}
              />
              {latestSummary.streaming && <span style={styles.cursor}>▋</span>}
            </div>
          )}
        </div>
      </div>

      <div style={styles.verticalDivider} />

      {/* Right pane: AI Responses */}
      <div style={styles.qaPane}>
        <div style={styles.paneHeader}>
          <h2 style={styles.title}>AI Responses</h2>
        </div>

        <div ref={historyRef} style={styles.history}>
          {manualPairs.length === 0 && (
            <p style={styles.empty}>Ask a question about the lecture or textbook below.</p>
          )}
          {manualPairs.map((p) => (
            <div key={p.id} style={styles.pair}>
              <p style={styles.q}>{p.question}</p>
              <div style={styles.answerWrap}>
                {p.answer ? (
                  <MarkdownText text={p.answer} style={styles.answerMd} />
                ) : p.streaming ? (
                  <span style={styles.cursor}>▋</span>
                ) : null}
                {p.streaming && p.answer && <span style={styles.cursor}>▋</span>}
              </div>
            </div>
          ))}
        </div>

        <div style={styles.inputRow}>
          <textarea
            ref={textareaRef}
            style={styles.textarea}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask about the lecture… (Enter to send)"
            rows={2}
            disabled={loading}
          />
          <button style={styles.btn} onClick={ask} disabled={loading || !question.trim()}>
            {loading ? "…" : "Ask"}
          </button>
        </div>
      </div>
    </section>
  );
}

const styles = {
  panel: {
    display: "flex",
    flexDirection: "row" as const,
    flex: 1,
    overflow: "hidden",
  },
  summaryPane: {
    display: "flex",
    flexDirection: "column" as const,
    flex: 1,
    overflow: "hidden",
    padding: "0.75rem 0.75rem 0.75rem 1rem",
  },
  qaPane: {
    display: "flex",
    flexDirection: "column" as const,
    flex: 1,
    overflow: "hidden",
    padding: "0.75rem 1rem 0.75rem 0.75rem",
  },
  verticalDivider: {
    width: 1,
    background: "#2d3148",
    flexShrink: 0,
    alignSelf: "stretch",
  },
  paneHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "0.5rem",
  },
  title: { fontSize: "0.9rem", fontWeight: 600, color: "#90cdf4", margin: 0 },
  updateBtn: {
    background: "none",
    border: "1px solid #4a5568",
    borderRadius: 4,
    color: "#a0aec0",
    fontSize: "0.72rem",
    cursor: "pointer",
    padding: "2px 8px",
  },
  summaryScroll: {
    flex: 1,
    overflowY: "auto" as const,
    background: "#1a1f36",
    border: "1px solid #2d3148",
    borderRadius: 4,
    padding: "0.5rem 0.6rem",
  },
  summaryContent: {
    position: "relative" as const,
  },
  summaryText: {
    color: "#e2e8f0",
    fontSize: "0.82rem",
    lineHeight: 1.6,
  },
  history: { flex: 1, overflowY: "auto" as const, marginBottom: "0.5rem" },
  empty: { color: "#4a5568", fontSize: "0.82rem" },
  pair: { marginBottom: "1rem", borderBottom: "1px solid #2d3148", paddingBottom: "0.75rem" },
  q: {
    color: "#90cdf4",
    fontWeight: 600,
    fontSize: "0.82rem",
    marginBottom: "0.25rem",
  },
  answerWrap: {
    minHeight: "1.2rem",
  },
  answerMd: {
    color: "#e2e8f0",
    fontSize: "0.82rem",
    lineHeight: 1.55,
  },
  cursor: { animation: "blink 1s step-end infinite", display: "inline-block" },
  inputRow: { display: "flex", gap: "0.5rem", alignItems: "flex-end" },
  textarea: {
    flex: 1,
    background: "#2d3148",
    border: "1px solid #4a5568",
    borderRadius: 4,
    color: "#e2e8f0",
    padding: "6px 8px",
    fontSize: "0.82rem",
    resize: "none" as const,
    fontFamily: "inherit",
  },
  btn: {
    background: "#3182ce",
    border: "none",
    borderRadius: 4,
    color: "#fff",
    padding: "6px 12px",
    cursor: "pointer",
    fontSize: "0.82rem",
    alignSelf: "stretch",
  },
};
