import type { AudioDevice, AppMode, EngineSettings } from "./types";

export async function fetchConfig(): Promise<{ mode: AppMode }> {
  const res = await fetch("/api/config");
  return res.json();
}

export async function fetchSettings(): Promise<EngineSettings> {
  const res = await fetch("/api/settings");
  return res.json();
}

export async function saveSettings(patch: Partial<EngineSettings>): Promise<EngineSettings> {
  const res = await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function reinitializeEngine(): Promise<void> {
  const res = await fetch("/api/reinitialize", { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
}

export async function openVolumeMixer(): Promise<{ ok: boolean; reason?: string }> {
  const res = await fetch("/api/system/open-volume-mixer", { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchOllamaModels(): Promise<string[]> {
  try {
    const res = await fetch("/api/ollama/models");
    if (!res.ok) return [];
    return ((await res.json()).models as string[]) ?? [];
  } catch {
    return [];
  }
}

export async function fetchDevices(): Promise<AudioDevice[]> {
  const res = await fetch("/api/devices");
  const data = await res.json();
  return data.devices as AudioDevice[];
}

export async function uploadPDF(
  file: File,
  onProgress?: (pct: number) => void
): Promise<{ chunks_stored: number; filename: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("file", file);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        reject(new Error(xhr.responseText || "Upload failed"));
      }
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.open("POST", "/api/ingest");
    xhr.send(form);
  });
}

export async function clearRagDb(): Promise<{ deleted: number }> {
  const res = await fetch("/api/rag/sources", { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchRagSources(): Promise<string[]> {
  try {
    const res = await fetch("/api/rag/sources");
    if (!res.ok) return [];
    return ((await res.json()).sources as string[]) ?? [];
  } catch {
    return [];
  }
}

export async function* streamAnswer(question: string, source: string | null): AsyncGenerator<string> {
  const res = await fetch("/api/qa", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, source }),
  });

  if (!res.ok || !res.body) throw new Error(await res.text());

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") return;
      try {
        yield JSON.parse(payload).token as string;
      } catch {
        // malformed line — skip
      }
    }
  }
}
