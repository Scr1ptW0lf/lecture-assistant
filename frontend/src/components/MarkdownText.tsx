import { Fragment } from "react";

interface Props {
  text: string;
  style?: React.CSSProperties;
  className?: string;
}

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${keyPrefix}-b${i}`}>{part.slice(2, -2)}</strong>;
    }
    return <Fragment key={`${keyPrefix}-t${i}`}>{part}</Fragment>;
  });
}

export function MarkdownText({ text, style }: Props) {
  if (!text) return null;

  const lines = text.split("\n");

  return (
    <div style={style}>
      {lines.map((line, i) => {
        const trimmed = line.trim();

        if (!trimmed) {
          return <div key={i} style={{ height: "0.35rem" }} />;
        }

        // Bullet points: "- " or "* "
        const bulletMatch = trimmed.match(/^[-*]\s+(.*)/);
        if (bulletMatch) {
          return (
            <div key={i} style={bulletStyle}>
              <span style={bulletDot}>•</span>
              <span>{renderInline(bulletMatch[1], String(i))}</span>
            </div>
          );
        }

        // Headers: # ## ###
        const headerMatch = trimmed.match(/^(#{1,3})\s+(.*)/);
        if (headerMatch) {
          const level = headerMatch[1].length;
          const fontSize = ["0.92rem", "0.88rem", "0.85rem"][level - 1];
          return (
            <div key={i} style={{ fontWeight: 700, fontSize, marginBottom: "0.3rem", color: "#90cdf4" }}>
              {renderInline(headerMatch[2], String(i))}
            </div>
          );
        }

        return (
          <div key={i} style={{ marginBottom: "0.15rem" }}>
            {renderInline(line, String(i))}
          </div>
        );
      })}
    </div>
  );
}

const bulletStyle: React.CSSProperties = {
  display: "flex",
  gap: "0.4rem",
  alignItems: "baseline",
  marginBottom: "0.3rem",
};

const bulletDot: React.CSSProperties = {
  flexShrink: 0,
  color: "#90cdf4",
  lineHeight: 1.5,
};
