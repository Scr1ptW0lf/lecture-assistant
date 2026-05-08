import { useEffect, useRef } from "react";
import type { TranscriptLine } from "../types";

interface Props {
  lines: TranscriptLine[];
  bufferText: string;
  onClear: () => void;
  onSave: () => void;
}


function formatTimestamp(timeStr: string): string {
  if (!timeStr || timeStr.length > 12) return "";
  return timeStr.replace(/\.\d+$/, ""); // strip sub-second precision for display
}

/**
 * Group committed segments into visual paragraphs.
 * Breaks on whichever comes first: N sentence-endings OR N lines.
 * The line cap is the primary mechanism because LocalAgreement only emits
 * a handful of committed segments per minute — sentence counting alone
 * never accumulates enough to fire.
 */
function groupIntoParagraphs(
  lines: TranscriptLine[],
  maxSentences = 3,
  maxLines = 3,
): TranscriptLine[][] {
  if (lines.length === 0) return [];
  const groups: TranscriptLine[][] = [[]];
  let sentences = 0;
  let lineCount = 0;

  for (const line of lines) {
    const shouldBreak =
      groups[groups.length - 1].length > 0 &&
      (lineCount >= maxLines || sentences >= maxSentences);

    if (shouldBreak) {
      groups.push([]);
      sentences = 0;
      lineCount = 0;
    }

    groups[groups.length - 1].push(line);
    lineCount++;
    sentences += (line.text.match(/[.!?]+/g) || []).length;
  }

  return groups;
}

export function TranscriptPanel({ lines, bufferText, onClear, onSave }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  useEffect(() => {
    if (atBottomRef.current) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines, bufferText]);

  const paragraphs = groupIntoParagraphs(lines);

  return (
    <section style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.title}>Live Transcript</span>
        <div style={styles.headerBtns}>
          {lines.length > 0 && (
            <button style={styles.headerBtn} onClick={onSave} title="Save transcript as .txt">
              Save
            </button>
          )}
          {(lines.length > 0 || bufferText) && (
            <button style={styles.headerBtn} onClick={onClear}>
              Clear
            </button>
          )}
        </div>
      </div>

      <div ref={containerRef} style={styles.scroll} onScroll={handleScroll}>
        {lines.length === 0 && !bufferText && (
          <p style={styles.empty}>Start listening to see the transcript here.</p>
        )}

        {paragraphs.map((group, gi) => (
          <div key={group[0].id} style={styles.paragraph}>
            {/* Paragraph break separator (not before the very first group) */}
            {gi > 0 && (
              <div style={styles.breakRow}>
                <hr style={styles.breakLine} />
                <span style={styles.breakLabel}>{formatTimestamp(group[0].id)}</span>
                <hr style={styles.breakLine} />
              </div>
            )}

            {group.map((line) => (
              <div
                key={line.id}
                style={line.nameDetected ? styles.lineHighlight : styles.line}
              >
                <span style={styles.ts}>{gi === 0 || line === group[0] ? formatTimestamp(line.id) : ""}</span>
                <span>{line.text}</span>
                {line.nameDetected && <span style={styles.alert}>🔔 Your name!</span>}
              </div>
            ))}
          </div>
        ))}

        {bufferText && (
          <div style={styles.bufferLine}>
            <span style={styles.ts}>…</span>
            <span style={styles.bufferText}>{bufferText}</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </section>
  );
}

const styles = {
  panel: {
    display: "flex",
    flexDirection: "column" as const,
    height: "100%",
    background: "#141720",
    borderRight: "1px solid #2d3148",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "0.6rem 1rem",
    borderBottom: "1px solid #2d3148",
  },
  title: { fontWeight: 600, fontSize: "0.9rem", color: "#90cdf4" },
  headerBtns: { display: "flex", gap: "0.4rem" },
  headerBtn: {
    background: "none",
    border: "1px solid #4a5568",
    borderRadius: 4,
    color: "#a0aec0",
    fontSize: "0.75rem",
    cursor: "pointer",
    padding: "2px 8px",
  },
  scroll: { flex: 1, overflowY: "auto" as const, padding: "0.75rem 1rem" },
  empty: { color: "#4a5568", fontSize: "0.85rem", marginTop: "1rem", textAlign: "center" as const },
  paragraph: {
    marginBottom: "0.5rem",
  },
  breakRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    margin: "0.75rem 0 0.5rem",
  },
  breakLine: {
    flex: 1,
    border: "none",
    borderTop: "1px solid #2d3148",
    margin: 0,
  },
  breakLabel: {
    color: "#4a5568",
    fontSize: "0.7rem",
    flexShrink: 0,
    whiteSpace: "nowrap" as const,
  },
  line: {
    display: "flex",
    gap: "0.6rem",
    alignItems: "baseline",
    padding: "3px 0",
    fontSize: "0.88rem",
  },
  lineHighlight: {
    display: "flex",
    gap: "0.6rem",
    alignItems: "baseline",
    padding: "4px 6px",
    fontSize: "0.88rem",
    background: "#3d2c0a",
    borderLeft: "3px solid #f6ad55",
    borderRadius: 3,
    marginBottom: 2,
    fontWeight: 600,
  },
  bufferLine: {
    display: "flex",
    gap: "0.6rem",
    alignItems: "baseline",
    padding: "4px 0",
    fontSize: "0.88rem",
    opacity: 0.45,
  },
  bufferText: {
    fontStyle: "italic" as const,
    color: "#a0aec0",
  },
  ts: { color: "#4a5568", fontSize: "0.75rem", flexShrink: 0, minWidth: 52 },
  alert: { color: "#f6ad55", fontSize: "0.75rem", flexShrink: 0, marginLeft: "auto" },
};
