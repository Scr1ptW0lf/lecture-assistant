# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A fully local, offline-first audio transcription and AI assistant ("Scribe"). Captures system audio output (loopback — not microphone), transcribes in real-time using Whisper, alerts when the user's name is spoken, generates cumulative AI summaries every 2 minutes, and answers questions grounded in an uploaded PDF via RAG. Supports lectures, meetings, video playback, podcasts, and general recordings.

**No external API calls at runtime. Everything runs on the local machine.**

## How to run

```powershell
# Start the backend (serves frontend at http://localhost:8000)
.venv\Scripts\python.exe main.py

# Frontend dev server (hot reload, proxies to :8000)
cd frontend
C:\Program Files\nodejs\npm.cmd run dev   # use npm.cmd not npm (PS execution policy)

# Rebuild frontend after changes
$env:PATH = "C:\Program Files\nodejs;" + $env:PATH; Set-Location frontend; & "C:\Program Files\nodejs\npm.cmd" run build
```

**Note:** Run `ollama serve` first if Ollama isn't running as a background service. `TranscriptionEngine` can be reloaded at runtime via `POST /api/reinitialize` (calls `TranscriptionEngine.reset()` then `load()`); no restart needed for Whisper model changes.

## Architecture

```
System audio output (loopback)
  → backend/audio.py          (pyaudiowpatch WASAPI on Windows; sounddevice on macOS/Linux)
  → queue.Queue               (thread-safe bridge from audio callback to asyncio)
  → backend/transcription.py  (WhisperLiveKit AudioProcessor, pcm_input=True, LocalAgreement policy)
  → backend/name_detector.py  (exact + difflib fuzzy match)
  → WebSocket /ws/transcribe  (full-state-replace protocol)
      summary_loop()          (cumulative Ollama summary every 120 s)
  → React frontend            (TranscriptPanel, QAPanel, MarkdownText, browser Notification API)

PDF upload → backend/rag.py   (PyMuPDF → ChromaDB, sentence-transformers embeddings)
Question   → /api/qa          (ChromaDB retrieval + Ollama llama3.2:3b → SSE stream)
```

## Two hardware modes

Set via `MODE` in `.env`:

| Mode | Whisper model | LLM / RAG | RAM |
|------|--------------|-----------|-----|
| `lite` | tiny, CPU | none | ~1 GB |
| `full` | base, CUDA | Ollama llama3.2:3b + ChromaDB | ~6 GB |

The FastAPI routers for `/api/qa` and `/api/ingest` are only registered when `MODE=full`. `backend/config.py` applies sensible defaults automatically (e.g. `tiny` when mode is `lite`, `float16` when device is `cuda`).

## Frontend file map

| File | Purpose |
|------|---------|
| `src/App.tsx` | Root layout, autosave to localStorage, restore-session banner, save/load JSON session handlers |
| `src/hooks/useTranscript.ts` | WebSocket lifecycle, `lines`/`summaries` state, `clearLines()`, `restoreSession()` |
| `src/components/TranscriptPanel.tsx` | Transcript display, paragraph grouping, Load/Save Session/Export .txt buttons |
| `src/components/QAPanel.tsx` | Live Summary pane + Q&A pane; uses `MarkdownText` for both |
| `src/components/MarkdownText.tsx` | Inline markdown renderer (`**bold**`, `- bullets`, `# headers`) — no npm dep |
| `src/components/SettingsBar.tsx` | Top bar: name, device, content type, user context, connect/disconnect |
| `src/components/SettingsModal.tsx` | Whisper/Ollama settings overlay (Save / Save & Reinitialize) |
| `src/components/UploadPanel.tsx` | PDF upload + source selector for RAG |
| `src/components/DeviceSelector.tsx` | Audio device dropdown |
| `src/hooks/useNotification.ts` | Browser Notification API wrapper |
| `src/api.ts` | `fetchConfig`, `fetchDevices`, `fetchRagSources`, `streamAnswer` (SSE) |
| `src/types.ts` | All shared TypeScript interfaces (see below) |

## TypeScript types (`src/types.ts`)

```typescript
TranscriptLine {
  id: string;        // dedup key — stable "start_key" or "start_key:s_idx"
  displayTs: string; // clean timestamp for UI ("H:MM:SS.cc"), interpolated from word position
  end: string;
  text: string;
  nameDetected: boolean;
  timestamp: number; // wall-clock ms when received
  final: boolean;
}

Summary { id: string; text: string; streaming: boolean; }

SessionData {        // shape of autosave JSON and saved session files
  version: number;
  saved_at: string;  // ISO timestamp
  student_name?: string; content_type?: string; user_context?: string;
  lines: TranscriptLine[];
  summaries: Summary[];
}

QAPair { id; question; answer; streaming }
AudioDevice { index; name; is_recommended }
EngineSettings { whisper_model; whisper_device; whisper_compute_type; ollama_model; ollama_num_gpu; mode }
AppMode = "lite" | "full"
```

## WhisperLiveKit integration

`WhisperLiveKit/` is a **vendored local clone** installed as an editable package (`pip install -e WhisperLiveKit/`). Do not install it from PyPI.

Key design decisions:
- `backend_policy="localagreement"` — LocalAgreement (not SimulStreaming). SimulStreaming's `get_buffer()` returns empty text for non-auto languages.
- `pcm_input=True` — skips FFmpeg; we feed raw s16le bytes converted from float32 loopback audio.
- `vac=True` — Silero VAD gates audio to the transcription queue; reduces hallucination on silence.
- `TranscriptionEngine` is a **process-level singleton** (double-checked locking). `make_processor()` returns a fresh `AudioProcessor` per WebSocket session wrapping the shared engine.

`FrontData.to_dict()["lines"]` includes **both** committed segments (from `validated_segments`) and the current in-progress segment (from `current_line_tokens`). Lines only move to `validated_segments` after a **>5 second silence** (`MIN_DURATION_REAL_SILENCE = 5`). During normal continuous speech, the entire session accumulates as a single growing segment.

**Critical gotcha — WhisperLiveKit prunes history:** `TokensAlignment._prune()` (in `WhisperLiveKit/whisperlivekit/tokens_alignment.py`) drops `validated_segments` older than `_DEFAULT_RETENTION_SECONDS = 300` seconds (5 min) on every `get_lines()` call. **Never use `d.get("lines", [])` as the authoritative frontend state** — it loses old content. The fix is `all_frontend_lines` (see `send_results` below).

**Paragraph splitting:** `send_results()` calls `_split_sentences()` to break each segment's text into chunks of up to 4 sentences (≤40 words). The frontend groups every 5 lines into a visual paragraph.

## WebSocket protocol

Client → server (on connect, one message only):
```json
{ "student_name": "Aidan", "device_index": -1, "source": "textbook.pdf", "content_type": "lecture", "user_context": "COMP3900 algorithms midterm review" }
```
`source` is optional. `content_type`: `lecture | meeting | video | podcast | general`. `user_context`: free text (optional).

Client → server (on demand):
```json
{ "type": "request_summary" }
```

Server → client:
```json
{ "type": "state", "lines": [{"start": "0:00:01.23", "display_ts": "0:00:01.23", "end": "0:00:03.45", "text": "...", "name_detected": false}], "buffer": "...", "new_name_alerts": [] }
{ "type": "summary", "id": "summary-1", "token": "...", "done": false }
{ "type": "summary", "id": "summary-1", "token": "", "done": true }
{ "type": "status", "message": "Transcription started" }
{ "type": "error", "message": "..." }
```

Each line object has two timestamp fields:
- `start` — stable dedup key: `"H:MM:SS.cc"` for s_idx=0, `"H:MM:SS.cc:N"` for subsequent split-sentences from the same segment. **Never changes once created.** Used as React `key` and in `clearedIds`.
- `display_ts` — interpolated from word position within the segment's start→end range; shows a better per-sentence time in the UI. Updates on each frame while the segment is in-progress, stabilises once committed.

`lines` is the **complete session line list** (not a diff), built from `all_frontend_lines` (never pruned). The frontend replaces its full line list on every state message.

`summary` tokens are accumulated by `id`. The frontend shows only the latest summary. Each periodic summary is a new ID; on-demand summaries use `"summary-demand-N"` IDs.

The `clearedIds` pattern: when the user clicks Clear, current line IDs go into a `Set` ref. Future `state` messages filter out those IDs so cleared lines never reappear.

Frontend reconnects after 3 s on close and re-sends the init message.

## `send_results()` design — `ws_transcribe.py`

The three key data structures inside `send_results()`:

```
all_frontend_lines: dict[str, dict]   # ordered dict sub_key→entry; accumulates forever, never pruned.
                                       # This is what gets sent to the frontend each update.
seen_starts: set[str]                  # dedup gate for all_transcript_lines only.
all_transcript_lines: list             # LLM summary accumulator; shared with summary_loop by closure.
```

On each WhisperLiveKit update:
1. Rebuild entries from `d.get("lines", [])` — WhisperLiveKit's pruned view.
2. Write every entry into `all_frontend_lines[sub_key]` (insert or update in place).
3. Gate adds to `all_transcript_lines` through `seen_starts`.
4. Send `list(all_frontend_lines.values())` — complete unpruned history.

Helper functions: `_parse_ts(ts) → float | None`, `_format_ts(secs) → str` — convert `"H:MM:SS.cc"` ↔ float seconds for timestamp interpolation.

## Summary system

`stream_summary(summary_id, new_lines, prior_summary="") → str`
- If `prior_summary` is non-empty: prompts the LLM to extend the previous summary with new transcript content. Returns the full completed text.
- If `prior_summary` is empty: generates a fresh summary from scratch.
- Requests `**bold**` for key terms so `MarkdownText` renders them.

`summary_loop()` — **awaits** `stream_summary` directly (no `create_task`). Tracks:
- `last_summarized_idx` — index into `all_transcript_lines` at end of last round; new rounds pass only `all_transcript_lines[last_summarized_idx:]`.
- `prior_summary_text` — accumulated summary text fed to the next round.

On-demand summaries (`request_summary` message) pass the full `all_transcript_lines` list with `prior_summary=""` (complete fresh summary, not incremental).

## Session persistence

**Autosave:** `App.tsx` debounces writes to `localStorage["la_autosave_session"]` (key `LS_AUTOSAVE`) 30 s after any `lines` or `summaries` change. Shape: `SessionData` JSON.

**Restore banner:** On mount, App checks localStorage for a non-empty saved session and renders a blue banner with "Restore" / "Dismiss" buttons.

**Save Session button** in `TranscriptPanel` header: downloads `SessionData` as a `.json` file.
**Load Session button**: opens a file picker, parses JSON, calls `restoreSession(lines, summaries)` from `useTranscript`.
**Export .txt button**: downloads lines as plain text (one `[displayTs] text` line each).

`useTranscript.restoreSession(lines, summaries)`: clears `clearedIds` ref, then `setLines` + `setSummaries`. Called both by the restore-banner handler and by the Load Session file picker.

## `MarkdownText` component

`src/components/MarkdownText.tsx` — renders the LLM output for both Live Summary and Q&A answers.

Handles:
- `**bold**` → `<strong>`
- Lines starting with `- ` or `* ` → bullet with `•` prefix in accent colour
- Lines starting with `# `, `## `, `### ` → styled headers
- Blank lines → 0.35rem spacer

No npm dependencies (no `react-markdown`). Sufficient for the bullet-point output the LLM produces.

**Do not use a `<p>` tag** for LLM output — use `<MarkdownText text={...} style={...} />` instead.

## Runtime settings API

`backend/routers/settings.py` — registered in both `lite` and `full` modes:

- `GET /api/settings` — returns `whisper_model`, `whisper_device`, `whisper_compute_type`, `ollama_model`, `ollama_num_gpu`, `mode`
- `POST /api/settings` — validates, mutates the live `settings` singleton, writes to `.env`
- `POST /api/reinitialize` — calls `TranscriptionEngine.reset()` + `transcription.load()` in a thread executor. Disconnect and reconnect after to get a new `AudioProcessor`.
- `GET /api/ollama/models` — proxies Ollama `/api/tags`; returns `{"models": []}` if unreachable

Ollama GPU/CPU is controlled via `OLLAMA_NUM_GPU`: `-1` sends `{"num_gpu": 999}` (GPU), `0` sends `{"num_gpu": 0}` (CPU).

## Cross-platform audio

| OS | Library | Notes |
|----|---------|-------|
| Windows | `pyaudiowpatch` | WASAPI loopback, auto-detects default output |
| macOS | `sounddevice` | Needs BlackHole virtual device installed |
| Linux | `sounddevice` | Select `.monitor` device from PulseAudio/PipeWire |

**WASAPI auto-detect:** three-tier match against default output device name: exact → substring → first available loopback. The `is_recommended` flag uses the same logic.

## RAG (full mode)

ChromaDB collection: `"textbook"`, cosine similarity, 384-dim embeddings (`all-MiniLM-L6-v2`).
Chunk IDs: `"{filename}::chunk::{index}"` — deterministic, re-uploading the same PDF is a safe upsert.
`chroma_path` defaults to `%LOCALAPPDATA%\lecture-assistant\chroma_db` on Windows (avoids OneDrive SQLite lock issues).
Chunk size: 1000 chars, overlap: 150 chars, top-k: 6.

Multiple PDFs supported. `retrieve()` accepts optional `source` param and filters with a ChromaDB `where` clause. The LLM prompt uses "ONLY the textbook passages" wording to prevent small models from ignoring context.

RAG endpoints: `POST /api/ingest`, `GET /api/rag/sources`, `GET /api/rag/status`, `DELETE /api/rag/sources`.

## Environment (.env)

```
MODE=full
WHISPER_MODEL=base           # tiny | base | small
WHISPER_DEVICE=cuda          # informational; FasterWhisperASR uses device=auto internally
WHISPER_COMPUTE_TYPE=float16 # informational; FasterWhisperASR uses compute_type=auto internally
AUDIO_DEVICE_INDEX=-1        # -1 = auto-detect
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2:3b
OLLAMA_NUM_GPU=-1            # -1 = GPU, 0 = CPU
CHROMA_PATH=C:/Users/aidan/AppData/Local/lecture-assistant/chroma_db
```

## Python environment

- `.venv` uses **Python 3.12** (`py -3.12 -m venv .venv`). Python 3.14 incompatible with PyTorch wheels.
- PyTorch: `2.5.1+cu121` (CUDA 12.1, RTX 4060).
- WhisperLiveKit requires `faster-whisper>=1.2.0`. Install via `pip install -e WhisperLiveKit/`.
- Two env vars set in `main.py` before imports: `HF_HUB_DISABLE_SYMLINKS_WARNING=1`, `ANONYMIZED_TELEMETRY=False`.
- Use `npm.cmd` not `npm` in PowerShell.
- **Do not install `datasets` or `pyarrow` on Windows.** `pyarrow 24.0.0` causes an `arrow.dll` access violation (exit -1073741819) that crashes Python on startup.

## Dependencies

- `requirements-lite.txt` — FastAPI, uvicorn, faster-whisper, sounddevice, pyaudiowpatch
- `requirements-full.txt` — extends lite + httpx, chromadb, sentence-transformers, torch, PyMuPDF, whisperlivekit
- `requirements-dev.txt` — extends full + pytest, ruff
- CUDA PyTorch first: `pip install torch --index-url https://download.pytorch.org/whl/cu121`

## Install scripts

- `install.ps1` — Windows (interactive, GPU-aware, installs Ollama, builds frontend)
- `install.sh` — macOS/Linux (checks BlackHole on macOS, ROCm on Linux)

Both scripts write `.env` and are idempotent.

## Common pitfalls

- **WhisperLiveKit pruning:** `validated_segments` older than 5 min are silently dropped by `_prune()`. Always use `all_frontend_lines` dict in `send_results()` as the send buffer — never `frontend_lines` rebuilt fresh from `d.get("lines", [])`.
- **Sub_key stability:** The `start` field of each line object is the React key AND the clearedIds key. It must never change after first insertion. Use `start_key` (s_idx=0) or `f"{start_key}:{s_idx}"`. Never use an interpolated timestamp as the sub_key — interpolated timestamps shift as in-progress segments grow.
- **`all_transcript_lines`:** Defined in the `transcribe_ws` outer scope. Do not redeclare inside any inner function (`send_results`, `summary_loop`, etc.) — it is shared by closure.
- **Markdown in UI:** Use `<MarkdownText>` not `<p>` for any LLM-generated text. The LLM is prompted to use `**bold**` and `- bullets`; plain `<p>` renders those as literal characters.
- **Session save shape:** `SessionData` (in `types.ts`) is the canonical format for both localStorage autosave and downloaded `.json` files. Both use `restoreSession(lines, summaries)` to restore.
- **`npm.cmd`** not `npm` on Windows PowerShell. `npm` is a `.ps1` wrapper blocked by execution policy.
- **`pyarrow` / `datasets`** — never install on Windows; causes fatal DLL crash on import.
