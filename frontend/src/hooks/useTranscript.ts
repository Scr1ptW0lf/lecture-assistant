import { useCallback, useRef, useState } from "react";
import type { TranscriptLine, Summary } from "../types";

interface UseTranscriptOptions {
  studentName: string;
  deviceIndex: number;
  source: string | null;
  contentType: string;
  userContext: string;
  onNameDetected: (text: string) => void;
}

export function useTranscript({ studentName, deviceIndex, source, contentType, userContext, onNameDetected }: UseTranscriptOptions) {
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [bufferText, setBufferText] = useState<string>("");
  const [isConnected, setIsConnected] = useState(false);
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldReconnect = useRef(false);
  // IDs of lines that were present when Clear was pressed — filter from future state updates.
  const clearedIds = useRef<Set<string>>(new Set());

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    shouldReconnect.current = true;
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const host = window.location.host;
    const ws = new WebSocket(`${proto}://${host}/ws/transcribe`);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      ws.send(JSON.stringify({ student_name: studentName, device_index: deviceIndex, source, content_type: contentType, user_context: userContext }));
    };

    ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data) as {
        type: string;
        lines?: Array<{ start: string; display_ts?: string; end: string; text: string; name_detected: boolean }>;
        buffer?: string;
        new_name_alerts?: string[];
        id?: string;
        token?: string;
        done?: boolean;
        message?: string;
      };

      if (msg.type === "state") {
        const newLines: TranscriptLine[] = (msg.lines ?? [])
          .filter((l) => !clearedIds.current.has(l.start || ""))
          .map((l) => ({
            id: l.start || `${Date.now()}-${Math.random()}`,
            displayTs: l.display_ts || l.start || "",
            end: l.end || "",
            text: l.text,
            nameDetected: l.name_detected,
            timestamp: Date.now(),
            final: true,
          }));
        setLines(newLines);
        setBufferText(msg.buffer ?? "");

        for (const text of msg.new_name_alerts ?? []) {
          onNameDetected(text);
        }
      } else if (msg.type === "summary" && msg.id) {
        const { id, token = "", done = false } = msg;
        setSummaries((prev) => {
          const existing = prev.find((s) => s.id === id);
          if (!existing) {
            return [...prev, { id, text: token, streaming: !done }];
          }
          return prev.map((s) =>
            s.id === id ? { ...s, text: s.text + token, streaming: !done } : s
          );
        });
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      setBufferText("");
      wsRef.current = null;
      if (shouldReconnect.current) {
        reconnectTimer.current = setTimeout(connect, 3000);
      }
    };

    ws.onerror = () => ws.close();
  }, [studentName, deviceIndex, source, contentType, userContext, onNameDetected]);

  const disconnect = useCallback(() => {
    shouldReconnect.current = false;
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    wsRef.current?.close();
    wsRef.current = null;
    setBufferText("");
  }, []);

  const clearLines = useCallback(() => {
    setLines((prev) => {
      prev.forEach((l) => clearedIds.current.add(l.id));
      return [];
    });
    setSummaries([]);
    setBufferText("");
  }, []);

  const restoreSession = useCallback((savedLines: TranscriptLine[], savedSummaries: Summary[]) => {
    clearedIds.current.clear();
    setLines(savedLines);
    setSummaries(savedSummaries);
    setBufferText("");
  }, []);

  const requestSummary = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "request_summary" }));
  }, []);

  const sendContextUpdate = useCallback((contentType: string, userContext: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "update_context", content_type: contentType, user_context: userContext }));
    }
  }, []);

  return { lines, bufferText, isConnected, connect, disconnect, clearLines, restoreSession, summaries, requestSummary, sendContextUpdate };
}
